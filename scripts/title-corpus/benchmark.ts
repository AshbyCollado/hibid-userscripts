import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseTitleCorpusJsonl, runTitleCorpus } from '../../src/testing/title-corpus.js';
import { readTitleCorpusFile } from './corpus-io.js';

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

function positiveInteger(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

const corpusPath = path.resolve(argument('--corpus', 'tests/fixtures/title-corpus/public-lots-v1.jsonl.gz'));
const reportPath = path.resolve(argument('--report', 'artifacts/title-corpus/scaling-v0.5.17.json'));
const mutationRounds = positiveInteger(argument('--mutation-rounds', '32'), 32);
const samples = positiveInteger(argument('--samples', '3'), 3);
const seed = Number(argument('--seed', String(0x5eed1234))) >>> 0;
const records = parseTitleCorpusJsonl(await readTitleCorpusFile(corpusPath));
const requestedSizes = argument('--sizes', '250,500,1000,2000,3000')
  .split(',')
  .map((value) => positiveInteger(value.trim(), 0))
  .filter((value) => value > 0 && value <= records.length);
const sizes = [...new Set([...requestedSizes, records.length])].sort((left, right) => left - right);

// Warm the module and regular-expression paths without including that startup
// work in any reported sample.
runTitleCorpus(records, { maxRecords: Math.min(100, records.length), mutationRounds: 4, seed });

let totalErrors = 0;
let totalWarnings = 0;
const rows = sizes.map((recordCount) => {
  const elapsedSamples: number[] = [];
  const mutationSamples: number[] = [];
  for (let sample = 0; sample < samples; sample += 1) {
    const report = runTitleCorpus(records, {
      maxRecords: recordCount,
      mutationRounds,
      seed: (seed + sample) >>> 0,
      maxIssues: 100,
    });
    elapsedSamples.push(report.elapsedMs);
    mutationSamples.push(report.mutationChecks);
    totalErrors += report.errorCount;
    totalWarnings += report.warningCount;
  }
  const medianElapsedMs = median(elapsedSamples);
  const medianMutationChecks = median(mutationSamples);
  return {
    records: recordCount,
    samples,
    mutationRounds,
    medianElapsedMs,
    minElapsedMs: Math.min(...elapsedSamples),
    maxElapsedMs: Math.max(...elapsedSamples),
    medianRecordsPerSecond: Number((recordCount / (medianElapsedMs / 1_000)).toFixed(2)),
    medianMutationChecks,
    medianMutationChecksPerSecond: Number((medianMutationChecks / (medianElapsedMs / 1_000)).toFixed(2)),
  };
});

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  corpusPath,
  corpusRecords: records.length,
  seed,
  samples,
  mutationRounds,
  totalErrors,
  totalWarnings,
  rows,
};
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(output, null, 2));
if (totalErrors || totalWarnings) process.exitCode = 1;
