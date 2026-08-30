import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import {
  parseEbayMoney,
  parsePublicEbaySoldSearch,
  parseSellerHubProductResearch,
  verifyEbaySoldCompSet,
  type EbaySoldCompVerification,
  type EbaySoldRecord,
  type EbaySoldSearchAttempt,
} from '../src/intelligence/ebay-sold-results.js';
import {
  assessCondition,
  extractProductIdentity,
} from '../src/intelligence/us-deal-intelligence.js';

const observedAt = '2026-08-30T12:00:00.000Z';

function documentFor(html: string): Document {
  return new JSDOM(html, { url: 'https://www.ebay.com/' }).window.document;
}

function sellerHubRow(itemId: string, title: string): string {
  return `<tr class="research-table-row">
    <td><a class="research-table-row__link-row-anchor" href="https://www.ebay.com/itm/${itemId}">
      <span data-item-id="${itemId}">${title}</span>
    </a></td>
    <td class="research-table-row__avgSoldPrice"><div>$100.00</div><div class="format">Fixed price</div></td>
    <td class="research-table-row__avgShippingCost">Free shipping</td>
    <td class="research-table-row__totalSoldCount">1</td>
    <td class="research-table-row__totalSalesValue">$100.00</td>
  </tr>`;
}

function sellerHubHtml(selectedTab: 'Sold' | 'Active', row: string): string {
  return `<html><body>
    <div role="tab" aria-selected="${selectedTab === 'Sold'}">Sold</div>
    <div role="tab" aria-selected="${selectedTab === 'Active'}">Active</div>
    <table><tbody>${row}</tbody></table>
    <button aria-label="Go to next page" disabled>Next</button>
  </body></html>`;
}

function publicCard(input: {
  itemId: string;
  title: string;
  price: string;
  soldMarker?: boolean;
  extra?: string;
}): string {
  return `<li class="s-item">
    <a class="s-item__link" href="https://www.ebay.com/itm/${input.itemId}">
      <span class="s-item__title">${input.title}</span>
    </a>
    <span class="s-item__price">${input.price}</span>
    <span class="s-item__shipping">Free shipping</span>
    <span class="SECONDARY_INFO">Pre-Owned</span>
    ${input.soldMarker ? '<span class="s-item__caption--signal">Sold Aug 30, 2026</span>' : ''}
    ${input.extra ?? ''}
  </li>`;
}

function soldRecord(
  itemId: string,
  title: string,
  overrides: Partial<EbaySoldRecord> = {},
): EbaySoldRecord {
  const itemUrl = `https://www.ebay.com/itm/${itemId}`;
  return {
    source: 'seller-hub-product-research',
    sourceUrl: 'https://www.ebay.com/sh/research?keywords=review&tabName=SOLD',
    observedAt,
    itemId,
    itemUrl,
    title,
    imageUrl: null,
    soldPrice: { amount: 100, currency: 'USD' },
    shippingPrice: { amount: 0, currency: 'USD' },
    deliveredPrice: { amount: 100, currency: 'USD' },
    totalSold: 1,
    totalSales: { amount: 100, currency: 'USD' },
    soldAt: 'Aug 30, 2026',
    condition: 'Used',
    format: 'Fixed price',
    priceKind: 'actual',
    provenance: { kind: 'independent-sold-evidence', source: 'seller-hub-sold-record', itemId },
    ...overrides,
  };
}

function attemptFor(
  query: string,
  records: EbaySoldRecord[],
  overrides: Partial<EbaySoldSearchAttempt> = {},
): EbaySoldSearchAttempt {
  return {
    source: 'seller-hub-product-research',
    sourceUrl: `https://www.ebay.com/sh/research?keywords=${encodeURIComponent(query)}&tabName=SOLD`,
    query,
    observedAt,
    status: records.length ? 'ok' : 'no-results',
    records,
    hasNextPage: false,
    pageOffset: 0,
    pageLimit: 50,
    failureReason: null,
    ...overrides,
  };
}

function verifyTitles(
  sourceTitle: string,
  candidateTitles: readonly string[],
  options: {
    sourceConditionText?: string;
    sourceQuantity?: number | null;
    minimumSampleSize?: number;
    itemIdBase?: number;
  } = {},
): EbaySoldCompVerification {
  const identity = extractProductIdentity(sourceTitle);
  const query = identity.query || sourceTitle;
  const itemIdBase = options.itemIdBase ?? 880000000000;
  const records = candidateTitles.map((title, index) => soldRecord(String(itemIdBase + index + 1), title));
  return verifyEbaySoldCompSet(identity, [attemptFor(query, records)], {
    plannedQueries: [query],
    sourceCondition: options.sourceConditionText == null
      ? null
      : assessCondition(options.sourceConditionText),
    sourceQuantity: options.sourceQuantity ?? 1,
    ...(options.minimumSampleSize == null ? {} : { minimumSampleSize: options.minimumSampleSize }),
  });
}

function acceptedFlags(result: EbaySoldCompVerification, titles: readonly string[]): boolean[] {
  const accepted = new Set(result.accepted.map((record) => record.title));
  return titles.map((title) => accepted.has(title));
}

test('non-eBay Seller Hub URLs and contradictory Active tabs cannot mint sold provenance', () => {
  const row = sellerHubRow('810000000001', 'Onkyo TX-SR304 AV Receiver');
  const attempts = [
    parseSellerHubProductResearch(
      documentFor(sellerHubHtml('Sold', row)),
      'https://example.com/sh/research?keywords=Onkyo%20TX-SR304&tabName=SOLD',
      observedAt,
    ),
    parseSellerHubProductResearch(
      documentFor(sellerHubHtml('Active', row)),
      'https://www.ebay.com/sh/research?keywords=Onkyo%20TX-SR304&tabName=SOLD',
      observedAt,
    ),
  ];
  const identity = extractProductIdentity('Onkyo TX-SR304 AV Receiver');
  const outcomes = attempts.map((attempt) => {
    const verification = verifyEbaySoldCompSet(identity, [attempt], {
      plannedQueries: [attempt.query],
      minimumSampleSize: 1,
      sourceQuantity: 1,
    });
    return {
      parserAccepted: attempt.status === 'ok',
      records: attempt.records.length,
      accepted: verification.accepted.length,
      marketValueReady: verification.marketValueReady,
    };
  });

  assert.deepEqual(outcomes, [
    { parserAccepted: false, records: 0, accepted: 0, marketValueReady: false },
    { parserAccepted: false, records: 0, accepted: 0, marketValueReady: false },
  ]);
});

test('invalid or incomplete attempts cannot verify after meeting the sample threshold', () => {
  const identity = extractProductIdentity('Onkyo TX-SR304 AV Receiver');
  const query = identity.query;
  const exact = soldRecord('820000000001', 'Onkyo TX-SR304 AV Receiver');
  const attempts = [
    attemptFor(query, [exact], { status: 'challenge', failureReason: 'ebay-challenge' }),
    attemptFor(query, [exact], { status: 'not-sold-context', failureReason: 'not-sold' }),
    attemptFor(query, [exact], { status: 'parse-error', failureReason: 'parse-error' }),
    attemptFor(query, [exact], { hasNextPage: true }),
  ];
  const outcomes = attempts.map((attempt) => {
    const result = verifyEbaySoldCompSet(identity, [attempt], {
      plannedQueries: [query],
      minimumSampleSize: 1,
      sourceQuantity: 1,
    });
    return { verified: result.status === 'verified', marketValueReady: result.marketValueReady };
  });

  assert.deepEqual(outcomes, [
    { verified: false, marketValueReady: false },
    { verified: false, marketValueReady: false },
    { verified: false, marketValueReady: false },
    { verified: false, marketValueReady: false },
  ]);
});

test('public cards require a Sold marker and Accepted offer prices remain unknown', () => {
  const html = `<html><body><ul class="srp-results">
    ${publicCard({ itemId: '830000000001', title: 'Onkyo TX-SR304 AV Receiver', price: '$49.99' })}
    ${publicCard({
      itemId: '830000000002',
      title: 'Onkyo TX-SR304 AV Receiver',
      price: '$99.99',
      soldMarker: true,
      extra: '<span>Accepted offer</span>',
    })}
  </ul></body></html>`;
  const attempt = parsePublicEbaySoldSearch(
    documentFor(html),
    'https://www.ebay.com/sch/i.html?_nkw=Onkyo+TX-SR304&LH_Sold=1&LH_Complete=1',
    observedAt,
  );

  assert.deepEqual(attempt.records.map((record) => ({
    itemId: record.itemId,
    priceKind: record.priceKind,
    soldPrice: record.soldPrice,
    deliveredPrice: record.deliveredPrice,
  })), [{
    itemId: '830000000002',
    priceKind: 'best-offer-unknown',
    soldPrice: null,
    deliveredPrice: null,
  }]);
});

test('R6 generation notation and reverse Mark II comparisons reject', () => {
  const r6Two = 'Canon EOS R6 II Mirrorless Camera';
  const plainR6 = 'Canon EOS R6 Mirrorless Camera';
  const outcomes = [
    acceptedFlags(verifyTitles(plainR6, [r6Two], { minimumSampleSize: 1 }), [r6Two])[0],
    acceptedFlags(verifyTitles('Canon EOS R6 Mark II Mirrorless Camera', [plainR6], {
      minimumSampleSize: 1,
      itemIdBase: 880000000100,
    }), [plainR6])[0],
  ];

  assert.deepEqual(outcomes, [false, false]);
});

test('a generic source cannot adopt a single candidate model as market truth', () => {
  const candidates = [
    'Magcubic HY300 Smart Projector WiFi Bluetooth',
    'Magcubic HY300 Smart Projector WiFi Bluetooth',
    'Magcubic HY300 Smart Projector WiFi Bluetooth',
  ];
  const result = verifyTitles('Magcubic Smart Projector WiFi Bluetooth', candidates, {
    itemIdBase: 880000000200,
  });

  assert.deepEqual(
    { marketValueReady: result.marketValueReady, titleFamily: result.matchConfidence === 'title-family' },
    { marketValueReady: false, titleFamily: false },
  );
});

test('pagination is complete only for a contiguous walk from offset zero to a terminal page', () => {
  const identity = extractProductIdentity('Onkyo TX-SR304 AV Receiver');
  const query = identity.query;
  const verify = (attempts: EbaySoldSearchAttempt[]) => verifyEbaySoldCompSet(identity, attempts, {
    plannedQueries: [query],
    sourceQuantity: 1,
  });
  const complete = verify([
    attemptFor(query, [], { pageOffset: 0, pageLimit: 50, hasNextPage: true }),
    attemptFor(query, [], { pageOffset: 50, pageLimit: 50, hasNextPage: false }),
  ]);
  const missingStart = verify([
    attemptFor(query, [], { pageOffset: 50, pageLimit: 50, hasNextPage: false }),
  ]);
  const gap = verify([
    attemptFor(query, [], { pageOffset: 0, pageLimit: 50, hasNextPage: true }),
    attemptFor(query, [], { pageOffset: 100, pageLimit: 50, hasNextPage: false }),
  ]);

  assert.deepEqual([
    { complete: complete.completePages, status: complete.status },
    { complete: missingStart.completePages, status: missingStart.status },
    { complete: gap.completePages, status: gap.status },
  ], [
    { complete: true, status: 'insufficient' },
    { complete: false, status: 'incomplete' },
    { complete: false, status: 'incomplete' },
  ]);
});

test('word quantities, device locks, and implicit material bundles reject', () => {
  const quantityCandidates = [
    'Two Seagate 8TB External Hard Drives',
    'Twin Pack Seagate 8TB External Hard Drives',
  ];
  const quantity = verifyTitles('Seagate 8TB External Hard Drive', quantityCandidates, {
    minimumSampleSize: 1,
    sourceQuantity: 1,
    itemIdBase: 880000000300,
  });
  const conditionCandidates = [
    'Apple iPhone 15 Pro 256GB MDM Locked',
    'Apple iPhone 15 Pro 256GB Bad ESN',
  ];
  const condition = verifyTitles(
    'Apple iPhone 15 Pro 256GB Unlocked Tested Working',
    conditionCandidates,
    {
      minimumSampleSize: 1,
      sourceConditionText: 'Condition: Used - Tested Working\nFunctional: Yes',
      itemIdBase: 880000000400,
    },
  );
  const bundle = 'Sony PlayStation 5 Console w/ Spider-Man Game and Extra Controller';
  const bundled = verifyTitles('Sony PlayStation 5 Console', [bundle], {
    minimumSampleSize: 1,
    itemIdBase: 880000000500,
  });

  assert.deepEqual([
    ...acceptedFlags(quantity, quantityCandidates),
    ...acceptedFlags(condition, conditionCandidates),
    ...acceptedFlags(bundled, [bundle]),
  ], [false, false, false, false, false]);
});

test('duplicate item resolution is conservative and independent of record order', () => {
  const identity = extractProductIdentity('Onkyo TX-SR304 AV Receiver');
  const query = identity.query;
  const itemId = '890000000001';
  const actual = soldRecord(itemId, 'Onkyo TX-SR304 AV Receiver');
  const unknownOffer = soldRecord(itemId, 'Onkyo TX-SR304 AV Receiver', {
    soldPrice: null,
    deliveredPrice: null,
    priceKind: 'best-offer-unknown',
  });
  const verifyOrder = (records: EbaySoldRecord[]) => verifyEbaySoldCompSet(
    identity,
    [attemptFor(query, records)],
    { plannedQueries: [query], minimumSampleSize: 1, sourceQuantity: 1 },
  );
  const actualFirst = verifyOrder([actual, unknownOffer]);
  const unknownFirst = verifyOrder([unknownOffer, actual]);

  assert.deepEqual([
    {
      accepted: actualFirst.accepted.length,
      ready: actualFirst.marketValueReady,
      duplicates: actualFirst.duplicateItemIds,
    },
    {
      accepted: unknownFirst.accepted.length,
      ready: unknownFirst.marketValueReady,
      duplicates: unknownFirst.duplicateItemIds,
    },
  ], [
    { accepted: 0, ready: false, duplicates: [itemId] },
    { accepted: 0, ready: false, duplicates: [itemId] },
  ]);
});

test('lowercase EUR and GBP labels retain their foreign currencies', () => {
  assert.deepEqual([
    parseEbayMoney('eur 50.00'),
    parseEbayMoney('gbp 75.25'),
  ], [
    { amount: 50, currency: 'EUR' },
    { amount: 75.25, currency: 'GBP' },
  ]);
});

test('zero-dollar sold rows cannot satisfy market-value evidence', () => {
  const identity = extractProductIdentity('Onkyo TX-SR304 AV Receiver');
  const query = identity.query;
  const records = [1, 2, 3].map((suffix) => soldRecord(
    String(895000000000 + suffix),
    'Onkyo TX-SR304 AV Receiver',
    {
      soldPrice: { amount: 0, currency: 'USD' },
      deliveredPrice: { amount: 0, currency: 'USD' },
      totalSales: { amount: 0, currency: 'USD' },
    },
  ));
  const result = verifyEbaySoldCompSet(identity, [attemptFor(query, records)], {
    plannedQueries: [query],
    sourceQuantity: 1,
  });

  assert.deepEqual(
    {
      verified: result.status === 'verified',
      marketValueReady: result.marketValueReady,
      sampleSize: result.statistics.sampleSize,
    },
    { verified: false, marketValueReady: false, sampleSize: 0 },
  );
});
