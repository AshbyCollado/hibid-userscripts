# Flippah by ALOS

Flippah is a read-only browser extension for HiBid research. It preserves the
true-cost calculator, eBay research links, watchlist, notes, and alerts from the
working `v0.1.0` extension while adding exact, auditable catalog exports.

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
