/**
 * Configuração do PM2.
 *
 * IMPORTANTE: este arquivo NÃO deve conter segredos (chaves, tokens).
 * As variáveis sensíveis ficam em `backend/.env` (que está no .gitignore).
 * Por isso o `cwd` aponta para a pasta `backend`: assim o `dotenv` do
 * backend encontra o `.env` automaticamente.
 *
 * Uso (na raiz do projeto):
 *   pm2 start ecosystem.config.js
 *   pm2 save
 *   pm2 logs agentes-backend
 */
const path = require('path');

module.exports = {
  apps: [
    {
      name: 'agentes-backend',
      script: 'src/server.js',
      // roda dentro de backend/ -> dotenv carrega backend/.env
      cwd: path.join(__dirname, 'backend'),
      watch: false,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
