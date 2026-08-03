/**
 * Conflict-marker parser for the visual conflict resolver.
 *
 * A conflicted file is split into an ordered list of blocks: plain text
 * blocks and conflict blocks carrying the "current" (ours) and "incoming"
 * (theirs) sides. The resolver renders three panes from this structure and
 * serializes the chosen resolution back to text.
 */

export interface TextBlock {
  kind: 'text';
  lines: string[];
}

export interface ConflictBlock {
  kind: 'conflict';
  /** ours — between <<<<<<< and ======= (or ||||||| when diff3) */
  current: string[];
  /** base — between ||||||| and ======= when diff3 style is enabled */
  base: string[] | null;
  /** theirs — between ======= and >>>>>>> */
  incoming: string[];
  currentLabel: string;
  incomingLabel: string;
  resolution: Resolution;
}

export type Resolution = 'unresolved' | 'current' | 'incoming' | 'both' | 'manual';

export type Block = TextBlock | ConflictBlock;

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
    if (line.startsWith('<<<<<<<')) {
      flushText();
      const currentLabel = line.slice(7).trim();
      const current: string[] = [];
      const incoming: string[] = [];
      let base: string[] | null = null;
      let incomingLabel = '';
      i++;
      let section: 'current' | 'base' | 'incoming' = 'current';
      let closed = false;
      while (i < lines.length) {
        const l = lines[i];
        if (l.startsWith('|||||||') && section === 'current') {
          section = 'base';
          base = [];
        } else if (l.startsWith('=======') && section !== 'incoming') {
          section = 'incoming';
        } else if (l.startsWith('>>>>>>>')) {
          incomingLabel = l.slice(7).trim();
          closed = true;
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
      if (closed) {
        blocks.push({
          kind: 'conflict',
          current,
          base,
          incoming,
          currentLabel,
          incomingLabel,
          resolution: 'unresolved',
        });
      } else {
        // Malformed markers: keep as plain text so nothing is lost.
        text.push(line, ...current, ...(base ?? []), ...incoming);
      }
      continue;
    }
    text.push(line);
    i++;
  }
  flushText();
  return blocks;
}

/** Serialize blocks back into file content using each block's resolution. */
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
        // Re-emit markers so an unfinished resolve never destroys data.
        out.push(`<<<<<<< ${block.currentLabel}`, ...block.current);
        if (block.base) out.push('|||||||', ...block.base);
        out.push('=======', ...block.incoming, `>>>>>>> ${block.incomingLabel}`);
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
