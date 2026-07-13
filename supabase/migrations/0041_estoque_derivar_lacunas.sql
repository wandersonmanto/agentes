-- =====================================================================
-- Reconstrução do estoque nos dias SEM arquivo (domingo, feriado...).
--
-- O arquivo de estoque é uma foto e não pode ser gerado retroativamente
-- (o operador não trabalha domingo). Mas a VENDA do domingo nós temos,
-- com precisão, no maestro. Então dá para reconstruir:
--
--   estoque(domingo) ≈ estoque(sábado) − vendas(domingo)
--
-- Premissa: não há RECEBIMENTO nos dias sem operador (domingo/feriado) —
-- que é justamente a maior fonte de contaminação do estoque. Sobra quebra,
-- pequena em 1 dia. Por isso o método é sólido para lacuna curta e NÃO
-- deve ser usado para buracos longos (p_max_chain limita).
--
-- Decisões de segurança:
--  - coluna `origem`: 'arquivo' (medido) vs 'derivado' (reconstruído).
--    Uma foto real NUNCA é sobrescrita por uma derivada.
--  - deriva sempre a partir do último snapshot REAL, descontando as vendas
--    acumuladas desde ele (não encadeia derivado sobre derivado, o que
--    acumularia erro).
--  - reexecutar é idempotente: se a venda do dia for corrigida, basta
--    rodar de novo que a linha derivada é recalculada.
-- =====================================================================

alter table estoque_diario
  add column if not exists origem text not null default 'arquivo';

create index if not exists idx_estoque_data_origem on estoque_diario (data, origem);

-- ---------------------------------------------------------------------
-- ingest do ARQUIVO passa a marcar origem = 'arquivo'
-- ---------------------------------------------------------------------
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
      linha_hash, carga_id, origem
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
      p_carga_id,
      'arquivo'
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
      origem                 = 'arquivo',   -- foto real sempre vence a derivada
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

-- ---------------------------------------------------------------------
-- RPC: preenche as lacunas de estoque no intervalo
--   estoque(D) = estoque(último snapshot REAL S) − vendas(S+1 .. D)
-- ---------------------------------------------------------------------
create or replace function public.fn_estoque_derivar_lacunas(
  p_from       date,
  p_to         date,
  p_max_chain  int default 3    -- distância máx. (dias) até o último snapshot real
)
returns table (
  data_derivada    date,
  base_snapshot    date,
  linhas_derivadas int
)
language plpgsql as $$
declare
  d       date;
  s       date;
  v_carga uuid := gen_random_uuid();
  n       int;
begin
  for d in select gs::date from generate_series(p_from, p_to, interval '1 day') gs loop

    -- já existe FOTO REAL desse dia? nada a fazer.
    if exists (select 1 from estoque_diario e where e.data = d and e.origem = 'arquivo') then
      continue;
    end if;

    -- último snapshot REAL antes de d, dentro do limite de arraste
    select max(e.data) into s
    from estoque_diario e
    where e.origem = 'arquivo'
      and e.data <  d
      and e.data >= d - p_max_chain;

    if s is null then
      continue;   -- sem base confiável: deixa o carry-forward da consulta cuidar
    end if;

    insert into estoque_diario (
      data, filial_cod, filial_nome, departamento_cod, departamento_nome,
      secao_cod, secao_nome, chave_secao, produto_cod, produto_nome, cod_barras,
      disponivel, reservada, total_estoque, custo_medio,
      custo_total_disponivel, custo_total_reservado, custo_total_estoque,
      linha_hash, carga_id, origem
    )
    select
      d,
      b.filial_cod, b.filial_nome, b.departamento_cod, b.departamento_nome,
      b.secao_cod, b.secao_nome, b.chave_secao, b.produto_cod, b.produto_nome, b.cod_barras,
      greatest(0, coalesce(b.disponivel, 0) - coalesce(v.qtd, 0)),
      b.reservada,
      greatest(0, coalesce(b.disponivel, 0) - coalesce(v.qtd, 0)) + coalesce(b.reservada, 0),
      b.custo_medio,
      round(greatest(0, coalesce(b.disponivel, 0) - coalesce(v.qtd, 0)) * coalesce(b.custo_medio, 0), 2),
      b.custo_total_reservado,
      round(greatest(0, coalesce(b.disponivel, 0) - coalesce(v.qtd, 0)) * coalesce(b.custo_medio, 0), 2)
        + coalesce(b.custo_total_reservado, 0),
      md5(d::text || '|' || coalesce(b.filial_cod, '') || '|' || coalesce(b.produto_cod, '')),
      v_carga,
      'derivado'
    from estoque_diario b
    left join (
      select vd.filial_cod, vd.produto_cod, sum(vd.quantidade) as qtd
      from vendas_diarias vd
      where vd.dia > s and vd.dia <= d
      group by vd.filial_cod, vd.produto_cod
    ) v on v.filial_cod = b.filial_cod and v.produto_cod = b.produto_cod
    where b.data = s
      and b.origem = 'arquivo'
    on conflict (linha_hash) do update set
      disponivel             = excluded.disponivel,
      reservada              = excluded.reservada,
      total_estoque          = excluded.total_estoque,
      custo_medio            = excluded.custo_medio,
      custo_total_disponivel = excluded.custo_total_disponivel,
      custo_total_estoque    = excluded.custo_total_estoque,
      carga_id               = excluded.carga_id,
      origem                 = 'derivado',
      updated_at             = now()
    where estoque_diario.origem <> 'arquivo';   -- protege a foto real

    get diagnostics n = row_count;

    data_derivada    := d;
    base_snapshot    := s;
    linhas_derivadas := n;
    return next;
  end loop;
end$$;
