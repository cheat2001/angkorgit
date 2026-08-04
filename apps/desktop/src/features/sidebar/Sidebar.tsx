import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  Check,
  ChevronRight,
  Cloud,
  Copy,
  Folder,
  FolderGit2,
  FolderOpen,
  GitBranch,
  GitMerge,
  ListRestart,
  MoreHorizontal,
  GitBranchPlus,
  Pencil,
  Play,
  Plus,
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
  cn,
} from '@angkorgit/design-system';
import { ipc } from '@/core/ipc';
import { confirmDialog } from '@/components/confirm';
import { useRepo } from '@/features/repository/store';
import { useGraph } from '@/features/graph/store';
import { useUi } from '@/features/ui/store';
import { useUndo, type UndoKind } from '@/features/history/undoStore';
import type { BranchInfo, RemoteInfo, SubmoduleInfo } from '@angkorgit/core';

/**
 * Branch folder tree: "feature/test" and "feature/test2" group under a
 * collapsible "feature" folder (nested to any depth), GitKraken-style.
 */
interface BranchTreeNode {
  /** last path segment (display name) */
  key: string;
  /** full folder path or full branch name */
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

/** Folder paths leading to a branch (for auto-expanding the HEAD path). */
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

/** Records op outcomes for undo only when they completed (not on conflicts). */
const outcomeOk = (result: unknown) => {
  const status = (result as { status?: string } | undefined)?.status;
  return status === undefined || status === 'ok' || status === 'fast_forward';
};

function Section({
  icon,
  title,
  count,
  children,
  defaultOpen = true,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
  action?: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-1">
      <div className="group flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted hover:bg-surface-raised">
        <button className="flex min-w-0 flex-1 items-center gap-1.5" onClick={() => setOpen(!open)}>
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
  const { repo, branches, tags, stashes, remotes, submodules } = useRepo();
  const refresh = useRepo((s) => s.refresh);
  const graphReload = useGraph((s) => s.reload);
  const setFilters = useGraph((s) => s.setFilters);
  const filters = useGraph((s) => s.filters);
  const openDialog = useUi((s) => s.openDialog);
  const [query, setQuery] = useState('');
  /** drag-and-drop merge state */
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [dropAction, setDropAction] = useState<{ source: string; target: string } | null>(null);
  /** branch menu opened by right-click or the ⋯ button, positioned at cursor */
  const [branchMenu, setBranchMenu] = useState<{ x: number; y: number; branch: BranchInfo } | null>(null);
  const [subMenu, setSubMenu] = useState<{ x: number; y: number; sub: SubmoduleInfo } | null>(null);
  const [remoteMenu, setRemoteMenu] = useState<{ x: number; y: number; remote: RemoteInfo } | null>(null);
  /** edit-remote dialog state; `original` is the name before editing */
  const [editRemote, setEditRemote] = useState<{ original: string; name: string; url: string } | null>(null);

  /** Open a submodule as its own repository — full graph, history, everything. */
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
      const outcome = result as { status?: string; message?: string } | undefined;
      if (outcome?.status === 'conflicts') toast.warning(outcome.message);
      else toast.success(outcome?.message ?? `${label} done`);
      await refreshAll();
    } catch (error) {
      toast.error(`${label} failed: ${(error as { message?: string }).message ?? error}`);
    }
  };

  /** Merge source into target — checking target out first when needed. */
  const dropMerge = async (source: string, target: string) => {
    setDropAction(null);
    try {
      if (useRepo.getState().repo?.headBranch !== target) {
        await useUndo.getState().tracked({
          path,
          kind: 'checkout',
          label: `Checkout ${target}`,
          action: () => ipc.checkout(path, target),
        });
      }
      await act(`Merge ${source} into ${target}`, () => ipc.merge(path, source), { kind: 'merge' });
    } catch (error) {
      toast.error(`Merge failed: ${(error as { message?: string }).message ?? error}`);
    }
  };

  /** Rebase source onto target — checking source out first when needed. */
  const dropRebase = async (source: string, target: string) => {
    setDropAction(null);
    try {
      if (useRepo.getState().repo?.headBranch !== source) {
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

  const q = query.trim().toLowerCase();
  const locals = useMemo(
    () => branches.filter((b) => !b.isRemote && (!q || b.name.toLowerCase().includes(q))),
    [branches, q],
  );
  const remoteBranches = useMemo(
    () => branches.filter((b) => b.isRemote && (!q || b.name.toLowerCase().includes(q))),
    [branches, q],
  );
  const filteredTags = useMemo(() => tags.filter((t) => !q || t.name.toLowerCase().includes(q)), [tags, q]);

  const localTree = useMemo(() => buildBranchTree(locals), [locals]);
  const remoteTree = useMemo(() => buildBranchTree(remoteBranches), [remoteBranches]);

  /** expanded folder paths; the path to HEAD starts open */
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  useEffect(() => {
    const head = branches.find((b) => b.isHead);
    if (!head) return;
    const paths = ancestorFolders(head.name);
    if (paths.length > 0) {
      setExpandedFolders((prev) => new Set([...prev, ...paths]));
    }
  }, [branches]);
  const toggleFolder = (folderPath: string) =>
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderPath)) next.delete(folderPath);
      else next.add(folderPath);
      return next;
    });

  if (!repo) return null;

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
          setDropTarget(branch.name);
        }
      }}
      onDragLeave={() => setDropTarget((t) => (t === branch.name ? null : t))}
      onDrop={(e) => {
        e.preventDefault();
        const source = e.dataTransfer.getData('text/angkorgit-branch');
        setDropTarget(null);
        setDragging(null);
        if (source && source !== branch.name) {
          setDropAction({ source, target: branch.name });
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
        onDoubleClick={() => void act(`Checkout ${branch.name}`, () => ipc.checkout(path, branch.name), { kind: 'checkout' })}
        onClick={() => setFilters(path, { branch: filters.branch === branch.name ? '' : branch.name })}
        title={`${branch.name} — click to filter graph, double-click to checkout`}
      >
        {branch.isHead && <Check className="size-3.5 shrink-0" />}
        <span className="truncate">{label}</span>
        {branch.ahead > 0 && <Badge tone="primary">↑{branch.ahead}</Badge>}
        {branch.behind > 0 && <Badge tone="info">↓{branch.behind}</Badge>}
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0 opacity-0 group-hover:opacity-100"
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
        className="min-w-0 flex-1 truncate text-left"
        onDoubleClick={() => void act(`Checkout ${branch.name}`, () => ipc.checkout(path, branch.name), { kind: 'checkout' })}
        title={`${branch.name} — double-click to checkout`}
      >
        {label}
      </button>
      <Button
        variant="ghost"
        size="icon-sm"
        className="shrink-0 opacity-0 group-hover:opacity-100"
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
      return (
        <div key={`folder:${node.path}`}>
          <button
            className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-sm text-muted hover:bg-surface-raised"
            style={{ paddingLeft: 10 + depth * 14 }}
            onClick={() => toggleFolder(node.path)}
            title={node.path}
          >
            <ChevronRight
              className={cn('size-3.5 shrink-0 text-faint transition-transform duration-150', expanded && 'rotate-90')}
            />
            {expanded ? (
              <FolderOpen className="size-3.5 shrink-0 text-primary/70" />
            ) : (
              <Folder className="size-3.5 shrink-0 text-faint" />
            )}
            <span className="truncate">{node.key}</span>
            <span className="text-[10px] text-faint">{leafCount(node)}</span>
          </button>
          {expanded && renderTree(node.children, depth + 1, kind)}
        </div>
      );
    });

  return (
    <aside className="flex h-full flex-col bg-surface">
      <div className="p-2">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-faint" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter refs…"
            className="h-7 border-transparent bg-surface-raised pl-8 text-xs"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        <Section
          icon={<GitBranch className="size-3.5" />}
          title="Branches"
          count={locals.length}
          action={
            <Button variant="ghost" size="icon-sm" aria-label="New branch" onClick={() => openDialog('createBranch')}>
              <Plus className="size-3.5" />
            </Button>
          }
        >
          {q
            ? locals.map((branch) => renderLocalBranch(branch, branch.name, 0))
            : renderTree(localTree, 0, 'local')}
        </Section>

        <Section icon={<Cloud className="size-3.5" />} title="Remotes" count={remoteBranches.length} defaultOpen={false}>
          {q
            ? remoteBranches.map((branch) => renderRemoteBranch(branch, branch.name, 0))
            : renderTree(remoteTree, 0, 'remote')}
          {remotes.map((r) => (
            <div
              key={r.name}
              className="group flex items-center gap-1.5 rounded-md px-2 py-1 pl-7 text-xs text-faint hover:bg-surface-raised"
              title={r.url}
              onContextMenu={(e) => {
                e.preventDefault();
                setRemoteMenu({ x: e.clientX, y: e.clientY, remote: r });
              }}
            >
              <Cloud className="size-3 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              <Button
                variant="ghost"
                size="icon-sm"
                className="shrink-0 opacity-0 group-hover:opacity-100"
                aria-label={`Remote ${r.name} actions`}
                onClick={(e) => setRemoteMenu({ x: e.clientX, y: e.clientY, remote: r })}
              >
                <MoreHorizontal className="size-3.5" />
              </Button>
            </div>
          ))}
        </Section>

        <Section
          icon={<TagIcon className="size-3.5" />}
          title="Tags"
          count={filteredTags.length}
          defaultOpen={false}
          action={
            <Button variant="ghost" size="icon-sm" aria-label="New tag" onClick={() => openDialog('createTag')}>
              <Plus className="size-3.5" />
            </Button>
          }
        >
          {filteredTags.map((tag) => (
            <div key={tag.name} className="group flex items-center gap-2 rounded-md px-2 py-1 pl-7 text-sm hover:bg-surface-raised">
              <span className="min-w-0 flex-1 truncate" title={tag.message ?? tag.name}>
                {tag.name}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" className="shrink-0 opacity-0 group-hover:opacity-100" aria-label={`${tag.name} actions`}>
                    <MoreHorizontal className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => void act(`Checkout ${tag.name}`, () => ipc.checkoutDetached(path, tag.name), { kind: 'checkout' })}>
                    <Check /> Checkout (detached)
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() => void act(`Push tag ${tag.name}`, () => ipc.pushTag(path, remotes[0]?.name ?? 'origin', tag.name))}
                  >
                    <Cloud /> Push to remote
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onClick={() => void act(`Delete tag ${tag.name}`, () => ipc.tagDelete(path, tag.name))}>
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </Section>

        <Section
          icon={<Archive className="size-3.5" />}
          title="Stashes"
          count={stashes.length}
          defaultOpen={stashes.length > 0}
          action={
            <Button variant="ghost" size="icon-sm" aria-label="New stash" onClick={() => openDialog('createStash')}>
              <Plus className="size-3.5" />
            </Button>
          }
        >
          {stashes.map((stash) => (
            <div key={stash.oid} className="group flex items-center gap-2 rounded-md px-2 py-1 pl-7 text-sm hover:bg-surface-raised">
              <span className="min-w-0 flex-1 truncate" title={stash.message}>
                {stash.message}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" className="shrink-0 opacity-0 group-hover:opacity-100" aria-label="Stash actions">
                    <MoreHorizontal className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem onClick={() => void act('Apply stash', () => ipc.stashApply(path, stash.index))}>
                    <Play /> Apply
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => void act('Pop stash', () => ipc.stashPop(path, stash.index))}>
                    <Undo2 /> Pop
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onClick={() => void act('Drop stash', () => ipc.stashDrop(path, stash.index))}>
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </Section>

        {submodules.length > 0 && (
          <Section icon={<Boxes className="size-3.5" />} title="Submodules" count={submodules.length} defaultOpen={false}>
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
                <Hint label="Open as repository">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 opacity-0 group-hover:opacity-100"
                    aria-label={`Open ${sub.name}`}
                    onClick={() => openSubmodule(sub)}
                  >
                    <FolderGit2 className="size-3.5" />
                  </Button>
                </Hint>
                <Hint label="Update (checkout recorded commit)">
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 opacity-0 group-hover:opacity-100"
                    aria-label={`Update ${sub.name}`}
                    onClick={() => void act(`Update ${sub.name}`, () => ipc.submoduleUpdate(path, sub.name))}
                  >
                    <ListRestart className="size-3.5" />
                  </Button>
                </Hint>
              </div>
            ))}
          </Section>
        )}
      </div>

      {/* Submodule context menu */}
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

      {/* Remote context menu */}
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

      {/* Edit remote dialog */}
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
                placeholder="origin"
                autoFocus
              />
            </label>
            <label className="flex flex-col gap-1.5 text-xs text-muted">
              URL
              <Input
                value={editRemote?.url ?? ''}
                onChange={(e) => setEditRemote((s) => (s ? { ...s, url: e.target.value } : s))}
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
              disabled={!editRemote?.name.trim() || !editRemote?.url.trim()}
              onClick={() => {
                const edit = editRemote;
                if (!edit) return;
                setEditRemote(null);
                void act(`Update remote ${edit.original}`, () =>
                  ipc.remoteEdit(path, edit.original, edit.name, edit.url),
                );
              }}
            >
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Branch context menu (right-click or ⋯) */}
      {branchMenu && (
        <DropdownMenu open onOpenChange={(o) => !o && setBranchMenu(null)}>
          <DropdownMenuTrigger asChild>
            <span style={{ position: 'fixed', left: branchMenu.x, top: branchMenu.y }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" side="bottom">
            <DropdownMenuLabel className="max-w-64 truncate font-mono">{branchMenu.branch.name}</DropdownMenuLabel>
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
            <DropdownMenuItem
              disabled={branchMenu.branch.isHead}
              onClick={() =>
                void act(`Merge ${branchMenu.branch.name}`, () => ipc.merge(path, branchMenu.branch.name), {
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
                  {branchMenu.branch.behind > 0 && <Badge tone="info">↓{branchMenu.branch.behind}</Badge>}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() =>
                    void act(`Push ${branchMenu.branch.name}`, () =>
                      ipc.push(path, remotes[0]?.name ?? 'origin', false, false, true, branchMenu.branch.name),
                    )
                  }
                >
                  <ArrowUpFromLine /> Push
                  {branchMenu.branch.ahead > 0 && <Badge tone="primary">↑{branchMenu.branch.ahead}</Badge>}
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

      {/* Drag-and-drop action chooser */}
      <Dialog open={dropAction !== null} onOpenChange={(o) => !o && setDropAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <span className="font-mono text-sm">{dropAction?.source}</span> →{' '}
              <span className="font-mono text-sm">{dropAction?.target}</span>
            </DialogTitle>
            <DialogDescription>
              {dropAction && useRepo.getState().repo?.headBranch !== dropAction.target
                ? `${dropAction.target} will be checked out first when merging.`
                : 'Choose what to do with these branches.'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Button
              className="justify-start"
              onClick={() => dropAction && void dropMerge(dropAction.source, dropAction.target)}
            >
              <GitMerge /> Merge {dropAction?.source} into {dropAction?.target}
            </Button>
            {dropAction && !branches.find((b) => b.name === dropAction.source)?.isRemote && (
              <Button
                variant="secondary"
                className="justify-start"
                onClick={() => void dropRebase(dropAction.source, dropAction.target)}
              >
                <ListRestart /> Rebase {dropAction.source} onto {dropAction.target}
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
