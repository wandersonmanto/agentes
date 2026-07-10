import esbuild from 'esbuild';
import { readFileSync } from 'fs';

const files = [
  'src/agentes/comparativo313/index.jsx',
  'src/agentes/comparativo313/Lista.jsx',
  'src/agentes/comparativo313/DashboardAgregado.jsx',
  'src/App.jsx',
];

let ok = true;
for (const f of files) {
  const code = readFileSync(f, 'utf-8');
  try {
    await esbuild.transform(code, { loader: 'jsx', target: 'es2020' });
    console.log('OK:', f);
  } catch (e) {
    ok = false;
    console.log('FAIL:', f);
    console.log(e.errors?.map(x => `  ${x.location?.file ?? f}:${x.location?.line}:${x.location?.column}  ${x.text}`).join('\n') ?? e.message);
  }
}
process.exit(ok ? 0 : 1);
