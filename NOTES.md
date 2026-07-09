# Project Notes

This repo is the standalone home for the HiBid/Tampermonkey auction tools, separate from `DeadlockStreamer`.

## Hosted userscript

- Repo: https://github.com/AshbyCollado/hibid-userscripts
- Install URL: https://raw.githubusercontent.com/AshbyCollado/hibid-userscripts/main/hibid-bid-assistant.user.js
- The script uses `@updateURL` and `@downloadURL` pointing at that raw URL.

## HiBid auction assistant context

- Live catalog scraping expands visible lots through safe `Open More` / `Load More` style controls before copying JSON or the LLM brief.
- The LLM brief tells the model to search eBay sold/completed comps first and use rough math:
  - auction all-in cost = bid x 1.25
  - eBay net = sold price x 0.87 before shipping complications
- Auto-confirm remains controlled by the Tampermonkey panel checkbox.

## Local archive

Old screenshots, harnesses, and Deadlock-side copies were moved to:

`archive/deadlock-moved-2026-07-08/`

That archive is intentionally ignored by git.
