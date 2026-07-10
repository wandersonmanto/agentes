/**
 * Rotas do agente comparativo313.
 * Prefixo: /agente/comparativo313
 *
 * Endpoints:
 *   POST /run                       — sync (protegido por X-Sync-Token)
 *   GET  /lista                     — rupturas escopadas ao usuário logado
 *   GET  /resumo-filial             — resumo agregado por filial (diretor/supervisor)
 *   GET  /resumo-responsavel        — resumo agregado por comprador (admin)
 *   GET  /escopo-do-usuario/:email  — utilitário p/ n8n (resumo do usuário pelo e-mail)
 */
import { Router } from 'express';
import { authFirebase } from '../../middleware/authFirebase.js';
import { requirePapel } from '../../middleware/requirePapel.js';
import { requireSyncToken } from '../../middleware/requireSyncToken.js';
import { supabase } from '../../services/supabase.service.js';
import { logger } from '../../config/logger.js';
import { runSync } from './services/syncJob.service.js';
import { resolveFiliaisDoUsuario } from '../metas/services/userFiliais.service.js';

export const comparativo313Router = Router();

/** POST /agente/comparativo313/run — disparo manual ou cron via n8n. */
comparativo313Router.post('/run', requireSyncToken, async (_req, res, next) => {
  try {
    const result = await runSync({ origem: 'n8n' });
    res.json(result);
  } catch (err) { next(err); }
});

/**
 * GET /agente/comparativo313/lista
 *   ?filial=302        (opcional — limita ainda mais o que o usuário já vê)
 *   ?status=pendente|resolvida|todas   (default: pendente)
 *
 * Escopo:
 *   - diretor/supervisor/admin  → tudo
 *   - gerente                   → suas filiais (Firestore users/{email}.loja)
 *   - comprador                 → suas seções (via N:N)
 */
comparativo313Router.get('/lista', authFirebase, async (req, res, next) => {
  try {
    const filialQuery = (req.query.filial || '').toString().trim() || null;
    const statusReq   = (req.query.status || 'pendente').toString().toLowerCase();
    const statusFilter = statusReq === 'todas' ? null : statusReq;

    const papel = req.user.papel;

    // 1. Define escopo de filial pelo papel
    let filiaisEscopo  = null;   // null = sem restrição por filial
    let restringirPorN_N = false;

    if (papel === 'gerente') {
      const { wildcard, filiais } = await resolveFiliaisDoUsuario({
        emailLogin: req.user.email_login,
      });
      if (wildcard) {
        filiaisEscopo = null;     // gerente "todas" — improvável mas suportado
      } else if (filiais.length === 0) {
        return res.json([]);
      } else {
        filiaisEscopo = filiais;
      }
    } else if (papel === 'comprador') {
      restringirPorN_N = true;
    }
    // diretor/supervisor/admin: sem restrição

    // 2. Filial pedida explicitamente — só permite se está no escopo
    if (filialQuery) {
      if (filiaisEscopo && !filiaisEscopo.includes(filialQuery)) {
        return res.status(403).json({ error: 'Filial fora do seu escopo' });
      }
      filiaisEscopo = [filialQuery];
    }

    // 3. Restrição por N:N (comprador) — busca primeiro os produto_ids dele
    let produtoIds = null;
    if (restringirPorN_N) {
      const { data: links, error: errL } = await supabase
        .from('comparativo313_produto_compradores')
        .select('produto_id')
        .eq('usuario_id', req.user.usuario_id);
      if (errL) throw errL;
      produtoIds = (links || []).map(l => l.produto_id);
      if (produtoIds.length === 0) return res.json([]);
    }

    // 4. Consulta principal
    let q = supabase.from('comparativo313_rupturas').select('*');
    if (statusFilter)   q = q.eq('status', statusFilter);
    if (filiaisEscopo)  q = q.in('filial_cod', filiaisEscopo);
    if (produtoIds)     q = q.in('id', produtoIds);

    q = q
      .order('filial_cod', { ascending: true })
      .order('estoque_deposito', { ascending: false });

    const { data, error } = await q;
    if (error) throw error;
    res.json(data || []);
  } catch (err) { next(err); }
});

/**
 * GET /agente/comparativo313/resumo-filial
 * Devolve 1 linha por filial (dentro do escopo do usuário).
 * Para diretor/supervisor/admin (e gerente, filtrado).
 */
comparativo313Router.get('/resumo-filial', authFirebase, async (req, res, next) => {
  try {
    const papel = req.user.papel;
    let filiaisEscopo = null;

    if (papel === 'gerente') {
      const { wildcard, filiais } = await resolveFiliaisDoUsuario({
        emailLogin: req.user.email_login,
      });
      if (!wildcard) {
        if (filiais.length === 0) return res.json([]);
        filiaisEscopo = filiais;
      }
    } else if (papel === 'comprador') {
      // Comprador não vê resumo por filial — esse dado é da diretoria/gerência.
      return res.status(403).json({ error: 'Visão por filial não disponível para comprador' });
    }

    let q = supabase.from('vw_comparativo313_resumo_filial').select('*');
    if (filiaisEscopo) q = q.in('filial_cod', filiaisEscopo);
    q = q.order('filial_cod', { ascending: true });

    const { data, error } = await q;
    if (error) throw error;
    res.json(data || []);
  } catch (err) { next(err); }
});

/**
 * GET /agente/comparativo313/resumo-responsavel
 * Resumo agregado por comprador — para diretor/admin enxergarem a
 * distribuição da ruptura entre as carteiras.
 */
comparativo313Router.get(
  '/resumo-responsavel',
  authFirebase,
  requirePapel('diretor', 'admin', 'supervisor'),
  async (_req, res, next) => {
    try {
      const { data, error } = await supabase
        .from('vw_comparativo313_resumo_responsavel')
        .select('*');
      if (error) throw error;
      res.json(data || []);
    } catch (err) { next(err); }
  },
);

/**
 * GET /agente/comparativo313/escopo-do-usuario/:email
 *
 * Utilitário para o n8n: dado um e-mail, devolve o resumo de ruptura
 * com base no papel do usuário (sem JWT, autenticado por sync token).
 */
comparativo313Router.get('/escopo-do-usuario/:email', requireSyncToken, async (req, res, next) => {
  try {
    const email = (req.params.email || '').toLowerCase();
    if (!email) return res.status(400).json({ error: 'email obrigatório' });

    const { data: usuario } = await supabase
      .from('usuarios')
      .select('id, nome, papel, ativo')
      .eq('email_login', email)
      .maybeSingle();
    if (!usuario || !usuario.ativo) {
      return res.json({ email, papel: null, totais: null, por_filial: [], por_comprador: null });
    }

    // 1) Comprador — usa view por responsável (1 linha p/ ele)
    if (usuario.papel === 'comprador') {
      const { data: meu } = await supabase
        .from('vw_comparativo313_resumo_responsavel')
        .select('*')
        .eq('usuario_id', usuario.id)
        .maybeSingle();

      const { data: porFilial } = await supabase
        .from('vw_comparativo313_resumo_filial_comprador')
        .select('*')
        .eq('usuario_id', usuario.id)
        .order('filial_cod', { ascending: true });

      return res.json({
        email,
        usuario_id: usuario.id,
        nome:  usuario.nome,
        papel: usuario.papel,
        totais: meu || {
          usuario_id: usuario.id,
          rupturas_pendentes: 0,
          filiais_afetadas: 0,
          estoque_total_deposito: 0,
        },
        por_filial: porFilial || [],
      });
    }

    // 2) Diretor/supervisor/admin — agregado por filial inteiro
    if (['diretor', 'supervisor', 'admin'].includes(usuario.papel)) {
      const { data: porFilial, error } = await supabase
        .from('vw_comparativo313_resumo_filial')
        .select('*')
        .order('filial_cod', { ascending: true });
      if (error) throw error;
      const totais = (porFilial || []).reduce((acc, r) => {
        acc.rupturas_pendentes     += Number(r.rupturas_pendentes || 0);
        acc.com_estoque_deposito   += Number(r.com_estoque_deposito || 0);
        acc.estoque_total_deposito += Number(r.estoque_total_deposito || 0);
        return acc;
      }, { rupturas_pendentes: 0, com_estoque_deposito: 0, estoque_total_deposito: 0 });
      return res.json({
        email, usuario_id: usuario.id, nome: usuario.nome, papel: usuario.papel,
        totais,
        por_filial: porFilial || [],
      });
    }

    // 3) Gerente — filtra por filiais do users/{email}.loja
    if (usuario.papel === 'gerente') {
      const { wildcard, filiais } = await resolveFiliaisDoUsuario({ emailLogin: email });
      let q = supabase.from('vw_comparativo313_resumo_filial').select('*');
      if (!wildcard) {
        if (filiais.length === 0) {
          return res.json({
            email, usuario_id: usuario.id, nome: usuario.nome, papel: usuario.papel,
            totais: { rupturas_pendentes: 0, com_estoque_deposito: 0, estoque_total_deposito: 0 },
            por_filial: [],
          });
        }
        q = q.in('filial_cod', filiais);
      }
      const { data: porFilial, error } = await q.order('filial_cod', { ascending: true });
      if (error) throw error;
      const totais = (porFilial || []).reduce((acc, r) => {
        acc.rupturas_pendentes     += Number(r.rupturas_pendentes || 0);
        acc.com_estoque_deposito   += Number(r.com_estoque_deposito || 0);
        acc.estoque_total_deposito += Number(r.estoque_total_deposito || 0);
        return acc;
      }, { rupturas_pendentes: 0, com_estoque_deposito: 0, estoque_total_deposito: 0 });
      return res.json({
        email, usuario_id: usuario.id, nome: usuario.nome, papel: usuario.papel,
        totais, por_filial: porFilial || [],
      });
    }

    return res.json({ email, papel: usuario.papel, totais: null, por_filial: [] });
  } catch (err) { next(err); }
});

logger.info('Rotas /agente/comparativo313 carregadas');
