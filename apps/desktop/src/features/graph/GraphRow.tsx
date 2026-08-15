import { memo } from 'react';
import type { GraphRow as GraphRowData, RefInfo } from '@angkorgit/core';
import { Badge, cn } from '@angkorgit/design-system';
import { Check, Cloud, GitMerge, Monitor, Tag as TagIcon } from 'lucide-react';
import type { CommitInfo } from '@angkorgit/core';
import { Avatar } from '@/components/Avatar';
import { timeAgo } from '@/shared/utils';

export const ROW_HEIGHT = 32;
export const REF_COL_WIDTH = 150;
export const FLAT_GUTTER_WIDTH = 28;
const LANE_WIDTH = 14;
const NODE_RADIUS = 4;
const AVATAR_SIZE = 18;

export function laneColor(color: number): string {
  return `hsl(var(--graph-${color % 10}))`;
}

export const laneX = (lane: number) => AVATAR_SIZE / 2 + 3 + lane * LANE_WIDTH;
const x = laneX;
const CY = ROW_HEIGHT / 2;

function FlatGutter({ author }: { author: CommitInfo['author'] }) {
  return (
    <div
      className="flex shrink-0 items-center justify-center"
      style={{ width: FLAT_GUTTER_WIDTH, height: ROW_HEIGHT }}
    >
      <span
        className="overflow-hidden rounded-full"
        title={author.name}
        style={{
          width: AVATAR_SIZE,
          height: AVATAR_SIZE,
          boxShadow: '0 0 0 1px hsl(var(--border))',
          background: 'hsl(var(--surface))',
        }}
      >
        <Avatar name={author.name} email={author.email} size={AVATAR_SIZE} />
      </span>
    </div>
  );
}

function GraphGutter({
  row,
  width,
  author,
  hasRefs,
}: {
  row: GraphRowData;
  width: number;
  author: CommitInfo['author'];
  hasRefs: boolean;
}) {
  const { node, passing } = row;
  const nx = Math.min(x(node.lane), width - AVATAR_SIZE / 2 - 2);
  return (
    <div className="relative shrink-0 overflow-hidden" style={{ width, height: ROW_HEIGHT }}>
      <svg width={width} height={ROW_HEIGHT} aria-hidden>
        {hasRefs && (
          <line
            x1={0}
            y1={CY}
            x2={nx}
            y2={CY}
            stroke={laneColor(node.color)}
            strokeOpacity={0.45}
            strokeWidth={1}
          />
        )}
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
        {node.isMerge && (
          <circle
            cx={nx}
            cy={CY}
            r={NODE_RADIUS - 0.5}
            fill="hsl(var(--surface))"
            stroke={laneColor(node.color)}
            strokeWidth={2}
          />
        )}
      </svg>
      {!node.isMerge && (
        <span
          className="absolute overflow-hidden rounded-full"
          title={author.name}
          style={{
            left: nx - AVATAR_SIZE / 2,
            top: CY - AVATAR_SIZE / 2,
            width: AVATAR_SIZE,
            height: AVATAR_SIZE,
            boxShadow: `0 0 0 2px ${laneColor(node.color)}`,
            background: 'hsl(var(--surface))',
          }}
        >
          <Avatar name={author.name} email={author.email} size={AVATAR_SIZE} />
        </span>
      )}
    </div>
  );
}

interface RefGroup {
  label: string;
  primary: RefInfo;
  local: boolean;
  remote: boolean;
  tag: boolean;
}

function groupRefs(refs: RefInfo[]): RefGroup[] {
  const out: RefGroup[] = [];
  const index = new Map<string, number>();
  for (const ref of refs) {
    if (ref.kind === 'localBranch') {
      const i = index.get(ref.shorthand);
      if (i !== undefined) {
        out[i].local = true;
        out[i].primary = ref;
      } else {
        index.set(ref.shorthand, out.length);
        out.push({ label: ref.shorthand, primary: ref, local: true, remote: false, tag: false });
      }
    } else if (ref.kind === 'remoteBranch') {
      const base = ref.shorthand.split('/').slice(1).join('/') || ref.shorthand;
      const i = index.get(base);
      if (i !== undefined) {
        out[i].remote = true;
      } else {
        index.set(base, out.length);
        out.push({ label: base, primary: ref, local: false, remote: true, tag: false });
      }
    } else {
      out.push({ label: ref.shorthand, primary: ref, local: false, remote: false, tag: true });
    }
  }
  return out;
}

function RefCell({
  refs,
  isHead,
  color,
  flat,
  onCheckoutRef,
  onRefMenu,
}: {
  refs: RefInfo[];
  isHead: boolean;
  color: number;
  flat?: boolean;
  onCheckoutRef: (ref: RefInfo) => void;
  onRefMenu: (event: React.MouseEvent, ref: RefInfo) => void;
}) {
  const groups = groupRefs(refs);
  let headMarked = false;
  if (flat && groups.length === 0) return null;
  return (
    <span
      className={cn(
        'flex h-full shrink-0 items-center gap-1',
        flat ? 'max-w-56' : '-mr-2',
      )}
      style={flat ? undefined : { width: REF_COL_WIDTH }}
    >
      {groups.slice(0, 2).map((group) => {
        const head = isHead && group.local && !headMarked;
        if (head) headMarked = true;
        return (
          <Badge
            key={group.primary.name}
            tone={group.tag ? 'primary' : group.local ? 'success' : 'info'}
            className={cn(
              'min-w-0 shrink whitespace-nowrap',
              !group.tag &&
                'cursor-pointer hover:z-20 hover:shrink-0 hover:!bg-surface-overlay hover:shadow-soft',
            )}
            title={
              group.tag
                ? group.label
                : `${group.label}${group.local ? ' · local' : ''}${group.remote ? ' · origin' : ''} — double-click to checkout, right-click for actions`
            }
            onDoubleClick={(e) => {
              if (group.tag) return;
              e.stopPropagation();
              onCheckoutRef(group.primary);
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRefMenu(e, group.primary);
            }}
          >
            {head && <Check className="size-2.5 shrink-0" />}
            {group.tag && <TagIcon className="size-2.5 shrink-0" />}
            <span className="truncate">{group.label}</span>
            {group.local && <Monitor className="size-2.5 shrink-0" />}
            {group.remote && <Cloud className="size-2.5 shrink-0" />}
          </Badge>
        );
      })}
      {groups.length > 2 && (
        <Badge className="shrink-0" title={groups.slice(2).map((g) => g.label).join(', ')}>
          +{groups.length - 2}
        </Badge>
      )}
      {!flat && groups.length > 0 && (
        <span
          className="h-px min-w-1 flex-1"
          style={{ background: laneColor(color), opacity: 0.45 }}
        />
      )}
    </span>
  );
}

interface Props {
  commit: CommitInfo;
  row: GraphRowData;
  gutterWidth: number;
  flat?: boolean;
  selected: boolean;
  onSelect: (oid: string, event: React.MouseEvent) => void;
  onContextMenu: (event: React.MouseEvent, commit: CommitInfo) => void;
  onCheckoutRef: (ref: RefInfo) => void;
  onRefMenu: (event: React.MouseEvent, ref: RefInfo, commit: CommitInfo) => void;
}

export const CommitRow = memo(function CommitRow({
  commit,
  row,
  gutterWidth,
  flat,
  selected,
  onSelect,
  onContextMenu,
  onCheckoutRef,
  onRefMenu,
}: Props) {
  const refCell = (
    <RefCell
      refs={commit.refs}
      isHead={commit.isHead}
      color={row.node.color}
      flat={flat}
      onCheckoutRef={onCheckoutRef}
      onRefMenu={(e, ref) => onRefMenu(e, ref, commit)}
    />
  );
  return (
    <div
      role="row"
      aria-selected={selected}
      className={cn(
        'flex h-8 cursor-pointer select-none items-center gap-2 pl-1 pr-2 text-sm transition-colors',
        selected ? 'bg-primary/10' : 'hover:bg-surface-raised',
        commit.isHead && 'font-medium',
      )}
      onClick={(e) => onSelect(commit.oid, e)}
      onContextMenu={(e) => onContextMenu(e, commit)}
    >
      {!flat && refCell}
      {flat ? (
        <FlatGutter author={commit.author} />
      ) : (
        <GraphGutter row={row} width={gutterWidth} author={commit.author} hasRefs={commit.refs.length > 0} />
      )}
      {flat && refCell}
      {commit.isHead && commit.refs.length === 0 && <Badge tone="primary">HEAD</Badge>}
      {commit.parents.length > 1 && <GitMerge className="size-3.5 shrink-0 text-muted" />}
      <span className="min-w-0 flex-1 truncate">{commit.summary || <span className="text-faint">(no message)</span>}</span>
      <span className="w-14 shrink-0 text-right font-mono text-[11px] text-faint">{commit.shortOid.slice(0, 7)}</span>
      <span className="w-[4.5rem] shrink-0 whitespace-nowrap text-right text-[11px] text-faint">{timeAgo(commit.author.time)}</span>
    </div>
  );
});
