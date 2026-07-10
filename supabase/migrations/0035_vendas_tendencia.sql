-- =====================================================================
-- fn_vendas_tendencia: média de venda/dia no range + tendência (queda/
-- crescimento/estável) por grupo, via inclinação da reta (regr_slope) da
-- série diária. slope_pct_dia = inclinação em % da média/dia.
--   crescimento: slope_pct_dia >= +1   |  queda: <= -1  |  senão estável
--   < 2 dias com venda: 'insuficiente'
-- Mesma whitelist de dimensões e filtros multi-valor do fn_vendas_resumo.
-- =====================================================================
create or replace function public.fn_vendas_tendencia(
  p_dim     text,
  p_from    date    default null,
  p_to      date    default null,
  p_filtros jsonb   default '{}'::jsonb
)
returns table (
  grupo_cod        text,
  grupo_nome       text,
  dias             bigint,
  venda_total      numeric,
  venda_media_dia  numeric,
  qtd_total        numeric,
  qtd_media_dia    numeric,
  slope_venda      numeric,
  slope_pct_dia    numeric,
  tendencia        text,
  margem_pct       numeric
)
language plpgsql stable as $$
declare
  v_col_cod  text;
  v_col_nome text;
  v_sql      text;
begin
  case p_dim
    when 'filial'       then v_col_cod := 'filial_cod';       v_col_nome := 'filial_nome';
    when 'canal'        then v_col_cod := 'canal_cod';        v_col_nome := 'canal_nome';
    when 'juridica'     then v_col_cod := 'juridica';         v_col_nome := 'juridica';
    when 'setor'        then v_col_cod := 'setor_cod';        v_col_nome := 'setor_nome';
    when 'departamento' then v_col_cod := 'departamento_cod'; v_col_nome := 'departamento_nome';
    when 'secao'        then v_col_cod := 'secao_cod';        v_col_nome := 'secao_nome';
    when 'fornecedor'   then v_col_cod := 'fornecedor_cod';   v_col_nome := 'fornecedor_nome';
    when 'comprador'    then v_col_cod := 'comprador_cod';    v_col_nome := 'comprador_nome';
    when 'produto'      then v_col_cod := 'produto_cod';      v_col_nome := 'produto_nome';
    else raise exception 'dimensão inválida: %', p_dim;
  end case;

  v_sql := format($f$
    with diario as (
      select (%1$s)::text as g_cod, max(%2$s)::text as g_nome, dia,
             sum(venda_valor)   as venda,
             sum(quantidade)    as qtd,
             sum(venda_liquida) as vl,
             sum(custo_liquido) as cl
      from vendas_diarias
      where ($1 is null or dia >= $1)
        and ($2 is null or dia <= $2)
        and ($3->'filial_cod'       is null or jsonb_typeof($3->'filial_cod')       <> 'array' or filial_cod       = any(array(select jsonb_array_elements_text($3->'filial_cod'))))
        and ($3->'canal_cod'        is null or jsonb_typeof($3->'canal_cod')        <> 'array' or canal_cod        = any(array(select jsonb_array_elements_text($3->'canal_cod'))))
        and ($3->'juridica'         is null or jsonb_typeof($3->'juridica')         <> 'array' or juridica         = any(array(select jsonb_array_elements_text($3->'juridica'))))
        and ($3->'setor_cod'        is null or jsonb_typeof($3->'setor_cod')        <> 'array' or setor_cod        = any(array(select jsonb_array_elements_text($3->'setor_cod'))))
        and ($3->'departamento_cod' is null or jsonb_typeof($3->'departamento_cod') <> 'array' or departamento_cod = any(array(select jsonb_array_elements_text($3->'departamento_cod'))))
        and ($3->'secao_cod'        is null or jsonb_typeof($3->'secao_cod')        <> 'array' or secao_cod        = any(array(select jsonb_array_elements_text($3->'secao_cod'))))
        and ($3->'fornecedor_cod'   is null or jsonb_typeof($3->'fornecedor_cod')   <> 'array' or fornecedor_cod   = any(array(select jsonb_array_elements_text($3->'fornecedor_cod'))))
        and ($3->'comprador_cod'    is null or jsonb_typeof($3->'comprador_cod')    <> 'array' or comprador_cod    = any(array(select jsonb_array_elements_text($3->'comprador_cod'))))
        and ($3->'produto_cod'      is null or jsonb_typeof($3->'produto_cod')      <> 'array' or produto_cod      = any(array(select jsonb_array_elements_text($3->'produto_cod'))))
      group by (%1$s), dia
    ),
    idx as (
      select d.*, (d.dia - min(d.dia) over ())::int as x from diario d
    ),
    agg as (
      select g_cod,
             max(g_nome)                     as g_nome,
             count(*)                        as dias,
             sum(venda)                      as venda_total,
             avg(venda)                      as venda_media_dia,
             sum(qtd)                        as qtd_total,
             avg(qtd)                        as qtd_media_dia,
             sum(vl)                         as vl_total,
             sum(cl)                         as cl_total,
             regr_slope(venda, x)            as slope_venda
      from idx group by g_cod
    )
    select
      g_cod as grupo_cod,
      g_nome as grupo_nome,
      dias,
      round(venda_total, 2)            as venda_total,
      round(venda_media_dia, 2)        as venda_media_dia,
      qtd_total,
      round(qtd_media_dia, 3)          as qtd_media_dia,
      round(slope_venda::numeric, 2)   as slope_venda,
      case when venda_media_dia is null or venda_media_dia = 0 or slope_venda is null then null
           else round((slope_venda / venda_media_dia * 100)::numeric, 2) end as slope_pct_dia,
      case
        when dias < 2 or slope_venda is null then 'insuficiente'
        when venda_media_dia > 0 and (slope_venda / venda_media_dia * 100) >=  1 then 'crescimento'
        when venda_media_dia > 0 and (slope_venda / venda_media_dia * 100) <= -1 then 'queda'
        else 'estavel'
      end as tendencia,
      case when vl_total <> 0 then round((vl_total - cl_total) / vl_total * 100, 2) end as margem_pct
    from agg
    order by venda_total desc
  $f$, v_col_cod, v_col_nome);

  return query execute v_sql using p_from, p_to, coalesce(p_filtros, '{}'::jsonb);
end$$;