import {
  assessCondition,
  evaluateRetailCandidate,
  extractLotQuantityFromTitle,
  getLimitedTestingCautions,
  missingMajorComponentRejections,
  parseStructuredDescription,
  extractProductIdentity,
  type ProductIdentity,
  type RetailCandidateEvaluation,
  type ConditionAssessment,
} from './us-deal-intelligence.js';

export interface EbayActiveResultsInput {
  query: string;
  identity: ProductIdentity;
  observedAt: string;
  browseJson: unknown;
  sourceCondition?: Pick<ConditionAssessment, 'condition' | 'cautions'> | null;
  sourceDescription?: string | null;
  sourceQuantity?: number | null;
  destinationPostalCode?: string | null;
}

export interface EbayActiveMoney {
  amount: number;
  currency: 'USD';
}

export type EbayActiveMatchDecision = 'accepted' | 'rejected';

export interface EbayActiveRecord {
  itemId: string;
  legacyItemId: string;
  variantId: string | null;
  itemUrl: string;
  title: string;
  askingPrice: EbayActiveMoney | null;
  shippingPrice: EbayActiveMoney | null;
  deliveredTotal: EbayActiveMoney | null;
  condition: string | null;
  conditionId: string | null;
  buyingOptions: string[];
  matchDecision: EbayActiveMatchDecision;
  rejectionReasons: string[];
  evaluation: RetailCandidateEvaluation;
}

export interface EbayActiveAskingBenchmark {
  currency: 'USD';
  lowerQuartile: number;
  sampleCount: number;
  basis: 'delivered-total';
  provisional: true;
}

export interface EbayActiveResults {
  status: 'ok' | 'partial' | 'no-results' | 'parse-error';
  query: string;
  observedAt: string;
  coverage: {
    providerTotal: number | null;
    returnedCount: number;
    offset: number | null;
    hasNextPage: boolean;
    complete: boolean | null;
  };
  records: EbayActiveRecord[];
  accepted: EbayActiveRecord[];
  rejected: EbayActiveRecord[];
  duplicateItemIds: string[];
  skippedCount: number;
  sampleCount: number;
  benchmark: EbayActiveAskingBenchmark | null;
}

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonObject
    : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

function arrayOfStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(text).filter(Boolean);
}

function firstArray(root: JsonObject): unknown[] | null {
  const candidates = [
    root.itemSummaries,
    root.item_summary,
    object(root.searchResult)?.itemSummaries,
    object(root.searchResult)?.item_summary,
  ];
  const found = candidates.find(Array.isArray);
  return found === undefined ? null : found as unknown[];
}

function positiveAmount(value: unknown): number | null {
  const raw = decimalNumber(value);
  return raw !== null && raw >= 0.005 ? Number(raw.toFixed(2)) : null;
}

function decimalNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/,/g, '');
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonnegativeInteger(value: unknown): number | null {
  const parsed = decimalNumber(value);
  return parsed !== null && Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function money(value: unknown): EbayActiveMoney | null {
  const data = object(value);
  if (!data || text(data.currency).toUpperCase() !== 'USD') return null;
  const amount = positiveAmount(data.value);
  return amount === null ? null : { amount, currency: 'USD' };
}

function nonnegativeMoney(value: unknown): EbayActiveMoney | null {
  const data = object(value);
  if (!data || text(data.currency).toUpperCase() !== 'USD') return null;
  const raw = decimalNumber(data.value);
  return raw !== null && raw >= 0 ? { amount: Number(raw.toFixed(2)), currency: 'USD' } : null;
}

function shipping(item: JsonObject, destinationPostalCode?: string | null): { price: EbayActiveMoney | null; known: boolean; wrongCurrency: boolean } {
  const listedLocations = item.shipToLocations;
  let hasUsListedLocation = false;
  if (destinationPostalCode && Array.isArray(listedLocations) && listedLocations.length > 0) {
    const countries = listedLocations.map((value) => {
      const location = object(value);
      return text(location?.country || location?.countryCode || value).toUpperCase();
    }).filter(Boolean);
    if (countries.length > 0 && !countries.includes('US')) {
      return { price: null, known: false, wrongCurrency: false };
    }
    hasUsListedLocation = countries.includes('US');
  }
  const options = item.shippingOptions;
  if (!Array.isArray(options) || options.length === 0) return { price: null, known: false, wrongCurrency: false };
  const prices: EbayActiveMoney[] = [];
  let wrongCurrency = false;
  for (const value of options) {
    const option = object(value);
    if (!option) continue;
    const service = `${text(option.type)} ${text(option.shippingServiceCode)} ${text(option.shippingCostType)}`;
    if (/\bpick[\s_-]*up\b/i.test(service)) continue;
    const estimate = object(option.shipToLocationUsedForEstimate);
    const destination = text(estimate?.country).toUpperCase();
    if (destination && destination !== 'US') continue;
    const postalCode = text(estimate?.postalCode);
    if (destinationPostalCode && postalCode && postalCode !== destinationPostalCode.trim()) continue;
    if (destinationPostalCode && ((!destination && !hasUsListedLocation)
      || (postalCode && postalCode !== destinationPostalCode.trim()))) continue;
    if (text(option.shippingCostType).toUpperCase() === 'CALCULATED'
      && (!destinationPostalCode || destination !== 'US' || postalCode !== destinationPostalCode.trim())) continue;
    if (option.shippingCost === undefined) continue;
    const parsed = nonnegativeMoney(option.shippingCost);
    if (parsed) prices.push(parsed);
    else if (text(object(option.shippingCost)?.currency).toUpperCase() !== 'USD') wrongCurrency = true;
  }
  if (prices.length === 0) return { price: null, known: false, wrongCurrency };
  const price = prices.reduce((lowest, candidate) => candidate.amount < lowest.amount ? candidate : lowest);
  return { price, known: true, wrongCurrency: false };
}

function itemUrl(item: JsonObject, legacyId: string, variantId: string | null): { url: string; mismatch: boolean; variantVerified: boolean } {
  const candidate = text(item.itemWebUrl || item.itemUrl || item.url);
  if (!candidate) return { url: `https://www.ebay.com/itm/${legacyId}`, mismatch: false, variantVerified: variantId === null || variantId === '0' };
  try {
    const url = new URL(candidate);
    const pathId = url.pathname.match(/^\/itm\/(\d+)(?:\/)?$/i)?.[1];
    if (url.protocol === 'https:' && /(?:^|\.)ebay\.com$/i.test(url.hostname) && pathId === legacyId) {
      const urlVariant = url.searchParams.get('var');
      const variantVerified = variantId === null || variantId === '0'
        ? urlVariant === null || urlVariant === '0'
        : urlVariant === variantId;
      return {
        url: urlVariant
          ? `https://www.ebay.com/itm/${legacyId}?var=${encodeURIComponent(urlVariant)}`
          : `https://www.ebay.com/itm/${legacyId}`,
        mismatch: false,
        variantVerified,
      };
    }
  } catch {
    // Invalid URLs are treated as an identity mismatch below.
  }
  return { url: `https://www.ebay.com/itm/${legacyId}`, mismatch: true, variantVerified: false };
}

function canonicalItemId(value: unknown): { canonical: string; legacyId: string; variantId: string | null } | null {
  const raw = text(value);
  const match = raw.match(/^(?:v1\|)?(\d+)(?:\|(\d+))?$/);
  if (!match || (raw.startsWith('v1|') && !match[2]) || (!raw.startsWith('v1|') && match[2])) return null;
  return { canonical: raw, legacyId: match[1]!, variantId: match[2] ?? null };
}

function dedupeKey(itemId: string, legacyId: string, variantId: string | null): string {
  return variantId === null || variantId === '0' ? legacyId : itemId;
}

type ComparableCondition = 'new' | 'open-box' | 'refurbished' | 'used' | 'parts';

function normalizedCondition(value: unknown, conditionId?: unknown): ComparableCondition | null {
  const id = text(conditionId);
  const condition = text(value).toLocaleLowerCase('en-US');
  // Card grading status is not a wear grade, even when it shares an item condition ID.
  if (/\b(?:graded|ungraded)\b/.test(condition)) return null;
  if (assessCondition(condition).partsOnly) return 'parts';
  if (id === '1000') return 'new';
  if (id === '1500' || id === '1750') return 'open-box';
  if (/^2[0-5]\d\d$/.test(id)) return 'refurbished';
  if (id === '2750' || id === '2990' || /^3\d\d\d$/.test(id)
    || id === '4000' || id === '5000' || id === '6000') return 'used';
  if (id === '7000') return 'parts';
  if (/\b(?:for parts|parts only|not working|non[- ]working)\b/.test(condition)) return 'parts';
  if (/\b(?:refurbished|remanufactured)\b/.test(condition)) return 'refurbished';
  if (/\b(?:like new|used|pre-owned|preowned)\b/.test(condition)
    || /^(?:very good|good|acceptable)$/.test(condition)) return 'used';
  if (/\b(?:open[- ]box|new other|new without|packaging flawed|new with defects)\b/.test(condition)) return 'open-box';
  if (/\bnew\b/.test(condition)) return 'new';
  return null;
}

function repairRequiredEvidence(value: string): boolean {
  const normalized = value
    .replace(/<br\s*\/?>|<\/(?:p|div|li|tr|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/(^|\s+)((?:auction\s+terms|manufacturer\s+description|damage|(?:is\s+item\s+|item\s+)?(?:damaged|functional)|broken|working)\s*(?:\?\s*:|:|\?))/gi, '\n$2')
    .trim();
  if (!normalized) return false;
  const units: Array<[string, string]> = [];
  const excludedField = /^(?:auction(?:\s+(?:terms|policy|information|details|notice))?|manufacturer\s+description|(?:shipping|pickup|payment|buyer\s+premium)(?:\s+(?:terms|policy|information|details|notice))?)$/i;
  let excludedSection = false;
  // Parse each line separately so repeated notes and field boundaries survive.
  for (const line of normalized.split('\n')) {
    const parsed = parseStructuredDescription(line);
    const entries = Object.entries(parsed.fields);
    if (entries.length) {
      for (const [key, entry] of entries) {
        excludedSection = excludedField.test(key);
        if (!excludedSection) units.push([key, entry]);
      }
    } else if (!excludedSection && parsed.freeText) {
      units.push(['', parsed.freeText]);
    }
  }
  const damageFlag = /^(?:is item damaged|item damaged|damaged|broken)$/i;
  const functionalFlag = /^(?:is item functional|item functional|functional|working)$/i;
  const status = /^(yes|no|true|false|unknown|unavailable|unable\s+to\s+test|unspecified|untested|not\s+tested|not\s+available|not\s+applicable|n\s*\/\s*a|n\s*\.\s*a\.?)(?=$|\s|[,.;!?])/i;
  const partToken = String.raw`(?!(?:and|but|however|yet|was|were|is|are|has|have|had|been|will|would|shall|should|can|could|may|might|must|be|need|needs|require|requires|broken|damaged|defective|bent|repaired|fixed|straightened|partially|still|not)\b)[a-z][a-z0-9-]*`;
  const partSubject = `${partToken}(?:\\s+${partToken}){0,2}`;
  const fault = String.raw`(?:broken|damaged|defective|bent|cracked)`;
  const completedRepair = new RegExp(String.raw`\b(?:${partSubject}\s+(?:(?:was|were|is|are)\s+)?${fault}|${fault}\s+${partSubject})\s+(?:(?:but|and)\s+)?(?:(?:has|have|had)\s+been\s+|(?:is|are|was|were)\s+)?(?:(?:now|fully|completely|successfully)\s+)?(?:repaired|fixed|straightened)\b|\b(?:repaired|fixed|straightened)\s+${fault}\s+${partSubject}\b`, 'gi');
  const bentHardware = /\bbent\s+(?:pins?|contacts?|sockets?)\b|\b(?:pins?|contacts?|sockets?)\s+(?:(?:is|are|were|was|appear|appears|seem|seems|look|looks)\s+)?(?:(?:still|slightly|somewhat)\s+)*bent\b/gi;
  const repairPart = /\b(?:repairs?|fix|replacement\s+part|print\s*head|printhead|motor|screen|display)\b/i;
  const failure = /\b(?:broken|defective|damaged|cracked|non[-\s]?functional|not\s+working|does\s+not\s+(?:work|function|operate|power)|won't\s+(?:work|function|operate|power)|will\s+not\s+(?:work|function|operate|power)|for\s+repair)\b/gi;
  return units.some(([key, entry]) => {
    let evidence = entry.trim();
    if (damageFlag.test(key) || functionalFlag.test(key)) {
      const flag = status.exec(evidence);
      if (flag) {
        if ((damageFlag.test(key) && /^(?:yes|true)$/i.test(flag[1]!))
          || (functionalFlag.test(key) && /^(?:no|false)$/i.test(flag[1]!))) return true;
        evidence = evidence.slice(flag[0].length);
      }
    }
    // A completed repair resolves only its own damage statement, never another part.
    evidence = evidence.replace(completedRepair, (statement: string, offset: number) => {
      const before = evidence.slice(0, offset);
      const after = evidence.slice(offset + statement.length);
      return /\b(?:not|never|no|partially|partly|incompletely|unsuccessfully)\s*$/i.test(before)
        || /^\s+(?:(?:only\s+)?(?:partially|partly|incompletely|unsuccessfully)|in\s+part)\b/i.test(after)
        ? statement : ' ';
    });
    const cautions = assessCondition(evidence).cautions;
    if (cautions.includes('possible repair')) return true;
    if ([...evidence.matchAll(bentHardware)].some((match) =>
      !/\b(?:no|not|without|never)\s+(?:(?:any|more|visibly|obviously|noticeably|physically)\s+)*$/i.test(evidence.slice(0, match.index)))) return true;
    const clauses = evidence.split(/(?<=[.!?;])\s+|\s+\b(?:but|however|yet)\b/i);
    return clauses.some((clause) => {
      const segments = clause.split(/[,]|\s+\band\b/i);
      let needsCarry = false;
      return segments.some((segment) => {
        const subject = segment.replace(/\b(?:damaged|damage(?:d)?|defective)\s+(?:outer\s+|retail\s+)?(?:packaging|box|carton)\b|\b(?:packaging|box|carton)\s+(?:(?:is|was|arrived|appears)\s+)?(?:damaged|defective)\b/gi, ' ');
        const negated = /\b(?:does|do|did|is|are|was|were|would|will|can|could)\s+not\s+(?:need|require)\b[^,;.!?]*\b(?:repairs?|fix|replacement\s+part|print\s*head|printhead|motor|screen|display)\b|\b(?:doesn't|don't|didn't|isn't|aren't|wasn't|weren't|wouldn't|won't|can't|couldn't|no|not|never)\s+(?:need|require)?\s*(?:a\s+|an\s+|the\s+)?(?:repairs?|fix|replacement\s+part|print\s*head|printhead|motor|screen|display)\b|\b(?:repairs?|fix|replacement\s+part|print\s*head|printhead)\b\s+(?:(?:is|are)\s+)?(?:not|never)\s+(?:needed|required)\b/i.test(subject);
        const affirmativeNeed = /\b(?:needs?|requires?)\b/i.test(subject) && !negated;
        const actualFailure = [...subject.matchAll(failure)].some((match) =>
          !/\b(?:no(?:\s+longer)?|not|never|isn't|aren't|wasn't|weren't)\s+(?:(?:actually|physically)\s+)?$/i.test(subject.slice(0, match.index)));
        if (actualFailure) return true;
        if (negated) {
          needsCarry = false;
          return false;
        }
        if (repairPart.test(subject) && (affirmativeNeed || needsCarry
          || /\b(?:repairs?|fix|replacement\s+part)\s+(?:needed|required)\b/i.test(subject))) return true;
        needsCarry = affirmativeNeed;
        return false;
      });
    });
  });
}

function junkConditionEvidence(value: string, productContext: string): boolean {
  const electronicProduct = /\b(?:amplifier|audio|camera|camcorder|computer|console|digital|device|electronic|effects?|equipment|game(?:s|ing)?|guitar|keyboard|laptop|microphone|monitor|motherboard|multi[- ]effects?|phone|player|printer|processor|receiver|recorder|router|speaker|stereo|synth(?:esizer)?|tablet|television|tv|video)\b|(?:電子|電気|デジタル|オーディオ|アンプ|カメラ|機器|家電)/i;
  if (!electronicProduct.test(productContext)) return false;
  const normalized = value
    .replace(/<br\s*\/?>|<\/(?:p|div|li|tr|section)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r\n?/g, '\n')
    .trim();
  const junkLabel = /\b(?:junk\s+condition|junk\s*[/|-]\s*(?:for\s*)?parts?|(?:for\s*)?parts?\s*[/|-]\s*junk)\b|(?:ジャンク(?:品|扱い)?|現状品|部品取り)/gi;
  const excludedField = /^(?:auction(?:\s+(?:terms|policy|information|details|notice))?|manufacturer\s+description|(?:shipping|pickup|payment|buyer\s+premium)(?:\s+(?:terms|policy|information|details|notice))?)$/i;
  let excludedSection = false;
  for (const line of normalized.split('\n')) {
    const parsed = parseStructuredDescription(line);
    const entries = Object.entries(parsed.fields);
    const evidence: string[] = [];
    if (entries.length) {
      for (const [key, entry] of entries) {
        excludedSection = excludedField.test(key);
        if (!excludedSection) evidence.push(entry);
      }
    } else if (!excludedSection && parsed.freeText) {
      evidence.push(parsed.freeText);
    }
    for (const entry of evidence) {
      const clauses = entry.split(/[.!?;,]|\s+\b(?:but|however|yet)\b\s+/i);
      if (clauses.some((clause, index) => [...clause.matchAll(junkLabel)].some((match) => {
        const before = clause.slice(0, match.index);
        if (/\b(?:not|no(?:\s+longer)?|never|without|isn't|aren't)\s+(?:(?:in|a|the|any)\s+)*$/i.test(before)) return false;
        const historical = /\b(?:previously|formerly|was|had\s+been)\s+(?:in\s+)?$/i.test(before);
        const after = clause.slice(match.index! + match[0].length).trim();
        const following = clauses.slice(index + 1).map((value) => value.trim()).filter(Boolean);
        // Resolve only explicit history with a final, same-unit current repair claim.
        const resolved = historical && !after && following.length === 1
          && /^now\s+(?:(?:it|the\s+(?:item|unit))\s+is\s+)?fully\s+repaired\s+and\s+(?:fully\s+)?working$/i.test(following[0]!);
        return !resolved;
      }))) return true;
    }
  }
  return false;
}

function lowerQuartile(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * 0.25;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower]!;
  const fraction = position - lower;
  return Number((sorted[lower]! + (sorted[upper]! - sorted[lower]!) * fraction).toFixed(2));
}

function limitedTestingReasons(sourceDescription: string, candidate: JsonObject, identity: ProductIdentity): string[] {
  const source = assessCondition(sourceDescription);
  if (!source.cautions.some((caution) => getLimitedTestingCautions(caution).length > 0)) return [];
  const title = text(candidate.title);
  const condition = text(candidate.condition);
  const candidateText = [title, condition, candidate.shortDescription, candidate.description]
    .filter((value): value is string => typeof value === 'string').join('\n');
  const limited = getLimitedTestingCautions(candidateText).length > 0;
  const affirmative = (value: string, pattern: RegExp) => [...value.matchAll(pattern)].filter((match) => {
    const before = value.slice(0, match.index ?? 0);
    const after = value.slice((match.index ?? 0) + match[0].length);
    return !/\b(?:not|never|no|non|without|isn't|wasn't|like)[ \t-]*(?:(?:been|yet)[ \t]+)*$/i.test(before)
      && !/^[ \t]*(?:(?:condition|status)[ \t]*)?[?:]{0,2}[ \t]*(?:is[ \t]+)?(?:no|false|unknown|unconfirmed|unspecified)\b/i.test(after);
  });
  const strongWorking = affirmative(candidateText, /\b(?:fully\s+tested(?:\s+and\s+working)?|tested\s*(?:and\s*)?working|fully\s+(?:functional|working)|works?\s+perfectly)\b/gi).length > 0;
  const working = affirmative(candidateText, /\b(?:working|functional|works?)\b/gi).length > 0;
  const newPattern = /\b(?:(?:brand[\s-]+)?new(?:[\s-]+(?:(?:factory[\s-]+)?sealed|in\s+(?:box|packaging)))?|(?:factory[\s-]+)?sealed|nib)\b/gi;
  const isNew = normalizedCondition(candidate.condition, candidate.conditionId) === 'new'
    || affirmative(condition, newPattern).length > 0
    || [title, text(candidate.shortDescription), text(candidate.description)].some((value, index) => affirmative(value, newPattern).some((match) => {
      const before = value.slice(0, match.index ?? 0);
      const after = value.slice((match.index ?? 0) + match[0].length);
      if (index > 0 && (/\b(?:needs?|requires?|replacement|replace|with|installed)[ \t]+(?:(?:a|an|the|some)[ \t]+)?$/i.test(before)
        || /^[ \t]+(?:ink|toner|cartridges?|batter(?:y|ies)|printheads?|cables?|cords?|filters?|parts?)\b/i.test(after))) return false;
      if (index > 0 && /^new$/i.test(match[0])
        && !/\b(?:(?:item|unit|product)[ \t]+(?:is[ \t]+)?|condition[ \t]*:[ \t]*)$/i.test(before)) return false;
      if (!/^new$/i.test(match[0])) return true;
      const next = value.slice((match.index ?? 0) + match[0].length).match(/^[\s-]+(\w+)/)?.[1];
      return !next || !identity.name.toLowerCase().includes(`new ${next.toLowerCase()}`);
    }));
  if (isNew || strongWorking || (working && !limited)) {
    return ['condition-mismatch:working-comp-for-untested-lot'];
  }
  return limited ? [] : ['condition-ambiguous:comp-function-unconfirmed'];
}

export function activeAskingBenchmark(records: EbayActiveRecord[]): EbayActiveAskingBenchmark | null {
  const accepted = records.filter((record) => record.matchDecision === 'accepted');
  if (accepted.some((record) => record.deliveredTotal === null)) return null;
  const eligible = accepted
    .filter((record, index, rows) => rows.findIndex((candidate) => candidate.legacyItemId === record.legacyItemId) === index);
  return eligible.length >= 3
    ? { currency: 'USD', lowerQuartile: lowerQuartile(eligible.map((record) => record.deliveredTotal!.amount)), sampleCount: eligible.length, basis: 'delivered-total', provisional: true }
    : null;
}

function evaluationFor(title: string, identity: ProductIdentity): RetailCandidateEvaluation {
  return evaluateRetailCandidate(title, identity);
}

function componentSubject(title: string): string | null {
  const primary = title.split(/\b(?:with|including)\b|\bw\//i)[0]?.trim() || '';
  const match = primary.match(/\b(guards?|motors?|fences?|blades?|chutes?|plates?|inserts?|clamps?|switch(?:es)?|brush(?:es)?|flanges?|connectors?|handles?|pulleys|knobs?|bushings|dust\s*bags?|collection\s*attachments?)\b(?=\s*(?:[,#-]\s*)?(?:[A-Z]*\d[A-Z0-9-]{3,})?(?:\s+[A-Za-z]+){0,2}\s*$|\s+(?:for|fits|compatible\s+with)\b)/i);
  if (!match) return null;
  const noun = match[1]!.toLowerCase();
  return noun.endsWith('ches') || noun.endsWith('shes') ? noun.slice(0, -2)
    : noun.endsWith('s') ? noun.slice(0, -1) : noun;
}

function nonComparableReason(title: string, identity: ProductIdentity): string | null {
  const sourceNamesVehicleAndFigure = /\b(?:vehicle|motorcycle|motorbike|bike)\b/i.test(identity.name)
    && /\bfigure\b/i.test(identity.name);
  if (sourceNamesVehicleAndFigure) {
    const componentOnly = /\b(?:figure|vehicle|motorcycle|motorbike|bike|slamcycle)\s*(?:\(\s*)?only\b|\bonly\s+(?:figure|vehicle|motorcycle|motorbike|bike|slamcycle)\b/i.test(title);
    const componentMissing = /\b(?:no|without)\s+(?:the\s+)?(?:figure|vehicle|motorcycle|motorbike|bike)\b/i.test(title);
    if (componentOnly || componentMissing) return 'component-mismatch:vehicle-figure-set';
    if (!/\bfigure\b/i.test(title) || !/\b(?:vehicle|motorcycle|motorbike|bike)\b/i.test(title)) {
      return 'component-unverified:vehicle-figure-set';
    }
  }
  const sourceExplicitlyIncludesComponent = /\b(?:with|including|includes?)\b|\bw\//i.test(identity.name);
  if ((/\b(?:bundle|pair)\b/i.test(title)
    || (/\b(?:kit|package|lot|set)\b/i.test(title) && /\bwith\b|\b(?:includes?|including)\b/i.test(title)))
    && !(sourceExplicitlyIncludesComponent && sourceNamesVehicleAndFigure)) {
    return 'non-comparable-bundle';
  }
  const wholeProductWithNoRemote = /\bno\s+remote\b/i.test(title)
    && (identity.kind ? new RegExp(`\\b${identity.kind}\\b`, 'i').test(title) : false);
  if (!wholeProductWithNoRemote && /\b(?:remote|replacement\s+remote|remote\s+control|cover|faceplate|manual|cable|cord)\b/i.test(title)) {
    return 'non-comparable-accessory';
  }
  if (componentSubject(identity.name) !== componentSubject(title)) return 'non-comparable-accessory';
  return null;
}

function declaredBinderVariantReasons(description: string | null | undefined, candidateTitle: string, identity: ProductIdentity): string[] {
  const model = parseStructuredDescription(description).fields.model || '';
  if (!/\b9[\s-]*pocket\b/i.test(model) || !/\bzipper(?:ed)?\b/i.test(model)
    || !/\bbinder\b/i.test(model)) return [];
  const reasons: string[] = [];
  if (!/\bzipper(?:ed)?\b|\belite\s+series\b/i.test(candidateTitle)) {
    reasons.push('product-form-mismatch:zippered-binder');
  }
  const titleVariant = identity.name.match(/\b9[\s-]*pocket\s+([a-z][a-z0-9'-]*(?:\s+[a-z][a-z0-9'-]*){0,2})\s*$/i)?.[1];
  const modelVariant = model.match(/\belite\s+series\s+(.+?)\s+9[\s-]*pocket\b/i)?.[1]
    || model.match(/^(.+?)\s+elite\s+series\s+9[\s-]*pocket\b/i)?.[1];
  const titleNamedVariant = titleVariant?.replace(/\s+(?:zippered\s+)?(?:pro[- ]?)?binder$/i, '').trim();
  const variant = modelVariant || (titleNamedVariant && !/^(?:binder|portfolio|zippered|pokemon)$/i.test(titleNamedVariant)
    ? titleNamedVariant : null);
  if (variant) {
    const variantPattern = variant.trim().split(/\s+/).map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s-]+');
    if (!new RegExp(`\\b${variantPattern}\\b`, 'i').test(candidateTitle)) {
      reasons.push(`product-variant-mismatch:${variant.trim().toLowerCase().replace(/\s+/g, '-')}`);
    }
  }
  const sourceCapacities = [...new Set([...String(description || '').matchAll(/\b(\d{2,4})[\s-]+(?:standard[- ]size[\s-]+)?cards?\b/gi)].map((match) => match[1]!))];
  const candidateCapacities = [...new Set([...candidateTitle.matchAll(/\b(\d{2,4})[\s-]*(?:cards?|ct)\b/gi)].map((match) => match[1]!))];
  if (sourceCapacities.length === 1) {
    for (const candidateCapacity of candidateCapacities) {
      if (sourceCapacities[0] !== candidateCapacity) reasons.push(`product-capacity-mismatch:${sourceCapacities[0]}!=${candidateCapacity}`);
    }
  }
  return reasons;
}

const DECORATIVE_FAMILY_PATTERNS: Array<[string, RegExp]> = [
  ['vase', /\bvases?\b/i],
  ['planter', /\b(?:planters?|flower\s+pots?)\b/i],
  ['bowl', /\bbowls?\b/i],
  ['pitcher', /\bpitchers?\b/i],
  ['urn', /\burns?\b/i],
  ['decanter', /\bdecanters?\b/i],
  ['sculpture', /\bsculptures?\b/i],
  ['figurine', /\bfigurines?\b/i],
  ['platter', /\bplatters?\b/i],
  ['tureen', /\btureens?\b/i],
  ['teapot', /\btea\s+pots?\b|\bteapots?\b/i],
];

function primaryDecorativeFamily(title: string): string | null {
  const primary = title.split(/(?:\s+(?:with|including|includes?)\b|\s+w\/)/i, 1)[0] || title;
  return DECORATIVE_FAMILY_PATTERNS.find(([, pattern]) => pattern.test(primary))?.[0] || null;
}

function normalizedDecorativeEvidence(value: string): string {
  const normalized = value.toLocaleLowerCase('en-US')
    .replace(/[“”″]/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  if (/^\d+(?:\.\d+)?\s*(?:inches?|inch|in\.?|\")$/i.test(normalized)) {
    return normalized.replace(/\s+/g, '').replace(/(?:inches?|inch|in\.?|\")$/i, 'in');
  }
  return normalized;
}

function supportedDecorativeAnchor(value: string): string | null {
  const normalized = value.toLocaleLowerCase('en-US')
    .replace(/[.:;!?_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!normalized || /^(?:n\s*\/\s*a|na|none|unknown|unspecified|unavailable|not applicable|see\s*photos?|see\s*pictures?)$/.test(normalized)) {
    return null;
  }
  return normalizedDecorativeEvidence(value);
}

function decorativeEvidence(identity: ProductIdentity, description: string | null | undefined): {
  anchors: string[];
  constraints: string[];
  maker: string | null;
} {
  const parsed = parseStructuredDescription(description || '');
  const discriminators = identity.discriminators || {};
  const anchors = [
    identity.model,
    identity.model2,
    parsed.fields.model,
    parsed.fields.style,
  ].filter((value): value is string => Boolean(value)).map(supportedDecorativeAnchor)
    .filter((value): value is string => Boolean(value));
  const constraints = [
    ...(discriminators.materials || []),
    ...(discriminators.dimensions || []),
    ...(discriminators.volumes || []),
    ...(discriminators.colors || []),
    parsed.fields.material,
    parsed.fields.size,
    parsed.fields.color,
  ].filter((value): value is string => Boolean(value)).map(normalizedDecorativeEvidence);
  const structuredMaker = parsed.fields.brand || parsed.fields.manufacturer;
  const attributionMaker = identity.name.match(/\bby\s+(.+)$/i)?.[1]?.replace(/[.,;:!?]+$/, '').trim();
  return {
    anchors: [...new Set(anchors.filter(Boolean))],
    constraints: [...new Set(constraints.filter(Boolean))],
    maker: structuredMaker || attributionMaker || null,
  };
}

function candidateHasDecorativeEvidence(title: string, value: string): boolean {
  const candidate = extractProductIdentity(title);
  const normalized = normalizedDecorativeEvidence(value);
  const candidateValues = [
    ...candidate.discriminators.dimensions,
    ...candidate.discriminators.materials,
    ...candidate.discriminators.volumes,
    ...candidate.discriminators.colors,
    ...candidate.discriminators.variantLabels,
    ...candidate.discriminators.seriesSignatures,
  ].map(normalizedDecorativeEvidence);
  if (candidateValues.includes(normalized)) return true;
  const escaped = value.trim().split(/\s+/).map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, 'i').test(title);
}

function decorativeVariantReasons(
  title: string,
  identity: ProductIdentity,
  sourceQuantity: number | null,
  sourceDescription: string | null | undefined,
): string[] {
  const sourceFamily = primaryDecorativeFamily(identity.name);
  if (!sourceFamily) return [];
  const reasons: string[] = [];
  const candidateFamily = primaryDecorativeFamily(title);
  if (candidateFamily && candidateFamily !== sourceFamily) {
    reasons.push(`decorative-family-mismatch:${sourceFamily}!=${candidateFamily}`);
  } else if (!candidateFamily) {
    reasons.push(`decorative-family-unverified:${sourceFamily}`);
  }
  const candidateQuantity = extractLotQuantityFromTitle(title);
  const expectedQuantity = sourceQuantity || extractLotQuantityFromTitle(identity.name) || 1;
  if (candidateQuantity !== null && candidateQuantity !== expectedQuantity) reasons.push('quantity-mismatch');
  if (sourceQuantity && sourceQuantity > 1 && candidateQuantity === null) {
    reasons.push(`quantity-ambiguous:source-${sourceQuantity}:candidate-unspecified`);
  }
  const evidence = decorativeEvidence(identity, sourceDescription);
  const anchors = evidence.anchors;
  if (!anchors.length) {
    reasons.push('manual-identity-review:decorative-variant-unresolved');
    return reasons;
  }
  if (evidence.maker && !candidateHasDecorativeEvidence(title, evidence.maker)) {
    reasons.push(`decorative-maker-mismatch:${normalizedDecorativeEvidence(evidence.maker)}`);
  }
  const missingAnchors = anchors.filter((value) => !candidateHasDecorativeEvidence(title, value));
  if (missingAnchors.length) reasons.push(`decorative-variant-mismatch:${missingAnchors.slice(0, 3).join(',')}`);
  const missingConstraints = evidence.constraints.filter((value) => !candidateHasDecorativeEvidence(title, value));
  if (missingConstraints.length) reasons.push(`decorative-constraint-mismatch:${missingConstraints.slice(0, 3).join(',')}`);
  return reasons;
}

export function parseEbayActiveResults(input: EbayActiveResultsInput): EbayActiveResults {
  const root = object(input.browseJson);
  const observedAtMs = Date.parse(input.observedAt);
  const validObservationTime = Number.isFinite(observedAtMs) && observedAtMs <= Date.now();
  const duplicateItemIds: string[] = [];
  const seen = new Map<string, EbayActiveRecord>();
  const records: EbayActiveRecord[] = [];
  const sourceCondition = normalizedCondition(input.sourceCondition?.condition);
  const sourceEvidence = [input.identity.name, input.sourceDescription, input.sourceCondition?.condition, ...(input.sourceCondition?.cautions || [])]
    .filter((value): value is string => typeof value === 'string');
  const sourceText = sourceEvidence.join('\n');
  const sourceRepairRequired = sourceCondition === 'parts' || repairRequiredEvidence(input.sourceDescription || '')
    || sourceEvidence.some((evidence) => junkConditionEvidence(evidence, input.identity.name));
  const sourceQuantity = typeof input.sourceQuantity === 'number' && Number.isInteger(input.sourceQuantity) && input.sourceQuantity > 0
    ? input.sourceQuantity
    : null;

  const items = root ? firstArray(root) : null;
  const providerTotal = root ? nonnegativeInteger(root.total) : null;
  const offset = root ? nonnegativeInteger(root.offset) : null;
  const validNext = !root || root.next === undefined || typeof root.next === 'string';
  const hasNextPage = Boolean(root && text(root.next));
  const returnedCount = items?.length ?? 0;
  const inconsistentTotal = providerTotal !== null && providerTotal < returnedCount;
  const pageComplete = !validNext ? null : providerTotal === null
    ? hasNextPage ? false : null
    : offset === null
      ? hasNextPage ? false : null
      : providerTotal === returnedCount && !hasNextPage && offset === 0;
  let skippedCount = 0;
  for (const raw of items ?? []) {
    const item = object(raw);
    if (!item) { skippedCount += 1; continue; }
    const parsedItemId = canonicalItemId(item.itemId);
    const title = text(item.title);
    if (!parsedItemId || !title) { skippedCount += 1; continue; }
    const itemId = parsedItemId.canonical;
    const itemDedupeKey = dedupeKey(itemId, parsedItemId.legacyId, parsedItemId.variantId);
    const canonicalUrl = itemUrl(item, parsedItemId.legacyId, parsedItemId.variantId);
    const askingPrice = money(item.price);
    const shippingInfo = shipping(item, input.destinationPostalCode);
    const options = arrayOfStrings(item.buyingOptions);
    const evaluation = evaluationFor(title, input.identity);
    const reasons: string[] = [];
    const conditionId = text(item.conditionId);
    const candidatePartsOnly = conditionId === '7000'
      || assessCondition(text(item.condition)).partsOnly
      || (assessCondition(title).partsOnly && (repairRequiredEvidence(title) || /\b(?:for\s+parts|parts\s+only)\b/i.test(title)))
      || /\bas[- ]is\b/i.test(`${text(item.condition)} ${title}`);
    const candidateEvidence = [item.condition, title, item.shortDescription, item.description]
      .filter((value): value is string => typeof value === 'string');
    const candidateText = candidateEvidence.join('\n');
    const candidateRepairRequired = candidatePartsOnly || candidateEvidence
      .some((evidence) => junkConditionEvidence(evidence, title) || repairRequiredEvidence(evidence));
    if (seen.has(itemDedupeKey)) {
      if (!duplicateItemIds.includes(itemDedupeKey)) duplicateItemIds.push(itemDedupeKey);
      reasons.push('duplicate-item-id');
    }
    if (canonicalUrl.mismatch) reasons.push('item-url-id-mismatch');
    if (!canonicalUrl.variantVerified) reasons.push('variant-unverified');
    if (!askingPrice) reasons.push(object(item.price) && text(object(item.price)?.currency).toUpperCase() !== 'USD' ? 'non-usd-price' : 'invalid-or-missing-price');
    if (shippingInfo.wrongCurrency) reasons.push('non-usd-shipping');
    if (!options.some((option) => option.toUpperCase() === 'FIXED_PRICE')
      || options.some((option) => option.toUpperCase() === 'AUCTION')) reasons.push('auction-only-or-not-fixed-price');
    if (!evaluation.accepted) reasons.push(...evaluation.rejectionReasons);
    reasons.push(...missingMajorComponentRejections(sourceText, candidateText));
    reasons.push(...declaredBinderVariantReasons(input.sourceDescription, title, input.identity));
    const comparabilityReason = nonComparableReason(title, input.identity);
    if (comparabilityReason) reasons.push(comparabilityReason);
    reasons.push(...decorativeVariantReasons(title, input.identity, sourceQuantity, input.sourceDescription));
    const candidateCondition = candidatePartsOnly ? 'parts' : normalizedCondition(item.condition, item.conditionId);
    const endDateText = text(item.itemEndDate);
    const endDate = endDateText ? Date.parse(endDateText) : Number.NaN;
    const expired = Number.isFinite(endDate) && validObservationTime && endDate < observedAtMs;
    if (expired) reasons.push('expired-listing');
    if (/\b(?:graded|ungraded)\b/i.test(text(item.condition))) reasons.push('condition-grading-status-only');
    if (sourceCondition && candidateCondition && sourceCondition !== candidateCondition) reasons.push('condition-mismatch');
    if (sourceCondition && !candidateCondition) reasons.push('condition-unknown');
    const sourcePartsOnly = sourceCondition === 'parts';
    if (candidatePartsOnly && !sourcePartsOnly && !(sourceRepairRequired && candidateRepairRequired)) {
      reasons.push('condition-mismatch:parts-only-comp');
    }
    if (sourceRepairRequired && !candidateRepairRequired) reasons.push('operability-mismatch:source-repair-required');
    if (!sourceRepairRequired && candidateRepairRequired) reasons.push('operability-mismatch:candidate-repair-required');
    if (!sourceRepairRequired && !candidateRepairRequired) {
      reasons.push(...limitedTestingReasons(input.sourceDescription || '', item, input.identity));
    }
    const candidateQuantity = extractLotQuantityFromTitle(title);
    if (sourceQuantity && candidateQuantity !== null && candidateQuantity !== sourceQuantity) reasons.push('quantity-mismatch');
    if (sourceQuantity && sourceQuantity > 1 && candidateQuantity === null) reasons.push(`quantity-ambiguous:source-${sourceQuantity}:candidate-unspecified`);
    const record: EbayActiveRecord = {
      itemId,
      legacyItemId: parsedItemId.legacyId,
      variantId: parsedItemId.variantId,
      itemUrl: canonicalUrl.url,
      title,
      askingPrice,
      shippingPrice: shippingInfo.price,
      deliveredTotal: askingPrice && shippingInfo.known && shippingInfo.price
        ? { amount: Number((askingPrice.amount + shippingInfo.price.amount).toFixed(2)), currency: 'USD' }
        : askingPrice && shippingInfo.known ? askingPrice : null,
      condition: text(item.condition) || null,
      conditionId: conditionId || null,
      buyingOptions: options,
      matchDecision: reasons.length === 0 ? 'accepted' : 'rejected',
      rejectionReasons: [...new Set(reasons)],
      evaluation,
    };
    records.push(record);
    if (!seen.has(itemDedupeKey)) seen.set(itemDedupeKey, record);
  }

  for (const record of records) {
    if (duplicateItemIds.includes(dedupeKey(record.itemId, record.legacyItemId, record.variantId))) {
      record.matchDecision = 'rejected';
      if (!record.rejectionReasons.includes('duplicate-item-id')) record.rejectionReasons.push('duplicate-item-id');
    }
  }
  const complete = duplicateItemIds.length > 0 ? false : pageComplete;
  const accepted = records.filter((record) => record.matchDecision === 'accepted');
  const rejected = records.filter((record) => record.matchDecision === 'rejected');
  const benchmarkRows = accepted;
  const distinctBenchmarkRows = benchmarkRows
    .filter((record, index, rows) => rows.findIndex((candidate) => candidate.legacyItemId === record.legacyItemId) === index);
  const knownBenchmarkRows = distinctBenchmarkRows.filter((record) => record.deliveredTotal !== null);
  const benchmark = validObservationTime && skippedCount === 0 && !inconsistentTotal && complete === true
    ? activeAskingBenchmark(benchmarkRows)
    : null;
  return {
    status: items === null || inconsistentTotal || !validObservationTime ? 'parse-error'
      : complete !== true ? 'partial'
      : items.length === 0 ? 'no-results'
      : records.length === 0 ? 'parse-error'
      : skippedCount > 0 ? 'partial' : 'ok',
    query: text(input.query),
    observedAt: text(input.observedAt),
    coverage: { providerTotal, returnedCount, offset, hasNextPage, complete },
    records,
    accepted,
    rejected,
    duplicateItemIds,
    skippedCount,
    sampleCount: knownBenchmarkRows.length,
    benchmark,
  };
}

export const parseEbayBrowseActiveResults = parseEbayActiveResults;
