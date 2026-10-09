import type { GroupUpdateResult, RecentRepository } from '@angkorgit/core';

export interface GroupRepositoryResult extends GroupUpdateResult {
  repo: RecentRepository;
}

// Sequential writes keep linked worktrees (which share refs) from racing each other.
export async function updateGroupRepositories(
  repos: readonly RecentRepository[],
  update: (path: string) => Promise<GroupUpdateResult>,
  onResult: (result: GroupRepositoryResult) => void,
): Promise<void> {
  for (const repo of repos) {
    let result: GroupUpdateResult;
    try {
      result = await update(repo.path);
    } catch (error) {
      result = { status: 'failed', message: (error as { message?: string })?.message ?? String(error), changes: [] };
    }
    onResult({ ...result, repo });
  }
}
