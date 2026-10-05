import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateRetailCandidate, extractProductIdentity, matchAmazonCandidates } from '../src/intelligence/us-deal-intelligence.js';
import { verifyEbaySoldCompSet, type EbaySoldRecord, type EbaySoldSearchAttempt } from '../src/intelligence/ebay-sold-results.js';

const observedAt = '2026-10-04T12:00:00.000Z';
function soldRecord(itemId: string, title: string): EbaySoldRecord {
  return { source: 'seller-hub-product-research', sourceUrl: 'https://www.ebay.com/sh/research?keywords=keurig&tabName=SOLD', observedAt, itemId, itemUrl: `https://www.ebay.com/itm/${itemId}`, title, imageUrl: null, soldPrice: { amount: 60, currency: 'USD' }, shippingPrice: { amount: 0, currency: 'USD' }, deliveredPrice: { amount: 60, currency: 'USD' }, totalSold: 1, totalSales: { amount: 60, currency: 'USD' }, soldAt: 'Oct 1, 2026', condition: 'Used', format: 'Fixed price', priceKind: 'actual', provenance: { kind: 'independent-sold-evidence', source: 'seller-hub-sold-record', itemId } };
}
function soldAttempt(query: string, records: EbaySoldRecord[]): EbaySoldSearchAttempt {
  return { source: 'seller-hub-product-research', sourceUrl: 'https://www.ebay.com/sh/research?keywords=keurig&tabName=SOLD', query, observedAt, status: 'ok', records, hasNextPage: false, pageOffset: 0, pageLimit: 50, failureReason: null };
}

const title = '$127 Keurig K-Select Single-Serve Coffee Maker';
const description = 'Brand: Keurig\nCondition: Open Box - Tested\nFunctional?: Yes\nModel: K-Select Coffee Maker\nNotes: Used will need to be clean Not in box\n52 oz reservoir; 6/8/10/12 oz brew sizes';

test('Keurig K-Select is recovered from title and structured description', () => {
  const product = extractProductIdentity({ title, description });
  assert.equal(product.model, 'K-Select');
  assert.match(product.query, /keurig k-select/i);
  assert.equal(evaluateRetailCandidate('Keurig K-Select Single-Serve Coffee Maker', product).accepted, true);
  const wrong = evaluateRetailCandidate('Keurig K-Compact Single-Serve K-Cup Pod Coffee Maker, 36oz Reservoir', product);
  assert.equal(wrong.accepted, false);
  assert.match(wrong.rejectionReasons.join(' '), /model-mismatch:K-Select/);
});

test('Keurig named models preserve case and spacing variants but do not harden generic sources', () => {
  const product = extractProductIdentity('Keurig K-Select Coffee Maker');
  assert.equal(product.model, 'K-Select');
  for (const candidate of ['keurig k select coffee maker', 'KEURIG K-SELECT coffee maker', 'Keurig KSelect Coffee Maker']) assert.equal(evaluateRetailCandidate(candidate, product).accepted, true, candidate);
  const generic = extractProductIdentity('Keurig Single-Serve Coffee Maker');
  assert.equal(generic.model, null);
  assert.equal(evaluateRetailCandidate('Keurig Single-Serve Coffee Maker', generic).accepted, true);
});

test('Keurig K family guard applies to Amazon and sold evidence', () => {
  const product = extractProductIdentity({ title, description });
  const amazon = matchAmazonCandidates([
    { asin: 'compact', title: '$69.99 Keurig K-Compact Single-Serve K-Cup Pod Coffee Maker, 36oz Reservoir', price: 69.99, used: false, sponsored: false, url: 'https://amazon.test/compact' },
    { asin: 'select', title: 'Keurig K-Select Single-Serve Coffee Maker', price: 127, used: false, sponsored: false, url: 'https://amazon.test/select' },
  ], product);
  assert.equal(amazon?.candidate.asin, 'select');
  const query = product.query;
  const sold = verifyEbaySoldCompSet(product, [soldAttempt(query, [soldRecord('100000001', 'Keurig K-Select Single-Serve Coffee Maker'), soldRecord('100000002', 'Keurig K-Compact Single-Serve Coffee Maker')])], { plannedQueries: [query], minimumSampleSize: 1 });
  assert.deepEqual(sold.accepted.map((record) => record.itemId), ['100000001']);
  assert.equal(sold.rejected.find((record) => record.itemId === '100000002')?.reasons.some((reason) => /model-mismatch:K-Select/.test(reason)), true);
});

test('Keurig named suffixes remain exact identities across spacing and compact forms', () => {
  const mini = extractProductIdentity('Keurig K-Mini Coffee Maker');
  const miniPlus = extractProductIdentity('Keurig K-Mini Plus Coffee Maker');
  assert.equal(mini.model, 'K-Mini');
  assert.equal(miniPlus.model, 'K-Mini Plus');
  assert.equal(evaluateRetailCandidate('Keurig K-Mini Plus Coffee Maker', mini).accepted, false);
  assert.equal(evaluateRetailCandidate('Keurig K-Mini Coffee Maker', miniPlus).accepted, false);
  assert.equal(extractProductIdentity('Keurig K-Supreme-Plus Coffee Maker').model, 'K-Supreme Plus');
  assert.equal(extractProductIdentity('Keurig KSupremePlus Coffee Maker').model, 'K-Supreme Plus');
  assert.equal(evaluateRetailCandidate('Keurig KSupremePlus Coffee Maker', extractProductIdentity('Keurig K-Supreme Plus Coffee Maker')).accepted, true);
  assert.equal(evaluateRetailCandidate('Keurig K-Supreme Coffee Maker', extractProductIdentity('Keurig K-Supreme Plus Coffee Maker')).accepted, false);
});

test('Keurig compatibility targets do not become primary identity, and accessories stay negative', () => {
  assert.equal(extractProductIdentity('Keurig Coffee Maker compatible with K-Select').model, null);
  assert.equal(extractProductIdentity('Keurig Coffee Maker', 'Brand: Keurig\nModel: Compatible with K-Select').model, null);
  const product = extractProductIdentity('Keurig K-Select Coffee Maker');
  assert.equal(evaluateRetailCandidate('Keurig K-Select reusable filter compatible with coffee maker', product).accepted, false);
  assert.equal(evaluateRetailCandidate('Keurig Single-Serve Coffee Maker', extractProductIdentity('Keurig Single-Serve Coffee Maker')).accepted, true);
});

test('Keurig title and structured model conflicts block both directions, while equivalent forms agree', () => {
  for (const [title, structured, candidateTitle] of [
    ['Keurig K-Select Coffee Maker', 'K-Compact Coffee Maker', 'Keurig K-Select Coffee Maker'],
    ['Keurig K-Compact Coffee Maker', 'K-Select Coffee Maker', 'Keurig K-Compact Coffee Maker'],
  ]) {
    const product = extractProductIdentity({ title, description: `Brand: Keurig\nModel: ${structured}` });
    assert.equal(product.model, null);
    assert.equal(matchAmazonCandidates([{ asin: 'conflict', title: candidateTitle, price: 127, used: false, sponsored: false, url: 'https://amazon.test/conflict' }], product), null);
    const query = product.query;
    const sold = verifyEbaySoldCompSet(product, [soldAttempt(query, [soldRecord(`conflict-${title.includes('Select') ? 'select' : 'compact'}`, candidateTitle)])], { plannedQueries: [query], minimumSampleSize: 1 });
    assert.deepEqual(sold.accepted, []);
    assert.match(sold.rejected[0]?.reasons.join(' ') || '', /identity-conflict:keurig-named-model-source/);
  }
  const equivalent = extractProductIdentity({ title: 'Keurig KSupremePlus Coffee Maker', description: 'Brand: Keurig\nModel: K-Supreme-Plus Coffee Maker' });
  assert.equal(equivalent.model, 'K-Supreme Plus');
  assert.equal(evaluateRetailCandidate('Keurig K-Supreme Plus Coffee Maker', equivalent).accepted, true);
});

test('Keurig sold verification rejects base and Plus comps in both directions', () => {
  for (const [sourceTitle, matchingTitle, wrongTitle] of [
    ['Keurig K-Mini Coffee Maker', 'Keurig K-Mini Coffee Maker', 'Keurig K-Mini Plus Coffee Maker'],
    ['Keurig K-Mini Plus Coffee Maker', 'Keurig K-Mini Plus Coffee Maker', 'Keurig K-Mini Coffee Maker'],
  ]) {
    const product = extractProductIdentity(sourceTitle);
    const query = product.query;
    const idPrefix = sourceTitle.includes('Plus') ? '20000000' : '30000000';
    const sold = verifyEbaySoldCompSet(product, [soldAttempt(query, [soldRecord(`${idPrefix}1`, matchingTitle), soldRecord(`${idPrefix}2`, wrongTitle)])], { plannedQueries: [query], minimumSampleSize: 1 });
    assert.deepEqual(sold.accepted.map((record) => record.title), [matchingTitle]);
  }
});

test('Keurig collects every primary assertion and blocks ambiguous retail and sold evidence', () => {
  const cases = [
    ['Keurig K-Select Coffee Maker compatible with travel mugs. This is a K-Compact coffee maker.', '', 'K-Select', 'K-Compact'],
    ['Keurig K-Select Coffee Maker', 'This coffee maker is a K-Compact.', 'K-Select', 'K-Compact'],
    ['Keurig K-Compact Coffee Maker', 'This coffee maker is a K-Select.', 'K-Compact', 'K-Select'],
    ['Keurig K-Select Coffee Maker', 'Model: K-Select / K-Compact', 'K-Select', 'K-Compact'],
    ['Keurig K-Compact Coffee Maker', 'This is a K-Select coffee maker.', 'K-Compact', 'K-Select'],
    ['Keurig K-Select Coffee Maker', 'This is a K-Compact coffee maker.', 'K-Select', 'K-Compact'],
  ] as const;
  for (const [sourceTitle, description, sourceModel, conflictingModel] of cases) {
    const product = extractProductIdentity({ title: sourceTitle, description });
    assert.equal(product.model, null, `${sourceTitle} / ${description}`);
    assert.equal(product.discriminators.variantLabels.includes('keurig-named-model:source-conflict'), true);
    const retail = evaluateRetailCandidate(`Keurig ${sourceModel} Coffee Maker`, product);
    assert.equal(retail.accepted, false);
    assert.match(retail.rejectionReasons.join(' '), /identity-conflict:keurig-named-model-source/);
    const query = product.query;
    const sold = verifyEbaySoldCompSet(product, [soldAttempt(query, [soldRecord('400000001', `Keurig ${conflictingModel} Coffee Maker`)])], { plannedQueries: [query], minimumSampleSize: 1 });
    assert.deepEqual(sold.accepted, []);
    assert.match(sold.rejected[0]?.reasons.join(' ') || '', /identity-conflict:keurig-named-model-source/);
  }
});

test('Keurig rejects ambiguous candidate assertions, ignores bare compatibility targets, and accepts equivalent repetitions', () => {
  const product = extractProductIdentity('Keurig K-Select Coffee Maker');
  const ambiguousCandidate = evaluateRetailCandidate('Keurig K-Select Coffee Maker. This is a K-Compact coffee maker.', product);
  assert.equal(ambiguousCandidate.accepted, false);
  assert.match(ambiguousCandidate.rejectionReasons.join(' '), /identity-conflict:keurig-named-model-candidate/);
  assert.equal(evaluateRetailCandidate('Keurig K-Select Coffee Maker compatible with travel mugs. This is a K-Compact coffee maker.', product).accepted, false);
  assert.equal(extractProductIdentity('Keurig Coffee Maker for K-Select').model, null);
  assert.equal(evaluateRetailCandidate('Keurig Coffee Maker for K-Select', product).accepted, false);

  const equivalent = extractProductIdentity({
    title: 'Keurig K-Select Coffee Maker',
    description: 'Model: K-Select\nThis is a K-Select coffee maker.',
  });
  assert.equal(equivalent.model, 'K-Select');
  assert.equal(equivalent.discriminators.variantLabels.includes('keurig-named-model:source-conflict'), false);

  const compatibility = extractProductIdentity({
    title: 'Keurig K-Select Coffee Maker',
    description: 'This is a K-Select coffee maker compatible with K-Compact.',
  });
  assert.equal(compatibility.model, 'K-Select');
  assert.equal(compatibility.discriminators.variantLabels.includes('keurig-named-model:source-conflict'), false);
});
