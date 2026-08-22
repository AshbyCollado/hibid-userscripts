import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildEbaySoldQuery, patchLegacyEbayQueryModule, patchLegacyHibidPageModule, patchLegacyRemoveShipping } from '../scripts/legacy-ebay-query.mjs';

test('eBay query preserves the complete Onkyo model and product type', () => {
  assert.equal(
    buildEbaySoldQuery('Onkyo TX-SR304 Multi-Channel AV Receiver'),
    'onkyo tx sr304 multi channel av receiver'
  );
});

test('eBay query removes auction noise without dropping identifying edge cases', () => {
  assert.equal(
    buildEbaySoldQuery('Lot #6 | Group of 3 - Apple MacBook Pro (A2338) 13 inch - Untested'),
    'apple macbook pro a2338'
  );
  assert.equal(
    buildEbaySoldQuery('Lot 12: Sony STR-DH790 7.2-Channel Dolby Atmos AV Receiver'),
    'sony str dh790 7.2 channel dolby atmos av receiver'
  );
});

test('eBay query uses a word-boundary character cap instead of dropping trailing identity tokens', () => {
  const query = buildEbaySoldQuery(
    'Pioneer Elite VSX-LX305 9.2 Channel Network AV Receiver Dolby Atmos Bluetooth WiFi Black With Remote Tested Working'
  );
  assert.ok(query.length <= 120);
  assert.match(query, /receiver/);
  assert.doesNotMatch(query, /working/);
  assert.ok(query.split(' ').length > 6);
});

test('legacy calculator bundle receives the maintained eBay query builder', async () => {
  const source = await readFile('reference-build/flippah-v0.1.0/assets/index.ts-BuCXDImd.js', 'utf8');
  const patched = patchLegacyEbayQueryModule(source);
  assert.match(patched, /function w\(title\)/);
  assert.doesNotMatch(patched, /slice\(0,6\)/);
  assert.match(patched, /query\.length > 120/);
});

test('legacy calculator build patch removes shipping UI and ignores persisted shipping costs', async () => {
  const source = await readFile('reference-build/flippah-v0.1.0/assets/index.ts-BuCXDImd.js', 'utf8');
  const patched = patchLegacyRemoveShipping(source);
  assert.doesNotMatch(patched, /<label for="lotlens-shipping">Shipping<\/label>/);
  assert.doesNotMatch(patched, /shipCents:i\.shipCents|shipCents:wi\.shipCents|Budget is below shipping/);
  assert.match(patched, /shipCents:0/);
});

test('legacy lot parser recognizes closed-lot Price Realized amounts without waiting for degraded timeout', () => {
  const source = 'currentBid:[`app-lot-details-subpanel .lot-high-bid`,`.lot-high-bid`,`.live-catalog-high-bid-status-default.lot-bid-container`]';
  const patched = patchLegacyHibidPageModule(source);
  assert.match(patched, /\.lot-price-realized-container/);
});
