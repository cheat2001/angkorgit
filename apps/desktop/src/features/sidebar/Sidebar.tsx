import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  Archive,
  Boxes,
  Check,
  ChevronRight,
  Cloud,
  GitBranch,
  GitMerge,
  ListRestart,
  MoreHorizontal,
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  cn,
} from '@angkorgit/design-system';
import { ipc } from '@/core/ipc';
import { useRepo } from '@/features/repository/store';
import { useGraph } from '@/features/graph/store';
import { useUi } from '@/features/ui/store';
import { useUndo, type UndoKind } from '@/features/history/undoStore';

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

  if (!repo) return null;

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
          {locals.map((branch) => (
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
              className={cn(
                'group flex cursor-grab items-center gap-2 rounded-md px-2 py-1 pl-7 text-sm hover:bg-surface-raised active:cursor-grabbing',
                branch.isHead && 'text-primary',
                filters.branch === branch.name && 'bg-surface-raised',
                dragging === branch.name && 'opacity-40',
                dropTarget === branch.name && 'bg-primary/10 ring-1 ring-inset ring-primary/60',
              )}
              title={`Drag onto another branch to merge or rebase`}
            >
              <button
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onDoubleClick={() => void act(`Checkout ${branch.name}`, () => ipc.checkout(path, branch.name), { kind: 'checkout' })}
                onClick={() => setFilters(path, { branch: filters.branch === branch.name ? '' : branch.name })}
                title={`${branch.name} — click to filter graph, double-click to checkout`}
              >
                {branch.isHead && <Check className="size-3.5 shrink-0" />}
                <span className="truncate">{branch.name}</span>
                {branch.ahead > 0 && <Badge tone="primary">↑{branch.ahead}</Badge>}
                {branch.behind > 0 && <Badge tone="info">↓{branch.behind}</Badge>}
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" className="shrink-0 opacity-0 group-hover:opacity-100" aria-label={`${branch.name} actions`}>
                    <MoreHorizontal className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  <DropdownMenuItem
                    disabled={branch.isHead}
                    onClick={() => void act(`Checkout ${branch.name}`, () => ipc.checkout(path, branch.name), { kind: 'checkout' })}
                  >
                    <Check /> Checkout
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={branch.isHead}
                    onClick={() => void act(`Merge ${branch.name}`, () => ipc.merge(path, branch.name), { kind: 'merge' })}
                  >
                    <GitMerge /> Merge into current
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={branch.isHead}
                    onClick={() => void act(`Rebase onto ${branch.name}`, () => ipc.rebase(path, branch.name), { kind: 'rebase' })}
                  >
                    <ListRestart /> Rebase current onto this
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => openDialog('rename', branch.name)}>
                    <Pencil /> Rename…
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    destructive
                    disabled={branch.isHead}
                    onClick={() => void act(`Delete branch ${branch.name}`, () => ipc.deleteBranch(path, branch.name, false), { kind: 'branchDelete', extra: { branch: branch.name, oid: branch.targetOid } })}
                  >
                    <Trash2 /> Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </Section>

        <Section icon={<Cloud className="size-3.5" />} title="Remotes" count={remoteBranches.length} defaultOpen={false}>
          {remoteBranches.map((branch) => (
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
              className={cn(
                'group flex cursor-grab items-center gap-2 rounded-md px-2 py-1 pl-7 text-sm text-muted hover:bg-surface-raised active:cursor-grabbing',
                dragging === branch.name && 'opacity-40',
              )}
              title="Drag onto a local branch to merge or rebase"
            >
              <button
                className="min-w-0 flex-1 truncate text-left"
                onDoubleClick={() => void act(`Checkout ${branch.name}`, () => ipc.checkout(path, branch.name), { kind: 'checkout' })}
                title={`${branch.name} — double-click to checkout`}
              >
                {branch.name}
              </button>
            </div>
          ))}
          {remotes.map((r) => (
            <div key={r.name} className="px-2 py-1 pl-7 font-mono text-[10px] text-faint" title={r.url}>
              {r.name} · {r.url}
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
              <div key={sub.name} className="group flex items-center gap-2 rounded-md px-2 py-1 pl-7 text-sm text-muted hover:bg-surface-raised">
                <span className="min-w-0 flex-1 truncate" title={sub.url ?? sub.path}>
                  {sub.path}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0 opacity-0 group-hover:opacity-100"
                  aria-label={`Update ${sub.name}`}
                  onClick={() => void act(`Update ${sub.name}`, () => ipc.submoduleUpdate(path, sub.name))}
                >
                  <ListRestart className="size-3.5" />
                </Button>
              </div>
            ))}
          </Section>
        )}
      </div>

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
