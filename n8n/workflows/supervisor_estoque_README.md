# Agente "supervisor_estoque" — guia de instalação

Mesmo padrão dos agentes `margem`, `metas` e `comparativo313` já em produção no
projeto Supabase **`agentes`** (`mscbjlvcqyunuyswiaqr`).

## O que foi criado no Supabase

Aplicado via migrations — você não precisa rodar nada aqui.

**Tabelas**
- `supervisor_estoque_snapshots` — fato histórico, 1 linha por (data, filial, produto).
  Recebe Excel (Etapa 1) e API (Etapa 2). UNIQUE por (snapshot_date, filial_cod, codigo_produto).
- `supervisor_estoque_alertas` — alertas detectados por execução. UNIQUE por
  (snapshot_date, filial_cod, codigo_produto, metrica, direcao).
- `supervisor_estoque_produto_compradores` — join alerta ↔ comprador.

**Enums novos**
- `supest_metrica` (`media_dia`, `giro`, `dias_venda`)
- `supest_direcao` (`queda`, `aumento`)
- `supest_origem` (`excel`, `api`)
- `supest_status` (`pendente`, `ciente`, `resolvido`, `expirado`)

**Views (consumidas pelos workflows)**
- `vw_supervisor_estoque_resumo_filial` — diretor / supervisor / gerente
- `vw_supervisor_estoque_resumo_responsavel` — agregado por comprador
- `vw_supervisor_estoque_resumo_filial_comprador` — drill filial × comprador
- `vw_supervisor_estoque_top_alertas` — auxiliar para corpo das mensagens

**RPCs (chamadas pelos workflows)**
- `fn_supest_ingest_snapshots(p_origem, p_rows)` — upsert idempotente em lote
- `fn_supest_detect_alerts(p_snapshot_date, p_execucao_id, p_threshold_pct)`
- `fn_supest_atribuir_compradores(p_snapshot_date)`
- Helpers: `fn_supest_to_numeric` (PT-BR `1.234,56`), `fn_supest_to_int`,
  `fn_supest_to_date_br` (`dd/mm/aaaa`), `fn_supest_parse_filename_date`.

**Agente registrado** em `public.agentes` (slug `supervisor_estoque`) e
**vinculado** a todos os usuários ativos (diretor / supervisor / gerente / comprador).

## Workflows n8n para importar

Dois arquivos JSON neste diretório. Em cada um: no editor n8n vá em
**"Workflows" → "+" → "Import from File"** → selecione o JSON.

### 1) `supervisor_estoque_ingestao_historica.json` (Etapa 1)

**Como funciona:** form com upload de arquivo. Você joga uma planilha
`arquivo-gerado-DD-MM-AAAA-HH-MM-SS.xlsx`, ele extrai a data do nome,
parseia, e chama `fn_supest_ingest_snapshots('excel', rows)` em lotes
de 1.000 linhas. Idempotente — pode reenviar o mesmo arquivo.

**Como usar:** uma execução por dia de histórico, até alcançar o dia atual.
Depois disso só o workflow #2 roda.

### 2) `supervisor_estoque_diario.json` (Etapa 2)

**Como funciona:** cron `0 7 * * *`. Chama
`http://192.168.118.50:3001/api/produtos`, upserta snapshots com
origem='api', detecta variações ≥ 20% vs média móvel 7d em
`media_dia` / `dias_venda` / `giro`, atribui compradores por
`chave_secao`, e envia WhatsApp via Evolution para diretor/supervisor
(resumo geral), gerente (suas filiais) e comprador (suas seções).

## Pré-requisitos no n8n

### Variáveis de ambiente

```
SUPABASE_URL                 = https://mscbjlvcqyunuyswiaqr.supabase.co
SUPABASE_SERVICE_ROLE_KEY    = <service_role key do projeto agentes>
EVOLUTION_URL                = (já usado pelos outros workflows)
EVOLUTION_INSTANCE           = (já usado pelos outros workflows)
EVOLUTION_KEY                = (já usado pelos outros workflows)
APP_URL_SUPEST               = http://app.interno/agente/supervisor_estoque   (opcional)
```

> O workflow #2 também usa o nó **Supabase** nativo do n8n para escrever em
> `agente_execucoes` e `notificacoes_log`. Garanta que a credencial Supabase
> usada por margem/313 esteja anexada nesses nós após importar.

### Credenciais a anexar nos nós (após import)

- Nós Supabase → escolha a mesma credencial usada nos agentes existentes.
- Nó **Firestore: users** → escolha a credencial do Google Firebase do projeto
  `preco-b17ba` (mesma usada por `comparativo313`).

## Atribuição comprador → seção

Reaproveita o mapeamento já existente em `margem_produto_compradores`. Quando
detecta um alerta com `chave_secao`, busca os compradores responsáveis por
aquela seção em `margem_produtos` e cria o vínculo em
`supervisor_estoque_produto_compradores`.

Se uma seção for nova e nenhum comprador estiver mapeado, o alerta existe
mas não é entregue a nenhum comprador (só aparece no resumo do diretor /
supervisor / gerente).

## Detecção de alertas — regras

- Janela: 7 dias anteriores ao snapshot
- Mínimo de 3 snapshots na janela (senão "sem baseline")
- Métricas: `media_dia`, `dias_venda`, `giro`
- Pisos para evitar ruído com valores pequenos:
  - `media_dia` baseline ≥ 0,5
  - `dias_venda` baseline ≥ 1
  - `giro` `|baseline|` ≥ 0,5
- Variação: `(atual - baseline) / |baseline| × 100` (sinal correto mesmo
  com baseline negativo)
- Threshold default: 20 % (parâmetro `p_threshold_pct`)

## Teste rápido

1. Importe os 2 workflows.
2. Configure env vars + credenciais.
3. Rode o workflow Etapa 1 manualmente com 3+ planilhas de dias diferentes.
4. Rode o workflow Etapa 2 em modo **manual** (não publique ainda) e veja
   se gera linhas em `supervisor_estoque_alertas`.
5. Quando estiver feliz, ative o cron do Etapa 2.

## Consultas úteis no Supabase

```sql
-- Quantos snapshots por origem e dia
SELECT origem, snapshot_date, COUNT(*) AS rows
FROM supervisor_estoque_snapshots
GROUP BY 1,2 ORDER BY 2 DESC, 1;

-- Alertas de hoje, por métrica
SELECT metrica, direcao, COUNT(*) AS n
FROM supervisor_estoque_alertas
WHERE snapshot_date = CURRENT_DATE
GROUP BY 1,2 ORDER BY 1,2;

-- Execuções recentes do agente
SELECT started_at, finished_at, status, metricas
FROM agente_execucoes
WHERE agente_id = (SELECT id FROM agentes WHERE slug='supervisor_estoque')
ORDER BY started_at DESC LIMIT 10;
```
