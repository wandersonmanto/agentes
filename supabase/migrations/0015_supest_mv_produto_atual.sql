-- ============================================================================
-- 0015 — Materialized View para vw_supervisor_estoque_produto_atual
-- ============================================================================
-- A view original fazia DISTINCT ON (codigo_produto, filial_cod) ORDER BY
-- snapshot_date DESC sobre toda a tabela supervisor_estoque_snapshots. Com
-- 1,5M+ linhas, qualquer GROUP BY/agregação na view virava timeout (>30s) e
-- chegou a estourar o disco temporário do Postgres.
--
-- Esta migration:
--   1. Cria a MV `mv_supervisor_estoque_produto_atual` usando JOIN com
--      MAX(snapshot_date) por (codigo_produto, filial_cod) — bate no índice
--      idx_supest_snap_prod_filial_date e não exige sort gigante.
--   2. Cria índices na MV (PK lógica, banda, filial, secao, fornecedor).
--   3. Cria a função fn_supest_refresh_produto_atual() — chamar após cada
--      ingest (REFRESH ... CONCURRENTLY exige o índice único acima).
--   4. Reaponta a view existente para `SELECT * FROM mv_*` — views derivadas
--      (dim_*, top_alertas, resumo_filial, etc.) continuam funcionando.
-- ============================================================================

CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_supervisor_estoque_produto_atual AS
WITH max_dt AS (
  SELECT codigo_produto, filial_cod, MAX(snapshot_date) AS snapshot_date
  FROM public.supervisor_estoque_snapshots
  GROUP BY codigo_produto, filial_cod
),
ult AS (
  SELECT s.snapshot_date, s.origem, s.filial, s.filial_cod, s.codigo_produto,
         s.descricao_produto, s.cod_barras, s.tipo, s.setor, s.departamento, s.secao,
         s.chave_secao, s.fornecedor, s.estoque, s.quant_vendas, s.media_dia,
         s.quant_movimentos, s.dias_venda, s.giro, s.maximo, s.grade, s.multiplo,
         s.preco, s.vlr_estoque, s.mix, s.ultima_entrada, s.ultima_saida
  FROM public.supervisor_estoque_snapshots s
  JOIN max_dt m
    ON m.codigo_produto = s.codigo_produto
   AND m.filial_cod    = s.filial_cod
   AND m.snapshot_date = s.snapshot_date
),
alertas_count AS (
  SELECT a.codigo_produto, a.filial_cod, COUNT(*) AS n
  FROM public.supervisor_estoque_alertas a
  WHERE a.status = 'pendente'::supest_status
  GROUP BY a.codigo_produto, a.filial_cod
)
SELECT
  u.snapshot_date, u.origem, u.filial_cod, u.filial, u.codigo_produto,
  u.descricao_produto, u.cod_barras, u.tipo, u.setor, u.departamento, u.secao,
  u.chave_secao, u.fornecedor, u.estoque, u.preco, u.quant_vendas,
  u.quant_movimentos, u.media_dia, u.dias_venda, u.giro, u.maximo, u.grade,
  u.multiplo, u.mix, u.ultima_entrada, u.ultima_saida,
  COALESCE(u.vlr_estoque, u.estoque * u.preco) AS valor_estoque,
  public.fn_supest_banda(u.dias_venda) AS banda,
  CASE
    WHEN u.media_dia IS NULL OR u.media_dia = 0::numeric THEN NULL::numeric
    WHEN u.estoque   IS NULL                              THEN NULL::numeric
    ELSE round(u.estoque / u.media_dia, 1)
  END AS dias_ate_ruptura,
  CASE
    WHEN u.ultima_saida IS NULL THEN NULL::integer
    ELSE u.snapshot_date - u.ultima_saida
  END AS dias_desde_ultima_saida,
  COALESCE(a.n, 0::bigint) AS alertas_pendentes
FROM ult u
LEFT JOIN alertas_count a
  ON a.codigo_produto = u.codigo_produto AND a.filial_cod = u.filial_cod
WITH NO DATA;

CREATE UNIQUE INDEX IF NOT EXISTS mv_supest_pa_pk
  ON public.mv_supervisor_estoque_produto_atual (codigo_produto, filial_cod);
CREATE INDEX IF NOT EXISTS mv_supest_pa_filial
  ON public.mv_supervisor_estoque_produto_atual (filial_cod);
CREATE INDEX IF NOT EXISTS mv_supest_pa_banda
  ON public.mv_supervisor_estoque_produto_atual (banda);
CREATE INDEX IF NOT EXISTS mv_supest_pa_filial_banda
  ON public.mv_supervisor_estoque_produto_atual (filial_cod, banda);
CREATE INDEX IF NOT EXISTS mv_supest_pa_chave_secao
  ON public.mv_supervisor_estoque_produto_atual (chave_secao);
CREATE INDEX IF NOT EXISTS mv_supest_pa_fornecedor
  ON public.mv_supervisor_estoque_produto_atual (fornecedor);

-- Refresh inicial (sem CONCURRENTLY na primeira vez — mais rápido).
REFRESH MATERIALIZED VIEW public.mv_supervisor_estoque_produto_atual;

-- Função de refresh para uso após cada ingest (CONCURRENTLY usa o unique idx).
CREATE OR REPLACE FUNCTION public.fn_supest_refresh_produto_atual()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_supervisor_estoque_produto_atual;
END;
$$;

-- Reaponta a view existente para ler da MV.
CREATE OR REPLACE VIEW public.vw_supervisor_estoque_produto_atual AS
SELECT * FROM public.mv_supervisor_estoque_produto_atual;
