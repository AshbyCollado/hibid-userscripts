import { HIBID_LOT_SEARCH_OPERATION, HIBID_LOT_SEARCH_QUERY, buildHibidGraphqlVariables } from './api.js';
import { resolveHiBidRoute, toUrl } from '../core/route.js';
import type {
  HiBidTransport,
  HibidBuyerPremiumVariantV1,
  HibidLotHandoffV1,
  HibidPhysicalPictureV1,
} from '../core/types.js';

export const HIBID_HANDOFF_MAX_PICTURES = 60;

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function physicalDimension(value: unknown): number | null {
  const result = finite(value);
  return result !== null && Number.isInteger(result) && result > 0 ? result : null;
}

function cents(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const normalized = typeof value === 'string' ? value.replace(/[^0-9.-]/g, '') : value;
  const result = Number(normalized);
  return Number.isFinite(result) ? Math.round(result * 100) : null;
}

function descriptionText(value: unknown): string {
  return text(value)
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function allowedPictureUrl(value: string): boolean {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && (/(^|\.)hibid\.com$/i.test(url.hostname) || /^media\.sandhills\.com$/i.test(url.hostname));
  } catch {
    return false;
  }
}

function forbiddenManifestKey(value: unknown, path = ''): string | null {
  if (!value || typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const next = path ? `${path}.${key}` : key;
    if (/^(?:cookies?|authorization|authorization_headers?|account_tokens?|bidder_identity|private_notes?|watch_notes|buyer_high_bid)$/i.test(key)) return next;
    const nested = forbiddenManifestKey(child, next);
    if (nested) return nested;
  }
  return null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function validNullableCents(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0);
}

function validNullablePositiveNumber(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isFinite(value) && value > 0);
}

function validNullablePositiveInteger(value: unknown): boolean {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value > 0);
}

function requireStringFields(value: Record<string, unknown>, keys: readonly string[], error: string): void {
  if (keys.some((key) => typeof value[key] !== 'string')) throw new Error(error);
}

function canonicalEventItemId(value: unknown): value is string {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return false;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 && String(numeric) === value;
}

export function validateHibidLotHandoffV1(value: unknown): asserts value is HibidLotHandoffV1 {
  const manifest = record(value);
  if (!manifest) throw new Error('Malformed HiBid lot handoff');
  if (manifest.schema_version !== 1 || manifest.provider !== 'hibid') throw new Error('Unsupported HiBid lot handoff schema');
  if (!validTimestamp(manifest.initiated_at)) throw new Error('HiBid handoff has an invalid initiation timestamp');

  const source = record(manifest.source);
  if (!source || !canonicalEventItemId(source.provider_event_item_id)) {
    throw new Error('HiBid handoff is missing its event-item ID');
  }
  requireStringFields(
    source,
    ['provider_item_id', 'provider_auction_id', 'lot_number', 'source_url'],
    'HiBid handoff has malformed source identity fields',
  );
  if (!validTimestamp(source.observed_at)) throw new Error('HiBid handoff has an invalid observation timestamp');
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(source.source_url as string);
  } catch {
    throw new Error('HiBid handoff source URL is not allowlisted');
  }
  if (sourceUrl.protocol !== 'https:' || !/(^|\.)hibid\.com$/i.test(sourceUrl.hostname)) throw new Error('HiBid handoff source URL is not allowlisted');
  let sourceEventItemId: string;
  try {
    sourceEventItemId = eventItemIdFromHibidLotUrl(sourceUrl);
  } catch {
    throw new Error('HiBid handoff source URL does not identify an exact lot');
  }
  if (sourceEventItemId !== source.provider_event_item_id) throw new Error('HiBid handoff source URL does not match its event-item ID');

  const rightsBasis = record(manifest.rights_basis);
  if (rightsBasis?.kind !== 'owner-authorized-private-use' || !validTimestamp(rightsBasis.attested_at)) {
    throw new Error('HiBid handoff is missing its timestamped private-use attestation');
  }

  const lot = record(manifest.lot);
  if (!lot) throw new Error('HiBid handoff has malformed lot economics');
  requireStringFields(
    lot,
    ['title', 'description', 'category', 'currency', 'status', 'location', 'buyer_premium_raw', 'auction_terms', 'checkout_terms', 'preview_terms'],
    'HiBid handoff has malformed lot economics',
  );
  if (!validNullableCents(lot.current_bid_cents) || !validNullableCents(lot.next_bid_cents)) {
    throw new Error('HiBid handoff has malformed cent-denominated bid values');
  }
  if (!validNullablePositiveInteger(lot.bid_count) && lot.bid_count !== 0) throw new Error('HiBid handoff has a malformed bid count');
  if (!validNullablePositiveNumber(lot.quantity)) throw new Error('HiBid handoff has a malformed lot quantity');
  if (typeof lot.shipping_offered !== 'boolean') throw new Error('HiBid handoff has malformed shipping terms');
  if (!Array.isArray(lot.buyer_premium_variants) || lot.buyer_premium_variants.length > 32) {
    throw new Error('HiBid handoff has malformed buyer-premium variants');
  }
  const paymentMethods = new Set(['cash', 'check', 'card', 'credit', 'unknown']);
  lot.buyer_premium_variants.forEach((candidate) => {
    const variant = record(candidate);
    if (
      !variant
      || typeof variant.label !== 'string'
      || !Number.isInteger(variant.rate_basis_points)
      || (variant.rate_basis_points as number) < 0
      || (variant.rate_basis_points as number) > 4_000
      || typeof variant.payment_method !== 'string'
      || !paymentMethods.has(variant.payment_method)
    ) throw new Error('HiBid handoff has a malformed buyer-premium variant');
  });

  if (!Array.isArray(manifest.pictures) || manifest.pictures.length < 1 || manifest.pictures.length > HIBID_HANDOFF_MAX_PICTURES) throw new Error('HiBid handoff has an invalid physical picture count');
  if (!Number.isInteger(manifest.expected_picture_count) || manifest.expected_picture_count !== manifest.pictures.length) throw new Error('HiBid handoff pictureCount does not reconcile');
  const fidelity = record(manifest.fidelity);
  if (!fidelity) throw new Error('HiBid handoff fidelity is malformed');
  if (fidelity.enumeration_source !== 'hibid-graphql-exact-item') throw new Error('HiBid handoff has an unsupported picture enumeration source');
  if (fidelity.reconciled !== true || !Array.isArray(fidelity.errors) || fidelity.errors.some((error) => typeof error !== 'string') || fidelity.errors.length > 0) {
    throw new Error('HiBid handoff fidelity is not reconciled');
  }
  for (const key of ['expected_picture_count', 'observed_picture_count', 'descriptor_count'] as const) {
    if (fidelity[key] !== manifest.pictures.length) throw new Error(`HiBid handoff ${key} does not reconcile`);
  }
  if (!Number.isInteger(fidelity.duplicate_url_count) || (fidelity.duplicate_url_count as number) < 0 || (fidelity.duplicate_url_count as number) >= manifest.pictures.length) {
    throw new Error('HiBid handoff has a malformed duplicate-image count');
  }
  const keys = new Set<string>();
  manifest.pictures.forEach((candidate, index) => {
    const picture = record(candidate);
    if (!picture) throw new Error(`HiBid picture ${index + 1} descriptor is malformed`);
    if (picture.seller_ordinal !== index + 1) throw new Error('HiBid handoff seller ordinals are not contiguous');
    requireStringFields(picture, ['source_picture_key', 'description', 'full_size_url'], `HiBid picture ${index + 1} descriptor is malformed`);
    if (!picture.source_picture_key || keys.has(picture.source_picture_key as string)) throw new Error('HiBid handoff picture keys are not unique');
    keys.add(picture.source_picture_key as string);
    if (!validNullablePositiveInteger(picture.width) || !validNullablePositiveInteger(picture.height)) throw new Error(`HiBid picture ${picture.seller_ordinal} has malformed dimensions`);
    if (picture.hd_thumbnail_url !== null && typeof picture.hd_thumbnail_url !== 'string') throw new Error(`HiBid picture ${picture.seller_ordinal} descriptor is malformed`);
    if (picture.thumbnail_url !== null && typeof picture.thumbnail_url !== 'string') throw new Error(`HiBid picture ${picture.seller_ordinal} descriptor is malformed`);
    if (!picture.full_size_url || !allowedPictureUrl(picture.full_size_url as string)) throw new Error(`HiBid picture ${picture.seller_ordinal} has no allowlisted full-size image URL`);
    const pictureFidelity = record(picture.fidelity);
    if (!pictureFidelity) throw new Error(`HiBid picture ${picture.seller_ordinal} fidelity is malformed`);
    const urls = [picture.full_size_url, picture.hd_thumbnail_url, picture.thumbnail_url].filter((item): item is string => typeof item === 'string' && item.length > 0);
    const usableUrlCount = new Set(urls.filter(allowedPictureUrl)).size;
    if (
      pictureFidelity.has_full_size_url !== true
      || pictureFidelity.has_dimensions !== (picture.width !== null && picture.height !== null)
      || pictureFidelity.https_only !== urls.every((url) => {
        try { return new URL(url).protocol === 'https:'; } catch { return false; }
      })
      || pictureFidelity.allowed_hosts !== urls.every(allowedPictureUrl)
      || pictureFidelity.usable_url_count !== usableUrlCount
      || usableUrlCount < 1
    ) throw new Error(`HiBid picture ${picture.seller_ordinal} fidelity is malformed`);
    for (const url of urls) {
      if (!allowedPictureUrl(url)) throw new Error(`HiBid picture ${picture.seller_ordinal} contains a non-allowlisted image URL`);
    }
  });
  const forbidden = forbiddenManifestKey(manifest);
  if (forbidden) throw new Error(`HiBid handoff contains forbidden private field ${forbidden}`);
}

function pictureUrls(raw: Record<string, unknown>): string[] {
  return [raw.fullSizeLocation, raw.hdThumbnailLocation, raw.thumbnailLocation]
    .map(text)
    .filter(Boolean);
}

function stablePictureKey(raw: Record<string, unknown>, eventItemId: string, fullSizeUrl: string): string {
  const providerId = text(raw.id ?? raw.pictureId ?? raw.pictureID);
  if (providerId) return `${eventItemId}:picture:${providerId}`;
  if (!fullSizeUrl) return `${eventItemId}:missing-full-size`;
  // HiBid's GraphQL picture shape does not consistently expose an ID. The
  // allowlisted full-size CDN path is stable across seller reordering, unlike
  // the display ordinal. Ignore transient query parameters and compact only
  // exceptionally long paths with two independent 64-bit FNV-1a passes.
  let url: URL;
  try { url = new URL(fullSizeUrl); } catch { return `${eventItemId}:invalid-full-size`; }
  const identity = `${url.origin}${url.pathname}`;
  if (identity.length <= 240) return `${eventItemId}:url:${identity}`;
  const fnv = (seed: bigint) => {
    let value = seed;
    for (const character of identity) {
      value ^= BigInt(character.codePointAt(0) ?? 0);
      value = BigInt.asUintN(64, value * 0x100000001b3n);
    }
    return value.toString(16).padStart(16, '0');
  };
  return `${eventItemId}:url-hash:${fnv(0xcbf29ce484222325n)}${fnv(0x84222325cbf29cen)}`;
}

function samePicture(left: unknown, right: unknown): boolean {
  if (!left || typeof left !== 'object' || !right || typeof right !== 'object') return false;
  const leftUrls = pictureUrls(left as Record<string, unknown>);
  const rightUrls = new Set(pictureUrls(right as Record<string, unknown>));
  return leftUrls.some((url) => rightUrls.has(url));
}

function physicalRawPictures(lot: Record<string, unknown>, expected: number): Record<string, unknown>[] {
  const listed = Array.isArray(lot.pictures)
    ? lot.pictures.filter((picture): picture is Record<string, unknown> => Boolean(picture && typeof picture === 'object'))
    : [];
  const featured = lot.featuredPicture && typeof lot.featuredPicture === 'object'
    ? lot.featuredPicture as Record<string, unknown>
    : null;

  // HiBid deployments differ: some return the featured picture in pictures,
  // while others expose it only through featuredPicture. pictureCount decides
  // which exact GraphQL representation is the physical seller-photo list.
  if (listed.length === expected) return listed;
  if (featured && listed.length + 1 === expected) {
    // A repeated featured descriptor is not the missing physical picture. Keep
    // the short list so reconciliation fails instead of inventing a photo.
    if (listed.some((picture) => samePicture(featured, picture))) return listed;
    return [featured, ...listed];
  }
  if (expected === 1 && featured && listed.length === 0) return [featured];
  return listed;
}

function pictureDescriptor(raw: Record<string, unknown>, ordinal: number, eventItemId: string): HibidPhysicalPictureV1 {
  const full = text(raw.fullSizeLocation);
  const hd = text(raw.hdThumbnailLocation);
  const thumbnail = text(raw.thumbnailLocation);
  const urls = [full, hd, thumbnail].filter(Boolean);
  const width = physicalDimension(raw.width);
  const height = physicalDimension(raw.height);
  return {
    seller_ordinal: ordinal,
    source_picture_key: stablePictureKey(raw, eventItemId, full),
    description: text(raw.description),
    width,
    height,
    full_size_url: full,
    hd_thumbnail_url: hd || null,
    thumbnail_url: thumbnail || null,
    fidelity: {
      has_full_size_url: Boolean(full),
      has_dimensions: width !== null && height !== null,
      https_only: urls.length > 0 && urls.every((url) => {
        try { return new URL(url).protocol === 'https:'; } catch { return false; }
      }),
      allowed_hosts: urls.length > 0 && urls.every(allowedPictureUrl),
      usable_url_count: new Set(urls.filter(allowedPictureUrl)).size,
    },
  };
}

function premiumVariants(raw: unknown, rate: unknown): HibidBuyerPremiumVariantV1[] {
  const source = [text(raw), text(rate)].filter(Boolean).join(' | ');
  const variants: HibidBuyerPremiumVariantV1[] = [];
  for (const match of source.matchAll(/(?:^|\D)(\d{1,2}(?:\.\d{1,2})?)\s*%/g)) {
    const percent = Number(match[1]);
    if (!Number.isFinite(percent) || percent < 0 || percent > 40) continue;
    const matchIndex = match.index || 0;
    const start = Math.max(0, matchIndex - 20);
    const end = Math.min(source.length, matchIndex + match[0].length + 30);
    const label = source.slice(start, end).trim();
    const methodText = source.slice(matchIndex + match[0].length, end) || label;
    const payment_method = /cash/i.test(methodText)
      ? 'cash'
      : /check|cheque/i.test(methodText)
        ? 'check'
        : /credit/i.test(methodText)
          ? 'credit'
          : /card/i.test(methodText)
            ? 'card'
            : 'unknown';
    const variant = { label: label || `${percent}%`, rate_basis_points: Math.round(percent * 100), payment_method } satisfies HibidBuyerPremiumVariantV1;
    if (!variants.some((item) => item.rate_basis_points === variant.rate_basis_points && item.payment_method === variant.payment_method)) variants.push(variant);
  }
  const numericRate = finite(rate);
  if (numericRate !== null && numericRate >= 0 && numericRate <= 40) {
    const normalizedPercent = numericRate > 0 && numericRate <= 1 ? numericRate * 100 : numericRate;
    const basisPoints = Math.round(normalizedPercent * 100);
    if (!variants.some((item) => item.rate_basis_points === basisPoints)) {
      variants.push({ label: `${normalizedPercent}%`, rate_basis_points: basisPoints, payment_method: 'unknown' });
    }
  }
  return variants.sort((left, right) => left.rate_basis_points - right.rate_basis_points || left.payment_method.localeCompare(right.payment_method));
}

export function eventItemIdFromHibidLotUrl(locationLike: URL | string): string {
  const url = toUrl(locationLike);
  const parts = url.pathname.split('/').filter(Boolean);
  const lotIndex = parts.findIndex((part) => part.toLowerCase() === 'lot');
  const id = lotIndex >= 0 ? text(parts[lotIndex + 1]) : '';
  if (!canonicalEventItemId(id)) throw new Error('This HiBid lot URL does not contain a canonical event-item ID');
  return id;
}

export function isHibidChallengeDocument(document: Document): boolean {
  const title = text(document.title);
  const body = text(document.body?.textContent).slice(0, 10_000);
  return /(?:just a moment|attention required|access denied|verify (?:that )?you are human)/i.test(title)
    || /(?:cf-chl-|captcha|verify (?:that )?you are human)/i.test(body);
}

export function buildHibidLotHandoffV1(
  raw: unknown,
  sourceUrl: string,
  observedAt = new Date().toISOString(),
  initiatedAt = observedAt,
): HibidLotHandoffV1 {
  if (!raw || typeof raw !== 'object') throw new Error('HiBid exact-item hydration returned a malformed lot');
  const lot = raw as Record<string, any>;
  const state = lot.lotState && typeof lot.lotState === 'object' ? lot.lotState as Record<string, unknown> : {};
  const auction = lot.auction && typeof lot.auction === 'object' ? lot.auction as Record<string, unknown> : {};
  const eventItemId = text(lot.eventItemId ?? lot.id);
  if (!canonicalEventItemId(eventItemId)) throw new Error('HiBid exact-item hydration did not return a canonical event-item ID');
  const requestedId = eventItemIdFromHibidLotUrl(sourceUrl);
  if (requestedId !== eventItemId) throw new Error(`HiBid returned event-item ${eventItemId} for requested lot ${requestedId}`);

  const expected = finite(lot.pictureCount);
  if (!Number.isInteger(expected) || expected === null || expected < 1) throw new Error('HiBid did not report a valid physical pictureCount');
  if (expected > HIBID_HANDOFF_MAX_PICTURES) throw new Error(`HiBid lot has ${expected} photos; Flippah accepts at most ${HIBID_HANDOFF_MAX_PICTURES}`);
  const rawPictures = physicalRawPictures(lot, expected);
  const descriptors = rawPictures.map((picture, index) => pictureDescriptor(picture, index + 1, eventItemId));
  const keyTotals = new Map<string, number>();
  descriptors.forEach((picture) => keyTotals.set(picture.source_picture_key, (keyTotals.get(picture.source_picture_key) ?? 0) + 1));
  const keyOccurrences = new Map<string, number>();
  const pictures = descriptors.map((picture) => {
    if ((keyTotals.get(picture.source_picture_key) ?? 0) === 1) return picture;
    const occurrence = (keyOccurrences.get(picture.source_picture_key) ?? 0) + 1;
    keyOccurrences.set(picture.source_picture_key, occurrence);
    return { ...picture, source_picture_key: `${picture.source_picture_key}:occurrence:${occurrence}` };
  });
  const errors: string[] = [];
  if (pictures.length !== expected) errors.push(`pictureCount=${expected}, GraphQL physical descriptors=${pictures.length}`);
  pictures.forEach((picture) => {
    if (!picture.fidelity.has_full_size_url || !allowedPictureUrl(picture.full_size_url)) errors.push(`picture ${picture.seller_ordinal} has no allowlisted HTTPS full-size HiBid image URL`);
  });
  if (errors.length) throw new Error(`HiBid physical-picture reconciliation failed: ${errors.join('; ')}`);

  const primaryUrls = pictures.map((picture) => picture.full_size_url || picture.hd_thumbnail_url || picture.thumbnail_url);
  const duplicateUrlCount = primaryUrls.length - new Set(primaryUrls).size;
  const highBid = cents(state.highBid);
  const realized = cents(state.priceRealized);
  const currentBidCents = realized !== null && realized > 0 ? realized : highBid;
  const location = [auction.eventAddress, auction.eventCity, auction.eventState, auction.eventZip].map(text).filter(Boolean).join(', ');
  const buyerPremiumRaw = text(auction.buyerPremium ?? auction.buyerPremiumRate);

  const manifest: HibidLotHandoffV1 = {
    schema_version: 1,
    provider: 'hibid',
    initiated_at: initiatedAt,
    source: {
      provider_event_item_id: eventItemId,
      provider_item_id: text(lot.itemId),
      provider_auction_id: text(auction.id),
      lot_number: text(lot.lotNumber ?? lot.saleOrder ?? eventItemId),
      source_url: new URL(sourceUrl).href,
      observed_at: observedAt,
    },
    lot: {
      title: text(lot.lead ?? lot.title) || `Lot ${text(lot.lotNumber ?? eventItemId)}`,
      description: descriptionText(lot.description),
      category: text(Array.isArray(lot.category) ? lot.category[0]?.fullCategory ?? lot.category[0]?.categoryName : lot.category?.fullCategory ?? lot.category?.categoryName),
      currency: text(auction.currencyAbbreviation) || 'USD',
      current_bid_cents: currentBidCents,
      next_bid_cents: cents(state.minBid ?? state.nextBid),
      bid_count: finite(state.bidCount),
      status: text(state.status ?? state.productStatus),
      quantity: finite(lot.quantity),
      shipping_offered: Boolean(lot.shippingOffered),
      location,
      buyer_premium_raw: buyerPremiumRaw,
      buyer_premium_variants: premiumVariants(auction.buyerPremium, auction.buyerPremiumRate),
      auction_terms: descriptionText(auction.description),
      checkout_terms: descriptionText(auction.checkoutDateInfo),
      preview_terms: descriptionText(auction.previewDateInfo),
    },
    expected_picture_count: expected,
    pictures,
    fidelity: {
      enumeration_source: 'hibid-graphql-exact-item',
      expected_picture_count: expected,
      observed_picture_count: rawPictures.length,
      descriptor_count: pictures.length,
      reconciled: true,
      duplicate_url_count: duplicateUrlCount,
      errors: [],
    },
    rights_basis: { kind: 'owner-authorized-private-use', attested_at: observedAt },
  };
  validateHibidLotHandoffV1(manifest);
  return manifest;
}

export async function hydrateHibidLotHandoff(
  transport: HiBidTransport,
  sourceUrl: string,
  options: { signal?: AbortSignal; observedAt?: string; initiatedAt?: string; retries?: number } = {},
): Promise<HibidLotHandoffV1> {
  const route = resolveHiBidRoute(sourceUrl);
  if (!route.supported || route.kind !== 'lot') throw new Error('Flippah auction handoff is available only on an individual HiBid lot');
  const id = eventItemIdFromHibidLotUrl(sourceUrl);
  const variables = buildHibidGraphqlVariables(route, sourceUrl, 1, { pageSize: 1, eventItemIds: [id] });
  const attempts = Math.max(1, Math.min(3, options.retries ?? 3));
  let lastError: unknown = new Error('HiBid exact-item hydration failed');
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (options.signal?.aborted) throw new Error('HiBid lot handoff cancelled');
    try {
      const json = await transport.hydrateLots({ operationName: HIBID_LOT_SEARCH_OPERATION, variables, query: HIBID_LOT_SEARCH_QUERY }, { signal: options.signal });
      const results = (json as any)?.data?.lotSearch?.pagedResults?.results;
      if (!Array.isArray(results) || results.length !== 1) throw new Error(`HiBid exact-item hydration returned ${Array.isArray(results) ? results.length : 0} records for one requested lot`);
      return buildHibidLotHandoffV1(
        results[0],
        sourceUrl,
        options.observedAt,
        options.initiatedAt,
      );
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!/physical-picture reconciliation|returned 0 records|network|fetch|http 5\d\d/i.test(message)) throw error;
    }
  }
  throw lastError;
}
