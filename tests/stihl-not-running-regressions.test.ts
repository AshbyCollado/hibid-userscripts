import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessLotCondition,
  buildProductResearchQuery,
  evaluateAmazonCandidateEvidence,
  extractProductIdentity,
} from '../src/intelligence/us-deal-intelligence.js';
import { verifyEbaySoldCompSet, type EbaySoldSearchAttempt } from '../src/intelligence/ebay-sold-results.js';

const clippedTitle = 'Stihl FS55R Straight Shaft String Trimmer - NOT RU';
const fullDescription = 'Stihl FS55R Straight Shaft String Trimmer - NOT RUNNING';

test('source-corroborated clipped non-running suffix stays out of research identity', () => {
  const identity = extractProductIdentity(clippedTitle, fullDescription);

  assert.equal(identity.query, 'stihl fs55r straight shaft string trimmer');
  assert.match(identity.name, /NOT RU$/);
  assert.match(buildProductResearchQuery(clippedTitle), /not ru$/i);
});

test('full non-running and non-starting suffixes are removed only with source corroboration', () => {
  assert.equal(
    extractProductIdentity('Stihl FS55R String Trimmer - NOT RUNNING', fullDescription).query,
    'stihl fs55r string trimmer',
  );
  assert.equal(
    extractProductIdentity('Stihl FS55R String Trimmer - NOT STARTING', 'Stihl FS55R String Trimmer - NOT STARTING').query,
    'stihl fs55r string trimmer',
  );
  assert.match(
    extractProductIdentity('Stihl FS55R String Trimmer - NOT RUNNING', 'Stihl FS55R String Trimmer - Used').query,
    /not running$/i,
  );
});

test('explicit non-running risk remains in condition eligibility', () => {
  const assessment = assessLotCondition({ title: clippedTitle, description: fullDescription });

  assert.equal(assessment.partsOnly, true);
  assert.ok(assessment.partsReasons.some((reason) => /not running/i.test(reason)));
  assert.equal(assessment.positive, false);
});

test('uncertain and component-only running language is not promoted to whole-item failure', () => {
  const uncertain = assessLotCondition('Condition: Used\nNotes: Not sure if running.');
  assert.equal(uncertain.partsOnly, false);

  for (const notes of [
    'Fan not running. The mower still runs.',
    'The mower still runs. Self-propelled feature does not run.',
    'The fan is not working. The machine operates normally.',
  ]) {
    const component = assessLotCondition(`Condition: Used\nNotes: ${notes}`);
    assert.equal(component.partsOnly, false, notes);
    assert.ok(component.cautions.includes('partial component defect'), notes);
  }

  const pump = assessLotCondition('Condition: Used\nNotes: Pump will not start.');
  assert.equal(pump.partsOnly, true);

  const unrelatedUnit = assessLotCondition('Condition: Used\nNotes: Pump will not start. Another unit works.');
  assert.equal(unrelatedUnit.partsOnly, true);
});

test('uncertain operational language does not erase an explicit parts-only assertion', () => {
  const assessment = assessLotCondition('Condition: Used\nNotes: Unsure if running and listed for parts only.');
  assert.equal(assessment.partsOnly, true);
  assert.ok(assessment.partsReasons.includes('listed for parts only'));
});

test('negated and same-clause component assertions remain scoped to the primary lot', () => {
  const negated = assessLotCondition('Condition: It is not true that it is not running.');
  assert.equal(negated.partsOnly, false);

  const structuredComponent = assessLotCondition('Condition: Fan not running; mower runs.');
  assert.equal(structuredComponent.partsOnly, false);
});

test('component evidence does not suppress independent faults or explicit parts assertions', () => {
  for (const notes of [
    'Fan works and engine will not start. The machine powers on.',
    'Fan replaced, engine will not start. The machine powers on.',
  ]) assert.equal(assessLotCondition(`Notes: ${notes}`).partsOnly, true, notes);
  assert.equal(
    assessLotCondition('Notes: Fan not running and engine will not start. The machine powers on.').partsOnly,
    true,
  );
  assert.equal(
    assessLotCondition('Condition: Fan not running; mower runs. Engine will not start.').partsOnly,
    true,
  );
  assert.equal(
    assessLotCondition('Notes: Fan not running; Engine will not start.').partsOnly,
    true,
  );
  assert.equal(
    assessLotCondition('Notes: Fan not running, for parts only. The machine powers on.').partsOnly,
    true,
  );
  assert.equal(
    assessLotCondition('Notes: Fan not running. The mower still runs.').partsOnly,
    false,
  );
});

test('supported fault assertions remain positive while assertion-negation stays local', () => {
  assert.equal(assessLotCondition('Notes: Wrong fuel, not running.').partsOnly, true);
  assert.equal(assessLotCondition('Notes: It is not true that it will not start.').partsOnly, false);
});

test('non-running corroboration stays bound to the titled lot identity', () => {
  const identity = extractProductIdentity(
    clippedTitle,
    'Husqvarna 128LD String Trimmer - NOT RUNNING',
  );
  assert.match(identity.query, /not ru$/i);

  assert.match(
    extractProductIdentity(clippedTitle, 'Stihl FS55R is running\nHusqvarna 128LD not running').query,
    /not ru$/i,
  );
  assert.match(
    extractProductIdentity(clippedTitle, 'Stihl FS55R fan not running.').query,
    /not ru$/i,
  );
  const differentFaultSubject = extractProductIdentity(
    'Stihl FS55R Straight Shaft String Trimmer - NOT RU',
    'Stihl FS55R is running, Husqvarna 128LD is not running.',
  );
  assert.match(differentFaultSubject.query, /not ru$/i);
});

test('downstream eBay sold eligibility keeps working comps out of a non-running lot', () => {
  const identity = extractProductIdentity(clippedTitle, fullDescription);
  const attempt: EbaySoldSearchAttempt = {
    source: 'seller-hub-product-research',
    sourceUrl: 'https://www.ebay.com/sh/research?keywords=stihl+fs55r+string+trimmer&tabName=SOLD',
    query: identity.query,
    observedAt: '2026-10-03T12:00:00.000Z',
    status: 'ok',
    records: [{
      source: 'seller-hub-product-research',
      sourceUrl: 'https://www.ebay.com/sh/research?keywords=stihl+fs55r+string+trimmer&tabName=SOLD',
      observedAt: '2026-10-03T12:00:00.000Z',
      itemId: '123456789012',
      itemUrl: 'https://www.ebay.com/itm/123456789012',
      title: 'Stihl FS55R Straight Shaft String Trimmer Tested Working',
      imageUrl: null,
      soldPrice: { amount: 120, currency: 'USD' },
      shippingPrice: { amount: 0, currency: 'USD' },
      deliveredPrice: { amount: 120, currency: 'USD' },
      totalSold: null,
      totalSales: null,
      soldAt: 'Sep 30, 2026',
      condition: 'Used',
      format: null,
      priceKind: 'actual',
      provenance: { kind: 'independent-sold-evidence', source: 'seller-hub-sold-record', itemId: '123456789012' },
    }],
    hasNextPage: false,
    pageOffset: 0,
    pageLimit: 50,
    failureReason: null,
  };
  const result = verifyEbaySoldCompSet(identity, [attempt], {
    plannedQueries: [identity.query],
    minimumSampleSize: 1,
    sourceCondition: assessLotCondition({ title: clippedTitle, description: fullDescription }),
  });

  assert.equal(result.accepted.length, 0);
  assert.ok(result.rejected[0]?.reasons.includes('condition-mismatch:working-comp-for-parts-lot'));
});

test('Amazon candidate eligibility uses the repaired product identity without the fault suffix', () => {
  const identity = extractProductIdentity(clippedTitle, fullDescription);
  const evaluation = evaluateAmazonCandidateEvidence({
    asin: 'B0STIHLFS55R',
    title: 'Stihl FS55R Straight Shaft String Trimmer',
    price: 159.99,
    used: false,
    sponsored: false,
    url: 'https://www.amazon.com/dp/B0STIHLFS55R',
  }, identity);

  assert.equal(evaluation.accepted, true);
  assert.doesNotMatch(identity.query, /not\s+(?:ru|running|starting)\b/i);
});
