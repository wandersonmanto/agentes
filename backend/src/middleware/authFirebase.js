/**
 * Middleware: verifica o ID Token do Firebase no header Authorization
 * e popula req.user = { uid, email, papel, usuario_id, nome }.
 */
import { firebaseAuth } from '../services/firebase.service.js';
import { supabase } from '../services/supabase.service.js';

export async function authFirebase(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Sem token' });

    const decoded = await firebaseAuth.verifyIdToken(token);

    // Casa Firebase user com a tabela usuarios via email_login
    const emailLogin = (decoded.email || '').toLowerCase();
    const { data: usuario, error } = await supabase
      .from('usuarios')
      .select('id, nome, email_login, papel, ativo, firebase_uid')
      .eq('email_login', emailLogin)
      .maybeSingle();

    if (error) throw error;
    if (!usuario || !usuario.ativo) {
      return res.status(403).json({ error: 'Usuário não cadastrado ou inativo' });
    }

    // Atualiza firebase_uid se ainda não vinculado (1ª vez do usuário)
    if (!usuario.firebase_uid) {
      await supabase.from('usuarios').update({ firebase_uid: decoded.uid }).eq('id', usuario.id);
    }

    req.user = {
      uid: decoded.uid,
      email_login: emailLogin,
      usuario_id: usuario.id,
      nome: usuario.nome,
      papel: usuario.papel,
    };
    next();
  } catch (err) {
    req.log?.error({ err }, 'authFirebase falhou');
    return res.status(401).json({ error: 'Token inválido', detail: err.message });
  }
}
