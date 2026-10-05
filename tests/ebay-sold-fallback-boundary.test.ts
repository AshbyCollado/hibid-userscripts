import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { parsePublicEbaySoldSearch } from '../src/intelligence/ebay-sold-results.js';

const sourceUrl = 'https://www.ebay.com/sch/i.html?_nkw=West+Elm+Cozy+Plush+rug+9x12&LH_Sold=1&LH_Complete=1';

function card(itemId: string, title: string, price: string): string {
  return `<li class="s-card" id="item${itemId}">
    <a class="s-card__link" href="https://www.ebay.com/itm/${itemId}"><span class="s-card__title">${title}</span></a>
    <span class="s-card__caption">Sold Sep 13, 2026</span>
    <span class="s-card__price">${price}</span>
    <span class="s-card__subtitle">New</span>
  </li>`;
}

function parse(html: string) {
  return parsePublicEbaySoldSearch(new JSDOM(html, { url: sourceUrl }).window.document, sourceUrl, '2026-09-22T12:00:00.000Z');
}

test('public sold parser stops at the rewrite boundary and ignores fallback cards', () => {
  const result = parse(`<h1 id="srp-results-heading">0 results for West Elm Cozy Plush rug 9x12</h1>
    <div id="srp-river-results">
      <ul class="srp-results">${card('111111111111', 'West Elm Cozy Plush Rug 9x12', '$360.00')}
        <li class="s-card" id="item222222222222"><a href="https://www.ebay.com/itm/222222222222"><span class="s-card__title">West Elm Exact Variant</span></a><span class="s-card__caption">Sold Sep 12, 2026</span><span class="s-card__price">$400.00</span></li>
      </ul>
      <div class="srp-river-answer--SAVE_CARD"><h3 class="srp-save-null-search__heading">No exact matches found</h3></div>
      <div class="srp-river-answer--REWRITE_START"><h2 class="clipped">Results matching fewer words</h2><ul class="srp-results">
        ${card('117272601357', 'West Elm Karima Reversible Rug 6x9 Ft Copper New!', '$360.00')}
        ${card('128019326475', 'WEST ELM Lavander Purple 21x12 Sheepskin Pillow Cover Set2', '$38.50')}
        ${card('158205873933', 'West Elm Plush Waffle Bath Mat 20x34', '$33.99')}
      </ul></div>
    </div>`);

  assert.equal(result.status, 'ok');
  assert.deepEqual(result.records.map((record) => record.itemId), ['111111111111', '222222222222']);
});

test('authoritative empty settled results are no-results, while a skeleton remains parse-error', () => {
  const empty = parse('<h1 id="srp-results-heading">0 results for West Elm Cozy Plush rug 9x12</h1><div id="srp-river-results"><ul class="srp-results"></ul></div>');
  assert.equal(empty.status, 'no-results');
  assert.equal(empty.records.length, 0);

  const loading = parse('<h1 id="srp-results-heading">West Elm Cozy Plush rug 9x12</h1><div id="srp-river-results"><ul class="srp-results"><li class="s-card"><div class="s-card__title"></div></li></ul></div>');
  assert.equal(loading.status, 'parse-error');
  assert.equal(loading.records.length, 0);

  const busy = parse('<h1 id="srp-results-heading">0 results for West Elm Cozy Plush rug 9x12</h1><div id="srp-river-results" aria-busy="true"><ul class="srp-results"></ul></div>');
  assert.equal(busy.status, 'parse-error');
  assert.equal(busy.failureReason, 'sold-search-still-loading');
});
