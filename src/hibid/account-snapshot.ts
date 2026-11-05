import type { HiBidLotRecord, HiBidRoute, PastAuctionGroup } from '../core/types.js';
import { normalizedHiBidAccountPath } from '../core/route.js';
import { extractAccountLots, extractHiBidPageState } from './dom.js';
import { getHibidLotRoots } from './dom-adapter.js';

export interface HibidAccountPageSnapshot {
  url: string;
  expectedTotal: number;
  visibleCount: number;
  page: number;
  items: HiBidLotRecord[];
}

export function snapshotHibidAccountPage(document: Document, url: string, route: HiBidRoute, selectedGroup?: PastAuctionGroup): HibidAccountPageSnapshot {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !/(^|\.)hibid\.com$/i.test(parsed.hostname)
    || !normalizedHiBidAccountPath(parsed)) {
    throw new Error('HiBid account page requires sign-in or changed during capture');
  }
  const headings = [...document.querySelectorAll('h1,h2,[role="heading"]')].map(node => node.textContent || '').join(' ');
  if (document.querySelector('input[type="password"]')
    || /captcha|security challenge|verify (?:that )?you(?:'re| are) human|checking your browser|access denied|just a moment/i.test(`${document.title} ${headings}`)) {
    throw new Error('HiBid account page requires sign-in or verification');
  }
  const account = document.querySelector('app-bids-page,app-watch-list-page,app-past-bids-page');
  const busy = '[aria-busy="true"],.loading,.spinner-border';
  if (account && (account.matches(busy) || account.querySelector(busy) || /\bLoading\.{3}/i.test(account.textContent || ''))) {
    throw new Error('HiBid account list is still loading');
  }
  const state = extractHiBidPageState(document, url);
  if (state.visibleExpectedTotal === null) throw new Error('HiBid account lot count is unavailable; wait for the list to load and retry');
  const roots = getHibidLotRoots(document);
  const items = extractAccountLots(document, route, url, selectedGroup);
  const renderedCount = selectedGroup ? items.length : roots.length;
  const visibleCount = state.visibleCount ?? 0;
  if ((state.visibleExpectedTotal > 0 && (!visibleCount || renderedCount !== visibleCount))
    || (state.visibleExpectedTotal === 0 && renderedCount > 0)) throw new Error('HiBid account list is still loading');
  const page = Number(document.querySelector<HTMLInputElement>('app-paginator input[name="jumpPageInput"]')?.value || parsed.searchParams.get('apage') || '1');
  if (page !== Number(parsed.searchParams.get('apage') || '1')) throw new Error('HiBid account list is still loading');
  return { url, expectedTotal: state.visibleExpectedTotal, visibleCount, page, items };
}
