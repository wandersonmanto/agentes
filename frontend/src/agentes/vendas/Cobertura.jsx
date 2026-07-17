/**
 * Estoque × Vendas: cobertura, ruptura e sugestão de compra.
 *
 * A média diária usa como denominador os DIAS EM QUE O PRODUTO ESTAVA
 * DISPONÍVEL (quando já há histórico de estoque no período). Sem histórico,
 * cai para dias corridos — a coluna "Base" mostra qual foi usada.
 * Fonte: /agente/vendas/cobertura.
 */
import { useEffect, useMemo, useState } from 'react';
import { Search, AlertTriangle, AlertCircle, CheckCircle2, PackageX, Layers } from 'lucide-react';
import { api } from '../../lib/api';
import { MultiSelect } from './MultiSelect';
import { ProdutoDrill } from './ProdutoDrill';

const money = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num   = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const num2  = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 2 });

const MULTI_KEYS = ['filial_cod', 'secao_cod', 'departamento_cod', 'comprador_cod',
                    'canal_cod', 'fornecedor_cod'];

const STATUS = {
  ruptura:  { label: 'Ruptura',  cls: 'bg-rose-100 text-rose-800',       Icon: PackageX,      tone: 'rose' },
  critico:  { label: 'Crítico',  cls: 'bg-orange-100 text-orange-800',   Icon: AlertTriangle, tone: 'orange' },
  atencao:  { label: 'Atenção',  cls: 'bg-amber-100 text-amber-800',     Icon: AlertCircle,   tone: 'amber' },
  ok:       { label: 'OK',       cls: 'bg-emerald-100 text-emerald-800', Icon: CheckCircle2,  tone: 'emerald' },
  excesso:  { label: 'Excesso',  cls: 'bg-sky-100 text-sky-800',         Icon: Layers,        tone: 'sky' },
  sem_giro: { label: 'Sem giro', cls: 'bg-slate-100 text-slate-600',     Icon: Layers,        tone: 'slate' },
};
const ORDEM = ['ruptura', 'critico', 'atencao', 'ok', 'excesso', 'sem_giro'];

export function Cobertura() {
  const [periodo, setPeriodo]   = useState(null);
  const [estDatas, setEstDatas] = useState({ ultima: null, datas: [] });
  const [opts, setOpts]         = useState({});
  const [form, setForm] = useState({
    from: '', to: '', data_estoque: '',
    lead_time: 7, dias_seguranca: 3, dias_excesso: 60,
    filial_cod: [], secao_cod: [], departamento_cod: [], comprador_cod: [],
    canal_cod: [], fornecedor_cod: [],
  });
  const [filtroStatus, setFiltroStatus] = useState('todos');
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [jaConsultou, setJaConsultou] = useState(false);
  const [drill, setDrill]     = useState(null); // produto clicado
  // ordenação da tabela; key=null -> mantém a ordem da RPC (ruptura/crítico primeiro)
  const [sort, setSort]       = useState({ key: null, dir: 'desc' });

  useEffect(() => {
    Promise.all([
      api.get('/agente/vendas/periodo').then(r => r.data),
      api.get('/agente/vendas/filtros').then(r => r.data),
      api.get('/agente/vendas/estoque-datas').then(r => r.data).catch(() => ({ ultima: null, datas: [] })),
    ]).then(([per, filt, est]) => {
      setPeriodo(per);
      setOpts(filt || {});
      setEstDatas(est || { ultima: null, datas: [] });
      // Padrão: últimos ~21 dias (rápido). Períodos longos (mês inteiro) o
      // usuário amplia manualmente — são mais pesados de calcular.
      const defFrom = (per?.min_dia && per?.max_dia)
        ? (() => { const d = new Date(per.max_dia + 'T00:00:00'); d.setDate(d.getDate() - 20);
                   const iso = d.toISOString().slice(0, 10);
                   return iso > per.min_dia ? iso : per.min_dia; })()
        : (per?.min_dia || '');
      setForm(f => ({
        ...f,
        from: defFrom,
        to: per?.max_dia || '',
        data_estoque: est?.ultima || '',
      }));
    }).catch(e => setError(e.response?.data?.error || e.message));
  }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function consultar() {
    setLoading(true); setError('');
    const params = {
      from: form.from, to: form.to,
      lead_time: form.lead_time,
      dias_seguranca: form.dias_seguranca,
      dias_excesso: form.dias_excesso,
    };
    if (form.data_estoque) params.data_estoque = form.data_estoque;
    for (const k of MULTI_KEYS) if (form[k]?.length) params[k] = form[k].join(',');
    api.get('/agente/vendas/cobertura', { params })
      .then(r => { setRows(r.data || []); setJaConsultou(true); })
      .catch(e => { setError(e.response?.data?.error || e.message); setRows([]); })
      .finally(() => setLoading(false));
  }

  const contagem = useMemo(() => rows.reduce((a, r) => {
    a[r.status] = (a[r.status] || 0) + 1; return a;
  }, {}), [rows]);

  const totalCompra = useMemo(
    () => rows.reduce((s, r) => s + Number(r.custo_sugestao || 0), 0), [rows]
  );
  const valorParado = useMemo(
    () => rows.filter(r => r.status === 'sem_giro' || r.status === 'excesso')
              .reduce((s, r) => s + Number(r.valor_estoque || 0), 0), [rows]
  );

  // Colunas numéricas abrem no 1º clique em MAIOR -> MENOR (o que interessa:
  // maior custo, maior sugestão, maior venda...). Já texto e gravidade abrem
  // no sentido útil: A->Z, e Status começando pela RUPTURA (a mais grave) —
  // decrescente ali jogaria "sem giro" para o topo, que é o inverso do útil.
  const ASC_PRIMEIRO = new Set(['produto_nome', 'fornecedor_nome', 'base_media', 'status']);

  // 1º clique ordena, 2º inverte, 3º volta à ordem original da RPC
  function ordenarPor(key) {
    setSort(s => {
      const primeira = ASC_PRIMEIRO.has(key) ? 'asc' : 'desc';
      const segunda  = primeira === 'asc' ? 'desc' : 'asc';
      if (s.key !== key)      return { key, dir: primeira };
      if (s.dir === primeira) return { key, dir: segunda };
      return { key: null, dir: 'desc' };   // volta ao padrão (urgentes primeiro)
    });
  }

  const ordenadas = useMemo(() => {
    const base = filtroStatus === 'todos' ? rows : rows.filter(r => r.status === filtroStatus);
    if (!sort.key) return base;                   // ordem original: mais urgente primeiro
    const dir = sort.dir === 'asc' ? 1 : -1;
    // status ordena por GRAVIDADE (ruptura > crítico > ...), não por alfabeto
    const rank = (r) => ORDEM.indexOf(r.status);
    return [...base].sort((a, b) => {
      if (sort.key === 'status') return (rank(a) - rank(b)) * dir;
      const va = a[sort.key];
      const vb = b[sort.key];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;                   // nulos sempre por último
      if (vb == null) return -1;
      const na = Number(va), nb = Number(vb);
      // só trata como número se AMBOS forem numéricos (evita "300" vs "ELETRO")
      if (Number.isFinite(na) && Number.isFinite(nb) && va !== '' && vb !== '') {
        return (na - nb) * dir;
      }
      return String(va).localeCompare(String(vb), 'pt-BR') * dir;
    });
  }, [rows, filtroStatus, sort]);

  const visiveis = useMemo(() => ordenadas.slice(0, 500), [ordenadas]);

  const semEstoque = estDatas.datas.length === 0;

  return (
    <div className="space-y-6">
      {semEstoque && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Ainda não há snapshot de estoque carregado. Rode{' '}
          <code className="font-mono text-xs">node scripts/ingest-estoque.mjs "&lt;estoque.xlsx&gt;"</code>{' '}
          para carregar a foto do estoque.
        </div>
      )}

      {/* Filtros */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Campo label="Vendas de">
            <input type="date" className={inputCls} value={form.from}
              min={periodo?.min_dia || undefined} max={periodo?.max_dia || undefined}
              onChange={e => set('from', e.target.value)} />
          </Campo>
          <Campo label="Vendas até">
            <input type="date" className={inputCls} value={form.to}
              min={periodo?.min_dia || undefined} max={periodo?.max_dia || undefined}
              onChange={e => set('to', e.target.value)} />
          </Campo>
          <Campo label="Foto do estoque">
            <select className={inputCls} value={form.data_estoque} onChange={e => set('data_estoque', e.target.value)}>
              {estDatas.datas.length === 0 && <option value="">—</option>}
              {estDatas.datas.map(d => <option key={d} value={d}>{fmtBR(d)}</option>)}
            </select>
          </Campo>
          <div className="flex items-end">
            <button onClick={consultar} disabled={loading || semEstoque}
              className="inline-flex items-center gap-2 w-full justify-center rounded-lg bg-sky-600 text-white px-4 py-2 text-sm font-medium hover:bg-sky-700 disabled:opacity-60">
              <Search size={16} /> {loading ? 'Calculando...' : 'Calcular'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
          <Campo label="Lead time (dias)">
            <input type="number" min="0" className={inputCls} value={form.lead_time}
              onChange={e => set('lead_time', Number(e.target.value))} />
          </Campo>
          <Campo label="Segurança (dias)">
            <input type="number" min="0" className={inputCls} value={form.dias_seguranca}
              onChange={e => set('dias_seguranca', Number(e.target.value))} />
          </Campo>
          <Campo label="Excesso acima de (dias)">
            <input type="number" min="1" className={inputCls} value={form.dias_excesso}
              onChange={e => set('dias_excesso', Number(e.target.value))} />
          </Campo>
        </div>

        <details>
          <summary className="text-xs text-slate-500 cursor-pointer select-none">Filtros avançados</summary>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
            <MultiSelect label="Filial"       options={opts.filiais}       value={form.filial_cod}       onChange={v => set('filial_cod', v)} />
            <MultiSelect label="Canal"        options={opts.canais}        value={form.canal_cod}        onChange={v => set('canal_cod', v)} />
            <MultiSelect label="Departamento" options={opts.departamentos} value={form.departamento_cod} onChange={v => set('departamento_cod', v)} />
            <MultiSelect label="Seção"        options={opts.secoes}        value={form.secao_cod}        onChange={v => set('secao_cod', v)} />
            <MultiSelect label="Fornecedor"   options={opts.fornecedores}  value={form.fornecedor_cod}   onChange={v => set('fornecedor_cod', v)} />
            <MultiSelect label="Comprador"    options={opts.compradores}   value={form.comprador_cod}    onChange={v => set('comprador_cod', v)} />
          </div>
          <p className="mt-2 text-xs text-slate-400">
            Dica: filtre pelas filiais de loja (300, 302, 303, 304, 305, 360). O CD87 e o depósito 313 têm outra escala e distorcem a leitura de loja.
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Canal e Fornecedor não existem no arquivo de estoque — eles filtram a venda (a média passa a ser só daquele canal/fornecedor) e restringem os produtos listados.
            Ao filtrar por canal, a cobertura fica conservadora: o estoque é físico e não se separa por canal.
          </p>
        </details>
      </section>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {jaConsultou && (
        <>
          {/* Resumo financeiro */}
          <section className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Card label="Custo da compra sugerida" value={money(totalCompra)} tone="sky" />
            <Card label="Estoque parado (sem giro + excesso)" value={money(valorParado)} tone="amber" />
            <Card label="Itens analisados" value={num(rows.length)} tone="slate" />
          </section>

          {/* Contagem por status (clicável) */}
          <section className="grid grid-cols-3 md:grid-cols-6 gap-3">
            {ORDEM.map(s => (
              <StatusCard key={s} s={s} value={contagem[s] || 0}
                ativo={filtroStatus === s}
                onClick={() => setFiltroStatus(t => t === s ? 'todos' : s)} />
            ))}
          </section>

          {/* Tabela */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-slate-800">
                Cobertura e sugestão de compra
                {filtroStatus !== 'todos' && <span className="ml-2 text-xs text-sky-700">({STATUS[filtroStatus]?.label})</span>}
              </h2>
              <span className="text-xs text-slate-500">
                {visiveis.length} de {filtroStatus === 'todos' ? rows.length : (contagem[filtroStatus] || 0)}
                {visiveis.length === 500 && ' (500 primeiros)'}
              </span>
            </div>
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 text-slate-600">
                  <tr>
                    <Th k="filial_cod"      sort={sort} onSort={ordenarPor} align="left">Filial</Th>
                    <Th k="produto_nome"    sort={sort} onSort={ordenarPor} align="left">Produto</Th>
                    <Th k="fornecedor_nome" sort={sort} onSort={ordenarPor} align="left">Fornecedor</Th>
                    <Th k="qtd_vendida"     sort={sort} onSort={ordenarPor}>Vendido</Th>
                    <Th k="media_diaria"    sort={sort} onSort={ordenarPor}>Média/dia</Th>
                    <Th k="base_media"      sort={sort} onSort={ordenarPor} align="center">Base</Th>
                    <Th k="disponivel"      sort={sort} onSort={ordenarPor}>Disponível</Th>
                    <Th k="cobertura_dias"  sort={sort} onSort={ordenarPor}>Cobertura</Th>
                    <Th k="status"          sort={sort} onSort={ordenarPor} align="center">Status</Th>
                    <Th k="sugestao_compra" sort={sort} onSort={ordenarPor}>Sugestão (un)</Th>
                    <Th k="custo_sugestao"  sort={sort} onSort={ordenarPor}>Custo da compra</Th>
                  </tr>
                </thead>
                <tbody>
                  {visiveis.map((r, i) => {
                    const st = STATUS[r.status] || STATUS.sem_giro;
                    return (
                      <tr key={r.filial_cod + '-' + r.produto_cod + i}
                        onClick={() => setDrill({
                          produto_cod: r.produto_cod,
                          produto_nome: r.produto_nome,
                          filial_cod: r.filial_cod,
                          fornecedor_cod: r.fornecedor_cod,
                          fornecedor_nome: r.fornecedor_nome,
                        })}
                        className="border-t border-slate-100 cursor-pointer hover:bg-sky-50">
                        <td className="p-3 font-mono text-xs text-slate-500">{r.filial_cod}</td>
                        <td className="p-3 text-slate-800">
                          <span className="font-mono text-xs text-slate-500 mr-2">{r.produto_cod}</span>
                          {r.produto_nome || ''}
                        </td>
                        <td className="p-3 text-slate-600">
                          {r.fornecedor_cod && <span className="font-mono text-xs text-slate-400 mr-2">{r.fornecedor_cod}</span>}
                          <span className="text-xs">{r.fornecedor_nome || '—'}</span>
                        </td>
                        <td className="p-3 text-right">{num2(r.qtd_vendida)}</td>
                        <td className="p-3 text-right font-medium">{num2(r.media_diaria)}</td>
                        <td className="p-3 text-center">
                          <span className={'text-[10px] px-1.5 py-0.5 rounded ' +
                            (r.base_media === 'dias_disponiveis' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500')}>
                            {r.base_media === 'dias_disponiveis' ? 'dias disp.' : 'dias corr.'}
                          </span>
                        </td>
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
                  {visiveis.length === 0 && !loading && (
                    <tr><td colSpan={11} className="p-8 text-center text-slate-500">Nenhum item.</td></tr>
                  )}
                  {loading && (
                    <tr><td colSpan={11} className="p-8 text-center text-slate-500">Calculando...</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-xs text-slate-400">
              Média/dia = quantidade vendida ÷ dias em que o produto estava disponível (quando há histórico de estoque no período);
              senão ÷ dias corridos. Sugestão = média/dia × (lead time + segurança) − disponível.
              Clique numa linha para ver a série de venda × estoque do produto.
            </p>
          </section>
        </>
      )}

      {drill && (
        <ProdutoDrill produto={drill} form={form} onClose={() => setDrill(null)} />
      )}
    </div>
  );
}

const inputCls = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-200';

function Campo({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs font-medium text-slate-600 mb-1">{label}</span>
      {children}
    </label>
  );
}

/** Cabeçalho ordenável: 1º clique ordena desc, 2º asc, 3º volta à ordem original. */
function Th({ k, sort, onSort, align = 'right', children }) {
  const ativo = sort.key === k;
  const seta = !ativo ? '' : (sort.dir === 'desc' ? ' ↓' : ' ↑');
  const just = align === 'left' ? 'text-left' : align === 'center' ? 'text-center' : 'text-right';
  return (
    <th className={`${just} p-3`}>
      <button type="button" onClick={() => onSort(k)}
        title="Ordenar"
        className={'inline-flex items-center gap-0.5 hover:text-slate-900 ' +
          (ativo ? 'text-sky-700 font-semibold' : 'text-slate-600')}>
        {children}<span className="text-[10px]">{seta}</span>
      </button>
    </th>
  );
}

function StatusCard({ s, value, ativo, onClick }) {
  const st = STATUS[s];
  return (
    <button type="button" onClick={onClick}
      className={`rounded-lg border p-3 text-left transition ${st.cls} ${ativo ? 'ring-2 ring-sky-400' : 'hover:shadow-sm'}`}>
      <p className="text-xs font-medium flex items-center gap-1"><st.Icon size={13} /> {st.label}</p>
      <p className="mt-1 text-xl font-bold">{Number(value).toLocaleString('pt-BR')}</p>
    </button>
  );
}

function Card({ label, value, tone }) {
  const cls = {
    sky:   'border-sky-200 bg-sky-50 text-sky-900',
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    slate: 'border-slate-200 bg-white text-slate-900',
  }[tone] || 'border-slate-200 bg-white text-slate-900';
  return (
    <div className={`rounded-lg border p-4 ${cls}`}>
      <p className="text-xs font-medium opacity-80">{label}</p>
      <p className="mt-1 text-lg font-bold">{value}</p>
    </div>
  );
}

function fmtBR(s) {
  if (!s) return '—';
  return new Date(s + 'T00:00:00').toLocaleDateString('pt-BR');
}
