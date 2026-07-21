# FlipperAddon by ALOS

Hosted Tampermonkey userscript for resale scraping/export workflows across HiBid, GovDeals, AAR Auctions, AuctionNinja, eBay selling pages, and Facebook Marketplace selling pages.

Current hosted build: `v0.7.57`. The panel exposes its build through `data-flipperaddon-version` and `window.__FLIPPERADDON_VERSION__`; use those markers to confirm a browser is not running a stale Tampermonkey copy. A newer build remounts over an older panel, rebuilds after same-mode SPA URL changes, and removes the legacy `hibid-bid-assistant-panel` so an old enabled script cannot sit above the current UI. AAR `Search.do?auctionId=...&itemId=...` pages use the single-item export path, while filtered HiBid state over-counts fall back to visible DOM tiles. `v0.7.57` also waits for HiBid URL normalization to settle and forwards a copy click to the remounted panel instead of losing it.

## Install

Open the unified addon URL in a browser with Tampermonkey enabled:

https://raw.githubusercontent.com/AshbyCollado/hibid-userscripts/main/hibid-bid-assistant.user.js

Tampermonkey updates use that same raw GitHub URL through the script metadata. Install from the raw URL, not a one-off copied file, so future version bumps can update.

## Active Modules

`FlipperAddon by ALOS` is the single active hosted script. It starts minimized in the bottom-right corner and shows only the module for the page you are actually on:

- HiBid catalog/category/watchlist/current-bids pages: copy JSON and resale LLM brief, including OUTBID watchlist and WINNING/OUTBID current bids.
- HiBid livecatalog pages: expand/copy live lot JSON and resale LLM brief.
- AuctionNinja sale catalog pages: copy sale terms plus lot JSON or resale LLM brief.
- AuctionNinja category pages such as `/category/electronics?miles=30&zip=07008`: copy the visible product-card JSON or a location-filtered resale LLM brief; safe `View All Items` pages are fetched in the background when available.
- AuctionNinja followed-items, items-won, and bid-history pages: copy account item JSON or page-specific LLM briefs for watchlist triage, won-item inventory planning, or bid-history review.
- AuctionNinja auction search / nearby sales pages: copy whole-auction JSON or an LLM brief that ranks sales before drilling into lots.
- AAR Auctions calendar and catalog pages: copy auction cards or catalog lots as JSON, or copy an LLM brief with persisted origin/radius distance-verification instructions.
- GovDeals seller, search/new-listings filter, and asset pages: copy visible listings/assets as JSON, or copy a resale LLM brief with shared origin/radius and URL zipcode/miles context.
- eBay/Facebook selling pages: FlipTracker active listing copy/download export.

The older `hibid-lot-catalog-scraper.user.js` remains in the repo for legacy reference/tests, but normal use should install only `hibid-bid-assistant.user.js`.

## LLM Brief

Copy LLM Brief includes the full auction-resale coordinator prompt plus enriched lot JSON. The prompt tells the model to prioritize eBay sold/completed comps, calculate profit after buyer premium, tax, eBay fees, promoted listing friction, travel, shipping, and sedan-fit risk.

AAR and GovDeals LLM briefs also include a `Distance Agent` instruction. The default shared research setting is `Edison, NJ 08817` with a `100` mile radius. GovDeals search/new-listings exports also preserve URL filters such as `categoryName=Consumer Electronics`, `zipcode=07008`, and `miles=25`.

## Debug

Debug UI and console/log capture are hidden until enabled from the Tampermonkey menu command:

`Toggle FlipperAddon Debug Mode`

When enabled, the drawer exposes copy/clear debug controls. Logs use the `[FlipperAddon]` prefix.

When an export is rejected, the current build reports the specific guard reason (for example, incomplete scrape, active-filter mismatch, or wrong route) instead of the generic legacy stale-export message. If another computer still shows the old comma-form error wording, update/reinstall the raw GitHub script there before diagnosing page data.

## FlipTracker Active Listing Export

Open an active selling page:

- `https://www.ebay.com/sh/lst/active`
- `https://www.facebook.com/marketplace/you/selling`

Workflow:

1. Scroll/load the listings you want included.
2. Open FlipperAddon.
3. Click `Scan Listings`.
4. Click `Download`.
5. Put the downloaded `FlipTracker-listings-*.html` file into `C:\Users\ashby\Documents\MarketplaceScraper\ImportInbox`.
6. In FlipTracker, run the import/review flow.

## Scraper-First UI

FlipperAddon starts as a small bottom-right pill. Opening it shows only the current page's export actions. Copy buttons do not render lot previews in the drawer; they copy the payload and show a short toast. The Stop button appears while a scrape/export is running.

## Tests

```powershell
node --check .\hibid-bid-assistant.user.js
node --check .\hibid-lot-catalog-scraper.user.js
npm test
```

## Browser Verification

The source-level smoke matrix covers the supported HiBid, AJ Willner, AuctionNinja, AAR Auctions, GovDeals, eBay, and Facebook routes. A browser is only considered verified after the active page exposes `#flipperaddon-panel`, the panel version is `0.7.57`, and a page-appropriate JSON/LLM copy action completes. Tampermonkey must be installed separately in each browser profile; updating Waterfox does not update Chrome or Firefox.
