-- =====================================================================
-- Filtra produtos cujo dt_fim_promocao (= "expira_loja" na API local)
-- já passou. Mantém os com data null (sem fim de promoção) e os ainda
-- vigentes. Aplica nas duas views consumidas por backend/n8n.
-- =====================================================================

drop view if exists vw_margem_resumo_por_responsavel;
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
where u.ativo = true
  and p.status <> 'resolvido'
  and (p.dt_fim_promocao is null or p.dt_fim_promocao >= current_date)
group by u.id, u.nome, u.email_login, u.papel
order by pendentes desc;

drop view if exists vw_margem_secoes_problematicas;
create view vw_margem_secoes_problematicas
with (security_invoker = true) as
select
  chave_secao,
  motivo_atribuicao,
  count(*) as total_produtos
from margem_produtos
where motivo_atribuicao <> 'ok'
  and status = 'pendente'
  and (dt_fim_promocao is null or dt_fim_promocao >= current_date)
group by chave_secao, motivo_atribuicao
order by total_produtos desc;
