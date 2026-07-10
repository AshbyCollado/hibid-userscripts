# FlipperAddon by ALOS

Hosted Tampermonkey userscript for resale scraping/export workflows across HiBid, AuctionNinja, eBay selling pages, and Facebook Marketplace selling pages.

## Install

Open the unified addon URL in a browser with Tampermonkey enabled:

https://raw.githubusercontent.com/AshbyCollado/hibid-userscripts/main/hibid-bid-assistant.user.js

Tampermonkey updates use that same raw GitHub URL through the script metadata. Install from the raw URL, not a one-off copied file, so future version bumps can update.

## Active Modules

`FlipperAddon by ALOS` is the single active hosted script. It starts minimized in the bottom-right corner and shows only the module for the page you are actually on:

- HiBid catalog/category/watchlist pages: copy JSON and resale LLM brief.
- HiBid livecatalog pages: expand/copy live lot JSON and resale LLM brief.
- AuctionNinja sale catalog pages: copy sale terms plus lot JSON or resale LLM brief.
- AuctionNinja followed-items and items-won pages: copy account item JSON or watchlist/won-items LLM briefs for resale triage and inventory planning.
- eBay/Facebook selling pages: FlipTracker active listing copy/download export.

The older `hibid-lot-catalog-scraper.user.js` remains in the repo for legacy reference/tests, but normal use should install only `hibid-bid-assistant.user.js`.

## LLM Brief

Copy LLM Brief includes the full auction-resale coordinator prompt plus enriched lot JSON. The prompt tells the model to prioritize eBay sold/completed comps, calculate profit after buyer premium, tax, eBay fees, promoted listing friction, travel, shipping, and sedan-fit risk.

## Debug

Debug UI and console/log capture are hidden until enabled from the Tampermonkey menu command:

`Toggle FlipperAddon Debug Mode`

When enabled, the drawer exposes copy/clear debug controls. Logs use the `[FlipperAddon]` prefix.

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
