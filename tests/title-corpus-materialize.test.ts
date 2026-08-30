import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import {
  CATEGORY_MAX_CHARS,
  CORPUS_VERSION,
  DEFAULT_SELECTION_COUNT,
  DEFAULT_SELECTION_SEED,
  DESCRIPTION_MAX_CHARS,
  SANITIZER_VERSION,
  TITLE_MAX_CHARS,
  materializeTitleCorpus,
  projectPublicLot,
  sanitizePublicText,
  type PublicLotCorpusManifest,
  type PublicLotCorpusRecord,
} from '../scripts/title-corpus/materialize.js';

const fixtureUrl = new URL('./fixtures/title-corpus/public-lots-v1.jsonl.gz', import.meta.url);
const manifestUrl = new URL('./fixtures/title-corpus/public-lots-v1.manifest.json', import.meta.url);
const sourcePath = path.resolve('artifacts/title-corpus/hibid-public-raw.jsonl');
const allowedKeys = new Set(['provider', 'eventItemId', 'auctionId', 'title', 'description', 'category']);
const forbiddenTextPatterns = [
  /<\/?[A-Za-z!][^>]*>/u,
  /\b(?:(?:https?|ftp):\/\/|www\.|mailto:|tel:)/iu,
  /\butm_[a-z]+=/iu,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/iu,
  /(?<!\d)(?:\+?1[\s.-]*)?(?:\(\s*\d{3}\s*\)|\d{3})[\s.-]*\d{3}[\s.-]*\d{4}(?!\d)/u,
  /\[(?:redacted|removed)[^\]]*\]/iu,
  /\b(?:authorization|bearer\s+token|session\s*(?:id|token)|password|passcode|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|private\s+notes?|customer\s+(?:id|e-?mail|phone|notes?)|account\s+(?:state|status|number|id|e-?mail|balance)|bidder\s+(?:id|number)|credit\s+card)\b/iu,
  /\b(?:contact\s+(?:us|me|the seller)|e-?mail\s+(?:us|me|the seller)|call\s+(?:us|me|the seller|ahead)|text\s+(?:us|me|the seller)|reach\s+(?:us|me)|for\s+inquir(?:y|ies)|pickup\s+address|mailing\s+address)\b/iu,
  /\bP\.?\s*O\.?\s+Box\s+\d+/iu,
  /\b\d{1,6}\s+(?:[A-Za-z0-9.'-]+\s+){0,6}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Circle|Cir|Highway|Hwy|Parkway|Pkwy|Trail|Trl|Way|Place|Pl)\b/iu,
] as const;

function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function rawLot(eventItemId: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    provider: 'hibid',
    eventItemId,
    auctionId: '9001',
    title: `Public lot ${eventItemId}`,
    description: `Public description ${eventItemId}`,
    category: 'Tools',
    sourceUrl: `https://hibid.com/lot/${eventItemId}?utm_source=ignored`,
    ...overrides,
  };
}

function jsonl(records: Array<Record<string, unknown>>): string {
  return `${records.map((record) => JSON.stringify(record)).join('\n')}\n`;
}

function parseFixture(value: string): PublicLotCorpusRecord[] {
  return value.trimEnd().split(/\r?\n/u).map((line) => JSON.parse(line) as PublicLotCorpusRecord);
}

test('public projection is a strict allowlist with sanitized, bounded text', () => {
  const record = projectPublicLot(rawLot('123', {
    title: '<b>Acme &amp; Co.</b> 18V Drill<script>private title</script>',
    description: [
      '<p>18V cordless drill with two batteries.</p>',
      '<p>Contact us at owner@example.com or (212) 555-0199.</p>',
      '<p>Auction desk: another@example.com.</p>',
      '<p>Manual: https://example.com/drill?utm_source=auction</p>',
      '<p>Specs: manuals.example.xyz/drill?utm_campaign=auction</p>',
      '<p>Pickup from 123 Main Street, Albany, NY 12207.</p>',
      '<p>Account status: preferred bidder.</p>',
    ].join(''),
    category: '<em>Power Tools &amp; Equipment</em>',
    accountState: { bidderId: 'private-bidder' },
    cookies: 'session=private-cookie',
    headers: { authorization: 'Bearer private-token' },
    privateNotes: 'do not publish',
    contact: 'owner@example.com',
  }));

  assert.ok(record);
  assert.deepEqual(Object.keys(record), ['provider', 'eventItemId', 'auctionId', 'title', 'description', 'category']);
  assert.equal(record.provider, 'hibid');
  assert.equal(record.title, 'Acme & Co. 18V Drill');
  assert.equal(record.category, 'Power Tools & Equipment');
  assert.match(record.description || '', /18V cordless drill with two batteries/u);
  const serialized = JSON.stringify(record);
  for (const secret of ['private title', 'owner@example.com', 'Auction desk', '212', 'example.com', 'example.xyz', 'utm_', '123 Main', 'Account status', 'private-bidder', 'private-cookie', 'private-token', 'do not publish']) {
    assert.doesNotMatch(serialized, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'iu'));
  }
});

test('text sanitizer decodes entities, drops executable markup, and truncates on Unicode characters', () => {
  const source = `<p>Camera &amp; lens</p><style>hidden</style><script>secret()</script>${' boxed'.repeat(100)} \ud83d\udcf7`;
  const result = sanitizePublicText(source, 80);
  assert.match(result, /^Camera & lens/u);
  assert.doesNotMatch(result, /hidden|secret|<|>/u);
  assert.ok(Array.from(result).length <= 80);
  assert.doesNotMatch(result, /[\ud800-\udfff]$/u);
});

test('selection and duplicate resolution are deterministic across source ordering', () => {
  const records = [
    rawLot('1'),
    rawLot('2', { title: 'Zulu duplicate' }),
    rawLot('2', { title: 'Alpha duplicate' }),
    rawLot('3'),
    rawLot('4'),
    rawLot('5'),
    rawLot('6'),
    rawLot('7', { private: true }),
  ];
  const forward = materializeTitleCorpus(jsonl(records), { selectionCount: 6, selectionSeed: 'test-seed' });
  const reverse = materializeTitleCorpus(jsonl([...records].reverse()), { selectionCount: 6, selectionSeed: 'test-seed' });

  assert.equal(forward.content, reverse.content);
  assert.deepEqual(forward.artifact, reverse.artifact);
  assert.deepEqual(forward.records, reverse.records);
  assert.equal(forward.records.find((record) => record.eventItemId === '2')?.title, 'Alpha duplicate');
  assert.deepEqual(forward.manifest.counts, {
    sourceRecords: 8,
    eligibleRecords: 7,
    rejectedRecords: 1,
    duplicateRecords: 1,
    distinctEligibleRecords: 6,
    requestedRecords: 6,
    selectedRecords: 6,
    descriptionsIncluded: 6,
    categoriesIncluded: 6,
  });
  assert.notEqual(forward.manifest.sourceHash, reverse.manifest.sourceHash);
  assert.equal(forward.manifest.contentHash, hash(forward.content));
  assert.equal(forward.manifest.contentBytes, Buffer.byteLength(forward.content, 'utf8'));
  assert.equal(forward.manifest.artifactHash, hash(forward.artifact));
  assert.equal(forward.manifest.artifactBytes, forward.artifact.byteLength);
  assert.throws(
    () => materializeTitleCorpus(jsonl(records), { selectionCount: 7 }),
    /only 6 distinct eligible records/u,
  );
});

test('tracked public corpus matches its manifest and privacy contract', async () => {
  const [artifact, manifestText] = await Promise.all([
    readFile(fixtureUrl),
    readFile(manifestUrl, 'utf8'),
  ]);
  const content = gunzipSync(artifact).toString('utf8');
  const manifest = JSON.parse(manifestText) as PublicLotCorpusManifest;
  const records = parseFixture(content);
  const ids = records.map((record) => record.eventItemId);

  assert.equal(content.endsWith('\n'), true);
  assert.equal(records.length, DEFAULT_SELECTION_COUNT);
  assert.equal(new Set(ids).size, records.length);
  assert.deepEqual(ids, [...ids].sort());
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.corpusVersion, CORPUS_VERSION);
  assert.equal(manifest.format, 'jsonl+gzip');
  assert.equal(manifest.selectionSeed, DEFAULT_SELECTION_SEED);
  assert.equal(manifest.selectionAlgorithm, 'sha256-v1');
  assert.equal(manifest.sanitizerVersion, SANITIZER_VERSION);
  assert.equal(manifest.contentHash, hash(content));
  assert.equal(manifest.contentBytes, Buffer.byteLength(content, 'utf8'));
  assert.equal(manifest.artifactHash, hash(artifact));
  assert.equal(manifest.artifactBytes, artifact.byteLength);
  assert.equal(manifest.counts.selectedRecords, records.length);
  assert.equal(manifest.counts.requestedRecords, DEFAULT_SELECTION_COUNT);
  assert.ok(records.length >= 3_000);

  for (const [index, record] of records.entries()) {
    assert.deepEqual(Object.keys(record).every((key) => allowedKeys.has(key)), true, `unexpected key at line ${index + 1}`);
    assert.equal(record.provider, 'hibid');
    assert.match(record.eventItemId, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
    assert.match(record.auctionId, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u);
    assert.ok(record.title);
    assert.ok(Array.from(record.title).length <= TITLE_MAX_CHARS);
    assert.ok(Array.from(record.description || '').length <= DESCRIPTION_MAX_CHARS);
    assert.ok(Array.from(record.category || '').length <= CATEGORY_MAX_CHARS);
    const publicText = [record.title, record.description || '', record.category || ''].join(' ');
    for (const pattern of forbiddenTextPatterns) {
      assert.doesNotMatch(publicText, pattern, `forbidden text at line ${index + 1}`);
    }
  }
});

test('tracked corpus is reproducible from the ignored raw artifact when available', async (t) => {
  if (!existsSync(sourcePath)) {
    t.skip('raw public artifact is not present in this checkout');
    return;
  }
  const [source, trackedArtifact, trackedManifestText] = await Promise.all([
    readFile(sourcePath),
    readFile(fixtureUrl),
    readFile(manifestUrl, 'utf8'),
  ]);
  const trackedManifest = JSON.parse(trackedManifestText) as PublicLotCorpusManifest;
  const materialized = materializeTitleCorpus(source, {
    selectionCount: trackedManifest.counts.requestedRecords,
    selectionSeed: trackedManifest.selectionSeed,
    sourceLabel: trackedManifest.source,
    outputLabel: trackedManifest.output,
  });

  assert.deepEqual(materialized.artifact, trackedArtifact);
  assert.deepEqual(materialized.manifest, trackedManifest);
});
