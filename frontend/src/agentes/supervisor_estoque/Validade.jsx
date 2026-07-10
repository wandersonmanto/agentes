/**
 * Sub-aba "Validade" — cadastro de validade média por seção e política da
 * loja sobre o recebimento.
 *
 * - Tabela com TODAS as seções existentes na MV, marcando as cadastradas
 *   em amarelo claro e contando produtos / valor em estoque pra priorizar.
 * - Edição inline da validade e categoria.
 * - Banner editável com a política global "X% da validade gasta no
 *   recebimento" (default 10%).
 * - Botão "Importar XLSX" lê a planilha que o comprador cadastrou offline
 *   e envia em lote pro backend (extrai número de "180 dias" via regex).
 */
import { useEffect, useMemo, useState } from 'react';
import { Save, Upload, AlertCircle, CheckCircle2 } from 'lucide-react';
import { api } from '../../lib/api';

const CATEGORIAS = ['perecivel', 'resfriado', 'congelado', 'nao_perecivel'];
const CATEGORIA_LABEL = {
  perecivel:     { texto: 'Perecível',     cls: 'bg-rose-100 text-rose-800' },
  resfriado:     { texto: 'Resfriado',     cls: 'bg-sky-100 text-sky-800' },
  congelado:     { texto: 'Congelado',     cls: 'bg-indigo-100 text-indigo-800' },
  nao_perecivel: { texto: 'Não perecível', cls: 'bg-slate-100 text-slate-700' },
};

export function Validade() {
  const [secoes, setSecoes]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro]       = useState('');
  const [busca, setBusca]     = useState('');
  const [filtro, setFiltro]   = useState('todas'); // todas | cadastradas | nao_cadastradas
  const [config, setConfig]   = useState({ pct_max_validade_no_recebimento: 0.10 });
  const [pctEdit, setPctEdit] = useState('');
  const [salvandoConfig, setSalvandoConfig] = useState(false);
  const [salvandoLinha, setSalvandoLinha]   = useState(null);
  const [importando, setImportando]         = useState(false);
  const [importResultado, setImportResultado] = useState(null);

  // Carrega tudo
  useEffect(() => {
    setLoading(true);
    setErro('');
    Promise.all([
      api.get('/agente/supervisor_estoque/secao-validade'),
      api.get('/agente/supervisor_estoque/config'),
    ])
      .then(([rSec, rCfg]) => {
        setSecoes(rSec.data);
        setConfig(rCfg.data);
        setPctEdit(String((rCfg.data.pct_max_validade_no_recebimento * 100).toFixed(0)));
      })
      .catch(e => setErro(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, []);

  const totais = useMemo(() => {
    const cadastradas = secoes.filter(s => s.cadastrada).length;
    const valorTotal  = secoes.reduce((acc, s) => acc + Number(s.valor_estoque || 0), 0);
    const valorCadastrado = secoes
      .filter(s => s.cadastrada)
      .reduce((acc, s) => acc + Number(s.valor_estoque || 0), 0);
    return { total: secoes.length, cadastradas, valorTotal, valorCadastrado };
  }, [secoes]);

  const filtradas = useMemo(() => {
    let list = secoes;
    if (filtro === 'cadastradas')      list = list.filter(s => s.cadastrada);
    if (filtro === 'nao_cadastradas')  list = list.filter(s => !s.cadastrada);
    if (busca.trim()) {
      const q = busca.trim().toLowerCase();
      list = list.filter(s =>
        (s.chave_secao  || '').toLowerCase().includes(q)
        || (s.descricao    || '').toLowerCase().includes(q)
        || (s.departamento || '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [secoes, filtro, busca]);

  async function salvarConfig() {
    const pct = Number(pctEdit) / 100;
    if (!Number.isFinite(pct) || pct < 0 || pct >= 1) {
      setErro('Política deve ser número entre 0 e 99.');
      return;
    }
    setSalvandoConfig(true);
    try {
      const { data } = await api.put('/agente/supervisor_estoque/config', {
        pct_max_validade_no_recebimento: pct,
      });
      setConfig(data);
      setErro('');
    } catch (e) {
      setErro(e.response?.data?.error || e.message);
    } finally {
      setSalvandoConfig(false);
    }
  }

  function atualizarLinha(chave, patch) {
    setSecoes(prev => prev.map(s => s.chave_secao === chave ? { ...s, ...patch } : s));
  }

  async function salvarLinha(s) {
    setSalvandoLinha(s.chave_secao);
    try {
      const body = {
        descricao:           s.descricao,
        departamento:        s.departamento,
        validade_media_dias: s.validade_media_dias,
        categoria:           s.categoria || null,
        observacoes:         s.observacoes || null,
      };
      const { data } = await api.put(
        `/agente/supervisor_estoque/secao-validade/${encodeURIComponent(s.chave_secao)}`,
        body,
      );
      atualizarLinha(s.chave_secao, {
        ...data,
        cadastrada: data.validade_media_dias != null,
      });
      setErro('');
    } catch (e) {
      setErro(e.response?.data?.error || e.message);
    } finally {
      setSalvandoLinha(null);
    }
  }

  async function importarXlsx(ev) {
    const file = ev.target.files?.[0];
    if (!file) return;
    setImportando(true);
    setImportResultado(null);
    setErro('');
    try {
      const XLSX = await import('xlsx');
      const buf  = await file.arrayBuffer();
      const wb   = XLSX.read(buf, { type: 'array' });
      const sn   = wb.SheetNames[0];
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[sn], { defval: null });
      const itens = rows
        .map(r => ({
          chave_secao:         (r.chave_secao || r.chave || '').toString().trim(),
          descricao:           r.descricao    || null,
          departamento:        r.departamento || null,
          validade_media_dias: r.validade_media_dias ?? null,
          categoria:           r.categoria   || null,
          observacoes:         r.observacoes || null,
        }))
        .filter(it => it.chave_secao);
      const { data } = await api.post(
        '/agente/supervisor_estoque/secao-validade/importar',
        { itens },
      );
      setImportResultado(data);
      // Reload
      const { data: lista } = await api.get('/agente/supervisor_estoque/secao-validade');
      setSecoes(lista);
    } catch (e) {
      setErro(e.response?.data?.error || e.message);
    } finally {
      setImportando(false);
      ev.target.value = '';
    }
  }

  function fmtNum(v) {
    if (v == null) return '—';
    return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  }
  function fmtMoney(v) {
    if (v == null) return '—';
    return Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Política da loja */}
      <section className="bg-white border border-slate-200 rounded-lg p-4">
        <h2 className="text-sm font-semibold text-slate-800">Política de recebimento da loja</h2>
        <p className="text-xs text-slate-500 mt-1">
          "Não aceitamos produto com mais de X% da validade já gasta no recebimento."
          A validade efetiva de cada produto = validade média da seção × (1 − X%).
        </p>
        <div className="mt-3 flex items-end gap-3">
          <div>
            <label className="block text-xs text-slate-600 mb-1">Máximo de validade gasta no recebimento (%)</label>
            <input
              type="number"
              min="0" max="99" step="1"
              value={pctEdit}
              onChange={e => setPctEdit(e.target.value)}
              className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white w-24"
            />
          </div>
          <button
            onClick={salvarConfig}
            disabled={salvandoConfig}
            className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
          >
            <Save size={14} />
            {salvandoConfig ? 'Salvando...' : 'Salvar política'}
          </button>
          <div className="text-xs text-slate-500">
            Atual: <strong>{(config.pct_max_validade_no_recebimento * 100).toFixed(0)}%</strong>
          </div>
        </div>
      </section>

      {/* Resumo + filtros */}
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-4 text-sm">
          <span className="text-slate-600">
            Seções: <strong className="text-slate-900">{fmtNum(totais.total)}</strong>
          </span>
          <span className="text-slate-600">
            Cadastradas: <strong className="text-emerald-700">{fmtNum(totais.cadastradas)}</strong>
            <span className="text-slate-400 ml-1">
              ({totais.total ? Math.round(100 * totais.cadastradas / totais.total) : 0}%)
            </span>
          </span>
          <span className="text-slate-600">
            Valor coberto: <strong className="text-slate-900">{fmtMoney(totais.valorCadastrado)}</strong>
            <span className="text-slate-400 ml-1">de {fmtMoney(totais.valorTotal)}</span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={filtro}
            onChange={e => setFiltro(e.target.value)}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white"
          >
            <option value="todas">Todas</option>
            <option value="cadastradas">Só cadastradas</option>
            <option value="nao_cadastradas">Só não cadastradas</option>
          </select>
          <input
            type="search"
            placeholder="Buscar seção/departamento..."
            value={busca}
            onChange={e => setBusca(e.target.value)}
            className="border border-slate-300 rounded-md px-2 py-1.5 text-sm bg-white w-64"
          />
          <label className="inline-flex items-center gap-1 px-3 py-1.5 text-sm font-medium rounded-md bg-white border border-slate-300 cursor-pointer hover:bg-slate-50">
            <Upload size={14} />
            {importando ? 'Importando...' : 'Importar XLSX'}
            <input type="file" accept=".xlsx" onChange={importarXlsx} className="hidden" disabled={importando} />
          </label>
        </div>
      </section>

      {erro && (
        <div className="bg-red-50 border border-red-200 text-red-800 text-sm rounded p-3 flex items-start gap-2">
          <AlertCircle size={16} className="mt-0.5" />
          <span>{erro}</span>
        </div>
      )}
      {importResultado && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded p-3 flex items-start gap-2">
          <CheckCircle2 size={16} className="mt-0.5" />
          <span>
            Importação concluída: <strong>{importResultado.inseridas}</strong> novas,{' '}
            <strong>{importResultado.atualizadas}</strong> atualizadas
            {importResultado.ignoradas > 0 && <>, {importResultado.ignoradas} ignoradas</>}.
          </span>
        </div>
      )}

      {/* Tabela */}
      {loading ? (
        <p className="text-slate-500">Carregando...</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600 sticky top-0 z-10 shadow-[0_1px_0_0_rgb(226_232_240)]">
              <tr>
                <th className="text-left p-3">Seção</th>
                <th className="text-left p-3">Departamento</th>
                <th className="text-right p-3">Produtos</th>
                <th className="text-right p-3">Valor estoque</th>
                <th className="text-right p-3">Validade (dias)</th>
                <th className="text-left p-3">Categoria</th>
                <th className="text-left p-3">Observações</th>
                <th className="text-left p-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtradas.map(s => {
                const cls = s.cadastrada ? 'bg-amber-50/40' : '';
                const catInfo = s.categoria ? CATEGORIA_LABEL[s.categoria] : null;
                return (
                  <tr key={s.chave_secao} className={`border-t border-slate-100 ${cls}`}>
                    <td className="p-3 font-medium text-slate-800 min-w-[240px]">
                      {s.chave_secao}
                    </td>
                    <td className="p-3 text-xs text-slate-600">{s.departamento || '—'}</td>
                    <td className="p-3 text-right text-slate-700">{fmtNum(s.produtos)}</td>
                    <td className="p-3 text-right text-slate-700">{fmtMoney(s.valor_estoque)}</td>
                    <td className="p-3 text-right">
                      <input
                        type="number" min="0" step="1"
                        value={s.validade_media_dias ?? ''}
                        onChange={e => atualizarLinha(s.chave_secao, {
                          validade_media_dias: e.target.value === '' ? null : Number(e.target.value),
                        })}
                        className="border border-slate-300 rounded px-2 py-1 text-sm bg-white w-20 text-right"
                      />
                    </td>
                    <td className="p-3">
                      <select
                        value={s.categoria || ''}
                        onChange={e => atualizarLinha(s.chave_secao, { categoria: e.target.value || null })}
                        className="border border-slate-300 rounded px-2 py-1 text-sm bg-white"
                      >
                        <option value="">—</option>
                        {CATEGORIAS.map(c => (
                          <option key={c} value={c}>{CATEGORIA_LABEL[c].texto}</option>
                        ))}
                      </select>
                      {catInfo && (
                        <span className={`ml-2 inline-flex text-[10px] font-medium px-1.5 py-0.5 rounded ${catInfo.cls}`}>
                          {catInfo.texto}
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      <input
                        type="text"
                        value={s.observacoes ?? ''}
                        onChange={e => atualizarLinha(s.chave_secao, { observacoes: e.target.value })}
                        className="border border-slate-300 rounded px-2 py-1 text-sm bg-white w-40"
                        placeholder="opcional"
                      />
                    </td>
                    <td className="p-3">
                      <button
                        onClick={() => salvarLinha(s)}
                        disabled={salvandoLinha === s.chave_secao}
                        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-rose-600 text-white hover:bg-rose-700 disabled:opacity-50"
                      >
                        <Save size={12} />
                        {salvandoLinha === s.chave_secao ? '...' : 'Salvar'}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filtradas.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-500">
                    Nenhuma seção encontrada.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
