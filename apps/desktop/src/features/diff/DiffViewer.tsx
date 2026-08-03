import { memo, useMemo, useRef } from 'react';
import type { DiffHunk, DiffLine, FileDiff } from '@angkorgit/core';
import { wordDiff, type WordSegment } from '@angkorgit/core';
import { cn } from '@angkorgit/design-system';
import { useUi } from '@/features/ui/store';
import { highlightLine, languageOf } from '@/shared/highlight';

/**
 * Diff rendering. Lines never soft-wrap by default — long lines scroll
 * horizontally exactly as in an editor, so the file's real formatting is
 * preserved on screen (the file itself is of course never modified either
 * way). The optional wrap mode folds long lines instead.
 */

/** Pair up deletions/additions inside a hunk for split view + word diff. */
interface LinePair {
  left: DiffLine | null;
  right: DiffLine | null;
}

function pairHunkLines(hunk: DiffHunk): LinePair[] {
  const pairs: LinePair[] = [];
  let pendingDeletions: DiffLine[] = [];

  const flush = () => {
    for (const del of pendingDeletions) pairs.push({ left: del, right: null });
    pendingDeletions = [];
  };

  for (const line of hunk.lines) {
    if (line.kind === 'deletion') {
      pendingDeletions.push(line);
    } else if (line.kind === 'addition') {
      const del = pendingDeletions.shift();
      pairs.push({ left: del ?? null, right: line });
    } else {
      flush();
      pairs.push({ left: line, right: line });
    }
  }
  flush();
  return pairs;
}

function segmentsToHtml(segments: WordSegment[], language: string | null, side: 'old' | 'new'): string {
  return segments
    .map((seg) => {
      const html = highlightLine(seg.text, language);
      if (seg.kind === 'equal') return html;
      const cls = side === 'old' ? 'bg-diff-del/40 rounded-sm' : 'bg-diff-add/40 rounded-sm';
      return `<span class="${cls}">${html}</span>`;
    })
    .join('');
}

const CodeLine = memo(function CodeLine({
  line,
  pair,
  language,
  useWordDiff,
  side,
  wrap,
}: {
  line: DiffLine;
  pair?: DiffLine | null;
  language: string | null;
  useWordDiff: boolean;
  side: 'old' | 'new';
  wrap: boolean;
}) {
  const html = useMemo(() => {
    if (useWordDiff && pair && line.kind !== 'context' && pair.content !== line.content) {
      const diff = side === 'old' ? wordDiff(line.content, pair.content) : wordDiff(pair.content, line.content);
      return segmentsToHtml(side === 'old' ? diff.old : diff.new, language, side);
    }
    return highlightLine(line.content, language);
  }, [line, pair, language, useWordDiff, side]);

  return (
    <span
      className={cn(
        'font-mono text-xs leading-5',
        wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre',
      )}
      dangerouslySetInnerHTML={{ __html: html || ' ' }}
    />
  );
});

function lineBg(kind: DiffLine['kind']): string {
  if (kind === 'addition') return 'bg-diff-add/15';
  if (kind === 'deletion') return 'bg-diff-del/15';
  return '';
}

function gutter(no: number | null): string {
  return no === null ? '' : String(no);
}

/** Line-number cell; sticks to the left edge while code scrolls under it. */
function Gutter({
  children,
  sticky,
  left,
  className,
}: {
  children: React.ReactNode;
  sticky: boolean;
  left: 0 | 10 | 20;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'w-10 shrink-0 select-none border-r border-border-subtle pr-1.5 text-right font-mono text-[10px] leading-5 text-faint',
        sticky && 'sticky z-[1] bg-surface',
        sticky && left === 0 && 'left-0',
        sticky && left === 10 && 'left-10',
        sticky && left === 20 && 'left-20',
        className,
      )}
    >
      {children}
    </span>
  );
}

interface HunkProps {
  hunk: DiffHunk;
  language: string | null;
  useWordDiff: boolean;
  wrap: boolean;
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

function InlineHunk({ hunk, language, useWordDiff, wrap, actions }: HunkProps) {
  const pairs = useMemo(() => pairHunkLines(hunk), [hunk]);
  const counterpart = useMemo(() => {
    const map = new Map<DiffLine, DiffLine>();
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
      <div className={wrap ? undefined : 'w-max min-w-full'}>
        {hunk.lines.map((line, i) => (
          <div key={i} className={cn('flex', lineBg(line.kind))}>
            <Gutter sticky={!wrap} left={0}>
              {gutter(line.oldLineNo)}
            </Gutter>
            <Gutter sticky={!wrap} left={10}>
              {gutter(line.newLineNo)}
            </Gutter>
            <span
              className={cn(
                'w-5 shrink-0 select-none text-center font-mono text-xs leading-5',
                !wrap && 'sticky left-20 z-[1] bg-surface',
                line.kind === 'addition' && 'text-success',
                line.kind === 'deletion' && 'text-danger',
              )}
            >
              {line.kind === 'addition' ? '+' : line.kind === 'deletion' ? '−' : ''}
            </span>
            <div className={cn('px-1', wrap && 'min-w-0 flex-1')}>
              <CodeLine
                line={line}
                pair={counterpart.get(line)}
                language={language}
                useWordDiff={useWordDiff}
                side={line.kind === 'deletion' ? 'old' : 'new'}
                wrap={wrap}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Wrap-mode split view: paired rows, lines fold when long. */
function SplitHunkWrapped({ hunk, language, useWordDiff, actions }: HunkProps) {
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
            <Gutter sticky={false} left={0}>
              {pair.left ? gutter(pair.left.oldLineNo) : ''}
            </Gutter>
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
            <Gutter sticky={false} left={0}>
              {pair.right ? gutter(pair.right.newLineNo) : ''}
            </Gutter>
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

interface ColumnProps {
  pairs: LinePair[];
  side: 'old' | 'new';
  language: string | null;
  useWordDiff: boolean;
  scrollRef: React.RefObject<HTMLDivElement>;
  onScroll: () => void;
}

/** One side of the no-wrap split view: its own horizontal scroll region. */
function SplitColumn({ pairs, side, language, useWordDiff, scrollRef, onScroll }: ColumnProps) {
  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      className={cn('w-1/2 overflow-x-auto', side === 'old' && 'border-r border-border-subtle')}
    >
      <div className="w-max min-w-full">
        {pairs.map((pair, i) => {
          const line = side === 'old' ? pair.left : pair.right;
          const other = side === 'old' ? pair.right : pair.left;
          return (
            <div
              key={i}
              className={cn(
                'flex',
                line
                  ? lineBg(line.kind === 'context' ? 'context' : side === 'old' ? 'deletion' : 'addition')
                  : 'bg-surface-raised/40',
              )}
            >
              <Gutter sticky left={0}>
                {line ? gutter(side === 'old' ? line.oldLineNo : line.newLineNo) : ''}
              </Gutter>
              <div className="px-1.5">
                {line ? (
                  <CodeLine
                    line={line}
                    pair={line.kind !== 'context' ? other : null}
                    language={language}
                    useWordDiff={useWordDiff}
                    side={side}
                    wrap={false}
                  />
                ) : (
                  <span className="font-mono text-xs leading-5"> </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** No-wrap split view: two columns with synchronized horizontal scrolling. */
function SplitHunkColumns({ hunk, language, useWordDiff, actions }: HunkProps) {
  const pairs = useMemo(() => pairHunkLines(hunk), [hunk]);
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  const sync = (from: React.RefObject<HTMLDivElement>, to: React.RefObject<HTMLDivElement>) => () => {
    if (from.current && to.current && to.current.scrollLeft !== from.current.scrollLeft) {
      to.current.scrollLeft = from.current.scrollLeft;
    }
  };

  return (
    <div>
      <HunkHeader hunk={hunk} actions={actions} />
      <div className="flex">
        <SplitColumn
          pairs={pairs}
          side="old"
          language={language}
          useWordDiff={useWordDiff}
          scrollRef={leftRef}
          onScroll={sync(leftRef, rightRef)}
        />
        <SplitColumn
          pairs={pairs}
          side="new"
          language={language}
          useWordDiff={useWordDiff}
          scrollRef={rightRef}
          onScroll={sync(rightRef, leftRef)}
        />
      </div>
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
  hunkActions,
}: {
  diff: FileDiff;
  /** optional per-hunk action buttons (stage/unstage hunk) */
  hunkActions?: (hunkIndex: number) => React.ReactNode;
}) {
  const { diffView, wordDiff: useWord, wrapLines } = useUi();
  const language = useMemo(() => languageOf(diff.path), [diff.path]);

  if (diff.isImage) return <ImageDiff diff={diff} />;
  if (diff.isBinary) {
    return <p className="py-8 text-center text-sm text-faint">Binary file — no text diff</p>;
  }
  if (diff.hunks.length === 0) {
    return <p className="py-8 text-center text-sm text-faint">No changes</p>;
  }

  return (
    <div className={wrapLines ? undefined : 'overflow-x-auto'}>
      {diff.hunks.map((hunk, i) => {
        const props: HunkProps = {
          hunk,
          language,
          useWordDiff: useWord,
          wrap: wrapLines,
          actions: hunkActions?.(i),
        };
        if (diffView === 'split') {
          return wrapLines ? <SplitHunkWrapped key={i} {...props} /> : <SplitHunkColumns key={i} {...props} />;
        }
        return <InlineHunk key={i} {...props} />;
      })}
    </div>
  );
}
