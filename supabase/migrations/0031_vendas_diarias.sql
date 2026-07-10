-- =====================================================================
-- Vendas diárias (fato)
--
-- Objetivo: armazenar a venda diária no grão da LINHA FOLHA da planilha
-- "maestro_N.xlsx" (exportação em pivô do ERP), permitindo reobter os
-- dados por qualquer dimensão (filial, setor, departamento, seção,
-- fornecedor, comprador, produto) e por FAIXA DE DATAS, além de métricas
-- de venda média, margem de lucro e impostos.
--
-- Fonte: planilhas "maestro_N.xlsx" (uma por dia do mês), carregadas por
--   scripts/ingest-vendas.mjs -> RPC fn_vendas_ingest (upsert idempotente).
--   A data de cada linha vem da coluna "Dia" (não do nome do arquivo).
--
-- Grão / chave natural (única, validada nos dados):
--   (dia, filial_cod, canal_cod, juridica, produto_cod, fornecedor_cod, comprador_cod)
--
-- Observação sobre a planilha: além das linhas folha, o export traz várias
-- linhas de SUBTOTAL (marcadas com "Total" nas colunas). Essas são
-- descartadas no importador; aqui só entram linhas folha.
-- =====================================================================

-- Extensão de UUID (idempotente; já existe no schema, mas garante)
create extension if not exists "uuid-ossp";

-- =====================================================================
-- HELPERS de conversão (pt-BR / en-US / serial Excel)
-- =====================================================================

-- Número: aceita "15.69" (en-US), "1.234,56" (pt-BR), "1234" etc.
create or replace function public.fn_vendas_to_numeric(t text)
returns numeric language plpgsql immutable as $$
declare s text;
begin
  if t is null or btrim(t) = '' then return null; end if;
  s := btrim(t);
  -- já é número "puro" (en-US, com ou sem sinal/decimal)
  if s ~ '^-?[0-9]+(\.[0-9]+)?$' then
    begin return s::numeric; exception when others then return null; end;
  end if;
  -- pt-BR: ponto = milhar, vírgula = decimal
  if position(',' in s) > 0 then
    s := replace(s, '.', '');
    s := replace(s, ',', '.');
  end if;
  begin return s::numeric; exception when others then return null; end;
end$$;

-- Data: aceita ISO "YYYY-MM-DD", pt-BR "DD/MM/AAAA" e serial Excel ("46204").
create or replace function public.fn_vendas_to_date(t text)
returns date language plpgsql immutable as $$
declare s text; m text[]; n numeric;
begin
  if t is null or btrim(t) = '' then return null; end if;
  s := btrim(t);
  -- ISO
  if s ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
    begin return s::date; exception when others then return null; end;
  end if;
  -- pt-BR DD/MM/AAAA
  m := regexp_match(s, '^([0-9]{1,2})/([0-9]{1,2})/([0-9]{4})$');
  if m is not null then
    begin return make_date(m[3]::int, m[2]::int, m[1]::int);
    exception when others then return null; end;
  end if;
  -- serial Excel (epoch 1899-12-30)
  if s ~ '^[0-9]+$' then
    n := s::numeric;
    return date '1899-12-30' + (n::int);
  end if;
  begin return s::date; exception when others then return null; end;
end$$;

-- =====================================================================
-- TABELA: vendas_diarias (fato)
-- =====================================================================
create table if not exists vendas_diarias (
  id                    uuid primary key default uuid_generate_v4(),
  dia                   date not null,

  -- dimensões (código + nome separados a partir de "<cod> - <nome>")
  empresa_cod           text,
  empresa_nome          text,
  canal_cod             text,
  canal_nome            text,
  filial_cod            text not null,
  filial_nome           text,
  juridica              text,               -- "JURÍDICA" / "FÍSICA"
  setor_cod             text,
  setor_nome            text,
  departamento_cod      text,
  departamento_nome     text,
  secao_cod             text,
  secao_nome            text,
  chave_secao           text,               -- "<cod> - <NOME>" (alinha com margem)
  produto_cod           text not null,
  produto_nome          text,
  fornecedor_cod        text,
  fornecedor_nome       text,
  comprador_cod         text,
  comprador_nome        text,

  -- métricas (line totals, salvo *_unit que são por unidade)
  quantidade            numeric,
  quantidade_devolucao  numeric,
  devolucao_valor       numeric,            -- Devolução R$
  venda_valor           numeric,            -- Venda R$
  custo_liquido         numeric,            -- Custo Líquido R$
  venda_liquida         numeric,            -- Venda Líquida R$
  lucro_liquido_unit    numeric,            -- Lucro Líquido Unit. R$
  imp_saida             numeric,            -- Imp. Saída R$
  pis_cofins_lucro      numeric,            -- Vlr PIS/COFINS Lucro R$
  margem_realizada      numeric,            -- fração (0.30 = 30%)
  pmz_unit              numeric,            -- PMZ Unit. R$
  debito_imp_total      numeric,            -- Débito Imp. Total R$

  -- chave natural em hash (robusta a nulos) p/ upsert idempotente.
  -- Calculada no RPC de ingest (não é generated p/ evitar dependência de
  -- imutabilidade do cast date->text sob DateStyle).
  linha_hash            text not null,

  -- id da carga que tocou a linha por último. Usado para remover linhas
  -- "órfãs" quando um dia é reimportado com menos linhas (correção/estorno):
  -- ao final da carga, apagam-se as linhas do dia com carga_id diferente.
  carga_id              uuid,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint vendas_diarias_uk unique (linha_hash)
);

create index if not exists idx_vendas_dia               on vendas_diarias (dia);
create index if not exists idx_vendas_filial_dia        on vendas_diarias (filial_cod, dia);
create index if not exists idx_vendas_produto_dia       on vendas_diarias (produto_cod, dia);
create index if not exists idx_vendas_fornecedor_dia    on vendas_diarias (fornecedor_cod, dia);
create index if not exists idx_vendas_comprador_dia     on vendas_diarias (comprador_cod, dia);
create index if not exists idx_vendas_secao_dia         on vendas_diarias (secao_cod, dia);
create index if not exists idx_vendas_departamento_dia  on vendas_diarias (departamento_cod, dia);
create index if not exists idx_vendas_setor_dia         on vendas_diarias (setor_cod, dia);
create index if not exists idx_vendas_chave_secao       on vendas_diarias (chave_secao);
create index if not exists idx_vendas_dia_carga         on vendas_diarias (dia, carga_id);

-- trigger updated_at (reaproveita função padrão da plataforma, se existir)
do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    drop trigger if exists trg_vendas_diarias_updated on vendas_diarias;
    create trigger trg_vendas_diarias_updated
      before update on vendas_diarias
      for each row execute function set_updated_at();
  end if;
end$$;

-- =====================================================================
-- RLS
-- =====================================================================
alter table vendas_diarias enable row level security;

drop policy if exists "service role full access" on vendas_diarias;
create policy "service role full access" on vendas_diarias
  for all to service_role using (true) with check (true);

drop policy if exists "authenticated read" on vendas_diarias;
create policy "authenticated read" on vendas_diarias
  for select to authenticated using (true);

-- =====================================================================
-- RPC: ingestão em lote (upsert idempotente)
-- Cada elemento de p_rows já vem com `dia` em ISO e números como number.
-- =====================================================================
create or replace function public.fn_vendas_ingest(
  p_rows     jsonb,
  p_carga_id uuid default null
)
returns table (inserted_count int, updated_count int)
language plpgsql as $$
declare v_ins int := 0; v_upd int := 0;
begin
  with up as (
    insert into vendas_diarias (
      dia,
      empresa_cod, empresa_nome, canal_cod, canal_nome,
      filial_cod, filial_nome, juridica,
      setor_cod, setor_nome, departamento_cod, departamento_nome,
      secao_cod, secao_nome, chave_secao,
      produto_cod, produto_nome, fornecedor_cod, fornecedor_nome,
      comprador_cod, comprador_nome,
      quantidade, quantidade_devolucao, devolucao_valor, venda_valor,
      custo_liquido, venda_liquida, lucro_liquido_unit,
      imp_saida, pis_cofins_lucro, margem_realizada, pmz_unit, debito_imp_total,
      linha_hash, carga_id
    )
    select
      public.fn_vendas_to_date(r->>'dia'),
      r->>'empresa_cod',        r->>'empresa_nome',
      r->>'canal_cod',          r->>'canal_nome',
      r->>'filial_cod',         r->>'filial_nome',
      r->>'juridica',
      r->>'setor_cod',          r->>'setor_nome',
      r->>'departamento_cod',   r->>'departamento_nome',
      r->>'secao_cod',          r->>'secao_nome',
      coalesce(nullif(r->>'chave_secao',''), r->>'secao_nome'),
      r->>'produto_cod',        r->>'produto_nome',
      r->>'fornecedor_cod',     r->>'fornecedor_nome',
      r->>'comprador_cod',      r->>'comprador_nome',
      public.fn_vendas_to_numeric(r->>'quantidade'),
      public.fn_vendas_to_numeric(r->>'quantidade_devolucao'),
      public.fn_vendas_to_numeric(r->>'devolucao_valor'),
      public.fn_vendas_to_numeric(r->>'venda_valor'),
      public.fn_vendas_to_numeric(r->>'custo_liquido'),
      public.fn_vendas_to_numeric(r->>'venda_liquida'),
      public.fn_vendas_to_numeric(r->>'lucro_liquido_unit'),
      public.fn_vendas_to_numeric(r->>'imp_saida'),
      public.fn_vendas_to_numeric(r->>'pis_cofins_lucro'),
      public.fn_vendas_to_numeric(r->>'margem_realizada'),
      public.fn_vendas_to_numeric(r->>'pmz_unit'),
      public.fn_vendas_to_numeric(r->>'debito_imp_total'),
      md5(
        coalesce(public.fn_vendas_to_date(r->>'dia')::text,'') || '|' ||
        coalesce(r->>'filial_cod','')     || '|' ||
        coalesce(r->>'canal_cod','')      || '|' ||
        coalesce(r->>'juridica','')       || '|' ||
        coalesce(r->>'produto_cod','')    || '|' ||
        coalesce(r->>'fornecedor_cod','') || '|' ||
        coalesce(r->>'comprador_cod','')
      ),
      p_carga_id
    from jsonb_array_elements(p_rows) r
    where public.fn_vendas_to_date(r->>'dia') is not null
      and nullif(r->>'filial_cod','')  is not null
      and nullif(r->>'produto_cod','') is not null
    on conflict (linha_hash) do update set
      empresa_cod          = excluded.empresa_cod,
      empresa_nome         = excluded.empresa_nome,
      canal_cod            = excluded.canal_cod,
      canal_nome           = excluded.canal_nome,
      filial_nome          = excluded.filial_nome,
      setor_cod            = excluded.setor_cod,
      setor_nome           = excluded.setor_nome,
      departamento_cod     = excluded.departamento_cod,
      departamento_nome    = excluded.departamento_nome,
      secao_cod            = excluded.secao_cod,
      secao_nome           = excluded.secao_nome,
      chave_secao          = excluded.chave_secao,
      produto_nome         = excluded.produto_nome,
      fornecedor_nome      = excluded.fornecedor_nome,
      comprador_nome       = excluded.comprador_nome,
      quantidade           = excluded.quantidade,
      quantidade_devolucao = excluded.quantidade_devolucao,
      devolucao_valor      = excluded.devolucao_valor,
      venda_valor          = excluded.venda_valor,
      custo_liquido        = excluded.custo_liquido,
      venda_liquida        = excluded.venda_liquida,
      lucro_liquido_unit   = excluded.lucro_liquido_unit,
      imp_saida            = excluded.imp_saida,
      pis_cofins_lucro     = excluded.pis_cofins_lucro,
      margem_realizada     = excluded.margem_realizada,
      pmz_unit             = excluded.pmz_unit,
      debito_imp_total     = excluded.debito_imp_total,
      carga_id             = excluded.carga_id,
      updated_at           = now()
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted),
         count(*) filter (where not inserted)
  into v_ins, v_upd
  from up;

  inserted_count := v_ins;
  updated_count  := v_upd;
  return next;
end$$;

-- =====================================================================
-- RPC: remove linhas órfãs após reimportar um dia
--
-- Apaga as linhas dos dias `p_dias` cujo carga_id seja diferente do
-- `p_carga_id` da carga atual — ou seja, linhas que existiam de uma
-- importação anterior daquele dia e não vieram na nova (correção/estorno).
-- Só deve ser chamada DEPOIS de todos os lotes do arquivo terem entrado
-- com sucesso (senão apagaria linhas ainda não reinseridas).
-- =====================================================================
create or replace function public.fn_vendas_prune_orfaos(
  p_dias     date[],
  p_carga_id uuid
)
returns int language plpgsql as $$
declare v_del int := 0;
begin
  if p_carga_id is null or p_dias is null or array_length(p_dias, 1) is null then
    return 0;
  end if;
  delete from vendas_diarias
  where dia = any(p_dias)
    and carga_id is distinct from p_carga_id;
  get diagnostics v_del = row_count;
  return v_del;
end$$;

-- =====================================================================
-- VIEW: exposição amigável do fato
-- =====================================================================
create or replace view vw_vendas_diarias as
select
  id, dia,
  empresa_cod, empresa_nome, canal_cod, canal_nome,
  filial_cod, filial_nome, juridica,
  setor_cod, setor_nome, departamento_cod, departamento_nome,
  secao_cod, secao_nome, chave_secao,
  produto_cod, produto_nome, fornecedor_cod, fornecedor_nome,
  comprador_cod, comprador_nome,
  quantidade, quantidade_devolucao, devolucao_valor,
  venda_valor, custo_liquido, venda_liquida,
  (venda_liquida - custo_liquido)                                   as lucro_bruto,
  case when venda_liquida <> 0
       then round((venda_liquida - custo_liquido) / venda_liquida, 6)
       end                                                          as margem_calc,
  margem_realizada, lucro_liquido_unit, pmz_unit,
  imp_saida, pis_cofins_lucro, debito_imp_total
from vendas_diarias;

-- =====================================================================
-- RPC: agregação por UMA dimensão e faixa de datas (whitelist de dims)
--
-- p_dim: 'filial' | 'canal' | 'juridica' | 'setor' | 'departamento'
--        | 'secao' | 'fornecedor' | 'comprador' | 'produto' | 'dia'
-- p_from / p_to: faixa de datas inclusiva (null = sem limite).
-- p_filtros: jsonb opcional p/ filtrar por códigos, ex:
--   {"filial_cod":"300","comprador_cod":"634","secao_cod":"12"}
--
-- Retorna, por grupo: código, nome e métricas (venda, custo, lucro,
-- margem, impostos, ticket/preço médio e venda média por dia).
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
  -- whitelist dimensão -> colunas
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
      and ($3->>'filial_cod'       is null or filial_cod       = $3->>'filial_cod')
      and ($3->>'canal_cod'        is null or canal_cod        = $3->>'canal_cod')
      and ($3->>'juridica'         is null or juridica         = $3->>'juridica')
      and ($3->>'setor_cod'        is null or setor_cod        = $3->>'setor_cod')
      and ($3->>'departamento_cod' is null or departamento_cod = $3->>'departamento_cod')
      and ($3->>'secao_cod'        is null or secao_cod        = $3->>'secao_cod')
      and ($3->>'fornecedor_cod'   is null or fornecedor_cod   = $3->>'fornecedor_cod')
      and ($3->>'comprador_cod'    is null or comprador_cod    = $3->>'comprador_cod')
      and ($3->>'produto_cod'      is null or produto_cod      = $3->>'produto_cod')
    group by (%1$s)
    order by coalesce(sum(venda_valor),0) desc
  $f$, v_col_cod, v_col_nome);

  return query execute v_sql using p_from, p_to, coalesce(p_filtros, '{}'::jsonb);
end$$;
