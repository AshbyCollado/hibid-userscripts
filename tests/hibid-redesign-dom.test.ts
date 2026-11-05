import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import {
  getHibidCostAnchor,
  getHibidLotRoots,
  getHibidResearchMount,
  readHibidLotDom,
} from '../src/hibid/dom-adapter.js';
import { extractHiBidPageState, extractHiBidVisibleLots, extractHibidLotDetail } from '../src/hibid/dom.js';

function dom(body: string): Document {
  return new JSDOM(`<body>${body}</body>`, { url: 'https://hibid.com/catalog/42' }).window.document;
}

test('reads redesign tile identity, current/next bids, watch state, and quantity', () => {
  const document = dom(`
    <div class="lot-tile lot-card" id="lot-802">
      <app-auction-lot-card><div class="app-auction-lot-card">
        <div class="app-auction-lot-card__identity"><a class="app-auction-lot-card__lot-number">Lot 802av</a><a class="app-auction-lot-card__title">Canon camera</a></div>
        <div class="app-auction-lot-card__meta-money"><span class="app-auction-lot-card__amount">$3.00 x6</span><span class="app-auction-lot-card__currency-code">USD</span></div>
        <div class="app-auction-lot-card__lot-bid-history">2 bids</div>
        <div class="app-auction-lot-card__footer"><app-button><button class="app-button"><span class="app-button__label">Bid 4.00 USD</span></button></app-button></div>
        <button class="app-watch-star" aria-pressed="true" aria-label="Unwatch"></button>
      </div></app-auction-lot-card>
    </div>`);
  const root = getHibidLotRoots(document)[0]!;
  const observation = readHibidLotDom(root)!;
  assert.equal(observation.id, '802');
  assert.equal(observation.lot, '802av');
  assert.equal(observation.title, 'Canon camera');
  assert.deepEqual(observation.current, { amount: 3, currency: 'USD', quantity: 6 });
  assert.deepEqual(observation.next, { amount: 4, currency: 'USD', quantity: 6 });
  assert.equal(observation.quantity, 6);
  assert.equal(observation.bidMultiplier, 6);
  assert.equal(observation.watched, true);
  assert.equal(getHibidCostAnchor(root)?.className, 'app-auction-lot-card__footer');
});

test('mounts redesign research before the direct info child', () => {
  const document = dom('<div class="lot-tile lot-card" id="lot-804"><div class="app-auction-lot-card"><div class="app-auction-lot-card__content"><div class="app-auction-lot-card__identity"><a class="app-auction-lot-card__lot-number">Lot 804</a><a class="app-auction-lot-card__title">Receiver</a></div><div class="app-auction-lot-card__info">Bid information</div></div><div class="app-auction-lot-card__footer"><a class="app-button">View Lot</a></div></div></div>');
  const root = getHibidLotRoots(document)[0]!;
  const mount = getHibidResearchMount(root)!;
  assert.equal(mount.container.className, 'app-auction-lot-card__content');
  assert.equal(mount.before?.className, 'app-auction-lot-card__info');
  assert.equal(mount.before?.parentElement, mount.container);
});

test('model X100 and frame dimensions never become structured quantities', () => {
  for (const title of ['Sony X100 camera', '4 x 6 picture frame', 'RTX4060 8GB graphics card']) {
    const document = dom(`<div class="lot-tile lot-card" id="lot-901"><div class="app-auction-lot-card__identity"><a class="app-auction-lot-card__title">${title}</a></div><div class="app-auction-lot-card__meta-money">$5.00 USD</div><div class="app-auction-lot-card__cta">Bid 6.00 USD</div></div>`);
    const observed = readHibidLotDom(document.body.firstElementChild!)!;
    assert.equal(observed.quantity, null, title);
    assert.equal(observed.bidMultiplier, null, title);
  }
});

test('closed redesigned cards keep sold amount and never invent a next bid', () => {
  const document = dom('<div class="lot-tile lot-card" id="lot-902"><div class="app-auction-lot-card__identity"><a class="app-auction-lot-card__title" href="/lot/902/receiver">Receiver</a></div><div class="app-auction-lot-badge" data-tone="closed">Closed</div><div class="app-auction-lot-card__meta-money">Sold for <span class="app-auction-lot-card__amount">$32.00</span> USD</div><div class="app-auction-lot-card__footer"><a class="app-button">View Lot</a></div></div>');
  const [record] = extractHiBidVisibleLots(document, { kind: 'pastbids', auctionId: null } as never, 'https://hibid.com/account/pastbids');
  assert.equal(record?.currentBid, 32);
  assert.equal(record?.nextBid, null);
  assert.equal(record?.status, 'Closed');
});

test('supports condensed and full roots without merging number and title', () => {
  const document = dom(`
    <app-lot-condensed id="lot-11"><div class="lot-number-lead"><a>Lot 11</a></div><h2 class="lot-title">Desk lamp</h2><div class="lot-high-bid">$12.50</div><button class="app-button">Bid 13.50 USD</button></app-lot-condensed>
    <app-lot-full id="lot-12"><div class="lot-number-lead"><a>Lot 12</a></div><h2 class="lot-title">Tool kit</h2><div class="lot-high-bid">$0</div><div class="TileDisplayMinBid">$1.00 USD</div></app-lot-full>`);
  assert.deepEqual(getHibidLotRoots(document).map((root) => readHibidLotDom(root)?.title), ['Desk lamp', 'Tool kit']);
  const records = extractHiBidVisibleLots(document, { kind: 'catalog', auctionId: '42' } as never, 'https://hibid.com/catalog/42');
  assert.deepEqual(records.map((record) => [record.id, record.lot, record.title, record.currentBid, record.nextBid]), [
    ['11', '11', 'Desk lamp', 12.5, 13.5],
    ['12', '12', 'Tool kit', 0, 1]
  ]);
});

test('real condensed combined link separates strong lot number from nested product heading', () => {
  const document = dom('<app-lot-condensed id="lot-329316785"><div class="lot-lead-heading col-12"><div><a class="inline-lot-number-lead lot-number-lead lot-link" href="/lot/329316785/magic-leap"><strong>Lot 802av</strong> | <h2 class="lot-title">AV - MAGIC LEAP ONE CREATOR EDITION AR HEADSET</h2></a></div></div></app-lot-condensed>');
  const observed = readHibidLotDom(document.body.firstElementChild!)!;
  assert.equal(observed.id, '329316785');
  assert.equal(observed.lot, '802av');
  assert.equal(observed.title, 'AV - MAGIC LEAP ONE CREATOR EDITION AR HEADSET');
});

test('detail premium and auction identity use native labeled table and live-catalog link', () => {
  const document = dom('<app-lot-details><h1>Lot # : 802av - Magic Leap headset</h1><table><tr><th>Lot #</th><td>802av</td></tr><tr><th>Lead</th><td>Magic Leap headset</td></tr></table><table><tr><th>Buyer Premium</th><td>20% BUYERS PREMIUM</td></tr></table><app-lot-details-subpanel><span class="lot-high-bid">High Bid: 11.00 USD</span><app-lot-buttons><button>Bid 12.00 USD</button></app-lot-buttons><a href="/livecatalog/791252/surplus">Live Catalog</a></app-lot-details-subpanel></app-lot-details>');
  const lot = extractHibidLotDetail(document, 'https://hibid.com/lot/329316785/magic-leap');
  assert.equal(lot?.buyerPremium, '20% BUYERS PREMIUM');
  assert.equal(lot?.auctionId, '791252');
  assert.equal(lot?.currentBid, 11);
  assert.equal(lot?.nextBid, 12);
  assert.equal(lot?.description, '', 'missing auctioneer prose must remain absent');
});

test('marks mixed times-the-money and keeps absent price/quantity unknown', () => {
  const document = dom('<div class="lot-tile lot-card" id="lot-13"><div class="app-auction-lot-card__identity"><a class="app-auction-lot-card__lot-number">Lot 13</a><a class="app-auction-lot-card__title">Mixed parts</a></div><span class="app-auction-lot-card__badge">Times the Money</span></div>');
  const observation = readHibidLotDom(document.body.firstElementChild!);
  assert.equal(observation?.mixed, true);
  assert.equal(observation?.current.amount, null);
  assert.equal(observation?.next.amount, null);
  assert.equal(observation?.quantity, null);
  assert.equal(observation?.bidMultiplier, null);
});

test('keeps legacy roots and canonical links ahead of recycled DOM ids', () => {
  const document = dom('<app-lot-condensed id="lot-10"><div class="lot-number-lead"><a>Lot 77</a></div><div class="lot-lead-heading">Legacy camera</div><div class="lot-high-bid">$8.00</div><app-lot-buttons></app-lot-buttons><a href="/lot/77/legacy-camera">Open</a></app-lot-condensed><app-lot-tile id="lot-10"><a href="/lot/88/other"><h2 class="lot-title">Other lot</h2></a></app-lot-tile>');
  const roots = getHibidLotRoots(document);
  assert.deepEqual(roots.map((root) => readHibidLotDom(root)?.id), ['77', '88']);
  assert.equal(getHibidCostAnchor(roots[0]!)?.tagName, 'APP-LOT-BUTTONS');
  assert.equal(getHibidLotRoots(roots[0]!).length, 1);
});

test('preserves standalone event-item and account-card research mounts', () => {
  const document = dom('<div data-event-item-id="501" class="account-card"><div class="current-bids-card-content">Current bid</div></div><div data-event-item-id="502" class="account-card"><div class="account-card">Account card</div></div>');
  const roots = getHibidLotRoots(document);
  assert.equal(getHibidResearchMount(roots[0]!)?.container.className, 'current-bids-card-content');
  assert.equal(getHibidResearchMount(roots[1]!)?.container.className, 'account-card');
  assert.equal(getHibidResearchMount(roots[0]!)?.before, roots[0]!.querySelector('.current-bids-card-content')!.firstElementChild);
  assert.equal(getHibidResearchMount(document.body) , null);
});

test('counts only canonical redesign roots and preserves explicit empty results', () => {
  const document = dom('<div class="promo"><h2>Featured lot</h2></div><div class="lot-tile lot-card" id="lot-20"><a class="__title">Real lot</a></div><div data-flippah-owned="true"><div class="lot-tile lot-card" id="lot-21"></div></div><p>Showing 1 - 1 of 1 lots</p>');
  const state = extractHiBidPageState(document, 'https://hibid.com/catalog/42');
  assert.equal(state.visibleCount, 1);
  assert.equal(state.visibleExpectedTotal, 1);
  const empty = dom('<div class="promo">Featured lot</div><p>No matches found.</p>');
  const emptyState = extractHiBidPageState(empty, 'https://hibid.com/catalog/42');
  assert.equal(emptyState.noMatches, true);
  assert.equal(emptyState.visibleCount, 0);
  assert.equal(emptyState.visibleExpectedTotal, 0);
});

test('keeps watched-account notes out of lot text and preserves auction group context', () => {
  const document = dom(`
    <app-watch-list-page><div class="auction-group">
      <app-watched-auction-header class="col-12"><div><div class="listing-box-title"><a href="/catalog/790910/slug"><strong>Estate auction</strong></a><a href="https://maps.google.com/?q=Columbus">Columbus</a></div><a class="app-button">View Catalog</a></div></app-watched-auction-header>
      <div class="lot-tile lot-card" id="lot-900"><div class="app-auction-lot-card__identity"><a class="app-auction-lot-card__lot-number">Lot 900</a><a class="app-auction-lot-card__title">Saved camera</a></div><div class="app-auction-lot-card__meta-money"><span class="app-auction-lot-card__amount">$200.00</span><span class="app-auction-lot-card__currency-code">USD</span></div><app-watch-notes><hidden-textarea>secret note</hidden-textarea></app-watch-notes><button class="app-watch-star" aria-pressed="true" aria-label="Unwatch"></button><div class="app-auction-lot-card__footer"><a class="app-button" href="/pf/auction-registration/790910?auction_id=790910&amp;lot_id=900"><span class="app-button__label">Bid 225.00 USD</span></a></div></div>
    </div></app-watch-list-page>`);
  const records = extractHiBidVisibleLots(document, { kind: 'watchlist', auctionId: '' } as never, 'https://hibid.com/account/watchlist');
  assert.equal(records[0]?.rawText.includes('secret note'), false);
  assert.equal(records[0]?.title, 'Saved camera');
  assert.equal(records[0]?.currentBid, 200);
  assert.equal(records[0]?.nextBid, 225);
});

test('recognizes the scoped current-bids empty state without counting surrounding copy', () => {
  const document = dom('<app-bids-page><main>You have no bids on open lots.</main><p>Looking for past bids? View Past Bids</p></app-bids-page><div class="promo">Featured auctions</div>');
  const state = extractHiBidPageState(document, 'https://hibid.com/account/currentbids');
  assert.equal(state.noMatches, true);
  assert.equal(state.visibleExpectedTotal, 0);
  assert.equal(state.visibleCount, 0);
});

test('recognizes filtered winning current-bids empty state only inside the account page', () => {
  const document = dom('<app-bids-page><main>No results match the current filters. <button>Reset Filters</button></main></app-bids-page><div class="promo">Featured auctions</div>');
  const state = extractHiBidPageState(document, 'https://hibid.com/account/currentbids?status=WINNING');
  assert.equal(state.noMatches, true);
  assert.equal(state.visibleExpectedTotal, 0);
  assert.equal(state.visibleCount, 0);
});

test('uses canonical lot links for past-watchlist totals despite recycled slot ids', () => {
  const document = dom('<app-watch-list-page><div>Showing 1 - 100 of 276 lots</div><div class="lot-tile lot-card" id="lot-10"><a href="/lot/7001/item"><h2 class="app-auction-lot-card__title">Item</h2></a></div><div class="lot-tile lot-card" id="lot-10"><a href="/lot/7002/item"><h2 class="app-auction-lot-card__title">Item 2</h2></a></div></app-watch-list-page>');
  const state = extractHiBidPageState(document, 'https://hibid.com/account/pastwatchlist');
  assert.equal(state.visibleCount, 100);
  assert.equal(state.visibleExpectedTotal, 276);
});
