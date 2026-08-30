import type { CoverageAudit, ScrapeJobSummary } from './types.js';

export interface ScrapeDiagnosticInput {
  job: ScrapeJobSummary;
  coverage?: Partial<CoverageAudit> | null;
  failures?: unknown[];
}

export function buildScrapeDiagnostic({ job, coverage = null, failures = [] }: ScrapeDiagnosticInput): Record<string, unknown> {
  const terminalError = ['failed', 'stale', 'stopped'].includes(job.phase);
  return {
    sourceUrl: job.sourceUrl,
    fingerprint: job.fingerprint,
    phase: job.phase,
    reason: terminalError ? (job.errorCode || job.message) : '',
    expectedTotal: job.expectedTotal,
    enumeratedCount: job.enumeratedCount,
    hydratedCount: job.hydratedCount,
    coverage: coverage || {
      reason: job.phase === 'completed' ? 'complete' : job.errorCode,
      expectedCount: job.expectedTotal,
      uniqueEnumeratedCount: job.enumeratedCount,
      uniqueHydratedCount: job.hydratedCount,
      duplicateIds: [],
      missingIds: [],
      unexpectedIds: []
    },
    failures
  };
}
