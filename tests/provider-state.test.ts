import assert from 'node:assert/strict';
import test from 'node:test';
import {
  nextProviderFailureState,
  normalizeProviderThrottle,
  providerStateStorageKey,
  providerWaitMs,
  successfulProviderState,
} from '../src/intelligence/provider-state.js';

test('provider cooldown keys and states survive runtime reconstruction', () => {
  assert.equal(providerStateStorageKey('amazon'), 'flippahRetailProviderStateV1:amazon');
  const first = nextProviderFailureState(normalizeProviderThrottle(null), 'http-503', 20_000, 1_000);
  const restored = normalizeProviderThrottle(JSON.parse(JSON.stringify(first)));
  assert.equal(restored.consecutiveFailures, 1);
  assert.equal(providerWaitMs(restored, 5_000), 16_000);
  const second = nextProviderFailureState(restored, 'http-503', 20_000, 21_000);
  assert.equal(second.nextAllowedAt, 41_000);
  assert.deepEqual(successfulProviderState(50_000), { nextAllowedAt: 0, consecutiveFailures: 0, lastStatus: 'ok', updatedAt: 50_000 });
  assert.deepEqual(successfulProviderState(50_000, 1_500), { nextAllowedAt: 51_500, consecutiveFailures: 0, lastStatus: 'ok', updatedAt: 50_000 });
});

test('provider cooldown grows exponentially and caps at two minutes', () => {
  let state = normalizeProviderThrottle(null);
  for (let attempt = 0; attempt < 10; attempt += 1) state = nextProviderFailureState(state, 'challenge', 5_000, 0);
  assert.equal(state.nextAllowedAt, 120_000);
});
