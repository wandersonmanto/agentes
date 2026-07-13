#!/usr/bin/env node
/**
 * Dispara manualmente o sync do agente margem (produtos com margem negativa).
 *
 * Uso:
 *   node scripts/run-margem-sync.mjs
 *   node scripts/run-margem-sync.mjs --url http://10.0.0.20:3000
 *
 * Lê SYNC_TOKEN de backend/.env automaticamente.
 *
 * O backend precisa estar rodando (`cd backend && npm run dev`).
 * Este script é o equivalente externo do SYNC_CRON: útil para disparar
 * via agendador do Windows / cron do SO no lugar do cron interno do
 * node-cron.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const envPath = path.join(repoRoot, 'backend', '.env');

function loadEnv(file) {
  if (!fs.existsSync(file)) {
    console.error(`Arquivo .env não encontrado: ${file}`);
    process.exit(1);
  }
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (m) out[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
  return out;
}

const args = process.argv.slice(2);
function arg(name, def) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
}

const env   = loadEnv(envPath);
const port  = env.PORT || '3000';
const base  = arg('--url', `http://localhost:${port}`);
const token = env.SYNC_TOKEN;

if (!token) {
  console.error('SYNC_TOKEN ausente em backend/.env');
  process.exit(1);
}

const url = `${base.replace(/\/$/, '')}/agente/margem/run`;
console.log(`POST ${url}`);

try {
  const t0 = Date.now();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'X-Sync-Token': token, 'Content-Type': 'application/json' },
  });
  const txt = await res.text();
  let body;
  try { body = JSON.parse(txt); } catch { body = txt; }

  console.log(`HTTP ${res.status} em ${Date.now() - t0}ms`);
  console.log(typeof body === 'string' ? body : JSON.stringify(body, null, 2));
  process.exit(res.ok ? 0 : 1);
} catch (err) {
  console.error('Falha:', err.message);
  console.error('O backend está rodando? (cd backend && npm run dev)');
  process.exit(1);
}
