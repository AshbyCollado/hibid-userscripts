# HiBid Assistant Brain

## Current Architecture

- Active hosted install: `hibid-bid-assistant.user.js`.
- Raw install/update URL: `https://raw.githubusercontent.com/AshbyCollado/hibid-userscripts/main/hibid-bid-assistant.user.js`.
- Single UI: bottom-right `#hibid-bid-assistant-panel` drawer. The assistant removes legacy floating scraper artifacts when it mounts.
- Legacy file: `hibid-lot-catalog-scraper.user.js` remains for reference/tests, not as the normal active install. It detects the unified assistant and does not mount its old floating button while the assistant is active.

## Route Map

The assistant should mount without waiting for lot tiles on:

- `https://hibid.com/lots*`
- `https://hibid.com/*/lots*`, including `/newjersey/lots/40196/computers-and-electronics`
- `https://hibid.com/catalog/*`
- `https://hibid.com/livecatalog/*`
- `https://hibid.com/lot/*`
- `https://hibid.com/*/lot/*`
- `https://hibid.com/account/watchlist?status=OUTBID`
- `https://*.hibid.com/catalog/*`
- `https://*.hibid.com/lot/*`
- `https://*.hibid.com/account/watchlist?status=OUTBID`

Do not mount on generic HiBid account/help/search pages unless a supported route resolver case is added and tested.

## Scraper Flow

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

## Debugging

- Console/log prefix: `[HiBid Assistant]`.
- Keep a capped GM storage ring buffer under `hibid-bid-assistant-debug-log-v1`.
- Drawer controls:
  - `hibid-debug-copy`
  - `hibid-debug-clear`
- Tampermonkey menu commands:
  - `Remount HiBid Assistant`
  - `Copy HiBid Assistant Debug Log`
  - `Clear HiBid Assistant Debug Log`
  - `Copy HiBid Lots Now`

Important log checkpoints: boot URL, route decision, mount reason, data source, counts, pagination fetches, fallback scroll/open-more steps, clipboard result, and caught errors.

## Verification Checklist

- `node --check .\hibid-bid-assistant.user.js`
- `node --check .\hibid-lot-catalog-scraper.user.js`
- `npm test`
- Waterfox:
  - Confirm the unified assistant version is enabled.
  - Open `https://hibid.com/newjersey/lots/40196/computers-and-electronics`.
  - Capture a full-window screenshot with the page and bottom-right drawer visible.
  - Copy lots JSON and compare copied count to the discoverable total, or copy debug evidence explaining the limit.
  - Confirm scrolling, filters, lot links, watch buttons, and bid buttons still work when not actively scraping.

## Known Pitfalls

- `@match https://hibid.com/*` can inject on broad HiBid routes, so internal `resolveHiBidPage()` is the real gate.
- Waterfox/Tampermonkey Content Script API mode affects injection timing; keep mounting idempotent and callable from menu.
- Seller subdomains may lack `#hibid-state`; fallback DOM/network-observed behavior matters there.
- Closed catalog price realized text is auction result data, not an eBay sold comp.
- Do not treat "opened the page" as verification. Verification means observed UI plus route/debug/count evidence.
