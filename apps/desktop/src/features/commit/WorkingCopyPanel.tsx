import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { AlertTriangle, Minus, Plus, Sparkles, Trash2, Undo2 } from 'lucide-react';
import type { FileStatus } from '@angkorgit/core';
import { aiCapabilities } from '@angkorgit/core';
import { Badge, Button, Checkbox, Hint, Spinner, Textarea, cn } from '@angkorgit/design-system';
import { ipc } from '@/core/ipc';
import { useRepo } from '@/features/repository/store';
import { useGraph } from '@/features/graph/store';
import { useUi } from '@/features/ui/store';
import { aiConfigured, getAiProvider } from '@/features/ai/client';
import { useUndo } from '@/features/history/undoStore';
import { basename, dirname } from '@/shared/utils';

function statusBadge(kind: string | null) {
  switch (kind) {
    case 'new':
    case 'untracked':
      return <Badge tone="success">A</Badge>;
    case 'modified':
      return <Badge tone="info">M</Badge>;
    case 'deleted':
      return <Badge tone="danger">D</Badge>;
    case 'renamed':
      return <Badge tone="primary">R</Badge>;
    case 'conflicted':
      return <Badge tone="danger">!</Badge>;
    default:
      return null;
  }
}

function FileRow({
  file,
  staged,
  selected,
  onClick,
  onPrimary,
  onDiscard,
}: {
  file: FileStatus;
  staged: boolean;
  selected: boolean;
  onClick: () => void;
  onPrimary: () => void;
  onDiscard?: () => void;
}) {
  const kind = staged ? file.staged : file.unstaged;
  const conflicted = file.unstaged === 'conflicted';
  return (
    <div
      className={cn(
        'group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors',
        selected ? 'bg-primary/10' : 'hover:bg-surface-raised',
      )}
      onClick={onClick}
    >
      <Checkbox
        checked={staged}
        aria-label={staged ? `Unstage ${file.path}` : `Stage ${file.path}`}
        onCheckedChange={() => onPrimary()}
        onClick={(e) => e.stopPropagation()}
      />
      {statusBadge(conflicted && !staged ? 'conflicted' : kind)}
      <span className="min-w-0 flex-1 truncate">
        <span className="text-foreground">{basename(file.path)}</span>
        {dirname(file.path) && <span className="ml-1.5 text-faint">{dirname(file.path)}</span>}
      </span>
      {!staged && onDiscard && (
        <Hint label="Discard changes">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={`Discard ${file.path}`}
            className="opacity-0 group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              onDiscard();
            }}
          >
            <Trash2 className="size-3 text-danger" />
          </Button>
        </Hint>
      )}
    </div>
  );
}

export function WorkingCopyPanel() {
  const { repo, status, conflicts, refreshStatus } = useRepo();
  const reloadGraph = useGraph((s) => s.reload);
  const { selectedFile, selectFile, openCenterDiff, openConflict } = useUi();
  const [message, setMessage] = useState('');
  const [amend, setAmend] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);

  const path = repo?.path ?? '';
  const files = status?.files ?? [];
  const stagedFiles = files.filter((f) => f.staged);
  const unstagedFiles = files.filter((f) => f.unstaged);

  /** Clicking a file opens its diff full-width over the graph. */
  const showDiff = (file: string, staged: boolean) => {
    selectFile({ path: file, staged });
    openCenterDiff({ path: file, staged });
  };

  const run = useCallback(
    async (op: () => Promise<unknown>, errorLabel: string) => {
      try {
        await op();
        await refreshStatus();
      } catch (error) {
        toast.error(`${errorLabel}: ${(error as { message?: string }).message ?? error}`);
      }
    },
    [refreshStatus],
  );

  const generateMessage = async () => {
    if (!aiConfigured()) {
      toast.info('Configure an AI provider in Settings first');
      return;
    }
    if (stagedFiles.length === 0) {
      toast.info('Stage some changes first');
      return;
    }
    setAiBusy(true);
    try {
      const patch = await ipc.stagedPatch(path);
      const generated = await aiCapabilities.generateCommitMessage(getAiProvider(), patch);
      setMessage(generated);
    } catch (error) {
      toast.error(`AI request failed: ${(error as { message?: string }).message ?? error}`);
    } finally {
      setAiBusy(false);
    }
  };

  const commit = async () => {
    if (!message.trim() && !amend) return;
    setCommitting(true);
    try {
      if (amend) {
        await ipc.amend(path, message.trim() ? message.trim() : null);
        toast.success('Commit amended');
      } else {
        const summary = message.trim().split('\n')[0].slice(0, 50);
        await useUndo.getState().tracked({
          path,
          kind: 'commit',
          label: `commit "${summary}"`,
          action: () => ipc.commit(path, message.trim()),
        });
        toast.success('Committed');
      }
      setMessage('');
      setAmend(false);
      await refreshStatus();
      await reloadGraph(path);
    } catch (error) {
      toast.error(`Commit failed: ${(error as { message?: string }).message ?? error}`);
    } finally {
      setCommitting(false);
    }
  };

  const conflictedPaths = new Set(conflicts);

  return (
    <div className="flex h-full flex-col">
      {conflicts.length > 0 && (
        <div className="m-2 rounded-md border border-danger/40 bg-danger/10 p-2 text-xs">
          <p className="flex items-center gap-1.5 font-medium text-danger">
            <AlertTriangle className="size-3.5" />
            {conflicts.length} conflicted file{conflicts.length === 1 ? '' : 's'}
          </p>
          {conflicts.map((file) => (
            <button
              key={file}
              className="mt-1 block w-full truncate rounded px-1.5 py-1 text-left font-mono text-[11px] hover:bg-danger/10"
              onClick={() => openConflict(file)}
            >
              {file}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        <div className="mb-1 flex items-center justify-between px-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            Staged <span className="text-faint">{stagedFiles.length}</span>
          </span>
          {stagedFiles.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => void run(() => ipc.unstageAll(path), 'Unstage all failed')}>
              <Minus className="size-3" /> Unstage all
            </Button>
          )}
        </div>
        {stagedFiles.length === 0 && <p className="px-2 pb-2 text-xs text-faint">Nothing staged yet.</p>}
        {stagedFiles.map((file) => (
          <FileRow
            key={`s-${file.path}`}
            file={file}
            staged
            selected={selectedFile?.path === file.path && selectedFile.staged}
            onClick={() => showDiff(file.path, true)}
            onPrimary={() => void run(() => ipc.unstageFile(path, file.path), 'Unstage failed')}
          />
        ))}

        <div className="mb-1 mt-3 flex items-center justify-between px-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">
            Changes <span className="text-faint">{unstagedFiles.length}</span>
          </span>
          {unstagedFiles.length > 0 && (
            <Button variant="ghost" size="sm" onClick={() => void run(() => ipc.stageAll(path), 'Stage all failed')}>
              <Plus className="size-3" /> Stage all
            </Button>
          )}
        </div>
        {unstagedFiles.length === 0 && <p className="px-2 pb-2 text-xs text-faint">Working tree clean.</p>}
        {unstagedFiles.map((file) =>
          conflictedPaths.has(file.path) ? (
            <div
              key={`u-${file.path}`}
              className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs text-danger hover:bg-danger/10"
              onClick={() => openConflict(file.path)}
            >
              <AlertTriangle className="size-3.5" />
              <span className="min-w-0 flex-1 truncate font-mono">{file.path}</span>
              <span className="text-[10px]">resolve…</span>
            </div>
          ) : (
            <FileRow
              key={`u-${file.path}`}
              file={file}
              staged={false}
              selected={selectedFile?.path === file.path && !selectedFile.staged}
              onClick={() => showDiff(file.path, false)}
              onPrimary={() => void run(() => ipc.stageFile(path, file.path), 'Stage failed')}
              onDiscard={() => {
                if (window.confirm(`Discard changes in ${file.path}? This cannot be undone.`)) {
                  void run(() => ipc.discardFile(path, file.path), 'Discard failed');
                }
              }}
            />
          ),
        )}

      </div>

      <div className="shrink-0 border-t border-border-subtle p-3">
        <div className="relative">
          <Textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={amend ? 'New message (leave empty to keep current)' : 'Commit message'}
            className="min-h-[72px] pr-9 font-mono text-xs"
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void commit();
            }}
          />
          <Hint label="Generate message with AI">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Generate commit message with AI"
              className="absolute right-1.5 top-1.5"
              disabled={aiBusy}
              onClick={() => void generateMessage()}
            >
              {aiBusy ? <Spinner className="size-3.5" /> : <Sparkles className="size-3.5 text-primary" />}
            </Button>
          </Hint>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted">
            <Checkbox checked={amend} onCheckedChange={(v) => setAmend(v === true)} />
            <Undo2 className="size-3" /> Amend
          </label>
          <Button
            className="ml-auto"
            size="sm"
            disabled={committing || (!message.trim() && !amend) || (stagedFiles.length === 0 && !amend)}
            onClick={() => void commit()}
          >
            {committing && <Spinner className="text-primary-foreground" />}
            {amend ? 'Amend commit' : `Commit${stagedFiles.length > 0 ? ` ${stagedFiles.length} file${stagedFiles.length === 1 ? '' : 's'}` : ''}`}
          </Button>
        </div>
      </div>
    </div>
  );
}
