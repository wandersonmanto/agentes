-- =====================================================================
-- Estoque diário (snapshot)
--
-- Fonte: planilha "estoque.xlsx" (grão produto × filial, SEM subtotais).
-- O arquivo NÃO traz data: a data é carimbada na carga (data do snapshot).
-- Carregado por scripts/ingest-estoque.mjs -> fn_estoque_ingest.
--
-- Grão / chave natural: (data, filial_cod, produto_cod) — validada: 0 duplicatas.
-- Idempotente: upsert por linha_hash + prune de órfãos por carga_id
-- (mesmo padrão de vendas_diarias).
--
-- Filiais no arquivo: 300, 302, 303, 304, 305 (lojas), 360 (atacado),
-- 313 (depósito) e 87 (CD Armazém Mateus — outra escala, filtrar quando
-- a análise for de loja).
-- =====================================================================

create table if not exists estoque_diario (
  id                      uuid primary key default uuid_generate_v4(),
  data                    date not null,

  filial_cod              text not null,
  filial_nome             text,
  departamento_cod        text,
  departamento_nome       text,
  secao_cod               text,
  secao_nome              text,
  chave_secao             text,
  produto_cod             text not null,
  produto_nome            text,
  cod_barras              text,

  disponivel              numeric,   -- Disponível (un)
  reservada               numeric,   -- Reservada (un)
  total_estoque           numeric,   -- Total Estoque (un) = disponível + reservada
  custo_medio             numeric,   -- Custo Médio unitário (R$)
  custo_total_disponivel  numeric,   -- Custo Total Disponível (R$)
  custo_total_reservado   numeric,   -- Custo Total Reservado (R$)
  custo_total_estoque     numeric,   -- Custo Total do Estoque (R$)

  linha_hash              text not null,
  carga_id                uuid,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  constraint estoque_diario_uk unique (linha_hash)
);

create index if not exists idx_estoque_data              on estoque_diario (data);
create index if not exists idx_estoque_produto_data      on estoque_diario (produto_cod, data);
create index if not exists idx_estoque_filial_data       on estoque_diario (filial_cod, data);
create index if not exists idx_estoque_prod_filial_data  on estoque_diario (produto_cod, filial_cod, data);
create index if not exists idx_estoque_secao_data        on estoque_diario (secao_cod, data);
create index if not exists idx_estoque_data_carga        on estoque_diario (data, carga_id);

do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    drop trigger if exists trg_estoque_diario_updated on estoque_diario;
    create trigger trg_estoque_diario_updated
      before update on estoque_diario
      for each row execute function set_updated_at();
  end if;
end$$;

alter table estoque_diario enable row level security;
drop policy if exists "service role full access" on estoque_diario;
create policy "service role full access" on estoque_diario
  for all to service_role using (true) with check (true);
drop policy if exists "authenticated read" on estoque_diario;
create policy "authenticated read" on estoque_diario
  for select to authenticated using (true);

-- =====================================================================
-- RPC: ingestão em lote (upsert idempotente)
-- =====================================================================
create or replace function public.fn_estoque_ingest(
  p_rows     jsonb,
  p_carga_id uuid default null
)
returns table (inserted_count int, updated_count int)
language plpgsql as $$
declare v_ins int := 0; v_upd int := 0;
begin
  with up as (
    insert into estoque_diario (
      data, filial_cod, filial_nome,
      departamento_cod, departamento_nome,
      secao_cod, secao_nome, chave_secao,
      produto_cod, produto_nome, cod_barras,
      disponivel, reservada, total_estoque,
      custo_medio, custo_total_disponivel, custo_total_reservado, custo_total_estoque,
      linha_hash, carga_id
    )
    select
      public.fn_vendas_to_date(r->>'data'),
      r->>'filial_cod',        r->>'filial_nome',
      r->>'departamento_cod',  r->>'departamento_nome',
      r->>'secao_cod',         r->>'secao_nome',
      coalesce(nullif(r->>'chave_secao',''), r->>'secao_nome'),
      r->>'produto_cod',       r->>'produto_nome',
      nullif(r->>'cod_barras',''),
      public.fn_vendas_to_numeric(r->>'disponivel'),
      public.fn_vendas_to_numeric(r->>'reservada'),
      public.fn_vendas_to_numeric(r->>'total_estoque'),
      public.fn_vendas_to_numeric(r->>'custo_medio'),
      public.fn_vendas_to_numeric(r->>'custo_total_disponivel'),
      public.fn_vendas_to_numeric(r->>'custo_total_reservado'),
      public.fn_vendas_to_numeric(r->>'custo_total_estoque'),
      md5(
        coalesce(public.fn_vendas_to_date(r->>'data')::text,'') || '|' ||
        coalesce(r->>'filial_cod','')  || '|' ||
        coalesce(r->>'produto_cod','')
      ),
      p_carga_id
    from jsonb_array_elements(p_rows) r
    where public.fn_vendas_to_date(r->>'data') is not null
      and nullif(r->>'filial_cod','')  is not null
      and nullif(r->>'produto_cod','') is not null
    on conflict (linha_hash) do update set
      filial_nome            = excluded.filial_nome,
      departamento_cod       = excluded.departamento_cod,
      departamento_nome      = excluded.departamento_nome,
      secao_cod              = excluded.secao_cod,
      secao_nome             = excluded.secao_nome,
      chave_secao            = excluded.chave_secao,
      produto_nome           = excluded.produto_nome,
      cod_barras             = coalesce(excluded.cod_barras, estoque_diario.cod_barras),
      disponivel             = excluded.disponivel,
      reservada              = excluded.reservada,
      total_estoque          = excluded.total_estoque,
      custo_medio            = excluded.custo_medio,
      custo_total_disponivel = excluded.custo_total_disponivel,
      custo_total_reservado  = excluded.custo_total_reservado,
      custo_total_estoque    = excluded.custo_total_estoque,
      carga_id               = excluded.carga_id,
      updated_at             = now()
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted), count(*) filter (where not inserted)
  into v_ins, v_upd
  from up;

  inserted_count := v_ins;
  updated_count  := v_upd;
  return next;
end$$;

-- =====================================================================
-- RPC: remove linhas órfãs após reimportar um snapshot
-- =====================================================================
create or replace function public.fn_estoque_prune_orfaos(
  p_datas    date[],
  p_carga_id uuid
)
returns int language plpgsql as $$
declare v_del int := 0;
begin
  if p_carga_id is null or p_datas is null or array_length(p_datas, 1) is null then
    return 0;
  end if;
  delete from estoque_diario
  where data = any(p_datas)
    and carga_id is distinct from p_carga_id;
  get diagnostics v_del = row_count;
  return v_del;
end$$;
