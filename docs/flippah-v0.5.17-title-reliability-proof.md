# Flippah v0.5.17 Title Reliability Proof

This release is a corpus-driven repair of product-title normalization, Amazon
identity matching, and eBay Sold/Completed research-link generation. The
installed Chrome package is tested separately from source-level tests.

## Corpus provenance

- Raw ignored capture: 3,717 distinct public HiBid event-item IDs from 40
  auctions.
- Tracked deterministic fixture: 3,000 distinct records selected from 3,554
  eligible sanitized records.
- Fixture: `tests/fixtures/title-corpus/public-lots-v1.jsonl.gz`.
- Source SHA-256:
  `b5902a70e26f93d1f5593f0d673a906a36be8b9cf9a10e3cc207a8fb26b512eb`.
- Sanitized content SHA-256:
  `5f528a48be292f66aca96cad19da7296821fbe0dc639ff6f99af7f624488fdd7`.
- Gzip artifact SHA-256:
  `d3e73ebf2970428d48ead7395c75a243d81a9587deabbcb7a064f13fff335f33`.
- The public projection allowlists stable ID, source URL, title, bounded
  description text, and bounded category text. It excludes cookies, request
  headers, account identity, bidder data, tokens, notes, and private fields.

## Deterministic replay

| Corpus | Records | Mutation rounds | Mutation checks | Errors | Warnings |
|---|---:|---:|---:|---:|---:|
| Tracked sanitized fixture | 3,000 | 96 | 274,278 | 0 | 0 |
| Complete raw capture | 3,717 | 96 | 340,133 | 0 | 0 |

The mutation suite composes inventory wrappers, condition wrappers, entities,
Unicode punctuation, zero-width characters, repetition, spacing, plural
artifacts, dimensions, quantities, and long-title boundaries. Results are
deterministic for a fixed seed and enforce modern/legacy parity, idempotence,
bounded whole-token length, nonempty identities, and Amazon/eBay query parity.

The first 96-round replay exposed two composed failures for a quoted,
duplicated warehouse title whose second `Vv3 $56` prefix survived cleanup.
The shared modern and legacy query engines now collapse exact raw repetitions
before stripping the first inventory prefix. The table above is the complete
post-fix replay, not the earlier failing run.

## Scaling benchmark

The deterministic benchmark ran three samples per size with 32 mutation rounds
per record. Every sample had zero errors and zero warnings.

| Records | Median elapsed | Median records/sec | Median mutation checks/sec |
|---:|---:|---:|---:|
| 250 | 458 ms | 545.85 | 16,524.02 |
| 500 | 943 ms | 530.22 | 16,445.39 |
| 1,000 | 1,610 ms | 621.12 | 19,334.78 |
| 2,000 | 3,465 ms | 577.20 | 17,978.07 |
| 3,000 | 5,039 ms | 595.36 | 18,598.13 |

The ignored machine-readable report is
`artifacts/title-corpus/scaling-v0.5.17.json`.

## Truth-labeled edge families

The rare-product matrix has 65 source products across 13 families: medical,
industrial controls, laboratory, restaurant equipment, automotive parts,
books, collectibles, PC components, appliances, professional audio, cameras,
tools, and multi-component bundles. It contains 65 accepted candidates and 68
near-match/accessory/wrong-variant rejects. All 202 assertions pass.

Exact adversarial oracles include the historical failures for repeated Circon
and Smith+Nephew phrases, Magcubic marketing-description contamination, GE
Dinamap detached plurals, Covidien placeholder headings, GPU variants,
PlayStation 5, `TX-SR304`, `NT-USB+`, ISBNs, part numbers, and empty generic
titles.

## Chrome acceptance

Chrome loaded the unpacked package from
`C:\Users\ashby\Documents\lotlens-local`. Both that installed manifest and
`dist/chrome/manifest.json` reported `0.5.17`, and the live page marker
`document.documentElement.dataset.flippahContentVersion` reported `0.5.17`.

- Global `/lots`: 87 rendered product rows audited; 87 Amazon queries and 87
  eBay Sold+Completed links; zero empty, repeated, generic, or missing-filter
  failures.
- Signed-in `/account/watchlist`: 83 distinct lots; 83 eBay Sold+Completed
  links; 27 verified Amazon prices, 49 explicit Amazon search actions, and 7
  quantity/mixed/CAD review states; zero malformed queries.
- Catalog `769459`: pages 1, 2, and 7 checked. The three pages contained
  100, 100, and 99 distinct IDs with zero cross-page overlap; all 299 settled
  rows had paired Amazon and eBay links.
- A settled 100-row catalog was sampled every five seconds for one minute.
  Query changes, indicator changes, and tile-dimension changes were all zero.
- Browser console inspection found no Flippah errors. The only warnings were
  HiBid advertising-library deprecations from `securepubads.g.doubleclick.net`.

Historical lot replay:

| Source lot | Generated query | Result |
|---|---|---|
| [Magcubic 4K Smart Projector](https://hibid.com/lot/317882346/magcubic-4k-smart-projector--wifi-bt) | `magcubic 4k smart projector wifi/bt` | Amazon matched at $49.99; eBay Sold+Completed |
| [Smith+Nephew Dyonics InteliJet](https://hibid.com/lot/316445596/smith-nephew-dyonics-intelijet-suction-supply-unit) | `smith+nephew dyonics intelijet suction supply unit` | Repeated identity collapsed; eBay Sold+Completed |
| [Lot of 3 GE Dinamap monitors](https://hibid.com/lot/317380519/lot-of-3-ge-dinamap-vital-signs-monitors) | `ge dinamap vital signs monitors` | Detached plural repaired; quantity review retained |
| [Covidien Endo Clip III](https://hibid.com/lot/318082473/covidien-endo-clip-iii-auto-suture) | `covidien endo clip iii auto suture` | Placeholder `lot s` excluded; eBay Sold+Completed |

Machine-readable browser evidence and raw screenshots are kept in ignored
`artifacts/title-corpus/chrome/`. The visual captures include Watchlist rows,
the catalog final page, and the Magcubic lot result.

## Automated release gates

- `npm test`: 747 tests discovered, 746 passed, 0 failed, 1 intentional future
  adapter skip.
- `npm run test:legacy`: 278 passed, 0 failed.
- TypeScript typecheck and Chrome/Waterfox builds passed as part of `npm test`.
- `git diff --check` is required again immediately before commit.

## Owner-stopped soak

The final-code soak ran the complete tracked 3,000-lot corpus with 96 composed
mutation rounds per cycle. The owner explicitly stopped the process to redirect
work to live eBay sold-comp verification before the planned eight-hour
threshold. This is retained as strong validation evidence, but it is not
represented as an eight-hour pass.

- Measured elapsed time: 27,428,968 ms (7.619 hours).
- Completed cycles: 1,020.
- Record evaluations: 3,060,000.
- Mutation checks: 279,664,444.
- Error observations: 0.
- Warning observations: 0.
- Distinct issue keys: 0.

The ignored atomic progress report is
`artifacts/title-corpus/soak-8h-v0.5.17.json` and remains marked `running`
because the owner stopped the process between checkpoint writes.
