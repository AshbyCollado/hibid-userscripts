# HiBid Userscripts

Standalone Tampermonkey userscripts for HiBid auction workflows and FlipTracker listing exports.

## Install

Open the assistant URL in a browser with Tampermonkey enabled:

https://raw.githubusercontent.com/AshbyCollado/hibid-userscripts/main/hibid-bid-assistant.user.js

Open the catalog scraper URL separately:

https://raw.githubusercontent.com/AshbyCollado/hibid-userscripts/main/hibid-lot-catalog-scraper.user.js

Tampermonkey updates use the same URLs through each script's metadata.

## HiBid catalog scraper

`HiBid Lot Catalog Scraper` is the standalone scraper for `hibid.com/lots*`, `hibid.com/catalog/*`, and `hibid.com/livecatalog/*` pages, including HiBid subdomains. It switches compatible catalog pages to Single Page, expands live catalog `Open More` / `Load More` controls, scrolls lazy-loaded lots, gathers enriched lot/bid fields, and copies JSON to the clipboard from the `Copy All HiBid Lots` pill. Click the pill again while it is running to request a manual stop.

## FlipTracker active listing export

The same userscript now opens a `FlipTracker Active Listing Export` panel on:

- eBay active listing pages such as `https://www.ebay.com/sh/lst/active`
- Facebook Marketplace seller/listing pages such as `https://www.facebook.com/marketplace/you/selling`

Workflow:

1. Open your active listings page.
2. Scroll/load the listings you want included.
3. Click `Scan Listings`.
4. Click `Download Export HTML`.
5. Put the downloaded `FlipTracker-listings-*.html` file into `C:\Users\ashby\Documents\MarketplaceScraper\ImportInbox`.
6. In FlipTracker, run the import/review flow. Rows still go through `Import Review`; nothing writes straight into business tables without approval.

Facebook sometimes omits item URLs from the manager page HTML. When that happens, the export still carries title, price, status, and click counts, but the URL field will be blank because the page did not expose it.

## Tests

```powershell
npm test
```
