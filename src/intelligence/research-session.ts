export const RESEARCH_SESSION_SCHEMA_VERSION = 1 as const;
export const RESEARCH_SESSION_BATCH_SIZE = 8 as const;

export const COMPONENT_RESEARCH_CONTRACT = `Component-review is still merchandise research: an absent queryGroupId, blank query, or null plannedURL means only that no lot-level plan exists; it NEVER waives the research requirement or permits researchComplete. Extract identifiable components from the description and reviewed physical photos, then research each with an identity-bound actual query tied to the lot's sourceId. Truly unidentified components remain explicit unresolved records with the reason; never fabricate an access failure, zero matches, or generic comps/prices.
For each identifiable component, record its distinguishing maker/artist/author, model, edition/year and quantity when visible, and join its actual search attemptIds or explicit unresolved reason. Before concluding no suitable comps, search the distinguishing identity discovered in photos or description; two generic title searches are not a substitute. Keep different editions/years and plausible spelling variants separate, retain submitted versus displayed queries, and never transfer one component's evidence to an unresearched component. Missing these identity-informed searches keeps research incomplete even if every photo was viewed.
Use the required attemptLedger, photoReviews, photoAudit and soldProof field names, not substitute arrays. photoAudit must be ONE aggregate object, never an array: expectedPhysicalPhotoRows, opened, reviewed and accessFailures are numeric batch totals reconciled to photoReviews. Put any optional per-lot photo summaries in a separate field. Never estimate, round or backfill individual event timestamps after browsing; read the clock before each source/search/photo navigation and again after its observed content settles. If an action-time clock read was missed, retain null and mark that evidence deferred/uncredited rather than inventing a time or using the after-action reading for both fields. An original sold-evidence URL must be the observed eBay item URL, not the auction source URL. Unverified candidate observations belong in candidateReview, not soldProof.
Checkpoint each observation before navigating away: retain the before-action clock reading and source/attempt ID before the action, then append that action's after-observation reading, literal heading/count, visible facts and evidence reference immediately after inspection. Save the incremental ledger to the available working artifact or file when supported; do not leave a whole batch's provenance only in volatile browser-controller variables or reconstruct it at the end. If control resets, resume from saved rows and explicitly defer missing records. A quoted source heading is preferable to paraphrasing away an exact count; conflicting primary counts keep that search unresolved. This checkpoint is evidence preservation, not permission to stop before the requested research is finished.
Search observation and paid-comp verification are separate checkpoints. A clearly rendered exact Sold+Completed primary count remains known, including zero, even when separate broader cards appear: use outcome executed with observedStatus settled and the positive count, or use executed with observedStatus empty and observedResultCount 0 for a clearly rendered primary zero. Review broader candidates independently for identity and original-item paid proof; broader cards never merge into the exact count, and their presence never erases a known primary count. Only when the primary exact count is actually unavailable, uncertain, conflicting or still loading, use deferred with observedStatus parse-gap or loading and observedResultCount null. Never combine deferred with settled, or null a clearly observed exact count merely because paid evidence is missing. After an empty or wrong-product result, still try one shorter identity-preserving fallback query.
contentObservationRef must say what the specific search actually displayed, not just that it opened. For a settled search, retain its displayed query, Sold/Completed heading and exact count (shape example only: "Sold/Completed query <displayed query>: 3 results in the exact result section"). For a parse gap, retain the actual section text or specific unreadable-count reason (shape example only: "Sold/Completed query <displayed query>: matching fewer words; exact count unavailable"). These examples are not observed evidence and must never be copied as facts. Record broader cards separately from exact results; when unable to distinguish their sections, retain that uncertainty rather than converting it to zero or a settled count. Keep an inspectable search snapshot or screenshot reference when supported and never fabricate one. Original-item observations retain their own actual open/observation times, item URLs and rejection reasons. Report the fallback count from the actual attempt rows, not a blanket claim that every lot received one.
Before concluding that research found no suitable comp, try one shorter identity-preserving Sold query when the first query is empty, unsettled or only yields wrong products; a true empty long query does not waive this fallback. Search recognizable brand/model or maker/object identity instead of keeping every descriptive title word. Every distinct identifiable component still needs its own identity-informed attempt or explicit unresolved reason, including different visible calendar/book editions or years. Use spelling visible on product labels, retain the seller-title spelling conflict, and record any corrected query separately. A challenge is an access limit, not zero results; do not solve it or bypass access controls. A different ordinary, authorized research surface may have different coverage, so record its source and outcome independently without overwriting the blocked attempt.
Separate stock/promotional photos from actual-unit inspection evidence: an intact advertised product does not establish the auction unit's condition or included parts. Retain explicit missing-parts or damage notes even when a generic condition says New(other), and explain contradictions rather than choosing the prettier photo. A model token in an accessory listing does not make that accessory a comparable for the whole product. Open candidate originals before assigning historical paid values: a Sold search card may lead to an active multi-quantity listing whose current asking price and total sold count do not establish a historical transaction price. An expanded original showing or Best Offer leaves the actual paid price unknown unless item-specific actual-payment evidence independently resolves it. Keep these candidates and asking evidence separate from accepted soldProof; never use an auctioneer's retail estimate as resale evidence.`;

export type ResearchQueueMode = 'item' | 'component-review' | 'unsearchable' | 'catalog-discovery';

export interface ResearchQueueRow {
  sourceId: string;
  mode: ResearchQueueMode;
  nonMerchandiseReason?: string;
  query?: string;
  queryGroupId?: string;
}

export interface ResearchSessionManifest {
  schemaVersion: 1;
  /** Present on newly created sessions; absent only for legacy/historical replays. */
  sessionStartedAt?: string;
  sourceUrl: string;
  routeFingerprint: string;
  sourceIds: string[];
  merchandiseIds: string[];
  catalogDiscoveryIds: string[];
  informationalExclusions: Array<{ sourceId: string; reason: string }>;
  batches: Array<{ batchNumber: number; sourceIds: string[] }>;
  queryGroups: Array<{ queryGroupId: string; query: string; sourceIds: string[] }>;
}

export type ResearchLedgerOutcome =
  | 'executed'
  | 'blocked-after-attempt'
  | 'excluded-informational'
  | 'deferred'
  | 'unattempted';

export type ResearchAttemptSource =
  | 'ebay-public-sold'
  | 'ebay-seller-hub-product-research-sold';

export type ResearchObservedStatus =
  | 'settled'
  | 'empty'
  | 'access-blocked'
  | 'loading'
  | 'parse-gap'
  | 'error';

export interface ResearchLedgerEntry {
  sourceId: string;
  /** Required when a source has more than one ledger entry. */
  attemptId?: string;
  outcome: ResearchLedgerOutcome;
  actualQueryUrl?: string;
  executedQuery?: string;
  /** The query visibly shown by the research surface after submission. */
  displayedQuery?: string;
  /** Visible evidence that eBay rewrote a submitted public-search query. */
  queryNormalizationEvidence?: string;
  attemptedAt?: string;
  observedAt?: string;
  finalUrl?: string;
  /** A screenshot/artifact ID or concise, non-secret page observation. */
  contentObservationRef?: string;
  observedStatus?: ResearchObservedStatus;
  observedResultCount?: number | null;
  accessBlockedReason?: string;
  /** Specific non-secret observation explaining an access block. */
  accessObservation?: string;
  retryReason?: string;
  attemptSource?: ResearchAttemptSource;
  observedPaidProofLater?: boolean;
  applicabilityConfirmed?: boolean;
  queryGroupId?: string;
}

export interface ResearchSessionReconciliation {
  /** Search-attempt coverage only; this is not photo, component, sold-proof, or economics completion. */
  searchAttemptCoverageComplete: boolean;
  totalSourceIds: number;
  merchandiseIds: number;
  catalogDiscoveryIds: number;
  completedSourceIds: string[];
  remainingSourceIds: string[];
  counts: {
    executed: number;
    blockedAfterAttempt: number;
    excludedInformational: number;
    deferred: number;
    unattempted: number;
  };
}

export interface ResearchBatchReconciliation {
  batchNumber: number;
  masterSourceCount: number;
  sourceIds: string[];
  completedSourceIds: string[];
  remainingSourceIds: string[];
  searchAttemptCoverageComplete: boolean;
}

function requiredText(value: string, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is required`);
  return value;
}

function parseTimestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  const maxFutureSkewMs = 5 * 60 * 1000;
  if (typeof value !== 'string' || value.trim() === '' || Number.isNaN(parsed)) {
    throw new Error(`${label} must be a valid timestamp`);
  }
  if (parsed > Date.now() + maxFutureSkewMs) throw new Error(`${label} cannot be in the future`);
  return parsed;
}

function parseEbayHttpsUrl(value: string): URL {
  requiredText(value, 'actualQueryUrl');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('actualQueryUrl must be a valid URL'); }
  if (url.protocol !== 'https:') throw new Error('actualQueryUrl must use HTTPS');
  if (url.hostname !== 'ebay.com' && url.hostname !== 'www.ebay.com') throw new Error('actualQueryUrl must be an eBay URL');
  return url;
}

function assertQueryUrl(value: string, source: ResearchAttemptSource | undefined, executedQuery: string | undefined): void {
  const url = parseEbayHttpsUrl(value);
  if (source === 'ebay-public-sold') {
    if (url.pathname !== '/sch/i.html' || !url.searchParams.get('_nkw')?.trim() || url.searchParams.get('LH_Sold') !== '1' || url.searchParams.get('LH_Complete') !== '1') {
      throw new Error('public eBay attempts must be sold completed searches');
    }
  } else if (source === 'ebay-seller-hub-product-research-sold') {
    if (url.pathname !== '/sh/research' || url.searchParams.get('tabName') !== 'SOLD' || !executedQuery?.trim()) {
      throw new Error('Seller Hub Sold attempts require tabName=SOLD and a nonblank executed query');
    }
  } else {
    throw new Error('attemptSource is required for executed research');
  }
}

function assertFinalSoldUrl(
  value: string,
  source: ResearchAttemptSource | undefined,
  actualQueryUrl: string,
  executedQuery: string | undefined,
  displayedQuery: string | undefined,
  queryNormalizationEvidence: string | undefined,
): void {
  const finalUrl = parseEbayHttpsUrl(value);
  const requestedUrl = parseEbayHttpsUrl(actualQueryUrl);
  if (source === 'ebay-public-sold') {
    const finalQuery = finalUrl.searchParams.get('_nkw')?.trim();
    const requestedQuery = requestedUrl.searchParams.get('_nkw')?.trim();
  const observedCorrection = Boolean(queryNormalizationEvidence?.trim()
      && requestedQuery === executedQuery?.trim()
      && finalQuery === displayedQuery?.trim());
    if (finalUrl.pathname !== '/sch/i.html' || !finalQuery || finalUrl.searchParams.get('LH_Sold') !== '1' || finalUrl.searchParams.get('LH_Complete') !== '1' || (finalQuery !== requestedQuery && !observedCorrection)) {
      throw new Error('observed final URL must be the requested public sold search');
    }
  } else if (source === 'ebay-seller-hub-product-research-sold') {
    if (finalUrl.pathname !== '/sh/research' || finalUrl.searchParams.get('tabName') !== 'SOLD' || !executedQuery?.trim()) {
      throw new Error('observed final URL must be Seller Hub Sold with a nonblank executed query');
    }
  }
}

function assertUniqueIds(ids: string[], label: string): void {
  const seen = new Set<string>();
  for (const id of ids) {
    requiredText(id, label);
    if (seen.has(id)) throw new Error(`duplicate ${label}: ${id}`);
    seen.add(id);
  }
}

function assertObservation(entry: ResearchLedgerEntry): void {
  const attempted = parseTimestamp(entry.attemptedAt || '', 'attemptedAt');
  const observed = parseTimestamp(entry.observedAt || '', 'observedAt');
  if (observed + 5 * 60 * 1000 < attempted) throw new Error('observedAt must not precede attemptedAt');
  parseEbayHttpsUrl(entry.finalUrl || '');
  if (!entry.observedStatus || !['settled', 'empty', 'access-blocked', 'loading', 'parse-gap', 'error'].includes(entry.observedStatus)) {
    throw new Error('observedStatus is required and must be recognized');
  }
  if (entry.observedStatus !== 'access-blocked' && entry.observedResultCount === undefined) {
    throw new Error('non-blocked observations require a result count');
  }
  if (entry.observedStatus === 'settled' || entry.observedStatus === 'empty') {
    if (!Number.isInteger(entry.observedResultCount) || (entry.observedResultCount ?? -1) < 0) {
      throw new Error('settled and empty observations require a nonnegative result count');
    }
    if (entry.observedStatus === 'empty' && entry.observedResultCount !== 0) {
      throw new Error('empty observations require zero results');
    }
  }
  if (entry.observedStatus === 'access-blocked' && !entry.accessBlockedReason?.trim()) {
    throw new Error('access-blocked observations require an explicit reason');
  }
  if (entry.observedStatus === 'access-blocked' && !entry.accessObservation?.trim()) {
    throw new Error('access-blocked observations require specific observed access evidence');
  }
}

function expectedDisplayedQuery(entry: ResearchLedgerEntry): string {
  const url = parseEbayHttpsUrl(entry.actualQueryUrl || '');
  if (entry.attemptSource === 'ebay-public-sold') return url.searchParams.get('_nkw')?.trim() || '';
  return entry.executedQuery?.trim() || '';
}

function assertExecutedEvidence(entry: ResearchLedgerEntry): void {
  const expectedQuery = expectedDisplayedQuery(entry);
  const finalQuery = entry.attemptSource === 'ebay-public-sold'
    ? parseEbayHttpsUrl(entry.finalUrl || '').searchParams.get('_nkw')?.trim()
    : undefined;
  const observedCorrection = Boolean(entry.queryNormalizationEvidence?.trim()
    && entry.attemptSource === 'ebay-public-sold'
    && entry.executedQuery?.trim() === expectedQuery
    && (finalQuery === expectedQuery || finalQuery === entry.displayedQuery?.trim()));
  if (!entry.displayedQuery?.trim()
    || (entry.executedQuery?.trim() && entry.attemptSource === 'ebay-public-sold' && entry.executedQuery.trim() !== expectedQuery)
    || (entry.displayedQuery.trim() !== expectedQuery && !observedCorrection)) {
    throw new Error('executed attempts require displayed-query confirmation');
  }
  if (!entry.contentObservationRef?.trim()) {
    throw new Error('executed attempts require a content-observation reference');
  }
}

function assertUnattemptedCheckpoint(entry: ResearchLedgerEntry): void {
  if (entry.attemptedAt?.trim() || entry.observedAt?.trim() || entry.actualQueryUrl?.trim() || entry.finalUrl?.trim()) {
    throw new Error('unattempted rows must not contain timestamps or URLs');
  }
  if (entry.observedResultCount !== undefined && entry.observedResultCount !== null) {
    throw new Error('unattempted rows must not contain a result count');
  }
  if (entry.contentObservationRef?.trim() || entry.displayedQuery?.trim()) {
    throw new Error('unattempted rows must not contain content evidence');
  }
  if (entry.applicabilityConfirmed === true) {
    throw new Error('unattempted rows cannot confirm applicability');
  }
}

function observationIdentity(entry: ResearchLedgerEntry): string | undefined {
  if (!entry.actualQueryUrl || !entry.attemptSource || !entry.attemptedAt || !entry.observedAt) return undefined;
  return [
    entry.sourceId,
    entry.attemptSource,
    entry.actualQueryUrl,
    entry.executedQuery?.trim() || '',
    entry.attemptedAt,
    entry.observedAt,
  ].join('|');
}

function observationQueryIdentity(entry: ResearchLedgerEntry): string | undefined {
  if (!entry.actualQueryUrl || !entry.attemptSource) return undefined;
  return [entry.sourceId, entry.attemptSource, entry.actualQueryUrl, entry.executedQuery?.trim() || ''].join('|');
}

export function buildResearchSessionManifest(input: {
  sourceUrl: string;
  routeFingerprint: string;
  queue: ResearchQueueRow[];
  sessionStartedAt?: string;
}): ResearchSessionManifest {
  const sourceUrl = requiredText(input.sourceUrl, 'sourceUrl');
  const routeFingerprint = requiredText(input.routeFingerprint, 'routeFingerprint');
  const sessionStartedAt = new Date(parseTimestamp(input.sessionStartedAt || new Date().toISOString(), 'sessionStartedAt')).toISOString();
  const queue = input.queue.slice();
  assertUniqueIds(queue.map((row) => row.sourceId), 'sourceId');

  const sourceIds = queue.map((row) => row.sourceId);
  const informationalExclusions: ResearchSessionManifest['informationalExclusions'] = [];
  const merchandiseIds: string[] = [];
  const catalogDiscoveryIds: string[] = [];
  const queryGroups: ResearchSessionManifest['queryGroups'] = [];
  const groups = new Map<string, ResearchSessionManifest['queryGroups'][number]>();

  for (const row of queue) {
    const reason = row.nonMerchandiseReason?.trim();
    const informational = row.mode === 'unsearchable' && Boolean(reason);
    if (row.mode === 'catalog-discovery') {
      if (reason || row.query?.trim()) throw new Error('catalog discovery cannot be excluded or queried as a lot');
      catalogDiscoveryIds.push(row.sourceId);
    } else if (informational) {
      informationalExclusions.push({ sourceId: row.sourceId, reason: reason! });
    } else {
      merchandiseIds.push(row.sourceId);
    }

    if (row.query?.trim()) {
      const query = row.query.trim();
      const queryGroupId = row.queryGroupId?.trim() || `source:${row.sourceId}`;
      const existing = groups.get(queryGroupId);
      if (existing) {
        if (existing.query !== query) throw new Error(`queryGroupId has conflicting queries: ${queryGroupId}`);
        existing.sourceIds.push(row.sourceId);
      } else {
        const group = { queryGroupId, query, sourceIds: [row.sourceId] };
        groups.set(queryGroupId, group);
        queryGroups.push(group);
      }
    }
  }

  const batches = [];
  for (let index = 0; index < sourceIds.length; index += RESEARCH_SESSION_BATCH_SIZE) {
    batches.push({
      batchNumber: batches.length + 1,
      sourceIds: sourceIds.slice(index, index + RESEARCH_SESSION_BATCH_SIZE),
    });
  }

  return {
    schemaVersion: RESEARCH_SESSION_SCHEMA_VERSION,
    sessionStartedAt,
    sourceUrl,
    routeFingerprint,
    sourceIds,
    merchandiseIds,
    catalogDiscoveryIds,
    informationalExclusions,
    batches,
    queryGroups,
  };
}

export function reconcileResearchSession(
  manifest: ResearchSessionManifest,
  ledger: ResearchLedgerEntry[],
): ResearchSessionReconciliation {
  const sessionStartedAt = manifest.sessionStartedAt !== undefined
    ? parseTimestamp(manifest.sessionStartedAt, 'sessionStartedAt')
    : undefined;
  assertUniqueIds(manifest.sourceIds, 'manifest sourceId');
  assertUniqueIds(manifest.merchandiseIds, 'manifest merchandiseId');
  if (manifest.merchandiseIds.some((id) => !manifest.sourceIds.includes(id))) throw new Error('merchandise ID is not in manifest source IDs');
  assertUniqueIds(manifest.catalogDiscoveryIds, 'catalog discovery sourceId');
  if (manifest.catalogDiscoveryIds.some((id) => !manifest.sourceIds.includes(id) || manifest.merchandiseIds.includes(id) || manifest.informationalExclusions.some((entry) => entry.sourceId === id))) {
    throw new Error('catalog discovery ID is not a separate manifest source');
  }
  assertUniqueIds(manifest.informationalExclusions.map((entry) => entry.sourceId), 'informational exclusion sourceId');
  if (manifest.informationalExclusions.some((entry) => !manifest.sourceIds.includes(entry.sourceId) || !entry.reason.trim())) {
    throw new Error('informational exclusion is not justified by the manifest');
  }
  const sourceEntryCounts = new Map<string, number>();
  for (const entry of ledger) sourceEntryCounts.set(entry.sourceId, (sourceEntryCounts.get(entry.sourceId) || 0) + 1);
  const attemptIds = new Set<string>();
  const observationIdentities = new Set<string>();
  const observationQueries = new Map<string, ResearchLedgerEntry>();
  for (const entry of ledger) {
    const identity = observationIdentity(entry);
    if (identity) {
      if (observationIdentities.has(identity)) throw new Error('duplicate observation identity');
      observationIdentities.add(identity);
    }
    const queryIdentity = observationQueryIdentity(entry);
    if (queryIdentity) {
      const previous = observationQueries.get(queryIdentity);
      if (previous && !entry.retryReason?.trim()) {
        throw new Error('repeated observations require a retry reason');
      }
      observationQueries.set(queryIdentity, entry);
    }
    if ((sourceEntryCounts.get(entry.sourceId) || 0) > 1 && !entry.attemptId?.trim()) {
      throw new Error(`multiple ledger entries require a stable attemptId: ${entry.sourceId}`);
    }
    if (entry.attemptId) {
      if (attemptIds.has(entry.attemptId)) throw new Error(`duplicate attemptId: ${entry.attemptId}`);
      attemptIds.add(entry.attemptId);
    }
  }
  const known = new Set(manifest.sourceIds);
  const merchandise = new Set(manifest.merchandiseIds);
  const discovery = new Set(manifest.catalogDiscoveryIds);
  const excluded = new Map(manifest.informationalExclusions.map((entry) => [entry.sourceId, entry.reason]));
  const statuses = new Map<string, ResearchLedgerOutcome>();
  const counts = { executed: 0, blockedAfterAttempt: 0, excludedInformational: 0, deferred: 0, unattempted: 0 };
  const fingerprintUsers = new Map<string, Set<string>>();
  const positiveResultReferences = new Map<string, string>();
  for (const entry of ledger) {
    if (entry.actualQueryUrl && entry.attemptSource) {
      const fingerprint = `${entry.attemptSource}|${entry.actualQueryUrl}|${entry.executedQuery?.trim() || ''}`;
      const users = fingerprintUsers.get(fingerprint) || new Set<string>();
      users.add(entry.sourceId);
      fingerprintUsers.set(fingerprint, users);
    }
  }

  for (const entry of ledger) {
    if (!known.has(entry.sourceId)) throw new Error(`unknown ledger sourceId: ${entry.sourceId}`);
    if (discovery.has(entry.sourceId) && entry.outcome !== 'deferred' && entry.outcome !== 'unattempted') {
      throw new Error(`catalog discovery must expand into item records before research completion: ${entry.sourceId}`);
    }
    if (!['executed', 'blocked-after-attempt', 'excluded-informational', 'deferred', 'unattempted'].includes(entry.outcome)) {
      throw new Error(`invalid ledger outcome: ${entry.outcome}`);
    }
    const isExcluded = excluded.has(entry.sourceId);
    if (entry.outcome === 'excluded-informational') {
      if (!isExcluded) throw new Error(`source is not a justified informational exclusion: ${entry.sourceId}`);
    } else if (isExcluded) {
      throw new Error(`informational exclusion cannot have outcome ${entry.outcome}: ${entry.sourceId}`);
    }
    if (entry.outcome === 'executed' || entry.outcome === 'blocked-after-attempt') {
      assertQueryUrl(entry.actualQueryUrl || '', entry.attemptSource, entry.executedQuery);
      assertObservation(entry);
      if (sessionStartedAt !== undefined
        && (Date.parse(entry.attemptedAt!) < sessionStartedAt || Date.parse(entry.observedAt!) < sessionStartedAt)) {
        throw new Error('ledger observation predates research session start');
      }
      if (entry.outcome === 'executed' && entry.observedStatus !== 'settled' && entry.observedStatus !== 'empty') {
        throw new Error('executed attempts require settled or empty observations');
      }
      if (entry.outcome === 'executed') {
        assertExecutedEvidence(entry);
        assertFinalSoldUrl(entry.finalUrl || '', entry.attemptSource, entry.actualQueryUrl || '', entry.executedQuery, entry.displayedQuery, entry.queryNormalizationEvidence);
        if ((entry.observedResultCount || 0) > 0) {
          const reference = entry.contentObservationRef!.trim();
          const priorUrl = positiveResultReferences.get(reference);
          if (priorUrl && priorUrl !== entry.actualQueryUrl) {
            throw new Error('distinct positive-results searches require distinct content-observation references');
          }
          positiveResultReferences.set(reference, entry.actualQueryUrl!);
        }
      }
      if (entry.outcome === 'blocked-after-attempt' && (entry.observedStatus !== 'access-blocked' || !entry.accessBlockedReason?.trim())) {
        throw new Error('blocked-after-attempt requires an access-blocked observation with a reason');
      }
    } else if (entry.outcome === 'unattempted') {
      assertUnattemptedCheckpoint(entry);
    }
    let group = entry.queryGroupId
      ? manifest.queryGroups.find((candidate) => candidate.queryGroupId === entry.queryGroupId)
      : undefined;
    if (entry.queryGroupId && (!group || !group.sourceIds.includes(entry.sourceId))) {
      throw new Error(`query group is not applicable to source: ${entry.sourceId}`);
    }
    if (!group && entry.actualQueryUrl && entry.attemptSource) {
      const fingerprint = `${entry.attemptSource}|${entry.actualQueryUrl}|${entry.executedQuery?.trim() || ''}`;
      const reusedBy = fingerprintUsers.get(fingerprint);
      group = manifest.queryGroups.find((candidate) => {
        if (!candidate.sourceIds.includes(entry.sourceId)) return false;
        const queryMatches = candidate.query === entry.executedQuery?.trim();
        let urlQueryMatches = false;
        try {
          urlQueryMatches = candidate.query === new URL(entry.actualQueryUrl!).searchParams.get('_nkw')?.trim();
        } catch { /* URL validation below reports malformed attempt URLs. */ }
        return queryMatches || urlQueryMatches || Boolean(reusedBy && reusedBy.size > 1 && candidate.sourceIds.some((id) => reusedBy.has(id)));
      });
    }
    const reusedObservation = entry.actualQueryUrl && entry.attemptSource
      ? (fingerprintUsers.get(`${entry.attemptSource}|${entry.actualQueryUrl}|${entry.executedQuery?.trim() || ''}`)?.size || 0) > 1
      : false;
    if (entry.outcome !== 'unattempted' && ((group?.sourceIds.length || 0) > 1 || reusedObservation) && entry.applicabilityConfirmed !== true) {
      throw new Error(`shared query requires per-source applicability confirmation: ${entry.sourceId}`);
    }
    const previous = statuses.get(entry.sourceId);
    if (!previous || entry.outcome === 'executed' || entry.outcome === 'blocked-after-attempt' || entry.outcome === 'excluded-informational') {
      statuses.set(entry.sourceId, entry.outcome);
    }
    if (entry.outcome === 'blocked-after-attempt') counts.blockedAfterAttempt++;
    else if (entry.outcome === 'excluded-informational') counts.excludedInformational++;
    else counts[entry.outcome]++;
  }

  const completedSourceIds = manifest.sourceIds.filter((id) => {
    const outcome = statuses.get(id);
    return outcome === 'executed' || outcome === 'blocked-after-attempt' || outcome === 'excluded-informational';
  });
  const remainingSourceIds = manifest.sourceIds.filter((id) => !completedSourceIds.includes(id));
  for (const id of remainingSourceIds) {
    if (!statuses.has(id)) counts.unattempted++;
  }
  if (completedSourceIds.length > manifest.sourceIds.length) throw new Error('fabricated completion count');
  if (completedSourceIds.some((id) => !merchandise.has(id) && !excluded.has(id))) throw new Error('invalid completion identity');

  return {
    searchAttemptCoverageComplete: manifest.sourceIds.length > 0 && discovery.size === 0 && remainingSourceIds.length === 0,
    totalSourceIds: manifest.sourceIds.length,
    merchandiseIds: manifest.merchandiseIds.length,
    catalogDiscoveryIds: discovery.size,
    completedSourceIds,
    remainingSourceIds,
    counts,
  };
}

export function reconcileResearchBatch(
  manifest: ResearchSessionManifest,
  batchNumber: number,
  ledger: ResearchLedgerEntry[],
): ResearchBatchReconciliation {
  const batch = manifest.batches.find((candidate) => candidate.batchNumber === batchNumber);
  if (!batch || !Number.isInteger(batchNumber)) throw new Error(`unknown research batch: ${batchNumber}`);
  assertUniqueIds(batch.sourceIds, 'batch sourceId');
  const master = new Set(manifest.sourceIds);
  if (batch.sourceIds.length === 0 || batch.sourceIds.some((id) => !master.has(id))) {
    throw new Error('batch contains no source IDs or an ID outside the master manifest');
  }
  const selected = new Set(batch.sourceIds);
  if (ledger.some((entry) => !selected.has(entry.sourceId))) {
    throw new Error('batch ledger contains a source ID outside the selected batch');
  }
  const excluded = new Set(manifest.informationalExclusions.map((entry) => entry.sourceId));
  const placeholders: ResearchLedgerEntry[] = manifest.sourceIds
    .filter((id) => !selected.has(id))
    .map((sourceId) => ({ sourceId, outcome: excluded.has(sourceId) ? 'excluded-informational' : 'unattempted' }));
  const reconciliation = reconcileResearchSession(manifest, [...ledger, ...placeholders]);
  const completedSourceIds = batch.sourceIds.filter((id) => reconciliation.completedSourceIds.includes(id));
  const remainingSourceIds = batch.sourceIds.filter((id) => !completedSourceIds.includes(id));
  return {
    batchNumber,
    masterSourceCount: manifest.sourceIds.length,
    sourceIds: batch.sourceIds.slice(),
    completedSourceIds,
    remainingSourceIds,
    searchAttemptCoverageComplete: remainingSourceIds.length === 0
      && !batch.sourceIds.some((id) => manifest.catalogDiscoveryIds.includes(id)),
  };
}
