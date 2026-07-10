-- ============================================================================
-- 0030 — View + função detector de rupturas confirmadas
-- ============================================================================
-- Critérios:
--   - SKU×filial sumido (ativo_no_ultimo_snapshot = false)
--   - dias_ausente >= 2  (evita falso positivo por domingo / dia sem export)
--   - banda na última aparição era constante / médio / baixo (não crítico)
--   - estoque > 0 na última aparição
--   - aparição em >= 7 dias DISTINTOS na base toda (evita produto que veio
--     só uma vez por erro)
-- ============================================================================
CREATE OR REPLACE VIEW public.vw_supervisor_estoque_rupturas_confirmadas AS
WITH historico AS (
  SELECT codigo_produto, filial_cod, COUNT(DISTINCT snapshot_date) AS dias_presenca
  FROM public.supervisor_estoque_snapshots
  GROUP BY codigo_produto, filial_cod
)
SELECT
  p.codigo_produto, p.filial_cod, p.filial, p.descricao_produto,
  p.setor, p.departamento, p.secao, p.chave_secao, p.fornecedor,
  p.estoque               AS estoque_ultima_aparicao,
  p.media_dia,
  p.dias_venda,
  p.giro,
  p.banda                 AS banda_ultima_aparicao,
  p.valor_estoque         AS valor_estoque_ultima_aparicao,
  p.snapshot_date         AS data_ultima_aparicao,
  p.dias_ausente,
  p.ultima_entrada,
  p.ultima_saida,
  h.dias_presenca,
  ROUND(COALESCE(p.media_dia, 0) * p.dias_ausente)::int       AS venda_perdida_un_estimada,
  ROUND(
    COALESCE(p.media_dia, 0)
    * p.dias_ausente
    * COALESCE(p.preco, NULLIF(p.valor_estoque, 0) / NULLIF(p.estoque, 0), 0)
  , 2) AS venda_perdida_brl_estimada
FROM public.mv_supervisor_estoque_produto_atual p
JOIN historico h USING (codigo_produto, filial_cod)
WHERE p.ativo_no_ultimo_snapshot = false
  AND p.dias_ausente >= 2
  AND p.estoque > 0
  AND p.banda IN ('constante', 'medio', 'baixo')
  AND h.dias_presenca >= 7;

-- Função detectora — cria/atualiza pendentes e fecha como resolvida os
-- que reapareceram. Não há janela por snapshot_date: a view já reflete
-- o "agora". p_snapshot_date entra só como referência do alerta.
CREATE OR REPLACE FUNCTION public.fn_supest_detect_rupturas_confirmadas(
  p_snapshot_date date, p_execucao_id uuid
) RETURNS TABLE(alertas_criados integer, alertas_atualizados integer, alertas_resolvidos integer)
LANGUAGE plpgsql SET statement_timeout = '5min'
AS $function$
DECLARE
  v_ins int := 0;
  v_upd int := 0;
  v_res int := 0;
BEGIN
  WITH novos AS (
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
      'ruptura_confirmada'::public.supest_metrica,
      'aumento'::public.supest_direcao,
      dias_ausente::numeric,
      COALESCE(media_dia, 0),
      ROUND(COALESCE(media_dia, 0) * dias_ausente, 2)
    FROM public.vw_supervisor_estoque_rupturas_confirmadas
    ON CONFLICT (snapshot_date, filial_cod, codigo_produto, metrica, direcao) DO UPDATE SET
      valor_atual = EXCLUDED.valor_atual,
      valor_baseline_7d = EXCLUDED.valor_baseline_7d,
      variacao_pct = EXCLUDED.variacao_pct,
      agente_execucao_id = EXCLUDED.agente_execucao_id,
      ultima_deteccao = now(),
      updated_at = now()
    RETURNING (xmax = 0) AS inserted
  )
  SELECT COUNT(*) FILTER (WHERE inserted), COUNT(*) FILTER (WHERE NOT inserted)
    INTO v_ins, v_upd FROM novos;

  WITH a_pendentes AS (
    SELECT a.id, a.codigo_produto, a.filial_cod
    FROM public.supervisor_estoque_alertas a
    WHERE a.metrica = 'ruptura_confirmada'::public.supest_metrica
      AND a.status  = 'pendente'::public.supest_status
  ),
  reapareceram AS (
    SELECT p.id
    FROM a_pendentes p
    LEFT JOIN public.vw_supervisor_estoque_rupturas_confirmadas r
      ON r.codigo_produto = p.codigo_produto AND r.filial_cod = p.filial_cod
    WHERE r.codigo_produto IS NULL
  ),
  fechados AS (
    UPDATE public.supervisor_estoque_alertas a
    SET status        = 'resolvida'::public.supest_status,
        resolvido_em  = now(),
        updated_at    = now()
    FROM reapareceram r
    WHERE a.id = r.id
    RETURNING a.id
  )
  SELECT COUNT(*) INTO v_res FROM fechados;

  alertas_criados := v_ins;
  alertas_atualizados := v_upd;
  alertas_resolvidos := v_res;
  RETURN NEXT;
END $function$;
