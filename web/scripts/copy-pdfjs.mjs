/**
 * Copia a public/pdfjs/ los archivos que pdf.js carga en tiempo de
 * ejecucion (worker, decodificadores wasm y fuentes estandar). Se corre
 * antes de `next dev` / `next build`, asi la version servida siempre es
 * la misma que la instalada (el worker DEBE coincidir con la libreria).
 *
 * Solo se descargan cuando alguien toca "Añadir PDF": no pesan en la carga
 * normal del scanner.
 */
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pkg = dirname(require.resolve('pdfjs-dist/package.json'));
const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'pdfjs');

rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, 'wasm'), { recursive: true });

cpSync(join(pkg, 'legacy', 'build', 'pdf.worker.min.mjs'), join(out, 'pdf.worker.min.mjs'));
cpSync(join(pkg, 'LICENSE'), join(out, 'LICENSE'));
// JBIG2 / JPEG2000 (tipicos de fotocopiadoras) + gestion de color. Los
// *_nowasm_fallback.js cubren navegadores sin WebAssembly.
for (const f of [
  'jbig2.wasm',
  'jbig2_nowasm_fallback.js',
  'openjpeg.wasm',
  'openjpeg_nowasm_fallback.js',
  'qcms_bg.wasm',
  'LICENSE_JBIG2',
  'LICENSE_OPENJPEG',
  'LICENSE_QCMS',
]) {
  cpSync(join(pkg, 'wasm', f), join(out, 'wasm', f));
}
// Fuentes para PDFs que usan Helvetica/Times/... sin incrustarlas.
cpSync(join(pkg, 'standard_fonts'), join(out, 'standard_fonts'), { recursive: true });

console.log(`pdf.js -> ${out}`);
