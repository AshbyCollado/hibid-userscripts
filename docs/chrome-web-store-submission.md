# Chrome Web Store Submission

**Store item ID:** `kfpfojddcfgglgbanijddljiaplifhga`

**Initial release:** Flippah `v0.5.45`

**Submitted for review:** September 4, 2026

**Dashboard status:** Pending review

**Publication mode:** Publish automatically after passing review

**Submitted package:** `flippah-by-alos-0.5.45-chrome-web-store.zip`

**Package SHA-256:** `DD2BE2B8DC2459E91A65D0C5D6B5D90104332505AB9F391519A885D2EED1DB41`

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

**Remote code justification:** No remote code is used. Every JavaScript module executed by Flippah is bundled inside the submitted extension package. Responses retrieved from supported auction and retail websites are handled only as data and are never evaluated or executed as code.

**Data handled:** Website content, limited web activity on supported auction and research sites, and user-provided settings or research notes.

Select these dashboard data categories conservatively:

- Financial and payment information: user-entered acquisition, fee, resale, and outcome values.
- Authentication information: the optional local Flippah application's pairing token, stored and used only on the same device.
- Location: optional state, ZIP, and research-radius settings.
- Web history: URLs for supported auction pages the user explicitly researches or saves.
- Website content: listing text, images, prices, terms, status, and links required for research and exports.

Leave personally identifiable information, health information, personal communications, and user activity unchecked. Certify all three limited-use statements.

**Data transfer:** Direct requests to HiBid, AuctionNinja, and Amazon.com for the disclosed research features; an eBay page opens only after a user clicks its link; optional loopback transfer occurs only after a user action. No data is sent to the developer.

**Privacy policy URL:** https://github.com/AshbyCollado/hibid-userscripts/blob/chrome-web-store/PRIVACY.md

**Support URL:** https://github.com/AshbyCollado/hibid-userscripts/issues

## Reviewer Test Instructions

Use this text in the dashboard's 500-character field:

> No credentials are required. On a public HiBid lot or catalog, verify compact Amazon, eBay Sold, and condition controls appear without replacing auction controls. Open the toolbar popup: Watchlist is first; Scraper exports the current page as JSON or an AI brief. On a public AuctionNinja sale, verify the same additive research controls and export. The optional localhost book handoff stays disabled unless paired in Options. Flippah never bids, buys, watches, or changes account data.

No paid account or reviewer credentials are required for public-page testing. Personalized account pages are optional and use the reviewer's own existing site session.

## Updates

Chrome automatically updates Store-installed copies after an approved release is published. For each release, increment `package.json` and the generated manifest version, run `npm test` and `npm run package:store`, complete the live Chrome acceptance check, and upload the new Store ZIP to this same item.

After the first release is approved, the Chrome Web Store API v2 can automate upload and publication from CI using scoped credentials and the item ID above. Store credentials must remain in repository secrets and must never be committed.
