/**
 * Baja la sintaxis de codigo YA compilado (Next y pdf.js) al objetivo del
 * proyecto (browserslist de package.json, iOS 15.4+).
 *
 * Por que: Next 16 y pdf.js 6 se publican compilados para Safari 16.4+ y
 * traen "class static blocks" (`static { ... }`). En iOS 15.x / 16.0-16.3
 * eso es un SyntaxError al parsear el chunk: React nunca hidrata y la app
 * queda muerta sin ningun mensaje. La sintaxis no se puede "polyfillear",
 * hay que transpilarla. Next NO recompila su propio dist con el
 * browserslist del proyecto, asi que lo hacemos aqui con el SWC que ya
 * trae Next (sin dependencias nuevas).
 *
 * Solo se toca un archivo si contiene un static block: el resto pasa tal cual.
 */
const path = require('node:path');

const TARGETS = require(path.join(__dirname, '..', 'package.json')).browserslist;
const STATIC_BLOCK = /\bstatic\s*\{/;

let swcPromise = null;
function swc() {
  swcPromise ??= (async () => {
    const mod = require('next/dist/build/swc');
    await mod.loadBindings();
    return mod;
  })();
  return swcPromise;
}

/** Transforma `code` (CJS o ESM) si tiene static blocks. */
async function downlevel(code, filename) {
  if (!STATIC_BLOCK.test(code)) return null;
  const { transform } = await swc();
  const out = await transform(code, {
    filename,
    sourceMaps: false,
    isModule: 'unknown',
    minify: false,
    env: { targets: TARGETS },
    jsc: {
      parser: { syntax: 'ecmascript' },
      // Sin imports de @swc/helpers: el codigo vive fuera de nuestro grafo.
      externalHelpers: false,
      loose: false,
    },
  });
  return out.code;
}

/** Loader de webpack (ver next.config.mjs). */
module.exports = function downlevelLoader(source) {
  const done = this.async();
  downlevel(String(source), this.resourcePath)
    .then((code) => done(null, code ?? source))
    .catch((err) => {
      // Si una version futura de Next cambia su API interna de SWC, no
      // romper el deploy: avisar y dejar el archivo como esta (solo se
      // pierde la compatibilidad con iOS 15.4-16.3).
      this.emitWarning(new Error(`downlevel: no se pudo transformar ${this.resourcePath}: ${err && err.message}`));
      done(null, source);
    });
};
module.exports.downlevel = downlevel;
module.exports.STATIC_BLOCK = STATIC_BLOCK;
