import assert from 'node:assert/strict';
import test from 'node:test';
import {
  verifyEbaySoldCompSet,
  type EbaySoldRecord,
} from '../src/intelligence/ebay-sold-results.js';
import { extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';

const observedAt = '2026-10-01T13:35:38.222Z';

function verifyTitles(sourceTitle: string, candidateTitles: readonly string[]) {
  const identity = extractProductIdentity(sourceTitle);
  const query = identity.query || sourceTitle;
  const records: EbaySoldRecord[] = candidateTitles.map((title, index) => {
    const itemId = String(306573690133 + index);
    return {
      source: 'seller-hub-product-research',
      sourceUrl: `https://www.ebay.com/sh/research?keywords=${encodeURIComponent(query)}&tabName=SOLD`,
      observedAt,
      itemId,
      itemUrl: `https://www.ebay.com/itm/${itemId}`,
      title,
      imageUrl: null,
      soldPrice: { amount: index ? 125 : 14.99, currency: 'USD' },
      shippingPrice: { amount: 0, currency: 'USD' },
      deliveredPrice: { amount: index ? 125 : 14.99, currency: 'USD' },
      totalSold: 1,
      totalSales: { amount: index ? 125 : 14.99, currency: 'USD' },
      soldAt: 'Jul 9, 2026',
      condition: null,
      format: 'Fixed price',
      priceKind: 'actual',
      provenance: { kind: 'independent-sold-evidence', source: 'seller-hub-sold-record', itemId },
    };
  });
  return verifyEbaySoldCompSet(identity, [{
    source: 'seller-hub-product-research',
    sourceUrl: `https://www.ebay.com/sh/research?keywords=${encodeURIComponent(query)}&tabName=SOLD`,
    query,
    observedAt,
    status: 'ok',
    records,
    hasNextPage: false,
    pageOffset: 0,
    pageLimit: 50,
    failureReason: null,
  }], { plannedQueries: [query], minimumSampleSize: 1, sourceQuantity: 1 });
}

function acceptedTitles(sourceTitle: string, candidates: readonly string[]): string[] {
  return verifyTitles(sourceTitle, candidates).accepted.map((record) => record.title);
}

test('captured M292 retail storage box sold row is rejected without changing sold math', () => {
  const source = 'MXR M292 Carbon Copy Deluxe Analog Delay Pedal';
  const packaging = 'MXR M292 Carbon Copy Deluxe RETAIL STORAGE BOX ONLY W/MANUALS';
  const complete = 'MXR M292 Carbon Copy Deluxe Analog Delay Pedal';
  const result = verifyTitles(source, [packaging, complete]);

  assert.deepEqual(acceptedTitles(source, [packaging, complete]), [complete]);
  assert.equal(result.statistics.sampleSize, 1);
  assert.equal(result.rejected.find((row) => row.title === packaging)?.itemId, '306573690133');
  assert.ok(result.rejected.find((row) => row.title === packaging)?.reasons.includes('accessory-or-component'));
});

test('plural and suffix packaging, manuals, and exact-model accessories are rejected', () => {
  const candidates = [
    'MXR M292 Carbon Copy Deluxe RETAIL STORAGE BOXES ONLY',
    'MXR M292 Carbon Copy Deluxe empty carton only',
    'MXR M292 Carbon Copy Deluxe instruction manuals only',
    'MXR M292 replacement power supply',
  ];
  assert.deepEqual(
    acceptedTitles('MXR M292 Carbon Copy Deluxe Analog Delay Pedal', candidates),
    [],
  );
});

test('complete products with box or manuals and explicit not-box-only wording remain eligible', () => {
  const candidates = [
    'MXR M292 Carbon Copy Deluxe Analog Delay Pedal with original box and manuals',
    'MXR M292 Carbon Copy Deluxe Analog Delay Pedal - not box only',
  ];
  assert.deepEqual(
    acceptedTitles('MXR M292 Carbon Copy Deluxe Analog Delay Pedal', candidates),
    candidates,
  );
});

test('standalone packaging can still match standalone packaging', () => {
  const source = 'MXR M292 Carbon Copy Deluxe retail storage box only';
  const candidate = 'MXR M292 Carbon Copy Deluxe original box only';
  assert.deepEqual(acceptedTitles(source, [candidate]), [candidate]);
});

test('component subjects reject whole-product mismatches in either direction', () => {
  const source = 'MXR M292 Carbon Copy Deluxe Analog Delay Pedal with manuals and replacement power supply';
  const candidates = [
    'MXR M292 Carbon Copy Deluxe RETAIL STORAGE BOX ONLY',
    'MXR M292 replacement power supply',
    'MXR M292 Analog Delay Pedal power supply only',
  ];
  assert.deepEqual(acceptedTitles(source, candidates), []);
  assert.deepEqual(
    acceptedTitles('MXR M292 Carbon Copy Deluxe instruction manuals only', [source]),
    [],
  );
});

test('whole pedal with box remains eligible and component-only wording is subject-scoped', () => {
  const source = 'MXR M292 Carbon Copy Deluxe Analog Delay Pedal';
  const candidates = [
    'MXR M292 Carbon Copy Deluxe Analog Delay Pedal with original box',
    'MXR M292 Carbon Copy Deluxe Analog Delay Pedal - only used twice',
    'MXR M292 Carbon Copy Deluxe instruction manuals only',
  ];
  assert.deepEqual(acceptedTitles(source, candidates), candidates.slice(0, 2));
  assert.deepEqual(
    acceptedTitles('MXR M292 Carbon Copy Deluxe instruction manuals only', [
      'MXR M292 Carbon Copy Deluxe manuals only',
    ]),
    ['MXR M292 Carbon Copy Deluxe manuals only'],
  );
});

test('whole blender rejects standalone cup and replacement base rows', () => {
  const source = 'Ninja Blast Max Cordless Blender BC251NV';
  assert.deepEqual(acceptedTitles(source, [
    'Ninja Blast Max Cordless Blender BC251NV Cup Only',
    'Ninja Blast Max Replacement Motor Base Unit BC251NV',
  ]), []);
  assert.deepEqual(acceptedTitles('Ninja Blast Max Cordless Blender BC251NV Cup Only', [
    'Ninja Blast Max Cordless Blender BC251NV Cup Only',
  ]), ['Ninja Blast Max Cordless Blender BC251NV Cup Only']);
  assert.deepEqual(acceptedTitles('Ninja Blast Max Replacement Motor Base Unit BC251NV', [
    'Ninja Blast Max Replacement Motor Base Unit BC251NV',
  ]), ['Ninja Blast Max Replacement Motor Base Unit BC251NV']);
});

test('box-only assertion survives an unrelated pedal-not-included suffix', () => {
  const source = 'MXR M292 Carbon Copy Deluxe Analog Delay Pedal';
  const packaging = 'MXR M292 Carbon Copy Deluxe RETAIL STORAGE BOX ONLY - pedal not included';
  assert.deepEqual(acceptedTitles(source, [packaging]), []);
  assert.deepEqual(acceptedTitles(packaging, [source]), []);
});

test('complete products retain included components plus adjacent usage qualifiers', () => {
  const source = 'MXR M292 Carbon Copy Deluxe Analog Delay Pedal';
  const candidates = [
    `${source} with box - only used twice`,
    `${source} with original box - only used twice`,
    `${source} with manuals - only used twice`,
    `${source} - not manuals only`,
  ];
  assert.deepEqual(acceptedTitles(source, candidates), candidates);
  const ninja = 'Ninja Blast Max Cordless Blender BC251NV';
  assert.deepEqual(acceptedTitles(ninja, [`${ninja} with original cup - only used twice`]), [`${ninja} with original cup - only used twice`]);
});

test('motor base subjects without unit and explicit base-only titles reject both directions', () => {
  const source = 'Ninja Blast Max Cordless Blender BC251NV';
  for (const component of [
    'Ninja Blast Max Replacement Motor Base BC251NV',
    `${source} Motor Base Only`,
    `${source} without cup Replacement Motor Base Unit`,
    `${source} without lid Cup Only`,
  ]) {
    assert.deepEqual(acceptedTitles(source, [component]), [], component);
    assert.deepEqual(acceptedTitles(component, [source]), [], component);
    assert.deepEqual(acceptedTitles(component, [component]), [component]);
  }
});

test('reprinted receiver user guide is not the receiver', () => {
  const source = 'Yamaha RX-V661 Natural Sound Receiver';
  const guide = 'Yamaha RX-V661 User Guide Reprint Manual COIL BOUND';
  assert.deepEqual(acceptedTitles(source, [guide]), []);
  assert.deepEqual(acceptedTitles(guide, [source]), []);
});

test('included accessories remain whole products without an explicit product noun', () => {
  const source = 'MXR M292 Carbon Copy Deluxe';
  const complete = `${source} with manuals - only used twice`;
  assert.deepEqual(acceptedTitles(source, [complete]), [complete]);
  assert.deepEqual(acceptedTitles(complete, [source]), [source]);
});

test('inclusion scope supports punctuation and bounded natural modifiers', () => {
  const source = 'MXR M292 Carbon Copy Deluxe Analog Delay Pedal';
  for (const complete of [
    `${source} includes a new replacement power supply`,
    `${source} includes: replacement power supply`,
    `${source} with the original replacement power supply`,
  ]) {
    assert.deepEqual(acceptedTitles(source, [complete]), [complete]);
    assert.deepEqual(acceptedTitles(complete, [source]), [source], complete);
  }
});

test('coordinated component-only packaging rejects whole-product prices', () => {
  const source = 'MXR M292 Carbon Copy Deluxe Analog Delay Pedal';
  for (const component of [
    'MXR M292 Carbon Copy Deluxe box and manuals only',
    'MXR M292 Carbon Copy Deluxe manuals and box only',
    'MXR M292 Carbon Copy Deluxe BOX / ONLY',
  ]) {
    assert.deepEqual(acceptedTitles(source, [component]), []);
    assert.deepEqual(acceptedTitles(component, [source]), []);
  }
  const ninja = 'Ninja Blast Max Cordless Blender BC251NV';
  assert.deepEqual(acceptedTitles(ninja, [`${ninja} Cup / Only`]), []);
  assert.deepEqual(acceptedTitles(`${ninja} Cup / Only`, [ninja]), []);
});

test('fallback component scope preserves modifiers, no-parts and coordinated inclusions', () => {
  const source = 'MXR M292 Carbon Copy Deluxe';
  for (const complete of [
    `${source} includes: new replacement power supply`,
    `${source} with box & manuals - only used twice`,
    `${source} no manuals`,
  ]) {
    assert.deepEqual(acceptedTitles(source, [complete]), [complete]);
    const reverse = verifyTitles(complete, [source]);
    assert.ok(!reverse.rejected.some((row) => row.reasons.includes('accessory-or-component')), complete);
  }
  const missingSupply = `${source} without replacement power supply`;
  for (const result of [verifyTitles(source, [missingSupply]), verifyTitles(missingSupply, [source])]) {
    assert.equal(result.accepted.length, 0);
    assert.ok(result.rejected[0]!.reasons.includes('condition-mismatch:missing-major-component:power supply'));
    assert.ok(!result.rejected[0]!.reasons.includes('accessory-or-component'));
  }
  const packaging = `${source} box & manuals only`;
  assert.deepEqual(acceptedTitles(source, [packaging]), []);
  assert.deepEqual(acceptedTitles(packaging, [source]), []);
});
