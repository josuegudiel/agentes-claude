/**
 * Prepara los archivos estaticos que se generan al compilar:
 *
 *   1. public/pdfjs/<version>/: lo que pdf.js carga en tiempo de ejecucion
 *      (worker, decodificadores wasm y fuentes estandar). La carpeta lleva
 *      la version: el worker DEBE coincidir con la libreria, y asi una
 *      pestana abierta antes de una actualizacion sigue pidiendo SU version
 *      (y se puede cachear para siempre). Solo se descargan cuando alguien
 *      toca "Añadir PDF".
 *   2. public/sw.js: el service worker (app disponible sin conexion), con la
 *      version de este build incrustada.
 *
 * Se corre antes de `next dev` / `next build`.
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const pkg = dirname(require.resolve('pdfjs-dist/package.json'));
const { version } = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
const root = join(here, '..', 'public', 'pdfjs');
const out = join(root, version);

rmSync(root, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// El worker se baja a la sintaxis del proyecto (iOS 15.4+), igual que el
// resto del codigo de pdf.js (ver scripts/downlevel.cjs).
const { downlevel } = require('./downlevel.cjs');
const workerSrc = join(pkg, 'legacy', 'build', 'pdf.worker.min.mjs');
const worker = readFileSync(workerSrc, 'utf8');
writeFileSync(join(out, 'pdf.worker.min.mjs'), (await downlevel(worker, workerSrc)) ?? worker);
cpSync(join(pkg, 'LICENSE'), join(out, 'LICENSE'));
// JBIG2 / JPEG2000 (tipicos de fotocopiadoras) + gestion de color; los
// *_nowasm_fallback.js cubren navegadores sin WebAssembly. quickjs (scripts
// dentro del PDF) no se usa.
cpSync(join(pkg, 'wasm'), join(out, 'wasm'), { recursive: true, filter: (src) => !/quickjs/.test(src) });
// Fuentes para PDFs que usan Helvetica/Times/... sin incrustarlas, y mapas
// de caracteres (CMaps) para PDFs con fuentes no incrustadas de otros
// alfabetos: sin ellos ese texto desaparecia al importar.
cpSync(join(pkg, 'standard_fonts'), join(out, 'standard_fonts'), { recursive: true });
cpSync(join(pkg, 'cmaps'), join(out, 'cmaps'), { recursive: true });
console.log(`pdf.js ${version} -> ${out}`);

// Service worker con la version del build.
const build = process.env.VERCEL_GIT_COMMIT_SHA || Date.now().toString(36);
const sw = readFileSync(join(here, 'sw.template.js'), 'utf8').replaceAll('__BUILD__', build);
writeFileSync(join(here, '..', 'public', 'sw.js'), sw);
console.log(`sw.js build ${build}`);
