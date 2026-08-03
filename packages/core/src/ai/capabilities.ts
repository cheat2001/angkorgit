import type { AiProvider } from './types';

/**
 * AI capabilities are pure prompt builders over the provider interface —
 * every feature works identically across OpenAI, Anthropic, Gemini, Ollama,
 * LM Studio, or any future adapter.
 */

const SYSTEM = 'You are the AI assistant inside AngKorGit, a Git client. Be precise and concise. Never invent file names or changes that are not in the provided context.';

function clip(text: string, max = 24_000): string {
  return text.length > max ? `${text.slice(0, max)}\n…(truncated)` : text;
}

export async function generateCommitMessage(ai: AiProvider, stagedDiff: string): Promise<string> {
  const result = await ai.complete({
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Write a conventional-commit style message for this staged diff. First line: type(scope): summary under 72 chars. Then a blank line and a short body only if the change needs explanation. Output the message only, no fencing.\n\n${clip(stagedDiff)}`,
      },
    ],
    temperature: 0.3,
  });
  return result.text.trim().replace(/^```[a-z]*\n?|```$/g, '').trim();
}

export async function explainDiff(ai: AiProvider, diff: string): Promise<string> {
  const result = await ai.complete({
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Explain what this diff changes and why it might matter. Use short bullet points.\n\n${clip(diff)}` },
    ],
  });
  return result.text.trim();
}

export async function explainConflict(
  ai: AiProvider,
  file: string,
  current: string,
  incoming: string,
): Promise<string> {
  const result = await ai.complete({
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Explain this merge conflict in ${file} and suggest a resolution.\n\nCURRENT (ours):\n${clip(current, 8000)}\n\nINCOMING (theirs):\n${clip(incoming, 8000)}`,
      },
    ],
  });
  return result.text.trim();
}

export async function generatePrDescription(ai: AiProvider, commits: string, diffStat: string): Promise<string> {
  const result = await ai.complete({
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Write a pull request description in markdown (## Summary, ## Changes, ## Testing) for these commits and diff stat.\n\nCommits:\n${clip(commits, 8000)}\n\nDiff stat:\n${clip(diffStat, 4000)}`,
      },
    ],
  });
  return result.text.trim();
}

export async function summarizeCommits(ai: AiProvider, commits: string): Promise<string> {
  const result = await ai.complete({
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Summarize this commit history into key themes, as short bullets.\n\n${clip(commits)}` },
    ],
  });
  return result.text.trim();
}

export async function reviewStagedChanges(ai: AiProvider, stagedDiff: string): Promise<string> {
  const result = await ai.complete({
    messages: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: `Review this staged diff. List concrete issues (bugs, edge cases, naming, missing tests) ordered by severity. If it looks good, say so briefly.\n\n${clip(stagedDiff)}`,
      },
    ],
  });
  return result.text.trim();
}
