-- =====================================================================
-- Agente: comparativo313
--
-- Objetivo: identificar produtos do MIX OFICIAL das filiais que estão
-- COM RUPTURA na loja mas TÊM ESTOQUE NO DEPÓSITO 313. Mantém o time
-- comercial informado diariamente da ruptura para abastecer.
--
-- Fonte de dados: API local http://192.168.118.50:3001/api/comparativo_new
--   (array de objetos com: deposito, filial, departamento, secao,
--    codigo, produto, estoque_deposito, mix, grade,
--    multiplo_reposicao, multiplo_produto)
--
-- Escopo: apenas registros com deposito iniciando em "313" e mix == "1"
--   (mix oficial). Outros depósitos/mix=0 ficam para futuros agentes.
--
-- Visibilidade (definida 2026-05-20 com o usuário):
--   - diretor / supervisor / admin : todas as filiais (resumo + lista)
--   - gerente                       : filiais de users/{email}.loja
--   - comprador                     : produtos das suas seções (N:N)
--
-- Frequência: 1x ao dia (cron 04:00). Resumos WhatsApp 08:00 via n8n.
--
-- Modelo informativo: não há ciência / observação / data fim. Quando
-- a API deixa de listar (deposito ou loja reabasteceu / mix mudou), a
-- linha vira status 'resolvida'.
-- =====================================================================

-- =====================================================================
-- ENUMS
-- =====================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'status_ruptura') then
    create type status_ruptura as enum ('pendente', 'resolvida');
  end if;
end$$;

-- =====================================================================
-- TABELA: rupturas detectadas
-- Chave natural: (filial_cod, codigo_produto)
-- =====================================================================
create table if not exists comparativo313_rupturas (
  id                    uuid primary key default uuid_generate_v4(),

  -- Localização
  filial                text not null,                  -- "302 - ELETRO BRASIL LTDA"
  filial_cod            text not null,                  -- "302"
  deposito              text not null,                  -- "313 - ELETRO BRASIL LTDA"
  deposito_cod          text not null,                  -- "313"

  -- Hierarquia
  departamento          text,                            -- "9 - CONGELADOS"
  secao                 text,                            -- "1168 - LINGUIÇAS CONGELADAS"
  chave_secao           text,                            -- "1168 - LINGUIÇAS CONGELADAS" (trim/normalizado)

  -- Produto
  codigo_produto        text not null,                   -- "408686"
  descricao_produto     text not null,                   -- "LING FGO QUEIJO COALHO FRIATO 600G"

  -- Métricas de abastecimento
  estoque_deposito      numeric(14,3) not null default 0,
  mix                   boolean not null default true,
  grade                 integer,
  multiplo_reposicao    integer,
  multiplo_produto      integer,

  -- Atribuição de comprador (mesmo modelo do agente margem)
  motivo_atribuicao     motivo_atribuicao not null default 'ok',

  -- Estado
  status                status_ruptura not null default 'pendente',
  primeira_deteccao     timestamptz not null default now(),
  ultima_deteccao       timestamptz not null default now(),
  resolvida_em          timestamptz,
  agente_execucao_id    uuid references agente_execucoes(id) on delete set null,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint uq_comparativo313_ruptura
    unique (filial_cod, codigo_produto)
);

create index if not exists idx_comp313_status        on comparativo313_rupturas(status);
create index if not exists idx_comp313_filial        on comparativo313_rupturas(filial_cod);
create index if not exists idx_comp313_secao         on comparativo313_rupturas(chave_secao);
create index if not exists idx_comp313_ultdetect     on comparativo313_rupturas(ultima_deteccao);
create index if not exists idx_comp313_pendente_fil  on comparativo313_rupturas(filial_cod) where status = 'pendente';

-- Trigger updated_at (reusa função padrão da plataforma se existir)
do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    drop trigger if exists trg_comp313_updated_at on comparativo313_rupturas;
    create trigger trg_comp313_updated_at
      before update on comparativo313_rupturas
      for each row execute function set_updated_at();
  end if;
end$$;

-- =====================================================================
-- TABELA N:N — produto <-> comprador(es) responsável(eis)
-- Espelha o padrão do margem_produto_compradores.
-- =====================================================================
create table if not exists comparativo313_produto_compradores (
  produto_id        uuid not null references comparativo313_rupturas(id) on delete cascade,
  usuario_id        uuid not null references usuarios(id) on delete cascade,
  papel_atribuicao  papel_atribuicao not null,
  created_at        timestamptz not null default now(),
  primary key (produto_id, usuario_id)
);

create index if not exists idx_comp313_pc_usuario on comparativo313_produto_compradores(usuario_id);

-- =====================================================================
-- VIEW: resumo por filial — para diretor/supervisor/gerente e n8n
-- =====================================================================
create or replace view vw_comparativo313_resumo_filial
with (security_invoker = true) as
select
  r.filial_cod,
  max(r.filial)                                            as filial_desc,
  count(*) filter (where r.status = 'pendente')            as rupturas_pendentes,
  count(*) filter (where r.status = 'pendente'
                   and r.estoque_deposito > 0)             as com_estoque_deposito,
  coalesce(sum(r.estoque_deposito)
           filter (where r.status = 'pendente'), 0)        as estoque_total_deposito,
  max(r.ultima_deteccao)                                   as ultima_deteccao
from comparativo313_rupturas r
group by r.filial_cod;

-- =====================================================================
-- VIEW: resumo por responsável (comprador) — para WhatsApp diário
-- =====================================================================
create or replace view vw_comparativo313_resumo_responsavel
with (security_invoker = true) as
select
  u.id                            as usuario_id,
  u.nome                          as usuario_nome,
  u.email_login                   as usuario_email_login,
  u.papel                         as usuario_papel,
  count(*) filter (where r.status = 'pendente')                       as rupturas_pendentes,
  count(distinct r.filial_cod) filter (where r.status = 'pendente')   as filiais_afetadas,
  coalesce(sum(r.estoque_deposito)
           filter (where r.status = 'pendente'), 0)                   as estoque_total_deposito,
  max(r.ultima_deteccao)                                              as ultima_deteccao
from usuarios u
join comparativo313_produto_compradores mc on mc.usuario_id = u.id
join comparativo313_rupturas r             on r.id          = mc.produto_id
where u.ativo = true
group by u.id, u.nome, u.email_login, u.papel
order by rupturas_pendentes desc;

-- =====================================================================
-- VIEW: resumo por (filial, comprador) — drill-down para o e-mail do
-- comprador, mostrando como suas rupturas se distribuem entre lojas.
-- =====================================================================
create or replace view vw_comparativo313_resumo_filial_comprador
with (security_invoker = true) as
select
  mc.usuario_id,
  r.filial_cod,
  max(r.filial)                                       as filial_desc,
  count(*) filter (where r.status = 'pendente')       as rupturas_pendentes,
  max(r.ultima_deteccao)                              as ultima_deteccao
from comparativo313_produto_compradores mc
join comparativo313_rupturas r on r.id = mc.produto_id
group by mc.usuario_id, r.filial_cod;

-- =====================================================================
-- RLS — segue o padrão do margem (compradores enxergam via N:N;
-- diretor/admin/supervisor enxergam tudo; gerente NÃO consulta direto
-- via PostgREST: passa pelo backend, igual metas).
-- =====================================================================
alter table comparativo313_rupturas              enable row level security;
alter table comparativo313_produto_compradores   enable row level security;

drop policy if exists comp313_rupturas_select on comparativo313_rupturas;
create policy comp313_rupturas_select on comparativo313_rupturas
  for select using (
    current_usuario_papel() in ('diretor', 'admin', 'supervisor')
    or exists (
      select 1 from comparativo313_produto_compradores mc
      where mc.produto_id = comparativo313_rupturas.id
        and mc.usuario_id = current_usuario_id()
    )
  );

drop policy if exists comp313_pc_select on comparativo313_produto_compradores;
create policy comp313_pc_select on comparativo313_produto_compradores
  for select using (
    usuario_id = current_usuario_id()
    or current_usuario_papel() in ('diretor', 'admin', 'supervisor')
  );

-- =====================================================================
-- SEED — registrar o agente
-- =====================================================================
insert into agentes (slug, nome, descricao_curta, info_md, icone, cor, threshold_atencao)
values (
  'comparativo313',
  'Comparativo 313',
  'Produtos faltando nas lojas que ainda têm estoque disponível no depósito 313 — visão diária por filial e por comprador.',
  '## O que faz

Consulta a API local `http://192.168.118.50:3001/api/comparativo_new`, filtra apenas registros do **depósito 313** com **mix = SIM** (item oficial da loja), e mantém uma lista das **rupturas** — produtos que estão faltando na filial mas têm estoque no depósito.

## Quem vê o quê

- **Diretor / Supervisor**: resumo de todas as filiais (quantos produtos cada filial tem em ruptura, com estoque disponível no depósito).
- **Gerente**: produtos faltando nas filiais sob sua gestão (Firestore `users/{email}.loja`).
- **Comprador**: produtos das suas seções (mesma convenção do agente margem — `CONFIG/1-SECAO` em multi-comprador).

## Como funciona o ciclo

1. Sync diário às 04:00 lê a API local e filtra `deposito` 313 + `mix = 1`.
2. Resolve comprador(es) pela seção (multi-comprador igual ao margem).
3. Upsert em `comparativo313_rupturas` (chave: filial + código do produto).
4. Linhas que saíram da API viram `status = resolvida` (loja reabasteceu, ou produto saiu do mix).
5. n8n às 08:00 dispara resumo: diretor recebe por filial; gerente pela loja dele; comprador por suas seções.

## Modelo informativo

Diferente do margem, este agente não exige ciência: ele só sinaliza. A linha some sozinha quando o reabastecimento acontece (a API local deixa de retornar o registro).

## Fontes de dados

- API local `http://192.168.118.50:3001/api/comparativo_new`
- Firestore `CONFIG/1-SECAO` (mapa de seções → compradores)
- Firestore `users/{email}` (atributo `loja` para gerente — mesma convenção do agente metas)

## Frequência

- Sync: 1x ao dia (04:00)
- Resumo WhatsApp: 08:00 seg-sáb
',
  'PackageX',
  '#F97316',
  10
)
on conflict (slug) do nothing;
