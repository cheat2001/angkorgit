import { describe, expect, it } from 'vitest';
import { createAiProvider, type AiConfig, type HttpRequest } from '@angkorgit/core';

function fakeHttp(body: string, status = 200) {
  return async (_req: HttpRequest) => ({ status, body });
}

const request = { messages: [{ role: 'user' as const, content: 'hi' }] };

describe('ai providers empty-content handling', () => {
  const openAiConfig: AiConfig = { provider: 'openai', apiKey: 'sk-test', model: 'gpt-test' };
  const ollamaConfig: AiConfig = { provider: 'ollama', apiKey: '', model: 'llama-test' };

  it('openai-compatible rejects an empty content string', async () => {
    const provider = createAiProvider(
      openAiConfig,
      fakeHttp(JSON.stringify({ choices: [{ message: { content: '' } }] })),
    );
    await expect(provider.complete(request)).rejects.toThrow(/returned no content/);
  });

  it('openai-compatible rejects whitespace-only content', async () => {
    const provider = createAiProvider(
      openAiConfig,
      fakeHttp(JSON.stringify({ choices: [{ message: { content: '  \n ' } }] })),
    );
    await expect(provider.complete(request)).rejects.toThrow(/returned no content/);
  });

  it('openai-compatible rejects a missing choices array', async () => {
    const provider = createAiProvider(openAiConfig, fakeHttp(JSON.stringify({})));
    await expect(provider.complete(request)).rejects.toThrow(/returned no content/);
  });

  it('openai-compatible surfaces HTTP error status and body', async () => {
    const provider = createAiProvider(
      openAiConfig,
      fakeHttp(JSON.stringify({ error: { message: 'invalid api key' } }), 401),
    );
    await expect(provider.complete(request)).rejects.toThrow(/401.*invalid api key/s);
  });

  it('openai-compatible returns real content untouched', async () => {
    const provider = createAiProvider(
      openAiConfig,
      fakeHttp(JSON.stringify({ choices: [{ message: { content: 'looks good' } }] })),
    );
    await expect(provider.complete(request)).resolves.toMatchObject({ text: 'looks good' });
  });

  it('ollama rejects an empty content string', async () => {
    const provider = createAiProvider(
      ollamaConfig,
      fakeHttp(JSON.stringify({ message: { content: '' } })),
    );
    await expect(provider.complete(request)).rejects.toThrow(/returned no content/);
  });

  it('ollama returns real content untouched', async () => {
    const provider = createAiProvider(
      ollamaConfig,
      fakeHttp(JSON.stringify({ message: { content: 'fine' } })),
    );
    await expect(provider.complete(request)).resolves.toMatchObject({ text: 'fine' });
  });
});
