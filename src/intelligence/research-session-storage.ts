import { getLocalStorage, setLocalStorage } from '../core/browser.js';

const STORAGE_PREFIX = 'flippah:research-session:v1:';
const STORAGE_LOCK = 'flippah:research-session-storage:v1';
const MAX_RECORDS = 100;
const CONCURRENT_TIMESTAMP_SKEW_MS = 5_000;

export interface ResearchSessionIdentity {
  auctionId?: string | null;
  sourceId: string;
  query?: string | null;
  condition?: string | null;
}

export interface ResearchSessionStorageInput {
  provider: string;
  pageKind: string;
  routeFingerprint: string;
  scope?: string | null;
  identities: ResearchSessionIdentity[];
  now?: number;
}

interface StoredResearchSession {
  version: 1;
  digest: string;
  sessionStartedAt: string;
  savedAt: string;
}

function text(value: unknown): string {
  return String(value ?? '').trim();
}

function canonical(input: ResearchSessionStorageInput): string {
  const identities = input.identities
    .map((identity) => ({
      auctionId: text(identity.auctionId),
      sourceId: text(identity.sourceId),
      query: text(identity.query).toLowerCase().replace(/\s+/g, ' '),
      condition: text(identity.condition).toLowerCase().replace(/\s+/g, ' '),
    }))
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return JSON.stringify({
    provider: text(input.provider),
    pageKind: text(input.pageKind),
    routeFingerprint: text(input.routeFingerprint),
    scope: text(input.scope),
    identities,
  });
}

async function digestCanonical(signature: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error('Research session storage requires Web Crypto');
  const bytes = new TextEncoder().encode(signature);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function storageKey(digest: string): string {
  return `${STORAGE_PREFIX}${digest}`;
}

function validTimestamp(value: unknown, now: number): value is string {
  if (typeof value !== 'string') return false;
  const parsed = Date.parse(value);
  // Concurrent popup contexts can acquire the storage lock out of call order.
  return Number.isFinite(parsed) && parsed <= now + CONCURRENT_TIMESTAMP_SKEW_MS;
}

function validStored(value: unknown, digest: string, now: number): value is StoredResearchSession {
  if (!value || typeof value !== 'object') return false;
  const stored = value as Partial<StoredResearchSession>;
  return stored.version === 1
    && stored.digest === digest
    && validTimestamp(stored.sessionStartedAt, now)
    && validTimestamp(stored.savedAt, now);
}

export async function researchSessionStorageKey(input: ResearchSessionStorageInput): Promise<string> {
  return storageKey(await digestCanonical(canonical(input)));
}

export async function resolveResearchSessionStartedAt(input: ResearchSessionStorageInput): Promise<string> {
  const now = input.now ?? Date.now();
  const signature = canonical(input);
  const digest = await digestCanonical(signature);
  const key = storageKey(digest);
  const locks = (globalThis as typeof globalThis & { navigator?: { locks?: { request<T>(name: string, callback: () => Promise<T>): Promise<T> } } }).navigator?.locks;
  if (!locks) throw new Error('Research session storage is unavailable in this browser context');

  return locks.request(STORAGE_LOCK, async () => {
    let stored: unknown;
    try {
      stored = (await getLocalStorage([key]))[key];
    } catch {
      throw new Error('Research session could not be read; export was not copied');
    }
    if (validStored(stored, digest, now)) return stored.sessionStartedAt;
    const startedAt = new Date(now).toISOString();
    const record: StoredResearchSession = {
      version: 1,
      digest,
      sessionStartedAt: startedAt,
      savedAt: startedAt,
    };
    try {
      await setLocalStorage({ [key]: record });
    } catch {
      try {
        await pruneOldRecords(MAX_RECORDS - 1);
        await setLocalStorage({ [key]: record });
      } catch {
        throw new Error('Research session could not be saved; export was not copied');
      }
    }
    try { await pruneOldRecords(); } catch { /* A saved session is still valid if pruning fails. */ }
    return startedAt;
  });
}

async function pruneOldRecords(maxRecords = MAX_RECORDS): Promise<void> {
  const all = await getLocalStorage();
  const records = Object.entries(all)
    .filter(([key, value]) => key.startsWith(STORAGE_PREFIX) && typeof (value as Partial<StoredResearchSession>)?.savedAt === 'string' && Number.isFinite(Date.parse((value as StoredResearchSession).savedAt)))
    .sort(([, left], [, right]) => Date.parse((left as StoredResearchSession).savedAt) - Date.parse((right as StoredResearchSession).savedAt));
  const staleKeys = records.slice(0, Math.max(0, records.length - maxRecords)).map(([key]) => key);
  if (!staleKeys.length) return;
  await removeLocalStorage(staleKeys);
}

function removeLocalStorage(keys: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve();
    });
  });
}
