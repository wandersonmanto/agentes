import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, TrendingDown, TrendingUp } from 'lucide-react';
import { api } from '../../lib/api';

const NIVEL_LABEL = {
  loja:         'Filial',
  setor:        'Setor',
  departamento: 'Departamento',
  secao:        'Seção',
};

const NIVEL_BADGE = {
  loja:         'bg-slate-200 text-slate-800',
  setor:        'bg-indigo-100 text-indigo-800',
  departamento: 'bg-sky-100 text-sky-800',
  secao:        'bg-teal-100 text-teal-800',
};

export function Lista() {
  const [itens, setItens]           = useState([]);
  const [resumo, setResumo]         = useState([]);
  const [loading, setLoading]       = useState(true);
  const [nivel, setNivel]           = useState('');
  const [filial, setFilial]         = useState('');
  const [somenteRisco, setSomenteRisco] = useState(true);
  const [sort, setSort]             = useState({ by: 'percent_atingido', dir: 'asc' });

  // Carrega resumo por filial uma vez para alimentar o select de filiais.
  useEffect(() => {
    api.get('/agente/metas/resumo-filial')
      .then(r => setResumo(r.data))
      .catch(err => console.error('resumo-filial', err));
  }, []);

  function carregar() {
    setLoading(true);
    const params = { somente_risco: somenteRisco };
    if (nivel) params.nivel = nivel;
    if (filial) params.filial = filial;
    api.get('/agente/metas/lista', { params })
      .then(r => setItens(r.data))
      .finally(() => setLoading(false));
  }
  useEffect(carregar, [nivel, filial, somenteRisco]);

  const itensOrdenados = useMemo(() => {
    const list = [...itens];
    list.sort((a, b) => {
      const va = Number(a[sort.by] ?? 0);
      const vb = Number(b[sort.by] ?? 0);
      const cmp = va - vb;
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [itens, sort]);

  function toggleSort(by) {
    setSort(s => s.by === by ? { by, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { by, dir: 'asc' });
  }

  function SortIcon({ col }) {
    if (sort.by !== col) return <ArrowUpDown size={12} className="inline ml-1 opacity-40" />;
    return sort.dir === 'asc'
      ? <ArrowUp   size={12} className="inline ml-1" />
      : <ArrowDown size={12} className="inline ml-1" />;
  }

  function fmtMoney(v) {
    if (v == null) return '—';
    return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  }
  function fmtPct(v) {
    if (v == null) return '—';
    return Number(v).toFixed(1) + '%';
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Cards resumo por filial */}
      {resumo.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-700 mb-2">Resumo por filial</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {resumo.map(r => (
              <button
                key={r.filial_cod}
                onClick={() => setFilial(filial === r.filial_cod ? '' : r.filial_cod)}
                className={
                  'text-left rounded-lg border p-4 transition ' +
                  (filial === r.filial_cod
                    ? 'border-emerald-500 bg-emerald-50'
                    : 'border-slate-200 bg-white hover:border-slate-300')
                }
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500">{r.filial_cod}</span>
                  {r.loja_em_risco
                    ? <span className="inline-flex items-center gap-1 text-xs text-red-700 bg-red-50 px-2 py-0.5 rounded">
                        <TrendingDown size={12} /> risco
                      </span>
                    : <span className="inline-flex items-center gap-1 text-xs text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded">
                        <TrendingUp size={12} /> ok
                      </span>
                  }
                </div>
                <div className="mt-1 text-sm font-medium text-slate-900 line-clamp-1">
                  {r.filial_desc || r.filial_cod}
                </div>
                <div className="mt-2 text-xs text-slate-600 grid grid-cols-2 gap-x-2 gap-y-0.5">
                  <span>Venda:</span>            <span className="text-right">{fmtMoney(r.venda_loja)}</span>
                  <span>Meta:</span>             <span className="text-right">{fmtMoney(r.meta_loja_venda)}</span>
                  <span>Tendência:</span>        <span className="text-right">{fmtMoney(r.tendencia_loja)}</span>
                  <span>% atingido:</span>       <span className="text-right">{fmtPct(r.percent_loja)}</span>
                  {r.loja_em_risco && r.venda_para_recuperar_loja != null && (
                    <>
                      <span className="text-red-700 font-medium">Recuperar:</span>
                      <span className="text-right text-red-700 font-medium">
                        {fmtMoney(r.venda_para_recuperar_loja)}/dia
                        {r.dias_restantes_loja != null && (
                          <span className="text-slate-400 font-normal"> · {r.dias_restantes_loja}d</span>
                        )}
                      </span>
                    </>
                  )}
                </div>
                <div className="mt-2 flex gap-1 text-[11px]">
                  {r.setores_em_risco > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">
                      {r.setores_em_risco} setor(es)
                    </span>
                  )}
                  {r.departamentos_em_risco > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-sky-50 text-sky-700">
                      {r.departamentos_em_risco} dept(s)
                    </span>
                  )}
                  {r.secoes_em_risco > 0 && (
                    <span className="px-1.5 py-0.5 rounded bg-teal-50 text-teal-700">
                      {r.secoes_em_risco} seç(ões)
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Lista detalhada */}
      <div className="flex flex-col">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-baseline gap-3">
            <h2 className="text-base font-semibold">
              {somenteRisco ? 'Itens em risco' : 'Todos os itens'}
            </h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-medium">
              {loading ? '...' : `${itens.length} ${itens.length === 1 ? 'item' : 'itens'}`}
            </span>
            {filial && (
              <button
                onClick={() => setFilial('')}
                className="text-xs text-emerald-700 hover:text-emerald-900 underline"
              >
                limpar filial ({filial})
              </button>
            )}
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <select
              value={nivel}
              onChange={e => setNivel(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white"
            >
              <option value="">Todos os níveis</option>
              <option value="loja">Filial</option>
              <option value="setor">Setor</option>
              <option value="departamento">Departamento</option>
              <option value="secao">Seção</option>
            </select>
            <label className="text-sm text-slate-600 flex items-center gap-1">
              <input
                type="checkbox"
                checked={somenteRisco}
                onChange={e => setSomenteRisco(e.target.checked)}
              />
              só em risco
            </label>
          </div>
        </div>

        {loading ? (
          <p className="text-slate-500">Carregando...</p>
        ) : (
          <div className="overflow-y-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 sticky top-0 z-10 shadow-[0_1px_0_0_rgb(226_232_240)]">
                <tr>
                  <th className="text-left p-3">Nível</th>
                  <th className="text-left p-3">Filial</th>
                  <th className="text-left p-3">Descrição</th>
                  <th className="text-right p-3 cursor-pointer select-none hover:bg-slate-100"
                      onClick={() => toggleSort('venda')}>
                    Venda<SortIcon col="venda" />
                  </th>
                  <th className="text-right p-3">Meta</th>
                  <th className="text-right p-3 cursor-pointer select-none hover:bg-slate-100"
                      onClick={() => toggleSort('tendencia')}>
                    Tendência<SortIcon col="tendencia" />
                  </th>
                  <th className="text-right p-3 cursor-pointer select-none hover:bg-slate-100"
                      onClick={() => toggleSort('percent_atingido')}>
                    % atingido<SortIcon col="percent_atingido" />
                  </th>
                  <th className="text-right p-3 cursor-pointer select-none hover:bg-slate-100"
                      onClick={() => toggleSort('desvio_tendencia')}>
                    Δ tendência<SortIcon col="desvio_tendencia" />
                  </th>
                  <th className="text-right p-3">Venda/dia ideal</th>
                  <th
                    className="text-right p-3 cursor-pointer select-none hover:bg-slate-100"
                    onClick={() => toggleSort('venda_para_recuperar')}
                    title="Quanto precisa vender por dia, no que resta do mês, para bater a meta"
                  >
                    Recuperar/dia<SortIcon col="venda_para_recuperar" />
                  </th>
                </tr>
              </thead>
              <tbody>
                {itensOrdenados.map(it => (
                  <tr key={it.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="p-3">
                      <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded ${NIVEL_BADGE[it.nivel] || ''}`}>
                        {NIVEL_LABEL[it.nivel] || it.nivel}
                      </span>
                    </td>
                    <td className="p-3 text-slate-700">{it.filial_cod}</td>
                    <td className="p-3 font-medium text-slate-900">
                      {it.descricao || '—'}
                      {it.cod && <span className="text-xs text-slate-500 ml-1">#{it.cod}</span>}
                    </td>
                    <td className="p-3 text-right">{fmtMoney(it.venda)}</td>
                    <td className="p-3 text-right text-slate-500">{fmtMoney(it.meta_venda)}</td>
                    <td className="p-3 text-right">{fmtMoney(it.tendencia)}</td>
                    <td className={'p-3 text-right font-medium ' + (it.em_risco ? 'text-red-700' : 'text-emerald-700')}>
                      {fmtPct(it.percent_atingido)}
                    </td>
                    <td className={'p-3 text-right ' + (Number(it.desvio_tendencia) < 0 ? 'text-red-600' : 'text-emerald-600')}>
                      {fmtMoney(it.desvio_tendencia)}
                    </td>
                    <td className="p-3 text-right text-slate-600">{fmtMoney(it.venda_ideal_dia)}</td>
                    <td className={'p-3 text-right ' + (it.em_risco ? 'text-red-700 font-medium' : 'text-slate-500')}>
                      {it.venda_para_recuperar == null
                        ? '—'
                        : <>
                            {fmtMoney(it.venda_para_recuperar)}
                            {it.dias_restantes != null && (
                              <span className="text-[10px] text-slate-400 font-normal ml-1">/{it.dias_restantes}d</span>
                            )}
                          </>
                      }
                    </td>
                  </tr>
                ))}
                {itensOrdenados.length === 0 && (
                  <tr>
                    <td colSpan={10} className="p-8 text-center text-slate-500">
                      Nenhum item.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
