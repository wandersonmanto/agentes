# Setup do MCP Firebase no Cowork

Você já tem MCP de Supabase e n8n conectados. Aqui adicionamos o Firebase
para que o Cowork (e o Claude) possam ler/escrever no Firestore e Auth.

## Pré-requisitos

- Acesso ao **console Firebase** do projeto.
- Permissão de Owner ou Editor no projeto Firebase.
- Node.js 18+ instalado na máquina (para `npx`).

## Passo 1 — Gerar Service Account

1. Console Firebase → ícone de engrenagem → **Project settings**.
2. Aba **Service accounts** → seção *Firebase Admin SDK*.
3. Selecionar **Node.js** e clicar **Generate new private key**.
4. Salvar o JSON em `D:\Developer\cowork\Automatizar buscas na API margem\.secrets\firebase-service-account.json`.
5. Adicionar `.secrets/` ao `.gitignore`.

## Passo 2 — Instalar MCP do Firebase

Pacote recomendado: [`@gannonh/firebase-mcp`](https://www.npmjs.com/package/@gannonh/firebase-mcp)
(testado, mantido, suporta Firestore, Auth e Storage).

O arquivo de configuração é o **`claude_desktop_config.json`** localizado em
`C:\Users\<seu-user>\AppData\Roaming\Claude\claude_desktop_config.json`.
Não existe `mcp.json` separado — adicionamos uma chave `mcpServers` ao
lado da `preferences` que já existe.

### Opção A — via `npx` (mais simples, recomendado)

Edite o arquivo e acrescente o bloco `mcpServers`:

```json
{
  "preferences": { /* ... mantenha o que já está aqui ... */ },
  "mcpServers": {
    "firebase": {
      "command": "npx",
      "args": ["-y", "@gannonh/firebase-mcp"],
      "env": {
        "SERVICE_ACCOUNT_KEY_PATH": "D:\\Developer\\cowork\\Automatizar buscas na API margem\\.secrets\\firebase-service-account.json",
        "FIREBASE_STORAGE_BUCKET": "<seu-projeto>.appspot.com"
      }
    }
  }
}
```

> No JSON do Windows, as barras invertidas precisam ser **duplicadas** (`\\`).
> O `<seu-projeto>` é o *Project ID* do Firebase
> (Project settings → General → Project ID).

Depois de salvar, **feche o Claude Desktop pela bandeja do sistema** e
reabra (não basta fechar a janela).

### Opção B — instalação global (startup mais rápido)

```bash
npm install -g @gannonh/firebase-mcp
```

O npm cria o executável `firebase-mcp.cmd` em
`C:\Users\<seu-user>\AppData\Roaming\npm\`.
Confirme o caminho com:

```bash
where firebase-mcp
```

E aponte `command` direto para o `.cmd`:

```json
"firebase": {
  "command": "C:\\Users\\<seu-user>\\AppData\\Roaming\\npm\\firebase-mcp.cmd",
  "args": [],
  "env": {
    "SERVICE_ACCOUNT_KEY_PATH": "D:\\Developer\\cowork\\Automatizar buscas na API margem\\.secrets\\firebase-service-account.json",
    "FIREBASE_STORAGE_BUCKET": "<seu-projeto>.appspot.com"
  }
}
```

A diferença prática para a opção A: como o pacote já está instalado,
o MCP sobe sem o Node baixar/verificar o tarball a cada inicialização.

## Passo 3 — Validar a conexão

Reinicie o Cowork e peça ao Claude:

> "Liste 3 documentos da coleção CONFIG no Firebase"
> "Mostre os campos do documento CONFIG/1-SECAO"

Se aparecer erro de permissão, revise as roles da service account em
**IAM & Admin** no Google Cloud — precisa ao menos de
*Cloud Datastore User* ou *Firebase Admin*.

## Passo 4 — Restringir o escopo (opcional, mas recomendado)

Por padrão a service account tem acesso amplo. Para reduzir risco:

1. No GCP IAM, criar uma role custom só com:
   - `datastore.entities.get`
   - `datastore.entities.list`
   - `firebaseauth.users.get`
2. Atribuir essa role à service account; remover *Editor* se houver.

## Passo 5 — Configurar Firebase Auth (Google)

1. Console Firebase → **Authentication** → **Sign-in method**.
2. Habilitar **Google**.
3. Em *Authorized domains* adicionar:
   - `localhost`
   - domínio interno onde o frontend vai rodar (ex.: `margem.interno`)
4. Em *Settings → User actions*, restringir cadastro ao domínio
   corporativo (ex.: somente `@empresa.com.br`).

## Pronto

Depois disso o Claude/Cowork consegue, no chat:
- Ler documentos do Firestore (para validar a convenção `{N}-SECAO`).
- Listar usuários do Auth.
- Apoiar a inspeção e a manutenção da coleção CONFIG.
