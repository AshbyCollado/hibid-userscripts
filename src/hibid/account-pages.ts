import type { HiBidLotRecord, HiBidRoute, PastAuctionGroup } from '../core/types.js';
import { extractHibidLotDetail } from './dom.js';
import { snapshotHibidAccountPage, type HibidAccountPageSnapshot } from './account-snapshot.js';

export function parseHibidAccountDetail(document: Document, responseUrl: string, expected: HiBidLotRecord): HiBidLotRecord {
  const url = new URL(responseUrl, expected.url);
  const source = new URL(expected.url);
  const heading = document.querySelector('h1,.lot-title')?.textContent?.trim() || '';
  if (url.origin !== source.origin || url.pathname.match(/\/lot\/(\d+)/)?.[1] !== expected.id
    || document.querySelector('input[type="password"]')
    || !heading || /just a moment|verify (?:you|your)|access denied/i.test(heading)) {
    throw new Error('HiBid lot detail redirected, is still loading, or requires verification');
  }
  const detail = extractHibidLotDetail(document, url.href);
  if (!detail || detail.id !== expected.id) throw new Error('HiBid lot detail identity did not match the requested account lot');
  return detail;
}

interface AccountDocument {
  document: Document;
  url: string;
}
type AccountPage = AccountDocument | HibidAccountPageSnapshot;

export interface AccountCollectionOptions {
  document: Document;
  url: string;
  route: HiBidRoute;
  selectedGroup?: PastAuctionGroup;
  signal: AbortSignal;
  readPage(url: string, signal: AbortSignal): Promise<AccountPage>;
  onProgress?(count: number, expected: number, page: number): Promise<void>;
}

export async function collectHibidAccountPages(options: AccountCollectionOptions): Promise<{
  items: HiBidLotRecord[]; expected: number; failures: string[];
}> {
  const { route, selectedGroup, signal } = options;
  const base = new URL(options.url);
  const history = route.kind === 'pastbids' || route.kind === 'pastwatchlist';
  if (history && !selectedGroup) throw new Error('Select one past auction first');
  if (history) base.searchParams.set('auctionid', selectedGroup!.id);
  base.searchParams.delete('apage');
  const normalize = (page: AccountPage): HibidAccountPageSnapshot => 'document' in page
    ? snapshotHibidAccountPage(page.document, page.url, route, selectedGroup) : page;
  let first: AccountPage = { document: options.document, url: options.url };
  const active = new URL(options.url);
  const mustReadFirst = (active.searchParams.get('apage') || '1') !== '1'
    || (history && active.searchParams.get('auctionid') !== selectedGroup!.id);
  if (mustReadFirst) first = await options.readPage(base.href, signal);
  const filterScope = (url: URL): string => JSON.stringify([...url.searchParams]
    .filter(([key]) => key !== 'apage').sort(([ak, av], [bk, bv]) => ak.localeCompare(bk) || av.localeCompare(bv)));
  const assertPage = (page: HibidAccountPageSnapshot, number: number): void => {
    const observed = new URL(page.url, base);
    if (observed.origin !== base.origin || observed.pathname !== base.pathname
      || /\/pf\/(?:login|signup)/i.test(observed.pathname)) {
      throw new Error('HiBid account page requires sign-in or changed during capture');
    }
    if (history && observed.searchParams.get('auctionid') !== selectedGroup!.id) {
      throw new Error('Selected auction changed during capture');
    }
    if (filterScope(observed) !== filterScope(base)) throw new Error('HiBid account filters changed during capture');
    if (Number(observed.searchParams.get('apage') || '1') !== number) throw new Error('HiBid account pagination response changed pages');
    const renderedPage = page.page;
    if (renderedPage && Number(renderedPage) !== number) throw new Error('Account pagination did not advance to the requested page');
  };
  const firstSnapshot = normalize(first);
  assertPage(firstSnapshot, 1);
  const expected = firstSnapshot.expectedTotal;
  const pageSize = firstSnapshot.visibleCount;
  if (expected > 0 && pageSize < 1) throw new Error('HiBid account list is still loading');
  const pages = expected === 0 ? 1 : Math.ceil(expected / pageSize);
  const found = new Map<string, HiBidLotRecord>();
  const failures: string[] = [];
  const append = (page: HibidAccountPageSnapshot): void => {
    const rows = page.items;
    for (const item of rows) {
      if (selectedGroup && item.auctionId && item.auctionId !== selectedGroup.id) throw new Error('Account export contains a different auction');
      if (found.has(item.id)) throw new Error(`Duplicate lot ${item.id} across account pages; refresh and retry`);
      found.set(item.id, selectedGroup ? { ...item, auctionId: selectedGroup.id, auctionTitle: selectedGroup.title } : item);
    }
    if (rows.length === 0 && expected > 0) throw new Error('HiBid account rows could not be read; no empty export was produced');
  };
  append(firstSnapshot);
  for (let number = 2; number <= pages; number += 1) {
    signal.throwIfAborted();
    const url = new URL(base);
    url.searchParams.set('apage', String(number));
    const page = normalize(await options.readPage(url.href, signal));
    assertPage(page, number);
    if (page.expectedTotal !== expected) {
      throw new Error('HiBid account lot count changed during capture; refresh and retry');
    }
    append(page);
    await options.onProgress?.(found.size, expected, number);
  }
  signal.throwIfAborted();
  return { items: [...found.values()], expected, failures };
}
