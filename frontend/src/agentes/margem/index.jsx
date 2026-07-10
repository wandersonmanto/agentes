import { Link, NavLink, Outlet } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useMe } from '../../hooks/useMe';

const PAPEL_LABEL = {
  comprador:  { texto: 'Comprador',  cls: 'bg-sky-100 text-sky-800' },
  diretor:    { texto: 'Diretor',    cls: 'bg-purple-100 text-purple-800' },
  supervisor: { texto: 'Supervisor', cls: 'bg-amber-100 text-amber-800' },
  admin:      { texto: 'Admin',      cls: 'bg-slate-200 text-slate-800' },
};

export function MargemLayout() {
  const { user } = useAuth();
  const { me } = useMe();
  const podeVerAgregado = me && ['diretor', 'admin', 'supervisor'].includes(me.papel);
  const papelInfo = me && PAPEL_LABEL[me.papel];

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-slate-500 hover:text-slate-900"><ChevronLeft size={20} /></Link>
            <div>
              <h1 className="text-lg font-semibold text-slate-900">Margem Negativa</h1>
              <p className="text-xs text-slate-500 flex items-center gap-2">
                <span>Olá, {me?.nome || user?.displayName || user?.email}</span>
                {papelInfo && (
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${papelInfo.cls}`}>
                    {papelInfo.texto}
                  </span>
                )}
              </p>
            </div>
          </div>
          <nav className="flex gap-1 text-sm">
            <Tab to="">Lista</Tab>
            {podeVerAgregado && <Tab to="diretor">Agregado</Tab>}
          </nav>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}

function Tab({ to, children }) {
  return (
    <NavLink end to={to}
      className={({ isActive }) =>
        'px-3 py-1.5 rounded-md ' + (isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100')
      }>{children}</NavLink>
  );
}
