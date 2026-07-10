-- ============================================================================
-- 0021 — Schema de validade média por seção + risco de obsolescência
-- ============================================================================
-- Política da loja (configurável): "não aceitamos produto com mais de X% da
-- validade já gasta no recebimento". Para X = 10%, um produto com 120 dias
-- de validade só pode ter no máximo 12 dias da fabricação quando chega na
-- loja — portanto, a validade efetiva no recebimento é 120 × 0,9 = 108 dias.
--
-- A partir da `ultima_entrada` que vem em cada snapshot, calculamos quanto
-- da validade efetiva já foi consumida desde que o lote chegou, e cruzamos
-- com `dias_ate_ruptura` (cobertura projetada na cadência atual). Excesso
-- de cobertura sobre a validade restante = risco de obsolescência.
-- ============================================================================
DO $$ BEGIN
  CREATE TYPE public.supest_categoria_perecibilidade AS ENUM
    ('perecivel', 'resfriado', 'congelado', 'nao_perecivel');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.supest_nivel_risco AS ENUM
    ('atencao', 'risco', 'critico', 'perda_provavel');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TYPE public.supest_metrica ADD VALUE IF NOT EXISTS 'obsolescencia';

ALTER TABLE public.supervisor_estoque_alertas
  ADD COLUMN IF NOT EXISTS nivel_risco public.supest_nivel_risco;

CREATE TABLE IF NOT EXISTS public.supervisor_estoque_config (
  id boolean PRIMARY KEY DEFAULT true,
  pct_max_validade_no_recebimento numeric(4,2) NOT NULL DEFAULT 0.10
    CHECK (pct_max_validade_no_recebimento >= 0 AND pct_max_validade_no_recebimento < 1),
  atualizado_por uuid,
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supest_config_singleton CHECK (id = true)
);

INSERT INTO public.supervisor_estoque_config (id, pct_max_validade_no_recebimento)
VALUES (true, 0.10)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.supervisor_estoque_config_categoria (
  categoria public.supest_categoria_perecibilidade PRIMARY KEY,
  pct_atencao numeric(4,2) NOT NULL CHECK (pct_atencao > 0),
  pct_risco   numeric(4,2) NOT NULL CHECK (pct_risco   > 0),
  pct_critico numeric(4,2) NOT NULL CHECK (pct_critico > 0),
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT supest_cfgcat_ordem CHECK (pct_atencao < pct_risco AND pct_risco <= pct_critico)
);

INSERT INTO public.supervisor_estoque_config_categoria
  (categoria, pct_atencao, pct_risco, pct_critico)
VALUES
  ('perecivel',     0.60, 0.80, 1.00),
  ('resfriado',     0.50, 0.70, 0.90),
  ('congelado',     0.65, 0.85, 1.00),
  ('nao_perecivel', 0.80, 0.95, 1.10)
ON CONFLICT (categoria) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.supervisor_estoque_secao_validade (
  chave_secao         text PRIMARY KEY,
  descricao           text,
  departamento        text,
  validade_media_dias integer
    CHECK (validade_media_dias IS NULL OR validade_media_dias > 0),
  categoria           public.supest_categoria_perecibilidade,
  pct_atencao numeric(4,2),
  pct_risco   numeric(4,2),
  pct_critico numeric(4,2),
  observacoes    text,
  atualizado_por uuid,
  atualizado_em  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_supest_secao_validade_categoria
  ON public.supervisor_estoque_secao_validade (categoria);

INSERT INTO public.supervisor_estoque_secao_validade
  (chave_secao, descricao, departamento, validade_media_dias, categoria, observacoes)
VALUES
  ('92 - ACHOC LIQUIDOS',            '92 - ACHOC LIQUIDOS',            '15 - LONGA VIDAS', 120, 'perecivel', 'Cadastro inicial'),
  ('11 - BISCOITOS',                 '11 - BISCOITOS',                 '1 - MERCEARIA',    180, 'perecivel', 'Cadastro inicial'),
  ('1 - LEITES E ALIMENTOS INFANTIS','1 - LEITES E ALIMENTOS INFANTIS','1 - MERCEARIA',    210, 'perecivel', 'Cadastro inicial')
ON CONFLICT (chave_secao) DO UPDATE SET
  validade_media_dias = EXCLUDED.validade_media_dias,
  categoria           = EXCLUDED.categoria,
  observacoes         = EXCLUDED.observacoes,
  atualizado_em       = now();
