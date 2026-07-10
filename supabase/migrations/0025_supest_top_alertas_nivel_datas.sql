-- 0025 — Acrescenta nivel_risco, ultima_entrada e ultima_saida em top_alertas.
-- CREATE OR REPLACE não basta porque a nova coluna nivel_risco precisa entrar
-- antes das colunas joinadas — DROP + CREATE garante a ordem.
DROP VIEW IF EXISTS public.vw_supervisor_estoque_top_alertas;
CREATE VIEW public.vw_supervisor_estoque_top_alertas AS
SELECT
  a.id, a.snapshot_date, a.filial_cod, a.filial,
  a.codigo_produto, a.descricao_produto,
  a.setor, a.departamento, a.secao, a.chave_secao, a.fornecedor,
  a.metrica, a.direcao, a.valor_atual, a.valor_baseline_7d, a.variacao_pct,
  a.status, a.primeira_deteccao, a.ultima_deteccao,
  a.nivel_risco,
  p.estoque, p.banda, p.dias_ate_ruptura, p.valor_estoque,
  p.ultima_entrada, p.ultima_saida
FROM public.supervisor_estoque_alertas a
LEFT JOIN public.mv_supervisor_estoque_produto_atual p
  ON p.codigo_produto = a.codigo_produto
 AND p.filial_cod     = a.filial_cod;
