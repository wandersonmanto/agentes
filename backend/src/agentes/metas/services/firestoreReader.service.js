/**
 * Leitor do Firestore para o agente metas.
 *
 * Documento alvo: METAS-SUPERMERCADO/{ano}-{mes_extenso}-{filial}
 * Ex.: 2026-maio-305
 *
 * Estrutura validada com o usuário (2026-05-18):
 *   - loja        : map  — { venda, dias_corte_tendencia, dias_tendencia, desc_filial, ... }
 *   - meta_loja   : map  — { venda, margem, perda, ... }
 *   - setor[]         + meta_setor[]
 *   - departamento[]  + meta_departamento[]
 *   - secao[]         + meta_secao[]
 *
 * Os arrays vêm em pares paralelos. Quando há cod_* explícito,
 * pareamos por código; caso contrário, por índice.
 */
import { firestore } from '../../../services/firebase.service.js';
import { FieldPath } from 'firebase-admin/firestore';
import { logger } from '../../../config/logger.js';
import { buildDocIdForFilial, parseDocId } from '../utils/calcTendencia.js';

const COLLECTION = 'METAS-SUPERMERCADO';

/** Lê o doc da competência corrente para uma filial. Devolve null se não existir. */
export async function fetchMetaDocByFilial(filialCod, refDate = new Date()) {
  const id = buildDocIdForFilial(filialCod, refDate);
  return fetchMetaDocById(id);
}

export async function fetchMetaDocById(docId) {
  const snap = await firestore.collection(COLLECTION).doc(docId).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...parseDocId(snap.id), data: snap.data() || {} };
}

/**
 * Lista TODOS os docs da competência corrente (1 por filial).
 * Estratégia: list IDs da collection e filtrar pelo prefixo do mês.
 * (Coleções com poucas dezenas de docs — sem custo relevante.)
 */
export async function fetchMetaDocsCompetenciaAtual(refDate = new Date()) {
  const mesPrefix = buildDocIdForFilial('', refDate).replace(/-$/, '');   // "2026-maio"
  // Range query no document ID — o Firestore Admin SDK 12+ exige o valor
  // ser SÓ o doc ID (sem o prefixo da coleção) e usar FieldPath.documentId().
  const snap = await firestore.collection(COLLECTION)
    .where(FieldPath.documentId(), '>=', `${mesPrefix}-`)
    .where(FieldPath.documentId(), '<',  `${mesPrefix}.`)  // '.' > '-' no ASCII
    .get();

  if (snap.empty) {
    logger.warn({ mesPrefix }, '[metas] nenhum doc encontrado na competência');
    return [];
  }
  return snap.docs.map(d => ({ id: d.id, ...parseDocId(d.id), data: d.data() || {} }));
}

/**
 * Normaliza os 4 níveis (loja/setor/departamento/secao) de UM doc em uma
 * lista plana de "items" prontos para calcular tendência e gravar snapshot.
 *
 * Item:
 *   { nivel, cod, descricao, venda, meta_venda, dias_corte_tendencia, dias_tendencia }
 */
export function flattenDoc(doc) {
  const d = doc.data || {};
  const items = [];

  // ----- Nível LOJA (map) --------------------------------------------
  const loja     = d.loja     || {};
  const metaLoja = d.meta_loja || {};
  items.push({
    nivel: 'loja',
    cod: null,
    descricao: loja.desc_filial || `${doc.filialCod}`,
    venda: loja.venda,
    meta_venda: metaLoja.venda,
    dias_corte_tendencia: loja.dias_corte_tendencia,
    dias_tendencia: loja.dias_tendencia,
  });

  // ----- Sub-níveis (arrays paralelos) -------------------------------
  pushArrayLevel(items, 'setor',        d.setor,        d.meta_setor);
  pushArrayLevel(items, 'departamento', d.departamento, d.meta_departamento);
  pushArrayLevel(items, 'secao',        d.secao,        d.meta_secao);

  return items;
}

function pushArrayLevel(items, nivel, arr, metaArr) {
  if (!Array.isArray(arr) || arr.length === 0) return;
  const metas = Array.isArray(metaArr) ? metaArr : [];

  // Index das metas por cod (se houver). Usa o primeiro campo com prefixo "cod_".
  const metasByCod = new Map();
  for (const m of metas) {
    const cod = pickCod(m);
    if (cod != null) metasByCod.set(String(cod), m);
  }

  arr.forEach((row, i) => {
    const cod = pickCod(row);
    const meta = (cod != null && metasByCod.has(String(cod)))
      ? metasByCod.get(String(cod))
      : metas[i] || {};

    // dias_* podem estar no item ou herdar do nível loja (mesma competência)
    items.push({
      nivel,
      cod: cod != null ? String(cod) : null,
      descricao: pickDesc(row) || pickDesc(meta) || (cod != null ? String(cod) : null),
      venda: row.venda,
      meta_venda: meta.venda,
      dias_corte_tendencia: row.dias_corte_tendencia ?? meta.dias_corte_tendencia,
      dias_tendencia: row.dias_tendencia ?? meta.dias_tendencia,
    });
  });
}

function pickCod(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.cod        != null) return obj.cod;
  if (obj.codigo     != null) return obj.codigo;
  // Qualquer campo "cod_<algo>" ou "codigo_<algo>"
  for (const k of Object.keys(obj)) {
    if (/^cod(igo)?(_|$)/i.test(k) && obj[k] != null) return obj[k];
  }
  return null;
}

function pickDesc(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.desc       != null) return String(obj.desc);
  if (obj.descricao  != null) return String(obj.descricao);
  if (obj.nome       != null) return String(obj.nome);
  for (const k of Object.keys(obj)) {
    if (/^desc(ricao)?(_|$)/i.test(k) && obj[k] != null) return String(obj[k]);
  }
  return null;
}
