export type HiBidRouteKind =
  | 'catalog'
  | 'livecatalog'
  | 'search'
  | 'lot'
  | 'watchlist'
  | 'currentbids-winning'
  | 'currentbids-outbid'
  | 'pastbids'
  | 'pastwatchlist';

export interface LocationLike {
  href?: string;
  hostname?: string;
  pathname?: string;
  search?: string;
  hash?: string;
}

export interface HiBidRoute {
  supported: boolean;
  source: 'hibid' | 'unknown';
  kind: HiBidRouteKind | 'unsupported';
  host: string;
  path: string;
  auctionId: string | null;
  categoryId: string | null;
  statePrefix: string | null;
  portalAuctioneerIds: string[];
  siteType: number;
  currentBidStatus: 'WINNING' | 'OUTBID' | null;
  reason?: string;
}

export interface HiBidFilterState {
  query: string | null;
  zip: string | null;
  miles: number | null;
  country: string | null;
  shippingOffered: boolean;
  statuses: string[];
  sortOrder: string;
  raw: Record<string, string[]>;
}

export interface HiBidPageState {
  noMatches: boolean;
  visibleExpectedTotal: number | null;
  visibleCount: number | null;
  filters: HiBidFilterState;
  text: string;
}

export interface HiBidLotRecord {
  source: 'hibid-api' | 'hibid-dom';
  pageKind: HiBidRouteKind | string;
  id: string;
  eventItemId: string;
  itemId: string;
  lot: string;
  title: string;
  lead: string;
  url: string;
  image: string;
  images: string[];
  description: string;
  descriptionHtml: string;
  category: string;
  categories: string[];
  currentBid: number | null;
  nextBid: number | null;
  bidCount: number | null;
  status: string;
  timeLeft: string;
  quantity: number | null;
  shippingOffered: boolean;
  auctionId: string;
  auctionTitle: string;
  location: string;
  buyerPremium: string;
  rawText: string;
  [key: string]: unknown;
}

export interface CoverageInput {
  enumeratedIds: string[];
  hydratedItems: Array<{ id?: string; eventItemId?: string }>;
  expectedTotal: number | null;
  visibleExpectedTotal?: number | null;
  requireVisibleTotalMatch?: boolean;
  failedPages?: Array<{ page: number; error: string }>;
  failedBatches?: Array<{ batch: number; ids: string[]; error: string }>;
  totalDrift?: unknown[];
  startFingerprint?: string;
  endFingerprint?: string;
  stopped?: boolean;
}

export interface CoverageAudit {
  complete: boolean;
  reason: string;
  expectedCount: number | null;
  enumeratedCount: number;
  uniqueEnumeratedCount: number;
  hydratedCount: number;
  uniqueHydratedCount: number;
  duplicateIds: string[];
  missingIds: string[];
  unexpectedIds: string[];
  failedPages: Array<{ page: number; error: string }>;
  failedBatches: Array<{ batch: number; ids: string[]; error: string }>;
  totalDrift: unknown[];
  visibleExpectedCount: number | null;
  visibleTotalMatches: boolean;
  routeMatches: boolean;
  startFingerprint: string;
  endFingerprint: string;
}

export interface HiBidScrapeResult {
  source: string;
  route: HiBidRoute;
  sourceUrl: string;
  fingerprint: string;
  expectedTotal: number | null;
  enumeratedIds: string[];
  items: HiBidLotRecord[];
  coverage: CoverageAudit;
  pageStats: Array<Record<string, unknown>>;
  hydrationStats: Array<Record<string, unknown>>;
  errors: string[];
}

export interface HiBidTransport {
  searchLots(body: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
  hydrateLots(body: unknown, options?: { signal?: AbortSignal }): Promise<unknown>;
}

export type JobPhase =
  | 'idle'
  | 'queued'
  | 'enumerating'
  | 'hydrating'
  | 'validating'
  | 'completed'
  | 'stopping'
  | 'stopped'
  | 'failed'
  | 'stale';

export interface ScrapeJobSummary {
  jobId: string;
  schemaVersion: 1;
  tabId: number | null;
  sourceUrl: string;
  fingerprint: string;
  routeKind: HiBidRouteKind;
  scopeId: string | null;
  phase: JobPhase;
  revision: number;
  expectedTotal: number | null;
  enumeratedCount: number;
  hydratedCount: number;
  message: string;
  errorCode: string;
  startedAt: number;
  updatedAt: number;
  completedAt: number | null;
}

export interface PastAuctionGroup {
  id: string;
  title: string;
  catalogUrl: string;
  location: string;
  dateText: string;
}

export interface PageContext {
  supported: boolean;
  url: string;
  title: string;
  route: HiBidRoute;
  fingerprint: string;
  visibleExpectedTotal: number | null;
  noMatches: boolean;
  auctionGroups: PastAuctionGroup[];
  job: ScrapeJobSummary | null;
  analysis: DealAnalysisSummary;
}

export type DealAnalysisPhase = 'idle' | 'scanning' | 'retail' | 'complete' | 'cancelled' | 'error' | 'unsupported-currency';

export interface DealAnalysisSummary {
  phase: DealAnalysisPhase;
  routeFingerprint: string;
  total: number;
  analyzed: number;
  retailMatched: number;
  retailUnmatched: number;
  amazonAnalyzed: number;
  amazonMatched: number;
  mixedLots: number;
  quantityReview: number;
  message: string;
  updatedAt: number;
}
