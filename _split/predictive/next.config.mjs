/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['pino', 'pino-pretty'],
  // El codigo en agents/ usa imports ESM con extension ".js" apuntando a
  // archivos ".ts" hermanos; mapeamos para webpack.
  webpack: (config) => {
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'], '.jsx': ['.tsx', '.jsx'] };
    return config;
  },
  turbopack: { resolveExtensions: ['.tsx', '.ts', '.jsx', '.js', '.json'] },
};
export default nextConfig;
