/**
 * Lista os usuários da coleção `users` no Firestore.
 *
 * Estrutura esperada do doc:
 *   users/{email_login}
 *     nome:               "Daniele Nunes"
 *     comprador:          "DANIELE NUNES"     // bate com lista oficial / CONFIG
 *     funcao:             "comprador" | "diretor" | ...
 *     whatsapp:           "5511..."
 *     loja:               "todas" | <especifica>
 *     setor:              [...]
 *     agentes:            ["margem", ...]      // (opcional, novo)
 *     email_notificacao:  "outro@email.com"    // (opcional, novo)
 *
 * Uso:
 *   node list-users.js                        # todos os docs
 *   node list-users.js compradores            # só funcao='comprador'
 *   node list-users.js diretores              # só funcao='diretor'
 *   node list-users.js agentes                # só docs com agentes != [] (vai receber)
 *   node list-users.js gaps                   # quem está na lista oficial mas NÃO tem doc
 */
const path = require('path');
const admin = require('firebase-admin');

const KEY_PATH = path.resolve(__dirname, '..', '.secrets', 'firebase-service-account.json');
const COMPRADORES_OFICIAIS = [
  'DEUSELINA FERREIRA','NAYANE','IRIS LIRA','PAULO RODRIGUES',
  'SILVANIA RODRIGUES','DANIELE NUNES','ILNARA MACIEL','MARIA CLARA',
  'TEREZA OLIVEIRA','CLEILDE FONSECA','PADARIA',
];

const serviceAccount = require(KEY_PATH);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const fmtAgentes = a => Array.isArray(a) ? `[${a.join(', ')}]` : (a == null ? '—' : String(a));

(async () => {
  const cmd = (process.argv[2] || 'all').toLowerCase();
  const snap = await db.collection('users').get();

  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  console.log(`Projeto: ${serviceAccount.project_id}`);
  console.log(`Total na coleção: ${docs.length}`);
  console.log('---');

  let lista = docs;
  if (cmd === 'compradores') lista = docs.filter(d => (d.funcao || '').toLowerCase() === 'comprador');
  if (cmd === 'diretores')   lista = docs.filter(d => (d.funcao || '').toLowerCase() === 'diretor');
  if (cmd === 'agentes')     lista = docs.filter(d => Array.isArray(d.agentes) && d.agentes.length > 0);

  if (cmd === 'gaps') {
    // Indexa docs por TODAS as chaves possíveis (comprador + nome).
    // Necessário porque supervisores/diretores costumam ter `comprador: "todos"`,
    // logo a busca tem que olhar também o campo `nome`.
    const docsByKey = new Map();
    for (const d of docs) {
      const cand = [d.comprador, d.nome]
        .map(v => (v == null ? '' : String(v).trim().toUpperCase()))
        .filter(v => v && v !== 'TODOS');
      for (const k of cand) {
        if (!docsByKey.has(k)) docsByKey.set(k, d);
      }
    }
    console.log('Compradores oficiais SEM doc em users/{email}:');
    let achei = 0;
    for (const oficial of COMPRADORES_OFICIAIS) {
      if (!docsByKey.has(oficial)) {
        console.log(`  ${oficial}`);
        achei += 1;
      }
    }
    if (!achei) console.log('  (nenhum) — todos os 11 oficiais têm doc.');
    return;
  }

  console.log(`Filtro: ${cmd}  |  resultado: ${lista.length}`);
  console.log('---');
  console.log('email_login (docId)'.padEnd(34), 'funcao'.padEnd(12), 'comprador (lista CONFIG)'.padEnd(26), 'agentes'.padEnd(20), 'whatsapp');
  for (const d of lista) {
    console.log(
      String(d.id).padEnd(34),
      String(d.funcao || '—').padEnd(12),
      String(d.comprador || '—').padEnd(26),
      fmtAgentes(d.agentes).padEnd(20),
      String(d.whatsapp || '—'),
    );
  }
  process.exit(0);
})().catch(err => {
  console.error('ERRO:', err.code || '', err.message);
  process.exit(1);
});
