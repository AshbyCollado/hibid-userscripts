import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { normalizeSettings } from '../src/core/settings.js';
import { buildConditionPresentation } from '../src/intelligence/us-deal-intelligence.js';
import {
  auctionNinjaIdentitySignature,
  auctionNinjaConditionInput,
  auctionNinjaMutationAffectedIds,
  auctionNinjaMutationChangesProducts,
  buildAuctionNinjaAnalysis,
  calculateAuctionNinjaAllIn,
  parseAuctionNinjaBuyerPremium,
  renderAuctionNinjaCardAnnotation,
  renderAuctionNinjaDetailPanel,
  resolveAuctionNinjaDetailPanelMount,
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

test('AuctionNinja title condition wins only when the detail has no structured condition', () => {
  assert.match(auctionNinjaConditionInput('Brand New Coffee Maker New In Box', 'Seller boilerplate says items are used'), /^Condition: New\n/);
  assert.match(auctionNinjaConditionInput('Oster Toaster Used, Not Tested', ''), /^Condition: Used\n/);
  assert.equal(auctionNinjaConditionInput('Brand New Coffee Maker', 'Condition: Used - Good'), 'Condition: Used - Good');

  const newRecord = buildAuctionNinjaAnalysis({ id: '1', title: 'Brand New Coffee Maker New In Box', description: 'All property is sold used' });
  assert.equal(buildConditionPresentation(newRecord.condition).label, 'New');
  const usedRecord = buildAuctionNinjaAnalysis({ id: '2', title: 'Oster Toaster Used, Not Tested', description: '' });
  assert.equal(buildConditionPresentation(usedRecord.condition).label, 'Used · untested');
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
  assert.match(card.textContent || '', /eBay/);
  assert.match(card.textContent || '', /All-in/);
  assert.equal(card.querySelector('.flippah-an-pill.amazon')?.getAttribute('target'), '_blank');
  const ebayHref = card.querySelector<HTMLAnchorElement>('.flippah-an-pill.ebay')?.href || '';
  assert.match(ebayHref, /LH_Sold=1/);
  assert.match(ebayHref, /LH_Complete=1/);
  assert.ok(card.querySelector('.flippah-an-pill')?.getAttribute('aria-label'));
});

test('detail panel mounts in the native item sidebar and keeps manual fields collapsed', () => {
  const dom = new JSDOM(`
    <main class="item-detail-box-main">
      <section class="item-detail-box-left">Photos</section>
      <aside class="item-detail-box-right">
        <h1 class="item-detail-box-title">Logitech S150 USB Stereo Speakers</h1>
        <div class="item-detail-btn"><button>Bid Now</button></div>
        <div class="responsive-hide-pickup">Pickup</div>
      </aside>
    </main>
  `);
  const doc = dom.window.document;
  const mount = resolveAuctionNinjaDetailPanelMount(doc);
  assert.equal(mount.host.className, 'item-detail-box-right');
  assert.equal(mount.anchor?.className, 'item-detail-btn');

  const record = buildAuctionNinjaAnalysis({
    id: '201707', stableId: '201707', title: 'Logitech S150 USB Stereo Speakers',
    description: 'Condition: New', rawText: 'Starting Bid $2.00', currentBid: 2, buyerPremium: '18%',
  }, { settings: normalizeSettings({ taxExempt: true }) });
  const panel = renderAuctionNinjaDetailPanel(record, () => undefined, doc);
  assert.ok(panel);
  assert.equal(panel?.parentElement?.className, 'item-detail-box-right');
  assert.equal(panel?.previousElementSibling?.className, 'item-detail-btn');
  assert.equal(panel?.querySelectorAll('.row').length, 0);
  assert.equal(panel?.querySelector('details')?.hasAttribute('open'), false);
  assert.match(panel?.textContent || '', /FlippahDeal checkAll-in \$2\.36/);
  assert.match(panel?.textContent || '', /Amazon/);
  assert.match(panel?.textContent || '', /eBay Sold/);
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
