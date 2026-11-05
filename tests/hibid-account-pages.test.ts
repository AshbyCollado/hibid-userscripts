import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { collectHibidAccountPages, parseHibidAccountDetail } from '../src/hibid/account-pages.js';
import type { HiBidRoute, PastAuctionGroup } from '../src/core/types.js';

const baseUrl = 'https://hibid.com/account/currentbids';

test('account detail enrichment rejects loading, challenge, login, and wrong-item pages', () => {
  const expected = { id: '700', url: 'https://hibid.com/lot/700/camera' } as any;
  for (const [html, url] of [
    ['<app-root>Loading...</app-root>', expected.url],
    ['<h1>Just a moment</h1>', expected.url],
    ['<h1>Camera</h1>', 'https://hibid.com/lot/701/other'],
    ['<h1>Sign in</h1><input type="password">', 'https://hibid.com/pf/login'],
  ]) assert.throws(() => parseHibidAccountDetail(dom(html), url, expected), /redirected|loading|verification/);
  assert.equal(parseHibidAccountDetail(dom('<h1>Lot # : 7 - Camera</h1><span class="lot-high-bid">High Bid: 5 USD</span>'), expected.url, expected).id, '700');
});

function dom(body: string, url = baseUrl): Document {
  return new JSDOM(`<body>${body}</body>`, { url }).window.document;
}

function route(kind: HiBidRoute['kind'] = 'currentbids'): HiBidRoute {
  return {
    supported: true,
    source: 'hibid',
    kind,
    host: 'hibid.com',
    path: `/account/${kind}`,
    auctionId: null,
    categoryId: null,
    statePrefix: null,
    portalAuctioneerIds: [],
    siteType: 2,
    currentBidStatus: null
  };
}

function lot(id: string, title = `Camera ${id}`): string {
  return `<div class="lot-tile lot-card" id="lot-${id}">
    <div class="app-auction-lot-card__identity">
      <a class="app-auction-lot-card__lot-number">Lot ${id}</a>
      <a class="app-auction-lot-card__title" href="/lot/${id}/${title.toLowerCase().replace(/\s+/g, '-')}">${title}</a>
    </div>
    <div class="app-auction-lot-card__meta-money"><span class="app-auction-lot-card__amount">$${id}.00</span><span class="app-auction-lot-card__currency-code">USD</span></div>
    <div class="app-auction-lot-card__footer"><button class="app-button">Bid $${Number(id) + 1}.00 USD</button></div>
  </div>`;
}

function page(lots: string, range: string, pageNumber: number, wrapper = 'app-bids-page'): Document {
  return dom(`<${wrapper}><app-paginator><span>${range}</span><input name="jumpPageInput" value="${pageNumber}"></app-paginator>${lots}</${wrapper}>`);
}

function options(document: Document, url = baseUrl, overrides: Partial<Parameters<typeof collectHibidAccountPages>[0]> = {}) {
  return {
    document,
    url,
    route: route(),
    signal: new AbortController().signal,
    readPage: async () => ({ document, url }),
    ...overrides
  };
}

test('collects three authenticated scoped pages and reports progress', async () => {
  const first = page(`${lot('101')}${lot('102')}`, 'Showing 1 - 2 of 5 lots', 1);
  const second = page(`${lot('103')}${lot('104')}`, 'Showing 3 - 4 of 5 lots', 2);
  const third = page(lot('105'), 'Showing 5 - 5 of 5 lots', 3);
  const reads: string[] = [];
  const progress: Array<[number, number, number]> = [];
  const result = await collectHibidAccountPages(options(first, baseUrl, {
    readPage: async (url) => {
      reads.push(url);
      const pageNumber = new URL(url).searchParams.get('apage');
      return pageNumber === '2' ? { document: second, url } : { document: third, url };
    },
    onProgress: async (count, expected, currentPage) => progress.push([count, expected, currentPage])
  }));
  assert.deepEqual(result.items.map((item) => item.id), ['101', '102', '103', '104', '105']);
  assert.equal(result.expected, 5);
  assert.deepEqual(reads, [`${baseUrl}?apage=2`, `${baseUrl}?apage=3`]);
  assert.deepEqual(progress, [[4, 5, 2], [5, 5, 3]]);
});

test('refetches page one when capture starts on page two', async () => {
  const startUrl = `${baseUrl}?apage=2`;
  const first = page(`${lot('201')}${lot('202')}`, 'Showing 1 - 2 of 3 lots', 1);
  const second = page(lot('203'), 'Showing 3 - 3 of 3 lots', 2);
  const reads: string[] = [];
  const result = await collectHibidAccountPages(options(first, startUrl, {
    readPage: async (url) => {
      reads.push(url);
      return url.endsWith('apage=2') ? { document: second, url } : { document: first, url };
    }
  }));
  assert.deepEqual(result.items.map((item) => item.id), ['201', '202', '203']);
  assert.deepEqual(reads, [baseUrl, `${baseUrl}?apage=2`]);
});

test('selected past auction forces auctionid and counts only its rows across pages', async () => {
  const selectedGroup: PastAuctionGroup = {
    id: '790910', title: 'Estate auction', catalogUrl: 'https://hibid.com/catalog/790910/estate', location: '', dateText: ''
  };
  const url = 'https://hibid.com/account/pastbids?auctionid=other';
  const first = page(`<div class="listing-box"><div class="listing-box-title"><a href="/catalog/790910/estate"><strong>Estate auction</strong></a></div>${lot('301')}${lot('302')}</div><div class="listing-box"><div class="listing-box-title"><a href="/catalog/880000/other"><strong>Other auction</strong></a></div>${lot('399')}</div>`, 'Showing 1 - 2 of 3 lots', 1);
  const second = page(`<div class="listing-box"><div class="listing-box-title"><a href="/catalog/790910/estate"><strong>Estate auction</strong></a></div>${lot('303')}</div><div class="listing-box"><div class="listing-box-title"><a href="/catalog/880000/other"><strong>Other auction</strong></a></div>${lot('398')}</div>`, 'Showing 3 - 3 of 3 lots', 2);
  const reads: string[] = [];
  const result = await collectHibidAccountPages({
    ...options(first, url, { route: route('pastbids'), selectedGroup }),
    readPage: async (readUrl) => {
      reads.push(readUrl);
      return readUrl.endsWith('apage=2') ? { document: second, url: readUrl } : { document: first, url: readUrl };
    }
  });
  const requested = new URL(reads[0]!);
  assert.equal(requested.searchParams.get('auctionid'), selectedGroup.id);
  assert.deepEqual(result.items.map((item) => item.id), ['301', '302', '303']);
  assert.equal(result.expected, 3);
  assert.ok(result.items.every((item) => item.auctionId === selectedGroup.id));
  assert.ok(result.items.every((item) => item.auctionTitle === selectedGroup.title));
});

test('refuses a duplicate lot across pages', async () => {
  const first = page(lot('401'), 'Showing 1 - 1 of 2 lots', 1);
  const second = page(lot('401'), 'Showing 2 - 2 of 2 lots', 2);
  await assert.rejects(
    collectHibidAccountPages(options(first, baseUrl, { readPage: async (url) => ({ document: second, url }) })),
    /Duplicate lot 401 across account pages/
  );
});

test('refuses count drift between pages', async () => {
  const first = page(lot('501'), 'Showing 1 - 1 of 2 lots', 1);
  const second = page(lot('502'), 'Showing 2 - 2 of 3 lots', 2);
  await assert.rejects(
    collectHibidAccountPages(options(first, baseUrl, { readPage: async (url) => ({ document: second, url }) })),
    /lot count changed during capture/
  );
});

test('refuses a same-path pagination redirect which drops the active status filter', async () => {
  const first = page(lot('601'), 'Showing 1 - 1 of 2 lots', 1);
  const second = page(lot('602'), 'Showing 2 - 2 of 2 lots', 2);
  await assert.rejects(collectHibidAccountPages(options(first, `${baseUrl}?status=WINNING`, {
    route: route('currentbids-winning'),
    readPage: async () => ({ document: second, url: `${baseUrl}?apage=2` })
  })), /filters changed during capture/);
});

test('rejects login redirects even when the body looks like an account page', async () => {
  const first = page(`${lot('601')}${lot('602')}`, 'Showing 1 - 2 of 3 lots', 1);
  const login = page(lot('601'), 'Showing 1 - 1 of 1 lots', 1);
  await assert.rejects(
    collectHibidAccountPages(options(first, baseUrl, {
      readPage: async () => ({ document: login, url: 'https://hibid.com/pf/login?returnUrl=%2Faccount%2Fcurrentbids' })
    })),
    /requires sign-in or changed during capture/
  );
});

test('returns an explicit zero result for current bids with no matches', async () => {
  const empty = dom('<app-bids-page>You have no bids on open lots.</app-bids-page>');
  const result = await collectHibidAccountPages(options(empty));
  assert.deepEqual(result.items, []);
  assert.equal(result.expected, 0);
});

test('propagates an abort during collection', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    collectHibidAccountPages({ ...options(page(lot('701'), 'Showing 1 - 1 of 1 lots', 1)), signal: controller.signal }),
    (error: unknown) => error instanceof Error && error.name === 'AbortError'
  );
});

test('rejects unknown and loading lot counts', async (t) => {
  await t.test('unknown count', async () => {
    await assert.rejects(
      collectHibidAccountPages(options(page(lot('801'), '', 1))),
      /lot count is unavailable/
    );
  });
  await t.test('loading count', async () => {
    await assert.rejects(
      collectHibidAccountPages(options(page('', 'Showing 1 - 0 of 5 lots', 1))),
      /list is still loading/
    );
  });
});

test('initial page cannot bypass readiness with a busy empty or nonempty account', async () => {
  for (const body of ['No matches found', `Showing 1 - 1 of 1 lots${lot('901')}`]) {
    const document = dom(`<app-bids-page aria-busy="true">${body}</app-bids-page>`);
    await assert.rejects(collectHibidAccountPages(options(document)), /still loading/);
  }
});
