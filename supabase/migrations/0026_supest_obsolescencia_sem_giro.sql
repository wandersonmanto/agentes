-- ============================================================================
-- 0026 — Obsolescência para produtos sem giro (media_dia = 0 ou NULL)
-- ============================================================================
-- Produto sem giro também merece alerta de obsolescência: o estoque parado
-- continua consumindo a validade. Sem media_dia não dá pra calcular
-- dias_ate_ruptura, então usamos `dias_parado / validade_efetiva` como taxa.
-- Mesmos limiares (60/80/100/130) — quando dias_parado >= validade_efetiva,
-- o lote já passou da data, perda_provavel.
-- Também adicionamos a coluna sem_giro na view e mudamos o cálculo de
-- excesso_unidades/valor_em_risco para esses casos (todo o estoque está em
-- risco, valor_em_risco = valor_estoque).
-- ============================================================================
DROP VIEW IF EXISTS public.vw_supervisor_estoque_risco_obsolescencia;
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
  CASE
    WHEN sem_giro THEN COALESCE(dias_parado, 0)
    ELSE GREATEST(COALESCE(dias_ate_ruptura, 0) - validade_restante_dias, 0)
  END AS excesso_dias,
  CASE
    WHEN sem_giro THEN estoque::int
    ELSE ROUND(
      GREATEST(COALESCE(dias_ate_ruptura, 0) - validade_restante_dias, 0)
      * COALESCE(media_dia, 0)
    )::int
  END AS excesso_unidades,
  CASE
    WHEN sem_giro THEN ROUND(COALESCE(valor_estoque, 0)::numeric, 2)
    ELSE ROUND(
      GREATEST(COALESCE(dias_ate_ruptura, 0) - validade_restante_dias, 0)
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

-- Função detectora atualizada
CREATE OR REPLACE FUNCTION public.fn_supest_detect_obsolescencia(
  p_snapshot_date date, p_execucao_id uuid
) RETURNS TABLE(alertas_criados integer, alertas_atualizados integer)
LANGUAGE plpgsql SET statement_timeout = '5min'
AS $function$
DECLARE v_ins int := 0; v_upd int := 0; v_pct_max numeric;
BEGIN
  SELECT pct_max_validade_no_recebimento INTO v_pct_max
    FROM public.supervisor_estoque_config WHERE id = true;
  v_pct_max := COALESCE(v_pct_max, 0.10);

  WITH base AS (
    SELECT
      s.codigo_produto, s.filial_cod, s.filial, s.descricao_produto,
      s.setor, s.departamento, s.secao, s.chave_secao, s.fornecedor,
      s.estoque, s.media_dia, s.preco, s.vlr_estoque, s.ultima_entrada,
      CASE WHEN s.media_dia IS NULL OR s.media_dia = 0 THEN NULL
           WHEN s.estoque IS NULL THEN NULL
           ELSE ROUND(s.estoque / s.media_dia, 1) END AS dias_ate_ruptura,
      (s.media_dia IS NULL OR s.media_dia = 0) AS sem_giro
    FROM public.supervisor_estoque_snapshots s
    WHERE s.snapshot_date = p_snapshot_date
      AND s.estoque IS NOT NULL AND s.estoque > 0
  ),
  conf AS (
    SELECT b.*, v.validade_media_dias, v.categoria,
      COALESCE(v.pct_atencao, cc.pct_atencao) AS pct_atencao,
      COALESCE(v.pct_risco,   cc.pct_risco)   AS pct_risco,
      COALESCE(v.pct_critico, cc.pct_critico) AS pct_critico,
      ROUND(v.validade_media_dias * (1 - v_pct_max))::int AS validade_efetiva,
      CASE WHEN b.ultima_entrada IS NULL THEN NULL
           ELSE (p_snapshot_date - b.ultima_entrada) END AS dias_parado
    FROM base b
    JOIN public.supervisor_estoque_secao_validade v
      ON v.chave_secao = TRIM(b.chave_secao)
    LEFT JOIN public.supervisor_estoque_config_categoria cc
      ON cc.categoria = v.categoria
    WHERE v.validade_media_dias IS NOT NULL
  ),
  metricas AS (
    SELECT *,
      GREATEST(validade_efetiva - COALESCE(dias_parado, 0), 0) AS validade_restante,
      CASE
        WHEN sem_giro AND validade_efetiva > 0
          THEN COALESCE(dias_parado, 0) / validade_efetiva::numeric
        WHEN NOT sem_giro AND dias_ate_ruptura IS NOT NULL
             AND validade_efetiva - COALESCE(dias_parado, 0) > 0
          THEN dias_ate_ruptura / (validade_efetiva - COALESCE(dias_parado, 0))::numeric
        ELSE NULL
      END AS taxa
    FROM conf
  ),
  classif AS (
    SELECT *,
      CASE
        WHEN taxa IS NULL THEN NULL
        WHEN sem_giro AND COALESCE(dias_parado, 0) >= validade_efetiva
          THEN 'perda_provavel'::public.supest_nivel_risco
        WHEN (NOT sem_giro) AND validade_efetiva - COALESCE(dias_parado, 0) <= 0
          THEN 'perda_provavel'::public.supest_nivel_risco
        WHEN taxa >= 1.30 THEN 'perda_provavel'
        WHEN taxa >= pct_critico THEN 'critico'
        WHEN taxa >= pct_risco   THEN 'risco'
        WHEN taxa >= pct_atencao THEN 'atencao'
        ELSE NULL
      END AS nivel
    FROM metricas
  ),
  novos AS (
    INSERT INTO public.supervisor_estoque_alertas (
      agente_execucao_id, snapshot_date, filial, filial_cod, codigo_produto, descricao_produto,
      setor, departamento, secao, chave_secao, fornecedor,
      metrica, direcao, valor_atual, valor_baseline_7d, variacao_pct, nivel_risco
    )
    SELECT p_execucao_id, p_snapshot_date,
      filial, filial_cod, codigo_produto, descricao_produto,
      setor, departamento, secao, chave_secao, fornecedor,
      'obsolescencia'::public.supest_metrica,
      'aumento'::public.supest_direcao,
      CASE WHEN sem_giro THEN COALESCE(dias_parado, 0)::numeric ELSE dias_ate_ruptura END,
      CASE WHEN sem_giro THEN validade_efetiva::numeric
           ELSE GREATEST(validade_restante, 1)::numeric END,
      ROUND(taxa * 100, 2),
      nivel
    FROM classif WHERE nivel IS NOT NULL
    ON CONFLICT (snapshot_date, filial_cod, codigo_produto, metrica, direcao) DO UPDATE SET
      valor_atual = EXCLUDED.valor_atual,
      valor_baseline_7d = EXCLUDED.valor_baseline_7d,
      variacao_pct = EXCLUDED.variacao_pct,
      nivel_risco = EXCLUDED.nivel_risco,
      agente_execucao_id = EXCLUDED.agente_execucao_id,
      ultima_deteccao = now(), updated_at = now()
    RETURNING (xmax = 0) AS inserted
  )
  SELECT COUNT(*) FILTER (WHERE inserted), COUNT(*) FILTER (WHERE NOT inserted)
  INTO v_ins, v_upd FROM novos;

  alertas_criados := v_ins; alertas_atualizados := v_upd;
  RETURN NEXT;
END $function$;
