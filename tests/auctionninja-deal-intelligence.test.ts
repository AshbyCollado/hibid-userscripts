import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { normalizeSettings } from '../src/core/settings.js';
import {
  auctionNinjaIdentitySignature,
  auctionNinjaMutationAffectedIds,
  auctionNinjaMutationChangesProducts,
  buildAuctionNinjaAnalysis,
  calculateAuctionNinjaAllIn,
  parseAuctionNinjaBuyerPremium,
  renderAuctionNinjaCardAnnotation,
} from '../src/content/auctionninja-deal-intelligence.js';

test('AuctionNinja premium and all-in helpers use current bid, premium, and tax', () => {
  assert.equal(parseAuctionNinjaBuyerPremium("Buyer's Premium 15%"), 15);
  assert.equal(parseAuctionNinjaBuyerPremium('none'), null);
  const allIn = calculateAuctionNinjaAllIn(100, 15, { stateCode: 'NJ', taxPctOverride: 10, taxExempt: false, taxOnPremium: true });
  assert.equal(allIn?.hammer, 100);
  assert.equal(allIn?.premium, 15);
  assert.equal(allIn?.tax, 11.5);
  assert.equal(allIn?.total, 126.5);
});

test('AuctionNinja analysis reuses shared condition, quantity, identity, and saved resale math', () => {
  const record = buildAuctionNinjaAnalysis({
    id: '1001', stableId: '1001', title: 'Sony WH-1000XM5 headphones lot of 2',
    description: 'Condition: Used - Very Good\nMissing Parts?: No',
    descriptionFields: { condition: 'Used - Very Good', missingParts: 'No' },
    rawText: 'Current Bid: $40.00 Buyer\'s Premium 15%', currentBid: 40, buyerPremium: '15%',
  }, { settings: normalizeSettings({ stateCode: 'NJ', taxPctOverride: 0, taxExempt: true, taxOnPremium: true, ebayFeePct: 10, ebayFeeFixedCents: 30 }), state: { resaleEstimate: 180 } });
  assert.equal(record.needsQuantity, true);
  assert.equal(record.allIn?.total, 46);
  assert.equal(record.state.resaleEstimate, 180);
  assert.equal(record.condition.condition, 'Used - Very Good');
  assert.equal(record.ebayNet, 161.7);
});

test('card annotations are additive, idempotent, linked, and accessible', () => {
  const dom = new JSDOM('<article class="search-catalog-item-box"><a href="https://www.auctionninja.com/seller/product/headphones--1001.html">Lot # 1 Headphones</a><button>Bid Now</button></article>');
  const card = dom.window.document.querySelector('article')!;
  const record = buildAuctionNinjaAnalysis({ id: '1001', stableId: '1001', title: 'Headphones', description: 'Condition: New - Factory Sealed', rawText: 'Current Bid: $10.00', currentBid: 10, buyerPremium: '15%' });
  renderAuctionNinjaCardAnnotation(card, record);
  renderAuctionNinjaCardAnnotation(card, record);
  assert.equal(card.querySelectorAll('[data-flippah-owned="true"]').length, 1);
  assert.equal(card.querySelectorAll('button').length, 1);
  assert.match(card.textContent || '', /Amazon/);
  assert.match(card.textContent || '', /eBay Sold \+ Completed/);
  assert.match(card.textContent || '', /All-in/);
  assert.equal(card.querySelector('.flippah-an-pill.amazon')?.getAttribute('target'), '_blank');
  assert.ok(card.querySelector('.flippah-an-pill')?.getAttribute('aria-label'));
});

test('identity signatures and mutation filtering ignore Flippah-owned DOM', () => {
  assert.equal(auctionNinjaIdentitySignature([{ id: '2', url: '/b', title: 'B' }, { id: '1', url: '/a', title: 'A' }]), '1~/a~A|2~/b~B');
  const dom = new JSDOM('<article class="item-box"><a href="/seller/product/item--77.html">Item</a></article>');
  const card = dom.window.document.querySelector('article')!;
  const observer = new dom.window.MutationObserver(() => undefined);
  observer.observe(card, { childList: true, subtree: true });
  const owned = dom.window.document.createElement('div'); owned.dataset.flippahOwned = 'true'; card.append(owned);
  assert.deepEqual(auctionNinjaMutationAffectedIds(observer.takeRecords() as unknown as MutationRecord[]), []);
  const native = dom.window.document.createElement('span'); native.textContent = 'new bid'; card.append(native);
  const timerRecords = observer.takeRecords() as unknown as MutationRecord[];
  assert.deepEqual(auctionNinjaMutationAffectedIds(timerRecords), ['77']);
  assert.equal(auctionNinjaMutationChangesProducts(timerRecords), false);
  const second = dom.window.document.createElement('article');
  second.className = 'item-box'; second.innerHTML = '<a href="/seller/product/second--88.html">Second</a>';
  card.append(second);
  assert.equal(auctionNinjaMutationChangesProducts(observer.takeRecords() as unknown as MutationRecord[]), true);
  observer.disconnect();
});
