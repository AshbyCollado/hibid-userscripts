import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import {
  auctionNinjaRouteFingerprint,
  buildAuctionNinjaCatalogPageUrl,
  buildAuctionNinjaPageAudit,
  canonicalAuctionNinjaProductUrl,
  canonicalAuctionNinjaSaleUrl,
  extractAuctionNinjaAccountItems,
  extractAuctionNinjaAuctionSearchContext,
  extractAuctionNinjaAuctionSearchSales,
  extractAuctionNinjaCatalogLots,
  extractAuctionNinjaCategoryItems,
  extractAuctionNinjaCategoryContext,
  extractAuctionNinjaItemDetail,
  extractAuctionNinjaSaleContext,
  findAuctionNinjaSearchPageUrls,
  mergeAuctionNinjaItemDetail,
  parseAuctionNinjaPagedResponse,
  resolveAuctionNinjaPage,
  validateAuctionNinjaPageCoverage,
  scrapeAuctionNinjaFollowedItems,
  scrapeAuctionNinjaCategory
} from './index.js';

function documentFrom(html: string): Document {
  return new JSDOM(html).window.document;
}

const base = 'https://www.auctionninja.com/';

test('route resolution and fingerprint ignore only opaque an', () => {
  const sale = new URL('https://www.auctionninja.com/seller/sales/details/summer-sale--17395.html?an=opaque&Page=2');
  const route = resolveAuctionNinjaPage(sale);
  assert.equal(route.kind, 'sale-catalog');
  assert.equal(route.saleId, '17395');
  assert.equal(resolveAuctionNinjaPage('https://www.auctionninja.com/ca/san-diego/92101?miles=50').kind, 'auction-search');
  assert.equal(resolveAuctionNinjaPage('https://www.auctionninja.com/category/electronics?zip=07008').kind, 'category-search');
  assert.equal(resolveAuctionNinjaPage('https://www.auctionninja.com/seller/product/projector--123.html').kind, 'item-detail');
  assert.equal(resolveAuctionNinjaPage('https://www.auctionninja.com/account').kind, 'unsupported');
  assert.equal(auctionNinjaRouteFingerprint(route, sale), auctionNinjaRouteFingerprint(route, new URL(sale.href.replace('opaque', 'different'))));
  assert.notEqual(auctionNinjaRouteFingerprint(route, sale), auctionNinjaRouteFingerprint(route, new URL(sale.href.replace('Page=2', 'Page=3'))));
  assert.match(buildAuctionNinjaCatalogPageUrl(sale, 3), /Page=3/);
});

test('sale catalog extraction is strict, typed, and description aware', () => {
  const doc = documentFrom(`
    <title>Summer Sale | AuctionNinja</title>
    <h1>Summer Sale</h1>
    <div>Auction Location: Carteret, NJ Shipping Available</div>
    <div>Buyer&apos;s Premium 15%</div>
    <div>Showing 1 - 2 of 2 items</div>
    <div class="search-catalog-item-box">
      <a href="/seller/product/steelseries-headset--1001.html">Lot # 6 SteelSeries Arctis Nova 7</a>
      <div class="item-description-deta">Condition: New - Factory Sealed
        In Packaging?: Yes
        Functional?: Yes
        Missing Parts?: No</div>
      <img src="/Pictures/headset-thumb.jpg"><img data-src="/Pictures/headset-back.jpg">
      <span>Current Bid: $5.00 2 Bids 1 day left</span>
    </div>
    <article><a href="/seller/product/unrelated--9999.html">Unrelated text</a></article>
  `);
  const loc = new URL('https://www.auctionninja.com/seller/sales/details/summer-sale--17395.html');
  const context = extractAuctionNinjaSaleContext(doc, loc);
  const lots = extractAuctionNinjaCatalogLots(doc, loc);
  assert.equal(context.saleId, '17395');
  assert.equal(context.buyerPremium, '15%');
  assert.equal(context.expectedTotal, 2);
  assert.equal(lots.length, 1);
  assert.equal(lots[0]!.stableId, '1001');
  assert.equal(lots[0]!.descriptionFields.condition, 'New - Factory Sealed');
  assert.equal(lots[0]!.descriptionFields.missingParts, 'No');
  assert.deepEqual(lots[0]!.images, [
    'https://www.auctionninja.com/Pictures/headset-thumb.jpg',
    'https://www.auctionninja.com/Pictures/headset-back.jpg'
  ]);
  assert.equal(canonicalAuctionNinjaProductUrl(`${lots[0]!.url}?an=private`), lots[0]!.url);
});

test('category extraction retains category and exact result context', () => {
  const doc = documentFrom(`
    <title>Electronics | AuctionNinja</title>
    <div>Showing 1 - 2 of 94 items</div>
    <div class="hot-items-box"><a href="/seller/product/gpu--2001.html">ASUS GeForce RTX 4060</a><span>Lot # 4 Current Bid: $115.00</span><img src="/gpu.jpg"></div>
    <div class="hot-items-box"><a href="/seller/product/monitor--2002.html">Monitor</a><span>Lot # 5 Current Bid: $25.00</span></div>
  `);
  const loc = new URL('https://www.auctionninja.com/category/electronics?Page=2&srt=Distance&miles=50&zip=07008');
  const context = extractAuctionNinjaCategoryContext(doc, loc);
  const items = extractAuctionNinjaCatalogLots(doc, loc, 'category-search');
  assert.equal(context.totalItems, 94);
  assert.equal(context.category, 'Electronics');
  assert.equal(items.length, 2);
  assert.equal(items[0]!.category, 'Electronics');
});

test('account extraction isolates canonical product cards and rejects broad page shells', () => {
  const doc = documentFrom(`
    <main><div class="account-item-card"><a href="/seller/product/one--3001.html">Lot # 1 Headphones</a><span>Following Current Bid: $7.00</span></div>
    <div class="account-item-card"><a href="/seller/product/two--3002.html">Lot # 2 Speaker</a><span>Outbid Current Bid: $9.00</span></div>
    <article><a href="/seller/product/not-a-card--3999.html">Navigation only</a></article></main>
  `);
  const items = extractAuctionNinjaAccountItems(doc, new URL('https://www.auctionninja.com/followed-items?an=opaque'), 'followed-items');
  assert.deepEqual(items.map((item) => item.stableId), ['3001', '3002']);
  assert.equal(items[0]!.price, 7);
  assert.equal(items[1]!.status, 'Outbid');
});

test('item detail extraction and merge enrich only matching identity', () => {
  const doc = documentFrom(`
    <link rel="canonical" href="https://www.auctionninja.com/seller/product/receiver--4001.html">
    <h1 class="item-detail-box-title">Onkyo TX-SR304 Multi-Channel AV Receiver</h1>
    <div class="item-detail-main"><div id="description">Condition: Used - Very Good
      Missing Parts?: No</div><img src="/Pictures/receiver-1.jpg"><img src="/Pictures/receiver-2.jpg"><span>High Bid: $22.00 4 Bids</span><span>Lot # 10</span></div>
  `);
  const detail = extractAuctionNinjaItemDetail(doc, new URL('https://www.auctionninja.com/seller/product/receiver--4001.html?an=opaque'));
  assert.ok(detail);
  assert.equal(detail?.id, '4001');
  assert.equal(detail?.descriptionFields?.condition, 'Used - Very Good');
  const cardDoc = documentFrom('<div class="search-catalog-item-box"><a href="/seller/product/receiver--4001.html">Lot # 10 Receiver</a><span>Current Bid: $20.00</span></div>');
  const card = extractAuctionNinjaCatalogLots(cardDoc, new URL('https://www.auctionninja.com/seller/sales/details/sale--1.html'))[0];
  assert.ok(card);
  const merged = mergeAuctionNinjaItemDetail(card, detail);
  assert.equal(merged.description, detail?.description);
  assert.equal(merged.images.length, 2);
  assert.equal(mergeAuctionNinjaItemDetail(card, { ...detail, id: 'other', stableId: 'other' }).stableId, '4001');
});

test('marketplace_ajax parser ignores extra payload keys and extracts scoped sales', () => {
  const payload = parseAuctionNinjaPagedResponse(JSON.stringify({
    head: '<div>118 Auctions</div>',
    body: '<div class="location-search-result-all"><div class="location-result-box"><a href="/seller/sales/details/tools--555.html">Tools Auction</a><span>12 Lots Begins to close July 1 Shipping Available</span></div></div>',
    pagination: '<a href="/marketplace_ajax.php?Page=2&miles=50&zip=07008">2</a>',
    location: 'private',
    DefLati: 'private'
  }));
  assert.equal(payload.responseKind, 'auctionninja-json-fragment');
  assert.equal(payload.totalSales, 118);
  assert.deepEqual(payload.ignoredSensitiveKeys, ['DefLati', 'location']);
  const doc = documentFrom(payload.html);
  const loc = new URL('https://www.auctionninja.com/auctions?miles=50&zip=07008');
  const sales = extractAuctionNinjaAuctionSearchSales(doc, loc);
  assert.equal(sales.length, 1);
  assert.equal(sales[0]!.stableId, 'www.auctionninja.com/seller/sales/details/tools--555.html');
  assert.equal(sales[0]!.itemCount, 12);
  assert.equal(extractAuctionNinjaAuctionSearchContext(doc, loc).totalSales, 118);
  assert.deepEqual(findAuctionNinjaSearchPageUrls(documentFrom('<div class="paging-deta"><a href="/auctions?Page=2&miles=50&zip=07008">2</a></div>'), loc), ['https://www.auctionninja.com/auctions?Page=2&miles=50&zip=07008']);
});

test('coverage validates exact pages, ranges, identities, failures, and route drift', () => {
  const urls = [1, 2, 3].map((page) => `https://www.auctionninja.com/seller/sales/details/sale--1.html?Page=${page}`);
  const pages = urls.map((url, index) => buildAuctionNinjaPageAudit(
    Array.from({ length: index === 2 ? 1 : 2 }, (_, item) => ({ stableId: String(index * 2 + item + 1), id: String(index * 2 + item + 1), url: `https://www.auctionninja.com/seller/product/item--${index * 2 + item + 1}.html` })),
    url, 5, { start: index * 2 + 1, end: index === 2 ? 5 : index * 2 + 2 }
  ));
  assert.equal(validateAuctionNinjaPageCoverage(pages, 5, { requireRanges: true }).complete, true);
  assert.equal(validateAuctionNinjaPageCoverage([pages[0]!, pages[2]!], 5).reason, 'missing-pages');
  assert.equal(validateAuctionNinjaPageCoverage([...pages.slice(0, 2), { ...pages[2]!, ids: ['4', '5'], count: 2 }], 5).reason, 'duplicate-identities');
  assert.equal(validateAuctionNinjaPageCoverage(pages, 5, { startFingerprint: 'a', endFingerprint: 'b' }).reason, 'route-fingerprint-drift');
  assert.equal(validateAuctionNinjaPageCoverage(pages, 6, { failedPages: [{ page: 2, error: 'timeout' }] }).reason, 'failed-pages');
});

test('canonical sale redirects are unwrapped and product identities stay stable', () => {
  const redirect = canonicalAuctionNinjaSaleUrl('/an-to-brg.php?backurl=%2Fseller%2Fsales%2Fdetails%2Fsale--77.html%3Fan%3Dopaque');
  assert.equal(redirect, 'https://www.auctionninja.com/seller/sales/details/sale--77.html');
});

test('catalog cards dedupe duplicate product anchors and prefer a complete media title', () => {
  const doc = documentFrom(`
    <div class="hot-items-box">
      <a href="/seller/product/receiver--501.html">Onkyo TX-SR304 Multi-Channel...</a>
      <a href="/seller/product/receiver--501.html?an=opaque"><img src="/thumb.jpg" alt="Onkyo TX-SR304 Multi-Channel AV Receiver" title="Onkyo TX-SR304 Multi-Channel AV Receiver"></a>
      <span>Lot # 8 Current Bid: $15.00</span>
    </div>
  `);
  const items = extractAuctionNinjaCategoryItems(doc, 'https://www.auctionninja.com/category/electronics');
  assert.equal(items.length, 1);
  assert.equal(items[0]!.stableId, '501');
  assert.equal(items[0]!.title, 'Onkyo TX-SR304 Multi-Channel AV Receiver');
});

test('account scraper derives rendered account page size before paginating and enriches at four concurrent requests', async () => {
  const source = 'https://www.auctionninja.com/followed-items';
  const cards = Array.from({ length: 39 }, (_, index) => {
    const id = String(7000 + index);
    return `<div id="MainItmID_${id}" class="dashboard-item-closing-main-box"><div class="search-catalog-item-box-in"><a href="/seller/product/item-${id}--${id}.html">Item ${id}</a><a href="/seller/product/item-${id}--${id}.html?an=opaque">Item ${id}</a><span class="ci-price">Following $${index + 1}.00</span></div></div>`;
  }).join('');
  const accountHtml = `<html><body><h1>Items I am following (Total: 39)</h1>${cards}</body></html>`;
  const requested: string[] = [];
  let active = 0;
  let maximumActive = 0;
  const fetcher = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    requested.push(url);
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 1));
    active -= 1;
    if (new URL(url).pathname === '/followed-items') return new Response(accountHtml, { status: 200 });
    const id = new URL(url).pathname.match(/--(\d+)\.html$/)?.[1] || '0';
    return new Response(`<html><head><link rel="canonical" href="${url}"></head><body><h1>Item ${id}</h1><div class="item-detail-main"><div class="lot-number">Lot # ${id}</div><div class="description">Condition: Used - Very Good</div><img src="/Pictures/${id}.jpg"></div></body></html>`, { status: 200 });
  };
  const result = await scrapeAuctionNinjaFollowedItems(fetcher, source, {
    parseDocument: (html, url) => new JSDOM(html, { url }).window.document,
    timeoutMs: 20_000
  });
  assert.equal(result.expectedTotal, 39);
  assert.equal(result.items.length, 39);
  assert.equal((result.items[0] as any).price, 1);
  assert.equal(result.pageAudits[0]!.count, 39);
  assert.equal(result.coverage.complete, true);
  assert.equal(maximumActive, 4);
  assert.equal(requested.filter((url) => /[?&]Page=2(?:&|$)/i.test(url)).length, 0);
  assert.equal(requested.length, 40);
});

test('category scraper follows deterministic Page pagination and retries detail enrichment three times', async () => {
  const source = 'https://www.auctionninja.com/category/electronics?miles=50&zip=07008';
  const requested: string[] = [];
  let flakyDetailAttempts = 0;
  const page = (range: string, ids: number[]) => `<html><body><div>Showing ${range} of 3 items</div>${ids.map((id) => `<div class="hot-items-box"><a href="/seller/product/item--${id}.html">Item ${id}</a><span>Lot # ${id} Current Bid: $${id}.00</span></div>`).join('')}</body></html>`;
  const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    requested.push(url);
    const parsed = new URL(url);
    if (parsed.pathname === '/category/electronics') return new Response(parsed.searchParams.get('Page') === '2' ? page('3-3', [3]) : page('1-2', [1, 2]), { status: 200 });
    if (parsed.pathname.endsWith('--1.html')) {
      flakyDetailAttempts += 1;
      if (flakyDetailAttempts < 3) throw new Error('temporary detail failure');
    }
    const id = parsed.pathname.match(/--(\d+)\.html$/)?.[1] || '0';
    return new Response(`<html><head><link rel="canonical" href="${url}"></head><body><h1>Item ${id}</h1><div class="item-detail-main"><div class="lot-number">Lot # ${id}</div><div id="description">Condition: New</div><img src="/Pictures/${id}.jpg"></div></body></html>`, { status: 200 });
  };
  const result = await scrapeAuctionNinjaCategory(fetcher, source, {
    parseDocument: (html, url) => new JSDOM(html, { url }).window.document
  });
  assert.equal(result.expectedTotal, 3);
  assert.equal(result.items.length, 3);
  assert.equal(result.coverage.complete, true);
  assert.equal(flakyDetailAttempts, 3);
  assert.equal(requested.filter((url) => new URL(url).searchParams.get('Page') === '2').length, 1);
  assert.ok(requested.some((url) => new URL(url).pathname.endsWith('--1.html')));
});

test('AuctionNinja scraper honors cancellation before issuing a fetch', async () => {
  const controller = new AbortController();
  controller.abort();
  let fetches = 0;
  await assert.rejects(
    scrapeAuctionNinjaCategory('https://www.auctionninja.com/category/electronics', {
      signal: controller.signal,
      fetcher: async () => { fetches += 1; return new Response('', { status: 200 }); },
      parseDocument: (html, url) => new JSDOM(html, { url }).window.document
    }),
    (error: Error) => error.name === 'AbortError' && /cancelled/i.test(error.message)
  );
  assert.equal(fetches, 0);
});
