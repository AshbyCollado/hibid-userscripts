import assert from 'node:assert/strict';
import test from 'node:test';
import { buildEbaySoldQueryVariants } from '../src/intelligence/ebay-sold-results.js';
import { evaluateRetailCandidate, extractProductIdentity, isAccessoryListing, scoreRetailCandidate } from '../src/intelligence/us-deal-intelligence.js';

const sourceTitle = 'Alesis Midiverb II 16-bit Digital Multi-effects Rack Processor - Studio / Guitar';

test('recovers the whole Alesis Midiverb generation and planned sold queries', () => {
  for (const [generation, model] of [['II', 'Midiverb II'], ['2', 'Midiverb II'], ['III', 'Midiverb III'], ['3', 'Midiverb III'], ['IV', 'Midiverb IV'], ['4', 'Midiverb IV']]) {
    assert.equal(extractProductIdentity(`Alesis Midiverb ${generation}`).model, model, generation);
  }
  const identity = extractProductIdentity(sourceTitle);
  assert.equal(identity.model, 'Midiverb II');
  assert.equal(identity.model2, null);
  assert.deepEqual(buildEbaySoldQueryVariants(identity).slice(-2).map((query) => query.toLowerCase()), ['alesis midiverb ii', 'midiverb ii']);
  assert.match(buildEbaySoldQueryVariants(identity)[0]!, /alesis midiverb ii 16-bit/i);
});

test('matches only the same named Midiverb generation, including numeric spelling', () => {
  const identity = extractProductIdentity(sourceTitle);
  assert.equal(evaluateRetailCandidate('Alesis Midiverb II Digital Multi-effects Rack Processor', identity).accepted, true);
  assert.equal(evaluateRetailCandidate('Alesis Midiverb 2 Digital Multi-effects Rack Processor', identity).accepted, true);
  for (const title of [
    'Alesis Midiverb III Digital Multi-effects Rack Processor',
    'Alesis Midiverb IV Digital Multi-effects Rack Processor',
    'Alesis Midiverb 4 Digital Multi-effects Rack Processor',
    'Behringer Midiverb II Digital Multi-effects Rack Processor',
    'Alesis Midiverb II Footswitch',
  ]) {
    assert.equal(evaluateRetailCandidate(title, identity).accepted, false, title);
  }
});

test('does not turn accessory, compatibility, or ordinary Roman text into model aliases', () => {
  for (const title of [
    'Alesis Midiverb II with Canon R6 II accessory',
    'Power supply compatible with Alesis Midiverb II',
    'Alesis Midiverb II without power supply',
  ]) {
    const identity = extractProductIdentity(title);
    assert.equal(identity.model, title.startsWith('Power supply') ? null : 'Midiverb II', title);
  }
  assert.equal(extractProductIdentity('Alesis Midiverb II without power supply').model2, null);
  for (const title of ['Collector Edition II Book', 'Volume IV Book', 'World War II Book', 'Alesis Effects Processor II', 'Alesis Midiverb II Volume IV Book']) {
    assert.equal(extractProductIdentity(title).model, null, title);
  }
  assert.equal(extractProductIdentity('Alesis Midiverb II', 'Model: AMV-900').model, 'AMV-900');
});

test('preserves existing SKU, Canon generation, and bit-depth model behavior', () => {
  assert.equal(extractProductIdentity('Onkyo TX-SR304 Multi-Channel AV Receiver').model, 'TX-SR304');
  assert.equal(extractProductIdentity('Canon EOS R6 II Camera').model, 'R6');
  assert.equal(extractProductIdentity('Alesis Midiverb II 32-bit-float Digital Multi-effects Rack Processor').model, 'Midiverb II');
});

test('primary Midiverb generation gates exact Roman and numeric matching before compatibility targets', () => {
  const product = extractProductIdentity(sourceTitle);
  for (const title of [
    'Alesis Midiverb IV compatible with Midiverb II',
    'Alesis Midiverb 4 compatible with Midiverb II',
    'Alesis Midiverb III works with Midiverb 2',
    'Alesis Midiverb 3 for use with Midiverb II',
    'Alesis Quadraverb compatible with Midiverb II',
  ]) {
    const result = evaluateRetailCandidate(title, product);
    assert.equal(result.accepted, false, title);
    assert.ok(result.rejectionReasons.some((reason) => reason.startsWith('model-mismatch:')), title);
    assert.equal(scoreRetailCandidate(title, product), 0, title);
  }
  assert.equal(evaluateRetailCandidate('Alesis Midiverb II compatible with Midiverb IV', product).accepted, true);
});

test('conflicting full or abbreviated primary generations cannot supply a definitive model or match', () => {
  const product = extractProductIdentity(sourceTitle);
  for (const generations of ['II/III', '2/4', 'II and IV', 'II or III', 'II & 4', 'II, IV', 'II/ Midiverb III', 'II and Alesis Midiverb IV', 'II Midiverb IV', 'II (or IV)', 'II-III', 'II/III/IV', 'II and III or 4']) {
    const title = `Alesis Midiverb ${generations} Digital Effects Processor`;
    const ambiguous = extractProductIdentity(title);
    assert.equal(ambiguous.model, null, title);
    assert.equal(evaluateRetailCandidate(title, product).accepted, false, title);
    assert.equal(evaluateRetailCandidate(sourceTitle, ambiguous).accepted, false, title);
    assert.equal(evaluateRetailCandidate(title, ambiguous).accepted, false, title);
    assert.equal(scoreRetailCandidate(title, product), 0, title);
  }
  assert.equal(extractProductIdentity('Alesis Midiverb II/2 Effects Processor').model, 'Midiverb II');
});

test('structured named-family generation conflicts remain blocking evidence', () => {
  for (const model of ['Midiverb IV', 'Midiverb 4', 'Midiverb III', 'Midiverb 3', 'Midiverb II/IV']) {
    const product = extractProductIdentity(sourceTitle, `Model: ${model}`);
    assert.equal(product.model, null, model);
    for (const candidate of [sourceTitle, 'Alesis Midiverb IV Effects Processor', 'Alesis Midiverb 4 Effects Processor']) {
      const result = evaluateRetailCandidate(candidate, product);
      assert.equal(result.accepted, false, `${model}: ${candidate}`);
      assert.ok(result.rejectionReasons.includes('identity-conflict:alesis-midiverb-source'), model);
      assert.equal(scoreRetailCandidate(candidate, product), 0, model);
    }
  }
  for (const model of ['Midiverb II', 'Midiverb 2']) {
    assert.equal(extractProductIdentity(sourceTitle, `Model: ${model}`).model, 'Midiverb II', model);
  }
  assert.equal(extractProductIdentity('Alesis Effects Processor', 'Model: Midiverb IV').model, 'Midiverb IV');
  const competingFields = extractProductIdentity(sourceTitle, 'Model: Midiverb II\nModel: Midiverb IV');
  assert.equal(competingFields.model, null);
  assert.equal(evaluateRetailCandidate(sourceTitle, competingFields).accepted, false);
  assert.equal(extractProductIdentity(sourceTitle, 'Notes: replacement model: Midiverb IV').model, 'Midiverb II');
});

test('manuals and adapters are distinct primary subjects from complete Midiverb processors', () => {
  const processor = extractProductIdentity(sourceTitle);
  for (const title of [
    'Alesis Midiverb II manual',
    'Alesis Midiverb II instruction manual',
    'Alesis Midiverb II power adapter',
    'Alesis Midiverb II power supply',
    'Alesis Midiverb II PSU',
    'Alesis Midiverb II replacement power cord',
    'Alesis power adapter for Midiverb II',
  ]) {
    const accessory = extractProductIdentity(title);
    assert.equal(accessory.model, null, title);
    assert.equal(evaluateRetailCandidate(title, processor).accepted, false, title);
    assert.equal(evaluateRetailCandidate(sourceTitle, accessory).accepted, false, title);
    assert.equal(scoreRetailCandidate(title, processor), 0, title);
  }
  const manual = extractProductIdentity('Alesis Midiverb II manual');
  assert.equal(evaluateRetailCandidate('Alesis Midiverb II manual', manual).accepted, true);
  assert.equal(evaluateRetailCandidate('Alesis Midiverb II power adapter', manual).accepted, false);
});

test('whole native Sold units retain included or missing equipment and untested wording', () => {
  const product = extractProductIdentity(sourceTitle);
  for (const title of [
    'Vintage Rare Alesis Midiverb II 16-BIT Effects - NO Power Cord - Untested',
    'Alesis Midiverb II Vintage Multi- 16 bit digital Effects Processor not tested',
    'Alesis Midiverb II Effects Processor with power adapter',
    'Alesis Midiverb II Effects Processor without power supply',
    'Alesis Midiverb II Effects Processor no PSU',
    'Alesis Midiverb II Effects Processor missing power cord',
    'Alesis Midiverb II w/ adapter',
    'Alesis Midiverb II processor - power adapter not included',
    'Alesis Midiverb II - power supply included',
    'Alesis Midiverb II power cord not provided',
    'Alesis Midiverb II power cord excluded',
    'Alesis Midiverb II power cord missing',
  ]) {
    if (title.startsWith('Alesis')) assert.equal(extractProductIdentity(title).model, 'Midiverb II', title);
    assert.equal(isAccessoryListing(title, product), false, title);
    assert.equal(evaluateRetailCandidate(title, product).accepted, true, title);
    assert.ok(scoreRetailCandidate(title, product) > 0, title);
  }
});

for (const title of [
  'Alesis Midiverb II empty box',
  'Alesis Midiverb II box only',
  'Alesis Midiverb II for parts only',
  'Alesis Midiverb 2 packaging only',
]) {
  test(`hard exclusion takes precedence over the named model: ${title}`, () => {
    const product = extractProductIdentity(sourceTitle);
    for (const candidate of [title, `${title} with power adapter`, `${title} - NO Power Cord - Untested`]) {
      assert.equal(isAccessoryListing(candidate, product), true, candidate);
      const result = evaluateRetailCandidate(candidate, product);
      assert.equal(result.accepted, false, candidate);
      assert.ok(result.rejectionReasons.includes('accessory-or-component'), candidate);
      assert.equal(scoreRetailCandidate(candidate, product), 0, candidate);
    }
  });
}
