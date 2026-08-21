# Flippah living brain

## Product boundary

Flippah is the maintained replacement for the Tampermonkey userscript. The
active product is a read-only HiBid WebExtension built from `src/`. Legacy
userscripts remain under `legacy/tampermonkey/` for reference and regression
tests only. No bidding, checkout, payment, publishing, or account mutation is
implemented.

## Runtime map

- `src/content/` detects routes, parses personalized DOM, preserves the original
  lot calculator, and keeps an active scrape alive when the popup closes.
- `src/background/` owns API requests, bounded retries, job checkpoints,
  diagnostics, watch refreshes, alarms, and notifications.
- `src/popup/` provides `Current Page` export controls and the preserved
  `Watchlist` tab.
- `src/options/` stores calculator, research-origin, radius, custom-instruction,
  and opt-in debug settings.
- `src/hibid/api.ts` is the authoritative public catalog/search pipeline.
- `src/hibid/dom.ts` contains dedicated lot and personalized account parsers.

## HiBid data rules

Public catalog and livecatalog routes enumerate and hydrate through HiBid's
first-party GraphQL operation. Search/category routes enumerate exact IDs
through `hibid-api.io/sr/main/v1/search/lot`, then hydrate only those IDs.
Identity is always `eventItemId`.

A complete export requires:

1. authoritative expected total equals enumerated unique IDs;
2. every enumerated ID is hydrated and no unexpected ID is present;
3. the route/filter fingerprint is unchanged; and
4. retries, timeouts, or cancellation did not leave missing work.

Account watchlist, winning/outbid, past-bid, and past-watchlist routes use only
their dedicated DOM scopes plus same-origin detail enrichment. They never fall
back to broad page state. A lot description must come from the lot-information
scope or a canonical lot-description element; privacy CSS and auction-level
descriptions are not lot descriptions.

## Browser release gate

Every release must be built once and accepted independently in Chrome and
Waterfox. Closing and reopening the toolbar popup during a catalog scrape must
reconnect to the persisted job. Copy JSON, parse it outside the extension, and
assert expected count equals item count equals unique ID count. Inspect first,
middle, and final records for category, description, and image fields.

The installed extension must be refreshed after every source update. A commit,
build, package, or opened page alone is not proof that the installed browser is
current. Record the displayed version and real export evidence before marking a
release complete.

## v0.2.0 acceptance evidence

- Chrome: catalog `765226` completed `497/497` with 497 unique IDs; a five-result
  filtered search completed `5/5`; the `q=lebron` no-match page completed `0/0`.
- Waterfox: the same catalog completed `497/497` after the popup was closed and
  reopened; first/middle/final records included descriptions and images.
- Single-lot DOM regression: lot `311206926` exports its category and image
  without consent-banner CSS or the auction-level description.
- Full modern and legacy test suites plus Waterfox manifest lint are required
  before packaging and push.

Screenshots are local release artifacts under `artifacts/` and are intentionally
ignored by Git.
