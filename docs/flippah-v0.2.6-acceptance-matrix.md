# Flippah v0.2.6 Acceptance Matrix

## Run Metadata

- Product: Flippah v0.2.6
- Chrome installation under test: `C:\Users\ashby\Documents\lotlens-local`
- Chrome extension ID: `dpgcddpffcogaodnoildpgdbjfabmdkn`
- Browser evidence source: Chrome observations supplied for the installed unpacked extension; this run did not independently re-click the browser controls.
- Local repository: `C:\Users\ashby\Desktop\hibid-userscripts`
- Scope of this recorder run: inspect current source/tests, run verification commands, and update this document only. No source edits were made by this run.

### Evidence labels

- **PASS — Chrome observed (supplied):** the requested end-user action and result were reported from the installed v0.2.6 Chrome instance.
- **PASS — prior Chrome observed (supplied):** a prior v0.2.5/v0.2.6 browser observation supplied for this matrix.
- **PASS — unit/static:** supported by the current local source and automated tests, without a new browser action in this run.
- **NOT SAFELY TRIGGERABLE:** intentionally not forced because doing so would require a real-time account/notification condition; this is not represented as a browser pass.
- **FAIL:** a required action did not work or a release gate failed. No current v0.2.6 failure was reported in the supplied evidence or local gates below.

## Release Gate

| Gate | Result | Evidence |
|---|---|---|
| Current package version | **PASS — unit/static** | `package.json`, `package-lock.json`, and generated manifests report `0.2.6`. |
| Chrome package build | **PASS — unit/static** | `npm test` built Chrome and Waterfox packages successfully. |
| Waterfox package build | **PASS — unit/static** | The same build generated the Waterfox manifest successfully. This is not a claim that Waterfox UI was re-clicked in this run. |
| Modern tests | **PASS — unit/static** | `32` tests, `32` pass, `0` fail, `0` skipped. |
| Legacy tests | **PASS — unit/static** | `278` tests, `278` pass, `0` fail, `0` skipped. |
| Patch whitespace check | **PASS — static** | `git diff --check` exit code `0`. Git emitted only existing LF/CRLF normalization warnings. |
| Strict release blockers | **PASS** | No blocker was found by the current automated gates or the supplied v0.2.6 Chrome evidence. Live-alert notification remains an explicit safety-limited item below. |

## Real Chrome Scrapes

These rows preserve the fresh evidence supplied for the installed Chrome extension. The raw clipboard payload paths were not included with the request, so this matrix records the parsed validation values without inventing artifact filenames.

| Result | Exact URL | End-user action/result | Parsed evidence |
|---|---|---|---|
| **PASS — Chrome observed (supplied)** | `https://hibid.com/lots/40198/computers-and-electronics/computers/desktop---all-in-ones?q=gaming%20pc&zip=Carteret,%20NJ%2007008,%20USA&miles=-1&countryname=United%20States&shippingoffered=true&status=OPEN&status=UPCOMING&status=CLOSING_TODAY&s=TIME_LEFT` | Copied filtered gaming-search JSON from the installed v0.2.6 extension. | `7/7` copied, `7` unique, `complete=true`; descriptions `5`, images `7`, categories `7`. |
| **PASS — Chrome observed (supplied)** | `https://hibid.com/catalog/765226/mid-summer-deals-overstock---liquidation---returns-w31` | Copied the complete catalog JSON. | `497/497` copied, `497` unique; descriptions `497`, images `497`, categories `497`. First/middle/last stable IDs: `315385591` / `315385839` / `315386087`. |
| **PASS — Chrome observed (supplied)** | `https://hibid.com/account/watchlist` | Copied signed-in watchlist JSON. | `40/40` copied, `40` unique, `complete=true`; descriptions `32`, images `40`, categories `40`. |
| **PASS — Chrome observed (supplied)** | `https://hibid.com/account/pastwatchlist` | Selected only `Be Biopharma — Cambridge, MA`, then copied the selected group. | Exactly `3/3` unique IDs: `313088791`, `314173058`, `314173064`. The next auction was excluded. All three had canonical URLs, category, two images, and full `descriptionHtml`. |
| **PASS — prior Chrome observed (supplied)** | `https://hibid.com/catalog/757032/overstock-product-liquidation-nj-w27---great-deals?g=-1&q=lebron` | Copied the zero-result filtered export. | `0/0`; no unrelated lots were copied. |

## Feature Matrix

| Feature / route | Status | Evidence boundary |
|---|---|---|
| Filtered HiBid search export | **PASS — Chrome observed (supplied)** | Exact gaming URL above; coverage and enrichment counts were reported from copied JSON. |
| Full HiBid catalog export | **PASS — Chrome observed (supplied)** | Catalog `765226`; exact total, unique count, and first/middle/last IDs were reported. |
| Signed-in HiBid watchlist export | **PASS — Chrome observed (supplied)** | `/account/watchlist`; exact `40/40` complete payload reported. |
| Selected past-watchlist auction isolation | **PASS — Chrome observed (supplied)** | `/account/pastwatchlist`; selected group contained only the three reported IDs and excluded the next auction. |
| HiBid current winning/outbid route support | **PASS — unit/static** | Route resolver tests cover `/account/currentbids?status=WINNING` and `status=OUTBID`; no new v0.2.6 browser payload was supplied for these two routes. |
| HiBid past-bids route support | **PASS — unit/static** | Route and account-scope code/tests cover `/account/pastbidsm`; no new v0.2.6 browser payload was supplied for this route. |
| Full descriptions and photos in exported records | **PASS — Chrome observed (supplied)** | Fresh catalog/search/watchlist/pastwatchlist enrichment counts above; current DOM tests also verify lead, category, structured fields, description, and all images. |
| LLM brief: coordinator prompt | **PASS — prior Chrome observed (supplied)** | Brief visibly contained the resale coordinator instructions and all exported items. |
| LLM brief: mixed/group component rule | **PASS — prior Chrome observed (supplied)** | Brief contained mandatory component extraction and review requirements. Current export tests also assert the mandatory resale rules. |
| LLM brief: verified eBay sold requirements | **PASS — prior Chrome observed (supplied)** | Brief contained sold/completed evidence requirements and no-invention constraints. |
| LLM brief: profit formulas | **PASS — prior Chrome observed (supplied)** | Brief contained the separate current-bid and recommended-max profit definitions. |
| LLM brief: spreadsheet instructions | **PASS — prior Chrome observed (supplied)** | Brief contained the requested decision columns, sorting, visibility, and formatting instructions. |
| LLM brief: Edison research settings | **PASS — prior Chrome observed (supplied)** | Brief contained Edison settings and all exported items. Current settings tests cover durable research defaults. |
| Stop flow | **PASS — prior Chrome observed (supplied)** | Observed sequence: `Stop` -> `Stopped`. |
| Retry flow | **PASS — prior Chrome observed (supplied)** | Observed sequence: `Stopped` -> `Retry` -> `running`. |
| Popup close/reopen persistence | **PASS — prior Chrome observed (supplied)** | Reopening the popup returned to the completed job state. Current job storage tests cover route/scope isolation and durable checkpoints. |
| Diagnostic clipboard export | **PASS — prior Chrome observed (supplied)** | Diagnostic clipboard parsed successfully. Current diagnostic tests reject null copied/downloaded diagnostics. |
| Diagnostic download | **PASS — prior Chrome observed (supplied)** | Download Diagnostic produced a valid file. Current background code provides sanitized diagnostic downloads. |
| Watchlist tab and CSV export | **PASS — prior Chrome observed (supplied)** | Watchlist tab and CSV parsing/export were visibly exercised. |
| Individual-lot calculator | **PASS — prior Chrome observed (supplied)** | Calculator was visibly exercised, including true cost, resale, ROI, and max-bid values. |
| eBay research links / View solds | **PASS — prior Chrome observed (supplied)** | View solds and research links were visibly available and worked in the prior run. |
| Options save and debug controls | **PASS — prior Chrome observed (supplied)** | Options save and debug behavior were visibly exercised. Current settings tests cover nullable numeric settings and durable research defaults. |
| Normal page usability | **PASS — prior Chrome observed (supplied)** | Prior acceptance evidence reported scrolling, links, filters, watch controls, bid controls, catalog cards, and calculator remained usable without a blocking overlay. |
| Live ending alerts | **NOT SAFELY TRIGGERABLE** | Unit tests pass for 15-minute/2-minute scheduling, durable notification flags, invalid lots, and ended lots. A real notification was not forced because it would require manipulating or waiting for a live account lot. This is not reported as a browser pass. |

## Current Code/Test Evidence

The current implementation was inspected at the following boundaries:

- `src/hibid/api.ts`: API-first enumeration/hydration, stable IDs, descriptions, pictures, categories, and coverage totals.
- `src/hibid/dom.ts`: account and selected past-auction DOM extraction, detail enrichment, and group boundaries.
- `src/hibid/exports.ts`: complete-only export audit plus coordinator, mixed-lot, eBay sold-data, profit, and spreadsheet instructions.
- `src/core/job-scope.ts`: route-fingerprint and visible-total checks preventing stale completed jobs from being reused.
- `src/core/diagnostics.ts` and `src/background/index.ts`: sanitized diagnostic persistence and download handling.
- `src/core/watch-alerts.ts`: durable ending-alert scheduling and notification dedupe.
- `src/popup/index.ts`: Current Page/Watchlist tabs, selected past-auction requirement, Stop/Retry actions, and diagnostic controls.

Automated coverage included the following current tests:

- API-first exact coverage for `245`, `618`, and `287` lots.
- Six-result filtered search and zero-result filtered search.
- Duplicate, missing-hydration, unexpected-ID, retry, cancellation, and route-drift rejection.
- Past-auction group isolation and HiBid watched-header sibling boundaries.
- Lot lead/category/structured-field/description/all-image extraction.
- LLM mandatory resale rules and private-note gating.
- Route support for HiBid public, watchlist, current-bids, past-bids, and past-watchlist pages.
- Settings normalization, durable alert dedupe, diagnostic payload sanitization, and popup diagnostic guards.

## Blockers And Limits

### Blockers

**None found for the tested v0.2.6 release scope.** The fresh Chrome evidence closes the prior filtered-search count gap and confirms rich descriptions/images/categories for the three primary scrape classes plus selected past-auction isolation.

### Explicit limits

1. The fresh Chrome actions were supplied as observed evidence; this recorder run did not independently control Chrome or re-click those actions.
2. Raw v0.2.6 clipboard/download artifacts were not attached or assigned local paths in the request. The parsed counts and IDs above are preserved exactly as supplied; no raw artifact path is claimed.
3. A real live ending notification was not safely triggered. The feature is **NOT SAFELY TRIGGERABLE**, while its scheduling/dedupe logic is **PASS — unit/static**.
4. Chrome and Waterfox package generation passed locally. A new Waterfox end-user interaction is not claimed by this matrix unless separately observed and recorded.

## Recorder Verdict

**PASS for the v0.2.6 acceptance scope represented by the supplied Chrome evidence and current automated gates.**

The only intentionally unobserved item is live-alert delivery, which is recorded as **NOT SAFELY TRIGGERABLE**, not silently converted into a pass. No current failure or release blocker was identified.
