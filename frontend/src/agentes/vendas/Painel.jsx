/**
 * Painel analítico de vendas.
 * Escolhe a dimensão de agrupamento + faixa de datas (+ filtros opcionais,
 * com busca e múltipla seleção) e mostra totais, gráfico e tabela — via
 * /agente/vendas/resumo.
 */
import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { api } from '../../lib/api';
import { MultiSelect } from './MultiSelect';
import { DrillDown } from './DrillDown';

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
  { v: 'dia',          label: 'Dia' },
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

// Filtros de múltipla escolha (arrays de código) e de texto (códigos livres).
const MULTI_KEYS = ['filial_cod', 'canal_cod', 'juridica', 'setor_cod', 'departamento_cod', 'secao_cod', 'comprador_cod'];
const TEXT_KEYS  = ['fornecedor_cod', 'produto_cod'];

const strOpts = (arr) => (arr || []).map(v => ({ cod: v, nome: v }));

export function Painel() {
  const [periodo, setPeriodo] = useState(null);
  const [opts, setOpts]       = useState({});
  const [form, setForm]       = useState({
    dim: 'comprador', from: '', to: '',
    filial_cod: [], canal_cod: [], juridica: [], setor_cod: [], departamento_cod: [],
    secao_cod: [], comprador_cod: [], fornecedor_cod: '', produto_cod: '',
  });
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
    api.get('/agente/vendas/resumo', { params })
      .then(r => setRows(r.data || []))
      .catch(e => { setError(e.response?.data?.error || e.message); setRows([]); })
      .finally(() => setLoading(false));
  }

  const totais = useMemo(() => rows.reduce((a, r) => {
    a.venda    += Number(r.venda_total || 0);
    a.vendaLiq += Number(r.venda_liquida_tot || 0);
    a.custo    += Number(r.custo_total || 0);
    a.lucro    += Number(r.lucro_bruto || 0);
    a.imposto  += Number(r.imposto_total || 0);
    a.qtd      += Number(r.qtd_total || 0);
    return a;
  }, { venda: 0, vendaLiq: 0, custo: 0, lucro: 0, imposto: 0, qtd: 0 }), [rows]);

  const margemGeral = totais.vendaLiq ? (totais.lucro / totais.vendaLiq) * 100 : null;

  const dimLabel = DIMENSOES.find(d => d.v === form.dim)?.label || 'Grupo';
  const chartData = rows.slice(0, 15).map(r => ({
    nome: String(r.grupo_nome || r.grupo_cod || '—').slice(0, 20),
    venda: Number(r.venda_total || 0),
  }));

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

      {/* Totais */}
      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <Card label="Venda total"  value={money(totais.venda)}   tone="sky" />
        <Card label="Custo"        value={money(totais.custo)}   tone="slate" />
        <Card label="Lucro bruto"  value={money(totais.lucro)}   tone="emerald" />
        <Card label="Margem"       value={pct(margemGeral)}      tone="emerald" />
        <Card label="Impostos"     value={money(totais.imposto)} tone="amber" />
        <Card label="Qtd. vendida" value={num(totais.qtd)}       tone="slate" />
      </section>

      {/* Gráfico */}
      <section className="rounded-xl border border-slate-200 bg-white p-4">
        <h2 className="font-semibold text-slate-800 mb-1">Top 15 por venda — {dimLabel}</h2>
        <p className="text-xs text-slate-500 mb-3">
          {periodo && `Período disponível: ${fmtBR(periodo.min_dia)} a ${fmtBR(periodo.max_dia)} (${periodo.dias} dias)`}
        </p>
        <div style={{ width: '100%', height: 320 }}>
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 8, right: 12, left: 8, bottom: 64 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="nome" angle={-35} textAnchor="end" interval={0} height={70} tick={{ fontSize: 11, fill: '#475569' }} />
              <YAxis tickFormatter={moneyShort} tick={{ fontSize: 11, fill: '#475569' }} width={64} />
              <Tooltip formatter={(v) => money(v)} labelStyle={{ color: '#0f172a' }} />
              <Bar dataKey="venda" fill="#0EA5E9" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Tabela */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold text-slate-800">Detalhe por {dimLabel.toLowerCase()}</h2>
          <span className="text-xs text-slate-500">
            {form.dim !== 'dia' && <span className="mr-2 text-slate-400">clique numa linha p/ abrir por filial</span>}
            {rows.length} grupo(s)
          </span>
        </div>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left p-3">{dimLabel}</th>
                <th className="text-right p-3">Qtd</th>
                <th className="text-right p-3">Dias</th>
                <th className="text-right p-3">Venda R$</th>
                <th className="text-right p-3">Custo R$</th>
                <th className="text-right p-3">Lucro R$</th>
                <th className="text-right p-3">Margem</th>
                <th className="text-right p-3">Lucro líq. R$</th>
                <th className="text-right p-3">Margem líq.</th>
                <th className="text-right p-3">Preço médio</th>
                <th className="text-right p-3">Venda/dia</th>
                <th className="text-right p-3">Impostos R$</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const clicavel = form.dim !== 'dia';
                return (
                <tr key={(r.grupo_cod || '') + i}
                  onClick={clicavel ? () => setDrill({ cod: r.grupo_cod, nome: r.grupo_nome }) : undefined}
                  className={'border-t border-slate-100 ' + (clicavel ? 'cursor-pointer hover:bg-sky-50' : 'hover:bg-slate-50')}>
                  <td className="p-3 font-medium text-slate-800">
                    {r.grupo_cod && <span className="font-mono text-xs text-slate-500 mr-2">{r.grupo_cod}</span>}
                    {r.grupo_nome || ''}
                  </td>
                  <td className="p-3 text-right">{num(r.qtd_total)}</td>
                  <td className="p-3 text-right">{num(r.dias)}</td>
                  <td className="p-3 text-right font-semibold text-slate-900">{money(r.venda_total)}</td>
                  <td className="p-3 text-right">{money(r.custo_total)}</td>
                  <td className={'p-3 text-right ' + (Number(r.lucro_bruto) < 0 ? 'text-rose-700' : 'text-emerald-700')}>{money(r.lucro_bruto)}</td>
                  <td className={'p-3 text-right ' + (Number(r.margem_pct) < 0 ? 'text-rose-700' : 'text-slate-700')}>{pct(r.margem_pct)}</td>
                  <td className={'p-3 text-right font-medium ' + (Number(r.lucro_liquido) < 0 ? 'text-rose-700' : 'text-emerald-700')}>{money(r.lucro_liquido)}</td>
                  <td className={'p-3 text-right ' + (Number(r.margem_liquida) < 0 ? 'text-rose-700' : 'text-slate-700')}>{pct(r.margem_liquida)}</td>
                  <td className="p-3 text-right">{money(r.preco_medio)}</td>
                  <td className="p-3 text-right">{money(r.venda_media_dia)}</td>
                  <td className="p-3 text-right text-amber-700">{money(r.imposto_total)}</td>
                </tr>
                );
              })}
              {rows.length === 0 && !loading && (
                <tr><td colSpan={12} className="p-8 text-center text-slate-500">Nenhum resultado para os filtros.</td></tr>
              )}
              {loading && (
                <tr><td colSpan={12} className="p-8 text-center text-slate-500">Carregando...</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {drill && (
        <DrillDown
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

function Card({ label, value, tone }) {
  const cls = {
    sky:     { border: 'border-sky-200',     bg: 'bg-sky-50',     txt: 'text-sky-700',     val: 'text-sky-900' },
    emerald: { border: 'border-emerald-200', bg: 'bg-emerald-50', txt: 'text-emerald-700', val: 'text-emerald-900' },
    amber:   { border: 'border-amber-200',   bg: 'bg-amber-50',   txt: 'text-amber-700',   val: 'text-amber-900' },
    slate:   { border: 'border-slate-200',   bg: 'bg-white',      txt: 'text-slate-600',   val: 'text-slate-900' },
  }[tone] || { border: 'border-slate-200', bg: 'bg-white', txt: 'text-slate-600', val: 'text-slate-900' };
  return (
    <div className={`rounded-lg border ${cls.border} ${cls.bg} p-4`}>
      <p className={`text-xs font-medium ${cls.txt}`}>{label}</p>
      <p className={`mt-1 text-lg font-bold ${cls.val}`}>{value}</p>
    </div>
  );
}

function fmtBR(s) {
  if (!s) return '—';
  return new Date(s + 'T00:00:00').toLocaleDateString('pt-BR');
}
