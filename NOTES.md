# Project Notes

This repo is the standalone home for FlipperAddon by ALOS, separate from `DeadlockStreamer`.

## Hosted userscript

- Repo: https://github.com/AshbyCollado/hibid-userscripts
- Install URL: https://raw.githubusercontent.com/AshbyCollado/hibid-userscripts/main/hibid-bid-assistant.user.js
- Active file: `hibid-bid-assistant.user.js`
- Current product name: `FlipperAddon by ALOS`
- The script uses `@updateURL` and `@downloadURL` pointing at the raw URL. Bump `@version` for every hosted release.

## Modules

- Catalog mode: HiBid catalog/category/lot/OUTBID watchlist pages plus WINNING/OUTBID current-bids pages. Owns scraper-first JSON copy and LLM brief export.
- Live mode: HiBid `livecatalog` pages. Owns live lot expansion plus JSON copy and LLM brief export.
- AuctionNinja mode: sale catalog pages, auction-search/nearby-sales pages, and followed-items/items-won/bid-history account pages. Owns sale terms, whole-auction search JSON/LLM export, account item JSON copy, watchlist LLM brief export, won-items inventory LLM brief export, and bid-history review export.
- AAR Auctions mode: auction calendar and catalog pages. Owns auction-list JSON/LLM export, catalog-lot JSON/LLM export, and persisted origin/radius settings for LLM-side distance verification.
- GovDeals mode: seller/storefront pages, search/new-listings filter pages, and direct asset pages. Owns listing/asset JSON copy and LLM briefs with shared origin/radius plus URL zipcode/miles context.
- FlipTracker mode: eBay/Facebook active selling pages. Owns scan/copy/download active-listing export.

Only the active page module should expose controls. Do not bring back the old all-controls-visible drawer.

## Legacy Max Plans

- Old max-plan storage stays for compatibility/tests, but the normal UI does not render max-plan editing or bidding actions.
- Historical storage is per auction when an auction ID is available: `flipperaddon-max-plan-v2:<host>:auction:<id>`.
- The old global `hibid-bid-assistant-plan-v1` key is legacy-migrated on first read.

## LLM Brief

`buildLlmAuctionBrief(...)` is the durable insertion point for resale instructions. It must include the full auction-resale coordinator prompt and enriched lot JSON, including URLs, image, description, bids, auction title, and buyer premium where available.

AAR and GovDeals LLM briefs must pass through persisted research settings, defaulting to `Edison, NJ 08817` and `100` miles, and must require live map/search proof before recommending an auction, listing, or asset as in-range. GovDeals search/new-listings briefs must also preserve URL filters such as `category`, `categoryName`, `zipcode`, and `miles`.

## Debug

- Debug mode is an addon boolean controlled by `Toggle FlipperAddon Debug Mode`.
- Debug UI and logging are hidden/off unless debug mode is enabled.
- Debug prefix: `[FlipperAddon]`.

## Local archive

Old screenshots, harnesses, and Deadlock-side copies were moved to:

`archive/deadlock-moved-2026-07-08/`

That archive is intentionally ignored by git.
