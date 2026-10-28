import { toast } from 'sonner';

export function toastOutcome(
  outcome: { status?: string; message?: string } | undefined,
  fallback: string,
): void {
  if (outcome?.status === 'failed') toast.error(outcome.message ?? fallback);
  else if (outcome?.status === 'conflicts' || outcome?.status === 'partial' || outcome?.status === 'hooks_skipped')
    toast.warning(outcome.message ?? fallback);
  else if (outcome?.status === 'up_to_date') toast.info(outcome.message ?? fallback);
  else toast.success(outcome?.message ?? fallback);
}
