/**
 * Job de sincronização do agente margem.
 *
 * Fluxo:
 *   1. Cria linha em agente_execucoes (status='rodando').
 *   2. Busca array da API local.
 *   3. Filtra produtos com tipo_margem === 'negativa'.
 *   4. Carrega CONFIG/1-SECAO em memória (1 leitura no Firestore).
 *   5. Para cada produto:
 *        - resolve compradores (lista) + motivo
 *        - upsert em margem_produtos (chave (filial, codigo_produto))
 *        - reconcilia margem_produto_compradores (insere novos, remove sumiços)
 *   6. Marca como 'resolvido' produtos que estavam 'pendente' mas não vieram no novo array.
 *   7. Atualiza tabela agentes (ultima_execucao_at, status, pendentes_total).
 *   8. Atualiza agente_execucoes com status final + métricas.
 */
import { firestore } from '../../../services/firebase.service.js';
import { supabase } from '../../../services/supabase.service.js';
import { logger } from '../../../config/logger.js';
import { fetchMargem } from './localApi.service.js';
import {
  loadConfigCache,
  resolveCompradores,
} from './buyerMapper.service.js';
import { parseProduto, parseSecao, parseCurrency, parseDateBR } from '../utils/parseProduct.js';

const SLUG = 'margem';

export async function runSync({ origem = 'manual' } = {}) {
  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();

  // 1. Identifica o agente e abre execução
  const { data: agente, error: errAg } = await supabase
    .from('agentes').select('id').eq('slug', SLUG).single();
  if (errAg || !agente) throw new Error('Agente margem não cadastrado');

  const { data: exec, error: errEx } = await supabase
    .from('agente_execucoes')
    .insert({ agente_id: agente.id, status: 'rodando', origem })
    .select('id').single();
  if (errEx) throw errEx;

  await supabase.from('agentes')
    .update({ ultima_execucao_status: 'rodando' })
    .eq('id', agente.id);

  const metricas = {
    total_api: 0, total_negativos: 0, inseridos: 0, atualizados: 0,
    resolvidos: 0, sem_comprador: 0, secao_inexistente: 0, secao_invalida: 0,
    erros: [],
  };

  try {
    // 2. Busca produtos
    const apiData = await fetchMargem();
    metricas.total_api = apiData.length;
    const negativos = apiData.filter(p => String(p.tipo_margem || '').toLowerCase() === 'negativa');
    metricas.total_negativos = negativos.length;
    logger.info({ total: apiData.length, negativos: negativos.length }, 'API margem consultada');

    // 3. Carrega CONFIG/1-SECAO
    const configCache = await loadConfigCache(firestore);

    // 4. Carrega lista de compradores oficiais (usuarios) p/ FK
    const { data: usuariosLista, error: errU } = await supabase
      .from('usuarios')
      .select('id, nome')
      .eq('papel', 'comprador');
    if (errU) throw errU;
    const userIdByNome = new Map(usuariosLista.map(u => [u.nome.toUpperCase(), u.id]));

    // 5. Loop de upsert
    for (const p of negativos) {
      try {
        const linha = mapApiToRow(p);
        const { compradores, chave, motivo } = resolveCompradores(p, configCache);
        linha.chave_secao = chave;
        linha.motivo_atribuicao = motivo;

        if (motivo === 'sem_comprador_valido') metricas.sem_comprador += 1;
        if (motivo === 'secao_inexistente') metricas.secao_inexistente += 1;
        if (motivo === 'secao_invalida')   metricas.secao_invalida += 1;

        // Upsert do produto (ultima_deteccao já vem como now() em mapApiToRow)
        const { data: prod, error: errProd } = await supabase
          .from('margem_produtos')
          .upsert(linha, { onConflict: 'filial,codigo_produto' })
          .select('id, status')
          .single();
        if (errProd) throw errProd;

        // 6. Reconciliação N:N — só se o produto não está silenciado
        if (prod.status === 'pendente') {
          await reconcileCompradores(prod.id, compradores, userIdByNome);
        }

        // (heurística simples para inseridos vs atualizados: ainda não sabemos sem mais info)
        metricas.atualizados += 1;
      } catch (e) {
        metricas.erros.push({ produto: p.PRODUTO, erro: e.message });
      }
    }

    // 7. Marcar como 'resolvido' produtos que estavam pendentes mas NÃO foram
    //    tocados nesta execução (ultima_deteccao anterior ao início do sync).
    //    Único UPDATE direto no Postgres — sem limite de 1000 nem materialização.
    const { count: countResolvidos, error: errRes } = await supabase
      .from('margem_produtos')
      .update({ status: 'resolvido' }, { count: 'exact' })
      .eq('status', 'pendente')
      .lt('ultima_deteccao', startedAtIso);
    if (errRes) throw errRes;
    metricas.resolvidos = countResolvidos || 0;

    // 8. Atualiza agente — pendentes_total considera só o que ainda está vigente
    const hojeIso = new Date().toISOString().slice(0, 10);
    const { count: pendentesTotal } = await supabase
      .from('margem_produtos')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pendente')
      .or(`dt_fim_promocao.is.null,dt_fim_promocao.gte.${hojeIso}`);

    const finishedAt = new Date();
    await supabase.from('agente_execucoes')
      .update({
        finished_at: finishedAt.toISOString(),
        status: metricas.erros.length ? 'parcial' : 'sucesso',
        duracao_ms: finishedAt - startedAt,
        metricas,
      })
      .eq('id', exec.id);

    await supabase.from('agentes')
      .update({
        ultima_execucao_at: finishedAt.toISOString(),
        ultima_execucao_status: metricas.erros.length ? 'parcial' : 'sucesso',
        pendentes_total: pendentesTotal || 0,
      })
      .eq('id', agente.id);

    return { execId: exec.id, metricas };
  } catch (err) {
    logger.error({ err }, 'Sync margem falhou');
    await supabase.from('agente_execucoes').update({
      finished_at: new Date().toISOString(),
      status: 'erro',
      erro: err.message,
      metricas,
    }).eq('id', exec.id);
    await supabase.from('agentes').update({ ultima_execucao_status: 'erro' }).eq('id', agente.id);
    throw err;
  }
}

// ---------- helpers ----------

function mapApiToRow(p) {
  const { codigo, descricao } = parseProduto(p.PRODUTO);
  return {
    filial:           String(p.FILIAL || '').trim(),
    codigo_produto:   codigo,
    descricao_produto: descricao,
    setor:            (p.SETOR || '').trim() || null,
    departamento:     (p.DEPARTAMENTOPRICE || '').trim() || null,
    secao:            (p.SECAOPRICE || '').trim() || null,
    categoria:        (p.CATEGORIA || '').trim() || null,
    vlr_venda:        parseCurrency(p['VlrVenda R$']),
    custo_medio:      parseCurrency(p['CustoMedio R$']),
    vlr_cong_varejo:  parseCurrency(p['VlrCong.Varejo R$']),
    vlr_promocao:     parseCurrency(p.VlrPromo?.Varejo ?? p['VlrPromo.Varejo']),
    dt_fim_promocao:  parseDateBR(p['DtFimProm.Varejo']),
    promocao_flag:    p.Promocao || null,
    qtd_estoque:      parseCurrency(p.QtdEstoque),
    fornecedor:       (p.FORNECEDOR || '').trim() || null,
    ult_entrada:      parseDateBR(p.ULT_ENTRADA),
    dias_venda:       parseCurrency(p.DIAS_VENDA),
    margem_negativa:  Number(p.margem_negativa),
    ultima_deteccao:  new Date().toISOString(),
  };
}

/**
 * Garante que o conjunto de linhas em margem_produto_compradores reflita
 * exatamente a lista atual de compradores. Insere os faltantes e remove
 * os que sumiram.
 */
async function reconcileCompradores(produtoId, compradores, userIdByNome) {
  const desejados = compradores
    .map(c => ({
      produto_id: produtoId,
      usuario_id: userIdByNome.get(c.nome) || null,
      papel_atribuicao: c.papel,
    }))
    .filter(x => x.usuario_id);

  // Estado atual
  const { data: atuais } = await supabase
    .from('margem_produto_compradores')
    .select('usuario_id, papel_atribuicao')
    .eq('produto_id', produtoId);

  const desejadosKey = new Set(desejados.map(d => d.usuario_id));
  const atuaisKey = new Set((atuais || []).map(a => a.usuario_id));

  // Remover quem saiu
  const remover = (atuais || []).filter(a => !desejadosKey.has(a.usuario_id));
  if (remover.length) {
    await supabase.from('margem_produto_compradores')
      .delete()
      .eq('produto_id', produtoId)
      .in('usuario_id', remover.map(r => r.usuario_id));
  }

  // Inserir/atualizar
  if (desejados.length) {
    await supabase.from('margem_produto_compradores')
      .upsert(desejados, { onConflict: 'produto_id,usuario_id' });
  }
}
