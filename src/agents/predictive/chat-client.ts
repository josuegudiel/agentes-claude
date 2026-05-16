import type {
  OllamaChatOptions,
  OllamaChatResponse,
  OllamaToolDefinition,
} from './ollama-client.js';

/**
 * Interface comun entre OllamaClient (local) y GroqClient (cloud).
 *
 * Mantengo los nombres `Ollama*` por compatibilidad — el shape es el mismo
 * porque Groq expone una API OpenAI-compatible que normalizo al equivalente
 * de Ollama dentro del GroqClient.
 *
 * Asi runtime.ts y los tools no se enteran de cual cliente esta detras.
 */
export interface ChatClient {
  readonly modelName: string;

  /**
   * Devuelve null si todo OK; mensaje legible si el servicio no esta listo.
   * En Ollama valida que el modelo este descargado; en Groq valida que la
   * API key sea valida.
   */
  preflight(): Promise<string | null>;

  chat(opts: OllamaChatOptions): Promise<OllamaChatResponse>;

  generate(prompt: string, opts?: { format?: 'json'; temperature?: number }): Promise<string>;
}

export type { OllamaChatOptions, OllamaChatResponse, OllamaToolDefinition };
