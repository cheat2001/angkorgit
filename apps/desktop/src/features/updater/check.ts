import { toast } from 'sonner';
import { isTauri } from '@/core/ipc';

let checking = false;

export async function checkForUpdates(options: { silent: boolean }): Promise<void> {
  if (!isTauri() || checking) return;
  checking = true;
  try {
    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();

    if (!update) {
      if (!options.silent) toast.success('AngKorGit is up to date');
      return;
    }

    toast.info(`AngKorGit ${update.version} is available`, {
      description: 'Download and restart to update.',
      duration: 15_000,
      action: {
        label: 'Update now',
        onClick: () => {
          void (async () => {
            try {
              toast.loading('Downloading update…', { id: 'updater' });
              await update.downloadAndInstall();
              toast.success('Update installed — restarting', { id: 'updater' });
              const { relaunch } = await import('@tauri-apps/plugin-process');
              await relaunch();
            } catch (error) {
              toast.error(`Update failed: ${(error as { message?: string }).message ?? error}`, {
                id: 'updater',
              });
            }
          })();
        },
      },
    });
  } catch (error) {
    if (!options.silent) {
      toast.error(`Update check failed: ${(error as { message?: string }).message ?? error}`);
    }
  } finally {
    checking = false;
  }
}
