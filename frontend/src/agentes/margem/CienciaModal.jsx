import { useState } from 'react';
import { api } from '../../lib/api';

const MOTIVOS = [
  { v: 'vencimento',           l: 'Vencimento próximo' },
  { v: 'estoque_parado',       l: 'Estoque parado' },
  { v: 'descontinuidade',      l: 'Produto em descontinuidade' },
  { v: 'erro_cadastro',        l: 'Erro de cadastro' },
  { v: 'estrategia_comercial', l: 'Estratégia comercial' },
  { v: 'outro',                l: 'Outro' },
];

export function CienciaModal({ produto, onClose }) {
  const [motivo, setMotivo] = useState('estoque_parado');
  const [observacao, setObservacao] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  if (!produto) return null;

  async function salvar() {
    setError(''); setSaving(true);
    try {
      await api.post(`/agente/margem/produtos/${produto.id}/ciencia`, {
        motivo, observacao, data_fim_ciencia: dataFim,
      });
      onClose();
    } catch (e) {
      setError(e.response?.data?.error?.formErrors?.join(', ') || e.message);
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-xl max-w-lg w-full" onClick={e => e.stopPropagation()}>
        <div className="p-5 border-b border-slate-200">
          <h2 className="font-semibold">{produto.codigo_produto} — {produto.descricao_produto}</h2>
          <p className="text-xs text-slate-500 mt-1">{produto.secao}</p>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-sm font-medium text-slate-700">Motivo</label>
            <select value={motivo} onChange={e => setMotivo(e.target.value)}
              className="mt-1 w-full border border-slate-300 rounded-md p-2 text-sm">
              {MOTIVOS.map(m => <option key={m.v} value={m.v}>{m.l}</option>)}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">Observação</label>
            <textarea value={observacao} onChange={e => setObservacao(e.target.value)} rows={3}
              className="mt-1 w-full border border-slate-300 rounded-md p-2 text-sm" />
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">Data fim do preço vigente</label>
            <input type="date" value={dataFim} onChange={e => setDataFim(e.target.value)}
              min={new Date().toISOString().slice(0, 10)}
              className="mt-1 w-full border border-slate-300 rounded-md p-2 text-sm" />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="p-5 border-t border-slate-200 flex justify-end gap-2">
          <button onClick={onClose} className="text-slate-600 px-4 py-2 text-sm">Cancelar</button>
          <button onClick={salvar} disabled={saving || !observacao || !dataFim}
            className="bg-emerald-600 text-white px-4 py-2 rounded-md text-sm disabled:opacity-60">
            {saving ? 'Salvando...' : 'Confirmar ciência'}
          </button>
        </div>
      </div>
    </div>
  );
}
