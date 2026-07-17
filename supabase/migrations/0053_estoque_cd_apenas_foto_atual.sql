-- =====================================================================
-- CDs 87 e 313 não vendem: só interessam pela FOTO ATUAL de estoque (para
-- o drawer "repor a ruptura de uma loja a partir da CD"). Não faz sentido
-- guardar histórico diário deles. Esta função mantém apenas o snapshot mais
-- recente das CDs. É chamada ao fim de cada carga (ingest-estoque.mjs) e a
-- importação já só grava as CDs no dia mais recente da carga.
--
-- Invariante: o arquivo diário de estoque traz lojas E CDs na MESMA data,
-- então a foto da CD sempre coincide com a última foto das lojas — é isso
-- que faz a CD aparecer no cruzamento (fn_estoque_cobertura em e.data = foto).
-- =====================================================================
create or replace function public.fn_estoque_manter_cd_atual()
returns int language plpgsql as $$
declare v_del int := 0; v_max date;
begin
  select max(data) into v_max from estoque_diario where filial_cod in ('87','313');
  if v_max is null then return 0; end if;
  delete from estoque_diario where filial_cod in ('87','313') and data <> v_max;
  get diagnostics v_del = row_count;
  return v_del;
end$$;
