import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isAmazonChallengeHtml,
  joinInflight,
  partitionRetailBatches,
  RETAIL_BATCH_DELAY_MS,
  RETAIL_BATCH_SIZE,
  retailCacheTtl,
  retailIdentityCacheKey,
} from '../src/intelligence/retail-policy.js';
import { extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';

test('retail policy batches cold work six at a time without dropping entries', () => {
  const values = Array.from({ length: 14 }, (_unused, index) => index + 1);
  assert.deepEqual(partitionRetailBatches(values), [[1,2,3,4,5,6], [7,8,9,10,11,12], [13,14]]);
  assert.equal(RETAIL_BATCH_SIZE, 6);
  assert.equal(RETAIL_BATCH_DELAY_MS, 350);
});

test('retail cache keys are provider, country, epoch, and identity aware', () => {
  const identity = extractProductIdentity('Onkyo TX-SR304 Multi-Channel AV Receiver');
  assert.match(retailIdentityCacheKey(identity, 4), /^amazon-us:4:/);
  assert.notEqual(retailIdentityCacheKey(identity, 4), retailIdentityCacheKey(identity, 5));
});

test('Amazon challenges are not treated as empty search results', () => {
  assert.equal(isAmazonChallengeHtml('<title>Robot Check</title><p>Enter the characters you see below</p>'), true);
  assert.equal(isAmazonChallengeHtml('<div data-asin="B000000001">Normal result</div>'), false);
  assert.equal(retailCacheTtl('matched'), 12 * 60 * 60 * 1000);
  assert.equal(retailCacheTtl('no_match'), 15 * 60 * 1000);
  assert.equal(retailCacheTtl('rate_limited'), 5 * 60 * 1000);
  assert.ok(retailCacheTtl('blocked') < retailCacheTtl('matched'));
});

test('duplicate retail requests join one in-flight operation and release it afterward', async () => {
  const inflight = new Map<string, Promise<number>>();
  let calls = 0;
  let release!: (value: number) => void;
  const work = () => {
    calls += 1;
    return new Promise<number>((resolve) => { release = resolve; });
  };
  const first = joinInflight(inflight, 'same-product', work);
  const second = joinInflight(inflight, 'same-product', work);
  assert.equal(first, second);
  assert.equal(calls, 0);
  await Promise.resolve();
  assert.equal(calls, 1);
  release(42);
  assert.deepEqual(await Promise.all([first, second]), [42, 42]);
  await Promise.resolve();
  assert.equal(inflight.size, 0);
});
