import { toast } from 'sonner';

export function toastActionError(label: string, error: unknown, reportError?: (message: string) => void): void {
  const payload = error as { code?: string; message?: string } | null;
  const message = String(payload?.message ?? error);
  if (payload?.code === 'operation_running') {
    toast.info(message);
  } else if (reportError) {
    reportError(message);
  } else {
    toast.error(`${label}: ${message}`);
  }
}
