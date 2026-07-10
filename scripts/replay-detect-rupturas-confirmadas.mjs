#!/usr/bin/env node
/**
 * Replay do detector de rupturas confirmadas.
 *
 * Diferente do replay de alertas/obsolescência, este detector é
 * "stateless por chamada" — só olha o estado atual da MV produto_atual
 * (que sabe quem está ativo no último snapshot). Então rodar em vários
 * dias passados é redundante: o resultado seria o mesmo.
 *
 * Uso típico:
 *   node scripts/replay-detect-rupturas-confirmadas.mjs            # roda 1× no
 *                                                                  #   dia mais recente
 *   node scripts/replay-detect-rupturas-confirmadas.mjs --dry-run  # só lista
 *
 * Flags:
 *   [--dry-run]       só mostra o que seria feito
 *   [--no-refresh]    não refresca a MV no início
 *   [--snapshot YYYY-MM-DD]  data de referência do alerta (default = MAX)
 *
 * Quando o produto reaparece num snapshot novo, a função detectora fecha
 * o alerta como 'resolvida'. Você roda este script depois de cada
 * ingest + refresh para manter a fila operacional sincronizada.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const here     = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');

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
function flag(name) { return args.includes(name); }
function arg(name, def) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : def;
}
const dryRun       = flag('--dry-run');
const skipRefresh  = flag('--no-refresh');
const snapshotArg  = arg('--snapshot', null);

const SUPEST_AGENTE_ID = 'b418b1d2-4e26-4e18-9eea-9b36d045a7ba';

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

function fmtMs(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

async function ultimaData() {
  // RPC com statement_timeout estendido: a view vw_supest_snapshot_dates
  // faz GROUP BY+COUNT em 1.5M linhas e estourava o timeout PostgREST.
  const { data, error } = await supabase.rpc('fn_supest_ultima_data');
  if (error) throw error;
  return data || null;
}

async function previewRupturas() {
  // Usa RPC dedicada com statement_timeout estendido. O preview faz scan na
  // view de rupturas confirmadas, que materializa toda a MV — se chamarmos
  // via REST com count='exact', estoura o timeout default do PostgREST (60s).
  const { data, error } = await supabase.rpc('fn_supest_preview_rupturas_confirmadas');
  if (error) throw error;
  return {
    total:      Number(data?.total      ?? 0),
    venda:      Number(data?.venda_perdida_total ?? 0),
    porBanda:   data?.por_banda || {},
    top:        Array.isArray(data?.top) ? data.top : [],
  };
}

async function refrescarProdutoAtual() {
  const { error } = await supabase.rpc('fn_supest_refresh_produto_atual');
  if (error) throw error;
}

async function refrescarRupturasConfirmadas() {
  const { error } = await supabase.rpc('fn_supest_refresh_rupturas_confirmadas');
  if (error) throw error;
}

async function criarExecucao(snapshotDate) {
  const { data, error } = await supabase
    .from('agente_execucoes')
    .insert({
      agente_id: SUPEST_AGENTE_ID,
      origem:    'replay_detect_rupturas_confirmadas',
      metricas:  { snapshot_date: snapshotDate },
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

async function main() {
  console.log('Replay detect_rupturas_confirmadas');

  if (!skipRefresh) {
    console.log('Refrescando mv_supervisor_estoque_produto_atual...');
    const t0 = Date.now();
    await refrescarProdutoAtual();
    console.log(`  produto_atual: ${fmtMs(Date.now() - t0)}`);
    const t1 = Date.now();
    await refrescarRupturasConfirmadas();
    console.log(`  rupturas_confirmadas: ${fmtMs(Date.now() - t1)}`);
  }

  const snapshot = snapshotArg || (await ultimaData());
  if (!snapshot) { console.log('Sem snapshots na base.'); return; }
  console.log(`Snapshot de referência: ${snapshot}`);

  const preview = await previewRupturas();
  const venda = Number(preview.venda).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  console.log(`Rupturas confirmadas detectadas: ${preview.total}   (venda perdida estimada: ${venda})`);
  const pb = preview.porBanda || {};
  console.log(`  constantes=${pb.constante || 0}  medios=${pb.medio || 0}  baixos=${pb.baixo || 0}`);
  if (preview.top.length > 0) {
    console.log('Top 10 por venda perdida (R$):');
    for (const r of preview.top) {
      const desc = (r.descricao_produto || '').padEnd(40).slice(0, 40);
      console.log(`  ${r.filial_cod}  ${String(r.codigo_produto).padEnd(8)}  ${desc}  ${String(r.banda_ultima_aparicao).padEnd(10)}  ${String(r.dias_ausente).padStart(4)}d  R$ ${Number(r.venda_perdida_brl_estimada).toLocaleString('pt-BR')}`);
    }
  }
  if (dryRun) { console.log('--dry-run: não escrevendo alertas.'); return; }

  console.log('Gravando alertas...');
  const execId = await criarExecucao(snapshot);
  const t0 = Date.now();
  try {
    const { data, error } = await supabase.rpc('fn_supest_detect_rupturas_confirmadas', {
      p_snapshot_date: snapshot,
      p_execucao_id:   execId,
    });
    if (error) throw error;
    const r = Array.isArray(data) ? data[0] : data;
    const ins = Number(r?.alertas_criados     ?? 0);
    const upd = Number(r?.alertas_atualizados ?? 0);
    const res = Number(r?.alertas_resolvidos  ?? 0);
    const dt  = Date.now() - t0;
    await finalizarExecucao(execId, true, {
      snapshot_date:       snapshot,
      alertas_criados:     ins,
      alertas_atualizados: upd,
      alertas_resolvidos:  res,
      duracao_ms:          dt,
    });
    console.log(`  criados=${ins}  atualizados=${upd}  resolvidos=${res}  (${fmtMs(dt)})`);
  } catch (err) {
    const msg = err?.message || String(err);
    console.error(`ERRO: ${msg}`);
    await finalizarExecucao(execId, false, { snapshot_date: snapshot }, msg);
    process.exit(2);
  }
}

main().catch(err => {
  console.error('Falha fatal:', err);
  process.exit(1);
});
