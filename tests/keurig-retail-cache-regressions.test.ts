import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRetailIdentity } from '../src/background/retail-identity.js';
import { canReuseRetailEvidence, retailIdentityFingerprint } from '../src/content/deal-intelligence.js';
import { extractProductIdentity, matchAmazonCandidates } from '../src/intelligence/us-deal-intelligence.js';

test('a corrected Keurig model invalidates retained evidence even with the same query', () => {
  const identity = extractProductIdentity('Keurig K-Select Single-Serve Coffee Maker');
  const oldIdentity = { ...identity, model: null };
  const evidence = {
    query: identity.query,
    identityFingerprint: retailIdentityFingerprint(oldIdentity),
    amazonOverrideAsin: '',
    result: {
      status: 'matched' as const,
      query: identity.query,
      match: null,
      candidates: [],
      fetchedAt: 1,
      cached: true,
      message: '',
    },
  };
  assert.equal(identity.model, 'K-Select');
  assert.notEqual(retailIdentityFingerprint(identity), evidence.identityFingerprint);
  assert.equal(canReuseRetailEvidence(evidence, identity, null), false);
});

test('transported identity rejects a priced wrong-model cached result when exact model has no price', () => {
  const identity = validateRetailIdentity(JSON.parse(JSON.stringify(extractProductIdentity({
    title: '$127 Keurig K-Select Single-Serve Coffee Maker',
    description: 'Brand: Keurig\nModel: K-Select Coffee Maker',
  }))));
  assert.equal(identity.model, 'K-Select');
  const result = matchAmazonCandidates([
    { asin: 'select', title: 'Keurig K-Select Single-Serve Coffee Maker', price: null, used: false, sponsored: false, url: 'https://www.amazon.com/dp/B000000001' },
    { asin: 'compact', title: 'Keurig K-Compact Single-Serve Coffee Maker', price: 69.99, used: false, sponsored: false, url: 'https://www.amazon.com/dp/B000000002' },
  ], identity);
  assert.equal(result, null);
});
