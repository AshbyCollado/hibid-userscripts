import {
  canonicalAuctionNinjaSaleUrl,
  auctionNinjaSaleStableIdentity,
  getAuctionNinjaPageNumber,
  isAuctionNinjaHost,
  resolveAuctionNinjaPage,
  toAuctionNinjaUrl
} from './route.js';
import { parseCatalogRange } from './dom.js';
import type {
  AuctionNinjaLocationLike,
  AuctionNinjaPagedResponse,
  AuctionNinjaSaleRecord,
  AuctionNinjaSearchContext
} from './types.js';

type DomRoot = Document | Element;

function elementRoot(root: DomRoot): Element { if (root.nodeType !== 9) return root as Element; const documentRoot = root as Document; return (documentRoot.body || documentRoot.documentElement) as Element; }
function textOf(node: Node | null | undefined): string { return String(node?.textContent || '').replace(/\s+/g, ' ').trim(); }
function hrefOf(node: Element | null | undefined): string { return String(node?.getAttribute('href') || (node as HTMLAnchorElement | null)?.href || '').trim(); }
function absolute(value: string, base: string): string { try { return value ? new URL(value, base).href : ''; } catch { return ''; } }
function unique(values: Iterable<string>): string[] { return Array.from(new Set(Array.from(values).map((value) => String(value || '').trim()).filter(Boolean))); }
function normalize(value: string): string { return String(value || '').replace(/\bBid Now\b/gi, '').replace(/\s+/g, ' ').trim(); }
function money(value: string): number | null { const match = String(value || '').match(/\$\s*([\d,]+(?:\.\d{1,2})?)/); const amount = match ? Number((match[1] || '').replace(/,/g, '')) : NaN; return Number.isFinite(amount) ? amount : null; }
function shipping(value: string): string { return String(value || '').match(/\b(?:Shipping Available|Shipping Not Available|Shipping Only|Local Pickup Only|Local Pick Up|Pickup Only|Referred Shipping(?: AND Delivery)? Available)\b/i)?.[0] || ''; }
function locationText(value: string): string { return String(value || '').replace(/\b(?:Shipping Available|Shipping Not Available|Shipping Only|Local Pickup Only|Local Pick Up|Pickup Only)\b/gi, ' ').replace(/\s+/g, ' ').trim().match(/\b[A-Z][A-Za-z .'-]+,\s*[A-Z]{2}\b/)?.[0] || ''; }
function closing(value: string): string { return String(value || '').match(/\bBegins\s+to\s+close\b.*?(?=\n|$)/i)?.[0] || String(value || '').match(/\bClosing\s+(?:at|on)\b.*?(?=\n|$)/i)?.[0] || ''; }

export function parseAuctionNinjaAuctionSearchTotal(value: string): number | null {
  const match = String(value || '').match(/\b([\d,]+)\s+(?:active\s+)?(?:auctions?|sales?)\b/i)
    || String(value || '').match(/\b([\d,]+)\s+results?\b/i);
  if (!match) return null;
  const total = Number((match[1] || '').replace(/,/g, ''));
  return Number.isFinite(total) ? total : null;
}

export function parseAuctionNinjaPagedResponse(value: unknown): AuctionNinjaPagedResponse {
  const raw = String(value || '');
  let payload: Record<string, unknown> | null = null;
  if (/^\s*\{/.test(raw)) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && typeof (parsed as Record<string, unknown>).body === 'string') payload = parsed as Record<string, unknown>;
    } catch { payload = null; }
  }
  if (!payload) return { html: raw, responseKind: 'document-html', totalSales: null, ignoredSensitiveKeys: [], jsonKeys: [] };
  const head = String(payload.head || '');
  const body = String(payload.body || '');
  const pagination = String(payload.pagination || '');
  const headText = head.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const allowed = new Set(['head', 'body', 'pagination']);
  return {
    html: `${head}\n${body}\n${pagination}`,
    responseKind: 'auctionninja-json-fragment',
    totalSales: parseAuctionNinjaAuctionSearchTotal(headText),
    ignoredSensitiveKeys: Object.keys(payload).filter((key) => !allowed.has(key)).sort(),
    jsonKeys: Object.keys(payload).sort()
  };
}

function uniqueSaleLinks(card: Element, base: string): string[] {
  const urls = Array.from(card.querySelectorAll('a[href*="/sales/details/"]'))
    .map((node) => canonicalAuctionNinjaSaleUrl(absolute(hrefOf(node), base)))
    .filter((url): url is string => Boolean(url));
  return Array.from(new Set(urls));
}

function findSearchCard(seed: Element, base: string): Element | null {
  let current: Element | null = seed;
  let best: Element | null = null;
  let score = -Infinity;
  for (let depth = 0; current && depth < 9; depth += 1, current = current.parentElement) {
    const raw = textOf(current);
    if (uniqueSaleLinks(current, base).length !== 1 || !raw || raw.length > 2400) continue;
    let value = current.matches('.location-result-box, .auction-item, .auction-box, .auction-list-item, .sale-item, .sales-item') ? 50 : 0;
    if (/Begins\s+to\s+close|Closing\s+(?:at|on)/i.test(raw)) value += 40;
    if (locationText(raw)) value += 20;
    if (shipping(raw)) value += 15;
    if (/\b\d+\s+Lots?\b/i.test(raw)) value += 8;
    if (/Find a Seller|Top Auction Locations|Bidder Login|Seller Login/i.test(raw)) value -= 90;
    if (value > score) { score = value; best = current; }
  }
  return score > 30 ? best : null;
}

function searchCards(root: DomRoot, base = 'https://www.auctionninja.com/'): Element[] {
  const source = elementRoot(root).querySelector('.location-search-result-all, .location-search-result-all_') || elementRoot(root);
  const seeds = Array.from(source.querySelectorAll('.location-result-box, .auction-item, .auction-box, .auction-list-item, .sale-item, .sales-item, a[href*="/sales/details/"]'));
  const result: Element[] = []; const seen = new Set<Element>();
  for (const seed of seeds) {
    const card = findSearchCard(seed, base);
    if (!card || seen.has(card) || card.closest('.featured-auctions-deta, .featured-auctions-box-main:not(.location-search-result-all):not(.location-search-result-all_)')) continue;
    seen.add(card); result.push(card);
  }
  return result;
}

function saleLink(card: Element): Element | null {
  const links = Array.from(card.querySelectorAll('a[href*="/sales/details/"]'));
  return links.sort((a, b) => normalize(textOf(b)).length - normalize(textOf(a)).length)[0] || null;
}

export function extractAuctionNinjaAuctionSearchSales(root: DomRoot, locationLike: AuctionNinjaLocationLike): AuctionNinjaSaleRecord[] {
  const base = toAuctionNinjaUrl(locationLike).href;
  const result: AuctionNinjaSaleRecord[] = []; const seen = new Set<string>();
  for (const card of searchCards(root, base)) {
    const rawText = textOf(card); const link = saleLink(card); const url = canonicalAuctionNinjaSaleUrl(absolute(hrefOf(link), base));
    const title = normalize(textOf(link)) || normalize(rawText.split(/\n/)[0] || '');
    const stableId = auctionNinjaSaleStableIdentity(url); const key = stableId || `${title}:${rawText.slice(0, 80)}`;
    if (!key || seen.has(key) || !title) continue;
    seen.add(key);
    const sellerLink = card.querySelector('a[href]:not([href*="/sales/details/"])');
    const imageNode = card.querySelector('img[src], img[data-src]');
    const image = absolute(imageNode?.getAttribute('src') || imageNode?.getAttribute('data-src') || '', base);
    const itemCount = rawText.match(/(?:^|\D)([\d,]+)\s+Lots?\b/i)?.[1];
    result.push({ source: 'AuctionNinja', pageKind: 'auction-search', id: url.match(/--([A-Za-z0-9-]+)\.html/i)?.[1] || '', stableId, title, url, image, seller: normalize(textOf(sellerLink)), sellerUrl: absolute(hrefOf(sellerLink), base), location: locationText(rawText), shippingText: shipping(rawText), closingText: closing(rawText), itemCount: itemCount ? Number(itemCount.replace(/,/g, '')) : null, rawText });
  }
  return result;
}

export function extractAuctionNinjaSearchActiveFilters(root: DomRoot, locationLike: AuctionNinjaLocationLike): Record<string, string> {
  const url = toAuctionNinjaUrl(locationLike); const controls = new Map<string, string>();
  for (const control of Array.from(elementRoot(root).querySelectorAll('input[name], select[name]'))) {
    const name = String(control.getAttribute('name') || '').trim().toLowerCase();
    const type = String(control.getAttribute('type') || '').toLowerCase();
    if (!name || ((type === 'checkbox' || type === 'radio') && !(control as HTMLInputElement).checked)) continue;
    const value = String((control as HTMLInputElement).value || control.getAttribute('value') || '').trim();
    if (value && !controls.has(name)) controls.set(name, value);
  }
  const first = (...names: string[]): string => names.map((name) => controls.get(name.toLowerCase()) || url.searchParams.get(name) || '').find(Boolean) || '';
  const filters: Record<string, string> = { miles: first('miles', 'milessrch', 'milessrchmob'), zip: first('zip', 'zipsrch', 'zipsrchmob'), shipping: first('shipping', 'shipopt_1'), pickup: first('pickup', 'shipopt_2'), srt: first('srt', 'sort'), category: first('category', 'cat', 'cat_id', 'category_id'), seller: first('seller'), state: first('state', 'statesrch'), auc_date: first('auc_date'), ninjaship: first('ninjaship') };
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => value));
}

export function extractAuctionNinjaAuctionSearchContext(root: DomRoot, locationLike: AuctionNinjaLocationLike): AuctionNinjaSearchContext {
  const url = toAuctionNinjaUrl(locationLike); const route = resolveAuctionNinjaPage(url); const raw = textOf(elementRoot(root));
  const city = route.citySlug ? route.citySlug.replace(/[-_]+/g, ' ').replace(/\b([a-z])/g, (letter) => letter.toUpperCase()) : '';
  const searchLocation = [city, route.statePrefix?.toUpperCase(), route.zip].filter(Boolean).join(' ');
  return { source: 'AuctionNinja', pageKind: 'auction-search', title: String((root as Document).title || '').replace(/\s*\|\s*AuctionNinja.*$/i, '').trim() || (searchLocation ? `Auction search near ${searchLocation}` : 'AuctionNinja Auction Search'), url: url.href, searchLocation, miles: url.searchParams.get('miles') || '', filters: extractAuctionNinjaSearchActiveFilters(root, url), totalSales: parseAuctionNinjaAuctionSearchTotal(raw) };
}

function paginationScope(value: URL): string {
  const pairs = Array.from(value.searchParams.entries()).filter(([key]) => !['an', 'page', 'p', 'pagenum'].includes(key.toLowerCase())).sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv));
  return `${value.pathname}|${pairs.map(([key, item]) => `${key}=${item}`).join('&')}`;
}

export function findAuctionNinjaSearchPageUrls(root: DomRoot, locationLike: AuctionNinjaLocationLike): string[] {
  const base = toAuctionNinjaUrl(locationLike); const sourceScope = paginationScope(base); const result = new Map<number, string>();
  const paginationRoots = Array.from(elementRoot(root).querySelectorAll('.paging-deta, [class*="pagination"]'));
  const scopes = paginationRoots.length ? paginationRoots : [elementRoot(root)];
  const candidates: Array<{ url: URL; page: number }> = [];
  for (const scope of scopes) {
    for (const anchor of Array.from(scope.querySelectorAll('a[href], a[onclick], button[onclick]'))) {
      const onclick = anchor.getAttribute('onclick') || ''; const match = onclick.match(/pagination\s*\(\s*['"]([^'"]+)['"]/i); const target = match?.[1] || hrefOf(anchor);
      if (!target || /bid|checkout|invoice|payment|account|login|logout|watch|follow/i.test(`${target} ${textOf(anchor)}`)) continue;
      let candidate: URL; try { candidate = new URL(target, base.href); } catch { continue; }
      if (!isAuctionNinjaHost(candidate.hostname) || (!/\/marketplace_ajax\.php$/i.test(candidate.pathname) && paginationScope(candidate) !== sourceScope)) continue;
      const page = getAuctionNinjaPageNumber(candidate); if (page <= 1 && !/[?&](?:Page|page|pagenum)=1/i.test(candidate.search)) continue;
      candidates.push({ url: candidate, page });
    }
  }
  const ajaxScopes = unique(candidates.filter(({ url }) => /\/marketplace_ajax\.php$/i.test(url.pathname)).map(({ url }) => paginationScope(url)));
  if (ajaxScopes.length > 1) return [];
  for (const candidate of candidates) result.set(candidate.page, candidate.url.href);
  return Array.from(result.entries()).sort(([a], [b]) => a - b).map(([, href]) => href);
}

export { parseCatalogRange };
export const parseAuctionNinjaCatalogRange = parseCatalogRange;
