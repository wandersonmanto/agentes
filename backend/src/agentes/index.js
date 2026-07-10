/**
 * Registry plug-and-play de agentes.
 * Cada agente exporta { slug, mountRoutes(app) }.
 * Para adicionar um novo agente: criar pasta `agentes/{slug}/` com um
 * `routes.js` e registrar aqui.
 */
import { margemRouter }            from './margem/routes.js';
import { metasRouter }             from './metas/routes.js';
import { comparativo313Router }    from './comparativo313/routes.js';
import { supervisorEstoqueRouter } from './supervisor_estoque/routes.js';
import { vendasRouter }            from './vendas/routes.js';

export const agentes = [
  { slug: 'margem',             router: margemRouter,            basePath: '/agente/margem'             },
  { slug: 'metas',              router: metasRouter,             basePath: '/agente/metas'              },
  { slug: 'comparativo313',     router: comparativo313Router,    basePath: '/agente/comparativo313'     },
  { slug: 'supervisor_estoque', router: supervisorEstoqueRouter, basePath: '/agente/supervisor_estoque' },
  { slug: 'vendas',             router: vendasRouter,            basePath: '/agente/vendas'             },
];
