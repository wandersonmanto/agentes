/**
 * Rotas do agente metas.
 * Prefixo: /agente/metas
 *
 * Endpoints:
 *   POST /run                       — sync (protegido por X-Sync-Token)
 *   GET  /lista                     — itens em risco, filtrados pela filial do usuário
 *   GET  /resumo-filial             — resumo por filial (alimenta WhatsApp do n8n)
 *   GET  /filiais-do-usuario/:email — (n8n) resolve filiais permitidas pra um e-mail
 */
import { Router } from 'express';
import { authFirebase } from '../../middleware/authFirebase.js';
import { requireSyncToken } from '../../middleware/requireSyncToken.js';
import { supabase } from '../../services/supabase.service.js';
import { logger } from '../../config/logger.js';
import { runSync } from './services/syncJob.service.js';
import { resolveFiliaisDoUsuario } from './services/userFiliais.service.js';

export const metasRouter = Router();

/** POST /agente/metas/run — disparado pelo n8n (1x ao dia). */
metasRouter.post('/run', requireSyncToken, async (_req, res, next) => {
  try {
    const result = await runSync({ origem: 'n8n' });
    res.json(result);
  } catch (err) { next(err); }
});

/**
 * GET /agente/metas/lista
 *   ?nivel=loja|setor|departamento|secao   (default: todos os 4)
 *   ?somente_risco=true|false              (default: true)
 *   ?filial=305                            (opcional — limita ainda mais)
 *   ?data=YYYY-MM-DD                       (default: snapshot mais recente)
 *
 * Filtra pelas filiais do usuário (Firestore users/{email}.loja).
 * Diretor/admin/supervisor veem todas as filiais.
 */
metasRouter.get('/lista', authFirebase, async (req, res, next) => {
  try {
    const nivel        = req.query.nivel || null;
    const somenteRisco = String(req.query.somente_risco ?? 'true').toLowerCase() !== 'false';
    const filialQuery  = (req.query.filial || '').toString().trim() || null;
    const data         = (req.query.data || '').toString().trim() || null;

    const { wildcard, filiais } = await resolveFiliaisDoUsuario({
      emailLogin: req.user.email_login,
    });

    if (!wildcard && filiais.length === 0) {
      return res.json([]);   // usuário sem filiais atribuídas
    }

    let query = supabase.from(data ? 'metas_snapshots' : 'vw_metas_atual').select('*');

    if (data) query = query.eq('snapshot_date', data);
    if (nivel) query = query.eq('nivel', nivel);
    if (somenteRisco) query = query.eq('em_risco', true);

    if (filialQuery) {
      // Usuário pediu uma filial específica — checa se está no escopo dele
      if (!wildcard && !filiais.includes(filialQuery)) {
        return res.status(403).json({ error: 'Filial fora do seu escopo' });
      }
      query = query.eq('filial_cod', filialQuery);
    } else if (!wildcard) {
      query = query.in('filial_cod', filiais);
    }

    // Ordena: lojas primeiro, depois pelas mais distantes da meta
    query = query.order('nivel', { ascending: true })
                 .order('percent_atingido', { ascending: true, nullsFirst: false });

    const { data: rows, error } = await query;
    if (error) throw error;
    res.json(rows || []);
  } catch (err) { next(err); }
});

/**
 * GET /agente/metas/resumo-filial
 * Devolve 1 linha por filial (do escopo do usuário) com contagens de risco
 * e estado consolidado da loja. Alimenta tanto a "home" interna do agente
 * quanto o resumo diário do n8n.
 */
metasRouter.get('/resumo-filial', authFirebase, async (req, res, next) => {
  try {
    const { wildcard, filiais } = await resolveFiliaisDoUsuario({
      emailLogin: req.user.email_login,
    });
    if (!wildcard && filiais.length === 0) return res.json([]);

    let q = supabase.from('vw_metas_resumo_por_filial').select('*');
    if (!wildcard) q = q.in('filial_cod', filiais);
    q = q.order('filial_cod', { ascending: true });

    const { data, error } = await q;
    if (error) throw error;
    res.json(data || []);
  } catch (err) { next(err); }
});

/**
 * GET /agente/metas/filiais-do-usuario/:email
 *
 * Endpoint utilitário para o n8n: dado um e-mail, devolve qual o escopo
 * de filiais (e os respectivos resumos). Protegido por sync token —
 * NÃO usa authFirebase porque o n8n não tem token de usuário.
 */
metasRouter.get('/filiais-do-usuario/:email', requireSyncToken, async (req, res, next) => {
  try {
    const email = (req.params.email || '').toLowerCase();
    if (!email) return res.status(400).json({ error: 'email obrigatório' });

    // Para o n8n, descobrir papel: lê de usuarios
    const { data: usuario } = await supabase
      .from('usuarios')
      .select('id, nome, papel, ativo')
      .eq('email_login', email)
      .maybeSingle();
    if (!usuario || !usuario.ativo) {
      return res.json({ email, wildcard: false, filiais: [], resumo: [] });
    }

    const { wildcard, filiais } = await resolveFiliaisDoUsuario({
      emailLogin: email,
    });

    let q = supabase.from('vw_metas_resumo_por_filial').select('*');
    if (!wildcard) q = q.in('filial_cod', filiais);
    const { data: resumo, error } = await q;
    if (error) throw error;

    res.json({
      email,
      usuario_id: usuario.id,
      nome: usuario.nome,
      papel: usuario.papel,
      wildcard,
      filiais,
      resumo: resumo || [],
    });
  } catch (err) { next(err); }
});

logger.info('Rotas /agente/metas carregadas');
