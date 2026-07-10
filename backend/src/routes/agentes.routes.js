/**
 * Rotas da PLATAFORMA — listar agentes (alimenta o dashboard) e detalhe.
 */
import { Router } from 'express';
import { authFirebase } from '../middleware/authFirebase.js';
import { supabase } from '../services/supabase.service.js';

export const agentesRouter = Router();

/**
 * GET /api/agentes
 * Lista agentes com status calculado e contagem de pendentes.
 * Autenticado: qualquer usuário ativo da plataforma.
 */
agentesRouter.get('/', authFirebase, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('agentes')
      .select('id, slug, nome, descricao_curta, icone, cor, ativo, ultima_execucao_at, ultima_execucao_status, pendentes_total, threshold_atencao')
      .eq('ativo', true)
      .order('nome', { ascending: true });
    if (error) throw error;

    const enriched = data.map(a => ({
      ...a,
      status_card: deriveCardStatus(a),
    }));
    res.json(enriched);
  } catch (err) { next(err); }
});

/** GET /api/agentes/:slug — info_md (markdown) para o modal "(i)". */
agentesRouter.get('/:slug', authFirebase, async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('agentes')
      .select('*')
      .eq('slug', req.params.slug)
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Agente não encontrado' });
    res.json(data);
  } catch (err) { next(err); }
});

function deriveCardStatus(a) {
  if (!a.ativo) return 'inativo';
  if (a.ultima_execucao_status === 'rodando') return 'rodando';
  if (a.ultima_execucao_status === 'erro') return 'erro';
  if (a.pendentes_total >= a.threshold_atencao) return 'atencao';
  return 'ok';
}
