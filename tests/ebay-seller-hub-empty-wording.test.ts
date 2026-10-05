import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { parseSellerHubProductResearch } from '../src/intelligence/ebay-sold-results.js';

const soldUrl = 'https://www.ebay.com/sh/research?marketplace=EBAY-US&keywords=antique+cork-screw+hay+fork&tabName=SOLD';

function documentFor(message: string, selected = 'Sold'): Document {
  return new JSDOM(`<div role="tab" aria-selected="true">${selected}</div>
    <section role="tabpanel">${message}</section>`).window.document;
}

test('Seller Hub native empty-search wording establishes one empty Sold attempt', () => {
  for (const contraction of ["didn't", 'did not', 'didn\u2019t']) {
    const result = parseSellerHubProductResearch(documentFor(
      `Your search ${contraction} return any results. Please enter a new search term and try again.`,
    ), soldUrl);
    assert.equal(result.status, 'no-results', contraction);
    assert.equal(result.records.length, 0);
    assert.equal(result.failureReason, null);
    assert.equal(result.hasNextPage, false);
  }
});

test('empty wording does not override Active context or an empty unrecognized panel', () => {
  assert.equal(parseSellerHubProductResearch(documentFor(
    "Your search didn't return any results.", 'Active',
  ), soldUrl.replace('tabName=SOLD', 'tabName=ACTIVE')).status, 'not-sold-context');
  assert.equal(parseSellerHubProductResearch(documentFor(''), soldUrl).status, 'parse-error');
});
