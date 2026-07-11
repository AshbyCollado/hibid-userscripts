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
    ['https://hibid.com/account/currentbids?status=WINNING', 'currentbids-winning'],
    ['https://hibid.com/account/currentbids?status=OUTBID', 'currentbids-outbid'],
  ];

  cases.forEach(([href, kind]) => {
    const resolved = core.resolveHiBidPage(new URL(href));
    assert.equal(resolved.supported, true, href);
    assert.equal(resolved.kind, kind, href);
    assert.equal(core.shouldInitOnLocation(new URL(href)), true, href);
  });

  assert.equal(core.shouldInitOnLocation(new URL('https://hibid.com/account/watchlist')), false);
  assert.equal(core.shouldInitOnLocation(new URL('https://hibid.com/account/currentbids')), false);
  assert.equal(core.shouldInitOnLocation(new URL('https://hibid.com/account/currentbids?status=CLOSED')), false);
  assert.equal(core.shouldInitOnLocation(new URL('https://hibid.com/help')), false);
});

test('assistant resolves AJ Willner auction pages as source-aware catalog exports', () => {
  const core = loadCore();
  const loc = new URL('https://bid.ajwillnerauctions.com/ui/auctions/164037?category=All&subCategory=Active');
  const mode = core.resolveAssistantMode(loc);

  assert.equal(core.shouldInitOnLocation(loc), true);
  assert.equal(mode.mode, 'catalog');
  assert.equal(mode.source, 'ajwillner');
  assert.equal(mode.route.auctionId, '164037');

  const html = core.buildPanelHtml({ mode: 'catalog', route: mode.route, debugEnabled: false });
  assert.match(html, /AJ Willner/);
  assert.match(html, /AJ Willner Catalog Export/);
  assert.doesNotMatch(html, />HiBid catalog</);
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

test('assistant extracts AJ Willner virtual-list cards as catalog lots', () => {
  const core = loadCore();
  const link = makeFakeNode({
    text: '#32 \u2022 Rowe "Moore" Upholstered Sofa',
    attrs: { href: '/ui/auctions/164037/24887841' },
  });
  const title = makeFakeNode({ text: '#32 \u2022 Rowe "Moore" Upholstered Sofa' });
  const description = makeFakeNode({
    text: 'Quantity: 1\nDimensions: 93W x 40D x 33H\nMSRP: $4,639',
  });
  const bid = makeFakeNode({ text: 'High bid $100' });
  const status = makeFakeNode({ text: 'ENDS 4d 10h 18min' });
  const image = makeFakeNode({ attrs: { src: 'https://images.example.test/sofa.jpg' } });
  const card = makeFakeNode({
    text: 'ENDS 4d 10h 18min #32 \u2022 Rowe "Moore" Upholstered Sofa Quantity: 1 Dimensions: 93W x 40D x 33H MSRP: $4,639 High bid $100',
    attrs: { 'data-testid': 'list-item-24887841' },
    selectors: {
      '.titleLink[href]': link,
      '.titleLink h1': title,
      '.description': description,
      '.bidsLine': bid,
      '[data-testid="list-item-24887841-status-stripe"]': status,
      'img': image,
    },
  });
  const root = makeFakeNode({
    text: '866 items found in Active',
    selectors: {
      '[data-testid^="list-item-"]': [card],
    },
  });

  const lots = core.extractAjWillnerVisibleListings(root, new URL('https://bid.ajwillnerauctions.com/ui/auctions/164037?category=All&subCategory=Active'));

  assert.deepEqual(plain(lots), [
    {
      source: 'ajwillner',
      id: '24887841',
      lot: '32',
      title: 'Rowe "Moore" Upholstered Sofa',
      url: 'https://bid.ajwillnerauctions.com/ui/auctions/164037/24887841',
      image: 'https://images.example.test/sofa.jpg',
      description: 'Quantity: 1 Dimensions: 93W x 40D x 33H MSRP: $4,639',
      highBid: 'High bid $100',
      highBidAmount: 100,
      currentPrice: 100,
      currentBid: 100,
      nextBid: '',
      nextBidAmount: null,
      bidCount: '',
      bidCountNumber: null,
      timeLeft: '4d 10h 18min',
      status: 'ENDS 4d 10h 18min',
      userBidStatus: '',
      isWinning: false,
      isOutbid: false,
      watched: false,
      rawText: 'ENDS 4d 10h 18min #32 \u2022 Rowe "Moore" Upholstered Sofa Quantity: 1 Dimensions: 93W x 40D x 33H MSRP: $4,639 High bid $100',
    },
  ]);
});

test('assistant uses an overlapping AJ Willner virtual-scroll stride', () => {
  const core = loadCore();
  assert.equal(core.getAjWillnerScrollStepSize({ clientHeight: 857 }), 360);
  assert.equal(core.getAjWillnerScrollStepSize({ clientHeight: 300 }), 180);
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

test('assistant fails closed when filtered HiBid page has no matches but Apollo has broad catalog data', () => {
  const core = loadCore();
  const loc = new URL('https://hibid.com/catalog/757032/overstock-product-liquidation-nj-w27---great-deals?g=-1&q=lebron');
  const root = {
    body: { textContent: 'Quick Search No matches found. Try adjusting your filters or Browse All Lots' },
    documentElement: { textContent: 'Quick Search No matches found. Try adjusting your filters or Browse All Lots' },
    querySelectorAll() {
      return [];
    },
  };
  const visibleState = core.extractHibidVisiblePageState(root, loc);
  const apolloState = {
    ROOT_QUERY: {
      'lotSearch({"apage":1})': {
        pagedResults: {
          totalCount: 455,
          pageLength: 100,
          pageNumber: 1,
          results: [{ __ref: 'Lot:card' }, { __ref: 'Lot:jewelry' }],
        },
      },
    },
    'Lot:card': {
      id: 'card',
      lotNumber: '236',
      lead: '2004 Topps Chrome #55 Rose/Lebron /500 PSA 8!',
      lotState: { highBid: 175, minBid: 180, bidCount: 12, status: 'OPEN' },
    },
    'Lot:jewelry': {
      id: 'jewelry',
      lotNumber: '27003',
      lead: 'Curb Link Bracelet in 14k Yellow Gold',
      lotState: { highBid: 1975, minBid: 2000, bidCount: 33, status: 'OPEN' },
    },
  };

  assert.equal(visibleState.noMatches, true);
  assert.equal(visibleState.hasActiveFilters, true);
  assert.deepEqual(plain(visibleState.filters), { g: '-1', q: 'lebron' });

  const result = core.extractHibidApolloLots(apolloState, {
    url: loc.href,
    visibleState,
  });

  assert.deepEqual(plain(result.items), []);
  assert.equal(result.expectedTotal, 0);
  assert.equal(result.rejectedSource, 'filter-mismatch');
});

test('assistant uses filtered HiBid Apollo connection when it matches active search text', () => {
  const core = loadCore();
  const loc = new URL('https://hibid.com/catalog/757032/overstock-product-liquidation-nj-w27---great-deals?g=-1&q=lebron');
  const root = {
    body: { textContent: 'Quick Search lebron' },
    documentElement: { textContent: 'Quick Search lebron' },
    querySelectorAll() {
      return [];
    },
  };
  const visibleState = core.extractHibidVisiblePageState(root, loc);
  const apolloState = {
    ROOT_QUERY: {
      'lotSearch({"apage":1})': {
        pagedResults: {
          totalCount: 455,
          pageLength: 100,
          pageNumber: 1,
          results: [{ __ref: 'Lot:jewelry' }],
        },
      },
      'lotSearch({"q":"lebron","g":"-1","apage":1})': {
        pagedResults: {
          totalCount: 1,
          pageLength: 100,
          pageNumber: 1,
          results: [{ __ref: 'Lot:lebron' }],
        },
      },
    },
    'Lot:jewelry': {
      id: 'jewelry',
      lotNumber: '27003',
      lead: 'Curb Link Bracelet in 14k Yellow Gold',
      lotState: { highBid: 1975, minBid: 2000, bidCount: 33, status: 'OPEN' },
    },
    'Lot:lebron': {
      id: 'lebron',
      lotNumber: '236',
      lead: '2004 Topps Chrome #55 Rose/Lebron /500 PSA 8!',
      lotState: { highBid: 175, minBid: 180, bidCount: 12, status: 'OPEN' },
    },
  };

  const result = core.extractHibidApolloLots(apolloState, {
    url: loc.href,
    visibleState,
  });

  assert.equal(result.expectedTotal, 1);
  assert.deepEqual(plain(result.items.map(lot => lot.id)), ['lebron']);
});

test('assistant rejects ambiguous HiBid Apollo data on active filtered pages', () => {
  const core = loadCore();
  const loc = new URL('https://hibid.com/catalog/757032/overstock-product-liquidation-nj-w27---great-deals?g=-1&q=lebron');
  const visibleState = core.extractHibidVisiblePageState({
    body: { textContent: 'Quick Search lebron' },
    documentElement: { textContent: 'Quick Search lebron' },
    querySelectorAll() {
      return [];
    },
  }, loc);
  const apolloState = {
    ROOT_QUERY: {
      'lotSearch({"apage":1})': {
        pagedResults: {
          totalCount: 455,
          pageLength: 100,
          pageNumber: 1,
          results: [{ __ref: 'Lot:jewelry' }],
        },
      },
    },
    'Lot:jewelry': {
      id: 'jewelry',
      lotNumber: '27003',
      lead: 'Curb Link Bracelet in 14k Yellow Gold',
      lotState: { highBid: 1975, minBid: 2000, bidCount: 33, status: 'OPEN' },
    },
  };

  const result = core.extractHibidApolloLots(apolloState, {
    url: loc.href,
    visibleState,
  });

  assert.deepEqual(plain(result.items), []);
  assert.equal(result.rejectedSource, 'filter-mismatch');
});

test('assistant does not accept broad Apollo totals as proof of search-filter matches', () => {
  const core = loadCore();
  const loc = new URL('https://hibid.com/catalog/757032/overstock-product-liquidation-nj-w27---great-deals?g=-1&q=lebron');
  const visibleState = core.extractHibidVisiblePageState({
    body: { textContent: 'Showing 1 to 100 of 138 lots Lot 1 Kids Toy Lot 2 Generic Watch' },
    documentElement: { textContent: 'Showing 1 to 100 of 138 lots Lot 1 Kids Toy Lot 2 Generic Watch' },
    querySelectorAll() {
      return [];
    },
  }, loc);
  const apolloState = {
    ROOT_QUERY: {
      'lotSearch({"apage":1})': {
        pagedResults: {
          totalCount: 138,
          pageLength: 100,
          pageNumber: 1,
          results: [{ __ref: 'Lot:toy' }],
        },
      },
    },
    'Lot:toy': {
      id: 'toy',
      lotNumber: '1',
      lead: 'Kids Toy',
      lotState: { highBid: 6, minBid: 8, bidCount: 1, status: 'OPEN' },
    },
  };

  const result = core.extractHibidApolloLots(apolloState, {
    url: loc.href,
    expectedTotal: 138,
    visibleState,
  });

  assert.deepEqual(plain(result.items), []);
  assert.equal(result.rejectedSource, 'filter-mismatch');
});

test('assistant rejects contradictory HiBid exports against visible no-match state', () => {
  const core = loadCore();
  const visibleState = core.extractHibidVisiblePageState({
    body: { textContent: 'No matches found. Try adjusting your filters.' },
    documentElement: { textContent: 'No matches found. Try adjusting your filters.' },
    querySelectorAll() {
      return [];
    },
  }, new URL('https://hibid.com/catalog/757032/overstock-product-liquidation-nj-w27---great-deals?g=-1&q=lebron'));

  assert.deepEqual(plain(core.validateCatalogExportAgainstVisibleState({
    source: 'hibid-state',
    items: [{ id: 'broad', title: 'Broad stale lot' }],
    expectedTotal: 455,
  }, visibleState)), {
    ok: false,
    reason: 'visible-no-matches-with-exported-lots',
  });
});

test('assistant blocks DOM fallback exports when search-filtered lots do not match the query', () => {
  const core = loadCore();
  const visibleState = core.extractHibidVisiblePageState({
    body: { textContent: 'Showing 1 to 100 of 138 lots Lot 1 Kids Toy Lot 2 Generic Watch' },
    documentElement: { textContent: 'Showing 1 to 100 of 138 lots Lot 1 Kids Toy Lot 2 Generic Watch' },
    querySelectorAll() {
      return [];
    },
  }, new URL('https://hibid.com/catalog/757032/overstock-product-liquidation-nj-w27---great-deals?g=-1&q=lebron'));

  assert.deepEqual(plain(core.validateCatalogExportAgainstVisibleState({
    source: 'dom-fallback',
    items: [{ id: 'toy', title: 'Kids Toy' }],
    expectedTotal: 138,
  }, visibleState)), {
    ok: false,
    reason: 'filtered-search-results-do-not-match-query',
  });
});

test('assistant blocks AuctionNinja exports from the wrong active page kind', () => {
  const core = loadCore();

  assert.deepEqual(plain(core.validateScraperExportAgainstRoute({
    source: 'auctionninja-auction-search-dom',
    context: { source: 'AuctionNinja', pageKind: 'auction-search' },
    items: [{ source: 'AuctionNinja', pageKind: 'auction-search', title: 'Estate Sale' }],
  }, 'auctionninja', { kind: 'followed-items' })), {
    ok: false,
    reason: 'auctionninja-page-kind-mismatch',
  });

  assert.deepEqual(plain(core.validateScraperExportAgainstRoute({
    source: 'auctionninja-account-dom',
    context: { source: 'AuctionNinja', pageKind: 'bid-history' },
    items: [{ source: 'AuctionNinja', pageKind: 'bid-history', title: 'Brass Floor Lamp' }],
  }, 'auctionninja', { kind: 'bid-history' })), {
    ok: true,
  });

  const sharedSales = [{ source: 'AuctionNinja', pageKind: 'auction-search', title: 'Single Search Result' }];
  assert.deepEqual(plain(core.validateScraperExportAgainstRoute({
    source: 'auctionninja-auction-search-dom',
    context: { source: 'AuctionNinja', pageKind: 'auction-search', totalSales: 1 },
    items: sharedSales,
    sales: sharedSales,
    expectedTotal: 1,
  }, 'auctionninja', { kind: 'auction-search' })), {
    ok: true,
  });

  assert.deepEqual(plain(core.validateScraperExportAgainstRoute({
    source: 'auctionninja-auction-search-dom',
    context: { source: 'AuctionNinja', pageKind: 'auction-search', totalSales: 2 },
    items: [
      { source: 'AuctionNinja', pageKind: 'auction-search', title: 'Sale 1' },
      { source: 'AuctionNinja', pageKind: 'auction-search', title: 'Sale 2' },
      { source: 'AuctionNinja', pageKind: 'auction-search', title: 'Stale Extra Sale' },
    ],
    expectedTotal: 2,
  }, 'auctionninja', { kind: 'auction-search' })), {
    ok: false,
    reason: 'auctionninja-count-exceeds-expected',
  });

  assert.deepEqual(plain(core.validateScraperExportAgainstRoute({
    source: 'auctionninja-auction-search-dom',
    context: { source: 'AuctionNinja', pageKind: 'auction-search', totalSales: 3 },
    items: [{ source: 'AuctionNinja', pageKind: 'auction-search', title: 'Partial Sale' }],
    expectedTotal: 3,
    incomplete: true,
  }, 'auctionninja', { kind: 'auction-search' })), {
    ok: false,
    reason: 'auctionninja-incomplete',
  });
});

test('assistant supports HiBid winning and outbid current-bids exports only', () => {
  const core = loadCore();
  const winning = core.resolveAssistantMode(new URL('https://hibid.com/account/currentbids?status=WINNING'));
  const outbid = core.resolveAssistantMode(new URL('https://hibid.com/account/currentbids?status=OUTBID'));

  assert.equal(winning.mode, 'catalog');
  assert.equal(winning.source, 'hibid');
  assert.equal(winning.route.kind, 'currentbids-winning');
  assert.equal(outbid.mode, 'catalog');
  assert.equal(outbid.source, 'hibid');
  assert.equal(outbid.route.kind, 'currentbids-outbid');

  assert.deepEqual(plain(core.validateScraperExportAgainstRoute({
    source: 'dom-fallback',
    items: [{ lot: '26', title: 'Air Purifier', userBidStatus: 'Winning' }],
  }, 'catalog', winning.route)), {
    ok: true,
  });

  assert.deepEqual(plain(core.validateScraperExportAgainstRoute({
    source: 'auctionninja-account-dom',
    context: { source: 'AuctionNinja', pageKind: 'followed-items' },
    items: [{ source: 'AuctionNinja', pageKind: 'followed-items', title: 'Wrong Site' }],
  }, 'catalog', outbid.route)), {
    ok: false,
    reason: 'catalog-source-mismatch',
  });

  const winningHtml = core.buildPanelHtml({ mode: 'catalog', route: winning.route, debugEnabled: false });
  const outbidHtml = core.buildPanelHtml({ mode: 'catalog', route: outbid.route, debugEnabled: false });
  assert.match(winningHtml, /Winning Bids Export/);
  assert.match(winningHtml, /class="hiba-chip neutral">winning</);
  assert.match(outbidHtml, /Outbid Bids Export/);
  assert.match(outbidHtml, /class="hiba-chip neutral">outbid</);
  assert.doesNotMatch(`${winningHtml}${outbidHtml}`, /Prepare Bid|Snipe Now|Auto-confirm|Max plan/i);
});

test('assistant parses HiBid current-bids account card text fallback', () => {
  const core = loadCore();
  const root = {
    body: {
      textContent: `
        Showing 1 to 18 of 18 lots
        Lot 15 CARD READER
        Unwatch Notes
        10 Bids
        Bidding Closed
        Price Realized:
        50.00 USD / Lot
        Won
        Lot 17 LENOVO TABLETS
        Unwatch Notes
        5 Bids
        Current Bid: 37.50 USD
        Winning
      `,
    },
  };

  const lots = core.extractTextLots(root);
  assert.equal(lots.length, 2);
  assert.deepEqual(plain(lots.map(lot => ({
    lot: lot.lot,
    title: lot.title,
    highBid: lot.highBid,
    bidCount: lot.bidCount,
    userBidStatus: lot.userBidStatus,
  }))), [
    {
      lot: '15',
      title: 'CARD READER',
      highBid: 'High Bid: 50.00 USD / Lot',
      bidCount: '10 Bids',
      userBidStatus: 'Won',
    },
    {
      lot: '17',
      title: 'LENOVO TABLETS',
      highBid: 'High Bid: 37.50 USD',
      bidCount: '5 Bids',
      userBidStatus: 'Winning',
    },
  ]);
});

test('assistant blocks AAR exports from the wrong route or auction id', () => {
  const core = loadCore();

  assert.deepEqual(plain(core.validateScraperExportAgainstRoute({
    source: 'aar-dom',
    context: { source: 'AAR Auctions', pageKind: 'aar-auction-catalog', auctionId: '8563' },
    items: [{ source: 'AAR Auctions', pageKind: 'aar-auction-catalog', auctionId: '8563', title: 'Catalog Lot' }],
  }, 'aar', { kind: 'aar-auction-list' })), {
    ok: false,
    reason: 'aar-page-kind-mismatch',
  });

  assert.deepEqual(plain(core.validateScraperExportAgainstRoute({
    source: 'aar-dom',
    context: { source: 'AAR Auctions', pageKind: 'aar-auction-catalog', auctionId: '9999' },
    lots: [{ source: 'AAR Auctions', pageKind: 'aar-auction-catalog', auctionId: '9999', title: 'Wrong Auction Lot' }],
  }, 'aar', { kind: 'aar-auction-catalog', auctionId: '8563' })), {
    ok: false,
    reason: 'aar-auction-id-mismatch',
  });

  assert.deepEqual(plain(core.validateScraperExportAgainstRoute({
    source: 'aar-dom',
    context: { source: 'AAR Auctions', pageKind: 'aar-auction-list' },
    sales: [{ source: 'AAR Auctions', pageKind: 'aar-auction-list', auctionId: '8563', title: 'Auction Calendar Entry' }],
  }, 'aar', { kind: 'aar-auction-list' })), {
    ok: true,
  });

  assert.deepEqual(plain(core.validateScraperExportAgainstRoute({
    source: 'aar-dom',
    context: { source: 'AAR Auctions', pageKind: 'aar-auction-list' },
    sales: [{ source: 'AAR Auctions', pageKind: 'aar-auction-list', auctionId: '8563', title: 'Partial Auction Calendar Entry' }],
    expectedTotal: 2,
    incomplete: true,
  }, 'aar', { kind: 'aar-auction-list' })), {
    ok: false,
    reason: 'aar-incomplete',
  });
});

test('assistant blocks GovDeals exports from the wrong route or URL filters', () => {
  const core = loadCore();

  assert.deepEqual(plain(core.validateScraperExportAgainstRoute({
    source: 'govdeals-dom',
    context: { source: 'GovDeals', pageKind: 'govdeals-seller' },
    listings: [{ source: 'GovDeals', pageKind: 'govdeals-seller', title: 'Rutgers Asset' }],
  }, 'govdeals', { kind: 'govdeals-new-listings', zipcode: '07008', miles: '25' })), {
    ok: false,
    reason: 'govdeals-page-kind-mismatch',
  });

  assert.deepEqual(plain(core.validateScraperExportAgainstRoute({
    source: 'govdeals-dom',
    context: { source: 'GovDeals', pageKind: 'govdeals-new-listings', zipcode: '07008', miles: '100' },
    listings: [{ source: 'GovDeals', pageKind: 'govdeals-new-listings', title: 'Nearby Asset' }],
  }, 'govdeals', { kind: 'govdeals-new-listings', zipcode: '07008', miles: '25' })), {
    ok: false,
    reason: 'govdeals-filter-mismatch',
  });

  assert.deepEqual(plain(core.validateScraperExportAgainstRoute({
    source: 'govdeals-dom',
    context: { source: 'GovDeals', pageKind: 'govdeals-new-listings', zipcode: '07008', miles: '25' },
    listings: [{ source: 'GovDeals', pageKind: 'govdeals-new-listings', title: 'Nearby Asset' }],
  }, 'govdeals', { kind: 'govdeals-new-listings', zipcode: '07008', miles: '25' })), {
    ok: true,
  });

  assert.deepEqual(plain(core.validateScraperExportAgainstRoute({
    source: 'govdeals-dom',
    context: { source: 'GovDeals', pageKind: 'govdeals-new-listings', zipcode: '07008', miles: '25' },
    listings: [{ source: 'GovDeals', pageKind: 'govdeals-new-listings', title: 'Partial Nearby Asset' }],
    expectedTotal: 2,
    incomplete: true,
  }, 'govdeals', { kind: 'govdeals-new-listings', zipcode: '07008', miles: '25' })), {
    ok: false,
    reason: 'govdeals-incomplete',
  });
});

test('assistant blocks catalog and live exports from the wrong active route', () => {
  const core = loadCore();

  assert.deepEqual(plain(core.validateScraperExportAgainstRoute({
    source: 'hibid-state',
    context: { source: 'hibid', pageKind: 'catalog' },
    items: [{ title: 'HiBid stale lot' }],
  }, 'catalog', { kind: 'catalog', source: 'ajwillner', auctionId: '164037' })), {
    ok: false,
    reason: 'catalog-source-mismatch',
  });

  assert.deepEqual(plain(core.validateScraperExportAgainstRoute({
    source: 'ajwillner-virtual-list',
    context: { source: 'ajwillner', pageKind: 'catalog' },
    items: [{ source: 'ajwillner', title: 'AJ stale lot' }],
  }, 'catalog', { kind: 'catalog', source: 'hibid', auctionId: '757032' })), {
    ok: false,
    reason: 'catalog-source-mismatch',
  });

  assert.deepEqual(plain(core.validateScraperExportAgainstRoute({
    source: 'ajwillner-virtual-list',
    context: { source: 'ajwillner', pageKind: 'catalog' },
    items: [{ source: 'ajwillner', title: 'Wrong AJ auction lot', url: 'https://bid.ajwillnerauctions.com/ui/auctions/999999/24887841' }],
  }, 'catalog', { kind: 'catalog', source: 'ajwillner', auctionId: '164037' })), {
    ok: false,
    reason: 'catalog-auction-id-mismatch',
  });

  assert.deepEqual(plain(core.validateScraperExportAgainstRoute({
    source: 'ajwillner-virtual-list',
    context: { source: 'ajwillner', pageKind: 'catalog' },
    items: [{ source: 'ajwillner', title: 'Partial AJ lot', url: 'https://bid.ajwillnerauctions.com/ui/auctions/164037/24887841' }],
    expectedTotal: 866,
    incomplete: true,
  }, 'catalog', { kind: 'catalog', source: 'ajwillner', auctionId: '164037' })), {
    ok: false,
    reason: 'catalog-incomplete',
  });

  assert.deepEqual(plain(core.validateScraperExportAgainstRoute({
    source: 'hibid-live-dom',
    context: { source: 'hibid', pageKind: 'live' },
    lots: [{ lot: '1627sf', title: 'Chloe Eau De Toilette' }],
    expectedTotal: 1,
  }, 'live', { kind: 'live', source: 'hibid', auctionId: '752334' })), {
    ok: true,
  });

  assert.deepEqual(plain(core.validateScraperExportAgainstRoute({
    source: 'dom-fallback',
    context: { source: 'hibid', pageKind: 'catalog' },
    lots: [{ lot: '1', title: 'Catalog Lot' }],
  }, 'live', { kind: 'catalog', source: 'hibid', auctionId: '752334' })), {
    ok: false,
    reason: 'live-route-mismatch',
  });

  assert.deepEqual(plain(core.validateScraperExportAgainstRoute({
    source: 'hibid-live-dom',
    context: { source: 'hibid', pageKind: 'live' },
    lots: [
      { source: 'hibid', pageKind: 'live', lot: '1', title: 'Live Lot 1' },
      { source: 'hibid', pageKind: 'live', lot: '2', title: 'Live Lot 2' },
    ],
    expectedTotal: 1,
  }, 'live', { kind: 'live', source: 'hibid', auctionId: '752334' })), {
    ok: false,
    reason: 'live-count-exceeds-expected',
  });

  assert.deepEqual(plain(core.validateScraperExportAgainstRoute({
    source: 'hibid-live-dom',
    context: { source: 'hibid', pageKind: 'live' },
    lots: [{ source: 'hibid', pageKind: 'live', lot: '1', title: 'Live Lot 1' }],
    expectedTotal: 3,
    incomplete: true,
  }, 'live', { kind: 'live', source: 'hibid', auctionId: '752334' })), {
    ok: false,
    reason: 'live-incomplete',
  });
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

test('assistant site shortcuts expose fixed auction links only', () => {
  const core = loadCore();
  const shortcuts = core.getSiteShortcuts(new URL('https://www.govdeals.com/en/rutgers'));

  assert.deepEqual(plain(shortcuts.map(item => item.id)), [
    'hibid',
    'ajwillner',
    'auctionninja',
    'aar',
    'govdeals',
  ]);
  assert.deepEqual(plain(shortcuts.map(item => item.url)), [
    'https://hibid.com/lots',
    'https://bid.ajwillnerauctions.com/ui/auctions/164037?category=All&subCategory=Active',
    'https://www.auctionninja.com/nj/carteret/07008?miles=50&an=',
    'https://aarauctions.com/auctions/',
    'https://www.govdeals.com/en/new-listings/filters?zipcode=07008&miles=25',
  ]);
  assert.equal(shortcuts.find(item => item.id === 'govdeals').current, true);
  assert.equal(shortcuts.filter(item => item.current).length, 1);
  assert.equal(shortcuts.some(item => /ebay|facebook|marketplace/i.test(`${item.id} ${item.label} ${item.site} ${item.url}`)), false);

  const ajWillner = core.getSiteShortcuts(new URL('https://bid.ajwillnerauctions.com/ui/auctions/164037?category=All&subCategory=Active'));
  assert.equal(ajWillner.find(item => item.id === 'ajwillner').current, true);
  assert.equal(ajWillner.filter(item => item.current).length, 1);
});

test('assistant panel renders compact site switcher with active and busy states', () => {
  const core = loadCore();
  const govDealsHtml = core.buildPanelHtml({
    mode: 'govdeals',
    route: { kind: 'govdeals-new-listings', host: 'www.govdeals.com' },
    debugEnabled: false,
  });
  const busyHtml = core.buildPanelHtml({
    mode: 'govdeals',
    route: { kind: 'govdeals-new-listings', host: 'www.govdeals.com' },
    debugEnabled: false,
    busy: true,
  });

  assert.match(govDealsHtml, /id="flipperaddon-site-switcher-toggle"/);
  assert.match(govDealsHtml, /id="flipperaddon-site-switcher-menu"/);
  assert.match(govDealsHtml, /data-site-shortcut-url="https:\/\/aarauctions\.com\/auctions\/"/);
  assert.match(govDealsHtml, /data-site-shortcut-id="govdeals"[^>]*aria-current="page"/);
  assert.doesNotMatch(govDealsHtml, /ebay\.com|facebook\.com\/marketplace/i);

  const disabledShortcutCount = (busyHtml.match(/data-site-shortcut-url="[^"]+"[^>]*disabled/g) || []).length;
  assert.equal(disabledShortcutCount, 5);
  assert.match(busyHtml, /id="hibid-scraper-stop"/);
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
    ['https://hibid.com/account/currentbids?status=WINNING', 'catalog'],
    ['https://hibid.com/account/currentbids?status=OUTBID', 'catalog'],
    ['https://hibid.com/livecatalog/752334/the-luxe-edit', 'live'],
    ['https://www.ebay.com/sh/lst/active', 'fliptracker'],
    ['https://www.facebook.com/marketplace/you/selling', 'fliptracker'],
    ['https://hibid.com/help', 'unsupported'],
  ];

  cases.forEach(([href, mode]) => {
    assert.equal(core.resolveAssistantMode(new URL(href)).mode, mode, href);
  });

  assert.deepEqual(plain(core.resolveAssistantMode(new URL('https://www.ebay.com/sh/lst/active')).route), {
    supported: true,
    kind: 'fliptracker-ebay',
    source: 'ebay',
    host: 'www.ebay.com',
    reason: 'eBay active listing export route',
  });
  assert.deepEqual(plain(core.resolveAssistantMode(new URL('https://www.facebook.com/marketplace/you/selling')).route), {
    supported: true,
    kind: 'fliptracker-facebook',
    source: 'facebook',
    host: 'www.facebook.com',
    reason: 'Facebook Marketplace listing export route',
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

test('assistant resolves supported and blocked AAR Auctions route families', () => {
  const core = loadCore();
  const list = new URL('https://aarauctions.com/auctions/');
  const catalog = new URL('https://aarauctions.com/servlet/Search.do?auctionId=8563');

  assert.deepEqual(plain(core.resolveAarAuctionsPage(list)), {
    supported: true,
    kind: 'aar-auction-list',
    host: 'aarauctions.com',
    reason: 'AAR auction calendar route',
  });
  assert.deepEqual(plain(core.resolveAarAuctionsPage(catalog)), {
    supported: true,
    kind: 'aar-auction-catalog',
    host: 'aarauctions.com',
    auctionId: '8563',
    reason: 'AAR auction catalog route',
  });
  assert.equal(core.shouldInitOnLocation(list), true);
  assert.equal(core.shouldInitOnLocation(catalog), true);
  assert.equal(core.resolveAssistantMode(list).mode, 'aar');
  assert.equal(core.resolveAssistantMode(catalog).source, 'aar');

  [
    'https://aarauctions.com/login',
    'https://aarauctions.com/register',
    'https://aarauctions.com/servlet/Login.do',
    'https://aarauctions.com/servlet/Bid.do?auctionId=8563',
    'https://aarauctions.com/servlet/Payment.do',
  ].forEach((href) => {
    const url = new URL(href);
    assert.equal(core.resolveAarAuctionsPage(url).supported, false, href);
    assert.equal(core.shouldInitOnLocation(url), false, href);
  });
});

test('assistant extracts AAR auction calendar cards', () => {
  const core = loadCore();
  const catalogLink = makeFakeNode({
    text: 'Catalog',
    attrs: { href: '/servlet/Search.do?auctionId=8565' },
  });
  const registerLink = makeFakeNode({
    text: 'Register for Auction',
    attrs: { href: '/servlet/Register.do?auctionId=8565' },
  });
  const image = makeFakeNode({
    attrs: { src: '/images/summer-equipment.jpg', alt: 'Summer Equipment' },
  });
  const card = makeFakeNode({
    text: `Vehicles, Equipment, Tools
Summer Equipment #2 Auction Ending 7/12
Closing at 7:00 PM, Sun, Jul. 12, 2026
Pleasant Valley, NY
Bid Online Now
Catalog`,
    selectors: {
      'a[href*="Search.do?auctionId="]': catalogLink,
      'a[href*="Register"]': registerLink,
      'img': image,
    },
  });
  const root = makeFakeNode({
    text: 'Auction Calendar',
    selectors: {
      'a[href*="Search.do?auctionId="]': catalogLink,
      '.et_pb_column': [card],
    },
  });

  const sales = core.extractAarAuctionCards(root, new URL('https://aarauctions.com/auctions/'));

  assert.deepEqual(plain(sales), [
    {
      source: 'AAR Auctions',
      pageKind: 'aar-auction-list',
      auctionId: '8565',
      title: 'Summer Equipment #2 Auction Ending 7/12',
      url: 'https://aarauctions.com/servlet/Search.do?auctionId=8565',
      image: 'https://aarauctions.com/images/summer-equipment.jpg',
      category: 'Vehicles, Equipment, Tools',
      closingText: 'Closing at 7:00 PM, Sun, Jul. 12, 2026',
      description: 'Pleasant Valley, NY Bid Online Now Catalog',
      registerUrl: 'https://aarauctions.com/servlet/Register.do?auctionId=8565',
      locationHint: 'Pleasant Valley, NY',
      mapSearchUrl: 'https://www.google.com/maps/search/?api=1&query=Pleasant%20Valley%2C%20NY%20to%20Edison%2C%20NJ%2008817',
      rawText: 'Vehicles, Equipment, Tools Summer Equipment #2 Auction Ending 7/12 Closing at 7:00 PM, Sun, Jul. 12, 2026 Pleasant Valley, NY Bid Online Now Catalog',
    },
  ]);
});

test('assistant extracts AAR catalog context and lot fields', () => {
  const core = loadCore();
  const lotLink = makeFakeNode({
    text: 'More Info / Bid Now',
    attrs: { href: '/servlet/Search.do?auctionId=8563&itemId=1' },
  });
  const image = makeFakeNode({ attrs: { src: '/live/images/auction-8563/jeep.jpg' } });
  const lotRow = makeFakeNode({
    text: `#1 - 1994 Jeep Wrangler 4WD
More Info / Bid Now
Closes On: Jul 15, 2026 07:50:00 PM - 07:50:30 PM EST
High Bid: $1,550.00 - moose1214
Auction Type: One Lot
Quantity: 1
Minimum Next Bid: $1,600.00
More Details
Runs and drives. Odometer shows 122,000 miles.`,
    selectors: {
      'a[href*="itemId"]': lotLink,
      'a[href*="Search.do"]': lotLink,
      'img': image,
    },
  });
  const root = makeFakeNode({
    text: `By Appointment Only - Items Must Be Picked Up By Friday July 17 at 3PM
10% buyers premium.
Payment for vehicles and equipment is cash, cashier's check, money order, or wire only.
Items located at Absolute Auction Center: 45 South Ave, Pleasant Valley, NY 12569.
All Items (7)
#1 - 1994 Jeep Wrangler 4WD`,
    selectors: {
      'h1': makeFakeNode({ text: 'Summer Equipment Auction Ending 7/15' }),
      'a[href*="maps"]': makeFakeNode({ attrs: { href: 'https://maps.example.test/pleasant-valley' } }),
      'tr': [lotRow],
      '.auction-item': [lotRow],
    },
  });
  const loc = new URL('https://aarauctions.com/servlet/Search.do?auctionId=8563');

  const context = core.extractAarCatalogContext(root, loc);
  const lots = core.extractAarCatalogLots(root, loc);

  assert.equal(context.source, 'AAR Auctions');
  assert.equal(context.pageKind, 'aar-auction-catalog');
  assert.equal(context.auctionId, '8563');
  assert.equal(context.title, 'Summer Equipment Auction Ending 7/15');
  assert.equal(context.buyerPremium, '10%');
  assert.match(context.pickupText, /Picked Up By Friday July 17/i);
  assert.match(context.paymentText, /cash, cashier's check/i);
  assert.equal(context.location, '45 South Ave, Pleasant Valley, NY 12569');
  assert.equal(context.expectedTotal, 7);

  assert.deepEqual(plain(lots), [
    {
      source: 'AAR Auctions',
      pageKind: 'aar-auction-catalog',
      auctionId: '8563',
      lot: '1',
      title: '1994 Jeep Wrangler 4WD',
      url: 'https://aarauctions.com/servlet/Search.do?auctionId=8563&itemId=1',
      image: 'https://aarauctions.com/live/images/auction-8563/jeep.jpg',
      description: 'Runs and drives. Odometer shows 122,000 miles.',
      highBid: '$1,550.00',
      highBidAmount: 1550,
      currentBid: 1550,
      nextBid: '$1,600.00',
      nextBidAmount: 1600,
      quantity: 1,
      auctionType: 'One Lot',
      closingText: 'Jul 15, 2026 07:50:00 PM - 07:50:30 PM EST',
      rawText: '#1 - 1994 Jeep Wrangler 4WD More Info / Bid Now Closes On: Jul 15, 2026 07:50:00 PM - 07:50:30 PM EST High Bid: $1,550.00 - moose1214 Auction Type: One Lot Quantity: 1 Minimum Next Bid: $1,600.00 More Details Runs and drives. Odometer shows 122,000 miles.',
    },
  ]);
});

test('assistant extracts AAR servlet lots from embedded Lot scripts', () => {
  const core = loadCore();
  const duplicateRow = makeFakeNode({
    text: `#1 - 1994 Jeep Wrangler 4WD 2.5L L4 engine
More Info / Bid Now
Closes On: Jul 15, 2026 07:50:00 PM - 07:50:30 PM EST
High Bid: $1,550.00
Auction Type: One Lot
Quantity: 1
Minimum Next Bid: $1,600.00
More Details
Duplicate visible row should not create an extra lot.`,
    selectors: {
      'a[href*="itemId"]': makeFakeNode({ attrs: { href: '/servlet/Search.do?auctionId=8563&itemId=222210&visible=1' } }),
    },
  });
  const root = makeFakeNode({
    text: 'All Items (2)',
    selectors: {
      'script': [
        makeFakeNode({
          text: `var lot222210 = new Lot( 8563, 0, '1', '222210', '', '1994 Jeep Wrangler 4WD 2.5L L4 engine. VIN: 1J4FY19P2RP440051. Runs and drives.', '', '', '', '', '', '', null, null, 'One Lot', 1, 0.0, 'moose1214', '', 1550.0, 1750.0, 1600.0, 0.0, 0.0, '1,550.00', '1,750.00', '1,600.00', '0.00', '0.00', 26, 497465, 497495, 1784159400, 1784159430, '07:50 PM', '07:50 PM', 0, -1, -1, 0, 0, '', '', 0, -1, -1, false, false, false, false);`
        }),
        makeFakeNode({
          text: `var lot222211 = new Lot(8563, 0, '2', '222211', '', '2012 Chevrolet Express Van handicap accessible. Braun Millennium power lift.', '', '', '', '', '', '', null, null, 'One Lot', 1, 0.0, 'bidder42', '', 3000.0, 3250.0, 3100.0, 0.0, 0.0, '3,000.00', '3,250.00', '3,100.00', '0.00', '0.00', 26, 497495, 497525, 1784159430, 1784159460, '07:50 PM', '07:51 PM', 0, -1, -1, 0, 0, '', '', 0, -1, -1, false, false, false, false);`
        }),
      ],
      '.auction-item': [duplicateRow],
    },
  });

  const lots = core.extractAarCatalogLots(root, new URL('https://aarauctions.com/servlet/Search.do?auctionId=8563'));

  assert.equal(lots.length, 2);
  assert.deepEqual(plain(lots.map(lot => ({
    lot: lot.lot,
    title: lot.title,
    url: lot.url,
    currentBid: lot.currentBid,
    nextBidAmount: lot.nextBidAmount,
    auctionType: lot.auctionType,
    quantity: lot.quantity,
  }))), [
    {
      lot: '1',
      title: '1994 Jeep Wrangler 4WD 2.5L L4 engine',
      url: 'https://aarauctions.com/servlet/Search.do?auctionId=8563&itemId=222210',
      currentBid: 1550,
      nextBidAmount: 1600,
      auctionType: 'One Lot',
      quantity: 1,
    },
    {
      lot: '2',
      title: '2012 Chevrolet Express Van handicap accessible',
      url: 'https://aarauctions.com/servlet/Search.do?auctionId=8563&itemId=222211',
      currentBid: 3000,
      nextBidAmount: 3100,
      auctionType: 'One Lot',
      quantity: 1,
    },
  ]);
  assert.match(lots[0].description, /Runs and drives/);
});

test('assistant persists AAR research settings and builds distance-aware briefs', () => {
  const storage = new Map();
  const core = loadCore({ storage });

  assert.deepEqual(plain(core.getAarResearchSettings()), {
    originLabel: 'Edison, NJ 08817',
    radiusMiles: 100,
  });

  core.saveAarResearchSettings({ originLabel: 'Metuchen, NJ 08840', radiusMiles: 75 });
  assert.deepEqual(plain(core.getAarResearchSettings()), {
    originLabel: 'Metuchen, NJ 08840',
    radiusMiles: 75,
  });

  const brief = core.buildAarAuctionListLlmBrief([
    {
      source: 'AAR Auctions',
      pageKind: 'aar-auction-list',
      title: 'Summer Equipment #2 Auction Ending 7/12',
      locationHint: 'Pleasant Valley, NY',
      mapSearchUrl: 'https://www.google.com/maps/search/?api=1&query=Pleasant%20Valley%2C%20NY%20to%20Metuchen%2C%20NJ%2008840',
    },
  ], {
    source: 'AAR Auctions',
    pageKind: 'aar-auction-list',
    title: 'AAR Auction Calendar',
  }, core.getAarResearchSettings());

  assert.match(brief, /You are an auction resale analysis coordinator/);
  assert.match(brief, /Distance Agent/i);
  assert.match(brief, /Metuchen, NJ 08840/);
  assert.match(brief, /75 miles/i);
  assert.match(brief, /live map\/search results, not assumptions/i);
  assert.match(brief, /distance_miles/);
  assert.match(brief, /distance_proof_url/);
  assert.match(brief, /assigned_agent/);
  assert.match(brief, /Summer Equipment #2 Auction Ending 7\/12/);
});

test('assistant renders AAR copy controls and research settings only', () => {
  const core = loadCore();
  const listHtml = core.buildPanelHtml({
    mode: 'aar',
    debugEnabled: false,
    route: { kind: 'aar-auction-list' },
  });
  const catalogHtml = core.buildPanelHtml({
    mode: 'aar',
    debugEnabled: false,
    route: { kind: 'aar-auction-catalog' },
  });

  assert.match(listHtml, /Copy Auctions LLM/);
  assert.match(listHtml, /id="aar-auctions-copy-json"/);
  assert.match(listHtml, /Research Settings/);
  assert.match(listHtml, /Edison, NJ 08817/);
  assert.doesNotMatch(listHtml, /Prepare Bid|Snipe Now|Auto-confirm|Max plan|checkout|payment/i);

  assert.match(catalogHtml, /Copy Catalog LLM/);
  assert.match(catalogHtml, /id="aar-catalog-copy-json"/);
  assert.match(catalogHtml, /radius/i);
  assert.doesNotMatch(catalogHtml, /Copy Auctions LLM|Prepare Bid|Snipe Now|Max plan|checkout|payment/i);
});

test('assistant resolves supported and blocked GovDeals route families', () => {
  const core = loadCore();
  const seller = new URL('https://www.govdeals.com/en/rutgers');
  const search = new URL('https://www.govdeals.com/en/new-listings/filters?zipcode=07008&miles=25');
  const asset = new URL('https://www.govdeals.com/en/asset/43147/7484');

  assert.deepEqual(plain(core.resolveGovDealsPage(seller)), {
    supported: true,
    kind: 'govdeals-seller',
    host: 'www.govdeals.com',
    sellerSlug: 'rutgers',
    reason: 'GovDeals seller route',
  });
  assert.deepEqual(plain(core.resolveGovDealsPage(search)), {
    supported: true,
    kind: 'govdeals-new-listings',
    host: 'www.govdeals.com',
    zipcode: '07008',
    miles: '25',
    reason: 'GovDeals new listings route',
  });
  assert.deepEqual(plain(core.resolveGovDealsPage(asset)), {
    supported: true,
    kind: 'govdeals-asset',
    host: 'www.govdeals.com',
    assetId: '43147',
    accountId: '7484',
    reason: 'GovDeals asset route',
  });
  assert.equal(core.shouldInitOnLocation(seller), true);
  assert.equal(core.shouldInitOnLocation(search), true);
  assert.equal(core.shouldInitOnLocation(asset), true);
  assert.equal(core.resolveAssistantMode(seller).mode, 'govdeals');
  assert.equal(core.resolveAssistantMode(search).source, 'govdeals');

  [
    'https://www.govdeals.com/en/login',
    'https://www.govdeals.com/en/register',
    'https://www.govdeals.com/en/account',
    'https://www.govdeals.com/en/cart',
    'https://www.govdeals.com/en/checkout',
    'https://www.govdeals.com/en/payment',
    'https://www.govdeals.com/en/bid/43147/7484',
    'https://www.govdeals.com/en/offer/43147/7484',
  ].forEach((href) => {
    const url = new URL(href);
    assert.equal(core.resolveGovDealsPage(url).supported, false, href);
    assert.equal(core.shouldInitOnLocation(url), false, href);
  });
});

test('assistant extracts GovDeals seller context and visible listings', () => {
  const core = loadCore();
  const assetLink = makeFakeNode({
    text: 'Trailer with 6 Current Designs Crosswind Kayaks',
    attrs: { href: '/en/asset/43147/7484' },
  });
  const sellerLink = makeFakeNode({
    text: 'Rutgers University',
    attrs: { href: '/en/rutgers' },
  });
  const image = makeFakeNode({
    attrs: { src: '/photos/43147-main.jpg', alt: 'Kayak trailer' },
  });
  const card = makeFakeNode({
    text: `Trailer with 6 Current Designs Crosswind Kayaks
Rutgers University
Asset ID 43147
Lot Number 7484-43147
Current Bid $1,250.00
9 Bids
Ends Jul 14, 2026 8:05 PM ET
Item Location: Piscataway, New Jersey 08854
Shipping Available
Used/See Description`,
    selectors: {
      'a[href*="/asset/"]': assetLink,
      'a[href*="/en/rutgers"]': sellerLink,
      'img': image,
    },
  });
  const root = makeFakeNode({
    text: `Rutgers University
Piscataway, NJ
13 Search Results in Rutgers University, NJ
Trailer with 6 Current Designs Crosswind Kayaks`,
    selectors: {
      'h1': makeFakeNode({ text: 'Rutgers University' }),
      'a[href*="/asset/"]': assetLink,
      'a[href*="/en/rutgers"]': sellerLink,
      'article': [card],
    },
  });
  root.title = 'Rutgers University | GovDeals';
  const loc = new URL('https://www.govdeals.com/en/rutgers');

  const context = core.extractGovDealsSellerContext(root, loc);
  const listings = core.extractGovDealsListings(root, loc, 'govdeals-seller');

  assert.deepEqual(plain(context), {
    source: 'GovDeals',
    pageKind: 'govdeals-seller',
    title: 'Rutgers University',
    sellerName: 'Rutgers University',
    seller: 'Rutgers University',
    sellerSlug: 'rutgers',
    url: 'https://www.govdeals.com/en/rutgers',
    locationHint: 'Piscataway, NJ',
    visibleCount: 13,
  });
  assert.deepEqual(plain(listings), [
    {
      source: 'GovDeals',
      pageKind: 'govdeals-seller',
      assetId: '43147',
      accountId: '7484',
      lotNumber: '7484-43147',
      title: 'Trailer with 6 Current Designs Crosswind Kayaks',
      url: 'https://www.govdeals.com/en/asset/43147/7484',
      image: 'https://www.govdeals.com/photos/43147-main.jpg',
      seller: 'Rutgers University',
      sellerUrl: 'https://www.govdeals.com/en/rutgers',
      category: '',
      status: 'Used/See Description',
      currentBid: '$1,250.00',
      currentBidAmount: 1250,
      bidCount: '9 Bids',
      bidCountNumber: 9,
      closeTime: 'Jul 14, 2026 8:05 PM ET',
      location: 'Piscataway, New Jersey 08854',
      distanceText: '',
      shippingText: 'Shipping Available',
      pickupText: '',
      condition: 'Used/See Description',
      specs: {},
      description: '',
      rawText: 'Trailer with 6 Current Designs Crosswind Kayaks Rutgers University Asset ID 43147 Lot Number 7484-43147 Current Bid $1,250.00 9 Bids Ends Jul 14, 2026 8:05 PM ET Item Location: Piscataway, New Jersey 08854 Shipping Available Used/See Description',
    },
  ]);
});

test('assistant extracts GovDeals new-listings search context and listing cards', () => {
  const core = loadCore();
  const assetLink = makeFakeNode({
    text: 'Current Tools Conduit Organizer',
    attrs: { href: '/asset/132/25567' },
  });
  const image = makeFakeNode({ attrs: { src: 'https://cdn.govdeals.test/132.jpg' } });
  const card = makeFakeNode({
    text: `Computers and Electronics
Current Tools Conduit Organizer
Seller: Borough of Carteret
Asset ID 132
Lot Number 25567-132
Current Bid: $58.00 USD
15 Bids
Ends: Jul 12, 2026 6:00 PM ET
Location: Carteret, NJ 07008
Distance: 2.1 miles
Local Pickup Only
Condition Used/See Description`,
    selectors: {
      'a[href*="/asset/"]': assetLink,
      'img': image,
    },
  });
  const root = makeFakeNode({
    text: `New Listings
Filters Zipcode 07008 Miles 25
Sort Latest
Showing 1 to 1 of 1
Current Tools Conduit Organizer`,
    selectors: {
      'h1': makeFakeNode({ text: 'New Listings' }),
      'article': [card],
      'a[href*="/asset/"]': assetLink,
    },
  });
  root.title = 'New Listings | GovDeals';
  const loc = new URL('https://www.govdeals.com/en/new-listings/filters?zipcode=07008&miles=25');

  const context = core.extractGovDealsSearchContext(root, loc);
  const listings = core.extractGovDealsListings(root, loc, 'govdeals-new-listings');

  assert.equal(context.source, 'GovDeals');
  assert.equal(context.pageKind, 'govdeals-new-listings');
  assert.equal(context.zipcode, '07008');
  assert.equal(context.miles, '25');
  assert.equal(context.visibleCount, 1);
  assert.equal(listings.length, 1);
  assert.deepEqual(plain({
    title: listings[0].title,
    category: listings[0].category,
    seller: listings[0].seller,
    currentBid: listings[0].currentBid,
    bidCount: listings[0].bidCount,
    location: listings[0].location,
    distanceText: listings[0].distanceText,
    pickupText: listings[0].pickupText,
    status: listings[0].status,
  }), {
    title: 'Current Tools Conduit Organizer',
    category: 'Computers and Electronics',
    seller: 'Borough of Carteret',
    currentBid: '$58.00 USD',
    bidCount: '15 Bids',
    location: 'Carteret, NJ 07008',
    distanceText: '2.1 miles',
    pickupText: 'Local Pickup Only',
    status: 'Used/See Description',
  });
});

test('assistant parses compact GovDeals card text from the real new-listings grid', () => {
  const core = loadCore();
  const compactText = 'New ListingOnline AuctionLot of 5 Dell Optiplex 7070 i5-9500Edison, New Jersey, USAUSD 10.006D10H(July 16, 2026 12:44 PM EDT)Lot#: 7529-6874 Watch';
  const possessiveText = "New ListingOnline AuctionLot of 3 Microsoft Surface Book 3'sEdison, New Jersey, USAUSD 215.005D14H(July 15, 2026 04:35 PM EDT)Lot#: 7529-6816 Watch";
  const assetLink = makeFakeNode({
    text: compactText,
    attrs: { href: '/en/asset/6874/7529' },
  });
  const possessiveAssetLink = makeFakeNode({
    text: possessiveText,
    attrs: { href: '/en/asset/6816/7529' },
  });
  const card = makeFakeNode({
    text: compactText,
    selectors: {
      'a[href*="/asset/"]': assetLink,
    },
  });
  const possessiveCard = makeFakeNode({
    text: possessiveText,
    selectors: {
      'a[href*="/asset/"]': possessiveAssetLink,
    },
  });
  const root = makeFakeNode({
    text: `44 Results for New Listings
${compactText}`,
    selectors: {
      'article': [card],
      'a[href*="/asset/"]': assetLink,
    },
  });
  root.title = 'New Surplus Inventory Listings for Sale | GovDeals';
  const browserLoc = {
    href: 'https://www.govdeals.com/en/new-listings/filters?zipcode=07008&miles=25',
    hostname: 'www.govdeals.com',
    pathname: '/en/new-listings/filters',
  };

  const route = core.resolveGovDealsPage(browserLoc);
  const context = core.extractGovDealsSearchContext(root, browserLoc);
  const listings = core.extractGovDealsListings(root, browserLoc, 'govdeals-new-listings');

  assert.equal(route.zipcode, '07008');
  assert.equal(route.miles, '25');
  assert.equal(context.zipcode, '07008');
  assert.equal(context.miles, '25');
  assert.equal(context.visibleCount, 44);
  assert.equal(listings.length, 1);
  assert.deepEqual(plain({
    title: listings[0].title,
    lotNumber: listings[0].lotNumber,
    currentBid: listings[0].currentBid,
    currentBidAmount: listings[0].currentBidAmount,
    closeTime: listings[0].closeTime,
    location: listings[0].location,
    url: listings[0].url,
  }), {
    title: 'Lot of 5 Dell Optiplex 7070 i5-9500',
    lotNumber: '7529-6874',
    currentBid: 'USD 10.00',
    currentBidAmount: 10,
    closeTime: '6D10H(July 16, 2026 12:44 PM EDT)',
    location: 'Edison, New Jersey, USA',
    url: 'https://www.govdeals.com/en/asset/6874/7529',
  });

  const possessiveListing = core.extractGovDealsListings(makeFakeNode({
    text: possessiveText,
    selectors: {
      'article': [possessiveCard],
      'a[href*="/asset/"]': possessiveAssetLink,
    },
  }), browserLoc, 'govdeals-seller')[0];
  assert.equal(possessiveListing.title, "Lot of 3 Microsoft Surface Book 3's");
  assert.equal(possessiveListing.location, 'Edison, New Jersey, USA');
  assert.equal(possessiveListing.currentBid, 'USD 215.00');
  assert.equal(possessiveListing.lotNumber, '7529-6816');
});

test('assistant extracts GovDeals asset detail fields for enrichment', () => {
  const core = loadCore();
  const root = makeFakeNode({
    text: `Trailer with 6 Current Designs Crosswind Kayaks
Asset ID 43147
Lot Number 7484-43147
Manufacturer Current Designs
Model Crosswind
Condition Used/See Description
Current Bid $1,250.00
Bids 9
Item Location: Piscataway, New Jersey 08854
OFFERED FOR AUCTION: A lot of 6 Current Designs Crosswind Kayaks with trailer.
Pickup only by appointment.`,
    selectors: {
      'h1': makeFakeNode({ text: 'Trailer with 6 Current Designs Crosswind Kayaks' }),
      'img': makeFakeNode({ attrs: { src: '/images/kayak.jpg' } }),
    },
  });
  root.title = 'Trailer with 6 Current Designs Crosswind Kayaks | GovDeals';

  const asset = core.extractGovDealsAssetDetail(root, new URL('https://www.govdeals.com/en/asset/43147/7484'));

  assert.deepEqual(plain(asset), {
    source: 'GovDeals',
    pageKind: 'govdeals-asset',
    assetId: '43147',
    accountId: '7484',
    lotNumber: '7484-43147',
    title: 'Trailer with 6 Current Designs Crosswind Kayaks',
    url: 'https://www.govdeals.com/en/asset/43147/7484',
    image: 'https://www.govdeals.com/images/kayak.jpg',
    seller: '',
    sellerUrl: '',
    category: '',
    status: 'Used/See Description',
    currentBid: '$1,250.00',
    currentBidAmount: 1250,
    bidCount: '9',
    bidCountNumber: 9,
    closeTime: '',
    location: 'Piscataway, New Jersey 08854',
    distanceText: '',
    shippingText: '',
    pickupText: 'Pickup only by appointment.',
    condition: 'Used/See Description',
    specs: {
      Manufacturer: 'Current Designs',
      Model: 'Crosswind',
      Condition: 'Used/See Description',
    },
    description: 'OFFERED FOR AUCTION: A lot of 6 Current Designs Crosswind Kayaks with trailer.',
    rawText: 'Trailer with 6 Current Designs Crosswind Kayaks Asset ID 43147 Lot Number 7484-43147 Manufacturer Current Designs Model Crosswind Condition Used/See Description Current Bid $1,250.00 Bids 9 Item Location: Piscataway, New Jersey 08854 OFFERED FOR AUCTION: A lot of 6 Current Designs Crosswind Kayaks with trailer. Pickup only by appointment.',
  });
});

test('assistant builds GovDeals distance-aware briefs and renders scraper-only UI', () => {
  const storage = new Map();
  const core = loadCore({ storage });
  const settings = core.getAarResearchSettings();
  const listings = [
    {
      source: 'GovDeals',
      pageKind: 'govdeals-new-listings',
      title: 'Current Tools Conduit Organizer',
      url: 'https://www.govdeals.com/asset/132/25567',
      currentBid: '$58.00 USD',
      location: 'Carteret, NJ 07008',
      distanceText: '2.1 miles',
    },
  ];
  const context = {
    source: 'GovDeals',
    pageKind: 'govdeals-new-listings',
    title: 'New Listings',
    url: 'https://www.govdeals.com/en/new-listings/filters?zipcode=07008&miles=25',
    zipcode: '07008',
    miles: '25',
    visibleCount: 1,
  };

  const brief = core.buildGovDealsLlmBrief(listings, context, settings);
  const sellerHtml = core.buildPanelHtml({
    mode: 'govdeals',
    debugEnabled: false,
    route: { kind: 'govdeals-seller' },
  });
  const searchHtml = core.buildPanelHtml({
    mode: 'govdeals',
    debugEnabled: false,
    route: { kind: 'govdeals-new-listings' },
  });
  const assetHtml = core.buildPanelHtml({
    mode: 'govdeals',
    debugEnabled: false,
    route: { kind: 'govdeals-asset' },
  });

  assert.match(brief, /You are an auction resale analysis coordinator/);
  assert.match(brief, /GovDeals safety boundary/i);
  assert.match(brief, /Edison, NJ 08817/);
  assert.match(brief, /100 miles/i);
  assert.match(brief, /zipcode.*07008/is);
  assert.match(brief, /distance_miles/);
  assert.match(brief, /distance_proof_url/);
  assert.match(brief, /live map\/search proof/i);
  assert.match(brief, /Current Tools Conduit Organizer/);

  assert.match(sellerHtml, /Copy Seller LLM/);
  assert.match(sellerHtml, /id="govdeals-seller-copy-json"/);
  assert.match(searchHtml, /Copy Listings LLM/);
  assert.match(searchHtml, /id="govdeals-listings-copy-json"/);
  assert.match(assetHtml, /Copy Asset LLM/);
  assert.match(assetHtml, /id="govdeals-asset-copy-json"/);
  [sellerHtml, searchHtml, assetHtml].forEach((html) => {
    assert.match(html, /GovDeals/);
    assert.doesNotMatch(html, /Prepare Bid|Snipe Now|Auto-confirm|Max plan|checkout|payment|offer|\bcart\b/i);
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
  const duplicateTrackedSaleLink = makeFakeNode({
    text: 'Dumont New Jersey Estate Sale',
    attrs: { href: 'https://www.auctionninja.com/pinkladyliquidation/sales/details/dumont-new-jersey-estate-sale--21001.html?an=20260710124520' },
  });
  const duplicateTrackedRow = makeFakeNode({
    text: `Dumont New Jersey Estate Sale
Dumont, NJ Local Pickup Only
Begins to close
Thu, Jul 16 2026 @ 8:00 PM EDT
Pink Lady Liquidation
561 Lots`,
    selectors: {
      'a[href*="/sales/details/"]': duplicateTrackedSaleLink,
      'a[href]:not([href*="/sales/details/"])': sellerLink,
      'img': image,
    },
  });
  const root = makeFakeNode({
    text: '108 auctions near Carteret, NJ 1 2 3 Next',
    selectors: {
      'a[href*="/sales/details/"]': saleLink,
      '.auction-item': [row, duplicateTrackedRow],
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
