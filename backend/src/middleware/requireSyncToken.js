/**
 * Middleware: protege endpoints disparados pelo n8n via header X-Sync-Token.
 */
import { env } from '../config/env.js';

export function requireSyncToken(req, res, next) {
  const token = req.headers['x-sync-token'];
  if (!token || token !== env.SYNC_TOKEN) {
    return res.status(401).json({ error: 'Sync token inválido' });
  }
  next();
}
