# Decisão de design — Agentes de monitoramento de estoque

**Data:** 2026-05-22
**Status:** Aprovado, aguardando implementação do "Ruptura Crítica"

## Contexto

O campo `QTDDIASMOV` (mapeado para `dias_venda` no banco) representa **a
quantidade de dias em que o produto vendeu nos últimos 30 dias**. Quatro
bandas de comportamento foram definidas:

| Banda | dias_venda | Significado comercial | Ação esperada |
|---|---|---|---|
| 1 — Constante | 16 a 31 | Giro constante. Nunca deve faltar para não derrubar a média. | Garantir reposição / monitorar tendência |
| 2 — Médio | 10 a 15 | Acompanhar para não cair para o nível abaixo; potencial de subir. | Monitorar, identificar oportunidade |
| 3 — Baixo | 1 a 9 | Risco de validade / candidato a descontinuidade. | Promoção, baixa, ou descontinuar |
| 4 — Crítico | 0 | Sem venda nos últimos 30 dias. | Investigar ruptura, cadastro, fim de vida |

A pergunta: representar isso como 4 agentes separados na interface ou 1?

## Decisão

**Manter 1 agente "Supervisor de Estoque"** (já criado) com categorização
**interna** por banda + **criar 1 agente novo "Ruptura Crítica"** dedicado
apenas à banda 4 (dias_venda = 0).

Total: **2 agentes**, não 4.

## Por quê

1. **Bandas 1–3 são um continuum**, não categorias estanques. O valor está
   nas **transições** ("caiu de Médio para Baixo", "subiu de Baixo para
   Médio"). Quatro agentes separados não conversam entre si; um agente
   único enxerga a transição.

2. **Contador "Pendentes" só faz sentido como fila de ação.** Se o card
   da home mostra "quantos produtos estão na banda X", isso é relatório,
   não tarefa. O contrato mental da plataforma hoje é "agente = fila de
   coisas pra eu agir" (margem, comparativo313). Manter esse contrato.

3. **Crítico (banda 4) tem ação e cadência diferentes** — não é
   "monitorar", é "investigar agora". Stakeholders também: comprador +
   gerente da filial em conjunto. Por isso ele é separado.

4. **Padrão visual da plataforma já existe:** Metas (informacional /
   tendência) + Margem Negativa (fila de ação). Replicar isso aqui:
   Supervisor de Estoque (informacional / tendência por banda) +
   Ruptura Crítica (fila de ação).

## Como ficará na interface

**Card "Supervisor de Estoque"** (já existe, ajustar tela interna):
- Detector de variações ≥ 20% vs média 7d em media_dia, dias_venda, giro.
- Tela interna com 4 abas — Constante / Médio / Baixo / Crítico — cada
  uma com a lista de produtos atualmente na banda e os que **transitaram**
  para a banda hoje.
- Notificações cobrem variações e transições, não a fotografia inteira.

**Card "Ruptura Crítica"** (novo):
- Dispara quando produto entra na banda dias_venda = 0.
- Padrão fila de trabalho (igual margem_produtos): cada produto vira uma
  linha pendente; comprador dá ciência justificando motivo.
- Motivos possíveis (enum candidato): `ruptura_real`, `descontinuidade`,
  `sazonal`, `erro_cadastro`, `fim_de_vida`, `outro`.
- Cadência: dispara no momento que o produto entra na banda, não em cron.
- Pendente = quantidade de produtos em estado crítico aguardando ciência.

## Próximos passos pendentes

1. (Anterior) Retomar discussão sobre as **importações por planilha**
   (Etapa 1) — usuário pediu para voltar nisso.
2. Detalhar o desenho do agente **Ruptura Crítica**:
   - Tabelas / enums / views
   - Regras de entrada e saída da banda
   - Mensagens por papel
   - Workflow n8n (entrada na banda → notificação)
   - Reaproveitar atribuição comprador↔seção via margem_produto_compradores

## Notas

- Workflows JSON do n8n estão em
  `D:\Developer\cowork\Automatizar buscas na API margem\n8n\workflows`.
- Schema atual do Supabase (projeto `agentes`) já suporta as 4 bandas via
  `dias_venda` em `supervisor_estoque_snapshots`. Não precisa migration
  pra começar — só para "Ruptura Crítica", que vai precisar de tabelas
  próprias seguindo o padrão margem.
