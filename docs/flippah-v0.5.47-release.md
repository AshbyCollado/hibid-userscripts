# Flippah 0.5.47

## Release Scope

- Improve description-aware brand/model queries, named variants, measurements,
  accessory rejection, condition negation, and quantity review.
- Keep retained Amazon evidence bound to the exact product identity and reject
  stale responses after navigation or identity changes.
- Refresh live bid economics without discarding matching retail evidence.
- Distinguish known auction subtotals from estimates with unverified costs.
- Preserve physical photo descriptors and expose unverified photo completeness
  rather than silently claiming every image was collected.
- Improve popup copy coordination, resumable research batches, and evidence
  instructions in the copied AI export.
- Keep active asking-price context separate from verified sold evidence.

## Boundaries

The owner closed the eight-auction audit on October 5, 2026. This release does
not resume it or promote its incomplete research artifacts. Standalone audit
tools, private response captures, workbooks, and their artifact-dependent tests
are retained in the original audit checkout and excluded from this release.
Maintained runtime tests remain in the release checkout.

No sold-history API entitlement is added. Automatic AI research acceptance is
not proven by a passing unit suite. Chrome Store upload, review, publication,
and installed-client delivery must be reported as separate observed states.
Waterfox compatibility builds are retained; installed Waterfox acceptance is
not claimed.

## Release Verification

Clean-checkout verification on October 5, 2026:

- Typecheck and Chrome/Waterfox development builds: pass.
- Maintained suite: 2,487 passed, two skipped, zero failed (2,489 total).
- Historical userscript suite: 278 passed, zero failed.
- Title-corpus harness: 11 passed, zero failed (also part of maintained suite).
- Store builds and 16-file Chrome package validation: pass.
- Deferred cache/live-bid and stale-identity regressions: eight passed.

The independent review's live-bid race was corrected before submission. The
second cache peek now reconciles fresh native bids without replacing a shared
record used to reject stale identity responses. These are automated regression
results, not a claim of a new installed-browser or full AI acceptance run.
Upload and submission receipts are saved under `artifacts/chrome-web-store`.
