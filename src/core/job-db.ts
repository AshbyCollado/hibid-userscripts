import type { ScrapeJobSummary, ScrapeStoredRecord } from './types.js';
import { chooseNewestJob } from './job-scope.js';

const DB_NAME = 'flippah-scraper';
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('jobs')) db.createObjectStore('jobs', { keyPath: 'jobId' });
      if (!db.objectStoreNames.contains('records')) {
        const records = db.createObjectStore('records', { keyPath: ['jobId', 'id'] });
        records.createIndex('jobId', 'jobId', { unique: false });
      }
      if (!db.objectStoreNames.contains('diagnostics')) db.createObjectStore('diagnostics', { keyPath: 'jobId' });
    };
    request.onerror = () => reject(request.error || new Error('Unable to open Flippah database'));
    request.onsuccess = () => resolve(request.result);
  });
}

function complete(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Flippah database transaction failed'));
    transaction.onabort = () => reject(transaction.error || new Error('Flippah database transaction aborted'));
  });
}

export async function putJob(job: ScrapeJobSummary): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('jobs', 'readwrite');
  tx.objectStore('jobs').put(job);
  await complete(tx);
  db.close();
}

export async function putJobIfNewer(job: ScrapeJobSummary): Promise<ScrapeJobSummary> {
  const db = await openDb();
  const tx = db.transaction('jobs', 'readwrite');
  const store = tx.objectStore('jobs');
  const existing = await new Promise<ScrapeJobSummary | null>((resolve, reject) => {
    const request = store.get(job.jobId);
    request.onsuccess = () => resolve((request.result as ScrapeJobSummary) || null);
    request.onerror = () => reject(request.error);
  });
  const stored = chooseNewestJob(existing, job);
  if (stored === job) store.put(job);
  await complete(tx);
  db.close();
  return stored;
}

export async function pruneJobs(keep = 20): Promise<void> {
  const db = await openDb();
  const jobs = await new Promise<ScrapeJobSummary[]>((resolve, reject) => {
    const request = db.transaction('jobs').objectStore('jobs').getAll();
    request.onsuccess = () => resolve(request.result as ScrapeJobSummary[]);
    request.onerror = () => reject(request.error);
  });
  const stale = jobs.sort((a, b) => b.updatedAt - a.updatedAt).slice(Math.max(1, keep));
  if (!stale.length) { db.close(); return; }
  const tx = db.transaction(['jobs', 'records', 'diagnostics'], 'readwrite');
  const records = tx.objectStore('records');
  for (const job of stale) {
    tx.objectStore('jobs').delete(job.jobId);
    tx.objectStore('diagnostics').delete(job.jobId);
    const cursor = records.index('jobId').openKeyCursor(IDBKeyRange.only(job.jobId));
    cursor.onsuccess = () => {
      const item = cursor.result;
      if (!item) return;
      records.delete(item.primaryKey);
      item.continue();
    };
  }
  await complete(tx);
  db.close();
}

export async function getJob(jobId: string): Promise<ScrapeJobSummary | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction('jobs').objectStore('jobs').get(jobId);
    request.onsuccess = () => { db.close(); resolve((request.result as ScrapeJobSummary) || null); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

export async function getJobForFingerprint(tabId: number | null, fingerprint: string, scopeId?: string | null): Promise<ScrapeJobSummary | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction('jobs').objectStore('jobs').getAll();
    request.onsuccess = () => {
      db.close();
      const jobs = (request.result as ScrapeJobSummary[])
        .filter((job) => job.tabId === tabId && job.fingerprint === fingerprint && (scopeId === undefined || job.scopeId === scopeId))
        .sort((a, b) => b.updatedAt - a.updatedAt);
      resolve(jobs[0] || null);
    };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

export async function replaceRecords(jobId: string, records: ScrapeStoredRecord[]): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('records', 'readwrite');
  const store = tx.objectStore('records');
  const index = store.index('jobId');
  const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
    const request = index.getAllKeys(IDBKeyRange.only(jobId));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  keys.forEach((key) => store.delete(key));
  records.forEach((record) => store.put({ ...record, jobId }));
  await complete(tx);
  db.close();
}

export async function putRecordBatch(jobId: string, records: ScrapeStoredRecord[], replace = false): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('records', 'readwrite');
  const store = tx.objectStore('records');
  if (replace) {
    const index = store.index('jobId');
    const request = index.openKeyCursor(IDBKeyRange.only(jobId));
    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) { resolve(); return; }
        store.delete(cursor.primaryKey);
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  }
  records.forEach((record) => store.put({ ...record, jobId }));
  await complete(tx);
  db.close();
}

export async function getRecords(jobId: string): Promise<ScrapeStoredRecord[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction('records').objectStore('records').index('jobId').getAll(IDBKeyRange.only(jobId));
    request.onsuccess = () => {
      db.close();
      resolve((request.result as Array<ScrapeStoredRecord & { jobId?: string }>).map(({ jobId: _jobId, ...record }) => record as ScrapeStoredRecord));
    };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

export async function putDiagnostic(jobId: string, diagnostic: unknown): Promise<void> {
  const db = await openDb();
  const tx = db.transaction('diagnostics', 'readwrite');
  tx.objectStore('diagnostics').put({ jobId, diagnostic, updatedAt: Date.now() });
  await complete(tx);
  db.close();
}

export async function getDiagnostic(jobId: string): Promise<unknown> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const request = db.transaction('diagnostics').objectStore('diagnostics').get(jobId);
    request.onsuccess = () => { db.close(); resolve(request.result?.diagnostic ?? null); };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}
