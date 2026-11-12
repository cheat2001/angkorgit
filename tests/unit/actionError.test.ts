import { beforeEach, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { toastActionError } from '../../apps/desktop/src/components/actionError';

vi.mock('sonner', () => ({ toast: { info: vi.fn(), error: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

it('shows busy responses as information without the failure prefix or formatter', () => {
  const reportError = vi.fn();
  toastActionError('Checkout main failed', {
    code: 'operation_running',
    message: 'post-checkout is still running in angkorgit',
  }, reportError);
  expect(toast.info).toHaveBeenCalledWith('post-checkout is still running in angkorgit');
  expect(toast.error).not.toHaveBeenCalled();
  expect(reportError).not.toHaveBeenCalled();
});

it('keeps the failure prefix for other errors', () => {
  toastActionError('Checkout main failed', { code: 'git', message: 'conflict' });
  expect(toast.error).toHaveBeenCalledWith('Checkout main failed: conflict');
  expect(toast.info).not.toHaveBeenCalled();
});

it('keeps custom formatting for other errors', () => {
  const reportError = vi.fn();
  toastActionError('Pull failed', { message: 'headline\ndetails' }, reportError);
  expect(reportError).toHaveBeenCalledWith('headline\ndetails');
  expect(toast.error).not.toHaveBeenCalled();
});
