/**
 * Tipos compartidos cliente <-> servidor del agente scanner.
 *
 * Estos viven en `web/components/scanner/` (y no en `src/agents/scanner/`)
 * a proposito: el cliente NO debe importar codigo del agente — eso traeria
 * dependencias de Node (pino, ai-sdk, etc.) al bundle del browser. El
 * runtime serializa por JSON, asi que tener una copia ligera de los tipos
 * aqui es mas barato que configurar resolves cross-package.
 */

export type DocumentType =
  | 'id_card'
  | 'passport'
  | 'drivers_license'
  | 'invoice'
  | 'receipt'
  | 'business_card'
  | 'contract'
  | 'letter'
  | 'form'
  | 'whiteboard'
  | 'book_page'
  | 'handwritten_note'
  | 'photo'
  | 'other';

export interface ScanIdentifyResult {
  documentType: DocumentType;
  confidence: number;
  language: string | null;
  title: string | null;
  summary: string;
  suggestedFilename: string;
}
