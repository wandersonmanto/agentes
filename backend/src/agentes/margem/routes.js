/**
 * Rotas do agente margem.
 * Prefixo: /agente/margem
 */
import { Router } from 'express';
import { z } from 'zod';
import { authFirebase } from '../../middleware/authFirebase.js';
import { requirePapel } from '../../middleware/requirePapel.js';
import { requireSyncToken } from '../../middleware/requireSyncToken.js';
import { supabase } from '../../services/supabase.service.js';
import { runSync } from './services/syncJob.service.js';
import { logger } from '../../config/logger.js';

export const margemRouter = Router();

/** POST /agente/margem/run — disparado pelo n8n. */
margemRouter.post('/run', requireSyncToken, async (_req, res, next) => {
  try {
    const result = await runSync({ origem: 'n8n' });
    res.json(result);
  } catch (err) { next(err); }
});

/** GET /agente/margem/responsaveis — lista responsáveis com produtos atribuídos (alimenta o select). */
margemRouter.get('/responsaveis', authFirebase, async (_req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('vw_margem_resumo_por_responsavel')
      .select('usuario_id, usuario_nome, usuario_papel, pendentes, total')
      .order('usuario_nome', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err) { next(err); }
});

/** GET /agente/margem/produtos — lista produtos do usuário autenticado. */
margemRouter.get('/produtos', authFirebase, async (req, res, next) => {
  try {
    const status       = req.query.status || 'pendente';
    const q            = (req.query.q || '').toString().trim();
    const compradorId  = (req.query.comprador_id || '').toString().trim();

    // Como usamos service_role aqui, simulamos manualmente o RLS:
    // - diretor/admin: tudo
    // - comprador: só produtos onde está em margem_produto_compradores
    const hoje = new Date().toISOString().slice(0, 10);

    // Filtro de visibilidade / por comprador específico:
    //  - Comprador: sempre filtra pelos vínculos dele (ignora qualquer comprador_id).
    //  - Diretor/Supervisor/Admin: vê todos por padrão, mas se passar
    //    comprador_id, filtra por ele.
    let filtrarPorUsuarioId = null;
    if (req.user.papel === 'comprador') {
      filtrarPorUsuarioId = req.user.usuario_id;
    } else if (compradorId) {
      filtrarPorUsuarioId = compradorId;
    }

    // Quando filtramos por usuário, usamos uma RPC que faz o JOIN no banco.
    // Isso evita o caminho `.in('id', [732 uuids])`, que monta uma URL >25 KB
    // e estoura o limite do PostgREST (ILNARA com 732 vínculos perdia tudo).
    if (filtrarPorUsuarioId) {
      const { data, error } = await supabase.rpc('fn_margem_lista_para_comprador', {
        p_usuario_id: filtrarPorUsuarioId,
        p_status:     status,
        p_busca:      q || null,
      });
      if (error) throw error;
      const arr = Array.isArray(data) ? data : [];
      // Aplica o sort de margem_negativa no Node (a RPC ordena por created_at).
      arr.sort((a, b) => Number(a.margem_negativa ?? 0) - Number(b.margem_negativa ?? 0));
      return res.json(arr);
    }

    // Caminho original: diretor/admin/supervisor sem comprador_id —
    // PostgREST com filtros normais (lista não estoura limite).
    let query = supabase.from('margem_produtos').select(`
      id, filial, codigo_produto, descricao_produto, secao, departamento, fornecedor,
      vlr_venda, vlr_cong_varejo, custo_medio, vlr_promocao, dt_fim_promocao,
      qtd_estoque, dias_venda, margem_negativa, status, motivo_atribuicao,
      motivo, observacao, data_fim_ciencia, checked_at,
      ciencia_por:ciencia_por_id ( id, nome ),
      compradores:margem_produto_compradores(
        usuario_id, papel_atribuicao,
        usuarios:usuario_id ( id, nome )
      )
    `)
      .eq('status', status)
      .order('margem_negativa', { ascending: true });

    if (status === 'pendente') {
      query = query.or(`dt_fim_promocao.is.null,dt_fim_promocao.gte.${hoje}`);
    }

    if (q) query = query.or(`descricao_produto.ilike.%${q}%,codigo_produto.ilike.%${q}%`);

    const { data, error } = await query;
    if (error) throw error;
    res.json(data);
  } catch (err) { next(err); }
});

/** POST /agente/margem/produtos/:id/ciencia — registra ciência. */
const cienciaSchema = z.object({
  motivo: z.enum(['vencimento','estoque_parado','descontinuidade','erro_cadastro','estrategia_comercial','outro']),
  observacao: z.string().min(3).max(500),
  data_fim_ciencia: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

margemRouter.post('/produtos/:id/ciencia', authFirebase, async (req, res, next) => {
  try {
    const parsed = cienciaSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const { motivo, observacao, data_fim_ciencia } = parsed.data;
    const produtoId = req.params.id;

    // Verifica se o usuário pode agir nesse produto (está em margem_produto_compradores)
    const { data: vinculo } = await supabase
      .from('margem_produto_compradores')
      .select('produto_id')
      .eq('produto_id', produtoId)
      .eq('usuario_id', req.user.usuario_id)
      .maybeSingle();

    if (!vinculo && !['diretor', 'admin'].includes(req.user.papel)) {
      return res.status(403).json({ error: 'Você não está atribuído a este produto' });
    }

    // Snapshot do produto p/ guardar valores históricos
    // (usa vlr_cong_varejo — valor vigente que entra no cálculo da margem;
    // cai pra vlr_venda se não houver valor congelado)
    const { data: prod, error: errProd } = await supabase
      .from('margem_produtos')
      .select('vlr_venda, vlr_cong_varejo, margem_negativa')
      .eq('id', produtoId).single();
    if (errProd) throw errProd;

    // Histórico
    await supabase.from('margem_ciencias').insert({
      produto_id: produtoId,
      usuario_id: req.user.usuario_id,
      motivo, observacao, data_fim_ciencia,
      vlr_venda_no_momento: prod.vlr_cong_varejo ?? prod.vlr_venda,
      margem_no_momento:    prod.margem_negativa,
    });

    // Atualiza produto (sai da lista de TODOS — regra do negócio)
    const { error: errUp } = await supabase.from('margem_produtos')
      .update({
        status: 'ciente',
        motivo, observacao, data_fim_ciencia,
        ciencia_por_id: req.user.usuario_id,
        checked_at: new Date().toISOString(),
      })
      .eq('id', produtoId);
    if (errUp) throw errUp;

    res.json({ ok: true });
  } catch (err) { next(err); }
});

/** GET /agente/margem/stats/diretor — agregação por responsável (diretor/supervisor). */
margemRouter.get('/stats/diretor', authFirebase, requirePapel('diretor', 'admin', 'supervisor'), async (_req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('vw_margem_resumo_por_responsavel')
      .select('*');
    if (error) throw error;

    const { data: orfas } = await supabase.from('vw_margem_secoes_problematicas').select('*');

    res.json({ por_responsavel: data, secoes_problematicas: orfas || [] });
  } catch (err) { next(err); }
});

/** GET /agente/margem/stats/comprador/:id — para o n8n (usa view por responsável). */
margemRouter.get('/stats/comprador/:id', authFirebase, requirePapel('diretor', 'admin', 'supervisor'), async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('vw_margem_resumo_por_responsavel')
      .select('*')
      .eq('usuario_id', req.params.id)
      .maybeSingle();
    if (error) throw error;
    res.json(data || { total: 0, pendentes: 0, cientes: 0, expirados: 0 });
  } catch (err) { next(err); }
});

logger.info('Rotas /agente/margem carregadas');
