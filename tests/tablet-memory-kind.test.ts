import assert from 'node:assert/strict';
import test from 'node:test';
import {
  detectProductKind,
  evaluateRetailCandidate,
  extractProductIdentity,
} from '../src/intelligence/us-deal-intelligence.js';

test('built-in tablet memory and storage specs keep the whole product classified as a tablet', () => {
  for (const title of [
    'Apple iPad Pro M1 Chip 8GB RAM 128GB',
    'Q Link Wireless Scepter 8 Tablet 1GB RAM 16GB ROM 8" IPS New Factory Sealed',
    '1GB RAM 16GB ROM 8 Tablet',
    'BMAX B7 Tablet 10.1 4GB RAM 64GB Storage',
    'BMAX B7 4GB RAM DDR4 64GB Storage Tablet',
    'BMAX B7 Tablet 4GB RAM with Accessories',
    'BMAX B7 Tablet 4GB RAM with spare charger',
    'BMAX B7 Tablet for Kids 4GB RAM',
    'BMAX B7 Tablet with 4GB RAM',
  ]) assert.equal(detectProductKind(title), 'tablet', title);
});

test('replacement processor chips remain component negatives', () => {
  const tablet = extractProductIdentity('BMAX B7 Tablet 10.1 4GB RAM 64GB Storage');
  const replacement = evaluateRetailCandidate('BMAX B7 Tablet Chip Only 4GB RAM 64GB Storage', tablet);
  assert.equal(replacement.accepted, false, JSON.stringify(replacement));
  assert.ok(replacement.rejectionReasons.some((reason) => reason === 'kind-mismatch:tablet:memory' || reason === 'accessory-or-component'), JSON.stringify(replacement));
});

test('generic tablet chip mentions remain component negatives even before memory specs', () => {
  const tablet = extractProductIdentity('Microsoft Surface Tablet 8GB RAM DDR4');
  const candidate = evaluateRetailCandidate('Microsoft Surface Tablet DDR4 Chip 8GB RAM', tablet);
  assert.equal(candidate.accepted, false, JSON.stringify(candidate));
  assert.ok(candidate.rejectionReasons.some((reason) => reason === 'kind-mismatch:tablet:memory' || reason === 'accessory-or-component'), JSON.stringify(candidate));
});

test('built-in processor wording does not block a complete tablet match', () => {
  const tablet = extractProductIdentity('BMAX B7 Tablet 10.1 4GB RAM 64GB Storage');
  const complete = evaluateRetailCandidate('BMAX B7 Tablet 10.1 4GB RAM 64GB Storage', tablet);
  assert.equal(complete.accepted, true, JSON.stringify(complete));
  const withSpare = evaluateRetailCandidate('BMAX B7 Tablet 10.1 4GB RAM 64GB Storage with spare processor', tablet);
  assert.equal(withSpare.accepted, true, JSON.stringify(withSpare));
});

test('a complete tablet may include a replacement processor without becoming a component listing', () => {
  const title = 'BMAX B7 Tablet 10.1 4GB RAM 64GB Storage';
  const tablet = extractProductIdentity(title);
  for (const included of ['with replacement processor', 'with the replacement processor', 'includes replacement processor', 'without replacement processor', 'without replacement processor only']) {
    const candidate = evaluateRetailCandidate(`${title} ${included}`, tablet);
    assert.equal(candidate.accepted, true, `${included}: ${JSON.stringify(candidate)}`);
  }
  const component = evaluateRetailCandidate('BMAX B7 Tablet 10.1 Replacement Processor 4GB RAM 64GB Storage', tablet);
  assert.equal(component.accepted, false);
  assert.ok(component.rejectionReasons.includes('accessory-or-component'));
});

test('raw processor-only subjects cannot use exact model matches to bypass component rejection', () => {
  const surface = extractProductIdentity('Microsoft Surface Tablet 8GB RAM DDR4');
  const integratedOnly = evaluateRetailCandidate('Microsoft Surface Tablet Integrated Processor Only 8GB RAM DDR4', surface);
  assert.equal(integratedOnly.accepted, false, JSON.stringify(integratedOnly));
  assert.ok(integratedOnly.rejectionReasons.includes('accessory-or-component'), JSON.stringify(integratedOnly));

  const bmax = extractProductIdentity('BMAX B7 Tablet 10.1 4GB RAM 64GB Storage');
  const replacement = evaluateRetailCandidate('BMAX B7 Tablet 10.1 Replacement Processor 4GB RAM 64GB Storage', bmax);
  assert.equal(replacement.accepted, false, JSON.stringify(replacement));
  assert.ok(replacement.rejectionReasons.includes('accessory-or-component'), JSON.stringify(replacement));
});

test('memory inclusion does not turn a following processor-only subject into a complete tablet', () => {
  const tablet = extractProductIdentity('BMAX B7 Tablet 10.1 4GB RAM 64GB Storage');
  for (const title of [
    'BMAX B7 Tablet 10.1 with 4GB RAM 64GB Storage Processor Only',
    'BMAX B7 Tablet 10.1 includes 4GB RAM Replacement Processor',
    'BMAX B7 Tablet 10.1 with 4GB RAM 64GB Storage Processor Only included',
    'BMAX B7 Tablet 10.1 4GB RAM 64GB Storage with Replacement Processor Only',
    'BMAX B7 Tablet 10.1 4GB RAM 64GB Storage includes Standalone Processor Only',
    'BMAX B7 Tablet 10.1 4GB RAM 64GB Storage with only standalone processor included',
    'BMAX B7 Tablet 10.1 4GB RAM 64GB Storage with only spare processor',
  ]) {
    const candidate = evaluateRetailCandidate(title, tablet);
    assert.equal(candidate.accepted, false, `${title}: ${JSON.stringify(candidate)}`);
    assert.ok(candidate.rejectionReasons.includes('accessory-or-component'));
  }
});

test('stylus and standalone tablet memory components keep their existing kinds', () => {
  assert.equal(detectProductKind('Apple Pencil Stylus for iPad'), 'stylus');
  assert.equal(detectProductKind('RAM Module for Tablet'), 'memory');
  assert.equal(detectProductKind('Replacement Memory Module for Tablet'), 'memory');
  assert.equal(detectProductKind('128GB SSD for Microsoft Surface Tablet'), 'storage');
  assert.equal(detectProductKind('8GB RAM DDR4 SODIMM for Microsoft Surface Tablet'), 'memory');
});

test('matching brand and capacity cannot promote a compatible storage or memory component to a tablet', () => {
  for (const [sourceTitle, title, kind] of [
    ['Microsoft Surface Tablet 128GB SSD', '128GB SSD for Microsoft Surface Tablet', 'storage'],
    ['Microsoft Surface Tablet 8GB RAM DDR4', '8GB RAM DDR4 SODIMM for Microsoft Surface Tablet', 'memory'],
    ['Microsoft Surface Tablet 8GB RAM DDR4', '8GB RAM DDR4 SODIMM compatible with Microsoft Surface Tablet', 'memory'],
    ['Microsoft Surface Tablet 8GB RAM DDR4', '8GB RAM DDR4 SODIMM designed for Microsoft Surface Tablet', 'memory'],
    ['Microsoft Surface Tablet 8GB RAM DDR4', '8GB RAM DDR4 SODIMM replacement for Microsoft Surface Tablet', 'memory'],
    ['Microsoft Surface Tablet 8GB RAM DDR4', '8GB RAM DDR4 SODIMM for use with Microsoft Surface Tablet', 'memory'],
    ['Microsoft Surface Tablet 8GB RAM DDR4', '8GB RAM DDR4 SODIMM fits Microsoft Surface Tablet', 'memory'],
    ['Microsoft Surface Tablet 8GB RAM DDR4', '8GB RAM DDR4 SODIMM suitable for Microsoft Surface Tablet', 'memory'],
    ['Microsoft Surface Tablet 8GB RAM DDR4', '8GB RAM DDR4 SODIMM upgrade for Microsoft Surface Tablet', 'memory'],
    ['Microsoft Surface Tablet 8GB RAM DDR4', 'RAM for Microsoft Surface Tablet 8GB RAM DDR4', 'memory'],
    ['Microsoft Surface Tablet 8GB RAM DDR4', 'Microsoft Surface Tablet 8GB RAM DDR4 SODIMM', 'memory'],
    ['Microsoft Surface Tablet 8GB RAM DDR4', 'Microsoft Surface Tablet 8GB RAM DDR4 Chip', 'memory'],
    ['Microsoft Surface Tablet 8GB RAM DDR4', 'Microsoft Surface Tablet 8GB RAM DDR4 Memory Card Accessory', 'memory'],
  ] as const) {
    const tablet = extractProductIdentity(sourceTitle);
    assert.equal(tablet.kind, 'tablet', sourceTitle);
    assert.equal(detectProductKind(title), kind, title);
    const result = evaluateRetailCandidate(title, tablet);
    assert.equal(result.accepted, false, `${title}: ${JSON.stringify(result)}`);
    assert.ok(result.rejectionReasons.includes(`kind-mismatch:tablet:${kind}`), JSON.stringify(result));
  }
});

test('tablet memory cards and accessories remain rejected against a complete tablet', () => {
  const tablet = extractProductIdentity('BMAX B7 Tablet 10.1 4GB RAM 64GB Storage');
  for (const title of [
    'BMAX B7 Tablet Memory Card Accessory',
    'BMAX B7 Tablet RAM Module for Tablet',
  ]) {
    const result = evaluateRetailCandidate(title, tablet);
    assert.equal(result.accepted, false, `${title}: ${JSON.stringify(result)}`);
  }
});

test('tablet model and variant mismatches remain hard rejections', () => {
  const tablet = extractProductIdentity('BMAX B7 Tablet 10.1 4GB RAM 64GB Storage');
  const wrongModel = evaluateRetailCandidate('BMAX B8 Tablet 10.1 4GB RAM 64GB Storage', tablet);
  assert.equal(wrongModel.accepted, false);
  assert.ok(wrongModel.rejectionReasons.some((reason) => reason.startsWith('model-mismatch:')));
  const wrongVariant = evaluateRetailCandidate('BMAX B7 Tablet 10.1 4GB RAM 128GB Storage', tablet);
  assert.equal(wrongVariant.accepted, false);
  assert.ok(wrongVariant.rejectionReasons.some((reason) => reason.startsWith('attribute-')));

});

test('actual Q Link sold item 227478944890 matches the source tablet', () => {
  const source = extractProductIdentity('Q Link Wireless Scepter 8 Tablet NWT');
  const actualSold = evaluateRetailCandidate(
    'Q Link Wireless Scepter 8 Tablet 1GB RAM 16GB ROM 8" IPS New Factory Sealed',
    source,
  );
  assert.doesNotMatch(actualSold.rejectionReasons.join(','), /kind-mismatch:tablet:memory/);
  assert.equal(actualSold.accepted, true, JSON.stringify(actualSold));
});
