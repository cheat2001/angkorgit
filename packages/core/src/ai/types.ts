
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
  | 'cli'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'ollama'
  | 'lmstudio';

export type CliAgentId = 'claude' | 'codex' | 'gemini' | 'opencode';

export interface CliAgentInfo {
  id: CliAgentId;
  label: string;
  path: string;
  version: string;
}

export interface CliRunRequest {
  program: string;
  args: string[];
  stdin: string;
  timeoutSecs?: number;
}

export interface CliRunResult {
  status: number;
  stdout: string;
  stderr: string;
  output?: string | null;
}

export type CliRunner = (request: CliRunRequest) => Promise<CliRunResult>;

export interface AiConfig {
  provider: AiProviderKind;
  apiKey: string;
  model: string;
  baseUrl?: string;
  cliAgent?: CliAgentId;
  cliPath?: string;
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
