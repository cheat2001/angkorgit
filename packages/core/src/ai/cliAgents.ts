import {
  AiError,
  type AiCompletionRequest,
  type AiCompletionResult,
  type AiConfig,
  type AiMessage,
  type AiProvider,
  type CliAgentId,
  type CliRunner,
} from './types';

export const CLI_OUTPUT_FILE = '{OUTPUT_FILE}';

export interface CliAgentSpec {
  id: CliAgentId;
  label: string;
  binary: string;
  promptVia: 'stdin' | 'arg';
  args: (model: string) => string[];
}

export const CLI_AGENTS: Record<CliAgentId, CliAgentSpec> = {
  claude: {
    id: 'claude',
    label: 'Claude Code',
    binary: 'claude',
    promptVia: 'stdin',
    args: (model) => ['-p', '--output-format', 'text', ...(model ? ['--model', model] : [])],
  },
  codex: {
    id: 'codex',
    label: 'Codex CLI',
    binary: 'codex',
    promptVia: 'arg',
    args: (model) => [
      'exec',
      '--skip-git-repo-check',
      '--sandbox',
      'read-only',
      ...(model ? ['--model', model] : []),
      '--output-last-message',
      CLI_OUTPUT_FILE,
    ],
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini CLI',
    binary: 'gemini',
    promptVia: 'stdin',
    args: (model) => (model ? ['-m', model] : []),
  },
  opencode: {
    id: 'opencode',
    label: 'OpenCode',
    binary: 'opencode',
    promptVia: 'arg',
    args: (model) => ['run', ...(model ? ['--model', model] : [])],
  },
  antigravity: {
    id: 'antigravity',
    label: 'Antigravity CLI',
    binary: 'agy',
    promptVia: 'arg',
    args: (model) => ['--output-format', 'text', ...(model ? ['--model', model] : []), '-p'],
  },
};

const ANSI_PATTERN = /\u001b(?:\[[0-9;?]*[0-9A-Za-z]|\][^\u0007]*(?:\u0007|\u001b\\))/g;

export function cleanCliOutput(raw: string): string {
  return raw.replace(ANSI_PATTERN, '').trim();
}

export function composeCliPrompt(messages: AiMessage[]): string {
  return messages.map((m) => m.content).join('\n\n');
}

export function cliAgentProvider(config: AiConfig, run: CliRunner): AiProvider {
  const spec = CLI_AGENTS[config.cliAgent ?? 'claude'];
  const program = config.cliPath || spec.binary;

  const complete = async (request: AiCompletionRequest): Promise<AiCompletionResult> => {
    const prompt = composeCliPrompt(request.messages);
    const baseArgs = spec.args(config.model.trim());
    const result = await run({
      program,
      args: spec.promptVia === 'arg' ? [...baseArgs, prompt] : baseArgs,
      stdin: spec.promptVia === 'stdin' ? prompt : '',
      timeoutSecs: 240,
    });
    if (result.status !== 0) {
      const detail = cleanCliOutput(result.stderr || result.stdout).slice(0, 300);
      throw new AiError(
        `${spec.label} exited with code ${result.status}${detail ? `: ${detail}` : ''}`,
        spec.id,
        result.status,
      );
    }
    const text = cleanCliOutput(result.output || result.stdout);
    if (!text) throw new AiError(`${spec.label} returned no output`, spec.id);
    return { text, model: config.model || spec.label, provider: spec.id };
  };

  return {
    id: spec.id,
    label: spec.label,
    complete,
    async ping() {
      try {
        const result = await complete({
          messages: [{ role: 'user', content: 'Reply with exactly one word: pong' }],
          maxTokens: 8,
        });
        return result.text.length > 0;
      } catch {
        return false;
      }
    },
  };
}
