/**
 * Politica "default" de Trusted Types (la CSP de produccion exige Trusted
 * Types en Chrome/Edge: `require-trusted-types-for 'script'`).
 *
 * Con Trusted Types el navegador BLOQUEA cualquier asignacion de texto a
 * los "sinks" peligrosos (innerHTML, eval, script.src, new Worker(url)...)
 * salvo que pase por una politica permitida. Si algun dia apareciera un
 * fallo de inyeccion, el codigo inyectado no podria escribir HTML ni cargar
 * scripts. Esta politica solo deja pasar URLs de scripts del MISMO origen
 * (el worker de pdf.js y el service worker); HTML y scripts en texto no
 * tienen permiso (createHTML/createScript no existen -> se rechazan).
 *
 * Next registra las suyas ("nextjs", "nextjs#bundler") para cargar sus
 * propios chunks. En Safari/Firefox sin Trusted Types esto no hace nada.
 */
type TrustedTypesLike = {
  createPolicy: (name: string, rules: { createScriptURL: (url: string) => string }) => unknown;
  defaultPolicy?: unknown;
};

function install(): void {
  if (typeof window === 'undefined') return;
  const tt = (window as unknown as { trustedTypes?: TrustedTypesLike }).trustedTypes;
  if (!tt || tt.defaultPolicy) return;
  try {
    tt.createPolicy('default', {
      createScriptURL: (url: string) => {
        const u = new URL(url, window.location.href);
        if (u.origin !== window.location.origin) throw new TypeError(`Script de otro origen bloqueado: ${u.origin}`);
        return u.href;
      },
    });
  } catch {
    /* ya existia (HMR) o la CSP no la permite */
  }
}

install();
