import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Zap, Activity, TrendingDown, AlertOctagon } from 'lucide-react';
import { api } from '../../lib/api';
import { DetalheAlertaDrawer } from './DetalheAlertaDrawer';

const BANDAS = [
  { key: 'todas',     label: 'Todas',     Icon: null,         cls: 'bg-slate-100 text-slate-700' },
  { key: 'constante', label: 'Constante', Icon: Zap,          cls: 'bg-emerald-100 text-emerald-800' },
  { key: 'medio',     label: 'Médio',     Icon: Activity,     cls: 'bg-sky-100 text-sky-800' },
  { key: 'baixo',     label: 'Baixo',     Icon: TrendingDown, cls: 'bg-amber-100 text-amber-800' },
  { key: 'critico',   label: 'Crítico',   Icon: AlertOctagon, cls: 'bg-red-100 text-red-800' },
];
const BANDA_BADGE = {
  constante: 'bg-emerald-100 text-emerald-800',
  medio:     'bg-sky-100 text-sky-800',
  baixo:     'bg-amber-100 text-amber-800',
  critico:   'bg-red-100 text-red-800',
  fora_de_faixa: 'bg-slate-100 text-slate-600',
};
const NIVEL_RISCO_LABEL = {
  atencao:        { texto: 'Atenção',        cls: 'bg-amber-100 text-amber-800' },
  risco:          { texto: 'Risco',          cls: 'bg-orange-100 text-orange-800' },
  critico:        { texto: 'Crítico',        cls: 'bg-red-100 text-red-800' },
  perda_provavel: { texto: 'Perda provável', cls: 'bg-red-200 text-red-900 font-semibold' },
};

const PAGE_SIZE = 200;

export function Produtos() {
  const [itens, setItens]       = useState([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [loadingMais, setLoadingMais] = useState(false);
  const [banda, setBanda]       = useState('todas');
  const [filial, setFilial]     = useState('');
  const [busca, setBusca]       = useState('');
  const [buscaDebounced, setBuscaDebounced] = useState('');
  const [sort, setSort]         = useState({ by: 'dias_ate_ruptura', dir: 'asc' });
  const [produtoAberto, setProdutoAberto] = useState(null);

  // Debounce da busca (350ms) — evita disparar request a cada tecla.
  useEffect(() => {
    const t = setTimeout(() => setBuscaDebounced(busca.trim()), 350);
    return () => clearTimeout(t);
  }, [busca]);

  // Carrega a primeira página sempre que filtros mudarem.
  useEffect(() => {
    let cancelado = false;
    setLoading(true);
    const params = { limit: PAGE_SIZE, offset: 0 };
    if (filial)            params.filial = filial;
    if (banda !== 'todas') params.banda  = banda;
    if (buscaDebounced)    params.q      = buscaDebounced;
    api.get('/agente/supervisor_estoque/produtos', { params })
      .then(r => {
        if (cancelado) return;
        // Compatibilidade: aceita resposta antiga (array) ou nova ({rows,total}).
        if (Array.isArray(r.data)) {
          setItens(r.data);
          setTotal(r.data.length);
        } else {
          setItens(r.data.rows || []);
          setTotal(Number(r.data.total || 0));
        }
      })
      .catch(() => {
        if (!cancelado) { setItens([]); setTotal(0); }
      })
      .finally(() => { if (!cancelado) setLoading(false); });
    return () => { cancelado = true; };
  }, [banda, filial, buscaDebounced]);

  function carregarMais() {
    if (loadingMais) return;
    setLoadingMais(true);
    const params = { limit: PAGE_SIZE, offset: itens.length };
    if (filial)            params.filial = filial;
    if (banda !== 'todas') params.banda  = banda;
    if (buscaDebounced)    params.q      = buscaDebounced;
    api.get('/agente/supervisor_estoque/produtos', { params })
      .then(r => {
        const novos = Array.isArray(r.data) ? r.data : (r.data.rows || []);
        setItens(prev => [...prev, ...novos]);
        if (!Array.isArray(r.data)) setTotal(Number(r.data.total || 0));
      })
      .finally(() => setLoadingMais(false));
  }

  // Ordenação acontece em cima do que já está carregado (200, 400, ...).
  const itensOrdenados = useMemo(() => {
    const sorted = [...itens];
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
  }, [itens, sort]);

  const temMais = itens.length < total;

  function toggleSort(by) {
    setSort(s => s.by === by ? { by, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { by, dir: 'desc' });
  }
  function SortIcon({ col }) {
    if (sort.by !== col) return <ArrowUpDown size={12} className="inline ml-1 opacity-40" />;
    return sort.dir === 'asc'
      ? <ArrowUp size={12} className="inline ml-1" />
      : <ArrowDown size={12} className="inline ml-1" />;
  }
  function fmtNum(v, frac = 0) {
    if (v == null) return '—';
    return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: frac });
  }
  function fmtMoney(v) {
    if (v == null) return '—';
    return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  function fmtData(s) {
    if (!s) return '—';
    return new Date(s + 'T00:00:00').toLocaleDateString('pt-BR');
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Tabs de banda */}
      <div className="flex gap-2 flex-wrap">
        {BANDAS.map(b => {
          const ativo = banda === b.key;
          const Icon = b.Icon;
          return (
            <button
              key={b.key}
              onClick={() => setBanda(b.key)}
              className={
                'inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-md transition ' +
                (ativo ? b.cls + ' ring-2 ring-offset-1 ring-current' : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50')
              }
            >
              {Icon && <Icon size={14} />}
              {b.label}
            </button>
          );
        })}
      </div>

      {/* Filtros */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-baseline gap-3">
          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 text-xs font-medium">
            {loading
              ? '...'
              : (total > itens.length
                  ? `${fmtNum(itens.length)} de ${fmtNum(total)} produtos`
                  : `${fmtNum(itens.length)} ${itens.length === 1 ? 'produto' : 'produtos'}`)}
          </span>
          {!loading && total > itens.length && (
            <span className="text-xs text-slate-500">
              Use filial/banda/busca para refinar.
            </span>
          )}
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <input
            type="search"
            placeholder="Buscar produto, código, seção ou fornecedor..."
            value={busca}
            onChange={e => setBusca(e.target.value)}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white w-72"
          />
          <input
            type="text"
            placeholder="Filial (ex.: 302)"
            value={filial}
            onChange={e => setFilial(e.target.value)}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white w-32"
          />
        </div>
      </div>

      {loading ? (
        <p className="text-slate-500">Carregando...</p>
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 sticky top-0 z-10 shadow-[0_1px_0_0_rgb(226_232_240)]">
                <tr>
                  <th className="text-left p-3 cursor-pointer hover:bg-slate-100" onClick={() => toggleSort('filial_cod')}>
                    Filial<SortIcon col="filial_cod" />
                  </th>
                  <th className="text-left p-3">Produto</th>
                  <th className="text-left p-3">Seção / Fornecedor</th>
                  <th className="text-left p-3">Banda</th>
                  <th className="text-right p-3 cursor-pointer hover:bg-slate-100" onClick={() => toggleSort('estoque')}>
                    Estoque<SortIcon col="estoque" />
                  </th>
                  <th className="text-right p-3 cursor-pointer hover:bg-slate-100" onClick={() => toggleSort('media_dia')}>
                    Méd./dia<SortIcon col="media_dia" />
                  </th>
                  <th className="text-right p-3 cursor-pointer hover:bg-slate-100" onClick={() => toggleSort('dias_venda')}>
                    Dias venda<SortIcon col="dias_venda" />
                  </th>
                  <th className="text-right p-3 cursor-pointer hover:bg-slate-100" onClick={() => toggleSort('giro')}>
                    Giro<SortIcon col="giro" />
                  </th>
                  <th className="text-right p-3 cursor-pointer hover:bg-slate-100" onClick={() => toggleSort('dias_ate_ruptura')}>
                    Ruptura em<SortIcon col="dias_ate_ruptura" />
                  </th>
                  <th className="text-right p-3 cursor-pointer hover:bg-slate-100" onClick={() => toggleSort('valor_estoque')}>
                    Valor estoque<SortIcon col="valor_estoque" />
                  </th>
                  <th className="text-left p-3">Nível</th>
                  <th className="text-left p-3">Últ. entrada</th>
                  <th className="text-left p-3">Últ. saída</th>
                </tr>
              </thead>
              <tbody>
                {itensOrdenados.map(it => (
                  <tr
                    key={`${it.filial_cod}-${it.codigo_produto}`}
                    onClick={() => setProdutoAberto(it)}
                    className="border-t border-slate-100 hover:bg-rose-50/50 cursor-pointer transition"
                  >
                    <td className="p-3 text-slate-700">{it.filial_cod}</td>
                    <td className="p-3 font-medium text-slate-900">
                      {it.descricao_produto || '—'}
                      <div className="text-[10px] text-slate-500">#{it.codigo_produto}</div>
                    </td>
                    <td className="p-3 text-slate-600 text-xs">
                      <div>{it.secao || '—'}</div>
                      <div className="text-slate-400">{it.fornecedor || ''}</div>
                    </td>
                    <td className="p-3">
                      <span className={`inline-flex text-[11px] font-medium px-1.5 py-0.5 rounded ${BANDA_BADGE[it.banda] || 'bg-slate-100 text-slate-600'}`}>
                        {it.banda || '—'}
                      </span>
                    </td>
                    <td className="p-3 text-right text-slate-700">{fmtNum(it.estoque)}</td>
                    <td className="p-3 text-right text-slate-700">{fmtNum(it.media_dia, 2)}</td>
                    <td className="p-3 text-right text-slate-700">{fmtNum(it.dias_venda)}</td>
                    <td className="p-3 text-right text-slate-700">{fmtNum(it.giro)}</td>
                    <td className="p-3 text-right font-medium">
                      {it.dias_ate_ruptura != null && Number(it.dias_ate_ruptura) <= 7
                        ? <span className="text-red-700">{fmtNum(it.dias_ate_ruptura, 1)} d</span>
                        : <span className="text-slate-600">{it.dias_ate_ruptura != null ? `${fmtNum(it.dias_ate_ruptura, 1)} d` : '—'}</span>}
                    </td>
                    <td className="p-3 text-right text-slate-700">{fmtMoney(it.valor_estoque)}</td>
                    <td className="p-3">
                      {it.nivel_obsolescencia && NIVEL_RISCO_LABEL[it.nivel_obsolescencia] ? (
                        <span className={`inline-flex text-[11px] font-medium px-1.5 py-0.5 rounded ${NIVEL_RISCO_LABEL[it.nivel_obsolescencia].cls}`}>
                          {NIVEL_RISCO_LABEL[it.nivel_obsolescencia].texto}
                        </span>
                      ) : <span className="text-slate-400">—</span>}
                    </td>
                    <td className="p-3 text-xs text-slate-500">{fmtData(it.ultima_entrada)}</td>
                    <td className="p-3 text-xs text-slate-500">{fmtData(it.ultima_saida)}</td>
                  </tr>
                ))}
                {itensOrdenados.length === 0 && (
                  <tr>
                    <td colSpan={14} className="p-8 text-center text-slate-500">
                      Sem produtos para esses filtros.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {temMais && (
            <div className="flex justify-center">
              <button
                onClick={carregarMais}
                disabled={loadingMais}
                className="px-4 py-2 text-sm font-medium rounded-md bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loadingMais
                  ? 'Carregando...'
                  : `Carregar mais ${fmtNum(Math.min(PAGE_SIZE, total - itens.length))} (${fmtNum(total - itens.length)} restantes)`}
              </button>
            </div>
          )}
        </>
      )}

      {produtoAberto && (
        <DetalheAlertaDrawer
          alerta={produtoAberto}
          onClose={() => setProdutoAberto(null)}
        />
      )}
    </div>
  );
}
