export type EbayEvidenceUrlInput = string | URL | null | undefined;

export type EbayEvidenceUrlKind =
  | 'sold-search-seed'
  | 'active'
  | 'listing-unknown-state'
  | 'rejected';

export type EbayEvidenceUrlRejectionReason =
  | 'empty-url'
  | 'invalid-url'
  | 'unsupported-protocol'
  | 'non-ebay-url'
  | 'unsupported-ebay-url';

export type IndependentEbaySoldEvidenceSource =
  | 'rendered-sold-listing'
  | 'seller-hub-sold-record'
  | 'transaction-record';

export interface IndependentEbaySoldEvidence {
  kind: 'independent-sold-evidence';
  source: IndependentEbaySoldEvidenceSource;
  itemId: string;
}

export interface ManualEstimateProvenance {
  kind: 'manual-estimate';
  amountUsd?: number;
}

export type EbayEvidenceProvenance = IndependentEbaySoldEvidence | ManualEstimateProvenance;

export type AcceptedEbayEvidenceUrlKind = Exclude<EbayEvidenceUrlKind, 'rejected'>;

export type AcceptedEbayEvidenceUrlClassification = {
  [Kind in AcceptedEbayEvidenceUrlKind]: {
      kind: Kind;
      normalizedUrl: string;
      rejectionReason: null;
    };
}[AcceptedEbayEvidenceUrlKind];

export type EbayEvidenceUrlClassification =
  | AcceptedEbayEvidenceUrlClassification
  | {
      kind: 'rejected';
      normalizedUrl: null;
      rejectionReason: EbayEvidenceUrlRejectionReason;
    };

export interface VerifiedEbaySoldCompAssessment {
  kind: 'verified-sold-comp';
  verifiedSoldComp: true;
  urlClassification: Extract<EbayEvidenceUrlClassification, { kind: 'listing-unknown-state' }>;
  provenance: IndependentEbaySoldEvidence;
}

export interface UnverifiedEbayEvidenceAssessment {
  kind: 'not-verified';
  verifiedSoldComp: false;
  urlClassification: EbayEvidenceUrlClassification;
  provenance: EbayEvidenceProvenance | null;
}

export type EbayEvidenceAssessment = VerifiedEbaySoldCompAssessment | UnverifiedEbayEvidenceAssessment;

const INDEPENDENT_SOLD_EVIDENCE_SOURCES: ReadonlySet<string> = new Set<IndependentEbaySoldEvidenceSource>([
  'rendered-sold-listing',
  'seller-hub-sold-record',
  'transaction-record',
]);

function rejected(rejectionReason: EbayEvidenceUrlRejectionReason): EbayEvidenceUrlClassification {
  return { kind: 'rejected', normalizedUrl: null, rejectionReason };
}

function isEbayDotComHost(hostname: string): boolean {
  const normalized = hostname.toLocaleLowerCase('en-US').replace(/\.$/, '');
  return normalized === 'ebay.com' || normalized.endsWith('.ebay.com');
}

function isPublicEbayConsumerHost(hostname: string): boolean {
  const normalized = hostname.toLocaleLowerCase('en-US').replace(/\.$/, '');
  return normalized === 'ebay.com' || normalized === 'www.ebay.com' || normalized === 'm.ebay.com';
}

function isSearchPath(pathname: string): boolean {
  const path = pathname.toLocaleLowerCase('en-US').replace(/\/+$/, '') || '/';
  return path === '/s' || path === '/sch' || path.startsWith('/sch/');
}

function searchFlagIsUnambiguouslyEnabled(url: URL, expectedName: string): boolean {
  const values = [...url.searchParams.entries()]
    .filter(([name]) => name.toLocaleLowerCase('en-US') === expectedName.toLocaleLowerCase('en-US'))
    .map(([, value]) => value.trim());
  return values.length > 0 && values.every((value) => value === '1');
}

function isActiveSellerHubPath(url: URL): boolean {
  const path = url.pathname.toLocaleLowerCase('en-US').replace(/\/+$/, '');
  if (path === '/sh/lst/active' || path.startsWith('/sh/lst/active/')) return true;
  if (path !== '/sh/lst') return false;
  return [...url.searchParams.entries()].some(([name, value]) => (
    name.toLocaleLowerCase('en-US') === 'status'
    && value.toLocaleLowerCase('en-US') === 'active'
  ));
}

function canonicalItemId(pathname: string): string | null {
  const match = pathname.match(/^\/itm\/(?:(?<slug>[^/]+)\/)?(?<id>\d{9,15})\/?$/i);
  if (!match?.groups?.id) return null;
  return !match.groups.slug || !/^\d+$/.test(match.groups.slug) ? match.groups.id : null;
}

export function extractEbayItemId(input: EbayEvidenceUrlInput): string | null {
  if (input === null || input === undefined || (typeof input === 'string' && input.trim() === '')) return null;
  try {
    const url = input instanceof URL ? input : new URL(input.trim());
    if (!isPublicEbayConsumerHost(url.hostname)) return null;
    return canonicalItemId(url.pathname);
  } catch {
    return null;
  }
}

function isIndependentSoldEvidence(
  provenance: EbayEvidenceProvenance | null | undefined,
  itemId: string,
): provenance is IndependentEbaySoldEvidence {
  return provenance?.kind === 'independent-sold-evidence'
    && INDEPENDENT_SOLD_EVIDENCE_SOURCES.has(provenance.source)
    && provenance.itemId === itemId;
}

export function classifyEbayEvidenceUrl(input: EbayEvidenceUrlInput): EbayEvidenceUrlClassification {
  if (input === null || input === undefined || (typeof input === 'string' && input.trim() === '')) {
    return rejected('empty-url');
  }

  let url: URL;
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(input.trim());
  } catch {
    return rejected('invalid-url');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') return rejected('unsupported-protocol');
  if (!isEbayDotComHost(url.hostname)) return rejected('non-ebay-url');
  if (!isPublicEbayConsumerHost(url.hostname)) return rejected('unsupported-ebay-url');

  if (canonicalItemId(url.pathname)) {
    return { kind: 'listing-unknown-state', normalizedUrl: url.href, rejectionReason: null };
  }

  if (isSearchPath(url.pathname)) {
    const isSoldCompleted = searchFlagIsUnambiguouslyEnabled(url, 'LH_Sold')
      && searchFlagIsUnambiguouslyEnabled(url, 'LH_Complete');
    return {
      kind: isSoldCompleted ? 'sold-search-seed' : 'active',
      normalizedUrl: url.href,
      rejectionReason: null,
    };
  }

  if (isActiveSellerHubPath(url)) {
    return { kind: 'active', normalizedUrl: url.href, rejectionReason: null };
  }

  return rejected('unsupported-ebay-url');
}

export function assessEbayEvidenceUrl(
  input: EbayEvidenceUrlInput,
  provenance: EbayEvidenceProvenance | null = null,
): EbayEvidenceAssessment {
  const urlClassification = classifyEbayEvidenceUrl(input);
  if (urlClassification.kind === 'listing-unknown-state') {
    const itemId = canonicalItemId(new URL(urlClassification.normalizedUrl).pathname);
    if (itemId && isIndependentSoldEvidence(provenance, itemId)) {
      return { kind: 'verified-sold-comp', verifiedSoldComp: true, urlClassification, provenance };
    }
  }
  return { kind: 'not-verified', verifiedSoldComp: false, urlClassification, provenance };
}

export function isVerifiedEbaySoldComp(
  assessment: EbayEvidenceAssessment,
): assessment is VerifiedEbaySoldCompAssessment {
  return assessment.verifiedSoldComp;
}
