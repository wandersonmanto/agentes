/**
 * Cálculo de tendência de meta de vendas.
 *
 * Fórmula (validada com o usuário em 2026-05-18):
 *
 *   diasComputados      = diaAtualDoMes - diasCorte      // dias efetivos do realizado
 *   diasRestantes       = diasTendencia - diasComputados // dias que ainda faltam
 *   tendencia           = (venda / diasComputados) * diasTendencia
 *   desvioMeta          = venda - metaVenda              // = (meta - venda) * -1
 *   desvioTendencia     = tendencia - metaVenda          // = (meta - tendencia) * -1
 *   percent             = (venda * 100) / metaVenda
 *   vendaIdealDia       = metaVenda / diasTendencia      // ritmo "teórico" do mês
 *   vendaParaRecuperar  = max(0, metaVenda - venda) / diasRestantes
 *                                                        // ritmo necessário p/ recuperar
 *   emRisco             = tendencia < metaVenda
 *
 * Onde:
 *   - venda          : realizado parcial do mês (loja.venda / setor.venda / ...)
 *   - metaVenda      : meta do período (meta_loja.venda / meta_setor.venda / ...)
 *   - diasCorte      : doc.dias_corte_tendencia — dias do mês a IGNORAR (offset)
 *   - diasTendencia  : doc.dias_tendencia — total de dias do período (ex.: 31)
 *   - diaAtualDoMes  : default new Date().getDate(), pode ser injetado p/ testes
 *
 * Exemplo (loja 305 em 18/maio): venda=2.794.846,58; meta=5.114.843,13;
 * diasCorte=1; diasTendencia=31; diaAtual=18:
 *   diasComputados = 18 - 1 = 17
 *   tendencia      = (2.794.846,58 / 17) * 31 = 5.096.484,94
 *
 * Notas:
 *  - Se `diasComputados <= 0` (corte engole tudo, ou primeira execução
 *    no mês), devolve indicadores null e emRisco=false.
 *  - Valores monetários no Firestore vêm como string ("2794846.58") ou
 *    como number — `toNumber` aceita os dois.
 *  - `metaVenda` zero ou ausente devolve indicadores null (sem alerta).
 */

export function toNumber(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function toInt(v, fallback = null) {
  const n = toNumber(v);
  if (n == null) return fallback;
  return Math.trunc(n);
}

/**
 * @param {object} args
 * @param {number|string|null} args.venda
 * @param {number|string|null} args.metaVenda
 * @param {number|string|null} args.diasCorte        — dias_corte_tendencia (offset; dias do mês a IGNORAR)
 * @param {number|string|null} args.diasTendencia    — dias_tendencia (período do mês)
 * @param {number}             [args.diaAtualDoMes]  — default: dia corrente (1..31)
 * @returns {{
 *   venda: number|null, metaVenda: number|null,
 *   diasCorte: number|null, diasTendencia: number|null,
 *   diasComputados: number|null, diasRestantes: number|null,
 *   desvioMeta: number|null, tendencia: number|null,
 *   desvioTendencia: number|null, percent: number|null,
 *   vendaIdealDia: number|null, vendaParaRecuperar: number|null,
 *   emRisco: boolean
 * }}
 */
export function calcTendencia({ venda, metaVenda, diasCorte, diasTendencia, diaAtualDoMes } = {}) {
  const v   = toNumber(venda);
  const mv  = toNumber(metaVenda);
  const dt  = toInt(diasTendencia);
  const dc  = toInt(diasCorte) ?? 0;                           // 0 = sem offset
  const dia = toInt(diaAtualDoMes) ?? new Date().getDate();    // 1..31
  const diasComputados = dia - dc;                              // dias efetivos do realizado
  const diasRestantes  = (dt && dt > 0) ? (dt - diasComputados) : null;

  const valid = v != null && mv != null && mv !== 0
             && dt && dt > 0 && diasComputados > 0;
  if (!valid) {
    return {
      venda: v, metaVenda: mv, diasCorte: dc, diasTendencia: dt,
      diasComputados: diasComputados > 0 ? diasComputados : null,
      diasRestantes:  diasRestantes  != null && diasRestantes  > 0 ? diasRestantes : null,
      desvioMeta: null, tendencia: null, desvioTendencia: null,
      percent: null, vendaIdealDia: null, vendaParaRecuperar: null,
      emRisco: false,
    };
  }

  const desvioMeta      = (mv - v) * -1;                       // = v - mv
  const tendencia       = (v / diasComputados) * dt;
  const desvioTendencia = (mv - tendencia) * -1;               // = tendencia - mv
  const percent         = (v * 100) / mv;
  const vendaIdealDia   = mv / dt;
  const emRisco         = tendencia < mv;

  // Venda extra por dia para recuperar a meta no que resta do período.
  //   - se já bateu a meta (desvioMeta >= 0) → 0
  //   - se acabaram os dias (diasRestantes <= 0) → null (não dá mais)
  let vendaParaRecuperar = null;
  if (desvioMeta >= 0) {
    vendaParaRecuperar = 0;
  } else if (diasRestantes != null && diasRestantes > 0) {
    vendaParaRecuperar = (mv - v) / diasRestantes;
  }

  return {
    venda: v, metaVenda: mv, diasCorte: dc, diasTendencia: dt,
    diasComputados,
    diasRestantes: diasRestantes != null && diasRestantes > 0 ? diasRestantes : 0,
    desvioMeta:         round2(desvioMeta),
    tendencia:          round2(tendencia),
    desvioTendencia:    round2(desvioTendencia),
    percent:            round2(percent),
    vendaIdealDia:      round2(vendaIdealDia),
    vendaParaRecuperar: vendaParaRecuperar == null ? null : round2(vendaParaRecuperar),
    emRisco,
  };
}

function round2(n) { return Math.round(n * 100) / 100; }

/**
 * "2026-maio-305"   -> { ano: 2026, mes: 'maio', filialCod: '305',   competencia: '2026-maio' }
 * "2026-maio-grupo" -> { ano: 2026, mes: 'maio', filialCod: 'grupo', competencia: '2026-maio' }
 *
 * Aceita códigos de filial alfanuméricos (ex.: 'grupo' para o consolidado da rede).
 */
export function parseDocId(id) {
  const m = String(id || '').match(/^(\d{4})-([a-zà-ü]+)-([a-z0-9_-]+)$/i);
  if (!m) return null;
  return {
    ano: Number(m[1]),
    mes: m[2].toLowerCase(),
    filialCod: m[3],
    competencia: `${m[1]}-${m[2].toLowerCase()}`,
  };
}

/** Doc ID do mês corrente para uma filial: '2026-maio-305' */
const MESES_PT = [
  'janeiro','fevereiro','marco','abril','maio','junho',
  'julho','agosto','setembro','outubro','novembro','dezembro',
];
export function buildDocIdForFilial(filialCod, ref = new Date()) {
  const ano = ref.getFullYear();
  const mes = MESES_PT[ref.getMonth()];
  return `${ano}-${mes}-${String(filialCod)}`;
}

/**
 * "305 - ELETRO BRASIL LTDA" -> "305"
 * "305"                      -> "305"
 * "grupo"                    -> "grupo"
 * null/""                    -> null
 */
export function extractFilialCod(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const m = s.match(/^(\d+)/);
  return m ? m[1] : s.toLowerCase();
}
