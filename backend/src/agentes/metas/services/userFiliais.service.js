/**
 * Resolve as filiais que um usuário pode visualizar.
 *
 * Fonte de verdade ÚNICA: Firestore `users/{email}` campo `loja`.
 *   - String "todas" (case-insensitive)        → vê tudo (wildcard)
 *   - Array contendo "todas"                   → vê tudo (wildcard)
 *   - Array de strings (ex.: ['305 - ...'])    → vê só essas
 *   - String única (ex.: '305')                → vê só essa
 *   - Ausente / vazio                          → não vê nada
 *
 * A regra vale para TODOS os papéis (diretor, supervisor, gerente,
 * comprador) — quem decide é `loja`. Diretor sem "todas" só vê o que
 * tiver no array. Padronização escolhida em 2026-05-18 com o usuário.
 *
 * Devolve { wildcard: boolean, filiais: string[] } com códigos
 * normalizados (apenas o número da filial — ex.: '305').
 */
import { firestore } from '../../../services/firebase.service.js';
import { logger } from '../../../config/logger.js';
import { extractFilialCod } from '../utils/calcTendencia.js';

const SENTINEL_TODAS = 'todas';

export async function resolveFiliaisDoUsuario({ emailLogin }) {
  if (!emailLogin) {
    return { wildcard: false, filiais: [] };
  }

  try {
    const snap = await firestore.collection('users').doc(emailLogin.toLowerCase()).get();
    if (!snap.exists) {
      logger.warn({ emailLogin }, '[metas] users/{email} não encontrado no Firestore');
      return { wildcard: false, filiais: [] };
    }
    const data = snap.data() || {};
    const raw  = data.loja;

    // String "todas"
    if (typeof raw === 'string' && raw.trim().toLowerCase() === SENTINEL_TODAS) {
      return { wildcard: true, filiais: [] };
    }

    // String única — embrulha em array
    const arr = Array.isArray(raw) ? raw : (raw == null || raw === '' ? [] : [raw]);

    // Verifica se algum item é o sentinel
    if (arr.some(x => String(x).trim().toLowerCase() === SENTINEL_TODAS)) {
      return { wildcard: true, filiais: [] };
    }

    const filiais = arr
      .map(extractFilialCod)
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i);   // unique

    return { wildcard: false, filiais };
  } catch (err) {
    logger.error({ err, emailLogin }, '[metas] erro lendo users/{email}.loja');
    return { wildcard: false, filiais: [] };
  }
}

/** Lista TODAS as filiais já vistas em snapshots (para o wildcard montar query). */
export async function listAllFiliais(supabase) {
  const { data, error } = await supabase
    .from('metas_snapshots')
    .select('filial_cod')
    .eq('nivel', 'loja');
  if (error) throw error;
  return [...new Set((data || []).map(r => r.filial_cod))];
}
