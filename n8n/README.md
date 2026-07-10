# Workflows n8n — Plataforma de Agentes

**Arquitetura:** o n8n hospedado na VPS Hostinger conversa **APENAS** com
Supabase e Firestore (ambos em cloud). Não tem comunicação direta com o
backend local — o backend roda o sync por conta própria via cron interno
(variável `SYNC_CRON` no `.env`), grava tudo no Supabase, e o n8n consome
de lá.

## Decisões em vigor (2026-05-13)

- **Sync** é responsabilidade do **backend** (cron interno `0 */1 * * *`).
- **n8n** dispara notificações com base no que está no Supabase + Firestore.
- **Fase 1:** só WhatsApp. E-mail entra na fase 2 com provedor a definir.
- **Filtro `agentes`:** notificação só vai para usuários com o slug do agente
  em `users/{email}.agentes` no Firestore. Default (campo ausente ou vazio) = não recebe.
- **Fonte de contatos:** `whatsapp` e `email_notificacao` vivem no Firestore.

## Credenciais necessárias no n8n

| Tipo | Como criar |
|---|---|
| **Supabase** (HTTP/Postgres) | Credentials → New → Supabase. Usar `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (a mesma do backend). |
| **Firestore** (Google Service Account) | Credentials → New → Google Service Account. Usar o JSON da service account `preco-b17ba`. |
| **Z-API / Evolution** | Credenciais HTTP genéricas com o token. |

## Variáveis n8n (Settings → Variables)

| Nome | Valor |
|---|---|
| `APP_URL_LISTA` | `http://margem.interno/agente/margem` (link no WhatsApp/e-mail) |
| `ZAPI_INSTANCE`, `ZAPI_TOKEN` | (ou `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`) |

## Workflow B — `resumo-diario-comprador` (08:00 seg-sáb)

Sai um WhatsApp por comprador com `agentes.includes('margem')` e pendentes > 0.

```
[Cron 0 8 * * 1-6]
    ↓
[Firebase Get All]  collection: users
    ↓
[Function]  filtra:
              doc.funcao === 'comprador'
              && Array.isArray(doc.agentes) && doc.agentes.includes('margem')
              && doc.whatsapp && doc.whatsapp !== '0'
    ↓
[SplitInBatches]
    ↓
[Supabase Query]
    select usuario_id, usuario_nome, pendentes
      from vw_margem_resumo_por_responsavel
     where lower(usuario_email_login) = lower({{$json.id}})
       and pendentes > 0
       and usuario_papel = 'comprador'
    ↓
[IF] linha encontrada (pendentes > 0)
    ↓ true
[Function]  monta texto:
            "Olá, *{{nome}}*!\nVocê tem *{{pendentes}}* produto(s) com margem
             negativa aguardando ciência.\nAcesse: {{APP_URL_LISTA}}"
    ↓
[HTTP POST]  Z-API/Evolution send-text
            { phone: doc.whatsapp, message: texto }
    ↓
[Supabase Insert]  notificacoes_log
            { agente_id, destinatario_id, tipo:'resumo_diario_comprador',
              canal:'whatsapp', destino: doc.whatsapp, sucesso, payload }
```

## Workflow C — `resumo-diario-agregado` (08:30 seg-sáb)

Sai um WhatsApp por diretor/supervisor com `agentes.includes('margem')`.

```
[Cron 30 8 * * 1-6]
    ↓
[Firebase Get All]  collection: users
    ↓
[Function]  filtra:
              ['diretor','supervisor'].includes(doc.funcao)
              && Array.isArray(doc.agentes) && doc.agentes.includes('margem')
              && doc.whatsapp && doc.whatsapp !== '0'
    ↓
[Loop]
    ↓
[Supabase Query]
    select usuario_nome, papel, pendentes, cientes, total
      from vw_margem_resumo_por_responsavel
     order by pendentes desc
     limit 10
    ↓
[Function]  monta texto consolidado (top 5 por pendentes + soma total)
    ↓
[HTTP POST]  Z-API/Evolution send-text
    ↓
[Supabase Insert]  notificacoes_log (canal='whatsapp', tipo='resumo_agregado')
```

## Workflow D — `expira-ciencia` (00:00 diário)

```
[Cron 0 0 * * *]
    ↓
[Supabase SQL]
   update margem_produtos
      set status           = 'pendente',
          motivo           = null,
          observacao       = null,
          data_fim_ciencia = null,
          ciencia_por_id   = null,
          checked_at       = null
    where status = 'ciente'
      and data_fim_ciencia < current_date;
```

## Workflow E (opcional) — `escalonamento-3-dias`

Se um produto está `pendente` há mais de 3 dias, pinga o diretor.

```
[Cron 0 9 * * 1-6]
    ↓
[Supabase Query]
   select p.codigo_produto, p.descricao_produto, u.nome as comprador,
          extract(day from now() - p.primeira_deteccao) as dias_aberto
     from margem_produtos p
     join margem_produto_compradores mc on mc.produto_id = p.id
     join usuarios u on u.id = mc.usuario_id
    where p.status = 'pendente'
      and (p.dt_fim_promocao is null or p.dt_fim_promocao >= current_date)
      and p.primeira_deteccao < now() - interval '3 days'
    order by dias_aberto desc;
    ↓
[Firebase Get]  diretores com agentes includes 'margem'
    ↓
[HTTP POST Z-API]  alerta consolidado com lista
```

## Agente `metas`

### Workflow B' — `metas - resumo diario` (08:00 seg-sáb)

Um único workflow cobre os três tipos de destinatário (decisão 2026-05-18).
Igual ao margem, **não chama o backend** — busca tudo cloud-to-cloud
(Firestore + Supabase). A regra de visibilidade fica num nó `Code` dentro
do próprio workflow.

**Destinatários (filtrados no nó `Filtrar destinatários`):**

- `funcao in ('diretor','supervisor','gerente')`
- `agentes` contém `'metas'`
- `whatsapp` válido

**Origem dos dados:** dois nós em paralelo já no workflow:

1. `Firestore: users` → traz todos os usuários (e o campo `loja` de cada)
2. `Supabase: resumo (todas filiais)` → traz tudo da view
   `vw_metas_resumo_por_filial` (small dataset — ~6 filiais)

**Resolver visibilidade (Code)** cruza os dois e devolve `1 item por usuário` com:

```json
{
  "email_login":"...", "nome":"...", "whatsapp":"...", "funcao":"...",
  "wildcard": true|false,
  "filiais": ["305","306"],
  "resumo": [ {filial_cod:"305", ...}, ... ]   // já filtrado
}
```

**Regra de visibilidade** (vive 100% em `users/{email}.loja` no Firestore):

| `loja` no Firestore                | Resultado                |
|---|---|
| `"todas"` (string)                 | wildcard — vê tudo       |
| `["todas"]` ou `["x","todas"]`     | wildcard — vê tudo       |
| `["305 - ELETRO ...", "306 - ..."]`| filtra pelas filiais     |
| `"305"`                            | filtra pela 305          |
| ausente / vazio                    | não vê nada              |

Vale para todos os papéis — diretor sem `"todas"` só vê o que tiver em `loja`.

**Condição de envio (nó `Tem filial em risco?`):** ao menos 1 filial com
loja, setor, departamento ou seção em risco. Sem risco → não envia
(decisão 2026-05-18: não encher o saco em dia tranquilo).

**Mensagem (nó `Montar mensagem`) — branch por `wildcard`:**

- **wildcard=true (diretor / supervisor)** — TOP 3 piores por % atingido:

  ```
  Olá, *Wanderson*!

  Acompanhamento de *metas* — TOP 3 filiais mais distantes da meta hoje:

  1º *300* — 53% atingido • tend. R$ 4M / meta R$ 4M • 5 setor(es) em risco
  2º *303* — 54% atingido • tend. R$ 5M / meta R$ 5M
  3º *305* — 55% atingido • tend. R$ 5M / meta R$ 5M • 2 dept(s) em risco

  Acesse: http://margem.interno/agente/metas
  ```

  Se houver só 1 ou 2 filiais em risco, o título adapta ("1 filial em
  risco hoje:" / "2 filiais em risco hoje:").

- **wildcard=false (gerente)** — sua(s) filial(is) em risco:

  ```
  Olá, *Fulano*!

  Acompanhamento de *metas* — sua filial:

  *305 - ELETRO BRASIL LTDA*
     Venda atual: R$ 2.8M
     Meta: R$ 5.1M
     Tendência: R$ 5.1M (55% atingido)
     ⚠ 2 dept(s) em risco
  ```

**Sem resumo agregado em workflow separado, sem expiração de ciência**
(o agente metas é informativo).

### Variáveis adicionais do n8n para o agente metas

| Nome | Valor exemplo |
|---|---|
| `APP_URL_METAS`     | `http://margem.interno/agente/metas` (link na mensagem) |

Sem necessidade de `METAS_BACKEND_URL` ou `SYNC_TOKEN` — n8n só fala com
Supabase + Firestore + Evolution.

### Sync do agente metas

Roda no **backend** via `METAS_SYNC_CRON` (default `0 4 * * *`, diário às 4h).
Não há workflow n8n para disparar — segue o padrão da plataforma de que
*sync é responsabilidade do backend*.

## Agente `comparativo313`

Diferente do metas, este agente roda em **3 workflows separados** — um por
papel — porque cada papel monta mensagem com escopo diferente (comprador
vê por seção, diretor por TOP filiais, gerente só suas lojas).

Provedor: **Evolution API** (igual aos outros). Sem expiração de ciência
(modelo informativo).

### Workflow B-comp313 — `resumo diario comprador` (09:00 seg-sáb)

Arquivo: `workflows/B_comp313_resumo-comprador.json`.

**Destinatários:** `funcao === 'comprador'`, `agentes` contém `'comparativo313'`, `whatsapp` válido.

**Fonte:** view `vw_comparativo313_resumo_responsavel` (1 linha por comprador,
agregando todas as filiais) + drill `vw_comparativo313_resumo_filial_comprador`
(quebra por filial das seções dele).

**Condição:** `rupturas_pendentes > 0`. Sem ruptura → não envia.

**Mensagem (exemplo):**

```
Olá, *Nayane*!

Resumo *Comparativo 313* — depósito 313 tem estoque que está em
falta na loja para as suas seções:

Você tem *47* ruptura(s) abertas em 4 filial(is).

Principais filiais com ruptura:
   • *302* — 18 ruptura(s)
   • *303* — 12 ruptura(s)
   • *305* — 10 ruptura(s)
   • *300* —  7 ruptura(s)

_Última detecção: 20/05/2026_

Acesse: http://margem.interno/agente/comparativo313
```

### Workflow C-comp313 — `resumo diario diretor/supervisor` (09:10 seg-sáb)

Arquivo: `workflows/C_comp313_resumo-diretor-supervisor.json`.

**Destinatários:** `funcao in ('diretor','supervisor')`, `agentes` contém `'comparativo313'`.

**Fonte:** view `vw_comparativo313_resumo_filial` (todas as filiais), com
o mesmo nó **`Resolver visibilidade`** do B_metas — respeita `users/{email}.loja`
(`"todas"` = ver tudo).

**Condição:** ao menos 1 filial do escopo com `rupturas_pendentes > 0`.

**Mensagem (exemplo):**

```
Olá, *Paulo*!

*Comparativo 313* — produtos faltando nas lojas com estoque no
depósito 313:

Total: *213* ruptura(s) em 6 filial(is) (4.812 unidades disponíveis
no depósito).

Quebra por filial:
   • *302* ELETRO BRASIL LTDA — 47 ruptura(s) • 1.230un no depósito
   • *303* ELETRO BRASIL LTDA — 41 ruptura(s) • 998un no depósito
   • ...

Acesse: http://margem.interno/agente/comparativo313
```

### Workflow D-comp313 — `resumo diario gerente` (09:15 seg-sáb)

Arquivo: `workflows/D_comp313_resumo-gerente.json`.

**Destinatários:** `funcao === 'gerente'`, `agentes` contém `'comparativo313'`,
`loja` preenchida no Firestore.

**Fonte:** mesma view `vw_comparativo313_resumo_filial`, filtrada pelas
filiais do `users/{email}.loja`.

**Mensagem (exemplo, gerente da 305):**

```
Olá, *Fulano*!

*Comparativo 313* — produtos faltando em sua loja com estoque no
depósito 313:

Total: *10* ruptura(s).

*305 - ELETRO BRASIL LTDA*
   • Rupturas pendentes: 10
   • Com estoque no depósito 313: 10
   • Estoque disponível: 234 un.

Acesse: http://margem.interno/agente/comparativo313
```

### Variáveis adicionais do n8n para o agente comparativo313

| Nome | Valor exemplo |
|---|---|
| `APP_URL_COMP313` | `http://margem.interno/agente/comparativo313` (link na mensagem; opcional — tem fallback no código) |

Reusa `EVOLUTION_URL`, `EVOLUTION_INSTANCE` e `EVOLUTION_KEY` já existentes.

### Sync do agente comparativo313

Roda no **backend** via `COMPARATIVO313_SYNC_CRON` (sugestão `15 4 * * *`,
diário às 04:15). Alternativa: agendador externo do Windows chamando
`scripts/run-comparativo313-sync.mjs` (POST autenticado no endpoint
`/agente/comparativo313/run`).

### Checklist de instalação dos 3 workflows

1. Anotar o UUID do agente: `select id from agentes where slug='comparativo313'`.
2. Importar `B_comp313_resumo-comprador.json`, `C_comp313_resumo-diretor-supervisor.json` e `D_comp313_resumo-gerente.json` no n8n.
3. Em cada workflow, trocar **3 placeholders** nos nós:
   - `TROCAR_PELO_ID_DA_SUA_CREDENCIAL_FIREBASE` → ID da credencial Firebase do n8n.
   - `TROCAR_PELO_ID_DA_SUA_CREDENCIAL_SUPABASE` → ID da credencial Supabase do n8n (a mesma usada nos outros agentes).
   - `TROCAR_PELO_UUID_DO_AGENTE_COMPARATIVO313` → UUID anotado no passo 1.
4. Settings → Variables: criar `APP_URL_COMP313` (opcional).
5. Em Firestore `users/{email}.agentes`, adicionar `'comparativo313'` para quem deve receber.
6. Garantir `users/{email}.loja` para gerentes (array de códigos como `["305"]`).
7. Disparar o workflow B manualmente uma vez (Execute workflow) e validar envio para um comprador-teste.
8. Ativar os 3 workflows (toggle `Active`).

## Padrão para futuros agentes

Quando entrar um novo agente (ex.: `vencimento`):

1. Duplicar workflows B/C/D com prefixo do slug.
2. Filtros do n8n trocam `agentes.includes('margem')` por `agentes.includes('vencimento')`.
3. Quem tem `agentes: ["margem"]` continua recebendo só do margem; quem tem `agentes: ["margem","vencimento"]` recebe dos dois.
4. As tabelas `notificacoes_log` e `agente_execucoes` já são compartilhadas — a coluna `agente_id` faz o discrime.
5. **O backend de cada agente roda seu próprio cron de sync** — n8n nunca dispara.
