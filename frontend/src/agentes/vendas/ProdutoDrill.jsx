/**
 * Drawer do produto (aba Estoque): mostra a série diária de VENDA × ESTOQUE
 * e o mesmo produto em TODAS as filiais (cobertura, status, sugestão) —
 * o que revela desequilíbrio entre lojas (uma em ruptura, outra em excesso).
 *
 * Os pontos de estoque marcados como "derivado" são os dias reconstruídos
 * (domingo = sábado − venda do domingo).
 */
import { useEffect, useState } from 'react';
import { X, AlertTriangle, AlertCircle, CheckCircle2, PackageX, Layers } from 'lucide-react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, Legend,
  ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { api } from '../../lib/api';

const money = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num   = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const num2  = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });

const STATUS = {
  ruptura:  { label: 'Ruptura',  cls: 'bg-rose-100 text-rose-800',       Icon: PackageX },
  critico:  { label: 'Crítico',  cls: 'bg-orange-100 text-orange-800',   Icon: AlertTriangle },
  atencao:  { label: 'Atenção',  cls: 'bg-amber-100 text-amber-800',     Icon: AlertCircle },
  ok:       { label: 'OK',       cls: 'bg-emerald-100 text-emerald-800', Icon: CheckCircle2 },
  excesso:  { label: 'Excesso',  cls: 'bg-sky-100 text-sky-800',         Icon: Layers },
  sem_giro: { label: 'Sem giro', cls: 'bg-slate-100 text-slate-600',     Icon: Layers },
};

const fmtDiaCurto = (s) => {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}` : String(s || '');
};

export function ProdutoDrill({ produto, form, onClose }) {
  const [serie, setSerie]       = useState([]);
  const [porFilial, setPorFilial] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

  const { produto_cod, produto_nome, filial_cod, fornecedor_cod, fornecedor_nome } = produto;

  useEffect(() => {
    setLoading(true); setError('');

    // a série cobre o período de venda + a foto do estoque (que pode ser posterior)
    const ate = (form.data_estoque && form.data_estoque > form.to) ? form.data_estoque : form.to;

    const paramsCob = {
      from: form.from, to: form.to,
      lead_time: form.lead_time,
      dias_seguranca: form.dias_seguranca,
      dias_excesso: form.dias_excesso,
      produto_cod,                       // este produto, em TODAS as filiais
    };
    if (form.data_estoque) paramsCob.data_estoque = form.data_estoque;

    Promise.all([
      api.get('/agente/vendas/produto-serie', {
        params: { produto: produto_cod, from: form.from, to: ate, filial: filial_cod },
      }).then(r => r.data),
      api.get('/agente/vendas/cobertura', { params: paramsCob }).then(r => r.data),
    ]).then(([s, pf]) => {
      setSerie(s || []);
      setPorFilial(pf || []);
    }).catch(e => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [produto_cod, filial_cod, form]);

  const chartData = serie.map(r => ({
    dia: fmtDiaCurto(r.dia),
    Venda: Number(r.qtd_vendida || 0),
    Estoque: r.disponivel == null ? null : Number(r.disponivel),
    derivado: r.origem === 'derivado',
  }));
  const temDerivado = serie.some(r => r.origem === 'derivado');

  return (
    <div className="fixed inset-0 z-40">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <div className="absolute inset-y-0 right-0 w-full sm:w-[min(1040px,96vw)] bg-slate-50 shadow-xl overflow-y-auto">
        <div className="sticky top-0 z-10 bg-white border-b border-slate-200 px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-xs text-slate-500">Produto · filial {filial_cod}</p>
            <h2 className="text-lg font-semibold text-slate-900">
              <span className="font-mono text-sm text-slate-500 mr-2">{produto_cod}</span>
              {produto_nome || ''}
            </h2>
            {(fornecedor_cod || fornecedor_nome) && (
              <p className="text-xs text-slate-600 mt-0.5">
                <span className="text-slate-400">Fornecedor:</span>{' '}
                <span className="font-mono text-slate-500">{fornecedor_cod}</span>{' '}
                <span className="font-medium">{fornecedor_nome || ''}</span>
              </p>
            )}
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={20} /></button>
        </div>

        <div className="p-5 space-y-6">
          {error && <p className="text-red-600 text-sm">{error}</p>}
          {loading && <p className="text-slate-500">Carregando...</p>}

          {!loading && (
            <>
              {/* Série: venda (barras) × estoque (linha) */}
              <section className="rounded-xl border border-slate-200 bg-white p-4">
                <h3 className="font-semibold text-slate-800 mb-1">Venda × Estoque por dia — filial {filial_cod}</h3>
                <p className="text-xs text-slate-500 mb-3">
                  Barras = quantidade vendida. Linha = estoque disponível.
                  {temDerivado && ' Os domingos são estoque reconstruído (sábado − venda do domingo).'}
                </p>
                <div style={{ width: '100%', height: 300 }}>
                  <ResponsiveContainer>
                    <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 8, bottom: 24 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis dataKey="dia" tick={{ fontSize: 11, fill: '#475569' }} />
                      <YAxis yAxisId="v" tick={{ fontSize: 11, fill: '#475569' }} width={56} />
                      <YAxis yAxisId="e" orientation="right" tick={{ fontSize: 11, fill: '#0ea5e9' }} width={56} />
                      <Tooltip formatter={(v) => num2(v)} />
                      <Legend />
                      <Bar yAxisId="v" dataKey="Venda" fill="#94a3b8" radius={[3, 3, 0, 0]} />
                      <Line yAxisId="e" type="monotone" dataKey="Estoque" stroke="#0EA5E9" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </section>

              {/* Mesmo produto nas outras filiais */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-slate-800">Este produto nas filiais</h3>
                  <span className="text-xs text-slate-500">{porFilial.length} filial(is)</span>
                </div>
                <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="text-left p-3">Filial</th>
                        <th className="text-right p-3">Vendido</th>
                        <th className="text-right p-3">Média/dia</th>
                        <th className="text-right p-3">Disponível</th>
                        <th className="text-right p-3">Cobertura</th>
                        <th className="text-center p-3">Status</th>
                        <th className="text-right p-3">Sugestão (un)</th>
                        <th className="text-right p-3">Custo</th>
                      </tr>
                    </thead>
                    <tbody>
                      {porFilial.map((r, i) => {
                        const st = STATUS[r.status] || STATUS.sem_giro;
                        const atual = r.filial_cod === filial_cod;
                        return (
                          <tr key={r.filial_cod + i}
                            className={'border-t border-slate-100 ' + (atual ? 'bg-sky-50/60' : '')}>
                            <td className="p-3 font-medium text-slate-800">
                              <span className="font-mono text-xs text-slate-500 mr-2">{r.filial_cod}</span>
                              {r.filial_nome || ''}
                              {atual && <span className="ml-2 text-[10px] text-sky-700">(atual)</span>}
                            </td>
                            <td className="p-3 text-right">{num2(r.qtd_vendida)}</td>
                            <td className="p-3 text-right font-medium">{num2(r.media_diaria)}</td>
                            <td className="p-3 text-right">{num2(r.disponivel)}</td>
                            <td className="p-3 text-right">{r.cobertura_dias == null ? '—' : num2(r.cobertura_dias) + ' d'}</td>
                            <td className="p-3 text-center">
                              <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${st.cls}`}>
                                <st.Icon size={13} /> {st.label}
                              </span>
                            </td>
                            <td className={'p-3 text-right font-semibold ' + (Number(r.sugestao_compra) > 0 ? 'text-sky-800' : 'text-slate-400')}>
                              {num(r.sugestao_compra)}
                            </td>
                            <td className="p-3 text-right">{Number(r.custo_sugestao) > 0 ? money(r.custo_sugestao) : '—'}</td>
                          </tr>
                        );
                      })}
                      {porFilial.length === 0 && (
                        <tr><td colSpan={8} className="p-6 text-center text-slate-500">Sem dados.</td></tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-xs text-slate-400">
                  Se uma filial está em ruptura e outra em excesso, pode haver transferência em vez de compra.
                </p>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
