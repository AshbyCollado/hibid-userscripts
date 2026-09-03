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
- `src/popup/` opens on `Watchlist`; the right-side `Scraper` tab provides export controls and the preserved
  `Watchlist` tab.
- Book-lot handoff is exposed only from `Scraper` -> `Books` -> `Analyze this lot` in the toolbar popup.
  The content runtime owns the bounded message handler but never mounts a page-level button, card, style,
  or other handoff UI into HiBid's document.
- `src/options/` stores calculator, seller economics, research origin/radius,
  transport capability, resale goals/channels, custom instructions, and opt-in
  debug settings.
- `src/hibid/api.ts` is the authoritative public catalog/search pipeline.
- `src/hibid/dom.ts` contains dedicated lot and personalized account parsers.
- `src/intelligence/` contains the US product, condition, Amazon matching,
  all-in, indicator, batching, and verdict logic adapted from the attributed
  `hibid-enhancer-suite` revision recorded under `vendor/`.
- `src/content/deal-intelligence.ts` owns extension-only lot-panel, catalog, and
  active-account annotations. It shares the existing route observer and never
  rewrites HiBid-owned content.

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

## AI brief rules

- `src/hibid/exports.ts` resolves one immutable `ResaleResearchProfile` from
  the current sync settings at copy time. The prompt and JSON export must agree.
- New installs have no location or vehicle assumption. Unconfigured tax,
  premium, origin, or transport inputs remain `null`/UNVERIFIED and block a
  Confirmed Lead or final maximum bid.
- Record-specific auction premium data takes precedence. The configured premium
  is a labeled fallback only; bidder/account identity is never exported.
- At copy time the popup reads only the active lots' `flippahDealLotV1:*`
  records, their `flippahDealAuctionV1:*` records, and the legacy `watchlist`
  fallback. Relay credentials and unrelated local-storage values are outside
  the read set and export contract.
- `savedResearch` carries query/ASIN corrections, confirmed quantity,
  unverified resale hypotheses, hard maximum-bid ceilings, and auction premium
  overrides with field-level provenance. Saved resale is never sold proof.
- Every ordinary lot receives a normalized Sold/Completed URL. Generic mixed
  lots enter component-review mode instead of searching the bundle title.
- A numeric resale estimate requires a direct visible sold-listing URL in the
  Evidence sheet. Search pages, snippets, active listings, auctioneer estimates,
  and Amazon retail values are not sold proof.
- Large catalogs use parse-first triage, bounded row batches, at most two query
  variants per item, and the configured sold-comp target as a stop rule.

## Browser release gate

Chrome is the active release gate. Waterfox output continues to build from the
same source but its browser acceptance is deferred until the Chrome product is
stable. Closing and reopening the toolbar popup during a catalog scrape must
reconnect to the persisted job. Copy JSON, parse it outside the extension, and
assert expected count equals item count equals unique ID count. Inspect first,
middle, and final records for category, description, and image fields.

The installed extension must be refreshed after every source update. A commit,
build, package, or opened page alone is not proof that the installed browser is
current. Record the displayed version and real export evidence before marking a
release complete.

Chrome must load a stable unpacked directory. Run
`npm run install:chrome -- --target "C:\\Users\\ashby\\Documents\\lotlens-local"`
and load that directory once. Never point the installed extension at
`dist/chrome`, because the build replaces `dist` and can make the popup disappear
mid-update. The installer copies runtime files first and writes the manifest
last so an update remains coherent.

## v0.2.4 reliability changes

- HiBid GraphQL categories may be arrays; normalization reads `fullCategory`,
  category name, and parent names without dropping the category.
- Private HiBid watch notes are normalized but exported only when the explicit
  include-private-notes setting is enabled.
- Blank nullable numeric settings remain unset instead of being coerced to zero.
- Ending alerts persist their 15-minute and 2-minute notification flags before
  displaying a notification so background restarts do not repeat the same alert.
- The build derives manifest versions from `package.json`, and the stable Chrome
  installer prevents transient missing popup files during an update.
- Completed jobs are invalidated when the current visible total changes, and
  the toolbar popup continuously re-reads the active route while open. Every
  copy action performs a fresh route/context check before using stored data.
- A transient content-script reconnect error is cleared as soon as polling
  successfully reads the new route, so navigation cannot leave a stale error
  beside an otherwise ready scraper.
- Route fingerprint changes also clear prior copy toasts, pending copy intent,
  and past-auction selection before the new page can render.

## v0.2.5 diagnostic export repair

- Every completed, stopped, or stale scrape now persists a sanitized diagnostic
  record, not only failed jobs.
- `Copy Diagnostic` and `Download Diagnostic` fail visibly when no record exists;
  they never report success after copying literal `null`.

## v0.2.6 past-auction group boundary repair

- Personalized past-auction pages render each auction header and its lots as
  siblings inside `#lot-tiles-1`. Selected exports now copy only the sibling
  range between that header and the next `app-watched-auction-header`.
- The current selected group count is its completeness total; unrelated account
  pagination and neighboring auction groups remain outside the export scope.

## v0.2.6 Chrome acceptance evidence

- Installed source: `C:\Users\ashby\Documents\lotlens-local`, extension ID
  `dpgcddpffcogaodnoildpgdbjfabmdkn`; both the extensions card and toolbar popup
  visibly reported `v0.2.6`.
- Filtered `gaming pc` search: `7/7` unique IDs, seven images/categories, and five
  populated descriptions. Copied-payload SHA-256:
  `53b18ec157994014d3a3bd0fa3c10a304a59fe54389ddae32c987d01bb65b532`.
- Catalog `765226`: `497/497` unique IDs with descriptions, categories, and images
  on all 497 records. Copied-payload SHA-256:
  `6b8d605e2461d003d016700388c46302d4eebfe477a0cb84ce4a11921426faf1`.
- Signed-in watchlist: `40/40` unique IDs, all with images/categories and 32 with
  populated descriptions. Copied-payload SHA-256:
  `9176dc94659373d8a6bc1394c4637a9c1056e5afabca6a32325a91eb77b3ee5b`.
- Past Watch List selected only `Be Biopharma - Cambridge, MA`: `3/3` unique IDs
  (`313088791`, `314173058`, `314173064`) with canonical URLs, categories, images,
  and full description HTML; the following auction was excluded.
- The `q=lebron` no-match page completed `0/0`; a single-lot regression for lot
  `311206926` exports category and image without consent or auction-level text.
- Copy Diagnostic parsed as completed `497/497` with no missing or duplicate IDs,
  and Download Diagnostic created a real local JSON file. Stop, Retry, popup
  reconnect, watchlist CSV, calculator, eBay sold search, options, and debug mode
  were also exercised in the installed Chrome build.
- Modern and legacy suites plus `git diff --check` remain required before push.

Screenshots are local release artifacts under `artifacts/` and are intentionally
ignored by Git.

## v0.3.0 US deal intelligence

- USD and `en-US` only; Amazon.com, US CamelCamelCamel, and eBay Sold links.
- CAD lots remain unconverted and receive no USD comparison.
- Product identity is title-authoritative; structured description fields may
  enrich brand/model data, but long marketing prose cannot replace the title.
  Queries preserve models such as `TX-SR304`, `NT-USB+`, capacities,
  punctuation, and parenthesized model IDs.
- Automatic Amazon matches require an exact model or a credible matching brand,
  plus a matching product kind for model-less items. Generic overlap such as
  `4K`, `smart`, or `wireless` is never enough. Low-confidence evidence cannot
  provide a retail value or account verdict; a user-selected ASIN is the only
  explicit override. Matching epoch `2` invalidates pre-fix cache entries.
- Structured condition answers take precedence over question-label words.
  Warnings remain visible while research stays available.
- Mixed/group lots require component review. Multi-unit lots require a saved
  confirmed quantity before automatic retail comparison.
- Catalog work runs all-in first, then background-owned Amazon lookups in
  batches of six with 350 ms pacing, duplicate joining, 12-hour cache, bounded
  responses, challenge cooldown, and stale-route rejection.
- Amazon and eBay indicators are independent. Current Bids and active Watchlist
  use eBay net first and Amazon retail only as a fallback. Past pages remain
  export/history only.
- Donor page cleanup, auction-card duplication, notice relocation, image
  resizing, fading, and full-page rewriting are explicitly forbidden.

## v0.3.0 Chrome acceptance evidence

- Stable unpacked source: `C:\Users\ashby\Documents\lotlens-local`; the
  installed content script reports `data-flippah-content-version="0.3.0"`.
- Detail lot `317882346` mounts the original calculator plus US Deal
  Intelligence, Amazon/eBay evidence, Auction Terms, and Fee Evidence while
  preserving the native Bid control. Its title-authoritative query is
  `Magcubic Projector`; an unrelated Samsung monitor is no longer accepted.
  Amazon HTTP 503 currently produces a visible rate-limit state and no value.
- Catalog `769459`: 100 canonical tiles, 100 Flippah indicator strips, 100
  all-in annotations, 100 native Bid controls, and zero hidden tiles.
- Filtered desktop search (`q=gaming pc` plus shipping/status filters): seven
  canonical tiles, seven indicator strips, seven all-in annotations, seven
  native Bid controls, and zero hidden tiles.
- Signed-in Watchlist: 51 canonical tiles and 51 indicator strips; 35 active
  Bid controls, ten native Watch/Unwatch controls, and zero hidden tiles.
  Active account rows display additive OPEN/CLOSED verdict badges.
- Winning and Outbid routes both inject `v0.3.0`; the signed-in account had no
  rows during acceptance, so populated verdict behavior is fixture-proven but
  not live-data-proven in this run.
- The complete TypeScript/build/test suite passes 64 tests. Chrome and Waterfox
  MV3 packages both build; installed Waterfox acceptance remains intentionally
  deferred by the release plan.
- Chrome blocks automation from claiming extension-internal popup URLs. Popup
  markup, command wiring, polling, fingerprint-reset logic, active-tab fallback,
  and copy/diagnostic guards have source-level assertions and helper tests, but
  the installed Scraper, Watchlist, rerun, clear-cache, copy, retry, and
  reconnect interactions still require a manual acceptance pass before the
  release can be called complete.

## v0.3.1 watchlist API correction

- `/account/watchlist` uses HiBid's first-party `WatchListSearch` GraphQL
  operation with 100-lot pages instead of attempting to fetch Angular account
  pagination as static HTML.
- Coverage requires the operation's filtered total, unique `Lot.id` count, and
  normalized record count to agree. Full records already include description,
  category, pictures, bids, status, shipping, auction terms, and optional watch
  notes, so separate per-lot detail requests are unnecessary for this route.
- If the watchlist changes while pages are collected, Flippah retries the whole
  snapshot up to three times. This handles the observed `51 -> 50` transition
  without exporting stale coverage or reporting an API enumeration mismatch.
- The background replaces the incoming query with its own fixed read-only
  document and validates page variables. Cookies remain same-origin browser
  state; account tokens, bidder identity, and `GetAccountInfo` are never
  requested or included in diagnostics.
- Regression coverage includes 51 API lots behind a 50-row visible page and a
  changing 51-to-50 snapshot. The complete suite is 69/69.

## v0.3.2 authenticated watchlist correction

- Chrome acceptance showed that HiBid returns HTTP 401 when its private
  `WatchListSearch` buyer query originates from the extension background, even
  with browser credentials enabled. The public API-first catalog path is not
  affected.
- `/account/watchlist` now follows the same dedicated canonical DOM boundary as
  the other personalized account pages. It does not inspect or export account
  tokens and does not use broad Apollo state.
- If a watchlist item closes during capture and the visible total disagrees
  with stable extracted lot IDs, Flippah safely invokes HiBid's Refresh control
  and retries the full snapshot twice before failing closed.
- Release acceptance must run the real toolbar `Copy JSON` action on the signed-
  in watchlist and parse the clipboard payload; a successful page load alone is
  not acceptance.

## v0.3.3 visible deal indicators and calculator cleanup

- HiBid clips content appended inside `.live-catalog-lot-lead-container`; retail
  indicators mount before `.lot-tile-content` (or after `.lot-lead-heading`),
  never inside the title container.
- Catalog indicators use a visible status dot plus Amazon/eBay label. Browser
  acceptance checks their rendered full-window position, not only DOM counts.
- Nodes marked `data-flippah-owned="true"`, `.flippah-deal-strip`,
  `.flippah-allin`, and `#lotlens-root` are excluded from scraper text.
- Active Watchlist/Winning/Outbid exports retain each watched auction's ID,
  title, and location, and preserve the visible lot number separately from the
  stable event-item ID.
- Shipping is absent from the calculator UI and ignored by all-in math,
  including legacy saved `shipCents`. Auction Terms and Fee Evidence blocks are
  absent from Flippah's lot panel.
- Chrome acceptance uses auctions `769995`, `765731`, and `767962`, with three
  direct lots from each recorded under `docs/evidence/flippah-v0.3.3/`.
- Upcoming lots can have no current bid. Their panel stays in manual current-bid
  mode and must not invent an all-in amount.

## v0.3.4 exact product research queries

- The legacy calculator query and modern `ProductIdentity.query` must use the
  same full-title sanitizer. Never replace the panel query with a compact
  brand/noun identity.
- Model-less products retain discriminating specifications. The canonical
  regression is `MAGCUBIC 4K SMART PROJECTOR, WIFI BT` ->
  `magcubic 4k smart projector wifi bt`.
- Internal model punctuation is identity-bearing: preserve `TX-SR304`,
  `NT-USB+`, capacities, and compound specifications.
- Remove only bounded auction noise, lot/group quantity phrases, and known
  inventory prefixes such as `AV -`. Preserve dimensions because size can be a
  critical discriminator on otherwise model-less products. Both query
  implementations are parity-tested against an adversarial title corpus.

## v0.3.5 baseline retail identity

- Strip known HiBid inventory prefixes before brand/model/kind extraction, not
  only from search queries. `AV - PLAYSTATION 5 CONSOLE` identifies PlayStation
  as the brand; `AV - SEAGATE 8TB EXTERNAL DRIVE` identifies Seagate.
- Game consoles and storage are explicit product kinds. PlayStation generation
  is strict but accepts equivalent `PlayStation 5` and `PS5` spelling.
- Console accessories/games cannot become console retail matches. Storage
  capacity and credible brand must match before a price is trusted.

## v0.3.6 product-fingerprint matcher

- Retail candidates pass one generic evaluator; there is no console-only
  scoring bypass. The evaluator records matched evidence and explicit rejection
  reasons for future diagnostics.
- Product identity removes bounded lot, inventory, and condition prefixes and
  skips `Lot <id>` pipe segments before selecting the searchable product name.
- Canonical brand families cover equivalent manufacturer/product-family names
  such as Sony/PlayStation, Microsoft/Xbox, Apple/iPhone, Google/Pixel, and
  Western Digital/WD without relaxing unrelated brands.
- Required attributes fail closed across capacity, platform, resolution,
  dimensions, RAM generation/frequency, display refresh, storage medium,
  network standard, voltage/wattage, battery capacity, camera lens range,
  GPU/CPU SKU and suffix, edition, and model-series signatures.
- Primary-product evidence separates a complete item or explicit bundle from a
  game, case, controller, mount, replacement part, or other accessory. Used,
  renewed, open-box, and sponsored Amazon results are never new-retail values.
- Source identity has its own sufficiency gate. A model-free lot needs a
  credible brand, recognized primary-product kind, and at least one hard
  discriminator. Vague labels such as `Custom computer`, `Workstation
  Computer`, or an unspecified `VR Headset` stay unpriced instead of borrowing
  an arbitrary plausible product's retail value.
- `RETAIL_MATCHING_EPOCH` remains only for legacy decision-cache migration;
  current provider evidence is always re-evaluated by the active matcher.
- Amazon provider evidence is cached by normalized query separately from the
  match decision. Matcher upgrades revalidate normalized candidates instead of
  refetching every watched lot; legacy normalized candidates migrate forward.
  Challenge, rate-limit, parse, and transport failures are distinct from a real
  zero-result response and can never be shown as proof that no product exists.

## v0.3.9 stable retail providers

- Automatic catalog analysis is Amazon-only. eBay remains a manual Sold and
  Completed search plus a user-saved resale estimate in the Flippah lot panel.
- Catalog analysis must never call every visible lot through `Promise.all`.
  Amazon uses one serial page queue plus a background cross-tab lock. Cached
  evidence skips pacing; cold requests wait two seconds between lots and the
  background persists a minimum request interval across service-worker restarts.
- Amazon requests use the fixed `https://www.amazon.com/*` host permission.
- Amazon 429, 503, challenge, parse, and network failures use bounded retries
  with exponential backoff. Cooldown state lives in `chrome.storage.local`,
  survives service-worker restarts, and is not erased by Clear Saved Prices.
- Legacy Amazon cache records may omit `candidates`; treat them as an empty
  candidate list and re-fetch. Never read `.length` from unvalidated cache data.
- Only conclusive `ok` and `no_results` Amazon snapshots are reusable. Blocked,
  rate-limited, parse-error, and network-error snapshots must trigger a real
  bounded retry after cooldown rather than replaying a cached failure.
- A tile displays an eBay value only after the user saves a resale estimate.
  The eBay indicator remains gray and links to exact Sold and Completed results
  until then.
- Release acceptance includes the exact 700-lot catalog `769459`: verify visible
  Amazon values populate where identity and evidence match, failures remain
  retryable rather than becoming false no-match results, eBay stays manual, and
  Chrome's installed extension reports the release version before testing.

## v0.3.13 browser-backed Amazon transport

- Chrome uses one reusable minimized popup window containing one top-level
  Amazon search tab. The helper stays unfocused, navigates serially, and closes
  after 60 idle seconds. Never create one tab per lot or switch the user's
  selected HiBid tab.
- The Amazon content script accepts results only when a short-lived token, the
  stored request marker, the helper tab ID, the sender origin, and the top frame
  all agree. Raw HTML, cookies, and account data never cross into HiBid.
- Offscreen frames and response-header rewriting were removed: Amazon loaded in
  the frame, but Chrome did not inject the parser into that child context.
- Chrome acceptance on catalog `769459` proved the installed `v0.3.13`, one
  helper tab, HiBid remaining selected, and visible exact-match values including
  Citicr `$25.99`, PONY DANCE `$38.95`, and SONOFF `$36.90`.
- The same run caught and fixed a false snorkeling-mask/anti-fog-spray match.
  Descriptive title compounds such as `anti-fog` are not model identifiers;
  uppercase manufacturer codes such as `NT-USB+` remain supported.

## v0.3.23 donor transport parity

- The helper-tab and persisted catalog-wide cooldown paths are retired. Amazon
  research now mirrors `hibid-enhancer-suite`: anonymous Amazon.com requests,
  six concurrent lookups per batch, 350 ms between batches, per-lot failure
  isolation, in-flight joining, and a 12-hour normalized-evidence cache.
- Never cache or replay a challenge response, and never stop the remaining
  catalog because one lookup is challenged. No Amazon tabs or windows open.
- Preserve HiBid GraphQL's `estimate` field. Port the donor's extraction of
  `Retail`, `MSRP`, `Est. Retail Price`, and estimate-range highs as an
  auctioneer-provided provisional fallback. Label it `Retail`, not `Amazon`,
  and keep its tooltip explicit that live Amazon verification is still needed.
- Matcher hard evidence includes package counts, colors, materials, dimensions,
  volumes, speed/mode counts, and mutually exclusive product families. The
  catalog corpus covers masks versus spray, kickballs versus football/soccer
  balls, vases versus planters, pasta-bowl sizes, and neck-fan speed variants.
- Chrome acceptance on catalog `769459` with installed `v0.3.23` proved 90/100
  visible lots priced after conservative matching and cache restoration. The
  final corpus rejects generic football/soccer/bash-ball candidates for the
  20-inch NERF kickball and rejects an 8-in-1 hub for the 9-in-1 ORICO lot while
  selecting a 9-in-1 candidate instead.

## v0.3.24 cross-auction identity gate

- A three-auction Chrome audit found that cached candidate sets could survive a
  matcher upgrade. Provider snapshots now use cache epoch `provider-v4`; older
  snapshots are not migrated into the active epoch.
- Normalize `qt` / `quart`, ounce, liter, and cup spellings before comparing
  product volume. Parse compact bundle notation such as `6x12oz` into both a
  package count and a per-item volume.
- Missing package-count or volume evidence is a hard rejection. A cheaper
  single basket cannot price a three-pack, and a carrier alone cannot price a
  nine-piece bakeware set.
- When Amazon truncates the visible result title, the product-link slug may add
  matching evidence while the human-facing title remains unchanged.
- Treat `clear` as transparency rather than a competing color when a chromatic
  color is also present, such as `clear blue glass`.
## v0.3.25 Amazon result integrity

- Background Amazon responses are parsed with `parse5`, mirroring the donor's
  DOM-based parsing instead of slicing raw HTML at `data-asin` offsets.
- Nested result elements are isolated before reading title, price, ASIN, URL
  slug, sponsored state, and condition. A neighboring variant cannot lend its
  price to the selected title.
- Provider cache epoch `v5` retires every snapshot created by the old parser.
- Release acceptance still requires live catalog evidence after updating the
  installed Chrome extension; a passing unit test alone is not completion.

## v0.3.26 same-ASIN wrapper correction

- Amazon's live result markup can put the actual title and price inside a
  nested wrapper carrying the same ASIN as the outer result.
- The tree parser traverses same-ASIN wrappers and excludes only nested results
  with a different ASIN. Cache epoch `v6` retires the failed `v0.3.25` run.

## v0.3.27 Amazon session transport correction

- Cold Chrome catalog verification exposed `HTTP 503` and `Failed to fetch` for nearly every anonymous Amazon request.
- The donor userscript's `GM_xmlhttpRequest` uses the user's normal browser session. Flippah now mirrors that behavior with credentialed, normal-cache extension fetches while retaining paced batches, bounded failures, and sanitized results.
- The provider cache epoch is `v7`, preventing older parse/no-match snapshots from masking the transport correction.

## v0.3.28 stable catalog redraw handling

- HiBid periodically replaces visible tile elements without changing the lots. The old mutation handler restarted the entire Amazon queue whenever those replacement nodes appeared.
- Flippah now fingerprints the sorted stable lot IDs and restarts only when that identity set changes, such as pagination or a genuine live-catalog update.
- Cosmetic/countdown redraws no longer erase in-flight Amazon results or trap a catalog at its first few batches.

## v0.3.29 unpacked-extension self reload

- The running background compares its loaded manifest version with the unpacked manifest on disk every two seconds while awake and every 30 seconds through an alarm.
- A changed semantic version calls `chrome.runtime.reload()` automatically. Developers still refresh the page under test, but no longer need to click Reload on `chrome://extensions` after every local install.
- Packed releases remain unaffected because their on-disk manifest cannot change underneath the running extension.

## v0.3.30 exact-evidence selection

- Amazon price is now a tie-breaker only among candidates with effectively equal identity scores.
- A cheaper candidate that omits a source attribute cannot undercut a complete match. Live acceptance caught a `$20.88` Vancasso bowl without color evidence outranking the exact pink `$25.99` listing; the exact listing now wins.

## v0.3.31 bounded Amazon detail enrichment

- Amazon search cards sometimes omit package count, dimensions, or variant text that exists on the exact product page.
- When a strong candidate is rejected solely for those hard attributes, Flippah fetches at most two same-origin Amazon detail pages, adds product-title/spec/variation evidence, and reevaluates conservatively.
- Brand, model, product-kind, accessory, used, and sponsored rejections never trigger this fallback; wrong products stay blocked.

## v0.3.32 attribute-only enrichment gate

- The first detail-enrichment gate incorrectly required positive evidence that the evaluator intentionally does not populate after a hard rejection.
- Eligibility now depends solely on every rejection being `attribute-missing` or `attribute-conflict`; any brand, model, kind, accessory, overlap, used, or sponsored problem still blocks detail requests.

## v0.3.33 retail identity edge cases

- Final candidate acceptance now mirrors scoring: when the auction lot is itself an accessory (cable, cord, stand, band, etc.), an exact Amazon accessory is allowed instead of being rejected as an add-on to a different product.
- Inferred brands tolerate a concatenated retail feature suffix such as `SAMYUCHOLED` matching Amazon's `SAMYUCHO`; the original brand remains intact and only a credible five-or-more-character maker stem is added as an alias.
- Live acceptance targets: the JSAUX 4 ft cable and SAMYUCHO two-piece LED cake stands must receive exact Amazon evidence after catalog analysis.

## v0.3.34 numeric manufacturer models

- A three-to-six digit token immediately following a credible leading brand is retained as a model, except ordinary four-digit years.
- This prevents products such as `Pelican 1490` from accepting a generic same-brand Pelican case that omits model `1490`.
- Numeric-model detection anchors to the detected brand wherever it appears, so catalog prefixes such as `Lot 9 |` cannot hide the model.

## v0.3.36 retail-condition cache repair

- Sanitization re-derives used/open-box/refurbished/renewed state from every Amazon candidate title instead of trusting an older serialized boolean.
- The provider cache generation advanced to `provider-v8`, preventing stale parser evidence from supplying a used price as new retail after a matcher release.

## v0.3.37 complete Amazon result titles

- Amazon result headings take precedence over image `alt` text because the latter can truncate before decisive condition text such as `(Renewed)`.
- Provider cache generation `provider-v9` prevents old truncated titles from being reused as new-retail evidence.
- The maintained parse5 document parser uses the same heading-first rule; this is the parser used by background Amazon fetches. Its cache generation is `provider-v10`.

## v0.3.51 final beta hardening

- Flippah already contains the donor-derived catalog-wide Amazon queue, paced
  batching, duplicate joining, twelve-hour cache, product extraction,
  condition checks, candidate matching, and account verdicts. Do not describe
  those capabilities as missing merely because the TypeScript implementation
  differs from the donor's userscript internals.
- The release package vendors only the reference calculator CSS. Compiled
  reference JavaScript is development evidence and must not be copied into
  `dist` or exposed as a web-accessible resource.
- Amazon research must use the direct background provider. The dormant helper
  window/content-script path was removed; a production build must not contain
  `flippahToken`, `amazon.browser.result`, or `chrome.windows` research code.
- CSV exports neutralize formula-leading cells, settings are bounded on read,
  and popup/options failures must be visible to the user.
- CodeInspectus is an adversarial release aid, not proof of complete security.
  Its findings against `legacy/tampermonkey` and `reference-build` are archived
  source findings; the Chrome manifest `key` is a public extension identity,
  not an API secret. Record scanner coverage limits alongside results.
- After every build, update `C:\Users\ashby\Documents\lotlens-local`, reload or
  auto-reload the Chrome extension, and verify the displayed version and a real
  HiBid page before creating the friend beta ZIP.

## v0.4.0 open-source research quality pass

- Canonical HiBid lot images receive an extension-owned, pointer-transparent
  full-size hover preview. Sandhills `img.axd` URLs retain the base `w=0&h=0`
  parameters and remove only the appended `h=<thumb>&w=<thumb>` pair. The
  feature is enabled by default through `fullSizeImageHover`.
- Complete export remains governed by exact stable-ID coverage. A separate
  non-blocking fidelity audit measures identity, title, URL, description,
  images, category, pricing, and status/time. Missing evidence is reported and
  never fabricated.
- Optional outcomes use `flippahOutcomeV1:<eventItemId>` local-storage records.
  They preserve the first predicted resale baseline, actual all-in, sold price,
  selling costs, channel, realized profit, and prediction error. Outcome CSV is
  offered only after at least one outcome exists.
- Inspiration and attribution live in `docs/OPEN_SOURCE_INSPIRATION.md` and
  `vendor/hoverzoom/LICENSE`. Automatic bidding, synthetic data, and broad JSON
  guessing remain excluded.

## v0.4.1 same-lot redraw repair

- HiBid may replace an entire lot tile after Watch/Unwatch while retaining the
  same event-item ID.
- A stable-ID signature proves catalog identity, but it does not prove
  Flippah-owned annotations remain mounted.
- Mutation handling distinguishes native HiBid redraws from Flippah's own DOM
  writes and reapplies cached annotations after a short debounce.
- Same-ID repairs must not rerun Amazon research or invalidate its cache.

## v0.4.2 independent price evidence

- Auctioneer estimates, stated retail/MSRP, seller values, and recommended bids
  are untrusted claims. They must not influence Amazon candidate selection,
  colored indicators, account verdicts, resale estimates, or maximum bids.
- LLM briefs explicitly instruct downstream research to ignore those claims.
- Condition pills use parsed structured fields and remain separate from price
  evidence; unknown and contradictory condition data must not be upgraded.

## v0.4.3 inline condition evidence and toolbar activity

- HiBid condition blocks may arrive as one inline string rather than one field
  per line. The shared parser must split every recognized label, decode numeric
  HTML spacing, and retain packaging, damage, functionality, and missing-parts
  evidence in analysis and exports.
- Condition chips preserve useful qualifiers such as `Used · very good` and
  `New · packaging flawed`; missing-parts and unable-to-test evidence may not be
  silently upgraded to an ordinary good-condition label.
- The browser-action badge shows a blue/green activity spinner while the active
  tab is scraping or researching prices. Scraping takes precedence, activity is
  tab-scoped, and the existing ending-soon count returns when work finishes.

## v0.4.4 book handoff placement

- Book-photo analysis is a toolbar workflow, not HiBid page chrome. Never mount
  `Analyze books` controls into the auction DOM.
- On an individual `/lot/*` route, the `Scraper` tab shows a separate `Books`
  section that triggers `flippah:auction.handoff.start` in the top content
  script.
- The content controller still performs challenge detection, exact-item
  GraphQL hydration, full physical-photo reconciliation, route-drift checks,
  and the paired local relay handoff.

## v0.4.5 repeated query identities

- HiBid can expose a product identity twice back-to-back in the title/lead
  input. Search-query normalization must collapse a repeated block of at least
  three tokens before Amazon/eBay URL construction.
- Modern annotations, saved query overrides, and the preserved legacy lot
  panel use the same behavior. Do not broadly deduplicate individual words;
  legitimate names such as `New York New York` must remain intact.

## v0.4.6 catalog cost ownership

- The preserved legacy bundle must not mount `.lotlens-catalog-chip` or show a
  blue `True cost` amount beside a lot title.
- Catalog tiles have one actionable cost display: the modern `All-in` amount
  beneath HiBid's next-bid control. The lot-page calculator remains available.

## v0.4.7 lot-page query identity

- HiBid lot headings are transient during Angular rendering. A partial heading
  such as `Lot # : S` is not a product identity; use the canonical `/lot/:id/:slug`
  fallback until the structured Lead or complete heading is available.
- Generic overrides such as `lot s` must be ignored. Detached plural suffixes
  may be repaired, but protect real variants such as `Series S` and `Model S`.

## v0.4.8 paired lot handoff

- The source branch restores the local lot handoff through a typed manifest and
  keeps authenticated eBay Product Research in its separate relay boundary.
- Handoff manifests retain source identity, full photo ordering, auction
  economics, and explicit privacy exclusions.

## v0.4.9 AI resale profile and evidence gate

- Generated briefs are seller-configured. Do not reintroduce a personal ZIP,
  city, vehicle, tax status, buyer premium, fee, profit, or ROI assumption.
- Options are the source of truth for the immutable profile; lot-specific
  auction terms override only their matching fallback.
- User-saved auction premium corrections override parsed premium text. User
  maximum bids cap, but never raise, a calculated recommendation. User-saved
  resale estimates remain hypotheses until direct sold evidence verifies them.
- `researchQueue` must preserve stable lot identity and use the shared product
  query builder. Mixed lots intentionally have no generic bundle search URL.
- The prompt must keep an evidence-first workflow, direct-sold-URL gate,
  deterministic fee/tax formulas, bounded research stop rules, and coverage
  reconciliation across every supplied source ID.

## v0.5.5 AuctionNinja parity and live redraw stability

- AuctionNinja category pages may expose the authoritative count only as
  `<number> results`; auction search fragments may call the count `<number>
  sales`. Both are valid completeness totals and must drive deterministic page
  enumeration even when no `Showing X-Y of Z` range exists.
- Release verification covered a 229-item category (`20 x 11 + 9`), a 47-sale
  auction search (`12 + 12 + 12 + 11`), and a 274-item sale catalog
  (`20 x 13 + 14`). Every run reconciled expected, collected, and unique stable
  IDs with zero failed pages or detail requests.
- Chrome unpacked-extension updates use a one-shot persisted marker. The old
  worker records the requested version before reloading; the new worker clears
  the marker before hard-refreshing supported tabs. This avoids loops while
  preventing an old page content script from surviving an extension update.
- On HiBid live pages, native visible current bid, next bid, bid count, status,
  and countdown remain authoritative. GraphQL `minBid` is never substituted for
  the displayed next bid when calculating all-in cost.
- Live HiBid redraws can briefly expose incomplete tile placeholders. Keep
  conclusive Amazon evidence (`matched`, `no_match`, or `low_confidence`) keyed
  by stable lot ID plus normalized query and ASIN override. Transient network
  failures remain retryable; manual rerun and cache clear intentionally discard
  retained evidence.
- Indicator DOM is replaced only when its render signature changes, and the
  strip reserves a stable two-line height. Countdown/redraw traffic must not
  alternate a priced lot back to a search pill or shift the auction grid.

## v0.5.16 evidence-before-paint and AuctionNinja visual parity

- List surfaces must not render a provisional Flippah annotation from partial
  DOM identity. This applies to HiBid catalog, livecatalog, search, Watchlist,
  Winning, and Outbid routes. Hydrate first, restore reusable evidence second,
  then paint once. Individual lot pages may render immediately because their
  complete detail DOM is the source.
- Whole-card live replacements are repaired synchronously when retained
  evidence exists. For a newly discovered stable ID, reserve the complete 52 px
  evidence row immediately with an accessible loading state; do not leave the
  row absent while hydration runs, because inserting it later shifts the grid.
- Retained Amazon evidence is reusable only when stable lot ID, normalized
  query, ASIN override, and a conclusive status all agree. Network, parse,
  challenge, and rate-limit failures remain retryable and cannot replace a
  known price with a missing-price action.
- AuctionNinja visual parity means a compact card in `.item-detail-box-right`
  after `.item-detail-btn`, plus a stable 52 px catalog evidence strip. Preserve
  native actions, typography scale, and page flow; keep manual query, resale,
  and quantity controls collapsed under Research details.
- Parse only the AuctionNinja `Item Description` and `Condition` sections for
  product evidence. Seller, pickup, auction, shipping, and buyer-premium prose
  is context, not item condition.
- A richer Amazon detail page may resolve a missing attribute, but it may not
  override a hard visible-title mismatch. Model numbers, package counts,
  dimensions, capacities, product family, and primary-vs-accessory identity
  remain rejection gates.
- Real-browser release proof is product-level: exact AuctionNinja source,
  exact Amazon evidence, visibly Sold eBay evidence, and screenshots for ten
  distinct products. Tests and code inspection do not substitute for this gate.
- Chrome acceptance passed on August 29, 2026. Ten high-frequency live runs
  covered about 25 seconds and lot turnover with zero missing annotation-row
  frames and zero Amazon price-to-search regressions; the native Winning filter
  rendered 12 scoped account rows.
- The ten-product AuctionNinja matrix, exact Amazon pages, explicitly Sold eBay
  samples, and 30 raw screenshots are recorded in
  `docs/flippah-v0.5.16-auctionninja-proof.md` and the ignored local
  `artifacts/auctionninja-proof-v0.5.16/` directory.

## v0.5.17 corpus-driven title reliability

- Query changes require a real-corpus replay, exact adversarial oracles, and
  identity-preservation tests. A handful of hand-picked titles is not an
  adequate release gate.
- The tracked public corpus is `tests/fixtures/title-corpus/public-lots-v1.jsonl.gz`.
  Its manifest records sanitizer limits, deterministic selection, source and
  content hashes, and record counts. Raw captures and generated reports stay in
  ignored `artifacts/title-corpus/` paths.
- Normalize HTML entities, Unicode compatibility forms, smart punctuation,
  zero-width characters, inventory wrappers, condition wrappers, retail-value
  claims, repeated phrases, and detached plural suffixes before URL creation.
  Keep legitimate repetition such as `New York New York` and real variants
  such as `Xbox Series S`.
- Hard identity is conservative and cross-family: model/part codes, ISBN,
  edition, volume, grading certificate, collectible number, mint mark,
  capacity, dimension, CPU/GPU suffix, and explicit bundle composition survive
  normalization and remain candidate rejection gates.
- Generated eBay searches are discovery URLs only. Sold proof still requires a
  canonical item URL plus independent sold provenance; active listings and
  manual resale estimates cannot satisfy the evidence gate.
- Installed-browser acceptance must inspect the actual content-script version,
  assert every eBay URL carries `LH_Sold=1` and `LH_Complete=1`, replay known
  failures on their lot pages, and cross pagination boundaries to expose stale
  Angular tile identity.
- The release record and corpus hashes live in
  `docs/flippah-v0.5.17-title-reliability-proof.md`. The mandated soak report is
  generated at `artifacts/title-corpus/soak-8h-v0.5.17.json`. The owner stopped
  it at 7.619 measured hours to begin sold-comp verification; retain the result
  as strong evidence but never describe it as an eight-hour pass.

## v0.5.18 eBay sold-comp truth

- A correctly generated Sold+Completed URL is only a research seed. It is not
  a sold comp and cannot support a resale value by itself.
- Prefer signed-in Seller Hub Product Research because it exposes actual sold
  records, longer history, and accepted Best Offer prices. Public Sold search
  is a fallback and must carry both `LH_Sold=1` and `LH_Complete=1`.
- Parse only an explicit Sold context. Preserve canonical item ID, item URL,
  query, source URL, timestamp, currency, sold price, shipping, condition, and
  source provenance. Never convert an Active row or manual estimate into sold
  evidence.
- Hidden public Best Offer amounts are price-unknown. Keep the sale event for
  audit but exclude it from median, range, and sample-size calculations.
- Deduplicate by canonical eBay item ID. Exhaust every planned query and page
  before returning terminal `insufficient`; a challenge is `blocked`, not
  `insufficient`.
- Comparable means same primary product, model/family, material variant,
  capacity/edition/region when relevant, quantity, and compatible condition.
  Reject accessories, replacement parts, manuals, packaging-only listings,
  parts-only/locked/untested conflicts, wrong models, and candidate-only
  bundles.
- Three actual-price comparable sales are the default minimum. Mixed variants
  may be shown as evidence but must remain terminal `insufficient` with
  `variant-ambiguous` detail until the source variant is known; do not label
  that state `verified`.
- This repository's parser/verifier is a development acceptance harness. Keep
  the generated HiBid/AuctionNinja extension free of eBay host permissions and
  signed-in account automation unless that product boundary is explicitly
  changed.
- The hostile review suite must continue rejecting untrusted Seller Hub URLs,
  contradictory Active tabs, challenge/partial-page threshold overrides,
  cards without explicit Sold evidence, unknown accepted Best Offer amounts,
  model-generation drift, inferred models for generic sources, non-contiguous
  pagination, word-quantity mismatches, locked devices, candidate-only bundles,
  conflicting duplicate records, foreign currencies, and zero-dollar rows.
- Keep book intake in the toolbar popup's `Scraper` tab. Do not remount the
  page-level `Analyze books in Flippah` card in the content script.

## v0.5.19 installed-runtime refresh

- Patch-bump after the final sold-evidence hardening so the unpacked Chrome
  install self-reloads. Reinstalling changed files under an unchanged semantic
  version is not browser acceptance: an already-running content script may
  still be the older build.
