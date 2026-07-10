# Planejamento — Plataforma de Agentes (Agente: Margem Negativa)

> **Plataforma multi-agente** onde cada agente automatiza uma rotina interna do supermercado. O primeiro agente é o **margem** (Margem Negativa). Outros virão (ex.: vencimento, ruptura, mix de loja). A plataforma compartilha autenticação, dashboard inicial, base de dados e mecanismo de notificação.
>
> Este documento detalha a plataforma e o agente `margem` em conjunto. Quando um novo agente entrar, abrimos uma seção §12, §13... mantendo as seções 1–11 como núcleo da plataforma.

**Stack escolhida:** Node.js (Express) + React (Vite) + Supabase + Firebase Auth/Firestore + n8n.
**Hospedagem:** servidor interno na rede local (mesma rede da API `192.168.118.50:3001`).
**Auth:** Firebase Auth (Google) com domínio corporativo restrito.
**Notificações (fase 1):** **WhatsApp apenas** (Z-API ou Evolution API). E-mail será adicionado em fase 2 quando provedor estiver definido.

### Distribuição de dados de usuário

- **Firestore `users/{email_login}`** é a fonte de verdade do cadastro: `nome`, `funcao` (`comprador` | `diretor` | ...), `whatsapp`, `email_notificacao` (opcional, para fase 2), `comprador` (uppercase, casa com lista oficial), `agentes` (array de slugs — controla notificação).
- **Supabase `usuarios`** guarda só o necessário pra FKs e auth: `id` (uuid), `email_login`, `nome`, `papel`, `ativo`, `firebase_uid`. Não tem mais `whatsapp` nem `email_notificacao`.
- **N8n** consulta os dois: pega lista de pendentes + ids no Supabase, pega contatos + flag `agentes` no Firestore.

### Flag `agentes` por usuário (controle de notificação)

Campo `agentes` é um **array de slugs** dos agentes que aquele usuário deve receber notificação push. Default (campo ausente ou vazio) = **não recebe**. Habilita explicitamente:

```
users/silvania@max.com
  agentes: ["margem"]               // recebe push só do agente margem
  whatsapp: "5511..."

users/diretor@max.com
  agentes: ["margem"]
  funcao: "diretor"
```

A flag controla **somente** o canal proativo (e-mail/WhatsApp via n8n). Não afeta:
- Login no app (qualquer usuário ativo cadastrado em `usuarios` consegue entrar)
- Visibilidade dos produtos no app (RLS continua usando o vínculo N:N)
- Atribuição automática no sync (`margem_produto_compradores` é populada normalmente)

Estratégia inicial: habilitar **2 usuários para teste** (1 comprador + 1 diretor) e expandir depois.

---

## 0. Plataforma de Agentes

### 0.1 Conceito

A plataforma é um portal interno onde cada **agente** representa uma automação independente. O agente `margem` é o primeiro caso de uso, mas a arquitetura precisa acomodar futuros agentes sem refazer fundação.

Princípios:

- **Cada agente é uma rotina autônoma** com seu próprio fluxo, banco (tabelas com prefixo) e workflows n8n. O backend Node hospeda todos como módulos separados.
- **Card-driven dashboard** na home: o usuário vê grade de cards, um por agente, com nome, status, data/hora da última execução e botão `info`.
- **Cadastro central** no Supabase (tabela `agentes`) que governa metadata, descrição e estado.
- **Permissões granulares**: cada agente pode ter compradores ou perfis específicos. A tabela `compradores` vira `usuarios`, com vínculo N:N a `agentes` via `agente_usuario`.
- **Observabilidade unificada**: tabela `agente_execucoes` substitui o `sync_logs` específico de margem. Toda execução (qualquer agente) registra início, fim, status e métricas em formato livre (`metricas jsonb`).

### 0.2 Anatomia de um agente

Cada agente tem:

| Componente | Responsabilidade |
|---|---|
| Slug (`margem`, `vencimento`, ...) | Identificador único, usado na URL e nas tabelas. |
| Card no dashboard | Nome, ícone, descrição curta, status, última execução, botão `info`. |
| Modal `info` | Descrição completa, atribuições, frequência, fontes de dados, contatos. |
| Rotas dedicadas | `/agente/{slug}/...` |
| Tabelas de domínio | Prefixadas pelo slug (ex.: `margem_produtos`, `margem_ciencias`). |
| Workflows n8n | Tags com o slug pra organização. |
| Job de execução | Endpoint `POST /agente/{slug}/run` protegido por `X-Sync-Token`. |

### 0.3 Dashboard (home da plataforma)

```
┌──────────────────────────────────────────────────────────────────┐
│  Plataforma de Agentes — Supermercado                  Wanderson│
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌────────────────────┐  ┌────────────────────┐  ┌─────────────┐│
│  │ 📉  Margem        │  │ ⏳  Vencimento    │  │ +  Novo    ││
│  │     Negativa  (i)  │  │  (em breve)   (i)  │  │  agente    ││
│  │                    │  │                    │  └─────────────┘│
│  │  37 pendentes      │  │  —                 │                  │
│  │  Última: 30/04     │  │                    │                  │
│  │         14:23       │  │                    │                  │
│  │  ✓ OK              │  │                    │                  │
│  └────────────────────┘  └────────────────────┘                  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

Estados possíveis no card:
- ✅ **OK** — última execução com sucesso, nada urgente.
- ⚠️ **Atenção** — backlog acima do threshold (ex.: `pendentes >= 20`).
- 🔴 **Erro** — última execução falhou.
- 🕒 **Rodando** — execução em andamento.
- 💤 **Inativo** — agente cadastrado mas desligado.

### 0.4 Modal `info`

Acionado pelo ícone `(i)` no card. Estrutura padronizada:

- **O que faz**: parágrafo curto.
- **Atribuições**: lista do que o agente entrega (resumo diário, notificações, dashboard, etc.).
- **Fontes de dados**: APIs/coleções/serviços externos que ele consulta.
- **Frequência**: cron(s) atual(is).
- **Responsável técnico**: nome + e-mail.
- **Documentação**: link pro `planejamento.md` ou `docs/agente-{slug}.md`.

Para o agente `margem`, o conteúdo do modal vem da tabela `agentes` (campo `info_md` em Markdown), permitindo edição sem deploy.

### 0.5 Como adicionar um novo agente no futuro

Checklist (vai virar `docs/como-criar-um-agente.md`):

1. Definir slug e cadastrar linha em `agentes` no Supabase.
2. Criar migration com tabelas `{slug}_*` necessárias.
3. Criar pasta `backend/src/agentes/{slug}/` com `routes`, `services`, `jobs`.
4. Registrar o módulo em `backend/src/agentes/index.js` (lista plug-and-play).
5. Criar página `frontend/src/agentes/{slug}/Index.jsx` e rotas filhas.
6. Criar workflows n8n com tag `agente:{slug}`.
7. Adicionar entrada no menu/dashboard (automático via tabela `agentes`).

---

## 1. Visão geral da arquitetura

> **Decisão 2026-05-13:** o backend roda o ciclo de sync por conta própria
> (cron interno) e grava direto no Supabase. O n8n hospedado na VPS Hostinger
> conversa **apenas** com Supabase e Firestore — nunca com o backend local.
> Isso elimina a necessidade de túneis, IP público ou exposição da intranet.

```
INTRANET DO SUPERMERCADO              CLOUD             VPS HOSTINGER
┌─────────────────────────────┐      ┌────────┐         ┌──────────────┐
│ API local 192.168.118.50    │      │Supabase│         │ n8n          │
│   ↑                         │   ┌──┤ (DB)   ├──┐      │  ↓           │
│ Backend Node :3000          │   │  └────────┘  │      │  ├─ lê DB    │
│   • node-cron 0 */1 * * *   │───┤              ├──────┼──┤            │
│   • escreve direto p/ DB    │   │  ┌────────┐  │      │  ├─ lê Fbase│
│ Frontend :5173 ─────────────┤   └──┤Firestore├──┘      │  └─ WhatsApp │
│ Login Firebase Email/Pwd    │      └────────┘         └──────────────┘
└─────────────────────────────┘
```

### 1.1 Fluxo principal (resumido)

1. **Backend** dispara seu próprio ciclo a cada hora via `node-cron` (variável
   `SYNC_CRON=0 */1 * * *`). Sem necessidade de chamada externa.
2. **Backend** consulta API local `http://192.168.118.50:3001/api/margem`
   e filtra `tipo_margem === "negativa"`.
3. Para cada produto, normaliza `SECAOPRICE` (ex.: `"35 - CAMA E MESA"`) e busca
   o campo correspondente em `CONFIG/1-SECAO` do Firestore.
4. Identifica os compradores válidos (`comprador`, `comprador2`, `comprador3`
   que não sejam `"sem comprador"` e que constem em `RESPONSAVEIS_OFICIAIS`).
5. **Upsert** em `margem_produtos` com chave `(filial, codigo_produto)`.
   Reconcilia a N:N em `margem_produto_compradores`.
6. Backend atualiza `agentes.ultima_execucao_at` e `pendentes_total`,
   e grava o resultado em `agente_execucoes`.
7. **Frontend** (rodando local) consulta o backend, que valida o ID Token
   Firebase e aplica RLS via service_role. Comprador vê só os seus.
8. **n8n** (na VPS Hostinger) roda 3 workflows diários — todos consultam
   apenas Supabase e Firestore (sem precisar do backend):
   - 08:00 — resumo para cada comprador habilitado (filtro `agentes` no Firestore)
   - 08:30 — resumo agregado para diretores/supervisores habilitados
   - 00:00 — expira ciências cujo `data_fim_ciencia` já passou

---

## 2. Modelo de dados (Supabase)

> **Mudança de nomes para a plataforma multi-agente** (substitui o draft do
> arquivo `0001_initial_schema.sql`):
> - `compradores` → `usuarios`
> - `sync_logs` → `agente_execucoes`
> - tabelas de domínio do margem ganham prefixo `margem_`
> A migration 0001 será reescrita antes de aplicar (aguardando seu OK).

### 2.1 Tabelas (núcleo da plataforma)

```
agentes                     1 ─── N  agente_execucoes
   │ N                                  │ N
   │                                    ▼
   ▼ N                              (logs por agente, qualquer slug)
agente_usuario  N ─── 1  usuarios

notificacoes_log      (logs de envio do n8n, com agente_id)
```

### 2.2 Tabelas (domínio do agente "margem")

```
margem_produtos       N ─── N  usuarios          (compradores)
       │              via margem_produto_compradores
       │
       │ 1
       ▼ N
margem_ciencias       (histórico de ciências dadas pelos compradores)
```

**Por que N:N (e não FK simples).** A regra de negócio (definida em
2026-04-30): uma seção pode ter até 3 compradores (`comprador`,
`comprador2`, `comprador3` no Firestore) e **todos atuam no dia a dia
— o primeiro que ver o produto resolve**. Logo, todos devem ser
notificados, todos devem ver o produto na lista, e a ciência de
qualquer um remove o produto da lista de todos.

### 2.3 Resumo das tabelas

**Núcleo da plataforma:**

- **agentes**: `id`, `slug` ("margem"), `nome`, `descricao_curta`, `info_md`, `icone`, `cor`, `ativo`, `ultima_execucao_at`, `ultima_execucao_status`, `pendentes_total` (atualizado pelo job), `threshold_atencao`, `criado_em`.
- **usuarios**: cadastro humano (era `compradores`). Estrutura mínima: `id`, `nome`, `email_login`, `papel` (`comprador` | `diretor` | `supervisor` | `admin`), `firebase_uid`, `ativo`. Whatsapp e email_notificacao ficam no Firestore. Vai além do agente margem — usado em todos.
- **agente_usuario**: vínculo N:N entre agente e usuário, com campo `papel_no_agente` opcional pra granular (ex.: alguém é "comprador" no margem mas "observador" em outro).
- **agente_execucoes**: cada run de qualquer agente. `agente_id` FK, `started_at`, `finished_at`, `status` (`sucesso` | `parcial` | `erro` | `rodando`), `metricas jsonb` (campos livres por agente — `inseridos`, `atualizados`, `pendentes`, etc.).
- **notificacoes_log**: ganha coluna `agente_id`. Resto igual.

**Agente margem:**

- **margem_produtos**: snapshot do produto. `(filial, codigo_produto)` UNIQUE, status (`pendente` | `ciente` | `expirado` | `resolvido`), todos os campos da API local. **Não tem mais `usuario_id` direto** — vínculo com compradores vai pra tabela N:N abaixo. Mantém `chave_secao` (ex.: "35 - CAMA E MESA") para rastreabilidade e `motivo_atribuicao` (`ok` | `secao_inexistente` | `sem_comprador_valido` | `secao_invalida`) para o admin auditar atribuições problemáticas.
- **margem_produto_compradores** (N:N): `produto_id` (FK) + `usuario_id` (FK) + `papel_atribuicao` (`principal` | `secundario` | `terciario` — preserva a ordem do Firebase) + `criado_em`. PK composta. Quando o sync detecta mudança no Firebase (alguém entrou/saiu da seção), insere/atualiza/remove linhas aqui.
- **margem_ciencias**: histórico. `produto_id`, `usuario_id` (quem deu a ciência), `motivo`, `observacao`, `data_fim_ciencia`, `vlr_venda_no_momento`, `margem_no_momento`, `created_at`. **A ciência atualiza o status do PRODUTO** (não da atribuição) — quando alguém marca, sai da lista de todos os co-responsáveis.

### 2.3 RLS (Row Level Security)

- Comprador (`papel = 'comprador'`) lê apenas `produtos_margem_negativa` cujo `comprador_id = auth.uid()` (mapeado por e-mail).
- Diretor lê tudo. Admin escreve tudo.
- Backend usa `service_role` para ignorar RLS nas operações de sync.
- Frontend usa o token Firebase trocado por uma sessão Supabase via custom JWT (ou simplesmente passa pelo backend).

---

## 3. Backend — Node.js + Express

### 3.1 Estrutura de pastas

```
backend/
├── src/
│   ├── server.js                      # entrypoint
│   ├── config/
│   │   ├── env.js                     # validação dotenv
│   │   └── logger.js                  # pino
│   ├── routes/
│   │   ├── products.routes.js         # /api/products/*
│   │   ├── ciencia.routes.js          # /api/ciencia
│   │   ├── stats.routes.js            # /api/stats/director
│   │   └── sync.routes.js             # /sync/run (protegido por token)
│   ├── services/
│   │   ├── localApi.service.js        # axios -> 192.168.118.50:3001
│   │   ├── firebase.service.js        # firebase-admin (Firestore + Auth)
│   │   ├── supabase.service.js        # @supabase/supabase-js (service_role)
│   │   ├── buyerMapper.service.js     # SECAOPRICE -> comprador
│   │   └── syncJob.service.js         # orquestra sync
│   ├── middleware/
│   │   ├── authFirebase.js            # verifyIdToken
│   │   ├── requirePapel.js            # comprador|diretor|admin
│   │   └── errorHandler.js
│   ├── utils/
│   │   ├── parseProduct.js            # "505646 - CAPA..." -> {codigo, nome}
│   │   ├── parseSecao.js              # "1 - LEITES..." -> doc id "1-SECAO"
│   │   └── parseCurrency.js           # "58,90" -> 58.90
│   └── jobs/
│       └── syncCron.js                # node-cron, fallback se n8n falhar
├── tests/
│   └── parseProduct.spec.js
├── .env.example
├── package.json
└── README.md
```

### 3.2 Endpoints REST

**Plataforma (núcleo):**

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| `GET` | `/api/health` | público | Healthcheck. |
| `GET` | `/api/me` | Firebase ID token | Perfil do usuário logado (papel, nome, usuario_id). Usado pelo frontend pra UIs condicionais. |
| `GET` | `/api/agentes` | Firebase ID token | Lista todos os agentes com status e última execução (alimenta o dashboard). |
| `GET` | `/api/agentes/:slug` | Firebase ID token | Detalhe + `info_md` para o modal `(i)`. |

**Agente margem:**

| Método | Rota | Auth | Descrição |
|---|---|---|---|
| `POST` | `/agente/margem/run` | `X-Sync-Token` | Dispara sincronização. **Uso interno/manual** — em produção o cron interno do backend dispara sozinho; este endpoint serve pra forçar run manual ou pra futura integração. |
| `GET` | `/agente/margem/produtos` | Firebase ID token | Lista produtos do comprador autenticado. Filtros: `status`, `secao`, `q`. |
| `GET` | `/agente/margem/produtos/:id` | Firebase ID token | Detalhe + histórico de ciência. |
| `POST` | `/agente/margem/produtos/:id/ciencia` | Firebase ID token | Body: `{ motivo, observacao, data_fim_ciencia }`. |
| `PATCH` | `/agente/margem/produtos/:id/ciencia` | Firebase ID token | Atualiza ciência vigente. |
| `GET` | `/agente/margem/stats/diretor` | diretor / supervisor / admin | Agregação por responsável (consome `vw_margem_resumo_por_responsavel`). |
| `GET` | `/agente/margem/stats/comprador/:id` | n8n / diretor / supervisor / admin | Resumo individual para o n8n. |

### 3.3 Algoritmo de mapeamento comprador (`buyerMapper.service.js`)

> **Estrutura real do Firestore validada em 2026-04-30** com o usuário:
> existe **um único documento** `CONFIG/1-SECAO` que contém **TODAS as
> seções** (de qualquer número) como campos. O nome `1-SECAO` é só o
> identificador desse doc, não um padrão de agrupamento.

Exemplo (recortado) do conteúdo de `CONFIG/1-SECAO`:

```json
{
  "1 - LEITES E ALIMENTOS INFANTIS":   { "comprador": "...", "comprador2": "MARIA CLARA", ... },
  "35 - CAMA E MESA":                   { "comprador": "...", ... },
  "1227 - KARDEX":                      { "comprador": "SILVANIA RODRIGUES", ... },
  "1517 - CHOCOLATES REFRIGERADOS":     { "comprador": "SILVANIA RODRIGUES", "comprador2": "TEREZA OLIVEIRA", ... },
  "1530 - ACESSORIOS PET SHOP":         { "comprador": "CLEILDE FONSECA", ... },
  "1589 - PILHAS E BATERIAS":           { "comprador": "SILVANIA RODRIGUES", "comprador2": "TEREZE OLIVEIRA", ... },
  "1615 - HIGIENE/BELEZA":              { "comprador": "CLEILDE FONSECA", ... }
}
```

Algoritmo (devolve **lista** de compradores, conforme regra N:N):

```
1. Carregar 1x por sync: configCache = firestore.collection("CONFIG").doc("1-SECAO").get().data()
2. Para cada produto da API local:
   a. chave = produto.SECAOPRICE.trim()           // "35 - CAMA E MESA"
   b. secaoConfig = configCache[chave]
   c. Se !secaoConfig: motivo='secao_inexistente', compradores=[]
   d. compradores = []
      Para cada slot em [{papel:'principal', valor:secaoConfig.comprador},
                          {papel:'secundario', valor:secaoConfig.comprador2},
                          {papel:'terciario', valor:secaoConfig.comprador3}]:
        - se valor !== "sem comprador" e valor.toUpperCase() pertence à lista oficial:
            compradores.push({nome: valor.toUpperCase(), papel})
   e. motivo = compradores.length ? 'ok' : 'sem_comprador_valido'
3. Para cada produto:
   - upsert em margem_produtos
   - reconciliar margem_produto_compradores: inserir os novos, manter os iguais,
     remover os que sumiram do Firebase desde o último sync
```

> **Sincronização das atribuições.** Se a SILVANIA sai do Firebase como
> `comprador2` da seção "1517 - CHOCOLATES" e a TEREZA entra no lugar,
> o sync remove a linha (produto_id, silvania.id) e insere
> (produto_id, tereza.id) — para todos os produtos dessa seção que
> ainda estão `pendente`. **Produtos com status `ciente` não recebem
> reatribuição** (já estão silenciados até a data fim).

> 🐛 **Erro de digitação detectado durante a validação**: na seção
> `1589 - PILHAS E BATERIAS`, o `comprador2` está como **"TEREZE OLIVEIRA"**
> (com E no final), enquanto a lista oficial tem **"TEREZA OLIVEIRA"** (com A).
> Como nosso matcher exige nome exato (uppercase + lista oficial), essa
> seção cairá em `sem_comprador_valido`. **Recomendado corrigir o doc no
> Firebase**. Os "motivos" do `resolveComprador` foram desenhados pra
> registrar essas falhas em `sync_logs.metadata` e expor no dashboard do
> diretor.

### 3.4 Cache do Firestore

Para evitar custo (cada produto bate 1 vez): carregar todo `CONFIG/*` em memória no início do job de sync (TTL de 1h). Cerca de 100-200 documentos — barato e veloz.

### 3.5 Tratamento de produtos que saíram da lista

Após cada sync, marcar como `resolvido` os produtos que **não vieram** no array atual mas estavam `pendente` no Supabase.

---

## 4. Frontend — React + Vite + Tailwind

### 4.1 Estrutura

```
frontend/
├── src/
│   ├── main.jsx
│   ├── App.jsx
│   ├── routes.jsx                       # react-router
│   ├── lib/
│   │   ├── firebase.js                  # init Firebase Auth
│   │   ├── api.js                       # axios com interceptor de token
│   │   └── format.js
│   ├── pages/
│   │   ├── Login.jsx                    # botão Login com Google
│   │   └── Dashboard.jsx                # grid de AgentCards (home)
│   ├── components/
│   │   ├── AgentCard.jsx                # card com nome, status, última execução
│   │   ├── AgentInfoModal.jsx           # modal (i) com descrição/atribuições
│   │   ├── StatusBadge.jsx
│   │   └── ConfirmDialog.jsx
│   ├── agentes/                         # um diretório por agente
│   │   └── margem/
│   │       ├── index.jsx                # layout + tabs internas
│   │       ├── ListaProdutos.jsx
│   │       ├── DetalheProduto.jsx
│   │       ├── DashboardDiretor.jsx
│   │       ├── CienciaModal.jsx
│   │       └── components/
│   │           ├── ProductTable.jsx
│   │           └── FilterBar.jsx
│   ├── hooks/
│   │   ├── useAuth.js
│   │   ├── useAgentes.js                # lista global de agentes
│   │   └── useMargemProdutos.js
│   └── styles/index.css
├── public/
├── .env.example
├── tailwind.config.js
├── vite.config.js
└── package.json
```

### 4.2 Telas

**Login:** botão "Entrar com Google". Restringe domínios autorizados via Firebase Authorized domains + custom claim no backend (papel).

**Dashboard (home da plataforma):**
- Header com nome do usuário + logout.
- Grid responsivo de **AgentCards** (carregados de `GET /api/agentes`).
- Cada `AgentCard` exibe: ícone + nome + descrição curta + status colorido + "Última execução: 30/04 14:23" + botão `(i)` info.
- Click no card → `/agente/{slug}`.
- Botão `(i)` → modal `AgentInfoModal` renderizando `info_md` (markdown).

**`/agente/margem` — home do agente margem:**
- Tabs internas: **Lista** (default p/ comprador) | **Diretor** (papel=diretor).
- Botão "Forçar sincronização" (papel=admin/diretor) → `POST /agente/margem/run`.

**`/agente/margem/lista` — ListaProdutos:** tabela com colunas `Produto`, `Filial`, `Seção`, `Vlr Venda`, `Custo`, `Margem`, `Estoque`, `Dt Fim Promo`, `Compartilhado com`, `Status`, `Ação`. Filtros: status (default = pendente), seção, busca textual. Botão "Dar ciência" abre `CienciaModal`. A coluna **Compartilhado com** mostra os outros co-responsáveis daquele produto (chips com nome) — deixa explícito que outra pessoa também pode resolver.

**`CienciaModal`:**
- Motivo (radio): Vencimento / Estoque parado / Descontinuidade / Erro de cadastro / Outro
- Observação (textarea, obrigatória)
- Data fim do preço vigente (date picker, obrigatória, >= hoje)
- Botão Salvar → `POST /agente/margem/produtos/:id/ciencia`

**`/agente/margem/diretor` — DashboardDiretor:** cards com totais por comprador, gráfico de barras (recharts), tabela detalhada exportável para Excel, lista de "seções órfãs" (`motivo != 'ok'` no mapeador) pra o admin corrigir no Firebase.

---

## 5. Workflows n8n

### 5.1 Workflow A — `sync-margem-negativa` (a cada 1h)

```
[Cron 0 */1 * * *]
    ↓
[HTTP POST] http://backend.interno:3000/sync/run
   Headers: X-Sync-Token: {{$env.SYNC_TOKEN}}
    ↓
[IF] response.status !== 200
    ↓ true
[Send Alert] Slack/E-mail equipe TI
```

> Alternativa "fat n8n": fazer a chamada à API local + busca Firestore + upsert Supabase tudo no n8n. **Não recomendado** porque a lógica de mapeamento e parseamento fica difícil de testar. Manter no backend.

### 5.2 Workflow B — `resumo-diario-comprador` (08:00)

```
[Cron 0 8 * * 1-6]                                        # seg-sáb
    ↓
[Firestore] GET users WHERE funcao='comprador'            # filtro local após fetch:
                                                          #   doc.agentes inclui 'margem'
                                                          # (Firestore não filtra array.contains
                                                          #  + outro where; mais simples ler tudo
                                                          #  e filtrar no JS — são poucos docs)
    ↓
[Loop sobre os filtrados]
    ↓
[Supabase] SELECT id, nome FROM usuarios
           WHERE email_login = {{doc.id}} AND ativo=true
    ↓
[HTTP GET] /agente/margem/stats/comprador/{{id}}
    ↓
[IF] pendentes > 0 AND doc.whatsapp != null
    ↓ true
[HTTP POST Z-API/Evolution]                               # mensagem WhatsApp
    ↓
[Supabase Insert] notificacoes_log (canal='whatsapp')
```

> Fase 2 (e-mail): adicionar branch que dispara **SMTP** quando `doc.email_notificacao` existir. Hoje começamos só com WhatsApp.

> A query no endpoint `stats/comprador/:id` faz JOIN com a tabela N:N:
> `SELECT COUNT(*) FROM margem_produtos p JOIN margem_produto_compradores mc ON mc.produto_id = p.id WHERE mc.usuario_id = :id AND p.status = 'pendente'`.
> Um produto compartilhado entre Silvania e Tereza conta no resumo das duas. Quando uma der ciência, ele sai do contador da outra automaticamente.

Mensagem WhatsApp sugerida:
```
Olá, *{{nome}}*!
Você tem *{{pendentes}}* produtos com margem negativa aguardando sua ciência
(de um total de {{total}}).

Acesse: https://margem.interno.empresa/lista
```

### 5.3 Workflow C — `resumo-diario-diretor` (08:30)

```
[Cron 30 8 * * 1-6]
    ↓
[Firestore] GET users WHERE funcao='diretor'
                AND agentes contains 'margem'
    ↓
[IF] doc.whatsapp != null
    ↓ true
[HTTP GET] /agente/margem/stats/diretor                  # agregação por comprador
    ↓
[Format texto WhatsApp]                                  # com totais e top 5
    ↓
[HTTP POST Z-API/Evolution]
    ↓
[Supabase Insert] notificacoes_log (canal='whatsapp')
```

> Fase 2: adicionar branch SMTP quando `doc.email_notificacao` existir.

### 5.4 Workflow D — `expira-ciencia` (00:00 diário)

```
[Cron 0 0 * * *]
    ↓
[Supabase Update]
   UPDATE produtos_margem_negativa
   SET status='pendente'
   WHERE status='ciente' AND data_fim_ciencia < CURRENT_DATE;
```

---

## 6. Setup MCP Firebase no Cowork

Hoje você já tem MCP de Supabase e n8n. Falta o Firebase. Opções:

### Opção A — `firebase-mcp` da comunidade (recomendado)
Repositório: `gannonh/firebase-mcp` (Firestore, Auth, Storage).

Passos:
1. No console do Firebase, gerar **Service Account** (`Project Settings → Service Accounts → Generate new private key`). Baixar o JSON.
2. Salvar o JSON em local seguro (ex.: `D:\Developer\cowork\Automatizar buscas na API margem\.secrets\firebase-service-account.json`). **NÃO commitar.**
3. Adicionar no `mcp.json` do Cowork (ou via UI):
   ```json
   {
     "mcpServers": {
       "firebase": {
         "command": "npx",
         "args": ["-y", "@gannonh/firebase-mcp"],
         "env": {
           "SERVICE_ACCOUNT_KEY_PATH": "D:\\...\\firebase-service-account.json",
           "FIREBASE_STORAGE_BUCKET": "<seu-bucket>.appspot.com"
         }
       }
     }
   }
   ```
4. Reiniciar Cowork. Testar comando: "liste documentos da coleção CONFIG".

### Opção B — Wrapper MCP customizado
Criar um pequeno servidor MCP em Node usando `@modelcontextprotocol/sdk` que expõe apenas `listConfigDocs` e `getConfigDoc`. Mais seguro (mínimo escopo) mas exige desenvolvimento.

---

## 7. Variáveis de ambiente

Salvas no arquivo `.env.example`. Resumo dos blocos:

- **Backend** (`backend/.env`):
  - `LOCAL_API_URL`, `LOCAL_API_TIMEOUT_MS`
  - `FIREBASE_SERVICE_ACCOUNT_PATH` ou conteúdo base64
  - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
  - `SYNC_TOKEN` (segredo compartilhado com n8n)
  - `PORT`, `LOG_LEVEL`
- **Frontend** (`frontend/.env`):
  - `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`
  - `VITE_API_BASE_URL` (ex.: `http://10.0.0.20:3000`)
- **n8n** (variáveis no projeto n8n):
  - `BACKEND_URL`, `SYNC_TOKEN`
  - `SMTP_HOST`, `SMTP_USER`, `SMTP_PASS`
  - `ZAPI_TOKEN`, `ZAPI_INSTANCE` (ou `EVOLUTION_API_URL`, `EVOLUTION_API_KEY`)
  - `DIRETOR_EMAIL`, `DIRETOR_WHATSAPP`

---

## 8. Cronograma sugerido (4 sprints curtas)

| Sprint | Duração | Entregáveis |
|---|---|---|
| **1 — Fundação** | 3 dias | Projeto Supabase criado e schema aplicado; MCP Firebase conectado e testado; repositório git iniciado; lista de compradores cadastrada com e-mail. |
| **2 — Backend + Sync** | 5 dias | Backend rodando em `:3000`; endpoint `/sync/run` operacional; ciclo de sync escrevendo no Supabase; testes de mapeamento comprador. |
| **3 — Frontend** | 5 dias | Login Google, lista do comprador, modal de ciência, dashboard diretor. Deploy interno (PM2/Docker). |
| **4 — n8n + Notificações** | 3 dias | Workflows A/B/C/D ativos; integração WhatsApp testada; expiração automática rodando; piloto com 2 compradores. |
| **Hardening** | 2 dias | RLS revisado, logs centralizados, documentação operacional, treinamento dos compradores. |

---

## 9. Pontos a validar com o usuário antes de implementar

1. ~~**Padrão do docId no Firestore**~~ ✅ Validado em 2026-04-30: docs são
   `CONFIG/{primeiroDigito}-SECAO` e cada seção é um CAMPO dentro do doc.
   Ver detalhes em §3.3.
2. **Mais de um comprador por seção** — o exemplo mostra `comprador`, `comprador2`, `comprador3`. Atribuir só ao primeiro válido ou notificar todos?
3. **Onde existe a tabela mestre dos compradores** com e-mail corporativo? Importar de planilha/Firestore/manual?
4. **Provedor de e-mail** — SMTP corporativo (Office365/GSuite) ou SendGrid?
5. **WhatsApp** — Z-API, Evolution API self-hosted ou WhatsApp Business Cloud API oficial?
6. **Frequência do sync** — 1h é suficiente? Ou preciso de tempo real (webhook da API local, se existir)?
7. **Histórico** — manter quanto tempo os produtos resolvidos? Sugerido: 12 meses + arquivamento.
8. **Acesso fora da rede** — algum comprador precisa acessar de casa? Se sim, planejar VPN ou expor via Cloudflare Tunnel.

---

## 10. Riscos e mitigações

| Risco | Impacto | Mitigação |
|---|---|---|
| API local fora do ar | Sync falha | Retry exponencial + alerta em `sync_logs.status='error'`. |
| Documento Firestore sem comprador válido | Produto fica órfão | Atribuir ao papel `admin` ou seção `SEM_COMPRADOR` para revisão manual. |
| Comprador esquece de dar ciência | Reincidência diária | Resumo diário + escalonamento ao diretor após 3 dias pendente. |
| Mudança no formato da string `PRODUTO` | Parser quebra | Testes unitários cobrindo casos reais; tolerância a espaços. |
| Service account exposta | Acesso indevido ao Firebase | `.gitignore` rígido, secrets do hosting, rotação semestral. |

---

## 11. Próximos passos imediatos

1. Validar pendências da seção 9 com o time.
2. **Reescrever migration** `0001_initial_schema.sql` com a nova nomenclatura multi-agente: `agentes`, `usuarios`, `agente_usuario`, `agente_execucoes`, `margem_produtos`, `margem_ciencias`, `notificacoes_log` (com `agente_id`).
3. Aplicar migration no Supabase.
4. Confirmar provedor de WhatsApp e gerar credenciais.
5. Inicializar repositório git com a estrutura `backend/`, `frontend/`, `supabase/`, `n8n/`, `docs/`.

> ⏸ **Aguardando comando do usuário pra prosseguir** com (2). O código atual em `backend/src/utils/parseProduct.js` e `backend/src/services/buyerMapper.service.js` segue válido — só vai mudar de pasta para `backend/src/agentes/margem/` quando começar a implementação.

---

## 12. Agente `metas` (acompanhamento de meta de vendas)

> Briefing fechado em 2026-05-18 com Wanderson.

### 12.1 O que faz

Acompanha filiais, setores, departamentos e seções que estão tendenciando a
NÃO entregar a meta de vendas do mês. Sem ciência por item — é um agente
informativo (alerta diário + dashboard para inspeção rápida).

### 12.2 Fonte de dados (Firestore)

Coleção `METAS-SUPERMERCADO`. Convenção: **1 doc por filial por mês**, com ID
`{ano}-{mes_extenso}-{filial}` (ex.: `2026-maio-305`).

Cada doc contém:

| Campo | Tipo | Significado |
|---|---|---|
| `loja` | map | Realizado parcial da filial: `venda`, `custo`, `margem`, `perda`, `lucro_liq`, `dias_corte_tendencia`, `dias_tendencia`, `desc_filial`. |
| `meta_loja` | map | Meta da filial: `venda`, `margem`, `perda`. |
| `setor[]` / `meta_setor[]` | array | Quebra por setor. Pareados por `cod` quando disponível, senão por índice. |
| `departamento[]` / `meta_departamento[]` | array | Quebra por departamento. |
| `secao[]` / `meta_secao[]` | array | Quebra por seção. |

### 12.3 Fórmula da tendência

Validada com o usuário em 2026-05-18. `dias_corte_tendencia` é um
**offset** — dias do mês que NÃO contam (ex.: feriado de fechamento de
sistema). Logo, o realizado parcial cobre `(dia_atual - dias_corte_tendencia)`
dias.

```
diasComputados      = dia_atual_do_mes - dias_corte_tendencia
diasRestantes       = dias_tendencia - diasComputados
tendencia           = (venda / diasComputados) * dias_tendencia
desvio_meta         = venda - meta_venda
desvio_tendencia    = tendencia - meta_venda
percent             = (venda / meta_venda) * 100
venda_ideal_dia     = meta_venda / dias_tendencia
venda_para_recuperar = max(0, meta_venda - venda) / diasRestantes
em_risco            = tendencia < meta_venda
```

`venda_ideal_dia` é o ritmo "no início do mês" (constante o mês inteiro).
`venda_para_recuperar` é o ritmo necessário no que resta — sobe conforme
o atraso se acumula. Quando a venda já atingiu a meta, devolve `0`;
quando o mês acaba (`diasRestantes <= 0`), devolve `null`.

**Exemplo** (loja 305 em 18/maio):

```
venda                 = 2.794.846,58
meta_venda            = 5.114.843,13
dias_corte_tendencia  = 1
dias_tendencia        = 31
dia_atual_do_mes      = 18

diasComputados        = 18 - 1                          = 17
diasRestantes         = 31 - 17                         = 14
tendencia             = (2.794.846,58 / 17) * 31        = 5.096.484,94
desvio_tend.          = 5.096.484,94 - 5.114.843,13     = -18.358,19
percent               = 2.794.846,58 / 5.114.843,13     = 54,64 %
venda_ideal_dia       = 5.114.843,13 / 31               = 164.994,94
venda_para_recuperar  = 2.319.996,55 / 14               = 165.714,04
em_risco              = true
```

Edge cases:
- Se `diasComputados <= 0` (ex.: 1º dia do mês com offset=1), indicadores
  ficam `null` e `em_risco=false` — sem alerta enquanto não há base de cálculo.
- `meta_venda = 0` também devolve indicadores `null` (divisão por zero).

### 12.4 Regra de visibilidade por usuário

Fonte de verdade ÚNICA: `users/{email_login}.loja` no Firestore.
Vale para todos os papéis — quem decide o que cada um vê é o campo `loja`,
não o `papel`/`funcao`. Padronização escolhida em 2026-05-18.

- **String `"todas"`** (case-insensitive) — usuário vê todas as filiais.
- **Array contendo `"todas"`** — também devolve wildcard.
- **Array de strings** (`['305 - ELETRO BRASIL LTDA','306']`) — usuário
  só vê essas filiais (extrai-se só o número: `'305 - ...'` → `'305'`).
- **String única** (`'305'`) — usuário só vê essa.
- **Ausente / vazio** — usuário não vê nada.

Diretor sem `"todas"` em `loja` só vê o array configurado. Em compensação,
a lógica fica simples e consistente entre frontend, n8n e backend.

### 12.5 Modelo de dados (Supabase)

Migration `0008_agente_metas.sql`:

- **Enum** `metas_nivel` ∈ {`loja`, `setor`, `departamento`, `secao`}.
- **Tabela `metas_snapshots`** — uma linha por (`snapshot_date`, `filial_cod`, `nivel`, `cod`).
  Cada sync diário grava uma "foto" — histórico preservado.
- **View `vw_metas_atual`** — último snapshot por (filial, nível, cod). Consumida pela tela.
- **View `vw_metas_resumo_por_filial`** — agregado por filial: estado da loja + contagem
  de sub-níveis em risco. Consumida pela tela (cards) e pelo n8n (WhatsApp).
- **RLS:** apenas diretor/admin/supervisor leem direto via PostgREST. Compradores
  passam pelo backend (que aplica filtro por `users/{email}.loja`).
- **Seed:** insere o agente em `agentes` com `slug='metas'`.

### 12.6 Backend

`backend/src/agentes/metas/`:

| Arquivo | Responsabilidade |
|---|---|
| `routes.js` | Rotas REST: `POST /run`, `GET /lista`, `GET /resumo-filial`, `GET /filiais-do-usuario/:email` (último protegido por sync token, p/ n8n). |
| `services/syncJob.service.js` | Lê todos os docs da competência, achata os 4 níveis, calcula tendência, upsert em `metas_snapshots`. |
| `services/firestoreReader.service.js` | Lê `METAS-SUPERMERCADO/...` no Firestore e devolve doc + helper `flattenDoc()`. |
| `services/userFiliais.service.js` | Resolve filiais que um usuário pode ver (lê `users/{email}.loja`). |
| `utils/calcTendencia.js` | Fórmula da tendência + parsers (`toNumber`, `parseDocId`, `buildDocIdForFilial`, `extractFilialCod`). |

Cron interno: `METAS_SYNC_CRON` (default `0 4 * * *`, diário 04:00).

### 12.7 Frontend

`frontend/src/agentes/metas/`:

- `index.jsx` (`MetasLayout`) — header com nome do usuário + papel, `<Outlet/>` para sub-rotas.
- `Lista.jsx` — uma única tela com:
  - Cards de resumo por filial (cliques filtram a lista detalhada).
  - Tabela detalhada com nível, filial, venda, meta, tendência, % atingido, Δ tendência, venda/dia ideal.
  - Filtros: nível, "só em risco".

Rota: `/agente/metas` → `<MetasLayout>/<Lista/>`.

### 12.8 n8n

**Um único workflow** — `metas - resumo diario` (08:00 seg-sáb) — atende
os três tipos de destinatário, com mensagem específica:

| `loja` no Firestore   | Tipo de mensagem                          |
|---|---|
| `"todas"`             | TOP 3 filiais piores por % atingido       |
| array com filiais     | sua(s) filial(is) em risco, com indicadores |

Condição de envio: pelo menos 1 filial em risco. Sem risco → não envia.

**Arquitetura cloud-to-cloud** (decisão 2026-05-18, em paralelo à do margem):
n8n NÃO chama o backend local. Toda a inteligência fica no workflow.

```
Schedule
  ↓
Firestore: users
  ↓
Filtrar destinatários       (funcao ∈ {diretor,supervisor,gerente}
  ↓                          + agentes ⊇ ['metas'] + whatsapp válido,
  ↓                          preservando o campo `loja`)
Supabase: resumo            (vw_metas_resumo_por_filial, 1x)
  ↓
Resolver visibilidade       (cruza users × resumo, aplica regra de `loja`)
  ↓
Loop
  ↓
Tem filial em risco?
  ↓ (sim)
Montar mensagem             (branch por wildcard)
  ↓
Evolution: enviar WhatsApp
  ↓
Log notificação
```

**Sem workflow C** (resumo agregado em workflow separado) e
**sem workflow D** (expiração de ciência) — agente é informativo.

Variável n8n adicional: `APP_URL_METAS`.

### 12.9 Checklist de instalação (sequência sugerida)

1. Aplicar migration `0008_agente_metas.sql` no Supabase.
2. Conferir que o agente apareceu em `select * from agentes where slug='metas'` (anotar o `id`).
3. Backend: copiar `.env.example` para `.env`, ajustar `METAS_SYNC_CRON` se desejar.
4. `npm install` (sem novas dependências — usa as do margem) e `npm run dev`.
5. Rodar manualmente uma vez: `curl -X POST -H "X-Sync-Token: ..." http://localhost:3000/agente/metas/run`.
6. Verificar `metas_snapshots` populada.
7. Cadastrar em Firestore `users/{email}` o campo `loja` (array de strings) e
   adicionar `'metas'` ao array `agentes`.
8. Frontend: `npm run dev`, abrir o dashboard, conferir card "Metas" e abrir a tela.
9. n8n: importar `B_metas_resumo-diario-comprador.json`, ajustar credenciais
   e o `agente_id` (uuid do agente metas) no nó "Log notificação".

---

## 13. Agente `comparativo313` (ruptura por filial × depósito 313)

> Briefing fechado em 2026-05-20 com Wanderson.

### 13.1 O que faz

Identifica produtos do **MIX OFICIAL** das filiais que estão **com ruptura na loja** mas ainda têm **estoque no depósito 313**. Sinaliza a ruptura diariamente para diretor, supervisor, gerente da loja e comprador da seção. **Modelo informativo**: não exige ciência — a linha some sozinha quando a loja reabastece (a API deixa de retornar o registro) e o sync vira o status para `resolvida`.

### 13.2 Fonte de dados

- **API local** `http://192.168.118.50:3001/api/comparativo_new` — array de objetos com `deposito`, `filial`, `departamento`, `secao`, `codigo`, `produto`, `estoque_deposito`, `mix`, `grade`, `multiplo_reposicao`, `multiplo_produto`.
- **Firestore `CONFIG/1-SECAO`** — mesma convenção do agente margem (multi-comprador: `comprador`, `comprador2`, `comprador3`).
- **Firestore `users/{email}.loja`** — mesma convenção do agente metas para escopo do gerente.

### 13.3 Filtros aplicados no sync

| Campo da API | Regra | Razão |
|---|---|---|
| `deposito` | só `'313 - …'` (cod = 313) | escopo do agente |
| `mix` | só `1 - SIM` | só produtos que a loja deveria ter no mix |

Outros depósitos e produtos com `mix = NÃO` viram agentes separados no futuro, se necessário.

### 13.4 Visibilidade por papel

| Papel | Vê |
|---|---|
| diretor, supervisor, admin | todas as filiais (lista e agregado) |
| gerente | apenas filiais listadas em `users/{email}.loja` (igual metas) |
| comprador | apenas produtos das suas seções (N:N via `CONFIG/1-SECAO`) |

### 13.5 Modelo de dados (migration 0012)

- `comparativo313_rupturas` — chave natural `(filial_cod, codigo_produto)`. Campos principais: `filial`, `filial_cod`, `deposito`, `deposito_cod`, `departamento`, `secao`, `chave_secao`, `codigo_produto`, `descricao_produto`, `estoque_deposito`, `mix`, `grade`, `multiplo_reposicao`, `multiplo_produto`, `motivo_atribuicao`, `status` (`pendente|resolvida`), `primeira_deteccao`, `ultima_deteccao`, `resolvida_em`, `agente_execucao_id`.
- `comparativo313_produto_compradores` — N:N produto ↔ usuário com `papel_atribuicao` (principal/secundario/terciario) — espelho do margem.
- 3 views: `vw_comparativo313_resumo_filial`, `vw_comparativo313_resumo_responsavel`, `vw_comparativo313_resumo_filial_comprador`.
- RLS: backend usa service_role; SELECT direto via PostgREST liberado para diretor/admin/supervisor e (via N:N) para o comprador. Gerente passa pelo backend (filtro em memória).

### 13.6 Backend

`backend/src/agentes/comparativo313/`:

- `services/localApi.service.js` — cliente axios para `/api/comparativo_new` (override por env `COMPARATIVO313_API_URL`).
- `services/syncJob.service.js` — orquestra o sync (filtra, resolve comprador via `buyerMapper.service.js` do margem, upserta, reconcilia N:N, marca resolvidas).
- `utils/parseFields.js` — `extractCodigo`, `parseProdutoStr`, `normalizeChaveSecao`, `parseMixFlag`, etc.
- `routes.js`:
  - `POST /agente/comparativo313/run` — sync (`X-Sync-Token`).
  - `GET  /agente/comparativo313/lista` — rupturas escopadas pelo papel do usuário.
  - `GET  /agente/comparativo313/resumo-filial` — para diretor/supervisor/gerente.
  - `GET  /agente/comparativo313/resumo-responsavel` — só diretor/admin/supervisor.
  - `GET  /agente/comparativo313/escopo-do-usuario/:email` — utilitário para o n8n.

Registrado em `backend/src/agentes/index.js` e cron interno via env `COMPARATIVO313_SYNC_CRON` (sugestão: `'15 4 * * *'` — 04:15 todo dia, 15 min depois do metas).

### 13.7 Frontend

`frontend/src/agentes/comparativo313/`:

- `index.jsx` — layout com header laranja e abas Lista / Agregado (Agregado só aparece para diretor/supervisor/admin/gerente).
- `Lista.jsx` — cards resumo por filial no topo + tabela de rupturas com busca, filtro por status e ordenação.
- `DashboardAgregado.jsx` — totais consolidados + tabela por filial + (se diretor/supervisor) tabela por responsável.

Rota em `App.jsx`: `/agente/comparativo313` (index = Lista) e `/agente/comparativo313/agregado`.

### 13.8 Workflows n8n previstos (a criar)

- **B-comp313 — Resumo diário do comprador** (08:00 seg-sáb): chama `/escopo-do-usuario/:email` para cada usuário ativo com `agentes` incluindo `'comparativo313'` no Firestore; envia WhatsApp com totais + breakdown por filial.
- **C-comp313 — Resumo diário diretor/supervisor** (08:10 seg-sáb): chama `/escopo-do-usuario/:email` para diretores/supervisores; envia WhatsApp com a lista de filiais e contagem de rupturas pendentes.
- **D-comp313 — Resumo do gerente** (08:15 seg-sáb): mesma chamada filtrada para o papel gerente.

Sem workflow de expiração — modelo é informativo.

Variável n8n adicional: `APP_URL_COMP313` (não é estritamente necessária — o link aponta para o frontend padrão da plataforma).

### 13.9 Variáveis de ambiente novas

```env
# Cron interno do comparativo313 (default sugerido: 04:15 todo dia)
COMPARATIVO313_SYNC_CRON=15 4 * * *

# Opcional: override do endpoint da API local
# COMPARATIVO313_API_URL=http://192.168.118.50:3001/api/comparativo_new
```

`LOCAL_API_TIMEOUT_MS` e `LOCAL_API_URL` já existentes são reaproveitados (a URL do endpoint comparativo é derivada de `LOCAL_API_URL` substituindo o path).

### 13.10 Checklist de instalação

1. Aplicar migration `0012_agente_comparativo313.sql` no Supabase.
2. Conferir `select * from agentes where slug='comparativo313'` (anotar o `id`).
3. Backend: adicionar `COMPARATIVO313_SYNC_CRON` no `.env` se quiser cron interno.
4. `npm run dev` no backend e disparar sync manual: `curl -X POST -H "X-Sync-Token: ..." http://localhost:3000/agente/comparativo313/run`.
5. Verificar `comparativo313_rupturas` populada e contagem em `vw_comparativo313_resumo_filial`.
6. Em Firestore `users/{email}.agentes`, adicionar `'comparativo313'` para quem deve receber WhatsApp.
7. Para gerentes, garantir que `users/{email}.loja` esteja preenchido (array de códigos ou `"todas"`).
8. Frontend: `npm run dev`, abrir o dashboard, conferir card "Comparativo 313".
9. n8n: criar workflows B/C/D-comp313 quando o provedor de WhatsApp estiver definido.
