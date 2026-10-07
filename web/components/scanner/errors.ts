/**
 * Error con un codigo de mensaje traducible (ver i18n.tsx): los modulos que
 * no son componentes (pipeline, pdf-import...) no conocen el idioma; la
 * interfaz traduce `code` al mostrarlo.
 */
export class AppError extends Error {
  override name = 'AppError';
  constructor(
    readonly code: string,
    readonly vars: Record<string, string | number> = {},
  ) {
    super(code);
  }
}
