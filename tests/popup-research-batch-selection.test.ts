import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampResearchBatch,
  researchBatchCount,
  researchBatchScopeKey,
  restoreResearchBatchSelection,
  resolveResearchBatchSelection,
} from '../src/popup/research-batch-selection.js';

const context = (routeFingerprint = 'route-a', selectedPastAuctionGroup = 'group-a') => ({
  routeFingerprint,
  selectedPastAuctionGroup,
});

test('computes zero, small, boundary, and large batch counts', () => {
  assert.equal(researchBatchCount(0), 0);
  assert.equal(researchBatchCount(1), 1);
  assert.equal(researchBatchCount(8), 1);
  assert.equal(researchBatchCount(9), 2);
  assert.equal(researchBatchCount(65), 9);
});

test('clamps a requested one-based batch to the available range', () => {
  assert.equal(clampResearchBatch(-3, 9), 1);
  assert.equal(clampResearchBatch(2.9, 9), 2);
  assert.equal(clampResearchBatch(99, 9), 2);
  assert.equal(clampResearchBatch(3, 0), 0);
});

test('resets selection when route or past-auction group changes', () => {
  const first = resolveResearchBatchSelection(context(), 65, 4);
  assert.equal(first.selectedBatch, 1);

  const sameContext = resolveResearchBatchSelection(context(), 65, 4, first);
  assert.equal(sameContext.selectedBatch, 4);

  const routeChanged = resolveResearchBatchSelection(context('route-b'), 65, 4, sameContext);
  assert.equal(routeChanged.selectedBatch, 1);

  const groupChanged = resolveResearchBatchSelection(context('route-b', 'group-b'), 65, 4, routeChanged);
  assert.equal(groupChanged.selectedBatch, 1);
});

test('namespaces and encodes the immutable scope key', () => {
  assert.equal(
    researchBatchScopeKey('route|a', 'group|b'),
    '["flippah-research-batch","route|a","group|b"]',
  );
  assert.notEqual(researchBatchScopeKey('route|a', 'group|b'), researchBatchScopeKey('route', 'a|group|b'));
});

test('clamps the retained selection when the total drifts smaller', () => {
  const previous = resolveResearchBatchSelection(context(), 65, 9);
  const drifted = resolveResearchBatchSelection(context(), 9, 9, previous);
  assert.equal(drifted.batchCount, 2);
  assert.equal(drifted.selectedBatch, 2);

  const empty = resolveResearchBatchSelection(context(), 0, 2, drifted);
  assert.deepEqual(empty, { key: drifted.key, batchCount: 0, selectedBatch: 0 });
});

test('reopening during hydration does not discard a saved later batch', () => {
  assert.equal(restoreResearchBatchSelection(4, null), 4);
  assert.equal(restoreResearchBatchSelection(4, 40), 4);
  assert.equal(restoreResearchBatchSelection(4, 9), 2);
  assert.equal(restoreResearchBatchSelection('not-a-batch', null), 1);
  assert.equal(restoreResearchBatchSelection(Infinity, null), 1);
});
