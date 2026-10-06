export interface RepoGroup {
  id: string;
  name: string;
  color: number;
}

export const REPO_GROUP_COLORS = 8;

export const REPO_GROUP_COLOR_NAMES = ['Orange', 'Blue', 'Green', 'Violet', 'Red', 'Teal', 'Amber', 'Pink'] as const;

export type RepoGroupNameProblem = 'empty' | 'taken';

export function nextRepoGroupColor(groups: readonly RepoGroup[]): number {
  const used = new Map<number, number>();
  for (const group of groups) used.set(group.color, (used.get(group.color) ?? 0) + 1);
  let best = 0;
  let bestCount = Number.POSITIVE_INFINITY;
  for (let color = 0; color < REPO_GROUP_COLORS; color++) {
    const count = used.get(color) ?? 0;
    if (count < bestCount) {
      best = color;
      bestCount = count;
    }
  }
  return best;
}

export function repoGroupNameProblem(
  name: string,
  groups: readonly RepoGroup[],
  excludeId?: string | null,
): RepoGroupNameProblem | null {
  const trimmed = name.trim();
  if (!trimmed) return 'empty';
  const lower = trimmed.toLowerCase();
  return groups.some((group) => group.id !== excludeId && group.name.toLowerCase() === lower) ? 'taken' : null;
}

export function repoGroupIdFor(
  path: string,
  groupOf: Readonly<Record<string, string>>,
  mains: Readonly<Record<string, string>> = {},
): string | null {
  const direct = groupOf[path];
  if (direct) return direct;
  const main = mains[path];
  return main ? (groupOf[main] ?? null) : null;
}

export interface RepoGroupSection<T> {
  group: RepoGroup;
  repos: T[];
}

export interface GroupedRepos<T> {
  sections: RepoGroupSection<T>[];
  ungrouped: T[];
}

export function groupRepos<T extends { path: string }>(
  repos: readonly T[],
  groups: readonly RepoGroup[],
  groupOf: Readonly<Record<string, string>>,
  mains: Readonly<Record<string, string>> = {},
): GroupedRepos<T> {
  const buckets = new Map<string, T[]>(groups.map((group) => [group.id, []]));
  const ungrouped: T[] = [];
  for (const repo of repos) {
    const id = repoGroupIdFor(repo.path, groupOf, mains);
    const bucket = id ? buckets.get(id) : undefined;
    if (bucket) bucket.push(repo);
    else ungrouped.push(repo);
  }
  return {
    sections: groups.map((group) => ({ group, repos: buckets.get(group.id) ?? [] })),
    ungrouped,
  };
}

export interface TabCluster {
  group: RepoGroup | null;
  tabs: string[];
}

export function tabClusters(
  tabs: readonly string[],
  groups: readonly RepoGroup[],
  groupOf: Readonly<Record<string, string>>,
  mains: Readonly<Record<string, string>> = {},
): TabCluster[] {
  const grouped = groupRepos(
    tabs.map((path) => ({ path })),
    groups,
    groupOf,
    mains,
  );
  const clusters: TabCluster[] = grouped.sections
    .filter((section) => section.repos.length > 0)
    .map((section) => ({ group: section.group, tabs: section.repos.map((repo) => repo.path) }));
  if (grouped.ungrouped.length > 0) clusters.push({ group: null, tabs: grouped.ungrouped.map((repo) => repo.path) });
  return clusters;
}

export function orderRepoTabs(
  tabs: readonly string[],
  groups: readonly RepoGroup[],
  groupOf: Readonly<Record<string, string>>,
  mains: Readonly<Record<string, string>> = {},
): string[] {
  return tabClusters(tabs, groups, groupOf, mains).flatMap((cluster) => cluster.tabs);
}

export type RepoGroupDropPosition = 'before' | 'after';

export function moveRepoGroup(
  groups: readonly RepoGroup[],
  id: string,
  targetId: string,
  position: RepoGroupDropPosition,
): RepoGroup[] {
  const moving = groups.find((group) => group.id === id);
  if (!moving || id === targetId) return [...groups];
  const rest = groups.filter((group) => group.id !== id);
  const index = rest.findIndex((group) => group.id === targetId);
  if (index < 0) return [...groups];
  rest.splice(position === 'before' ? index : index + 1, 0, moving);
  return rest;
}
