/** Native selectors and small DOM observations for current and legacy HiBid lots. */
export const HIBID_LOT_ROOT_SELECTOR = [
  'div.lot-tile.lot-card[id^="lot-"]',
  'app-lot-condensed[id^="lot-"]',
  'app-lot-full[id^="lot-"]',
  'app-lot-tile[id^="lot-"]',
  '.bid-status-border[id^="lot-"]',
  '[data-event-item-id]'
].join(', ');

export interface HibidMoneyObservation { amount: number | null; currency: string | null; quantity: number | null }
export interface HibidDomObservation {
  id: string; lot: string; title: string; url: string;
  current: HibidMoneyObservation; next: HibidMoneyObservation;
  quantity: number | null; mixed: boolean; bidMultiplier: number | null; watched: boolean | null;
  status: string;
}
export interface HibidResearchMount { container: Element; before: Element | null }

function clean(value: unknown): string { return String(value || '').replace(/\s+/g, ' ').trim() }

function nativeText(node: Element | null): string {
  if (!node) return '';
  const clone = node.cloneNode(true) as Element;
  clone.querySelectorAll('[data-flippah-owned="true"], app-watch-notes, [class*="app-watch-notes"], script, style, template').forEach((item) => item.remove());
  return clean(clone.textContent);
}

function hrefId(root: Element): string {
  const href = root.querySelector<HTMLAnchorElement>('a[href*="/lot/"]')?.getAttribute('href') || '';
  return href.match(/\/lot\/(\d+)/i)?.[1] || '';
}

function canonicalId(root: Element): string {
  return hrefId(root) || root.getAttribute('data-event-item-id') || root.querySelector('[data-event-item-id]')?.getAttribute('data-event-item-id') || (root.id || '').replace(/^lot-/, '') || '';
}

function isPrimaryRoot(element: Element): boolean {
  return element.matches('div.lot-tile.lot-card, app-lot-condensed, app-lot-full, app-lot-tile, .bid-status-border');
}

function rootCandidate(element: Element): Element {
  if (isPrimaryRoot(element)) return element;
  return element.closest('div.lot-tile.lot-card, app-lot-condensed, app-lot-full, app-lot-tile, .bid-status-border') || element;
}

export function getHibidLotRoots(root: Document | Element): Element[] {
  const candidates: Element[] = [];
  if (root.nodeType === 1 && (root as Element).matches(HIBID_LOT_ROOT_SELECTOR)) candidates.push(root as Element);
  root.querySelectorAll(HIBID_LOT_ROOT_SELECTOR).forEach((candidate) => candidates.push(rootCandidate(candidate)));
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    if (candidate.closest('[data-flippah-owned="true"]')) return false;
    const id = canonicalId(candidate);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export function getHibidLotRoot(element: Element | null): Element | null {
  if (!element) return null;
  const verified = element.matches(HIBID_LOT_ROOT_SELECTOR) ? element : element.closest(HIBID_LOT_ROOT_SELECTOR);
  if (!verified) return null;
  const candidate = rootCandidate(verified);
  return canonicalId(candidate) && !candidate.closest('[data-flippah-owned="true"]') ? candidate : null;
}

function amount(value: string): number | null {
  const match = value.replace(/,/g, '').match(/(?:^|\s|\$)(\d+(?:\.\d+)?)/);
  const parsed = match ? Number(match[1]) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}
function currency(value: string): string | null { return value.match(/(?:^|[^A-Z])([A-Z]{3})(?:$|[^A-Z])/)?.[1] || null }
function quantityFromText(value: string): number | null {
  const parsed = Number(value.match(/x\s*(\d+)/i)?.[1] || '');
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}
function moneyObservation(node: Element | null): HibidMoneyObservation {
  const text = nativeText(node);
  return { amount: amount(text), currency: currency(text), quantity: quantityFromText(text) };
}
function multiplierFromBidMarkup(value: string): number | null {
  const parsed = Number(value.match(/x\s*(\d+)/i)?.[1] || '');
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function directChild(container: Element, selector: string): Element | null {
  return [...container.children].find((child) => child.matches(selector)) || null;
}

export function readHibidLotDom(element: Element): HibidDomObservation | null {
  const root = getHibidLotRoot(element);
  if (!root) return null;
  const id = canonicalId(root);
  const redesign = root.matches('div.lot-tile.lot-card') || Boolean(root.querySelector('.app-auction-lot-card__identity'));
  const identity = root.querySelector('.app-auction-lot-card__identity');
  const lotNumber = nativeText(identity?.querySelector('.app-auction-lot-card__lot-number') || root.querySelector('.lot-number-lead strong, .lot-number-lead a'));
  const title = nativeText(identity?.querySelector('.app-auction-lot-card__title') || root.querySelector('h2.lot-title, .lot-title') || root.querySelector('.lot-lead-heading'));
  if (!redesign && !title) return null;
  const currentNode = root.querySelector('.app-auction-lot-card__meta-money, .lot-high-bid');
  const nextNode = root.querySelector('.app-auction-lot-card__cta, .app-auction-lot-card__footer .app-button, .TileDisplayMinBid');
  const current = moneyObservation(currentNode);
  const next = moneyObservation(nextNode);
  const quantity = current.quantity ?? next.quantity;
  const bidMarkup = [
    root.querySelector('.app-auction-lot-card__meta-money'),
    root.querySelector('.app-auction-lot-card__lot-bid-history, .lot-bid-history'),
    root.querySelector('.app-auction-lot-card__cta, .app-auction-lot-card__footer .app-button'),
    root.querySelector('.lot-high-bid, .TileDisplayMinBid')
  ].map(nativeText).join(' ');
  const timesBadge = [...root.querySelectorAll('.app-auction-lot-card__badge, [class*="badge"]')].some((node) => /times\s+the\s+money/i.test(nativeText(node)));
  const bidMultiplier = multiplierFromBidMarkup(bidMarkup);
  const watch = root.querySelector<HTMLButtonElement>('.app-watch-star');
  return {
    id,
    lot: clean(lotNumber.replace(/^Lot\s*#?\s*/i, '')) || (title.match(/\bLot\s*#?\s*([\w.-]+)/i)?.[1] || id),
    title,
    url: root.querySelector<HTMLAnchorElement>('a[href*="/lot/"]')?.href || '',
    current: { ...current, quantity: current.quantity ?? quantity },
    next: { ...next, quantity: next.quantity ?? quantity },
    quantity,
    mixed: timesBadge || bidMultiplier !== null,
    bidMultiplier,
    watched: watch ? watch.getAttribute('aria-pressed') === 'true' : null,
    status: nativeText(root.querySelector('.app-auction-lot-card__bid-status'))
      || (root.querySelector('.app-auction-lot-badge[data-tone="closed"]') ? 'Closed' : '')
  };
}

export function getHibidResearchMount(element: Element): HibidResearchMount | null {
  const root = getHibidLotRoot(element);
  if (!root) return null;
  const content = root.querySelector('.app-auction-lot-card__content');
  if (content) return { container: content, before: directChild(content, '.app-auction-lot-card__info') };
  const legacyContent = root.querySelector('.current-bids-card-content, .account-card, .lot-tile-content, .lot-card-content')
    || (root.matches('.current-bids-card-content, .account-card, .lot-tile-content, .lot-card-content') ? root : null);
  if (legacyContent) return { container: legacyContent, before: legacyContent.firstElementChild };
  const lead = root.querySelector('.lot-lead-heading');
  if (lead) return { container: lead, before: null };
  return root.matches('app-lot-tile') ? { container: root, before: null } : null;
}

export function getHibidCostAnchor(element: Element): Element | null {
  const root = getHibidLotRoot(element);
  if (!root) return null;
  if (root.querySelector('.app-auction-lot-card__footer')) return root.querySelector('.app-auction-lot-card__footer');
  if (root.matches('app-lot-condensed, app-lot-full')) return root.querySelector('app-lot-buttons');
  return null;
}
