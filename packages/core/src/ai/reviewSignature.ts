export interface StagedStatusLike {
  path: string;
  staged: string | null;
  unstaged: string | null;
}

export function buildStagedReviewSignature(files: StagedStatusLike[]): string {
  return files
    .filter((file) => file.staged)
    .map((file) => JSON.stringify([file.path, file.staged, file.unstaged]))
    .sort()
    .join('\n');
}

export function hashText(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${text.length}:${(hash >>> 0).toString(16)}`;
}
