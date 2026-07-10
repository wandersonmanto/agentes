/**
 * Script de validação do mapeamento Firebase → Comprador.
 *
 * Estrutura real do Firestore (validada com o usuário em 2026-04-30):
 *   CONFIG/1-SECAO  é o ÚNICO documento; todas as seções são campos
 *   nele, no formato:
 *     "35 - CAMA E MESA": { comprador, comprador2, comprador3, ... }
 *
 * Uso (no PowerShell, dentro de scripts/):
 *
 *   node list-config.js                              # resumo geral
 *   node list-config.js secao "35 - CAMA E MESA"     # detalhe de uma seção
 *   node list-config.js comprador "CLEILDE FONSECA"  # seções desse comprador
 *   node list-config.js orfas                        # seções sem comprador válido
 *   node list-config.js typos                        # nomes que não batem com a lista oficial
 *   node list-config.js amostra 5                    # mostra 5 seções aleatórias completas
 *   node list-config.js dump                         # JSON inteiro do doc (debug)
 */
const path = require('path');
const admin = require('firebase-admin');

const KEY_PATH = path.resolve(__dirname, '..', '.secrets', 'firebase-service-account.json');
const CONFIG_DOC_ID = '1-SECAO';
const SEM_COMPRADOR = 'sem comprador';

const COMPRADORES_OFICIAIS = new Set([
  'DEUSELINA FERREIRA',
  'NAYANE',
  'IRIS LIRA',
  'PAULO RODRIGUES',
  'SILVANIA RODRIGUES',
  'DANIELE NUNES',
  'NAYLA MARIANA',
  'MARIA CLARA',
  'TEREZA OLIVEIRA',
  'CLEILDE FONSECA',
  'PADARIA',
]);

// ---------- helpers ----------
function pickValidBuyer(secaoConfig) {
  if (!secaoConfig) return null;
  for (const cand of [secaoConfig.comprador, secaoConfig.comprador2, secaoConfig.comprador3]) {
    if (!cand) continue;
    const norm = String(cand).trim();
    if (norm.toLowerCase() === SEM_COMPRADOR) continue;
    if (COMPRADORES_OFICIAIS.has(norm.toUpperCase())) return norm.toUpperCase();
  }
  return null;
}

function listarCompradoresDaSecao(cfg) {
  return [cfg.comprador, cfg.comprador2, cfg.comprador3]
    .map(c => (c == null ? '—' : String(c).trim()));
}

// ---------- comandos ----------
function cmdResumo(config) {
  const entries = Object.entries(config);
  console.log(`Total de seções: ${entries.length}`);

  const porComprador = new Map();
  let orfas = 0;
  for (const [chave, cfg] of entries) {
    const comp = pickValidBuyer(cfg);
    if (!comp) {
      orfas += 1;
      continue;
    }
    porComprador.set(comp, (porComprador.get(comp) || 0) + 1);
  }

  console.log(`Seções órfãs (sem comprador válido): ${orfas}`);
  console.log('---');
  console.log('Seções por comprador:');
  const ordenado = [...porComprador.entries()].sort((a, b) => b[1] - a[1]);
  for (const [nome, total] of ordenado) {
    console.log(`  ${nome.padEnd(22)} ${total}`);
  }

  // Compradores oficiais sem nenhuma seção
  const semSecoes = [...COMPRADORES_OFICIAIS].filter(n => !porComprador.has(n));
  if (semSecoes.length) {
    console.log('---');
    console.log('Compradores oficiais SEM seções atribuídas:');
    semSecoes.forEach(n => console.log(`  ${n}`));
  }
}

function cmdSecao(config, alvo) {
  if (!alvo) return console.log('Use: node list-config.js secao "35 - CAMA E MESA"');
  const cfg = config[alvo];
  if (!cfg) {
    console.log(`Seção "${alvo}" NÃO encontrada no doc.`);
    // dica: procurar por número
    const m = alvo.match(/^(\d+)/);
    if (m) {
      const num = m[1];
      const sugestoes = Object.keys(config).filter(k => k.startsWith(`${num} -`) || k.startsWith(num));
      if (sugestoes.length) {
        console.log('Você quis dizer alguma destas?');
        sugestoes.forEach(s => console.log(`  ${s}`));
      }
    }
    return;
  }
  console.log(`Seção: ${alvo}`);
  console.log(JSON.stringify(cfg, null, 2));
  console.log(`Comprador resolvido pelo matcher: ${pickValidBuyer(cfg) || '(nenhum válido)'}`);
}

function cmdComprador(config, alvo) {
  if (!alvo) return console.log('Use: node list-config.js comprador "CLEILDE FONSECA"');
  const alvoNorm = alvo.trim().toUpperCase();
  console.log(`Seções vinculadas a "${alvoNorm}":`);
  let count = 0;
  for (const [chave, cfg] of Object.entries(config)) {
    const compradores = listarCompradoresDaSecao(cfg).map(c => c.toUpperCase());
    if (!compradores.includes(alvoNorm)) continue;
    const efetivo = pickValidBuyer(cfg);
    const marca = efetivo === alvoNorm ? '✓ principal' : '  secundário';
    console.log(`  ${marca}  ${chave}   [${compradores.join(' | ')}]`);
    count += 1;
  }
  console.log('---');
  console.log(`Total: ${count}`);
}

function cmdOrfas(config) {
  console.log('Seções sem comprador válido:');
  let count = 0;
  for (const [chave, cfg] of Object.entries(config)) {
    if (pickValidBuyer(cfg)) continue;
    const c = listarCompradoresDaSecao(cfg).join(' | ');
    console.log(`  ${chave}    [${c}]`);
    count += 1;
  }
  console.log('---');
  console.log(`Total de órfãs: ${count}`);
}

function cmdTypos(config) {
  console.log('Nomes encontrados nos campos comprador*/comprador2/comprador3 que NÃO batem com a lista oficial:');
  const desconhecidos = new Map(); // nome -> seções
  for (const [chave, cfg] of Object.entries(config)) {
    for (const c of listarCompradoresDaSecao(cfg)) {
      const norm = c.trim();
      if (!norm || norm === '—') continue;
      if (norm.toLowerCase() === SEM_COMPRADOR) continue;
      const up = norm.toUpperCase();
      if (COMPRADORES_OFICIAIS.has(up)) continue;
      if (!desconhecidos.has(up)) desconhecidos.set(up, []);
      desconhecidos.get(up).push(chave);
    }
  }
  if (desconhecidos.size === 0) {
    console.log('  Nenhum. Todos os nomes batem com a lista oficial.');
    return;
  }
  for (const [nome, secoes] of desconhecidos) {
    console.log(`  "${nome}" — em: ${secoes.join(', ')}`);
    // Sugerir possível correção
    const candidatos = [...COMPRADORES_OFICIAIS].filter(of => {
      // distância simples: prefixo de 4 chars
      return of.slice(0, 4) === nome.slice(0, 4);
    });
    if (candidatos.length) {
      console.log(`     possível correção: ${candidatos.join(', ')}`);
    }
  }
}

function cmdAmostra(config, n = 3) {
  const keys = Object.keys(config);
  const N = Math.min(Number(n) || 3, keys.length);
  // sorteia sem repetir
  const escolhidas = [...keys].sort(() => Math.random() - 0.5).slice(0, N);
  for (const k of escolhidas) {
    console.log(`Seção: ${k}`);
    console.log(JSON.stringify(config[k], null, 2));
    console.log(`  → resolvido: ${pickValidBuyer(config[k]) || '(órfã)'}`);
    console.log('---');
  }
}

function cmdDump(config) {
  console.log(JSON.stringify(config, null, 2));
}

// ---------- main ----------
const serviceAccount = require(KEY_PATH);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

(async () => {
  const snap = await db.collection('CONFIG').doc(CONFIG_DOC_ID).get();
  if (!snap.exists) {
    console.error(`ERRO: doc CONFIG/${CONFIG_DOC_ID} não existe.`);
    process.exit(1);
  }
  const config = snap.data() || {};
  const [comando, ...args] = process.argv.slice(2);

  console.log(`Projeto: ${serviceAccount.project_id}`);
  console.log(`Doc: CONFIG/${CONFIG_DOC_ID}`);
  console.log('=====================================');

  switch ((comando || 'resumo').toLowerCase()) {
    case 'resumo':     cmdResumo(config); break;
    case 'secao':      cmdSecao(config, args.join(' ')); break;
    case 'comprador':  cmdComprador(config, args.join(' ')); break;
    case 'orfas':      cmdOrfas(config); break;
    case 'typos':      cmdTypos(config); break;
    case 'amostra':    cmdAmostra(config, args[0]); break;
    case 'dump':       cmdDump(config); break;
    default:
      console.log(`Comando desconhecido: ${comando}`);
      console.log('Comandos: resumo | secao "X" | comprador "X" | orfas | typos | amostra N | dump');
  }
  process.exit(0);
})().catch(err => {
  console.error('ERRO:', err.code || '', err.message);
  process.exit(1);
});
