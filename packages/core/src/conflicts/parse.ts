
export interface TextBlock {
  kind: 'text';
  lines: string[];
}

export interface ConflictMarkers {
  open: string;
  base: string | null;
  separator: string;
  close: string;
}

export interface ConflictBlock {
  kind: 'conflict';
  current: string[];
  base: string[] | null;
  incoming: string[];
  currentLabel: string;
  incomingLabel: string;
  markers: ConflictMarkers;
  resolution: Resolution;
}

export type Resolution = 'unresolved' | 'current' | 'incoming' | 'both' | 'manual';

export type Block = TextBlock | ConflictBlock;

const OPEN_MARKER = /^<{7}(?: |\r?$)/;
const BASE_MARKER = /^\|{7}(?: |\r?$)/;
const SEPARATOR_MARKER = /^={7}\r?$/;
const CLOSE_MARKER = /^>{7}(?: |\r?$)/;

export function parseConflicts(content: string): Block[] {
  const lines = content.split('\n');
  const blocks: Block[] = [];
  let text: string[] = [];
  let i = 0;

  const flushText = () => {
    if (text.length > 0) {
      blocks.push({ kind: 'text', lines: text });
      text = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];
    if (OPEN_MARKER.test(line)) {
      const start = i;
      const current: string[] = [];
      const incoming: string[] = [];
      let base: string[] | null = null;
      let baseMarker: string | null = null;
      let separator: string | null = null;
      let close: string | null = null;
      let incomingLabel = '';
      i++;
      let section: 'current' | 'base' | 'incoming' = 'current';
      while (i < lines.length) {
        const l = lines[i];
        if (BASE_MARKER.test(l) && section === 'current') {
          section = 'base';
          base = [];
          baseMarker = l;
        } else if (SEPARATOR_MARKER.test(l) && section !== 'incoming') {
          section = 'incoming';
          separator = l;
        } else if (CLOSE_MARKER.test(l)) {
          incomingLabel = l.slice(7).trim();
          close = l;
          i++;
          break;
        } else if (section === 'current') {
          current.push(l);
        } else if (section === 'base') {
          base!.push(l);
        } else {
          incoming.push(l);
        }
        i++;
      }
      if (close !== null && separator !== null) {
        flushText();
        blocks.push({
          kind: 'conflict',
          current,
          base,
          incoming,
          currentLabel: line.slice(7).trim(),
          incomingLabel,
          markers: { open: line, base: baseMarker, separator, close },
          resolution: 'unresolved',
        });
      } else {
        text.push(...lines.slice(start, i));
      }
      continue;
    }
    text.push(line);
    i++;
  }
  flushText();
  return blocks;
}

export function serializeResolution(
  blocks: readonly Block[],
  manualEdits?: ReadonlyMap<number, string[]>,
): string {
  const out: string[] = [];
  blocks.forEach((block, index) => {
    if (block.kind === 'text') {
      out.push(...block.lines);
      return;
    }
    const manual = manualEdits?.get(index);
    switch (block.resolution) {
      case 'current':
        out.push(...block.current);
        break;
      case 'incoming':
        out.push(...block.incoming);
        break;
      case 'both':
        out.push(...block.current, ...block.incoming);
        break;
      case 'manual':
        out.push(...(manual ?? []));
        break;
      case 'unresolved':
        out.push(block.markers.open, ...block.current);
        if (block.markers.base !== null) out.push(block.markers.base, ...(block.base ?? []));
        out.push(block.markers.separator, ...block.incoming, block.markers.close);
        break;
    }
  });
  return out.join('\n');
}

export function allResolved(blocks: readonly Block[]): boolean {
  return blocks.every((b) => b.kind === 'text' || b.resolution !== 'unresolved');
}

export function conflictCount(blocks: readonly Block[]): number {
  return blocks.filter((b) => b.kind === 'conflict').length;
}
