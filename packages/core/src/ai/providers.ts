import {
  AiError,
  type AiCompletionRequest,
  type AiCompletionResult,
  type AiConfig,
  type AiProvider,
  type AiProviderKind,
  type CliRunner,
  type HttpClient,
} from './types';
import { cliAgentProvider } from './cliAgents';

async function postJson(
  http: HttpClient,
  url: string,
  headers: Record<string, string>,
  payload: unknown,
  provider: string,
): Promise<unknown> {
  const res = await http({
    url,
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(payload),
  });
  if (res.status < 200 || res.status >= 300) {
    throw new AiError(`${provider} request failed (${res.status}): ${res.body.slice(0, 300)}`, provider, res.status);
  }
  try {
    return JSON.parse(res.body);
  } catch {
    throw new AiError(`${provider} returned invalid JSON`, provider);
  }
}

type TokenParam = 'max_tokens' | 'max_completion_tokens';

interface ChatShape {
  tokenParam: TokenParam;
  temperature: boolean;
  minTokens: number;
}

export const REASONING_MIN_TOKENS = 8192;

const chatShapes = new Map<string, ChatShape>();

export function resetChatShapes(): void {
  chatShapes.clear();
}

function isOfficialOpenAi(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname === 'api.openai.com';
  } catch {
    return false;
  }
}

function rejectedParam(status: number, body: string): string | null {
  if (status !== 400 && status !== 422) return null;
  let param: unknown = null;
  let message = body;
  try {
    const parsed = JSON.parse(body) as { error?: { param?: unknown; message?: unknown } };
    param = parsed.error?.param;
    if (typeof parsed.error?.message === 'string') message = parsed.error.message;
  } catch {
    message = body;
  }
  if (typeof param === 'string' && ADJUSTABLE_PARAMS.test(param)) return param;
  if (!/unsupported|not supported|unrecognized|unknown|does not support/i.test(message)) return null;
  return FIRST_ADJUSTABLE_PARAM.exec(message)?.[1] ?? null;
}

const ADJUSTABLE_PARAMS = /^(max_completion_tokens|max_tokens|temperature)$/;
const FIRST_ADJUSTABLE_PARAM = /\b(max_completion_tokens|max_tokens|temperature)\b/;

function adapted(shape: ChatShape, param: string, swappedTokens: boolean): ChatShape | null {
  if (param === 'temperature' && shape.temperature) return { ...shape, temperature: false };
  if (param === shape.tokenParam && !swappedTokens) {
    return { ...shape, tokenParam: shape.tokenParam === 'max_tokens' ? 'max_completion_tokens' : 'max_tokens' };
  }
  return null;
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
  usage?: { completion_tokens_details?: { reasoning_tokens?: number } };
}

function openAiCompatible(
  id: AiProviderKind,
  label: string,
  http: HttpClient,
  config: AiConfig,
  defaultBaseUrl: string,
): AiProvider {
  const baseUrl = (config.baseUrl || defaultBaseUrl).replace(/\/$/, '');
  const shapeKey = `${baseUrl}|${config.model}`;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
  };
  const send = (request: AiCompletionRequest, shape: ChatShape) => {
    const budget = Math.max(request.maxTokens ?? 1024, shape.minTokens);
    return http({
      url: `${baseUrl}/chat/completions`,
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: config.model,
        messages: request.messages,
        [shape.tokenParam]: budget,
        ...(shape.temperature ? { temperature: request.temperature ?? 0.4 } : {}),
      }),
    });
  };
  return {
    id,
    label,
    async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
      let shape: ChatShape = chatShapes.get(shapeKey) ?? {
        tokenParam: isOfficialOpenAi(baseUrl) ? 'max_completion_tokens' : 'max_tokens',
        temperature: true,
        minTokens: 0,
      };
      let widened = false;
      let swappedTokens = false;
      for (;;) {
        const res = await send(request, shape);
        if (res.status < 200 || res.status >= 300) {
          const param = rejectedParam(res.status, res.body);
          const next: ChatShape | null = param ? adapted(shape, param, swappedTokens) : null;
          if (next) {
            swappedTokens ||= next.tokenParam !== shape.tokenParam;
            shape = next;
            continue;
          }
          throw new AiError(`${label} request failed (${res.status}): ${res.body.slice(0, 300)}`, label, res.status);
        }
        let data: ChatResponse;
        try {
          data = JSON.parse(res.body) as ChatResponse;
        } catch {
          throw new AiError(`${label} returned invalid JSON`, label);
        }
        const choice = data.choices?.[0];
        const text = choice?.message?.content;
        if (typeof text === 'string' && text.trim()) {
          chatShapes.set(shapeKey, shape);
          return { text, model: config.model, provider: id };
        }
        const reasoning = data.usage?.completion_tokens_details?.reasoning_tokens ?? 0;
        if (choice?.finish_reason === 'length') {
          if (reasoning > 0 && !widened) {
            widened = true;
            shape = { ...shape, minTokens: Math.max(REASONING_MIN_TOKENS, (request.maxTokens ?? 1024) * 4) };
            continue;
          }
          throw new AiError(
            `${label} used its whole token budget${reasoning > 0 ? ' thinking' : ''} before it wrote an answer. Try a model with less reasoning, or a shorter change.`,
            label,
          );
        }
        throw new AiError(`${label} returned no content`, label);
      }
    },
    async ping() {
      try {
        const res = await http({
          url: `${baseUrl}/models`,
          method: 'GET',
          headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {},
        });
        return res.status >= 200 && res.status < 300;
      } catch {
        return false;
      }
    },
  };
}

function anthropicProvider(http: HttpClient, config: AiConfig): AiProvider {
  const baseUrl = (config.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '');
  return {
    id: 'anthropic',
    label: 'Anthropic',
    async complete(request): Promise<AiCompletionResult> {
      const system = request.messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n');
      const data = (await postJson(
        http,
        `${baseUrl}/v1/messages`,
        { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' },
        {
          model: config.model,
          max_tokens: request.maxTokens ?? 1024,
          temperature: request.temperature ?? 0.4,
          ...(system ? { system } : {}),
          messages: request.messages
            .filter((m) => m.role !== 'system')
            .map((m) => ({ role: m.role, content: m.content })),
        },
        'Anthropic',
      )) as { content?: Array<{ type: string; text?: string }> };
      const text = data.content
        ?.filter((c) => c.type === 'text')
        .map((c) => c.text ?? '')
        .join('');
      if (!text) throw new AiError('Anthropic returned no content', 'anthropic');
      return { text, model: config.model, provider: 'anthropic' };
    },
    async ping() {
      try {
        const result = await this.complete({
          messages: [{ role: 'user', content: 'ping' }],
          maxTokens: 8,
        });
        return result.text.length > 0;
      } catch {
        return false;
      }
    },
  };
}

function geminiProvider(http: HttpClient, config: AiConfig): AiProvider {
  const baseUrl = (config.baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
  return {
    id: 'gemini',
    label: 'Google Gemini',
    async complete(request): Promise<AiCompletionResult> {
      const system = request.messages
        .filter((m) => m.role === 'system')
        .map((m) => m.content)
        .join('\n\n');
      const data = (await postJson(
        http,
        `${baseUrl}/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`,
        {},
        {
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents: request.messages
            .filter((m) => m.role !== 'system')
            .map((m) => ({
              role: m.role === 'assistant' ? 'model' : 'user',
              parts: [{ text: m.content }],
            })),
          generationConfig: {
            maxOutputTokens: request.maxTokens ?? 1024,
            temperature: request.temperature ?? 0.4,
          },
        },
        'Gemini',
      )) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
      if (!text) throw new AiError('Gemini returned no content', 'gemini');
      return { text, model: config.model, provider: 'gemini' };
    },
    async ping() {
      try {
        const res = await http({
          url: `${baseUrl}/v1beta/models?key=${config.apiKey}`,
          method: 'GET',
          headers: {},
        });
        return res.status >= 200 && res.status < 300;
      } catch {
        return false;
      }
    },
  };
}

function ollamaProvider(http: HttpClient, config: AiConfig): AiProvider {
  const baseUrl = (config.baseUrl || 'http://localhost:11434').replace(/\/$/, '');
  return {
    id: 'ollama',
    label: 'Ollama',
    async complete(request): Promise<AiCompletionResult> {
      const data = (await postJson(
        http,
        `${baseUrl}/api/chat`,
        {},
        {
          model: config.model,
          messages: request.messages,
          stream: false,
          options: { temperature: request.temperature ?? 0.4 },
        },
        'Ollama',
      )) as { message?: { content?: string } };
      const text = data.message?.content;
      if (typeof text !== 'string' || !text.trim()) throw new AiError('Ollama returned no content', 'ollama');
      return { text, model: config.model, provider: 'ollama' };
    },
    async ping() {
      try {
        const res = await http({ url: `${baseUrl}/api/tags`, method: 'GET', headers: {} });
        return res.status >= 200 && res.status < 300;
      } catch {
        return false;
      }
    },
  };
}

export function createAiProvider(config: AiConfig, http: HttpClient, cli?: CliRunner): AiProvider {
  switch (config.provider) {
    case 'cli':
      if (!cli) throw new AiError('CLI agents need the desktop app', 'cli');
      return cliAgentProvider(config, cli);
    case 'openai':
      return openAiCompatible('openai', 'OpenAI', http, config, 'https://api.openai.com/v1');
    case 'lmstudio':
      return openAiCompatible('lmstudio', 'LM Studio', http, config, 'http://localhost:1234/v1');
    case 'anthropic':
      return anthropicProvider(http, config);
    case 'gemini':
      return geminiProvider(http, config);
    case 'ollama':
      return ollamaProvider(http, config);
  }
}

export const AI_PROVIDER_PRESETS: Record<
  AiProviderKind,
  { label: string; defaultModel: string; needsApiKey: boolean; defaultBaseUrl: string }
> = {
  cli: { label: 'Installed AI CLI (Claude, Copilot, Codex…)', defaultModel: '', needsApiKey: false, defaultBaseUrl: '' },
  openai: { label: 'OpenAI', defaultModel: 'gpt-4o-mini', needsApiKey: true, defaultBaseUrl: 'https://api.openai.com/v1' },
  anthropic: { label: 'Anthropic', defaultModel: 'claude-sonnet-5', needsApiKey: true, defaultBaseUrl: 'https://api.anthropic.com' },
  gemini: { label: 'Google Gemini', defaultModel: 'gemini-2.0-flash', needsApiKey: true, defaultBaseUrl: 'https://generativelanguage.googleapis.com' },
  ollama: { label: 'Ollama', defaultModel: 'llama3.1', needsApiKey: false, defaultBaseUrl: 'http://localhost:11434' },
  lmstudio: { label: 'LM Studio', defaultModel: 'local-model', needsApiKey: false, defaultBaseUrl: 'http://localhost:1234/v1' },
};
