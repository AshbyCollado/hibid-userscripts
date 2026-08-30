# AuctionNinja GitHub Issue Drafts

GitHub issue creation was attempted from Codex, but the GitHub App returned:

`403 Resource not accessible by integration`

Use these as ready-to-create issue bodies if the app permissions are updated or `gh` is installed/authenticated.

## AuctionNinja v1: sale catalog research module

Implement and verify AuctionNinja sale catalog support in FlipperAddon.

Branch: `codex/auctionninja-module`

Scope:
- Route resolver for supported AuctionNinja pages and blocked account/payment routes.
- Sale catalog context extraction: title, seller, location, pickup/shipping, special instructions, buyer premium, closing time.
- Lot card extraction: lot number, title, URL, image, current bid, bid count when explicit, time left/status, watched state.
- Guarded catalog loading from `1-40 of N` with stop/debug reasons.
- AuctionNinja drawer mode with research-only controls.
- JSON and LLM brief export with sale terms ahead of lot data.
- Tests and Waterfox verification before merge.

Safety boundary:
No bid clicks, no bid-field writes, no checkout, invoice, payment, or account-setting actions.

## AuctionNinja follow-up: auction-search triage module

Build the next AuctionNinja module for `/auctions` pages.

Goal:
Scan visible/loaded auction cards and produce a triage brief for which sales are worth opening.

Fields:
- Sale title and URL
- Seller
- Location
- Pickup/shipping availability
- Begins-to-close time
- Lot count when visible
- Seller rating/reviews when visible
- Risk tags such as far pickup, limited shipping, furniture-heavy, good smalls

Controls:
- Copy auction-list JSON
- Copy auction-list LLM brief
- No item-level max plan until inside a sale catalog.

## AuctionNinja follow-up: items-won inventory and resale export

Build the AuctionNinja `/items-won` module after sale catalog support stabilizes.

Goal:
Turn won items into pickup, cost, and resale workflow data.

Scope:
- Scrape won lot cards from the logged-in page by explicit user action.
- Capture won price, closed status, image, title, sale name, lot number, timestamp, and URL.
- Export JSON and a resale/pickup LLM brief.
- Optional FlipTracker/import export for inventory/listing prep.

Safety:
Do not scrape billing/payment/card/account settings. Do not store full won-item data except through explicit export or a future approved cache setting.

## AuctionNinja follow-up: item-detail enrichment fetches

Add optional item-detail enrichment for AuctionNinja catalog exports.

Goal:
When catalog cards are thin, fetch product detail pages to improve descriptions, images, condition notes, and single-lot metadata for LLM resale analysis.

Approach:
- Use same-origin fetch for selected/needed product URLs.
- Prefer JSON-LD Product data when present.
- Extract description, image URLs, current bid, lot/SKU, buyer premium, pickup/shipping details, and seller context.
- Add rate/step limits, stop button support, and debug counts.

Safety:
Never interact with bid, submit, checkout, invoice, payment, or account controls.
