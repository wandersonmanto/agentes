-- Postgres exige que `alter type ... add value` rode FORA de transação.
-- Por isso essa mudança fica em migration própria.
alter type papel_usuario add value if not exists 'supervisor';
