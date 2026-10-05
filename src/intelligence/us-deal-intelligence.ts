export type StringMap = Record<string, string>;

export interface StructuredDescription {
  fields: StringMap;
  freeText: string;
  free: string;
}

export interface ConditionAssessment {
  partsOnly: boolean;
  partsReasons: string[];
  damaged: boolean;
  damageReasons: string[];
  cautions: string[];
  positive: boolean;
  condition: string;
  fields: StringMap;
  freeText: string;
}

export interface ConditionPresentation {
  label: string;
  tone: 'good' | 'warning' | 'danger' | 'unknown';
  title: string;
}

export interface ProductIdentity {
  name: string;
  query: string;
  brand: string;
  model: string | null;
  model2: string | null;
  kind: ProductKind | null;
  capacities: string[];
  discriminators: ProductDiscriminators;
  tokens: string[];
  /** Explicitly included components found in a structured description. */
  includedComponents?: string[][];
  /** Seller explicitly says that only a partial bundle/inclusion is present. */
  explicitlyPartialBundle?: boolean;
  statedRetail?: number;
}

export interface ProductDiscriminators {
  capacities: string[];
  cubicCapacities: string[];
  weightLimits: string[];
  resolutions: string[];
  dimensions: string[];
  platformVariants: string[];
  memoryTypes: string[];
  frequencies: string[];
  refreshRates: string[];
  storageTypes: string[];
  networkStandards: string[];
  voltages: string[];
  wattages: string[];
  batteryCapacities: string[];
  lensRanges: string[];
  gpuModels: string[];
  cpuModels: string[];
  editions: string[];
  seriesSignatures: string[];
  packageCounts: string[];
  colors: string[];
  materials: string[];
  productFamilies: string[];
  variantLabels: string[];
  volumes: string[];
  modeCounts: string[];
  featureCounts: string[];
  /** Canonical sizes; an empty array means explicit size uncertainty. */
  ringSizes?: string[];
  engineDisplacements?: string[];
  horsepower?: string[];
  motorFrames?: string[];
  impactRates?: string[];
}

export type ProductKind =
  | 'projector' | 'monitor' | 'television' | 'receiver' | 'headphones'
  | 'microphone' | 'laptop' | 'desktop' | 'stylus' | 'tablet' | 'phone' | 'speaker'
  | 'camera' | 'printer' | 'keyboard' | 'mouse' | 'router' | 'vacuum' | 'car-stereo'
  | 'game-console' | 'storage' | 'graphics-card' | 'memory' | 'processor' | 'smartwatch'
  | 'power-tool';

export interface RetailCandidateEvaluation {
  accepted: boolean;
  score: number;
  rejectionReasons: string[];
  matchedEvidence: string[];
}

export interface LotAnalysisRecord {
  title?: string | null;
  lead?: string | null;
  description?: string | null;
  condition?: string | null;
  currentBid?: number | null;
  nextBid?: number | null;
  shipping?: number | null;
  buyerPremiumPct?: number | null;
  salesTaxPct?: number | null;
  statedRetail?: number | null;
  estimate?: string | null;
}

export interface StatedRetailEvidence {
  value: number;
  source: string;
}

export interface MixedLotResult {
  mixed: boolean;
  reasons: string[];
  components: string[];
}

export interface UsAllInInput {
  hammer: number;
  buyerPremiumPct: number;
  salesTaxPct: number;
  taxOnPremium?: boolean;
}

export interface UsAllInResult {
  currency: 'USD';
  hammer: number;
  premium: number;
  taxableSubtotal: number;
  tax: number;
  total: number;
}

export interface AmazonCandidate {
  asin: string;
  title: string;
  /** Search-result URL slug, used only when Amazon truncates identity from the visible title. */
  matchText?: string;
  price: number | null;
  used: boolean;
  sponsored: boolean;
  url: string;
  detailEnriched?: boolean;
}

export interface AmazonCandidateMatch {
  candidate: AmazonCandidate;
  score: number;
}

export type AmazonMatch = AmazonCandidateMatch;

export function trustedAmazonMarketValue(status: string, match: AmazonCandidateMatch | null | undefined, quantity = 1): number | null {
  if (status !== 'matched' || match?.candidate.price == null || !Number.isFinite(match.candidate.price) || match.candidate.price <= 0) return null;
  return match.candidate.price * Math.max(1, Number.isFinite(quantity) ? quantity : 1);
}

export function requiresQuantityConfirmation(quantity: number | LotQuantityAssessment | null | undefined, mixed: boolean, confirmedQuantity: number | null | undefined): boolean {
  const assessment = typeof quantity === 'object' && quantity !== null
    ? quantity
    : { state: typeof quantity === 'number' && Number.isFinite(quantity) ? 'known' as const : 'absent' as const, quantity: typeof quantity === 'number' && Number.isFinite(quantity) ? quantity : null };
  return Boolean((assessment.state === 'conflict' || (assessment.state === 'known' && (assessment.quantity ?? 0) > 1) || mixed)
    && !(typeof confirmedQuantity === 'number' && Number.isFinite(confirmedQuantity) && confirmedQuantity >= 1));
}

export function extractLotQuantityFromTitle(title: string | null | undefined): number | null {
  const source = normalise(title).trim();
  if (/\bpair\s+of\b/i.test(source)) return 2;
  if (/\btwin[\s-]+(?:pack|set)\b/i.test(source)) return 2;
  const wordValues: Record<string, number> = {
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
  };
  const wordMatch = source.match(/\b(?:lot|group|set|pack|qty|quantity)\s+(?:of\s+)?(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i)
    || source.match(/\b(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[\s-]+(?:pack|pk|units?|items?|pieces?|pcs|count|ct)\b/i)
    || source.match(/^\s*(two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+.+\b[a-z]{3,}s\b/i);
  if (wordMatch) return wordValues[wordMatch[1]!.toLocaleLowerCase('en-US')] ?? null;
  const match = source.match(/\b(?:lot|group|set)\s+of\s+(\d{1,4})\b/i)
    || source.match(/^\s*\(?\s*(\d{1,4})\s*\)?\s*[x×]\s+/i)
    || source.match(/\b(?:qty|quantity)\s*[:#-]?\s*(\d{1,4})\b/i)
    || source.match(/\b(\d{1,4})\s+(?:units?|items?|pieces?|pcs)\b/i)
    || source.match(/\b(\d{1,4})[\s-]*(?:pack|pk)\b/i);
  const quantity = match ? Number(match[1]) : 0;
  return Number.isInteger(quantity) && quantity > 1 ? quantity : null;
}

export type LotQuantityState = 'absent' | 'known' | 'conflict';

export interface LotQuantityAssessment {
  state: LotQuantityState;
  quantity: number | null;
}

const DESCRIPTION_QUANTITY_WORDS: Readonly<Record<string, number>> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
  seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
};
const DESCRIPTION_QUANTITY_NUMBER = '(?:\\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)';
const DESCRIPTION_QUANTITY_NOUN = '(?:units?|items?|pieces?|identical\\s+units?|phones?|tablets?|laptops?|monitors?|cameras?|speakers?|headphones?|controllers?)';

function quantityNounCompatible(noun: string, title: string | null | undefined): boolean {
  const primaryTitle = String(title || '').split(/\b(?:with|includes?|including)\b|\bw\s*\//i, 1)[0] || '';
  const titleKind = detectProductKind(primaryTitle)
    || (/\b(?:playstation\s*[345]|ps[345]|xbox(?:\s+(?:one|series\s+[xs]))?|nintendo\s+switch)\b/i.test(primaryTitle) ? 'game-console' : null)
    || (/\bsamsung\s+galaxy\s+s4\b/i.test(primaryTitle) ? 'phone' : null);
  const nounKinds: Readonly<Record<string, ProductKind>> = {
    phone: 'phone', tablet: 'tablet', laptop: 'laptop', monitor: 'monitor', camera: 'camera',
    speaker: 'speaker', headphone: 'headphones', controller: 'game-console',
  };
  const normalizedNoun = noun.toLocaleLowerCase('en-US').replace(/s$/, '');
  const nounKind = nounKinds[normalizedNoun];
  if (nounKind && titleKind && nounKind !== titleKind) return false;
  if (normalizedNoun === 'controller' && titleKind === 'game-console') {
    return /\bcontrollers?\b/i.test(primaryTitle) && !/\bconsoles?\b/i.test(primaryTitle);
  }
  return true;
}

function nonLotQuantityTail(tail: string): boolean {
  return /^\s+(?:(?:are|is|were|was)\s+)?(?:can|could|may|might|will|would|deliver|provide|offer|connect|be\s+connected|not\b|excluded\b|sold\s+separately|built[\s-]+in)\b/i.test(tail);
}

function hasAmbiguousQuantityPhrase(value: string | null | undefined, title: string | null | undefined): boolean {
  const source = normalise(value).replace(/\s+/g, ' ').trim();
  const pattern = new RegExp(`\\b${DESCRIPTION_QUANTITY_NUMBER}\\s*(?:/|\\bor\\b)\\s*${DESCRIPTION_QUANTITY_NUMBER}\\s+(${DESCRIPTION_QUANTITY_NOUN})\\b`, 'gi');
  return [...source.matchAll(pattern)].some(match => {
    const tail = source.slice((match.index ?? 0) + match[0].length).split(/[.!?;]/, 1)[0] || '';
    return quantityNounCompatible(match[1]!, title) && !nonLotQuantityTail(tail);
  });
}

function descriptionQuantityCandidates(description: string | null | undefined, title: string | null | undefined): number[] | null {
  const source = normalise(description).replace(/\s+/g, ' ').trim();
  if (!source) return [];
  const candidates: number[] = [];
  const parse = (value: string): number | null => {
    const quantity = /^\d+$/.test(value) ? Number(value) : DESCRIPTION_QUANTITY_WORDS[value.toLocaleLowerCase('en-US')] ?? null;
    return quantity !== null && Number.isSafeInteger(quantity) && quantity >= 1 ? quantity : null;
  };
  const add = (pattern: RegExp) => {
    for (const match of source.matchAll(pattern)) {
      const quantity = parse(match[1]!);
      if (quantity === null) continue;
      if (!quantityNounCompatible(match[2] || '', title)) continue;
      const tail = source.slice((match.index ?? 0) + match[0].length).split(/[.!?;]/, 1)[0] || '';
      // Product capability, future/advertising, and exclusion clauses are not lot counts.
      if (nonLotQuantityTail(tail)) continue;
      candidates.push(quantity);
    }
  };
  if (hasAmbiguousQuantityPhrase(source, title)) return null;
  add(new RegExp(`(?:^|[.!?;]\\s*|\\b(?:there\\s+are|we\\s+have|this\\s+lot\\s+(?:has|contains|includes)|lot\\s+(?:has|contains|includes)|contains|consists\\s+of|total(?:\\s+quantity)?\\s+is|quantity\\s*(?:is|:)|qty\\s*(?:is|:))\\s+)(${DESCRIPTION_QUANTITY_NUMBER})\\s+(${DESCRIPTION_QUANTITY_NOUN})\\b`, 'gi'));
  add(new RegExp(`\\b(${DESCRIPTION_QUANTITY_NUMBER})\\s+(identical\\s+units?)\\b`, 'gi'));
  return candidates;
}

export function assessLotQuantity(input: {
  title?: string | null;
  description?: string | null;
  structuredQuantity?: number | null;
  structuredQuantities?: Array<number | null | undefined>;
}): LotQuantityAssessment {
  if (hasAmbiguousQuantityPhrase(input.title, input.title)) return { state: 'conflict', quantity: null };
  const titleQuantity = extractLotQuantityFromTitle(input.title);
  const descriptionValues = descriptionQuantityCandidates(input.description, input.title);
  if (descriptionValues === null) return { state: 'conflict', quantity: null };
  const descriptionValuesUnique = [...new Set(descriptionValues)];
  const descriptionState: LotQuantityAssessment = descriptionValuesUnique.length > 1
    ? { state: 'conflict', quantity: null }
    : descriptionValuesUnique.length === 1
      ? { state: 'known', quantity: descriptionValuesUnique[0]! }
      : { state: 'absent', quantity: null };
  const structuredQuantities = [input.structuredQuantity, ...(input.structuredQuantities || [])]
    .filter((value): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 1);
  const values = [titleQuantity, descriptionState.quantity, ...structuredQuantities].filter((value): value is number => value !== null);
  if (descriptionState.state === 'conflict' || new Set(values).size > 1) return { state: 'conflict', quantity: null };
  if (!values.length) return { state: 'absent', quantity: null };
  return { state: 'known', quantity: values[0]! };
}

/**
 * Extends the title-only quantity signal with narrowly scoped seller prose.
 * Description counts are accepted only when they name complete lot units/items;
 * feature, accessory, advertising, and measurement counts are intentionally ignored.
 */
export function extractLotQuantityFromTitleAndDescription(
  title: string | null | undefined,
  description: string | null | undefined,
): number | null {
  const assessment = assessLotQuantity({ title, description });
  return assessment.state === 'known' ? assessment.quantity : null;
}

export function detectComparisonCurrency(rawText: string | null | undefined, buyerPremium: string | null | undefined): 'USD' | 'CAD' {
  const evidence = `${rawText || ''} ${buyerPremium || ''}`;
  return /\b(?:CAD|CDN)\b/i.test(evidence) || /(?:\$\s*)?\d[\d,.]*\s+Can\b/.test(evidence) ? 'CAD' : 'USD';
}

export interface RetailLinks {
  amazon: string;
  ebay: string;
  amazonUrl: string;
  ebayUrl: string;
}

export type IndicatorTone = 'great' | 'good' | 'marginal' | 'poor' | 'unknown';

export interface RetailIndicator {
  provider: 'amazon' | 'ebay';
  ratio: number | null;
  discountPct: number | null;
  tone: IndicatorTone;
  cls: 'green' | 'yellow' | 'orange' | 'red' | 'na';
  label: string;
}

export interface RetailSearchPresentation {
  provider: 'amazon' | 'ebay';
  label: string;
  href: string;
  title: string;
  ariaLabel: string;
}

export type AccountVerdictKind =
  | 'parts_only'
  | 'manual'
  | 'raise'
  | 'hold'
  | 'let_go'
  | 'at_ceiling'
  | 'under_ceiling'
  | 'winning_above_retail';

export interface AccountVerdictInput {
  status?: string | null;
  partsOnly?: boolean;
  condition?: Pick<ConditionAssessment, 'partsOnly' | 'cautions'> | null;
  nextHammer?: number | null;
  allIn?: number | null;
  maxBid?: number | null;
  retail?: number | null;
  costsProvisional?: boolean;
}

export interface AccountVerdict {
  kind: AccountVerdictKind;
  cls: 'black' | 'na' | 'green' | 'red' | 'orange';
  label: string;
  advice: string;
}

const FIELD_LINE_RE = /^[ \t]*([^:?\n]{2,60}?)[ \t]*([:?])[ \t]*(.*)$/;
const STRUCTURED_FIELD_LABELS = [
  'Estimated Retail Price', 'Est. Retail Price', 'Shelf Location', 'Assembly Required',
  'Missing Parts Description', 'Missing Parts Desc', 'Missing Major Parts', 'Missing Any Parts',
  'Damage Description', 'Damage Details', 'Damage Desct', 'Damage Desc',
  'Is Item Functional', 'Item Functional', 'Is Item Damaged', 'Item Damaged',
  'In Packaging', 'Missing Parts', 'Functional', 'Condition', 'Damaged',
  'Quantity', 'Product Name', 'Product', 'Title', 'Lead', 'Manufacturer', 'Brand',
  'Model Name', 'Model Number', 'Model No.', 'Model #', 'Model', 'MPN', 'UPC', 'VIN #', 'Year', 'Make', 'Notes', 'Note',
] as const;
const STRUCTURED_FIELD_MARKER_SOURCE = STRUCTURED_FIELD_LABELS
  .slice()
  .sort((left, right) => right.length - left.length)
  .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
const KNOWN_STRUCTURED_FIELD_KEYS = new Set(STRUCTURED_FIELD_LABELS.map((label) => label.toLowerCase().replace(/\s+/g, ' ')));
const NOISE_WORDS = new Set([
  'retail', 'new', 'brand', 'the', 'best', 'with', 'and', 'for', 'built', 'in', 'a',
  'of', 'to', 'up', 'included', 'includes', 'free', 'shipping', 'lot', 'item', 'items',
  'qty', 'x', 'pack', 'set', 'estimated', 'est', 'price', 'msrp', 'value', 'approx',
  'approximately', 'assorted', 'various',
]);
const MODEL_RE = /^[A-Za-z]{1,8}-?\d{1,8}[A-Za-z0-9+.-]*$/;
const MODEL_ALT_RE = /^[A-Za-z]{1,8}-[A-Za-z0-9+.]{2,14}$/;
const APPLE_PENCIL_SECOND_GENERATION_MODEL_CODES = ['MXN43AM/A', 'MU8F2AM/A'] as const;
const ALPHA_MODEL_RE = /^(?=[A-Z]{3,8}$)(?!USB|RGB|LED|LCD|HDMI|SSD|HDD|RAM|CPU|GPU|WIFI|OEM|NFC|BLE|BT|RTX|GTX|VR|PC|TV|PRO|MAX|PLUS|MINI|LITE|ULTRA)[A-Z]+$/;
const KNOWN_ALPHABETIC_BRAND_MODELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  glorious: { gmbk: 'GMBK', gmmk: 'GMMK' },
};
const KEURIG_NAMED_MODEL_RE = /\bk[\s-]*(select|compact|elite|supreme|duo|mini|cafe|express|classic|slim|plus|essential|studio|\d{3,4})([\s-]*plus)?\b/i;
const PART_NUMBER_RE = /^(?=.{8,32}$)(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]+(?:-[A-Za-z0-9]+){2,}$/;
// Title prose such as "anti-fog" or "heavy-duty" is not a model. A
// letter-only hyphenated title token must look like an uppercase manufacturer
// code (for example NT-USB+); explicitly stated Model fields stay permissive.
const TITLE_MODEL_ALT_RE = /^(?=[A-Z0-9+.-]*[A-Z]{2})[A-Z0-9]{1,8}-[A-Z0-9+.]{1,14}$/;
const DIGIT_LED_MODEL_RE = /^(?=.{4,24}$)(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
const NUMERIC_PART_RE = /^\d{2,8}(?:-\d{2,8})+$/;
const CAPACITY_RE = /^(?:\d+(?:\.\d+)?\s*[xX]\s*)?\d+(?:\.\d+)?(?:gb|tb|mb|kb)$/i;
const GENERIC_MODEL_RE = /^(?:n\/?a|none|null|nil|unknown|unspecified|various|assorted|misc(?:ellaneous)?|standard|generic|regular|default|see\s+(?:photos?|pictures?|description)|no\s+model|model|[a-z]\s*-?\s*series|series|multiple|ddr[345](?:l|x)?|wi[\s-]*fi\s*[5-7]e?|bluetooth\s*\d+(?:\.\d+)?|bt\s*\d+(?:\.\d+)?|usb\s*\d+(?:\.\d+)?|hdmi\s*\d+(?:\.\d+)?)$/i;
const INTERFACE_ONLY_MODEL_RE = /^(?:usb[\s-]*[abc]|hdmi(?:[\s-]*\d(?:\.\d+)?)?|displayport|rj45|ethernet)$/i;
const CONDITION_PARTS_RE = /\b(for\s*parts|parts\s*only|salvage|broken|not\s*working|non[\s-]*functional|defective|scrap|damaged\s*beyond)\b/i;
const CONDITION_GOOD_RE = /\b(brand\s*new|new|sealed|excellent|like\s*new|mint|open\s*box|good|very\s*good)\b/i;
const OPERATIONAL_POSITIVE_RE = /\b(tested\s*(?:and\s*)?working|works?\s*(?:great|well|fine|perfectly)|fully\s*functional)/i;
const NEW_CONDITION_EVIDENCE_RE = /\b(brand\s*new|sealed|new\s*in\s*box|nib\b)/i;
const SELLER_WORKING_CLAIM_RE = /\b(?:in\s+(?:good|very\s+good|excellent|full|proper)\s+working\s+condition|in\s+working\s+order|working\s+order)\b/i;

function hasSellerWorkingClaim(text: string | null | undefined): boolean {
  return hasCurrentUnitWorkingClaim(text, SELLER_WORKING_CLAIM_RE);
}

function hasCurrentUnitWorkingClaim(text: string | null | undefined, pattern: RegExp): boolean {
  const clauses = normalise(text).split(/\r?\n|(?<=[.!?;])\s+/i).filter(Boolean);
  return clauses.some((clause) => {
    const match = pattern.exec(clause);
    if (!match) return false;
    const before = clause.slice(0, match.index ?? 0);
    const after = clause.slice((match.index ?? 0) + match[0].length);
    // A reporting prefix does not make a bulk policy or another item's claim
    // evidence about this unit. Past-tense claims likewise do not assert now.
    if (/\b(?:all|any|each|every|these)\s+(?:items?|lots?|products?|units?|merchandise)\b/i.test(before)) return false;
    if (/\b(?:another|different|other|separate)\s+\w+/i.test(before)) return false;
    if (/\b(?:not|never|no|without|unknown|uncertain|unclear|possibly|perhaps|may|might|could|was|were|had|used\s+to)\b[^,;]{0,35}$/i.test(before)) return false;
    if (/^\s*(?:(?:condition|status|is)\s*)?[:?=-]?\s*(?:not\s+guaranteed|unknown|uncertain|unclear|not\s+confirmed|not\s+verified)\b/i.test(after)) return false;
    // Suffix qualifiers, including comma/contrast tails, qualify the same
    // sentence's claim rather than supplying current functional evidence.
    if (/\b(?:before\s+(?:storage|being\s+stored)|when\s+last\b|not\s+(?:guaranteed|confirmed|verified))\b/i.test(after)) return false;
    return !/\b(?:not\s+(?:fully\s+)?(?:working|functional|in\s+(?:good\s+)?working\s+(?:order|condition))|does\s+not\s+work|won['’]?t\s+work)\b/i.test(clause);
  });
}
const MAJOR_COMPONENT_PATTERNS: ReadonlyArray<readonly [string, RegExp]> = [
  ['deck', /\b(?:mower\s+)?deck\b/i], ['engine', /\bengine\b/i], ['motor', /\bmotor\b/i],
  ['transmission', /\btransmission\b/i], ['seat', /\bseat\b/i], ['wheel', /\bwheels?\b/i],
  ['door', /\bdoors?\b/i], ['drawer', /\bdrawers?\b/i], ['lid', /\blids?\b/i],
  ['tank', /\btanks?\b/i], ['bin', /\bbins?\b/i], ['canister', /\bcanisters?\b/i],
  ['screen', /\bscreens?\b/i], ['display', /\bdisplays?\b/i], ['control panel', /\bcontrol\s+panels?\b/i],
  ['print head', /\bprint\s*heads?\b/i], ['carriage', /\bcarriages?\b/i],
  ['power supply', /\b(?:power\s+suppl(?:y|ies)|psu)\b/i],
];

export function missingMajorComponents(text: string | null | undefined): string[] {
  const source = normalise(text);
  return MAJOR_COMPONENT_PATTERNS.flatMap(([name, noun]) => {
    const nounSource = noun.source.replace(/^\\b|\\b$/g, '');
    const marker = new RegExp(
      `(?:\\b(?:missing|without|lacks?|no)\\s+(?:(?:the|a|an|any|one|both|all|external|internal|original|replacement|ac|dc)\\s+)*${nounSource}\\b|\\b${nounSource}\\s+(?:is|are)?\\s*(?:missing|not\\s+included|absent|unavailable)\\b|\\bmissing\\s+major\\s+component:\\s*${nounSource}\\b)`,
      'gi',
    );
    const matched = [...source.matchAll(marker)].some((match) => {
      const start = match.index ?? 0;
      const before = source.slice(Math.max(0, start - 24), start);
      const after = source.slice(start + match[0].length, start + match[0].length + 32);
      const markerWord = match[0].match(/\b(?:missing|without|lacks?|no)\b/i)?.[0] || '';
      // Negate each absence occurrence independently.
      if (/\b(?:no|not|never)\s+$/i.test(before) && /^missing\b/i.test(match[0])) return false;
      if (/\bnot\s+$/i.test(before) && /^(?:without|no|lacks?)$/i.test(markerWord)) return false;
      const absencePredicate = new RegExp(`^${nounSource}\\s+(?:(?:is|are)\\s+)?(?:missing|not\\s+included|absent|unavailable)\\b`, 'i');
      if (absencePredicate.test(match[0])) return true;
      if (/^missing\s+major\s+component:/i.test(match[0])) return true;
      if (/^\s+(?:(?:is|are)\s+)?missing\b/i.test(after)) return false;
      if (/^(?:\s+)?(?:is|are)\s+(?:not\s+)?(?:missing|included|supplied|present|available|provided|installed|fitted|attached|absent|unavailable)\b/i.test(after)) return true;
      if (/^(?:\s+)?(?:missing|not\s+included|absent|unavailable|included|supplied|present|available|provided|installed|fitted|attached)\b/i.test(after)) return true;
      if (/^\s+(?:on|from|in|with|for)\b/i.test(after)) return true;
      if (!after.trim()
        || /^[^\S\r\n]*\r?\n/.test(after)
        || /^(?:\s*[-,:;.!?)]|\s+(?:and|or|but)\b)/i.test(after)) return true;
      return false;
    });
    return matched ? [name] : [];
  });
}

export function missingMajorComponentRejections(sourceText: string | null | undefined, candidateText: string | null | undefined): string[] {
  const source = new Set(missingMajorComponents(sourceText));
  const candidate = new Set(missingMajorComponents(candidateText));
  return [...new Set([...source, ...candidate])]
    .filter((component) => source.has(component) !== candidate.has(component))
    .map((component) => `condition-mismatch:missing-major-component:${component}`);
}
const REPAIR_RISK_RE = /\b(?:may|might|possibly|could)\s+need\s+repairs?\b|\b(?:sounds?|seems?)\s+like\s+(?:it['’]?s|it\s+is)\s+(?:going\s+out|failing|dying)\b/gi;
const NON_OPERATIONAL_RE = /\b(?:not\s+(?:working|running|starting)|(?:does\s+not|doesn't|won['’]?t|will\s+not)\s+(?:work|run|start|operate|function))\b/i;
const COMPONENT_FAULT_RE = /\b(?:function|feature|component|self[-\s]?propelled|drive|button|switch|display|screen|nozzle|fan|pump|battery|charger|speaker)\b[^.!?;]{0,45}\b(?:does\s+not|doesn't|not|won['’]?t|will\s+not)\s+(?:work(?:ing)?|function|operate|turn\s+on|power|run(?:ning)?|start(?:ing)?)\b/i;
const COMPONENT_SUBJECT_RE = /\b(function|feature|component|self[-\s]?propelled|drive|button|switch|display|screen|nozzle|fan|pump|battery|charger|speaker)\b/gi;

function nonOperationalUncertainty(text: string): boolean {
  return /\b(?:not\s+sure|unsure|uncertain)\s+(?:if|whether)\b[^.!?;]*\b(?:working|running|starting|work|run|start)\b/i.test(text);
}

function nonOperationalNegation(text: string): boolean {
  return /\b(?:not\s+true|false|incorrect|wrong)\s+(?:that|to|if|whether)\b[^.!?;]{0,60}\b(?:not\s+(?:working|running|starting)|(?:does\s+not|doesn't|won['’]?t|will\s+not)\s+(?:work|run|start|operate|function))\b/i.test(text);
}

function hasPrimaryNonOperationalFault(text: string): boolean {
  return text.split(/\r?\n|(?<=[.!?;])\s+|\s+\b(?:but|however|yet)\b\s+/i).some((clause) => {
    if (!NON_OPERATIONAL_RE.test(clause) || nonOperationalUncertainty(clause) || nonOperationalNegation(clause)) return false;
    return true;
  });
}

function hasLotSpecificRepairRisk(text: string): boolean {
  return text.split(/\r?\n|(?<=[.!?;])\s+|\s+\b(?:but|however|yet)\b\s+/i).some((clause) => {
    if (/^\s*(?:notes?:\s*)?(?:all|any)\s+(?:items?|products?|lots?|merchandise)\b/i.test(clause)) return false;
    return [...clause.matchAll(REPAIR_RISK_RE)].some((match) => {
      const before = clause.slice(0, match.index ?? 0);
      return !/\b(?:does|do|did|is|are|was|were|would|will|can|could)\s+not\s*$/i.test(before)
        && !/\b(?:doesn't|don't|didn't|isn't|aren't|wasn't|weren't|wouldn't|won't|can't|couldn't|not|never|no)\s*$/i.test(before);
    });
  });
}
const ACCESSORY_NOUN_RE = /\b(case|cover|sleeve|skin|pouch|protector|tips|eartips|cable|cord|charger|adapter|mount|holder|stand|arm|topper|strap|band|belt|bumper|shell|film|dock|lanyard|clip|controller|game|spray|cloth|cloths|pads?|pods?|capsules?|wipes?|filters?|valves?|sensor\s*wires?|disc\s+drive|remote(?:\s+control)?|bowl|jar|lid|blade|baffle|shield|backplate|back\s*plate|build\s*plate|magnetic\s+plate|pei\s+(?:sheet|plate)|flexi(?:ble)?\s+steel(?:\s+sheet)?|chisels?|drill\s+bits?|bit\s+sets?|faceplate|wall\s*plate|trim\s*kit|bracket|standoffs?|screws?|screw\s*kit|thermal\s*pad|riser|extender|gasket|grommet|spacer|shroud|bezel|decal|sticker|manual|module|chip|header|jumper|ribbon|harness|insert|knobs?|lamps?|bulbs?|footswitch(?:es)?|foot\s+switch(?:es)?|pedals?|cartridges?|probes?|camera\s+heads?|pizza\s+pan|baking\s+pan|crumb\s+tray|replacement\s+tray|plant\s+food|descal(?:er|ing)\s+tablets?|cleaning\s+tablets?|photo\s+prop|display\s+decoration)s?\b/i;
const PRINTER_COMPONENT_NOUN_RE = /\b(?:hot\s*ends?|nozzles?|extruders?|led\s+lights?|lighting|panda\s+lux)\b/i;
const PRINTER_COMPONENT_SUBJECT_RE = /\b(?:print\s*heads?|printheads?|control\s+panels?|carriage(?:\s+(?:belt|drive|motor))?|belt\s+drive(?:\s+motor)?|drive\s+motor|ink(?:\s+jet)?\s+(?:cartridges?|tanks?|bottles?)|ink(?![\s-]*jet\b))\b/i;
const PRINTER_AMS_RE = /\b(?:ams(?:\s+\d+\s+pro)?|auto\s+material\s+systems?)\b/i;

function amsMentionIsNegated(title: string, mention: RegExpExecArray): boolean {
  const before = title.slice(Math.max(0, mention.index - 45), mention.index);
  const after = title.slice(mention.index + mention[0].length, mention.index + mention[0].length + 70);
  return /\b(?:without|no|not\s+(?:including|included)|excluding)\s*$/i.test(before)
    || /^\s*(?:[-,:;]\s*)?(?:is\s+)?(?:not\s+included|sold\s+separately|excluded|unavailable)\b/i.test(after);
}
const ACCESSORY_MARKER_RE = /\b(compatible\s+with|replacement\s+for|replacement\s+parts?\s+only|designed\s+for|made\s+for|for\s+use\s+with|fits?\s+for|fits\s+(?:the\s+)?[A-Z0-9])/i;
const FOR_PRODUCT_VERBS = 'compatible\\s+with|replacement\\s+(?:part\\s+)?for|designed\\s+for|made\\s+for|for\\s+use\\s+with|fits|suitable\\s+for|upgrade\\s+for';
const TITLE_PREFIX_RE = /^\s*(?:\(?\s*(?:open\s*box|openbox|refurbished|refurb|renewed|used|pre[\s-]?owned)[^-|:]*\)?\s*[-|:]\s*)+/i;
const USED_RE = /\b(open\s*box|openbox|refurbished|refurb|renewed|pre[\s-]?owned|used|for\s+parts)\b/i;
const GENERIC_BRAND_RE = /^(?:wireless|smart|portable|professional|digital|electric|electronic|gaming|bluetooth|usb|4k|8k|hd|full|mini|new|vintage|vntg\.?|vtg\.?|antq\.?|built[\s-]?in|multifunction|automatic|cordless|rechargeable|custom|workstation|tower|desktop|computer|system|inch|external|drive|console|receiver|headset|headphones?|monitor|television|tv|camera|printer|speaker|router|vacuum|couch|cargo|crystal|pink|beach|tandem|heated|wooden|steam|solar|royal|black|white|clear|low|compact|dried|calming|extra|girls|baby|hallway|mold|linen|cat|king|prone|creativity|countertop|rotatable|jewelry|a|an|the|hand|antique|knotted)$/i;
const AGE_DESCRIPTOR_PREFIX_RE = /^(?:vntg\.?|vtg\.?|antq\.?|vintage)$/i;
const AGE_DESCRIPTOR_GENERIC_RE = /^(?:sterling|silver|gold|rose|white|yellow|platinum|bronze|brass|copper|metal|jewelry|jewellery|ring|rings|broach|brooch|pin|buckle|scout|girl|girls|size|band|pendant|necklace|bracelet|earrings?)$/i;
const RESEARCH_QUERY_NOISE = new Set<string>();
const PRODUCT_KIND_PATTERNS: Array<[ProductKind, RegExp]> = [
  ['game-console', /\b(?:(?:playstation\s*[2-6]|ps\s*[2-6]|xbox(?:\s+(?:one|series\s*[sx]))?|nintendo\s+switch)[^,;]{0,35}\b(?:consoles?|systems?)|game\s+consoles?)\b/i],
  ['graphics-card', /\b(?:graphics|video)\s+cards?\b|\b(?:geforce\s+)?rtx\s*\d{3,4}\b|\bradeon\s+rx\s*\d{3,4}\b/i],
  ['memory', /\b(?:ram|memory\s+(?:kits?|modules?)|ddr[345]|chips?)\b/i],
  ['processor', /\b(?:cpus?|(?:computer|desktop|server)\s+processors?|core\s+i[3579][\s-]*\d{4,5}[a-z]*|ryzen\s+[3579]\s+\d{4}[a-z]*)\b/i],
  ['smartwatch', /\b(?:smart\s*watches?|apple\s+watch|galaxy\s+watch|pixel\s+watch)\b/i],
  ['power-tool', /\b(?:impact\s+drivers?|hammer\s+drills?|cordless\s+drills?|circular\s+saws?|reciprocating\s+saws?|angle\s+grinders?|nail\s+guns?)\b/i],
  ['storage', /\b(?:external|portable)\s+(?:hard\s+)?drives?\b|\b(?:hard\s+drives?|ssds?|hdds?)\b/i],
  ['projector', /\bprojectors?\b/i],
  ['monitor', /\b(?:computer|gaming|lcd|led)?\s*monitors?\b/i],
  ['television', /\b(?:televisions?|tvs?|(?:qled|oled)\s+(?:tvs?|televisions?|displays?))\b/i],
  ['receiver', /\b(?:a\/?v\s+)?receivers?\b|\bamplifiers?\b/i],
  ['headphones', /\b(?:headphones?|headsets?|earbuds?|earphones?)\b/i],
  ['microphone', /\b(?:microphones?|mics?)\b/i],
  ['laptop', /\b(?:laptops?|notebooks?|macbooks?|chromebooks?)\b/i],
  ['desktop', /\b(?:desktop(?:\s+computers?)?|all[\s-]in[\s-]ones?|computer\s+towers?|gaming\s+pcs?)\b/i],
  ['stylus', /\b(?:apple\s+pencils?|digital\s+pens?|active\s+pens?|styl(?:us|i))\b/i],
  ['tablet', /\b(?:tablets?|ipads?)\b/i],
  ['phone', /\b(?:smartphones?|cell\s+phones?|iphones?|phones?)\b/i],
  ['speaker', /\b(?:speakers?|soundbars?)\b/i],
  ['camera', /\b(?:cameras?|camcorders?)\b/i],
  ['printer', /\b(?:printers?|scanners?)\b/i],
  ['keyboard', /\bkeyboards?\b/i],
  ['mouse', /\b(?:computer\s+)?mice\b|\bmouse\b/i],
  ['router', /\b(?:routers?|mesh\s+systems?)\b/i],
  ['vacuum', /\b(?:vacuum(?:\s+cleaners?)?|robot\s+vacuums?)\b/i],
  ['car-stereo', /\b(?:car\s+stereos?|carplay\s+(?:stereos?|radios?)|head\s+units?)\b/i],
];

const PRODUCT_FAMILY_PATTERNS: Array<[string, RegExp]> = [
  ['snorkel-mask', /\b(?:snorkel(?:ing)?\s+(?:gear\s+)?(?:set\s+)?[^,;]{0,25}mask|diving\s+mask)\b/i],
  ['anti-fog-spray', /\b(?:anti[\s-]*fog\s+spray|defogger)\b/i],
  ['kickball', /\b(?:kickball|mega\s+ball)\b/i],
  ['football', /\bfootballs?\b/i],
  ['soccer-ball', /\bsoccer\s+balls?\b/i],
  ['bounce-ball', /\b(?:bounce|bouncy)\s+ball\b/i],
  ['pasta-bowls', /\bpasta\s+bowls?\b/i],
  ['dinnerware-set', /\b(?:dinnerware|dishware|plates?\s+and\s+bowls?)\b/i],
  ['neck-fan', /\bneck\s+fans?\b/i],
  ['handheld-fan', /\b(?:handheld|turbo)\s+fans?\b/i],
  ['steam-cleaner', /\b(?:steam\s+cleaners?|handheld\s+steamers?)\b/i],
  ['cleaning-cloth', /\b(?:microfiber\s+cloths?|steam\s+cleaner\s+pads?)\b/i],
  ['irrigation-system', /\b(?:drip\s+irrigation\s+(?:kit|system)|irrigation\s+timer)\b/i],
  ['replacement-parts', /\b(?:replacement\s+(?:parts?|kit)|parts?\s+only)\b/i],
  ['wd-my-passport', /\b(?:western\s+digital|wd)\s+my\s+passport\b/i],
  ['wd-purple', /\b(?:western\s+digital|wd)\s+purple\b/i],
  ['wd-red', /\b(?:western\s+digital|wd)\s+red\b/i],
  ['wd-blue', /\b(?:western\s+digital|wd)\s+blue\b/i],
  ['wd-black', /\b(?:western\s+digital|wd)\s+black\b/i],
  ['seagate-backup-plus', /\bseagate\s+backup\s+plus\b/i],
  ['seagate-expansion', /\bseagate\s+expansion\b/i],
  ['seagate-barracuda', /\bseagate\s+barra(?:cuda)?\b/i],
  ['vase', /\bvases?\b/i],
  ['planter', /\b(?:planters?|flower\s+pots?)\b/i],
];

const COLOR_WORDS = ['black', 'white', 'red', 'blue', 'green', 'purple', 'pink', 'grey', 'gray', 'beige', 'brown', 'orange', 'yellow', 'clear', 'ivory', 'burgundy', 'flaxen', 'wheat'];
const MATERIAL_WORDS: Array<[string, RegExp]> = [
  ['sherpa', /\bsherpa\b/i], ['fleece', /\bfleece\b/i], ['cotton', /\bcotton\b/i],
  ['linen', /\blinen\b/i], ['velvet', /\bvelvet\b/i], ['leather', /\bleather\b/i],
  ['stainless-steel', /\bstainless\s+steel\b/i], ['plastic', /\bplastic\b/i],
  ['glass', /\bglass\b/i], ['ceramic', /\bceramic\b/i], ['wood', /\b(?:wood|wooden)\b/i],
  ['nylon', /\bnylon\b/i], ['polyester', /\bpolyester\b/i], ['microfiber', /\bmicrofiber\b/i],
  ['rubber', /\brubber\b/i],
];

const BRAND_FAMILIES: ReadonlyArray<readonly [string, RegExp]> = [
  ['sony', /\b(?:sony|playstation)\b/i],
  ['microsoft', /\b(?:microsoft|xbox)\b/i],
  ['apple', /\b(?:apple|iphone|ipad|macbook|airpods)\b/i],
  ['google', /\b(?:google|pixel)\b/i],
  ['meta', /\b(?:meta|oculus)\b/i],
  ['western-digital', /\b(?:western\s+digital|wd)\b/i],
  ['b-braun', /\bb\.?\s*braun\b/i],
  ['bowers-wilkins', /\b(?:bowers\s*(?:&|and)\s*wilkins|b\s*&\s*w)\b/i],
  ['bang-olufsen', /\b(?:bang\s*(?:&|and)\s*olufsen|b\s*&\s*o)\b/i],
  ['hewlett-packard', /\b(?:hewlett[\s-]+packard|hp)\b/i],
  ['amazon-basics', /\bamazon\s+basics\b/i],
  ['hamilton-beach', /\bhamilton\s+beach\b/i],
  ['black-and-decker', /\bblack\s*(?:\+|&|and)?\s*decker\b/i],
  ['jbl', /\bjbl\b/i],
  ['logitech', /\blogitech\b/i],
  ['kitchenaid', /\bkitchen\s*aid\b/i],
  ['breville', /\bbreville\b/i],
  ['keurig', /\bkeurig\b/i],
  ['oster', /\boster\b/i],
  ['bissell', /\bbissell\b/i],
  ['crosley', /\bcrosley\b/i],
];

const NAMED_HTML_ENTITIES: Record<string, string> = {
  amp: '&', apos: "'", copy: '', gt: '>', hellip: '...', lt: '<', nbsp: ' ', quot: '"',
  reg: '', times: 'x', trade: '',
};

function normalise(value: unknown): string {
  return String(value ?? '')
    .replace(/&([a-z]+);/gi, (entity, name: string) => NAMED_HTML_ENTITIES[name.toLowerCase()] ?? entity)
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (entity, hex: string | undefined, decimal: string | undefined) => {
      const codePoint = Number.parseInt(hex || decimal || '', hex ? 16 : 10);
      try {
        return Number.isFinite(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : entity;
      } catch {
        return entity;
      }
    })
    .normalize('NFKC')
    .replace(/[\u200b-\u200d\u2060\ufeff]/g, '')
    .replace(/[Øø]/g, (character) => character === 'Ø' ? 'O' : 'o')
    .replace(/[Łł]/g, (character) => character === 'Ł' ? 'L' : 'l')
    .replace(/\r\n?/g, '\n')
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/×/g, 'x')
    .replace(/[\u00a0\u2007\u202f]/g, ' ');
}

function stripInventoryPrefix(value: string): string {
  return value
    .replace(/^\s*\{?\s*(?:each|ea)\b\s*\}?\s*/i, '')
    .replace(/^\s*lot\s*#?\s*[a-z0-9-]+\s*[-:|]\s*/i, '')
    .replace(/^\s*(?:av|inv(?:entory)?|sku|stock|item)\s*(?:#\s*[a-z0-9-]+\s*)?[-:|]\s*/i, '')
    .replace(/^\s*(?:brand\s+new|new|open\s*box|used|refurbished|renewed)\s*[-:|]\s*/i, '')
    .trim();
}

function canonicalResolution(value: string): string {
  const lower = value.toLowerCase();
  if (lower === '2160p') return '4k';
  return lower;
}

function capacityMagnitude(value: string): number {
  const match = value.match(/^(\d+(?:\.\d+)?)(tb|gb|mb|kb)$/i);
  if (!match) return 0;
  const units: Record<string, number> = { kb: 1, mb: 1024, gb: 1024 ** 2, tb: 1024 ** 3 };
  return Number(match[1]) * (units[match[2]!.toLowerCase()] || 0);
}

function normalizeSeriesToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function extractSeriesSignatures(value: string): string[] {
  const words = normalise(value).toLowerCase().match(/[a-z]+\d+[a-z]*|\d+(?:\.\d+)?[a-z]+|\d+(?:st|nd|rd|th)?|[a-z]+/g) || [];
  const unitWords = new Set(['inch', 'inches', 'gb', 'tb', 'mb', 'kb', 'hz', 'mhz', 'ghz', 'w', 'watts']);
  const variants = new Set(['pro', 'max', 'plus', 'ultra', 'mini', 'air', 'lite', 'slim', 'fold', 'flip', 'generation', 'gen']);
  const productFamilies = new Set(['iphone', 'ipad', 'pixel', 'galaxy', 'quest', 'airpods', 'macbook', 'surface', 'echo', 'kindle', 'roomba', 'dyson', 'gopro']);
  const signatures: string[] = [];
  for (let index = 0; index < words.length; index += 1) {
    const token = words[index]!;
    const numeric = /^\d+(?:st|nd|rd|th)?$/.test(token) || (/^[a-z]+\d+[a-z]*$/.test(token) && !/^(?:ddr|wifi|bt)\d/i.test(token));
    if (!numeric) continue;
    if (unitWords.has(words[index + 1] || '') || /^(?:720p|1080p|1440p|2160p|[458]k)$/.test(token)) continue;
    const before = words.slice(Math.max(0, index - 2), index).filter((word) => !variants.has(word));
    const family = before.at(-1);
    if (!family || !productFamilies.has(family)) continue;
    const after: string[] = [];
    for (const word of words.slice(index + 1, index + 4)) {
      if (!variants.has(word)) break;
      after.push(word);
    }
    signatures.push([family, token, ...after].map(normalizeSeriesToken).join(':'));
  }
  return [...new Set(signatures)];
}

function jewelryRingContext(value: string): boolean {
  const primary = normalise(value).split(/\n|[;|]|\b(?:with|includes?|including|for\s+use\s+with)\b|\bw\s*\//i, 1)[0] || '';
  return /\brings?\b/i.test(primary)
    && !/\b(?:piston|engine|gasket|seal|bearing|retaining|snap|adapter|camera|doorbell|binder|light|toss|sizer|holder|mount|key|napkin|shower|curtain)\b|\bo[\s-]?rings?\b/i.test(primary)
    && (/\b(?:sterling|silver|gold|platinum|titanium|tungsten|diamond|jewelry|jewellery|engagement|wedding|signet|scout|gemstone|rings?\s+(?:(?:is|has|measures|measuring)\s+(?:a\s+)?)?(?:approx(?:imately)?\.?\s+)?(?:sizes?|sz))\b/i.test(primary)
      || /\brings?\s*$/i.test(primary));
}

function ringSizeEvidence(value: string, ringContext = jewelryRingContext(value)): {
  state: 'missing' | 'known' | 'uncertain'; sizes: string[]; fractions: string[];
} {
  const missing = { state: 'missing' as const, sizes: [], fractions: [] };
  const uncertain = { state: 'uncertain' as const, sizes: [], fractions: [] };
  if (!ringContext) return missing;
  const source = normalise(value).toLowerCase()
    .replace(/(\d)(?=(?:1\u20444|1\u20442|3\u20444)\b)/g, '$1 ');
  const sizes: string[] = [];
  const fractions: string[] = [];
  for (const clause of source.split(/\n|[;|]|\b(?:with|includes?|including)\b|\bw\s*\//i)) {
    if (!jewelryRingContext(clause) && !/^\s*(?:ring\s+)?(?:sizes?|sz)\b/i.test(clause)) continue;
    for (const marker of clause.matchAll(/\b(?:sizes?|sz)\s*[:#-]?\s*(?:(?:approx(?:imately)?\.?|about)\s+)?/gi)) {
      const subject = [...clause.slice(0, marker.index ?? 0).matchAll(/\b(rings?|box(?:es)?|packages?|chains?|necklaces?|bracelets?|stones?|gemstones?)\b/gi)].at(-1)?.[1] || '';
      if (subject && !/^rings?$/.test(subject)) continue;
      const tail = clause.slice((marker.index ?? 0) + marker[0].length);
      const match = tail.match(/^(\d{1,2})(?:(?:\s+|\s*-\s*)(\d+)\s*[\/\u2044]\s*(\d+)|\.(\d+))?/);
      if (!match) return uncertain;
      const after = tail.slice(match[0].length);
      // Consume the complete numeric assertion before trusting a size. Lists,
      // ranges and malformed continuations must retain uncertainty.
      const weightSuffix = after.match(/^\s*[,\-\u2013\u2014]?\s*\d+(?:\.\d+)?\s*(?:g|grams?|oz|ounces?|ct|carats?)\b/i);
      const continuation = weightSuffix ? after.slice(weightSuffix[0].length) : after;
      if (/^[a-z\d]|^\s*(?:\.[a-z\d]|[\/\u2044]|[-\u2013\u2014&+]\s*\d|[([]\s*(?:(?:and|or|to|through|plus)\s+)?\d|(?:and|or|to|through|plus)\b)|^\s*(?:mm|cm|inches?|feet|ft|gb|tb|ml|liters?|l|oz)\b/i.test(continuation)
        || /^\s*(?:,\s*|\s+)\d/.test(continuation)) return uncertain;
      const fraction = match[2] ? Number(match[2]) / Number(match[3]) : match[4] ? Number(`0.${match[4]}`) : 0;
      if (!Number.isFinite(fraction) || fraction < 0 || fraction >= 1
        || (match[2] && ![0.25, 0.5, 0.75].includes(fraction))) return uncertain;
      sizes.push(String(Number(match[1]) + fraction));
      if (match[2]) fractions.push(`${match[2]}/${match[3]}`);
    }
  }
  const unique = [...new Set(sizes)];
  return unique.length > 1 ? uncertain : unique.length === 1
    ? { state: 'known', sizes: unique, fractions } : missing;
}

function legacyRingSizeLabels(value: string): string[] {
  const nonSizeLabels = [...normalise(value).matchAll(/\b(?:unit|model|style)\s*[-:#]?\s*([a-z0-9][a-z0-9-]{0,15})\b/gi)]
    .map((match) => String(match[1]).toLowerCase());
  return [...normalise(value).matchAll(/\bsize\s*[-:#]?\s*([a-z0-9][a-z0-9-]{0,15})\b/gi)]
    .map((match) => String(match[1]).toLowerCase()).filter((label) => !nonSizeLabels.includes(label));
}

export function extractProductDiscriminators(value: string | null | undefined): ProductDiscriminators {
  const source = normalise(value).toLowerCase();
  const stylusContext = /\b(?:apple\s+pencils?|styl(?:us|i)|digital\s+pens?|active\s+pens?)\b/i.test(source);
  const collect = (pattern: RegExp, normalize: (match: RegExpMatchArray) => string) =>
    [...source.matchAll(pattern)].map(normalize);
  const unitCapacityConfigurations = [...source.matchAll(/\b(\d{1,2})\s*[x×]\s*(\d+(?:\.\d+)?)\s*(gb|mb)\b/gi)];
  const allCapacities = [
    ...collect(/\b(\d+(?:\.\d+)?)[\s-]*(tb|gb|mb|kb)\b/gi, (match) => `${match[1]}${match[2]}`.toLowerCase()),
    ...unitCapacityConfigurations.map((match) => `${Number(match[1]) * Number(match[2])}${String(match[3]).toLowerCase()}`),
  ];
  const capacities = allCapacities.length ? [allCapacities.sort((left, right) => capacityMagnitude(right) - capacityMagnitude(left))[0]!] : [];
  const cubicCapacities = collect(/\b(\d+(?:\.\d+)?)[\s-]*(?:cu(?:bic)?\.?\s*ft\.?|cubic\s+(?:feet|foot))\b/gi, (match) => `${Number(match[1])}cuft`);
  const weightLimits = [
    ...collect(/\b(\d+(?:\.\d+)?)[\s-]*(?:lb|lbs|pounds?)[\s-]*(?:max(?:imum)?|capacity|limit)\b/gi, (match) => `${Number(match[1])}lb`),
    ...collect(/\b(?:max(?:imum)?|capacity|limit)[\s:-]*(\d+(?:\.\d+)?)[\s-]*(?:lb|lbs|pounds?)\b/gi, (match) => `${Number(match[1])}lb`),
  ];
  const resolutions = collect(/\b(8k|5k|4k|2160p|1440p|1080p|720p)\b/gi, (match) => canonicalResolution(String(match[1])));
  const dimensions = [
    ...collect(/\b(\d+(?:\.\d+)?)[\s-]*(?:inch(?:es)?|in\.?|\")(?=\s|$|[),/])/gi, (match) => `${match[1]}in`),
    ...collect(/\b(\d+(?:\.\d+)?)[\s-]*(?:feet|foot|ft\.?)\b/gi, (match) => `${match[1]}ft`),
  ];
  const platformVariants = [
    ...collect(/\b(?:playstation|ps)\s*([2-6])\b/gi, (match) => `playstation:${match[1]}`),
    ...collect(/\bxbox\s+(one|series\s*[sx])\b/gi, (match) => `xbox:${String(match[1]).replace(/\s+/g, '')}`),
    ...collect(/\bnintendo\s+switch(?:\s+(2|oled|lite))?\b/gi, (match) => `switch:${match[1] || 'standard'}`),
  ];
  if (/\bxbox\b/i.test(source) && !platformVariants.some((value) => value.startsWith('xbox:'))) {
    platformVariants.push('xbox:compatible');
  }
  const memoryTypes = collect(/\b(ddr[345](?:l|x)?)\b/gi, (match) => String(match[1]).toLowerCase());
  const frequencies = collect(/\b(\d+(?:\.\d+)?)[\s-]*(mhz|ghz)\b/gi, (match) => `${match[1]}${match[2]}`.toLowerCase());
  const refreshRates = collect(/\b(\d{2,3})[\s-]*hz\b/gi, (match) => `${match[1]}hz`);
  const storageTypes = collect(/\b(nvme|ssd|hdd)\b/gi, (match) => String(match[1]).toLowerCase());
  if (storageTypes.includes('nvme')) storageTypes.push('ssd');
  const networkStandards = [
    ...collect(/\bwi[\s-]*fi\s*(5|6e?|7)\b/gi, (match) => `wifi:${match[1]}`),
    ...collect(/\b(?:bluetooth|bt)\s*(\d+(?:\.\d+)?)\b/gi, (match) => `bluetooth:${match[1]}`),
  ];
  const voltages = collect(/\b(\d+(?:\.\d+)?)[\s-]*(?:v|volt(?:s)?)\b/gi, (match) => `${match[1]}v`);
  const wattages = collect(/\b(\d+(?:\.\d+)?)[\s-]*(?:w(?!\s*\/)|(?<=\d)w(?=\s*\/)|w(?=\s+\/\s*\d+(?:\.\d+)?\s*v\b)|watt(?:s)?)\b/gi, (match) => `${match[1]}w`);
  const batteryCapacities = collect(/\b(\d+(?:\.\d+)?)[\s-]*(?:ah|amp[\s-]*hours?)\b/gi, (match) => `${match[1]}ah`);
  // Focal lengths are sometimes listed in centimetres (for example, 4.5cm
  // instead of 45mm). Keep this discriminator contextual so package,
  // furniture, and other ordinary centimetre measurements cannot become lens
  // identity. Canonicalize both units to millimetres, including ranges.
  const lensContext = /\b(?:camera|cameras|camcorder|camcorders|dslr|slr|mirrorless|rangefinder|lens|lenses|photograph(?:y|ic))\b/i;
  const lensRanges = lensContext.test(source)
    ? [...source.matchAll(/\b(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?\s*(mm|cm)\b/gi)]
      .filter((match) => {
        const before = source.slice(Math.max(0, (match.index ?? 0) - 28), match.index ?? 0);
        const after = source.slice((match.index ?? 0) + match[0].length, (match.index ?? 0) + match[0].length + 28);
        if (/\b\d+(?:\.\d+)?\s*(?:mm|cm)?\s*[x×]\s*$/i.test(before)
          || /^\s*[x×]\s*\d/i.test(after)) return false;
        if (/^\s*(?:[-,:;]\s*)?(?:wide|width|deep|depth|tall|height|long|length)\b(?!\s*[:=])/i.test(after)) return false;
        if (/\b(?:width|depth|height|length)\s*[:=]?\s*$/i.test(before)) return false;
        if (String(match[3]).toLowerCase() !== 'cm') return true;
        return /\bf\s*=\s*$|\b(?:lens|lenses|focal(?:\s+length)?|zoom|telephoto)\s*[:=]?\s*$/i.test(before)
          || /\b(?:lens|lenses|focal(?:\s+length)?|zoom|telephoto)\b/i.test(after);
      })
      .map((match) => {
        const multiplier = String(match[3]).toLowerCase() === 'cm' ? 10 : 1;
        const start = Number(match[1]) * multiplier;
        const end = match[2] ? Number(match[2]) * multiplier : null;
        const format = (value: number) => Number.isInteger(value) ? String(value) : String(value).replace(/\.0+$/, '');
        return `${format(start)}${end == null ? '' : `-${format(end)}`}mm`;
      })
    : [];
  let gpuModels = [
    ...collect(/\b(rtx|gtx)\s*(\d{3,4})(?:\s*(ti))?(?:\s*(super))?\b/gi, (match) => `nvidia:${match[1]}:${match[2]}:${[match[3], match[4]].filter(Boolean).join('-') || 'base'}`.toLowerCase()),
    ...collect(/\bradeon\s+rx\s*(\d{3,4})(?:\s*(xtx|xt))?\b/gi, (match) => `amd:rx:${match[1]}:${match[2] || 'base'}`.toLowerCase()),
  ];
  // The RTX 4070 Ti non-SUPER is a 12 GB card. Listings and auctioneers often
  // omit "SUPER" while retaining 16 GB, which still identifies the SKU.
  if (capacities.includes('16gb') && gpuModels.includes('nvidia:rtx:4070:ti')) {
    gpuModels = gpuModels.map((value) => value === 'nvidia:rtx:4070:ti' ? 'nvidia:rtx:4070:ti-super' : value);
  }
  const cpuModels = [
    ...collect(/\bcore\s+i([3579])[\s-]*(\d{4,5})([a-z]{0,2})\b/gi, (match) => `intel:i${match[1]}:${match[2]}:${match[3] || 'base'}`.toLowerCase()),
    ...collect(/\bryzen\s+([3579])\s+(\d{4})([a-z0-9]{0,3})\b/gi, (match) => `amd:ryzen${match[1]}:${match[2]}:${match[3] || 'base'}`.toLowerCase()),
    ...collect(/\bapple\s+m([1-9])(?:\s*(pro|max|ultra))?\b/gi, (match) => `apple:m${match[1]}:${match[2] || 'base'}`.toLowerCase()),
  ];
  const editions = [
    ...collect(/\b(all[\s-]*digital|digital\s+(?:edition|console)|disc\s+(?:edition|version|console))\b/gi, (match) => /digital/i.test(match[1]!) ? 'digital' : 'disc'),
    ...collect(/\b(oled|lite|slim)\s+(?:edition|model|console)\b/gi, (match) => String(match[1]).toLowerCase()),
    ...collect(/\bapple\s+pencils?\s+for\s+ipad\s+([1-4])(?:st|nd|rd|th)?\s+gen(?:eration)?\b/gi, (match) => `stylus-generation:${match[1]}`),
    ...collect(/\b(?:apple\s+pencil|styl(?:us|i)|digital\s+pen|active\s+pen)\b(?:(?!\b(?:for|compatible\s+with|works?\s+with|ipad)\b)[^.!?]){0,40}?\b([1-4])(?:st|nd|rd|th)?\s+gen(?:eration)?\b/gi, (match) => `stylus-generation:${match[1]}`),
    ...collect(/\b(?:apple\s+pencil|styl(?:us|i)|digital\s+pen|active\s+pen)\b(?:(?!\b(?:for|compatible\s+with|works?\s+with|ipad)\b)[^.!?]){0,40}?\bgen(?:eration)?\s*([1-4])\b/gi, (match) => `stylus-generation:${match[1]}`),
  ];
  const explicitSeriesSignatures = [
    ...collect(/\barctis\s+nova\s+(\d+)(?:[xp])?\b/gi, (match) => `arctis-nova:${match[1]}`),
    ...collect(/\barctis\s+nova\s+(pro)\b/gi, (match) => `arctis-nova:${match[1]}`),
  ];
  const packageCounts = [
    ...collect(/\b(\d{1,4})[\s-]*(?:pack|pk|count|ct|pcs?|pieces?)\b/gi, (match) => String(Number(match[1]))),
    ...collect(/\b(?:pack|set)\s+of\s+(\d{1,4})\b/gi, (match) => String(Number(match[1]))),
    ...collect(/\b(\d{1,4})\s*[x×]\s*\d+(?:\.\d+)?\s*(?:fl\s*oz|oz|ounces?|qt|quarts?|ml|liters?|litres?|l|cups?)\b/gi, (match) => String(Number(match[1]))),
    ...unitCapacityConfigurations.map((match) => String(Number(match[1]))),
  ];
  let colors = COLOR_WORDS.filter((color) => new RegExp(`\\b${color}\\b`, 'i').test(source)).map((color) => color === 'gray' ? 'grey' : color);
  // In phrases such as "clear blue glass", clear describes transparency rather
  // than a competing color variant. The chromatic color carries the identity.
  if (colors.includes('clear') && colors.length > 1) colors = colors.filter((color) => color !== 'clear');
  const materials = MATERIAL_WORDS.filter(([, pattern]) => pattern.test(source)).map(([material]) => material);
  const productFamilies = PRODUCT_FAMILY_PATTERNS.filter(([, pattern]) => pattern.test(source)).map(([family]) => family);
  if (/\bballs?\b/i.test(source) && !productFamilies.some((family) => ['kickball', 'football', 'soccer-ball', 'bounce-ball'].includes(family))) {
    productFamilies.push('other-ball');
  }
  const variantLabels = [
    ...collect(/\b(?:unit|model|style|size)\s*[-:#]?\s*([a-z0-9][a-z0-9-]{0,15})\b/gi, (match) => String(match[1]).toLowerCase()),
    ...collectibleNamedVariantLabels(source),
  ];
  const canonicalVolumeUnit = (value: string): string => {
    const unit = value.replace(/\s+/g, '').toLowerCase();
    if (/^(?:quart|quarts|qt)$/.test(unit)) return 'qt';
    if (/^(?:ounce|ounces|oz|floz)$/.test(unit)) return 'oz';
    if (/^(?:liter|liters|litre|litres|l)$/.test(unit)) return 'l';
    if (/^(?:cup|cups)$/.test(unit)) return 'cup';
    return unit;
  };
  const volumes = [
    ...collect(/\b(\d+(?:\.\d+)?)[\s-]*(fl\s*oz|oz|ounces?|qt|quarts?|ml|liters?|litres?|l|cups?)\b/gi, (match) => `${match[1]}${canonicalVolumeUnit(String(match[2]))}`),
    ...collect(/\b\d{1,4}\s*[x×]\s*(\d+(?:\.\d+)?)\s*(fl\s*oz|oz|ounces?|qt|quarts?|ml|liters?|litres?|l|cups?)\b/gi, (match) => `${match[1]}${canonicalVolumeUnit(String(match[2]))}`),
  ];
  const modeCounts = collect(/\b(\d{1,2})[\s-]*(?:speeds?|modes?|settings?)\b/gi, (match) => String(Number(match[1])));
  const featureCounts = [
    ...collect(/\b(\d{1,2})[\s-]*in[\s-]*1\b/gi, (match) => String(Number(match[1]))),
    ...collect(/\b(\d{1,2})[\s-]*(usb(?:[\s-]*[ac])?)(?:[\s-]*(?:ports?|outlets?))?\b/gi, (match) => `${String(match[2]).replace(/[\s-]/g, '').toLowerCase()}:${Number(match[1])}`),
    ...collect(/\b(\d{1,2})[\s-]*ac[\s-]*outlets?\b/gi, (match) => `ac:${Number(match[1])}`),
  ];
  const ringSize = ringSizeEvidence(source);
  const scopedValues = (pattern: RegExp, context: RegExp, excluded = /\b(?:compatible|accessor(?:y|ies)|replacement|for\s+use\s+with)\b/i) =>
    [...source.matchAll(pattern)].flatMap((match) => {
      const isDecimalPoint = (index: number) => /\d/.test(source[index - 1] || '') && /\d/.test(source[index + 1] || '');
      let sentenceStart = Math.max(source.lastIndexOf('.', match.index ?? 0), source.lastIndexOf('!', match.index ?? 0), source.lastIndexOf('?', match.index ?? 0), source.lastIndexOf('\n', match.index ?? 0));
      while (sentenceStart >= 0 && isDecimalPoint(sentenceStart)) {
        sentenceStart = Math.max(source.lastIndexOf('.', sentenceStart - 1), source.lastIndexOf('!', sentenceStart - 1), source.lastIndexOf('?', sentenceStart - 1), source.lastIndexOf('\n', sentenceStart - 1));
      }
      let sentenceEnd = [source.indexOf('.', match.index ?? 0), source.indexOf('!', match.index ?? 0), source.indexOf('?', match.index ?? 0), source.indexOf('\n', match.index ?? 0)]
        .filter((index) => index >= 0)
        .sort((left, right) => left - right)[0] ?? source.length;
      while (sentenceEnd < source.length && isDecimalPoint(sentenceEnd)) {
        const next = [source.indexOf('.', sentenceEnd + 1), source.indexOf('!', sentenceEnd + 1), source.indexOf('?', sentenceEnd + 1), source.indexOf('\n', sentenceEnd + 1)]
          .filter((index) => index >= 0)
          .sort((left, right) => left - right)[0];
        sentenceEnd = next ?? source.length;
      }
      const sentence = source.slice(sentenceStart + 1, sentenceEnd);
      const before = source.slice(sentenceStart + 1, match.index ?? 0);
      const after = source.slice((match.index ?? 0) + match[0].length, sentenceEnd);
      const prefix = before.split(/[,;]|\b(?:but|however|whereas)\b|\band\s+(?=(?:has|uses|features|delivers)\b)/i).at(-1) || '';
      // Compatibility after a spec describes another item; before it, the spec
      // belongs to that compatible item. Negated alternatives have their own scope.
      const suffix = after.split(/[,;]|\b(?:and|but|however|whereas|compatible|for\s+use\s+with)\b/i)[0] || '';
      const negated = /\b(?:not|never|no|without|excluding)\b/i.test(prefix)
        || /^\s*(?:(?:engine|motor|frame|rating)\s+)?(?:(?:is|are)\s+)?(?:not\s+(?:included|supplied|fitted|used)|sold\s+separately|optional)\b/i.test(suffix);
      return context.test(sentence) && !negated && !excluded.test(prefix) && !excluded.test(suffix)
        ? [String(match[1]).toLowerCase()] : [];
    });
  const engineDisplacements = scopedValues(/\b(\d+(?:\.\d+)?)[\s-]*cc\b/gi, /\b(?:engine|chainsaw|gas\s+powered|motor|generator|trimmer|mower|blower)\b/i)
    .map((value) => `${value}cc`);
  const horsepower = scopedValues(/\b(\d+(?:\.\d+)?)[\s-]*(?:hp|horsepower)\b/gi, /\b(?:engine|motor|chainsaw|gas\s+powered|generator|trimmer|mower|blower)\b/i)
    .map((value) => `${value}hp`);
  const motorFrames = [
    ...scopedValues(/\b(\d{2}[a-z])\s+frame\b/gi, /\b(?:motor|frame)\b/i),
    ...scopedValues(/\bframe\s*(\d{2}[a-z])\b/gi, /\b(?:motor|frame)\b/i),
    ...scopedValues(/\b(\d{2}[a-z])\b/gi, /\bmotor\b/i).filter((value) => !isMeasurementLikeModelToken(value)),
  ];
  const impactRates = scopedValues(/\b(\d{3,5})[\s-]*bpm\b/gi, /\b(?:jack\s*hammer|jackhammer|demolition\s+hammer|concrete\s+breaker|chisel)\b/i)
    .map((value) => `${value}bpm`);
  const unique = (items: string[]) => [...new Set(items)];
  return {
    capacities: unique(capacities),
    cubicCapacities: unique(cubicCapacities),
    weightLimits: unique(weightLimits),
    resolutions: unique(resolutions),
    dimensions: unique(dimensions),
    platformVariants: unique(platformVariants),
    memoryTypes: unique(memoryTypes),
    frequencies: unique(frequencies),
    refreshRates: unique(refreshRates),
    storageTypes: unique(storageTypes),
    networkStandards: unique(networkStandards),
    voltages: unique(voltages),
    wattages: unique(wattages),
    batteryCapacities: unique(batteryCapacities),
    lensRanges: unique(lensRanges),
    gpuModels: unique(gpuModels),
    cpuModels: unique(cpuModels),
    editions: unique(editions),
    seriesSignatures: unique([
      ...explicitSeriesSignatures,
      ...(platformVariants.length ? [] : extractSeriesSignatures(source)),
    ]).filter((signature) => !(stylusContext && signature.startsWith('ipad:'))),
    packageCounts: unique(packageCounts),
    colors: unique(colors),
    materials: unique(materials),
    productFamilies: unique(productFamilies),
    variantLabels: unique(variantLabels),
    volumes: unique(volumes),
    modeCounts: unique(modeCounts),
    featureCounts: unique(featureCounts),
    // An explicit empty array retains uncertain size evidence across messages.
    ...(ringSize.state !== 'missing' ? { ringSizes: ringSize.sizes } : {}),
    ...(engineDisplacements.length ? { engineDisplacements: unique(engineDisplacements) } : {}),
    ...(horsepower.length ? { horsepower: unique(horsepower) } : {}),
    ...(motorFrames.length ? { motorFrames: unique(motorFrames) } : {}),
    ...(impactRates.length ? { impactRates: unique(impactRates) } : {}),
  };
}

function ladderDimensionRoles(value: string): { actualHeights: string[]; reaches: string[]; otherFeet: string[]; ambiguousActual: boolean } | null {
  if (!/\b(?:step[\s-]*)?ladders?\b/i.test(value)) return null;
  const source = value.replace(/(\d+(?:\.\d+)?\s*(?:ft|feet|foot))(?=actual|reach)/gi, '$1 ')
    .replace(/\b(actual|reach)(?=\d)/gi, '$1 ');
  const actualHeights = new Set<string>();
  const reaches = new Set<string>();
  const otherFeet = new Set<string>();
  const dimensions = /(?<![a-z\d])(\d+(?:\.\d+)?)(?:\s*-\s*|\s*)(?:ft|feet|foot|')/gi;
  const measurements = [...source.matchAll(dimensions)];
  for (const [index, match] of measurements.entries()) {
    const amount = `${Number(match[1])}ft`;
    const start = match.index ?? 0;
    const previous = measurements[index - 1];
    const next = measurements[index + 1];
    const before = source.slice(Math.max(previous ? (previous.index ?? 0) + previous[0].length : 0, start - 32), start);
    const after = source.slice(start + match[0].length, Math.min(next?.index ?? source.length, start + match[0].length + 40));
    const actualBefore = /(?:actual(?:\s+height)?|ladder\s+size|size)\s*[:=-]?\s*$/i.test(before);
    const actualAfter = /^\s*actual(?:\s+(?:height|size))?\b/i.test(after);
    const reachLabel = '(?:(?:max(?:imum)?|working)\\s+)?(?:reach(?:\\s+height)?|working\\s+height)';
    const reachBefore = new RegExp(`\\b${reachLabel}\\s*[:=-]?\\s*$`, 'i').test(before);
    // A label immediately before the next measurement belongs to that measurement.
    const nextReachPrefix = Boolean(next && new RegExp(`\\b${reachLabel}\\s*[:=-]?\\s*$`, 'i').test(after));
    const reachAfter = !nextReachPrefix && new RegExp(`^\\s*${reachLabel}\\b`, 'i').test(after);
    const accessory = /\b(?:cord|cable|hose|strap|lanyard|wire)(?:\s+length)?\s*[:=-]?\s*$/i.test(before)
      || /^\s*(?:cord|cable|hose|strap|lanyard|wire)\b/i.test(after);
    const compatibility = /\b(?:compatible\s+with|fits?|for\s+use\s+with)\b/i.test(`${before} ${after}`);
    if (accessory) {
      otherFeet.add(amount);
      continue;
    }
    if (compatibility) continue;
    if (reachBefore || reachAfter) reaches.add(amount);
    else if (actualBefore || actualAfter || /\b(?:step[\s-]*)?ladders?\b/i.test(source)) actualHeights.add(amount);
  }
  return { actualHeights: [...actualHeights], reaches: [...reaches], otherFeet: [...otherFeet], ambiguousActual: actualHeights.size > 1 };
}

function compareLadderDimensions(sourceTitle: string, candidateTitle: string, exactModel: boolean): {
  matchedCount: number; conflicts: string[]; missing: string[]; sourceFeet: string[]; candidateFeet: string[];
  sourceOtherFeet: string[]; candidateOtherFeet: string[];
} | null {
  const source = ladderDimensionRoles(sourceTitle);
  const candidate = ladderDimensionRoles(candidateTitle);
  if (!source || !candidate || (!source.actualHeights.length && !source.reaches.length)) return null;
  const conflicts: string[] = [];
  const missing: string[] = [];
  if (source.ambiguousActual) conflicts.push(`source-actual-height-ambiguous:${source.actualHeights.join(',')}`);
  if (source.actualHeights.length) {
    if (!candidate.actualHeights.length) missing.push(`actual-height:${source.actualHeights.join(',')}`);
    else if (candidate.ambiguousActual) conflicts.push(`actual-height-ambiguous:${candidate.actualHeights.join(',')}`);
    else if (!candidate.actualHeights.some((value) => source.actualHeights.includes(value))) {
      conflicts.push(`actual-height:${source.actualHeights.join(',')}!=${candidate.actualHeights.join(',')}`);
    }
  }
  if (source.reaches.length) {
    const matchingActualHeight = !source.ambiguousActual && !candidate.ambiguousActual
      && source.actualHeights.some((value) => candidate.actualHeights.includes(value));
    if (!candidate.reaches.length) {
      if (!(exactModel && matchingActualHeight)) missing.push(`reach:${source.reaches.join(',')}`);
    } else if (!candidate.reaches.some((value) => source.reaches.includes(value))) {
      conflicts.push(`reach:${source.reaches.join(',')}!=${candidate.reaches.join(',')}`);
    }
  }
  const matchedCount = (source.actualHeights.some((value) => candidate.actualHeights.includes(value)) ? 1 : 0)
    + (source.reaches.some((value) => candidate.reaches.includes(value)) ? 1 : 0);
  return { matchedCount, conflicts, missing,
    sourceFeet: [...source.actualHeights, ...source.reaches], candidateFeet: [...candidate.actualHeights, ...candidate.reaches],
    sourceOtherFeet: source.otherFeet, candidateOtherFeet: candidate.otherFeet };
}

function matchesProductDiscriminators(candidateTitle: string, product: ProductIdentity): { matches: boolean; matchedCount: number; conflicts: string[]; missing: string[] } {
  let expected = product.discriminators || extractProductDiscriminators(product.name);
  const sourceRingSize = ringSizeEvidence(product.name);
  if (expected.ringSizes === undefined && sourceRingSize.state !== 'missing') {
    expected = { ...expected, ringSizes: sourceRingSize.sizes };
  }
  const actual = extractProductDiscriminators(candidateTitle);
  const exactModel = Boolean(product.model && modelMatches(candidateTitle, product.model));
  const groups: Array<keyof ProductDiscriminators> = [
    'capacities', 'cubicCapacities', 'weightLimits', 'resolutions', 'dimensions', 'platformVariants', 'memoryTypes', 'frequencies',
    'refreshRates', 'storageTypes', 'networkStandards', 'editions', 'seriesSignatures',
    'voltages', 'wattages', 'batteryCapacities', 'lensRanges', 'gpuModels', 'cpuModels',
    'packageCounts', 'colors', 'materials', 'productFamilies', 'variantLabels',
    'volumes', 'modeCounts', 'featureCounts', 'engineDisplacements', 'horsepower', 'motorFrames', 'impactRates',
    'ringSizes',
  ];
  let matchedCount = 0;
  const conflicts: string[] = [];
  const missing: string[] = [];
  if (sourceRingSize.state === 'uncertain' || (expected.ringSizes !== undefined && expected.ringSizes.length !== 1)) {
    conflicts.push('ringSizes:source-uncertain');
  }
  if (jewelryRingContext(product.name) && actual.ringSizes !== undefined && actual.ringSizes.length !== 1) {
    conflicts.push('ringSizes:candidate-uncertain');
  }
  const ladderDimensions = compareLadderDimensions(product.name, candidateTitle, exactModel);
  const isLessSpecificShadow = (expectedValue: string, actualValue: string): boolean => {
    const expectedParts = expectedValue.split(':');
    const actualParts = actualValue.split(':');
    if (expectedParts.length !== actualParts.length || expectedParts.slice(0, -1).join(':') !== actualParts.slice(0, -1).join(':')) return false;
    const expectedVariant = expectedParts.at(-1) || '';
    const actualVariant = actualParts.at(-1) || '';
    return expectedVariant !== 'base' && (actualVariant === 'base' || expectedVariant.split('-').includes(actualVariant));
  };
  const valueMatches = (group: keyof ProductDiscriminators, expectedValue: string, actualValue: string): boolean => {
    if (expectedValue === actualValue) return true;
    if (group === 'capacities') {
      const expectedMagnitude = capacityMagnitude(expectedValue);
      const actualMagnitude = capacityMagnitude(actualValue);
      return expectedMagnitude > 0 && actualMagnitude > 0
        && Math.abs(expectedMagnitude - actualMagnitude) / Math.max(expectedMagnitude, actualMagnitude) <= 0.03;
    }
    if (group === 'platformVariants' && expectedValue.endsWith(':compatible')) {
      return actualValue.startsWith(`${expectedValue.split(':')[0]}:`);
    }
    return false;
  };
  for (const group of groups) {
    if (group === 'dimensions' && ladderDimensions) {
      conflicts.push(...ladderDimensions.conflicts);
      missing.push(...ladderDimensions.missing);
      matchedCount += ladderDimensions.matchedCount;
    }
    if (group === 'variantLabels' && exactModel) continue;
    const expectedSizeLabels = group === 'variantLabels' && expected.ringSizes !== undefined ? legacyRingSizeLabels(product.name) : [];
    const actualSizeLabels = group === 'variantLabels' && expected.ringSizes !== undefined && actual.ringSizes !== undefined ? legacyRingSizeLabels(candidateTitle) : [];
    const expectedValues = (expected[group] || []).filter((value) => !(group === 'dimensions' && ladderDimensions?.sourceFeet.includes(value))
      && !expectedSizeLabels.includes(value));
    const actualValues = (actual[group] || []).filter((value) => !(group === 'dimensions' && ladderDimensions?.candidateFeet.includes(value))
      && !actualSizeLabels.includes(value));
    if (group === 'dimensions' && ladderDimensions) {
      for (const value of ladderDimensions.sourceOtherFeet) if (!expectedValues.includes(value)) expectedValues.push(value);
      for (const value of ladderDimensions.candidateOtherFeet) if (!actualValues.includes(value)) actualValues.push(value);
    }
    if (!expectedValues.length) continue;
    const absent = expectedValues.filter((value) => !actualValues.some((candidate) => valueMatches(group, value, candidate)));
    if (absent.length) {
      if (actualValues.length) conflicts.push(`${group}:${absent.join(',')}`);
      else missing.push(`${group}:${absent.join(',')}`);
    }
    if (group === 'gpuModels' || group === 'cpuModels' || group === 'engineDisplacements' || group === 'horsepower' || group === 'motorFrames' || group === 'impactRates') {
      const unexpected = actualValues.filter((value) => !expectedValues.includes(value)
        && !expectedValues.some((expectedValue) => isLessSpecificShadow(expectedValue, value)));
      if (unexpected.length) conflicts.push(`${group}:unexpected-${unexpected.join(',')}`);
    }
    matchedCount += (expectedValues.length - absent.length) * (group === 'platformVariants' || group === 'seriesSignatures' ? 2 : 1);
  }
  const exclusiveFamilies = [
    ['kickball', 'football', 'soccer-ball', 'bounce-ball', 'other-ball'],
    ['vase', 'planter'],
    ['pasta-bowls', 'dinnerware-set'],
    ['neck-fan', 'handheld-fan'],
    ['steam-cleaner', 'cleaning-cloth'],
    ['irrigation-system', 'replacement-parts'],
    ['wd-my-passport', 'wd-purple', 'wd-red', 'wd-blue', 'wd-black'],
    ['seagate-backup-plus', 'seagate-expansion', 'seagate-barracuda'],
  ];
  for (const family of exclusiveFamilies) {
    const expectedFamily = family.find((value) => expected.productFamilies.includes(value));
    if (!expectedFamily) continue;
    const wrong = family.filter((value) => value !== expectedFamily && actual.productFamilies.includes(value));
    if (wrong.length) conflicts.push(`productFamilies:${expectedFamily}!=${wrong.join(',')}`);
  }
  return { matches: conflicts.length === 0 && missing.length === 0, matchedCount, conflicts, missing };
}

function criticalMissingDiscriminators(missing: string[]): string[] {
  return missing.filter((value) => /^(?:capacities|packageCounts|volumes|cubicCapacities|weightLimits|batteryCapacities|lensRanges|editions|platformVariants|engineDisplacements|horsepower|motorFrames|impactRates|actual-height|reach):/.test(value));
}

function collapseRepeatedQueryTokens(tokens: string[]): string[] {
  let output = [...tokens];
  let changed = true;
  while (changed) {
    changed = false;
    for (let blockLength = Math.floor(output.length / 2); blockLength >= 3 && !changed; blockLength -= 1) {
      for (let start = 0; start + (blockLength * 2) <= output.length; start += 1) {
        const left = output.slice(start, start + blockLength);
        const right = output.slice(start + blockLength, start + (blockLength * 2));
        if (left.every((token, index) => token === right[index])) {
          output = [...output.slice(0, start + blockLength), ...output.slice(start + (blockLength * 2))];
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
}

function collapseBoundaryQueryTokens(tokens: string[]): string[] {
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
}

const DETACHED_SUFFIX_GUARDS = new Set(['series', 'model', 'size', 'type', 'class', 'grade', 'gen', 'generation', 'lot']);
const DETACHED_PLURAL_NOUNS = new Set([
  'adapter', 'book', 'bowl', 'cable', 'camera', 'card', 'charger', 'console', 'controller',
  'cup', 'dish', 'doppler', 'drive', 'earbud', 'game', 'headphone', 'lamp', 'lens', 'light',
  'microphone', 'module', 'monitor', 'plate', 'printer', 'projector', 'receiver', 'router',
  'scanner', 'scrub', 'sensor', 'speaker', 'stand', 'switch', 'tablet', 'tool', 'unit', 'watch',
]);
const GENERIC_RESEARCH_TOKENS = new Set([
  'assorted', 'auction', 'description', 'estate', 'info', 'information', 'item', 'lot',
  'misc', 'miscellaneous', 'no', 'only', 'pickup', 'preview', 'reserve', 's', 'sale', 'see',
  'stock', 'tba', 'unknown', 'various',
]);

function stripResearchPrefixes(value: string): string {
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
    /^\s*\(?\s*(?:US\s*)?\$\s*[\d,]+(?:\.\d+)?\s*\)?\s*(?:[-:|]\s*)?/i,
    /^\s*\(?\s*USD\s*[\d,]+(?:\.\d+)?\s*\)?\s*(?:[-:|]\s*)?/i,
    /^\s*\$(?!\s*\d+\s*\/)\s*[\d,]+(?:\.\d+)?\s*(?:[-:|]\s*)?/i,
    /^\s*\(?\s*(?:open\s*box|refurbished|refurb|renewed|pre[\s-]?owned|used|brand\s+new|new\s+in\s+box)\s*\)?(?:\s*[-:,|]\s*|\s+)/i,
  ];
  for (let pass = 0; pass < 8; pass += 1) {
    const previous = output;
    // Remove presentation quotes and collapse a repeated raw title before
    // stripping its first inventory prefix. Otherwise only the first copy
    // loses prefixes such as "Vv3 $56", leaving the second copy as query noise.
    output = collapseExactRepeatedRawText(output.replace(/^["']+|["']+$/g, '').trim());
    output = output.replace(/^\s*([A-Za-z])([A-Za-z])\d{1,2}\s+/, (match, first: string, second: string) => (
      first !== second && first.toLowerCase() === second.toLowerCase() ? '' : match
    ));
    for (const pattern of patterns) {
      output = collapseExactRepeatedRawText(output.replace(pattern, '').trim());
    }
    if (output === previous) break;
  }
  return output;
}

function stripSellerResearchNote(value: string): string {
  return value
    .replace(/\s+(?:-\s+|[|,;]\s*)(?:owner|seller)\s+(?:stat(?:ed|es)?|says?)\b(.*)$/i, (_match, note: string) => {
      // Retain a directly appended specification, not a capacity mentioned later in seller prose.
      const spec = note.match(/^\s*(?:(?:like\s+new|new|used|open\s*box|untested)\s*,\s*)?(\d+(?:\.\d+)?\s*(?:gb|tb|mb|kb)\b(?:\s*[,;-]?\s*(?:wi[\s-]?fi|cellular))?)(?=\s*(?:$|[,;|]))/i)?.[1] || '';
      return spec ? ` ${spec}` : '';
    })
    .replace(/\s+(?:-\s+|[|,;]\s*)(?:relatively(?:\s+new)?|like\s+new)\b(?=\s*(?:[,;|]|$))/i, '')
    .trim();
}

function stripCorroboratedNonOperationalSuffix(value: string, sourceDescription: string): string {
  const suffix = value.match(/(?:^|\s|[-|,;])\(?\s*not\s+(ru(?:n(?:ning)?)?|sta(?:rt(?:ing)?)?)\s*\)?\s*$/i);
  if (!suffix || !sourceDescription) return value;
  const family = /^ru/i.test(suffix[1] || '') ? 'running' : 'starting';
  const source = sourceDescription.trim();
  const identityTokens = buildProductResearchQuery(value.slice(0, suffix.index ?? value.length))
    .split(/\s+/).filter((token) => token && !GENERIC_RESEARCH_TOKENS.has(token));
  const sourceClauses = source.split(/\r?\n|(?<=[.!?;])\s+|\s+\b(?:but|however|yet)\b\s+/i);
  const corroborated = sourceClauses.some((clause) => {
    if (!new RegExp(`\\bnot\\s+${family}\\b`, 'i').test(clause)
      || !hasPrimaryNonOperationalFault(clause)) return false;
    const faultIndex = clause.search(NON_OPERATIONAL_RE);
    const faultSubject = faultIndex >= 0
      ? clause.slice(0, faultIndex).split(/[,;]|\b(?:but|however|yet)\b/i).at(-1)?.trim() || ''
      : '';
    const subjectTokens = buildProductResearchQuery(faultSubject).split(/\s+/).filter(Boolean);
    if (!identityTokens.every((token) => subjectTokens.includes(token))) return false;
    if (COMPONENT_FAULT_RE.test(clause)) {
      const componentSubject = faultIndex >= 0
        ? [...clause.slice(0, faultIndex).matchAll(COMPONENT_SUBJECT_RE)].at(-1)?.[1]?.toLowerCase()
        : null;
      if (!componentSubject || !identityTokens.includes(componentSubject)) return false;
    }
    const clauseTokens = new Set(buildProductResearchQuery(clause).split(/\s+/).filter(Boolean));
    const anchors = [...new Set([identityTokens[0], ...identityTokens.filter((token) => /\d/.test(token))]
      .filter((token): token is string => Boolean(token)))];
    return anchors.every((token) => clauseTokens.has(token));
  });
  if (!corroborated) return value;
  return value.slice(0, suffix.index ?? value.length).trim().replace(/[-|,;]\s*$/, '').trim();
}

function stripResearchSuffixes(value: string): string {
  let output = stripSellerResearchNote(value.trim());
  // Auction titles often append an original-cost estimate after a seller's
  // marketing phrase. Remove the price first, then the slash-separated prose
  // that it clearly terminates; ordinary hyphenated product suffixes remain.
  const trailingCurrency = /\s*[-|,;]?\s*\(?\s*(?:US\s*)?\$\s*[\d,]+(?:\.\d+)?\s*\)?\s*$/i;
  const trailingCurrencyCode = /\s*[-|,;]?\s*\(?\s*USD\s*[\d,]+(?:\.\d+)?\s*\)?\s*$/i;
  const marketingTailBeforeCurrency = /\s+-\s+[^,;()]{3,80}\s*\/\s*[^,;()]{3,80}\s*$/i;
  if (trailingCurrency.test(output) || trailingCurrencyCode.test(output)) {
    output = output.replace(trailingCurrency, '').replace(trailingCurrencyCode, '').trim();
    output = output.replace(marketingTailBeforeCurrency, '').trim();
  }
  const suffix = /(?:\s*(?:[-|,;]\s*)|\s+)\(?\s*(?:tested(?:\s+and)?\s+working|not\s+tested|working|untested|open\s*box|brand\s+new\s+in\s+box|brand\s+new|new\s+in\s+box|in\s+box|nib|used|refurbished|refurb|renewed|pre[\s-]?owned|for\s+parts(?:\s+only)?|parts\s+only|as[\s-]*is|damaged|pickup\s+only|local\s+pickup\s+only|see\s+(?:photos?|pictures?|description)|read\s+description|no\s+reserve|online\s+only\s+auction|lot\s*#?\s*\d+)\s*\)?\s*$/i;
  // Require whitespace around a delimiter so attached model segments such as X-NWT survive.
  const tagConditionSuffix = /(?:\s+[-|,;]?\s*|[-|,;]\s+)\(?\s*(?:new\s+with\s+tags|new\s+without\s+tags|nwt|nwot|bnib)\s*\)?\s*$/i;
  for (let pass = 0; pass < 12; pass += 1) {
    const next = collapseExactRepeatedRawText(output.replace(suffix, '').replace(tagConditionSuffix, '').trim());
    if (next === output) break;
    output = next;
  }
  return output;
}

function collapseExactRepeatedRawText(value: string): string {
  let words = value.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  let changed = false;
  let found = true;
  while (found) {
    found = false;
    for (let blockLength = Math.floor(words.length / 2); blockLength >= 3 && !found; blockLength -= 1) {
      for (let start = 0; start + (blockLength * 2) <= words.length; start += 1) {
        const left = words.slice(start, start + blockLength);
        const right = words.slice(start + blockLength, start + (blockLength * 2));
        if (!left.every((word, index) => word === right[index])) continue;
        words = [...words.slice(0, start + blockLength), ...words.slice(start + (blockLength * 2))];
        changed = true;
        found = true;
        break;
      }
    }
  }
  return changed ? words.join(' ') : value;
}

function capResearchQueryTokens(tokens: string[], maxLength = 120): string[] {
  const usable = tokens.filter((token) => token.length <= maxLength);
  if (usable.join(' ').length <= maxLength) return usable;
  const essential = new Set<number>();
  usable.slice(0, 3).forEach((_, index) => essential.add(index));
  usable.slice(-2).forEach((_, index) => essential.add(Math.max(0, usable.length - 2 + index)));
  usable.forEach((token, index) => {
    if (/\d/.test(token) || /[+/]/.test(token)) essential.add(index);
  });
  const selected = [...essential].sort((left, right) => left - right);
  const lengthOf = (indexes: number[]) => indexes.reduce((total, index) => total + usable[index]!.length, 0) + Math.max(0, indexes.length - 1);
  while (selected.length > 1 && lengthOf(selected) > maxLength) {
    const removable = selected.findIndex((index, position) => position > 1 && position < selected.length - 2 && !/\d/.test(usable[index]!));
    selected.splice(removable >= 0 ? removable : selected.length - 2, 1);
  }
  for (let index = 0; index < usable.length; index += 1) {
    if (selected.includes(index)) continue;
    const candidate = [...selected, index].sort((left, right) => left - right);
    if (lengthOf(candidate) <= maxLength) selected.splice(0, selected.length, ...candidate);
  }
  return selected.map((index) => usable[index]!);
}

function isWeakResearchTitle(value: string): boolean {
  const clean = normalise(value).replace(/\s+/g, ' ').trim();
  if (!clean || /(?:\.{3}|…)\s*$/.test(clean)) return true;
  if (/^(?:lot|item)(?:\s*#?\s*:?\s*[\w.-]+)?$/i.test(clean)) return true;
  if (/^(?:see\s+(?:photos?|pictures?|description)|misc(?:ellaneous)?|various|assorted|unknown|n\/?a|tba|tv)$/i.test(clean)) return true;
  return buildProductResearchQuery(clean).split(/\s+/).filter((token) => !GENERIC_RESEARCH_TOKENS.has(token)).length < 2;
}

function repairDetachedPluralSuffixes(tokens: string[]): string[] {
  const repaired: string[] = [];
  for (const token of tokens) {
    const previous = repaired.at(-1) || '';
    if (token === 's'
      && DETACHED_PLURAL_NOUNS.has(previous)
      && !DETACHED_SUFFIX_GUARDS.has(previous)) {
      repaired[repaired.length - 1] = `${previous}s`;
    } else {
      repaired.push(token);
    }
  }
  return repaired;
}

export function buildProductResearchQuery(title: string | null | undefined): string {
  const original = normalise(title).replace(/\s+/g, ' ').trim();
  if (!original) return '';
  const gasDisplacement = /\b(?:gas|gasoline)\b/i.test(original) && /\b\d+(?:\.\d+)?\s*cc\b/i.test(original);

  let cleaned = collapseExactRepeatedRawText(original);
  for (let pass = 0; pass < 4; pass += 1) {
    const next = collapseExactRepeatedRawText(stripResearchPrefixes(stripResearchSuffixes(cleaned)));
    if (next === cleaned) break;
    cleaned = next;
  }
  let query = cleaned
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/(\d),(?=\d)/g, '$1')
    .replace(/\bw\s*\/\s*/gi, ' with ')
    .replace(/\b((?:18|19|20)\d0)'s\b/gi, '$1s')
    .replace(/\b([A-Za-z]{2,})'s\b/g, '$1s')
    .toLowerCase()
    .replace(/[()[\]{}]/g, ' ')
    .replace(/[^a-z0-9.+\/-]+/g, ' ');

  const tokens = capResearchQueryTokens(collapseBoundaryQueryTokens(collapseRepeatedQueryTokens(repairDetachedPluralSuffixes(query
    .split(/\s+/)
    .map((token) => token.replace(/^[.+\/-]+|[.\/-]+$/g, ''))
    .filter((token) => token && !RESEARCH_QUERY_NOISE.has(token) && !(gasDisplacement && token === 'cordless'))))));
  query = tokens.join(' ');

  if (!tokens.some((token) => !GENERIC_RESEARCH_TOKENS.has(token))) return '';
  return query;
}

function firstNumber(value: string): number | null {
  const match = value.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : null;
}

function fieldValue(fields: StringMap, ...names: string[]): string | null {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(fields, name)) return fields[name] ?? null;
  }
  return null;
}

function yesNo(value: string | null): boolean | null {
  if (value == null) return null;
  const lower = value.trim().toLowerCase();
  if (!lower) return null;
  if (/^(?:n\s*\/\s*a|n\.\s*a\.?|not\s*applicable|unknown|unspecified|unable|untested|not\s*tested|tbd|maybe|\?)/.test(lower)) return null;
  if (/^(?:y|yes|true|1)$/.test(lower) || /^yes\b/.test(lower)) return true;
  if (/^(?:n|no|false|0|none)$/.test(lower) || /^no\b/.test(lower)) return false;
  return null;
}

export function parseStructuredDescription(text: string | null | undefined): StructuredDescription {
  const fields: StringMap = {};
  const freeLines: string[] = [];
  for (const line of normalise(text).split('\n')) {
    const markerPattern = new RegExp(`(^|\\s+)(${STRUCTURED_FIELD_MARKER_SOURCE})\\s*(?:\\?\\s*:|:|\\?)\\s*`, 'gi');
    const markers: Array<{ start: number; valueStart: number; key: string }> = [];
    let marker: RegExpExecArray | null;
    while ((marker = markerPattern.exec(line)) !== null) {
      const prefix = marker[1] || '';
      markers.push({
        start: marker.index + prefix.length,
        valueStart: markerPattern.lastIndex,
        key: String(marker[2] || '').trim().toLowerCase().replace(/\s+/g, ' '),
      });
    }
    if (markers.length && !line.slice(0, markers[0]!.start).trim()) {
      markers.forEach((entry, index) => {
        const value = line.slice(entry.valueStart, markers[index + 1]?.start ?? line.length).trim();
        fields[entry.key] = value;
      });
      continue;
    }
    const embeddedProduct = markers.find((entry) => entry.key === 'product name');
    if (embeddedProduct && !fields['product name']) {
      const nextMarker = markers.find((entry) => entry.start > embeddedProduct.start);
      fields['product name'] = line.slice(embeddedProduct.valueStart, nextMarker?.start ?? line.length).trim();
    }
    const match = line.match(FIELD_LINE_RE);
    if (match && match[1]?.trim()) {
      const key = match[1].trim().toLowerCase().replace(/\s+/g, ' ');
      const value = (match[3] ?? '').replace(/^\s*:\s*/, '').trim();
      if (match[2] === '?' && !value) {
        freeLines.push(line);
      } else if (!KNOWN_STRUCTURED_FIELD_KEYS.has(key)) {
        fields[key] = value;
        freeLines.push(line);
      } else {
        fields[key] = value;
      }
    } else if (line.trim()) {
      freeLines.push(line);
    }
  }
  const freeText = freeLines.join('\n').trim();
  return { fields, freeText, free: freeText };
}

export function getLimitedTestingCautions(text: string | null | undefined): string[] {
  const value = text ?? '';
  const powerTest = String.raw`tested\s+for\s+power(?:[\s-]+on)?`;
  const patterns: ReadonlyArray<readonly [RegExp, string]> = [
    [/\buntested\b/gi, 'untested'],
    [/\bnot\s*(?:been\s+)?(?:(?<qualifier>fully|completely|thoroughly)\s+)?tested\b/gi, 'not tested'],
    [/\bunable\s+to\s+test\b/gi, 'unable to test'],
    [/\bpartially[\s-]+tested\b/gi, 'partially tested'],
    [/\blimited\s+(?:functional\s+)?testing\b/gi, 'limited testing'],
    [new RegExp(String.raw`\b(?:power(?:ed|s)?[\s-]+on[\s-]+only|only\s+${powerTest}|${powerTest}\s+only)\b`, 'gi'), 'power-on only'],
  ];
  const cautions = patterns.flatMap(([pattern, label]) => [...value.matchAll(pattern)].flatMap((match) => {
    // Negate each occurrence independently so later untested evidence survives.
    const beforeMatch = value.slice(0, match.index ?? 0);
    if (/\b(?:not|never|no)[ \t]*$/i.test(beforeMatch)) return [];
    return [match.groups?.qualifier ? `not ${match.groups.qualifier.toLowerCase()} tested` : label];
  }));
  const powerOn = /\b(?:power(?:s|ed)?|turns?)\s+on\b/i.exec(value);
  if (powerOn) {
    const beforePowerOn = value.slice(0, powerOn.index ?? 0).split(/\r?\n|[.!?;]/).at(-1) || '';
    const negated = /\b(?:not|never|no|doesn't|does\s+not|won't|will\s+not|can't|cannot)\s*$/i.test(beforePowerOn);
    const explicitFunctionalEvidence = hasSellerWorkingClaim(value)
      || hasCurrentUnitWorkingClaim(value, /\b(?:fully\s+tested|tested\s+(?:and\s+)?(?:fully\s+)?working|fully\s+functional|works?\s+(?:great|well|fine|perfectly)|(?:is\s+item\s+functional|item\s+functional|functional)\s*\??\s*:\s*yes)\b/i);
    if (!negated && !explicitFunctionalEvidence) cautions.push('power-on only');
  }
  return [...new Set(cautions)];
}

export function assessCondition(text: string | null | undefined, lotSubject = ''): ConditionAssessment {
  const parsed = parseStructuredDescription(text);
  const { fields, freeText } = parsed;
  const condition = fieldValue(fields, 'condition') ?? '';
  const damageDescription = fieldValue(fields, 'damage desct', 'damage desc', 'damage description', 'damage details') ?? '';
  const missingDescription = fieldValue(fields, 'missing parts desc', 'missing parts description', 'missing desc') ?? '';
  const notes = [fieldValue(fields, 'notes'), fieldValue(fields, 'note')].filter(Boolean).join(' ');
  const missingHardware = /\b(?:missing\s+(?:mounting\s+)?hardware|hardware\s+(?:is\s+)?missing)\b/i.test([notes, missingDescription].join(' '))
    && !/\b(?:no|not|without)\s+missing\s+(?:mounting\s+)?hardware\b/i.test([notes, missingDescription].join(' '));
  const damagedFlag = yesNo(fieldValue(fields, 'is item damaged', 'item damaged', 'damaged'));
  const missingFlag = yesNo(fieldValue(fields, 'missing major parts', 'missing parts', 'missing any parts'));
  const functionalText = fieldValue(fields, 'is item functional', 'item functional', 'functional', 'working') || '';
  const functionalFlag = yesNo(functionalText);
  const conditionFreeText = freeText.split('\n')
    .filter((line) => !/^\s*(?:shipping|pickup|payment|buyer\s+premium|auction|lot|bid|retail|msrp|location|shelf\s+location|quantity|sku|item(?:\s+number)?)(?:\s+(?:terms?|policy|information|details?|notice))?\s*[:?]/i.test(line))
    .join('\n');
  const uncertaintyText = [condition, functionalText, notes, conditionFreeText].filter(Boolean).join('\n');
  const limitedTestingCautions = getLimitedTestingCautions(uncertaintyText);
  const explicitPowerOnOnly = /\b(?:power(?:ed|s)?[\s-]+on[\s-]+only|only\s+tested\s+for\s+power(?:[\s-]+on)?|tested\s+for\s+power(?:[\s-]+on)?\s+only)\b/i.test(uncertaintyText);
  const functionalUncertain = limitedTestingCautions.some((caution) => caution !== 'power-on only'
    || functionalFlag !== true
    || explicitPowerOnOnly)
    || (Boolean(functionalText.trim()) && functionalFlag !== true && /\b(?:power(?:s|ed)?|turns?)\s+on\b/i.test(uncertaintyText))
    || /\b(?:unknown|n\s*\/\s*a|unspecified)\b/i.test(functionalText);
  const scan = [condition, damageDescription, missingDescription, functionalText, notes, conditionFreeText].filter(Boolean).join('\n');
  const missingMajorComponentNames = missingMajorComponents(scan);
  const evidence = [damageDescription, missingDescription, notes, conditionFreeText].filter(Boolean).join('\n');
  const evidenceClauses = evidence
    .split(/(?<=[.!?;])\s+|\s+\b(?:but|however|yet)\b\s+/i)
    .map((clause) => clause.trim())
    .filter(Boolean);
  const missingClosureHardware = evidenceClauses.some((clause) => [...clause.matchAll(
    /\b(?:missing\s+(?:(?:the|a|an|any|one|both|all|closing|closure)\s+)*(?:clamps?|latch(?:es)?)|(?:clamps?|latch(?:es)?)\s+(?:(?:are|is)\s+)?missing)\b/gi,
  )].some((match) => !/\b(?:no|not|without)\s*$/i.test(clause.slice(0, match.index ?? 0))));
  const componentFaultPattern = /\b(?:function|feature|self[-\s]?propelled|drive|button|switch|display|screen|nozzle|fan|pump|battery|charger|speaker)\b(?:\s+(?:is|are|was|were|still|currently|now|also|function|feature)){0,3}\s+(?:does\s+not|doesn't|not|won['’]?t|will\s+not)\s+(?:work(?:ing)?|function|operate|turn\s+on|power|run(?:ning)?|start(?:ing)?)\b/gi;
  const affirmativePrimaryOperationPattern = /\b(?:the\s+)?(?:item|mower|machine|unit|device|product|it)\b[^.!?;]{0,20}\b(?:still\s+)?(?:runs?|works?|mows?|operates?|powers?\s+on)\b/i;
  const subjectTokens = buildProductResearchQuery(lotSubject).split(/\s+/)
    .filter((token) => token && !GENERIC_RESEARCH_TOKENS.has(token) && token.length >= 4);
  const hasAffirmativePrimaryOperation = (clause: string): boolean => {
    const match = affirmativePrimaryOperationPattern.exec(clause);
    if (!match) return false;
    if (/\b(?:another|different|other|separate)\s+(?:item|machine|unit|device|product|mower)\b/i.test(clause)) return false;
    const genericSubject = /\b(?:item|mower|machine|unit|device|product|it)\b/i.test(match[0]);
    const linkedSubject = genericSubject || subjectTokens.some((token) => buildProductResearchQuery(match[0]).split(/\s+/).includes(token));
    if (!linkedSubject) return false;
    const operation = /\b(?:still\s+)?(?:runs?|works?|mows?|operates?|powers?\s+on)\b/i.exec(match[0]);
    if (!operation) return false;
    const beforeOperation = match[0].slice(0, operation.index);
    return !/(?:^|\s)(?:never|not|doesn't|does\s+not|don't|do\s+not)\s*$/i.test(beforeOperation);
  };
  let partialComponentFault = false;
  const scopeComponentAssertions = (clauses: string[]): string[] => clauses.map((clause, index) => {
    const primaryOperates = hasAffirmativePrimaryOperation(clause)
      || hasAffirmativePrimaryOperation(clauses[index + 1] || '')
      || hasAffirmativePrimaryOperation(clauses[index - 1] || '');
    if (!primaryOperates) return clause;
    // Remove only the corroborated component fault, not other faults in its clause.
    return clause.replace(componentFaultPattern, (assertion) => {
      const component = assertion.match(COMPONENT_SUBJECT_RE)?.[0]?.toLowerCase();
      if (nonOperationalUncertainty(assertion) || (component && subjectTokens.includes(component))) return assertion;
      partialComponentFault = true;
      return '';
    });
  });
  const scopedEvidenceClauses = scopeComponentAssertions(evidenceClauses);
  const conditionClauses = condition.split(/\r?\n|(?<=[.!?;])\s+|\s+\b(?:but|however|yet)\b\s+/i).filter(Boolean);
  const scopedCondition = scopeComponentAssertions(conditionClauses).join('\n');
  const conditionNonOperational = hasPrimaryNonOperationalFault(scopedCondition);
  const conditionParts = CONDITION_PARTS_RE.test(scopedCondition);
  const goodCondition = CONDITION_GOOD_RE.test(condition) && !conditionParts && !conditionNonOperational;
  const partsReasons: string[] = [];
  if (conditionParts || conditionNonOperational) partsReasons.push(`Condition: ${condition.trim()}`);
  const standaloneNonOperationalPattern = /\bnot\s+(?:running|starting)\b|\b(?:does\s+not|doesn't|won['’]?t|will\s+not)\s+(?:run|start)\b/i;
  const partPatterns: ReadonlyArray<readonly [RegExp, string]> = [
    [/\bfor\s*parts\s*(?:only)?\b/i, 'listed for parts only'],
    [/\bparts\s*(?:only|\/\s*repair)\b/i, 'parts only'],
    [/\bnot\s*working\b/i, 'stated not working'],
    [standaloneNonOperationalPattern, 'stated not running or starting'],
    [/\bdoes\s*not\s*(?:work|turn on|power)/i, 'does not work / power on'],
    [/\b(?:will|does|do|did|can|could|is)\s+not\s+(?:fully\s+)?(?:function(?:ing|al)?|work(?:ing)?|operate)\b/i, 'stated not fully functioning'],
    [/\bnon[\s-]*functional\b/i, 'non-functional'],
    [/\bbroken\b/i, 'described as broken'],
    [/\bshattered\b/i, 'shattered'],
    [/\bcracked\b/i, 'cracked'],
    [/\bsalvage\b/i, 'salvage'],
    [/\bdefective\b/i, 'defective'],
    [/\bdamaged\b/i, 'damaged'],
    [/\bfor\s*repair\b/i, 'for repair'],
    [/\bas[\s-]*is[\s,]*no\s*returns?\b/i, 'as-is, no returns'],
    [/\bincomplete\b/i, 'incomplete'],
    [/\bmissing\s*(?:parts|pieces|components)\b/i, 'missing parts'],
  ];
  for (const [pattern, label] of partPatterns) {
    const matchesIndependentClause = scopedEvidenceClauses.some((clause) => pattern.test(clause)
      && (pattern !== standaloneNonOperationalPattern || (!nonOperationalUncertainty(clause) && !nonOperationalNegation(clause))));
    if (matchesIndependentClause) partsReasons.push(label);
  }

  const damageReasons: string[] = [];
  if (damagedFlag === true) {
    damageReasons.push(damageDescription ? `auctioneer reports damage: "${damageDescription.trim()}"` : 'structured field: Is Item Damaged? = Yes');
  }
  if (missingFlag === true) {
    damageReasons.push(missingDescription ? `parts missing: "${missingDescription.trim()}"` : 'structured field: Missing Major Parts? = Yes');
  }
  if (functionalFlag === false && (damageReasons.length > 0 || partsReasons.length > 0 || !goodCondition)) {
    damageReasons.push('structured field: Is Item Functional? = No');
  }
  const partsOnly = partsReasons.length > 0;
  const repairRisk = hasLotSpecificRepairRisk(scan);
  const sellerWorkingClaim = hasSellerWorkingClaim([condition, notes, freeText].filter(Boolean).join('\n'));
  const operationalPositive = hasCurrentUnitWorkingClaim([condition, notes, freeText].filter(Boolean).join('\n'), OPERATIONAL_POSITIVE_RE);
  const positive = !partsOnly && !functionalUncertain && !missingHardware && !missingClosureHardware && !repairRisk
    && missingMajorComponentNames.length === 0
    && (CONDITION_GOOD_RE.test(condition) || NEW_CONDITION_EVIDENCE_RE.test([notes, freeText].join('\n')) || operationalPositive || sellerWorkingClaim || functionalFlag === true);
  const cautionPatterns: ReadonlyArray<readonly [RegExp, string]> = [
    [/\bopen\s*box\b/i, 'open box'],
    [/\breturn(?:ed|s)?\b/i, 'customer return'],
    [/\bscratch(?:ed|es)?\b/i, 'scratched'],
    [/\bdent(?:ed|s)?\b/i, 'dented'],
    [/\brefurbish(?:ed)?\b/i, 'refurbished'],
    [/\bused\b/i, 'used'],
    [/\b(?:pins?|contacts?)\s+(?:appear|seem)\s+(?:slightly\s+)?bent\b/i, 'possible bent pins'],
  ];
  const missingKnobPattern = /\b(?:missing\s+(?:(?:all|some|a\s+few|a|an|the|one|two|three|several|\d+)\s+)?knobs?|without\s+knobs?|knobs?\s+(?:(?:are|is)\s+)?(?:missing|not\s+included|not\s+present|absent|unavailable))\b/gi;
  const missingKnobs = scan
    .split(/[\r\n.!?;,]|\b(?:but|however|yet)\b/i)
    .some((clause) => [...clause.matchAll(missingKnobPattern)].some((match) => {
      const before = clause.slice(0, match.index ?? 0);
      const after = clause.slice((match.index ?? 0) + match[0].length);
      return !/^\s*(?:included|present|supplied|provided|attached)\b/i.test(after)
        && !/\b(?:no|not|never|without)\s*$/i.test(before);
    }));
  const replacementNeed = evidenceClauses.some((clause) => /\b(?:needs?|requires?)\s+(?:a\s+)?(?:new|replacement)\s+[a-z][a-z -]{1,30}\b/i.test(clause)
    && !/\b(?:does\s+not|doesn't|do\s+not|never|no\s+longer)\s+(?:need|require)\b/i.test(clause));
  let cautions = [
    ...getLimitedTestingCautions(scan).filter((caution) => !(caution === 'power-on only'
      && functionalFlag === true
      && !/\b(?:power(?:ed|s)?[\s-]+on[\s-]+only|only\s+tested\s+for\s+power(?:[\s-]+on)?|tested\s+for\s+power(?:[\s-]+on)?\s+only)\b/i.test(scan))),
    ...cautionPatterns.filter(([pattern]) => pattern.test(scan)).map(([, label]) => label),
    ...(repairRisk ? ['possible repair'] : []),
    ...(replacementNeed ? ['needs replacement part'] : []),
    ...(missingHardware || missingClosureHardware ? ['missing hardware'] : []),
    ...(missingKnobs ? ['missing knobs'] : []),
    ...missingMajorComponentNames.map((name) => `missing major component: ${name}`),
    ...(partialComponentFault ? ['partial component defect'] : []),
  ];
  if (positive) cautions = cautions.filter((label) => label !== 'used');
  if (condition && !goodCondition && !CONDITION_PARTS_RE.test(condition)) cautions.unshift(`condition: ${condition.trim().toLowerCase()}`);
  const damaged = !partsOnly && damageReasons.length > 0 && !goodCondition;
  if (damageReasons.length > 0 && (goodCondition || partsOnly)) cautions = damageReasons.concat(cautions);
  const unique = (items: string[]) => [...new Set(items)];
  return {
    partsOnly,
    partsReasons: unique(partsReasons),
    damaged,
    damageReasons: damaged ? unique(damageReasons) : [],
    cautions: unique(cautions),
    positive,
    condition,
    fields,
    freeText,
  };
}

export function buildConditionPresentation(assessment: ConditionAssessment): ConditionPresentation {
  const stated = assessment.condition.trim();
  const lower = stated.toLowerCase();
  // assessCondition has already excluded operational fields such as shipping policy.
  const limitedTesting = assessment.cautions.filter((caution) => [
    'untested', 'not tested', 'not fully tested', 'not completely tested',
    'not thoroughly tested', 'unable to test', 'partially tested',
    'limited testing', 'power-on only',
  ].includes(caution));
  const missingParts = yesNo(fieldValue(assessment.fields, 'missing major parts', 'missing parts', 'missing any parts')) === true;
  let label = 'Condition ?';
  let tone: ConditionPresentation['tone'] = 'unknown';
  if (assessment.partsOnly) {
    label = assessment.partsReasons.includes('stated not fully functioning') ? 'Functional issue' : 'Parts only';
    tone = 'danger';
  } else if (assessment.damaged) {
    label = 'Damaged';
    tone = 'danger';
  } else if (/\b(?:factory|new)[\s-]*sealed\b|\bsealed\b/.test(lower)) {
    label = 'New · sealed';
    tone = 'good';
  } else if (/\b(?:brand[\s-]*)?new\b/.test(lower) && /\bpackag(?:e|ing)\s+flawed\b|\bflawed\s+packag/i.test(lower)) {
    label = 'New · packaging flawed';
    tone = 'warning';
  } else if (/\bopen[\s-]*box\b/.test(lower)) {
    label = 'Open box';
    tone = 'warning';
  } else if (/\b(?:brand[\s-]*)?new\b/.test(lower)) {
    label = 'New';
    tone = 'good';
  } else if (/\blike[\s-]*new\b|\bexcellent\b/.test(lower)) {
    label = 'Like new';
    tone = 'good';
  } else if (/\bused\b/.test(lower) && /\bvery\s+good\b/.test(lower)) {
    label = 'Used · very good';
    tone = 'good';
  } else if (/\bused\b/.test(lower)) {
    label = 'Used';
    tone = 'warning';
  } else if (/\bfair\b|\bpoor\b/.test(lower)) {
    label = /\bpoor\b/.test(lower) ? 'Poor' : 'Fair';
    tone = 'warning';
  } else if (/\bgood\b/.test(lower)) {
    label = 'Good';
    tone = 'good';
  } else if (assessment.cautions.length) {
    const caution = assessment.cautions[0]!.replace(/^condition:\s*/i, '').trim();
    const compact = /expected\s+wear\s*(?:&|and)\s*tear\s+for\s+age/i.test(caution)
      ? 'Normal age wear'
      : caution.replace(/^./, (value) => value.toUpperCase());
    label = compact.length > 24 ? compact.slice(0, 25).replace(/\s+\S*$/, '').trim() : compact || 'Review condition';
    tone = 'warning';
  } else if (assessment.positive) {
    label = 'Functional';
    tone = 'good';
  } else if (stated) {
    label = stated.length > 24 ? stated.slice(0, 25).replace(/\s+\S*$/, '').trim() : stated;
    tone = 'warning';
  }

  if (!assessment.partsOnly && !assessment.damaged && missingParts) {
    label = `${label} · parts missing`;
    tone = 'danger';
  } else if (!assessment.partsOnly && !assessment.damaged && assessment.cautions.some((caution) => caution.startsWith('missing major component:'))) {
    label = `${label} · parts missing`;
    tone = 'danger';
  } else if (!assessment.partsOnly && !assessment.damaged && assessment.cautions.includes('missing hardware')) {
    label = `${label} · hardware missing`;
    tone = 'danger';
  } else if (!assessment.partsOnly && !assessment.damaged && limitedTesting.length > 0) {
    const qualifier = limitedTesting.some((value) => ['untested', 'not tested', 'unable to test'].includes(value))
      ? 'untested'
      : limitedTesting[0]!;
    if (!label.toLowerCase().includes(qualifier)) label = `${label} · ${qualifier}`;
    if (tone === 'good' || tone === 'unknown') tone = 'warning';
  } else if (!assessment.partsOnly && !assessment.damaged && assessment.cautions.includes('possible repair')) {
    label = `${label} · repair risk`;
    tone = 'warning';
  }

  const fields = assessment.fields;
  const evidence = [
    ['Packaging', fieldValue(fields, 'in packaging', 'packaging')],
    ['Damaged', fieldValue(fields, 'is item damaged', 'item damaged', 'damaged')],
    ['Functional', fieldValue(fields, 'is item functional', 'item functional', 'functional', 'working')],
    ['Missing parts', fieldValue(fields, 'missing major parts', 'missing parts', 'missing any parts')],
  ].flatMap(([name, value]) => {
    const cleaned = String(value || '').replace(/^[\s:?-]+/, '').trim();
    return cleaned ? [`${name}: ${cleaned}`] : [];
  });
  const notes = [...assessment.partsReasons, ...assessment.damageReasons, ...assessment.cautions];
  const title = [
    `Condition: ${stated || 'not stated'}`,
    ...evidence,
    ...notes,
  ].filter(Boolean).join(' · ');
  return { label, tone, title };
}

export function looksLikeModel(value: string | null | undefined): boolean {
  const model = String(value ?? '').trim();
  return model.length >= 2 && model.length <= 24 && !GENERIC_MODEL_RE.test(model)
    && !INTERFACE_ONLY_MODEL_RE.test(model)
    && !/[*?,]/.test(model)
    && (/\d/.test(model) || MODEL_ALT_RE.test(model) || ALPHA_MODEL_RE.test(model));
}

export function compactTokens(value: string | null | undefined): string[] {
  return normalise(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
}

export function modelMatches(title: string | null | undefined, model: string | null | undefined): boolean {
  const target = String(model ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!target) return false;
  const tokens = compactTokens(title);
  for (let start = 0; start < tokens.length; start += 1) {
    let joined = '';
    for (let end = start; end < tokens.length; end += 1) {
      joined += tokens[end];
      if (joined.length > target.length) break;
      if (joined === target) return true;
    }
  }
  return false;
}

const CARVIN_PRO_BASS_MODEL_RE = /\bcarvin\s+pro\s+bass\s+(\d{2,4}|bx\d{2,4})\b/gi;
const CARVIN_PRO_BASS_150_MODEL = 'Carvin Pro Bass 150';

function carvinProBassPrimaryIdentity(value: string): { model: string | null; conflict: boolean } {
  const primary = normalise(value).split(/\b(?:compatible\s+with|replacement\s+for|designed\s+for|made\s+for|for\s+use\s+with|fits?|works?\s+with)\b|\b(?:with|including|includes?|plus|without|no|missing)\b/i, 1)[0] || '';
  const models = [...primary.matchAll(CARVIN_PRO_BASS_MODEL_RE)].map((match) => match[1]!.toLowerCase());
  models.push(...[...primary.matchAll(/\bcarvin\s+(bx\d{2,4})\b/gi)].map((match) => match[1]!.toLowerCase()));
  if (/\bcarvin\s+pb\s*150\s+pro\s+bass\s+head\b/i.test(primary)) models.push('150');
  if (models.length) {
    for (const alternate of primary.matchAll(/(?:[/,&]|\b(?:or|and)\b)\s*(?:carvin\s+)?(?:pro\s+bass\s+)?(\d{2,4}|pb\d{2,4}|bx\d{2,4})\b/gi)) {
      const suffix = primary.slice((alternate.index ?? 0) + alternate[0].length);
      if (/^\d+$/.test(alternate[1]!) && /^\s*(?:["']|(?:x|\u00d7|by)\s*\d|(?:in(?:ch(?:es)?)?|cm|mm|ft|feet|lbs?|pounds?|kg|g|oz|watts?|w|ohms?|years?)\b)/i.test(suffix)) continue;
      models.push(alternate[1]!.toLowerCase().replace(/^pb/, ''));
    }
  }
  const unique = [...new Set(models)];
  return { model: unique.length === 1 ? `Carvin Pro Bass ${unique[0]!.toUpperCase()}` : null, conflict: unique.length > 1 };
}

function carvinProBass150Rejection(title: string, product: ProductIdentity): string | null {
  const source = carvinProBassPrimaryIdentity(product.name);
  if (source.conflict || product.discriminators.variantLabels.includes('carvin-pro-bass:source-conflict')) return 'identity-conflict:carvin-pro-bass-source';
  if (source.model !== CARVIN_PRO_BASS_150_MODEL) return null;
  const candidate = carvinProBassPrimaryIdentity(title);
  if (candidate.conflict || candidate.model !== CARVIN_PRO_BASS_150_MODEL) return 'model-mismatch:Carvin Pro Bass 150';
  if (/\b(?:compatible\s+with|replacement\s+for|designed\s+for|made\s+for|for\s+use\s+with|fits?|works?\s+with)\b/i.test(title)) return 'identity-scope:carvin-pro-bass-primary';
  const primarySubject = title.split(/\bw\s*\/|\b(?:with|including|includes?|plus|without|no|missing)\b/i, 1)[0] || '';
  if (/\b(?:replacement\s+knobs?|knob\s+set|set\s+of\s+knobs?|knobs?\s+only)\b/i.test(primarySubject)) return 'accessory-or-component';
  if (/\b(?:replacement|compatible|accessor(?:y|ies)|parts?|knob(?:s)?\s+only)\b/i.test(title) && !/\b(?:amplifier|amp|head)\b/i.test(title)) return 'accessory-or-component';
  return null;
}

function carvinProBass150AliasMatches(title: string, product: ProductIdentity): boolean {
  return product.model === CARVIN_PRO_BASS_150_MODEL
    && /\bcarvin\s+pb\s*150\s+pro\s+bass\s+head\b/i.test(title);
}

function carvinProBass150StructuredAlias(value: string): boolean {
  return /^pb\s*150$/i.test(value.trim());
}

function applePencilSecondGenerationModelCodeMatches(title: string, code: string): boolean {
  return modelMatches(title, code) || (code.endsWith('/A') && modelMatches(title, code.slice(0, -2)));
}

function applePencilVariantContradiction(title: string): boolean {
  const pencil = /\bapple\s+pencils?\b/i.exec(title);
  if (!pencil) return false;
  const productSegment = title.slice(pencil.index + pencil[0].length).split(/\b(?:compatible\s+with|works?\s+with|for\s+use\s+with|for)\b/i, 1)[0] || '';
  return /\b(?:usb[\s-]*c|pro)\b/i.test(productSegment);
}

function applePencilSecondGenerationModelAliasMatches(title: string, product: ProductIdentity): boolean {
  if (product.kind !== 'stylus' || !/\bapple\s+pencils?\b/i.test(product.name)) return false;
  if (!product.model || !APPLE_PENCIL_SECOND_GENERATION_MODEL_CODES.some((code) => applePencilSecondGenerationModelCodeMatches(product.model!, code))) return false;
  const candidateEditions = extractProductDiscriminators(title).editions;
  if (candidateEditions.some((edition) => edition.startsWith('stylus-generation:') && edition !== 'stylus-generation:2')) return false;
  if (applePencilVariantContradiction(title)) return false;
  return APPLE_PENCIL_SECOND_GENERATION_MODEL_CODES.some((code) => applePencilSecondGenerationModelCodeMatches(title, code));
}

function tokeniseIdentity(value: string): string[] {
  return value.split(/[\s,;/]+/).filter(Boolean).map((token) => token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9+.-]+$/g, '')).filter(Boolean);
}

function tabletWithBuiltInMemorySpecs(source: string, tablet: RegExpExecArray | null | undefined): boolean {
  if (!tablet) return false;
  // Specs and the tablet noun must belong to the product, not its compatibility target.
  const compatibility = new RegExp(`\\b(?:${FOR_PRODUCT_VERBS}|for(?!\\s+(?:kids|children)\\b))\\b`, 'i').exec(source);
  const includedAccessory = new RegExp(`\\b(?:with|includes?|including|plus|bundled\\s+with)\\s+(?:(?:an?|the|spare|replacement)\\s+){0,3}(?:${ACCESSORY_NOUN_RE.source}|processors?|soc|accessor(?:y|ies)\\b)`, 'i');
  const primary = source.slice(0, compatibility?.index ?? source.length).split(includedAccessory, 1)[0] || '';
  if (tablet.index >= primary.length) return false;
  const ssd = /\bssds?\b/i.exec(primary);
  const chip = /\bchips?\b/i.exec(primary);
  const builtInProcessor = /\b(?:m[1-4](?:\s+(?:pro|max|ultra))?|a\d{1,2}(?:\s+(?:bionic|fusion))?|a-series)\s+(?:chips?|processors?|soc)\b|\b(?:built[- ]in|integrated)\s+(?:processors?|soc)\b/i.test(primary);
  const chipIsComponentSubject = Boolean(chip && (!builtInProcessor
    || /\b(?:only|standalone|replacement|spare|module|accessor(?:y|ies))\b/i.test(primary)));
  if ((ssd && ssd.index < tablet.index)
    || /\b(?:ram|memory|ddr[345])\s+(?:replacement\s+)?(?:modules?|sticks?|cards?|kits?)\b/i.test(primary)
    || /\b(?:so[\s-]?)?dimms?\b/i.test(primary)
    || chipIsComponentSubject
    || /\b(?:memory|ram|storage)\s+cards?\b/i.test(primary)
    || /\b(?:accessor(?:y|ies)|replacement|spare)\b/i.test(primary)) return false;
  return /\b\d+(?:\.\d+)?\s*(?:gb|tb|mb)\s+(?:ram|memory|ddr[345]|rom|storage|ssd|emmc|flash)\b/i.test(primary)
    || /\b(?:ram|memory|ddr[345]|rom|storage|ssd|emmc|flash)\s*[:=]?\s*\d+(?:\.\d+)?\s*(?:gb|tb|mb)\b/i.test(primary);
}

export function detectProductKind(value: string | null | undefined): ProductKind | null {
  const source = normalise(value);
  if (/\b(?:vital\s+signs?|patient)\s+monitors?\b/i.test(source)) return null;
  if (/\bfood\s+processors?\b/i.test(source)) return null;
  if (/^\s*(?:nintendo\s+)?switch(?:\s+oled)?\b/i.test(source)
    && !/\b(?:case|cover|game|replacement|screen\s+protector)\b/i.test(source)) return 'game-console';
  const stylus = PRODUCT_KIND_PATTERNS.find(([kind]) => kind === 'stylus')?.[1].exec(source);
  const tablet = PRODUCT_KIND_PATTERNS.find(([kind]) => kind === 'tablet')?.[1].exec(source);
  if (stylus && (!tablet || stylus.index <= tablet.index)) return 'stylus';
  if (tabletWithBuiltInMemorySpecs(source, tablet)) return 'tablet';
  return PRODUCT_KIND_PATTERNS.find(([, pattern]) => pattern.test(source))?.[0] ?? null;
}

function stripStructuredProductTail(value: string): string {
  return value.split(/\s*(?:;|\b(?:compatible\s+with|replacement\s+for|designed\s+for|made\s+for|for\s+use\s+with|fits)\b)/i, 1)[0]?.trim() ?? '';
}

function descriptionIdentityCandidate(parsed: StructuredDescription, statedModel: string): string {
  const statedProduct = stripStructuredProductTail(fieldValue(parsed.fields, 'product name', 'product', 'title', 'lead') || '');
  const statedBrand = fieldValue(parsed.fields, 'brand', 'manufacturer', 'make') || '';
  const structured = [statedBrand, statedProduct, statedModel]
    .map((value) => value.trim())
    .filter((value, index, values) => value && values.findIndex((candidate) => candidate.toLowerCase() === value.toLowerCase()) === index)
    .join(' ')
    .trim();
  if (structured.length >= 3) return structured;
  const prose = parsed.freeText
    .split(/\n|(?<=[.!?])\s+/)
    .map((value) => value.replace(/\s+/g, ' ').trim())
    .find((value) => value.length >= 3 && !/^(?:condition|notes?|shelf|pickup|shipping|payment)\b/i.test(value));
  return (prose || '').slice(0, 500);
}

function extractExplicitDescriptionModels(value: string, title: string): string[] {
  const models: string[] = [];
  const modelLabel = 'model(?:\\s+(?:name|number|no\\.?))?|mpn';
  const pattern = new RegExp(
    `\\b(?:${modelLabel})\\s*(?:#\\s*:?[ \\t]*|:[ \\t]*)([^\\n;|]*?)(?=\\s+(?:${STRUCTURED_FIELD_MARKER_SOURCE}|battery)\\s*(?:\\?|:)|[\\n;|]|$)`,
    'gi',
  );
  const productFieldSequence = new RegExp(
    `^(?:(?:brand|manufacturer|make|${modelLabel})\\s*(?:#\\s*:?[ \\t]*|:[ \\t]*)[A-Za-z0-9+./%& -]+?\\s+)+$`,
    'i',
  );
  const structuredFieldSequence = new RegExp(
    `^(?:(?:${STRUCTURED_FIELD_MARKER_SOURCE}|star rating)\\s*(?:\\?\\s*:|:|\\?)\\s*[^:?#\\n]*?\\s+)+$`,
    'i',
  );
  const finalProductField = new RegExp(
    `(?:^|\\s)(?:brand|manufacturer|make|${modelLabel})\\s*(?:#\\s*:?[ \\t]*|:[ \\t]*)[A-Za-z0-9+./%& -]+?\\s+$`,
    'i',
  );
  for (const match of value.matchAll(pattern)) {
    const prefix = value.slice(0, match.index ?? 0);
    const currentLine = prefix.slice(Math.max(prefix.lastIndexOf('\n'), prefix.lastIndexOf('|'), prefix.lastIndexOf(';')) + 1);
    // Only standalone fields, product-field streams, or a numeric product
    // specification may introduce a model; prose in other fields cannot.
    const followsProductSpecification = /(?:^|\s)data\s+transfer\s+rate:\s*\d+(?:\.\d+)?\s*(?:[kmg]bps|mb\/s)\s+$/i.test(currentLine)
      && /\b(?:dock|hub|cable|computer|drive|router)\b/i.test(title);
    const followsStructuredProductField = structuredFieldSequence.test(currentLine.trimStart())
      && finalProductField.test(currentLine);
    if (currentLine.trim() && !productFieldSequence.test(currentLine.trimStart())
      && !followsStructuredProductField && !followsProductSpecification) continue;
    const candidate = String(match[1] || '').trim();
    const keurigModels = /\bkeurig\b/i.test(`${title} ${value}`) ? keurigNamedModelsInPrimary(candidate) : [];
    if (keurigModels.length) {
      for (const model of keurigModels) {
        if (!models.some((candidateModel) => compactIdentityText(candidateModel) === compactIdentityText(model))) models.push(model);
      }
      continue;
    }
    const namedModels = /\balesis\b/i.test(`${title} ${value}`)
      && /^(?:alesis\s+)?midiverb\s+(?:ii|iii|iv|2|3|4)(?:\s*\(?\s*(?:\/|,|&|-|\band\b|\bor\b)\s*(?:(?:alesis\s+)?midiverb\s+)?(?:ii|iii|iv|2|3|4)\s*\)?)*$/i.test(candidate)
      ? alesisMidiverbEvidence(candidate).models : [];
    if (namedModels.length) {
      for (const model of namedModels) if (!models.includes(model)) models.push(model);
      continue;
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9+./%-]*(?:\s+[A-Za-z0-9+./%-]+)*$/.test(candidate)) continue;
    if (/\s/.test(candidate) && !modelMatches(title, candidate)) continue;
    if (looksLikeModel(candidate) && !models.some((model) => compactIdentityText(model) === compactIdentityText(candidate))) {
      models.push(candidate);
    }
  }
  return models;
}

function knownLeadingBrand(value: string): string | null {
  return value.match(/^(?:Allen[\s-]Bradley|Amazon\s+Basics|B\.?\s*Braun|Bang\s*(?:&|and)\s*Olufsen|Black\s*(?:\+|&|and)\s*Decker|Bowers\s*(?:&|and)\s*Wilkins|Hamilton\s+Beach|Hewlett[\s-]Packard|Robot\s+Coupe|Smith\s*\+\s*Nephew|Square\s+D|Western\s+Digital)\b/i)?.[0] || null;
}

function compactIdentityText(value: string): string {
  return compactTokens(value).join('');
}

function stripArtistBiographyFromInference(value: string): string {
  const yearSpan = /\b(?:18|19|20)\d{2}\s*(?:[-\u2013\u2014]\s*|to\s+)(?:18|19|20)\d{2}\b/i;
  const nationality = /^(?:american|british|canadian|french|german|italian|spanish|dutch|russian|polish|mexican|australian|irish|scandinavian|[a-z]+(?:ian|ese|ish))$/i;
  const biographyMarker = /^(?:born|died|b|d)\.?$/i;
  return value.replace(/\s*\(([^()]*)\)/g, (match, content: string) => {
    const span = content.match(yearSpan)?.[0];
    if (!span) return match;
    const metadataTokens = content.replace(yearSpan, '').replace(/[(),;:]/g, ' ').split(/\s+/).filter(Boolean);
    const metadataOnly = metadataTokens.length > 0
      && metadataTokens.every((token) => nationality.test(token) || biographyMarker.test(token));
    return metadataOnly ? ' ' : match;
  }).replace(/\s{2,}/g, ' ').trim();
}

function isIsbnLikeToken(value: string): boolean {
  const digits = value.replace(/[^0-9Xx]/g, '');
  return digits.length === 10 || (digits.length === 13 && /^97[89]/.test(digits));
}

function isMeasurementLikeModelToken(value: string): boolean {
  return /^\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?[\s-]*(?:v|w|watt|watts|kw|a|amp|amps|ah|mah|hz|mhz|ghz|mm|cm|in|inch|inches|ft|foot|feet|oz|lb|gb|tb|mb|mp|dpi|ppi|rpm|pa|psi|btu|cc|hp|gph|gpm|lm|lumen|lumens|core|cores|ct|pk|packs?|pcs?|pieces?|stones?|volumes?|bits?(?:-(?:depth|float|floating-point))?)$/i.test(value)
    || /^\d+[\s-]*slices?$/i.test(value)
    || /^\d{1,3}-?channels?$/i.test(value)
    || /^\d+[\s-]*(?:temp|temperatures?|speeds?|persons?|people|lamps?|lights?|bulbs?|bottles?)$/i.test(value)
    || /^[1-9]\d?-[1-9]\d?p$/i.test(value)
    || /^\d+(?:\.\d+)?x\d+(?:\.\d+)?$/i.test(value)
    || /^\d+(?:\.\d+)?x\d+(?:\.\d+)?(?:mm|cm|in|ft|m)$/i.test(value)
    || /^\d+x\d+(?:\.\d+)?(?:fl?oz|oz|ml|l|qt|gb|tb|mb)$/i.test(value)
    || /^\d+[\s-]*in[\s-]*\d+$/i.test(value)
    || /^ddr[345](?:l|x)?-?\d{3,5}$/i.test(value)
    || /^\d+(?:st|nd|rd|th)$/i.test(value)
    || /^(?:19|20)\d{2}$/.test(value)
    || /^(?:19|20)\d{2}s$/i.test(value)
    || /^(?:19|20)\d{2}-\d{1,2}-\d{1,2}$/.test(value);
}

function lensApertureToken(value: string): boolean {
  const compact = value.replace(/\s+/g, '').toLowerCase();
  return /^f\/?\d+(?:\.\d+)?$/.test(compact) || /^\d+:\d+$/.test(compact);
}

function isLensApertureInference(value: string, source: string): boolean {
  if (!lensApertureToken(value)) return false;
  const aperture = new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(value)}(?![A-Za-z0-9]|\\.\\d|/\\d)`, 'i');
  const assertions = source.split(/\n|[,;|]|(?<=[.!?])\s+|\s+\/\s+|\b(?:with|plus|includes?|including|contains?|alongside|accompanied|bundled|separate|compatible|for\s+use\s+with|replacement\s+for|fits?)\b|\bw\s*\/|\s+(?:and|&|\+)\s+/i)
    .filter((assertion) => aperture.test(assertion));
  // The first product noun owns the assertion; focal lengths can also describe
  // camera formats. Bundle components cannot turn the body's F2 into aperture.
  return assertions.length > 0 && assertions.every((assertion) => {
    const subject = assertion.match(/\b(?:single[\s-]+lens[\s-]+reflex(?:\s+camera)?|camera\s+lens(?:es)?|lens(?:es)?|camera(?:s)?|body|bodies|dslr|slr)\b/i)?.[0] || '';
    if (subject && (/^single[\s-]+lens[\s-]+reflex/i.test(subject) || !/\blens(?:es)?\b/i.test(subject))) return false;
    return /\b(?:lens(?:es)?|aperture|focal(?:\s+length)?|optical)\b/i.test(assertion)
      || /\b\d+(?:\.\d+)?(?:\s*-\s*\d+(?:\.\d+)?)?\s*mm\b/i.test(assertion);
  });
}

function inferredModelTokenScore(value: string, source = ''): number {
  const token = value.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9+.-]+$/g, '');
  if (!token || token.length > 24 || isIsbnLikeToken(token) || isMeasurementLikeModelToken(token)
    || GENERIC_MODEL_RE.test(token) || INTERFACE_ONLY_MODEL_RE.test(token)
    || isLensApertureInference(token, source)) return -1;
  const separators = (token.match(/[-.]/g) || []).length;
  if (NUMERIC_PART_RE.test(token)) return 100 + (separators * 8) + Math.min(token.length, 20);
  if (/^\d{6,9}$/.test(token)) return 96 + token.length;
  if (/^[IVXLCDM]{2,}-[A-Z]$/i.test(token)) return 94 + token.length;
  if (MODEL_RE.test(token) || TITLE_MODEL_ALT_RE.test(token) || PART_NUMBER_RE.test(token)) {
    return 86 + (separators * 8) + Math.min(token.length, 20);
  }
  if (DIGIT_LED_MODEL_RE.test(token)) return 78 + (separators * 8) + Math.min(token.length, 20);
  return -1;
}

function alphabeticBrandModel(brand: string, value: string): string | null {
  const known = KNOWN_ALPHABETIC_BRAND_MODELS[brand.toLowerCase()]?.[value.toLowerCase()];
  return known || null;
}

function canonicalKeurigNamedModel(match: RegExpMatchArray): string {
  const line = match[1]!.replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
  const suffix = match[2] ? ' Plus' : '';
  return `K-${line.replace(/\b\w/g, (character) => character.toUpperCase())}${suffix}`;
}

function keurigNamedModelsInPrimary(value: string | null | undefined): string[] {
  const models: string[] = [];
  // Compatibility targets do not own identity, but a later independent
  // assertion still must participate in conflict detection.
  const clauses = normalise(value).split(/\n|(?<=[.!?;])\s+/);
  for (const clause of clauses) {
    const primary = clause.split(/\b(?:compatible\s+with|replacement\s+for|designed\s+for|made\s+for|for\s+use\s+with|fits?|works?\s+with|for)\b/i, 1)[0] || '';
    for (const match of primary.matchAll(new RegExp(KEURIG_NAMED_MODEL_RE.source, 'gi'))) {
      const model = canonicalKeurigNamedModel(match);
      if (!models.some((candidate) => compactIdentityText(candidate) === compactIdentityText(model))) models.push(model);
    }
  }
  return models;
}

function keurigNamedModel(value: string | null | undefined): string | null {
  return keurigNamedModelsInPrimary(value)[0] || null;
}

function keurigPrimaryProseModels(value: string | null | undefined): string[] {
  const models: string[] = [];
  const sentences = normalise(value).split(/\n|(?<=[.!?;])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  for (const sentence of sentences) {
    const primary = sentence.split(/\b(?:compatible\s+with|replacement\s+for|designed\s+for|made\s+for|for\s+use\s+with|fits?|works?\s+with|for)\b/i, 1)[0] || '';
    if (!/\b(?:coffee|k-cup)\s+maker\b/i.test(primary)) continue;
    if (!/^\s*(?:(?:this|the|a|an)\s+)?(?:is\s+)?(?:a\s+)?(?:keurig\s+)?k[\s-]*(?:select|compact|elite|supreme|duo|mini|cafe|express|classic|slim|plus|essential|studio|\d{3,4})(?:[\s-]*plus)?\b/i.test(primary)
      && !/\bkeurig\s+k[\s-]*(?:select|compact|elite|supreme|duo|mini|cafe|express|classic|slim|plus|essential|studio|\d{3,4})(?:[\s-]*plus)?\b/i.test(primary)
      && !/^\s*(?:(?:this|the|a|an)\s+)?(?:keurig\s+)?(?:coffee|k-cup)\s+maker\s+is\s+(?:a\s+)?(?:keurig\s+)?k[\s-]*(?:select|compact|elite|supreme|duo|mini|cafe|express|classic|slim|plus|essential|studio|\d{3,4})(?:[\s-]*plus)?\b/i.test(primary)) continue;
    for (const model of keurigNamedModelsInPrimary(primary)) {
      if (!models.some((candidate) => compactIdentityText(candidate) === compactIdentityText(model))) models.push(model);
    }
  }
  return models;
}

function keurigPrimaryModels(title: string | null | undefined, structuredValues: string[] = [], prose?: string | null): string[] {
  const models = [...keurigNamedModelsInPrimary(title)];
  for (const value of structuredValues) {
    for (const model of keurigNamedModelsInPrimary(value)) {
      if (!models.some((candidate) => compactIdentityText(candidate) === compactIdentityText(model))) models.push(model);
    }
  }
  for (const model of keurigPrimaryProseModels(prose)) {
    if (!models.some((candidate) => compactIdentityText(candidate) === compactIdentityText(model))) models.push(model);
  }
  return models;
}

function keurigNamedModelCandidateRejection(title: string, product: ProductIdentity): string | null {
  if (product.brand.toLowerCase() !== 'keurig') return null;
  if (product.discriminators.variantLabels.includes('keurig-named-model:source-conflict')) {
    return 'identity-conflict:keurig-named-model-source';
  }
  const candidateModels = keurigPrimaryModels(title);
  if (candidateModels.length > 1) return 'identity-conflict:keurig-named-model-candidate';
  if (!product.model) return null;
  const expected = keurigNamedModel(product.model);
  if (!expected) return null;
  const candidate = candidateModels[0] || null;
  return candidate === expected ? null : `model-mismatch:${expected}`;
}

function canonicalAlphabeticCameraModel(value: string): string | null {
  const compact = value.replace(/[^a-z0-9]/gi, '');
  if (/^ft$/i.test(compact)) return 'FT';
  if (/^ftql$/i.test(compact)) return 'FTQL';
  if (/^ftb$/i.test(compact)) return 'FTb';
  if (/^tl$/i.test(compact)) return 'TL';
  return null;
}

function cameraAlphabeticModelFromTokens(brand: string, kind: ProductKind | null, tokens: string[]): string | null {
  if (kind !== 'camera' || brand.toLowerCase() !== 'canon') return null;
  const brandIndex = tokens.findIndex((token) => token.toLowerCase() === brand.toLowerCase());
  if (brandIndex < 0) return null;
  const first = tokens[brandIndex + 1] || '';
  const second = tokens[brandIndex + 2] || '';
  const combined = canonicalAlphabeticCameraModel(`${first}${second}`);
  const firstModel = canonicalAlphabeticCameraModel(first);
  return combined || (firstModel === 'FT' ? null : firstModel);
}

export function canonicalMidiverbModel(model: string): string | null {
  const match = model.trim().match(/^(?:alesis\s+)?midiverb\s+(ii|iii|iv|2|3|4)$/i);
  if (!match) return null;
  const generations: Readonly<Record<string, string>> = { '2': 'II', '3': 'III', '4': 'IV', ii: 'II', iii: 'III', iv: 'IV' };
  return `Midiverb ${generations[match[1]!.toLowerCase()]!}`;
}

export function alesisMidiverbEvidence(title: string): { models: string[]; accessory: string | null } {
  // Compatibility and included/excluded components cannot own the primary generation.
  const primary = title
    .split(/\b(?:compatible\s+with|works?\s+with|for|made\s+for|designed\s+for|fits?)\b/i, 1)[0]!
    .split(/\b(?:with|without|no|missing|including|includes?|plus|bundled\s+with)\b|\bw\s*\//i, 1)[0]!;
  const models = new Set<string>();
  const generation = '(?:iii|ii|iv|i|v|\\d+)';
  const alternatives = `(?:\\s*\\(?\\s*(?:/|,|&|-|\\band\\b|\\bor\\b)\\s*(?:(?:alesis\\s+)?midiverb[\\s._-]*)?${generation}\\b\\s*\\)?)*`;
  for (const match of primary.matchAll(new RegExp(`\\bmidiverb[\\s._-]*${generation}\\b${alternatives}`, 'gi'))) {
    let firstGeneration = true;
    for (const token of match[0].matchAll(/\bmidiverb[\s._-]*(iii|ii|iv|i|v|\d+)\b|\b(iii|ii|iv|i|v|\d+)\b/gi)) {
      const value = token[1] ?? token[2]!;
      const suffix = primary.slice(match.index! + token.index! + token[0].length);
      const explicitlyNamed = Boolean(token[1]);
      // Punctuation can introduce a specification, not another model generation.
      const specification = !firstGeneration && !explicitlyNamed && /^\d+$/.test(value)
        && /^(?:\.\d+)?[\s-]*(?:(?:bits?|inch(?:es)?|cm|mm|ft|hz|khz|mhz|volts?|watts?|amps?|kg|lbs?|db|channels?)\b|["\u2033])/i.test(suffix);
      firstGeneration = false;
      if (specification) continue;
      models.add(canonicalMidiverbModel(`Midiverb ${value}`) ?? `Midiverb ${value.toUpperCase()}`);
    }
  }
  const familyIndex = primary.search(/\bmidiverb\b/i);
  const accessory = [...primary.matchAll(new RegExp(`\\b(?:power\\s+suppl(?:y|ies)|psu|books?|edition|volume)\\b|${ACCESSORY_NOUN_RE.source}`, 'gi'))]
    .find((noun) => {
      const equipment = /^(?:power\s+suppl(?:y|ies)|psu|adapter|charger|cord|cable)s?$/i.test(noun[0]);
      const explicitEquipmentStatus = /^\s*(?:[-,:]\s*)?(?:(?:is|are)\s+)?(?:not\s+)?(?:included|supplied|provided|excluded|missing|absent|optional|sold\s+separately)\b/i
        .test(title.slice(noun.index! + noun[0].length));
      return !(equipment && familyIndex >= 0 && noun.index! > familyIndex && explicitEquipmentStatus);
    });
  return { models: [...models], accessory: accessory?.[0].toLowerCase() || null };
}

function knownAlesisMidiverbGenerationAliasMatches(title: string, product: ProductIdentity): boolean {
  const expected = product.brand.toLowerCase() === 'alesis' ? canonicalMidiverbModel(product.model || '') : null;
  if (!expected) return false;
  const candidate = alesisMidiverbEvidence(title);
  return !candidate.accessory && candidate.models.length === 1 && candidate.models[0] === expected;
}

function alesisMidiverbCandidateRejection(title: string, product: ProductIdentity): string | null {
  if (product.brand.toLowerCase() !== 'alesis') return null;
  const expected = canonicalMidiverbModel(product.model || '');
  if (!expected && !/\bmidiverb\b/i.test(product.name)) return null;
  const source = alesisMidiverbEvidence(product.name);
  const candidate = alesisMidiverbEvidence(title);
  if (product.discriminators.variantLabels.includes('alesis-midiverb:source-conflict') || source.models.length > 1) {
    return 'identity-conflict:alesis-midiverb-source';
  }
  if (candidate.models.length > 1) return 'identity-conflict:alesis-midiverb-candidate';
  if (source.accessory !== candidate.accessory && (source.accessory || candidate.accessory)) return 'accessory-or-component';
  const sourceModel = expected || source.models[0];
  if (sourceModel && (candidate.models.length !== 1 || candidate.models[0] !== sourceModel)) {
    return `model-mismatch:${sourceModel}`;
  }
  return null;
}

function canonicalCrownPowerBaseModel(model: string): string | null {
  const match = model.trim().match(/^(?:crown\s+)?power[\s-]*base\s*(i{1,3}|[123])$/i);
  if (!match) return null;
  const generations: Readonly<Record<string, string>> = { '1': '1', '2': '2', '3': '3', i: '1', ii: '2', iii: '3' };
  return `Power Base ${generations[match[1]!.toLowerCase()]!}`;
}

function crownPowerBaseEvidence(title: string): { models: string[]; accessory: string | null } {
  const primary = title
    .split(/\b(?:compatible\s+with|works?\s+with|for|made\s+for|designed\s+for|fits?)\b/i, 1)[0]!
    .split(/\b(?:with|without|no|missing|including|includes?|plus|bundled\s+with)\b|\bw\s*\//i, 1)[0]!;
  const models = new Set<string>();
  for (const match of primary.matchAll(/\b(?:crown\s+)?power[\s-]*base\s*(i{1,3}|[123])\b/gi)) {
    const model = canonicalCrownPowerBaseModel(`Power Base ${match[1]}`);
    if (model) models.add(model);
  }
  const accessoryMatch = /\b(?:manuals?|boards?|power\s+suppl(?:y|ies)|psu|adapters?|chargers?|cords?|cables?|cooling\s+fans?|transformers?|replacement|spares?|parts?)\b/i.exec(primary);
  const accessory = accessoryMatch
    && !/^(?:cords?|cables?)$/i.test(accessoryMatch[0])
      ? accessoryMatch[0].toLowerCase()
      : accessoryMatch && !/^\s*(?:[-,:]\s*)?(?:(?:is|are)\s+)?(?:not\s+)?(?:included|supplied|provided)\b/i.test(primary.slice(accessoryMatch.index! + accessoryMatch[0].length))
        ? accessoryMatch[0].toLowerCase()
        : null;
  return { models: [...models], accessory };
}

function crownPowerBaseStructuredModels(models: string[]): string[] {
  return [...new Set(models.map(canonicalCrownPowerBaseModel).filter((model): model is string => Boolean(model)))];
}

function crownPowerBaseStructuredDescriptionValues(description: string): string[] {
  const values: string[] = [];
  for (const match of description.matchAll(/\bmodel(?:\s+(?:name|number|no\.?)|\s*#)?\s*:\s*([^\n;|]+?)(?=[\n;|]|\s+(?:missing\s+parts?|condition|notes?|brand|manufacturer|mpn)\s*:|\s*$)/gi)) {
    const value = match[1]!.trim();
    if (looksLikeModel(value)) values.push(value);
  }
  return [...new Set(values)];
}

function crownPowerBaseStructuredDescriptionModels(description: string): string[] {
  return crownPowerBaseStructuredModels(crownPowerBaseStructuredDescriptionValues(description));
}

function knownCrownPowerBaseAliasMatches(title: string, product: ProductIdentity): boolean {
  const expected = product.brand.toLowerCase() === 'crown' ? canonicalCrownPowerBaseModel(product.model || '') : null;
  if (!expected) return false;
  const candidate = crownPowerBaseEvidence(title);
  return !candidate.accessory && candidate.models.length === 1 && candidate.models[0] === expected;
}

function crownPowerBaseCandidateRejection(title: string, product: ProductIdentity): string | null {
  if (product.brand.toLowerCase() !== 'crown') return null;
  const expected = canonicalCrownPowerBaseModel(product.model || '')
    || (product.name.match(/\bcrown\b/i) ? crownPowerBaseEvidence(product.name).models[0] : null);
  if (!expected && !/\bcrown\s+power[\s-]*base\b/i.test(product.name)) return null;
  const source = crownPowerBaseEvidence(product.name);
  const candidate = crownPowerBaseEvidence(title);
  if (product.discriminators.variantLabels.includes('crown-power-base:source-conflict') || source.models.length > 1) {
    return 'identity-conflict:crown-power-base-source';
  }
  if (candidate.models.length > 1) return 'identity-conflict:crown-power-base-candidate';
  if (source.accessory !== candidate.accessory && (source.accessory || candidate.accessory)) return 'accessory-or-component';
  if (/\b(?:compatible\s+with|works?\s+with|for\s+use\s+with|replacement\s+for|designed\s+for|fits?)\b/i.test(title)) {
    return 'identity-scope:crown-power-base-primary';
  }
  if (candidate.accessory) return 'accessory-or-component';
  if (expected && (candidate.models.length !== 1 || candidate.models[0] !== expected)) return `model-mismatch:${expected}`;
  return null;
}

function canonPrimaryCameraModelEvidence(clause: string): string[] {
  const models = new Set<string>();
  for (const match of clause.matchAll(/\b(?:FT\s*QL|FTb|FT|TL)\b/gi)) {
    const model = canonicalAlphabeticCameraModel(match[0]);
    if (model) models.add(model);
  }
  for (const match of clause.matchAll(/\b[A-Z]{1,8}-\d{1,8}[A-Za-z0-9+.-]*\b/gi)) models.add(match[0].toUpperCase());
  return [...models];
}

function recoverAlphabeticCameraModel(title: string, prose: string, brand: string, kind: ProductKind | null): string | null {
  if (kind !== 'camera' || brand.toLowerCase() !== 'canon') return null;
  const declaration = new RegExp(`^(?:(?:lot|item)\\s+(?:contains?|includes?|is)\\s+)?(?:(?:a|an|the|this)\\s+)?${escapeRegExp(brand)}\\b`, 'i');
  const sentences = prose.split(/\n|(?<=[.!?])\s+/).map((value) => value.trim()).filter(Boolean);
  const candidates = new Set<string>();
  for (const sentence of sentences) {
    const declaredBrand = declaration.exec(sentence);
    if (!declaredBrand) continue;
    const assertion = sentence.slice(declaredBrand[0].length);
    if (primaryProseAssertionExcluded(assertion, brand)) continue;
    const clause = assertion.split(/;|\b(?:with|plus|includes?|including|contains?|alongside|accompanied|bundled|separate|compatible|works?\s+with|designed\s+for|made\s+for|for\s+use\s+with|replacement\s+for|fits?|inventory|auction\s+reference|seller\s+reference)\b/i, 1)[0] || '';
    if (!/\b(?:camera|cameras|slr)\b/i.test(clause)) continue;
    if (!/^\s*(?:FT\s*QL|FTb|FT|TL|[A-Z]{1,8}-\d{1,8}[A-Za-z0-9+.-]*)\b(?:\s+(?:\d+\s*mm|film|digital|vintage|analog(?:ue)?|single[- ]lens|reflex))*\s+(?:slr(?:\s+camera)?|camera)\b/i.test(clause)
      || /\b(?:lens(?:es)?|caps?|manuals?|instructions?|guides?|cases?|covers?|straps?|batter(?:y|ies)|chargers?|adapters?|mounts?|filters?)\b/i.test(clause)) continue;
    for (const candidate of canonPrimaryCameraModelEvidence(clause)) candidates.add(candidate);
  }
  if (candidates.size !== 1) return null;
  const candidate = [...candidates][0]!;
  // A generic FT title can be refined to FT QL, not replaced by another family.
  if (/\bcanon\s+ft\b/i.test(title) && candidate !== 'FT' && candidate !== 'FTQL') return null;
  return canonicalAlphabeticCameraModel(candidate);
}

function rankedInferredModelTokens(values: string[], source = ''): string[] {
  const unique = [...new Map(values
    .map((value, index) => ({ value, index, score: inferredModelTokenScore(value, source) }))
    .filter((entry) => entry.score >= 0)
    .map((entry) => [entry.value.toLowerCase(), entry] as const)).values()];
  return unique
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.value);
}

function primaryProseAssertionExcluded(tail: string, brand: string): boolean {
  const accessorySubject = new RegExp(`^(?:(?:a|an|the|${escapeRegExp(brand)})\\s+)*${BUNDLE_COMPONENT_NOUN_RE.source}`, 'i');
  const relativeAccessoryExclusion = new RegExp(`\\bwith\\s+(?:(?:a|an|the|${escapeRegExp(brand)})\\s+)*${BUNDLE_COMPONENT_NOUN_RE.source}(?:\\s+[a-z0-9-]+){0,3}\\s+(?:which|that)\\s+(?:is|are)\\s+not\\s+(?:included|supplied)\\b`, 'gi');
  const primaryTail = tail.split(/\b(?:plus|alongside|accompanied|bundled)\b/i, 1)[0] || '';
  const assertions = primaryTail.replace(relativeAccessoryExclusion, '')
    .split(/[,;]|\bbut\b|\band\s+(?=(?:(?:the|this)\s+)?(?:unit|item|product|lot|it)\s+(?:is|are)\b)/i);
  return assertions.some((assertion) => {
    const text = assertion.trim();
    if (accessorySubject.test(text)
      || /^(?:our\s+)?(?:inventory|auction\s+reference|seller\s+reference)\b/i.test(text)) return false;
    return /\b(?:reference\s+only|sold\s+separately|not\s+(?:included|supplied|part\s+of|for\s+sale)|excluded|instead\s+of|rather\s+than)\b/i.test(text)
      || /\b(?:is|are)\s+compatible\s+with\s+(?:this|the)\s+(?:item|lot|unit|product)\b/i.test(text);
  });
}

function recoverPrimaryProseModel(title: string, prose: string, brand: string): string | null {
  if (!brand) return null;
  const brandTokens = compactTokens(brand);
  const titlePhraseTokens = compactTokens(title).filter((token) => !brandTokens.includes(token) && !NOISE_WORDS.has(token));
  const titleTokens = compactTokens(title).filter((token) => !brandTokens.includes(token)
    && !NOISE_WORDS.has(token) && !GENERIC_BRAND_RE.test(token));
  const titleKind = detectProductKind(title);
  const alphabeticCameraModel = recoverAlphabeticCameraModel(title, prose, brand, titleKind);
  if (alphabeticCameraModel) return alphabeticCameraModel;
  // A concrete family/manufacturer title can leave only one useful token
  // after the detected brand and product-kind words are removed (for example,
  // "Pixma Canon Printer"). Keep the fallback bounded by requiring that kind
  // signal before accepting this narrower corroboration.
  if (titleTokens.length < 2 && !titleKind) return null;
  const declaration = new RegExp(`^(?:(?:lot|item)\\s+(?:contains?|includes?|is)\\s+)?(?:(?:a|an|the|this)\\s+)?${escapeRegExp(brand)}\\b`, 'i');
  const candidates = new Map<string, string>();
  const sentences = prose.split(/\n|(?<=[.!?])\s+/).map((value) => value.trim()).filter(Boolean);
  for (const sentence of sentences) {
    const declaredBrand = declaration.exec(sentence);
    if (!declaredBrand) continue;
    // Secondary products, compatibility targets, and seller metadata do not
    // own codes in the primary product declaration before these boundaries.
    const clause = sentence.slice(declaredBrand[0].length).split(/;|\b(?:with|plus|includes?|including|contains?|alongside|accompanied|bundled|separate|compatible|works?\s+with|designed\s+for|made\s+for|for\s+use\s+with|replacement\s+for|fits?|inventory|auction\s+reference|seller\s+reference)\b/i, 1)[0] || '';
    const words = [...clause.matchAll(/[a-z0-9]+/gi)];
    let wordIndex = -1;
    for (const token of titlePhraseTokens) {
      wordIndex = words.findIndex((word, index) => index > wordIndex && word[0].toLowerCase() === token);
      if (wordIndex < 0) break;
    }
    if (wordIndex < 0) continue;
    const lastProductWord = words[wordIndex]!;
    const productEnd = lastProductWord.index! + lastProductWord[0].length;
    const productPhrase = clause.slice(0, productEnd);
    if (/\b(?:not|never|no|without|excluding|instead|rather|other)\b/i.test(productPhrase)) continue;
    const phraseKind = detectProductKind(productPhrase);
    if (phraseKind && phraseKind !== titleKind) continue;
    if (titleKind === 'camera'
      && /\blens(?:es)?\b/i.test(productPhrase)
      && !/\blens(?:es)?\b/i.test(title)) continue;
    const accessoryNouns = [...productPhrase.matchAll(new RegExp(`${ACCESSORY_NOUN_RE.source}|\\bbatter(?:y|ies)\\b`, 'gi'))];
    if (accessoryNouns.some((noun) => !modelMatches(title, noun[0]))) continue;
    const modelTail = clause.slice(productEnd);
    // Validate the entire assertion after identifying the primary product
    // phrase; clause boundaries below are for ownership, not evidence loss.
    const completeAssertionTail = sentence.slice(declaredBrand[0].length + productEnd);
    const leadingModelLabel = modelTail.match(/^\s*(?:model(?:\s+(?:number|#)?)?|mpn)\s*[:#-]?\s*/i)?.[0] || '';
    const modelScanTail = modelTail.slice(leadingModelLabel.length);
    const ownedTokens: string[] = [];
    for (const token of tokeniseIdentity(modelScanTail).map((value) => value.replace(/[.:-]+$/, ''))) {
      if (/^(?:models?|mpn|number|is|are|and|or|either|possibly|maybe|perhaps)$/i.test(token)) continue;
      if (inferredModelTokenScore(token, clause) < 0 || !looksLikeModel(token)) break;
      ownedTokens.push(token);
    }
    const firstOwnedToken = ownedTokens[0];
    const firstOwnedIndex = firstOwnedToken
      ? modelScanTail.search(new RegExp(`\\b${escapeRegExp(firstOwnedToken)}\\b`, 'i'))
      : -1;
    const trailingAssertion = firstOwnedIndex >= 0
      ? completeAssertionTail.slice(leadingModelLabel.length + firstOwnedIndex + firstOwnedToken!.length)
      : '';
    const leadingTrailingAccessory = new RegExp(`^\\s*(?:[,;:]\\s*)?(?:(?:a|an|the)\\s+)?(?:${ACCESSORY_NOUN_RE.source}|ink\\s+cartridges?|print\\s+heads?)`, 'i');
    const explicitAccessoryOwnership = /\b(?:included|not\s+included|supplied|sold\s+separately|optional)\b/i.test(trailingAssertion);
    if (/\b(?:replacement|compatible\s+with|works?\s+with\s+(?:this|the)\s+(?:item|lot|unit|product)|designed\s+for|made\s+for|for\s+use\s+with|fits?)\b/i.test(trailingAssertion)
      || (leadingTrailingAccessory.test(trailingAssertion) && !explicitAccessoryOwnership)) continue;
    // Check the complete assertion, including text after a bundle boundary,
    // while leaving explicit accessory subjects and transaction notes scoped.
    if (primaryProseAssertionExcluded(completeAssertionTail, brand)
      || /\bcompatible\s+with\s+(?:this|the)\s+(?:lot|item|unit|product)\b/i.test(completeAssertionTail)) continue;
    for (const candidate of rankedInferredModelTokens(ownedTokens, clause)) {
      candidates.set(compactIdentityText(candidate), candidate);
    }
  }
  return candidates.size === 1 ? [...candidates.values()][0]! : null;
}

interface StrictIdentitySignatures {
  modelCodes: string[];
  isbns: string[];
  editions: string[];
  volumes: string[];
  grades: string[];
  catalogNumbers: string[];
  mintMarks: string[];
  bundleComponents: string[][];
}

const NUMBER_WORDS: Readonly<Record<string, string>> = {
  one: '1', first: '1', two: '2', second: '2', three: '3', third: '3', four: '4', fourth: '4',
  five: '5', fifth: '5', six: '6', sixth: '6', seven: '7', seventh: '7', eight: '8', eighth: '8',
  nine: '9', ninth: '9', ten: '10', tenth: '10', eleven: '11', eleventh: '11', twelve: '12', twelfth: '12',
  thirteen: '13', thirteenth: '13', fourteen: '14', fourteenth: '14', fifteen: '15', fifteenth: '15',
  sixteen: '16', sixteenth: '16', seventeen: '17', seventeenth: '17', eighteen: '18', eighteenth: '18',
  nineteen: '19', nineteenth: '19', twenty: '20', twentieth: '20',
};
const NUMBER_WORD_PATTERN = Object.keys(NUMBER_WORDS).sort((left, right) => right.length - left.length).join('|');
const BUNDLE_TOKEN_NOISE = new Set([
  ...NOISE_WORDS, 'only', 'max', 'xr', 'oem', 'channel', 'channels', 'complete', 'system', 'kit', 'bundle',
]);
const BUNDLE_COMPONENT_NOUN_RE = /\b(?:accessor(?:y|ies)|adapters?|bags?|batter(?:y|ies)|blades?|bowls?|cables?|cases?|chargers?|controllers?|cords?|covers?|docks?|earbuds?|filters?|foot\s*switch(?:es)?|games?|headphones?|headsets?|hoses?|jars?|keyboards?|lanyards?|lens(?:es)?|loaders?|microphones?|mounts?|mouses?|nozzles?|pedals?|plates?|power\s+supply|probes?|pumps?|racks?|remotes?|sensors?|speakers?|stands?|subwoofers?|transmitters?|tripods?)\b/i;

function canonicalBundleToken(value: string): string {
  const token = value.toLowerCase();
  if (NUMBER_WORDS[token]) return NUMBER_WORDS[token];
  if (token === 'batteries') return 'battery';
  if (token === 'lenses') return 'lens';
  if (token.endsWith('ies') && token.length > 4) return `${token.slice(0, -3)}y`;
  const singular = token.endsWith('s') && token.length > 3 ? token.slice(0, -1) : token;
  if (singular !== token && BUNDLE_COMPONENT_NOUN_RE.test(singular)) return singular;
  return token;
}

function bundleComponentTokens(value: string): string[] {
  // Keep quantities, but discard measurements such as "5.0Ah" before the
  // decimal is split into separate tokens by compactTokens.
  const withoutMeasurements = value.replace(/\b(?:\d+(?:\.\d+)?\s*[-–]\s*)?\d+(?:\.\d+)?\s*(?:v|w|kw|a|amp|amps|ah|mah|hz|mhz|ghz|mm|cm|in|ft|oz|lb|gb|tb|mb|mp|dpi|ppi|rpm|pa|psi|btu|lm|lumen|lumens|core|cores)\b/gi, ' ');
  return compactTokens(withoutMeasurements)
    .map(canonicalBundleToken)
    .filter((token) => (BUNDLE_COMPONENT_NOUN_RE.test(token) || /^\d+$/.test(token))
      && !BUNDLE_TOKEN_NOISE.has(token) && !isMeasurementLikeModelToken(token));
}

function excludedCandidateComponentTokens(value: string): Set<string> {
  const result = new Set<string>();
  const noun = BUNDLE_COMPONENT_NOUN_RE.source;
  const article = String.raw`(?:(?:a|an|the)\s+)?`;
  const connector = String.raw`\s*(?:,\s*(?:and\s+)?|\band\b|&)\s*`;
  const prefix = new RegExp(String.raw`\b(?:without|no|excluding|does\s+not\s+include)\s+${article}(?:${noun}${connector}${article})*$`, 'i');
  // A comma can start an independent exclusion after an affirmative bundle.
  const sharedSuffixConnector = String.raw`\s*(?:\band\b|&)\s*`;
  const suffix = new RegExp(String.raw`^(?:${sharedSuffixConnector}${article}${noun})*\s*(?:(?:is|are)\s+)?(?:not\s+(?:included|supplied)|sold\s+separately|optional)\b`, 'i');
  for (const match of value.matchAll(new RegExp(noun, 'gi'))) {
    const index = match.index ?? 0;
    const beforeNoun = value.slice(0, index);
    const negativePrefix = /\b(?:without|no|excluding|does\s+not\s+include)\b(?:\s+\w+){0,3}\s*$/i;
    const lastNegative = [...beforeNoun.matchAll(/\b(?:without|no|excluding|does\s+not\s+include)\b/gi)].at(-1)?.index ?? -1;
    const lastAffirmative = [...beforeNoun.matchAll(/\b(?:with|includes?|including|contains?|but)\b/gi)].at(-1)?.index ?? -1;
    const scopedNegative = lastNegative >= 0 && lastNegative > lastAffirmative;
    const affirmativeAfterNegative = lastAffirmative > lastNegative;
    if ((!affirmativeAfterNegative && (prefix.test(beforeNoun) || negativePrefix.test(beforeNoun) || scopedNegative))
      || suffix.test(value.slice(index + match[0].length))) {
      compactTokens(match[0]).map(canonicalBundleToken).forEach((token) => result.add(token));
    }
  }
  return result;
}

function extractDescriptionBundleComponents(value: string): string[][] {
  const source = normalise(value);
  const components: string[][] = [];
  const inclusion = /(?:\bincluded\s+components?\s*:\s*|\b(?:includes?|including|contains|comes\s+with|consists\s+of|included\s+with|accompanying)\s+)((?:(?![!?;\n]|\.(?!\d)).)+)/gi;
  for (const match of source.matchAll(inclusion)) {
    const sentenceStart = Math.max(source.lastIndexOf('.', match.index ?? 0), source.lastIndexOf('!', match.index ?? 0), source.lastIndexOf('?', match.index ?? 0), source.lastIndexOf(';', match.index ?? 0), source.lastIndexOf('\n', match.index ?? 0)) + 1;
    const sentencePrefix = source.slice(sentenceStart, match.index ?? 0);
    const clause = String(match[1] || '');
    if (/\b(?:does\s+not|doesn't|never|without)\s+(?:\w+\s+){0,4}$/i.test(sentencePrefix)
      || (/\b(?:support|supports|refill|refilling|compatible)\b/i.test(sentencePrefix)
        && /\b(?:include|including|contains?|comes\s+with)\b/i.test(source.slice(sentenceStart, (match.index ?? 0) + match[0].length)))) continue;
    for (const part of clause.split(/\s*,\s*/)) {
      for (const contrastPart of part.split(/\s+\b(?:but|however|whereas)\b\s+/i)) {
        if (!contrastPart || /\b(?:(?:not|never)\s+included|sold\s+separately|optional|compatible|supports?|refill(?:ing)?|via)\b/i.test(contrastPart)) continue;
        const affirmativePart = contrastPart.split(/\b(?:without|no|excluding|does\s+not\s+include)\b/i)[0] || '';
        const nouns = [...affirmativePart.matchAll(new RegExp(BUNDLE_COMPONENT_NOUN_RE.source, 'gi'))];
        let previousNounEnd = 0;
        for (const noun of nouns) {
          const nounEnd = (noun.index ?? 0) + (noun[0] || '').length;
          const phrase = affirmativePart.slice(previousNounEnd, nounEnd)
            .split(/\b(?:in|with|and|plus|for|to)\b/i).at(-1) || '';
          const tokens = bundleComponentTokens(phrase);
          previousNounEnd = nounEnd;
          if (tokens.length) components.push(tokens);
        }
      }
    }
  }
  return components;
}

function explicitlyPartialBundle(value: string): boolean {
  const source = normalise(value);
  for (const match of source.matchAll(/\b(?:with|includes?|including|contains?|comes\s+with|consists\s+of)\b[^.!?;\n]{0,160}\bonly\b/gi)) {
    const clause = match[0] || '';
    if (BUNDLE_COMPONENT_NOUN_RE.test(clause)) return true;
  }
  return false;
}

function stripAdvertisedBundleLabels(value: string): string {
  return value
    .replace(/\b(?:creator\s+)?(?:combo|bundle|kit|package|set)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function researchIdentityName(name: string, model: string | null, description: string): string {
  if (!model) return name;
  const modelTokens = buildProductResearchQuery(model).split(/\s+/).filter(Boolean);
  const nameTokens = buildProductResearchQuery(name).split(/\s+/).filter(Boolean);
  if (!modelTokens.length) return name;
  const modelStart = nameTokens.findIndex((_, index) => modelTokens.every((token, offset) => nameTokens[index + offset] === token));
  if (modelStart < 0) return name;
  const modelEnd = modelStart + modelTokens.length;
  const labeledCodes = new Set<string>();
  for (const match of description.matchAll(/\b(?:sku|style|item\s*(?:no\.?|number)?|upc|ean)\s*[:#-]?\s*([a-z0-9][a-z0-9./-]{2,})\b/gi)) {
    labeledCodes.add(match[1]!.replace(/[^a-z0-9]/gi, '').toLowerCase());
  }
  const suffix = nameTokens.slice(modelEnd).filter((token) => {
    const compact = token.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const regionalCode = /^(?:eu|us|uk|ca|au|jp|cn|kr|de|fr|es|it)-[a-z0-9]{2,6}$/i.test(token);
    return !regionalCode && !labeledCodes.has(compact);
  });
  return [...nameTokens.slice(0, modelEnd), ...suffix].join(' ');
}

function candidateStatesComponentQuantity(title: string, component: string[]): boolean {
  const quantity = component.find((token) => /^\d+$/.test(token));
  if (!quantity) return true;
  const nouns = component.filter((token) => !/^\d+$/.test(token));
  for (const match of title.matchAll(new RegExp(BUNDLE_COMPONENT_NOUN_RE.source, 'gi'))) {
    const matchedNouns = compactTokens(match[0]).map(canonicalBundleToken);
    if (!nouns.some((noun) => matchedNouns.includes(noun))) continue;
    const before = title.slice(0, match.index ?? 0)
      .split(/[,;()&]|\b(?:and|with|plus|including|includes|contains|without|no)\b/i).at(-1) || '';
    const withoutMeasurements = before.replace(/\b(?:\d+(?:\.\d+)?\s*[-–]\s*)?\d+(?:\.\d+)?\s*(?:v|w|kw|a|amp|amps|ah|mah|hz|mhz|ghz|mm|cm|in|ft|oz|lb|gb|tb|mb|mp|dpi|ppi|rpm|pa|psi|btu|lm|lumen|lumens|core|cores)\b/gi, ' ');
    const quantityMatch = withoutMeasurements.match(new RegExp(`(?:^|\\s)(\\d+|${NUMBER_WORD_PATTERN})(?:\\s+[a-z0-9]+){0,3}\\s*$`, 'i'));
    if (quantityMatch && canonicalBundleToken(quantityMatch[1]!) === quantity) return true;
  }
  return false;
}

function normalizedNumber(value: string): string {
  const lower = value.toLowerCase();
  if (NUMBER_WORDS[lower]) return NUMBER_WORDS[lower];
  return String(Number(lower.replace(/(?:st|nd|rd|th)$/i, '')));
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function normalizedIsbn(value: string): string {
  const isbn = value.replace(/[^0-9Xx]/g, '').toUpperCase();
  if (isbn.length === 10) {
    const total = [...isbn].reduce((sum, character, index) => {
      const digit = character === 'X' && index === 9 ? 10 : Number(character);
      return Number.isFinite(digit) ? sum + (digit * (10 - index)) : Number.NaN;
    }, 0);
    if (!Number.isFinite(total) || total % 11 !== 0) return '';
    const body = `978${isbn.slice(0, 9)}`;
    const checksumTotal = [...body].reduce((sum, character, index) => sum + (Number(character) * (index % 2 ? 3 : 1)), 0);
    return `${body}${(10 - (checksumTotal % 10)) % 10}`;
  }
  if (isbn.length === 13 && /^97[89]/.test(isbn)) {
    const total = [...isbn].reduce((sum, character, index) => sum + (Number(character) * (index % 2 ? 3 : 1)), 0);
    return Number.isFinite(total) && total % 10 === 0 ? isbn : '';
  }
  return '';
}

function extractStrictIdentitySignatures(value: string): StrictIdentitySignatures {
  const source = normalise(value).replace(/\bw\s*\/\s*/gi, 'with ');
  const modelCodes = rankedInferredModelTokens(tokeniseIdentity(source));
  const isbnCandidates = [
    ...[...source.matchAll(/\bisbn(?:-1[03])?\s*[:#]?\s*([0-9Xx][0-9Xx\s-]{8,24})/gi)].map((match) => String(match[1])),
    ...[...source.matchAll(/\b97[89](?:[\s-]?\d){10}\b/g)].map((match) => String(match[0])),
    ...[...source.matchAll(/\b\d(?:[\s-]?\d){8}[\s-]?[0-9Xx]\b/g)].map((match) => String(match[0])),
  ];
  const isbns = isbnCandidates.map(normalizedIsbn).filter(Boolean);
  const editions = [
    ...[...source.matchAll(/\b(\d{1,3})(?:st|nd|rd|th)\s+edition\b/gi)].map((match) => normalizedNumber(String(match[1]))),
    ...[...source.matchAll(new RegExp(`\\b(${NUMBER_WORD_PATTERN})\\s+edition\\b`, 'gi'))].map((match) => normalizedNumber(String(match[1]))),
  ];
  const volumes = [
    ...[...source.matchAll(/\b(\d{1,3})[\s-]+volumes?\b/gi)].map((match) => normalizedNumber(String(match[1]))),
    ...[...source.matchAll(/\bvolume\s+(\d{1,3})\b/gi)].map((match) => normalizedNumber(String(match[1]))),
    ...[...source.matchAll(new RegExp(`\\b(${NUMBER_WORD_PATTERN})[\\s-]+volumes?\\b`, 'gi'))].map((match) => normalizedNumber(String(match[1]))),
    ...[...source.matchAll(new RegExp(`\\bvolume\\s+(${NUMBER_WORD_PATTERN})\\b`, 'gi'))].map((match) => normalizedNumber(String(match[1]))),
  ];
  const grades = [
    ...[...source.matchAll(/\b(PSA|BGS|SGC|CGC)\s*(\d+(?:\.\d+)?)\b/gi)].map((match) => `${match[1]}:${match[2]}`.toLowerCase()),
    ...[...source.matchAll(/\b(NGC|PCGS)\s*((?:MS|PF|PR|AU|XF|VF|VG|AG|FR|PO)\s*\d{1,2}(?:\.\d+|\+)?)\b/gi)]
      .map((match) => `${match[1]}:${String(match[2]).replace(/\s+/g, '')}`.toLowerCase()),
  ];
  const catalogNumbers = [
    ...[...source.matchAll(/(?:#\s*|\bno\.\s*|\bno(?:\s+(?=[A-Z0-9-]*\d)|(?=\d))|\bnumber\s+)([A-Z0-9][A-Z0-9-]{0,9})\b/gi)].map((match) => `catalog:${String(match[1]).toLowerCase()}`),
    ...[...source.matchAll(/\b(\d{1,4}\/\d{1,4})\b/g)].map((match) => `fraction:${match[1]}`),
  ];
  const mintMarks = [...source.matchAll(/\b((?:1[5-9]\d{2}|20\d{2}))[\s-]+([A-Z])\b/gi)]
    .map((match) => `${match[1]}-${String(match[2]).toLowerCase()}`);
  const connector = source.match(/\b(?:bundled\s+with|with|includes?|including|plus)\s+(.+)$/i);
  const trailingIncluded = source.match(new RegExp(String.raw`(?:^|[-,:;])\s*((?:[a-z0-9]+\s+){0,3}${BUNDLE_COMPONENT_NOUN_RE.source})\s+included\b`, 'i'));
  const bundleText = connector?.[1] || trailingIncluded?.[1] || '';
  const bundleComponents = bundleText
    ? stripResearchSuffixes(bundleText)
      .split(/\s*(?:,|;|\b(?:and|plus)\b)\s*/i)
      .filter((component) => BUNDLE_COMPONENT_NOUN_RE.test(component))
      .map((component) => bundleComponentTokens(component))
      .filter((component) => component.length > 0)
    : [];
  return {
    modelCodes: uniqueStrings(modelCodes),
    isbns: uniqueStrings(isbns),
    editions: uniqueStrings(editions),
    volumes: uniqueStrings(volumes),
    grades: uniqueStrings(grades),
    catalogNumbers: uniqueStrings(catalogNumbers),
    mintMarks: uniqueStrings(mintMarks),
    bundleComponents,
  };
}

function compareStrictIdentitySignatures(candidateTitle: string, product: ProductIdentity): string[] {
  const expected = extractStrictIdentitySignatures(product.name);
  const descriptionComponents = product.includedComponents || [];
  const actual = extractStrictIdentitySignatures(candidateTitle);
  // Ring-size fractions are handled by the contextual ring discriminator;
  // they are not catalog-number identity signatures.
  const sourceRingSize = ringSizeEvidence(product.name);
  const candidateRingSize = ringSizeEvidence(candidateTitle);
  expected.catalogNumbers = expected.catalogNumbers.filter((value) => !sourceRingSize.fractions.some((fraction) => value === `fraction:${fraction}`));
  actual.catalogNumbers = actual.catalogNumbers.filter((value) => !candidateRingSize.fractions.some((fraction) => value === `fraction:${fraction}`));
  const reasons: string[] = [];
  const primaryModel = String(product.model || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const packagePrimarySubject = product.name.match(/^(.*?)\s+(?:w\s*\/|with)\s*/i)?.[1] || '';
  const primarySubjectCodes = packagePrimarySubject ? extractStrictIdentitySignatures(packagePrimarySubject).modelCodes : expected.modelCodes;
  const requiredCodes = expected.modelCodes.filter((code) => primarySubjectCodes.includes(code) && (() => {
    const compact = code.toLowerCase().replace(/[^a-z0-9]/g, '');
    return !primaryModel || primaryModel === compact || !primaryModel.startsWith(compact);
  })());
  for (const code of requiredCodes) {
    if (!modelMatches(candidateTitle, code)) reasons.push(`identity-code-missing:${code}`);
  }
  const compareExactGroup = (label: string, sourceValues: string[], candidateValues: string[]) => {
    for (const expectedValue of sourceValues) {
      if (candidateValues.includes(expectedValue)) continue;
      reasons.push(`${candidateValues.length ? 'identity-conflict' : 'identity-missing'}:${label}:${expectedValue}`);
    }
  };
  compareExactGroup('isbn', expected.isbns, actual.isbns);
  compareExactGroup('edition', expected.editions, actual.editions);
  compareExactGroup('volume', expected.volumes, actual.volumes);
  compareExactGroup('grade', expected.grades, actual.grades);
  compareExactGroup('catalog-number', expected.catalogNumbers, actual.catalogNumbers);
  compareExactGroup('mint-mark', expected.mintMarks, actual.mintMarks);

  const candidateTokens = new Set(compactTokens(candidateTitle).map(canonicalBundleToken));
  const excludedTokens = excludedCandidateComponentTokens(candidateTitle);
  const batteryMentions = [...candidateTitle.matchAll(/\bbatter(?:y|ies)\b/gi)];
  if (batteryMentions.length && batteryMentions.every((mention) =>
    /^\s+chargers?\b/i.test(candidateTitle.slice((mention.index ?? 0) + mention[0].length)))) {
    candidateTokens.delete('battery');
    if (/\bbatter(?:y|ies)\s+chargers?\s+only\b/i.test(candidateTitle)) excludedTokens.add('battery');
  }
  for (const component of [...expected.bundleComponents, ...descriptionComponents]) {
    if (component.some((token) => excludedTokens.has(canonicalBundleToken(token)))) {
      reasons.push(`bundle-component-excluded:${component.join('-')}`);
      continue;
    }
    const hits = component.map(canonicalBundleToken).filter((token) => candidateTokens.has(token)).length;
    const hasQuantity = component.some((token) => /^\d+$/.test(canonicalBundleToken(token)));
    const requiredHits = hasQuantity ? component.length : Math.max(1, Math.ceil(component.length * 0.5));
    if (hits < requiredHits || (hasQuantity && !candidateStatesComponentQuantity(candidateTitle, component))) {
      reasons.push(`bundle-component-missing:${component.join('-')}`);
    }
  }
  return uniqueStrings(reasons);
}

function packagePrimarySubjectMismatch(candidateTitle: string, productName: string, secondaryModel = ''): boolean {
  const match = productName.match(/^(.*?)\s+(?:w\s*\/|with)\s*/i);
  if (!match) return false;
  if (!secondaryModel) return false;
  const subject = buildProductResearchQuery(match[1] || '').split(/\s+/).filter(Boolean);
  const candidate = buildProductResearchQuery(candidateTitle).split(/\s+/).filter(Boolean);
  const subjectTokens = subject.filter((token) => !GENERIC_RESEARCH_TOKENS.has(token));
  const subjectCodes = extractStrictIdentitySignatures(match[1] || '').modelCodes;
  const subjectAnchor = subjectTokens.slice(-Math.min(3, subjectTokens.length));
  const hasContiguousSubject = subjectAnchor.length > 0 && candidate.some((_, index) =>
    subjectAnchor.every((token, offset) => candidate[index + offset] === token));
  if (subjectCodes.length ? subjectCodes.some((code) => !modelMatches(candidateTitle, code)) : !hasContiguousSubject) return true;
  const compactSecondary = secondaryModel.toLowerCase().replace(/[^a-z0-9]/g, '');
  const secondaryPattern = compactSecondary.split('').map(escapeRegExp).join('[\\s./-]*');
  if (!compactSecondary || !new RegExp(`(?:^|[^a-z0-9])${secondaryPattern}(?![a-z0-9]|[-/.][a-z0-9])`, 'i').test(candidateTitle)) return true;
  return /\bmounting\s+brackets?\b/i.test(candidateTitle);
}

function stripStructuredBatchPrefix(value: string, statedBrand: string, statedModel: string): string {
  const match = value.match(/^([A-Za-z]{1,3}\d{1,2})\s+(.+)$/);
  if (!match) return value;
  const prefix = compactIdentityText(match[1]!);
  const model = compactIdentityText(statedModel);
  if (model && model === prefix) return value;
  const remainder = match[2]!;
  const brand = compactIdentityText(statedBrand);
  const brandAppearsAfterPrefix = Boolean(brand && compactIdentityText(remainder).includes(brand));
  const structuredModelDisagrees = Boolean(looksLikeModel(statedModel) && model !== prefix);
  return brandAppearsAfterPrefix || structuredModelDisagrees ? remainder.trim() : value;
}

export function extractProductIdentity(record: LotAnalysisRecord): ProductIdentity;
export function extractProductIdentity(title: string | null | undefined, description?: string): ProductIdentity;
export function extractProductIdentity(recordOrTitle: LotAnalysisRecord | string | null | undefined, description = ''): ProductIdentity {
  const record = typeof recordOrTitle === 'object' && recordOrTitle !== null ? recordOrTitle : null;
  const title = record ? (record.title || record.lead || '') : recordOrTitle;
  const sourceDescription = record ? (record.description || '') : description;
  const lead = normalise(title).trim();
  const parsed = parseStructuredDescription(sourceDescription);
  const statedBrand = (fieldValue(parsed.fields, 'brand', 'manufacturer', 'make') ?? '').trim();
  const explicitDescriptionModels = extractExplicitDescriptionModels(sourceDescription, lead);
  const statedModel = explicitDescriptionModels.length === 1 ? explicitDescriptionModels[0]! : '';
  const primaryProse = parsed.freeText.split(/\n\s*\*{2,}/)[0]?.trim() ?? '';
  const prose = primaryProse.replace(/\n+/g, ' ');
  const recovery = descriptionIdentityCandidate(parsed, statedModel) || prose;
  const recoveredNamedVariant = recoverCollectibleNamedVariant(lead, parsed);
  const leadStem = lead.replace(/(?:\.{3}|…)\s*$/, '').trim();
  const recoveryQuery = buildProductResearchQuery(recovery);
  const statedProductName = stripStructuredProductTail((fieldValue(parsed.fields, 'product name') || '').split(',')[0]!.trim());
  const leadTokens = buildProductResearchQuery(leadStem).split(/\s+/).filter(Boolean);
  const recoveryTokens = recoveryQuery.split(/\s+/).filter(Boolean);
  const normalizeRecoveryConnector = (value: string) => value
    .replace(/\bw\s*\/\s*/gi, 'w/')
    .replace(/\s+/g, ' ');
  const normalizedLead = normalizeRecoveryConnector(lead);
  const normalizedRecovery = normalizeRecoveryConnector(recovery);
  const leadIsTruncated = /(?:\.{3}|…)\s*$/.test(lead);
  const recoveryExtendsTruncatedLead = leadIsTruncated
    && leadTokens.length > 0
    && leadTokens.every((token, index) => recoveryTokens[index] === token);
  const recoveryExtendsClippedLead = !leadIsTruncated
    && lead.length === 50
    && /\b[A-Za-z0-9]+$/.test(lead)
    && !/\b[A-Z]{2}$/.test(lead)
    && normalizedRecovery.length > normalizedLead.length
    && normalizedRecovery.slice(0, normalizedLead.length).toLocaleLowerCase('en-US') === normalizedLead.toLocaleLowerCase('en-US')
    && /^[A-Za-z0-9]/.test(normalizedRecovery.slice(normalizedLead.length));
  const clippedModelFragment = /\b[A-Za-z0-9-]*\d[A-Za-z0-9-]*$/.test(lead);
  const completionPattern = clippedModelFragment
    ? /^[A-Za-z0-9][A-Za-z0-9-]*(?:\s+(?:[A-Za-z0-9][A-Za-z0-9-]*|&|and))*?(?:\s+\([^)]*\))?(?=\s*(?:[,;:]| - |\.|\b(?:sold\s+as\s+is|as\s+is|auction\s+reference|inventory|pickup)\b|$))/i
    : /^[A-Za-z0-9][A-Za-z0-9-]*/;
  const completedClippedLead = recoveryExtendsClippedLead
    ? `${lead}${normalizedRecovery.slice(normalizedLead.length).match(completionPattern)?.[0] ?? ''}`
    : '';
  const leadComparableTokens = leadTokens.filter((token) => token !== 'and');
  const statedProductTokens = buildProductResearchQuery(statedProductName).split(/\s+/).filter((token) => token && token !== 'and');
  const trailingFragment = leadStem.match(/\b([A-Za-z]{1,2})\s*$/)?.[1] || '';
  const statedProductCompletesLead = !leadIsTruncated
    && lead.length === 50
    && leadComparableTokens.length >= 3
    && trailingFragment.length > 0
    && !/^[A-Z]{2}$/.test(trailingFragment)
    && statedProductTokens.length >= leadComparableTokens.length
    && leadComparableTokens.slice(0, -1).every((token, index) => statedProductTokens[index] === token)
    && statedProductTokens[leadComparableTokens.length - 1]?.startsWith(leadComparableTokens[leadComparableTokens.length - 1]!)
    && statedProductTokens[leadComparableTokens.length - 1] !== leadComparableTokens[leadComparableTokens.length - 1];
  // A concrete visible title remains authoritative. Placeholder, generic, or
  // explicitly truncated headings may recover identity from the first safe
  // product line or structured brand/model fields in the description.
  const source = statedProductCompletesLead
    ? lead.replace(/\b[A-Za-z]{1,2}$/, statedProductTokens[leadComparableTokens.length - 1]!)
    : (!lead || (isWeakResearchTitle(lead) && !leadIsTruncated)
      || recoveryExtendsTruncatedLead || recoveryExtendsClippedLead) && recoveryQuery
      ? (recoveryExtendsClippedLead ? completedClippedLead : recovery)
      : (lead || recovery);
  const sections = source.split('|').map((part) => part.trim()).filter(Boolean);
  let named = sections.length > 1
    ? sections.find((part) => !isWeakResearchTitle(part) && !/^(?:retail|msrp|est\.?|value)?\s*\$?\s*[\d,]+(?:\.\d+)?\s*$/i.test(part)) ?? sections.at(-1) ?? source
    : source;
  named = named
    .replace(/^\s*(?:retail|msrp|est\.?\s*retail(?:\s*price)?|value)\s*[:\-]?\s*\$?\s*[\d,]+(?:\.\d+)?\s*/i, '')
    .replace(/^\s*\$\s*[\d,]+(?:\.\d+)?\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  let name = stripSellerResearchNote(stripResearchPrefixes(stripInventoryPrefix(named.replace(/\s*-\s*$/, '').trim())));
  name = stripStructuredBatchPrefix(name, statedBrand, statedModel);
  if (name.length < 3) name = lead || normalise(sourceDescription).split('\n')[0]?.trim() || '';
  // Keep the displayed/source identity intact, but do not infer a product
  // model from a parenthesized artist lifespan.
  const inferenceName = stripArtistBiographyFromInference(name);
  const rawTokens = tokeniseIdentity(inferenceName);
  const tokens = rawTokens.filter((token) => !NOISE_WORDS.has(token.toLowerCase()) && !/^\$?[\d.,]+$/.test(token));
  const platformAccessory = compatibilityLedAccessory(inferenceName, detectProductKind(inferenceName));
  const ageDescriptorPrefix = AGE_DESCRIPTOR_PREFIX_RE.test(rawTokens[0] || '');
  const ageDescriptorTokens = ageDescriptorPrefix ? tokens.slice(1) : tokens;
  const ageDescriptorName = ageDescriptorPrefix ? inferenceName.replace(/^\S+\s+/, '') : inferenceName;
  const ageDescriptorPrimaryName = ageDescriptorName.split(/\s+(?:(?:with|including|includes)\s+|w\s*\/\s*)/i, 1)[0] || ageDescriptorName;
  const agePrefixedJewelry = ageDescriptorPrefix
    && /\b(?:rings?|broach|brooch|pin|buckle|pendant|necklace|bracelet|earrings?|jewelry|jewellery)\b/i.test(ageDescriptorPrimaryName);
  const compoundBrand = knownLeadingBrand(inferenceName)
    || knownLeadingBrand(ageDescriptorName);
  const leadingDescriptorName = /^(?:a|an|the|hand|antique|knotted)\b/i.test(rawTokens[0] || '');
  const descriptorLedName = leadingDescriptorName
    || (rawTokens.length > 1 && GENERIC_BRAND_RE.test(rawTokens[0]!) && GENERIC_BRAND_RE.test(rawTokens[1]!));
  const titleBrand = compoundBrand || (ageDescriptorPrefix
    ? ageDescriptorTokens.find((token) => !GENERIC_BRAND_RE.test(token) && !(agePrefixedJewelry && AGE_DESCRIPTOR_GENERIC_RE.test(token))
      && !/^(?:case|group|lot|pair|set)$/i.test(token) && !/^\d/.test(token)) || ''
    : leadingDescriptorName ? '' : tokens.find((token) => !GENERIC_BRAND_RE.test(token)
    && !/^(?:case|group|lot|pair|set)$/i.test(token)
    && !/^\d/.test(token)) || '');
  const statedBrandAppearsInTitle = statedBrand && new RegExp(`\\b${escapeRegExp(statedBrand)}\\b`, 'i').test(name);
  const statedBrandCorroboratedByProse = Boolean(statedBrand && new RegExp(`\\b(?:this|the|a|an)\\s+${escapeRegExp(statedBrand)}\\b`, 'i').test(prose)
    && !new RegExp(`\\b${escapeRegExp(titleBrand)}\\b`, 'i').test(prose));
  const measurementLedName = /^\s*\d+(?:\.\d+)?\s*(?:[x×]\s*\d|(?:in(?:ch(?:es)?)?|ft|feet|foot|mm|cm)\b)/i.test(inferenceName);
  const genericCategoryPrefix = /^[^:]{3,40}:/.test(name) && GENERIC_BRAND_RE.test(rawTokens[0] || '');
  const brand = platformAccessory
    ? statedBrand
    : statedBrand && (!titleBrand || titleBrand.length < 2 || GENERIC_BRAND_RE.test(titleBrand) || statedBrandAppearsInTitle || statedBrandCorroboratedByProse || measurementLedName || descriptorLedName || genericCategoryPrefix)
    ? statedBrand
    : titleBrand;
  const explicitTitleModel = name.match(/\b(?:model|mpn)\s*(?:no\.?|number|#)?\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9+.-]{1,23})\b/i)?.[1] || '';
  const hashNumericModel = name.match(/(?:^|[^A-Za-z0-9])#\s*(\d{3,8})\b/i)?.[1] || '';
  const parenthesizedNumber = name.match(/\(\s*(?:model\s*)?#\s*(\d{3,8})\s*\)/i)?.[1] || '';
  const modelAfterProductWord = name.match(/\bmodel\s+[A-Za-z][A-Za-z-]{2,20}\s+(\d{3,8})\b/i)?.[1] || '';
  const familyNumericSuffix = name.match(/\b([A-Za-z][A-Za-z0-9-]{2,15})\s+(\d{1,4})\s+([A-Z]{2,6})\b/) || [];
  const familyNumericModel = familyNumericSuffix[1]
    && !/^(?:19|20)\d{2}$/.test(familyNumericSuffix[2] || '')
    && !/^(?:PCS?|PACK|COUNT|CT|GB|TB|MB|KB|IN|INCH|OZ|LB|HP|GPH|GPM|PSI|RPM|W|KW|V|A|LED|LCD|USB|HDMI|ISBN|OEM)$/i.test(familyNumericSuffix[3] || '')
    ? `${familyNumericSuffix[1]}${familyNumericSuffix[2]}${familyNumericSuffix[3]}`
    : '';
  // Numeric manufacturer models such as Pelican 1490 are meaningful identity,
  // even though a bare number elsewhere in a title usually is not. Restrict the
  // inference to the token immediately after a credible leading brand and keep
  // ordinary years out of the model path.
  const brandTokenIndex = rawTokens.findIndex((token) => token.toLowerCase() === brand.toLowerCase());
  const numericAfterBrand = brandTokenIndex >= 0 ? rawTokens[brandTokenIndex + 1] || '' : '';
  const numericBrandModel = /^(?:\d{3,12}|\d{2,8}(?:-\d{2,8})+)$/.test(numericAfterBrand)
    && !/^(?:19|20)\d{2}$/.test(numericAfterBrand) ? numericAfterBrand : null;
  const alphabeticAfterBrand = brandTokenIndex >= 0 ? rawTokens[brandTokenIndex + 1] || '' : '';
  const alphabeticBrandModelToken = alphabeticBrandModel(brand, alphabeticAfterBrand);
  const keurigTitleModel = brand.toLowerCase() === 'keurig' ? keurigNamedModel(name) : null;
  const cameraTitleModel = cameraAlphabeticModelFromTokens(brand, detectProductKind(name), rawTokens);
  const inferredModelTokens = rankedInferredModelTokens(rawTokens, inferenceName);
  const packagePrimaryName = name.split(/\s+(?:w\s*\/|with)\s*/i, 1)[0] || name;
  const primaryInferredModelTokens = packagePrimaryName === name
    ? inferredModelTokens
    : rankedInferredModelTokens(tokeniseIdentity(packagePrimaryName), packagePrimaryName);
  const namedFamilyEvidence = brand.toLowerCase() === 'alesis' ? alesisMidiverbEvidence(name) : null;
  const describedNamedModels = brand.toLowerCase() === 'alesis'
    ? explicitDescriptionModels.map(canonicalMidiverbModel).filter((value): value is string => Boolean(value)) : [];
  const crownNamedFamilyEvidence = brand.toLowerCase() === 'crown' ? crownPowerBaseEvidence(name) : null;
  const crownStructuredDescriptionValues = brand.toLowerCase() === 'crown'
    ? crownPowerBaseStructuredDescriptionValues(sourceDescription) : [];
  const describedCrownModels = brand.toLowerCase() === 'crown'
    ? [...new Set([
      ...crownPowerBaseEvidence(sourceDescription).models,
      ...crownPowerBaseStructuredModels(explicitDescriptionModels),
      ...crownPowerBaseStructuredDescriptionModels(sourceDescription),
    ])] : [];
  const crownPowerBaseSource = Boolean(crownNamedFamilyEvidence && (crownNamedFamilyEvidence.models.length > 0
    || /\bcrown\s+power[\s-]*base\b/i.test(name)));
  const crownStructuredModelConflict = crownPowerBaseSource
    && crownStructuredDescriptionValues.some((value) => !canonicalCrownPowerBaseModel(value));
  const namedFamilyConflict = Boolean(namedFamilyEvidence && (namedFamilyEvidence.models.length > 1
    || new Set([...namedFamilyEvidence.models, ...describedNamedModels]).size > 1));
  const namedFamilyModel = namedFamilyEvidence && !namedFamilyEvidence.accessory && namedFamilyEvidence.models.length === 1
    ? namedFamilyEvidence.models[0] : describedNamedModels.length === 1 && !namedFamilyEvidence?.accessory ? describedNamedModels[0] : null;
  const crownNamedFamilyConflict = Boolean(crownNamedFamilyEvidence && (crownNamedFamilyEvidence.models.length > 1
    || new Set([...crownNamedFamilyEvidence.models, ...describedCrownModels]).size > 1
    || crownStructuredModelConflict));
  const crownNamedFamilyModel = crownNamedFamilyEvidence && !crownNamedFamilyEvidence.accessory && crownNamedFamilyEvidence.models.length === 1
    ? crownNamedFamilyEvidence.models[0] : describedCrownModels.length === 1 && !crownNamedFamilyEvidence?.accessory ? describedCrownModels[0] : null;
  const keurigStructuredModels = explicitDescriptionModels
    .flatMap((value) => keurigNamedModelsInPrimary(value));
  const keurigSourceModels = keurigPrimaryModels(name, keurigStructuredModels, primaryProse);
  const keurigNamedFamilyConflict = brand.toLowerCase() === 'keurig' && keurigSourceModels.length > 1;
  const keurigNamedFamilyModel = keurigSourceModels.length === 1 ? keurigSourceModels[0] : null;
  const titleModelBase = brand.toLowerCase() === 'keurig'
    ? keurigTitleModel
    : primaryInferredModelTokens[0] ?? alphabeticBrandModelToken ?? numericBrandModel ?? cameraTitleModel;
  const titleModelIndex = titleModelBase ? rawTokens.findIndex((token) => token.toLowerCase() === titleModelBase.toLowerCase()) : -1;
  const titleModelSuffix = titleModelIndex >= 0 ? rawTokens[titleModelIndex + 1] || '' : '';
  const joinSingleLetterSuffix = Boolean(titleModelBase && /^\d{3,6}$/.test(titleModelBase) && /^[A-Z]$/.test(titleModelSuffix));
  const joinManufacturerSuffix = Boolean(titleModelBase
    && !titleModelBase.includes('-')
    && /\d$/.test(titleModelBase)
    && /^[A-Z]{3,4}$/.test(titleModelSuffix)
    && !/^(?:CPU|GPU|USB|LED|LCD|SSD|HDD|RAM|WIFI|HDMI|OEM|ISBN|EVIS|PLC|IPC|TPMS|ECU)$/i.test(titleModelSuffix));
  const titleModel = titleModelBase && (joinSingleLetterSuffix || joinManufacturerSuffix)
    ? `${titleModelBase}${titleModelSuffix}`
    : titleModelBase;
  const explicitModel = [explicitTitleModel, hashNumericModel, parenthesizedNumber, modelAfterProductWord, familyNumericModel].find((value) => looksLikeModel(value)) || null;
  const validStatedModel = brand.toLowerCase() === 'keurig'
    ? keurigNamedModel(statedModel)
    : (looksLikeModel(statedModel) ? statedModel : null);
  const structuredOrTitleModel = (validStatedModel && modelMatches(name, validStatedModel) ? validStatedModel : null)
    || explicitModel || titleModel || validStatedModel;
  const proseModel = !structuredOrTitleModel ? recoverPrimaryProseModel(name, primaryProse, brand) : null;
  const carvinIdentity = carvinProBassPrimaryIdentity(name);
  const carvinStructuredConflict = carvinIdentity.model === CARVIN_PRO_BASS_150_MODEL
    && Boolean(statedModel && looksLikeModel(statedModel)
      && !modelMatches(carvinIdentity.model, statedModel)
      && !carvinProBass150StructuredAlias(statedModel));
  const carvinSourceConflict = carvinIdentity.conflict || carvinStructuredConflict;
  const model = namedFamilyConflict || crownNamedFamilyConflict || carvinSourceConflict || keurigNamedFamilyConflict
    ? null
    : carvinIdentity.model || crownNamedFamilyModel || keurigNamedFamilyModel || structuredOrTitleModel || proseModel || namedFamilyModel;
  const model2 = inferredModelTokens.find((token) => token.toLowerCase() !== String(model ?? '').toLowerCase()
    && !modelMatches(model || '', token)
    && token.toLowerCase() !== brand.toLowerCase()) ?? null;
  const capacities = [...new Set(tokens.filter((token) => CAPACITY_RE.test(token)))];
  const discriminators = extractProductDiscriminators(name);
  if (namedFamilyConflict) discriminators.variantLabels.push('alesis-midiverb:source-conflict');
  if (crownNamedFamilyConflict) discriminators.variantLabels.push('crown-power-base:source-conflict');
  if (carvinSourceConflict) discriminators.variantLabels.push('carvin-pro-bass:source-conflict');
  if (keurigNamedFamilyConflict) discriminators.variantLabels.push('keurig-named-model:source-conflict');
  if (recoveredNamedVariant) {
    discriminators.variantLabels = uniqueStrings([
      ...discriminators.variantLabels,
      `named-deck:${recoveredNamedVariant}`,
    ]);
  }
  const queryName = researchIdentityName(stripCorroboratedNonOperationalSuffix(inferenceName, sourceDescription), model || null, sourceDescription);
  const researchName = [
    brand && !compactIdentityText(name).includes(compactIdentityText(brand)) ? brand : '',
    queryName,
    model && !modelMatches(queryName, model) ? model : '',
  ].filter(Boolean).join(' ');
  const partialBundle = explicitlyPartialBundle(sourceDescription);
  let query = buildProductResearchQuery(partialBundle ? stripAdvertisedBundleLabels(researchName) : researchName);
  if (COLLECTIBLE_DECK_TITLE_RE.test(researchName) && COLLECTIBLE_GAME_TITLE_RE.test(researchName)) {
    query = canonicalizeCollectibleNamedVariantAliases(query);
  }
  if (recoveredNamedVariant) {
    const variantQuery = buildProductResearchQuery(recoveredNamedVariant);
    if (variantQuery && !query.includes(variantQuery)) query = `${query} ${variantQuery}`.trim();
  }
  if (discriminators.gpuModels.includes('nvidia:rtx:4070:ti-super') && !/\brtx\s*4070\s*ti\s+super\b/i.test(query)) {
    query = query.replace(/\brtx\s*4070\s*ti\b/i, (value) => `${value} super`);
  }
  if ((model || discriminators.gpuModels.length || discriminators.cpuModels.length) && !discriminators.seriesSignatures.length) {
    discriminators.seriesSignatures = [];
  }
  const describedDiscriminators = extractProductDiscriminators(`${name}\n${sourceDescription}`);
  for (const group of ['engineDisplacements', 'horsepower', 'motorFrames', 'impactRates'] as const) {
    const values = describedDiscriminators[group];
    if (values?.length) discriminators[group] = uniqueStrings([...(discriminators[group] || []), ...values]);
  }
  const describedRingSize = ringSizeEvidence(sourceDescription, jewelryRingContext(name));
  if (describedRingSize.state !== 'missing') {
    const titleRingSize = ringSizeEvidence(name);
    const values = uniqueStrings([...(discriminators.ringSizes || []), ...describedRingSize.sizes]);
    discriminators.ringSizes = titleRingSize.state === 'uncertain' || describedRingSize.state === 'uncertain' || values.length !== 1 ? [] : values;
  }
  const includedComponents = extractDescriptionBundleComponents(sourceDescription);
  const identity: ProductIdentity = {
    name,
    query: query.trim(),
    brand,
    model: model || null,
    model2,
    kind: detectProductKind(name),
    capacities,
    discriminators,
    tokens: tokens.slice(0, 12),
    ...(includedComponents.length ? { includedComponents } : {}),
    ...(partialBundle ? { explicitlyPartialBundle: true } : {}),
  };
  if (record?.statedRetail != null && Number.isFinite(record.statedRetail) && record.statedRetail > 0) identity.statedRetail = record.statedRetail;
  return identity;
}

/** Ported from hibid-enhancer-suite: the auctioneer's own retail claim. */
export function extractStatedRetail(
  lead: string | null | undefined,
  description: string | null | undefined,
  estimateText: string | null | undefined = ''
): StatedRetailEvidence | null {
  const hay = normalise([lead, description].filter(Boolean).join('\n'));
  const patterns = [
    /Est\.?\s*Retail\s*Price\s*:?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /\bRetail\s*(?:Price)?\s*:?\s*\$\s*([\d,]+(?:\.\d{1,2})?)/i,
    /\bMSRP\s*:?\s*\$?\s*([\d,]+(?:\.\d{1,2})?)/i,
    /^\s*\$\s*([\d,]+(?:\.\d{1,2})?)\s*(?:\||\s)/,
  ];
  for (const pattern of patterns) {
    const match = hay.match(pattern);
    const value = match ? Number(String(match[1]).replace(/,/g, '')) : 0;
    if (Number.isFinite(value) && value > 0) return { value, source: `stated in listing ("${match![0].trim()}")` };
  }
  const values = String(estimateText || '').match(/[\d,]+(?:\.\d{1,2})?/g)
    ?.map((value) => Number(value.replace(/,/g, '')))
    .filter((value) => Number.isFinite(value) && value > 0) || [];
  if (!values.length) return null;
  const value = Math.max(...values);
  return { value, source: `auctioneer estimate high (${String(estimateText).trim()})` };
}

export const extractProduct = extractProductIdentity;

export function assessLotCondition(record: LotAnalysisRecord | string | null | undefined): ConditionAssessment {
  if (typeof record === 'string' || record == null) return assessCondition(record);
  const conditionField = record.condition ? `Condition: ${record.condition}` : '';
  return assessCondition([record.title, record.lead, record.description, conditionField].filter(Boolean).join('\n'), record.title || record.lead || '');
}

function namedCollectionComponents(title: string): string[] {
  const list = title.match(/^(?:(?:lot|set|group)\s+of\s+)?(?:\(?[2-9]\d*\)?|\(?\d{2,}\)?|two|three|four|five|six|seven|eight|nine|ten)\s+[^\n:;]{0,80}?\b(?:bottles|perfumes|fragrances|tools|devices|tablets|consoles|cameras|lenses|vases|figurines|watches|headphones|speakers|monitors|drills|saws)\s*[-:]\s*(.+)$/i);
  if (!list) return [];
  if (/^\s*(?:compatible\s+with|compatibility|fits|for\s+use\s+with)\b/i.test(list[1]!)) return [];
  // Commas inside component condition notes are not collection separators.
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < list[1]!.length; index++) {
    const character = list[1]![index];
    if (character === '(') depth++;
    else if (character === ')') {
      if (depth === 0) return [];
      depth--;
    }
    else if (depth === 0 && (character === ',' || character === ';')) {
      parts.push(list[1]!.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(list[1]!.slice(start));
  if (depth !== 0) return [];
  const seen = new Set<string>();
  const named = parts.map((part) => part.replace(/^\s*and\s+/i, '').trim()).filter((part) => {
    let noteDepth = 0;
    let identityText = '';
    for (const character of part) {
      if (character === '(') noteDepth++;
      else if (character === ')') noteDepth--;
      else if (noteDepth === 0) identityText += character;
    }
    const identity = identityText.trim().replace(/\s+/g, ' ');
    if (/^(?:compatible\s+with|compatibility|fits|for\s+use\s+with)\b/i.test(identity)) return false;
    if (!/^[a-z][\w+.'-]*\s+[a-z\d]/i.test(identity)
      || /^(?:new|used|tested|untested|working|functional|damaged|sealed|open\s+box|bpa\s+free|dishwasher\s+safe|leak\s*proof|wide\s+neck|free\s+shipping|stainless\s+steel|night\s+vision|motion\s+detection|noise\s+cancell?ing|auto\s+focus|image\s+stabili[sz]ation|optical\s+zoom|digital\s+zoom)\b/i.test(identity)) return false;
    // A count and two words alone do not establish an included product identity.
    const product = extractProductIdentity(identity);
    const explicitMaker = knownLeadingBrand(identity)
      || /^(?:Dior|Coty|Dana|Chanel|Guerlain|Lancome|Canon|Nikon|Fujifilm|Olympus|Pentax|Panasonic|Makita|Milwaukee|DeWalt|Bosch|Ryobi)\b/i.test(identity)
      || canonicalBrandFamily(product.brand);
    if (!explicitMaker && !product.model) return false;
    const key = identity.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return named.length > 1 ? named : [];
}

export function detectMixedLot(title: string | null | undefined, description = ''): MixedLotResult {
  const titleText = normalise(title);
  const descriptionText = normalise(description);
  if (/\b(?:loot\s+lot|mystery\s+(?:box|lot))\b/i.test(titleText)
    && /\b(?:surprise\s+items?|(?:contents?|items?)\s+(?:vary|unknown|undisclosed))\b/i.test(descriptionText)) {
    return { mixed: true, reasons: ['undisclosed contents require identification before product research'], components: [] };
  }
  const reasons: string[] = [];
  const namedCollection = namedCollectionComponents(titleText);
  if (namedCollection.length) reasons.push('collection lists distinct named products');
  const checks: Array<[string, RegExp, string]> = [
    ['title', /\b(?:group|assortment|assorted|asst\.?|various|mixed|contents)\b|\bcollection\s+of\b/i, 'group or mixed-lot wording'],
    ['title', /\b(?:coin|stamp|record|book|magazine|photo|memorabilia)\s+collection\b/i, 'collectible collection wording'],
    ['title', /\bdining\s+(?:room\s+)?table\s+(?:and|&)\s+chairs?\b/i, 'table and chairs are separate components'],
    ['title', /\bgolf\s+bag\b[^\n;]{0,60}\b(?:with|w\/?|and)\s+clubs?\b/i, 'golf bag and clubs are separate components'],
    ['title', /\b(?:bundle|lot)\s+of\s+(?:different|assorted|mixed|various)\b/i, 'mixed bundle wording'],
    ['title', /\blot\s+of\s+(?!\(?\d+\)?\s)[^\n;]{0,80}\b[a-z]{3,}s\s+(?:and|[&+])\s+[a-z][^\n;]{2,80}/i, 'lot names separate components'],
    ['title', /\blot\s+of\s+(?!\(?\d+\)?\s)[^\n;]{2,80},\s+(?!(?:tested|working|new|used|open|sealed|functional|damaged)\b)[a-z]{2,}[^\n;]{2,80}/i, 'lot names separate components'],
    ['title', /\b(?:bundle|lot)\s+of\s+\(?\s*(?:[2-9]|\d{2,})\s*\)?\b[^\n;]{0,80}(?:\band\b|\s[&+]\s)/i, 'multiple named lot components'],
    ['title', /^\s*(?:lot\s+of\s+)?(?:[2-9]|\d{2,})\s+[^\n;]{0,80}\b(?:books|albums|records|lps|lp['’]s|dvds|cds)\b/i, 'multiple collectible media items'],
    ['title', /^\s*(?:[2-9]|\d{2,})\s+pieces?\s+of\s+[^\n;]{1,80}(?:\band\b|\s[&+]\s)/i, 'multiple named pieces'],
    ['description', /\bboth\s+(?:are|items?|pieces?)\b/i, 'seller describes two items'],
    ['title', /\bwith\s+(?:components?|contents?|assorted\s+items?|mixed\s+items?|equipment)\b/i, 'explicit component or contents wording'],
    ['title', /\b(?:amp|amplifier|receiver)\b\s*,\s*[^,;]{0,60}\b(?:tuner|turntable|cd\s+player|cassette\s+player)\b/i, 'separate audio components'],
    ['description', /\b(?:assorted|mixed|various)\s+(?:items?|components?|equipment|contents)\b/i, 'description identifies assorted components'],
    ['description', /(?:^|[.!?]\s+|\b(?:contains?|includes?|offered\s+as|sold\s+as)\s+|\bsize\s+[a-z]{1,4}(?:-[a-z]{1,4})?\s+)(?:an?\s+)?collection\s+of\b[^\n.!?]{0,80}(?:\band\b|&)/i, 'description identifies a collection of different items'],
    ['description', /\blot\s+of\s*\(?\s*(?:[2-9]|\d{2,})\s*\)?\s+consisting\s+of\b/i, 'description identifies multiple lot components'],
  ];
  for (const [source, pattern, reason] of checks) if (pattern.test(source === 'title' ? titleText : descriptionText)) reasons.push(reason);
  const parsed = parseStructuredDescription(description);
  const sharedAuctionBoilerplate = /(?:\bdue\s+to\b[^.!?\n]*(?:weather|rain|wind|snow|storm|nor['’]?easter)|\bpickup\s+dates?\s+(?:are|have\s+been|now)|\bpickup\s+locations?\s+(?:are|will\s+be)|\b(?:local\s+)?pickup\s+only\b|\bshipping\s+(?:available|unavailable|information|details?)\b|\bbuyer['’]?s?\s+premium\b|\bsales?\s+tax\b|\ball\s+sales?\s+final\b|\bwinning\s+bidders?\b)/i;
  const stripTrailingAuctionBoilerplate = (value: string): string => value
    .replace(/\s*(?:[.!?]\s*)?(?:\b(?:local\s+)?pickup\s+only\b|\bshipping\s+(?:available|unavailable|information|details?)\b|\bbuyer['’]?s?\s+premium\b|\bsales?\s+tax\b|\ball\s+sales?\s+final\b)\s*[.!?]?\s*$/i, '')
    .trim();
  const componentNarrative = parsed.freeText.split('\n').flatMap((line) => {
    const labeled = line.match(/^\s*(?:mixed\s+)?components?\s*:\s*(.*)$/i);
    const entries = (labeled ? String(labeled[1] || '').split(/\s*;\s*/) : [line])
      .flatMap((entry) => entry.split(/(?<=[.!?])\s+(?=[A-Z0-9])/))
      .map(stripTrailingAuctionBoilerplate);
    return entries.map((entry) => entry.replace(/[.!?]+$/, '').trim()).filter((entry) => {
      if (!entry || sharedAuctionBoilerplate.test(entry)
        || /^(?:please\s+)?see\s+(?:all\s+|the\s+)?photos?\b|^in\s+(?:good|fair|excellent|poor|very\s+good|used|new)\s+condition\b|^some\s+(?:chips|wear|damage|scratches)\b/i.test(entry)
        || /\b(?:requires?\s+manual\s+review|manual\s+review|required\s+review|not\s+(?:identified|specified|available)|none\s+(?:identified|listed)|see\s+(?:the\s+)?photos?\s+for\s+details?)\b/i.test(entry)) return false;
      return !labeled || /\b[a-z][a-z0-9+.-]*\d[a-z0-9+.-]*\b/i.test(entry) || /\s+/.test(entry);
    });
  });
  const componentSource = [titleText, ...componentNarrative].filter(Boolean).join('\n');
  const components = [...new Set([...namedCollection, ...componentSource
    .split(/\n|;|\s+-\s+|\s*[•]\s*/)
    .map((part) => part.replace(/^\s*(?:retail|msrp|value)\s*[:\-]?\s*\$?[\d,.]+\s*\|?\s*/i, '').trim())
    .filter((part) => part.length >= 3 && !/^(?:untested|tested|working|condition\b|notes?\b)/i.test(part))])]
    .filter((part) => !/^group\s+of\s+\d+$/i.test(part));
  return { mixed: reasons.length > 0, reasons: [...new Set(reasons)], components: reasons.length > 0 ? components : [] };
}

function amount(value: number | null | undefined, name: string, allowMissing = false): number {
  if (value == null && allowMissing) return 0;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new RangeError(`${name} must be a finite non-negative number`);
  return value;
}

export function selectAuctionHammer(nextBid: number | null | undefined, currentBid: number | null | undefined): number | null {
  if (typeof nextBid === 'number' && Number.isFinite(nextBid) && nextBid > 0) return nextBid;
  if (typeof currentBid === 'number' && Number.isFinite(currentBid) && currentBid >= 0) return currentBid;
  return null;
}

export function calculateUsAllIn(input: UsAllInInput): UsAllInResult {
  const hammer = amount(input.hammer, 'hammer');
  const premiumPct = amount(input.buyerPremiumPct, 'buyerPremiumPct');
  const taxPct = amount(input.salesTaxPct, 'salesTaxPct');
  const premium = hammer * premiumPct / 100;
  const taxableSubtotal = hammer + (input.taxOnPremium === false ? 0 : premium);
  const tax = taxableSubtotal * taxPct / 100;
  return { currency: 'USD', hammer, premium, taxableSubtotal, tax, total: hammer + premium + tax };
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, digits: string) => String.fromCharCode(Number(digits)))
    .replace(/&#x([0-9a-f]+);/gi, (_, digits: string) => String.fromCharCode(parseInt(digits, 16)));
}

function stripTags(value: string): string {
  return decodeHtml(value.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

function htmlAttribute(block: string, name: string): string {
  const match = block.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return match?.[1] ? decodeHtml(match[1]) : '';
}

function cleanAmazonCandidateTitle(value: string | null | undefined): string {
  return normalise(value)
    .replace(/^Sponsored\s*Ad\s*[\u2013-]\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Amazon's current search card can expose a brand-only first h2 while the
 * product image/title recipe still carries the full identity. Pick the richest
 * complete title instead of trusting DOM order.
 */
export function selectAmazonCandidateTitle(values: Array<string | null | undefined>): string {
  const candidates = [...new Set(values.map(cleanAmazonCandidateTitle).filter(Boolean))];
  let best = '';
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const words = compactTokens(candidate);
    let score = Math.min(candidate.length, 360);
    if (words.length <= 1) score -= 240;
    if (/(?:\.{3}|\u2026)\s*$/.test(candidate)) score -= 180;
    if (USED_RE.test(candidate)) score += 24;
    if (/\d/.test(candidate) && /[a-z]/i.test(candidate)) score += 12;
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

function htmlText(block: string, selector: RegExp): string {
  const match = block.match(selector);
  return match?.[1] ? stripTags(match[1]) : '';
}

function parseAmazonPrice(block: string): number | null {
  const offscreen = htmlText(block, /<span[^>]*class=["'][^"']*a-offscreen[^"']*["'][^>]*>([\s\S]*?)<\/span>/i);
  if (offscreen) {
    const parsed = firstNumber(offscreen);
    if (parsed != null) return parsed;
  }
  const whole = htmlText(block, /<span[^>]*class=["'][^"']*a-price-whole[^"']*["'][^>]*>([\s\S]*?)<\/span>/i).replace(/[^\d]/g, '');
  const fraction = htmlText(block, /<span[^>]*class=["'][^"']*a-price-fraction[^"']*["'][^>]*>([\s\S]*?)<\/span>/i).replace(/[^\d]/g, '');
  if (!whole) return null;
  const parsed = Number(`${whole}.${fraction || '00'}`);
  return Number.isFinite(parsed) ? parsed : null;
}

function amazonResultSlug(block: string, asin: string): string {
  const match = block.match(new RegExp(`href\\s*=\\s*["']([^"']*?/(?:dp|gp/product)/${asin}(?:[/?#][^"']*)?)["']`, 'i'));
  if (!match?.[1]) return '';
  try {
    const url = new URL(decodeHtml(match[1]), 'https://www.amazon.com');
    const parts = url.pathname.split('/').filter(Boolean);
    const marker = parts.findIndex((part) => /^(?:dp|product)$/i.test(part));
    const slug = marker > 0 ? parts[marker - 1] : '';
    return decodeURIComponent(slug || '').replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

export function parseAmazonCandidates(html: string | null | undefined): AmazonCandidate[] {
  const source = String(html ?? '');
  const starts = [...source.matchAll(/<div\b[^>]*\bdata-asin\s*=\s*["']([A-Z0-9]{10})["'][^>]*>/gi)];
  const byAsin = new Map<string, AmazonCandidate>();
  starts.forEach((match, index) => {
    const start = match.index ?? 0;
    const end = starts[index + 1]?.index ?? source.length;
    const block = source.slice(start, end);
    const asin = match[1]?.toUpperCase();
    if (!asin) return;
    const headings = [...block.matchAll(/<h2\b[^>]*>([\s\S]*?)<\/h2>/gi)].map((entry) => stripTags(entry[1] || ''));
    const recipes = [...block.matchAll(/<[^>]*(?:data-cy=["']title-recipe["']|class=["'][^"']*(?:s-title-instructions-style|a-size-base-plus)[^"']*["'])[^>]*>([\s\S]*?)<\/[^>]+>/gi)]
      .map((entry) => stripTags(entry[1] || ''));
    const imageAlt = htmlAttribute(block.match(/<img\b[^>]*class=["'][^"']*\bs-image\b[^"']*["'][^>]*>/i)?.[0] || '', 'alt');
    const titleEvidence = [imageAlt, ...recipes, ...headings];
    const title = selectAmazonCandidateTitle(titleEvidence);
    if (!title) return;
    const slug = amazonResultSlug(block, asin);
    const matchText = [...new Set([title, ...titleEvidence.map(cleanAmazonCandidateTitle), slug].filter(Boolean))].join(' ');
    const sponsored = /data-component-type=["']sp-sponsored-result|\bAdHolder\b|\bSponsored(?:\s+Ad)?\b|sponsored-label-text/i.test(block);
    const candidate: AmazonCandidate = {
      asin,
      title,
      matchText,
      price: parseAmazonPrice(block),
      used: USED_RE.test(matchText),
      sponsored,
      url: `https://www.amazon.com/dp/${asin}`,
    };
    const previous = byAsin.get(asin);
    if (!previous || (previous.sponsored && !candidate.sponsored) || (previous.sponsored === candidate.sponsored && (candidate.price ?? Infinity) < (previous.price ?? Infinity))) {
      byAsin.set(asin, candidate);
    }
  });
  return [...byAsin.values()];
}

export function parseAmazonSearchHtml(html: string | null | undefined, _query?: string): AmazonCandidate[] {
  return parseAmazonCandidates(html);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function canonicalBrandFamily(value: string | null | undefined): string | null {
  const source = normalise(value);
  return BRAND_FAMILIES.find(([, pattern]) => pattern.test(source))?.[0] ?? null;
}

function literalBrandMatches(candidateTitle: string, brand: string): boolean {
  if (!brand) return false;
  const fold = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const brandParts = fold(brand).split(/\s*(?:\+|&|\band\b)\s*/i).filter(Boolean);
  const phrase = brandParts.length > 1
    ? brandParts.map(escapeRegExp).join('\\s*(?:\\+|&|and)\\s*')
    : escapeRegExp(fold(brand)).replace(/\s+/g, '\\s+');
  return new RegExp(`(?:^|[^a-z0-9])${phrase}(?:$|[^a-z0-9])`, 'i').test(fold(candidateTitle));
}

function productBrandFamily(product: ProductIdentity): string | null {
  const credible = Boolean(product.brand)
    && !GENERIC_BRAND_RE.test(product.brand)
    && !CAPACITY_RE.test(product.brand)
    && /[a-z]/i.test(product.brand);
  return credible ? canonicalBrandFamily(product.brand) : canonicalBrandFamily(product.name);
}

function inferredBrandAliases(brand: string): string[] {
  const aliases = [brand];
  // Auction titles occasionally concatenate a feature badge to the maker
  // (for example "SAMYUCHOLED"). Keep the original identity, but also allow
  // the credible maker stem when Amazon separates the badge from the brand.
  const featureSuffix = brand.match(/^([a-z0-9][a-z0-9-]{4,})(led|rgb|usb)$/i);
  if (featureSuffix?.[1]) aliases.push(featureSuffix[1]);
  return [...new Set(aliases)];
}

function brandEvidence(candidateTitle: string, product: ProductIdentity): { matches: boolean; expected: boolean; label: string } {
  const credible = Boolean(product.brand) && !GENERIC_BRAND_RE.test(product.brand) && !CAPACITY_RE.test(product.brand) && /[a-z]/i.test(product.brand);
  if (!credible) return { matches: false, expected: false, label: '' };
  if (compatibilityLedAccessory(product.name, product.kind)) {
    const makerContext = candidateTitle.split(/\b(?:for|compatible\s+with|made\s+for|designed\s+for|fits)\b/i, 1)[0] || '';
    const aliases = inferredBrandAliases(product.brand);
    const matches = aliases.some((alias) => literalBrandMatches(makerContext, alias)
      || new RegExp(`\\bby\\s+${escapeRegExp(alias)}\\b`, 'i').test(candidateTitle));
    return { matches, expected: true, label: product.brand.toLowerCase() };
  }
  const expectedFamily = productBrandFamily(product);
  const candidateFamily = canonicalBrandFamily(candidateTitle);
  if (expectedFamily) return { matches: candidateFamily === expectedFamily, expected: true, label: expectedFamily };
  const aliases = inferredBrandAliases(product.brand);
  return {
    matches: aliases.some((alias) => literalBrandMatches(candidateTitle, alias)),
    expected: true,
    label: aliases.at(-1)!.toLowerCase(),
  };
}

function productIdentityEvidenceCount(product: ProductIdentity): number {
  const discriminators = product.discriminators || extractProductDiscriminators(product.name);
  return Object.values(discriminators).reduce((total, values) => total + values.length, 0);
}

const RETAIL_IDENTITY_NOISE = new Set([
  ...NOISE_WORDS,
  'adult', 'adults', 'black', 'blue', 'clear', 'green', 'grey', 'gray', 'kids',
  'large', 'medium', 'pink', 'purple', 'red', 'small', 'white', 'wooden',
  'bluetooth', 'cordless', 'portable', 'rechargeable', 'smart', 'wireless',
  'computer', 'computers', 'custom', 'desktop', 'desktops', 'pc', 'tower', 'workstation', 'workstations',
  'card', 'cards', 'geforce', 'gpu', 'gpus', 'graphics', 'gtx', 'radeon', 'rtx', 'video',
  'box', 'lightly', 'tested', 'untested', 'used', 'working',
]);

function retailIdentityTokens(product: ProductIdentity): string[] {
  return [...new Set(compactTokens(product.name)
    .map((token) => token.toLowerCase().replace(/[^a-z0-9]+/g, ''))
    .filter((token) => token.length > 2 && !RETAIL_IDENTITY_NOISE.has(token) && !/^\d+$/.test(token)))];
}

function candidateTokenOverlap(candidateTitle: string, product: ProductIdentity): { hits: number; total: number; ratio: number } {
  const expected = retailIdentityTokens(product);
  const candidate = new Set(compactTokens(candidateTitle).map((token) => token.replace(/[^a-z0-9]+/g, '')));
  const hits = expected.filter((token) => candidate.has(token)).length;
  return { hits, total: expected.length, ratio: expected.length ? hits / expected.length : 0 };
}

export function hasSufficientRetailIdentity(product: ProductIdentity): boolean {
  if (compatibilityLedAccessory(product.name, product.kind) && !product.brand) return false;
  if (product.model) return true;
  return retailIdentityTokens(product).length >= 3
    || (Boolean(product.kind) && productIdentityEvidenceCount(product) > 0);
}

function primaryKindIndex(title: string, kind: ProductKind | null): number {
  if (!kind) return -1;
  const pattern = PRODUCT_KIND_PATTERNS.find(([candidate]) => candidate === kind)?.[1];
  return pattern?.exec(title)?.index ?? -1;
}

const COMPATIBILITY_PLATFORM_PREFIX = /^(?:(?:amazon|apple|samsung|microsoft|sony)\s+)?(?:fire(?:\s+hd)?|kindle|ipad|galaxy|surface|xbox|playstation|ps[2-6])\b/i;

function compatibilityLedAccessory(name: string, kind: ProductKind | null): boolean {
  return COMPATIBILITY_PLATFORM_PREFIX.test(name) && sourceIsAccessoryProduct({ name, kind });
}

function printerComponentIsIncluded(title: string, component: RegExpExecArray): boolean {
  const before = title.slice(0, component.index);
  const after = title.slice(component.index + component[0].length);
  const connector = /\b(?:with|includes?|including|plus|bundled\s+with|without|no|missing)\b|\bw\s*\/\s*/i;
  return connector.test(before)
    || /^\s*(?:[-,:;]\s*)?(?:is\s+)?(?:included|supplied|installed)\b/i.test(after)
    || /^\s+(?:cartridges?|tanks?|bottles?)\b[^,;]{0,30}\b(?:included|supplied)\b/i.test(after);
}

function standalonePrinterComponent(title: string): RegExpExecArray | null {
  const pattern = new RegExp(`${PRINTER_COMPONENT_NOUN_RE.source}|${PRINTER_COMPONENT_SUBJECT_RE.source}`, 'gi');
  let match: RegExpExecArray | null = null;
  while ((match = pattern.exec(title))) {
    if (!printerComponentIsIncluded(title, match)) return match;
  }
  return null;
}

function sourceIsPrinterComponent(title: string): boolean {
  return Boolean(standalonePrinterComponent(title));
}

function hasPhotographicFlashContext(title: string): boolean {
  return /\b(?:cameras?|speedlites?|speedlights?|strobes?|photographic\s+flash)\b/i.test(title)
    || /\b(?:canon\s+)?ae[\s-]*1\b/i.test(title);
}

function primaryFlashSubject(title: string): boolean {
  const source = normalise(title);
  if (!hasPhotographicFlashContext(source)) return false;
  const flash = /\bflash(?:es)?\b/i.exec(source);
  if (!flash) return false;
  if (/\bflash\s+(?:storage|case|bag|pouch|holder|cover|sleeve)\b/i.test(source)) return false;
  const camera = /\bcameras?\b/i.exec(source);
  if (!camera || camera.index > flash.index) return true;
  const between = source.slice(camera.index + camera[0].length, flash.index);
  if (/\b(?:with|includes?|including|plus|bundled\s+with|built[\s-]*in|featuring|has|without|no|missing)\b|\bw\s*\/\s*/i.test(between)) return false;
  const after = source.slice(flash.index + flash[0].length);
  if (/^\s*(?:[-,:;]\s*)?(?:is\s+)?(?:included|supplied|installed|not\s+included|not\s+supplied|sold\s+separately|excluded)\b/i.test(after)) return false;
  return true;
}

function componentDescribesPrimaryUnit(title: string, noun: RegExpExecArray, primaryEnd: number): boolean {
  if (primaryEnd < 0 || primaryEnd > noun.index) return false;
  const before = title.slice(primaryEnd, noun.index);
  const after = title.slice(noun.index + noun[0].length);
  // Only text before the first component can attach inclusion to the primary
  // equipment. Modifiers are unrestricted, but the attachment stays in-clause.
  if (/\b(?:for|fits?|compatible\s+with)\b/i.test(before)) return false;
  const attached = /(?:\b(?:with|includes?|including|plus|bundled\s+with|without|missing|no|needs?|requires?)\s+|\bw\s*\/\s*)(?:(?!\.\s)[^,;!?\r\n]){0,80}$/i.test(before);
  const status = /^\s*(?:[-,:;]\s*)?(?:(?:are|is)\s+)?(?:missing|absent|present|included|supplied|installed|not\s+(?:included|present|supplied))\b/i.test(after);
  return attached || status;
}

function standaloneKnobSubject(title: string, noun: RegExpExecArray, product: Pick<ProductIdentity, 'kind'> & Partial<Pick<ProductIdentity, 'model'>>): boolean {
  const prefix = title.slice(0, noun.index);
  if (/\b(?:for|fits?|compatible\s+with)\b/i.test(prefix)) return true;
  const kindIndex = primaryKindIndex(prefix, product.kind);
  const model = product.model
    ? new RegExp(escapeRegExp(product.model).replace(/[-\s]/g, '[-\\s]?'), 'i').exec(prefix)
    : null;
  const primaryEnd = kindIndex >= 0 ? kindIndex : model ? model.index + model[0].length : -1;
  return !componentDescribesPrimaryUnit(title, noun, primaryEnd);
}

const BAND_SAW_RE = /\bband[\s-]*saws?\b/i;
const BAND_SAW_COMPONENT_RE = new RegExp(`\\b(?:blades?(?:[\\s-]+guides?)?|guides?|tires?|tyres?|switch(?:es)?|motors?|knobs?|belts?|pulleys?|bearings?|wheels?|trunnions?|tables?|tension[\\s-]+springs?|fences?|guards?|guide[\\s-]*posts?|blocks?|hinges?|shafts?|bolts?)\\b|${ACCESSORY_NOUN_RE.source}`, 'i');

function standaloneBandSawComponent(title: string): boolean {
  const subject = title.replace(BAND_SAW_RE, (match) => ' '.repeat(match.length));
  const component = BAND_SAW_COMPONENT_RE.exec(subject);
  if (!component) return false;
  const saw = BAND_SAW_RE.exec(title);
  const primaryEnd = saw ? saw.index + saw[0].length : -1;
  return !componentDescribesPrimaryUnit(title, component, primaryEnd);
}

function sourceIsAccessoryProduct(product: Pick<ProductIdentity, 'name' | 'kind'> & Partial<Pick<ProductIdentity, 'model'>>): boolean {
  if (/\bstand\s+mixers?\b/i.test(product.name)) return false;
  if (BAND_SAW_RE.test(product.name)) return standaloneBandSawComponent(product.name);
  if (primaryFlashSubject(product.name)) return true;
  if (sourceIsPrinterComponent(product.name)) return true;
  const ams = PRINTER_AMS_RE.exec(product.name);
  if (ams) {
    const printerIndex = primaryKindIndex(product.name, 'printer');
    if (printerIndex < 0 || (ams.index < printerIndex && !printerIncludesAms(product.name, ams))) return true;
  }
  const noun = ACCESSORY_NOUN_RE.exec(product.name)
    ?? /\b(batter(?:y|ies))\b/i.exec(product.name)
    ?? (product.kind === 'printer' ? PRINTER_COMPONENT_NOUN_RE.exec(product.name) : null);
  if (!noun) return false;
  if (/^knobs?$/i.test(noun[0])) return standaloneKnobSubject(product.name, noun, product);
  if (/^(?:pods?|capsules?)$/i.test(noun[0])
    && /\b(?:coffee|espresso|capsule)\s+(?:makers?|machines?|brewers?)\b/i.test(product.name)) return false;
  const afterNoun = product.name.slice(noun.index + noun[0].length);
  if (/\b(?:included|supplied)\b/i.test(afterNoun) && !/\b(?:not|never|without)\b/i.test(afterNoun)) return false;
  if (/^batter(?:y|ies)$/i.test(noun[0]) && /^\s*[- ]?(?:powered|operated)\b/i.test(afterNoun)) return false;
  const before = product.name.slice(0, noun.index);
  const connector = /(?:(?:\bwith|\bincludes?|\bincluding|\bbundled\s+with|\bplus)\b|\bw\s*\/)[^,;]{0,40}$/i;
  if (connector.test(before)) return false;
  const kindIndex = primaryKindIndex(product.name, product.kind);
  if (kindIndex >= 0 && kindIndex < noun.index && connector.test(before.slice(kindIndex))) return false;
  return true;
}

function printerIncludesAms(title: string, ams: RegExpExecArray): boolean {
  const printer = /\bprinters?\b/i.exec(title);
  if (!printer || amsMentionIsNegated(title, ams)) return false;
  const connector = /\b(?:with|includes?|including|plus)\b|\bw\s*\/\s*/i;
  if (printer.index < ams.index) {
    const between = title.slice(printer.index + printer[0].length, ams.index);
    return connector.test(between) || /^[\s,|:+-]*$/.test(between);
  }
  const between = title.slice(ams.index + ams[0].length, printer.index);
  return connector.test(title.slice(Math.max(0, ams.index - 45), ams.index))
    || /\b(?:combo|bundle)\b/i.test(between) || /^[\s,|:+-]*$/.test(between);
}

const COVER_EQUIPMENT_KINDS = new Set<ProductKind>([
  'projector', 'monitor', 'television', 'receiver', 'headphones', 'microphone', 'speaker', 'camera',
  'car-stereo', 'laptop', 'desktop', 'tablet', 'phone', 'printer', 'router', 'power-tool',
]);
const COLLECTIBLE_DECK_TITLE_RE = /\b(?:commander\s+decks?|starter\s+decks?|theme\s+decks?|trading\s+cards?|tcg|booster\s+(?:packs?|boxes?)|sealed\s+(?:decks?|cards?|products?))\b/i;
const COLLECTIBLE_GAME_TITLE_RE = /\b(?:mtg|magic\s+(?:the\s+gathering)?|lotr|lord\s+of\s+the\s+rings|pok[eé]mon|yu[\s-]?gi[\s-]?oh|lorcana|flesh\s+and\s+blood)\b/i;
const KNOWN_COLLECTIBLE_NAMED_VARIANTS = [
  'the host of mordor',
  'riders of rohan',
  'elven council',
  'food and fellowship',
] as const;

const KNOWN_COLLECTIBLE_NAMED_VARIANT_ALIASES: Record<string, string> = {
  'evlven council': 'elven council',
};

function canonicalCollectibleNamedVariant(value: string): string {
  return KNOWN_COLLECTIBLE_NAMED_VARIANT_ALIASES[value.toLowerCase()] || value.toLowerCase();
}

function canonicalizeCollectibleNamedVariantAliases(value: string): string {
  return value.replace(/\bevlven\s+council\b/gi, 'elven council');
}

function collectibleNamedVariantPattern(variant: string): string {
  return variant === 'food and fellowship'
    ? 'food\\s+(?:and|&)\\s+fellowship'
    : variant.replace(/\s+/g, '\\s+');
}

function collectibleNamedVariantLabels(value: string | null | undefined): string[] {
  const source = normalise(value).toLowerCase();
  if (!COLLECTIBLE_DECK_TITLE_RE.test(source) || !COLLECTIBLE_GAME_TITLE_RE.test(source)) return [];
  const canonicalSource = canonicalizeCollectibleNamedVariantAliases(source);
  return KNOWN_COLLECTIBLE_NAMED_VARIANTS
    .filter((variant) => new RegExp(`\\b${collectibleNamedVariantPattern(variant)}\\b`, 'i').test(canonicalSource))
    .map((variant) => `named-deck:${canonicalCollectibleNamedVariant(variant)}`);
}

function recoverCollectibleNamedVariant(title: string, parsed: StructuredDescription): string | null {
  if (!COLLECTIBLE_DECK_TITLE_RE.test(title) || !COLLECTIBLE_GAME_TITLE_RE.test(title)) return null;
  const firstLine = parsed.freeText.split('\n').map((line) => line.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()).find(Boolean) || '';
  if (!firstLine || /\b(?:condition|notes?|missing|damage|tested|sealed|new|used|open\s*box|for\s+parts?)\b/i.test(firstLine)) return null;
  const canonicalFirstLine = canonicalizeCollectibleNamedVariantAliases(firstLine);
  const variant = KNOWN_COLLECTIBLE_NAMED_VARIANTS.find((candidate) => new RegExp(`^${collectibleNamedVariantPattern(candidate)}$`, 'i').test(canonicalFirstLine));
  return variant ? canonicalCollectibleNamedVariant(variant) : null;
}

function positiveCollectibleNamedVariants(value: string | null | undefined): string[] {
  const source = normalise(value).toLowerCase();
  if (!COLLECTIBLE_DECK_TITLE_RE.test(source) || !COLLECTIBLE_GAME_TITLE_RE.test(source)) return [];
  const canonicalSource = canonicalizeCollectibleNamedVariantAliases(source);
  return KNOWN_COLLECTIBLE_NAMED_VARIANTS.filter((variant) => {
    const pattern = collectibleNamedVariantPattern(variant);
    const match = new RegExp(`\\b${pattern}\\b`, 'i').exec(canonicalSource);
    if (!match) return false;
    const before = canonicalSource.slice(0, match.index);
    return !/(?:\bnot|\bno|\bwithout|\bexcept)\s*$/.test(before);
  });
}

function namedDeckCandidateRejection(candidateTitle: string, product: ProductIdentity): string | null {
  const expected = [...new Set((product.discriminators.variantLabels || [])
    .filter((value) => value.startsWith('named-deck:'))
    .map((value) => value.slice('named-deck:'.length)))];
  const isLotrDeck = COLLECTIBLE_DECK_TITLE_RE.test(product.name)
    && /\b(?:lotr|lord\s+of\s+the\s+rings|tales\s+of\s+middle\s+earth)\b/i.test(product.name);
  if (!isLotrDeck) return null;
  if (expected.length !== 1) return 'variantLabels:named-deck:unresolved';
  const canonicalCandidate = canonicalizeCollectibleNamedVariantAliases(candidateTitle);
  const expectedPattern = collectibleNamedVariantPattern(expected[0]!);
  if (new RegExp(`\\b(?:not|no|without|except)\\s+${expectedPattern}\\b`, 'i').test(canonicalCandidate)) {
    return `variantLabels:named-deck:${expected[0]}`;
  }
  if (new RegExp(`\\b${expectedPattern}\\b\\s*(?:[-,:;]\\s*)?(?:\\(\\s*)?(?:is\\s+)?\\b(?:not\\s+included|excluded)\\b`, 'i').test(canonicalCandidate)) {
    return `variantLabels:named-deck:${expected[0]}`;
  }
  const actual = positiveCollectibleNamedVariants(candidateTitle);
  return actual.length === 1 && actual[0] === expected[0]
    ? null
    : `variantLabels:named-deck:${expected[0]}`;
}

type CanonAe1Variant = 'canon-ae-1' | 'canon-ae-1-program';

function canonAe1Variant(value: string | null | undefined): CanonAe1Variant | null {
  const primaryTitle = normalise(value).split(/\b(?:compatible\s+with|replacement\s+for|designed\s+for|made\s+for|for\s+use\s+with|fits?)\b/i, 1)[0] || '';
  const match = /\bae[\s-]*1(?:(?:[\s-]+|\s*\/\s*|\s*\(\s*)program\s*\)?)?(?![a-z0-9])/i.exec(primaryTitle);
  if (!match) return null;
  return /program/i.test(match[0]) ? 'canon-ae-1-program' : 'canon-ae-1';
}

function canonAe1VariantRejection(candidateTitle: string, product: ProductIdentity): string | null {
  if (String(product.model || '').toLowerCase().replace(/[^a-z0-9]/g, '') !== 'ae1') return null;
  const expected = canonAe1Variant(product.name);
  const actual = canonAe1Variant(candidateTitle);
  if (!expected || !actual || expected === actual) return null;
  return `variant-mismatch:${expected}`;
}

const EQUIPMENT_PART_RE = /\b(?:recoil\s+starters?|pull\s+starters?|ignition\s+coils?|carburetors?)\b/i;

function includedEquipmentPart(title: string, part: RegExpExecArray): boolean {
  const before = title.slice(0, part.index);
  const after = title.slice(part.index + part[0].length);
  return /(?:\b(?:with|includes?|including|plus)\b|\bw\s*\/\s*)\s*(?:(?:a|an|the|new|replacement)\s+)*$/i.test(before)
    || /^\s*(?:[-,:]\s*)?(?:is\s+)?(?:included|supplied|installed)\b/i.test(after);
}

function standaloneRemoteListing(title: string, product?: Pick<ProductIdentity, 'name'>): boolean {
  const remote = /\bremote(?:\s+control)?s?\b/i.exec(title);
  if (!remote) return false;
  const playerIndex = /\bplayers?\b/i.exec(title)?.index ?? -1;
  const player = /\b(?:dvd|vhs|blu[\s-]?ray|disc|media|video)\b[^,;.]{0,55}\bplayers?\b|\bplayers?\b/i.exec(title);
  // A remote on a television, projector, or receiver is handled by the
  // normal bundled-component logic. This guard is only for player listings,
  // where model-matching otherwise lets a standalone replacement remote pass.
  if (!player) {
    return Boolean(product && /\b(?:dvd|vhs|blu[\s-]?ray|disc|media|video)\b/i.test(product.name));
  }
  if (playerIndex >= 0 && playerIndex < remote.index) {
    const between = title.slice(playerIndex + 'player'.length, remote.index);
    return !completePlayerWithRemote(title) && !/\b(?:no|without)\s*$/i.test(between);
  }
  const afterRemote = title.slice(remote.index + remote[0].length, player.index);
  // A remote advertised for a player is still the accessory, even when the
  // player model is repeated exactly in the title.
  if (/\b(?:for|compatible\s+with|replacement\s+for|designed\s+for|made\s+for|fits?)\b/i.test(afterRemote)) return true;
  // A player title with an included remote is a complete primary product.
  return player.index < remote.index;
}

function completePlayerWithRemote(title: string): boolean {
  const remote = /\bremote(?:\s+control)?s?\b/i.exec(title);
  const player = /\b(?:dvd|vhs|blu[\s-]?ray|disc|media|video)\b[^,;.]{0,55}\bplayers?\b|\bplayers?\b/i.exec(title);
  if (!remote || !player || player.index >= remote.index) return false;
  if (/\b(?:service|repair|owner'?s?|user|instruction|workshop)\s+manual\b|\bremote\s+codes?\b/i.test(title)) return false;
  const between = title.slice(player.index + player[0].length, remote.index);
  const after = title.slice(remote.index + remote[0].length);
  return /\b(?:with|includes?|included|including|bundled\s+with|plus)\b|\bw\s*\/\s*/i.test(between)
    || /^\s*(?:[-,:;]\s*)?(?:included|supplied)\b/i.test(after);
}

function playerRemoteAccessoryOnly(title: string): boolean {
  return /\b(?:dvd|vhs|blu[\s-]?ray|disc|media|video)\b[^,;.]{0,55}\bplayers?\b/i.test(title)
    && /\bremote\s+codes?\b|\b(?:service|repair|owner'?s?|user|instruction|workshop)\s+manual\b/i.test(title);
}

const REPLACEMENT_FURNITURE_COMPONENT_RE = /\b(?:replacement|spare)(?:\s+(?:replacement|tempered|toughened|clear|frosted|solid|wooden|upholstered|padded|leather|fabric|glass|wood|metal|acrylic|marble|stone|table|chair|sofa|bed|couch)){0,4}\s+(?:tops?|tabletops?|shel(?:f|ves)|doors?|drawers?|cushions?|covers?|seats?|legs?|bases?|panels?)\b/gi;
const MATERIAL_STOCK_RE = /\b(?:veneer\s+(?:sheets?|stock)|(?:wood|timber|wool|leather|fabric|veneer)\s+(?:stock|offcuts?|scraps?)|leather\s+hides?|lumber|(?:raw|unprocessed)\s+(?:(?:wood|wool|cotton|leather|fabric)\s+)?(?:fib(?:er|re)s?|sheets?|slabs?|stock|material))\b/gi;

function negatedReplacementComponent(title: string, component: RegExpExecArray): boolean {
  const before = title.slice(Math.max(0, component.index - 35), component.index);
  const after = title.slice(component.index + component[0].length);
  return /\b(?:no|without|not|missing|excluding)\s*$/i.test(before)
    || /^\s*(?:[-,:]\s*)?(?:(?:is|are)\s+)?(?:not\s+(?:included|supplied)|excluded|missing|absent)\b/i.test(after);
}

function includedReplacementComponent(title: string, component: RegExpExecArray): boolean {
  const before = title.slice(0, component.index);
  return /\b(?:with|includes?|including|plus|bundle(?:d)?\s+with)\b[^,;]{0,25}$/i.test(before)
    || /^\s*(?:[-,:]\s*)?(?:is\s+|are\s+)?(?:included|supplied)\b/i.test(title.slice(component.index + component[0].length));
}

function furnitureForm(title: string): string | null {
  const noun = /\b((?:table|desk)\s+lamps?|(?:dining\s+table|desk|dining|office|side|table)\s+chairs?|writing\s+tables?|desks?|tables?|armchairs?|chairs?|sofas?|couches?|bedsteads?|beds?|dressers?|cabinets?|bookcases?|shel(?:f|ves)|rugs?|carpets?|ottomans?|benches?|stools?|sideboards?|credenzas?|wardrobes?)\b/i.exec(title)?.[1]?.toLowerCase();
  if (!noun) return null;
  if (/^(?:table|desk)\s+lamp/.test(noun)) return 'lamp';
  if (/\bchairs?$/.test(noun)) return 'chair';
  if (/^(?:writing\s+table|desk)/.test(noun)) return 'desk';
  if (/^(?:rug|carpet)/.test(noun)) return 'rug';
  if (/^(?:sofa|couch)/.test(noun)) return 'sofa';
  if (/^(?:armchair|chair)/.test(noun)) return 'chair';
  if (/^bed/.test(noun)) return 'bed';
  if (/^shel/.test(noun)) return 'shelf';
  if (/^benche?s?$/.test(noun)) return 'bench';
  return noun.replace(/s$/, '');
}

function finishedProductComponents(title: string): Set<string> {
  const standalone = (component: RegExpExecArray): boolean => !negatedReplacementComponent(title, component)
      && !includedReplacementComponent(title, component)
      && !/\b(?:made|constructed|crafted)\s+(?:from|of|with)\s*$/i.test(title.slice(0, component.index));
  const replacements = [...title.matchAll(REPLACEMENT_FURNITURE_COMPONENT_RE)]
    .filter(standalone).map((component) => {
      const noun = component[0].match(/(?:tops?|tabletops?|shel(?:f|ves)|doors?|drawers?|cushions?|covers?|seats?|legs?|bases?|panels?)$/i)![0].toLowerCase();
      const family = /top/.test(noun) ? 'top' : /^shel/.test(noun) ? 'shelf' : noun.replace(/s$/, '');
      return `replacement:${family}`;
    });
  const materials = [...title.matchAll(MATERIAL_STOCK_RE)].filter(standalone)
    .map((component) => `stock:${/\bveneer\b/i.test(component[0]) ? 'veneer' : /\bleather\b/i.test(component[0]) ? 'leather' : /\b(?:fiber|fibre|wool|cotton)\b/i.test(component[0]) ? 'fiber' : /\b(?:wood|timber|lumber)\b/i.test(component[0]) ? 'wood' : 'material'}`);
  return new Set([...replacements, ...materials]);
}

function rejectsFinishedProductComponent(candidateTitle: string, product: ProductIdentity): boolean {
  const sourceComponents = finishedProductComponents(product.name);
  const candidateComponents = finishedProductComponents(candidateTitle);
  const sourceForm = furnitureForm(product.name);
  const candidateForm = furnitureForm(candidateTitle);
  if (sourceComponents.size) return [...sourceComponents].some((component) => !candidateComponents.has(component));
  if ((sourceForm || candidateForm)
    && [...candidateTitle.matchAll(REPLACEMENT_FURNITURE_COMPONENT_RE)]
      .some((component) => !negatedReplacementComponent(candidateTitle, component)
        && !includedReplacementComponent(candidateTitle, component))) return true;
  if (sourceForm && candidateComponents.size) return true;
  return Boolean(sourceForm && candidateForm && sourceForm !== candidateForm);
}

export function isAccessoryListing(title: string | null | undefined, product: ProductIdentity): boolean {
  const candidateTitle = String(title ?? '');
  if (BAND_SAW_RE.test(product.name) && !sourceIsAccessoryProduct(product)) {
    if (standaloneBandSawComponent(candidateTitle)) return true;
    // The band in band saw is part of the equipment name, not a wrist band.
    if (BAND_SAW_RE.test(candidateTitle) && !ACCESSORY_NOUN_RE.test(candidateTitle.replace(BAND_SAW_RE, ''))) return false;
  }
  const rawTabletComponentSubject = product.kind === 'tablet'
    && [
      ...candidateTitle.matchAll(/\b(?:(?:replacement|standalone|spare)\s+)?(?:chips?|processors?|soc)\s+only\b|\bonly\s+(?:(?:replacement|standalone|spare)\s+)?(?:chips?|processors?|soc)\b/gi),
      ...candidateTitle.matchAll(/\b(?:standalone|replacement)\s+(?:chips?|processors?|soc)\b|\b(?:chips?|processors?|soc)\s+(?:standalone|replacement)\b/gi),
    ]
      .some((component) => {
        if (negatedReplacementComponent(candidateTitle, component)) return false;
        if (/\bonly\b/i.test(component[0])) return true;
        const before = candidateTitle.slice(0, component.index);
        const after = candidateTitle.slice(component.index + component[0].length);
        const included = /\b(?:with|includes?|including|plus|bundle(?:d)?\s+with)(?:\s+(?:an?|the|extra|spare|new)){0,2}\s*$/i.test(before)
          || /^\s*(?:[-,:]\s*)?(?:is\s+|are\s+)?(?:included|supplied)\b/i.test(after);
        return !included;
      });
  if (!sourceIsAccessoryProduct(product) && rawTabletComponentSubject) return true;
  if (rejectsFinishedProductComponent(candidateTitle, product)) return true;
  if (!sourceIsAccessoryProduct(product) && standaloneRemoteListing(candidateTitle, product)) return true;
  if (!sourceIsAccessoryProduct(product) && playerRemoteAccessoryOnly(candidateTitle)) return true;
  if (!sourceIsAccessoryProduct(product)
    && /\b(?:accessor(?:y|ies)|replacement|spare)\b[^,.]{0,45}\bfor\b/i.test(candidateTitle)) return true;
  if (!sourceIsAccessoryProduct(product) && primaryFlashSubject(candidateTitle)) return true;
  const printerComponent = product.kind === 'printer' ? standalonePrinterComponent(candidateTitle) : null;
  const printerAms = product.kind === 'printer' ? PRINTER_AMS_RE.exec(candidateTitle) : null;
  const printerAmsIncluded = Boolean(printerAms && printerIncludesAms(candidateTitle, printerAms));
  if (!sourceIsAccessoryProduct(product)
    && (printerComponent || (printerAms && !printerAmsIncluded))) return true;
  const accessoryKit = /\baccessor(?:y|ies)\s+(?:kit|pack|set)\b/i.exec(candidateTitle);
  if (!sourceIsAccessoryProduct(product) && accessoryKit
    && !/\b(?:with|includes?|including|plus)\s+(?:an?\s+)?accessor(?:y|ies)\s+(?:kit|pack|set)\b/i.test(candidateTitle)) return true;
  if (!sourceIsAccessoryProduct(product)
    && product.kind === 'printer'
    && /\b(?:desiccant|drying\s+beads?|filament\s+dryer)\b/i.test(candidateTitle)
    && !/\b(?:with|includes?|including|plus)\s+(?:an?\s+)?filament\s+dryer\b/i.test(candidateTitle)) return true;
  const equipmentPart = EQUIPMENT_PART_RE.exec(candidateTitle);
  const sourceEquipmentPart = EQUIPMENT_PART_RE.exec(product.name);
  const sourceIsPart = Boolean(sourceEquipmentPart && !includedEquipmentPart(product.name, sourceEquipmentPart));
  if (equipmentPart && !sourceIsPart && !includedEquipmentPart(candidateTitle, equipmentPart)) return true;
  const documentation = /\b(?:(?:service|repair|owners?|owner'?s|user|instruction|installation|workshop)\s+manual|manual\s+(?:pdf|digital|download|disc|cd)|service\s+(?:literature|documentation)|wiring\s+diagram|schematic)\b/i;
  if (documentation.test(candidateTitle) && !documentation.test(product.name)) return true;
  const manual = /\bmanuals?\b(?!\s+(?:transmission|gearbox|controls?|operation|feed|choke|start|adjustment|steering|mode)\b)/i.exec(candidateTitle);
  if (manual && !/\bmanuals?\b/i.test(product.name)) {
    const before = candidateTitle.slice(0, manual.index);
    const after = candidateTitle.slice(manual.index + manual[0].length);
    const included = /(?:\b(?:with|includes?|including|plus|and)|\bw\s*\/|&)\s+(?:(?:an?|the|original)\s+)?$/i.test(before)
      || /^\s*(?:[-,:]\s*)?(?:is\s+|are\s+)?(?:included|supplied)\b/i.test(after);
    if (!included && !negatedReplacementComponent(candidateTitle, manual)) return true;
  }
  const partsOnly = /\b(?:for\s+parts|parts\s+only)\b/i.exec(candidateTitle);
  if (partsOnly && !negatedReplacementComponent(candidateTitle, partsOnly)
    && !/\b(?:for\s+parts|parts\s+only)\b/i.test(product.name)) return true;
  const packagingOnly = /\b(?:empty\s+(?:original\s+)?(?:retail\s+)?box|original\s+(?:retail\s+)?box\s+only|box\s+only|box\s+(?:and|with)\s+(?:cooler|heatsink|fan|manual|accessories)|(?:retail\s+)?packaging\s+only|empty\s+(?:original\s+)?carton|original\s+carton\s+only|carton\s+only|(?:cooler|heatsink)\s+only)\b/i;
  if (packagingOnly.test(candidateTitle) && !packagingOnly.test(product.name)) return true;
  if (/\b(?:coffee|espresso|pod|capsule)\s+(?:makers?|machines?|brewers?)\s+(?:(?:cleaning|reusable|refillable|replacement)\s+)?(?:(?:pod|capsule)\s+)?kit\b/i.test(candidateTitle)) return true;
  if (product.kind === 'game-console' && detectProductKind(candidateTitle) !== 'game-console') return true;
  if (/\breplacement\s+parts?\s+only\b|\bnot\s+a\s+complete\b/i.test(candidateTitle)) return true;
  const midiverbEquipmentStatus = /(?:\b(?:with|without|no|missing|includes?|including|plus)\b|\bw\s*\/)\s+(?:(?:an?|the|original|power|ac)\s+){0,3}(?:power\s+suppl(?:y|ies)|psu|cords?|cables?|adapters?|chargers?)\b/i.test(candidateTitle)
    || /\b(?:power\s+suppl(?:y|ies)|psu|(?:power\s+)?(?:cords?|cables?|adapters?|chargers?))\s*(?:[-,:]\s*)?(?:(?:is|are)\s+)?(?:not\s+)?(?:included|supplied|provided|excluded|missing|absent|optional|sold\s+separately)\b/i.test(candidateTitle);
  if (midiverbEquipmentStatus && knownAlesisMidiverbGenerationAliasMatches(candidateTitle, product)
    && !alesisMidiverbCandidateRejection(candidateTitle, product)) return false;
  if (!sourceIsAccessoryProduct(product) && completePlayerWithRemote(candidateTitle)) return false;
  const noun = ACCESSORY_NOUN_RE.exec(candidateTitle)
    ?? /\b(batter(?:y|ies))\b/i.exec(candidateTitle)
    ?? (product.kind === 'printer' ? PRINTER_COMPONENT_NOUN_RE.exec(candidateTitle) : null);
  if (!noun || sourceIsAccessoryProduct(product)) return false;
  if (/^knobs?$/i.test(noun[0])) return standaloneKnobSubject(candidateTitle, noun, product);
  const beforeNoun = candidateTitle.slice(Math.max(0, noun.index - 24), noun.index);
  const candidateKind = detectProductKind(candidateTitle);
  const kindIndex = primaryKindIndex(candidateTitle, product.kind);
  const exactModel = Boolean(product.model && modelMatches(candidateTitle, product.model));
  const marker = /\b(?:for|compatible\s+with|replacement\s+for|designed\s+for|made\s+for|fits)\b/i.exec(candidateTitle);
  const primaryKindBundle = candidateKind === product.kind
    && kindIndex >= 0
    && kindIndex < noun.index
    && /\b(?:with|includes?|including|bundle(?:d)?\s+with|plus)\b|\bw\s*\/\s*/i.test(candidateTitle.slice(kindIndex, noun.index));
  const primaryPackageBundle = exactModel
    && Boolean(product.model2)
    && /\s+(?:w\s*\/|with)\s*/i.test(product.name)
    && !packagePrimarySubjectMismatch(candidateTitle, product.name, product.model2 || '')
    && /\b(?:with|includes?|including|bundle(?:d)?\s+with|plus)\b|\bw\s*\/\s*/i.test(candidateTitle.slice(0, noun.index));
  const primaryBundle = primaryKindBundle || primaryPackageBundle;
  if (product.kind === 'stylus'
    && /^(?:tips?|nibs?|cases?|covers?|sleeves?)$/i.test(noun[0])
    && !primaryBundle) return true;
  const coffeeMachineIndex = /\b(?:coffee|espresso|capsule)\s+(?:makers?|machines?|brewers?)\b/i.exec(candidateTitle)?.index ?? -1;
  const primaryCoffeeBundle = /^(?:pods?|capsules?)$/i.test(noun[0])
    && coffeeMachineIndex >= 0 && coffeeMachineIndex < noun.index
    && (/\b(?:with|includes?|including|plus|no|without)\b|\+/i.test(candidateTitle.slice(coffeeMachineIndex, noun.index))
      || /^\s+(?:included|supplied)\b/i.test(candidateTitle.slice(noun.index + noun[0].length)));
  const podCoffeeMachine = /^(?:pods?|capsules?)$/i.test(noun[0])
    && /^\s+(?:(?:coffee|espresso)\s+)?(?:makers?|machines?|brewers?)\b/i.test(candidateTitle.slice(noun.index + noun[0].length));
  const identityTokens = new Set([
    product.brand,
    product.model,
    product.model2,
  ].filter(Boolean).map((value) => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '')));
  const sourceDescriptors = retailIdentityTokens(product).filter((token) => !identityTokens.has(token));
  const beforeMarkerTokens = new Set(compactTokens(candidateTitle.slice(0, marker?.index ?? 0))
    .map((token) => token.toLowerCase().replace(/[^a-z0-9]+/g, '')));
  const platformAccessoryMention = Boolean(marker
    && marker.index < noun.index
    && exactModel
    && sourceDescriptors.filter((token) => beforeMarkerTokens.has(token)).length >= 2);
  const coverEquipmentContext = /\b(?:amp(?:lifier)?s?|receiver|speaker|monitor|television|projector|headphones?|microphone|camera|car\s+stereo|laptop|desktop|tablet|phone|printer|router|power\s+tool)s?\b/i.test(candidateTitle.slice(0, noun.index));
  const includedCoverBundle = noun[0].toLowerCase().startsWith('cover')
    && COVER_EQUIPMENT_KINDS.has(product.kind as ProductKind)
    && /^\s*(?:[-,:]\s*)?(?:is\s+)?(?:included|supplied)\b/i.test(candidateTitle.slice(noun.index + noun[0].length));
  const excludedCoverBundle = noun[0].toLowerCase().startsWith('cover')
    && COVER_EQUIPMENT_KINDS.has(product.kind as ProductKind)
    && coverEquipmentContext
    && /^\s*(?:[-,:]\s*)?(?:is\s+)?not\s+(?:included|supplied)\b/i.test(candidateTitle.slice(noun.index + noun[0].length));
  if (noun[0].toLowerCase().startsWith('cover')
    && COVER_EQUIPMENT_KINDS.has(product.kind as ProductKind)
    && !primaryBundle
    && !includedCoverBundle
    && !excludedCoverBundle
    && !marker
    && (exactModel || coverEquipmentContext)) return true;
  const strictComponent = /^(?:batter(?:y|ies)|pods?|capsules?|chips?|build\s*plate|magnetic\s*plate|pei\s+(?:sheet|plate)|flexi(?:ble)?\s+steel|lamps?|bulbs?|footswitch(?:es)?|foot\s+switch(?:es)?|pedals?|cartridges?|probes?|camera\s+heads?)/i.test(noun[0]);
  if (/\b(?:replacement|spare)\s+batter(?:y|ies)\b/i.test(candidateTitle)) return true;
  if (strictComponent
    && !primaryBundle
    && !primaryCoffeeBundle
    && !podCoffeeMachine
    && !platformAccessoryMention
    && !/(?:\bwith|\bw\s*\/|\bincludes?|\bincluding|\bbundle)\s*$/i.test(beforeNoun)) return true;
  const identity = [product.brand, product.model, product.model2].filter(Boolean).map((value) => escapeRegExp(String(value)).replace(/[-\s]/g, '[-\\s]?')).join('|');
  if (identity) {
    const forProduct = new RegExp(`\\b(?:${FOR_PRODUCT_VERBS})\\s+(?:the\\s+)?[^,;.]{0,40}?(?:${identity})`, 'i');
    if (forProduct.test(candidateTitle)) return true;
  }
  if (ACCESSORY_MARKER_RE.test(candidateTitle)) return true;
  const sourceAttributes = product.discriminators || extractProductDiscriminators(product.name);
  const candidateAttributes = extractProductDiscriminators(candidateTitle);
  const familyEvidence = sourceAttributes.platformVariants.some((value) => candidateAttributes.platformVariants.includes(value))
    || sourceAttributes.seriesSignatures.some((value) => candidateAttributes.seriesSignatures.includes(value));
  if (marker && marker.index > noun.index && (familyEvidence || brandEvidence(candidateTitle, product).matches || Boolean(product.model && modelMatches(candidateTitle, product.model)))) return true;

  if (candidateKind === product.kind && kindIndex >= 0 && kindIndex < noun.index && (exactModel || /\b(?:with|includes?|bundle)\b/i.test(candidateTitle.slice(kindIndex, noun.index)))) return false;
  if (exactModel && !marker) return false;
  const bare = candidateTitle.replace(TITLE_PREFIX_RE, '').trim();
  if (product.brand) {
    const firstWord = bare.match(/[A-Za-z0-9][A-Za-z0-9.&'-]*/)?.[0] ?? '';
    if (firstWord && firstWord.toLowerCase() !== product.brand.toLowerCase() && !brandEvidence(candidateTitle, product).matches) return true;
  }
  const identityRe = product.model
    ? new RegExp(escapeRegExp(product.model).replace(/[-\s]/g, '[-\\s]?'), 'i')
    : product.brand ? new RegExp(`\\b${escapeRegExp(product.brand)}\\b`, 'i') : null;
  if (!identityRe) return noun.index < 20;
  const identityMatch = identityRe.exec(candidateTitle);
  if (!identityMatch) return true;
  return noun.index < identityMatch.index;
}

function productRevisionNumbers(text: string): string[] {
  const withoutProtocolVersions = text.replace(/\b(?:bluetooth|usb|wi-?fi|hdmi|pcie|displayport)\s*(?:version\s*)?v[1-9](?:\.\d+)?\b/gi, '');
  return [...withoutProtocolVersions.matchAll(/\bv([1-9])(?:\.\d+)?\b/gi)].map((match) => match[1]!);
}

function collectibleProductFormats(title: string): string[] {
  const formats = [
    ['commander-deck', /\bcommander\s+deck\b/i],
    ['starter-deck', /\bstarter\s+deck\b/i],
    ['theme-deck', /\btheme\s+deck\b/i],
    ['structure-deck', /\bstructure\s+deck\b/i],
    ['set-booster', /\bset\s+booster\b/i],
    ['draft-booster', /\bdraft\s+booster\b/i],
    ['collector-booster', /\bcollector\s+booster\b/i],
    ['booster-pack', /\bbooster\s+pack\b/i],
    ['booster-box', /\bbooster\s+box\b/i],
  ] as const;
  return formats.filter(([, pattern]) => pattern.test(title)).map(([value]) => value);
}

function collectibleNamedVariants(title: string): string[] {
  if (!/\b(?:pokemon|pok[eé]mon|trading\s+card|tcg|binder)\b/i.test(title)) return [];
  const pocketTail = title.match(/\b\d+[\s-]*pockets?\s+((?:mega\s+)?[a-z][a-z'-]{3,})\s*$/i)?.[1];
  const binderTail = title.match(/\bbinders?\s+((?:mega\s+)?[a-z][a-z'-]{3,})\s*$/i)?.[1];
  const pocketLead = title.match(/\b((?:mega\s+)?[a-z][a-z'-]{3,})\s+\d+[\s-]*pockets?\b/i)?.[1];
  const generic = new Set(['binder', 'portfolio', 'zippered', 'pokemon', 'pokémon', 'cards', 'card', 'pockets', 'premium', 'trading']);
  return [...new Set([pocketTail, binderTail, pocketLead]
    .filter(Boolean).map((value) => value!.toLowerCase()).filter((value) => !generic.has(value)))];
}

export function evaluateRetailCandidate(title: string | null | undefined, product: ProductIdentity): RetailCandidateEvaluation {
  const candidateTitle = String(title ?? '');
  const rejectionReasons: string[] = [];
  const matchedEvidence: string[] = [];
  if (!candidateTitle) return { accepted: false, score: 0, rejectionReasons: ['empty-title'], matchedEvidence };
  const crownRejection = crownPowerBaseCandidateRejection(candidateTitle, product);
  if (crownRejection) rejectionReasons.push(crownRejection);
  const carvinRejection = carvinProBass150Rejection(candidateTitle, product);
  if (carvinRejection) rejectionReasons.push(carvinRejection);
  const midiverbRejection = alesisMidiverbCandidateRejection(candidateTitle, product);
  if (midiverbRejection) rejectionReasons.push(midiverbRejection);
  const sourceFormats = collectibleProductFormats(product.name);
  const candidateFormats = collectibleProductFormats(candidateTitle);
  const specificBooster = new Set(['set-booster', 'draft-booster', 'collector-booster']);
  const packaging = new Set(['booster-pack', 'booster-box']);
  const sourceSpecific = sourceFormats.filter((value) => specificBooster.has(value));
  const candidateSpecific = candidateFormats.filter((value) => specificBooster.has(value));
  const sourcePackaging = sourceFormats.filter((value) => packaging.has(value));
  const candidatePackaging = candidateFormats.filter((value) => packaging.has(value));
  if (sourceSpecific.length && candidateSpecific.length && !candidateSpecific.some((value) => sourceSpecific.includes(value))) {
    rejectionReasons.push(`format-mismatch:${sourceSpecific[0]}`);
  }
  if (sourcePackaging.length && candidatePackaging.length && !candidatePackaging.some((value) => sourcePackaging.includes(value))) {
    rejectionReasons.push(`format-mismatch:${sourcePackaging[0]}`);
  }
  if (sourceFormats.length && candidateFormats.length && !candidateFormats.some((value) => sourceFormats.includes(value))) {
    rejectionReasons.push(`format-mismatch:${sourceFormats[0]}`);
  }
  const sourceCollectibleVariants = collectibleNamedVariants(product.name);
  if (sourceCollectibleVariants.length && !sourceCollectibleVariants.some((value) => {
    const pattern = value.split(/\s+/).map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s-]+');
    return new RegExp(`\\b${pattern}\\b`, 'i').test(candidateTitle);
  })) {
    rejectionReasons.push(`variant-mismatch:${sourceCollectibleVariants[0]}`);
  }
  const namedDeckRejection = namedDeckCandidateRejection(candidateTitle, product);
  if (namedDeckRejection) rejectionReasons.push(namedDeckRejection);
  const keurigNamedModelRejection = keurigNamedModelCandidateRejection(candidateTitle, product);
  if (keurigNamedModelRejection) rejectionReasons.push(keurigNamedModelRejection);
  const canonAe1Rejection = canonAe1VariantRejection(candidateTitle, product);
  if (canonAe1Rejection) rejectionReasons.push(canonAe1Rejection);
  const sourceRevisions = productRevisionNumbers(product.name);
  const candidateRevisions = productRevisionNumbers(candidateTitle);
  if (candidateRevisions.length && !sourceRevisions.length) rejectionReasons.push('revision-unverified');
  else if (sourceRevisions.length && !candidateRevisions.some((revision) => sourceRevisions.includes(revision))) {
    rejectionReasons.push('revision-mismatch');
  }
  if (product.explicitlyPartialBundle && /\b(?:creator\s+)?(?:combo|bundle|kit|package|set)\b/i.test(candidateTitle)) {
    rejectionReasons.push('bundle-completeness-unverified');
  }
  if (!hasSufficientRetailIdentity(product)) rejectionReasons.push('insufficient-source-identity');
  const sourceRequiresAms = !sourceIsAccessoryProduct(product)
    && product.kind === 'printer'
    && (() => {
      const mention = PRINTER_AMS_RE.exec(product.name);
      return Boolean(mention && !amsMentionIsNegated(product.name, mention));
    })()
    && primaryKindIndex(product.name, 'printer') >= 0;
  const candidateAms = PRINTER_AMS_RE.exec(candidateTitle);
  if (sourceRequiresAms && (!candidateAms || amsMentionIsNegated(candidateTitle, candidateAms))) {
    rejectionReasons.push('bundle-component-missing:ams');
  }
  // A cable/stand/band is allowed to match the same product type. Accessory
  // rejection protects a primary product from its add-ons; it must not reject
  // an auction lot whose product is itself the accessory.
  if (rejectsFinishedProductComponent(candidateTitle, product)
    || (!sourceIsAccessoryProduct(product) && isAccessoryListing(candidateTitle, product))) {
    rejectionReasons.push('accessory-or-component');
  }
  if (packagePrimarySubjectMismatch(candidateTitle, product.name, product.model2 || '')) {
    rejectionReasons.push('bundle-primary-subject-mismatch');
  }
  const sourceLensModels = [...new Set(product.name.match(/\b\d{2,3}\s*-\s*\d{2,3}(?:mm)?\b/gi) || [])];
  if (sourceLensModels.length === 1 && /\b(?:dual|two|2)[\s-]+lens\s+kit\b/i.test(candidateTitle)) {
    rejectionReasons.push('attribute-conflict:lensCount:1!=2');
  }
  const exactModel = product.model
    ? product.brand.toLowerCase() === 'alesis' && canonicalMidiverbModel(product.model)
      ? knownAlesisMidiverbGenerationAliasMatches(candidateTitle, product)
      : modelMatches(candidateTitle, product.model) || applePencilSecondGenerationModelAliasMatches(candidateTitle, product)
        || knownCrownPowerBaseAliasMatches(candidateTitle, product)
        || carvinProBass150AliasMatches(candidateTitle, product)
    : false;
  const discriminators = matchesProductDiscriminators(candidateTitle, product);
  if (discriminators.conflicts.length) rejectionReasons.push(...discriminators.conflicts.map((value) => `attribute-conflict:${value}`));
  rejectionReasons.push(...criticalMissingDiscriminators(discriminators.missing).map((value) => `attribute-missing:${value}`));
  rejectionReasons.push(...compareStrictIdentitySignatures(candidateTitle, product));
  const brand = brandEvidence(candidateTitle, product);
  const candidateKind = detectProductKind(candidateTitle);
  const namedDeckExpected = [...new Set((product.discriminators.variantLabels || [])
    .filter((value) => value.startsWith('named-deck:'))
    .map((value) => value.slice('named-deck:'.length)))];
  const namedDeckIdentityConfirmed = namedDeckExpected.length === 1
    && !namedDeckRejection
    && /\blord\s+of\s+the\s+rings\b/i.test(candidateTitle)
    && COLLECTIBLE_DECK_TITLE_RE.test(candidateTitle);
  const sourceFamily = productBrandFamily(product);
  const candidateFamily = canonicalBrandFamily(candidateTitle);
  if (sourceFamily && candidateFamily !== sourceFamily) rejectionReasons.push(`brand-mismatch:${sourceFamily}`);
  if (brand.expected && !brand.matches && !namedDeckIdentityConfirmed
    && (!sourceFamily || compatibilityLedAccessory(product.name, product.kind))) {
    rejectionReasons.push(`brand-mismatch:${brand.label}`);
  }
  if (!exactModel && product.kind && candidateKind && candidateKind !== product.kind) rejectionReasons.push(`kind-mismatch:${product.kind}:${candidateKind}`);
  if (product.model && !exactModel) rejectionReasons.push(`model-mismatch:${product.model}`);
  const overlap = candidateTokenOverlap(candidateTitle, product);
  const structuredEvidence = exactModel || brand.matches || (Boolean(product.kind) && candidateKind === product.kind) || discriminators.matchedCount > 0;
  if (!structuredEvidence && (overlap.hits < 3 || overlap.ratio < 0.6)) rejectionReasons.push(`weak-title-overlap:${overlap.hits}/${overlap.total}`);
  const longNamedSourceMismatch = overlap.total >= 7 && overlap.hits < 4 && overlap.ratio <= 0.5;
  if (structuredEvidence && !exactModel
    && (((overlap.hits < 2 || overlap.ratio <= 0.5) && discriminators.matchedCount === 0) || longNamedSourceMismatch)) {
    rejectionReasons.push(`weak-title-overlap:${overlap.hits}/${overlap.total}`);
  }
  if (rejectionReasons.length) return { accepted: false, score: 0, rejectionReasons: [...new Set(rejectionReasons)], matchedEvidence };

  let score = 0;
  if (product.model) {
    score += 5;
    matchedEvidence.push(`model:${product.model}`);
  }
  if (product.model2 && modelMatches(candidateTitle, product.model2)) {
    score += 2;
    matchedEvidence.push(`model2:${product.model2}`);
  }
  if (brand.matches) {
    score += 2;
    matchedEvidence.push(`brand:${brand.label}`);
  }
  if (product.kind && candidateKind === product.kind) score += 2;
  score += discriminators.matchedCount;
  if (discriminators.matchedCount) matchedEvidence.push(`attributes:${discriminators.matchedCount}`);
  score += overlap.ratio * 4;
  if (overlap.hits) matchedEvidence.push(`tokens:${overlap.hits}/${overlap.total}`);
  if (product.kind && candidateKind === product.kind) matchedEvidence.push(`kind:${product.kind}`);
  return { accepted: score > 0, score, rejectionReasons: [], matchedEvidence };
}

export function canAmazonDetailEnrichmentResolve(rejectionReasons: string[]): boolean {
  return rejectionReasons.length > 0
    && rejectionReasons.every((reason) => /^(?:attribute-(?:missing|conflict):|identity-code-missing:|identity-missing:|bundle-component-missing:|bundle-completeness-unverified$|model-mismatch:|weak-title-overlap:)/.test(reason));
}

export function evaluateAmazonCandidateEvidence(candidate: AmazonCandidate, product: ProductIdentity): RetailCandidateEvaluation {
  const titleEvaluation = evaluateRetailCandidate(candidate.title, product);
  if (titleEvaluation.accepted || !candidate.matchText || candidate.matchText === candidate.title) return titleEvaluation;
  const hardReasons = titleEvaluation.rejectionReasons.filter((reason) => /^(?:insufficient-source-identity|accessory-or-component|attribute-conflict|attribute-missing|identity-code-missing|identity-conflict|identity-missing|bundle-component-missing|bundle-component-excluded|bundle-primary-subject-mismatch|bundle-completeness-unverified|kind-mismatch|model-mismatch|brand-mismatch|revision-|format-mismatch:|variant-mismatch:|variantLabels:named-deck:)/.test(reason));
  const visibleFirstToken = candidate.title.replace(TITLE_PREFIX_RE, '').trim().match(/[A-Za-z0-9][A-Za-z0-9.&'+-]*/)?.[0] || '';
  const missingVisibleBrandOnly = hardReasons.length > 0
    && hardReasons.every((reason) => reason.startsWith('brand-mismatch:'))
    && GENERIC_BRAND_RE.test(visibleFirstToken)
    && Boolean(product.brand && literalBrandMatches(candidate.matchText, product.brand));
  const detailCanResolve = Boolean(candidate.detailEnriched)
    && canAmazonDetailEnrichmentResolve(hardReasons);
  if (hardReasons.length && !missingVisibleBrandOnly && !detailCanResolve) return titleEvaluation;
  return evaluateRetailCandidate(candidate.matchText, product);
}

export function scoreRetailCandidate(title: string | null | undefined, product: ProductIdentity): number {
  const candidateTitle = String(title ?? '');
  const lower = candidateTitle.toLowerCase();
  if (!lower) return 0;
  // Direct port of hibid-enhancer-suite's relevance engine. Accessories are
  // disqualified; a known model is mandatory; then brand and token overlap
  // rank the remaining plausible results.
  if (rejectsFinishedProductComponent(candidateTitle, product)
    || (!sourceIsAccessoryProduct(product) && isAccessoryListing(candidateTitle, product))) return 0;
  // Preserve Flippah's hard identity conflicts around the donor score. These
  // prevent a different model, capacity, platform, or product kind from being
  // promoted merely because it shares broad search words.
  const guarded = evaluateRetailCandidate(candidateTitle, product);
  if (guarded.rejectionReasons.some((reason) => /^(?:insufficient-source-identity|accessory-or-component|attribute-conflict|attribute-missing|identity-code-missing|identity-conflict|identity-missing|identity-scope:|bundle-component-missing|bundle-component-excluded|bundle-primary-subject-mismatch|bundle-completeness-unverified|kind-mismatch|model-mismatch|brand-mismatch|revision-|format-mismatch:|variant-mismatch:|variantLabels:named-deck:)/.test(reason))) return 0;
  let score = 0;
  if (product.model) {
    if (!modelMatches(candidateTitle, product.model)
      && !applePencilSecondGenerationModelAliasMatches(candidateTitle, product)
      && !knownAlesisMidiverbGenerationAliasMatches(candidateTitle, product)
      && !knownCrownPowerBaseAliasMatches(candidateTitle, product)
      && !carvinProBass150AliasMatches(candidateTitle, product)) return 0;
    score += 5;
  }
  if (product.model2 && modelMatches(candidateTitle, product.model2)) score += 2;
  if (product.brand && lower.includes(product.brand.toLowerCase())) score += 2;
  const tokens = product.tokens.map((token) => token.toLowerCase()).filter((token) => token.length > 2);
  const hits = tokens.filter((token) => lower.includes(token)).length;
  score += tokens.length ? (hits / tokens.length) * 3 : 0;
  return Math.max(score, guarded.score);
}

export function matchAmazonCandidates(candidates: AmazonCandidate[], product: ProductIdentity): AmazonCandidateMatch | null {
  const scored = candidates
    .filter((candidate) => !candidate.sponsored && !candidate.used && candidate.price != null && candidate.price > 0)
    .map((candidate) => {
      const evaluation = evaluateAmazonCandidateEvidence(candidate, product);
      return { candidate, score: evaluation.accepted ? Math.max(evaluation.score, scoreRetailCandidate(candidate.title, product)) : 0 };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);
  if (!scored.length) return null;
  const top = scored[0]?.score ?? 0;
  // Price breaks ties between equally specific listings. A cheaper candidate
  // that omits source attributes (for example, the required color) must not
  // outrank a complete exact-attribute result merely because it is plausible.
  const band = scored.filter((entry) => entry.score >= top - 0.25);
  return [...band].sort((left, right) => (left.candidate.price ?? Infinity) - (right.candidate.price ?? Infinity))[0] ?? null;
}

export interface AmazonMatchOverride {
  statedRetail?: number | null;
  name?: string;
  query?: string;
}

export function chooseAmazonMatch(identity: ProductIdentity, candidates: AmazonCandidate[], override?: AmazonMatchOverride | number): AmazonMatch | null {
  let adjusted: ProductIdentity = identity;
  if (typeof override === 'number') {
    adjusted = { ...identity, statedRetail: override };
  } else if (override) {
    const { statedRetail, ...identityOverrides } = override;
    adjusted = { ...identity, ...identityOverrides };
    if (statedRetail != null) adjusted.statedRetail = statedRetail;
    else if (Object.prototype.hasOwnProperty.call(override, 'statedRetail')) delete adjusted.statedRetail;
  }
  return matchAmazonCandidates(candidates, adjusted);
}

export function indicatorForRatio(provider: 'amazon' | 'ebay', allIn: number | null | undefined, marketPrice: number | null | undefined): RetailIndicator {
  if (allIn == null || marketPrice == null || !Number.isFinite(allIn) || !Number.isFinite(marketPrice) || marketPrice <= 0) {
    return { provider, ratio: null, discountPct: null, tone: 'unknown', cls: 'na', label: 'no retail price found' };
  }
  const ratio = allIn / marketPrice;
  if (ratio < 0.5) return { provider, ratio, discountPct: (1 - ratio) * 100, tone: 'great', cls: 'green', label: 'great' };
  if (ratio < 0.65) return { provider, ratio, discountPct: (1 - ratio) * 100, tone: 'good', cls: 'yellow', label: 'good' };
  if (ratio < 0.75) return { provider, ratio, discountPct: (1 - ratio) * 100, tone: 'marginal', cls: 'orange', label: 'marginal' };
  return { provider, ratio, discountPct: (1 - ratio) * 100, tone: 'poor', cls: 'red', label: 'poor' };
}

export function computeAmazonIndicator(allIn: number | UsAllInResult | null | undefined, amazonPrice: number | null | undefined): RetailIndicator {
  return indicatorForRatio('amazon', typeof allIn === 'number' ? allIn : allIn?.total ?? null, amazonPrice);
}

export const amazonIndicator = computeAmazonIndicator;

export function computeEbayIndicator(allIn: number | UsAllInResult | null | undefined, ebayPrice: number | null | undefined): RetailIndicator {
  return indicatorForRatio('ebay', typeof allIn === 'number' ? allIn : allIn?.total ?? null, ebayPrice);
}

export function computeRetailIndicators(allIn: number | UsAllInResult | null | undefined, prices: { amazon?: number | null; ebay?: number | null }): { amazon: RetailIndicator; ebay: RetailIndicator } {
  return { amazon: computeAmazonIndicator(allIn, prices.amazon), ebay: computeEbayIndicator(allIn, prices.ebay) };
}

export function retailIndicatorBandDescription(indicator: Pick<RetailIndicator, 'cls'>, costLabel = 'all-in cost'): string {
  switch (indicator.cls) {
    case 'green': return `Green means the ${costLabel} is below 50% of the reference value.`;
    case 'yellow': return `Yellow means the ${costLabel} is 50% to 64% of the reference value.`;
    case 'orange': return `Orange means the ${costLabel} is 65% to 74% of the reference value.`;
    case 'red': return `Red means the ${costLabel} is 75% or more of the reference value.`;
    default: return 'No verified value is available for a price comparison.';
  }
}

export function buildRetailIndicatorTooltip(input: {
  providerName: string;
  indicator: RetailIndicator;
  allIn: number | null | undefined;
  marketPrice: number | null | undefined;
  evidenceSource: string;
  costLabel?: string;
  costCaveat?: string;
}): string {
  const cleanedSource = input.evidenceSource.replace(/\s+/g, ' ').trim() || 'reference value';
  const source = cleanedSource.length > 140 ? `${cleanedSource.slice(0, 137)}...` : cleanedSource;
  if (input.indicator.ratio === null || input.allIn == null || input.marketPrice == null) {
    if (input.marketPrice != null && Number.isFinite(input.marketPrice) && input.marketPrice > 0) {
      return `${input.providerName}: ${formatUsd(input.marketPrice)} reference from ${source}. Bid-cost comparison is unavailable. ${input.costCaveat || ''}`.trim();
    }
    return `${input.providerName}: no saved or verified value. ${retailIndicatorBandDescription(input.indicator)}`;
  }
  const label = input.costLabel || 'All-in';
  const band = retailIndicatorBandDescription(input.indicator, input.costLabel?.toLowerCase() || 'all-in cost');
  return `${input.providerName}: ${formatUsd(input.marketPrice)} reference from ${source}. ${label} ${formatUsd(input.allIn)} is ${Math.round(input.indicator.ratio * 100)}% of that value. ${band} ${input.costCaveat || ''}`.trim();
}

export function explainHibidStatus(status: string | null | undefined): string {
  const cleaned = String(status ?? '').replace(/\s+/g, ' ').trim();
  const normalized = cleaned.toUpperCase();
  if (/\bOUTBID\b|\bLOSING\b/.test(normalized)) return 'Outbid: another bidder currently leads. Review your verified ceiling before deciding what to do.';
  if (/\bWINNING\b/.test(normalized)) return 'Winning: you currently lead this lot, but the auction has not ended.';
  if (/\bWON\b/.test(normalized)) return 'Won: the auction reports that you won this lot.';
  if (/\bCLOS(?:ED|ING)\b/.test(normalized)) {
    return /\bCLOSED\b/.test(normalized)
      ? 'Closed: bidding has ended for this lot.'
      : 'Closing: the lot is in its closing sequence and its end time may extend after a bid.';
  }
  if (/\bUPCOMING\b/.test(normalized)) return 'Upcoming: the lot is published, but bidding has not opened yet.';
  if (/\bOPEN\b/.test(normalized)) return 'Open: HiBid currently shows this lot as open for bidding.';
  if (/\bPOSTED\b/.test(normalized)) return 'Posted: HiBid has published this lot. Posted alone does not confirm that bidding is open.';
  return cleaned
    ? `${cleaned.slice(0, 80)}: HiBid's current lot status. Check the lot page for exact timing and bidding details.`
    : 'HiBid status is unavailable. Check the lot page for exact timing and bidding details.';
}

export function computeAccountVerdict(input: AccountVerdictInput): AccountVerdict {
  const partsOnly = input.partsOnly === true || input.condition?.partsOnly === true;
  if (partsOnly) return { kind: 'parts_only', cls: 'black', label: 'parts-only lot', advice: 'do not use working-retail math; value it as parts.' };
  if (input.condition?.cautions.includes('possible repair')) {
    return { kind: 'manual', cls: 'na', label: 'repair review', advice: 'possible repair risk; verify condition and revise the ceiling before bidding.' };
  }
  const status = input.status ?? '';
  const winning = /winning|won/i.test(status);
  const outbid = /outbid|losing/i.test(status);
  const nextHammer = input.nextHammer;
  const maxBid = input.maxBid;
  const allIn = input.allIn;
  const retail = input.retail;
  const hasCeiling = maxBid != null && Number.isFinite(maxBid) && nextHammer != null && Number.isFinite(nextHammer);
  const hasCost = allIn != null && Number.isFinite(allIn);
  const hasRetail = retail != null && Number.isFinite(retail) && retail > 0;
  if (input.costsProvisional) {
    if (hasCeiling && nextHammer >= maxBid) {
      return {
        kind: 'at_ceiling', cls: 'orange', label: 'at your ceiling',
        advice: `the next bid ${nextHammer > maxBid ? 'exceeds' : 'reaches'} your saved $${maxBid.toFixed(2)} hammer ceiling. Other costs remain unverified.`,
      };
    }
    return { kind: 'manual', cls: 'na', label: status || 'cost review', advice: 'costs are provisional; no profit or raise recommendation is established.' };
  }
  if (winning) {
    if (!hasCost || !hasRetail) return { kind: 'manual', cls: 'na', label: status || 'manual review', advice: 'no usable retail comparison; decide manually.' };
    if (allIn > retail) return { kind: 'winning_above_retail', cls: 'red', label: 'winning above retail', advice: 'you are winning above retail; consider exiting if the auction permits it.' };
    return { kind: 'hold', cls: 'green', label: 'winning, good price', advice: 'hold; do not raise.' };
  }
  if (!hasCeiling || !hasCost || !hasRetail) return { kind: 'manual', cls: 'na', label: status || 'manual review', advice: 'no usable retail ceiling; decide manually.' };
  if (outbid) {
    if (nextHammer > maxBid) return { kind: 'let_go', cls: 'red', label: 'let it go', advice: `the next bid is past your $${maxBid.toFixed(2)} ceiling.` };
    return { kind: 'raise', cls: 'green', label: 'worth raising', advice: `still under your $${maxBid.toFixed(2)} ceiling.` };
  }
  if (nextHammer > maxBid) return { kind: 'at_ceiling', cls: 'orange', label: 'at your ceiling', advice: `the next bid is past $${maxBid.toFixed(2)}.` };
  return { kind: 'under_ceiling', cls: 'green', label: 'under your ceiling', advice: `ceiling $${maxBid.toFixed(2)}.` };
}

export const calculateAllInCost = calculateUsAllIn;
export const buildAccountVerdict = computeAccountVerdict;

export function buildRetailLinks(query: string | null | undefined): RetailLinks {
  const cleaned = String(query ?? '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return { amazon: '', ebay: '', amazonUrl: '', ebayUrl: '' };
  const encoded = encodeURIComponent(cleaned);
  const amazon = `https://www.amazon.com/s?k=${encoded}`;
  const ebay = `https://www.ebay.com/sch/i.html?_nkw=${encoded}&LH_Sold=1&LH_Complete=1`;
  return {
    amazon,
    ebay,
    amazonUrl: amazon,
    ebayUrl: ebay,
  };
}

export function buildRetailSearchPresentation(provider: 'amazon' | 'ebay', query: string | null | undefined): RetailSearchPresentation {
  const cleaned = String(query ?? '').replace(/\s+/g, ' ').trim();
  const links = buildRetailLinks(cleaned);
  const shownQuery = !cleaned ? 'this lot' : cleaned.length > 100 ? `${cleaned.slice(0, 97)}...` : cleaned;
  if (provider === 'amazon') {
    const title = `No verified Amazon price was found. Search Amazon.com for "${shownQuery}".`;
    return { provider, label: 'Amazon \u2197', href: links.amazon, title, ariaLabel: title };
  }
  const title = `No saved eBay resale value is available. Search eBay Sold and Completed listings for "${shownQuery}".`;
  return { provider, label: 'eBay \u2197', href: links.ebay, title, ariaLabel: title };
}

export function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '--';
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}
