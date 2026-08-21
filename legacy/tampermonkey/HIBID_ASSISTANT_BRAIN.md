# FlipperAddon Brain

Living architecture and release contract for `hibid-bid-assistant.user.js`.

Current release candidate: `v0.8.25`. Clipboard success requires a resolved Tampermonkey promise or callback, or a successful browser copy fallback; never treat a fire-and-forget clipboard call as proof.

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
| GovDeals | Seller, filtered search/new-listings, and asset pages | In-memory observation/replay of the active `maestro.lqdt1.com` read request, authoritative `x-total-count`, exact `accountId:assetId` coverage, and identity-checked asset hydration. Fail closed when that proof is unavailable. |
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

- Public auction context endpoint: same-origin `/api/auctions/{auctionId}?page={active|closed}&include_items_data=false&include_documents=true`. Normalize public auction metadata only; omit contact email and phone fields.
- Catalog enumeration endpoint: same-origin `/api/items/search` with `auction_id`, `page`, `per_page`, `exact_category_match=true`, and the active category/subcategory/search filters.
- Use pages of 200 with three workers, request timeouts, three bounded retries, and an abort signal wired to Stop.
- Require the API's explicit total, unique item IDs, unchanged auction route/filter fingerprint, complete page coverage, and agreement with the unfiltered auction's published count. A missing total is not inferred from returned rows.
- The search response already contains full description text/HTML, category paths, quantity, pricing/closing fields, and every image URL, so routine per-item detail crawling is unnecessary.
- A virtualized DOM is a bounded fallback only when an exact total is known, every row has a canonical item ID, the route still matches, and settled-bottom coverage equals that total. A one-card/no-total surface fails closed.
- After bounded failure, stage only the shared audited partial action with expected/copied counts, missing IDs/pages, filters, and route fingerprint.

### AuctionNinja

- Sale catalogs and category pages are deterministic server-rendered HTML. Chrome CDP observed no reusable listing JSON endpoint for those routes.
- Sale catalogs require one seller/sale ID, contiguous advertised ranges, canonical product IDs, and exact total equality. The proven 106-item fixture is `20/20/20/20/20/6` with no duplicates.
- Category pages preserve every active filter except the page number. The sanitized capture fixture was 94 items across `20/20/20/20/14`; live Chrome revalidation on 2026-08-18 observed the changing inventory at `148/148`, with 148 successful detail enrichments. A new filter, category, ZIP, radius, or sort value is route drift.
- Nearby-auction search pages use first-party `/marketplace_ajax.php`. Its response is JSON containing `head`, `body`, and `pagination` HTML fragments. Ignore map/contact/filter payload keys, and scope cards to `.location-search-result-all[_]` so the unrelated promotional shipping strip cannot contaminate results.
- Auction-search stable identity is canonical target hostname plus path, not the numeric sale suffix alone. Integrated Black Rock Gallery links must unwrap the public `backurl` before dedupe.
- Product cards are enriched with bounded same-origin detail-page requests for full descriptions, all product photos, category, bids, pickup/shipping, and buyer premium. Detail failures remain audited failures.
- Followed items, won items, and bid history require an explicit total, explicit empty state, or a non-empty canonical DOM that has demonstrably settled across every discovered page. A blank shell may not certify zero.
- Chrome's signed-out account-route probe redirected to sign-in, so it is not account-export acceptance evidence. Account acceptance must come from an authenticated installed browser without committing account identifiers.
- Opaque `an` values, map/contact payloads, account identity, bidder aliases, email, phone, street addresses, invoice data, and payment data never enter committed fixtures.
- Never trim over-collected rows to make a total appear correct.

### AAR Auctions

- The calendar is one server-rendered document. It has no authoritative total, so completeness requires canonical auction IDs to remain stable for two cycles after the real page bottom is reached. Chrome observed 56/56 unique auction IDs on 2026-08-18.
- Catalog enumeration uses same-origin `/servlet/Search.do` with `auctionId`, active `categoryName`/`keyword`/`lotId`/`orderBy`, `page`, and `perPage=100`. Do not use `itemId` while enumerating.
- Unfiltered catalogs require equality with `All Items (N)`. Filtered catalogs do not borrow that broad total; they require deterministic pagination exhaustion and a short/no-next final page.
- Embedded `new Lot(...)` records provide stable `itemId`, lot number, full description, current/minimum bid, quantity, and closing data. Bidder aliases in those arguments are discarded.
- Enrich every enumerated item through the same-origin `Search.do?auctionId=...&itemId=...` document with concurrency four, three retries, and Stop support. The final response must preserve both IDs. Normalize every auction photo to its large same-auction URL.
- Chrome proved current catalog `8649` at 80/80 unique item IDs and historical sample catalog `8573` at 41/41. First/middle/final detail records all contained descriptions and multiple large images.
- Treat a direct `itemId` route as a one-record scope. Follow read-only deterministic pages only; never click bid, register, track, login, or payment controls.

### GovDeals

- Enumeration endpoint: `POST https://maestro.lqdt1.com/search/list`.
- Observe the active browser request in memory so its route-specific search text, location, ZIP/radius, categories, facets, account IDs, sort, page size, and other active filters remain exact. Bounded page replay changes only the page field.
- The observer starts at `document-start`, snapshots the route when the native request is sent, and ignores FlipperAddon's own replay XHRs. A captured search must match the current normalized route scope; a Rutgers capture cannot satisfy another seller and a `q=laptops` capture cannot satisfy `q=servers`.
- The response header `x-total-count` is authoritative. Normal export requires that total to equal both collected records and unique `accountId:assetId` identities, with an unchanged route/request fingerprint.
- Chrome evidence for the `07008` / 50-mile route: total `749`, page size `24`, 32 pages, and a five-record final page. Page 4 returned 24 unique IDs with zero overlap against page 1.
- Chrome evidence for the Rutgers seller scope: `accountIds: [7529]` returned `13/13` unique records.
- Asset hydration endpoint: `POST https://maestro.lqdt1.com/assets/{assetId}/{accountId}/false` with `{ "businessId": "GD", "siteId": 1 }`. Merge a response only when both IDs match the request. Preserve the full long description, specifications, and every photo; the inspected sample returned four photos.
- Search rows that already contain a description and photo do not trigger a second asset request. The observed search rows contained photos but not long descriptions, so detail enrichment is capped at 90 assets per export with concurrency eight, bounded retries, and the same Stop signal. Deferred descriptions are audited and the LLM brief must treat a blank description as unknown, not low value.
- Tampermonkey replay prefers `GM_xmlhttpRequest` so Waterfox does not depend on page CORS. It is credentialless, omits cookie/authorization/browser-managed headers, reuses only the observed public API header contract in memory, and aborts immediately when Stop is pressed.
- The observer and replay template live in memory only. Never persist or log `sessionId`, request-header values, cookies, authorization material, account tokens, or seller contact names, email addresses, phone numbers, and street addresses.
- Reject `isAPIFailureActive`, missing totals, stale seller/filter captures, malformed identities, total drift, and route/request drift after bounded retries. A direct asset DOM snapshot is `unproven`, never a normal complete export; only an explicitly audited partial may be offered.
- URL ZIP/miles filters and the observed request body must agree. A disagreement is filter drift, not a successful export.

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

### AJ Willner - accepted 2026-08-18

- Chrome CDP/API evidence on auction `164037`: explicit total `868`, page counts `200/200/200/200/68`, copied unique IDs `868`, duplicates `0`, and wrong-auction IDs `0`.
- Every one of the 868 API records carried a non-empty description and image data; total image URLs were `4,052`. First, middle, and final records retained descriptions and complete image arrays.
- Filter evidence: `query=sofa` produced exactly `26/26` unique matching records; the Closed route mapped to `sub_category=Closed` without widening scope.
- Installed Waterfox `v0.8.22` proof: the AJ module mounted on the real page, copied a valid 4,099,263-byte JSON array with `868/868` unique IDs, descriptions on `868`, images on `868`, and `4,052` image URLs.
- Installed Waterfox LLM proof: the 4,103,410-byte brief contained all 868 IDs, description/image arrays, first/middle/final titles, the verified eBay sold-data rule, and the mixed/group component rule.
- Debug acceptance: delegated `Download Debug` produced a 690,162-byte file and recorded the AJ bootstrap total plus page request counts. The normal site search field remained focusable while the panel was open.
- `234/234` automated tests passed, including missing totals, bootstrap mismatch, short-page retry, Stop abort, duplicate IDs, route drift, unproven DOM rejection, shared partial staging, and sanitized fixture validation.
- Raw CDP/network responses, clipboard payloads, and screenshots remain outside Git. Only sanitized endpoint/count fixtures are committed.

### GovDeals - Chrome evidence recorded 2026-08-18; Waterfox pending

- Chrome CDP identified `POST https://maestro.lqdt1.com/search/list` and proved `x-total-count` as the filtered-total authority.
- The `07008` / 50-mile search reported an authoritative total of `749` over 32 pages of 24, with five on the final page. Sampled page 4 had 24 unique IDs and no overlap with page 1.
- Candidate enumeration reproduced `749/749` unique IDs in 4.6 seconds. All 749 search rows had a normalized photo and location; long descriptions required the asset endpoint. A stress probe reached 108 successful details before `403`, so normal enrichment is capped at 90 and reports deferred descriptions explicitly.
- The Rutgers seller request used `accountIds: [7529]` and proved `13/13` unique identities.
- Stable identity is `accountId:assetId`. The asset endpoint returned an identity-matched full description/specification record and all four sample photos.
- Adversarial tests reject stale query/seller captures, API failure fallback rows, missing account IDs, seller scope leakage, request-drift partials, and contact-bearing asset DOM as complete evidence. Stop aborts the active GM request.
- Only endpoint shape, sanitized variables, public IDs, and aggregate counts are committed. Session/header values and seller contact PII remain transient and are not stored.
- This section records Chrome discovery evidence for candidate `v0.8.25`. It does not claim that the hosted userscript has been updated or accepted in Waterfox.

## Known Unverified Areas

- HiBid passed this gate at `v0.8.21`; every later hosted version still requires a fresh installed Waterfox acceptance before claiming parity.
- AJ Willner passed its Chrome and installed Waterfox gate at `v0.8.22`; later releases still require regression acceptance before claiming parity.
- AuctionNinja and AAR currently rely on deterministic server-rendered pagination.
- GovDeals Chrome discovery and its network contract are recorded for candidate `v0.8.25`; installed Waterfox copy/export, panel-version, debug-download, and page-usability acceptance are still pending.
- eBay deterministic Seller Hub pagination needs route-specific completeness and PII tests for each lifecycle page.
- Facebook needs a canonical-ID settled-bottom implementation; initial visible DOM is not full coverage.
- Do not convert any of these statements into a browser-pass claim without the required evidence.
