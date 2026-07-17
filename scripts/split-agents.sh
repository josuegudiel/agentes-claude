#!/usr/bin/env bash
# Ensambla los agentes estacionados (predictivo, auditor) como proyectos
# Next.js AUTOCONTENIDOS bajo _split/, listos para su propio repo/deploy.
# No toca nada del scanner. Idempotente: borra y reconstruye _split/.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
rm -rf _split
mkdir -p _split

# --- helpers ---------------------------------------------------------------
# Reescribe imports "de scaffolding" (app/components/lib -> src) al alias @/.
# Los imports internos de agents/ y core/ quedan intactos (resuelven solos).
rewrite() {
  local f="$1"
  # ../../../../src/agents/X  y  ../../src/agents/X  ->  @/agents/X
  sed -i -E "s#(['\"])(\.\./)+src/agents/#\1@/agents/#g" "$f"
  # ../../core/X.js  ->  @/core/X.js
  sed -i -E "s#(['\"])(\.\./)+core/#\1@/core/#g" "$f"
  # ../../components/X  ->  @/components/X
  sed -i -E "s#(['\"])(\.\./)+components/#\1@/components/#g" "$f"
  # ../../../lib/X  ->  @/lib/X
  sed -i -E "s#(['\"])(\.\./)+lib/#\1@/lib/#g" "$f"
}
rewrite_dir() { find "$1" -type f \( -name '*.ts' -o -name '*.tsx' \) -print0 | while IFS= read -r -d '' f; do rewrite "$f"; done; }

common_configs() {
  local dir="$1" ; local title="$2"
  cat > "$dir/next.config.mjs" <<'EOF'
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
EOF
  cat > "$dir/tsconfig.json" <<'EOF'
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": false,
    "skipLibCheck": true,
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
EOF
  cat > "$dir/tailwind.config.ts" <<'EOF'
import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
export default config;
EOF
  cat > "$dir/postcss.config.mjs" <<'EOF'
export default { plugins: { tailwindcss: {}, autoprefixer: {} } };
EOF
  cat > "$dir/vercel.json" <<'EOF'
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": "nextjs"
}
EOF
  cat > "$dir/.gitignore" <<'EOF'
node_modules
.next
.env
.env.local
*.tsbuildinfo
EOF
  cat > "$dir/app/globals.css" <<'EOF'
@tailwind base;
@tailwind components;
@tailwind utilities;
EOF
}

minimal_layout() {
  local dir="$1" ; local title="$2" ; local desc="$3"
  cat > "$dir/app/layout.tsx" <<EOF
import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '${title}',
  description: '${desc}',
};

export default function RootLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
EOF
}

# ===========================================================================
# 1) PREDICTIVO
# ===========================================================================
P="_split/predictive"
mkdir -p "$P/app/api/predict" "$P/app/api/health" "$P/components" "$P/lib" "$P/core" "$P/agents"
cp -r src/agents/predictive "$P/agents/predictive"
rm -rf "$P/agents/predictive/__tests__"
cp src/core/{logger,errors,retry}.ts "$P/core/"
cp web/app/_predictive/page.tsx "$P/app/page.tsx"
cp web/app/_api/predict/route.ts "$P/app/api/predict/route.ts"
cp web/app/_api/health/route.ts "$P/app/api/health/route.ts"
cp web/components/{AgentSteps,ForecastChart,HealthBadges,PredictForm}.tsx "$P/components/"
cp web/lib/{types,parse-series,rate-limit}.ts "$P/lib/"
rewrite_dir "$P/app"; rewrite_dir "$P/components"; rewrite_dir "$P/lib"
common_configs "$P" "Agente predictivo"
minimal_layout "$P" "Agente predictivo — TimesFM + LLM" "Forecast de series con TimesFM e interpretacion con un LLM open source."
cat > "$P/package.json" <<'EOF'
{
  "name": "predictive-agent",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --webpack --port 3000",
    "build": "next build --webpack",
    "start": "next start --port 3000",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "next": "^16.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "recharts": "^3.0.0",
    "zod": "^3.23.8",
    "pino": "^9.5.0",
    "pino-pretty": "^11.3.0"
  },
  "devDependencies": {
    "@types/node": "^22.9.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.5.10",
    "tailwindcss": "^3.4.16",
    "typescript": "^5.6.3"
  }
}
EOF
cat > "$P/.env.example" <<'EOF'
# LLM (Groq cloud o Ollama local). Si hay GROQ_API_KEY usa Groq.
GROQ_API_KEY=
GROQ_MODEL=llama-3.1-8b-instant
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b
# Sidecar Python con TimesFM (ver predictive-service/ en el repo original,
# desplegable a Hugging Face Spaces — instrucciones en DEPLOY.md original).
PREDICTIVE_SERVICE_URL=http://localhost:8765
NODE_ENV=production
EOF

# ===========================================================================
# 2) AUDITOR (reutiliza el chat-client del predictivo)
# ===========================================================================
A="_split/auditor"
mkdir -p "$A/app/api/auditor" "$A/components/auditor" "$A/lib" "$A/core" "$A/agents"
cp -r src/agents/geo-auditor "$A/agents/geo-auditor"
rm -rf "$A/agents/geo-auditor/__tests__"
# El engine del auditor importa ../predictive/{chat-client,factory,groq,ollama}
mkdir -p "$A/agents/predictive"
cp src/agents/predictive/{chat-client.ts,chat-client-factory.ts,groq-client.ts,ollama-client.ts} "$A/agents/predictive/"
cp src/core/{logger,errors,retry}.ts "$A/core/"
cp web/app/_auditor/page.tsx "$A/app/page.tsx"
cp web/app/_api/auditor/route.ts "$A/app/api/auditor/route.ts"
cp -r web/components/auditor/. "$A/components/auditor/"
cp web/lib/{auditor-history,auditor-types,sales-summary,rate-limit}.ts "$A/lib/"
# El export del auditor tomaba downloadBlob del scanner: lo hacemos local.
cat > "$A/lib/download.ts" <<'DLEOF'
/** Descarga un Blob como archivo (mismo helper que usaba el scanner). */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
DLEOF
sed -i "s#from '\.\./scanner/export'#from '@/lib/download'#g" "$A/components/auditor/export.ts"
rewrite_dir "$A/app"; rewrite_dir "$A/components"; rewrite_dir "$A/lib"
common_configs "$A" "Auditor GEO/SEO"
minimal_layout "$A" "Auditor GEO/SEO" "Audita la visibilidad de un negocio en Google y motores de IA."
cat > "$A/package.json" <<'EOF'
{
  "name": "geo-auditor-agent",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev --webpack --port 3001",
    "build": "next build --webpack",
    "start": "next start --port 3001",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "next": "^16.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "zod": "^3.23.8",
    "node-html-parser": "^7.1.0",
    "jspdf": "^4.2.1",
    "pino": "^9.5.0",
    "pino-pretty": "^11.3.0"
  },
  "devDependencies": {
    "@types/node": "^22.9.0",
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "autoprefixer": "^10.4.20",
    "postcss": "^8.5.10",
    "tailwindcss": "^3.4.16",
    "typescript": "^5.6.3"
  }
}
EOF
cat > "$A/.env.example" <<'EOF'
# LLM que redacta el resumen (Groq). Sin clave, el reporte numerico sale igual.
GROQ_API_KEY=
GROQ_MODEL=llama-3.1-8b-instant
# Tavily para la busqueda de presencia online (opcional).
TAVILY_API_KEY=
NODE_ENV=production
EOF

echo "OK: _split/predictive y _split/auditor generados."
