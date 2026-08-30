import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  buildProductResearchQuery,
  evaluateRetailCandidate,
  extractProductIdentity,
  hasSufficientRetailIdentity,
} from '../src/intelligence/us-deal-intelligence.js';

const REQUIRED_CATEGORIES = [
  'medical',
  'industrial-controls',
  'lab-equipment',
  'restaurant-equipment',
  'automotive',
  'books-isbns',
  'collectibles',
  'gpus-pc-parts',
  'appliances',
  'audio',
  'cameras',
  'tools',
  'ambiguous-bundles',
] as const;

type RareProductCategory = typeof REQUIRED_CATEGORIES[number];

interface RareProductIdentityCase {
  id: string;
  category: RareProductCategory;
  sourceTitle: string;
  queryIncludes: string[];
  queryExcludes: string[];
  acceptedCandidates: string[];
  rejectedCandidates: string[];
}

interface RareProductIdentityFixture {
  schemaVersion: number;
  cases: RareProductIdentityCase[];
}

const fixtureUrl = new URL(
  './fixtures/title-corpus/rare-product-identity.json',
  import.meta.url,
);
const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8')) as RareProductIdentityFixture;

test('rare-product identity fixture is broad and internally valid', () => {
  assert.equal(fixture.schemaVersion, 1);
  assert.ok(fixture.cases.length >= 60, `expected at least 60 cases, found ${fixture.cases.length}`);

  const ids = fixture.cases.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length, 'fixture case IDs must be unique');
  const sourceTitles = fixture.cases.map(({ sourceTitle }) => sourceTitle);
  assert.equal(new Set(sourceTitles).size, sourceTitles.length, 'source titles must be unique');

  const categoryCounts = new Map<RareProductCategory, number>();
  for (const entry of fixture.cases) {
    assert.match(entry.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${entry.id}: invalid case ID`);
    assert.ok(REQUIRED_CATEGORIES.includes(entry.category), `${entry.id}: unsupported category ${entry.category}`);
    assert.ok(entry.sourceTitle.trim(), `${entry.id}: sourceTitle is required`);
    assert.ok(entry.queryIncludes.length > 0, `${entry.id}: queryIncludes is required`);
    assert.ok(entry.queryExcludes.length > 0, `${entry.id}: queryExcludes is required`);
    assert.ok(entry.acceptedCandidates.length > 0, `${entry.id}: acceptedCandidates is required`);
    assert.ok(entry.rejectedCandidates.length > 0, `${entry.id}: rejectedCandidates is required`);

    const allCandidates = [...entry.acceptedCandidates, ...entry.rejectedCandidates];
    assert.equal(new Set(allCandidates).size, allCandidates.length, `${entry.id}: candidate titles must be unique`);
    for (const fragment of [...entry.queryIncludes, ...entry.queryExcludes]) {
      assert.equal(fragment, fragment.trim().toLowerCase(), `${entry.id}: query fragments must be trimmed lowercase`);
      assert.ok(fragment, `${entry.id}: query fragments cannot be empty`);
    }
    for (const candidate of allCandidates) assert.ok(candidate.trim(), `${entry.id}: candidate titles cannot be empty`);
    categoryCounts.set(entry.category, (categoryCounts.get(entry.category) || 0) + 1);
  }

  for (const category of REQUIRED_CATEGORIES) {
    assert.ok((categoryCounts.get(category) || 0) >= 5, `expected at least five ${category} cases`);
  }
});

test('source titles retain rare-product query identity', async (t) => {
  for (const entry of fixture.cases) {
    await t.test(entry.id, () => {
      const identity = extractProductIdentity(entry.sourceTitle);
      const query = identity.query.toLowerCase();

      assert.equal(
        hasSufficientRetailIdentity(identity),
        true,
        `[${entry.id}] matcher reported insufficient source identity: ${JSON.stringify(identity)}`,
      );
      assert.ok(query, `[${entry.id}] source query is empty`);
      assert.ok(query.length <= 120, `[${entry.id}] source query is ${query.length} characters: ${query}`);
      assert.equal(
        buildProductResearchQuery(query),
        query,
        `[${entry.id}] source query is not idempotent`,
      );
      for (const fragment of entry.queryIncludes) {
        assert.ok(query.includes(fragment), `[${entry.id}] query is missing "${fragment}": ${query}`);
      }
      for (const fragment of entry.queryExcludes) {
        assert.ok(!query.includes(fragment), `[${entry.id}] query retained "${fragment}": ${query}`);
      }
    });
  }
});

test('accepted titles preserve the source product identity', async (t) => {
  for (const entry of fixture.cases) {
    for (const [index, candidate] of entry.acceptedCandidates.entries()) {
      await t.test(`${entry.id}-accepted-${index + 1}`, () => {
        const identity = extractProductIdentity(entry.sourceTitle);
        const evaluation = evaluateRetailCandidate(candidate, identity);
        assert.equal(
          evaluation.accepted,
          true,
          `[${entry.id}] expected acceptance for "${candidate}": ${JSON.stringify(evaluation)}`,
        );
      });
    }
  }
});

test('rejected titles cannot impersonate the source product', async (t) => {
  for (const entry of fixture.cases) {
    for (const [index, candidate] of entry.rejectedCandidates.entries()) {
      await t.test(`${entry.id}-rejected-${index + 1}`, () => {
        const identity = extractProductIdentity(entry.sourceTitle);
        const evaluation = evaluateRetailCandidate(candidate, identity);
        assert.equal(
          evaluation.accepted,
          false,
          `[${entry.id}] expected rejection for "${candidate}": ${JSON.stringify(evaluation)}`,
        );
      });
    }
  }
});
