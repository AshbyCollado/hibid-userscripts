import assert from 'node:assert/strict';
import test from 'node:test';
import { researchSessionStorageKey, resolveResearchSessionStartedAt } from '../src/intelligence/research-session-storage.js';

const local = new Map<string, unknown>();

function installChrome(): void {
  (globalThis as typeof globalThis & { chrome?: unknown }).chrome = {
    runtime: { lastError: null },
    storage: {
      local: {
        get(keys: string[] | null, callback: (value: Record<string, unknown>) => void) {
          const result: Record<string, unknown> = {};
          for (const key of keys ?? [...local.keys()]) if (local.has(key)) result[key] = local.get(key);
          callback(result);
        },
        set(items: Record<string, unknown>, callback: () => void) {
          for (const [key, value] of Object.entries(items)) local.set(key, value);
          callback();
        },
        remove(keys: string[], callback: () => void) {
          for (const key of keys) local.delete(key);
          callback();
        },
      },
    },
  };
  let queue = Promise.resolve();
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { locks: { request<T>(_name: string, callback: () => Promise<T>): Promise<T> {
      const result = queue.then(callback, callback);
      queue = result.then(() => undefined, () => undefined);
      return result;
    } } },
  });
}

function input(provider: string, identities: { auctionId: string; sourceId: string; query: string; condition: string }[]) {
  return {
    provider,
    pageKind: 'catalog',
    routeFingerprint: 'route:catalog?filter=all',
    scope: 'auction-scope',
    identities,
    now: Date.parse('2026-09-23T12:00:00.000Z'),
  };
}

test.beforeEach(() => {
  local.clear();
  installChrome();
});

test('HiBid reuses a session start across jobs with the same identity set', async () => {
  const first = await resolveResearchSessionStartedAt(input('HiBid', [
    { auctionId: 'a1', sourceId: 'lot-1', query: 'Canon R5', condition: 'used' },
  ]));
  const second = await resolveResearchSessionStartedAt({
    ...input('HiBid', [{ auctionId: 'a1', sourceId: 'lot-1', query: 'Canon R5', condition: 'used' }]),
    now: Date.parse('2026-09-23T12:05:00.000Z'),
  });
  assert.equal(second, first);
});

test('HiBid changed IDs or query/condition get a new signature', async () => {
  const base = input('HiBid', [{ auctionId: 'a1', sourceId: 'lot-1', query: 'Canon R5', condition: 'used' }]);
  const first = await resolveResearchSessionStartedAt(base);
  const changed = await resolveResearchSessionStartedAt({
    ...base,
    now: base.now! + 1_000,
    identities: [{ auctionId: 'a1', sourceId: 'lot-2', query: 'Canon R5', condition: 'used' }],
  });
  const changedCondition = await resolveResearchSessionStartedAt({
    ...base,
    now: base.now! + 2_000,
    identities: [{ auctionId: 'a1', sourceId: 'lot-1', query: 'Canon R5', condition: 'open box' }],
  });
  assert.notEqual(changed, first);
  assert.notEqual(changedCondition, first);
});

test('AuctionNinja reuses across jobs but separates auctions', async () => {
  const first = await resolveResearchSessionStartedAt(input('AuctionNinja', [
    { auctionId: 'sale-1', sourceId: 'product-1', query: 'DeWalt drill', condition: 'new' },
    { auctionId: 'sale-2', sourceId: 'product-2', query: 'Makita saw', condition: 'used' },
  ]));
  const second = await resolveResearchSessionStartedAt({
    ...input('AuctionNinja', [
      { auctionId: 'sale-2', sourceId: 'product-2', query: 'Makita saw', condition: 'used' },
      { auctionId: 'sale-1', sourceId: 'product-1', query: 'DeWalt drill', condition: 'new' },
    ]),
    now: Date.parse('2026-09-23T12:05:00.000Z'),
  });
  const changed = await resolveResearchSessionStartedAt({
    ...input('AuctionNinja', [
      { auctionId: 'sale-1', sourceId: 'product-1', query: 'DeWalt drill', condition: 'new' },
      { auctionId: 'sale-3', sourceId: 'product-3', query: 'Makita saw', condition: 'used' },
    ]),
    now: Date.parse('2026-09-23T12:06:00.000Z'),
  });
  assert.equal(second, first);
  assert.notEqual(changed, first);
});

test('corrupt or future records fail closed without replacing a valid record', async () => {
  const args = input('HiBid', [{ auctionId: 'a1', sourceId: 'lot-1', query: 'Canon R5', condition: 'used' }]);
  const first = await resolveResearchSessionStartedAt(args);
  const key = [...local.keys()][0]!;
  local.set(key, { version: 1, signature: 'wrong', sessionStartedAt: '2099-01-01T00:00:00.000Z', savedAt: '2099-01-01T00:00:00.000Z' });
  const second = await resolveResearchSessionStartedAt({ ...args, now: args.now! + 1000 });
  assert.notEqual(second, first);
  const third = await resolveResearchSessionStartedAt({ ...args, now: args.now! + 2000 });
  assert.equal(third, second);
});

test('real-shaped HiBid records use the structured Condition field in the session identity', async () => {
  const record = {
    auctionId: 'a1',
    id: 'lot-1',
    descriptionFields: { Condition: 'Open Box - Not Tested' },
  };
  const first = await resolveResearchSessionStartedAt(input('HiBid', [{
    auctionId: record.auctionId,
    sourceId: record.id,
    query: 'Canon R5',
    condition: record.descriptionFields.Condition,
  }]));
  const changed = await resolveResearchSessionStartedAt({ ...input('HiBid', [{
    auctionId: record.auctionId,
    sourceId: record.id,
    query: 'Canon R5',
    condition: '',
  }]), now: Date.parse('2026-09-23T12:00:01.000Z') });
  assert.notEqual(changed, first);
});

test('serializes concurrent first exports across popup contexts', async () => {
  const args = input('HiBid', [{ auctionId: 'a1', sourceId: 'lot-1', query: 'Canon R5', condition: 'used' }]);
  const [first, second] = await Promise.all([
    resolveResearchSessionStartedAt({ ...args, now: args.now! }),
    resolveResearchSessionStartedAt({ ...args, now: args.now! + 1_000 }),
  ]);
  assert.equal(second, first);
});

test('slightly earlier popup clock reuses a concurrently saved session', async () => {
  const args = input('HiBid', [{ auctionId: 'a1', sourceId: 'lot-1', query: 'Canon R5', condition: 'used' }]);
  const later = await resolveResearchSessionStartedAt({ ...args, now: args.now! + 1_000 });
  const earlier = await resolveResearchSessionStartedAt(args);
  assert.equal(earlier, later);
});

test('digest keys and retention stay bounded for large identity sets', async () => {
  const identities = Array.from({ length: 10_000 }, (_, index) => ({ auctionId: 'a1', sourceId: `lot-${index}`, query: 'Canon R5', condition: 'used' }));
  const key = await researchSessionStorageKey(input('HiBid', identities));
  assert.equal(key.length, 'flippah:research-session:v1:'.length + 64);
  await resolveResearchSessionStartedAt(input('HiBid', identities));
  const record = local.get(key) as Record<string, unknown>;
  assert.equal(record.digest.length, 64);
  assert.equal('signature' in record, false);
});

test('prunes older session records at the retention cap', async () => {
  for (let index = 0; index < 105; index += 1) {
    await resolveResearchSessionStartedAt(input('HiBid', [{ auctionId: 'a1', sourceId: `lot-${index}`, query: 'Canon R5', condition: 'used' }]));
  }
  assert.ok(local.size <= 100, `stored records: ${local.size}`);
});

test('quota failures fail visibly rather than returning an unpersisted session', async () => {
  const chrome = (globalThis as typeof globalThis & { chrome: any }).chrome;
  chrome.storage.local.set = (_items: Record<string, unknown>, callback: () => void) => {
    chrome.runtime.lastError = { message: 'QUOTA_BYTES quota exceeded' };
    callback();
    chrome.runtime.lastError = null;
  };
  await assert.rejects(
    () => resolveResearchSessionStartedAt(input('HiBid', [{ auctionId: 'a1', sourceId: 'lot-1', query: 'Canon R5', condition: 'used' }])),
    /could not be saved/,
  );
  assert.equal(local.size, 0);
});

test('fails conservatively when Web Locks is unavailable', async () => {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
  await assert.rejects(() => resolveResearchSessionStartedAt(input('HiBid', [{ auctionId: 'a1', sourceId: 'lot-1', query: 'Canon R5', condition: 'used' }])), /unavailable/);
});
