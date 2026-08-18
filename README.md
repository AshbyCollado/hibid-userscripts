# FlipperAddon by ALOS

Hosted Tampermonkey userscript for auction and resale scraping/export workflows across HiBid, AJ Willner, AuctionNinja, AAR Auctions, GovDeals, eBay Seller Hub, and Facebook Marketplace.

Current release candidate: `v0.8.20`. The Cross-Site Network-First Reliability work below is the approved implementation contract. A route is not considered browser-verified until its own Chrome discovery and installed Waterfox acceptance checks have passed.

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
| AJ Willner | Auction catalog pages under `bid.ajwillnerauctions.com` | Enumerate through same-origin `/api/items/search`, validate API total and stable item IDs, then hydrate descriptions/photos only from proven first-party detail data. |
| AuctionNinja | Sale catalogs, category/search pages, followed items, won items, and bid history | Deterministic server-rendered pagination with canonical product/sale identities and exact visible range/total validation. |
| AAR Auctions | Auction calendar, auction catalog, and single-item servlet pages | Deterministic server-rendered pagination keyed by `auctionId` and optional `itemId`; page-size values are not treated as totals. |
| GovDeals | Seller, filtered search/new-listings, and asset pages | Observed endpoint `https://maestro.lqdt1.com/search/list`. Its opaque `sessionId` is always redacted; until safe request construction and total equality are proven, use canonical DOM with an audited settled-bottom fallback. |
| eBay | Seller Hub Active, Bulk Sell handoff, Ended, Sold, and Transactions | Deterministic Seller Hub pagination using stable listing/order/transaction identities. Exports are recursively sanitized to exclude buyer PII. |
| Facebook | Marketplace selling listings | Canonical Marketplace listing IDs plus a deterministic virtual-scroll settled-bottom audit. Private/unstable GraphQL calls are not replayed. |

## Network Evidence Policy

Chrome DevTools/CDP Network capture is the discovery authority. Sanitized HAR or JSON fixtures are portable test evidence; raw captures stay outside Git.

Committed diagnostics may contain endpoint paths, operation names, sanitized request variables, filters, totals, stable IDs, page/batch counts, timings, and errors. They must remove cookies, authorization headers, CSRF values, access/account tokens, GovDeals `sessionId`, HiBid account-info responses, buyer PII, typed form values, and personal messages. A capture containing only analytics or advertising traffic is not scraper evidence.

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
