import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyEbaySoldCompSet, type EbaySoldSearchAttempt } from '../src/intelligence/ebay-sold-results.js';
import { assessCondition, extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';
import {
  auditAuctionEvidence,
  type AuctionAuditComponent,
  type AuctionAuditDescriptorOutcome,
  type AuctionAuditEconomics,
  type AuctionAuditIdentityIssue,
  type AuctionAuditInput,
  type AuctionAuditLot,
} from '../src/testing/auction-audit.js';

const query = 'Canon EOS 5D Mark II';
const observedAt = '2026-09-22T12:00:00.000Z';

function validAttempt(search = query, firstItem = 1, price = 100): EbaySoldSearchAttempt {
  const sourceUrl = `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(search)}&LH_Sold=1&LH_Complete=1`;
  return {
    source: 'public-sold-search',
    sourceUrl,
    query: search,
    observedAt,
    status: 'ok',
    hasNextPage: false,
    pageOffset: 0,
    pageLimit: null,
    failureReason: null,
    records: [firstItem, firstItem + 1, firstItem + 2].map((id) => ({
      source: 'public-sold-search',
      sourceUrl,
      observedAt,
      itemId: String(123456789000 + id),
      itemUrl: `https://www.ebay.com/itm/${123456789000 + id}`,
      title: query,
      imageUrl: null,
      soldPrice: { amount: price, currency: 'USD' },
      shippingPrice: { amount: 5, currency: 'USD' },
      deliveredPrice: { amount: price + 5, currency: 'USD' },
      totalSold: null,
      totalSales: null,
      soldAt: null,
      condition: 'Used',
      format: 'Fixed price',
      priceKind: 'actual',
      itemPageObservation: {
        requestedUrl: `https://www.ebay.com/itm/${123456789000 + id}`,
        finalUrl: `https://www.ebay.com/itm/${123456789000 + id}`,
        observedAt,
        itemId: String(123456789000 + id),
        soldAt: 'Sep 20, 2026',
        paidAmount: { amount: price, currency: 'USD' },
        visibleSoldState: `This listing sold on Sun, Sep 20 at 10:30 AM; SOLD US $${price.toFixed(2)}`,
      },
      provenance: {
        kind: 'independent-sold-evidence',
        source: 'rendered-sold-listing',
        itemId: String(123456789000 + id),
      },
    } as EbaySoldSearchAttempt['records'][number] & { itemPageObservation: object })),
  };
}

function component(stableId: string): AuctionAuditComponent {
  return {
    stableId,
    collection: {
      descriptionReviewed: true,
      collectionComplete: true,
      expectedPhysicalDescriptorIds: ['photo-1'],
      descriptorOutcomes: [{ descriptorId: 'photo-1', status: 'reviewed', reviewedAt: observedAt }],
      reviewedDescriptorIds: ['photo-1'],
    },
    research: {
      plannedQueries: [query],
      capturedAttempts: [validAttempt()],
      sourceIdentity: extractProductIdentity(query),
      sourceCondition: assessCondition('Condition: Used\nIs Item Functional?: Yes'),
      sourceQuantity: 1,
    },
    economics: {
      acquisitionCostUsd: 10,
      sellingCostsUsd: 5,
      inboundShippingUsd: 2,
      outboundShippingUsd: 3,
      packingReserveUsd: 1,
      targetProfitUsd: 10,
    },
  };
}

function lot(stableId = 'lot-1'): AuctionAuditLot {
  return { ...component(stableId), expectedComponentIds: ['part-1'], components: [component('part-1')] };
}

function validInput(): AuctionAuditInput {
  const input = { expectedLotIds: ['lot-1'], lots: [lot()] };
  assert.equal(auditAuctionEvidence(input).complete, true, 'the unmodified baseline must be complete');
  assert.equal(auditAuctionEvidence(input).researchComplete, true);
  return input;
}

test('verified actual attempts complete the audit without caller verification', () => {
  const report = auditAuctionEvidence(validInput());
  assert.equal(report.complete, true);
  assert.equal(report.researchComplete, true);
  assert.deepEqual(report.identityIssues, []);
  for (const node of report.nodes) {
    assert.equal(node.status, 'complete');
    assert.equal(node.researchStatus, 'complete');
    assert.deepEqual(node.researchReasons, []);
    assert.deepEqual(node.acceptedSoldItemIds, ['123456789001', '123456789002', '123456789003']);
    assert.equal(node.resaleUsd, 100);
    assert.equal(node.resaleReady, true);
    assert.equal(node.profitBeforeShippingUsd, 85);
    assert.equal(node.profitBeforeShippingReady, true);
    assert.equal(node.maxAcquisitionBudgetUsd, 79);
    assert.equal(node.acquisitionBudgetReady, true);
    assert.equal(node.acquisitionBudgetStatus, 'nonnegative');
    assert.equal(node.maxBidUsd, null);
    assert.equal(node.maxBidReady, false);
  }
});

function auditObservation(record: EbaySoldSearchAttempt['records'][number]): Record<string, any> {
  return record as EbaySoldSearchAttempt['records'][number] & { itemPageObservation?: Record<string, any> };
}

for (const entry of [
  {
    name: 'future sale date',
    mutate: (record: EbaySoldSearchAttempt['records'][number]) => { auditObservation(record).itemPageObservation.soldAt = 'Sep 23, 2026'; },
  },
  {
    name: 'missing sale date',
    mutate: (record: EbaySoldSearchAttempt['records'][number]) => { delete auditObservation(record).itemPageObservation.soldAt; },
  },
  {
    name: 'unopened original item page',
    mutate: (record: EbaySoldSearchAttempt['records'][number]) => { delete auditObservation(record).itemPageObservation; },
  },
  {
    name: 'original sold item redirected to a mixed product page',
    mutate: (record: EbaySoldSearchAttempt['records'][number]) => { auditObservation(record).itemPageObservation.finalUrl = 'https://www.ebay.com/p/6060745466'; },
  },
  {
    name: 'missing visible paid-sale banner',
    mutate: (record: EbaySoldSearchAttempt['records'][number]) => { delete auditObservation(record).itemPageObservation.visibleSoldState; },
  },
  {
    name: 'active multi-quantity item with a sold counter',
    mutate: (record: EbaySoldSearchAttempt['records'][number]) => { auditObservation(record).itemPageObservation.visibleSoldState = 'US $100.00 Buy It Now; 4 available 20 sold'; },
  },
  {
    name: 'search-card sold label without original-page paid amount',
    mutate: (record: EbaySoldSearchAttempt['records'][number]) => { auditObservation(record).itemPageObservation.visibleSoldState = 'Sold Sep 20, 2026; $100.00 on search card'; },
  },
  {
    name: 'visible paid amount disagrees with claimed amount',
    mutate: (record: EbaySoldSearchAttempt['records'][number]) => { auditObservation(record).itemPageObservation.visibleSoldState = 'This listing sold on Sun, Sep 20; SOLD US $80.00'; },
  },
  {
    name: 'hidden accepted offer rather than a known paid amount',
    mutate: (record: EbaySoldSearchAttempt['records'][number]) => { auditObservation(record).itemPageObservation.visibleSoldState = 'This listing sold on Sun, Sep 20; SOLD US $100.00; Best Offer accepted'; },
  },
  {
    name: 'original page contradicts a sold search card with a seller-ended notice',
    mutate: (record: EbaySoldSearchAttempt['records'][number]) => { auditObservation(record).itemPageObservation.visibleSoldState = 'This listing sold on Sun, Sep 20; SOLD US $100.00; ended by the seller because the item is no longer available'; },
  },
] as const) {
  test(`${entry.name} stays provisional and cannot produce resale economics`, () => {
    const input = validInput();
    entry.mutate(input.lots[0]!.research.capturedAttempts[0]!.records[0]!);
    const report = auditAuctionEvidence(input);
    const node = report.nodes[0]!;
    assert.equal(report.complete, false);
    assert.equal(node.status, 'incomplete');
    assert.equal(node.acceptedSoldItemIds.length, 2);
    assert.equal(node.resaleUsd, null);
    assert.equal(node.resaleReady, false);
    assert.ok(node.reasons.includes('unverified-sold-candidates'));
    assert.deepEqual(node.attemptedQueries, [query]);
  });
}

test('an unverified search card does not erase other direct sales or certify completion', () => {
  const input = validInput();
  const attempt = input.lots[0]!.research.capturedAttempts[0]!;
  const card = structuredClone(attempt.records[0]!);
  card.itemId = '123456789099';
  card.itemUrl = 'https://www.ebay.com/itm/123456789099';
  card.provenance.itemId = card.itemId;
  delete auditObservation(card).itemPageObservation;
  attempt.records.push(card);
  const node = auditAuctionEvidence(input).nodes[0]!;
  assert.deepEqual(node.attemptedQueries, [query]);
  assert.equal(node.acceptedSoldItemIds.length, 3);
  assert.equal(node.resaleUsd, 100);
  assert.equal(node.status, 'incomplete');
  assert.equal(node.researchStatus, 'incomplete');
  assert.ok(node.reasons.includes('unverified-sold-candidates'));
});

test('original item page may be opened after the search result was captured', () => {
  const input = validInput();
  const observation = auditObservation(input.lots[0]!.research.capturedAttempts[0]!.records[0]!).itemPageObservation;
  observation.observedAt = '2026-09-22T12:05:00.000Z';
  const node = auditAuctionEvidence(input).nodes[0]!;
  assert.equal(node.status, 'complete');
  assert.equal(node.acceptedSoldItemIds.length, 3);
});

test('one direct item-page sale is retained as verified evidence while the sample remains insufficient', () => {
  const input = validInput();
  const attempt = input.lots[0]!.research.capturedAttempts[0]!;
  attempt.records = [attempt.records[0]!];
  const report = auditAuctionEvidence(input);
  const node = report.nodes[0]!;
  assert.equal(node.acceptedSoldItemIds.length, 1);
  assert.equal(node.acceptedSoldItemIds[0], '123456789001');
  assert.equal(node.status, 'insufficient');
  assert.equal(node.resaleUsd, null);
  assert.equal(report.researchComplete, true);
});

test('zero expected lots is a legitimate complete empty audit', () => {
  const report = auditAuctionEvidence({ expectedLotIds: [], lots: [] });
  assert.equal(report.complete, true);
  assert.equal(report.researchComplete, true);
  assert.deepEqual(report.identityIssues, []);
});

const identityCases: Array<{
  name: string;
  mutate: (input: AuctionAuditInput) => void;
  issue: AuctionAuditIdentityIssue;
}> = [
  {
    name: 'blank expected lot ID',
    mutate: (input) => { input.expectedLotIds = ['lot-1', ' ']; },
    issue: { scope: 'lot', path: 'expectedLotIds[1]', reason: 'blank', id: '' },
  },
  {
    name: 'duplicate expected lot ID after normalization',
    mutate: (input) => { input.expectedLotIds = ['lot-1', ' LOT-1 ']; },
    issue: { scope: 'lot', path: 'expectedLotIds[1]', reason: 'duplicate', id: 'LOT-1' },
  },
  {
    name: 'blank supplied lot ID',
    mutate: (input) => { input.lots = [...input.lots, lot(' ')]; },
    issue: { scope: 'lot', path: 'lots[1]', reason: 'blank', id: '' },
  },
  {
    name: 'duplicate supplied lot ID',
    mutate: (input) => { input.lots = [...input.lots, lot()]; },
    issue: { scope: 'lot', path: 'lots[1]', reason: 'duplicate', id: 'lot-1' },
  },
  {
    name: 'missing lot',
    mutate: (input) => { input.expectedLotIds = ['lot-1', 'lot-2']; },
    issue: { scope: 'lot', path: 'expectedLotIds[1]', reason: 'missing', id: 'lot-2' },
  },
  {
    name: 'unexpected lot',
    mutate: (input) => { input.lots = [...input.lots, lot('lot-2')]; },
    issue: { scope: 'lot', path: 'lots[1]', reason: 'unexpected', id: 'lot-2' },
  },
  {
    name: 'blank expected component ID',
    mutate: (input) => { input.lots[0]!.expectedComponentIds = ['part-1', ' ']; },
    issue: { scope: 'component', path: 'lots[0].expectedComponentIds[1]', reason: 'blank', id: '' },
  },
  {
    name: 'duplicate expected component ID',
    mutate: (input) => { input.lots[0]!.expectedComponentIds = ['part-1', ' PART-1 ']; },
    issue: { scope: 'component', path: 'lots[0].expectedComponentIds[1]', reason: 'duplicate', id: 'PART-1' },
  },
  {
    name: 'blank supplied component ID',
    mutate: (input) => { input.lots[0]!.components = [...input.lots[0]!.components, component(' ')]; },
    issue: { scope: 'component', path: 'lots[0].components[1]', reason: 'blank', id: '' },
  },
  {
    name: 'missing supplied component ID at runtime',
    mutate: (input) => { input.lots[0]!.components = [...input.lots[0]!.components, component(undefined as never)]; },
    issue: { scope: 'component', path: 'lots[0].components[1]', reason: 'blank', id: '' },
  },
  {
    name: 'duplicate supplied component ID',
    mutate: (input) => { input.lots[0]!.components = [...input.lots[0]!.components, component('part-1')]; },
    issue: { scope: 'component', path: 'lots[0].components[1]', reason: 'duplicate', id: 'part-1' },
  },
  {
    name: 'missing component',
    mutate: (input) => { input.lots[0]!.expectedComponentIds = ['part-1', 'part-2']; },
    issue: { scope: 'component', path: 'lots[0].expectedComponentIds[1]', reason: 'missing', id: 'part-2' },
  },
  {
    name: 'unexpected component',
    mutate: (input) => { input.lots[0]!.components = [...input.lots[0]!.components, component('part-2')]; },
    issue: { scope: 'component', path: 'lots[0].components[1]', reason: 'unexpected', id: 'part-2' },
  },
];

for (const entry of identityCases) {
  test(`${entry.name} gates otherwise complete evidence with a retained scoped issue`, () => {
    const input = validInput();
    entry.mutate(input);
    const report = auditAuctionEvidence(input);
    assert.equal(report.complete, false);
    assert.equal(report.researchComplete, false);
    assert.ok(report.nodes.every((node) => node.status === 'complete'));
    assert.deepEqual(report.identityIssues, [entry.issue]);
    assert.ok(!report.unexpectedComponentIds.includes(''));
  });
}

test('component issues retain their lot scope even when IDs repeat across lots', () => {
  const input = validInput();
  input.lots = [...input.lots, lot('lot-2')];
  input.expectedLotIds = ['lot-1', 'lot-2'];
  assert.equal(auditAuctionEvidence(input).complete, true);
  input.lots[1]!.expectedComponentIds = ['part-1', 'part-1'];
  const report = auditAuctionEvidence(input);
  assert.equal(report.complete, false);
  assert.equal(report.researchComplete, false);
  assert.deepEqual(report.identityIssues, [
    { scope: 'component', path: 'lots[1].expectedComponentIds[1]', reason: 'duplicate', id: 'part-1' },
  ]);
});

for (const level of ['lot', 'component'] as const) {
  for (const entry of [
    { side: 'expectedPhysicalDescriptorIds', values: ['photo-1', ' '], reason: 'blank', id: '' },
    { side: 'expectedPhysicalDescriptorIds', values: ['photo-1', 'PHOTO-1'], reason: 'duplicate', id: 'PHOTO-1' },
    { side: 'expectedPhysicalDescriptorIds', values: ['photo-1', 'photo-2'], reason: 'missing', id: 'photo-2' },
    { side: 'reviewedDescriptorIds', values: ['photo-1', ' '], reason: 'blank', id: '' },
    { side: 'reviewedDescriptorIds', values: ['photo-1', 'PHOTO-1'], reason: 'duplicate', id: 'PHOTO-1' },
    { side: 'reviewedDescriptorIds', values: ['photo-1', 'photo-2'], reason: 'unexpected', id: 'photo-2' },
  ] as const) {
    test(`${level} ${entry.side} ${entry.reason} is reported and gates completion`, () => {
      const input = validInput();
      const item = level === 'lot' ? input.lots[0]! : input.lots[0]!.components[0]!;
      const path = level === 'lot' ? 'lots[0]' : 'lots[0].components[0]';
      item.collection[entry.side] = entry.values;
      const report = auditAuctionEvidence(input);
      assert.equal(report.complete, false);
      assert.equal(report.researchComplete, false);
      assert.equal(report.nodes[level === 'lot' ? 0 : 1]!.researchStatus, 'incomplete');
      assert.equal(report.nodes[level === 'lot' ? 0 : 1]!.status, 'incomplete');
      assert.deepEqual(report.identityIssues, [{
        scope: 'descriptor', path: `${path}.collection.${entry.side}[1]`, reason: entry.reason, id: entry.id,
      }]);
    });
  }
}

test('description review is required even with complete photos and sold evidence', () => {
  const input = validInput();
  input.lots[0]!.collection.descriptionReviewed = false;
  const report = auditAuctionEvidence(input);
  assert.equal(report.complete, false);
  assert.equal(report.researchComplete, false);
  assert.deepEqual(report.nodes[0]!.reasons, ['description-unreviewed']);
});

for (const complete of [true, false, undefined]) {
  test(`an empty photo collection with completeness ${complete} is handled explicitly`, () => {
    const input = validInput();
    input.lots[0]!.collection.expectedPhysicalDescriptorIds = [];
    input.lots[0]!.collection.reviewedDescriptorIds = [];
    input.lots[0]!.collection.descriptorOutcomes = [];
    assert.equal(auditAuctionEvidence(input).complete, true, 'authoritative zero photos is valid');
    input.lots[0]!.collection.collectionComplete = complete as boolean;
    const report = auditAuctionEvidence(input);
    assert.equal(report.complete, complete === true);
    assert.equal(report.researchComplete, complete === true);
    assert.equal(report.nodes[0]!.reasons.includes('collection-incomplete'), complete !== true);
  });
}

const invalidProvenanceCases: Array<{ name: string; mutate: (attempt: EbaySoldSearchAttempt) => void }> = [
  { name: 'blank attempt URL', mutate: (attempt) => { attempt.sourceUrl = ''; } },
  { name: 'malformed attempt URL', mutate: (attempt) => { attempt.sourceUrl = 'not a URL'; } },
  { name: 'external attempt URL', mutate: (attempt) => { attempt.sourceUrl = 'https://example.com'; } },
  { name: 'insecure attempt URL', mutate: (attempt) => { attempt.sourceUrl = attempt.sourceUrl.replace('https:', 'http:'); } },
  { name: 'active search URL', mutate: (attempt) => { attempt.sourceUrl = attempt.sourceUrl.replace('LH_Sold=1', 'LH_Sold=0'); } },
  { name: 'blank attempt timestamp', mutate: (attempt) => { attempt.observedAt = ''; } },
  { name: 'malformed attempt timestamp', mutate: (attempt) => { attempt.observedAt = 'not a date'; } },
  { name: 'mismatched query', mutate: (attempt) => { attempt.query = 'invented query'; } },
  { name: 'external record URL', mutate: (attempt) => { attempt.records[0]!.sourceUrl = 'https://example.com'; } },
  { name: 'unrelated record capture URL', mutate: (attempt) => { attempt.records[0]!.sourceUrl = validAttempt('unrelated').sourceUrl; } },
  { name: 'blank record timestamp', mutate: (attempt) => { attempt.records[0]!.observedAt = ''; } },
  { name: 'malformed record timestamp', mutate: (attempt) => { attempt.records[0]!.observedAt = 'not a date'; } },
  { name: 'unrelated record timestamp', mutate: (attempt) => { attempt.records[0]!.observedAt = '2026-09-21T12:00:00.000Z'; } },
  { name: 'mismatched record source', mutate: (attempt) => { attempt.records[0]!.source = 'seller-hub-product-research'; } },
  { name: 'external item URL', mutate: (attempt) => { attempt.records[0]!.itemUrl = 'https://example.com/itm/123456789001'; } },
  { name: 'mismatched item ID', mutate: (attempt) => { attempt.records[0]!.itemId = '123456789999'; } },
  { name: 'mismatched provenance ID', mutate: (attempt) => { attempt.records[0]!.provenance.itemId = '123456789999'; } },
  { name: 'nonfinite sale price', mutate: (attempt) => { attempt.records[0]!.soldPrice!.amount = Infinity; } },
  { name: 'NaN delivered price', mutate: (attempt) => { attempt.records[0]!.deliveredPrice!.amount = NaN; } },
];

for (const entry of invalidProvenanceCases) {
  test(`${entry.name} cannot supply query coverage or valuation`, () => {
    const input = validInput();
    entry.mutate(input.lots[0]!.research.capturedAttempts[0]!);
    const report = auditAuctionEvidence(input);
    const node = report.nodes[0]!;
    assert.equal(report.complete, false);
    assert.equal(report.researchComplete, false);
    assert.ok(node.reasons.includes('invalid-captured-attempt-provenance'));
    assert.ok(node.reasons.includes('planned-queries-not-all-attempted'));
    assert.deepEqual(node.attemptedQueries, []);
    assert.deepEqual(node.acceptedSoldItemIds, []);
    assert.equal(node.resaleUsd, null);
    assert.equal(node.profitBeforeShippingUsd, null);
    assert.equal(node.maxAcquisitionBudgetUsd, null);
    assert.equal(node.acquisitionBudgetStatus, 'unavailable');
    assert.equal(node.maxBidUsd, null);
    assert.equal(report.nodes[1]!.status, 'complete');
  });
}

test('invalid expensive captures cannot influence sufficient valid comps or complete another query', () => {
  const input = validInput();
  const research = input.lots[0]!.research;
  const otherQuery = 'Canon 5D';
  const expensive = validAttempt(otherQuery, 4, 10000);
  research.plannedQueries = [query, otherQuery];
  research.capturedAttempts = [...research.capturedAttempts, expensive];
  assert.equal(auditAuctionEvidence(input).complete, true);
  expensive.observedAt = 'invalid';
  const report = auditAuctionEvidence(input);
  const node = report.nodes[0]!;
  assert.equal(report.complete, false);
  assert.equal(report.researchComplete, false);
  assert.ok(node.reasons.includes('planned-queries-not-all-attempted'));
  assert.deepEqual(node.attemptedQueries, [query]);
  assert.deepEqual(node.acceptedSoldItemIds, ['123456789001', '123456789002', '123456789003']);
  assert.equal(node.resaleUsd, 100);
  assert.equal(node.profitBeforeShippingUsd, 85);
  assert.equal(node.maxAcquisitionBudgetUsd, 79);
  assert.equal(node.maxBidUsd, null);
});

test('invalid captures cannot bring an insufficient valid sample up to the minimum', () => {
  const input = validInput();
  const research = input.lots[0]!.research;
  const first = research.capturedAttempts[0]!;
  first.records = first.records.slice(0, 2);
  const otherQuery = 'Canon 5D';
  const extra = validAttempt(otherQuery, 4);
  research.plannedQueries = [query, otherQuery];
  research.capturedAttempts = [first, extra];
  assert.equal(auditAuctionEvidence(input).complete, true);
  extra.records[0]!.observedAt = '';
  const report = auditAuctionEvidence(input);
  assert.equal(report.complete, false);
  assert.equal(report.researchComplete, false);
  assert.deepEqual(report.nodes[0]!.attemptedQueries, [query]);
  assert.deepEqual(report.nodes[0]!.acceptedSoldItemIds, ['123456789001', '123456789002']);
  assert.equal(report.nodes[0]!.resaleUsd, null);
  assert.equal(report.nodes[0]!.profitBeforeShippingUsd, null);
  assert.equal(report.nodes[0]!.maxAcquisitionBudgetUsd, null);
});

for (const actual of ['absent', 'empty', 'challenge'] as const) {
  test(`forged caller verification cannot rescue ${actual} actual attempts`, () => {
    const input = validInput();
    const research = input.lots[0]!.research;
    const forged = verifyEbaySoldCompSet(research.sourceIdentity, [...research.capturedAttempts], {
      plannedQueries: [...research.plannedQueries],
      sourceCondition: research.sourceCondition,
      sourceQuantity: research.sourceQuantity,
    });
    assert.equal(forged.status, 'verified');
    Object.assign(research, { verification: forged });
    if (actual === 'absent') research.capturedAttempts = [];
    else if (actual === 'empty') research.capturedAttempts[0]!.records = [];
    else research.capturedAttempts[0]!.status = 'challenge';
    const report = auditAuctionEvidence(input);
    assert.equal(report.complete, false);
    assert.equal(report.researchComplete, actual === 'empty');
    assert.equal(report.nodes[0]!.researchStatus, actual === 'absent' ? 'unattempted' : actual === 'empty' ? 'complete' : 'incomplete');
    assert.equal(report.nodes[0]!.status, actual === 'absent' ? 'unattempted' : actual === 'empty' ? 'insufficient' : 'incomplete');
    assert.deepEqual(report.nodes[0]!.acceptedSoldItemIds, []);
    assert.equal(report.nodes[0]!.resaleUsd, null);
    assert.equal(report.nodes[0]!.maxAcquisitionBudgetUsd, null);
  });
}

for (const field of ['sourceIdentity', 'sourceCondition', 'sourceQuantity'] as const) {
  test(`missing ${field} gates otherwise valid captured evidence`, () => {
    const input = validInput();
    input.lots[0]!.research[field] = undefined as never;
    const report = auditAuctionEvidence(input);
    assert.equal(report.complete, false);
    assert.equal(report.researchComplete, false);
    assert.ok(report.nodes[0]!.reasons.includes('missing-source-product-evidence'));
    assert.equal(report.nodes[0]!.resaleUsd, null);
  });
}

for (const field of [
  'acquisitionCostUsd', 'sellingCostsUsd', 'inboundShippingUsd',
  'outboundShippingUsd', 'packingReserveUsd', 'targetProfitUsd',
] satisfies Array<keyof AuctionAuditEconomics>) {
  for (const value of [-1, NaN, Infinity, -Infinity]) {
    test(`${field} rejects ${value} and withholds dependent economics`, () => {
      const input = validInput();
      input.lots[0]!.economics[field] = value;
      const report = auditAuctionEvidence(input);
      const node = report.nodes[0]!;
      assert.equal(report.complete, false);
      assert.equal(report.researchComplete, true);
      assert.deepEqual(node.invalidCostFields, [field]);
      assert.equal(node.profitBeforeShippingUsd, ['acquisitionCostUsd', 'sellingCostsUsd'].includes(field) ? null : 85);
      assert.equal(node.maxAcquisitionBudgetUsd, null);
      assert.equal(node.acquisitionBudgetStatus, 'unavailable');
      assert.equal(node.maxBidUsd, null);
    });
  }
}

test('unknown shipping withholds the acquisition budget but preserves profit before shipping', () => {
  const input = validInput();
  input.lots[0]!.economics.inboundShippingUsd = null;
  const report = auditAuctionEvidence(input);
  assert.equal(report.complete, false);
  assert.equal(report.researchComplete, true);
  assert.deepEqual(report.nodes[0]!.unknownCostFields, ['inboundShippingUsd']);
  assert.equal(report.nodes[0]!.profitBeforeShippingUsd, 85);
  assert.equal(report.nodes[0]!.profitBeforeShippingReady, true);
  assert.equal(report.nodes[0]!.maxAcquisitionBudgetUsd, null);
  assert.equal(report.nodes[0]!.acquisitionBudgetReady, false);
  assert.equal(report.nodes[0]!.acquisitionBudgetStatus, 'unavailable');
  assert.equal(report.nodes[0]!.maxBidUsd, null);
});

test('the all-in acquisition budget excludes current cost and is never a hammer bid', () => {
  const input = validInput();
  input.lots[0]!.economics.acquisitionCostUsd = 1000;
  const report = auditAuctionEvidence(input);
  assert.equal(report.complete, true);
  assert.equal(report.nodes[0]!.profitBeforeShippingUsd, -905);
  assert.equal(report.nodes[0]!.maxAcquisitionBudgetUsd, 79);
  assert.equal(report.nodes[0]!.acquisitionBudgetStatus, 'nonnegative');
  assert.equal(report.nodes[0]!.maxBidUsd, null);
});

for (const target of [89, 90]) {
  test(`a target profit of ${target} distinguishes zero budget from a shortfall`, () => {
    const input = validInput();
    input.lots[0]!.economics.targetProfitUsd = target;
    const report = auditAuctionEvidence(input);
    assert.equal(report.complete, true, 'an unaffordable result can still be fully audited');
    assert.equal(report.nodes[0]!.maxAcquisitionBudgetUsd, 89 - target);
    assert.equal(report.nodes[0]!.acquisitionBudgetStatus, target === 89 ? 'nonnegative' : 'shortfall');
    assert.equal(report.nodes[0]!.maxBidUsd, null);
  });
}

for (const sampleSize of [0, 1]) {
  test(`${sampleSize} suitable comps can finish research without making a valuation ready`, () => {
    const input = validInput();
    const attempt = input.lots[0]!.research.capturedAttempts[0]!;
    attempt.records = attempt.records.slice(0, sampleSize);
    if (sampleSize === 0) attempt.status = 'no-results';
    const report = auditAuctionEvidence(input);
    const node = report.nodes[0]!;
    assert.equal(report.researchComplete, true);
    assert.equal(node.researchStatus, 'complete');
    assert.deepEqual(node.researchReasons, []);
    assert.equal(report.complete, false);
    assert.equal(node.status, 'insufficient');
    assert.equal(node.acceptedSoldItemIds.length, sampleSize);
    assert.equal(node.resaleReady, false);
    assert.equal(node.profitBeforeShippingReady, false);
    assert.equal(node.acquisitionBudgetReady, false);
    assert.equal(node.maxBidReady, false);
    assert.equal(node.resaleUsd, null);
    assert.equal(node.profitBeforeShippingUsd, null);
    assert.equal(node.maxAcquisitionBudgetUsd, null);
    assert.equal(node.maxBidUsd, null);
  });
}

test('a completed search with only unsuitable sold records finishes research', () => {
  const input = validInput();
  for (const record of input.lots[0]!.research.capturedAttempts[0]!.records) record.title = 'Nikon D750';
  const report = auditAuctionEvidence(input);
  assert.equal(report.researchComplete, true);
  assert.equal(report.nodes[0]!.researchStatus, 'complete');
  assert.equal(report.complete, false);
  assert.equal(report.nodes[0]!.status, 'insufficient');
  assert.deepEqual(report.nodes[0]!.acceptedSoldItemIds, []);
  assert.equal(report.nodes[0]!.resaleUsd, null);
});

test('all unknown costs preserve research completion and a supported resale only', () => {
  const input = validInput();
  input.lots[0]!.economics = {
    acquisitionCostUsd: null, sellingCostsUsd: null, inboundShippingUsd: null,
    outboundShippingUsd: null, packingReserveUsd: null, targetProfitUsd: null,
  };
  const report = auditAuctionEvidence(input);
  const node = report.nodes[0]!;
  assert.equal(report.researchComplete, true);
  assert.equal(node.researchStatus, 'complete');
  assert.equal(report.complete, false);
  assert.equal(node.resaleUsd, 100);
  assert.equal(node.resaleReady, true);
  assert.equal(node.profitBeforeShippingUsd, null);
  assert.equal(node.profitBeforeShippingReady, false);
  assert.equal(node.maxAcquisitionBudgetUsd, null);
  assert.equal(node.acquisitionBudgetReady, false);
  assert.equal(node.maxBidUsd, null);
  assert.equal(node.maxBidReady, false);
});

function blockedPhoto(): Extract<AuctionAuditDescriptorOutcome, { status: 'blocked' }> {
  return {
    descriptorId: 'photo-1',
    status: 'blocked',
    attemptedAt: observedAt,
    sourceUrl: 'https://cdn.hibid.com/img.axd?id=photo-1',
    reason: 'HTTP 403 returned by seller image CDN',
  };
}

test('a documented blocked photo completes research with access gaps', () => {
  const input = validInput();
  const collection = input.lots[0]!.collection;
  collection.descriptorOutcomes = [blockedPhoto()];
  collection.reviewedDescriptorIds = [];
  const report = auditAuctionEvidence(input);
  const node = report.nodes[0]!;
  assert.equal(report.researchComplete, true);
  assert.equal(node.researchStatus, 'complete-with-access-gaps');
  assert.deepEqual(node.researchReasons, ['physical-descriptors-blocked']);
  assert.deepEqual(node.descriptorOutcomes, [blockedPhoto()]);
  assert.deepEqual(report.identityIssues, []);
  assert.equal(report.complete, false);
  assert.deepEqual(node.missingDescriptorIds, ['photo-1']);
  assert.equal(node.resaleUsd, 100, 'the existing supported financial outcomes stay unchanged');
  assert.equal(node.resaleReady, true);
  assert.equal(node.maxBidUsd, null);
});

test('timestamped review outcomes work without legacy reviewed-ID claims', () => {
  const input = validInput();
  delete input.lots[0]!.collection.reviewedDescriptorIds;
  const report = auditAuctionEvidence(input);
  assert.equal(report.complete, true);
  assert.equal(report.researchComplete, true);
});

test('legacy reviewed-ID claims cannot substitute for missing outcomes', () => {
  const input = validInput();
  input.lots[0]!.collection.descriptorOutcomes = [];
  const report = auditAuctionEvidence(input);
  assert.equal(report.complete, false);
  assert.equal(report.researchComplete, false);
  assert.equal(report.nodes[0]!.researchStatus, 'incomplete');
  assert.deepEqual(report.nodes[0]!.missingDescriptorIds, ['photo-1']);
});

for (const status of ['unattempted', 'deferred'] as const) {
  test(`a ${status} photo keeps research incomplete despite legacy reviewed claims`, () => {
    const input = validInput();
    input.lots[0]!.collection.descriptorOutcomes = [{ descriptorId: 'photo-1', status }];
    const report = auditAuctionEvidence(input);
    assert.equal(report.complete, false);
    assert.equal(report.researchComplete, false);
    assert.equal(report.nodes[0]!.researchStatus, 'incomplete');
    assert.deepEqual(report.nodes[0]!.researchReasons, ['physical-descriptors-unresolved']);
  });
}

for (const timestamp of [undefined, '', 'not a date', '0', '2026-09-22']) {
  test(`a review with timestamp ${JSON.stringify(timestamp)} cannot finish photo research`, () => {
    const input = validInput();
    input.lots[0]!.collection.descriptorOutcomes = [{
      descriptorId: 'photo-1', status: 'reviewed', reviewedAt: timestamp as string,
    }];
    const report = auditAuctionEvidence(input);
    assert.equal(report.complete, false);
    assert.equal(report.researchComplete, false);
    assert.ok(report.nodes[0]!.researchReasons.includes('invalid-descriptor-evidence'));
  });
}

for (const entry of [
  { name: 'missing attempt timestamp', patch: { attemptedAt: undefined } },
  { name: 'invalid attempt timestamp', patch: { attemptedAt: 'not a date' } },
  { name: 'date without attempt time', patch: { attemptedAt: '2026-09-22' } },
  { name: 'missing image URL', patch: { sourceUrl: undefined } },
  { name: 'malformed image URL', patch: { sourceUrl: 'seller image' } },
  { name: 'HTTP image URL', patch: { sourceUrl: 'http://cdn.hibid.com/photo-1.jpg' } },
  { name: 'file URL', patch: { sourceUrl: 'file:///photo-1.jpg' } },
  { name: 'credential-bearing URL', patch: { sourceUrl: 'https://user:password@cdn.hibid.com/photo-1.jpg' } },
  { name: 'empty reason', patch: { reason: '   ' } },
  { name: 'bare blocked label', patch: { reason: 'blocked' } },
  { name: 'generic error label', patch: { reason: 'unknown error' } },
] as const) {
  test(`blocked photo with ${entry.name} does not establish an access gap`, () => {
    const input = validInput();
    const outcome = blockedPhoto();
    input.lots[0]!.collection.descriptorOutcomes = [outcome];
    input.lots[0]!.collection.reviewedDescriptorIds = [];
    assert.equal(auditAuctionEvidence(input).researchComplete, true, 'the documented blocked baseline is complete');
    Object.assign(outcome, entry.patch);
    const report = auditAuctionEvidence(input);
    assert.equal(report.researchComplete, false);
    assert.equal(report.complete, false);
    assert.equal(report.nodes[0]!.researchStatus, 'incomplete');
    assert.ok(report.nodes[0]!.researchReasons.includes('invalid-descriptor-evidence'));
    assert.ok(!report.nodes[0]!.researchReasons.includes('physical-descriptors-blocked'));
  });
}

for (const status of ['reviewed', 'blocked'] as const) {
  test(`duplicate ${status} outcomes cannot complete research`, () => {
    const input = validInput();
    const first: AuctionAuditDescriptorOutcome = status === 'reviewed'
      ? { descriptorId: 'photo-1', status, reviewedAt: observedAt }
      : blockedPhoto();
    input.lots[0]!.collection.descriptorOutcomes = [first];
    assert.equal(auditAuctionEvidence(input).researchComplete, true);
    input.lots[0]!.collection.descriptorOutcomes = [first, { ...first, descriptorId: 'PHOTO-1' }];
    const report = auditAuctionEvidence(input);
    assert.equal(report.researchComplete, false);
    assert.equal(report.nodes[0]!.researchStatus, 'incomplete');
    assert.deepEqual(report.identityIssues, [{
      scope: 'descriptor', path: 'lots[0].collection.descriptorOutcomes[1]', reason: 'duplicate', id: 'PHOTO-1',
    }]);
  });

  test(`unknown ${status} outcome IDs cannot bypass the collection identity gate`, () => {
    const input = validInput();
    const extra: AuctionAuditDescriptorOutcome = status === 'reviewed'
      ? { descriptorId: 'photo-x', status, reviewedAt: observedAt }
      : { ...blockedPhoto(), descriptorId: 'photo-x' };
    input.lots[0]!.collection.descriptorOutcomes = [...input.lots[0]!.collection.descriptorOutcomes, extra];
    const report = auditAuctionEvidence(input);
    assert.equal(report.researchComplete, false);
    assert.equal(report.nodes[0]!.researchStatus, 'incomplete');
    assert.deepEqual(report.identityIssues, [{
      scope: 'descriptor', path: 'lots[0].collection.descriptorOutcomes[1]', reason: 'unexpected', id: 'photo-x',
    }]);
  });
}

test('blocking an unknown descriptor cannot substitute for an expected photo', () => {
  const input = validInput();
  input.lots[0]!.collection.descriptorOutcomes = [{ ...blockedPhoto(), descriptorId: 'photo-x' }];
  const report = auditAuctionEvidence(input);
  assert.equal(report.researchComplete, false);
  assert.equal(report.nodes[0]!.researchStatus, 'incomplete');
  assert.ok(report.identityIssues.some((issue) => issue.reason === 'missing' && issue.id === 'photo-1'));
  assert.ok(report.identityIssues.some((issue) => issue.reason === 'unexpected' && issue.id === 'photo-x'));
  assert.ok(report.nodes[0]!.researchReasons.includes('physical-descriptors-unresolved'));
});

for (const missingWork of ['unattempted photo', 'deferred photo', 'unattempted query'] as const) {
  test(`a documented blocked photo cannot excuse an ${missingWork}`, () => {
    const input = validInput();
    const item = input.lots[0]!;
    item.collection.descriptorOutcomes = [blockedPhoto()];
    assert.equal(auditAuctionEvidence(input).researchComplete, true);
    if (missingWork === 'unattempted query') {
      item.research.plannedQueries = [query, 'Canon 5D'];
    } else {
      item.collection.expectedPhysicalDescriptorIds = ['photo-1', 'photo-2'];
      item.collection.descriptorOutcomes = [blockedPhoto(), {
        descriptorId: 'photo-2', status: missingWork === 'unattempted photo' ? 'unattempted' : 'deferred',
      }];
    }
    const report = auditAuctionEvidence(input);
    assert.equal(report.researchComplete, false);
    assert.equal(report.nodes[0]!.researchStatus, 'incomplete');
  });
}

function challengeAttempt(): EbaySoldSearchAttempt {
  return { ...validAttempt(), status: 'challenge', records: [], failureReason: 'eBay CAPTCHA prevented access' };
}

const undocumentedAccessReasons = [
  'deferred unattempted',
  'challenge deferred until later',
  'challenge unattempted because deadline reached',
  'challenge skipped due to time budget',
  'eBay CAPTCHA time-budget exceeded',
  'ebay-challenge deferred',
  'HTTP 403 check unattempted',
  'deadline reached before challenge check',
  'research planned for tomorrow',
  'possibly a CAPTCHA',
  'No CAPTCHA was displayed',
  'HTTP 403 might occur',
  { toString: () => 'ebay-challenge' },
] as const;

for (const reason of [null, undefined, '', ' \t\n ', 'challenge', 'unknown error', ...undocumentedAccessReasons]) {
  test(`challenge reason ${JSON.stringify(reason)} cannot establish a terminal access gap`, () => {
    const input = validInput();
    const attempt = challengeAttempt();
    input.lots[0]!.research.capturedAttempts = [attempt];
    assert.equal(auditAuctionEvidence(input).researchComplete, true, 'documented challenge baseline is complete');
    if (reason === undefined) Reflect.deleteProperty(attempt, 'failureReason');
    else attempt.failureReason = reason as EbaySoldSearchAttempt['failureReason'];
    const report = auditAuctionEvidence(input);
    const node = report.nodes[0]!;
    assert.equal(report.researchComplete, false);
    assert.equal(node.researchStatus, 'incomplete');
    assert.equal(report.complete, false);
    assert.ok(node.researchReasons.includes('invalid-captured-attempt-provenance'));
    assert.ok(!node.researchReasons.includes('sold-search-access-blocked'));
    assert.deepEqual(node.attemptedQueries, []);
    assert.equal(node.resaleReady, false);
    assert.equal(node.resaleUsd, null);
    assert.equal(node.profitBeforeShippingUsd, null);
    assert.equal(node.maxAcquisitionBudgetUsd, null);
    assert.equal(node.maxBidUsd, null);
  });
}

for (const reason of undocumentedAccessReasons) {
  test(`blocked-photo reason ${JSON.stringify(reason)} cannot fabricate an access gap`, () => {
    const input = validInput();
    const outcome = blockedPhoto();
    input.lots[0]!.collection.descriptorOutcomes = [outcome];
    assert.equal(auditAuctionEvidence(input).researchComplete, true);
    outcome.reason = reason as string;
    const report = auditAuctionEvidence(input);
    assert.equal(report.researchComplete, false);
    assert.equal(report.nodes[0]!.researchStatus, 'incomplete');
    assert.ok(report.nodes[0]!.researchReasons.includes('invalid-descriptor-evidence'));
    assert.ok(!report.nodes[0]!.researchReasons.includes('physical-descriptors-blocked'));
  });
}

for (const reason of [
  'Observed eBay CAPTCHA page',
  'Security challenge was displayed',
  'HTTP 403 Forbidden',
  'eBay returned HTTP 429 Too Many Requests',
]) {
  test(`observed access failure ${JSON.stringify(reason)} documents a challenge without valuation`, () => {
    const input = validInput();
    input.lots[0]!.research.capturedAttempts = [{ ...challengeAttempt(), failureReason: reason }];
    const report = auditAuctionEvidence(input);
    assert.equal(report.researchComplete, true);
    assert.equal(report.nodes[0]!.researchStatus, 'complete-with-access-gaps');
    assert.equal(report.complete, false);
    assert.equal(report.nodes[0]!.resaleUsd, null);
    assert.equal(report.nodes[0]!.maxBidUsd, null);
  });
}

test('the parser challenge-evidence marker permits a documented access gap without valuation', () => {
  const input = validInput();
  input.lots[0]!.research.capturedAttempts = [{ ...challengeAttempt(), failureReason: 'ebay-challenge' }];
  const report = auditAuctionEvidence(input);
  const node = report.nodes[0]!;
  assert.equal(report.researchComplete, true);
  assert.equal(node.researchStatus, 'complete-with-access-gaps');
  assert.equal(report.complete, false);
  assert.equal(node.status, 'blocked');
  assert.equal(node.resaleUsd, null);
  assert.equal(node.profitBeforeShippingUsd, null);
  assert.equal(node.maxAcquisitionBudgetUsd, null);
  assert.equal(node.maxBidUsd, null);
});

test('a clean terminal zero-result attempt needs no failure reason to complete research', () => {
  const input = validInput();
  const attempt = input.lots[0]!.research.capturedAttempts[0]!;
  attempt.status = 'no-results';
  attempt.records = [];
  assert.equal(attempt.failureReason, null);
  const report = auditAuctionEvidence(input);
  const node = report.nodes[0]!;
  assert.equal(report.researchComplete, true);
  assert.equal(node.researchStatus, 'complete');
  assert.deepEqual(node.researchReasons, []);
  assert.equal(report.complete, false);
  assert.equal(node.status, 'insufficient');
  assert.equal(node.resaleUsd, null);
});

test('a captured challenge finishes research with access gaps and no valuation', () => {
  const input = validInput();
  input.lots[0]!.research.capturedAttempts = [challengeAttempt()];
  const report = auditAuctionEvidence(input);
  assert.equal(report.researchComplete, true);
  assert.equal(report.nodes[0]!.researchStatus, 'complete-with-access-gaps');
  assert.deepEqual(report.nodes[0]!.researchReasons, ['sold-search-access-blocked']);
  assert.equal(report.complete, false);
  assert.equal(report.nodes[0]!.status, 'blocked');
  assert.equal(report.nodes[0]!.resaleReady, false);
  assert.equal(report.nodes[0]!.resaleUsd, null);
  assert.equal(report.nodes[0]!.maxBidUsd, null);
});

for (const defect of ['unattempted query', 'unattempted photo', 'invalid timestamp', 'unterminated page'] as const) {
  test(`a challenge cannot excuse an ${defect}`, () => {
    const input = validInput();
    const item = input.lots[0]!;
    const attempt = challengeAttempt();
    item.research.capturedAttempts = [attempt];
    assert.equal(auditAuctionEvidence(input).researchComplete, true);
    if (defect === 'unattempted query') item.research.plannedQueries = [query, 'Canon 5D'];
    else if (defect === 'unattempted photo') item.collection.descriptorOutcomes = [{ descriptorId: 'photo-1', status: 'unattempted' }];
    else if (defect === 'invalid timestamp') attempt.observedAt = '';
    else attempt.hasNextPage = true;
    const report = auditAuctionEvidence(input);
    assert.equal(report.researchComplete, false);
    assert.equal(report.nodes[0]!.researchStatus, 'incomplete');
    assert.equal(report.nodes[0]!.resaleUsd, null);
  });
}

test('a challenge on the final attempted page records a terminated search with access gaps', () => {
  const input = validInput();
  const first = input.lots[0]!.research.capturedAttempts[0]!;
  first.hasNextPage = true;
  first.pageLimit = 1;
  const final = challengeAttempt();
  final.sourceUrl += '&_pgn=2';
  final.pageOffset = 1;
  final.pageLimit = 1;
  input.lots[0]!.research.capturedAttempts = [first, final];
  const report = auditAuctionEvidence(input);
  assert.equal(report.researchComplete, true);
  assert.equal(report.nodes[0]!.researchStatus, 'complete-with-access-gaps');
  assert.equal(report.complete, false);
  assert.equal(report.nodes[0]!.resaleUsd, null);
});

for (const failure of ['parse-error', 'not-sold-context', 'more-pages'] as const) {
  test(`search ${failure} does not finish research even with a sufficient sample`, () => {
    const input = validInput();
    const attempt = input.lots[0]!.research.capturedAttempts[0]!;
    if (failure === 'more-pages') attempt.hasNextPage = true;
    else attempt.status = failure;
    const report = auditAuctionEvidence(input);
    assert.equal(report.researchComplete, false);
    assert.equal(report.nodes[0]!.researchStatus, 'incomplete');
    assert.equal(report.complete, false);
  });
}
