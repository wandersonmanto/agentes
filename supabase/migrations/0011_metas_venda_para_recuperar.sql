-- =====================================================================
-- Agente metas — adiciona indicador "venda extra por dia para recuperar
-- a meta" e dias restantes do período.
--
-- Fórmulas (validadas 2026-05-18):
--   dias_restantes        = dias_tendencia - (dia_atual - dias_corte_tendencia)
--                         = dias_tendencia - dias_computados
--   venda_para_recuperar  = max(0, meta_venda - venda) / dias_restantes
--                           (null se dias_restantes <= 0 ou já bateu meta)
--
-- Compare com `venda_ideal_dia` (= meta / dias_tendencia): essa é a meta
-- diária "no início do mês". `venda_para_recuperar` é a meta diária
-- "para o que falta, considerando o que já vendeu".
-- =====================================================================

alter table metas_snapshots
  add column if not exists dias_restantes        integer,
  add column if not exists venda_para_recuperar  numeric(14,2);

-- ---------------------------------------------------------------------
-- vw_metas_atual — adiciona as novas colunas
-- ---------------------------------------------------------------------
drop view if exists vw_metas_atual cascade;

create view vw_metas_atual
with (security_invoker = true) as
select distinct on (filial_cod, nivel, cod)
  id, competencia, filial_cod, filial_desc, nivel, cod, descricao,
  venda, meta_venda, dias_corte_tendencia, dias_tendencia,
  dias_restantes, venda_para_recuperar,
  desvio_meta, tendencia, desvio_tendencia, percent_atingido, venda_ideal_dia,
  em_risco, snapshot_date, created_at
from metas_snapshots
order by filial_cod, nivel, cod, snapshot_date desc, created_at desc;

-- ---------------------------------------------------------------------
-- vw_metas_resumo_por_filial — expõe o "venda para recuperar" da loja
-- (nível 'loja' apenas — sub-níveis aparecem só como contagem em risco).
-- ---------------------------------------------------------------------
create or replace view vw_metas_resumo_por_filial
with (security_invoker = true) as
select
  v.filial_cod,
  max(v.filial_desc)                                                       as filial_desc,
  max(v.snapshot_date)                                                     as snapshot_date,

  max(v.venda)                  filter (where v.nivel = 'loja')            as venda_loja,
  max(v.meta_venda)             filter (where v.nivel = 'loja')            as meta_loja_venda,
  max(v.tendencia)              filter (where v.nivel = 'loja')            as tendencia_loja,
  max(v.percent_atingido)       filter (where v.nivel = 'loja')            as percent_loja,
  max(v.venda_para_recuperar)   filter (where v.nivel = 'loja')            as venda_para_recuperar_loja,
  max(v.dias_restantes)         filter (where v.nivel = 'loja')            as dias_restantes_loja,
  bool_or(v.em_risco)           filter (where v.nivel = 'loja')            as loja_em_risco,

  count(*) filter (where v.nivel = 'setor'        and v.em_risco)          as setores_em_risco,
  count(*) filter (where v.nivel = 'departamento' and v.em_risco)          as departamentos_em_risco,
  count(*) filter (where v.nivel = 'secao'        and v.em_risco)          as secoes_em_risco
from vw_metas_atual v
group by v.filial_cod;
