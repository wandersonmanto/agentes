-- =====================================================================
-- Performance do cruzamento estoque × vendas (aplicado ao vivo; aqui p/
-- reprodutibilidade num banco novo).
--
-- Contexto: com a base crescida (~500k vendas, ~2,7M estoque), a tela de
-- cobertura passou a estourar o timeout (8s do role authenticated/service).
-- =====================================================================

-- 1) Índice parcial coberto: dias_disponiveis conta direto no range, index-only.
create index if not exists idx_estoque_disp_cover
  on estoque_diario (filial_cod, data, produto_cod)
  where coalesce(disponivel, 0) > 0;

-- 2) Índice (data, filial) — leitura por data+filial (foto do dia por loja).
create index if not exists idx_estoque_data_filial
  on estoque_diario (data, filial_cod);

-- 3) Timeout do service_role (usado SÓ pelo backend; a chave nunca vai ao
--    navegador) elevado p/ 30s, para as análises pesadas de estoque. Os
--    roles expostos (anon 3s, authenticated 8s) ficam como estão.
alter role service_role set statement_timeout = '30s';

-- Observação: fn_estoque_cobertura foi reescrita com SQL dinâmico (filtros
-- sargáveis -> uso de índice) e fn_vendas_filtros passou a ler de um cache
-- (vendas_dim_cache). Ver migrations 0048/0051. A função também recebeu:
--   alter function public.fn_estoque_cobertura(date,date,date,int,int,int,jsonb,int)
--     set work_mem = '128MB' set statement_timeout = '120000';
