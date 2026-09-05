import { useLayoutEffect, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { toast } from 'sonner';
import { ChevronRight, Cloud, Copy, Maximize2, Monitor, Sparkles, Tag as TagIcon } from 'lucide-react';
import type { CommitFileInfo, CommitInfo, FileDiff } from '@angkorgit/core';
import { aiCapabilities } from '@angkorgit/core';
import { Badge, Button, Hint, Logo, cn } from '@angkorgit/design-system';
import { ipc } from '@/core/ipc';
import { useGraph } from '@/features/graph/store';
import { useRepo } from '@/features/repository/store';
import { useUi } from '@/features/ui/store';
import { aiConfigured, getAiProvider } from '@/features/ai/client';
import { AiText } from '@/features/ai/AiText';
import { AiResultDialog } from '@/features/ai/AiResultDialog';
import { explainKeyFor, useAiWork } from '@/features/ai/workStore';
import { Avatar } from '@/components/Avatar';
import { FileTree, treeIndent } from '@/components/FileTree';
import { basename, dirname, formatDate, timeAgo } from '@/shared/utils';

const diffPath = (diff: CommitFileInfo) => diff.path;

const VIRTUAL_FILE_THRESHOLD = 200;
const FILE_ROW_HEIGHT = 34;

const statusMeta: Record<
  CommitFileInfo['status'],
  { label: string; mark: string; className: string; tone: 'info' | 'success' | 'danger' | 'primary' }
> = {
  modified: { label: 'modified', mark: 'M', className: 'text-info', tone: 'info' },
  new: { label: 'added', mark: 'A', className: 'text-success', tone: 'success' },
  deleted: { label: 'deleted', mark: 'D', className: 'text-danger', tone: 'danger' },
  renamed: { label: 'renamed', mark: 'R', className: 'text-primary', tone: 'primary' },
};

function ChangeSummary({ diffs }: { diffs: CommitFileInfo[] }) {
  if (diffs.length === 0) return <>No changes</>;
  const order: CommitFileInfo['status'][] = ['modified', 'new', 'deleted', 'renamed'];
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

function VirtualFileRows({
  diffs,
  scrollRef,
  renderRow,
}: {
  diffs: CommitFileInfo[];
  scrollRef: React.RefObject<HTMLDivElement>;
  renderRow: (diff: CommitFileInfo) => React.ReactNode;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [scrollMargin, setScrollMargin] = useState(0);
  useLayoutEffect(() => {
    const el = listRef.current;
    if (el) setScrollMargin((prev) => (prev === el.offsetTop ? prev : el.offsetTop));
  });
  const virtualizer = useVirtualizer({
    count: diffs.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => FILE_ROW_HEIGHT,
    getItemKey: (index) => diffs[index].path,
    overscan: 12,
    scrollMargin,
  });
  return (
    <div ref={listRef} className="relative" style={{ height: virtualizer.getTotalSize() }}>
      {virtualizer.getVirtualItems().map((item) => (
        <div
          key={item.key}
          className="absolute left-0 w-full"
          style={{
            top: 0,
            height: item.size,
            transform: `translateY(${item.start - scrollMargin}px)`,
          }}
        >
          {renderRow(diffs[item.index])}
        </div>
      ))}
    </div>
  );
}

export function CommitDetails({
  commit,
  diffs,
  loading,
  error,
  onRetry,
}: {
  commit: CommitInfo;
  diffs: CommitFileInfo[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const select = useGraph((s) => s.select);
  const openCenterDiff = useUi((s) => s.openCenterDiff);
  const closeCenterDiff = useUi((s) => s.closeCenterDiff);
  const centerDiff = useUi((s) => s.centerDiff);
  const fileTree = useUi((s) => s.fileTree);
  const repoPath = useRepo((s) => s.repo?.path ?? '');
  const explainKey = explainKeyFor(repoPath, commit.oid);
  const aiText = useAiWork((s) => s.explains[explainKey] ?? null);
  const aiBusy = useAiWork((s) => !!s.explainBusy[explainKey]);
  const [aiExpanded, setAiExpanded] = useState(false);
  const [bodyExpanded, setBodyExpanded] = useState(false);
  const longBody = commit.body.split('\n').length > 8 || commit.body.length > 600;
  const scrollRef = useRef<HTMLDivElement>(null);

  const renderDiffRow = (diff: CommitFileInfo, depth?: number) => {
    const active = centerDiff?.path === diff.path && centerDiff.oid === commit.oid;
    const meta = statusMeta[diff.status];
    return (
      <Hint key={diff.path} label={diff.path} side="left" className="max-w-[34rem] font-mono">
        <button
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
            active ? 'bg-primary/10 text-foreground' : 'hover:bg-surface-raised',
          )}
          style={fileTree && depth !== undefined ? { paddingLeft: treeIndent(depth) } : undefined}
          onClick={() =>
            active
              ? closeCenterDiff()
              : openCenterDiff({ path: diff.path, oid: commit.oid, oldPath: diff.oldPath })
          }
        >
          <Badge tone={meta?.tone ?? 'neutral'} className="w-5 shrink-0 justify-center px-0 font-mono">
            {meta?.mark ?? '?'}
          </Badge>
          <span className="flex min-w-0 flex-1 items-baseline gap-1">
            <span className="min-w-0 truncate">{basename(diff.path)}</span>
            {!fileTree && dirname(diff.path) && (
              <span className="min-w-0 truncate text-[11px] text-faint">{dirname(diff.path)}</span>
            )}
          </span>
          {diff.additions > 0 && <span className="shrink-0 font-mono text-[11px] text-success">+{diff.additions}</span>}
          {diff.deletions > 0 && <span className="shrink-0 font-mono text-[11px] text-danger">−{diff.deletions}</span>}
          <ChevronRight className={cn('size-3.5 shrink-0 text-faint transition-transform', active && 'rotate-90')} />
        </button>
      </Hint>
    );
  };

  const explain = async () => {
    const key = explainKey;
    if (aiBusy) {
      useAiWork.getState().stopExplain(key);
      return;
    }
    if (!aiConfigured()) {
      toast.info('Configure an AI provider in Settings first');
      return;
    }
    const run = useAiWork.getState().startExplain(key);
    const stillRunning = () => useAiWork.getState().isExplainRun(key, run);
    try {
      const fullDiffs = await ipc.diffCommit(repoPath, commit.oid);
      if (!stillRunning()) return;
      const text = await aiCapabilities.explainDiff(getAiProvider(), diffToText(fullDiffs));
      if (stillRunning()) useAiWork.getState().setExplain(key, text);
    } catch (error) {
      if (stillRunning()) {
        toast.error(`AI request failed: ${(error as { message?: string } | null)?.message ?? String(error)}`);
      }
    } finally {
      useAiWork.getState().endExplain(key, run);
    }
  };

  return (
    <div ref={scrollRef} className="flex h-full flex-col overflow-y-auto">
      <div className="border-b border-border-subtle px-4 pb-4 pt-3">
        <h2 className="text-sm font-semibold leading-snug text-foreground [overflow-wrap:anywhere]">
          {commit.summary}
        </h2>
        {commit.body && (
          <div className="relative mt-2">
            <pre
              className={cn(
                'whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-muted',
                longBody && !bodyExpanded && 'max-h-36 overflow-hidden',
              )}
            >
              {commit.body}
            </pre>
            {longBody && !bodyExpanded && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-surface to-transparent" />
            )}
            {longBody && (
              <button
                type="button"
                className="mt-1 text-[11px] font-medium text-primary hover:underline"
                onClick={() => setBodyExpanded((v) => !v)}
              >
                {bodyExpanded ? 'Show less' : 'Show more'}
              </button>
            )}
          </div>
        )}

        <div className="mt-3 rounded-md border border-border-subtle bg-surface-raised/50 p-2.5">
          <div className="flex items-center gap-2.5">
            <Avatar name={commit.author.name} email={commit.author.email} size={28} />
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <span className="truncate text-xs font-medium text-foreground">{commit.author.name}</span>
              <span className="truncate text-[11px] text-faint" title={formatDate(commit.author.time)}>
                {timeAgo(commit.author.time)} · {formatDate(commit.author.time)}
                {commit.committer.email !== commit.author.email && ` · committed by ${commit.committer.name}`}
              </span>
            </span>
            <Hint label="Copy full hash">
              <button
                className="flex h-6 shrink-0 items-center gap-1 rounded-md border border-border bg-surface px-1.5 font-mono text-[11px] text-muted hover:text-foreground"
                aria-label="Copy commit hash"
                onClick={() => {
                  void navigator.clipboard.writeText(commit.oid);
                  toast.success('Commit hash copied');
                }}
              >
                {commit.shortOid} <Copy className="size-2.5" />
              </button>
            </Hint>
          </div>
          {(commit.parents.length > 0 || commit.refs.length > 0) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-border-subtle pt-2">
              {commit.parents.length > 0 && (
                <span className="text-[11px] text-faint">{commit.parents.length > 1 ? 'Parents' : 'Parent'}</span>
              )}
              {commit.parents.map((parent) => (
                <button
                  key={parent}
                  className="flex h-5 items-center rounded border border-border-subtle bg-surface px-1.5 font-mono text-[10px] text-muted hover:text-foreground"
                  onClick={() => select(parent)}
                  title="Show this commit"
                >
                  {parent.slice(0, 7)}
                </button>
              ))}
              {commit.refs.length > 0 && commit.parents.length > 0 && (
                <span className="mx-0.5 h-3 w-px bg-border-subtle" />
              )}
              {commit.refs.map((ref) => (
                <Badge
                  key={ref.name}
                  tone={ref.kind === 'tag' ? 'primary' : ref.kind === 'remoteBranch' ? 'info' : 'success'}
                  className="max-w-48"
                >
                  {ref.kind === 'tag' && <TagIcon className="size-2.5 shrink-0" />}
                  {ref.kind === 'remoteBranch' && <Cloud className="size-2.5 shrink-0" />}
                  {(ref.kind === 'localBranch' || ref.kind === 'head') && <Monitor className="size-2.5 shrink-0" />}
                  <span className="truncate">{ref.shorthand}</span>
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="mt-2 flex justify-end">
          <Button variant="ghost" size="sm" className="text-muted" onClick={() => void explain()} disabled={loading}>
            {aiBusy ? (
              <>
                <Logo size={14} animated="loop" className="logo-draw-loop" />
                Stop explaining
              </>
            ) : (
              <>
                <Sparkles className="text-primary" />
                Explain with AI
              </>
            )}
          </Button>
        </div>
        {aiText && (
          <div className="mt-1 rounded-md border border-primary/30 bg-primary/5 text-xs leading-relaxed">
            <div className="flex items-center justify-between pl-3 pr-1.5 pt-1.5">
              <span className="flex items-center gap-1.5 font-medium text-primary">
                <Sparkles className="size-3.5" /> AI explanation
              </span>
              <Hint label="Open explanation in full view">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Open AI explanation in full view"
                  onClick={() => setAiExpanded(true)}
                >
                  <Maximize2 className="size-3" />
                </Button>
              </Hint>
            </div>
            <div className="px-3 pb-2.5 pt-1">
              <AiText text={aiText} />
            </div>
          </div>
        )}
        <AiResultDialog
          open={aiExpanded && !!aiText}
          onOpenChange={(open) => !open && setAiExpanded(false)}
          title="AI explanation"
          icon={<Sparkles className="size-4 text-primary" />}
          text={aiText ?? ''}
        />
      </div>

      <div className="p-2">
        <p className="flex items-center justify-between px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted">
          <span>
            Files{!loading && !error && <span className="ml-1 text-faint">{diffs.length}</span>}
          </span>
          <span className="text-[11px] font-normal normal-case tracking-normal">
            {loading ? 'Loading…' : error ? '' : <ChangeSummary diffs={diffs} />}
          </span>
        </p>
        {loading ? (
          <div className="space-y-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-7 animate-pulse rounded-md bg-surface-raised" />
            ))}
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 px-2 py-1.5">
            <span className="min-w-0 flex-1 text-xs text-danger [overflow-wrap:anywhere]">
              Could not load changes: {error}
            </span>
            <Button variant="ghost" size="sm" className="shrink-0" onClick={onRetry}>
              Retry
            </Button>
          </div>
        ) : fileTree ? (
          <FileTree items={diffs} pathOf={diffPath} renderFile={renderDiffRow} />
        ) : diffs.length > VIRTUAL_FILE_THRESHOLD ? (
          <VirtualFileRows diffs={diffs} scrollRef={scrollRef} renderRow={renderDiffRow} />
        ) : (
          diffs.map((diff) => renderDiffRow(diff))
        )}
      </div>
    </div>
  );
}
