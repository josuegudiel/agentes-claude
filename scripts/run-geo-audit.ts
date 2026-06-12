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

function parseCsv(raw: string): Array<Record<string, string>> {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const header = (lines[0] ?? '').split(',').map((h) => h.trim().toLowerCase());
  for (const required of ['name', 'city', 'url']) {
    if (!header.includes(required)) {
      throw new Error(`CSV sin columna "${required}" (encabezado: ${header.join(',')})`);
    }
  }
  return lines.slice(1).map((line) => {
    const cells = line.split(',').map((c) => c.trim());
    const row: Record<string, string> = {};
    header.forEach((key, i) => {
      row[key] = cells[i] ?? '';
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

  // Secuencial a proposito: cuida las cuotas gratuitas de Groq y Tavily.
  for (const business of businesses) {
    const slug = slugify(business.name) || 'negocio';
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
    } catch (err) {
      console.log(`FALLO: ${(err as Error).message}`);
      summary.push({ name: business.name, score: '-', status: 'fallo', file: '-' });
    }
  }

  console.log('\n=== Resumen del lote ===');
  for (const row of summary) {
    console.log(
      `${row.status === 'ok' ? '✅' : '❌'} ${row.name.padEnd(32)} ${row.score.padEnd(8)} ${row.file}`,
    );
  }
  const failed = summary.filter((r) => r.status !== 'ok').length;
  if (failed > 0) {
    console.log(`\n${failed} negocio(s) fallaron; el resto se audito normalmente.`);
  }
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

main().catch((err) => {
  logger.error({ err: (err as Error).message }, 'Auditoria en lote fallo');
  console.error(`\nError: ${(err as Error).message}\n`);
  process.exit(1);
});
