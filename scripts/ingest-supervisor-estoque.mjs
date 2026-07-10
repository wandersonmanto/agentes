#!/usr/bin/env node
/**
 * Ingestão histórica do agente supervisor_estoque.
 *
 * Lê uma planilha XLSX (`grade - DD-MM.xlsx` ou
 * `arquivo-gerado-DD-MM-AAAA-HH-MM-SS.xlsx`) e dispara o RPC
 * `fn_supest_ingest_snapshots` no Supabase, em lotes de 1.000 linhas.
 * Idempotente — UNIQUE em (snapshot_date, filial_cod, codigo_produto)
 * faz upsert no banco.
 *
 * Aceita um arquivo único OU uma pasta inteira:
 *   node scripts/ingest-supervisor-estoque.mjs <arquivo.xlsx>
 *   node scripts/ingest-supervisor-estoque.mjs <pasta>
 *
 * Flags:
 *   [--date YYYY-MM-DD]   sobrescreve data (só faz sentido p/ 1 arquivo)
 *   [--batch 1000]        tamanho do lote enviado ao RPC
 *   [--dry-run]           só parseia; não envia ao Supabase
 *   [--no-refresh]        não refresca a MV ao final
 *   [--continue-on-error] em modo pasta, segue para o próximo arquivo
 *                         mesmo se um falhar (default: para no 1º erro)
 *
 * Quando passa uma pasta:
 *   - varre TODOS os arquivos *.xlsx (ignora travas ~$*.xlsx do Excel)
 *   - ordena pela data inferida do nome (ascendente)
 *   - faz a ingestão um a um com --no-refresh implícito
 *   - refresca a MV uma única vez ao final
 *
 * Lê SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY de backend/.env.
 *
 * Pré-requisito: `cd scripts && npm install` (uma vez, instala xlsx).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { createClient } from '@supabase/supabase-js';

const here = path.dirname(fileURLToPath(import.meta.url));
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
const positional       = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
const inputPath        = positional[0];
const dateOverride     = arg('--date');
const batchSize        = Number(arg('--batch', 1000));
const dryRun           = flag('--dry-run');
const noRefresh        = flag('--no-refresh');
const continueOnError  = flag('--continue-on-error');
const fromDate         = arg('--from', null);
const toDate           = arg('--to', null);

if (!inputPath) {
  console.error(`Uso:
  node scripts/ingest-supervisor-estoque.mjs <arquivo.xlsx>
  node scripts/ingest-supervisor-estoque.mjs <pasta>

  [--date YYYY-MM-DD]    sobrescreve data (1 arquivo só)
  [--batch 1000]         tamanho do lote enviado ao RPC
  [--dry-run]            só parseia; não envia
  [--no-refresh]         não refresca a MV ao final
  [--continue-on-error]  em modo pasta, segue mesmo se um arquivo falhar
  [--from YYYY-MM-DD]    em modo pasta, ignora arquivos antes dessa data
  [--to   YYYY-MM-DD]    em modo pasta, ignora arquivos depois dessa data`);
  process.exit(1);
}
if (!fs.existsSync(inputPath)) {
  console.error(`Caminho não encontrado: ${inputPath}`);
  process.exit(1);
}
const inputIsDir = fs.statSync(inputPath).isDirectory();
if (inputIsDir && dateOverride) {
  console.error('--date só pode ser usado com um arquivo único, não com pasta.');
  process.exit(1);
}

// ---------------------------------------------------------------- supabase
const env = loadEnv(path.join(repoRoot, 'backend', '.env'));
const SUPABASE_URL              = env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!dryRun && (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)) {
  console.error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes em backend/.env');
  process.exit(1);
}
const supabase = dryRun ? null : createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------- parsing
// Mapa Excel -> campo do RPC.
const COLMAP = {
  'FILIAL':            'filial',
  'TIPO':              'tipo',
  'SETOR':             'setor',
  'DEPARTAMENTO':      'departamento',
  'SECAO':             'secao',
  'FORNECEDOR':        'fornecedor',
  'Grade Secao':       'grade',
  'Grade Extra':       'grade_extra',
  'Qtd Estoque':       'estoque',
  'Vlr. Estoque R$':   'vlr_estoque',
  'Qtd Reservado':     'qtd_reservado',
  'Qtd Transito CD':   'qtd_transito_cd',
  'Qtd Est Total':     'qtd_estoque_total',
  'Qtde Total Vendas': 'quant_vendas',
  'Qtd Media Dia':     'media_dia',
  'Qtd Movimentos':    'quant_movimentos',
  'QTDDIASMOV':        'dias_venda',
  'Qtd Maximo':        'maximo',
  'Dt. Ult. Ent.':     'ultima_entrada',
  'Dt. Ult. Sai':      'ultima_saida',
  'MIX':               'mix',
  'QTDDIAS':           'giro',
};

function dateFromFilename(name) {
  // Padrão 1 (atual): "grade - DD-MM.xlsx"  →  ano inferido
  //   Default = ano atual. Se a data cair no futuro versus hoje,
  //   assume ano anterior (cobre wrap-around de fim de ano).
  let m = name.match(/grade\s*-\s*(\d{2})-(\d{2})\b/i);
  if (m) {
    const dd = m[1], mm = m[2];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let candidate = new Date(now.getFullYear(), Number(mm) - 1, Number(dd));
    if (candidate > today) {
      candidate = new Date(now.getFullYear() - 1, Number(mm) - 1, Number(dd));
    }
    const yyyy = candidate.getFullYear();
    return `${yyyy}-${mm}-${dd}`;
  }

  // Padrão 2 (legado): "arquivo-gerado-DD-MM-AAAA-HH-MM-SS.xlsx"
  m = name.match(/arquivo-gerado-(\d{2})-(\d{2})-(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;

  return null;
}

function splitProduto(v) {
  if (v == null) return [null, null];
  const s = String(v);
  const m = s.match(/^(\d+)\s*-\s*(.*)$/);
  if (!m) return [s, null];
  return [m[1], m[2].trim()];
}

// Só ingere PRODUTOS DE REVENDA (TIPO começa com "0 - ").
function isProdutoRevenda(tipoRaw) {
  if (tipoRaw == null) return false;
  return /^\s*0\s*-/.test(String(tipoRaw));
}

// Colunas numéricas — precisam de parseBrNumber antes de enviar ao RPC.
const NUMERIC_COLS = new Set([
  'estoque', 'quant_vendas', 'media_dia', 'quant_movimentos', 'dias_venda',
  'giro', 'maximo', 'grade', 'grade_extra', 'multiplo', 'preco',
  'vlr_estoque', 'qtd_reservado', 'qtd_transito_cd', 'qtd_estoque_total',
]);

/**
 * Converte string BR/en-US/mista para Number JS.
 *
 * O ERP exporta o XLSX com formatação MISTA por coluna:
 *   - Estoque/Vendas/Movimentos: inteiros com "." de milhar  ("1.196" = 1196)
 *   - Vlr. Estoque: decimal en-US sem milhar                  ("1841.84" = 1841.84)
 *   - Dias venda:   decimal en-US                             ("29.00" = 29)
 *   - Valores ocasionais com vírgula decimal BR               ("0,5" = 0.5)
 *
 * Heurística:
 *   • Tem vírgula → BR: "." é milhar, "," é decimal.
 *   • Só pontos:
 *       - 0 pontos → inteiro.
 *       - 1 ponto + parte inteira 1-3 dígitos + parte fracionária EXATAMENTE
 *         3 dígitos → separador de milhar ("1.196", "15.000").
 *       - 1 ponto qualquer outro → decimal en-US ("1841.84", "29.00", "0.5").
 *       - 2+ pontos com partes 1-3/3/3 dígitos → tudo milhar ("1.234.567").
 *   • Qualquer coisa que não case → fallback Number(s).
 */
function parseBrNumber(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (s === '') return null;

  if (s.includes(',')) {
    const n = Number(s.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }

  const parts = s.split('.');
  if (parts.length === 1) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  if (parts.length === 2) {
    const [intPart, fracPart] = parts;
    if (/^-?\d{1,3}$/.test(intPart) && /^\d{3}$/.test(fracPart)) {
      const n = Number(intPart + fracPart);
      return Number.isFinite(n) ? n : null;
    }
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  const okMilhar = parts.every(
    (p, i) => i === 0 ? /^-?\d{1,3}$/.test(p) : /^\d{3}$/.test(p),
  );
  if (okMilhar) {
    const n = Number(parts.join(''));
    return Number.isFinite(n) ? n : null;
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function normalize(rows, snapshot_date) {
  const out = [];
  let descTipo = 0, descChave = 0;
  for (const r of rows) {
    if (!isProdutoRevenda(r['TIPO'])) { descTipo++; continue; }
    const rec = { snapshot_date };
    for (const [excel, target] of Object.entries(COLMAP)) {
      const v = r[excel];
      if (v == null || v === '') {
        rec[target] = null;
      } else if (NUMERIC_COLS.has(target)) {
        rec[target] = parseBrNumber(v);  // Number JS — sem ambiguidade no banco
      } else {
        rec[target] = String(v);
      }
    }
    const [codigo, desc] = splitProduto(r['PRODUTO']);
    rec.codigo_produto    = codigo;
    rec.descricao_produto = desc;
    if (rec.codigo_produto && rec.filial) out.push(rec);
    else descChave++;
  }
  return { rows: out, descTipo, descChave };
}

// ---------------------------------------------------------------- helpers
const fmt = (n) => Number(n).toLocaleString('pt-BR');

async function refreshMv() {
  process.stdout.write('▸ Atualizando mv_supervisor_estoque_produto_atual... ');
  const tMv = Date.now();
  const { error: errMv } = await supabase.rpc('fn_supest_refresh_produto_atual');
  if (errMv) {
    console.log('FALHOU');
    console.error(`  ${errMv.message}`);
    return false;
  }
  console.log(`ok (${((Date.now() - tMv) / 1000).toFixed(1)}s)`);
  return true;
}

/**
 * Ingere um arquivo XLSX. Retorna {ok, snapshot_date, inserted, updated, elapsedMs}.
 * Em falha, ok=false e msg contém o motivo.
 */
async function ingestFile(filePath, opts = {}) {
  const { batchSize, dateOverride, dryRun, prefix = '' } = opts;
  const fileName = path.basename(filePath);
  const snapshot_date = dateOverride || dateFromFilename(fileName);

  if (!snapshot_date) {
    return { ok: false, msg: `não foi possível inferir a data do nome "${fileName}"` };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(snapshot_date)) {
    return { ok: false, msg: `data inválida: ${snapshot_date}` };
  }

  console.log(`${prefix}Arquivo:  ${fileName}`);
  console.log(`${prefix}Data:     ${snapshot_date}${dateOverride ? '  (override)' : '  (inferida do nome)'}`);
  console.log(`${prefix}Lote:     ${batchSize} linhas/RPC${dryRun ? '  [DRY-RUN]' : ''}`);

  const today = new Date().toISOString().slice(0, 10);
  if (snapshot_date > today) {
    console.error(`${prefix}⚠ AVISO: data inferida (${snapshot_date}) está no FUTURO vs hoje (${today}).`);
  }

  const t0 = Date.now();
  console.log(`${prefix}▸ Lendo planilha...`);
  const wb = XLSX.read(fs.readFileSync(filePath), { type: 'buffer', cellDates: false });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(ws, { raw: false, defval: null });
  console.log(`${prefix}  ${fmt(rawRows.length)} linhas brutas em "${sheetName}"`);

  console.log(`${prefix}▸ Normalizando...`);
  const { rows, descTipo, descChave } = normalize(rawRows, snapshot_date);
  console.log(`${prefix}  ${fmt(rows.length)} válidas (PRODUTOS DE REVENDA)`);
  if (descTipo)  console.log(`${prefix}  ${fmt(descTipo)} ignoradas (TIPO ≠ "0 - PRODUTOS DE REVENDA")`);
  if (descChave) console.log(`${prefix}  ${fmt(descChave)} ignoradas (sem codigo_produto ou filial)`);

  if (rows.length === 0) {
    return { ok: false, msg: 'nenhuma linha válida' };
  }

  if (dryRun) {
    console.log(`${prefix}\nDry-run: amostra das 3 primeiras linhas normalizadas:`);
    console.log(JSON.stringify(rows.slice(0, 3), null, 2));
    return { ok: true, snapshot_date, inserted: 0, updated: 0, elapsedMs: Date.now() - t0 };
  }

  console.log(`${prefix}▸ Enviando ${Math.ceil(rows.length / batchSize)} lote(s) ao Supabase...`);
  let totalIns = 0, totalUpd = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const lote = rows.slice(i, i + batchSize);
    const n = Math.floor(i / batchSize) + 1;
    const total = Math.ceil(rows.length / batchSize);
    process.stdout.write(`${prefix}  lote ${String(n).padStart(2)}/${total} (${lote.length} linhas)... `);

    const tLote = Date.now();
    const { data, error } = await supabase.rpc('fn_supest_ingest_snapshots', {
      p_origem: 'excel',
      p_rows: lote,
    });
    if (error) {
      console.log('FALHOU');
      console.error(`${prefix}\nErro: ${error.message}`);
      if (error.details) console.error(`${prefix}  detalhes: ${error.details}`);
      return { ok: false, msg: error.message, snapshot_date };
    }
    const r = Array.isArray(data) ? data[0] : data;
    const ins = Number(r?.inserted_count || 0);
    const upd = Number(r?.updated_count  || 0);
    totalIns += ins; totalUpd += upd;
    const dur = ((Date.now() - tLote) / 1000).toFixed(1);
    console.log(`+${ins} novos, ~${upd} atualizados  (${dur}s)`);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('');
  console.log(`${prefix}✓ ${snapshot_date}: ${fmt(totalIns)} novos, ${fmt(totalUpd)} atualizados em ${elapsed}s`);

  return { ok: true, snapshot_date, inserted: totalIns, updated: totalUpd, elapsedMs: Date.now() - t0 };
}

// ---------------------------------------------------------------- run
if (!inputIsDir) {
  // ====== Modo 1: arquivo único ======
  const res = await ingestFile(inputPath, { batchSize, dateOverride, dryRun });
  if (!res.ok) {
    console.error(`\nFalhou: ${res.msg}`);
    process.exit(1);
  }
  if (!dryRun && !noRefresh) await refreshMv();
} else {
  // ====== Modo 2: pasta inteira ======
  const todos = fs.readdirSync(inputPath)
    .filter(name => /\.xlsx$/i.test(name))
    .filter(name => !name.startsWith('~$'))                    // pula travas do Excel
    .map(name => {
      const full = path.join(inputPath, name);
      const dt   = dateFromFilename(name);
      return { name, full, dt };
    })
    .filter(it => {
      if (!it.dt) console.error(`⚠ ignorando ${it.name}: data não inferível`);
      return !!it.dt;
    })
    .sort((a, b) => a.dt.localeCompare(b.dt));

  const arquivos = todos.filter(it => {
    if (fromDate && it.dt < fromDate) return false;
    if (toDate   && it.dt > toDate)   return false;
    return true;
  });

  if (todos.length === 0) {
    console.error(`Nenhum *.xlsx com data inferível em ${inputPath}`);
    process.exit(1);
  }
  if (arquivos.length === 0) {
    console.error(`Nenhum arquivo no intervalo --from ${fromDate || '∞'} --to ${toDate || '∞'}.`);
    console.error(`Disponível: ${todos[0].dt} → ${todos[todos.length - 1].dt}`);
    process.exit(1);
  }

  console.log(`Pasta:    ${inputPath}`);
  if (arquivos.length < todos.length) {
    console.log(`Filtro:   ${fromDate || '(início)'} → ${toDate || '(fim)'}  (${arquivos.length}/${todos.length})`);
  }
  console.log(`Arquivos: ${arquivos.length}  (${arquivos[0].dt} → ${arquivos[arquivos.length - 1].dt})`);
  console.log(`Lote:     ${batchSize}${dryRun ? '  [DRY-RUN]' : ''}${continueOnError ? '  --continue-on-error' : ''}`);
  console.log('');

  const tInicio = Date.now();
  let okCount = 0, failCount = 0;
  let totIns = 0, totUpd = 0;
  const falhas = [];

  for (let i = 0; i < arquivos.length; i++) {
    const a = arquivos[i];
    const prefix = `[${String(i + 1).padStart(2)}/${arquivos.length}] `;
    console.log('─'.repeat(60));
    const res = await ingestFile(a.full, { batchSize, dryRun, prefix });
    if (res.ok) {
      okCount++;
      totIns += res.inserted || 0;
      totUpd += res.updated  || 0;
    } else {
      failCount++;
      falhas.push({ name: a.name, msg: res.msg });
      if (!continueOnError) {
        console.error(`\nAbortando — use --continue-on-error pra seguir para o próximo.`);
        break;
      }
    }
  }

  const dtTotal = ((Date.now() - tInicio) / 1000).toFixed(1);
  console.log('═'.repeat(60));
  console.log(`Total: ${okCount} ok, ${failCount} falhou em ${dtTotal}s`);
  console.log(`       ${fmt(totIns)} snapshots novos, ${fmt(totUpd)} atualizados`);
  if (falhas.length > 0) {
    console.log('\nArquivos com falha:');
    for (const f of falhas) console.log(`  ${f.name}  →  ${f.msg}`);
  }

  if (!dryRun && !noRefresh && okCount > 0) await refreshMv();

  if (failCount > 0) process.exit(2);
}
