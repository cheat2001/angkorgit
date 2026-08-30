import { useRef } from 'react';
import { create } from 'zustand';
import { UserRound } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@angkorgit/design-system';
import { useSettings, type IdentityProfile } from '@/features/settings/store';

interface ProfilePromptState {
  request: { repoName: string; resolve: (value: IdentityProfile | null) => void } | null;
  ask: (repoName: string) => Promise<IdentityProfile | null>;
  settle: (value: IdentityProfile | null) => void;
}

const useProfilePromptStore = create<ProfilePromptState>((set, get) => ({
  request: null,
  ask: (repoName) =>
    new Promise<IdentityProfile | null>((resolve) => {
      get().request?.resolve(null);
      set({ request: { repoName, resolve } });
    }),
  settle: (value) => {
    get().request?.resolve(value);
    set({ request: null });
  },
}));

export function pickProfile(repoName: string): Promise<IdentityProfile | null> {
  return useProfilePromptStore.getState().ask(repoName);
}

export function ProfilePromptHost() {
  const { request, settle } = useProfilePromptStore();
  const profiles = useSettings((s) => s.profiles);
  const firstProfileRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && settle(null)}>
      <DialogContent
        className="max-w-sm"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          firstProfileRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Which profile for {request?.repoName}?</DialogTitle>
          <DialogDescription>
            Commits and pushes in this repository will use the chosen profile's identity and
            accounts. Asked once — change it later from the toolbar.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-1.5">
          {profiles.map((profile, index) => (
            <button
              key={profile.id}
              ref={index === 0 ? firstProfileRef : undefined}
              type="button"
              className="flex items-center gap-3 rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/60 hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              onClick={() => settle(profile)}
            >
              <UserRound className="size-4 shrink-0 text-muted" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{profile.label}</span>
                <span className="block truncate text-xs text-faint">
                  {profile.name} · {profile.email}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div className="flex justify-end">
          <Button variant="ghost" onClick={() => settle(null)}>
            Not now
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
