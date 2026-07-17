-- =====================================================================
-- Índices enxutos na estoque_diario — o gargalo dos INSERTs (derivação e
-- carga) era o EXCESSO de índices (8), incluindo a PK de UUID aleatório e
-- índices com produto_cod na frente (chave aleatória) -> I/O aleatório
-- massivo numa instância pequena. Reduzido a 3 índices essenciais.
--
-- Mantidos:
--   estoque_diario_nat_uk  (data, filial_cod, produto_cod)  -- chave natural
--     -> conflito idempotente + range por data; 'data' líder = inserts do
--        dia ficam contíguos no índice (rápido).
--   idx_estoque_disp_cover (filial_cod, data, produto_cod) WHERE disp>0
--     -> "dias disponíveis" na cobertura (index-only).
--   idx_estoque_produto_data (produto_cod, data)
--     -> consultas por produto (drawer, custo fallback).
--
-- Removidos: PK id (0 leituras), idx_estoque_prod_filial_data,
--   idx_estoque_data_carga, idx_estoque_data_origem, idx_estoque_data_filial.
-- =====================================================================

-- PK id (uuid aleatório): nunca usada em leitura, só custo de insert.
alter table estoque_diario drop constraint if exists estoque_diario_pkey;
-- réplica lógica passa a se identificar pela chave natural (não havia PK).
alter table estoque_diario replica identity using index estoque_diario_nat_uk;

drop index if exists idx_estoque_prod_filial_data;
drop index if exists idx_estoque_data_carga;
drop index if exists idx_estoque_data_origem;
drop index if exists idx_estoque_data_filial;

-- garante os 3 essenciais
create unique index if not exists estoque_diario_nat_uk
  on estoque_diario (data, filial_cod, produto_cod);
create index if not exists idx_estoque_disp_cover
  on estoque_diario (filial_cod, data, produto_cod) where coalesce(disponivel,0) > 0;
create index if not exists idx_estoque_produto_data
  on estoque_diario (produto_cod, data);
