# FlipperAddon Brain

Living issue tracker and architecture notes for `hibid-bid-assistant.user.js`.

## Current Product

- Name: `FlipperAddon by ALOS`.
- Active hosted install: `hibid-bid-assistant.user.js`.
- Raw install/update URL: `https://raw.githubusercontent.com/AshbyCollado/hibid-userscripts/main/hibid-bid-assistant.user.js`.
- Current version: `0.7.46`.
- UI: small bottom-right minimized launcher plus compact dark drawer. It starts minimized every mount.
- Principle: only the module for the current page exposes controls.
- Current product stance: scraper/export first. No active UI path clicks bids, writes bid fields, confirms modals, or manages max-plan bidding.

## Module Map

- `catalog`: HiBid catalog/category/lot/OUTBID watchlist and AJ Willner auction pages.
  - Controls: Copy LLM Brief, Copy JSON, Stop while scraping, debug controls only when enabled.
- `live`: HiBid `/livecatalog/...` pages.
  - Controls: Copy LLM Brief, Copy JSON, Stop while scraping, debug controls only when enabled.
- `fliptracker`: eBay and Facebook active selling pages.
  - Controls: Scan Listings, Copy HTML, Download, debug controls only when enabled.
- `auctionninja`: AuctionNinja sale research and account export pages.
  - Sale catalog controls: Copy LLM Brief, Copy JSON, Stop while scraping, debug controls only when enabled.
  - Auction search controls: Copy Auctions LLM, Copy JSON, Stop while scraping, debug controls only when enabled.
  - Followed-items controls: Copy Watchlist LLM, Copy JSON, Stop while scraping, debug controls only when enabled.
  - Items-won controls: Copy Won Items LLM, Copy JSON, Stop while scraping, debug controls only when enabled.
  - Bid-history controls: Copy Bid History LLM, Copy JSON, Stop while scraping, debug controls only when enabled.
  - Safety: research/export only; no bid clicks, no bid-field writes, no checkout/invoice/payment/account actions.
- `aar`: AAR Auctions calendar and catalog export pages.
  - Auction calendar controls: Copy Auctions LLM, Copy JSON, Stop while scraping, debug controls only when enabled.
  - Catalog controls: Copy Catalog LLM, Copy JSON, Stop while scraping, debug controls only when enabled.
  - Research settings: collapsed origin/radius editor persisted under `flipperaddon-aar-research-settings-v1`, default `Edison, NJ 08817` and `100` miles.
  - Safety: research/export only; no bid, register, payment, invoice, login, or account actions.
- `govdeals`: GovDeals seller, search/new-listings filter, and asset export pages.
  - Seller controls: Copy Seller LLM, Copy JSON, Stop while scraping, debug controls only when enabled.
  - New-listings controls: Copy Listings LLM, Copy JSON, Stop while scraping, debug controls only when enabled.
  - Asset controls: Copy Asset LLM, Copy JSON, Stop while scraping, debug controls only when enabled.
  - Distance context: reuses shared persisted origin/radius defaults and preserves GovDeals URL zipcode/miles filters.
  - Safety: research/export only; no bid, offer, cart, checkout, payment, registration, login, invoice, or account actions.
- `unsupported`: do not mount.

## Route Map

Mount without waiting for lot tiles on:

- `https://hibid.com/lots*`
- `https://hibid.com/*/lots*`, including `/newjersey/lots/40196/computers-and-electronics`
- `https://hibid.com/catalog/*`
- `https://hibid.com/livecatalog/*`
- `https://hibid.com/lot/*`
- `https://hibid.com/*/lot/*`
- `https://hibid.com/account/watchlist*`, including state-prefixed `/newjersey/account/watchlist`
- `https://hibid.com/account/currentbids?status=WINNING`, including state-prefixed routes
- `https://hibid.com/account/currentbids?status=OUTBID`, including state-prefixed routes
- `https://*.hibid.com/catalog/*`
- `https://*.hibid.com/lot/*`
- `https://*.hibid.com/account/watchlist?status=OUTBID`
- `https://bid.ajwillnerauctions.com/ui/auctions/*`
- `https://www.ebay.com/sh/lst*`
- `https://www.ebay.com/mys/*`
- `https://www.facebook.com/marketplace/you/*`
- `https://www.facebook.com/marketplace/profile/*`
- `https://www.auctionninja.com/auctions*`
- `https://www.auctionninja.com/{state}/{city}/{zip}*`, including `/nj/carteret/07008?miles=50&an=`
- `https://www.auctionninja.com/followed-items*`
- `https://www.auctionninja.com/items-won*`
- `https://www.auctionninja.com/bid-history*`
- `https://www.auctionninja.com/*/sales/details/*.html*`
- `https://www.auctionninja.com/*/product/*.html*`
- `https://aarauctions.com/auctions*`
- `https://aarauctions.com/servlet/Search.do?auctionId=*`
- `https://www.govdeals.com/en/{seller}`
- `https://www.govdeals.com/en/search*`
- `https://www.govdeals.com/en/search/filters*`
- `https://www.govdeals.com/en/new-listings/filters*`
- `https://www.govdeals.com/en/asset/{assetId}/{accountId}`
- `https://www.govdeals.com/asset/{assetId}/{accountId}`

Do not mount on generic HiBid account/help/search pages unless a resolver case is added and tested.
Do not mount on AuctionNinja billing, payment, card, checkout, invoice, profile/settings, support, login/logout, or generic account pages.
Do not mount on AAR login, register, account, payment, invoice, checkout, or bid routes.
Do not mount on GovDeals login, register, account, cart, checkout, payment, invoice, bid, or offer routes.

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

### AJ Willner

1. Route/source:
   - `https://bid.ajwillnerauctions.com/ui/auctions/*` mounts as `catalog` mode with source `ajwillner`, not HiBid.
   - The compact drawer labels the active module as `AJ Willner` and reuses the same `Copy LLM Brief` / `Copy JSON` controls.
2. Virtual-list scraper:
   - The lot grid is virtualized; use `[data-testid="auction-list-scroll"]` first, then `.ReactVirtualized__Grid`, then the largest scrollable `div`.
   - Visible lot cards are `[data-testid^="list-item-"]`, filtered to exact IDs like `list-item-24887841` so status stripes are not mistaken for cards.
   - Extract title/lot from `.titleLink h1`, URL from `.titleLink[href]`, description from `.description`, bid from `.bidsLine`, status from the matching `*-status-stripe`, and image from `img`/`srcset`.
   - Scroll the virtual container with an overlapping capped stride, merge by URL/id/lot, and stop when the parsed `866 items found` style total is reached or the virtual list stops producing new cards.

### AuctionNinja

1. Page mode:
   - `/auctions` is auction-search triage.
   - `/{state}/{city}/{zip}` is location/nearby auction-search triage.
   - `/followed-items` is account followed/watchlist opportunity review.
   - `/items-won` is account won-items organization.
   - `/bid-history` is account bid-history review.
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
5. Account exports:
   - `/followed-items` reads visible dashboard item rows/cards and exports source, page kind, lot, title, item URL, image, sale title/URL, status, current price text/amount, bid count, time text, location, pickup/shipping hints, and raw text.
   - `/items-won` reads visible dashboard item rows/cards and exports the same shared fields, using won/price-realized text when present.
   - `/bid-history` reads visible dashboard bid-history rows/cards and exports the same shared fields plus `yourBidText` / `yourBid` when visible.
   - Account exports are copy-only; they do not click dashboard controls or mutate watched/won items.
   - Followed LLM briefs focus on active opportunity review, current bid versus profit threshold, sold comps first, and logistics risk.
   - Won-items LLM briefs focus on post-win inventory, listing priority, expected resale, pickup/shipping logistics, profitability after buyer premium/tax, and reconciliation.
   - Bid-history LLM briefs focus on missed opportunities, overbid risk, recurring seller/category signals, and whether past max bids matched sold comps and profit thresholds.
6. Auction search exports:
   - Nearby/search pages read whole sale rows, not lots: sale title/URL, seller/URL, image, location, pickup/shipping, closing time, item count, and raw text.
   - Some AuctionNinja search rows use the sale URL for count-only anchors like `(9)` before or instead of a readable title link; treat those as URL-only and recover the title from line-preserved card text.
   - Prefer background fetches from discovered `marketplace_ajax.php?Page=...` pagination controls; merge sale rows by URL/title and avoid visible-tab clicks unless future guarded fallback is added.
   - Auction-search LLM briefs rank whole sales for resale potential before drilling into lot catalogs.

### AAR Auctions

1. Page mode:
   - `/auctions/` is auction-calendar triage.
   - `/servlet/Search.do?auctionId=...` is auction catalog export.
2. Auction calendar:
   - Extract auction ID, title, category, catalog URL, image, closing text, description, register URL, location hint, and a Google Maps search seed from auction cards.
   - LLM briefs rank whole auctions before drilling into catalogs.
3. Catalog:
   - Extract title, auction ID, buyer premium, pickup text, payment text, item location, directions/map seed, and expected total from server-rendered page text.
   - Extract lot number, title, URL, image, description, high/current bid, minimum next bid, quantity, auction type, closing text, and raw text from visible lot rows.
   - Discover same-auction safe pagination/search URLs when present; reject bid, register, track, login, payment, invoice, and checkout links.
4. Distance research:
   - The addon does not geocode in-page. It persists origin/radius config and includes it in every AAR JSON/LLM export.
   - AAR LLM briefs include a required `Distance Agent` instruction to verify distance with live map/search results, not assumptions.
   - Spreadsheet output must include `distance_miles`, `distance_proof_url`, `distance_status`, and `assigned_agent`.

### GovDeals

1. Page mode:
   - `/en/{seller}` is seller/storefront listing export, for example `/en/rutgers`.
   - `/en/search?...`, `/en/search/filters?...`, and `/en/new-listings/filters?...` are nearby listing exports and preserve URL `category`, `categoryName`, `zipcode`, and `miles`.
   - `/en/asset/{assetId}/{accountId}` and `/asset/{assetId}/{accountId}` are direct asset export/enrichment routes.
2. Listings:
   - Extract asset ID/account ID, lot number, title, URL, image, seller, category, condition/status, current bid, bid count, close time, location, distance text, pickup/shipping hints, description/specs when visible, and raw text.
   - Use visible DOM first. If fields are thin and browser fetch/DOMParser is available, fetch same-origin asset detail pages only for missing fields, capped and stoppable.
3. Briefs:
   - Reuse the full resale coordinator prompt.
   - Include GovDeals safety boundary and shared origin/radius settings.
   - Require live map/search proof before recommending a listing as in range.
   - Spreadsheet output must include `distance_miles`, `distance_proof_url`, `distance_status`, and `assigned_agent`.
4. Asset detail DOM fix (`v0.7.44`):
   - Prefer the item-scoped DOM hooks `h1.product-title`, `#currentBid`, `.numberofbids`, `.product-location`, `.long-description`, `#table-id-0`, `#seller_information`, and `img.lg-object.lg-image`.
   - Never use the first page image or first `/en/` link as the asset image/seller; those are often global logos/navigation such as AllSurplus and About Us.
   - Normalized description, specs, seller, location, close time, pickup, and image fields are extracted from the asset section. The broad body is only a fallback for sparse/legacy markup.
   - Verification targets: `/en/asset/72/6332` and `/en/asset/6816/7529`; expected one-record exports with item photos, correct seller/location, clean close text, and description-only component/spec values.

5. Filtered `/lots` fix (`v0.7.45`):
   - Accept HiBid totals formatted as `Showing 1 - 15 of 15 lots`, not only `Showing 1 to 15 of 15 lots`.
   - Preserve repeated `status` values and location/delivery query filters in visible-page diagnostics.
   - Accept an Apollo `eventItemIds` connection only when its visible result count and page length confirm the filtered page total; broad mismatched connections remain rejected.

6. Visible-state fix (`v0.7.46`):
   - Use `innerText` before `textContent` for page-level HiBid totals and no-match detection. HiBid keeps hidden empty-state templates in the DOM on non-empty filtered pages; hidden `No matches found` text must not turn a real result set into `[]`.

## Legacy Max Plan State

- Old max-plan data remains in storage for compatibility and tests, but scraper-first UI does not render or use max-plan controls.
- Historical storage keys include `flipperaddon-max-plan-v2:<host>:auction:<id>` and `flipperaddon-max-plan-v2:www.auctionninja.com:auctionninja:sale:<id>`.
- Migrate from legacy `hibid-bid-assistant-plan-v1` on first read.

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
- Done: prior Waterfox verified AuctionNinja sale catalog drawer, copied LLM brief for `106/106` lots, and confirmed page scrolling still works under the drawer.
- Done: `v0.7.2` scraper-first cleanup removes bid watcher/max-plan UI, result previews, and bulky minimized launcher copy.
- Done: `v0.7.3` fixes AuctionNinja exports opened mid-catalog so page 1 is backfilled and full sale counts can be copied.
- Done: `v0.7.4` adds AuctionNinja `/followed-items` and `/items-won` account export modules with JSON and LLM briefs.
- Done: `v0.7.5` tightens AuctionNinja account card detection after Waterfox showed dashboard tabs being copied as items.
- Done: `v0.7.6` infers AuctionNinja account titles when product anchors are image-only/empty and avoids treating model years like `1950s` as countdown text.
- Done: `v0.7.7` adds AuctionNinja `/bid-history` account export and auction-search/nearby-sales export for whole-auction triage.
- Done: `v0.7.8` fixes AuctionNinja auction-search title selection when cards repeat sale links for image/count/title targets.
- Done: `v0.7.9` adds explicit AuctionNinja account/search match metadata and a window-load remount retry for account dashboard reliability.
- Done: `v0.7.10` gives FlipperAddon a unique panel ID so stale enabled assistant copies cannot remove the current UI.
- Done: `v0.7.11` recovers AuctionNinja auction-search sale titles when the only sale-details anchor text is a count marker such as `(9)`.
- Done: `v0.7.12` exposes the boot canary on `unsafeWindow` so Selenium/page-context checks can confirm `window.__HIBID_UNIFIED_ASSISTANT_ACTIVE__ === true`.
- Done: `v0.7.16` adds AAR Auctions calendar/catalog scraper exports with persisted origin/radius research settings and distance-agent LLM briefs.
- Done: `v0.7.17` adds GovDeals seller, new-listings, and asset exports with safe asset-detail enrichment and distance-aware LLM briefs.
- Done: `v0.7.18` tightens GovDeals real-grid parsing: browser URL filters, compact card fields, visible result counts, and carousel trimming.
- Done: `v0.7.32` adds HiBid `/account/currentbids?status=WINNING` and `/account/currentbids?status=OUTBID` as scraper-only account exports, including line-anchored account-card parsing for `Price Realized` / `Won` rows and a DOM-only current-bids path that does not get blocked by catalog expected-count guards, `/ Lot` unit text, or broad catalog state.
- Done: `v0.7.34` adds GovDeals `/en/search?...` direct query routes, preserves category filters, and updates the GovDeals site switcher shortcut to Consumer Electronics near 07008 within 25 miles.
- Done: `v0.7.35` constrains the compact drawer to the viewport and scrolls the body so copy buttons cannot fall below the visible screen on GovDeals/Waterfox.
- Done: `v0.7.36` hooks GovDeals direct-search `.card-search` grids and reports visible-page exports honestly so page-one cards copy instead of being blocked as stale/incomplete.
- Done: `v0.7.37` points the GovDeals hotlink to the requested location-search route: `/en/search/filters?zipcode=07008&miles=50&showMap=0&source=location-search`.
- Done: `v0.7.38` refreshes GovDeals ready-state counts after hydration so the compact drawer does not stay at an early `Visible 0` scan.
- Done: `v0.7.39` makes AJ Willner catalog exports API-first through `/api/items/search` pages before the old virtual-scroll fallback, trims repeated sale terms from API descriptions, and downloads the export if the browser blocks the clipboard after a completed scrape.
- Done: `v0.7.40` relabels the AJ Willner module chip from `virtual list` to `api-first` so the UI matches the fast scraper path.
- Done: `v0.7.41` adds a shared mandatory mixed/group-lot component review rule to every Copy LLM brief and preserves descriptions, image URLs, and raw text on DOM fallback records where the page exposes them.
- Done: `v0.7.42` recognizes state-prefixed HiBid account watchlist/current-bids routes such as `/newjersey/account/watchlist` and keeps them on the DOM-only account export path.
- Done: `v0.7.43` makes the minimized launcher show the full `FlipperAddon by ALOS` name, widens it to 228px, and hides the close control until the drawer is expanded.
- Verified in Waterfox on `v0.7.43`: representative HiBid, AJ Willner, eBay, Facebook, AuctionNinja, AAR, and GovDeals routes mount the expected module controls; the supplied `/livecatalog/752334/the-luxe-edit` target redirects to `/catalog/752334` because that auction is past, so it correctly presents catalog controls after the server redirect.
- Done: `v0.7.19` tightens GovDeals seller pages: `Search Results` counts, sellerName context, and possessive-title compact card parsing.
- Pending future: AuctionNinja item-detail enrichment fetches for descriptions when catalog cards are thin.

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
  - Open `https://www.auctionninja.com/followed-items?an=b7k7t5kpfyo`.
  - Open `https://www.auctionninja.com/items-won?an=hwfmhr2h2qi`.
  - Open `https://www.auctionninja.com/bid-history?an=sp2i8ac5q0n`.
  - Open `https://www.auctionninja.com/nj/carteret/07008?miles=50&an=`.
  - Open `https://aarauctions.com/auctions/`.
  - Open `https://aarauctions.com/servlet/Search.do?auctionId=8563`.
  - Open `https://www.govdeals.com/en/rutgers`.
  - Open `https://www.govdeals.com/en/new-listings/filters?zipcode=07008&miles=25`.
  - Capture full-window screenshots showing the page and bottom-right launcher/drawer.
  - Confirm each page exposes only its active module.
  - Confirm scrolling, filters, lot links, watch buttons, and bid buttons still work when not actively scraping.
  - For AuctionNinja, confirm sale, followed, and won pages never expose or click bid/checkout/payment/invoice/account mutation actions.
  - For AAR Auctions, confirm the drawer shows only calendar/catalog copy controls, research settings persist, and bid/register/payment routes do not mount.
  - For GovDeals, confirm seller/new-listings/asset pages expose only copy controls and do not click bid, offer, cart, checkout, payment, login, registration, or account controls.

## Known Pitfalls

- `@match https://hibid.com/*` injects broadly, so `resolveAssistantMode()` and `shouldInitOnLocation()` are the real gates.
- Waterfox/Tampermonkey Content Script API mode affects injection timing; keep mounting idempotent and callable from menu.
- Seller subdomains may lack `#hibid-state`; fallback DOM/network-observed behavior matters there.
- Closed catalog price realized text is auction result data, not an eBay sold comp.
- AuctionNinja catalogs can change while closing; `1-40 of N` may drift. Treat drift as a debug-visible stop reason, not a silent success.
- AAR calendar cards are WordPress/Divi HTML, while catalogs are servlet-rendered tables/text; keep route-specific parsers instead of trying to reuse HiBid or AuctionNinja selectors.
- GovDeals can block simple HTTP clients; verify from the real browser context and prefer in-page DOM/network observation over raw fetch tooling.
- Do not treat "opened the page" as verification. Verification means observed UI plus route/debug/count evidence.
