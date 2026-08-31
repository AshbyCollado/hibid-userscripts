import assert from 'node:assert/strict';
import test from 'node:test';
import { enrichAmazonCandidateFromDetail, parseAmazonDocumentCandidates } from '../src/intelligence/amazon-document-parser.js';
import { extractProductIdentity, matchAmazonCandidates } from '../src/intelligence/us-deal-intelligence.js';

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

test('Amazon split brand headings are recombined with their product title link', () => {
  const candidates = parseAmazonDocumentCandidates(`
    <div data-asin="B08DXKBY6N" data-component-type="s-search-result">
      <h2 class="a-size-mini s-line-clamp-1"><span>Epson</span></h2>
      <div data-cy="title-recipe">
        <a class="a-link-normal a-text-normal" href="/Epson-Workforce-WF-7840/dp/B08DXKBY6N">
          <span>Workforce Pro WF-7840 Wireless All-in-One Wide-Format Inkjet Printer</span>
        </a>
      </div>
      <a class="a-link-normal a-text-normal" href="/Epson-Workforce-WF-7840/dp/B08DXKBY6N">
        <span class="a-price"><span class="a-offscreen">$249.99</span></span>
      </a>
    </div>
  `);
  const candidate = candidates[0];
  assert.equal(candidate?.title, 'Epson Workforce Pro WF-7840 Wireless All-in-One Wide-Format Inkjet Printer');
  assert.equal(candidate?.price, 249.99);
  assert.equal(matchAmazonCandidates(candidates, extractProductIdentity('LIKE NEW EPSON WORKFORCE WF-7840'))?.candidate.asin, 'B08DXKBY6N');
});

test('Amazon detail enrichment recovers tightly scoped new and used buy-box prices', () => {
  const source = {
    asin: 'B0DETAIL01', title: 'PlayStation 5 Pro Console', matchText: 'PlayStation 5 Pro Console',
    price: null, used: false, sponsored: false, url: 'https://www.amazon.com/dp/B0DETAIL01'
  };
  const fresh = enrichAmazonCandidateFromDetail(source, `
    <span id="productTitle">PlayStation 5 Pro Console</span>
    <div id="corePriceDisplay_desktop_feature_div">
      <span class="a-price"><span class="a-offscreen">$749.99</span></span>
    </div>
    <div><span class="a-text-price"><span class="a-offscreen">$899.99</span></span></div>
  `);
  assert.equal(fresh.price, 749.99);
  assert.equal(fresh.used, false);

  const used = enrichAmazonCandidateFromDetail(source, `
    <span id="productTitle">PlayStation 5 Pro Console</span>
    <div id="usedOnlyBuybox">Buy Used: <span class="offer-price">$612.34</span></div>
    <div id="corePriceDisplay_desktop_feature_div">
      <span class="a-price"><span class="a-offscreen">$612.34</span></span>
    </div>
  `);
  assert.equal(used.price, 612.34);
  assert.equal(used.used, true);
});

test('Amazon detail enrichment ignores unrelated carousel and list prices', () => {
  const candidate = enrichAmazonCandidateFromDetail({
    asin: 'B0DETAIL02', title: 'Exact Product', price: null, used: false, sponsored: false,
    url: 'https://www.amazon.com/dp/B0DETAIL02'
  }, `
    <span id="productTitle">Exact Product</span>
    <div id="customers-who-viewed"><span class="a-price"><span class="a-offscreen">$19.99</span></span></div>
    <div id="corePriceDisplay_desktop_feature_div"><span class="a-text-price"><span class="a-offscreen">$499.99</span></span></div>
  `);
  assert.equal(candidate.price, null);
});
