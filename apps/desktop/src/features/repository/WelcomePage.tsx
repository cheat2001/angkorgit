import { useEffect, useMemo, useState } from 'react';
import {
  chordText,
  groupRepos,
  parseChordId,
  repoGroupIdFor,
  type RepoGroup,
  type RepoGroupDropPosition,
} from '@angkorgit/core';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Clock,
  Copy,
  FolderGit2,
  FolderOpen,
  FolderTree,
  GitBranchPlus,
  MoreHorizontal,
  Pencil,
  Search,
  Settings,
  Trash2,
  Ungroup,
  X,
  Keyboard,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  Hint,
  Input,
  Kbd,
  Logo,
  PaneEmpty,
  Spinner,
  TemplePattern,
  cn,
} from '@angkorgit/design-system';
import type { RecentRepository } from '@angkorgit/core';
import { appVersion, ipc, pickDirectory } from '@/core/ipc';
import { useRepo } from './store';
import { useUi } from '@/features/ui/store';
import { useSettings } from '@/features/settings/store';
import { CloneDialog } from './CloneDialog';
import { RepoShortcutDialog } from './RepoShortcutDialog';
import { RepoGroupDialog } from './RepoGroupDialog';
import { GroupDot, GroupTile, RepoGroupSubmenu } from './RepoGroupMenu';
import { closeRepoGroup, deleteRepoGroup, openRepoGroup } from './groups';
import { SettingsDialog } from '@/features/settings/SettingsDialog';
import { SettingEmpty } from '@/features/settings/SettingCard';
import { isMac, shortenHome, timeAgo } from '@/shared/utils';

const UNGROUPED = 'ungrouped';
const DRAG_TYPE = 'text/angkorgit-repo-path';
const GROUP_DRAG_TYPE = 'text/angkorgit-repo-group';

export function WelcomePage() {
  const navigate = useNavigate();
  const { recents, open, opening, loadRecents } = useRepo();
  const openDialog = useUi((s) => s.openDialog);
  const worktreeTabs = useUi((s) => s.worktreeTabs);
  const worktreeMains = useUi((s) => s.worktreeMains);
  const repoTabs = useUi((s) => s.repoTabs);
  const collapsed = useUi((s) => s.repoGroupsCollapsed);
  const toggleCollapsed = useUi((s) => s.toggleRepoGroupCollapsed);
  const shortcuts = useSettings((s) => s.repoShortcuts);
  const groups = useSettings((s) => s.repoGroups);
  const groupOf = useSettings((s) => s.repoGroupOf);
  const setRepoGroup = useSettings((s) => s.setRepoGroup);
  const moveRepoGroup = useSettings((s) => s.moveRepoGroup);
  const [query, setQuery] = useState('');
  const [activePath, setActivePath] = useState<string | null>(null);
  const [missing, setMissing] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ x: number; y: number; repo: RecentRepository } | null>(null);
  const [groupMenu, setGroupMenu] = useState<{ x: number; y: number; group: RepoGroup; repos: RecentRepository[] } | null>(null);
  const [dragPath, setDragPath] = useState<string | null>(null);
  const [dropZone, setDropZone] = useState<string | null>(null);
  const [dragGroupId, setDragGroupId] = useState<string | null>(null);
  const [groupDrop, setGroupDrop] = useState<{ id: string; position: RepoGroupDropPosition } | null>(null);
  const [version, setVersion] = useState('');

  useEffect(() => {
    void appVersion()
      .then(setVersion)
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (recents.length === 0) {
      setMissing(new Set());
      return;
    }
    let cancelled = false;
    void ipc
      .pathsExist(recents.map((r) => r.path))
      .then((flags) => {
        if (cancelled) return;
        setMissing(new Set(recents.filter((_, i) => !flags[i]).map((r) => r.path)));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [recents]);

  const hasGroups = groups.length > 0;
  const searching = query.trim().length > 0;
  const grouped = useMemo(() => groupRepos(recents, groups, groupOf, worktreeMains), [recents, groups, groupOf, worktreeMains]);
  const groupNameOf = (path: string): string | null => {
    const id = repoGroupIdFor(path, groupOf, worktreeMains);
    return id ? (groups.find((g) => g.id === id)?.name ?? null) : null;
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return recents;
    return recents.filter((r) => {
      if (r.name.toLowerCase().includes(q) || r.path.toLowerCase().includes(q)) return true;
      const id = repoGroupIdFor(r.path, groupOf, worktreeMains);
      const groupName = id ? groups.find((g) => g.id === id)?.name : undefined;
      return !!groupName && groupName.toLowerCase().includes(q);
    });
  }, [recents, query, groups, groupOf, worktreeMains]);

  const visible = useMemo(() => {
    if (searching) return filtered;
    if (!hasGroups) return recents;
    const rows: RecentRepository[] = [];
    for (const section of grouped.sections) if (!collapsed[section.group.id]) rows.push(...section.repos);
    if (!collapsed[UNGROUPED]) rows.push(...grouped.ungrouped);
    return rows;
  }, [searching, filtered, hasGroups, recents, grouped, collapsed]);
  const indexOf = useMemo(() => new Map(visible.map((repo, index) => [repo.path, index])), [visible]);
  const activeIndex = (activePath ? indexOf.get(activePath) : undefined) ?? 0;

  useEffect(() => {
    setActivePath(null);
  }, [query]);

  const openRepository = async (path: string) => {
    if (useRepo.getState().opening !== null) return;
    if (missing.has(path)) {
      toast.error('This folder no longer exists. Remove it from recents or open it from its new location.');
      return;
    }
    try {
      await open(path);
      navigate('/repo');
    } catch (error) {
      toast.error(`Could not open repository: ${(error as { message?: string }).message ?? error}`);
    }
  };

  const browse = async () => {
    const dir = await pickDirectory('Open a Git repository');
    if (dir) await openRepository(dir);
  };

  const removeRecent = async (path: string) => {
    await ipc.removeRecent(path);
    await loadRecents();
  };

  const onSearchKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActivePath(visible[Math.min(visible.length - 1, activeIndex + 1)]?.path ?? null);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActivePath(visible[Math.max(0, activeIndex - 1)]?.path ?? null);
    } else if (e.key === 'Enter') {
      const target = visible[activeIndex];
      if (target) void openRepository(target.path);
    }
  };

  const openMenuAt = (x: number, y: number, repo: RecentRepository) => setMenu({ x, y, repo });

  const dropInto = (zone: string, path: string) => {
    const groupId = zone === UNGROUPED ? null : zone;
    const unchanged = groupId === null ? !groupOf[path] : repoGroupIdFor(path, groupOf, worktreeMains) === groupId;
    if (unchanged) return;
    setRepoGroup(path, groupId);
    const group = groupId ? groups.find((g) => g.id === groupId) : null;
    const name = recents.find((r) => r.path === path)?.name ?? path;
    toast.success(group ? `${name} moved to ${group.name}` : `${name} removed from its group`);
  };

  const renderRow = (repo: RecentRepository, indent: boolean) => {
    const gone = missing.has(repo.path);
    const isWorktree = worktreeTabs.includes(repo.path);
    const chord = shortcuts[repo.path] ? parseChordId(shortcuts[repo.path]) : null;
    const index = indexOf.get(repo.path) ?? -1;
    const active = index === activeIndex;
    const groupName = searching && hasGroups ? groupNameOf(repo.path) : null;
    return (
      <div
        key={repo.path}
        role="button"
        tabIndex={0}
        aria-current={active || undefined}
        data-recent-row={repo.path}
        draggable={hasGroups && !searching}
        className={cn(
          'group flex items-center gap-3 rounded-md px-2.5 py-2 transition-colors',
          indent && 'ml-5',
          gone ? 'cursor-default' : 'cursor-pointer hover:bg-surface-raised',
          active && 'bg-surface-raised ring-1 ring-inset ring-primary/40',
          dragPath === repo.path && 'opacity-40',
        )}
        onMouseEnter={() => setActivePath(repo.path)}
        onClick={() => void openRepository(repo.path)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void openRepository(repo.path);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          openMenuAt(e.clientX, e.clientY, repo);
        }}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, repo.path);
          e.dataTransfer.effectAllowed = 'move';
          setDragPath(repo.path);
        }}
        onDragEnd={() => {
          setDragPath(null);
          setDropZone(null);
        }}
      >
        <span
          className={cn(
            'flex size-8 shrink-0 items-center justify-center rounded-md',
            gone ? 'bg-surface-raised text-faint' : 'bg-primary/10 text-primary',
          )}
        >
          {isWorktree ? <FolderTree className="size-4" /> : <FolderGit2 className="size-4" />}
        </span>
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="flex items-center gap-2">
            <span className={cn('truncate text-sm font-medium', gone ? 'text-muted' : 'text-foreground')}>
              {repo.name}
            </span>
            {chord && (
              <Kbd className="h-4 shrink-0 px-1 text-[9px] font-normal" data-recent-shortcut>
                {chordText(chord, isMac)}
              </Kbd>
            )}
            {groupName && <span className="shrink-0 truncate text-[11px] text-faint">· {groupName}</span>}
            {gone && (
              <span className="flex shrink-0 items-center gap-1 text-[11px] text-danger">
                <AlertTriangle className="size-3" /> folder missing
              </span>
            )}
          </span>
          <span className="truncate font-mono text-[11px] text-faint" title={repo.path}>
            {shortenHome(repo.path)}
          </span>
        </span>
        {opening === repo.path ? (
          <Spinner className="size-3.5 shrink-0 text-primary" />
        ) : (
          <span className="shrink-0 text-xs text-faint">{timeAgo(repo.lastOpenedAt)}</span>
        )}
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
          aria-label={`${repo.name} actions`}
          onClick={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            openMenuAt(rect.left, rect.bottom + 4, repo);
          }}
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      </div>
    );
  };

  const moveGroupBy = (group: RepoGroup, step: -1 | 1) => {
    const index = groups.findIndex((g) => g.id === group.id);
    const target = groups[index + step];
    if (target) moveRepoGroup(group.id, target.id, step < 0 ? 'before' : 'after');
  };

  const renderSection = (zone: string, group: RepoGroup | null, repos: RecentRepository[], first: boolean) => {
    const isCollapsed = !!collapsed[zone];
    const name = group?.name ?? 'Other';
    const openCount = repos.filter((r) => repoTabs.includes(r.path)).length;
    const groupDropHere = group && groupDrop?.id === group.id ? groupDrop.position : null;
    return (
      <div
        key={zone}
        data-group-section={zone}
        className={cn(!first && 'mt-1', dragGroupId === group?.id && 'opacity-40')}
        onDragOver={(e) => {
          if (dragGroupId) {
            if (!group || group.id === dragGroupId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            const header = e.currentTarget.querySelector('[data-group-header]');
            const rect = (header ?? e.currentTarget).getBoundingClientRect();
            const position: RepoGroupDropPosition = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
            if (groupDrop?.id !== group.id || groupDrop.position !== position) setGroupDrop({ id: group.id, position });
            return;
          }
          if (!dragPath) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          if (dropZone !== zone) setDropZone(zone);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          setDropZone((z) => (z === zone ? null : z));
          setGroupDrop((d) => (d?.id === group?.id ? null : d));
        }}
        onDrop={(e) => {
          e.preventDefault();
          const movingGroup = e.dataTransfer.getData(GROUP_DRAG_TYPE) || dragGroupId;
          const path = e.dataTransfer.getData(DRAG_TYPE) || dragPath;
          const target = groupDrop;
          setDragPath(null);
          setDropZone(null);
          setDragGroupId(null);
          setGroupDrop(null);
          if (movingGroup) {
            if (group && target?.id === group.id) moveRepoGroup(movingGroup, group.id, target.position);
            return;
          }
          if (path) dropInto(zone, path);
        }}
      >
        <div
          data-group-header={zone}
          draggable={!!group}
          onDragStart={(e) => {
            if (!group) return;
            e.dataTransfer.setData(GROUP_DRAG_TYPE, group.id);
            e.dataTransfer.effectAllowed = 'move';
            setDragGroupId(group.id);
          }}
          onDragEnd={() => {
            setDragGroupId(null);
            setGroupDrop(null);
          }}
          className={cn(
            'group/header flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold text-foreground/80 transition-colors hover:bg-surface-raised',
            dropZone === zone && 'bg-primary/10 ring-1 ring-inset ring-primary/60',
            groupDropHere === 'before' && 'shadow-[inset_0_2px_0_0_hsl(var(--primary))]',
            groupDropHere === 'after' && 'shadow-[inset_0_-2px_0_0_hsl(var(--primary))]',
          )}
          onContextMenu={
            group
              ? (e) => {
                  e.preventDefault();
                  setGroupMenu({ x: e.clientX, y: e.clientY, group, repos });
                }
              : undefined
          }
        >
          <button
            type="button"
            draggable={!!group}
            className="flex min-w-0 flex-1 items-center gap-2 py-0.5"
            aria-expanded={!isCollapsed}
            onClick={() => toggleCollapsed(zone)}
          >
            <ChevronRight className={cn('size-3.5 shrink-0 transition-transform duration-150', !isCollapsed && 'rotate-90')} />
            <GroupTile color={group?.color ?? null} />
            <span className="min-w-0 flex-1 truncate text-left">{name}</span>
          </button>
          {group && (
            <span className="flex w-0 items-center overflow-hidden group-hover/header:w-auto group-focus-within/header:w-auto">
              <Button
                variant="ghost"
                size="icon-sm"
                className="size-6"
                aria-label={`${group.name} group actions`}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  setGroupMenu({ x: rect.left, y: rect.bottom + 4, group, repos });
                }}
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </span>
          )}
          {openCount > 0 && (
            <Hint label={`${openCount} open in tabs`}>
              <span role="img" className="size-1.5 shrink-0 rounded-full bg-primary" aria-label={`${openCount} open in tabs`} />
            </Hint>
          )}
          <Badge
            tone="neutral"
            className="h-4 min-w-4 shrink-0 cursor-pointer justify-center border-transparent bg-foreground/[0.08] px-1.5 text-[10px] leading-none tabular-nums"
            onClick={() => toggleCollapsed(zone)}
          >
            {repos.length}
          </Badge>
        </div>
        {!isCollapsed &&
          (repos.length > 0 ? (
            repos.map((repo) => renderRow(repo, true))
          ) : (
            <p className="ml-5 px-2.5 py-2 text-[11px] text-faint">Drag a repository here, or move one from its menu.</p>
          ))}
      </div>
    );
  };

  return (
    <motion.div
      className="relative flex h-full items-center justify-center p-8"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      <TemplePattern className="[mask-image:radial-gradient(ellipse_at_center,transparent_30%,black_75%)]" />
      <div className="relative w-full max-w-3xl">
        <div className="mb-10 flex items-center gap-4">
          <div className="text-foreground">
            <Logo size={56} />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">
              AngKor<span className="text-primary">Git</span>
            </h1>
            <p className="text-sm text-muted">Everyday Git, made delightful.</p>
          </div>
          <div className="ml-auto">
            <Hint label="Settings">
              <Button variant="ghost" size="icon" onClick={() => openDialog('settings')} aria-label="Settings">
                <Settings />
              </Button>
            </Hint>
          </div>
        </div>

        <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            onClick={browse}
            className="group flex items-center gap-4 rounded-lg border border-border bg-surface p-4 text-left shadow-soft transition-colors hover:border-primary/50 hover:bg-surface-raised"
          >
            <span className="rounded-lg bg-primary/15 p-2.5 text-primary">
              <FolderOpen className="size-5" />
            </span>
            <span>
              <span className="block font-medium">Open repository</span>
              <span className="block text-xs text-muted">Browse for a local folder</span>
            </span>
          </button>
          <button
            onClick={() => openDialog('clone')}
            className="group flex items-center gap-4 rounded-lg border border-border bg-surface p-4 text-left shadow-soft transition-colors hover:border-primary/50 hover:bg-surface-raised"
          >
            <span className="rounded-lg bg-info/15 p-2.5 text-info">
              <GitBranchPlus className="size-5" />
            </span>
            <span>
              <span className="block font-medium">Clone repository</span>
              <span className="block text-xs text-muted">From a remote URL</span>
            </span>
          </button>
        </div>

        <div className="rounded-lg border border-border bg-surface shadow-soft">
          <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
            <Clock className="size-4 text-muted" />
            <span className="text-sm font-medium">Recent repositories</span>
            {recents.length > 0 && <span className="text-xs text-faint">{recents.length}</span>}
            {recents.length > 0 && (
              <>
              <span className="ml-auto hidden items-center gap-1.5 text-[10px] text-faint sm:flex">
                <Kbd>↑↓</Kbd> choose <Kbd>⏎</Kbd> open
              </span>
              <div className="relative w-52">
                <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
                <Input
                  autoFocus
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onSearchKey}
                  placeholder="Search repositories"
                  aria-label="Search recent repositories"
                  className="h-7 pl-8 text-xs"
                />
              </div>
              </>
            )}
          </div>
          <div className={cn('overflow-y-auto p-2', hasGroups ? 'max-h-96' : 'max-h-72')}>
            {recents.length === 0 ? (
              <SettingEmpty
                icon={<FolderGit2 className="size-4" />}
                title="No repositories yet"
                description="Open a folder that already has a .git directory, or clone one from a URL. Everything you open shows up here."
                action={
                  <span className="flex gap-2">
                    <Button variant="secondary" size="sm" onClick={browse}>
                      <FolderOpen className="size-3.5" /> Open
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => openDialog('clone')}>
                      <GitBranchPlus className="size-3.5" /> Clone
                    </Button>
                  </span>
                }
              />
            ) : searching ? (
              filtered.length === 0 ? (
                <PaneEmpty
                  icon={<Search />}
                  title="No repositories"
                  description={`Nothing matches “${query.trim()}”.`}
                />
              ) : (
                filtered.map((repo) => renderRow(repo, false))
              )
            ) : hasGroups ? (
              <>
                {grouped.sections.map((section, index) => renderSection(section.group.id, section.group, section.repos, index === 0))}
                {grouped.ungrouped.length > 0 && renderSection(UNGROUPED, null, grouped.ungrouped, false)}
              </>
            ) : (
              recents.map((repo) => renderRow(repo, false))
            )}
          </div>
        </div>

        <p className="mt-6 flex items-center justify-center gap-2 text-[11px] text-faint">
          <span>{version ? `AngKorGit v${version}` : 'AngKorGit'}</span>
          <span aria-hidden>·</span>
          <button
            type="button"
            className="hover:text-foreground hover:underline"
            onClick={() =>
              void import('@/features/updater/check').then(({ checkForUpdates }) =>
                checkForUpdates({ silent: false }),
              )
            }
          >
            Check for updates
          </button>
        </p>
      </div>

      {menu && (
        <DropdownMenu open onOpenChange={(o) => !o && setMenu(null)}>
          <DropdownMenuTrigger asChild>
            <span style={{ position: 'fixed', left: menu.x, top: menu.y }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom">
            <DropdownMenuLabel className="max-w-72 truncate font-mono">{shortenHome(menu.repo.path)}</DropdownMenuLabel>
            <DropdownMenuItem disabled={missing.has(menu.repo.path)} onClick={() => void openRepository(menu.repo.path)}>
              <FolderGit2 /> Open
            </DropdownMenuItem>
            <DropdownMenuItem disabled={missing.has(menu.repo.path)} onClick={() => void ipc.revealPath(menu.repo.path)}>
              <FolderOpen /> {isMac ? 'Reveal in Finder' : 'Show in file manager'}
            </DropdownMenuItem>
            <RepoGroupSubmenu path={menu.repo.path} />
            <DropdownMenuItem onClick={() => openDialog('repoShortcut', { repoPath: menu.repo.path })}>
              <Keyboard /> {shortcuts[menu.repo.path] ? 'Change keyboard shortcut…' : 'Keyboard shortcut…'}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                void navigator.clipboard.writeText(menu.repo.path);
                toast.success('Path copied');
              }}
            >
              <Copy /> Copy path
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onClick={() => void removeRecent(menu.repo.path)}>
              {missing.has(menu.repo.path) ? <Trash2 /> : <X />} Remove from recents
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {groupMenu && (
        <DropdownMenu open onOpenChange={(o) => !o && setGroupMenu(null)}>
          <DropdownMenuTrigger asChild>
            <span style={{ position: 'fixed', left: groupMenu.x, top: groupMenu.y }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom" className="min-w-56">
            <DropdownMenuLabel className="flex items-center gap-1.5">
              <GroupDot color={groupMenu.group.color} className="-ml-1" />
              <span className="truncate">{groupMenu.group.name}</span>
            </DropdownMenuLabel>
            <DropdownMenuItem
              disabled={groupMenu.repos.length === 0}
              onClick={() =>
                void openRepoGroup(
                  groupMenu.group,
                  groupMenu.repos.map((r) => r.path),
                  () => navigate('/repo'),
                )
              }
            >
              <FolderOpen /> Open all in tabs
              <DropdownMenuShortcut>{groupMenu.repos.length}</DropdownMenuShortcut>
            </DropdownMenuItem>
            {(() => {
              const openCount = groupMenu.repos.filter((r) => repoTabs.includes(r.path)).length;
              return (
                <DropdownMenuItem
                  disabled={openCount === 0}
                  onClick={() =>
                    closeRepoGroup(
                      groupMenu.group,
                      groupMenu.repos.map((r) => r.path),
                    )
                  }
                >
                  <X /> Close its tabs
                  <DropdownMenuShortcut>{openCount}</DropdownMenuShortcut>
                </DropdownMenuItem>
              );
            })()}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              disabled={groups.findIndex((g) => g.id === groupMenu.group.id) === 0}
              onClick={() => moveGroupBy(groupMenu.group, -1)}
            >
              <ArrowUp /> Move up
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={groups.findIndex((g) => g.id === groupMenu.group.id) === groups.length - 1}
              onClick={() => moveGroupBy(groupMenu.group, 1)}
            >
              <ArrowDown /> Move down
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => openDialog('repoGroup', { groupId: groupMenu.group.id, repoPath: null })}>
              <Pencil /> Edit group…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive onClick={() => void deleteRepoGroup(groupMenu.group, groupMenu.repos.length)}>
              <Ungroup /> {groupMenu.repos.length > 0 ? 'Ungroup…' : 'Ungroup'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <CloneDialog onCloned={(path) => void openRepository(path)} />
      <SettingsDialog />
      <RepoShortcutDialog />
      <RepoGroupDialog />
    </motion.div>
  );
}
