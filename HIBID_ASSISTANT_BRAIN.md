# FlipperAddon Brain

Living architecture and release contract for `hibid-bid-assistant.user.js`.

Current release candidate: `v0.8.21`. Clipboard success requires a resolved Tampermonkey promise or callback, or a successful browser copy fallback; never treat a fire-and-forget clipboard call as proof.

## Current State

- Product: `FlipperAddon by ALOS`.
- Single hosted install: `hibid-bid-assistant.user.js`.
- Raw install/update URL: `https://raw.githubusercontent.com/AshbyCollado/hibid-userscripts/main/hibid-bid-assistant.user.js`.
- Hosted baseline when this plan was approved: `v0.8.18`.
- Approved direction: scraper/export only, network-first where a first-party read endpoint can be proven.
- This document records the target contract. It does not claim that every site gate or browser acceptance check has passed.
- Gate order: HiBid, AJ Willner, AuctionNinja, AAR Auctions, GovDeals, eBay, Facebook.
- Each site gate owns discovery, sanitized fixtures, implementation, adversarial tests, Chrome proof, Waterfox proof, documentation, version bump, commit, push, and installed-instance update.

## Product Boundary

Allowed:

- Read the active supported route, visible canonical DOM, and proven first-party read responses.
- Follow deterministic read-only pagination or bounded detail enrichment.
- Copy/download JSON, LLM briefs, audited partials, and sanitized diagnostics.
- Stop an active scrape and navigate to a supported site.

Not allowed:

- Bid, offer, register, watch/unwatch, check out, pay, publish, fill a listing/draft form, or change an account.
- Invoke bid, checkout, payment, publishing, or account-mutation endpoints.
- Export buyer PII, credentials, cookies, authorization/CSRF values, account tokens, private messages, or typed form values.

Legacy bid or cross-list draft helpers may still exist while the rewrite is in progress, but they are outside the approved active product contract and must not be exposed by supported route UI.

## Shared Route Manifest

Every supported route resolves to one manifest record with:

- site, page kind, canonical path, stable route identifiers, and normalized filters;
- allowed read endpoints and blocked mutation/account route families;
- stable item identity and authoritative total source, when one exists;
- pagination and safe enrichment rules;
- required proof tier and completeness checks;
- same-tab navigation target;
- sanitized diagnostic fields.

The route fingerprint is the canonical path plus stable route IDs and sorted filters. Any route or filter change during collection invalidates the run.

| Site | Supported route families | Required source/proof |
| --- | --- | --- |
| HiBid | `/catalog/*`, `/livecatalog/*`, global/state/category `/lots*`, dedicated watchlist/current-bids/past-auction account pages | Exact API IDs and totals for public pages; scoped canonical DOM for personalized account pages. |
| AJ Willner | `bid.ajwillnerauctions.com/ui/auctions/*` | Exact first-party API IDs/total, with bounded detail hydration. |
| AuctionNinja | Sale details, product, category, auction search, followed items, items won, and bid history | Deterministic server-rendered pagination and canonical product/sale identities. |
| AAR Auctions | `/auctions/`, `/servlet/Search.do?auctionId=*`, optional `itemId` | Deterministic server-rendered pagination keyed to auction/item IDs. |
| GovDeals | Seller, filtered search/new-listings, and asset pages | Proven search API only after safe request construction; otherwise canonical DOM with settled-bottom audit. |
| eBay | Seller Hub Active, Bulk Sell handoff, Ended, Sold, and Transactions | Deterministic Seller Hub pagination with stable listing/order/transaction identities. |
| Facebook | Marketplace selling listings | Canonical listing IDs with deterministic virtual-scroll settled-bottom audit. |

Unsupported login, registration, billing, payment, checkout, bid/offer, account-settings, and mutation routes must not expose scraper actions.

## Proof Hierarchy

Use the strongest available tier:

1. **`api-exact`**
   - Enumerate an authoritative total and exact stable IDs.
   - Hydrate only the enumerated IDs.
   - Require expected total = unique enumerated IDs = unique hydrated IDs.
2. **`pagination-exact`**
   - Follow deterministic server-rendered pages/ranges.
   - Require contiguous page/range coverage, stable identities, and exact advertised count.
3. **`dom-bottom-settled`**
   - Use only when no authoritative total or safe deterministic pagination exists.
   - Collect canonical IDs while scrolling until the bottom and multiple settle cycles are observed.
   - Record the lack of an authoritative API total explicitly.

Never certify a result by trimming excess rows, using broad embedded state, counting generic card descendants, parsing document-wide text, or replacing the page's filtered scope with a broad catalog/search connection.

Normal export fails closed on:

- duplicate, missing, or unexpected IDs;
- missing hydration records;
- failed/short pages after bounded retries;
- total drift or noncontiguous ranges;
- route or filter fingerprint changes;
- stale embedded state or cross-page/cross-site records;
- an unproven fallback claiming completeness.

## Audited Partial Export

After bounded retries, a normal copy remains blocked. The user may explicitly choose an audited partial matching the requested JSON or LLM format.

Minimum audit fields:

```json
{
  "complete": false,
  "proofTier": "api-exact | pagination-exact | dom-bottom-settled | unproven",
  "expectedCount": null,
  "copiedCount": 0,
  "uniqueIdCount": 0,
  "missingIds": [],
  "unexpectedIds": [],
  "duplicateIds": [],
  "failedPages": [],
  "failedBatches": [],
  "filters": {},
  "sourceUrl": "",
  "routeFingerprint": "",
  "stopReason": ""
}
```

A partial is invalidated if the route or filters change. It must never use a success label or a complete payload shape without the audit.

## Site Contracts

### HiBid

- Public search enumeration: `https://hibid-api.io/sr/main/v1/search/lot`.
- Public catalog/live hydration and auction-scoped enumeration: same-origin `https://hibid.com/graphql`.
- Preserve auction/category IDs, `q`, ZIP, miles, country, shipping, repeated statuses, sort, archive state, and portal scope.
- Stable identity: event-item ID.
- Deduplicate only by event-item ID; lot number, title, URL fragments, and tile descendants are not identities.
- Apollo state or DOM may fill a known enumerated ID only. They may not enumerate broad `Lot:*` entities or unrelated connections.
- Watchlist, current-bids, past-bids, and past-watchlist retain dedicated, route-scoped account DOM collectors. Public API results must not be substituted for personalized account state.
- Account cards are also keyed by event-item ID, never auction-local lot number. When an account page advertises `Showing ... of N lots`, exact stable-ID count equality is required; unknown totals remain `null` and are never coerced to zero.

### AJ Willner

- Catalog enumeration endpoint: same-origin `/api/items/search`.
- Require the API's total, unique item IDs, unchanged auction route, and complete page coverage.
- Enrich descriptions and photos only through observed, same-origin, read-only item/detail data.
- A virtualized DOM is a bounded fallback and needs canonical item IDs plus a settled-bottom audit; stopping early is incomplete.

### AuctionNinja

- Current discovery found deterministic server-rendered pages rather than a reusable listing API.
- Follow numbered/load-more pagination using advertised ranges such as `1-40 of N`.
- Stable identity comes from canonical product and sale URLs/IDs.
- Never trim over-collected rows to make a total appear correct.
- Sale catalogs, category/search results, followed items, won items, and bid history keep route-specific extractors and account scope.

### AAR Auctions

- Calendar and servlet catalog/item pages are server-rendered.
- Fingerprint `auctionId`, optional `itemId`, active page, and filters.
- Treat `itemId` as a one-record scope.
- Page-size controls are not authoritative totals.
- Follow deterministic pages only; do not click bid, register, track, login, or payment controls.

### GovDeals

- Observed read endpoint: `https://maestro.lqdt1.com/search/list`.
- Observed variables include filters, location, page, display rows, sort, facets, and account IDs.
- The request's opaque `sessionId` is sensitive operational state: redact it from diagnostics/fixtures and do not persist or replay it.
- Until safe browser-context request construction and filtered-total equality are proven, use canonical asset/listing IDs from the DOM and require a settled-bottom audit.
- Asset detail enrichment is same-origin, bounded, stoppable, and audited.
- URL ZIP/miles filters and visible active filters must agree; disagreement is filter drift, not a successful export.

### eBay

- Supported evidence pages: Seller Hub Active, Ended, Sold, Transactions, and the signed-in Bulk Sell handoff.
- Current discovery favors deterministic server-rendered Seller Hub pagination over replaying private endpoints.
- Stable identities are listing ID, order-line identity, or transaction ID according to page kind.
- Every lifecycle envelope must be complete before normal export. Nonempty does not mean complete.
- Recursively remove buyer names, usernames, email, addresses, messages, and other buyer PII.
- Bulk Sell starts from Active and follows eBay's current live `Edit all listings` link. Never store a personal `workspaceId`.

### Facebook

- Supported scope is the seller's Marketplace listing export.
- Use canonical Marketplace listing IDs and deterministic virtual scrolling until bottom/settle criteria pass.
- Do not replay private or unstable Facebook GraphQL operations.
- A visible first screen is a snapshot, not a complete export.
- Create Listing is a navigation shortcut only; the addon does not fill, save, submit, or publish.

## CDP And HAR Policy

Chrome DevTools/CDP Network is the discovery authority. Waterfox is the independent installed-userscript acceptance browser.

Raw CDP/HAR captures stay outside Git. Commit only sanitized endpoint manifests and minimal fixtures needed for tests.

Allowed fixture fields:

- endpoint path and operation name;
- sanitized request variables and filters;
- totals, stable IDs, page/batch numbers, timings, status, and errors;
- minimal response shape needed to test normalization and coverage.

Always remove:

- cookies and authorization headers;
- CSRF, access, refresh, account, and session tokens;
- GovDeals `sessionId`;
- HiBid `GetAccountInfo` responses and other account secrets;
- buyer PII and private messages;
- typed field values and unrelated personal data.

Analytics-only or advertising-only traffic is not scraper evidence. The supplied `hibid.com.har` contained only a Google remarketing request and therefore did not validate HiBid behavior.

Do not run a second DevTools controller against the same Chrome session when the connected integration already provides CDP; competing controllers can create connection contention.

## Navigation Contract

Primary auction rows:

- HiBid: `https://hibid.com/lots`
- AJ Willner: `https://bid.ajwillnerauctions.com/`
- AuctionNinja: `https://www.auctionninja.com/auctions`
- AAR Auctions: `https://aarauctions.com/auctions/`
- GovDeals: `https://www.govdeals.com/en/search`

`Selling Tools` children:

- eBay Active: `https://www.ebay.com/sh/lst/active`
- eBay Bulk Sell: Active-page handoff to eBay's current `Edit all listings` target
- eBay Ended: `https://www.ebay.com/sh/lst/ended`
- eBay Sold: `https://www.ebay.com/mys/sold`
- eBay Transactions: `https://www.ebay.com/mes/transactionlist?sh=true`
- Facebook Selling: `https://www.facebook.com/marketplace/you/selling`
- Facebook Create Listing: `https://www.facebook.com/marketplace/create/item`

Use same-tab navigation, disable it while busy, and close menus on selection, Escape, outside click, or minimize. Do not store temporary searches, personal auction IDs, or eBay workspace IDs.

## Debug Contract

Debug remains opt-in through the Tampermonkey command or `#flipperdebug`.

Record:

- script version, site/page kind, boot/current URL, and route fingerprint;
- selected endpoint/proof tier and sanitized variables;
- enumeration, page, hydration, retry, cancellation, and settle outcomes;
- expected/copied/unique counts and missing/unexpected/duplicate IDs;
- validation rejection, partial readiness, clipboard/download result, and caught errors.

Never record protected fields listed in the CDP/HAR policy. Keep diagnostics bounded.

## Verification Gates

For every site:

1. Capture Chrome CDP request/response evidence or prove deterministic DOM/server pagination.
2. Commit sanitized fixtures only.
3. Test zero results, duplicate IDs, missing hydration, short pages, total drift, filter/route changes, cancellation, stale state, contamination, and audited partials.
4. Run:

   ```powershell
   node --check .\hibid-bid-assistant.user.js
   node --check .\hibid-lot-catalog-scraper.user.js
   npm test
   git diff --check
   ```

5. In Chrome, run a real copy, parse the payload, compare authoritative total/item count/unique-ID count, inspect first/middle/final records, and capture full-window evidence.
6. In Waterfox, update the installed Tampermonkey script, confirm the panel's exact version, run the same route-appropriate copy, inspect the payload, test debug download, and confirm normal page interaction remains usable.

Opening a page proves navigation only. Source-level tests prove code behavior only. Neither substitutes for an installed Waterfox copy/export check.

## Mandatory Release Rule

Every version change uses this exact sequence:

1. Finish the gate and required checks.
2. Commit the intended release files.
3. Push the commit to the hosted branch.
4. Update or reinstall the raw userscript in the Waterfox profile under test.
5. Verify the installed panel version and complete a real copy/export.
6. Record only the evidence actually observed.

A push does not update an installed Tampermonkey copy. Do not mark a release, child goal, or browser gate complete before the installed Waterfox instance is updated and verified. Ship one patch release per completed site gate and update this brain after each gate.

## Acceptance Log

### HiBid - accepted 2026-08-18

- Chrome CDP/API evidence: auction catalogs resolved to exact stable-ID sets of `245/245`, `618/618`, and `287/287`; the last page also contained an unrelated `1105`-lot Apollo connection that was rejected.
- Filtered search evidence: six requested IDs produced `6/6`; a no-match filtered route produced `0/0` and did not widen to stale catalog state.
- Public catalog/live routes use auction-scoped GraphQL enumeration/hydration; global/category/filtered routes enumerate exact IDs through `hibid-api.io` before GraphQL hydration.
- Installed Waterfox `v0.8.21` account-watchlist proof: visible total `74`, copied JSON rows `74`, unique event-item IDs `74`, missing stable IDs `0`.
- Installed Chrome `v0.8.21` account-watchlist proof: visible total `74`, copied JSON rows `74`, unique event-item IDs `74`, missing stable IDs `0`.
- `226/226` automated tests passed, including duplicate IDs, reused auction-local lot numbers, short pages, missing hydration, stale state, filter drift, route changes, retries, cancellation, zero results, and audited partials.
- Raw account payloads and CDP traffic were not committed. Only sanitized endpoint/count evidence belongs in Git.

## Known Unverified Areas

- HiBid passed this gate at `v0.8.21`; every later hosted version still requires a fresh installed Waterfox acceptance before claiming parity.
- AJ Willner's `/api/items/search` enumeration is observed; exact hydration/coverage must pass its own gate.
- AuctionNinja and AAR currently rely on deterministic server-rendered pagination.
- GovDeals `maestro.lqdt1.com/search/list` is observed, but safe replay with exact active filters is not yet accepted; retain the fail-closed DOM fallback.
- eBay deterministic Seller Hub pagination needs route-specific completeness and PII tests for each lifecycle page.
- Facebook needs a canonical-ID settled-bottom implementation; initial visible DOM is not full coverage.
- Do not convert any of these statements into a browser-pass claim without the required evidence.
