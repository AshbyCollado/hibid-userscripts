import assert from 'node:assert/strict';
import test from 'node:test';
import { validateRetailIdentity } from '../src/background/retail-identity.js';
import {
  evaluateRetailCandidate,
  extractProductDiscriminators,
  extractProductIdentity,
  type ProductIdentity,
} from '../src/intelligence/us-deal-intelligence.js';
import {
  verifyEbaySoldCompSet,
  type EbaySoldRecord,
} from '../src/intelligence/ebay-sold-results.js';

const sourceTitle = 'Vntg Sterling Silver Girl Scout Ring Size 5';

test('ring-size formats compare as equivalent without accepting fractional size as whole size', () => {
  const formats = [
    { size: '5', titles: ['5', '5.0'] },
    { size: '5.25', titles: ['5 1/4', '5-1/4', '5¼', '5.25'] },
    { size: '5.5', titles: ['5 1/2', '5-1/2', '5½', '5.5'] },
    { size: '5.75', titles: ['5 3/4', '5-3/4', '5¾', '5.75'] },
    { size: '6', titles: ['6'] },
  ].flatMap((group) => group.titles.map((title) => ({ title, size: group.size })));
  for (const { title: sourceFormat, size } of formats) {
    const source = extractProductIdentity(`Vntg Sterling Silver Girl Scout Ring Size ${sourceFormat}`);
    assert.deepEqual(source.discriminators.ringSizes, [size], sourceFormat);
    for (const { title: candidateFormat, size: candidateSize } of formats) {
      const result = evaluateRetailCandidate(`Sterling Silver Girl Scout Ring Size ${candidateFormat}`, source);
      assert.equal(result.accepted, size === candidateSize, `${sourceFormat} vs ${candidateFormat}: ${JSON.stringify(result)}`);
    }
  }
});

test('cached identities recover their title size before comparing fractional candidates', () => {
  for (const format of ['5', '5 1/2', '5½']) {
    const identity = extractProductIdentity(`Vntg Sterling Silver Girl Scout Ring Size ${format}`);
    delete identity.discriminators.ringSizes;
    const result = evaluateRetailCandidate('Vintage Sterling Silver Girl Scout Ring Size 5.75', identity);
    assert.equal(result.accepted, false, format);
    assert.match(result.rejectionReasons.join(','), /attribute-conflict:ringSizes:/);
    assert.equal(evaluateRetailCandidate(`Sterling Silver Girl Scout Ring Size ${format === '5' ? '5.0' : '5.5'}`, identity).accepted, true);
    assert.equal(identity.discriminators.ringSizes, undefined);
  }
});

test('malformed fractions, decimal continuations, alternatives and ranges retain uncertainty', () => {
  const source = extractProductIdentity(sourceTitle);
  for (const expression of [
    '5 1/3', '5 2/3', '5 1/0', '5-1/3', '5 1/2/3', '5.5.5', '5.5/foo', '5 6',
    '5 and 6', '5,6', '5, 6', '5,6 Sterling Silver', '5 or 6', '5/6', '5 & 6',
    '5-6', '5 to 6', '5½-6', '5.5 through 6', '5 Size 6', '5 (or 6)', '5 plus 6', '5 [6]', 'unknown',
  ]) {
    const title = `Vintage Sterling Silver Girl Scout Ring Size ${expression}`;
    assert.deepEqual(extractProductIdentity(title).discriminators.ringSizes, [], expression);
    const candidate = evaluateRetailCandidate(title, source);
    assert.equal(candidate.accepted, false, `${expression}: ${JSON.stringify(candidate)}`);
    assert.match(candidate.rejectionReasons.join(','), /ringSizes:candidate-uncertain/, expression);
    const reversed = evaluateRetailCandidate(sourceTitle, extractProductIdentity(title));
    assert.equal(reversed.accepted, false, expression);
    assert.match(reversed.rejectionReasons.join(','), /ringSizes:source-uncertain/, expression);
  }
  assert.equal(extractProductIdentity('Vntg Sterling Silver Girl Scout Ring').discriminators.ringSizes, undefined);
  assert.equal(evaluateRetailCandidate('Vintage Sterling Silver Girl Scout Ring', source).accepted, true);
});

test('explicit ring-size description survives extraction and the retail boundary', () => {
  for (const description of ['Ring Size 5', 'Ring Size: 5', 'Size: 5', 'Ring Size 5.0', 'This ring is size 5.', 'The ring measures size 5.']) {
    const identity = extractProductIdentity({ title: 'Vntg Sterling Silver Girl Scout Ring', description });
    assert.deepEqual(identity.discriminators.ringSizes, ['5'], description);
    assert.equal(identity.query, 'vntg sterling silver girl scout ring');
    const transported = validateRetailIdentity(JSON.parse(JSON.stringify({ ...identity, authorization: 'private', cookie: 'private' })));
    assert.deepEqual(transported.discriminators.ringSizes, ['5'], description);
    assert.equal(evaluateRetailCandidate('Vintage Sterling Silver Girl Scout Ring Size 6', transported).accepted, false);
    assert.equal(evaluateRetailCandidate('Vintage Sterling Silver Girl Scout Ring Size 5', transported).accepted, true);
    assert.doesNotMatch(JSON.stringify(transported), /private|authorization|cookie/);
  }
  for (const description of ['Ring Size 5-6', 'Ring Size 5 1/0']) {
    const transported = validateRetailIdentity(extractProductIdentity({ title: 'Vntg Sterling Silver Girl Scout Ring', description }));
    assert.deepEqual(transported.discriminators.ringSizes, []);
    assert.equal(evaluateRetailCandidate(sourceTitle, transported).accepted, false, description);
  }
  const conflict = validateRetailIdentity(extractProductIdentity({ title: sourceTitle, description: 'Ring Size 6' }));
  assert.deepEqual(conflict.discriminators.ringSizes, []);
  assert.equal(evaluateRetailCandidate(sourceTitle, conflict).accepted, false);
});

test('ring boundary validates supplied arrays and cannot erase title uncertainty', () => {
  const identity = extractProductIdentity(sourceTitle);
  for (const ringSizes of ['5', [null], Array(65).fill('5'), ['x'.repeat(121)]]) {
    assert.throws(() => validateRetailIdentity({ ...identity, discriminators: { ringSizes } }), /Malformed retail identity/);
  }
  const stale = { ...identity, discriminators: { ...identity.discriminators } };
  delete stale.discriminators.ringSizes;
  assert.deepEqual(validateRetailIdentity(stale).discriminators.ringSizes, ['5']);
  const ambiguous = extractProductIdentity('Vntg Sterling Silver Girl Scout Ring Size 5-6');
  const transported = validateRetailIdentity({ ...ambiguous, discriminators: { ringSizes: ['5'] } });
  assert.deepEqual(transported.discriminators.ringSizes, []);
  assert.equal(evaluateRetailCandidate(sourceTitle, transported).accepted, false);
});

test('nonjewelry products, package measurements and unrelated description sizes do not become ring sizes', () => {
  for (const title of [
    'Piston Rings Size 5', 'Ring Camera Size 5', 'Ring Doorbell Size 5',
    'Ring Light Size 5', 'Binder Rings Size 5', 'O-Ring Size 5',
    'Key Ring Size 5', 'Napkin Rings Size 5', 'Shower Curtain Rings Size 5',
    'Vintage Sterling Guitar with Ring Size 5', 'Silver Necklace with Ring Size 5',
    'Vntg Sterling Silver Girl Scout Ring Box Size 5',
  ]) {
    assert.equal(extractProductIdentity(title).discriminators.ringSizes, undefined, title);
    const transported = validateRetailIdentity(extractProductIdentity(title));
    assert.equal(transported.discriminators.ringSizes, undefined, title);
    assert.doesNotMatch(evaluateRetailCandidate(title, transported).rejectionReasons.join(','), /ringSizes:/, title);
  }
  for (const description of ['Box Size 5', 'Package Size 5', 'Necklace Size 5', 'Camera Size 5', 'Quantity: 5', 'Capacity: 5L']) {
    assert.equal(extractProductIdentity({ title: 'Vntg Sterling Silver Girl Scout Ring', description }).discriminators.ringSizes, undefined, description);
  }
  assert.equal(extractProductIdentity({ title: 'Piston Rings', description: 'Ring Size 5' }).discriminators.ringSizes, undefined);
  for (const title of ['Piston Rings Size 5', 'Ring Camera Size 5', 'Key Ring Size 5', 'Napkin Rings Size 5', 'Shower Curtain Rings Size 5']) {
    const mismatch = evaluateRetailCandidate(title.replace('5', '6'), extractProductIdentity(title));
    assert.equal(mismatch.accepted, false, title);
    assert.match(mismatch.rejectionReasons.join(','), /attribute-conflict:variantLabels:5/, title);
  }
});

test('numeric style labels remain required alongside canonical ring size', () => {
  const identity = extractProductIdentity('Vntg Sterling Silver Girl Scout Ring Style 8 Size 5 1/2');
  assert.equal(evaluateRetailCandidate('Vintage Sterling Silver Girl Scout Ring Style 9 Size 5.5', identity).accepted, false);
  assert.equal(evaluateRetailCandidate('Vintage Sterling Silver Girl Scout Ring Style 8 Size 5.5', identity).accepted, true);
  const collision = extractProductIdentity('Vntg Sterling Silver Girl Scout Ring Style 5 Size 5 1/2');
  assert.equal(evaluateRetailCandidate('Vintage Sterling Silver Girl Scout Ring Style 6 Size 5.5', collision).accepted, false);
  assert.equal(evaluateRetailCandidate('Vintage Sterling Silver Girl Scout Ring Style 5 Size 5.5', collision).accepted, true);
  const cached = extractProductIdentity('Vntg Sterling Silver Girl Scout Ring');
  cached.discriminators.variantLabels = ['5'];
  const withoutReplacement = evaluateRetailCandidate('Vintage Sterling Silver Girl Scout Ring Size 6', cached);
  assert.equal(withoutReplacement.accepted, false);
  assert.match(withoutReplacement.rejectionReasons.join(','), /attribute-conflict:variantLabels:5/);
});

test('ring size stays contextual and does not borrow ordinary numeric title values', () => {
  const identity = extractProductIdentity(sourceTitle);
  assert.equal(evaluateRetailCandidate('Sterling Silver Girl Scout Ring Size 5 1/2, 2g', identity).accepted, false);
  assert.equal(evaluateRetailCandidate('Vintage Sterling Silver Girl Scout Ring Size 5 1/2', identity).accepted, false);
  assert.equal(evaluateRetailCandidate('Sterling Silver Girl Scout Ring Approx Size 5.0', identity).accepted, true);
  assert.equal(evaluateRetailCandidate('Vintage Sterling Silver Girl Scout Ring Size Approx. 5.0, 2g', identity).accepted, true);
  assert.equal(evaluateRetailCandidate('VTG Sterling Silver - 1940\'s Girl Scouts "GS" Trefoil Signet Ring Size 5 - 1.5g', identity).accepted, true);
  assert.equal(evaluateRetailCandidate('Vintage Sterling Silver Girl Scout Ring Size 5 - 1.5g or 6', identity).accepted, false);
  assert.equal(evaluateRetailCandidate('Vintage Sterling Silver Girl Scout Ring Size 5 - 6', identity).accepted, false);
  assert.equal(extractProductIdentity('Vntg Sterling Silver Girl Scout Ring 5g 6 Pack').discriminators.ringSizes, undefined);
  assert.deepEqual(extractProductDiscriminators('Sterling Silver Necklace Size 5').ringSizes ?? [], []);
  assert.deepEqual(extractProductDiscriminators('Ring Light 5 inch').ringSizes ?? [], []);
  assert.deepEqual(extractProductDiscriminators('Sterling Silver Girl Scout Ring Size 5-6').ringSizes ?? [], []);
  assert.deepEqual(extractProductDiscriminators('Sterling Silver Girl Scout Ring Size 5 or 6').ringSizes ?? [], []);
  assert.equal(evaluateRetailCandidate('Sterling Silver Girl Scout Ring', identity).accepted, true);
});

function soldRecord(itemId: string, title: string): EbaySoldRecord {
  return {
    source: 'seller-hub-product-research',
    sourceUrl: 'https://www.ebay.com/sh/research?keywords=ring&tabName=SOLD',
    observedAt: '2026-10-03T12:00:00.000Z',
    itemId,
    itemUrl: `https://www.ebay.com/itm/${itemId}`,
    title,
    imageUrl: null,
    soldPrice: { amount: 9.99, currency: 'USD' },
    shippingPrice: { amount: 0, currency: 'USD' },
    deliveredPrice: { amount: 9.99, currency: 'USD' },
    totalSold: 1,
    totalSales: { amount: 9.99, currency: 'USD' },
    soldAt: 'Oct 2, 2026',
    condition: 'Used',
    format: 'Fixed price',
    priceKind: 'actual',
    provenance: { kind: 'independent-sold-evidence', source: 'seller-hub-sold-record', itemId },
  };
}

function verifyTitles(identity: ProductIdentity, titles: string[]) {
  const query = identity.query;
  const attempt = {
    source: 'seller-hub-product-research' as const,
    sourceUrl: `https://www.ebay.com/sh/research?keywords=${encodeURIComponent(query)}&tabName=SOLD`,
    query,
    observedAt: '2026-10-03T12:00:00.000Z',
    status: 'ok' as const,
    records: titles.map((title, index) => soldRecord(String(123456789 + index), title)),
    hasNextPage: false,
    pageOffset: 0,
    pageLimit: 50,
    failureReason: null,
  };
  return verifyEbaySoldCompSet(identity, [attempt], { plannedQueries: [query], minimumSampleSize: 1 });
}

test('eBay sold verification applies the same ring-size discriminator to real title fixtures and cached identities', () => {
  for (const cached of [false, true]) {
    const identity = extractProductIdentity(sourceTitle);
    if (cached) delete identity.discriminators.ringSizes;
    const result = verifyTitles(identity, [
      'STERLING SILVER VINTAGE GIRL SCOUT RING Approx Size 5.0, 2g',
      'Vintage Sterling Silver Girl Scout Ring Size 5 1/2',
      'STERLING SILVER VINTAGE GIRL SCOUT RING Approx Size 5 1/2, 2g',
    ]);
    assert.deepEqual(result.accepted.map((record) => record.itemId), ['123456789']);
    assert.equal(result.rejected.length, 2);
    for (const record of result.rejected) assert.match(record.reasons.join(','), /attribute-conflict:ringSizes:5/);
  }
});

test('sold verifier accepts equivalent formats in both directions and rejects unresolved sizes', () => {
  for (const sourceSize of ['5 1/2', '5-1/2', '5½', '5.5', '5 3/4', '5-3/4', '5¾', '5.75']) {
    const identity = extractProductIdentity(`Vntg Sterling Silver Girl Scout Ring Size ${sourceSize}`);
    const candidates = sourceSize.includes('3/4') || sourceSize.includes('¾') || sourceSize === '5.75'
      ? ['5 3/4', '5-3/4', '5¾', '5.75'] : ['5 1/2', '5-1/2', '5½', '5.5'];
    const result = verifyTitles(identity, candidates.map((size) => `Vintage Sterling Silver Girl Scout Ring Size ${size}`));
    assert.equal(result.accepted.length, 4, `${sourceSize}: ${JSON.stringify(result.rejected)}`);
  }
  const described = validateRetailIdentity(extractProductIdentity({ title: 'Vntg Sterling Silver Girl Scout Ring', description: 'Ring Size 5' }));
  const result = verifyTitles(described, ['5', '6', '5 1/3', '5 and 6', '5,6', '5.5.5', '5-6'].map((size) => `Vintage Sterling Silver Girl Scout Ring Size ${size}`));
  assert.deepEqual(result.accepted.map((record) => record.itemId), ['123456789']);
  assert.equal(result.rejected.length, 6);
  for (const record of result.rejected) assert.match(record.reasons.join(','), /attribute-conflict:ringSizes:/);
});
