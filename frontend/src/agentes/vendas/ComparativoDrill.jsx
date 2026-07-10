/**
 * Drawer de detalhe do Comparativo: ao clicar numa linha, abre o grupo POR
 * FILIAL comparando os dois períodos, com 3 gráficos (quantidade, venda,
 * margem — Base × Comparação) e uma tabela. Reaproveita /agente/vendas/comparativo.
 */
import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
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
const DIM_KEY = {
  filial: 'filial_cod', canal: 'canal_cod', juridica: 'juridica', setor: 'setor_cod',
  departamento: 'departamento_cod', secao: 'secao_cod', fornecedor: 'fornecedor_cod',
  comprador: 'comprador_cod', produto: 'produto_cod',
};

function varPct(base, comp) {
  if (base == null || comp == null) return null;
  if (Number(base) === 0) return comp > 0 ? Infinity : (comp < 0 ? -Infinity : 0);
  return ((comp - base) / Math.abs(base)) * 100;
}
function DeltaPct({ v }) {
  if (v == null) return <span className="text-slate-400">—</span>;
  if (!isFinite(v)) return <span className="text-emerald-700 font-medium">novo</span>;
  const cls = v > 0 ? 'text-emerald-700' : v < 0 ? 'text-rose-700' : 'text-slate-500';
  return <span className={cls + ' font-medium'}>{(v > 0 ? '+' : '') + v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'}</span>;
}
function DeltaPP({ base, comp }) {
  if (base == null || comp == null) return <span className="text-slate-400">—</span>;
  const d = comp - base;
  const cls = d > 0 ? 'text-emerald-700' : d < 0 ? 'text-rose-700' : 'text-slate-500';
  return <span className={cls + ' font-medium'}>{(d > 0 ? '+' : '') + d.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' p.p.'}</span>;
}

export function ComparativoDrill({ dim, dimLabel, cod, nome, form, onClose }) {
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState('');

  useEffect(() => {
    setLoading(true); setError('');
    const base = {};
    for (const k of ['base_from', 'base_to', 'comp_from', 'comp_to']) if (form[k]) base[k] = form[k];
    for (const k of MULTI_KEYS) if (Array.isArray(form[k]) && form[k].length) base[k] = form[k].join(',');
    for (const k of TEXT_KEYS)  if ((form[k] || '').trim()) base[k] = form[k].trim();
    const key = DIM_KEY[dim];
    if (key) base[key] = cod;

    api.get('/agente/vendas/comparativo', { params: { ...base, dim: 'filial' } })
      .then(r => setRows(r.data || []))
      .catch(e => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [dim, cod, form]);

  const chart = (campo) => rows.map(r => ({
    nome: rotuloFilial(r),
    Base: Number(r[`base_${campo}`] || 0),
    Comparação: Number(r[`comp_${campo}`] || 0),
  }));

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 w-full sm:w-[min(980px,96vw)] bg-slate-50 shadow-xl overflow-y-auto">
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">{dimLabel} · comparativo por filial</p>
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
              <ChartBox titulo="Quantidade — Base × Comparação" data={chart('qtd')}
                tickFmt={num} tipFmt={num} />
              <ChartBox titulo="Venda — Base × Comparação" data={chart('venda')}
                tickFmt={moneyShort} tipFmt={money} />
              <ChartBox titulo="Margem % — Base × Comparação" data={chart('margem')}
                tickFmt={(v) => v + '%'} tipFmt={pct} />

              {/* Tabela por filial */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-slate-800">Detalhe por filial</h3>
                  <span className="text-xs text-slate-500">{rows.length} filial(is)</span>
                </div>
                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th rowSpan={2} className="text-left p-3 align-bottom">Filial</th>
                        <th colSpan={3} className="text-center p-2 border-l border-slate-200">Quantidade</th>
                        <th colSpan={3} className="text-center p-2 border-l border-slate-200">Venda</th>
                        <th colSpan={3} className="text-center p-2 border-l border-slate-200">Margem</th>
                      </tr>
                      <tr className="text-xs">
                        <th className="text-right p-2 border-l border-slate-200">Base</th><th className="text-right p-2">Comp.</th><th className="text-right p-2">Δ</th>
                        <th className="text-right p-2 border-l border-slate-200">Base</th><th className="text-right p-2">Comp.</th><th className="text-right p-2">Δ</th>
                        <th className="text-right p-2 border-l border-slate-200">Base</th><th className="text-right p-2">Comp.</th><th className="text-right p-2">Δ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={(r.grupo_cod || '') + i} className="border-t border-slate-100">
                          <td className="p-3 font-medium text-slate-800">
                            {r.grupo_cod && <span className="font-mono text-xs text-slate-500 mr-2">{r.grupo_cod}</span>}
                            {r.grupo_nome || ''}
                          </td>
                          <td className="p-2 text-right border-l border-slate-100">{num(r.base_qtd)}</td>
                          <td className="p-2 text-right">{num(r.comp_qtd)}</td>
                          <td className="p-2 text-right"><DeltaPct v={varPct(r.base_qtd, r.comp_qtd)} /></td>
                          <td className="p-2 text-right border-l border-slate-100">{money(r.base_venda)}</td>
                          <td className="p-2 text-right">{money(r.comp_venda)}</td>
                          <td className="p-2 text-right"><DeltaPct v={varPct(r.base_venda, r.comp_venda)} /></td>
                          <td className="p-2 text-right border-l border-slate-100">{pct(r.base_margem)}</td>
                          <td className="p-2 text-right">{pct(r.comp_margem)}</td>
                          <td className="p-2 text-right"><DeltaPP base={r.base_margem} comp={r.comp_margem} /></td>
                        </tr>
                      ))}
                      {rows.length === 0 && (
                        <tr><td colSpan={10} className="p-6 text-center text-slate-500">Sem dados.</td></tr>
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

function rotuloFilial(r) {
  const c = r.grupo_cod ? String(r.grupo_cod) : '';
  const n = r.grupo_nome ? String(r.grupo_nome) : '';
  const s = c && n ? `${c} - ${n}` : (c || n || '—');
  return s.length > 22 ? s.slice(0, 22) : s;
}

function ChartBox({ titulo, data, tickFmt, tipFmt }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="font-semibold text-slate-800 mb-3">{titulo}</h3>
      <div style={{ width: '100%', height: 240 }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 8, right: 12, left: 8, bottom: 48 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="nome" angle={-30} textAnchor="end" interval={0} height={54} tick={{ fontSize: 11, fill: '#475569' }} />
            <YAxis tickFormatter={tickFmt} tick={{ fontSize: 11, fill: '#475569' }} width={60} />
            <Tooltip formatter={(v) => tipFmt(v)} />
            <Legend />
            <Line type="monotone" dataKey="Base" stroke="#94a3b8" strokeWidth={2} dot={{ r: 2 }} />
            <Line type="monotone" dataKey="Comparação" stroke="#0EA5E9" strokeWidth={2} dot={{ r: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
