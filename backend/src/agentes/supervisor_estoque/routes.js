/**
 * Rotas do agente supervisor_estoque.
 * Prefixo: /agente/supervisor_estoque
 *
 * Endpoints:
 *   GET  /lista                     — alertas escopados ao usuário logado
 *   GET  /produtos                  — lista de produtos (vw_produto_atual)
 *   GET  /produto/:codigo/historico — histórico do produto numa filial
 *   GET  /resumo-filial             — resumo agregado por filial (diretor/supervisor/gerente)
 *   GET  /resumo-responsavel        — resumo agregado por comprador (diretor/admin/supervisor)
 *   GET  /dim/:dimensao             — agregação dimensional (filial|fornecedor|setor|departamento|secao)
 *   GET  /escopo-do-usuario/:email  — utilitário p/ n8n (escopo pelo e-mail)
 *
 * Etapa 1 (atual): só consulta. Não há POST /run ainda — a ingestão diária
 * via API entra na Etapa 2, quando o workflow n8n estiver ligado.
 */
import { Router } from 'express';
import { authFirebase } from '../../middleware/authFirebase.js';
import { requirePapel } from '../../middleware/requirePapel.js';
import { requireSyncToken } from '../../middleware/requireSyncToken.js';
import { supabase } from '../../services/supabase.service.js';
import { logger } from '../../config/logger.js';
import { resolveFiliaisDoUsuario } from '../metas/services/userFiliais.service.js';

export const supervisorEstoqueRouter = Router();

const DIMENSOES_VALIDAS = {
  filial:        { view: 'vw_supervisor_estoque_dim_filial',        chave: 'filial_cod' },
  fornecedor:    { view: 'vw_supervisor_estoque_dim_fornecedor',    chave: 'fornecedor' },
  setor:         { view: 'vw_supervisor_estoque_dim_setor',         chave: 'setor' },
  departamento:  { view: 'vw_supervisor_estoque_dim_departamento',  chave: 'departamento' },
  secao:         { view: 'vw_supervisor_estoque_dim_secao',         chave: 'chave_secao' },
};

// -------------------------------------------------------- helpers de escopo

/**
 * Resolve o escopo de filiais do usuário pelo papel. Retorna:
 *   { filiaisEscopo: string[]|null, restringirPorN_N: boolean }
 * Onde `filiaisEscopo = null` significa "todas as filiais".
 */
async function escopoUsuario(req) {
  const papel = req.user.papel;
  let filiaisEscopo  = null;
  let restringirPorN_N = false;

  if (papel === 'gerente') {
    const { wildcard, filiais } = await resolveFiliaisDoUsuario({
      emailLogin: req.user.email_login,
    });
    if (!wildcard) {
      filiaisEscopo = filiais.length === 0 ? [] : filiais;
    }
  } else if (papel === 'comprador') {
    restringirPorN_N = true;
  }
  // diretor/supervisor/admin: filiaisEscopo = null = vê tudo

  return { filiaisEscopo, restringirPorN_N };
}

/**
 * GET /agente/supervisor_estoque/lista
 *   ?filial=302         — limita ainda mais (precisa estar no escopo)
 *   ?status=pendente|resolvida|ignorada|todas  (default: pendente)
 *   ?metrica=media_dia|dias_venda|giro|todas   (default: todas)
 *   ?direcao=queda|aumento|todas               (default: todas)
 *
 * Escopo:
 *   diretor/supervisor/admin → tudo
 *   gerente                   → suas filiais
 *   comprador                 → alertas dos quais ele é responsável (N:N)
 */
supervisorEstoqueRouter.get('/lista', authFirebase, async (req, res, next) => {
  try {
    const filialQuery  = (req.query.filial  || '').toString().trim() || null;
    const statusReq    = (req.query.status  || 'pendente').toString().toLowerCase();
    const metricaReq   = (req.query.metrica || 'todas').toString().toLowerCase();
    const direcaoReq   = (req.query.direcao || 'todas').toString().toLowerCase();
    const statusFilter  = statusReq  === 'todas' ? null : statusReq;
    // metrica aceita CSV: ex "media_dia,dias_venda,giro" pra sub-aba Variação.
    let metricaFilter = null;
    let metricaFilterArr = null;
    if (metricaReq && metricaReq !== 'todas') {
      const arr = metricaReq.split(',').map(s => s.trim()).filter(Boolean);
      if (arr.length === 1) metricaFilter    = arr[0];
      else if (arr.length > 1) metricaFilterArr = arr;
    }
    const direcaoFilter = direcaoReq === 'todas' ? null : direcaoReq;

    let { filiaisEscopo, restringirPorN_N } = await escopoUsuario(req);
    if (Array.isArray(filiaisEscopo) && filiaisEscopo.length === 0) return res.json([]);

    if (filialQuery) {
      if (filiaisEscopo && !filiaisEscopo.includes(filialQuery)) {
        return res.status(403).json({ error: 'Filial fora do seu escopo' });
      }
      filiaisEscopo = [filialQuery];
    }

    let alertaIds = null;
    if (restringirPorN_N) {
      const { data: links, error: errL } = await supabase
        .from('supervisor_estoque_produto_compradores')
        .select('alerta_id')
        .eq('usuario_id', req.user.usuario_id);
      if (errL) throw errL;
      alertaIds = (links || []).map(l => l.alerta_id);
      if (alertaIds.length === 0) return res.json([]);
    }

    let q = supabase.from('vw_supervisor_estoque_top_alertas').select('*');
    if (statusFilter)     q = q.eq('status', statusFilter);
    if (metricaFilter)    q = q.eq('metrica', metricaFilter);
    if (metricaFilterArr) q = q.in('metrica', metricaFilterArr);
    if (direcaoFilter)    q = q.eq('direcao', direcaoFilter);
    if (filiaisEscopo)    q = q.in('filial_cod', filiaisEscopo);
    if (alertaIds)        q = q.in('id', alertaIds);

    q = q
      .order('filial_cod', { ascending: true })
      .order('ultima_deteccao', { ascending: false });

    const { data, error } = await q;
    if (error) throw error;
    res.json(data || []);
  } catch (err) { next(err); }
});

/**
 * GET /agente/supervisor_estoque/produtos
 *   ?filial=302
 *   ?banda=constante|medio|baixo|critico|fora_de_faixa
 *   ?secao=11.72            (chave_secao = "departamento.secao")
 *   ?q=texto                (busca em descricao_produto / secao / fornecedor;
 *                            se for puramente numérico, casa codigo_produto)
 *   ?limit=200              (default 200, max 1000)
 *   ?offset=0               (paginação)
 *
 * Resposta: { rows: [...], total: number, limit, offset }
 *   total = total de linhas no escopo+filtros (sem o range), via count='exact'.
 */
supervisorEstoqueRouter.get('/produtos', authFirebase, async (req, res, next) => {
  try {
    const filialQuery = (req.query.filial || '').toString().trim() || null;
    const bandaQuery  = (req.query.banda  || '').toString().trim() || null;
    const secaoQuery  = (req.query.secao  || '').toString().trim() || null;
    const buscaQuery  = (req.query.q      || '').toString().trim() || null;
    const limit  = Math.min(Math.max(Number(req.query.limit)  || 200, 1), 1000);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    // Default: só produtos ativos no último snapshot (oculta fantasmas).
    // Use ?incluirInativos=1 para incluir SKUs que sumiram do mix.
    const incluirInativos = req.query.incluirInativos === '1' || req.query.incluirInativos === 'true';

    let { filiaisEscopo } = await escopoUsuario(req);
    if (Array.isArray(filiaisEscopo) && filiaisEscopo.length === 0) {
      return res.json({ rows: [], total: 0, limit, offset });
    }

    if (filialQuery) {
      if (filiaisEscopo && !filiaisEscopo.includes(filialQuery)) {
        return res.status(403).json({ error: 'Filial fora do seu escopo' });
      }
      filiaisEscopo = [filialQuery];
    }

    let q = supabase
      .from('vw_supervisor_estoque_produto_atual')
      .select('*', { count: 'exact' });
    if (!incluirInativos) q = q.eq('ativo_no_ultimo_snapshot', true);
    if (filiaisEscopo) q = q.in('filial_cod', filiaisEscopo);
    if (bandaQuery)    q = q.eq('banda', bandaQuery);
    if (secaoQuery)    q = q.eq('chave_secao', secaoQuery);

    if (buscaQuery) {
      // Sanitiza caracteres que quebram o parser do PostgREST .or()
      const esc = buscaQuery.replace(/[%,()]/g, ' ').trim();
      if (esc) {
        const padrao = `%${esc}%`;
        const conditions = [
          `descricao_produto.ilike.${padrao}`,
          `secao.ilike.${padrao}`,
          `fornecedor.ilike.${padrao}`,
        ];
        // codigo_produto é numérico: só casa busca exata se for puramente dígitos
        if (/^\d+$/.test(esc)) {
          conditions.push(`codigo_produto.eq.${esc}`);
        }
        q = q.or(conditions.join(','));
      }
    }

    q = q
      .order('filial_cod', { ascending: true })
      .order('descricao_produto', { ascending: true })
      .range(offset, offset + limit - 1);

    const { data, error, count } = await q;
    if (error) throw error;
    res.json({ rows: data || [], total: count || 0, limit, offset });
  } catch (err) { next(err); }
});

/**
 * GET /agente/supervisor_estoque/produto/:codigo/historico
 *   ?filial=302      (obrigatório — histórico é por produto×filial)
 *   ?dias=90         (default 90)
 */
supervisorEstoqueRouter.get('/produto/:codigo/historico', authFirebase, async (req, res, next) => {
  try {
    const codigo = (req.params.codigo || '').toString().trim();
    const filial = (req.query.filial  || '').toString().trim();
    const dias   = Math.min(Math.max(Number(req.query.dias) || 90, 1), 365);
    if (!codigo) return res.status(400).json({ error: 'codigo é obrigatório' });
    if (!filial) return res.status(400).json({ error: 'filial é obrigatória' });

    const { filiaisEscopo } = await escopoUsuario(req);
    if (filiaisEscopo && !filiaisEscopo.includes(filial)) {
      return res.status(403).json({ error: 'Filial fora do seu escopo' });
    }

    const desde = new Date();
    desde.setDate(desde.getDate() - dias);
    const desdeIso = desde.toISOString().slice(0, 10);

    const { data, error } = await supabase
      .from('vw_supervisor_estoque_produto_historico')
      .select('snapshot_date, estoque, media_dia, dias_venda, giro, quant_vendas, ' +
              'quant_movimentos, valor_estoque, banda, dias_ate_ruptura, ultima_entrada, ultima_saida')
      .eq('codigo_produto', codigo)
      .eq('filial_cod', filial)
      .gte('snapshot_date', desdeIso)
      .order('snapshot_date', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  } catch (err) { next(err); }
});

/**
 * GET /agente/supervisor_estoque/produto/:codigo/contexto
 *   ?filial=302      (obrigatório)
 *   ?dias=90         (default 90, max 365)
 *
 * Junta numa única resposta tudo que o drawer da Alertas precisa:
 *   atual:        estado atual do produto na filial (estoque, banda, etc.)
 *   historico:    série temporal dos últimos `dias` dias
 *   baseline:     estatísticas da série (média, mediana, melhor/pior dia,
 *                 dias com venda zero, desvio padrão)
 *   alertas:      outros alertas (pendentes/resolvidos) do mesmo SKU×filial
 *   outras_filiais: estado atual do mesmo SKU nas demais filiais (escopadas)
 */
supervisorEstoqueRouter.get('/produto/:codigo/contexto', authFirebase, async (req, res, next) => {
  try {
    const codigo = (req.params.codigo || '').toString().trim();
    const filial = (req.query.filial  || '').toString().trim();
    const dias   = Math.min(Math.max(Number(req.query.dias) || 90, 7), 365);
    if (!codigo) return res.status(400).json({ error: 'codigo é obrigatório' });
    if (!filial) return res.status(400).json({ error: 'filial é obrigatória' });

    const { filiaisEscopo } = await escopoUsuario(req);
    if (filiaisEscopo && !filiaisEscopo.includes(filial)) {
      return res.status(403).json({ error: 'Filial fora do seu escopo' });
    }

    const desde = new Date();
    desde.setDate(desde.getDate() - dias);
    const desdeIso = desde.toISOString().slice(0, 10);

    const [atualR, histR, alertasR, outrasR, riscoR, presencaR] = await Promise.all([
      supabase
        .from('vw_supervisor_estoque_produto_atual')
        .select('*')
        .eq('codigo_produto', codigo)
        .eq('filial_cod', filial)
        .maybeSingle(),
      supabase
        .from('vw_supervisor_estoque_produto_historico')
        .select('snapshot_date, estoque, media_dia, dias_venda, giro, quant_vendas, ' +
                'quant_movimentos, valor_estoque, banda, dias_ate_ruptura, ultima_entrada, ultima_saida')
        .eq('codigo_produto', codigo)
        .eq('filial_cod', filial)
        .gte('snapshot_date', desdeIso)
        .order('snapshot_date', { ascending: true }),
      supabase
        .from('vw_supervisor_estoque_top_alertas')
        .select('*')
        .eq('codigo_produto', codigo)
        .eq('filial_cod', filial)
        .order('snapshot_date', { ascending: false })
        .limit(50),
      (async () => {
        let q = supabase
          .from('vw_supervisor_estoque_produto_atual')
          .select('filial_cod, filial, estoque, media_dia, dias_venda, giro, banda, ' +
                  'dias_ate_ruptura, valor_estoque, alertas_pendentes')
          .eq('codigo_produto', codigo)
          .neq('filial_cod', filial);
        if (filiaisEscopo) q = q.in('filial_cod', filiaisEscopo);
        return q.order('filial_cod', { ascending: true });
      })(),
      supabase
        .from('vw_supervisor_estoque_risco_obsolescencia')
        .select('validade_media_dias, validade_efetiva_recebimento_dias, ' +
                'dias_parado, validade_restante_dias, taxa_consumo, ' +
                'excesso_dias, excesso_unidades, valor_em_risco, nivel, ' +
                'categoria, pct_max_recebimento, pct_atencao, pct_risco, pct_critico')
        .eq('codigo_produto', codigo)
        .eq('filial_cod', filial)
        .maybeSingle(),
      // Histórico de presença: distincts snapshot_dates do produto×filial
      supabase
        .from('supervisor_estoque_snapshots')
        .select('snapshot_date')
        .eq('codigo_produto', codigo)
        .eq('filial_cod', filial)
        .order('snapshot_date', { ascending: true }),
    ]);

    if (atualR.error)    throw atualR.error;
    if (histR.error)     throw histR.error;
    if (alertasR.error)  throw alertasR.error;
    if (outrasR.error)   throw outrasR.error;
    if (riscoR.error)    throw riscoR.error;
    if (presencaR.error) throw presencaR.error;

    // Calcula resumo de presença e detecta gaps (ausências)
    const datasPresenca = (presencaR.data || []).map(r => r.snapshot_date);
    let presenca = null;
    if (datasPresenca.length > 0) {
      const todasR = await supabase
        .from('vw_supest_snapshot_dates')
        .select('snapshot_date')
        .order('snapshot_date', { ascending: true });
      const todas = (todasR.data || []).map(r => r.snapshot_date);
      const setPres = new Set(datasPresenca);
      // Gaps: contínuos de dias que estavam disponíveis no global mas não no SKU
      const gaps = [];
      let inicioGap = null;
      for (const d of todas) {
        if (!setPres.has(d)) {
          if (!inicioGap) inicioGap = d;
        } else if (inicioGap) {
          gaps.push({ inicio: inicioGap, fim_anterior: d });
          inicioGap = null;
        }
      }
      // Gap aberto no fim (produto sumido até hoje)
      if (inicioGap) gaps.push({ inicio: inicioGap, fim_anterior: null });

      presenca = {
        primeira_aparicao:   datasPresenca[0],
        ultima_aparicao:     datasPresenca[datasPresenca.length - 1],
        dias_distintos:      datasPresenca.length,
        dias_base_total:     todas.length,
        ativo_no_ultimo:     datasPresenca[datasPresenca.length - 1] === todas[todas.length - 1],
        gaps,
      };
    }

    // Estatísticas da série (somente dias com venda > 0 para "melhor/pior dia")
    const historico = histR.data || [];
    const comVenda = historico.filter(h => h.media_dia != null && Number(h.media_dia) > 0);
    let stats = null;
    if (historico.length > 0) {
      const vals = historico
        .map(h => Number(h.media_dia))
        .filter(v => Number.isFinite(v));
      const soma = vals.reduce((a, b) => a + b, 0);
      const media = vals.length ? soma / vals.length : 0;
      const sorted = [...vals].sort((a, b) => a - b);
      const mediana = sorted.length
        ? (sorted.length % 2
            ? sorted[(sorted.length - 1) / 2]
            : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2)
        : 0;
      const variancia = vals.length
        ? vals.reduce((acc, v) => acc + Math.pow(v - media, 2), 0) / vals.length
        : 0;
      const desvio = Math.sqrt(variancia);
      const melhor = comVenda.reduce((best, h) =>
        !best || Number(h.media_dia) > Number(best.media_dia) ? h : best, null);
      const pior   = comVenda.reduce((worst, h) =>
        !worst || Number(h.media_dia) < Number(worst.media_dia) ? h : worst, null);

      stats = {
        dias_analisados:    historico.length,
        dias_com_venda:     comVenda.length,
        dias_sem_venda:     historico.length - comVenda.length,
        media,
        mediana,
        desvio_padrao:      desvio,
        melhor_dia:         melhor && { data: melhor.snapshot_date, media_dia: Number(melhor.media_dia), quant_vendas: melhor.quant_vendas },
        pior_dia:           pior   && { data: pior.snapshot_date,   media_dia: Number(pior.media_dia),   quant_vendas: pior.quant_vendas },
      };
    }

    res.json({
      atual:          atualR.data || null,
      historico,
      baseline:       stats,
      alertas:        alertasR.data || [],
      outras_filiais: outrasR.data  || [],
      risco_validade: riscoR.data   || null,
      presenca,
      janela_dias:    dias,
    });
  } catch (err) { next(err); }
});

/**
 * GET /agente/supervisor_estoque/resumo-filial
 * 1 linha por filial dentro do escopo.
 */
supervisorEstoqueRouter.get('/resumo-filial', authFirebase, async (req, res, next) => {
  try {
    if (req.user.papel === 'comprador') {
      return res.status(403).json({ error: 'Visão por filial não disponível para comprador' });
    }
    const { filiaisEscopo } = await escopoUsuario(req);
    if (Array.isArray(filiaisEscopo) && filiaisEscopo.length === 0) return res.json([]);

    let q = supabase.from('vw_supervisor_estoque_resumo_filial').select('*');
    if (filiaisEscopo) q = q.in('filial_cod', filiaisEscopo);
    q = q.order('filial_cod', { ascending: true });

    const { data, error } = await q;
    if (error) throw error;
    res.json(data || []);
  } catch (err) { next(err); }
});

/**
 * GET /agente/supervisor_estoque/resumo-responsavel
 * Resumo agregado por comprador — só diretor/admin/supervisor.
 */
supervisorEstoqueRouter.get(
  '/resumo-responsavel',
  authFirebase,
  requirePapel('diretor', 'admin', 'supervisor'),
  async (_req, res, next) => {
    try {
      const { data, error } = await supabase
        .from('vw_supervisor_estoque_resumo_responsavel')
        .select('*');
      if (error) throw error;
      res.json(data || []);
    } catch (err) { next(err); }
  },
);

/**
 * GET /agente/supervisor_estoque/dim/:dimensao
 *   :dimensao = filial|fornecedor|setor|departamento|secao
 *   ?limit=200   (default 200, max 1000)
 *
 * Aplica escopo de filial cruzando com vw_produto_atual quando a dimensão
 * NÃO é filial. A view dimensional é global (sem filial_cod), então o
 * filtro de gerente/comprador acontece via produto_atual em segundo plano.
 */
supervisorEstoqueRouter.get('/dim/:dimensao', authFirebase, async (req, res, next) => {
  try {
    const def = DIMENSOES_VALIDAS[req.params.dimensao];
    if (!def) return res.status(400).json({ error: 'Dimensão inválida', validas: Object.keys(DIMENSOES_VALIDAS) });
    const limit = Math.min(Math.max(Number(req.query.limit) || 200, 1), 1000);

    // Visão global: diretor/admin/supervisor sempre vêem; gerente/comprador
    // recebem 403 nesse endpoint na Etapa 1 (não há filtro per-filial nas
    // views dimensionais ainda). Pode ser relaxado quando criarmos
    // `vw_supervisor_estoque_dim_{x}_filial`.
    if (!['diretor', 'admin', 'supervisor'].includes(req.user.papel)) {
      return res.status(403).json({ error: 'Visão dimensional disponível só para diretor/supervisor/admin' });
    }

    const { data, error } = await supabase
      .from(def.view)
      .select('*')
      .order(def.chave, { ascending: true })
      .limit(limit);
    if (error) throw error;
    res.json(data || []);
  } catch (err) { next(err); }
});

/**
 * GET /agente/supervisor_estoque/escopo-do-usuario/:email
 * Para n8n consumir a partir do e-mail (sem JWT, sync token).
 */
supervisorEstoqueRouter.get('/escopo-do-usuario/:email', requireSyncToken, async (req, res, next) => {
  try {
    const email = (req.params.email || '').toLowerCase();
    if (!email) return res.status(400).json({ error: 'email obrigatório' });

    const { data: usuario } = await supabase
      .from('usuarios')
      .select('id, nome, papel, ativo')
      .eq('email_login', email)
      .maybeSingle();
    if (!usuario || !usuario.ativo) {
      return res.json({ email, papel: null, totais: null, por_filial: [] });
    }

    // Comprador: 1 linha em resumo_responsavel + por filial via view dedicada
    if (usuario.papel === 'comprador') {
      const { data: meu } = await supabase
        .from('vw_supervisor_estoque_resumo_responsavel')
        .select('*')
        .eq('usuario_id', usuario.id)
        .maybeSingle();
      const { data: porFilial } = await supabase
        .from('vw_supervisor_estoque_resumo_filial_comprador')
        .select('*')
        .eq('usuario_id', usuario.id)
        .order('filial_cod', { ascending: true });
      return res.json({
        email, usuario_id: usuario.id, nome: usuario.nome, papel: usuario.papel,
        totais: meu || { alertas_pendentes: 0, filiais_afetadas: 0, produtos_afetados: 0, secoes_afetadas: 0 },
        por_filial: porFilial || [],
      });
    }

    // Diretor/supervisor/admin: agregado de todas as filiais
    if (['diretor', 'supervisor', 'admin'].includes(usuario.papel)) {
      const { data: porFilial, error } = await supabase
        .from('vw_supervisor_estoque_resumo_filial')
        .select('*')
        .order('filial_cod', { ascending: true });
      if (error) throw error;
      const totais = (porFilial || []).reduce((acc, r) => {
        acc.alertas_pendentes  += Number(r.alertas_pendentes  || 0);
        acc.produtos_afetados  += Number(r.produtos_afetados  || 0);
        acc.secoes_afetadas    += Number(r.secoes_afetadas    || 0);
        return acc;
      }, { alertas_pendentes: 0, produtos_afetados: 0, secoes_afetadas: 0 });
      return res.json({
        email, usuario_id: usuario.id, nome: usuario.nome, papel: usuario.papel,
        totais, por_filial: porFilial || [],
      });
    }

    // Gerente: filtra por users/{email}.loja
    if (usuario.papel === 'gerente') {
      const { wildcard, filiais } = await resolveFiliaisDoUsuario({ emailLogin: email });
      let q = supabase.from('vw_supervisor_estoque_resumo_filial').select('*');
      if (!wildcard) {
        if (filiais.length === 0) {
          return res.json({
            email, usuario_id: usuario.id, nome: usuario.nome, papel: usuario.papel,
            totais: { alertas_pendentes: 0, produtos_afetados: 0, secoes_afetadas: 0 },
            por_filial: [],
          });
        }
        q = q.in('filial_cod', filiais);
      }
      const { data: porFilial, error } = await q.order('filial_cod', { ascending: true });
      if (error) throw error;
      const totais = (porFilial || []).reduce((acc, r) => {
        acc.alertas_pendentes  += Number(r.alertas_pendentes  || 0);
        acc.produtos_afetados  += Number(r.produtos_afetados  || 0);
        acc.secoes_afetadas    += Number(r.secoes_afetadas    || 0);
        return acc;
      }, { alertas_pendentes: 0, produtos_afetados: 0, secoes_afetadas: 0 });
      return res.json({
        email, usuario_id: usuario.id, nome: usuario.nome, papel: usuario.papel,
        totais, por_filial: porFilial || [],
      });
    }

    return res.json({ email, papel: usuario.papel, totais: null, por_filial: [] });
  } catch (err) { next(err); }
});

// ============================================================================
// Cadastros — validade média por seção + política da loja
// ============================================================================

/**
 * GET /agente/supervisor_estoque/config
 * Política da loja (singleton). Qualquer papel pode ler.
 */
supervisorEstoqueRouter.get('/config', authFirebase, async (_req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('supervisor_estoque_config')
      .select('pct_max_validade_no_recebimento, atualizado_em')
      .eq('id', true)
      .maybeSingle();
    if (error) throw error;
    res.json(data || { pct_max_validade_no_recebimento: 0.10 });
  } catch (err) { next(err); }
});

/**
 * PUT /agente/supervisor_estoque/config
 * Atualiza a política. Só diretor/admin/supervisor.
 * Body: { pct_max_validade_no_recebimento: number }  (0 ≤ x < 1)
 */
supervisorEstoqueRouter.put(
  '/config',
  authFirebase,
  requirePapel('diretor', 'admin', 'supervisor'),
  async (req, res, next) => {
    try {
      const pct = Number(req.body?.pct_max_validade_no_recebimento);
      if (!Number.isFinite(pct) || pct < 0 || pct >= 1) {
        return res.status(400).json({ error: 'pct_max_validade_no_recebimento deve ser número entre 0 e 1 (exclusivo)' });
      }
      const { data, error } = await supabase
        .from('supervisor_estoque_config')
        .upsert({
          id: true,
          pct_max_validade_no_recebimento: pct,
          atualizado_por: req.user?.usuario_id || null,
          atualizado_em: new Date().toISOString(),
        }, { onConflict: 'id' })
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (err) { next(err); }
  },
);

/**
 * GET /agente/supervisor_estoque/secao-validade
 *   ?somenteCadastradas=1   (default: lista TODAS as seções da MV, com
 *                            validade_media_dias=NULL nas não cadastradas)
 *   ?categoria=perecivel    (filtra)
 *
 * Retorna 1 linha por chave_secao com contexto (produtos, filiais, valor)
 * cruzado com o cadastro de validade.
 */
supervisorEstoqueRouter.get('/secao-validade', authFirebase, async (req, res, next) => {
  try {
    const somenteCadastradas = req.query.somenteCadastradas === '1' || req.query.somenteCadastradas === 'true';
    const categoria          = (req.query.categoria || '').toString().trim() || null;

    // 1) Lê os cadastros
    let qv = supabase
      .from('supervisor_estoque_secao_validade')
      .select('chave_secao, descricao, departamento, validade_media_dias, ' +
              'categoria, pct_atencao, pct_risco, pct_critico, ' +
              'observacoes, atualizado_em');
    if (categoria) qv = qv.eq('categoria', categoria);
    const { data: cadastros, error: errV } = await qv;
    if (errV) throw errV;
    const mapCadastro = new Map((cadastros || []).map(c => [c.chave_secao, c]));

    if (somenteCadastradas) {
      return res.json((cadastros || []).map(c => ({ ...c, cadastrada: true })));
    }

    // 2) Sem filtro: enriquece com contexto da MV (todas as seções existentes)
    const { data: contexto, error: errC } = await supabase
      .rpc('fn_supest_listar_secoes_com_contexto');

    if (errC) {
      // Fallback: se a RPC não existe, devolve só os cadastros + alerta
      return res.json((cadastros || []).map(c => ({ ...c, cadastrada: true })));
    }

    const rows = (contexto || []).map(ctx => {
      const cad = mapCadastro.get((ctx.chave_secao || '').trim());
      return {
        chave_secao:         (ctx.chave_secao || '').trim(),
        descricao:           cad?.descricao    || ctx.descricao    || null,
        departamento:        cad?.departamento || ctx.departamento || null,
        produtos:            ctx.produtos      || 0,
        filiais:             ctx.filiais       || 0,
        valor_estoque:       Number(ctx.valor_estoque || 0),
        validade_media_dias: cad?.validade_media_dias ?? null,
        categoria:           cad?.categoria     || null,
        pct_atencao:         cad?.pct_atencao   || null,
        pct_risco:           cad?.pct_risco     || null,
        pct_critico:         cad?.pct_critico   || null,
        observacoes:         cad?.observacoes   || null,
        atualizado_em:       cad?.atualizado_em || null,
        cadastrada:          !!cad,
      };
    });
    rows.sort((a, b) => (b.valor_estoque || 0) - (a.valor_estoque || 0));
    res.json(rows);
  } catch (err) { next(err); }
});

/**
 * PUT /agente/supervisor_estoque/secao-validade/:chave
 * Upsert de uma seção. Só diretor/admin/supervisor.
 * Body: { validade_media_dias, categoria, pct_atencao?, pct_risco?,
 *         pct_critico?, observacoes?, descricao?, departamento? }
 */
supervisorEstoqueRouter.put(
  '/secao-validade/:chave',
  authFirebase,
  requirePapel('diretor', 'admin', 'supervisor'),
  async (req, res, next) => {
    try {
      const chave = (req.params.chave || '').toString().trim();
      if (!chave) return res.status(400).json({ error: 'chave_secao obrigatória' });

      const body = req.body || {};
      const validade = body.validade_media_dias === null || body.validade_media_dias === ''
        ? null
        : Number(body.validade_media_dias);
      if (validade != null && (!Number.isFinite(validade) || validade <= 0)) {
        return res.status(400).json({ error: 'validade_media_dias deve ser número positivo ou null' });
      }
      const categorias = ['perecivel', 'resfriado', 'congelado', 'nao_perecivel', null];
      const categoria  = body.categoria === '' ? null : (body.categoria || null);
      if (!categorias.includes(categoria)) {
        return res.status(400).json({ error: `categoria inválida (use ${categorias.filter(Boolean).join(', ')})` });
      }

      const { data, error } = await supabase
        .from('supervisor_estoque_secao_validade')
        .upsert({
          chave_secao:         chave,
          descricao:           body.descricao    ?? null,
          departamento:        body.departamento ?? null,
          validade_media_dias: validade,
          categoria,
          pct_atencao:         body.pct_atencao ?? null,
          pct_risco:           body.pct_risco   ?? null,
          pct_critico:         body.pct_critico ?? null,
          observacoes:         body.observacoes ?? null,
          atualizado_por:      req.user?.usuario_id || null,
          atualizado_em:       new Date().toISOString(),
        }, { onConflict: 'chave_secao' })
        .select()
        .single();
      if (error) throw error;
      res.json(data);
    } catch (err) { next(err); }
  },
);

/**
 * POST /agente/supervisor_estoque/secao-validade/importar
 * Body: { itens: [{ chave_secao, validade_media_dias, categoria,
 *                   descricao?, departamento?, observacoes? }, ...] }
 *
 * UPSERT em lote. Só diretor/admin/supervisor.
 * O frontend lê o XLSX e envia o JSON normalizado (extrai "180" de "180 dias").
 */
supervisorEstoqueRouter.post(
  '/secao-validade/importar',
  authFirebase,
  requirePapel('diretor', 'admin', 'supervisor'),
  async (req, res, next) => {
    try {
      const itens = Array.isArray(req.body?.itens) ? req.body.itens : [];
      if (itens.length === 0) return res.json({ inseridas: 0, atualizadas: 0, ignoradas: 0 });

      const usuarioId = req.user?.usuario_id || null;
      const now = new Date().toISOString();
      const validas = [];
      let ignoradas = 0;
      for (const r of itens) {
        const chave = (r.chave_secao || '').toString().trim();
        if (!chave) { ignoradas++; continue; }
        // Aceita "180 dias" / "180" / 180
        let validade = null;
        if (r.validade_media_dias != null && r.validade_media_dias !== '') {
          const m = String(r.validade_media_dias).match(/(\d+)/);
          validade = m ? Number(m[1]) : null;
        }
        validas.push({
          chave_secao:         chave,
          descricao:           r.descricao    || null,
          departamento:        r.departamento || null,
          validade_media_dias: validade,
          categoria:           r.categoria    || null,
          observacoes:         r.observacoes  || null,
          atualizado_por:      usuarioId,
          atualizado_em:       now,
        });
      }

      // Lê chaves existentes pra contar inseridas/atualizadas
      const chaves = validas.map(v => v.chave_secao);
      const { data: existentes } = await supabase
        .from('supervisor_estoque_secao_validade')
        .select('chave_secao')
        .in('chave_secao', chaves);
      const setExistente = new Set((existentes || []).map(e => e.chave_secao));

      const { error } = await supabase
        .from('supervisor_estoque_secao_validade')
        .upsert(validas, { onConflict: 'chave_secao' });
      if (error) throw error;

      const atualizadas = validas.filter(v => setExistente.has(v.chave_secao)).length;
      const inseridas   = validas.length - atualizadas;
      res.json({ inseridas, atualizadas, ignoradas, total_validas: validas.length });
    } catch (err) { next(err); }
  },
);

logger.info('Rotas /agente/supervisor_estoque carregadas');
