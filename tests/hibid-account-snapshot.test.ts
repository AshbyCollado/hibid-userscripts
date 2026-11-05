import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { snapshotHibidAccountPage } from '../src/hibid/account-snapshot.js';
import { resolveHiBidRoute } from '../src/core/route.js';

const url = 'https://hibid.com/account/watchlist';
const route = resolveHiBidRoute(url);
const row = '<div class="lot-tile lot-card" id="lot-101"><a href="/lot/101/camera">Camera</a></div>';
function page(body: string): Document {
  return new JSDOM(`<app-watch-list-page>${body}</app-watch-list-page>`, { url }).window.document;
}

test('account snapshots reject busy roots and descendants for empty and nonempty lists', () => {
  for (const rows of ['No matches found', `Showing 1 - 1 of 1 lots${row}`]) {
    const document = page(rows);
    document.querySelector('app-watch-list-page')!.setAttribute('aria-busy', 'true');
    assert.throws(() => snapshotHibidAccountPage(document, url, route), /still loading/);
    document.querySelector('app-watch-list-page')!.removeAttribute('aria-busy');
    document.querySelector('app-watch-list-page')!.insertAdjacentHTML('afterbegin', '<div class="spinner-border"></div>');
    assert.throws(() => snapshotHibidAccountPage(document, url, route), /still loading/);
  }
});

test('account snapshots reject incomplete ranges, stale empty counts and wrong paginator values', () => {
  assert.throws(() => snapshotHibidAccountPage(page(`Showing 1 - 2 of 2 lots${row}`), url, route), /still loading/);
  assert.throws(() => snapshotHibidAccountPage(page(`No matches found${row}`), url, route), /still loading|unavailable/);
  const document = page(`<app-paginator>Showing 1 - 1 of 1 lots<input name="jumpPageInput" value="2"></app-paginator>${row}`);
  assert.throws(() => snapshotHibidAccountPage(document, url, route), /still loading/);
});

test('account snapshots use rendered DOM before unrelated page resources finish', () => {
  const document = page(`Showing 1 - 1 of 1 lots${row}`);
  Object.defineProperty(document, 'readyState', { value: 'interactive' });
  const snapshot = snapshotHibidAccountPage(document, url, route);
  assert.equal(snapshot.expectedTotal, 1);
  assert.equal(snapshot.page, 1);
  assert.deepEqual(snapshot.items.map(item => item.id), ['101']);
  assert.equal('document' in snapshot, false);
});

test('account snapshots retain supported state-prefixed account routes', () => {
  const prefixed = 'https://hibid.com/newjersey/account/watchlist/';
  const document = new JSDOM(`<app-watch-list-page>Showing 1 - 1 of 1 lots${row}</app-watch-list-page>`, { url: prefixed }).window.document;
  const snapshot = snapshotHibidAccountPage(document, prefixed, resolveHiBidRoute(prefixed));
  assert.equal(snapshot.url, prefixed);
  assert.deepEqual(snapshot.items.map(item => item.id), ['101']);
});

test('account snapshots distinguish genuine empty, login, challenge and unavailable pages', () => {
  assert.equal(snapshotHibidAccountPage(page('No matches found'), url, route).expectedTotal, 0);
  assert.throws(() => snapshotHibidAccountPage(page('Loading...'), url, route), /still loading/);
  assert.throws(() => snapshotHibidAccountPage(page('<h1>Verify you are human</h1>'), url, route), /verification/);
  assert.throws(() => snapshotHibidAccountPage(page('<input type="password">'), url, route), /verification/);
  assert.throws(() => snapshotHibidAccountPage(page('No matches found'), 'https://evil.example/account/watchlist', route), /changed/);
  assert.throws(() => snapshotHibidAccountPage(page('No matches found'), 'https://hibid.com/pf/login', route), /changed/);
});
