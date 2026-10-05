import assert from 'node:assert/strict';
import test from 'node:test';
import {
  verifyEbaySoldCompSet,
  type EbaySoldRecord,
  type EbaySoldSearchAttempt,
} from '../src/intelligence/ebay-sold-results.js';
import { extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';

const observedAt = '2026-10-03T12:00:00.000Z';
const sourceTitle = 'Alesis Midiverb II 16-bit Digital Multi-effects Rack Processor - Studio / Guitar';

function record(itemId: string, title: string): EbaySoldRecord {
  return {
    source: 'seller-hub-product-research',
    sourceUrl: 'https://www.ebay.com/sh/research?keywords=alesis&tabName=SOLD',
    observedAt,
    itemId,
    itemUrl: `https://www.ebay.com/itm/${itemId}`,
    title,
    imageUrl: null,
    soldPrice: { amount: 50, currency: 'USD' },
    shippingPrice: { amount: 10, currency: 'USD' },
    deliveredPrice: { amount: 60, currency: 'USD' },
    totalSold: 1,
    totalSales: { amount: 50, currency: 'USD' },
    soldAt: 'Sep 28, 2026',
    condition: 'Used',
    format: 'Fixed price',
    priceKind: 'actual',
    provenance: { kind: 'independent-sold-evidence', source: 'seller-hub-sold-record', itemId },
  };
}

function attempt(records: EbaySoldRecord[]): EbaySoldSearchAttempt {
  return {
    source: 'seller-hub-product-research',
    sourceUrl: 'https://www.ebay.com/sh/research?keywords=alesis&tabName=SOLD',
    query: 'alesis midiverb ii',
    observedAt,
    status: 'ok',
    records,
    hasNextPage: false,
    pageOffset: 0,
    pageLimit: 50,
    failureReason: null,
  };
}

function verify(title: string) {
  return verifyEbaySoldCompSet(extractProductIdentity(sourceTitle), [attempt([record('123456789001', title)])], {
    plannedQueries: ['alesis midiverb ii'],
    minimumSampleSize: 1,
  });
}

test('accepts the native Sold Midiverb II title with a negated power cord', () => {
  const result = verify('Vintage Rare Alesis Midiverb II 16-BIT Effects - NO Power Cord - Untested');
  assert.deepEqual(result.accepted.map((entry) => entry.title), [
    'Vintage Rare Alesis Midiverb II 16-BIT Effects - NO Power Cord - Untested',
  ]);
  assert.equal(result.rejected.length, 0);
});

test('keeps bare power cords and adapters, and manual-plus-cord-only rows, rejected', () => {
  for (const [itemId, title] of [
    ['123456789002', 'Alesis Midiverb II replacement power cord'],
    ['123456789003', 'Alesis Midiverb II power adapter'],
    ['123456789004', 'Alesis Midiverb II manual and power cord only'],
    ['123456789005', 'Alesis Midiverb II no manual and power cord only'],
    ['123456789006', 'Alesis Midiverb II no manual, power cord only'],
    ['123456789007', 'Alesis Midiverb II no manual power cord only'],
  ] as const) {
    const result = verifyEbaySoldCompSet(extractProductIdentity(sourceTitle), [attempt([record(itemId, title)])], {
      plannedQueries: ['alesis midiverb ii'],
      minimumSampleSize: 1,
    });
    assert.equal(result.accepted.length, 0, title);
    assert.ok(result.rejected[0]?.reasons.includes('accessory-or-component'), title);
  }
});

test('distinguishes whole units with, without, and no power cord wording', () => {
  const titles = [
    'Alesis Midiverb II Effects Processor with power cord',
    'Alesis Midiverb II Effects Processor without power cord',
    'Alesis Midiverb II Effects Processor - no power cord',
    'Alesis Midiverb II no AC power cord',
    'Alesis Midiverb II without the original AC power cord',
    'Alesis Midiverb II missing power cord',
    'Alesis Midiverb II power cord not included',
    'Alesis Midiverb II with power cord and adapter',
    'Alesis Midiverb II with manual and power cord',
    'Alesis Midiverb II power cord not provided',
    'Alesis Midiverb II power cord excluded',
    'Alesis Midiverb II power cord missing',
  ];
  for (const title of titles) {
    const result = verify(title);
    assert.equal(result.accepted.length, 1, title);
    assert.equal(result.rejected.length, 0, title);
  }
});
