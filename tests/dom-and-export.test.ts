import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { JSDOM } from 'jsdom';
import { resolveHiBidRoute, routeFingerprint } from '../src/core/route.js';
import { extractAccountLots, extractHibidLotDetail, extractPastAuctionGroupState, extractPastAuctionGroups } from '../src/hibid/dom.js';
import { buildHibidExportPayload, buildHibidLlmBrief } from '../src/hibid/exports.js';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import { chooseNewestJob, jobMatchesContextAndScope } from '../src/core/job-scope.js';
import type { PageContext, ScrapeJobSummary } from '../src/core/types.js';

const accountHtml = `
<section class="listing-box">
  <div class="listing-box-title"><a href="/catalog/765226/a"><strong>Auction A</strong></a><a href="https://maps.google.com/maps?q=Paterson,+NJ">Paterson, NJ</a> | July 31 - August 8</div>
  <app-lot-tile id="lot-6"><a href="/lot/6/steelseries">Lot 6 | SteelSeries Arctis Nova 7 Wireless Xbox</a><img src="https://img/6.jpg">High Bid: $35 4 Bids Won</app-lot-tile>
</section>
<section class="listing-box">
  <div class="listing-box-title"><a href="/catalog/999999/b"><strong>Auction B</strong></a><a href="https://maps.google.com/maps?q=Edison,+NJ">Edison, NJ</a></div>
  <app-lot-tile id="lot-9"><a href="/lot/9/other">Lot 9 | Other</a></app-lot-tile>
</section>`;

test('past auction groups stay isolated to the selected account auction', () => {
  const dom = new JSDOM(accountHtml, { url: 'https://hibid.com/account/pastwatchlist' });
  const groups = extractPastAuctionGroups(dom.window.document, dom.window.location.href);
  assert.equal(groups.length, 2);
  assert.equal(groups[0]?.location, 'Paterson, NJ');
  const route = resolveHiBidRoute(dom.window.location.href);
  const selected = extractAccountLots(dom.window.document, route, dom.window.location.href, groups[0]);
  assert.deepEqual(selected.map((item) => item.id), ['6']);
  assert.equal(extractAccountLots(dom.window.document, route, dom.window.location.href).length, 0);
  assert.deepEqual(extractPastAuctionGroupState(dom.window.document, groups[0]!), { found: true, expectedTotal: 1, visibleCount: 1 });
});

test('past auction groups follow HiBid watched-header sibling boundaries', () => {
  const html = `<div id="lot-tiles-1" class="lot-tiles md-tiles">
    <app-watched-auction-header><div><div class="listing-box-title"><a href="/catalog/111/a"><strong>Auction A</strong></a><a href="https://maps.google.com/maps?q=Cambridge,+MA">Cambridge, MA</a></div></div></app-watched-auction-header>
    <app-lot-tile id="lot-101"><a href="/lot/101/first">Lot 1 | First</a></app-lot-tile>
    <app-lot-tile id="lot-102"><a href="/lot/102/second">Lot 2 | Second</a></app-lot-tile>
    <app-watched-auction-header><div><div class="listing-box-title"><a href="/catalog/222/b"><strong>Auction B</strong></a></div></div></app-watched-auction-header>
    <app-lot-tile id="lot-201"><a href="/lot/201/other">Lot 3 | Other</a></app-lot-tile>
  </div>`;
  const dom = new JSDOM(html, { url: 'https://hibid.com/account/pastwatchlist' });
  const groups = extractPastAuctionGroups(dom.window.document, dom.window.location.href);
  const route = resolveHiBidRoute(dom.window.location.href);
  const selected = extractAccountLots(dom.window.document, route, dom.window.location.href, groups[0]);
  assert.deepEqual(selected.map((item) => item.id), ['101', '102']);
  assert.deepEqual(extractPastAuctionGroupState(dom.window.document, groups[0]!), { found: true, expectedTotal: 2, visibleCount: 2 });
});

test('active watchlist keeps three auction groups isolated, preserves visible lot numbers, and ignores Flippah annotations', () => {
  const groups = [
    ['769995', 'Government Surplus', 'Paterson, NJ'],
    ['765731', 'Pro Audio', 'Edison, NJ'],
    ['767962', 'Aircraft Developer', 'Carteret, NJ']
  ];
  const html = `<div>${groups.map(([auctionId, title, location], groupIndex) => `
    <app-watched-auction-header><div class="listing-box-title"><a href="/catalog/${auctionId}/test"><strong>${title}</strong></a><a href="https://maps.google.com/maps?q=x">${location}</a></div></app-watched-auction-header>
    ${[1, 2, 3].map((lotIndex) => {
      const id = `${groupIndex + 1}00${lotIndex}`;
      return `<app-lot-tile id="lot-${id}"><a href="/lot/${id}/item">Lot ${lotIndex + 10} | Item ${groupIndex + 1}-${lotIndex}</a><div>High Bid: $${lotIndex}.00</div><div class="flippah-deal-strip" data-flippah-owned="true">Amazon: mixed review eBay: --</div><span class="flippah-allin" data-flippah-owned="true">All-in $999</span></app-lot-tile>`;
    }).join('')}`).join('')}</div>`;
  const dom = new JSDOM(html, { url: 'https://hibid.com/account/watchlist' });
  const route = resolveHiBidRoute(dom.window.location.href);
  const items = extractAccountLots(dom.window.document, route, dom.window.location.href);
  assert.equal(items.length, 9);
  assert.deepEqual([...new Set(items.map((item) => item.auctionId))], groups.map(([id]) => id));
  assert.deepEqual(items.slice(0, 3).map((item) => item.lot), ['11', '12', '13']);
  assert.ok(items.every((item) => item.auctionTitle && item.location));
  assert.ok(items.every((item) => !/Amazon:|eBay:|All-in/i.test(item.rawText)));
});

test('lot detail includes lead, category, structured fields, description, and all images', () => {
  const html = `<h1>SteelSeries Arctis Nova 7 Wireless Xbox</h1><table>
    <tr><th>Lot #</th><td>6</td></tr><tr><th>Lead</th><td>SteelSeries Arctis Nova 7 Wireless Xbox</td></tr>
    <tr><th>Group - Category</th><td>Computers &amp; Electronics - Video Games</td></tr>
    <tr><th>Condition</th><td>New - Factory Sealed</td></tr><tr><th>Functional?</th><td>Yes</td></tr>
  </table><div id="description">Shelf Location: Z1<br>In Packaging?: Yes<br>Missing Parts?: No</div>
  <div class="lot-images"><img src="https://img/one.jpg"><img data-src="https://img/two.jpg"></div>
  <aside class="recommendations"><img src="https://img/unrelated.jpg"></aside>`;
  const dom = new JSDOM(html, { url: 'https://hibid.com/lot/6/steelseries' });
  const record = extractHibidLotDetail(dom.window.document, dom.window.location.href)!;
  assert.equal(record.lot, '6');
  assert.match(record.category, /Video Games/);
  assert.match(record.description, /Shelf Location/);
  assert.equal(record.images.length, 2);
  assert.ok(!record.images.some((url) => url.includes('unrelated')));
  assert.equal((record.descriptionFields as Record<string, string>).Condition, 'New - Factory Sealed');
});

test('lot detail rejects consent CSS and auction-level descriptions', () => {
  const html = `<style>.didomi-description { color: red; }</style>
  <div id="didomi-host"><div class="didomi-description">privacy framework text</div></div>
  <h1>Lot # : 19 - Mahlkonig EK43 Coffee Grinder</h1>
  <table id="lot-information">
    <tr><th>Lot #</th><td>19</td></tr>
    <tr><th>Group - Category</th><td>Business &amp; Industrial - Beverage Service</td></tr>
    <tr><th>Lead</th><td>Mahlkonig EK43 Coffee Grinder</td></tr>
  </table>
  <table id="auction-information">
    <tr><th>Name</th><td>Deli Auction</td></tr>
    <tr><th>Description</th><td>This describes the whole auction, not lot 19.</td></tr>
  </table>
  <meta property="og:image" content="https://img/lot-19.jpg">`;
  const dom = new JSDOM(html, { url: 'https://hibid.com/lot/311206926/mahlkonig-ek43-coffee-grinder' });
  const record = extractHibidLotDetail(dom.window.document, dom.window.location.href)!;
  assert.equal(record.description, '');
  assert.equal(record.descriptionHtml, '');
  assert.equal(record.title, 'Mahlkonig EK43 Coffee Grinder');
  assert.equal(record.category, 'Business & Industrial - Beverage Service');
  assert.ok(!Object.values(record.descriptionFields as Record<string, string>).some((value) => /whole auction|privacy framework/i.test(value)));
});

test('LLM brief carries complete-only audit and mandatory resale rules', () => {
  const url = 'https://hibid.com/catalog/765226/example';
  const route = resolveHiBidRoute(url);
  const fingerprint = routeFingerprint(route, url);
  const context: PageContext = { supported: true, url, title: 'Auction', route, fingerprint, visibleExpectedTotal: 1, noMatches: false, auctionGroups: [], job: null };
  const job: ScrapeJobSummary = { jobId: 'j', schemaVersion: 1, tabId: 1, sourceUrl: url, fingerprint, routeKind: 'catalog', scopeId: null, phase: 'completed', revision: 1, expectedTotal: 1, enumeratedCount: 1, hydratedCount: 1, message: 'done', errorCode: '', startedAt: 1, updatedAt: 2, completedAt: 2 };
  const item: any = { id: '1', eventItemId: '1', title: 'Group of electronics', description: 'Model ABC', images: ['https://img/1.jpg'] };
  const payload = buildHibidExportPayload(context, job, [item], DEFAULT_SETTINGS);
  const brief = buildHibidLlmBrief(payload, DEFAULT_SETTINGS);
  assert.match(brief, /generic group lot may not be marked Garbage/i);
  assert.match(brief, /VERIFIED EBAY SOLD DATA/i);
  assert.match(brief, /profit_if_won_now/);
  assert.match(brief, /Mixed Lot \/ Component Review/);
  assert.equal(payload.audit.complete, true);
});

test('private HiBid watch notes are exported only when enabled', () => {
  const url = 'https://hibid.com/account/watchlist';
  const route = resolveHiBidRoute(url);
  const fingerprint = routeFingerprint(route, url);
  const context: PageContext = { supported: true, url, title: 'Watchlist', route, fingerprint, visibleExpectedTotal: 1, noMatches: false, auctionGroups: [], job: null };
  const job: ScrapeJobSummary = { jobId: 'notes', schemaVersion: 1, tabId: 1, sourceUrl: url, fingerprint, routeKind: 'watchlist', scopeId: null, phase: 'completed', revision: 1, expectedTotal: 1, enumeratedCount: 1, hydratedCount: 1, message: 'done', errorCode: '', startedAt: 1, updatedAt: 2, completedAt: 2 };
  const item: any = { id: '1', eventItemId: '1', title: 'Lot', watchNotes: 'private lead note' };
  const hidden = buildHibidExportPayload(context, job, [item], DEFAULT_SETTINGS);
  const included = buildHibidExportPayload(context, job, [item], { ...DEFAULT_SETTINGS, includePrivateWatchNotes: true });
  assert.equal(hidden.items[0]?.watchNotes, undefined);
  assert.equal(included.items[0]?.watchNotes, 'private lead note');
});

test('completed jobs are isolated by route fingerprint and selected past-auction scope', () => {
  const url = 'https://hibid.com/account/pastwatchlist';
  const route = resolveHiBidRoute(url);
  const fingerprint = routeFingerprint(route, url);
  const context: PageContext = { supported: true, url, title: 'Past watchlist', route, fingerprint, visibleExpectedTotal: 2, noMatches: false, auctionGroups: [], job: null };
  const job: ScrapeJobSummary = { jobId: 'a', schemaVersion: 1, tabId: 4, sourceUrl: url, fingerprint, routeKind: 'pastwatchlist', scopeId: '765226', phase: 'completed', revision: 4, expectedTotal: 2, enumeratedCount: 2, hydratedCount: 2, message: 'done', errorCode: '', startedAt: 1, updatedAt: 2, completedAt: 2 };
  assert.equal(jobMatchesContextAndScope(job, context, '765226'), true);
  assert.equal(jobMatchesContextAndScope(job, context, '999999'), false);
  assert.equal(jobMatchesContextAndScope({ ...job, fingerprint: 'stale' }, context, '765226'), false);
});

test('a completed public scrape is not reused after the visible total changes', () => {
  const url = 'https://hibid.com/lots/40198/computers?q=gaming%20pc';
  const route = resolveHiBidRoute(url);
  const fingerprint = routeFingerprint(route, url);
  const context: PageContext = { supported: true, url, title: 'Gaming PCs', route, fingerprint, visibleExpectedTotal: 7, noMatches: false, auctionGroups: [], job: null };
  const completed: ScrapeJobSummary = { jobId: 'old', schemaVersion: 1, tabId: 4, sourceUrl: url, fingerprint, routeKind: 'search', scopeId: null, phase: 'completed', revision: 4, expectedTotal: 5, enumeratedCount: 5, hydratedCount: 5, message: 'done', errorCode: '', startedAt: 1, updatedAt: 2, completedAt: 2 };
  assert.equal(jobMatchesContextAndScope(completed, context), false);
  assert.equal(jobMatchesContextAndScope({ ...completed, expectedTotal: 7, enumeratedCount: 7, hydratedCount: 7 }, context), true);
});

test('older asynchronous job checkpoints cannot overwrite a newer terminal revision', () => {
  const base: ScrapeJobSummary = { jobId: 'j', schemaVersion: 1, tabId: 1, sourceUrl: 'https://hibid.com/lots', fingerprint: 'f', routeKind: 'search', scopeId: null, phase: 'hydrating', revision: 3, expectedTotal: 2, enumeratedCount: 2, hydratedCount: 1, message: 'old', errorCode: '', startedAt: 1, updatedAt: 2, completedAt: null };
  const completed = { ...base, phase: 'completed' as const, revision: 5, hydratedCount: 2, completedAt: 3 };
  assert.equal(chooseNewestJob(completed, base), completed);
  assert.equal(chooseNewestJob(base, completed), completed);
});

test('generated manifests preserve baseline content UI and split background runtimes', async () => {
  const chrome = JSON.parse(await readFile('dist/chrome/manifest.json', 'utf8'));
  const waterfox = JSON.parse(await readFile('dist/waterfox/manifest.json', 'utf8'));
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  assert.equal(chrome.version, pkg.version);
  assert.equal(waterfox.version, pkg.version);
  assert.equal(chrome.name, 'Flippah by ALOS');
  assert.equal(chrome.short_name, 'Flippah');
  assert.equal(chrome.author, 'ALOS');
  assert.equal(chrome.action.default_title, 'Open Flippah by ALOS');
  assert.match(chrome.description, /smarter flips/i);
  for (const size of [16, 32, 48, 128]) {
    assert.ok((await readFile(`dist/chrome/icons/icon-${size}.png`)).byteLength > 0);
  }
  assert.equal(chrome.background.service_worker, 'background.js');
  assert.deepEqual(waterfox.background.scripts, ['background.js']);
  assert.ok(chrome.content_scripts[0].js.includes('legacy-content.js'));
  assert.ok(chrome.content_scripts[0].js.includes('content.js'));
  assert.equal(chrome.action.default_popup, 'popup/index.html');
  assert.equal(chrome.options_page, 'options/index.html');
  await readFile(`dist/chrome/${chrome.options_page}`, 'utf8');
});

test('popup is toolbar-based with Current Page and Watchlist and no page overlay panel', async () => {
  const popup = await readFile('src/popup/index.ts', 'utf8');
  const content = await readFile('src/content/index.ts', 'utf8');
  assert.match(popup, /Current Page/);
  assert.match(popup, /Watchlist/);
  assert.match(popup, /await updateContextFromTab\(\);/);
  assert.match(popup, /startPolling\(\);/);
  assert.match(popup, /toastFromRefreshError/);
  assert.match(popup, /previousFingerprint !== nextContext\.fingerprint/);
  assert.doesNotMatch(content, /appendChild\([^)]*panel|flipperaddon-panel/);
});
