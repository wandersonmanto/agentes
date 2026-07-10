-- =====================================================================
-- Ajuste fino: a subquery na 0002 ficou (select auth.jwt() ->> 'email')
-- mas o linter só reconhece o padrão (select auth.<fn>()) seguido do
-- operador. Reescrita aqui.
-- =====================================================================

drop policy if exists usuarios_select_self on usuarios;
create policy usuarios_select_self on usuarios
  for select using (
    lower(email) = lower(((select auth.jwt()) ->> 'email'))
    or current_usuario_papel() in ('diretor', 'admin')
  );
