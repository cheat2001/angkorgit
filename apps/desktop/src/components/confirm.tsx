import { create } from 'zustand';
import { AlertTriangle } from 'lucide-react';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@angkorgit/design-system';

/**
 * App-wide confirmation dialog for destructive actions. Usage:
 *
 *   if (await confirmDialog({ title, description, destructive: true })) …
 *
 * Cancel is always the safe default (Esc / clicking outside / close all
 * resolve to false).
 */

export interface ConfirmOptions {
  title: string;
  description: string;
  confirmLabel?: string;
  destructive?: boolean;
}

interface ConfirmState {
  request: (ConfirmOptions & { resolve: (value: boolean) => void }) | null;
  ask: (options: ConfirmOptions) => Promise<boolean>;
  settle: (value: boolean) => void;
}

const useConfirmStore = create<ConfirmState>((set, get) => ({
  request: null,
  ask: (options) =>
    new Promise<boolean>((resolve) => {
      // A newer request supersedes an unanswered one (which resolves false).
      get().request?.resolve(false);
      set({ request: { ...options, resolve } });
    }),
  settle: (value) => {
    get().request?.resolve(value);
    set({ request: null });
  },
}));

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().ask(options);
}

export function ConfirmHost() {
  const { request, settle } = useConfirmStore();
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && settle(false)}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {request?.destructive && <AlertTriangle className="size-4 shrink-0 text-danger" />}
            {request?.title}
          </DialogTitle>
          <DialogDescription>{request?.description}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => settle(false)}>
            Cancel
          </Button>
          <Button
            variant={request?.destructive ? 'danger' : 'default'}
            onClick={() => settle(true)}
          >
            {request?.confirmLabel ?? 'Confirm'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
