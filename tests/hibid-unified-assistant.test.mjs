import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadCore() {
  const source = fs.readFileSync(new URL('../hibid-bid-assistant.user.js', import.meta.url), 'utf8');
  const sandbox = {
    console,
    globalThis: {},
  };
  sandbox.globalThis = sandbox;
  sandbox.__HIBID_BID_ASSISTANT_TEST__ = true;
  vm.runInNewContext(source, sandbox, { filename: 'hibid-bid-assistant.user.js' });
  return sandbox.HiBidBidAssistantCore;
}

function makeElement({ text = '', attrs = {}, disabled = false } = {}) {
  return {
    disabled,
    offsetParent: {},
    textContent: text,
    getClientRects: () => [{ width: 1, height: 1 }],
    getAttribute(name) {
      return attrs[name] || '';
    },
    closest() {
      return null;
    },
  };
}

test('assistant initializes on state-prefixed HiBid lots pages', () => {
  const core = loadCore();
  const stateLots = new URL('https://hibid.com/newjersey/lots/40196/computers-and-electronics');

  assert.equal(core.shouldInitOnLocation(stateLots), true);
  assert.deepEqual(plain(core.resolveHiBidPage(stateLots)), {
    supported: true,
    kind: 'catalog',
    host: 'hibid.com',
    statePrefix: 'newjersey',
    auctionId: '40196',
    reason: 'state-prefixed lots route',
  });
});

test('assistant shared route resolver covers HiBid route families', () => {
  const core = loadCore();
  const cases = [
    ['https://hibid.com/lots', 'catalog'],
    ['https://hibid.com/catalog/752334/the-luxe-edit', 'catalog'],
    ['https://hibid.com/livecatalog/752334/the-luxe-edit', 'live'],
    ['https://hibid.com/lot/123/example-lot', 'lot'],
    ['https://hibid.com/newjersey/lots/40196/computers-and-electronics', 'catalog'],
    ['https://seuyco.hibid.com/catalog/752334/the-luxe-edit', 'catalog'],
    ['https://hibid.com/account/watchlist?status=OUTBID', 'watchlist-outbid'],
  ];

  cases.forEach(([href, kind]) => {
    const resolved = core.resolveHiBidPage(new URL(href));
    assert.equal(resolved.supported, true, href);
    assert.equal(resolved.kind, kind, href);
    assert.equal(core.shouldInitOnLocation(new URL(href)), true, href);
  });

  assert.equal(core.shouldInitOnLocation(new URL('https://hibid.com/account/watchlist')), false);
  assert.equal(core.shouldInitOnLocation(new URL('https://hibid.com/help')), false);
});

test('assistant parses HiBid showing totals and safe next-page controls', () => {
  const core = loadCore();
  const next = makeElement({ text: 'Next >', attrs: { href: '?apage=2' } });
  const bid = makeElement({ text: 'Bid 170.00 USD' });
  const root = {
    body: { textContent: 'Showing 1 to 100 of 222 lots' },
    documentElement: { textContent: 'Showing 1 to 100 of 222 lots' },
    createTreeWalker: () => null,
    querySelectorAll(selector) {
      if (selector.includes('button') || selector.includes('a[href]')) return [bid, next];
      return [];
    },
  };

  assert.equal(core.getExpectedLotTotal(root), 222);
  assert.equal(core.findCatalogNextPageButton(root), next);
});

test('assistant extracts enriched lots from embedded HiBid Apollo state', () => {
  const core = loadCore();
  const state = {
    ROOT_QUERY: {
      'lotSearch({"apage":1})': {
        pagedResults: {
          totalCount: 222,
          filteredCount: 222,
          pageLength: 100,
          pageNumber: 1,
          results: [{ __ref: 'Lot:4432i' }],
        },
      },
    },
    'Lot:4432i': {
      id: '307763539',
      lotNumber: '4432i',
      lead: '$499 NEW! MONSTER GI30 PRO HIGH POWER 2000W BLUETOOTH',
      description: '<p>Factory sealed speaker</p>',
      featuredPicture: { thumbnailLocation: 'https://cdn.example.test/4432i.jpg' },
      pictureCount: 3,
      auction: { __ref: 'Auction:123' },
      lotState: {
        highBid: 165,
        minBid: 170,
        bidCount: 28,
        status: 'OPEN',
        timeLeft: '9h 39m',
        isWatching: true,
      },
    },
    'Auction:123': {
      id: '123',
      title: 'Overstock Product Liquidation NJ W27',
      buyerPremium: '15%',
    },
  };

  const result = core.extractHibidApolloLots(state, {
    url: 'https://hibid.com/newjersey/lots/40196/computers-and-electronics',
  });

  assert.equal(result.expectedTotal, 222);
  assert.equal(result.source, 'hibid-state');
  assert.deepEqual(plain(result.items), [
    {
      id: '307763539',
      lot: '4432i',
      title: '$499 NEW! MONSTER GI30 PRO HIGH POWER 2000W BLUETOOTH',
      url: 'https://hibid.com/lot/307763539/4432i',
      image: 'https://cdn.example.test/4432i.jpg',
      highBid: 'High Bid: 165.00 USD',
      highBidAmount: 165,
      currentPrice: 165,
      currentBid: 165,
      nextBid: 'Bid 170.00 USD',
      nextBidAmount: 170,
      bidCount: '28 Bids',
      bidCountNumber: 28,
      timeLeft: '9h 39m',
      status: 'OPEN',
      userBidStatus: '',
      isWinning: false,
      isOutbid: false,
      watched: true,
      pictureCount: 3,
      description: 'Factory sealed speaker',
      auctionTitle: 'Overstock Product Liquidation NJ W27',
      buyerPremium: '15%',
    },
  ]);
});

test('assistant ignores stray Apollo lot connections when visible total identifies the main list', () => {
  const core = loadCore();
  const state = {
    ROOT_QUERY: {
      'lotSearch({"apage":1})': {
        pagedResults: {
          totalCount: 222,
          pageLength: 100,
          pageNumber: 1,
          results: [{ __ref: 'Lot:main' }],
        },
      },
      'featuredLotSearch({"limit":100})': {
        pagedResults: {
          totalCount: 999,
          pageLength: 100,
          pageNumber: 1,
          results: [{ __ref: 'Lot:stray' }],
        },
      },
    },
    'Lot:main': {
      id: 'main',
      lotNumber: '4432i',
      lead: 'Real visible category lot',
      lotState: { highBid: 10, minBid: 12.5, bidCount: 2, status: 'OPEN' },
    },
    'Lot:stray': {
      id: 'stray',
      lotNumber: '999',
      lead: 'Featured stray lot',
      lotState: { highBid: 99, minBid: 100, bidCount: 9, status: 'OPEN' },
    },
  };

  const result = core.extractHibidApolloLots(state, {
    url: 'https://hibid.com/newjersey/lots/40196/computers-and-electronics',
    expectedTotal: 222,
  });

  assert.equal(result.expectedTotal, 222);
  assert.deepEqual(plain(result.items.map(lot => lot.id)), ['main']);
});

test('assistant marks partial data-first catalog scrapes incomplete', () => {
  const core = loadCore();
  const complete = {
    source: 'hibid-state',
    items: new Array(222).fill(null).map((_item, index) => ({ id: String(index) })),
    expectedTotal: 222,
    incomplete: false,
  };
  const partial = {
    source: 'hibid-state',
    items: new Array(100).fill(null).map((_item, index) => ({ id: String(index) })),
    expectedTotal: 222,
    incomplete: true,
    failedPage: 2,
    stopReason: 'missing-page-state',
  };

  assert.equal(core.isCatalogScrapeComplete(complete), true);
  assert.equal(core.isCatalogScrapeComplete(partial), false);
});

test('assistant panel exposes unified catalog and debug controls', () => {
  const core = loadCore();
  const html = core.buildPanelHtml();

  assert.match(html, /id="hibid-catalog-copy-json"/);
  assert.match(html, /id="hibid-catalog-copy-llm"/);
  assert.match(html, /id="hibid-debug-copy"/);
  assert.match(html, /id="hibid-debug-clear"/);
  assert.match(html, /id="hibid-live-copy-json"/);
  assert.match(html, /id="hibid-live-copy-llm"/);
  assert.equal(core.DEBUG_PREFIX, '[HiBid Assistant]');
  assert.deepEqual(Array.from(core.MENU_COMMANDS), [
    'Remount HiBid Assistant',
    'Copy HiBid Assistant Debug Log',
    'Clear HiBid Assistant Debug Log',
    'Copy HiBid Lots Now',
  ]);
});
