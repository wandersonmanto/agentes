/**
 * Job de sincronização do agente comparativo313.
 *
 * Fluxo:
 *   1. Cria linha em agente_execucoes (status='rodando').
 *   2. Busca array da API local /api/comparativo_new.
 *   3. Filtra: deposito_cod === '313' e mix === SIM (1).
 *   4. Carrega CONFIG/1-SECAO em memória (1 leitura no Firestore) e a
 *      lista de usuários candidatos a responsável (compradores, diretores
 *      e supervisores ativos — mesma regra do margem).
 *   5. Para cada produto:
 *        - resolve compradores (lista) via buyerMapper do margem
 *        - upsert em comparativo313_rupturas (chave (filial_cod, codigo_produto))
 *        - reconcilia comparativo313_produto_compradores
 *   6. Marca como 'resolvida' rupturas que estavam pendentes mas não vieram
 *      nesta execução (loja reabasteceu / mix mudou / saiu do depósito).
 *   7. Atualiza tabela `agentes` (ultima_execucao_at, pendentes_total).
 *   8. Fecha agente_execucoes com métricas.
 */
import { firestore } from '../../../services/firebase.service.js';
import { supabase } from '../../../services/supabase.service.js';
import { logger } from '../../../config/logger.js';
import { fetchComparativo } from './localApi.service.js';
import {
  loadConfigCache,
  pickValidBuyers,
} from '../../margem/services/buyerMapper.service.js';
import {
  extractCodigo,
  extractDescricao,
  parseProdutoStr,
  normalizeChaveSecao,
  parseMixFlag,
  toNumber,
  toInt,
} from '../utils/parseFields.js';

const SLUG = 'comparativo313';
const DEPOSITO_ALVO = '313';

export async function runSync({ origem = 'manual' } = {}) {
  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();

  // 1. Agente + execução
  const { data: agente, error: errAg } = await supabase
    .from('agentes').select('id').eq('slug', SLUG).single();
  if (errAg || !agente) throw new Error('Agente comparativo313 não cadastrado');

  const { data: exec, error: errEx } = await supabase
    .from('agente_execucoes')
    .insert({ agente_id: agente.id, status: 'rodando', origem })
    .select('id').single();
  if (errEx) throw errEx;

  await supabase.from('agentes')
    .update({ ultima_execucao_status: 'rodando' })
    .eq('id', agente.id);

  const metricas = {
    total_api: 0,
    fora_deposito: 0,
    sem_mix: 0,
    elegiveis: 0,
    upsert: 0,
    resolvidas: 0,
    sem_comprador: 0,
    secao_inexistente: 0,
    secao_invalida: 0,
    erros: [],
  };

  try {
    // 2. Busca todos os registros
    const apiData = await fetchComparativo();
    metricas.total_api = apiData.length;
    logger.info({ total: apiData.length }, '[comparativo313] API consultada');

    // 3. Filtros
    const elegiveis = [];
    for (const row of apiData) {
      const depCod = extractCodigo(row.deposito);
      if (depCod !== DEPOSITO_ALVO) { metricas.fora_deposito += 1; continue; }
      if (!parseMixFlag(row.mix))   { metricas.sem_mix += 1;        continue; }
      elegiveis.push(row);
    }
    metricas.elegiveis = elegiveis.length;
    logger.info({ elegiveis: elegiveis.length }, '[comparativo313] após filtro');

    // 4. Carrega CONFIG/1-SECAO e lista de usuários (mesma carteira que margem)
    const configCache = await loadConfigCache(firestore);
    const { data: usuariosLista, error: errU } = await supabase
      .from('usuarios')
      .select('id, nome, papel, ativo')
      .eq('ativo', true)
      .in('papel', ['comprador', 'supervisor', 'diretor']);
    if (errU) throw errU;
    const userIdByNome = new Map(usuariosLista.map(u => [u.nome.toUpperCase(), u.id]));

    // 5. Loop de upsert
    for (const row of elegiveis) {
      try {
        const { linha, compradores, motivo } = mapApiToRow(row, configCache);
        linha.agente_execucao_id = exec.id;

        if (motivo === 'sem_comprador_valido') metricas.sem_comprador     += 1;
        if (motivo === 'secao_inexistente')    metricas.secao_inexistente += 1;
        if (motivo === 'secao_invalida')       metricas.secao_invalida    += 1;

        // Upsert: se já existe (mesma filial+produto), reaproveita primeira_deteccao
        const { data: existing } = await supabase
          .from('comparativo313_rupturas')
          .select('id, primeira_deteccao')
          .eq('filial_cod', linha.filial_cod)
          .eq('codigo_produto', linha.codigo_produto)
          .maybeSingle();

        if (existing) {
          linha.primeira_deteccao = existing.primeira_deteccao;
        }

        const { data: prod, error: errProd } = await supabase
          .from('comparativo313_rupturas')
          .upsert(linha, { onConflict: 'filial_cod,codigo_produto' })
          .select('id')
          .single();
        if (errProd) throw errProd;

        await reconcileCompradores(prod.id, compradores, userIdByNome);
        metricas.upsert += 1;
      } catch (e) {
        metricas.erros.push({ produto: row.codigo || row.produto, filial: row.filial, erro: e.message });
        logger.error({ err: e, produto: row.produto, filial: row.filial }, '[comparativo313] erro processando');
      }
    }

    // 6. Marcar como 'resolvida' rupturas pendentes que NÃO foram tocadas
    //    nesta execução (sumiram da API).
    const { count: countResolvidas, error: errRes } = await supabase
      .from('comparativo313_rupturas')
      .update({ status: 'resolvida', resolvida_em: new Date().toISOString() }, { count: 'exact' })
      .eq('status', 'pendente')
      .lt('ultima_deteccao', startedAtIso);
    if (errRes) throw errRes;
    metricas.resolvidas = countResolvidas || 0;

    // 7. Atualiza agente
    const { count: pendentesTotal } = await supabase
      .from('comparativo313_rupturas')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pendente');

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
    logger.error({ err }, '[comparativo313] sync falhou');
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

function mapApiToRow(row, configCache) {
  const filialCod   = extractCodigo(row.filial) || 'desconhecida';
  const depositoCod = extractCodigo(row.deposito) || DEPOSITO_ALVO;
  const chaveSecao  = normalizeChaveSecao(row.secao);

  // Resolve compradores via buyerMapper do margem (multi-comprador)
  let compradores = [];
  let motivo      = 'ok';
  if (!chaveSecao) {
    motivo = 'secao_invalida';
  } else {
    const cfg = configCache[chaveSecao];
    if (!cfg) {
      motivo = 'secao_inexistente';
    } else {
      compradores = pickValidBuyers(cfg);
      if (!compradores.length) motivo = 'sem_comprador_valido';
    }
  }

  // O campo `produto` da API já vem como "<codigo> - <descricao>".
  // Em alguns registros, `codigo` vem separado — usamos preferencialmente
  // o que estiver mais limpo.
  const parsed = parseProdutoStr(row.produto);
  const codigo = String(row.codigo || parsed.codigo || '').trim();
  const descricao = parsed.descricao || extractDescricao(row.produto) || '';

  const linha = {
    filial:               String(row.filial || '').trim(),
    filial_cod:           filialCod,
    deposito:             String(row.deposito || '').trim(),
    deposito_cod:         depositoCod,
    departamento:         (row.departamento || '').toString().trim() || null,
    secao:                (row.secao || '').toString().trim() || null,
    chave_secao:          chaveSecao,
    codigo_produto:       codigo,
    descricao_produto:    descricao,
    estoque_deposito:     toNumber(row.estoque_deposito) ?? 0,
    mix:                  parseMixFlag(row.mix),
    grade:                toInt(row.grade),
    multiplo_reposicao:   toInt(row.multiplo_reposicao),
    multiplo_produto:     toInt(row.multiplo_produto),
    motivo_atribuicao:    motivo,
    status:               'pendente',
    ultima_deteccao:      new Date().toISOString(),
  };

  return { linha, compradores, motivo };
}

async function reconcileCompradores(produtoId, compradores, userIdByNome) {
  const desejados = compradores
    .map(c => ({
      produto_id: produtoId,
      usuario_id: userIdByNome.get(c.nome) || null,
      papel_atribuicao: c.papel,
    }))
    .filter(x => x.usuario_id);

  const { data: atuais } = await supabase
    .from('comparativo313_produto_compradores')
    .select('usuario_id, papel_atribuicao')
    .eq('produto_id', produtoId);

  const desejadosKey = new Set(desejados.map(d => d.usuario_id));

  const remover = (atuais || []).filter(a => !desejadosKey.has(a.usuario_id));
  if (remover.length) {
    await supabase.from('comparativo313_produto_compradores')
      .delete()
      .eq('produto_id', produtoId)
      .in('usuario_id', remover.map(r => r.usuario_id));
  }

  if (desejados.length) {
    await supabase.from('comparativo313_produto_compradores')
      .upsert(desejados, { onConflict: 'produto_id,usuario_id' });
  }
}
