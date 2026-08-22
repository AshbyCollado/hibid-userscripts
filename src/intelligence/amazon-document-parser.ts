import { parse, type DefaultTreeAdapterTypes } from 'parse5';
import type { AmazonCandidate } from './us-deal-intelligence.js';

type Node = DefaultTreeAdapterTypes.Node;
type Element = DefaultTreeAdapterTypes.Element;

const USED_RE = /\b(open\s*box|openbox|refurbished|refurb|renewed|pre[\s-]?owned|used|for\s+parts)\b/i;

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

function firstNumber(value: string): number | null {
  const match = value.replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
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
  const image = own.find((item) => item.tagName === 'img' && hasClass(item, 's-image'));
  const titleNode = own.find((item) => item.tagName === 'h2')
    || own.find((item) => attribute(item, 'data-cy') === 'title-recipe')
    || own.find((item) => hasClass(item, 's-title-instructions-style'));
  const title = (image ? attribute(image, 'alt') : '') || textContent(titleNode || node).replace(/\s+/g, ' ').trim();
  if (!title) return null;

  const offscreen = own.find((item) => hasClass(item, 'a-offscreen'));
  let price = offscreen ? firstNumber(textContent(offscreen)) : null;
  if (price == null) {
    const whole = own.find((item) => hasClass(item, 'a-price-whole'));
    const fraction = own.find((item) => hasClass(item, 'a-price-fraction'));
    const wholeText = whole ? textContent(whole).replace(/[^\d]/g, '') : '';
    if (wholeText) price = Number(`${wholeText}.${fraction ? textContent(fraction).replace(/[^\d]/g, '') || '00' : '00'}`);
  }

  const link = own.find((item) => item.tagName === 'a' && new RegExp(`/(?:dp|gp/product)/${asin}(?:[/?#]|$)`, 'i').test(attribute(item, 'href')));
  const slug = link ? productSlug(attribute(link, 'href'), asin) : '';
  const sponsored = /\bAdHolder\b/.test(attribute(node, 'class'))
    || own.some((item) => attribute(item, 'data-component-type') === 'sp-sponsored-result')
    || own.some((item) => /^(?:Sponsored|Sponsored Ad)$/i.test(textContent(item).trim()) && /sponsored/i.test(attribute(item, 'class')));

  return {
    asin,
    title: title.replace(/^Sponsored\s*Ad\s*[\u2013-]\s*/i, '').trim(),
    matchText: slug ? `${title} ${slug}` : title,
    price,
    used: USED_RE.test(title),
    sponsored,
    url: `https://www.amazon.com/dp/${asin}`,
  };
}

/** Parse Amazon search HTML as a tree so nested data-asin nodes cannot cross-wire titles and prices. */
export function parseAmazonDocumentCandidates(html: string | null | undefined): AmazonCandidate[] {
  const document = parse(String(html || ''));
  const roots: Element[] = [];
  const visit = (node: Node): void => {
    if (!('childNodes' in node)) return;
    for (const child of node.childNodes) {
      if (isElement(child)) {
        const asin = attribute(child, 'data-asin').toUpperCase();
        if (/^[A-Z0-9]{10}$/.test(asin)) roots.push(child);
      }
      visit(child);
    }
  };
  visit(document);

  const byAsin = new Map<string, AmazonCandidate>();
  for (const root of roots) {
    const asin = attribute(root, 'data-asin').toUpperCase();
    const candidate = parseResult(root, asin);
    if (!candidate) continue;
    const previous = byAsin.get(asin);
    if (!previous || (previous.sponsored && !candidate.sponsored)
      || (previous.sponsored === candidate.sponsored && (candidate.price ?? Infinity) < (previous.price ?? Infinity))) {
      byAsin.set(asin, candidate);
    }
  }
  return [...byAsin.values()];
}
