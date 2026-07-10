/**
 * Comparativo de vendas entre DOIS períodos.
 * Período base × período de comparação, por dimensão, com filtros e escolha
 * das métricas comparadas (quantidade, venda, margem — várias de uma vez).
 * Fonte: /agente/vendas/comparativo.
 */
import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { api } from '../../lib/api';
import { MultiSelect } from './MultiSelect';
import { ComparativoDrill } from './ComparativoDrill';

const DIMENSOES = [
  { v: 'comprador',    label: 'Comprador' },
  { v: 'filial',       label: 'Filial' },
  { v: 'canal',        label: 'Canal' },
  { v: 'juridica',     label: 'Jurídica' },
  { v: 'setor',        label: 'Setor' },
  { v: 'departamento', label: 'Departamento' },
  { v: 'secao',        label: 'Seção' },
  { v: 'fornecedor',   label: 'Fornecedor' },
  { v: 'produto',      label: 'Produto' },
];

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
const strOpts = (arr) => (arr || []).map(v => ({ cod: v, nome: v }));

// variação percentual base→comp
function varPct(base, comp) {
  if (base == null || comp == null) return null;
  if (Number(base) === 0) return comp > 0 ? Infinity : (comp < 0 ? -Infinity : 0);
  return ((comp - base) / Math.abs(base)) * 100;
}
function DeltaPct({ v }) {
  if (v == null) return <span className="text-slate-400">—</span>;
  if (!isFinite(v)) return <span className="text-emerald-700 font-medium">novo</span>;
  const cls = v > 0 ? 'text-emerald-700' : v < 0 ? 'text-rose-700' : 'text-slate-500';
  const s = (v > 0 ? '+' : '') + v.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
  return <span className={cls + ' font-medium'}>{s}</span>;
}
function DeltaPP({ base, comp }) {
  if (base == null || comp == null) return <span className="text-slate-400">—</span>;
  const d = comp - base;
  const cls = d > 0 ? 'text-emerald-700' : d < 0 ? 'text-rose-700' : 'text-slate-500';
  const s = (d > 0 ? '+' : '') + d.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + ' p.p.';
  return <span className={cls + ' font-medium'}>{s}</span>;
}

export function Comparativo() {
  const [periodo, setPeriodo] = useState(null);
  const [opts, setOpts]       = useState({});
  const [form, setForm]       = useState({
    dim: 'comprador',
    base_from: '', base_to: '', comp_from: '', comp_to: '',
    filial_cod: [], canal_cod: [], juridica: [], setor_cod: [], departamento_cod: [],
    secao_cod: [], comprador_cod: [], fornecedor_cod: '', produto_cod: '',
  });
  const [metricas, setMetricas] = useState({ qtd: true, venda: true, margem: true });
  const [rows, setRows]         = useState([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [drill, setDrill]       = useState(null); // { cod, nome } da linha clicada

  useEffect(() => {
    Promise.all([
      api.get('/agente/vendas/periodo').then(r => r.data),
      api.get('/agente/vendas/filtros').then(r => r.data),
    ]).then(([per, filt]) => {
      setPeriodo(per);
      setOpts(filt || {});
      // default: base = primeiro dia, comparação = último dia
      const nf = { ...form, base_from: per?.min_dia || '', base_to: per?.min_dia || '', comp_from: per?.max_dia || '', comp_to: per?.max_dia || '' };
      setForm(nf);
      consultar(nf);
    }).catch(e => setError(e.response?.data?.error || e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));
  const toggleMetrica = (k) => setMetricas(m => ({ ...m, [k]: !m[k] }));

  function consultar(f = form) {
    setLoading(true); setError('');
    const params = { dim: f.dim };
    for (const k of ['base_from', 'base_to', 'comp_from', 'comp_to']) if (f[k]) params[k] = f[k];
    for (const k of MULTI_KEYS) if (Array.isArray(f[k]) && f[k].length) params[k] = f[k].join(',');
    for (const k of TEXT_KEYS)  if ((f[k] || '').trim()) params[k] = f[k].trim();
    api.get('/agente/vendas/comparativo', { params })
      .then(r => setRows(r.data || []))
      .catch(e => { setError(e.response?.data?.error || e.message); setRows([]); })
      .finally(() => setLoading(false));
  }

  const totais = useMemo(() => rows.reduce((a, r) => {
    a.base_qtd += Number(r.base_qtd || 0); a.comp_qtd += Number(r.comp_qtd || 0);
    a.base_venda += Number(r.base_venda || 0); a.comp_venda += Number(r.comp_venda || 0);
    return a;
  }, { base_qtd: 0, comp_qtd: 0, base_venda: 0, comp_venda: 0 }), [rows]);

  const dimLabel = DIMENSOES.find(d => d.v === form.dim)?.label || 'Grupo';
  const metricaGrafico = metricas.venda ? 'venda' : (metricas.qtd ? 'qtd' : null);
  const chartData = rows.slice(0, 12).map(r => ({
    nome: String(r.grupo_nome || r.grupo_cod || '—').slice(0, 18),
    Base: Number(r[`base_${metricaGrafico}`] || 0),
    Comparação: Number(r[`comp_${metricaGrafico}`] || 0),
  }));
  const colCount = 1 + (metricas.qtd ? 3 : 0) + (metricas.venda ? 3 : 0) + (metricas.margem ? 3 : 0);

  return (
    <div className="space-y-6">
      {/* Filtros de períodos */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Campo label="Agrupar por">
            <select className={inputCls} value={form.dim} onChange={e => set('dim', e.target.value)}>
              {DIMENSOES.map(d => <option key={d.v} value={d.v}>{d.label}</option>)}
            </select>
          </Campo>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <PeriodoBox titulo="Período base" cor="slate"
            from={form.base_from} to={form.base_to}
            onFrom={v => set('base_from', v)} onTo={v => set('base_to', v)} periodo={periodo} />
          <PeriodoBox titulo="Período de comparação" cor="sky"
            from={form.comp_from} to={form.comp_to}
            onFrom={v => set('comp_from', v)} onTo={v => set('comp_to', v)} periodo={periodo} />
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <span className="text-xs font-medium text-slate-600">Comparar:</span>
          <Check label="Quantidade" on={metricas.qtd}    onClick={() => toggleMetrica('qtd')} />
          <Check label="Venda"      on={metricas.venda}  onClick={() => toggleMetrica('venda')} />
          <Check label="Margem"     on={metricas.margem} onClick={() => toggleMetrica('margem')} />
          <button onClick={() => consultar()} disabled={loading}
            className="ml-auto inline-flex items-center gap-2 rounded-lg bg-sky-600 text-white px-4 py-2 text-sm font-medium hover:bg-sky-700 disabled:opacity-60">
            <Search size={16} /> {loading ? 'Consultando...' : 'Comparar'}
          </button>
        </div>

        <details>
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

      {/* Totais dos dois períodos */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Venda base"        value={money(totais.base_venda)} tone="slate" />
        <Card label="Venda comparação"  value={money(totais.comp_venda)} tone="sky"
          extra={<DeltaPct v={varPct(totais.base_venda, totais.comp_venda)} />} />
        <Card label="Qtd base"          value={num(totais.base_qtd)}     tone="slate" />
        <Card label="Qtd comparação"    value={num(totais.comp_qtd)}     tone="sky"
          extra={<DeltaPct v={varPct(totais.base_qtd, totais.comp_qtd)} />} />
      </section>

      {/* Gráfico base × comparação */}
      {metricaGrafico && (
        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold text-slate-800 mb-3">
            Base × Comparação — {dimLabel} ({metricaGrafico === 'venda' ? 'venda' : 'quantidade'}, top 12)
          </h2>
          <div style={{ width: '100%', height: 320 }}>
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 8, right: 12, left: 8, bottom: 64 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                <XAxis dataKey="nome" angle={-35} textAnchor="end" interval={0} height={70} tick={{ fontSize: 11, fill: '#475569' }} />
                <YAxis tickFormatter={metricaGrafico === 'venda' ? moneyShort : num} tick={{ fontSize: 11, fill: '#475569' }} width={64} />
                <Tooltip formatter={(v) => (metricaGrafico === 'venda' ? money(v) : num(v))} />
                <Legend />
                <Bar dataKey="Base" fill="#94a3b8" radius={[3, 3, 0, 0]} />
                <Bar dataKey="Comparação" fill="#0EA5E9" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {/* Tabela */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-800">Comparativo por {dimLabel.toLowerCase()}</h2>
          <span className="text-xs text-slate-500">
            <span className="mr-2 text-slate-400">clique numa linha p/ abrir por filial</span>
            {rows.length} grupo(s)
          </span>
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th rowSpan={2} className="text-left p-3 align-bottom">{dimLabel}</th>
                {metricas.qtd    && <th colSpan={3} className="text-center p-2 border-l border-slate-200">Quantidade</th>}
                {metricas.venda  && <th colSpan={3} className="text-center p-2 border-l border-slate-200">Venda</th>}
                {metricas.margem && <th colSpan={3} className="text-center p-2 border-l border-slate-200">Margem</th>}
              </tr>
              <tr className="text-xs">
                {metricas.qtd    && <><th className="text-right p-2 border-l border-slate-200">Base</th><th className="text-right p-2">Comp.</th><th className="text-right p-2">Δ</th></>}
                {metricas.venda  && <><th className="text-right p-2 border-l border-slate-200">Base</th><th className="text-right p-2">Comp.</th><th className="text-right p-2">Δ</th></>}
                {metricas.margem && <><th className="text-right p-2 border-l border-slate-200">Base</th><th className="text-right p-2">Comp.</th><th className="text-right p-2">Δ</th></>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={(r.grupo_cod || '') + i}
                  onClick={() => setDrill({ cod: r.grupo_cod, nome: r.grupo_nome })}
                  className="border-t border-slate-100 cursor-pointer hover:bg-sky-50">
                  <td className="p-3 font-medium text-slate-800">
                    {r.grupo_cod && <span className="font-mono text-xs text-slate-500 mr-2">{r.grupo_cod}</span>}
                    {r.grupo_nome || ''}
                  </td>
                  {metricas.qtd && <>
                    <td className="p-2 text-right border-l border-slate-100">{num(r.base_qtd)}</td>
                    <td className="p-2 text-right">{num(r.comp_qtd)}</td>
                    <td className="p-2 text-right"><DeltaPct v={varPct(r.base_qtd, r.comp_qtd)} /></td>
                  </>}
                  {metricas.venda && <>
                    <td className="p-2 text-right border-l border-slate-100">{money(r.base_venda)}</td>
                    <td className="p-2 text-right">{money(r.comp_venda)}</td>
                    <td className="p-2 text-right"><DeltaPct v={varPct(r.base_venda, r.comp_venda)} /></td>
                  </>}
                  {metricas.margem && <>
                    <td className="p-2 text-right border-l border-slate-100">{pct(r.base_margem)}</td>
                    <td className="p-2 text-right">{pct(r.comp_margem)}</td>
                    <td className="p-2 text-right"><DeltaPP base={r.base_margem} comp={r.comp_margem} /></td>
                  </>}
                </tr>
              ))}
              {rows.length === 0 && !loading && (
                <tr><td colSpan={colCount} className="p-8 text-center text-slate-500">Nenhum resultado para os filtros.</td></tr>
              )}
              {loading && (
                <tr><td colSpan={colCount} className="p-8 text-center text-slate-500">Carregando...</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {drill && (
        <ComparativoDrill
          dim={form.dim}
          dimLabel={dimLabel}
          cod={drill.cod}
          nome={drill.nome}
          form={form}
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

function PeriodoBox({ titulo, cor, from, to, onFrom, onTo, periodo }) {
  const ring = cor === 'sky' ? 'border-sky-200 bg-sky-50/40' : 'border-slate-200';
  return (
    <div className={`rounded-lg border ${ring} p-3`}>
      <p className="text-sm font-semibold text-slate-700 mb-2">{titulo}</p>
      <div className="grid grid-cols-2 gap-3">
        <Campo label="De">
          <input type="date" className={inputCls} value={from}
            min={periodo?.min_dia || undefined} max={periodo?.max_dia || undefined}
            onChange={e => onFrom(e.target.value)} />
        </Campo>
        <Campo label="Até">
          <input type="date" className={inputCls} value={to}
            min={periodo?.min_dia || undefined} max={periodo?.max_dia || undefined}
            onChange={e => onTo(e.target.value)} />
        </Campo>
      </div>
    </div>
  );
}

function Check({ label, on, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className={'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm ' +
        (on ? 'border-sky-500 bg-sky-50 text-sky-800' : 'border-slate-300 text-slate-600 hover:bg-slate-50')}>
      <span className={'flex h-4 w-4 items-center justify-center rounded border text-white ' + (on ? 'bg-sky-600 border-sky-600' : 'border-slate-300')}>
        {on && '✓'}
      </span>
      {label}
    </button>
  );
}

function Card({ label, value, tone, extra }) {
  const cls = {
    sky:   { border: 'border-sky-200',   bg: 'bg-sky-50', txt: 'text-sky-700',   val: 'text-sky-900' },
    slate: { border: 'border-slate-200', bg: 'bg-white',  txt: 'text-slate-600', val: 'text-slate-900' },
  }[tone] || { border: 'border-slate-200', bg: 'bg-white', txt: 'text-slate-600', val: 'text-slate-900' };
  return (
    <div className={`rounded-lg border ${cls.border} ${cls.bg} p-4`}>
      <p className={`text-xs font-medium ${cls.txt}`}>{label}</p>
      <p className={`mt-1 text-lg font-bold ${cls.val}`}>{value}</p>
      {extra && <p className="mt-0.5 text-xs">{extra}</p>}
    </div>
  );
}
