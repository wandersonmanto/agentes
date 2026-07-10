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

logger.info('Rotas /agente/vendas carregadas');
