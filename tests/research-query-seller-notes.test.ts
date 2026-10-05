import assert from 'node:assert/strict';
import test from 'node:test';
import { buildProductResearchQuery, evaluateRetailCandidate, extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';
import { buildEbaySoldQueryVariants } from '../src/intelligence/ebay-sold-results.js';

test('hard-clipped HiBid leads recover the complete product from the matching description', () => {
  const mower = extractProductIdentity(
    'Troy-Bilt 21" Self-Propelled Push Mower - Owner St',
    'Troy-Bilt 21" Self-Propelled Push Mower - Owner Stated the Self-Propelled Function Does NOT Work Correctly, but the Mower Still Runs & Mows',
  );
  assert.match(mower.query, /troy-bilt 21 self-propelled push mower/i);
  assert.doesNotMatch(mower.query, /owner|stated|function|work|mows/i);
  assert.ok(buildEbaySoldQueryVariants(mower, 2).every((query) => !/owner|stated|function|mows/i.test(query)));

  const washer = extractProductIdentity(
    'Briggs & Stratton 2500 PSI Gas Powered Pressure Wa',
    'Briggs & Stratton 2500 PSI Gas Powered Pressure Washer',
  );
  assert.match(washer.query, /pressure washer/i);
  assert.doesNotMatch(washer.query, /pressure wa$/i);

  const compressor = extractProductIdentity(
    'Craftsman 6 Gallon Air Compressor w/ Hose & Hose R',
    'Craftsman 6 Gallon Air Compressor w/ Hose & Hose Reel',
  );
  assert.match(compressor.query, /hose reel/i);
  assert.doesNotMatch(compressor.query, /hose r$/i);
  const unrelatedCompatibility = extractProductIdentity(
    'Craftsman 6 Gallon Air Compressor w/ Hose & Hose R',
    'Product Name: Craftsman 6 Gallon Air Compressor w/ Hose & Hose Reel; compatible with DeWalt DXCM models',
  );
  assert.match(unrelatedCompatibility.query, /hose reel/i);
  assert.doesNotMatch(unrelatedCompatibility.query, /dewalt|dxcm|compatible/i);

  const chisels = extractProductIdentity(
    'Marples Wood Chisel Set - Made in Sheffield, Engla',
    'Marples Wood Chisel Set - Made in Sheffield, England',
  );
  assert.match(chisels.query, /sheffield england/i);
  assert.doesNotMatch(chisels.query, /engla$/i);
});

test('only an exactly 50-character clipped lead recovers the immediate final word', () => {
  const complete = 'Craftsman 6 Gallon Air Compressor w/ Hose & Hose Reel';
  const description = `Product Name: ${complete}; compatible with DeWalt DXCM models`;
  const lead49 = complete.slice(0, 49);
  const lead50 = complete.slice(0, 50);
  const lead51 = complete.slice(0, 51);

  assert.equal(lead49.length, 49);
  assert.equal(lead50.length, 50);
  assert.equal(lead51.length, 51);
  assert.doesNotMatch(extractProductIdentity(lead49, description).query, /dewalt|dxcm|compatible/i);
  assert.match(extractProductIdentity(lead50, description).query, /hose reel/i);
  assert.doesNotMatch(extractProductIdentity(lead49, description).query, /hose reel/i);
  assert.doesNotMatch(extractProductIdentity(lead51, description).query, /hose reel/i);
  assert.doesNotMatch(extractProductIdentity(lead51, description).query, /dewalt|dxcm|compatible/i);
  assert.doesNotMatch(extractProductIdentity(lead50, description).query, /dewalt|dxcm|compatible/i);
  const trailingProductProse = `Product Name: ${complete} with carrying case`;
  assert.match(extractProductIdentity(lead50, trailingProductProse).query, /hose reel/i);
  assert.doesNotMatch(extractProductIdentity(lead50, trailingProductProse).query, /carrying case/i);
});

test('seller condition notes do not become Amazon or eBay search identity', () => {
  const tiller = extractProductIdentity(
    'Troy-Bilt Tuffy Rear-Tine Rototiller - Relatively',
    'Troy-Bilt Tuffy Rear-Tine Rototiller - Relatively New',
  );
  assert.match(tiller.query, /troy-bilt tuffy rear-tine rototiller/i);
  assert.doesNotMatch(tiller.query, /relatively|new/i);
  assert.equal(buildProductResearchQuery('Generac LP5500 Generator w/ Tank - LIKE NEW'),
    'generac lp5500 generator with tank');
});

test('real hyphenated product specifications remain in the query', () => {
  assert.match(buildProductResearchQuery('STIHL MS 250 Chainsaw - 18-inch bar'), /18-inch bar/i);
  assert.match(buildProductResearchQuery('Echo PB-2520 Gas Powered Blower'), /pb-2520/i);
});

test('condition notes do not erase a following capacity discriminator', () => {
  const product = extractProductIdentity('Apple iPad A2602 - Seller stated Like New, 256GB Wi-Fi');
  assert.match(product.query, /256gb/i);
  assert.doesNotMatch(product.query, /like new/i);
  assert.equal(evaluateRetailCandidate('Apple iPad A2602 64GB Wi-Fi', product).accepted, false);
  assert.equal(evaluateRetailCandidate('Apple iPad A2602 256GB Wi-Fi', product).accepted, true);
  assert.match(buildEbaySoldQueryVariants(product, 2)[0]!, /256gb/i);
  const unrelatedBundle = extractProductIdentity('Apple iPad A2602 - Seller stated Like New; includes separate 1TB drive');
  assert.doesNotMatch(unrelatedBundle.query, /1tb/i);
});

test('a complete 50-character title does not absorb compatibility prose', () => {
  const title = 'Samsung Galaxy Tab S8 Android Tablet 11-inch 128GB';
  const product = extractProductIdentity(title, `${title} with case also compatible with Samsung Galaxy Tab S9 256GB`);
  assert.match(product.query, /s8.*128gb/i);
  assert.doesNotMatch(product.query, /s9|256gb|compatible/i);
  assert.equal(evaluateRetailCandidate('Samsung Galaxy Tab S8 Android Tablet 11-inch 128GB', product).accepted, true);
  assert.ok(buildEbaySoldQueryVariants(product, 2).every((query) => !/s9|256gb|compatible/i.test(query)));
});
