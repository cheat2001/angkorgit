import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import {
  Check,
  ChevronDown,
  ChevronsLeftRight,
  ChevronsRightLeft,
  Copy,
  FolderGit2,
  FolderOpen,
  FolderTree,
  Keyboard,
  Pencil,
  Plus,
  Ungroup,
  X,
} from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  Hint,
  cn,
} from '@angkorgit/design-system';
import {
  chordText,
  groupRepos,
  parseChordId,
  repoGroupIdFor,
  tabClusters,
  type RepoGroup,
  type RepoGroupDropPosition,
} from '@angkorgit/core';
import { pickDirectory } from '@/core/ipc';
import { useRepo } from '@/features/repository/store';
import { activateTab, closeRepoTabs } from '@/features/repository/tabs';
import {
  closeRepoGroup,
  deleteRepoGroup,
  openRepoGroup,
  plural,
  repoGroupColor,
} from '@/features/repository/groups';
import { GroupDot, RepoGroupSubmenu } from '@/features/repository/RepoGroupMenu';
import { useSettings } from '@/features/settings/store';
import { useUi } from '@/features/ui/store';
import { isMac } from '@/shared/utils';

const DRAG_TYPE = 'text/angkorgit-repo-tab';
const GROUP_DRAG_TYPE = 'text/angkorgit-repo-group';
const chipZone = (group: RepoGroup) => `group:${group.id}`;

export function RepoTabs() {
  const repo = useRepo((s) => s.repo);
  const recents = useRepo((s) => s.recents);
  const tabs = useUi((s) => s.repoTabs);
  const worktreeTabs = useUi((s) => s.worktreeTabs);
  const worktreeMains = useUi((s) => s.worktreeMains);
  const tabGroupsCollapsed = useUi((s) => s.tabGroupsCollapsed);
  const toggleTabGroupCollapsed = useUi((s) => s.toggleTabGroupCollapsed);
  const setTabGroupsCollapsed = useUi((s) => s.setTabGroupsCollapsed);
  const shortcuts = useSettings((s) => s.repoShortcuts);
  const groups = useSettings((s) => s.repoGroups);
  const groupOf = useSettings((s) => s.repoGroupOf);
  const setRepoGroup = useSettings((s) => s.setRepoGroup);
  const moveRepoGroup = useSettings((s) => s.moveRepoGroup);
  const [tabMenu, setTabMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const [chipMenu, setChipMenu] = useState<{ x: number; y: number; group: RepoGroup } | null>(null);
  const [draggingTab, setDraggingTab] = useState<string | null>(null);
  const [dropZone, setDropZone] = useState<string | null>(null);
  const [draggingGroup, setDraggingGroup] = useState<string | null>(null);
  const [groupDrop, setGroupDrop] = useState<{ id: string; position: RepoGroupDropPosition } | null>(null);
  const [overflowing, setOverflowing] = useState(false);
  const stripRef = useRef<HTMLDivElement>(null);

  const clusters = tabClusters(tabs, groups, groupOf, worktreeMains);
  const groupIdOf = (path: string) => repoGroupIdFor(path, groupOf, worktreeMains);

  const activePath = repo?.path ?? null;
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip || !activePath) return;
    strip
      .querySelector(`[data-tab-path="${CSS.escape(activePath)}"]`)
      ?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
  }, [activePath, tabs]);

  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const measure = () => setOverflowing(strip.scrollWidth > strip.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    return () => observer.disconnect();
  }, [tabs, tabGroupsCollapsed, groups, groupOf]);

  const activate = (path: string) => void activateTab(path);
  const close = (path: string) => closeRepoTabs([path]);
  const groupIds = clusters.flatMap((cluster) => (cluster.group ? [cluster.group.id] : []));
  const collapseOthers = (keep: string) =>
    setTabGroupsCollapsed(Object.fromEntries(groupIds.map((id) => [id, id !== keep])));
  const expandAll = () => setTabGroupsCollapsed(Object.fromEntries(groupIds.map((id) => [id, false])));
  const anyCollapsed = groupIds.some((id) => tabGroupsCollapsed[id]);

  const addNew = () => {
    void (async () => {
      const dir = await pickDirectory('Open a repository');
      if (!dir) return;
      try {
        await useRepo.getState().open(dir);
      } catch (error) {
        toast.error(
          `Could not open repository: ${(error as { message?: string }).message ?? error}`,
        );
      }
    })();
  };

  const label = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
  const shortcutFor = (path: string) => {
    const chord = shortcuts[path] ? parseChordId(shortcuts[path]) : null;
    return chord ? chordText(chord, isMac) : null;
  };
  const closeOthers = (path: string) => {
    closeRepoTabs(tabs.filter((other) => other !== path));
    if (repo?.path !== path) activate(path);
  };
  const tabTitle = (path: string) => {
    const groupId = groupIdOf(path);
    const group = groupId ? groups.find((g) => g.id === groupId) : undefined;
    return `${path}${group ? ` · ${group.name}` : ''}${worktreeTabs.includes(path) ? ' (worktree)' : ''}`;
  };
  const groupPaths = (group: RepoGroup) => {
    const known = groupRepos(recents, groups, groupOf, worktreeMains)
      .sections.find((section) => section.group.id === group.id)
      ?.repos.map((r) => r.path) ?? [];
    const open = clusters.find((cluster) => cluster.group?.id === group.id)?.tabs ?? [];
    return Array.from(new Set([...known, ...open]));
  };

  const endDrag = () => {
    setDraggingTab(null);
    setDropZone(null);
    setDraggingGroup(null);
    setGroupDrop(null);
  };
  const dragOver = (zone: string) => (e: React.DragEvent) => {
    if (!draggingTab || draggingTab === zone) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropZone !== zone) setDropZone(zone);
  };
  const dragLeave = (zone: string) => () => setDropZone((z) => (z === zone ? null : z));
  const sourceOf = (e: React.DragEvent) => e.dataTransfer.getData(DRAG_TYPE) || draggingTab;
  const dropOnTab = (source: string, target: string, targetGroup: string | null) => {
    if (source === target) return;
    if (groupIdOf(source) !== targetGroup) setRepoGroup(source, targetGroup);
    useUi.getState().moveRepoTab(source, target);
  };
  const dropOnChip = (source: string, group: RepoGroup, first: string | undefined) => {
    if (groupIdOf(source) !== group.id) setRepoGroup(source, group.id);
    if (first && first !== source) useUi.getState().moveRepoTab(source, first);
  };

  const separator = (key: string) => (
    <span
      key={key}
      aria-hidden
      data-tab-separator
      className="mb-2 h-4 w-px shrink-0 bg-border transition-opacity [[aria-selected=true]+&]:opacity-0 [[role=tab]:hover+&]:opacity-0 [&:has(+[aria-selected=true])]:opacity-0 [&:has(+[role=tab]:hover)]:opacity-0"
    />
  );
  const renderRun = (paths: string[], clusterGroup: RepoGroup | null) =>
    paths.flatMap((path, index) => (index === 0 ? [renderTab(path, clusterGroup)] : [separator(`sep:${path}`), renderTab(path, clusterGroup)]));

  const renderTab = (path: string, clusterGroup: RepoGroup | null) => {
    const active = path === repo?.path;
    return (
      <div
        key={path}
        role="tab"
        aria-selected={active}
        data-tab-path={path}
        title={tabTitle(path)}
        draggable
        onDragStart={(e) => {
          setDraggingTab(path);
          e.dataTransfer.setData(DRAG_TYPE, path);
          e.dataTransfer.effectAllowed = 'move';
        }}
        onDragEnd={endDrag}
        onDragOver={dragOver(path)}
        onDragLeave={dragLeave(path)}
        onDrop={(e) => {
          if (!draggingTab) return;
          e.preventDefault();
          const source = sourceOf(e);
          endDrag();
          if (source && source !== path) dropOnTab(source, path, clusterGroup?.id ?? null);
        }}
        onClick={() => activate(path)}
        onContextMenu={(e) => {
          e.preventDefault();
          setTabMenu({ x: e.clientX, y: e.clientY, path });
        }}
        onAuxClick={(e) => {
          if (e.button === 1) close(path); // middle-click closes
        }}
        className={cn(
          'group flex h-8 min-w-0 max-w-44 shrink-0 cursor-default items-center gap-1.5 rounded-t-md border border-b-0 px-3 text-xs',
          active
            ? 'border-border-subtle bg-background text-foreground'
            : 'border-transparent text-muted hover:bg-surface-raised hover:text-foreground',
          draggingTab === path && 'opacity-40',
          dropZone === path && 'ring-1 ring-inset ring-primary/60',
        )}
      >
        {worktreeTabs.includes(path) && (
          <FolderTree
            className={cn('size-3 shrink-0', active ? 'text-primary' : 'text-faint')}
            aria-label="Worktree"
          />
        )}
        <span className="min-w-0 truncate">{label(path)}</span>
        {shortcutFor(path) && (
          <span
            className={cn(
              'inline-flex h-4 shrink-0 items-center rounded px-1 font-mono text-[9px] font-medium tracking-wide text-primary',
              active ? 'bg-primary/20' : 'bg-primary/15',
            )}
            data-tab-shortcut
          >
            {shortcutFor(path)}
          </span>
        )}
        <button
          type="button"
          aria-label={`Close ${label(path)}`}
          className={cn(
            'shrink-0 rounded-sm p-0.5 hover:bg-surface-overlay hover:text-foreground',
            active ? 'text-muted' : 'text-transparent group-hover:text-muted',
          )}
          onClick={(e) => {
            e.stopPropagation();
            close(path);
          }}
        >
          <X className="size-3" />
        </button>
      </div>
    );
  };

  return (
    <div className="flex h-9 shrink-0 items-end gap-0.5 border-b border-border-subtle bg-surface px-2">
      <div
        ref={stripRef}
        className="scrollbar-none flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto"
        onWheel={(e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
            e.currentTarget.scrollLeft += e.deltaY;
          }
        }}
      >
        {clusters.map((cluster) => {
          const group = cluster.group;
          if (!group) return renderRun(cluster.tabs, null);
          const collapsed = !!tabGroupsCollapsed[group.id];
          const shown = collapsed ? cluster.tabs.filter((path) => path === repo?.path) : cluster.tabs;
          const zone = chipZone(group);
          const groupDropHere = groupDrop?.id === group.id ? groupDrop.position : null;
          return (
            <div
              key={group.id}
              data-tab-cluster={group.id}
              data-tab-cluster-collapsed={collapsed || undefined}
              className={cn(
                'relative mr-1.5 flex shrink-0 items-end gap-0.5 pr-1',
                draggingGroup === group.id && 'opacity-40',
                groupDropHere === 'before' && 'shadow-[inset_2px_0_0_0_hsl(var(--primary))]',
                groupDropHere === 'after' && 'shadow-[inset_-2px_0_0_0_hsl(var(--primary))]',
              )}
              onDragOver={(e) => {
                if (!draggingGroup || draggingGroup === group.id) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                const rect = e.currentTarget.getBoundingClientRect();
                const position: RepoGroupDropPosition = e.clientX < rect.left + rect.width / 2 ? 'before' : 'after';
                if (groupDrop?.id !== group.id || groupDrop.position !== position) setGroupDrop({ id: group.id, position });
              }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                setGroupDrop((d) => (d?.id === group.id ? null : d));
              }}
              onDrop={(e) => {
                if (!draggingGroup) return;
                e.preventDefault();
                const moving = e.dataTransfer.getData(GROUP_DRAG_TYPE) || draggingGroup;
                const target = groupDrop;
                endDrag();
                if (moving && moving !== group.id && target?.id === group.id) moveRepoGroup(moving, group.id, target.position);
              }}
            >
              <span
                aria-hidden
                data-tab-cluster-edge
                className="pointer-events-none absolute inset-x-0 top-0 h-0.5 rounded-full"
                style={{ backgroundColor: repoGroupColor(group.color) }}
              />
              <button
                type="button"
                data-tab-group={group.id}
                aria-expanded={!collapsed}
                aria-label={`${group.name}, ${plural(cluster.tabs.length, 'tab')}`}
                title={`${group.name} · ${plural(cluster.tabs.length, 'tab')} · click to ${collapsed ? 'expand' : 'collapse'}`}
                className={cn(
                  'flex h-8 max-w-36 shrink-0 items-center gap-1.5 rounded-t-md px-2.5 text-[11px] font-semibold leading-none transition-opacity hover:opacity-75',
                  dropZone === zone && 'ring-1 ring-inset ring-primary/70',
                )}
                style={{ color: repoGroupColor(group.color) }}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(GROUP_DRAG_TYPE, group.id);
                  e.dataTransfer.effectAllowed = 'move';
                  setDraggingGroup(group.id);
                }}
                onDragEnd={endDrag}
                onClick={() => toggleTabGroupCollapsed(group.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setChipMenu({ x: e.clientX, y: e.clientY, group });
                }}
                onDragOver={dragOver(zone)}
                onDragLeave={dragLeave(zone)}
                onDrop={(e) => {
                  if (!draggingTab) return;
                  e.preventDefault();
                  const source = sourceOf(e);
                  endDrag();
                  if (source) dropOnChip(source, group, cluster.tabs[0]);
                }}
              >
                <span className="truncate">{group.name}</span>
                {collapsed && <span className="shrink-0 font-mono text-[10px] opacity-80">{cluster.tabs.length}</span>}
              </button>
              {renderRun(shown, group)}
            </div>
          );
        })}
      </div>
      {tabMenu && (
        <DropdownMenu open onOpenChange={(o) => !o && setTabMenu(null)}>
          <DropdownMenuTrigger asChild>
            <span style={{ position: 'fixed', left: tabMenu.x, top: tabMenu.y }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom">
            <DropdownMenuLabel className="max-w-72 truncate font-mono">{tabMenu.path}</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => useUi.getState().openDialog('repoShortcut', { repoPath: tabMenu.path })}>
              <Keyboard /> {shortcuts[tabMenu.path] ? 'Change keyboard shortcut…' : 'Keyboard shortcut…'}
            </DropdownMenuItem>
            <RepoGroupSubmenu path={tabMenu.path} />
            <DropdownMenuItem
              onClick={() => {
                void navigator.clipboard.writeText(tabMenu.path);
                toast.success('Path copied');
              }}
            >
              <Copy /> Copy path
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => close(tabMenu.path)}>
              <X /> Close tab
            </DropdownMenuItem>
            <DropdownMenuItem disabled={tabs.length < 2} onClick={() => closeOthers(tabMenu.path)}>
              <X /> Close other tabs
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {chipMenu &&
        (() => {
          const { group } = chipMenu;
          const paths = groupPaths(group);
          const openCount = paths.filter((p) => tabs.includes(p)).length;
          const unopened = paths.length - openCount;
          const collapsed = !!tabGroupsCollapsed[group.id];
          return (
            <DropdownMenu open onOpenChange={(o) => !o && setChipMenu(null)}>
              <DropdownMenuTrigger asChild>
                <span style={{ position: 'fixed', left: chipMenu.x, top: chipMenu.y }} />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="bottom" className="min-w-56">
                <DropdownMenuLabel className="flex items-center gap-1.5">
                  <GroupDot color={group.color} className="-ml-1" />
                  <span className="truncate">{group.name}</span>
                </DropdownMenuLabel>
                <DropdownMenuItem onClick={() => toggleTabGroupCollapsed(group.id)}>
                  {collapsed ? <ChevronsLeftRight /> : <ChevronsRightLeft />} {collapsed ? 'Expand its tabs' : 'Collapse its tabs'}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={groupIds.length < 2} onClick={() => collapseOthers(group.id)}>
                  <ChevronsRightLeft /> Collapse other groups
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!anyCollapsed} onClick={expandAll}>
                  <ChevronsLeftRight /> Expand all groups
                </DropdownMenuItem>
                <DropdownMenuItem disabled={unopened === 0} onClick={() => void openRepoGroup(group, paths)}>
                  <FolderOpen /> Open the rest in tabs
                  <DropdownMenuShortcut>{unopened}</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => closeRepoGroup(group, paths)}>
                  <X /> Close its tabs
                  <DropdownMenuShortcut>{openCount}</DropdownMenuShortcut>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => useUi.getState().openDialog('repoGroup', { groupId: group.id, repoPath: null })}>
                  <Pencil /> Edit group…
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void deleteRepoGroup(group, paths.length)}>
                  <Ungroup /> {paths.length > 0 ? 'Ungroup…' : 'Ungroup'}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })()}
      {overflowing && (
        <DropdownMenu>
          <Hint label="All open tabs">
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="mb-0.5 shrink-0" aria-label="All open tabs" data-tab-overflow>
                <ChevronDown className="size-4" />
              </Button>
            </DropdownMenuTrigger>
          </Hint>
          <DropdownMenuContent
            align="end"
            className="flex max-h-[min(70vh,var(--radix-dropdown-menu-content-available-height))] min-w-64 flex-col"
          >
            <div className="min-h-0 flex-1 overflow-y-auto">
              {clusters.map((cluster) => (
                <div key={cluster.group?.id ?? 'ungrouped'}>
                  {cluster.group ? (
                    <DropdownMenuLabel className="flex items-center gap-1.5">
                      <GroupDot color={cluster.group.color} className="-ml-1" />
                      <span className="truncate">{cluster.group.name}</span>
                    </DropdownMenuLabel>
                  ) : (
                    groups.length > 0 && <DropdownMenuLabel>Other</DropdownMenuLabel>
                  )}
                  {cluster.tabs.map((path) => {
                    const active = path === repo?.path;
                    return (
                      <DropdownMenuItem key={path} onClick={() => activate(path)}>
                        {active ? <Check className="text-primary" /> : <FolderGit2 />}
                        <span className={cn('min-w-0 flex-1 truncate', active && 'text-primary')}>{label(path)}</span>
                      </DropdownMenuItem>
                    );
                  })}
                </div>
              ))}
            </div>
            {groupIds.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem disabled={!anyCollapsed} onClick={expandAll}>
                  <ChevronsLeftRight /> Expand all groups
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={groupIds.every((id) => tabGroupsCollapsed[id])}
                  onClick={() => setTabGroupsCollapsed(Object.fromEntries(groupIds.map((id) => [id, true])))}
                >
                  <ChevronsRightLeft /> Collapse all groups
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <Hint label="Open another repository">
        <Button
          variant="ghost"
          size="icon-sm"
          className="mb-0.5 shrink-0"
          aria-label="Open another repository"
          onClick={addNew}
        >
          <Plus className="size-4" />
        </Button>
      </Hint>
    </div>
  );
}
