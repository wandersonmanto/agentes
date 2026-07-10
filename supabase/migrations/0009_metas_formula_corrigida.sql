-- =====================================================================
-- Agente metas — correção da fórmula de tendência (validada 2026-05-18).
--
-- Mudança: `dias_corte_tendencia` passou a ser interpretado como
-- *offset* (dias do mês a IGNORAR), não como "dias acumulados". O
-- denominador da projeção é (dia_atual - dias_corte_tendencia).
--
-- Fórmula que vigora:
--   diasComputados   = dia_atual_do_mes - dias_corte_tendencia
--   tendencia        = (venda / diasComputados) * dias_tendencia
--
-- Não há mudança de schema — só atualizamos a descrição apresentada no
-- modal "(i)" do dashboard. Snapshots antigos (gerados com a fórmula
-- errada) podem ser regerados rodando o sync novamente; a chave
-- (snapshot_date, filial_cod, nivel, cod) é única, então um novo sync
-- no mesmo dia sobrescreve.
-- =====================================================================

update agentes
   set info_md = '## O que faz

Lê o documento mensal de metas no Firestore (`METAS-SUPERMERCADO/{ano}-{mês}-{filial}`), calcula a tendência projetada para o fim do mês a partir do realizado parcial e identifica filiais e quebras internas (setor / departamento / seção) que estão tendenciando a NÃO bater a meta de venda.

## Fórmula da tendência

```
diasComputados   = dia_atual_do_mes - dias_corte_tendencia    (dias efetivos do realizado)
tendencia        = (venda / diasComputados) * dias_tendencia
desvio_meta      = venda - meta_venda
desvio_tendencia = tendencia - meta_venda
percent          = (venda / meta_venda) * 100
venda_ideal_dia  = meta_venda / dias_tendencia
em_risco         = tendencia < meta_venda
```

Exemplo: loja 305 em 18/maio com venda parcial R$ 2.794.846,58, meta R$ 5.114.843,13, `dias_corte_tendencia=1` e `dias_tendencia=31` → `diasComputados = 18 - 1 = 17` → `tendencia = (2.794.846,58 / 17) × 31 = R$ 5.096.484,94`. Como a tendência fica abaixo da meta, a filial é marcada `em_risco`.

## Atribuições

- Sincronização diária com o Firestore (1 leitura por filial)
- Resumo diário por WhatsApp ao comprador, listando suas filiais em risco
- Cada comprador recebe APENAS as filiais cadastradas em `users/{email}.loja` (Firestore)

## Fontes de dados

- Firestore `METAS-SUPERMERCADO/{ano}-{mes_extenso}-{filial}` (ex.: `2026-maio-305`)
- Firestore `users/{email}` (atributo `loja`: array de strings, ou `"todas"`)
- Banco Supabase (`metas_snapshots`)

## Frequência

- Sync: a cada 24h
- Resumo comprador: 08:00 seg-sáb
'
 where slug = 'metas';
