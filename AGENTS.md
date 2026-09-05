# Browser Hygiene

## Repository and release orientation

- Maintained extension code is in `src/`; `legacy/tampermonkey/` is historical.
- Read `HIBID_ASSISTANT_BRAIN.md`, `docs/architecture.md`, and the relevant release document before changes.
- Chrome Store builds use `npm run package:store`; local release preparation uses `npm run release:chrome`.
- `npm run release:chrome -- --publish` submits the current committed version for review. Approval/publication and installed-client updates are separate evidence gates.
- Store executable updates come through Chrome's Store delivery. Never add remotely loaded hotfix JavaScript.
- Store credentials stay outside Git. Use short-lived service-account impersonation; never commit private keys or tokens.
- Tracked Git hooks live in `.githooks`: pre-commit checks whitespace and pre-push runs `npm test`. Activate with `git config core.hooksPath .githooks` in this repository; verify on each checkout.
- An unpacked-browser `no_update` result proves the button handled Chrome's response, not successful Store update delivery. A checksum receipt is not a digital signature.
- Keep book handoff UI in the popup's Scraper/Books section. The content script must not mount a book card on HiBid.

## Browser rules

- Do not create, name, or leave behind persistent browser tab groups or browser sessions for HiBid, AuctionNinja, Amazon, eBay, or extension testing.
- Do not call `nameSession()` for routine browser acceptance work. If browser tooling automatically creates a managed tab group, close every tab created in that group as soon as the proof is captured so the group disappears.
- Prefer one temporary agent-created test tab and reuse it throughout the current task.
- Track every tab the agent creates. Close all agent-created tabs before the turn ends, including after success, failure, interruption, or a browser challenge.
- Do not move, group, rename, close, or otherwise reorganize tabs that were already open for the user.
- When inspecting an existing user tab, leave it in its original tab and group state.
- Before the final response, explicitly perform browser cleanup and verify that no agent-created test tabs or tab groups remain.
- Keep a test tab open only while actively working. Reopen a temporary tab on the next browser task instead of preserving a standing HiBid tab group.
