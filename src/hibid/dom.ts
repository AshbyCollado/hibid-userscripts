import { toUrl } from '../core/route.js';
import type { HiBidFilterState, HiBidLotRecord, HiBidPageState, HiBidRoute, LocationLike, PastAuctionGroup } from '../core/types.js';

function clean(value: string | null | undefined): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function visibleText(root: Document | Element): string {
  const documentRoot = root.nodeType === 9 ? root as Document : root.ownerDocument;
  const start = root.nodeType === 9 ? (root as Document).body || (root as Document).documentElement : root as Element;
  if (!start || !documentRoot) return '';
  const walker = documentRoot.createTreeWalker(start, 4);
  const chunks: string[] = [];
  let node: Node | null = walker.nextNode();
  while (node) {
    const parent = node.parentElement;
    if (parent && !parent.closest('script,style,template,[hidden],[aria-hidden="true"]')) {
      const style = parent.getAttribute('style') || '';
      if (!/(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(style)) chunks.push(node.nodeValue || '');
    }
    node = walker.nextNode();
  }
  return chunks.join(' ');
}

function rootText(root: Document | Element): string {
  if (root.nodeType === 9) {
    const documentRoot = root as Document;
    return documentRoot.body?.textContent || documentRoot.documentElement?.textContent || '';
  }
  return root.textContent || '';
}

function money(value: string): number | null {
  const match = value.replace(/,/g, '').match(/\$?\s*(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function filters(url: URL): HiBidFilterState {
  const raw: Record<string, string[]> = {};
  url.searchParams.forEach((value, key) => (raw[key] ||= []).push(value));
  return {
    query: clean(url.searchParams.get('q')) || null,
    zip: clean(url.searchParams.get('zip')) || null,
    miles: url.searchParams.get('miles') ? Number(url.searchParams.get('miles')) : null,
    country: clean(url.searchParams.get('countryname')) || null,
    shippingOffered: /^(1|true|yes)$/i.test(url.searchParams.get('shippingoffered') || ''),
    statuses: url.searchParams.getAll('status').map((value) => value.toUpperCase()),
    sortOrder: clean(url.searchParams.get('s')) || '',
    raw
  };
}

export function extractHiBidPageState(root: Document | Element, locationLike: LocationLike | URL | string): HiBidPageState {
  const url = toUrl(locationLike);
  const text = clean(visibleText(root));
  const canonicalLots = new Set([...root.querySelectorAll('app-lot-tile[id^="lot-"], [data-event-item-id], .bid-status-border[id^="lot-"]')]
    .map((node) => node.id.replace(/^lot-/, '') || node.getAttribute('data-event-item-id') || '')
    .filter(Boolean));
  const noMatches = canonicalLots.size === 0 && /no\s+(?:matches|lots|results)\s+found/i.test(text);
  const range = text.match(/showing\s+(\d+)\s*(?:-|to)\s*(\d+)\s+of\s+(\d+)\s+lots?/i);
  const total = range ? Number(range[3]) : null;
  return { noMatches, visibleExpectedTotal: noMatches ? 0 : total, visibleCount: range ? Number(range[2]) - Number(range[1]) + 1 : (canonicalLots.size || null), filters: filters(url), text: text.slice(0, 10000) };
}

export function extractHiBidPortalSearchContext(root: Document | Element): { portalAuctioneerIds: string[]; siteType: number } {
  const stateNode = root.querySelector('script#hibid-state[type="application/json"]');
  if (!stateNode?.textContent) return { portalAuctioneerIds: [], siteType: 2 };
  try {
    const parsed = JSON.parse(stateNode.textContent);
    const ids = new Set<string>();
    const queue: Array<{ value: unknown; depth: number }> = [{ value: parsed, depth: 0 }];
    let inspected = 0;
    while (queue.length && inspected < 10_000) {
      const next = queue.shift()!;
      if (!next.value || typeof next.value !== 'object') continue;
      inspected += 1;
      for (const [key, value] of Object.entries(next.value as Record<string, unknown>)) {
        if (/^portalChildren$/i.test(key)) {
          const values = Array.isArray(value) ? value : String(value || '').split(',');
          values.map(String).map((item) => item.trim()).filter((item) => /^\d+$/.test(item)).forEach((item) => ids.add(item));
        } else if (next.depth < 6 && value && typeof value === 'object') {
          queue.push({ value, depth: next.depth + 1 });
        }
      }
    }
    return { portalAuctioneerIds: [...ids], siteType: 2 };
  } catch {
    return { portalAuctioneerIds: [], siteType: 2 };
  }
}

function imageList(tile: Element): string[] {
  return [...tile.querySelectorAll('img')].map((image) => image.currentSrc || image.src || image.getAttribute('data-src') || '').filter(Boolean);
}

export function extractHiBidVisibleLots(root: Document | Element, route: HiBidRoute, locationLike: LocationLike | URL | string): HiBidLotRecord[] {
  const sourceUrl = toUrl(locationLike).href;
  const tiles = [...root.querySelectorAll('app-lot-tile[id^="lot-"], [data-event-item-id], .bid-status-border[id^="lot-"]')];
  const records: HiBidLotRecord[] = [];
  const seen = new Set<string>();
  for (const tile of tiles) {
    const link = tile.querySelector<HTMLAnchorElement>('a[href*="/lot/"]');
    const href = link ? new URL(link.getAttribute('href') || '', sourceUrl).href : '';
    const id = (tile.id || '').replace(/^lot-/, '') || href.match(/\/lot\/(\d+)/i)?.[1] || tile.querySelector('[data-event-item-id]')?.getAttribute('data-event-item-id') || '';
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const raw = clean(tile.textContent);
    const title = clean(tile.querySelector('h1,h2,h3,h4,.title,[class*="title"]')?.textContent) || clean(link?.textContent) || `Lot ${id}`;
    records.push({ source: 'hibid-dom', pageKind: route.kind, id, eventItemId: id, itemId: '', lot: id, title, lead: title, url: href || `${new URL(sourceUrl).origin}/lot/${id}`, image: imageList(tile)[0] || '', images: imageList(tile), description: '', descriptionHtml: '', category: '', categories: [], currentBid: money(raw.match(/(?:high|current)\s+bid[^\d$]*[\$]?\s*[\d,.]+/i)?.[0] || ''), nextBid: money(raw.match(/\bbid\s+[\$]?\s*[\d,.]+/i)?.[0] || ''), bidCount: Number(raw.match(/(\d+)\s+bids?/i)?.[1] || '') || null, status: /won/i.test(raw) ? 'Won' : '', timeLeft: clean(raw.match(/\b(?:\d+h\s*)?\d+m\b/i)?.[0]), quantity: null, shippingOffered: /shipping/i.test(raw), auctionId: route.auctionId || '', auctionTitle: '', location: '', buyerPremium: '', rawText: raw });
  }
  return records;
}

function fieldFromText(raw: string, label: string): string {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = raw.match(new RegExp(`${escaped}\\s*:?\\s*([^\\n|]+)`, 'i'));
  return clean(match?.[1]);
}

function structuredFields(root: Document | Element): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const row of root.querySelectorAll('tr, dl > div, .row')) {
    const label = clean(row.querySelector('th,dt,label,[class*="label"]')?.textContent).replace(/:$/, '');
    const value = clean(row.querySelector('td,dd,[class*="value"]')?.textContent);
    if (label && value && label.length < 80) fields[label] = value;
  }
  const raw = visibleText(root).replace(/\r/g, '');
  for (const label of ['Lot #', 'Lead', 'Group - Category', 'Condition', 'In Packaging?', 'Assembly Required?', 'Damaged?', 'Functional?', 'Missing Parts?', 'Shelf Location']) {
    const value = fieldFromText(raw, label);
    if (value && !fields[label]) fields[label] = value;
  }
  return fields;
}

function lotInformationRoot(root: Document | Element): Element | null {
  return [...root.querySelectorAll('table, dl, [data-testid*="lot-information"], app-lot-information')].find((candidate) => {
    const labels = [...candidate.querySelectorAll('th, dt, label')].map((node) => clean(node.textContent).replace(/:$/, '').toLowerCase());
    return labels.includes('lot #') && labels.includes('lead');
  }) || null;
}

function canonicalLotDescription(root: Document | Element, lotInfo: Element | null): Element | null {
  const infoDescription = lotInfo ? [...lotInfo.querySelectorAll('tr, dl > div')].find((row) => {
    const label = clean(row.querySelector('th, dt, label')?.textContent).replace(/:$/, '');
    return /^description$/i.test(label);
  })?.querySelector('td, dd, [class*="value"]') || null : null;
  if (infoDescription) return infoDescription;

  return root.querySelector([
    '[itemprop="description"]',
    'app-lot-description',
    '[data-testid="lot-description"]',
    '#lot-description',
    '.lot-description',
    '#description'
  ].join(', '));
}

function canonicalImages(root: Document | Element, base: string): string[] {
  const scopes = [...root.querySelectorAll('app-lot-images, app-image-gallery, .lot-images, [class*="lot-image"], [class*="gallery"], .carousel')];
  const images = scopes.length ? scopes.flatMap((scope) => [...scope.querySelectorAll<HTMLImageElement>('img')]) : [];
  const metaImage = root.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content || '';
  const values = images
    .flatMap((image) => [image.currentSrc, image.src, image.getAttribute('data-src'), image.getAttribute('data-lazy-src')])
    .filter((value): value is string => Boolean(value))
    .map((value) => new URL(value, base).href)
    .filter((value) => /^https:\/\//i.test(value) && !/(?:spacer|pixel|logo|icon)/i.test(value));
  if (metaImage) values.unshift(new URL(metaImage, base).href);
  return [...new Set(values)];
}

export function extractHibidLotDetail(root: Document | Element, locationLike: LocationLike | URL | string): HiBidLotRecord | null {
  const sourceUrl = toUrl(locationLike).href;
  const raw = clean(visibleText(root));
  const lotInfo = lotInformationRoot(root);
  const fields = structuredFields(lotInfo || root);
  const urlId = sourceUrl.match(/\/lot\/(\d+)/i)?.[1] || '';
  const id = root.querySelector('[data-event-item-id]')?.getAttribute('data-event-item-id') || urlId;
  if (!id) return null;
  const lot = fields['Lot #'] || raw.match(/\bLot\s*#?\s*:?\s*([\w-]+)/i)?.[1] || id;
  const lead = fields.Lead || clean(root.querySelector('h1, .lot-title, [class*="lot-title"]')?.textContent) || `Lot ${lot}`;
  const descriptionNode = canonicalLotDescription(root, lotInfo);
  const description = clean(descriptionNode?.textContent) || clean(fields.Description);
  const images = canonicalImages(root, sourceUrl);
  const bidText = raw.match(/(?:High|Current)\s+Bid\s*:?\s*\$?\s*[\d,.]+/i)?.[0] || '';
  const nextText = raw.match(/(?:Minimum Next Bid|Bid)\s*:?\s*\$?\s*[\d,.]+/i)?.[0] || '';
  const category = fields['Group - Category'] || '';
  return {
    source: 'hibid-dom', pageKind: 'lot', id, eventItemId: id, itemId: '', lot,
    title: lead, lead, url: sourceUrl, image: images[0] || '', images,
    description, descriptionHtml: descriptionNode?.innerHTML || '', category,
    categories: category ? [category] : [], currentBid: money(bidText), nextBid: money(nextText),
    bidCount: Number(raw.match(/(\d+)\s+Bids?/i)?.[1] || '') || null,
    status: /\bWon\b/i.test(raw) ? 'Won' : (/\bOutbid\b/i.test(raw) ? 'Outbid' : ''),
    timeLeft: clean(raw.match(/\b(?:\d+d\s*)?(?:\d+h\s*)?\d+m(?:\s*\d+s)?\b/i)?.[0]),
    quantity: Number(fields.Quantity || '') || null, shippingOffered: /shipping offered|will ship/i.test(raw),
    auctionId: sourceUrl.match(/auction(?:Id)?[=/](\d+)/i)?.[1] || '', auctionTitle: '',
    location: '', buyerPremium: fieldFromText(raw, "Buyer's Premium"), rawText: raw.slice(0, 12000),
    descriptionFields: fields
  };
}

export function extractPastAuctionGroups(root: Document | Element, locationLike: LocationLike | URL | string): PastAuctionGroup[] {
  const base = toUrl(locationLike).href;
  return [...root.querySelectorAll('.listing-box-title')].flatMap((block, index) => {
    const link = block.querySelector<HTMLAnchorElement>('a[href*="/catalog/"]');
    if (!link) return [];
    const catalogUrl = new URL(link.getAttribute('href') || '', base).href;
    const auctionId = catalogUrl.match(/\/catalog\/(\d+)/i)?.[1] || String(index);
    const title = clean(block.querySelector('strong')?.textContent) || clean(link.textContent);
    const locationLink = block.querySelector<HTMLAnchorElement>('a[href*="maps.google"]');
    const location = clean(locationLink?.textContent);
    const dateText = clean(block.textContent).replace(title, '').replace(location, '').replace(/^\s*\|\s*/, '');
    return [{ id: auctionId, title, catalogUrl, location, dateText }];
  });
}

function groupContainer(root: Document | Element, group: PastAuctionGroup): Element | null {
  const escapedId = group.id.replace(/[^\d]/g, '');
  const header = [...root.querySelectorAll('.listing-box-title')].find((block) => {
    const href = block.querySelector<HTMLAnchorElement>('a[href*="/catalog/"]')?.href || '';
    return href.includes(`/catalog/${escapedId}/`) || href.endsWith(`/catalog/${escapedId}`);
  });
  if (!header) return null;
  const watchedHeader = header.closest('app-watched-auction-header');
  if (watchedHeader?.parentElement) {
    const scope = watchedHeader.ownerDocument.createElement('div');
    let node: Element | null = watchedHeader;
    while (node) {
      if (node !== watchedHeader && node.matches('app-watched-auction-header')) break;
      scope.append(node.cloneNode(true));
      node = node.nextElementSibling;
    }
    return scope;
  }
  return header.closest('.listing-box, [class*="auction-listing"], section') || header.parentElement;
}

export function extractPastAuctionGroupState(
  root: Document | Element,
  group: PastAuctionGroup
): { found: boolean; expectedTotal: number | null; visibleCount: number } {
  const container = groupContainer(root, group);
  if (!container) return { found: false, expectedTotal: null, visibleCount: 0 };
  const text = clean(visibleText(container));
  const range = text.match(/showing\s+(\d+)\s*(?:-|to)\s*(\d+)\s+of\s+(\d+)\s+lots?/i);
  const visibleCount = new Set([...container.querySelectorAll('app-lot-tile[id^="lot-"], [data-event-item-id], .bid-status-border[id^="lot-"]')]
    .map((node) => node.id.replace(/^lot-/, '') || node.getAttribute('data-event-item-id') || '')
    .filter(Boolean)).size;
  return { found: true, expectedTotal: range ? Number(range[3]) : visibleCount, visibleCount };
}

export function extractAccountLots(
  root: Document | Element,
  route: HiBidRoute,
  locationLike: LocationLike | URL | string,
  selectedGroup?: PastAuctionGroup
): HiBidLotRecord[] {
  if (route.kind === 'pastbids' || route.kind === 'pastwatchlist') {
    if (!selectedGroup) return [];
    const container = groupContainer(root, selectedGroup);
    return container ? extractHiBidVisibleLots(container, route, locationLike) : [];
  }
  return extractHiBidVisibleLots(root, route, locationLike);
}
