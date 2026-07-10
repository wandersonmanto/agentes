/**
 * Tendência de vendas: média de venda/dia no range escolhido e classificação
 * de cada grupo em queda / crescimento / estável (via inclinação da série
 * diária). Fonte: /agente/vendas/tendencia.
 */
import { useEffect, useMemo, useState } from 'react';
import { Search, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { api } from '../../lib/api';
import { MultiSelect } from './MultiSelect';
import { DrillDown } from './DrillDown';

const DIMENSOES = [
  { v: 'produto',      label: 'Produto' },
  { v: 'comprador',    label: 'Comprador' },
  { v: 'fornecedor',   label: 'Fornecedor' },
  { v: 'secao',        label: 'Seção' },
  { v: 'departamento', label: 'Departamento' },
  { v: 'setor',        label: 'Setor' },
  { v: 'filial',       label: 'Filial' },
];

const money = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num   = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
const num3  = (v) => Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 });
const pct   = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%');

const MULTI_KEYS = ['filial_cod', 'canal_cod', 'juridica', 'setor_cod', 'departamento_cod', 'secao_cod', 'comprador_cod'];
const TEXT_KEYS  = ['fornecedor_cod', 'produto_cod'];
const strOpts = (arr) => (arr || []).map(v => ({ cod: v, nome: v }));

const TEND = {
  crescimento:  { label: 'Crescimento', cls: 'bg-emerald-100 text-emerald-800', Icon: TrendingUp },
  queda:        { label: 'Queda',       cls: 'bg-rose-100 text-rose-800',       Icon: TrendingDown },
  estavel:      { label: 'Estável',     cls: 'bg-slate-100 text-slate-700',     Icon: Minus },
  insuficiente: { label: 'Insuf.',      cls: 'bg-slate-50 text-slate-400',      Icon: Minus },
};

export function Tendencia() {
  const [periodo, setPeriodo] = useState(null);
  const [opts, setOpts]       = useState({});
  const [form, setForm]       = useState({
    dim: 'produto', from: '', to: '',
    filial_cod: [], canal_cod: [], juridica: [], setor_cod: [], departamento_cod: [],
    secao_cod: [], comprador_cod: [], fornecedor_cod: '', produto_cod: '',
  });
  const [filtroTend, setFiltroTend] = useState('todas');
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [drill, setDrill]     = useState(null); // { cod, nome } da linha clicada

  useEffect(() => {
    Promise.all([
      api.get('/agente/vendas/periodo').then(r => r.data),
      api.get('/agente/vendas/filtros').then(r => r.data),
    ]).then(([per, filt]) => {
      setPeriodo(per);
      setOpts(filt || {});
      const nf = { ...form, from: per?.min_dia || '', to: per?.max_dia || '' };
      setForm(nf);
      consultar(nf);
    }).catch(e => setError(e.response?.data?.error || e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  function consultar(f = form) {
    setLoading(true); setError('');
    const params = { dim: f.dim };
    if (f.from) params.from = f.from;
    if (f.to)   params.to   = f.to;
    for (const k of MULTI_KEYS) if (Array.isArray(f[k]) && f[k].length) params[k] = f[k].join(',');
    for (const k of TEXT_KEYS)  if ((f[k] || '').trim()) params[k] = f[k].trim();
    api.get('/agente/vendas/tendencia', { params })
      .then(r => setRows(r.data || []))
      .catch(e => { setError(e.response?.data?.error || e.message); setRows([]); })
      .finally(() => setLoading(false));
  }

  const contagem = useMemo(() => rows.reduce((a, r) => {
    a[r.tendencia] = (a[r.tendencia] || 0) + 1; return a;
  }, {}), [rows]);

  const visiveis = useMemo(
    () => (filtroTend === 'todas' ? rows : rows.filter(r => r.tendencia === filtroTend)),
    [rows, filtroTend]
  );

  const dimLabel = DIMENSOES.find(d => d.v === form.dim)?.label || 'Grupo';

  return (
    <div className="space-y-6">
      {/* Filtros */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Campo label="Agrupar por">
            <select className={inputCls} value={form.dim} onChange={e => set('dim', e.target.value)}>
              {DIMENSOES.map(d => <option key={d.v} value={d.v}>{d.label}</option>)}
            </select>
          </Campo>
          <Campo label="De">
            <input type="date" className={inputCls} value={form.from}
              min={periodo?.min_dia || undefined} max={periodo?.max_dia || undefined}
              onChange={e => set('from', e.target.value)} />
          </Campo>
          <Campo label="Até">
            <input type="date" className={inputCls} value={form.to}
              min={periodo?.min_dia || undefined} max={periodo?.max_dia || undefined}
              onChange={e => set('to', e.target.value)} />
          </Campo>
          <div className="flex items-end">
            <button onClick={() => consultar()} disabled={loading}
              className="inline-flex items-center gap-2 w-full justify-center rounded-lg bg-sky-600 text-white px-4 py-2 text-sm font-medium hover:bg-sky-700 disabled:opacity-60">
              <Search size={16} /> {loading ? 'Consultando...' : 'Consultar'}
            </button>
          </div>
        </div>

        <details className="mt-3">
          <summary className="text-xs text-slate-500 cursor-pointer select-none">Filtros avançados</summary>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
            <MultiSelect label="Filial"       options={opts.filiais}       value={form.filial_cod}       onChange={v => set('filial_cod', v)} />
            <MultiSelect label="Canal"        options={opts.canais}        value={form.canal_cod}        onChange={v => set('canal_cod', v)} />
            <MultiSelect label="Setor"        options={opts.setores}       value={form.setor_cod}        onChange={v => set('setor_cod', v)} />
            <MultiSelect label="Departamento" options={opts.departamentos} value={form.departamento_cod} onChange={v => set('departamento_cod', v)} />
            <MultiSelect label="Seção"        options={opts.secoes}        value={form.secao_cod}        onChange={v => set('secao_cod', v)} />
            <MultiSelect label="Comprador"    options={opts.compradores}   value={form.comprador_cod}    onChange={v => set('comprador_cod', v)} />
            <MultiSelect label="Jurídica"     options={strOpts(opts.juridica)} value={form.juridica}     onChange={v => set('juridica', v)} />
            <Campo label="Cód. fornecedor">
              <input className={inputCls} placeholder="ex.: 70, 351" value={form.fornecedor_cod}
                onChange={e => set('fornecedor_cod', e.target.value)} />
            </Campo>
            <Campo label="Cód. produto">
              <input className={inputCls} placeholder="ex.: 2511, 44316" value={form.produto_cod}
                onChange={e => set('produto_cod', e.target.value)} />
            </Campo>
          </div>
        </details>
      </section>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {/* Contagem por tendência (clicável = filtra) */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <ContaCard tone="emerald" ativo={filtroTend === 'crescimento'} label="Crescimento" value={contagem.crescimento || 0} onClick={() => setFiltroTend(t => t === 'crescimento' ? 'todas' : 'crescimento')} />
        <ContaCard tone="rose"    ativo={filtroTend === 'queda'}       label="Queda"       value={contagem.queda || 0}       onClick={() => setFiltroTend(t => t === 'queda' ? 'todas' : 'queda')} />
        <ContaCard tone="slate"   ativo={filtroTend === 'estavel'}     label="Estável"     value={contagem.estavel || 0}     onClick={() => setFiltroTend(t => t === 'estavel' ? 'todas' : 'estavel')} />
        <ContaCard tone="slate"   ativo={filtroTend === 'insuficiente'} label="Insuficiente" value={contagem.insuficiente || 0} onClick={() => setFiltroTend(t => t === 'insuficiente' ? 'todas' : 'insuficiente')} />
      </section>

      {/* Como classificamos */}
      <details className="rounded-xl border border-slate-200 bg-white p-4">
        <summary className="text-sm font-medium text-slate-700 cursor-pointer select-none">Como classificamos a tendência</summary>
        <div className="mt-3 space-y-2">
          <p className="text-xs text-slate-500">
            Para cada grupo ajustamos uma reta na venda de cada dia do período (regressão linear). A inclinação
            dessa reta, medida em % da média de venda por dia (coluna <b>Var./dia</b>), define a tendência:
          </p>
          <LinhaLegenda t="crescimento" texto="A venda diária vem subindo — inclinação positiva, ≥ +1% da média/dia (tende a vender mais no fim do período do que no começo)." />
          <LinhaLegenda t="queda"       texto="A venda diária vem caindo — inclinação negativa, ≤ −1% da média/dia." />
          <LinhaLegenda t="estavel"     texto="Sem tendência clara — inclinação entre −1% e +1% da média/dia; oscila em torno da média." />
          <LinhaLegenda t="insuficiente" texto="Menos de 2 dias com venda no período — não há pontos suficientes para calcular a tendência." />
        </div>
      </details>

      {/* Tabela */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-800">
            Tendência por {dimLabel.toLowerCase()}
            {filtroTend !== 'todas' && <span className="ml-2 text-xs text-sky-700">(filtrado: {TEND[filtroTend]?.label})</span>}
          </h2>
          <span className="text-xs text-slate-500">{visiveis.length} de {rows.length}</span>
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left p-3">{dimLabel}</th>
                <th className="text-right p-3">Dias</th>
                <th className="text-right p-3">Venda total</th>
                <th className="text-right p-3">Média/dia</th>
                <th className="text-right p-3">Qtd média/dia</th>
                <th className="text-right p-3">Var./dia</th>
                <th className="text-right p-3">Margem</th>
                <th className="text-center p-3">Tendência</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map((r, i) => {
                const t = TEND[r.tendencia] || TEND.insuficiente;
                return (
                  <tr key={(r.grupo_cod || '') + i}
                    onClick={() => setDrill({ cod: r.grupo_cod, nome: r.grupo_nome })}
                    className="border-t border-slate-100 cursor-pointer hover:bg-sky-50">
                    <td className="p-3 font-medium text-slate-800">
                      {r.grupo_cod && <span className="font-mono text-xs text-slate-500 mr-2">{r.grupo_cod}</span>}
                      {r.grupo_nome || ''}
                    </td>
                    <td className="p-3 text-right">{num(r.dias)}</td>
                    <td className="p-3 text-right font-semibold text-slate-900">{money(r.venda_total)}</td>
                    <td className="p-3 text-right">{money(r.venda_media_dia)}</td>
                    <td className="p-3 text-right">{num3(r.qtd_media_dia)}</td>
                    <td className={'p-3 text-right ' + (Number(r.slope_pct_dia) > 0 ? 'text-emerald-700' : Number(r.slope_pct_dia) < 0 ? 'text-rose-700' : 'text-slate-500')}>
                      {r.slope_pct_dia == null ? '—' : (Number(r.slope_pct_dia) > 0 ? '+' : '') + pct(r.slope_pct_dia)}
                    </td>
                    <td className="p-3 text-right">{pct(r.margem_pct)}</td>
                    <td className="p-3 text-center">
                      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${t.cls}`}>
                        <t.Icon size={13} /> {t.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
              {visiveis.length === 0 && !loading && (
                <tr><td colSpan={8} className="p-8 text-center text-slate-500">Nenhum resultado.</td></tr>
              )}
              {loading && (
                <tr><td colSpan={8} className="p-8 text-center text-slate-500">Carregando...</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Var./dia = inclinação da venda diária em % da média/dia. Crescimento ≥ +1%/dia, queda ≤ −1%/dia; menos de 2 dias com venda = insuficiente. Clique numa linha p/ abrir por filial.
        </p>
      </section>

      {drill && (
        <DrillDown
          dim={form.dim}
          dimLabel={dimLabel}
          cod={drill.cod}
          nome={drill.nome}
          form={form}
          comTendencia
          onClose={() => setDrill(null)}
        />
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

function LinhaLegenda({ t, texto }) {
  const cfg = TEND[t] || TEND.insuficiente;
  return (
    <div className="flex items-start gap-2 text-sm text-slate-600">
      <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium shrink-0 ${cfg.cls}`}>
        <cfg.Icon size={13} /> {cfg.label}
      </span>
      <span className="pt-0.5">{texto}</span>
    </div>
  );
}

function ContaCard({ label, value, tone, ativo, onClick }) {
  const cls = {
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    rose:    'border-rose-200 bg-rose-50 text-rose-800',
    slate:   'border-slate-200 bg-white text-slate-700',
  }[tone] || 'border-slate-200 bg-white text-slate-700';
  return (
    <button type="button" onClick={onClick}
      className={`rounded-lg border p-4 text-left transition ${cls} ${ativo ? 'ring-2 ring-sky-400' : 'hover:shadow-sm'}`}>
      <p className="text-xs font-medium">{label}</p>
      <p className="mt-1 text-2xl font-bold">{Number(value).toLocaleString('pt-BR')}</p>
    </button>
  );
}
