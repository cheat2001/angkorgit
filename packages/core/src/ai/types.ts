
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
