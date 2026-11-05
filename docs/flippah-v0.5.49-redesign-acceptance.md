# HiBid Redesign Recovery 0.5.49

## Baseline And Ownership

November 4, 2026: start from reviewed release commit 465ecd0 (0.5.48),
on branch codex/hibid-redesign-recovery. The Desktop development checkout
and its private audit artifacts remain untouched. Existing untracked Store
promo artwork is unrelated to runtime compatibility and is preserved.

Chrome inspection observed content version 0.5.47; Store status confirmed
0.5.48 published at 100%. Neither is acceptance of the new recovery build.

## Observed Markup

- Tile: app-auction-lot-card inside div.lot-tile.lot-card#lot-EVENT_ID.
- Separate app-auction-lot-card__lot-number and __title links.
- Native current bid in __amount; currency in __currency-code.
- Next bid in footer app-button label, sometimes an anchor to registration.
- Condensed/full: app-lot-condensed and app-lot-full, each with native bid text.
- Watchlist: app-watched-auction-header siblings delimit card groups.
- Details: app-lot-details-subpanel, app-lot-buttons, app-lot-image-gallery.
- Search promotions remain when the canonical lot results say No matches found.
- Default Current Bids uses /account/currentbids; Past Bids uses /account/pastbids.

Public reproduction sources: catalog 791252 (November 8 Washington Surplus),
its g=40196 electronics filter, lot 329316725 (Dyson SV47), and global
/lots/40196/computers-and-electronics. Counts are observations, not permanent
live expectations: 100/2420 catalog rows, 43 filtered electronics rows,
19 PlayStation 5 Pro search rows, and a zero-match sentinel search.

## Release Gates

| Surface | Required proof | Status |
| --- | --- | --- |
| Catalog tile/condensed/full | One row per exact ID; links available during research | Observed 43/43 rows in all three installed Chrome views; copied JSON reconciled 43 expected/copied/unique |
| Filtered/empty search | Scope/count agreement; no promotion leakage | Installed JSON: filtered search 19/19 unique, empty search 0/0 with seven promotional links excluded |
| Live catalog | Stable evidence through native bid/redraw updates | The tested livecatalog URL redirects natively to catalog/791252; canonical view has 100/100 annotations. Live bid mutation/redraw regressions pass; no bid was placed to induce an update |
| Lot details | Calculator placement, saved inputs, fees, research, gallery | Installed host follows APP-LOT-BUTTONS, published premium 20%, Sold/Completed links, draft/focus preservation, gallery and 390px stacked layout observed |
| Watchlist | Current account DOM; scoped groups and complete export | Installed JSON reconciled 67 expected/copied/unique initially; later native total changed to 65. Stop/retry export reconciled 65/65 unique with no reader tab left behind |
| Current/Winning/Outbid | Correct route, genuine empty states and verdicts | Installed Chrome exports independently confirmed zero expected/copied/unique for each native empty route |
| Past bids/watchlist | Selected-auction isolation; history/export only | Past Bids 14/14 unique, including ipp=10 pagination; Past Watchlist 6/6. Both scoped only to auction 787572 with descriptions/images on every record |
| Popup/options | Reopen, cancellation/retry, JSON/AI export, settings | Installed reopen restores selected history auction; Stop disables exports and retry completes. JSON and AI copies retain scope. Saved local Watchlist fixture and calculator tax settings remain visible; delayed-render regression passes |
| Chrome installation | Actual content version, screenshots, native controls | Installed content and popup 0.5.49 observed; desktop/narrow screenshots retained, original controls remain outside extension-owned Shadow DOM |
| Automated checks | Typecheck, full suite, title/legacy regressions, packages | Final suite 2554 passes, two skips, zero failures; legacy 278 passes; title corpus 11 passes; both builds/typecheck and 16-file Store validation pass |
| AuctionNinja | Shared-code smoke regressions | Installed catalog smoke: 20 research rows, condition and all-in controls, preserved Sold/Completed links; screenshot retained |
| Waterfox | Build compatibility only; installed acceptance not claimed | Development build passed; installed testing not performed |
| Store | Upload, review, publication, client delivery reported separately | Local Chrome 0.5.49 accepted. Submission follows the reviewed commit through the local publisher; consult its receipt/live API for upload/review/publication states. Store-installed delivery is not inferred from the unpacked installation |

No HiBid bidding, native watch changes, registration, account edits, or
separate Flippah book-lot imports are authorized by these verification steps.
Authenticated captures must exclude private notes, max bids, identities,
credentials, and ad/tracking payloads before becoming regression fixtures.

## Findings And Checks

- Authenticated Watchlist: 67 lots across 10 auction groups. Past Bids: 230
  lots over three pages; selected auction 787572: 14. Past Watchlist: 276.
- Catalog category query `g=40196` was ignored by route parsing. An installed
  export enumerated/hydrated 2420, while the DOM showed 43. Coverage rejected
  this correctly. The numeric category now reaches both API request builders;
  installed retry proved 43/43. An additional complete catalog export reconciled
  2420 expected/copied/unique IDs with all physical photo audits reconciled.
- Actual condensed markup wraps a strong lot number and h2 title in one link.
  The adapter now reads these separately; a real-structure regression covers it.
- Native bid multipliers are distinct from product titles such as X100 and 4 x 6.
- Cache-wait links, focused provider actions, unsaved outcome drafts, and expanded
  evidence sections have targeted regressions. Authenticated pagination rejects
  changed filter scopes, duplicate pages, changing totals, redirects, and loading.
- Independent review found the quantity/focus/filter issues above; bounded
  follow-up review found no remaining must-fix in those changes.
- Final complete suite: 2554 passed, two skipped, zero failed. Typecheck and
  both development/Store browser builds passed. Legacy 278 and title corpus
  11 passed separately.
- CodeInspectus high finding at content/auction-economics.ts:134 is a false
  positive: PAYMENT_CONTEXT is a RegExp and `.exec()` is regex matching, not
  shell execution. No remediation applied. JavaScript baseline pack coverage
  was partial; three valid TypeScript files were rejected by its parser. The
  scanner reported a stale dependency database; no engine updates were made.
- Chrome screenshots are local-only under artifacts/redesign-0.5.49/. No
  screenshots or private account snapshots are part of the public source diff.

## History Failure And Recovery

The owner's November 5 diagnostic (0.5.49.1) reproduced a 20-second
account-rendering timeout. Chrome's console proved that HiBid rejects
embedding with Content-Security-Policy frame-ancestors 'none'. The iframe
fallback was removed, not exempted from that policy. A rendered-page reader
now uses a bounded inactive top-level HiBid tab, scoped to the source account
route and filters, with normalized records only, cancellation, persisted
ownership, alarm cleanup, and no new permissions. Busy roots, partial ranges,
stale paginator values, login/challenge pages, route drift, and duplicate IDs
cannot become successful empty exports.

Installed Chrome 0.5.49 then copied 14/14 unique lots from auction 787572,
including when the native page size was reduced from 100 to 10. Both exports
contained only that auction, with descriptions and images on all 14 records.
Temporary development versions 0.5.49.1 through 0.5.49.5 are not Store releases.
The final package version remains 0.5.49.

The final installed history run at ipp=25 completed after the popup was closed;
reopening on Watchlist and selecting Scraper restored auction 787572 and its
14 complete records. The copied AI search packet parsed as JSON with eight
selected records and an immutable 19-ID source manifest. The full catalog's
first/middle/final physical photo descriptor counts were 1/2/4 and matched
their provider-reported counts; none of the 2420 photo audits was unreconciled.
Descriptions are not invented for records without source description text.

The new test command caps file concurrency at two; it still runs the complete
suite and avoids the observed resource spikes from unbounded test processes.
Legacy userscript regressions: 278 passes. Title-corpus regressions: 11 passes.
Both development and Store channel builds generated Chrome and Waterfox;
Store-package validation accepted 16 files and excluded unpacked auto-reload.
No installed Waterfox or real notification-delivery claim is made.

The final installed exports explicitly identify selected-auction scope 787572:
Past Bids 14/14 unique and Past Watchlist 6/6 unique. Every row agrees with
that scope. The copied history AI batch retains it in masterContext, contains
eight selected records, and keeps the immutable 14-record source manifest.
Delayed Watchlist callbacks cannot replace a newly selected Scraper view.

A cache-reload check retained all 22 priced Amazon rows among 43 annotated
records, with zero lost prices and zero research-row height changes. This
does not claim that a real incoming bid was induced. Current Bids, Winning,
and Outbid were genuinely empty; complete zero-record exports are retained.

The scoped background SAST, secrets, and AI checks reported no findings.
The JavaScript/TypeScript native pack ran; unrelated platform packs were not
applicable. Dependency scanning was not requested and its database is stale;
this is not a comprehensive security certification.
