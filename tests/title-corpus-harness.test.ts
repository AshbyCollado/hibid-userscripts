import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTitleMutations,
  evaluateTitleCorpusRecord,
  parseTitleCorpusJsonl,
  runTitleCorpus,
  type TitleCorpusRecord,
} from '../src/testing/title-corpus.js';

const base: TitleCorpusRecord = {
  provider: 'hibid',
  eventItemId: '317882346',
  auctionId: '769459',
  title: 'Magcubic 4K Smart Projector WiFi Bluetooth',
  description: 'Condition: New - Packaging Flawed',
  category: 'Computers & Electronics - Projectors',
  currency: 'USD',
  sourceUrl: 'https://hibid.com/lot/317882346',
};

test('title corpus JSONL parser requires stable public identity fields', () => {
  assert.deepEqual(parseTitleCorpusJsonl(`${JSON.stringify(base)}\n`), [base]);
  assert.throws(() => parseTitleCorpusJsonl('{"provider":"hibid"}\n'), /line 1/);
});

test('title mutation generator is deterministic and includes all wrapper classes', () => {
  const mutations = buildTitleMutations(base.title);
  assert.deepEqual(mutations.map((entry) => entry.name), [
    'lot-prefix', 'lot-no-prefix', 'bare-lot-label', 'item-prefix', 'bare-item-label',
    'stock-prefix', 'inventory-prefix',
    'bare-number-prefix', 'online-auction-prefix', 'each-prefix', 'lot-quantity-prefix',
    'parenthesized-quantity-prefix', 'retail-prefix', 'condition-prefix', 'condition-suffix',
    'no-reserve-suffix', 'pickup-suffix', 'see-photos-suffix', 'exact-duplicate',
    'duplicate-condition-tail', 'boundary-duplicate', 'html-entities', 'numeric-html-spaces',
    'unicode-dash', 'nonbreaking-space', 'zero-width', 'fullwidth', 'quoted',
    'whitespace', 'multiline-whitespace',
  ]);
});

test('clean product titles satisfy structural Amazon and eBay link gates', () => {
  const issues = evaluateTitleCorpusRecord(base);
  assert.deepEqual(issues.filter((entry) => entry.severity === 'error'), []);
});

test('corpus runner deduplicates stable IDs and reports deterministic metrics', () => {
  const report = runTitleCorpus([base, { ...base }], { seed: 123, mutationRounds: 40 });
  assert.equal(report.records, 1);
  assert.equal(report.distinctRecords, 1);
  assert.equal(report.mutationChecks, 40);
  assert.equal(report.errorCount, 0);
  assert.equal(report.seed, 123);
});

test('seeded composed mutations are reproducible and exercise more than the fixed taxonomy', () => {
  const first = runTitleCorpus([base], { seed: 9876, mutationRounds: 96 });
  const second = runTitleCorpus([base], { seed: 9876, mutationRounds: 96 });
  assert.equal(first.mutationChecks, 96);
  assert.deepEqual(first.issueCounts, second.issueCounts);
  assert.deepEqual(first.issues, second.issues);
});

test('administrative titles are measured separately from product query failures', () => {
  const record = { ...base, eventItemId: '1', title: 'WELCOME TO NJX AUCTIONS' };
  const issues = evaluateTitleCorpusRecord(record);
  assert.equal(issues.some((entry) => entry.code === 'administrative-query'), true);
  assert.equal(issues.some((entry) => entry.code === 'empty-product-query'), false);
});

test('structured models cannot be shadowed by leading warehouse batch codes', () => {
  const report = runTitleCorpus([{
    provider: 'hibid',
    eventItemId: 'batch-model',
    title: 'J3 18 x 18 in. Steel Return Air Grille, White',
    description: 'Brand: Everbilt\nModel: E17018X18',
  }], { mutationRounds: 0 });
  assert.equal(report.issueCounts['structured-model-shadowed'] || 0, 0);
});

test('issue totals include findings beyond the retained diagnostic sample', () => {
  const report = runTitleCorpus([
    { ...base, eventItemId: 'warning-first', title: 'WELCOME TO NJX AUCTIONS' },
    { ...base, eventItemId: 'error-after-cap', title: 'Auction' },
  ], { mutationRounds: 0, maxIssues: 1 });

  assert.equal(report.issues.length, 1);
  assert.equal(report.warningCount, 1);
  assert.equal(report.errorCount, 1);
  assert.equal(report.issueCounts['administrative-query'], 1);
  assert.equal(report.issueCounts['empty-product-query'], 1);
});
