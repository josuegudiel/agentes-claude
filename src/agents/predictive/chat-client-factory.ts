import { GroqClient } from './groq-client.js';
import { OllamaClient } from './ollama-client.js';
import type { ChatClient } from './chat-client.js';

/**
 * Elige el chat client segun el entorno:
 *   - Si GROQ_API_KEY esta seteada -> GroqClient (cloud, gratis con limite)
 *   - Si no                         -> OllamaClient (local, requiere `ollama serve`)
 *
 * Para forzar uno especifico, pasalo explicito a `runPredictiveAgent`.
 */
export function makeChatClient(): ChatClient {
  if (process.env['GROQ_API_KEY']) {
    return new GroqClient();
  }
  return new OllamaClient();
}

export function chatClientProvider(): 'groq' | 'ollama' {
  return process.env['GROQ_API_KEY'] ? 'groq' : 'ollama';
}
