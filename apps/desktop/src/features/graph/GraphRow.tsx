import { memo } from 'react';
import type { GraphRow as GraphRowData, RefInfo } from '@angkorgit/core';
import { Badge, cn } from '@angkorgit/design-system';
import { GitMerge, Tag as TagIcon } from 'lucide-react';
import type { CommitInfo } from '@angkorgit/core';
import { Avatar } from '@/components/Avatar';
import { timeAgo } from '@/shared/utils';

export const ROW_HEIGHT = 32;
const LANE_WIDTH = 14;
const NODE_RADIUS = 4;

export function laneColor(color: number): string {
  return `hsl(var(--graph-${color % 10}))`;
}

const x = (lane: number) => 8 + lane * LANE_WIDTH;
const CY = ROW_HEIGHT / 2;

function GraphGutter({ row, width }: { row: GraphRowData; width: number }) {
  const { node, passing } = row;
  const nx = x(node.lane);
  return (
    <svg width={width} height={ROW_HEIGHT} className="shrink-0" aria-hidden>
      {passing.map((p) => (
        <line
          key={`p${p.lane}`}
          x1={x(p.lane)}
          y1={0}
          x2={x(p.lane)}
          y2={ROW_HEIGHT}
          stroke={laneColor(p.color)}
          strokeWidth={2}
        />
      ))}
      {node.closing.map((c) => (
        <path
          key={`c${c.lane}`}
          d={`M ${x(c.lane)} 0 C ${x(c.lane)} ${CY}, ${nx} ${CY * 0.4}, ${nx} ${CY}`}
          stroke={laneColor(c.color)}
          strokeWidth={2}
          fill="none"
        />
      ))}
      {node.merges.map((m) => (
        <path
          key={`m${m.lane}`}
          d={`M ${nx} ${CY} C ${x(m.lane)} ${CY * 1.6}, ${x(m.lane)} ${CY}, ${x(m.lane)} ${ROW_HEIGHT}`}
          stroke={laneColor(m.color)}
          strokeWidth={2}
          fill="none"
        />
      ))}
      {node.hasIncoming && (
        <line x1={nx} y1={0} x2={nx} y2={CY} stroke={laneColor(node.color)} strokeWidth={2} />
      )}
      {node.continues && (
        <line x1={nx} y1={CY} x2={nx} y2={ROW_HEIGHT} stroke={laneColor(node.color)} strokeWidth={2} />
      )}
      <circle
        cx={nx}
        cy={CY}
        r={node.isMerge ? NODE_RADIUS - 0.5 : NODE_RADIUS}
        fill={node.isMerge ? 'hsl(var(--surface))' : laneColor(node.color)}
        stroke={laneColor(node.color)}
        strokeWidth={2}
      />
    </svg>
  );
}

function RefChips({ refs }: { refs: RefInfo[] }) {
  if (refs.length === 0) return null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {refs.slice(0, 3).map((ref) => (
        <Badge
          key={ref.name}
          tone={ref.kind === 'tag' ? 'primary' : ref.kind === 'remoteBranch' ? 'info' : 'success'}
          className="max-w-32"
        >
          {ref.kind === 'tag' && <TagIcon className="size-2.5" />}
          <span className="truncate">{ref.shorthand}</span>
        </Badge>
      ))}
      {refs.length > 3 && <Badge>+{refs.length - 3}</Badge>}
    </span>
  );
}

interface Props {
  commit: CommitInfo;
  row: GraphRowData;
  gutterWidth: number;
  selected: boolean;
  onSelect: (oid: string) => void;
  onContextMenu: (event: React.MouseEvent, commit: CommitInfo) => void;
}

export const CommitRow = memo(function CommitRow({
  commit,
  row,
  gutterWidth,
  selected,
  onSelect,
  onContextMenu,
}: Props) {
  return (
    <div
      role="row"
      aria-selected={selected}
      className={cn(
        'flex h-8 cursor-pointer select-none items-center gap-2 px-2 text-sm transition-colors',
        selected ? 'bg-primary/10' : 'hover:bg-surface-raised',
        commit.isHead && 'font-medium',
      )}
      onClick={() => onSelect(commit.oid)}
      onContextMenu={(e) => onContextMenu(e, commit)}
    >
      <GraphGutter row={row} width={gutterWidth} />
      {commit.isHead && <Badge tone="primary">HEAD</Badge>}
      <RefChips refs={commit.refs} />
      {commit.parents.length > 1 && <GitMerge className="size-3.5 shrink-0 text-muted" />}
      <span className="min-w-0 flex-1 truncate">{commit.summary || <span className="text-faint">(no message)</span>}</span>
      <Avatar name={commit.author.name} email={commit.author.email} size={20} />
      <span className="w-14 shrink-0 text-right font-mono text-[11px] text-faint">{commit.shortOid.slice(0, 7)}</span>
      <span className="w-16 shrink-0 text-right text-[11px] text-faint">{timeAgo(commit.author.time)}</span>
    </div>
  );
});
