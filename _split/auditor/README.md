# Auditor GEO/SEO

Proyecto Next.js **autocontenido**, extraido del monorepo del scanner.
Audita la visibilidad de un negocio: SEO tecnico, preparacion para motores
de IA y presencia online.

## Rutas
- `/` — UI del auditor.
- `POST /api/auditor` — stream SSE del reporte.

## Convertirlo en su propio repo
```bash
cd _split/auditor
git init && git add -A && git commit -m "init: auditor GEO/SEO"
git branch -M main
git remote add origin git@github.com:<tu-usuario>/geo-auditor.git
git push -u origin main
```

## Desplegar en Vercel
1. Importa el repo nuevo en Vercel (Next.js auto-detectado).
2. Environment Variables (ver `.env.example`): `GROQ_API_KEY` (LLM del
   resumen, opcional) y `TAVILY_API_KEY` (busqueda de presencia, opcional).
3. Deploy.

## Seguridad (IMPORTANTE antes de publicarlo)
- El auditor hace fetch a URLs que le pasa el cliente. El fetcher ya trae
  proteccion anti-SSRF endurecida (valida host + IP resuelta en cada
  redirect), pero revisa `agents/geo-auditor/site-fetcher.ts` antes de
  exponerlo.
- `POST /api/auditor` consume cuota de Groq/Tavily y no tiene auth ni
  rate-limit efectivo en serverless. Agrega rate-limiting real o auth.
