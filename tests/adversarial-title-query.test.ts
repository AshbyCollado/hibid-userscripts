import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildEbaySoldQuery } from '../scripts/legacy-ebay-query.mjs';
import {
  buildProductResearchQuery,
  buildRetailLinks,
} from '../src/intelligence/us-deal-intelligence.js';

interface TitleQueryCase {
  id: string;
  tags: string[];
  title: string;
  expectedQuery: string;
}

interface TitleQueryFixture {
  schemaVersion: number;
  cases: TitleQueryCase[];
}

const REQUIRED_TAGS = [
  'model-x-tokens',
  'unicode-entities',
  'duplicate-blocks',
  'inventory-wrappers',
  'dimensions-resolutions',
  'package-vs-auction-quantity',
  'condition-wrappers',
  'industrial',
  'medical',
  'automotive',
  'books',
  'collectibles',
  'appliance-parts',
  'gpus',
  'consoles',
  'empty-identity',
] as const;

const fixtureUrl = new URL(
  './fixtures/title-corpus/adversarial-title-query.json',
  import.meta.url,
);
const fixture = JSON.parse(await readFile(fixtureUrl, 'utf8')) as TitleQueryFixture;

test('adversarial title fixture is broad, explicit, and internally valid', () => {
  assert.equal(fixture.schemaVersion, 1);
  assert.ok(fixture.cases.length >= 50, `expected at least 50 cases, found ${fixture.cases.length}`);

  const ids = fixture.cases.map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length, 'fixture case IDs must be unique');

  for (const entry of fixture.cases) {
    assert.match(entry.id, /^[a-z0-9]+(?:-[a-z0-9]+)*$/, `${entry.id}: invalid case ID`);
    assert.ok(Array.isArray(entry.tags) && entry.tags.length > 0, `${entry.id}: tags are required`);
    assert.equal(typeof entry.title, 'string', `${entry.id}: title must be a string`);
    assert.equal(typeof entry.expectedQuery, 'string', `${entry.id}: expectedQuery must be a string`);
    assert.ok(entry.expectedQuery.length <= 120, `${entry.id}: fixture oracle exceeds 120 characters`);
  }

  const coveredTags = new Set(fixture.cases.flatMap(({ tags }) => tags));
  for (const tag of REQUIRED_TAGS) assert.ok(coveredTags.has(tag), `missing required coverage: ${tag}`);
});

test('modern and legacy builders satisfy every exact query oracle', async (t) => {
  for (const entry of fixture.cases) {
    await t.test(entry.id, () => {
      const actual = {
        modern: buildProductResearchQuery(entry.title),
        legacy: buildEbaySoldQuery(entry.title),
      };
      assert.deepEqual(actual, {
        modern: entry.expectedQuery,
        legacy: entry.expectedQuery,
      });
    });
  }
});

test('query parity, idempotence, and length invariants hold for every adversarial case', async (t) => {
  for (const entry of fixture.cases) {
    await t.test(entry.id, () => {
      const modern = buildProductResearchQuery(entry.title);
      const legacy = buildEbaySoldQuery(entry.title);

      assert.equal(modern, legacy, 'modern and legacy query builders diverged');
      assert.ok(modern.length <= 120, `query is ${modern.length} characters`);
      assert.deepEqual({
        modernSecondPass: buildProductResearchQuery(modern),
        legacySecondPass: buildEbaySoldQuery(legacy),
      }, {
        modernSecondPass: modern,
        legacySecondPass: legacy,
      }, 'query builders must be idempotent');
    });
  }
});

test('Amazon and eBay links preserve equal queries and required eBay filters', async (t) => {
  for (const entry of fixture.cases) {
    await t.test(entry.id, () => {
      const modern = buildProductResearchQuery(entry.title);

      const links = buildRetailLinks(modern);
      assert.equal(links.amazon, links.amazonUrl, 'Amazon compatibility aliases diverged');
      assert.equal(links.ebay, links.ebayUrl, 'eBay compatibility aliases diverged');

      if (entry.expectedQuery === '') {
        assert.deepEqual(links, { amazon: '', ebay: '', amazonUrl: '', ebayUrl: '' });
        return;
      }

      assert.ok(links.amazon, 'non-empty identity must have an Amazon URL');
      assert.ok(links.ebay, 'non-empty identity must have an eBay URL');
      const amazon = new URL(links.amazon);
      const ebay = new URL(links.ebay);
      const amazonQuery = amazon.searchParams.get('k');
      const ebayQuery = ebay.searchParams.get('_nkw');

      assert.equal(amazonQuery, modern, 'Amazon URL query differs from the normalized identity');
      assert.equal(ebayQuery, modern, 'eBay URL query differs from the normalized identity');
      assert.equal(amazonQuery, ebayQuery, 'Amazon and eBay URL queries differ');
      assert.equal(ebay.searchParams.get('LH_Sold'), '1', 'eBay Sold filter is missing');
      assert.equal(ebay.searchParams.get('LH_Complete'), '1', 'eBay Completed filter is missing');
    });
  }
});
