/**
 * Provider-agnostic AI module.
 *
 * Nothing in the app depends on a concrete vendor: features talk to
 * `AiProvider`, providers are created by the registry from `AiConfig`,
 * and HTTP goes through an injected transport (the desktop app injects a
 * Rust-backed client to avoid CORS and keep keys out of the webview fetch).
 */

export interface AiMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiCompletionRequest {
  messages: AiMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface AiCompletionResult {
  text: string;
  model: string;
  provider: string;
}

export interface AiProvider {
  readonly id: string;
  readonly label: string;
  complete(request: AiCompletionRequest): Promise<AiCompletionResult>;
  /** Cheap connectivity check used by the settings screen. */
  ping(): Promise<boolean>;
}

export interface HttpRequest {
  url: string;
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
}

export interface HttpResponse {
  status: number;
  body: string;
}

/** Injected transport — implemented over Rust in the app, fetch in tests. */
export type HttpClient = (request: HttpRequest) => Promise<HttpResponse>;

export type AiProviderKind =
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'ollama'
  | 'lmstudio';

export interface AiConfig {
  provider: AiProviderKind;
  apiKey: string;
  model: string;
  /** Override for self-hosted/local endpoints. */
  baseUrl?: string;
}

export class AiError extends Error {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'AiError';
  }
}
