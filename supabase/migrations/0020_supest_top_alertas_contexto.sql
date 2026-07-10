-- ============================================================================
-- 0020 — top_alertas com contexto operacional (estoque/banda/ruptura)
-- ============================================================================
-- A view antiga devolvia só o alerta (baseline 7d, valor atual, variação).
-- Pra ação do comprador faltam estoque, banda atual e dias até ruptura —
-- e o drawer de detalhe abrir com tudo de uma vez precisa desses campos.
--
-- LEFT JOIN com mv_supervisor_estoque_produto_atual (já materializada após
-- cada ingest) traz o contexto sem custo de view-on-view.
--
-- Também removemos o filtro "snapshot_date = MAX(snapshot_date)" da versão
-- anterior — o backend já filtra por status e por filial, e o filtro
-- escondia alertas pendentes de dias anteriores se um SKU teve novo
-- alerta hoje numa direção diferente, o que confunde o histórico do drawer.
-- ============================================================================
CREATE OR REPLACE VIEW public.vw_supervisor_estoque_top_alertas AS
SELECT
  a.id,
  a.snapshot_date,
  a.filial_cod,
  a.filial,
  a.codigo_produto,
  a.descricao_produto,
  a.setor,
  a.departamento,
  a.secao,
  a.chave_secao,
  a.fornecedor,
  a.metrica,
  a.direcao,
  a.valor_atual,
  a.valor_baseline_7d,
  a.variacao_pct,
  a.status,
  a.primeira_deteccao,
  a.ultima_deteccao,
  p.estoque,
  p.banda,
  p.dias_ate_ruptura,
  p.valor_estoque
FROM public.supervisor_estoque_alertas a
LEFT JOIN public.mv_supervisor_estoque_produto_atual p
  ON p.codigo_produto = a.codigo_produto
 AND p.filial_cod    = a.filial_cod;
