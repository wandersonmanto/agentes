import { useEffect, useState } from 'react';
import { LogOut } from 'lucide-react';
import { api } from '../lib/api';
import { useAuth } from '../hooks/useAuth';
import { AgentCard } from '../components/AgentCard';
import { AgentInfoModal } from '../components/AgentInfoModal';

export function Dashboard() {
  const { user, logout } = useAuth();
  const [agentes, setAgentes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [info, setInfo] = useState(null);

  useEffect(() => {
    api.get('/api/agentes')
      .then(r => setAgentes(r.data))
      .catch(err => console.error(err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold text-slate-900">Plataforma de Agentes</h1>
            <p className="text-xs text-slate-500">Olá, {user?.displayName || user?.email}</p>
          </div>
          <button onClick={logout} className="inline-flex items-center gap-2 text-slate-600 hover:text-slate-900 text-sm">
            <LogOut size={16} /> Sair
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {loading && <p className="text-slate-500">Carregando agentes...</p>}
        {!loading && agentes.length === 0 && <p className="text-slate-500">Nenhum agente configurado.</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {agentes.map(a => (
            <AgentCard key={a.id} agente={a} onInfo={setInfo} />
          ))}
        </div>
      </main>

      <AgentInfoModal agente={info} onClose={() => setInfo(null)} />
    </div>
  );
}
