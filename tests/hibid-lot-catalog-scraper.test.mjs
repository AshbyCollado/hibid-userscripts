import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function makeElement({ text = '', attrs = {}, disabled = false } = {}) {
  return {
    disabled,
    offsetParent: {},
    textContent: text,
    clicked: false,
    getClientRects: () => [{ width: 1, height: 1 }],
    getAttribute(name) {
      return attrs[name] || '';
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    click() {
      this.clicked = true;
    },
    scrollIntoView() {},
  };
}

function makeTile(selectors) {
  return {
    id: 'lot-1627sf',
    textContent: selectors.rawText?.textContent || '',
    getAttribute(name) {
      return name === 'class' ? 'lot-card' : '';
    },
    querySelector(selector) {
      if (selector === 'a.lot-number-lead[href], a.lot-preview-link[href]') return selectors.link || null;
      if (selector === '.lot-title, h2') return selectors.title || null;
      if (selector === '.lot-number-lead .text-primary, .lot-number-lead span') return selectors.lotLabel || null;
      if (selector === '.lot-high-bid, .lot-bid-container') return selectors.highBid || null;
      if (selector === '.lot-bid-history') return selectors.bidCount || null;
      if (selector === '.lot-time-left, .lot-time-label, .lot-time-left-container') return selectors.timeLeft || null;
      if (selector === '.TileDisplayMinBid') return selectors.nextBid || null;
      if (selector === '.lot-bid-button') return selectors.bidButton || null;
      if (selector === '.lot-description, .description, [class*="description"], [class*="lot-notes"]') return selectors.description || null;
      if (selector === 'img.lot-thumbnail, img') return selectors.image || null;
      return null;
    },
  };
}

function loadCore() {
  const source = fs.readFileSync(new URL('../hibid-lot-catalog-scraper.user.js', import.meta.url), 'utf8');
  const sandbox = {
    console,
    setTimeout,
    URL,
    location: new URL('https://hibid.com/catalog/752334/the-luxe-edit'),
    globalThis: {},
  };
  sandbox.globalThis = sandbox;
  sandbox.__HIBID_LOT_CATALOG_SCRAPER_TEST__ = true;
  vm.runInNewContext(source, sandbox, { filename: 'hibid-lot-catalog-scraper.user.js' });
  return sandbox.HiBidLotCatalogScraperCore;
}

test('standalone scraper initializes on livecatalog and subdomain catalog pages', () => {
  const core = loadCore();

  assert.equal(core.shouldInitOnLocation(new URL('https://hibid.com/livecatalog/752334/the-luxe-edit')), true);
  assert.equal(core.shouldInitOnLocation(new URL('https://seuyco.hibid.com/catalog/752334/the-luxe-edit')), true);
  assert.equal(core.shouldInitOnLocation(new URL('https://hibid.com/account/watchlist?status=OUTBID')), false);
});

test('standalone scraper finds safe live open-more controls only', () => {
  const core = loadCore();
  const openMore = makeElement({ text: 'Open More' });
  const bidHistory = makeElement({ text: '2 Bids' });
  const bidButton = makeElement({ text: 'Bid 86.00 USD' });
  const watch = makeElement({ text: 'Watch' });

  const root = {
    querySelectorAll() {
      return [bidHistory, bidButton, watch, openMore];
    },
  };

  assert.equal(core.findLiveLoadMoreButton(root), openMore);
});

test('standalone scraper finds safe catalog next-page controls only', () => {
  const core = loadCore();
  const next = makeElement({ text: 'Next', attrs: { href: '/catalog/752334?page=2' } });
  const bid = makeElement({ text: 'Bid 86.00 USD' });
  const search = makeElement({ text: 'Search' });

  const root = {
    querySelectorAll() {
      return [bid, search, next];
    },
  };

  assert.equal(core.findNextPageButton(root), next);
});

test('standalone scraper exposes debug/menu metadata and stable element IDs', () => {
  const core = loadCore();

  assert.equal(core.DEBUG_PREFIX, '[HiBid Lot Catalog Scraper]');
  assert.equal(core.BUTTON_ID, 'hibid-lot-catalog-scraper-copy-button');
  assert.equal(core.FALLBACK_ID, 'hibid-lot-catalog-scraper-json');
  assert.deepEqual(Array.from(core.MENU_COMMANDS), ['Mount HiBid scraper button', 'Copy all HiBid lots now']);
});

test('standalone scraper detects redirected auction detail pages and catalog grids', () => {
  const core = loadCore();

  const detailRoot = {
    body: { textContent: 'The Luxe Edit Online Only Auction View Catalog' },
    documentElement: { textContent: 'The Luxe Edit Online Only Auction View Catalog' },
    querySelectorAll(selector) {
      if (selector === 'app-lot-tile[id^="lot-"]') return [];
      return [];
    },
  };
  assert.equal(core.detectPageMode(detailRoot, new URL('https://hibid.com/catalog/752334')), 'auction-detail');

  const gridRoot = {
    body: { textContent: 'The Luxe Edit Lot 1627sf | Chloe Watch High Bid: 38.00 USD' },
    documentElement: { textContent: 'The Luxe Edit Lot 1627sf | Chloe Watch High Bid: 38.00 USD' },
    querySelectorAll(selector) {
      if (selector === 'app-lot-tile[id^="lot-"]') return [makeElement({ text: 'Lot 1 | Test' })];
      return [];
    },
  };
  assert.equal(core.detectPageMode(gridRoot, new URL('https://hibid.com/catalog/752334')), 'catalog-grid');
});

test('standalone scraper finds a safe View Catalog control on auction detail pages', () => {
  const core = loadCore();
  const viewCatalog = makeElement({ text: 'View Catalog', attrs: { href: '/catalog/752334/the-luxe-edit?view=lots' } });
  const shopCategory = makeElement({ text: 'Shop by Category' });
  const search = makeElement({ text: 'Search' });

  const root = {
    querySelectorAll() {
      return [shopCategory, search, viewCatalog];
    },
  };

  assert.equal(core.findCatalogEntryControl(root, new URL('https://hibid.com/catalog/752334')), viewCatalog);
});

test('standalone scraper expands live lots beyond the first visible batch', async () => {
  const core = loadCore();
  let expanded = false;
  const openMore = makeElement({ text: 'Open More' });
  openMore.click = () => {
    expanded = true;
  };
  const root = {
    body: {
      get textContent() {
        return expanded
          ? 'Open Lots: 3 Lot 1 | First Watch High Bid: 5.00 USD 1 Bid 10s Bid 6.00 USD Lot 2 | Second Watch High Bid: 7.00 USD 1 Bid 20s Bid 8.00 USD Lot 3 | Third Watch High Bid: 9.00 USD 1 Bid 30s Bid 10.00 USD'
          : 'Open Lots: 3 Lot 1 | First Watch High Bid: 5.00 USD 1 Bid 10s Bid 6.00 USD Open More';
      },
    },
    documentElement: { textContent: '' },
    querySelectorAll(selector) {
      if (!expanded && selector.includes('button')) return [openMore];
      return [];
    },
  };

  const result = await core.expandLivePageLots(() => {}, () => false, root, { waitMs: 0, maxSteps: 5 });

  assert.equal(result.items.length, 3);
  assert.equal(result.loadMoreClicks, 1);
  assert.equal(result.stuckReason, 'expected-open-lots-reached');
});

test('standalone scraper extracts enriched catalog lot output including description', () => {
  const core = loadCore();
  const tile = makeTile({
    link: makeElement({ attrs: { href: '/lot/1627sf/chloe' } }),
    title: makeElement({ text: "Chloe L'eau by Chloe Eau De Toilette Spray" }),
    lotLabel: makeElement({ text: 'Lot 1627sf' }),
    highBid: makeElement({ text: 'High Bid: 38.00 USD' }),
    bidCount: makeElement({ text: '1 Bid' }),
    timeLeft: makeElement({ text: '10s' }),
    nextBid: makeElement({ text: '43.00 USD' }),
    bidButton: makeElement({ text: 'Bid 43.00 USD' }),
    description: makeElement({ text: 'Designer fragrance bottle with box' }),
    image: { currentSrc: 'https://cdn.example.test/chloe.jpg', src: '' },
    rawText: makeElement({ text: 'Lot 1627sf Chloe High Bid: 38.00 USD 1 Bid 10s Bid 43.00 USD' }),
  });

  const lot = core.extractLot(tile);

  assert.equal(lot.id, '1627sf');
  assert.equal(lot.lot, '1627sf');
  assert.equal(lot.title, "Chloe L'eau by Chloe Eau De Toilette Spray");
  assert.equal(lot.highBidAmount, 38);
  assert.equal(lot.currentPrice, 38);
  assert.equal(lot.currentBid, 38);
  assert.equal(lot.nextBidAmount, 43);
  assert.equal(lot.bidCountNumber, 1);
  assert.equal(lot.timeLeft, '10s');
  assert.equal(lot.description, 'Designer fragrance bottle with box');
  assert.equal(lot.image, 'https://cdn.example.test/chloe.jpg');
  assert.match(lot.url, /\/lot\/1627sf\/chloe$/);
});

test('standalone scraper parses visible livecatalog lots with bid fields', () => {
  const core = loadCore();
  const root = {
    body: {
      textContent: `
        Total Lots: 1999 Open Lots: 375
        Lot 1627sf | Chloe L'eau by Chloe Eau De Toilette Spray
        Watch High Bid: 38.00 USD 200.00 USD 1 Bid 10s Bid 43.00 USD
        Lot 1628sf | Hermes Swift Elan Pocket Belt Bag
        Watch High Bid: 881.00 USD 3,950.00 USD 1 Bid 25s Bid 896.00 USD
      `,
    },
  };

  assert.deepEqual(plain(core.extractLivePageLots(root)), [
    {
      id: '1627sf',
      lot: '1627sf',
      title: "Chloe L'eau by Chloe Eau De Toilette Spray",
      highBid: 'High Bid: 38.00 USD',
      highBidAmount: 38,
      estimatedValue: 200,
      bidCount: '1 Bid',
      bidCountNumber: 1,
      timeLeft: '10s',
      nextBid: 'Bid 43.00 USD',
      nextBidAmount: 43,
      userBidStatus: '',
      status: '',
      rawText: "Lot 1627sf | Chloe L'eau by Chloe Eau De Toilette Spray Watch High Bid: 38.00 USD 200.00 USD 1 Bid 10s Bid 43.00 USD",
    },
    {
      id: '1628sf',
      lot: '1628sf',
      title: 'Hermes Swift Elan Pocket Belt Bag',
      highBid: 'High Bid: 881.00 USD',
      highBidAmount: 881,
      estimatedValue: 3950,
      bidCount: '1 Bid',
      bidCountNumber: 1,
      timeLeft: '25s',
      nextBid: 'Bid 896.00 USD',
      nextBidAmount: 896,
      userBidStatus: '',
      status: '',
      rawText: 'Lot 1628sf | Hermes Swift Elan Pocket Belt Bag Watch High Bid: 881.00 USD 3,950.00 USD 1 Bid 25s Bid 896.00 USD',
    },
  ]);
});
