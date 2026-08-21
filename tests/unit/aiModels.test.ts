import { describe, expect, it } from 'vitest';
import {
  listAiModels,
  parseAnthropicModels,
  parseGeminiModels,
  parseOllamaModels,
  parseOpenAiModels,
  type AiConfig,
  type HttpRequest,
} from '@angkorgit/core';

const baseConfig: AiConfig = { provider: 'openai', apiKey: 'sk-test', model: '' };

function fakeHttp(body: string, capture?: (req: HttpRequest) => void) {
  return async (req: HttpRequest) => {
    capture?.(req);
    return { status: 200, body };
  };
}

describe('ai model list parsing', () => {
  it('parses openai-compatible model lists sorted and deduped', () => {
    const body = JSON.stringify({
      data: [{ id: 'gpt-4o-mini' }, { id: 'o3' }, { id: 'gpt-4o-mini' }, {}],
    });
    expect(parseOpenAiModels(body)).toEqual(['gpt-4o-mini', 'o3']);
  });

  it('parses anthropic model lists', () => {
    const body = JSON.stringify({ data: [{ id: 'claude-sonnet-5' }, { id: 'claude-haiku-4-5' }] });
    expect(parseAnthropicModels(body)).toEqual(['claude-haiku-4-5', 'claude-sonnet-5']);
  });

  it('parses gemini models keeping only generateContent-capable ones and stripping the prefix', () => {
    const body = JSON.stringify({
      models: [
        { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent', 'countTokens'] },
      ],
    });
    expect(parseGeminiModels(body)).toEqual(['gemini-2.0-flash', 'gemini-2.5-pro']);
  });

  it('parses ollama tag lists', () => {
    const body = JSON.stringify({ models: [{ name: 'llama3.1:8b' }, { name: 'qwen2.5-coder:7b' }] });
    expect(parseOllamaModels(body)).toEqual(['llama3.1:8b', 'qwen2.5-coder:7b']);
  });

  it('throws a descriptive error on invalid JSON', () => {
    expect(() => parseOpenAiModels('<html>oops</html>')).toThrowError(/invalid JSON/);
  });
});

describe('listAiModels request shapes', () => {
  it('hits {baseUrl}/models with a bearer token for openai-compatible providers', async () => {
    let seen: HttpRequest | undefined;
    const body = JSON.stringify({ data: [{ id: 'openai/gpt-oss-120b' }] });
    const models = await listAiModels(
      { ...baseConfig, baseUrl: 'https://api.groq.com/openai/v1' },
      fakeHttp(body, (req) => (seen = req)),
    );
    expect(models).toEqual(['openai/gpt-oss-120b']);
    expect(seen?.url).toBe('https://api.groq.com/openai/v1/models');
    expect(seen?.headers.authorization).toBe('Bearer sk-test');
  });

  it('hits the anthropic models endpoint with api key headers', async () => {
    let seen: HttpRequest | undefined;
    const body = JSON.stringify({ data: [{ id: 'claude-sonnet-5' }] });
    await listAiModels(
      { ...baseConfig, provider: 'anthropic' },
      fakeHttp(body, (req) => (seen = req)),
    );
    expect(seen?.url).toBe('https://api.anthropic.com/v1/models?limit=1000');
    expect(seen?.headers['x-api-key']).toBe('sk-test');
    expect(seen?.headers['anthropic-version']).toBeDefined();
  });

  it('hits the ollama tags endpoint without auth', async () => {
    let seen: HttpRequest | undefined;
    const body = JSON.stringify({ models: [{ name: 'llama3.1' }] });
    await listAiModels(
      { ...baseConfig, provider: 'ollama', apiKey: '' },
      fakeHttp(body, (req) => (seen = req)),
    );
    expect(seen?.url).toBe('http://localhost:11434/api/tags');
    expect(seen?.headers).toEqual({});
  });

  it('returns an empty list for the cli provider without any request', async () => {
    const models = await listAiModels({ ...baseConfig, provider: 'cli' }, async () => {
      throw new Error('should not be called');
    });
    expect(models).toEqual([]);
  });

  it('surfaces http errors with the status', async () => {
    await expect(
      listAiModels(baseConfig, async () => ({ status: 401, body: 'unauthorized' })),
    ).rejects.toThrowError(/401/);
  });
});
