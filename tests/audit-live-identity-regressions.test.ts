import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProductResearchQuery, extractProductIdentity, evaluateRetailCandidate } from '../src/intelligence/us-deal-intelligence.js';
import { buildTitleMutations } from '../src/testing/title-corpus.js';

test('Buda speakers retain package count without inventing a 2-Pc model', () => {
  const identity = extractProductIdentity('$20 Insignia 2.0 Computer Speakers (2-Pc) Black');
  assert.equal(identity.model, null);
  assert.equal(identity.model2, null);
  assert.match(identity.query, /2-pc/);
  assert.ok(identity.discriminators.packageCounts.includes('2'));
  const result = evaluateRetailCandidate('Insignia 2.0 Computer Speakers 2 Piece Black', identity);
  assert.ok(!result.rejectionReasons.some((reason) => /model/i.test(reason)), JSON.stringify(result));
});

test('piece and stone counts are not inferred manufacturer model codes', () => {
  for (const title of ['Insignia Speakers 2PCS Black', 'Insignia Speakers 2-PC Black', '.925 7-Stone Coral Cuff', 'Sterling Silver 3-Stones Ring']) {
    const identity = extractProductIdentity(title);
    assert.equal(identity.model, null, title);
    assert.equal(identity.model2, null, title);
  }
});

test('count filter preserves genuine digit-led, hyphenated and explicit manufacturer models', () => {
  const cases = [
    ['Onkyo TX-SR304 AV Receiver', 'TX-SR304'],
    ['Rode NT-USB+ Microphone', 'NT-USB+'],
    ['ASUS ROG STRIX B850-A Gaming WiFi', 'B850-A'],
  ];
  for (const [title, model] of cases) assert.equal(extractProductIdentity(title).model, model, title);
  assert.equal(extractProductIdentity('Acme Controller', 'Brand: Acme\nModel: 2-PC').model, '2-PC');
});

test('condition prefixes are removed in one canonical query pass', () => {
  const query = buildProductResearchQuery('NEW IN BOX, ANKLE & WRIST WEIGHTS');
  assert.equal(query, 'ankle wrist weights');
  assert.equal(buildProductResearchQuery(query), query);
});

test('No. 2A identity is preserved in the original title and unambiguous outer labels', () => {
  const title = 'No. 2A Folding Autographic Brownie';
  const expected = buildProductResearchQuery(title);
  assert.equal(expected, 'no 2a folding autographic brownie');
  assert.equal(buildProductResearchQuery(title), expected);
  assert.equal(buildProductResearchQuery(`Lot 999 | ${title}`), expected);
  assert.equal(buildProductResearchQuery(`Item 999 | ${title}`), expected);
  for (const mutation of buildTitleMutations(title).filter(({ name }) => name === 'bare-lot-label' || name === 'bare-item-label')) {
    assert.equal(mutation.expectsSameQuery, false, mutation.title);
  }
});

test('ambiguous bare alphanumeric lot labels preserve product identity', () => {
  assert.equal(
    buildProductResearchQuery('Lot 9A Dell XPS 13 Laptop'),
    '9a dell xps 13 laptop',
  );
  const identityPreservingCases = [
    ['Lot 3D Printer', '3d printer'],
    ['Lot 4K Smart Projector', '4k smart projector'],
    ['Lot 5G Router', '5g router'],
    ['Lot 8TB Drive', '8tb drive'],
  ];
  for (const [title, expected] of identityPreservingCases) {
    assert.equal(buildProductResearchQuery(title), expected, title);
  }
  assert.equal(
    buildProductResearchQuery('Lot No. 9A Dell XPS 13 Laptop'),
    'dell xps 13 laptop',
  );
  assert.equal(
    buildProductResearchQuery('Item No. 9A Dell XPS 13 Laptop'),
    'dell xps 13 laptop',
  );
  assert.equal(
    buildProductResearchQuery('Lot No. 2A Folding Autographic Brownie'),
    'folding autographic brownie',
  );
});
