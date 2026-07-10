/**
 * Bootstrap do backend da Plataforma de Agentes.
 */
import express from 'express';
import 'express-async-errors';
import cors from 'cors';
import helmet from 'helmet';
import pinoHttp from 'pino-http';
import cron from 'node-cron';

import { env, corsOrigins } from './config/env.js';
import { logger } from './config/logger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { healthRouter } from './routes/health.routes.js';
import { agentesRouter } from './routes/agentes.routes.js';
import { meRouter } from './routes/me.routes.js';
import { agentes } from './agentes/index.js';
import { runSync as runSyncMargem }         from './agentes/margem/services/syncJob.service.js';
import { runSync as runSyncMetas }          from './agentes/metas/services/syncJob.service.js';
import { runSync as runSyncComparativo313 } from './agentes/comparativo313/services/syncJob.service.js';

const app = express();

app.use(helmet());
app.use(cors({ origin: corsOrigins, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(pinoHttp({ logger }));

// Rotas
app.use('/api', healthRouter);
app.use('/api/me', meRouter);
app.use('/api/agentes', agentesRouter);
for (const a of agentes) {
  app.use(a.basePath, a.router);
}

// 404
app.use((req, res) => res.status(404).json({ error: 'Rota não encontrada', path: req.path }));

// Error handler (último)
app.use(errorHandler);

// Cron interno (fallback caso n8n esteja indisponível)
if (env.SYNC_CRON) {
  cron.schedule(env.SYNC_CRON, async () => {
    try {
      logger.info('Cron interno: rodando sync margem');
      await runSyncMargem({ origem: 'cron' });
    } catch (err) {
      logger.error({ err }, 'Cron interno margem falhou');
    }
  });
  logger.info(`Cron interno margem habilitado: ${env.SYNC_CRON}`);
}

if (env.METAS_SYNC_CRON) {
  cron.schedule(env.METAS_SYNC_CRON, async () => {
    try {
      logger.info('Cron interno: rodando sync metas');
      await runSyncMetas({ origem: 'cron' });
    } catch (err) {
      logger.error({ err }, 'Cron interno metas falhou');
    }
  });
  logger.info(`Cron interno metas habilitado: ${env.METAS_SYNC_CRON}`);
}

if (env.COMPARATIVO313_SYNC_CRON) {
  cron.schedule(env.COMPARATIVO313_SYNC_CRON, async () => {
    try {
      logger.info('Cron interno: rodando sync comparativo313');
      await runSyncComparativo313({ origem: 'cron' });
    } catch (err) {
      logger.error({ err }, 'Cron interno comparativo313 falhou');
    }
  });
  logger.info(`Cron interno comparativo313 habilitado: ${env.COMPARATIVO313_SYNC_CRON}`);
}

app.listen(env.PORT, () => {
  logger.info(`Backend ouvindo em :${env.PORT} (${env.NODE_ENV})`);
});
