import type { HiBidRoute, LocationLike } from './types.js';

const HOST_RE = /(^|\.)hibid\.com$/i;

export function toUrl(locationLike: LocationLike | URL | string): URL {
  if (locationLike instanceof URL) return new URL(locationLike.href);
  if (typeof locationLike === 'string') return new URL(locationLike);
  if (locationLike.href) return new URL(locationLike.href);
  const host = locationLike.hostname || 'hibid.com';
  const path = locationLike.pathname || '/';
  return new URL(`${locationLike.hash || ''}`, `https://${host}${path}${locationLike.search || ''}`);
}

export function isHiBidHost(hostname: string): boolean {
  return HOST_RE.test(String(hostname || '').toLowerCase());
}

function numeric(value: string | undefined): string | null {
  return value && /^\d+$/.test(value) ? value : null;
}

export function resolveHiBidRoute(locationLike: LocationLike | URL | string): HiBidRoute {
  const url = toUrl(locationLike);
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const parts = path.split('/').filter(Boolean);
  const unsupported: HiBidRoute = {
    supported: false,
    source: isHiBidHost(host) ? 'hibid' : 'unknown',
    kind: 'unsupported',
    host,
    path,
    auctionId: null,
    categoryId: null,
    statePrefix: null,
    portalAuctioneerIds: [],
    siteType: 0,
    currentBidStatus: null,
    reason: isHiBidHost(host) ? 'unsupported HiBid route' : 'unsupported host'
  };
  if (!isHiBidHost(host)) return unsupported;

  const accountIndex = parts.findIndex((part) => part.toLowerCase() === 'account');
  const account = accountIndex >= 0 ? parts[accountIndex + 1]?.toLowerCase() : '';
  const statePrefix = accountIndex > 0 ? parts.slice(0, accountIndex).join('/') : null;
  if (account === 'watchlist') {
    return { ...unsupported, supported: true, kind: 'watchlist', statePrefix, reason: undefined };
  }
  if (account === 'currentbids') {
    const status = (url.searchParams.get('status') || '').trim().toUpperCase();
    if (status === 'WINNING' || status === 'OUTBID') {
      return {
        ...unsupported,
        supported: true,
        kind: status === 'WINNING' ? 'currentbids-winning' : 'currentbids-outbid',
        statePrefix,
        currentBidStatus: status,
        reason: undefined
      };
    }
    return { ...unsupported, statePrefix, reason: 'current bids requires WINNING or OUTBID status' };
  }
  if (account === 'pastbidsm' || account === 'pastwatchlist') {
    return {
      ...unsupported,
      supported: true,
      kind: account === 'pastbidsm' ? 'pastbids' : 'pastwatchlist',
      statePrefix,
      reason: undefined
    };
  }

  const root = parts[0]?.toLowerCase();
  const catalogIndex = parts.findIndex((part) => ['catalog', 'livecatalog'].includes(part.toLowerCase()));
  if (catalogIndex >= 0) {
    const catalogRoot = parts[catalogIndex]!.toLowerCase();
    const kind = catalogRoot === 'catalog' ? 'catalog' : 'livecatalog';
    const prefixed = catalogIndex > 0;
    return {
      ...unsupported,
      supported: true,
      kind,
      auctionId: numeric(parts[catalogIndex + 1]),
      statePrefix: prefixed ? parts.slice(0, catalogIndex).join('/') : null,
      siteType: prefixed ? 2 : 0,
      currentBidStatus: null,
      reason: numeric(parts[catalogIndex + 1]) ? undefined : `missing ${kind} auction id`
    };
  }
  if (root === 'lot') {
    return { ...unsupported, supported: true, kind: 'lot', reason: undefined };
  }
  if (root === 'lots') {
    return {
      ...unsupported,
      supported: true,
      kind: 'search',
      auctionId: null,
      categoryId: numeric(parts[1]),
      currentBidStatus: null,
      reason: undefined
    };
  }

  // State-prefixed portals use /newjersey/lots/... and otherwise mirror /lots.
  const lotsIndex = parts.findIndex((part) => part.toLowerCase() === 'lots');
  if (lotsIndex >= 1) {
    return {
      ...unsupported,
      supported: true,
      kind: 'search',
      statePrefix: parts.slice(0, lotsIndex).join('/'),
      auctionId: null,
      categoryId: numeric(parts[lotsIndex + 1]),
      siteType: 2,
      currentBidStatus: null,
      reason: undefined
    };
  }
  const lotIndex = parts.findIndex((part) => part.toLowerCase() === 'lot');
  if (lotIndex >= 1) {
    return {
      ...unsupported,
      supported: true,
      kind: 'lot',
      statePrefix: parts.slice(0, lotIndex).join('/'),
      siteType: 2,
      reason: undefined
    };
  }
  return unsupported;
}

export function routeFingerprint(route: HiBidRoute, locationLike: LocationLike | URL | string): string {
  const url = toUrl(locationLike);
  const entries: Array<[string, string]> = [];
  url.searchParams.forEach((value, key) => entries.push([key, value]));
  const filters = entries
    .filter(([key]) => key.toLowerCase() !== 'apage')
    .sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv));
  return JSON.stringify({
    host: url.hostname.toLowerCase(),
    path: url.pathname.replace(/\/+$/, '') || '/',
    kind: route.kind,
    auctionId: route.auctionId,
    categoryId: route.categoryId,
    filters
  });
}
