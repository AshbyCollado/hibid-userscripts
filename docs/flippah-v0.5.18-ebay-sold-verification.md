# Flippah v0.5.18 eBay Sold-Comp Verification

This report verifies sold-result truth separately from search-link quality.
Opening a URL with Sold and Completed filters is discovery. A verified comp
requires a sold record, canonical item identity, actual price, compatible
product identity, and auditable provenance.

## Provider boundary

- Primary: signed-in eBay Seller Hub Product Research, Sold tab.
- Fallback: public eBay Sold and Completed search.
- The donor project at revision
  `976913421c3fd23b48cc8ca4cde78cb9528f97d3` contains no eBay provider,
  parser, Sold filter, or sold-price code. Its reusable contribution is product
  extraction, accessory rejection, scoring, cache joining, and paced batches.
- This repository does not add eBay host permissions or automate the user's
  signed-in account. The parser and verifier are pure development acceptance
  tools fed by user-directed browser evidence.

Seller Hub Product Research is preferred because it reports actual sold
records and accepted Best Offer amounts. Public search is weaker: its history
is shorter and an accepted Best Offer may hide the actual amount. Such a row is
recorded as a sold event with `best-offer-unknown`, but it is excluded from all
price statistics and from the comparable sample count.

Official basis:

- [eBay Product Research](https://www.ebay.com/help/selling/selling-tools/product-research?id=4853)
  documents up to three years of sales, actual accepted Best Offer prices, and
  the greater related-result drift in ordinary completed-listing search.
- [eBay's buying application guide](https://www.developer.ebay.com/develop/get-started/get-started-on-a-buying-application)
  identifies Marketplace Insights as the sold-history API and marks it Limited
  Release. This project does not pretend the active Browse API is a sold API.

## Verification contract

Every search attempt records provider, source URL, query, timestamp, status,
page offset/limit, pagination state, failure reason, and parsed records. Every
record retains canonical item ID and URL, title, image URL, sold price,
shipping, delivered price, currency, quantity sold, total sales, sale date,
condition, format, price kind, and independent sold provenance.

The verifier fails closed on:

- Active or ambiguously filtered result pages.
- Browser challenges, parse failures, or incomplete planned queries/pages.
- Duplicate item IDs, wrong models, accessories, replacement parts, manuals,
  packaging-only rows, parts-only rows, activation locks, condition conflicts,
  quantity mismatches, and candidate-only bundles.
- Mixed editions, capacities, regions, hardware revisions, or product variants
  when the auction lot does not identify its exact variant.
- Non-USD prices in a USD valuation set.

The default minimum is three comparable sold records with actual prices. Fewer
records produce `insufficient`, not a guessed value. Mixed variants produce
terminal `insufficient` with `variant-ambiguous` detail; evidence remains
visible, but `marketValueReady` is false.

## Signed-in Chrome matrix

The following searches were executed in the user's signed-in Chrome session
against Seller Hub Product Research. Each row was parsed from the rendered Sold
table and then passed through the same pure verifier used by the tests.

| Source product | Parsed | Accepted | Result | Concrete reason |
|---|---:|---:|---|---|
| ASUS GeForce RTX 4060 8GB | 104 | 59 | Variant ambiguous | Three contiguous pages (50/50/4); 45 rows rejected, but mixed ASUS board variants make the $286.05 delivered median audit-only. |
| SteelSeries Arctis Nova 7 Xbox | 6 | 6 | Verified | Xbox Series X wording accepted as the same platform family; median $90.00. |
| Onkyo TX-SR304 receiver | 5 | 2 | Insufficient | Manual, remote, and bundled unit rejected; only two standalone receivers remain. |
| Sony PlayStation 5 console | 48 | 11 | Variant ambiguous | Disc, digital, slim, region, and capacity variants cannot form one value. |
| Seagate Backup Plus Hub 8TB | 27 | 23 | Variant ambiguous | Quantity-two row rejected; multiple hardware IDs prevent one authoritative value. |
| Magcubic 4K projector | 14 | 14 | Variant ambiguous | HY350, L018, HY310, and HY300 results are different models. |
| WEP 982-VI soldering station | 0 | 0 | Insufficient | All three bounded queries completed with no sold rows. |
| Circon ACMI ALU-1B light source | 1 | 1 | Insufficient | One exact sale is evidence but does not meet the three-comp minimum. |
| Smith & Nephew Dyonics InteliJet | 0 | 0 | Insufficient | Every bounded query completed with no sold rows. |
| Covidien Endo Clip III | 0 | 0 | Insufficient | Every bounded query completed with no sold rows. |
| Lot of 3 GE Dinamap monitors | 9 | 0 | Insufficient | Single-unit results cannot price a three-unit auction lot. |
| The Jesus Papers | 6 | 1 | Insufficient | One exact book accepted; five related-result false positives rejected. |

These outcomes demonstrate why a high result count is not the same as a
reliable value. The verifier deliberately withholds a number when identity,
quantity, variant, or sample sufficiency is unresolved.

The final live replay also reconfirmed the positive path: SteelSeries completed
one terminal page with six accepted sales, no rejected rows, a $90.00 median,
and `marketValueReady: true`. Onkyo completed one terminal page with five rows,
rejected the manual/remote/bundle evidence, and stayed `insufficient` at 2/3.
The widened RTX history completed offsets 0, 50, and 100 before returning
`insufficient` with `variant-ambiguous`; it did not certify the intermediate
median as a market value.

## Visual proof

- `docs/evidence/ebay-product-research-asus-rtx4060-results.png` shows the real
  sold RTX 4060 result set used for a verified valuation.
- `docs/evidence/ebay-product-research-onkyo-tx-sr304-results.png` shows the
  manual, remote, bundle, and standalone receiver rows used to prove rejection.
- `docs/evidence/ebay-product-research-the-jesus-papers-results.png` shows the
  exact book sale among related-title drift that must not be accepted.

The screenshots are cropped to result rows and contain no account header,
username, messages, cookies, authorization data, or buyer information.

## Automated evidence

- `tests/ebay-sold-results.test.ts` covers provider parsing, sold-context
  enforcement, hidden Best Offers, provenance, deduplication, pagination,
  challenges, query exhaustion, minimum samples, and statistics.
- `tests/ebay-sold-adversarial.test.ts` covers ten initially failing edge
  families: medical components, quantity language, untested/locked condition,
  model suffixes, bundles, PS5 variants, storage families and equivalent
  capacity units, book media/ISBN equivalence, packaging-only rows, and brand
  initialisms. The unchanged matrix now passes 10/10.
- An independent hostile review added
  `tests/ebay-sold-review-regressions.test.ts`. Its unchanged cases initially
  exposed ten additional failures: untrusted Seller Hub provenance,
  challenge/partial-page threshold overrides, missing per-card Sold proof,
  hidden Best Offer prices, asymmetric model generations, generic-source
  model adoption, broken pagination completion, word quantities and device
  locks, order-dependent duplicate resolution, foreign-currency case, and
  zero-dollar rows. After repair, the review matrix passes 10/10.
- The focused sold-evidence, query, provenance, and rare-identity suite passes
  261/261 tests.
- The complete modern suite passes 782 tests with one intentional future
  adapter skip; the preserved legacy suite passes 278/278 tests.
- TypeScript typecheck, Chrome and Waterfox builds, and `git diff --check` pass.

A challenge page is never bypassed; it produces `blocked` and requires a later
user-directed retry. The in-page book-analysis card is also excluded from the
shipped content script; book intake remains available only in the toolbar
popup's `Scraper` tab.

## Installed Chrome acceptance

- The stable unpacked install was patch-bumped and refreshed as Flippah
  `v0.5.19`; the live content marker reports `0.5.19`.
- The Magcubic lot preserves the complete `Magcubic 4K Smart Projector,
  WiFi/BT` identity in both Amazon and eBay links.
- The eBay URL contains both `LH_Sold=1` and `LH_Complete=1`.
- The page-level `Analyze books in Flippah` card is absent; book intake remains
  in the popup's `Scraper` tab.
