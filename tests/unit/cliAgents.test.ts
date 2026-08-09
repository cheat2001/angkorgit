import { describe, expect, it } from 'vitest';
import {
  AiError,
  CLI_AGENTS,
  CLI_OUTPUT_FILE,
  cleanCliOutput,
  cliAgentProvider,
  composeCliPrompt,
  type AiConfig,
  type CliRunRequest,
  type CliRunResult,
} from '@angkorgit/core';

function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return { provider: 'cli', apiKey: '', model: '', cliAgent: 'claude', cliPath: '', ...overrides };
}

function runner(result: Partial<CliRunResult>, calls: CliRunRequest[] = []) {
  return async (request: CliRunRequest): Promise<CliRunResult> => {
    calls.push(request);
    return { status: 0, stdout: '', stderr: '', output: null, ...result };
  };
}

describe('cliAgentProvider', () => {
  it('sends the prompt via stdin for Claude Code with text output format', async () => {
    const calls: CliRunRequest[] = [];
    const provider = cliAgentProvider(config(), runner({ stdout: 'feat: hello' }, calls));
    await provider.complete({ messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'diff' }] });
    expect(calls).toHaveLength(1);
    expect(calls[0].args).toEqual(['-p', '--output-format', 'text']);
    expect(calls[0].stdin).toBe('sys\n\ndiff');
  });

  it('passes a model override through to the CLI', async () => {
    const calls: CliRunRequest[] = [];
    const provider = cliAgentProvider(config({ model: 'opus' }), runner({ stdout: 'ok' }, calls));
    await provider.complete({ messages: [{ role: 'user', content: 'x' }] });
    expect(calls[0].args).toContain('--model');
    expect(calls[0].args).toContain('opus');
  });

  it('sends the prompt as the final argument for Codex with an output file', async () => {
    const calls: CliRunRequest[] = [];
    const provider = cliAgentProvider(
      config({ cliAgent: 'codex' }),
      runner({ stdout: 'noise', output: 'fix: from file' }, calls),
    );
    const result = await provider.complete({ messages: [{ role: 'user', content: 'the diff' }] });
    expect(calls[0].args[0]).toBe('exec');
    expect(calls[0].args).toContain(CLI_OUTPUT_FILE);
    expect(calls[0].args[calls[0].args.length - 1]).toBe('the diff');
    expect(calls[0].stdin).toBe('');
    expect(result.text).toBe('fix: from file');
  });

  it('uses the resolved binary path when configured', async () => {
    const calls: CliRunRequest[] = [];
    const provider = cliAgentProvider(config({ cliPath: '/opt/homebrew/bin/claude' }), runner({ stdout: 'ok' }, calls));
    await provider.complete({ messages: [{ role: 'user', content: 'x' }] });
    expect(calls[0].program).toBe('/opt/homebrew/bin/claude');
  });

  it('strips ANSI escapes and whitespace from output', async () => {
    const provider = cliAgentProvider(config(), runner({ stdout: '  \u001b[32mfeat: colored\u001b[0m \n' }));
    const result = await provider.complete({ messages: [{ role: 'user', content: 'x' }] });
    expect(result.text).toBe('feat: colored');
  });

  it('throws AiError with stderr detail on non-zero exit', async () => {
    const provider = cliAgentProvider(config(), runner({ status: 1, stderr: 'not logged in' }));
    await expect(provider.complete({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrowError(AiError);
    await expect(provider.complete({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(/not logged in/);
  });

  it('throws AiError when the CLI produces no output', async () => {
    const provider = cliAgentProvider(config(), runner({ stdout: '\n \n' }));
    await expect(provider.complete({ messages: [{ role: 'user', content: 'x' }] })).rejects.toThrow(/no output/);
  });

  it('ping reports true on success and false on failure', async () => {
    expect(await cliAgentProvider(config(), runner({ stdout: 'pong' })).ping()).toBe(true);
    expect(await cliAgentProvider(config(), runner({ status: 127 })).ping()).toBe(false);
  });
});

describe('cli agent specs', () => {
  it('every agent builds argument lists without the prompt embedded', () => {
    for (const spec of Object.values(CLI_AGENTS)) {
      expect(spec.args('')).not.toContain('');
      expect(spec.args('m').length).toBeGreaterThanOrEqual(spec.args('').length);
    }
  });

  it('opencode runs in non-interactive mode', () => {
    expect(CLI_AGENTS.opencode.args('')[0]).toBe('run');
    expect(CLI_AGENTS.opencode.promptVia).toBe('arg');
  });

  it('antigravity puts -p last so the appended prompt becomes its value', () => {
    expect(CLI_AGENTS.antigravity.promptVia).toBe('arg');
    expect(CLI_AGENTS.antigravity.args('').at(-1)).toBe('-p');
    const withModel = CLI_AGENTS.antigravity.args('gemini-3.1-pro-high');
    expect(withModel.at(-1)).toBe('-p');
    expect(withModel.join(' ')).toBe('--output-format text --model gemini-3.1-pro-high -p');
  });
});

describe('cleanCliOutput / composeCliPrompt', () => {
  it('removes OSC sequences and trims', () => {
    expect(cleanCliOutput('\u001b]0;title\u0007hello\u001b[1m!\u001b[0m ')).toBe('hello!');
  });

  it('joins message contents with blank lines', () => {
    expect(
      composeCliPrompt([
        { role: 'system', content: 'a' },
        { role: 'user', content: 'b' },
      ]),
    ).toBe('a\n\nb');
  });
});
