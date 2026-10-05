import test from 'node:test';
import assert from 'node:assert/strict';

import { buildEbaySoldQueryVariants } from '../src/intelligence/ebay-sold-results.js';
import { extractProductIdentity, modelMatches } from '../src/intelligence/us-deal-intelligence.js';

test('digit-ending joined models get a conservative spaced, brand-attached variant', () => {
  const identity = extractProductIdentity(
    'BMAX i9Plus 10.1 IPS Tablet',
    'Brand: BMAX\nModel: i9Plus',
  );
  const variants = buildEbaySoldQueryVariants(identity);

  assert.equal(identity.brand, 'BMAX');
  assert.equal(identity.model, 'i9Plus');
  assert.deepEqual(variants, [
    'bmax i9plus 10.1 ips tablet',
    'BMAX i9 Plus',
    'BMAX i9Plus',
  ]);
  assert.equal(variants.length, 3);
  assert.equal(modelMatches('BMAX i9 Plus 10.1 IPS Tablet', identity.model), true);
  assert.equal(modelMatches('BMAX i9 Tablet', identity.model), false);
  assert.equal(modelMatches('BMAX i9 Pro Tablet', identity.model), false);
});

test('joined-model suffix matching is case-insensitive without changing the source model spelling', () => {
  for (const model of ['i9plus', 'I9PLUS', 'i9Pro', 'i9MAX', 'i9Mini', 'i9Ultra']) {
    const identity = extractProductIdentity(`BMAX ${model} Tablet`, `Brand: BMAX\nModel: ${model}`);
    const variants = buildEbaySoldQueryVariants(identity);
    assert.equal(variants[1], `BMAX ${model.slice(0, -model.match(/(?:plus|pro|max|mini|ultra)$/i)![0].length)} ${model.match(/(?:plus|pro|max|mini|ultra)$/i)![0]}`);
  }
});

test('unrelated model forms retain their existing sold-query variants', () => {
  assert.deepEqual(buildEbaySoldQueryVariants(extractProductIdentity('RODE NT-USB+ USB Condenser Microphone')), [
    'rode nt-usb+ usb condenser microphone',
    'RODE NT-USB+',
    'NT-USB+',
  ]);
  assert.deepEqual(buildEbaySoldQueryVariants(extractProductIdentity('Onkyo TX-SR304 Multi-Channel AV Receiver')), [
    'onkyo tx-sr304 multi-channel av receiver',
    'Onkyo TX-SR304',
    'TX-SR304',
  ]);
  const gpu = extractProductIdentity('ASUS ROG Strix GeForce RTX 4070 Ti SUPER Graphics Card');
  assert.equal(buildEbaySoldQueryVariants(gpu)[0], gpu.query);
  assert.ok(buildEbaySoldQueryVariants(gpu).every((query) => !/\brtx\s+4070\s+ti\s+super\s+plus\b/i.test(query)));
});
