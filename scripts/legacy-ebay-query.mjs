export function buildEbaySoldQuery(title) {
  const original = String(title || '').replace(/\s+/g, ' ').trim();
  if (!original) return '';

  let query = original
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^\s*lot\s*#?\s*[\w-]+\s*[-:|]\s*/i, ' ')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\b(?:lot|pair|set|group)\s+of\s+\d+\b/gi, ' ')
    .replace(/\b\d+(?:\.\d+)?\s*(?:"|in(?:ch(?:es)?)?|cm|ft|')(?=\s|$)/gi, ' ')
    .replace(/\bx\s*\d+\b/gi, ' ')
    .replace(/\b\d+\s*pcs?\b/gi, ' ')
    .replace(/\b(?:online\s+)?auction\s+(?:item|lot)\b.*$/i, ' ')
    .replace(/[^a-z0-9.]+/g, ' ');

  const noise = new Set([
    'nice', 'estate', 'untested', 'working', 'approx', 'approximate',
    'damage', 'damaged', 'read', 'look', 'wow', 'rare'
  ]);
  const tokens = query
    .split(/\s+/)
    .map((token) => token.replace(/^\.+|\.+$/g, ''))
    .filter((token) => token && token !== 'x' && !noise.has(token));
  query = tokens.join(' ');

  if (query.length > 120) {
    const shortened = query.slice(0, 121).replace(/\s+\S*$/, '').trim();
    query = shortened || query.slice(0, 120).trim();
  }
  return tokens.length >= 2 ? query : original.slice(0, 120);
}

export function patchLegacyEbayQueryModule(source) {
  const startMarker = 'function w(e){';
  const endMarker = 'function oe(e){';
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('Unable to locate the legacy eBay query builder');
  }

  const replacement = buildEbaySoldQuery
    .toString()
    .replace(/^function\s+buildEbaySoldQuery/, 'function w');
  return `${source.slice(0, start)}${replacement}${source.slice(end)}`;
}

export function patchLegacyHibidPageModule(source) {
  const currentBidNeedle = 'currentBid:[`app-lot-details-subpanel .lot-high-bid`,`.lot-high-bid`,`.live-catalog-high-bid-status-default.lot-bid-container`]';
  const currentBidReplacement = 'currentBid:[`app-lot-details-subpanel .lot-high-bid`,`.lot-high-bid`,`.live-catalog-high-bid-status-default.lot-bid-container`,`.lot-price-realized-container`]';
  if (!source.includes(currentBidNeedle)) {
    throw new Error('Unable to locate the legacy HiBid current-bid selectors');
  }
  return source.replace(currentBidNeedle, currentBidReplacement);
}
