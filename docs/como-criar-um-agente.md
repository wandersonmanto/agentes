# Como criar um novo agente

Checklist para adicionar um novo agente à plataforma. Use o agente
`margem` como referência viva.

## 1. Definir slug e cadastrar no banco

```sql
insert into agentes (slug, nome, descricao_curta, info_md, icone, cor)
values (
  'vencimento',
  'Vencimento',
  'Avisa o comprador sobre produtos próximos da data de vencimento.',
  '## O que faz...
   ## Atribuições...
   ## Frequência...',
  'CalendarClock',
  '#F59E0B'
);
```

Vincular usuários ao agente em `agente_usuario` (decida quais papéis vão atuar).

## 2. Criar tabelas de domínio

Crie uma migration `00XX_agente_{slug}.sql` com tabelas prefixadas
pelo slug. Ex.: `vencimento_alertas`, `vencimento_acoes`.

Habilite RLS e crie policies que filtrem por `current_usuario_id()`
ou pelo papel do usuário.

## 3. Criar pasta no backend

```
backend/src/agentes/{slug}/
├── routes.js              # Router Express com rotas /agente/{slug}/*
├── services/
│   └── ...                # job de sincronização, integrações externas
└── utils/                 # helpers do domínio
```

Padrão recomendado de rotas:
- `POST /agente/{slug}/run` (com `requireSyncToken`)
- `GET  /agente/{slug}/...` (com `authFirebase`)

## 4. Registrar no registry

Edite `backend/src/agentes/index.js`:

```js
import { vencimentoRouter } from './vencimento/routes.js';

export const agentes = [
  { slug: 'margem',     router: margemRouter,     basePath: '/agente/margem' },
  { slug: 'vencimento', router: vencimentoRouter, basePath: '/agente/vencimento' },
];
```

Pronto, o `server.js` já monta automaticamente.

## 5. Criar pasta no frontend

```
frontend/src/agentes/{slug}/
├── index.jsx                  # layout com tabs/abas internas (Outlet do react-router)
├── ...                        # telas específicas
```

Adicione as rotas no `App.jsx`:

```jsx
<Route path="/agente/vencimento" element={<VencimentoLayout />}>
  <Route index element={<MinhaTela />} />
</Route>
```

## 6. Criar workflows n8n

- Tag os workflows com `agente:{slug}` para organização.
- Use o mesmo padrão dos do agente margem (sync horário + resumos).

## 7. Atualizar a documentação

- Adicionar uma seção no `planejamento.md` (§12, §13...) descrevendo o agente.
- Atualizar o `n8n/README.md` com os workflows novos.

## Boas práticas

- **Agentes não compartilham tabelas de domínio.** Cada um tem o seu mundo prefixado.
- **Tabelas de plataforma (`agentes`, `usuarios`, `agente_execucoes`, `notificacoes_log`) são compartilhadas.**
- **`agente_execucoes.metricas` é JSONB** — guarde métricas livres ali em vez de criar colunas específicas.
- **Cada agente atualiza `agentes.ultima_execucao_at` e `pendentes_total`** ao final do seu sync. Isso alimenta o card do dashboard.
