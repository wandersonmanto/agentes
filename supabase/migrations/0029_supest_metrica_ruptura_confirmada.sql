-- 0029 — Acrescenta 'ruptura_confirmada' ao enum supest_metrica
ALTER TYPE public.supest_metrica ADD VALUE IF NOT EXISTS 'ruptura_confirmada';
