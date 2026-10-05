import assert from 'node:assert/strict';
import test from 'node:test';
import { parseEbayActiveResults } from '../src/intelligence/ebay-active-results.js';
import { verifyEbaySoldCompSet, type EbaySoldRecord } from '../src/intelligence/ebay-sold-results.js';
import {
  assessLotCondition,
  buildConditionPresentation,
  evaluateRetailCandidate,
  extractProductIdentity,
} from '../src/intelligence/us-deal-intelligence.js';

const lotTitle = 'Husqvarna LTH18542 Riding Mower - NO DECK';

test('a title-level missing deck survives contradictory negative condition flags', () => {
  const assessment = assessLotCondition({
    title: lotTitle,
    description: [
      'Condition: New(other)',
      'Damaged?: No',
      'Functional?: Unknown',
      'Missing Parts?: No',
      'Assembly Required?: Yes',
    ].join('\n'),
  });

  assert.equal(assessment.partsOnly, false);
  assert.equal(assessment.damaged, false);
  assert.equal(assessment.positive, false);
  assert.ok(assessment.cautions.includes('missing major component: deck'));
  assert.equal(assessment.fields['missing parts'], 'No');
  assert.equal(assessment.fields['assembly required'], 'Yes');

  const presentation = buildConditionPresentation(assessment);
  assert.deepEqual({ label: presentation.label, tone: presentation.tone }, { label: 'New · parts missing', tone: 'danger' });
});

test('healthy negated defect wording is not treated as a missing major component', () => {
  for (const wording of [
    'No motor noise',
    'No screen scratches',
    'Without engine issues',
    'No missing deck',
    'No deck belt',
    'No screen protector',
    'No engine oil leaks',
    'Not without a deck',
  ]) {
    const assessment = assessLotCondition(`Condition: Excellent\nNotes: ${wording}`);
    assert.equal(assessment.cautions.some((caution) => caution.startsWith('missing major component:')), false, wording);
  }
  assert.deepEqual(
    assessLotCondition('Condition: Used\nNotes: Not missing a deck, but no engine').cautions
      .filter((caution) => caution.startsWith('missing major component:')),
    ['missing major component: engine'],
  );
  assert.deepEqual(
    assessLotCondition('Condition: Used\nNotes: No motor damage. Motor not included.').cautions
      .filter((caution) => caution.startsWith('missing major component:')),
    ['missing major component: motor'],
  );
});

test('description-only missing deck is detected and comparable only with another incomplete candidate', () => {
  const source = assessLotCondition({
    title: 'Husqvarna LTH18542 Riding Mower',
    description: 'Condition: Used\nThe deck is missing. Engine included and runs.',
  });
  assert.ok(source.cautions.includes('missing major component: deck'));
  const identity = extractProductIdentity('Husqvarna LTH18542 Riding Mower');
  assert.equal(evaluateRetailCandidate('Husqvarna LTH18542 Riding Mower', identity).accepted, true);
});

test('direct absence wording remains a major-component warning', () => {
  assert.ok(assessLotCondition('Condition: Used\nNotes: Engine not included').cautions.includes('missing major component: engine'));
  assert.ok(assessLotCondition('Condition: Used\nNotes: missing major component: deck').cautions.includes('missing major component: deck'));
});

const mowerIdentity = extractProductIdentity('Husqvarna LTH18542 Riding Mower');
const mowerSourceDescription = 'Condition: Used\nMissing Parts?: No\nThe deck is missing. Engine included and runs.';
const mowerSourceCondition = assessLotCondition({ title: mowerIdentity.name, description: mowerSourceDescription });

function activeMowerItem(itemId: string, title: string, description?: string): Record<string, unknown> {
  return {
    itemId,
    title,
    itemWebUrl: `https://www.ebay.com/itm/${itemId}`,
    price: { value: '500.00', currency: 'USD' },
    shippingOptions: [{ shippingCost: { value: '0.00', currency: 'USD' } }],
    buyingOptions: ['FIXED_PRICE'],
    condition: 'Used',
    ...(description ? { description } : {}),
  };
}

test('eBay ACTIVE compares description-only missing components at the parser boundary', () => {
  const sameAbsence = parseEbayActiveResults({
    query: 'Husqvarna LTH18542', identity: mowerIdentity, observedAt: '2026-09-23T12:00:00.000Z',
    sourceDescription: mowerSourceDescription, sourceCondition: mowerSourceCondition,
    browseJson: { total: 1, offset: 0, itemSummaries: [activeMowerItem('100000000501', 'Husqvarna LTH18542 Riding Mower - No Deck')] },
  });
  assert.equal(sameAbsence.accepted.length, 1);

  const completeCandidate = parseEbayActiveResults({
    query: 'Husqvarna LTH18542', identity: mowerIdentity, observedAt: '2026-09-23T12:00:00.000Z',
    sourceDescription: mowerSourceDescription, sourceCondition: mowerSourceCondition,
    browseJson: { total: 1, offset: 0, itemSummaries: [activeMowerItem('100000000502', 'Husqvarna LTH18542 Riding Mower')] },
  });
  assert.ok(completeCandidate.rejected[0]?.rejectionReasons.includes('condition-mismatch:missing-major-component:deck'));

  const differentAbsence = parseEbayActiveResults({
    query: 'Husqvarna LTH18542', identity: mowerIdentity, observedAt: '2026-09-23T12:00:00.000Z',
    sourceDescription: mowerSourceDescription, sourceCondition: mowerSourceCondition,
    browseJson: { total: 1, offset: 0, itemSummaries: [activeMowerItem('100000000503', 'Husqvarna LTH18542 Riding Mower - Engine Not Included')] },
  });
  assert.ok(differentAbsence.rejected[0]?.rejectionReasons.includes('condition-mismatch:missing-major-component:deck'));
  assert.ok(differentAbsence.rejected[0]?.rejectionReasons.includes('condition-mismatch:missing-major-component:engine'));
});

test('eBay ACTIVE uses title-only source absence when sourceCondition is omitted and is symmetric', () => {
  const incompleteIdentity = extractProductIdentity(lotTitle);
  const completeIdentity = extractProductIdentity('Husqvarna LTH18542 Riding Mower');
  const sameCondition = parseEbayActiveResults({
    query: 'Husqvarna LTH18542', identity: incompleteIdentity, observedAt: '2026-09-23T12:00:00.000Z',
    browseJson: { total: 1, offset: 0, itemSummaries: [activeMowerItem('100000000511', lotTitle)] },
  });
  assert.equal(sameCondition.accepted.length, 1);

  const completeCandidate = parseEbayActiveResults({
    query: 'Husqvarna LTH18542', identity: incompleteIdentity, observedAt: '2026-09-23T12:00:00.000Z',
    browseJson: { total: 1, offset: 0, itemSummaries: [activeMowerItem('100000000512', 'Husqvarna LTH18542 Riding Mower')] },
  });
  assert.ok(completeCandidate.rejected[0]?.rejectionReasons.includes('condition-mismatch:missing-major-component:deck'));

  const missingCandidate = parseEbayActiveResults({
    query: 'Husqvarna LTH18542', identity: completeIdentity, observedAt: '2026-09-23T12:00:00.000Z',
    browseJson: { total: 1, offset: 0, itemSummaries: [activeMowerItem('100000000513', lotTitle)] },
  });
  assert.ok(missingCandidate.rejected[0]?.rejectionReasons.includes('condition-mismatch:missing-major-component:deck'));
});

function soldMowerRecord(itemId: string, title: string): EbaySoldRecord {
  return {
    source: 'seller-hub-product-research',
    sourceUrl: 'https://www.ebay.com/sh/research?keywords=Husqvarna&tabName=SOLD',
    observedAt: '2026-09-23T12:00:00.000Z',
    itemId,
    itemUrl: `https://www.ebay.com/itm/${itemId}`,
    title,
    imageUrl: null,
    soldPrice: { amount: 500, currency: 'USD' },
    shippingPrice: { amount: 0, currency: 'USD' },
    deliveredPrice: { amount: 500, currency: 'USD' },
    totalSold: 1,
    totalSales: { amount: 500, currency: 'USD' },
    soldAt: 'Sep 20, 2026',
    condition: 'Used',
    format: 'Fixed price',
    priceKind: 'actual',
    provenance: { kind: 'independent-sold-evidence', source: 'seller-hub-sold-record', itemId },
  };
}

function verifyMowerSold(
  title: string,
  sourceCondition: ReturnType<typeof assessLotCondition> | null,
  itemId: string,
  identity = mowerIdentity,
) {
  const query = 'Husqvarna LTH18542';
  const attempt = {
    source: 'seller-hub-product-research' as const,
    sourceUrl: 'https://www.ebay.com/sh/research?keywords=Husqvarna&tabName=SOLD',
    query,
    observedAt: '2026-09-23T12:00:00.000Z',
    status: 'ok' as const,
    records: [soldMowerRecord(itemId, title)],
    hasNextPage: false,
    pageOffset: 0,
    pageLimit: 50,
    failureReason: null,
  };
  return verifyEbaySoldCompSet(identity, [attempt], { plannedQueries: [query], minimumSampleSize: 1, sourceCondition });
}

test('eBay SOLD compares incomplete components at the verification boundary', () => {
  const sameAbsence = verifyMowerSold('Husqvarna LTH18542 Riding Mower - No Deck', mowerSourceCondition, '100000000601');
  assert.equal(sameAbsence.accepted.length, 1);

  const completeCandidate = verifyMowerSold('Husqvarna LTH18542 Riding Mower', mowerSourceCondition, '100000000602');
  assert.ok(completeCandidate.rejected[0]?.reasons.includes('condition-mismatch:missing-major-component:deck'));

  const differentAbsence = verifyMowerSold('Husqvarna LTH18542 Riding Mower - Engine Not Included', mowerSourceCondition, '100000000603');
  assert.ok(differentAbsence.rejected[0]?.reasons.includes('condition-mismatch:missing-major-component:deck'));
  assert.ok(differentAbsence.rejected[0]?.reasons.includes('condition-mismatch:missing-major-component:engine'));

  const completeSource = assessLotCondition('Condition: Used\nMissing Parts?: No\nEngine included and runs.');
  const missingCandidate = verifyMowerSold('Husqvarna LTH18542 Riding Mower - No Deck', completeSource, '100000000604');
  assert.ok(missingCandidate.rejected[0]?.reasons.includes('condition-mismatch:missing-major-component:deck'));
});

test('trailing prose preserves explicit absence warnings and blocks complete eBay comparables', () => {
  for (const [description, component] of [
    ['Engine not included in sale', 'engine'],
    ['Deck is missing from this mower', 'deck'],
    ['Missing deck on this mower', 'deck'],
  ]) {
    const sourceDescription = `Condition: Used\nMissing Parts?: No\nNotes: ${description}`;
    const sourceCondition = assessLotCondition({ title: mowerIdentity.name, description: sourceDescription });
    assert.ok(sourceCondition.cautions.includes(`missing major component: ${component}`), description);
    const active = parseEbayActiveResults({
      query: 'Husqvarna LTH18542', identity: mowerIdentity, observedAt: '2026-09-23T12:00:00.000Z',
      sourceDescription, sourceCondition,
      browseJson: { total: 1, offset: 0, itemSummaries: [activeMowerItem('100000000701', mowerIdentity.name)] },
    });
    assert.equal(active.accepted.length, 0, description);
    assert.ok(active.rejected[0]?.rejectionReasons.includes(`condition-mismatch:missing-major-component:${component}`), description);
    const sold = verifyMowerSold(mowerIdentity.name, sourceCondition, '100000000702');
    assert.equal(sold.accepted.length, 0, description);
    assert.ok(sold.rejected[0]?.reasons.includes(`condition-mismatch:missing-major-component:${component}`), description);
  }
});

test('eBay SOLD uses title-only source absence when sourceCondition is omitted and is symmetric', () => {
  const incompleteIdentity = extractProductIdentity(lotTitle);
  const completeIdentity = extractProductIdentity('Husqvarna LTH18542 Riding Mower');
  const sameCondition = verifyMowerSold(lotTitle, null, '100000000611', incompleteIdentity);
  assert.equal(sameCondition.accepted.length, 1);

  const completeCandidate = verifyMowerSold('Husqvarna LTH18542 Riding Mower', null, '100000000612', incompleteIdentity);
  assert.ok(completeCandidate.rejected[0]?.reasons.includes('condition-mismatch:missing-major-component:deck'));

  const missingCandidate = verifyMowerSold(lotTitle, null, '100000000613', completeIdentity);
  assert.ok(missingCandidate.rejected[0]?.reasons.includes('condition-mismatch:missing-major-component:deck'));
});

test('missing major components do not suppress retail research', () => {
  const identity = extractProductIdentity(lotTitle);
  const complete = evaluateRetailCandidate('Husqvarna LTH18542 Riding Mower', identity);
  assert.equal(complete.accepted, true);

  const sameCondition = evaluateRetailCandidate('Husqvarna LTH18542 Riding Mower - No Deck', identity);
  assert.equal(sameCondition.accepted, true);
});

test('incidental no-remote wording remains an accessory distinction, not a missing major component', () => {
  const identity = extractProductIdentity('Sony STR-DH590 Receiver - No Remote');
  const assessment = assessLotCondition('Condition: Used\nNotes: No remote');
  assert.equal(assessment.positive, false);
  assert.equal(assessment.cautions.some((caution) => caution.startsWith('missing major component:')), false);
  assert.equal(evaluateRetailCandidate('Sony STR-DH590 Receiver - No Remote', identity).accepted, true);
});
