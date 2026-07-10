-- =====================================================================
-- Agente: metas
-- Verifica filiais/setores/departamentos/seções que estão tendenciando
-- a não entregar a meta de vendas.
--
-- Fonte de dados: Firestore METAS-SUPERMERCADO/{ano}-{mes_extenso}-{filial}
--   (1 doc por filial por mês). Cada doc tem:
--     loja, meta_loja                (maps consolidados da filial)
--     setor[],        meta_setor[]   (arrays paralelos por setor)
--     departamento[], meta_departamento[]
--     secao[],        meta_secao[]
--
-- Frequência de sync: 24h (vs. 1h do margem — meta muda devagar).
--
-- Visibilidade: cada usuário (papel comprador) vê APENAS as filiais
-- listadas em Firestore users/{email}.loja (array de strings ou
-- sentinel "todas"). Diretor/supervisor/admin veem tudo.
--
-- Não há tela de "Agregado para diretor" neste agente (decisão do
-- briefing 2026-05-18).
-- =====================================================================

-- =====================================================================
-- ENUMS
-- =====================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'metas_nivel') then
    create type metas_nivel as enum ('loja', 'setor', 'departamento', 'secao');
  end if;
end$$;

-- =====================================================================
-- TABELA: snapshots de metas
-- Uma linha por (snapshot_date, filial_cod, nivel, cod).
-- Histórico preservado — cada sync diário gera novas linhas.
-- =====================================================================
create table if not exists metas_snapshots (
  id                    uuid primary key default uuid_generate_v4(),

  competencia           text not null,            -- '2026-maio'
  filial_cod            text not null,            -- '305'
  filial_desc           text,                     -- '305 - ELETRO BRASIL LTDA'

  nivel                 metas_nivel not null,     -- loja | setor | departamento | secao
  cod                   text,                     -- código (null para nível 'loja')
  descricao             text,                     -- nome amigável

  -- Valores do dia ----------------------------------------------------
  venda                 numeric(14,2),
  meta_venda            numeric(14,2),

  dias_corte_tendencia  integer,                  -- dias já transcorridos / contados
  dias_tendencia        integer,                  -- dias do período (mês)

  -- Indicadores derivados (mesma fórmula do front antigo) -------------
  -- desvio_meta      = -(meta_venda - venda)              [R$]
  -- tendencia        = (venda / dias_corte_tendencia) * dias_tendencia
  -- desvio_tendencia = -(meta_venda - tendencia)          [R$]
  -- percent          = venda * 100 / meta_venda           [%]
  -- venda_ideal_dia  = meta_venda / dias_tendencia        [R$/dia]
  desvio_meta           numeric(14,2),
  tendencia             numeric(14,2),
  desvio_tendencia      numeric(14,2),
  percent_atingido      numeric(8,2),
  venda_ideal_dia       numeric(14,2),

  -- True quando a tendência projetada NÃO atinge a meta de venda
  em_risco              boolean not null default false,

  snapshot_date         date not null,            -- dia do sync (truncado UTC-3 já no app)
  agente_execucao_id    uuid references agente_execucoes(id) on delete set null,

  created_at            timestamptz not null default now(),

  constraint uq_metas_snapshot
    unique (snapshot_date, filial_cod, nivel, cod)
);

create index if not exists idx_metas_snap_dt        on metas_snapshots(snapshot_date);
create index if not exists idx_metas_snap_filial    on metas_snapshots(filial_cod);
create index if not exists idx_metas_snap_nivel     on metas_snapshots(nivel);
create index if not exists idx_metas_snap_em_risco  on metas_snapshots(em_risco) where em_risco;

-- =====================================================================
-- VIEW: último snapshot por (filial, nivel, cod)
-- Usada pelas telas e pelos resumos do n8n. Garante "1 linha = estado atual".
-- =====================================================================
create or replace view vw_metas_atual
with (security_invoker = true) as
select distinct on (filial_cod, nivel, cod)
  id, competencia, filial_cod, filial_desc, nivel, cod, descricao,
  venda, meta_venda, dias_corte_tendencia, dias_tendencia,
  desvio_meta, tendencia, desvio_tendencia, percent_atingido, venda_ideal_dia,
  em_risco, snapshot_date, created_at
from metas_snapshots
order by filial_cod, nivel, cod, snapshot_date desc, created_at desc;

-- =====================================================================
-- VIEW: resumo de risco por filial (para WhatsApp do comprador)
-- Conta quantos sub-níveis (setor/dept/secao) estão em risco em cada filial.
-- =====================================================================
create or replace view vw_metas_resumo_por_filial
with (security_invoker = true) as
select
  v.filial_cod,
  max(v.filial_desc)                                                 as filial_desc,
  max(v.snapshot_date)                                               as snapshot_date,

  -- Estado da filial como um todo (nível 'loja')
  max(v.venda)            filter (where v.nivel = 'loja')            as venda_loja,
  max(v.meta_venda)       filter (where v.nivel = 'loja')            as meta_loja_venda,
  max(v.tendencia)        filter (where v.nivel = 'loja')            as tendencia_loja,
  max(v.percent_atingido) filter (where v.nivel = 'loja')            as percent_loja,
  bool_or(v.em_risco)     filter (where v.nivel = 'loja')            as loja_em_risco,

  -- Quebra por nível
  count(*) filter (where v.nivel = 'setor'        and v.em_risco)    as setores_em_risco,
  count(*) filter (where v.nivel = 'departamento' and v.em_risco)    as departamentos_em_risco,
  count(*) filter (where v.nivel = 'secao'        and v.em_risco)    as secoes_em_risco
from vw_metas_atual v
group by v.filial_cod;

-- =====================================================================
-- RLS
-- =====================================================================
alter table metas_snapshots enable row level security;

-- Filtro por filial vive no Firestore (users/{email}.loja).
-- O backend usa service_role e simula a regra na rota. Aqui no Postgres,
-- só permitimos leitura para diretor/admin/supervisor (que veem tudo) —
-- o comprador NÃO consulta direto via PostgREST: passa pelo backend.
drop policy if exists metas_snapshots_select on metas_snapshots;
create policy metas_snapshots_select on metas_snapshots
  for select using (
    current_usuario_papel() in ('diretor', 'admin', 'supervisor')
  );

-- =====================================================================
-- SEED — registrar o agente
-- =====================================================================
insert into agentes (slug, nome, descricao_curta, info_md, icone, cor, threshold_atencao)
values (
  'metas',
  'Metas',
  'Acompanha filiais, setores, departamentos e seções que estão tendenciando a não entregar a meta de vendas.',
  '## O que faz

Lê o documento mensal de metas no Firestore (`METAS-SUPERMERCADO/{ano}-{mês}-{filial}`), calcula a tendência projetada para o fim do mês a partir do realizado parcial e identifica filiais e quebras internas (setor / departamento / seção) que estão tendenciando a NÃO bater a meta de venda.

## Fórmula da tendência

```
tendencia        = (venda / dias_corte_tendencia) * dias_tendencia
desvio_meta      = venda - meta_venda
desvio_tendencia = tendencia - meta_venda
percent          = (venda / meta_venda) * 100
venda_ideal_dia  = meta_venda / dias_tendencia
em_risco         = tendencia < meta_venda
```

## Atribuições

- Sincronização diária com o Firestore (1 leitura por filial)
- Resumo diário por WhatsApp ao comprador, listando suas filiais em risco
- Cada comprador recebe APENAS as filiais cadastradas em `users/{email}.loja` (Firestore)

## Fontes de dados

- Firestore `METAS-SUPERMERCADO/{ano}-{mes_extenso}-{filial}` (ex.: `2026-maio-305`)
- Firestore `users/{email}` (atributo `loja`: array de strings, ou `"todas"`)
- Banco Supabase (`metas_snapshots`)

## Frequência

- Sync: a cada 24h
- Resumo comprador: 08:00 seg-sáb
',
  'Target',
  '#10B981',
  1
)
on conflict (slug) do nothing;

-- Não pré-vinculamos compradores aqui: a curadoria de quem recebe push
-- vive em Firestore users/{email}.agentes (array de slugs). O vínculo
-- agente_usuario é opcional — populado conforme necessidade.
