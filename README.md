# Flippah by ALOS

Flippah is a read-only browser extension for HiBid research. It preserves the
true-cost calculator, eBay research links, watchlist, notes, and alerts from the
working `v0.1.0` extension while adding exact, auditable catalog exports and
US deal intelligence for Amazon.com and saved eBay resale estimates.

The extension is built from one TypeScript source tree into separate Chrome and
Waterfox packages. HiBid scraping is available from the toolbar popup; the
in-page calculator remains limited to individual lot pages.

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

## US deal intelligence

Flippah `v0.3.0` adds title-authoritative product identity with structured
description enrichment and condition parsing, Amazon.com retail evidence,
saved eBay resale indicators, mixed-lot and quantity
review gates, and compact Current Bids/Watchlist verdicts. Catalog annotations
are additive: Flippah does not hide, move, fade, shrink, relabel, or replace
HiBid-owned content or controls. Genuine CAD lots remain CAD and receive no USD
comparison.

Cold Amazon lookups are centrally bounded to batches of six with 350 ms pacing,
in-flight request joining, a 12-hour epoch-aware cache, response-size limits,
and challenge/rate-limit cooldowns. Only normalized quote evidence returns to
the page; raw Amazon HTML remains inside the background runtime.

The product extraction, condition assessment, matching, cache behavior, and
verdict ideas are adapted from Diego Magalhaes's MIT-licensed
[hibid-enhancer-suite](https://github.com/dgomesbr/hibid-enhancer-suite), revision
`976913421c3fd23b48cc8ca4cde78cb9528f97d3`. Flippah ports maintained logic to
TypeScript and intentionally excludes the donor's page-rewrite behavior.

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
