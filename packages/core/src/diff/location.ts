import type { DiffLine } from '../git/types';
import { MAX_RENDERED_LINE } from './renderCap';

export function lineLocation(
  file: { path: string; oldPath: string | null },
  line: DiffLine,
  side?: 'old' | 'new',
  column?: number | null,
): string | null {
  const old = side ? side === 'old' : line.kind === 'deletion';
  const number = old ? line.oldLineNo : line.newLineNo;
  if (number === null) return null;
  const path = old ? (file.oldPath ?? file.path) : file.path;
  return column ? `${path}:${number}:${column}` : `${path}:${number}`;
}

export function columnAt(content: string, offset: number | null): number | null {
  if (offset === null || offset < 0 || offset >= Math.min(content.length, MAX_RENDERED_LINE)) return null;
  return Array.from(content.slice(0, offset)).length + 1;
}
