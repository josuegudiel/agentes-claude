import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests del runtime del scanner. Mockeamos `ai.generateText` para no tocar
 * la API de Anthropic. El objetivo es validar:
 *
 *   - Que se parsea JSON valido del modelo.
 *   - Que se tolera el JSON envuelto en ```json fences.
 *   - Que se rechaza output que no cumple el schema.
 *   - Que el zod schema de input filtra MIME types invalidos.
 */

const generateTextMock = vi.fn();

vi.mock('ai', () => ({
  generateText: (...args: unknown[]) =>
    generateTextMock(...(args as Parameters<typeof generateTextMock>)),
}));

vi.mock('@ai-sdk/anthropic', () => ({
  anthropic: (model: string) => ({ provider: 'anthropic', model }),
}));

const VALID_PAYLOAD = {
  documentType: 'invoice',
  confidence: 0.92,
  language: 'es',
  title: 'Factura mensual',
  summary: 'Factura de servicios de luz, periodo abril.',
  suggestedFilename: 'factura_servicios_abril',
};

beforeEach(() => {
  generateTextMock.mockReset();
  process.env['ANTHROPIC_API_KEY'] = 'test-key';
});

const TINY_IMAGE = 'a'.repeat(40);

describe('runScannerAgent', () => {
  it('parsea JSON plano devuelto por el modelo', async () => {
    generateTextMock.mockResolvedValueOnce({
      text: JSON.stringify(VALID_PAYLOAD),
    });

    const { runScannerAgent } = await import('../runtime.js');
    const out = await runScannerAgent({
      imageBase64: TINY_IMAGE,
      mimeType: 'image/jpeg',
    });

    expect(out.classification.documentType).toBe('invoice');
    expect(out.classification.suggestedFilename).toBe('factura_servicios_abril');
    expect(out.model).toMatch(/claude/i);
    expect(out.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('tolera JSON envuelto en fences markdown', async () => {
    generateTextMock.mockResolvedValueOnce({
      text: '```json\n' + JSON.stringify(VALID_PAYLOAD) + '\n```',
    });
    const { runScannerAgent } = await import('../runtime.js');
    const out = await runScannerAgent({
      imageBase64: TINY_IMAGE,
      mimeType: 'image/png',
    });
    expect(out.classification.documentType).toBe('invoice');
  });

  it('rechaza output que no cumple el schema', async () => {
    generateTextMock.mockResolvedValueOnce({
      text: JSON.stringify({ ...VALID_PAYLOAD, documentType: 'invented_type' }),
    });
    const { runScannerAgent } = await import('../runtime.js');
    await expect(
      runScannerAgent({ imageBase64: TINY_IMAGE, mimeType: 'image/jpeg' }),
    ).rejects.toThrow();
  });

  it('rechaza output que no es JSON', async () => {
    generateTextMock.mockResolvedValueOnce({
      text: 'No puedo procesar esta imagen, lo siento.',
    });
    const { runScannerAgent } = await import('../runtime.js');
    await expect(
      runScannerAgent({ imageBase64: TINY_IMAGE, mimeType: 'image/jpeg' }),
    ).rejects.toThrow(/JSON/);
  });

  it('rechaza suggestedFilename con caracteres invalidos', async () => {
    generateTextMock.mockResolvedValueOnce({
      text: JSON.stringify({
        ...VALID_PAYLOAD,
        suggestedFilename: 'name with spaces',
      }),
    });
    const { runScannerAgent } = await import('../runtime.js');
    await expect(
      runScannerAgent({ imageBase64: TINY_IMAGE, mimeType: 'image/jpeg' }),
    ).rejects.toThrow();
  });

  it('falla si no hay ANTHROPIC_API_KEY', async () => {
    delete process.env['ANTHROPIC_API_KEY'];
    const { runScannerAgent } = await import('../runtime.js');
    await expect(
      runScannerAgent({ imageBase64: TINY_IMAGE, mimeType: 'image/jpeg' }),
    ).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe('ScanIdentifyInputSchema', () => {
  it('rechaza MIME types no soportados por Claude vision', async () => {
    const { ScanIdentifyInputSchema } = await import('../schema.js');
    const result = ScanIdentifyInputSchema.safeParse({
      imageBase64: TINY_IMAGE,
      mimeType: 'image/tiff',
    });
    expect(result.success).toBe(false);
  });

  it('acepta los 4 MIME types soportados', async () => {
    const { ScanIdentifyInputSchema } = await import('../schema.js');
    for (const mt of ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) {
      const r = ScanIdentifyInputSchema.safeParse({
        imageBase64: TINY_IMAGE,
        mimeType: mt,
      });
      expect(r.success).toBe(true);
    }
  });
});
