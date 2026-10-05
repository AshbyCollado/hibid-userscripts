import assert from 'node:assert/strict';
import test from 'node:test';
import { assessCondition, extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';
import { verifyEbaySoldCompSet, type EbaySoldRecord, type EbaySoldSearchAttempt } from '../src/intelligence/ebay-sold-results.js';

const observedAt = '2026-09-22T12:00:00.000Z';
const productTitle = 'Baby Brezza Formula Pro Advanced';
const identity = extractProductIdentity(productTitle);

function verify(sourceText: string, candidateTitle = productTitle, candidateCondition = 'Used') {
  const query = identity.query;
  const itemId = '100000000001';
  const record: EbaySoldRecord = {
    source: 'seller-hub-product-research',
    sourceUrl: `https://www.ebay.com/sh/research?keywords=${encodeURIComponent(query)}&tabName=SOLD`,
    observedAt,
    itemId,
    itemUrl: `https://www.ebay.com/itm/${itemId}`,
    title: candidateTitle,
    imageUrl: null,
    soldPrice: { amount: 100, currency: 'USD' },
    shippingPrice: { amount: 0, currency: 'USD' },
    deliveredPrice: { amount: 100, currency: 'USD' },
    totalSold: 1,
    totalSales: { amount: 100, currency: 'USD' },
    soldAt: 'Sep 22, 2026',
    condition: candidateCondition,
    format: 'Fixed price',
    priceKind: 'actual',
    provenance: { kind: 'independent-sold-evidence', source: 'seller-hub-sold-record', itemId },
  };
  const attempt: EbaySoldSearchAttempt = {
    source: 'seller-hub-product-research',
    sourceUrl: record.sourceUrl,
    query,
    observedAt,
    status: 'ok',
    records: [record],
    hasNextPage: false,
    pageOffset: 0,
    pageLimit: 50,
    failureReason: null,
  };
  return verifyEbaySoldCompSet(identity, [attempt], {
    plannedQueries: [query],
    minimumSampleSize: 1,
    sourceCondition: assessCondition(sourceText),
    sourceQuantity: 1,
  });
}

test('contradictory working and untested evidence in a candidate is rejected', () => {
  const result = verify('Condition: Used', `${productTitle} Fully Tested and Working Untested`);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.marketValueReady, false);
  assert.ok(result.rejected[0]?.reasons.some((reason) => reason.startsWith('condition-')));
});

for (const [working, limited] of [
  ['Tested and Working', 'Untested'],
  ['Fully Functional', 'Not fully tested'],
  ['Fully Working', 'Untested'],
  ['Works Perfectly', 'Untested'],
  ['Fully Tested and Working', 'Limited functional testing'],
] as const) {
  test(`${working} does not override candidate ${limited}`, () => {
    const result = verify('Condition: Used', `${productTitle} ${working}`, limited);
    assert.equal(result.accepted.length, 0);
    assert.equal(result.marketValueReady, false);
    assert.ok(result.rejected[0]?.reasons.some((reason) => reason.startsWith('condition-')));
  });
}

test('negated testing wording does not create a contradiction with genuine working evidence', () => {
  const result = verify('Condition: Good\nNotes: Fully tested and working.', `${productTitle} Not untested; Fully Tested and Working`);
  assert.deepEqual(result.rejected, []);
  assert.equal(result.accepted.length, 1);
  assert.equal(result.marketValueReady, true);
});

test('review reproduction cannot value a partially tested source from contradictory evidence', () => {
  const result = verify('Condition: Used\nNotes: Not fully tested.', `${productTitle} Fully Tested and Working Untested`);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.statistics.salePriceMedian, null);
  assert.equal(result.marketValueReady, false);
});

test('power-only comparison remains usable for an equally limited source', () => {
  const result = verify('Condition: Used\nNotes: Powers on; otherwise untested.', `${productTitle} Powers On Otherwise Untested`);
  assert.equal(result.accepted.length, 1);
});

test('ordinary Used source accepts a fully tested working sold comp', () => {
  const result = verify('Condition: Used', `${productTitle} Fully Tested and Working`);
  assert.deepEqual(result.rejected, []);
  assert.equal(result.statistics.salePriceMedian, 100);
  assert.equal(result.marketValueReady, true);
});

test('New source still rejects an Untested sold comp', () => {
  const result = verify('Condition: New', `${productTitle} Untested`);
  assert.equal(result.accepted.length, 0);
  assert.ok(result.rejected[0]?.reasons.some((reason) => reason.startsWith('condition-')));
  assert.equal(result.marketValueReady, false);
});

test('a structured Functional Yes cannot admit a working comp after failure notes', () => {
  const result = verify(
    'Condition: Open Box - Tested\nFunctional?: Yes\nNotes: Will not fully function; turns off and on.',
    `${productTitle} Fully Tested and Working`,
  );
  assert.equal(result.accepted.length, 0);
  assert.ok(result.rejected[0]?.reasons.includes('condition-mismatch:working-comp-for-parts-lot'));
  assert.equal(result.marketValueReady, false);
});

test('possible repair risk cannot be valued from a working sold comp', () => {
  const result = verify(
    'Condition: Open Box - Tested\nFunctional?: Yes\nNotes: May need repairs motor. Sounds like it is going out.',
    `${productTitle} Fully Tested and Working`,
  );
  assert.equal(result.accepted.length, 0);
  assert.ok(result.rejected[0]?.reasons.includes('condition-review:source-possible-repair'));
  assert.equal(result.marketValueReady, false);
});
