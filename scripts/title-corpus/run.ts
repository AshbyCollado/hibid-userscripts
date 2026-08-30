import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseTitleCorpusJsonl, runTitleCorpus } from '../../src/testing/title-corpus.js';
import { readTitleCorpusFile } from './corpus-io.js';

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

const corpusPath = path.resolve(argument('--corpus', 'tests/fixtures/title-corpus/public-lots-v1.jsonl.gz'));
const reportPath = path.resolve(argument('--report', 'artifacts/title-corpus/title-reliability-report.json'));
const seed = Number(argument('--seed', String(0x5eed1234)));
const mutationRounds = Number(argument('--mutation-rounds', '8'));
const maxRecords = Number(argument('--max-records', '0')) || undefined;
const allowErrors = process.argv.includes('--allow-errors');

const records = parseTitleCorpusJsonl(await readTitleCorpusFile(corpusPath));
const report = runTitleCorpus(records, { seed, mutationRounds, maxRecords });
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  corpusPath,
  reportPath,
  records: report.records,
  distinctRecords: report.distinctRecords,
  mutationChecks: report.mutationChecks,
  errorCount: report.errorCount,
  warningCount: report.warningCount,
  issueCounts: report.issueCounts,
  elapsedMs: report.elapsedMs,
}, null, 2));

if (report.errorCount && !allowErrors) process.exitCode = 1;
