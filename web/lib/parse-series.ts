/**
 * Parsea texto libre como serie de numeros. Acepta:
 *   - "1, 2, 3, 4"
 *   - "1\n2\n3\n4"
 *   - "1; 2; 3"
 *   - mezcla con espacios y saltos
 *   - JSON array: "[1, 2, 3, 4]"
 *
 * Devuelve la serie + un mensaje de error si no es valida.
 */

const MIN_LENGTH = 8;

export interface ParseResult {
  ok: boolean;
  series: number[];
  error?: string;
}

export function parseSeries(input: string): ParseResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, series: [], error: 'La serie esta vacia.' };
  }

  // Intento JSON array primero (caso comun: pegado desde notebook).
  if (trimmed.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) {
        return { ok: false, series: [], error: 'JSON valido pero no es un array.' };
      }
      return validate(parsed);
    } catch {
      return { ok: false, series: [], error: 'Empieza con "[" pero no es JSON valido.' };
    }
  }

  // Tokens separados por coma, punto y coma, salto de linea o espacio.
  const tokens = trimmed.split(/[\s,;]+/).filter((t) => t.length > 0);
  const numbers: unknown[] = tokens.map((t) => {
    const n = Number(t);
    return Number.isFinite(n) ? n : t;
  });
  return validate(numbers);
}

function validate(values: unknown[]): ParseResult {
  if (values.length < MIN_LENGTH) {
    return {
      ok: false,
      series: [],
      error: `La serie tiene ${values.length} valores. TimesFM necesita al menos ${MIN_LENGTH}.`,
    };
  }
  const out: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (typeof v !== 'number' || !Number.isFinite(v)) {
      return {
        ok: false,
        series: [],
        error: `Valor invalido en la posicion ${i}: "${String(v)}". Solo numeros.`,
      };
    }
    out.push(v);
  }
  return { ok: true, series: out };
}
