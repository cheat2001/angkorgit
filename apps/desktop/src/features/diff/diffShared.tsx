import { memo, useMemo } from 'react';
import type { DiffHunk, DiffLine } from '@angkorgit/core';
import { wordDiff, type WordSegment } from '@angkorgit/core';
import { cn } from '@angkorgit/design-system';
import { highlightLine } from '@/shared/highlight';

export interface LinePair {
  left: DiffLine | null;
  right: DiffLine | null;
}

export function pairHunkLines(hunk: DiffHunk): LinePair[] {
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

export const CodeLine = memo(function CodeLine({
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

export function lineBg(kind: DiffLine['kind']): string {
  if (kind === 'addition') return 'bg-diff-add/15';
  if (kind === 'deletion') return 'bg-diff-del/15';
  return '';
}

export function gutter(no: number | null): string {
  return no === null ? '' : String(no);
}
