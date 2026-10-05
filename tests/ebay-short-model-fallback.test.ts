import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEbaySoldQueryVariants } from '../src/intelligence/ebay-sold-results.js';
import { extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';

test('short model fallback retains the brand instead of searching a collision-prone bare code', () => {
  const identity = extractProductIdentity('Rane HC6 Headphone Console - Rackmount - Music Studio');
  assert.equal(identity.model, 'HC6');
  assert.deepEqual(buildEbaySoldQueryVariants(identity), [
    'rane hc6 headphone console rackmount music studio', 'Rane HC6',
  ]);
});

test('short-code protection preserves bounded queries and longer distinctive models', () => {
  const source = extractProductIdentity('Onkyo TX-SR304 Multi-Channel AV Receiver');
  assert.equal(buildEbaySoldQueryVariants(source).at(-1), 'TX-SR304');
  for (const model of ['F3', 'HC-6', 'FS45', 'X100']) {
    const identity = { ...source, model };
    assert.ok(!buildEbaySoldQueryVariants(identity).some(query => query === model), model);
    assert.equal(buildEbaySoldQueryVariants(identity, 1).length, 1);
    assert.ok(buildEbaySoldQueryVariants(identity).some(query => query === `Onkyo ${model}`));
  }
});

test('short-model v2 allows placeholder-brand discovery but protects real brands at four characters', () => {
  for (const brand of ['Unknown', 'Unbranded', 'Generic', 'N/A']) {
    const identity = { ...extractProductIdentity(`${brand} HC6 Headphone Console`), brand, model: 'HC6' };
    assert.ok(buildEbaySoldQueryVariants(identity).includes('HC6'), brand);
  }
  const realBrand = extractProductIdentity('Zoom F3 Field Recorder');
  assert.equal(realBrand.model, 'F3');
  assert.ok(!buildEbaySoldQueryVariants(realBrand).includes('F3'));
  assert.ok(buildEbaySoldQueryVariants({ ...realBrand, model: 'ABCD' }).includes('Zoom ABCD'));
  assert.ok(!buildEbaySoldQueryVariants({ ...realBrand, model: 'ABCD' }).includes('ABCD'));
  assert.ok(buildEbaySoldQueryVariants({ ...realBrand, model: 'ABCDE' }).includes('ABCDE'));
});

test('short-model query planning deduplicates the bare model and preserves complete two-query coverage', () => {
  const identity = extractProductIdentity('Unknown HC6 Headphone Console');
  assert.deepEqual(buildEbaySoldQueryVariants(identity), [
    'unknown hc6 headphone console', 'Unknown HC6', 'HC6',
  ]);
  assert.deepEqual(buildEbaySoldQueryVariants(identity, 2), [
    'unknown hc6 headphone console', 'Unknown HC6',
  ]);
});
