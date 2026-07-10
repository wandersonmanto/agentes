import { useEffect, useState } from 'react';
import { api } from '../../lib/api';

export function DashboardDiretor() {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/agente/margem/stats/diretor')
      .then(r => setStats(r.data))
      .catch(e => setError(e.response?.data?.error || e.message));
  }, []);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!stats) return <p className="text-slate-500">Carregando...</p>;

  return (
    <div className="space-y-6">
      <section>
        <h2 className="font-semibold mb-3">Resumo por responsável</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left p-3">Responsável</th>
                <th className="text-left p-3">Papel</th>
                <th className="text-right p-3">Pendentes</th>
                <th className="text-right p-3">Cientes</th>
                <th className="text-right p-3">Total</th>
                <th className="text-right p-3">Pior margem %</th>
              </tr>
            </thead>
            <tbody>
              {(stats.por_responsavel || []).map(c => (
                <tr key={c.usuario_id} className="border-t border-slate-100">
                  <td className="p-3 font-medium">{c.usuario_nome}</td>
                  <td className="p-3 text-xs text-slate-500 capitalize">{c.usuario_papel}</td>
                  <td className="p-3 text-right text-amber-700 font-semibold">{c.pendentes}</td>
                  <td className="p-3 text-right">{c.cientes}</td>
                  <td className="p-3 text-right">{c.total}</td>
                  <td className="p-3 text-right text-red-700">{Number(c.pior_margem).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {stats.secoes_problematicas?.length > 0 && (
        <section>
          <h2 className="font-semibold mb-3">Seções com problema de atribuição</h2>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <ul className="text-sm space-y-1">
              {stats.secoes_problematicas.map((s, i) => (
                <li key={i}>
                  <span className="font-mono">{s.chave_secao || '(sem seção)'}</span>
                  {' — '}
                  <span className="text-amber-800">{s.motivo_atribuicao}</span>
                  {' '}
                  <span className="text-slate-500">({s.total_produtos} produto(s))</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}
    </div>
  );
}
