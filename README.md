# FlipperAddon by ALOS

Hosted Tampermonkey userscript for resale scraping/export workflows across HiBid, GovDeals, AAR Auctions, AuctionNinja, eBay selling pages, and Facebook Marketplace selling pages.

Current hosted build: `v0.8.15`. The panel exposes its build through `data-flipperaddon-version` and `window.__FLIPPERADDON_VERSION__`; use those markers to confirm a browser is not running a stale Tampermonkey copy. A newer build remounts over an older panel, rebuilds after same-mode SPA URL changes, and removes the legacy `hibid-bid-assistant-panel` so an old enabled script cannot sit above the current UI. AAR `Search.do?auctionId=...&itemId=...` pages use the single-item export path, while filtered HiBid state over-counts fall back to visible DOM tiles. `v0.8.15` fixes selected HiBid past-auction exports on the real account DOM, where multiple auction headers share one lot grid; the clicked header now scopes extraction to its following tiles only. It retains the filtered HiBid export guards, same-origin paginated DOM pages, selected-auction exports on HiBid past-bids and past-watchlist account pages, and explicit account-route metadata.

## Install

Open the unified addon URL in a browser with Tampermonkey enabled:

https://raw.githubusercontent.com/AshbyCollado/hibid-userscripts/main/hibid-bid-assistant.user.js

Tampermonkey updates use that same raw GitHub URL through the script metadata. Install from the raw URL, not a one-off copied file, so future version bumps can update.

## Active Modules

`FlipperAddon by ALOS` is the single active hosted script. It starts minimized in the bottom-right corner and shows only the module for the page you are actually on:

- HiBid catalog/category/watchlist/current-bids pages: copy JSON and resale LLM brief, including OUTBID watchlist and WINNING/OUTBID current bids.
- HiBid `/account/pastbidsm` and `/account/pastwatchlist`: use the inline `Copy Auction` button beside a selected `View Catalog` row. It copies only that auction group's saved account lots, enriches their lead/category/full descriptions/photos, and never sweeps unrelated account rows.
- HiBid livecatalog pages: expand/copy live lot JSON and resale LLM brief.
- AuctionNinja sale catalog pages: copy sale terms plus lot JSON or resale LLM brief.
- AuctionNinja category pages such as `/category/electronics?miles=30&zip=07008`: copy the visible product-card JSON or a location-filtered resale LLM brief; safe `View All Items` pages are fetched in the background when available.
- AuctionNinja followed-items, items-won, and bid-history pages: copy account item JSON or page-specific LLM briefs for watchlist triage, won-item inventory planning, or bid-history review.
- AuctionNinja auction search / nearby sales pages: copy whole-auction JSON or an LLM brief that ranks sales before drilling into lots.
- AAR Auctions calendar and catalog pages: copy auction cards or catalog lots as JSON, or copy an LLM brief with persisted origin/radius distance-verification instructions.
- GovDeals seller, search/new-listings filter, and asset pages: copy visible listings/assets as JSON, or copy a resale LLM brief with shared origin/radius and URL zipcode/miles context.
- eBay Seller Hub/Facebook selling pages: FlipTracker active listing copy/download export.
- eBay `/bulksell` revise-listings pages: copy normalized JSON or an LLM brief containing each visible title and full row-level listing fields; HTML/Download remain available for FlipTracker import.

The older `hibid-lot-catalog-scraper.user.js` remains in the repo for legacy reference/tests, but normal use should install only `hibid-bid-assistant.user.js`.

## LLM Brief

Copy LLM Brief includes the full auction-resale coordinator prompt plus enriched lot JSON. The prompt requires visible exact or close eBay sold proof for populated resale estimates, separate `profit_if_won_now` and `profit_at_recommended_max_bid` calculations, clickable item/sold URLs, and workbook sorting/formatting rules.

AAR and GovDeals LLM briefs also include a `Distance Agent` instruction. Expand `Research Settings` on either module to edit the persisted origin/ZIP, radius, sales-tax assumption, vehicle/logistics profile, and extra research notes. The first-run shared defaults are `Edison, NJ 08817`, `100` miles, `6.625%`, and `CT200h sedan`. GovDeals search/new-listings exports also preserve URL filters such as `categoryName=Consumer Electronics`, `zipcode=07008`, and `miles=25`.

## Debug

Debug UI and console/log capture are hidden until enabled from the Tampermonkey menu command:

`Toggle FlipperAddon Debug Mode [OFF]` (the label changes to `[ON]` after enabling it)

When enabled, the drawer exposes copy/clear debug controls. Logs use the `[FlipperAddon]` prefix.

`#flipperdebug` enables the same diagnostic layer when Tampermonkey menu commands are unavailable. After reproducing a failure, click `Copy Debug` once and wait for the toast, or use `Download Debug`. The exported log should contain `event:ui.click`, `event:debug.control.handler.enter`, `event:debug-download.*` or `event:debug-export.*`, and `event:debug.control.result`. The debug action always refreshes and reveals the selectable log field. Initialization failures are recorded as `panel.init.error`. It does not record raw typed field values.

When an export is rejected, the current build reports the specific guard reason (for example, incomplete scrape, active-filter mismatch, or wrong route) instead of the generic legacy stale-export message. If another computer still shows the old comma-form error wording, update/reinstall the raw GitHub script there before diagnosing page data.

If Tampermonkey hides the script commands, append `#flipperdebug` to the active page URL and reload. The drawer will expose `Copy Debug` and `Download Debug`; use `Download Debug` or copy the selected text field after reproducing the problem. If clipboard access fails, `Copy Debug` downloads `flipperaddon-debug-*.txt` automatically. Remove the hash and reload to turn the bootstrap mode off.

## FlipTracker Active Listing Export

Open an active selling page:

- `https://www.ebay.com/sh/lst/active`
- `https://www.facebook.com/marketplace/you/selling`

For eBay's bulk revise page, open `https://www.ebay.com/bulksell?...` and use `Copy JSON` or `Copy LLM Brief` to capture the visible listing rows, including the title, image, price, quantity, format, duration, shipping, handling, condition, category, recommendations, and raw row fields.

Workflow:

1. Scroll/load the listings you want included.
2. Open FlipperAddon.
3. Click `Scan Listings`.
4. Click `Download`.
5. Put the downloaded `FlipTracker-listings-*.html` file into `C:\Users\ashby\Documents\MarketplaceScraper\ImportInbox`.
6. In FlipTracker, run the import/review flow.

## eBay to Facebook Marketplace Drafts

This workflow keeps eBay as the listing source and fills one reviewable Facebook Marketplace draft. FlipperAddon never clicks Publish.

One-time connection:

1. Open `FlipTracker.xlsm` from the MarketplaceScraper project folder and enable macros.
2. On `Import Review`, click `Start eBay Sync`, then `Copy Sync Token`.
3. On a supported eBay or Facebook page, open FlipperAddon, click `Connect`, and paste the token. The token stays in Tampermonkey storage and the bridge listens only on `127.0.0.1:8468`.

Create a draft:

1. Open `https://www.ebay.com/mys/active` or `https://www.ebay.com/sh/lst/active` and load the active listings you need.
2. Open FlipperAddon and click `Scan Page`.
3. Choose the eBay listing under `Facebook draft source`, verify the Facebook location, and click `Queue Facebook Draft`.
4. Review the confirmation. FlipperAddon enriches the listing from its public eBay item page before queueing it.
5. Open `https://www.facebook.com/marketplace/create/item`.
6. Open FlipperAddon and click `Fill Next eBay Draft`.
7. Review the title, whole-dollar price, description, category, condition, location, and photos. Continue through Facebook and click Publish yourself only when the listing is correct.
8. After Facebook opens the new Marketplace item page, open FlipperAddon and click `Confirm Published`. This stores the Facebook listing ID and prevents that eBay item from being queued again.

Duplicate and recovery rules:

- One durable queue record exists per eBay item ID.
- Requeueing unchanged eBay evidence is a no-op.
- Changed eBay evidence updates the existing unpublished queue record.
- A confirmed Published record cannot be queued again unless it is explicitly reset in the local queue.
- A failed form fill stays visible as Failed; queue the eBay item again after correcting the cause.
- If `Connect` reports a bridge error, reopen FlipTracker and use `Start eBay Sync`, then copy and save the token again.
- Do not confirm Published from an unrelated Facebook item page; FlipperAddon checks both the Marketplace listing ID and title evidence.

## Scraper-First UI

FlipperAddon starts as a small bottom-right pill. Opening it shows only the current page's export actions. Copy buttons do not render lot previews in the drawer; they copy the payload and show a short toast. The Stop button appears while a scrape/export is running.

## Tests

```powershell
node --check .\hibid-bid-assistant.user.js
node --check .\hibid-lot-catalog-scraper.user.js
npm test
```

## Browser Verification

The source-level smoke matrix covers the supported HiBid, AJ Willner, AuctionNinja, AAR Auctions, GovDeals, eBay, and Facebook routes. A browser is only considered verified after the active page exposes `#flipperaddon-panel`, the panel version matches the hosted build (`0.8.14` at this release), and a page-appropriate JSON/LLM copy action completes. Tampermonkey must be installed separately in each browser profile; updating Waterfox does not update Chrome or Firefox. The Chrome audit confirmed that site navigation works but the selected Chrome profile was not executing the hosted script, so Chrome is not counted as verified until the hosted script is reinstalled or updated there from `https://raw.githubusercontent.com/AshbyCollado/hibid-userscripts/main/hibid-bid-assistant.user.js`.
