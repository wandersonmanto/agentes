-- ============================================================================
-- 0023 — fn_supest_detect_obsolescencia(snapshot_date, exec_id)
-- ============================================================================
-- Reproduz a lógica da view de risco para um snapshot específico e popula
-- supervisor_estoque_alertas com metrica='obsolescencia', direcao='aumento',
-- nivel_risco preenchido.
--
-- Estrutura (compatível com o detector existente):
--   valor_atual       = cobertura projetada em dias
--   valor_baseline_7d = validade restante em dias
--   variacao_pct      = (cobertura − validade_restante) / validade_restante × 100
--
-- Idempotente: ON CONFLICT em (snapshot_date, filial_cod, codigo_produto,
-- metrica, direcao).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_supest_detect_obsolescencia(
  p_snapshot_date date,
  p_execucao_id   uuid
)
RETURNS TABLE(alertas_criados integer, alertas_atualizados integer)
LANGUAGE plpgsql
SET statement_timeout = '5min'
AS $function$
DECLARE
  v_ins int := 0;
  v_upd int := 0;
  v_pct_max numeric;
BEGIN
  SELECT pct_max_validade_no_recebimento INTO v_pct_max
  FROM public.supervisor_estoque_config WHERE id = true;
  v_pct_max := COALESCE(v_pct_max, 0.10);

  WITH base AS (
    SELECT
      s.codigo_produto, s.filial_cod, s.filial, s.descricao_produto,
      s.setor, s.departamento, s.secao, s.chave_secao, s.fornecedor,
      s.estoque, s.media_dia, s.preco, s.vlr_estoque, s.ultima_entrada,
      CASE
        WHEN s.media_dia IS NULL OR s.media_dia = 0 THEN NULL
        WHEN s.estoque   IS NULL THEN NULL
        ELSE ROUND(s.estoque / s.media_dia, 1)
      END AS dias_ate_ruptura
    FROM public.supervisor_estoque_snapshots s
    WHERE s.snapshot_date = p_snapshot_date
  ),
  conf AS (
    SELECT
      b.*,
      v.validade_media_dias,
      v.categoria,
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
      AND b.dias_ate_ruptura IS NOT NULL
  ),
  metricas AS (
    SELECT
      *,
      GREATEST(validade_efetiva - COALESCE(dias_parado, 0), 0) AS validade_restante
    FROM conf
  ),
  classif AS (
    SELECT
      *,
      CASE
        WHEN validade_restante <= 0 THEN 'perda_provavel'::public.supest_nivel_risco
        WHEN dias_ate_ruptura / validade_restante::numeric >= 1.30 THEN 'perda_provavel'
        WHEN dias_ate_ruptura / validade_restante::numeric >= pct_critico THEN 'critico'
        WHEN dias_ate_ruptura / validade_restante::numeric >= pct_risco   THEN 'risco'
        WHEN dias_ate_ruptura / validade_restante::numeric >= pct_atencao THEN 'atencao'
        ELSE NULL
      END AS nivel
    FROM metricas
  ),
  novos AS (
    INSERT INTO public.supervisor_estoque_alertas (
      agente_execucao_id, snapshot_date,
      filial, filial_cod, codigo_produto, descricao_produto,
      setor, departamento, secao, chave_secao, fornecedor,
      metrica, direcao, valor_atual, valor_baseline_7d, variacao_pct,
      nivel_risco
    )
    SELECT
      p_execucao_id, p_snapshot_date,
      filial, filial_cod, codigo_produto, descricao_produto,
      setor, departamento, secao, chave_secao, fornecedor,
      'obsolescencia'::public.supest_metrica,
      'aumento'::public.supest_direcao,
      dias_ate_ruptura,
      GREATEST(validade_restante, 1)::numeric,
      ROUND(
        ((dias_ate_ruptura - validade_restante) / NULLIF(GREATEST(validade_restante, 1), 0)::numeric) * 100,
        2
      ),
      nivel
    FROM classif
    WHERE nivel IS NOT NULL
    ON CONFLICT (snapshot_date, filial_cod, codigo_produto, metrica, direcao) DO UPDATE SET
      valor_atual        = EXCLUDED.valor_atual,
      valor_baseline_7d  = EXCLUDED.valor_baseline_7d,
      variacao_pct       = EXCLUDED.variacao_pct,
      nivel_risco        = EXCLUDED.nivel_risco,
      agente_execucao_id = EXCLUDED.agente_execucao_id,
      ultima_deteccao    = now(),
      updated_at         = now()
    RETURNING (xmax = 0) AS inserted
  )
  SELECT COUNT(*) FILTER (WHERE inserted),
         COUNT(*) FILTER (WHERE NOT inserted)
  INTO v_ins, v_upd
  FROM novos;

  alertas_criados     := v_ins;
  alertas_atualizados := v_upd;
  RETURN NEXT;
END
$function$;
