import { useEffect, useMemo, useRef } from 'react';
import type { FileDiff } from '@angkorgit/core';
import { useSettings } from '@/features/settings/store';
import type { DiffViewMode } from '@/features/ui/store';

type RowKind = 'header' | 'context' | 'addition' | 'deletion' | 'mixed';

function logicalRows(diff: FileDiff, view: DiffViewMode): RowKind[] {
  const rows: RowKind[] = [];
  for (const hunk of diff.hunks) {
    rows.push('header');
    if (view === 'inline') {
      for (const line of hunk.lines) rows.push(line.kind);
    } else {
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
  fraction: number;
  kind: RowKind;
}

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

export function scrollToFraction(
  el: HTMLElement,
  fraction: number,
  behavior?: ScrollBehavior,
): void {
  el.scrollTo({
    top: Math.max(0, fraction * el.scrollHeight - el.clientHeight * 0.35),
    behavior: behavior ?? (useSettings.getState().reduceMotion ? 'auto' : 'smooth'),
  });
}

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

const MAX_MARKERS = 200;

function bucketMarkers(blocks: MarkerBlock[], total: number): MarkerBlock[] {
  if (blocks.length <= MAX_MARKERS) return blocks;
  const bucketSize = total / MAX_MARKERS;
  const merged: MarkerBlock[] = [];
  let lastBucket = -1;
  for (const block of blocks) {
    const bucket = Math.floor(block.start / bucketSize);
    const last = merged[merged.length - 1];
    if (last && bucket === lastBucket) {
      last.end = Math.max(last.end, block.end);
      if (last.kind !== block.kind) last.kind = 'mixed';
    } else {
      merged.push({ ...block });
      lastBucket = bucket;
    }
  }
  return merged;
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
  const markers = useMemo(() => {
    const blocks: MarkerBlock[] = [];
    rows.forEach((kind, index) => {
      if (kind !== 'addition' && kind !== 'deletion' && kind !== 'mixed') return;
      const last = blocks[blocks.length - 1];
      if (last && last.kind === kind && last.end === index) last.end = index + 1;
      else blocks.push({ start: index, end: index + 1, kind });
    });
    return bucketMarkers(blocks, total);
  }, [rows, total]);

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
