import test from 'node:test';
import assert from 'node:assert/strict';

import { extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';
import { buildEbaySoldQueryVariants } from '../src/intelligence/ebay-sold-results.js';

const artistTitle = (lifespan: string) => `Richard Bove (American, ${lifespan}) Original Modern Art Oil Painting, Spring Symphony #1`;

test('artist lifespan parentheses stay in source name but do not become identity models or eBay fallbacks', () => {
  for (const lifespan of ['1920-2020', '1920–2020', '1920 - 2020']) {
    const identity = extractProductIdentity(artistTitle(lifespan));
    const variants = buildEbaySoldQueryVariants(identity);

    assert.match(identity.name, /Richard Bove \(American, 1920\s*-\s*2020\) Original Modern Art Oil Painting, Spring Symphony #1/);
    assert.equal(identity.model, null);
    assert.match(identity.query, /richard bove original modern art oil painting spring symphony 1/i);
    assert.doesNotMatch(identity.query, /1920\s*[-\u2013\u2014]\s*2020/);
    assert.ok(!variants.some((query) => /richard\s+1920\s*[-\u2013\u2014]\s*2020/i.test(query)));
  }
});

test('explicit and non-biographical numeric identities remain models or query identifiers', () => {
  const structured = extractProductIdentity('Artist Painting 1920-2020', 'Brand: Acme\nModel: 1920-2020');
  assert.equal(structured.model, '1920-2020');

  const titled = extractProductIdentity('Acme Instrument Model 1920-2020');
  assert.equal(titled.model, '1920-2020');

  const receiver = extractProductIdentity('Onkyo TX-SR304 Multi-Channel AV Receiver');
  assert.equal(receiver.model, 'TX-SR304');

  const microphone = extractProductIdentity('RODE NT-USB+ USB Condenser Microphone');
  assert.equal(microphone.model, 'NT-USB+');

  const artwork = extractProductIdentity('Richard Bove Original Modern Art Oil Painting, Spring Symphony #1, 1986');
  assert.match(artwork.query, /spring symphony 1 1986/i);
});

test('generic and meaningful parenthesized year ranges remain part of identity', () => {
  for (const title of [
    'Widget (Model 1920-2020)',
    'Acme Instrument (1920-2020)',
    'Ford Truck Mirror (2010-2020)',
    'Survey of American Painting (1920-2020)',
    'European Sculpture (1920-2020) Hardcover Book',
    'French Impressionism (1860-1920) Art Book',
  ]) {
    const identity = extractProductIdentity(title);
    assert.match(identity.name, /\([^)]*\d{4}\s*-\s*\d{4}[^)]*\)/);
    assert.match(identity.query, /(?:1920\s*-\s*2020|2010\s*-\s*2020|1860\s*-\s*1920)/i);
  }
});

test('authoritative description model remains in the query after biography cleanup', () => {
  const identity = extractProductIdentity(
    'Richard Bove (American, 1920-2020) Oil Painting',
    'Brand: Acme\nModel: 1920-2020',
  );
  assert.equal(identity.model, '1920-2020');
  assert.match(identity.query, /richard bove oil painting 1920-2020/i);
});
