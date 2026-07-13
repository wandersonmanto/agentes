-- =====================================================================
-- fn_estoque_cobertura — cruza vendas_diarias × estoque_diario.
--
-- Por produto × filial devolve: média diária de venda, cobertura em dias,
-- status (ruptura / crítico / atenção / ok / excesso / sem_giro) e a
-- sugestão de compra.
--
-- DENOMINADOR DA MÉDIA (o ponto central):
--   - Se houver snapshots de estoque no período, usa os DIAS EM QUE O
--     PRODUTO ESTAVA DISPONÍVEL (disponivel > 0). Assim o dia em que o
--     item estava em falta não entra na conta e não puxa a média pra
--     baixo (demanda censurada) — que é o que perpetua a ruptura.
--   - Se ainda não houver histórico de estoque no período, cai para
--     DIAS CORRIDOS (mais seguro que "dias com venda", que infla a
--     demanda de itens de giro lento e causa exagero na compra).
--   A coluna `base_media` informa qual dos dois foi usado.
--
-- sugestao_compra = teto( media_diaria × (lead_time + dias_seguranca) − disponível )
-- =====================================================================
create or replace function public.fn_estoque_cobertura(
  p_from            date,
  p_to              date,
  p_data_estoque    date    default null,   -- null = snapshot mais recente
  p_lead_time       int     default 7,
  p_dias_seguranca  int     default 3,
  p_dias_excesso    int     default 60,
  p_filtros         jsonb   default '{}'::jsonb
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
  v_data_est := coalesce(p_data_estoque, (select max(data) from estoque_diario));
  v_dias     := greatest((p_to - p_from) + 1, 1);

  return query
  with
  -- produtos do comprador (filtro opcional: comprador só existe em vendas)
  prod_comprador as (
    select distinct v.produto_cod
    from vendas_diarias v
    where p_filtros->'comprador_cod' is null
       or jsonb_typeof(p_filtros->'comprador_cod') <> 'array'
       or v.comprador_cod = any(array(select jsonb_array_elements_text(p_filtros->'comprador_cod')))
  ),
  vendas as (
    select v.filial_cod, v.produto_cod,
           max(v.filial_nome)  as filial_nome,
           max(v.produto_nome) as produto_nome,
           max(v.secao_cod)    as secao_cod,
           max(v.secao_nome)   as secao_nome,
           sum(v.quantidade)         as qtd_vendida,
           count(distinct v.dia)     as dias_com_venda
    from vendas_diarias v
    where v.dia between p_from and p_to
      and (p_filtros->'filial_cod'       is null or jsonb_typeof(p_filtros->'filial_cod')       <> 'array' or v.filial_cod       = any(array(select jsonb_array_elements_text(p_filtros->'filial_cod'))))
      and (p_filtros->'secao_cod'        is null or jsonb_typeof(p_filtros->'secao_cod')        <> 'array' or v.secao_cod        = any(array(select jsonb_array_elements_text(p_filtros->'secao_cod'))))
      and (p_filtros->'departamento_cod' is null or jsonb_typeof(p_filtros->'departamento_cod') <> 'array' or v.departamento_cod = any(array(select jsonb_array_elements_text(p_filtros->'departamento_cod'))))
      and (p_filtros->'produto_cod'      is null or jsonb_typeof(p_filtros->'produto_cod')      <> 'array' or v.produto_cod      = any(array(select jsonb_array_elements_text(p_filtros->'produto_cod'))))
      and (p_filtros->'comprador_cod'    is null or jsonb_typeof(p_filtros->'comprador_cod')    <> 'array' or v.comprador_cod    = any(array(select jsonb_array_elements_text(p_filtros->'comprador_cod'))))
    group by v.filial_cod, v.produto_cod
  ),
  -- dias em que o produto tinha estoque disponível dentro do período
  disp as (
    select e.filial_cod, e.produto_cod, count(distinct e.data) as dias_disponiveis
    from estoque_diario e
    where e.data between p_from and p_to
      and coalesce(e.disponivel, 0) > 0
    group by e.filial_cod, e.produto_cod
  ),
  -- foto de estoque usada para cobertura/sugestão
  est as (
    select e.filial_cod, e.produto_cod,
           e.filial_nome, e.produto_nome, e.secao_cod, e.secao_nome,
           e.disponivel, e.custo_medio, e.custo_total_disponivel
    from estoque_diario e
    where e.data = v_data_est
      and (p_filtros->'filial_cod'       is null or jsonb_typeof(p_filtros->'filial_cod')       <> 'array' or e.filial_cod       = any(array(select jsonb_array_elements_text(p_filtros->'filial_cod'))))
      and (p_filtros->'secao_cod'        is null or jsonb_typeof(p_filtros->'secao_cod')        <> 'array' or e.secao_cod        = any(array(select jsonb_array_elements_text(p_filtros->'secao_cod'))))
      and (p_filtros->'departamento_cod' is null or jsonb_typeof(p_filtros->'departamento_cod') <> 'array' or e.departamento_cod = any(array(select jsonb_array_elements_text(p_filtros->'departamento_cod'))))
      and (p_filtros->'produto_cod'      is null or jsonb_typeof(p_filtros->'produto_cod')      <> 'array' or e.produto_cod      = any(array(select jsonb_array_elements_text(p_filtros->'produto_cod'))))
      and (p_filtros->'comprador_cod'    is null or jsonb_typeof(p_filtros->'comprador_cod')    <> 'array' or e.produto_cod in (select pc.produto_cod from prod_comprador pc))
  ),
  base as (
    select
      coalesce(v.filial_cod,  e.filial_cod)   as filial_cod,
      coalesce(v.produto_cod, e.produto_cod)  as produto_cod,
      coalesce(e.filial_nome,  v.filial_nome)  as filial_nome,
      coalesce(e.produto_nome, v.produto_nome) as produto_nome,
      coalesce(e.secao_cod,    v.secao_cod)    as secao_cod,
      coalesce(e.secao_nome,   v.secao_nome)   as secao_nome,
      coalesce(v.qtd_vendida, 0)               as qtd_vendida,
      coalesce(v.dias_com_venda, 0)::bigint    as dias_com_venda,
      coalesce(d.dias_disponiveis, 0)::bigint  as dias_disponiveis,
      coalesce(e.disponivel, 0)                as disponivel,
      e.custo_medio                            as custo_medio,
      coalesce(e.custo_total_disponivel, 0)    as valor_estoque
    from vendas v
    full outer join est e
      on e.filial_cod = v.filial_cod and e.produto_cod = v.produto_cod
    left join disp d
      on d.filial_cod = coalesce(v.filial_cod, e.filial_cod)
     and d.produto_cod = coalesce(v.produto_cod, e.produto_cod)
  ),
  calc as (
    select b.*,
           case when b.dias_disponiveis > 0 then 'dias_disponiveis' else 'dias_corridos' end as base_media,
           case when b.dias_disponiveis > 0
                then b.qtd_vendida / b.dias_disponiveis
                else b.qtd_vendida / v_dias
           end as media_diaria
    from base b
  )
  select
    c.filial_cod, c.filial_nome, c.produto_cod, c.produto_nome,
    c.secao_cod, c.secao_nome,
    round(c.qtd_vendida, 3)  as qtd_vendida,
    c.dias_com_venda,
    c.dias_disponiveis,
    v_dias                   as dias_periodo,
    c.base_media,
    round(c.media_diaria, 3) as media_diaria,
    round(c.disponivel, 3)   as disponivel,
    round(c.custo_medio, 4)  as custo_medio,
    round(c.valor_estoque, 2) as valor_estoque,
    case when c.media_diaria > 0
         then round(c.disponivel / c.media_diaria, 1)
         end                 as cobertura_dias,
    case
      when c.disponivel <= 0 and c.qtd_vendida > 0                        then 'ruptura'
      when c.qtd_vendida <= 0 and c.disponivel > 0                        then 'sem_giro'
      when c.media_diaria <= 0                                            then 'sem_giro'
      when c.disponivel / c.media_diaria <  p_lead_time                   then 'critico'
      when c.disponivel / c.media_diaria <  (p_lead_time + p_dias_seguranca) then 'atencao'
      when c.disponivel / c.media_diaria >  p_dias_excesso                then 'excesso'
      else 'ok'
    end                      as status,
    greatest(0, ceil(c.media_diaria * (p_lead_time + p_dias_seguranca) - c.disponivel))::numeric as sugestao_compra,
    round(greatest(0, ceil(c.media_diaria * (p_lead_time + p_dias_seguranca) - c.disponivel))
          * coalesce(c.custo_medio, 0), 2) as custo_sugestao
  from calc c
  order by
    case
      when c.disponivel <= 0 and c.qtd_vendida > 0 then 1   -- ruptura primeiro
      when c.media_diaria > 0 and c.disponivel / c.media_diaria < p_lead_time then 2
      else 3
    end,
    c.qtd_vendida desc;
end$$;
