import { memo, useMemo } from 'react';
import type { DiffLine, FileDiff } from '@angkorgit/core';
import { MAX_RENDERED_LINE, clipRenderedLine, wordDiff, type WordSegment } from '@angkorgit/core';
import { cn } from '@angkorgit/design-system';
import { embeddedDiffLanguages, highlightLineState, supportsBlockComments } from '@/shared/highlight';

const WRAP_LINE_LIMIT = 3000;

export function wrapUnavailable(diff: FileDiff): boolean {
  let total = 0;
  for (const hunk of diff.hunks) {
    total += hunk.lines.length;
    if (total > WRAP_LINE_LIMIT) return true;
  }
  return false;
}

export { pairHunkLines, type LinePair } from '@angkorgit/core';

const COMMENT_STATE_LINE_CAP = 8000;
const commentStates = new WeakMap<DiffLine, boolean>();
const lineLanguages = new WeakMap<DiffLine, string>();
const preparedDiffs = new WeakMap<FileDiff, string | null>();

export const lineLanguage = (line: DiffLine, language: string | null): string | null =>
  lineLanguages.get(line) ?? language;

export function prepareLineStates(diff: FileDiff, language: string | null): void {
  if (preparedDiffs.get(diff) === language) return;
  preparedDiffs.set(diff, language);
  let total = 0;
  for (const hunk of diff.hunks) total += hunk.lines.length;
  if (total > COMMENT_STATE_LINE_CAP) return;
  const overrides = embeddedDiffLanguages(diff.hunks, language);
  if (overrides) for (const [line, lang] of overrides) lineLanguages.set(line, lang);
  if (!supportsBlockComments(language) && !overrides) return;
  for (const hunk of diff.hunks) {
    let oldState = false;
    let newState = false;
    let previous = language;
    for (const line of hunk.lines) {
      const lang = lineLanguage(line, language);
      if (lang !== previous) {
        oldState = false;
        newState = false;
        previous = lang;
      }
      if (line.kind === 'deletion') {
        commentStates.set(line, oldState);
        oldState = highlightLineState(line.content, lang, oldState).endsInComment;
      } else if (line.kind === 'addition') {
        commentStates.set(line, newState);
        newState = highlightLineState(line.content, lang, newState).endsInComment;
      } else {
        commentStates.set(line, newState);
        const endsNew: boolean = highlightLineState(line.content, lang, newState).endsInComment;
        const endsOld: boolean =
          oldState === newState
            ? endsNew
            : highlightLineState(line.content, lang, oldState).endsInComment;
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
    const lang = lineLanguage(line, language);
    const clipped = clipRenderedLine(line.content);
    const pairWithinCap = !!pair && pair.content.length <= MAX_RENDERED_LINE;
    if (useWordDiff && pair && pairWithinCap && clipped.hidden === 0 && line.kind !== 'context' && pair.content !== line.content) {
      const diff = side === 'old' ? wordDiff(line.content, pair.content) : wordDiff(pair.content, line.content);
      return segmentsToHtml(side === 'old' ? diff.old : diff.new, lang, side, inComment);
    }
    if (clipped.hidden === 0) return highlightLineState(clipped.text, lang, inComment).html;
    const body = highlightLineState(clipped.text, null, false).html;
    return `${body}<span class="ml-2 rounded-sm bg-surface-raised px-1.5 text-faint" title="Only the first ${MAX_RENDERED_LINE.toLocaleString()} characters of this line are shown">… ${clipped.hidden.toLocaleString()} more characters</span>`;
  }, [line, pair, language, useWordDiff, side]);

  return (
    <span
      className={cn(
        'font-mono text-xs leading-5 [font-variant-ligatures:none]',
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
