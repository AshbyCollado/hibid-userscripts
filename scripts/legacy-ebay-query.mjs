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
    .replace(/\bx\s*\d+\b/gi, ' ')
    .replace(/\b\d+\s*pcs?\b/gi, ' ')
    .replace(/\b(?:online\s+)?auction\s+(?:item|lot)\b.*$/i, ' ')
    .replace(/^\s*(?:av|inv(?:entory)?|sku)\s*[-:|]\s*/i, ' ')
    .replace(/[^a-z0-9.+-]+/g, ' ');

  const noise = new Set([
    'nice', 'estate', 'untested', 'working', 'approx', 'approximate',
    'damage', 'damaged', 'read', 'look', 'wow', 'rare'
  ]);
  const filteredTokens = query
    .split(/\s+/)
    .map((token) => token.replace(/^[.+-]+|[.-]+$/g, ''))
    .filter((token) => token && token !== 'x' && !noise.has(token));
  let tokens = filteredTokens;
  for (let blockLength = 3; blockLength <= Math.floor(filteredTokens.length / 2); blockLength += 1) {
    if (filteredTokens.length % blockLength !== 0) continue;
    if (filteredTokens.every((token, index) => token === filteredTokens[index % blockLength])) {
      tokens = filteredTokens.slice(0, blockLength);
      break;
    }
  }
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

export function patchLegacyRemoveShipping(source) {
  const labelMarker = '<label for="lotlens-shipping">Shipping</label>';
  const labelIndex = source.indexOf(labelMarker);
  if (labelIndex < 0) throw new Error('Unable to locate the legacy shipping control');
  const rowStart = source.lastIndexOf('<div class="lotlens-row">', labelIndex);
  const rowEnd = source.indexOf('</div>', labelIndex);
  if (rowStart < 0 || rowEnd < 0) throw new Error('Unable to locate the legacy shipping row');
  let patched = `${source.slice(0, rowStart)}${source.slice(rowEnd + '</div>'.length)}`;
  patched = patched
    .replaceAll('shipCents:i.shipCents', 'shipCents:0')
    .replaceAll('shipCents:wi.shipCents', 'shipCents:0')
    .replaceAll('i.shipCents=wi.shipCents', 'i.shipCents=0')
    .replaceAll('Budget is below shipping', 'Budget is below fees and tax');
  return patched;
}

export function patchLegacyRemoveCatalogChips(source) {
  const startMarker = 'var h=`lotlens-catalog-chip`';
  const endMarker = 'var ae=';
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error('Unable to locate the legacy catalog-chip controller');
  }
  let patched = `${source.slice(0, start)}async function y(e){b()}function b(){for(let e of Array.from(document.getElementsByClassName(["lotlens","catalog","chip"].join("-"))))e.remove()}${source.slice(end)}`;
  const styleStart = patched.indexOf('.lotlens-catalog-chip{');
  if (styleStart >= 0) {
    const styleEnd = patched.indexOf('}', styleStart);
    if (styleEnd < styleStart) throw new Error('Unable to parse the legacy catalog-chip style');
    patched = `${patched.slice(0, styleStart)}${patched.slice(styleEnd + 1)}`;
  }
  return patched;
}

export function patchLegacyHibidPageModule(source) {
  const currentBidNeedle = 'currentBid:[`app-lot-details-subpanel .lot-high-bid`,`.lot-high-bid`,`.live-catalog-high-bid-status-default.lot-bid-container`]';
  const currentBidReplacement = 'currentBid:[`app-lot-details-subpanel .lot-high-bid`,`.lot-high-bid`,`.live-catalog-high-bid-status-default.lot-bid-container`,`.lot-price-realized-container`]';
  if (!source.includes(currentBidNeedle)) {
    throw new Error('Unable to locate the legacy HiBid current-bid selectors');
  }
  return source.replace(currentBidNeedle, currentBidReplacement);
}
