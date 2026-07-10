/**
 * Drawer de detalhe: ao clicar numa linha do painel, mostra aquele grupo
 * aberto POR FILIAL (tabela + gráfico de barras) e POR DIA (gráfico de linhas)
 * no mesmo período/filtros. Reaproveita /agente/vendas/resumo.
 */
import { useEffect, useState } from 'react';
import { X, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { api } from '../../lib/api';

const money = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num   = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const pct   = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%');
const moneyShort = (v) => {
  const n = Number(v || 0);
  if (Math.abs(n) >= 1e6) return 'R$ ' + (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return 'R$ ' + (n / 1e3).toFixed(0) + 'k';
  return 'R$ ' + n.toFixed(0);
};

const MULTI_KEYS = ['filial_cod', 'canal_cod', 'juridica', 'setor_cod', 'departamento_cod', 'secao_cod', 'comprador_cod'];
const TEXT_KEYS  = ['fornecedor_cod', 'produto_cod'];
// dimensão do painel -> chave de filtro para "prender" no item clicado
const DIM_KEY = {
  filial: 'filial_cod', canal: 'canal_cod', juridica: 'juridica', setor: 'setor_cod',
  departamento: 'departamento_cod', secao: 'secao_cod', fornecedor: 'fornecedor_cod',
  comprador: 'comprador_cod', produto: 'produto_cod',
};

export function DrillDown({ dim, dimLabel, cod, nome, form, onClose, comTendencia = false }) {
  const [byFilial, setByFilial] = useState([]);
  const [byDia, setByDia]       = useState([]);
  const [tendMap, setTendMap]   = useState({}); // filial_cod -> { tendencia, slope_pct_dia }
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

  useEffect(() => {
    setLoading(true); setError('');
    const base = {};
    if (form.from) base.from = form.from;
    if (form.to)   base.to   = form.to;
    for (const k of MULTI_KEYS) if (Array.isArray(form[k]) && form[k].length) base[k] = form[k].join(',');
    for (const k of TEXT_KEYS)  if ((form[k] || '').trim()) base[k] = form[k].trim();
    const key = DIM_KEY[dim];
    if (key) base[key] = cod; // prende no item clicado

    const calls = [
      api.get('/agente/vendas/resumo', { params: { ...base, dim: 'filial' } }).then(r => r.data),
      api.get('/agente/vendas/resumo', { params: { ...base, dim: 'dia' } }).then(r => r.data),
    ];
    if (comTendencia) {
      calls.push(api.get('/agente/vendas/tendencia', { params: { ...base, dim: 'filial' } }).then(r => r.data));
    }
    Promise.all(calls).then(([f, d, t]) => {
      setByFilial(f || []);
      setByDia((d || []).slice().sort((a, b) => String(a.grupo_cod).localeCompare(String(b.grupo_cod))));
      if (comTendencia) {
        const m = {};
        for (const r of (t || [])) m[r.grupo_cod ?? ''] = r;
        setTendMap(m);
      }
    }).catch(e => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [dim, cod, form, comTendencia]);

  const barData = byFilial.map(r => {
    const c = r.grupo_cod ? String(r.grupo_cod) : '';
    const n = r.grupo_nome ? String(r.grupo_nome) : '';
    const s = c && n ? `${c} - ${n}` : (c || n || '—');
    return { nome: s.length > 22 ? s.slice(0, 22) : s, venda: Number(r.venda_total || 0) };
  });
  const lineData = byDia.map(r => ({
    dia: fmtDiaCurto(r.grupo_cod),
    venda: Number(r.venda_total || 0),
    margem: r.margem_pct == null ? null : Number(r.margem_pct),
  }));

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 w-full sm:w-[min(1100px,96vw)] bg-slate-50 shadow-xl overflow-y-auto">
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">{dimLabel}</p>
            <h2 className="text-lg font-semibold text-slate-900">
              {cod && <span className="font-mono text-sm text-slate-500 mr-2">{cod}</span>}{nome || ''}
            </h2>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-6">
          {error && <p className="text-red-600 text-sm">{error}</p>}
          {loading && <p className="text-slate-500">Carregando...</p>}

          {!loading && (
            <>
              {/* Barras por filial */}
              <section className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="font-semibold text-slate-800 mb-3">Venda por filial</h3>
                <div style={{ width: '100%', height: 260 }}>
                  <ResponsiveContainer>
                    <BarChart data={barData} margin={{ top: 8, right: 12, left: 8, bottom: 48 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="nome" angle={-30} textAnchor="end" interval={0} height={54} tick={{ fontSize: 11, fill: '#475569' }} />
                      <YAxis tickFormatter={moneyShort} tick={{ fontSize: 11, fill: '#475569' }} width={60} />
                      <Tooltip formatter={(v) => money(v)} />
                      <Bar dataKey="venda" fill="#0EA5E9" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>

              {/* Linhas por dia */}
              <section className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="font-semibold text-slate-800 mb-3">Evolução diária</h3>
                <div style={{ width: '100%', height: 260 }}>
                  <ResponsiveContainer>
                    <LineChart data={lineData} margin={{ top: 8, right: 16, left: 8, bottom: 24 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="dia" tick={{ fontSize: 11, fill: '#475569' }} />
                      <YAxis yAxisId="v" tickFormatter={moneyShort} tick={{ fontSize: 11, fill: '#475569' }} width={60} />
                      <YAxis yAxisId="m" orientation="right" tickFormatter={(v) => v + '%'} tick={{ fontSize: 11, fill: '#94a3b8' }} width={44} />
                      <Tooltip formatter={(v, n) => (n === 'Margem' ? pct(v) : money(v))} />
                      <Legend />
                      <Line yAxisId="v" type="monotone" dataKey="venda" name="Venda" stroke="#0EA5E9" strokeWidth={2} dot={{ r: 2 }} />
                      <Line yAxisId="m" type="monotone" dataKey="margem" name="Margem" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </section>

              {/* Tabela por filial */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-slate-800">Detalhe por filial</h3>
                  <span className="text-xs text-slate-500">{byFilial.length} filial(is)</span>
                </div>
                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="text-left p-3">Filial</th>
                        <th className="text-right p-3">Qtd</th>
                        <th className="text-right p-3">Venda R$</th>
                        <th className="text-right p-3">Custo R$</th>
                        <th className="text-right p-3">Lucro R$</th>
                        <th className="text-right p-3">Margem</th>
                        <th className="text-right p-3">Lucro líq. R$</th>
                        <th className="text-right p-3">Margem líq.</th>
                        <th className="text-right p-3">Venda/dia</th>
                        <th className="text-right p-3">Impostos R$</th>
                        {comTendencia && <th className="text-center p-3">Tendência</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {byFilial.map((r, i) => (
                        <tr key={(r.grupo_cod || '') + i} className="border-t border-slate-100">
                          <td className="p-3 font-medium text-slate-800">
                            {r.grupo_cod && <span className="font-mono text-xs text-slate-500 mr-2">{r.grupo_cod}</span>}
                            {r.grupo_nome || ''}
                          </td>
                          <td className="p-3 text-right">{num(r.qtd_total)}</td>
                          <td className="p-3 text-right font-semibold text-slate-900">{money(r.venda_total)}</td>
                          <td className="p-3 text-right">{money(r.custo_total)}</td>
                          <td className={'p-3 text-right ' + (Number(r.lucro_bruto) < 0 ? 'text-rose-700' : 'text-emerald-700')}>{money(r.lucro_bruto)}</td>
                          <td className={'p-3 text-right ' + (Number(r.margem_pct) < 0 ? 'text-rose-700' : 'text-slate-700')}>{pct(r.margem_pct)}</td>
                          <td className={'p-3 text-right font-medium ' + (Number(r.lucro_liquido) < 0 ? 'text-rose-700' : 'text-emerald-700')}>{money(r.lucro_liquido)}</td>
                          <td className={'p-3 text-right ' + (Number(r.margem_liquida) < 0 ? 'text-rose-700' : 'text-slate-700')}>{pct(r.margem_liquida)}</td>
                          <td className="p-3 text-right">{money(r.venda_media_dia)}</td>
                          <td className="p-3 text-right text-amber-700">{money(r.imposto_total)}</td>
                          {comTendencia && (
                            <td className="p-3 text-center"><TendBadge tend={tendMap[r.grupo_cod ?? '']?.tendencia} /></td>
                          )}
                        </tr>
                      ))}
                      {byFilial.length === 0 && (
                        <tr><td colSpan={comTendencia ? 11 : 10} className="p-6 text-center text-slate-500">Sem dados.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function fmtDiaCurto(s) {
  if (!s) return '';
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}` : String(s);
}

const TENDCFG = {
  crescimento:  { label: 'Crescimento', cls: 'bg-emerald-100 text-emerald-800', Icon: TrendingUp },
  queda:        { label: 'Queda',       cls: 'bg-rose-100 text-rose-800',       Icon: TrendingDown },
  estavel:      { label: 'Estável',     cls: 'bg-slate-100 text-slate-700',     Icon: Minus },
  insuficiente: { label: 'Insuf.',      cls: 'bg-slate-50 text-slate-400',      Icon: Minus },
};
function TendBadge({ tend }) {
  const cfg = TENDCFG[tend] || TENDCFG.insuficiente;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${cfg.cls}`}>
      <cfg.Icon size={13} /> {cfg.label}
    </span>
  );
}
