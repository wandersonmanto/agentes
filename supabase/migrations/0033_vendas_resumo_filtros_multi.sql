-- =====================================================================
-- fn_vendas_resumo: filtros passam a aceitar MÚLTIPLOS valores por chave.
--
-- p_filtros agora usa arrays JSON por chave, ex.:
--   {"filial_cod":["300","305"], "secao_cod":["12","10"]}
-- Chave ausente (ou array vazio) = sem filtro naquela dimensão.
-- Mantém a mesma assinatura e colunas de retorno da versão 0031.
-- =====================================================================
create or replace function public.fn_vendas_resumo(
  p_dim     text,
  p_from    date    default null,
  p_to      date    default null,
  p_filtros jsonb   default '{}'::jsonb
)
returns table (
  grupo_cod          text,
  grupo_nome         text,
  linhas             bigint,
  dias               bigint,
  qtd_total          numeric,
  venda_total        numeric,
  venda_liquida_tot  numeric,
  custo_total        numeric,
  devolucao_total    numeric,
  lucro_bruto        numeric,
  margem_pct         numeric,
  preco_medio        numeric,
  venda_media_dia    numeric,
  imp_saida_total    numeric,
  pis_cofins_total   numeric,
  imposto_total      numeric
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
    when 'dia'          then v_col_cod := 'dia::text';        v_col_nome := 'dia::text';
    else raise exception 'dimensão inválida: %', p_dim;
  end case;

  -- Cada filtro: se a chave existe e é um array não-vazio, aplica IN (= any).
  v_sql := format($f$
    select
      (%1$s)::text as grupo_cod,
      max(%2$s)::text as grupo_nome,
      count(*)::bigint as linhas,
      count(distinct dia)::bigint as dias,
      coalesce(sum(quantidade),0),
      coalesce(sum(venda_valor),0),
      coalesce(sum(venda_liquida),0),
      coalesce(sum(custo_liquido),0),
      coalesce(sum(devolucao_valor),0),
      coalesce(sum(venda_liquida - custo_liquido),0) as lucro_bruto,
      case when coalesce(sum(venda_liquida),0) <> 0
           then round(sum(venda_liquida - custo_liquido) / sum(venda_liquida) * 100, 2)
           end as margem_pct,
      case when coalesce(sum(quantidade),0) <> 0
           then round(sum(venda_valor) / sum(quantidade), 4)
           end as preco_medio,
      case when count(distinct dia) <> 0
           then round(sum(venda_valor) / count(distinct dia), 2)
           end as venda_media_dia,
      coalesce(sum(imp_saida),0),
      coalesce(sum(pis_cofins_lucro),0),
      coalesce(sum(coalesce(imp_saida,0) + coalesce(pis_cofins_lucro,0)),0)
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
    group by (%1$s)
    order by coalesce(sum(venda_valor),0) desc
  $f$, v_col_cod, v_col_nome);

  return query execute v_sql using p_from, p_to, coalesce(p_filtros, '{}'::jsonb);
end$$;