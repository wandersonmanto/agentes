# Deploy — Plataforma de Agentes

Guia para publicar no GitHub e rodar no servidor **192.168.118.90** (execução diária).

## 1. Publicar no GitHub (na máquina de desenvolvimento)

> O `git init` feito pelo sandbox falhou e deixou um `.git` parcial. Apague-o antes.

```powershell
# dentro da pasta do projeto
Remove-Item -Recurse -Force .git

git init
git add -A
git commit -m "Plataforma de Agentes: vendas diárias + painel/comparativo/tendência + importador maestro"

# CONFERIR que segredos NÃO entraram (não deve retornar nada relevante):
git ls-files | Select-String -Pattern "\.env$|\.secrets/|firebase-service-account"

git branch -M main
git remote add origin https://github.com/SEU_USUARIO/SEU_REPO.git   # repo PRIVADO
git push -u origin main
```

Nunca versionar: `backend/.env`, `frontend/.env`, `.secrets/` (já no `.gitignore`).

## 2. Pré-requisitos no servidor

- Node.js LTS (18+), Git.
- PM2: `npm install -g pm2`
- Acesso à pasta onde o ERP grava o `maestro_dia.xlsx`.

## 3. Clonar e configurar

```powershell
git clone https://github.com/SEU_USUARIO/SEU_REPO.git
cd SEU_REPO

# .env a partir dos modelos
copy backend\.env.example  backend\.env
copy frontend\.env.example frontend\.env
```

Preencher `backend\.env`:
- `SUPABASE_URL` = https://mscbjlvcqyunuyswiaqr.supabase.co
- `SUPABASE_SERVICE_ROLE_KEY` = (service_role do projeto "agentes")
- `SYNC_TOKEN` = (o mesmo usado no n8n)
- `LOCAL_API_URL` = URL da API local de margem
- `FIREBASE_SERVICE_ACCOUNT_PATH` = caminho absoluto do JSON abaixo
- `CORS_ORIGINS` = http://192.168.118.90:5173

Preencher `frontend\.env`:
- `VITE_API_BASE_URL` = http://192.168.118.90:3000
- config do Firebase (apiKey, authDomain, etc.)

Copiar o segredo do Firebase (não vem do git):
```
.secrets\firebase-service-account.json
```

## 4. Instalar dependências

```powershell
cd backend  ; npm install
cd ..\frontend ; npm install
cd ..\scripts  ; npm install
cd ..
```

## 5. Subir os serviços com PM2

```powershell
# Backend (API na porta 3000)
pm2 start backend/src/server.js --name agentes-backend

# Frontend (build estático servido como SPA na porta 5173)
cd frontend ; npm run build ; cd ..
pm2 serve frontend/dist 5173 --spa --name agentes-frontend

# Persistir e subir no boot do Windows
pm2 save
pm2 startup    # siga a instrução impressa
```

Logs: `pm2 logs agentes-backend`. Após `git pull`: `pm2 restart all` (e refazer o `npm run build` do frontend se mudou).

## 6. Carga diária do `maestro_dia` (4× ao dia)

O importador, ao ver `maestro_dia` na pasta, carrega só ele (upsert + prune por `carga_id`), sem reprocessar os dias antigos.

Comando:
```powershell
node scripts\ingest-vendas.mjs "CAMINHO_DA_PASTA_DO_maestro_dia" --dia
```

Agende de uma das formas:

**A) n8n** (recomendado — já é o orquestrador do projeto): um workflow com 4 gatilhos de horário (cron) executando o comando acima via nó Execute Command, encadeando os resumos já existentes.

**B) Agendador de Tarefas do Windows**: 4 tarefas nos horários definidos, ação = programa `node`, argumentos = `scripts\ingest-vendas.mjs "CAMINHO..." --dia`, "Iniciar em" = pasta do projeto.

## 7. Notas

- Liberar no firewall as portas 3000 (API) e 5173 (frontend) na rede interna.
- Migrations do Supabase já estão aplicadas no projeto "agentes"; um clone novo não precisa reaplicar. Para um banco do zero: aplicar `supabase/migrations/*.sql` em ordem.
- O agente **supervisor_estoque** está oculto (`ativo=false`); reative com `update agentes set ativo=true where slug='supervisor_estoque';` quando estiver pronto.
