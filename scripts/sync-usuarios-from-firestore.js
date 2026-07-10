/**
 * Sincroniza Firestore.users → Supabase.usuarios.
 *
 * Para cada doc em users com funcao='comprador':
 *   - Procura usuarios.nome = upper(doc.comprador)
 *   - Se achar, atualiza email_login = doc.id (que é o e-mail do Firebase Auth)
 *   - Se NÃO achar, ignora (e reporta) — só usuários da lista oficial são tocados
 *
 * Diretor é tratado separadamente: se houver doc com funcao='diretor', insere/atualiza
 * em usuarios usando doc.nome como nome do registro. Vincula em agente_usuario com
 * todos os agentes ativos.
 *
 * IMPORTANTE: Requer .env na raiz do projeto OU as variáveis no env do shell:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 *
 * Uso:
 *   node sync-usuarios-from-firestore.js              # dry-run (não escreve)
 *   node sync-usuarios-from-firestore.js --apply      # aplica as mudanças
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '..', 'backend', '.env') });
const path = require('path');
const admin = require('firebase-admin');
const { createClient } = require('@supabase/supabase-js');

const APPLY = process.argv.includes('--apply');
const KEY_PATH = path.resolve(__dirname, '..', '.secrets', 'firebase-service-account.json');

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Faltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no env.');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const serviceAccount = require(KEY_PATH);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

(async () => {
  console.log(`Modo: ${APPLY ? 'APPLY' : 'DRY-RUN'}`);
  console.log('---');

  // Carrega tudo do Firestore
  const snap = await db.collection('users').get();
  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

  // Carrega lista oficial do Supabase
  const { data: oficiais, error: errO } = await supabase
    .from('usuarios')
    .select('id, nome, email_login, papel');
  if (errO) throw errO;

  const oficialPorNome = new Map(oficiais.map(u => [u.nome, u]));

  let updates = [], skipped = [], naoEncontrados = [];

  // 1) Compradores
  for (const d of docs) {
    if ((d.funcao || '').toLowerCase() !== 'comprador') continue;
    const nomeOficial = String(d.comprador || '').trim().toUpperCase();
    if (!nomeOficial) { skipped.push({ id: d.id, motivo: 'doc sem campo comprador' }); continue; }

    const u = oficialPorNome.get(nomeOficial);
    if (!u) { naoEncontrados.push({ id: d.id, comprador: nomeOficial }); continue; }

    if (u.email_login === d.id) {
      skipped.push({ id: d.id, motivo: 'já está com email_login correto' });
      continue;
    }

    updates.push({ id: u.id, nome: u.nome, email_login: d.id });
  }

  console.log(`Compradores oficiais: ${oficiais.filter(o => o.papel === 'comprador').length}`);
  console.log(`Atualizações de email_login: ${updates.length}`);
  for (const u of updates) console.log(`  ${u.nome.padEnd(22)} → ${u.email_login}`);

  if (skipped.length) {
    console.log(`\nIgnorados: ${skipped.length}`);
    skipped.forEach(s => console.log(`  ${s.id} (${s.motivo})`));
  }
  if (naoEncontrados.length) {
    console.log(`\nDocs com 'comprador' que NÃO batem com lista oficial: ${naoEncontrados.length}`);
    naoEncontrados.forEach(n => console.log(`  ${n.id} → "${n.comprador}"`));
  }

  // 2) Diretor
  const diretores = docs.filter(d => (d.funcao || '').toLowerCase() === 'diretor');
  console.log(`\nDocs funcao='diretor' encontrados: ${diretores.length}`);

  for (const d of diretores) {
    const nome = (d.nome || d.comprador || '').toString().trim().toUpperCase() || d.id.toUpperCase();
    console.log(`  ${nome.padEnd(28)} → ${d.id}`);
    if (APPLY) {
      // Upsert do diretor: se nome existe, atualiza; senão insere.
      const { error } = await supabase.from('usuarios').upsert({
        nome, email_login: d.id, papel: 'diretor', ativo: true,
      }, { onConflict: 'nome' });
      if (error) console.error('  ! erro:', error.message);

      // Garante vínculo com TODOS os agentes ativos
      const { data: agentes } = await supabase.from('agentes').select('id').eq('ativo', true);
      const { data: usr } = await supabase.from('usuarios').select('id').eq('nome', nome).single();
      for (const a of agentes || []) {
        await supabase.from('agente_usuario')
          .upsert({ agente_id: a.id, usuario_id: usr.id, papel_no_agente: 'diretor' }, { onConflict: 'agente_id,usuario_id' });
      }
    }
  }

  // Aplica updates de compradores
  if (APPLY) {
    for (const u of updates) {
      const { error } = await supabase.from('usuarios').update({ email_login: u.email_login }).eq('id', u.id);
      if (error) console.error(`  ! erro em ${u.nome}:`, error.message);
    }
    console.log('\nAplicado.');
  } else {
    console.log('\n(dry-run; rode com --apply para aplicar)');
  }
  process.exit(0);
})().catch(err => {
  console.error('ERRO:', err.code || '', err.message);
  process.exit(1);
});
