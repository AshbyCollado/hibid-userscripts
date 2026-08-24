import assert from 'node:assert/strict';
import test from 'node:test';
import { auditHibidRecordFidelity } from '../src/hibid/fidelity.js';
import type { HiBidLotRecord } from '../src/core/types.js';

function lot(id: string, patch: Partial<HiBidLotRecord> = {}): HiBidLotRecord {
  return {
    source: 'hibid-api', pageKind: 'catalog', id, eventItemId: id, itemId: id, lot: id,
    title: `Lot ${id}`, lead: `Lot ${id}`, url: `https://hibid.com/lot/${id}/lot-${id}`,
    image: `https://media.sandhills.com/${id}.jpg`, images: [`https://media.sandhills.com/${id}.jpg`],
    description: `Description ${id}`, descriptionHtml: `<p>Description ${id}</p>`,
    category: 'Electronics', categories: ['Electronics'], currentBid: 10, nextBid: 12,
    bidCount: 1, status: 'OPEN', timeLeft: '1h', quantity: 1, shippingOffered: false,
    auctionId: '99', auctionTitle: 'Auction', location: 'New Jersey', buyerPremium: '15%', rawText: '',
    ...patch,
  };
}

test('record fidelity reports field-level coverage without weakening exact ID coverage', () => {
  const audit = auditHibidRecordFidelity([
    lot('1'),
    lot('2', { description: '', descriptionHtml: '', image: '', images: [], category: '', categories: [], currentBid: null, nextBid: null }),
  ]);
  assert.equal(audit.coreComplete, true);
  assert.equal(audit.metrics.identity.percent, 100);
  assert.equal(audit.metrics.description.percent, 50);
  assert.equal(audit.metrics.images.percent, 50);
  assert.equal(audit.metrics.category.percent, 50);
  assert.equal(audit.metrics.pricing.percent, 50);
  assert.deepEqual(audit.metrics.description.missingIds, ['2']);
  assert.equal(audit.score, 75);
});

test('an empty verified result has complete empty fidelity', () => {
  const audit = auditHibidRecordFidelity([]);
  assert.equal(audit.coreComplete, true);
  assert.equal(audit.score, 100);
  assert.ok(Object.values(audit.metrics).every((metric) => metric.percent === 100));
});
