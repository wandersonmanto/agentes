-- =====================================================================
-- Decisões 2026-05-06:
--   - Supervisor (IRIS LIRA) tem visibilidade igual ao diretor no agregado.
--   - PAULO e SILVANIA viram diretor (atuam como compradores também,
--     mas a função real é diretoria).
--   - NAYLA MARIANA e PADARIA são histórico — desativados (ativo=false).
--   - View renomeada: vw_margem_resumo_por_comprador → _por_responsavel.
--     Sem filtro de papel: quem está na N:N entra no agregado.
-- =====================================================================

-- (1) Reescrever policies para incluir supervisor
drop policy if exists usuarios_select_self on usuarios;
create policy usuarios_select_self on usuarios
  for select using (
    lower(email_login) = lower(((select auth.jwt()) ->> 'email'))
    or current_usuario_papel() in ('diretor', 'admin', 'supervisor')
  );

drop policy if exists au_select_self on agente_usuario;
create policy au_select_self on agente_usuario
  for select using (
    usuario_id = current_usuario_id()
    or current_usuario_papel() in ('diretor', 'admin', 'supervisor')
  );

drop policy if exists execs_select_admin on agente_execucoes;
create policy execs_select_admin on agente_execucoes
  for select using (current_usuario_papel() in ('diretor', 'admin', 'supervisor'));

drop policy if exists notif_select_admin on notificacoes_log;
create policy notif_select_admin on notificacoes_log
  for select using (current_usuario_papel() in ('diretor', 'admin', 'supervisor'));

drop policy if exists margem_produtos_select on margem_produtos;
create policy margem_produtos_select on margem_produtos
  for select using (
    current_usuario_papel() in ('diretor', 'admin', 'supervisor')
    or exists (
      select 1 from margem_produto_compradores mc
      where mc.produto_id = margem_produtos.id
        and mc.usuario_id = current_usuario_id()
    )
  );

drop policy if exists margem_pc_select on margem_produto_compradores;
create policy margem_pc_select on margem_produto_compradores
  for select using (
    usuario_id = current_usuario_id()
    or current_usuario_papel() in ('diretor', 'admin', 'supervisor')
  );

drop policy if exists margem_ciencias_select on margem_ciencias;
create policy margem_ciencias_select on margem_ciencias
  for select using (
    usuario_id = current_usuario_id()
    or current_usuario_papel() in ('diretor', 'admin', 'supervisor')
  );

-- (2) Renomear view para _por_responsavel (sem filtro de papel)
drop view if exists vw_margem_resumo_por_comprador;

create view vw_margem_resumo_por_responsavel
with (security_invoker = true) as
select
  u.id          as usuario_id,
  u.nome        as usuario_nome,
  u.email_login as usuario_email_login,
  u.papel       as usuario_papel,
  count(*)                                                                as total,
  count(*) filter (where p.status = 'pendente')                           as pendentes,
  count(*) filter (where p.status = 'ciente')                             as cientes,
  count(*) filter (where p.status = 'expirado')                           as expirados,
  coalesce(sum(p.qtd_estoque) filter (where p.status = 'pendente'), 0)    as estoque_pendente,
  coalesce(min(p.margem_negativa), 0)                                     as pior_margem
from usuarios u
join margem_produto_compradores mc on mc.usuario_id = u.id
join margem_produtos p             on p.id          = mc.produto_id
where u.ativo = true and p.status <> 'resolvido'
group by u.id, u.nome, u.email_login, u.papel
order by pendentes desc;

-- (3) Aplicar papéis novos
update usuarios set papel = 'diretor'
 where nome in ('PAULO RODRIGUES','SILVANIA RODRIGUES');

update usuarios set papel = 'supervisor'
 where nome = 'IRIS LIRA';

-- (4) Desativar oficiais históricos
update usuarios set ativo = false
 where nome in ('NAYLA MARIANA','PADARIA');

-- (5) Garante que PADARIA exista mesmo se algum drift removeu durante iterações
insert into usuarios (nome, papel, ativo)
values ('PADARIA', 'comprador', false)
on conflict (nome) do update set ativo = excluded.ativo;
