-- =====================================================================
-- Plataforma de Agentes — Schema inicial (multi-agente, N:N produto/comprador)
-- Aplicar via Supabase SQL Editor ou `supabase db push`
-- =====================================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- =====================================================================
-- ENUMS
-- =====================================================================
create type papel_usuario   as enum ('comprador', 'diretor', 'admin');
create type status_agente   as enum ('ok', 'atencao', 'erro', 'rodando', 'inativo');
create type status_execucao as enum ('rodando', 'sucesso', 'parcial', 'erro');
create type status_produto  as enum ('pendente', 'ciente', 'expirado', 'resolvido');
create type motivo_atribuicao as enum ('ok', 'secao_inexistente', 'sem_comprador_valido', 'secao_invalida');
create type papel_atribuicao  as enum ('principal', 'secundario', 'terciario');
create type motivo_margem as enum (
  'vencimento',
  'estoque_parado',
  'descontinuidade',
  'erro_cadastro',
  'estrategia_comercial',
  'outro'
);
create type canal_notif as enum ('email', 'whatsapp', 'teams', 'telegram');

-- =====================================================================
-- NÚCLEO DA PLATAFORMA
-- =====================================================================

-- Agentes registrados (margem, vencimento, ruptura, ...)
create table if not exists agentes (
  id                      uuid primary key default uuid_generate_v4(),
  slug                    text not null unique,                    -- "margem"
  nome                    text not null,                            -- "Margem Negativa"
  descricao_curta         text,                                     -- 1 linha p/ card
  info_md                 text,                                     -- descrição completa (modal)
  icone                   text,                                     -- nome de ícone lucide-react
  cor                     text default '#0EA5E9',                   -- hex p/ destaque do card
  ativo                   boolean not null default true,

  ultima_execucao_at      timestamptz,
  ultima_execucao_status  status_execucao,
  pendentes_total         integer not null default 0,
  threshold_atencao       integer not null default 20,              -- pendentes >= => status 'atencao'

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create index idx_agentes_slug on agentes(slug);

-- Usuários (compradores, diretor, admin)
create table if not exists usuarios (
  id              uuid primary key default uuid_generate_v4(),
  nome            text not null unique,
  email           text unique,
  whatsapp        text,
  papel           papel_usuario not null default 'comprador',
  ativo           boolean not null default true,
  firebase_uid    text unique,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_usuarios_email on usuarios(email);
create index idx_usuarios_firebase_uid on usuarios(firebase_uid);

-- Vínculo N:N agente <-> usuário (granularidade futura)
create table if not exists agente_usuario (
  agente_id        uuid not null references agentes(id) on delete cascade,
  usuario_id       uuid not null references usuarios(id) on delete cascade,
  papel_no_agente  text,                                            -- opcional, ex.: "comprador", "observador"
  created_at       timestamptz not null default now(),
  primary key (agente_id, usuario_id)
);

-- Execuções (sync, jobs, runs manuais) de QUALQUER agente
create table if not exists agente_execucoes (
  id              uuid primary key default uuid_generate_v4(),
  agente_id       uuid not null references agentes(id) on delete cascade,
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  status          status_execucao not null default 'rodando',
  duracao_ms      integer,
  erro            text,
  metricas        jsonb not null default '{}'::jsonb,                -- campos livres por agente
  origem          text                                                -- 'cron' | 'manual' | 'n8n'
);

create index idx_agente_execucoes_agente on agente_execucoes(agente_id, started_at desc);

-- Logs de notificações enviadas pelo n8n (qualquer agente)
create table if not exists notificacoes_log (
  id              uuid primary key default uuid_generate_v4(),
  agente_id       uuid not null references agentes(id) on delete cascade,
  destinatario_id uuid references usuarios(id),
  tipo            text not null,                  -- "resumo_diario_comprador" | "resumo_diretor" | etc.
  canal           canal_notif not null,
  destino         text not null,
  payload         jsonb,
  enviado_em      timestamptz not null default now(),
  sucesso         boolean not null,
  erro            text
);

create index idx_notif_agente on notificacoes_log(agente_id, enviado_em desc);

-- =====================================================================
-- AGENTE: margem
-- =====================================================================

create table if not exists margem_produtos (
  id                    uuid primary key default uuid_generate_v4(),

  filial                text not null,                       -- "300 - ELETRO BRASIL LTDA"
  codigo_produto        text not null,                       -- "505646"
  descricao_produto     text not null,

  setor                 text,
  departamento          text,
  secao                 text,                                 -- string crua da API
  chave_secao           text,                                 -- normalizada p/ casar com Firestore
  categoria             text,

  vlr_venda             numeric(12,2),
  custo_medio           numeric(12,2),
  vlr_cong_varejo       numeric(12,2),
  vlr_promocao          numeric(12,2),
  dt_fim_promocao       date,
  promocao_flag         text,
  qtd_estoque           numeric(12,3),
  fornecedor            text,
  ult_entrada           date,
  dias_venda            numeric(8,2),
  margem_negativa       numeric(8,2) not null,

  status                status_produto not null default 'pendente',
  motivo_atribuicao     motivo_atribuicao not null default 'ok',

  -- Ciência vigente (denormalizado para consultas rápidas; histórico em margem_ciencias)
  motivo                motivo_margem,
  observacao            text,
  data_fim_ciencia      date,
  ciencia_por_id        uuid references usuarios(id),
  checked_at            timestamptz,

  primeira_deteccao     timestamptz not null default now(),
  ultima_deteccao       timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  constraint uq_margem_produto unique (filial, codigo_produto)
);

create index idx_margem_produtos_status on margem_produtos(status);
create index idx_margem_produtos_secao on margem_produtos(chave_secao);
create index idx_margem_produtos_data_fim on margem_produtos(data_fim_ciencia);

-- N:N produto <-> comprador (regra: todos atuam, primeiro que ver resolve)
create table if not exists margem_produto_compradores (
  produto_id          uuid not null references margem_produtos(id) on delete cascade,
  usuario_id          uuid not null references usuarios(id) on delete cascade,
  papel_atribuicao    papel_atribuicao not null,
  created_at          timestamptz not null default now(),
  primary key (produto_id, usuario_id)
);

create index idx_margem_pc_usuario on margem_produto_compradores(usuario_id);
create index idx_margem_pc_produto on margem_produto_compradores(produto_id);

-- Histórico de ciências (auditoria)
create table if not exists margem_ciencias (
  id                  uuid primary key default uuid_generate_v4(),
  produto_id          uuid not null references margem_produtos(id) on delete cascade,
  usuario_id          uuid not null references usuarios(id),
  motivo              motivo_margem not null,
  observacao          text not null,
  data_fim_ciencia    date not null,
  vlr_venda_no_momento numeric(12,2),
  margem_no_momento   numeric(8,2),
  created_at          timestamptz not null default now()
);

create index idx_margem_ciencias_produto on margem_ciencias(produto_id, created_at desc);
create index idx_margem_ciencias_usuario on margem_ciencias(usuario_id, created_at desc);

-- =====================================================================
-- TRIGGERS — updated_at automático
-- =====================================================================
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger trg_agentes_updated
  before update on agentes
  for each row execute function set_updated_at();

create trigger trg_usuarios_updated
  before update on usuarios
  for each row execute function set_updated_at();

create trigger trg_margem_produtos_updated
  before update on margem_produtos
  for each row execute function set_updated_at();

-- =====================================================================
-- VIEWS de consolidação
-- =====================================================================

-- Resumo por comprador (considera N:N)
create or replace view vw_margem_resumo_por_comprador as
select
  u.id    as usuario_id,
  u.nome  as usuario_nome,
  u.email as usuario_email,
  count(*)                                                                as total,
  count(*) filter (where p.status = 'pendente')                           as pendentes,
  count(*) filter (where p.status = 'ciente')                             as cientes,
  count(*) filter (where p.status = 'expirado')                           as expirados,
  coalesce(sum(p.qtd_estoque) filter (where p.status = 'pendente'), 0)    as estoque_pendente,
  coalesce(min(p.margem_negativa), 0)                                     as pior_margem
from usuarios u
join margem_produto_compradores mc on mc.usuario_id = u.id
join margem_produtos p             on p.id          = mc.produto_id
where u.papel = 'comprador' and u.ativo = true and p.status <> 'resolvido'
group by u.id, u.nome, u.email
order by pendentes desc;

-- Seções com problema de atribuição (visão do diretor/admin)
create or replace view vw_margem_secoes_problematicas as
select
  chave_secao,
  motivo_atribuicao,
  count(*) as total_produtos
from margem_produtos
where motivo_atribuicao <> 'ok'
group by chave_secao, motivo_atribuicao
order by total_produtos desc;

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table agentes                      enable row level security;
alter table usuarios                     enable row level security;
alter table agente_usuario               enable row level security;
alter table agente_execucoes             enable row level security;
alter table notificacoes_log             enable row level security;
alter table margem_produtos              enable row level security;
alter table margem_produto_compradores   enable row level security;
alter table margem_ciencias              enable row level security;

-- Helpers — extraem informações do JWT de quem está logado
create or replace function current_usuario_id() returns uuid
language sql stable as $$
  select id from usuarios
   where lower(email) = lower((auth.jwt() ->> 'email'))
   limit 1;
$$;

create or replace function current_usuario_papel() returns papel_usuario
language sql stable as $$
  select papel from usuarios
   where lower(email) = lower((auth.jwt() ->> 'email'))
   limit 1;
$$;

-- Agentes: todos os usuários autenticados podem listar (alimenta dashboard)
create policy agentes_select_all on agentes
  for select using (auth.role() = 'authenticated' or current_usuario_papel() in ('comprador','diretor','admin'));

-- Usuários: cada um lê o próprio cadastro; diretor/admin leem todos
create policy usuarios_select_self on usuarios
  for select using (
    lower(email) = lower((auth.jwt() ->> 'email'))
    or current_usuario_papel() in ('diretor', 'admin')
  );

-- agente_usuario: usuário lê os seus vínculos; diretor/admin tudo
create policy au_select_self on agente_usuario
  for select using (
    usuario_id = current_usuario_id()
    or current_usuario_papel() in ('diretor', 'admin')
  );

-- Execuções: leitura para diretor/admin (e service_role, que ignora RLS)
create policy execs_select_admin on agente_execucoes
  for select using (current_usuario_papel() in ('diretor', 'admin'));

create policy notif_select_admin on notificacoes_log
  for select using (current_usuario_papel() in ('diretor', 'admin'));

-- Produtos margem: comprador vê os que estão atribuídos a ele (via N:N); diretor/admin tudo
create policy margem_produtos_select on margem_produtos
  for select using (
    current_usuario_papel() in ('diretor', 'admin')
    or exists (
      select 1 from margem_produto_compradores mc
      where mc.produto_id = margem_produtos.id
        and mc.usuario_id = current_usuario_id()
    )
  );

-- Update do produto: comprador atribuído ao produto (qualquer um da N:N) pode atualizar
create policy margem_produtos_update on margem_produtos
  for update using (
    exists (
      select 1 from margem_produto_compradores mc
      where mc.produto_id = margem_produtos.id
        and mc.usuario_id = current_usuario_id()
    )
  );

-- Atribuições: comprador vê as suas; diretor/admin tudo
create policy margem_pc_select on margem_produto_compradores
  for select using (
    usuario_id = current_usuario_id()
    or current_usuario_papel() in ('diretor', 'admin')
  );

-- Ciências: comprador insere/lê suas linhas; diretor/admin lê tudo
create policy margem_ciencias_insert_self on margem_ciencias
  for insert with check (usuario_id = current_usuario_id());

create policy margem_ciencias_select on margem_ciencias
  for select using (
    usuario_id = current_usuario_id()
    or current_usuario_papel() in ('diretor', 'admin')
  );

-- =====================================================================
-- SEED — agente margem + lista oficial de compradores
-- =====================================================================

insert into agentes (slug, nome, descricao_curta, info_md, icone, cor)
values (
  'margem',
  'Margem Negativa',
  'Detecta produtos com margem negativa e cobra ciência dos compradores responsáveis.',
  '## O que faz

Consulta a API local de margem a cada hora, identifica produtos com margem de lucro negativa, descobre o(s) comprador(es) responsável(eis) consultando o Firebase, e disponibiliza a lista para que cada comprador dê ciência (motivo + observação + data fim do preço).

## Atribuições

- Sincronização horária com a API local
- Resumo diário por e-mail e WhatsApp aos compradores (08:00 seg-sáb)
- Resumo consolidado ao diretor (08:30 seg-sáb)
- Expiração automática de ciências vencidas

## Fontes de dados

- API local `http://192.168.118.50:3001/api/margem`
- Firestore `CONFIG/1-SECAO`
- Banco Supabase

## Frequência

- Sync: a cada 1 hora
- Resumos: diários (seg-sáb)
- Expiração: 00:00 diário
',
  'TrendingDown',
  '#DC2626'
)
on conflict (slug) do nothing;

insert into usuarios (nome, papel) values
  ('DEUSELINA FERREIRA', 'comprador'),
  ('NAYANE',             'comprador'),
  ('IRIS LIRA',          'comprador'),
  ('PAULO RODRIGUES',    'comprador'),
  ('SILVANIA RODRIGUES', 'comprador'),
  ('DANIELE NUNES',      'comprador'),
  ('NAYLA MARIANA',      'comprador'),
  ('MARIA CLARA',        'comprador'),
  ('TEREZA OLIVEIRA',    'comprador'),
  ('CLEILDE FONSECA',    'comprador'),
  ('PADARIA',            'comprador')
on conflict (nome) do nothing;

-- Vincular todos os compradores ao agente margem
insert into agente_usuario (agente_id, usuario_id, papel_no_agente)
select a.id, u.id, 'comprador'
from agentes a, usuarios u
where a.slug = 'margem' and u.papel = 'comprador'
on conflict do nothing;

-- Lembrete:
-- Cadastrar diretor manualmente:
--   insert into usuarios (nome, email, papel) values ('NOME DIRETOR', 'diretor@empresa.com', 'diretor');
--   insert into agente_usuario (agente_id, usuario_id) select a.id, u.id from agentes a, usuarios u where a.slug='margem' and u.email='diretor@empresa.com';
