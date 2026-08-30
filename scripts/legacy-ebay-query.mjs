export function buildEbaySoldQuery(title) {
  const named = { amp: '&', apos: "'", copy: '', gt: '>', hellip: '...', lt: '<', nbsp: ' ', quot: '"', reg: '', times: 'x', trade: '' };
  const normalise = (value) => String(value || '')
    .replace(/&([a-z]+);/gi, (entity, name) => named[name.toLowerCase()] ?? entity)
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (entity, hex, decimal) => {
      const codePoint = Number.parseInt(hex || decimal || '', hex ? 16 : 10);
      try { return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity; }
      catch { return entity; }
    })
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
    .replace(/[Øø]/g, (character) => character === 'Ø' ? 'O' : 'o')
    .replace(/[Łł]/g, (character) => character === 'Ł' ? 'L' : 'l')
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/×/g, 'x')
    .replace(/[\u00a0\u2007\u202f]/g, ' ');
  const stripPrefixes = (value) => {
    let output = value.trim();
    const patterns = [
      /^\s*\{?\s*(?:each|ea)\b\s*\}?\s*/i,
      /^\s*(?:lot|item)\s+(?=(?:stock|sku|inventory|inv)\s*[:#])/i,
      /^\s*(?:online\s+)?auction\s+(?:item|lot)\s*(?:(?:no\.?|number)\s+|#\s*)[a-z0-9.-]+\s*(?:[:|]\s*|-\s+)?/i,
      /^\s*(?:online\s+)?auction\s+(?:item|lot)\s+(?=[a-z0-9.-]*\d)[a-z0-9.-]+\s*(?:[:|]\s*|-\s+)/i,
      /^\s*(?:lot|item)\s*#\s*:\s*[a-z0-9.-]+\s*(?:[:|]\s*|-\s+)/i,
      /^\s*(?:lot|item)\s+(?:(?:no\.?|number)\s+|#\s*)[a-z0-9.-]+\s*(?:[:|]\s*|-\s+)?/i,
      /^\s*(?:lot|item)\s+(?=[a-z0-9.-]*\d)[a-z0-9.-]+\s*(?:[:|]\s*|-\s+)/i,
      /^\s*(?:stock|sku|inventory|inv)\s*(?:#\s*|:\s*)[a-z0-9.-]+\s*(?:[:|]\s*|-\s+)/i,
      /^\s*(?:stock|sku|inventory|inv)\s+(?=[a-z0-9.-]*\d)[a-z0-9.-]+\s*(?:[:|]\s*|-\s+)/i,
      /^\s*(?:lot|item)\s+(?!(?:1[89]\d{2}|20\d{2})\s)\d{1,4}\s+(?!(?:case|count|ct|pack|pair|pcs?|pieces?|pk|rolls?|set|units?|x)\b)(?=[a-z])/i,
      /^\s*(?:lot|item)\s+(?!(?:of|no\.?|number)\b|#)/i,
      /^\s*(?:lot|item)\s*:\s*/i,
      /^\s*#\s*[a-z0-9.-]+\s*(?:[:|]\s*|-\s+)/i,
      /^\s*(?:av|inventory|inv|sku)\s*(?:[:|]\s*|-\s+)(?!\s*[a-z0-9.-]+\s*(?:[:|]|-\s+))\s*/i,
      /^\s*[a-z]{1,3}\d{1,2}\s+(?=\$\s*[\d,]+)/i,
      /^\s*(?:(?:lot|group)\s+of\s+\(?\d{1,4}\)?|\(?\d{1,4}\)?\s*x)\s*[-:|]?\s+/i,
      /^\s*(?:qty|quantity)\s*[:#]?\s*\d{1,4}\s*[-:|]?\s+/i,
      /^\s*(?:retail|msrp|est\.?\s*retail(?:\s*price)?|value)\s*[:\-]?\s*\$?\s*[\d,]+(?:\.\d+)?\s*(?:[-:|]\s*)?/i,
      /^\s*\$(?!\s*\d+\s*\/)\s*[\d,]+(?:\.\d+)?\s*(?:[-:|]\s*)?/i,
      /^\s*\(?\s*(?:open\s*box|refurbished|refurb|renewed|pre[\s-]?owned|used|brand\s+new|new\s+in\s+box)\s*\)?(?:\s*[-:|]\s*|\s+)/i,
    ];
    for (let pass = 0; pass < 8; pass += 1) {
      const previous = output;
      output = collapseExactRaw(output.replace(/^["']+|["']+$/g, '').trim());
      output = output.replace(/^\s*([A-Za-z])([A-Za-z])\d{1,2}\s+/, (match, first, second) => (
        first !== second && first.toLowerCase() === second.toLowerCase() ? '' : match
      ));
      for (const pattern of patterns) {
        output = collapseExactRaw(output.replace(pattern, '').trim());
      }
      if (output === previous) break;
    }
    return output;
  };
  const stripSuffixes = (value) => {
    let output = value.trim();
    const suffix = /(?:\s*(?:[-|,;]\s*)|\s+)\(?\s*(?:tested(?:\s+and)?\s+working|not\s+tested|working|untested|open\s*box|brand\s+new\s+in\s+box|brand\s+new|new\s+in\s+box|in\s+box|nib|used|refurbished|refurb|renewed|pre[\s-]?owned|for\s+parts(?:\s+only)?|parts\s+only|as[\s-]*is|damaged|pickup\s+only|local\s+pickup\s+only|see\s+(?:photos?|pictures?|description)|read\s+description|no\s+reserve|online\s+only\s+auction|lot\s*#?\s*\d+)\s*\)?\s*$/i;
    for (let pass = 0; pass < 12; pass += 1) {
      const next = collapseExactRaw(output.replace(suffix, '').trim());
      if (next === output) break;
      output = next;
    }
    return output;
  };
  const repairSuffixes = (tokens) => {
    const repaired = [];
    const guards = new Set(['series', 'model', 'size', 'type', 'class', 'grade', 'gen', 'generation', 'lot']);
    const pluralNouns = new Set([
      'adapter', 'book', 'bowl', 'cable', 'camera', 'card', 'charger', 'console', 'controller',
      'cup', 'dish', 'doppler', 'drive', 'earbud', 'game', 'headphone', 'lamp', 'lens', 'light',
      'microphone', 'module', 'monitor', 'plate', 'printer', 'projector', 'receiver', 'router',
      'scanner', 'scrub', 'sensor', 'speaker', 'stand', 'switch', 'tablet', 'tool', 'unit', 'watch',
    ]);
    for (const token of tokens) {
      const previous = repaired.at(-1) || '';
      if (token === 's' && pluralNouns.has(previous) && !guards.has(previous)) repaired[repaired.length - 1] = `${previous}s`;
      else repaired.push(token);
    }
    return repaired;
  };
  const collapseRepeated = (tokens) => {
    let output = [...tokens];
    let changed = true;
    while (changed) {
      changed = false;
      for (let width = Math.floor(output.length / 2); width >= 3 && !changed; width -= 1) {
        for (let start = 0; start + (width * 2) <= output.length; start += 1) {
          const left = output.slice(start, start + width);
          const right = output.slice(start + width, start + (width * 2));
          if (left.every((token, index) => token === right[index])) {
            output = [...output.slice(0, start + width), ...output.slice(start + (width * 2))];
            changed = true;
            break;
          }
        }
      }
    }
    if (output.length === 4 && output[0] === output[2] && output[1] === output[3]) {
      return output.slice(0, 2);
    }
    return output;
  };
  const collapseBoundary = (tokens) => {
    const output = [...tokens];
    const maxWidth = Math.min(6, Math.floor((output.length - 2) / 2));
    for (let width = maxWidth; width >= 2; width -= 1) {
      const prefix = output.slice(0, width);
      const exactStart = output.length - width;
      if (exactStart > width && prefix.every((token, index) => token === output[exactStart + index])) {
        return output.slice(0, exactStart);
      }
      const truncatedStart = output.length - width - 1;
      const trailingFragment = output.at(-1) || '';
      if (truncatedStart > width
        && trailingFragment.length === 1
        && prefix.every((token, index) => token === output[truncatedStart + index])) {
        return output.slice(0, truncatedStart);
      }
    }
    return output;
  };
  const capTokens = (tokens, maxLength = 120) => {
    const usable = tokens.filter((token) => token.length <= maxLength);
    if (usable.join(' ').length <= maxLength) return usable;
    const essential = new Set();
    usable.slice(0, 3).forEach((_, index) => essential.add(index));
    usable.slice(-2).forEach((_, index) => essential.add(Math.max(0, usable.length - 2 + index)));
    usable.forEach((token, index) => { if (/\d/.test(token) || /[+/]/.test(token)) essential.add(index); });
    const selected = [...essential].sort((left, right) => left - right);
    const lengthOf = (indexes) => indexes.reduce((total, index) => total + usable[index].length, 0) + Math.max(0, indexes.length - 1);
    while (selected.length > 1 && lengthOf(selected) > maxLength) {
      const removable = selected.findIndex((index, position) => position > 1 && position < selected.length - 2 && !/\d/.test(usable[index]));
      selected.splice(removable >= 0 ? removable : selected.length - 2, 1);
    }
    for (let index = 0; index < usable.length; index += 1) {
      if (selected.includes(index)) continue;
      const candidate = [...selected, index].sort((left, right) => left - right);
      if (lengthOf(candidate) <= maxLength) selected.splice(0, selected.length, ...candidate);
    }
    return selected.map((index) => usable[index]);
  };
  const collapseExactRaw = (value) => {
    let words = value.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
    let changed = false;
    let found = true;
    while (found) {
      found = false;
      for (let width = Math.floor(words.length / 2); width >= 3 && !found; width -= 1) {
        for (let start = 0; start + (width * 2) <= words.length; start += 1) {
          const left = words.slice(start, start + width);
          const right = words.slice(start + width, start + (width * 2));
          if (!left.every((word, index) => word === right[index])) continue;
          words = [...words.slice(0, start + width), ...words.slice(start + (width * 2))];
          changed = true;
          found = true;
          break;
        }
      }
    }
    return changed ? words.join(' ') : value;
  };

  const original = normalise(title).replace(/\s+/g, ' ').trim();
  if (!original) return '';

  let cleaned = collapseExactRaw(original);
  for (let pass = 0; pass < 4; pass += 1) {
    const next = collapseExactRaw(stripPrefixes(stripSuffixes(cleaned)));
    if (next === cleaned) break;
    cleaned = next;
  }
  let query = cleaned
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b([A-Za-z]{2,})'s\b/g, '$1s')
    .toLowerCase()
    .replace(/[()[\]{}]/g, ' ')
    .replace(/[^a-z0-9.+\/-]+/g, ' ');

  const filteredTokens = query
    .split(/\s+/)
    .map((token) => token.replace(/^[.+\/-]+|[.\/-]+$/g, ''))
    .filter(Boolean);
  const tokens = capTokens(collapseBoundary(collapseRepeated(repairSuffixes(filteredTokens))));
  query = tokens.join(' ');

  const genericTokens = new Set(['assorted', 'auction', 'description', 'estate', 'info', 'information', 'item', 'lot', 'misc', 'miscellaneous', 'no', 'only', 'pickup', 'preview', 'reserve', 's', 'sale', 'see', 'stock', 'tba', 'unknown', 'various']);
  if (!tokens.some((token) => !genericTokens.has(token))) return '';
  return query;
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
  let patched = source.replace(currentBidNeedle, currentBidReplacement);
  const titleStart = patched.indexOf('function u(e){');
  const titleEnd = patched.indexOf('function d(e,t){', titleStart);
  if (titleStart < 0 || titleEnd < 0 || titleEnd <= titleStart) {
    throw new Error('Unable to locate the legacy HiBid title parser');
  }
  const titleParser = 'function u(e){let t=c(s(e,n.lotTitle)),r=t.replace(/^Lot\\s*#?\\s*:?\\s*\\S+\\s*[-:|]\\s*/i,``).trim(),i=(e.querySelector(`meta[property="og:title"]`)?.content??``).replace(/\\s*\\|\\s*Live and Online Auctions on HiBid\\.com\\s*$/i,``).trim(),a=``;try{let t=new URL(e.location?.href??globalThis.location?.href??`https://hibid.com`).pathname.match(/\\/lot\\/\\d+\\/([^/?#]+)/i)?.[1];a=t?decodeURIComponent(t).replace(/[-_]+/g,` `).replace(/\\s+/g,` `).trim():``}catch{}let o=e=>!!e&&!/^lot(?:\\s*#?\\s*:?\\s*[\\w.-]+)?$/i.test(e);return o(r)&&r!==t?r:o(i)?i:o(t)?t:o(a)?a:t||a||null}';
  patched = `${patched.slice(0, titleStart)}${titleParser}${patched.slice(titleEnd)}`;
  return patched;
}
