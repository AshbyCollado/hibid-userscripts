# FlipperAddon Brain

Living issue tracker and architecture notes for `hibid-bid-assistant.user.js`.

## Current Product

- Name: `FlipperAddon by ALOS`.
- Active hosted install: `hibid-bid-assistant.user.js`.
- Raw install/update URL: `https://raw.githubusercontent.com/AshbyCollado/hibid-userscripts/main/hibid-bid-assistant.user.js`.
- Current version: `0.7.1`.
- UI: bottom-right minimized launcher plus dark drawer. It starts minimized every mount.
- Principle: only the module for the current page exposes controls.

## Module Map

- `catalog`: HiBid catalog/category/lot/OUTBID watchlist and AJ Willner auction pages.
  - Controls: max plan, Load Lots, Scan, Prepare Next, Stop, Copy Lots JSON, Copy LLM Brief.
- `live`: HiBid `/livecatalog/...` pages.
  - Controls: max plan, Auto-confirm, Arm, Snipe Now, Stop, Copy Lots JSON, Copy LLM Brief.
- `fliptracker`: eBay and Facebook active selling pages.
  - Controls: Scan Listings, Copy HTML, Download.
- `auctionninja`: AuctionNinja sale research pages.
  - Controls: max plan notes, Load Catalog, Copy Lots JSON, Copy LLM Brief, Stop.
  - Safety: research/export only; no bid clicks, no bid-field writes, no checkout/invoice/payment/account actions.
- `unsupported`: do not mount.

## Route Map

Mount without waiting for lot tiles on:

- `https://hibid.com/lots*`
- `https://hibid.com/*/lots*`, including `/newjersey/lots/40196/computers-and-electronics`
- `https://hibid.com/catalog/*`
- `https://hibid.com/livecatalog/*`
- `https://hibid.com/lot/*`
- `https://hibid.com/*/lot/*`
- `https://hibid.com/account/watchlist?status=OUTBID`
- `https://*.hibid.com/catalog/*`
- `https://*.hibid.com/lot/*`
- `https://*.hibid.com/account/watchlist?status=OUTBID`
- `https://bid.ajwillnerauctions.com/ui/auctions/*`
- `https://www.ebay.com/sh/lst*`
- `https://www.ebay.com/mys/*`
- `https://www.facebook.com/marketplace/you/*`
- `https://www.facebook.com/marketplace/profile/*`
- `https://www.auctionninja.com/auctions*`
- `https://www.auctionninja.com/items-won*`
- `https://www.auctionninja.com/*/sales/details/*.html*`
- `https://www.auctionninja.com/*/product/*.html*`

Do not mount on generic HiBid account/help/search pages unless a resolver case is added and tested.
Do not mount on AuctionNinja billing, payment, card, checkout, invoice, profile/settings, support, login/logout, or generic account pages.

## Scraper Flow

### HiBid

1. Data-first catalog scrape:
   - Parse `script#hibid-state[type="application/json"]`.
   - Use `apollo.state` normalized records.
   - Prefer `ROOT_QUERY` `lotSearch(...)` result order and total counts.
   - Extract `Lot:*`, `Auction:*`, and picture references into enriched lot rows.
2. Pagination:
   - Read `totalCount` / `filteredCount`, `pageLength`, and visible text like `Showing 1 to 100 of 222 lots`.
   - Fetch same-origin `?apage=2`, `?apage=3`, etc. and parse each returned `hibid-state`.
3. Fallback:
   - If embedded state is missing or state pagination is incomplete, scan visible DOM tiles/text, scroll, and use safe next/open-more controls.
   - Avoid `_ngcontent-*` attributes; they are Angular build artifacts.

### AuctionNinja

1. Page mode:
   - `/auctions` is auction-search triage.
   - `/items-won` is account won-items organization.
   - `/{seller}/sales/details/{sale}.html` is sale catalog research.
   - `/{seller}/product/{item}.html` is item detail research.
2. Sale context:
   - Extract title, seller, location, shipping/pickup text, special instructions, buyer premium, closing time, canonical URL.
   - Include sale terms before lots in the LLM brief so profit math sees premium/logistics first.
3. Catalog cards:
   - Prefer DOM hooks: `.search-catalog-item-box`, `.search-catalog-item-box-in`, `[id^="MainItmID"]`, `.hot-items-box`.
   - Normalize lot number, product URL/id, title, image, current bid, bid count when explicit, time left, closed/watched state.
   - Never retain `Bid Now` as an action or button reference.
4. Guarded loading:
   - Parse count text such as `1-40 of 60 items`.
   - Prefer catalog pagination URLs such as `?Page=2#items`, fetch them in the background, parse with `DOMParser`, and merge lots without taking over the visible tab.
   - Keep safe page/next control clicks as last-resort fallback only; reject bid, checkout, invoice, payment, account, watch/follow, search, sort, and per-page controls.
   - Stop with a debug reason when counts drift, no safe next control exists, or max steps are reached.

## Max Plan State

- Store max plans per auction when possible: `flipperaddon-max-plan-v2:<host>:auction:<id>`.
- Store AuctionNinja plans by sale/item/page: `flipperaddon-max-plan-v2:www.auctionninja.com:auctionninja:sale:<id>`.
- Migrate from legacy `hibid-bid-assistant-plan-v1` on first read.
- `max: null` means saved but not eligible.
- Assistant rows expose Add/Save Plan first. Direct page-card injection is a future task.

## Debugging

- Debug boolean key: `flipperaddon-debug-enabled-v1`.
- Debug log key: `flipperaddon-debug-log-v1`.
- Prefix: `[FlipperAddon]`.
- Menu commands:
  - `Remount FlipperAddon`
  - `Toggle FlipperAddon Debug Mode`
  - `Copy FlipperAddon Debug Log`
  - `Clear FlipperAddon Debug Log`
  - `Copy HiBid Lots Now`

Debug UI and console/log capture are off unless debug mode is enabled.

## Issue Tracker

- Done: rename active script/UI/menu/debug prefix to FlipperAddon by ALOS.
- Done: keep hosted raw update/download URL unchanged.
- Done: add active page module resolver.
- Done: make drawer render catalog/live/FlipTracker modules independently.
- Done: start drawer minimized on every mount.
- Done: gate debug UI/logging behind addon debug boolean.
- Done: add per-auction max-plan storage and legacy migration.
- Done: add assistant-row Add/Save Plan affordance.
- Done: include the full auction-resale coordinator prompt in LLM brief.
- Done: include enriched lot fields in LLM brief JSON.
- Done: make legacy max-plan migration one-time so old global plans do not leak into future auctions.
- Done: rebuild/remove the drawer when same-tab navigation changes modules or reaches an unsupported route.
- Done: replace an old pre-FlipperAddon panel if the renamed script is installed alongside the old script during migration.
- Done: add AuctionNinja route resolver and safe mount gates.
- Done: add AuctionNinja sale catalog parser for terms, catalog count, and lot cards.
- Done: add AuctionNinja drawer module with research-only controls.
- Done: add AuctionNinja JSON and LLM brief export with sale terms ahead of lot data.
- Done: add tests for AuctionNinja routes, blocked account pages, range parsing, sale context, lot parsing, and active-mode UI.
- Done: Waterfox verified AuctionNinja sale catalog drawer on `v0.7.1`, copied LLM brief for `106/106` lots, and confirmed page scrolling still works under the drawer.
- Pending future: inject Add to Max Plan near HiBid watch controls on page cards.
- Pending future: AuctionNinja auction-search triage module.
- Pending future: AuctionNinja items-won inventory/reconciliation module.
- Pending future: AuctionNinja item-detail enrichment fetches for descriptions when catalog cards are thin.
- Pending future: richer visual max-plan table editing beyond inline row saves and raw JSON.

## Verification Checklist

- `node --check .\hibid-bid-assistant.user.js`
- `node --check .\hibid-lot-catalog-scraper.user.js`
- `npm test`
- Waterfox manual checks:
  - Confirm only the current hosted FlipperAddon script is enabled.
  - Open `https://hibid.com/newjersey/lots/40196/computers-and-electronics`.
  - Open `https://hibid.com/livecatalog/752334/the-luxe-edit`.
  - Open eBay/Facebook active selling pages.
  - Open `https://www.auctionninja.com/clearinghouseestatesales/sales/details/a-glamorous-upper-west-side-brownstone-with-interiors-by-jonathan-adler-holly-hunt-lorin-marsh-restoration-hardware-arteriors-lighting-and-so-much-more-new-york-ny-referred-shipping-and-delivery-available--17395.html?an=20260709202533`.
  - Capture full-window screenshots showing the page and bottom-right launcher/drawer.
  - Confirm each page exposes only its active module.
  - Confirm scrolling, filters, lot links, watch buttons, and bid buttons still work when not actively scraping.
  - For AuctionNinja, confirm the drawer never exposes or clicks bid/checkout/payment/invoice actions.

## Known Pitfalls

- `@match https://hibid.com/*` injects broadly, so `resolveAssistantMode()` and `shouldInitOnLocation()` are the real gates.
- Waterfox/Tampermonkey Content Script API mode affects injection timing; keep mounting idempotent and callable from menu.
- Seller subdomains may lack `#hibid-state`; fallback DOM/network-observed behavior matters there.
- Closed catalog price realized text is auction result data, not an eBay sold comp.
- AuctionNinja catalogs can change while closing; `1-40 of N` may drift. Treat drift as a debug-visible stop reason, not a silent success.
- Do not treat "opened the page" as verification. Verification means observed UI plus route/debug/count evidence.
