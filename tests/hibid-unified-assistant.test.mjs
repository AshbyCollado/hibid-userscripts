import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadCore(options = {}) {
  const source = fs.readFileSync(new URL('../hibid-bid-assistant.user.js', import.meta.url), 'utf8');
  const sandbox = {
    console,
    globalThis: {},
  };
  if (options.storage) {
    sandbox.GM_getValue = (key, fallback) => options.storage.has(key) ? options.storage.get(key) : fallback;
    sandbox.GM_setValue = (key, value) => {
      options.storage.set(key, value);
      return value;
    };
  }
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

test('assistant panel exposes catalog controls and gates debug controls', () => {
  const core = loadCore();
  const html = core.buildPanelHtml({ mode: 'catalog', debugEnabled: true });

  assert.match(html, /id="hibid-catalog-copy-json"/);
  assert.match(html, /id="hibid-catalog-copy-llm"/);
  assert.match(html, /id="hibid-debug-copy"/);
  assert.match(html, /id="hibid-debug-clear"/);
  assert.doesNotMatch(html, /id="hibid-live-copy-json"/);
  assert.doesNotMatch(html, /id="hibid-live-copy-llm"/);
  assert.equal(core.DEBUG_PREFIX, '[FlipperAddon]');
  assert.deepEqual(Array.from(core.MENU_COMMANDS), [
    'Remount FlipperAddon',
    'Toggle FlipperAddon Debug Mode',
    'Copy FlipperAddon Debug Log',
    'Clear FlipperAddon Debug Log',
    'Copy HiBid Lots Now',
  ]);
});

test('assistant is branded as FlipperAddon by ALOS with FlipperAddon menu commands', () => {
  const core = loadCore();

  assert.equal(core.APP_NAME, 'FlipperAddon by ALOS');
  assert.equal(core.DEBUG_PREFIX, '[FlipperAddon]');
  assert.deepEqual(Array.from(core.MENU_COMMANDS), [
    'Remount FlipperAddon',
    'Toggle FlipperAddon Debug Mode',
    'Copy FlipperAddon Debug Log',
    'Clear FlipperAddon Debug Log',
    'Copy HiBid Lots Now',
  ]);
});

test('assistant mode resolver activates only the current page module', () => {
  const core = loadCore();
  const cases = [
    ['https://hibid.com/newjersey/lots/40196/computers-and-electronics', 'catalog'],
    ['https://hibid.com/account/watchlist?status=OUTBID', 'catalog'],
    ['https://hibid.com/livecatalog/752334/the-luxe-edit', 'live'],
    ['https://www.ebay.com/sh/lst/active', 'fliptracker'],
    ['https://www.facebook.com/marketplace/you/selling', 'fliptracker'],
    ['https://hibid.com/help', 'unsupported'],
  ];

  cases.forEach(([href, mode]) => {
    assert.equal(core.resolveAssistantMode(new URL(href)).mode, mode, href);
  });
});

test('panel markup is active-mode only and keeps debug controls gated', () => {
  const core = loadCore();

  const catalog = core.buildPanelHtml({ mode: 'catalog', debugEnabled: false });
  assert.match(catalog, /FlipperAddon by ALOS/);
  assert.match(catalog, /id="hibid-bid-load"/);
  assert.match(catalog, /id="hibid-catalog-copy-llm"/);
  assert.match(catalog, /id="hibid-max-plan-details"/);
  assert.match(catalog, /data-help="[^"]*max plan/i);
  assert.doesNotMatch(catalog, /id="hibid-live-snipe"/);
  assert.doesNotMatch(catalog, /id="fliptracker-listing-download"/);
  assert.doesNotMatch(catalog, /id="hibid-debug-copy"/);

  const live = core.buildPanelHtml({ mode: 'live', debugEnabled: false });
  assert.match(live, /id="hibid-live-snipe"/);
  assert.match(live, /id="hibid-live-copy-llm"/);
  assert.match(live, /id="hibid-bid-plan-json"/);
  assert.doesNotMatch(live, /id="hibid-bid-load"/);
  assert.doesNotMatch(live, /id="hibid-catalog-copy-llm"/);
  assert.doesNotMatch(live, /id="fliptracker-listing-download"/);

  const fliptracker = core.buildPanelHtml({ mode: 'fliptracker', debugEnabled: true });
  assert.match(fliptracker, /id="fliptracker-listing-download"/);
  assert.match(fliptracker, /id="hibid-debug-copy"/);
  assert.doesNotMatch(fliptracker, /id="hibid-bid-plan-json"/);
  assert.doesNotMatch(fliptracker, /id="hibid-live-snipe"/);
});

test('max plan helpers use per-auction storage keys and add blank max entries', () => {
  const core = loadCore();

  assert.equal(
    core.getPlanStorageKey(new URL('https://hibid.com/catalog/752334/the-luxe-edit')),
    'flipperaddon-max-plan-v2:hibid.com:auction:752334'
  );
  assert.equal(
    core.getPlanStorageKey(new URL('https://hibid.com/newjersey/lots/40196/computers-and-electronics')),
    'flipperaddon-max-plan-v2:hibid.com:auction:40196'
  );

  const text = core.addLotToPlanText('{}', {
    lot: '1627sf',
    title: "Chloe L'eau by Chloe Eau De Toilette Spray",
  });

  assert.deepEqual(JSON.parse(text), {
    '1627sf': {
      max: null,
      title: "Chloe L'eau by Chloe Eau De Toilette Spray",
    },
  });
});

test('legacy max plan migration only imports into one scoped plan once', () => {
  const storage = new Map([
    ['hibid-bid-assistant-plan-v1', JSON.stringify({ 78: { max: 70, title: 'BlueParrott' } })],
  ]);
  const core = loadCore({ storage });

  const first = core.getStoredPlanText(new URL('https://hibid.com/catalog/752334/the-luxe-edit'));
  const second = core.getStoredPlanText(new URL('https://hibid.com/catalog/40196/computers-and-electronics'));

  assert.deepEqual(JSON.parse(first), { 78: { max: 70, title: 'BlueParrott' } });
  assert.deepEqual(JSON.parse(second), {});
  assert.equal(storage.get('flipperaddon-legacy-plan-migrated-v1'), true);
});

test('panel remount policy rebuilds on module changes and unsupported routes', () => {
  const core = loadCore();

  assert.equal(core.shouldRebuildPanelForMode('catalog', 'catalog', true), false);
  assert.equal(core.shouldRebuildPanelForMode('catalog', 'live', true), true);
  assert.equal(core.shouldRebuildPanelForMode('catalog', 'fliptracker', true), true);
  assert.equal(core.shouldRebuildPanelForMode('catalog', 'unsupported', false), true);
});

test('panel rebuild reasons that remove a panel require teardown cleanup', () => {
  const core = loadCore();

  assert.equal(core.shouldTeardownPanelForRebuild('mode-change:catalog:live:urlchange'), true);
  assert.equal(core.shouldTeardownPanelForRebuild('unsupported:mutation'), true);
  assert.equal(core.shouldTeardownPanelForRebuild('debug-toggle'), true);
  assert.equal(core.shouldTeardownPanelForRebuild('noop'), false);
});

test('LLM auction brief includes the advanced resale coordinator prompt and full lot fields', () => {
  const core = loadCore();
  const brief = core.buildLlmAuctionBrief([
    {
      lot: '4432i',
      title: '$499 NEW! MONSTER GI30 PRO HIGH POWER 2000W BLUETOOTH',
      url: 'https://hibid.com/lot/307763539/4432i',
      image: 'https://cdn.example.test/4432i.jpg',
      highBidAmount: 165,
      nextBidAmount: 170,
      bidCountNumber: 28,
      timeLeft: '9h 39m',
      description: 'Factory sealed speaker',
      auctionTitle: 'Overstock Product Liquidation NJ W27',
      buyerPremium: '15%',
    },
  ], {
    title: 'Overstock Product Liquidation NJ W27',
    url: 'https://hibid.com/newjersey/lots/40196/computers-and-electronics',
    totalLots: 222,
  });

  assert.match(brief, /You are an auction resale analysis coordinator/);
  assert.match(brief, /Coverage first, confirmation second/);
  assert.match(brief, /Use eBay sold\/completed listings first/);
  assert.match(brief, /sedan risk/i);
  assert.match(brief, /Factory sealed speaker/);
  assert.match(brief, /https:\/\/hibid\.com\/lot\/307763539\/4432i/);
  assert.match(brief, /https:\/\/cdn\.example\.test\/4432i\.jpg/);
  assert.match(brief, /"buyerPremium": "15%"/);
});
