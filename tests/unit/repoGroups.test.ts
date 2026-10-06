import { describe, expect, it } from 'vitest';
import {
  REPO_GROUP_COLORS,
  groupRepos,
  moveRepoGroup,
  nextRepoGroupColor,
  orderRepoTabs,
  repoGroupIdFor,
  repoGroupNameProblem,
  tabClusters,
  type RepoGroup,
} from '@angkorgit/core';

const fe: RepoGroup = { id: 'fe', name: 'Frontend', color: 0 };
const be: RepoGroup = { id: 'be', name: 'Backend', color: 1 };

const recents = [
  { path: '/w/web', name: 'web' },
  { path: '/w/api', name: 'api' },
  { path: '/w/tools', name: 'tools' },
  { path: '/w/web-hotfix', name: 'web-hotfix' },
];

describe('repository groups', () => {
  it('rejects empty and duplicate names, ignoring case and the group being renamed', () => {
    expect(repoGroupNameProblem('   ', [fe])).toBe('empty');
    expect(repoGroupNameProblem('frontend', [fe])).toBe('taken');
    expect(repoGroupNameProblem(' Frontend ', [fe], 'fe')).toBeNull();
    expect(repoGroupNameProblem('Work', [fe, be])).toBeNull();
  });

  it('hands out the least used colour and wraps once every colour is taken', () => {
    expect(nextRepoGroupColor([])).toBe(0);
    expect(nextRepoGroupColor([fe])).toBe(1);
    expect(nextRepoGroupColor([fe, be])).toBe(2);
    const all = Array.from({ length: REPO_GROUP_COLORS }, (_, i) => ({ id: `g${i}`, name: `g${i}`, color: i }));
    expect(nextRepoGroupColor(all)).toBe(0);
    expect(nextRepoGroupColor([...all, { id: 'x', name: 'x', color: 0 }])).toBe(1);
  });

  it('buckets recents by group in recents order and keeps the rest ungrouped', () => {
    const grouped = groupRepos(recents, [fe, be], { '/w/web': 'fe', '/w/api': 'be', '/w/web-hotfix': 'fe' });
    expect(grouped.sections.map((s) => [s.group.id, s.repos.map((r) => r.name)])).toEqual([
      ['fe', ['web', 'web-hotfix']],
      ['be', ['api']],
    ]);
    expect(grouped.ungrouped.map((r) => r.name)).toEqual(['tools']);
  });

  it('treats a path mapped to a deleted group as ungrouped and lists empty groups', () => {
    const grouped = groupRepos(recents, [fe], { '/w/api': 'gone' });
    expect(grouped.sections).toEqual([{ group: fe, repos: [] }]);
    expect(grouped.ungrouped).toHaveLength(4);
  });

  it('lets a worktree inherit its main repository group unless it has one of its own', () => {
    const mains = { '/w/web-hotfix': '/w/web' };
    expect(repoGroupIdFor('/w/web-hotfix', { '/w/web': 'fe' }, mains)).toBe('fe');
    expect(repoGroupIdFor('/w/web-hotfix', { '/w/web': 'fe', '/w/web-hotfix': 'be' }, mains)).toBe('be');
    expect(repoGroupIdFor('/w/tools', { '/w/web': 'fe' }, mains)).toBeNull();
    const grouped = groupRepos(recents, [fe], { '/w/web': 'fe' }, mains);
    expect(grouped.sections[0].repos.map((r) => r.name)).toEqual(['web', 'web-hotfix']);
  });
});

describe('tab clusters', () => {
  it('clusters open tabs by group in group order, ungrouped last, keeping the strip order inside', () => {
    const tabs = ['/w/tools', '/w/api', '/w/web', '/w/web-hotfix'];
    const groupOf = { '/w/web': 'fe', '/w/api': 'be', '/w/web-hotfix': 'fe' };
    expect(tabClusters(tabs, [fe, be], groupOf)).toEqual([
      { group: fe, tabs: ['/w/web', '/w/web-hotfix'] },
      { group: be, tabs: ['/w/api'] },
      { group: null, tabs: ['/w/tools'] },
    ]);
    expect(orderRepoTabs(tabs, [fe, be], groupOf)).toEqual(['/w/web', '/w/web-hotfix', '/w/api', '/w/tools']);
  });

  it('leaves the order alone without groups and omits groups with no open tab', () => {
    const tabs = ['/w/tools', '/w/api'];
    expect(tabClusters(tabs, [], {})).toEqual([{ group: null, tabs }]);
    expect(orderRepoTabs(tabs, [fe, be], { '/w/web': 'fe' })).toEqual(tabs);
    expect(tabClusters(tabs, [fe, be], { '/w/api': 'be' })).toEqual([
      { group: be, tabs: ['/w/api'] },
      { group: null, tabs: ['/w/tools'] },
    ]);
  });
});

describe('moveRepoGroup', () => {
  const me: RepoGroup = { id: 'me', name: 'Personal', color: 2 };
  it('moves a group before or after another and keeps the rest in place', () => {
    expect(moveRepoGroup([fe, be, me], 'me', 'fe', 'before').map((g) => g.id)).toEqual(['me', 'fe', 'be']);
    expect(moveRepoGroup([fe, be, me], 'fe', 'be', 'after').map((g) => g.id)).toEqual(['be', 'fe', 'me']);
    expect(moveRepoGroup([fe, be, me], 'fe', 'me', 'after').map((g) => g.id)).toEqual(['be', 'me', 'fe']);
  });
  it('ignores a move onto itself or onto an unknown group', () => {
    expect(moveRepoGroup([fe, be], 'fe', 'fe', 'before')).toEqual([fe, be]);
    expect(moveRepoGroup([fe, be], 'fe', 'nope', 'before')).toEqual([fe, be]);
    expect(moveRepoGroup([fe, be], 'nope', 'fe', 'before')).toEqual([fe, be]);
  });
});
