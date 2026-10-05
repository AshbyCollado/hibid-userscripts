import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateRetailCandidate, extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';

test('age-prefixed generic ring identity does not require seller abbreviation as a brand', () => {
  const identity = extractProductIdentity('Vntg. Sterling Silver Girl Scout Ring Size 5');

  assert.equal(identity.brand, '');
  assert.equal(evaluateRetailCandidate('Sterling Silver Girl Scout Ring Size 5', identity).accepted, true);
});

test('a genuine brand following an age prefix remains product identity', () => {
  const identity = extractProductIdentity('vintage Bowers & Wilkins Headphones');

  assert.equal(identity.brand, 'Bowers & Wilkins');
  assert.equal(evaluateRetailCandidate('Bowers and Wilkins Wireless Headphones', identity).accepted, true);
});

test('unknown material-only age-prefixed jewelry does not become a brand', () => {
  for (const title of ['VNTG sterling silver ring size 5', 'antq. gold bracelet', 'vintage brass pendant']) {
    assert.equal(extractProductIdentity(title).brand, '', title);
  }
});

test('model-bearing and embedded age-like tokens are not stripped', () => {
  const model = extractProductIdentity('ANTQ-123 sterling silver buckle broach pin');
  const embedded = extractProductIdentity('VNTGuitar sterling silver buckle broach pin');

  assert.equal(model.brand, 'ANTQ-123');
  assert.equal(model.model, 'ANTQ-123');
  assert.equal(embedded.brand, 'VNTGuitar');
});

test('a different actual brand still rejects an age-prefixed known brand', () => {
  const identity = extractProductIdentity('vintage Tiffany ring');
  const result = evaluateRetailCandidate('vintage Cartier ring', identity);

  assert.equal(identity.brand, 'Tiffany');
  assert.equal(result.accepted, false);
  assert.ok(result.rejectionReasons.includes('brand-mismatch:tiffany'));
});

test('an age prefix does not let a conflicting structured brand replace the title brand', () => {
  const identity = extractProductIdentity('vintage Tiffany sterling silver ring size 5', 'Brand: Cartier');

  assert.equal(identity.brand, 'Tiffany');
  assert.equal(evaluateRetailCandidate('Tiffany sterling silver ring size 5', identity).accepted, true);
  assert.equal(evaluateRetailCandidate('Cartier sterling silver ring size 5', identity).accepted, false);
});

test('material-like brand names remain identity outside jewelry', () => {
  const identity = extractProductIdentity('vintage Sterling bass guitar');

  assert.equal(identity.brand, 'Sterling');
  assert.equal(evaluateRetailCandidate('Sterling bass guitar', identity).accepted, true);
  assert.equal(evaluateRetailCandidate('Yamaha bass guitar', identity).accepted, false);
});

test('included accessory nouns do not turn a non-jewelry product into material-only identity', () => {
  for (const inclusion of ['with strap pin', 'w/ strap pin', 'w/strap pin', 'including strap pin', 'includes strap pin']) {
    const identity = extractProductIdentity(`vintage Sterling bass guitar ${inclusion}`);

    assert.equal(identity.brand, 'Sterling', inclusion);
    assert.equal(evaluateRetailCandidate(`Yamaha bass guitar ${inclusion}`, identity).accepted, false, inclusion);
  }
});
