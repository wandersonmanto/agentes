# Workflows n8n — JSONs para importar

## Como importar

1. No n8n, abra qualquer workflow vazio (ou crie um novo).
2. Menu de 3 pontos no canto superior direito → **Import from File**.
3. Selecione o JSON correspondente.
4. **Antes de salvar**, troque as credenciais marcadas como
   `TROCAR_PELO_ID_DA_SUA_CREDENCIAL_*` clicando em cada nó (Firestore,
   Supabase, Postgres) e selecionando a credencial certa do seu n8n.
5. Confirme que as **variáveis de ambiente** do n8n existem:
   - `EVOLUTION_URL`     — ex.: `https://api.evolution.io`
   - `EVOLUTION_INSTANCE` — nome da sua instância
   - `EVOLUTION_KEY`     — apikey

## Variáveis fixas dentro dos JSONs

- `agente_id` do margem está hardcoded em todos os inserts em
  `notificacoes_log`: `f357e8b2-0169-4cff-85d7-9100746df563`.
- Link do app na mensagem: `http://margem.interno/agente/margem` (ajuste
  se for diferente).

## Workflow B — `B_resumo-diario-comprador.json`

- **Trigger:** Schedule 0 8 * * 1-6 (08:00 seg-sáb).
- Fluxo:
  1. Lê todos os docs de `users` no Firestore.
  2. Filtra: `funcao='comprador'` + `agentes` contém `'margem'` + whatsapp válido.
  3. Loop sobre cada um.
  4. Busca stats do comprador em `vw_margem_resumo_por_responsavel`.
  5. IF `pendentes > 0`.
  6. Monta texto, dispara WhatsApp via Evolution, loga em `notificacoes_log`.

## Workflow C — `C_resumo-diario-agregado.json`

- **Trigger:** Schedule 30 8 * * 1-6 (08:30 seg-sáb).
- Fluxo:
  1. Lê `users` filtrando `funcao in (diretor, supervisor)` com `agentes` contém `'margem'`.
  2. Lê toda a view `vw_margem_resumo_por_responsavel`.
  3. Monta texto consolidado (top 5 por pendentes + totais).
  4. Envia uma mensagem por destinatário.
  5. Loga em `notificacoes_log`.

## Workflow B' — `B_metas_resumo-diario-comprador.json` (agente metas)

> Cloud-to-cloud (Firestore + Supabase + Evolution). NÃO chama o backend
> local. Atende três tipos de destinatário (diretor, supervisor, gerente)
> com mensagens diferentes (top 3 vs filial única) — um único workflow,
> branch dentro do nó `Montar mensagem` baseado em `wildcard`.

- **Trigger:** Schedule 0 8 * * 1-6 (08:00 seg-sáb).
- Fluxo:
  1. `Firestore: users` — lê todos os docs de `users`.
  2. `Filtrar destinatários` (Code) — fica só com:
     - `funcao in ('diretor','supervisor','gerente')`
     - `agentes` contém `'metas'`
     - whatsapp válido
     Preserva o campo `loja` do Firestore p/ o próximo nó.
  3. `Supabase: resumo (todas filiais)` — `select * from vw_metas_resumo_por_filial`
     (executeOnce: true, roda 1x e reaproveita).
  4. `Resolver visibilidade` (Code) — pra cada usuário, decide `wildcard`
     a partir de `loja` (sentinel `"todas"` → wildcard) e filtra o resumo
     pelas filiais permitidas. Devolve 1 item por usuário.
  5. `Loop` — itera 1 usuário por vez.
  6. `Tem filial em risco?` (IF) — pelo menos 1 filial em risco
     (loja ou sub-níveis).
  7. `Montar mensagem` (Code) — branch por `wildcard`:
     - `true`  → TOP 3 piores por `percent_loja`
     - `false` → todas as filiais do usuário em risco
     Inclui o "precisa R$ X/dia em Yd" da `venda_para_recuperar_loja`.
  8. `Evolution: enviar WhatsApp`.
  9. `Log notificação` em `notificacoes_log` (trocar o `agente_id` pelo
     uuid do `metas` — busca: `select id from agentes where slug = 'metas'`).
- **Variáveis n8n necessárias:** `APP_URL_METAS`, mais as credenciais
  Firestore, Supabase e variáveis Evolution já usadas pelo margem.

## Workflow D — `D_expira-ciencia.json`

- **Trigger:** Schedule 0 0 * * * (00:00 todo dia).
- Executa SQL no Postgres do Supabase que volta `status='pendente'` em
  produtos onde `data_fim_ciencia < current_date`.
- Requer credencial **Postgres** apontando para o banco do Supabase
  (host: `db.mscbjlvcqyunuyswiaqr.supabase.co`, db: `postgres`,
  user: `postgres`, password: o do projeto, porta: 5432 ou 6543 pooler).
- Alternativa: substituir o nó por uma chamada Supabase RPC se você
  preferir não abrir conexão Postgres direta.

## Ordem sugerida para testar

1. Importar **B**, trocar credenciais, **desativar o Schedule** e clicar
   "Execute workflow" pra rodar manualmente. Confere se a Maria Clara
   recebe WhatsApp.
2. Se OK, **ativar o Schedule** de B.
3. Importar **C**, mesmo processo. Confere se você (diretor) recebe o
   resumo consolidado.
4. Importar **D** por último (não tem WhatsApp, só SQL).

## Dicas para teste manual

- Pra forçar agora (não esperar 08:00), abra B e clique no nó
  "Schedule 08:00 seg-sáb" → "Execute Node" só pra produzir o item,
  depois clique em "Execute workflow" no canto inferior.
- Ou: temporariamente troque a expressão pra `*/2 * * * *` (a cada 2 min)
  enquanto testa, depois volte pra `0 8 * * 1-6`.
- Em produção, sempre verifique a tabela `notificacoes_log` no Supabase
  pra confirmar envios.
