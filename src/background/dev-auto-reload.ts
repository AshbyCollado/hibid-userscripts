export const DEV_RELOAD_ALARM = 'flippah:dev-auto-reload';

export function shouldReloadExtension(loadedVersion: string, diskVersion: unknown): boolean {
  const candidate = String(diskVersion || '').trim();
  return /^\d+\.\d+\.\d+(?:\.\d+)?$/.test(candidate) && candidate !== loadedVersion;
}

export function installUnpackedAutoReload(): { check: () => Promise<void>; loadedVersion: string } {
  const loadedVersion = chrome.runtime.getManifest().version;
  let checking = false;

  const check = async (): Promise<void> => {
    if (checking) return;
    checking = true;
    try {
      const url = `${chrome.runtime.getURL('manifest.json')}?flippahReload=${Date.now()}`;
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) return;
      const manifest = await response.json() as { version?: unknown };
      if (shouldReloadExtension(loadedVersion, manifest.version)) chrome.runtime.reload();
    } catch {
      // Packed releases never change under a running extension. A failed probe
      // is therefore harmless and will be retried by the next timer/alarm.
    } finally {
      checking = false;
    }
  };

  globalThis.setInterval(() => void check(), 2_000);
  void chrome.alarms.create(DEV_RELOAD_ALARM, { periodInMinutes: 0.5 });
  void check();
  return { check, loadedVersion };
}
