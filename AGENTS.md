# Browser Hygiene

- Do not create, name, or leave behind persistent browser tab groups or browser sessions for HiBid, AuctionNinja, Amazon, eBay, or extension testing.
- Do not call `nameSession()` for routine browser acceptance work. If browser tooling automatically creates a managed tab group, close every tab created in that group as soon as the proof is captured so the group disappears.
- Prefer one temporary agent-created test tab and reuse it throughout the current task.
- Track every tab the agent creates. Close all agent-created tabs before the turn ends, including after success, failure, interruption, or a browser challenge.
- Do not move, group, rename, close, or otherwise reorganize tabs that were already open for the user.
- When inspecting an existing user tab, leave it in its original tab and group state.
- Before the final response, explicitly perform browser cleanup and verify that no agent-created test tabs or tab groups remain.
- Keep a test tab open only while actively working. Reopen a temporary tab on the next browser task instead of preserving a standing HiBid tab group.
