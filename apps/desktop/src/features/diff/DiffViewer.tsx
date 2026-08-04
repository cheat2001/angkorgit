import { useMemo } from 'react';
import type { DiffHunk, FileDiff } from '@angkorgit/core';
import { cn } from '@angkorgit/design-system';
import { useUi } from '@/features/ui/store';
import { languageOf } from '@/shared/highlight';
import { CodeLine, gutter, lineBg, pairHunkLines } from './diffShared';
import { flattenDiff, VirtualInlineDiff, VirtualSplitDiff, type LineMenuInfo } from './VirtualDiff';

/**
 * Diff rendering. The default no-wrap mode is fully virtualized — only
 * visible lines are in the DOM (and only they are syntax-highlighted), so
 * whole-file diffs of any size load instantly and scroll smoothly. The
 * opt-in wrap mode renders classically since folded lines have variable
 * heights.
 */

interface HunkProps {
  hunk: DiffHunk;
  language: string | null;
  useWordDiff: boolean;
  actions?: React.ReactNode;
}

function HunkHeader({ hunk, actions }: { hunk: DiffHunk; actions?: React.ReactNode }) {
  return (
    <div className="sticky left-0 flex items-center gap-2 border-y border-border-subtle bg-surface-raised/60 px-3 py-1">
      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-info">{hunk.header}</span>
      {actions}
    </div>
  );
}

/** Wrap-mode inline view: lines fold when long. */
function WrappedInlineHunk({ hunk, language, useWordDiff, actions }: HunkProps) {
  const pairs = useMemo(() => pairHunkLines(hunk), [hunk]);
  const counterpart = useMemo(() => {
    const map = new Map();
    for (const p of pairs) {
      if (p.left && p.right && p.left !== p.right) {
        map.set(p.left, p.right);
        map.set(p.right, p.left);
      }
    }
    return map;
  }, [pairs]);

  return (
    <div>
      <HunkHeader hunk={hunk} actions={actions} />
      {hunk.lines.map((line, i) => (
        <div key={i} className={cn('flex', lineBg(line.kind))}>
          <span className="w-10 shrink-0 select-none border-r border-border-subtle pr-1.5 text-right font-mono text-[10px] leading-5 text-faint">
            {gutter(line.oldLineNo)}
          </span>
          <span className="w-10 shrink-0 select-none border-r border-border-subtle pr-1.5 text-right font-mono text-[10px] leading-5 text-faint">
            {gutter(line.newLineNo)}
          </span>
          <span
            className={cn(
              'w-5 shrink-0 select-none text-center font-mono text-xs leading-5',
              line.kind === 'addition' && 'text-success',
              line.kind === 'deletion' && 'text-danger',
            )}
          >
            {line.kind === 'addition' ? '+' : line.kind === 'deletion' ? '−' : ''}
          </span>
          <div className="min-w-0 flex-1 px-1">
            <CodeLine
              line={line}
              pair={counterpart.get(line)}
              language={language}
              useWordDiff={useWordDiff}
              side={line.kind === 'deletion' ? 'old' : 'new'}
              wrap
            />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Wrap-mode split view: paired rows, lines fold when long. */
function WrappedSplitHunk({ hunk, language, useWordDiff, actions }: HunkProps) {
  const pairs = useMemo(() => pairHunkLines(hunk), [hunk]);
  return (
    <div>
      <HunkHeader hunk={hunk} actions={actions} />
      {pairs.map((pair, i) => (
        <div key={i} className="flex">
          <div
            className={cn(
              'flex w-1/2 border-r border-border-subtle',
              pair.left ? lineBg(pair.left.kind === 'context' ? 'context' : 'deletion') : 'bg-surface-raised/40',
            )}
          >
            <span className="w-10 shrink-0 select-none border-r border-border-subtle pr-1.5 text-right font-mono text-[10px] leading-5 text-faint">
              {pair.left ? gutter(pair.left.oldLineNo) : ''}
            </span>
            <div className="min-w-0 flex-1 px-1.5">
              {pair.left && (
                <CodeLine
                  line={pair.left}
                  pair={pair.left.kind !== 'context' ? pair.right : null}
                  language={language}
                  useWordDiff={useWordDiff}
                  side="old"
                  wrap
                />
              )}
            </div>
          </div>
          <div
            className={cn(
              'flex w-1/2',
              pair.right ? lineBg(pair.right.kind === 'context' ? 'context' : 'addition') : 'bg-surface-raised/40',
            )}
          >
            <span className="w-10 shrink-0 select-none border-r border-border-subtle pr-1.5 text-right font-mono text-[10px] leading-5 text-faint">
              {pair.right ? gutter(pair.right.newLineNo) : ''}
            </span>
            <div className="min-w-0 flex-1 px-1.5">
              {pair.right && (
                <CodeLine
                  line={pair.right}
                  pair={pair.right.kind !== 'context' ? pair.left : null}
                  language={language}
                  useWordDiff={useWordDiff}
                  side="new"
                  wrap
                />
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ImageDiff({ diff }: { diff: FileDiff }) {
  const mime = diff.path.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
  return (
    <div className="flex gap-4 p-4">
      {diff.oldImage && (
        <figure className="flex-1 rounded-lg border border-danger/40 bg-surface p-3 text-center">
          <img src={`data:${mime};base64,${diff.oldImage}`} alt="Previous version" className="mx-auto max-h-72 max-w-full" />
          <figcaption className="mt-2 text-xs text-danger">Before</figcaption>
        </figure>
      )}
      {diff.newImage && (
        <figure className="flex-1 rounded-lg border border-success/40 bg-surface p-3 text-center">
          <img src={`data:${mime};base64,${diff.newImage}`} alt="New version" className="mx-auto max-h-72 max-w-full" />
          <figcaption className="mt-2 text-xs text-success">After</figcaption>
        </figure>
      )}
      {!diff.oldImage && !diff.newImage && (
        <p className="w-full py-8 text-center text-sm text-faint">Image contents unavailable</p>
      )}
    </div>
  );
}

export function DiffViewer({
  diff,
  scrollRef,
  hunkActions,
  onLineContextMenu,
}: {
  diff: FileDiff;
  /** the vertical scroll container (needed for virtualization) */
  scrollRef?: React.RefObject<HTMLDivElement>;
  /** optional per-hunk action buttons (stage/unstage hunk) */
  hunkActions?: (hunkIndex: number) => React.ReactNode;
  /** right-click on a diff line (inline view only) */
  onLineContextMenu?: (event: React.MouseEvent, info: LineMenuInfo) => void;
}) {
  const { diffView, wordDiff: useWord, wrapLines } = useUi();
  const language = useMemo(() => languageOf(diff.path), [diff.path]);
  const split = diffView === 'split';

  const flatRows = useMemo(
    () => (!wrapLines && scrollRef ? flattenDiff(diff, split) : []),
    [diff, split, wrapLines, scrollRef],
  );

  if (diff.isImage) return <ImageDiff diff={diff} />;
  if (diff.isBinary) {
    return <p className="py-8 text-center text-sm text-faint">Binary file — no text diff</p>;
  }
  if (diff.hunks.length === 0) {
    return <p className="py-8 text-center text-sm text-faint">No changes</p>;
  }

  // Fast path: virtualized no-wrap rendering.
  if (!wrapLines && scrollRef) {
    const props = {
      rows: flatRows,
      language,
      useWordDiff: useWord,
      scrollRef,
      hunkActions,
      onLineContextMenu,
    };
    return split ? <VirtualSplitDiff {...props} /> : <VirtualInlineDiff {...props} />;
  }

  // Wrap mode: classic rendering (variable row heights).
  return (
    <div>
      {diff.hunks.map((hunk, i) => {
        const props: HunkProps = {
          hunk,
          language,
          useWordDiff: useWord,
          actions: hunkActions?.(i),
        };
        return split ? <WrappedSplitHunk key={i} {...props} /> : <WrappedInlineHunk key={i} {...props} />;
      })}
    </div>
  );
}
