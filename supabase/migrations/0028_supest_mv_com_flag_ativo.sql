-- ============================================================================
-- 0028 — MV com flag ativo_no_ultimo_snapshot + dias_ausente
-- ============================================================================
-- Hoje a MV faz MAX(snapshot_date) por SKU×filial e congela o último estado
-- conhecido — produtos que sumiram do mix continuam aparecendo com estoque
-- "fantasma". Agora distinguimos:
--   ativo_no_ultimo_snapshot = (último snapshot do SKU == último snapshot global)
--   dias_ausente             = último snapshot global − último snapshot do SKU
--
-- As views derivadas continuam expondo TODOS os SKUs (ativos + sumidos),
-- e o filtro fica no endpoint. A view de risco de obsolescência filtra
-- ativo=true internamente.
-- ============================================================================
DROP MATERIALIZED VIEW IF EXISTS public.mv_supervisor_estoque_produto_atual CASCADE;

CREATE MATERIALIZED VIEW public.mv_supervisor_estoque_produto_atual AS
WITH ultimo_global AS (
  SELECT MAX(snapshot_date) AS dt FROM public.supervisor_estoque_snapshots
),
max_dt AS (
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
),
ug AS (SELECT dt FROM ultimo_global)
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
  COALESCE(a.n, 0::bigint) AS alertas_pendentes,
  (u.snapshot_date = (SELECT dt FROM ug)) AS ativo_no_ultimo_snapshot,
  ((SELECT dt FROM ug) - u.snapshot_date)::int AS dias_ausente
FROM ult u
LEFT JOIN alertas_count a
  ON a.codigo_produto = u.codigo_produto AND a.filial_cod = u.filial_cod
WITH NO DATA;

CREATE UNIQUE INDEX mv_supest_pa_pk
  ON public.mv_supervisor_estoque_produto_atual (codigo_produto, filial_cod);
CREATE INDEX mv_supest_pa_filial      ON public.mv_supervisor_estoque_produto_atual (filial_cod);
CREATE INDEX mv_supest_pa_banda       ON public.mv_supervisor_estoque_produto_atual (banda);
CREATE INDEX mv_supest_pa_filial_banda ON public.mv_supervisor_estoque_produto_atual (filial_cod, banda);
CREATE INDEX mv_supest_pa_chave_secao ON public.mv_supervisor_estoque_produto_atual (chave_secao);
CREATE INDEX mv_supest_pa_fornecedor  ON public.mv_supervisor_estoque_produto_atual (fornecedor);
CREATE INDEX mv_supest_pa_ativo       ON public.mv_supervisor_estoque_produto_atual (ativo_no_ultimo_snapshot);

REFRESH MATERIALIZED VIEW public.mv_supervisor_estoque_produto_atual;

-- Recria views derivadas que o CASCADE dropou.
-- 1) Risco de obsolescência — filtra ativo=true
CREATE VIEW public.vw_supervisor_estoque_risco_obsolescencia AS
WITH cfg AS (
  SELECT pct_max_validade_no_recebimento AS pct_max
  FROM public.supervisor_estoque_config WHERE id = true LIMIT 1
),
linhas AS (
  SELECT
    p.snapshot_date, p.filial_cod, p.filial, p.codigo_produto, p.descricao_produto,
    p.setor, p.departamento, p.secao, p.chave_secao, p.fornecedor,
    p.estoque, p.media_dia, p.dias_venda, p.giro, p.dias_ate_ruptura,
    p.valor_estoque, p.preco, p.ultima_entrada,
    v.validade_media_dias, v.categoria, v.observacoes,
    COALESCE(v.pct_atencao, cc.pct_atencao) AS pct_atencao,
    COALESCE(v.pct_risco,   cc.pct_risco)   AS pct_risco,
    COALESCE(v.pct_critico, cc.pct_critico) AS pct_critico,
    (SELECT pct_max FROM cfg) AS pct_max_recebimento
  FROM public.mv_supervisor_estoque_produto_atual p
  JOIN public.supervisor_estoque_secao_validade v
    ON v.chave_secao = TRIM(p.chave_secao)
  LEFT JOIN public.supervisor_estoque_config_categoria cc
    ON cc.categoria = v.categoria
  WHERE v.validade_media_dias IS NOT NULL
    AND p.estoque IS NOT NULL AND p.estoque > 0
    AND p.ativo_no_ultimo_snapshot = true
),
calc AS (
  SELECT *,
    ROUND(validade_media_dias * (1 - COALESCE(pct_max_recebimento, 0.10)))::int
      AS validade_efetiva_recebimento_dias,
    CASE WHEN ultima_entrada IS NULL THEN NULL
         ELSE (snapshot_date - ultima_entrada) END AS dias_parado,
    (media_dia IS NULL OR media_dia = 0) AS sem_giro
  FROM linhas
),
classificado AS (
  SELECT *,
    GREATEST(validade_efetiva_recebimento_dias - COALESCE(dias_parado, 0), 0)
      AS validade_restante_dias,
    CASE
      WHEN sem_giro AND validade_efetiva_recebimento_dias > 0
        THEN ROUND(COALESCE(dias_parado, 0) / validade_efetiva_recebimento_dias::numeric, 3)
      WHEN NOT sem_giro AND dias_ate_ruptura IS NOT NULL
           AND validade_efetiva_recebimento_dias - COALESCE(dias_parado, 0) > 0
        THEN ROUND(
          dias_ate_ruptura
          / NULLIF(validade_efetiva_recebimento_dias - COALESCE(dias_parado, 0), 0)::numeric,
          3)
      ELSE NULL
    END AS taxa_consumo
  FROM calc
)
SELECT
  snapshot_date, filial_cod, filial, codigo_produto, descricao_produto,
  setor, departamento, secao, chave_secao, fornecedor,
  estoque, media_dia, dias_venda, giro, dias_ate_ruptura,
  valor_estoque, preco, ultima_entrada,
  validade_media_dias, categoria, pct_max_recebimento,
  pct_atencao, pct_risco, pct_critico,
  validade_efetiva_recebimento_dias,
  dias_parado, validade_restante_dias, sem_giro, taxa_consumo,
  CASE WHEN sem_giro THEN COALESCE(dias_parado, 0)
       ELSE GREATEST(COALESCE(dias_ate_ruptura, 0) - validade_restante_dias, 0)
  END AS excesso_dias,
  CASE WHEN sem_giro THEN estoque::int
       ELSE ROUND(GREATEST(COALESCE(dias_ate_ruptura, 0) - validade_restante_dias, 0)
                  * COALESCE(media_dia, 0))::int
  END AS excesso_unidades,
  CASE WHEN sem_giro THEN ROUND(COALESCE(valor_estoque, 0)::numeric, 2)
       ELSE ROUND(GREATEST(COALESCE(dias_ate_ruptura, 0) - validade_restante_dias, 0)
                  * COALESCE(media_dia, 0)
                  * COALESCE(preco, NULLIF(valor_estoque, 0) / NULLIF(estoque, 0), 0)
                  , 2)
  END AS valor_em_risco,
  CASE
    WHEN taxa_consumo IS NULL THEN NULL::public.supest_nivel_risco
    WHEN sem_giro AND COALESCE(dias_parado, 0) >= validade_efetiva_recebimento_dias
      THEN 'perda_provavel'::public.supest_nivel_risco
    WHEN (NOT sem_giro) AND validade_efetiva_recebimento_dias - COALESCE(dias_parado, 0) <= 0
      THEN 'perda_provavel'::public.supest_nivel_risco
    WHEN taxa_consumo >= 1.30 THEN 'perda_provavel'::public.supest_nivel_risco
    WHEN taxa_consumo >= pct_critico THEN 'critico'::public.supest_nivel_risco
    WHEN taxa_consumo >= pct_risco   THEN 'risco'::public.supest_nivel_risco
    WHEN taxa_consumo >= pct_atencao THEN 'atencao'::public.supest_nivel_risco
    ELSE NULL::public.supest_nivel_risco
  END AS nivel,
  observacoes
FROM classificado;

-- 2) produto_atual — NÃO filtra (endpoint decide)
CREATE VIEW public.vw_supervisor_estoque_produto_atual AS
SELECT
  m.snapshot_date, m.origem, m.filial_cod, m.filial, m.codigo_produto,
  m.descricao_produto, m.cod_barras, m.tipo, m.setor, m.departamento,
  m.secao, m.chave_secao, m.fornecedor, m.estoque, m.preco,
  m.quant_vendas, m.quant_movimentos, m.media_dia, m.dias_venda, m.giro,
  m.maximo, m.grade, m.multiplo, m.mix, m.ultima_entrada, m.ultima_saida,
  m.valor_estoque, m.banda, m.dias_ate_ruptura, m.dias_desde_ultima_saida,
  m.alertas_pendentes, m.ativo_no_ultimo_snapshot, m.dias_ausente,
  r.nivel AS nivel_obsolescencia
FROM public.mv_supervisor_estoque_produto_atual m
LEFT JOIN public.vw_supervisor_estoque_risco_obsolescencia r
  ON r.codigo_produto = m.codigo_produto
 AND r.filial_cod     = m.filial_cod;

-- 3) top_alertas — mantém histórico, expõe dias_ausente
CREATE VIEW public.vw_supervisor_estoque_top_alertas AS
SELECT
  a.id, a.snapshot_date, a.filial_cod, a.filial,
  a.codigo_produto, a.descricao_produto,
  a.setor, a.departamento, a.secao, a.chave_secao, a.fornecedor,
  a.metrica, a.direcao, a.valor_atual, a.valor_baseline_7d, a.variacao_pct,
  a.status, a.primeira_deteccao, a.ultima_deteccao,
  a.nivel_risco,
  p.estoque, p.banda, p.dias_ate_ruptura, p.valor_estoque,
  p.ultima_entrada, p.ultima_saida,
  p.ativo_no_ultimo_snapshot, p.dias_ausente
FROM public.supervisor_estoque_alertas a
LEFT JOIN public.mv_supervisor_estoque_produto_atual p
  ON p.codigo_produto = a.codigo_produto
 AND p.filial_cod     = a.filial_cod;
