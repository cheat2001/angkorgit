import { beforeEach, describe, expect, it } from 'vitest';
import { createAiProvider, REASONING_MIN_TOKENS, resetChatShapes, type AiConfig, type HttpRequest } from '@angkorgit/core';

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

type Reply = { status: number; body: unknown };

function scripted(replies: Reply[]) {
  const sent: Array<Record<string, unknown>> = [];
  const http = async (req: HttpRequest) => {
    sent.push(JSON.parse(req.body ?? '{}') as Record<string, unknown>);
    const reply = replies.shift() ?? { status: 500, body: 'unexpected request' };
    return { status: reply.status, body: typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body) };
  };
  return { http, sent };
}

const answer = (content: string) => ({ status: 200, body: { choices: [{ message: { content }, finish_reason: 'stop' }] } });
const openAiError = (param: string, message: string, code = 'unsupported_parameter') => ({
  status: 400,
  body: { error: { message, type: 'invalid_request_error', param, code } },
});

describe('openai-compatible request parameters', () => {
  beforeEach(() => resetChatShapes());

  const openai: AiConfig = { provider: 'openai', apiKey: 'sk-test', model: 'gpt-next' };
  const groq: AiConfig = { provider: 'openai', apiKey: 'gsk', model: 'llama', baseUrl: 'https://api.groq.com/openai/v1' };

  it('sends max_completion_tokens to OpenAI itself', async () => {
    const { http, sent } = scripted([answer('ok')]);
    await createAiProvider(openai, http).complete({ ...request, maxTokens: 4096 });
    expect(sent).toHaveLength(1);
    expect(sent[0].max_completion_tokens).toBe(4096);
    expect(sent[0]).not.toHaveProperty('max_tokens');
    expect(sent[0].temperature).toBe(0.4);
  });

  it('keeps max_tokens for other OpenAI-compatible hosts and LM Studio', async () => {
    for (const config of [groq, { provider: 'lmstudio', apiKey: '', model: 'local' } as AiConfig]) {
      const { http, sent } = scripted([answer('ok')]);
      await createAiProvider(config, http).complete(request);
      expect(sent[0].max_tokens).toBe(1024);
      expect(sent[0]).not.toHaveProperty('max_completion_tokens');
    }
  });

  it('drops temperature when the model only accepts the default, and remembers it', async () => {
    const { http, sent } = scripted([
      openAiError('temperature', "Unsupported value: 'temperature' does not support 0.4 with this model. Only the default (1) value is supported.", 'unsupported_value'),
      answer('first'),
      answer('second'),
    ]);
    const provider = createAiProvider(openai, http);
    await expect(provider.complete(request)).resolves.toMatchObject({ text: 'first' });
    await expect(provider.complete(request)).resolves.toMatchObject({ text: 'second' });
    expect(sent).toHaveLength(3);
    expect(sent[1]).not.toHaveProperty('temperature');
    expect(sent[2]).not.toHaveProperty('temperature');
  });

  it('switches to max_completion_tokens when a host rejects max_tokens (issue #86)', async () => {
    const { http, sent } = scripted([
      openAiError('max_tokens', "Unsupported parameter: 'max_tokens' is not supported with this model. Use 'max_completion_tokens' instead."),
      answer('done'),
    ]);
    await expect(createAiProvider(groq, http).complete(request)).resolves.toMatchObject({ text: 'done' });
    expect(sent[1].max_completion_tokens).toBe(1024);
    expect(sent[1]).not.toHaveProperty('max_tokens');
  });

  it('reads the rejected parameter from a plain message without a param field', async () => {
    const { http, sent } = scripted([
      { status: 400, body: { error: { message: 'Unrecognized request argument supplied: max_completion_tokens' } } },
      answer('done'),
    ]);
    await createAiProvider(openai, http).complete(request);
    expect(sent[1].max_tokens).toBe(1024);
  });

  it('swaps the token parameter only once when a host rejects both', async () => {
    const { http, sent } = scripted([
      openAiError('max_tokens', "Unsupported parameter: 'max_tokens'"),
      openAiError('max_completion_tokens', "Unsupported parameter: 'max_completion_tokens'"),
    ]);
    await expect(createAiProvider(groq, http).complete(request)).rejects.toThrow(/400/);
    expect(sent).toHaveLength(2);
  });

  it('does not retry an unrelated bad request', async () => {
    const { http, sent } = scripted([{ status: 400, body: { error: { message: 'The model `gpt-nope` does not exist', param: null } } }]);
    await expect(createAiProvider(openai, http).complete(request)).rejects.toThrow(/does not exist/);
    expect(sent).toHaveLength(1);
  });

  it('gives a reasoning model room to think when it ran out before answering', async () => {
    const { http, sent } = scripted([
      { status: 200, body: { choices: [{ message: { content: '' }, finish_reason: 'length' }], usage: { completion_tokens_details: { reasoning_tokens: 1024 } } } },
      answer('feat: add thing'),
      answer('again'),
    ]);
    const provider = createAiProvider(openai, http);
    await expect(provider.complete(request)).resolves.toMatchObject({ text: 'feat: add thing' });
    expect(sent[1].max_completion_tokens).toBe(REASONING_MIN_TOKENS);
    await provider.complete(request);
    expect(sent[2].max_completion_tokens).toBe(REASONING_MIN_TOKENS);
  });

  it('explains a budget that ran out instead of saying no content', async () => {
    const { http, sent } = scripted([{ status: 200, body: { choices: [{ message: { content: '' }, finish_reason: 'length' }] } }]);
    await expect(createAiProvider(groq, http).complete(request)).rejects.toThrow(/whole token budget before/);
    expect(sent).toHaveLength(1);
  });
});
