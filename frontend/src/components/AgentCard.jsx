import { Info, TrendingDown, AlertTriangle, CheckCircle2, Clock, PauseCircle } from 'lucide-react';
import { Link } from 'react-router-dom';

const STATUS_VISUAL = {
  ok:       { Icon: CheckCircle2,   label: 'OK',        cls: 'text-emerald-600 bg-emerald-50' },
  atencao:  { Icon: AlertTriangle,  label: 'Atenção',   cls: 'text-amber-700  bg-amber-50' },
  erro:     { Icon: AlertTriangle,  label: 'Erro',      cls: 'text-red-700    bg-red-50' },
  rodando:  { Icon: Clock,          label: 'Rodando',   cls: 'text-sky-700    bg-sky-50' },
  inativo:  { Icon: PauseCircle,    label: 'Inativo',   cls: 'text-slate-500  bg-slate-100' },
};

function fmtDt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function AgentCard({ agente, onInfo }) {
  const visual = STATUS_VISUAL[agente.status_card] || STATUS_VISUAL.ok;
  const { Icon } = visual;

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm hover:shadow-md transition p-5 flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="rounded-lg p-2" style={{ background: agente.cor + '15', color: agente.cor }}>
            <TrendingDown size={22} />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">{agente.nome}</h3>
            <p className="text-xs text-slate-500 mt-0.5">{agente.descricao_curta}</p>
          </div>
        </div>
        <button
          onClick={() => onInfo(agente)}
          className="text-slate-400 hover:text-slate-700 p-1"
          title="Mais informações"
        >
          <Info size={18} />
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <div>
          <div className="text-slate-500 text-xs">Pendentes</div>
          <div className="font-semibold text-slate-900 text-lg">{agente.pendentes_total}</div>
        </div>
        <div>
          <div className="text-slate-500 text-xs">Última execução</div>
          <div className="font-medium text-slate-700">{fmtDt(agente.ultima_execucao_at)}</div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${visual.cls}`}>
          <Icon size={14} /> {visual.label}
        </span>
        <Link
          to={`/agente/${agente.slug}`}
          className="text-sm font-medium text-sky-700 hover:text-sky-900"
        >
          Abrir →
        </Link>
      </div>
    </div>
  );
}
