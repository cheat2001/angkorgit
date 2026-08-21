import { useState } from 'react';
import { toast } from 'sonner';
import { ChevronRight, Copy, FileText, Sparkles, X } from 'lucide-react';
import type { CommitInfo, FileDiff } from '@angkorgit/core';
import { aiCapabilities } from '@angkorgit/core';
import { Badge, Button, Hint, Spinner, cn } from '@angkorgit/design-system';
import { useGraph } from '@/features/graph/store';
import { useUi } from '@/features/ui/store';
import { aiConfigured, getAiProvider } from '@/features/ai/client';
import { Avatar } from '@/components/Avatar';
import { FileTree, treeIndent } from '@/components/FileTree';
import { basename, dirname, formatDate } from '@/shared/utils';

const diffPath = (diff: FileDiff) => diff.path;

const statusMeta: Record<FileDiff['status'], { label: string; mark: string; className: string }> = {
  modified: { label: 'modified', mark: 'M', className: 'text-info' },
  new: { label: 'added', mark: 'A', className: 'text-success' },
  deleted: { label: 'deleted', mark: 'D', className: 'text-danger' },
  renamed: { label: 'renamed', mark: 'R', className: 'text-primary' },
};

function ChangeSummary({ diffs }: { diffs: FileDiff[] }) {
  if (diffs.length === 0) return <>No changes</>;
  const order: FileDiff['status'][] = ['modified', 'new', 'deleted', 'renamed'];
  const parts = order
    .map((status) => ({ status, count: diffs.filter((d) => d.status === status).length }))
    .filter((p) => p.count > 0);
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {parts.map(({ status, count }) => (
        <span key={status} className={cn('flex items-center gap-1', statusMeta[status].className)}>
          <span className="font-mono">{statusMeta[status].mark}</span>
          {count} {statusMeta[status].label}
        </span>
      ))}
    </span>
  );
}

function diffToText(diffs: FileDiff[]): string {
  return diffs
    .map(
      (d) =>
        `--- ${d.oldPath ?? d.path}\n+++ ${d.path}\n` +
        d.hunks
          .map((h) => `${h.header}\n${h.lines.map((l) => `${l.kind === 'addition' ? '+' : l.kind === 'deletion' ? '-' : ' '}${l.content}`).join('\n')}`)
          .join('\n'),
    )
    .join('\n\n');
}

export function CommitDetails({
  commit,
  diffs,
  loading,
}: {
  commit: CommitInfo;
  diffs: FileDiff[];
  loading: boolean;
}) {
  const select = useGraph((s) => s.select);
  const openCenterDiff = useUi((s) => s.openCenterDiff);
  const closeCenterDiff = useUi((s) => s.closeCenterDiff);
  const centerDiff = useUi((s) => s.centerDiff);
  const fileTree = useUi((s) => s.fileTree);
  const [aiText, setAiText] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const renderDiffRow = (diff: FileDiff, depth?: number) => {
    const active = centerDiff?.path === diff.path && centerDiff.oid === commit.oid;
    return (
      <Hint key={diff.path} label={diff.path} side="left" className="max-w-[34rem] font-mono">
        <button
          className={cn(
            'mb-1 flex w-full items-center gap-2 rounded-md border border-border-subtle px-2 py-1.5 text-left text-xs transition-colors',
            active ? 'border-primary/50 bg-primary/10' : 'bg-surface-raised/60 hover:bg-surface-raised',
          )}
          style={fileTree && depth !== undefined ? { paddingLeft: treeIndent(depth) } : undefined}
          onClick={() =>
            active ? closeCenterDiff() : openCenterDiff({ path: diff.path, oid: commit.oid })
          }
        >
          <FileText className={cn('size-3.5 shrink-0', statusMeta[diff.status]?.className ?? 'text-muted')} />
          <span className="flex min-w-0 flex-1 items-center font-mono">
            {!fileTree && dirname(diff.path) && (
              <span className="min-w-0 truncate text-faint">{dirname(diff.path)}/</span>
            )}
            <span className="max-w-full shrink-0 truncate">{basename(diff.path)}</span>
          </span>
          <span className="shrink-0 text-success">+{diff.additions}</span>
          <span className="shrink-0 text-danger">−{diff.deletions}</span>
          <ChevronRight className="size-3.5 shrink-0 text-faint" />
        </button>
      </Hint>
    );
  };

  const close = () => {
    closeCenterDiff();
    select(null);
  };

  const explain = async () => {
    if (!aiConfigured()) {
      toast.info('Configure an AI provider in Settings first');
      return;
    }
    setAiBusy(true);
    try {
      const text = await aiCapabilities.explainDiff(getAiProvider(), diffToText(diffs));
      setAiText(text);
    } catch (error) {
      toast.error(`AI request failed: ${(error as { message?: string }).message ?? error}`);
    } finally {
      setAiBusy(false);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="border-b border-border-subtle p-4">
        <div className="flex items-start gap-2">
          <p className="min-w-0 flex-1 text-sm font-medium leading-snug">{commit.summary}</p>
          <Hint label="Close">
            <Button variant="ghost" size="icon-sm" aria-label="Back to working copy" onClick={close}>
              <X className="size-3.5" />
            </Button>
          </Hint>
        </div>
        {commit.body && (
          <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-muted">{commit.body}</pre>
        )}
        <div className="mt-3 flex items-center gap-2 text-xs text-muted">
          <Avatar name={commit.author.name} email={commit.author.email} size={24} />
          <span>{commit.author.name}</span>
          <span className="text-faint">{formatDate(commit.author.time)}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button
            className="flex items-center gap-1 rounded border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[10px] text-muted hover:text-foreground"
            onClick={() => {
              void navigator.clipboard.writeText(commit.oid);
              toast.success('Commit hash copied');
            }}
          >
            {commit.shortOid} <Copy className="size-2.5" />
          </button>
          {commit.parents.map((parent) => (
            <button
              key={parent}
              className="rounded border border-border-subtle px-1.5 py-0.5 font-mono text-[10px] text-faint hover:text-foreground"
              onClick={() => select(parent)}
              title="Go to parent"
            >
              ← {parent.slice(0, 7)}
            </button>
          ))}
          {commit.refs.map((ref) => (
            <Badge key={ref.name} tone={ref.kind === 'tag' ? 'primary' : 'success'}>
              {ref.shorthand}
            </Badge>
          ))}
        </div>
        <div className="mt-3">
          <Button variant="secondary" size="sm" onClick={() => void explain()} disabled={aiBusy || loading}>
            {aiBusy ? <Spinner /> : <Sparkles className="text-primary" />}
            Explain with AI
          </Button>
        </div>
        {aiText && (
          <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 p-3 text-xs leading-relaxed">
            <pre className="min-w-0 whitespace-pre-wrap break-words font-sans">{aiText}</pre>
          </div>
        )}
      </div>

      <div className="p-2">
        <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted">
          {loading ? 'Loading changes…' : <ChangeSummary diffs={diffs} />}
        </p>
        {fileTree ? (
          <FileTree items={diffs} pathOf={diffPath} renderFile={renderDiffRow} />
        ) : (
          diffs.map((diff) => renderDiffRow(diff))
        )}
      </div>
    </div>
  );
}
