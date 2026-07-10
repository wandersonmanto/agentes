import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, AlertCircle } from 'lucide-react';
import { api } from '../../lib/api';
import { useMe } from '../../hooks/useMe';

export function Lista() {
  const { me } = useMe();
  const podeVerResumo = me && ['diretor', 'admin', 'supervisor', 'gerente'].includes(me.papel);

  const [itens, setItens]               = useState([]);
  const [resumo, setResumo]             = useState([]);
  const [loading, setLoading]           = useState(true);
  const [filial, setFilial]             = useState('');
  const [status, setStatus]             = useState('pendente');
  const [busca, setBusca]               = useState('');
  const [sort, setSort]                 = useState({ by: 'estoque_deposito', dir: 'desc' });

  // Resumo por filial — alimenta os cards de topo
  useEffect(() => {
    if (!podeVerResumo) return;
    api.get('/agente/comparativo313/resumo-filial')
      .then(r => setResumo(r.data))
      .catch(err => console.error('resumo-filial', err));
  }, [podeVerResumo]);

  function carregar() {
    setLoading(true);
    const params = { status };
    if (filial) params.filial = filial;
    api.get('/agente/comparativo313/lista', { params })
      .then(r => setItens(r.data))
      .finally(() => setLoading(false));
  }
  useEffect(carregar, [filial, status]);

  const itensFiltrados = useMemo(() => {
    let list = itens;
    if (busca.trim()) {
      const q = busca.trim().toLowerCase();
      list = list.filter(it =>
        (it.descricao_produto || '').toLowerCase().includes(q)
        || (it.codigo_produto || '').includes(q)
        || (it.secao || '').toLowerCase().includes(q)
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
  }, [itens, busca, sort]);

  function toggleSort(by) {
    setSort(s => s.by === by ? { by, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { by, dir: 'desc' });
  }

  function SortIcon({ col }) {
    if (sort.by !== col) return <ArrowUpDown size={12} className="inline ml-1 opacity-40" />;
    return sort.dir === 'asc'
      ? <ArrowUp   size={12} className="inline ml-1" />
      : <ArrowDown size={12} className="inline ml-1" />;
  }

  function fmtNum(v) {
    if (v == null) return '—';
    return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Cards resumo por filial */}
      {podeVerResumo && resumo.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-slate-700 mb-2">Resumo por filial</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {resumo.map(r => (
              <button
                key={r.filial_cod}
                onClick={() => setFilial(filial === r.filial_cod ? '' : r.filial_cod)}
                className={
                  'text-left rounded-lg border p-4 transition ' +
                  (filial === r.filial_cod
                    ? 'border-orange-500 bg-orange-50'
                    : 'border-slate-200 bg-white hover:border-slate-300')
                }
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500">{r.filial_cod}</span>
                  {r.rupturas_pendentes > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs text-orange-700 bg-orange-50 px-2 py-0.5 rounded">
                      <AlertCircle size={12} /> {r.rupturas_pendentes}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-sm font-medium text-slate-900 line-clamp-1">
                  {r.filial_desc || r.filial_cod}
                </div>
                <div className="mt-2 text-xs text-slate-600 grid grid-cols-2 gap-x-2 gap-y-0.5">
                  <span>Rupturas:</span>
                  <span className="text-right font-medium text-orange-700">{fmtNum(r.rupturas_pendentes)}</span>
                  <span>C/ estoque:</span>
                  <span className="text-right">{fmtNum(r.com_estoque_deposito)}</span>
                  <span>Estoque dep.:</span>
                  <span className="text-right">{fmtNum(r.estoque_total_deposito)}</span>
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
              {status === 'pendente' ? 'Rupturas pendentes' : status === 'resolvida' ? 'Rupturas resolvidas' : 'Todas as rupturas'}
            </h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-orange-100 text-orange-800 text-xs font-medium">
              {loading ? '...' : `${itensFiltrados.length} ${itensFiltrados.length === 1 ? 'item' : 'itens'}`}
            </span>
            {filial && (
              <button
                onClick={() => setFilial('')}
                className="text-xs text-orange-700 hover:text-orange-900 underline"
              >
                limpar filial ({filial})
              </button>
            )}
          </div>
          <div className="flex gap-2 items-center flex-wrap">
            <input
              type="search"
              placeholder="Buscar produto, código ou seção..."
              value={busca}
              onChange={e => setBusca(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white w-64"
            />
            <select
              value={status}
              onChange={e => setStatus(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white"
            >
              <option value="pendente">Pendentes</option>
              <option value="resolvida">Resolvidas</option>
              <option value="todas">Todas</option>
            </select>
          </div>
        </div>

        {loading ? (
          <p className="text-slate-500">Carregando...</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 sticky top-0 z-10 shadow-[0_1px_0_0_rgb(226_232_240)]">
                <tr>
                  <th className="text-left p-3 cursor-pointer select-none hover:bg-slate-100"
                      onClick={() => toggleSort('filial_cod')}>
                    Filial<SortIcon col="filial_cod" />
                  </th>
                  <th className="text-left p-3">Seção</th>
                  <th className="text-left p-3">Produto</th>
                  <th className="text-right p-3 cursor-pointer select-none hover:bg-slate-100"
                      onClick={() => toggleSort('estoque_deposito')}>
                    Estoque dep.<SortIcon col="estoque_deposito" />
                  </th>
                  <th className="text-right p-3" title="Grade de embalagem">Grade</th>
                  <th className="text-right p-3" title="Múltiplo de reposição">Mult. rep.</th>
                  <th className="text-left p-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {itensFiltrados.map(it => (
                  <tr key={it.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="p-3 text-slate-700">{it.filial_cod}</td>
                    <td className="p-3 text-slate-600 text-xs">{it.secao || '—'}</td>
                    <td className="p-3 font-medium text-slate-900">
                      {it.descricao_produto || '—'}
                      <div className="text-[10px] text-slate-500">#{it.codigo_produto}</div>
                    </td>
                    <td className="p-3 text-right font-semibold text-emerald-700">
                      {fmtNum(it.estoque_deposito)}
                    </td>
                    <td className="p-3 text-right text-slate-600">{fmtNum(it.grade)}</td>
                    <td className="p-3 text-right text-slate-600">{fmtNum(it.multiplo_reposicao)}</td>
                    <td className="p-3">
                      <span className={
                        'text-[11px] font-medium px-1.5 py-0.5 rounded ' +
                        (it.status === 'pendente'
                          ? 'bg-orange-100 text-orange-800'
                          : 'bg-emerald-100 text-emerald-800')
                      }>
                        {it.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {itensFiltrados.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-500">
                      Nenhuma ruptura {status === 'pendente' ? 'pendente' : ''} no momento.
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
