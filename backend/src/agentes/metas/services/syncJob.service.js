/**
 * Job de sincronização do agente metas.
 *
 * Fluxo:
 *   1. Cria linha em agente_execucoes (status='rodando').
 *   2. Lê TODOS os docs da competência corrente em METAS-SUPERMERCADO
 *      (1 doc por filial).
 *   3. Para cada doc:
 *      - achata os 4 níveis (loja + arrays de setor/dept/secao)
 *      - calcula tendência (ver utils/calcTendencia.js)
 *      - upsert em metas_snapshots usando chave (snapshot_date, filial_cod, nivel, cod)
 *        — sobrescreve o snapshot do dia se rodar mais de uma vez.
 *   4. Atualiza tabela agentes (ultima_execucao_at, status, pendentes_total
 *      = qtd de filiais com risco no nível 'loja').
 *   5. Fecha agente_execucoes com métricas.
 */
import { supabase } from '../../../services/supabase.service.js';
import { logger } from '../../../config/logger.js';
import {
  fetchMetaDocsCompetenciaAtual,
  flattenDoc,
} from './firestoreReader.service.js';
import { calcTendencia, extractFilialCod } from '../utils/calcTendencia.js';

const SLUG = 'metas';

export async function runSync({ origem = 'manual' } = {}) {
  const startedAt = new Date();
  const startedAtIso = startedAt.toISOString();
  const snapshotDate = startedAtIso.slice(0, 10);                  // YYYY-MM-DD

  // 1. Agente + execução
  const { data: agente, error: errAg } = await supabase
    .from('agentes').select('id').eq('slug', SLUG).single();
  if (errAg || !agente) throw new Error('Agente metas não cadastrado');

  const { data: exec, error: errEx } = await supabase
    .from('agente_execucoes')
    .insert({ agente_id: agente.id, status: 'rodando', origem })
    .select('id').single();
  if (errEx) throw errEx;

  await supabase.from('agentes')
    .update({ ultima_execucao_status: 'rodando' })
    .eq('id', agente.id);

  const metricas = {
    docs_lidos: 0, snapshots_upsert: 0,
    filiais_em_risco: 0,
    setores_em_risco: 0, departamentos_em_risco: 0, secoes_em_risco: 0,
    erros: [],
  };

  try {
    // 2. Lê docs do mês
    const docs = await fetchMetaDocsCompetenciaAtual(startedAt);
    metricas.docs_lidos = docs.length;
    logger.info({ docs: docs.length }, '[metas] docs da competência lidos');

    // 3. Loop: achata, calcula, upsert
    for (const doc of docs) {
      try {
        // Se o ID não bate com o padrão `{ano}-{mes}-{filial}`, parseDocId
        // (chamado no firestoreReader) devolve null e doc.competencia fica
        // undefined. Tentamos extrair manualmente; se não dá, falha clara.
        if (!doc.competencia) {
          const guess = doc.id?.match(/^(\d{4})-([a-zà-ü]+)-(.+)$/i);
          if (guess) {
            doc.ano         = Number(guess[1]);
            doc.mes         = guess[2].toLowerCase();
            doc.filialCod   = guess[3];
            doc.competencia = `${guess[1]}-${guess[2].toLowerCase()}`;
          } else {
            throw new Error(`ID do doc fora do padrão esperado: "${doc.id}"`);
          }
        }

        const items = flattenDoc(doc);
        const lojaItem = items.find(it => it.nivel === 'loja');
        const filialDesc = lojaItem?.descricao || null;
        const filialCod = doc.filialCod || extractFilialCod(filialDesc) || 'desconhecida';

        const rows = items.map(it => {
          const r = calcTendencia({
            venda:         it.venda,
            metaVenda:     it.meta_venda,
            diasCorte:     it.dias_corte_tendencia,
            diasTendencia: it.dias_tendencia,
          });
          // contadores
          if (r.emRisco) {
            if (it.nivel === 'loja')          metricas.filiais_em_risco       += 1;
            if (it.nivel === 'setor')         metricas.setores_em_risco       += 1;
            if (it.nivel === 'departamento')  metricas.departamentos_em_risco += 1;
            if (it.nivel === 'secao')         metricas.secoes_em_risco        += 1;
          }
          return {
            competencia: doc.competencia,
            filial_cod:  filialCod,
            filial_desc: filialDesc,
            nivel:       it.nivel,
            cod:         it.cod,
            descricao:   it.descricao,
            venda:                r.venda,
            meta_venda:           r.metaVenda,
            dias_corte_tendencia: r.diasCorte,
            dias_tendencia:       r.diasTendencia,
            dias_restantes:       r.diasRestantes,
            desvio_meta:          r.desvioMeta,
            tendencia:            r.tendencia,
            desvio_tendencia:     r.desvioTendencia,
            percent_atingido:     r.percent,
            venda_ideal_dia:      r.vendaIdealDia,
            venda_para_recuperar: r.vendaParaRecuperar,
            em_risco:             r.emRisco,
            snapshot_date:        snapshotDate,
            agente_execucao_id:   exec.id,
          };
        });

        // PostgREST aceita upsert em lote
        const { error: errUp } = await supabase
          .from('metas_snapshots')
          .upsert(rows, { onConflict: 'snapshot_date,filial_cod,nivel,cod' });
        if (errUp) throw errUp;

        metricas.snapshots_upsert += rows.length;
      } catch (e) {
        metricas.erros.push({ docId: doc.id, erro: e.message });
        logger.error({ err: e, docId: doc.id }, '[metas] erro processando doc');
      }
    }

    // 4. Atualiza agente
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
        pendentes_total: metricas.filiais_em_risco,
      })
      .eq('id', agente.id);

    return { execId: exec.id, metricas };
  } catch (err) {
    logger.error({ err }, '[metas] sync falhou');
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
