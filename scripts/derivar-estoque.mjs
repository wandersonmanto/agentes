#!/usr/bin/env node
/**
 * Reconstrói o estoque dos dias SEM arquivo (domingo, feriado...).
 *
 * O arquivo de estoque é uma foto e não pode ser gerado retroativamente —
 * o operador não trabalha domingo. Mas a VENDA do domingo nós temos, exata,
 * no maestro. Então:
 *
 *     estoque(domingo) = estoque(sábado) − vendas(domingo)
 *
 * Roda SEPARADO das cargas (não mexe em ingest-vendas nem em ingest-estoque).
 * Ordem correta na segunda-feira:
 *     1) ingest-vendas.mjs   (traz a venda de sábado e domingo)
 *     2) ingest-estoque.mjs  (traz a foto de segunda)
 *     3) derivar-estoque.mjs (preenche o domingo)
 *
 * Garantias:
 *   - uma foto REAL nunca é sobrescrita por uma derivada;
 *   - deriva sempre a partir do último snapshot REAL, descontando as vendas
 *     acumuladas desde ele (não encadeia derivado sobre derivado);
 *   - idempotente: se a venda do dia for corrigida, rode de novo e a linha
 *     derivada é recalculada;
 *   - não deriva se o último snapshot real estiver a mais de --max-chain
 *     dias (buraco longo = não inventar).
 *
 * Uso:
 *   node scripts/derivar-estoque.mjs                  # últimos 10 dias
 *   node scripts/derivar-estoque.mjs --from 2026-07-01 --to 2026-07-31
 *   node scripts/derivar-estoque.mjs --dias 30
 *   node scripts/derivar-estoque.mjs --max-chain 3
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const here = path.dirname(fileURLToPath(import.meta.url));
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
const arg = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const iso = (d) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const dias = Number(arg('--dias', 10));
const hoje = new Date();
const inicioPadrao = new Date(hoje); inicioPadrao.setDate(hoje.getDate() - dias);

const from = arg('--from', iso(inicioPadrao));
const to = arg('--to', iso(hoje));
const maxChain = Number(arg('--max-chain', 3));

if (!ISO.test(from) || !ISO.test(to)) {
  console.error('--from/--to devem ser YYYY-MM-DD');
  process.exit(1);
}

const env = loadEnv(path.join(repoRoot, 'backend', '.env'));
if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes em backend/.env');
  process.exit(1);
}
const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const fmtBR = (s) => {
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};
const DIA_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const semana = (s) => DIA_SEMANA[new Date(s + 'T12:00:00').getDay()];

console.log(`Intervalo:  ${fmtBR(from)} a ${fmtBR(to)}`);
console.log(`Arraste máx: ${maxChain} dia(s)`);
console.log(`(processando 1 dia por vez — cada chamada é curta, evita timeout)\n`);

// Lista os dias do intervalo e processa UM DE CADA VEZ. Derivar todos numa
// só chamada cruza ~62k produtos × vendas acumuladas por dia e estoura o
// statement_timeout do Supabase. Dia a dia, cada chamada é leve.
function* diasDoIntervalo(a, b) {
  const d = new Date(a + 'T12:00:00');
  const fim = new Date(b + 'T12:00:00');
  const p = (n) => String(n).padStart(2, '0');
  while (d <= fim) {
    yield `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    d.setDate(d.getDate() + 1);
  }
}

const t0 = Date.now();
let totalDias = 0, totalLinhas = 0, erros = 0;

for (const dia of diasDoIntervalo(from, to)) {
  let tentativa = 0, ok = false;
  while (tentativa < 3 && !ok) {
    tentativa++;
    const { data, error } = await supabase.rpc('fn_estoque_derivar_lacunas', {
      p_from: dia,
      p_to: dia,
      p_max_chain: maxChain,
    });
    if (error) {
      if (/timeout/i.test(error.message) && tentativa < 3) {
        console.log(`  ${fmtBR(dia)} (${semana(dia)})  timeout — tentando de novo (${tentativa}/3)...`);
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }
      console.error(`  ${fmtBR(dia)} (${semana(dia)})  ERRO: ${error.message}`);
      erros++;
      ok = true; // não insiste além das 3 tentativas
      break;
    }
    ok = true;
    const linhas = data || [];
    for (const r of linhas) {
      const n = Number(r.linhas_derivadas || 0);
      totalDias++; totalLinhas += n;
      console.log(
        `  ${fmtBR(r.data_derivada)} (${semana(r.data_derivada)})  ←  base ${fmtBR(r.base_snapshot)} (${semana(r.base_snapshot)})   ` +
        `${n.toLocaleString('pt-BR')} linha(s) derivada(s)`
      );
    }
  }
}

console.log(`\n✓ ${totalDias} dia(s) reconstruído(s), ${totalLinhas.toLocaleString('pt-BR')} linhas em ${((Date.now() - t0) / 1000).toFixed(1)}s`);
if (erros) console.log(`⚠ ${erros} dia(s) com erro — rode de novo só o intervalo que faltou.`);
if (totalDias === 0 && !erros) console.log('  (nenhuma lacuna: todos os dias já têm foto real, ou sem base recente para derivar)');
console.log('  (linhas marcadas com origem = "derivado"; a foto real, se vier depois, sobrescreve)');
