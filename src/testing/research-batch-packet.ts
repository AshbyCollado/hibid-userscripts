import type { HiBidExportPayload, HiBidResearchQueueItem } from '../hibid/exports.js';
import { compactHibidPromptItems } from '../hibid/exports.js';
import { COMPONENT_RESEARCH_CONTRACT, type ResearchSessionManifest } from '../intelligence/research-session.js';
import { EVIDENCE_OUTPUT_CONTRACT } from '../intelligence/evidence-output-contract.js';

export interface HiBidResearchBatchPacket {
  packetType: 'hibid-research-batch-audit';
  packetVersion: 1;
  batchNumber: number;
  batchSourceIds: string[];
  partialBatch: true;
  data: {
    masterContext: HiBidExportPayload['context'];
    researchSession: ResearchSessionManifest;
    masterAudit: HiBidExportPayload['audit'];
    savedResearch: HiBidExportPayload['savedResearch'];
    items: HiBidExportPayload['items'];
    researchQueue: HiBidResearchQueueItem[];
  };
}

type JsonRecord = Record<string, unknown>;

function record(value: unknown, label: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as JsonRecord;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((id) => typeof id !== 'string' || !id.trim())) {
    throw new Error(`${label} must be a non-empty-string array`);
  }
  return value as string[];
}

function assertUnique(ids: string[], label: string): void {
  if (new Set(ids).size !== ids.length) throw new Error(`${label} contains duplicate IDs`);
}

function equalIds(actual: string[], expected: string[], label: string): void {
  if (actual.length !== expected.length || actual.some((id, index) => id !== expected[index])) {
    throw new Error(`${label} does not exactly reconcile to the master manifest`);
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function validateBatchManifest(manifest: JsonRecord, sourceIds: string[]): void {
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported or legacy researchSession schema');
  const batches = manifest.batches;
  if (!Array.isArray(batches) || batches.length === 0) throw new Error('researchSession batches are required');
  for (let index = 0; index < batches.length; index += 1) {
    const batch = record(batches[index], `researchSession.batches[${index}]`);
    if (batch.batchNumber !== index + 1) throw new Error('researchSession batch numbers are not contiguous');
    const ids = stringArray(batch.sourceIds, `researchSession.batches[${index}].sourceIds`);
    if (ids.length > 8) throw new Error('researchSession batch exceeds the 8-ID limit');
    assertUnique(ids, `researchSession batch ${index + 1}`);
    equalIds(ids, sourceIds.slice(index * 8, index * 8 + ids.length), `researchSession batch ${index + 1}`);
  }
  if (batches.reduce((count, batch) => count + stringArray(record(batch, 'batch').sourceIds, 'batch.sourceIds').length, 0) !== sourceIds.length) {
    throw new Error('researchSession batches do not cover all source IDs');
  }
}

export function buildHibidResearchBatchPacket(input: unknown, batchNumber: number): HiBidResearchBatchPacket {
  const payload = record(input, 'Copy JSON payload');
  if (!Number.isInteger(batchNumber) || batchNumber < 1) throw new Error('batch number must be a positive integer');

  const context = record(payload.context, 'context');
  const session = record(payload.researchSession, 'researchSession');
  const audit = record(payload.audit, 'audit');
  if (context.source !== 'HiBid' || context.complete !== true || audit.complete !== true) {
    throw new Error('Input must be a complete HiBid Copy JSON payload');
  }
  if (typeof context.routeFingerprint !== 'string' || !context.routeFingerprint.trim()
    || typeof context.sourceUrl !== 'string' || !context.sourceUrl.trim()
    || typeof session.routeFingerprint !== 'string' || !session.routeFingerprint.trim()
    || typeof session.sourceUrl !== 'string' || !session.sourceUrl.trim()
    || context.routeFingerprint !== session.routeFingerprint || context.sourceUrl !== session.sourceUrl) {
    throw new Error('context and researchSession provenance fingerprints or URLs drifted');
  }

  const sourceIds = stringArray(session.sourceIds, 'researchSession.sourceIds');
  assertUnique(sourceIds, 'researchSession.sourceIds');
  validateBatchManifest(session, sourceIds);
  const items = payload.items;
  const queue = payload.researchQueue;
  if (!Array.isArray(items) || !Array.isArray(queue)) throw new Error('items and researchQueue are required');
  const itemIds = items.map((item, index) => {
    const source = record(item, `items[${index}]`);
    const id = source.eventItemId;
    if (typeof id !== 'string' || !id.trim()) throw new Error('eventItemId is required for every item');
    if (source.id !== undefined && source.id !== id) throw new Error('item id alias conflicts with eventItemId');
    return id;
  });
  const queueIds = queue.map((row, index) => {
    const id = record(row, `researchQueue[${index}]`).id;
    if (typeof id !== 'string' || !id.trim()) throw new Error('researchQueue IDs are required');
    return id;
  });
  assertUnique(itemIds, 'items');
  assertUnique(queueIds, 'researchQueue');
  equalIds(itemIds, sourceIds, 'items IDs');
  equalIds(queueIds, sourceIds, 'researchQueue IDs');
  if (audit.expectedCount !== sourceIds.length || audit.uniqueItemCount !== sourceIds.length
    || context.expectedCount !== sourceIds.length || context.copiedCount !== sourceIds.length) {
    throw new Error('audit counts do not reconcile to the master manifest');
  }

  const batches = session.batches as Array<{ batchNumber: number; sourceIds: string[] }>;
  const selected = batches[batchNumber - 1];
  if (!selected) throw new Error(`batch ${batchNumber} does not exist`);
  const byId = new Map(itemIds.map((id, index) => [id, items[index]]));
  const queueById = new Map(queueIds.map((id, index) => [id, queue[index]]));
  const savedResearch = record(payload.savedResearch, 'savedResearch');
  if (savedResearch.schemaVersion !== 1) throw new Error('Unsupported savedResearch schema');
  const savedLots = record(savedResearch.lots, 'savedResearch.lots');
  const savedAuctions = record(savedResearch.auctions, 'savedResearch.auctions');
  const selectedAuctions = new Set(selected.sourceIds.map((id) => record(byId.get(id), `item ${id}`).auctionId).filter((id): id is string => typeof id === 'string' && Boolean(id)));
  const scopedSavedResearch = {
    schemaVersion: savedResearch.schemaVersion,
    lots: Object.fromEntries(Object.entries(savedLots).filter(([id]) => selected.sourceIds.includes(id))),
    auctions: Object.fromEntries(Object.entries(savedAuctions).filter(([id]) => selectedAuctions.has(id))),
  } as HiBidExportPayload['savedResearch'];
  return {
    packetType: 'hibid-research-batch-audit',
    packetVersion: 1,
    batchNumber,
    batchSourceIds: clone(selected.sourceIds),
    partialBatch: true,
    data: {
      masterContext: clone(payload.context) as HiBidExportPayload['context'],
      researchSession: clone(payload.researchSession) as ResearchSessionManifest,
      masterAudit: clone(payload.audit) as HiBidExportPayload['audit'],
      savedResearch: clone(scopedSavedResearch),
      items: selected.sourceIds.map((id) => clone(byId.get(id)!)),
      researchQueue: selected.sourceIds.map((id) => clone(queueById.get(id)!)),
    },
  };
}

export function renderHibidResearchBatchPacket(packet: HiBidResearchBatchPacket): string {
  const compact = compactHibidPromptItems(packet.data.items);
  const json = JSON.stringify({
    ...packet.data,
    auctionContexts: compact.auctionContexts,
    items: compact.items,
  }, null, 2);
  return `# HiBid Research Batch Audit Packet

**Status:** audit-only partial batch ${packet.batchNumber}; ${packet.batchSourceIds.length} of the manifest's ${packet.data.researchSession.sourceIds.length} IDs. This packet cannot conclude auction-wide completion. Do not bid, buy, publish, contact anyone, or mutate an account.

The masterContext and masterAudit fields describe the complete source export, not this partial packet. Research, photo review, and decisions are scoped only to the selected batch IDs. Keep researchSession as immutable auction provenance; do not claim other IDs were searched or reviewed.
Resolve each item's auctionContextRef against auctionContexts for its complete source auction terms. Verified physicalPhotoDescriptors keep each seller photo's identity and full-resolution URL; duplicate rendition fields may be omitted, but every original physical photo still requires actual review.

${EVIDENCE_OUTPUT_CONTRACT}

## Exact Research Contract

- For every selected merchandise source ID, open its eBay Sold + Completed query from researchQueue in a supported browser. A generated link is not an attempted search. Do not stop after only the first source ID.
- Emit a named JSON attemptLedger for merchandise searches only, with these fields: sourceId, attemptId, outcome, attemptSource, actualQueryUrl, executedQuery, displayedQuery, attemptedAt, observedAt, finalUrl, observedStatus, observedResultCount, contentObservationRef, queryGroupId, and applicabilityConfirmed, plus accessBlockedReason, accessObservation, retryReason, and queryNormalizationEvidence when applicable. attemptSource must be exactly ebay-public-sold or ebay-seller-hub-product-research-sold. Copy queryGroupId from researchSession.queryGroups for that source ID; do not invent one. Put informational exclusions in a separate sourceResolution array with their manifest reason, never in attemptLedger.
- Read the UTC clock immediately before each navigation and when that specific page settles. A JavaScript browser controller can read new Date().toISOString() immediately before and after each awaited navigation. Record those two readings, not one timestamp reused across searches or a time generated while writing the ledger. If either reading was not observed, leave the missing clock null in an invalid/incomplete checkpoint requiring re-observation; preserve the real attempt and do not manufacture an execution timestamp.
- Preserve the submitted URL in actualQueryUrl and the observed page URL in finalUrl. If eBay visibly corrects the query, keep both strings and add queryNormalizationEvidence describing the correction; do not rewrite the original request to satisfy reconciliation.
- Use only these enums in attemptLedger: outcomes executed, blocked-after-attempt, deferred, unattempted; statuses settled, empty, access-blocked, loading, parse-gap, error, unattempted. An executed row needs a counted settled/empty observation and query-specific content evidence. A clearly rendered primary exact zero remains executed/empty/0 even with a separate broader matching-fewer-words section. Do not add broader cards to the exact count or erase a known primary count. Record broader candidates separately, verify identity and original-item paid proof, and try the shorter identity-preserving fallback. Only an actually unavailable, uncertain, conflicting or loading primary count is deferred with null count.
- Review every original physical photo descriptor. In the machine ledger, use top-level photoReviews with one row per physicalPhotoDescriptors entry: sourceId, ordinal (sellerOrdinal), exact fullResolutionUrl, openedAt, observedAt, and a product-specific visibleFact or specific accessFailure. Use top-level photoAudit with numeric expectedPhysicalPhotoRows, opened, reviewed, and accessFailures. Do not use singular photoReview or physicalPhotoReview aliases. Read openedAt immediately before opening each photo and observedAt immediately after inspection, using the same UTC clock. A list of ordinals and one aggregate sentence is not per-photo review evidence; a captured URL is not a viewed photo.
- In any decision sheet, copy lot numbers from the selected source ID's items[].lot. A literal undefined, null, or blank lot number when the source supplies one fails delivery.
- For each lot, use its actual physical seller photos to determine brand, model, generation, quantity, and included accessories before accepting Amazon or eBay evidence. If a photo box conflicts with the seller title or UPC, retain the conflict and reject mismatched comps rather than trusting the title or UPC; product art showing a tablet does not establish that a tablet is included.
- Accept paid-sale proof only from an original sold page that ties one completed transaction to its actual paid price, or a matching one-sale Seller Hub Product Research Sold row that gives the paid amount. Keep item ID, original-page URL, sold date, paid price, shipping, currency, condition, quantity, identity differences, and observed time. A Sold result card, SOLD banner plus current/list price, Best Offer, or multi-sale badge is a lead only; a visible price next to '3 sold' cannot be assigned to an individual sale. Mark such leads unverified and leave acceptedSales empty if no stronger proof is accessible.
- Saved resale estimates are unverified hypotheses. Unknown costs remain unknown and are not zero. Never treat an active asking price, retail/MSRP, snippet, or current discount as sold evidence, profit, or a bid ceiling.
- Before any workbook, reconcile one All Lots row and at least one honest attempt or unattempted/deferred row for every selected ID. A checkpoint with remaining work stays incomplete and must not be presented as a finished batch or auction.
- Do not request credentials or make account mutations. Do not bypass a persistent browser challenge.

${COMPONENT_RESEARCH_CONTRACT}

## Packet Data

\`\`\`json
${json}
\`\`\`
`;
}
