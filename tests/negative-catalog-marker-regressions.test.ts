import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateRetailCandidate, extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';

test('ordinary bare no-negations do not become catalogue numbers', () => {
  const cases = [
    ['Husqvarna LTH18542 Riding Mower - NO DECK', 'Husqvarna LTH18542 Riding Mower', 'no deck'],
    ['Acme Widget No remote', 'Acme Widget', 'no remote'],
    ['Acme Widget No sound', 'Acme Widget', 'no sound'],
    ['Acme Widget No power', 'Acme Widget', 'no power'],
    ['Nokia3310 Phone', 'Nokia 3310 Phone', 'nokia'],
    ['Nokia 3310 Phone', 'Nokia3310 Phone', 'nokia'],
  ];

  for (const [sourceTitle, candidateTitle, expectedQueryText] of cases) {
    const identity = extractProductIdentity(sourceTitle);
    const result = evaluateRetailCandidate(candidateTitle, identity);
    assert.match(identity.name, new RegExp(expectedQueryText.replace(' ', '\\s+'), 'i'), sourceTitle);
    assert.match(identity.query, new RegExp(expectedQueryText.replace(' ', '\\s+'), 'i'), sourceTitle);
    assert.equal(result.rejectionReasons.some((reason) => reason.includes('catalog-number')), false, sourceTitle);
  }
});

test('genuine catalogue markers remain strict identity signals', () => {
  const cases = [
    ['Acme Widget #ABC123', 'Acme Widget #XYZ999'],
    ['Acme Widget Number ABC123', 'Acme Widget Number XYZ999'],
    ['Acme Widget No. 2A', 'Acme Widget No. 3A'],
    ['Acme Widget No.161', 'Acme Widget No.162'],
    ['Acme Widget No 161', 'Acme Widget No 162'],
    ['Acme Widget No2A', 'Acme Widget No3A'],
    ['Acme Widget No161', 'Acme Widget No162'],
    ['Acme Widget No ABC123', 'Acme Widget No XYZ999'],
  ];

  for (const [sourceTitle, candidateTitle] of cases) {
    const result = evaluateRetailCandidate(candidateTitle, extractProductIdentity(sourceTitle));
    assert.equal(result.accepted, false, sourceTitle);
    assert.match(result.rejectionReasons.join(' '), /identity-conflict:catalog-number/, sourceTitle);
  }
});
