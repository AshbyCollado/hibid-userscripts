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
}

export type ProductKind =
  | 'projector' | 'monitor' | 'television' | 'receiver' | 'headphones'
  | 'microphone' | 'laptop' | 'desktop' | 'tablet' | 'phone' | 'speaker'
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
  referenceKind?: 'exact' | 'equivalent';
}

export type AmazonMatch = AmazonCandidateMatch;

export function trustedAmazonMarketValue(status: string, match: AmazonCandidateMatch | null | undefined, quantity = 1): number | null {
  if (status !== 'matched' || match?.candidate.price == null || !Number.isFinite(match.candidate.price) || match.candidate.price <= 0) return null;
  return match.candidate.price * Math.max(1, Number.isFinite(quantity) ? quantity : 1);
}

export function requiresQuantityConfirmation(quantity: number | null | undefined, mixed: boolean, confirmedQuantity: number | null | undefined): boolean {
  return Boolean(((typeof quantity === 'number' && Number.isFinite(quantity) && quantity > 1) || mixed) && !(typeof confirmedQuantity === 'number' && Number.isFinite(confirmedQuantity) && confirmedQuantity >= 1));
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
    || source.match(/\b(?:count|ct)\s+(?:of\s+)?(\d{1,4})\b/i)
    || source.match(/^\s*\(?\s*(\d{1,4})\s*\)?\s*[x×]\s+/i)
    || source.match(/\b(?:qty|quantity)\s*[:#-]?\s*(\d{1,4})\b/i)
    || source.match(/\b(\d{1,4})\s+(?:units?|items?|pieces?|pcs)\b/i)
    || source.match(/\b(\d{1,4})[\s-]*(?:pack|pk)\b/i);
  const quantity = match ? Number(match[1]) : 0;
  return Number.isInteger(quantity) && quantity > 1 ? quantity : null;
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
const STRUCTURED_FIELD_LABELS = [
  'Estimated Retail Price', 'Est. Retail Price', 'Shelf Location', 'Assembly Required',
  'Missing Parts Description', 'Missing Parts Desc', 'Missing Major Parts', 'Missing Any Parts',
  'Damage Description', 'Damage Details', 'Damage Desct', 'Damage Desc',
  'Is Item Functional', 'Item Functional', 'Is Item Damaged', 'Item Damaged',
  'In Packaging', 'Missing Parts', 'Functional', 'Condition', 'Damaged',
  'Quantity', 'Product Name', 'Product', 'Title', 'Lead', 'Manufacturer', 'Brand',
  'Model Number', 'Model #', 'Model', 'MPN', 'VIN #', 'Year', 'Make', 'Notes', 'Note',
] as const;
const STRUCTURED_FIELD_MARKER_SOURCE = STRUCTURED_FIELD_LABELS
  .slice()
  .sort((left, right) => right.length - left.length)
  .map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
const NOISE_WORDS = new Set([
  'retail', 'new', 'brand', 'the', 'best', 'with', 'and', 'for', 'built', 'in', 'a',
  'of', 'to', 'up', 'included', 'includes', 'free', 'shipping', 'lot', 'item', 'items',
  'qty', 'x', 'pack', 'set', 'estimated', 'est', 'price', 'msrp', 'value', 'approx',
  'approximately', 'assorted', 'various',
]);
const MODEL_RE = /^[A-Za-z]{1,8}-?\d{1,8}[A-Za-z0-9+.-]*$/;
const MODEL_ALT_RE = /^[A-Za-z]{1,8}-[A-Za-z0-9+.]{2,14}$/;
const PART_NUMBER_RE = /^(?=.{8,32}$)(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]+(?:-[A-Za-z0-9]+){2,}$/;
// Title prose such as "anti-fog" or "heavy-duty" is not a model. A
// letter-only hyphenated title token must look like an uppercase manufacturer
// code (for example NT-USB+); explicitly stated Model fields stay permissive.
const TITLE_MODEL_ALT_RE = /^(?=[A-Z0-9+.-]*[A-Z]{2})[A-Z0-9]{1,8}-[A-Z0-9+.]{1,14}$/;
const DIGIT_LED_MODEL_RE = /^(?=.{4,24}$)(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
const NUMERIC_PART_RE = /^\d{2,8}(?:-\d{2,8})+$/;
const CAPACITY_RE = /^(?:\d+(?:\.\d+)?\s*[xX]\s*)?\d+(?:\.\d+)?(?:gb|tb|mb|kb)$/i;
const GENERIC_MODEL_RE = /^(?:n\/?a|none|null|nil|unknown|unspecified|various|assorted|misc(?:ellaneous)?|standard|generic|regular|default|see\s+(?:photos?|pictures?|description)|no\s+model|model|[a-z]\s*-?\s*series|series|multiple|ddr[345](?:l|x)?|wi[\s-]*fi\s*[5-7]e?|bluetooth\s*\d+(?:\.\d+)?|bt\s*\d+(?:\.\d+)?|usb\s*\d+(?:\.\d+)?|hdmi\s*\d+(?:\.\d+)?)$/i;
const CONDITION_PARTS_RE = /\b(for\s*parts|parts\s*only|salvage|broken|not\s*working|non[\s-]*functional|defective|scrap|damaged\s*beyond)\b/i;
const CONDITION_GOOD_RE = /\b(brand\s*new|new|sealed|excellent|like\s*new|mint|open\s*box|good|very\s*good)\b/i;
const POSITIVE_RE = /\b(tested\s*(?:and\s*)?working|works?\s*(?:great|well|fine|perfectly)|fully\s*functional|brand\s*new|sealed|new\s*in\s*box|nib\b)/i;
const ACCESSORY_NOUN_RE = /\b(case|cover|sleeve|skin|pouch|protector|tips|eartips|cable|cord|charger|adapter|mount|holder|stand|arm|topper|strap|band|belt|bumper|shell|film|dock|lanyard|clip|controller|game|spray|cloth|cloths|pads?|wipes?|filters?|valves?|sensor\s*wires?|disc\s+drive|remote(?:\s+control)?|bowl|cups?|jar|lid|blade|hopper|bellows?|air\s+blower|baffle|shield|backplate|back\s*plate|build\s*plate|magnetic\s+plate|pei\s+(?:sheet|plate)|flexi(?:ble)?\s+steel(?:\s+sheet)?|chisels?|drill\s+bits?|bit\s+sets?|faceplate|wall\s*plate|trim\s+kit|bracket|standoffs?|screws?|screw\s*kit|thermal\s+pad|riser|extender|gasket|grommet|spacer|shroud|bezel|decal|sticker|manual|module|chip|header|jumper|ribbon|harness|insert|lamps?|bulbs?|footswitch(?:es)?|foot\s+switch(?:es)?|pedals?|inks?|toners?|cartridges?|probes?|camera\s+heads?|pizza\s+pan|baking\s+pan|crumb\s+tray|replacement\s+tray|plant\s+food|descal(?:er|ing)\s+tablets?|cleaning\s+tablets?|photo\s+prop|display\s+decoration)s?\b/i;
const ACCESSORY_MARKER_RE = /\b(compatible\s+with|replacement\s+for|replacement\s+parts?\s+only|designed\s+for|made\s+for|for\s+use\s+with|fits?\s+for|fits\s+(?:the\s+)?[A-Z0-9])/i;
const FOR_PRODUCT_VERBS = 'compatible\\s+with|replacement\\s+(?:part\\s+)?for|designed\\s+for|made\\s+for|for\\s+use\\s+with|fits|suitable\\s+for|upgrade\\s+for';
const TITLE_PREFIX_RE = /^\s*(?:\(?\s*(?:open\s*box|openbox|refurbished|refurb|renewed|used|pre[\s-]?owned)[^-|:]*\)?\s*[-|:]\s*)+/i;
const USED_RE = /\b(open\s*box|openbox|refurbished|refurb|renewed|pre[\s-]?owned|used|for\s+parts)\b/i;
const GENERIC_BRAND_RE = /^(?:wireless|smart|portable|professional|digital|electric|electronic|gaming|bluetooth|usb|4k|8k|hd|full|mini|new|vintage|built[\s-]?in|multifunction|automatic|cordless|rechargeable|custom|workstation|tower|desktop|computer|system|inch|external|drive|console|receiver|headset|headphones?|monitor|television|tv|camera|printer|speaker|router|vacuum|couch|crystal|pink|beach|tandem|heated|wooden|steam|solar|royal|black|white|clear|low|compact|dried|calming|extra|girls|baby|hallway|mold|linen|cat|king|prone|creativity|countertop)$/i;
const RESEARCH_QUERY_NOISE = new Set<string>();
const PRODUCT_KIND_PATTERNS: Array<[ProductKind, RegExp]> = [
  ['game-console', /\b(?:(?:playstation\s*[2-6]|ps\s*[2-6]|xbox(?:\s+(?:one|series\s*[sx]))?|nintendo\s+switch)[^,;]{0,35}\b(?:consoles?|systems?)|game\s+consoles?)\b/i],
  ['graphics-card', /\b(?:graphics|video)\s+cards?\b|\b(?:geforce\s+)?rtx\s*\d{3,4}\b|\bradeon\s+rx\s*\d{3,4}\b/i],
  ['memory', /\b(?:ram|memory\s+(?:kits?|modules?)|ddr[345])\b/i],
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
  ['tablet', /\b(?:tablets?|ipads?)\b/i],
  ['phone', /\b(?:smartphones?|cell\s+phones?|iphones?|phones?)\b/i],
  ['speaker', /\b(?:speakers?|soundbars?)\b/i],
  ['camera', /\b(?:cameras?|camcorders?)\b/i],
  ['printer', /\b(?:printers?|scanners?)\b|\b(?:epson\s+workforce|hp\s+(?:envy|deskjet|officejet))\s+[a-z]*-?\d/i],
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
  ['bose', /\bbose\b/i],
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
    .replace(/^\s*\{?\s*(?:each|ea)\s*\}?\s*/i, '')
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

export function extractProductDiscriminators(value: string | null | undefined): ProductDiscriminators {
  const source = normalise(value).toLowerCase();
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
  const wattages = collect(/\b(\d+(?:\.\d+)?)[\s-]*(?:w|watt(?:s)?)\b/gi, (match) => `${match[1]}w`);
  const batteryCapacities = collect(/\b(\d+(?:\.\d+)?)[\s-]*(?:ah|amp[\s-]*hours?)\b/gi, (match) => `${match[1]}ah`);
  const lensRanges = collect(/\b(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?[\s-]*mm\b/gi, (match) => `${match[1]}${match[2] ? `-${match[2]}` : ''}mm`);
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
  ];
  const explicitSeriesSignatures = [
    ...collect(/\barctis\s+nova\s+(\d+)(?:[xp])?\b/gi, (match) => `arctis-nova:${match[1]}`),
    ...collect(/\barctis\s+nova\s+(pro)\b/gi, (match) => `arctis-nova:${match[1]}`),
    ...collect(/\bgen(?:eration)?\s*(\d{1,2})\b/gi, (match) => `generation:${Number(match[1])}`),
    ...collect(/\b(\d{1,2})(?:st|nd|rd|th)?\s+gen(?:eration)?\b/gi, (match) => `generation:${Number(match[1])}`),
    ...collect(/\b([a-z]\d{1,3})\s+(ultra|tiny|tower)\s+(?:workstations?|desktops?|pcs?)\b/gi, (match) => `workstation:${String(match[1]).toLowerCase()}:${String(match[2]).toLowerCase()}`),
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
  const variantLabels = collect(/\b(?:unit|model|style|size)\s*[-:#]?\s*([a-z0-9][a-z0-9-]{0,15})\b/gi, (match) => String(match[1]).toLowerCase());
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
    ]),
    packageCounts: unique(packageCounts),
    colors: unique(colors),
    materials: unique(materials),
    productFamilies: unique(productFamilies),
    variantLabels: unique(variantLabels),
    volumes: unique(volumes),
    modeCounts: unique(modeCounts),
    featureCounts: unique(featureCounts),
  };
}

function matchesProductDiscriminators(candidateTitle: string, product: ProductIdentity): { matches: boolean; matchedCount: number; conflicts: string[]; missing: string[] } {
  const expected = product.discriminators || extractProductDiscriminators(product.name);
  const actual = extractProductDiscriminators(candidateTitle);
  const exactModel = Boolean(product.model && modelMatches(candidateTitle, product.model));
  const groups: Array<keyof ProductDiscriminators> = [
    'capacities', 'cubicCapacities', 'weightLimits', 'resolutions', 'dimensions', 'platformVariants', 'memoryTypes', 'frequencies',
    'refreshRates', 'storageTypes', 'networkStandards', 'editions', 'seriesSignatures',
    'voltages', 'wattages', 'batteryCapacities', 'lensRanges', 'gpuModels', 'cpuModels',
    'packageCounts', 'colors', 'materials', 'productFamilies', 'variantLabels',
    'volumes', 'modeCounts', 'featureCounts',
  ];
  let matchedCount = 0;
  const conflicts: string[] = [];
  const missing: string[] = [];
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
    if (group === 'variantLabels' && exactModel) continue;
    if (!expected[group].length) continue;
    const absent = expected[group].filter((value) => !actual[group].some((candidate) => valueMatches(group, value, candidate)));
    if (absent.length) {
      if (actual[group].length) conflicts.push(`${group}:${absent.join(',')}`);
      else missing.push(`${group}:${absent.join(',')}`);
    }
    if (group === 'gpuModels' || group === 'cpuModels') {
      const unexpected = actual[group].filter((value) => !expected[group].includes(value)
        && !expected[group].some((expectedValue) => isLessSpecificShadow(expectedValue, value)));
      if (unexpected.length) conflicts.push(`${group}:unexpected-${unexpected.join(',')}`);
    }
    matchedCount += (expected[group].length - absent.length) * (group === 'platformVariants' || group === 'seriesSignatures' ? 2 : 1);
  }
  if (!expected.packageCounts.length && actual.packageCounts.some((value) => Number(value) > 1)) {
    conflicts.push(`packageCounts:1!=${actual.packageCounts.join(',')}`);
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
  return missing.filter((value) => /^(?:capacities|packageCounts|volumes|cubicCapacities|weightLimits|batteryCapacities|lensRanges|editions|platformVariants):/.test(value));
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
    /^\s*\$(?!\s*\d+\s*\/)\s*[\d,]+(?:\.\d+)?\s*(?:[-:|]\s*)?/i,
    /^\s*\(?\s*(?:open\s*box|refurbished|refurb|renewed|pre[\s-]?owned|used|like\s+new|brand\s+new|factory\s+sealed|new\s+in\s+box)\s*\)?(?:\s*[-:|]\s*|\s+)/i,
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

function stripResearchSuffixes(value: string): string {
  let output = value.trim();
  const suffix = /(?:\s*(?:[-|,;]\s*)|\s+)\(?\s*(?:tested(?:\s+and)?\s+working|not\s+tested|working|untested|open\s*box|brand\s+new\s+in\s+box|brand\s+new|new\s+in\s+box|in\s+box|nib|used|refurbished|refurb|renewed|pre[\s-]?owned|for\s+parts(?:\s+only)?|parts\s+only|as[\s-]*is|damaged|pickup\s+only|local\s+pickup\s+only|see\s+(?:photos?|pictures?|description)|read\s+description|no\s+reserve|online\s+only\s+auction|lot\s*#?\s*\d+)\s*\)?\s*$/i;
  for (let pass = 0; pass < 12; pass += 1) {
    const next = collapseExactRepeatedRawText(output.replace(suffix, '').trim());
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

  let cleaned = collapseExactRepeatedRawText(original);
  for (let pass = 0; pass < 4; pass += 1) {
    const next = collapseExactRepeatedRawText(stripResearchPrefixes(stripResearchSuffixes(cleaned)));
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

  const tokens = capResearchQueryTokens(collapseBoundaryQueryTokens(collapseRepeatedQueryTokens(repairDetachedPluralSuffixes(query
    .split(/\s+/)
    .map((token) => token.replace(/^[.+\/-]+|[.\/-]+$/g, ''))
    .filter((token) => token && !RESEARCH_QUERY_NOISE.has(token))))));
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
    const match = line.match(FIELD_LINE_RE);
    if (match && match[1]?.trim()) {
      const key = match[1].trim().toLowerCase().replace(/\s+/g, ' ');
      const value = (match[3] ?? '').replace(/^\s*:\s*/, '').trim();
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
    [/\bunable\s+to\s+test\b/i, 'unable to test'],
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

export function buildConditionPresentation(assessment: ConditionAssessment): ConditionPresentation {
  const stated = assessment.condition.trim();
  const lower = stated.toLowerCase();
  const functionalText = fieldValue(assessment.fields, 'is item functional', 'item functional', 'functional', 'working') || '';
  const missingParts = yesNo(fieldValue(assessment.fields, 'missing major parts', 'missing parts', 'missing any parts')) === true;
  let label = 'Condition ?';
  let tone: ConditionPresentation['tone'] = 'unknown';
  if (assessment.partsOnly) {
    label = 'Parts only';
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
  } else if (!assessment.partsOnly && !assessment.damaged && (
    /\b(?:unable\s+to\s+test|untested|not\s*tested)\b/i.test(functionalText)
    || assessment.cautions.some((value) => /\b(?:unable\s+to\s+test|untested|not\s*tested)\b/i.test(value))
  )) {
    label = `${label} · untested`;
    if (tone === 'good' || tone === 'unknown') tone = 'warning';
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
  if (/\b(?:vital\s+signs?|patient)\s+monitors?\b/i.test(source)) return null;
  if (/\bfood\s+processors?\b/i.test(source)) return null;
  // "All-in-one" describes both desktop computers and printers. The explicit
  // printer noun wins so an inkjet cannot be classified as a desktop PC.
  if (/\b(?:printers?|scanners?)\b/i.test(source)) return 'printer';
  if (/^\s*(?:nintendo\s+)?switch(?:\s+oled)?\b/i.test(source)
    && !/\b(?:case|cover|game|replacement|screen\s+protector)\b/i.test(source)) return 'game-console';
  // A complete desktop routinely advertises RAM, storage, and a CPU in the
  // same title. Those component words must not turn the whole PC into a memory
  // module or processor before the desktop rule gets a chance to run.
  if (/\b(?:desktop\s+(?:computers?|pcs?|systems?)|mini\s+(?:desktop\s+)?pcs?|micro\s+(?:desktop\s+)?pcs?|small\s+form\s+factor\s+(?:computers?|pcs?)|all[\s-]in[\s-]ones?|computer\s+towers?|gaming\s+pcs?)\b/i.test(source)) {
    return 'desktop';
  }
  return PRODUCT_KIND_PATTERNS.find(([, pattern]) => pattern.test(source))?.[0] ?? null;
}

function descriptionIdentityCandidate(parsed: StructuredDescription): string {
  const statedProduct = fieldValue(parsed.fields, 'product name', 'product', 'title', 'lead') || '';
  const statedBrand = fieldValue(parsed.fields, 'brand', 'manufacturer', 'make') || '';
  const statedModel = fieldValue(parsed.fields, 'model', 'model #', 'model number', 'mpn') || '';
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

function knownLeadingBrand(value: string): string | null {
  return value.match(/^(?:Allen[\s-]Bradley|Amazon\s+Basics|B\.?\s*Braun|Bang\s*(?:&|and)\s*Olufsen|Black\s*(?:\+|&|and)\s*Decker|Bowers\s*(?:&|and)\s*Wilkins|Hamilton\s+Beach|Hewlett[\s-]Packard|Robot\s+Coupe|Smith\s*\+\s*Nephew|Square\s+D|Western\s+Digital)\b/i)?.[0] || null;
}

function compactIdentityText(value: string): string {
  return compactTokens(value).join('');
}

function isIsbnLikeToken(value: string): boolean {
  const digits = value.replace(/[^0-9Xx]/g, '');
  return digits.length === 10 || (digits.length === 13 && /^97[89]/.test(digits));
}

function isMeasurementLikeModelToken(value: string): boolean {
  return /^\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?[\s-]*(?:v|w|kw|a|amp|amps|ah|mah|hz|mhz|ghz|mm|cm|in|ft|oz|lb|gb|tb|mb|mp|dpi|ppi|rpm|pa|psi|btu|lm|lumen|lumens|core|cores|ct|pk|pack|piece|pieces|volume|volumes)$/i.test(value)
    || /^\d+(?:\.\d+)?x\d+(?:\.\d+)?$/i.test(value)
    || /^\d+x\d+(?:\.\d+)?(?:fl?oz|oz|ml|l|qt|gb|tb|mb)$/i.test(value)
    || /^\d+[\s-]*in[\s-]*\d+$/i.test(value)
    || /^ddr[345](?:l|x)?-?\d{3,5}$/i.test(value)
    || /^\d+(?:st|nd|rd|th)$/i.test(value)
    || /^(?:19|20)\d{2}$/.test(value)
    || /^(?:19|20)\d{2}-\d{1,2}-\d{1,2}$/.test(value);
}

function inferredModelTokenScore(value: string): number {
  const token = value.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9+.-]+$/g, '');
  if (!token || token.length > 24 || isIsbnLikeToken(token) || isMeasurementLikeModelToken(token) || GENERIC_MODEL_RE.test(token)) return -1;
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

function rankedInferredModelTokens(values: string[]): string[] {
  const unique = [...new Map(values
    .map((value, index) => ({ value, index, score: inferredModelTokenScore(value) }))
    .filter((entry) => entry.score >= 0)
    .map((entry) => [entry.value.toLowerCase(), entry] as const)).values()];
  return unique
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.value);
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
const BUNDLE_COMPONENT_NOUN_RE = /\b(?:accessor(?:y|ies)|adapter|bag|batter(?:y|ies)|blade|bowl|cable|case|charger|controller|cord|cover|dock|earbuds?|filter|foot\s*switch|game|headphones?|headset|hose|jar|keyboard|lens(?:es)?|manual|microphones?|mount|mouse|nozzle|pedal|plate|power\s+supply|probe|rack|remote|sensor|speaker|stand|subwoofer|transmitter|tripod)\b/i;

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
  const source = normalise(value);
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
    ...[...source.matchAll(/(?:#|\b(?:no\.?|number)\s+)\s*([A-Z0-9][A-Z0-9-]{0,9})\b/gi)].map((match) => `catalog:${String(match[1]).toLowerCase()}`),
    ...[...source.matchAll(/\b(\d{1,4}\/\d{1,4})\b/g)].map((match) => `fraction:${match[1]}`),
  ];
  const mintMarks = [...source.matchAll(/\b((?:1[5-9]\d{2}|20\d{2}))[\s-]+([A-Z])\b/gi)]
    .map((match) => `${match[1]}-${String(match[2]).toLowerCase()}`);
  const connector = source.match(/\b(?:bundled\s+with|with|includes?|including|plus)\s+(.+)$/i);
  const bundleComponents = connector
    ? stripResearchSuffixes(connector[1] || '')
      .split(/\s*(?:,|;|\b(?:and|plus)\b)\s*/i)
      .filter((component) => BUNDLE_COMPONENT_NOUN_RE.test(component))
      .map((component) => compactTokens(component)
        .map((token) => token.toLowerCase())
        .filter((token) => token.length > 1 && !BUNDLE_TOKEN_NOISE.has(token) && !isMeasurementLikeModelToken(token)))
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
  const actual = extractStrictIdentitySignatures(candidateTitle);
  const reasons: string[] = [];
  const primaryModel = String(product.model || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const requiredCodes = expected.modelCodes.filter((code) => {
    const compact = code.toLowerCase().replace(/[^a-z0-9]/g, '');
    return !primaryModel || primaryModel === compact || !primaryModel.startsWith(compact);
  });
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

  const candidateTokens = new Set(compactTokens(candidateTitle).map((token) => token.toLowerCase()));
  for (const component of expected.bundleComponents) {
    const hits = component.filter((token) => candidateTokens.has(token)).length;
    const requiredHits = Math.max(1, Math.ceil(component.length * 0.5));
    if (hits < requiredHits) reasons.push(`bundle-component-missing:${component.join('-')}`);
  }
  return uniqueStrings(reasons);
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
  const statedModel = (fieldValue(parsed.fields, 'model', 'model #', 'model number', 'mpn') ?? '').trim();
  const prose = parsed.freeText.split(/\n\s*\*{2,}/)[0]?.replace(/\n+/g, ' ').trim() ?? '';
  const recovery = descriptionIdentityCandidate(parsed) || prose;
  const leadStem = lead.replace(/(?:\.{3}|…)\s*$/, '').trim();
  const recoveryQuery = buildProductResearchQuery(recovery);
  const leadTokens = buildProductResearchQuery(leadStem).split(/\s+/).filter(Boolean);
  const recoveryTokens = recoveryQuery.split(/\s+/).filter(Boolean);
  const leadIsTruncated = /(?:\.{3}|…)\s*$/.test(lead);
  const recoveryExtendsTruncatedLead = leadIsTruncated
    && leadTokens.length > 0
    && leadTokens.every((token, index) => recoveryTokens[index] === token);
  // A concrete visible title remains authoritative. Placeholder, generic, or
  // explicitly truncated headings may recover identity from the first safe
  // product line or structured brand/model fields in the description.
  const source = (!lead || (isWeakResearchTitle(lead) && !leadIsTruncated) || recoveryExtendsTruncatedLead) && recoveryQuery
    ? recovery
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
  let name = stripResearchPrefixes(stripInventoryPrefix(named.replace(/\s*-\s*$/, '').trim()));
  name = stripStructuredBatchPrefix(name, statedBrand, statedModel);
  if (name.length < 3) name = lead || normalise(sourceDescription).split('\n')[0]?.trim() || '';
  const rawTokens = tokeniseIdentity(name);
  const tokens = rawTokens.filter((token) => !NOISE_WORDS.has(token.toLowerCase()) && !/^\$?[\d.,]+$/.test(token));
  const compoundBrand = knownLeadingBrand(name);
  const firstTitleToken = tokens[0] || '';
  const firstTokenIsMaterial = MATERIAL_WORDS.some(([, pattern]) => pattern.test(firstTitleToken));
  const titleBrand = compoundBrand || (firstTokenIsMaterial ? '' : tokens.find((token) => !GENERIC_BRAND_RE.test(token)
    && !/^(?:case|group|lot|pair|set)$/i.test(token)
    && !/^\d/.test(token)) || '');
  const statedBrandAppearsInTitle = statedBrand && new RegExp(`\\b${escapeRegExp(statedBrand)}\\b`, 'i').test(name);
  const measurementLedName = /^\s*\d+(?:\.\d+)?\s*(?:[x×]\s*\d|(?:in(?:ch(?:es)?)?|ft|feet|foot|mm|cm)\b)/i.test(name);
  const brand = statedBrand && (!titleBrand || titleBrand.length < 2 || GENERIC_BRAND_RE.test(titleBrand) || statedBrandAppearsInTitle || measurementLedName)
    ? statedBrand
    : titleBrand;
  const explicitTitleModel = name.match(/\b(?:model|mpn)\s*(?:no\.?|number|#)?\s*[:#-]?\s*([A-Za-z0-9][A-Za-z0-9+.-]{1,23})\b/i)?.[1] || '';
  const hashNumericModel = name.match(/(?:^|[^A-Za-z0-9])#\s*(\d{3,8})\b/i)?.[1] || '';
  const parenthesizedNumber = name.match(/\(\s*(?:model\s*)?#\s*(\d{3,8})\s*\)/i)?.[1] || '';
  const modelAfterProductWord = name.match(/\bmodel\s+[A-Za-z][A-Za-z-]{2,20}\s+(\d{3,8})\b/i)?.[1] || '';
  const familyNumericSuffix = name.match(/\b([A-Za-z][A-Za-z0-9-]{2,15})\s+(\d{1,4})\s+([A-Z]{2,6})\b/) || [];
  const familyNumericModel = familyNumericSuffix[1]
    && !/^(?:19|20)\d{2}$/.test(familyNumericSuffix[2] || '')
    && !/^(?:PCS?|PACK|COUNT|CT|GB|TB|MB|KB|IN|INCH|OZ|LB|W|V|LED|LCD|USB|HDMI|ISBN|OEM)$/i.test(familyNumericSuffix[3] || '')
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
  const inferredModelTokens = rankedInferredModelTokens(rawTokens);
  const titleModelBase = inferredModelTokens[0] ?? numericBrandModel;
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
  const model = (looksLikeModel(statedModel) && modelMatches(name, statedModel) ? statedModel : null) || explicitModel || titleModel || (looksLikeModel(statedModel) ? statedModel : null);
  const model2 = inferredModelTokens.find((token) => token.toLowerCase() !== String(model ?? '').toLowerCase()
    && !modelMatches(model || '', token)
    && token.toLowerCase() !== brand.toLowerCase()) ?? null;
  const capacities = [...new Set(tokens.filter((token) => CAPACITY_RE.test(token)))];
  const discriminators = extractProductDiscriminators(name);
  const researchName = [
    brand && !compactIdentityText(name).includes(compactIdentityText(brand)) ? brand : '',
    name,
    model && !modelMatches(name, model) ? model : '',
  ].filter(Boolean).join(' ');
  let query = buildProductResearchQuery(researchName);
  if (discriminators.gpuModels.includes('nvidia:rtx:4070:ti-super') && !/\brtx\s*4070\s*ti\s+super\b/i.test(query)) {
    query = query.replace(/\brtx\s*4070\s*ti\b/i, (value) => `${value} super`);
  }
  if (model || discriminators.gpuModels.length || discriminators.cpuModels.length) {
    discriminators.seriesSignatures = discriminators.seriesSignatures
      .filter((value) => /^(?:generation|workstation):/.test(value));
  }
  const identity: ProductIdentity = { name, query: query.trim(), brand, model: model || null, model2, kind: detectProductKind(name), capacities, discriminators, tokens: tokens.slice(0, 12) };
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
  return assessCondition([record.title, record.lead, record.description, conditionField].filter(Boolean).join('\n'));
}

export function detectMixedLot(title: string | null | undefined, description = ''): MixedLotResult {
  const titleText = normalise(title);
  const descriptionText = normalise(description);
  const reasons: string[] = [];
  const checks: Array<[string, RegExp, string]> = [
    ['title', /\b(?:group|assorted|ass['’]?t|various|collection|contents)\b|\bmixed\b(?!\s+(?:signal|reality)\b)/i, 'group or mixed-lot wording'],
    ['title', /\b(?:bundle|lot)\s+of\s+(?:different|assorted|mixed|various)\b/i, 'mixed bundle wording'],
    ['title', /\bwith\s+(?:components?|contents?|assorted\s+items?|mixed\s+items?|equipment)\b/i, 'explicit component or contents wording'],
    ['title', /\b(?:amp|amplifier|receiver)\b\s*,\s*[^,;]{0,60}\b(?:tuner|turntable|cd\s+player|cassette\s+player)\b/i, 'separate audio components'],
    ['description', /\b(?:assorted|mixed|various)\s+(?:items?|components?|equipment|contents)\b/i, 'description identifies assorted components'],
    ['description', /\blot\s+of\s*\(?\s*(?:[2-9]|\d{2,})\s*\)?\s+consisting\s+of\b/i, 'description identifies multiple lot components'],
  ];
  for (const [source, pattern, reason] of checks) if (pattern.test(source === 'title' ? titleText : descriptionText)) reasons.push(reason);
  const titleBrandFamilies = [...new Set(BRAND_FAMILIES
    .filter(([, pattern]) => pattern.test(titleText))
    .map(([family]) => family))];
  if (titleBrandFamilies.length > 1 && /(?:&|\band\b|\bwith\b|\bplus\b)/i.test(titleText)) {
    reasons.push('multiple branded products');
  }
  const isBookShelving = /\b(?:book\s*shel(?:f|ves)|bookshel(?:f|ves))\b/i.test(titleText);
  if (!isBookShelving && (/^(?:books?)$/i.test(titleText.trim())
    || /\bbooks\s*$/i.test(titleText)
    || /^books\s+(?:in\s+reference\s+to|and\s+shelving)\b/i.test(titleText))) {
    reasons.push('multiple books require title-by-title review');
  }
  const parsed = parseStructuredDescription(description);
  const componentSource = [titleText, parsed.freeText].filter(Boolean).join('\n');
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
  if (product.model) return true;
  return retailIdentityTokens(product).length >= 3
    || (Boolean(product.kind) && productIdentityEvidenceCount(product) > 0);
}

function primaryKindIndex(title: string, kind: ProductKind | null): number {
  if (!kind) return -1;
  const pattern = PRODUCT_KIND_PATTERNS.find(([candidate]) => candidate === kind)?.[1];
  return pattern?.exec(title)?.index ?? -1;
}

function sourceIsAccessoryProduct(product: ProductIdentity): boolean {
  if (/\bstand\s+mixers?\b/i.test(product.name)) return false;
  const noun = ACCESSORY_NOUN_RE.exec(product.name) ?? /\b(batter(?:y|ies))\b/i.exec(product.name);
  if (!noun) return false;
  const afterNoun = product.name.slice(noun.index + noun[0].length);
  if (/^batter(?:y|ies)$/i.test(noun[0]) && /^\s*[- ]?(?:powered|operated)\b/i.test(afterNoun)) return false;
  const before = product.name.slice(0, noun.index);
  const connector = /(?:(?:\bwith|\bincludes?|\bincluding|\bbundled\s+with|\bplus)\b|\bw\s*\/)[^,;]{0,40}$/i;
  if (connector.test(before)) return false;
  const kindIndex = primaryKindIndex(product.name, product.kind);
  const primaryProductConnector = /(?:(?:\band|\bwith|\bincludes?|\bincluding|\bbundled\s+with|\bplus)\b|\bw\s*\/)[^,;]{0,40}$/i;
  if (kindIndex >= 0 && kindIndex < noun.index && primaryProductConnector.test(before.slice(kindIndex))) return false;
  return true;
}

export function isAccessoryListing(title: string | null | undefined, product: ProductIdentity): boolean {
  const candidateTitle = String(title ?? '');
  const documentation = /\b(?:(?:service|repair|owners?|owner'?s|user|instruction|installation|workshop)\s+manual|manual\s+(?:pdf|digital|download|disc|cd)|service\s+(?:literature|documentation)|wiring\s+diagram|schematic)\b/i;
  if (documentation.test(candidateTitle) && !documentation.test(product.name)) return true;
  const packagingOnly = /\b(?:(?:empty|original)\s+(?:retail\s+)?box(?:\s+only)?|box\s+only|box\s+(?:and|with)\s+(?:cooler|heatsink|fan|manual|accessories)|(?:retail\s+)?packaging\s+only|(?:empty|original)\s+carton(?:\s+only)?|carton\s+only|(?:cooler|heatsink)\s+only)\b/i;
  if (packagingOnly.test(candidateTitle) && !packagingOnly.test(product.name)) return true;
  if (product.kind === 'game-console' && detectProductKind(candidateTitle) !== 'game-console') return true;
  if (/\breplacement\s+parts?\s+only\b|\bnot\s+a\s+complete\b/i.test(candidateTitle)) return true;
  const noun = ACCESSORY_NOUN_RE.exec(candidateTitle) ?? /\b(batter(?:y|ies))\b/i.exec(candidateTitle);
  if (!noun || sourceIsAccessoryProduct(product)) return false;
  const beforeNoun = candidateTitle.slice(Math.max(0, noun.index - 24), noun.index);
  const candidateKind = detectProductKind(candidateTitle);
  const kindIndex = primaryKindIndex(candidateTitle, product.kind);
  const exactModel = Boolean(product.model && modelMatches(candidateTitle, product.model));
  const marker = /\b(?:for|compatible\s+with|replacement\s+for|designed\s+for|made\s+for|fits)\b/i.exec(candidateTitle);
  const primaryBundle = candidateKind === product.kind
    && kindIndex >= 0
    && kindIndex < noun.index
    && (noun.index - kindIndex > 24
      || /\b(?:with|includes?|including|bundle(?:d)?\s+with)\b/i.test(candidateTitle.slice(kindIndex, noun.index)));
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
  const strictComponent = /^(?:batter(?:y|ies)|cables?|cords?|chargers?|adapters?|build\s*plate|magnetic\s*plate|pei\s+(?:sheet|plate)|flexi(?:ble)?\s+steel|lamps?|bulbs?|footswitch(?:es)?|foot\s+switch(?:es)?|pedals?|inks?|toners?|cartridges?|probes?|camera\s+heads?)/i.test(noun[0]);
  if (/\b(?:replacement|spare)\s+batter(?:y|ies)\b/i.test(candidateTitle)) return true;
  if (strictComponent
    && !primaryBundle
    && !platformAccessoryMention
    && !/(?:\bwith|\bw\s*\/|\bincludes?|\bincluding|\bbundle)\s*$/i.test(beforeNoun)) return true;
  if (primaryBundle) return false;
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

export function evaluateRetailCandidate(title: string | null | undefined, product: ProductIdentity): RetailCandidateEvaluation {
  const candidateTitle = String(title ?? '');
  const rejectionReasons: string[] = [];
  const matchedEvidence: string[] = [];
  if (!candidateTitle) return { accepted: false, score: 0, rejectionReasons: ['empty-title'], matchedEvidence };
  if (!hasSufficientRetailIdentity(product)) rejectionReasons.push('insufficient-source-identity');
  // A cable/stand/band is allowed to match the same product type. Accessory
  // rejection protects a primary product from its add-ons; it must not reject
  // an auction lot whose product is itself the accessory.
  if (!sourceIsAccessoryProduct(product) && isAccessoryListing(candidateTitle, product)) rejectionReasons.push('accessory-or-component');
  const sourceLensModels = [...new Set(product.name.match(/\b\d{2,3}\s*-\s*\d{2,3}(?:mm)?\b/gi) || [])];
  if (sourceLensModels.length === 1 && /\b(?:dual|two|2)[\s-]+lens\s+kit\b/i.test(candidateTitle)) {
    rejectionReasons.push('attribute-conflict:lensCount:1!=2');
  }
  const exactModel = product.model ? modelMatches(candidateTitle, product.model) : false;
  const discriminators = matchesProductDiscriminators(candidateTitle, product);
  if (discriminators.conflicts.length) rejectionReasons.push(...discriminators.conflicts.map((value) => `attribute-conflict:${value}`));
  rejectionReasons.push(...criticalMissingDiscriminators(discriminators.missing).map((value) => `attribute-missing:${value}`));
  rejectionReasons.push(...compareStrictIdentitySignatures(candidateTitle, product));
  const brand = brandEvidence(candidateTitle, product);
  const candidateKind = detectProductKind(candidateTitle);
  const sourceFamily = productBrandFamily(product);
  const candidateFamily = canonicalBrandFamily(candidateTitle);
  if (sourceFamily && candidateFamily !== sourceFamily) rejectionReasons.push(`brand-mismatch:${sourceFamily}`);
  if (!sourceFamily && brand.expected && !brand.matches) {
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
    && rejectionReasons.every((reason) => /^(?:attribute-(?:missing|conflict):|identity-code-missing:|identity-missing:|bundle-component-missing:|model-mismatch:|weak-title-overlap:)/.test(reason));
}

export function evaluateAmazonCandidateEvidence(candidate: AmazonCandidate, product: ProductIdentity): RetailCandidateEvaluation {
  const titleEvaluation = evaluateRetailCandidate(candidate.title, product);
  if (titleEvaluation.accepted || !candidate.matchText || candidate.matchText === candidate.title) return titleEvaluation;
  const hardReasons = titleEvaluation.rejectionReasons.filter((reason) => /^(?:insufficient-source-identity|accessory-or-component|attribute-conflict|attribute-missing|identity-code-missing|identity-conflict|identity-missing|bundle-component-missing|kind-mismatch|model-mismatch|brand-mismatch)/.test(reason));
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
  if (!sourceIsAccessoryProduct(product) && isAccessoryListing(candidateTitle, product)) return 0;
  // Preserve Flippah's hard identity conflicts around the donor score. These
  // prevent a different model, capacity, platform, or product kind from being
  // promoted merely because it shares broad search words.
  const guarded = evaluateRetailCandidate(candidateTitle, product);
  if (guarded.rejectionReasons.some((reason) => /^(?:insufficient-source-identity|accessory-or-component|attribute-conflict|attribute-missing|identity-code-missing|identity-conflict|identity-missing|bundle-component-missing|kind-mismatch|model-mismatch|brand-mismatch)/.test(reason))) return 0;
  let score = 0;
  if (product.model) {
    if (!modelMatches(candidateTitle, product.model)) return 0;
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
    .filter((candidate) => !candidate.sponsored && candidate.price != null && candidate.price > 0)
    .map((candidate) => {
      const evaluation = evaluateAmazonCandidateEvidence(candidate, product);
      return { candidate, score: evaluation.accepted ? Math.max(evaluation.score, scoreRetailCandidate(candidate.title, product)) : 0 };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score);
  if (scored.length) {
    const top = scored[0]?.score ?? 0;
    // Price breaks ties between equally specific listings. A cheaper candidate
    // that omits source attributes (for example, the required color) must not
    // outrank a complete exact-attribute result merely because it is plausible.
    const band = scored.filter((entry) => entry.score >= top - 0.25);
    // Match the donor's useful fallback without weakening identity checks:
    // prefer new offers inside the strongest relevance band, but retain a
    // clearly marked used/renewed offer when no equally specific new offer is
    // available.
    const newOffers = band.filter((entry) => !entry.candidate.used);
    const pool = newOffers.length ? newOffers : band;
    const match = [...pool].sort((left, right) => (left.candidate.price ?? Infinity) - (right.candidate.price ?? Infinity))[0];
    if (!match) return null;
    const candidateAddsModel = !product.model
      && extractStrictIdentitySignatures(match.candidate.matchText || match.candidate.title).modelCodes.length > 0;
    return { ...match, referenceKind: candidateAddsModel ? 'equivalent' : 'exact' };
  }

  // HP's trailing "e" printer variants are the subscription-enabled sibling
  // of the same numbered Envy/DeskJet/OfficeJet hardware. Amazon frequently
  // has no featured offer for the exact e ASIN while the base-number sibling
  // is in stock. Keep this fallback narrow and label it as equivalent.
  const compactModel = String(product.model || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const hpPrinterBase = productBrandFamily(product) === 'hewlett-packard'
    && /\b(?:envy|deskjet|officejet)\b/i.test(product.name)
    ? compactModel.match(/^(\d{3,6})e$/)?.[1] || ''
    : '';
  if (hpPrinterBase) {
    const equivalents = candidates.filter((candidate) => {
      if (candidate.sponsored || candidate.price == null || candidate.price <= 0) return false;
      if (canonicalBrandFamily(candidate.title) !== 'hewlett-packard') return false;
      if (detectProductKind(candidate.title) !== 'printer' || isAccessoryListing(candidate.title, product)) return false;
      if (!modelMatches(candidate.title, hpPrinterBase) || modelMatches(candidate.title, compactModel)) return false;
      return /\b(?:envy|deskjet|officejet)\b/i.test(candidate.title);
    });
    if (equivalents.length) {
      const newEquivalents = equivalents.filter((candidate) => !candidate.used);
      const candidate = [...(newEquivalents.length ? newEquivalents : equivalents)]
        .sort((left, right) => (left.price ?? Infinity) - (right.price ?? Infinity))[0];
      if (candidate) return { candidate, score: 3, referenceKind: 'equivalent' };
    }
  }

  // Board-partner names are not the GPU itself. When a lot identifies only a
  // standardized GPU and VRAM (for example ZOTAC RTX 4060 8GB), a different
  // board partner with the exact same base GPU is a useful new-retail reference.
  // Keep this fallback narrow: manufacturer part numbers, Ti/Super conflicts,
  // laptop GPUs, missing VRAM, and non-card products remain ineligible.
  const sourceGpu = product.discriminators.gpuModels;
  if (!buildAmazonFallbackQuery(product)) return null;
  const equivalents = candidates.filter((candidate) => {
    if (candidate.sponsored || candidate.price == null || candidate.price <= 0) return false;
    if (/\b(?:laptop|notebook|mobile)\b/i.test(candidate.title)) return false;
    if (detectProductKind(candidate.title) !== 'graphics-card' || isAccessoryListing(candidate.title, product)) return false;
    const candidateAttributes = extractProductDiscriminators(candidate.title);
    if (candidateAttributes.gpuModels.length !== 1 || candidateAttributes.gpuModels[0] !== sourceGpu[0]) return false;
    return product.discriminators.capacities.every((capacity) => candidateAttributes.capacities.includes(capacity));
  });
  if (!equivalents.length) return null;
  const newEquivalents = equivalents.filter((candidate) => !candidate.used);
  const candidate = [...(newEquivalents.length ? newEquivalents : equivalents)]
    .sort((left, right) => (left.price ?? Infinity) - (right.price ?? Infinity))[0];
  return candidate ? { candidate, score: 3, referenceKind: 'equivalent' } : null;
}

/** A second Amazon query for standardized GPUs whose board-partner search is sparse. */
export function buildAmazonFallbackQuery(product: ProductIdentity): string | null {
  const normalizedModel = String(product.model || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const standardizedModel = !normalizedModel
    || /^(?:rtx|gtx)\d{3,4}(?:tisuper|ti|super)?$|^rx\d{3,4}(?:xtx|xt)?$/.test(normalizedModel);
  const sourceGpu = product.discriminators.gpuModels;
  if (product.kind !== 'graphics-card' || sourceGpu.length !== 1 || !standardizedModel) return null;
  const [vendor, family, number, variant] = sourceGpu[0]!.split(':');
  if (!family || !number) return null;
  const prefix = vendor === 'amd' ? 'radeon' : 'geforce';
  const variantText = variant && variant !== 'base' ? ` ${variant.replace(/-/g, ' ')}` : '';
  const capacity = product.discriminators.capacities[0] ? ` ${product.discriminators.capacities[0]}` : '';
  return `${prefix} ${family} ${number}${variantText}${capacity} graphics card`.replace(/\s+/g, ' ').trim();
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

export function retailIndicatorBandDescription(indicator: Pick<RetailIndicator, 'cls'>): string {
  switch (indicator.cls) {
    case 'green': return 'Green means the all-in cost is below 50% of the reference value.';
    case 'yellow': return 'Yellow means the all-in cost is 50% to 64% of the reference value.';
    case 'orange': return 'Orange means the all-in cost is 65% to 74% of the reference value.';
    case 'red': return 'Red means the all-in cost is 75% or more of the reference value.';
    default: return 'No verified value is available for a price comparison.';
  }
}

export function buildRetailIndicatorTooltip(input: {
  providerName: string;
  indicator: RetailIndicator;
  allIn: number | null | undefined;
  marketPrice: number | null | undefined;
  evidenceSource: string;
}): string {
  const cleanedSource = input.evidenceSource.replace(/\s+/g, ' ').trim() || 'reference value';
  const source = cleanedSource.length > 140 ? `${cleanedSource.slice(0, 137)}...` : cleanedSource;
  if (input.indicator.ratio === null || input.allIn == null || input.marketPrice == null) {
    return `${input.providerName}: no saved or verified value. ${retailIndicatorBandDescription(input.indicator)}`;
  }
  return `${input.providerName}: ${formatUsd(input.marketPrice)} reference from ${source}. All-in ${formatUsd(input.allIn)} is ${Math.round(input.indicator.ratio * 100)}% of that value. ${retailIndicatorBandDescription(input.indicator)}`;
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
