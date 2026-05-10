#!/usr/bin/env tsx
/**
 * CLI: corre el agente predictivo (TimesFM + Ollama) con un objetivo
 * en lenguaje natural y, opcionalmente, una serie historica.
 *
 * Uso:
 *   pnpm agent:predict -- "Predice las proximas 24 horas de ventas" --series-file ventas.json
 *   pnpm agent:predict -- "Tendencia para Q4" --series 10,12,11,13,14,16,15,18,20
 *
 * Si pasas serie por CLI, el agente la inyecta en el prompt antes de razonar.
 */
import { readFileSync } from 'node:fs';
import { runPredictiveAgent } from '../src/agents/predictive/index.js';
import { logger } from '../src/core/logger.js';

interface ParsedArgs {
  goal: string;
  series: number[] | null;
  horizon: number | null;
  frequency: 0 | 1 | 2 | null;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { goal: '', series: null, horizon: null, frequency: null };
  const goalParts: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--series') {
      const next = argv[++i];
      if (!next) throw new Error('--series requiere valor (CSV de numeros)');
      out.series = next.split(',').map((x) => Number(x.trim()));
    } else if (a === '--series-file') {
      const next = argv[++i];
      if (!next) throw new Error('--series-file requiere ruta');
      out.series = parseSeriesFile(next);
    } else if (a === '--horizon') {
      const next = argv[++i];
      if (!next) throw new Error('--horizon requiere numero');
      out.horizon = Number(next);
    } else if (a === '--frequency') {
      const next = argv[++i];
      if (!next) throw new Error('--frequency requiere 0|1|2');
      const n = Number(next);
      if (n !== 0 && n !== 1 && n !== 2) {
        throw new Error(`--frequency invalido: ${next} (usa 0|1|2)`);
      }
      out.frequency = n;
    } else if (a !== undefined) {
      goalParts.push(a);
    }
  }

  out.goal = goalParts.join(' ').trim();
  if (out.series && out.series.some((x) => !Number.isFinite(x))) {
    throw new Error('serie contiene valores no numericos');
  }
  return out;
}

function parseSeriesFile(path: string): number[] {
  const raw = readFileSync(path, 'utf8').trim();
  // Acepta JSON array o CSV en una linea o newline-separated.
  if (raw.startsWith('[')) {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) throw new Error(`${path}: el JSON no es un array`);
    return arr.map((x) => Number(x));
  }
  return raw
    .split(/[\s,]+/)
    .filter((s) => s.length > 0)
    .map((s) => Number(s));
}

function buildGoal(args: ParsedArgs): string {
  if (!args.series) return args.goal;
  const parts = [args.goal];
  parts.push(`\nSerie historica (${args.series.length} puntos): ${args.series.join(', ')}`);
  if (args.horizon !== null) parts.push(`Horizonte solicitado: ${args.horizon} puntos.`);
  if (args.frequency !== null) parts.push(`Frecuencia: ${args.frequency}.`);
  return parts.join('\n');
}

async function main(): Promise<void> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Error en argumentos: ${(err as Error).message}`);
    printUsage();
    process.exit(2);
  }

  if (!parsed.goal) {
    printUsage();
    process.exit(2);
  }

  const goal = buildGoal(parsed);
  const result = await runPredictiveAgent({ goal });

  logger.info(
    {
      steps: result.steps,
      toolCalls: result.toolCalls.length,
      model: result.model,
    },
    'Agente predictivo termino',
  );

  console.log('\n=== Respuesta del agente ===\n' + result.text + '\n');
  if (result.lastSummary) {
    console.log('=== Resumen del forecast ===');
    console.log(JSON.stringify(result.lastSummary, null, 2));
  }
}

function printUsage(): void {
  console.error(
    [
      'Uso:',
      '  pnpm agent:predict -- "<objetivo>" [opciones]',
      '',
      'Opciones:',
      '  --series      a,b,c,...      Serie historica como CSV',
      '  --series-file ruta.json|.csv Lee la serie de un archivo',
      '  --horizon     N              Cuantos puntos predecir (1-512)',
      '  --frequency   0|1|2          0=alta (horaria), 1=media (mensual), 2=baja',
      '',
      'Ejemplos:',
      '  pnpm agent:predict -- "Predice los proximos 12 meses" \\',
      '    --series-file ventas.json --horizon 12 --frequency 1',
    ].join('\n'),
  );
}

main().catch((err) => {
  logger.error({ err: (err as Error).message }, 'Agente predictivo fallo');
  console.error(`\nError: ${(err as Error).message}\n`);
  process.exit(1);
});
