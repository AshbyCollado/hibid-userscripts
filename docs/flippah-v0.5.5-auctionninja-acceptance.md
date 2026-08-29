# Flippah v0.5.5 Acceptance Record

## AuctionNinja source coverage

- Electronics category: expected 229, collected 229, unique 229; page sizes
  `20 x 11 + 9`; zero failed pages and zero failed details.
- Auction search: expected 47, collected 47, unique 47; page sizes
  `12 + 12 + 12 + 11`; zero failed pages.
- Sale catalog: expected 274, collected 274, unique 274; page sizes
  `20 x 13 + 14`; zero failed pages and zero failed details.
- First, middle, and final sale records retained descriptions and complete image
  arrays. Stable product or sale IDs, not tile descendants, defined identity.

## Chrome page acceptance

- AuctionNinja item page displayed one Flippah detail panel while retaining all
  four native bid controls and adding no Flippah bid control.
- Electronics category displayed 20 annotations for 20 canonical first-page
  cards with 20 unique IDs, Amazon actions, eBay Sold/Completed links,
  conditions, and all-in values.
- Followed Items displayed 39 annotations for 39 canonical cards with no
  duplicate IDs.
- HiBid live-catalog values used native visible bid controls after reload; for
  example `$7 -> $8.05`, `$6 -> $6.90`, and `$14 -> $16.10` at a 15% premium.

## v0.5.5 redraw regression

- A conclusive Amazon result is reusable only when stable lot ID, normalized
  query, and ASIN override still match.
- `matched`, `no_match`, and `low_confidence` survive native live redraws;
  transient network errors retry.
- Identical visual state keeps the existing annotation DOM.
- The deal strip reserves 52 pixels so long condition labels cannot make the
  live grid jump between placeholder and hydrated renders.

## Automated gate

The release gate is TypeScript typecheck, the complete Node test suite, build,
and `git diff --check`. The extension popup itself cannot be navigated through
the Browser connector's `chrome-extension://` URL policy and remains a named
manual Chrome check; this does not replace the page-runtime acceptance above.
