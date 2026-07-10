-- =====================================================================
-- Correções dos advisors (security + performance)
-- =====================================================================

-- 1) Recriar views como SECURITY INVOKER (para respeitar RLS de quem consulta)
drop view if exists vw_margem_resumo_por_comprador;
drop view if exists vw_margem_secoes_problematicas;

create view vw_margem_resumo_por_comprador
with (security_invoker = true) as
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

create view vw_margem_secoes_problematicas
with (security_invoker = true) as
select
  chave_secao,
  motivo_atribuicao,
  count(*) as total_produtos
from margem_produtos
where motivo_atribuicao <> 'ok'
group by chave_secao, motivo_atribuicao
order by total_produtos desc;

-- 2) search_path imutável nas funções (boa prática de segurança)
alter function set_updated_at()       set search_path = public, pg_catalog;
alter function current_usuario_id()   set search_path = public, pg_catalog;
alter function current_usuario_papel() set search_path = public, pg_catalog;

-- 3) Índices para FKs (performance)
create index if not exists idx_agente_usuario_usuario          on agente_usuario(usuario_id);
create index if not exists idx_margem_produtos_ciencia_por     on margem_produtos(ciencia_por_id);
create index if not exists idx_notificacoes_log_destinatario   on notificacoes_log(destinatario_id);

-- 4) Reescrever policies que reavaliam auth.* por linha
drop policy if exists agentes_select_all on agentes;
create policy agentes_select_all on agentes
  for select using (
    (select auth.role()) = 'authenticated'
    or current_usuario_papel() in ('comprador','diretor','admin')
  );

drop policy if exists usuarios_select_self on usuarios;
create policy usuarios_select_self on usuarios
  for select using (
    lower(email) = lower((select auth.jwt() ->> 'email'))
    or current_usuario_papel() in ('diretor', 'admin')
  );

-- Os helpers current_usuario_id() e current_usuario_papel() já internalizam a chamada,
-- então as policies que usam essas funções não precisam de mudança.
