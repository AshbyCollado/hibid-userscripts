import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { parseEbayActiveResults } from '../src/intelligence/ebay-active-results.js';
import { extractProductIdentity } from '../src/intelligence/us-deal-intelligence.js';

const observedAt = '2026-10-02T12:00:00.000Z';

function parse(sourceTitle: string, titles: string[], sourceDescription = 'Good condition. Minor wear. See photos.') {
  const identity = extractProductIdentity(sourceTitle, sourceDescription);
  return parseEbayActiveResults({
    query: sourceTitle,
    identity,
    observedAt,
    sourceDescription,
    browseJson: {
      total: titles.length,
      offset: 0,
      itemSummaries: titles.map((title, index) => ({
        itemId: `v1|${2493977 + index}|0`,
        title,
        itemWebUrl: `https://www.ebay.com/itm/${2493977 + index}`,
        price: { value: '125.00', currency: 'USD' },
        condition: 'Used',
        conditionId: '3000',
        buyingOptions: ['FIXED_PRICE'],
        shippingOptions: [{ shippingCost: { value: '0', currency: 'USD' } }],
      })),
    },
  });
}

test('holds the Simon Pearce generic vase source for manual identity review', () => {
  const result = parse('A Large Vase By Simon Pearce', [
    'Simon Pearce Large Vase',
    'Simon Pearce Pitcher',
    'Simon Pearce Bowl',
    'Simon Pearce Urn',
    'Simon Pearce Pair of Vases',
    'Simon Pearce Chelsea Vase',
  ]);

  assert.equal(result.accepted.length, 0);
  assert.equal(result.benchmark, null);
  assert.equal(result.rejected.length, 6);
  assert.ok(result.rejected.every((record) => record.rejectionReasons.some((reason) =>
    reason === 'manual-identity-review:decorative-variant-unresolved'
    || reason.startsWith('decorative-family-mismatch:')
    || reason === 'quantity-mismatch')));
});

test('parses the captured 167-row Browse response as review-only without forced brand identity', () => {
  const receipt = JSON.parse(readFileSync(new URL(
    './fixtures/ebay-active-simon-pearce-production-20261003.json',
    import.meta.url,
  ), 'utf8')) as {
    body: unknown;
    sourceTitle: string;
    sourceDescription: string;
    observedAt: string;
    sourceHashMetadata: {
      providerTotal: number;
      returnedCount: number;
      receiptContentSHA: string;
      fixtureBodySHA256: string;
      responseReceipt: string;
      bodyProvenance: string;
    };
  };
  const { sourceTitle, sourceDescription } = receipt;
  const identity = extractProductIdentity(sourceTitle, sourceDescription);
  assert.equal(identity.brand, '');
  const result = parseEbayActiveResults({
    query: sourceTitle.toLocaleLowerCase('en-US'),
    identity,
    observedAt: receipt.observedAt,
    sourceDescription,
    browseJson: receipt.body,
  });

  assert.equal(result.coverage.providerTotal, receipt.sourceHashMetadata.providerTotal);
  assert.equal(result.coverage.returnedCount, receipt.sourceHashMetadata.returnedCount);
  const fixtureBodySHA = createHash('sha256').update(JSON.stringify(receipt.body)).digest('hex');
  assert.equal(receipt.sourceHashMetadata.responseReceipt,
    'artifacts/eight-auction-2026-09-22/verification-20261003u/live-eight-active-asks/response-receipts/lot-06-auctionninja-clearinghouseestatesales-17792-2493977/000001-search.json');
  assert.equal(receipt.sourceHashMetadata.bodyProvenance,
    'Exact JSON-semantic copy of the already sanitized receipt.body; no additional sanitization performed.');
  assert.equal(fixtureBodySHA, receipt.sourceHashMetadata.receiptContentSHA);
  assert.equal(fixtureBodySHA, receipt.sourceHashMetadata.fixtureBodySHA256);
  assert.equal(result.records.length, 167);
  assert.equal(result.accepted.length, 0);
  assert.equal(result.benchmark, null);
  assert.ok(result.rejected.every((record) => record.rejectionReasons.includes(
    'manual-identity-review:decorative-variant-unresolved',
  )));
});

test('uses a structured Brand field only when the fixture description actually contains it', () => {
  const result = parse(
    'A Large Vase By Simon Pearce',
    ['Simon Pearce Vase', 'Simon Pearce Chelsea Vase'],
    'Brand: Simon Pearce\nGood condition. Minor wear. See photos.',
  );

  assert.equal(result.accepted.length, 0);
  assert.ok(result.rejected.every((record) => record.rejectionReasons.includes(
    'manual-identity-review:decorative-variant-unresolved',
  )));
});

test('keeps source-explicit decorative variants comparable only when the variant corresponds', () => {
  const result = parse('Simon Pearce Chelsea Vase', [
    'Simon Pearce Chelsea Vase 8in',
    'Simon Pearce Chelsea Vase 18in',
    'Simon Pearce Chelseashire Vase 8in',
    'Simon Pearce Chelsea Bowl w/ Vase',
  ], 'Brand: Simon Pearce\nStyle: Chelsea\nSize: 8in\nIn good condition.');

  assert.deepEqual(result.accepted.map((record) => record.title), ['Simon Pearce Chelsea Vase 8in']);
  assert.ok(result.rejected.find((record) => record.title === 'Simon Pearce Chelsea Vase 18in')
    ?.rejectionReasons.some((reason) => reason.startsWith('decorative-constraint-mismatch:')));
  assert.ok(result.rejected.find((record) => record.title === 'Simon Pearce Chelseashire Vase 8in')
    ?.rejectionReasons.some((reason) => reason.startsWith('decorative-variant-mismatch:')));
  assert.ok(result.rejected.find((record) => record.title === 'Simon Pearce Chelsea Bowl w/ Vase')
    ?.rejectionReasons.some((reason) => reason.startsWith('decorative-family-mismatch:')));
});

test('treats title-only multi-word maker text as ambiguous, even when it resembles a style', () => {
  const result = parse('Simon Pearce Vase', ['Simon Pearce Chelsea Vase']);
  assert.equal(result.accepted.length, 0);
  assert.ok(result.rejected[0]!.rejectionReasons.includes('manual-identity-review:decorative-variant-unresolved'));
});

test('preserves structured multi-word style and material phrases', () => {
  const result = parse('Lalique Blue Danube Vase', [
    'Lalique Blue Danube Vase Clear Glass',
    'Lalique Blue Vase',
  ], 'Brand: Lalique\nStyle: Blue Danube\nMaterial: clear glass\nGood condition.');

  assert.deepEqual(result.accepted.map((record) => record.title), ['Lalique Blue Danube Vase Clear Glass']);
  assert.ok(result.rejected[0]!.rejectionReasons.some((reason) => reason.startsWith('decorative-variant-mismatch:')));
});

test('allows a single-word maker only when explicitly declared in structured metadata', () => {
  const result = parse('Lalique Hirondelles Vase', [
    'Lalique Hirondelles Vase',
    'Lalique Hirondelles Vase 8inch',
  ], 'Brand: Lalique\nStyle: Hirondelles\nSize: 8in\nGood condition.');

  assert.deepEqual(result.accepted.map((record) => record.title), ['Lalique Hirondelles Vase 8inch']);
});

test('uses explicit style with complete maker attribution, while title-only design text stays manual', () => {
  const result = parse('A Blue Danube Vase By Simon Pearce', [
    'Simon Pearce Blue Danube Vase',
    'Other Maker Blue Danube Vase',
  ], 'Style: Blue Danube\nIn good condition.');

  assert.deepEqual(result.accepted.map((record) => record.title), ['Simon Pearce Blue Danube Vase']);
  assert.ok(result.rejected[0]!.rejectionReasons.some((reason) => reason.startsWith('decorative-maker-mismatch:')));

  const titleOnly = parse('A Blue Danube Vase By Simon Pearce', ['Simon Pearce Blue Danube Vase'], 'In good condition.');
  assert.equal(titleOnly.accepted.length, 0);
  assert.ok(titleOnly.rejected[0]!.rejectionReasons.includes('manual-identity-review:decorative-variant-unresolved'));
});

test('does not promote generic clear glass and size evidence into a design anchor', () => {
  const result = parse('A Clear Glass Vase By Simon Pearce', [
    'Simon Pearce Chelsea Vase 8inch',
    'Simon Pearce Woodbury Vase 8inch',
    'Simon Pearce Hartland Vase 8inch',
  ], 'In good condition with minor wear. See all photos for condition and size details.');

  assert.equal(result.accepted.length, 0);
  assert.ok(result.rejected.every((record) => record.rejectionReasons.includes(
    'manual-identity-review:decorative-variant-unresolved',
  )));
});

test('ignores unsupported Model and Style placeholders even when candidates repeat them', () => {
  const placeholders = ['N/A', 'Unknown', 'SeePhotos'];
  for (const field of ['Model', 'Style']) {
    for (const placeholder of placeholders) {
      const result = parse(
        'A Large Vase By Simon Pearce',
        [`Simon Pearce Chelsea Vase ${placeholder}`],
        `${field}: ${placeholder}\nIn good condition.`,
      );
      assert.equal(result.accepted.length, 0, `${field}:${placeholder}`);
      assert.ok(result.rejected[0]!.rejectionReasons.includes(
        'manual-identity-review:decorative-variant-unresolved',
      ), `${field}:${placeholder}`);
    }
  }
});

test('does not apply the decorative guard to electronics', () => {
  const result = parse('Canon 5D Camera', [
    'Canon 5D Camera Body',
    'Canon 5D Camera Pair of Bodies',
  ], 'Brand: Canon\nModel: 5D\nGood condition. Fully tested and working.');

  assert.equal(result.accepted.length, 1);
  assert.equal(result.accepted[0]!.title, 'Canon 5D Camera Body');
  assert.ok(result.rejected[0]!.rejectionReasons.includes('quantity-mismatch') === false);
});
