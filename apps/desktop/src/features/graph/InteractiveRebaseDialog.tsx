import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { GripVertical } from 'lucide-react';
import type { CommitInfo, RebaseTodoAction, RebaseTodoEntry } from '@angkorgit/core';
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Hint,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Spinner,
  Textarea,
  cn,
} from '@angkorgit/design-system';
import { ipc } from '@/core/ipc';
import { useRepo } from '@/features/repository/store';
import { useGraph } from './store';
import { useUi, type DialogContext } from '@/features/ui/store';
import { useUndo } from '@/features/history/undoStore';

const ACTIONS: RebaseTodoAction[] = ['pick', 'reword', 'squash', 'fixup', 'drop'];

interface PlanRow {
  commit: CommitInfo;
  action: RebaseTodoAction;
  message: string;
}

function fullMessage(commit: CommitInfo): string {
  return commit.body ? `${commit.summary}\n\n${commit.body}` : commit.summary;
}

function contextBaseOid(context: DialogContext): string {
  if (typeof context === 'string') return context;
  return context && 'baseOid' in context ? context.baseOid : '';
}

function stillOpenFor(baseOid: string): boolean {
  const ui = useUi.getState();
  return ui.dialog === 'interactiveRebase' && contextBaseOid(ui.dialogContext) === baseOid;
}

function presetAction(
  commit: CommitInfo,
  squashOids: Set<string>,
  dropOids: Set<string>,
  seenSquash: { current: boolean },
): RebaseTodoAction {
  if (squashOids.has(commit.oid)) {
    const action = seenSquash.current ? 'squash' : 'pick';
    seenSquash.current = true;
    return action;
  }
  if (dropOids.has(commit.oid)) return 'drop';
  return 'pick';
}

export function InteractiveRebaseDialog() {
  const repo = useRepo((s) => s.repo);
  const dialog = useUi((s) => s.dialog);
  const dialogContext = useUi((s) => s.dialogContext);
  const closeDialog = useUi((s) => s.closeDialog);

  const open = dialog === 'interactiveRebase' && Boolean(dialogContext);
  const baseOid = open ? contextBaseOid(dialogContext) : '';
  const path = repo?.path ?? '';

  const [rows, setRows] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [draggingOid, setDraggingOid] = useState<string | null>(null);
  const [dropOid, setDropOid] = useState<string | null>(null);

  useEffect(() => {
    if (!baseOid || !path) return;
    setRows([]);
    setExecuting(false);
    setDraggingOid(null);
    setDropOid(null);
    setLoading(true);
    void (async () => {
      try {
        const commits = await ipc.rebaseCommits(path, baseOid);
        if (!stillOpenFor(baseOid)) return;
        const context = useUi.getState().dialogContext;
        const preset = typeof context === 'object' && context && 'baseOid' in context ? context : null;
        const squashOids = new Set(preset?.squashOids ?? []);
        const dropOids = new Set(preset?.dropOids ?? []);
        const seenSquash = { current: false };
        setRows(
          [...commits].reverse().map((commit) => ({
            commit,
            action: presetAction(commit, squashOids, dropOids, seenSquash),
            message: '',
          })),
        );
        setLoading(false);
      } catch (error) {
        if (!stillOpenFor(baseOid)) return;
        toast.error(
          `Interactive rebase failed: ${(error as { message?: string }).message ?? error}`,
        );
        useUi.getState().closeDialog();
      }
    })();
  }, [baseOid, path]);

  const setAction = (oid: string, action: RebaseTodoAction) => {
    setRows((rs) =>
      rs.map((r) =>
        r.commit.oid === oid
          ? { ...r, action, message: action === 'reword' ? fullMessage(r.commit) : '' }
          : r,
      ),
    );
  };

  const setMessage = (oid: string, message: string) => {
    setRows((rs) => rs.map((r) => (r.commit.oid === oid ? { ...r, message } : r)));
  };

  const move = (fromOid: string, toOid: string) => {
    setRows((rs) => {
      const fromIdx = rs.findIndex((r) => r.commit.oid === fromOid);
      const toIdx = rs.findIndex((r) => r.commit.oid === toOid);
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return rs;
      const next = [...rs];
      const [moved] = next.splice(fromIdx, 1);
      next.splice(toIdx, 0, moved);
      return next;
    });
  };

  const firstKept = rows.find((r) => r.action !== 'drop');
  const invalidCombine =
    Boolean(firstKept) && (firstKept?.action === 'squash' || firstKept?.action === 'fixup');

  const execute = async () => {
    if (!baseOid || !path) return;
    const todo: RebaseTodoEntry[] = rows.map((r) => {
      const message =
        (r.action === 'reword' || r.action === 'squash') && r.message.trim()
          ? r.message.trim()
          : undefined;
      return message
        ? { oid: r.commit.oid, action: r.action, message }
        : { oid: r.commit.oid, action: r.action };
    });
    setExecuting(true);
    try {
      await useUndo.getState().tracked({
        path,
        kind: 'rebase',
        label: 'interactive rebase',
        action: () => ipc.rebaseInteractive(path, baseOid, todo),
      });
      toast.success('Interactive rebase done');
      closeDialog();
      await useRepo.getState().refresh();
      await useGraph.getState().reload(path);
    } catch (error) {
      toast.error(
        `Interactive rebase failed: ${(error as { message?: string }).message ?? error}`,
      );
    } finally {
      setExecuting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeDialog()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Interactive rebase</DialogTitle>
          <DialogDescription>
            Rewriting the commits above {baseOid.slice(0, 8)} — they apply top to bottom, so the
            top row becomes the oldest rebased commit. Drag rows to reorder.
          </DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Spinner />
          </div>
        ) : (
          <div
            role="list"
            aria-label="Rebase plan"
            className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto pr-1"
          >
            {rows.length === 0 && (
              <p className="py-6 text-center text-sm text-faint">
                No commits to rebase above this point.
              </p>
            )}
            {rows.map((row) => (
              <div
                key={row.commit.oid}
                role="listitem"
                draggable
                onDragStart={(e) => {
                  setDraggingOid(row.commit.oid);
                  e.dataTransfer.setData('text/angkorgit-rebase-row', row.commit.oid);
                  e.dataTransfer.effectAllowed = 'move';
                }}
                onDragEnd={() => {
                  setDraggingOid(null);
                  setDropOid(null);
                }}
                onDragOver={(e) => {
                  if (draggingOid && draggingOid !== row.commit.oid) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    setDropOid(row.commit.oid);
                  }
                }}
                onDragLeave={() => setDropOid((o) => (o === row.commit.oid ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  const source = e.dataTransfer.getData('text/angkorgit-rebase-row');
                  setDraggingOid(null);
                  setDropOid(null);
                  if (source && source !== row.commit.oid) move(source, row.commit.oid);
                }}
                className={cn(
                  'flex flex-col gap-2 rounded-md border border-border-subtle bg-surface px-2 py-1.5',
                  row.action === 'drop' && 'opacity-40',
                  draggingOid === row.commit.oid && 'opacity-40',
                  dropOid === row.commit.oid && 'ring-1 ring-inset ring-primary/60',
                )}
              >
                <div className="flex items-center gap-2">
                  <Hint label="Drag to reorder">
                    <span className="shrink-0 cursor-grab text-faint">
                      <GripVertical className="size-4" />
                    </span>
                  </Hint>
                  <Badge className="shrink-0 font-mono">{row.commit.shortOid.slice(0, 7)}</Badge>
                  <span className="min-w-0 flex-1 truncate text-sm">{row.commit.summary}</span>
                  <span className="shrink-0 text-xs text-faint">{row.commit.author.name}</span>
                  <Select
                    value={row.action}
                    onValueChange={(v) => setAction(row.commit.oid, v as RebaseTodoAction)}
                  >
                    <SelectTrigger
                      className="h-7 w-28 shrink-0 text-xs"
                      aria-label={`Action for ${row.commit.shortOid.slice(0, 7)}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ACTIONS.map((action) => (
                        <SelectItem key={action} value={action}>
                          {action}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {row.action === 'reword' && (
                  <Textarea
                    rows={3}
                    className="text-xs"
                    value={row.message}
                    onChange={(e) => setMessage(row.commit.oid, e.target.value)}
                  />
                )}
                {row.action === 'squash' && (
                  <Textarea
                    rows={2}
                    className="text-xs"
                    placeholder="Combined message (optional)"
                    value={row.message}
                    onChange={(e) => setMessage(row.commit.oid, e.target.value)}
                  />
                )}
              </div>
            ))}
          </div>
        )}
        {invalidCombine && (
          <p className="mt-2 text-xs text-danger">
            The first kept commit cannot be squash or fixup — there is no earlier commit to
            combine it into.
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={closeDialog} disabled={executing}>
            Cancel
          </Button>
          <Button
            disabled={loading || executing || invalidCombine || rows.length === 0}
            onClick={() => void execute()}
          >
            {executing && <Spinner className="size-3.5" />}
            Rebase
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
