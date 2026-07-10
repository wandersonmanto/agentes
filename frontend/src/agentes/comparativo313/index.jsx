import { Link, NavLink, Outlet } from 'react-router-dom';
import { ChevronLeft } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useMe } from '../../hooks/useMe';

const PAPEL_LABEL = {
  comprador:  { texto: 'Comprador',  cls: 'bg-sky-100 text-sky-800' },
  gerente:    { texto: 'Gerente',    cls: 'bg-teal-100 text-teal-800' },
  diretor:    { texto: 'Diretor',    cls: 'bg-purple-100 text-purple-800' },
  supervisor: { texto: 'Supervisor', cls: 'bg-amber-100 text-amber-800' },
  admin:      { texto: 'Admin',      cls: 'bg-slate-200 text-slate-800' },
};

export function Comparativo313Layout() {
  const { user } = useAuth();
  const { me } = useMe();
  const papelInfo = me && PAPEL_LABEL[me.papel];
  const podeVerAgregado = me && ['diretor', 'admin', 'supervisor', 'gerente'].includes(me.papel);

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-slate-500 hover:text-slate-900"><ChevronLeft size={20} /></Link>
            <div>
              <h1 className="text-lg font-semibold text-slate-900">Comparativo 313</h1>
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
          {podeVerAgregado && (
            <nav className="flex gap-2 text-sm">
              <NavLink
                to="/agente/comparativo313"
                end
                className={({ isActive }) =>
                  'px-3 py-1.5 rounded ' +
                  (isActive ? 'bg-orange-100 text-orange-800' : 'text-slate-600 hover:bg-slate-100')
                }
              >
                Lista
              </NavLink>
              <NavLink
                to="/agente/comparativo313/agregado"
                className={({ isActive }) =>
                  'px-3 py-1.5 rounded ' +
                  (isActive ? 'bg-orange-100 text-orange-800' : 'text-slate-600 hover:bg-slate-100')
                }
              >
                Agregado por filial
              </NavLink>
            </nav>
          )}
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
