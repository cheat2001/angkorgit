import { toast } from 'sonner';
import { Check, FolderMinus, Folders, Plus } from 'lucide-react';
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  cn,
} from '@angkorgit/design-system';
import { repoGroupIdFor, type RepoGroup } from '@angkorgit/core';
import { repoGroupColor, repoGroupTint } from './groups';
import { repoDisplayName } from './RepoShortcutDialog';
import { useRepo } from './store';
import { useSettings } from '@/features/settings/store';
import { useUi } from '@/features/ui/store';

export function GroupDot({ color, className }: { color: number; className?: string }) {
  return (
    <span className={cn('flex size-4 shrink-0 items-center justify-center', className)} aria-hidden>
      <span className="size-2 rounded-full" style={{ backgroundColor: repoGroupColor(color) }} />
    </span>
  );
}

export function GroupTile({ color, className }: { color: number | null; className?: string }) {
  return (
    <span
      data-group-tile
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded',
        color === null && 'bg-foreground/[0.08] text-muted',
        className,
      )}
      style={color === null ? undefined : { color: repoGroupColor(color), backgroundColor: repoGroupTint(color) }}
    >
      <Folders className="size-3" />
    </span>
  );
}

export function RepoGroupSubmenu({ path }: { path: string }) {
  const groups = useSettings((s) => s.repoGroups);
  const groupOf = useSettings((s) => s.repoGroupOf);
  const setRepoGroup = useSettings((s) => s.setRepoGroup);
  const mains = useUi((s) => s.worktreeMains);
  const openDialog = useUi((s) => s.openDialog);
  const recents = useRepo((s) => s.recents);
  const currentId = repoGroupIdFor(path, groupOf, mains);
  const direct = groupOf[path] ?? null;

  const move = (group: RepoGroup) => {
    if (group.id === currentId) return;
    setRepoGroup(path, group.id);
    toast.success(`${repoDisplayName(path, recents)} moved to ${group.name}`);
  };

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Folders /> {currentId ? 'Move to group' : 'Add to group'}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-w-72">
        {groups.map((group) => (
          <DropdownMenuItem key={group.id} onClick={() => move(group)}>
            {group.id === currentId ? <Check className="text-primary" /> : <GroupDot color={group.color} />}
            <span className="min-w-0 flex-1 truncate">{group.name}</span>
          </DropdownMenuItem>
        ))}
        {groups.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem onClick={() => openDialog('repoGroup', { groupId: null, repoPath: path })}>
          <Plus /> New group…
        </DropdownMenuItem>
        {direct && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setRepoGroup(path, null)}>
              <FolderMinus /> Remove from group
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
