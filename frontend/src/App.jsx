import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { Login } from './pages/Login';
import { Dashboard } from './pages/Dashboard';
import { MargemLayout } from './agentes/margem/index.jsx';
import { ListaProdutos } from './agentes/margem/ListaProdutos';
import { DashboardDiretor } from './agentes/margem/DashboardDiretor';
import { MetasLayout } from './agentes/metas/index.jsx';
import { Lista as MetasLista } from './agentes/metas/Lista';
import { Comparativo313Layout } from './agentes/comparativo313/index.jsx';
import { Lista as Comparativo313Lista } from './agentes/comparativo313/Lista';
import { DashboardAgregado as Comparativo313Agregado } from './agentes/comparativo313/DashboardAgregado';
import { SupervisorEstoqueLayout } from './agentes/supervisor_estoque/index.jsx';
import { Alertas as SupestAlertas } from './agentes/supervisor_estoque/Alertas';
import { Produtos as SupestProdutos } from './agentes/supervisor_estoque/Produtos';
import { DashboardAgregado as SupestAgregado } from './agentes/supervisor_estoque/DashboardAgregado';
import { Dimensoes as SupestDimensoes } from './agentes/supervisor_estoque/Dimensoes';
import { Validade as SupestValidade } from './agentes/supervisor_estoque/Validade';
import { VendasLayout } from './agentes/vendas/index.jsx';
import { Painel as VendasPainel } from './agentes/vendas/Painel';
import { Comparativo as VendasComparativo } from './agentes/vendas/Comparativo';
import { Tendencia as VendasTendencia } from './agentes/vendas/Tendencia';

export default function App() {
  const { user, loading } = useAuth();

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-slate-500">Carregando...</div>;
  }

  if (!user) {
    return <Login />;
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/agente/margem" element={<MargemLayout />}>
          <Route index element={<ListaProdutos />} />
          <Route path="diretor" element={<DashboardDiretor />} />
        </Route>
        <Route path="/agente/metas" element={<MetasLayout />}>
          <Route index element={<MetasLista />} />
        </Route>
        <Route path="/agente/comparativo313" element={<Comparativo313Layout />}>
          <Route index element={<Comparativo313Lista />} />
          <Route path="agregado" element={<Comparativo313Agregado />} />
        </Route>
        <Route path="/agente/supervisor_estoque" element={<SupervisorEstoqueLayout />}>
          <Route index element={
            <SupestAlertas
              tituloFixo="Variação de venda"
              metricasFixas={['media_dia', 'dias_venda', 'giro']}
            />
          } />
          <Route path="obsolescencia" element={
            <SupestAlertas
              tituloFixo="Obsolescência"
              metricasFixas={['obsolescencia']}
            />
          } />
          <Route path="rupturas" element={
            <SupestAlertas
              tituloFixo="Rupturas confirmadas"
              metricasFixas={['ruptura_confirmada']}
            />
          } />
          <Route path="produtos"  element={<SupestProdutos />} />
          <Route path="agregado"  element={<SupestAgregado />} />
          <Route path="dimensoes" element={<SupestDimensoes />} />
          <Route path="validade"  element={<SupestValidade />} />
        </Route>
        <Route path="/agente/vendas" element={<VendasLayout />}>
          <Route index element={<VendasPainel />} />
          <Route path="comparativo" element={<VendasComparativo />} />
          <Route path="tendencia" element={<VendasTendencia />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
