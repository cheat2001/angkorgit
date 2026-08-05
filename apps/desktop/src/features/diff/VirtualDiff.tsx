import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { DiffLine, FileDiff } from '@angkorgit/core';
import { cn } from '@angkorgit/design-system';
import { CodeLine, lineBg, pairHunkLines, type SearchRanges } from './diffShared';

export const LINE_H = 20;
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
    rows.push({ kind: 'header', hunkIndex, header: hunk.header });
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

function contentWidth(lines: Iterable<string>): number {
  const candidates: { content: string; est: number }[] = [];
  for (const content of lines) candidates.push({ content, est: visualLength(content) });
  candidates.sort((a, b) => b.est - a.est);
  let max = 30 * CHAR_W;
  for (const c of candidates.slice(0, 20)) max = Math.max(max, measureWidth(c.content));
  return Math.ceil(max) + 32;
}

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
        'block w-10 pr-1.5 text-right font-mono text-[10px] leading-5 text-faint',
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
    overscan: 60,
  });
}

export const panControllers = new WeakMap<HTMLElement, (dx: number) => void>();

function useHorizontalPan(
  panes: React.RefObject<HTMLDivElement>[],
  layers: React.RefObject<HTMLDivElement>[],
  width: number,
) {
  const x = useRef(0);
  useEffect(() => {
    let raf = 0;
    const maxX = () => {
      const pane = panes.find((p) => p.current)?.current;
      if (!pane) return 0;
      let w = width;
      for (const layer of layers) {
        if (layer.current) w = Math.max(w, layer.current.scrollWidth);
      }
      return Math.max(0, w - pane.clientWidth);
    };
    const apply = () => {
      raf = 0;
      x.current = Math.min(x.current, maxX());
      for (const layer of layers) {
        if (layer.current) layer.current.style.transform = `translateX(${-x.current}px)`;
      }
    };
    const panBy = (dx: number) => {
      x.current = Math.min(Math.max(0, x.current + dx), maxX());
      apply();
    };
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return; // vertical → outer scroller
      const dx = e.deltaMode === 1 ? e.deltaX * 16 : e.deltaX;
      const next = Math.min(Math.max(0, x.current + dx), maxX());
      e.preventDefault();
      if (next === x.current) return;
      x.current = next;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const els = panes.flatMap((p) => (p.current ? [p.current] : []));
    for (const el of els) {
      el.addEventListener('wheel', onWheel, { passive: false });
      panControllers.set(el, panBy);
    }
    apply();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      for (const el of els) {
        el.removeEventListener('wheel', onWheel);
        panControllers.delete(el);
      }
    };
  }, [panes, layers, width]);
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
    <div className="flex h-7 w-fit max-w-full items-center gap-2 px-3">
      <span className="truncate font-mono text-[10px] text-info">{header}</span>
      {hunkActions?.(hunkIndex)}
    </div>
  );
}

export function VirtualInlineDiff({ rows, language, useWordDiff, scrollRef, hunkActions, onLineContextMenu, search }: CommonProps) {
  const virtualizer = useDiffVirtualizer(rows, scrollRef);
  const items = virtualizer.getVirtualItems();
  const total = virtualizer.getTotalSize();

  const width = useMemo(
    () => contentWidth(rows.flatMap((row) => (row.kind === 'line' ? [row.line.content] : []))),
    [rows],
  );

  const paneRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const panes = useMemo(() => [paneRef], []);
  const layers = useMemo(() => [layerRef], []);
  useHorizontalPan(panes, layers, width);

  return (
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
                  <span className={cn('w-6 text-center font-mono text-xs leading-5', marker(row.line.kind).cls)}>
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
        <div ref={layerRef} data-diff-layer className="absolute inset-y-0 left-0" style={{ width, minWidth: '100%', tabSize: 4 }}>
          {items.map((item) => {
            const row = rows[item.index];
            if (row.kind !== 'line') return null;
            return (
              <div
                key={item.key}
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
        <div ref={layerRef} data-diff-layer className="absolute inset-y-0 left-0" style={{ width, minWidth: '100%', tabSize: 4 }}>
          {items.map((item) => {
            const row = rows[item.index];
            const line = row.kind === 'pair' ? (side === 'old' ? row.left : row.right) : null;
            if (!line) return null;
            return (
              <div
                key={item.key}
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

  const width = useMemo(
    () =>
      contentWidth(
        props.rows.flatMap((row) =>
          row.kind === 'pair'
            ? [row.left?.content ?? '', row.right?.content ?? '']
            : [],
        ),
      ),
    [props.rows],
  );

  useHorizontalPan(panes, layers, width);

  return (
    <div className="flex items-start">
      <SplitHalf {...props} items={items} total={total} width={width} side="old" paneRef={paneL} layerRef={layerL} />
      <SplitHalf {...props} items={items} total={total} width={width} side="new" paneRef={paneR} layerRef={layerR} />
    </div>
  );
}
