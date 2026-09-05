import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { toastOutcome } from '@/shared/toastOutcome';
import {
  AlertTriangle,
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  Check,
  ChevronRight,
  ChevronsDownUp,
  Cloud,
  Copy,
  Eraser,
  Folder,
  FolderGit2,
  FolderOpen,
  FolderTree,
  GitBranch,
  FastForward,
  GitMerge,
  GitPullRequest,
  Home,
  MoveRight,
  ListRestart,
  Lock,
  MoreHorizontal,
  GitBranchPlus,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Tag as TagIcon,
  Trash2,
  Undo2,
} from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Hint,
  Input,
  Logo,
  cn,
} from '@angkorgit/design-system';
import { ipc, openExternal } from '@/core/ipc';
import { confirmDialog } from '@/components/confirm';
import { useRepo } from '@/features/repository/store';
import { useGraph } from '@/features/graph/store';
import { useUi } from '@/features/ui/store';
import { useUndo, type UndoKind } from '@/features/history/undoStore';
import { useForge } from '@/features/forge/store';
import { useSettings } from '@/features/settings/store';
import { forgeNoun, pullRequestCheckoutSpec } from '@angkorgit/core';
import type { BranchInfo, PullRequestInfo, RemoteInfo, StashInfo, SubmoduleInfo, TagInfo, WorktreeInfo } from '@angkorgit/core';
import { capCount, isMac } from '@/shared/utils';
import { killTerminalSession } from '@/features/terminal/sessions';

interface BranchTreeNode {
  key: string;
  path: string;
  branch?: BranchInfo;
  children: BranchTreeNode[];
}

function buildBranchTree(branches: BranchInfo[]): BranchTreeNode[] {
  const root: BranchTreeNode = { key: '', path: '', children: [] };
  const folders = new Map<string, BranchTreeNode>([['', root]]);
  for (const branch of branches) {
    const segments = branch.name.split('/');
    let parentPath = '';
    for (let i = 0; i < segments.length - 1; i++) {
      const folderPath = parentPath ? `${parentPath}/${segments[i]}` : segments[i];
      if (!folders.has(folderPath)) {
        const node: BranchTreeNode = { key: segments[i], path: folderPath, children: [] };
        folders.get(parentPath)?.children.push(node);
        folders.set(folderPath, node);
      }
      parentPath = folderPath;
    }
    folders.get(parentPath)?.children.push({
      key: segments[segments.length - 1],
      path: branch.name,
      branch,
      children: [],
    });
  }
  const sortNodes = (nodes: BranchTreeNode[]) => {
    nodes.sort((a, b) => (a.branch ? 1 : 0) - (b.branch ? 1 : 0) || a.key.localeCompare(b.key));
    nodes.forEach((n) => sortNodes(n.children));
  };
  sortNodes(root.children);
  return root.children;
}

function leafCount(node: BranchTreeNode): number {
  return node.branch ? 1 : node.children.reduce((sum, child) => sum + leafCount(child), 0);
}

function ancestorFolders(branchName: string): string[] {
  const segments = branchName.split('/');
  segments.pop();
  const paths: string[] = [];
  let acc = '';
  for (const segment of segments) {
    acc = acc ? `${acc}/${segment}` : segment;
    paths.push(acc);
  }
  return paths;
}

function HeadMark({ active }: { active: boolean }) {
  return (
    <span className="flex size-3.5 shrink-0 items-center justify-center">
      {active && <Check className="size-3.5" />}
    </span>
  );
}

const outcomeOk = (result: unknown) => {
  const status = (result as { status?: string } | undefined)?.status;
  return status === undefined || status === 'ok' || status === 'fast_forward';
};

const FLAT_FILTER_CAP = 300;

export const SIDEBAR_SECTIONS = [
  'branches',
  'worktrees',
  'pullRequests',
  'remotes',
  'tags',
  'stashes',
  'submodules',
] as const;

function Section({
  icon,
  title,
  count,
  children,
  open,
  onToggle,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  children: React.ReactNode;
  open: boolean;
  onToggle: () => void;
  action?: React.ReactNode;
}) {
  return (
    <div className="mb-1">
      <div className="group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted hover:bg-surface-raised">
        <button
          className="flex min-w-0 flex-1 items-center gap-1.5"
          aria-expanded={open}
          onClick={onToggle}
        >
          <ChevronRight className={cn('size-3.5 shrink-0 transition-transform duration-150', open && 'rotate-90')} />
          {icon}
          <span className="truncate">{title}</span>
          <span className="text-faint">{count}</span>
        </button>
        {action && <span className="opacity-0 transition-opacity group-hover:opacity-100">{action}</span>}
      </div>
      {open && <div className="mt-0.5">{children}</div>}
    </div>
  );
}

export function Sidebar() {
  const repo = useRepo((s) => s.repo);
  const branches = useRepo((s) => s.branches);
  const tags = useRepo((s) => s.tags);
  const stashes = useRepo((s) => s.stashes);
  const remotes = useRepo((s) => s.remotes);
  const submodules = useRepo((s) => s.submodules);
  const worktrees = useRepo((s) => s.worktrees);
  const status = useRepo((s) => s.status);
  const refresh = useRepo((s) => s.refresh);
  const repoRefreshing = useRepo((s) => s.refreshing);
  const graphReload = useGraph((s) => s.reload);
  const setFilters = useGraph((s) => s.setFilters);
  const filters = useGraph((s) => s.filters);
  const openDialog = useUi((s) => s.openDialog);
  const sidebarSections = useUi((s) => s.sidebarSections);
  const setSidebarSection = useUi((s) => s.setSidebarSection);
  const collapseEpoch = useUi((s) => s.sidebarCollapseEpoch);
  const sectionDefaults: Record<(typeof SIDEBAR_SECTIONS)[number], boolean> = {
    branches: true,
    worktrees: true,
    pullRequests: true,
    remotes: false,
    tags: false,
    stashes: stashes.length > 0,
    submodules: false,
  };
  const sectionOpen = (id: (typeof SIDEBAR_SECTIONS)[number]) => sidebarSections[id] ?? sectionDefaults[id];
  const section = (id: (typeof SIDEBAR_SECTIONS)[number]) => ({
    open: sectionOpen(id),
    onToggle: () => setSidebarSection(id, !sectionOpen(id)),
  });
  const [query, setQuery] = useState('');
  const [filterQuery, setFilterQuery] = useState('');
  useEffect(() => {
    const handle = window.setTimeout(() => setFilterQuery(query), 150);
    return () => window.clearTimeout(handle);
  }, [query]);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dropAction, setDropAction] = useState<{ source: string; target: string; canFf?: boolean } | null>(null);
  const [branchMenu, setBranchMenu] = useState<{ x: number; y: number; branch: BranchInfo } | null>(null);
  const [subMenu, setSubMenu] = useState<{ x: number; y: number; sub: SubmoduleInfo } | null>(null);
  const [remoteMenu, setRemoteMenu] = useState<{ x: number; y: number; remote: RemoteInfo } | null>(null);
  const [worktreeMenu, setWorktreeMenu] = useState<{ x: number; y: number; worktree: WorktreeInfo } | null>(null);
  const [stashMenu, setStashMenu] = useState<{ x: number; y: number; stash: StashInfo } | null>(null);
  const [tagMenu, setTagMenu] = useState<{ x: number; y: number; tag: TagInfo } | null>(null);
  const [prMenu, setPrMenu] = useState<{ x: number; y: number; pr: PullRequestInfo } | null>(null);
  const [editRemote, setEditRemote] = useState<{ original: string; name: string; url: string } | null>(null);
  const [savingRemote, setSavingRemote] = useState(false);

  const openSubmodule = (sub: SubmoduleInfo) => {
    void useRepo
      .getState()
      .open(`${path}/${sub.path}`)
      .catch(() =>
        toast.error(
          `Could not open ${sub.path} — the submodule may not be initialized. Run "Update" on it first.`,
        ),
      );
  };

  const path = repo?.path ?? '';

  const heldBy = useMemo(() => {
    const map = new Map<string, WorktreeInfo>();
    for (const wt of worktrees) if (wt.branch && !wt.isCurrent) map.set(wt.branch, wt);
    return map;
  }, [worktrees]);
  const worktreeDirty = (wt: WorktreeInfo) =>
    wt.isCurrent ? (status?.files.length ?? 0) > 0 : wt.isDirty === true;
  const openWorktree = (wt: WorktreeInfo) => {
    if (wt.isCurrent || wt.isMissing) return;
    void useRepo
      .getState()
      .open(wt.path)
      .catch((error) =>
        toast.error(`Could not open ${wt.name}: ${(error as { message?: string }).message ?? error}`),
      );
  };

  const refreshAll = async () => {
    await refresh();
    await graphReload(path);
  };

  const act = async (
    label: string,
    op: () => Promise<unknown>,
    undoable?: { kind: UndoKind; extra?: Record<string, string> },
  ) => {
    try {
      const result = undoable
        ? await useUndo.getState().tracked({
            path,
            kind: undoable.kind,
            label,
            extra: undoable.extra,
            action: op,
            shouldRecord: outcomeOk,
          })
        : await op();
      toastOutcome(result as { status?: string; message?: string } | undefined, `${label} done`);
      await refreshAll();
    } catch (error) {
      toast.error(`${label} failed: ${(error as { message?: string }).message ?? error}`);
    }
  };

  const removeWorktree = async (wt: WorktreeInfo) => {
    if (wt.isMain) return;
    if (wt.isMissing) {
      await act(`Forget ${wt.name}`, () => ipc.worktreeRemove(path, wt.name, false));
      return;
    }
    const dirty = worktreeDirty(wt);
    const branchNote = wt.branch ? ` The branch ${wt.branch} and its commits stay in the repository.` : ' Commits stay in the repository.';
    const ok = await confirmDialog({
      title: `Remove worktree "${wt.name}"?`,
      description: dirty
        ? `This folder has uncommitted changes. Removing it deletes the folder and everything in it.${branchNote}`
        : `The folder is deleted.${branchNote}`,
      path: wt.path,
      confirmLabel: dirty ? 'Delete changes and remove' : 'Remove worktree',
      destructive: true,
    });
    if (!ok) return;
    if (!wt.isCurrent) {
      await act(`Remove worktree ${wt.name}`, () => ipc.worktreeRemove(path, wt.name, dirty));
      return;
    }
    const main = worktrees.find((w) => w.isMain);
    if (!main) return;
    try {
      await useRepo.getState().open(main.path);
    } catch (error) {
      toast.error(`Could not switch to ${main.name}: ${(error as { message?: string }).message ?? error}`);
      return;
    }
    useUi.getState().closeRepoTab(wt.path);
    killTerminalSession(wt.path);
    try {
      await ipc.worktreeRemove(main.path, wt.name, dirty);
      toast.success(`Removed worktree ${wt.name}`);
      await useRepo.getState().refresh();
      await graphReload(main.path);
    } catch (error) {
      toast.error(`Remove worktree failed: ${(error as { message?: string }).message ?? error}`);
    }
  };

  const dropMerge = async (source: string, target: string, noFf: boolean) => {
    setDropAction(null);
    try {
      const info = await ipc.repoInfo(path);
      if (info.headBranch !== target) {
        await useUndo.getState().tracked({
          path,
          kind: 'checkout',
          label: `Checkout ${target}`,
          action: () => ipc.checkout(path, target),
        });
      }
      await act(`Merge ${source} into ${target}`, () => ipc.merge(path, source, noFf), { kind: 'merge' });
    } catch (error) {
      toast.error(`Merge failed: ${(error as { message?: string }).message ?? error}`);
    }
  };

  const dropRebase = async (source: string, target: string) => {
    setDropAction(null);
    try {
      const info = await ipc.repoInfo(path);
      if (info.headBranch !== source) {
        await useUndo.getState().tracked({
          path,
          kind: 'checkout',
          label: `Checkout ${source}`,
          action: () => ipc.checkout(path, source),
        });
      }
      await act(`Rebase ${source} onto ${target}`, () => ipc.rebase(path, target), { kind: 'rebase' });
    } catch (error) {
      toast.error(`Rebase failed: ${(error as { message?: string }).message ?? error}`);
    }
  };

  const forgeRepoPath = useForge((s) => s.repoPath);
  const forgeRemote = useForge((s) => s.remote);
  const forgeRemoteName = useForge((s) => s.remoteName);
  const forgeAccount = useForge((s) => s.hasAccount);
  const forgePrs = useForge((s) => s.prs);
  const forgeLoading = useForge((s) => s.loading);
  const forgeError = useForge((s) => s.error);
  const forgeErrorDetail = useForge((s) => s.errorDetail);
  const forgeLoadedAt = useForge((s) => s.loadedAt);
  const showPullRequests = useSettings((s) => s.showPullRequests);

  const checkoutPullRequest = (pr: PullRequestInfo) => {
    const spec = forgeRemote ? pullRequestCheckoutSpec(forgeRemote.kind, pr) : null;
    if (!spec) {
      toast.error(
        `This ${forgeNoun(forgeRemote?.kind)} cannot be checked out from AngKorGit — open it in the browser instead.`,
      );
      return;
    }
    void act(
      `Checkout #${pr.number}`,
      () =>
        ipc.prCheckout(path, forgeRemoteName ?? 'origin', spec.sourceRef, spec.localBranch, spec.track),
      { kind: 'checkout' },
    );
  };

  const q = filterQuery.trim().toLowerCase();
  const locals = useMemo(
    () => branches.filter((b) => !b.isRemote && (!q || b.name.toLowerCase().includes(q))),
    [branches, q],
  );
  const remoteBranches = useMemo(
    () => branches.filter((b) => b.isRemote && (!q || b.name.toLowerCase().includes(q))),
    [branches, q],
  );
  const filteredTags = useMemo(() => tags.filter((t) => !q || t.name.toLowerCase().includes(q)), [tags, q]);
  const filteredWorktrees = useMemo(
    () =>
      worktrees.filter(
        (w) => !q || w.name.toLowerCase().includes(q) || (w.branch ?? '').toLowerCase().includes(q),
      ),
    [worktrees, q],
  );
  const filteredPrs = useMemo(
    () =>
      forgePrs.filter(
        (pr) =>
          !q ||
          pr.title.toLowerCase().includes(q) ||
          pr.sourceBranch.toLowerCase().includes(q) ||
          `#${pr.number}`.includes(q),
      ),
    [forgePrs, q],
  );

  const localTree = useMemo(() => buildBranchTree(locals), [locals]);
  const remoteTree = useMemo(() => buildBranchTree(remoteBranches), [remoteBranches]);

  const noFilterMatches =
    q !== '' &&
    locals.length === 0 &&
    remoteBranches.length === 0 &&
    filteredTags.length === 0 &&
    stashes.length === 0;
  const hasRemoteBranches = branches.some((b) => b.isRemote);

  const submitEditRemote = async () => {
    const edit = editRemote;
    if (!edit || !edit.name.trim() || !edit.url.trim() || savingRemote) return;
    setSavingRemote(true);
    await act(`Update remote ${edit.original}`, () => ipc.remoteEdit(path, edit.original, edit.name, edit.url));
    setSavingRemote(false);
    setEditRemote(null);
  };

  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  useEffect(() => {
    const head = branches.find((b) => b.isHead);
    if (!head) return;
    const paths = ancestorFolders(head.name);
    if (paths.length > 0) {
      setExpandedFolders((prev) =>
        paths.every((p) => prev.has(p)) ? prev : new Set([...prev, ...paths]),
      );
    }
  }, [branches]);
  useEffect(() => {
    if (collapseEpoch > 0) setExpandedFolders(new Set());
  }, [collapseEpoch]);
  const anySectionOpen = SIDEBAR_SECTIONS.some(sectionOpen);
  const collapseAll = () => {
    useUi.getState().collapseSidebarSections(SIDEBAR_SECTIONS);
    setExpandedFolders(new Set());
  };
  const toggleFolder = (folderPath: string) =>
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });

  if (!repo) return null;

  const branchMenuLocalName = branchMenu
    ? branchMenu.branch.isRemote
      ? branchMenu.branch.name.split('/').slice(1).join('/')
      : branchMenu.branch.name
    : '';
  const branchMenuHeld = branchMenu ? heldBy.get(branchMenuLocalName) : undefined;

  const renderWorktree = (wt: WorktreeInfo) => {
    const dirty = worktreeDirty(wt);
    const subtitle = wt.isMissing
      ? 'folder missing'
      : wt.isDetached
        ? `detached @ ${wt.headOid?.slice(0, 8) ?? '?'}`
        : wt.branch ?? 'no branch';
    return (
      <div
        key={wt.path}
        role="button"
        tabIndex={0}
        onClick={() => openWorktree(wt)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') openWorktree(wt);
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          setWorktreeMenu({ x: e.clientX, y: e.clientY, worktree: wt });
        }}
        className={cn(
          'group flex items-center gap-2 rounded-md px-2 py-1 pl-7 text-sm hover:bg-surface-raised',
          wt.isCurrent ? 'cursor-default text-primary' : wt.isMissing ? 'cursor-default text-muted' : 'cursor-pointer',
        )}
        title={
          wt.isMissing
            ? `${wt.path} — this folder no longer exists`
            : wt.isCurrent
              ? `${wt.path} — open in this tab`
              : `${wt.path} — click to switch to this worktree`
        }
      >
        <HeadMark active={wt.isCurrent} />
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate">{wt.name}</span>
            {wt.isMain && <Home className="size-3 shrink-0 text-faint" aria-label="Main worktree" />}
            {wt.isLocked && <Lock className="size-3 shrink-0 text-faint" aria-label="Locked" />}
            {wt.isMissing ? (
              <AlertTriangle className="size-3 shrink-0 text-danger" aria-label="Folder missing" />
            ) : dirty ? (
              <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-label="Uncommitted changes" />
            ) : null}
          </span>
          <span className="truncate font-mono text-[10px] text-faint">{subtitle}</span>
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          className="shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
          aria-label={`${wt.name} actions`}
          onClick={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            setWorktreeMenu({ x: rect.left, y: rect.bottom + 4, worktree: wt });
          }}
        >
          <MoreHorizontal className="size-3.5" />
        </Button>
      </div>
    );
  };

  const renderLocalBranch = (branch: BranchInfo, label: string, depth: number) => (
    <div
      key={branch.name}
      draggable
      onDragStart={(e) => {
        setDragging(branch.name);
        e.dataTransfer.setData('text/angkorgit-branch', branch.name);
        e.dataTransfer.effectAllowed = 'link';
      }}
      onDragEnd={() => {
        setDragging(null);
        setDropTarget(null);
      }}
      onDragOver={(e) => {
        const source = dragging;
        if (source && source !== branch.name) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'link';
          setDropTarget((t) => (t === branch.name ? t : branch.name));
        }
      }}
      onDragLeave={() => setDropTarget((t) => (t === branch.name ? null : t))}
      onDrop={(e) => {
        e.preventDefault();
        const source = e.dataTransfer.getData('text/angkorgit-branch');
        setDropTarget(null);
        setDragging(null);
        if (source && source !== branch.name) {
          const target = branch.name;
          setDropAction({ source, target });
          void ipc
            .mergeCanFastForward(path, target, source)
            .then((canFf) => {
              setDropAction((cur) =>
                cur && cur.source === source && cur.target === target ? { ...cur, canFf } : cur,
              );
            })
            .catch(() => undefined);
        }
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setBranchMenu({ x: e.clientX, y: e.clientY, branch });
      }}
      style={{ paddingLeft: 28 + depth * 14 }}
      className={cn(
        'group flex cursor-grab items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-surface-raised active:cursor-grabbing',
        branch.isHead && 'text-primary',
        filters.branch === branch.name && 'bg-surface-raised',
        dragging === branch.name && 'opacity-40',
        dropTarget === branch.name && 'bg-primary/10 ring-1 ring-inset ring-primary/60',
      )}
      title={`${branch.name} — drag onto another branch to merge or rebase`}
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onDoubleClick={() => {
          const held = heldBy.get(branch.name);
          if (held) openWorktree(held);
          else void act(`Checkout ${branch.name}`, () => ipc.checkout(path, branch.name), { kind: 'checkout' });
        }}
        onClick={() => setFilters(path, { branch: filters.branch === branch.name ? '' : branch.name })}
        title={
          heldBy.has(branch.name)
            ? `${branch.name} — checked out in worktree ${heldBy.get(branch.name)?.name}; double-click to switch there`
            : `${branch.name} — click to filter graph, double-click to checkout`
        }
      >
        <HeadMark active={branch.isHead} />
        <span className="min-w-0 truncate">{label}</span>
        {heldBy.has(branch.name) && (
          <FolderTree
            className="size-3 shrink-0 text-faint"
            aria-label={`Checked out in worktree ${heldBy.get(branch.name)?.name}`}
          />
        )}
        {branch.ahead > 0 && <Badge tone="primary">↑{capCount(branch.ahead)}</Badge>}
        {branch.behind > 0 && <Badge tone="info">↓{capCount(branch.behind)}</Badge>}
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
        aria-label={`${branch.name} actions`}
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          setBranchMenu({ x: rect.left, y: rect.bottom + 4, branch });
        }}
      >
        <MoreHorizontal className="size-3.5" />
      </Button>
    </div>
  );

  const renderRemoteBranch = (branch: BranchInfo, label: string, depth: number) => (
    <div
      key={branch.name}
      draggable
      onDragStart={(e) => {
        setDragging(branch.name);
        e.dataTransfer.setData('text/angkorgit-branch', branch.name);
        e.dataTransfer.effectAllowed = 'link';
      }}
      onDragEnd={() => {
        setDragging(null);
        setDropTarget(null);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        setBranchMenu({ x: e.clientX, y: e.clientY, branch });
      }}
      style={{ paddingLeft: 28 + depth * 14 }}
      className={cn(
        'group flex cursor-grab items-center gap-2 rounded-md px-2 py-1 text-sm text-muted hover:bg-surface-raised active:cursor-grabbing',
        dragging === branch.name && 'opacity-40',
      )}
      title={`${branch.name} — drag onto a local branch to merge or rebase`}
    >
      <button
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
        onDoubleClick={() => void act(`Checkout ${branch.name}`, () => ipc.checkout(path, branch.name), { kind: 'checkout' })}
        title={`${branch.name} — double-click to checkout`}
      >
        <HeadMark active={false} />
        <span className="min-w-0 truncate">{label}</span>
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
        aria-label={`${branch.name} actions`}
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          setBranchMenu({ x: rect.left, y: rect.bottom + 4, branch });
        }}
      >
        <MoreHorizontal className="size-3.5" />
      </Button>
    </div>
  );

  const renderTree = (nodes: BranchTreeNode[], depth: number, kind: 'local' | 'remote'): React.ReactNode =>
    nodes.map((node) => {
      if (node.branch) {
        return kind === 'local'
          ? renderLocalBranch(node.branch, node.key, depth)
          : renderRemoteBranch(node.branch, node.key, depth);
      }
      const expanded = expandedFolders.has(node.path);
      const remote = kind === 'remote' && depth === 0 ? remotes.find((r) => r.name === node.key) : undefined;
      return (
        <div key={`folder:${node.path}`}>
          <div
            className="group flex items-center rounded-md hover:bg-surface-raised"
            onContextMenu={
              remote
                ? (e) => {
                    e.preventDefault();
                    setRemoteMenu({ x: e.clientX, y: e.clientY, remote });
                  }
                : undefined
            }
          >
            <button
              className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted"
              style={{ paddingLeft: 10 + depth * 14 }}
              onClick={() => toggleFolder(node.path)}
              title={remote ? `${remote.name} — ${remote.url}` : node.path}
            >
              <ChevronRight
                className={cn('size-3.5 shrink-0 text-faint transition-transform duration-150', expanded && 'rotate-90')}
              />
              {remote ? (
                <Cloud className={cn('size-3.5 shrink-0', expanded ? 'text-primary/70' : 'text-faint')} />
              ) : expanded ? (
                <FolderOpen className="size-3.5 shrink-0 text-primary/70" />
              ) : (
                <Folder className="size-3.5 shrink-0 text-faint" />
              )}
              <span className="min-w-0 truncate">{node.key}</span>
              <span className="text-[10px] text-faint">{leafCount(node)}</span>
            </button>
            {remote && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="mr-0.5 shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                aria-label={`Remote ${remote.name} actions`}
                onClick={(e) => {
                  e.stopPropagation();
                  const rect = e.currentTarget.getBoundingClientRect();
                  setRemoteMenu({ x: rect.left, y: rect.bottom + 4, remote });
                }}
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            )}
          </div>
          {expanded && renderTree(node.children, depth + 1, kind)}
        </div>
      );
    });

  const renderBranchlessRemote = (remote: RemoteInfo) => (
    <div
      key={`remote:${remote.name}`}
      className="group flex items-center rounded-md hover:bg-surface-raised"
      onContextMenu={(e) => {
        e.preventDefault();
        setRemoteMenu({ x: e.clientX, y: e.clientY, remote });
      }}
    >
      <div
        className="flex min-w-0 flex-1 items-center gap-1.5 px-2 py-1 text-sm text-muted"
        style={{ paddingLeft: 10 }}
        title={`${remote.name} — ${remote.url} (no branches fetched yet)`}
      >
        <span className="size-3.5 shrink-0" />
        <Cloud className="size-3.5 shrink-0 text-faint" />
        <span className="min-w-0 truncate">{remote.name}</span>
        <span className="text-[10px] text-faint">0</span>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        className="mr-0.5 shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
        aria-label={`Remote ${remote.name} actions`}
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          setRemoteMenu({ x: rect.left, y: rect.bottom + 4, remote });
        }}
      >
        <MoreHorizontal className="size-3.5" />
      </Button>
    </div>
  );

  return (
    <aside className="flex h-full flex-col bg-surface" aria-label="Branches and refs">
      <div className="flex items-center gap-1 p-2">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter refs…"
            className="h-7 border-transparent bg-surface-raised pl-8 text-xs"
          />
        </div>
        <Hint label="Collapse all sections">
          <Button
            variant="ghost"
            size="icon-sm"
            className="shrink-0 text-faint hover:text-foreground"
            aria-label="Collapse all sections"
            disabled={!anySectionOpen && expandedFolders.size === 0}
            onClick={collapseAll}
          >
            <ChevronsDownUp className="size-3.5" />
          </Button>
        </Hint>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <Section
          {...section('branches')}
          icon={<GitBranch className="size-3.5" />}
          title="Branches"
          count={locals.length}
          action={
            <Hint label="New branch">
              <Button variant="ghost" size="icon-sm" aria-label="New branch" onClick={() => openDialog('createBranch')}>
                <Plus className="size-3.5" />
              </Button>
            </Hint>
          }
        >
          {repoRefreshing && locals.length === 0 && (
            <div className="flex flex-col gap-1.5 py-1 pl-7 pr-3">
              {[0, 1, 2].map((i) => (
                <div key={i} className="h-4 animate-pulse rounded bg-surface-raised" />
              ))}
            </div>
          )}
          {q
            ? locals.slice(0, FLAT_FILTER_CAP).map((branch) => renderLocalBranch(branch, branch.name, 0))
            : renderTree(localTree, 0, 'local')}
          {q && locals.length > FLAT_FILTER_CAP && (
            <div className="px-2 py-1 pl-7 text-xs text-faint">+{locals.length - FLAT_FILTER_CAP} more…</div>
          )}
          {noFilterMatches && <div className="px-2 py-1 pl-7 text-xs text-faint">No refs match the filter.</div>}
        </Section>

        <Section
          {...section('worktrees')}
          icon={<FolderTree className="size-3.5" />}
          title="Worktrees"
          count={worktrees.length}
          action={
            <span className="flex items-center">
              {worktrees.some((w) => w.isMissing) && (
                <Hint label="Forget worktrees whose folder is gone">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Prune missing worktrees"
                    onClick={() => void act('Prune worktrees', () => ipc.worktreePrune(path))}
                  >
                    <Eraser className="size-3.5" />
                  </Button>
                </Hint>
              )}
              <Hint label="New worktree">
                <Button variant="ghost" size="icon-sm" aria-label="New worktree" onClick={() => openDialog('createWorktree')}>
                  <Plus className="size-3.5" />
                </Button>
              </Hint>
            </span>
          }
        >
          {repoRefreshing && worktrees.length === 0 && (
            <div className="flex flex-col gap-1.5 py-1 pl-7 pr-3">
              {[0, 1].map((i) => (
                <div key={i} className="h-4 animate-pulse rounded bg-surface-raised" />
              ))}
            </div>
          )}
          {!repoRefreshing && worktrees.length <= 1 && (
            <div className="mx-1 mb-1 mt-0.5 flex flex-col gap-2 rounded-lg border border-dashed border-border-subtle bg-surface-raised/40 p-3">
              <div className="flex items-start gap-2.5">
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
                  <FolderTree className="size-3.5" />
                </span>
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="text-xs font-medium text-foreground">Two branches, two folders</span>
                  <span className="text-[11px] leading-relaxed text-muted">
                    Fix a bug or run an agent beside your work. No stashing.
                  </span>
                </span>
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="w-full justify-center"
                onClick={() => openDialog('createWorktree')}
              >
                <Plus className="size-3.5" /> New worktree
              </Button>
            </div>
          )}
          {worktrees.length > 1 && filteredWorktrees.map(renderWorktree)}
          {worktrees.length > 1 && q && filteredWorktrees.length === 0 && (
            <div className="px-2 py-1 pl-7 text-xs text-faint">No worktrees match the filter.</div>
          )}
        </Section>

        {forgeRemote && showPullRequests && forgeRepoPath === repo.path && (
          <Section
            {...section('pullRequests')}
            icon={<GitPullRequest className="size-3.5" />}
            title={forgeNoun(forgeRemote.kind, { plural: true, capitalize: true })}
            count={filteredPrs.length}
            action={
              <span className="flex items-center">
                <Hint label="Refresh pull requests">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Refresh pull requests"
                    onClick={() => void useForge.getState().load(true)}
                  >
                    <RefreshCw className={cn('size-3.5', forgeLoading && 'animate-spin')} />
                  </Button>
                </Hint>
                <Hint label="Create pull request">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Create pull request"
                    onClick={() => openDialog('createPullRequest')}
                  >
                    <Plus className="size-3.5" />
                  </Button>
                </Hint>
              </span>
            }
          >
            {!forgeAccount && forgeLoadedAt !== null && (
              <button
                className="w-full rounded-md px-2 py-1 pl-7 text-left text-xs text-muted [overflow-wrap:anywhere] hover:bg-surface-raised"
                onClick={() => openDialog('settings')}
              >
                Connect a {forgeRemote.host} account in Settings → Authentication to see{' '}
                {forgeNoun(forgeRemote.kind, { plural: true })}.
              </button>
            )}
            {forgeAccount && forgeError && (
              <button
                className="w-full rounded-md px-2 py-1 pl-7 text-left text-xs text-muted [overflow-wrap:anywhere] hover:bg-surface-raised"
                title={forgeErrorDetail ?? forgeError}
                onClick={() => void useForge.getState().load(true)}
              >
                {forgeError}
                <span className="mt-0.5 block text-primary">Click to retry</span>
              </button>
            )}
            {forgeAccount && !forgeError && filteredPrs.length === 0 && !forgeLoading && (
              <div className="px-2 py-1 pl-7 text-xs text-faint">
                No open {forgeNoun(forgeRemote.kind, { plural: true })}
              </div>
            )}
            {forgeLoading && filteredPrs.length === 0 && (
              <div className="flex items-center gap-2 px-2 py-1 pl-7 text-xs text-faint">
                <Logo size={14} animated="loop" className="logo-draw-loop shrink-0" />
                Loading…
              </div>
            )}
            {filteredPrs.map((pr) => (
              <div
                key={pr.number}
                className="group flex items-center gap-2 rounded-md px-2 py-1 pl-7 text-sm hover:bg-surface-raised"
                title={`#${pr.number} ${pr.title} — ${pr.author} wants to merge ${pr.sourceBranch} into ${pr.targetBranch}. Double-click to check out, right-click for actions.`}
                onDoubleClick={() => checkoutPullRequest(pr)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setPrMenu({ x: e.clientX, y: e.clientY, pr });
                }}
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-faint">#{pr.number}</span> {pr.title}
                </span>
                {pr.isDraft && <Badge>Draft</Badge>}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                  aria-label={`Pull request #${pr.number} actions`}
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    setPrMenu({ x: rect.left, y: rect.bottom + 4, pr });
                  }}
                >
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </div>
            ))}
          </Section>
        )}

        <Section {...section('remotes')} icon={<Cloud className="size-3.5" />} title="Remotes" count={remoteBranches.length}>
          {remotes.length === 0 && !hasRemoteBranches && !repoRefreshing && (
            <div className="px-2 py-1 pl-7 text-xs text-faint">No remotes yet.</div>
          )}
          {q
            ? remoteBranches.slice(0, FLAT_FILTER_CAP).map((branch) => renderRemoteBranch(branch, branch.name, 0))
            : renderTree(remoteTree, 0, 'remote')}
          {q && remoteBranches.length > FLAT_FILTER_CAP && (
            <div className="px-2 py-1 pl-7 text-xs text-faint">+{remoteBranches.length - FLAT_FILTER_CAP} more…</div>
          )}
          {!q &&
            remotes
              .filter((r) => !remoteTree.some((node) => !node.branch && node.key === r.name))
              .map(renderBranchlessRemote)}
        </Section>

        <Section
          icon={<TagIcon className="size-3.5" />}
          title="Tags"
          count={filteredTags.length}
          {...section('tags')}
          action={
            <Hint label="New tag">
              <Button variant="ghost" size="icon-sm" aria-label="New tag" onClick={() => openDialog('createTag')}>
                <Plus className="size-3.5" />
              </Button>
            </Hint>
          }
        >
          {tags.length === 0 && !repoRefreshing && (
            <div className="px-2 py-1 pl-7 text-xs text-faint">No tags yet.</div>
          )}
          {filteredTags.map((tag) => (
            <div
              key={tag.name}
              className="group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 pl-7 text-sm hover:bg-surface-raised"
              onClick={() => useGraph.getState().select(tag.targetOid)}
              onContextMenu={(e) => {
                e.preventDefault();
                setTagMenu({ x: e.clientX, y: e.clientY, tag });
              }}
            >
              <span
                className="min-w-0 flex-1 truncate"
                title={`${tag.message ?? tag.name} — click to show the commit, right-click for actions`}
              >
                {tag.name}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                aria-label={`${tag.name} actions`}
                onClick={(e) => {
                  e.stopPropagation();
                  const rect = e.currentTarget.getBoundingClientRect();
                  setTagMenu({ x: rect.left, y: rect.bottom + 4, tag });
                }}
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </div>
          ))}
        </Section>

        <Section
          icon={<Archive className="size-3.5" />}
          title="Stashes"
          count={stashes.length}
          {...section('stashes')}
          action={
            <Hint label="New stash">
              <Button variant="ghost" size="icon-sm" aria-label="New stash" onClick={() => openDialog('createStash')}>
                <Plus className="size-3.5" />
              </Button>
            </Hint>
          }
        >
          {stashes.length === 0 && !repoRefreshing && (
            <div className="px-2 py-1 pl-7 text-xs text-faint">Nothing stashed.</div>
          )}
          {stashes.map((stash) => (
            <div
              key={stash.oid}
              className="group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 pl-7 text-sm hover:bg-surface-raised"
              onClick={() => useGraph.getState().select(stash.oid)}
              onContextMenu={(e) => {
                e.preventDefault();
                setStashMenu({ x: e.clientX, y: e.clientY, stash });
              }}
            >
              <span className="min-w-0 flex-1 truncate" title={`${stash.message} — click to preview, right-click for actions`}>
                {stash.message}
              </span>
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                aria-label="Stash actions"
                onClick={(e) => {
                  e.stopPropagation();
                  const rect = e.currentTarget.getBoundingClientRect();
                  setStashMenu({ x: rect.left, y: rect.bottom + 4, stash });
                }}
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </div>
          ))}
        </Section>

        {submodules.length > 0 && (
          <Section {...section('submodules')} icon={<Boxes className="size-3.5" />} title="Submodules" count={submodules.length}>
            {submodules.map((sub) => (
              <div
                key={sub.name}
                className="group flex cursor-default items-center gap-2 rounded-md px-2 py-1 pl-7 text-sm text-muted hover:bg-surface-raised"
                title={sub.url ?? sub.path}
                onDoubleClick={() => openSubmodule(sub)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setSubMenu({ x: e.clientX, y: e.clientY, sub });
                }}
              >
                <span className="min-w-0 flex-1 truncate">{sub.path}</span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                  aria-label={`${sub.name} actions`}
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    setSubMenu({ x: rect.left, y: rect.bottom + 4, sub });
                  }}
                >
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </div>
            ))}
          </Section>
        )}
      </div>

      {subMenu && (
        <DropdownMenu open onOpenChange={(o) => !o && setSubMenu(null)}>
          <DropdownMenuTrigger asChild>
            <span style={{ position: 'fixed', left: subMenu.x, top: subMenu.y }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom">
            <DropdownMenuLabel className="max-w-64 truncate font-mono">{subMenu.sub.path}</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => openSubmodule(subMenu.sub)}>
              <FolderGit2 /> Open as repository
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                const sub = subMenu.sub;
                void act(`Update ${sub.name}`, () => ipc.submoduleUpdate(path, sub.name));
              }}
            >
              <ListRestart /> Update (checkout recorded commit)
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                void navigator.clipboard.writeText(`${path}/${subMenu.sub.path}`);
                toast.success('Path copied');
              }}
            >
              <Copy /> Copy path
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {prMenu && (
        <DropdownMenu open onOpenChange={(o) => !o && setPrMenu(null)}>
          <DropdownMenuTrigger asChild>
            <span style={{ position: 'fixed', left: prMenu.x, top: prMenu.y }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom">
            <DropdownMenuLabel className="max-w-64 truncate">
              #{prMenu.pr.number} {prMenu.pr.title}
            </DropdownMenuLabel>
            <DropdownMenuItem onClick={() => checkoutPullRequest(prMenu.pr)}>
              <Check /> Checkout
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => void openExternal(prMenu.pr.url)}>
              <Cloud /> Open in browser
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                void navigator.clipboard.writeText(prMenu.pr.url);
                toast.success('URL copied');
              }}
            >
              <Copy /> Copy URL
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {tagMenu && (
        <DropdownMenu open onOpenChange={(o) => !o && setTagMenu(null)}>
          <DropdownMenuTrigger asChild>
            <span style={{ position: 'fixed', left: tagMenu.x, top: tagMenu.y }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom">
            <DropdownMenuLabel className="max-w-64 truncate font-mono">{tagMenu.tag.name}</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => {
                const tag = tagMenu.tag;
                void act(`Checkout ${tag.name}`, () => ipc.checkoutDetached(path, tag.name), { kind: 'checkout' });
              }}
            >
              <Check /> Checkout (detached)
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                const tag = tagMenu.tag;
                void act(`Push tag ${tag.name}`, () => ipc.pushTag(path, remotes[0]?.name ?? 'origin', tag.name));
              }}
            >
              <Cloud /> Push to remote
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              destructive
              onClick={() => {
                const tag = tagMenu.tag;
                void act(`Delete tag ${tag.name}`, () => ipc.tagDelete(path, tag.name));
              }}
            >
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {stashMenu && (
        <DropdownMenu open onOpenChange={(o) => !o && setStashMenu(null)}>
          <DropdownMenuTrigger asChild>
            <span style={{ position: 'fixed', left: stashMenu.x, top: stashMenu.y }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom">
            <DropdownMenuLabel className="max-w-72 truncate">{stashMenu.stash.message}</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => {
                const stash = stashMenu.stash;
                void act('Apply stash', () => ipc.stashApply(path, stash.index));
              }}
            >
              <Play /> Apply
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                const stash = stashMenu.stash;
                void act('Pop stash', () => ipc.stashPop(path, stash.index));
              }}
            >
              <Undo2 /> Pop
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              destructive
              onClick={() => {
                const stash = stashMenu.stash;
                void act('Drop stash', () => ipc.stashDrop(path, stash.index));
              }}
            >
              <Trash2 /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {worktreeMenu && (
        <DropdownMenu open onOpenChange={(o) => !o && setWorktreeMenu(null)}>
          <DropdownMenuTrigger asChild>
            <span style={{ position: 'fixed', left: worktreeMenu.x, top: worktreeMenu.y }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom">
            <DropdownMenuLabel className="max-w-72 truncate font-mono">{worktreeMenu.worktree.path}</DropdownMenuLabel>
            <DropdownMenuItem
              disabled={worktreeMenu.worktree.isCurrent || worktreeMenu.worktree.isMissing}
              onClick={() => openWorktree(worktreeMenu.worktree)}
            >
              <FolderTree /> {worktreeMenu.worktree.isCurrent ? 'Open in this tab' : 'Switch to this worktree'}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={worktreeMenu.worktree.isMissing}
              onClick={() => void ipc.revealPath(worktreeMenu.worktree.path)}
            >
              <FolderOpen /> {isMac ? 'Reveal in Finder' : 'Show in file manager'}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                void navigator.clipboard.writeText(worktreeMenu.worktree.path);
                toast.success('Path copied');
              }}
            >
              <Copy /> Copy path
            </DropdownMenuItem>
            {!worktreeMenu.worktree.isMain && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive onClick={() => void removeWorktree(worktreeMenu.worktree)}>
                  {worktreeMenu.worktree.isMissing ? (
                    <>
                      <Eraser /> Forget missing worktree
                    </>
                  ) : (
                    <>
                      <Trash2 /> Remove worktree…
                    </>
                  )}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {remoteMenu && (
        <DropdownMenu open onOpenChange={(o) => !o && setRemoteMenu(null)}>
          <DropdownMenuTrigger asChild>
            <span style={{ position: 'fixed', left: remoteMenu.x, top: remoteMenu.y }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom">
            <DropdownMenuLabel className="max-w-64 truncate font-mono">{remoteMenu.remote.name}</DropdownMenuLabel>
            <DropdownMenuItem
              onClick={() => {
                const r = remoteMenu.remote;
                void act(`Fetch ${r.name}`, () => ipc.fetch(path, r.name, true, true));
              }}
            >
              <ArrowDownToLine /> Fetch {remoteMenu.remote.name}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                const r = remoteMenu.remote;
                setEditRemote({ original: r.name, name: r.name, url: r.url });
              }}
            >
              <Pencil /> Edit remote…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              destructive
              onClick={() => {
                const r = remoteMenu.remote;
                void confirmDialog({
                  title: `Remove remote "${r.name}"?`,
                  description:
                    'The remote and its remote-tracking branches are removed from this repository. Nothing is deleted on the server.',
                  confirmLabel: 'Remove remote',
                  destructive: true,
                }).then((ok) => {
                  if (ok) void act(`Remove ${r.name}`, () => ipc.remoteRemove(path, r.name));
                });
              }}
            >
              <Trash2 /> Remove remote…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Dialog open={editRemote !== null} onOpenChange={(o) => !o && setEditRemote(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit remote</DialogTitle>
            <DialogDescription>Rename the remote or point it at a different URL.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-xs text-muted">
              Name
              <Input
                value={editRemote?.name ?? ''}
                onChange={(e) => setEditRemote((s) => (s ? { ...s, name: e.target.value } : s))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitEditRemote();
                }}
                placeholder="origin"
                autoFocus
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-muted">
              URL
              <Input
                value={editRemote?.url ?? ''}
                onChange={(e) => setEditRemote((s) => (s ? { ...s, url: e.target.value } : s))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void submitEditRemote();
                }}
                placeholder="https://github.com/user/repo.git"
                className="font-mono"
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setEditRemote(null)}>
              Cancel
            </Button>
            <Button
              disabled={savingRemote || !editRemote?.name.trim() || !editRemote?.url.trim()}
              onClick={() => void submitEditRemote()}
            >
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {branchMenu && (
        <DropdownMenu open onOpenChange={(o) => !o && setBranchMenu(null)}>
          <DropdownMenuTrigger asChild>
            <span style={{ position: 'fixed', left: branchMenu.x, top: branchMenu.y }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom">
            <DropdownMenuLabel className="max-w-64 truncate font-mono">{branchMenu.branch.name}</DropdownMenuLabel>
            {branchMenuHeld ? (
              <DropdownMenuItem onClick={() => openWorktree(branchMenuHeld)}>
                <FolderTree /> Switch to worktree {branchMenuHeld.name}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem
                disabled={branchMenu.branch.isHead}
                onClick={() =>
                  void act(`Checkout ${branchMenu.branch.name}`, () => ipc.checkout(path, branchMenu.branch.name), {
                    kind: 'checkout',
                  })
                }
              >
                <Check /> Checkout
              </DropdownMenuItem>
            )}
            {!branchMenu.branch.isHead && !branchMenuHeld && (
              <DropdownMenuItem onClick={() => openDialog('createWorktree', { branch: branchMenu.branch.name })}>
                <FolderTree /> Open in new worktree…
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              disabled={branchMenu.branch.isHead}
              onClick={() =>
                void act(`Merge ${branchMenu.branch.name}`, () => ipc.merge(path, branchMenu.branch.name, true), {
                  kind: 'merge',
                })
              }
            >
              <GitMerge /> Merge into current
            </DropdownMenuItem>
            {!branchMenu.branch.isRemote && (
              <DropdownMenuItem
                disabled={branchMenu.branch.isHead}
                onClick={() =>
                  void act(`Rebase onto ${branchMenu.branch.name}`, () => ipc.rebase(path, branchMenu.branch.name), {
                    kind: 'rebase',
                  })
                }
              >
                <ListRestart /> Rebase current onto this
              </DropdownMenuItem>
            )}
            {!branchMenu.branch.isRemote && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  disabled={!branchMenu.branch.upstream}
                  onClick={() =>
                    void act(`Pull ${branchMenu.branch.name}`, () => ipc.pullBranch(path, branchMenu.branch.name))
                  }
                >
                  <ArrowDownToLine /> Pull
                  {branchMenu.branch.behind > 0 && <Badge tone="info">↓{capCount(branchMenu.branch.behind)}</Badge>}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    void act(`Push ${branchMenu.branch.name}`, () =>
                      ipc.push(path, remotes[0]?.name ?? 'origin', false, false, true, branchMenu.branch.name),
                    )
                  }
                >
                  <ArrowUpFromLine /> Push
                  {branchMenu.branch.ahead > 0 && <Badge tone="primary">↑{capCount(branchMenu.branch.ahead)}</Badge>}
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => openDialog('createBranch', branchMenu.branch.targetOid)}>
              <GitBranchPlus /> Create branch here…
            </DropdownMenuItem>
            {!branchMenu.branch.isRemote && (
              <>
                <DropdownMenuItem onClick={() => openDialog('rename', branchMenu.branch.name)}>
                  <Pencil /> Rename…
                </DropdownMenuItem>
                <DropdownMenuItem
                  destructive
                  disabled={branchMenu.branch.isHead}
                  onClick={() =>
                    void act(
                      `Delete branch ${branchMenu.branch.name}`,
                      () => ipc.deleteBranch(path, branchMenu.branch.name, false),
                      { kind: 'branchDelete', extra: { branch: branchMenu.branch.name, oid: branchMenu.branch.targetOid } },
                    )
                  }
                >
                  <Trash2 /> Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <Dialog open={dropAction !== null} onOpenChange={(o) => !o && setDropAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Badge tone="info" className="min-w-0 max-w-44">
                <span className="truncate">{dropAction?.source}</span>
              </Badge>
              <MoveRight className="size-3.5 shrink-0 text-faint" />
              <Badge tone="success" className="min-w-0 max-w-44">
                <span className="truncate">{dropAction?.target}</span>
              </Badge>
            </DialogTitle>
            <DialogDescription>
              {dropAction && useRepo.getState().repo?.headBranch !== dropAction.target
                ? `${dropAction.target} will be checked out first when merging.`
                : 'Choose what to do with these branches.'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Button
              className="h-auto justify-start whitespace-normal py-2"
              onClick={() => dropAction && void dropMerge(dropAction.source, dropAction.target, true)}
            >
              <GitMerge className="shrink-0" />
              <span className="flex min-w-0 flex-col items-start gap-0.5 text-left">
                <span className="max-w-full truncate">
                  Merge {dropAction?.source} into {dropAction?.target}
                </span>
                <span className="text-[11px] font-normal opacity-75">
                  Records a merge commit on {dropAction?.target}
                </span>
              </span>
            </Button>
            {dropAction?.canFf && (
              <Button
                variant="secondary"
                className="h-auto justify-start whitespace-normal py-2"
                onClick={() => void dropMerge(dropAction.source, dropAction.target, false)}
              >
                <FastForward className="shrink-0" />
                <span className="flex min-w-0 flex-col items-start gap-0.5 text-left">
                  <span className="max-w-full truncate">
                    Fast-forward {dropAction.target} to {dropAction.source}
                  </span>
                  <span className="text-[11px] font-normal text-muted">
                    Moves the branch pointer without creating a merge commit
                  </span>
                </span>
              </Button>
            )}
            {dropAction && !branches.find((b) => b.name === dropAction.source)?.isRemote && (
              <Button
                variant="secondary"
                className="h-auto justify-start whitespace-normal py-2"
                onClick={() => void dropRebase(dropAction.source, dropAction.target)}
              >
                <ListRestart className="shrink-0" />
                <span className="flex min-w-0 flex-col items-start gap-0.5 text-left">
                  <span className="max-w-full truncate">
                    Rebase {dropAction.source} onto {dropAction.target}
                  </span>
                  <span className="text-[11px] font-normal text-muted">
                    Replays {dropAction.source}'s commits on top of {dropAction.target} — rewrites history
                  </span>
                </span>
              </Button>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDropAction(null)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </aside>
  );
}
