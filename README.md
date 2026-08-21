# Flippah

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
- `legacy/tampermonkey/` - previous userscript implementation and fixtures

## Commands

```powershell
npm install
npm test
npm run build
```

Load `dist/chrome` through `chrome://extensions` or `dist/waterfox` through
Waterfox's temporary add-on page during development.

## Release gate

A source build is not a finished release. After every build that changes the
extension, refresh the installed Chrome and Waterfox copies, confirm the popup
shows the intended version, run a real HiBid export, and parse the copied JSON.
For pages with an authoritative API total, `expectedCount`, item count, and
unique `eventItemId` count must match before the release is accepted.

The packaged builds are written to:

- `dist/flippah-chrome-v0.2.0.zip`
- `dist/flippah-waterfox-v0.2.0.zip`

Flippah processes HiBid page and API data locally. It does not transmit or
sell browsing, auction, watchlist, or research data. Diagnostics are sanitized
and remain local unless the user chooses to share them.
