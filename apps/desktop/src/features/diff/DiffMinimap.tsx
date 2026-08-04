import { useEffect, useMemo, useRef } from 'react';
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

// Soft translucent markers — a fully-added file must read as a tinted rail,
// not a solid neon bar.
const MARKER_COLOR: Record<string, string> = {
  addition: 'hsl(var(--success) / 0.5)',
  deletion: 'hsl(var(--danger) / 0.5)',
  mixed: 'hsl(var(--primary) / 0.55)',
};

interface MarkerBlock {
  start: number;
  end: number;
  kind: RowKind;
}

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
  const indicatorRef = useRef<HTMLSpanElement>(null);

  const rows = useMemo(() => logicalRows(diff, view), [diff, view]);
  const total = Math.max(rows.length, 1);
  // Consecutive changed rows of the same kind render as ONE block: far fewer
  // DOM nodes and a cleaner rail than per-line markers.
  const markers = useMemo(() => {
    const blocks: MarkerBlock[] = [];
    rows.forEach((kind, index) => {
      if (kind !== 'addition' && kind !== 'deletion' && kind !== 'mixed') return;
      const last = blocks[blocks.length - 1];
      if (last && last.kind === kind && last.end === index) last.end = index + 1;
      else blocks.push({ start: index, end: index + 1, kind });
    });
    return blocks;
  }, [rows]);

  // The viewport indicator tracks scrolling OUTSIDE React: writing styles
  // directly (rAF-throttled) keeps scroll frames free of render work.
  useEffect(() => {
    const el = scrollRef.current;
    const indicator = indicatorRef.current;
    if (!el || !indicator) return;
    let raf = 0;
    const sync = () => {
      raf = 0;
      if (el.scrollHeight === 0) return;
      indicator.style.top = `${(el.scrollTop / el.scrollHeight) * 100}%`;
      indicator.style.height = `${Math.max((el.clientHeight / el.scrollHeight) * 100, 2)}%`;
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(sync);
    };
    sync();
    el.addEventListener('scroll', onScroll, { passive: true });
    const observer = new ResizeObserver(onScroll);
    observer.observe(el);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      el.removeEventListener('scroll', onScroll);
      observer.disconnect();
    };
  }, [scrollRef, diff, view]);

  // Press-and-drag scrubbing, like a scrollbar thumb: mousedown jumps, and
  // dragging keeps scrolling until release (instant, not smooth — smooth
  // scrolling would fight the pointer).
  const scrub = (event: React.MouseEvent) => {
    event.preventDefault();
    const rail = railRef.current;
    const el = scrollRef.current;
    if (!rail || !el) return;
    const moveTo = (clientY: number) => {
      const rect = rail.getBoundingClientRect();
      const fraction = Math.min(1, Math.max(0, (clientY - rect.top) / rect.height));
      el.scrollTop = Math.max(0, fraction * el.scrollHeight - el.clientHeight * 0.35);
    };
    moveTo(event.clientY);
    const onMove = (e: MouseEvent) => moveTo(e.clientY);
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  if (markers.length === 0) return null;

  return (
    <div
      ref={railRef}
      className="relative w-3.5 shrink-0 cursor-pointer border-l border-border-subtle bg-surface"
      onMouseDown={scrub}
      role="scrollbar"
      aria-label="Change overview — click to jump, drag to scroll"
    >
      {markers.map(({ kind, start, end }) => (
        <span
          key={start}
          className="absolute left-0.5 right-0.5 rounded-full"
          style={{
            top: `${(start / total) * 100}%`,
            height: `max(2px, ${((end - start) / total) * 100}%)`,
            background: MARKER_COLOR[kind],
          }}
        />
      ))}
      <span
        ref={indicatorRef}
        className="absolute inset-x-0 rounded-sm bg-foreground/15 ring-1 ring-inset ring-foreground/20"
      />
    </div>
  );
}
