import { routeFingerprint, toUrl } from '../core/route.js';
import type {
  CoverageAudit,
  HiBidTransport,
  HiBidLotRecord,
  HiBidRoute,
  HiBidScrapeResult,
  LocationLike
} from '../core/types.js';
import type { HiBidPageState } from '../core/types.js';

export const HIBID_SEARCH_ENDPOINT = 'https://hibid-api.io/sr/main/v1/search/lot';
export const HIBID_GRAPHQL_ENDPOINT = 'https://hibid.com/graphql';
export const HIBID_LOT_SEARCH_OPERATION = 'FlippahLotSearch';
export const HIBID_PAGE_SIZE = 100;
export const HIBID_CONCURRENCY = 3;
export const HIBID_RETRIES = 3;

export const HIBID_LOT_SEARCH_QUERY = `
  query FlippahLotSearch(
    $auctionId: Int = null,
    $pageNumber: Int!,
    $pageLength: Int!,
    $category: CategoryId = null,
    $searchText: String = null,
    $zip: String = null,
    $miles: Int = null,
    $shippingOffered: Boolean = false,
    $countryName: String = null,
    $state: String = null,
    $status: AuctionLotStatus = null,
    $sortOrder: EventItemSortOrder = null,
    $filter: AuctionLotFilter = null,
    $isArchive: Boolean = false,
    $countAsView: Boolean = false,
    $hideGoogle: Boolean = false,
    $eventItemIds: [Int!] = null
  ) {
    lotSearch(
      input: {
        auctionId: $auctionId,
        category: $category,
        searchText: $searchText,
        zip: $zip,
        miles: $miles,
        shippingOffered: $shippingOffered,
        countryName: $countryName,
        state: $state,
        status: $status,
        sortOrder: $sortOrder,
        filter: $filter,
        isArchive: $isArchive,
        countAsView: $countAsView,
        hideGoogle: $hideGoogle,
        eventItemIds: $eventItemIds
      },
      pageNumber: $pageNumber,
      pageLength: $pageLength,
      sortDirection: DESC
    ) {
      pagedResults {
        pageLength pageNumber totalCount filteredCount
        results {
          id itemId lotNumber lead description estimate quantity saleOrder
          ringNumber shippingOffered pictureCount distanceMiles
          featuredPicture { description fullSizeLocation hdThumbnailLocation thumbnailLocation width height }
          pictures { description fullSizeLocation hdThumbnailLocation thumbnailLocation width height }
          category { id categoryName fullCategory description uRLPath }
          lotState {
            bidCount highBid minBid buyerBidStatus buyerHighBid isArchived
            isClosed isLive isNotYetLive isOnLiveCatalog isWatching
            priceRealized priceRealizedMessage productStatus productUrl status
            timeLeft timeLeftSeconds timeLeftTitle watchNotes
          }
          auction {
            id eventName description buyerPremium buyerPremiumRate eventAddress
            eventCity eventState eventZip eventDateBegin eventDateEnd eventDateInfo
            checkoutDateInfo previewDateInfo currencyAbbreviation lotCount
            auctioneer { id name address city state postalCode country }
          }
        }
      }
    }
  }
`;

export interface HiBidRequestOptions {
  pageSize?: number;
  eventItemIds?: string[];
}

export interface HiBidSearchRequest {
  query: string | null;
  options: {
    auctionId: number | null;
    auctioneerId: number[] | null;
    categoryId: number | null;
    country: string | null;
    location: { zipcode: string; radius: number } | null;
    portalLocation: null;
    lotType: number[];
    maxBid: null;
    minBid: null;
    page: number;
    shipping: boolean;
    size: number;
    sortOrder: string;
    state: null;
    status: string[];
    siteType: number;
  };
}

export interface HiBidGraphqlVariables {
  auctionId: number | null;
  pageNumber: number;
  pageLength: number;
  category: number | null;
  searchText: string | null;
  zip: string | null;
  miles: number | null;
  shippingOffered: boolean;
  countryName: string | null;
  state: null;
  status: string;
  sortOrder: string;
  filter: string | null;
  isArchive: boolean;
  countAsView: boolean;
  hideGoogle: boolean;
  eventItemIds: number[] | null;
}

interface PageResult {
  page: number;
  total: number | null;
  ids: string[];
  records: unknown[];
  failed?: string;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function boolParam(url: URL, name: string, fallback = false): boolean {
  const value = url.searchParams.get(name);
  if (!value) return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

function archiveParam(url: URL): boolean {
  return boolParam(url, 'archive')
    || boolParam(url, 'isArchive')
    || /(?:^|[-_])archive(?:d)?(?:$|[-_])/i.test(url.searchParams.get('filter') || '');
}

function statusValues(url: URL, route: HiBidRoute): string[] {
  const values = url.searchParams.getAll('status')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  if (values.length) return [...new Set(values)];
  if (route.kind === 'catalog') return ['ALL'];
  if (route.kind === 'livecatalog') return ['OPEN'];
  return ['OPEN', 'UPCOMING'];
}

function cleanSort(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_') || 'LOT_NUMBER';
}

function countryCode(value: string | null): string | null {
  const country = String(value || '').trim();
  if (!country) return null;
  if (/^(?:united states(?: of america)?|usa|us)$/i.test(country)) return 'USA';
  if (/^(?:canada|can)$/i.test(country)) return 'CAN';
  return country;
}

export function buildHibidSearchRequest(
  route: HiBidRoute,
  locationLike: LocationLike | URL | string,
  page = 1,
  size = HIBID_PAGE_SIZE
): HiBidSearchRequest {
  const url = toUrl(locationLike);
  const zip = (url.searchParams.get('zip') || '').trim();
  const miles = numberOrNull(url.searchParams.get('miles')) ?? (zip ? 50 : null);
  const auctionId = numberOrNull(route.auctionId);
  const categoryId = numberOrNull(route.categoryId);
  return {
    query: (url.searchParams.get('q') || '').trim() || null,
    options: {
      auctionId,
      auctioneerId: route.portalAuctioneerIds.length ? route.portalAuctioneerIds.map(Number).filter(Number.isFinite) : null,
      categoryId,
      country: countryCode(url.searchParams.get('countryname')),
      location: zip ? { zipcode: zip, radius: miles ?? 50 } : null,
      portalLocation: null,
      lotType: [0],
      maxBid: null,
      minBid: null,
      page: Math.max(1, Math.trunc(page)),
      shipping: boolParam(url, 'shippingoffered'),
      size: Math.max(1, Math.min(HIBID_PAGE_SIZE, Math.trunc(size) || HIBID_PAGE_SIZE)),
      sortOrder: cleanSort(url.searchParams.get('s') || (route.kind === 'catalog' ? 'LOT_NUMBER' : 'NO_ORDER')),
      state: null,
      status: statusValues(url, route),
      siteType: route.siteType
    }
  };
}

export function buildHibidGraphqlVariables(
  route: HiBidRoute,
  locationLike: LocationLike | URL | string,
  page = 1,
  options: HiBidRequestOptions = {}
): HiBidGraphqlVariables {
  const url = toUrl(locationLike);
  const ids = options.eventItemIds?.map((id) => Number(id)).filter(Number.isFinite) ?? null;
  const hydrating = Boolean(ids?.length);
  const statuses = statusValues(url, route);
  return {
    auctionId: hydrating ? null : numberOrNull(route.auctionId),
    pageNumber: Math.max(1, Math.trunc(page)),
    pageLength: Math.max(1, Math.min(HIBID_PAGE_SIZE, Math.trunc(options.pageSize || HIBID_PAGE_SIZE))),
    category: hydrating ? null : numberOrNull(route.categoryId),
    searchText: hydrating ? null : ((url.searchParams.get('q') || '').trim() || null),
    zip: hydrating ? null : ((url.searchParams.get('zip') || '').trim() || null),
    miles: hydrating ? null : numberOrNull(url.searchParams.get('miles')),
    shippingOffered: hydrating ? false : boolParam(url, 'shippingoffered'),
    countryName: hydrating ? null : ((url.searchParams.get('countryname') || '').trim() || null),
    state: null,
    status: hydrating ? 'ALL' : (statuses.length === 1 ? statuses[0]! : 'ALL'),
    sortOrder: cleanSort(url.searchParams.get('s') || 'LOT_NUMBER'),
    filter: hydrating ? null : ((url.searchParams.get('filter') || '').trim().toUpperCase() || null),
    isArchive: archiveParam(url),
    countAsView: false,
    hideGoogle: false,
    eventItemIds: hydrating ? ids : null
  };
}

function idFrom(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const object = value as Record<string, unknown>;
  return String(object.eventItemId ?? object.eventitemId ?? object.id ?? object.itemId ?? '').trim();
}

function parseGraphqlPage(json: unknown, requestedPage: number): PageResult {
  const paged = (json as any)?.data?.lotSearch?.pagedResults;
  if (!paged || !Array.isArray(paged.results)) throw new Error('HiBid GraphQL response did not contain lotSearch results');
  const total = numberOrNull(paged.filteredCount) ?? numberOrNull(paged.totalCount);
  return {
    page: numberOrNull(paged.pageNumber) ?? requestedPage,
    total,
    ids: paged.results.map(idFrom).filter(Boolean),
    records: paged.results
  };
}

function parseSearchPage(json: unknown, requestedPage: number, hasQuery: boolean): PageResult & { pageSize: number; totalPages: number | null; noExactMatches: boolean } {
  const data = (json as any)?.data;
  if (!data || !Array.isArray(data.lots)) throw new Error('HiBid search response did not contain lot IDs');
  const noExactMatches = hasQuery && Boolean(data.noExactMatches);
  const total = noExactMatches ? 0 : (numberOrNull(data.filteredCount) ?? numberOrNull(data.totalCount));
  return {
    page: numberOrNull(data.pageNumber) ?? requestedPage,
    pageSize: numberOrNull(data.pageSize) ?? HIBID_PAGE_SIZE,
    totalPages: numberOrNull(data.totalPages),
    total,
    ids: noExactMatches ? [] : data.lots.map(idFrom).filter(Boolean),
    records: [],
    noExactMatches
  };
}

async function retryPost(
  request: (body: unknown, options?: { signal?: AbortSignal }) => Promise<unknown>,
  body: unknown,
  retries: number,
  signal?: AbortSignal
): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    if (signal?.aborted) throw new Error('HiBid scrape cancelled');
    try {
      return await request(body, { signal });
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, 150 * attempt);
        signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new Error('HiBid scrape cancelled')); }, { once: true });
      });
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError || 'HiBid request failed'));
}

async function fetchPage(
  transport: HiBidTransport,
  route: HiBidRoute,
  locationLike: LocationLike | URL | string,
  page: number,
  options: { pageSize: number; retries: number; signal?: AbortSignal }
): Promise<PageResult> {
  const directGraphql = (route.kind === 'catalog' || route.kind === 'livecatalog') && statusValues(toUrl(locationLike), route).length <= 1;
  if (directGraphql) {
    const variables = buildHibidGraphqlVariables(route, locationLike, page, { pageSize: options.pageSize });
    const json = await retryPost(transport.hydrateLots.bind(transport), {
        operationName: HIBID_LOT_SEARCH_OPERATION,
      variables,
      query: HIBID_LOT_SEARCH_QUERY
    }, options.retries, options.signal);
    return parseGraphqlPage(json, page);
  }
  const body = buildHibidSearchRequest(route, locationLike, page, options.pageSize);
  const json = await retryPost(transport.searchLots.bind(transport), body, options.retries, options.signal);
  return parseSearchPage(json, page, Boolean(body.query));
}

async function mapConcurrent<T, R>(values: T[], concurrency: number, worker: (value: T) => Promise<R>): Promise<R[]> {
  const output = new Array<R>(values.length);
  let cursor = 0;
  const run = async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(values[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), Math.max(1, values.length)) }, () => run()));
  return output;
}

async function fetchCoveredPage(
  fetchAgain: () => Promise<PageResult>,
  expectedOnPage: number,
  retries: number
): Promise<{ result: PageResult; attempts: number; totals: number[]; complete: boolean }> {
  let result = await fetchAgain();
  let attempts = 1;
  const totals = result.total === null ? [] : [result.total];
  while (result.ids.length !== expectedOnPage && attempts < retries) {
    attempts += 1;
    result = await fetchAgain();
    if (result.total !== null) totals.push(result.total);
  }
  return { result, attempts, totals, complete: result.ids.length === expectedOnPage };
}

export async function enumerateHibidLotIds(
  transport: HiBidTransport,
  route: HiBidRoute,
  locationLike: LocationLike | URL | string,
  options: { pageSize?: number; retries?: number; signal?: AbortSignal; onProgress?: (message: string) => void; visibleState?: HiBidPageState } = {}
): Promise<{ ids: string[]; rawRecords: unknown[]; expectedTotal: number | null; pageStats: PageResult[]; failedPages: Array<{ page: number; error: string }>; totalDrift: Array<{ page: number; observed: number; expected: number }>; startFingerprint: string; endFingerprint: string }> {
  const pageSize = options.pageSize || HIBID_PAGE_SIZE;
  const retries = options.retries || HIBID_RETRIES;
  const startFingerprint = routeFingerprint(route, locationLike);
  const firstInitial = await fetchPage(transport, route, locationLike, 1, { pageSize, retries, signal: options.signal });
  const expectedTotal = options.visibleState?.noMatches ? 0 : firstInitial.total;
  if (expectedTotal === 0) {
    return { ids: [], rawRecords: [], expectedTotal: 0, pageStats: [{ ...firstInitial, ids: [], records: [] }], failedPages: [], totalDrift: [], startFingerprint, endFingerprint: routeFingerprint(route, locationLike) };
  }
  const pageCount = expectedTotal === null ? 1 : Math.max(1, Math.ceil(expectedTotal / pageSize));
  const failedPages: Array<{ page: number; error: string }> = [];
  const pageStats: PageResult[] = [];
  const totalDrift: Array<{ page: number; observed: number; expected: number }> = [];
  const expectedFirst = expectedTotal === null ? firstInitial.ids.length : Math.min(pageSize, expectedTotal);
  let first = firstInitial;
  if (first.ids.length !== expectedFirst) {
    const covered = await fetchCoveredPage(() => fetchPage(transport, route, locationLike, 1, { pageSize, retries, signal: options.signal }), expectedFirst, retries);
    first = covered.result;
    if (!covered.complete) failedPages.push({ page: 1, error: `short page after retries (${first.ids.length}/${expectedFirst})` });
    covered.totals.filter((total) => expectedTotal !== null && total !== expectedTotal).forEach((observed) => totalDrift.push({ page: 1, observed, expected: expectedTotal! }));
  }
  pageStats.push(first);
  const remaining = Array.from({ length: Math.max(0, pageCount - 1) }, (_, index) => index + 2);
  const rest = await mapConcurrent(remaining, HIBID_CONCURRENCY, async (page) => {
    try {
      const expectedOnPage = expectedTotal === null ? pageSize : Math.max(0, Math.min(pageSize, expectedTotal - ((page - 1) * pageSize)));
      const covered = await fetchCoveredPage(() => fetchPage(transport, route, locationLike, page, { pageSize, retries, signal: options.signal }), expectedOnPage, retries);
      if (!covered.complete) failedPages.push({ page, error: `short page after retries (${covered.result.ids.length}/${expectedOnPage})` });
      covered.totals.filter((total) => expectedTotal !== null && total !== expectedTotal).forEach((observed) => totalDrift.push({ page, observed, expected: expectedTotal! }));
      options.onProgress?.(`HiBid enumeration page ${page}/${pageCount}`);
      return covered.result;
    } catch (error) {
      failedPages.push({ page, error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  });
  const pages = [first, ...rest.filter((page): page is PageResult => Boolean(page))].sort((a, b) => a.page - b.page);
  const ids = pages.flatMap((page) => page.ids);
  return {
    ids,
    rawRecords: pages.flatMap((page) => page.records),
    expectedTotal,
    pageStats: pages,
    failedPages,
    totalDrift,
    startFingerprint,
    endFingerprint: routeFingerprint(route, locationLike)
  };
}

function text(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function amount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const match = String(value ?? '').replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function descriptionText(value: unknown): string {
  return String(value ?? '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|tr|h\d)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function descriptionFields(description: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const label of ['Year', 'Make', 'Model', 'VIN #', 'Shelf Location', 'Condition', 'In Packaging?', 'Assembly Required?', 'Damaged?', 'Functional?', 'Missing Parts?']) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = description.match(new RegExp(`(?:^|\\n|\\|)\\s*${escaped}\\s*:?\\s*([^\\n|]+)`, 'i'));
    if (match?.[1]) fields[label] = match[1].trim();
  }
  return fields;
}

function imageUrls(lot: Record<string, unknown>): string[] {
  const pictures = [lot.featuredPicture, ...(Array.isArray(lot.pictures) ? lot.pictures : [])];
  return [...new Set(pictures.flatMap((picture) => {
    if (!picture || typeof picture !== 'object') return [];
    const item = picture as Record<string, unknown>;
    return [item.fullSizeLocation, item.hdThumbnailLocation, item.thumbnailLocation, item.url, item.src]
      .map((value) => text(value)).filter(Boolean);
  }))];
}

export function normalizeHibidLot(raw: unknown, context: { route: HiBidRoute; sourceUrl: string }): HiBidLotRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const lot = raw as Record<string, any>;
  const state = (lot.lotState || {}) as Record<string, any>;
  const auction = (lot.auction || {}) as Record<string, any>;
  const id = text(lot.eventItemId ?? lot.eventitemId ?? lot.id ?? lot.itemId);
  if (!id) return null;
  const descriptionHtml = String(lot.description ?? '').trim();
  const description = descriptionText(descriptionHtml);
  const images = imageUrls(lot);
  const highBid = amount(state.highBid);
  const priceRealized = amount(state.priceRealized);
  const currentBid = priceRealized !== null && priceRealized > 0
    ? priceRealized
    : (highBid ?? amount(state.price ?? lot.bidAmount));
  const nextBid = amount(state.minBid ?? state.nextBid);
  const categoryRecords = [
    ...(Array.isArray(lot.category) ? lot.category : [lot.category]),
    ...(Array.isArray(lot.categories) ? lot.categories : [lot.categories])
  ];
  const categories = categoryRecords
    .flatMap((value) => value && typeof value === 'object'
      ? [value.fullCategory, value.categoryName, value.name]
      : [value])
    .map(text).filter(Boolean);
  const lotNumber = text(lot.lotNumber ?? lot.saleOrder ?? id);
  const title = text(lot.lead ?? lot.title ?? lot.name ?? `Lot ${lotNumber}`);
  const productUrl = text(state.productUrl ?? lot.url ?? lot.productUrl);
  return {
    source: 'hibid-api',
    pageKind: context.route.kind,
    id,
    eventItemId: id,
    itemId: text(lot.itemId),
    lot: lotNumber,
    title,
    lead: text(lot.lead) || title,
    url: productUrl ? new URL(productUrl, context.sourceUrl).href : `${new URL(context.sourceUrl).origin}/lot/${id}`,
    image: images[0] || '',
    images,
    description,
    descriptionHtml,
    category: categories[0] || '',
    categories: [...new Set(categories)],
    currentBid,
    nextBid,
    bidCount: amount(state.bidCount ?? lot.bidCount),
    status: text(state.status ?? state.productStatus ?? state.priceRealizedMessage),
    timeLeft: text(state.timeLeft ?? state.timeLeftTitle ?? lot.timeLeft),
    quantity: amount(lot.quantity),
    shippingOffered: Boolean(lot.shippingOffered),
    auctionId: text(auction.id ?? context.route.auctionId),
    auctionTitle: text(auction.eventName ?? auction.title),
    location: [auction.eventAddress, auction.eventCity, auction.eventState, auction.eventZip].map(text).filter(Boolean).join(', '),
    buyerPremium: text(auction.buyerPremium ?? auction.buyerPremiumRate),
    watchNotes: text(state.watchNotes ?? lot.watchNotes),
    rawText: [lotNumber, title, description, text(state.status)].filter(Boolean).join(' | ').slice(0, 12000),
    descriptionFields: descriptionFields(description),
    extractionAudit: { source: 'graphql', stableId: id, hasDescription: Boolean(description), imageCount: images.length }
  };
}

export function mergeHibidVisibleWithHydrated(visible: HiBidLotRecord, hydrated: HiBidLotRecord): HiBidLotRecord {
  const visibleRealized = /\bPrice\s+Realized\b/i.test(visible.rawText) || /^Closed$/i.test(visible.status);
  const keepVisibleRealized = visibleRealized
    && (hydrated.currentBid === null || hydrated.currentBid === 0)
    && visible.currentBid !== null
    && visible.currentBid > 0;
  return {
    ...visible,
    ...hydrated,
    currentBid: keepVisibleRealized ? visible.currentBid : hydrated.currentBid,
    status: hydrated.status || visible.status,
  };
}

export async function hydrateHibidLots(
  transport: HiBidTransport,
  ids: string[],
  route: HiBidRoute,
  locationLike: LocationLike | URL | string,
  options: { rawRecords?: unknown[]; retries?: number; signal?: AbortSignal; onProgress?: (message: string) => void } = {}
): Promise<{ items: HiBidLotRecord[]; hydratedIds: string[]; failedBatches: Array<{ batch: number; ids: string[]; error: string }>; hydrationStats: Array<Record<string, unknown>> }> {
  const uniqueIds = [...new Set(ids.map(String).filter(Boolean))];
  const byId = new Map<string, HiBidLotRecord>();
  for (const raw of options.rawRecords || []) {
    const item = normalizeHibidLot(raw, { route, sourceUrl: toUrl(locationLike).href });
    if (item) byId.set(item.id, item);
  }
  const missing = uniqueIds.filter((id) => !byId.has(id));
  const failedBatches: Array<{ batch: number; ids: string[]; error: string }> = [];
  const hydrationStats: Array<Record<string, unknown>> = [];
  const batches = Array.from({ length: Math.ceil(missing.length / HIBID_PAGE_SIZE) }, (_, index) => ({
    batch: index + 1,
    ids: missing.slice(index * HIBID_PAGE_SIZE, (index + 1) * HIBID_PAGE_SIZE)
  }));
  await mapConcurrent(batches, HIBID_CONCURRENCY, async ({ batch, ids: batchIds }) => {
    try {
      let pending = batchIds.slice();
      let rounds = 0;
      const maxRounds = options.retries || HIBID_RETRIES;
      while (pending.length && rounds < maxRounds) {
        rounds += 1;
        const variables = buildHibidGraphqlVariables(route, locationLike, 1, { pageSize: pending.length, eventItemIds: pending });
        const json = await retryPost(transport.hydrateLots.bind(transport), {
          operationName: HIBID_LOT_SEARCH_OPERATION,
          variables,
          query: HIBID_LOT_SEARCH_QUERY
        }, maxRounds, options.signal);
        const records = parseGraphqlPage(json, 1).records;
        for (const raw of records) {
          const item = normalizeHibidLot(raw, { route, sourceUrl: toUrl(locationLike).href });
          if (item) byId.set(item.id, item);
        }
        pending = batchIds.filter((id) => !byId.has(id));
      }
      const unresolved = pending;
      hydrationStats.push({ batch, requested: batchIds.length, returned: batchIds.length - unresolved.length, coverageAttempts: rounds });
      if (unresolved.length) failedBatches.push({ batch, ids: unresolved, error: `missing hydration records after ${rounds} attempt(s)` });
      options.onProgress?.(`HiBid hydration ${uniqueIds.length - missing.filter((id) => !byId.has(id)).length}/${uniqueIds.length}`);
    } catch (error) {
      failedBatches.push({ batch, ids: batchIds, error: error instanceof Error ? error.message : String(error) });
    }
    return null;
  });
  return { items: uniqueIds.map((id) => byId.get(id)).filter((item): item is HiBidLotRecord => Boolean(item)), hydratedIds: [...byId.keys()], failedBatches, hydrationStats };
}

export function validateHibidApiCoverage(input: { enumeratedIds: string[]; hydratedItems: Array<{ id?: string; eventItemId?: string }>; expectedTotal: number | null; visibleExpectedTotal?: number | null; requireVisibleTotalMatch?: boolean; failedPages?: Array<{ page: number; error: string }>; failedBatches?: Array<{ batch: number; ids: string[]; error: string }>; totalDrift?: unknown[]; startFingerprint?: string; endFingerprint?: string; stopped?: boolean }): CoverageAudit {
  const enumerated = input.enumeratedIds.map(String).filter(Boolean);
  const hydrated = input.hydratedItems.map((item) => String(item.id ?? item.eventItemId ?? '')).filter(Boolean);
  const enumeratedSet = new Set(enumerated);
  const hydratedSet = new Set(hydrated);
  const duplicateIds = [...new Set(enumerated.filter((id, index) => enumerated.indexOf(id) !== index))];
  const missingIds = [...enumeratedSet].filter((id) => !hydratedSet.has(id));
  const unexpectedIds = [...hydratedSet].filter((id) => !enumeratedSet.has(id));
  const failedPages = input.failedPages || [];
  const failedBatches = input.failedBatches || [];
  const totalDrift = input.totalDrift || [];
  const expected = Number.isFinite(input.expectedTotal) && input.expectedTotal !== null ? input.expectedTotal : null;
  const visibleExpected = input.visibleExpectedTotal !== undefined
    && input.visibleExpectedTotal !== null
    && Number.isFinite(input.visibleExpectedTotal)
    ? input.visibleExpectedTotal
    : null;
  const visibleTotalMatches = !input.requireVisibleTotalMatch || visibleExpected === null || expected === visibleExpected;
  const routeMatches = !input.startFingerprint || !input.endFingerprint || input.startFingerprint === input.endFingerprint;
  const complete = expected !== null && enumeratedSet.size === expected && hydratedSet.size === expected && duplicateIds.length === 0 && missingIds.length === 0 && unexpectedIds.length === 0 && failedPages.length === 0 && failedBatches.length === 0 && totalDrift.length === 0 && visibleTotalMatches && routeMatches && !input.stopped;
  let reason = 'complete';
  if (!routeMatches) reason = 'route-fingerprint-changed';
  else if (input.stopped) reason = 'user-stop';
  else if (failedPages.length) reason = 'api-page-failure';
  else if (failedBatches.length) reason = 'api-hydration-failure';
  else if (totalDrift.length) reason = 'api-total-drift';
  else if (!visibleTotalMatches) reason = 'api-visible-total-mismatch';
  else if (expected === null) reason = 'api-total-missing';
  else if (duplicateIds.length) reason = 'api-duplicate-ids';
  else if (enumeratedSet.size !== expected) reason = 'api-enumeration-count-mismatch';
  else if (missingIds.length) reason = 'api-missing-hydration';
  else if (unexpectedIds.length) reason = 'api-unexpected-hydration';
  else if (hydratedSet.size !== expected) reason = 'api-hydration-count-mismatch';
  return { complete, reason, expectedCount: expected, enumeratedCount: enumerated.length, uniqueEnumeratedCount: enumeratedSet.size, hydratedCount: hydrated.length, uniqueHydratedCount: hydratedSet.size, duplicateIds, missingIds, unexpectedIds, failedPages, failedBatches, totalDrift, visibleExpectedCount: visibleExpected, visibleTotalMatches, routeMatches, startFingerprint: input.startFingerprint || '', endFingerprint: input.endFingerprint || '' };
}

export async function scrapeHibidApiCatalog(
  transport: HiBidTransport,
  route: HiBidRoute,
  locationLike: LocationLike | URL | string,
  options: { visibleState?: HiBidPageState; signal?: AbortSignal; onProgress?: (message: string) => void } = {}
): Promise<HiBidScrapeResult> {
  const sourceUrl = toUrl(locationLike).href;
  const enumeration = await enumerateHibidLotIds(transport, route, locationLike, options);
  const hydration = await hydrateHibidLots(transport, enumeration.ids, route, locationLike, { rawRecords: enumeration.rawRecords, signal: options.signal, onProgress: options.onProgress });
  const endFingerprint = routeFingerprint(route, locationLike);
  const coverage = validateHibidApiCoverage({ enumeratedIds: enumeration.ids, hydratedItems: hydration.items, expectedTotal: enumeration.expectedTotal, visibleExpectedTotal: options.visibleState?.visibleExpectedTotal, requireVisibleTotalMatch: Boolean(options.visibleState?.visibleExpectedTotal !== null && options.visibleState?.visibleExpectedTotal !== undefined), failedPages: enumeration.failedPages, failedBatches: hydration.failedBatches, totalDrift: enumeration.totalDrift, startFingerprint: enumeration.startFingerprint, endFingerprint, stopped: options.signal?.aborted });
  return { source: 'hibid-api-first', route, sourceUrl, fingerprint: enumeration.startFingerprint, expectedTotal: enumeration.expectedTotal, enumeratedIds: enumeration.ids, items: hydration.items, coverage, pageStats: enumeration.pageStats.map((page) => ({ ...page })), hydrationStats: hydration.hydrationStats, errors: [...enumeration.failedPages.map((item) => item.error), ...hydration.failedBatches.map((item) => item.error)] };
}
