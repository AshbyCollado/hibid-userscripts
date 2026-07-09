# Project Notes

This repo is the standalone home for FlipperAddon by ALOS, separate from `DeadlockStreamer`.

## Hosted userscript

- Repo: https://github.com/AshbyCollado/hibid-userscripts
- Install URL: https://raw.githubusercontent.com/AshbyCollado/hibid-userscripts/main/hibid-bid-assistant.user.js
- Active file: `hibid-bid-assistant.user.js`
- Current product name: `FlipperAddon by ALOS`
- The script uses `@updateURL` and `@downloadURL` pointing at the raw URL. Bump `@version` for every hosted release.

## Modules

- Catalog mode: HiBid catalog/category/lot/OUTBID watchlist pages. Owns catalog scrape, max plan, safe bid prep, JSON copy, and LLM brief.
- Live mode: HiBid `livecatalog` pages. Owns live current-lot evaluation, manual-fire Snipe Now, live scrape, JSON copy, and LLM brief.
- FlipTracker mode: eBay/Facebook active selling pages. Owns scan/copy/download active-listing export.

Only the active page module should expose controls. Do not bring back the old all-controls-visible drawer.

## Max Plans

- Storage is per auction when an auction ID is available: `flipperaddon-max-plan-v2:<host>:auction:<id>`.
- The old global `hibid-bid-assistant-plan-v1` key is legacy-migrated on first read.
- A row with `max: null` is saved but not eligible.
- Keep the raw JSON editor behind the Max plan dropdown; surface row-level Add/Save Plan buttons in the drawer first.

## LLM Brief

`buildLlmAuctionBrief(...)` is the durable insertion point for resale instructions. It must include the full auction-resale coordinator prompt and enriched lot JSON, including URLs, image, description, bids, auction title, and buyer premium where available.

## Debug

- Debug mode is an addon boolean controlled by `Toggle FlipperAddon Debug Mode`.
- Debug UI and logging are hidden/off unless debug mode is enabled.
- Debug prefix: `[FlipperAddon]`.

## Local archive

Old screenshots, harnesses, and Deadlock-side copies were moved to:

`archive/deadlock-moved-2026-07-08/`

That archive is intentionally ignored by git.
