-- 0027 — Adiciona nivel_obsolescencia em vw_supervisor_estoque_produto_atual
-- LEFT JOIN com a view de risco. Produtos cuja seção não tem cadastro de
-- validade ficam com nivel_obsolescencia = NULL.
-- A view era apenas SELECT * da MV; agora seleciona explicitamente as
-- colunas + traz o nível calculado on-the-fly via JOIN.
CREATE OR REPLACE VIEW public.vw_supervisor_estoque_produto_atual AS
SELECT
  m.snapshot_date, m.origem, m.filial_cod, m.filial, m.codigo_produto,
  m.descricao_produto, m.cod_barras, m.tipo, m.setor, m.departamento,
  m.secao, m.chave_secao, m.fornecedor, m.estoque, m.preco,
  m.quant_vendas, m.quant_movimentos, m.media_dia, m.dias_venda, m.giro,
  m.maximo, m.grade, m.multiplo, m.mix, m.ultima_entrada, m.ultima_saida,
  m.valor_estoque, m.banda, m.dias_ate_ruptura, m.dias_desde_ultima_saida,
  m.alertas_pendentes,
  r.nivel AS nivel_obsolescencia
FROM public.mv_supervisor_estoque_produto_atual m
LEFT JOIN public.vw_supervisor_estoque_risco_obsolescencia r
  ON r.codigo_produto = m.codigo_produto
 AND r.filial_cod     = m.filial_cod;
