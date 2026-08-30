import { useRef } from 'react';
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

export interface ConfirmOptions {
  title: string;
  description: string;
  path?: string;
  confirmLabel?: string;
  destructive?: boolean;
}

interface ConfirmState {
  request: (ConfirmOptions & { resolve: (value: boolean) => void }) | null;
  ask: (options: ConfirmOptions) => Promise<boolean>;
  settle: (value: boolean) => void;
}

let confirmReturnFocus: HTMLElement | null = null;

const useConfirmStore = create<ConfirmState>((set, get) => ({
  request: null,
  ask: (options) =>
    new Promise<boolean>((resolve) => {
      if (!get().request) {
        const active = document.activeElement;
        confirmReturnFocus = active instanceof HTMLElement ? active : null;
      }
      get().request?.resolve(false);
      set({ request: { ...options, resolve } });
    }),
  settle: (value) => {
    get().request?.resolve(value);
    set({ request: null });
    const target = confirmReturnFocus;
    confirmReturnFocus = null;
    if (target && document.contains(target)) {
      requestAnimationFrame(() => target.focus());
    }
  },
}));

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().ask(options);
}

function PathBlock({ path }: { path: string }) {
  const segments = path.split('/');
  const name = segments.pop() ?? path;
  return (
    <p className="mt-1 max-h-32 overflow-y-auto rounded-md border border-border-subtle bg-surface-raised px-2 py-1.5 font-mono text-xs leading-relaxed [overflow-wrap:anywhere]">
      {segments.map((segment, index) => (
        <span key={index} className="text-muted">
          {segment}/<wbr />
        </span>
      ))}
      <span className="text-foreground">{name}</span>
    </p>
  );
}

export function ConfirmHost() {
  const { request, settle } = useConfirmStore();
  const confirmRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={request !== null} onOpenChange={(open) => !open && settle(false)}>
      <DialogContent
        className="max-w-sm"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          confirmRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {request?.destructive && <AlertTriangle className="size-4 shrink-0 text-danger" />}
            {request?.title}
          </DialogTitle>
          <DialogDescription>{request?.description}</DialogDescription>
          {request?.path && <PathBlock path={request.path} />}
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => settle(false)}>
            Cancel
          </Button>
          <Button
            ref={confirmRef}
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
