import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseTitleCorpusJsonl, runTitleCorpus, type TitleReliabilityIssue } from '../../src/testing/title-corpus.js';
import { readTitleCorpusFile } from './corpus-io.js';

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

const corpusPath = path.resolve(argument('--corpus', 'tests/fixtures/title-corpus/public-lots-v1.jsonl.gz'));
const reportPath = path.resolve(argument('--report', 'artifacts/title-corpus/soak-progress.json'));
const durationMs = Math.max(1_000, Number(argument('--duration-ms', String(8 * 60 * 60 * 1_000))));
const mutationRounds = Math.max(1, Number(argument('--mutation-rounds', '16')));
const baseSeed = Number(argument('--seed', String(0x5eed1234))) >>> 0;
const records = parseTitleCorpusJsonl(await readTitleCorpusFile(corpusPath));
const startedAt = new Date();
const deadline = startedAt.getTime() + durationMs;
let cycles = 0;
let recordEvaluations = 0;
let mutationChecks = 0;
let errorObservations = 0;
let warningObservations = 0;
const firstIssues = new Map<string, TitleReliabilityIssue>();

await mkdir(path.dirname(reportPath), { recursive: true });
while (Date.now() < deadline) {
  const seed = (baseSeed + Math.imul(cycles + 1, 0x9e3779b1)) >>> 0;
  const report = runTitleCorpus(records, { seed, mutationRounds, maxIssues: 10_000 });
  cycles += 1;
  recordEvaluations += report.records;
  mutationChecks += report.mutationChecks;
  errorObservations += report.errorCount;
  warningObservations += report.warningCount;
  for (const current of report.issues) {
    const key = `${current.code}:${current.recordId}:${current.mutation || ''}`;
    if (!firstIssues.has(key) && firstIssues.size < 500) firstIssues.set(key, current);
  }
  const progress = {
    schemaVersion: 1,
    status: Date.now() >= deadline ? 'complete' : 'running',
    corpusPath,
    corpusRecords: records.length,
    startedAt: startedAt.toISOString(),
    targetDurationMs: durationMs,
    elapsedMs: Date.now() - startedAt.getTime(),
    cycles,
    recordEvaluations,
    mutationChecks,
    errorObservations,
    warningObservations,
    distinctIssueKeys: firstIssues.size,
    firstIssues: [...firstIssues.values()],
    lastSeed: seed,
    updatedAt: new Date().toISOString(),
  };
  const temporaryPath = `${reportPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(progress, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, reportPath);
  if (cycles % 10 === 0) console.log(JSON.stringify({ cycles, recordEvaluations, mutationChecks, elapsedMs: progress.elapsedMs }));
  await new Promise((resolve) => setTimeout(resolve, 100));
}

const final = JSON.parse(await readFile(reportPath, 'utf8')) as Record<string, unknown>;
final.status = 'complete';
final.finishedAt = new Date().toISOString();
final.elapsedMs = Date.now() - startedAt.getTime();
await writeFile(reportPath, `${JSON.stringify(final, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(final, null, 2));

if (errorObservations) process.exitCode = 1;
