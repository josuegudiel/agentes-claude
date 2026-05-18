import { z } from 'zod';

/**
 * Tipos de documento que el agente puede clasificar. El conjunto es
 * deliberadamente acotado — preferimos "otro" antes que alucinar una
 * categoria que el caller no espera.
 */
export const DOCUMENT_TYPES = [
  'id_card',
  'passport',
  'drivers_license',
  'invoice',
  'receipt',
  'business_card',
  'contract',
  'letter',
  'form',
  'whiteboard',
  'book_page',
  'handwritten_note',
  'photo',
  'other',
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const ScanIdentifySchema = z.object({
  documentType: z.enum(DOCUMENT_TYPES),
  confidence: z.number().min(0).max(1),
  language: z.string().min(2).max(8).nullable(),
  title: z.string().max(120).nullable(),
  summary: z.string().max(400),
  suggestedFilename: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-zA-Z0-9_-]+$/, 'solo a-zA-Z0-9_-'),
});

export type ScanIdentifyResult = z.infer<typeof ScanIdentifySchema>;

export const ScanIdentifyInputSchema = z.object({
  /** Imagen codificada en base64 (sin el prefijo `data:`). */
  imageBase64: z.string().min(32),
  /** MIME type real de la imagen. Solo aceptamos los que soporta Claude vision. */
  mimeType: z.enum(['image/jpeg', 'image/png', 'image/gif', 'image/webp']),
  /** Hint opcional del caller para sesgar la clasificacion. */
  hint: z.string().max(200).optional(),
});

export type ScanIdentifyInput = z.infer<typeof ScanIdentifyInputSchema>;
