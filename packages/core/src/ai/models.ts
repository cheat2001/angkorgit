import { AiError, type AiConfig, type HttpClient } from './types';

function parseJson(body: string, provider: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    throw new AiError(`${provider} returned invalid JSON`, provider);
  }
}

function uniqueSorted(ids: Array<string | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => !!id))].sort((a, b) => a.localeCompare(b));
}

export function parseOpenAiModels(body: string, provider = 'openai'): string[] {
  const data = parseJson(body, provider) as { data?: Array<{ id?: string }> };
  return uniqueSorted((data.data ?? []).map((m) => m.id));
}

export function parseAnthropicModels(body: string): string[] {
  const data = parseJson(body, 'anthropic') as { data?: Array<{ id?: string }> };
  return uniqueSorted((data.data ?? []).map((m) => m.id));
}

export function parseGeminiModels(body: string): string[] {
  const data = parseJson(body, 'gemini') as {
    models?: Array<{ name?: string; supportedGenerationMethods?: string[] }>;
  };
  return uniqueSorted(
    (data.models ?? [])
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => m.name?.replace(/^models\//, '')),
  );
}

export function parseOllamaModels(body: string): string[] {
  const data = parseJson(body, 'ollama') as { models?: Array<{ name?: string }> };
  return uniqueSorted((data.models ?? []).map((m) => m.name));
}

async function getBody(
  http: HttpClient,
  url: string,
  headers: Record<string, string>,
  provider: string,
): Promise<string> {
  const res = await http({ url, method: 'GET', headers });
  if (res.status < 200 || res.status >= 300) {
    throw new AiError(`${provider} model list failed (${res.status}): ${res.body.slice(0, 200)}`, provider, res.status);
  }
  return res.body;
}

export async function listAiModels(config: AiConfig, http: HttpClient): Promise<string[]> {
  switch (config.provider) {
    case 'cli':
      return [];
    case 'openai':
    case 'lmstudio': {
      const fallback = config.provider === 'openai' ? 'https://api.openai.com/v1' : 'http://localhost:1234/v1';
      const baseUrl = (config.baseUrl || fallback).replace(/\/$/, '');
      const body = await getBody(
        http,
        `${baseUrl}/models`,
        config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {},
        config.provider,
      );
      return parseOpenAiModels(body, config.provider);
    }
    case 'anthropic': {
      const baseUrl = (config.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '');
      const body = await getBody(
        http,
        `${baseUrl}/v1/models?limit=1000`,
        { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' },
        'anthropic',
      );
      return parseAnthropicModels(body);
    }
    case 'gemini': {
      const baseUrl = (config.baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
      const body = await getBody(
        http,
        `${baseUrl}/v1beta/models?key=${config.apiKey}&pageSize=1000`,
        {},
        'gemini',
      );
      return parseGeminiModels(body);
    }
    case 'ollama': {
      const baseUrl = (config.baseUrl || 'http://localhost:11434').replace(/\/$/, '');
      const body = await getBody(http, `${baseUrl}/api/tags`, {}, 'ollama');
      return parseOllamaModels(body);
    }
  }
}
