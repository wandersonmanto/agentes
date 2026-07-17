-- =====================================================================
-- 1) fn_vendas_filtros: acrescenta a lista de FORNECEDORES (p/ o multiselect)
-- 2) fn_estoque_cobertura: aceita filtro por CANAL e FORNECEDOR
-- 3) fn_estoque_produto_serie: série diária de venda × estoque de um produto
--
-- Nota importante: o arquivo de estoque NÃO tem canal nem fornecedor — essas
-- dimensões só existem na venda. Por isso os dois filtros agem no lado das
-- VENDAS (a média passa a refletir só aquele canal/fornecedor) e restringem
-- os produtos mostrados do lado do estoque. O estoque físico não é separado
-- por canal, então ao filtrar canal a cobertura fica conservadora (estoque
-- inteiro dividido por uma demanda parcial).
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) filtros + fornecedores
-- ---------------------------------------------------------------------
create or replace function public.fn_vendas_filtros()
returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'filiais', (
      select coalesce(jsonb_agg(x order by x->>'cod'), '[]'::jsonb) from (
        select distinct jsonb_build_object('cod', filial_cod, 'nome', filial_nome) x
        from vendas_diarias where filial_cod is not null
      ) t
    ),
    'canais', (
      select coalesce(jsonb_agg(x order by x->>'cod'), '[]'::jsonb) from (
        select distinct jsonb_build_object('cod', canal_cod, 'nome', canal_nome) x
        from vendas_diarias where canal_cod is not null
      ) t
    ),
    'setores', (
      select coalesce(jsonb_agg(x order by x->>'cod'), '[]'::jsonb) from (
        select distinct jsonb_build_object('cod', setor_cod, 'nome', setor_nome) x
        from vendas_diarias where setor_cod is not null
      ) t
    ),
    'departamentos', (
      select coalesce(jsonb_agg(x order by x->>'cod'), '[]'::jsonb) from (
        select distinct jsonb_build_object('cod', departamento_cod, 'nome', departamento_nome) x
        from vendas_diarias where departamento_cod is not null
      ) t
    ),
    'secoes', (
      select coalesce(jsonb_agg(x order by x->>'cod'), '[]'::jsonb) from (
        select distinct jsonb_build_object('cod', secao_cod, 'nome', secao_nome) x
        from vendas_diarias where secao_cod is not null
      ) t
    ),
    'compradores', (
      select coalesce(jsonb_agg(x order by x->>'nome'), '[]'::jsonb) from (
        select distinct jsonb_build_object('cod', comprador_cod, 'nome', comprador_nome) x
        from vendas_diarias where comprador_cod is not null
      ) t
    ),
    'fornecedores', (
      select coalesce(jsonb_agg(x order by x->>'nome'), '[]'::jsonb) from (
        select distinct jsonb_build_object('cod', fornecedor_cod, 'nome', fornecedor_nome) x
        from vendas_diarias where fornecedor_cod is not null
      ) t
    ),
    'juridica', (
      select coalesce(jsonb_agg(distinct juridica), '[]'::jsonb)
      from vendas_diarias where juridica is not null
    )
  );
$$;

-- ---------------------------------------------------------------------
-- 3) série diária de um produto: venda × estoque
--    (usada no drawer que abre ao clicar no produto)
-- ---------------------------------------------------------------------
create or replace function public.fn_estoque_produto_serie(
  p_produto_cod text,
  p_from        date,
  p_to          date,
  p_filial_cod  text default null
)
returns table (
  dia          date,
  qtd_vendida  numeric,
  venda_valor  numeric,
  disponivel   numeric,
  origem       text
)
language sql stable as $$
  select
    g.d::date                        as dia,
    coalesce(v.qtd, 0)               as qtd_vendida,
    coalesce(v.valor, 0)             as venda_valor,
    e.disp                           as disponivel,
    e.orig                           as origem
  from generate_series(p_from, p_to, interval '1 day') g(d)
  left join (
    select vd.dia as vdia,
           sum(vd.quantidade)  as qtd,
           sum(vd.venda_valor) as valor
    from vendas_diarias vd
    where vd.produto_cod = p_produto_cod
      and (p_filial_cod is null or vd.filial_cod = p_filial_cod)
      and vd.dia between p_from and p_to
    group by vd.dia
  ) v on v.vdia = g.d::date
  left join (
    select ed.data as edata,
           sum(ed.disponivel) as disp,
           min(ed.origem)     as orig
    from estoque_diario ed
    where ed.produto_cod = p_produto_cod
      and (p_filial_cod is null or ed.filial_cod = p_filial_cod)
      and ed.data between p_from and p_to
    group by ed.data
  ) e on e.edata = g.d::date
  order by g.d;
$$;
