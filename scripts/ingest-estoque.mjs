#!/usr/bin/env node
/**
 * Ingestão do estoque diário ("estoque.xlsx").
 *
 * O arquivo é uma FOTO do estoque no grão produto × filial e NÃO tem coluna
 * de data. Diferente do maestro (onde o nome é só controle visual, pois a
 * data está na coluna "Dia"), aqui o NOME DO ARQUIVO é a única fonte da data.
 * Por isso ele precisa da data COMPLETA — "estoque_1" seria ambíguo (que mês?
 * que ano?) e produziria carimbo errado ao carregar com atraso ou reprocessar.
 *
 * Nome recomendado:  estoque_2026-07-13.xlsx   (ISO — ordena cronologicamente)
 * Também aceito:     estoque_13-07-2026.xlsx   (BR)
 *
 * Prioridade da data: --date > data no nome > hoje (com aviso em destaque).
 *
 * ATENÇÃO ao layout: o cabeçalho traz "Custo Médio (R$)" DUAS vezes (a 2ª é,
 * na verdade, o Custo Total do Estoque) e o código de barras vem numa coluna
 * deslocada. Por isso mapeamos por ÍNDICE de coluna, não por nome — mapear
 * por nome faria a chave duplicada sobrescrever o custo unitário.
 *
 * Uso:
 *   node scripts/ingest-estoque.mjs <arquivo.xlsx>
 *   node scripts/ingest-estoque.mjs <pasta>            # arquivos *estoque*.xlsx
 *
 * Flags:
 *   [--date YYYY-MM-DD]    data do snapshot (default: hoje)
 *   [--batch 2000]         linhas por chamada ao RPC
 *   [--dry-run]            só parseia; não envia
 *   [--no-prune]           não remove linhas órfãs do snapshot
 *   [--continue-on-error]  em modo pasta, segue se um arquivo falhar
 *
 * Idempotente: upsert por (data, filial, produto) + prune por carga_id.
 * Recarregar o mesmo dia substitui o snapshot daquele dia por completo.
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
const flag = (n) => args.includes(n);
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const positional = args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));

const inputPath = positional[0];
const batchSize = Number(arg('--batch', 2000));
const dryRun = flag('--dry-run');
const noPrune = flag('--no-prune');
const continueOnError = flag('--continue-on-error');
const dateArg = arg('--date', null);

if (!inputPath) {
  console.error(`Uso:
  node scripts/ingest-estoque.mjs <arquivo.xlsx>
  node scripts/ingest-estoque.mjs <pasta>

  [--date YYYY-MM-DD]    força a data (senão lê do NOME do arquivo)
  [--batch 2000]         linhas por chamada ao RPC
  [--dry-run]            só parseia; não envia
  [--no-prune]           não remove órfãos do snapshot
  [--continue-on-error]  em modo pasta, segue se um arquivo falhar

  O estoque não tem data interna: nomeie como "estoque_AAAA-MM-DD.xlsx"
  (ex.: estoque_2026-07-13.xlsx). Em modo pasta, cada arquivo é carregado
  com a SUA data — dá para carregar vários dias de uma vez.`);
  process.exit(1);
}
if (!fs.existsSync(inputPath)) {
  console.error(`Caminho não encontrado: ${inputPath}`);
  process.exit(1);
}
if (dateArg && !/^\d{4}-\d{2}-\d{2}$/.test(dateArg)) {
  console.error('--date deve ser YYYY-MM-DD');
  process.exit(1);
}
const inputIsDir = fs.statSync(inputPath).isDirectory();

function hojeISO() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/**
 * Data do snapshot a partir do NOME do arquivo.
 *
 * Diferente do maestro (que traz a data numa coluna), o arquivo de estoque
 * NÃO tem data dentro. O nome é a única fonte da verdade — por isso ele
 * precisa da data COMPLETA (dia, mês e ano). "estoque_1" seria ambíguo.
 *
 * Aceita:
 *   estoque_2026-07-13.xlsx   (ISO — recomendado, ordena cronologicamente)
 *   estoque_13-07-2026.xlsx   (BR)
 *   estoque_20260713.xlsx
 */
function dateFromFilename(name) {
  let m = name.match(/(\d{4})-(\d{2})-(\d{2})/);            // ISO
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  m = name.match(/(\d{2})[-_.](\d{2})[-_.](\d{4})/);        // BR dd-mm-yyyy
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;

  m = name.match(/(\d{4})(\d{2})(\d{2})/);                  // yyyymmdd
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;

  return null;
}

/** Prioridade: --date  >  data no nome do arquivo  >  hoje (com aviso). */
function resolveData(fileName) {
  if (dateArg) return { data: dateArg, fonte: '--date' };
  const doNome = dateFromFilename(fileName);
  if (doNome) return { data: doNome, fonte: 'nome do arquivo' };
  return { data: hojeISO(), fonte: 'HOJE (nome sem data!)' };
}

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

// ---------------------------------------------------------------- layout
// Mapa por ÍNDICE de coluna (0-based), conforme o layout do estoque.xlsx.
const COL = {
  filial: 1,
  departamento: 2,
  secao: 3,
  produto: 4,
  disponivel: 5,
  reservada: 6,
  total_estoque: 7,
  custo_medio: 8,             // unitário
  custo_total_disponivel: 9,
  custo_total_reservado: 10,
  custo_total_estoque: 11,    // cabeçalho repete "Custo Médio (R$)", mas é o total
  cod_barras: 13,             // vem deslocado (rótulo "Prod. C/ Estoque")
};
// Rótulos esperados, para detectar mudança de layout.
const HEADER_ESPERADO = ['Filial', 'Departamento', 'Seção', 'Produto', 'Disponível', 'Reservada', 'Total Estoque'];

function splitCodNome(v) {
  if (v == null) return [null, null];
  const s = String(v).trim();
  const m = s.match(/^(\d+)\s*-\s*(.*)$/);
  if (!m) return [null, s || null];
  return [m[1], (m[2] || '').trim() || null];
}
function parseNum(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  if (s === '') return null;
  if (/^-?\d+(\.\d+)?$/.test(s)) { const n = Number(s); return Number.isFinite(n) ? n : null; }
  const n = Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s);
  return Number.isFinite(n) ? n : null;
}

function normalize(rows, dataSnapshot) {
  const out = [];
  let semChave = 0;
  for (const r of rows) {
    const [filial_cod, filial_nome]             = splitCodNome(r[COL.filial]);
    const [produto_cod, produto_nome]           = splitCodNome(r[COL.produto]);
    const [departamento_cod, departamento_nome] = splitCodNome(r[COL.departamento]);
    const [secao_cod, secao_nome]               = splitCodNome(r[COL.secao]); // já faz trim

    if (!filial_cod || !produto_cod) { semChave++; continue; }

    const cb = r[COL.cod_barras];
    out.push({
      data: dataSnapshot,
      filial_cod, filial_nome,
      departamento_cod, departamento_nome,
      secao_cod, secao_nome,
      chave_secao: (secao_cod && secao_nome) ? `${secao_cod} - ${secao_nome}` : (secao_nome || null),
      produto_cod, produto_nome,
      cod_barras: cb == null || cb === '' ? null : String(cb).replace(/\.0+$/, ''),
      disponivel:             parseNum(r[COL.disponivel]),
      reservada:              parseNum(r[COL.reservada]),
      total_estoque:          parseNum(r[COL.total_estoque]),
      custo_medio:            parseNum(r[COL.custo_medio]),
      custo_total_disponivel: parseNum(r[COL.custo_total_disponivel]),
      custo_total_reservado:  parseNum(r[COL.custo_total_reservado]),
      custo_total_estoque:    parseNum(r[COL.custo_total_estoque]),
    });
  }
  return { rows: out, semChave };
}

const fmt = (n) => Number(n).toLocaleString('pt-BR');

async function ingestFile(filePath, prefix = '') {
  const fileName = path.basename(filePath);
  const { data: dataSnapshot, fonte } = resolveData(fileName);

  console.log(`${prefix}Arquivo:  ${fileName}`);
  console.log(`${prefix}Snapshot: ${dataSnapshot}  (${fonte})`);
  if (fonte.startsWith('HOJE')) {
    console.warn(`${prefix}⚠ AVISO: o nome do arquivo não tem data, então estou carimbando HOJE.`);
    console.warn(`${prefix}  O estoque não tem data interna — se este arquivo for de outro dia, o`);
    console.warn(`${prefix}  carimbo fica ERRADO. Renomeie para "estoque_AAAA-MM-DD.xlsx" ou use --date.`);
  }

  const t0 = Date.now();
  const wb = XLSX.read(fs.readFileSync(filePath), { type: 'buffer' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  // header:1 -> matriz (evita colisão do cabeçalho duplicado "Custo Médio (R$)")
  const matriz = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null });
  if (matriz.length < 2) return { ok: false, msg: 'planilha vazia' };

  // valida layout
  const head = matriz[0].map(v => String(v ?? '').trim());
  const faltando = HEADER_ESPERADO.filter(h => !head.includes(h));
  if (faltando.length) {
    return { ok: false, msg: `layout inesperado — colunas ausentes: ${faltando.join(', ')}` };
  }

  const dados = matriz.slice(1).filter(r => r && r.some(v => v != null && v !== ''));
  console.log(`${prefix}  ${fmt(dados.length)} linhas brutas`);

  const { rows, semChave } = normalize(dados, dataSnapshot);
  console.log(`${prefix}  ${fmt(rows.length)} linhas válidas`);
  if (semChave) console.log(`${prefix}  ${fmt(semChave)} ignoradas (sem filial/produto)`);
  if (rows.length === 0) return { ok: false, msg: 'nenhuma linha válida' };

  if (dryRun) {
    console.log(`${prefix}\n  [DRY-RUN] amostra de 2 linhas:`);
    console.log(JSON.stringify(rows.slice(0, 2), null, 2));
    const porFilial = {};
    for (const r of rows) porFilial[r.filial_cod] = (porFilial[r.filial_cod] || 0) + 1;
    console.log(`${prefix}  itens por filial:`, porFilial);
    return { ok: true, inserted: 0, updated: 0, removed: 0 };
  }

  const cargaId = randomUUID();
  console.log(`${prefix}▸ Enviando ${Math.ceil(rows.length / batchSize)} lote(s)... (carga ${cargaId.slice(0, 8)})`);
  let ins = 0, upd = 0;
  for (let i = 0; i < rows.length; i += batchSize) {
    const lote = rows.slice(i, i + batchSize);
    const n = Math.floor(i / batchSize) + 1;
    const total = Math.ceil(rows.length / batchSize);
    process.stdout.write(`${prefix}  lote ${String(n).padStart(2)}/${total} (${lote.length})... `);
    const { data, error } = await supabase.rpc('fn_estoque_ingest', { p_rows: lote, p_carga_id: cargaId });
    if (error) {
      console.log('FALHOU');
      console.error(`${prefix}\nErro: ${error.message}`);
      return { ok: false, msg: error.message };
    }
    const r = Array.isArray(data) ? data[0] : data;
    ins += Number(r?.inserted_count || 0);
    upd += Number(r?.updated_count || 0);
    console.log('ok');
  }

  let removidos = 0;
  if (!noPrune) {
    process.stdout.write(`${prefix}▸ Removendo órfãos de ${dataSnapshot}... `);
    const { data, error } = await supabase.rpc('fn_estoque_prune_orfaos', {
      p_datas: [dataSnapshot], p_carga_id: cargaId,
    });
    if (error) {
      console.log('FALHOU');
      console.error(`${prefix}Erro no prune: ${error.message}`);
      return { ok: false, msg: `prune: ${error.message}` };
    }
    removidos = Number(data || 0);
    console.log(`${removidos} removido(s)`);
  }

  console.log(`${prefix}✓ ${fmt(ins)} novos, ${fmt(upd)} atualizados, ${fmt(removidos)} órfãos removidos em ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  return { ok: true, inserted: ins, updated: upd, removed: removidos };
}

// ---------------------------------------------------------------- run
if (!inputIsDir) {
  const res = await ingestFile(inputPath);
  if (!res.ok) { console.error(`\nFalhou: ${res.msg}`); process.exit(1); }
} else {
  const arquivos = fs.readdirSync(inputPath)
    .filter(n => /\.xlsx$/i.test(n))
    .filter(n => !n.startsWith('~$'))
    .filter(n => n.toLowerCase().includes('estoque'))
    .sort()
    .map(n => path.join(inputPath, n));

  if (arquivos.length === 0) {
    console.error(`Nenhum *.xlsx contendo "estoque" em ${inputPath}`);
    process.exit(1);
  }
  console.log(`Pasta:    ${inputPath}`);
  console.log(`Arquivos: ${arquivos.length}${dryRun ? '  [DRY-RUN]' : ''}\n`);

  let ok = 0, fail = 0;
  for (let i = 0; i < arquivos.length; i++) {
    console.log('─'.repeat(60));
    const res = await ingestFile(arquivos[i], `[${i + 1}/${arquivos.length}] `);
    if (res.ok) ok++;
    else {
      fail++;
      if (!continueOnError) { console.error('\nAbortando — use --continue-on-error.'); break; }
    }
  }
  console.log('═'.repeat(60));
  console.log(`Total: ${ok} ok, ${fail} falhou`);
  if (fail > 0) process.exit(2);
}
