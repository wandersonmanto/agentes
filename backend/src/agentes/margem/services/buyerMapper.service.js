/**
 * Mapeia uma seção (vinda do produto da API local) para os compradores
 * responsáveis, lendo o documento único `CONFIG/1-SECAO` no Firestore.
 *
 * Estrutura real do Firestore (validada em 2026-04-30):
 *
 *   CONFIG/1-SECAO        // ÚNICO doc — agrega TODAS as seções como campos
 *     "1 - LEITES E ALIMENTOS INFANTIS": { comprador, comprador2, comprador3, ... }
 *     "35 - CAMA E MESA":                 { comprador, comprador2, comprador3, ... }
 *     ...
 *
 * Regra de negócio (definida em 2026-04-30 com o usuário):
 *   - Uma seção pode ter ATÉ TRÊS compradores (comprador, comprador2, comprador3).
 *   - TODOS os válidos atuam no dia a dia: o primeiro que ver o produto
 *     resolve. Logo, todos devem ser NOTIFICADOS, todos devem ENXERGAR
 *     o produto na lista, e a ciência de qualquer um remove o produto
 *     da lista de todos.
 *   - Implementação: relação N:N entre produto e usuário (tabela
 *     `margem_produto_compradores`), com `papel_atribuicao` preservando
 *     a ordem original do Firebase (principal | secundario | terciario).
 *
 * Tolerância: comparação por uppercase + trim. Erros de digitação no
 * Firestore (ex.: "TEREZE" em vez de "TEREZA") fazem o nome cair fora
 * da lista oficial — registrar em agente_execucoes.metricas para o
 * admin corrigir.
 */

import { CONFIG_DOC_ID, parseSecao } from '../utils/parseProduct.js';

/**
 * Lista oficial de RESPONSÁVEIS por carteira (não só compradores formais).
 * Inclui supervisora (IRIS) e diretores que respondem por seções
 * (PAULO, SILVANIA). NAYLA MARIANA e PADARIA estão desativados como
 * histórico — produtos das suas seções no Firestore caem em
 * `motivo_atribuicao = 'sem_comprador_valido'` para o admin corrigir.
 */
export const RESPONSAVEIS_OFICIAIS = new Set([
  'DEUSELINA FERREIRA',
  'NAYANE',
  'IRIS LIRA',           // supervisora
  'PAULO RODRIGUES',     // diretor + carteira
  'SILVANIA RODRIGUES',  // diretora + carteira
  'DANIELE NUNES',
  'MARIA CLARA',
  'TEREZA OLIVEIRA',
  'CLEILDE FONSECA',
  'ILNARA MACIEL'   // <-- novo
]);

// Alias mantido por compatibilidade. DEPRECADO — use RESPONSAVEIS_OFICIAIS.
export const COMPRADORES_OFICIAIS = RESPONSAVEIS_OFICIAIS;

const SEM_COMPRADOR = 'sem comprador';

/** Tipos de papel preservando a ordem dos campos do Firestore. */
export const PAPEIS = ['principal', 'secundario', 'terciario'];

/**
 * Devolve TODOS os compradores válidos de uma seção, na ordem de papel.
 * Cada item: { nome (uppercase), papel: 'principal'|'secundario'|'terciario' }.
 */
export function pickValidBuyers(secaoConfig) {
  if (!secaoConfig) return [];
  const slots = [
    { papel: 'principal',  raw: secaoConfig.comprador  },
    { papel: 'secundario', raw: secaoConfig.comprador2 },
    { papel: 'terciario',  raw: secaoConfig.comprador3 },
  ];
  return slots
    .map(s => ({ ...s, raw: s.raw == null ? '' : String(s.raw).trim() }))
    .filter(s => s.raw && s.raw.toLowerCase() !== SEM_COMPRADOR)
    .map(s => ({ papel: s.papel, nome: s.raw.toUpperCase() }))
    .filter(s => RESPONSAVEIS_OFICIAIS.has(s.nome));
}

/**
 * Helper de conveniência: devolve só o nome do comprador principal válido,
 * ou null. Útil em telas e relatórios que precisam "responsável principal".
 */
export function pickPrincipalBuyer(secaoConfig) {
  return pickValidBuyers(secaoConfig)[0]?.nome ?? null;
}

/**
 * Carrega o doc `CONFIG/1-SECAO` em memória uma única vez por sync.
 *
 * @param {import('firebase-admin/firestore').Firestore} firestore
 * @returns {Promise<object>} mapa { "<chave da seção>": secaoConfig }
 */
export async function loadConfigCache(firestore) {
  const snap = await firestore.collection('CONFIG').doc(CONFIG_DOC_ID).get();
  if (!snap.exists) {
    throw new Error(`Documento CONFIG/${CONFIG_DOC_ID} não encontrado no Firestore`);
  }
  return snap.data() || {};
}

/**
 * Resolve a LISTA de compradores responsáveis por um produto.
 *
 * @param {object} produto - linha bruta da API local
 * @param {object} configCache - resultado de loadConfigCache()
 * @returns {{
 *   compradores: Array<{nome: string, papel: 'principal'|'secundario'|'terciario'}>,
 *   chave: string|null,
 *   motivo: 'ok' | 'secao_inexistente' | 'sem_comprador_valido' | 'secao_invalida'
 * }}
 */
export function resolveCompradores(produto, configCache) {
  const { chave } = parseSecao(produto.SECAOPRICE);
  if (!chave) {
    return { compradores: [], chave: null, motivo: 'secao_invalida' };
  }
  const secaoConfig = configCache[chave];
  if (!secaoConfig) {
    return { compradores: [], chave, motivo: 'secao_inexistente' };
  }
  const compradores = pickValidBuyers(secaoConfig);
  return {
    compradores,
    chave,
    motivo: compradores.length ? 'ok' : 'sem_comprador_valido',
  };
}

/**
 * Inverte o mapa: para cada comprador, lista as seções pelas quais ele responde,
 * com o papel que ocupa em cada uma.
 *
 * @param {object} configCache - resultado de loadConfigCache()
 * @returns {Map<string, Array<{secao: string, papel: string}>>}
 */
export function buildSecoesPorComprador(configCache) {
  const out = new Map();
  for (const [chaveSecao, cfg] of Object.entries(configCache)) {
    for (const { nome, papel } of pickValidBuyers(cfg)) {
      if (!out.has(nome)) out.set(nome, []);
      out.get(nome).push({ secao: chaveSecao, papel });
    }
  }
  return out;
}
