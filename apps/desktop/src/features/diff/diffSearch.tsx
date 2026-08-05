import { useEffect, useMemo, useRef, useState } from 'react';
import { CaseSensitive, ChevronDown, ChevronUp, X } from 'lucide-react';
import type { DiffLine, FileDiff } from '@angkorgit/core';
import { Button, Hint, Kbd, cn } from '@angkorgit/design-system';
import { useUi } from '@/features/ui/store';
import type { SearchRange, SearchRanges } from './diffShared';
import { flattenDiff, HEADER_H, LINE_H } from './VirtualDiff';

interface DiffMatch {
  line: DiffLine;
  start: number;
  end: number;
}

function findMatches(diff: FileDiff, query: string, caseSensitive: boolean): DiffMatch[] {
  if (!query) return [];
  const matches: DiffMatch[] = [];
  const q = caseSensitive ? query : query.toLowerCase();
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      const hay = caseSensitive ? line.content : line.content.toLowerCase();
      let idx = hay.indexOf(q);
      while (idx !== -1) {
        matches.push({ line, start: idx, end: idx + query.length });
        idx = hay.indexOf(q, idx + Math.max(query.length, 1));
      }
    }
  }
  return matches;
}

export function useDiffFind(diff: FileDiff | null, scrollRef: React.RefObject<HTMLDivElement>) {
  const { diffView, wrapLines } = useUi();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [current, setCurrent] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const matches = useMemo(
    () => (diff && open ? findMatches(diff, query, caseSensitive) : []),
    [diff, open, query, caseSensitive],
  );
  const bounded = matches.length > 0 ? current % matches.length : 0;

  useEffect(() => {
    setCurrent(0);
  }, [query, caseSensitive, diff]);

  const search = useMemo<SearchRanges | undefined>(() => {
    if (!open || matches.length === 0) return undefined;
    const map: SearchRanges = new Map();
    matches.forEach((m, i) => {
      const ranges = map.get(m.line) ?? [];
      ranges.push({ start: m.start, end: m.end, current: i === bounded });
      map.set(m.line, ranges);
    });
    return map;
  }, [open, matches, bounded]);

  useEffect(() => {
    if (!open || matches.length === 0 || !diff) return;
    const el = scrollRef.current;
    if (!el) return;
    if (wrapLines) {
      requestAnimationFrame(() => {
        el.querySelector('[data-search-current="true"]')?.scrollIntoView({ block: 'center' });
      });
      return;
    }
    const target = matches[bounded];
    const rows = flattenDiff(diff, diffView === 'split');
    let offset = 0;
    for (const row of rows) {
      const hit =
        row.kind === 'line'
          ? row.line === target.line
          : row.kind === 'pair' && (row.left === target.line || row.right === target.line);
      if (hit) break;
      offset += row.kind === 'header' ? HEADER_H : LINE_H;
    }
    el.scrollTo({ top: Math.max(0, offset - el.clientHeight * 0.35) });
  }, [open, matches, bounded, diff, diffView, wrapLines, scrollRef]);

  useEffect(() => {
    if (!diff) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => inputRef.current?.select());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [diff]);

  const next = () => matches.length > 0 && setCurrent((c) => (c + 1) % matches.length);
  const prev = () => matches.length > 0 && setCurrent((c) => (c - 1 + matches.length) % matches.length);
  const close = () => setOpen(false);

  const findBar = open ? (
    <div className="absolute right-6 top-2 z-20 flex items-center gap-1 rounded-md border border-border bg-surface-overlay py-1 pl-2 pr-1 shadow-soft">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            close();
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (e.shiftKey) prev();
            else next();
          }
        }}
        placeholder="Find in diff…"
        autoFocus
        spellCheck={false}
        className="w-44 bg-transparent text-xs text-foreground outline-none placeholder:text-faint"
      />
      <span className="shrink-0 whitespace-nowrap px-1 text-[10px] tabular-nums text-muted">
        {query ? (matches.length > 0 ? `${bounded + 1} of ${matches.length}` : 'No results') : ''}
      </span>
      <Hint label="Match case">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Match case"
          className={cn('size-6', caseSensitive && 'bg-surface-raised text-primary')}
          onClick={() => setCaseSensitive((v) => !v)}
        >
          <CaseSensitive className="size-3.5" />
        </Button>
      </Hint>
      <Hint label="Previous match (⇧↩)">
        <Button variant="ghost" size="icon-sm" aria-label="Previous match" className="size-6" disabled={matches.length === 0} onClick={prev}>
          <ChevronUp className="size-3.5" />
        </Button>
      </Hint>
      <Hint label="Next match (↩)">
        <Button variant="ghost" size="icon-sm" aria-label="Next match" className="size-6" disabled={matches.length === 0} onClick={next}>
          <ChevronDown className="size-3.5" />
        </Button>
      </Hint>
      <Hint
        label={
          <span className="flex items-center gap-1">
            Close <Kbd>Esc</Kbd>
          </span>
        }
      >
        <Button variant="ghost" size="icon-sm" aria-label="Close search" className="size-6" onClick={close}>
          <X className="size-3.5" />
        </Button>
      </Hint>
    </div>
  ) : null;

  return { findBar, search };
}

export type { SearchRange, SearchRanges };
