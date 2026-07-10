#!/usr/bin/env node
/**
 * Replay retroativo do detector de alertas do supervisor_estoque.
 *
 * Em produção, o n8n diário chama `fn_supest_detect_alerts(date, exec_id)`
 * todo dia D após a ingestão. Quando estamos rodando a Etapa 1 (ingestão
 * histórica via planilhas), o detector ainda não dispara — então
 * supervisor_estoque_alertas fica vazio e as abas Alertas / Agregado do
 * frontend mostram tudo zerado.
 *
 * Este script percorre todos os snapshot_date já ingeridos e chama o RPC
 * em cada um, criando uma linha em agente_execucoes para auditoria. Ao
 * final refresca a MV de produto_atual para o frontend ficar coerente.
 *
 * Uso:
 *   node scripts/replay-detect-alerts.mjs                 # todos os dias
 *   node scripts/replay-detect-alerts.mjs --from 2026-01-05
 *   node scripts/replay-detect-alerts.mjs --from 2026-01-05 --to 2026-02-07
 *   node scripts/replay-detect-alerts.mjs --threshold 30   # default 20%
 *   node scripts/replay-detect-alerts.mjs --dry-run        # só lista os dias
 *   node scripts/replay-detect-alerts.mjs --only-new       # só dias ainda
 *                                                          #   não processados
 *                                                          #   (consulta
 *                                                          #   agente_execucoes)
 *
 * Observações:
 *   - O detector exige ≥3 dias de baseline nos 7 dias anteriores ao
 *     snapshot. Dias sem baseline retornam 0 alertas (normal).
 *   - É idempotente: ON CONFLICT (snapshot_date, filial_cod, codigo_produto,
 *     metrica, direcao) faz update, então pode rodar quantas vezes precisar.
 *
 * Pré-requisito: `cd scripts && npm install` (uma vez).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const here     = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

// ---------------------------------------------------------------- env
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

// ---------------------------------------------------------------- args
const args = process.argv.slice(2);
function flag(name) { return args.includes(name); }
function arg(name, def) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
}
const fromDate  = arg('--from', null);
const toDate    = arg('--to',   null);
const threshold = Number(arg('--threshold', 20));
const dryRun    = flag('--dry-run');
const skipRefresh = flag('--no-refresh');
const onlyNew     = flag('--only-new');

const SUPEST_AGENTE_ID = 'b418b1d2-4e26-4e18-9eea-9b36d045a7ba';

// ---------------------------------------------------------------- supabase
const env = loadEnv(path.join(repoRoot, 'backend', '.env'));
const SUPABASE_URL              = env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes em backend/.env');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ---------------------------------------------------------------- helpers
function fmtMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * Lê agente_execucoes filtrando por origem='replay_detect_alerts' e
 * status='concluido', extraindo snapshot_date do JSON `metricas`.
 * Retorna um Set de YYYY-MM-DD já processados com sucesso.
 */
async function diasJaProcessados() {
  const { data, error } = await supabase
    .from('agente_execucoes')
    .select('metricas')
    .eq('origem', 'replay_detect_alerts')
    .eq('status', 'concluido');
  if (error) throw error;
  const set = new Set();
  for (const r of data || []) {
    const d = r.metricas?.snapshot_date;
    if (d) set.add(d);
  }
  return set;
}

async function listarDias() {
  // Usa RPC dedicada com statement_timeout estendido. A view
  // vw_supest_snapshot_dates faz GROUP BY + COUNT em 1.5M+ linhas e
  // pode estourar o timeout default do PostgREST conforme a base cresce.
  const { data, error } = await supabase.rpc('fn_supest_listar_snapshot_dates');
  if (error) throw error;
  return (data || []).map(r => r.snapshot_date);
}

async function criarExecucao(snapshotDate) {
  const { data, error } = await supabase
    .from('agente_execucoes')
    .insert({
      agente_id: SUPEST_AGENTE_ID,
      origem:    'replay_detect_alerts',
      metricas:  { snapshot_date: snapshotDate, threshold_pct: threshold },
    })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

async function finalizarExecucao(execId, ok, metricas, erro) {
  await supabase
    .from('agente_execucoes')
    .update({
      finished_at: new Date().toISOString(),
      status:      ok ? 'concluido' : 'falhou',
      metricas,
      erro:        erro || null,
    })
    .eq('id', execId);
}

async function rodarDetector(snapshotDate, execId) {
  const { data, error } = await supabase.rpc('fn_supest_detect_alerts', {
    p_snapshot_date:  snapshotDate,
    p_execucao_id:    execId,
    p_threshold_pct:  threshold,
  });
  if (error) throw error;
  // RPC retorna TABLE(alertas_criados int, alertas_atualizados int)
  const row = Array.isArray(data) ? data[0] : data;
  return {
    criados:      Number(row?.alertas_criados      ?? 0),
    atualizados:  Number(row?.alertas_atualizados  ?? 0),
  };
}

async function refrescarProdutoAtual() {
  const t0 = Date.now();
  const { error } = await supabase.rpc('fn_supest_refresh_produto_atual');
  if (error) throw error;
  return Date.now() - t0;
}

// ---------------------------------------------------------------- main
async function main() {
  console.log(`Replay detect_alerts (threshold ${threshold}%)`);
  const todos = await listarDias();
  if (todos.length === 0) { console.log('Sem snapshots ingeridos.'); return; }

  let dias = todos;
  if (fromDate) dias = dias.filter(d => d >= fromDate);
  if (toDate)   dias = dias.filter(d => d <= toDate);

  let pulados = 0;
  if (onlyNew) {
    const ja = await diasJaProcessados();
    const antes = dias.length;
    dias = dias.filter(d => !ja.has(d));
    pulados = antes - dias.length;
  }

  console.log(`Total de dias na base: ${todos.length} (${todos[0]} → ${todos[todos.length - 1]})`);
  console.log(`Dias selecionados:    ${dias.length}${fromDate ? `, from=${fromDate}` : ''}${toDate ? `, to=${toDate}` : ''}${onlyNew ? `, --only-new (${pulados} já processados pulados)` : ''}`);
  if (dias.length === 0) { console.log('Nada para processar.'); return; }
  if (dryRun) { dias.forEach(d => console.log(' ', d)); return; }

  let totCriados = 0, totAtualizados = 0, totFalhas = 0;
  const tInicio = Date.now();

  for (const dia of dias) {
    const t0 = Date.now();
    let execId = null;
    try {
      execId = await criarExecucao(dia);
      const r = await rodarDetector(dia, execId);
      const dt = Date.now() - t0;
      totCriados     += r.criados;
      totAtualizados += r.atualizados;
      await finalizarExecucao(execId, true, {
        snapshot_date:       dia,
        threshold_pct:       threshold,
        alertas_criados:     r.criados,
        alertas_atualizados: r.atualizados,
        duracao_ms:          dt,
      });
      console.log(`  ${dia}  criados=${String(r.criados).padStart(5)}  atualizados=${String(r.atualizados).padStart(5)}  (${fmtMs(dt)})`);
    } catch (err) {
      totFalhas++;
      const msg = err?.message || String(err);
      console.error(`  ${dia}  ERRO: ${msg}`);
      if (execId) await finalizarExecucao(execId, false, { snapshot_date: dia }, msg);
    }
  }

  const dtTotal = Date.now() - tInicio;
  console.log('---');
  console.log(`Criados:     ${totCriados}`);
  console.log(`Atualizados: ${totAtualizados}`);
  console.log(`Falhas:      ${totFalhas}`);
  console.log(`Duração:     ${fmtMs(dtTotal)}`);

  if (!skipRefresh) {
    console.log('Refrescando mv_supervisor_estoque_produto_atual...');
    const dtMv = await refrescarProdutoAtual();
    console.log(`MV refrescada em ${fmtMs(dtMv)}.`);
  }
}

main().catch(err => {
  console.error('Falha fatal:', err);
  process.exit(1);
});
