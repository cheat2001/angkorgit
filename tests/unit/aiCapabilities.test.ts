import { describe, expect, it } from 'vitest';
import { aiCapabilities, type AiCompletionRequest, type AiProvider } from '@angkorgit/core';

function capturingProvider(capture: (req: AiCompletionRequest) => void): AiProvider {
  return {
    id: 'openai',
    label: 'Fake',
    async complete(request) {
      capture(request);
      return { text: 'looks good', model: 'fake', provider: 'openai' };
    },
    async ping() {
      return true;
    },
  };
}

function userPrompt(request: AiCompletionRequest): string {
  return request.messages.find((m) => m.role === 'user')?.content ?? '';
}

describe('reviewStagedChanges conventions', () => {
  it('includes no convention blocks by default', async () => {
    let captured: AiCompletionRequest | null = null;
    await aiCapabilities.reviewStagedChanges(
      capturingProvider((r) => (captured = r)),
      'diff --git a/x b/x',
    );
    const prompt = userPrompt(captured!);
    expect(prompt).toContain('diff --git a/x b/x');
    expect(prompt).not.toContain('review conventions');
  });

  it('includes general instructions when configured', async () => {
    let captured: AiCompletionRequest | null = null;
    await aiCapabilities.reviewStagedChanges(
      capturingProvider((r) => (captured = r)),
      'diff',
      { instructions: 'Flag any raw SQL.' },
    );
    const prompt = userPrompt(captured!);
    expect(prompt).toContain('General review conventions:\nFlag any raw SQL.');
    expect(prompt).not.toContain('Project review conventions');
  });

  it('includes project instructions after general ones and marks precedence', async () => {
    let captured: AiCompletionRequest | null = null;
    await aiCapabilities.reviewStagedChanges(
      capturingProvider((r) => (captured = r)),
      'diff',
      { instructions: 'Prefer tabs.', projectInstructions: 'This project uses spaces.' },
    );
    const prompt = userPrompt(captured!);
    const general = prompt.indexOf('Prefer tabs.');
    const project = prompt.indexOf('This project uses spaces.');
    expect(general).toBeGreaterThan(-1);
    expect(project).toBeGreaterThan(general);
    expect(prompt).toContain('win over the general ones');
    expect(prompt).toContain('only as guidance');
  });

  it('treats whitespace-only instructions as absent', async () => {
    let captured: AiCompletionRequest | null = null;
    await aiCapabilities.reviewStagedChanges(
      capturingProvider((r) => (captured = r)),
      'diff',
      { instructions: '  \n ', projectInstructions: '' },
    );
    expect(userPrompt(captured!)).not.toContain('review conventions');
  });

  it('clips very long instructions', async () => {
    let captured: AiCompletionRequest | null = null;
    await aiCapabilities.reviewStagedChanges(
      capturingProvider((r) => (captured = r)),
      'diff',
      { instructions: 'x'.repeat(10_000) },
    );
    expect(userPrompt(captured!)).toContain('…(truncated)');
  });
});
