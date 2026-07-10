-- ============================================================================
-- 0022 — View vw_supervisor_estoque_risco_obsolescencia
-- ============================================================================
-- Calcula, para cada SKU×filial já cadastrado:
--   - validade_efetiva_recebimento  = média × (1 - pct_max_recebimento)
--   - validade_restante_dias        = efetiva - (snapshot - ultima_entrada)
--   - taxa_consumo                  = cobertura / validade restante
--   - excesso_dias / excesso_un / valor_em_risco
--   - nivel ∈ (NULL, atencao, risco, critico, perda_provavel)
-- ============================================================================
CREATE OR REPLACE VIEW public.vw_supervisor_estoque_risco_obsolescencia AS
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
),
calc AS (
  SELECT *,
    ROUND(validade_media_dias * (1 - COALESCE(pct_max_recebimento, 0.10)))::int
      AS validade_efetiva_recebimento_dias,
    CASE WHEN ultima_entrada IS NULL THEN NULL
         ELSE (snapshot_date - ultima_entrada) END
      AS dias_parado
  FROM linhas
)
SELECT
  snapshot_date, filial_cod, filial, codigo_produto, descricao_produto,
  setor, departamento, secao, chave_secao, fornecedor,
  estoque, media_dia, dias_venda, giro, dias_ate_ruptura,
  valor_estoque, preco, ultima_entrada,
  validade_media_dias, categoria, pct_max_recebimento,
  pct_atencao, pct_risco, pct_critico,
  validade_efetiva_recebimento_dias,
  dias_parado,
  GREATEST(validade_efetiva_recebimento_dias - COALESCE(dias_parado, 0), 0)
    AS validade_restante_dias,
  CASE
    WHEN dias_ate_ruptura IS NULL THEN NULL
    WHEN validade_efetiva_recebimento_dias - COALESCE(dias_parado, 0) <= 0 THEN NULL
    ELSE ROUND(
      dias_ate_ruptura
      / NULLIF(validade_efetiva_recebimento_dias - COALESCE(dias_parado, 0), 0)::numeric,
      3)
  END AS taxa_consumo,
  GREATEST(
    COALESCE(dias_ate_ruptura, 0)
    - GREATEST(validade_efetiva_recebimento_dias - COALESCE(dias_parado, 0), 0),
    0
  ) AS excesso_dias,
  ROUND(
    GREATEST(
      COALESCE(dias_ate_ruptura, 0)
      - GREATEST(validade_efetiva_recebimento_dias - COALESCE(dias_parado, 0), 0),
      0
    ) * COALESCE(media_dia, 0)
  )::int AS excesso_unidades,
  ROUND(
    GREATEST(
      COALESCE(dias_ate_ruptura, 0)
      - GREATEST(validade_efetiva_recebimento_dias - COALESCE(dias_parado, 0), 0),
      0
    ) * COALESCE(media_dia, 0)
    * COALESCE(preco, NULLIF(valor_estoque, 0) / NULLIF(estoque, 0), 0)
  , 2) AS valor_em_risco,
  CASE
    WHEN dias_ate_ruptura IS NULL THEN NULL::public.supest_nivel_risco
    WHEN validade_efetiva_recebimento_dias - COALESCE(dias_parado, 0) <= 0
      THEN 'perda_provavel'::public.supest_nivel_risco
    WHEN dias_ate_ruptura / (validade_efetiva_recebimento_dias - COALESCE(dias_parado, 0))::numeric
         >= 1.30 THEN 'perda_provavel'::public.supest_nivel_risco
    WHEN dias_ate_ruptura / (validade_efetiva_recebimento_dias - COALESCE(dias_parado, 0))::numeric
         >= pct_critico THEN 'critico'::public.supest_nivel_risco
    WHEN dias_ate_ruptura / (validade_efetiva_recebimento_dias - COALESCE(dias_parado, 0))::numeric
         >= pct_risco   THEN 'risco'::public.supest_nivel_risco
    WHEN dias_ate_ruptura / (validade_efetiva_recebimento_dias - COALESCE(dias_parado, 0))::numeric
         >= pct_atencao THEN 'atencao'::public.supest_nivel_risco
    ELSE NULL::public.supest_nivel_risco
  END AS nivel,
  observacoes
FROM calc;
