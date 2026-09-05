# Flippah Privacy Policy

Effective date: September 4, 2026

Flippah is a browser extension for researching auction listings on HiBid and AuctionNinja. It calculates acquisition costs, displays product-research links and evidence, maintains a local watchlist, and exports auction data at the user's request.

## Data Flippah Handles

Flippah reads auction website content needed for its visible features, including listing titles, descriptions, URLs, images, auction terms, prices, bid counts, status, and closing times. It also handles settings and information a user chooses to enter, such as tax and fee preferences, research instructions, notes, watchlist entries, query corrections, quantity confirmations, and resale estimates.

Flippah does not read or store passwords, payment-card data, authentication cookies, private messages, or bidder identity. Account-page exports deliberately exclude account tokens and private account fields.

## How Data Is Used

Auction content is used only to provide the extension's user-facing auction research, calculations, annotations, watchlist, and export features. User-entered settings and corrections are used only to customize those features.

Most data stays in browser-managed local storage. General settings use Chrome storage sync when the browser enables it, so Chrome may synchronize those settings through the user's Google account. Watchlist data, notes, research evidence, diagnostics, and optional local-app pairing data are stored locally on the device until the user clears them or removes the extension.

Flippah has no developer-operated analytics, advertising, telemetry, or data-collection server. The developer does not receive, sell, rent, or use extension data for advertising or credit decisions.

## Network Requests And Sharing

Flippah communicates directly with the following services only to provide its visible features:

- HiBid, HiBid's search service, and AuctionNinja to read the auction pages and listing records the user is viewing or exporting.
- Amazon.com to retrieve product-search evidence for the extension's retail comparison. The research query is derived from auction listing content. Requests go directly from the user's browser to Amazon and are subject to Amazon's own privacy practices.
- eBay only when a user opens an eBay Sold and Completed search link. Flippah does not request eBay host access or scrape the user's eBay account.
- An optional Flippah application on `127.0.0.1` when the user explicitly sends a lot to that application. This loopback transfer stays on the user's device and uses a locally stored pairing token.

The browser or the destination website may send its own cookies with requests to that same website. Flippah does not read, copy, log, or transmit those cookies to the developer or another service.

## Clipboard, Downloads, And Diagnostics

Flippah writes JSON, LLM briefs, or CSV data to the clipboard or a downloaded file only after a user requests that action. Sanitized diagnostics exclude cookies, authorization headers, account tokens, bidder identity, payment information, and typed private fields.

## Chrome Permissions

- `storage`: saves settings, watchlist records, cached research, job checkpoints, and user corrections.
- `alarms`: updates time-sensitive watchlist state and expires abandoned local handoff reservations.
- `tabs`: finds the active supported auction page and manages tabs opened by an explicit user action.
- `downloads`: saves user-requested CSV exports and sanitized diagnostics.
- `clipboardWrite`: copies user-requested exports and diagnostics.
- Host access for HiBid, `hibid-api.io`, AuctionNinja, and Amazon.com: reads only the pages and responses required for auction and retail research.
- Host access for `127.0.0.1`: supports the optional user-initiated handoff to a local Flippah application.

## Limited Use

Flippah's use of website content and browsing activity is limited to the extension's disclosed auction-research features. It is not used for advertising, profiling unrelated to those features, or transferred for sale. Flippah does not use Google APIs other than browser-provided Chrome extension services.

## Changes And Contact

Material changes to this policy will be reflected here and in the Chrome Web Store disclosure. Questions, support requests, and security reports can be submitted at https://github.com/AshbyCollado/hibid-userscripts/issues.
