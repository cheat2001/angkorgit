import type { GroupUpdateResult, RecentRepository } from '@angkorgit/core';

export interface GroupRepositoryResult extends GroupUpdateResult {
  repo: RecentRepository;
}

export type GroupResultKind = 'updated' | 'unchanged' | 'skipped' | 'failed' | 'partial' | 'cancelled';

export function classify(result: GroupUpdateResult): GroupResultKind {
  if (result.status === 'cancelled') return 'cancelled';
  if (result.status === 'failed') return result.changes.length > 0 ? 'partial' : 'failed';
  if (result.status === 'skipped') return 'skipped';
  return result.changes.length > 0 ? 'updated' : 'unchanged';
}

export async function updateGroupRepositories(
  repos: readonly RecentRepository[],
  update: (path: string) => Promise<GroupUpdateResult>,
  onResult: (result: GroupRepositoryResult) => void,
  signal?: AbortSignal,
): Promise<void> {
  for (const repo of repos) {
    const cancelled: GroupUpdateResult = { status: 'cancelled', message: 'Cancelled; completed updates are kept', changes: [] };
    if (signal?.aborted) {
      onResult({ ...cancelled, repo });
      continue;
    }
    const pending = Promise.resolve().then(() => signal?.aborted ? cancelled : update(repo.path)).catch((error): GroupUpdateResult => ({
      status: 'failed', message: (error as { message?: string })?.message ?? String(error), changes: [],
    }));
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<GroupUpdateResult>((resolve) => {
      onAbort = () => resolve(cancelled);
      signal?.addEventListener('abort', onAbort, { once: true });
      if (signal?.aborted) onAbort();
    });
    const result = await Promise.race([pending, aborted]);
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    onResult({ ...result, repo });
    if (result === cancelled) {
      void pending.then((settled) => onResult({ ...settled, repo }));
    }
  }
}
