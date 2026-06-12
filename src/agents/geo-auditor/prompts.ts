import type { CategoryScores, Finding } from './schema.js';

/**
 * Prompt one-shot del auditor GEO/SEO: el LLM NO calcula nada, solo redacta
 * un resumen ejecutivo de venta sobre los numeros y hallazgos deterministas.
 */

export function executiveSummaryPrompt(args: {
  businessName: string;
  city: string;
  scores: CategoryScores;
  topFindings: Finding[];
  presenceSkipped: boolean;
}): string {
  const findingsJson = args.topFindings.slice(0, 8).map((f) => ({
    severidad: f.severity,
    problema: f.title,
    evidencia: f.detail,
    solucion: f.recommendation,
  }));

  return `Eres consultor de visibilidad digital (SEO y GEO — aparicion en respuestas de IA como Google AI Overviews, ChatGPT y Perplexity). Acabas de auditar el sitio del negocio "${args.businessName}" en ${args.city}.

SCORES (0-100, calculados automaticamente, NO los recalcules):
- SEO tecnico: ${args.scores.onpage}
- Preparacion GEO (visibilidad en IA): ${args.scores.geo}
- Presencia online: ${args.presenceSkipped || args.scores.presence === null ? 'no medida en esta auditoria' : args.scores.presence}
- Global: ${args.scores.overall}

HALLAZGOS PRINCIPALES (JSON):
${JSON.stringify(findingsJson, null, 2)}

Redacta un resumen ejecutivo en espanol para el dueno del negocio (no tecnico), en 4-7 oraciones:
1. Una frase honesta sobre el estado general (usa el score global).
2. Que esta perdiendo el negocio HOY: los buscadores con IA ya responden por los negocios y, si el sitio no esta preparado, recomiendan a la competencia.
3. Los 2-3 problemas mas graves de la lista, en lenguaje simple y citando la evidencia.
4. Cierra con que todos los problemas detectados tienen solucion concreta y rapida.

REGLAS DURAS:
- NO inventes datos, cifras ni problemas que no esten en la lista.
- NO uses jerga tecnica sin explicarla en cinco palabras o menos.
- NO prometas resultados garantizados ni menciones competidores especificos.
- Tono: directo, profesional y cercano; nada de alarmismo exagerado.`;
}
