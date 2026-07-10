/**
 * Utilitários para parse dos campos da API local /api/comparativo_new.
 *
 * Exemplo de objeto:
 *   {
 *     deposito:"313 - ELETRO BRASIL LTDA",
 *     filial:"302 - ELETRO BRASIL LTDA",
 *     departamento:"9 - CONGELADOS",
 *     secao:"1168 - LINGUIÇAS CONGELADAS",
 *     codigo:"408686",
 *     produto:"408686 - LING FGO QUEIJO COALHO FRIATO 600G",
 *     estoque_deposito:120,
 *     mix:"1 - SIM",
 *     grade:24,
 *     multiplo_reposicao:12,
 *     multiplo_produto:12
 *   }
 */

/** "313 - ELETRO BRASIL LTDA" -> "313" | "313" -> "313" | null/"" -> null */
export function extractCodigo(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const m = s.match(/^(\d+)/);
  return m ? m[1] : s;
}

/** Tudo após "<num> - " — útil pra "303 - LOJA X" -> "LOJA X". */
export function extractDescricao(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const m = s.match(/^\d+\s*-\s*(.+)$/);
  return m ? m[1].trim() : s;
}

/**
 * "408686 - LING FGO QUEIJO COALHO FRIATO 600G"
 *   -> { codigo: "408686", descricao: "LING FGO QUEIJO COALHO FRIATO 600G" }
 */
export function parseProdutoStr(raw) {
  if (!raw) return { codigo: null, descricao: null };
  const s = String(raw).trim();
  const m = s.match(/^(\d+)\s*-\s*(.+)$/);
  if (!m) return { codigo: null, descricao: s };
  return { codigo: m[1].trim(), descricao: m[2].trim() };
}

/**
 * Normaliza o campo "secao" do registro para a CHAVE usada como nome de
 * campo no documento `CONFIG/1-SECAO` no Firestore.
 *
 * O documento usa exatamente a string "<num> - <NOME>" trimmed. Padrões
 * observados na API podem vir com espaços extras à direita do nome,
 * então normalizamos.
 *
 * "1168 - LINGUIÇAS CONGELADAS  " -> "1168 - LINGUIÇAS CONGELADAS"
 */
export function normalizeChaveSecao(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  const m = s.match(/^(\d+)\s*-\s*(.+)$/);
  if (!m) return s;
  return `${m[1]} - ${m[2].trim()}`;
}

/** "1 - SIM" / 1 / "1" -> true ; "0 - NAO" / 0 / "0" / null -> false */
export function parseMixFlag(raw) {
  if (raw == null) return false;
  if (typeof raw === 'number') return raw === 1;
  const s = String(raw).trim();
  if (!s) return false;
  // Aceita "1", "1 - SIM", "SIM", "true"
  if (/^1\b/.test(s)) return true;
  if (/^sim\b/i.test(s)) return true;
  if (/^true$/i.test(s)) return true;
  return false;
}

/** Converte para número aceitando string/number/null. Devolve null se inválido. */
export function toNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/\s/g, '');
  if (!s) return null;
  // pt-BR: vírgula decimal + pontos milhares
  const hasComma = s.includes(',');
  const normalized = hasComma ? s.replace(/\./g, '').replace(',', '.') : s;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
}

/** Converte para inteiro, ou null. */
export function toInt(v) {
  const n = toNumber(v);
  if (n == null) return null;
  return Math.trunc(n);
}
