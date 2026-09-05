# Chrome Web Store Submission

## Listing

**Name:** Flippah by ALOS

**Category:** Shopping

**Language:** English (United States)

**Summary:** Auction research, true-cost analysis, watchlists, and verified HiBid and AuctionNinja exports for smarter flips.

**Detailed description:**

Flippah adds practical deal-research tools to HiBid and AuctionNinja while leaving each auction site's bidding controls intact.

- Calculate all-in acquisition cost from the current or next bid, buyer premium, tax, and known shipping.
- Compare compatible products with Amazon.com retail evidence and open precise eBay Sold and Completed searches.
- See compact condition, quantity, and evidence indicators directly on supported auction pages.
- Maintain a local watchlist, notes, query corrections, and resale estimates.
- Export complete, coverage-checked auction data as JSON or an LLM research brief.
- Optionally send an individual HiBid lot to a Flippah application running on the same computer.

Flippah is read-only. It does not bid, watch, unwatch, buy, publish, check out, or change auction-account data for the user.

Flippah handles supported auction-page content only to provide the features above. Research data and user settings stay in browser-managed storage; Flippah has no developer-operated analytics or data-collection server. See the privacy policy for details.

## Single Purpose

Help auction shoppers research and export listings on HiBid and AuctionNinja by calculating acquisition cost, presenting product evidence, and maintaining user-requested local research data.

## Permission Justifications

**storage:** Stores settings, watchlist records, cached research, scrape checkpoints, notes, and user corrections so research survives navigation and popup closure.

**alarms:** Maintains time-sensitive watchlist badges and safely expires abandoned, user-initiated local handoff reservations after service-worker suspension.

**tabs:** Finds the user's active supported auction page and manages only tabs opened by explicit research or local-handoff actions.

**downloads:** Saves CSV exports and sanitized diagnostics only when the user clicks a download action.

**clipboardWrite:** Copies JSON exports, LLM briefs, CSV data, and sanitized diagnostics only when the user clicks a copy action.

**HiBid and hibid-api.io hosts:** Reads the visible auction and authoritative listing responses required for calculations, research annotations, and coverage-checked exports.

**AuctionNinja hosts:** Reads the visible auction and listing detail pages required for calculations, annotations, and exports.

**Amazon.com host:** Retrieves product-search pages and product details to show retail evidence. No remote code is loaded or executed.

**127.0.0.1 host:** Sends a selected lot to an optional Flippah application on the same device after an explicit user action. The destination is restricted to loopback.

## Privacy Practices

**Remote code:** No.

**Data handled:** Website content, limited web activity on supported auction and research sites, and user-provided settings or research notes.

**Data transfer:** Direct requests to HiBid, AuctionNinja, and Amazon.com for the disclosed research features; an eBay page opens only after a user clicks its link; optional loopback transfer occurs only after a user action. No data is sent to the developer.

**Privacy policy URL:** https://github.com/AshbyCollado/hibid-userscripts/blob/chrome-web-store/PRIVACY.md

**Support URL:** https://github.com/AshbyCollado/hibid-userscripts/issues

## Reviewer Test Instructions

1. Open any public HiBid catalog or lot page, or any public AuctionNinja sale page.
2. Confirm that Flippah adds compact Amazon/eBay/condition research controls without replacing the site's native bid or watch controls.
3. Open the Flippah toolbar popup. The Watchlist tab opens first; the Scraper tab can export the supported current page.
4. On a HiBid lot, open the popup's Book analysis section. The optional local-app handoff remains disabled until the user pairs a localhost application in Options.
5. The extension never performs bids, purchases, watchlist mutations, checkout, or account changes.

No paid account or reviewer credentials are required for public-page testing. Personalized account pages are optional and use the reviewer's own existing site session.
