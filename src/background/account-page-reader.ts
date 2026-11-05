import { envelope, type MessageEnvelope, type MessageResponse } from '../core/messages.js';
import { normalizedHiBidAccountPath } from '../core/route.js';
import type { PastAuctionGroup } from '../core/types.js';
import type { HibidAccountPageSnapshot } from '../hibid/account-snapshot.js';

const ACCOUNT_READER_ALARM = 'flippah-account-reader-cleanup';
const ACCOUNT_READER_TTL_MS = 25_000;
const ACCOUNT_READER_POLL_MS = 100;
const ACCOUNT_PATHS = new Set(['watchlist', 'currentbids', 'pastbids', 'pastbidsm', 'pastwatchlist']);
const SESSION_KEY = 'flippah.account.reader.owned';

export interface AccountReadRequest {
  url: string;
  selectedGroup?: PastAuctionGroup;
}

interface OwnedReader {
  tabId: number;
  ownerTabId: number;
  createdAt: number;
}

export interface AccountReaderApis {
  createTab(properties: chrome.tabs.CreateProperties): Promise<chrome.tabs.Tab>;
  getTab(tabId: number): Promise<chrome.tabs.Tab | null>;
  removeTab(tabId: number): Promise<void>;
  sendMessage(tabId: number, message: MessageEnvelope): Promise<unknown>;
  sessionGet(): Promise<unknown>;
  sessionSet(value: Record<string, OwnedReader>): Promise<void>;
  sessionRemove(): Promise<void>;
  createAlarm(): Promise<void>;
  now(): number;
}

export interface AccountPageReader {
  read(ownerTabId: number, request: AccountReadRequest): Promise<HibidAccountPageSnapshot>;
  cancel(ownerTabId: number): Promise<void>;
  cleanup(): Promise<void>;
  cleanupOnAlarm(): Promise<void>;
}

function isHiBidHost(hostname: string): boolean {
  return /(^|\.)hibid\.com$/i.test(hostname);
}

function assertSourceUrl(value: string): URL {
  const url = new URL(value);
  const path = normalizedHiBidAccountPath(url);
  if (url.protocol !== 'https:' || !isHiBidHost(url.hostname) || !path || !ACCOUNT_PATHS.has(path.split('/').pop() || '')) {
    throw new Error('HiBid account reader requires an HTTPS account URL');
  }
  return url;
}

function targetUrl(request: AccountReadRequest, source: URL): URL {
  const url = assertSourceUrl(request.url);
  const sourcePath = normalizedHiBidAccountPath(source);
  const targetPath = normalizedHiBidAccountPath(url);
  if (request.selectedGroup) {
    if (!/^\d+$/.test(request.selectedGroup.id) || !/^(?:\/[^/]+)*\/account\/(?:pastbidsm?|pastwatchlist)$/.test(sourcePath || '')) throw new Error('Selected auction is invalid for this account route');
    url.searchParams.set('auctionid', request.selectedGroup.id);
  }
  const scope = (value: URL): string => {
    const copy = new URL(value);
    copy.searchParams.delete('apage');
    if (request.selectedGroup) copy.searchParams.set('auctionid', request.selectedGroup.id);
    return queryScope(copy);
  };
  if (url.origin !== source.origin || targetPath !== sourcePath || scope(url) !== scope(source)) {
    throw new Error('HiBid account reader rejected a different source scope');
  }
  return url;
}

function queryScope(url: URL): string {
  return JSON.stringify([...url.searchParams].sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv)));
}

function assertActualTarget(actualValue: string | undefined, expected: URL): void {
  if (!actualValue) throw new Error('HiBid account reader tab has no URL');
  const actual = new URL(actualValue);
  if (actual.origin !== expected.origin || normalizedHiBidAccountPath(actual) !== normalizedHiBidAccountPath(expected) || queryScope(actual) !== queryScope(expected)) {
    throw new Error('HiBid account reader tab navigated away from the requested account scope');
  }
}

function snapshotFrom(value: unknown): HibidAccountPageSnapshot | null {
  const data = value && typeof value === 'object' && 'data' in value ? (value as { data: unknown }).data : value;
  if (!data || typeof data !== 'object') return null;
  const item = data as Partial<HibidAccountPageSnapshot> & { ready?: unknown; status?: unknown };
  if (item.ready === false || item.status === 'loading' || item.status === 'not-ready') return null;
  const expectedTotal = item.expectedTotal;
  const visibleCount = item.visibleCount;
  const page = item.page;
  if (typeof item.url !== 'string' || typeof expectedTotal !== 'number' || !Number.isInteger(expectedTotal) || expectedTotal < 0
    || typeof visibleCount !== 'number' || !Number.isInteger(visibleCount) || visibleCount < 0
    || typeof page !== 'number' || !Number.isInteger(page) || page < 1
    || !Array.isArray(item.items) || item.items.length !== visibleCount || visibleCount > expectedTotal
    || item.items.some(row => !row || typeof row.id !== 'string' || !/^\d+$/.test(row.id)
      || (row.eventItemId !== undefined && row.eventItemId !== row.id))) {
    throw new Error('HiBid account snapshot was invalid');
  }
  return {
    url: item.url,
    expectedTotal,
    visibleCount,
    page,
    items: item.items,
  };
}

function isTransientNotReady(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return /HiBid account list is still loading|HiBid account lot count is unavailable; wait for the list to load and retry|receiving end does not exist|could not establish connection|message port closed|tab .*not found/i.test(message);
}

export function createAccountPageReader(apis: AccountReaderApis, options: { timeoutMs?: number; pollMs?: number } = {}): AccountPageReader {
  let active: { owner: number; cancelled: boolean; abort: (() => void) | null } | null = null;
  let registryQueue = Promise.resolve();
  const enqueueRegistry = <T>(mutation: () => Promise<T>): Promise<T> => {
    const next = registryQueue.then(mutation, mutation);
    registryQueue = next.then(() => undefined, () => undefined);
    return next;
  };
  const read = async (ownerTabId: number, request: AccountReadRequest): Promise<HibidAccountPageSnapshot> => {
    if (active) throw new Error('HiBid account reader is busy');
    const operation = { owner: ownerTabId, cancelled: false, abort: null as (() => void) | null };
    active = operation;
    let tabId: number | undefined;
    const timeoutMs = Math.min(20_000, Math.max(1, options.timeoutMs ?? 20_000));
    const deadline = Date.now() + timeoutMs;
    const timeout = (): Error => new Error(`HiBid account reader timed out after ${timeoutMs}ms`);
    const bounded = async <T>(promise: Promise<T>): Promise<T> => {
      if (operation.cancelled) throw new Error('HiBid account reader was cancelled');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
          operation.abort = () => reject(new Error('HiBid account reader was cancelled'));
          timer = setTimeout(() => reject(timeout()), Math.max(0, deadline - Date.now()));
        })]);
      } finally {
        clearTimeout(timer);
        operation.abort = null;
      }
    };
    try {
      const owner = await bounded(apis.getTab(ownerTabId));
      const source = assertSourceUrl(owner?.url || '');
      const target = targetUrl(request, source);
      const abandonedError = await enqueueRegistry(async () => {
        const abandoned = await readRegistrations(apis);
        const abandonedFailures: number[] = [];
        for (const [owner, entry] of Object.entries(abandoned)) {
          if (await removeReader(apis, entry)) delete abandoned[owner];
          else abandonedFailures.push(entry.tabId);
        }
        if (Object.keys(abandoned).length) await apis.sessionSet(abandoned);
        else await apis.sessionRemove();
        if (abandonedFailures.length) await apis.createAlarm();
        return cleanupError(abandonedFailures);
      });
      if (abandonedError) throw abandonedError;
      // Remember a late creation too, so cancellation cannot leave an orphan tab.
      const creation = apis.createTab({ url: target.href, active: false }).then(async tab => {
        if (operation.cancelled || active !== operation) {
          if (tab.id) {
            const entry = { tabId: tab.id, ownerTabId, createdAt: apis.now() };
            await enqueueRegistry(async () => {
              if (!await removeReader(apis, entry)) {
                const remaining = await readRegistrations(apis);
                remaining[`late:${tab.id}`] = entry;
                await apis.sessionSet(remaining);
                await apis.createAlarm();
              }
            });
          }
        } else tabId = tab.id;
        return tab;
      });
      const created = await bounded(creation);
      if (!created.id) throw new Error('HiBid account reader tab was not created');
      tabId = created.id;
      await enqueueRegistry(async () => {
        const registrations = await readRegistrations(apis);
        registrations[String(ownerTabId)] = { tabId: tabId!, ownerTabId, createdAt: apis.now() };
        await apis.sessionSet(registrations);
        await apis.createAlarm();
      });
      const requestMessage = envelope('flippah:account.snapshot', { selectedGroup: request.selectedGroup });
      let emptySince: number | null = null;
      while (Date.now() < deadline) {
        const assertOwner = async (): Promise<void> => {
          const currentOwner = await bounded(apis.getTab(ownerTabId));
          assertActualTarget(currentOwner?.url, source);
        };
        await assertOwner();
        const current = await bounded(apis.getTab(tabId));
        if (!current) throw new Error('HiBid account reader tab was closed while loading');
        assertActualTarget(current.url || current.pendingUrl, target);
        try {
          const response = await bounded(apis.sendMessage(tabId, requestMessage));
          if (response && typeof response === 'object' && 'ok' in response && (response as MessageResponse).ok === false) {
            throw new Error((response as Extract<MessageResponse, { ok: false }>).error.message);
          }
          const snapshot = snapshotFrom(response);
          if (snapshot) {
            assertActualTarget(snapshot.url, target);
            await assertOwner();
            const after = await bounded(apis.getTab(tabId));
            assertActualTarget(after?.url, target);
            if (snapshot.expectedTotal !== 0) return snapshot;
            emptySince ??= Date.now();
            if (Date.now() - emptySince >= 200) return snapshot;
          } else emptySince = null;
        } catch (error) {
          emptySince = null;
          if (!isTransientNotReady(error)) throw error;
        }
        await bounded(new Promise(resolve => setTimeout(resolve, options.pollMs ?? ACCOUNT_READER_POLL_MS)));
      }
      throw timeout();
    } finally {
      operation.cancelled = true;
      let cleanupFailure: Error | null = null;
      if (tabId !== undefined) {
        cleanupFailure = await enqueueRegistry(async () => {
          const entry = { tabId: tabId!, ownerTabId, createdAt: apis.now() };
          const removed = await removeReader(apis, entry);
          const remaining = await readRegistrations(apis).catch(() => ({} as Record<string, OwnedReader>));
          if (removed && remaining[String(ownerTabId)]?.tabId === tabId) delete remaining[String(ownerTabId)];
          if (!removed) remaining[String(ownerTabId)] = entry;
          await apis.sessionSet(remaining).catch(() => undefined);
          if (!removed) {
            await apis.createAlarm().catch(() => undefined);
            return cleanupError([tabId!]);
          }
          return null;
        });
      }
      if (active === operation) active = null;
      if (cleanupFailure) throw cleanupFailure;
    }
  };

  return {
    read,
    async cancel(ownerTabId: number): Promise<void> {
      if (active?.owner === ownerTabId) {
        active.cancelled = true;
        active.abort?.();
        return;
      }
      const error = await enqueueRegistry(async () => {
        const registrations = await readRegistrations(apis);
        const owners = Object.entries(registrations)
          .filter(([owner, entry]) => owner === String(ownerTabId) || entry.ownerTabId === ownerTabId);
        if (!owners.length) return null;
        const failures: number[] = [];
        for (const [owner, entry] of owners) {
          if (await removeReader(apis, entry)) delete registrations[owner];
          else failures.push(entry.tabId);
        }
        await apis.sessionSet(registrations).catch(() => undefined);
        if (Object.keys(registrations).length) await apis.createAlarm().catch(() => undefined);
        return cleanupError(failures);
      });
      if (error) throw error;
    },
    async cleanup(): Promise<void> {
      const error = await enqueueRegistry(async () => {
        const registrations = await readRegistrations(apis);
        const failures: number[] = [];
        for (const [owner, entry] of Object.entries(registrations)) {
          if (await removeReader(apis, entry)) delete registrations[owner];
          else failures.push(entry.tabId);
        }
        if (Object.keys(registrations).length) {
          await apis.sessionSet(registrations);
          await apis.createAlarm();
        } else await apis.sessionRemove();
        return cleanupError(failures);
      });
      if (error) throw error;
    },
    async cleanupOnAlarm(): Promise<void> {
      const error = await enqueueRegistry(async () => {
        const registrations = await readRegistrations(apis);
        const expired = Object.values(registrations).filter((entry) => apis.now() - entry.createdAt >= ACCOUNT_READER_TTL_MS);
        const failures: number[] = [];
        for (const entry of expired) {
          const removed = await removeReader(apis, entry);
          const key = Object.keys(registrations).find((owner) => registrations[owner]?.tabId === entry.tabId);
          if (key && removed) delete registrations[key];
          if (!removed) failures.push(entry.tabId);
        }
        if (expired.length) await apis.sessionSet(registrations);
        if (Object.keys(registrations).length) await apis.createAlarm();
        return cleanupError(failures);
      });
      if (error) throw error;
    },
  };
}

async function readRegistrations(apis: AccountReaderApis): Promise<Record<string, OwnedReader>> {
  const value = await apis.sessionGet();
  return value && typeof value === 'object' ? { ...(value as Record<string, OwnedReader>) } : {};
}

async function removeReader(apis: AccountReaderApis, entry: OwnedReader): Promise<boolean> {
  try {
    await apis.removeTab(entry.tabId);
    return true;
  } catch {
    try {
      return !(await apis.getTab(entry.tabId));
    } catch {
      return false;
    }
  }
}

function cleanupError(tabIds: number[]): Error | null {
  return tabIds.length ? new Error(`HiBid account reader cleanup failed for tab${tabIds.length === 1 ? '' : 's'} ${tabIds.join(', ')}`) : null;
}

export function installAccountPageReader(): AccountPageReader {
  const call = <T>(fn: (callback: (value: T) => void) => void): Promise<T> => new Promise((resolve, reject) => {
    fn((value) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message)); else resolve(value);
    });
  });
  const reader = createAccountPageReader({
    createTab: (properties) => call((done) => chrome.tabs.create(properties, done)),
    getTab: (tabId) => new Promise((resolve) => chrome.tabs.get(tabId, (tab) => resolve(chrome.runtime.lastError ? null : tab))),
    removeTab: (tabId) => call((done) => chrome.tabs.remove(tabId, done)),
    sendMessage: (tabId, message) => call((done) => chrome.tabs.sendMessage(tabId, message, done)),
    sessionGet: () => call((done) => chrome.storage.session.get(SESSION_KEY, done)).then((value) => (value as Record<string, unknown>)[SESSION_KEY]),
    sessionSet: (value) => call((done) => chrome.storage.session.set({ [SESSION_KEY]: value }, done)),
    sessionRemove: () => call((done) => chrome.storage.session.remove(SESSION_KEY, done)),
    createAlarm: async () => { await chrome.alarms.create(ACCOUNT_READER_ALARM, { when: Date.now() + ACCOUNT_READER_TTL_MS }); },
    now: () => Date.now(),
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    void reader.cancel(tabId).catch(() => undefined);
  });
  return reader;
}

export { ACCOUNT_READER_ALARM };
