/**
 * Visão dimensional — só para diretor/admin/supervisor.
 * Mostra agregação por filial, fornecedor, setor, departamento ou seção,
 * com a distribuição de banda + valor de estoque + produtos em risco
 * + deltas 7d/30d em cada banda.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { api } from '../../lib/api';

const DIMENSOES = [
  { key: 'filial',       label: 'Filial',        chaveCol: 'filial_cod',   descCol: 'filial_desc' },
  { key: 'fornecedor',   label: 'Fornecedor',    chaveCol: 'fornecedor',   descCol: 'fornecedor_desc' },
  { key: 'setor',        label: 'Setor',         chaveCol: 'setor',        descCol: 'setor_desc' },
  { key: 'departamento', label: 'Departamento',  chaveCol: 'departamento', descCol: 'departamento_desc' },
  { key: 'secao',        label: 'Seção',         chaveCol: 'chave_secao',  descCol: 'secao_desc' },
];

export function Dimensoes() {
  const [dim, setDim]         = useState('filial');
  const [itens, setItens]     = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro]       = useState('');
  const [busca, setBusca]     = useState('');
  const [sort, setSort]       = useState({ by: 'produtos_em_risco', dir: 'desc' });

  const dimDef = DIMENSOES.find(d => d.key === dim);

  useEffect(() => {
    setLoading(true);
    setErro('');
    api.get(`/agente/supervisor_estoque/dim/${dim}`, { params: { limit: 500 } })
      .then(r => setItens(r.data))
      .catch(e => setErro(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [dim]);

  const itensFiltrados = useMemo(() => {
    let list = itens;
    if (busca.trim()) {
      const q = busca.trim().toLowerCase();
      list = list.filter(it =>
        String(it[dimDef.chaveCol] || '').toLowerCase().includes(q)
        || String(it[dimDef.descCol] || '').toLowerCase().includes(q)
      );
    }
    const sorted = [...list];
    sorted.sort((a, b) => {
      let va = a[sort.by]; let vb = b[sort.by];
      if (typeof va === 'string' || typeof vb === 'string') {
        va = String(va || ''); vb = String(vb || '');
        const cmp = va.localeCompare(vb, 'pt-BR');
        return sort.dir === 'asc' ? cmp : -cmp;
      }
      va = Number(va ?? 0); vb = Number(vb ?? 0);
      const cmp = va - vb;
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [itens, busca, sort, dimDef]);

  function toggleSort(by) {
    setSort(s => s.by === by ? { by, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { by, dir: 'desc' });
  }
  function SortIcon({ col }) {
    if (sort.by !== col) return <ArrowUpDown size={12} className="inline ml-1 opacity-40" />;
    return sort.dir === 'asc'
      ? <ArrowUp size={12} className="inline ml-1" />
      : <ArrowDown size={12} className="inline ml-1" />;
  }
  function fmtNum(v) {
    if (v == null) return '—';
    return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  }
  function fmtDelta(v) {
    if (v == null || Number(v) === 0) return <span className="text-slate-400">—</span>;
    const n = Number(v);
    const cls = n > 0 ? 'text-rose-700' : 'text-emerald-700';
    const sign = n > 0 ? '+' : '';
    return <span className={cls}>{sign}{fmtNum(v)}</span>;
  }
  function fmtMoney(v) {
    if (v == null) return '—';
    return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Tabs de dimensão */}
      <div className="flex gap-2 flex-wrap">
        {DIMENSOES.map(d => (
          <button
            key={d.key}
            onClick={() => setDim(d.key)}
            className={
              'px-3 py-1.5 text-sm font-medium rounded-md transition ' +
              (dim === d.key
                ? 'bg-rose-100 text-rose-800 ring-2 ring-rose-300'
                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50')
            }
          >
            {d.label}
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs font-medium">
          {loading ? '...' : `${itensFiltrados.length} ${itensFiltrados.length === 1 ? 'linha' : 'linhas'}`}
        </span>
        <input
          type="search"
          placeholder={`Buscar ${dimDef.label.toLowerCase()}...`}
          value={busca}
          onChange={e => setBusca(e.target.value)}
          className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white w-72"
        />
      </div>

      {erro && <p className="text-red-600">{erro}</p>}

      {loading ? (
        <p className="text-slate-500">Carregando...</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 sticky top-0 z-10 shadow-[0_1px_0_0_rgb(226_232_240)]">
              <tr>
                <th className="text-left p-3">{dimDef.label}</th>
                <th className="text-right p-3 cursor-pointer hover:bg-slate-100" onClick={() => toggleSort('produtos')}>
                  Produtos<SortIcon col="produtos" />
                </th>
                <th className="text-right p-3 cursor-pointer hover:bg-slate-100" onClick={() => toggleSort('banda_constante')}>
                  Const.<SortIcon col="banda_constante" />
                </th>
                <th className="text-right p-3 cursor-pointer hover:bg-slate-100" onClick={() => toggleSort('banda_medio')}>
                  Médio<SortIcon col="banda_medio" />
                </th>
                <th className="text-right p-3 cursor-pointer hover:bg-slate-100" onClick={() => toggleSort('banda_baixo')}>
                  Baixo<SortIcon col="banda_baixo" />
                </th>
                <th className="text-right p-3 cursor-pointer hover:bg-slate-100" onClick={() => toggleSort('banda_critico')}>
                  Crítico<SortIcon col="banda_critico" />
                </th>
                <th className="text-right p-3 cursor-pointer hover:bg-slate-100" onClick={() => toggleSort('produtos_em_risco')}>
                  Em risco (≤7d)<SortIcon col="produtos_em_risco" />
                </th>
                <th className="text-right p-3 cursor-pointer hover:bg-slate-100" onClick={() => toggleSort('valor_estoque')}>
                  Valor estoque<SortIcon col="valor_estoque" />
                </th>
                <th className="text-right p-3" title="Δ Crítico 7d">Δ Crít. 7d</th>
                <th className="text-right p-3" title="Δ Crítico 30d">Δ Crít. 30d</th>
              </tr>
            </thead>
            <tbody>
              {itensFiltrados.map(r => (
                <tr key={r[dimDef.chaveCol]} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="p-3 font-medium">
                    <span className="font-mono text-xs text-slate-500 mr-2">{r[dimDef.chaveCol]}</span>
                    <span className="text-slate-700">{r[dimDef.descCol] || ''}</span>
                  </td>
                  <td className="p-3 text-right">{fmtNum(r.produtos)}</td>
                  <td className="p-3 text-right text-emerald-700">{fmtNum(r.banda_constante)}</td>
                  <td className="p-3 text-right text-sky-700">{fmtNum(r.banda_medio)}</td>
                  <td className="p-3 text-right text-amber-700">{fmtNum(r.banda_baixo)}</td>
                  <td className="p-3 text-right text-red-700 font-semibold">{fmtNum(r.banda_critico)}</td>
                  <td className="p-3 text-right text-rose-700 font-semibold">{fmtNum(r.produtos_em_risco)}</td>
                  <td className="p-3 text-right text-slate-700">{fmtMoney(r.valor_estoque)}</td>
                  <td className="p-3 text-right">{fmtDelta(r.delta_critico_7d)}</td>
                  <td className="p-3 text-right">{fmtDelta(r.delta_critico_30d)}</td>
                </tr>
              ))}
              {itensFiltrados.length === 0 && (
                <tr>
                  <td colSpan={10} className="p-8 text-center text-slate-500">Sem dados.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
