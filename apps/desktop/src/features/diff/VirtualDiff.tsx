import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { DiffLine, FileDiff } from '@angkorgit/core';
import { clipRenderedLine } from '@angkorgit/core';
import { cn } from '@angkorgit/design-system';
import { CodeLine, lineBg, pairHunkLines, type SearchRanges } from './diffShared';
import { useStableSelection } from './diffSelection';
import { panControllers } from './pan';

export { panControllers };

export const LINE_H = 20;
const BLANK_ANCHOR = '\u200b';
export const HEADER_H = 28;
const CHAR_W = 7.3;

interface HeaderRow {
  kind: 'header';
  hunkIndex: number;
  header: string;
}
interface LineRow {
  kind: 'line';
  line: DiffLine;
  pair: DiffLine | null;
  hunkIndex: number;
  lineIndex: number;
}
interface PairRow {
  kind: 'pair';
  left: DiffLine | null;
  right: DiffLine | null;
}
export type FlatRow = HeaderRow | LineRow | PairRow;

export function flattenDiff(diff: FileDiff, split: boolean): FlatRow[] {
  const rows: FlatRow[] = [];
  diff.hunks.forEach((hunk, hunkIndex) => {
    if (hunk.header) rows.push({ kind: 'header', hunkIndex, header: hunk.header });
    const pairs = pairHunkLines(hunk);
    if (split) {
      for (const pair of pairs) rows.push({ kind: 'pair', left: pair.left, right: pair.right });
    } else {
      const counterpart = new Map<DiffLine, DiffLine>();
      for (const p of pairs) {
        if (p.left && p.right && p.left !== p.right) {
          counterpart.set(p.left, p.right);
          counterpart.set(p.right, p.left);
        }
      }
      hunk.lines.forEach((line, lineIndex) => {
        rows.push({ kind: 'line', line, pair: counterpart.get(line) ?? null, hunkIndex, lineIndex });
      });
    }
  });
  return rows;
}

function visualLength(content: string): number {
  let extra = 0;
  for (let i = 0; i < content.length; i++) if (content[i] === '\t') extra += 3;
  return content.length + extra;
}

let measureCtx: CanvasRenderingContext2D | null | undefined;
let measureFont: string | undefined;

function resolveMeasureFont(ctx: CanvasRenderingContext2D): string {
  ctx.font = '10px serif';
  const sentinel = ctx.font;
  const family = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim();
  const candidates = [
    family ? `12px ${family}` : '',
    '12px "JetBrains Mono", monospace',
    '12px monospace',
  ];
  for (const candidate of candidates) {
    if (!candidate) continue;
    ctx.font = candidate;
    if (ctx.font !== sentinel) return ctx.font;
  }
  return ctx.font;
}

export function measureWidth(content: string): number {
  if (measureCtx === undefined) {
    measureCtx = document.createElement('canvas').getContext('2d');
    if (measureCtx) measureFont = resolveMeasureFont(measureCtx);
  }
  if (!measureCtx) return visualLength(content) * CHAR_W;
  if (measureFont) measureCtx.font = measureFont;
  return measureCtx.measureText(content.replace(/\t/g, '    ')).width;
}

const MEASURE_CANDIDATES = 20;

function contentWidth(lines: Iterable<string>): number {
  const top: { content: string; est: number }[] = [];
  for (const content of lines) {
    const est = visualLength(content);
    if (top.length === MEASURE_CANDIDATES && est <= top[top.length - 1].est) continue;
    let i = top.length;
    while (i > 0 && top[i - 1].est < est) i--;
    top.splice(i, 0, { content, est });
    if (top.length > MEASURE_CANDIDATES) top.pop();
  }
  let max = 30 * CHAR_W;
  for (const c of top) max = Math.max(max, measureWidth(c.content));
  return Math.ceil(max) + 32;
}

function* rowContents(rows: FlatRow[]): Iterable<string> {
  for (const row of rows) {
    if (row.kind === 'line') {
      yield clipRenderedLine(row.line.content).text;
    } else if (row.kind === 'pair') {
      if (row.left) yield clipRenderedLine(row.left.content).text;
      if (row.right) yield clipRenderedLine(row.right.content).text;
    }
  }
}

const SCROLLBAR_H = 12;
const THUMB_MIN = 24;
const ROW_W: React.CSSProperties = { minWidth: '100%', width: 'max-content' };

const GutterCell = memo(function GutterCell({
  text,
  className,
}: {
  text: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'block w-10 select-none pr-1.5 text-right font-mono text-[10px] leading-5 text-faint',
        className,
      )}
    >
      {text}
    </span>
  );
});

function marker(kind: DiffLine['kind']): { char: string; cls: string } {
  if (kind === 'addition') return { char: '+', cls: 'text-success' };
  if (kind === 'deletion') return { char: '−', cls: 'text-danger' };
  return { char: '', cls: '' };
}

export interface LineMenuInfo {
  line: DiffLine;
  side?: 'old' | 'new';
}

interface CommonProps {
  rows: FlatRow[];
  language: string | null;
  useWordDiff: boolean;
  scrollRef: React.RefObject<HTMLDivElement>;
  hunkActions?: (hunkIndex: number) => React.ReactNode;
  onLineContextMenu?: (event: React.MouseEvent, info: LineMenuInfo) => void;
  search?: SearchRanges;
}

function rangeRect(
  container: HTMLElement,
  start: number,
  end: number,
): { left: number; width: number; top: number; height: number } | null {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let offset = 0;
  let startNode: Text | null = null;
  let startOffset = 0;
  let endNode: Text | null = null;
  let endOffset = 0;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const next = offset + node.length;
    if (!startNode && start < next) {
      startNode = node;
      startOffset = start - offset;
    }
    if (startNode && end <= next) {
      endNode = node;
      endOffset = end - offset;
      break;
    }
    offset = next;
  }
  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode, Math.max(0, startOffset));
  range.setEnd(endNode, Math.max(0, endOffset));
  const rect = range.getBoundingClientRect();
  const base = container.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;
  return {
    left: rect.left - base.left,
    width: rect.width,
    top: rect.top - base.top,
    height: rect.height,
  };
}

interface MarkRect {
  left: number;
  width: number;
  top: number;
  height: number;
  current: boolean;
}

function LineContent({
  line,
  search,
  children,
}: {
  line: DiffLine;
  search?: SearchRanges;
  children: React.ReactNode;
}) {
  const ranges = search?.get(line);
  const ref = useRef<HTMLDivElement>(null);
  const [marks, setMarks] = useState<MarkRect[]>([]);

  useLayoutEffect(() => {
    if (!ranges || !ref.current) {
      setMarks((m) => (m.length > 0 ? [] : m));
      return;
    }
    const out: MarkRect[] = [];
    for (const r of ranges) {
      const rect = rangeRect(ref.current, r.start, r.end);
      if (rect) out.push({ ...rect, current: r.current });
    }
    setMarks(out);
  }, [ranges, line]);

  return (
    <div ref={ref} className="relative px-2">
      {marks.map((m, i) => (
        <span
          key={i}
          data-search-mark={m.current ? 'current' : 'match'}
          className={cn(
            'pointer-events-none absolute rounded-sm',
            m.current ? 'bg-primary/50 ring-1 ring-primary' : 'bg-primary/25',
          )}
          style={{ left: m.left, width: Math.max(3, m.width), top: m.top, height: m.height }}
        />
      ))}
      {children}
    </div>
  );
}

function useDiffVirtualizer(rows: FlatRow[], scrollRef: React.RefObject<HTMLDivElement>) {
  return useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => (rows[index].kind === 'header' ? HEADER_H : LINE_H),
    overscan: 8,
  });
}

function useHorizontalPan(
  panes: React.RefObject<HTMLDivElement>[],
  layers: React.RefObject<HTMLDivElement>[],
  width: number,
  scrollbarRef: React.RefObject<HTMLDivElement>,
) {
  const x = useRef(0);
  useEffect(() => {
    let raf = 0;
    let limit: number | null = null;
    const measureLimit = () => {
      const pane = panes.find((p) => p.current)?.current;
      if (!pane) return 0;
      let w = width;
      for (const layer of layers) {
        if (layer.current) w = Math.max(w, layer.current.scrollWidth);
      }
      const limit = Math.max(0, w - pane.clientWidth);
      const scrollbar = scrollbarRef.current;
      if (scrollbar?.firstElementChild && scrollbar.parentElement) {
        (scrollbar.firstElementChild as HTMLElement).style.width = `${scrollbar.clientWidth + limit}px`;
        scrollbar.parentElement.style.height = limit > 0 ? `${SCROLLBAR_H}px` : '0px';
        scrollbar.tabIndex = limit > 0 ? 0 : -1;
      }
      return limit;
    };
    const thumb = scrollbarRef.current?.parentElement?.querySelector<HTMLElement>('[data-diff-scrollbar-thumb]') ?? null;
    const placeThumb = (limit: number) => {
      const scrollbar = scrollbarRef.current;
      if (!scrollbar || !thumb) return;
      const track = scrollbar.clientWidth;
      const thumbWidth = limit > 0 ? Math.max(THUMB_MIN, (track * track) / (track + limit)) : 0;
      thumb.style.width = `${thumbWidth}px`;
      thumb.style.transform = `translateX(${limit > 0 ? (x.current / limit) * (track - thumbWidth) : 0}px)`;
    };
    const maxX = () => {
      if (limit === null) limit = measureLimit();
      return limit;
    };
    let echoed = -1;
    const syncScrollbar = () => {
      const scrollbar = scrollbarRef.current;
      if (!scrollbar) return;
      if (Math.abs(scrollbar.scrollLeft - x.current) >= 1) scrollbar.scrollLeft = x.current;
      echoed = scrollbar.scrollLeft;
    };
    const apply = () => {
      raf = 0;
      const limit = maxX();
      x.current = Math.min(x.current, limit);
      syncScrollbar();
      placeThumb(limit);
      for (const layer of layers) {
        if (layer.current) layer.current.style.transform = `translateX(${-x.current}px)`;
      }
    };
    const panBy = (dx: number) => {
      x.current = Math.min(Math.max(0, x.current + dx), maxX());
      apply();
    };
    const onWheel = (e: WheelEvent) => {
      const shifted = e.shiftKey && e.deltaX === 0;
      if (!shifted && Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      const delta = shifted ? e.deltaY : e.deltaX;
      const dx = e.deltaMode === 1 ? delta * 16 : delta;
      const next = Math.min(Math.max(0, x.current + dx), maxX());
      e.preventDefault();
      if (next === x.current) return;
      x.current = next;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const onScroll = () => {
      const left = scrollbarRef.current?.scrollLeft ?? 0;
      if (left === echoed) return;
      echoed = left;
      x.current = left;
      if (raf) cancelAnimationFrame(raf);
      apply();
    };
    const scrollbar = scrollbarRef.current;
    scrollbar?.addEventListener('scroll', onScroll);
    const els = panes.flatMap((p) => (p.current ? [p.current] : []));
    const observer = new ResizeObserver(() => {
      limit = null;
      if (!raf) raf = requestAnimationFrame(apply);
    });
    for (const el of els) {
      el.addEventListener('wheel', onWheel, { passive: false });
      panControllers.set(el, panBy);
      observer.observe(el);
    }
    apply();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      observer.disconnect();
      scrollbar?.removeEventListener('scroll', onScroll);
      for (const el of els) {
        el.removeEventListener('wheel', onWheel);
        panControllers.delete(el);
      }
    };
  }, [panes, layers, width, scrollbarRef]);
}

function HorizontalScrollbar({ scrollbarRef }: { scrollbarRef: React.RefObject<HTMLDivElement> }) {
  const drag = useRef<{ startX: number; startLeft: number; ratio: number } | null>(null);
  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    delete event.currentTarget.dataset.dragging;
  };
  return (
    <div
      data-diff-scrollbar
      className="group/scrollbar sticky bottom-0 z-10 h-3 shrink-0 bg-surface"
      onWheel={(event) => {
        const scrollbar = scrollbarRef.current;
        if (!scrollbar) return;
        const delta = event.deltaX !== 0 ? event.deltaX : event.shiftKey ? event.deltaY : 0;
        if (delta) scrollbar.scrollLeft += delta;
      }}
      onPointerDown={(event) => {
        const scrollbar = scrollbarRef.current;
        const thumb = event.currentTarget.querySelector<HTMLElement>('[data-diff-scrollbar-thumb]');
        if (!scrollbar || !thumb || event.button !== 0) return;
        event.preventDefault();
        scrollbar.focus({ preventScroll: true });
        const rect = thumb.getBoundingClientRect();
        if (event.clientX < rect.left || event.clientX > rect.right) {
          scrollbar.scrollLeft += event.clientX < rect.left ? -scrollbar.clientWidth : scrollbar.clientWidth;
          return;
        }
        const track = scrollbar.clientWidth - rect.width;
        drag.current = {
          startX: event.clientX,
          startLeft: scrollbar.scrollLeft,
          ratio: track > 0 ? (scrollbar.scrollWidth - scrollbar.clientWidth) / track : 0,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.dataset.dragging = '';
      }}
      onPointerMove={(event) => {
        const scrollbar = scrollbarRef.current;
        const current = drag.current;
        if (!scrollbar || !current) return;
        scrollbar.scrollLeft = current.startLeft + (event.clientX - current.startX) * current.ratio;
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <div
        ref={scrollbarRef}
        aria-label="Scroll diff horizontally"
        tabIndex={0}
        onKeyDown={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) event.stopPropagation();
        }}
        className="scrollbar-none h-full overflow-x-auto overflow-y-hidden"
      >
        <div className="h-px" />
      </div>
      <div
        data-diff-scrollbar-thumb
        aria-hidden
        className="pointer-events-none absolute left-0 top-[3px] h-1.5 rounded-full bg-foreground/20 transition-colors group-hover/scrollbar:bg-foreground/35 group-data-[dragging]/scrollbar:bg-foreground/45"
      />
    </div>
  );
}

function SelectionSentinel({ edge }: { edge: 'start' | 'end' }) {
  return (
    <span
      aria-hidden
      data-diff-sentinel={edge}
      className={cn('diff-sentinel', edge === 'start' ? 'top-0' : 'bottom-0')}
    >
      {'\u00A0'}
    </span>
  );
}

function HeaderContent({
  header,
  hunkIndex,
  hunkActions,
}: {
  header: string;
  hunkIndex: number;
  hunkActions?: (hunkIndex: number) => React.ReactNode;
}) {
  return (
    <div className="flex h-7 w-fit max-w-full select-none items-center gap-2 px-3">
      <span className="truncate font-mono text-[10px] text-info">{header}</span>
      {hunkActions?.(hunkIndex)}
    </div>
  );
}

export function VirtualInlineDiff({ rows, language, useWordDiff, scrollRef, hunkActions, onLineContextMenu, search }: CommonProps) {
  const virtualizer = useDiffVirtualizer(rows, scrollRef);
  const items = virtualizer.getVirtualItems();
  const total = virtualizer.getTotalSize();

  const width = useMemo(() => contentWidth(rowContents(rows)), [rows]);

  const paneRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const panes = useMemo(() => [paneRef], []);
  const layers = useMemo(() => [layerRef], []);
  const scrollbarRef = useRef<HTMLDivElement>(null);
  useHorizontalPan(panes, layers, width, scrollbarRef);
  useStableSelection(rows, scrollRef);

  return (
    <div className="relative flex flex-col">
      <div className="flex items-start">
        <div
          className="relative w-[104px] shrink-0 border-r border-border-subtle bg-surface"
          style={{ height: total }}
        >
          {items.map((item) => {
            const row = rows[item.index];
            return (
              <div
                key={item.key}
                className={cn(
                  'absolute left-0 flex w-full',
                  row.kind === 'header' ? 'border-y border-border-subtle bg-surface-raised/60' : lineBg(row.kind === 'line' ? row.line.kind : 'context'),
                )}
                style={{ top: 0, height: item.size, transform: `translateY(${item.start}px)` }}
              >
                {row.kind === 'line' && (
                  <>
                    <GutterCell text={row.line.oldLineNo?.toString() ?? ''} className="border-r border-border-subtle" />
                    <GutterCell text={row.line.newLineNo?.toString() ?? ''} className="border-r border-border-subtle" />
                    <span className={cn('w-6 select-none text-center font-mono text-xs leading-5', marker(row.line.kind).cls)}>
                      {marker(row.line.kind).char}
                    </span>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div ref={paneRef} data-diff-pane="new" className="relative min-w-0 flex-1 cursor-text overflow-hidden" style={{ height: total }}>
          <div aria-hidden className="pointer-events-none absolute inset-0">
            {items.map((item) => {
              const row = rows[item.index];
              return (
                <div
                  key={item.key}
                  className={cn(
                    'absolute left-0 w-full',
                    row.kind === 'header'
                      ? 'border-y border-border-subtle bg-surface-raised/60'
                      : lineBg(row.kind === 'line' ? row.line.kind : 'context'),
                  )}
                  style={{ top: 0, height: item.size, transform: `translateY(${item.start}px)` }}
                />
              );
            })}
          </div>
          <div ref={layerRef} data-diff-layer className="absolute inset-y-0 left-0" style={{ width, minWidth: '100%', tabSize: 4, willChange: 'transform' }}>
            <SelectionSentinel edge="start" />
            {items.map((item) => {
              const row = rows[item.index];
              if (row.kind !== 'line') return null;
              return (
                <div
                  key={item.key}
                  data-diff-row={item.index}
                  className="absolute left-0"
                  style={{ top: 0, height: item.size, transform: `translateY(${item.start}px)`, ...ROW_W }}
                  onContextMenu={
                    onLineContextMenu ? (e) => onLineContextMenu(e, { line: row.line }) : undefined
                  }
                >
                  <LineContent line={row.line} search={search}>
                    <CodeLine
                      line={row.line}
                      pair={row.pair}
                      language={language}
                      useWordDiff={useWordDiff}
                      side={row.line.kind === 'deletion' ? 'old' : 'new'}
                      wrap={false}
                    />
                  </LineContent>
                </div>
              );
            })}
            <SelectionSentinel edge="end" />
          </div>
          {items.map((item) => {
            const row = rows[item.index];
            if (row.kind !== 'header') return null;
            return (
              <div
                key={item.key}
                className="absolute left-0 w-full"
                style={{ top: 0, height: item.size, transform: `translateY(${item.start}px)` }}
              >
                <HeaderContent header={row.header} hunkIndex={row.hunkIndex} hunkActions={hunkActions} />
              </div>
            );
          })}
        </div>
      </div>
      <HorizontalScrollbar scrollbarRef={scrollbarRef} />
    </div>
  );
}

function SplitHalf({
  rows,
  items,
  total,
  width,
  side,
  language,
  useWordDiff,
  hunkActions,
  onLineContextMenu,
  paneRef,
  layerRef,
  search,
}: CommonProps & {
  items: ReturnType<ReturnType<typeof useDiffVirtualizer>['getVirtualItems']>;
  total: number;
  width: number;
  side: 'old' | 'new';
  paneRef: React.RefObject<HTMLDivElement>;
  layerRef: React.RefObject<HTMLDivElement>;
}) {
  const bgOf = (row: FlatRow): string => {
    if (row.kind === 'header') return 'border-y border-border-subtle bg-surface-raised/60';
    if (row.kind !== 'pair') return '';
    const line = side === 'old' ? row.left : row.right;
    if (!line) return 'bg-surface-raised/40';
    return lineBg(line.kind === 'context' ? 'context' : side === 'old' ? 'deletion' : 'addition');
  };

  return (
    <div className={cn('flex w-1/2 min-w-0 items-start', side === 'old' && 'border-r border-border-subtle')}>
      <div className="relative w-10 shrink-0 border-r border-border-subtle bg-surface" style={{ height: total }}>
        {items.map((item) => {
          const row = rows[item.index];
          const line = row.kind === 'pair' ? (side === 'old' ? row.left : row.right) : null;
          return (
            <div
              key={item.key}
              className={cn('absolute left-0 w-full', bgOf(row))}
              style={{ top: 0, height: item.size, transform: `translateY(${item.start}px)` }}
            >
              {line && (
                <GutterCell text={(side === 'old' ? line.oldLineNo : line.newLineNo)?.toString() ?? ''} />
              )}
            </div>
          );
        })}
      </div>
      <div ref={paneRef} data-diff-pane={side} className="relative min-w-0 flex-1 cursor-text overflow-hidden" style={{ height: total }}>
        <div aria-hidden className="pointer-events-none absolute inset-0">
          {items.map((item) => {
            const row = rows[item.index];
            return (
              <div
                key={item.key}
                className={cn('absolute left-0 w-full', bgOf(row))}
                style={{ top: 0, height: item.size, transform: `translateY(${item.start}px)` }}
              />
            );
          })}
        </div>
        <div ref={layerRef} data-diff-layer className="absolute inset-y-0 left-0" style={{ width, minWidth: '100%', tabSize: 4, willChange: 'transform' }}>
          <SelectionSentinel edge="start" />
          {items.map((item) => {
            const row = rows[item.index];
            const line = row.kind === 'pair' ? (side === 'old' ? row.left : row.right) : null;
            if (!line) {
              return (
                <div
                  key={item.key}
                  data-diff-row={item.index}
                  data-diff-blank
                  aria-hidden
                  className="absolute left-0 text-transparent"
                  style={{ top: 0, height: item.size, transform: `translateY(${item.start}px)`, ...ROW_W }}
                >
                  {BLANK_ANCHOR}
                </div>
              );
            }
            return (
              <div
                key={item.key}
                data-diff-row={item.index}
                className="absolute left-0"
                style={{ top: 0, height: item.size, transform: `translateY(${item.start}px)`, ...ROW_W }}
                onContextMenu={
                  onLineContextMenu ? (e) => onLineContextMenu(e, { line, side }) : undefined
                }
              >
                <LineContent line={line} search={search}>
                  <CodeLine
                    line={line}
                    pair={row.kind === 'pair' ? (side === 'old' ? row.right : row.left) : null}
                    language={language}
                    useWordDiff={useWordDiff}
                    side={side}
                    wrap={false}
                  />
                </LineContent>
              </div>
            );
          })}
          <SelectionSentinel edge="end" />
        </div>
        {items.map((item) => {
          const row = rows[item.index];
          if (row.kind !== 'header') return null;
          return (
            <div
              key={item.key}
              className="absolute left-0 w-full"
              style={{ top: 0, height: item.size, transform: `translateY(${item.start}px)` }}
            >
              {side === 'old' ? (
                <HeaderContent header={row.header} hunkIndex={row.hunkIndex} hunkActions={hunkActions} />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function VirtualSplitDiff(props: CommonProps) {
  const virtualizer = useDiffVirtualizer(props.rows, props.scrollRef);
  const items = virtualizer.getVirtualItems();
  const total = virtualizer.getTotalSize();
  const paneL = useRef<HTMLDivElement>(null);
  const paneR = useRef<HTMLDivElement>(null);
  const layerL = useRef<HTMLDivElement>(null);
  const layerR = useRef<HTMLDivElement>(null);
  const panes = useMemo(() => [paneL, paneR], []);
  const layers = useMemo(() => [layerL, layerR], []);

  const width = useMemo(() => contentWidth(rowContents(props.rows)), [props.rows]);

  const scrollbarRef = useRef<HTMLDivElement>(null);
  useHorizontalPan(panes, layers, width, scrollbarRef);
  useStableSelection(props.rows, props.scrollRef);

  return (
    <div className="relative flex flex-col">
      <div className="flex items-start">
        <SplitHalf {...props} items={items} total={total} width={width} side="old" paneRef={paneL} layerRef={layerL} />
        <SplitHalf {...props} items={items} total={total} width={width} side="new" paneRef={paneR} layerRef={layerR} />
      </div>
      <HorizontalScrollbar scrollbarRef={scrollbarRef} />
    </div>
  );
}
