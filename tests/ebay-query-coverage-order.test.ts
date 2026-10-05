import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyEbaySoldCompSet, type EbaySoldSearchAttempt } from '../src/intelligence/ebay-sold-results.js';
import { extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';

const plannedQueries = ['bmax i9plus 10.1 ips tablet', 'BMAX i9 Plus', 'BMAX i9Plus'];

function emptyAttempt(query: string, overrides: Partial<EbaySoldSearchAttempt> = {}): EbaySoldSearchAttempt {
  return {
    source: 'seller-hub-product-research',
    sourceUrl: `https://www.ebay.com/sh/research?keywords=${encodeURIComponent(query)}&tabName=SOLD`,
    query,
    observedAt: '2026-10-01T12:00:00.000Z',
    status: 'no-results',
    records: [],
    hasNextPage: false,
    pageOffset: 0,
    pageLimit: 50,
    failureReason: null,
    ...overrides,
  };
}

function verify(attempts: EbaySoldSearchAttempt[]) {
  return verifyEbaySoldCompSet(extractProductIdentity('BMAX i9Plus 10.1 IPS Tablet'), attempts, { plannedQueries });
}

test('fully exhausted planned queries remain complete when receipts arrive out of order', () => {
  const result = verify([emptyAttempt(plannedQueries[0]!), emptyAttempt(plannedQueries[2]!), emptyAttempt(plannedQueries[1]!)]);
  assert.equal(result.allPlannedQueriesAttempted, true);
  assert.equal(result.completePages, true);
  assert.equal(result.status, 'insufficient');
  assert.equal(result.marketValueReady, false);
  assert.ok(!result.insufficiencyReasons.includes('attempted-queries-not-planned-prefix'));
});

test('partial runs cannot skip an earlier planned query', () => {
  const result = verify([emptyAttempt(plannedQueries[0]!), emptyAttempt(plannedQueries[2]!)]);
  assert.equal(result.status, 'incomplete');
  assert.ok(result.insufficiencyReasons.includes('attempted-queries-not-planned-prefix'));
});

test('extra unrelated searches do not count as complete planned coverage', () => {
  const result = verify([...plannedQueries.map((query) => emptyAttempt(query)), emptyAttempt('scooter i9plus')]);
  assert.equal(result.status, 'incomplete');
  assert.ok(result.insufficiencyReasons.includes('attempted-queries-not-planned-prefix'));
});

test('duplicate query captures cannot substitute for a missing planned query', () => {
  const result = verify([emptyAttempt(plannedQueries[0]!), emptyAttempt(plannedQueries[2]!), emptyAttempt(plannedQueries[2]!.toUpperCase())]);
  assert.equal(result.allPlannedQueriesAttempted, false);
  assert.equal(result.status, 'incomplete');
});

test('complete query coverage does not override missing pages or challenges', () => {
  const paged = verify([emptyAttempt(plannedQueries[2]!, { hasNextPage: true }), emptyAttempt(plannedQueries[1]!), emptyAttempt(plannedQueries[0]!)]);
  assert.equal(paged.status, 'incomplete');
  assert.ok(paged.insufficiencyReasons.includes('result-pagination-incomplete'));
  const challenged = verify([emptyAttempt(plannedQueries[2]!, { status: 'challenge' }), emptyAttempt(plannedQueries[1]!), emptyAttempt(plannedQueries[0]!)]);
  assert.equal(challenged.status, 'blocked');
  assert.equal(challenged.marketValueReady, false);
});
