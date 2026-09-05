import test from 'node:test';
import assert from 'node:assert/strict';
import {
  UPDATE_CHECK_STALE_MS,
  checkingUpdateState,
  compareChromeVersions,
  idleUpdateState,
  normalizeStoredUpdateState,
  readyUpdateState,
  runtimeResultUpdateState,
} from '../src/core/update-check.js';

test('compares Chrome extension versions numerically', () => {
  assert.equal(compareChromeVersions('0.5.46', '0.5.45'), 1);
  assert.equal(compareChromeVersions('1.0', '1.0.0.0'), 0);
  assert.equal(compareChromeVersions('0.10.0', '0.9.99'), 1);
});

test('maps runtime update results to clear user-facing states', () => {
  const current = runtimeResultUpdateState({ status: 'no_update' }, '0.5.46', 100);
  assert.equal(current.phase, 'current');
  assert.match(current.message, /up to date/i);

  const available = runtimeResultUpdateState({ status: 'update_available', version: '0.5.47' }, '0.5.46', 200);
  assert.equal(available.phase, 'available');
  assert.equal(available.candidateVersion, '0.5.47');
  assert.match(available.message, /downloading/i);

  const throttled = runtimeResultUpdateState({ status: 'throttled' }, '0.5.46', 300);
  assert.equal(throttled.phase, 'throttled');
  assert.match(throttled.message, /checked recently/i);
});

test('persists a downloaded update without treating the current version as pending', () => {
  const ready = readyUpdateState('0.5.47', '0.5.46', 400);
  assert.equal(normalizeStoredUpdateState(ready, '0.5.46').phase, 'ready');
  assert.deepEqual(normalizeStoredUpdateState(ready, '0.5.47'), idleUpdateState('0.5.47'));
});

test('rejects malformed persisted update state', () => {
  assert.deepEqual(normalizeStoredUpdateState({ phase: 'ready', candidateVersion: '9.9.9' }, '0.5.46'), idleUpdateState('0.5.46'));
});

test('recovers from a stale interrupted update check', () => {
  const startedAt = 1_000;
  const checking = checkingUpdateState('0.5.46', startedAt);
  assert.equal(normalizeStoredUpdateState(checking, '0.5.46', startedAt + UPDATE_CHECK_STALE_MS).phase, 'checking');
  assert.deepEqual(
    normalizeStoredUpdateState(checking, '0.5.46', startedAt + UPDATE_CHECK_STALE_MS + 1),
    idleUpdateState('0.5.46'),
  );
});
