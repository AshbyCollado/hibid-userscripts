import assert from 'node:assert/strict';
import test from 'node:test';

import { buildEbaySoldQueryVariants } from '../src/intelligence/ebay-sold-results.js';
import { extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';

function variants(title: string) {
  return buildEbaySoldQueryVariants(extractProductIdentity(title, 'NikonSLR+Rolev52mmHaze'));
}

test('lens aperture f2 is a discriminator, not a Nikon camera model', () => {
  const identity = extractProductIdentity('Nikon Nikkor H Auto 50mm f2 Lens', 'NikonSLR+Rolev52mmHaze');

  assert.equal(identity.model, null);
  assert.equal(identity.model2, null);
  const soldQueries = variants('Nikon Nikkor H Auto 50mm f2 Lens');
  assert.equal(soldQueries[0], 'nikon nikkor h auto 50mm f2 lens');
  assert.ok(soldQueries.every((query) => !/^nikon f2$|^f2$/i.test(query)));
});

test('camera bodies retain F2 identity even beside an included lens', () => {
  for (const title of [
    'Nikon F2 Camera',
    'Nikon 35mm F2 Camera',
    'Nikon F2 with 50mm lens',
    'Nikon F2 Camera plus 50mm lens',
    'Nikon F2 Camera including 50mm lens',
    'Nikon F2 Camera and 50mm lens',
    'Nikon F2 Camera with Nikkor 50mm f2.8 lens',
    'Nikon F2 single lens reflex camera',
    'Nikon F2 Single-Lens Reflex Camera',
    'Nikon F2 Camera, Nikkor 50mm f2.8 lens',
    'Nikon F2 Camera / Nikkor 50mm f2.8 lens',
    'Nikon F2 Camera / Nikkor 50mm f/2 lens',
  ]) {
    const identity = extractProductIdentity(title);
    assert.equal(identity.model, 'F2', title);
    assert.equal(identity.model2, null, title);
    assert.ok(variants(title).includes('Nikon F2'), title);
  }
  assert.equal(extractProductIdentity('Nikon 35mm F3 Camera plus 50mm lens').model, 'F3');
});

test('lens aperture spellings do not become standalone models', () => {
  for (const [title, query] of [
    ['Nikon f2 lens', 'nikon f2 lens'],
    ['Nikon 50mm f/2 lens', 'nikon 50mm f/2 lens'],
    ['Nikon f/1.8 lens', 'nikon f/1.8 lens'],
    ['Nikon 50mm f2.8 lens', 'nikon 50mm f2.8 lens'],
    ['Nikon 50mm 1:2 lens', 'nikon 50mm 1 2 lens'],
    ['Nikon Nikkor f2 50mm manual focus prime lens', 'nikon nikkor f2 50mm manual focus prime lens'],
    ['Nikon Nikkor 50mm f2 manual focus prime lens', 'nikon nikkor 50mm f2 manual focus prime lens'],
    ['Nikon Nikkor f2 50mm', 'nikon nikkor f2 50mm'],
    ['Nikon Nikkor 50mm f2', 'nikon nikkor 50mm f2'],
  ]) {
    const identity = extractProductIdentity(title);
    assert.equal(identity.model, null, title);
    assert.equal(identity.model2, null, title);
    assert.equal(identity.name, title);
    const soldQueries = variants(title!);
    assert.equal(soldQueries[0], query, title);
    assert.ok(soldQueries.every((soldQuery) => !/^(?:nikon\s+)?f\/?\d+(?:\.\d+)?$/i.test(soldQuery)), title);
  }
});

test('lens apertures do not become secondary models beside an AF-S identity', () => {
  for (const [title, query] of [
    ['Nikon AF-S f2.8 50mm', 'nikon af-s f2.8 50mm'],
    ['Nikon AF-S 50mm f2.8', 'nikon af-s 50mm f2.8'],
  ]) {
    const identity = extractProductIdentity(title);
    assert.equal(identity.model, 'AF-S', title);
    assert.equal(identity.model2, null, title);
    assert.deepEqual(variants(title!), [query, 'Nikon AF-S']);
    assert.deepEqual(buildEbaySoldQueryVariants(identity, 3, 'legacy-v1'), [query, 'Nikon AF-S', 'AF-S']);
  }
});

test('prose recovery scores aperture tokens against the owning lens assertion', () => {
  for (const description of [
    'Nikon Nikkor 50mm lens f2',
    'Nikon Nikkor 50mm lens f2.',
    'Nikon Nikkor 50mm lens f2.8.',
  ]) {
    const identity = extractProductIdentity('Nikon Nikkor 50mm lens', description);
    assert.equal(identity.model, null, description);
    assert.equal(identity.model2, null, description);
    const soldQueries = buildEbaySoldQueryVariants(identity);
    assert.equal(soldQueries[0], 'nikon nikkor 50mm lens', description);
    assert.ok(soldQueries.every((query) => !/^(?:nikon\s+)?f\/?\d+(?:\.\d+)?$/i.test(query)), description);
  }

  const camera = extractProductIdentity('Nikon 35mm Camera', 'Nikon 35mm Camera F2 plus 50mm lens');
  assert.equal(camera.model, 'F2');
  assert.ok(buildEbaySoldQueryVariants(camera).includes('Nikon F2'));
});

test('compact Sony lens model remains an actual model identity', () => {
  const identity = extractProductIdentity('Sony FE16-35F2.8GM Lens');

  assert.equal(identity.model, 'FE16-35F2.8GM');
  assert.deepEqual(variants('Sony FE16-35F2.8GM Lens'), [
    'sony fe16-35f2.8gm lens',
    'Sony FE16-35F2.8GM',
    'FE16-35F2.8GM',
  ]);
});

test('established lens model patterns remain in the full query', () => {
  const afs = extractProductIdentity('Nikon AF-S 50mm lens');
  assert.equal(afs.model, 'AF-S');
  assert.ok(variants('Nikon AF-S 50mm lens').includes('Nikon AF-S'));

  for (const title of ['Sigma DG 50mm lens', 'Nikon Nikkor H Auto 50mm lens']) {
    const identity = extractProductIdentity(title);
    assert.equal(identity.model, null);
    assert.ok(identity.query.toLowerCase().includes(title.toLowerCase().split(' lens')[0]));
  }
});
