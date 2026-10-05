import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateRetailCandidate,
  extractProductIdentity,
  looksLikeModel,
} from '../src/intelligence/us-deal-intelligence.js';
import { verifyEbaySoldCompSet, type EbaySoldRecord, type EbaySoldSearchAttempt } from '../src/intelligence/ebay-sold-results.js';

const observedAt = '2026-09-22T12:00:00.000Z';

function soldRecord(itemId: string, title: string): EbaySoldRecord {
  return {
    source: 'seller-hub-product-research',
    sourceUrl: 'https://www.ebay.com/sh/research?keywords=test&tabName=SOLD',
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
    soldAt: 'Sep 20, 2026',
    condition: 'Used',
    format: 'Fixed price',
    priceKind: 'actual',
    provenance: { kind: 'independent-sold-evidence', source: 'seller-hub-sold-record', itemId },
  };
}

function soldAttempt(query: string, records: EbaySoldRecord[]): EbaySoldSearchAttempt {
  return {
    source: 'seller-hub-product-research',
    sourceUrl: 'https://www.ebay.com/sh/research?keywords=test&tabName=SOLD',
    query,
    observedAt,
    status: 'ok',
    records,
    hasNextPage: false,
    pageOffset: 0,
    pageLimit: 50,
    failureReason: null,
  };
}

test('title-only identity guards the GMBK/GMMK split before description enrichment', () => {
  const product = extractProductIdentity('Glorious GMBK 75% Keyboard with MX-Keycaps');

  assert.equal(product.model, 'GMBK');
  assert.equal(evaluateRetailCandidate('Glorious GMBK 75% Keyboard with MX-Keycaps', product).accepted, true);
  const corrected = evaluateRetailCandidate('Glorious GMMK 3 75% Keyboard with MX-Keycaps', product);
  assert.equal(corrected.accepted, false);
  assert.match(corrected.rejectionReasons.join(' '), /model-mismatch:GMBK/);
});

test('an explicit spaced model in the full description remains a hard identity', () => {
  const product = extractProductIdentity({
    title: 'Glorious GMBK 75% Keyboard with MX-Keycaps',
    description: 'Brand: Glorious\nModel: GMBK 75%',
  });

  assert.equal(product.model, 'GMBK 75%');
  assert.equal(evaluateRetailCandidate('Glorious GMBK 75% Keyboard with MX-Keycaps', product).accepted, true);
  assert.equal(evaluateRetailCandidate('Glorious GMMK 3 75% Keyboard with MX-Keycaps', product).accepted, false);
});

test('alphabetic model matching is case-insensitive and tolerates compact title formatting', () => {
  const product = extractProductIdentity('Glorious GMBK75% Keyboard');

  assert.equal(product.model, 'GMBK75');
  assert.equal(evaluateRetailCandidate('glorious gmbk 75% keyboard', product).accepted, true);
  assert.equal(evaluateRetailCandidate('Glorious GMMK 3 75% Keyboard', product).accepted, false);
});

test('uppercase feature controls are not inferred as alphabetic models', () => {
  for (const value of ['USB', 'RGB', 'LED', 'HDMI', 'PRO', 'MAX']) assert.equal(looksLikeModel(value), false, value);
  assert.equal(extractProductIdentity('Glorious USB RGB LED Gaming Keyboard').model, null);
});

test('alternate all-alpha product lines get an identity guard without changing numeric models', () => {
  const alternate = extractProductIdentity('Acme ZXCV Wireless Keyboard');
  assert.equal(alternate.model, null);
  assert.equal(evaluateRetailCandidate('Acme ZXCV Wireless Keyboard', alternate).accepted, true);
  assert.equal(evaluateRetailCandidate('Acme QWER Wireless Keyboard', alternate).accepted, true);

  const numeric = extractProductIdentity('Logitech M100 Optical Mouse 1200DPI');
  assert.equal(numeric.model, 'M100');
  assert.equal(evaluateRetailCandidate('Logitech M100 USB Optical Mouse', numeric).accepted, true);
});

test('generic all-caps family words do not become hard models or erase series identity', () => {
  const iphone = extractProductIdentity('Apple IPHONE 13 Smartphone');
  assert.equal(iphone.model, null);
  assert.deepEqual(iphone.discriminators.seriesSignatures, ['iphone:13']);

  const generic = extractProductIdentity('Generic WIRELESS Keyboard');
  assert.equal(generic.model, null);
  const query = 'generic wireless keyboard';
  const result = verifyEbaySoldCompSet(generic, [soldAttempt(query, [
    soldRecord('100000021', 'Generic Wireless Keyboard'),
  ])], { plannedQueries: [query], minimumSampleSize: 1 });
  assert.equal(result.marketValueReady, false);
  assert.deepEqual(result.accepted, []);
  assert.match(result.rejected[0]?.reasons.join(' ') || '', /insufficient-source-identity/);
  assert.doesNotMatch(result.rejected[0]?.reasons.join(' ') || '', /model-mismatch:WIRELESS/);
});

test('known Glorious alphabetic families are case-insensitive and reject the GMMK family', () => {
  for (const spelling of ['gmbk', 'Gmbk', 'GMBK']) {
    const product = extractProductIdentity(`Glorious ${spelling} 75% Keyboard`);
    assert.equal(product.model, 'GMBK', spelling);
    assert.equal(evaluateRetailCandidate('Glorious GMMK 3 75% Keyboard', product).accepted, false, spelling);
  }
});

test('series discriminator blocks iPhone 14 sold comps for an iPhone 13 source and remains market-ready with iPhone 13 comps', () => {
  const product = extractProductIdentity('Apple IPHONE 13 Smartphone');
  const query = 'apple iphone 13 smartphone';
  const result = verifyEbaySoldCompSet(product, [soldAttempt(query, [
    soldRecord('100000013', 'Apple iPhone 13 Smartphone'),
    soldRecord('100000014', 'Apple iPhone 14 Smartphone'),
  ])], { plannedQueries: [query], minimumSampleSize: 1 });

  assert.equal(result.marketValueReady, true);
  assert.deepEqual(result.accepted.map((record) => record.itemId), ['100000013']);
  assert.equal(result.rejected.find((record) => record.itemId === '100000014')?.reasons.some((reason) => /seriesSignatures|iphone:13/i.test(reason)), true);
});

test('known alphabetic Glorious family remains a hard sold-comp identity for every source casing', () => {
  for (const spelling of ['gmbk', 'Gmbk', 'GMBK']) {
    const product = extractProductIdentity(`Glorious ${spelling} 75% Keyboard`);
    const query = `glorious ${spelling.toLowerCase()} 75 keyboard`;
    const result = verifyEbaySoldCompSet(product, [soldAttempt(query, [
      soldRecord(`1000000${spelling.length}1`, 'Glorious GMBK 75% Keyboard'),
      soldRecord(`1000000${spelling.length}2`, 'Glorious GMMK 3 75% Keyboard'),
    ])], { plannedQueries: [query], minimumSampleSize: 1 });
    assert.deepEqual(result.accepted.map((record) => record.itemId), [`1000000${spelling.length}1`], spelling);
    assert.equal(result.rejected.some((record) => record.itemId === `1000000${spelling.length}2`), true, spelling);
  }
});
