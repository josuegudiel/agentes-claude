#!/usr/bin/env tsx
/**
 * CLI: auditoria GEO/SEO en lote para prospeccion de negocios locales.
 *
 * Uso:
 *   pnpm audit:geo -- --input negocios.json --out reports/
 *   pnpm audit:geo -- --input negocios.csv --format md --skip-presence --no-llm
 *
 * Formato de entrada:
 *   - JSON: [{ "name": "Taller Lopez", "city": "Quetzaltenango", "url": "tallerlopez.gt" }, ...]
 *   - CSV con encabezado: name,city,url
 *
 * Por cada negocio escribe <slug>.md y/o <slug>.json en --out y al final
 * imprime una tabla resumen. Un negocio fallido no detiene el lote.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { logger } from '../src/core/logger.js';
import { makeChatClient } from '../src/agents/predictive/chat-client-factory.js';
import {
  AuditRequestSchema,
  renderReportMarkdown,
  runGeoAudit,
  type AuditReport,
} from '../src/agents/geo-auditor/index.js';

const BusinessSchema = z.object({
  name: z.string().min(2),
  city: z.string().min(2),
  url: z.string().min(4),
});
type Business = z.infer<typeof BusinessSchema>;

interface ParsedArgs {
  input: string;
  out: string;
  format: 'md' | 'json' | 'both';
  skipPresence: boolean;
  noLlm: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = {
    input: '',
    out: 'reports',
    format: 'both',
    skipPresence: false,
    noLlm: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--input') {
      const next = argv[++i];
      if (!next) throw new Error('--input requiere ruta a .json o .csv');
      out.input = next;
    } else if (a === '--out') {
      const next = argv[++i];
      if (!next) throw new Error('--out requiere un directorio');
      out.out = next;
    } else if (a === '--format') {
      const next = argv[++i];
      if (next !== 'md' && next !== 'json' && next !== 'both') {
        throw new Error(`--format invalido: ${next} (usa md|json|both)`);
      }
      out.format = next;
    } else if (a === '--skip-presence') {
      out.skipPresence = true;
    } else if (a === '--no-llm') {
      out.noLlm = true;
    } else if (a !== undefined && a !== '--') {
      // pnpm reenvia el separador "--" literal; lo ignoramos.
      throw new Error(`Argumento desconocido: ${a}`);
    }
  }

  if (!out.input) throw new Error('--input es obligatorio');
  return out;
}

export function parseBusinessesFile(path: string): Business[] {
  const raw = readFileSync(path, 'utf8').trim();
  if (!raw) throw new Error(`${path}: archivo vacio`);

  let rows: unknown[];
  if (raw.startsWith('[')) {
    const json = JSON.parse(raw) as unknown;
    if (!Array.isArray(json)) throw new Error(`${path}: el JSON no es un array`);
    rows = json;
  } else {
    rows = parseCsv(raw);
  }
  return rows.map((row, idx) => {
    const parsed = BusinessSchema.safeParse(row);
    if (!parsed.success) {
      throw new Error(`${path}: fila ${idx + 1} invalida (se esperan name, city, url)`);
    }
    return parsed.data;
  });
}

/**
 * Parser CSV que respeta comillas y "" escapadas (RFC 4180 simplificado).
 * split(',') no sirve: rompe con valores como "Taller, S.A.".
 */
export function parseCsvRows(raw: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (inQuotes) {
      if (ch === '"') {
        if (raw[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      // Cierra la fila en \n; ignora \r (soporta CRLF y CR).
      if (ch === '\r' && raw[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((c) => c.trim().length > 0)) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  // Comilla sin cerrar: el archivo esta mal formado; fallar claro en vez de
  // absorber el resto del CSV en un solo campo.
  if (inQuotes) {
    throw new Error('CSV mal formado: hay una comilla sin cerrar');
  }
  // Última fila sin salto final.
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((c) => c.trim().length > 0)) rows.push(row);
  }
  return rows;
}

function parseCsv(raw: string): Array<Record<string, string>> {
  const rows = parseCsvRows(raw);
  if (rows.length === 0) throw new Error('CSV vacio');
  const header = (rows[0] ?? []).map((h) => h.trim().toLowerCase());
  for (const required of ['name', 'city', 'url']) {
    if (!header.includes(required)) {
      throw new Error(`CSV sin columna "${required}" (encabezado: ${header.join(',')})`);
    }
  }
  return rows.slice(1).map((cells) => {
    const row: Record<string, string> = {};
    header.forEach((key, i) => {
      row[key] = (cells[i] ?? '').trim();
    });
    return row;
  });
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/** Garantiza un slug unico anexando -2, -3... para no sobrescribir reportes. */
export function uniqueSlug(base: string, used: Set<string>): string {
  let slug = base;
  let n = 2;
  while (used.has(slug)) {
    slug = `${base}-${n++}`;
  }
  used.add(slug);
  return slug;
}

async function main(): Promise<void> {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Error en argumentos: ${(err as Error).message}`);
    printUsage();
    process.exit(2);
  }

  const businesses = parseBusinessesFile(args.input);
  mkdirSync(args.out, { recursive: true });
  console.log(`Auditando ${businesses.length} negocio(s) -> ${args.out}/\n`);

  const chat = args.noLlm ? null : makeChatClient();
  const summary: Array<{ name: string; score: string; status: string; file: string }> = [];
  const csvRows: Array<Record<string, string>> = [];
  const usedSlugs = new Set<string>();

  // Secuencial a proposito: cuida las cuotas gratuitas de Groq y Tavily.
  for (const business of businesses) {
    const slug = uniqueSlug(slugify(business.name) || 'negocio', usedSlugs);
    process.stdout.write(`→ ${business.name} (${business.url}) ... `);
    try {
      const request = AuditRequestSchema.parse({
        url: business.url,
        businessName: business.name,
        city: business.city,
        skipPresence: args.skipPresence,
      });
      const report = await runGeoAudit(request, { chat });
      const files = writeReports(args, slug, report);
      console.log(`OK (global ${report.scores.overall}/100)`);
      summary.push({
        name: business.name,
        score: `${report.scores.overall}/100`,
        status: 'ok',
        file: files.join(', '),
      });
      csvRows.push(csvRow(business, report));
    } catch (err) {
      console.log(`FALLO: ${(err as Error).message}`);
      summary.push({ name: business.name, score: '-', status: 'fallo', file: '-' });
      csvRows.push({
        nombre: business.name,
        ciudad: business.city,
        url: business.url,
        estado: 'fallo',
        global: '',
        seo: '',
        geo: '',
        presencia: '',
        criticos: '',
        problema_principal: (err as Error).message,
      });
    }
  }

  // CSV de prospeccion: una fila por negocio, listo para hoja de calculo.
  const csvPath = join(args.out, '_resumen.csv');
  writeFileSync(csvPath, toCsv(csvRows), 'utf8');

  console.log('\n=== Resumen del lote ===');
  for (const row of summary) {
    console.log(
      `${row.status === 'ok' ? '✅' : '❌'} ${row.name.padEnd(32)} ${row.score.padEnd(8)} ${row.file}`,
    );
  }
  console.log(`\nCSV de prospeccion: ${csvPath}`);
  const failed = summary.filter((r) => r.status !== 'ok').length;
  if (failed > 0) {
    console.log(`${failed} negocio(s) fallaron; el resto se audito normalmente.`);
  }
}

function csvRow(business: Business, report: AuditReport): Record<string, string> {
  const criticos = report.findings.filter((f) => f.severity === 'critical');
  return {
    nombre: business.name,
    ciudad: business.city,
    url: report.meta.finalUrl,
    estado: 'ok',
    global: String(report.scores.overall),
    seo: String(report.scores.onpage),
    geo: String(report.scores.geo),
    presencia: report.scores.presence === null ? 'no medida' : String(report.scores.presence),
    criticos: String(criticos.length),
    problema_principal: report.findings[0]?.title ?? '',
  };
}

export function toCsv(rows: Array<Record<string, string>>): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0] ?? {});
  const escape = (raw: string): string => {
    // Anti CSV-injection: un valor que empieza con = + - @ (o tab/CR) se
    // interpreta como formula/DDE al abrir en Excel/Sheets. Se neutraliza
    // prefijando una comilla simple.
    const value = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    // Entrecomillar si contiene comilla, coma o cualquier salto de linea.
    return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
  };
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h] ?? '')).join(','));
  }
  return lines.join('\n') + '\n';
}

function writeReports(args: ParsedArgs, slug: string, report: AuditReport): string[] {
  const files: string[] = [];
  if (args.format === 'md' || args.format === 'both') {
    const path = join(args.out, `${slug}.md`);
    writeFileSync(path, renderReportMarkdown(report), 'utf8');
    files.push(path);
  }
  if (args.format === 'json' || args.format === 'both') {
    const path = join(args.out, `${slug}.json`);
    writeFileSync(path, JSON.stringify(report, null, 2), 'utf8');
    files.push(path);
  }
  return files;
}

function printUsage(): void {
  console.error(
    [
      'Uso:',
      '  pnpm audit:geo -- --input negocios.json [opciones]',
      '',
      'Opciones:',
      '  --input ruta.json|.csv  Lista de negocios (name, city, url) [obligatorio]',
      '  --out dir               Directorio de salida (default: reports/)',
      '  --format md|json|both   Formato de reporte (default: both)',
      '  --skip-presence         No buscar presencia online (no usa Tavily)',
      '  --no-llm                Sin resumen ejecutivo (no usa Groq/Ollama)',
      '',
      'Ejemplo:',
      '  pnpm audit:geo -- --input negocios.csv --out reports/ --format md',
    ].join('\n'),
  );
}

// Solo ejecuta el CLI cuando se corre directamente (no al importarlo en tests).
// pathToFileURL maneja rutas con espacios/caracteres no-ASCII (percent-encoding)
// que una interpolacion `file://${path}` no encodearia igual que import.meta.url.
const invokedDirectly =
  typeof process.argv[1] === 'string' &&
  import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((err) => {
    logger.error({ err: (err as Error).message }, 'Auditoria en lote fallo');
    console.error(`\nError: ${(err as Error).message}\n`);
    process.exit(1);
  });
}
