// Copia la librería oficial de Supabase (versión fijada en package.json) al repositorio
// y actualiza su huella de integridad (SRI) en index.html.
// Se sirve desde el propio sitio: sin CDN de terceros que pueda ser comprometido.
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const src = 'node_modules/@supabase/supabase-js/dist/umd/supabase.js';
const dst = 'js/vendor/supabase.js';
copyFileSync(src, dst);

const codigo = readFileSync(dst, 'utf8');
if (/\beval\(|new Function\(/.test(codigo)) throw new Error('La librería usa eval: incompatible con la CSP');

const version = JSON.parse(readFileSync('node_modules/@supabase/supabase-js/package.json', 'utf8')).version;
const sri = 'sha384-' + createHash('sha384').update(readFileSync(dst)).digest('base64');
writeFileSync('js/vendor/VERSION.txt', `@supabase/supabase-js ${version}\n${sri}\n`);

const idx = readFileSync('index.html', 'utf8').replace(
  /<script src="js\/vendor\/supabase\.js"[^>]*><\/script>/,
  `<script src="js/vendor/supabase.js" integrity="${sri}"></script>`);
writeFileSync('index.html', idx);
console.log(`supabase-js ${version} copiado · ${sri}`);
