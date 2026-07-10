# Ingestão histórica — `supervisor_estoque`

Script para carregar o histórico de planilhas que existe **antes** do agente
começar a chamar a API diária. Uma execução = uma planilha = um dia.

## Pré-requisitos (1×)

```cmd
cd D:\Developer\cowork\Automatizar buscas na API margem\scripts
npm install
```

Isso instala `xlsx` (sheetjs) junto com as outras dependências.

O script lê `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` de
`backend/.env`. Garanta que ambos existem antes da primeira execução.

## Comando

Os arquivos ficam em `D:\Downloads\gmcore\path_xlsx_grade\`. A partir
da pasta raiz do projeto:

```cmd
node scripts/ingest-supervisor-estoque.mjs "D:\Downloads\gmcore\path_xlsx_grade\grade - 02-01.xlsx"
```

A data do snapshot é **extraída do nome do arquivo**. Padrões aceitos:

| Padrão | Exemplo | Ano |
|---|---|---|
| `grade - DD-MM.xlsx` | `grade - 02-01.xlsx` | Inferido — ano atual; se cair no futuro, ano anterior (cobre wrap-around) |
| `arquivo-gerado-DD-MM-AAAA-...xlsx` (legado) | `arquivo-gerado-22-04-2026-09-51-06.xlsx` | Lê do próprio nome |

Não precisa passar nada além do caminho. Em casos atípicos (ano errado
no nome, ou arquivo sem padrão reconhecível), use `--date YYYY-MM-DD`.

### Flags opcionais

| Flag | Uso |
|---|---|
| `--date YYYY-MM-DD` | Sobrescreve a data inferida do nome (raríssimo). |
| `--batch N` | Tamanho do lote enviado por RPC. Default 1000. Reduza se der timeout. |
| `--dry-run` | Parseia, normaliza, mostra amostra; **não envia** ao banco. |

### Exemplos

```cmd
# Padrão — data vem do nome
node scripts/ingest-supervisor-estoque.mjs "\\192.168.118.90\shared_path\historico_grade\arquivo-gerado-22-04-2026-09-51-06.xlsx"

# Sobrescreve a data (caso o nome esteja errado)
node scripts/ingest-supervisor-estoque.mjs "C:\temp\dump.xlsx" --date 2026-04-22

# Confere parsing sem enviar
node scripts/ingest-supervisor-estoque.mjs "...arquivo.xlsx" --dry-run

# Lote menor (se houver timeout no Supabase)
node scripts/ingest-supervisor-estoque.mjs "...arquivo.xlsx" --batch 500
```

## O que ele faz

1. Abre o XLSX (~5 MB, ~50 mil linhas).
2. **Filtra apenas `TIPO = "0 - PRODUTOS DE REVENDA"`**. Demais tipos
   (matéria-prima, uso/consumo, imobilizado etc.) são descartados antes
   de chegar ao banco — você vê a contagem do que ficou de fora.
3. Normaliza nomes de colunas Excel → campos da RPC. O campo `PRODUTO`
   ("8781 - F ABACATE KG") é dividido em `codigo_produto` + `descricao_produto`.
4. Linhas sem `codigo_produto` ou `filial` também são ignoradas.
5. Manda em lotes de 1.000 via `supabase.rpc('fn_supest_ingest_snapshots', ...)`.
6. A RPC faz conversão PT-BR (`1.234,56`, `21/04/2026`, `SIM`/`NAO`) e
   **upsert idempotente** em `supervisor_estoque_snapshots` com `origem='excel'`.

## Idempotência

UNIQUE em `(snapshot_date, filial_cod, codigo_produto)`. Se você rodar o
mesmo arquivo duas vezes, o segundo run atualiza os campos ao invés de
duplicar — sem risco. Use isso pra repetir um dia que falhou no meio.

## Volume / tempo esperado

Por arquivo (49 mil linhas, lote 1.000): ~50 lotes × ~1 s = **~1 minuto**.
90 dias rodando file-by-file: ~90 minutos de trabalho de máquina (não seu).

## Checar progresso

Execução por execução, no Supabase:

```sql
-- Snapshots por dia
SELECT snapshot_date, COUNT(*) AS linhas
FROM supervisor_estoque_snapshots
WHERE origem = 'excel'
GROUP BY snapshot_date
ORDER BY snapshot_date DESC;

-- Quais filiais entraram
SELECT DISTINCT filial_cod, filial
FROM supervisor_estoque_snapshots
ORDER BY filial_cod;

-- Quantos dias já cobertos
SELECT MIN(snapshot_date), MAX(snapshot_date), COUNT(DISTINCT snapshot_date) AS dias
FROM supervisor_estoque_snapshots
WHERE origem = 'excel';
```

## Quando parar

Quando `MAX(snapshot_date)` chegar a **D-1** do dia atual, pare a ingestão
manual. O workflow `supervisor_estoque_diario` (n8n) assume daí em diante,
gravando com `origem='api'`.

## Erros comuns

| Mensagem | Causa provável |
|---|---|
| `Arquivo não encontrado` | Caminho UNC errado ou compartilhamento não montado. Testa um `dir "\\192.168.118.90\shared_path\historico_grade\"` antes. |
| `SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes` | `backend/.env` não tem as duas vars. |
| `Não foi possível inferir a data` | Nome do arquivo não bate com `arquivo-gerado-DD-MM-AAAA-...`. Passe `--date YYYY-MM-DD`. |
| Erro do RPC com `null value in column "snapshot_date"` | A planilha está vazia ou só com headers. Confira com `--dry-run`. |
