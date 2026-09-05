import { describe, expect, it } from 'vitest';
import { joinCommitMessage, splitCommitMessage } from '@angkorgit/core';

describe('splitCommitMessage', () => {
  it('separates the summary from a body after a blank line', () => {
    expect(splitCommitMessage('feat: add worktrees\n\nList, create and remove.\n')).toEqual({
      summary: 'feat: add worktrees',
      body: 'List, create and remove.\n',
    });
  });

  it('treats a second line without a blank line as body', () => {
    expect(splitCommitMessage('summary\nbody line')).toEqual({ summary: 'summary', body: 'body line' });
  });

  it('keeps a single line as summary only', () => {
    expect(splitCommitMessage('just a summary')).toEqual({ summary: 'just a summary', body: '' });
    expect(splitCommitMessage('')).toEqual({ summary: '', body: '' });
  });

  it('normalizes Windows line endings', () => {
    expect(splitCommitMessage('a\r\n\r\nb\r\nc')).toEqual({ summary: 'a', body: 'b\nc' });
  });
});

describe('joinCommitMessage', () => {
  it('writes git-style summary, blank line, body', () => {
    expect(joinCommitMessage('summary', 'body')).toBe('summary\n\nbody');
  });

  it('omits the blank line when there is no body', () => {
    expect(joinCommitMessage('summary', '')).toBe('summary');
  });

  it('never lets a newline into the summary line', () => {
    expect(joinCommitMessage('one\ntwo', 'body')).toBe('one two\n\nbody');
  });

  it('round-trips through split', () => {
    const message = 'fix(ui): wrap paths\n\nLong paths bled out of dialogs.\n\nFixes #2';
    const parts = splitCommitMessage(message);
    expect(joinCommitMessage(parts.summary, parts.body)).toBe(message);
  });
});
