# Flippah by ALOS

Flippah is a read-only browser extension for HiBid research. It preserves the
true-cost calculator, eBay Sold research links, watchlist, notes, and alerts
from the working `v0.1.0` extension while adding exact, auditable catalog
exports and automatic Amazon.com deal intelligence.

The extension is built from one TypeScript source tree into separate Chrome and
Waterfox packages. HiBid scraping is available from the toolbar popup; the
in-page calculator remains limited to individual lot pages.

Copied AI briefs use the seller's saved research profile rather than a bundled
location or vehicle assumption. The profile includes tax treatment, buyer
premium fallback, payment method, eBay fees and reserves, target profit, ROI,
pickup radius, transport capability, resale channels, and sold-comp target.
Each exported lot includes a normalized eBay Sold/Completed research URL.
Saved lot query corrections, confirmed quantities, Amazon ASIN selections,
resale hypotheses, maximum bids, and auction premium corrections join the
export by stable HiBid ID with explicit provenance. A saved resale value is not
sold evidence and cannot create a Confirmed Lead by itself.

## Browser-extension boundary

This repository owns HiBid capture and the paired local Flippah lot handoff. It
does not request eBay or Seller Hub host permissions, inject scripts on eBay, or
ship the authenticated Product Research parser. User-directed eBay Sold links
remain ordinary research links.

Sold-evidence query correlation, rendered Sold/Completed proof, and Product
Research parsing belong to the separate `apps/ebay-relay-extension` in the
[Flippah repository](https://github.com/AshbyCollado/Flippah/issues/84). The
generated Chrome and Waterfox packages enforce this split with a repository
boundary regression test.

## Repository layout

- `src/` - maintainable extension source
- `tests/` - unit and integration coverage
- `dist/chrome/` - generated Chrome package
- `dist/waterfox/` - generated Waterfox package
- `reference-build/flippah-v0.1.0/` - supplied working extension baseline
- `assets/icons/` - Flippah by ALOS brand icon source and generated browser sizes
- `legacy/tampermonkey/` - previous userscript implementation and fixtures
- `vendor/hibid-enhancer-suite/` - MIT license and revision attribution for the
  parsing and retail-matching logic adapted into Flippah
- `vendor/hoverzoom/` - upstream MIT license for the full-size HiBid image URL
  behavior adapted into Flippah

## US deal intelligence

Flippah `v0.3.24` adds title-authoritative product identity with structured
description enrichment and condition parsing, Amazon.com retail evidence,
manual eBay Sold verification, saved resale estimates, mixed-lot and quantity
review gates, and compact Current Bids/Watchlist verdicts. Catalog annotations
are additive: Flippah does not hide, move, fade, shrink, relabel, or replace
HiBid-owned content or controls. Genuine CAD lots remain CAD and receive no USD
comparison.

Amazon lookups port the donor's catalog transport through browser-context
Amazon.com HTML requests in batches of six, 350 ms between network batches,
per-lot failure isolation, in-flight joining, and a 12-hour evidence cache. No
Amazon tabs or helper windows are opened. HiBid's own Retail/MSRP/Estimate is retained as an
explicitly labeled provisional fallback when live Amazon evidence is missing;
it is never presented as a verified Amazon price. eBay remains
user-directed: Flippah opens an exact Sold and Completed search, then uses the
resale estimate the user saves in the lot panel. Only normalized Amazon
evidence returns to HiBid; raw provider HTML is never stored or sent to HiBid.

The `v0.3.24` matcher normalizes retail unit aliases, understands compact
quantity notation such as `6x12oz`, requires package-count and volume evidence,
and uses Amazon result-link slugs when the visible result title omits a brand.
Its provider-cache epoch prevents older incomplete search snapshots from
silently surviving these matching upgrades.

The product extraction, condition assessment, matching, cache behavior, and
verdict ideas are adapted from Diego Magalhaes's MIT-licensed
[hibid-enhancer-suite](https://github.com/dgomesbr/hibid-enhancer-suite), revision
`976913421c3fd23b48cc8ca4cde78cb9528f97d3`. Flippah ports maintained logic to
TypeScript and intentionally excludes the donor's page-rewrite behavior.

## Watchlist reliability

Flippah `v0.3.7` reads `/account/watchlist` through its dedicated account-page
DOM parser. HiBid requires private buyer authorization for `WatchListSearch`,
so personalized data is never requested from an extension-origin GraphQL call.
If the displayed total and stable lot count drift while a lot closes, Flippah
uses HiBid's safe Refresh control and retries the snapshot before validation.
Account tokens and account identity are never read or copied into diagnostics.

Catalog deal indicators mount outside HiBid's clipped lot-title container, so
their Amazon/eBay status dots remain visible. Flippah excludes its own
annotations from copied lot text, preserves watchlist auction grouping, and
keeps all-in math focused on hammer, buyer premium, and sales tax. Shipping,
Auction Terms, and Fee Evidence inputs/sections are not part of the panel.

Research queries retain the complete identifying title after removing only
auction noise. Model-less products keep differentiating specifications such as
`4K`, `Smart`, `WiFi`, and `BT`; model punctuation such as `TX-SR304` and
`NT-USB+` is preserved. The legacy calculator and modern intelligence layer are
locked to the same query corpus in tests.

Retail matching uses a reusable product fingerprint rather than per-lot fixes.
It removes bounded inventory/lot prefixes, normalizes brand families, requires
the primary product kind, distinguishes accessories from real bundles, and
fails closed on conflicting capacity, volume, package count, color, material,
product family, mode count, platform, resolution, size, memory type,
frequency, refresh rate, storage type, network standard, voltage, wattage,
battery capacity, lens range, edition, or model-series evidence. Every checked
candidate has explainable match/rejection evidence in the normalized background
result. Sponsored, used, open-box, and renewed Amazon offers cannot supply the
new-retail value. Underidentified source lots also fail closed: a model-free
title needs a credible brand, a recognized product kind, and at least one hard
attribute before Flippah will display an automatic retail price. Descriptive
hyphenated prose such as `anti-fog` cannot be promoted to a model code; this
prevents accessory prose from creating false exact-product matches.

## Commands

```powershell
npm install
npm test
npm run build
npm run install:chrome -- --target "C:\\Users\\ashby\\Documents\\lotlens-local"
```

Load the stable install directory, such as `C:\\Users\\ashby\\Documents\\lotlens-local`,
through Chrome's extensions page. Do not load `dist/chrome` as the persistent
installed copy: each build replaces `dist`, which can leave Chrome pointing at
files that briefly do not exist. `dist/waterfox` remains the generated Waterfox
development package.

## Current release gate

A source build is not a finished release. After every build that changes the
extension, update the stable installed Chrome copy, confirm the popup shows the
intended version, run real HiBid exports, and parse the copied JSON.
For pages with an authoritative API total, `expectedCount`, item count, and
unique `eventItemId` count must match before the release is accepted.

Waterfox output is built from the same source, but Waterfox browser acceptance
is deferred until the Chrome product is stable.

Generated unpacked builds are written to `dist/chrome` and `dist/waterfox`.
Release archives must be created explicitly after browser acceptance.

Flippah processes HiBid page and API data locally. It does not transmit or
sell browsing, auction, watchlist, or research data. Diagnostics are sanitized
and remain local unless the user chooses to share them.
Flippah `v0.3.25` parses Amazon search responses as a real HTML tree in the
background worker. Nested Amazon result nodes can no longer cross-wire one
variant's title with another variant's price; the retail cache epoch is bumped
so every catalog is re-evaluated under the corrected parser.

## v0.3.51 final beta hardening

- The release package includes only the reference stylesheet required by the
  preserved lot calculator. Unused reference JavaScript and unnecessary web
  accessible resources are no longer shipped.
- The dormant Amazon helper-window implementation was removed. Amazon research
  continues through the direct background provider and cannot open hidden
  research windows or tabs.
- Watchlist CSV fields that could be interpreted as spreadsheet formulas are
  neutralized before download.
- Popup clipboard, diagnostic, CSV-download, and options-storage failures now
  produce visible errors instead of failing silently.
- Synced numeric and text settings are normalized and bounded before entering
  fee math or persistent state.
- The Chrome and Waterfox builds pass the complete automated suite. Browser
  installation and a live Chrome smoke test remain mandatory before packaging.

## v0.4.0 research quality loop

- Hovering a canonical HiBid lot photo opens a transient full-resolution
  preview without moving, replacing, or intercepting HiBid controls. The
  behavior can be disabled in Options.
- Every verified JSON and AI export includes field-level fidelity for stable
  identity, title, URL, description, photos, category, pricing, and status/time.
  Copy confirmation reports description and photo coverage immediately.
- Individual lot panels include a collapsed, optional resale-outcome recorder.
  Actual all-in cost, sold price, selling costs, and sales channel stay in local
  extension storage. Flippah calculates realized profit and the difference from
  the original saved resale estimate; outcomes can be exported as CSV from the
  Watchlist tab.
- Source inspirations and exclusions are documented in
  `docs/OPEN_SOURCE_INSPIRATION.md`.

## v0.4.1 watch redraw repair

- Restores cached Amazon, eBay, and all-in annotations after HiBid redraws a
  tile when Watch or Unwatch is clicked.
- Does not repeat retail searches when the lot ID and cached analysis are
  unchanged.

## v0.4.2 evidence and condition clarity

- Auctioneer estimates, claimed retail/MSRP values, and recommended bids no
  longer influence Amazon matching, price indicators, or deal verdicts.
- Catalog and account annotations show a compact condition pill derived from
  the structured description, with full evidence available on hover.

## v0.4.3 inline condition and activity clarity

- Inline HiBid condition blocks now retain packaging, functionality, damage,
  and missing-parts fields instead of swallowing them into `Shelf Location`.
- Watchlist condition chips preserve useful qualifiers and expose critical
  missing-parts or unable-to-test evidence through their label and tooltip.
- The toolbar icon shows a tab-scoped activity badge while Amazon research or
  a catalog scrape is running, then restores the ending-soon watch count.

## v0.4.4 popup-only book analysis

- Removes the book-analysis card from HiBid's lot page so Flippah does not add
  a large control to the auction content.
- Individual lot pages expose the same exact-photo handoff in a dedicated
  `Books` section under the toolbar popup's `Scraper` tab.
- Exact GraphQL photo reconciliation, challenge detection, local pairing, and
  route-drift checks remain unchanged.

## v0.4.5 repeated search-query repair

- Collapses complete product identities that HiBid supplies twice in one
  title before building Amazon or eBay search URLs.
- Applies the same cleanup to user-saved query overrides and the preserved
  legacy lot-panel query builder.

## v0.4.6 single catalog cost display

- Removes the original blue `True cost` chip from catalog titles.
- Keeps the bottom `All-in` amount as the only catalog cost figure and removes
  the obsolete catalog-chip setting.

## v0.4.7 lot-page query recovery

- Uses the canonical lot URL when HiBid briefly renders a placeholder heading
  such as `Lot # : S`, preventing saved searches such as `lot s`.
- Repairs detached plural suffixes such as `monitor s` while preserving real
  model names such as `Xbox Series S`.
- Rejects generic saved query overrides and restores the actual lot identity.

## v0.4.8 paired lot handoff

- Restores the authenticated local Flippah lot handoff while retaining the
  extension boundary that keeps eBay Product Research outside this package.
- Preserves exact HiBid source identity, full seller-photo ordering, auction
  economics, and privacy filtering in the handoff manifest.

## v0.4.9 seller-configured AI research brief

- Removes Edison and CT200h assumptions from new-install defaults and generated
  prompts. Blank location, tax, premium, or transport data remains explicitly
  unconfigured instead of silently becoming a favorable assumption.
- Adds clear Options fields for seller economics, profit/ROI goals, pickup
  logistics, resale channels, and the desired sold-comp count.
- Adds a normalized eBay Sold/Completed research queue for every searchable lot
  and component-review mode for generic mixed lots.
- Carries saved per-lot query corrections, confirmed quantities, ASIN choices,
  resale hypotheses, maximum-bid ceilings, and per-auction premium corrections
  into a separate provenance-labeled section. Extension tokens and bidder or
  account identity are never read for export.
- Requires a direct sold-listing evidence ledger before any numeric resale or
  Confirmed Lead, with bounded query and comp stopping rules for large catalogs.
