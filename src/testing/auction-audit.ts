import { verifyEbaySoldCompSet, type EbayMoney, type EbaySoldRecord, type EbaySoldSearchAttempt } from '../intelligence/ebay-sold-results.js';
import { assessEbayEvidenceUrl, classifyEbayEvidenceUrl } from '../intelligence/ebay-evidence-url.js';
import { extractProductIdentity, type ConditionAssessment, type ProductIdentity } from '../intelligence/us-deal-intelligence.js';

export type AuctionAuditDescriptorOutcome = { descriptorId: string } & (
  | { status: 'reviewed'; reviewedAt: string }
  | { status: 'blocked'; attemptedAt: string; sourceUrl: string; reason: string }
  | { status: 'unattempted' | 'deferred' }
);

export interface AuctionAuditCollection {
  descriptionReviewed: boolean;
  collectionComplete: boolean;
  expectedPhysicalDescriptorIds: readonly string[];
  descriptorOutcomes: readonly AuctionAuditDescriptorOutcome[];
  /** Legacy claims are checked for invalid IDs but cannot replace timestamped outcomes. */
  reviewedDescriptorIds?: readonly string[];
}

export interface AuctionAuditEconomics {
  acquisitionCostUsd: number | null;
  sellingCostsUsd: number | null;
  inboundShippingUsd: number | null;
  outboundShippingUsd: number | null;
  packingReserveUsd: number | null;
  targetProfitUsd: number | null;
}

export interface AuctionAuditResearch {
  plannedQueries: readonly string[];
  capturedAttempts: readonly AuctionAuditSoldSearchAttempt[];
  sourceIdentity: ProductIdentity;
  sourceCondition: ConditionAssessment;
  sourceQuantity: number;
}

interface AuctionAuditItemPageObservation {
  requestedUrl: string;
  finalUrl: string;
  observedAt: string;
  itemId: string;
  soldAt: string;
  paidAmount: EbayMoney;
  visibleSoldState: string;
}

type AuctionAuditSoldRecord = EbaySoldRecord & {
  itemPageObservation?: AuctionAuditItemPageObservation;
};

type AuctionAuditSoldSearchAttempt = Omit<EbaySoldSearchAttempt, 'records'> & {
  records: AuctionAuditSoldRecord[];
};

export interface AuctionAuditComponent {
  stableId: string;
  collection: AuctionAuditCollection;
  research: AuctionAuditResearch;
  economics: AuctionAuditEconomics;
}

export interface AuctionAuditLot extends AuctionAuditComponent {
  expectedComponentIds: readonly string[];
  components: readonly AuctionAuditComponent[];
}

export interface AuctionAuditInput {
  expectedLotIds: readonly string[];
  lots: readonly AuctionAuditLot[];
}

export type AuctionAuditNodeStatus =
  | 'complete'
  | 'incomplete'
  | 'unattempted'
  | 'blocked'
  | 'insufficient';

export type AuctionAuditResearchStatus =
  | 'unattempted'
  | 'incomplete'
  | 'complete'
  | 'complete-with-access-gaps';

export interface AuctionAuditNodeReport {
  kind: 'lot' | 'component';
  stableId: string;
  parentLotId: string | null;
  status: AuctionAuditNodeStatus;
  reasons: string[];
  researchStatus: AuctionAuditResearchStatus;
  researchReasons: string[];
  descriptorOutcomes: AuctionAuditDescriptorOutcome[];
  missingDescriptorIds: string[];
  unexpectedDescriptorIds: string[];
  duplicateDescriptorIds: string[];
  plannedQueries: string[];
  attemptedQueries: string[];
  acceptedSoldItemIds: string[];
  resaleUsd: number | null;
  resaleReady: boolean;
  profitBeforeShippingUsd: number | null;
  profitBeforeShippingReady: boolean;
  /** Signed all-in acquisition budget; a negative value is a shortfall, not a bid. */
  maxAcquisitionBudgetUsd: number | null;
  acquisitionBudgetReady: boolean;
  acquisitionBudgetStatus: 'unavailable' | 'shortfall' | 'nonnegative';
  /** A hammer ceiling requires auction terms that this audit does not receive. */
  maxBidUsd: null;
  maxBidReady: false;
  unknownCostFields: string[];
  invalidCostFields: string[];
}

export interface AuctionAuditIdentityIssue {
  scope: 'lot' | 'component' | 'descriptor';
  path: string;
  reason: 'blank' | 'duplicate' | 'missing' | 'unexpected';
  id: string;
}

export interface AuctionAuditReport {
  complete: boolean;
  researchComplete: boolean;
  identityIssues: AuctionAuditIdentityIssue[];
  expectedLotIds: string[];
  suppliedLotIds: string[];
  missingLotIds: string[];
  unexpectedLotIds: string[];
  duplicateLotIds: string[];
  missingComponentIds: string[];
  unexpectedComponentIds: string[];
  nodes: AuctionAuditNodeReport[];
}

function clean(value: string): string {
  return String(value || '').trim();
}

function key(value: string): string {
  return clean(value).toLocaleLowerCase('en-US');
}

function unique(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = clean(value);
    if (cleaned && !seen.has(key(cleaned))) {
      seen.add(key(cleaned));
      result.push(cleaned);
    }
  }
  return result;
}

function duplicates(values: readonly string[]): string[] {
  const counts = new Map<string, { value: string; count: number }>();
  for (const value of values) {
    const cleaned = clean(value);
    if (!cleaned) continue;
    const entry = counts.get(key(cleaned)) || { value: cleaned, count: 0 };
    entry.count += 1;
    counts.set(key(cleaned), entry);
  }
  return [...counts.values()].filter((entry) => entry.count > 1).map((entry) => entry.value);
}

function missing(expected: readonly string[], actual: readonly string[]): string[] {
  const actualKeys = new Set(actual.map(key));
  return unique(expected).filter((value) => !actualKeys.has(key(value)));
}

function unexpected(expected: readonly string[], actual: readonly string[]): string[] {
  const expectedKeys = new Set(expected.map(key));
  return unique(actual).filter((value) => !expectedKeys.has(key(value)));
}

function identityIssuesFor(
  expected: readonly string[],
  actual: readonly string[],
  scope: AuctionAuditIdentityIssue['scope'],
  expectedPath: string,
  actualPath: string,
): AuctionAuditIdentityIssue[] {
  const issues: AuctionAuditIdentityIssue[] = [];
  const sides = [
    { values: expected, counterpart: actual, path: expectedPath, unmatched: 'missing' },
    { values: actual, counterpart: expected, path: actualPath, unmatched: 'unexpected' },
  ] as const;
  for (const side of sides) {
    const seen = new Set<string>();
    const counterpart = new Set(side.counterpart.map(key));
    side.values.forEach((value, index) => {
      const id = clean(value);
      const path = `${side.path}[${index}]`;
      if (!id) issues.push({ scope, path, reason: 'blank', id });
      else if (seen.has(key(id))) issues.push({ scope, path, reason: 'duplicate', id });
      else if (!counterpart.has(key(id))) issues.push({ scope, path, reason: side.unmatched, id });
      seen.add(key(id));
    });
  }
  return issues;
}

function collectionIdentityIssues(collection: AuctionAuditCollection, path: string): AuctionAuditIdentityIssue[] {
  const expectedPath = `${path}.expectedPhysicalDescriptorIds`;
  const issues = identityIssuesFor(
    collection.expectedPhysicalDescriptorIds,
    (collection.descriptorOutcomes ?? []).map((outcome) => outcome.descriptorId),
    'descriptor', expectedPath, `${path}.descriptorOutcomes`,
  );
  if (collection.reviewedDescriptorIds) {
    const legacyPath = `${path}.reviewedDescriptorIds`;
    issues.push(...identityIssuesFor(
      collection.expectedPhysicalDescriptorIds, collection.reviewedDescriptorIds, 'descriptor', expectedPath, legacyPath,
    ).filter((issue) => issue.path.startsWith(legacyPath)));
  }
  return issues;
}

function sameQuerySet(left: readonly string[], right: readonly string[]): boolean {
  const a = unique(left).map(key).sort();
  const b = unique(right).map(key).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function matchesNumber(actual: number | null, expected: number | null): boolean {
  return actual === expected || (actual !== null && expected !== null && Math.abs(actual - expected) < 0.000001);
}

function validTimestamp(value: string): boolean {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    && Number.isFinite(Date.parse(value));
}

function validCompletedSaleDate(value: string, observedAt: string): boolean {
  if (typeof value !== 'string' || !/^(?:\d{4}-\d{2}-\d{2}(?:T.*)?|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4})$/i.test(value.trim())) return false;
  const saleTime = Date.parse(value);
  const observationTime = Date.parse(observedAt);
  return Number.isFinite(saleTime) && Number.isFinite(observationTime)
    && saleTime <= observationTime && saleTime <= Date.now();
}

function sameEbayItem(left: string, right: string, expectedItemId: string): boolean {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    const leftEvidence = assessEbayEvidenceUrl(leftUrl);
    const rightEvidence = assessEbayEvidenceUrl(rightUrl);
    return leftEvidence.urlClassification.kind === 'listing-unknown-state'
      && rightEvidence.urlClassification.kind === 'listing-unknown-state'
      && leftUrl.pathname.match(/\/itm\/(?:[^/]+\/)?(\d{9,15})\/?$/i)?.[1] === expectedItemId
      && rightUrl.pathname.match(/\/itm\/(?:[^/]+\/)?(\d{9,15})\/?$/i)?.[1] === expectedItemId;
  } catch {
    return false;
  }
}

function validItemPageObservation(record: AuctionAuditSoldRecord, attempt: AuctionAuditSoldSearchAttempt): boolean {
  const observation = record.itemPageObservation;
  if (!observation || !validTimestamp(observation.observedAt)
    || Date.parse(observation.observedAt) < Date.parse(attempt.observedAt)
    || Date.parse(observation.observedAt) > Date.now()
    || !validCompletedSaleDate(observation.soldAt, observation.observedAt)
    || !Number.isFinite(observation.paidAmount?.amount) || observation.paidAmount.amount <= 0
    || observation.paidAmount.currency !== 'USD'
    || !record.soldPrice || record.soldPrice.currency !== 'USD'
    || record.soldPrice.amount !== observation.paidAmount.amount
    || observation.itemId !== record.itemId
    || !sameEbayItem(observation.requestedUrl, observation.finalUrl, record.itemId)
    || !sameEbayItem(observation.finalUrl, record.itemUrl, record.itemId)
    || !visiblePaidSale(observation.visibleSoldState, observation.paidAmount.amount)) return false;
  return true;
}

function visiblePaidSale(value: unknown, amount: number): boolean {
  if (typeof value !== 'string' || value.length > 500
    || !/\b(?:this listing|item) sold on\b/i.test(value)
    || /\b(?:not sold|unsold|never sold|did not sell|active|buy it now|available|best offer accepted|accepted offer|ended by (?:the )?seller|seller ended|no longer available)\b/i.test(value)) return false;
  return [...value.matchAll(/\bSOLD\s+US\s*\$\s*([\d,]+(?:\.\d{1,2})?)/gi)]
    .some((match) => Math.abs(Number(match[1]!.replaceAll(',', '')) - amount) < 0.005);
}

function documentedAccessFailure(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const reason = value.trim().replace(/\s+/g, ' ');
  if (/\b(?:unattempted|defer(?:red|ral)?|deadline|skipped|not attempted|time[ -]*budget|time limit|out of time)\b/i.test(reason)) return false;
  // Only observed challenge statements and concrete HTTP failures qualify, not free-form explanations.
  const observedChallenge = /^(?:ebay )?(?:captcha|security challenge|human verification)(?: page)? (?:was )?(?:displayed|shown|detected|prevented access|blocked access)[.!]?$/i.test(reason)
    || /^(?:observed|detected) (?:ebay )?(?:captcha|security challenge|human verification)(?: page)?[.!]?$/i.test(reason);
  const httpFailure = /^(?:(?:ebay|the server|the cdn) returned )?HTTP(?:\/[12](?:\.[01])?)? (?:401(?: Unauthorized)?|403(?: Forbidden)?|404(?: Not Found)?|407(?: Proxy Authentication Required)?|410(?: Gone)?|429(?: Too Many Requests)?|451(?: Unavailable For Legal Reasons)?|500(?: Internal Server Error)?|502(?: Bad Gateway)?|503(?: Service Unavailable)?|504(?: Gateway Timeout)?)(?: returned by (?:ebay|the server|the cdn|seller image cdn))?[.!]?$/i.test(reason);
  return observedChallenge || httpFailure;
}

function validDescriptorOutcome(outcome: AuctionAuditDescriptorOutcome): boolean {
  if (outcome.status === 'reviewed') return validTimestamp(outcome.reviewedAt);
  if (outcome.status !== 'blocked' || !validTimestamp(outcome.attemptedAt)) return false;
  if (!documentedAccessFailure(outcome.reason)) return false;
  try {
    const url = new URL(outcome.sourceUrl);
    return url.protocol === 'https:' && Boolean(url.hostname) && !url.username && !url.password;
  } catch {
    return false;
  }
}

function validAttempt(attempt: EbaySoldSearchAttempt): boolean {
  try {
    if (attempt.status === 'challenge') {
      const reason = typeof attempt.failureReason === 'string' ? attempt.failureReason.trim() : null;
      // The parser's marker records detected challenge content; a status label alone does not.
      if (reason !== 'ebay-challenge' && !documentedAccessFailure(reason)) return false;
    }
    const url = new URL(attempt.sourceUrl);
    const soldContext = attempt.source === 'public-sold-search'
      ? classifyEbayEvidenceUrl(url).kind === 'sold-search-seed'
      : attempt.source === 'seller-hub-product-research'
        && ['ebay.com', 'www.ebay.com'].includes(url.hostname)
        && /^\/sh\/research\/?$/i.test(url.pathname)
        && url.searchParams.get('tabName')?.toUpperCase() === 'SOLD';
    const queryParameter = attempt.source === 'public-sold-search' ? '_nkw' : 'keywords';
    return soldContext && url.protocol === 'https:' && !url.username && !url.password
      && Boolean(clean(attempt.query)) && key(url.searchParams.get(queryParameter) || '') === key(attempt.query)
      && validTimestamp(attempt.observedAt)
      && attempt.records.every((record) => {
        const itemUrl = new URL(record.itemUrl);
        const evidence = assessEbayEvidenceUrl(itemUrl, record.provenance);
        return record.source === attempt.source && new URL(record.sourceUrl).href === url.href
          && validTimestamp(record.observedAt) && Date.parse(record.observedAt) === Date.parse(attempt.observedAt)
          && itemUrl.protocol === 'https:' && !itemUrl.username && !itemUrl.password
          && evidence.verifiedSoldComp && evidence.provenance.itemId === record.itemId
          && [record.soldPrice, record.shippingPrice, record.deliveredPrice].every((price) => (
            price === null || (Number.isFinite(price.amount) && price.amount >= 0)
          ));
      });
  } catch {
    return false;
  }
}

function hasBlank(values: readonly string[]): boolean {
  return values.some((value) => !clean(value));
}

function auditNode(
  kind: 'lot' | 'component',
  stableId: string,
  parentLotId: string | null,
  node: AuctionAuditComponent,
): AuctionAuditNodeReport {
  const reasons: string[] = [];
  const expectedDescriptorIds = node.collection.expectedPhysicalDescriptorIds;
  const descriptorOutcomes = node.collection.descriptorOutcomes ?? [];
  const legacyReviewedIds = node.collection.reviewedDescriptorIds ?? [];
  const collectionIssues = collectionIdentityIssues(node.collection, 'collection');
  const validOutcomes = descriptorOutcomes.filter(validDescriptorOutcome);
  const reviewedIds = validOutcomes.filter((outcome) => outcome.status === 'reviewed').map((outcome) => outcome.descriptorId);
  const blockedIds = validOutcomes.filter((outcome) => outcome.status === 'blocked').map((outcome) => outcome.descriptorId);
  if (!node.collection.collectionComplete) reasons.push('collection-incomplete');
  if (hasBlank(expectedDescriptorIds)) reasons.push('blank-expected-descriptor-id');
  if (hasBlank(legacyReviewedIds)) reasons.push('blank-reviewed-descriptor-id');
  if (duplicates(expectedDescriptorIds).length) reasons.push('duplicate-expected-descriptor-id');
  if (collectionIssues.length) reasons.push('collection-identities-unreconciled');
  const expectedDescriptors = unique(node.collection.expectedPhysicalDescriptorIds);
  const reviewedDescriptors = unique(reviewedIds);
  const missingDescriptorIds = missing(expectedDescriptors, reviewedDescriptors);
  const unexpectedDescriptorIds = unexpected(expectedDescriptors, [...reviewedDescriptors, ...legacyReviewedIds]);
  const duplicateDescriptorIds = unique([...duplicates(reviewedIds), ...duplicates(legacyReviewedIds)]);
  if (!node.collection.descriptionReviewed) reasons.push('description-unreviewed');
  if (missingDescriptorIds.length) reasons.push('physical-descriptors-unreviewed');
  if (unexpectedDescriptorIds.length) reasons.push('unexpected-reviewed-descriptor');
  if (duplicateDescriptorIds.length) reasons.push('duplicate-reviewed-descriptor');

  const plannedQueries = unique(node.research.plannedQueries);
  const capturedAttempts = node.research.capturedAttempts;
  const retainedAttempts = capturedAttempts.filter(validAttempt);
  const verifiedAttempts = retainedAttempts.map((attempt) => ({
    ...attempt,
    records: attempt.records.filter((record) => validItemPageObservation(record, attempt)),
  }));
  const unverifiedCandidateCount = retainedAttempts.reduce((count, attempt, index) => (
    count + attempt.records.length - verifiedAttempts[index]!.records.length
  ), 0);
  if (unverifiedCandidateCount) reasons.push('unverified-sold-candidates');
  const attemptedQueries = unique(retainedAttempts.map((attempt) => attempt.query));
  if (retainedAttempts.length !== capturedAttempts.length) reasons.push('invalid-captured-attempt-provenance');
  const sourceReady = Boolean(node.research.sourceIdentity?.name && node.research.sourceIdentity?.query
    && node.research.sourceCondition && typeof node.research.sourceCondition.condition === 'string'
    && Number.isSafeInteger(node.research.sourceQuantity) && node.research.sourceQuantity > 0);
  if (!sourceReady) reasons.push('missing-source-product-evidence');
  const verification = verifyEbaySoldCompSet(sourceReady ? node.research.sourceIdentity : extractProductIdentity(''), sourceReady ? verifiedAttempts : [], {
    plannedQueries,
    sourceCondition: sourceReady ? node.research.sourceCondition : null,
    sourceQuantity: sourceReady ? node.research.sourceQuantity : null,
  });
  if (!sameQuerySet(plannedQueries, verification.plannedQueries)) reasons.push('planned-queries-do-not-match-verifier');
  if (!capturedAttempts.length) reasons.push('no-captured-provenance');
  if (!sameQuerySet(attemptedQueries, verification.attemptedQueries)) reasons.push('captured-attempts-do-not-match-verifier');
  if (!sameQuerySet(plannedQueries, attemptedQueries)) reasons.push('planned-queries-not-all-attempted');
  if (!verification.allPlannedQueriesAttempted) reasons.push('verifier-planned-queries-incomplete');
  if (!verification.completePages) reasons.push('verifier-pagination-incomplete');
  if (verification.duplicateItemIds.length) reasons.push('duplicate-sold-item-id');
  if (verification.status === 'blocked') reasons.push('sold-verification-blocked');
  else if (verification.status === 'insufficient') reasons.push('sold-verification-insufficient');
  else if (verification.status !== 'verified') reasons.push(`sold-verification-${verification.status}`);

  const researchReasons: string[] = [];
  if (!node.collection.descriptionReviewed) researchReasons.push('description-unreviewed');
  if (node.collection.collectionComplete !== true) researchReasons.push('collection-incomplete');
  if (collectionIssues.length) researchReasons.push('collection-identities-unreconciled');
  if (missing(expectedDescriptors, [...reviewedIds, ...blockedIds]).length) researchReasons.push('physical-descriptors-unresolved');
  if (descriptorOutcomes.some((outcome) => !['unattempted', 'deferred'].includes(outcome.status) && !validDescriptorOutcome(outcome))) {
    researchReasons.push('invalid-descriptor-evidence');
  }
  if (!sourceReady) researchReasons.push('missing-source-product-evidence');
  if (!plannedQueries.length || hasBlank(node.research.plannedQueries)) researchReasons.push('invalid-planned-queries');
  if (!capturedAttempts.length) researchReasons.push('no-captured-provenance');
  if (retainedAttempts.length !== capturedAttempts.length) researchReasons.push('invalid-captured-attempt-provenance');
  if (unverifiedCandidateCount) researchReasons.push('unverified-sold-candidates');
  if (!verification.allPlannedQueriesAttempted || !sameQuerySet(plannedQueries, attemptedQueries)) {
    researchReasons.push('planned-queries-not-all-attempted');
  }
  if (!verification.completePages) researchReasons.push('research-pagination-incomplete');
  if (retainedAttempts.some((attempt) => !['ok', 'no-results', 'challenge'].includes(attempt.status))) {
    researchReasons.push('research-result-page-incomplete');
  }
  const accessGaps = blockedIds.length > 0 || retainedAttempts.some((attempt) => attempt.status === 'challenge');
  const researchStatus: AuctionAuditResearchStatus = !capturedAttempts.length ? 'unattempted'
    : researchReasons.length ? 'incomplete'
      : accessGaps ? 'complete-with-access-gaps' : 'complete';
  if (blockedIds.length) researchReasons.push('physical-descriptors-blocked');
  if (retainedAttempts.some((attempt) => attempt.status === 'challenge')) researchReasons.push('sold-search-access-blocked');

  const acceptedIds = unique(verification.accepted.map((record) => record.itemId));
  const salePrices = verification.accepted.map((record) => record.soldPrice?.amount ?? null).filter((value): value is number => value !== null);
  const deliveredPrices = verification.accepted.map((record) => record.deliveredPrice?.amount ?? null).filter((value): value is number => value !== null);
  const stats = verification.statistics;
  const saleLow = salePrices.length ? Math.min(...salePrices) : null;
  const saleHigh = salePrices.length ? Math.max(...salePrices) : null;
  if (stats.sampleSize !== acceptedIds.length || acceptedIds.length !== verification.accepted.length
    || !matchesNumber(stats.salePriceMedian, median(salePrices))
    || !matchesNumber(stats.salePriceLow, saleLow)
    || !matchesNumber(stats.salePriceHigh, saleHigh)) reasons.push('verifier-statistics-do-not-reconcile');
  if (!matchesNumber(stats.deliveredPriceMedian, median(deliveredPrices))) reasons.push('verifier-delivered-statistics-do-not-reconcile');

  const economics = node.economics;
  const unknownCostFields = (['acquisitionCostUsd', 'sellingCostsUsd', 'inboundShippingUsd', 'outboundShippingUsd', 'packingReserveUsd', 'targetProfitUsd'] as const)
    .filter((field) => economics[field] === null);
  const invalidCostFields = (['acquisitionCostUsd', 'sellingCostsUsd', 'inboundShippingUsd', 'outboundShippingUsd', 'packingReserveUsd', 'targetProfitUsd'] as const)
    .filter((field) => economics[field] !== null && (!Number.isFinite(economics[field]!) || economics[field]! < 0));
  const resaleUsd = verification.marketValueReady && stats.salePriceMedian !== null ? stats.salePriceMedian : null;
  const profitBeforeShippingUsd = resaleUsd !== null && economics.acquisitionCostUsd !== null && economics.sellingCostsUsd !== null
    && !invalidCostFields.includes('acquisitionCostUsd') && !invalidCostFields.includes('sellingCostsUsd')
    ? resaleUsd - economics.acquisitionCostUsd - economics.sellingCostsUsd
    : null;
  const maxAcquisitionBudgetUsd = resaleUsd !== null && unknownCostFields.length === 0 && invalidCostFields.length === 0
    ? resaleUsd - economics.sellingCostsUsd! - economics.inboundShippingUsd! - economics.outboundShippingUsd! - economics.packingReserveUsd! - economics.targetProfitUsd!
    : null;
  const acquisitionBudgetStatus = maxAcquisitionBudgetUsd === null ? 'unavailable'
    : maxAcquisitionBudgetUsd < 0 ? 'shortfall' : 'nonnegative';
  if (unknownCostFields.length) reasons.push('unknown-costs');
  if (invalidCostFields.length) reasons.push('invalid-costs');

  let status: AuctionAuditNodeStatus = reasons.includes('no-captured-provenance') ? 'unattempted'
    : reasons.includes('sold-verification-blocked') ? 'blocked'
      : reasons.includes('unverified-sold-candidates') ? 'incomplete'
      : reasons.includes('sold-verification-insufficient') ? 'insufficient'
        : reasons.length ? 'incomplete' : 'complete';
  if (status === 'complete' && verification.status !== 'verified') status = 'incomplete';
  return {
    kind, stableId, parentLotId, status, reasons: unique(reasons),
    researchStatus, researchReasons, descriptorOutcomes: [...descriptorOutcomes],
    missingDescriptorIds, unexpectedDescriptorIds, duplicateDescriptorIds,
    plannedQueries, attemptedQueries, acceptedSoldItemIds: acceptedIds,
    resaleUsd, profitBeforeShippingUsd, maxAcquisitionBudgetUsd, acquisitionBudgetStatus,
    resaleReady: resaleUsd !== null, profitBeforeShippingReady: profitBeforeShippingUsd !== null,
    acquisitionBudgetReady: maxAcquisitionBudgetUsd !== null,
    maxBidUsd: null, maxBidReady: false, unknownCostFields, invalidCostFields,
  };
}

export function auditAuctionEvidence(input: AuctionAuditInput): AuctionAuditReport {
  const expectedLotIds = unique(input.expectedLotIds);
  const suppliedLotIds = input.lots.map((lot) => lot.stableId);
  const identityIssues = identityIssuesFor(input.expectedLotIds, suppliedLotIds, 'lot', 'expectedLotIds', 'lots');
  const missingLotIds = missing(expectedLotIds, suppliedLotIds);
  const unexpectedLotIds = unexpected(expectedLotIds, suppliedLotIds);
  const duplicateLotIds = duplicates(suppliedLotIds);
  const nodes: AuctionAuditNodeReport[] = [];
  const missingComponentIds: string[] = [];
  const unexpectedComponentIds: string[] = [];
  input.lots.forEach((lot, lotIndex) => {
    const lotPath = `lots[${lotIndex}]`;
    nodes.push(auditNode('lot', lot.stableId, null, lot));
    const expected = unique(lot.expectedComponentIds);
    const supplied = lot.components.map((component) => component.stableId);
    identityIssues.push(...identityIssuesFor(
      lot.expectedComponentIds, supplied, 'component', `${lotPath}.expectedComponentIds`, `${lotPath}.components`,
    ));
    identityIssues.push(...collectionIdentityIssues(lot.collection, `${lotPath}.collection`));
    missingComponentIds.push(...missing(expected, supplied));
    unexpectedComponentIds.push(...unexpected(expected, supplied));
    lot.components.forEach((component, componentIndex) => {
      nodes.push(auditNode('component', component.stableId, lot.stableId, component));
      const componentPath = `${lotPath}.components[${componentIndex}]`;
      identityIssues.push(...collectionIdentityIssues(component.collection, `${componentPath}.collection`));
    });
  });
  return {
    complete: identityIssues.length === 0 && nodes.every((node) => node.status === 'complete'),
    researchComplete: identityIssues.length === 0 && nodes.every((node) => (
      node.researchStatus === 'complete' || node.researchStatus === 'complete-with-access-gaps'
    )),
    identityIssues,
    expectedLotIds, suppliedLotIds: unique(suppliedLotIds), missingLotIds, unexpectedLotIds, duplicateLotIds,
    missingComponentIds: unique(missingComponentIds), unexpectedComponentIds: unique(unexpectedComponentIds), nodes,
  };
}
