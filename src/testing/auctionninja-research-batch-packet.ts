import type { AuctionNinjaExportPayload, AuctionNinjaResearchQueueItem } from '../auctionninja/exports.js';
import { resolveAuctionNinjaPage } from '../auctionninja/route.js';
import { COMPONENT_RESEARCH_CONTRACT, type ResearchSessionManifest } from '../intelligence/research-session.js';
import { EVIDENCE_OUTPUT_CONTRACT } from '../intelligence/evidence-output-contract.js';

export interface AuctionNinjaResearchBatchPacket {
  packetType: 'auctionninja-research-batch-audit';
  packetVersion: 1;
  batchNumber: number;
  batchSourceIds: string[];
  partialBatch: true;
  data: {
    masterContext: AuctionNinjaExportPayload['context'];
    researchSession: ResearchSessionManifest;
    masterAudit: AuctionNinjaExportPayload['audit'];
    savedResearch: AuctionNinjaExportPayload['savedResearch'];
    items: AuctionNinjaExportPayload['items'];
    researchQueue: AuctionNinjaResearchQueueItem[];
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

function validateBatches(manifest: JsonRecord, sourceIds: string[]): void {
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
  const covered = batches.reduce((count, batch) => count + stringArray(record(batch, 'batch').sourceIds, 'batch.sourceIds').length, 0);
  if (covered !== sourceIds.length) throw new Error('researchSession batches do not cover all source IDs');
}

function itemSaleIds(items: unknown[], sourceIds: string[], scopeId: string | null): Set<string> {
  const saleIds = new Set<string>();
  for (const id of sourceIds) {
    const item = record(items.find((candidate) => record(candidate, 'item').stableId === id), `item ${id}`);
    const declared = item.saleId;
    if (declared !== undefined && (typeof declared !== 'string' || !declared.trim())) throw new Error(`item ${id} has malformed saleId`);
    if (typeof declared === 'string' && declared.trim()) saleIds.add(declared.trim());
    const saleUrl = item.saleUrl;
    if (saleUrl !== undefined) {
      if (typeof saleUrl !== 'string') throw new Error(`item ${id} has malformed saleUrl`);
      if (saleUrl.trim()) {
        const route = resolveAuctionNinjaPage(saleUrl);
        if (route.kind !== 'sale-catalog' || !route.saleId) throw new Error(`item ${id} saleUrl is not a sale-catalog route`);
        saleIds.add(route.saleId);
      }
    }
  }
  if (scopeId) {
    for (const saleId of saleIds) if (saleId !== scopeId) throw new Error('selected items cross AuctionNinja auction scope');
    saleIds.add(scopeId);
  }
  return saleIds;
}

export function buildAuctionNinjaResearchBatchPacket(input: unknown, batchNumber: number): AuctionNinjaResearchBatchPacket {
  const payload = record(input, 'Copy JSON payload');
  if (!Number.isInteger(batchNumber) || batchNumber < 1) throw new Error('batch number must be a positive integer');
  const context = record(payload.context, 'context');
  const session = record(payload.researchSession, 'researchSession');
  const audit = record(payload.audit, 'audit');
  if (context.source !== 'AuctionNinja' || context.complete !== true || audit.complete !== true) {
    throw new Error('Input must be a complete AuctionNinja Copy JSON payload');
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
  validateBatches(session, sourceIds);
  const items = payload.items;
  const queue = payload.researchQueue;
  if (!Array.isArray(items) || !Array.isArray(queue)) throw new Error('items and researchQueue are required');
  const itemIds = items.map((value, index) => {
    const item = record(value, `items[${index}]`);
    if (typeof item.stableId !== 'string' || !item.stableId.trim() || typeof item.id !== 'string' || !item.id.trim()) {
      throw new Error('stableId and id are required for every item');
    }
    if (item.id !== item.stableId) throw new Error('item id alias conflicts with stableId');
    if (item.source !== 'AuctionNinja' || item.pageKind !== context.pageKind) throw new Error('item source or pageKind drifted');
    return item.stableId;
  });
  const queueIds = queue.map((value, index) => {
    const id = record(value, `researchQueue[${index}]`).id;
    if (typeof id !== 'string' || !id.trim()) throw new Error('researchQueue IDs are required');
    return id;
  });
  assertUnique(itemIds, 'items');
  assertUnique(queueIds, 'researchQueue');
  equalIds(itemIds, sourceIds, 'items IDs');
  equalIds(queueIds, sourceIds, 'researchQueue IDs');
  if (audit.expectedCount !== sourceIds.length || audit.uniqueItemCount !== sourceIds.length
    || context.expectedCount !== sourceIds.length || context.copiedCount !== sourceIds.length
    || !Array.isArray(audit.stableIds)) throw new Error('audit counts do not reconcile to the master manifest');
  equalIds(audit.stableIds as string[], sourceIds, 'audit stableIds');
  const batches = session.batches as Array<{ batchNumber: number; sourceIds: string[] }>;
  const selected = batches[batchNumber - 1];
  if (!selected) throw new Error(`batch ${batchNumber} does not exist`);
  const byId = new Map(itemIds.map((id, index) => [id, items[index]]));
  const queueById = new Map(queueIds.map((id, index) => [id, queue[index]]));
  const savedResearch = record(payload.savedResearch, 'savedResearch');
  if (savedResearch.schemaVersion !== 1) throw new Error('Unsupported savedResearch schema');
  const savedLots = record(savedResearch.lots, 'savedResearch.lots');
  const savedAuctions = record(savedResearch.auctions, 'savedResearch.auctions');
  const scopeId = typeof context.scopeId === 'string' && context.scopeId.trim() ? context.scopeId.trim() : null;
  const selectedSaleIds = itemSaleIds(items, selected.sourceIds, scopeId);
  for (const id of Object.keys(savedLots)) if (!sourceIds.includes(id)) throw new Error('savedResearch contains a lot outside the master manifest');
  const scopedSavedResearch = {
    schemaVersion: savedResearch.schemaVersion,
    lots: Object.fromEntries(Object.entries(savedLots).filter(([id]) => selected.sourceIds.includes(id))),
    auctions: Object.fromEntries(Object.entries(savedAuctions).filter(([id]) => selectedSaleIds.has(id))),
  } as AuctionNinjaExportPayload['savedResearch'];
  return {
    packetType: 'auctionninja-research-batch-audit', packetVersion: 1, batchNumber,
    batchSourceIds: clone(selected.sourceIds), partialBatch: true,
    data: {
      masterContext: clone(payload.context) as AuctionNinjaExportPayload['context'],
      researchSession: clone(payload.researchSession) as ResearchSessionManifest,
      masterAudit: clone(payload.audit) as AuctionNinjaExportPayload['audit'],
      savedResearch: clone(scopedSavedResearch),
      items: selected.sourceIds.map((id) => clone(byId.get(id)!)),
      researchQueue: selected.sourceIds.map((id) => clone(queueById.get(id)!)),
    },
  };
}

export function renderAuctionNinjaResearchBatchPacket(packet: AuctionNinjaResearchBatchPacket): string {
  const searchObservation = `## Search Observation Record

For each attempted search, contentObservationRef must retain an inspectable observation specific to that query: the visible Sold/Completed heading and exact result count, the matching-fewer-words or loading state that prevents an exact count, or the observed challenge/error text. A blocked-after-attempt row also needs accessBlockedReason and accessObservation with the specific visible challenge or access-denied text. For an error page, prefix its actual visible message with "eBay search error:" in contentObservationRef; the word error alone is not evidence. A tab ID, "page visible," or a generated link is not evidence. For each plausible Sold result, retain its original item URL, visible title, condition, date/price display, and whether the original item page was opened; record a concrete identity or paid-price rejection reason. A positive result count without original-page review leaves that candidate unresolved, not researched away. Never turn a card display into an actual paid price.

`;
  const executionOrder = `${EVIDENCE_OUTPUT_CONTRACT}

## Execution Order

Complete one source ID at a time. First open its source lot and every copied physical-photo URL in sellerOrdinal order, recording actual UTC open/observation times and a visible product fact or a real browser/image access failure. Then run and record its Sold+Completed searches, inspect plausible original sold pages, and only then move to the next source ID. If the first query shows matching-fewer-words cards or no dependable exact count, try one shorter Sold+Completed query that preserves the photographed identity: brand and model, or book title plus author/ISBN, or the distinctive maker and object type. Record both attempts with their own URLs and times under the same source ID and queryGroupId; do not turn the fallback into a zero-result claim. Inspect plausible original sold item pages from either query before concluding that no suitable paid comp was found. Do not spend the whole batch on searches and leave photo review for later. Do not use accessFailure for a photo you never attempted to open; leave that lot pending and continue it before claiming batch completion. A clearly rendered primary exact zero remains executed/empty/0 even with a separate broader matching-fewer-words section. Do not add broader cards to the exact count or erase a known primary count. Only an actually unavailable, uncertain, conflicting or loading primary count is deferred with null count. A saved partial checkpoint is not completion; continue from its first unfinished lot.

`;
  const paidProofRules = `## Paid-Sale Validation Fields

The stricter fields here govern soldProof. Record quantity: 1, transactionQuantity: 1, and totalSold: 1 only when the original sale proves one sold unit. For a single fixed-price sale, open the expanded original eBay listing via See original listing and record originalListingObservation with its exact itemUrl and itemId, observedAt, exact visible priceText, exact visible offerText, offerState: none, and explicit singleTransactionEvidence. The expanded item URL, sale date, observation time, price, and one-sale evidence must all reconcile. Use priceSource: original-item-fixed-price and offerStatus: none only when those fields visibly prove one fixed-price transaction. If the expanded listing says Best Offer accepted, the displayed price is not the paid amount: set paidPrice to null and do not claim fixed-price soldProof. For an accepted offer, use priceSource: seller-hub-actual-paid and offerStatus: accepted-offer only after a matching executed Seller Hub SOLD search. sellerHubPaidProof must contain the same itemId, the observed Seller Hub URL with marketplace=EBAY-US and tabName=SOLD, totalSold: 1, actualPaidPriceUsd, observedAt, and item-specific rowEvidence. Unknown sale count, display/listing price, or unverified accepted offer means no verified soldProof. Do not infer these fields from a Sold search card or invent an observation you did not visibly collect.

`;
  const ledgerShape = `## Ledger Field Check

Use a different attemptId for every navigation, including a challenge followed by a retry of the same query; keep both rows and their actual timestamps. In photoReviews, the URL key is exactly fullResolutionUrl, copied byte-for-byte from the matching physicalPhotoDescriptors entry. Do not use exactCopiedFullResolutionUrl or a renamed key. openedAt and observedAt must be actual ISO timestamps from opening that individual full-resolution URL. A source gallery thumbnail, copied URL, or unloaded image does not count as opening that photo. Do not fill unvisited photos with null times, invented accessFailure, or placeholder review rows. For soldProof, the original eBay item URL key is url; it must match itemId. Continue the photo work before claiming a complete batch; if it cannot be finished, report an incomplete checkpoint rather than a validated evidence ledger. Before submission, check unique attemptIds, exact photo URL/key/ordinal matches, non-null photo times, and photoAudit totals against the copied descriptors.

`;
  return renderAuctionNinjaResearchBatchPacketBase(packet)
    .replace('## Exact Research Contract', `${executionOrder}## Exact Research Contract`)
    .replace('## Immutable Packet Data', `${searchObservation}${paidProofRules}${ledgerShape}${COMPONENT_RESEARCH_CONTRACT}\n\n## Immutable Packet Data`);
}

function renderAuctionNinjaResearchBatchPacketBase(packet: AuctionNinjaResearchBatchPacket): string {
  return `# AuctionNinja Research Batch Audit Packet\n\n**Status:** audit-only partial batch ${packet.batchNumber}; ${packet.batchSourceIds.length} of the manifest's ${packet.data.researchSession.sourceIds.length} IDs. This packet cannot conclude auction-wide completion. Do not bid, buy, publish, contact anyone, or mutate an account.\n\nThe researchSession is immutable source provenance. Research, photo review, sold-proof checks, and decisions are scoped only to the selected batch IDs. Do not claim other IDs were searched or reviewed.\n\n## Exact Research Contract\n\n- Work every selected merchandise source ID in researchQueue, opening its eBay Sold + Completed query in a supported browser. A generated link is not an attempted search. Record seller-page and Amazon visits separately; attemptLedger is for eBay Sold searches only.\n- Emit a named JSON attemptLedger with sourceId, attemptId, outcome, attemptSource, actualQueryUrl, executedQuery, displayedQuery, attemptedAt, observedAt, finalUrl, observedStatus, observedResultCount, contentObservationRef, queryGroupId, and applicabilityConfirmed. attemptSource must be ebay-public-sold or ebay-seller-hub-product-research-sold. Copy queryGroupId from researchSession.queryGroups for that source ID; do not invent one.\n- Use only outcomes executed, blocked-after-attempt, deferred, unattempted and statuses settled, empty, access-blocked, loading, parse-gap, error, unattempted. Pair executed only with settled (positive observedResultCount) or empty (zero observedResultCount). Pair a parse-gap, loading, or error status with deferred and observedResultCount: null, even when the search page opened successfully; it records an attempted but unsettled search, not a completed result. Pair access-blocked with blocked-after-attempt and observedResultCount: null. Keep broader fallback cards separate from the exact count; a clearly rendered primary exact zero remains executed/empty/0.\n- Read the UTC clock immediately before each navigation and when that page settles. Record those two readings, not rounded or reused timestamps generated while writing the ledger. If either reading is unavailable, leave the missing clock null in an invalid/incomplete checkpoint requiring re-observation; preserve the real attempt and never manufacture execution timing.\n- Preserve the submitted URL in actualQueryUrl and the observed page URL in finalUrl. If eBay visibly corrects a query, retain both strings and describe the correction in queryNormalizationEvidence.\n- Emit photoReviews (plural) as one JSON array with exactly one row per copied physicalPhotoDescriptors entry. Each row must have sourceId, ordinal equal to that descriptor's sellerOrdinal, the exact copied fullResolutionUrl, openedAt, observedAt, and a product-specific visibleFact or explicit accessFailure. Never renumber or re-sort gallery photos. Image dimensions or load status alone are not a visible product fact, and a captured URL is not proof a photo was viewed. Include photoAudit with numeric expectedPhysicalPhotoRows, opened, reviewed, and accessFailures; reconcile these to the rows. AuctionNinja gallery counts may remain provider-unverified.\n- For each lot, use its physical seller photos to check brand, model, generation, quantity, and accessories before accepting Amazon or eBay evidence. If a photo conflicts with seller title or UPC, retain the conflict and reject mismatched comps; product art is not proof an illustrated accessory is included.\n- Emit soldProof only for one completed transaction with actual paid amount, original eBay item ID/URL, sold date, paidPrice, USD currency, quantity: 1, identity differences, observedAt, and pageEvidence. A Best Offer accepted banner or struck-through display price does not reveal the accepted offer: set paidPrice to null and do not claim verified sold proof unless a matching item-specific Seller Hub Product Research Sold row independently proves totalSold=1 and the actual paid amount. Multi-sale averages, Sold cards, asking prices, retail/MSRP, snippets, and discounts are not single-sale paid proof.\n- Keep unknown costs unknown. A partial checkpoint remains incomplete and cannot be presented as a finished batch or auction. Do not request credentials, mutate accounts, or bypass a persistent challenge.\n\n## Immutable Packet Data\n\n\`\`\`json\n${JSON.stringify(packet.data, null, 2)}\n\`\`\`\n`;
}
