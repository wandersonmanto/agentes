/**
 * Visão "agregada por filial" — para diretor, supervisor e gerente.
 * Mostra a contagem de rupturas pendentes em cada filial do escopo.
 */
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useMe } from '../../hooks/useMe';

export function DashboardAgregado() {
  const { me } = useMe();
  const [resumo, setResumo] = useState([]);
  const [porResp, setPorResp] = useState(null);     // null = não carrega (não autorizado)
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!me) return;
    setLoading(true);

    const podeResponsavel = ['diretor', 'admin', 'supervisor'].includes(me.papel);

    const promises = [
      api.get('/agente/comparativo313/resumo-filial').then(r => setResumo(r.data)),
    ];
    if (podeResponsavel) {
      promises.push(
        api.get('/agente/comparativo313/resumo-responsavel').then(r => setPorResp(r.data))
      );
    }

    Promise.all(promises)
      .catch(e => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [me]);

  function fmtNum(v) {
    if (v == null) return '—';
    return Number(v).toLocaleString('pt-BR', { maximumFractionDigits: 0 });
  }

  if (error) return <p className="text-red-600">{error}</p>;
  if (loading) return <p className="text-slate-500">Carregando...</p>;

  const totais = resumo.reduce((acc, r) => {
    acc.rupturas     += Number(r.rupturas_pendentes || 0);
    acc.comEstoque   += Number(r.com_estoque_deposito || 0);
    acc.estoqueDep   += Number(r.estoque_total_deposito || 0);
    return acc;
  }, { rupturas: 0, comEstoque: 0, estoqueDep: 0 });

  return (
    <div className="space-y-8">
      {/* Cards de totais */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-4">
          <p className="text-xs text-orange-700 font-medium">Total de rupturas pendentes</p>
          <p className="mt-1 text-2xl font-bold text-orange-900">{fmtNum(totais.rupturas)}</p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-xs text-emerald-700 font-medium">Produtos com estoque no depósito 313</p>
          <p className="mt-1 text-2xl font-bold text-emerald-900">{fmtNum(totais.comEstoque)}</p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-600 font-medium">Estoque total no depósito (unidades)</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{fmtNum(totais.estoqueDep)}</p>
        </div>
      </section>

      {/* Tabela por filial */}
      <section>
        <h2 className="font-semibold mb-3">Resumo por filial</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left p-3">Filial</th>
                <th className="text-right p-3">Rupturas pendentes</th>
                <th className="text-right p-3">Com estoque no dep. 313</th>
                <th className="text-right p-3">Estoque (unid.)</th>
                <th className="text-left p-3">Última detecção</th>
              </tr>
            </thead>
            <tbody>
              {resumo.map(r => (
                <tr key={r.filial_cod} className="border-t border-slate-100">
                  <td className="p-3 font-medium">
                    <span className="font-mono text-xs text-slate-500 mr-2">{r.filial_cod}</span>
                    {r.filial_desc || ''}
                  </td>
                  <td className="p-3 text-right text-orange-700 font-semibold">{fmtNum(r.rupturas_pendentes)}</td>
                  <td className="p-3 text-right text-emerald-700">{fmtNum(r.com_estoque_deposito)}</td>
                  <td className="p-3 text-right">{fmtNum(r.estoque_total_deposito)}</td>
                  <td className="p-3 text-xs text-slate-500">
                    {r.ultima_deteccao
                      ? new Date(r.ultima_deteccao).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
                      : '—'}
                  </td>
                </tr>
              ))}
              {resumo.length === 0 && (
                <tr><td colSpan={5} className="p-8 text-center text-slate-500">Sem dados.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Tabela por responsável (só diretor/supervisor/admin) */}
      {porResp && (
        <section>
          <h2 className="font-semibold mb-3">Resumo por comprador</h2>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left p-3">Responsável</th>
                  <th className="text-left p-3">Papel</th>
                  <th className="text-right p-3">Rupturas</th>
                  <th className="text-right p-3">Filiais afetadas</th>
                  <th className="text-right p-3">Estoque dep. (unid.)</th>
                </tr>
              </thead>
              <tbody>
                {porResp.map(c => (
                  <tr key={c.usuario_id} className="border-t border-slate-100">
                    <td className="p-3 font-medium">{c.usuario_nome}</td>
                    <td className="p-3 text-xs text-slate-500 capitalize">{c.usuario_papel}</td>
                    <td className="p-3 text-right text-orange-700 font-semibold">{fmtNum(c.rupturas_pendentes)}</td>
                    <td className="p-3 text-right">{fmtNum(c.filiais_afetadas)}</td>
                    <td className="p-3 text-right">{fmtNum(c.estoque_total_deposito)}</td>
                  </tr>
                ))}
                {porResp.length === 0 && (
                  <tr><td colSpan={5} className="p-8 text-center text-slate-500">Sem responsáveis com ruptura aberta.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
