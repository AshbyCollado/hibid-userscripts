export const EBAY_LIFECYCLE_SCHEMA = 'fliptracker.ebay.lifecycle.v1' as const;

export type EbayLifecyclePageKind = 'active' | 'ended' | 'sold' | 'transactions';
export type EbayLifecycleRecord = Record<string, string | number | boolean | null> & {
  record_type: 'active_listing' | 'ended_listing' | 'sold_order_line' | 'transaction';
  event_id: string;
};

export interface EbayLifecycleCompleteness {
  expected_count: number | null;
  count_known: boolean;
  parsed_count: number;
  review_required_count: number;
  has_next_page: boolean;
  page_count: number;
  complete: boolean;
  reason: string;
}

export interface EbayLifecycleEnvelope {
  schema_version: typeof EBAY_LIFECYCLE_SCHEMA;
  export_id: string;
  source: 'ebay';
  page_kind: EbayLifecyclePageKind;
  generated_at: string;
  page_url: string;
  completeness: EbayLifecycleCompleteness;
  records: EbayLifecycleRecord[];
}

export interface EbayLifecycleRoute {
  supported: boolean;
  pageKind: EbayLifecyclePageKind | null;
  canonicalUrl: string;
}

export interface LifecyclePage {
  document: Document;
  url: string;
}

export interface LifecycleCollectorOptions {
  initialDocument?: Document;
  fetchPage: (url: string, signal?: AbortSignal) => Promise<LifecyclePage>;
  advanceDomPage?: (signal?: AbortSignal) => Promise<LifecyclePage | null>;
  signal?: AbortSignal;
  generatedAt?: string;
  maxPages?: number;
}

const ROUTES: ReadonlyArray<{ kind: EbayLifecyclePageKind; pattern: RegExp; canonicalUrl: string }> = [
  { kind: 'active', pattern: /^\/sh\/lst\/active\/?$/i, canonicalUrl: 'https://www.ebay.com/sh/lst/active' },
  { kind: 'active', pattern: /^\/mys\/active(?:\/rf(?:\/.*)?)?\/?$/i, canonicalUrl: 'https://www.ebay.com/mys/active' },
  { kind: 'ended', pattern: /^\/sh\/lst\/ended\/?$/i, canonicalUrl: 'https://www.ebay.com/sh/lst/ended?status=ENDED&timePeriod=LAST_90_DAYS&source=filterbar&action=search' },
  { kind: 'sold', pattern: /^\/mys\/sold(?:\/rf(?:\/.*)?)?\/?$/i, canonicalUrl: 'https://www.ebay.com/mys/sold' },
  { kind: 'transactions', pattern: /^\/mes\/transactionlist\/?$/i, canonicalUrl: 'https://www.ebay.com/mes/transactionlist?sh=true' }
];

const TYPE_BY_KIND: Record<EbayLifecyclePageKind, EbayLifecycleRecord['record_type']> = {
  active: 'active_listing', ended: 'ended_listing', sold: 'sold_order_line', transactions: 'transaction'
};

export function resolveEbayLifecycleRoute(value: string | URL): EbayLifecycleRoute {
  try {
    const url = value instanceof URL ? value : new URL(value);
    if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'www.ebay.com') {
      return { supported: false, pageKind: null, canonicalUrl: '' };
    }
    const route = ROUTES.find((candidate) => candidate.pattern.test(url.pathname));
    return route
      ? { supported: true, pageKind: route.kind, canonicalUrl: route.canonicalUrl }
      : { supported: false, pageKind: null, canonicalUrl: '' };
  } catch {
    return { supported: false, pageKind: null, canonicalUrl: '' };
  }
}

export function lifecycleRoutes(): ReadonlyArray<{ pageKind: EbayLifecyclePageKind; pageUrl: string }> {
  return [
    { pageKind: 'active', pageUrl: ROUTES[0]!.canonicalUrl },
    { pageKind: 'ended', pageUrl: ROUTES[2]!.canonicalUrl },
    { pageKind: 'sold', pageUrl: ROUTES[3]!.canonicalUrl },
    { pageKind: 'transactions', pageUrl: ROUTES[4]!.canonicalUrl }
  ];
}

function clean(value: unknown): string {
  return String(value ?? '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function integer(value: unknown): number | null {
  const match = clean(value).match(/-?[\d,]+/);
  if (!match) return null;
  const parsed = Number(match[0].replace(/,/g, ''));
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function money(value: unknown): number | null {
  const match = clean(value).replace(/\u2212/g, '-').match(/(?:US\s*)?\$\s*(-?[\d,]+(?:\.\d{1,2})?)|(-?)\s*\$\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (!match) return null;
  const parsed = Number((match[1] || `${match[2] || ''}${match[3] || ''}`).replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function valueAfter(text: string, labels: string, valuePattern = '[^|\\n]{1,120}?'): string {
  const match = text.match(new RegExp(`(?:${labels})\\s*:?\\s*(${valuePattern})(?=\\s+(?:Item|Order|Transaction|Quantity|Qty|Shipping|Sales tax|Tax|Total|Gross|Net|Status|Custom label|SKU|Date|Sold)\\b|[|\\n]|$)`, 'i'));
  return clean(match?.[1]);
}

function moneyAfter(text: string, labels: string): number | null {
  const value = valueAfter(text, labels, '(?:-?\\s*(?:US\\s*)?\\$\\s*[\\d,]+(?:\\.\\d{1,2})?)');
  return money(value);
}

function itemIdFrom(value: string): string {
  return value.match(/\/itm\/(\d{9,15})/i)?.[1]
    || value.match(/(?:itemId|itemid)[=:](\d{9,15})/i)?.[1]
    || '';
}

function canonicalItemUrl(itemId: string): string {
  return itemId ? `https://www.ebay.com/itm/${itemId}` : '';
}

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36).padStart(7, '0');
}

function eventId(type: EbayLifecycleRecord['record_type'], identity: string): string {
  return `ebay:${type}:${hash(identity.toLowerCase())}`;
}

function itemAnchor(root: ParentNode): { itemId: string; title: string } | null {
  const anchors = [...root.querySelectorAll<HTMLAnchorElement>('a[href*="/itm/"]')]
    .map((anchor) => ({ itemId: itemIdFrom(anchor.href), title: clean(anchor.textContent) }))
    .filter((item) => item.itemId);
  if (!anchors.length) return null;
  return anchors.sort((left, right) => right.title.length - left.title.length)[0]!;
}

function tableColumnMap(row: Element): Map<string, number> {
  const table = row.closest('table');
  const header = table?.querySelector('thead tr') || table?.querySelector('tr');
  const map = new Map<string, number>();
  [...(header?.querySelectorAll('th,[role="columnheader"]') || [])].forEach((cell, index) => {
    const label = clean(cell.textContent)
      .replace(/Sort\s+(?:ascending|descending).*$/i, '')
      .replace(/This column\s+shows.*$/i, '')
      .trim()
      .toLowerCase();
    if (label) map.set(label, index);
  });
  return map;
}

function cellText(row: Element, map: Map<string, number>, labels: string[]): string {
  const cells = [...row.querySelectorAll<HTMLElement>(':scope > td, :scope > [role="gridcell"]')];
  for (const label of labels) {
    const wanted = label.toLowerCase();
    const entry = [...map.entries()].find(([key]) => key === wanted || key.startsWith(`${wanted} `));
    if (entry) return clean(cells[entry[1]]?.textContent);
  }
  return '';
}

function uniqueRecordRoots(document: Document, selectors: string): Element[] {
  const candidates = [...document.querySelectorAll(selectors)];
  return candidates.filter((element) => !candidates.some((other) => other !== element && other.contains(element)));
}

function parseListings(document: Document, pageKind: 'active' | 'ended'): EbayLifecycleRecord[] {
  const roots = uniqueRecordRoots(document, 'tbody > tr, [role="row"], [qa-id^="active-item-"], [id^="active-item-"], [data-testid*="listing-row"]');
  const type = TYPE_BY_KIND[pageKind];
  const records: EbayLifecycleRecord[] = [];
  for (const root of roots) {
    const anchor = itemAnchor(root);
    if (!anchor) continue;
    const text = clean(root.textContent);
    const columns = tableColumnMap(root);
    const title = clean(anchor.title || cellText(root, columns, ['Item']));
    if (!title) continue;
    const price = money(cellText(root, columns, ['Current price', 'Price'])) ?? moneyAfter(text, '(?:Current price|Price)');
    if (pageKind === 'active' && price === null) continue;
    const customLabel = cellText(root, columns, ['Custom label (SKU)', 'Custom label', 'SKU'])
      || valueAfter(text, '(?:Custom label(?: \\(SKU\\))?|SKU)');
    const stableIdentity = anchor.itemId;
    records.push({
      record_type: type,
      event_id: eventId(type, stableIdentity),
      item_id: anchor.itemId,
      custom_label: customLabel,
      title,
      item_url: canonicalItemUrl(anchor.itemId),
      status: pageKind === 'active' ? 'Active' : (valueAfter(text, '(?:Sold status|Status)') || 'Ended'),
      price,
      quantity_total: integer(valueAfter(text, '(?:Total quantity|Quantity total|Quantity)')),
      quantity_available: integer(cellText(root, columns, ['Available quantity'])) ?? integer(valueAfter(text, '(?:Available quantity|Quantity available|Available)')),
      views: integer(cellText(root, columns, ['Views (30 days)', 'Views'])) ?? integer(valueAfter(text, 'Views?')),
      watchers: integer(cellText(root, columns, ['Watchers'])) ?? integer(valueAfter(text, 'Watchers?')),
      bids: integer(cellText(root, columns, ['Bids'])) ?? integer(valueAfter(text, 'Bids?')),
      listing_format: cellText(root, columns, ['Format']) || valueAfter(text, 'Format'),
      listing_duration: cellText(root, columns, ['Duration']) || valueAfter(text, 'Duration'),
      ended_at_text: pageKind === 'ended' ? (cellText(root, columns, ['End date']) || valueAfter(text, '(?:End date|Ended)')) : '',
      offers_enabled: /\bbest offer|offers? enabled|accepts? offers?\b/i.test(text)
    });
  }
  return records;
}

function parseSold(document: Document): EbayLifecycleRecord[] {
  const roots = uniqueRecordRoots(document, '[data-order-id], [data-testid*="order-card"], .sold-itemcard, tbody > tr');
  const records: EbayLifecycleRecord[] = [];
  for (const root of roots) {
    const text = clean(root.textContent);
    const orderId = root.getAttribute('data-order-id') || valueAfter(text, 'Order(?: number| ID)?', '[\\d-]{8,}');
    if (!orderId) continue;
    const anchors = [...root.querySelectorAll<HTMLAnchorElement>('a[href*="/itm/"]')]
      .map((anchor) => ({ itemId: itemIdFrom(anchor.href), title: clean(anchor.textContent), line: anchor.closest<HTMLElement>('[data-order-line-id], [data-testid*="order-line"], .order-line-item') }))
      .filter((item) => item.itemId);
    const seen = new Set<string>();
    for (const anchor of anchors) {
      const lineRoot = anchor.line || root;
      const lineText = clean(lineRoot.textContent);
      const orderLineId = lineRoot.getAttribute('data-order-line-id') || `${orderId}:${anchor.itemId}`;
      if (seen.has(orderLineId)) continue;
      seen.add(orderLineId);
      const title = anchor.title;
      if (!title) continue;
      records.push({
        record_type: 'sold_order_line', event_id: eventId('sold_order_line', orderLineId),
        order_id: orderId, order_line_id: orderLineId, item_id: anchor.itemId,
        custom_label: valueAfter(lineText, '(?:Custom label(?: \\(SKU\\))?|SKU)'), title,
        item_url: canonicalItemUrl(anchor.itemId), sale_date: valueAfter(text, '(?:Sold(?: on)?|Sale date)'),
        quantity: integer(valueAfter(lineText, '(?:Quantity|Qty)')) ?? 1,
        item_subtotal: moneyAfter(lineText, '(?:Item subtotal|Item total|Subtotal)'),
        shipping_charged: moneyAfter(text, '(?:Shipping charged|Shipping)'),
        sales_tax: moneyAfter(text, '(?:Sales tax|Tax)'), order_total: moneyAfter(text, 'Order total'),
        status: text.match(/\b(Paid|Shipped|Delivered|Canceled|Cancelled|Refunded|Awaiting payment)\b/i)?.[1] || 'Sold'
      });
    }
  }
  return records;
}

function parseTransactions(document: Document): EbayLifecycleRecord[] {
  const roots = uniqueRecordRoots(document, '[data-transaction-id], .transaction-row-v2, [data-testid*="transaction-row"], tbody > tr');
  const records: EbayLifecycleRecord[] = [];
  for (const root of roots) {
    const text = clean(root.textContent);
    const hrefs = [...root.querySelectorAll<HTMLAnchorElement>('a[href]')].map((anchor) => anchor.href).join(' ');
    const explicitId = root.getAttribute('data-transaction-id') || valueAfter(text, 'Transaction ID', '[\\w-]{4,}');
    const orderId = valueAfter(text, 'Order(?: number| ID)?', '[\\d-]{8,}');
    const itemId = itemIdFrom(hrefs) || valueAfter(text, 'Item(?: ID)?', '\\d{9,15}');
    const type = text.match(/\b(Sale|Refund|Shipping label|Payout|Adjustment|Fee|Dispute)\b/i)?.[1] || '';
    const date = valueAfter(text, '(?:Transaction date|Date)', '(?:[A-Z][a-z]{2,8} \\d{1,2}(?:, \\d{4})?|\\d{4}-\\d{2}-\\d{2}|\\d{1,2}\\/\\d{1,2}\\/\\d{4})');
    const gross = moneyAfter(text, '(?:Gross|Amount)');
    const fee = moneyAfter(text, '(?:Final value fee|Platform fee|eBay fee)');
    const net = moneyAfter(text, '(?:Net amount|Net)');
    const derivedStable = Boolean(type && date && (orderId || itemId) && [gross, fee, net].some((value) => value !== null));
    if (!explicitId && !derivedStable) continue;
    const transactionId = explicitId || `derived-${hash([orderId, itemId, type, date, gross, fee, net].join('|').toLowerCase())}`;
    records.push({
      record_type: 'transaction', event_id: eventId('transaction', transactionId), transaction_id: transactionId,
      transaction_id_source: explicitId ? 'explicit' : 'derived', identity_stable: true,
      order_id: orderId, item_id: itemId, transaction_type: type || 'Transaction', transaction_date: date,
      gross_amount: gross, platform_fee: fee === null ? null : -Math.abs(fee),
      promoted_fee: moneyAfter(text, '(?:Promoted listing fee|Ad fee)'),
      refund_amount: /refund/i.test(type) ? Math.abs(gross ?? 0) : null,
      shipping_label_amount: /shipping label/i.test(type) ? Math.abs(gross ?? 0) : null,
      net_amount: net, payout_id: valueAfter(text, 'Payout ID', '[\\w-]{4,}'),
      payout_date: valueAfter(text, 'Payout date'), status: text.match(/\b(Paid|Pending|Available|On hold|Failed|Reversed)\b/i)?.[1] || ''
    });
  }
  return records;
}

export function parseEbayLifecycleDocument(document: Document, pageKind: EbayLifecyclePageKind): EbayLifecycleRecord[] {
  const records = pageKind === 'active' || pageKind === 'ended'
    ? parseListings(document, pageKind)
    : pageKind === 'sold' ? parseSold(document) : parseTransactions(document);
  const expectedType = TYPE_BY_KIND[pageKind];
  const byId = new Map<string, EbayLifecycleRecord>();
  for (const record of records) {
    if (record.record_type !== expectedType) throw new Error('eBay lifecycle record type does not match route');
    assertNoBuyerPii(record);
    if (!byId.has(record.event_id)) byId.set(record.event_id, record);
  }
  return [...byId.values()].sort((left, right) => left.event_id.localeCompare(right.event_id));
}

export function expectedEbayLifecycleCount(document: Document, pageKind: EbayLifecyclePageKind): number | null {
  const text = clean([...document.body.children].map((element) => element.textContent || '').join(' '));
  const headingPattern = pageKind === 'active' ? /\bManage active listings\s*\(([\d,]+)\)/i
    : pageKind === 'ended' ? /\bManage ended listings\s*\(([\d,]+)\)/i
      : pageKind === 'sold' ? /\b(?:Sold items|Orders)\s*\(([\d,]+)\)/i
        : /\bTransactions\s*\(([\d,]+)\)/i;
  for (const heading of document.querySelectorAll('h1,h2,h3,[role="heading"]')) {
    const count = integer(clean(heading.textContent).match(headingPattern)?.[1]);
    if (count !== null) return count;
  }
  if (pageKind === 'active' || pageKind === 'ended') {
    const markup = document.documentElement.innerHTML;
    const embedded = markup.match(/(?:&quot;|["'])listingCount(?:&quot;|["'])\s*:\s*(?:&quot;|["'])?([\d,]+)/i);
    const count = integer(embedded?.[1]);
    if (count !== null) return count;
  }
  const patterns = [
    /\bResults\s*:\s*[\d,]+\s*(?:-|to)\s*[\d,]+\s+of\s+([\d,]+)\b/i,
    /(?:Showing\s+)?[\d,]+\s*(?:-|to)\s*[\d,]+\s+of\s+([\d,]+)\s+(?:results|orders|transactions|listings|items)\b/i,
    new RegExp(`\\b${pageKind === 'transactions' ? 'Transactions' : pageKind === 'sold' ? '(?:Sold|Orders)' : pageKind === 'ended' ? 'Ended' : 'Manage active listings'}\\s*(?:\\(|:)\\s*([\\d,]+)\\)?`, 'i')
  ];
  for (const pattern of patterns) {
    const count = integer(text.match(pattern)?.[1]);
    if (count !== null) return count;
  }
  const empty = pageKind === 'active' ? /\b(?:no active listings|0 active listings|0 results)\b/i
    : pageKind === 'ended' ? /\b(?:no ended listings|0 ended listings|0 results)\b/i
      : pageKind === 'sold' ? /\b(?:no sold items|no orders found|0 orders|0 results)\b/i
        : /\b(?:no transactions|0 transactions|0 results)\b/i;
  return empty.test(text) ? 0 : null;
}

export function nextEbayLifecyclePageUrl(document: Document, pageUrl: string): string {
  const control = document.querySelector<HTMLElement>('a.pagination__next:not([aria-disabled="true"]), a[aria-label*="Next page" i]:not([aria-disabled="true"]), a[rel="next"], [data-url].pagination__next:not([aria-disabled="true"])');
  const href = control?.getAttribute('href') || control?.getAttribute('data-url') || '';
  if (!href) return '';
  try {
    const next = new URL(href, pageUrl);
    return next.protocol === 'https:' && next.hostname === 'www.ebay.com' && resolveEbayLifecycleRoute(pageUrl).pageKind === resolveEbayLifecycleRoute(next).pageKind
      ? next.href : '';
  } catch { return ''; }
}

export function hasDomNextPage(document: Document): boolean {
  const control = document.querySelector<HTMLElement>('button.pagination__next, button[aria-label*="Next page" i]');
  return Boolean(control && !control.hasAttribute('disabled') && control.getAttribute('aria-disabled') !== 'true');
}

const PII_KEY = /^(?:buyer|username|userid|email|phone|telephone|shippingaddress|shipto|recipient|contact|message|address)/i;
const PII_VALUE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|\b(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]\d{3}[\s.-]\d{4}\b|\b\d{1,6}\s+[A-Za-z0-9.' -]{2,40}\s(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way)\b|\b(?:Buyer(?: name| username| user ID| ID)?|Shipping address|Ship to|Recipient|Phone|E-?mail)\s*[:=]/i;

export function assertNoBuyerPii(value: unknown, key = ''): void {
  if (key.replace(/[^a-z0-9]/gi, '').match(PII_KEY) && value !== null && value !== undefined && value !== '') {
    throw new Error('Buyer PII is not permitted in eBay lifecycle exports');
  }
  if (typeof value === 'string' && PII_VALUE.test(value)) throw new Error('Buyer PII is not permitted in eBay lifecycle exports');
  if (Array.isArray(value)) value.forEach((item) => assertNoBuyerPii(item));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([childKey, child]) => assertNoBuyerPii(child, childKey));
}

export function buildEbayLifecycleEnvelope(records: EbayLifecycleRecord[], meta: {
  pageKind: EbayLifecyclePageKind; pageUrl: string; expectedCount: number | null; pageCount: number;
  hasNextPage?: boolean; generatedAt?: string; collectionError?: string;
}): EbayLifecycleEnvelope {
  const route = resolveEbayLifecycleRoute(meta.pageUrl);
  if (!route.supported || route.pageKind !== meta.pageKind) throw new Error('eBay lifecycle page URL does not match the envelope route');
  const sorted = [...records].sort((left, right) => left.event_id.localeCompare(right.event_id));
  assertNoBuyerPii(sorted);
  const unique = new Set(sorted.map((record) => record.event_id));
  if (unique.size !== sorted.length) throw new Error('Duplicate eBay lifecycle event IDs');
  const expectedType = TYPE_BY_KIND[meta.pageKind];
  if (sorted.some((record) => record.record_type !== expectedType)) throw new Error('eBay lifecycle record type does not match route');
  const countKnown = meta.expectedCount !== null;
  const countMatches = countKnown && meta.expectedCount === sorted.length;
  const hasNextPage = Boolean(meta.hasNextPage);
  const complete = countMatches && !hasNextPage && !meta.collectionError;
  const reason = meta.collectionError || (!countKnown ? `Expected count is unknown; parsed ${sorted.length} record(s).`
    : !countMatches ? `Expected ${meta.expectedCount} record(s), parsed ${sorted.length}.`
      : hasNextPage ? 'More eBay result pages remain.' : '');
  const fingerprint = hash(JSON.stringify({ pageKind: meta.pageKind, expectedCount: meta.expectedCount, records: sorted }));
  const envelope: EbayLifecycleEnvelope = {
    schema_version: EBAY_LIFECYCLE_SCHEMA, export_id: `ebay-${meta.pageKind}-${fingerprint}`, source: 'ebay',
    page_kind: meta.pageKind, generated_at: meta.generatedAt || new Date().toISOString(), page_url: route.canonicalUrl,
    completeness: { expected_count: meta.expectedCount, count_known: countKnown, parsed_count: sorted.length,
      review_required_count: 0, has_next_page: hasNextPage, page_count: meta.pageCount, complete, reason },
    records: sorted
  };
  assertEbayLifecycleEnvelope(envelope, meta.pageKind);
  return envelope;
}

export function assertEbayLifecycleEnvelope(value: unknown, expectedKind?: EbayLifecyclePageKind): asserts value is EbayLifecycleEnvelope {
  if (!value || typeof value !== 'object') throw new Error('Malformed eBay lifecycle envelope');
  const envelope = value as EbayLifecycleEnvelope;
  if (envelope.schema_version !== EBAY_LIFECYCLE_SCHEMA || envelope.source !== 'ebay') throw new Error('Unsupported eBay lifecycle schema');
  if (!Object.hasOwn(TYPE_BY_KIND, envelope.page_kind) || (expectedKind && envelope.page_kind !== expectedKind)) throw new Error('eBay lifecycle route mismatch');
  const route = resolveEbayLifecycleRoute(envelope.page_url);
  if (!route.supported || route.pageKind !== envelope.page_kind) throw new Error('eBay lifecycle page URL mismatch');
  if (!Array.isArray(envelope.records) || envelope.records.length > 20_000) throw new Error('Invalid eBay lifecycle records');
  if (!envelope.completeness || envelope.completeness.parsed_count !== envelope.records.length) throw new Error('eBay lifecycle parsed count mismatch');
  if (envelope.completeness.complete !== (envelope.completeness.count_known
    && envelope.completeness.expected_count === envelope.records.length
    && envelope.completeness.review_required_count === 0 && !envelope.completeness.has_next_page)) {
    throw new Error('eBay lifecycle completeness flags are inconsistent');
  }
  const expectedType = TYPE_BY_KIND[envelope.page_kind];
  const ids = new Set<string>();
  for (const record of envelope.records) {
    if (record.record_type !== expectedType || typeof record.event_id !== 'string' || !record.event_id.startsWith(`ebay:${expectedType}:`)) throw new Error('Invalid eBay lifecycle record identity');
    if (ids.has(record.event_id)) throw new Error('Duplicate eBay lifecycle event IDs');
    ids.add(record.event_id);
  }
  assertNoBuyerPii(envelope);
}

export function serializeEbayLifecycleEnvelope(envelope: EbayLifecycleEnvelope): string {
  assertEbayLifecycleEnvelope(envelope);
  return `${JSON.stringify(envelope, null, 2)}\n`;
}

export async function collectEbayLifecycle(pageKind: EbayLifecyclePageKind, pageUrl: string, options: LifecycleCollectorOptions): Promise<EbayLifecycleEnvelope> {
  const startRoute = resolveEbayLifecycleRoute(pageUrl);
  if (!startRoute.supported || startRoute.pageKind !== pageKind) throw new Error('Unsupported eBay lifecycle route');
  const maxPages = Math.max(1, Math.min(100, options.maxPages ?? 100));
  const records = new Map<string, EbayLifecycleRecord>();
  const seenUrls = new Set<string>();
  let page: LifecyclePage | null = options.initialDocument ? { document: options.initialDocument, url: pageUrl } : null;
  let currentUrl = pageUrl;
  let expectedCount: number | null = null;
  let pageCount = 0;
  let hasNext = false;
  let error = '';

  while (pageCount < maxPages) {
    if (options.signal?.aborted) { error = 'Collection cancelled.'; break; }
    try { page ||= await options.fetchPage(currentUrl, options.signal); }
    catch (caught) { error = `Fetch failed: ${caught instanceof Error ? caught.message : String(caught)}`; break; }
    const route = resolveEbayLifecycleRoute(page.url);
    if (!route.supported || route.pageKind !== pageKind) { error = 'Pagination left the requested eBay lifecycle route.'; break; }
    const urlKey = page.url.replace(/#.*$/, '');
    if (seenUrls.has(urlKey)) { error = 'Pagination loop detected.'; break; }
    seenUrls.add(urlKey);
    pageCount += 1;
    const pageExpected = expectedEbayLifecycleCount(page.document, pageKind);
    if (pageExpected !== null) expectedCount = expectedCount === null ? pageExpected : Math.max(expectedCount, pageExpected);
    for (const record of parseEbayLifecycleDocument(page.document, pageKind)) if (!records.has(record.event_id)) records.set(record.event_id, record);
    const nextUrl = nextEbayLifecyclePageUrl(page.document, page.url);
    const domNext = hasDomNextPage(page.document);
    hasNext = Boolean(nextUrl || domNext);
    if (!hasNext) break;
    if (nextUrl) { currentUrl = nextUrl; page = null; continue; }
    if (!options.advanceDomPage) { error = 'eBay pagination requires the signed-in page to be open.'; break; }
    try { page = await options.advanceDomPage(options.signal); }
    catch (caught) { error = `DOM pagination failed: ${caught instanceof Error ? caught.message : String(caught)}`; break; }
    if (!page) { error = 'eBay did not render the next page.'; break; }
    currentUrl = page.url;
  }
  if (pageCount >= maxPages && hasNext && !error) error = `Stopped after ${pageCount} pages; more results remain.`;
  return buildEbayLifecycleEnvelope([...records.values()], {
    pageKind, pageUrl, expectedCount, pageCount, hasNextPage: hasNext && Boolean(error), generatedAt: options.generatedAt, collectionError: error
  });
}
