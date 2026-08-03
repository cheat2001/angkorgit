import { memo, useMemo } from 'react';
import type { DiffHunk, DiffLine, FileDiff } from '@angkorgit/core';
import { wordDiff, type WordSegment } from '@angkorgit/core';
import { cn } from '@angkorgit/design-system';
import { useUi } from '@/features/ui/store';
import { highlightLine, languageOf } from '@/shared/highlight';

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
}: {
  line: DiffLine;
  pair?: DiffLine | null;
  language: string | null;
  useWordDiff: boolean;
  side: 'old' | 'new';
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
      className="whitespace-pre-wrap break-all font-mono text-xs leading-5"
      dangerouslySetInnerHTML={{ __html: html || ' ' }}
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

function InlineHunk({ hunk, language, useWordDiff, actions }: HunkProps) {
  const pairs = useMemo(() => pairHunkLines(hunk), [hunk]);
  // Map: for word-diff we need each line's counterpart.
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
            />
          </div>
        </div>
      ))}
    </div>
  );
}

function SplitHunk({ hunk, language, useWordDiff, actions }: HunkProps) {
  const pairs = useMemo(() => pairHunkLines(hunk), [hunk]);
  return (
    <div>
      <HunkHeader hunk={hunk} actions={actions} />
      {pairs.map((pair, i) => (
        <div key={i} className="flex">
          <div className={cn('flex w-1/2 border-r border-border-subtle', pair.left ? lineBg(pair.left.kind === 'context' ? 'context' : 'deletion') : 'bg-surface-raised/40')}>
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
                />
              )}
            </div>
          </div>
          <div className={cn('flex w-1/2', pair.right ? lineBg(pair.right.kind === 'context' ? 'context' : 'addition') : 'bg-surface-raised/40')}>
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
                />
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

interface HunkProps {
  hunk: DiffHunk;
  language: string | null;
  useWordDiff: boolean;
  actions?: React.ReactNode;
}

function HunkHeader({ hunk, actions }: { hunk: DiffHunk; actions?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 border-y border-border-subtle bg-surface-raised/60 px-3 py-1">
      <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-info">{hunk.header}</span>
      {actions}
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
  const { diffView, wordDiff: useWord } = useUi();
  const language = useMemo(() => languageOf(diff.path), [diff.path]);

  if (diff.isImage) return <ImageDiff diff={diff} />;
  if (diff.isBinary) {
    return <p className="py-8 text-center text-sm text-faint">Binary file — no text diff</p>;
  }
  if (diff.hunks.length === 0) {
    return <p className="py-8 text-center text-sm text-faint">No changes</p>;
  }

  return (
    <div className="overflow-x-auto">
      {diff.hunks.map((hunk, i) =>
        diffView === 'split' ? (
          <SplitHunk key={i} hunk={hunk} language={language} useWordDiff={useWord} actions={hunkActions?.(i)} />
        ) : (
          <InlineHunk key={i} hunk={hunk} language={language} useWordDiff={useWord} actions={hunkActions?.(i)} />
        ),
      )}
    </div>
  );
}
