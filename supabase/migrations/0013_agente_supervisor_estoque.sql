-- =====================================================================
-- Agente: supervisor_estoque
--
-- Objetivo: monitorar diariamente o desempenho de produtos por filial
-- (media_dia, dias_venda, giro) e alertar os responsáveis quando houver
-- variação relevante (>=20%) versus a média móvel dos últimos 7 dias.
--
-- Fontes de dados (2 etapas):
--   1) Histórico: planilhas .xlsx do compartilhamento de rede
--      \\192.168.118.90\shared_path\historico_grade\arquivo-gerado-DD-MM-AAAA-HH-MM-SS.xlsx
--      Carregadas via scripts/ingest-supervisor-estoque.mjs (origem='excel').
--   2) Diário (a partir de hoje): API local
--      http://192.168.118.50:3001/api/produtos
--      Carregada pelo workflow n8n supervisor_estoque_diario (origem='api').
--
-- Visibilidade (mesmo padrão de margem / comparativo313):
--   - diretor / supervisor / admin : todas as filiais (resumo geral)
--   - gerente                       : filiais de users/{email}.loja
--   - comprador                     : alertas das suas seções (via
--     mapeamento herdado de margem_produto_compradores)
--
-- Frequência: API 1x ao dia (cron 07:00). Detecção de alertas é executada
-- na mesma rodada após o ingest.
--
-- Modelo: snapshots históricos + alertas (estado pendente/ciente/...).
-- =====================================================================

-- =====================================================================
-- ENUMS
-- =====================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'supest_metrica') then
    create type supest_metrica as enum ('media_dia', 'giro', 'dias_venda');
  end if;
  if not exists (select 1 from pg_type where typname = 'supest_direcao') then
    create type supest_direcao as enum ('queda', 'aumento');
  end if;
  if not exists (select 1 from pg_type where typname = 'supest_origem') then
    create type supest_origem as enum ('excel', 'api');
  end if;
  if not exists (select 1 from pg_type where typname = 'supest_status') then
    create type supest_status as enum ('pendente', 'ciente', 'resolvido', 'expirado');
  end if;
end$$;

-- =====================================================================
-- HELPERS de conversão PT-BR (usadas pelo RPC de ingest)
-- =====================================================================
create or replace function public.fn_supest_to_numeric(t text)
returns numeric language plpgsql immutable as $$
declare s text;
begin
  if t is null or btrim(t) = '' then return null; end if;
  s := btrim(t);
  if s ~ '^-?[0-9]+(\.[0-9]+)?$' then return s::numeric; end if;
  s := replace(s, '.', '');
  s := replace(s, ',', '.');
  begin return s::numeric; exception when others then return null; end;
end$$;

create or replace function public.fn_supest_to_int(t text)
returns int language plpgsql immutable as $$
declare v numeric;
begin
  v := public.fn_supest_to_numeric(t);
  if v is null then return null; end if;
  return v::int;
end$$;

create or replace function public.fn_supest_to_date_br(t text)
returns date language plpgsql immutable as $$
declare s text; m text[];
begin
  if t is null or btrim(t) = '' then return null; end if;
  s := btrim(t);
  m := regexp_match(s, '^([0-9]{1,2})/([0-9]{1,2})/([0-9]{4})$');
  if m is not null then
    begin return make_date(m[3]::int, m[2]::int, m[1]::int);
    exception when others then return null; end;
  end if;
  begin return s::date; exception when others then return null; end;
end$$;

create or replace function public.fn_supest_parse_filename_date(filename text)
returns date language plpgsql immutable as $$
declare m text[];
begin
  m := regexp_match(filename, 'arquivo-gerado-([0-9]{2})-([0-9]{2})-([0-9]{4})');
  if m is null then return null; end if;
  return make_date(m[3]::int, m[2]::int, m[1]::int);
end$$;

-- =====================================================================
-- TABELA: snapshots históricos (fato)
-- Chave natural: (snapshot_date, filial_cod, codigo_produto)
-- =====================================================================
create table if not exists supervisor_estoque_snapshots (
  id                 uuid primary key default uuid_generate_v4(),
  snapshot_date      date            not null,
  origem             supest_origem   not null,

  -- identificação
  filial             text            not null,
  filial_cod         text            not null,
  codigo_produto     text            not null,
  descricao_produto  text,
  cod_barras         text,                        -- só vem da API

  -- hierarquia
  tipo               text,                        -- Excel-only ("0 - PRODUTOS DE REVENDA")
  setor              text,
  departamento       text,
  secao              text,
  chave_secao        text,                        -- == secao; alinha com margem/313
  fornecedor         text,

  -- indicadores principais (alvo do agente)
  estoque            numeric,
  quant_vendas       numeric,
  media_dia          numeric,
  quant_movimentos   numeric,
  dias_venda         numeric,                     -- API "dias_venda" / Excel "QTDDIASMOV"
  giro               numeric,                     -- API "giro"       / Excel "QTDDIAS"
  maximo             numeric,

  -- complementares
  grade              integer,
  grade_extra        integer,
  multiplo           integer,                     -- só API
  preco              numeric,                     -- só API
  vlr_estoque        numeric,                     -- só Excel
  qtd_reservado      numeric,                     -- só Excel
  qtd_transito_cd    numeric,                     -- só Excel
  qtd_estoque_total  numeric,                     -- só Excel
  mix                boolean,
  ultima_entrada     date,
  ultima_saida       date,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint supervisor_estoque_snapshots_uk
    unique (snapshot_date, filial_cod, codigo_produto)
);

create index if not exists idx_supest_snap_prod_filial_date
  on supervisor_estoque_snapshots (codigo_produto, filial_cod, snapshot_date desc);
create index if not exists idx_supest_snap_date_filial
  on supervisor_estoque_snapshots (snapshot_date desc, filial_cod);
create index if not exists idx_supest_snap_chave_secao
  on supervisor_estoque_snapshots (chave_secao);
create index if not exists idx_supest_snap_origem_date
  on supervisor_estoque_snapshots (origem, snapshot_date desc);

-- Trigger updated_at (reaproveita função padrão da plataforma)
do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    drop trigger if exists trg_supest_snap_updated on supervisor_estoque_snapshots;
    create trigger trg_supest_snap_updated
      before update on supervisor_estoque_snapshots
      for each row execute function set_updated_at();
  end if;
end$$;

-- =====================================================================
-- TABELA: alertas detectados por execução
-- Chave natural: (snapshot_date, filial_cod, codigo_produto, metrica, direcao)
-- =====================================================================
create table if not exists supervisor_estoque_alertas (
  id                 uuid primary key default uuid_generate_v4(),
  agente_execucao_id uuid references agente_execucoes(id) on delete set null,
  snapshot_date      date not null,

  filial             text not null,
  filial_cod         text not null,
  codigo_produto     text not null,
  descricao_produto  text,
  setor              text,
  departamento       text,
  secao              text,
  chave_secao        text,
  fornecedor         text,

  metrica            supest_metrica not null,
  direcao            supest_direcao not null,
  valor_atual        numeric        not null,
  valor_baseline_7d  numeric        not null,
  variacao_pct       numeric        not null,           -- assinado: -25.4 = queda 25,4%
  motivo_atribuicao  motivo_atribuicao not null default 'ok',
  status             supest_status     not null default 'pendente',

  primeira_deteccao  timestamptz not null default now(),
  ultima_deteccao    timestamptz not null default now(),
  resolvido_em       timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint supervisor_estoque_alertas_uk
    unique (snapshot_date, filial_cod, codigo_produto, metrica, direcao)
);

create index if not exists idx_supest_alert_status_date
  on supervisor_estoque_alertas (status, snapshot_date desc);
create index if not exists idx_supest_alert_filial_status
  on supervisor_estoque_alertas (filial_cod, status);
create index if not exists idx_supest_alert_chave_secao_status
  on supervisor_estoque_alertas (chave_secao, status);

do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    drop trigger if exists trg_supest_alert_updated on supervisor_estoque_alertas;
    create trigger trg_supest_alert_updated
      before update on supervisor_estoque_alertas
      for each row execute function set_updated_at();
  end if;
end$$;

-- =====================================================================
-- TABELA N:N: alerta <-> comprador (atribuição por seção)
-- =====================================================================
create table if not exists supervisor_estoque_produto_compradores (
  alerta_id        uuid not null references supervisor_estoque_alertas(id) on delete cascade,
  usuario_id       uuid not null references usuarios(id) on delete cascade,
  papel_atribuicao papel_atribuicao not null default 'principal',
  created_at       timestamptz not null default now(),
  primary key (alerta_id, usuario_id)
);

create index if not exists idx_supest_alert_compradores_user
  on supervisor_estoque_produto_compradores (usuario_id);

-- =====================================================================
-- RLS
-- =====================================================================
alter table supervisor_estoque_snapshots           enable row level security;
alter table supervisor_estoque_alertas             enable row level security;
alter table supervisor_estoque_produto_compradores enable row level security;

drop policy if exists "service role full access" on supervisor_estoque_snapshots;
drop policy if exists "service role full access" on supervisor_estoque_alertas;
drop policy if exists "service role full access" on supervisor_estoque_produto_compradores;
create policy "service role full access" on supervisor_estoque_snapshots
  for all to service_role using (true) with check (true);
create policy "service role full access" on supervisor_estoque_alertas
  for all to service_role using (true) with check (true);
create policy "service role full access" on supervisor_estoque_produto_compradores
  for all to service_role using (true) with check (true);

drop policy if exists "authenticated read" on supervisor_estoque_snapshots;
drop policy if exists "authenticated read" on supervisor_estoque_alertas;
drop policy if exists "authenticated read" on supervisor_estoque_produto_compradores;
create policy "authenticated read" on supervisor_estoque_snapshots
  for select to authenticated using (true);
create policy "authenticated read" on supervisor_estoque_alertas
  for select to authenticated using (true);
create policy "authenticated read" on supervisor_estoque_produto_compradores
  for select to authenticated using (true);

-- =====================================================================
-- VIEWS consumidas pelo workflow n8n / frontend
-- =====================================================================
create or replace view vw_supervisor_estoque_resumo_filial as
select
  a.filial_cod,
  a.filial as filial_desc,
  max(a.snapshot_date) as ultima_deteccao_data,
  count(*)                          filter (where a.status='pendente')                                  as alertas_pendentes,
  count(*)                          filter (where a.status='pendente' and a.metrica='media_dia')        as alertas_media_dia,
  count(*)                          filter (where a.status='pendente' and a.metrica='dias_venda')       as alertas_dias_venda,
  count(*)                          filter (where a.status='pendente' and a.metrica='giro')             as alertas_giro,
  count(*)                          filter (where a.status='pendente' and a.direcao='queda')            as alertas_queda,
  count(*)                          filter (where a.status='pendente' and a.direcao='aumento')          as alertas_aumento,
  count(distinct a.codigo_produto)  filter (where a.status='pendente')                                  as produtos_afetados,
  count(distinct a.chave_secao)     filter (where a.status='pendente')                                  as secoes_afetadas
from supervisor_estoque_alertas a
where a.snapshot_date = (select max(snapshot_date) from supervisor_estoque_alertas)
group by a.filial_cod, a.filial;

create or replace view vw_supervisor_estoque_resumo_responsavel as
select
  u.id                              as usuario_id,
  u.nome                            as usuario_nome,
  u.email_login                     as usuario_email_login,
  count(distinct a.id)              filter (where a.status='pendente') as alertas_pendentes,
  count(distinct a.filial_cod)      filter (where a.status='pendente') as filiais_afetadas,
  count(distinct a.codigo_produto)  filter (where a.status='pendente') as produtos_afetados,
  count(distinct a.chave_secao)     filter (where a.status='pendente') as secoes_afetadas,
  count(*) filter (where a.status='pendente' and a.metrica='media_dia')  as alertas_media_dia,
  count(*) filter (where a.status='pendente' and a.metrica='dias_venda') as alertas_dias_venda,
  count(*) filter (where a.status='pendente' and a.metrica='giro')       as alertas_giro,
  max(a.ultima_deteccao)                                                 as ultima_deteccao
from usuarios u
join supervisor_estoque_produto_compradores pc on pc.usuario_id = u.id
join supervisor_estoque_alertas             a  on a.id          = pc.alerta_id
where u.ativo and u.papel = 'comprador'
  and a.snapshot_date = (select max(snapshot_date) from supervisor_estoque_alertas)
group by u.id, u.nome, u.email_login;

create or replace view vw_supervisor_estoque_resumo_filial_comprador as
select
  u.id                          as usuario_id,
  u.nome                        as usuario_nome,
  u.email_login                 as usuario_email_login,
  a.filial_cod,
  a.filial                      as filial_desc,
  count(*) filter (where a.status='pendente')                            as alertas_pendentes,
  count(*) filter (where a.status='pendente' and a.metrica='media_dia')  as alertas_media_dia,
  count(*) filter (where a.status='pendente' and a.metrica='dias_venda') as alertas_dias_venda,
  count(*) filter (where a.status='pendente' and a.metrica='giro')       as alertas_giro,
  count(*) filter (where a.status='pendente' and a.direcao='queda')      as alertas_queda,
  count(*) filter (where a.status='pendente' and a.direcao='aumento')    as alertas_aumento,
  max(a.ultima_deteccao)                                                 as ultima_deteccao
from usuarios u
join supervisor_estoque_produto_compradores pc on pc.usuario_id = u.id
join supervisor_estoque_alertas             a  on a.id          = pc.alerta_id
where u.ativo and u.papel = 'comprador'
  and a.snapshot_date = (select max(snapshot_date) from supervisor_estoque_alertas)
group by u.id, u.nome, u.email_login, a.filial_cod, a.filial;

create or replace view vw_supervisor_estoque_top_alertas as
select
  a.id, a.snapshot_date, a.filial_cod, a.filial,
  a.codigo_produto, a.descricao_produto,
  a.setor, a.departamento, a.secao, a.chave_secao, a.fornecedor,
  a.metrica, a.direcao, a.valor_atual, a.valor_baseline_7d, a.variacao_pct,
  a.status, a.primeira_deteccao, a.ultima_deteccao
from supervisor_estoque_alertas a
where a.status = 'pendente'
  and a.snapshot_date = (select max(snapshot_date) from supervisor_estoque_alertas);

-- =====================================================================
-- RPC: ingestão em lote (upsert idempotente)
-- =====================================================================
create or replace function public.fn_supest_ingest_snapshots(
  p_origem supest_origem,
  p_rows   jsonb
)
returns table (inserted_count int, updated_count int)
language plpgsql as $$
declare v_ins int := 0; v_upd int := 0;
begin
  with src as (
    select
      (r->>'snapshot_date')::date                                                as snapshot_date,
      r->>'filial'                                                                as filial,
      coalesce(nullif(r->>'filial_cod',''), substring(r->>'filial' from '^([0-9]+)')) as filial_cod,
      r->>'codigo_produto'                                                        as codigo_produto,
      r->>'descricao_produto'                                                     as descricao_produto,
      r->>'cod_barras'                                                            as cod_barras,
      r->>'tipo'                                                                  as tipo,
      r->>'setor'                                                                 as setor,
      r->>'departamento'                                                          as departamento,
      r->>'secao'                                                                 as secao,
      coalesce(nullif(r->>'chave_secao',''), r->>'secao')                         as chave_secao,
      r->>'fornecedor'                                                            as fornecedor,
      public.fn_supest_to_numeric(r->>'estoque')                                  as estoque,
      public.fn_supest_to_numeric(r->>'quant_vendas')                             as quant_vendas,
      public.fn_supest_to_numeric(r->>'media_dia')                                as media_dia,
      public.fn_supest_to_numeric(r->>'quant_movimentos')                         as quant_movimentos,
      public.fn_supest_to_numeric(r->>'dias_venda')                               as dias_venda,
      public.fn_supest_to_numeric(r->>'giro')                                     as giro,
      public.fn_supest_to_numeric(r->>'maximo')                                   as maximo,
      public.fn_supest_to_int(r->>'grade')                                        as grade,
      public.fn_supest_to_int(r->>'grade_extra')                                  as grade_extra,
      public.fn_supest_to_int(r->>'multiplo')                                     as multiplo,
      public.fn_supest_to_numeric(r->>'preco')                                    as preco,
      public.fn_supest_to_numeric(r->>'vlr_estoque')                              as vlr_estoque,
      public.fn_supest_to_numeric(r->>'qtd_reservado')                            as qtd_reservado,
      public.fn_supest_to_numeric(r->>'qtd_transito_cd')                          as qtd_transito_cd,
      public.fn_supest_to_numeric(r->>'qtd_estoque_total')                        as qtd_estoque_total,
      case upper(coalesce(r->>'mix','')) when 'SIM' then true
                                          when 'NAO' then false
                                          when 'NÃO' then false
                                          when 'TRUE' then true
                                          when 'FALSE' then false
                                          else null end                          as mix,
      public.fn_supest_to_date_br(r->>'ultima_entrada')                           as ultima_entrada,
      public.fn_supest_to_date_br(r->>'ultima_saida')                             as ultima_saida
    from jsonb_array_elements(p_rows) r
  ),
  up as (
    insert into supervisor_estoque_snapshots (
      snapshot_date, origem, filial, filial_cod, codigo_produto, descricao_produto, cod_barras,
      tipo, setor, departamento, secao, chave_secao, fornecedor,
      estoque, quant_vendas, media_dia, quant_movimentos, dias_venda, giro, maximo,
      grade, grade_extra, multiplo, preco, vlr_estoque, qtd_reservado, qtd_transito_cd, qtd_estoque_total,
      mix, ultima_entrada, ultima_saida
    )
    select snapshot_date, p_origem, filial, filial_cod, codigo_produto, descricao_produto, cod_barras,
           tipo, setor, departamento, secao, chave_secao, fornecedor,
           estoque, quant_vendas, media_dia, quant_movimentos, dias_venda, giro, maximo,
           grade, grade_extra, multiplo, preco, vlr_estoque, qtd_reservado, qtd_transito_cd, qtd_estoque_total,
           mix, ultima_entrada, ultima_saida
    from src
    where snapshot_date is not null and filial_cod is not null and codigo_produto is not null
    on conflict (snapshot_date, filial_cod, codigo_produto) do update set
      origem            = excluded.origem,
      filial            = excluded.filial,
      descricao_produto = coalesce(excluded.descricao_produto, supervisor_estoque_snapshots.descricao_produto),
      cod_barras        = coalesce(excluded.cod_barras,        supervisor_estoque_snapshots.cod_barras),
      tipo              = coalesce(excluded.tipo,              supervisor_estoque_snapshots.tipo),
      setor             = coalesce(excluded.setor,             supervisor_estoque_snapshots.setor),
      departamento      = coalesce(excluded.departamento,      supervisor_estoque_snapshots.departamento),
      secao             = coalesce(excluded.secao,             supervisor_estoque_snapshots.secao),
      chave_secao       = coalesce(excluded.chave_secao,       supervisor_estoque_snapshots.chave_secao),
      fornecedor        = coalesce(excluded.fornecedor,        supervisor_estoque_snapshots.fornecedor),
      estoque           = excluded.estoque,
      quant_vendas      = excluded.quant_vendas,
      media_dia         = excluded.media_dia,
      quant_movimentos  = excluded.quant_movimentos,
      dias_venda        = excluded.dias_venda,
      giro              = excluded.giro,
      maximo            = excluded.maximo,
      grade             = coalesce(excluded.grade,             supervisor_estoque_snapshots.grade),
      grade_extra       = coalesce(excluded.grade_extra,       supervisor_estoque_snapshots.grade_extra),
      multiplo          = coalesce(excluded.multiplo,          supervisor_estoque_snapshots.multiplo),
      preco             = coalesce(excluded.preco,             supervisor_estoque_snapshots.preco),
      vlr_estoque       = coalesce(excluded.vlr_estoque,       supervisor_estoque_snapshots.vlr_estoque),
      qtd_reservado     = coalesce(excluded.qtd_reservado,     supervisor_estoque_snapshots.qtd_reservado),
      qtd_transito_cd   = coalesce(excluded.qtd_transito_cd,   supervisor_estoque_snapshots.qtd_transito_cd),
      qtd_estoque_total = coalesce(excluded.qtd_estoque_total, supervisor_estoque_snapshots.qtd_estoque_total),
      mix               = coalesce(excluded.mix,               supervisor_estoque_snapshots.mix),
      ultima_entrada    = coalesce(excluded.ultima_entrada,    supervisor_estoque_snapshots.ultima_entrada),
      ultima_saida      = coalesce(excluded.ultima_saida,      supervisor_estoque_snapshots.ultima_saida),
      updated_at        = now()
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
-- RPC: detecta alertas (variação >= threshold vs média móvel 7d)
-- Fórmula assinada com |baseline| no denominador — preserva o sinal
-- mesmo com baseline negativo (caso comum em `giro`).
-- =====================================================================
create or replace function public.fn_supest_detect_alerts(
  p_snapshot_date date,
  p_execucao_id   uuid,
  p_threshold_pct numeric default 20.0
)
returns table (alertas_criados int, alertas_atualizados int)
language plpgsql as $$
declare v_ins int := 0; v_upd int := 0;
begin
  with base as (
    select s.codigo_produto, s.filial_cod, s.filial, s.descricao_produto,
           s.setor, s.departamento, s.secao, s.chave_secao, s.fornecedor,
           s.media_dia, s.dias_venda, s.giro
    from supervisor_estoque_snapshots s
    where s.snapshot_date = p_snapshot_date
  ),
  bl as (
    select h.codigo_produto, h.filial_cod,
           avg(h.media_dia)  filter (where h.media_dia  is not null) as bl_media_dia,
           avg(h.dias_venda) filter (where h.dias_venda is not null) as bl_dias_venda,
           avg(h.giro)       filter (where h.giro       is not null) as bl_giro,
           count(*) as n
    from supervisor_estoque_snapshots h
    where h.snapshot_date <  p_snapshot_date
      and h.snapshot_date >= p_snapshot_date - interval '7 days'
    group by h.codigo_produto, h.filial_cod
    having count(*) >= 3
  ),
  candidatos as (
    select b.*, bl.bl_media_dia, bl.bl_dias_venda, bl.bl_giro
    from base b join bl using (codigo_produto, filial_cod)
  ),
  flat as (
    select codigo_produto, filial_cod, filial, descricao_produto,
           setor, departamento, secao, chave_secao, fornecedor,
           'media_dia'::supest_metrica as metrica,
           media_dia as valor_atual, bl_media_dia as baseline
    from candidatos where media_dia is not null and bl_media_dia is not null and bl_media_dia >= 0.5
    union all
    select codigo_produto, filial_cod, filial, descricao_produto,
           setor, departamento, secao, chave_secao, fornecedor,
           'dias_venda'::supest_metrica,
           dias_venda, bl_dias_venda
    from candidatos where dias_venda is not null and bl_dias_venda is not null and bl_dias_venda >= 1
    union all
    select codigo_produto, filial_cod, filial, descricao_produto,
           setor, departamento, secao, chave_secao, fornecedor,
           'giro'::supest_metrica,
           giro, bl_giro
    from candidatos where giro is not null and bl_giro is not null and abs(bl_giro) >= 0.5
  ),
  eligible as (
    select *,
           round(((valor_atual - baseline) / abs(baseline)) * 100, 2) as variacao_pct
    from flat
    where baseline <> 0
  ),
  novos as (
    insert into supervisor_estoque_alertas (
      agente_execucao_id, snapshot_date,
      filial, filial_cod, codigo_produto, descricao_produto,
      setor, departamento, secao, chave_secao, fornecedor,
      metrica, direcao, valor_atual, valor_baseline_7d, variacao_pct
    )
    select p_execucao_id, p_snapshot_date,
           filial, filial_cod, codigo_produto, descricao_produto,
           setor, departamento, secao, chave_secao, fornecedor,
           metrica,
           case when variacao_pct >= 0 then 'aumento'::supest_direcao else 'queda'::supest_direcao end,
           valor_atual, baseline, variacao_pct
    from eligible
    where abs(variacao_pct) >= p_threshold_pct
    on conflict (snapshot_date, filial_cod, codigo_produto, metrica, direcao) do update set
      valor_atual        = excluded.valor_atual,
      valor_baseline_7d  = excluded.valor_baseline_7d,
      variacao_pct       = excluded.variacao_pct,
      agente_execucao_id = excluded.agente_execucao_id,
      ultima_deteccao    = now(),
      updated_at         = now()
    returning (xmax = 0) as inserted
  )
  select count(*) filter (where inserted),
         count(*) filter (where not inserted)
  into v_ins, v_upd
  from novos;

  alertas_criados     := v_ins;
  alertas_atualizados := v_upd;
  return next;
end$$;

-- =====================================================================
-- RPC: atribui compradores aos alertas do dia, via mapeamento da margem
-- =====================================================================
create or replace function public.fn_supest_atribuir_compradores(p_snapshot_date date)
returns int language plpgsql as $$
declare v_count int := 0;
begin
  with alertas_do_dia as (
    select id, chave_secao from supervisor_estoque_alertas
    where snapshot_date = p_snapshot_date and chave_secao is not null
  ),
  map_secao as (
    select distinct mp.chave_secao, mpc.usuario_id, mpc.papel_atribuicao
    from margem_produtos mp
    join margem_produto_compradores mpc on mpc.produto_id = mp.id
    where mp.chave_secao is not null
  ),
  inseridos as (
    insert into supervisor_estoque_produto_compradores (alerta_id, usuario_id, papel_atribuicao)
    select a.id, m.usuario_id, m.papel_atribuicao
    from alertas_do_dia a
    join map_secao m on m.chave_secao = a.chave_secao
    on conflict (alerta_id, usuario_id) do nothing
    returning 1
  )
  select count(*) into v_count from inseridos;
  return v_count;
end$$;

-- =====================================================================
-- REGISTRO do agente + vínculo de usuários
-- =====================================================================
insert into agentes (slug, nome, descricao_curta, icone, cor, ativo, threshold_atencao, info_md)
values (
  'supervisor_estoque',
  'Supervisor de Estoque',
  'Monitora variação diária dos indicadores de giro (media_dia, dias_venda, giro) por produto/filial e alerta os responsáveis.',
  'package',
  '#16A34A',
  true,
  20,
  'Compara cada métrica do dia com a média móvel dos últimos 7 dias da mesma combinação produto+filial. Variação ≥ ±20% gera alerta. Diretor/supervisor recebem o resumo geral; gerente recebe sua(s) filial(is); comprador recebe alertas das suas seções.'
)
on conflict (slug) do update set
  nome              = excluded.nome,
  descricao_curta   = excluded.descricao_curta,
  icone             = excluded.icone,
  cor               = excluded.cor,
  threshold_atencao = excluded.threshold_atencao,
  info_md           = excluded.info_md,
  updated_at        = now();

-- Vincula todos os usuários ativos com papel relevante
with ag as (select id from agentes where slug = 'supervisor_estoque' limit 1)
insert into agente_usuario (agente_id, usuario_id, papel_no_agente)
select ag.id, u.id,
       case u.papel::text
         when 'diretor'    then 'diretor'
         when 'supervisor' then 'supervisor'
         when 'gerente'    then 'gerente'
         when 'comprador'  then 'comprador'
         else 'observador' end
from ag cross join usuarios u
where u.ativo
  and u.papel in ('diretor','supervisor','gerente','comprador')
on conflict (agente_id, usuario_id) do nothing;
