import { ipc } from '@/core/ipc';
import { useRepo } from '@/features/repository/store';
import { useSettings, type IdentityProfile } from '@/features/settings/store';
import { pickProfile } from '@/components/profilePrompt';

export function serializeAccountBindings(accounts: Record<string, string> | undefined): string {
  return Object.entries(accounts ?? {})
    .map(([host, username]) => `${host}=${username}`)
    .join(',');
}

export async function applyProfileToRepo(
  repoPath: string,
  profile: IdentityProfile,
  opts?: { preserveIdentity?: boolean },
): Promise<void> {
  if (!opts?.preserveIdentity) {
    await ipc.configSet(repoPath, 'user.name', profile.name, false);
    await ipc.configSet(repoPath, 'user.email', profile.email, false);
  }
  await ipc.configSet(repoPath, 'angkorgit.profile', profile.id, false);
  await ipc.configSet(
    repoPath,
    'angkorgit.accounts',
    serializeAccountBindings(profile.accounts),
    false,
  );
  const repoState = useRepo.getState();
  if (repoState.repo?.path === repoPath) repoState.setProfileId(profile.id);
}

export async function ensureRepoProfile(repoPath: string): Promise<IdentityProfile | null> {
  const { profiles } = useSettings.getState();
  if (profiles.length === 0) return null;

  const repoState = useRepo.getState();
  const assignedId =
    (repoState.repo?.path === repoPath ? repoState.profileId : null) ??
    (await ipc.configGet(repoPath, 'angkorgit.profile'));
  if (assignedId) {
    const assigned = profiles.find((p) => p.id === assignedId);
    if (assigned) return assigned;
  }

  if (profiles.length === 1) {
    const [repoEmail, globalEmail] = await Promise.all([
      ipc.configGet(repoPath, 'user.email'),
      ipc.configGet(null, 'user.email'),
    ]);
    const manualIdentity = repoEmail !== null && repoEmail !== globalEmail;
    await applyProfileToRepo(repoPath, profiles[0], { preserveIdentity: manualIdentity });
    return profiles[0];
  }

  const chosen = await pickProfile(repoPath.split('/').pop() ?? repoPath);
  if (chosen) await applyProfileToRepo(repoPath, chosen);
  return chosen;
}
