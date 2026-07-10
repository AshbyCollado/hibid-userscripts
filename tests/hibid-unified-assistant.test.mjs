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
    URL,
    globalThis: {},
  };
  if (options.storage) {
    sandbox.GM_getValue = (key, fallback) => options.storage.has(key) ? options.storage.get(key) : fallback;
    sandbox.GM_setValue = (key, value) => {
      options.storage.set(key, value);
      return value;
    };
  }
  if (options.unsafeWindow) {
    sandbox.unsafeWindow = options.unsafeWindow;
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

function makeFakeNode({ text = '', attrs = {}, selectors = {} } = {}) {
  const bySelector = new Map(Object.entries(selectors));
  const findMatch = (selector) => {
    for (const [pattern, value] of bySelector.entries()) {
      if (selector.includes(pattern)) return value;
    }
    return null;
  };

  return {
    textContent: text,
    href: attrs.href || '',
    src: attrs.src || '',
    alt: attrs.alt || '',
    getAttribute(name) {
      return attrs[name] || '';
    },
    querySelector(selector) {
      const match = findMatch(selector);
      return Array.isArray(match) ? (match[0] || null) : match;
    },
    querySelectorAll(selector) {
      const match = findMatch(selector);
      if (!match) return [];
      return Array.isArray(match) ? match : [match];
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

test('assistant panel exposes scraper-first catalog controls and gates debug controls', () => {
  const core = loadCore();
  const html = core.buildPanelHtml({ mode: 'catalog', debugEnabled: true });

  assert.match(html, /id="hibid-catalog-copy-json"/);
  assert.match(html, /id="hibid-catalog-copy-llm"/);
  assert.match(html, /id="hibid-scraper-stop"/);
  assert.match(html, /id="hibid-debug-copy"/);
  assert.match(html, /id="hibid-debug-clear"/);
  assert.doesNotMatch(html, /Prepare Bid|Prepare Next|Snipe Now|Auto-confirm|Max plan|hibid-max-plan-details|hibid-bid-plan-json/);
  assert.doesNotMatch(html, /id="hibid-bid-results"/);
  assert.match(html, /id="flipperaddon-toast"/);
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

test('assistant exposes a page-window canary when unsafeWindow is available', () => {
  const pageWindow = {};
  loadCore({ unsafeWindow: pageWindow });

  assert.equal(pageWindow.__HIBID_UNIFIED_ASSISTANT_ACTIVE__, true);
  assert.match(pageWindow.__FLIPPERADDON_VERSION__, /^0\.\d+\.\d+$/);
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

test('panel markup is active-mode only, scraper-first, and keeps debug controls gated', () => {
  const core = loadCore();

  const catalog = core.buildPanelHtml({ mode: 'catalog', debugEnabled: false });
  assert.match(catalog, /FlipperAddon by ALOS/);
  assert.match(catalog, /id="hibid-catalog-copy-llm"/);
  assert.match(catalog, /id="hibid-catalog-copy-json"/);
  assert.match(catalog, /id="hibid-scraper-stop"/);
  assert.doesNotMatch(catalog, /id="hibid-bid-load"/);
  assert.doesNotMatch(catalog, /id="hibid-bid-scan"/);
  assert.doesNotMatch(catalog, /id="hibid-bid-next"/);
  assert.doesNotMatch(catalog, /id="hibid-live-snipe"/);
  assert.doesNotMatch(catalog, /id="hibid-max-plan-details"|id="hibid-bid-plan-json"|Max plan/);
  assert.doesNotMatch(catalog, /id="fliptracker-listing-download"/);
  assert.doesNotMatch(catalog, /id="hibid-debug-copy"/);
  assert.doesNotMatch(catalog, /id="hibid-bid-results"/);

  const live = core.buildPanelHtml({ mode: 'live', debugEnabled: false });
  assert.match(live, /id="hibid-live-copy-llm"/);
  assert.match(live, /id="hibid-live-copy-json"/);
  assert.match(live, /id="hibid-scraper-stop"/);
  assert.doesNotMatch(live, /id="hibid-live-snipe"/);
  assert.doesNotMatch(live, /id="hibid-live-arm"/);
  assert.doesNotMatch(live, /id="hibid-bid-plan-json"|Max plan|Auto-confirm/);
  assert.doesNotMatch(live, /id="hibid-bid-load"/);
  assert.doesNotMatch(live, /id="hibid-catalog-copy-llm"/);
  assert.doesNotMatch(live, /id="fliptracker-listing-download"/);
  assert.doesNotMatch(live, /id="hibid-bid-results"/);

  const fliptracker = core.buildPanelHtml({ mode: 'fliptracker', debugEnabled: true });
  assert.match(fliptracker, /id="fliptracker-listing-download"/);
  assert.match(fliptracker, /id="hibid-debug-copy"/);
  assert.doesNotMatch(fliptracker, /id="hibid-bid-plan-json"/);
  assert.doesNotMatch(fliptracker, /id="hibid-live-snipe"/);
  assert.doesNotMatch(fliptracker, /id="hibid-bid-results"/);
  assert.doesNotMatch(fliptracker, /fliptracker-listing-results/);
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
  assert.equal(core.shouldRebuildPanelForMode('', 'catalog', true, true), true);
  assert.equal(core.shouldRebuildPanelForMode('', 'catalog', true, false), false);
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
  assert.match(brief, /Sold\/completed comps first, profit second, hunches last/);
  assert.match(brief, /auction all-in = bid x 1\.25/);
  assert.match(brief, /Use eBay sold\/completed listings first/);
  assert.match(brief, /sedan risk/i);
  assert.match(brief, /Factory sealed speaker/);
  assert.match(brief, /https:\/\/hibid\.com\/lot\/307763539\/4432i/);
  assert.match(brief, /https:\/\/cdn\.example\.test\/4432i\.jpg/);
  assert.match(brief, /"buyerPremium": "15%"/);
});

test('assistant resolves supported and blocked AuctionNinja route families', () => {
  const core = loadCore();
  const cases = [
    ['https://www.auctionninja.com/auctions?an=6av06rjyogk', 'auction-search'],
    ['https://www.auctionninja.com/nj/carteret/07008?miles=50&an=', 'auction-search'],
    ['https://www.auctionninja.com/followed-items?an=b7k7t5kpfyo', 'followed-items'],
    ['https://www.auctionninja.com/items-won?an=hwfmhr2h2qi', 'items-won'],
    ['https://www.auctionninja.com/bid-history?an=sp2i8ac5q0n', 'bid-history'],
    ['https://www.auctionninja.com/clearinghouseestatesales/sales/details/example-sale--17395.html?an=20260709202533', 'sale-catalog'],
    ['https://www.auctionninja.com/clearinghouseestatesales/product/example-lot--123456.html', 'item-detail'],
  ];

  cases.forEach(([href, kind]) => {
    const url = new URL(href);
    const resolved = core.resolveAuctionNinjaPage(url);
    assert.equal(resolved.supported, true, href);
    assert.equal(resolved.kind, kind, href);
    assert.equal(core.shouldInitOnLocation(url), true, href);
    assert.equal(core.resolveAssistantMode(url).mode, 'auctionninja', href);
    assert.equal(core.resolveAssistantMode(url).source, 'auctionninja', href);
  });

  [
    'https://www.auctionninja.com/account',
    'https://www.auctionninja.com/invoices',
    'https://www.auctionninja.com/payment-methods',
    'https://www.auctionninja.com/checkout',
    'https://www.auctionninja.com/support',
  ].forEach((href) => {
    const url = new URL(href);
    assert.equal(core.resolveAuctionNinjaPage(url).supported, false, href);
    assert.equal(core.shouldInitOnLocation(url), false, href);
  });
});

test('assistant parses AuctionNinja catalog ranges for guarded loading', () => {
  const core = loadCore();

  assert.deepEqual(plain(core.parseAuctionNinjaCatalogRange('1-40 of 60 items')), {
    start: 1,
    end: 40,
    total: 60,
    pageSize: 40,
    complete: false,
  });
  assert.deepEqual(plain(core.parseAuctionNinjaCatalogRange('41-60 of 60 items')), {
    start: 41,
    end: 60,
    total: 60,
    pageSize: 20,
    complete: true,
  });
  assert.equal(core.parseAuctionNinjaCatalogRange('no count here'), null);
});

test('assistant discovers AuctionNinja catalog pagination URLs without product or account links', () => {
  const core = loadCore();
  const page2 = makeFakeNode({
    text: '2',
    attrs: { href: 'https://www.auctionninja.com/seller/sales/details/example--17395.html?Page=2#items' },
  });
  const page3 = makeFakeNode({
    text: '3',
    attrs: { href: 'https://www.auctionninja.com/seller/sales/details/example--17395.html?Page=3#items' },
  });
  const activePage = makeFakeNode({
    text: '1',
    attrs: { class: 'active' },
  });
  const productLink = makeFakeNode({
    text: 'Lot 2',
    attrs: { href: 'https://www.auctionninja.com/seller/product/example-lot--123.html' },
  });
  const accountLink = makeFakeNode({
    text: 'Payment',
    attrs: { href: 'https://www.auctionninja.com/payment-methods' },
  });
  const root = makeFakeNode({
    text: '1-40 of 106 items',
    selectors: {
      'a[href': [activePage, productLink, page3, accountLink, page2],
    },
  });

  assert.deepEqual(plain(core.findAuctionNinjaCatalogPageUrls(root, new URL('https://www.auctionninja.com/seller/sales/details/example--17395.html'))), [
    'https://www.auctionninja.com/seller/sales/details/example--17395.html?Page=2#items',
    'https://www.auctionninja.com/seller/sales/details/example--17395.html?Page=3#items',
  ]);
});

test('assistant backfills AuctionNinja catalog pages when opened mid-catalog', () => {
  const core = loadCore();
  const root = makeFakeNode({
    text: '41-80 of 106 items',
    selectors: {
      'a[href': [
        makeFakeNode({
          text: '3',
          attrs: { href: 'https://www.auctionninja.com/seller/sales/details/example--17395.html?Page=3#items' },
        }),
      ],
    },
  });

  assert.deepEqual(plain(core.findAuctionNinjaCatalogPageUrls(root, new URL('https://www.auctionninja.com/seller/sales/details/example--17395.html?Page=2#items'))), [
    'https://www.auctionninja.com/seller/sales/details/example--17395.html#items',
    'https://www.auctionninja.com/seller/sales/details/example--17395.html?Page=3#items',
  ]);
});

test('assistant extracts AuctionNinja sale context including terms and pickup friction', () => {
  const core = loadCore();
  const title = 'A Glamorous Upper West Side Brownstone With Interiors By Jonathan Adler';
  const root = makeFakeNode({
    text: `${title}
Moving & Estate Sales, Online Auction
Auction Location:
New York, NY
Clearing House Estate Sales
Shipping Available
Private Residence
New York, New York 10024
When to Pickup
Saturday, 7/11, 12:00 pm to 3:00 pm
About the Sale
Hedge Auctions New York presents curated contents of an elegant Upper West Side brownstone.
Special Instructions
Local Pick Up
Date: Saturday, June 11th From 12PM - 3PM
Items not picked up within this timeframe are forfeited without refund.
Auction Manager
Hedge Auctions New York | (914) 458-2420 | bid@hedge-auctions.com
Buyer's Premium
Bidding increment chart
18%
Item Catalog`,
    selectors: {
      'h1': makeFakeNode({ text: title }),
      'link[rel="canonical"]': makeFakeNode({ attrs: { href: 'https://www.auctionninja.com/clearinghouseestatesales/sales/details/example--17395.html' } }),
    },
  });

  const context = core.extractAuctionNinjaSaleContext(root, new URL('https://www.auctionninja.com/clearinghouseestatesales/sales/details/example--17395.html'));

  assert.equal(context.source, 'AuctionNinja');
  assert.equal(context.title, title);
  assert.equal(context.seller, 'Clearing House Estate Sales');
  assert.equal(context.location, 'New York, NY');
  assert.equal(context.buyerPremium, '18%');
  assert.match(context.pickupWindow, /Saturday, 7\/11/);
  assert.match(context.shipping, /Shipping Available/);
  assert.match(context.specialInstructions, /Items not picked up/);
});

test('assistant extracts AuctionNinja lot cards without treating bid controls as actions', () => {
  const core = loadCore();
  const lotLink = makeFakeNode({
    text: "An Antique French Mahogany Sideboard, C. 1930's.",
    attrs: { href: 'https://www.auctionninja.com/clearinghouseestatesales/product/sideboard--555.html' },
  });
  const image = makeFakeNode({
    attrs: {
      src: 'https://images.example.test/sideboard.jpg',
      alt: 'An Antique French Mahogany Sideboard',
    },
  });
  const card = makeFakeNode({
    text: `Current Bid
$920.00
3 minutes 40 seconds left
An Antique French Mahogany Sideboard, C. 1930's.
Lot #: 16
Bid Now`,
    selectors: {
      'a[href*="/product/"]': lotLink,
      'img': image,
    },
  });
  const root = makeFakeNode({
    text: '1-40 of 60 items',
    selectors: {
      '.search-catalog-item-box': [card],
    },
  });

  const lots = core.extractAuctionNinjaCatalogLots(root);

  assert.deepEqual(plain(lots), [
    {
      source: 'AuctionNinja',
      id: '555',
      lot: '16',
      title: "An Antique French Mahogany Sideboard, C. 1930's.",
      url: 'https://www.auctionninja.com/clearinghouseestatesales/product/sideboard--555.html',
      image: 'https://images.example.test/sideboard.jpg',
      highBid: 'Current Bid: $920.00',
      highBidAmount: 920,
      currentPrice: 920,
      currentBid: 920,
      timeLeft: '3 minutes 40 seconds left',
      status: '',
      description: '',
      watched: false,
    },
  ]);
  assert.equal(JSON.stringify(lots).includes('Bid Now'), false);
});

test('assistant renders AuctionNinja scraper-only drawer controls and brief context', () => {
  const core = loadCore();
  const html = core.buildPanelHtml({ mode: 'auctionninja', debugEnabled: false });

  assert.match(html, /AuctionNinja/);
  assert.match(html, /id="auctionninja-catalog-copy-json"/);
  assert.match(html, /id="auctionninja-catalog-copy-llm"/);
  assert.match(html, /id="hibid-scraper-stop"/);
  assert.doesNotMatch(html, /id="auctionninja-catalog-load"/);
  assert.doesNotMatch(html, /id="hibid-max-plan-details"|id="hibid-bid-plan-json"|Max plan/);
  assert.doesNotMatch(html, /id="hibid-bid-next"/);
  assert.doesNotMatch(html, /id="hibid-live-snipe"/);
  assert.doesNotMatch(html, /id="fliptracker-listing-download"/);
  assert.doesNotMatch(html, /id="hibid-debug-copy"/);
  assert.doesNotMatch(html, /id="hibid-bid-results"/);
  assert.match(html, /id="flipperaddon-toast"/);

  const brief = core.buildAuctionNinjaLlmBrief([
    {
      source: 'AuctionNinja',
      lot: '16',
      title: "An Antique French Mahogany Sideboard, C. 1930's.",
      highBidAmount: 920,
      timeLeft: '3 minutes 40 seconds left',
    },
  ], {
    source: 'AuctionNinja',
    title: 'Upper West Side Brownstone',
    buyerPremium: '18%',
    pickupWindow: 'Saturday, 7/11, 12:00 pm to 3:00 pm',
    shipping: 'Shipping Available',
    specialInstructions: 'Items not picked up within this timeframe are forfeited without refund.',
  });

  assert.match(brief, /AuctionNinja sale terms/i);
  assert.match(brief, /buyer premium: 18%/i);
  assert.match(brief, /Saturday, 7\/11/);
  assert.match(brief, /sold\/completed comps first, profit second, hunches last/i);
});

test('assistant extracts AuctionNinja followed item rows for watchlist export', () => {
  const core = loadCore();
  const itemLink = makeFakeNode({
    text: 'Chloe Eau De Toilette Spray',
    attrs: { href: 'https://www.auctionninja.com/clearinghouseestatesales/product/chloe-spray--243760.html' },
  });
  const saleLink = makeFakeNode({
    text: 'The Luxe Edit',
    attrs: { href: 'https://www.auctionninja.com/clearinghouseestatesales/sales/details/the-luxe-edit--17395.html' },
  });
  const image = makeFakeNode({ attrs: { src: 'https://images.example.test/chloe.jpg' } });
  const row = makeFakeNode({
    text: `The Luxe Edit
Chloe Eau De Toilette Spray
Lot #: 1627sf
Current Bid
$38.00
1 Bid
10s
Shipping Available
New York, NY
Following`,
    selectors: {
      'a[href*="/product/"]': itemLink,
      'a[href*="/sales/details/"]': saleLink,
      'img': image,
    },
  });
  const root = makeFakeNode({
    text: 'Items I am following',
    selectors: {
      '.account-item-card': [row],
    },
  });

  const items = core.extractAuctionNinjaFollowedItems(root, new URL('https://www.auctionninja.com/followed-items?an=b7k7t5kpfyo'));

  assert.deepEqual(plain(items), [
    {
      source: 'AuctionNinja',
      pageKind: 'followed-items',
      id: '243760',
      lot: '1627sf',
      title: 'Chloe Eau De Toilette Spray',
      url: 'https://www.auctionninja.com/clearinghouseestatesales/product/chloe-spray--243760.html',
      image: 'https://images.example.test/chloe.jpg',
      saleTitle: 'The Luxe Edit',
      saleUrl: 'https://www.auctionninja.com/clearinghouseestatesales/sales/details/the-luxe-edit--17395.html',
      seller: '',
      status: 'Following',
      priceText: 'Current Bid: $38.00',
      price: 38,
      bidCount: 1,
      timeText: '10s',
      location: 'New York, NY',
      shippingText: 'Shipping Available',
      pickupText: '',
      rawText: 'The Luxe Edit Chloe Eau De Toilette Spray Lot #: 1627sf Current Bid $38.00 1 Bid 10s Shipping Available New York, NY Following',
    },
  ]);
});

test('assistant infers AuctionNinja account titles when product links have no readable text', () => {
  const core = loadCore();
  const itemLink = makeFakeNode({
    text: '',
    attrs: { href: 'https://www.auctionninja.com/timeless-treasures-estate-sales/product/9pc-media-tower-audiosource-nikko-panasonic-dbx-nakamichi-985797.html' },
  });
  const saleLink = makeFakeNode({
    text: 'Levittown - Online Estate Sale - Fiction Books, Womens Clothing, Outdo...',
    attrs: { href: 'https://www.auctionninja.com/timeless-treasures-estate-sales/sales/details/levittown-online-estate-sale--3667.html' },
  });
  const row = makeFakeNode({
    text: `Current Bid$5.00
Your Max Bid: $150.00
21 hours 17 minutes left
HIGH BIDDER
if(document.getElementById("MAXBIDID_3667_985797")){ document.getElementById("MAXBIDID_3667_985797").style.color="#21732E"; }
9pc Media Tower- AudioSource, Nikko, Panasonic, DBX, Nakamichi
Levittown - Online Estate Sale - Fiction Books, Womens Clothing, Outdo...
Lot #: 178
Bid Now
Timeless Treasures Estate Sales
Levittown, New York`,
    selectors: {
      'a[href*="/product/"]': itemLink,
      'a[href*="/sales/details/"]': saleLink,
    },
  });
  const root = makeFakeNode({
    text: 'Items I am following (Total: 1)',
    selectors: {
      '.account-item-card': [row],
    },
  });

  const items = core.extractAuctionNinjaFollowedItems(root, new URL('https://www.auctionninja.com/followed-items?an=b7k7t5kpfyo'));

  assert.equal(items.length, 1);
  assert.equal(items[0].title, '9pc Media Tower- AudioSource, Nikko, Panasonic, DBX, Nakamichi');
  assert.equal(items[0].timeText, '21 hours 17 minutes left');
});

test('assistant does not treat item model years as AuctionNinja countdown text', () => {
  const core = loadCore();
  const itemLink = makeFakeNode({
    text: '',
    attrs: { href: 'https://www.auctionninja.com/the-pickers-alley/product/voigtlnder-perkeo-i-folding-camera-1950s-4347245.html' },
  });
  const saleLink = makeFakeNode({
    text: "Grandma's Attic - Christmas in July! Holiday Decor, Vintage, Collectib...",
    attrs: { href: 'https://www.auctionninja.com/the-pickers-alley/sales/details/grandmas-attic--20000.html' },
  });
  const row = makeFakeNode({
    text: `Current Bid$5.00
3 days 21 hours left
Voigtlnder Perkeo I Folding Camera - 1950s
Grandma's Attic - Christmas in July! Holiday Decor, Vintage, Collectib...
Lot #: 4
Bid Now
The Pickers Alley
Morganville, New Jersey`,
    selectors: {
      'a[href*="/product/"]': itemLink,
      'a[href*="/sales/details/"]': saleLink,
    },
  });
  const root = makeFakeNode({
    text: 'Items I am following (Total: 1)',
    selectors: {
      '.account-item-card': [row],
    },
  });

  const items = core.extractAuctionNinjaFollowedItems(root, new URL('https://www.auctionninja.com/followed-items?an=b7k7t5kpfyo'));

  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Voigtlnder Perkeo I Folding Camera - 1950s');
  assert.equal(items[0].timeText, '3 days 21 hours left');
});

test('assistant extracts AuctionNinja won item rows for inventory export', () => {
  const core = loadCore();
  const itemLink = makeFakeNode({
    text: 'Smart Cat Feeder - 6-L Dispenser',
    attrs: { href: 'https://www.auctionninja.com/clearinghouseestatesales/product/smart-cat-feeder--10016.html' },
  });
  const saleLink = makeFakeNode({
    text: 'Warehouse Finds',
    attrs: { href: 'https://www.auctionninja.com/clearinghouseestatesales/sales/details/warehouse-finds--18000.html' },
  });
  const row = makeFakeNode({
    text: `Warehouse Finds
Smart Cat Feeder - 6-L Dispenser
Lot #: 16
Price Realized:
$8.00
Won
Shipping Available
Pickup: Saturday 10 AM`,
    selectors: {
      'a[href*="/product/"]': itemLink,
      'a[href*="/sales/details/"]': saleLink,
    },
  });
  const root = makeFakeNode({
    text: 'Items Won (Total: 1) 2026 Quick Search',
    selectors: {
      '.account-item-card': [row],
    },
  });

  const items = core.extractAuctionNinjaWonItems(root, new URL('https://www.auctionninja.com/items-won?an=hwfmhr2h2qi'));

  assert.equal(items.length, 1);
  assert.equal(items[0].pageKind, 'items-won');
  assert.equal(items[0].title, 'Smart Cat Feeder - 6-L Dispenser');
  assert.equal(items[0].priceText, 'Price Realized: $8.00');
  assert.equal(items[0].price, 8);
  assert.equal(items[0].status, 'Won');
  assert.equal(items[0].pickupText, 'Pickup: Saturday 10 AM');
  assert.equal(items[0].saleTitle, 'Warehouse Finds');
});

test('assistant extracts AuctionNinja bid history rows for decision review', () => {
  const core = loadCore();
  const itemLink = makeFakeNode({
    text: 'Antique Brass Floor Lamp',
    attrs: { href: 'https://www.auctionninja.com/clearinghouseestatesales/product/antique-brass-floor-lamp--777.html' },
  });
  const saleLink = makeFakeNode({
    text: 'Brownstone Downsizing',
    attrs: { href: 'https://www.auctionninja.com/clearinghouseestatesales/sales/details/brownstone-downsizing--18077.html' },
  });
  const row = makeFakeNode({
    text: `Brownstone Downsizing
Antique Brass Floor Lamp
Lot #: 44
Your Max Bid: $70.00
Current Bid
$52.00
Outbid
7 Bids
Bidding Closed
New York, NY
Clearing House Estate Sales`,
    selectors: {
      'a[href*="/product/"]': itemLink,
      'a[href*="/sales/details/"]': saleLink,
    },
  });
  const root = makeFakeNode({
    text: 'Bid History (Total: 1)',
    selectors: {
      '.account-item-card': [row],
    },
  });

  const items = core.extractAuctionNinjaBidHistoryItems(root, new URL('https://www.auctionninja.com/bid-history?an=sp2i8ac5q0n'));

  assert.equal(items.length, 1);
  assert.equal(items[0].pageKind, 'bid-history');
  assert.equal(items[0].title, 'Antique Brass Floor Lamp');
  assert.equal(items[0].priceText, 'Current Bid: $52.00');
  assert.equal(items[0].yourBidText, 'Your Max Bid: $70.00');
  assert.equal(items[0].yourBid, 70);
  assert.equal(items[0].status, 'Outbid');
  assert.equal(items[0].bidCount, 7);
  assert.equal(items[0].timeText, 'Bidding Closed');
});

test('assistant extracts AuctionNinja nearby auction search sales', () => {
  const core = loadCore();
  const saleLink = makeFakeNode({
    text: 'Dumont New Jersey Estate Sale',
    attrs: { href: 'https://www.auctionninja.com/pinkladyliquidation/sales/details/dumont-new-jersey-estate-sale--21001.html' },
  });
  const countLink = makeFakeNode({
    text: '561 Lots',
    attrs: { href: 'https://www.auctionninja.com/pinkladyliquidation/sales/details/dumont-new-jersey-estate-sale--21001.html' },
  });
  const sellerLink = makeFakeNode({
    text: 'Pink Lady Liquidation',
    attrs: { href: 'https://www.auctionninja.com/pinkladyliquidation/' },
  });
  const image = makeFakeNode({ attrs: { src: 'https://images.example.test/dumont.jpg' } });
  const row = makeFakeNode({
    text: `Dumont New Jersey Estate Sale
Dumont, NJ Local Pickup Only
Begins to close
Thu, Jul 16 2026 @ 8:00 PM EDT
Pink Lady Liquidation
561 Lots`,
    selectors: {
      'a[href*="/sales/details/"]': [countLink, saleLink],
      'a[href]:not([href*="/sales/details/"])': sellerLink,
      'img': image,
    },
  });
  const root = makeFakeNode({
    text: '108 auctions near Carteret, NJ 1 2 3 Next',
    selectors: {
      'a[href*="/sales/details/"]': saleLink,
      '.auction-item': [row],
    },
  });

  const sales = core.extractAuctionNinjaAuctionSearchSales(root, new URL('https://www.auctionninja.com/nj/carteret/07008?miles=50&an='));

  assert.deepEqual(plain(sales), [
    {
      source: 'AuctionNinja',
      pageKind: 'auction-search',
      id: '21001',
      title: 'Dumont New Jersey Estate Sale',
      url: 'https://www.auctionninja.com/pinkladyliquidation/sales/details/dumont-new-jersey-estate-sale--21001.html',
      image: 'https://images.example.test/dumont.jpg',
      seller: 'Pink Lady Liquidation',
      sellerUrl: 'https://www.auctionninja.com/pinkladyliquidation/',
      location: 'Dumont, NJ',
      shippingText: 'Local Pickup Only',
      closingText: 'Thu, Jul 16 2026 @ 8:00 PM EDT',
      itemCount: 561,
      rawText: 'Dumont New Jersey Estate Sale Dumont, NJ Local Pickup Only Begins to close Thu, Jul 16 2026 @ 8:00 PM EDT Pink Lady Liquidation 561 Lots',
    },
  ]);
});

test('assistant recovers AuctionNinja auction-search title when sale link is count-only', () => {
  const core = loadCore();
  const countOnlySaleLink = makeFakeNode({
    text: '(9)',
    attrs: { href: 'https://www.auctionninja.com/estatepros/sales/details/designer-handbags-and-estate-jewelry--22009.html' },
  });
  const sellerLink = makeFakeNode({
    text: 'Estate Pros',
    attrs: { href: 'https://www.auctionninja.com/estatepros/' },
  });
  const row = makeFakeNode({
    text: `Designer Handbags And Estate Jewelry
(9)
Paramus, NJ Shipping Available
Begins to close
Sat, Jul 18 2026 @ 7:30 PM EDT
Estate Pros`,
    selectors: {
      'a[href*="/sales/details/"]': countOnlySaleLink,
      'a[href]:not([href*="/sales/details/"])': sellerLink,
    },
  });
  const root = makeFakeNode({
    text: '108 auctions near Carteret, NJ',
    selectors: {
      '.auction-item': [row],
      'a[href*="/sales/details/"]': countOnlySaleLink,
    },
  });

  const sales = core.extractAuctionNinjaAuctionSearchSales(root, new URL('https://www.auctionninja.com/nj/carteret/07008?miles=50&an='));

  assert.equal(sales.length, 1);
  assert.equal(sales[0].title, 'Designer Handbags And Estate Jewelry');
  assert.equal(sales[0].url, 'https://www.auctionninja.com/estatepros/sales/details/designer-handbags-and-estate-jewelry--22009.html');
});

test('assistant renders AuctionNinja account-page copy controls only', () => {
  const core = loadCore();
  const followed = core.buildPanelHtml({
    mode: 'auctionninja',
    debugEnabled: false,
    route: { kind: 'followed-items' },
  });
  const won = core.buildPanelHtml({
    mode: 'auctionninja',
    debugEnabled: false,
    route: { kind: 'items-won' },
  });
  const bidHistory = core.buildPanelHtml({
    mode: 'auctionninja',
    debugEnabled: false,
    route: { kind: 'bid-history' },
  });
  const auctionSearch = core.buildPanelHtml({
    mode: 'auctionninja',
    debugEnabled: false,
    route: { kind: 'auction-search' },
  });

  assert.match(followed, /Copy Watchlist LLM/);
  assert.match(followed, /id="auctionninja-account-copy-json"/);
  assert.doesNotMatch(followed, /Copy LLM Brief|Sale Catalog Research|Max plan|Prepare Bid|Snipe Now|checkout|invoice|payment/i);

  assert.match(won, /Copy Won Items LLM/);
  assert.match(won, /id="auctionninja-account-copy-json"/);
  assert.doesNotMatch(won, /Copy LLM Brief|Sale Catalog Research|Max plan|Prepare Bid|Snipe Now|checkout|invoice|payment/i);

  assert.match(bidHistory, /Copy Bid History LLM/);
  assert.match(bidHistory, /id="auctionninja-account-copy-json"/);
  assert.doesNotMatch(bidHistory, /Copy LLM Brief|Sale Catalog Research|Copy Won Items LLM|Max plan|Prepare Bid|Snipe Now|checkout|invoice|payment/i);

  assert.match(auctionSearch, /Copy Auctions LLM/);
  assert.match(auctionSearch, /id="auctionninja-auctions-copy-json"/);
  assert.doesNotMatch(auctionSearch, /Copy Watchlist LLM|Copy Won Items LLM|Sale Catalog Research|Max plan|Prepare Bid|Snipe Now|checkout|invoice|payment/i);
});

test('assistant builds AuctionNinja account briefs and empty account exports', () => {
  const core = loadCore();
  const emptyRoot = makeFakeNode({ text: 'Items I am following DASHBOARD' });

  assert.deepEqual(plain(core.extractAuctionNinjaFollowedItems(emptyRoot, new URL('https://www.auctionninja.com/followed-items'))), []);
  assert.deepEqual(plain(core.extractAuctionNinjaWonItems(emptyRoot, new URL('https://www.auctionninja.com/items-won'))), []);

  const followedBrief = core.buildAuctionNinjaFollowedItemsLlmBrief([
    {
      source: 'AuctionNinja',
      pageKind: 'followed-items',
      lot: '1627sf',
      title: 'Chloe Eau De Toilette Spray',
      priceText: 'Current Bid: $38.00',
      timeText: '10s',
    },
  ], { source: 'AuctionNinja', pageKind: 'followed-items', title: 'Items I am following' });
  const wonBrief = core.buildAuctionNinjaWonItemsLlmBrief([
    {
      source: 'AuctionNinja',
      pageKind: 'items-won',
      lot: '16',
      title: 'Smart Cat Feeder',
      priceText: 'Price Realized: $8.00',
      status: 'Won',
    },
  ], { source: 'AuctionNinja', pageKind: 'items-won', title: 'Items Won' });

  assert.match(followedBrief, /You are an auction resale analysis coordinator/);
  assert.match(followedBrief, /active opportunity review/i);
  assert.match(followedBrief, /Do not bid from this brief/i);
  assert.match(followedBrief, /"pageKind": "followed-items"/);

  assert.match(wonBrief, /post-win inventory/i);
  assert.match(wonBrief, /listing priority/i);
  assert.match(wonBrief, /reconciliation/i);
  assert.match(wonBrief, /"pageKind": "items-won"/);

  const bidBrief = core.buildAuctionNinjaBidHistoryLlmBrief([
    {
      source: 'AuctionNinja',
      pageKind: 'bid-history',
      lot: '44',
      title: 'Antique Brass Floor Lamp',
      priceText: 'Current Bid: $52.00',
      yourBidText: 'Your Max Bid: $70.00',
      status: 'Outbid',
    },
  ], { source: 'AuctionNinja', pageKind: 'bid-history', title: 'Bid History' });

  assert.match(bidBrief, /bid history review/i);
  assert.match(bidBrief, /missed opportunities/i);
  assert.match(bidBrief, /Do not bid from this brief/i);
  assert.match(bidBrief, /"pageKind": "bid-history"/);
});

test('assistant builds AuctionNinja auction-search brief for whole-sale triage', () => {
  const core = loadCore();
  const brief = core.buildAuctionNinjaAuctionSearchLlmBrief([
    {
      source: 'AuctionNinja',
      pageKind: 'auction-search',
      title: 'Dumont New Jersey Estate Sale',
      location: 'Dumont, NJ',
      shippingText: 'Local Pickup Only',
      closingText: 'Thu, Jul 16 2026 @ 8:00 PM EDT',
      itemCount: 561,
    },
  ], {
    source: 'AuctionNinja',
    pageKind: 'auction-search',
    title: 'Auction search near Carteret, NJ',
    url: 'https://www.auctionninja.com/nj/carteret/07008?miles=50&an=',
    searchLocation: 'Carteret, NJ 07008',
    miles: '50',
  });

  assert.match(brief, /whole-auction triage/i);
  assert.match(brief, /rank sales/i);
  assert.match(brief, /sold\/completed comps first/i);
  assert.match(brief, /"pageKind": "auction-search"/);
});
