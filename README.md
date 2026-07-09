# FlipperAddon by ALOS

Hosted Tampermonkey userscript for resale workflows across HiBid, eBay selling pages, and Facebook Marketplace selling pages.

## Install

Open the unified addon URL in a browser with Tampermonkey enabled:

https://raw.githubusercontent.com/AshbyCollado/hibid-userscripts/main/hibid-bid-assistant.user.js

Tampermonkey updates use that same raw GitHub URL through the script metadata. Install from the raw URL, not a one-off copied file, so future version bumps can update.

## Active Modules

`FlipperAddon by ALOS` is the single active hosted script. It starts minimized in the bottom-right corner and shows only the module for the page you are actually on:

- HiBid catalog/category/watchlist pages: catalog scrape, max-plan editor, safe bid prep, JSON copy, and resale LLM brief.
- HiBid livecatalog pages: live current-lot monitor, manual-fire Snipe Now, live JSON copy, and resale LLM brief.
- eBay/Facebook selling pages: FlipTracker active listing export.

The older `hibid-lot-catalog-scraper.user.js` remains in the repo for legacy reference/tests, but normal use should install only `hibid-bid-assistant.user.js`.

## Max Plan

Catalog and live modes share the same format:

```json
{
  "1627sf": {
    "max": 40,
    "title": "optional title words"
  }
}
```

Plans are stored per auction when an auction ID is available. A lot saved with `"max": null` is remembered but not eligible to bid until a max is entered.

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

## Tests

```powershell
node --check .\hibid-bid-assistant.user.js
node --check .\hibid-lot-catalog-scraper.user.js
npm test
```
