const DB_NAME = 'flippah-retail';
const DB_VERSION = 1;
const STORE = 'quotes';

export const RETAIL_MATCHING_EPOCH = 8;

export interface RetailCacheEntry<T = unknown> {
  key: string;
  value: T;
  savedAt: number;
  expiresAt: number;
}

function openRetailDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'key' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Retail cache could not be opened'));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Retail cache request failed'));
  });
}

export async function getRetailCache<T>(key: string, now = Date.now()): Promise<T | null> {
  const db = await openRetailDb();
  try {
    const entry = await requestResult(db.transaction(STORE, 'readonly').objectStore(STORE).get(key)) as RetailCacheEntry<T> | undefined;
    if (!entry || entry.expiresAt <= now) return null;
    return entry.value;
  } finally {
    db.close();
  }
}

export async function findRetailCacheByQuery<T extends { query?: string; candidates?: unknown[]; match?: unknown }>(query: string, now = Date.now()): Promise<T | null> {
  const target = query.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!target) return null;
  const db = await openRetailDb();
  try {
    const entries = await requestResult(db.transaction(STORE, 'readonly').objectStore(STORE).getAll()) as RetailCacheEntry<T>[];
    const matches = entries.filter((entry) => entry.expiresAt > now && String(entry.value?.query || '').replace(/\s+/g, ' ').trim().toLowerCase() === target);
    matches.sort((left, right) => {
      const leftEvidence = Number(Boolean(left.value?.match)) + Number(left.value?.candidates?.length || 0);
      const rightEvidence = Number(Boolean(right.value?.match)) + Number(right.value?.candidates?.length || 0);
      return rightEvidence - leftEvidence || right.savedAt - left.savedAt;
    });
    return matches[0]?.value ?? null;
  } finally {
    db.close();
  }
}

export async function putRetailCache<T>(key: string, value: T, ttlMs: number, now = Date.now()): Promise<void> {
  const db = await openRetailDb();
  try {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).put({ key, value, savedAt: now, expiresAt: now + ttlMs } satisfies RetailCacheEntry<T>);
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Retail cache write failed'));
      transaction.onabort = () => reject(transaction.error || new Error('Retail cache write aborted'));
    });
  } finally {
    db.close();
  }
}

export async function clearRetailCache(): Promise<void> {
  const db = await openRetailDb();
  try {
    const transaction = db.transaction(STORE, 'readwrite');
    transaction.objectStore(STORE).clear();
    await new Promise<void>((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Retail cache clear failed'));
    });
  } finally {
    db.close();
  }
}
