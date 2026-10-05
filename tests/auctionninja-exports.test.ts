import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_SETTINGS } from '../src/core/settings.js';
import type { ScrapeJobSummary } from '../src/core/types.js';
import { buildAuctionNinjaExportPayload, buildAuctionNinjaLlmBrief, buildAuctionNinjaResearchQueue } from '../src/auctionninja/exports.js';
import { auctionNinjaRouteFingerprint, resolveAuctionNinjaPage } from '../src/auctionninja/route.js';
import type { AuctionNinjaLotRecord, AuctionNinjaSaleRecord } from '../src/auctionninja/types.js';

const url = 'https://www.auctionninja.com/testseller/sales/details/summer-sale--17395.html?an=opaque-secret';
const route = resolveAuctionNinjaPage(url);
const fingerprint = auctionNinjaRouteFingerprint(route, url);

function lot(id = '1001'): AuctionNinjaLotRecord {
  return {
    source: 'AuctionNinja', pageKind: 'sale-catalog', id, stableId: id, lot: '6',
    title: 'SteelSeries Arctis Nova 7', url: `https://www.auctionninja.com/testseller/product/headset--${id}.html?an=opaque-secret`,
    image: 'https://www.auctionninja.com/Pictures/headset-front.jpg?an=opaque-secret',
    images: ['https://www.auctionninja.com/Pictures/headset-front.jpg?an=opaque-secret', 'https://www.auctionninja.com/Pictures/headset-back.jpg'],
    description: 'Condition: New - Factory Sealed\nEmail owner@example.invalid for pickup.',
    descriptionHtml: '<p>Condition: New - Factory Sealed</p>',
    descriptionFields: { condition: 'New - Factory Sealed', packaging: 'Yes', assemblyRequired: '', damaged: '', functional: 'Yes', missingParts: 'No', shelfLocation: '' },
    category: 'Electronics', saleTitle: 'Summer Sale', saleUrl: url, seller: 'Test Seller', sellerUrl: 'https://www.auctionninja.com/testseller',
    location: 'Carteret, NJ', shippingText: 'Shipping Available', pickupText: 'Pickup available', highBid: '$5.00', highBidAmount: 5,
    currentBid: 5, currentPrice: 5, bidCount: '2 Bids', bidCountNumber: 2, timeLeft: '1 day', timeText: '1 day', status: 'OPEN', watched: false,
    detailEnriched: true, detailSource: 'same-origin-product-document', rawText: 'Current Bid: $5.00', extractionAudit: {
      sourceUrl: url, cardSelector: '.search-catalog-item-box', fieldsPresent: ['lot', 'title', 'url', 'description', 'image'], missingFields: []
    }
  };
}

function job(overrides: Partial<ScrapeJobSummary> = {}): ScrapeJobSummary {
  return {
    jobId: 'job-1', schemaVersion: 1, tabId: 1, sourceUrl: url, fingerprint, routeKind: 'catalog', scopeId: '17395', phase: 'completed', revision: 3,
    expectedTotal: 1, enumeratedCount: 1, hydratedCount: 1, message: 'done', errorCode: '', startedAt: 1, updatedAt: 2, completedAt: 2, ...overrides
  };
}

function context() {
  return { source: 'AuctionNinja' as const, pageKind: 'sale-catalog' as const, url, title: 'Summer Sale', fingerprint, expectedTotal: 1, scopeId: '17395' };
}

function saleRecord(id: string): AuctionNinjaSaleRecord {
  return {
    source: 'AuctionNinja', pageKind: 'auction-search', id, stableId: id,
    title: `Sale ${id}`, url: `https://www.auctionninja.com/testseller/sales/details/sale-${id}--${id}.html`,
    image: 'https://www.auctionninja.com/Pictures/sale.jpg', seller: 'Test Seller',
    sellerUrl: 'https://www.auctionninja.com/testseller', location: 'Carteret, NJ',
    shippingText: 'Shipping Available', closingText: 'Closes tomorrow', itemCount: 12, rawText: `Sale ${id}`,
  };
}

test('builds a complete AuctionNinja payload with queue links, provenance, fidelity, and full media', () => {
  const payload = buildAuctionNinjaExportPayload(context(), job(), [lot()], DEFAULT_SETTINGS, {
    schemaVersion: 1,
    lots: { '1001': { queryOverride: 'SteelSeries Nova 7', hardMaxBidUsd: 40, sources: { queryOverride: 'flippah-lot-settings', hardMaxBidUsd: 'legacy-watchlist' } } },
    auctions: { '17395': { buyerPremiumOverridePct: 15, source: 'flippah-auction-settings' } }
  });
  assert.equal(payload.context.source, 'AuctionNinja');
  assert.equal(payload.context.complete, true);
  assert.equal(payload.context.expectedCount, 1);
  assert.equal(payload.audit.uniqueItemCount, 1);
  assert.equal(payload.audit.fidelity.metrics.description.percent, 100);
  assert.equal(payload.audit.fidelity.metrics.images.percent, 100);
  assert.ok('images' in payload.items[0]!);
  assert.deepEqual(payload.items[0]!.images, [
    'https://www.auctionninja.com/Pictures/headset-front.jpg',
    'https://www.auctionninja.com/Pictures/headset-back.jpg'
  ]);
  assert.equal(payload.researchQueue[0]!.querySource, 'saved-lot-override');
  assert.match(payload.researchQueue[0]!.ebaySoldUrl || '', /LH_Sold=1/);
  assert.deepEqual(payload.researchQueue[0]!.savedResearchProvenance, ['hardMaxBidUsd:legacy-watchlist', 'queryOverride:flippah-lot-settings']);
  assert.equal(payload.savedResearch.auctions['17395']!.source, 'flippah-auction-settings');
});

test('reopening AuctionNinja Copy preserves the scrape job research-session start', () => {
  const sourceJob = job({ startedAt: Date.now() - 10_000 });
  const first = buildAuctionNinjaExportPayload(context(), sourceJob, [lot()], DEFAULT_SETTINGS);
  const second = buildAuctionNinjaExportPayload(context(), sourceJob, [lot()], DEFAULT_SETTINGS);
  assert.equal(first.researchSession.sessionStartedAt, new Date(sourceJob.startedAt).toISOString());
  assert.deepEqual(second.researchSession, first.researchSession);
});

test('AuctionNinja AI brief requires fresh lot and pickup terms before a bid recommendation', () => {
  const payload = buildAuctionNinjaExportPayload(context(), job(), [lot()], DEFAULT_SETTINGS);
  const brief = buildAuctionNinjaLlmBrief(payload, DEFAULT_SETTINGS);
  assert.match(brief, /raw action-log row with actionID, sourceID, requestURL, and the actual UTC openclock/);
  assert.match(brief, /actual UTC observedclock, literal photo-specific visible fact or query-specific result evidence/);
  assert.match(brief, /downloaded or opened image that was not visually inspected remains pending/);
  assert.match(brief, /Before presenting an actionable bid, profit, or maximum bid, reopen the exact source lot and auction terms/);
  assert.match(brief, /Compare live status, current or winning bid, buyer premium, per-lot fees, tax basis, shipping or pickup location and dates, and closing time/);
  assert.match(brief, /preserve the original capture as historical/);
  assert.match(brief, /If the lot closed or live terms cannot be verified, do not recommend a bid/);
});

test('AI brief removes only photo renditions represented by complete descriptors', () => {
  const payload = buildAuctionNinjaExportPayload(context(), job(), [lot()], DEFAULT_SETTINGS);
  const item = payload.items[0] as Record<string, any>;
  const root = 'https://www.pictureserver1.auctionninja.com/pictureserver/testseller/Pictures/';
  item.physicalPhotoDescriptors = [{
    sellerOrdinal: 1, fullResolutionUrl: `${root}headset.jpg`,
    knownImageUrl: `${root}headset.jpg`, thumbnailUrl: `${root}Thumb_Big/headset.jpg`, source: 'dom-gallery',
  }];
  item.images = [
    `${root}Thumbs/headset.jpg`, `${root}headset.jpg`,
    `${root}Thumb_Big/headset.jpg`, `${root}Thumb_Small/headset.jpg`,
  ];
  item.image = `${root}Thumb_Small/headset.jpg`;
  const copyJson = JSON.stringify(payload);
  const embedded = (brief: string) => JSON.parse([...brief.matchAll(/```json\n([\s\S]*?)\n```/g)].at(-1)![1]!).items[0];

  const compact = embedded(buildAuctionNinjaLlmBrief(payload, DEFAULT_SETTINGS));
  assert.equal('images' in compact, false);
  assert.equal('image' in compact, false);
  assert.equal('knownImageUrl' in compact.physicalPhotoDescriptors[0], false);
  assert.equal(compact.physicalPhotoDescriptors[0].thumbnailUrl, `${root}Thumb_Big/headset.jpg`);
  assert.equal(JSON.stringify(payload), copyJson);

  item.images.push(`${root}unexpected.jpg`);
  const withExtra = embedded(buildAuctionNinjaLlmBrief(payload, DEFAULT_SETTINGS));
  assert.ok(withExtra.images.includes(`${root}unexpected.jpg`));
  item.images.pop();
  item.physicalPhotoDescriptors[0].thumbnailUrl = null;
  const withMissingFallback = embedded(buildAuctionNinjaLlmBrief(payload, DEFAULT_SETTINGS));
  assert.deepEqual(withMissingFallback.images, item.images);
  assert.equal(withMissingFallback.image, item.image);
});

test('AI brief retains unique or unverified image URLs', () => {
  const root = 'https://www.pictureserver1.auctionninja.com/pictureserver/testseller/Pictures/';
  const embedded = (brief: string) => JSON.parse([...brief.matchAll(/```json\n([\s\S]*?)\n```/g)].at(-1)![1]!).items[0];
  const cases = [
    { thumbnailUrl: `${root}Thumb_Big/other.jpg`, image: `${root}Thumbs/headset.jpg` },
    { thumbnailUrl: 'not a URL', image: `${root}Thumbs/headset.jpg` },
    { thumbnailUrl: `${root}Thumb_Big/headset.jpg`, image: 'https://other.example/pictures/Thumbs/headset.jpg' },
    { thumbnailUrl: `${root}Thumb_Big/headset.jpg`, image: `${root}thumbs/headset.jpg` },
    { thumbnailUrl: `${root}Thumb_Big/headset.jpg`, image: `${root}Thumbs/headset.jpg?variant=other` },
  ];
  for (const testCase of cases) {
    const payload = buildAuctionNinjaExportPayload(context(), job(), [lot()], DEFAULT_SETTINGS);
    const item = payload.items[0] as Record<string, any>;
    item.physicalPhotoDescriptors = [{ sellerOrdinal: 1, fullResolutionUrl: `${root}headset.jpg`,
      thumbnailUrl: testCase.thumbnailUrl, knownImageUrl: `${root}headset.jpg`, source: 'dom-gallery' }];
    item.images = [testCase.image];
    item.image = testCase.image;
    const compact = embedded(buildAuctionNinjaLlmBrief(payload, DEFAULT_SETTINGS));
    assert.deepEqual(compact.images, [testCase.image]);
    assert.equal(compact.image, testCase.image);
  }

  const payload = buildAuctionNinjaExportPayload(context(), job(), [lot()], DEFAULT_SETTINGS);
  const item = payload.items[0] as Record<string, any>;
  item.physicalPhotoDescriptors = [null];
  item.images = [`${root}Thumbs/headset.jpg`];
  item.image = item.images[0];
  assert.deepEqual(embedded(buildAuctionNinjaLlmBrief(payload, DEFAULT_SETTINGS)).images, item.images);

  item.physicalPhotoDescriptors = [
    { sellerOrdinal: 1, fullResolutionUrl: `${root}headset.jpg`, thumbnailUrl: `${root}Thumb_Big/headset.jpg`, knownImageUrl: `${root}headset.jpg`, source: 'dom-gallery' },
    { sellerOrdinal: 2, fullResolutionUrl: `${root}headset.jpg`, thumbnailUrl: `${root}Thumb_Big/headset.jpg`, knownImageUrl: `${root}headset.jpg`, source: 'dom-gallery' },
  ];
  const duplicateDescriptors = embedded(buildAuctionNinjaLlmBrief(payload, DEFAULT_SETTINGS));
  assert.deepEqual(duplicateDescriptors.images, item.images);
  assert.equal(duplicateDescriptors.image, item.image);

  item.physicalPhotoDescriptors = [{ sellerOrdinal: 1, fullResolutionUrl: `${root}headset.jpg`,
    thumbnailUrl: `${root}Thumb_Big/headset.jpg`, knownImageUrl: `${root}other-view.jpg`, source: 'dom-gallery' }];
  const distinctKnownImage = embedded(buildAuctionNinjaLlmBrief(payload, DEFAULT_SETTINGS));
  assert.equal(distinctKnownImage.physicalPhotoDescriptors[0].knownImageUrl, `${root}other-view.jpg`);
});

test('research queue uses description identity when the title is generic', () => {
  const item = { ...lot(), title: 'Miscellaneous', description: 'Manufacturer: Onkyo\nModel Number: TX-SR304\nAV receiver' };
  const queue = buildAuctionNinjaResearchQueue([item]);
  assert.equal(queue[0]?.query, 'onkyo tx-sr304');
  assert.match(queue[0]?.ebaySoldUrl || '', /onkyo%20tx-sr304/);
});

test('AuctionNinja export keeps an instruction lot but omits product searches', () => {
  const item = {
    ...lot(), title: 'No Shipping Local Pickup Only',
    description: '',
    physicalPhotoDescriptors: [{ sellerOrdinal: 1, fullResolutionUrl: 'https://www.auctionninja.com/Pictures/notice.jpg', knownImageUrl: 'https://www.auctionninja.com/Pictures/notice.jpg', thumbnailUrl: null, source: 'dom-gallery' as const }],
  };
  const queue = buildAuctionNinjaResearchQueue([item]);
  assert.equal(queue.length, 1);
  assert.equal(queue[0]!.mode, 'unsearchable');
  assert.match(queue[0]!.nonMerchandiseReason || '', /Local-pickup notice/);
  assert.equal(queue[0]!.ebaySoldUrl, null);
  assert.equal(queue[0]!.amazonSearchUrl, null);
});

test('AuctionNinja keeps sale-search records as unresolved catalog-discovery work', () => {
  const sales = Array.from({ length: 8 }, (_, index) => saleRecord(`sale-${index + 1}`));
  const searchUrl = 'https://www.auctionninja.com/auctions/search?query=tools';
  const searchRoute = resolveAuctionNinjaPage(searchUrl);
  const searchFingerprint = auctionNinjaRouteFingerprint(searchRoute, searchUrl);
  const searchContext = {
    source: 'AuctionNinja' as const, pageKind: 'auction-search' as const, url: searchUrl,
    title: 'Tool sales', fingerprint: searchFingerprint, expectedTotal: sales.length, scopeId: null,
  };
  const payload = buildAuctionNinjaExportPayload(searchContext, job({
    sourceUrl: searchUrl, fingerprint: searchFingerprint, scopeId: null, expectedTotal: sales.length,
  }), sales, DEFAULT_SETTINGS);
  assert.equal(payload.researchQueue.length, 8);
  assert.deepEqual(payload.researchSession.sourceIds, sales.map((sale) => sale.stableId));
  assert.deepEqual(payload.researchSession.merchandiseIds, []);
  assert.deepEqual(payload.researchSession.catalogDiscoveryIds, sales.map((sale) => sale.stableId));
  assert.equal(payload.researchSession.informationalExclusions.length, 0);
  assert.match(payload.researchQueue[0]!.componentReviewReasons[0]!, /catalog discovery/i);
  assert.match(buildAuctionNinjaLlmBrief(payload, DEFAULT_SETTINGS), /An auction-search sale record is a catalog-discovery task/);
});

test('AuctionNinja keeps product evidence when a notice-like title has a merchandise description', () => {
  const item = {
    ...lot(), title: 'Shipping Available!',
    description: 'DeWalt DCD791 cordless drill. Shipping and handling costs will be charged when items are packed.',
    physicalPhotoDescriptors: [{ sellerOrdinal: 1, fullResolutionUrl: 'https://www.auctionninja.com/Pictures/drill.jpg', knownImageUrl: 'https://www.auctionninja.com/Pictures/drill.jpg', thumbnailUrl: null, source: 'dom-gallery' as const }],
  };
  const queue = buildAuctionNinjaResearchQueue([item]);
  assert.equal(queue[0]!.nonMerchandiseReason, null);
  assert.equal(queue[0]!.mode, 'item');
  assert.match(queue[0]!.query, /dewalt dcd791/i);
});

test('LLM export states the evidence, mixed-lot, workbook, provenance, and no-mutation contracts', () => {
  const payload = buildAuctionNinjaExportPayload(context(), job(), [lot()], DEFAULT_SETTINGS);
  const brief = buildAuctionNinjaLlmBrief(payload, DEFAULT_SETTINGS);
  const firstBatch = brief.indexOf('## FIRST BATCH OUTPUT CONTRACT');
  const manifest = brief.indexOf('## RESEARCH SESSION MANIFEST');
  assert.ok(firstBatch >= 0 && firstBatch < manifest, 'ledger and photo rules must precede the large manifest');
  assert.match(brief, /copy queryGroupId only when the manifest supplies one; never invent a group for component-review or informational rows/);
  assert.match(brief, /Give every attempted row a globally unique attemptId/);
  assert.match(brief, /A zero exact-result heading requires observedStatus empty even if broader fallback cards appear/);
  assert.match(brief, /clearly rendered exact Sold\+Completed primary count remains known, including zero, even when separate broader cards appear/);
  assert.match(brief, /use executed with observedStatus empty and observedResultCount 0 for a clearly rendered primary zero/);
  assert.match(brief, /broader cards never merge into the exact count/);
  assert.match(brief, /Only when the primary exact count is actually unavailable, uncertain, conflicting or still loading, use deferred/);
  assert.match(brief, /a row with false applicability is an uncredited lead until source evidence establishes the match/);
  assert.match(brief, /Record the reviewed photo descriptor IDs and do not set applicabilityConfirmed to true from the title alone/);
  assert.match(brief, /A missing attemptedAt or observedAt, or an uncertain result count, cannot be an executed search/);
  const startHere = brief.indexOf('## START HERE — EXECUTE BEFORE BUILDING THE WORKBOOK');
  const workflow = brief.indexOf('## EFFICIENT, COMPLETE RESEARCH WORKFLOW');
  assert.ok(startHere >= 0 && startHere < workflow, 'start-here protocol must precede the detailed workflow');
  assert.match(brief, /array of JSON objects with the named fields specified below, never positional arrays or headerless rows/);
  assert.match(brief, /observedStatus must be exactly settled, empty, loading, access-blocked, parse-gap, error, or unattempted/);
  assert.match(brief, /outcome is executed, blocked-after-attempt, excluded-informational, deferred, or unattempted/);
  assert.match(brief, /attemptSource is ebay-public-sold or ebay-seller-hub-product-research-sold/);
  assert.match(brief, /Each distinct positive-results search needs its own specific visible result fact or unique screenshot\/artifact reference/);
  assert.match(brief, /Read the UTC clock immediately before each search navigation and again when its settled content is observed/);
  assert.match(brief, /write a separate attempt object and globally unique attemptId per source ID/);
  assert.match(brief, /queryGroupId links the shared search without reusing an attemptId/);
  assert.match(brief, /This confirms search applicability, not a matching sold item or paid price/);
  assert.match(brief, /Split every supplied manifest into disjoint batches of at most 8 source IDs/);
  assert.match(brief, /assign up to three batches concurrently with only those source records and this evidence contract/);
  assert.match(brief, /do not present one finished batch or a partial workbook as auction completion/i);
  assert.match(brief, /prove each settled rendered Sold \+ Completed search/i);
  assert.match(brief, /actual execution\/observation timestamp/);
  assert.match(brief, /If raw HTTP returns 403 or a challenge, stop raw requests and fall back/);
  assert.match(brief, /noninteractive "Checking your browser" interstitial may redirect automatically/);
  assert.match(brief, /observe its final navigation and settled page before deciding whether access is blocked/);
  assert.match(brief, /A transient interstitial that resolves to the requested settled Sold page is an executed search, not a block/);
  assert.match(brief, /Seller Hub Product Research may initially show a server-error heading even when its search form is usable/);
  assert.match(brief, /submit it once through the normal UI and then inspect the settled Sold tab and result table/);
  assert.match(brief, /A stale error heading does not override a populated Sold table/);
  assert.match(brief, /record a loading\/parse\/server error with a null result count, not zero results or an access block/);
  assert.match(brief, /use these exact attempt-ledger field names: sourceId, attemptId.*actualQueryUrl.*displayedQuery.*finalUrl.*contentObservationRef/);
  assert.match(brief, /accessBlockedReason and accessObservation/);
  assert.match(brief, /Do not use queryURL\/finalURL aliases in the machine ledger/);
  assert.doesNotMatch(brief, /with queryURL, finalURL/);
  assert.doesNotMatch(brief, /finalURL means the observed final navigation/);
  assert.match(brief, /If no supported browser is available, mark remaining queries unattempted, report research-incomplete, and never invent sold, profit, or bid values/);
  assert.match(brief, /If both Sold research surfaces are unavailable, continue independent work on every lot/);
  assert.match(brief, /Do not stop after writing unattempted Sold rows/);
  assert.match(brief, /log that public query as access-blocked/);
  assert.match(brief, /do not call it zero results, retry it, or bypass the challenge/);
  assert.match(brief, /Product Research Sold is independently available/);
  assert.match(brief, /separate bounded attempt for the same product identity/);
  assert.match(brief, /US marketplace, date range and filters, row identity or stable listing identity/);
  assert.match(brief, /actual paid price/);
  assert.match(brief, /If both the public Sold \+ Completed surface and Product Research Sold are unavailable, mark the remaining queries unattempted/);
  assert.match(brief, /Run two ordered passes across the entire manifest/);
  assert.match(brief, /Pass 1: in each batch, read every source description and enough original seller photos/);
  assert.match(brief, /Record queryNormalizationEvidence describing that visible correction even when the URL stays unchanged/);
  assert.match(brief, /REWRITE_START/);
  assert.match(brief, /those cards are not exact-identity comps merely because Sold is selected/);
  assert.match(brief, /retry a short quoted product phrase supported by the source description and seller photos/);
  assert.match(brief, /If no variant remains, stop searching; leave identity unresolved only when original-page and source-photo verification has not established it/);
  assert.match(brief, /loading\/error\/parse gap.*is deferred: it may advance the first-pass scheduler.*does not satisfy search coverage/);
  assert.match(brief, /Finish this first-pass outcome for all merchandise IDs in all batches before spending a second query or opening promising original sold-item pages/);
  assert.match(brief, /Pass 2: return to each batch, review every remaining seller photo and identifiable mixed-lot component/);
  assert.match(brief, /verify paid amount\/identity\/condition\/quantity/);
  assert.match(brief, /Reconcile both passes against the full manifest, including full photo and component coverage/);
  assert.match(brief, /Pass 1 is progress, not completion or permission to value a lot/);
  assert.match(brief, /Complete full physical-photo review before accepting any comparable sale or valuation/);
  assert.match(brief, /After every Pass 1 batch, reconcile merchandise IDs/);
  assert.match(brief, /do not gate Pass 1 on complete photos, original sold pages, components, economics, or active-ask review/);
  assert.match(brief, /revisit deferred or missing searches before the final full-manifest decision/);
  for (const phrase of ['AuctionNinja', 'researchQueue', 'direct, visible eBay sold-listing URL', 'mandatory component review', 'profit_if_won_now', 'COMPACT WORKBOOK CONTRACT', 'savedResearch.lots', 'Do not bid', 'DATA BOUNDARY']) {
    assert.match(brief, new RegExp(phrase, 'i'));
  }
  assert.match(brief, /Or Best Offer.*not paid-price proof from a public listing/i);
  assert.match(brief, /or a matching Seller Hub Product Research Sold row with actual paid-price provenance/);
  assert.match(brief, /A one-sale row can verify that item's paid amount; a multi-sale row's average is not each individual transaction price/);
  assert.match(brief, /a SOLD banner beside a listing price does not establish a transaction's paid amount when the original page says 2 sold or more/);
  assert.match(brief, /no multi-sale or offer ambiguity and matching physical identity and condition/);
  assert.match(brief, /listingSoldCount observed on the expanded original page, paidPriceSource, paidAmount/);
  assert.match(brief, /SOLD US \$14\.99.*2 sold.*paidAmount null, not \$14\.99/);
  assert.doesNotMatch(brief, /if it opens with an explicit sold banner and matching dated price, accept the sale/);
  assert.match(brief, /Alt text and captions may guide photo navigation only; they are not visual proof/);
  assert.match(brief, /discovery-engine query is separate from the marketplace URL actually opened/);
  assert.match(brief, /finalUrl means the observed final navigation, not a discovered candidate URL/);
  assert.match(brief, /attemptedAt is null; recordedAt is a separate recording timestamp and must not be backfilled/);
  assert.match(brief, /hidden accepted-offer warning on either surface overrides a plain displayed price/);
  assert.match(brief, /active multi-quantity listing with previous sales does not establish the historical transaction price/);
  assert.match(brief, /lifecycle conflict, not proof that no sale ever happened/);
  assert.match(brief, /Tie each visual finding to its photo descriptor or numbered source URL/);
  assert.match(brief, /power-on\/no-signal screen with full functional testing/);
  assert.match(brief, /Keep unavailable result counts null, not zero/);
  assert.match(brief, /If any raw HTTP request returns 403 or a challenge, stop the raw HTTP burst immediately/);
  assert.match(brief, /Deduplicate identical query URLs, pace remaining requests, and isolate each query's outcome to its own stable ID/);
  assert.match(brief, /Use a supported rendered browser when available; if it is unavailable, mark the remaining queries unattempted rather than blocked/);
  assert.match(brief, /Record attemptedAt and observedAt for each query from that query's actual execution or observation, never from a pre-batch timestamp/);
  assert.match(brief, /Immediately after each query is actually executed and its page is observed, persist one row before navigating to another query/);
  assert.match(brief, /finalUrl, observedStatus, observedResultCount, and contentObservationRef/);
  assert.match(brief, /A later summary must not reconstruct missing observations from a batch timestamp or a search URL/);
  assert.match(brief, /Read the current clock when writing generatedAt and recordedAt/);
  assert.match(brief, /Visiting the Sold result page alone is never original-item review or verified sold proof/);
  assert.match(brief, /A Sold result-page visit does not count as physical-photo review/);
  assert.match(brief, /zero-exact-match heading may still precede broader fallback results/);
  assert.match(brief, /Record both requested and final URLs/);
  assert.match(brief, /redirect to a product catalog or different listing is not proof of the original sale/);
  assert.match(brief, /Compare critical specifications from the description as well as the title/);
  assert.match(brief, /56Y is not 56J/);
  assert.match(brief, /Compatibility and optional-accessory language do not establish inclusion/);
  assert.match(brief, /Do not finalize while physical photos remain unreviewed/);
  assert.match(brief, /photoAudit must be present, verified\/reconciled, and count-matched before claiming complete photo coverage/);
  assert.match(brief, /If photoAudit is absent, unverified, or mismatched, verify the gallery or exact-lot detail page, or explicitly mark photo coverage unknown\/incomplete/);
  assert.match(brief, /A thumbnail-only fixture is not proof of a complete 1\/1 review/);
  assert.match(brief, /Separate attempt coverage from evidence completeness/);
  assert.match(brief, /research-complete-with-access-gaps is allowed only after every required query, promising candidate opening, photo, and component review is attempted\/completed/);
  assert.match(brief, /unattempted\/deferred query, unopened promising candidate, or incomplete photo\/component review keeps final status research-incomplete/);
  assert.match(brief, /every merchandise ID must have an Evidence attempt joined by that ID, and the missing-ID set must be empty/);
  assert.match(brief, /One executed search may serve multiple IDs only when each lot's identity and condition are independently checked for applicability/);
  assert.match(brief, /A checkpoint may be saved, but is not the final deliverable/);
  assert.match(brief, /Do not duplicate the same source ID and requested URL as separate attempts unless a real retry has its own execution time and reason/);
  assert.match(brief, /for every shortlist item link and every Evidence search URL/);
  assert.match(brief, /verify actual native hyperlink targets in both places, not plain URL text or formulas/);
  assert.match(brief, /verify actual native clickable item and Evidence search links; repair any plain URL text or formula link before delivery/);
  const batchGate = brief.indexOf('Run two ordered passes across the entire manifest');
  const workbook = brief.indexOf('## COMPACT WORKBOOK CONTRACT');
  assert.ok(batchGate >= 0 && batchGate < workbook, 'batch evidence gate must precede workbook delivery wording');
  assert.match(brief, /unattempted\/deferred/);
  assert.match(brief, /access-gaps/);
  assert.match(brief, /Do not coach/);
  assert.match(brief, /empty Best Bids.*not no opportunities/i);
  assert.match(brief, /No-proof is not Garbage/);
  assert.doesNotMatch(brief, /opaque-secret|owner@example\.invalid/i);
});

test('AuctionNinja brief adds a post-DATA execution checkpoint after parseable JSON', () => {
  const payload = buildAuctionNinjaExportPayload(context(), job(), [lot()], DEFAULT_SETTINGS);
  const firstBrief = buildAuctionNinjaLlmBrief(payload, DEFAULT_SETTINGS);
  const secondBrief = buildAuctionNinjaLlmBrief(payload, DEFAULT_SETTINGS);
  const firstJsonMatch = firstBrief.match(/```json\n([\s\S]*?)\n```/);
  const secondJsonMatch = secondBrief.match(/```json\n([\s\S]*?)\n```/);
  assert.ok(firstJsonMatch && secondJsonMatch, 'AI brief should contain a DATA JSON block');
  const dataEnd = firstBrief.lastIndexOf('```');
  const footer = firstBrief.indexOf('## POST-DATA EXECUTION CHECKPOINT');

  assert.ok(footer > dataEnd, 'execution checkpoint must follow the DATA fence');
  assert.deepEqual(JSON.parse(firstJsonMatch![1]!), JSON.parse(secondJsonMatch![1]!));
  assert.match(firstBrief.slice(footer), /DATA above is already provided; parse it directly/);
  assert.match(firstBrief.slice(footer), /No local server is needed/);
  assert.match(firstBrief.slice(footer), /start the first manifest batch of at most 8 source IDs/);
  assert.match(firstBrief.slice(footer), /Give every merchandise ID one actually attempted Sold-search outcome across all batches before a second query/);
  assert.match(firstBrief.slice(footer), /parse\/loading\/error gap as deferred.*not credited search coverage/);
  assert.match(firstBrief.slice(footer), /actual search-attempt and per-photo observation evidence/);
  assert.match(firstBrief.slice(footer), /Continue through remaining batches while tools work/);
  assert.match(firstBrief.slice(footer), /generated inventory sheet is only a checkpoint artifact, never research completion/);
  assert.doesNotMatch(firstBrief.slice(footer), /inventory sheet.*research complete(?!ment)/i);
});

test('AuctionNinja LLM export requires explicit per-photo observation evidence', () => {
  const payload = buildAuctionNinjaExportPayload(context(), job(), [lot()], DEFAULT_SETTINGS);
  const brief = buildAuctionNinjaLlmBrief(payload, DEFAULT_SETTINGS);
  const contract = brief.indexOf('## PHOTO EVIDENCE CONTRACT');
  const review = brief.indexOf('## COMPLETE DESCRIPTION, IMAGE, AND MIXED-LOT REVIEW');
  assert.ok(contract >= 0 && contract < review, 'photo contract must precede photo review workflow');
  assert.match(brief, /source stable ID.*seller ordinal or descriptor identity.*source full-resolution URL/);
  assert.match(brief, /actual opened\/reviewed status.*concrete visible fact or the specific access failure/);
  assert.match(brief, /Capture openedAt from the clock immediately before opening the photo and observedAt immediately after inspecting it/);
  assert.match(brief, /top-level photoReviews array with exactly one row per physicalPhotoDescriptors entry/);
  assert.match(brief, /top-level photoAudit with expectedPhysicalPhotoRows, opened, reviewed, and accessFailures/);
  assert.match(brief, /available, opened, and reviewed photos separately/);
  assert.match(brief, /reconcile those counts and rows against the source photoAudit/);
  assert.match(brief, /Never infer visual review from a descriptor, thumbnail, alt text, or photo count/);
  assert.match(brief, /not a reason to repeat giant per-photo instructions for every item/);
});

test('refuses incomplete, drifted, mismatched, duplicate, and out-of-scope exports', () => {
  const cases: Array<[string, Partial<ScrapeJobSummary>, ReturnType<typeof context>, AuctionNinjaLotRecord[]]> = [
    ['phase', { phase: 'hydrating' }, context(), [lot()]],
    ['fingerprint', { fingerprint: 'different' }, context(), [lot()]],
    ['count', { expectedTotal: 2 }, context(), [lot()]],
    ['scope', { scopeId: '99999' }, context(), [lot()]],
    ['duplicate stable id', {}, context(), [lot(), lot()]],
  ];
  for (const [name, jobPatch, page, items] of cases) {
    assert.throws(() => buildAuctionNinjaExportPayload(page, job(jobPatch), items, DEFAULT_SETTINGS), /unverified export/, name);
  }
  assert.throws(() => buildAuctionNinjaExportPayload({ ...context(), source: 'HiBid' as never }, job(), [lot()], DEFAULT_SETTINGS), /unverified export/);
});

test('sanitizes account PII, tokens, and opaque an query values at the export boundary', () => {
  const accountLot = { ...lot(), pageKind: 'followed-items' as const, bidderAlias: 'private-alias', email: 'private@example.invalid', authToken: 'token-value', phone: '201-555-0144' } as AuctionNinjaLotRecord;
  const accountUrl = 'https://www.auctionninja.com/followed-items?an=opaque-secret';
  const accountFingerprint = auctionNinjaRouteFingerprint(resolveAuctionNinjaPage(accountUrl), accountUrl);
  const accountContext = { ...context(), pageKind: 'followed-items' as const, url: accountUrl, fingerprint: accountFingerprint, scopeId: null, expectedTotal: 1 };
  const accountJob = job({ sourceUrl: accountUrl, fingerprint: accountFingerprint, scopeId: null });
  const payload = buildAuctionNinjaExportPayload(accountContext, accountJob, [accountLot], DEFAULT_SETTINGS);
  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /private-alias|private@example\.invalid|token-value|201-555-0144|opaque-secret/i);
  assert.match(serialized, /SteelSeries Arctis Nova 7/);
  assert.match(payload.items[0]!.url, /headset--1001\.html$/);
});

test('requires component review for mixed lots while keeping research queue links available for normal lots', () => {
  const mixed = { ...lot(), title: 'Assorted electronics bundle', description: 'Mixed components: receiver; headphones' };
  const payload = buildAuctionNinjaExportPayload(context(), job(), [mixed], DEFAULT_SETTINGS);
  assert.equal(payload.researchQueue[0]!.mode, 'component-review');
  assert.equal(payload.researchQueue[0]!.query, '');
  assert.deepEqual(payload.researchQueue[0]!.components, ['Assorted electronics bundle']);
  assert.deepEqual(payload.researchSession.merchandiseIds, ['1001']);
  assert.equal(payload.researchSession.informationalExclusions.length, 0);
  const brief = buildAuctionNinjaLlmBrief(payload, DEFAULT_SETTINGS);
  assert.equal(brief.split('## RESEARCH SESSION MANIFEST').length - 1, 1);
  assert.match(brief, /Component-review is still merchandise research: an absent queryGroupId, blank query, or null plannedURL means only that no lot-level plan exists/);
  assert.match(brief, /NEVER waives the research requirement or permits researchComplete/);
  assert.match(brief, /Extract identifiable components from the description and reviewed physical photos, then research each with an identity-bound actual query tied to the lot's sourceId/);
  assert.match(brief, /Truly unidentified components remain explicit unresolved records with the reason; never fabricate an access failure, zero matches, or generic comps\/prices/);
  assert.match(brief, /search the distinguishing identity discovered in photos or description; two generic title searches are not a substitute/);
  assert.match(brief, /join its actual search attemptIds or explicit unresolved reason/);
  assert.match(brief, /never transfer one component's evidence to an unresearched component/);
  assert.match(brief, /Never estimate, round or backfill individual event timestamps after browsing/);
  assert.match(brief, /An original sold-evidence URL must be the observed eBay item URL, not the auction source URL/);
  assert.match(brief, /Unverified candidate observations belong in candidateReview, not soldProof/);
});

test('AuctionNinja mixed-lot queue strips shared pickup boilerplate but preserves album evidence', () => {
  const item = {
    ...lot('4588173'),
    title: '24 Vintage LP Albums - Rock/Folk/Blues - Stevie Nicks, Monkees, John Lennon, Spiro Gyra, Etc',
    description: 'DUE TO POTENTIAL NOR\u2019EASTER RAIN & WIND CONDITIONS, PICKUP DATES ARE NOW OCTOBER 3 (MA) AND OCTOBER 4 (CT).\n24 Vintage LP Albums - Mostly Rock, Blues, and Folk. Includes albums from Stevie Nicks, The Monkees, John Lennon, Spiro Gyra, Linda Ronstadt, Chuck Mangione, and others. In Good Condition.',
  };
  const payload = buildAuctionNinjaExportPayload(context(), job(), [item], DEFAULT_SETTINGS);
  const queue = payload.researchQueue[0]!;
  assert.equal(queue.mode, 'component-review');
  assert.equal(payload.researchSession.merchandiseIds.includes('4588173'), true);
  assert.ok(queue.components.some((component) => /Stevie Nicks/i.test(component)));
  assert.ok(!queue.components.some((component) => /pickup dates|nor\u2019?easter|rain.*wind/i.test(component)));
});
