/**
 * Visão agregada — para diretor, supervisor e gerente.
 * Mostra a contagem de alertas pendentes por filial (e por comprador
 * para diretor/admin/supervisor).
 */
import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { useMe } from '../../hooks/useMe';

export function DashboardAgregado() {
  const { me } = useMe();
  const [resumo, setResumo]     = useState([]);
  const [porResp, setPorResp]   = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState('');

  useEffect(() => {
    if (!me) return;
    setLoading(true);
    const podeResponsavel = ['diretor', 'admin', 'supervisor'].includes(me.papel);
    const promises = [
      api.get('/agente/supervisor_estoque/resumo-filial').then(r => setResumo(r.data)),
    ];
    if (podeResponsavel) {
      promises.push(
        api.get('/agente/supervisor_estoque/resumo-responsavel').then(r => setPorResp(r.data))
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
  function fmtData(s) {
    if (!s) return '—';
    return new Date(s + 'T00:00:00').toLocaleDateString('pt-BR');
  }

  if (error)   return <p className="text-red-600">{error}</p>;
  if (loading) return <p className="text-slate-500">Carregando...</p>;

  const totais = resumo.reduce((acc, r) => {
    acc.pendentes  += Number(r.alertas_pendentes  || 0);
    acc.media_dia  += Number(r.alertas_media_dia  || 0);
    acc.dias_venda += Number(r.alertas_dias_venda || 0);
    acc.giro       += Number(r.alertas_giro       || 0);
    acc.queda      += Number(r.alertas_queda      || 0);
    acc.aumento    += Number(r.alertas_aumento    || 0);
    acc.produtos   += Number(r.produtos_afetados  || 0);
    acc.secoes     += Number(r.secoes_afetadas    || 0);
    return acc;
  }, { pendentes: 0, media_dia: 0, dias_venda: 0, giro: 0, queda: 0, aumento: 0, produtos: 0, secoes: 0 });

  return (
    <div className="space-y-8">
      {/* Cards de totais */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card label="Alertas pendentes"     value={totais.pendentes}  tone="rose" />
        <Card label="Produtos afetados"     value={totais.produtos}   tone="slate" />
        <Card label="Seções afetadas"       value={totais.secoes}     tone="slate" />
        <Card label="Filiais"               value={resumo.length}     tone="slate" />
        <Card label="Quedas"                value={totais.queda}      tone="orange" />
        <Card label="Aumentos"              value={totais.aumento}    tone="sky" />
        <Card label="Alertas em média/dia"  value={totais.media_dia}  tone="slate" />
        <Card label="Alertas em giro"       value={totais.giro}       tone="slate" />
      </section>

      {/* Tabela por filial */}
      <section>
        <h2 className="font-semibold mb-3">Resumo por filial</h2>
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left p-3">Filial</th>
                <th className="text-right p-3">Pendentes</th>
                <th className="text-right p-3">Média/dia</th>
                <th className="text-right p-3">Dias venda</th>
                <th className="text-right p-3">Giro</th>
                <th className="text-right p-3">Quedas</th>
                <th className="text-right p-3">Aumentos</th>
                <th className="text-right p-3">Produtos</th>
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
                  <td className="p-3 text-right text-rose-700 font-semibold">{fmtNum(r.alertas_pendentes)}</td>
                  <td className="p-3 text-right">{fmtNum(r.alertas_media_dia)}</td>
                  <td className="p-3 text-right">{fmtNum(r.alertas_dias_venda)}</td>
                  <td className="p-3 text-right">{fmtNum(r.alertas_giro)}</td>
                  <td className="p-3 text-right text-orange-700">{fmtNum(r.alertas_queda)}</td>
                  <td className="p-3 text-right text-sky-700">{fmtNum(r.alertas_aumento)}</td>
                  <td className="p-3 text-right">{fmtNum(r.produtos_afetados)}</td>
                  <td className="p-3 text-xs text-slate-500">{fmtData(r.ultima_deteccao_data)}</td>
                </tr>
              ))}
              {resumo.length === 0 && (
                <tr><td colSpan={9} className="p-8 text-center text-slate-500">Sem dados ainda.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Tabela por responsável */}
      {porResp && (
        <section>
          <h2 className="font-semibold mb-3">Resumo por comprador</h2>
          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  <th className="text-left p-3">Responsável</th>
                  <th className="text-right p-3">Pendentes</th>
                  <th className="text-right p-3">Filiais</th>
                  <th className="text-right p-3">Produtos</th>
                  <th className="text-right p-3">Seções</th>
                  <th className="text-right p-3">Média/dia</th>
                  <th className="text-right p-3">Dias venda</th>
                  <th className="text-right p-3">Giro</th>
                </tr>
              </thead>
              <tbody>
                {porResp.map(c => (
                  <tr key={c.usuario_id} className="border-t border-slate-100">
                    <td className="p-3 font-medium">{c.usuario_nome}</td>
                    <td className="p-3 text-right text-rose-700 font-semibold">{fmtNum(c.alertas_pendentes)}</td>
                    <td className="p-3 text-right">{fmtNum(c.filiais_afetadas)}</td>
                    <td className="p-3 text-right">{fmtNum(c.produtos_afetados)}</td>
                    <td className="p-3 text-right">{fmtNum(c.secoes_afetadas)}</td>
                    <td className="p-3 text-right">{fmtNum(c.alertas_media_dia)}</td>
                    <td className="p-3 text-right">{fmtNum(c.alertas_dias_venda)}</td>
                    <td className="p-3 text-right">{fmtNum(c.alertas_giro)}</td>
                  </tr>
                ))}
                {porResp.length === 0 && (
                  <tr><td colSpan={8} className="p-8 text-center text-slate-500">Sem responsáveis com alerta aberto.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function Card({ label, value, tone }) {
  // classes literais p/ Tailwind JIT detectar
  const cls = {
    rose:   { border: 'border-rose-200',   bg: 'bg-rose-50',   txt: 'text-rose-700',   val: 'text-rose-900' },
    orange: { border: 'border-orange-200', bg: 'bg-orange-50', txt: 'text-orange-700', val: 'text-orange-900' },
    sky:    { border: 'border-sky-200',    bg: 'bg-sky-50',    txt: 'text-sky-700',    val: 'text-sky-900' },
    slate:  { border: 'border-slate-200',  bg: 'bg-white',     txt: 'text-slate-600',  val: 'text-slate-900' },
  }[tone] || { border: 'border-slate-200', bg: 'bg-white', txt: 'text-slate-600', val: 'text-slate-900' };

  return (
    <div className={`rounded-lg border ${cls.border} ${cls.bg} p-4`}>
      <p className={`text-xs font-medium ${cls.txt}`}>{label}</p>
      <p className={`mt-1 text-2xl font-bold ${cls.val}`}>
        {Number(value || 0).toLocaleString('pt-BR')}
      </p>
    </div>
  );
}
