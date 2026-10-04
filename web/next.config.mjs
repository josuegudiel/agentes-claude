import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Permite import desde fuera de web/ (ej: ../src/agents/predictive/runtime).
    externalDir: true,
  },
  // Evitamos bundlear Node-only deps (pino, etc.) en el client.
  serverExternalPackages: ['pino', 'pino-pretty'],
  // El scanner ahora vive en la raiz; /scanner queda como redirect para
  // que los links compartidos antes del cambio sigan funcionando.
  async redirects() {
    return [
      {
        source: '/scanner',
        destination: '/',
        permanent: true,
      },
    ];
  },
  // Cabeceras de seguridad para toda la app. El scanner es 100%
  // client-side y NO hace ninguna llamada de red externa: por eso la CSP
  // puede ser muy cerrada. Lo mas valioso aqui:
  //   - connect-src 'self': aunque un atacante lograra ejecutar script,
  //     NO podria exfiltrar los documentos escaneados a ningun host
  //     externo (fetch/XHR/WebSocket/beacon bloqueados fuera del origen).
  //   - frame-ancestors 'none': nadie puede embeber la app en un iframe
  //     para clickjackear la camara o el boton de captura.
  // script-src incluye 'unsafe-inline' porque las paginas son estaticas
  // (sin SSR por request no hay nonce posible) y Next inyecta un bootstrap
  // inline; el riesgo es aceptable porque la app no tiene NINGUN vector de
  // inyeccion de HTML (sin dangerouslySetInnerHTML, React escapa todo, sin
  // backend que refleje input).
  // 'wasm-unsafe-eval' SOLO habilita compilar WebAssembly (no eval de JS):
  // lo necesita pdf.js para leer PDFs de fotocopiadora (JBIG2/JPEG2000)
  // al usar "Añadir PDF".
  async headers() {
    // En `next dev` webpack/React necesitan eval y el HMR usa websockets;
    // en produccion la politica queda cerrada.
    const isDev = process.env.NODE_ENV !== 'production';
    const csp = [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ''}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self'",
      `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
      "media-src 'self' blob:",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
      ...(isDev ? [] : ['upgrade-insecure-requests']),
    ].join('; ');

    return [
      // El service worker se revisa en cada visita (las versiones nuevas
      // se instalan enseguida).
      {
        source: '/sw.js',
        headers: [{ key: 'Cache-Control', value: 'no-cache, max-age=0' }],
      },
      // pdf.js va en una carpeta con su version: nunca cambia.
      {
        source: '/pdfjs/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: csp },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'no-referrer' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          // Solo la propia app puede usar la camara; todo lo demas negado.
          {
            key: 'Permissions-Policy',
            value:
              'camera=(self), microphone=(), geolocation=(), payment=(), usb=(), accelerometer=(), gyroscope=(), magnetometer=(), interest-cohort=()',
          },
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
          { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
          { key: 'X-DNS-Prefetch-Control', value: 'off' },
        ],
      },
    ];
  },
  // El codigo en ../src usa la convencion ESM Node de imports con extension
  // ".js" apuntando a archivos ".ts" hermanos. Mapeamos esto para Webpack y
  // Turbopack para que la resolucion funcione igual en ambos bundlers.
  webpack: (config, { isServer }) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
    };
    if (!isServer) {
      // Next y pdf.js vienen compilados para Safari 16.4+ ("static {}"):
      // en iOS 15.4-16.3 la app no arrancaba. Ver scripts/downlevel.cjs.
      config.module.rules.push({
        test: /\.(c|m)?js$/,
        include: [/[\\/]node_modules[\\/].*next[\\/]dist[\\/]/, /[\\/]node_modules[\\/].*pdfjs-dist[\\/]/],
        enforce: 'post',
        use: [{ loader: fileURLToPath(new URL('./scripts/downlevel.cjs', import.meta.url)) }],
      });
    }
    return config;
  },
  turbopack: {
    resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.json'],
    resolveAlias: {
      // Turbopack respeta la query "?extensionAlias" pero la mas confiable
      // es no usarlo y dejar que la lista de extensions matchee. Para los
      // pocos imports cross-package, usamos paths sin extension.
    },
  },
};

export default nextConfig;
