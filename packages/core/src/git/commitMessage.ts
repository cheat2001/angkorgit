export interface CommitMessageParts {
  summary: string;
  body: string;
}

export function splitCommitMessage(message: string): CommitMessageParts {
  const normalized = message.replace(/\r\n/g, '\n');
  const newline = normalized.indexOf('\n');
  if (newline === -1) return { summary: normalized, body: '' };
  const summary = normalized.slice(0, newline);
  const rest = normalized.slice(newline + 1);
  return { summary, body: rest.startsWith('\n') ? rest.slice(1) : rest };
}

export function joinCommitMessage(summary: string, body: string): string {
  const line = summary.replace(/\r?\n/g, ' ');
  if (body.length === 0) return line;
  return `${line}\n\n${body}`;
}
