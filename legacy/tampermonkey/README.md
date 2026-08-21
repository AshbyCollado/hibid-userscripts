# FlipperAddon by ALOS

Hosted Tampermonkey userscript for auction and resale scraping/export workflows across HiBid, AJ Willner, AuctionNinja, AAR Auctions, GovDeals, eBay Seller Hub, and Facebook Marketplace.

Current release candidate: `v0.8.25`. The Cross-Site Network-First Reliability work below is the approved implementation contract. A route is not considered browser-verified until its own Chrome discovery and installed Waterfox acceptance checks have passed.

## Install

Install or update the unified script from:

https://raw.githubusercontent.com/AshbyCollado/hibid-userscripts/main/hibid-bid-assistant.user.js

Only `hibid-bid-assistant.user.js` is the active install path. The older standalone HiBid scripts remain repository references and should not be enabled beside FlipperAddon.

## Product Boundary

FlipperAddon is scraper/export only. Supported actions read page or first-party response data, copy/download JSON or an LLM brief, stop an active scrape, and navigate to a supported site.

It must not click bids or offers, write bid fields, register for an auction, check out, pay, publish a listing, fill a marketplace draft, change account settings, or invoke another account mutation. Seller and account pages may be read only for the explicitly supported export scope. Buyer PII, credentials, cookies, authorization values, CSRF values, account tokens, and private messages must never enter an export or committed fixture.

## Reliability Contract

Every route uses the strongest proven source available:

1. **First-party API:** enumerate exact stable IDs and an authoritative total, hydrate only those IDs, and require total/ID equality.
2. **Deterministic pagination:** follow server-rendered pages or ranges and require exact range/count/identity coverage.
3. **Canonical DOM:** when no authoritative total exists, collect canonical stable IDs until the virtual list reaches a settled bottom and record that weaker proof tier.

Normal copy is rejected on duplicate IDs, missing hydration, unexpected IDs, short pages, total drift, filter drift, route changes, stale state, cross-page data, or source contamination. Broad embedded state and generic card/text counts are never accepted as identity evidence.

After bounded retries, the only permitted fallback is an audited partial export. It contains `complete: false`, expected and copied counts, unique stable IDs, missing IDs, failed pages/batches, active filters, source URL, route fingerprint, proof tier, and stop reason. A partial must never be presented as complete.

## Seven-Site Source Map

| Site | Supported read scope | Primary source and proof |
| --- | --- | --- |
| HiBid | Public catalog, live catalog, global/category/filtered lots; dedicated watchlist/current-bids/past-auction account exports | Enumerate through `https://hibid-api.io/sr/main/v1/search/lot` or same-origin `https://hibid.com/graphql`, then GraphQL-hydrate exact event-item IDs. Account routes keep their scoped canonical-DOM collectors. |
| AJ Willner | Auction catalog pages under `bid.ajwillnerauctions.com` | Enumerate through same-origin `/api/items/search`, validate API total and stable item IDs, and preserve the complete description and image arrays already returned by that endpoint. A lean `/api/auctions/{id}` request supplies public catalog context. |
| AuctionNinja | Sale catalogs, category/search pages, followed items, won items, and bid history | Exact seller-scoped HTML pagination for catalogs/categories, first-party `marketplace_ajax.php` JSON fragments for nearby auctions, canonical product/sale identities, and bounded product-detail enrichment. |
| AAR Auctions | Auction calendar, auction catalog, and single-item servlet pages | Calendar IDs require a settled-bottom audit. Catalogs enumerate through deterministic `Search.do` pages at `perPage=100`, validate active filters and unique `itemId` coverage, then hydrate every item detail for full descriptions and large photo arrays. Bidder aliases are discarded. |
| GovDeals | Seller, filtered search/new-listings, and asset pages | Observe the native browser request to `POST https://maestro.lqdt1.com/search/list` at document start, bind it to the exact route/filter/seller scope, and replay bounded pages through credentialless Tampermonkey requests. Treat `x-total-count` as authoritative, require `accountId:assetId`, and hydrate only missing description/photo evidence through the identity-checked asset endpoint. If exact proof is unavailable, fail closed rather than certifying a static DOM snapshot. |
| eBay | Seller Hub Active, Bulk Sell handoff, Ended, Sold, and Transactions | Deterministic Seller Hub pagination using stable listing/order/transaction identities. Exports are recursively sanitized to exclude buyer PII. |
| Facebook | Marketplace selling listings | Canonical Marketplace listing IDs plus a deterministic virtual-scroll settled-bottom audit. Private/unstable GraphQL calls are not replayed. |

## Network Evidence Policy

Chrome DevTools/CDP Network capture is the discovery authority. Sanitized HAR or JSON fixtures are portable test evidence; raw captures stay outside Git.

Committed diagnostics may contain endpoint paths, operation names, sanitized request variables, filters, totals, stable IDs, page/batch counts, timings, and errors. They must remove cookies, authorization headers, CSRF values, access/account tokens, GovDeals `sessionId`, HiBid account-info responses, buyer PII, typed form values, and personal messages. A capture containing only analytics or advertising traffic is not scraper evidence.

### GovDeals Chrome Evidence - `v0.8.25` Candidate

- Search enumeration uses `POST https://maestro.lqdt1.com/search/list`; the response header `x-total-count` is the authoritative filtered total.
- The `07008` / 50-mile search reported an authoritative total of `749` at 24 rows per page: 32 pages with 5 records on the final page. Page 4 returned 24 unique identities and had no overlap with page 1.
- Candidate enumeration reproduced all `749/749` unique IDs in 4.6 seconds. Search rows carried photos and public locations but no long descriptions; the asset endpoint supplied full descriptions and all photos for first/middle/final samples.
- The Rutgers seller request used `accountIds: [7529]` and returned exactly `13/13` unique records.
- Stable listing identity is `accountId:assetId`.
- Asset enrichment uses `POST https://maestro.lqdt1.com/assets/{assetId}/{accountId}/false` with the public body `{ "businessId": "GD", "siteId": 1 }`. The response must match both requested IDs before its full long description, specifications, and complete photo array are merged; the inspected sample exposed four photos.
- The candidate design observes the browser's active request and replays bounded page requests in memory. It never persists the opaque `sessionId`, request-header values, cookies, authorization data, or seller contact PII.
- Native captures are route-scoped and FlipperAddon replay traffic cannot replace them. Explicit API failure flags, stale seller/query captures, malformed identities, request drift, and total drift are rejected. Stop aborts active replay requests.
- Search rows with descriptions and photos skip asset hydration. Direct asset DOM is partial-only; normal single-asset export requires an identity-matched API response.
- Asset hydration is capped at 90 records per export because a stress run reached 108 successful detail responses before the service returned `403`. Deferred descriptions remain explicit in the export audit and the LLM brief is told to inspect the asset URL before rejecting those leads.
- If the request template, filtered total, stable-ID equality, or route/filter fingerprint cannot be proven, normal export fails closed. A static DOM page is not promoted to an exact export.

This is sanitized Chrome DevTools/CDP discovery evidence, not installed-release acceptance. Waterfox verification of `v0.8.25` is still pending.

Waterfox is the independent installed-release acceptance browser. Chrome network discovery does not prove that the hosted Tampermonkey build is installed or working in Waterfox.

## Site Switcher

The primary switcher contains one row each for HiBid, AJ Willner, AuctionNinja, AAR Auctions, and GovDeals. A separate `Selling Tools` row contains same-tab navigation for:

- eBay Active: `https://www.ebay.com/sh/lst/active`
- eBay Bulk Sell: open eBay Active and follow eBay's current signed-in `Edit all listings` link; never persist a personal `workspaceId`
- eBay Ended: `https://www.ebay.com/sh/lst/ended`
- eBay Sold: `https://www.ebay.com/mys/sold`
- eBay Transactions: `https://www.ebay.com/mes/transactionlist?sh=true`
- Facebook Selling: `https://www.facebook.com/marketplace/you/selling`
- Facebook Create Listing: `https://www.facebook.com/marketplace/create/item`

The Create Listing shortcut is navigation only. FlipperAddon does not fill or publish the form. Navigation is disabled during a scrape, and menus close after selection, Escape, outside click, or minimize.

## Debug And Verification

Debug logging is opt-in through the Tampermonkey menu or `#flipperdebug`. Sanitized diagnostics should identify the version, route fingerprint, source/proof tier, filters, request/page/batch outcomes, counts, IDs, retries, rejection reason, clipboard/download result, and caught errors without recording protected data.

Required local checks:

```powershell
node --check .\hibid-bid-assistant.user.js
node --check .\hibid-lot-catalog-scraper.user.js
npm test
git diff --check
```

Browser acceptance requires more than opening a page. For each site gate, verify the active route and panel version, run the page-appropriate copy action, parse the copied payload, compare expected count to item count and unique stable-ID count when an authoritative total exists, inspect first/middle/final records, confirm normal page use remains available, and save sanitized CDP plus full-window evidence. Waterfox must perform the same real copy through the installed Tampermonkey script.

## Mandatory Release Rule

Every version change follows this order without exception:

1. Complete the site gate's tests and browser evidence.
2. Commit the intended files.
3. Push the commit to the hosted GitHub branch.
4. Update or reinstall the raw userscript in the Waterfox profile being verified.
5. Confirm the installed panel reports the new version and complete a real copy/export check.

A GitHub push alone does not update Tampermonkey. Do not claim a release or browser gate complete until the installed Waterfox instance has been updated and verified.
