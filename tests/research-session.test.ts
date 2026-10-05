import assert from 'node:assert/strict';
import test from 'node:test';
import { buildResearchSessionManifest, reconcileResearchBatch, reconcileResearchSession, type ResearchQueueRow } from '../src/intelligence/research-session.js';

const row = (sourceId: string, extra: Partial<ResearchQueueRow> = {}): ResearchQueueRow => ({ sourceId, mode: 'item', query: `item ${sourceId}`, ...extra });
const base = (queue: ResearchQueueRow[]) => buildResearchSessionManifest({ sourceUrl: 'https://auction.test/route', routeFingerprint: 'route-v1', queue, sessionStartedAt: new Date(Date.now() - 10_000).toISOString() });
const attemptedAt = new Date(Date.now() - 1_000).toISOString();
const observedAt = new Date(Date.now()).toISOString();
const publicSoldUrl = (sourceId: string) => `https://www.ebay.com/sch/i.html?_nkw=${sourceId}&LH_Sold=1&LH_Complete=1`;
const attempt = (sourceId: string, outcome: 'executed' | 'blocked-after-attempt' = 'executed', extra = {}) => ({ sourceId, outcome, actualQueryUrl: publicSoldUrl(sourceId), displayedQuery: sourceId, attemptedAt, observedAt, finalUrl: publicSoldUrl(sourceId), contentObservationRef: `sold results observed for ${(extra as { actualQueryUrl?: string }).actualQueryUrl || publicSoldUrl(sourceId)}`, accessObservation: outcome === 'blocked-after-attempt' ? 'challenge screen observed at source URL' : undefined, observedStatus: 'settled' as const, observedResultCount: 1, attemptSource: 'ebay-public-sold' as const, ...extra });
const unattempted = (sourceId: string, extra = {}) => ({ sourceId, outcome: 'unattempted' as const, ...extra });

test('builds 100 ordered records into batches of eight', () => {
  const manifest = base(Array.from({ length: 100 }, (_, index) => row(String(index + 1))));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.sourceIds.length, 100);
  assert.equal(manifest.batches.length, 13);
  assert.equal(manifest.batches[12]!.sourceIds.length, 4);
});

test('rejects duplicate source IDs', () => assert.throws(() => base([row('a'), row('a')]), /duplicate sourceId/));

test('distinguishes justified informational exclusions from unsearchable merchandise', () => {
  const manifest = base([
    row('info', { mode: 'unsearchable', nonMerchandiseReason: 'pickup instructions only', query: undefined }),
    row('merch', { mode: 'unsearchable', query: undefined }),
  ]);
  assert.deepEqual(manifest.informationalExclusions, [{ sourceId: 'info', reason: 'pickup instructions only' }]);
  assert.deepEqual(manifest.merchandiseIds, ['merch']);
});

test('preserves shared query applicability per source', () => {
  const manifest = base([
    row('a', { query: 'shared query', queryGroupId: 'group-1' }),
    row('b', { query: 'shared query', queryGroupId: 'group-1' }),
  ]);
  assert.deepEqual(manifest.queryGroups, [{ queryGroupId: 'group-1', query: 'shared query', sourceIds: ['a', 'b'] }]);
  assert.equal(reconcileResearchSession(manifest, [attempt('a', 'executed', { queryGroupId: 'group-1', applicabilityConfirmed: true }), attempt('b', 'executed', { queryGroupId: 'group-1', applicabilityConfirmed: true })]).searchAttemptCoverageComplete, true);
});

test('keeps grouped unattempted checkpoints incomplete without applicability confirmation', () => {
  const manifest = base([
    row('a', { query: 'shared query', queryGroupId: 'group-1' }),
    row('b', { query: 'shared query', queryGroupId: 'group-1' }),
  ]);
  for (const applicabilityConfirmed of [undefined, false]) {
    const result = reconcileResearchSession(manifest, [
      unattempted('a', { queryGroupId: 'group-1', applicabilityConfirmed }),
      unattempted('b', { queryGroupId: 'group-1', applicabilityConfirmed }),
    ]);
    assert.equal(result.searchAttemptCoverageComplete, false);
    assert.deepEqual(result.remainingSourceIds, ['a', 'b']);
    assert.equal(result.counts.unattempted, 2);
  }
});

test('keeps mixed confirmed execution and grouped unattempted work partial', () => {
  const manifest = base([
    row('a', { query: 'shared query', queryGroupId: 'group-1' }),
    row('b', { query: 'shared query', queryGroupId: 'group-1' }),
  ]);
  const result = reconcileResearchSession(manifest, [
    attempt('a', 'executed', { queryGroupId: 'group-1', applicabilityConfirmed: true }),
    unattempted('b', { queryGroupId: 'group-1', applicabilityConfirmed: false }),
  ]);
  assert.equal(result.searchAttemptCoverageComplete, false);
  assert.deepEqual(result.completedSourceIds, ['a']);
  assert.deepEqual(result.remainingSourceIds, ['b']);
});

test('rejects invalid groups and fabricated unattempted evidence', () => {
  const manifest = base([
    row('a', { query: 'shared query', queryGroupId: 'group-1' }),
    row('b', { query: 'shared query', queryGroupId: 'group-1' }),
  ]);
  assert.throws(() => reconcileResearchSession(manifest, [unattempted('a', { queryGroupId: 'wrong-group' })]), /query group is not applicable/);
  assert.throws(() => reconcileResearchSession(manifest, [unattempted('a', {
    queryGroupId: 'group-1',
    actualQueryUrl: publicSoldUrl('a'),
    contentObservationRef: 'fabricated evidence',
  })]), /unattempted rows must not contain/);
});

test('still requires applicability confirmation for executed shared observations', () => {
  const manifest = base([
    row('a', { query: 'shared query', queryGroupId: 'group-1' }),
    row('b', { query: 'shared query', queryGroupId: 'group-1' }),
  ]);
  assert.throws(() => reconcileResearchSession(manifest, [attempt('a', 'executed', {
    queryGroupId: 'group-1',
    applicabilityConfirmed: false,
  })]), /shared query requires per-source applicability confirmation/);
});

test('reports one of 98 executed as 97 remaining', () => {
  const manifest = base(Array.from({ length: 98 }, (_, index) => row(String(index + 1))));
  const result = reconcileResearchSession(manifest, [attempt('1')]);
  assert.equal(result.remainingSourceIds.length, 97);
  assert.equal(result.counts.unattempted, 97);
  assert.equal(result.searchAttemptCoverageComplete, false);
});

test('requires an approved sold URL, source type, and contemporaneous timestamp', () => {
  const manifest = base([row('a')]);
  assert.throws(() => reconcileResearchSession(manifest, [{ sourceId: 'a', outcome: 'executed', actualQueryUrl: publicSoldUrl('a'), attemptSource: 'ebay-public-sold' }]), /attemptedAt/);
  assert.throws(() => reconcileResearchSession(manifest, [{ ...attempt('a'), actualQueryUrl: 'https://search.test/a' }]), /eBay URL/);
  assert.throws(() => reconcileResearchSession(manifest, [{ ...attempt('a'), actualQueryUrl: 'https://www.ebay.com/sch/i.html?LH_Sold=1&LH_Complete=1' }]), /sold completed/);
  assert.throws(() => reconcileResearchSession(manifest, [{ ...attempt('a'), observedAt: undefined }]), /observedAt/);
  assert.throws(() => reconcileResearchSession(manifest, [{ ...attempt('a'), observedStatus: 'access-blocked' }]), /explicit reason/);
  assert.throws(() => reconcileResearchSession(manifest, [{ ...attempt('a'), attemptedAt: new Date(Date.now() + 6 * 60 * 1000).toISOString() }]), /future/);
  assert.throws(() => reconcileResearchSession(manifest, [{ ...attempt('a'), observedAt: new Date(Date.now() - 6 * 60 * 1000).toISOString() }]), /precede/);
  assert.throws(() => reconcileResearchSession(manifest, [{ ...attempt('a'), attemptSource: undefined }]), /attemptSource/);
});

test('does not credit ledger observations from before the research session start', () => {
  const manifest = base([row('a')]);
  const stale = attempt('a', 'executed', {
    attemptedAt: '2020-01-01T00:00:00.000Z',
    observedAt: '2020-01-01T00:01:00.000Z',
  });
  assert.throws(() => reconcileResearchSession(manifest, [stale]), /predates research session start/);
});

test('allows legacy manifests without session-start provenance for deliberate historical replay', () => {
  const manifest = { ...base([row('a')]), sessionStartedAt: undefined };
  const historical = attempt('a', 'executed', {
    attemptedAt: '2020-01-01T00:00:00.000Z',
    observedAt: '2020-01-01T00:01:00.000Z',
  });
  assert.equal(reconcileResearchSession(manifest, [historical]).searchAttemptCoverageComplete, true);
});

test('malformed session-start provenance cannot masquerade as a legacy manifest', () => {
  const manifest = base([row('a')]);
  for (const value of ['', null]) {
    assert.throws(() => reconcileResearchSession({ ...manifest, sessionStartedAt: value as string }, [attempt('a')]), /sessionStartedAt/);
  }
});

test('requires the observed final URL to remain on the requested sold surface and query', () => {
  const manifest = base([row('a')]);
  for (const finalUrl of [
    'https://www.ebay.com/',
    'https://www.ebay.com/sch/i.html?_nkw=a&LH_Active=1',
    'https://www.ebay.com/sch/i.html?_nkw=other&LH_Sold=1&LH_Complete=1',
  ]) {
    assert.throws(() => reconcileResearchSession(manifest, [attempt('a', 'executed', { finalUrl })]), /observed final URL/);
  }
});

test('retains requested and visibly corrected public Sold queries without crediting an unexplained redirect', () => {
  const manifest = base([row('a')]);
  const corrected = {
    ...attempt('a', 'executed', {
      executedQuery: 'a',
      displayedQuery: 'alpha',
      finalUrl: publicSoldUrl('alpha'),
      queryNormalizationEvidence: "eBay visibly replaced submitted 'a' with 'alpha' on the Sold results page.",
    }),
  };
  assert.equal(reconcileResearchSession(manifest, [corrected]).searchAttemptCoverageComplete, true);
  assert.equal(reconcileResearchSession(manifest, [{ ...corrected, finalUrl: publicSoldUrl('a') }]).searchAttemptCoverageComplete, true);
  assert.throws(() => reconcileResearchSession(manifest, [{ ...corrected, queryNormalizationEvidence: undefined }]), /displayed-query confirmation/);
  assert.throws(() => reconcileResearchSession(manifest, [{ ...corrected, executedQuery: 'different' }]), /displayed-query confirmation/);
  assert.throws(() => reconcileResearchSession(manifest, [{ ...corrected, finalUrl: publicSoldUrl('unrelated') }]), /displayed-query confirmation/);
  assert.throws(() => reconcileResearchSession(manifest, [{ ...corrected, finalUrl: 'https://www.ebay.com/sch/i.html?_nkw=alpha&LH_Active=1' }]), /observed final URL/);
});

test('accepts explicitly identified Seller Hub Product Research Sold attempts separately', () => {
  const manifest = base([row('a')]);
  const result = reconcileResearchSession(manifest, [{
    sourceId: 'a', outcome: 'executed', actualQueryUrl: 'https://www.ebay.com/sh/research?marketplace=EBAY-US&tabName=SOLD', executedQuery: 'brand model', displayedQuery: 'brand model', attemptedAt, observedAt,
    finalUrl: 'https://www.ebay.com/sh/research?marketplace=EBAY-US&tabName=SOLD', observedStatus: 'settled', observedResultCount: 1,
    contentObservationRef: 'Seller Hub results observed',
    attemptSource: 'ebay-seller-hub-product-research-sold', observedPaidProofLater: false,
  }]);
  assert.equal(result.searchAttemptCoverageComplete, true);
});

test('rejects Seller Hub active tabs and blank executed queries', () => {
  const manifest = base([row('a')]);
  const sellerAttempt = { sourceId: 'a', outcome: 'executed' as const, actualQueryUrl: 'https://www.ebay.com/sh/research?tabName=ACTIVE', executedQuery: 'brand model', displayedQuery: 'brand model', attemptedAt, observedAt, finalUrl: 'https://www.ebay.com/sh/research?tabName=ACTIVE', contentObservationRef: 'results observed', observedStatus: 'settled' as const, observedResultCount: 1, attemptSource: 'ebay-seller-hub-product-research-sold' as const };
  assert.throws(() => reconcileResearchSession(manifest, [sellerAttempt]), /tabName=SOLD/);
  assert.throws(() => reconcileResearchSession(manifest, [{ ...sellerAttempt, actualQueryUrl: 'https://www.ebay.com/sh/research?tabName=SOLD', finalUrl: 'https://www.ebay.com/sh/research?tabName=SOLD', executedQuery: '   ' }]), /nonblank executed query/);
});

test('requires observation evidence and per-source shared-query applicability', () => {
  const manifest = base([row('a', { query: 'shared', queryGroupId: 'shared' }), row('b', { query: 'shared', queryGroupId: 'shared' })]);
  assert.throws(() => reconcileResearchSession(manifest, [attempt('a', 'executed', { queryGroupId: 'shared' }), attempt('b', 'executed', { queryGroupId: 'shared', applicabilityConfirmed: true })]), /per-source applicability/);
  assert.throws(() => reconcileResearchSession(manifest, [attempt('a', 'executed', { observedStatus: 'settled', observedResultCount: undefined }), attempt('b', 'executed', { applicabilityConfirmed: true })]), /result count/);
});

test('requires displayed query and content evidence before crediting executed coverage', () => {
  const manifest = base([row('a')]);
  const metadataOnly = { sourceId: 'a', outcome: 'executed' as const, actualQueryUrl: publicSoldUrl('a'), attemptedAt, observedAt, finalUrl: publicSoldUrl('a'), observedStatus: 'settled' as const, observedResultCount: 1, attemptSource: 'ebay-public-sold' as const };
  assert.throws(() => reconcileResearchSession(manifest, [metadataOnly]), /displayed-query confirmation/);
  assert.throws(() => reconcileResearchSession(manifest, [attempt('a', 'executed', { displayedQuery: 'other' })]), /displayed-query confirmation/);
  assert.throws(() => reconcileResearchSession(manifest, [attempt('a', 'executed', { contentObservationRef: undefined })]), /content-observation reference/);
  const blocked = reconcileResearchSession(manifest, [attempt('a', 'blocked-after-attempt', { contentObservationRef: undefined, observedStatus: 'access-blocked', observedResultCount: null, accessBlockedReason: 'challenge page observed' })]);
  assert.equal(blocked.searchAttemptCoverageComplete, true);
  assert.throws(() => reconcileResearchSession(manifest, [attempt('a', 'blocked-after-attempt', { accessObservation: undefined, observedStatus: 'access-blocked', observedResultCount: null, accessBlockedReason: 'challenge page observed' })]), /observed access evidence/);
});

test('distinct positive-results searches cannot reuse one generic observation note', () => {
  const manifest = base([row('a'), row('b')]);
  const generic = 'Rendered eBay Sold + Completed page; results observed.';
  assert.throws(() => reconcileResearchSession(manifest, [
    attempt('a', 'executed', { contentObservationRef: generic }),
    attempt('b', 'executed', { contentObservationRef: generic }),
  ]), /distinct content-observation references/);
  assert.equal(reconcileResearchSession(manifest, [attempt('a'), attempt('b')]).searchAttemptCoverageComplete, true);
});

test('cannot bypass shared-query applicability by omitting queryGroupId', () => {
  const manifest = base([
    row('a', { query: 'shared', queryGroupId: 'shared' }),
    row('b', { query: 'shared', queryGroupId: 'shared' }),
  ]);
  const shared = attempt('a', 'executed', { actualQueryUrl: publicSoldUrl('shared'), displayedQuery: 'shared', finalUrl: publicSoldUrl('shared') });
  const reused = { ...shared, sourceId: 'b' };
  assert.throws(() => reconcileResearchSession(manifest, [shared, reused]), /per-source applicability/);
  const result = reconcileResearchSession(manifest, [
    { ...shared, applicabilityConfirmed: true },
    { ...reused, applicabilityConfirmed: true },
  ]);
  assert.equal(result.searchAttemptCoverageComplete, true);
});

test('loading and error observations cannot complete search-attempt coverage', () => {
  const manifest = base([row('a')]);
  assert.throws(() => reconcileResearchSession(manifest, [attempt('a', 'executed', { observedStatus: 'loading', observedResultCount: null })]), /settled or empty/);
  assert.throws(() => reconcileResearchSession(manifest, [attempt('a', 'executed', { observedStatus: 'error', observedResultCount: null })]), /settled or empty/);
  const blocked = reconcileResearchSession(manifest, [attempt('a', 'blocked-after-attempt', { observedStatus: 'access-blocked', observedResultCount: null, accessBlockedReason: 'challenge page observed' })]);
  assert.equal(blocked.searchAttemptCoverageComplete, true);
  assert.throws(() => reconcileResearchSession(manifest, [attempt('a', 'blocked-after-attempt', { observedStatus: 'error', observedResultCount: null, accessBlockedReason: 'not an access block' })]), /access-blocked observation/);
});

test('empty observations cannot contain results and an empty manifest is not research coverage', () => {
  const manifest = base([row('a')]);
  assert.throws(() => reconcileResearchSession(manifest, [attempt('a', 'executed', {
    observedStatus: 'empty', observedResultCount: 1,
  })]), /empty observations require zero results/);
  assert.equal(reconcileResearchSession(base([]), []).searchAttemptCoverageComplete, false);
});

test('catalog discovery cannot be credited as merchandise research before expansion', () => {
  const manifest = base([row('sale-1', { mode: 'catalog-discovery', query: undefined })]);
  assert.deepEqual(manifest.catalogDiscoveryIds, ['sale-1']);
  assert.deepEqual(manifest.merchandiseIds, []);
  assert.equal(reconcileResearchSession(manifest, []).searchAttemptCoverageComplete, false);
  assert.throws(() => reconcileResearchSession(manifest, [attempt('sale-1')]), /must expand into item records/);
});

test('all-terminal coverage is complete and deferred work is not', () => {
  const manifest = base([row('a'), row('b'), row('info', { mode: 'unsearchable', nonMerchandiseReason: 'administrative notice', query: undefined })]);
  const complete = reconcileResearchSession(manifest, [attempt('a'), attempt('b', 'blocked-after-attempt', { observedStatus: 'access-blocked', observedResultCount: null, accessBlockedReason: 'challenge page observed' }), { sourceId: 'info', outcome: 'excluded-informational' }]);
  assert.equal(complete.searchAttemptCoverageComplete, true);
  const incomplete = reconcileResearchSession(manifest, [attempt('a'), { sourceId: 'b', outcome: 'deferred' }, { sourceId: 'info', outcome: 'excluded-informational' }]);
  assert.deepEqual(incomplete.remainingSourceIds, ['b']);
});

test('rejects unknown IDs and requires stable identity for repeated source attempts', () => {
  const manifest = base([row('a')]);
  assert.throws(() => reconcileResearchSession(manifest, [attempt('x')]), /unknown ledger sourceId/);
  assert.throws(() => reconcileResearchSession(manifest, [attempt('a', 'executed', { attemptId: 'first' }), attempt('a', 'executed', { attemptId: 'renamed' })]), /duplicate observation identity/);
});

test('allows a real retry only with a distinct time and retry reason', () => {
  const manifest = base([row('a')]);
  const first = attempt('a', 'executed', { attemptId: 'a-query-1' });
  const retry = attempt('a', 'executed', {
    attemptId: 'a-query-2',
    attemptedAt: new Date(Date.now() - 500).toISOString(),
    observedAt: new Date(Date.now() + 100).toISOString(),
    retryReason: 'initial results timed out; retried after reload',
  });
  assert.equal(reconcileResearchSession(manifest, [first, retry]).counts.executed, 2);
  assert.throws(() => reconcileResearchSession(manifest, [first, { ...retry, retryReason: undefined }]), /retry reason/);
});

test('preserves multiple query attempts while aggregating completion by source', () => {
  const manifest = base([row('a')]);
  const first = attempt('a', 'executed', {
    attemptId: 'a-query-1',
    actualQueryUrl: publicSoldUrl('first'), displayedQuery: 'first',
    finalUrl: publicSoldUrl('first'),
  });
  const second = attempt('a', 'executed', {
    attemptId: 'a-query-2',
    actualQueryUrl: publicSoldUrl('second'), displayedQuery: 'second',
    finalUrl: publicSoldUrl('second'),
  });
  const result = reconcileResearchSession(manifest, [first, second]);
  assert.equal(result.searchAttemptCoverageComplete, true);
  assert.deepEqual(result.completedSourceIds, ['a']);
  assert.equal(result.counts.executed, 2);
  assert.throws(() => reconcileResearchSession(manifest, [first, { ...second, attemptId: 'a-query-1' }]), /duplicate attemptId/);
});

test('batch reconciliation credits only selected IDs without auction-wide completion', () => {
  const manifest = base([
    row('info', { mode: 'unsearchable', nonMerchandiseReason: 'auction notice', query: undefined }),
    ...Array.from({ length: 10 }, (_, index) => row(String(index + 1))),
  ]);
  const incomplete = reconcileResearchBatch(manifest, 1, [
    { sourceId: 'info', outcome: 'excluded-informational' },
    attempt('1'),
  ]);
  assert.equal(incomplete.masterSourceCount, 11);
  assert.deepEqual(incomplete.sourceIds, manifest.batches[0]!.sourceIds);
  assert.deepEqual(incomplete.completedSourceIds, ['info', '1']);
  assert.deepEqual(incomplete.remainingSourceIds, ['2', '3', '4', '5', '6', '7']);
  assert.equal(incomplete.searchAttemptCoverageComplete, false);

  const complete = reconcileResearchBatch(manifest, 1, [
    { sourceId: 'info', outcome: 'excluded-informational' },
    ...Array.from({ length: 7 }, (_, index) => attempt(String(index + 1))),
  ]);
  assert.equal(complete.searchAttemptCoverageComplete, true);
  assert.deepEqual(complete.remainingSourceIds, []);
  assert.equal(reconcileResearchSession(manifest, [
    { sourceId: 'info', outcome: 'excluded-informational' },
    ...Array.from({ length: 7 }, (_, index) => attempt(String(index + 1))),
  ]).searchAttemptCoverageComplete, false);
});

test('batch reconciliation rejects out-of-batch rows and invalid evidence', () => {
  const manifest = base(Array.from({ length: 10 }, (_, index) => row(String(index + 1))));
  assert.throws(() => reconcileResearchBatch(manifest, 99, []), /unknown research batch/);
  assert.throws(() => reconcileResearchBatch(manifest, 1, [attempt('9')]), /outside the selected batch/);
  assert.throws(() => reconcileResearchBatch(manifest, 1, [attempt('1', 'executed', { observedResultCount: null })]), /nonnegative result count/);
});
