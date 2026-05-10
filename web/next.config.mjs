/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    // Permite import desde fuera de web/ (ej: ../src/agents/predictive/runtime).
    externalDir: true,
  },
  // Evitamos bundlear Node-only deps (pino, etc.) en el client.
  serverExternalPackages: ['pino', 'pino-pretty'],
  // El codigo en ../src usa la convencion ESM Node de imports con extension
  // ".js" apuntando a archivos ".ts" hermanos. Mapeamos esto para Webpack y
  // Turbopack para que la resolucion funcione igual en ambos bundlers.
  webpack: (config) => {
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.jsx': ['.tsx', '.jsx'],
    };
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
