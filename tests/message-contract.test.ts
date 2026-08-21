import assert from 'node:assert/strict';
import test from 'node:test';
import { envelope, isEnvelope, payloadBytes } from '../src/core/messages.js';

test('versioned message envelopes reject arbitrary non-Flippah operations', () => {
  const good = envelope('flippah:network.search', { body: {} });
  assert.equal(isEnvelope(good), true);
  assert.equal(isEnvelope({ ...good, type: 'fetch:any-url' }), false);
  assert.ok(payloadBytes(good) > 0);
});
