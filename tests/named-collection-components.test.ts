import assert from 'node:assert/strict';
import test from 'node:test';
import { detectMixedLot } from '../src/intelligence/us-deal-intelligence.js';
import { buildAuctionNinjaResearchQueue } from '../src/auctionninja/exports.js';
import type { AuctionNinjaLotRecord } from '../src/auctionninja/types.js';

const title = '3 Vintage Perfume Bottles - Dior Diorissimo (Never Opened), Coty Muguet (95% Full), Dana Emir';

test('three distinct perfume products require component research, not one retail match', () => {
  const mixed = detectMixedLot(title);
  assert.equal(mixed.mixed, true);
  assert.ok(mixed.reasons.includes('collection lists distinct named products'));
  for (const component of ['Dior Diorissimo (Never Opened)', 'Coty Muguet (95% Full)', 'Dana Emir']) {
    assert.ok(mixed.components.includes(component), component);
  }
});

test('AuctionNinja exports the reproduced estate perfume case as component review', () => {
  const record = {
    source: 'AuctionNinja', pageKind: 'sale-catalog', id: '4587960', stableId: '4587960', lot: '50', title,
    url: 'https://www.auctionninja.com/provenanceauctions/product/perfumes-4587960.html',
    description: '3 Vintage Perfume Bottles. With Boxes. Includes a Dior Diorissimo (Never Opened/Factory Sealed), Coty Muguet (95% Full), and Dana Emir.',
    images: [], descriptionFields: {},
  } as AuctionNinjaLotRecord;
  const [row] = buildAuctionNinjaResearchQueue([record]);
  assert.equal(row?.mode, 'component-review');
  assert.ok(row?.components.includes('Dana Emir'));
});

for (const value of [
  '2 Cameras - Canon EOS R6, Nikon D750',
  'Set of 3 Tools: Makita XPH12; Milwaukee M18 Drill; DeWalt DCD791',
  'Three Perfume Bottles - Dior Diorissimo (Opened, box included), Coty Muguet, and Dana Emir',
  '2 Lenses - Canon EF 50mm (fits Canon EOS), Nikon 50mm',
]) test(`named collection: ${value}`, () => {
  assert.equal(detectMixedLot(value).mixed, true);
});

for (const value of [
  '3 Dior Diorissimo Perfume Bottles',
  '3 Perfume Bottles - Dior Diorissimo, Dior Diorissimo, DIOR DIORISSIMO',
  '2 Plastic Bottles - White, 32 oz',
  '2 Bottles - BPA Free, Dishwasher Safe',
  'Set of 2 Bottles - Wide Neck, Leak Proof',
  '24 Pack Record Sleeves',
  '3-Port USB Hub - HDMI, USB A, USB C',
  'Sony Headphones - Bluetooth, Noise Cancelling',
  '2 Cameras - Canon EOS R6 (Box, Nikon D750',
  '2 Cameras - Canon EOS R6), Nikon D750',
  '2 Cameras - Night Vision, Motion Detection',
  '2 Lenses - Compatible with Canon EOS, Nikon DSLR',
  '2 Lenses - Compatible with Canon EOS, Nikon DSLR, Sony Alpha',
  '3 Perfume Bottles - Dior Diorissimo (New), Dior Diorissimo (Sealed), Dior Diorissimo (Unopened)',
  '2 Cameras - Canon EOS R6 (Used (box included)), Canon EOS R6 (New)',
  '2 Cameras - Full HD, Weather Resistant',
]) test(`not a distinct named collection: ${value}`, () => {
  assert.equal(detectMixedLot(value).mixed, false);
});
