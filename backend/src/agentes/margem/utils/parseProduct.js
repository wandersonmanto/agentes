/**
 * Utilitários de parse para os campos vindos da API local de margem.
 * Cobre: extração de código/nome do produto, número da seção, valores
 * monetários no formato pt-BR ("58,90"), datas pt-BR ("25/05/2026").
 *
 * Convenção do Firestore (validada em 2026-04-30 com o usuário):
 *   - Existe UM ÚNICO documento `CONFIG/1-SECAO`.
 *   - Esse doc tem N campos, um por seção. Nome do campo = string
 *     completa "<num> - <NOME>" (a mesma string que vem em
 *     produto.SECAOPRICE, depois de trim).
 *   - Valor do campo = { comprador, comprador2, comprador3,
 *                        departamento, secao, setor, margem, lastUpdated }.
 */

/** Doc único do Firestore que guarda todas as configurações de seção. */
export const CONFIG_DOC_ID = '1-SECAO';

/**
 * "505646 - CAPA ADOMES P/CADEIRA VELUDO BEGE" -> { codigo: "505646", descricao: "CAPA ADOMES P/CADEIRA VELUDO BEGE" }
 */
export function parseProduto(str) {
  if (!str) return { codigo: null, descricao: null };
  const m = String(str).trim().match(/^(\d+)\s*-\s*(.+)$/);
  if (!m) return { codigo: null, descricao: String(str).trim() };
  return { codigo: m[1].trim(), descricao: m[2].trim() };
}

/**
 * "35 - CAMA E MESA" -> { numero: 35, nome: "CAMA E MESA", chave: "35 - CAMA E MESA" }
 * `chave` é a string normalizada (trim) usada como NOME DO CAMPO dentro do doc CONFIG/1-SECAO.
 */
export function parseSecao(str) {
  if (!str) return { numero: null, nome: null, chave: null };
  const trimmed = String(str).trim();
  const m = trimmed.match(/^(\d+)\s*-\s*(.+)$/);
  if (!m) return { numero: null, nome: trimmed, chave: trimmed };
  return {
    numero: Number(m[1]),
    nome: m[2].trim(),
    chave: `${m[1]} - ${m[2].trim()}`,
  };
}

/**
 * Converte número da API em float. A API mistura formatos:
 *   - pt-BR (campos de dinheiro): "58,90", "1.234,56" → vírgula = decimal, pontos = milhar.
 *   - US    (estoque, promoção):  "0.1", "18.316", "30.9" → ponto = decimal.
 *
 * Heurística: se há vírgula, é pt-BR. Senão, é US (ponto é decimal).
 * Aceita Number nativo também.
 *
 * "58,90"   -> 58.9      "0.1"     -> 0.1
 * "1.234,56"-> 1234.56   "18.316"  -> 18.316
 * "30.9"    -> 30.9      ""/null   -> null
 */
export function parseCurrency(str) {
  if (str == null || str === '') return null;
  if (typeof str === 'number') return Number.isFinite(str) ? str : null;

  const s = String(str).trim().replace(/\s/g, '');
  if (s === '') return null;

  const hasComma = s.includes(',');
  // pt-BR: pontos são separadores de milhar, vírgula é decimal.
  // US (sem vírgula): o ponto é decimal (não mexer).
  const normalized = hasComma
    ? s.replace(/\./g, '').replace(',', '.')
    : s;

  const num = Number(normalized);
  return Number.isFinite(num) ? num : null;
}

/** "20/06/2024" -> "2024-06-20"  (ISO) */
export function parseDateBR(str) {
  if (!str) return null;
  const m = String(str).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}
