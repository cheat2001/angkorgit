export function worktreeFolderName(repoName: string, branch: string): string {
  const slug = branch
    .trim()
    .replace(/^refs\/heads\//, '')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .replace(/-{2,}/g, '-');
  const base = repoName.trim() || 'worktree';
  return slug ? `${base}-${slug}` : base;
}

export function suggestWorktreePath(parentDir: string, repoName: string, branch: string): string {
  const parent = parentDir.replace(/[\\/]+$/, '');
  const separator = parent.includes('\\') && !parent.includes('/') ? '\\' : '/';
  return `${parent}${separator}${worktreeFolderName(repoName, branch)}`;
}

export function parentDirectory(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const index = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return index <= 0 ? trimmed : trimmed.slice(0, index);
}
