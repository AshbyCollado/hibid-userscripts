import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';
import { parseFragment, type DefaultTreeAdapterTypes } from 'parse5';

export const CORPUS_VERSION = 'public-lots-v1';
export const SANITIZER_VERSION = 'public-lot-text-v1';
export const DEFAULT_SELECTION_SEED = 'hibid-public-lots-v1-2026-08';
export const DEFAULT_SELECTION_COUNT = 3_000;
export const TITLE_MAX_CHARS = 300;
export const DESCRIPTION_MAX_CHARS = 500;
export const CATEGORY_MAX_CHARS = 200;

const DEFAULT_SOURCE_PATH = 'artifacts/title-corpus/hibid-public-raw.jsonl';
const DEFAULT_OUTPUT_PATH = 'tests/fixtures/title-corpus/public-lots-v1.jsonl.gz';
const DEFAULT_MANIFEST_PATH = 'tests/fixtures/title-corpus/public-lots-v1.manifest.json';
const PUBLIC_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const CONTROL_AND_BIDI_RE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/gu;
const REDACTED_VALUE_RE = /\[(?:redacted|removed)[-_ ]?(?:e-?mail|phone|url|contact|address)?\]/giu;
const URL_RE = /\b(?:(?:https?|ftp):\/\/|www\.)[^\s<>"']+|\b(?:mailto|tel):[^\s<>"']+/giu;
const DOMAIN_WITH_PATH_RE = /\b(?:[a-z0-9](?:[a-z0-9-]{0,62})\.)+[a-z]{2,63}\b[/?#][^\s<>"']*/giu;
const DOMAIN_RE = /\b(?:[a-z0-9-]+\.)+(?:com|net|org|edu|gov|io|co|us|biz|info|me|tv)\b/giu;
const TRACKING_PARAMETER_RE = /\b(?:utm_[a-z0-9_]+|gclid|dclid|fbclid|msclkid)=[^\s&]+/giu;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/giu;
const PHONE_RE = /(?<!\d)(?:\+?1[\s.-]*)?(?:\(\s*\d{3}\s*\)|\d{3})[\s.-]*\d{3}[\s.-]*\d{4}(?:\s*(?:x|ext\.?|extension)\s*\d{1,6})?(?!\d)/giu;
const SOCIAL_HANDLE_RE = /(^|\s)@[A-Za-z0-9_]{2,32}\b/gu;
const PO_BOX_RE = /\bP\.?\s*O\.?\s+Box\s+\d+[A-Za-z-]*\b/giu;
const STREET_ADDRESS_RE = /\b\d{1,6}\s+(?:[A-Za-z0-9.'-]+\s+){0,6}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Circle|Cir|Highway|Hwy|Parkway|Pkwy|Trail|Trl|Way|Place|Pl)\b(?:\s+(?:Apt|Apartment|Unit|Suite|Ste)\.?\s*[A-Za-z0-9-]+)?(?:,?\s+[A-Za-z.'-]+(?:\s+[A-Za-z.'-]+){0,3},?\s+[A-Z]{2}(?:\s+\d{5}(?:-\d{4})?)?)?/giu;
const CONTACT_VALUE_RE = /(?:\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b|(?<!\d)(?:\+?1[\s.-]*)?(?:\(\s*\d{3}\s*\)|\d{3})[\s.-]*\d{3}[\s.-]*\d{4}(?:\s*(?:x|ext\.?|extension)\s*\d{1,6})?(?!\d)|(?:^|\s)@[A-Za-z0-9_]{2,32}\b|\bP\.?\s*O\.?\s+Box\s+\d+[A-Za-z-]*\b|\b\d{1,6}\s+(?:[A-Za-z0-9.'-]+\s+){0,6}(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Circle|Cir|Highway|Hwy|Parkway|Pkwy|Trail|Trl|Way|Place|Pl)\b)/iu;
const REDACTED_CONTACT_RE = /\[(?:redacted|removed)[-_ ]?(?:e-?mail|phone|contact|address)\]/iu;
const SENSITIVE_SEGMENT_RE = /\b(?:authorization|bearer\s+token|session\s*(?:id|token)|password|passcode|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|private\s+notes?|customer\s+(?:id|e-?mail|phone|notes?)|account\s+(?:state|status|number|id|e-?mail|balance)|bidder\s+(?:id|number)|credit\s+card)\b/iu;
const CONTACT_INSTRUCTION_RE = /\b(?:contact\s+(?:us|me|the seller)|e-?mail\s+(?:us|me|the seller)|call\s+(?:us|me|the seller|ahead)|text\s+(?:us|me|the seller)|reach\s+(?:us|me)|for\s+inquir(?:y|ies)|questions?\??\s*(?:call|e-?mail|text)|pickup\s+address|mailing\s+address)\b/iu;
const BLOCK_TAGS = new Set([
  'address', 'article', 'aside', 'blockquote', 'br', 'dd', 'div', 'dl', 'dt', 'figcaption',
  'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main',
  'nav', 'ol', 'p', 'pre', 'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);
const OMITTED_TAGS = new Set(['iframe', 'noscript', 'script', 'style', 'svg', 'template']);

type RawRecord = Record<string, unknown>;
type Parse5Node = DefaultTreeAdapterTypes.Node;

export interface PublicLotCorpusRecord {
  provider: 'hibid';
  eventItemId: string;
  auctionId: string;
  title: string;
  description?: string;
  category?: string;
}

export interface PublicLotCorpusManifest {
  schemaVersion: 1;
  corpusVersion: typeof CORPUS_VERSION;
  format: 'jsonl+gzip';
  source: string;
  output: string;
  hashAlgorithm: 'sha256';
  sourceHash: string;
  contentHash: string;
  contentBytes: number;
  artifactHash: string;
  artifactBytes: number;
  selectionSeed: string;
  selectionAlgorithm: 'sha256-v1';
  sanitizerVersion: typeof SANITIZER_VERSION;
  limits: {
    titleChars: number;
    descriptionChars: number;
    categoryChars: number;
  };
  counts: {
    sourceRecords: number;
    eligibleRecords: number;
    rejectedRecords: number;
    duplicateRecords: number;
    distinctEligibleRecords: number;
    requestedRecords: number;
    selectedRecords: number;
    descriptionsIncluded: number;
    categoriesIncluded: number;
  };
}

export interface MaterializeOptions {
  selectionCount?: number;
  selectionSeed?: string;
  sourceLabel?: string;
  outputLabel?: string;
}

export interface MaterializedTitleCorpus {
  records: PublicLotCorpusRecord[];
  content: string;
  artifact: Buffer;
  manifest: PublicLotCorpusManifest;
}

export interface MaterializeFileOptions extends MaterializeOptions {
  sourcePath: string;
  outputPath: string;
  manifestPath: string;
}

function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function compareStableText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function appendBreak(parts: string[]): void {
  if (parts.at(-1) !== '\n') parts.push('\n');
}

function collectText(node: Parse5Node, parts: string[]): void {
  if (node.nodeName === '#text') {
    parts.push((node as DefaultTreeAdapterTypes.TextNode).value);
    return;
  }
  if (node.nodeName === '#comment' || node.nodeName === '#documentType') return;

  const tagName = 'tagName' in node ? node.tagName.toLowerCase() : '';
  if (OMITTED_TAGS.has(tagName)) return;
  if (BLOCK_TAGS.has(tagName)) appendBreak(parts);
  if ('childNodes' in node) {
    for (const child of node.childNodes) collectText(child, parts);
  }
  if (BLOCK_TAGS.has(tagName)) appendBreak(parts);
}

function htmlToText(value: string): string {
  const fragment = parseFragment(value);
  const parts: string[] = [];
  collectText(fragment, parts);
  return parts.join('');
}

function limitCharacters(value: string, maximum: number): string {
  const characters = Array.from(value);
  if (characters.length <= maximum) return value;
  const shortened = characters.slice(0, maximum + 1).join('');
  const boundary = shortened.slice(0, maximum).search(/\s+\S*$/u);
  const limited = boundary >= Math.floor(maximum * 0.7)
    ? shortened.slice(0, boundary)
    : characters.slice(0, maximum).join('');
  return limited.replace(/[\s,;:/-]+$/u, '').trim();
}

export function sanitizePublicText(value: unknown, maximum: number): string {
  if (typeof value !== 'string' || maximum < 1) return '';
  const plainText = htmlToText(value.normalize('NFKC').replace(CONTROL_AND_BIDI_RE, ''));
  const segments = plainText.split(/\n+|(?<=[.!?])\s+(?=[A-Z0-9[(])/u);
  const sanitized: string[] = [];

  for (const segment of segments) {
    const trimmed = segment.replace(/\s+/gu, ' ').trim();
    if (!trimmed
      || SENSITIVE_SEGMENT_RE.test(trimmed)
      || CONTACT_INSTRUCTION_RE.test(trimmed)
      || CONTACT_VALUE_RE.test(trimmed)
      || REDACTED_CONTACT_RE.test(trimmed)) continue;
    const clean = trimmed
      .replace(REDACTED_VALUE_RE, ' ')
      .replace(EMAIL_RE, ' ')
      .replace(URL_RE, ' ')
      .replace(DOMAIN_WITH_PATH_RE, ' ')
      .replace(DOMAIN_RE, ' ')
      .replace(TRACKING_PARAMETER_RE, ' ')
      .replace(PHONE_RE, ' ')
      .replace(SOCIAL_HANDLE_RE, '$1')
      .replace(PO_BOX_RE, ' ')
      .replace(STREET_ADDRESS_RE, ' ')
      .replace(/\s+/gu, ' ')
      .replace(/\s+([,.;:!?])/gu, '$1')
      .trim();
    if (clean) sanitized.push(clean);
  }

  return limitCharacters(sanitized.join(' '), maximum);
}

function publicId(value: unknown): string {
  const candidate = typeof value === 'number' && Number.isSafeInteger(value)
    ? String(value)
    : typeof value === 'string' ? value.trim() : '';
  return PUBLIC_ID_RE.test(candidate) ? candidate : '';
}

export function projectPublicLot(value: unknown): PublicLotCorpusRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as RawRecord;
  if (raw.provider !== 'hibid' || raw.private === true || raw.isPublic === false) return null;

  const eventItemId = publicId(raw.eventItemId);
  const auctionId = publicId(raw.auctionId);
  const title = sanitizePublicText(raw.title, TITLE_MAX_CHARS);
  if (!eventItemId || !auctionId || !title) return null;

  const description = sanitizePublicText(raw.description, DESCRIPTION_MAX_CHARS);
  const category = sanitizePublicText(raw.category, CATEGORY_MAX_CHARS);
  return {
    provider: 'hibid',
    eventItemId,
    auctionId,
    title,
    ...(description ? { description } : {}),
    ...(category ? { category } : {}),
  };
}

function parseJsonl(value: string): RawRecord[] {
  const records: RawRecord[] = [];
  const source = value.replace(/^\ufeff/u, '');
  for (const [index, line] of source.split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Invalid source JSONL at line ${index + 1}: ${detail}`);
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error(`Invalid source record at line ${index + 1}`);
    }
    records.push(parsed as RawRecord);
  }
  return records;
}

function serializeRecord(record: PublicLotCorpusRecord): string {
  return JSON.stringify(record);
}

function selectionKey(seed: string, eventItemId: string): string {
  return sha256(`${seed}\0${eventItemId}`);
}

function deterministicGzip(value: string): Buffer {
  const result = gzipSync(Buffer.from(value, 'utf8'), { level: 9 });
  result.fill(0, 4, 8);
  result[9] = 255;
  return result;
}

export function materializeTitleCorpus(
  source: string | Uint8Array,
  options: MaterializeOptions = {},
): MaterializedTitleCorpus {
  const selectionCount = options.selectionCount ?? DEFAULT_SELECTION_COUNT;
  const selectionSeed = options.selectionSeed ?? DEFAULT_SELECTION_SEED;
  if (!Number.isSafeInteger(selectionCount) || selectionCount < 1) {
    throw new Error('selectionCount must be a positive integer');
  }
  if (!selectionSeed) throw new Error('selectionSeed must not be empty');

  const sourceBytes = typeof source === 'string' ? Buffer.from(source, 'utf8') : Buffer.from(source);
  const rawRecords = parseJsonl(sourceBytes.toString('utf8'));
  const distinct = new Map<string, { record: PublicLotCorpusRecord; serialized: string }>();
  let eligibleRecords = 0;
  let rejectedRecords = 0;
  let duplicateRecords = 0;

  for (const raw of rawRecords) {
    const record = projectPublicLot(raw);
    if (!record) {
      rejectedRecords += 1;
      continue;
    }
    eligibleRecords += 1;
    const serialized = serializeRecord(record);
    const previous = distinct.get(record.eventItemId);
    if (previous) {
      duplicateRecords += 1;
      if (compareStableText(serialized, previous.serialized) < 0) {
        distinct.set(record.eventItemId, { record, serialized });
      }
    } else {
      distinct.set(record.eventItemId, { record, serialized });
    }
  }

  if (distinct.size < selectionCount) {
    throw new Error(`Requested ${selectionCount} records, but only ${distinct.size} distinct eligible records are available`);
  }

  const records = [...distinct.values()]
    .sort((left, right) => {
      const rank = compareStableText(
        selectionKey(selectionSeed, left.record.eventItemId),
        selectionKey(selectionSeed, right.record.eventItemId),
      );
      return rank || compareStableText(left.record.eventItemId, right.record.eventItemId);
    })
    .slice(0, selectionCount)
    .map(({ record }) => record)
    .sort((left, right) => compareStableText(left.eventItemId, right.eventItemId));
  const content = `${records.map(serializeRecord).join('\n')}\n`;
  const contentBytes = Buffer.byteLength(content, 'utf8');
  const artifact = deterministicGzip(content);
  const manifest: PublicLotCorpusManifest = {
    schemaVersion: 1,
    corpusVersion: CORPUS_VERSION,
    format: 'jsonl+gzip',
    source: options.sourceLabel ?? DEFAULT_SOURCE_PATH,
    output: options.outputLabel ?? DEFAULT_OUTPUT_PATH,
    hashAlgorithm: 'sha256',
    sourceHash: sha256(sourceBytes),
    contentHash: sha256(content),
    contentBytes,
    artifactHash: sha256(artifact),
    artifactBytes: artifact.byteLength,
    selectionSeed,
    selectionAlgorithm: 'sha256-v1',
    sanitizerVersion: SANITIZER_VERSION,
    limits: {
      titleChars: TITLE_MAX_CHARS,
      descriptionChars: DESCRIPTION_MAX_CHARS,
      categoryChars: CATEGORY_MAX_CHARS,
    },
    counts: {
      sourceRecords: rawRecords.length,
      eligibleRecords,
      rejectedRecords,
      duplicateRecords,
      distinctEligibleRecords: distinct.size,
      requestedRecords: selectionCount,
      selectedRecords: records.length,
      descriptionsIncluded: records.filter((record) => record.description).length,
      categoriesIncluded: records.filter((record) => record.category).length,
    },
  };
  return { records, content, artifact, manifest };
}

function portablePath(value: string): string {
  return value.replace(/\\/gu, '/');
}

function pathLabel(value: string): string {
  const relative = path.relative(process.cwd(), value);
  return portablePath(relative && !relative.startsWith('..') ? relative : path.resolve(value));
}

export async function materializeTitleCorpusFile(options: MaterializeFileOptions): Promise<MaterializedTitleCorpus> {
  const source = await readFile(options.sourcePath);
  const result = materializeTitleCorpus(source, {
    selectionCount: options.selectionCount,
    selectionSeed: options.selectionSeed,
    sourceLabel: options.sourceLabel ?? pathLabel(options.sourcePath),
    outputLabel: options.outputLabel ?? pathLabel(options.outputPath),
  });
  await mkdir(path.dirname(options.outputPath), { recursive: true });
  await mkdir(path.dirname(options.manifestPath), { recursive: true });
  await writeFile(options.outputPath, result.artifact);
  await writeFile(options.manifestPath, `${JSON.stringify(result.manifest, null, 2)}\n`, 'utf8');
  return result;
}

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

async function main(): Promise<void> {
  const sourcePath = path.resolve(argument('--source', DEFAULT_SOURCE_PATH));
  const outputPath = path.resolve(argument('--output', DEFAULT_OUTPUT_PATH));
  const manifestPath = path.resolve(argument('--manifest', DEFAULT_MANIFEST_PATH));
  const selectionCount = Number(argument('--count', String(DEFAULT_SELECTION_COUNT)));
  const selectionSeed = argument('--seed', DEFAULT_SELECTION_SEED);
  const result = await materializeTitleCorpusFile({
    sourcePath,
    outputPath,
    manifestPath,
    selectionCount,
    selectionSeed,
  });
  console.log(JSON.stringify({
    output: result.manifest.output,
    manifest: pathLabel(manifestPath),
    sourceHash: result.manifest.sourceHash,
    contentHash: result.manifest.contentHash,
    artifactHash: result.manifest.artifactHash,
    counts: result.manifest.counts,
  }, null, 2));
}

const invokedUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === invokedUrl) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
