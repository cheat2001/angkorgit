import { memo, useMemo } from 'react';
import type { DiffHunk, DiffLine, FileDiff } from '@angkorgit/core';
import { wordDiff, type WordSegment } from '@angkorgit/core';
import { cn } from '@angkorgit/design-system';
import { highlightLineState, supportsBlockComments } from '@/shared/highlight';

const WRAP_LINE_LIMIT = 3000;

export function wrapUnavailable(diff: FileDiff): boolean {
  let total = 0;
  for (const hunk of diff.hunks) {
    total += hunk.lines.length;
    if (total > WRAP_LINE_LIMIT) return true;
  }
  return false;
}

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

const COMMENT_STATE_LINE_CAP = 8000;
const commentStates = new WeakMap<DiffLine, boolean>();
const preparedDiffs = new WeakMap<FileDiff, string | null>();

export function prepareCommentStates(diff: FileDiff, language: string | null): void {
  if (!supportsBlockComments(language) || preparedDiffs.get(diff) === language) return;
  preparedDiffs.set(diff, language);
  let total = 0;
  for (const hunk of diff.hunks) total += hunk.lines.length;
  if (total > COMMENT_STATE_LINE_CAP) return;
  for (const hunk of diff.hunks) {
    let oldState = false;
    let newState = false;
    for (const line of hunk.lines) {
      if (line.kind === 'deletion') {
        commentStates.set(line, oldState);
        oldState = highlightLineState(line.content, language, oldState).endsInComment;
      } else if (line.kind === 'addition') {
        commentStates.set(line, newState);
        newState = highlightLineState(line.content, language, newState).endsInComment;
      } else {
        commentStates.set(line, newState);
        const endsNew: boolean = highlightLineState(line.content, language, newState).endsInComment;
        const endsOld: boolean =
          oldState === newState
            ? endsNew
            : highlightLineState(line.content, language, oldState).endsInComment;
        newState = endsNew;
        oldState = endsOld;
      }
    }
  }
}

export const startsInComment = (line: DiffLine): boolean => commentStates.get(line) ?? false;

function segmentsToHtml(
  segments: WordSegment[],
  language: string | null,
  side: 'old' | 'new',
  inComment: boolean,
): string {
  let state = inComment;
  return segments
    .map((seg) => {
      const highlighted = highlightLineState(seg.text, language, state);
      state = highlighted.endsInComment;
      if (seg.kind === 'equal') return highlighted.html;
      const cls = side === 'old' ? 'bg-diff-del/40 rounded-sm' : 'bg-diff-add/40 rounded-sm';
      return `<span class="${cls}">${highlighted.html}</span>`;
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
    const inComment = startsInComment(line);
    if (useWordDiff && pair && line.kind !== 'context' && pair.content !== line.content) {
      const diff = side === 'old' ? wordDiff(line.content, pair.content) : wordDiff(pair.content, line.content);
      return segmentsToHtml(side === 'old' ? diff.old : diff.new, language, side, inComment);
    }
    return highlightLineState(line.content, language, inComment).html;
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

export interface SearchRange {
  start: number;
  end: number;
  current: boolean;
}

export type SearchRanges = Map<DiffLine, SearchRange[]>;

export function lineBg(kind: DiffLine['kind']): string {
  if (kind === 'addition') return 'bg-diff-add/15';
  if (kind === 'deletion') return 'bg-diff-del/15';
  return '';
}

export function gutter(no: number | null): string {
  return no === null ? '' : String(no);
}
