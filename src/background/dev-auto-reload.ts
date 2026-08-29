export const DEV_RELOAD_ALARM = 'flippah:dev-auto-reload';
export const DEV_RELOAD_PENDING_KEY = 'flippah:dev-auto-reload:pending-page-refresh';
export const DEV_RELOAD_PENDING_MAX_AGE_MS = 60_000;

const SUPPORTED_PAGE_PATTERNS = [
  'https://hibid.com/*',
  'https://*.hibid.com/*',
  'https://auctionninja.com/*',
  'https://*.auctionninja.com/*',
];

interface PendingPageRefresh {
  requestedAt: number;
  fromVersion: string;
  toVersion: string;
}

export function shouldReloadExtension(loadedVersion: string, diskVersion: unknown): boolean {
  const candidate = String(diskVersion || '').trim();
  return /^\d+\.\d+\.\d+(?:\.\d+)?$/.test(candidate) && candidate !== loadedVersion;
}

export function shouldRefreshSupportedTab(url: string | null | undefined): boolean {
  try {
    const parsed = new URL(String(url || ''));
    return parsed.protocol === 'https:'
      && (/(^|\.)hibid\.com$/i.test(parsed.hostname) || /(^|\.)auctionninja\.com$/i.test(parsed.hostname));
  } catch {
    return false;
  }
}

export function shouldConsumePendingPageRefresh(
  value: unknown,
  loadedVersion: string,
  now = Date.now(),
): value is PendingPageRefresh {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PendingPageRefresh>;
  return Number.isFinite(candidate.requestedAt)
    && now - Number(candidate.requestedAt) >= 0
    && now - Number(candidate.requestedAt) <= DEV_RELOAD_PENDING_MAX_AGE_MS
    && String(candidate.toVersion || '') === loadedVersion;
}

function localGet(key: string): Promise<unknown> {
  return new Promise((resolve) => chrome.storage.local.get(key, (value) => {
    const error = chrome.runtime.lastError;
    if (error) resolve(undefined); else resolve(value[key]);
  }));
}

function localSet(key: string, value: PendingPageRefresh): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.set({ [key]: value }, () => resolve()));
}

function localRemove(key: string): Promise<void> {
  return new Promise((resolve) => chrome.storage.local.remove(key, () => resolve()));
}

function querySupportedTabs(): Promise<chrome.tabs.Tab[]> {
  return new Promise((resolve) => chrome.tabs.query({ url: SUPPORTED_PAGE_PATTERNS }, (tabs) => {
    if (chrome.runtime.lastError) resolve([]); else resolve(tabs);
  }));
}

function reloadTab(tabId: number): Promise<void> {
  return new Promise((resolve) => chrome.tabs.reload(tabId, { bypassCache: true }, () => resolve()));
}

export async function refreshSupportedTabsAfterReload(loadedVersion: string): Promise<number> {
  const pending = await localGet(DEV_RELOAD_PENDING_KEY);
  if (!shouldConsumePendingPageRefresh(pending, loadedVersion)) {
    if (pending) await localRemove(DEV_RELOAD_PENDING_KEY);
    return 0;
  }

  // Clear first so a worker restart or a failed tab cannot create a refresh loop.
  await localRemove(DEV_RELOAD_PENDING_KEY);
  const tabs = (await querySupportedTabs()).filter((tab) => typeof tab.id === 'number' && shouldRefreshSupportedTab(tab.url));
  await Promise.allSettled(tabs.map((tab) => reloadTab(tab.id!)));
  return tabs.length;
}

export function installUnpackedAutoReload(): { check: () => Promise<void>; loadedVersion: string } {
  const loadedVersion = chrome.runtime.getManifest().version;
  let checking = false;

  void refreshSupportedTabsAfterReload(loadedVersion);

  const check = async (): Promise<void> => {
    if (checking) return;
    checking = true;
    try {
      const url = `${chrome.runtime.getURL('manifest.json')}?flippahReload=${Date.now()}`;
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) return;
      const manifest = await response.json() as { version?: unknown };
      if (shouldReloadExtension(loadedVersion, manifest.version)) {
        const toVersion = String(manifest.version).trim();
        await localSet(DEV_RELOAD_PENDING_KEY, { requestedAt: Date.now(), fromVersion: loadedVersion, toVersion });
        chrome.runtime.reload();
      }
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
