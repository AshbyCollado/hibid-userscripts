import assert from 'node:assert/strict';
import test from 'node:test';
import { parseAmazonDocumentCandidates } from '../src/intelligence/amazon-document-parser.js';

test('Amazon document prices ignore ratings and installment-only amounts', () => {
  const candidates = parseAmazonDocumentCandidates(`
    <div data-asin="B000000101">
      <h2>Rating-only product</h2>
      <span class="a-offscreen">4.8 out of 5 stars</span>
    </div>
    <div data-asin="B000000102">
      <h2>Installment-only product</h2>
      <div>Or <span><span class="a-price"><span class="a-offscreen">$12.50</span></span></span>/month for 12 months</div>
    </div>
    <div data-asin="B000000103">
      <h2>Product with a purchase price</h2>
      <span class="a-offscreen">4.6 out of 5 stars</span>
      <div>Or <span class="a-price"><span class="a-offscreen">$15.00</span></span> per month</div>
      <span class="a-price" data-a-color="base"><span class="a-offscreen">$179.99</span></span>
    </div>
    <div data-asin="B000000104">
      <h2>Product with split visible price text</h2>
      <span class="a-price"><span class="a-price-symbol">$</span><span class="a-price-whole">89</span><span class="a-price-fraction">95</span></span>
    </div>
  `);

  assert.equal(candidates.find(({ asin }) => asin === 'B000000101')?.price, null);
  assert.equal(candidates.find(({ asin }) => asin === 'B000000102')?.price, null);
  assert.equal(candidates.find(({ asin }) => asin === 'B000000103')?.price, 179.99);
  assert.equal(candidates.find(({ asin }) => asin === 'B000000104')?.price, 89.95);
});

test('Amazon document sponsorship is inherited from the result-card root', () => {
  const candidates = parseAmazonDocumentCandidates(`
    <div data-asin="B000000201" data-component-type="sp-sponsored-result">
      <div data-asin="B000000201">
        <h2>Sponsored root product</h2>
        <span class="a-price"><span class="a-offscreen">$49.99</span></span>
      </div>
    </div>
  `);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.sponsored, true);
});

test('Amazon document used detection reads condition badges, not descriptive "used for" text', () => {
  const candidates = parseAmazonDocumentCandidates(`
    <div data-asin="B000000301">
      <h2>Precision guide used for woodworking</h2>
      <span class="a-price"><span class="a-offscreen">$29.99</span></span>
    </div>
    <div data-asin="B000000302">
      <h2>Precision woodworking guide</h2>
      <span class="a-badge-text">Used - Like New</span>
      <span class="a-price"><span class="a-offscreen">$19.99</span></span>
    </div>
    <div data-asin="B000000303">
      <h2>Precision woodworking guide (Renewed)</h2>
      <span class="a-price"><span class="a-offscreen">$24.99</span></span>
    </div>
  `);

  assert.equal(candidates.find(({ asin }) => asin === 'B000000301')?.used, false);
  assert.equal(candidates.find(({ asin }) => asin === 'B000000302')?.used, true);
  assert.equal(candidates.find(({ asin }) => asin === 'B000000303')?.used, true);
});

test('duplicate ASINs prefer a non-sponsored new offer with a valid purchase price', () => {
  const candidates = parseAmazonDocumentCandidates(`
    <div data-asin="B000000401" data-component-type="sp-sponsored-result">
      <h2>Sponsored new offer</h2>
      <span class="a-price"><span class="a-offscreen">$39.99</span></span>
    </div>
    <div data-asin="B000000401">
      <h2>Organic used offer</h2>
      <span class="a-badge-text">Used - Very Good</span>
      <span class="a-price"><span class="a-offscreen">$34.99</span></span>
    </div>
    <div data-asin="B000000401">
      <h2>Organic new installment-only offer</h2>
      <div><span class="a-price"><span class="a-offscreen">$5.00</span></span>/month</div>
    </div>
    <div data-asin="B000000401">
      <h2>Organic new purchase offer</h2>
      <span class="a-price"><span class="a-offscreen">$44.99</span></span>
    </div>
  `);

  assert.equal(candidates.length, 1);
  assert.equal(candidates[0]?.title, 'Organic new purchase offer');
  assert.equal(candidates[0]?.price, 44.99);
  assert.equal(candidates[0]?.sponsored, false);
  assert.equal(candidates[0]?.used, false);
});

test('parts-only offers are ineligible and a shared financing wrapper cannot outrank the purchase price', () => {
  const candidates = parseAmazonDocumentCandidates(`
    <div data-asin="B000000501">
      <h2>Canon EOS R5 Mirrorless Camera - For Parts Only</h2>
      <span class="a-price"><span class="a-offscreen">$899.99</span></span>
    </div>
    <div data-asin="B000000502">
      <h2>Product with financing and full price in one wrapper</h2>
      <div class="shared-price-wrapper">
        <span class="a-price"><span class="a-offscreen">$15.00</span></span><span>/month</span>
        <span class="a-price"><span class="a-offscreen">$179.99</span></span>
      </div>
    </div>
  `);

  assert.equal(candidates.find(({ asin }) => asin === 'B000000501')?.used, true);
  assert.equal(candidates.find(({ asin }) => asin === 'B000000502')?.price, 179.99);
});
