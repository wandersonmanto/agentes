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

export function SupervisorEstoqueLayout() {
  const { user } = useAuth();
  const { me } = useMe();
  const papelInfo = me && PAPEL_LABEL[me.papel];
  const podeVerAgregado = me && ['diretor', 'admin', 'supervisor', 'gerente'].includes(me.papel);
  const podeVerDimensoes = me && ['diretor', 'admin', 'supervisor'].includes(me.papel);

  // classes literais para o Tailwind JIT detectar
  const tabCls = ({ isActive }) =>
    'px-3 py-1.5 rounded ' +
    (isActive ? 'bg-rose-100 text-rose-800' : 'text-slate-600 hover:bg-slate-100');

  return (
    <div className="min-h-screen">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-slate-500 hover:text-slate-900"><ChevronLeft size={20} /></Link>
            <div>
              <h1 className="text-lg font-semibold text-slate-900">Supervisor de Estoque</h1>
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
          <nav className="flex gap-2 text-sm flex-wrap">
            <NavLink to="/agente/supervisor_estoque" end className={tabCls}>
              Variação
            </NavLink>
            <NavLink to="/agente/supervisor_estoque/obsolescencia" className={tabCls}>
              Obsolescência
            </NavLink>
            <NavLink to="/agente/supervisor_estoque/rupturas" className={tabCls}>
              Rupturas
            </NavLink>
            <NavLink to="/agente/supervisor_estoque/produtos" className={tabCls}>
              Produtos
            </NavLink>
            {podeVerAgregado && (
              <NavLink to="/agente/supervisor_estoque/agregado" className={tabCls}>
                Agregado
              </NavLink>
            )}
            {podeVerDimensoes && (
              <NavLink to="/agente/supervisor_estoque/dimensoes" className={tabCls}>
                Dimensões
              </NavLink>
            )}
            {podeVerDimensoes && (
              <NavLink to="/agente/supervisor_estoque/validade" className={tabCls}>
                Validade
              </NavLink>
            )}
          </nav>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
