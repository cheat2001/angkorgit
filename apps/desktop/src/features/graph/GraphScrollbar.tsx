import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { cn } from '@angkorgit/design-system';
import { GRAPH_LANES_SELECTOR, GRAPH_NODE_SELECTOR, GRAPH_SCROLL_ATTR, stickyNodeShift } from './GraphRow';

const THUMB_MIN = 24;

export function GraphScrollbar({
  scrollRef,
  overflow,
  left,
  width,
  resetKey,
}: {
  scrollRef: RefObject<HTMLDivElement | null>;
  overflow: number;
  left: number;
  width: number;
  resetKey: string;
}) {
  const offset = useRef(0);
  const thumbRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; offset: number } | null>(null);
  const [dragging, setDragging] = useState(false);

  const thumbWidth = overflow > 0 ? Math.max(THUMB_MIN, (width * width) / (width + overflow)) : width;
  const travel = Math.max(1, width - thumbWidth);

  const apply = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(0, next), overflow);
      offset.current = clamped;
      const scroller = scrollRef.current;
      if (scroller) {
        scroller.setAttribute(GRAPH_SCROLL_ATTR, String(clamped));
        const transform = clamped > 0 ? `translate3d(${-clamped}px, 0, 0)` : '';
        for (const layer of scroller.querySelectorAll<HTMLElement>(GRAPH_LANES_SELECTOR)) {
          if (layer.style.transform !== transform) layer.style.transform = transform;
        }
        for (const node of scroller.querySelectorAll<HTMLElement>(GRAPH_NODE_SELECTOR)) {
          const { nodeX, nodeMin, nodeMax } = node.dataset;
          const shift = overflow > 0 ? stickyNodeShift(Number(nodeX), Number(nodeMin), Number(nodeMax), clamped) : 0;
          const next = shift ? `translate3d(${shift}px, 0, 0)` : '';
          if (node.style.transform !== next) node.style.transform = next;
        }
      }
      if (thumbRef.current) {
        thumbRef.current.style.transform = `translateX(${overflow > 0 ? (clamped / overflow) * travel : 0}px)`;
      }
    },
    [overflow, travel, scrollRef],
  );

  const appliedKey = useRef(resetKey);
  useLayoutEffect(() => {
    if (appliedKey.current !== resetKey) {
      appliedKey.current = resetKey;
      offset.current = 0;
    }
    apply(offset.current);
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el || overflow <= 0) return;
    const onWheel = (event: WheelEvent) => {
      const delta = event.shiftKey
        ? event.deltaX || event.deltaY
        : Math.abs(event.deltaX) > Math.abs(event.deltaY)
          ? event.deltaX
          : 0;
      if (!delta) return;
      event.preventDefault();
      apply(offset.current + delta);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [scrollRef, overflow, apply]);

  if (overflow <= 0) return null;

  const pageTo = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const at = event.clientX - rect.left;
    const thumbLeft = (offset.current / overflow) * travel;
    if (at < thumbLeft) apply(offset.current - width);
    else if (at > thumbLeft + thumbWidth) apply(offset.current + width);
  };

  return (
    <div
      data-graph-scrollbar
      className="group/graphbar absolute bottom-0 z-20 h-3"
      style={{ left, width }}
      onPointerDown={pageTo}
    >
      <div
        ref={thumbRef}
        data-graph-scrollbar-thumb
        data-dragging={dragging || undefined}
        className={cn(
          'absolute left-0 top-[3px] h-1.5 rounded-full bg-foreground/20 transition-colors group-hover/graphbar:bg-foreground/35',
          dragging && '!bg-foreground/45',
        )}
        style={{ width: thumbWidth }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          drag.current = { x: event.clientX, offset: offset.current };
          setDragging(true);
        }}
        onPointerMove={(event) => {
          if (!drag.current) return;
          apply(drag.current.offset + (event.clientX - drag.current.x) * (overflow / travel));
        }}
        onPointerUp={(event) => {
          drag.current = null;
          setDragging(false);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          drag.current = null;
          setDragging(false);
        }}
      />
    </div>
  );
}
