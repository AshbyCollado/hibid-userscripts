import assert from 'node:assert/strict';
import test from 'node:test';
import { assessCondition, buildConditionPresentation, extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';
import { verifyEbaySoldCompSet, type EbaySoldRecord, type EbaySoldSearchAttempt } from '../src/intelligence/ebay-sold-results.js';

const observedAt = '2026-09-22T12:00:00.000Z';
const productTitle = 'Baby Brezza Formula Pro Advanced';
const identity = extractProductIdentity(productTitle);
const query = identity.query;
const sourceUrl = `https://www.ebay.com/sh/research?keywords=${encodeURIComponent(query)}&tabName=SOLD`;
const itemId = '890322840726';
const partialLotDescription = 'Baby formula dispenser. The item turn on but has not been fully tested. Sold as is. Please see photos for details.';
const workingMismatch = 'condition-mismatch:working-comp-for-untested-lot';
const unconfirmedFunction = 'condition-ambiguous:comp-function-unconfirmed';

function soldRecord(title: string, condition: string | null = 'Used'): EbaySoldRecord {
  return {
    source: 'seller-hub-product-research',
    sourceUrl,
    observedAt,
    itemId,
    itemUrl: `https://www.ebay.com/itm/${itemId}`,
    title,
    imageUrl: null,
    soldPrice: { amount: 100, currency: 'USD' },
    shippingPrice: { amount: 0, currency: 'USD' },
    deliveredPrice: { amount: 100, currency: 'USD' },
    totalSold: 1,
    totalSales: { amount: 100, currency: 'USD' },
    soldAt: 'Sep 22, 2026',
    condition,
    format: 'Fixed price',
    priceKind: 'actual',
    provenance: { kind: 'independent-sold-evidence', source: 'seller-hub-sold-record', itemId },
  };
}

function verify(sourceText: string, title = productTitle, condition: string | null = 'Used', sourceIdentity = identity) {
  const query = sourceIdentity.query;
  const sourceUrl = `https://www.ebay.com/sh/research?keywords=${encodeURIComponent(query)}&tabName=SOLD`;
  const attempt: EbaySoldSearchAttempt = {
    source: 'seller-hub-product-research',
    sourceUrl,
    query,
    observedAt,
    status: 'ok',
    records: [{ ...soldRecord(title, condition), sourceUrl }],
    hasNextPage: false,
    pageOffset: 0,
    pageLimit: 50,
    failureReason: null,
  };
  return verifyEbaySoldCompSet(sourceIdentity, [attempt], {
    plannedQueries: [query],
    sourceCondition: assessCondition(sourceText),
    sourceQuantity: 1,
    minimumSampleSize: 1,
  });
}

test('valid sold provenance alone cannot qualify a Used comp for the exact partial-test lot', () => {
  const result = verify(partialLotDescription);
  assert.deepEqual(result.rejected.map((entry) => entry.reasons), [[unconfirmedFunction]]);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.statistics.sampleSize, 0);
  assert.equal(result.statistics.salePriceMedian, null);
  assert.equal(result.marketValueReady, false);
});

test('HiBid lot 322840726 retains cautious uncertainty and a warning chip', () => {
  const assessment = assessCondition(partialLotDescription);
  assert.equal(assessment.positive, false);
  assert.equal(assessment.partsOnly, false);
  assert.equal(assessment.damaged, false);
  assert.ok(assessment.cautions.includes('not fully tested'));
  assert.equal(buildConditionPresentation(assessment).tone, 'warning');
});

for (const phrase of ['Working', 'Works', 'Fully Tested', 'New Sealed', 'New', 'Brand New', 'New in Box', 'Fully Functional', 'Tested and Working']) {
  for (const location of ['title', 'condition'] as const) {
    test(`partial-test lot excludes ${phrase} evidence in sold ${location} from valuation`, () => {
      const result = verify(partialLotDescription,
        location === 'title' ? `${productTitle} ${phrase}` : productTitle,
        location === 'condition' ? phrase : 'Used');
      assert.deepEqual(result.rejected.map((entry) => entry.reasons), [[workingMismatch]]);
      assert.equal(result.accepted.length, 0);
      assert.equal(result.statistics.sampleSize, 0);
      assert.equal(result.statistics.salePriceMedian, null);
      assert.equal(result.marketValueReady, false);
    });
  }
}

for (const newEvidence of ['New', 'Brand New', 'New Sealed', 'Factory Sealed']) {
  for (const location of ['title', 'condition', 'condition-with-untested'] as const) {
    test(`sold ${newEvidence} in ${location} cannot become comparable through Untested wording`, () => {
      const result = verify(partialLotDescription,
        `${productTitle} ${location === 'title' ? `${newEvidence} ` : ''}Untested`,
        location === 'title' ? 'Used' : `${newEvidence}${location === 'condition-with-untested' ? ' Untested' : ''}`);
      assert.deepEqual(result.rejected.map((entry) => entry.reasons), [[workingMismatch]]);
      assert.equal(result.accepted.length, 0);
      assert.equal(result.statistics.sampleSize, 0);
      assert.equal(result.statistics.salePriceMedian, null);
      assert.equal(result.marketValueReady, false);
    });
  }
}

for (const location of ['title', 'condition'] as const) {
  test(`negated new with Used and Untested in ${location} remains comparable`, () => {
    const result = verify(partialLotDescription,
      location === 'title' ? `${productTitle} Not new; Used; Untested` : productTitle,
      location === 'condition' ? 'Not new; Used; Untested' : 'Used');
    assert.deepEqual(result.rejected, []);
    assert.equal(result.accepted.length, 1);
    assert.equal(result.statistics.salePriceMedian, 100);
    assert.equal(result.marketValueReady, true);
  });
}

for (const name of ['New Balance 990v6 Shoes', 'Nintendo New 3DS XL Handheld Console']) {
  for (const untested of [true, false]) {
    test(`${name} preserves product-name New with ${untested ? 'explicit' : 'absent'} testing evidence`, () => {
      const result = verify(partialLotDescription, `${name}${untested ? ' Untested' : ''}`, 'Used', extractProductIdentity(name));
      assert.deepEqual(result.rejected.map((entry) => entry.reasons), untested ? [] : [[unconfirmedFunction]]);
      assert.equal(result.accepted.length, untested ? 1 : 0);
      assert.equal(result.statistics.salePriceMedian, untested ? 100 : null);
      assert.equal(result.marketValueReady, untested);
    });
  }
}

const limitedTestingPhrases = [
  ...['', 'been '].flatMap((been) => ['', 'fully ', 'completely ', 'thoroughly '].map((qualifier) => `has not ${been}${qualifier}tested`)),
  'partially tested', 'power on only', 'powers on only', 'not tested beyond power on',
  'tested for power only', 'only tested for power', 'only tested for power on', 'tested for power on only',
  'limited functional testing', 'untested', 'unable to test',
];

for (const phrase of limitedTestingPhrases) {
  test(`${phrase} overrides Good and Functional Yes with caution and a warning chip`, () => {
    const sourceText = `Condition: Good\nFunctional: Yes\nNotes: ${phrase}`;
    const assessment = assessCondition(sourceText);
    assert.equal(assessment.positive, false);
    assert.equal(assessment.partsOnly, false);
    assert.equal(assessment.damaged, false);
    assert.ok(assessment.cautions.length > 0);
    const presentation = buildConditionPresentation(assessment);
    assert.equal(presentation.tone, 'warning');
    assert.notEqual(presentation.label, 'Good');
    const workingComp = verify(sourceText, `${productTitle} Tested and Working`);
    assert.deepEqual(workingComp.rejected.map((entry) => entry.reasons), [[workingMismatch]]);
    assert.equal(workingComp.accepted.length, 0);
    assert.equal(workingComp.statistics.salePriceMedian, null);
    assert.equal(workingComp.marketValueReady, false);
    const usedComp = verify(sourceText);
    assert.deepEqual(usedComp.rejected.map((entry) => entry.reasons), [[unconfirmedFunction]]);
    assert.equal(usedComp.marketValueReady, false);
  });
}

test('tested for power only suppresses Good without a functional field and rejects a working comp', () => {
  const sourceText = 'Condition: Good\nNotes: tested for power only';
  const assessment = assessCondition(sourceText);
  assert.equal(assessment.positive, false);
  assert.ok(assessment.cautions.length > 0);
  assert.deepEqual(verify(sourceText, `${productTitle} Tested and Working`).rejected.map((entry) => entry.reasons), [[workingMismatch]]);
});

for (const phrase of ['not untested', 'not partially tested', 'never partially tested', 'not limited functional testing', 'not only tested for power']) {
  test(`${phrase} does not taint independent fully tested and working evidence`, () => {
    const sourceText = `Condition: Good\nNotes: ${phrase}; fully tested and working.`;
    const assessment = assessCondition(sourceText);
    assert.equal(assessment.positive, true);
    assert.deepEqual(assessment.cautions, []);
    const presentation = buildConditionPresentation(assessment);
    assert.equal(presentation.label, 'Good');
    assert.equal(presentation.tone, 'good');
    assert.deepEqual(verify(sourceText, `${productTitle} Fully Tested and Working`).rejected, []);
  });
}

test('negated uncertainty cannot cancel a later independent untested statement', () => {
  const sourceText = 'Condition: Good\nNotes: Not untested; not partially tested.\nUntested';
  const assessment = assessCondition(sourceText);
  assert.equal(assessment.positive, false);
  assert.deepEqual(assessment.cautions, ['untested']);
  assert.equal(buildConditionPresentation(assessment).tone, 'warning');
  assert.deepEqual(verify(sourceText, `${productTitle} Working`).rejected.map((entry) => entry.reasons), [[workingMismatch]]);
});

for (const phrase of ['Used', 'Not new; used', 'Not partially tested; used', 'Working condition unknown', 'Working condition: Unknown', 'Functional: Unknown']) {
  for (const location of ['title', 'condition'] as const) {
    test(`sold ${phrase} in ${location} lacks comparable limitation evidence`, () => {
      const result = verify(partialLotDescription,
        location === 'title' ? `${productTitle} ${phrase}` : productTitle,
        location === 'condition' ? phrase : 'Used');
      assert.deepEqual(result.rejected.map((entry) => entry.reasons), [[unconfirmedFunction]]);
      assert.equal(result.accepted.length, 0);
      assert.equal(result.statistics.sampleSize, 0);
      assert.equal(result.statistics.salePriceMedian, null);
      assert.equal(result.marketValueReady, false);
    });
  }
}

for (const condition of [null, '', 'Unknown']) {
  test(`sold condition ${JSON.stringify(condition)} cannot qualify for a limited-test lot`, () => {
    const result = verify(partialLotDescription, productTitle, condition);
    assert.deepEqual(result.rejected.map((entry) => entry.reasons), [[unconfirmedFunction]]);
    assert.equal(result.accepted.length, 0);
    assert.equal(result.statistics.sampleSize, 0);
    assert.equal(result.statistics.salePriceMedian, null);
    assert.equal(result.marketValueReady, false);
  });
}

for (const phrase of ['Untested', 'Partially tested', 'Not fully tested', 'Not completely tested', 'Not thoroughly tested', 'Only tested for power', 'Working; tested for power only']) {
  for (const location of ['title', 'condition'] as const) {
    test(`sold ${phrase} in ${location} supplies comparable limitation evidence`, () => {
      const result = verify(partialLotDescription,
        location === 'title' ? `${productTitle} ${phrase}` : productTitle,
        location === 'condition' ? phrase : 'Used');
      assert.deepEqual(result.rejected, []);
      assert.equal(result.accepted.length, 1);
      assert.equal(result.statistics.sampleSize, 1);
      assert.equal(result.statistics.salePriceMedian, 100);
      assert.equal(result.marketValueReady, true);
    });
  }
}

test('unknown working condition cannot cancel a later explicit working claim', () => {
  const result = verify(partialLotDescription, `${productTitle} Working condition unknown; Fully tested and working`);
  assert.deepEqual(result.rejected.map((entry) => entry.reasons), [[workingMismatch]]);
  assert.equal(result.marketValueReady, false);
});

test('fully tested working source and negated untested comp remain compatible', () => {
  const result = verify('Condition: Good\nNotes: Fully tested and working.', `${productTitle} Not Untested; Fully Tested and Working`);
  assert.deepEqual(result.rejected, []);
  assert.equal(result.accepted.length, 1);
});

test('a working source still rejects a comp with independent later untested evidence', () => {
  const result = verify('Condition: Good\nNotes: Fully tested and working.', `${productTitle} Not Untested; Untested`);
  assert.deepEqual(result.rejected.map((entry) => entry.reasons), [['condition-mismatch:untested-comp-for-working-lot']]);
});

test('unknown alone stays non-parts and permits a working comp without an explicit limitation', () => {
  const sourceText = 'Functional: Unknown';
  const assessment = assessCondition(sourceText);
  assert.equal(assessment.positive, false);
  assert.equal(assessment.partsOnly, false);
  assert.deepEqual(verify(sourceText, `${productTitle} Working`).rejected, []);
});

for (const sourceText of ['Condition: Used', 'Functional: Unknown']) {
  test(`${sourceText} still permits ordinary used comps without explicit source limitations`, () => {
    const assessment = assessCondition(sourceText);
    assert.equal(assessment.partsOnly, false);
    assert.equal(assessment.damaged, false);
    const result = verify(sourceText);
    assert.deepEqual(result.rejected, []);
    assert.equal(result.accepted.length, 1);
    assert.equal(result.statistics.sampleSize, 1);
    assert.equal(result.marketValueReady, true);
  });
}
