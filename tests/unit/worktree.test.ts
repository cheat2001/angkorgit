import { describe, expect, it } from 'vitest';
import { parentDirectory, suggestWorktreePath, worktreeFolderName } from '@angkorgit/core';

describe('worktreeFolderName', () => {
  it('joins the repository name with a slug of the branch', () => {
    expect(worktreeFolderName('angkorgit', 'feature/diff-viewer')).toBe('angkorgit-feature-diff-viewer');
  });

  it('strips refs/heads and collapses unsafe characters', () => {
    expect(worktreeFolderName('app', 'refs/heads/fix//weird name!')).toBe('app-fix-weird-name');
  });

  it('never yields a bare separator or an empty name', () => {
    expect(worktreeFolderName('app', '---')).toBe('app');
    expect(worktreeFolderName('', '')).toBe('worktree');
  });
});

describe('suggestWorktreePath', () => {
  it('places the folder beside the repository', () => {
    expect(suggestWorktreePath('/Users/me/code/', 'angkorgit', 'hotfix/login')).toBe(
      '/Users/me/code/angkorgit-hotfix-login',
    );
  });

  it('keeps Windows separators when the parent uses them', () => {
    expect(suggestWorktreePath('C:\\code\\', 'app', 'main')).toBe('C:\\code\\app-main');
  });
});

describe('parentDirectory', () => {
  it('returns the containing folder', () => {
    expect(parentDirectory('/Users/me/code/angkorgit')).toBe('/Users/me/code');
    expect(parentDirectory('/Users/me/code/angkorgit/')).toBe('/Users/me/code');
  });

  it('keeps a root-level path intact', () => {
    expect(parentDirectory('/repo')).toBe('/repo');
  });
});
