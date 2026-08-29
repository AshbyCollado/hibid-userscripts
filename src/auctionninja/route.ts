import type { AuctionNinjaLocationLike, AuctionNinjaRoute } from './types.js';

const DEFAULT_BASE = 'https://www.auctionninja.com/';

export function isAuctionNinjaHost(hostname: string | null | undefined): boolean {
  const host = String(hostname || '').toLowerCase();
  return host === 'auctionninja.com' || host.endsWith('.auctionninja.com');
}

export function toAuctionNinjaUrl(value: AuctionNinjaLocationLike, base = DEFAULT_BASE): URL {
  if (value instanceof URL) return new URL(value.href);
  if (typeof value === 'string') return new URL(value, base);
  return new URL(value.href || base, base);
}

function pathSegments(url: URL): string[] {
  return url.pathname.split('/').map((part) => part.trim()).filter(Boolean);
}

export function productIdFromAuctionNinjaUrl(value: string | URL): string {
  const raw = typeof value === 'string' ? value : value.href;
  return raw.match(/--([A-Za-z0-9-]+)\.html(?:[?#].*)?$/i)?.[1]
    || raw.match(/-([A-Za-z0-9]+)\.html(?:[?#].*)?$/i)?.[1]
    || '';
}

export function saleIdFromAuctionNinjaUrl(value: string | URL): string {
  const raw = typeof value === 'string' ? value : value.href;
  return raw.match(/--([A-Za-z0-9-]+)\.html(?:[?#].*)?$/i)?.[1]
    || raw.match(/-([A-Za-z0-9]+)\.html(?:[?#].*)?$/i)?.[1]
    || '';
}

export function canonicalAuctionNinjaSaleUrl(value: string, base = DEFAULT_BASE): string {
  if (!String(value || '').trim()) return '';
  try {
    let url = toAuctionNinjaUrl(value, base);
    const backUrl = url.searchParams.get('backurl');
    if (/\/an-to-brg\.php$/i.test(url.pathname) && backUrl) url = new URL(backUrl, url.href);
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return String(value).replace(/[?#].*$/, '');
  }
}

export function canonicalAuctionNinjaProductUrl(value: string, base = DEFAULT_BASE): string {
  if (!String(value || '').trim()) return '';
  try {
    const url = toAuctionNinjaUrl(value, base);
    if (!isAuctionNinjaHost(url.hostname) || !/^\/[^/]+\/product\/[^/]+\.html$/i.test(url.pathname)) return '';
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

export function auctionNinjaSaleStableIdentity(value: string): string {
  const canonical = canonicalAuctionNinjaSaleUrl(value);
  if (!canonical) return '';
  try {
    const url = new URL(canonical);
    return `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return canonical.replace(/[?#].*$/, '').replace(/\/+$/, '');
  }
}

export function resolveAuctionNinjaPage(value: AuctionNinjaLocationLike = DEFAULT_BASE): AuctionNinjaRoute {
  const url = toAuctionNinjaUrl(value);
  const host = url.hostname.toLowerCase();
  const parts = pathSegments(url);
  const path = url.pathname.toLowerCase();
  if (!isAuctionNinjaHost(host)) return { supported: false, kind: 'unsupported', host, reason: 'unsupported host' };

  if (/\/(?:account|dashboard|billing|payment|payments|payment-methods|cards?|checkout|invoice|invoices|profile|settings|support|logout|login|register)(?:\/|$)/i.test(path)) {
    return { supported: false, kind: 'unsupported', host, reason: 'blocked account/payment route' };
  }
  if (parts[0] === 'followed-items') return { supported: true, kind: 'followed-items', host, reason: 'followed items route' };
  if (parts[0] === 'items-won') return { supported: true, kind: 'items-won', host, reason: 'items won route' };
  if (parts[0] === 'bid-history') return { supported: true, kind: 'bid-history', host, reason: 'bid history route' };
  if (parts[0] === 'auctions') return { supported: true, kind: 'auction-search', host, reason: 'auction search route' };
  if (parts[0] === 'category' && parts[1]) {
    const categorySlug = parts[1].toLowerCase();
    const categoryName = decodeURIComponent(categorySlug.replace(/[-_]+/g, ' ').replace(/\b([a-z])/g, (letter) => letter.toUpperCase()));
    return {
      supported: true,
      kind: 'category-search',
      host,
      categorySlug,
      categoryName,
      zip: url.searchParams.get('zip') || '',
      reason: 'category item search route'
    };
  }
  if (/^[a-z]{2}$/i.test(parts[0] || '') && parts[1] && /^\d{5}$/.test(parts[2] || '')) {
    return {
      supported: true,
      kind: 'auction-search',
      host,
      statePrefix: parts[0],
      citySlug: parts[1],
      zip: parts[2],
      reason: 'location auction search route'
    };
  }
  if (parts[1] === 'sales' && parts[2] === 'details' && parts[3]) {
    return {
      supported: true,
      kind: 'sale-catalog',
      host,
      sellerSlug: parts[0],
      saleId: saleIdFromAuctionNinjaUrl(parts[3]),
      reason: 'seller sale catalog route'
    };
  }
  if (parts[1] === 'product' && parts[2]) {
    return {
      supported: true,
      kind: 'item-detail',
      host,
      sellerSlug: parts[0],
      productId: productIdFromAuctionNinjaUrl(parts[2]),
      reason: 'seller item detail route'
    };
  }
  return { supported: false, kind: 'unsupported', host, reason: 'unsupported AuctionNinja path' };
}

export function getAuctionNinjaPageNumber(value: AuctionNinjaLocationLike): number {
  try {
    const url = toAuctionNinjaUrl(value);
    const page = Number(url.searchParams.get('Page') || url.searchParams.get('page') || url.searchParams.get('p') || url.searchParams.get('pagenum'));
    return Number.isFinite(page) && page > 0 ? page : 1;
  } catch {
    return 1;
  }
}

export function buildAuctionNinjaCatalogPageUrl(base: AuctionNinjaLocationLike, page: number): string {
  const url = toAuctionNinjaUrl(base);
  ['Page', 'page', 'p', 'pagenum'].forEach((key) => url.searchParams.delete(key));
  if (page > 1) url.searchParams.set('Page', String(Math.floor(page)));
  url.hash = 'items';
  return url.href;
}

export function buildAuctionNinjaMarketplaceAjaxPageUrl(base: AuctionNinjaLocationLike, page: number): string {
  const url = toAuctionNinjaUrl(base);
  url.pathname = '/marketplace_ajax.php';
  ['Page', 'page', 'p', 'pagenum'].forEach((key) => url.searchParams.delete(key));
  if (page > 1) url.searchParams.set('Page', String(Math.floor(page)));
  url.hash = '';
  return url.href;
}

export function auctionNinjaRouteFingerprint(route: AuctionNinjaRoute, value: AuctionNinjaLocationLike): string {
  const url = toAuctionNinjaUrl(value);
  const params = Array.from(url.searchParams.entries())
    .filter(([key]) => key.toLowerCase() !== 'an')
    .sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv))
    .map(([key, item]) => `${encodeURIComponent(key)}=${encodeURIComponent(item)}`)
    .join('&');
  const identity = [route.kind, route.sellerSlug, route.saleId, route.productId, route.categorySlug]
    .filter(Boolean)
    .join(':');
  return `auctionninja|${identity}|${url.hostname.toLowerCase()}${url.pathname}|${params}`;
}

export const resolveAuctionNinjaRoute = resolveAuctionNinjaPage;
