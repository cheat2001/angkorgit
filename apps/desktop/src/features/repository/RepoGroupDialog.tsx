import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Check } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  cn,
} from '@angkorgit/design-system';
import {
  REPO_GROUP_COLORS,
  REPO_GROUP_COLOR_NAMES,
  groupRepos,
  nextRepoGroupColor,
  repoGroupNameProblem,
} from '@angkorgit/core';
import { deleteRepoGroup, repoGroupColor } from './groups';
import { repoDisplayName } from './RepoShortcutDialog';
import { useRepo } from './store';
import { Field } from '@/features/settings/SettingCard';
import { useSettings } from '@/features/settings/store';
import { useUi, type RepoGroupPreset } from '@/features/ui/store';

export function RepoGroupDialog() {
  const dialog = useUi((s) => s.dialog);
  const dialogContext = useUi((s) => s.dialogContext);
  const closeDialog = useUi((s) => s.closeDialog);
  const groups = useSettings((s) => s.repoGroups);
  const groupOf = useSettings((s) => s.repoGroupOf);
  const addRepoGroup = useSettings((s) => s.addRepoGroup);
  const updateRepoGroup = useSettings((s) => s.updateRepoGroup);
  const mains = useUi((s) => s.worktreeMains);
  const recents = useRepo((s) => s.recents);

  const open =
    dialog === 'repoGroup' && !!dialogContext && typeof dialogContext === 'object' && 'groupId' in dialogContext;
  const preset: RepoGroupPreset = open ? (dialogContext as RepoGroupPreset) : { groupId: null, repoPath: null };
  const existing = preset.groupId ? groups.find((group) => group.id === preset.groupId) ?? null : null;
  const repoName = preset.repoPath ? repoDisplayName(preset.repoPath, recents) : null;
  const repoCount = useMemo(
    () => (existing ? groupRepos(recents, groups, groupOf, mains).sections.find((s) => s.group.id === existing.id)?.repos.length ?? 0 : 0),
    [existing, recents, groups, groupOf, mains],
  );

  const [name, setName] = useState('');
  const [color, setColor] = useState(0);

  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? '');
    setColor(existing?.color ?? nextRepoGroupColor(groups));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preset.groupId]);

  const problem = repoGroupNameProblem(name, groups, existing?.id);
  const unchanged = !!existing && existing.name === name.trim() && existing.color === color;
  const canSave = !problem && !unchanged;

  const save = () => {
    if (!canSave) return;
    const trimmed = name.trim();
    if (existing) {
      updateRepoGroup(existing.id, { name: trimmed, color });
    } else {
      addRepoGroup(trimmed, color, preset.repoPath ? [preset.repoPath] : []);
      toast.success(repoName ? `${repoName} added to ${trimmed}` : `Group ${trimmed} created`);
    }
    closeDialog();
  };

  const remove = async () => {
    if (!existing) return;
    closeDialog();
    await deleteRepoGroup(existing, repoCount);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && closeDialog()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{existing ? 'Edit group' : 'New group'}</DialogTitle>
          <DialogDescription>
            {existing
              ? 'Rename the group or pick another colour. Its repositories stay where they are.'
              : repoName
                ? <>Groups keep related repositories together. <span className="font-medium text-foreground">{repoName}</span> moves into this one, and others can join from their menu.</>
                : 'Groups keep related repositories together on the welcome page and in the repository menu.'}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field
            label="Name"
            hint={
              problem === 'taken' ? <span className="text-danger">A group with this name already exists</span> : undefined
            }
          >
            <Input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  save();
                }
              }}
              placeholder="Frontend, Work, Personal…"
              aria-invalid={problem === 'taken' || undefined}
              data-group-name
            />
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted">Colour</span>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Group colour">
              {Array.from({ length: REPO_GROUP_COLORS }, (_, index) => {
                const selected = index === color;
                return (
                  <button
                    key={index}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={REPO_GROUP_COLOR_NAMES[index]}
                    onClick={() => setColor(index)}
                    className={cn(
                      'flex size-7 items-center justify-center rounded-full transition-transform',
                      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-overlay',
                      selected ? 'scale-110' : 'hover:scale-105',
                    )}
                    style={{ backgroundColor: repoGroupColor(index) }}
                  >
                    {selected && <Check className="size-3.5 text-background" strokeWidth={3} />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        <DialogFooter>
          {existing && (
            <Button variant="ghost" className="mr-auto text-danger hover:text-danger" onClick={() => void remove()}>
              Ungroup
            </Button>
          )}
          <Button variant="ghost" onClick={closeDialog}>
            Cancel
          </Button>
          <Button disabled={!canSave} onClick={save}>
            {existing ? 'Save' : 'Create group'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
