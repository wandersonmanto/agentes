/**
 * Rotas do agente "vendas" (painel analítico).
 * Prefixo: /agente/vendas
 *
 * Endpoints (todos autenticados; liberados a qualquer papel):
 *   GET /periodo   — min/max data e contagens (default de faixa no front)
 *   GET /filtros   — valores distintos das dimensões p/ montar os selects
 *   GET /resumo    — agregação por 1 dimensão + faixa de datas (+ filtros)
 *
 * Fonte: tabela vendas_diarias / RPCs fn_vendas_* (migrations 0031/0032).
 */
import { Router } from 'express';
import { authFirebase } from '../../middleware/authFirebase.js';
import { supabase } from '../../services/supabase.service.js';
import { logger } from '../../config/logger.js';

export const vendasRouter = Router();

// Dimensões aceitas no agrupamento (espelha o whitelist do fn_vendas_resumo).
const DIMS = new Set([
  'filial', 'canal', 'juridica', 'setor', 'departamento',
  'secao', 'fornecedor', 'comprador', 'produto', 'dia',
]);

// Chaves de filtro aceitas (código exato).
const FILTRO_KEYS = [
  'filial_cod', 'canal_cod', 'juridica', 'setor_cod', 'departamento_cod',
  'secao_cod', 'fornecedor_cod', 'comprador_cod', 'produto_cod',
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** GET /agente/vendas/periodo */
vendasRouter.get('/periodo', authFirebase, async (_req, res, next) => {
  try {
    const { data, error } = await supabase.rpc('fn_vendas_periodo');
    if (error) throw error;
    const row = Array.isArray(data) ? data[0] : data;
    res.json(row || { min_dia: null, max_dia: null, dias: 0, linhas: 0 });
  } catch (err) { next(err); }
});

/** GET /agente/vendas/filtros */
vendasRouter.get('/filtros', authFirebase, async (_req, res, next) => {
  try {
    const { data, error } = await supabase.rpc('fn_vendas_filtros');
    if (error) throw error;
    res.json(data || {});
  } catch (err) { next(err); }
});

/**
 * GET /agente/vendas/resumo?dim=comprador&from=2026-07-01&to=2026-07-08
 *   &filial_cod=300&secao_cod=12&...
 */
vendasRouter.get('/resumo', authFirebase, async (req, res, next) => {
  try {
    const dim = (req.query.dim || '').toString().trim();
    if (!DIMS.has(dim)) {
      return res.status(400).json({ error: `dim inválida. Use uma de: ${[...DIMS].join(', ')}` });
    }

    const from = (req.query.from || '').toString().trim() || null;
    const to   = (req.query.to   || '').toString().trim() || null;
    if (from && !ISO_DATE.test(from)) return res.status(400).json({ error: 'from deve ser YYYY-MM-DD' });
    if (to   && !ISO_DATE.test(to))   return res.status(400).json({ error: 'to deve ser YYYY-MM-DD' });

    // Cada filtro pode vir com múltiplos códigos separados por vírgula
    // (ex.: filial_cod=300,305) → vira um array no jsonb enviado ao RPC.
    const filtros = {};
    for (const k of FILTRO_KEYS) {
      const raw = (req.query[k] || '').toString();
      const arr = raw.split(',').map(s => s.trim()).filter(Boolean);
      if (arr.length) filtros[k] = arr;
    }

    const { data, error } = await supabase.rpc('fn_vendas_resumo', {
      p_dim: dim,
      p_from: from,
      p_to: to,
      p_filtros: filtros,
    });
    if (error) throw error;
    res.json(data || []);
  } catch (err) { next(err); }
});

/**
 * GET /agente/vendas/tendencia?dim=produto&from=..&to=..&<filtros>
 * Média de venda/dia no range e classificação queda/crescimento/estável.
 */
vendasRouter.get('/tendencia', authFirebase, async (req, res, next) => {
  try {
    const dim = (req.query.dim || '').toString().trim();
    if (!DIMS.has(dim)) {
      return res.status(400).json({ error: `dim inválida. Use uma de: ${[...DIMS].join(', ')}` });
    }
    const from = (req.query.from || '').toString().trim() || null;
    const to   = (req.query.to   || '').toString().trim() || null;
    if (from && !ISO_DATE.test(from)) return res.status(400).json({ error: 'from deve ser YYYY-MM-DD' });
    if (to   && !ISO_DATE.test(to))   return res.status(400).json({ error: 'to deve ser YYYY-MM-DD' });

    const filtros = {};
    for (const k of FILTRO_KEYS) {
      const arr = (req.query[k] || '').toString().split(',').map(s => s.trim()).filter(Boolean);
      if (arr.length) filtros[k] = arr;
    }

    const { data, error } = await supabase.rpc('fn_vendas_tendencia', {
      p_dim: dim, p_from: from, p_to: to, p_filtros: filtros,
    });
    if (error) throw error;
    res.json(data || []);
  } catch (err) { next(err); }
});

/**
 * GET /agente/vendas/comparativo
 *   ?dim=comprador
 *   &base_from=2026-07-01&base_to=2026-07-02
 *   &comp_from=2026-07-03&comp_to=2026-07-04
 *   &<filtros multi por vírgula>
 *
 * Roda fn_vendas_resumo nos DOIS períodos (mesma dimensão e filtros) e
 * junta por grupo, devolvendo qtd/venda/margem de cada período.
 */
vendasRouter.get('/comparativo', authFirebase, async (req, res, next) => {
  try {
    const dim = (req.query.dim || '').toString().trim();
    if (!DIMS.has(dim)) {
      return res.status(400).json({ error: `dim inválida. Use uma de: ${[...DIMS].join(', ')}` });
    }

    const datas = {};
    for (const k of ['base_from', 'base_to', 'comp_from', 'comp_to']) {
      const v = (req.query[k] || '').toString().trim() || null;
      if (v && !ISO_DATE.test(v)) return res.status(400).json({ error: `${k} deve ser YYYY-MM-DD` });
      datas[k] = v;
    }

    const filtros = {};
    for (const k of FILTRO_KEYS) {
      const arr = (req.query[k] || '').toString().split(',').map(s => s.trim()).filter(Boolean);
      if (arr.length) filtros[k] = arr;
    }

    const [base, comp] = await Promise.all([
      supabase.rpc('fn_vendas_resumo', { p_dim: dim, p_from: datas.base_from, p_to: datas.base_to, p_filtros: filtros }),
      supabase.rpc('fn_vendas_resumo', { p_dim: dim, p_from: datas.comp_from, p_to: datas.comp_to, p_filtros: filtros }),
    ]);
    if (base.error) throw base.error;
    if (comp.error) throw comp.error;

    const map = new Map();
    const merge = (rows, side) => {
      for (const r of rows || []) {
        const key = r.grupo_cod ?? '';
        if (!map.has(key)) {
          map.set(key, {
            grupo_cod: r.grupo_cod, grupo_nome: r.grupo_nome,
            base_qtd: 0, base_venda: 0, base_margem: null,
            comp_qtd: 0, comp_venda: 0, comp_margem: null,
          });
        }
        const o = map.get(key);
        if (r.grupo_nome && !o.grupo_nome) o.grupo_nome = r.grupo_nome;
        o[`${side}_qtd`]    = Number(r.qtd_total   || 0);
        o[`${side}_venda`]  = Number(r.venda_total || 0);
        o[`${side}_margem`] = r.margem_pct == null ? null : Number(r.margem_pct);
      }
    };
    merge(base.data, 'base');
    merge(comp.data, 'comp');

    const out = [...map.values()].sort(
      (a, b) => (b.base_venda + b.comp_venda) - (a.base_venda + a.comp_venda)
    );
    res.json(out);
  } catch (err) { next(err); }
});

/**
 * GET /agente/vendas/estoque-datas
 * Datas de snapshot de estoque disponíveis (para o seletor da tela).
 */
vendasRouter.get('/estoque-datas', authFirebase, async (_req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('estoque_diario')
      .select('data')
      .order('data', { ascending: false })
      .limit(2000);
    if (error) throw error;
    const datas = [...new Set((data || []).map(r => r.data))];
    res.json({ ultima: datas[0] || null, datas });
  } catch (err) { next(err); }
});

/**
 * GET /agente/vendas/cobertura
 *   ?from=&to=                      período de vendas p/ a média
 *   &data_estoque=                  snapshot (default: o mais recente)
 *   &lead_time=7&dias_seguranca=3&dias_excesso=60
 *   &<filtros multi por vírgula>
 *
 * Cruza vendas × estoque: média diária, cobertura em dias, status
 * (ruptura/crítico/atenção/ok/excesso/sem_giro) e sugestão de compra.
 */
vendasRouter.get('/cobertura', authFirebase, async (req, res, next) => {
  try {
    const from = (req.query.from || '').toString().trim() || null;
    const to   = (req.query.to   || '').toString().trim() || null;
    if (!from || !to) return res.status(400).json({ error: 'from e to são obrigatórios (YYYY-MM-DD)' });
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
      return res.status(400).json({ error: 'from/to devem ser YYYY-MM-DD' });
    }
    const dataEstoque = (req.query.data_estoque || '').toString().trim() || null;
    if (dataEstoque && !ISO_DATE.test(dataEstoque)) {
      return res.status(400).json({ error: 'data_estoque deve ser YYYY-MM-DD' });
    }

    const intOr = (v, def) => {
      const n = Number((v || '').toString().trim());
      return Number.isFinite(n) && n >= 0 ? Math.floor(n) : def;
    };
    const leadTime  = intOr(req.query.lead_time, 7);
    const seguranca = intOr(req.query.dias_seguranca, 3);
    const excesso   = intOr(req.query.dias_excesso, 60);

    // canal e fornecedor só existem na venda (o estoque não os tem): a RPC
    // aplica esses filtros pelo lado das vendas e restringe os produtos.
    const filtros = {};
    for (const k of ['filial_cod', 'secao_cod', 'departamento_cod', 'produto_cod',
                     'comprador_cod', 'canal_cod', 'fornecedor_cod']) {
      const arr = (req.query[k] || '').toString().split(',').map(s => s.trim()).filter(Boolean);
      if (arr.length) filtros[k] = arr;
    }

    const { data, error } = await supabase.rpc('fn_estoque_cobertura', {
      p_from: from,
      p_to: to,
      p_data_estoque: dataEstoque,
      p_lead_time: leadTime,
      p_dias_seguranca: seguranca,
      p_dias_excesso: excesso,
      p_filtros: filtros,
    });
    if (error) throw error;
    res.json(data || []);
  } catch (err) { next(err); }
});

/**
 * GET /agente/vendas/produto-serie?produto=283605&from=&to=&filial=300
 * Série diária de um produto: venda × estoque disponível (com a origem da
 * linha de estoque — 'arquivo' ou 'derivado'). Usada no drawer do produto.
 */
vendasRouter.get('/produto-serie', authFirebase, async (req, res, next) => {
  try {
    const produto = (req.query.produto || '').toString().trim();
    if (!produto) return res.status(400).json({ error: 'produto é obrigatório' });

    const from = (req.query.from || '').toString().trim();
    const to   = (req.query.to   || '').toString().trim();
    if (!ISO_DATE.test(from) || !ISO_DATE.test(to)) {
      return res.status(400).json({ error: 'from/to devem ser YYYY-MM-DD' });
    }
    const filial = (req.query.filial || '').toString().trim() || null;

    const { data, error } = await supabase.rpc('fn_estoque_produto_serie', {
      p_produto_cod: produto,
      p_from: from,
      p_to: to,
      p_filial_cod: filial,
    });
    if (error) throw error;
    res.json(data || []);
  } catch (err) { next(err); }
});

logger.info('Rotas /agente/vendas carregadas');
