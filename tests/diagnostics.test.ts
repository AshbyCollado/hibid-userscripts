import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildScrapeDiagnostic } from '../src/core/diagnostics.js';
import type { ScrapeJobSummary } from '../src/core/types.js';

test('completed jobs produce a non-null sanitized diagnostic payload', () => {
  const job: ScrapeJobSummary = {
    jobId: 'job-7', schemaVersion: 1, tabId: 4,
    sourceUrl: 'https://hibid.com/lots?q=gaming%20pc', fingerprint: 'search|gaming pc',
    routeKind: 'search', scopeId: null, phase: 'completed', revision: 8,
    expectedTotal: 7, enumeratedCount: 7, hydratedCount: 7,
    message: 'Ready to copy 7 lots', errorCode: '', startedAt: 1, updatedAt: 2, completedAt: 2
  };
  const diagnostic = buildScrapeDiagnostic({ job });
  assert.equal(diagnostic.phase, 'completed');
  assert.equal(diagnostic.expectedTotal, 7);
  assert.equal(diagnostic.enumeratedCount, 7);
  assert.equal(diagnostic.hydratedCount, 7);
  assert.equal((diagnostic.coverage as Record<string, unknown>).reason, 'complete');
  const serialized = JSON.stringify(diagnostic).toLowerCase();
  assert.doesNotMatch(serialized, /authorization|cookie|accounttoken/);
});

test('popup never reports a copied or downloaded null diagnostic', async () => {
  const popup = await readFile('src/popup/index.ts', 'utf8');
  assert.match(popup, /if \(!diagnostic\) throw new Error\('No diagnostic is stored/);
  assert.match(popup, /Diagnostic copied/);
  assert.match(popup, /Diagnostic downloaded/);
});
