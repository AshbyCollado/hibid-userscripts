import assert from 'node:assert/strict';
import test from 'node:test';
import { providerRetryDelay, runProviderQueue } from '../src/intelligence/provider-queue.js';

test('provider queue uses donor-sized batches, skips pacing for cache-only batches, and reports progress', async () => {
  let active = 0;
  let maxActive = 0;
  const delays: number[] = [];
  const progress: number[] = [];
  await runProviderQueue({
    items: ['cached', 'network', 'last'],
    lookup: async (item) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await Promise.resolve();
      active -= 1;
      return { status: 'matched', cached: item === 'cached' };
    },
    onProgress: ({ completed }) => progress.push(completed),
    shouldContinue: () => true,
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    policy: { delayMs: 350, batchSize: 2 },
  });
  assert.equal(maxActive, 2);
  assert.deepEqual(progress, [1, 2, 3]);
  assert.deepEqual(delays, [350]);
});

test('provider queue records a challenged item and continues like the donor sweep', async () => {
  let calls = 0;
  let finalAttempts = 0;
  const delays: number[] = [];
  const result = await runProviderQueue({
    items: ['one', 'two'],
    lookup: async () => {
      calls += 1;
      return { status: 'rate_limited', retryAfterMs: 12_000, cached: false };
    },
    onProgress: ({ attempts }) => { finalAttempts = attempts; },
    shouldContinue: () => true,
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    policy: { batchSize: 1, maxRetries: 3, retryBaseMs: 5_000, retryMaxMs: 60_000 },
  });
  assert.equal(calls, 2);
  assert.equal(finalAttempts, 1);
  assert.equal(result.completed, 2);
  assert.equal(result.total, 2);
  assert.equal(result.stoppedResult, undefined);
  assert.deepEqual(delays, [350]);
});

test('provider queue still retries transient parse failures with bounded backoff', async () => {
  const delays: number[] = [];
  let calls = 0;
  await runProviderQueue({
    items: ['one'],
    lookup: async () => ({ status: ++calls < 3 ? 'parse_error' : 'matched', cached: false }),
    onProgress: () => undefined,
    shouldContinue: () => true,
    sleep: async (milliseconds) => { delays.push(milliseconds); },
    policy: { maxRetries: 3, retryBaseMs: 5_000, retryMaxMs: 60_000 },
  });
  assert.equal(calls, 3);
  assert.deepEqual(delays, [5_000, 10_000]);
});

test('provider retry delay uses exponential backoff when no server delay exists', () => {
  assert.equal(providerRetryDelay({ status: 'network_error' }, 1, { delayMs: 1, maxRetries: 3, retryBaseMs: 5_000, retryMaxMs: 60_000 }), 5_000);
  assert.equal(providerRetryDelay({ status: 'network_error' }, 4, { delayMs: 1, maxRetries: 3, retryBaseMs: 5_000, retryMaxMs: 20_000 }), 20_000);
});
