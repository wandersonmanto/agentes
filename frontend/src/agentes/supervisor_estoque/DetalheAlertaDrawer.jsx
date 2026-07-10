/**
 * Painel lateral com o contexto completo de um produto×filial:
 *   - KPI cards do estado atual
 *   - Gráfico 90 dias (estoque + média/dia, eixos duplos)
 *   - Estatísticas da baseline ampliada (melhor/pior dia, média, mediana, etc.)
 *   - Lista de outros alertas do mesmo SKU×filial
 *   - Comparativo cross-filial do mesmo SKU
 *
 * Abre quando o usuário clica numa linha da Alertas. Buscas em paralelo no
 * endpoint /agente/supervisor_estoque/produto/:codigo/contexto.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import {
  X, TrendingDown, TrendingUp, Package, Calendar, AlertCircle,
} from 'lucide-react';
import { api } from '../../lib/api';

const BANDA_BADGE = {
  constante: 'bg-emerald-100 text-emerald-800',
  medio:     'bg-sky-100 text-sky-800',
  baixo:     'bg-amber-100 text-amber-800',
  critico:   'bg-red-100 text-red-800',
  fora_de_faixa: 'bg-slate-100 text-slate-600',
};
const METRICA_LABEL = {
  media_dia:  'Média/dia',
  dias_venda: 'Dias com venda',
  giro:       'Giro',
};

export function DetalheAlertaDrawer({ alerta, onClose }) {
  const [dados, setDados] = useState(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!alerta) return;
    let cancelado = false;
    setLoading(true);
    setErro('');
    setDados(null);
    api.get(`/agente/supervisor_estoque/produto/${alerta.codigo_produto}/contexto`, {
      params: { filial: alerta.filial_cod, dias: 90 },
    })
      .then(r => { if (!cancelado) setDados(r.data); })
      .catch(e => { if (!cancelado) setErro(e.response?.data?.error || e.message); })
      .finally(() => { if (!cancelado) setLoading(false); });
    return () => { cancelado = true; };
  }, [alerta]);

  // Esc fecha
  useEffect(() => {
    if (!alerta) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [alerta, onClose]);

  const seriePlot = useMemo(() => {
    if (!dados?.historico) return [];
    return dados.historico.map(h => ({
      data: h.snapshot_date,
      dataFmt: new Date(h.snapshot_date + 'T00:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
      estoque: h.estoque != null ? Number(h.estoque) : null,
      media_dia: h.media_dia != null ? Number(h.media_dia) : null,
      dias_venda: h.dias_venda != null ? Number(h.dias_venda) : null,
    }));
  }, [dados]);

  if (!alerta) return null;

  return (
    <div className="fixed inset-0 z-40">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-slate-900/40"
        onClick={onClose}
      />
      {/* Drawer */}
      <div className="absolute right-0 top-0 h-full w-full max-w-4xl bg-slate-50 shadow-2xl overflow-y-auto border-l border-slate-200">
        <Header alerta={alerta} dados={dados} onClose={onClose} />

        <div className="px-6 py-4 space-y-6">
          {loading && <p className="text-slate-500">Carregando contexto...</p>}
          {erro && <p className="text-red-600">{erro}</p>}

          {dados && (
            <>
              <KpiStrip atual={dados.atual} />
              <SecaoPresenca presenca={dados.presenca} atual={dados.atual} />
              <SecaoRiscoValidade risco={dados.risco_validade} atual={dados.atual} />
              <SecaoGrafico serie={seriePlot} janela={dados.janela_dias} />
              <SecaoBaseline baseline={dados.baseline} />
              <SecaoAlertasRelacionados alertas={dados.alertas} alertaAtual={alerta} />
              <SecaoOutrasFiliais filiais={dados.outras_filiais} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------- Header ----------------
function Header({ alerta, dados, onClose }) {
  const atual = dados?.atual;
  return (
    <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-6 py-4 flex items-start justify-between gap-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="font-mono">{alerta.filial_cod}</span>
          <span>•</span>
          <span>{atual?.filial || alerta.filial || '—'}</span>
        </div>
        <h2 className="text-lg font-semibold text-slate-900 truncate">
          {alerta.descricao_produto || atual?.descricao_produto || '—'}
        </h2>
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
          <span className="font-mono">#{alerta.codigo_produto}</span>
          {atual?.cod_barras && <span>EAN {atual.cod_barras}</span>}
          {(alerta.secao || atual?.secao) && (
            <span>Seção: <span className="text-slate-800">{alerta.secao || atual.secao}</span></span>
          )}
          {(alerta.fornecedor || atual?.fornecedor) && (
            <span>Fornecedor: <span className="text-slate-800">{alerta.fornecedor || atual.fornecedor}</span></span>
          )}
        </div>
      </div>
      <button
        onClick={onClose}
        className="text-slate-400 hover:text-slate-700 p-1 -m-1 rounded"
        aria-label="Fechar"
      >
        <X size={20} />
      </button>
    </div>
  );
}

// ---------------- KPI cards ----------------
function KpiStrip({ atual }) {
  if (!atual) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
      <Kpi label="Estoque"      value={fmtNum(atual.estoque)}             tone="slate" />
      <Kpi label="Média/dia"    value={fmtNum(atual.media_dia, 2)}        tone="slate" />
      <Kpi label="Dias venda"   value={fmtNum(atual.dias_venda)}          tone="slate" />
      <Kpi label="Giro"         value={fmtNum(atual.giro)}                tone="slate" />
      <Kpi label="Valor estoque" value={fmtMoney(atual.valor_estoque)}    tone="slate" />
      <Kpi
        label="Ruptura em"
        value={atual.dias_ate_ruptura != null ? `${fmtNum(atual.dias_ate_ruptura, 1)} d` : '—'}
        tone={atual.dias_ate_ruptura != null && Number(atual.dias_ate_ruptura) <= 7 ? 'red' : 'slate'}
      />
    </div>
  );
}
function Kpi({ label, value, tone }) {
  const cls = tone === 'red'
    ? { border: 'border-red-200',   bg: 'bg-red-50',   txt: 'text-red-700',   val: 'text-red-900' }
    : { border: 'border-slate-200', bg: 'bg-white',    txt: 'text-slate-600', val: 'text-slate-900' };
  return (
    <div className={`rounded-lg border ${cls.border} ${cls.bg} px-3 py-2`}>
      <p className={`text-[11px] font-medium ${cls.txt}`}>{label}</p>
      <p className={`mt-0.5 text-base font-bold ${cls.val}`}>{value}</p>
    </div>
  );
}

// ---------------- Gráfico ----------------
function SecaoGrafico({ serie, janela }) {
  if (!serie || serie.length === 0) {
    return <Card titulo={`Evolução (${janela || 90} dias)`}>
      <p className="text-sm text-slate-500">Sem histórico no período.</p>
    </Card>;
  }
  return (
    <Card titulo={`Evolução (${janela} dias)`}
          subtitulo="Estoque (eixo esquerdo) e média/dia (eixo direito)">
      <div className="h-72 -mx-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={serie} margin={{ top: 5, right: 10, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#e2e8f0" vertical={false} />
            <XAxis
              dataKey="dataFmt"
              tick={{ fontSize: 11, fill: '#64748b' }}
              interval="preserveStartEnd"
              minTickGap={28}
            />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 11, fill: '#64748b' }}
              tickFormatter={v => fmtCompact(v)}
              width={48}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 11, fill: '#64748b' }}
              tickFormatter={v => fmtCompact(v)}
              width={36}
            />
            <Tooltip
              contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid #e2e8f0' }}
              formatter={(v) => fmtNum(v, 2)}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line yAxisId="left"  type="monotone" dataKey="estoque"   name="Estoque"   stroke="#0ea5e9" strokeWidth={2} dot={false} />
            <Line yAxisId="right" type="monotone" dataKey="media_dia" name="Média/dia" stroke="#e11d48" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Card>
  );
}

// ---------------- Baseline (estatísticas) ----------------
function SecaoBaseline({ baseline }) {
  if (!baseline) return null;
  return (
    <Card titulo="Baseline ampliada"
          subtitulo={`Estatísticas dos últimos ${baseline.dias_analisados} dias da série`}>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 text-sm">
        <Stat label="Média"          value={fmtNum(baseline.media, 2)} />
        <Stat label="Mediana"        value={fmtNum(baseline.mediana, 2)} />
        <Stat label="Desvio padrão"  value={fmtNum(baseline.desvio_padrao, 2)} />
        <Stat label="Dias com venda" value={`${fmtNum(baseline.dias_com_venda)} / ${fmtNum(baseline.dias_analisados)}`} />
        <Stat label="Dias sem venda" value={fmtNum(baseline.dias_sem_venda)}
              tone={baseline.dias_sem_venda > baseline.dias_analisados / 3 ? 'amber' : 'slate'} />
        {baseline.melhor_dia && (
          <Stat
            label="Melhor dia"
            value={fmtNum(baseline.melhor_dia.media_dia, 2)}
            sub={`em ${fmtData(baseline.melhor_dia.data)}`}
            tone="emerald"
            Icon={TrendingUp}
          />
        )}
        {baseline.pior_dia && (
          <Stat
            label="Pior dia"
            value={fmtNum(baseline.pior_dia.media_dia, 2)}
            sub={`em ${fmtData(baseline.pior_dia.data)}`}
            tone="orange"
            Icon={TrendingDown}
          />
        )}
      </div>
    </Card>
  );
}
function Stat({ label, value, sub, tone = 'slate', Icon }) {
  const txt = {
    slate:   'text-slate-900',
    emerald: 'text-emerald-700',
    orange:  'text-orange-700',
    amber:   'text-amber-700',
  }[tone] || 'text-slate-900';
  return (
    <div className="rounded border border-slate-200 bg-white px-3 py-2">
      <div className="flex items-center gap-1 text-[11px] font-medium text-slate-500">
        {Icon && <Icon size={12} />} {label}
      </div>
      <div className={`mt-0.5 font-semibold ${txt}`}>{value}</div>
      {sub && <div className="text-[11px] text-slate-500">{sub}</div>}
    </div>
  );
}

// ---------------- Alertas relacionados ----------------
function SecaoAlertasRelacionados({ alertas, alertaAtual }) {
  if (!alertas || alertas.length === 0) {
    return <Card titulo="Outros alertas deste SKU na mesma filial">
      <p className="text-sm text-slate-500">Não há outros alertas para esse produto nesta filial.</p>
    </Card>;
  }
  const outros = alertas.filter(a => a.id !== alertaAtual.id).slice(0, 20);
  if (outros.length === 0) {
    return <Card titulo="Outros alertas deste SKU na mesma filial">
      <p className="text-sm text-slate-500">É o único alerta aberto para esse produto nesta filial.</p>
    </Card>;
  }
  return (
    <Card titulo="Outros alertas deste SKU na mesma filial"
          subtitulo={`${outros.length} alerta${outros.length === 1 ? '' : 's'}`}>
      <div className="rounded-lg border border-slate-200 bg-white overflow-hidden">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-slate-600">
            <tr>
              <th className="text-left p-2">Data</th>
              <th className="text-left p-2">Métrica</th>
              <th className="text-right p-2">Baseline</th>
              <th className="text-right p-2">Atual</th>
              <th className="text-right p-2">Variação</th>
              <th className="text-left p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {outros.map(a => (
              <tr key={a.id} className="border-t border-slate-100">
                <td className="p-2 text-slate-700">{fmtData(a.snapshot_date)}</td>
                <td className="p-2 text-slate-700">{METRICA_LABEL[a.metrica] || a.metrica}</td>
                <td className="p-2 text-right text-slate-600">{fmtNum(a.valor_baseline_7d, 2)}</td>
                <td className="p-2 text-right font-medium">{fmtNum(a.valor_atual, 2)}</td>
                <td className="p-2 text-right">
                  <span className={Number(a.variacao_pct) >= 0 ? 'text-sky-700' : 'text-orange-700'}>
                    {fmtPct(a.variacao_pct)}
                  </span>
                </td>
                <td className="p-2">
                  <span className={
                    'text-[11px] font-medium px-1.5 py-0.5 rounded ' +
                    (a.status === 'pendente'
                      ? 'bg-rose-100 text-rose-800'
                      : a.status === 'resolvida'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-slate-100 text-slate-700')
                  }>
                    {a.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ---------------- Outras filiais ----------------
function SecaoOutrasFiliais({ filiais }) {
  if (!filiais || filiais.length === 0) {
    return <Card titulo="Mesmo SKU em outras filiais">
      <p className="text-sm text-slate-500">Sem registros do produto em outras filiais do seu escopo.</p>
    </Card>;
  }
  return (
    <Card titulo="Mesmo SKU em outras filiais"
          subtitulo="Permite ver se o problema é localizado ou da rede toda">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {filiais.map(f => (
          <div key={f.filial_cod}
               className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span className="font-mono">{f.filial_cod}</span>
              <span className={`px-1.5 py-0.5 rounded text-[11px] font-medium ${BANDA_BADGE[f.banda] || 'bg-slate-100 text-slate-600'}`}>
                {f.banda || '—'}
              </span>
            </div>
            <div className="mt-1 text-sm font-medium text-slate-900 line-clamp-1">
              {f.filial || f.filial_cod}
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs text-slate-600">
              <span>Estoque:</span>
              <span className="text-right font-medium text-slate-800">{fmtNum(f.estoque)}</span>
              <span>Média/dia:</span>
              <span className="text-right">{fmtNum(f.media_dia, 2)}</span>
              <span>Dias venda:</span>
              <span className="text-right">{fmtNum(f.dias_venda)}</span>
              <span>Ruptura em:</span>
              <span className={'text-right font-medium ' +
                (f.dias_ate_ruptura != null && Number(f.dias_ate_ruptura) <= 7 ? 'text-red-700' : 'text-slate-800')}>
                {f.dias_ate_ruptura != null ? `${fmtNum(f.dias_ate_ruptura, 1)} d` : '—'}
              </span>
              {Number(f.alertas_pendentes) > 0 && (
                <>
                  <span>Alertas:</span>
                  <span className="text-right text-rose-700 font-semibold">
                    <AlertCircle size={10} className="inline mr-0.5" />{fmtNum(f.alertas_pendentes)}
                  </span>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

// ---------------- Histórico de presença (rupturas confirmadas) ----------------
function SecaoPresenca({ presenca, atual }) {
  if (!presenca) return null;
  // Só mostra se for relevante: produto sumido OU teve gaps
  const sumido = presenca.ativo_no_ultimo === false;
  const temGaps = (presenca.gaps || []).length > 0;
  if (!sumido && !temGaps) return null;

  return (
    <Card titulo="Histórico de presença"
          subtitulo={sumido
            ? `Produto sumiu do mix em ${fmtData(somaUmDia(presenca.ultima_aparicao))}`
            : 'Produto teve ausências no histórico'}>
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Stat label="1ª aparição"     value={fmtData(presenca.primeira_aparicao)} />
          <Stat label="Última aparição" value={fmtData(presenca.ultima_aparicao)} />
          <Stat
            label="Dias presente"
            value={`${fmtNum(presenca.dias_distintos)} / ${fmtNum(presenca.dias_base_total)}`}
            sub={`${Math.round(100 * presenca.dias_distintos / presenca.dias_base_total)}% da janela`}
          />
          <Stat
            label="Status"
            value={sumido ? 'Sumido' : 'Ativo'}
            tone={sumido ? 'orange' : 'emerald'}
          />
        </div>

        {temGaps && (
          <div className="mt-4 border-t border-slate-100 pt-3">
            <p className="text-xs text-slate-500 mb-2">Períodos ausentes:</p>
            <div className="space-y-1">
              {presenca.gaps.slice(-5).map((g, i) => (
                <div key={i} className="text-xs text-slate-700 font-mono">
                  {fmtData(g.inicio)} → {g.fim_anterior ? fmtData(g.fim_anterior) : 'ainda ausente'}
                </div>
              ))}
              {presenca.gaps.length > 5 && (
                <div className="text-xs text-slate-400">
                  +{presenca.gaps.length - 5} gaps anteriores
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}
function somaUmDia(d) {
  if (!d) return null;
  const dt = new Date(d + 'T00:00:00');
  dt.setDate(dt.getDate() + 1);
  return dt.toISOString().slice(0, 10);
}

// ---------------- Risco de validade (obsolescência) ----------------
const NIVEL_RISCO = {
  atencao:        { texto: 'Atenção',         cls: 'bg-amber-100 text-amber-800   border-amber-200' },
  risco:          { texto: 'Risco',           cls: 'bg-orange-100 text-orange-800 border-orange-200' },
  critico:        { texto: 'Crítico',         cls: 'bg-red-100 text-red-800       border-red-200' },
  perda_provavel: { texto: 'Perda provável',  cls: 'bg-red-200 text-red-900       border-red-300' },
};
function SecaoRiscoValidade({ risco, atual }) {
  if (!risco) {
    // Sem cadastro de validade nessa seção — não mostra o card
    return null;
  }
  const nivelInfo = risco.nivel ? NIVEL_RISCO[risco.nivel] : null;
  const taxa  = Number(risco.taxa_consumo || 0);
  // posição na régua: 0% — pct_atencao — pct_risco — pct_critico — 130%
  const max   = 1.30;
  const pos   = Math.min(taxa, max) / max * 100;
  const ratios = {
    atencao: (Number(risco.pct_atencao) || 0.60) / max * 100,
    risco:   (Number(risco.pct_risco)   || 0.80) / max * 100,
    critico: (Number(risco.pct_critico) || 1.00) / max * 100,
  };
  return (
    <Card titulo="Cobertura vs validade"
          subtitulo={risco.categoria
            ? `Seção classificada como ${risco.categoria} — política de recebimento: ${Math.round((Number(risco.pct_max_recebimento) || 0.10) * 100)}%`
            : null}>
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <Stat label="Validade média"  value={`${fmtNum(risco.validade_media_dias)} d`} />
          <Stat label="Validade no rec." value={`${fmtNum(risco.validade_efetiva_recebimento_dias)} d`} />
          <Stat label="Parado há"       value={`${fmtNum(risco.dias_parado)} d`} />
          <Stat
            label="Validade restante"
            value={`${fmtNum(risco.validade_restante_dias)} d`}
            tone={Number(risco.validade_restante_dias) <= 0 ? 'orange' : 'slate'}
          />
        </div>

        {/* Régua */}
        <div className="mt-4">
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span>0%</span>
            <span>atenção {Math.round(ratios.atencao / 100 * max * 100)}%</span>
            <span>risco {Math.round(ratios.risco / 100 * max * 100)}%</span>
            <span>crítico {Math.round(ratios.critico / 100 * max * 100)}%</span>
            <span>130%</span>
          </div>
          <div className="relative h-3 bg-slate-100 rounded mt-1 overflow-hidden">
            <div className="absolute inset-y-0 left-0 bg-emerald-200"  style={{ width: `${ratios.atencao}%` }} />
            <div className="absolute inset-y-0 bg-amber-200"            style={{ left: `${ratios.atencao}%`, width: `${ratios.risco - ratios.atencao}%` }} />
            <div className="absolute inset-y-0 bg-orange-200"           style={{ left: `${ratios.risco}%`,   width: `${ratios.critico - ratios.risco}%` }} />
            <div className="absolute inset-y-0 bg-red-300"              style={{ left: `${ratios.critico}%`, right: 0 }} />
            <div className="absolute -top-1 -bottom-1 w-1 bg-slate-900 rounded" style={{ left: `calc(${pos}% - 2px)` }} />
          </div>
          <div className="flex items-center justify-between mt-2 text-xs">
            <span className="text-slate-600">
              Taxa de consumo: <strong className="text-slate-900">{(taxa * 100).toFixed(1)}%</strong>
            </span>
            {nivelInfo && (
              <span className={`inline-flex items-center text-[11px] font-medium px-2 py-0.5 rounded border ${nivelInfo.cls}`}>
                {nivelInfo.texto}
              </span>
            )}
          </div>
        </div>

        {/* Excesso */}
        {Number(risco.excesso_dias) > 0 && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm border-t border-slate-100 pt-3">
            <Stat label="Excesso de cobertura" value={`${fmtNum(risco.excesso_dias, 1)} d`} tone="orange" />
            <Stat label="Unidades em risco"    value={fmtNum(risco.excesso_unidades)} tone="orange" />
            <Stat
              label="Valor em risco"
              value={fmtMoney(risco.valor_em_risco)}
              tone={Number(risco.valor_em_risco) >= 500 ? 'orange' : 'slate'}
            />
          </div>
        )}
      </div>
    </Card>
  );
}

// ---------------- Card wrapper ----------------
function Card({ titulo, subtitulo, children }) {
  return (
    <section>
      <h3 className="text-sm font-semibold text-slate-800">{titulo}</h3>
      {subtitulo && <p className="text-xs text-slate-500 mb-2">{subtitulo}</p>}
      {!subtitulo && <div className="mb-2" />}
      {children}
    </section>
  );
}

// ---------------- Formatters ----------------
function fmtNum(v, frac = 0) {
  if (v == null) return '—';
  return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: frac });
}
function fmtCompact(v) {
  if (v == null) return '';
  const n = Number(v);
  if (!Number.isFinite(n)) return '';
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });
}
function fmtMoney(v) {
  if (v == null) return '—';
  return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
}
function fmtData(s) {
  if (!s) return '—';
  return new Date(s + 'T00:00:00').toLocaleDateString('pt-BR');
}
function fmtPct(v) {
  if (v == null) return '—';
  const n = Number(v);
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}
