import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FileDiff } from '@angkorgit/core';
import type { DiffViewMode } from '@/features/ui/store';

/**
 * Change-overview rail (minimap) for the diff view: one marker per changed
 * line at its proportional position, a live viewport indicator, and
 * click-to-jump. Powers the header's prev/next-change buttons too.
 */

type RowKind = 'header' | 'context' | 'addition' | 'deletion' | 'mixed';

/** Flatten the diff into the rows the viewer actually renders. */
function logicalRows(diff: FileDiff, view: DiffViewMode): RowKind[] {
  const rows: RowKind[] = [];
  for (const hunk of diff.hunks) {
    rows.push('header');
    if (view === 'inline') {
      for (const line of hunk.lines) rows.push(line.kind);
    } else {
      // split view pairs deletions with additions, mirroring pairHunkLines()
      let pendingDeletions = 0;
      const flush = () => {
        for (let i = 0; i < pendingDeletions; i++) rows.push('deletion');
        pendingDeletions = 0;
      };
      for (const line of hunk.lines) {
        if (line.kind === 'deletion') {
          pendingDeletions++;
        } else if (line.kind === 'addition') {
          if (pendingDeletions > 0) {
            pendingDeletions--;
            rows.push('mixed');
          } else {
            rows.push('addition');
          }
        } else {
          flush();
          rows.push('context');
        }
      }
      flush();
    }
  }
  return rows;
}

export interface ChangeBlock {
  /** 0..1 position of the block's first row */
  fraction: number;
  kind: RowKind;
}

/** Consecutive changed rows collapse into one jumpable block. */
export function changeBlocks(diff: FileDiff, view: DiffViewMode): ChangeBlock[] {
  const rows = logicalRows(diff, view);
  const total = Math.max(rows.length, 1);
  const blocks: ChangeBlock[] = [];
  let inBlock = false;
  rows.forEach((kind, index) => {
    const changed = kind === 'addition' || kind === 'deletion' || kind === 'mixed';
    if (changed && !inBlock) {
      blocks.push({ fraction: index / total, kind });
      inBlock = true;
    } else if (!changed) {
      inBlock = false;
    }
  });
  return blocks;
}

export function scrollToFraction(el: HTMLElement, fraction: number): void {
  el.scrollTo({
    top: Math.max(0, fraction * el.scrollHeight - el.clientHeight * 0.35),
    behavior: 'smooth',
  });
}

const MARKER_COLOR: Record<string, string> = {
  addition: 'hsl(var(--success))',
  deletion: 'hsl(var(--danger))',
  mixed: 'hsl(var(--primary))',
};

export function DiffMinimap({
  diff,
  view,
  scrollRef,
}: {
  diff: FileDiff;
  view: DiffViewMode;
  scrollRef: React.RefObject<HTMLDivElement>;
}) {
  const railRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 1 });

  const rows = useMemo(() => logicalRows(diff, view), [diff, view]);
  const total = Math.max(rows.length, 1);
  const markers = useMemo(
    () =>
      rows
        .map((kind, index) => ({ kind, index }))
        .filter((r) => r.kind === 'addition' || r.kind === 'deletion' || r.kind === 'mixed'),
    [rows],
  );

  const syncViewport = useCallback(() => {
    const el = scrollRef.current;
    if (!el || el.scrollHeight === 0) return;
    setViewport({
      top: el.scrollTop / el.scrollHeight,
      height: Math.min(1, el.clientHeight / el.scrollHeight),
    });
  }, [scrollRef]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    syncViewport();
    el.addEventListener('scroll', syncViewport, { passive: true });
    const observer = new ResizeObserver(syncViewport);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', syncViewport);
      observer.disconnect();
    };
  }, [scrollRef, syncViewport, diff]);

  const jump = (event: React.MouseEvent) => {
    const rail = railRef.current;
    const el = scrollRef.current;
    if (!rail || !el) return;
    const rect = rail.getBoundingClientRect();
    const fraction = (event.clientY - rect.top) / rect.height;
    scrollToFraction(el, fraction);
  };

  if (markers.length === 0) return null;

  return (
    <div
      ref={railRef}
      className="relative w-3.5 shrink-0 cursor-pointer border-l border-border-subtle bg-surface"
      onMouseDown={jump}
      role="scrollbar"
      aria-label="Change overview — click to jump"
      aria-valuenow={Math.round(viewport.top * 100)}
    >
      {markers.map(({ kind, index }) => (
        <span
          key={index}
          className="absolute left-0.5 right-0.5 rounded-full"
          style={{
            top: `${(index / total) * 100}%`,
            height: `max(2px, ${100 / total}%)`,
            background: MARKER_COLOR[kind],
          }}
        />
      ))}
      <span
        className="absolute inset-x-0 rounded-sm bg-foreground/15 ring-1 ring-inset ring-foreground/20"
        style={{ top: `${viewport.top * 100}%`, height: `${Math.max(viewport.height * 100, 2)}%` }}
      />
    </div>
  );
}
