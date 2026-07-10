-- =====================================================================
-- Decisões 2026-05-06 com o usuário:
--   - email passa a se chamar email_login (deixa explícito o uso para auth)
--   - whatsapp sai do Supabase: a fonte de verdade é Firestore users/{email}
--   - email_notificacao NÃO existe no Supabase: também vive no Firestore
--   - Flag de notificação por agente: Firestore users/{email}.agentes (array de slugs)
-- =====================================================================

alter table usuarios rename column email to email_login;
alter table usuarios drop  column whatsapp;

drop index if exists idx_usuarios_email;
create index if not exists idx_usuarios_email_login on usuarios(email_login);

create or replace function current_usuario_id() returns uuid
language sql stable
set search_path = public, pg_catalog
as $$
  select id from usuarios
   where lower(email_login) = lower(((select auth.jwt()) ->> 'email'))
   limit 1;
$$;

create or replace function current_usuario_papel() returns papel_usuario
language sql stable
set search_path = public, pg_catalog
as $$
  select papel from usuarios
   where lower(email_login) = lower(((select auth.jwt()) ->> 'email'))
   limit 1;
$$;

drop policy if exists usuarios_select_self on usuarios;
create policy usuarios_select_self on usuarios
  for select using (
    lower(email_login) = lower(((select auth.jwt()) ->> 'email'))
    or current_usuario_papel() in ('diretor', 'admin')
  );
