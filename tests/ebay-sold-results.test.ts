import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import {
  buildEbaySoldQueryVariants,
  parseEbayMoney,
  parsePublicEbaySoldSearch,
  parseSellerHubProductResearch,
  verifyEbaySoldCompSet,
  type EbaySoldRecord,
  type EbaySoldSearchAttempt,
} from '../src/intelligence/ebay-sold-results.js';
import { assessCondition, extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';

const observedAt = '2026-08-30T12:00:00.000Z';

function documentFor(html: string): Document {
  return new JSDOM(html, { url: 'https://www.ebay.com/' }).window.document;
}

function sellerHubRow(input: {
  itemId: string;
  title: string;
  soldPrice: string;
  shipping: string;
  totalSold?: string;
  totalSales?: string;
  soldAt?: string;
}): string {
  return `<tr class="research-table-row">
    <td class="research-table-row__item research-table-row__product-info">
      <img src="https://i.ebayimg.com/images/g/example/s-l1200.jpg" alt="${input.title}">
      <a class="research-table-row__link-row-anchor" href="https://www.ebay.com/itm/${input.itemId}?orig_cvip=true">
        <span data-item-id="${input.itemId}">${input.title}</span>
      </a>
    </td>
    <td class="research-table-row__item research-table-row__avgSoldPrice"><div>${input.soldPrice}</div><div class="format">Fixed price</div></td>
    <td class="research-table-row__item research-table-row__avgShippingCost"><div>${input.shipping}</div></td>
    <td class="research-table-row__item research-table-row__totalSoldCount"><div>${input.totalSold ?? '1'}</div></td>
    <td class="research-table-row__item research-table-row__totalSalesValue"><div>${input.totalSales ?? input.soldPrice}</div></td>
    <td class="research-table-row__item research-table-row__dateLastSold"><div>${input.soldAt ?? 'Aug 19, 2026'}</div></td>
  </tr>`;
}

function productResearchHtml(rows: string, nextDisabled = true): string {
  return `<!doctype html><html><head><title>Product Research - eBay Seller Hub</title></head><body>
    <div role="tab" aria-selected="true">Sold</div>
    <table><tbody>${rows}</tbody></table>
    <button aria-label="Go to next page" ${nextDisabled ? 'disabled' : ''}>Next</button>
  </body></html>`;
}

function publicCard(input: {
  itemId: string;
  title: string;
  price: string;
  shipping: string;
  extra?: string;
}): string {
  return `<li class="s-item">
    <a class="s-item__link" href="https://www.ebay.com/itm/${input.itemId}?hash=item1"><span class="s-item__title">${input.title}</span></a>
    <span class="s-item__price">${input.price}</span>
    <span class="s-item__shipping">${input.shipping}</span>
    <span class="SECONDARY_INFO">Pre-Owned</span>
    <span class="s-item__caption--signal">Sold Aug 28, 2026</span>
    ${input.extra ?? ''}
  </li>`;
}

function record(input: Partial<EbaySoldRecord> & Pick<EbaySoldRecord, 'itemId' | 'title'>): EbaySoldRecord {
  const itemUrl = `https://www.ebay.com/itm/${input.itemId}`;
  return {
    source: 'seller-hub-product-research',
    sourceUrl: 'https://www.ebay.com/sh/research?keywords=onkyo&tabName=SOLD',
    observedAt,
    itemId: input.itemId,
    itemUrl,
    title: input.title,
    imageUrl: null,
    soldPrice: { amount: 50, currency: 'USD' },
    shippingPrice: { amount: 10, currency: 'USD' },
    deliveredPrice: { amount: 60, currency: 'USD' },
    totalSold: 1,
    totalSales: { amount: 50, currency: 'USD' },
    soldAt: 'Aug 28, 2026',
    condition: 'Used',
    format: 'Fixed price',
    priceKind: 'actual',
    provenance: { kind: 'independent-sold-evidence', source: 'seller-hub-sold-record', itemId: input.itemId },
    ...input,
  };
}

function attemptFor(query: string, records: EbaySoldRecord[], overrides: Partial<EbaySoldSearchAttempt> = {}): EbaySoldSearchAttempt {
  return {
    source: 'seller-hub-product-research',
    sourceUrl: `https://www.ebay.com/sh/research?keywords=${encodeURIComponent(query)}&tabName=SOLD`,
    query,
    observedAt,
    status: 'ok',
    records,
    hasNextPage: false,
    pageOffset: 0,
    pageLimit: 50,
    failureReason: null,
    ...overrides,
  };
}

test('money parsing preserves amount and marketplace currency', () => {
  assert.deepEqual(parseEbayMoney('$1,234.56'), { amount: 1234.56, currency: 'USD' });
  assert.deepEqual(parseEbayMoney('C $99.00'), { amount: 99, currency: 'CAD' });
  assert.deepEqual(parseEbayMoney('Free shipping'), null);
  assert.deepEqual(parseEbayMoney('-'), null);
});

test('query variants preserve the precise title and back off through stable model identity', () => {
  const onkyo = extractProductIdentity('Onkyo TX-SR304 Multi-Channel AV Receiver');
  assert.deepEqual(buildEbaySoldQueryVariants(onkyo), [
    'onkyo tx-sr304 multi-channel av receiver',
    'Onkyo TX-SR304',
    'TX-SR304',
  ]);

  const book = extractProductIdentity('The Jesus Papers: Exposing the Greatest Cover-Up in History');
  const bookVariants = buildEbaySoldQueryVariants(book);
  assert.equal(bookVariants[0], 'the jesus papers exposing the greatest cover-up in history');
  assert.ok(bookVariants.length >= 2);
  assert.equal(new Set(bookVariants.map((value) => value.toLowerCase())).size, bookVariants.length);

  assert.deepEqual(buildEbaySoldQueryVariants(extractProductIdentity('The Jesus Papers Book by Michael Baigent')), [
    'the jesus papers book by michael baigent',
    'The Jesus Papers',
    '"The Jesus Papers"',
  ]);

  const consoleIdentity = extractProductIdentity('Sony PlayStation 5 Disc Console');
  assert.ok(buildEbaySoldQueryVariants(consoleIdentity).every((value) => !/playstation\s+disc/i.test(value)));
  assert.ok(buildEbaySoldQueryVariants(extractProductIdentity('Magcubic 4K Smart Projector, WiFi/BT'))[1]?.includes('4k'));
});

test('Seller Hub Product Research parser extracts sold provenance and economics', () => {
  const html = productResearchHtml([
    sellerHubRow({ itemId: '276589785006', title: 'The Jesus Papers: Exposing the Greatest Cover-Up in History - VERY GOOD', soldPrice: '$4.06', shipping: '$0.00 100% Free shipping' }),
    sellerHubRow({ itemId: '198554957220', title: 'The Brick Bible: The New Testament', soldPrice: '$7.63', shipping: '$5.00', totalSold: '2', totalSales: '$15.26' }),
  ].join(''));
  const result = parseSellerHubProductResearch(
    documentFor(html),
    'https://www.ebay.com/sh/research?marketplace=EBAY-US&keywords=%22The+Jesus+Papers%22&offset=0&limit=50&tabName=SOLD',
    observedAt,
  );

  assert.equal(result.status, 'ok');
  assert.equal(result.query, '"The Jesus Papers"');
  assert.equal(result.records.length, 2);
  assert.equal(result.hasNextPage, false);
  assert.deepEqual(result.records[0]?.soldPrice, { amount: 4.06, currency: 'USD' });
  assert.deepEqual(result.records[0]?.shippingPrice, { amount: 0, currency: 'USD' });
  assert.deepEqual(result.records[0]?.deliveredPrice, { amount: 4.06, currency: 'USD' });
  assert.equal(result.records[0]?.provenance.source, 'seller-hub-sold-record');
  assert.equal(result.records[1]?.priceKind, 'average-actual');
  assert.equal(result.records[1]?.totalSold, 2);
});

test('Seller Hub parser fails closed outside the selected Sold tab and detects challenges', () => {
  const active = parseSellerHubProductResearch(
    documentFor('<html><body><div role="tab" aria-selected="true">Active</div></body></html>'),
    'https://www.ebay.com/sh/research?keywords=receiver&tabName=ACTIVE',
    observedAt,
  );
  assert.equal(active.status, 'not-sold-context');

  const challenge = parseSellerHubProductResearch(
    documentFor('<html><head><title>Pardon Our Interruption...</title></head><body>Verify you are human</body></html>'),
    'https://www.ebay.com/sh/research?keywords=receiver&tabName=SOLD',
    observedAt,
  );
  assert.equal(challenge.status, 'challenge');
  assert.equal(challenge.failureReason, 'ebay-challenge');

  const noResults = parseSellerHubProductResearch(
    documentFor('<html><body><section role="tabpanel"><h2>No sold results found for "receiver"</h2></section></body></html>'),
    'https://www.ebay.com/sh/research?keywords=receiver&tabName=SOLD',
    observedAt,
  );
  assert.equal(noResults.status, 'no-results');
  assert.equal(noResults.records.length, 0);
});

test('public Sold and Completed parser treats accepted Best Offers as price-unknown', () => {
  const html = `<html><body><ul class="srp-results">
    ${publicCard({ itemId: '123456789012', title: 'Onkyo TX-SR304 AV Receiver', price: '$49.99', shipping: '+$12.00 shipping' })}
    ${publicCard({ itemId: '123456789013', title: 'Onkyo TX-SR304 Receiver', price: '$99.99', shipping: 'Free shipping', extra: '<span>Best offer accepted</span>' })}
  </ul></body></html>`;
  const result = parsePublicEbaySoldSearch(
    documentFor(html),
    'https://www.ebay.com/sch/i.html?_nkw=Onkyo+TX-SR304&LH_Sold=1&LH_Complete=1',
    observedAt,
  );

  assert.equal(result.status, 'ok');
  assert.equal(result.records.length, 2);
  assert.deepEqual(result.records[0]?.deliveredPrice, { amount: 61.99, currency: 'USD' });
  assert.equal(result.records[1]?.priceKind, 'best-offer-unknown');
  assert.equal(result.records[1]?.soldPrice, null);
  assert.equal(result.records[1]?.deliveredPrice, null);
});

test('public search parser rejects an active or ambiguously filtered result page', () => {
  const result = parsePublicEbaySoldSearch(
    documentFor(`<html><body>${publicCard({ itemId: '123456789012', title: 'Onkyo TX-SR304 Receiver', price: '$49.99', shipping: 'Free shipping' })}</body></html>`),
    'https://www.ebay.com/sch/i.html?_nkw=Onkyo+TX-SR304&LH_Sold=1',
    observedAt,
  );
  assert.equal(result.status, 'not-sold-context');
  assert.equal(result.records.length, 0);
});

test('verification keeps the exact book comp and rejects eBay related-result drift', () => {
  const identity = extractProductIdentity('The Jesus Papers Book by Michael Baigent');
  const query = '"The Jesus Papers"';
  const exact = record({ itemId: '276589785006', title: 'The Jesus Papers: Exposing the Greatest Cover-Up in History - VERY GOOD', soldPrice: { amount: 4.06, currency: 'USD' }, shippingPrice: { amount: 0, currency: 'USD' }, deliveredPrice: { amount: 4.06, currency: 'USD' } });
  const drift = record({ itemId: '198554957220', title: 'The Brick Bible: The New Testament: A New Spin on the Story of Jesus - paperback' });
  const poster = record({ itemId: '278217492948', title: 'Peter Max Early Art - Jesus paper poster 21h x 30w' });
  const result = verifyEbaySoldCompSet(identity, [attemptFor(query, [exact, drift, poster])], {
    plannedQueries: [query],
    minimumSampleSize: 1,
  });

  assert.equal(result.status, 'verified');
  assert.equal(result.matchConfidence, 'title-family');
  assert.equal(result.marketValueReady, true);
  assert.deepEqual(result.accepted.map((entry) => entry.itemId), ['276589785006']);
  assert.deepEqual(result.rejected.map((entry) => entry.itemId).sort(), ['198554957220', '278217492948']);
  assert.equal(result.statistics.salePriceMedian, 4.06);
});

test('verification rejects accessories, wrong models, parts-only comps, quantities, and duplicates', () => {
  const identity = extractProductIdentity('Onkyo TX-SR304 Multi-Channel AV Receiver');
  const exact = record({ itemId: '123456789001', title: 'Onkyo TX-SR304 5.1 Channel AV Receiver Tested Working' });
  const accessory = record({ itemId: '123456789002', title: 'Replacement Remote Control for Onkyo TX-SR304 Receiver' });
  const wrongModel = record({ itemId: '123456789003', title: 'Onkyo TX-SR505 AV Receiver' });
  const parts = record({ itemId: '123456789004', title: 'Onkyo TX-SR304 Receiver For Parts or Repair' });
  const pair = record({ itemId: '123456789005', title: 'Lot of 2 Onkyo TX-SR304 AV Receivers' });
  const manual = record({ itemId: '123456789006', title: 'Onkyo TX-SR304 Service Manual Digital PDF' });
  const packaging = record({ itemId: '123456789007', title: 'Onkyo TX-SR304 Original Box and Manual' });
  const trailingQuantity = record({ itemId: '123456789008', title: 'Onkyo TX-SR304 AV Receiver Tested Qty 2' });
  const duplicate = { ...exact };
  const result = verifyEbaySoldCompSet(identity, [attemptFor('Onkyo TX-SR304', [exact, accessory, wrongModel, parts, pair, manual, packaging, trailingQuantity, duplicate])], {
    plannedQueries: ['Onkyo TX-SR304'],
    minimumSampleSize: 1,
    sourceCondition: assessCondition('Condition: Used - Very Good\nFunctional: Yes\nDamaged: No'),
    sourceQuantity: 1,
  });

  assert.equal(result.status, 'verified');
  assert.equal(result.matchConfidence, 'exact-model');
  assert.equal(result.marketValueReady, true);
  assert.deepEqual(result.accepted.map((entry) => entry.itemId), ['123456789001']);
  assert.equal(result.rejected.length, 7);
  assert.deepEqual(result.duplicateItemIds, ['123456789001']);
  assert.ok(result.rejected.find((entry) => entry.itemId === '123456789002')?.reasons.includes('accessory-or-component'));
  assert.ok(result.rejected.find((entry) => entry.itemId === '123456789003')?.reasons.includes('model-mismatch:TX-SR304'));
  assert.ok(result.rejected.find((entry) => entry.itemId === '123456789004')?.reasons.includes('condition-mismatch:parts-only-comp'));
  assert.ok(result.rejected.find((entry) => entry.itemId === '123456789005')?.reasons.includes('quantity-mismatch:1:2'));
  assert.ok(result.rejected.find((entry) => entry.itemId === '123456789006')?.reasons.includes('accessory-or-component'));
  assert.ok(result.rejected.find((entry) => entry.itemId === '123456789007')?.reasons.includes('accessory-or-component'));
  assert.ok(result.rejected.find((entry) => entry.itemId === '123456789008')?.reasons.includes('quantity-mismatch:1:2'));
});

test('parts-only sold rows are rejected even when source condition was unavailable', () => {
  const identity = extractProductIdentity('ASUS GeForce RTX4060 8GB Video Card');
  const working = record({ itemId: '123456789001', title: 'ASUS GeForce RTX 4060 8GB Graphics Card Tested' });
  const parts = record({ itemId: '123456789002', title: 'For Parts ASUS GeForce RTX 4060 8GB Graphics Card' });
  const packaging = record({ itemId: '123456789003', title: 'ASUS GeForce RTX 4060 8GB Box and Cooler' });
  const result = verifyEbaySoldCompSet(identity, [attemptFor('ASUS RTX4060', [working, parts, packaging])], {
    plannedQueries: ['ASUS RTX4060'],
    minimumSampleSize: 1,
  });
  assert.deepEqual(result.accepted.map((entry) => entry.itemId), ['123456789001']);
  assert.ok(result.rejected.find((entry) => entry.itemId === '123456789002')?.reasons.includes('condition-mismatch:parts-only-comp'));
  assert.ok(result.rejected.find((entry) => entry.itemId === '123456789003')?.reasons.includes('accessory-or-component'));
  assert.deepEqual(result.variantModels, ['RTX4060']);
});

test('insufficient-data is emitted only after every planned search and page is complete', () => {
  const identity = extractProductIdentity('Onkyo TX-SR304 Multi-Channel AV Receiver');
  const exact = record({ itemId: '123456789001', title: 'Onkyo TX-SR304 AV Receiver' });
  const oneAttempt = verifyEbaySoldCompSet(identity, [attemptFor('Onkyo TX-SR304', [exact])], {
    plannedQueries: ['Onkyo TX-SR304', 'Onkyo TX-SR304 receiver'],
    minimumSampleSize: 3,
  });
  assert.equal(oneAttempt.status, 'incomplete');
  assert.equal(oneAttempt.allPlannedQueriesAttempted, false);

  const paged = verifyEbaySoldCompSet(identity, [
    attemptFor('Onkyo TX-SR304', [exact]),
    attemptFor('Onkyo TX-SR304 receiver', [], { hasNextPage: true }),
  ], { plannedQueries: ['Onkyo TX-SR304', 'Onkyo TX-SR304 receiver'], minimumSampleSize: 3 });
  assert.equal(paged.status, 'incomplete');
  assert.equal(paged.completePages, false);

  const complete = verifyEbaySoldCompSet(identity, [
    attemptFor('Onkyo TX-SR304', [exact]),
    attemptFor('Onkyo TX-SR304 receiver', [], { status: 'no-results' }),
  ], { plannedQueries: ['Onkyo TX-SR304', 'Onkyo TX-SR304 receiver'], minimumSampleSize: 3 });
  assert.equal(complete.status, 'insufficient');
  assert.equal(complete.allPlannedQueriesAttempted, true);
  assert.equal(complete.completePages, true);
  assert.ok(complete.insufficiencyReasons.includes('verified-sample-below-minimum:1/3'));
});

test('a sample threshold cannot override incomplete result pagination', () => {
  const identity = extractProductIdentity('Onkyo TX-SR304 Multi-Channel AV Receiver');
  const records = [
    record({ itemId: '123456789001', title: 'Onkyo TX-SR304 AV Receiver Tested' }),
    record({ itemId: '123456789002', title: 'Onkyo TX-SR304 5.1 Channel Receiver' }),
    record({ itemId: '123456789003', title: 'Onkyo TX-SR304 AV Receiver with Remote' }),
  ];
  const result = verifyEbaySoldCompSet(identity, [attemptFor('Onkyo TX-SR304', records, { hasNextPage: true })], {
    plannedQueries: ['Onkyo TX-SR304', 'TX-SR304'],
    minimumSampleSize: 3,
  });
  assert.equal(result.status, 'incomplete');
  assert.equal(result.allPlannedQueriesAttempted, false);
  assert.equal(result.completePages, false);
  assert.equal(result.marketValueReady, false);
  assert.ok(result.insufficiencyReasons.includes('result-pagination-incomplete'));
});

test('model-less source retains mixed variant evidence without inventing one market value', () => {
  const identity = extractProductIdentity('Magcubic 4K Smart Projector, WiFi/BT');
  const records = [
    record({ itemId: '123456789001', title: 'Magcubic HY300 Pro 4K Smart Projector', soldPrice: { amount: 35, currency: 'USD' } }),
    record({ itemId: '123456789002', title: 'Magcubic HY350 Max 4K Smart Projector', soldPrice: { amount: 65, currency: 'USD' } }),
    record({ itemId: '123456789003', title: 'Magcubic HY300 Pro 4K WiFi Projector', soldPrice: { amount: 40, currency: 'USD' } }),
  ];
  const result = verifyEbaySoldCompSet(identity, [attemptFor('magcubic 4k projector', records)], {
    plannedQueries: ['magcubic 4k projector'],
    minimumSampleSize: 3,
  });
  assert.equal(result.status, 'insufficient');
  assert.equal(result.matchConfidence, 'variant-ambiguous');
  assert.equal(result.marketValueReady, false);
  assert.ok(result.insufficiencyReasons.includes('variant-ambiguous'));
  assert.deepEqual(result.variantModels.sort(), ['HY300', 'HY350']);
  assert.equal(result.accepted.length, 3);
});

test('challenge state is blocked rather than mislabeled as insufficient data', () => {
  const identity = extractProductIdentity('Onkyo TX-SR304 AV Receiver');
  const challenge = attemptFor('Onkyo TX-SR304', [], { status: 'challenge', failureReason: 'ebay-challenge' });
  const result = verifyEbaySoldCompSet(identity, [challenge], { plannedQueries: ['Onkyo TX-SR304'] });
  assert.equal(result.status, 'blocked');
  assert.ok(result.insufficiencyReasons.includes('ebay-challenge'));
});
