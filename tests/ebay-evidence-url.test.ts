import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assessEbayEvidenceUrl,
  classifyEbayEvidenceUrl,
  isVerifiedEbaySoldComp,
  type IndependentEbaySoldEvidence,
  type ManualEstimateProvenance,
} from '../src/intelligence/ebay-evidence-url.js';

const independentSoldEvidence: IndependentEbaySoldEvidence = {
  kind: 'independent-sold-evidence',
  source: 'rendered-sold-listing',
  itemId: '123456789012',
};

const manualEstimate: ManualEstimateProvenance = {
  kind: 'manual-estimate',
  amountUsd: 125,
};

test('Sold and Completed searches are research seeds, never verified sold comps by URL alone', () => {
  const url = 'https://www.ebay.com/sch/i.html?_nkw=onkyo+tx-sr304&LH_Sold=1&LH_Complete=1';
  assert.deepEqual(classifyEbayEvidenceUrl(url), {
    kind: 'sold-search-seed',
    normalizedUrl: url,
    rejectionReason: null,
  });

  const assessment = assessEbayEvidenceUrl(url, independentSoldEvidence);
  assert.equal(assessment.kind, 'not-verified');
  assert.equal(assessment.verifiedSoldComp, false);
});

test('ordinary searches and active Seller Hub routes classify as active', () => {
  const urls = [
    'https://www.ebay.com/sch/i.html?_nkw=onkyo+tx-sr304',
    'https://www.ebay.com/sch/i.html?_nkw=onkyo&LH_Sold=1',
    'https://www.ebay.com/sh/lst/active',
    'https://www.ebay.com/sh/lst?status=ACTIVE',
  ];

  for (const url of urls) assert.equal(classifyEbayEvidenceUrl(url).kind, 'active', url);
});

test('active listings cannot be promoted to verified sold comps by supplied sold provenance', () => {
  const assessment = assessEbayEvidenceUrl(
    'https://www.ebay.com/sh/lst/active?query=onkyo',
    { kind: 'independent-sold-evidence', source: 'seller-hub-sold-record', itemId: '123456789012' },
  );
  assert.equal(assessment.urlClassification.kind, 'active');
  assert.equal(assessment.verifiedSoldComp, false);
  assert.equal(isVerifiedEbaySoldComp(assessment), false);
});

test('item URLs remain unknown-state listings without independent sold evidence', () => {
  const url = 'https://www.ebay.com/itm/Onkyo-TX-SR304-Receiver/123456789012';
  assert.equal(classifyEbayEvidenceUrl(url).kind, 'listing-unknown-state');

  const urlOnly = assessEbayEvidenceUrl(url);
  assert.equal(urlOnly.kind, 'not-verified');
  assert.equal(urlOnly.verifiedSoldComp, false);

  const estimated = assessEbayEvidenceUrl(url, manualEstimate);
  assert.equal(estimated.urlClassification.kind, 'listing-unknown-state');
  assert.equal(estimated.verifiedSoldComp, false);
});

test('an item URL becomes a verified sold comp only with independent sold evidence', () => {
  const assessment = assessEbayEvidenceUrl(
    'https://www.ebay.com/itm/123456789012',
    independentSoldEvidence,
  );
  assert.equal(isVerifiedEbaySoldComp(assessment), true);
  assert.equal(assessment.kind, 'verified-sold-comp');
  assert.equal(assessment.verifiedSoldComp, true);
  assert.equal(assessment.provenance.source, 'rendered-sold-listing');
});

test('independent sold provenance must name the same canonical item ID', () => {
  const url = 'https://www.ebay.com/itm/222222222222';
  const mismatched = assessEbayEvidenceUrl(url, independentSoldEvidence);
  assert.equal(mismatched.verifiedSoldComp, false);
  const matched = assessEbayEvidenceUrl(url, { ...independentSoldEvidence, itemId: '222222222222' });
  assert.equal(matched.verifiedSoldComp, true);
});

test('empty, malformed, non-eBay, lookalike, and unsupported eBay URLs are rejected', () => {
  const cases = [
    ['', 'empty-url'],
    ['   ', 'empty-url'],
    ['not a url', 'invalid-url'],
    ['javascript:https://www.ebay.com/itm/123456789012', 'unsupported-protocol'],
    ['https://example.com/itm/123456789012', 'non-ebay-url'],
    ['https://ebay.com.example.org/itm/123456789012', 'non-ebay-url'],
    ['https://www.ebay.com/', 'unsupported-ebay-url'],
  ] as const;

  for (const [url, rejectionReason] of cases) {
    assert.deepEqual(classifyEbayEvidenceUrl(url), {
      kind: 'rejected',
      normalizedUrl: null,
      rejectionReason,
    }, url || '<empty>');
  }
});
