/**
 * Jerarquia de errores tipados. Sirve para que tests, flows y agentes
 * puedan distinguir "error de mi codigo" de "la app esta caida" o
 * "credenciales invalidas".
 */

export class AppError extends Error {
  override readonly name: string = 'AppError';
  readonly code: string;
  readonly context: Record<string, unknown>;

  constructor(message: string, opts: { code: string; context?: Record<string, unknown>; cause?: unknown } ) {
    super(message);
    this.code = opts.code;
    this.context = opts.context ?? {};
    if (opts.cause !== undefined) {
      (this as { cause?: unknown }).cause = opts.cause;
    }
  }
}

export class ConfigError extends AppError {
  override readonly name = 'ConfigError';
}

export class AuthError extends AppError {
  override readonly name = 'AuthError';
}

export class FlowError extends AppError {
  override readonly name = 'FlowError';
}

export class TimeoutError extends AppError {
  override readonly name = 'TimeoutError';
}

export class AgentToolError extends AppError {
  override readonly name = 'AgentToolError';
}
