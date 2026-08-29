import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { parseAuctionNinjaPagedResponse } from '../src/auctionninja/marketplace.js';
import { scrapeAuctionNinjaCategory } from '../src/auctionninja/scrape.js';

function categoryPage(ids: number[]): string {
  return `<html><body><h1>Electronics 41 results</h1>${ids.map((id) => `
    <div class="hot-items-box">
      <a href="/seller/product/item--${id}.html">Item ${id}</a>
      <span>Lot # ${id} Current Bid: $${id}.00</span>
    </div>`).join('')}</body></html>`;
}

test('category result headers paginate every canonical card without a Showing range', async () => {
  const source = 'https://www.auctionninja.com/category/electronics?miles=50&zip=07008';
  const requestedPages: number[] = [];
  const fetcher = async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(String(input));
    if (url.pathname === '/category/electronics') {
      const page = Number(url.searchParams.get('Page') || 1);
      requestedPages.push(page);
      const start = (page - 1) * 20 + 1;
      const end = Math.min(41, start + 19);
      return new Response(categoryPage(Array.from({ length: Math.max(0, end - start + 1) }, (_, index) => start + index)), { status: 200 });
    }
    const id = url.pathname.match(/--(\d+)\.html$/)?.[1] || '0';
    return new Response(`<html><head><link rel="canonical" href="${url.href}"></head><body><h1>Item ${id}</h1><div class="item-detail-main"><div>Lot # ${id}</div><div id="description">Condition: New</div><img src="/Pictures/${id}.jpg"></div></body></html>`, { status: 200 });
  };

  const result = await scrapeAuctionNinjaCategory(fetcher, source, {
    parseDocument: (html, url) => new JSDOM(html, { url }).window.document,
  });

  assert.equal(result.expectedTotal, 41);
  assert.equal(result.items.length, 41);
  assert.equal(new Set(result.items.map((item) => item.stableId)).size, 41);
  assert.deepEqual(requestedPages, [1, 2, 3]);
  assert.equal(result.pageAudits.length, 3);
  assert.equal(result.coverage.complete, true);
});

test('current marketplace fragments treat the authoritative sales count as the auction total', () => {
  const payload = parseAuctionNinjaPagedResponse(JSON.stringify({
    head: '<div>Carteret, NJ 07008 <strong>47 sales</strong></div>',
    body: '<div>public auction cards</div>',
    pagination: '<a>1</a><a>2</a><a>3</a><a>4</a>',
    location: [['private map detail']],
    DefLati: 'private',
  }));

  assert.equal(payload.totalSales, 47);
  assert.deepEqual(payload.ignoredSensitiveKeys, ['DefLati', 'location']);
  assert.doesNotMatch(payload.html, /private map detail|DefLati/);
});
