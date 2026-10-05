import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateRetailCandidate,
  extractProductIdentity,
} from '../src/intelligence/us-deal-intelligence.js';
import { parseEbayActiveResults } from '../src/intelligence/ebay-active-results.js';
import {
  verifyEbaySoldCompSet,
  type EbaySoldRecord,
  type EbaySoldSearchAttempt,
} from '../src/intelligence/ebay-sold-results.js';

const observedAt = '2026-10-03T12:00:00.000Z';
const deckTitle = '$57 MTG LOTR TALES OF MIDDLE EARTH COMMANDER DECK-';
const canonicalDeck = 'MTG LOTR Tales of Middle Earth Commander Deck Elven Council';
const typoDeck = 'MTG LOTR Tales of Middle Earth Commander Deck Evlven Council';

function soldRecord(itemId: string, title: string): EbaySoldRecord {
  return {
    source: 'seller-hub-product-research',
    sourceUrl: 'https://www.ebay.com/sh/research?keywords=elven+council&tabName=SOLD',
    observedAt,
    itemId,
    itemUrl: `https://www.ebay.com/itm/${itemId}`,
    title,
    imageUrl: null,
    soldPrice: { amount: 57, currency: 'USD' },
    shippingPrice: { amount: 0, currency: 'USD' },
    deliveredPrice: { amount: 57, currency: 'USD' },
    totalSold: 1,
    totalSales: { amount: 57, currency: 'USD' },
    soldAt: 'Oct 2, 2026',
    condition: 'New',
    format: 'Fixed price',
    priceKind: 'actual',
    provenance: { kind: 'independent-sold-evidence', source: 'seller-hub-sold-record', itemId },
  };
}

function soldAttempt(query: string, records: EbaySoldRecord[]): EbaySoldSearchAttempt {
  return {
    source: 'seller-hub-product-research',
    sourceUrl: 'https://www.ebay.com/sh/research?keywords=elven+council&tabName=SOLD',
    query,
    observedAt,
    status: 'ok',
    records,
    hasNextPage: false,
    pageOffset: 0,
    pageLimit: 50,
    failureReason: null,
  };
}

function activeItem(itemId: string, title: string) {
  return {
    itemId,
    title,
    itemWebUrl: `https://www.ebay.com/itm/${itemId}`,
    price: { value: '57.00', currency: 'USD' },
    shippingOptions: [{ shippingCost: { value: '0', currency: 'USD' } }],
    buyingOptions: ['FIXED_PRICE'],
    condition: 'New',
  };
}

test('canonicalizes the known title typo while preserving the raw source name', () => {
  const identity = extractProductIdentity(`${deckTitle} EVLVEN COUNCIL`);

  assert.match(identity.name, /EVLVEN COUNCIL/);
  assert.match(identity.query, /elven council/);
  assert.doesNotMatch(identity.query, /evlven council/);
  assert.deepEqual(identity.discriminators.variantLabels, ['named-deck:elven council']);
  assert.equal(evaluateRetailCandidate(canonicalDeck, identity).accepted, true);
  assert.equal(evaluateRetailCandidate(typoDeck, identity).accepted, true);
});

test('canonicalizes the known typo in the first description line only', () => {
  const identity = extractProductIdentity({
    title: deckTitle,
    description: 'EVLVEN COUNCIL\nCondition: New\nMissing Parts?: No',
  });

  assert.equal(identity.name, 'MTG LOTR TALES OF MIDDLE EARTH COMMANDER DECK');
  assert.match(identity.query, /elven council/);
  assert.deepEqual(identity.discriminators.variantLabels, ['named-deck:elven council']);
  assert.equal(evaluateRetailCandidate(canonicalDeck, identity).accepted, true);
});

test('resolved deck identity rejects immediate deck exclusions but keeps outer-box and accessory exclusions', () => {
  const identity = extractProductIdentity({
    title: deckTitle,
    description: 'Elven Council\nCondition: New',
  });

  for (const title of [canonicalDeck, typoDeck,
    `${canonicalDeck} outer box not included`,
    `${canonicalDeck} card sleeves not included`]) {
    assert.equal(evaluateRetailCandidate(title, identity).accepted, true, title);
  }
  for (const title of [
    `${canonicalDeck} not included`,
    `${canonicalDeck} excluded`,
    `${typoDeck} not included`,
    `${typoDeck} excluded`,
    `${canonicalDeck} is not included`,
    `${canonicalDeck} is excluded`,
    `${canonicalDeck} (not included)`,
    `${typoDeck} is not included`,
    `${typoDeck} is excluded`,
    `${typoDeck} (not included)`,
  ]) {
    const result = evaluateRetailCandidate(title, identity);
    assert.equal(result.accepted, false, `${title}: ${JSON.stringify(result)}`);
    assert.match(result.rejectionReasons.join(','), /variantLabels:named-deck:elven council/);
  }
});

test('ambiguous descriptions, bundles, and negated variants remain rejected', () => {
  const identity = extractProductIdentity({
    title: deckTitle,
    description: 'EVLVEN COUNCIL and FOOD AND FELLOWSHIP\nCondition: New',
  });

  assert.deepEqual(identity.discriminators.variantLabels, []);
  for (const title of [
    canonicalDeck,
    `${canonicalDeck} and Food and Fellowship`,
    `${canonicalDeck} not Elven Council`,
    'MTG LOTR Tales of Middle Earth Commander Deck Food and Fellowship',
  ]) {
    const result = evaluateRetailCandidate(title, identity);
    assert.equal(result.accepted, false, `${title}: ${JSON.stringify(result)}`);
    assert.match(result.rejectionReasons.join(','), /variantLabels:named-deck:unresolved/);
  }
});

test('non-collectible text containing the typo is untouched', () => {
  const identity = extractProductIdentity('Vintage EVLVEN COUNCIL poster');
  assert.equal(identity.query, 'vintage evlven council poster');
  assert.deepEqual(identity.discriminators.variantLabels, []);
});

test('Sold matching accepts the canonical deck and rejects other or bundled variants', () => {
  const identity = extractProductIdentity({ title: deckTitle, description: 'EVLVEN COUNCIL\nCondition: New' });
  const query = 'mtg lotr tales of middle earth commander deck elven council';
  const result = verifyEbaySoldCompSet(identity, [soldAttempt(query, [
    soldRecord('3232005561', canonicalDeck),
    soldRecord('3232005562', 'MTG LOTR Tales of Middle Earth Commander Deck Food and Fellowship'),
    soldRecord('3232005563', `${canonicalDeck} and Food and Fellowship`),
    soldRecord('3232005564', `${canonicalDeck} not Elven Council`),
  ])], { plannedQueries: [query], minimumSampleSize: 1 });

  assert.deepEqual(result.accepted.map((record) => record.itemId), ['3232005561']);
  assert.equal(result.rejected.length, 3);
});

test('Active matching accepts the canonical deck and rejects the wrong named deck', () => {
  const identity = extractProductIdentity({ title: deckTitle, description: 'EVLVEN COUNCIL\nCondition: New' });
  const result = parseEbayActiveResults({
    query: 'mtg lotr tales of middle earth commander deck elven council',
    identity,
    observedAt,
    browseJson: {
      total: 2,
      offset: 0,
      itemSummaries: [
        activeItem('3232005571', canonicalDeck),
        activeItem('3232005572', 'MTG LOTR Tales of Middle Earth Commander Deck Riders of Rohan'),
      ],
    },
  });

  assert.deepEqual(result.accepted.map((record) => record.itemId), ['3232005571']);
  assert.deepEqual(result.rejected.map((record) => record.itemId), ['3232005572']);
});
