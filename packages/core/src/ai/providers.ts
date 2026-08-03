import {
  AiError,
  type AiCompletionRequest,
  type AiCompletionResult,
  type AiConfig,
  type AiProvider,
  type AiProviderKind,
  type HttpClient,
} from './types';

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

/** OpenAI-compatible chat completions (also used by LM Studio and custom hosts). */
function openAiCompatible(
  id: AiProviderKind,
  label: string,
  http: HttpClient,
  config: AiConfig,
  defaultBaseUrl: string,
): AiProvider {
  const baseUrl = (config.baseUrl || defaultBaseUrl).replace(/\/$/, '');
  return {
    id,
    label,
    async complete(request: AiCompletionRequest): Promise<AiCompletionResult> {
      const data = (await postJson(
        http,
        `${baseUrl}/chat/completions`,
        config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {},
        {
          model: config.model,
          messages: request.messages,
          max_tokens: request.maxTokens ?? 1024,
          temperature: request.temperature ?? 0.4,
        },
        label,
      )) as { choices?: Array<{ message?: { content?: string } }> };
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== 'string') throw new AiError(`${label} returned no content`, label);
      return { text, model: config.model, provider: id };
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
      if (typeof text !== 'string') throw new AiError('Ollama returned no content', 'ollama');
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

/**
 * Provider registry. New providers plug in here — features never change.
 */
export function createAiProvider(config: AiConfig, http: HttpClient): AiProvider {
  switch (config.provider) {
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
  openai: { label: 'OpenAI', defaultModel: 'gpt-4o-mini', needsApiKey: true, defaultBaseUrl: 'https://api.openai.com/v1' },
  anthropic: { label: 'Anthropic', defaultModel: 'claude-sonnet-5', needsApiKey: true, defaultBaseUrl: 'https://api.anthropic.com' },
  gemini: { label: 'Google Gemini', defaultModel: 'gemini-2.0-flash', needsApiKey: true, defaultBaseUrl: 'https://generativelanguage.googleapis.com' },
  ollama: { label: 'Ollama', defaultModel: 'llama3.1', needsApiKey: false, defaultBaseUrl: 'http://localhost:11434' },
  lmstudio: { label: 'LM Studio', defaultModel: 'local-model', needsApiKey: false, defaultBaseUrl: 'http://localhost:1234/v1' },
};
