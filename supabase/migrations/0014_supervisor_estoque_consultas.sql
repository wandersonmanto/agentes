-- =====================================================================
-- supervisor_estoque — consultas dimensionais e classificação por banda
--
-- Decisões aprovadas em 2026-05-22:
--   - "Banda de giro" = classificação do produto pelo dias_venda atual:
--       0    → critico
--       1-9  → baixo
--       10-15→ medio
--       16-31→ constante
--   - Consultas dimensionais (filial / fornecedor / setor / departamento
--     / seção) mostram estado ATUAL + comparação com 7d e 30d atrás.
--   - estoque está preservado no snapshot; previsão de ruptura =
--     estoque / NULLIF(media_dia, 0).
-- =====================================================================

-- ---------- função de classificação por banda ----------
create or replace function public.fn_supest_banda(dias_venda numeric)
returns text language sql immutable as $$
  select case
    when dias_venda is null                     then null
    when dias_venda  = 0                        then 'critico'
    when dias_venda between 1  and 9            then 'baixo'
    when dias_venda between 10 and 15           then 'medio'
    when dias_venda between 16 and 31           then 'constante'
    else 'fora_de_faixa'
  end
$$;

comment on function public.fn_supest_banda(numeric) is
  'Classifica produto pela quantidade de dias com venda nos últimos 30 dias: '
  '0=critico, 1-9=baixo, 10-15=medio, 16-31=constante.';

-- ---------- índices auxiliares para consultas dimensionais ----------
create index if not exists idx_supest_snap_date_fornecedor
  on supervisor_estoque_snapshots (snapshot_date desc, fornecedor);
create index if not exists idx_supest_snap_date_setor
  on supervisor_estoque_snapshots (snapshot_date desc, setor);
create index if not exists idx_supest_snap_date_departamento
  on supervisor_estoque_snapshots (snapshot_date desc, departamento);
create index if not exists idx_supest_snap_date_chave_secao
  on supervisor_estoque_snapshots (snapshot_date desc, chave_secao);

-- =====================================================================
-- VIEW: estado atual de cada (produto, filial)
-- 1 linha por (codigo_produto, filial_cod) — último snapshot disponível
-- =====================================================================
create or replace view vw_supervisor_estoque_produto_atual as
with ult as (
  select distinct on (codigo_produto, filial_cod) s.*
  from supervisor_estoque_snapshots s
  order by codigo_produto, filial_cod, snapshot_date desc
),
alertas_count as (
  select codigo_produto, filial_cod, count(*) as n
  from supervisor_estoque_alertas
  where status = 'pendente'
  group by codigo_produto, filial_cod
)
select
  u.snapshot_date, u.origem,
  u.filial_cod, u.filial,
  u.codigo_produto, u.descricao_produto, u.cod_barras,
  u.tipo, u.setor, u.departamento, u.secao, u.chave_secao, u.fornecedor,
  u.estoque, u.preco, u.quant_vendas, u.quant_movimentos,
  u.media_dia, u.dias_venda, u.giro, u.maximo,
  u.grade, u.multiplo, u.mix,
  u.ultima_entrada, u.ultima_saida,
  coalesce(u.vlr_estoque, u.estoque * u.preco)                 as valor_estoque,
  public.fn_supest_banda(u.dias_venda)                         as banda,
  case
    when u.media_dia is null or u.media_dia = 0 then null
    when u.estoque   is null                    then null
    else round(u.estoque / u.media_dia, 1)
  end                                                          as dias_ate_ruptura,
  case
    when u.ultima_saida is null then null
    else (u.snapshot_date - u.ultima_saida)
  end                                                          as dias_desde_ultima_saida,
  coalesce(a.n, 0)                                             as alertas_pendentes
from ult u
left join alertas_count a
       on a.codigo_produto = u.codigo_produto and a.filial_cod = u.filial_cod;

comment on view vw_supervisor_estoque_produto_atual is
  'Estado mais recente de cada (produto, filial): métricas, banda de giro, '
  'previsão de ruptura, dias desde última saída e contagem de alertas.';

-- =====================================================================
-- VIEW: histórico (snapshots + colunas derivadas)
-- Pra gráficos / linha do tempo
-- =====================================================================
create or replace view vw_supervisor_estoque_produto_historico as
select
  s.*,
  coalesce(s.vlr_estoque, s.estoque * s.preco)               as valor_estoque,
  public.fn_supest_banda(s.dias_venda)                       as banda,
  case
    when s.media_dia is null or s.media_dia = 0 then null
    when s.estoque   is null                    then null
    else round(s.estoque / s.media_dia, 1)
  end                                                        as dias_ate_ruptura
from supervisor_estoque_snapshots s;

comment on view vw_supervisor_estoque_produto_historico is
  'Snapshot diário + colunas derivadas (valor_estoque, banda, dias_ate_ruptura). '
  'Use ORDER BY snapshot_date para construir gráficos por produto/filial.';

-- =====================================================================
-- VIEWS DIMENSIONAIS: resumo agregado com comparação atual / 7d / 30d
-- Padrão se repete em 5 views — só muda a coluna de agrupamento.
-- =====================================================================

create or replace view vw_supervisor_estoque_dim_filial as
with d as (select max(snapshot_date) as d_hoje from supervisor_estoque_snapshots),
ag_at as (
  select s.filial_cod as chave, max(s.filial) as descricao,
         count(*) as produtos,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='constante') as banda_constante,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='medio')     as banda_medio,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='baixo')     as banda_baixo,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='critico')   as banda_critico,
         sum(coalesce(s.vlr_estoque, s.estoque * s.preco)) as valor_estoque,
         count(*) filter (where s.media_dia > 0 and s.estoque / s.media_dia <= 7) as produtos_em_risco
  from supervisor_estoque_snapshots s, d where s.snapshot_date = d.d_hoje
  group by s.filial_cod
),
ag_7d as (
  select s.filial_cod as chave,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='constante') as banda_constante,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='medio')     as banda_medio,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='baixo')     as banda_baixo,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='critico')   as banda_critico
  from supervisor_estoque_snapshots s, d where s.snapshot_date = d.d_hoje - 7
  group by s.filial_cod
),
ag_30d as (
  select s.filial_cod as chave,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='constante') as banda_constante,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='medio')     as banda_medio,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='baixo')     as banda_baixo,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='critico')   as banda_critico
  from supervisor_estoque_snapshots s, d where s.snapshot_date = d.d_hoje - 30
  group by s.filial_cod
)
select h.chave as filial_cod, h.descricao as filial_desc,
       h.produtos, h.banda_constante, h.banda_medio, h.banda_baixo, h.banda_critico,
       h.valor_estoque, h.produtos_em_risco,
       (h.banda_constante - coalesce(d7.banda_constante,0))  as delta_constante_7d,
       (h.banda_medio     - coalesce(d7.banda_medio,0))      as delta_medio_7d,
       (h.banda_baixo     - coalesce(d7.banda_baixo,0))      as delta_baixo_7d,
       (h.banda_critico   - coalesce(d7.banda_critico,0))    as delta_critico_7d,
       (h.banda_constante - coalesce(d30.banda_constante,0)) as delta_constante_30d,
       (h.banda_medio     - coalesce(d30.banda_medio,0))     as delta_medio_30d,
       (h.banda_baixo     - coalesce(d30.banda_baixo,0))     as delta_baixo_30d,
       (h.banda_critico   - coalesce(d30.banda_critico,0))   as delta_critico_30d
from ag_at h
left join ag_7d  d7  on d7.chave  = h.chave
left join ag_30d d30 on d30.chave = h.chave;

-- ---- FORNECEDOR ----
create or replace view vw_supervisor_estoque_dim_fornecedor as
with d as (select max(snapshot_date) as d_hoje from supervisor_estoque_snapshots),
ag_at as (
  select s.fornecedor as chave, max(s.fornecedor) as descricao,
         count(*) as produtos,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='constante') as banda_constante,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='medio')     as banda_medio,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='baixo')     as banda_baixo,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='critico')   as banda_critico,
         sum(coalesce(s.vlr_estoque, s.estoque * s.preco)) as valor_estoque,
         count(*) filter (where s.media_dia > 0 and s.estoque / s.media_dia <= 7) as produtos_em_risco
  from supervisor_estoque_snapshots s, d where s.snapshot_date = d.d_hoje and s.fornecedor is not null
  group by s.fornecedor
),
ag_7d as (
  select s.fornecedor as chave,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='constante') as banda_constante,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='medio')     as banda_medio,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='baixo')     as banda_baixo,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='critico')   as banda_critico
  from supervisor_estoque_snapshots s, d where s.snapshot_date = d.d_hoje - 7 and s.fornecedor is not null
  group by s.fornecedor
),
ag_30d as (
  select s.fornecedor as chave,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='constante') as banda_constante,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='medio')     as banda_medio,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='baixo')     as banda_baixo,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='critico')   as banda_critico
  from supervisor_estoque_snapshots s, d where s.snapshot_date = d.d_hoje - 30 and s.fornecedor is not null
  group by s.fornecedor
)
select h.chave as fornecedor, h.descricao as fornecedor_desc,
       h.produtos, h.banda_constante, h.banda_medio, h.banda_baixo, h.banda_critico,
       h.valor_estoque, h.produtos_em_risco,
       (h.banda_constante - coalesce(d7.banda_constante,0))  as delta_constante_7d,
       (h.banda_medio     - coalesce(d7.banda_medio,0))      as delta_medio_7d,
       (h.banda_baixo     - coalesce(d7.banda_baixo,0))      as delta_baixo_7d,
       (h.banda_critico   - coalesce(d7.banda_critico,0))    as delta_critico_7d,
       (h.banda_constante - coalesce(d30.banda_constante,0)) as delta_constante_30d,
       (h.banda_medio     - coalesce(d30.banda_medio,0))     as delta_medio_30d,
       (h.banda_baixo     - coalesce(d30.banda_baixo,0))     as delta_baixo_30d,
       (h.banda_critico   - coalesce(d30.banda_critico,0))   as delta_critico_30d
from ag_at h
left join ag_7d  d7  on d7.chave  = h.chave
left join ag_30d d30 on d30.chave = h.chave;

-- ---- SETOR ----
create or replace view vw_supervisor_estoque_dim_setor as
with d as (select max(snapshot_date) as d_hoje from supervisor_estoque_snapshots),
ag_at as (
  select s.setor as chave, max(s.setor) as descricao,
         count(*) as produtos,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='constante') as banda_constante,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='medio')     as banda_medio,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='baixo')     as banda_baixo,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='critico')   as banda_critico,
         sum(coalesce(s.vlr_estoque, s.estoque * s.preco)) as valor_estoque,
         count(*) filter (where s.media_dia > 0 and s.estoque / s.media_dia <= 7) as produtos_em_risco
  from supervisor_estoque_snapshots s, d where s.snapshot_date = d.d_hoje and s.setor is not null
  group by s.setor
),
ag_7d as (
  select s.setor as chave,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='constante') as banda_constante,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='medio')     as banda_medio,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='baixo')     as banda_baixo,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='critico')   as banda_critico
  from supervisor_estoque_snapshots s, d where s.snapshot_date = d.d_hoje - 7 and s.setor is not null
  group by s.setor
),
ag_30d as (
  select s.setor as chave,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='constante') as banda_constante,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='medio')     as banda_medio,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='baixo')     as banda_baixo,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='critico')   as banda_critico
  from supervisor_estoque_snapshots s, d where s.snapshot_date = d.d_hoje - 30 and s.setor is not null
  group by s.setor
)
select h.chave as setor, h.descricao as setor_desc,
       h.produtos, h.banda_constante, h.banda_medio, h.banda_baixo, h.banda_critico,
       h.valor_estoque, h.produtos_em_risco,
       (h.banda_constante - coalesce(d7.banda_constante,0))  as delta_constante_7d,
       (h.banda_medio     - coalesce(d7.banda_medio,0))      as delta_medio_7d,
       (h.banda_baixo     - coalesce(d7.banda_baixo,0))      as delta_baixo_7d,
       (h.banda_critico   - coalesce(d7.banda_critico,0))    as delta_critico_7d,
       (h.banda_constante - coalesce(d30.banda_constante,0)) as delta_constante_30d,
       (h.banda_medio     - coalesce(d30.banda_medio,0))     as delta_medio_30d,
       (h.banda_baixo     - coalesce(d30.banda_baixo,0))     as delta_baixo_30d,
       (h.banda_critico   - coalesce(d30.banda_critico,0))   as delta_critico_30d
from ag_at h
left join ag_7d  d7  on d7.chave  = h.chave
left join ag_30d d30 on d30.chave = h.chave;

-- ---- DEPARTAMENTO ----
create or replace view vw_supervisor_estoque_dim_departamento as
with d as (select max(snapshot_date) as d_hoje from supervisor_estoque_snapshots),
ag_at as (
  select s.departamento as chave, max(s.departamento) as descricao,
         count(*) as produtos,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='constante') as banda_constante,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='medio')     as banda_medio,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='baixo')     as banda_baixo,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='critico')   as banda_critico,
         sum(coalesce(s.vlr_estoque, s.estoque * s.preco)) as valor_estoque,
         count(*) filter (where s.media_dia > 0 and s.estoque / s.media_dia <= 7) as produtos_em_risco
  from supervisor_estoque_snapshots s, d where s.snapshot_date = d.d_hoje and s.departamento is not null
  group by s.departamento
),
ag_7d as (
  select s.departamento as chave,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='constante') as banda_constante,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='medio')     as banda_medio,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='baixo')     as banda_baixo,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='critico')   as banda_critico
  from supervisor_estoque_snapshots s, d where s.snapshot_date = d.d_hoje - 7 and s.departamento is not null
  group by s.departamento
),
ag_30d as (
  select s.departamento as chave,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='constante') as banda_constante,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='medio')     as banda_medio,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='baixo')     as banda_baixo,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='critico')   as banda_critico
  from supervisor_estoque_snapshots s, d where s.snapshot_date = d.d_hoje - 30 and s.departamento is not null
  group by s.departamento
)
select h.chave as departamento, h.descricao as departamento_desc,
       h.produtos, h.banda_constante, h.banda_medio, h.banda_baixo, h.banda_critico,
       h.valor_estoque, h.produtos_em_risco,
       (h.banda_constante - coalesce(d7.banda_constante,0))  as delta_constante_7d,
       (h.banda_medio     - coalesce(d7.banda_medio,0))      as delta_medio_7d,
       (h.banda_baixo     - coalesce(d7.banda_baixo,0))      as delta_baixo_7d,
       (h.banda_critico   - coalesce(d7.banda_critico,0))    as delta_critico_7d,
       (h.banda_constante - coalesce(d30.banda_constante,0)) as delta_constante_30d,
       (h.banda_medio     - coalesce(d30.banda_medio,0))     as delta_medio_30d,
       (h.banda_baixo     - coalesce(d30.banda_baixo,0))     as delta_baixo_30d,
       (h.banda_critico   - coalesce(d30.banda_critico,0))   as delta_critico_30d
from ag_at h
left join ag_7d  d7  on d7.chave  = h.chave
left join ag_30d d30 on d30.chave = h.chave;

-- ---- SEÇÃO ----
create or replace view vw_supervisor_estoque_dim_secao as
with d as (select max(snapshot_date) as d_hoje from supervisor_estoque_snapshots),
ag_at as (
  select s.chave_secao as chave, max(s.secao) as descricao,
         count(*) as produtos,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='constante') as banda_constante,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='medio')     as banda_medio,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='baixo')     as banda_baixo,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='critico')   as banda_critico,
         sum(coalesce(s.vlr_estoque, s.estoque * s.preco)) as valor_estoque,
         count(*) filter (where s.media_dia > 0 and s.estoque / s.media_dia <= 7) as produtos_em_risco
  from supervisor_estoque_snapshots s, d where s.snapshot_date = d.d_hoje and s.chave_secao is not null
  group by s.chave_secao
),
ag_7d as (
  select s.chave_secao as chave,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='constante') as banda_constante,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='medio')     as banda_medio,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='baixo')     as banda_baixo,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='critico')   as banda_critico
  from supervisor_estoque_snapshots s, d where s.snapshot_date = d.d_hoje - 7 and s.chave_secao is not null
  group by s.chave_secao
),
ag_30d as (
  select s.chave_secao as chave,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='constante') as banda_constante,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='medio')     as banda_medio,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='baixo')     as banda_baixo,
         count(*) filter (where public.fn_supest_banda(s.dias_venda)='critico')   as banda_critico
  from supervisor_estoque_snapshots s, d where s.snapshot_date = d.d_hoje - 30 and s.chave_secao is not null
  group by s.chave_secao
)
select h.chave as chave_secao, h.descricao as secao_desc,
       h.produtos, h.banda_constante, h.banda_medio, h.banda_baixo, h.banda_critico,
       h.valor_estoque, h.produtos_em_risco,
       (h.banda_constante - coalesce(d7.banda_constante,0))  as delta_constante_7d,
       (h.banda_medio     - coalesce(d7.banda_medio,0))      as delta_medio_7d,
       (h.banda_baixo     - coalesce(d7.banda_baixo,0))      as delta_baixo_7d,
       (h.banda_critico   - coalesce(d7.banda_critico,0))    as delta_critico_7d,
       (h.banda_constante - coalesce(d30.banda_constante,0)) as delta_constante_30d,
       (h.banda_medio     - coalesce(d30.banda_medio,0))     as delta_medio_30d,
       (h.banda_baixo     - coalesce(d30.banda_baixo,0))     as delta_baixo_30d,
       (h.banda_critico   - coalesce(d30.banda_critico,0))   as delta_critico_30d
from ag_at h
left join ag_7d  d7  on d7.chave  = h.chave
left join ag_30d d30 on d30.chave = h.chave;
