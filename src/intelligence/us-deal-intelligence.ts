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

export interface ProductIdentity {
  name: string;
  query: string;
  brand: string;
  model: string | null;
  model2: string | null;
  kind: ProductKind | null;
  capacities: string[];
  tokens: string[];
  statedRetail?: number;
}

export type ProductKind =
  | 'projector' | 'monitor' | 'television' | 'receiver' | 'headphones'
  | 'microphone' | 'laptop' | 'desktop' | 'tablet' | 'phone' | 'speaker'
  | 'camera' | 'printer' | 'keyboard' | 'mouse' | 'router' | 'vacuum' | 'car-stereo';

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
  price: number | null;
  used: boolean;
  sponsored: boolean;
  url: string;
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

export function requiresQuantityConfirmation(quantity: number | null | undefined, mixed: boolean, confirmedQuantity: number | null | undefined): boolean {
  return Boolean(((typeof quantity === 'number' && Number.isFinite(quantity) && quantity > 1) || mixed) && !(typeof confirmedQuantity === 'number' && Number.isFinite(confirmedQuantity) && confirmedQuantity >= 1));
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
  condition?: Pick<ConditionAssessment, 'partsOnly'> | null;
  nextHammer?: number | null;
  allIn?: number | null;
  maxBid?: number | null;
  retail?: number | null;
}

export interface AccountVerdict {
  kind: AccountVerdictKind;
  cls: 'black' | 'na' | 'green' | 'red' | 'orange';
  label: string;
  advice: string;
}

const FIELD_LINE_RE = /^[ \t]*([^:?\n]{2,60}?)[ \t]*([:?])[ \t]*(.*)$/;
const NOISE_WORDS = new Set([
  'retail', 'new', 'brand', 'the', 'best', 'with', 'and', 'for', 'built', 'in', 'a',
  'of', 'to', 'up', 'included', 'includes', 'free', 'shipping', 'lot', 'item', 'items',
  'qty', 'x', 'pack', 'set', 'estimated', 'est', 'price', 'msrp', 'value', 'approx',
  'approximately', 'assorted', 'various',
]);
const MODEL_RE = /^[A-Za-z]{1,8}-?\d{1,8}[A-Za-z0-9+.-]*$/;
const MODEL_ALT_RE = /^[A-Za-z]{1,8}-[A-Za-z0-9+.]{2,14}$/;
const CAPACITY_RE = /^(?:\d+(?:\.\d+)?\s*[xX]\s*)?\d+(?:\.\d+)?(?:gb|tb|mb|kb)$/i;
const GENERIC_MODEL_RE = /^(?:n\/?a|none|null|nil|unknown|unspecified|various|assorted|misc(?:ellaneous)?|standard|generic|regular|default|see\s+(?:photos?|pictures?|description)|no\s+model|model|[a-z]\s*-?\s*series|series|multiple)$/i;
const CONDITION_PARTS_RE = /\b(for\s*parts|parts\s*only|salvage|broken|not\s*working|non[\s-]*functional|defective|scrap|damaged\s*beyond)\b/i;
const CONDITION_GOOD_RE = /\b(brand\s*new|new|sealed|excellent|like\s*new|mint|open\s*box|good|very\s*good)\b/i;
const POSITIVE_RE = /\b(tested\s*(?:and\s*)?working|works?\s*(?:great|well|fine|perfectly)|fully\s*functional|brand\s*new|sealed|new\s*in\s*box|nib\b)/i;
const ACCESSORY_NOUN_RE = /\b(case|cover|sleeve|skin|pouch|protector|tips|eartips|cable|charger|adapter|mount|holder|stand|strap|band|bumper|shell|film|dock|lanyard|clip|baffle|shield|backplate|back\s*plate|faceplate|bracket|standoffs?|screws?|screw\s*kit|thermal\s*pad|riser|extender|gasket|grommet|spacer|shroud|bezel|decal|sticker|manual|module|chip|header|jumper|ribbon|harness|insert)\b/i;
const ACCESSORY_MARKER_RE = /\b(compatible\s+with|replacement\s+for|designed\s+for|made\s+for|for\s+use\s+with|fits\s+(?:the\s+)?[A-Z0-9])/i;
const FOR_PRODUCT_VERBS = 'compatible\\s+with|replacement\\s+(?:part\\s+)?for|designed\\s+for|made\\s+for|for\\s+use\\s+with|fits|suitable\\s+for|upgrade\\s+for';
const TITLE_PREFIX_RE = /^\s*(?:\(?\s*(?:open\s*box|openbox|refurbished|refurb|renewed|used|pre[\s-]?owned)[^-|:]*\)?\s*[-|:]\s*)+/i;
const USED_RE = /\b(open\s*box|openbox|refurbished|refurb|renewed|pre[\s-]?owned|used|for\s+parts)\b/i;
const GENERIC_BRAND_RE = /^(?:wireless|smart|portable|professional|digital|electric|electronic|gaming|bluetooth|usb|4k|8k|hd|full|mini|new|vintage|built[\s-]?in|multifunction|automatic|cordless|rechargeable)$/i;
const QUERY_DESCRIPTOR_NOISE = new Set(['smart', 'wireless', 'wifi', 'wi-fi', 'bt', 'bluetooth', '4k', '8k', 'hd', 'uhd']);
const PRODUCT_KIND_PATTERNS: Array<[ProductKind, RegExp]> = [
  ['projector', /\bprojectors?\b/i],
  ['monitor', /\b(?:computer\s+)?monitors?\b/i],
  ['television', /\b(?:televisions?|tvs?|qled|oled)\b/i],
  ['receiver', /\b(?:a\/?v\s+)?receivers?\b|\bamplifiers?\b/i],
  ['headphones', /\b(?:headphones?|headsets?|earbuds?|earphones?)\b/i],
  ['microphone', /\b(?:microphones?|mics?)\b/i],
  ['laptop', /\b(?:laptops?|notebooks?|macbooks?|chromebooks?)\b/i],
  ['desktop', /\b(?:desktop(?:\s+computers?)?|all[\s-]in[\s-]ones?|computer\s+towers?|gaming\s+pcs?)\b/i],
  ['tablet', /\b(?:tablets?|ipads?)\b/i],
  ['phone', /\b(?:smartphones?|cell\s+phones?|iphones?)\b/i],
  ['speaker', /\b(?:speakers?|soundbars?)\b/i],
  ['camera', /\b(?:cameras?|camcorders?)\b/i],
  ['printer', /\b(?:printers?|scanners?)\b/i],
  ['keyboard', /\bkeyboards?\b/i],
  ['mouse', /\b(?:computer\s+)?mice\b|\bmouse\b/i],
  ['router', /\b(?:routers?|mesh\s+systems?)\b/i],
  ['vacuum', /\b(?:vacuum(?:\s+cleaners?)?|robot\s+vacuums?)\b/i],
  ['car-stereo', /\b(?:car\s+stereos?|carplay\s+(?:stereos?|radios?)|head\s+units?)\b/i],
];

function normalise(value: unknown): string {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[\u00a0\u2007\u202f]/g, ' ');
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
    const match = line.match(FIELD_LINE_RE);
    if (match && match[1]?.trim()) {
      const key = match[1].trim().toLowerCase().replace(/\s+/g, ' ');
      const value = match[3]?.trim() ?? '';
      if (match[2] === '?' && !value) {
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

export function assessCondition(text: string | null | undefined): ConditionAssessment {
  const parsed = parseStructuredDescription(text);
  const { fields, freeText } = parsed;
  const condition = fieldValue(fields, 'condition') ?? '';
  const damageDescription = fieldValue(fields, 'damage desct', 'damage desc', 'damage description', 'damage details') ?? '';
  const missingDescription = fieldValue(fields, 'missing parts desc', 'missing parts description', 'missing desc') ?? '';
  const notes = [fieldValue(fields, 'notes'), fieldValue(fields, 'note')].filter(Boolean).join(' ');
  const damagedFlag = yesNo(fieldValue(fields, 'is item damaged', 'item damaged', 'damaged'));
  const missingFlag = yesNo(fieldValue(fields, 'missing major parts', 'missing parts', 'missing any parts'));
  const functionalFlag = yesNo(fieldValue(fields, 'is item functional', 'item functional', 'functional', 'working'));
  const goodCondition = CONDITION_GOOD_RE.test(condition) && !CONDITION_PARTS_RE.test(condition);
  const scan = [condition, damageDescription, missingDescription, notes, freeText].filter(Boolean).join('\n');
  const evidence = [damageDescription, missingDescription, notes, freeText].filter(Boolean).join('\n');
  const partsReasons: string[] = [];
  if (CONDITION_PARTS_RE.test(condition)) partsReasons.push(`Condition: ${condition.trim()}`);
  const partPatterns: ReadonlyArray<readonly [RegExp, string]> = [
    [/\bfor\s*parts\s*(?:only)?\b/i, 'listed for parts only'],
    [/\bparts\s*(?:only|\/\s*repair)\b/i, 'parts only'],
    [/\bnot\s*working\b/i, 'stated not working'],
    [/\bdoes\s*not\s*(?:work|turn on|power)/i, 'does not work / power on'],
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
    if (pattern.test(evidence)) partsReasons.push(label);
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
  const positive = CONDITION_GOOD_RE.test(condition) || POSITIVE_RE.test([notes, freeText].join('\n')) || functionalFlag === true;
  const cautionPatterns: ReadonlyArray<readonly [RegExp, string]> = [
    [/\buntested\b/i, 'untested'],
    [/\bnot\s*tested\b/i, 'not tested'],
    [/\bopen\s*box\b/i, 'open box'],
    [/\breturn(?:ed|s)?\b/i, 'customer return'],
    [/\bscratch(?:ed|es)?\b/i, 'scratched'],
    [/\bdent(?:ed|s)?\b/i, 'dented'],
    [/\brefurbish(?:ed)?\b/i, 'refurbished'],
    [/\bused\b/i, 'used'],
  ];
  let cautions = cautionPatterns.filter(([pattern]) => pattern.test(scan)).map(([, label]) => label);
  if (positive) cautions = cautions.filter((label) => !/untested|not tested|used/.test(label));
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

export function looksLikeModel(value: string | null | undefined): boolean {
  const model = String(value ?? '').trim();
  return model.length >= 2 && model.length <= 24 && !GENERIC_MODEL_RE.test(model) && (/\d/.test(model) || MODEL_ALT_RE.test(model));
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

function tokeniseIdentity(value: string): string[] {
  return value.split(/[\s,;/]+/).filter(Boolean).map((token) => token.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9+.-]+$/g, '')).filter(Boolean);
}

export function detectProductKind(value: string | null | undefined): ProductKind | null {
  const source = normalise(value);
  return PRODUCT_KIND_PATTERNS.find(([, pattern]) => pattern.test(source))?.[0] ?? null;
}

export function extractProductIdentity(record: LotAnalysisRecord): ProductIdentity;
export function extractProductIdentity(title: string | null | undefined, description?: string): ProductIdentity;
export function extractProductIdentity(recordOrTitle: LotAnalysisRecord | string | null | undefined, description = ''): ProductIdentity {
  const record = typeof recordOrTitle === 'object' && recordOrTitle !== null ? recordOrTitle : null;
  const title = record ? (record.title || record.lead || '') : recordOrTitle;
  const sourceDescription = record ? (record.description || '') : description;
  const lead = normalise(title).trim();
  const parsed = parseStructuredDescription(sourceDescription);
  const prose = parsed.freeText.split(/\n\s*\*{2,}/)[0]?.replace(/\n+/g, ' ').trim() ?? '';
  // The visible lot title identifies the product. Description prose may enrich
  // structured fields, but must never replace the title with marketing copy.
  const source = lead || prose;
  const sections = source.split('|').map((part) => part.trim()).filter(Boolean);
  let named = sections.length > 1
    ? sections.find((part) => !/^(?:retail|msrp|est\.?|value)?\s*\$?\s*[\d,]+(?:\.\d+)?\s*$/i.test(part)) ?? sections.at(-1) ?? source
    : source;
  named = named
    .replace(/^\s*(?:retail|msrp|est\.?\s*retail(?:\s*price)?|value)\s*[:\-]?\s*\$?\s*[\d,]+(?:\.\d+)?\s*/i, '')
    .replace(/^\s*\$\s*[\d,]+(?:\.\d+)?\s*/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  let name = named.replace(/\s*-\s*$/, '').trim();
  if (name.length < 3) name = lead || normalise(sourceDescription).split('\n')[0]?.trim() || '';
  const tokens = tokeniseIdentity(name).filter((token) => !NOISE_WORDS.has(token.toLowerCase()) && !/^\$?[\d.,]+$/.test(token));
  const titleBrand = tokens[0] || '';
  const statedBrand = (fieldValue(parsed.fields, 'brand', 'manufacturer', 'make') ?? '').trim();
  const statedBrandAppearsInTitle = statedBrand && new RegExp(`\\b${escapeRegExp(statedBrand)}\\b`, 'i').test(name);
  const brand = statedBrand && (!titleBrand || GENERIC_BRAND_RE.test(titleBrand) || statedBrandAppearsInTitle) ? statedBrand : titleBrand;
  const statedModel = (fieldValue(parsed.fields, 'model', 'model #', 'model number', 'mpn') ?? '').trim();
  const titleModel = tokens.find((token) => MODEL_RE.test(token) && !/^\d+$/.test(token)) ?? tokens.find((token) => MODEL_ALT_RE.test(token));
  const model = (looksLikeModel(statedModel) && modelMatches(name, statedModel) ? statedModel : null) || titleModel || (looksLikeModel(statedModel) ? statedModel : null);
  const model2 = tokens.find((token) => token !== model && token.toLowerCase() !== String(model ?? '').toLowerCase() && token.toLowerCase() !== brand.toLowerCase() && MODEL_ALT_RE.test(token) && !GENERIC_MODEL_RE.test(token)) ?? null;
  const capacities = [...new Set(tokens.filter((token) => CAPACITY_RE.test(token)))];
  const queryParts: string[] = brand ? [brand] : [];
  const second = tokens[1];
  if (second && !/\d/.test(second) && second.toLowerCase() !== brand.toLowerCase()) queryParts.push(second);
  for (const token of [model, model2, ...capacities]) {
    if (token && !queryParts.some((part) => part.toLowerCase() === token.toLowerCase())) queryParts.push(token);
  }
  if (!model) {
    const descriptor = tokens.slice(1).find((token) =>
      token.length > 2 &&
      !/\d/.test(token) &&
      !QUERY_DESCRIPTOR_NOISE.has(token.toLowerCase())
    );
    if (descriptor && !queryParts.some((part) => part.toLowerCase() === descriptor.toLowerCase())) queryParts.push(descriptor);
  }
  const query = queryParts.length > 0 ? queryParts.join(' ') : tokens.slice(0, 5).join(' ');
  const identity: ProductIdentity = { name, query: query.trim(), brand, model: model || null, model2, kind: detectProductKind(name), capacities, tokens: tokens.slice(0, 12) };
  if (record?.statedRetail != null && Number.isFinite(record.statedRetail) && record.statedRetail > 0) identity.statedRetail = record.statedRetail;
  return identity;
}

export const extractProduct = extractProductIdentity;

export function assessLotCondition(record: LotAnalysisRecord | string | null | undefined): ConditionAssessment {
  if (typeof record === 'string' || record == null) return assessCondition(record);
  const conditionField = record.condition ? `Condition: ${record.condition}` : '';
  return assessCondition([record.title, record.lead, record.description, conditionField].filter(Boolean).join('\n'));
}

export function detectMixedLot(title: string | null | undefined, description = ''): MixedLotResult {
  const combined = normalise([title, description].filter(Boolean).join('\n'));
  const reasons: string[] = [];
  const checks: Array<[RegExp, string]> = [
    [/\b(?:group|assorted|various|mixed|bundle|collection|contents)\b/i, 'group or mixed-lot wording'],
    [/\blot\s+of\s+\d+/i, 'lot quantity wording'],
    [/\b(?:qty|quantity)\s*[:#]?\s*[2-9]\d*/i, 'quantity greater than one'],
    [/\b\d+\s*(?:x|pieces?|items?|units?|sets?)\b/i, 'multiple-item quantity'],
    [/\bwith\s+(?:components?|contents?|assorted\s+items?|mixed\s+items?|equipment)\b/i, 'explicit component or contents wording'],
  ];
  for (const [pattern, reason] of checks) if (pattern.test(combined)) reasons.push(reason);
  const parsed = parseStructuredDescription(description);
  const componentSource = [normalise(title), parsed.freeText].filter(Boolean).join('\n');
  const components = [...new Set(componentSource
    .split(/\n|;|\s+-\s+|\s*[•]\s*/)
    .map((part) => part.replace(/^\s*(?:retail|msrp|value)\s*[:\-]?\s*\$?[\d,.]+\s*\|?\s*/i, '').trim())
    .filter((part) => part.length >= 3 && !/^(?:untested|tested|working|condition\b|notes?\b)/i.test(part)))]
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
    const title = htmlAttribute(block, 'alt') || htmlText(block, /<(?:h2|span)[^>]*(?:data-cy=["']title-recipe["']|s-title-instructions-style|a-size-base-plus)[^>]*>([\s\S]*?)<\/(?:h2|span)>/i);
    if (!title) return;
    const sponsored = /data-component-type=["']sp-sponsored-result|\bAdHolder\b|\bSponsored(?:\s+Ad)?\b|sponsored-label-text/i.test(block);
    const candidate: AmazonCandidate = {
      asin,
      title,
      price: parseAmazonPrice(block),
      used: USED_RE.test(title),
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

export function isAccessoryListing(title: string | null | undefined, product: ProductIdentity): boolean {
  const candidateTitle = String(title ?? '');
  const identity = [product.brand, product.model, product.model2].filter(Boolean).map((value) => escapeRegExp(String(value)).replace(/[-\s]/g, '[-\\s]?')).join('|');
  if (identity) {
    const forProduct = new RegExp(`\\b(?:${FOR_PRODUCT_VERBS})\\s+(?:the\\s+)?[^,;.]{0,40}?(?:${identity})`, 'i');
    if (forProduct.test(candidateTitle)) return true;
  }
  const noun = ACCESSORY_NOUN_RE.exec(candidateTitle);
  if (!noun) return false;
  if (ACCESSORY_MARKER_RE.test(candidateTitle)) return true;
  const bare = candidateTitle.replace(TITLE_PREFIX_RE, '').trim();
  if (product.brand) {
    const firstWord = bare.match(/[A-Za-z0-9][A-Za-z0-9.&'-]*/)?.[0] ?? '';
    if (firstWord && firstWord.toLowerCase() !== product.brand.toLowerCase()) return true;
  }
  const identityRe = product.model
    ? new RegExp(escapeRegExp(product.model).replace(/[-\s]/g, '[-\\s]?'), 'i')
    : product.brand ? new RegExp(`\\b${escapeRegExp(product.brand)}\\b`, 'i') : null;
  if (!identityRe) return noun.index < 20;
  const identityMatch = identityRe.exec(candidateTitle);
  if (!identityMatch) return true;
  return noun.index < identityMatch.index;
}

export function scoreRetailCandidate(title: string | null | undefined, product: ProductIdentity): number {
  const candidateTitle = String(title ?? '');
  if (!candidateTitle) return 0;
  if (!ACCESSORY_NOUN_RE.test(product.name) && isAccessoryListing(candidateTitle, product)) return 0;
  const exactModel = product.model ? modelMatches(candidateTitle, product.model) : false;
  const credibleBrand = Boolean(product.brand) && !GENERIC_BRAND_RE.test(product.brand);
  const brandMatches = credibleBrand ? new RegExp(`\\b${escapeRegExp(product.brand)}\\b`, 'i').test(candidateTitle) : false;
  // Generic overlap such as "4K", "smart", or "wireless" is not product
  // identity. A credible brand must match unless an exact model proves it.
  if (credibleBrand && !brandMatches && !exactModel) return 0;
  const candidateKind = detectProductKind(candidateTitle);
  if (!exactModel && product.kind && candidateKind !== product.kind) return 0;
  let score = 0;
  if (product.model) {
    if (exactModel) score += 5;
    else return 0;
  }
  if (product.model2 && modelMatches(candidateTitle, product.model2)) score += 2;
  if (brandMatches) score += 2;
  const tokens = product.tokens.map((token) => token.toLowerCase()).filter((token) => token.length > 2);
  const lower = candidateTitle.toLowerCase();
  const hits = tokens.filter((token) => lower.includes(token)).length;
  score += tokens.length ? (hits / tokens.length) * 3 : 0;
  return score;
}

function retailPriceFloor(product: ProductIdentity): number {
  const statedRetail = product.statedRetail;
  return statedRetail != null && Number.isFinite(statedRetail) && statedRetail > 0 ? statedRetail * 0.3 : 0;
}

export function matchAmazonCandidates(candidates: AmazonCandidate[], product: ProductIdentity): AmazonCandidateMatch | null {
  const scored = candidates
    .filter((candidate) => !candidate.sponsored && candidate.price != null && candidate.price >= retailPriceFloor(product))
    .map((candidate) => ({ candidate, score: scoreRetailCandidate(candidate.title, product) - (candidate.used ? 3 : 0) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);
  if (!scored.length) return null;
  const top = scored[0]?.score ?? 0;
  const band = scored.filter((entry) => entry.score >= top - 1.5);
  const newCandidates = band.filter((entry) => !entry.candidate.used);
  return [...(newCandidates.length ? newCandidates : band)].sort((left, right) => (left.candidate.price ?? Infinity) - (right.candidate.price ?? Infinity))[0] ?? null;
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

export function computeAccountVerdict(input: AccountVerdictInput): AccountVerdict {
  const partsOnly = input.partsOnly === true || input.condition?.partsOnly === true;
  if (partsOnly) return { kind: 'parts_only', cls: 'black', label: 'parts-only lot', advice: 'do not use working-retail math; value it as parts.' };
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
  const encoded = encodeURIComponent(String(query ?? '').trim());
  const amazon = `https://www.amazon.com/s?k=${encoded}`;
  const ebay = `https://www.ebay.com/sch/i.html?_nkw=${encoded}&LH_Sold=1&LH_Complete=1`;
  return {
    amazon,
    ebay,
    amazonUrl: amazon,
    ebayUrl: ebay,
  };
}

export function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '--';
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}
