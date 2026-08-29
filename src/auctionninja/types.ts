export type AuctionNinjaPageKind =
  | 'followed-items'
  | 'items-won'
  | 'bid-history'
  | 'auction-search'
  | 'category-search'
  | 'sale-catalog'
  | 'item-detail'
  | 'blocked-account'
  | 'unsupported';

export type AuctionNinjaLocationLike =
  | string
  | URL
  | Pick<Location, 'href' | 'hostname' | 'pathname' | 'search'>;

export interface AuctionNinjaRoute {
  supported: boolean;
  kind: AuctionNinjaPageKind;
  host: string;
  reason: string;
  statePrefix?: string;
  citySlug?: string;
  zip?: string;
  categorySlug?: string;
  categoryName?: string;
  sellerSlug?: string;
  saleId?: string;
  productId?: string;
}

export interface AuctionNinjaSaleContext {
  source: 'AuctionNinja';
  pageKind: 'sale-catalog';
  title: string;
  url: string;
  saleId: string;
  sellerSlug: string;
  seller: string;
  location: string;
  buyerPremium: string;
  pickupWindow: string;
  shipping: string;
  specialInstructions: string;
  about: string;
  closingTime: string;
  expectedTotal: number | null;
}

export interface AuctionNinjaCategoryContext {
  source: 'AuctionNinja';
  pageKind: 'category-search';
  title: string;
  category: string;
  categorySlug: string;
  url: string;
  zip: string;
  miles: string;
  totalItems: number | null;
  visibleItems: number;
}

export interface AuctionNinjaSearchContext {
  source: 'AuctionNinja';
  pageKind: 'auction-search';
  title: string;
  url: string;
  searchLocation: string;
  miles: string;
  filters: Record<string, string>;
  totalSales: number | null;
}

export interface AuctionNinjaDescriptionFields {
  condition: string;
  packaging: string;
  assemblyRequired: string;
  damaged: string;
  functional: string;
  missingParts: string;
  shelfLocation: string;
  [key: string]: string;
}

export interface AuctionNinjaLotRecord {
  source: 'AuctionNinja';
  pageKind: 'sale-catalog' | 'category-search' | 'item-detail' | 'followed-items' | 'items-won' | 'bid-history';
  id: string;
  stableId: string;
  lot: string;
  title: string;
  url: string;
  image: string;
  images: string[];
  description: string;
  descriptionHtml: string;
  descriptionFields: AuctionNinjaDescriptionFields;
  category: string;
  saleTitle: string;
  saleUrl: string;
  seller: string;
  sellerUrl: string;
  location: string;
  shippingText: string;
  pickupText: string;
  highBid: string;
  highBidAmount: number | null;
  currentBid: number | null;
  currentPrice: number | null;
  bidCount: string;
  bidCountNumber: number | null;
  timeLeft: string;
  timeText: string;
  status: string;
  watched: boolean;
  detailEnriched: boolean;
  detailSource: string;
  rawText: string;
  extractionAudit: {
    sourceUrl: string;
    cardSelector: string;
    fieldsPresent: string[];
    missingFields: string[];
  };
  [key: string]: unknown;
}

export interface AuctionNinjaSaleRecord {
  source: 'AuctionNinja';
  pageKind: 'auction-search';
  id: string;
  stableId: string;
  title: string;
  url: string;
  image: string;
  seller: string;
  sellerUrl: string;
  location: string;
  shippingText: string;
  closingText: string;
  itemCount: number | null;
  rawText: string;
}

export interface AuctionNinjaDetailRecord extends Partial<AuctionNinjaLotRecord> {
  source: 'AuctionNinja';
  pageKind: 'item-detail';
  id: string;
  stableId: string;
  url: string;
  title: string;
}

export interface AuctionNinjaAccountItem extends AuctionNinjaLotRecord {
  pageKind: 'followed-items' | 'items-won' | 'bid-history';
  priceText: string;
  price: number | null;
  yourBidText?: string;
  yourBid?: number | null;
}

export interface AuctionNinjaPagedResponse {
  html: string;
  responseKind: 'document-html' | 'auctionninja-json-fragment';
  totalSales: number | null;
  ignoredSensitiveKeys: string[];
  jsonKeys: string[];
}

export interface AuctionNinjaPageAudit {
  page: number;
  total: number | null;
  start: number | null;
  end: number | null;
  count: number;
  ids: string[];
}

export interface AuctionNinjaCoverageOptions {
  requireRanges?: boolean;
  expectedIds?: string[];
  failedPages?: Array<{ page?: number; url?: string; error: string }>;
  startFingerprint?: string;
  endFingerprint?: string;
  stopped?: boolean;
}

export interface AuctionNinjaCoverage {
  complete: boolean;
  reason: string;
  expectedTotal: number | null;
  collectedCount: number;
  uniqueIdentityCount: number;
  duplicateIds: string[];
  missingIds: string[];
  unexpectedIds: string[];
  missingPages: number[];
  failedPages: Array<{ page?: number; url?: string; error: string }>;
  pageCount: number;
  routeMatches: boolean;
}

export type AuctionNinjaFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
export type AuctionNinjaDocumentParser = (html: string, url: string) => Document;

export interface AuctionNinjaScrapeOptions {
  fetcher?: AuctionNinjaFetch;
  fetch?: AuctionNinjaFetch;
  parseDocument?: AuctionNinjaDocumentParser;
  documentParser?: AuctionNinjaDocumentParser;
  signal?: AbortSignal;
  getLocation?: () => AuctionNinjaLocationLike;
  concurrency?: number;
  timeoutMs?: number;
  attempts?: number;
  onProgress?: (message: string) => void;
}

export interface AuctionNinjaScrapeResult {
  source: 'AuctionNinja';
  route: AuctionNinjaRoute;
  sourceUrl: string;
  fingerprint: string;
  context: AuctionNinjaSaleContext | AuctionNinjaCategoryContext | AuctionNinjaSearchContext | Record<string, unknown>;
  items: AuctionNinjaLotRecord[] | AuctionNinjaAccountItem[] | AuctionNinjaDetailRecord[];
  sales: AuctionNinjaSaleRecord[];
  detail?: AuctionNinjaDetailRecord | null;
  expectedTotal: number | null;
  pageAudits: AuctionNinjaPageAudit[];
  coverage: AuctionNinjaCoverage;
  failedPages: Array<{ page?: number; url?: string; error: string }>;
  failedDetails: Array<{ id: string; url: string; error: string }>;
}
