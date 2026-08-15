import { describe, expect, it } from 'vitest';
import {
  DEFAULT_COMMIT_STYLE,
  aiCapabilities,
  commitStyleInstructions,
  ensureCommitPrefix,
  resolveCommitPrefix,
  type AiCompletionRequest,
  type AiProvider,
  type CommitStyle,
} from '@angkorgit/core';

function style(overrides: Partial<CommitStyle> = {}): CommitStyle {
  return { ...DEFAULT_COMMIT_STYLE, prefixRules: [], ...overrides };
}

function fakeAi(reply: string, requests: AiCompletionRequest[] = []): AiProvider {
  return {
    id: 'fake',
    label: 'Fake',
    async complete(request) {
      requests.push(request);
      return { text: reply, model: 'fake', provider: 'fake' };
    },
    async ping() {
      return true;
    },
  };
}

describe('resolveCommitPrefix', () => {
  const rules = [
    { pattern: 'staging', prefix: '[support]' },
    { pattern: 'demo', prefix: '[support]' },
    { pattern: 'production', prefix: '[support]' },
    { pattern: 'feature/*', prefix: '[{suffix}]' },
  ];

  it('maps environment branches to a fixed prefix', () => {
    expect(resolveCommitPrefix(rules, 'staging')).toBe('[support]');
    expect(resolveCommitPrefix(rules, 'production')).toBe('[support]');
  });

  it('expands {suffix} from the branch name', () => {
    expect(resolveCommitPrefix(rules, 'feature/checkout-flow')).toBe('[checkout-flow]');
    expect(resolveCommitPrefix(rules, 'feature/team/deep-path')).toBe('[deep-path]');
  });

  it('expands {branch} and {ticket}', () => {
    expect(resolveCommitPrefix([{ pattern: '*', prefix: '({branch})' }], 'hotfix/x')).toBe('(hotfix/x)');
    expect(resolveCommitPrefix([{ pattern: '*', prefix: '{ticket}:' }], 'feature/ABC-123-login')).toBe('ABC-123:');
  });

  it('skips a {ticket} rule when the branch has no ticket and falls through', () => {
    const withFallback = [
      { pattern: '*', prefix: '[{ticket}]' },
      { pattern: '*', prefix: '[misc]' },
    ];
    expect(resolveCommitPrefix(withFallback, 'feature/no-ticket-here')).toBe('[misc]');
  });

  it('first matching rule wins and blank rules are ignored', () => {
    const ordered = [
      { pattern: '', prefix: '[blank]' },
      { pattern: 'feature/*', prefix: '[first]' },
      { pattern: 'feature/*', prefix: '[second]' },
    ];
    expect(resolveCommitPrefix(ordered, 'feature/a')).toBe('[first]');
  });

  it('returns null with no branch or no match', () => {
    expect(resolveCommitPrefix(rules, null)).toBeNull();
    expect(resolveCommitPrefix(rules, 'main')).toBeNull();
  });

  it('keeps dollar sequences in branch names literal', () => {
    expect(resolveCommitPrefix([{ pattern: '*', prefix: '[{branch}]' }], 'fix/a$&b')).toBe('[fix/a$&b]');
    expect(resolveCommitPrefix([{ pattern: '*', prefix: '[{suffix}]' }], "fix/a$'b")).toBe("[a$'b]");
  });

  it('does not let regex metacharacters in patterns escape', () => {
    expect(resolveCommitPrefix([{ pattern: 'release-1.0', prefix: '[rel]' }], 'release-1x0')).toBeNull();
    expect(resolveCommitPrefix([{ pattern: 'release-1.0', prefix: '[rel]' }], 'release-1.0')).toBe('[rel]');
  });
});

describe('commitStyleInstructions', () => {
  it('defaults to conventional commits', () => {
    expect(commitStyleInstructions(style(), null)).toContain('conventional-commit');
  });

  it('plain preset forbids type prefixes', () => {
    expect(commitStyleInstructions(style({ preset: 'plain' }), null)).toContain('no type prefix');
  });

  it('custom preset uses the user instructions and falls back when empty', () => {
    expect(commitStyleInstructions(style({ preset: 'custom', instructions: 'Write in past tense.' }), null)).toContain(
      'Write in past tense.',
    );
    expect(commitStyleInstructions(style({ preset: 'custom', instructions: '  ' }), null)).toContain(
      'conventional-commit',
    );
  });

  it('tells the model about a resolved prefix', () => {
    expect(commitStyleInstructions(style(), '[support]')).toContain('"[support] "');
  });
});

describe('generateCommitMessage with style', () => {
  it('enforces the prefix even when the model ignores it', async () => {
    const requests: AiCompletionRequest[] = [];
    const message = await aiCapabilities.generateCommitMessage(fakeAi('fix login redirect', requests), 'diff', {
      style: style({ prefixRules: [{ pattern: 'staging', prefix: '[support]' }] }),
      branch: 'staging',
    });
    expect(message).toBe('[support] fix login redirect');
    expect(requests[0].messages[1].content).toContain('[support]');
  });

  it('does not double an already-present prefix', () => {
    expect(ensureCommitPrefix('[support] fix it', '[support]')).toBe('[support] fix it');
    expect(ensureCommitPrefix('fix it', '[support]')).toBe('[support] fix it');
  });

  it('keeps the plain behavior when no style is passed', async () => {
    const requests: AiCompletionRequest[] = [];
    const message = await aiCapabilities.generateCommitMessage(fakeAi('feat: x', requests), 'diff');
    expect(message).toBe('feat: x');
    expect(requests[0].messages[1].content).toContain('conventional-commit');
  });
});
