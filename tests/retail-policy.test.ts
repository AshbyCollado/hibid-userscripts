import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isAmazonChallengeHtml,
  joinInflight,
  retailCacheTtl,
  retailCandidateList,
  retailIdentityCacheKey,
  retailProviderCacheKey,
  reusableRetailSnapshot,
} from '../src/intelligence/retail-policy.js';
import { extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';

test('retail cache keys are provider, country, epoch, and identity aware', () => {
  const identity = extractProductIdentity('Onkyo TX-SR304 Multi-Channel AV Receiver');
  assert.match(retailIdentityCacheKey(identity, 4), /^amazon-us:4:/);
  assert.notEqual(retailIdentityCacheKey(identity, 4), retailIdentityCacheKey(identity, 5));
  assert.equal(retailProviderCacheKey('  Sony   PS5 Console '), 'amazon-us:provider-v9:sony ps5 console');
  assert.equal(retailProviderCacheKey(identity.query), retailProviderCacheKey(identity.query));
});

test('Amazon challenges are not treated as empty search results', () => {
  assert.equal(isAmazonChallengeHtml('<title>Robot Check</title><p>Enter the characters you see below</p>'), true);
  assert.equal(isAmazonChallengeHtml('<div data-asin="B000000001">Normal result</div>'), false);
  assert.equal(retailCacheTtl('matched'), 12 * 60 * 60 * 1000);
  assert.equal(retailCacheTtl('no_match'), 15 * 60 * 1000);
  assert.equal(retailCacheTtl('rate_limited'), 5 * 60 * 1000);
  assert.equal(retailCacheTtl('parse_error'), 2 * 60 * 1000);
  assert.ok(retailCacheTtl('blocked') < retailCacheTtl('matched'));
});

test('old retail cache entries without a candidate array fail closed', () => {
  assert.deepEqual(retailCandidateList(undefined), []);
  assert.deepEqual(retailCandidateList({ length: 4 }), []);
  assert.deepEqual(retailCandidateList([{ asin: 'B000000001' }]), [{ asin: 'B000000001' }]);
});

test('only conclusive Amazon snapshots are reusable', () => {
  assert.equal(reusableRetailSnapshot('ok'), true);
  assert.equal(reusableRetailSnapshot('no_results'), true);
  for (const status of ['blocked', 'rate_limited', 'parse_error', 'network_error']) {
    assert.equal(reusableRetailSnapshot(status), false);
  }
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
