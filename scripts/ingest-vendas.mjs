#!/usr/bin/env node
/**
 * Ingestão das vendas diárias ("maestro_N.xlsx").
 *
 * Lê a planilha (exportação em pivô do ERP, aba única), descarta as linhas
 * de SUBTOTAL e envia apenas as LINHAS FOLHA para o RPC `fn_vendas_ingest`
 * no Supabase, em lotes. Idempotente — UNIQUE em (linha_hash) faz upsert.
 *
 * A DATA de cada linha vem da coluna "Dia" da própria planilha (não do
 * nome do arquivo). Cada arquivo deve conter uma única data; se houver
 * mais de uma, o script avisa e ingere todas mesmo assim (cada linha
 * carrega sua própria data).
 *
 * Uso:
 *   node scripts/ingest-vendas.mjs <arquivo.xlsx>
 *   node scripts/ingest-vendas.mjs <pasta>            # todos os *.xlsx maestro
 *
 * Flags:
 *   [--batch 2000]         linhas por chamada ao RPC (default 2000)
 *   [--dry-run]            só parseia; não envia ao Supabase
 *   [--continue-on-error]  em modo pasta, segue mesmo se um arquivo falhar
 *   [--glob maestro]       filtro de nome (substring, default "maestro")
 *   [--no-prune]           não remove linhas órfãs do dia após a carga
 *   [--dia]                em pasta, carrega só o maestro_dia (intradia)
 *   [--full]               em pasta, (re)carrega todos os arquivos (backfill)
 *
 * Arquivo intradia "maestro_dia.xlsx": carregado várias vezes ao dia. Sem
 * --dia/--full, o modo pasta detecta esse arquivo e carrega SÓ ele (os dias
 * anteriores já entraram em cargas passadas), evitando reprocessar tudo.
 *
 * Substituição idempotente por dia: cada arquivo recebe um carga_id. Após
 * enviar todos os lotes com sucesso, as linhas do(s) dia(s) que sobraram de
 * uma carga anterior (carga_id diferente) são apagadas via fn_vendas_prune_orfaos.
 *
 * Lê SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY de backend/.env.
 * Pré-requisito: `cd scripts && npm install` (instala xlsx e supabase-js).
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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
const positional = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
const inputPath = positional[0];
const batchSize = Number(arg('--batch', 2000));
const dryRun = flag('--dry-run');
const continueOnError = flag('--continue-on-error');
const nameFilter = arg('--glob', 'maestro');
const noPrune = flag('--no-prune');
const soDia = flag('--dia') || flag('--incremental');   // só o arquivo intradia
const full  = flag('--full') || flag('--all');          // recarrega tudo (backfill)

if (!inputPath) {
  console.error(`Uso:
  node scripts/ingest-vendas.mjs <arquivo.xlsx>
  node scripts/ingest-vendas.mjs <pasta>

  [--batch 2000]         linhas por chamada ao RPC
  [--dry-run]            só parseia; não envia
  [--continue-on-error]  em modo pasta, segue mesmo se um arquivo falhar
  [--glob maestro]       filtro de nome (substring)
  [--no-prune]           não remove linhas órfãs do dia após a carga
  [--dia]                em pasta, carrega SÓ o maestro_dia (intradia)
  [--full]               em pasta, (re)carrega TODOS os arquivos (backfill)

  Sem --dia/--full: se houver "maestro_dia" na pasta, carrega só ele
  (os dias antigos já foram carregados); senão, carrega os numerados.`);
  process.exit(1);
}
if (!fs.existsSync(inputPath)) {
  console.error(`Caminho não encontrado: ${inputPath}`);
  process.exit(1);
}
const inputIsDir = fs.statSync(inputPath).isDirectory();

// ---------------------------------------------------------------- supabase
const env = loadEnv(path.join(repoRoot, 'backend', '.env'));
const SUPABASE_URL = env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
if (!dryRun && (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY)) {
  console.error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes em backend/.env');
  process.exit(1);
}
const supabase = dryRun ? null : createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------- parsing
// Colunas Excel -> par (código, nome). Campos vêm como "<cod> - <nome>".
const DIM_SPLIT = {
  'Empresa':            ['empresa_cod', 'empresa_nome'],
  'Canal Vendas':       ['canal_cod', 'canal_nome'],
  'Filial':             ['filial_cod', 'filial_nome'],
  'Setor':              ['setor_cod', 'setor_nome'],
  'Departamento':       ['departamento_cod', 'departamento_nome'],
  'Seção':              ['secao_cod', 'secao_nome'],
  'Produto':            ['produto_cod', 'produto_nome'],
  'Fornecedor Produto': ['fornecedor_cod', 'fornecedor_nome'],
  'Comprador':          ['comprador_cod', 'comprador_nome'],
};

// Colunas Excel numéricas -> campo do RPC.
const NUM_MAP = {
  'Quantidade':               'quantidade',
  'Quantidade Devolução':     'quantidade_devolucao',
  'Devolução R$':             'devolucao_valor',
  'Venda R$':                 'venda_valor',
  'Custo Líquido R$':         'custo_liquido',
  'Venda Líquida R$':         'venda_liquida',
  'Lucro Líquido Unit. R$':   'lucro_liquido_unit',
  'Imp. Saída R$':            'imp_saida',
  'Vlr PIS/COFINS Lucro R$':  'pis_cofins_lucro',
  'Margem Realizada %':       'margem_realizada',
  'PMZ Unit. R$':             'pmz_unit',
  'Débito Imp. Total R$':     'debito_imp_total',
};

// "384670 - CEREAL MAT NESCAU DUO 210G" -> ["384670","CEREAL MAT NESCAU DUO 210G"]
function splitCodNome(v) {
  if (v == null) return [null, null];
  const s = String(v).trim();
  const m = s.match(/^(\d+)\s*-\s*(.*)$/);
  if (!m) return [null, s || null];
  return [m[1], (m[2] || '').trim() || null];
}

// Número: aceita number nativo, "15.69" (en-US) e "1.234,56" (pt-BR).
function parseNum(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (s === '') return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) { const n = Number(s); return Number.isFinite(n) ? n : null; }
  const norm = s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(norm);
  return Number.isFinite(n) ? n : null;
}

// Data da coluna "Dia": Date, serial Excel ("46204") ou "DD/MM/AAAA" -> "YYYY-MM-DD"
function parseDia(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d+$/.test(s)) { // serial Excel (epoch 1899-12-30)
    const d = new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return null;
}

// Uma linha é FOLHA quando "Comprador" está preenchido e != "Total".
function isLeaf(r) {
  const c = r['Comprador'];
  return c != null && String(c).trim() !== '' && String(c).trim() !== 'Total';
}

function normalize(rawRows) {
  const out = [];
  let subtotais = 0, semData = 0, semChave = 0;
  for (const r of rawRows) {
    if (!isLeaf(r)) { subtotais++; continue; }
    const dia = parseDia(r['Dia']);
    if (!dia) { semData++; continue; }

    const rec = { dia };
    for (const [excel, [cCod, cNome]] of Object.entries(DIM_SPLIT)) {
      const [cod, nome] = splitCodNome(r[excel]);
      rec[cCod] = cod;
      rec[cNome] = nome;
    }
    // Jurídica não tem código ("JURÍDICA"/"FÍSICA")
    rec.juridica = r['Jurídica'] != null ? String(r['Jurídica']).trim() || null : null;
    // chave_secao no padrão "<cod> - <NOME>" (alinha com margem)
    rec.chave_secao = (rec.secao_cod && rec.secao_nome)
      ? `${rec.secao_cod} - ${rec.secao_nome}`
      : (rec.secao_nome || null);

    for (const [excel, target] of Object.entries(NUM_MAP)) {
      rec[target] = parseNum(r[excel]);
    }

    if (rec.filial_cod && rec.produto_cod) out.push(rec);
    else semChave++;
  }
  return { rows: out, subtotais, semData, semChave };
}

// ---------------------------------------------------------------- helpers
const fmt = (n) => Number(n).toLocaleString('pt-BR');

async function ingestFile(filePath, opts = {}) {
  const { batchSize, dryRun, prefix = '' } = opts;
  const fileName = path.basename(filePath);
  console.log(`${prefix}Arquivo: ${fileName}`);

  const t0 = Date.now();
  console.log(`${prefix}▸ Lendo planilha...`);
  const wb = XLSX.read(fs.readFileSync(filePath), { type: 'buffer', cellDates: true });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  const rawRows = XLSX.utils.sheet_to_json(ws, { raw: false, defval: null });
  console.log(`${prefix}  ${fmt(rawRows.length)} linhas brutas em "${sheetName}"`);

  console.log(`${prefix}▸ Normalizando...`);
  const { rows, subtotais, semData, semChave } = normalize(rawRows);
  const datas = [...new Set(rows.map(r => r.dia))].sort();
  console.log(`${prefix}  ${fmt(rows.length)} linhas folha válidas`);
  if (subtotais) console.log(`${prefix}  ${fmt(subtotais)} ignoradas (subtotais)`);
  if (semData)   console.log(`${prefix}  ${fmt(semData)} ignoradas (sem data em "Dia")`);
  if (semChave)  console.log(`${prefix}  ${fmt(semChave)} ignoradas (sem filial/produto)`);
  console.log(`${prefix}  Data(s): ${datas.join(', ') || '—'}`);
  if (datas.length > 1) console.log(`${prefix}  ⚠ AVISO: arquivo com mais de uma data.`);

  if (rows.length === 0) return { ok: false, msg: 'nenhuma linha folha válida' };

  if (dryRun) {
    console.log(`${prefix}\n  [DRY-RUN] amostra de 2 linhas normalizadas:`);
    console.log(JSON.stringify(rows.slice(0, 2), null, 2));
    return { ok: true, datas, inserted: 0, updated: 0, elapsedMs: Date.now() - t0 };
  }

  const cargaId = randomUUID();
  console.log(`${prefix}▸ Enviando ${Math.ceil(rows.length / batchSize)} lote(s)... (carga ${cargaId.slice(0, 8)})`);
  let totalIns = 0, totalUpd = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const lote = rows.slice(i, i + batchSize);
    const n = Math.floor(i / batchSize) + 1;
    const total = Math.ceil(rows.length / batchSize);
    process.stdout.write(`${prefix}  lote ${String(n).padStart(2)}/${total} (${lote.length})... `);
    const tLote = Date.now();
    const { data, error } = await supabase.rpc('fn_vendas_ingest', { p_rows: lote, p_carga_id: cargaId });
    if (error) {
      console.log('FALHOU');
      console.error(`${prefix}\nErro: ${error.message}`);
      if (error.details) console.error(`${prefix}  detalhes: ${error.details}`);
      return { ok: false, msg: error.message };
    }
    const r = Array.isArray(data) ? data[0] : data;
    const ins = Number(r?.inserted_count || 0);
    const upd = Number(r?.updated_count || 0);
    totalIns += ins; totalUpd += upd;
    console.log(`+${ins} novos, ~${upd} atualizados  (${((Date.now() - tLote) / 1000).toFixed(1)}s)`);
  }

  // Poda de órfãos: só depois de TODOS os lotes entrarem com sucesso.
  let removidos = 0;
  if (!noPrune) {
    process.stdout.write(`${prefix}▸ Removendo órfãos de ${datas.join(', ')}... `);
    const { data, error } = await supabase.rpc('fn_vendas_prune_orfaos', { p_dias: datas, p_carga_id: cargaId });
    if (error) {
      console.log('FALHOU');
      console.error(`${prefix}\nErro no prune: ${error.message}`);
      return { ok: false, msg: `prune: ${error.message}` };
    }
    removidos = Number(data || 0);
    console.log(`${removidos} removido(s)`);
  }

  console.log(`${prefix}✓ ${fmt(totalIns)} novos, ${fmt(totalUpd)} atualizados, ${fmt(removidos)} órfãos removidos em ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  return { ok: true, datas, inserted: totalIns, updated: totalUpd, removed: removidos, elapsedMs: Date.now() - t0 };
}

// ---------------------------------------------------------------- run
function maestroNum(name) {
  const m = name.match(/maestro[_-]?(\d+)/i);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
}
// arquivo intradia (carregado várias vezes ao dia): "maestro_dia.xlsx"
const isIntraday = (name) => /maestro[_-]?dia/i.test(name);

if (!inputIsDir) {
  const res = await ingestFile(inputPath, { batchSize, dryRun });
  if (!res.ok) { console.error(`\nFalhou: ${res.msg}`); process.exit(1); }
} else {
  const todos = fs.readdirSync(inputPath)
    .filter(n => /\.xlsx$/i.test(n))
    .filter(n => !n.startsWith('~$'))
    .filter(n => n.toLowerCase().includes(nameFilter.toLowerCase()));

  const intraday   = todos.filter(isIntraday);
  const historicos = todos.filter(n => !isIntraday(n));

  // Seleção:
  //   --full          -> tudo (backfill / recarga total)
  //   --dia           -> só o(s) maestro_dia
  //   (auto) se houver maestro_dia na pasta -> só ele (dias antigos já carregados)
  //   (auto) sem maestro_dia -> arquivos numerados (backfill)
  let selecionados, modo;
  if (full) {
    selecionados = todos;
    modo = 'completo (todos os arquivos)';
  } else if (soDia) {
    selecionados = intraday;
    modo = 'somente maestro_dia';
  } else if (intraday.length > 0) {
    selecionados = intraday;
    modo = `somente maestro_dia — pulando ${historicos.length} arquivo(s) de dias já carregados (use --full p/ recarregar tudo)`;
  } else {
    selecionados = historicos;
    modo = 'backfill (arquivos numerados)';
  }

  const arquivos = selecionados
    .sort((a, b) => maestroNum(a) - maestroNum(b))
    .map(n => path.join(inputPath, n));

  if (arquivos.length === 0) {
    console.error(`Nenhum arquivo a processar em ${inputPath} (modo: ${modo}).`);
    process.exit(1);
  }

  console.log(`Pasta:    ${inputPath}`);
  console.log(`Modo:     ${modo}`);
  console.log(`Arquivos: ${arquivos.length}${dryRun ? '  [DRY-RUN]' : ''}${continueOnError ? '  --continue-on-error' : ''}\n`);

  const tInicio = Date.now();
  let okCount = 0, failCount = 0, totIns = 0, totUpd = 0, totRem = 0;
  const falhas = [];
  for (let i = 0; i < arquivos.length; i++) {
    const prefix = `[${String(i + 1).padStart(2)}/${arquivos.length}] `;
    console.log('─'.repeat(60));
    const res = await ingestFile(arquivos[i], { batchSize, dryRun, prefix });
    if (res.ok) { okCount++; totIns += res.inserted || 0; totUpd += res.updated || 0; totRem += res.removed || 0; }
    else {
      failCount++; falhas.push({ name: path.basename(arquivos[i]), msg: res.msg });
      if (!continueOnError) { console.error(`\nAbortando — use --continue-on-error pra seguir.`); break; }
    }
  }

  console.log('═'.repeat(60));
  console.log(`Total: ${okCount} ok, ${failCount} falhou em ${((Date.now() - tInicio) / 1000).toFixed(1)}s`);
  console.log(`       ${fmt(totIns)} novos, ${fmt(totUpd)} atualizados, ${fmt(totRem)} órfãos removidos`);
  if (falhas.length) { console.log('\nFalhas:'); falhas.forEach(f => console.log(`  ${f.name} → ${f.msg}`)); }
  if (failCount > 0) process.exit(2);
}
