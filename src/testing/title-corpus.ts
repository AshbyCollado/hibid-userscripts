import {
  buildProductResearchQuery,
  buildRetailLinks,
  detectMixedLot,
  extractLotQuantityFromTitle,
  extractProductIdentity,
  looksLikeModel,
  parseStructuredDescription,
} from '../intelligence/us-deal-intelligence.js';

export interface TitleCorpusRecord {
  provider: string;
  eventItemId: string;
  auctionId?: string;
  lotNumber?: string;
  title: string;
  description?: string;
  category?: string;
  quantity?: number | null;
  currency?: string;
  sourceUrl?: string;
  capturePage?: number;
}

export type TitleReliabilitySeverity = 'error' | 'warning';

export interface TitleReliabilityIssue {
  code: string;
  severity: TitleReliabilitySeverity;
  recordId: string;
  title: string;
  query: string;
  detail: string;
  mutation?: string;
}

export interface TitleReliabilityReport {
  schemaVersion: 1;
  generatedAt: string;
  seed: number;
  records: number;
  distinctRecords: number;
  queriesBuilt: number;
  emptyQueries: number;
  mutationChecks: number;
  errorCount: number;
  warningCount: number;
  issueCounts: Record<string, number>;
  issues: TitleReliabilityIssue[];
  elapsedMs: number;
}

export interface TitleCorpusRunOptions {
  seed?: number;
  mutationRounds?: number;
  maxIssues?: number;
  maxRecords?: number;
}

export interface TitleMutation {
  name: string;
  title: string;
  expectsSameQuery: boolean;
}

interface TitleMutator {
  name: string;
  apply: (title: string) => string;
  expectsSameQuery: (title: string) => boolean;
}

const ADMINISTRATIVE_TITLE_RE = /^(?:welcome\b|preview\s+only\b|tba\b|shipping\s+(?:info|information)\b|pickup\s+(?:info|information|dates?)\b|terms\s+(?:and|&)\s+conditions\b|auction\s+(?:info|information|notes?)\b|read\s+(?:before|description)\b|important\s+(?:info|information|notice)\b)/i;
const WEAK_TITLE_RE = /^(?:lot(?:\s*#?\s*:?\s*[\w.-]+)?|item(?:\s*#?\s*:?\s*[\w.-]+)?|see\s+(?:photos?|pictures?|description)|misc(?:ellaneous)?|various|assorted|unknown|n\/?a|tv)$/i;
const GENERIC_QUERY_TOKENS = new Set(['auction', 'description', 'info', 'information', 'item', 'lot', 'misc', 'only', 'pickup', 'sale', 'see', 'shipping', 's', 'terms', 'various']);
const CONDITION_SUFFIX_RE = /\b(?:tested\s+working|open\s+box|new\s+in\s+box|refurbished|used|for\s+parts|as\s+is|untested)\b/i;

function issue(
  record: TitleCorpusRecord,
  query: string,
  code: string,
  severity: TitleReliabilitySeverity,
  detail: string,
  mutation?: string,
): TitleReliabilityIssue {
  return {
    code,
    severity,
    recordId: `${record.provider}:${record.eventItemId}`,
    title: record.title,
    query,
    detail,
    ...(mutation ? { mutation } : {}),
  };
}

function tokenise(value: string): string[] {
  return value.toLowerCase().match(/[a-z0-9]+(?:[+.-][a-z0-9]+)*/g) || [];
}

function canonicalQuery(value: string): string {
  return value.replace(/\s+/g, ' ').trim().toLowerCase();
}

function likelyProductTitle(title: string): boolean {
  const clean = title.replace(/\s+/g, ' ').trim();
  return clean.length >= 3 && !ADMINISTRATIVE_TITLE_RE.test(clean) && !WEAK_TITLE_RE.test(clean);
}

function likelyModelTokens(title: string): string[] {
  const tokens = title.match(/\b[A-Za-z][A-Za-z0-9]*(?:[+./-][A-Za-z0-9]+)*\b/g) || [];
  const leadingBatchCode = title.match(/^\s*((?:([A-Za-z])\2\d{1,2}|[A-Za-z]{1,3}\d{1,2}(?=\s+\$\s*[\d,]+)))\s+/i)?.[1]?.toLowerCase() || '';
  return [...new Set(tokens.filter((token) => {
    if (leadingBatchCode && token.toLowerCase() === leadingBatchCode) return false;
    if (!/\d/.test(token)) return false;
    if (/^\d+(?:\.\d+)?(?:in|inch|oz|lb|ct|pcs?|pack|gb|tb|mb|kb|hz|mhz|ghz|w|v)$/i.test(token)) return false;
    if (/^(?:x|\d+x)\d+(?:oz|gb|tb|mb|kb)?$/i.test(token) && token === token.toLowerCase()) return false;
    return token.length >= 2 && token.length <= 32;
  }))];
}

function orphanEntityToken(query: string): string | null {
  return tokenise(query).find((token) => ['amp', 'apos', 'hellip', 'nbsp', 'quot', 'times'].includes(token)) || null;
}

function repeatedTokenBlock(query: string): string | null {
  const tokens = tokenise(query);
  for (let width = 2; width <= Math.floor(tokens.length / 2); width += 1) {
    const first = tokens.slice(0, width).join(' ');
    for (let start = width; start + width <= tokens.length; start += 1) {
      if (tokens.slice(start, start + width).join(' ') === first) return first;
    }
  }
  return null;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0 || 0x6d2b79f5;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function fullwidth(value: string): string {
  return [...value].map((character) => {
    const code = character.charCodeAt(0);
    return code >= 0x21 && code <= 0x7e ? String.fromCharCode(code + 0xfee0) : character;
  }).join('');
}

function titleMutators(): TitleMutator[] {
  const always = () => true;
  const enoughWords = (title: string) => title.split(/\s+/).length >= 3;
  const enoughBoundaryWords = (title: string) => buildProductResearchQuery(title).split(/\s+/).length >= 5;
  const unambiguousBareLabel = (title: string) => !/^\d/i.test(buildProductResearchQuery(title));
  return [
    { name: 'lot-prefix', apply: (title) => `Lot #A17 | ${title}`, expectsSameQuery: always },
    { name: 'lot-no-prefix', apply: (title) => `Lot No. A17 - ${title}`, expectsSameQuery: always },
    { name: 'bare-lot-label', apply: (title) => `Lot ${title}`, expectsSameQuery: unambiguousBareLabel },
    { name: 'item-prefix', apply: (title) => `Item #A17 - ${title}`, expectsSameQuery: always },
    { name: 'bare-item-label', apply: (title) => `Item ${title}`, expectsSameQuery: unambiguousBareLabel },
    { name: 'stock-prefix', apply: (title) => `Stock #A17 | ${title}`, expectsSameQuery: always },
    { name: 'inventory-prefix', apply: (title) => `SKU: A17 | ${title}`, expectsSameQuery: always },
    { name: 'bare-number-prefix', apply: (title) => `#A17 - ${title}`, expectsSameQuery: always },
    { name: 'online-auction-prefix', apply: (title) => `Online Auction Item #A17 - ${title}`, expectsSameQuery: always },
    { name: 'each-prefix', apply: (title) => `{each} ${title}`, expectsSameQuery: always },
    { name: 'lot-quantity-prefix', apply: (title) => `Lot of 4 - ${title}`, expectsSameQuery: always },
    { name: 'parenthesized-quantity-prefix', apply: (title) => `(4) x ${title}`, expectsSameQuery: always },
    { name: 'retail-prefix', apply: (title) => `Retail $999.99 | ${title}`, expectsSameQuery: always },
    { name: 'condition-prefix', apply: (title) => `Open Box - ${title}`, expectsSameQuery: always },
    { name: 'condition-suffix', apply: (title) => `${title} - Tested Working`, expectsSameQuery: always },
    { name: 'no-reserve-suffix', apply: (title) => `${title} - No Reserve`, expectsSameQuery: always },
    { name: 'pickup-suffix', apply: (title) => `${title} - Pickup Only`, expectsSameQuery: always },
    { name: 'see-photos-suffix', apply: (title) => `${title} - See Photos`, expectsSameQuery: always },
    { name: 'exact-duplicate', apply: (title) => `${title} ${title}`, expectsSameQuery: enoughWords },
    {
      name: 'duplicate-condition-tail',
      apply: (title) => {
        const query = buildProductResearchQuery(title) || title;
        return `${query} ${query} - Tested Working`;
      },
      expectsSameQuery: enoughWords,
    },
    {
      name: 'boundary-duplicate',
      apply: (title) => {
        const query = buildProductResearchQuery(title) || title;
        return `${query} ${query.split(/\s+/).slice(0, 2).join(' ')}`;
      },
      expectsSameQuery: enoughBoundaryWords,
    },
    {
      name: 'html-entities',
      apply: (title) => title.replace(/&/g, '&amp;').replace(/\+/g, '&#43;'),
      expectsSameQuery: always,
    },
    { name: 'numeric-html-spaces', apply: (title) => title.replace(/ /g, '&#x20;'), expectsSameQuery: always },
    { name: 'unicode-dash', apply: (title) => title.replace(/-/g, '\u2013'), expectsSameQuery: always },
    { name: 'nonbreaking-space', apply: (title) => title.replace(/ /g, '\u00a0'), expectsSameQuery: always },
    {
      name: 'zero-width',
      apply: (title) => title.replace(/([A-Za-z])(?=[A-Za-z0-9])/g, '$1\u200b'),
      expectsSameQuery: always,
    },
    { name: 'fullwidth', apply: fullwidth, expectsSameQuery: always },
    { name: 'quoted', apply: (title) => `“${title}”`, expectsSameQuery: always },
    { name: 'whitespace', apply: (title) => `  ${title.split(' ').join('   ')}  `, expectsSameQuery: always },
    { name: 'multiline-whitespace', apply: (title) => title.replace(/ /g, '\r\n\t'), expectsSameQuery: always },
  ];
}

export function buildTitleMutations(title: string): TitleMutation[] {
  const clean = title.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  return titleMutators().map((mutator) => ({
    name: mutator.name,
    title: mutator.apply(clean),
    expectsSameQuery: mutator.expectsSameQuery(clean),
  }));
}

function buildComposedTitleMutation(title: string, random: () => number, round: number): TitleMutation {
  const clean = title.replace(/\s+/g, ' ').trim();
  const mutators = titleMutators();
  const count = 2 + Math.floor(random() * 3);
  const chosen: TitleMutator[] = [];
  while (chosen.length < count) {
    const candidate = mutators[Math.floor(random() * mutators.length)]!;
    if (/duplicate/.test(candidate.name) && chosen.some((item) => /duplicate/.test(item.name))) continue;
    if (!chosen.some((item) => item.name === candidate.name)) chosen.push(candidate);
  }
  const rank = (name: string): number => {
    if (/duplicate/.test(name)) return 0;
    if (/suffix/.test(name)) return 1;
    if (/prefix/.test(name)) return 2;
    if (/^(?:zero-width|fullwidth|unicode-dash)$/.test(name)) return 3;
    if (/^(?:html-entities|numeric-html-spaces)$/.test(name)) return 4;
    if (name === 'quoted') return 6;
    return 5;
  };
  chosen.sort((left, right) => rank(left.name) - rank(right.name) || left.name.localeCompare(right.name));
  return {
    name: `composed-${round}:${chosen.map((item) => item.name).join('+')}`,
    title: chosen.reduce((current, mutator) => mutator.apply(current), clean),
    expectsSameQuery: chosen.every((mutator) => mutator.expectsSameQuery(clean)),
  };
}

export function parseTitleCorpusJsonl(value: string): TitleCorpusRecord[] {
  const records: TitleCorpusRecord[] = [];
  for (const [index, line] of value.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    const parsed = JSON.parse(line) as Partial<TitleCorpusRecord>;
    if (!parsed.provider || !parsed.eventItemId || !parsed.title) {
      throw new Error(`Invalid title corpus record at line ${index + 1}`);
    }
    records.push(parsed as TitleCorpusRecord);
  }
  return records;
}

export function evaluateTitleCorpusRecord(record: TitleCorpusRecord): TitleReliabilityIssue[] {
  const query = buildProductResearchQuery(record.title);
  const issues: TitleReliabilityIssue[] = [];
  const identity = extractProductIdentity({ title: record.title, description: record.description || '' });
  const structured = parseStructuredDescription(record.description || '');
  const links = buildRetailLinks(query);
  const administrative = ADMINISTRATIVE_TITLE_RE.test(record.title.trim());

  if (!query && likelyProductTitle(record.title)) {
    issues.push(issue(record, query, 'empty-product-query', 'error', 'A product-like title produced no research query.'));
  }
  if (query && administrative) {
    issues.push(issue(record, query, 'administrative-query', 'warning', 'An administrative auction row produced a retail query.'));
  }
  if (query.length > 120) {
    issues.push(issue(record, query, 'query-over-limit', 'error', `Query length is ${query.length}.`));
  }
  if (query !== query.replace(/\s+/g, ' ').trim() || query !== query.toLowerCase()) {
    issues.push(issue(record, query, 'query-not-canonical', 'error', 'Whitespace or casing is not canonical.'));
  }
  if (query && buildProductResearchQuery(query) !== query) {
    issues.push(issue(record, query, 'query-not-idempotent', 'error', `Second pass produced "${buildProductResearchQuery(query)}".`));
  }
  const entityToken = orphanEntityToken(query);
  if (entityToken) issues.push(issue(record, query, 'html-entity-token', 'error', `Entity residue "${entityToken}" entered the query.`));
  const repeated = repeatedTokenBlock(query);
  if (repeated) issues.push(issue(record, query, 'repeated-token-block', 'warning', `Repeated token block: "${repeated}".`));

  const queryTokens = new Set(tokenise(query).map((token) => token.replace(/[^a-z0-9]/g, '')));
  for (const model of likelyModelTokens(record.title)) {
    const compact = model.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (compact && !queryTokens.has(compact) && !query.toLowerCase().replace(/[^a-z0-9]/g, '').includes(compact)) {
      issues.push(issue(record, query, 'possible-model-loss', 'warning', `Likely model token "${model}" is absent from the query.`));
    }
  }

  if (query) {
    try {
      const amazon = new URL(links.amazon);
      const ebay = new URL(links.ebay);
      if (amazon.hostname !== 'www.amazon.com' || amazon.searchParams.get('k') !== query) {
        issues.push(issue(record, query, 'amazon-link-mismatch', 'error', 'Amazon URL does not preserve the canonical query.'));
      }
      if (ebay.hostname !== 'www.ebay.com' || ebay.searchParams.get('_nkw') !== query) {
        issues.push(issue(record, query, 'ebay-link-mismatch', 'error', 'eBay URL does not preserve the canonical query.'));
      }
      if (ebay.searchParams.get('LH_Sold') !== '1' || ebay.searchParams.get('LH_Complete') !== '1') {
        issues.push(issue(record, query, 'ebay-sold-filter-missing', 'error', 'eBay URL is not explicitly Sold and Completed.'));
      }
    } catch (error) {
      issues.push(issue(record, query, 'research-link-invalid', 'error', error instanceof Error ? error.message : String(error)));
    }
  } else if (links.amazon || links.ebay) {
    issues.push(issue(record, query, 'empty-query-link', 'warning', 'An empty identity still produced marketplace-wide search URLs.'));
  }

  if (WEAK_TITLE_RE.test(record.title.trim()) && identity.query && record.description && record.description.length > record.title.length + 12) {
    issues.push(issue(record, query, 'weak-title-not-recovered', 'warning', 'A weak visible title prevented description-based identity recovery.'));
  }
  const leadingCode = record.title.match(/^([A-Za-z]{1,3}\d{1,2})\s+/)?.[1] || '';
  const statedModel = structured.fields.model || structured.fields['model #'] || structured.fields['model number'] || structured.fields.mpn || '';
  const compact = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (leadingCode
    && looksLikeModel(statedModel)
    && compact(leadingCode) !== compact(statedModel)
    && compact(identity.model || '') === compact(leadingCode)) {
    issues.push(issue(record, identity.query, 'structured-model-shadowed', 'error', `Leading batch code "${leadingCode}" displaced structured model "${statedModel}".`));
  }
  const mixed = detectMixedLot(record.title, record.description || '');
  if (mixed.mixed && /\b(?:rack|cabinet|equipment)\b/i.test(record.title)
    && !/\b(?:assorted|contents|group|mixed|various|with\s+components|lot\s+of)\b/i.test(record.title)) {
    issues.push(issue(record, query, 'possible-mixed-false-positive', 'warning', 'A single rack, cabinet, or equipment product was classified as mixed.'));
  }

  const parsedQuantity = extractLotQuantityFromTitle(record.title);
  if (record.quantity && record.quantity > 1 && parsedQuantity && record.quantity !== parsedQuantity) {
    issues.push(issue(record, query, 'quantity-conflict', 'warning', `Record quantity ${record.quantity} conflicts with title quantity ${parsedQuantity}.`));
  }
  return issues;
}

export function runTitleCorpus(
  input: TitleCorpusRecord[],
  options: TitleCorpusRunOptions = {},
): TitleReliabilityReport {
  const started = Date.now();
  const seed = options.seed ?? 0x5eed1234;
  const random = seededRandom(seed);
  const unique = [...new Map(input.map((record) => [`${record.provider}:${record.eventItemId}`, record])).values()];
  const records = options.maxRecords ? unique.slice(0, options.maxRecords) : unique;
  const issues: TitleReliabilityIssue[] = [];
  let queriesBuilt = 0;
  let emptyQueries = 0;
  let mutationChecks = 0;
  let errorCount = 0;
  let warningCount = 0;
  const issueCounts: Record<string, number> = {};
  const maxIssues = options.maxIssues ?? 5_000;

  const append = (value: TitleReliabilityIssue): void => {
    if (value.severity === 'error') errorCount += 1;
    else warningCount += 1;
    issueCounts[value.code] = (issueCounts[value.code] || 0) + 1;
    if (issues.length < maxIssues) issues.push(value);
  };

  for (const record of records) {
    const baseQuery = buildProductResearchQuery(record.title);
    queriesBuilt += 1;
    if (!baseQuery) emptyQueries += 1;
    evaluateTitleCorpusRecord(record).forEach(append);
    const mutations = buildTitleMutations(record.title);
    const rounds = Math.max(0, options.mutationRounds ?? mutations.length);
    for (let round = 0; round < rounds && mutations.length; round += 1) {
      const mutation = round < mutations.length
        ? mutations[round]!
        : buildComposedTitleMutation(record.title, random, round);
      if (!mutation.expectsSameQuery) continue;
      mutationChecks += 1;
      const mutatedQuery = buildProductResearchQuery(mutation.title);
      if (mutatedQuery !== baseQuery) {
        append(issue(record, baseQuery, 'mutation-query-drift', 'error', `Mutation produced "${mutatedQuery}".`, mutation.name));
      }
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    seed,
    records: records.length,
    distinctRecords: unique.length,
    queriesBuilt,
    emptyQueries,
    mutationChecks,
    errorCount,
    warningCount,
    issueCounts,
    issues,
    elapsedMs: Date.now() - started,
  };
}

export function isLikelyAdministrativeTitle(value: string): boolean {
  return ADMINISTRATIVE_TITLE_RE.test(value.trim());
}

export function isConditionPhrase(value: string): boolean {
  return CONDITION_SUFFIX_RE.test(value);
}

export function isGenericResearchQuery(value: string): boolean {
  const tokens = tokenise(value);
  return !tokens.length || tokens.every((token) => GENERIC_QUERY_TOKENS.has(token));
}
