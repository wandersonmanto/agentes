import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, AlertCircle, TrendingDown, TrendingUp, Loader2 } from 'lucide-react';
import { api } from '../../lib/api';
import { useMe } from '../../hooks/useMe';
import { DetalheAlertaDrawer } from './DetalheAlertaDrawer';

const METRICA_LABEL = {
  media_dia:          'Média/dia',
  dias_venda:         'Dias com venda',
  giro:               'Giro',
  obsolescencia:      'Obsolescência',
  ruptura_confirmada: 'Ruptura confirmada',
};
const DIRECAO_LABEL = {
  queda:   { texto: 'Queda',   cls: 'bg-orange-100 text-orange-800', Icon: TrendingDown },
  aumento: { texto: 'Aumento', cls: 'bg-sky-100 text-sky-800',       Icon: TrendingUp },
};
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
function fmtData(s) {
  if (!s) return '—';
  return new Date(s + 'T00:00:00').toLocaleDateString('pt-BR');
}

export function Alertas({ metricasFixas = null, tituloFixo = 'Alertas' } = {}) {
  const { me } = useMe();
  const podeVerResumo = me && ['diretor', 'admin', 'supervisor', 'gerente'].includes(me.papel);
  // Quando há métricas fixas (sub-aba específica), o filtro de métrica
  // some da UI e a métrica default vira a primeira da lista permitida.
  const metricaDefault = Array.isArray(metricasFixas) && metricasFixas.length === 1
    ? metricasFixas[0]
    : 'todas';
  // Key estável que muda quando trocamos de sub-aba — entra como dep do
  // useEffect que carrega a lista (e dispara o refetch automaticamente).
  const metricasFixasKey = Array.isArray(metricasFixas) ? metricasFixas.join(',') : '';

  const [itens, setItens]     = useState([]);
  const [resumo, setResumo]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [filial, setFilial]   = useState('');
  const [status, setStatus]   = useState('pendente');
  const [metrica, setMetrica] = useState(metricaDefault);
  const [direcao, setDirecao] = useState('todas');
  const [busca, setBusca]     = useState('');
  const [sort, setSort]       = useState({ by: 'variacao_pct', dir: 'desc' });
  const [alertaAberto, setAlertaAberto] = useState(null);

  useEffect(() => {
    if (!podeVerResumo) return;
    api.get('/agente/supervisor_estoque/resumo-filial')
      .then(r => setResumo(r.data))
      .catch(err => console.error('resumo-filial', err));
  }, [podeVerResumo]);

  function carregar() {
    setLoading(true);
    // Quando "todas" dentro de uma sub-aba com lista fixa, envia CSV pro
    // backend filtrar pelas métricas permitidas. Senão envia o single.
    const metricaParam = (metrica === 'todas' && Array.isArray(metricasFixas) && metricasFixas.length > 1)
      ? metricasFixas.join(',')
      : metrica;
    const params = { status, metrica: metricaParam, direcao };
    if (filial) params.filial = filial;
    api.get('/agente/supervisor_estoque/lista', { params })
      .then(r => setItens(r.data))
      .finally(() => setLoading(false));
  }
  // Reseta a métrica selecionada quando trocamos de sub-aba (porque a
  // métrica antiga pode não existir mais na nova aba).
  useEffect(() => {
    setMetrica(metricaDefault);
  }, [metricasFixasKey, metricaDefault]);

  useEffect(carregar, [filial, status, metrica, direcao, metricasFixasKey]);

  const itensFiltrados = useMemo(() => {
    let list = itens;
    if (busca.trim()) {
      const q = busca.trim().toLowerCase();
      list = list.filter(it =>
        (it.descricao_produto || '').toLowerCase().includes(q)
        || (it.codigo_produto || '').toString().includes(q)
        || (it.secao || '').toLowerCase().includes(q)
        || (it.fornecedor || '').toLowerCase().includes(q)
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
      ? <ArrowUp size={12} className="inline ml-1" />
      : <ArrowDown size={12} className="inline ml-1" />;
  }
  function fmtNum(v, frac = 0) {
    if (v == null) return '—';
    return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: frac });
  }
  function fmtPct(v) {
    if (v == null) return '—';
    const n = Number(v);
    const sign = n > 0 ? '+' : '';
    return `${sign}${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
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
                    ? 'border-rose-500 bg-rose-50'
                    : 'border-slate-200 bg-white hover:border-slate-300')
                }
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-500">{r.filial_cod}</span>
                  {r.alertas_pendentes > 0 && (
                    <span className="inline-flex items-center gap-1 text-xs text-rose-700 bg-rose-50 px-2 py-0.5 rounded">
                      <AlertCircle size={12} /> {r.alertas_pendentes}
                    </span>
                  )}
                </div>
                <div className="mt-1 text-sm font-medium text-slate-900 line-clamp-1">
                  {r.filial_desc || r.filial_cod}
                </div>
                <div className="mt-2 text-xs text-slate-600 grid grid-cols-2 gap-x-2 gap-y-0.5">
                  <span>Pendentes:</span>
                  <span className="text-right font-medium text-rose-700">{fmtNum(r.alertas_pendentes)}</span>
                  <span>Média/dia:</span>
                  <span className="text-right">{fmtNum(r.alertas_media_dia)}</span>
                  <span>Dias venda:</span>
                  <span className="text-right">{fmtNum(r.alertas_dias_venda)}</span>
                  <span>Giro:</span>
                  <span className="text-right">{fmtNum(r.alertas_giro)}</span>
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
            <h2 className="text-base font-semibold">{tituloFixo}</h2>
            {loading ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-sky-100 text-sky-800 text-xs font-medium">
                <Loader2 size={12} className="animate-spin" />
                Atualizando...
              </span>
            ) : (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-xs font-medium">
                {`${itensFiltrados.length} ${itensFiltrados.length === 1 ? 'item' : 'itens'}`}
              </span>
            )}
            {filial && (
              <button
                onClick={() => setFilial('')}
                className="text-xs text-rose-700 hover:text-rose-900 underline"
              >
                limpar filial ({filial})
              </button>
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
            <select
              value={status}
              onChange={e => setStatus(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white"
            >
              <option value="pendente">Pendentes</option>
              <option value="ciente">Cientes</option>
              <option value="resolvido">Resolvidos</option>
              <option value="superada">Superados (auto)</option>
              <option value="expirado">Expirados</option>
              <option value="todas">Todos</option>
            </select>
            {/* Filtro de métrica: aparece só quando não há métrica única fixa.
                Quando há lista (ex: variação tem 3), mostra apenas as opções
                permitidas. */}
            {!(Array.isArray(metricasFixas) && metricasFixas.length === 1) && (
              <select
                value={metrica}
                onChange={e => setMetrica(e.target.value)}
                className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white"
              >
                <option value="todas">
                  {Array.isArray(metricasFixas) ? 'Todas (do grupo)' : 'Todas as métricas'}
                </option>
                {(!metricasFixas || metricasFixas.includes('media_dia')) && (
                  <option value="media_dia">Média/dia</option>
                )}
                {(!metricasFixas || metricasFixas.includes('dias_venda')) && (
                  <option value="dias_venda">Dias com venda</option>
                )}
                {(!metricasFixas || metricasFixas.includes('giro')) && (
                  <option value="giro">Giro</option>
                )}
                {!metricasFixas && (
                  <option value="obsolescencia">Obsolescência</option>
                )}
                {!metricasFixas && (
                  <option value="ruptura_confirmada">Ruptura confirmada</option>
                )}
              </select>
            )}
            <select
              value={direcao}
              onChange={e => setDirecao(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white"
            >
              <option value="todas">Queda + Aumento</option>
              <option value="queda">Só queda</option>
              <option value="aumento">Só aumento</option>
            </select>
          </div>
        </div>

        {itens.length === 0 && loading ? (
          // Primeira carga (sem dados pra mostrar): skeleton
          <div className="rounded-lg border border-slate-200 bg-white p-8 flex items-center justify-center gap-2 text-slate-500">
            <Loader2 size={16} className="animate-spin" />
            Carregando alertas...
          </div>
        ) : (
          <div className={
            'relative overflow-x-auto rounded-lg border border-slate-200 bg-white transition-opacity ' +
            (loading ? 'opacity-50 pointer-events-none' : '')
          }>
            {loading && (
              <div className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 inline-flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-md shadow-md text-sm text-slate-700">
                <Loader2 size={14} className="animate-spin" />
                Atualizando lista...
              </div>
            )}
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 sticky top-0 z-10 shadow-[0_1px_0_0_rgb(226_232_240)]">
                <tr>
                  <th className="text-left p-2 cursor-pointer select-none hover:bg-slate-100"
                      onClick={() => toggleSort('filial_cod')}>
                    Filial<SortIcon col="filial_cod" />
                  </th>
                  <th className="text-left p-2">Seção</th>
                  <th className="text-left p-2">Produto</th>
                  <th className="text-left p-2">Métrica</th>
                  <th className="text-right p-2 cursor-pointer select-none hover:bg-slate-100"
                      onClick={() => toggleSort('valor_baseline_7d')}>
                    Baseline<SortIcon col="valor_baseline_7d" />
                  </th>
                  <th className="text-right p-2 cursor-pointer select-none hover:bg-slate-100"
                      onClick={() => toggleSort('valor_atual')}>
                    Atual<SortIcon col="valor_atual" />
                  </th>
                  <th className="text-right p-2 cursor-pointer select-none hover:bg-slate-100"
                      onClick={() => toggleSort('variacao_pct')}>
                    Variação<SortIcon col="variacao_pct" />
                  </th>
                  <th className="text-right p-2">Estoque</th>
                  <th className="text-left p-2">Banda / Nível</th>
                  <th className="text-right p-2">Ruptura em</th>
                  <th className="text-left p-2">Datas</th>
                  <th className="text-left p-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {itensFiltrados.map(it => {
                  const dir = DIRECAO_LABEL[it.direcao];
                  const DirIcon = dir?.Icon;
                  return (
                    <tr
                      key={it.id}
                      onClick={() => setAlertaAberto(it)}
                      className="border-t border-slate-100 hover:bg-rose-50/50 cursor-pointer transition"
                    >
                      <td className="p-2 text-slate-700">{it.filial_cod}</td>
                      <td className="p-2 text-slate-600 text-xs">{it.secao || '—'}</td>
                      <td className="p-2 font-medium text-slate-900">
                        {it.descricao_produto || '—'}
                        <div className="text-[10px] text-slate-500">
                          #{it.codigo_produto}
                          {it.fornecedor && <span className="ml-2 text-slate-400">{it.fornecedor}</span>}
                        </div>
                      </td>
                      <td className="p-2 text-slate-700">{METRICA_LABEL[it.metrica] || it.metrica}</td>
                      <td className="p-2 text-right text-slate-600">{fmtNum(it.valor_baseline_7d, 2)}</td>
                      <td className="p-2 text-right font-semibold text-slate-900">{fmtNum(it.valor_atual, 2)}</td>
                      <td className="p-2 text-right font-semibold whitespace-nowrap">
                        <span className={'inline-flex items-center gap-1 ' + (it.direcao === 'queda' ? 'text-orange-700' : 'text-sky-700')}>
                          {DirIcon && <DirIcon size={12} />}
                          {fmtPct(it.variacao_pct)}
                        </span>
                      </td>
                      <td className="p-2 text-right text-slate-700">{fmtNum(it.estoque)}</td>
                      <td className="p-2">
                        <div className="flex flex-col gap-0.5">
                          {it.banda && (
                            <span className={`inline-flex w-fit text-[11px] font-medium px-1.5 py-0.5 rounded ${BANDA_BADGE[it.banda] || 'bg-slate-100 text-slate-600'}`}>
                              {it.banda}
                            </span>
                          )}
                          {it.nivel_risco && NIVEL_RISCO_LABEL[it.nivel_risco] && (
                            <span className={`inline-flex w-fit text-[11px] font-medium px-1.5 py-0.5 rounded ${NIVEL_RISCO_LABEL[it.nivel_risco].cls}`}>
                              {NIVEL_RISCO_LABEL[it.nivel_risco].texto}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-2 text-right">
                        {it.dias_ate_ruptura != null
                          ? <span className={Number(it.dias_ate_ruptura) <= 7 ? 'text-red-700 font-semibold' : 'text-slate-700'}>
                              {fmtNum(it.dias_ate_ruptura, 1)} d
                            </span>
                          : <span className="text-slate-400">—</span>}
                      </td>
                      <td className="p-2 text-[10px] text-slate-600 whitespace-nowrap">
                        <div><span className="text-slate-400">ent. </span>{fmtData(it.ultima_entrada)}</div>
                        <div><span className="text-slate-400">saí. </span>{fmtData(it.ultima_saida)}</div>
                      </td>
                      <td className="p-2">
                        <span className={
                          'text-[11px] font-medium px-1.5 py-0.5 rounded ' +
                          (it.status === 'pendente'  ? 'bg-rose-100 text-rose-800'
                          : it.status === 'ciente'    ? 'bg-amber-100 text-amber-800'
                          : it.status === 'resolvido' ? 'bg-emerald-100 text-emerald-800'
                          : it.status === 'superada'  ? 'bg-slate-100 text-slate-600'
                          :                             'bg-slate-100 text-slate-700')
                        }>
                          {it.status}
                        </span>
                      </td>
                    </tr>
                  );
                })}
                {itensFiltrados.length === 0 && (
                  <tr>
                    <td colSpan={12} className="p-8 text-center text-slate-500">
                      Nenhum alerta {status === 'pendente' ? 'pendente' : ''} no momento.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {alertaAberto && (
        <DetalheAlertaDrawer
          alerta={alertaAberto}
          onClose={() => setAlertaAberto(null)}
        />
      )}
    </div>
  );
}
