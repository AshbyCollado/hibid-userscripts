# HiBid Userscripts

Standalone Tampermonkey userscripts for HiBid auction workflows and FlipTracker listing exports.

## Install

Open the unified assistant URL in a browser with Tampermonkey enabled:

https://raw.githubusercontent.com/AshbyCollado/hibid-userscripts/main/hibid-bid-assistant.user.js

Tampermonkey updates use that same raw GitHub URL through the script metadata. Install from the raw URL, not a one-off copied file, so future version bumps can update.

## HiBid catalog scraper

`HiBid Safe Bid Assistant` is the active hosted script. It owns the bottom-right drawer UI, catalog scraping, LLM brief export, safe bid prep, live catalog support, and FlipTracker export.

Catalog scraping is data-first: it reads HiBid's embedded Apollo state when present, follows paginated `apage` results, and falls back to DOM scrolling/open-more collection when state is missing or incomplete. Supported HiBid routes include direct lots/catalog/livecatalog pages, state-prefixed category pages such as `/newjersey/lots/...`, lot detail pages, seller subdomains, and the OUTBID watchlist.

The older `hibid-lot-catalog-scraper.user.js` remains in the repo for legacy reference/tests, but it stays quiet when the unified assistant is active. The assistant also removes legacy floating scraper artifacts when it mounts so only one active UI controls normal HiBid work.

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
