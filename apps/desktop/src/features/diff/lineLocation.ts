import { columnAt, lineLocation, type FileDiff } from '@angkorgit/core';
import type { LineMenuInfo } from './VirtualDiff';

type CaretDocument = Document & {
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
};

function caretAt(x: number, y: number): { node: Node; offset: number } | null {
  const doc = document as CaretDocument;
  if (doc.caretRangeFromPoint) {
    const range = doc.caretRangeFromPoint(x, y);
    return range ? { node: range.startContainer, offset: range.startOffset } : null;
  }
  const position = doc.caretPositionFromPoint?.(x, y);
  return position ? { node: position.offsetNode, offset: position.offset } : null;
}

function underPointer(node: Node, offset: number, x: number): number {
  if (node.nodeType !== Node.TEXT_NODE || offset === 0) return offset;
  const range = document.createRange();
  range.setStart(node, offset - 1);
  range.setEnd(node, offset);
  const rect = range.getBoundingClientRect();
  return x >= rect.left && x < rect.right ? offset - 1 : offset;
}

export function caretOffsetInRow(row: Element, x: number, y: number): number | null {
  const caret = caretAt(x, y);
  if (!caret || !row.contains(caret.node)) return null;
  const range = document.createRange();
  range.setStart(row, 0);
  range.setEnd(caret.node, underPointer(caret.node, caret.offset, x));
  return range.toString().length;
}

export function menuLocation(
  event: React.MouseEvent,
  info: LineMenuInfo,
  file: Pick<FileDiff, 'path' | 'oldPath'> | null,
): string | null {
  if (!file) return null;
  const offset = caretOffsetInRow(event.currentTarget, event.clientX, event.clientY);
  return lineLocation(file, info.line, info.side, columnAt(info.line.content, offset));
}
