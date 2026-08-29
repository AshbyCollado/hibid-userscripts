import { getAuctionNinjaPageNumber, auctionNinjaRouteFingerprint } from './route.js';
import { scraperStableIdentity } from './dom.js';
import type {
  AuctionNinjaCoverage,
  AuctionNinjaCoverageOptions,
  AuctionNinjaLocationLike,
  AuctionNinjaPageAudit,
  AuctionNinjaRoute,
  AuctionNinjaLotRecord,
  AuctionNinjaSaleRecord
} from './types.js';

export function buildAuctionNinjaPageAudit(items: Array<Partial<AuctionNinjaLotRecord | AuctionNinjaSaleRecord>>, url: AuctionNinjaLocationLike, total: number | null = null, range: { start?: number | null; end?: number | null } | null = null): AuctionNinjaPageAudit {
  const ids = items.map((item) => scraperStableIdentity(item)).filter(Boolean);
  return {
    page: getAuctionNinjaPageNumber(url),
    total: Number.isFinite(Number(total)) ? Number(total) : null,
    start: Number.isFinite(Number(range?.start)) ? Number(range?.start) : null,
    end: Number.isFinite(Number(range?.end)) ? Number(range?.end) : null,
    count: items.length,
    ids
  };
}

function unique(values: string[]): string[] { return Array.from(new Set(values.filter(Boolean))); }

export function validateAuctionNinjaPageCoverage(pageAudits: AuctionNinjaPageAudit[] = [], expectedTotal: number | null = null, options: AuctionNinjaCoverageOptions = {}): AuctionNinjaCoverage {
  const total = expectedTotal === null || expectedTotal === undefined ? Number.NaN : Number(expectedTotal);
  const audits = pageAudits.filter(Boolean);
  const ids = audits.flatMap((page) => page.ids.map(String).filter(Boolean));
  const counts = new Map<string, number>();
  ids.forEach((id) => counts.set(id, (counts.get(id) || 0) + 1));
  const duplicateIds = Array.from(counts.entries()).filter(([, count]) => count > 1).map(([id]) => id);
  const pages = unique(audits.map((page) => String(Number(page.page))).filter((page) => Number(page) > 0)).map(Number).sort((a, b) => a - b);
  const maxPage = pages[pages.length - 1] || 0;
  const missingPages = Array.from({ length: maxPage }, (_, index) => index + 1).filter((page) => !pages.includes(page));
  const totals = unique(audits.map((page) => page.total).filter((value): value is number => value !== null && value !== undefined).map(String)).map(Number);
  const expectedIds = unique((options.expectedIds || []).map(String));
  const missingIds = expectedIds.filter((id) => !counts.has(id));
  const unexpectedIds = expectedIds.length ? Array.from(counts.keys()).filter((id) => !expectedIds.includes(id)) : [];
  let reason = 'complete';
  if (!Number.isFinite(total) || total < 0) reason = 'authoritative-total-unavailable';
  else if (!audits.length) reason = 'no-pages';
  else if (options.stopped) reason = 'stopped-by-user';
  else if (options.failedPages?.length) reason = 'failed-pages';
  else if (missingPages.length) reason = 'missing-pages';
  else if (totals.some((value) => value !== total)) reason = 'total-drift';
  else if (audits.some((page) => page.count !== page.ids.length)) reason = 'page-count-mismatch';
  else if (duplicateIds.length) reason = 'duplicate-identities';
  else if (missingIds.length) reason = 'missing-identities';
  else if (unexpectedIds.length) reason = 'unexpected-identities';
  else if (ids.length !== total || counts.size !== total) reason = 'count-mismatch';

  const hasRange = audits.some((page) => page.start !== null || page.end !== null);
  const ranged = audits.every((page) => page.start !== null && page.end !== null && Number.isFinite(page.start) && Number.isFinite(page.end));
  if (reason === 'complete' && hasRange && !ranged) reason = 'incomplete-range-proof';
  if (reason === 'complete' && options.requireRanges && !ranged) reason = 'missing-range-proof';
  if (reason === 'complete' && ranged) {
    let next = 1;
    for (const page of audits.slice().sort((a, b) => Number(a.start) - Number(b.start))) {
      const start = Number(page.start); const end = Number(page.end);
      if (start !== next || end < start || page.count !== end - start + 1) { reason = start < next ? 'overlapping-ranges' : 'range-gap'; break; }
      next = end + 1;
    }
    if (reason === 'complete' && next - 1 !== total) reason = 'range-total-mismatch';
  }
  const routeMatches = !options.startFingerprint || !options.endFingerprint || options.startFingerprint === options.endFingerprint;
  if (reason === 'complete' && !routeMatches) reason = 'route-fingerprint-drift';
  return { complete: reason === 'complete', reason, expectedTotal: Number.isFinite(total) ? total : null, collectedCount: ids.length, uniqueIdentityCount: counts.size, duplicateIds, missingIds, unexpectedIds, missingPages, failedPages: options.failedPages || [], pageCount: audits.length, routeMatches };
}

export function validateAuctionNinjaRouteFingerprint(route: AuctionNinjaRoute, start: AuctionNinjaLocationLike, end: AuctionNinjaLocationLike): boolean {
  return auctionNinjaRouteFingerprint(route, start) === auctionNinjaRouteFingerprint(route, end);
}

export interface AuctionNinjaCoverageInput {
  expectedTotal: number;
  enumeratedIds?: string[];
  hydratedIds?: string[];
  pageCounts?: number[];
  startFingerprint?: string;
  endFingerprint?: string;
}

export function validateAuctionNinjaCoverage(input: AuctionNinjaCoverageInput): AuctionNinjaCoverage & { uniqueCount: number; uniqueHydratedCount: number } {
  const enumerated = (input.enumeratedIds || []).map(String);
  const hydrated = (input.hydratedIds || []).map(String);
  const counts = new Map<string, number>();
  enumerated.forEach((id) => counts.set(id, (counts.get(id) || 0) + 1));
  const hydratedSet = new Set(hydrated);
  const duplicateIds = Array.from(counts.entries()).filter(([, count]) => count > 1).map(([id]) => id);
  const missingIds = enumerated.filter((id) => !hydratedSet.has(id));
  const unexpectedIds = hydrated.filter((id) => !counts.has(id));
  const routeMatches = !input.startFingerprint || !input.endFingerprint || input.startFingerprint === input.endFingerprint;
  let reason = 'complete';
  if (duplicateIds.length) reason = 'duplicate-stable-id';
  else if (unexpectedIds.length) reason = 'unexpected-stable-id';
  else if (missingIds.length) reason = 'missing-hydration';
  else if (!routeMatches) reason = 'route-fingerprint-changed';
  else if (enumerated.length !== input.expectedTotal || hydrated.length !== input.expectedTotal || counts.size !== input.expectedTotal) reason = 'count-mismatch';
  return {
    complete: reason === 'complete', reason, expectedTotal: input.expectedTotal, collectedCount: enumerated.length,
    uniqueIdentityCount: counts.size, uniqueCount: counts.size, uniqueHydratedCount: hydratedSet.size,
    duplicateIds, missingIds, unexpectedIds, missingPages: [], failedPages: [], pageCount: input.pageCounts?.length || 0, routeMatches
  };
}
