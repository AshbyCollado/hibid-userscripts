import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import { selectAmazonCandidateTitle, type AmazonCandidate } from './us-deal-intelligence.js';

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;

const EXPLICIT_USED_RE = /\b(open\s*box|openbox|refurbished|refurb|renewed|pre[\s-]?owned|for\s+parts(?:\s+only)?|parts\s+only|not\s+working|broken|salvage)\b/i;
const USED_BADGE_RE = /^(?:save\s+with\s+)?(?:used(?:\s*[-\u2013:]\s*(?:like\s+new|very\s+good|good|acceptable))?|used\s+for\s+parts|for\s+parts|open\s*box|openbox|refurbished|refurb|renewed|pre[\s-]?owned)$/i;
const INSTALLMENT_RE = /(?:\/\s*(?:mo(?:nth)?|month)|\bper\s+month\b|\bmonthly\b|\binstallments?\b|\bpayments?\s+of\b)/i;

function isElement(node: Node): node is Element {
  return 'tagName' in node;
}

function attribute(node: Element, name: string): string {
  return node.attrs.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function hasClass(node: Element, name: string): boolean {
  return attribute(node, 'class').split(/\s+/).includes(name);
}

function textContent(node: Node): string {
  if ('value' in node) return node.value;
  if (!('childNodes' in node)) return '';
  return node.childNodes.map(textContent).join('');
}

function normalizedText(node: Node): string {
  return textContent(node).replace(/\s+/g, ' ').trim();
}

function descendants(root: Element, rootAsin: string): Element[] {
  const found: Element[] = [];
  const visit = (node: Node): void => {
    if (!('childNodes' in node)) return;
    for (const child of node.childNodes) {
      if (!isElement(child)) continue;
      const nestedAsin = attribute(child, 'data-asin');
      if (nestedAsin && /^[A-Z0-9]{10}$/i.test(nestedAsin) && nestedAsin.toUpperCase() !== rootAsin) continue;
      found.push(child);
      visit(child);
    }
  };
  visit(root);
  return found;
}

function currencyPrice(value: string): number | null {
  const match = value.match(/(?:US\s*)?\$\s*([\d,]+(?:\.\d{1,2})?)/i);
  if (!match) return null;
  const parsed = Number(match[1]?.replace(/,/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function containsNode(root: Node, target: Node): boolean {
  if (root === target) return true;
  return 'childNodes' in root && root.childNodes.some((child) => containsNode(child, target));
}

function containsPriceNode(root: Node, asin: string): boolean {
  if (isElement(root) && hasClass(root, 'a-price')) return true;
  if (!('childNodes' in root)) return false;
  return root.childNodes.some((child) => {
    if (isElement(child)) {
      const nestedAsin = attribute(child, 'data-asin').toUpperCase();
      if (nestedAsin && nestedAsin !== asin) return false;
    }
    return containsPriceNode(child, asin);
  });
}

function adjacentPriceText(parent: Element, node: Element, asin: string): { before: string; after: string } {
  const branchIndex = parent.childNodes.findIndex((child) => containsNode(child, node));
  if (branchIndex < 0) return { before: '', after: '' };
  const before: string[] = [];
  for (let index = branchIndex - 1; index >= 0; index -= 1) {
    const sibling = parent.childNodes[index]!;
    if (containsPriceNode(sibling, asin)) break;
    before.unshift(textContent(sibling));
  }
  const after: string[] = [];
  for (let index = branchIndex + 1; index < parent.childNodes.length; index += 1) {
    const sibling = parent.childNodes[index]!;
    if (containsPriceNode(sibling, asin)) break;
    after.push(textContent(sibling));
  }
  return {
    before: before.join(' ').replace(/\s+/g, ' ').trim(),
    after: after.join(' ').replace(/\s+/g, ' ').trim(),
  };
}

function isInstallmentPrice(node: Element, asin: string): boolean {
  if (INSTALLMENT_RE.test(normalizedText(node))) return true;
  let parent: Node | null = node.parentNode;
  while (parent && isElement(parent)) {
    const parentAsin = attribute(parent, 'data-asin').toUpperCase();
    const siblingPrices = [parent, ...descendants(parent, asin)].filter((item) => hasClass(item, 'a-price'));
    const adjacent = adjacentPriceText(parent, node, asin);
    if (INSTALLMENT_RE.test(adjacent.after)
      || /\b(?:payments?|installments?)\s+(?:of\s*)?$/i.test(adjacent.before)) return true;
    if (siblingPrices.length <= 1 && INSTALLMENT_RE.test(normalizedText(parent))) return true;
    if (/^[A-Z0-9]{10}$/.test(parentAsin)) return false;
    parent = parent.parentNode;
  }
  return false;
}

function priceFromContainer(node: Element, asin: string): number | null {
  const contents = descendants(node, asin);
  for (const offscreen of contents.filter((item) => hasClass(item, 'a-offscreen'))) {
    const price = currencyPrice(normalizedText(offscreen));
    if (price != null) return price;
  }
  const labelledPrice = currencyPrice(attribute(node, 'aria-label'));
  if (labelledPrice != null) return labelledPrice;

  const whole = contents.find((item) => hasClass(item, 'a-price-whole'));
  const fraction = contents.find((item) => hasClass(item, 'a-price-fraction'));
  const wholeText = whole ? textContent(whole).replace(/[^\d]/g, '') : '';
  if (wholeText) {
    const parsed = Number(`${wholeText}.${fraction ? textContent(fraction).replace(/[^\d]/g, '') || '00' : '00'}`);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return currencyPrice(normalizedText(node));
}

function parseCardPrice(elements: Element[], asin: string): number | null {
  const containers = elements.filter((item) => hasClass(item, 'a-price') && !hasClass(item, 'a-text-price'));
  for (const container of containers) {
    if (isInstallmentPrice(container, asin)) continue;
    const price = priceFromContainer(container, asin);
    if (price != null) return price;
  }
  return null;
}

function isConditionBadge(node: Element): boolean {
  const scope = [
    attribute(node, 'class'),
    attribute(node, 'id'),
    attribute(node, 'data-cy'),
    attribute(node, 'data-component-type'),
  ].join(' ');
  return /(?:^|[-_\s])(?:badge|condition)(?:$|[-_\s])/i.test(scope);
}

function hasUsedCondition(titleEvidence: string[], elements: Element[]): boolean {
  if (titleEvidence.some((value) => EXPLICIT_USED_RE.test(value))) return true;
  return elements.some((item) => isConditionBadge(item) && USED_BADGE_RE.test(normalizedText(item)));
}

function isSponsoredMarker(node: Element): boolean {
  const componentType = attribute(node, 'data-component-type');
  const className = attribute(node, 'class');
  if (/^sp-sponsored-result$/i.test(componentType) || /(?:^|\s)AdHolder(?:\s|$)/i.test(className)) return true;
  const markerScope = [className, attribute(node, 'id'), attribute(node, 'data-cy')].join(' ');
  return /sponsored/i.test(markerScope) && /^(?:Sponsored|Sponsored Ad)$/i.test(normalizedText(node));
}

function hasValidPrice(candidate: AmazonCandidate): boolean {
  return candidate.price != null && Number.isFinite(candidate.price) && candidate.price > 0;
}

function preferCandidate(candidate: AmazonCandidate, previous: AmazonCandidate): boolean {
  const candidateTraits = [!candidate.sponsored, !candidate.used, hasValidPrice(candidate)];
  const previousTraits = [!previous.sponsored, !previous.used, hasValidPrice(previous)];
  for (let index = 0; index < candidateTraits.length; index += 1) {
    if (candidateTraits[index] !== previousTraits[index]) return Boolean(candidateTraits[index]);
  }
  return hasValidPrice(candidate) && hasValidPrice(previous) && candidate.price! < previous.price!;
}

function productSlug(urlValue: string, asin: string): string {
  try {
    const url = new URL(urlValue, 'https://www.amazon.com');
    const parts = url.pathname.split('/').filter(Boolean);
    const marker = parts.findIndex((part) => /^(?:dp|product)$/i.test(part));
    if (marker < 1 || parts[marker + 1]?.toUpperCase() !== asin) return '';
    return decodeURIComponent(parts[marker - 1] || '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

function parseResult(node: Element, asin: string): AmazonCandidate | null {
  const own = descendants(node, asin);
  const image = own.find((item) => item.tagName === 'img' && hasClass(item, 's-image'))
    || own.find((item) => item.tagName === 'img' && Boolean(attribute(item, 'alt')));
  const titleNodes = own.filter((item) => item.tagName === 'h2'
    || attribute(item, 'data-cy') === 'title-recipe'
    || hasClass(item, 's-title-instructions-style'));
  const titleEvidence = [
    image ? attribute(image, 'alt') : '',
    ...titleNodes.map((item) => textContent(item).replace(/\s+/g, ' ').trim()),
  ];
  const title = selectAmazonCandidateTitle(titleEvidence)
    || textContent(node).replace(/\s+/g, ' ').trim();
  if (!title) return null;

  const price = parseCardPrice(own, asin);

  const link = own.find((item) => item.tagName === 'a' && new RegExp(`/(?:dp|gp/product)/${asin}(?:[/?#]|$)`, 'i').test(attribute(item, 'href')));
  const slug = link ? productSlug(attribute(link, 'href'), asin) : '';
  const matchText = [...new Set([title, ...titleEvidence, slug]
    .map((value) => value.replace(/^Sponsored\s*Ad\s*[\u2013-]\s*/i, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean))].join(' ');
  const sponsored = [node, ...own].some(isSponsoredMarker);

  return {
    asin,
    title: title.replace(/^Sponsored\s*Ad\s*[\u2013-]\s*/i, '').trim(),
    matchText,
    price,
    used: hasUsedCondition(titleEvidence, own),
    sponsored,
    url: `https://www.amazon.com/dp/${asin}`,
  };
}

/** Parse Amazon search HTML as a tree so nested data-asin nodes cannot cross-wire titles and prices. */
export function parseAmazonDocumentCandidates(html: string | null | undefined): AmazonCandidate[] {
  const document = parse(String(html || ''));
  const roots: Element[] = [];
  const visit = (node: Node, ancestorAsins: string[] = []): void => {
    if (!('childNodes' in node)) return;
    for (const child of node.childNodes) {
      let childAncestorAsins = ancestorAsins;
      if (isElement(child)) {
        const asin = attribute(child, 'data-asin').toUpperCase();
        if (/^[A-Z0-9]{10}$/.test(asin)) {
          if (!ancestorAsins.includes(asin)) roots.push(child);
          childAncestorAsins = [...ancestorAsins, asin];
        }
      }
      visit(child, childAncestorAsins);
    }
  };
  visit(document);

  const byAsin = new Map<string, AmazonCandidate>();
  for (const root of roots) {
    const asin = attribute(root, 'data-asin').toUpperCase();
    const candidate = parseResult(root, asin);
    if (!candidate) continue;
    const previous = byAsin.get(asin);
    if (!previous || preferCandidate(candidate, previous)) {
      byAsin.set(asin, candidate);
    }
  }
  return [...byAsin.values()];
}

function elementById(root: Node, id: string): Element | null {
  if (isElement(root) && attribute(root, 'id') === id) return root;
  if (!('childNodes' in root)) return null;
  for (const child of root.childNodes) {
    const match = elementById(child, id);
    if (match) return match;
  }
  return null;
}

/** Add detail-page identity evidence while preserving the search result's market price. */
export function enrichAmazonCandidateFromDetail(candidate: AmazonCandidate, html: string | null | undefined): AmazonCandidate {
  const document = parse(String(html || ''));
  const title = textContent(elementById(document, 'productTitle') || document).replace(/\s+/g, ' ').trim();
  if (!title || title.length > 1_000) return candidate;
  const evidenceIds = [
    'feature-bullets', 'productOverview_feature_div', 'detailBullets_feature_div',
    'productFactsDesktop_feature_div', 'variation_color_name', 'variation_size_name'
  ];
  const evidence = evidenceIds
    .map((id) => elementById(document, id))
    .filter((node): node is Element => Boolean(node))
    .map((node) => textContent(node).replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');
  return {
    ...candidate,
    title,
    matchText: `${title} ${evidence}`.replace(/\s+/g, ' ').trim().slice(0, 4_000),
    used: candidate.used || EXPLICIT_USED_RE.test(`${title} ${evidence}`),
    detailEnriched: true,
  };
}
