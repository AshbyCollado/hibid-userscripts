import {
  auctionNinjaSaleStableIdentity,
  canonicalAuctionNinjaProductUrl,
  canonicalAuctionNinjaSaleUrl,
  isAuctionNinjaHost,
  productIdFromAuctionNinjaUrl,
  resolveAuctionNinjaPage,
  saleIdFromAuctionNinjaUrl,
  toAuctionNinjaUrl
} from './route.js';
import type {
  AuctionNinjaAccountItem,
  AuctionNinjaCategoryContext,
  AuctionNinjaDescriptionFields,
  AuctionNinjaDetailRecord,
  AuctionNinjaLocationLike,
  AuctionNinjaLotRecord,
  AuctionNinjaRoute,
  AuctionNinjaSaleContext,
  AuctionNinjaSaleRecord,
  AuctionNinjaSearchContext
} from './types.js';

type DomRoot = Document | Element;

const DEFAULT_BASE = 'https://www.auctionninja.com/';
const LOT_CARD_SELECTOR = '.search-catalog-item-box, .search-catalog-item-box-in, [id^="MainItmID_"], .hot-items-box, .item-box';
const CATEGORY_CARD_SELECTOR = '.hot-items-box, [id^="MainItmID_"], .hot-items-box-in';
const DETAIL_ROOT_SELECTOR = '.item-detail-main, .item-detail-box-main, .product-detail';

function rootElement(root: DomRoot): Element {
  if (root.nodeType !== 9) return root as Element;
  const documentRoot = root as Document;
  return (documentRoot.body || documentRoot.documentElement) as Element;
}

function textOf(value: Node | null | undefined): string {
  return String(value?.textContent || '').replace(/\s+/g, ' ').trim();
}

function rawTextOf(value: Node | null | undefined): string {
  return String(value?.textContent || '').replace(/\r/g, '').split('\n').map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
}

function controlHref(node: Element | null | undefined): string {
  return String(node?.getAttribute('href') || (node as HTMLAnchorElement | null)?.href || '').trim();
}

function absoluteUrl(value: string, base: string): string {
  if (!value) return '';
  try { return new URL(value, base).href; } catch { return ''; }
}

function firstText(root: DomRoot, selectors: string[]): string {
  for (const selector of selectors) {
    const node = rootElement(root).querySelector(selector);
    const value = textOf(node);
    if (value) return value;
  }
  return '';
}

function firstHref(root: DomRoot, selectors: string[], base: string): string {
  for (const selector of selectors) {
    const node = rootElement(root).querySelector(selector);
    const raw = controlHref(node) || String(node?.getAttribute('content') || '');
    const value = absoluteUrl(raw, base);
    if (value) return value;
  }
  return '';
}

function uniqueNonEmpty(values: Iterable<string>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const clean = String(value || '').trim();
    if (clean && !seen.has(clean)) { seen.add(clean); result.push(clean); }
  }
  return result;
}

function normalizeTitle(value: string): string {
  return String(value || '')
    .replace(/\bBid Now\b/gi, '')
    .replace(/\bLot\s*#\s*:?[A-Za-z0-9.-]+\b/gi, '')
    .replace(/\b(?:Current Bid|High Bid|Minimum Bid|Starting Bid|Price Realized|Lot Won)\b\s*:?\s*\$?[\d,.]+(?:\s*USD)?/gi, '')
    .replace(/\b(?:HIGH BIDDER|Following|Watched|Watching|Outbid|Winning|Won|Bidding Closed)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function moneyFromText(value: string): number | null {
  const match = String(value || '').match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
  if (!match) return null;
  const amount = Number((match[1] || '').replace(/,/g, ''));
  return Number.isFinite(amount) ? amount : null;
}

function parseBid(value: string): { label: string; amount: number | null } {
  const text = textOf({ textContent: value } as unknown as Node);
  const match = text.match(/\b(Current Bid|High Bid|Minimum Bid|Starting Bid|Lot Won)\b\s*:?\s*(\$[\d,]+(?:\.\d{2})?)/i);
  if (match) return { label: `${match[1]}: ${match[2]}`, amount: moneyFromText(match[2] || '') };
  const generic = text.match(/\$[\d,]+(?:\.\d{2})?/);
  return generic ? { label: `Current Bid: ${generic[0]}`, amount: moneyFromText(generic[0]) } : { label: '', amount: null };
}

function percentFromText(value: string): string {
  const match = String(value || '').match(/(\d+(?:\.\d+)?)\s*%/);
  return match ? `${match[1]}%` : '';
}

function parseTime(value: string): string {
  return String(value || '').match(/((?:\d+\s+(?:days?|hours?|minutes?|seconds?)\s*){1,4}left)/i)?.[1]
    || String(value || '').match(/\bBidding\s+Closed\b/i)?.[0]
    || '';
}

function parseLocation(value: string): string {
  return String(value || '').replace(/\b(?:Shipping Available|Shipping Not Available|Shipping Only|Local Pickup Only|Local Pick Up|Pickup Only)\b/gi, ' ').replace(/\s+/g, ' ').trim()
    .match(/\b[A-Z][A-Za-z .'-]+,\s+[A-Z]{2}\b/)?.[0] || '';
}

function parseShipping(value: string): string {
  return String(value || '').match(/\b(?:Shipping Available|Shipping Not Available|Shipping Only|Local Pickup Only|Local Pick Up|Pickup Only|Referred Shipping(?: AND Delivery)? Available)\b/i)?.[0] || '';
}

function parsePickup(value: string): string {
  return String(value || '').match(/\bPickup\s*:\s*.+?(?=\s+(?:Shipping|Location|Seller|Sale|Won|Following|Watched|Outbid|Current Bid|Price Realized)\b|$)/i)?.[0]?.trim() || '';
}

function descriptionFields(): AuctionNinjaDescriptionFields {
  return { condition: '', packaging: '', assemblyRequired: '', damaged: '', functional: '', missingParts: '', shelfLocation: '' };
}

function extractDescriptionFields(description: string): AuctionNinjaDescriptionFields {
  const fields = descriptionFields();
  const aliases: Record<string, keyof AuctionNinjaDescriptionFields> = {
    'condition': 'condition',
    'in packaging': 'packaging',
    'assembly required': 'assemblyRequired',
    'damaged': 'damaged',
    'functional': 'functional',
    'missing parts': 'missingParts',
    'shelf location': 'shelfLocation'
  };
  for (const line of String(description || '').split(/\n|\r|(?=\b(?:Condition|In Packaging\?|Assembly Required\?|Damaged\?|Functional\?|Missing Parts\?|Shelf Location):)/i)) {
    const match = line.trim().match(/^([^:]{2,40}):\s*(.+)$/);
    if (!match) continue;
    const key = aliases[(match[1] || '').replace(/\?$/, '').trim().toLowerCase()];
    if (key) fields[key] = (match[2] || '').trim();
  }
  return fields;
}

function imageUrls(root: Element, base: string): string[] {
  const nodes = Array.from(root.querySelectorAll('img[src], img[data-src], img[data-original], source[srcset], a[href*="/Pictures/"]'));
  const values: string[] = [];
  for (const node of nodes) {
    const image = node as HTMLImageElement;
    values.push(image.currentSrc, image.src, node.getAttribute('src') || '', node.getAttribute('data-src') || '', node.getAttribute('data-original') || '', node.getAttribute('href') || '');
    const srcset = String(node.getAttribute('srcset') || '');
    values.push(...srcset.split(',').map((part) => part.trim().split(/\s+/)[0] || ''));
  }
  return uniqueNonEmpty(values.map((value) => absoluteUrl(value, base)).filter((value) => value && !/logo|icon|avatar|spinner|pixel|clock|map_pins/i.test(value)));
}

function firstImage(root: Element, base: string): string {
  return imageUrls(root, base)[0] || '';
}

function cardSelector(card: Element): string {
  if (card.matches('.search-catalog-item-box')) return '.search-catalog-item-box';
  if (card.matches('.search-catalog-item-box-in')) return '.search-catalog-item-box-in';
  if (card.matches('[id^="MainItmID_"]')) return '[id^="MainItmID_"]';
  if (card.matches('.hot-items-box')) return '.hot-items-box';
  return '.item-box';
}

function canonicalProductLinks(card: Element, base: string): Array<{ node: Element; url: string }> {
  const result: Array<{ node: Element; url: string }> = [];
  const seen = new Set<string>();
  for (const node of Array.from(card.querySelectorAll('a[href*="/product/"]'))) {
    const url = canonicalAuctionNinjaProductUrl(absoluteUrl(controlHref(node), base), base);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push({ node, url });
  }
  return result;
}

function productTitle(card: Element, link: Element | null, rawText: string): string {
  const visibleTitles = [textOf(link), textOf(card.querySelector('.hot-items-title.myaccount-item-title, .hot-items-title'))]
    .map(normalizeTitle)
    .filter(Boolean);
  const linkTitle = visibleTitles.sort((a, b) => b.length - a.length)[0] || '';
  const mediaTitles = Array.from(card.querySelectorAll('img[alt], img[title], [data-title]'))
    .flatMap((node) => [node.getAttribute('alt') || '', node.getAttribute('title') || '', node.getAttribute('data-title') || ''])
    .map(normalizeTitle)
    .filter((value) => value && !/^(?:image|photo|thumbnail|picture|product image|click to enlarge)$/i.test(value));
  const mediaTitle = mediaTitles.sort((a, b) => b.length - a.length)[0] || '';
  const linkIsTruncated = /(?:\.\.\.|\u2026)$/.test(textOf(link));
  if (mediaTitle && (!linkTitle || linkIsTruncated || mediaTitle.length > linkTitle.length)) return mediaTitle;
  return linkTitle || normalizeTitle(rawText.match(/(?:left\s+|\$[\d,.]+\s+)(.+?)\s+Lot\s*#/i)?.[1] || '');
}

function catalogCards(root: DomRoot, base: string): Element[] {
  const result: Element[] = [];
  const seen = new Set<Element>();
  for (const selector of [LOT_CARD_SELECTOR]) {
    for (const card of Array.from(rootElement(root).querySelectorAll(selector))) {
      if (seen.has(card)) continue;
      const raw = textOf(card);
      if (canonicalProductLinks(card, base).length !== 1 || !/\bLot\s*#|\b(?:Current Bid|High Bid|Bid Now|Starting Bid)\b/i.test(raw)) continue;
      seen.add(card); result.push(card);
    }
  }
  return result;
}

function categoryCards(root: DomRoot, base = DEFAULT_BASE): Element[] {
  const result: Element[] = [];
  const seen = new Set<Element>();
  for (const card of Array.from(rootElement(root).querySelectorAll(CATEGORY_CARD_SELECTOR))) {
    const raw = textOf(card);
    if (seen.has(card) || canonicalProductLinks(card, base).length !== 1 || !raw) continue;
    seen.add(card); result.push(card);
  }
  return result;
}

function accountCards(root: DomRoot, base = DEFAULT_BASE): Element[] {
  const result: Element[] = [];
  const seen = new Set<Element>();
  for (const seed of Array.from(rootElement(root).querySelectorAll('a[href*="/product/"]'))) {
    let best: Element | null = null;
    let score = -Infinity;
    let current: Element | null = seed;
    for (let depth = 0; current && depth < 9; depth += 1, current = current.parentElement) {
      const raw = textOf(current);
      if (canonicalProductLinks(current, base).length !== 1 || raw.length > 2500) continue;
      let candidateScore = current.matches('.account-item-card, .dashboard-item, .dashboard-item-closing-main-box, .followed-item, .favorite-item, .watchlist-item, .item-won, .won-item, .bid-item, .my-account-item') ? 60 : 0;
      if (/\bLot\s*#/i.test(raw)) candidateScore += 40;
      if (/\b(?:Current Bid|Starting Bid|High Bid|Price Realized|Your Max Bid)\b/i.test(raw)) candidateScore += 40;
      if (/\b(?:Won|Following|Watched|Outbid|Bidding Closed)\b/i.test(raw)) candidateScore += 20;
      if (/\b(?:Dashboard|Invoices|Payment|Settings|Logout|Saved Searches)\b/i.test(raw)) candidateScore -= 70;
      if (candidateScore > score) { score = candidateScore; best = current; }
    }
    if (best && score > 35 && !seen.has(best)) { seen.add(best); result.push(best); }
  }
  return result;
}

function cardDescription(card: Element): string {
  const node = card.querySelector('.item-description-deta, .product-description, .item-description, .description, #description, [data-description]');
  if (node) return rawTextOf(node);
  const raw = rawTextOf(card);
  return raw.match(/(?:Description|Features and Notes|Auctioneer'?s Note)\s*:?\s*([\s\S]*?)(?=\n(?:Current Bid|High Bid|Minimum Bid|Starting Bid|Lot Won|\d+\s+Bids?\b)|$)/i)?.[1]?.trim() || '';
}

function emptyAudit(url: string, selector: string, record: Record<string, unknown>): AuctionNinjaLotRecord['extractionAudit'] {
  const fields = ['lot', 'title', 'url', 'description', 'category', 'image', 'currentBid', 'status', 'timeText'];
  return { sourceUrl: url, cardSelector: selector, fieldsPresent: fields.filter((field) => Boolean(record[field])), missingFields: fields.filter((field) => !record[field]) };
}

function baseLot(card: Element, base: string, pageKind: AuctionNinjaLotRecord['pageKind'], category = ''): AuctionNinjaLotRecord | null {
  const rawText = rawTextOf(card);
  const link = canonicalProductLinks(card, base)[0];
  const url = link?.url || '';
  const titleLink = link ? canonicalProductLinks(card, base).map((entry) => entry.node).sort((a, b) => textOf(b).length - textOf(a).length)[0] : null;
  const title = productTitle(card, titleLink || link?.node || null, rawText);
  const id = productIdFromAuctionNinjaUrl(url);
  if (!url || !id || !title) return null;
  const bid = parseBid(rawText);
  const description = cardDescription(card);
  const images = imageUrls(card, base);
  const record = {
    source: 'AuctionNinja' as const,
    pageKind,
    id,
    stableId: id,
    lot: rawText.match(/\bLot\s*#\s*:?[\s-]*([A-Za-z0-9.-]+)/i)?.[1] || '',
    title,
    url,
    image: images[0] || '',
    images,
    description,
    descriptionHtml: card.querySelector('.item-description-deta, .product-description, .item-description, #description')?.innerHTML || '',
    descriptionFields: extractDescriptionFields(description),
    category,
    saleTitle: normalizeTitle(textOf(card.querySelector('a[href*="/sales/details/"]'))),
    saleUrl: canonicalAuctionNinjaSaleUrl(absoluteUrl(controlHref(card.querySelector('a[href*="/sales/details/"]')), base), base),
    seller: normalizeTitle(textOf(card.querySelector('a[href*="/seller"], .hi-auction-company-title a'))),
    sellerUrl: absoluteUrl(controlHref(card.querySelector('a[href*="/seller"], .hi-auction-company-title a')), base),
    location: parseLocation(rawText),
    shippingText: parseShipping(rawText),
    pickupText: parsePickup(rawText),
    highBid: bid.label,
    highBidAmount: bid.amount,
    currentBid: bid.amount,
    currentPrice: bid.amount,
    bidCount: rawText.match(/(?:^|[^#:])\b(\d+)\s+Bids?\b(?!\s*Now)/i)?.[0] || '',
    bidCountNumber: Number(rawText.match(/(?:^|[^#:])\b(\d+)\s+Bids?\b(?!\s*Now)/i)?.[1] || '') || null,
    timeLeft: parseTime(rawText),
    timeText: parseTime(rawText),
    status: /\bclosed\b|bidding\s+closed|lot\s+won/i.test(rawText) ? 'CLOSED' : (/coming\s+soon/i.test(rawText) ? 'COMING SOON' : 'OPEN'),
    watched: /\bfollowing\b|\bwatched\b|\bunfollow\b/i.test(rawText),
    detailEnriched: false,
    detailSource: '',
    rawText,
    extractionAudit: emptyAudit(base, cardSelector(card), {})
  } satisfies AuctionNinjaLotRecord;
  record.extractionAudit = emptyAudit(base, cardSelector(card), record);
  return record;
}

function accountStatus(raw: string, kind: 'followed-items' | 'items-won' | 'bid-history'): string {
  if (kind === 'items-won' && /Won/i.test(raw)) return 'Won';
  if (kind === 'items-won' && /Price\s+Realized|Sold/i.test(raw)) return 'Sold';
  if (/Outbid/i.test(raw)) return 'Outbid';
  if (/Winning/i.test(raw)) return 'Winning';
  if (/Following/i.test(raw)) return 'Following';
  if (/Watched|Watching/i.test(raw)) return 'Watching';
  if (/Bidding\s+Closed/i.test(raw)) return 'Bidding Closed';
  return '';
}

export function extractAuctionNinjaSaleContext(root: DomRoot, locationLike: AuctionNinjaLocationLike): AuctionNinjaSaleContext {
  const url = toAuctionNinjaUrl(locationLike);
  const raw = rawTextOf(rootElement(root));
  const flat = raw.replace(/\s+/g, ' ');
  const route = resolveAuctionNinjaPage(url);
  const lines = raw.split('\n').filter(Boolean);
  const title = firstText(root, ['h1', '.auction-title', '.sale-title']) || String((root as Document).title || '').replace(/\s*\|\s*AuctionNinja.*$/i, '').trim();
  const location = flat.match(/Auction Location:\s*([^|]+?)(?=\s+(?:Clearing|Shipping|Pickup|View Seller)\b)/i)?.[1]?.trim() || parseLocation(flat);
  const locationIndex = lines.findIndex((line) => /^Auction Location:?$/i.test(line));
  const seller = locationIndex >= 0 ? lines[locationIndex + 2] || '' : normalizeTitle(textOf(rootElement(root).querySelector('a[href*="/seller"]')));
  const specialInstructions = flat.match(/Special Instructions\s+(.+?)(?=\s+(?:Auction Manager|Buyer'?s Premium|Item Catalog)\b)/i)?.[1]?.trim() || '';
  const about = flat.match(/About the Sale\s+(.+?)(?=\s+Special Instructions\b)/i)?.[1]?.trim() || '';
  return {
    source: 'AuctionNinja', pageKind: 'sale-catalog', title, url: url.href,
    saleId: route.saleId || saleIdFromAuctionNinjaUrl(url.href), sellerSlug: route.sellerSlug || '', seller,
    location, buyerPremium: percentFromText(flat.match(/Buyer'?s Premium[\s\S]{0,80}/i)?.[0] || ''),
    pickupWindow: flat.match(/When to Pickup\s+(.+?)(?=\s+(?:About the Sale|Special Instructions|Auction Manager|Buyer'?s Premium|Item Catalog)\b)/i)?.[1]?.trim() || '',
    shipping: parseShipping(flat), specialInstructions, about,
    closingTime: flat.match(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+[A-Za-z]+\s+\d{1,2},\s+\d{4}\s+at\s+.*?(?:EDT|EST|CDT|CST|PDT|PST|MDT|MST)\b/i)?.[0] || '',
    expectedTotal: parseCatalogRange(raw)?.total || null
  };
}

export function parseCatalogRange(value: string): { start: number; end: number; total: number; pageSize: number; complete: boolean } | null {
  const match = String(value || '').match(/(\d+)\s*-\s*(\d+)\s+of\s+(\d+)\s+items?/i);
  if (!match) return null;
  const start = Number(match[1]); const end = Number(match[2]); const total = Number(match[3]);
  if (![start, end, total].every(Number.isFinite)) return null;
  return { start, end, total, pageSize: Math.max(0, end - start + 1), complete: end >= total };
}

export function extractAuctionNinjaCatalogLots(root: DomRoot, locationLike: AuctionNinjaLocationLike, pageKind: 'sale-catalog' | 'category-search' = 'sale-catalog'): AuctionNinjaLotRecord[] {
  const url = toAuctionNinjaUrl(locationLike);
  const cards = pageKind === 'category-search' ? categoryCards(root, url.href) : catalogCards(root, url.href);
  const category = pageKind === 'category-search' ? resolveAuctionNinjaPage(url).categoryName || '' : '';
  const byId = new Map<string, AuctionNinjaLotRecord>();
  for (const card of cards) {
    const item = baseLot(card, url.href, pageKind, category);
    if (item && !byId.has(item.stableId)) byId.set(item.stableId, item);
  }
  return Array.from(byId.values()).sort((a, b) => a.lot.localeCompare(b.lot, undefined, { numeric: true, sensitivity: 'base' }));
}

export function extractAuctionNinjaSaleCatalogItems(root: DomRoot, locationLike: AuctionNinjaLocationLike): AuctionNinjaLotRecord[] {
  return extractAuctionNinjaCatalogLots(root, locationLike, 'sale-catalog');
}

export function extractAuctionNinjaCategoryItems(root: DomRoot, locationLike: AuctionNinjaLocationLike): AuctionNinjaLotRecord[] {
  return extractAuctionNinjaCatalogLots(root, locationLike, 'category-search');
}

export function extractAuctionNinjaCategoryContext(root: DomRoot, locationLike: AuctionNinjaLocationLike): AuctionNinjaCategoryContext {
  const url = toAuctionNinjaUrl(locationLike);
  const route = resolveAuctionNinjaPage(url);
  const raw = rawTextOf(rootElement(root));
  const range = parseCatalogRange(raw);
  const count = raw.match(/\b([\d,]+)\s+results?\b/i)?.[1];
  return {
    source: 'AuctionNinja', pageKind: 'category-search', title: String((root as Document).title || '').replace(/\s*\|\s*AuctionNinja.*$/i, '').trim() || route.categoryName || 'AuctionNinja Category Search',
    category: route.categoryName || '', categorySlug: route.categorySlug || '', url: url.href,
    zip: route.zip || url.searchParams.get('zip') || '', miles: url.searchParams.get('miles') || '',
    totalItems: range?.total ?? (count ? Number(count.replace(/,/g, '')) : null), visibleItems: categoryCards(root, url.href).length
  };
}

export function extractAuctionNinjaAccountItems(root: DomRoot, locationLike: AuctionNinjaLocationLike, kind: 'followed-items' | 'items-won' | 'bid-history'): AuctionNinjaAccountItem[] {
  const url = toAuctionNinjaUrl(locationLike);
  const byId = new Map<string, AuctionNinjaAccountItem>();
  for (const card of accountCards(root, url.href)) {
    const item = baseLot(card, url.href, kind);
    if (!item || byId.has(item.stableId)) continue;
    const raw = item.rawText;
    const labels = kind === 'items-won' ? ['Price Realized', 'Lot Won', 'Won For', 'Sold For', 'Current Bid', 'High Bid'] : ['Current Bid', 'High Bid', 'Price Realized', 'Sold For', 'Starting Bid'];
    let priceText = '';
    for (const label of labels) { const match = raw.match(new RegExp(`\\b${label}\\b\\s*:?\\s*(\\$?[\\d,]+(?:\\.\\d{2})?)`, 'i')); const amount = match?.[1] || ''; if (amount) { priceText = `${label}: ${amount.startsWith('$') ? amount : `$${amount}`}`; break; } }
    if (!priceText) {
      const cardPrice = moneyFromText(textOf(card.querySelector('.ci-price')));
      if (cardPrice !== null) priceText = `Price: $${cardPrice.toFixed(2)}`;
    }
    const result = { ...item, status: accountStatus(raw, kind) || item.status, priceText, price: moneyFromText(priceText) } as AuctionNinjaAccountItem;
    if (kind === 'bid-history') {
      const match = raw.match(/\b(Your\s+(?:Max\s+)?Bid|My\s+Bid|Bid\s+Amount)\b\s*:?\s*(\$?[\d,]+(?:\.\d{2})?)/i);
      result.yourBidText = match ? `${match[1]}: ${match[2]}` : '';
      result.yourBid = moneyFromText(result.yourBidText);
    }
    byId.set(result.stableId, result);
  }
  return Array.from(byId.values());
}

export function parseAuctionNinjaAccountTotal(value: string): number | null {
  const match = String(value || '').match(/(?:Items?\s+(?:I\s+am\s+)?following|Items?\s+Won|Bid\s+History)[^\d]{0,40}\(?\s*Total\s*:\s*([\d,]+)\s*\)?/i);
  if (!match) return null;
  const total = Number((match[1] || '').replace(/,/g, ''));
  return Number.isFinite(total) ? total : null;
}

export function extractAuctionNinjaFollowedItems(root: DomRoot, locationLike: AuctionNinjaLocationLike): AuctionNinjaAccountItem[] { return extractAuctionNinjaAccountItems(root, locationLike, 'followed-items'); }
export function extractAuctionNinjaWonItems(root: DomRoot, locationLike: AuctionNinjaLocationLike): AuctionNinjaAccountItem[] { return extractAuctionNinjaAccountItems(root, locationLike, 'items-won'); }
export function extractAuctionNinjaBidHistoryItems(root: DomRoot, locationLike: AuctionNinjaLocationLike): AuctionNinjaAccountItem[] { return extractAuctionNinjaAccountItems(root, locationLike, 'bid-history'); }

function auctionNinjaDetailSection(container: Element | null, label: string): Element[] {
  if (!container) return [];
  const heading = [...container.children].find((child) => child.classList.contains('item-description-title')
    && new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i').test(textOf(child)));
  if (!heading) return [];
  const nodes: Element[] = [];
  let sibling = heading.nextElementSibling;
  while (sibling && !sibling.classList.contains('item-description-title')) {
    if (/(?:seller|pickup|auction|manager)/i.test(sibling.className)) break;
    nodes.push(sibling);
    sibling = sibling.nextElementSibling;
  }
  return nodes;
}

function auctionNinjaDetailSectionText(container: Element | null, label: string): string {
  return auctionNinjaDetailSection(container, label).map(rawTextOf).filter(Boolean).join('\n').trim();
}

export function extractAuctionNinjaItemDetail(root: DomRoot, locationLike: AuctionNinjaLocationLike): AuctionNinjaDetailRecord | null {
  const requested = toAuctionNinjaUrl(locationLike);
  const canonical = firstHref(root, ['link[rel="canonical"]', 'meta[property="og:url"]', 'meta[name="twitter:url"]'], requested.href) || requested.href;
  const pageUrl = toAuctionNinjaUrl(canonical, requested.href);
  const route = resolveAuctionNinjaPage(pageUrl);
  const detailRoot = rootElement(root).matches(DETAIL_ROOT_SELECTOR) ? rootElement(root) : rootElement(root).querySelector(DETAIL_ROOT_SELECTOR);
  if (!detailRoot || route.kind !== 'item-detail') return null;
  const raw = rawTextOf(detailRoot);
  const title = normalizeTitle(firstText(root, ['h1.item-detail-box-title', 'h1', '.product-title', '.item-title']) || String((root as Document).title || '').replace(/\s*\|\s*AuctionNinja.*$/i, ''));
  const id = route.productId || productIdFromAuctionNinjaUrl(pageUrl.href);
  if (!id || !title) return null;
  const images = imageUrls(detailRoot, pageUrl.href);
  const descriptionContainer = rootElement(root).querySelector('.item-description-deta');
  const sectionDescription = auctionNinjaDetailSectionText(descriptionContainer, 'Item Description');
  const sectionCondition = auctionNinjaDetailSectionText(descriptionContainer, 'Condition');
  const descriptionNode = sectionDescription
    ? null
    : rootElement(root).querySelector('.product-description, .item-description, .description, #description');
  const description = [sectionDescription || rawTextOf(descriptionNode) || cardDescription(detailRoot), sectionCondition ? `Condition: ${sectionCondition}` : ''].filter(Boolean).join('\n');
  const descriptionHtml = sectionDescription
    ? auctionNinjaDetailSection(descriptionContainer, 'Item Description').map((node) => node.outerHTML).join('')
    : descriptionNode?.innerHTML || '';
  const bid = parseBid(raw);
  const saleLink = rootElement(root).querySelector('a[href*="/sales/details/"]');
  const lotText = textOf(detailRoot.querySelector('.lot-number, [class*="lot-number"], [data-lot-number]'));
  const lot = lotText.match(/\bLot\s*#\s*:?[\s-]*([A-Za-z0-9.-]+)/i)?.[1]
    || raw.match(/\bLot\s*#\s*:?[\s-]*([A-Za-z0-9.-]+?)(?=[A-Z][a-z]|\s|$)/i)?.[1]
    || '';
  const result: AuctionNinjaDetailRecord = {
    source: 'AuctionNinja', pageKind: 'item-detail', id, stableId: id, url: canonicalAuctionNinjaProductUrl(pageUrl.href) || pageUrl.href, title,
    lot, image: images[0] || '', images,
    description, descriptionHtml, descriptionFields: extractDescriptionFields(description),
    category: textOf(rootElement(root).querySelector('.breadcrumb, .breadcrumbs')),
    saleTitle: normalizeTitle(textOf(saleLink)), saleUrl: canonicalAuctionNinjaSaleUrl(absoluteUrl(controlHref(saleLink), pageUrl.href)), seller: '', sellerUrl: '',
    location: parseLocation(raw), shippingText: parseShipping(raw), pickupText: parsePickup(raw), highBid: bid.label, highBidAmount: bid.amount, currentBid: bid.amount,
    currentPrice: bid.amount, bidCount: raw.match(/\b\d+\s+Bids?\b/i)?.[0] || '', bidCountNumber: Number(raw.match(/\b(\d+)\s+Bids?\b/i)?.[1] || '') || null,
    timeLeft: parseTime(raw), timeText: parseTime(raw), status: /\b(?:closed|lot won|bidding closed)\b/i.test(raw) ? 'CLOSED' : 'OPEN', watched: false,
    detailEnriched: true, detailSource: 'same-origin-product-document', rawText: raw,
    extractionAudit: { sourceUrl: pageUrl.href, cardSelector: DETAIL_ROOT_SELECTOR, fieldsPresent: ['title', 'url', 'description', 'images'].filter((key) => Boolean({ title, url: pageUrl.href, description, images: images.length }[key])), missingFields: [] }
  };
  return result;
}

export function mergeAuctionNinjaItemDetail(item: AuctionNinjaLotRecord, detail: AuctionNinjaDetailRecord | null): AuctionNinjaLotRecord {
  if (!detail) return item;
  const merged = { ...item };
  const fillKeys: Array<keyof AuctionNinjaLotRecord> = ['lot', 'title', 'image', 'category', 'saleTitle', 'saleUrl', 'highBid', 'highBidAmount', 'currentBid', 'currentPrice', 'bidCount', 'bidCountNumber', 'timeText', 'timeLeft', 'status', 'location', 'pickupText', 'shippingText'];
  for (const key of fillKeys) {
    const value = detail[key];
    if ((merged[key] === '' || merged[key] === null || merged[key] === undefined) && value !== '' && value !== null && value !== undefined) merged[key] = value as never;
  }
  if (detail.description) { if (item.description && item.description !== detail.description) merged.cardDescription = item.description; merged.description = detail.description; }
  if (detail.descriptionHtml) merged.descriptionHtml = detail.descriptionHtml;
  if (detail.descriptionFields) merged.descriptionFields = { ...merged.descriptionFields, ...detail.descriptionFields };
  merged.images = uniqueNonEmpty([...item.images, ...(detail.images || []), item.image, detail.image || '']);
  if (!merged.image) merged.image = merged.images[0] || '';
  merged.detailEnriched = true; merged.detailSource = 'same-origin-product-document';
  merged.extractionAudit = { ...merged.extractionAudit, fieldsPresent: uniqueNonEmpty([...merged.extractionAudit.fieldsPresent, 'detailEnriched']), missingFields: merged.extractionAudit.missingFields.filter((field) => !detail[field as keyof AuctionNinjaDetailRecord]) };
  return merged;
}

export function sanitizeAuctionNinjaAccountRawText(value: string): string {
  return String(value || '').replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted-email]').replace(/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/g, '[redacted-phone]').replace(/\s+/g, ' ').trim();
}

export function sanitizeAuctionNinjaAccountItem(item: AuctionNinjaAccountItem): AuctionNinjaAccountItem {
  return { ...item, rawText: sanitizeAuctionNinjaAccountRawText(item.rawText), location: sanitizeAuctionNinjaAccountRawText(item.location), shippingText: sanitizeAuctionNinjaAccountRawText(item.shippingText), pickupText: sanitizeAuctionNinjaAccountRawText(item.pickupText) };
}

function sanitizeAccountUrl(value: string): string {
  try {
    const url = new URL(value, DEFAULT_BASE);
    url.searchParams.delete('an');
    url.hash = '';
    return url.href;
  } catch { return ''; }
}

export function sanitizeAuctionNinjaAccountExport(input: { source?: string; pageKind?: string; url?: string; context?: Record<string, unknown>; items?: Array<Record<string, unknown>> }): { source: 'AuctionNinja'; pageKind: string; url: string; context: Record<string, unknown>; items: Array<Record<string, unknown>> } {
  const sanitizeRecord = (value: Record<string, unknown>): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (/bidder|email|phone|street|address|invoice|payment|card|authorization|cookie|token|session/i.test(key)) continue;
      if (typeof item === 'string') result[key] = sanitizeAuctionNinjaAccountRawText(item);
      else result[key] = item;
    }
    if (typeof result.url === 'string') result.url = sanitizeAccountUrl(result.url);
    return result;
  };
  return {
    source: 'AuctionNinja',
    pageKind: String(input.pageKind || 'followed-items'),
    url: sanitizeAccountUrl(String(input.url || '')),
    context: sanitizeRecord(input.context || {}),
    items: (input.items || []).map(sanitizeRecord)
  };
}

export function scraperStableIdentity(item: Partial<AuctionNinjaLotRecord | AuctionNinjaSaleRecord>, siteKind = 'auctionninja'): string {
  if (siteKind !== 'auctionninja') return '';
  if (item.stableId || item.id) return String(item.stableId || item.id);
  return 'url' in item ? productIdFromAuctionNinjaUrl(String(item.url || '')) : auctionNinjaSaleStableIdentity(String(item.url || ''));
}

export { isAuctionNinjaHost };
