import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEbaySoldQueryVariants } from '../src/intelligence/ebay-sold-results.js';
import { extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';

test('jewelry-making broach tools are not rewritten as decorative brooches', () => {
  for (const title of ['vntg jewelry ring broach tool for gold silver', 'antq silver jewelry broach tools']) {
    const identity = extractProductIdentity(title);
    const variants = buildEbaySoldQueryVariants(identity, 3);
    assert.equal(variants[0], identity.query);
    assert.ok(variants.every((query) => !/\bbrooch\b/i.test(query)), title);
  }
});

test('seller antique abbreviation and jewelry misspelling get one identity-preserving fallback', () => {
  const identity = extractProductIdentity('antq sterling silver buckle broach pin');
  const variants = buildEbaySoldQueryVariants(identity, 2);

  assert.equal(variants[0], 'antq sterling silver buckle broach pin');
  assert.equal(variants[1], 'sterling silver buckle brooch pin');
  assert.equal(variants.length, 2);
  assert.equal(new Set(variants.map((query) => query.toLowerCase())).size, variants.length);
});

test('vintage abbreviation fallback preserves the material and jewelry core', () => {
  const variants = buildEbaySoldQueryVariants(extractProductIdentity('vntg sterling silver buckle broach pin'), 2);

  assert.deepEqual(variants, [
    'vntg sterling silver buckle broach pin',
    'sterling silver buckle brooch pin',
  ]);
});

test('model-bearing abbreviations remain source identity and receive no fallback', () => {
  const variants = buildEbaySoldQueryVariants(
    extractProductIdentity('ANTQ-123 sterling silver buckle broach pin'),
  );

  assert.equal(variants[0], 'antq-123 sterling silver buckle broach pin');
  assert.ok(variants.every((query) => !/^sterling silver buckle brooch pin$/i.test(query)));
});

test('non-jewelry broach text and embedded abbreviation text are untouched', () => {
  const tooling = buildEbaySoldQueryVariants(extractProductIdentity('antq tooling broach silver drill'));
  const embedded = buildEbaySoldQueryVariants(extractProductIdentity('VNTGuitar sterling silver buckle broach pin'));

  assert.ok(tooling.every((query) => !/brooch/i.test(query)));
  assert.ok(embedded.every((query) => !/^sterling silver buckle brooch pin$/i.test(query)));
});

test('tool-context words veto broach correction even with guide-pin jewelry-like wording', () => {
  const variants = buildEbaySoldQueryVariants(
    extractProductIdentity('antq sterling silver HSS broach with guide pin'),
  );

  assert.ok(variants.every((query) => !/brooch/i.test(query)));
});

test('fallback honors maximum one, two, and three with stable deduplication', () => {
  const identity = extractProductIdentity('antq sterling silver buckle broach pin');
  const original = 'antq sterling silver buckle broach pin';
  const fallback = 'sterling silver buckle brooch pin';

  assert.deepEqual(buildEbaySoldQueryVariants(identity, 1), [original]);
  assert.deepEqual(buildEbaySoldQueryVariants(identity, 2), [original, fallback]);
  const maxThree = buildEbaySoldQueryVariants(identity, 3);
  assert.deepEqual(maxThree.slice(0, 2), [original, fallback]);
  assert.ok(maxThree.length <= 3);
  assert.equal(new Set(maxThree.map((query) => query.toLowerCase())).size, maxThree.length);
});

test('fallback retains quantity-bearing identity tokens', () => {
  const variants = buildEbaySoldQueryVariants(
    extractProductIdentity('antq 2 sterling silver buckle broach pin'),
    2,
  );

  assert.equal(variants[0], 'antq 2 sterling silver buckle broach pin');
  assert.equal(variants[1], '2 sterling silver buckle brooch pin');
});
