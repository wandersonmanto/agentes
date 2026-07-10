-- ============================================================================
-- 0019 — Pisos de baseline mais rígidos no detector
-- ============================================================================
-- A versão 0013 da função aceitava baseline mínimo de 0.5 (media_dia, giro)
-- e 1 (dias_venda). Isso gerava ~700K alertas: produto cuja média histórica
-- era 1 dia de venda saltando pra 3 dias virava "+200%". Sinal verdadeiro
-- mas operacionalmente lixo — comprador não atua em cauda longa.
--
-- Novos pisos:
--   media_dia:  baseline >= 2     (precisa vender ao menos 2 un/dia)
--   dias_venda: baseline >= 3     (precisa vender em ao menos 3 dos 7 dias)
--   giro:       |baseline| >= 1   (giro insignificante fica de fora)
--
-- Resto do corpo permanece idêntico. Mantém SET statement_timeout = '5min'.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.fn_supest_detect_alerts(
  p_snapshot_date date,
  p_execucao_id   uuid,
  p_threshold_pct numeric DEFAULT 20.0
)
RETURNS TABLE(alertas_criados integer, alertas_atualizados integer)
LANGUAGE plpgsql
SET statement_timeout = '5min'
AS $function$
DECLARE
  v_ins int := 0;
  v_upd int := 0;
BEGIN
  WITH base AS (
    SELECT
      s.codigo_produto, s.filial_cod, s.filial, s.descricao_produto,
      s.setor, s.departamento, s.secao, s.chave_secao, s.fornecedor,
      s.media_dia, s.dias_venda, s.giro
    FROM public.supervisor_estoque_snapshots s
    WHERE s.snapshot_date = p_snapshot_date
  ),
  bl AS (
    SELECT
      h.codigo_produto, h.filial_cod,
      AVG(h.media_dia)  FILTER (WHERE h.media_dia  IS NOT NULL) AS bl_media_dia,
      AVG(h.dias_venda) FILTER (WHERE h.dias_venda IS NOT NULL) AS bl_dias_venda,
      AVG(h.giro)       FILTER (WHERE h.giro       IS NOT NULL) AS bl_giro,
      COUNT(*) AS n
    FROM public.supervisor_estoque_snapshots h
    WHERE h.snapshot_date <  p_snapshot_date
      AND h.snapshot_date >= p_snapshot_date - INTERVAL '7 days'
    GROUP BY h.codigo_produto, h.filial_cod
    HAVING COUNT(*) >= 3
  ),
  candidatos AS (
    SELECT b.*, bl.bl_media_dia, bl.bl_dias_venda, bl.bl_giro
    FROM base b JOIN bl USING (codigo_produto, filial_cod)
  ),
  flat AS (
    SELECT codigo_produto, filial_cod, filial, descricao_produto,
           setor, departamento, secao, chave_secao, fornecedor,
           'media_dia'::supest_metrica AS metrica,
           media_dia AS valor_atual, bl_media_dia AS baseline
    FROM candidatos
    WHERE media_dia    IS NOT NULL
      AND bl_media_dia IS NOT NULL
      AND bl_media_dia >= 2          -- piso novo (era 0.5)
    UNION ALL
    SELECT codigo_produto, filial_cod, filial, descricao_produto,
           setor, departamento, secao, chave_secao, fornecedor,
           'dias_venda'::supest_metrica,
           dias_venda, bl_dias_venda
    FROM candidatos
    WHERE dias_venda    IS NOT NULL
      AND bl_dias_venda IS NOT NULL
      AND bl_dias_venda >= 3         -- piso novo (era 1)
    UNION ALL
    SELECT codigo_produto, filial_cod, filial, descricao_produto,
           setor, departamento, secao, chave_secao, fornecedor,
           'giro'::supest_metrica,
           giro, bl_giro
    FROM candidatos
    WHERE giro    IS NOT NULL
      AND bl_giro IS NOT NULL
      AND abs(bl_giro) >= 1          -- piso novo (era 0.5)
  ),
  eligible AS (
    SELECT *,
           ROUND(((valor_atual - baseline) / abs(baseline)) * 100, 2) AS variacao_pct
    FROM flat
    WHERE baseline <> 0
  ),
  novos AS (
    INSERT INTO public.supervisor_estoque_alertas (
      agente_execucao_id, snapshot_date,
      filial, filial_cod, codigo_produto, descricao_produto,
      setor, departamento, secao, chave_secao, fornecedor,
      metrica, direcao, valor_atual, valor_baseline_7d, variacao_pct
    )
    SELECT
      p_execucao_id, p_snapshot_date,
      filial, filial_cod, codigo_produto, descricao_produto,
      setor, departamento, secao, chave_secao, fornecedor,
      metrica,
      CASE WHEN variacao_pct >= 0
           THEN 'aumento'::supest_direcao
           ELSE 'queda'::supest_direcao END,
      valor_atual, baseline, variacao_pct
    FROM eligible
    WHERE abs(variacao_pct) >= p_threshold_pct
    ON CONFLICT (snapshot_date, filial_cod, codigo_produto, metrica, direcao) DO UPDATE SET
      valor_atual        = EXCLUDED.valor_atual,
      valor_baseline_7d  = EXCLUDED.valor_baseline_7d,
      variacao_pct       = EXCLUDED.variacao_pct,
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
