# Plataforma de Agentes — Supermercado

Plataforma multi-agente que automatiza rotinas internas. O primeiro agente é
**margem** (Margem Negativa). Outros agentes (vencimento, ruptura, mix) podem
ser plugados na mesma estrutura.

## Estrutura do repositório

```
.
├── planejamento.md                    # documento mestre do projeto
├── docs/
│   ├── setup-mcp-firebase.md          # como conectar Firebase no Cowork (validação manual)
│   └── como-criar-um-agente.md        # checklist para adicionar novo agente
├── supabase/
│   └── migrations/
│       └── 0001_initial_schema.sql    # multi-agente + N:N produto/comprador
├── backend/
│   ├── .env.example
│   ├── package.json
│   └── src/
│       ├── server.js
│       ├── config/
│       ├── routes/
│       ├── services/
│       ├── middleware/
│       └── agentes/
│           ├── index.js               # registry de agentes
│           └── margem/
│               ├── routes.js
│               ├── services/
│               └── utils/
├── frontend/
│   ├── .env.example
│   ├── package.json
│   └── src/
│       ├── pages/                     # Login, Dashboard
│       ├── components/                # AgentCard, AgentInfoModal
│       ├── agentes/margem/            # Index, ListaProdutos, CienciaModal, Diretor
│       ├── lib/                       # firebase, api
│       └── hooks/
├── n8n/
│   └── README.md                      # blueprint dos workflows
└── scripts/
    └── list-config.js                 # validação local da CONFIG do Firebase
```

## Setup rápido

### 1. Banco — Supabase

```bash
# via MCP Supabase: aplicar a migration 0001
# ou copiar o SQL e rodar no SQL Editor do Supabase Studio
```

Depois:
- Cadastrar e-mails em `usuarios` (cada comprador da lista oficial precisa do `email` casado com a conta Google).
- Cadastrar o diretor em `usuarios` (papel='diretor') e vincular ao agente margem em `agente_usuario`.

### 2. Backend

```powershell
cd backend
copy .env.example .env
# preencher: LOCAL_API_URL, SYNC_TOKEN, SUPABASE_*, FIREBASE_SERVICE_ACCOUNT_PATH
npm install
npm run dev
```

### 3. Frontend

```powershell
cd frontend
copy .env.example .env
# preencher VITE_FIREBASE_* (do Firebase Console > Project Settings > Web app)
npm install
npm run dev
```

Frontend abre em `http://localhost:5173`.

### 4. n8n

Importar workflows seguindo o blueprint em `n8n/README.md`. Variáveis
de ambiente do n8n: ver mesmo arquivo.

## Fluxo da aplicação

1. n8n dispara `POST /agente/margem/run` a cada hora.
2. Backend lê API local de margem, filtra negativas, mapeia compradores via Firestore.
3. Upsert em `margem_produtos` + reconciliação N:N em `margem_produto_compradores`.
4. Comprador acessa o dashboard, abre o agente margem, vê seus produtos pendentes.
5. Ele dá ciência (motivo + observação + data fim) e o produto sai da lista de todos os co-responsáveis.
6. n8n envia resumos diários (08:00 comprador, 08:30 diretor).

## Como adicionar um novo agente

Veja [docs/como-criar-um-agente.md](docs/como-criar-um-agente.md).
