import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEbaySoldQueryVariants } from '../src/intelligence/ebay-sold-results.js';
import { extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';

test('brand already in a named model is not repeated in sold fallback queries', () => {
  const identity = extractProductIdentity("Vintage Carvin Pro Bass 150 Amplifier Head - 1980's");
  assert.deepEqual(buildEbaySoldQueryVariants(identity), [
    'vintage carvin pro bass 150 amplifier head 1980s', 'Carvin Pro Bass 150',
  ]);
});

test('brand prefix deduplication is literal, case insensitive and token bounded', () => {
  const identity = extractProductIdentity('Onkyo TX-SR304 Multi-Channel AV Receiver');
  for (const [brand, model, expected] of [
    ['J.Crew', 'j.crew Special 300', 'j.crew Special 300'],
    ['Hewlett Packard', 'Hewlett Packard Pro 300', 'Hewlett Packard Pro 300'],
    ['Carvin', 'Carvintage 150', 'Carvin Carvintage 150'],
    ['J.Crew', 'JXCrew 300', 'J.Crew JXCrew 300'],
  ]) {
    assert.equal(buildEbaySoldQueryVariants({ ...identity, brand, model })[1], expected);
  }
  assert.deepEqual(buildEbaySoldQueryVariants(identity), [
    'onkyo tx-sr304 multi-channel av receiver', 'Onkyo TX-SR304', 'TX-SR304',
  ]);
});
