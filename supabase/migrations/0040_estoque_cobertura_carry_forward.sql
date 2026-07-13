-- =====================================================================
-- fn_estoque_cobertura — corrige o viés dos dias SEM snapshot de estoque.
--
-- PROBLEMA: o arquivo de estoque é uma foto e não pode ser gerado
-- retroativamente (domingo/feriado o operador não trabalha). A venda
-- desses dias entra no numerador da média, mas o dia não entrava no
-- denominador (dias_disponiveis) por falta de snapshot -> média
-- superestimada em ~1/7 (~+16,7% numa semana sem domingo) -> exagero
-- na compra.
--
-- SOLUÇÃO: carry-forward (LOCF). Cada dia do período herda o ÚLTIMO
-- snapshot disponível em data <= dia, respeitando um limite de arraste
-- (p_max_carry, default 3 dias) para não propagar foto velha em buraco
-- longo. Assim domingo herda a foto de sábado.
--
-- Erro residual: produto que esgotou DURANTE o dia sem snapshot é contado
-- como disponível — erro pequeno e conservador (puxa a média p/ baixo).
-- =====================================================================
create or replace function public.fn_estoque_cobertura(
  p_from            date,
  p_to              date,
  p_data_estoque    date    default null,
  p_lead_time       int     default 7,
  p_dias_seguranca  int     default 3,
  p_dias_excesso    int     default 60,
  p_filtros         jsonb   default '{}'::jsonb,
  p_max_carry       int     default 3      -- dias máx. de arraste do snapshot
)
returns table (
  filial_cod        text,
  filial_nome       text,
  produto_cod       text,
  produto_nome      text,
  secao_cod         text,
  secao_nome        text,
  qtd_vendida       numeric,
  dias_com_venda    bigint,
  dias_disponiveis  bigint,
  dias_periodo      bigint,
  base_media        text,
  media_diaria      numeric,
  disponivel        numeric,
  custo_medio       numeric,
  valor_estoque     numeric,
  cobertura_dias    numeric,
  status            text,
  sugestao_compra   numeric,
  custo_sugestao    numeric
)
language plpgsql stable as $$
declare
  v_data_est date;
  v_dias     bigint;
begin
  v_data_est := coalesce(p_data_estoque, (select max(e2.data) from estoque_diario e2));
  v_dias     := greatest((p_to - p_from) + 1, 1);

  return query
  with
  prod_comprador as (
    select distinct v.produto_cod as pcod
    from vendas_diarias v
    where p_filtros->'comprador_cod' is null
       or jsonb_typeof(p_filtros->'comprador_cod') <> 'array'
       or v.comprador_cod = any(array(select jsonb_array_elements_text(p_filtros->'comprador_cod')))
  ),
  vendas as (
    select v.filial_cod as fcod, v.produto_cod as pcod,
           max(v.filial_nome)  as filial_nome,
           max(v.produto_nome) as produto_nome,
           max(v.secao_cod)    as secao_cod,
           max(v.secao_nome)   as secao_nome,
           sum(v.quantidade)     as qtd_vendida,
           count(distinct v.dia) as dias_com_venda
    from vendas_diarias v
    where v.dia between p_from and p_to
      and (p_filtros->'filial_cod'       is null or jsonb_typeof(p_filtros->'filial_cod')       <> 'array' or v.filial_cod       = any(array(select jsonb_array_elements_text(p_filtros->'filial_cod'))))
      and (p_filtros->'secao_cod'        is null or jsonb_typeof(p_filtros->'secao_cod')        <> 'array' or v.secao_cod        = any(array(select jsonb_array_elements_text(p_filtros->'secao_cod'))))
      and (p_filtros->'departamento_cod' is null or jsonb_typeof(p_filtros->'departamento_cod') <> 'array' or v.departamento_cod = any(array(select jsonb_array_elements_text(p_filtros->'departamento_cod'))))
      and (p_filtros->'produto_cod'      is null or jsonb_typeof(p_filtros->'produto_cod')      <> 'array' or v.produto_cod      = any(array(select jsonb_array_elements_text(p_filtros->'produto_cod'))))
      and (p_filtros->'comprador_cod'    is null or jsonb_typeof(p_filtros->'comprador_cod')    <> 'array' or v.comprador_cod    = any(array(select jsonb_array_elements_text(p_filtros->'comprador_cod'))))
    group by v.filial_cod, v.produto_cod
  ),
  -- grade de dias do período
  grade as (
    select generate_series(p_from, p_to, interval '1 day')::date as d
  ),
  snaps as (
    select distinct e.data as sdata from estoque_diario e where e.data <= p_to
  ),
  -- para cada dia, o snapshot VIGENTE = último <= dia, dentro do limite de arraste
  vigente as (
    select g.d, max(s.sdata) as snap
    from grade g
    left join snaps s
      on s.sdata <= g.d
     and s.sdata >= g.d - p_max_carry
    group by g.d
  ),
  -- dias em que o produto estava disponível (com carry-forward)
  disp as (
    select e.filial_cod as fcod, e.produto_cod as pcod, count(*)::bigint as dias_disponiveis
    from vigente v
    join estoque_diario e on e.data = v.snap
    where v.snap is not null
      and coalesce(e.disponivel, 0) > 0
    group by e.filial_cod, e.produto_cod
  ),
  est as (
    select e.filial_cod as fcod, e.produto_cod as pcod,
           e.filial_nome, e.produto_nome, e.secao_cod, e.secao_nome,
           e.disponivel, e.custo_medio, e.custo_total_disponivel
    from estoque_diario e
    where e.data = v_data_est
      and (p_filtros->'filial_cod'       is null or jsonb_typeof(p_filtros->'filial_cod')       <> 'array' or e.filial_cod       = any(array(select jsonb_array_elements_text(p_filtros->'filial_cod'))))
      and (p_filtros->'secao_cod'        is null or jsonb_typeof(p_filtros->'secao_cod')        <> 'array' or e.secao_cod        = any(array(select jsonb_array_elements_text(p_filtros->'secao_cod'))))
      and (p_filtros->'departamento_cod' is null or jsonb_typeof(p_filtros->'departamento_cod') <> 'array' or e.departamento_cod = any(array(select jsonb_array_elements_text(p_filtros->'departamento_cod'))))
      and (p_filtros->'produto_cod'      is null or jsonb_typeof(p_filtros->'produto_cod')      <> 'array' or e.produto_cod      = any(array(select jsonb_array_elements_text(p_filtros->'produto_cod'))))
      and (p_filtros->'comprador_cod'    is null or jsonb_typeof(p_filtros->'comprador_cod')    <> 'array' or e.produto_cod in (select pc.pcod from prod_comprador pc))
  ),
  base as (
    select
      coalesce(v.fcod, e.fcod)  as b_filial_cod,
      coalesce(v.pcod, e.pcod)  as b_produto_cod,
      coalesce(e.filial_nome,  v.filial_nome)  as b_filial_nome,
      coalesce(e.produto_nome, v.produto_nome) as b_produto_nome,
      coalesce(e.secao_cod,    v.secao_cod)    as b_secao_cod,
      coalesce(e.secao_nome,   v.secao_nome)   as b_secao_nome,
      coalesce(v.qtd_vendida, 0)               as b_qtd,
      coalesce(v.dias_com_venda, 0)::bigint    as b_dias_venda,
      coalesce(d.dias_disponiveis, 0)::bigint  as b_dias_disp,
      coalesce(e.disponivel, 0)                as b_disp,
      e.custo_medio                            as b_custo,
      coalesce(e.custo_total_disponivel, 0)    as b_valor
    from vendas v
    full outer join est e on e.fcod = v.fcod and e.pcod = v.pcod
    left join disp d on d.fcod = coalesce(v.fcod, e.fcod) and d.pcod = coalesce(v.pcod, e.pcod)
  ),
  calc as (
    select b.*,
           case when b.b_dias_disp > 0 then 'dias_disponiveis' else 'dias_corridos' end as b_base,
           case when b.b_dias_disp > 0 then b.b_qtd / b.b_dias_disp else b.b_qtd / v_dias end as b_media
    from base b
  )
  select
    c.b_filial_cod, c.b_filial_nome, c.b_produto_cod, c.b_produto_nome,
    c.b_secao_cod, c.b_secao_nome,
    round(c.b_qtd, 3),
    c.b_dias_venda,
    c.b_dias_disp,
    v_dias,
    c.b_base,
    round(c.b_media, 3),
    round(c.b_disp, 3),
    round(c.b_custo, 4),
    round(c.b_valor, 2),
    case when c.b_media > 0 then round(c.b_disp / c.b_media, 1) end,
    case
      when c.b_disp <= 0 and c.b_qtd > 0                            then 'ruptura'
      when c.b_qtd <= 0 and c.b_disp > 0                            then 'sem_giro'
      when c.b_media <= 0                                           then 'sem_giro'
      when c.b_disp / c.b_media <  p_lead_time                      then 'critico'
      when c.b_disp / c.b_media <  (p_lead_time + p_dias_seguranca) then 'atencao'
      when c.b_disp / c.b_media >  p_dias_excesso                   then 'excesso'
      else 'ok'
    end,
    greatest(0, ceil(c.b_media * (p_lead_time + p_dias_seguranca) - c.b_disp))::numeric,
    round(greatest(0, ceil(c.b_media * (p_lead_time + p_dias_seguranca) - c.b_disp)) * coalesce(c.b_custo, 0), 2)
  from calc c
  order by
    case
      when c.b_disp <= 0 and c.b_qtd > 0 then 1
      when c.b_media > 0 and c.b_disp / c.b_media < p_lead_time then 2
      else 3
    end,
    c.b_qtd desc;
end$$;
