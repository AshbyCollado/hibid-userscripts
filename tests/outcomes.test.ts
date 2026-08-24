import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateDealOutcome, collectStoredOutcomes, normalizeDealOutcome, outcomeStorageKey } from '../src/core/outcomes.js';

test('outcome math separates real profit from prediction accuracy', () => {
  const result = calculateDealOutcome({ actualAllInCost: 70, soldPrice: 150, sellingCosts: 25, predictedResale: 140 });
  assert.deepEqual(result, { profit: 55, predictionError: 10 });
  assert.deepEqual(calculateDealOutcome({ actualAllInCost: null, soldPrice: 20, sellingCosts: null, predictedResale: null }), { profit: null, predictionError: null });
});

test('stored outcomes normalize safely and sort newest first', () => {
  const first = { lotId: '1', lotNumber: '10', title: 'Receiver', url: 'https://hibid.com/lot/1/x', actualAllInCost: 20, soldPrice: 80, sellingCosts: 10, predictedResale: 75, channel: 'ebay', updatedAt: 10 };
  const second = { ...first, lotId: '2', updatedAt: 20, channel: 'local' };
  const outcomes = collectStoredOutcomes({ [outcomeStorageKey('1')]: first, [outcomeStorageKey('2')]: second, unrelated: first });
  assert.deepEqual(outcomes.map((item) => item.lotId), ['2', '1']);
  assert.equal(normalizeDealOutcome({ ...first, channel: 'invalid' })?.channel, '');
  assert.equal(normalizeDealOutcome({ title: 'missing id' }), null);
});
