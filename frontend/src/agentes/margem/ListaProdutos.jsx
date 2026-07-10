import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { api } from '../../lib/api';
import { useMe } from '../../hooks/useMe';
import { CienciaModal } from './CienciaModal';

const MOTIVO_LABEL = {
  vencimento: 'Vencimento',
  estoque_parado: 'Estoque parado',
  descontinuidade: 'Descontinuidade',
  erro_cadastro: 'Erro de cadastro',
  estrategia_comercial: 'Estratégia comercial',
  outro: 'Outro',
};

export function ListaProdutos() {
  const { me } = useMe();
  const podeVerTodos = me && ['diretor', 'admin', 'supervisor'].includes(me.papel);

  const [produtos, setProdutos]       = useState([]);
  const [responsaveis, setResponsaveis] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [q, setQ]                     = useState('');
  const [status, setStatus]           = useState('pendente');
  const [compradorId, setCompradorId] = useState('');
  const [alvo, setAlvo]               = useState(null);
  const [sort, setSort]               = useState({ by: 'margem_negativa', dir: 'asc' });

  // Carrega lista de responsáveis pra alimentar o select (só faz sentido pra diretor/supervisor/admin)
  useEffect(() => {
    if (!podeVerTodos) return;
    api.get('/agente/margem/responsaveis')
      .then(r => setResponsaveis(r.data))
      .catch(err => console.error('responsaveis', err));
  }, [podeVerTodos]);

  function carregar() {
    setLoading(true);
    api.get('/agente/margem/produtos', {
      params: { status, q, comprador_id: compradorId || undefined },
    })
      .then(r => setProdutos(r.data))
      .finally(() => setLoading(false));
  }
  useEffect(carregar, [status, compradorId]);

  // Ordenação client-side — listas até ~1.2k linhas, sem custo perceptível.
  const produtosOrdenados = useMemo(() => {
    const list = [...produtos];
    list.sort((a, b) => {
      const va = Number(a[sort.by] ?? 0);
      const vb = Number(b[sort.by] ?? 0);
      const cmp = va - vb;
      return sort.dir === 'asc' ? cmp : -cmp;
    });
    return list;
  }, [produtos, sort]);

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
    return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
  function fmtDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('pt-BR');
  }
  function fmtQty(v) {
    if (v == null) return '—';
    const n = Number(v);
    if (!Number.isFinite(n)) return '—';
    // Inteiro: sem casas. Fracionário: até 3 casas (deixa kg como "0,1").
    return Number.isInteger(n)
      ? n.toString()
      : n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 3 });
  }

  const isPendente = status === 'pendente';

  return (
    <div className="flex flex-col h-[calc(100vh-9rem)]">
      {/* Topo: título + filtros — não rola */}
      <div className="flex items-center justify-between mb-4 shrink-0 flex-wrap gap-2">
        <div className="flex items-baseline gap-3">
          <h2 className="text-base font-semibold">
            {isPendente ? 'Produtos pendentes' : status === 'ciente' ? 'Produtos com ciência' : 'Produtos expirados'}
          </h2>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-xs font-medium">
            {loading ? '...' : `${produtos.length} ${produtos.length === 1 ? 'item' : 'itens'}`}
          </span>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {podeVerTodos && (
            <>
              <select
                value={status}
                onChange={e => setStatus(e.target.value)}
                className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white"
              >
                <option value="pendente">Pendentes</option>
                <option value="ciente">Cientes</option>
                <option value="expirado">Expirados</option>
                <option value="resolvido">Resolvidos</option>
              </select>
              <select
                value={compradorId}
                onChange={e => setCompradorId(e.target.value)}
                className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white max-w-[16rem]"
              >
                <option value="">Todos os responsáveis</option>
                {responsaveis.map(r => (
                  <option key={r.usuario_id} value={r.usuario_id}>
                    {r.usuario_nome}
                    {r.usuario_papel !== 'comprador' ? ` (${r.usuario_papel})` : ''}
                    {' — '}
                    {r.pendentes} pend.
                  </option>
                ))}
              </select>
            </>
          )}
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && carregar()}
            placeholder="buscar por descrição/código"
            className="border border-slate-300 rounded-md px-3 py-1.5 text-sm w-64"
          />
          <button onClick={carregar} className="bg-slate-900 text-white px-3 py-1.5 rounded-md text-sm">
            Buscar
          </button>
        </div>
      </div>

      {loading ? (
        <p className="text-slate-500">Carregando...</p>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 sticky top-0 z-10 shadow-[0_1px_0_0_rgb(226_232_240)]">
              <tr>
                <th className="text-left p-3">Produto</th>
                <th className="text-left p-3">Seção</th>
                <th className="text-left p-3">Fornecedor</th>
                <th className="text-right p-3">Vlr Venda</th>
                <th className="text-right p-3">Custo</th>
                <th
                  className="text-right p-3 cursor-pointer select-none hover:bg-slate-100"
                  onClick={() => toggleSort('margem_negativa')}
                  title="Ordenar por margem"
                >
                  Margem %<SortIcon col="margem_negativa" />
                </th>
                <th
                  className="text-right p-3 cursor-pointer select-none hover:bg-slate-100"
                  onClick={() => toggleSort('qtd_estoque')}
                  title="Ordenar por estoque"
                >
                  Estoque<SortIcon col="qtd_estoque" />
                </th>
                <th
                  className="text-right p-3 cursor-pointer select-none hover:bg-slate-100"
                  onClick={() => toggleSort('dias_venda')}
                  title="Ordenar por dias/venda"
                >
                  Dias/venda<SortIcon col="dias_venda" />
                </th>
                {isPendente ? (
                  <>
                    <th className="text-left p-3">Compartilhado</th>
                    <th className="p-3"></th>
                  </>
                ) : (
                  <>
                    <th className="text-left p-3">Ciência dada por</th>
                    <th className="text-left p-3">Motivo</th>
                    <th className="text-left p-3">Observação</th>
                    <th className="text-left p-3">Data fim</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {produtosOrdenados.map(p => (
                <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50 align-top">
                  <td className="p-3">
                    <div className="font-medium text-slate-900">
                      {p.codigo_produto} — {p.descricao_produto}
                    </div>
                    <div className="text-xs text-slate-500">{p.filial}</div>
                  </td>
                  <td className="p-3">{p.secao}</td>
                  <td className="p-3 max-w-[14rem]">
                    <span className="line-clamp-2 text-slate-700" title={p.fornecedor || ''}>
                      {p.fornecedor || '—'}
                    </span>
                  </td>
                  <td className="p-3 text-right">{fmtMoney(p.vlr_cong_varejo ?? p.vlr_venda)}</td>
                  <td className="p-3 text-right">{fmtMoney(p.custo_medio)}</td>
                  <td className="p-3 text-right text-red-700 font-medium">
                    {Number(p.margem_negativa).toFixed(2)}
                  </td>
                  <td className="p-3 text-right">{fmtQty(p.qtd_estoque)}</td>
                  <td className="p-3 text-right">
                    {p.dias_venda == null ? '—' : Number(p.dias_venda).toFixed(2)}
                  </td>

                  {isPendente ? (
                    <>
                      <td className="p-3">
                        {(p.compradores || [])
                          .filter(c => c.usuarios)
                          .map(c => (
                            <span
                              key={c.usuario_id}
                              className="inline-block bg-slate-100 rounded px-2 py-0.5 text-xs mr-1 mb-1"
                            >
                              {c.usuarios.nome}
                              {c.papel_atribuicao !== 'principal' && ' (suplente)'}
                            </span>
                          ))}
                      </td>
                      <td className="p-3">
                        <button
                          onClick={() => setAlvo(p)}
                          className="bg-emerald-600 text-white rounded-md px-3 py-1.5 text-xs"
                        >
                          Dar ciência
                        </button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="p-3 text-slate-700">
                        {p.ciencia_por?.nome || '—'}
                        {p.checked_at && (
                          <div className="text-xs text-slate-400">em {fmtDate(p.checked_at)}</div>
                        )}
                      </td>
                      <td className="p-3 text-slate-700">{MOTIVO_LABEL[p.motivo] || '—'}</td>
                      <td className="p-3 text-slate-600 max-w-xs">
                        <span className="line-clamp-2" title={p.observacao || ''}>
                          {p.observacao || '—'}
                        </span>
                      </td>
                      <td className="p-3 text-slate-700">{fmtDate(p.data_fim_ciencia)}</td>
                    </>
                  )}
                </tr>
              ))}
              {produtosOrdenados.length === 0 && (
                <tr>
                  <td colSpan={isPendente ? 10 : 12} className="p-8 text-center text-slate-500">
                    Nenhum produto.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <CienciaModal produto={alvo} onClose={() => { setAlvo(null); carregar(); }} />
    </div>
  );
}
