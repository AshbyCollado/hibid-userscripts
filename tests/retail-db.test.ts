import assert from 'node:assert/strict';
import test from 'node:test';
import 'fake-indexeddb/auto';
import {
  clearRetailCache,
  getRetailCache,
  getRetailCacheMany,
  putRetailCache,
  putRetailCacheMany,
} from '../src/core/retail-db.js';

test('bulk retail cache reads fresh entries in one operation and excludes expired values', async () => {
  await clearRetailCache();
  await putRetailCache('fresh-a', { price: 10 }, 1_000, 1_000);
  await putRetailCache('expired', { price: 20 }, 100, 1_000);
  await putRetailCacheMany([
    { key: 'fresh-b', value: { price: 30 }, ttlMs: 1_000 },
    { key: 'fresh-c', value: { price: 40 }, ttlMs: 1_000 },
  ], 1_000);

  const restored = await getRetailCacheMany<{ price: number }>(
    ['fresh-a', 'fresh-b', 'expired', 'missing', 'fresh-a'],
    1_500,
  );
  assert.deepEqual([...restored.entries()], [
    ['fresh-a', { price: 10 }],
    ['fresh-b', { price: 30 }],
  ]);
  assert.deepEqual(await getRetailCache<{ price: number }>('fresh-c', 1_500), { price: 40 });
  assert.equal(await getRetailCache('expired', 1_500), null);
});

test('empty retail cache batches do not require an IndexedDB transaction', async () => {
  assert.deepEqual(await getRetailCacheMany([]), new Map());
  await putRetailCacheMany([]);
});
