// ==UserScript==
// @name         FlipperAddon by ALOS
// @namespace    http://tampermonkey.net/
// @version      0.7.52
// @description  Modular resale scraper/exporter for HiBid, GovDeals, AAR Auctions, AuctionNinja, eBay, and Facebook LLM/JSON workflows.
// @updateURL    https://raw.githubusercontent.com/AshbyCollado/hibid-userscripts/main/hibid-bid-assistant.user.js
// @downloadURL  https://raw.githubusercontent.com/AshbyCollado/hibid-userscripts/main/hibid-bid-assistant.user.js
// @match        https://hibid.com/lots*
// @match        https://hibid.com/lots/*
// @match        https://hibid.com/catalog/*
// @match        https://hibid.com/livecatalog/*
// @match        https://hibid.com/account/watchlist*
// @match        https://hibid.com/account/currentbids*
// @match        https://hibid.com/*
// @match        https://*.hibid.com/*
// @match        https://bid.ajwillnerauctions.com/ui/auctions/*
// @match        https://www.ebay.com/sh/lst*
// @match        https://www.ebay.com/mys/*
// @match        https://www.facebook.com/marketplace/you/*
// @match        https://www.facebook.com/marketplace/profile/*
// @match        https://www.auctionninja.com/auctions*
// @match        https://www.auctionninja.com/bid-history*
// @match        https://www.auctionninja.com/followed-items*
// @match        https://www.auctionninja.com/items-won*
// @match        https://www.auctionninja.com/*
// @match        https://aarauctions.com/auctions*
// @match        https://aarauctions.com/servlet/Search.do*
// @match        https://aarauctions.com/*
// @match        https://www.govdeals.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_setClipboard
// @grant        GM.setClipboard
// @grant        GM_registerMenuCommand
// @grant        unsafeWindow
// @grant        window.onurlchange
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const PANEL_ID = 'flipperaddon-panel';
  const APP_NAME = 'FlipperAddon by ALOS';
  const APP_SHORT_NAME = 'FlipperAddon';
  const SCRIPT_VERSION = '0.7.52';
  const LEGACY_PLAN_KEY = 'hibid-bid-assistant-plan-v1';
  const LEGACY_PLAN_MIGRATED_KEY = 'flipperaddon-legacy-plan-migrated-v1';
  const PLAN_KEY_PREFIX = 'flipperaddon-max-plan-v2';
  const AUTO_REFRESH_KEY = 'flipperaddon-auto-refresh-v1';
  const MINIMIZED_KEY = 'flipperaddon-minimized-v1';
  const DEBUG_ENABLED_KEY = 'flipperaddon-debug-enabled-v1';
  const DEBUG_LOG_KEY = 'flipperaddon-debug-log-v1';
  const AAR_RESEARCH_SETTINGS_KEY = 'flipperaddon-aar-research-settings-v1';
  const DEBUG_LOG_LIMIT = 200;
  const OUTBID_WATCHLIST_URL = 'https://hibid.com/account/watchlist?status=OUTBID';
  const LEGACY_SCRAPER_IDS = [
    'hibid-lot-catalog-scraper-copy-button',
    'hibid-lot-catalog-scraper-json',
    'hibid-scraper-copy-button',
    'hibid-scraper-json',
    'auction-scraper-copy-button',
    'auction-scraper-json'
  ];
  const LEGACY_PANEL_IDS = [
    'hibid-bid-assistant-panel'
  ];
  const MENU_COMMANDS = [
    'Remount FlipperAddon',
    'Toggle FlipperAddon Debug Mode',
    'Copy FlipperAddon Debug Log',
    'Clear FlipperAddon Debug Log',
    'Copy HiBid Lots Now'
  ];
  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  const HIBID_STATE_FETCH_TIMEOUT_MS = 6500;
  const HIBID_STATE_HYDRATION_WAIT_MS = 5000;
  const HIBID_STATE_HYDRATION_POLL_MS = 100;
  const HIBID_STATE_SCRAPE_MAX_MS = 15000;
  const HIBID_STATE_MAX_PAGES = 24;
  const HIBID_DOM_SCRAPE_MAX_MS = 90000;
  const HIBID_DOM_SCRAPE_MAX_STEPS = 500;
  const DEBUG_PREFIX = '[FlipperAddon]';
  const AUCTION_RESALE_COORDINATOR_PROMPT = `You are an auction resale analysis coordinator.

Goal:
Find profitable resale deals from a full auction export without missing hidden value. Do not skim only obvious items. Every lot must be parsed, classified, and included in the final spreadsheet.

Context:
I am buying to resell for profit. I do not want $10-$20 time-wasters unless they are tiny, easy, or bundled into a larger profitable pickup. I may be driving about an hour and I am in a sedan, so bulky items need much higher profit and must be marked with sedan risk.
Sold/completed comps first, profit second, hunches last.

Core rule:
Coverage first, confirmation second. Every lot gets classified. Nothing silently disappears.

Parsing / Mandatory Analysis:
## Mixed / Group Lot Rule — Mandatory Component Extraction

Never classify a lot solely from its title. For every lot titled or described as
"group," "assorted," "contents," "equipment," "rack," "cabinet," "with components,"
"electronics," "office," or similar:

1. Read the full description and inspect every available photo before assigning a status.
2. Extract every identifiable brand, model, quantity, and potentially resellable component into a component list.
3. A generic group lot may not be marked Garbage until each named or visually identifiable component has been checked for resale relevance.
4. If a component has meaningful possible resale value, research that component separately. Do not value the lot only as a generic bundle.
5. For every mixed lot, record:
   - identified components and models
   - what is visibly confirmed versus description-only
   - portability / CT200h fit
   - removal risk, missing-power-cable risk, lock/reset risk, test risk, and completeness risk
   - conservative hammer max and all-in max, or an explicit PASS reason
6. Create a visible \`Mixed Lot / Component Review\` tab or section containing every lot that triggered this rule, including passes. Do not bury these rows only in Garbage.
7. Pin any portable mixed-lot candidate with a strict-profit path into \`Best Bids\`, even if its generic title would otherwise rank poorly.
8. In the coverage audit, report:
   - number of mixed/group lots reviewed
   - number with extracted named components
   - number elevated to a lead
   - number passed with an explicit component-level reason

A lot with named models in its description or photo must receive \`component_reviewed = yes\`.
The important sentence is: "A generic group lot may not be marked Garbage until each named or visually identifiable component has been checked."

When a description or image is unavailable in the export, say so explicitly in the row and do not invent component details. Use every supplied description field, raw text field, and image URL before deciding that a lot has no resale value.

Statuses:
- Confirmed Lead: exact or close sold comps support meaningful profit after all fees.
- Research Lead: possible value, but proof is incomplete, active-only, model uncertain, or condition-sensitive.
- Local Flip Lead: better for Facebook/Craigslist/local marketplace than eBay.
- Bundle/Parts Lead: value comes from quantity, parts, accessories, or splitting.
- Garbage: unlikely worth time.

Do not mark something garbage just because the title is generic.
Look for hidden value in vague titles, bundles, quantities, pro gear, tools, electronics, restaurant equipment, industrial, medical, camera/audio, baby gear, and local bulky flips.

Profit math:
Assume auction buyer premium is 15%.
Assume sales tax applies to hammer price plus buyer premium unless stated otherwise.
Use sales tax rate: [INSERT TAX RATE].
Rough quick math: auction all-in = bid x 1.25 for buyer premium/tax estimate; eBay net = sold price x 0.87 before shipping complications.
Assume eBay resale has seller fees and promoted listing friction:
- eBay final value fee default: 13.25%
- Promoted listing ad rate default: 2%
- Total default eBay selling friction: 15.25%

Assume buyer pays shipping, so shipping is not deducted from profit unless the item is oversized, fragile, hard to pack, likely to need packing materials, or commonly causes shipping damage/returns.

For local flips:
- Do not apply eBay fees.
- Use lower local resale estimate.
- Apply extra caution for pickup, storage, meetup time, and sedan fit.

Calculations:
auction_all_in_cost = hammer_price * 1.15 * (1 + sales_tax_rate)

ebay_net = estimated_resale * (1 - 0.1525)

estimated_net_profit = ebay_net - auction_all_in_cost

recommended_max_bid = ((estimated_resale * (1 - 0.1525)) - target_profit) / (1.15 * (1 + sales_tax_rate))

For local flips:
local_net_profit = estimated_local_resale - auction_all_in_cost
recommended_max_bid = (estimated_local_resale - target_profit) / (1.15 * (1 + sales_tax_rate))

Default target profit:
- Small easy ship item: minimum $30 profit
- Medium item: minimum $50 profit
- Heavy/fragile/restaurant equipment: minimum $100-$150 profit
- One-hour pickup trip: total expected profit should be $150+ minimum, preferably $250+
- Sedan-risk bulky item: only include if profit is large enough to justify logistics

Comping rules:
- Use eBay sold/completed listings first.
- Exact sold comps are strongest.
- Close sold comps are acceptable but mark speculative.
- Active listings alone cannot make a Confirmed Lead.
- If proof is only an eBay search/shop/category page, mark Research Lead unless there is very strong market context.
- For local-only bulky items, use local market intuition only if potential profit justifies pickup.
- Every lead needs proof URL or must be explicitly marked local/speculative.

Proof levels:
- exact_ebay_sold
- close_ebay_sold
- sold_search_page
- active_only
- retail_reference
- local_speculative
- no_proof

Only exact_ebay_sold or close_ebay_sold can be Confirmed Lead.

Spreadsheet output:
Create an Excel workbook with these tabs:
- Best Bids
- Research Leads
- Local Flip Leads
- Bundle/Parts Leads
- All Lots
- Garbage
- Audit

Required columns:
row_id
lot
title
current_bid
next_bid
quantity
category
status
estimated_resale
estimated_local_resale
buyer_premium_rate
sales_tax_rate
auction_all_in_cost
ebay_fee_rate
promo_fee_rate
ebay_net
target_profit
estimated_net_profit
breakeven_bid
recommended_max_bid
proof_type
proof_urls
reason
risk_notes
sedan_fit
shipping_assumption
assigned_agent
audit_flag

Classification instructions:
1. Parse every lot into normalized rows.
2. Assign stable row_id and lot number.
3. Identify quantity and {each} lots. Treat {each} lots carefully because bid may be per unit.
4. Estimate resale conservatively.
5. Calculate max bid backwards from target profit.
6. If current bid is already above recommended max bid, mark audit_flag: current_bid_over_max.
7. If item is bulky, fragile, restaurant equipment, refrigerated, gas-powered, or needs truck/rigging, mark sedan_fit as No or Maybe.
8. If sell-through is uncertain, mark Research Lead, not Confirmed Lead.
9. Garbage rows must have a reason, not a blank dismissal.

Garbage reason must be one or more of:
- low ASP
- no sold comps
- active-only weak proof
- current bid too high
- bulky/sedan risk
- refrigeration risk
- gas/electrical install risk
- hygiene risk
- missing-parts risk
- generic saturated item
- slow local sale
- admin/info lot

Audit requirements:
- 100% of lots must appear in All Lots.
- Missing row count must be zero.
- Duplicate row IDs must be zero.
- Every non-garbage row must have proof URL or be marked local_speculative.
- Every Confirmed Lead must have exact or close sold-comp proof.
- Recheck any Garbage row with brand/model/quantity/value signals.
- Recheck every {each} lot for per-unit bid math.
- Recheck all current bids over recommended max bid.

Final summary:
After creating the spreadsheet, summarize:
- total lots parsed
- total confirmed leads
- total research leads
- total local flip leads
- total bundle/parts leads
- total garbage
- missing row count
- top 10 best bids
- max bid for each
- what needs inspection
- whether pickup is worth the drive

Tone:
Be skeptical, but do not be lazy. The mission is to avoid missing profitable deals while not fooling me with fake profit before fees.`;

  function safeClone(value) {
    if (value === undefined) return undefined;
    try {
      return JSON.parse(JSON.stringify(value, (_key, item) => {
        if (typeof item === 'function') return '[function]';
        if (item && typeof item === 'object') {
          const ctor = item.constructor?.name || '';
          if (/^(HTML|SVG|Window|Document|Node)/.test(ctor)) return `[${ctor}]`;
        }
        return item;
      }));
    } catch {
      return String(value);
    }
  }

  function getDebugLog() {
    try {
      const stored = GM_getValue(DEBUG_LOG_KEY, []);
      return Array.isArray(stored) ? stored : [];
    } catch {
      return [];
    }
  }

  function setDebugLog(entries) {
    try {
      GM_setValue(DEBUG_LOG_KEY, entries.slice(-DEBUG_LOG_LIMIT));
    } catch {
      // Tampermonkey storage may be unavailable in tests or blocked pages.
    }
  }

  function clearDebugLog() {
    setDebugLog([]);
  }

  function formatDebugLog(entries = getDebugLog()) {
    return entries.map(entry => {
      const suffix = entry.data === undefined ? '' : ` ${JSON.stringify(entry.data)}`;
      return `${entry.at} ${entry.version} ${entry.url} ${entry.message}${suffix}`;
    }).join('\n');
  }

  function getStoredDebugEnabled() {
    try {
      return Boolean(GM_getValue(DEBUG_ENABLED_KEY, false));
    } catch {
      return false;
    }
  }

  function saveDebugEnabled(value) {
    try {
      GM_setValue(DEBUG_ENABLED_KEY, Boolean(value));
    } catch {
      // Tampermonkey storage may be unavailable in tests.
    }
  }

  function debug(message, data) {
    if (!getStoredDebugEnabled()) return;
    const entry = {
      at: new Date().toISOString(),
      version: SCRIPT_VERSION,
      url: typeof location !== 'undefined' ? location.href : '',
      message,
      data: safeClone(data)
    };
    try {
      if (data === undefined) console.debug(DEBUG_PREFIX, message);
      else console.debug(DEBUG_PREFIX, message, data);
    } catch {
      // Console logging is best-effort.
    }
    const log = getDebugLog();
    log.push(entry);
    setDebugLog(log);
  }

  async function copyDebugLog() {
    const payload = formatDebugLog();
    if (!payload) return false;
    return writeClipboard(payload).catch(() => false);
  }

  function routeDebug(loc = (typeof location !== 'undefined' ? location : null)) {
    if (!loc) return {};
    const mode = resolveAssistantMode(loc);
    return {
      href: loc.href,
      mode,
      route: mode.route || resolveHiBidPage(loc),
      readyState: typeof document !== 'undefined' ? document.readyState : ''
    };
  }

  function removeLegacyScraperArtifacts(reason = 'cleanup') {
    if (typeof document === 'undefined') return 0;
    let removed = 0;
    const removedIds = [];
    LEGACY_SCRAPER_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.remove();
      removed += 1;
      removedIds.push(id);
    });
    LEGACY_PANEL_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.remove();
      removed += 1;
      removedIds.push(id);
    });
    if (removed) debug('removed legacy scraper artifacts', { reason, removed, ids: removedIds });
    return removed;
  }

  function textOf(el) {
    return (el?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function rawTextOf(el) {
    return (el?.innerText || el?.textContent || '')
      .replace(/\r/g, '')
      .replace(/[ \t]+/g, ' ')
      .replace(/\n[ \t]+/g, '\n')
      .replace(/[ \t]+\n/g, '\n')
      .trim();
  }

  function moneyFromText(value) {
    const match = (value || '').match(/(?:\$|\bUSD\b\s*)\s*([\d,]+(?:\.\d{2})?)|([\d,]+(?:\.\d{2})?)\s*USD/i);
    const amount = match?.[1] || match?.[2] || '';
    return amount ? Number(amount.replace(/,/g, '')) : null;
  }

  function moneyLabelFromText(value) {
    const match = (value || '').match(/(?:\$|\bUSD\b\s*)\s*([\d,]+(?:\.\d{2})?)|([\d,]+(?:\.\d{2})?)\s*USD/i);
    if (!match) return '';
    const amount = match[1] || match[2];
    return match[2] ? `${amount} USD` : `$${amount}`;
  }

  function percentFromText(value) {
    const match = String(value || '').match(/(\d+(?:\.\d+)?)\s*%/);
    return match ? `${match[1]}%` : '';
  }

  function lineAfter(raw, label) {
    const lines = String(raw || '').split(/\n+/).map(line => line.trim()).filter(Boolean);
    const index = lines.findIndex(line => new RegExp(`^${label}\\b`, 'i').test(line));
    return index >= 0 ? (lines[index + 1] || '') : '';
  }

  function sectionBetween(raw, start, endPattern) {
    const pattern = new RegExp(`${start}\\s*([\\s\\S]*?)(?:${endPattern})`, 'i');
    const match = String(raw || '').match(pattern);
    return match ? match[1].replace(/\s+/g, ' ').trim() : '';
  }

  function pickFirstText(root, selectors = []) {
    for (const selector of selectors) {
      const value = textOf(root?.querySelector?.(selector));
      if (value) return value;
    }
    return '';
  }

  function pickFirstHref(root, selectors = [], base) {
    for (const selector of selectors) {
      const el = root?.querySelector?.(selector);
      const href = controlHref(el);
      if (href) return absoluteUrl(href, base);
    }
    return '';
  }

  function pickFirstImage(root, base) {
    const images = Array.from(root?.querySelectorAll?.('img') || []);
    for (const image of images) {
      const src = image?.getAttribute?.('data-src')
        || image?.getAttribute?.('data-original')
        || image?.getAttribute?.('src')
        || image?.src
        || '';
      if (src && !/spacer|blank|pixel/i.test(src)) return absoluteUrl(src, base);
    }
    return '';
  }

  function pickFirstDescription(root) {
    const direct = root?.getAttribute?.('data-description')
      || root?.getAttribute?.('data-notes')
      || root?.getAttribute?.('aria-description')
      || '';
    if (direct.trim()) return direct.trim();

    const selectors = [
      '.lot-description',
      '.description',
      '.lot-notes',
      '[class*="lot-description"]',
      '[class*="description"]',
      '[class*="lot-notes"]',
      '[data-testid*="description"]',
      '[data-testid*="notes"]'
    ];
    for (const selector of selectors) {
      const element = root?.querySelector?.(selector);
      const value = descriptionTextOf(element);
      if (value && !/^read description$/i.test(value)) return value;
    }
    return '';
  }

  function numberFromText(value) {
    const match = (value || '').match(/([\d,]+)/);
    return match ? Number(match[1].replace(/,/g, '')) : null;
  }

  function parseBidPlan(raw) {
    const parsed = JSON.parse(raw || '{}');
    const out = {};

    Object.entries(parsed).forEach(([lot, value]) => {
      if (typeof value === 'number') {
        out[String(lot)] = { max: value, title: '' };
        return;
      }

      if (value && typeof value === 'object') {
        const max = Number(value.max);
        out[String(lot)] = {
          max: Number.isFinite(max) && max > 0 ? max : null,
          title: String(value.title || '').trim()
        };
      }
    });

    return out;
  }

  function titleMatches(title, expected) {
    if (!expected) return true;
    return String(title || '').toLowerCase().includes(String(expected).toLowerCase());
  }

  function extractUserBidStatus(value) {
    if (/outbid|losing|not winning/i.test(value || '')) return 'Outbid';
    if (/winning|high bidder|you'?re winning|you are winning/i.test(value || '')) return 'Winning';
    if (/you'?ve bid|you have bid|your bid/i.test(value || '')) return 'Bid Placed';
    return '';
  }

  function isVisible(el) {
    if (!el) return false;
    const win = typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : null);
    const style = win?.getComputedStyle ? win.getComputedStyle(el) : null;
    if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    return Boolean(el.offsetParent || el.getClientRects?.().length);
  }

  function controlLabel(el) {
    return [
      textOf(el),
      el?.getAttribute?.('aria-label') || '',
      el?.getAttribute?.('title') || '',
      el?.getAttribute?.('class') || '',
      el?.getAttribute?.('id') || el?.id || ''
    ].join(' ').replace(/\s+/g, ' ').trim();
  }

  function controlHref(el) {
    return el?.getAttribute?.('href') || el?.href || '';
  }

  function absoluteUrl(href, base = (typeof location !== 'undefined' ? location.href : 'https://hibid.com/')) {
    if (!href) return '';
    try {
      return new URL(href, base).href;
    } catch {
      if (/^https?:\/\//i.test(String(href))) return String(href);
      const origin = String(base || '').match(/^(https?:\/\/[^/]+)/i)?.[1] || 'https://hibid.com';
      if (String(href).startsWith('/')) return `${origin}${href}`;
      return String(href);
    }
  }

  function getRootText(root = document) {
    return rawTextOf(root.body || root.documentElement || root);
  }

  function getExpectedLotTotal(root = document) {
    const text = getRootText(root);
    const totalMatch = text.match(/\bTotal Lots:\s*([\d,]+)/i);
    if (totalMatch) return Number(totalMatch[1].replace(/,/g, ''));

    const openMatch = text.match(/\bOpen Lots:\s*([\d,]+)/i);
    if (openMatch) return Number(openMatch[1].replace(/,/g, ''));

    const showingMatch = text.match(/\bShowing\s+[\d,]+\s*(?:to|-)\s*[\d,]+\s+of\s+([\d,]+)\s+lots\b/i);
    if (showingMatch) return Number(showingMatch[1].replace(/,/g, ''));

    const ofMatch = text.match(/\b(?:of|total)\s+([\d,]+)\s+lots\b/i);
    if (ofMatch) return Number(ofMatch[1].replace(/,/g, ''));
    return null;
  }

  function findCatalogNextPageButton(root = document) {
    const textNodeType = typeof NodeFilter !== 'undefined' ? NodeFilter.SHOW_TEXT : 4;
    const walker = root.createTreeWalker?.(root.body || root.documentElement, textNodeType);
    while (walker) {
      const node = walker.nextNode();
      if (!node) break;
      if (!/^next\s*>?$/i.test((node.textContent || '').trim())) continue;
      const control = node.parentElement?.closest?.('a[href], button, [role="button"]');
      if (control && !control.disabled && !control.getAttribute?.('aria-disabled') && isVisible(control)) {
        debug('catalog next-page text-node control', { label: controlLabel(control), href: controlHref(control) });
        return control;
      }
    }

    const candidates = Array.from(root.querySelectorAll?.('a[href], button, [role="button"]') || [])
      .filter(button => !button.disabled && !button.getAttribute?.('aria-disabled'))
      .filter(isVisible)
      .map(button => {
        const label = controlLabel(button);
        const href = controlHref(button);
        let score = 0;
        if (/\bbid\b|history|watch|unwatch|notes?|close|confirm|share|print|search/i.test(label)) score = -100;
        else if (/^next\s*>?$/i.test(textOf(button))) score = 120;
        else if (/\bnext\b/i.test(label) && /(?:apage|page)=\d+/i.test(href)) score = 110;
        else if (/\bnext\b/i.test(label) && /page|pagination|pager/i.test(button.closest?.('[class]')?.getAttribute?.('class') || '')) score = 100;
        else if (/(?:apage|page)=\d+/i.test(href) && /\bnext\b/i.test(label)) score = 80;
        return { button, score, label, href };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);

    debug('catalog next-page candidates', candidates.map(item => ({ score: item.score, label: item.label, href: item.href })).slice(0, 10));
    return candidates[0]?.button || null;
  }

  function findBidButton(tile) {
    const candidates = Array.from(tile.querySelectorAll('.lot-bid-button, button.lot-bid-button, .lot-bid-button button, .lot-bid-button[role="button"], button, [role="button"]'))
      .filter(button => !button.disabled && !button.getAttribute('aria-disabled'))
      .filter(isVisible)
      .map(button => {
        const label = controlLabel(button);
        const amount = moneyFromText(label);
        const className = button.getAttribute?.('class') || '';
        let score = 0;

        if (/bid\s+history|history|\b\d+\s+bids?\b|\bbids?\b/i.test(label) && !amount) {
          score = -100;
        } else if (/\blot-bid-button\b/i.test(className)) {
          score = 100;
        } else if (/\bbid\s+[\d,.]+\s*USD\b/i.test(label)) {
          score = 80;
        } else if (/\bplace\s+bid\b|\bnext\s+bid\b/i.test(label) && amount) {
          score = 70;
        } else if (/\bbid\b/i.test(label) && amount) {
          score = 60;
        } else if (amount && /\bUSD\b/i.test(label)) {
          score = 30;
        }

        return { button, label, amount, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);

    debug('findBidButton candidates', candidates.map(item => ({
      label: item.label,
      amount: item.amount,
      score: item.score
    })).slice(0, 8));

    return candidates[0]?.button || null;
  }

  function findLiveBidButton(root = document) {
    const candidates = Array.from(root.querySelectorAll?.('.live-bid-button, .lot-bid-button, button, [role="button"], input[type="button"], input[type="submit"]') || [])
      .filter(button => !button.disabled && !button.getAttribute?.('aria-disabled'))
      .filter(isVisible)
      .map(button => {
        const label = controlLabel(button);
        const amount = moneyFromText(label);
        const className = button.getAttribute?.('class') || '';
        let score = 0;

        if (/bid\s+history|history|\b\d+\s+bids?\b|\bbids?\b|watch|unwatch|notes?|close|catalog|view\s+catalog/i.test(label) && !/\bbid\s+[\d,.]+\s*USD\b/i.test(label)) {
          score = -100;
        } else if (/\blive-bid-button\b/i.test(className)) {
          score = 120;
        } else if (/\blot-bid-button\b/i.test(className)) {
          score = 100;
        } else if (/\bbid\s+[\d,.]+\s*USD\b/i.test(label)) {
          score = 90;
        } else if (/\bplace\s+bid\b|\bsubmit\s+bid\b|\bnext\s+bid\b/i.test(label) && amount) {
          score = 75;
        } else if (/\bbid\b/i.test(label) && amount) {
          score = 60;
        }

        return { button, label, amount, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);

    debug('findLiveBidButton candidates', candidates.map(item => ({
      label: item.label,
      amount: item.amount,
      score: item.score
    })).slice(0, 8));

    return candidates[0]?.button || null;
  }

  function findLiveLoadMoreButton(root = document) {
    const candidates = Array.from(root.querySelectorAll?.('button, [role="button"], a[href], input[type="button"], input[type="submit"]') || [])
      .filter(button => !button.disabled && !button.getAttribute?.('aria-disabled'))
      .filter(isVisible)
      .map(button => {
        const label = controlLabel(button);
        let score = 0;

        if (/\bbid\b|history|watch|unwatch|notes?|close|confirm|snipe|catalog|search/i.test(label)) {
          score = -100;
        } else if (/\bopen\s+more\b/i.test(label)) {
          score = 100;
        } else if (/\b(?:load|show|view)\s+more\b/i.test(label)) {
          score = 90;
        } else if (/\bmore\s+lots?\b/i.test(label)) {
          score = 80;
        }

        return { button, label, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);

    debug('findLiveLoadMoreButton candidates', candidates.map(item => ({
      label: item.label,
      score: item.score
    })).slice(0, 8));

    return candidates[0]?.button || null;
  }

  function getLotTiles(root = document) {
    const roots = getLotSearchRoots(root);
    const candidates = roots.flatMap(searchRoot => Array.from(searchRoot.querySelectorAll([
        'app-lot-tile[id^="lot-"]',
        '.bid-status-border',
        '.lot-tile',
        '[class*="lot-tile"]',
        '.lot-number-lead',
        'a[href*="/lot/"]',
        '[class*="lot-number"]'
      ].join(','))));

    const fromText = roots.flatMap(searchRoot => Array.from(searchRoot.querySelectorAll('a, span, div, h2'))
      .filter(el => /^Lot\s+\d+[A-Za-z-]*/i.test(textOf(el))));

    const tiles = candidates.concat(fromText)
      .map(candidate => findLotTileFromSeed(candidate))
      .filter(Boolean)
      .filter(tile => Boolean(tile.querySelector?.('.lot-number-lead, a[href*="/lot/"], [class*="lot-number"]')) || /^Lot\s+\d+/i.test(textOf(tile)));

    return Array.from(new Set(tiles));
  }

  function getLotSearchRoots(root = document) {
    const roots = [root];
    const seen = new Set(roots);

    for (let i = 0; i < roots.length; i += 1) {
      const current = roots[i];
      Array.from(current.querySelectorAll?.('*') || []).forEach(el => {
        if (el.shadowRoot && !seen.has(el.shadowRoot)) {
          seen.add(el.shadowRoot);
          roots.push(el.shadowRoot);
        }
      });
    }

    if (root === document) {
      Array.from(document.querySelectorAll('iframe')).forEach(frame => {
        try {
          const frameDoc = frame.contentDocument;
          if (frameDoc && !seen.has(frameDoc)) {
            seen.add(frameDoc);
            roots.push(frameDoc);
          }
        } catch {
          // Cross-origin frames cannot be inspected.
        }
      });
    }

    return roots;
  }

  function findLotTileFromSeed(seed) {
    if (!seed) return null;
    if (seed.matches?.('app-lot-tile[id^="lot-"], .bid-status-border, .lot-tile, [class*="lot-tile"]')) {
      if (seed.querySelector?.('.lot-number-lead, a[href*="/lot/"], [class*="lot-number"]')) return seed;
    }

    let el = seed;
    for (let depth = 0; el && depth < 10; depth += 1, el = el.parentElement) {
      const hasLotIdentity = Boolean(el.querySelector?.('.lot-number-lead, a[href*="/lot/"], [class*="lot-number"]')) || /^Lot\s+\d+/i.test(textOf(el));
      const hasBidSurface = Boolean(el.querySelector?.('.lot-bid-button, .TileDisplayMinBid, .lot-high-bid, .lot-tile-bid-status, .bid-status, [class*="high-bid"], [class*="bid-status"]'));
      if (hasLotIdentity && hasBidSurface) return el;
    }

    return null;
  }

  function extractLot(tile) {
    const titleLink = tile.querySelector('a.lot-number-lead[href], a.lot-preview-link[href]');
    const titleEl = tile.querySelector('.lot-title, h2');
    const lotLabel = textOf(tile.querySelector('.lot-number-lead .text-primary, .lot-number-lead span'));
    const lotNumber = lotLabel.match(/\d+[A-Za-z-]*/)?.[0] || '';
    const highBidText = textOf(tile.querySelector('.lot-high-bid, .lot-bid-container'));
    const bidCountText = textOf(tile.querySelector('.lot-bid-history'));
    const timeLeftText = textOf(tile.querySelector('.lot-time-left, .lot-time-label, .lot-time-left-container'));
    const nextBidText = textOf(tile.querySelector('.TileDisplayMinBid'));
    const bidButton = findBidButton(tile);
    const nextBidFromLabel = moneyFromText(nextBidText);
    const nextBidFromButton = moneyFromText(textOf(bidButton));
    const nextBidAmount = Math.max(nextBidFromLabel || 0, nextBidFromButton || 0) || null;
    const bidStatusRoot = tile.querySelector('.lot-tile-bid-status .bid-status');
    const statusClass = [
      tile.querySelector('[class*="bid-status-border"]')?.getAttribute('class') || '',
      tile.querySelector('[class*="live-catalog-high-bid-status"]')?.getAttribute('class') || '',
      tile.querySelector('[class*="lot-status-"]')?.getAttribute('class') || '',
      bidStatusRoot?.getAttribute('class') || '',
      tile.querySelector('.bid-status.winning, .bid-status.outbid, .bid-status.losing')?.getAttribute('class') || ''
    ].join(' ');
    const statusText = textOf(tile.querySelector('.bid-status.winning, .bid-status.outbid, .bid-status.losing, .lot-tile-bid-status'));
    const allStatus = `${statusText} ${statusClass} ${textOf(tile)}`;
    const userBidStatus = extractUserBidStatus(allStatus);
    const href = titleLink?.getAttribute('href') || '';
    const base = typeof location !== 'undefined' ? location.href : 'https://hibid.com/';
    const rawText = rawTextOf(tile);
    const image = pickFirstImage(tile, base);
    const description = pickFirstDescription(tile);

    return {
      tile,
      bidButton,
      id: (tile.id || '').replace(/^lot-/, ''),
      lot: lotNumber,
      title: textOf(titleEl) || titleLink?.getAttribute('aria-label') || '',
      url: href ? absoluteUrl(href, base) : '',
      image,
      pictureCount: tile.querySelectorAll?.('img')?.length || 0,
      description,
      rawText,
      highBid: highBidText,
      highBidAmount: moneyFromText(highBidText),
      bidCount: bidCountText,
      bidCountNumber: numberFromText(bidCountText),
      timeLeft: timeLeftText,
      nextBid: nextBidText,
      nextBidAmount,
      userBidStatus,
      isWinning: userBidStatus === 'Winning',
      isOutbid: userBidStatus === 'Outbid',
      statusClass: statusClass.trim()
    };
  }

  function extractCurrentBidsStatus(value) {
    const text = String(value || '');
    if (/\bWon\b/i.test(text)) return 'Won';
    return extractUserBidStatus(text);
  }

  function extractCurrentBidsLot(tile) {
    const base = extractLot(tile);
    const structuredText = rawTextOf(tile);
    const raw = textOf(tile);
    const firstLine = structuredText.match(/(?:^|\n)\s*Lot\s*#?\s*:?\s*(\d+[A-Za-z-]*)\s*(?:\||[-:])?\s*([\s\S]*?)(?=\n\s*(?:Unwatch|Watch|Notes|READ DESCRIPTION|Current Bid|High Bid|Price Realized|Bidding Closed|Sold For|Lot Won|Starting Bid|Opening Bid|\d+\s+Bids?\b|Bid\s+[\d,.]+\s*USD)|$)/i);
    const lot = firstLine?.[1] || base.lot || '';
    const title = (firstLine?.[2] || base.title || '')
      .replace(/\s+/g, ' ')
      .trim();
    const priceText = raw.match(/(?:High Bid|Current Bid|Price Realized|Lot Won|Sold For):?\s*\$?\s*([\d,.]+\s*(?:USD)?(?:\s*\/\s*(?:Lot|ea))?)/i)?.[1] || '';
    const bidCount = raw.match(/\b\d+\s+Bids?\b/i)?.[0] || base.bidCount || '';
    const status = extractCurrentBidsStatus(raw);
    const img = tile.querySelector?.('img[src], img[data-src]') || null;
    const image = img?.getAttribute?.('src') || img?.getAttribute?.('data-src') || img?.src || '';

    return {
      ...base,
      id: lot || base.id,
      lot,
      title,
      image: image ? absoluteUrl(image) : base.image || '',
      description: pickFirstDescription(tile) || base.description || '',
      highBid: priceText ? `High Bid: ${priceText}` : base.highBid,
      highBidAmount: moneyFromText(priceText) || base.highBidAmount,
      bidCount,
      bidCountNumber: numberFromText(bidCount) || base.bidCountNumber,
      userBidStatus: status,
      isWinning: status === 'Winning',
      isOutbid: status === 'Outbid',
      statusClass: `${base.statusClass || ''} current-bids-card`.trim(),
      rawText: raw
    };
  }

  function uniqueLots(lots) {
    const unique = new Map();
    lots.forEach(lot => {
      if (lot?.lot && !unique.has(String(lot.lot))) unique.set(String(lot.lot), lot);
    });
    return Array.from(unique.values());
  }

  function evaluateLot(lot, planEntry, options = {}) {
    if (!planEntry) return { status: 'not planned', eligible: false };
    if (!titleMatches(lot.title, planEntry.title)) return { status: 'title mismatch', eligible: false };
    if (!Number.isFinite(planEntry.max) || planEntry.max <= 0) return { status: 'add max', eligible: false };
    if (options.requireOutbid && !lot.isOutbid) return { status: 'not outbid', eligible: false };
    if (lot.isWinning) return { status: 'already winning', eligible: false };
    if (!Number.isFinite(lot.nextBidAmount)) return { status: 'no bid button', eligible: false };
    if (lot.nextBidAmount > planEntry.max) return { status: 'over max', eligible: false };
    return { status: 'eligible', eligible: true };
  }

  function evaluateLiveLot(liveState, planEntry) {
    if (!planEntry) return { status: 'not planned', eligible: false };
    if (!Number.isFinite(planEntry.max) || planEntry.max <= 0) return { status: 'add max', eligible: false };
    if (!liveState?.lot) return { status: 'no live lot', eligible: false };
    if (!titleMatches(liveState.title, planEntry.title)) return { status: 'title mismatch', eligible: false };
    if (!liveState.bidButton || !isVisible(liveState.bidButton)) return { status: 'no live bid button', eligible: false };
    if (!Number.isFinite(liveState.nextBidAmount)) return { status: 'no live ask', eligible: false };
    if (liveState.nextBidAmount > planEntry.max) return { status: 'over max', eligible: false };
    return { status: 'eligible', eligible: true };
  }

  function decodeHtml(value) {
    return String(value || '')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&nbsp;/g, ' ');
  }

  function stripHtml(value) {
    return decodeHtml(String(value || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  }

  function firstMatch(value, patterns) {
    for (const pattern of patterns) {
      const match = String(value || '').match(pattern);
      if (match?.[1]) return decodeHtml(match[1]).trim();
    }
    return '';
  }

  function parseDollarAmount(value) {
    const match = String(value || '').match(/\$\s*([\d,]+(?:\.\d{1,2})?)/);
    return match ? Number(match[1].replace(/,/g, '')) : null;
  }

  function parsePlainInteger(value) {
    const match = String(value || '').match(/\b([\d,]+)\b/);
    return match ? Number(match[1].replace(/,/g, '')) : null;
  }

  function cleanListingTitle(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/^Mark as sold\s+/i, '')
      .trim();
  }

  function cleanEbaySellerHubTitle(value) {
    let title = cleanListingTitle(value);
    const prefixes = [
      /^[^|]{1,40}\|\s*/i,
      /^eBay\s*\|\s*/i,
      /^Item photo\.\s*/i,
      /^Show Listing Details(?:\s+new)?\.\s*/i,
      /^(?:\d+\s+)?Link\.\s*/i,
      /^Bids:\s*\d+\.?\s*/i,
      /^Show Bid History\.?\s*/i,
      /^Listing\.?\s*/i,
    ];
    let changed = true;
    while (changed) {
      changed = false;
      prefixes.forEach(pattern => {
        const next = title.replace(pattern, '').trim();
        if (next !== title) {
          title = next;
          changed = true;
        }
      });
    }
    title = title.replace(/^.{0,120}\bListing\.?\s+/i, '').trim();
    return title;
  }

  function normalizeListingUrl(value) {
    const url = decodeHtml(value || '').trim();
    if (!url) return '';
    if (/^https?:\/\//i.test(url)) return url;
    if (url.startsWith('/')) {
      if (/\/marketplace\//i.test(url)) return `https://www.facebook.com${url}`;
      return `https://www.ebay.com${url}`;
    }
    return url;
  }

  function dedupeListings(listings) {
    const seen = new Map();
    const result = [];
    listings.forEach(listing => {
      const source = listing.source || '';
      const itemId = listing.itemId || '';
      const key = itemId
        ? `${source}|id:${itemId}`
        : [
            source,
            listing.url || '',
            String(listing.title || '').toLowerCase(),
            listing.price ?? ''
          ].join('|');
      if (seen.has(key)) {
        const index = seen.get(key);
        const existing = result[index];
        const listingScore = listingQuality(listing);
        const existingScore = listingQuality(existing);
        if (listingScore > existingScore || (
          listingScore === existingScore &&
          Number.isFinite(listing.price) &&
          Number.isFinite(existing.price) &&
          listing.price < existing.price
        )) {
          result[index] = listing;
        }
        return;
      }
      seen.set(key, result.length);
      result.push(listing);
    });
    return result;
  }

  function listingQuality(listing) {
    let score = 0;
    const title = String(listing?.title || '');
    if (title && !/^eBay\s*\|/i.test(title)) score += 20;
    if (!/Item photo|Show Listing Details|Show Bid History|^Edit$/i.test(title)) score += 20;
    if (/\/itm\/\d+/i.test(listing?.url || '')) score += 10;
    if (Number.isFinite(listing?.views)) score += 3;
    if (Number.isFinite(listing?.watchers)) score += 3;
    if (listing?.shippingText) score += 1;
    return score;
  }

  function amountFromState(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') {
      const parsed = moneyFromText(value) ?? Number(value.replace?.(/,/g, ''));
      return Number.isFinite(parsed) ? parsed : null;
    }
    if (value && typeof value === 'object') {
      return amountFromState(value.amount ?? value.value ?? value.current ?? value.bid);
    }
    return null;
  }

  function formatUsd(amount) {
    return Number.isFinite(amount) ? `${amount.toFixed(2)} USD` : '';
  }

  function refId(value) {
    if (typeof value === 'string') return value;
    return value?.__ref || '';
  }

  function deref(state, value) {
    const key = refId(value);
    return key && state?.[key] ? state[key] : value;
  }

  function firstDefined(...values) {
    return values.find(value => value !== undefined && value !== null && value !== '');
  }

  function apolloLotConnections(state) {
    return Object.entries(state?.ROOT_QUERY || {}).map(([key, value]) => {
      const paged = value?.pagedResults || value?.lots?.pagedResults || value?.search?.pagedResults || value;
      const results = paged?.results || value?.results || [];
      const refs = [];
      const seen = new Set();

      function addRef(value) {
        const key = refId(value);
        if (!/^Lot:/i.test(key) || seen.has(key)) return;
        seen.add(key);
        refs.push(key);
      }

      if (Array.isArray(results)) results.forEach(addRef);
      if (!refs.length) return null;
      return {
        key,
        refs,
        totalCount: Number(firstDefined(paged?.totalCount, paged?.filteredCount, paged?.total, value?.totalCount)),
        pageLength: Number(firstDefined(paged?.pageLength, paged?.pageSize, paged?.take, refs.length)),
        pageNumber: Number(firstDefined(paged?.pageNumber, paged?.page, 1))
      };
    }).filter(Boolean);
  }

  function urlFromLocationLike(loc = (typeof location !== 'undefined' ? location : null)) {
    try {
      if (loc instanceof URL) return loc;
      const href = loc?.href || String(loc || '');
      return new URL(href || 'https://hibid.com/');
    } catch {
      return new URL('https://hibid.com/');
    }
  }

  function extractHibidUrlFilters(loc = (typeof location !== 'undefined' ? location : null)) {
    const url = urlFromLocationLike(loc);
    const filters = {};
    ['g', 'q', 'category', 'subCategory', 'apage', 'zip', 'miles', 'countryname', 'shippingoffered', 'status', 's'].forEach(key => {
      const values = url.searchParams.getAll(key).filter(value => value !== '');
      if (!values.length) return;
      filters[key] = values.length === 1 ? values[0] : values;
    });

    const activeFilterKeys = Object.entries(filters).filter(([key, value]) => {
      if (key === 'apage' || key === 's' || key === 'countryname') return false;
      const values = Array.isArray(value) ? value : [value];
      const normalizedValues = values.map(item => String(item || '').trim().toLowerCase()).filter(Boolean);
      if (!normalizedValues.length) return false;
      if (key === 'apage') return false;
      if (key === 'g') return normalizedValues.some(item => item !== '-1');
      if (key === 'category') return normalizedValues.some(item => item !== 'all');
      if (key === 'subCategory') return normalizedValues.some(item => item !== 'active');
      return normalizedValues.some(Boolean);
    }).map(([key]) => key);

    return {
      sourceUrl: url.href,
      filters,
      activeFilterKeys,
      hasActiveFilters: activeFilterKeys.length > 0
    };
  }

  function extractHibidVisiblePageState(root = document, loc = (typeof location !== 'undefined' ? location : null)) {
    const filterState = extractHibidUrlFilters(loc);
    const text = getRootText(root);
    const noMatches = /\bNo matches found\b/i.test(text) || /\bTry adjusting your filters\b/i.test(text);
    const expectedTotal = noMatches ? 0 : getExpectedLotTotal(root);
    let visibleLotCount = null;
    try {
      const visibleTiles = root.querySelectorAll?.('app-lot-card, lot-card, .lot-card, [class*="lot-card"], [class*="lotTile"], [class*="lot-tile"]');
      if (visibleTiles && typeof visibleTiles.length === 'number') visibleLotCount = visibleTiles.length;
    } catch {
      visibleLotCount = null;
    }

    return {
      ...filterState,
      noMatches,
      expectedTotal,
      visibleLotCount: noMatches ? 0 : visibleLotCount
    };
  }

  function normalizedFilterText(value) {
    return decodeURIComponent(String(value || ''))
      .replace(/\+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  function apolloKeyMatchesActiveFilters(key, visibleState) {
    if (!visibleState?.hasActiveFilters) return true;
    const normalizedKey = normalizedFilterText(key);
    return visibleState.activeFilterKeys.every(filterKey => {
      const rawValue = visibleState.filters?.[filterKey];
      const values = Array.isArray(rawValue) ? rawValue : [rawValue];
      const normalizedValues = values.map(value => normalizedFilterText(value)).filter(Boolean);
      if (!normalizedValues.length) return true;
      return normalizedValues.some(value => normalizedKey.includes(value));
    });
  }

  function shouldGuardApolloForVisibleState(visibleState) {
    return Boolean(visibleState?.noMatches || visibleState?.hasActiveFilters);
  }

  function shouldRejectAmbiguousUnfilteredApollo(visibleState) {
    const expectedTotal = Number(visibleState?.expectedTotal);
    return Boolean(visibleState
      && !visibleState.noMatches
      && !visibleState.hasActiveFilters
      && Number.isFinite(expectedTotal)
      && expectedTotal > 0);
  }

  function apolloConnectionMatchesVisibleState(connection, options = {}) {
    const visibleState = options.visibleState;
    if (!visibleState) return { ok: true };
    if (visibleState.noMatches) return { ok: false, reason: 'visible-no-matches' };
    if (!visibleState.hasActiveFilters) return { ok: true };

    const requiresKeyMatch = visibleState.activeFilterKeys.includes('q');
    if (apolloKeyMatchesActiveFilters(connection.key, visibleState)) return { ok: true };
    const visibleExpected = Number(visibleState.expectedTotal);
    const hasVisibleExpected = visibleState.expectedTotal !== null
      && visibleState.expectedTotal !== undefined
      && Number.isFinite(visibleExpected);
    const refsMatchVisibleCount = hasVisibleExpected
      && Array.isArray(connection.refs)
      && connection.refs.length === visibleExpected
      && (!Number.isFinite(connection.totalCount) || connection.totalCount === visibleExpected)
      && (!Number.isFinite(connection.pageLength) || connection.pageLength === visibleExpected);
    if (refsMatchVisibleCount) {
      return { ok: true, reason: 'visible-count-confirmed' };
    }
    if (requiresKeyMatch) return { ok: false, reason: 'active-search-filter-mismatch' };

    const hasExpectedTotal = options.expectedTotal !== null
      && options.expectedTotal !== undefined
      && Number.isFinite(Number(options.expectedTotal));
    const expectedTotal = Number(options.expectedTotal);
    if (hasExpectedTotal && connection.totalCount === expectedTotal) return { ok: true };
    if (hasVisibleExpected && connection.totalCount === visibleExpected) {
      return { ok: true };
    }
    return { ok: false, reason: 'active-filter-mismatch' };
  }

  function chooseApolloLotConnection(state, options = {}) {
    const connections = apolloLotConnections(state);
    if (!connections.length) return null;
    const hasExpectedTotal = options.expectedTotal !== null
      && options.expectedTotal !== undefined
      && Number.isFinite(Number(options.expectedTotal));
    const expectedTotal = Number(options.expectedTotal);
    const visibleExpectedTotal = Number(options.visibleState?.expectedTotal);
    const hasVisibleExpectedTotal = !options.visibleState?.hasActiveFilters
      && Number.isFinite(visibleExpectedTotal)
      && visibleExpectedTotal > 0;
    const pageBoundConnections = connections.filter(connection => /eventItemIds/i.test(connection.key));
    const hasExactVisibleConnection = hasVisibleExpectedTotal
      && connections.some(connection => connection.totalCount === visibleExpectedTotal);

    // HiBid's catalog page can expose several Apollo lot connections at once.
    // A broad/featured connection is not safe just because it contains Lot refs.
    // When the page tells us its unfiltered total, prefer the page-bound
    // eventItemIds connection; if neither a page-bound nor exact-total
    // connection exists, fail closed and let the DOM path decide.
    if (hasVisibleExpectedTotal && !hasExactVisibleConnection && !pageBoundConnections.length) {
      debug('apollo lot connections ambiguous for unfiltered catalog', {
        visibleExpectedTotal,
        connections: connections.map(connection => ({
          key: connection.key.slice(0, 220),
          refs: connection.refs.length,
          totalCount: connection.totalCount,
          pageLength: connection.pageLength
        })).slice(0, 10)
      });
      return null;
    }
    const rejected = [];
    const allowed = connections.filter(connection => {
      const match = apolloConnectionMatchesVisibleState(connection, options);
      if (!match.ok) {
        rejected.push({
          key: connection.key,
          refs: connection.refs.length,
          totalCount: connection.totalCount,
          reason: match.reason
        });
        return false;
      }
      return true;
    });
    if (!allowed.length) {
      debug('apollo lot connections rejected for visible filters', {
        filters: options.visibleState?.filters || {},
        noMatches: Boolean(options.visibleState?.noMatches),
        rejected: rejected.slice(0, 10)
      });
      return null;
    }
    const scored = allowed.map(connection => {
      let score = 0;
      if (hasExpectedTotal && connection.totalCount === expectedTotal) score += 1000;
      if (hasVisibleExpectedTotal && /eventItemIds/i.test(connection.key)) score += 600;
      if (apolloKeyMatchesActiveFilters(connection.key, options.visibleState)) score += 750;
      if (/lotSearch/i.test(connection.key)) score += 250;
      if (!/featured|hot|recommend|similar|related/i.test(connection.key)) score += 100;
      if (Number.isFinite(connection.totalCount)) score += Math.min(connection.totalCount, 500) / 10;
      score += Math.min(connection.refs.length, 100);
      return { connection, score };
    }).sort((a, b) => b.score - a.score);
    debug('apollo lot connections', scored.map(item => ({
      key: item.connection.key.slice(0, 220),
      refs: item.connection.refs.length,
      totalCount: item.connection.totalCount,
      pageLength: item.connection.pageLength,
      pageNumber: item.connection.pageNumber,
      score: item.score
    })).slice(0, 10));
    if (rejected.length) debug('apollo lot connections skipped', rejected.slice(0, 10));
    return scored[0].connection;
  }

  function collectLotRefsFromApolloState(state, options = {}) {
    const chosen = chooseApolloLotConnection(state, options);
    if (chosen) return chosen.refs;
    if (shouldGuardApolloForVisibleState(options.visibleState)
      || shouldRejectAmbiguousUnfilteredApollo(options.visibleState)) return [];

    const refs = [];
    const seen = new Set();

    function addRef(value) {
      const key = refId(value);
      if (!/^Lot:/i.test(key) || seen.has(key)) return;
      seen.add(key);
      refs.push(key);
    }

    if (!refs.length) {
      Object.keys(state || {}).filter(key => /^Lot:/i.test(key)).forEach(addRef);
    }

    return refs;
  }

  function expectedTotalFromApolloState(state, options = {}) {
    const chosen = chooseApolloLotConnection(state, options);
    if (!chosen && options.visibleState?.noMatches) return 0;
    if (!chosen && shouldGuardApolloForVisibleState(options.visibleState)) return null;
    return Number.isFinite(chosen?.totalCount) ? chosen.totalCount : null;
  }

  function pageLengthFromApolloState(state, options = {}) {
    const chosen = chooseApolloLotConnection(state, options);
    if (!chosen && shouldGuardApolloForVisibleState(options.visibleState)) return null;
    return Number.isFinite(chosen?.pageLength) ? chosen.pageLength : null;
  }

  function normalizeLotUrl(lot, context = {}) {
    const href = lot.url || lot.lotUrl || lot.itemUrl || lot.href || '';
    if (href) return absoluteUrl(href, context.url || location.href);
    const id = firstDefined(lot.id, lot.eventItemId, lot.eventitemId, lot.itemId);
    const lotNumber = firstDefined(lot.lotNumber, lot.lotNumberExtension, lot.number, id);
    if (!id && !lotNumber) return '';
    const slug = encodeURIComponent(String(lotNumber || id).replace(/\s+/g, '-'));
    return absoluteUrl(`/lot/${encodeURIComponent(String(id || lotNumber))}/${slug}`, context.url || 'https://hibid.com/');
  }

  function normalizeApolloLot(state, lotRef, context = {}) {
    const lot = deref(state, lotRef);
    if (!lot || typeof lot !== 'object') return null;
    const lotState = lot.lotState || lot.state || {};
    const auction = deref(state, lot.auction || lot.auctionInfo || lot.event) || {};
    const id = String(firstDefined(lot.id, lot.eventItemId, lot.eventitemId, lot.itemId, refId(lotRef).replace(/^Lot:/i, '')) || '');
    const lotNumber = String(firstDefined(lot.lotNumber, lot.lotNumberExtension, lot.number, lot.lot, id) || '');
    const title = stripHtml(firstDefined(lot.lead, lot.title, lot.name, lot.descriptionShort) || '');
    if (!lotNumber && !title) return null;

    const highBidAmount = amountFromState(firstDefined(lotState.highBid, lot.highBid, lotState.currentBid, lotState.currentPrice, lot.currentBid));
    const nextBidAmount = amountFromState(firstDefined(lotState.minBid, lotState.nextBid, lot.minBid, lot.nextBid));
    const bidCountNumber = Number(firstDefined(lotState.bidCount, lot.bidCount, lotState.bids, lot.bids));
    const statusText = String(firstDefined(lotState.status, lot.status, lotState.priceRealizedMessage, '') || '');
    const userBidStatus = extractUserBidStatus(`${statusText} ${lotState.userBidStatus || ''}`);
    const picture = deref(state, lot.featuredPicture || lot.picture || lot.primaryPicture) || {};
    const description = stripHtml(firstDefined(lot.description, lot.fullDescription, lot.notes, lot.longDescription) || '');

    return {
      id,
      lot: lotNumber,
      title,
      url: normalizeLotUrl({ ...lot, id, lotNumber }, context),
      image: firstDefined(picture.thumbnailLocation, picture.fullSizeLocation, picture.url, picture.src, lot.imageUrl, lot.thumbnailUrl) || '',
      highBid: Number.isFinite(highBidAmount) ? `High Bid: ${formatUsd(highBidAmount)}` : '',
      highBidAmount,
      currentPrice: highBidAmount,
      currentBid: highBidAmount,
      nextBid: Number.isFinite(nextBidAmount) ? `Bid ${formatUsd(nextBidAmount)}` : '',
      nextBidAmount,
      bidCount: Number.isFinite(bidCountNumber) ? `${bidCountNumber} ${bidCountNumber === 1 ? 'Bid' : 'Bids'}` : '',
      bidCountNumber: Number.isFinite(bidCountNumber) ? bidCountNumber : null,
      timeLeft: String(firstDefined(lotState.timeLeft, lot.timeLeft, lotState.closingTimeText, '') || ''),
      status: statusText,
      userBidStatus,
      isWinning: userBidStatus === 'Winning',
      isOutbid: userBidStatus === 'Outbid',
      watched: Boolean(firstDefined(lotState.isWatching, lot.isWatching, lot.watchListed, false)),
      pictureCount: Number(firstDefined(lot.pictureCount, lotState.pictureCount, 0)) || 0,
      description,
      auctionTitle: String(firstDefined(auction.title, auction.name, lot.auctionTitle, '') || ''),
      buyerPremium: String(firstDefined(auction.buyerPremium, auction.buyersPremium, lot.buyerPremium, '') || '')
    };
  }

  function extractHibidApolloLots(apolloState, context = {}) {
    const state = apolloState?.['apollo.state'] || apolloState?.apollo?.state || apolloState || {};
    const selectionOptions = { expectedTotal: context.expectedTotal, visibleState: context.visibleState };
    const refs = collectLotRefsFromApolloState(state, selectionOptions);
    const unique = new Map();
    refs.forEach(ref => {
      const lot = normalizeApolloLot(state, ref, context);
      const key = lot?.id || lot?.lot || lot?.url;
      if (key && lot?.title) unique.set(String(key), lot);
    });
    const rejectedSource = !refs.length && shouldGuardApolloForVisibleState(context.visibleState)
      ? 'filter-mismatch'
      : (!refs.length && shouldRejectAmbiguousUnfilteredApollo(context.visibleState)
        ? 'ambiguous-unfiltered-state'
        : '');
    const hasExpectedFromContext = context.expectedTotal !== null
      && context.expectedTotal !== undefined
      && Number.isFinite(Number(context.expectedTotal));
    const expectedFromContext = Number(context.expectedTotal);
    return {
      source: 'hibid-state',
      items: Array.from(unique.values()),
      expectedTotal: hasExpectedFromContext ? expectedFromContext : expectedTotalFromApolloState(state, selectionOptions),
      pageLength: pageLengthFromApolloState(state, selectionOptions),
      rejectedSource,
      stopReason: rejectedSource ? (context.visibleState?.noMatches ? 'visible-no-matches' : 'filter-mismatch') : ''
    };
  }

  function parseHibidStateText(text) {
    if (!text) return null;
    try {
      const parsed = JSON.parse(String(text));
      return parsed?.['apollo.state'] || parsed?.apollo?.state || parsed;
    } catch (err) {
      debug('hibid-state parse failed', { error: err.message });
      return null;
    }
  }

  function extractHibidStateFromDocument(root = document) {
    const script = root.querySelector?.('script#hibid-state[type="application/json"], script#hibid-state');
    return parseHibidStateText(script?.textContent || '');
  }

  function getHibidScrapeLimits(expectedTotal = null, options = {}) {
    const total = Number(expectedTotal);
    const hasExpectedTotal = Number.isFinite(total) && total > 0;
    const maxDurationMs = Number.isFinite(Number(options.maxDurationMs))
      ? Number(options.maxDurationMs)
      : (hasExpectedTotal && total <= 50 ? 25000 : HIBID_DOM_SCRAPE_MAX_MS);
    const maxSteps = Number.isFinite(Number(options.maxSteps))
      ? Number(options.maxSteps)
      : HIBID_DOM_SCRAPE_MAX_STEPS;
    return {
      expectedTotal: hasExpectedTotal ? total : null,
      maxDurationMs: Math.max(1000, maxDurationMs),
      maxSteps: Math.max(1, Math.floor(maxSteps))
    };
  }

  function mergeCatalogLots(target, lots) {
    lots.forEach(lot => {
      const key = lot?.id || lot?.url || lot?.lot;
      if (key && lot?.title) target.set(String(key), lot);
    });
    return target;
  }

  function catalogPageUrl(pageNumber, baseHref = (typeof location !== 'undefined' ? location.href : '')) {
    const url = new URL(baseHref || 'https://hibid.com/');
    url.searchParams.set('apage', String(pageNumber));
    return url.href;
  }

  async function fetchHibidApolloStatePage(pageNumber, baseHref = location.href) {
    if (typeof fetch !== 'function' || typeof DOMParser === 'undefined') return null;
    const href = catalogPageUrl(pageNumber, baseHref);
    debug('hibid-state fetch page start', { pageNumber, href });
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutId = controller
      ? setTimeout(() => controller.abort(), HIBID_STATE_FETCH_TIMEOUT_MS)
      : null;
    try {
      const response = await fetch(href, {
        credentials: 'same-origin',
        cache: 'no-cache',
        ...(controller ? { signal: controller.signal } : {})
      });
      if (!response.ok) {
        debug('hibid-state fetch page failed', { pageNumber, href, status: response.status });
        return null;
      }
      const html = await response.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const state = extractHibidStateFromDocument(doc);
      debug('hibid-state fetch page parsed', { pageNumber, href, hasState: Boolean(state) });
      return state;
    } catch (error) {
      debug('hibid-state fetch page timed out or failed', {
        pageNumber,
        href,
        error: String(error?.name || error?.message || error)
      });
      return null;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  async function waitForHibidState(root = document, timeoutMs = HIBID_STATE_HYDRATION_WAIT_MS) {
    const startedAt = Date.now();
    let state = extractHibidStateFromDocument(root);
    while (!state && Date.now() - startedAt < timeoutMs) {
      await wait(HIBID_STATE_HYDRATION_POLL_MS);
      state = extractHibidStateFromDocument(root);
    }
    debug(state ? 'hibid-state became available after hydration wait' : 'hibid-state unavailable after hydration wait', {
      waitedMs: Date.now() - startedAt
    });
    return state;
  }

  async function scrapeHibidStatePages(onProgress = () => {}, shouldStop = () => false, root = document) {
    const visibleState = extractHibidVisiblePageState(root, typeof location !== 'undefined' ? location : null);
    debug('hibid visible page state', visibleState);
    if (visibleState.noMatches) {
      return {
        source: 'visible-page-state',
        items: [],
        lots: [],
        expectedTotal: 0,
        stopped: false,
        incomplete: false,
        pageLength: 0,
        pagesAttempted: 0,
        pagesRead: 0,
        failedPage: null,
        stopReason: 'visible-no-matches',
        visibleState
      };
    }

    const firstState = await waitForHibidState(root);
    if (!firstState) {
      debug('hibid-state unavailable on current document');
      return null;
    }

    const lotsByKey = new Map();
    const visibleTotal = visibleState.expectedTotal;
    const first = extractHibidApolloLots(firstState, { url: location.href, expectedTotal: visibleTotal, visibleState });
    if (first.rejectedSource && visibleState.hasActiveFilters) {
      debug('hibid-state first page rejected for active filters', {
        rejectedSource: first.rejectedSource,
        stopReason: first.stopReason,
        visibleState
      });
      return null;
    }
    mergeCatalogLots(lotsByKey, first.items);
    const expectedTotal = first.expectedTotal || visibleTotal || first.items.length;
    const pageLength = first.pageLength || first.items.length || 100;
    const totalPages = expectedTotal && pageLength ? Math.max(1, Math.ceil(expectedTotal / pageLength)) : 1;
    let pagesRead = first.items.length ? 1 : 0;
    let failedPage = null;
    let stopReason = '';
    const startedAt = Date.now();
    debug('hibid-state first page extracted', {
      count: lotsByKey.size,
      expectedTotal,
      pageLength,
      totalPages
    });
    onProgress(`Reading HiBid page data... ${lotsByKey.size}${expectedTotal ? `/${expectedTotal}` : ''}`);

    for (let page = 2; page <= totalPages && page <= HIBID_STATE_MAX_PAGES; page += 1) {
      if (shouldStop()) {
        stopReason = 'user-stop';
        break;
      }
      if (Date.now() - startedAt >= HIBID_STATE_SCRAPE_MAX_MS) {
        stopReason = 'state-scrape-timeout';
        debug('hibid-state scrape timed out before page fetch', {
          page,
          totalPages,
          elapsedMs: Date.now() - startedAt
        });
        break;
      }
      const state = await fetchHibidApolloStatePage(page).catch(err => {
        debug('hibid-state page fetch threw', { page, error: err.message });
        failedPage = page;
        return null;
      });
      if (!state) {
        failedPage ||= page;
        stopReason = 'missing-page-state';
        break;
      }
      const pageLots = extractHibidApolloLots(state, { url: catalogPageUrl(page), expectedTotal, visibleState });
      if (!pageLots.items.length) {
        failedPage = page;
        stopReason = 'empty-page-state';
        debug('hibid-state page had no lots', { page, expectedTotal });
        break;
      }
      mergeCatalogLots(lotsByKey, pageLots.items);
      pagesRead += 1;
      debug('hibid-state page merged', {
        page,
        pageLots: pageLots.items.length,
        count: lotsByKey.size,
        expectedTotal
      });
      onProgress(`Reading HiBid page data... ${lotsByKey.size}${expectedTotal ? `/${expectedTotal}` : ''}`);
      if (expectedTotal && lotsByKey.size >= expectedTotal) break;
    }

    if (!stopReason && totalPages > HIBID_STATE_MAX_PAGES) {
      stopReason = 'state-page-limit';
      debug('hibid-state page limit reached', { totalPages, maxPages: HIBID_STATE_MAX_PAGES });
    }

    const items = Array.from(lotsByKey.values());
    if (!items.length) return null;
    const stopped = !!shouldStop() || stopReason === 'user-stop';
    const incomplete = Boolean(expectedTotal && items.length < expectedTotal && !stopped);
    return {
      source: 'hibid-state',
      items,
      lots: items,
      expectedTotal,
      stopped,
      incomplete,
      pageLength,
      pagesAttempted: totalPages,
      pagesRead,
      failedPage,
      stopReason: stopReason || (incomplete ? 'below-expected-total' : 'complete'),
      visibleState
    };
  }

  function isCatalogScrapeComplete(result) {
    if (!result?.items?.length) return false;
    if (result.stopped) return true;
    if (result.incomplete) return false;
    if (!Number.isFinite(result.expectedTotal) || result.expectedTotal <= 0) return true;
    return result.items.length >= result.expectedTotal;
  }

  function catalogItemsMatchVisibleSearch(items, visibleState) {
    const query = normalizedFilterText(visibleState?.filters?.q || '');
    if (!query) return true;
    const terms = query.split(/\s+/).filter(Boolean);
    if (!terms.length || !items?.length) return true;
    return items.every(item => {
      const text = normalizedFilterText([
        item?.title,
        item?.description,
        item?.rawText,
        item?.lot
      ].filter(Boolean).join(' '));
      return terms.every(term => text.includes(term));
    });
  }

  function validateCatalogExportAgainstVisibleState(result, visibleState, route = {}) {
    const items = result?.items || result?.lots || [];
    if (!visibleState) return { ok: true };
    if (isHibidAccountExportRoute(route)) return { ok: true };
    if (visibleState.noMatches && items.length) {
      return { ok: false, reason: 'visible-no-matches-with-exported-lots' };
    }
    const hasVisibleExpected = visibleState.expectedTotal !== null
      && visibleState.expectedTotal !== undefined
      && Number.isFinite(Number(visibleState.expectedTotal));
    const hasResultExpected = result?.expectedTotal !== null
      && result?.expectedTotal !== undefined
      && Number.isFinite(Number(result?.expectedTotal));
    const visibleExpected = Number(visibleState.expectedTotal);
    const resultExpected = Number(result?.expectedTotal);
    if (visibleState.hasActiveFilters && hasVisibleExpected && hasResultExpected
      && visibleExpected !== resultExpected && String(result?.source || '').includes('hibid')) {
      return { ok: false, reason: 'filtered-count-mismatch' };
    }
    if (visibleState.activeFilterKeys?.includes('q')
      && String(result?.source || '') !== 'hibid-state'
      && items.length
      && !catalogItemsMatchVisibleSearch(items, visibleState)) {
      return { ok: false, reason: 'filtered-search-results-do-not-match-query' };
    }
    if (visibleState.hasActiveFilters && result?.rejectedSource === 'filter-mismatch') {
      return { ok: false, reason: 'filtered-source-mismatch' };
    }
    return { ok: true };
  }

  function isHibidCurrentBidsRoute(route = {}) {
    const kind = String(route?.kind || '').trim();
    return kind === 'currentbids-winning' || kind === 'currentbids-outbid';
  }

  function isHibidAccountExportRoute(route = {}) {
    const kind = String(route?.kind || '').trim();
    return isHibidCurrentBidsRoute(route) || kind === 'watchlist' || kind === 'watchlist-outbid';
  }

  function scraperResultRows(result) {
    const rows = [
      ...(Array.isArray(result?.items) ? result.items : []),
      ...(Array.isArray(result?.lots) ? result.lots : []),
      ...(Array.isArray(result?.sales) ? result.sales : []),
      ...(Array.isArray(result?.listings) ? result.listings : []),
    ].filter(Boolean);
    const seen = new Set();
    return rows.filter(row => {
      const key = typeof row === 'object' && row !== null
        ? row
        : String(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function uniqueNonEmpty(values) {
    return Array.from(new Set(values.map(value => String(value || '').trim()).filter(Boolean)));
  }

  function scraperResultPageKinds(result) {
    return uniqueNonEmpty([
      result?.context?.pageKind,
      ...scraperResultRows(result).map(row => row?.pageKind),
    ]);
  }

  function expectedTotalFromScraperResult(result) {
    const candidates = [
      result?.expectedTotal,
      result?.context?.expectedTotal,
      result?.context?.totalSales,
      result?.context?.visibleCount,
    ];
    for (const value of candidates) {
      const total = Number(value);
      if (Number.isFinite(total) && total > 0) return total;
    }
    return null;
  }

  function validateScraperResultCount(result, reason) {
    const expectedTotal = expectedTotalFromScraperResult(result);
    if (!expectedTotal) return { ok: true };
    const rows = scraperResultRows(result);
    if (rows.length > expectedTotal) return { ok: false, reason };
    return { ok: true };
  }

  function validateScraperCompleteness(result, reason) {
    if (result?.incomplete) return { ok: false, reason };
    return { ok: true };
  }

  function trimRowsToExpectedTotal(rows, expectedTotal) {
    const total = Number(expectedTotal);
    if (!Number.isFinite(total) || total <= 0 || !Array.isArray(rows) || rows.length <= total) {
      return { rows: Array.isArray(rows) ? rows : [], trimmed: false, originalCount: Array.isArray(rows) ? rows.length : 0 };
    }
    return { rows: rows.slice(0, total), trimmed: true, originalCount: rows.length };
  }

  function validateAuctionNinjaExportAgainstRoute(result, route = {}) {
    const routeKind = String(route?.kind || '').trim();
    const allowedKind = routeKind === 'item-detail' ? 'sale-catalog' : routeKind;
    if (!allowedKind) return { ok: true };
    const pageKinds = scraperResultPageKinds(result);
    if (pageKinds.length && pageKinds.some(kind => kind !== allowedKind)) {
      return { ok: false, reason: 'auctionninja-page-kind-mismatch' };
    }
    if (routeKind === 'sale-catalog' && route.saleId && result?.context?.saleId
      && String(result.context.saleId) !== String(route.saleId)) {
      return { ok: false, reason: 'auctionninja-sale-id-mismatch' };
    }
    const completeValidation = validateScraperCompleteness(result, 'auctionninja-incomplete');
    if (!completeValidation.ok) return completeValidation;
    const countValidation = validateScraperResultCount(result, 'auctionninja-count-exceeds-expected');
    if (!countValidation.ok) return countValidation;
    return { ok: true };
  }

  function validateAarExportAgainstRoute(result, route = {}) {
    const routeKind = String(route?.kind || '').trim();
    if (!routeKind) return { ok: true };
    const pageKinds = scraperResultPageKinds(result);
    if (pageKinds.length && pageKinds.some(kind => kind !== routeKind)) {
      return { ok: false, reason: 'aar-page-kind-mismatch' };
    }
    if (routeKind === 'aar-auction-catalog' && route.auctionId) {
      const routeAuctionId = String(route.auctionId);
      const contextAuctionId = String(result?.context?.auctionId || '');
      const rowAuctionIds = uniqueNonEmpty(scraperResultRows(result).map(row => row?.auctionId));
      if ((contextAuctionId && contextAuctionId !== routeAuctionId)
        || rowAuctionIds.some(auctionId => auctionId !== routeAuctionId)) {
        return { ok: false, reason: 'aar-auction-id-mismatch' };
      }
    }
    const completeValidation = validateScraperCompleteness(result, 'aar-incomplete');
    if (!completeValidation.ok) return completeValidation;
    const countValidation = validateScraperResultCount(result, 'aar-count-exceeds-expected');
    if (!countValidation.ok) return countValidation;
    return { ok: true };
  }

  function validateGovDealsExportAgainstRoute(result, route = {}) {
    const routeKind = String(route?.kind || '').trim();
    if (!routeKind) return { ok: true };
    const pageKinds = scraperResultPageKinds(result);
    if (pageKinds.length && pageKinds.some(kind => kind !== routeKind)) {
      return { ok: false, reason: 'govdeals-page-kind-mismatch' };
    }
    if (routeKind === 'govdeals-new-listings') {
      const expectedZip = String(route.zipcode || '').trim();
      const expectedMiles = String(route.miles || '').trim();
      const contextZip = String(result?.context?.zipcode || '').trim();
      const contextMiles = String(result?.context?.miles || '').trim();
      if ((expectedZip && contextZip !== expectedZip) || (expectedMiles && contextMiles !== expectedMiles)) {
        return { ok: false, reason: 'govdeals-filter-mismatch' };
      }
    }
    if (routeKind === 'govdeals-asset') {
      const expectedAssetId = String(route.assetId || '').trim();
      const expectedAccountId = String(route.accountId || '').trim();
      const rows = scraperResultRows(result);
      const assetIds = uniqueNonEmpty([result?.context?.assetId, ...rows.map(row => row?.assetId)]);
      const accountIds = uniqueNonEmpty([result?.context?.accountId, ...rows.map(row => row?.accountId)]);
      if ((expectedAssetId && assetIds.length && assetIds.some(assetId => assetId !== expectedAssetId))
        || (expectedAccountId && accountIds.length && accountIds.some(accountId => accountId !== expectedAccountId))) {
        return { ok: false, reason: 'govdeals-asset-id-mismatch' };
      }
    }
    const completeValidation = validateScraperCompleteness(result, 'govdeals-incomplete');
    if (!completeValidation.ok) return completeValidation;
    const countValidation = validateScraperResultCount(result, 'govdeals-count-exceeds-expected');
    if (!countValidation.ok) return countValidation;
    return { ok: true };
  }

  function rowSourcesFromResult(result) {
    return uniqueNonEmpty([
      result?.source,
      result?.context?.source,
      ...scraperResultRows(result).map(row => row?.source),
    ]);
  }

  function describeExportGuardFailure(reason, context = {}) {
    const labels = {
      'catalog-route-mismatch': 'active page route is not a catalog export route',
      'catalog-source-mismatch': 'copied data came from a different site source',
      'catalog-auction-id-mismatch': 'copied lots belong to a different auction',
      'catalog-incomplete': 'scrape stopped before the page total was collected',
      'catalog-count-exceeds-expected': 'copied count exceeds the page total',
      'visible-no-matches-with-exported-lots': 'the page shows no matches but copied lots were found',
      'filtered-count-mismatch': 'copied count does not match the active filter result',
      'filtered-search-results-do-not-match-query': 'copied lots do not match the active search',
      'filtered-source-mismatch': 'filtered data source did not match the active page',
      'filter-mismatch': 'copied data did not match the active filters',
      'ambiguous-unfiltered-state': 'embedded page data was ambiguous, so it was rejected',
      'live-route-mismatch': 'active page is not a live catalog route',
      'live-page-kind-mismatch': 'copied data is not live-lot data',
      'live-source-mismatch': 'copied live data came from a different source',
      'live-incomplete': 'live scrape stopped before all open lots were collected',
      'live-count-exceeds-expected': 'copied live count exceeds the page total',
    };
    const label = labels[String(reason || '')] || String(reason || 'unknown export guard failure');
    const count = Number(context.count);
    const expected = Number(context.expectedTotal);
    const countSuffix = Number.isFinite(count) && Number.isFinite(expected) && expected > 0
      ? ` (${count}/${expected})`
      : '';
    return `${label}${countSuffix}.`;
  }

  function validateCatalogExportAgainstRoute(result, route = {}) {
    const routeKind = String(route?.kind || '').trim();
    if (routeKind && !['catalog', 'watchlist', 'watchlist-outbid', 'currentbids-winning', 'currentbids-outbid', 'lot'].includes(routeKind)) {
      return { ok: false, reason: 'catalog-route-mismatch' };
    }
    const routeSource = String(route?.source || '').trim().toLowerCase();
    const rowSources = rowSourcesFromResult(result);
    const sourceText = rowSources.join(' ').toLowerCase();
    const looksAjWillner = /ajwillner|aj\s+willner/.test(sourceText);
    const looksOtherAuctionSource = /auctionninja|aar auctions|govdeals|facebook|ebay/.test(sourceText);

    if (routeSource === 'ajwillner') {
      if (!looksAjWillner) return { ok: false, reason: 'catalog-source-mismatch' };
      const expectedAuctionId = String(route?.auctionId || '').trim();
      if (expectedAuctionId) {
        const rowAuctionIds = uniqueNonEmpty([
          result?.context?.auctionId,
          ...scraperResultRows(result).flatMap(row => [
            row?.auctionId,
            firstMatch(row?.url || '', [/\/ui\/auctions\/(\d+)/i])
          ])
        ]);
        if (rowAuctionIds.length && rowAuctionIds.some(auctionId => auctionId !== expectedAuctionId)) {
          return { ok: false, reason: 'catalog-auction-id-mismatch' };
        }
      }
    } else if (routeSource === 'hibid' || !routeSource) {
      if (looksAjWillner || looksOtherAuctionSource) return { ok: false, reason: 'catalog-source-mismatch' };
    }

    if (isHibidAccountExportRoute(route)) {
      const countValidation = validateScraperResultCount(result, `${routeKind}-count-exceeds-expected`);
      if (!countValidation.ok) return countValidation;
      return { ok: true };
    }

    const completeValidation = validateScraperCompleteness(result, 'catalog-incomplete');
    if (!completeValidation.ok) return completeValidation;
    const countValidation = validateScraperResultCount(result, 'catalog-count-exceeds-expected');
    if (!countValidation.ok) return countValidation;
    return { ok: true };
  }

  function validateLiveExportAgainstRoute(result, route = {}) {
    if (String(route?.kind || '') !== 'live') return { ok: false, reason: 'live-route-mismatch' };
    const pageKinds = scraperResultPageKinds(result);
    if (pageKinds.length && pageKinds.some(kind => kind !== 'live')) {
      return { ok: false, reason: 'live-page-kind-mismatch' };
    }
    const sourceText = rowSourcesFromResult(result).join(' ').toLowerCase();
    if (sourceText && !/hibid|live/.test(sourceText)) {
      return { ok: false, reason: 'live-source-mismatch' };
    }
    const completeValidation = validateScraperCompleteness(result, 'live-incomplete');
    if (!completeValidation.ok) return completeValidation;
    const countValidation = validateScraperResultCount(result, 'live-count-exceeds-expected');
    if (!countValidation.ok) return countValidation;
    return { ok: true };
  }

  function normalizeFlipTrackerSource(value) {
    const text = String(value || '').toLowerCase();
    if (/facebook|marketplace/.test(text)) return 'facebook';
    if (/ebay/.test(text)) return 'ebay';
    return '';
  }

  function validateFlipTrackerExportAgainstRoute(result, route = {}) {
    const expectedSource = normalizeFlipTrackerSource(route?.source || route?.kind);
    if (!expectedSource) return { ok: true };
    const rowSources = rowSourcesFromResult(result).map(normalizeFlipTrackerSource).filter(Boolean);
    if (!rowSources.length && scraperResultRows(result).length) {
      return { ok: false, reason: 'fliptracker-source-mismatch' };
    }
    if (rowSources.some(source => source !== expectedSource)) {
      return { ok: false, reason: 'fliptracker-source-mismatch' };
    }
    return { ok: true };
  }

  function validateScraperExportAgainstRoute(result, mode = '', route = {}) {
    if (!result) return { ok: true };
    const normalizedMode = String(mode || '').toLowerCase();
    if (normalizedMode === 'catalog' || normalizedMode === 'hibid-catalog' || normalizedMode === 'ajwillner') return validateCatalogExportAgainstRoute(result, route);
    if (normalizedMode === 'live' || normalizedMode === 'hibid-live') return validateLiveExportAgainstRoute(result, route);
    if (normalizedMode === 'fliptracker') return validateFlipTrackerExportAgainstRoute(result, route);
    if (normalizedMode === 'auctionninja') return validateAuctionNinjaExportAgainstRoute(result, route);
    if (normalizedMode === 'aar') return validateAarExportAgainstRoute(result, route);
    if (normalizedMode === 'govdeals') return validateGovDealsExportAgainstRoute(result, route);
    return { ok: true };
  }

  function parseEbaySellerHubTableListingsHtml(html) {
    const text = String(html || '');
    const rowChunks = Array.from(text.matchAll(/<tr\b[\s\S]*?<\/tr>/gi)).map(match => match[0])
      .concat(Array.from(text.matchAll(/<div\b[^>]+role=["']row["'][\s\S]*?(?=<div\b[^>]+role=["']row["']|$)/gi)).map(match => match[0]));
    const listings = [];

    rowChunks.forEach(chunk => {
      if (!/(?:\/itm\/\d+|itemId=\d+|itemid=\d+)/i.test(chunk)) return;
      const anchors = Array.from(chunk.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)).map(match => {
        const attrs = match[1] || '';
        const href = decodeHtml(firstMatch(attrs, [/href="([^"]+)"/i, /data-href="([^"]+)"/i]));
        const text = cleanListingTitle(stripHtml(match[2] || '').replace(/\bopens in new window\b.*$/i, ''));
        return { href, text };
      });
      const itemHref = anchors.find(anchor => /\/itm\/\d+/i.test(anchor.href))?.href || '';
      const idHref = anchors.find(anchor => /(?:\/itm\/\d+|itemId=\d+|itemid=\d+)/i.test(anchor.href))?.href || '';
      const itemId = firstMatch(`${itemHref} ${idHref} ${chunk}`, [
        /\/itm\/(\d+)/i,
        /itemId=(\d+)/i,
        /itemid=(\d+)/i
      ]);
      const titleAnchor = anchors
        .filter(anchor => anchor.text && !/^(edit|actions?|sell similar|sell it faster|promote|preview|view|download|upload)$/i.test(anchor.text))
        .sort((a, b) => b.text.length - a.text.length)[0];
      const title = cleanEbaySellerHubTitle(titleAnchor?.text || stripHtml(firstMatch(chunk, [/aria-label="([^"]+)"/i])));
      const url = normalizeListingUrl(itemHref || (itemId ? `/itm/${itemId}` : idHref));
      const price = parseDollarAmount(chunk);
      if (!title || !price) return;
      const rowText = stripHtml(chunk);

      listings.push({
        source: 'eBay',
        itemId,
        title,
        price,
        url,
        status: /inactive|ended|sold/i.test(rowText) ? 'Inactive' : 'Active',
        listedDateText: firstMatch(rowText, [/\b(Listed\s+(?:today|yesterday|on\s+[^|]+?))(?:\s{2,}|$)/i]),
        shippingText: firstMatch(rowText, [/(\+\s*Shipping|Free shipping|Buyer pays shipping)/i]),
        views: parsePlainInteger(firstMatch(rowText, [/\b([\d,]+)\s+Views?\b/i, /\b([\d,]+)\s+View\b/i])),
        watchers: parsePlainInteger(firstMatch(rowText, [/\b([\d,]+)\s+Watchers?\b/i])),
        clicks: null,
      });
    });

    return dedupeListings(listings);
  }

  function parseEbayActiveListingsHtml(html) {
    const text = String(html || '');
    const chunks = text.split(/(?=<div[^>]+(?:qa-id="active-item-|\bid="active-item-|class="[^"]*active-item))/i);
    const listings = [];

    chunks.forEach(chunk => {
      if (!/ebay\.com\/itm\/\d+|active-item-\d+|item__price/i.test(chunk)) return;
      const url = normalizeListingUrl(firstMatch(chunk, [
        /href="(https:\/\/www\.ebay\.com\/itm\/\d+[^"]*)"/i,
        /href="(\/itm\/\d+[^"]*)"/i
      ]));
      const itemId = firstMatch(chunk, [
        /active-item-(\d+)/i,
        /Item ID:\s*(\d+)/i,
        /\/itm\/(\d+)/i
      ]);
      const title = cleanEbaySellerHubTitle(stripHtml(firstMatch(chunk, [
        /<h3[^>]*class="[^"]*item-title[^"]*"[\s\S]*?<a[^>]*>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>/i,
        /<a[^>]+href="(?:https:\/\/www\.ebay\.com)?\/itm\/\d+[^"]*"[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/i,
        /<img[^>]+alt="([^"]+)"/i
      ])));
      const priceHtml = firstMatch(chunk, [/<div[^>]+class="[^"]*item__price[^"]*"[^>]*>([\s\S]*?)<\/div>/i]);
      const price = parseDollarAmount(stripHtml(priceHtml) || chunk);
      if (!title || !price) return;
      const activityText = stripHtml(chunk);
      const views = parsePlainInteger(firstMatch(activityText, [/\b([\d,]+)\s+Views?\b/i, /\b([\d,]+)\s+View\b/i]));
      const watchers = parsePlainInteger(firstMatch(activityText, [/\b([\d,]+)\s+Watchers?\b/i]));

      listings.push({
        source: 'eBay',
        itemId,
        title,
        price,
        url,
        status: 'Active',
        listedDateText: stripHtml(firstMatch(chunk, [/<div[^>]+class="[^"]*item__listing-status[^"]*"[^>]*>([\s\S]*?)<\/div>/i])),
        shippingText: stripHtml(firstMatch(chunk, [/<div[^>]+class="[^"]*item__shipping-price[^"]*"[^>]*>([\s\S]*?)<\/div>/i])),
        views,
        watchers,
        clicks: null,
      });
    });

    return dedupeListings(listings.concat(parseEbaySellerHubTableListingsHtml(text)));
  }

  function parseFacebookMarketplaceListingsHtml(html) {
    const text = String(html || '');
    const listings = [];
    const markSoldPattern = /aria-label="Mark as sold\s+([^"]+)"/gi;
    let match;

    while ((match = markSoldPattern.exec(text))) {
      const title = cleanListingTitle(decodeHtml(match[1]));
      const titleIndex = title ? text.lastIndexOf(title, match.index) : -1;
      const start = titleIndex >= 0 ? titleIndex : Math.max(0, match.index - 3200);
      const windowHtml = text.slice(start, match.index);
      const priceMatches = Array.from(windowHtml.matchAll(/\$\s*([\d,]+(?:\.\d{1,2})?)/g));
      const price = priceMatches.length ? Number(priceMatches[priceMatches.length - 1][1].replace(/,/g, '')) : null;
      const url = normalizeListingUrl(firstMatch(windowHtml, [
        /href="(https:\/\/www\.facebook\.com\/marketplace\/item\/\d+\/?[^"]*)"/i,
        /href="(\/marketplace\/item\/\d+\/?[^"]*)"/i
      ]));
      const fullText = stripHtml(windowHtml);
      const clicks = parsePlainInteger(firstMatch(fullText, [/\b([\d,]+)\s+clicks?\s+on\s+listing\b/i]));
      const listedDateText = firstMatch(fullText, [/\b(Active\s+·\s+Listed\s+on\s+[^·]+?)(?:\s+Listed|\s+\d+\s+clicks|$)/i]) || 'Active';

      if (!title || !price) continue;
      listings.push({
        source: 'Facebook Marketplace',
        itemId: firstMatch(url, [/\/marketplace\/item\/(\d+)/i]),
        title,
        price,
        url,
        status: /sold|inactive/i.test(listedDateText) ? 'Inactive' : 'Active',
        listedDateText,
        shippingText: '',
        views: null,
        watchers: null,
        clicks,
      });
    }

    if (!listings.length) {
      const cardPattern = /<div[^>]+aria-label="([^"]+)"[^>]+role="button"[\s\S]*?(?=<div[^>]+aria-label=|$)/gi;
      let card;
      while ((card = cardPattern.exec(text))) {
        const title = cleanListingTitle(decodeHtml(card[1]));
        if (!title || /^Mark as sold\b/i.test(title)) continue;
        const chunk = card[0];
        const price = parseDollarAmount(chunk);
        if (!price) continue;
        const fullText = stripHtml(chunk);
        listings.push({
          source: 'Facebook Marketplace',
          itemId: firstMatch(chunk, [/\/marketplace\/item\/(\d+)/i]),
          title,
          price,
          url: normalizeListingUrl(firstMatch(chunk, [
            /href="(https:\/\/www\.facebook\.com\/marketplace\/item\/\d+\/?[^"]*)"/i,
            /href="(\/marketplace\/item\/\d+\/?[^"]*)"/i
          ])),
          status: /sold|inactive/i.test(fullText) ? 'Inactive' : 'Active',
          listedDateText: firstMatch(fullText, [/\b(Active\s+·\s+Listed\s+on\s+[^·]+?)(?:\s+Listed|\s+\d+\s+clicks|$)/i]) || 'Active',
          shippingText: '',
          views: null,
          watchers: null,
          clicks: parsePlainInteger(firstMatch(fullText, [/\b([\d,]+)\s+clicks?\s+on\s+listing\b/i])),
        });
      }
    }

    return dedupeListings(listings);
  }

  function parseFlipTrackerActiveListingsHtml(html, context = {}) {
    const sourceUrl = String(context.url || '');
    const text = String(html || '');
    if (/ebay\.com/i.test(sourceUrl) || /active-item-\d+|item__price|ebay\.com\/itm\/\d+/i.test(text)) {
      return parseEbayActiveListingsHtml(text);
    }
    if (/facebook\.com/i.test(sourceUrl) || /Mark as sold|clicks on listing|marketplace\/item\//i.test(text)) {
      return parseFacebookMarketplaceListingsHtml(text);
    }
    return dedupeListings(parseEbayActiveListingsHtml(text).concat(parseFacebookMarketplaceListingsHtml(text)));
  }

  function buildFlipTrackerListingsExportHtml(listings, meta = {}) {
    const rows = Array.isArray(listings) ? listings : [];
    const generatedAt = meta.generatedAt || new Date().toISOString();
    const pageUrl = meta.pageUrl || (typeof location !== 'undefined' ? location.href : '');
    const source = rows[0]?.source || 'Unknown';
    const cards = rows.map((listing, index) => {
      if (listing.source === 'eBay') {
        const itemId = listing.itemId || firstMatch(listing.url, [/\/itm\/(\d+)/i]) || String(index + 1);
        return `
          <div qa-id="active-item-${escapeHtml(itemId)}" class="active-item" data-fliptracker-source="ebay">
            <h3 class="item-title"><a href="${escapeHtml(listing.url || '')}"><span>${escapeHtmlText(listing.title || '')}</span></a></h3>
            <div class="item__itemid"><span>Item ID: ${escapeHtml(itemId)}</span></div>
            <div class="item__price"><span>$${Number(listing.price || 0).toFixed(2)}</span><span> Buy It Now</span></div>
            <div class="item__shipping-price">${escapeHtml(listing.shippingText || '')}</div>
            <div class="item__listing-status">${escapeHtml(listing.listedDateText || listing.status || 'Active')}</div>
            <div class="me-item-activity__column"><span>${Number.isFinite(listing.views) ? listing.views : ''}</span><span>View</span></div>
            <div class="me-item-activity__column"><span>${Number.isFinite(listing.watchers) ? listing.watchers : ''}</span><span>Watchers</span></div>
          </div>`;
      }
      return `
        <div aria-label="${escapeHtml(listing.title || '')}" role="button" data-fliptracker-source="facebook">
          <span>${escapeHtmlText(listing.title || '')}</span><span>$${Number(listing.price || 0).toFixed(2)}</span>
          <span>${escapeHtmlText(listing.listedDateText || listing.status || 'Active')}</span>
          <span>Listed on Marketplace · ${Number.isFinite(listing.clicks) ? listing.clicks : 0} clicks on listing</span>
          ${listing.url ? `<a href="${escapeHtml(listing.url)}">Open</a>` : ''}
        </div>
        <div aria-label="Mark as sold ${escapeHtml(listing.title || '')}" role="button">Mark as sold</div>`;
    }).join('\n');

    return `<!doctype html>
<html>
<head><meta charset="utf-8"><title>FlipTracker Active Listing Export</title></head>
<body data-fliptracker-export="active-listings">
<h1>FlipTracker Active Listing Export</h1>
<script type="application/json" id="fliptracker-export-metadata">${JSON.stringify({ generatedAt, pageUrl, source, count: rows.length }).replace(/</g, '\\u003c')}</script>
${cards}
</body>
</html>`;
  }

  const Core = {
    APP_NAME,
    APP_SHORT_NAME,
    evaluateLot,
    moneyFromText,
    numberFromText,
    parseBidPlan,
    titleMatches,
    DEBUG_PREFIX,
    MENU_COMMANDS,
    resolveHiBidPage,
    resolveFlipTrackerPage,
    resolveAuctionNinjaPage,
    resolveAarAuctionsPage,
    resolveGovDealsPage,
    resolveAssistantMode,
    getExpectedLotTotal,
    findCatalogNextPageButton,
    parseAuctionNinjaCatalogRange,
    parseAuctionNinjaCategoryResultCount,
    findAuctionNinjaCatalogPageUrls,
    extractAuctionNinjaSaleContext,
    extractAuctionNinjaCatalogLots,
    extractAuctionNinjaFollowedItems,
    extractAuctionNinjaWonItems,
    extractAuctionNinjaBidHistoryItems,
    extractAuctionNinjaAuctionSearchSales,
    extractAuctionNinjaCategoryContext,
    extractAuctionNinjaCategoryItems,
    extractAarAuctionCards,
    extractAarCatalogContext,
    extractAarCatalogLots,
    extractGovDealsSellerContext,
    extractGovDealsSearchContext,
    extractGovDealsAssetDetail,
    extractGovDealsListings,
    findAjWillnerScrollContainer,
    getAjWillnerScrollStepSize,
    getAjWillnerExpectedTotal,
    extractAjWillnerVisibleListings,
    normalizeAjWillnerApiItem,
    ajWillnerSearchApiUrl,
    scrapeAjWillnerApiListings,
    scrapeAjWillnerListings,
    scrapeAuctionNinjaCatalogLots,
    scrapeAuctionNinjaAccountItems,
    scrapeAuctionNinjaAuctionSearchSales,
    findAuctionNinjaCategoryPageUrls,
    scrapeAuctionNinjaCategoryItems,
    scrapeAarAuctionCards,
    scrapeAarCatalogLots,
    scrapeGovDealsListings,
    buildAuctionNinjaLlmBrief,
    buildAuctionNinjaFollowedItemsLlmBrief,
    buildAuctionNinjaWonItemsLlmBrief,
    buildAuctionNinjaBidHistoryLlmBrief,
    buildAuctionNinjaAuctionSearchLlmBrief,
    buildAuctionNinjaCategoryLlmBrief,
    buildAarAuctionListLlmBrief,
    buildAarCatalogLlmBrief,
    buildGovDealsLlmBrief,
    getAarResearchSettings,
    saveAarResearchSettings,
    getSiteShortcuts,
    findAuctionNinjaNextPageControl,
    extractHibidVisiblePageState,
    extractHibidApolloLots,
    extractHibidStateFromDocument,
    isHibidCurrentBidsRoute,
    isHibidAccountExportRoute,
    validateCatalogExportAgainstVisibleState,
    describeExportGuardFailure,
    validateScraperExportAgainstRoute,
    isCatalogScrapeComplete,
    getHibidScrapeLimits,
    scrapeCatalogLots,
    findDialog,
    findBidButton,
    findLiveBidButton,
    findLiveLoadMoreButton,
    findConfirmButton,
    findConfirmSurface,
    getLoadTarget,
    isLiveCatalogPage,
    isFlipTrackerListingPage,
    shouldInitOnLocation,
    getLotTiles,
    extractLot,
    extractCurrentBidsLot,
    extractTextLots,
    extractLiveAuctionState,
    extractLivePageLots,
    expandLivePageLots,
    buildLlmAuctionBrief,
    parseEbayActiveListingsHtml,
    parseFacebookMarketplaceListingsHtml,
    parseFlipTrackerActiveListingsHtml,
    buildFlipTrackerListingsExportHtml,
    buildPanelHtml,
    evaluateLiveLot,
    prepareLiveBid,
    findLotOnPage,
    planTextFromLoadedLots,
    addLotToPlanText,
    getPlanStorageKey,
    getStoredPlanText,
    shouldRebuildPanelForMode,
    shouldTeardownPanelForRebuild,
    scanPlan,
    lotSummary,
    getStoredMinimized,
    getStoredDebugEnabled
  };
  globalThis.HiBidBidAssistantCore = Core;

  function exposeAssistantCanary(target) {
    if (!target) return false;
    try {
      target.__HIBID_UNIFIED_ASSISTANT_ACTIVE__ = true;
      target.__FLIPPERADDON_VERSION__ = SCRIPT_VERSION;
      return true;
    } catch (error) {
      return false;
    }
  }

  exposeAssistantCanary(globalThis);
  if (typeof unsafeWindow !== 'undefined') {
    exposeAssistantCanary(unsafeWindow);
  }

  async function enableSinglePage(status) {
    const headerText = textOf(document.querySelector('.lot-list-header'));
    if (/Total Lots:\s*\d/i.test(headerText)) return;

    const button = document.querySelector('.single-page-button');
    if (!button) return;

    status('Turning on Single Page...');
    button.click();
    for (let i = 0; i < 50; i += 1) {
      await wait(200);
      if (/Total Lots:\s*\d/i.test(textOf(document.querySelector('.lot-list-header')))) break;
    }
  }

  async function loadLots(status, shouldStop, collectLots = () => {}, options = {}) {
    const limits = getHibidScrapeLimits(options.expectedTotal, options);
    const startedAt = Date.now();
    await enableSinglePage(status);
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    await wait(500);
    let lastUniqueCount = collectLots() || 0;
    let lastScrollY = Math.round(window.scrollY || document.documentElement.scrollTop || 0);

    let stuck = 0;
    let stopReason = '';

    for (let i = 0; i < limits.maxSteps; i += 1) {
      if (shouldStop()) {
        stopReason = 'user-stop';
        break;
      }
      const uniqueCount = collectLots() || 0;
      status(`Loading lots... ${uniqueCount}${limits.expectedTotal ? `/${limits.expectedTotal}` : ''} unique`);
      if (limits.expectedTotal && uniqueCount >= limits.expectedTotal) {
        stopReason = 'expected-total';
        break;
      }
      if (Date.now() - startedAt >= limits.maxDurationMs) {
        stopReason = 'dom-scrape-timeout';
        debug('hibid DOM scrape timed out', {
          uniqueCount,
          expectedTotal: limits.expectedTotal,
          maxDurationMs: limits.maxDurationMs,
          steps: i
        });
        break;
      }
      const scrollY = Math.round(window.scrollY || document.documentElement.scrollTop || 0);
      const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      const atBottom = scrollY >= Math.max(0, maxScrollY - 2);
      if (uniqueCount === lastUniqueCount && scrollY === lastScrollY) stuck += 1;
      else stuck = 0;
      lastUniqueCount = uniqueCount;
      lastScrollY = scrollY;
      if (stuck >= 8 || (atBottom && stuck >= 2)) {
        stopReason = atBottom ? 'dom-bottom-no-growth' : 'dom-no-growth';
        break;
      }

      window.scrollBy({ top: Math.max(700, Math.floor(window.innerHeight * 0.9)), left: 0, behavior: 'instant' });
      await wait(180);
    }

    if (!stopReason) stopReason = 'dom-step-limit';
    const finalCount = collectLots() || 0;
    const result = {
      expectedTotal: limits.expectedTotal,
      finalCount,
      stopReason,
      steps: Math.ceil((Date.now() - startedAt) / 180)
    };
    debug('hibid DOM scrape finished', result);
    return result;
  }

  function isAjWillnerHost(hostname = (typeof location !== 'undefined' ? location.hostname : '')) {
    return String(hostname || '').toLowerCase() === 'bid.ajwillnerauctions.com';
  }

  function findAjWillnerScrollContainer(root = document) {
    const known = root.querySelector?.('[data-testid="auction-list-scroll"]');
    if (known && known.scrollHeight > known.clientHeight) return known;

    const legacyGrid = root.querySelector?.('.ReactVirtualized__Grid');
    if (legacyGrid && legacyGrid.scrollHeight > legacyGrid.clientHeight) return legacyGrid;

    return Array.from(root.querySelectorAll?.('div') || [])
      .filter(el => el.scrollHeight > el.clientHeight + 100)
      .sort((a, b) => (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight))[0] || null;
  }

  function getAjWillnerScrollStepSize(scrollContainer = {}) {
    const clientHeight = Number(scrollContainer?.clientHeight) || 700;
    return Math.max(180, Math.min(360, Math.ceil(clientHeight * 0.42)));
  }

  function getAjWillnerExpectedTotal(root = document, scrollContainer = null) {
    const text = `${textOf(scrollContainer)} ${getRootText(root)}`;
    const foundMatch = text.match(/(\d[\d,]*)\s+items\s+found/i);
    if (foundMatch) return Number(foundMatch[1].replace(/,/g, ''));
    const itemMatch = text.match(/\b(\d[\d,]*)\s+items\b/i);
    return itemMatch ? Number(itemMatch[1].replace(/,/g, '')) : null;
  }

  function parseAjWillnerTitle(value) {
    const text = textOf({ textContent: value });
    const match = text.match(/^#?\s*([A-Za-z0-9.-]+)\s*(?:\u2022|\||-)\s*(.+)$/);
    if (!match) return { lot: '', title: text.replace(/^#\s*/, '') };
    return {
      lot: match[1],
      title: match[2].replace(/\s+/g, ' ').trim()
    };
  }

  function descriptionTextOf(el) {
    const html = el?.innerHTML || '';
    if (/<br\s*\/?>/i.test(html)) {
      return decodeHtml(html)
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<[^>]+>/g, ' ')
        .split(/\n+/)
        .map(line => line.replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .join('\n')
        .trim();
    }
    return textOf(el);
  }

  function pickAjWillnerImage(card, base) {
    const direct = pickFirstImage(card, base);
    if (direct) return direct;

    const source = card.querySelector?.('source[srcset], img[srcset]');
    const srcset = source?.getAttribute?.('srcset') || '';
    const candidate = srcset
      .split(',')
      .map(part => part.trim().split(/\s+/)[0])
      .filter(Boolean)
      .pop();
    return candidate ? absoluteUrl(candidate, base) : '';
  }

  function extractAjWillnerVisibleListings(root = document, loc = location) {
    const base = loc?.href || 'https://bid.ajwillnerauctions.com/';
    const cards = Array.from(root.querySelectorAll?.('[data-testid^="list-item-"]') || [])
      .filter(card => /^list-item-\d+$/i.test(card.getAttribute?.('data-testid') || ''));

    return cards.map(card => {
      const testId = card.getAttribute?.('data-testid') || '';
      const id = testId.replace(/^list-item-/i, '');
      const linkEl = card.querySelector?.('.titleLink[href], a.titleLink[href], a[href*="/ui/auctions/"]');
      const titleEl = card.querySelector?.('.titleLink h1, h1');
      const titleParts = parseAjWillnerTitle(textOf(titleEl) || textOf(linkEl));
      const href = linkEl?.getAttribute?.('href') || linkEl?.href || '';
      const bidText = textOf(card.querySelector?.('.bidsLine span, .bidsLine'));
      const highBid = bidText || (textOf(card).match(/\b(?:High|Current)\s+bid\s+\$?[\d,]+(?:\.\d{2})?/i)?.[0] || '');
      const status = textOf(card.querySelector?.(`[data-testid="${testId}-status-stripe"]`));
      const rawText = textOf(card);
      const statusText = status || (rawText.match(/\bENDS\s+[\w\s]+?(?=\s+#|\s+Lot|\s*$)/i)?.[0] || '');
      const timeLeft = statusText.replace(/^ENDS\s*/i, '').trim();
      const watchedEl = card.querySelector?.('[data-testid^="star-item-"] input:checked, input[type="checkbox"]:checked, [aria-label*="Unwatch"], [title*="Unwatch"]');
      const userBidStatus = extractUserBidStatus(rawText);
      if (!href || !titleParts.title) return null;

      return {
        source: 'ajwillner',
        id,
        lot: titleParts.lot || id,
        title: titleParts.title,
        url: absoluteUrl(href, base),
        image: pickAjWillnerImage(card, base),
        description: descriptionTextOf(card.querySelector?.('.description')),
        highBid,
        highBidAmount: moneyFromText(highBid),
        currentPrice: moneyFromText(highBid),
        currentBid: moneyFromText(highBid),
        nextBid: '',
        nextBidAmount: null,
        bidCount: textOf(card.querySelector?.('[class*="bidCount"], [data-testid*="bid-count"]')),
        bidCountNumber: numberFromText(textOf(card.querySelector?.('[class*="bidCount"], [data-testid*="bid-count"]'))),
        timeLeft,
        status: statusText,
        userBidStatus,
        isWinning: userBidStatus === 'Winning',
        isOutbid: userBidStatus === 'Outbid',
        watched: Boolean(watchedEl),
        rawText: rawText.slice(0, 1600)
      };
    }).filter(Boolean);
  }

  function cleanAjWillnerApiDescription(item = {}) {
    const raw = item.description_without_html || item.simple_description || stripHtml(item.description || '');
    return cleanGovDealsText(String(raw || '')
      .replace(/\bTerms of Sale\b[\s\S]*$/i, '')
      .replace(/\bAll Items Sold AS-IS[\s\S]*$/i, ''));
  }

  function pickAjWillnerApiImage(item = {}) {
    const image = Array.isArray(item.images) ? item.images[0] : null;
    if (!image) return '';
    return image.lg || image.sm || image.xs || image.xl || image.original || image.url || '';
  }

  function ajWillnerMoneyText(label, value, currencySymbol = '$') {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return '';
    return `${label} ${currencySymbol || '$'}${amount.toLocaleString(undefined, {
      minimumFractionDigits: amount % 1 ? 2 : 0,
      maximumFractionDigits: 2
    })}`;
  }

  function normalizeAjWillnerApiItem(item = {}, loc = location) {
    const auctionId = item.auction_id || getAjWillnerAuctionId(loc);
    const currencySymbol = item.currency_symbol || '$';
    const highAmount = Number(item.api_bidding_state?.high?.amount ?? item.bidding_state?.high?.amount);
    const askAmount = Number(item.api_bidding_state?.ask_amount ?? item.api_bidding_state?.minimum_bid_amount ?? item.bidding_state?.askAmount);
    const bidCount = Number(item.api_bidding_state?.accepted_bid_count ?? item.bidding_state?.acceptedBidCount);
    const statusText = String(item.status || '').replace(/_/g, ' ');
    const url = absoluteUrl(`/ui/auctions/${auctionId}/${item.id}`, loc?.href || 'https://bid.ajwillnerauctions.com/');
    const title = String(item.name || item.displayed_name || item.name_with_prefix || '').trim();
    const description = cleanAjWillnerApiDescription(item);
    if (!item.id || !title) return null;
    return {
      source: 'ajwillner',
      id: String(item.id),
      lot: String(item.lot_identifier || item.simple_id || item.sequence || item.id || '').replace(/^#\s*/, ''),
      title,
      url,
      image: pickAjWillnerApiImage(item),
      description,
      highBid: Number.isFinite(highAmount) ? ajWillnerMoneyText('High bid', highAmount, currencySymbol) : '',
      highBidAmount: Number.isFinite(highAmount) ? highAmount : null,
      currentPrice: Number.isFinite(highAmount) ? highAmount : null,
      currentBid: Number.isFinite(highAmount) ? highAmount : null,
      nextBid: Number.isFinite(askAmount) ? ajWillnerMoneyText('Bid', askAmount, currencySymbol) : '',
      nextBidAmount: Number.isFinite(askAmount) ? askAmount : null,
      bidCount: Number.isFinite(bidCount) ? `${bidCount} ${bidCount === 1 ? 'Bid' : 'Bids'}` : '',
      bidCountNumber: Number.isFinite(bidCount) ? bidCount : null,
      timeLeft: '',
      status: statusText,
      userBidStatus: '',
      isWinning: false,
      isOutbid: false,
      watched: false,
      quantity: Number(item.quantity) || null,
      category: item.main_category || '',
      startAmount: Number(item.start_amount ?? item.bidding_configuration?.start_amount) || null,
      auctionTitle: item.auction_name || '',
      scheduledEndTime: item.scheduled_end_time || item.actual_end_time || '',
      rawText: cleanGovDealsText([
        item.name_with_prefix || item.name || '',
        description,
        Number.isFinite(highAmount) ? ajWillnerMoneyText('High bid', highAmount, currencySymbol) : '',
        Number.isFinite(bidCount) ? `${bidCount} ${bidCount === 1 ? 'Bid' : 'Bids'}` : '',
        statusText
      ].filter(Boolean).join(' '))
    };
  }

  function ajWillnerSearchApiUrl(loc = location, page = 1, perPage = 200) {
    const auctionId = getAjWillnerAuctionId(loc);
    const params = new URLSearchParams(loc?.search || '');
    const apiParams = new URLSearchParams({
      auction_id: auctionId,
      page: String(page),
      per_page: String(perPage),
      exact_category_match: 'true'
    });
    const category = params.get('category') || 'All';
    const subCategory = params.get('subCategory') || params.get('sub_category') || 'Active';
    const query = params.get('q') || params.get('query') || params.get('search') || '';
    if (category) apiParams.set('category', category);
    if (subCategory && !/^active$/i.test(subCategory)) apiParams.set('sub_category', subCategory);
    if (query) apiParams.set('query', query);
    return absoluteUrl(`/api/items/search?${apiParams}`, loc?.href || 'https://bid.ajwillnerauctions.com/');
  }

  async function fetchAjWillnerSearchPage(loc = location, page = 1, perPage = 200) {
    const href = ajWillnerSearchApiUrl(loc, page, perPage);
    const response = await fetch(href, { credentials: 'include' });
    if (!response?.ok) throw new Error(`AJ Willner API page ${page} failed: ${response?.status}`);
    const data = await response.json();
    return { href, data };
  }

  async function scrapeAjWillnerApiListings(status = () => {}, shouldStop = () => false, root = document, loc = location) {
    const perPage = 200;
    const auctionId = getAjWillnerAuctionId(loc);
    if (!auctionId || typeof fetch !== 'function') return null;
    status('Reading AJ Willner API page 1...');
    const first = await fetchAjWillnerSearchPage(loc, 1, perPage);
    const total = Number(first.data?.total) || 0;
    const pageSize = Number(first.data?.per_page) || perPage;
    const totalPages = total ? Math.ceil(total / pageSize) : 1;
    const pages = [first];
    const remaining = [];
    for (let page = 2; page <= totalPages; page += 1) remaining.push(page);
    let cursor = 0;
    const worker = async () => {
      while (cursor < remaining.length && !shouldStop()) {
        const page = remaining[cursor];
        cursor += 1;
        status(`Reading AJ Willner API page ${page}/${totalPages}...`);
        pages.push(await fetchAjWillnerSearchPage(loc, page, pageSize));
      }
    };
    await Promise.all(Array.from({ length: Math.min(4, remaining.length) }, worker));
    const byId = new Map();
    pages
      .sort((a, b) => (Number(a.data?.page) || 0) - (Number(b.data?.page) || 0))
      .forEach(page => {
        (page.data?.items || []).forEach(item => {
          const normalized = normalizeAjWillnerApiItem(item, loc);
          if (normalized?.id) byId.set(normalized.id, normalized);
        });
      });
    const items = Array.from(byId.values()).sort((a, b) => String(a.lot || '').localeCompare(String(b.lot || ''), undefined, {
      numeric: true,
      sensitivity: 'base'
    }));
    const expectedTotal = total || items.length || getAjWillnerExpectedTotal(root, findAjWillnerScrollContainer(root));
    const stopped = !!shouldStop();
    debug('AJ Willner API scrape finished', {
      count: items.length,
      expectedTotal,
      totalPages,
      stopped
    });
    return {
      source: 'ajwillner-api',
      items,
      lots: items,
      expectedTotal,
      stopped,
      incomplete: Boolean(!stopped && expectedTotal && items.length < expectedTotal),
      stopReason: stopped ? 'stopped by user' : 'api-complete',
      context: {
        source: 'ajwillner',
        pageKind: 'catalog',
        auctionId,
        url: loc?.href || '',
        generatedAt: new Date().toISOString()
      },
      pageSteps: totalPages
    };
  }

  async function scrapeAjWillnerListings(status = () => {}, shouldStop = () => false, root = document, loc = location) {
    debug('AJ Willner scrape start', routeDebug());
    const apiResult = await scrapeAjWillnerApiListings(status, shouldStop, root, loc).catch(error => {
      debug('AJ Willner API scrape failed; falling back to virtual list', { error: String(error?.message || error) });
      return null;
    });
    if (apiResult?.items?.length || apiResult?.expectedTotal === 0) return apiResult;

    const scrollContainer = findAjWillnerScrollContainer(root);
    const itemsMap = new Map();
    let expectedTotal = getAjWillnerExpectedTotal(root, scrollContainer);
    let lastCount = -1;
    let stuckAtBottomChecks = 0;
    let scrollSteps = 0;

    const collect = () => {
      extractAjWillnerVisibleListings(root, loc).forEach(item => {
        const key = item.url || item.id || item.lot;
        if (key && item.title) itemsMap.set(String(key), item);
      });
      expectedTotal = expectedTotal || getAjWillnerExpectedTotal(root, scrollContainer);
      return itemsMap.size;
    };

    collect();

    if (!scrollContainer) {
      const items = Array.from(itemsMap.values());
      debug('AJ Willner scrape no scroll container', { count: items.length, expectedTotal });
      return {
        source: 'ajwillner-visible-dom',
        items,
        lots: items,
        expectedTotal,
        stopped: !!shouldStop(),
        incomplete: Boolean(expectedTotal && items.length < expectedTotal),
        stopReason: 'no scroll container'
      };
    }

    const dispatchScroll = () => {
      if (!scrollContainer.dispatchEvent || typeof Event !== 'function') return;
      scrollContainer.dispatchEvent(new Event('scroll', { bubbles: true }));
    };

    scrollContainer.scrollTop = 0;
    dispatchScroll();
    await wait(700);

    for (let step = 0; step < 500; step += 1) {
      if (shouldStop()) break;
      const count = collect();
      status(expectedTotal ? `Loading AJ Willner lots... ${count}/${expectedTotal}` : `Loading AJ Willner lots... ${count}`);
      debug('AJ Willner scroll step', {
        step,
        count,
        expectedTotal,
        scrollTop: scrollContainer.scrollTop,
        scrollHeight: scrollContainer.scrollHeight,
        clientHeight: scrollContainer.clientHeight
      });

      if (expectedTotal && count >= expectedTotal) break;

      const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
      const currentTop = scrollContainer.scrollTop || 0;
      const atBottom = currentTop >= Math.max(0, maxScrollTop - 2);
      if (atBottom) {
        if (count === lastCount) stuckAtBottomChecks += 1;
        lastCount = count;
        if (stuckAtBottomChecks >= 3) break;
      } else {
        stuckAtBottomChecks = 0;
      }

      const stepSize = getAjWillnerScrollStepSize(scrollContainer);
      const nextTop = Math.min(maxScrollTop, currentTop + stepSize);
      if (nextTop === currentTop && stuckAtBottomChecks >= 2) break;

      scrollContainer.scrollTop = nextTop;
      dispatchScroll();
      scrollSteps += 1;
      await wait(190);
    }

    collect();
    const items = Array.from(itemsMap.values());
    const stopped = !!shouldStop();
    const incomplete = Boolean(expectedTotal && items.length < expectedTotal);
    const stopReason = stopped ? 'stopped by user' : (incomplete ? 'virtual list ended before expected total' : 'complete');
    debug('AJ Willner scrape finished', { count: items.length, expectedTotal, stopped, incomplete, stopReason, scrollSteps });
    return {
      source: 'ajwillner-virtual-list',
      items,
      lots: items,
      expectedTotal,
      stopped,
      incomplete,
      stopReason,
      scrollSteps
    };
  }

  async function scrapeCatalogLots(status = () => {}, shouldStop = () => false) {
    debug('catalog scrape start', routeDebug());

    if (isAjWillnerHost(typeof location !== 'undefined' ? location.hostname : '')) {
      return scrapeAjWillnerListings(status, shouldStop);
    }

    const activeRoute = resolveAssistantMode(typeof location !== 'undefined' ? location : undefined).route || {};
    const currentBidsRoute = isHibidCurrentBidsRoute(activeRoute);
    const accountExportRoute = isHibidAccountExportRoute(activeRoute);
    const visibleState = extractHibidVisiblePageState(document, typeof location !== 'undefined' ? location : null);
    if (visibleState.noMatches) {
      debug('catalog scrape stopped at visible no-match state', visibleState);
      return {
        source: 'visible-page-state',
        items: [],
        lots: [],
        expectedTotal: 0,
        stopped: false,
        incomplete: false,
        stopReason: 'visible-no-matches',
        visibleState
      };
    }

    if (!accountExportRoute) {
      const stateResult = await scrapeHibidStatePages(status, shouldStop).catch(err => {
        debug('catalog hibid-state scrape failed', { error: err.message });
        return null;
      });
      if (stateResult?.stopReason === 'visible-no-matches') return stateResult;
      if (stateResult?.items?.length) {
        debug('catalog scrape finished from hibid-state', {
          count: stateResult.items.length,
          expectedTotal: stateResult.expectedTotal,
          stopped: stateResult.stopped,
          incomplete: stateResult.incomplete,
          stopReason: stateResult.stopReason
        });
        if (isCatalogScrapeComplete(stateResult)) return stateResult;
        status(`HiBid page data incomplete (${stateResult.items.length}/${stateResult.expectedTotal || '?'}); trying visible-page fallback...`);
        debug('catalog hibid-state incomplete; falling back to DOM', {
          count: stateResult.items.length,
          expectedTotal: stateResult.expectedTotal,
          failedPage: stateResult.failedPage,
          stopReason: stateResult.stopReason
        });
      }
    } else {
      debug('catalog hibid-state skipped for account export route', activeRoute);
    }

    const itemsMap = new Map();
    const collect = () => {
      const visibleLots = accountExportRoute
        ? uniqueLots(getLotTiles().map(extractCurrentBidsLot))
        : uniqueLots(getLotTiles().map(extractLot));
      visibleLots.forEach(lot => {
        const key = accountExportRoute ? lot.lot : (lot.id || lot.url || lot.lot);
        if (key && lot.title) itemsMap.set(String(key), lot);
      });
      if (!accountExportRoute || !itemsMap.size) mergeCatalogLots(itemsMap, extractTextLots());
      return itemsMap.size;
    };

    const expectedTotal = accountExportRoute
      ? null
      : (visibleState.expectedTotal ?? getExpectedLotTotal());
    const loadResult = await loadLots(status, shouldStop, collect, { expectedTotal });
    collect();
    const items = Array.from(itemsMap.values());
    debug('catalog scrape finished from dom fallback', {
      count: items.length,
      expectedTotal,
      stopped: shouldStop(),
      currentBidsRoute,
      accountExportRoute,
      stopReason: loadResult?.stopReason || ''
    });
    return {
      source: currentBidsRoute ? 'hibid-currentbids-dom' : (accountExportRoute ? 'hibid-watchlist-dom' : 'dom-fallback'),
      items,
      lots: items,
      expectedTotal,
      stopped: !!shouldStop(),
      incomplete: accountExportRoute ? false : Boolean(expectedTotal && items.length < expectedTotal),
      stopReason: loadResult?.stopReason || '',
      visibleState
    };
  }

  function isHiBidHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return host === 'hibid.com' || host.endsWith('.hibid.com');
  }

  function pathSegments(loc = location) {
    return String(loc.pathname || '')
      .split('/')
      .map(segment => segment.trim())
      .filter(Boolean);
  }

  function productIdFromAuctionNinjaUrl(url) {
    const value = String(url || '');
    const stableId = value.match(/--([A-Za-z0-9-]+)\.html(?:[?#].*)?$/i);
    if (stableId) return stableId[1];
    const slugId = value.match(/-([A-Za-z0-9]+)\.html(?:[?#].*)?$/i);
    return slugId?.[1] || '';
  }

  function saleIdFromAuctionNinjaUrl(url) {
    const match = String(url || '').match(/--([A-Za-z0-9-]+)\.html(?:[?#].*)?$/i);
    return match?.[1] || '';
  }

  function canonicalAuctionNinjaSaleUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return '';
    try {
      const parsed = new URL(raw, 'https://www.auctionninja.com/');
      if (!isAuctionNinjaHost(parsed.hostname) || !/\/sales\/details\//i.test(parsed.pathname)) {
        return parsed.href;
      }
      parsed.search = '';
      parsed.hash = '';
      return parsed.href;
    } catch {
      return raw.replace(/[?#].*$/, '');
    }
  }

  function isAuctionNinjaHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return host === 'auctionninja.com' || host === 'www.auctionninja.com';
  }

  function resolveAuctionNinjaPage(loc = location) {
    const host = String(loc.hostname || '').toLowerCase();
    const parts = pathSegments(loc);
    const path = String(loc.pathname || '').toLowerCase();

    if (!isAuctionNinjaHost(host)) {
      return { supported: false, kind: 'unsupported', host, reason: 'unsupported host' };
    }

    if (/\/(?:account|dashboard|billing|payment|payments|payment-methods|cards?|checkout|invoice|invoices|profile|settings|support|logout|login|register)(?:\/|$)/i.test(path)) {
      return { supported: false, kind: 'blocked-account', host, reason: 'blocked account/payment route' };
    }

    if (parts[0] === 'followed-items') {
      return { supported: true, kind: 'followed-items', host, reason: 'followed items route' };
    }

    if (parts[0] === 'items-won') {
      return { supported: true, kind: 'items-won', host, reason: 'items won route' };
    }

    if (parts[0] === 'bid-history') {
      return { supported: true, kind: 'bid-history', host, reason: 'bid history route' };
    }

    if (parts[0] === 'auctions') {
      return { supported: true, kind: 'auction-search', host, reason: 'auction search route' };
    }

    if (parts[0] === 'category' && parts[1]) {
      const categorySlug = parts[1].toLowerCase();
      let categoryName = categorySlug
        .replace(/[-_]+/g, ' ')
        .replace(/\b([a-z])/g, letter => letter.toUpperCase());
      try {
        categoryName = decodeURIComponent(categoryName);
      } catch {
        // Keep the readable slug when a malformed URL segment is present.
      }
      return {
        supported: true,
        kind: 'category-search',
        host,
        categorySlug,
        categoryName,
        zip: String(loc.searchParams?.get?.('zip') || ''),
        miles: String(loc.searchParams?.get?.('miles') || ''),
        reason: 'category item search route'
      };
    }

    if (/^[a-z]{2}$/i.test(parts[0] || '') && parts[1] && /^\d{5}$/.test(parts[2] || '')) {
      return {
        supported: true,
        kind: 'auction-search',
        host,
        statePrefix: parts[0] || '',
        citySlug: parts[1] || '',
        zip: parts[2] || '',
        reason: 'location auction search route'
      };
    }

    if (parts[1] === 'sales' && parts[2] === 'details') {
      return {
        supported: true,
        kind: 'sale-catalog',
        host,
        sellerSlug: parts[0] || '',
        saleId: saleIdFromAuctionNinjaUrl(parts[3] || ''),
        reason: 'seller sale catalog route'
      };
    }

    if (parts[1] === 'product') {
      return {
        supported: true,
        kind: 'item-detail',
        host,
        sellerSlug: parts[0] || '',
        productId: productIdFromAuctionNinjaUrl(parts[2] || ''),
        reason: 'seller item detail route'
      };
    }

    return { supported: false, kind: 'unsupported', host, reason: 'unsupported AuctionNinja path' };
  }

  function isAarAuctionsHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return host === 'aarauctions.com' || host === 'www.aarauctions.com';
  }

  function getAarAuctionId(loc = location) {
    try {
      return new URL(loc.href || String(loc), 'https://aarauctions.com/').searchParams.get('auctionId') || '';
    } catch {
      return '';
    }
  }

  function resolveAarAuctionsPage(loc = location) {
    const host = String(loc.hostname || '').toLowerCase();
    const path = String(loc.pathname || '');
    const lowerPath = path.toLowerCase();
    if (!isAarAuctionsHost(host)) {
      return { supported: false, kind: 'unsupported', host, reason: 'unsupported host' };
    }

    if (/(?:login|logout|register|account|profile|payment|invoice|checkout|bid)(?:\.do)?(?:\/|$)/i.test(lowerPath)) {
      return { supported: false, kind: 'blocked-aar-mutation', host, reason: 'blocked AAR account/payment/bid route' };
    }

    if (/^\/auctions\/?$/i.test(path)) {
      return { supported: true, kind: 'aar-auction-list', host, reason: 'AAR auction calendar route' };
    }

    if (/^\/servlet\/Search\.do$/i.test(path) && getAarAuctionId(loc)) {
      return {
        supported: true,
        kind: 'aar-auction-catalog',
        host,
        auctionId: getAarAuctionId(loc),
        reason: 'AAR auction catalog route'
      };
    }

    return { supported: false, kind: 'unsupported', host, reason: 'unsupported AAR Auctions path' };
  }

  function isGovDealsHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return host === 'govdeals.com' || host === 'www.govdeals.com';
  }

  function getGovDealsAssetParts(loc = location) {
    const parts = pathSegments(loc);
    const assetIndex = parts.findIndex(part => part.toLowerCase() === 'asset');
    if (assetIndex < 0) return { assetId: '', accountId: '' };
    return {
      assetId: parts[assetIndex + 1] || '',
      accountId: parts[assetIndex + 2] || ''
    };
  }

  function govDealsSearchParams(loc = location) {
    if (loc?.searchParams?.get) return loc.searchParams;
    try {
      return new URL(String(loc?.href || loc || ''), 'https://www.govdeals.com/').searchParams;
    } catch {
      return new URLSearchParams('');
    }
  }

  function resolveGovDealsPage(loc = location) {
    const host = String(loc.hostname || '').toLowerCase();
    const parts = pathSegments(loc);
    const path = String(loc.pathname || '').toLowerCase();
    if (!isGovDealsHost(host)) {
      return { supported: false, kind: 'unsupported', host, reason: 'unsupported host' };
    }

    if (/\/(?:login|logout|register|registration|account|profile|settings|cart|checkout|payment|invoice|bid|offer)(?:\/|$)/i.test(path)) {
      return { supported: false, kind: 'blocked-govdeals-mutation', host, reason: 'blocked GovDeals account/payment/bid route' };
    }

    const asset = getGovDealsAssetParts(loc);
    if (asset.assetId && asset.accountId) {
      return {
        supported: true,
        kind: 'govdeals-asset',
        host,
        assetId: asset.assetId,
        accountId: asset.accountId,
        reason: 'GovDeals asset route'
      };
    }

    if (parts[0] === 'en'
      && ((parts[1] === 'new-listings' && parts[2] === 'filters')
        || (parts[1] === 'search' && (parts.length === 2 || parts[2] === 'filters')))) {
      const params = govDealsSearchParams(loc);
      return {
        supported: true,
        kind: 'govdeals-new-listings',
        host,
        zipcode: String(params.get('zipcode') || ''),
        miles: String(params.get('miles') || ''),
        category: String(params.get('category') || ''),
        categoryName: String(params.get('categoryName') || ''),
        reason: parts[1] === 'search' ? 'GovDeals search route' : 'GovDeals new listings route'
      };
    }

    if (parts[0] === 'en' && parts[1] && parts.length === 2 && !/^(?:asset|new-listings|advanced-search|location-search|search|categories?)$/i.test(parts[1])) {
      return {
        supported: true,
        kind: 'govdeals-seller',
        host,
        sellerSlug: parts[1],
        reason: 'GovDeals seller route'
      };
    }

    return { supported: false, kind: 'unsupported', host, reason: 'unsupported GovDeals path' };
  }

  function defaultAarResearchSettings() {
    return { originLabel: 'Edison, NJ 08817', radiusMiles: 100 };
  }

  function getAarResearchSettings() {
    const defaults = defaultAarResearchSettings();
    try {
      const stored = GM_getValue(AAR_RESEARCH_SETTINGS_KEY, null);
      const parsed = typeof stored === 'string' ? JSON.parse(stored) : stored;
      const radius = Number(parsed?.radiusMiles);
      return {
        originLabel: String(parsed?.originLabel || defaults.originLabel).trim() || defaults.originLabel,
        radiusMiles: Number.isFinite(radius) && radius > 0 ? radius : defaults.radiusMiles
      };
    } catch {
      return defaults;
    }
  }

  function saveAarResearchSettings(settings = {}) {
    const defaults = defaultAarResearchSettings();
    const radius = Number(settings.radiusMiles);
    const next = {
      originLabel: String(settings.originLabel || defaults.originLabel).trim() || defaults.originLabel,
      radiusMiles: Number.isFinite(radius) && radius > 0 ? radius : defaults.radiusMiles
    };
    try {
      GM_setValue(AAR_RESEARCH_SETTINGS_KEY, next);
    } catch {
      // Tampermonkey storage may be unavailable in tests.
    }
    return next;
  }

  function normalizeAuctionNinjaTitle(value) {
    return String(value || '')
      .replace(/\bBid Now\b/gi, '')
      .replace(/\bLot\s*#\s*:?\s*[A-Za-z0-9.-]+\b/gi, '')
      .replace(/\b(?:Current Bid|Starting Bid|High Bid|Price Realized|Your Max Bid)\b\s*:?\s*\$?\d[\d,]*(?:\.\d{2})?/gi, '')
      .replace(/\b(?:\d+\s+(?:days?|hours?|minutes?|seconds?)\s*){1,4}left\b/gi, '')
      .replace(/\b(?:HIGH BIDDER|Following|Watched|Watching|Outbid|Winning|Won|Bidding Closed)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function parseAuctionNinjaCatalogRange(value) {
    const match = String(value || '').match(/(\d+)\s*-\s*(\d+)\s+of\s+(\d+)\s+items?/i);
    if (!match) return null;
    const start = Number(match[1]);
    const end = Number(match[2]);
    const total = Number(match[3]);
    if (![start, end, total].every(Number.isFinite)) return null;
    return {
      start,
      end,
      total,
      pageSize: Math.max(0, end - start + 1),
      complete: end >= total
    };
  }

  function parseAuctionNinjaBidText(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    const labeled = text.match(/\b(Current Bid|High Bid|Minimum Bid|Starting Bid|Lot Won)\b\s*:?\s*(\$[\d,]+(?:\.\d{2})?)/i);
    if (labeled) return { label: `${labeled[1]}: ${labeled[2]}`, amount: moneyFromText(labeled[2]) };
    const money = moneyLabelFromText(text);
    return money ? { label: `Current Bid: ${money}`, amount: moneyFromText(money) } : { label: '', amount: null };
  }

  function extractAuctionNinjaSaleContext(root = document, loc = (typeof location !== 'undefined' ? location : null)) {
    const raw = rawTextOf(root?.body || root?.documentElement || root);
    const flat = raw.replace(/\s+/g, ' ').trim();
    const route = loc ? resolveAuctionNinjaPage(loc) : null;
    const title = pickFirstText(root, ['h1', '.auction-title', '.sale-title'])
      || String(root?.title || '').replace(/\s*\|\s*AuctionNinja.*$/i, '').trim()
      || flat.match(/AuctionNinja\s*\/\s*[^/]+\s*\/\s*(.+?)\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),/i)?.[1]?.trim()
      || '';
    const canonical = pickFirstHref(root, ['link[rel="canonical"]'], loc?.href);
    const lines = raw.split(/\n+/).map(line => line.trim()).filter(Boolean);
    const locationText = lineAfter(raw, 'Auction Location:') || flat.match(/Auction Location:\s*([^|]+?)\s+(?:Clearing|Shipping|Pickup|View Seller)/i)?.[1]?.trim() || '';
    const locIndex = lines.findIndex(line => /^Auction Location:?$/i.test(line));
    const sellerIndex = lines.findIndex(line => /^View Seller$/i.test(line));
    const seller = locIndex >= 0 && lines[locIndex + 2]
      ? lines[locIndex + 2]
      : (sellerIndex > 0 ? lines[sellerIndex - 1] : '');
    const shipping = flat.match(/\b(Shipping Available|Shipping Only|Local Pickup Only|Local Pick Up|Local Pickup \+ Limited Shipping|Local Pickup \+ Shipping Available|Referred Shipping(?: AND Delivery)? Available)\b/i)?.[1] || '';
    const pickupWindow = lineAfter(raw, 'When to Pickup') || flat.match(/When to Pickup\s+(.+?)(?:About the Sale|Special Instructions|Auction Manager|Buyer'?s Premium|Item Catalog)/i)?.[1]?.trim() || '';
    const specialInstructions = sectionBetween(raw, 'Special Instructions', "Auction Manager|Buyer'?s Premium|Item Catalog|$");
    const about = sectionBetween(raw, 'About the Sale', "Special Instructions|Auction Manager|Buyer'?s Premium|Item Catalog|$");
    const premium = flat.match(/Buyer'?s Premium\s*(?:Bidding increment chart)?\s*(\d+(?:\.\d+)?)\s*%/i)?.[1] || '';
    const closingTime = flat.match(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+[A-Za-z]+\s+\d{1,2},\s+\d{4}\s+at\s+.*?(?:EDT|EST|CDT|CST|PDT|PST|MDT|MST)\b/i)?.[0] || '';

    return {
      source: 'AuctionNinja',
      title,
      url: canonical || loc?.href || '',
      route,
      seller,
      location: locationText,
      buyerPremium: premium ? `${premium}%` : percentFromText(flat.match(/Buyer'?s Premium[\s\S]{0,80}/i)?.[0] || ''),
      pickupWindow,
      shipping,
      specialInstructions,
      about,
      closingTime
    };
  }

  function getAuctionNinjaCatalogCards(root = document) {
    const selectors = [
      '.search-catalog-item-box',
      '.search-catalog-item-box-in',
      '[id^="MainItmID"]',
      '.hot-items-box',
      '.item-box'
    ];
    const cards = [];
    selectors.forEach(selector => {
      Array.from(root?.querySelectorAll?.(selector) || []).forEach(card => {
        if (!cards.includes(card) && /Lot\s*#|Current Bid|Bid Now|LOT WON/i.test(textOf(card))) cards.push(card);
      });
    });
    return cards;
  }

  function extractAuctionNinjaCatalogLots(root = document, loc = (typeof location !== 'undefined' ? location : null)) {
    const base = loc?.href || (typeof location !== 'undefined' ? location.href : 'https://www.auctionninja.com/');
    const lots = [];
    const seen = new Set();

    getAuctionNinjaCatalogCards(root).forEach(card => {
      const raw = textOf(card);
      const lot = raw.match(/Lot\s*#\s*:?\s*([A-Za-z0-9.-]+)/i)?.[1] || '';
      const link = card.querySelector?.('a[href*="/product/"]') || card.querySelector?.('a[href]');
      const url = absoluteUrl(controlHref(link), base);
      const title = normalizeAuctionNinjaTitle(textOf(link) || raw.match(/left\s+(.+?)\s+Lot\s*#/i)?.[1] || raw.match(/\$\d[\d,.]*\s+(.+?)\s+Lot\s*#/i)?.[1] || '');
      const image = pickFirstImage(card, base);
      const bid = parseAuctionNinjaBidText(raw);
      const timeLeft = raw.match(/((?:\d+\s+)?(?:days?|hours?|minutes?|seconds?)(?:\s+\d+\s+(?:days?|hours?|minutes?|seconds?))*\s+left)/i)?.[1] || '';
      const status = /\bclosed\b/i.test(raw) ? 'CLOSED' : '';
      const watched = /\bfollowing\b|\bwatched\b|\bunfollow\b/i.test(raw);
      const description = pickFirstDescription(card)
        || raw.match(/(?:Description|Features and Notes|Auctioneer'?s Note)\s*:?\s*([\s\S]*?)(?=\s+(?:Current Bid|High Bid|Minimum Bid|Starting Bid|Lot Won|\d+\s+Bids?\b|$))/i)?.[1]?.trim()
        || '';
      const id = productIdFromAuctionNinjaUrl(url);
      const key = url || id || lot || title;
      if (!key || seen.has(key) || !title) return;
      seen.add(key);

      const out = {
        source: 'AuctionNinja',
        id,
        lot,
        title,
        url,
        image,
        highBid: bid.label,
        highBidAmount: bid.amount,
        currentPrice: bid.amount,
        currentBid: bid.amount,
        timeLeft,
        status,
        description,
        watched
      };
      const bidCount = raw.match(/(?:^|[^#:])\b(\d+)\s+Bids?\b(?!\s*Now)/i);
      if (bidCount) {
        out.bidCount = bidCount[0];
        out.bidCountNumber = Number(bidCount[1]);
      }
      lots.push(out);
    });

    return lots.sort((a, b) => String(a.lot || a.title).localeCompare(String(b.lot || b.title), undefined, {
      numeric: true,
      sensitivity: 'base'
    }));
  }

  function getAuctionNinjaAccountCards(root = document) {
    const selectors = [
      'a[href*="/product/"]',
      '.account-item-card',
      '.dashboard-item',
      '.followed-item',
      '.favorite-item',
      '.watchlist-item',
      '.item-won',
      '.won-item',
      '.bid-item',
      '.my-account-item',
      '[class*="followed"][class*="item"]',
      '[class*="favorite"][class*="item"]',
      '[class*="watch"][class*="item"]',
      '[class*="won"][class*="item"]',
      '[class*="account"][class*="item"]',
      '[class*="product"][class*="box"]',
      '[class*="item"][class*="box"]',
      'article',
      'li',
      'tr'
    ];
    const cards = [];
    const seen = new Set();
    selectors.forEach(selector => {
      Array.from(root?.querySelectorAll?.(selector) || []).forEach(seed => {
        const card = findAuctionNinjaAccountCardFromSeed(seed);
        if (!card || seen.has(card)) return;
        const raw = textOf(card);
        const hasProductLink = Boolean(card.querySelector?.('a[href*="/product/"]'));
        const looksLikeAccountItem = hasProductLink && /Lot\s*#|Current Bid|Starting Bid|Price Realized|Won|Following|Watched|Outbid|Bidding Closed|Your Max Bid/i.test(raw);
        const looksLikeShellOnly = /Dashboard|Invoices|Payment|Settings|Logout/i.test(raw) && !/Lot\s*#|Current Bid|Starting Bid|Price Realized/i.test(raw);
        if (!raw || !looksLikeAccountItem || looksLikeShellOnly) return;
        seen.add(card);
        cards.push(card);
      });
    });
    return cards;
  }

  function findAuctionNinjaAccountCardFromSeed(seed) {
    if (!seed) return null;
    let best = null;
    let bestScore = -Infinity;
    let el = seed;
    for (let depth = 0; el && depth < 9; depth += 1, el = el.parentElement) {
      const raw = textOf(el);
      const productLinks = Array.from(el.querySelectorAll?.('a[href*="/product/"]') || []);
      if (!productLinks.length) continue;
      let score = 0;
      if (productLinks.length === 1) score += 30;
      else score -= productLinks.length * 15;
      if (/\bLot\s*#/i.test(raw)) score += 45;
      if (/\b(?:Current Bid|Starting Bid|High Bid|Price Realized|Your Max Bid)\b/i.test(raw)) score += 45;
      if (/\b(?:Won|Following|Watched|Outbid|High Bidder|Bidding Closed)\b/i.test(raw)) score += 20;
      if (parseAuctionNinjaAccountTimeText(raw)) score += 10;
      if (/\b(?:Dashboard|Invoices|Account|Support|Logout|Saved Searches)\b/i.test(raw)) score -= 60;
      if (raw.length > 2500) score -= 80;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return bestScore > 35 ? best : null;
  }

  function formatAuctionNinjaAccountMoneyLabel(label, value) {
    const cleanLabel = String(label || '').replace(/\s+/g, ' ').trim();
    const raw = String(value || '').replace(/\s+/g, ' ').trim();
    if (!cleanLabel || !raw) return '';
    const amount = raw.startsWith('$') || /\bUSD\b/i.test(raw) ? raw : `$${raw}`;
    return `${cleanLabel}: ${amount}`;
  }

  function parseAuctionNinjaAccountPriceText(raw, kind) {
    const text = String(raw || '').replace(/\s+/g, ' ').trim();
    const labels = kind === 'items-won'
      ? ['Price Realized', 'Lot Won', 'Won For', 'Sold For', 'Current Bid', 'High Bid']
      : ['Current Bid', 'High Bid', 'Price Realized', 'Sold For', 'Starting Bid'];
    for (const label of labels) {
      const pattern = new RegExp(`\\b${label}\\b\\s*:?\\s*(\\$?\\d[\\d,]*(?:\\.\\d{2})?(?:\\s*USD)?)`, 'i');
      const match = text.match(pattern);
      if (match) return formatAuctionNinjaAccountMoneyLabel(label, match[1]);
    }
    const money = moneyLabelFromText(text);
    if (!money) return '';
    return formatAuctionNinjaAccountMoneyLabel(kind === 'items-won' ? 'Price Realized' : 'Current Bid', money);
  }

  function parseAuctionNinjaYourBidText(raw) {
    const text = String(raw || '').replace(/\s+/g, ' ').trim();
    const match = text.match(/\b(Your\s+(?:Max\s+)?Bid|My\s+Bid|Bid\s+Amount)\b\s*:?\s*(\$?\d[\d,]*(?:\.\d{2})?(?:\s*USD)?)/i);
    return match ? formatAuctionNinjaAccountMoneyLabel(match[1], match[2]) : '';
  }

  function parseAuctionNinjaAccountStatus(raw, kind) {
    const text = String(raw || '');
    if (kind === 'items-won') {
      if (/\bWon\b/i.test(text)) return 'Won';
      if (/Price\s+Realized|Sold/i.test(text)) return 'Sold';
    }
    if (/\bFollowing\b/i.test(text)) return 'Following';
    if (/\bWatched\b|\bWatching\b/i.test(text)) return 'Watching';
    if (/\bOutbid\b/i.test(text)) return 'Outbid';
    if (/\bWinning\b/i.test(text)) return 'Winning';
    if (/Bidding\s+Closed/i.test(text)) return 'Bidding Closed';
    return '';
  }

  function parseAuctionNinjaAccountTimeText(raw) {
    const text = String(raw || '').replace(/\s+/g, ' ').trim();
    return text.match(/\b(?:\d+\s+(?:days?|hours?|minutes?|seconds?)\s*){1,4}left\b/i)?.[0]
      || text.match(/\b\d+\s+days?\s+\d+\s+hours?\s+left\b/i)?.[0]
      || text.match(/\b\d+\s+(?:days?|hours?|minutes?|seconds?)\s+left\b/i)?.[0]
      || text.match(/(?:^|\s)(\d{1,3}\s*(?:d|h|m|s))\b/i)?.[1]
      || text.match(/\bBidding\s+Closed\b/i)?.[0]
      || '';
  }

  function parseAuctionNinjaLocationText(raw) {
    const text = String(raw || '')
      .replace(/\b(?:Shipping Available|Shipping Not Available|Shipping Only|Local Pickup Only|Local Pick Up|Pickup Only|Referred Shipping(?: AND Delivery)? Available)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.match(/\b[A-Z][A-Za-z .'-]+,\s+[A-Z]{2}\b/)?.[0] || '';
  }

  function parseAuctionNinjaShippingText(raw) {
    const text = String(raw || '').replace(/\s+/g, ' ').trim();
    return text.match(/\b(?:Shipping Available|Shipping Not Available|Shipping Only|Local Pickup Only|Local Pick Up|Pickup Only|Referred Shipping(?: AND Delivery)? Available)\b/i)?.[0] || '';
  }

  function parseAuctionNinjaPickupText(raw) {
    const text = String(raw || '').replace(/\s+/g, ' ').trim();
    return text.match(/\bPickup\s*:\s*.+?(?=\s+(?:Shipping|Location|Seller|Sale|Won|Following|Watched|Outbid|Current Bid|Price Realized)\b|$)/i)?.[0]?.trim() || '';
  }

  function titleFromAuctionNinjaProductUrl(url) {
    const filename = String(url || '').split('/').pop() || '';
    const slug = filename
      .replace(/\.html(?:[?#].*)?$/i, '')
      .replace(/--[A-Za-z0-9-]+$/i, '')
      .replace(/-\d+$/i, '')
      .replace(/-/g, ' ')
      .trim();
    if (!slug) return '';
    return normalizeAuctionNinjaTitle(slug.replace(/\b([a-z])/g, letter => letter.toUpperCase()));
  }

  function cleanupAuctionNinjaAccountLeadText(value) {
    return String(value || '')
      .replace(/if\s*\([^{}]*\)\s*\{[^{}]*\}/gi, ' ')
      .replace(/\b(?:Current Bid|Starting Bid|High Bid|Price Realized)\b\s*:?\s*\$?\d[\d,]*(?:\.\d{2})?/gi, ' ')
      .replace(/\bYour Max Bid\b\s*:?\s*\$?\d[\d,]*(?:\.\d{2})?/gi, ' ')
      .replace(/\b(?:\d+\s+(?:days?|hours?|minutes?|seconds?)\s*){1,4}left\b/gi, ' ')
      .replace(/(?:^|\s)\d{1,3}\s*(?:d|h|m|s)\b/gi, ' ')
      .replace(/\b(?:HIGH BIDDER|Following|Watched|Watching|Outbid|Winning|Won|Bidding Closed)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function inferAuctionNinjaAccountTitle(raw, linkText = '', saleTitle = '', url = '') {
    const linked = normalizeAuctionNinjaTitle(linkText);
    if (linked) return linked;
    const text = String(raw || '').replace(/\s+/g, ' ').trim();
    const beforeLot = cleanupAuctionNinjaAccountLeadText(text.split(/\bLot\s*#/i)[0] || '');
    const normalizedSaleTitle = normalizeAuctionNinjaTitle(saleTitle);
    let fromCard = beforeLot;
    if (normalizedSaleTitle) {
      const saleIndex = fromCard.toLowerCase().indexOf(normalizedSaleTitle.toLowerCase());
      if (saleIndex >= 0) fromCard = fromCard.slice(0, saleIndex).trim();
    }
    const inferred = normalizeAuctionNinjaTitle(
      fromCard
      || text.match(/Lot\s*#\s*:?\s*[A-Za-z0-9.-]+\s+(.+?)\s+(?:Current Bid|High Bid|Price Realized|Won|Following|Watched|Outbid|Shipping|Pickup|$)/i)?.[1]
      || text.match(/(?:Current Bid|Price Realized)\s*\$?\d[\d,.]*\s+(.+?)\s+Lot\s*#/i)?.[1]
      || ''
    );
    return inferred || titleFromAuctionNinjaProductUrl(url);
  }

  function extractAuctionNinjaAccountItems(root = document, loc = (typeof location !== 'undefined' ? location : null), kind = 'followed-items') {
    const base = loc?.href || (typeof location !== 'undefined' ? location.href : 'https://www.auctionninja.com/');
    const items = [];
    const seen = new Set();

    getAuctionNinjaAccountCards(root).forEach(card => {
      const rawText = textOf(card);
      const itemLink = card.querySelector?.('a[href*="/product/"]');
      const saleLink = card.querySelector?.('a[href*="/sales/details/"]');
      const url = absoluteUrl(controlHref(itemLink), base);
      const saleUrl = absoluteUrl(controlHref(saleLink), base);
      const saleTitle = normalizeAuctionNinjaTitle(textOf(saleLink));
      const title = inferAuctionNinjaAccountTitle(rawText, textOf(itemLink), saleTitle, url);
      const lot = rawText.match(/\bLot\s*#\s*:?\s*([A-Za-z0-9.-]+)/i)?.[1] || '';
      const id = productIdFromAuctionNinjaUrl(url);
      const key = url || id || `${lot}:${title}`;
      if (!key || seen.has(key) || (!title && !url)) return;
      seen.add(key);

      const priceText = parseAuctionNinjaAccountPriceText(rawText, kind);
      const bidCountMatch = rawText.match(/(?:^|[^#:])\b(\d+)\s+Bids?\b(?!\s*Now)/i);
      const item = {
        source: 'AuctionNinja',
        pageKind: kind,
        id,
        lot,
        title,
        url,
        image: pickFirstImage(card, base),
        saleTitle,
        saleUrl,
        seller: '',
        status: parseAuctionNinjaAccountStatus(rawText, kind),
        priceText,
        price: moneyFromText(priceText),
        bidCount: bidCountMatch ? Number(bidCountMatch[1].replace(/,/g, '')) : null,
        timeText: parseAuctionNinjaAccountTimeText(rawText),
        location: parseAuctionNinjaLocationText(rawText),
        shippingText: parseAuctionNinjaShippingText(rawText),
        pickupText: parseAuctionNinjaPickupText(rawText),
        rawText
      };
      if (kind === 'bid-history') {
        item.yourBidText = parseAuctionNinjaYourBidText(rawText);
        item.yourBid = moneyFromText(item.yourBidText);
      }
      items.push(item);
    });

    return items;
  }

  function extractAuctionNinjaFollowedItems(root = document, loc = (typeof location !== 'undefined' ? location : null)) {
    return extractAuctionNinjaAccountItems(root, loc, 'followed-items');
  }

  function extractAuctionNinjaWonItems(root = document, loc = (typeof location !== 'undefined' ? location : null)) {
    return extractAuctionNinjaAccountItems(root, loc, 'items-won');
  }

  function extractAuctionNinjaBidHistoryItems(root = document, loc = (typeof location !== 'undefined' ? location : null)) {
    return extractAuctionNinjaAccountItems(root, loc, 'bid-history');
  }

  function saleIdFromAuctionNinjaSaleUrl(url) {
    const value = String(url || '');
    const stableId = value.match(/--([A-Za-z0-9-]+)\.html(?:[?#].*)?$/i);
    if (stableId) return stableId[1];
    const slugId = value.match(/-([A-Za-z0-9]+)\.html(?:[?#].*)?$/i);
    return slugId?.[1] || '';
  }

  function normalizeAuctionNinjaSearchLocation(raw) {
    const text = String(raw || '')
      .replace(/\b(?:Shipping Available|Shipping Not Available|Shipping Only|Local Pickup Only|Local Pick Up|Pickup Only|Local Pickup \+ Limited Shipping|Local Pickup \+ Shipping Available|Referred Shipping(?: AND Delivery)? Available)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return text.match(/\b[A-Z][A-Za-z .'-]+,\s+[A-Z]{2}\b/)?.[0] || '';
  }

  function parseAuctionNinjaAuctionClosingText(raw) {
    const text = String(raw || '').replace(/\s+/g, ' ').trim();
    return text.match(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+[A-Za-z]+\s+\d{1,2}\s+\d{4}\s+@\s+\d{1,2}:\d{2}\s+[AP]M\s+(?:EDT|EST|CDT|CST|PDT|PST|MDT|MST)\b/i)?.[0]
      || text.match(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+[A-Za-z]+\s+\d{1,2},\s+\d{4}\s+(?:at|@)\s+.*?(?:EDT|EST|CDT|CST|PDT|PST|MDT|MST)\b/i)?.[0]
      || lineAfter(raw, 'Begins to close')
      || '';
  }

  function parseAuctionNinjaAuctionSearchTotal(raw) {
    const text = String(raw || '').replace(/\s+/g, ' ').trim();
    const match = text.match(/\b(\d{1,5})\s+(?:sales?|auctions?)\b/i)
      || text.match(/\b(?:Total|Found)\s*:?\s*(\d{1,5})\b/i);
    return match ? Number(match[1].replace(/,/g, '')) : null;
  }

  function isAuctionNinjaSearchNonTitleLabel(value) {
    const label = normalizeAuctionNinjaTitle(value);
    if (!label) return true;
    return /^\(?\s*\d{1,6}\s*\)?$/.test(label)
      || /^\d{1,6}\s+Lots?$/i.test(label)
      || /^(?:View|View Auction|Details|Bid Now|AuctionNinja)$/i.test(label);
  }

  function cleanAuctionNinjaSearchTitleCandidate(value) {
    return normalizeAuctionNinjaTitle(value)
      .replace(/\s+\(\s*\d{1,6}\s*\)\s*$/g, '')
      .replace(/\s+\d{1,6}\s+Lots?\s*$/gi, '')
      .trim();
  }

  function isAuctionNinjaSearchMetadataLine(value) {
    const line = normalizeAuctionNinjaTitle(value);
    if (isAuctionNinjaSearchNonTitleLabel(line)) return true;
    if (/^(?:Begins to close|Ends|Local Pickup|Local Pick Up|Pickup Only|Shipping|Preview|Sale closed|Closed)\b/i.test(line)) return true;
    if (/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+/i.test(line)) return true;
    if (normalizeAuctionNinjaSearchLocation(line)) return true;
    if (parseAuctionNinjaShippingText(line)) return true;
    return false;
  }

  function extractAuctionNinjaAuctionSearchTitle(card, saleLink, url) {
    const linkTitle = cleanAuctionNinjaSearchTitleCandidate(textOf(saleLink));
    if (!isAuctionNinjaSearchNonTitleLabel(linkTitle)) return linkTitle;

    const lines = rawTextOf(card)
      .split(/\n+/)
      .map(cleanAuctionNinjaSearchTitleCandidate)
      .filter(Boolean);
    const lineTitle = lines.find(line => !isAuctionNinjaSearchMetadataLine(line));
    if (lineTitle) return lineTitle;

    const flatLead = cleanAuctionNinjaSearchTitleCandidate(
      textOf(card).split(/\b(?:Begins to close|Local Pickup|Local Pick Up|Shipping|Pickup Only)\b/i)[0]
    );
    if (!isAuctionNinjaSearchNonTitleLabel(flatLead)) return flatLead;
    return titleFromAuctionNinjaProductUrl(url);
  }

  function findAuctionNinjaAuctionSearchCardFromSeed(seed) {
    if (!seed) return null;
    let best = null;
    let bestScore = -Infinity;
    let el = seed;
    for (let depth = 0; el && depth < 9; depth += 1, el = el.parentElement) {
      const raw = textOf(el);
      const saleLinks = Array.from(el.querySelectorAll?.('a[href*="/sales/details/"]') || []);
      const uniqueSaleHrefs = new Set(saleLinks.map(link => controlHref(link)).filter(Boolean));
      if (!uniqueSaleHrefs.size) continue;
      let score = 0;
      if (uniqueSaleHrefs.size === 1) score += 35;
      else score -= uniqueSaleHrefs.size * 14;
      if (/Begins\s+to\s+close/i.test(raw)) score += 40;
      if (normalizeAuctionNinjaSearchLocation(raw)) score += 20;
      if (parseAuctionNinjaShippingText(raw)) score += 15;
      if (/\b\d+\s+Lots?\b/i.test(raw) || /\(\s*\d+\s*\)/.test(raw)) score += 8;
      if (/Find a Seller|Top Auction Locations|Bidder Login|Seller Login/i.test(raw)) score -= 90;
      if (raw.length > 2200) score -= 70;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return bestScore > 30 ? best : null;
  }

  function findBestAuctionNinjaSaleLink(card) {
    const links = Array.from(card?.querySelectorAll?.('a[href*="/sales/details/"]') || []);
    const candidates = links.map(link => {
      const label = normalizeAuctionNinjaTitle(textOf(link));
      let score = 0;
      if (label) score += 20;
      if (label.length >= 18) score += 30;
      if (/\b(?:sale|auction|estate|collection|jewelry|vintage|antiques?|decor|furniture|collectibles?)\b/i.test(label)) score += 18;
      if (isAuctionNinjaSearchNonTitleLabel(label)) score -= 80;
      if (/bid now|view|details/i.test(label)) score -= 25;
      return { link, label, score };
    }).sort((a, b) => b.score - a.score);
    return candidates[0]?.score > -20 ? candidates[0].link : (links[0] || null);
  }

  function getAuctionNinjaAuctionSearchCards(root = document) {
    const selectors = [
      '.auction-item',
      '.auction-box',
      '.auction-list-item',
      '.sale-item',
      '.sales-item',
      '[class*="auction"][class*="item"]',
      '[class*="sale"][class*="item"]',
      'article',
      'li',
      'a[href*="/sales/details/"]'
    ];
    const cards = [];
    const seen = new Set();
    selectors.forEach(selector => {
      Array.from(root?.querySelectorAll?.(selector) || []).forEach(seed => {
        const card = findAuctionNinjaAuctionSearchCardFromSeed(seed);
        if (!card || seen.has(card)) return;
        const raw = textOf(card);
        const hasSaleLink = Boolean(card.querySelector?.('a[href*="/sales/details/"]')) || /\/sales\/details\//i.test(controlHref(card));
        if (!raw || !hasSaleLink || /Find a Seller|Top Auction Locations|Bidder Login|Seller Login/i.test(raw)) return;
        seen.add(card);
        cards.push(card);
      });
    });
    return cards;
  }

  function extractAuctionNinjaAuctionSearchContext(root = document, loc = (typeof location !== 'undefined' ? location : null)) {
    const raw = textOf(root?.body || root?.documentElement || root);
    const route = loc ? resolveAuctionNinjaPage(loc) : {};
    const city = route?.citySlug ? route.citySlug.replace(/-/g, ' ').replace(/\b([a-z])/g, letter => letter.toUpperCase()) : '';
    const zip = route?.zip || '';
    const searchLocation = [city, route?.statePrefix ? String(route.statePrefix).toUpperCase() : '', zip].filter(Boolean).join(' ').trim();
    return {
      source: 'AuctionNinja',
      pageKind: 'auction-search',
      title: String(root?.title || '').replace(/\s*\|\s*AuctionNinja.*$/i, '').trim() || (searchLocation ? `Auction search near ${searchLocation}` : 'AuctionNinja Auction Search'),
      url: loc?.href || (typeof location !== 'undefined' ? location.href : ''),
      searchLocation,
      miles: loc?.searchParams?.get?.('miles') || '',
      totalSales: parseAuctionNinjaAuctionSearchTotal(raw),
      generatedAt: new Date().toISOString()
    };
  }

  function extractAuctionNinjaAuctionSearchSales(root = document, loc = (typeof location !== 'undefined' ? location : null)) {
    const base = loc?.href || (typeof location !== 'undefined' ? location.href : 'https://www.auctionninja.com/');
    const sales = [];
    const seen = new Set();

    getAuctionNinjaAuctionSearchCards(root).forEach(card => {
      const rawText = textOf(card);
      const saleLink = findBestAuctionNinjaSaleLink(card) || card.querySelector?.('a[href*="/sales/details/"]') || (/\/sales\/details\//i.test(controlHref(card)) ? card : null);
      const url = canonicalAuctionNinjaSaleUrl(absoluteUrl(controlHref(saleLink), base));
      const title = extractAuctionNinjaAuctionSearchTitle(card, saleLink, url);
      const sellerLink = card.querySelector?.('a[href]:not([href*="/sales/details/"])');
      const sellerUrl = absoluteUrl(controlHref(sellerLink), base);
      const seller = normalizeAuctionNinjaTitle(textOf(sellerLink));
      const key = canonicalAuctionNinjaSaleUrl(url) || `${title}:${rawText.slice(0, 80)}`;
      if (!key || seen.has(key) || !title) return;
      seen.add(key);
      const itemCountMatch = rawText.match(/\b(\d{1,6})\s+Lots?\b/i);
      sales.push({
        source: 'AuctionNinja',
        pageKind: 'auction-search',
        id: saleIdFromAuctionNinjaSaleUrl(url),
        title,
        url,
        image: pickFirstImage(card, base),
        seller,
        sellerUrl,
        location: normalizeAuctionNinjaSearchLocation(rawText.replace(title, ' ')),
        shippingText: parseAuctionNinjaShippingText(rawText),
        closingText: parseAuctionNinjaAuctionClosingText(rawText),
        itemCount: itemCountMatch ? Number(itemCountMatch[1].replace(/,/g, '')) : null,
        rawText
      });
    });

    return sales;
  }

  function parseAuctionNinjaCategoryResultCount(value) {
    const match = String(value || '').match(/\b([\d,]+)\s+results?\b/i);
    if (!match) return null;
    const total = Number(match[1].replace(/,/g, ''));
    return Number.isFinite(total) ? total : null;
  }

  function getAuctionNinjaCategoryCards(root = document) {
    const selectors = [
      '.hot-items-box',
      '[id^="MainItmID_"]',
      '.hot-items-box-in'
    ];
    const cards = [];
    const seen = new Set();
    selectors.forEach(selector => {
      Array.from(root?.querySelectorAll?.(selector) || []).forEach(seed => {
        const card = seed.matches?.('.hot-items-box, [id^="MainItmID_"]')
          ? seed
          : (seed.closest?.('.hot-items-box, [id^="MainItmID_"]') || seed);
        const productLink = card.querySelector?.('a[href*="/product/"]');
        const raw = textOf(card);
        if (!productLink || !raw || seen.has(card)) return;
        seen.add(card);
        cards.push(card);
      });
    });
    return cards;
  }

  function findAuctionNinjaCategoryPageUrls(root = document, loc = (typeof location !== 'undefined' ? location : null)) {
    const base = getAuctionNinjaBaseUrl(root, loc);
    const route = loc ? resolveAuctionNinjaPage(loc) : {};
    let sourceUrl;
    try {
      sourceUrl = new URL(base, 'https://www.auctionninja.com/');
    } catch {
      sourceUrl = null;
    }
    const pages = new Map();
    Array.from(root?.querySelectorAll?.('a[href]') || []).forEach(anchor => {
      const href = controlHref(anchor);
      const label = controlLabel(anchor);
      if (!href || !/view\s+all\s+items|show\s*=\s*all|\bpage\b/i.test(`${label} ${href}`)) return;
      if (/bid|checkout|invoice|payment|account|login|logout|watch|follow|sort|search/i.test(`${href} ${label}`)) return;
      let url;
      try {
        url = new URL(href, base);
      } catch {
        return;
      }
      const targetRoute = resolveAuctionNinjaPage(url);
      if (!targetRoute.supported || targetRoute.kind !== 'category-search') return;
      if (route.categorySlug && targetRoute.categorySlug !== route.categorySlug) return;
      if (sourceUrl && !auctionNinjaCategoryFiltersMatch(sourceUrl, url)) return;
      if (url.href === base) return;
      pages.set(url.href, url.href);
    });
    const out = Array.from(pages.values());
    debug('auctionninja category page urls', { urls: out.slice(0, 8) });
    return out;
  }

  function auctionNinjaCategoryFiltersMatch(sourceUrl, targetUrl) {
    const filterKeys = ['zip', 'miles', 'srt', 'keyword', 'kword', 'auc_date', 'shipopt1', 'shipopt2'];
    return filterKeys.every(key => {
      if (!sourceUrl.searchParams.has(key)) return true;
      return sourceUrl.searchParams.getAll(key).join('\u0001') === targetUrl.searchParams.getAll(key).join('\u0001');
    });
  }

  function extractAuctionNinjaCategoryContext(root = document, loc = (typeof location !== 'undefined' ? location : null)) {
    const raw = textOf(root?.body || root?.documentElement || root);
    const route = loc ? resolveAuctionNinjaPage(loc) : {};
    const range = parseAuctionNinjaCatalogRange(raw);
    const heading = root?.querySelector?.('.category-search-item-title.desktop-show, .category-search-item-title.mobile-show, h1');
    const resultCount = parseAuctionNinjaCategoryResultCount(textOf(heading) || raw);
    const title = String(root?.title || '')
      .replace(/\s*\|\s*AuctionNinja.*$/i, '')
      .replace(/\s+Online Auctions?\s*[-|].*$/i, '')
      .trim();
    return {
      source: 'AuctionNinja',
      pageKind: 'category-search',
      title: title || route.categoryName || 'AuctionNinja Category Search',
      category: route.categoryName || '',
      categorySlug: route.categorySlug || '',
      url: loc?.href || (typeof location !== 'undefined' ? location.href : ''),
      zip: String(route.zip || loc?.searchParams?.get?.('zip') || ''),
      miles: String(route.miles || loc?.searchParams?.get?.('miles') || ''),
      totalItems: range?.total || resultCount || null,
      visibleItems: getAuctionNinjaCategoryCards(root).length,
      generatedAt: new Date().toISOString()
    };
  }

  function extractAuctionNinjaCategoryItems(root = document, loc = (typeof location !== 'undefined' ? location : null)) {
    const base = loc?.href || (typeof location !== 'undefined' ? location.href : 'https://www.auctionninja.com/');
    const categoryContext = extractAuctionNinjaCategoryContext(root, loc);
    const items = [];
    const seen = new Set();

    getAuctionNinjaCategoryCards(root).forEach(card => {
      const rawText = textOf(card);
      const itemLink = card.querySelector?.('a[href*="/product/"]');
      const imageNode = card.querySelector?.('img[alt], img[title], img[src], img[data-src]');
      const url = absoluteUrl(controlHref(itemLink), base);
      const imageTitle = imageNode?.getAttribute?.('alt') || imageNode?.getAttribute?.('title') || '';
      const titleLink = card.querySelector?.('.hot-items-title a[href], .hot-items-title a');
      const title = normalizeAuctionNinjaTitle(imageTitle || textOf(titleLink) || textOf(itemLink));
      const id = productIdFromAuctionNinjaUrl(url);
      const lot = rawText.match(/\bLot\s*#\s*:?[\s-]*([A-Za-z0-9.-]+)/i)?.[1] || '';
      const key = url || id || `${lot}:${title}`;
      if (!key || seen.has(key) || !title) return;
      seen.add(key);

      const bidNode = card.querySelector?.('.hot-items-bottoms p, .hot-items-bottoms');
      const bid = parseAuctionNinjaBidText(textOf(bidNode) || rawText);
      const timeNode = card.querySelector?.('.day-left, .day-leftinr');
      const timeText = textOf(timeNode)
        || rawText.match(/((?:\d+\s+)?(?:days?|hours?|minutes?|seconds?)(?:\s+\d+\s+(?:days?|hours?|minutes?|seconds?))*\s+left)/i)?.[1]
        || '';
      const sellerLink = card.querySelector?.('.hi-auction-company-title a[href], a[href]:not([href*="/product/"])');
      const seller = normalizeAuctionNinjaTitle(textOf(sellerLink));
      const sellerUrl = absoluteUrl(controlHref(sellerLink), base);
      const location = textOf(card.querySelector?.('.hi-auction-company p')) || normalizeAuctionNinjaSearchLocation(rawText);
      const shippingText = parseAuctionNinjaShippingText(rawText);
      const watched = Boolean(card.querySelector?.('.clock-btn.active, [id^="SMSUnFlw"]:not(.disnone)'))
        || /\bfollowing\b|\bwatched\b|\bunfollow\b/i.test(rawText);

      items.push({
        source: 'AuctionNinja',
        pageKind: 'category-search',
        id,
        lot,
        title,
        url,
        image: pickFirstImage(card, base),
        seller,
        sellerUrl,
        category: categoryContext.category,
        currentBid: bid.amount,
        currentPrice: bid.amount,
        highBid: bid.label,
        highBidAmount: bid.amount,
        bidCount: null,
        bidCountNumber: null,
        timeLeft: timeText,
        timeText,
        location,
        shippingText,
        status: /\bclosed\b/i.test(rawText) ? 'CLOSED' : (/coming\s+soon/i.test(rawText) ? 'COMING SOON' : 'OPEN'),
        watched,
        rawText
      });
    });

    return items.sort((a, b) => String(a.title).localeCompare(String(b.title), undefined, { sensitivity: 'base' }));
  }

  function mergeAuctionNinjaCategoryItems(target, items) {
    items.forEach(item => {
      const key = item.url || item.id || item.lot || item.title;
      if (key && item.title) target.set(String(key), item);
    });
    return target;
  }

  async function scrapeAuctionNinjaCategoryItems(onProgress = () => {}, shouldStop = () => false, root = document) {
    const itemsByKey = new Map();
    let steps = 0;
    let stopReason = '';
    const context = extractAuctionNinjaCategoryContext(root);
    mergeAuctionNinjaCategoryItems(itemsByKey, extractAuctionNinjaCategoryItems(root));
    debug('auctionninja category scrape start', { count: itemsByKey.size, context });

    const queuedPageUrls = findAuctionNinjaCategoryPageUrls(root);
    const seenPageUrls = new Set(queuedPageUrls);
    const maxSteps = Math.max(20, Math.ceil(Number(context.totalItems || 0) / 20) + 2);
    while (queuedPageUrls.length && !shouldStop() && steps < maxSteps && typeof fetch === 'function' && typeof DOMParser !== 'undefined') {
      const url = queuedPageUrls.shift();
      if (!url || seenPageUrls.has(`${url}:fetched`)) continue;
      seenPageUrls.add(`${url}:fetched`);
      const before = itemsByKey.size;
      steps += 1;
      onProgress(`Fetching AuctionNinja category page ${steps}... ${before} item(s)`);
      debug('auctionninja category page fetch start', { step: steps, url, before });
      try {
        const response = await fetch(url, { credentials: 'include' });
        if (!response?.ok) {
          stopReason = `fetch-failed-${response?.status || 'unknown'}`;
          break;
        }
        const html = await response.text();
        const pageDoc = parseAuctionNinjaHtmlDocument(html);
        if (!pageDoc) {
          stopReason = 'fetch-parse-failed';
          break;
        }
        mergeAuctionNinjaCategoryItems(itemsByKey, extractAuctionNinjaCategoryItems(pageDoc, new URL(url)));
        if (context.totalItems && itemsByKey.size >= context.totalItems) {
          stopReason = 'expected-total-reached';
          debug('auctionninja category expected total reached', { step: steps, expectedTotal: context.totalItems, count: itemsByKey.size });
          break;
        }
        findAuctionNinjaCategoryPageUrls(pageDoc, new URL(url)).forEach(nextUrl => {
          if (!seenPageUrls.has(nextUrl) && !seenPageUrls.has(`${nextUrl}:fetched`)) {
            seenPageUrls.add(nextUrl);
            queuedPageUrls.push(nextUrl);
          }
        });
        debug('auctionninja category page fetch finished', { step: steps, url, before, after: itemsByKey.size, queued: queuedPageUrls.length });
      } catch (error) {
        stopReason = 'fetch-threw';
        debug('auctionninja category page fetch threw', { step: steps, url, error: String(error) });
        break;
      }
    }

    if (!stopReason) stopReason = shouldStop() ? 'stopped-by-user' : (steps ? 'category-pages-complete' : 'visible-category-complete');
    if (shouldStop()) stopReason = 'stopped-by-user';
    const items = Array.from(itemsByKey.values()).sort((a, b) => String(a.title).localeCompare(String(b.title), undefined, { sensitivity: 'base' }));
    const expectedTotal = context.totalItems || items.length;
    debug('auctionninja category scrape finished', { items: items.length, expectedTotal, steps, stopReason });
    return {
      source: 'auctionninja-category-dom',
      context: { ...context, visibleItems: items.length },
      items,
      expectedTotal,
      stopped: shouldStop(),
      stopReason,
      incomplete: context.totalItems ? items.length < context.totalItems : false,
      pageSteps: steps
    };
  }

  function extractAarAuctionIdFromUrl(url) {
    try {
      return new URL(url, 'https://aarauctions.com/').searchParams.get('auctionId') || '';
    } catch {
      return '';
    }
  }

  function buildAarMapSearchUrl(locationText, settings = getAarResearchSettings()) {
    const locationLabel = String(locationText || '').trim();
    if (!locationLabel) return '';
    const origin = String(settings?.originLabel || defaultAarResearchSettings().originLabel).trim();
    const query = `${locationLabel} to ${origin}`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }

  function parseAarLocationHint(raw) {
    const text = String(raw || '').replace(/\s+/g, ' ').trim();
    const address = text.match(/\b\d{1,6}\s+[A-Za-z0-9 .'-]+,\s*[A-Z][A-Za-z .'-]+,\s*[A-Z]{2}\s*\d{5}(?:-\d{4})?\b/)?.[0];
    if (address) return address.trim();
    return text.match(/\b[A-Z][A-Za-z .'-]+,\s+[A-Z]{2}(?:\s+\d{5})?\b/)?.[0]?.trim() || '';
  }

  function getAarLines(node) {
    return rawTextOf(node)
      .split(/\n+/)
      .map(line => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
  }

  function isAarActionLine(line) {
    return /^(?:Register(?: for Auction)?|More Info \/ Bid Now|Track this Item|Login to Bid)$/i.test(String(line || '').trim());
  }

  function isAarClosingLine(line) {
    return /^(?:Closing at|Closes On|Ends|Starts)\b/i.test(String(line || '').trim());
  }

  function cleanAarTitleLine(line) {
    return String(line || '')
      .replace(/\b(?:Catalog|Register for Auction|Bid Online Now)\b/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getAarAuctionCardSeeds(root = document) {
    const selectors = [
      '.et_pb_column',
      '.et_pb_module',
      '.auction-item',
      '.auction-card',
      '[class*="auction"][class*="item"]',
      'article',
      'li',
      'a[href*="Search.do?auctionId="]'
    ];
    const cards = [];
    const seen = new Set();
    selectors.forEach(selector => {
      Array.from(root?.querySelectorAll?.(selector) || []).forEach(seed => {
        let card = seed;
        if (!card.querySelector?.('a[href*="Search.do?auctionId="]') && /Search\.do\?auctionId=/i.test(controlHref(card))) {
          card = seed.parentElement || seed;
        }
        const raw = textOf(card);
        const hasCatalogLink = Boolean(card.querySelector?.('a[href*="Search.do?auctionId="]')) || /Search\.do\?auctionId=/i.test(controlHref(card));
        if (!raw || !hasCatalogLink || seen.has(card)) return;
        if (/Bidder Login|Seller Login|Payment|Invoice|Checkout/i.test(raw)) return;
        seen.add(card);
        cards.push(card);
      });
    });
    return cards;
  }

  function findBestAarCatalogLink(card) {
    const links = Array.from(card?.querySelectorAll?.('a[href*="Search.do?auctionId="]') || []);
    if (/Search\.do\?auctionId=/i.test(controlHref(card))) links.unshift(card);
    const scored = links.map(link => {
      const label = cleanAarTitleLine(textOf(link));
      let score = 0;
      if (label && !/^(?:Catalog|View Catalog|Bid Online Now)$/i.test(label)) score += 40;
      if (/auction|sale|ending|estate|equipment|vehicle|tools|real estate/i.test(label)) score += 25;
      if (/catalog|register|bid online/i.test(label)) score -= 20;
      return { link, score };
    }).sort((a, b) => b.score - a.score);
    return scored[0]?.link || links[0] || null;
  }

  function extractAarAuctionTitle(card, catalogLink) {
    const linkLabel = cleanAarTitleLine(textOf(catalogLink));
    if (linkLabel && !/^(?:Catalog|View Catalog|Bid Online Now)$/i.test(linkLabel)) return linkLabel;
    const lines = getAarLines(card).map(cleanAarTitleLine).filter(Boolean);
    return lines.find(line => /(?:auction|sale|ending|estate|real estate)/i.test(line) && !isAarClosingLine(line) && !isAarActionLine(line))
      || lines.find(line => !isAarClosingLine(line) && !isAarActionLine(line) && !/^(?:Catalog|Bid Online Now)$/i.test(line))
      || '';
  }

  function extractAarAuctionCards(root = document, loc = (typeof location !== 'undefined' ? location : null), settings = getAarResearchSettings()) {
    const base = loc?.href || (typeof location !== 'undefined' ? location.href : 'https://aarauctions.com/auctions/');
    const cards = [];
    const seen = new Set();

    getAarAuctionCardSeeds(root).forEach(card => {
      const rawText = textOf(card);
      const catalogLink = findBestAarCatalogLink(card);
      const url = absoluteUrl(controlHref(catalogLink), base);
      const auctionId = extractAarAuctionIdFromUrl(url);
      const title = extractAarAuctionTitle(card, catalogLink);
      const lines = getAarLines(card);
      const closingText = lines.find(isAarClosingLine) || rawText.match(/\bClosing at\s+.*?(?:\d{4}|\d{1,2}(?:AM|PM)?)(?=\s|$)/i)?.[0] || '';
      const category = lines.find(line => line !== title && line !== closingText && !isAarActionLine(line) && !/^(?:Catalog|Bid Online Now)$/i.test(line)) || '';
      const description = lines
        .filter(line => line !== title && line !== category && line !== closingText && !isAarActionLine(line))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();
      const locationHint = parseAarLocationHint(`${description} ${rawText}`);
      const key = url || auctionId || `${title}:${rawText.slice(0, 80)}`;
      if (!key || seen.has(key) || !title) return;
      seen.add(key);

      cards.push({
        source: 'AAR Auctions',
        pageKind: 'aar-auction-list',
        auctionId,
        title,
        url,
        image: pickFirstImage(card, base),
        category,
        closingText,
        description,
        registerUrl: pickFirstHref(card, ['a[href*="Register"]', 'a[href*="register"]'], base),
        locationHint,
        mapSearchUrl: buildAarMapSearchUrl(locationHint, settings),
        rawText
      });
    });

    return cards;
  }

  function extractAarSentence(raw, pattern) {
    const lines = rawTextOf({ textContent: raw })
      .split(/\n+/)
      .map(line => line.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    return lines.find(line => pattern.test(line)) || '';
  }

  function extractAarCatalogContext(root = document, loc = (typeof location !== 'undefined' ? location : null), settings = getAarResearchSettings()) {
    const raw = rawTextOf(root?.body || root?.documentElement || root);
    const flat = textOf(root?.body || root?.documentElement || root);
    const locationMatch = raw.match(/Items\s+located\s+at\s*:?\s*([^\n.]+)/i);
    let locationText = locationMatch?.[1]?.trim() || parseAarLocationHint(raw);
    if (locationText.includes(':')) locationText = locationText.split(':').pop().trim();
    const expectedMatch = flat.match(/\bAll\s+Items\s*\(\s*([\d,]+)\s*\)/i)
      || flat.match(/\b(\d{1,6})\s+items?\s+per\s+page\b/i)
      || flat.match(/\bof\s+([\d,]+)\s+items?\b/i);
    return {
      source: 'AAR Auctions',
      pageKind: 'aar-auction-catalog',
      auctionId: loc ? getAarAuctionId(loc) : '',
      title: pickFirstText(root, ['h1', '.auction-title', 'title']) || String(root?.title || '').replace(/\s*\|\s*Absolute Auctions.*$/i, '').trim() || 'AAR Auction Catalog',
      url: loc?.href || (typeof location !== 'undefined' ? location.href : ''),
      buyerPremium: percentFromText(flat.match(/\b\d+(?:\.\d+)?\s*%\s+buyers?\s+premium\b/i)?.[0] || flat.match(/\bbuyers?\s+premium\s*:?\s*\d+(?:\.\d+)?\s*%/i)?.[0] || ''),
      pickupText: extractAarSentence(raw, /\b(?:pickup|picked up)\b/i),
      paymentText: extractAarSentence(raw, /\bpayment\b/i),
      location: locationText,
      directionsUrl: pickFirstHref(root, ['a[href*="maps"]', 'a[href*="google.com/maps"]'], loc?.href || 'https://aarauctions.com/'),
      mapSearchUrl: buildAarMapSearchUrl(locationText, settings),
      expectedTotal: expectedMatch ? Number(expectedMatch[1].replace(/,/g, '')) : null,
      generatedAt: new Date().toISOString()
    };
  }

  function getAarCatalogLotRows(root = document) {
    const selectors = [
      'tr',
      '.auction-item',
      '.item',
      '.lot',
      '[class*="auction"][class*="item"]',
      '[class*="lot"]',
      'li',
      'article'
    ];
    const rows = [];
    const seen = new Set();
    selectors.forEach(selector => {
      Array.from(root?.querySelectorAll?.(selector) || []).forEach(row => {
        const raw = textOf(row);
        if (!raw || !/#\s*[A-Za-z0-9.-]+\s*[-–]/.test(raw) || !/High Bid|Minimum Next Bid|Closes On|More Info/i.test(raw)) return;
        if (seen.has(row)) return;
        seen.add(row);
        rows.push(row);
      });
    });
    return rows;
  }

  function parseAarLotScriptArgs(value) {
    const args = [];
    let current = '';
    let quote = '';
    let escaped = false;
    String(value || '').split('').forEach(char => {
      if (escaped) {
        current += char;
        escaped = false;
        return;
      }
      if (char === '\\' && quote) {
        current += char;
        escaped = true;
        return;
      }
      if ((char === "'" || char === '"') && (!quote || quote === char)) {
        quote = quote ? '' : char;
        current += char;
        return;
      }
      if (char === ',' && !quote) {
        args.push(current.trim());
        current = '';
        return;
      }
      current += char;
    });
    if (current.trim() || value) args.push(current.trim());
    return args;
  }

  function decodeAarScriptArg(value) {
    const token = String(value ?? '').trim();
    if (/^null$/i.test(token)) return '';
    if ((token.startsWith("'") && token.endsWith("'")) || (token.startsWith('"') && token.endsWith('"'))) {
      return token.slice(1, -1)
        .replace(/\\'/g, "'")
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }
    return token;
  }

  function numberFromAarScriptArg(value) {
    const decoded = decodeAarScriptArg(value);
    const number = Number(String(decoded).replace(/,/g, ''));
    return Number.isFinite(number) ? number : null;
  }

  function moneyLabelFromAarScriptArgs(labelValue, numericValue) {
    const label = decodeAarScriptArg(labelValue);
    if (label) return `$${label}`;
    const number = numberFromAarScriptArg(numericValue);
    return Number.isFinite(number) ? `$${number.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';
  }

  function cleanAarScriptLotTitle(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    const firstSentence = text.match(/^(.{18,}?\.)\s+/)?.[1] || '';
    return (firstSentence || text)
      .replace(/\.$/, '')
      .trim();
  }

  function extractAarScriptLots(root = document, loc = (typeof location !== 'undefined' ? location : null)) {
    const base = loc?.href || (typeof location !== 'undefined' ? location.href : 'https://aarauctions.com/');
    const lots = [];
    Array.from(root?.querySelectorAll?.('script') || []).forEach(script => {
      const text = script?.textContent || '';
      const matches = text.matchAll(/new\s+Lot\s*\(([\s\S]*?)\)\s*;/g);
      Array.from(matches).forEach(match => {
        const args = parseAarLotScriptArgs(match[1]);
        if (args.length < 22) return;
        const auctionId = decodeAarScriptArg(args[0]) || (loc ? getAarAuctionId(loc) : '');
        const lot = decodeAarScriptArg(args[2]);
        const itemId = decodeAarScriptArg(args[3]);
        const description = decodeAarScriptArg(args[5]);
        const title = cleanAarScriptLotTitle(description);
        if (!lot || !itemId || !title) return;
        const highBidAmount = numberFromAarScriptArg(args[19]);
        const nextBidAmount = numberFromAarScriptArg(args[21]);
        lots.push({
          source: 'AAR Auctions',
          pageKind: 'aar-auction-catalog',
          auctionId,
          lot,
          title,
          url: absoluteUrl(`/servlet/Search.do?auctionId=${encodeURIComponent(auctionId)}&itemId=${encodeURIComponent(itemId)}`, base),
          image: '',
          description,
          highBid: moneyLabelFromAarScriptArgs(args[24], args[19]),
          highBidAmount,
          currentBid: highBidAmount,
          nextBid: moneyLabelFromAarScriptArgs(args[26], args[21]),
          nextBidAmount,
          quantity: numberFromAarScriptArg(args[15]),
          auctionType: decodeAarScriptArg(args[14]),
          closingText: [decodeAarScriptArg(args[34]), decodeAarScriptArg(args[35])].filter(Boolean).join(' - '),
          rawText: textOf(script)
        });
      });
    });
    return lots;
  }

  function extractAarCatalogLots(root = document, loc = (typeof location !== 'undefined' ? location : null)) {
    const base = loc?.href || (typeof location !== 'undefined' ? location.href : 'https://aarauctions.com/');
    const auctionId = loc ? getAarAuctionId(loc) : '';
    const lots = [];
    const seen = new Set();

    const addLot = (lot) => {
      const key = lot.lot ? `${lot.auctionId || ''}:${lot.lot}` : (lot.url || lot.title);
      if (!key || seen.has(key) || !lot.lot || !lot.title) return;
      seen.add(key);
      lots.push(lot);
    };

    extractAarScriptLots(root, loc).forEach(addLot);

    getAarCatalogLotRows(root).forEach(row => {
      const rawText = textOf(row);
      const lot = rawText.match(/#\s*([A-Za-z0-9.-]+)\s*[-–]/)?.[1] || '';
      const title = rawText.match(/#\s*[A-Za-z0-9.-]+\s*[-–]\s*([\s\S]*?)(?=\s+(?:More Info|Closes On|High Bid|Auction Type|Quantity|Minimum Next Bid|Login to Bid|$))/i)?.[1]?.trim() || '';
      const link = row.querySelector?.('a[href*="itemId"], a[href*="ItemId"], a[href*="Search.do"]');
      const url = absoluteUrl(controlHref(link), base);
      const highBid = rawText.match(/\bHigh Bid:\s*(\$[\d,]+(?:\.\d{2})?)/i)?.[1] || '';
      const nextBid = rawText.match(/\bMinimum Next Bid:\s*(\$[\d,]+(?:\.\d{2})?)/i)?.[1] || '';
      const quantityText = rawText.match(/\bQuantity:\s*([\d,]+)/i)?.[1] || '';
      const closingText = rawText.match(/\bCloses On:\s*([\s\S]*?)(?=\s+High Bid:|\s+Auction Type:|\s+Quantity:|\s+Minimum Next Bid:|$)/i)?.[1]?.trim() || '';
      const description = rawText.match(/\bMore Details\s+([\s\S]+)$/i)?.[1]?.trim() || '';
      addLot({
        source: 'AAR Auctions',
        pageKind: 'aar-auction-catalog',
        auctionId,
        lot,
        title,
        url,
        image: pickFirstImage(row, base),
        description,
        highBid,
        highBidAmount: moneyFromText(highBid),
        currentBid: moneyFromText(highBid),
        nextBid,
        nextBidAmount: moneyFromText(nextBid),
        quantity: quantityText ? Number(quantityText.replace(/,/g, '')) : null,
        auctionType: rawText.match(/\bAuction Type:\s*([\s\S]*?)(?=\s+Quantity:|\s+Minimum Next Bid:|$)/i)?.[1]?.trim() || '',
        closingText,
        rawText
      });
    });

    return lots.sort((a, b) => String(a.lot).localeCompare(String(b.lot), undefined, {
      numeric: true,
      sensitivity: 'base'
    }));
  }

  function mergeAarLots(target, lots) {
    lots.forEach(lot => {
      const key = lot.lot ? `${lot.auctionId || ''}:${lot.lot}` : (lot.url || lot.title);
      if (key && lot.title) target.set(String(key), lot);
    });
    return target;
  }

  function findAarCatalogPageUrls(root = document, loc = (typeof location !== 'undefined' ? location : null)) {
    const base = loc?.href || (typeof location !== 'undefined' ? location.href : 'https://aarauctions.com/');
    const auctionId = loc ? getAarAuctionId(loc) : extractAarAuctionIdFromUrl(base);
    const pages = new Map();
    Array.from(root?.querySelectorAll?.('a[href*="Search.do"]') || []).forEach(anchor => {
      const label = controlLabel(anchor);
      const href = controlHref(anchor);
      if (!href || /bid|register|track|login|payment|invoice|checkout/i.test(`${href} ${label}`)) return;
      let url;
      try {
        url = new URL(href, base);
      } catch {
        return;
      }
      if (!isAarAuctionsHost(url.hostname)) return;
      if (!/^\/servlet\/Search\.do$/i.test(url.pathname)) return;
      if (auctionId && url.searchParams.get('auctionId') !== auctionId) return;
      if (![...url.searchParams.keys()].some(key => /page|start|offset|perpage|perPage|rows/i.test(key))) return;
      pages.set(url.href, url.href);
    });
    return Array.from(pages.values());
  }

  async function scrapeAarAuctionCards(onProgress = () => {}, shouldStop = () => false, root = document) {
    const settings = getAarResearchSettings();
    const sales = extractAarAuctionCards(root, typeof location !== 'undefined' ? location : null, settings);
    const context = {
      source: 'AAR Auctions',
      pageKind: 'aar-auction-list',
      title: String(root?.title || '').replace(/\s*\|\s*Absolute Auctions.*$/i, '').trim() || 'AAR Auction Calendar',
      url: typeof location !== 'undefined' ? location.href : '',
      researchSettings: settings,
      generatedAt: new Date().toISOString()
    };
    onProgress(`Read ${sales.length} AAR auction card(s).`);
    debug('aar auction list scrape finished', { count: sales.length, settings });
    return { source: 'aar-dom', items: sales, sales, expectedTotal: sales.length, context, stopped: shouldStop(), stopReason: shouldStop() ? 'stopped-by-user' : 'current-page-only' };
  }

  async function scrapeAarCatalogLots(onProgress = () => {}, shouldStop = () => false, root = document) {
    const lotsByKey = new Map();
    const loc = typeof location !== 'undefined' ? location : null;
    let context = extractAarCatalogContext(root, loc);
    let stopReason = '';
    let steps = 0;
    mergeAarLots(lotsByKey, extractAarCatalogLots(root, loc));
    const queued = findAarCatalogPageUrls(root, loc);
    const seenUrls = new Set(queued);
    debug('aar catalog scrape start', { count: lotsByKey.size, context, queued: queued.length });

    while (queued.length && !shouldStop()) {
      if (steps >= 12) {
        stopReason = 'max-fetch-steps';
        break;
      }
      if (context.expectedTotal && lotsByKey.size >= context.expectedTotal) {
        stopReason = 'expected-total-reached';
        break;
      }
      if (typeof fetch !== 'function' || typeof DOMParser === 'undefined') {
        stopReason = 'fetch-unavailable';
        break;
      }
      const url = queued.shift();
      steps += 1;
      onProgress(`Fetching AAR catalog page ${steps}...`);
      try {
        const response = await fetch(url, { credentials: 'include' });
        if (!response?.ok) {
          stopReason = `fetch-failed-${response?.status || 'unknown'}`;
          break;
        }
        const html = await response.text();
        const pageDoc = parseAuctionNinjaHtmlDocument(html);
        if (!pageDoc) {
          stopReason = 'fetch-parse-failed';
          break;
        }
        const pageLoc = new URL(url);
        mergeAarLots(lotsByKey, extractAarCatalogLots(pageDoc, pageLoc));
        const pageContext = extractAarCatalogContext(pageDoc, pageLoc);
        context = { ...context, expectedTotal: context.expectedTotal || pageContext.expectedTotal };
        findAarCatalogPageUrls(pageDoc, pageLoc).forEach(pageUrl => {
          if (!seenUrls.has(pageUrl)) {
            seenUrls.add(pageUrl);
            queued.push(pageUrl);
          }
        });
      } catch (error) {
        stopReason = 'fetch-threw';
        debug('aar catalog fetch threw', { url, error: String(error) });
        break;
      }
    }

    if (shouldStop()) stopReason = 'stopped-by-user';
    if (!stopReason) stopReason = context.expectedTotal && lotsByKey.size >= context.expectedTotal ? 'expected-total-reached' : 'current-page-exhausted';
    const lots = Array.from(lotsByKey.values()).sort((a, b) => String(a.lot || '').localeCompare(String(b.lot || ''), undefined, {
      numeric: true,
      sensitivity: 'base'
    }));
    const expectedTotal = context.expectedTotal || lots.length;
    debug('aar catalog scrape finished', { lots: lots.length, expectedTotal, stopReason, steps });
    return {
      source: 'aar-dom',
      items: lots,
      lots,
      expectedTotal,
      context,
      stopped: shouldStop(),
      stopReason,
      incomplete: expectedTotal ? lots.length < expectedTotal : false,
      pageSteps: steps
    };
  }

  function cleanGovDealsText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function govDealsLines(node) {
    return rawTextOf(node).split(/\n+/).map(cleanGovDealsText).filter(Boolean);
  }

  function extractGovDealsVisibleCount(raw, fallback = 0) {
    const text = cleanGovDealsText(raw);
    const showing = text.match(/\bShowing\s+([\d,]+)\s*(?:-|to)\s*([\d,]+)\s+of\s+([\d,]+)/i);
    if (showing) return Number(showing[3].replace(/,/g, ''));
    const single = text.match(/\bShowing\s+([\d,]+)\s+of\s+([\d,]+)/i);
    if (single) return Number(single[2].replace(/,/g, ''));
    const results = text.match(/\b([\d,]+)\s+Results?\s+for\b/i);
    if (results) return Number(results[1].replace(/,/g, ''));
    const searchResults = text.match(/\b([\d,]+)\s+Search\s+Results?\b/i);
    if (searchResults) return Number(searchResults[1].replace(/,/g, ''));
    return fallback || null;
  }

  function govDealsAssetPartsFromUrl(url) {
    try {
      return getGovDealsAssetParts(new URL(url, 'https://www.govdeals.com/'));
    } catch {
      return { assetId: '', accountId: '' };
    }
  }

  function isGovDealsAssetHref(href) {
    const ids = govDealsAssetPartsFromUrl(href);
    return Boolean(ids.assetId && ids.accountId);
  }

  function govDealsAssetKeyFromHref(href) {
    const ids = govDealsAssetPartsFromUrl(href);
    return ids.assetId && ids.accountId ? `${ids.accountId}:${ids.assetId}` : absoluteUrl(href, 'https://www.govdeals.com/');
  }

  function govDealsCompactPlaceMatch(text) {
    const stateNames = [
      'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 'Delaware',
      'District of Columbia', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa',
      'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 'Minnesota',
      'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey',
      'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 'Oklahoma', 'Oregon',
      'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 'Tennessee', 'Texas', 'Utah',
      'Vermont', 'Virginia', 'Washington', 'West Virginia', 'Wisconsin', 'Wyoming'
    ].join('|');
    return cleanGovDealsText(text).match(new RegExp(`([A-Z][A-Za-z.' -]+,\\s*(?:${stateNames}|[A-Z]{2}),\\s*(?:USA|United States)(?:\\s*\\d{5})?)`));
  }

  function govDealsCompactListingFields(raw) {
    let body = cleanGovDealsText(raw);
    ['New Listing', 'Online Auction', 'Sealed Bid', 'Buy Now'].forEach(label => {
      body = body.replace(new RegExp(`^${label}\\s*`, 'i'), '');
    });
    const place = govDealsCompactPlaceMatch(body);
    const beforePlace = place ? body.slice(0, place.index).trim() : '';
    const afterPlace = place ? body.slice(place.index + place[0].length).trim() : body;
    const bid = afterPlace.match(/\bUSD\s*[\d,]+(?:\.\d{2})?|\$[\d,]+(?:\.\d{2})?(?:\s*USD)?/i)?.[0] || '';
    const afterBid = bid ? afterPlace.slice(afterPlace.indexOf(bid) + bid.length) : afterPlace;
    const close = afterBid.match(/\b\d+\s*D\s*\d+\s*H(?:\s*\d+\s*M)?\s*\([^)]+\)|\b\d+\s*H\s*\d+\s*M\s*\([^)]+\)|\b\d+\s*D\s*\([^)]+\)/i)?.[0] || '';
    const lot = body.match(/\bLot\s*(?:Number|#)\s*:?\s*([A-Za-z0-9.-]+)/i)?.[1] || '';
    return {
      title: beforePlace,
      location: place?.[1]?.trim() || '',
      currentBid: bid ? cleanGovDealsText(bid) : '',
      closeTime: close ? cleanGovDealsText(close) : '',
      lotNumber: lot
    };
  }

  function govDealsLotNumber(raw) {
    const text = cleanGovDealsText(raw);
    return text.match(/\bLot\s*(?:Number|#)\s*:?\s*([A-Za-z0-9.-]+)/i)?.[1] || '';
  }

  function govDealsCurrentBid(raw) {
    const text = cleanGovDealsText(raw);
    const match = text.match(/\b(?:Current Bid|High Bid|Starting Bid)\s*:?\s*(\$[\d,]+(?:\.\d{2})?(?:\s*USD)?|(?:USD\s*)?[\d,]+(?:\.\d{2})?\s*USD?)/i);
    return match ? cleanGovDealsText(match[1]) : govDealsCompactListingFields(text).currentBid;
  }

  function govDealsBidCount(raw, detail = false) {
    const text = cleanGovDealsText(raw);
    const direct = text.match(/(?:^|[^\d.])(\d+)\s+Bids?\b/i);
    if (direct) return `${direct[1]} ${Number(direct[1]) === 1 ? 'Bid' : 'Bids'}`;
    const reversed = text.match(/\bBids?\s*:?\s*(\d+)\b/i);
    if (reversed) return detail ? reversed[1] : `${reversed[1]} ${Number(reversed[1]) === 1 ? 'Bid' : 'Bids'}`;
    return '';
  }

  function govDealsCloseTime(raw) {
    const text = cleanGovDealsText(raw);
    const compact = text.match(/\b(?:Closes?|Ends?)\s*:?\s*((?:(?:\d+\s*[DHMS]\s*)+)(?:\([^)]*\))?)/i)?.[1]?.trim();
    if (compact) return cleanGovDealsText(compact);
    return text.match(/\b(?:Closes?|Ends?)\s*:?\s*([\s\S]*?)(?=\s+(?:Item Location|Location|Distance|Shipping|Local Pickup|Pickup|Condition|Used\/See|Seller:|Bid Increment|Sales\/Lot Type|$))/i)?.[1]?.trim()
      || govDealsCompactListingFields(text).closeTime
      || '';
  }

  function govDealsLocation(raw) {
    const text = cleanGovDealsText(raw);
    const lineLocation = govDealsLines({ textContent: raw })
      .map(line => govDealsCompactPlaceMatch(line)?.[1]?.trim() || '')
      .find(Boolean);
    return text.match(/\bItem Location\s*:?\s*([\s\S]*?)(?=\s+(?:Account Type|Inspection|Payment|Removal|Special Instructions|Seller Information|Shipping|Local Pickup|Pickup|Condition|Used\/See|Distance|Bids?|Current Bid|OFFERED FOR AUCTION|Description|$))/i)?.[1]?.trim()
      || text.match(/\bLocation\s*:?\s*([\s\S]*?)(?=\s+(?:Subject to|Account Type|Inspection|Payment|Removal|Special Instructions|Distance|Shipping|Local Pickup|Pickup|Condition|Used\/See|Bids?|Current Bid|OFFERED FOR AUCTION|Description|$))/i)?.[1]?.trim()
      || lineLocation
      || govDealsCompactListingFields(text).location
      || '';
  }

  function govDealsDistanceText(raw) {
    return cleanGovDealsText(raw).match(/\bDistance\s*:?\s*([\d,.]+\s*(?:miles|mile|mi|kilometers?|km))/i)?.[1] || '';
  }

  function govDealsShippingText(raw) {
    const text = cleanGovDealsText(raw);
    if (/Shipping\s+Available/i.test(text)) return 'Shipping Available';
    return text.match(/\bShipping(?:\s+(?:Options?|Method))?\s*:\s*([\s\S]*?)(?=\s+(?:Pickup|Condition|Current Bid|Bids?|Ends?|Location|Payment|$))/i)?.[1]?.trim() || '';
  }

  function govDealsPickupText(raw) {
    const text = cleanGovDealsText(raw);
    if (/\bLocal Pickup Only\b/i.test(text)) return 'Local Pickup Only';
    const pickupOnly = text.match(/\bPick\s*Up\s+ONLY\b[\s\S]*$/i)
      || text.match(/\bPickup\s+only\b[\s\S]*$/i);
    if (pickupOnly) return cleanGovDealsText(pickupOnly[0]);
    const lines = govDealsLines({ textContent: raw });
    const local = lines.find(line => /^Local Pickup Only$/i.test(line));
    if (local) return local;
    const pickup = lines.find(line => /\b(?:Pickup|Pick\s*Up)\s+(?:Only|Location|Hours?)\b/i.test(line) && !/\b(?:Item Location|Asset ID|Current Bid|Lot Number)\b/i.test(line));
    return pickup || cleanGovDealsText(raw).match(/\b((?:Pickup|Pick\s*Up)\s+(?:Only|Location|Hours?)\s*[\s\S]*?)(?=\s+(?:Payment|Inspection|Item Location|Current Bid|Bids?|Seller Information)|$)/i)?.[1]?.trim() || '';
  }

  function govDealsConditionText(raw) {
    const text = cleanGovDealsText(raw);
    return text.match(/\bCondition\s*:?\s*(Used\/See Description|New\/See Description|Salvage|Used|New|Unknown)\b/i)?.[1]
      || text.match(/\b(Used\/See Description|New\/See Description|Salvage|Unknown)\b/i)?.[1]
      || '';
  }

  function govDealsSellerText(card, assetLink, loc = null, lines = [], title = '', pageKind = '') {
    const route = loc ? resolveGovDealsPage(loc) : {};
    const sellerSelector = route.sellerSlug ? `a[href*="/en/${route.sellerSlug}"]` : 'a[href*="/en/"]';
    const sellerLink = card?.querySelector?.(sellerSelector);
    const linked = textOf(sellerLink);
    if (linked && linked !== textOf(assetLink)) return linked;
    const labeled = cleanGovDealsText(textOf(card)).match(/\bSeller\s*:?\s*([\s\S]*?)(?=\s+(?:Asset ID|Lot Number|Current Bid|High Bid|Bids?|Ends?|Location|$))/i)?.[1]?.trim();
    if (labeled) return labeled;
    if (pageKind === 'govdeals-seller') {
      return lines.find(line => line !== title && !/\b(?:Asset ID|Lot Number|Current Bid|High Bid|Bids?|Ends?|Location|Distance|Shipping|Pickup|Condition|Used\/See)\b/i.test(line)) || '';
    }
    return '';
  }

  function govDealsSellerUrl(card, base, loc = null, pageKind = '') {
    const route = loc ? resolveGovDealsPage(loc) : {};
    if (pageKind === 'govdeals-seller' && loc?.href) return loc.href;
    const sellerSelector = route.sellerSlug ? `a[href*="/en/${route.sellerSlug}"]` : 'a[href*="/en/"]';
    const sellerLink = card?.querySelector?.(sellerSelector);
    const href = controlHref(sellerLink);
    return href ? absoluteUrl(href, base) : '';
  }

  function govDealsCategory(lines, title, seller) {
    return lines.find(line => line !== title && line !== seller && !/\b(?:Asset ID|Lot Number|Current Bid|High Bid|Bids?|Ends?|Location|Distance|Shipping|Pickup|Condition|Used\/See|Seller:)\b/i.test(line)) || '';
  }

  function findGovDealsAssetLink(card) {
    const selectors = [
      'a[name="lnkAssetDetails"][href*="/asset/"]',
      'a[name="lnkImageAssetDetails"][href*="/asset/"]',
      'a[href*="/en/asset/"]',
      'a[href*="/asset/"]'
    ];
    for (const selector of selectors) {
      const links = Array.from(card?.querySelectorAll?.(selector) || []);
      const found = links.find(link => isGovDealsAssetHref(controlHref(link)));
      if (found) return found;
    }
    return isGovDealsAssetHref(controlHref(card)) ? card : null;
  }

  function closestGovDealsListingCard(seed) {
    if (!seed) return null;
    if (seed.matches?.('.card-search, [id^="asset-"], article, .card')) return seed;
    return seed.closest?.('.card-search, [id^="asset-"], article, .card, li')
      || seed.parentElement
      || seed;
  }

  function govDealsTitleAttribute(card, assetLink) {
    const titleNodes = [
      assetLink,
      card?.querySelector?.('a[name="lnkAssetDetails"]'),
      card?.querySelector?.('a[name="lnkImageAssetDetails"]')
    ];
    for (const node of titleNodes) {
      const value = cleanGovDealsText(node?.getAttribute?.('title') || node?.getAttribute?.('alt') || '');
      if (value && !/view details|image|photo/i.test(value)) return value;
    }
    return '';
  }

  function getGovDealsListingCards(root = document) {
    const selectors = [
      '#grid .card-search',
      '#grid [id^="asset-"]',
      '.card-search',
      '[id^="asset-"]',
      'article',
      '.card',
      '[class*="card"]',
      '[class*="listing"]',
      '[class*="asset"]',
      'li',
      'a[name="lnkAssetDetails"][href*="/asset/"]',
      'a[name="lnkImageAssetDetails"][href*="/asset/"]',
      'a[href*="/en/asset/"]',
      'a[href*="/asset/"]'
    ];
    const cards = [];
    const seen = new Set();
    const seenAssetKeys = new Set();
    selectors.forEach(selector => {
      Array.from(root?.querySelectorAll?.(selector) || []).forEach(seed => {
        const card = closestGovDealsListingCard(seed);
        const assetLink = findGovDealsAssetLink(card) || (isGovDealsAssetHref(controlHref(seed)) ? seed : null);
        const href = controlHref(assetLink);
        if (!card || !assetLink || !href || seen.has(card)) return;
        const assetKey = govDealsAssetKeyFromHref(href);
        if (!assetKey || seenAssetKeys.has(assetKey)) return;
        const raw = textOf(card) || textOf(assetLink) || govDealsTitleAttribute(card, assetLink);
        if (!raw) return;
        if (/\b(?:login|register|checkout|payment|invoice|cart|place bid|make offer)\b/i.test(raw)) return;
        seen.add(card);
        seenAssetKeys.add(assetKey);
        cards.push(card);
      });
    });
    debug('govdeals listing card scan', { count: cards.length });
    return cards;
  }

  function parseGovDealsListingCard(card, loc = (typeof location !== 'undefined' ? location : null), pageKind = 'govdeals-new-listings') {
    const base = loc?.href || (typeof location !== 'undefined' ? location.href : 'https://www.govdeals.com/');
    const assetLink = findGovDealsAssetLink(card);
    const rawText = rawTextOf(card) || textOf(card) || textOf(assetLink) || govDealsTitleAttribute(card, assetLink);
    const rawLines = govDealsLines(card);
    const url = absoluteUrl(controlHref(assetLink), base);
    const ids = govDealsAssetPartsFromUrl(url);
    const compact = govDealsCompactListingFields(rawText);
    const titleAttribute = govDealsTitleAttribute(card, assetLink);
    const linkText = cleanGovDealsText(textOf(assetLink));
    const linkLooksLikeWholeCard = linkText && (linkText === rawText || /(?:Online Auction|Lot\s*#:|USD\s*[\d,]+|Current Bid|Location)/i.test(linkText));
    const title = titleAttribute
      || (linkLooksLikeWholeCard ? '' : linkText)
      || compact.title
      || rawLines.find(line => !/\b(?:Asset ID|Lot Number|Current Bid|Bids?|Ends?|Location|Distance|Shipping|Pickup|Condition|Seller:)\b/i.test(line))
      || '';
    const seller = govDealsSellerText(card, assetLink, loc, rawLines, title, pageKind);
    const category = govDealsCategory(rawLines, title, seller);
    const currentBid = govDealsCurrentBid(rawText);
    const finalCurrentBid = currentBid || compact.currentBid;
    const bidCount = govDealsBidCount(rawText);
    const condition = govDealsConditionText(rawText);
    return {
      source: 'GovDeals',
      pageKind,
      assetId: ids.assetId,
      accountId: ids.accountId,
      lotNumber: govDealsLotNumber(rawText) || compact.lotNumber,
      title,
      url,
      image: pickFirstImage(card, base),
      seller,
      sellerUrl: govDealsSellerUrl(card, base, loc, pageKind),
      category,
      status: condition,
      currentBid: finalCurrentBid,
      currentBidAmount: moneyFromText(finalCurrentBid),
      bidCount,
      bidCountNumber: numberFromText(bidCount),
      closeTime: govDealsCloseTime(rawText) || compact.closeTime,
      location: govDealsLocation(rawText) || compact.location,
      distanceText: govDealsDistanceText(rawText),
      shippingText: govDealsShippingText(rawText),
      pickupText: govDealsPickupText(rawText),
      condition,
      specs: {},
      description: '',
      rawText: cleanGovDealsText(rawText)
    };
  }

  function extractGovDealsListings(root = document, loc = (typeof location !== 'undefined' ? location : null), pageKind = 'govdeals-new-listings') {
    const listings = [];
    const seen = new Set();
    getGovDealsListingCards(root).forEach(card => {
      const item = parseGovDealsListingCard(card, loc, pageKind);
      const key = item.url || `${item.assetId}:${item.accountId}` || item.title;
      if (!item.title || !key || seen.has(key)) return;
      seen.add(key);
      listings.push(item);
    });
    return listings;
  }

  function extractGovDealsSellerContext(root = document, loc = (typeof location !== 'undefined' ? location : null)) {
    const route = loc ? resolveGovDealsPage(loc) : {};
    const raw = rawTextOf(root?.body || root?.documentElement || root);
    const listings = extractGovDealsListings(root, loc, 'govdeals-seller');
    const title = pickFirstText(root, ['h1', '[data-testid*="seller"]', '.seller-name'])
      || String(root?.title || '').replace(/\s*\|\s*GovDeals.*$/i, '').trim()
      || route.sellerSlug
      || 'GovDeals Seller';
    const locationHint = govDealsLines({ textContent: raw }).find(line => /\b[A-Z]{2}\b|New Jersey|Pennsylvania|Connecticut|New York/i.test(line) && !/Showing|GovDeals|Current Bid|Asset ID/i.test(line)) || '';
    return {
      source: 'GovDeals',
      pageKind: 'govdeals-seller',
      title,
      sellerName: title,
      seller: title,
      sellerSlug: route.sellerSlug || '',
      url: loc?.href || '',
      locationHint,
      visibleCount: extractGovDealsVisibleCount(raw, listings.length)
    };
  }

  function extractGovDealsSearchContext(root = document, loc = (typeof location !== 'undefined' ? location : null)) {
    const route = loc ? resolveGovDealsPage(loc) : {};
    const params = loc ? govDealsSearchParams(loc) : new URLSearchParams('');
    const raw = rawTextOf(root?.body || root?.documentElement || root);
    const listings = extractGovDealsListings(root, loc, 'govdeals-new-listings');
    return {
      source: 'GovDeals',
      pageKind: 'govdeals-new-listings',
      title: pickFirstText(root, ['h1', '.page-title']) || String(root?.title || '').replace(/\s*\|\s*GovDeals.*$/i, '').trim() || 'GovDeals New Listings',
      url: loc?.href || '',
      zipcode: route.zipcode || String(params.get('zipcode') || ''),
      miles: route.miles || String(params.get('miles') || ''),
      category: route.category || String(params.get('category') || ''),
      categoryName: route.categoryName || String(params.get('categoryName') || ''),
      sortLabel: cleanGovDealsText(raw).match(/\bSort\s*:?\s*([A-Za-z ]+?)(?=\s+(?:Showing|Filters|$))/i)?.[1]?.trim() || '',
      visibleCount: extractGovDealsVisibleCount(raw, listings.length),
      generatedAt: new Date().toISOString()
    };
  }

  function extractGovDealsSpecs(raw) {
    const specs = {};
    const labels = ['Manufacturer', 'Model', 'Condition', 'Make', 'Year', 'VIN', 'Odometer', 'Serial Number'];
    labels.forEach(label => {
      const match = cleanGovDealsText(raw).match(new RegExp(`\\b${label}\\s*:?\\s+([\\s\\S]*?)(?=\\s+(?:${labels.filter(item => item !== label).join('|')}|Current Bid|Bids?|Item Location|Lot Number|Asset ID|OFFERED FOR AUCTION|Pickup|$))`, 'i'));
      const value = match?.[1]?.trim();
      if (value) specs[label] = value;
    });
    return specs;
  }

  function govDealsAssetContentRoot(root) {
    const main = root?.querySelector?.('#main-content') || root;
    return main?.querySelector?.('.col-md-10.mx-auto')
      || main?.querySelector?.('.long-description')?.parentElement
      || main?.querySelector?.('.description-table')?.parentElement
      || null;
  }

  function govDealsAssetLabeledValue(root, label) {
    const wanted = String(label || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!wanted || !root?.querySelectorAll) return '';
    const rows = Array.from(root.querySelectorAll('#seller_information .row, .description-table tr, .description-body, tr'));
    for (const row of rows) {
      const labelNode = row.querySelector?.('h5, .td-att-label, th, dt');
      const rowLabel = cleanGovDealsText(textOf(labelNode)).replace(/:$/, '').toLowerCase();
      if (rowLabel !== wanted) continue;
      const valueNode = row.querySelector?.('.td-att-value, td:nth-child(2), .col-6:last-child, dd, p');
      const value = cleanGovDealsText(textOf(valueNode));
      if (value && value.toLowerCase() !== wanted) return value;
    }
    return '';
  }

  function extractGovDealsSpecsFromDom(root) {
    const specs = {};
    const allowed = new Set(['Manufacturer', 'Model', 'Condition', 'Make', 'Year', 'VIN', 'Odometer', 'Serial Number']);
    const rows = Array.from(root?.querySelectorAll?.('#table-id-0 tr, .description-table table tr') || []);
    for (const row of rows) {
      const label = cleanGovDealsText(textOf(row.querySelector?.('.td-att-label, th, td:first-child'))).replace(/:$/, '');
      if (!allowed.has(label)) continue;
      const value = cleanGovDealsText(textOf(row.querySelector?.('.td-att-value, td:nth-child(2), td:last-child')));
      if (value) specs[label] = value;
    }
    return specs;
  }

  function govDealsAssetSeller(root, base) {
    const cleanSeller = value => cleanGovDealsText(value).replace(/\s*\[\s*view seller(?:'s)? other assets\s*\]\s*$/i, '').trim();
    const labeled = cleanSeller(govDealsAssetLabeledValue(root, 'Seller'));
    const links = Array.from(root?.querySelectorAll?.('#seller_information a[href]') || []);
    const seller = labeled || cleanSeller(textOf(links.find(link => cleanSeller(textOf(link)))));
    const sellerLink = links.find(link => cleanSeller(textOf(link)).toLowerCase() === seller.toLowerCase());
    return {
      seller,
      sellerUrl: sellerLink && labeled && cleanSeller(textOf(sellerLink)).toLowerCase() === labeled.toLowerCase() && controlHref(sellerLink)
        ? absoluteUrl(controlHref(sellerLink), base)
        : ''
    };
  }

  function govDealsAssetImage(root, base, title = '') {
    const selectors = [
      'img.lg-object.lg-image',
      '.lg-object.lg-image',
      'img[alt]',
      'img'
    ];
    const candidates = [];
    let fallback = '';
    selectors.forEach(selector => {
      Array.from(root?.querySelectorAll?.(selector) || []).forEach(image => {
        if (!candidates.includes(image)) candidates.push(image);
      });
    });
    const wantedTitle = cleanGovDealsText(title).toLowerCase();
    for (const image of candidates) {
      const src = image?.getAttribute?.('data-src')
        || image?.getAttribute?.('data-original')
        || image?.getAttribute?.('src')
        || image?.src
        || '';
      const alt = cleanGovDealsText(image?.getAttribute?.('alt') || image?.alt || '');
      const meta = `${src} ${alt} ${image?.getAttribute?.('class') || ''}`;
      if (!src || /spacer|blank|pixel|logo|brand|favicon|icon|placeholder|allsurplus|govdeals/i.test(meta)) continue;
      if (!fallback) fallback = absoluteUrl(src, base);
      if (/webassets\.lqdt1\.com\/assets\/photos|\/assets\/photos\//i.test(src)
        || (wantedTitle && alt.toLowerCase().includes(wantedTitle.slice(0, 24)))) {
        return absoluteUrl(src, base);
      }
    }
    return fallback;
  }

  function govDealsAssetScopedRawText(root, contentRoot) {
    if (!contentRoot || contentRoot === root) return '';
    const headerSelectors = ['h1.product-title', '#currentBid', '.numberofbids', '.sales-type', '.product-location'];
    const header = headerSelectors
      .map(selector => rawTextOf(root?.querySelector?.(selector)))
      .filter(Boolean)
      .join(' ');
    const content = rawTextOf(contentRoot);
    return cleanGovDealsText(`${header} ${content}`);
  }

  function govDealsAssetDescription(raw) {
    const offered = cleanGovDealsText(raw).match(/\b(OFFERED FOR AUCTION:\s*[\s\S]*?)(?=\s+(?:Pickup|Payment|Inspection|Item Location|Current Bid|Bids?|$))/i)?.[1]?.trim();
    if (offered) return offered;
    return cleanGovDealsText(raw).match(/\bDescription\s*:?\s*([\s\S]*?)(?=\s+(?:Pickup|Payment|Inspection|Item Location|Current Bid|Bids?|$))/i)?.[1]?.trim() || '';
  }

  function extractGovDealsAssetDetail(root = document, loc = (typeof location !== 'undefined' ? location : null)) {
    const contentRoot = govDealsAssetContentRoot(root);
    const scopedRawText = govDealsAssetScopedRawText(root, contentRoot);
    const rawText = scopedRawText || textOf(root?.body || root?.documentElement || root);
    const base = loc?.href || (typeof location !== 'undefined' ? location.href : 'https://www.govdeals.com/');
    const ids = loc ? getGovDealsAssetParts(loc) : govDealsAssetPartsFromUrl(base);
    const title = pickFirstText(root, ['h1.product-title', 'h1', '[data-testid*="title"]', '.asset-title'])
      || String(root?.title || '').replace(/\s*\|\s*GovDeals.*$/i, '').trim()
      || '';
    const headerText = [
      rawTextOf(root?.querySelector?.('#currentBid')),
      rawTextOf(root?.querySelector?.('.numberofbids')),
      rawTextOf(root?.querySelector?.('.sales-type')),
      rawTextOf(root?.querySelector?.('.product-location'))
    ].filter(Boolean).join(' ');
    const parseText = cleanGovDealsText(`${headerText} ${rawText}`);
    const currentBid = govDealsCurrentBid(parseText);
    const bidCount = govDealsBidCount(parseText, true);
    const condition = govDealsConditionText(rawText);
    const sellerInfo = govDealsAssetSeller(root, base);
    const longDescription = root?.querySelector?.('.long-description');
    const description = longDescription
      ? cleanGovDealsText(rawTextOf(longDescription))
      : govDealsAssetDescription(rawText);
    const itemLocation = govDealsAssetLabeledValue(root, 'Item Location')
      || textOf(root?.querySelector?.('#lnkAssetDetailLocation'))
      || govDealsLocation(rawText);
    const pickupSource = longDescription ? description : (rawText || description);
    const specsFromDom = extractGovDealsSpecsFromDom(root);
    const specs = Object.keys(specsFromDom).length ? specsFromDom : extractGovDealsSpecs(rawText);
    const image = govDealsAssetImage(root, base, title);
    return {
      source: 'GovDeals',
      pageKind: 'govdeals-asset',
      assetId: ids.assetId,
      accountId: ids.accountId,
      lotNumber: govDealsLotNumber(rawText),
      title,
      url: base,
      image,
      seller: sellerInfo.seller,
      sellerUrl: sellerInfo.sellerUrl,
      category: '',
      status: condition,
      currentBid,
      currentBidAmount: moneyFromText(currentBid),
      bidCount,
      bidCountNumber: numberFromText(bidCount),
      closeTime: govDealsCloseTime(headerText || rawText),
      location: itemLocation,
      distanceText: govDealsDistanceText(rawText),
      shippingText: govDealsShippingText(pickupSource),
      pickupText: govDealsPickupText(pickupSource),
      condition,
      specs,
      description,
      rawText
    };
  }

  function mergeGovDealsDetail(listing, detail) {
    if (!detail) return listing;
    const next = { ...listing };
    ['image', 'description', 'location', 'shippingText', 'pickupText', 'condition', 'status', 'closeTime', 'lotNumber', 'currentBid', 'bidCount', 'seller', 'sellerUrl', 'category'].forEach(key => {
      if (!next[key] && detail[key]) next[key] = detail[key];
    });
    if (next.currentBid && next.currentBidAmount == null) next.currentBidAmount = moneyFromText(next.currentBid);
    if (next.bidCount && next.bidCountNumber == null) next.bidCountNumber = numberFromText(next.bidCount);
    next.specs = Object.keys(next.specs || {}).length ? next.specs : (detail.specs || {});
    return next;
  }

  function govDealsNeedsEnrichment(item) {
    return Boolean(item?.url && (!item.description || !item.image || !item.location || !item.status || !Object.keys(item.specs || {}).length));
  }

  async function enrichGovDealsListings(listings, onProgress = () => {}, shouldStop = () => false) {
    if (typeof fetch !== 'function' || typeof DOMParser === 'undefined') return listings;
    const out = listings.slice();
    let enriched = 0;
    for (let index = 0; index < out.length && enriched < 20; index += 1) {
      if (shouldStop()) break;
      const item = out[index];
      if (!govDealsNeedsEnrichment(item)) continue;
      let url;
      try {
        url = new URL(item.url, typeof location !== 'undefined' ? location.href : 'https://www.govdeals.com/');
      } catch {
        continue;
      }
      if (!isGovDealsHost(url.hostname)) continue;
      try {
        onProgress(`Enriching GovDeals asset ${enriched + 1}...`);
        const response = await fetch(url.href, { credentials: 'include' });
        if (!response?.ok) continue;
        const html = await response.text();
        const doc = parseAuctionNinjaHtmlDocument(html);
        const detail = doc ? extractGovDealsAssetDetail(doc, url) : null;
        out[index] = mergeGovDealsDetail(item, detail);
        enriched += 1;
      } catch (error) {
        debug('govdeals enrichment failed', { url: url.href, error: String(error) });
      }
    }
    return out;
  }

  async function scrapeGovDealsListings(onProgress = () => {}, shouldStop = () => false, root = document) {
    const loc = typeof location !== 'undefined' ? location : null;
    const route = loc ? resolveGovDealsPage(loc) : { kind: 'govdeals-new-listings' };
    const pageKind = route.kind || 'govdeals-new-listings';
    let context;
    let items;
    if (pageKind === 'govdeals-asset') {
      context = { source: 'GovDeals', pageKind, title: String(root?.title || '').replace(/\s*\|\s*GovDeals.*$/i, '').trim() || 'GovDeals Asset', url: loc?.href || '', generatedAt: new Date().toISOString() };
      items = [extractGovDealsAssetDetail(root, loc)].filter(item => item.title);
    } else if (pageKind === 'govdeals-seller') {
      context = extractGovDealsSellerContext(root, loc);
      items = extractGovDealsListings(root, loc, pageKind);
    } else {
      context = extractGovDealsSearchContext(root, loc);
      items = extractGovDealsListings(root, loc, pageKind);
    }
    if (context?.visibleCount && items.length > context.visibleCount) {
      debug('govdeals trimming extra cards to visible count', {
        before: items.length,
        visibleCount: context.visibleCount,
        kind: pageKind
      });
      items = items.slice(0, context.visibleCount);
    }
    const advertisedTotal = context?.visibleCount || null;
    onProgress(`Read ${items.length} GovDeals listing(s).`);
    const enriched = await enrichGovDealsListings(items, onProgress, shouldStop);
    debug('govdeals scrape finished', { kind: pageKind, count: enriched.length, context });
    return {
      source: 'govdeals-dom',
      items: enriched,
      listings: enriched,
      expectedTotal: enriched.length,
      context: {
        ...context,
        advertisedTotal,
        visiblePageCount: enriched.length
      },
      stopped: shouldStop(),
      stopReason: shouldStop() ? 'stopped-by-user' : (advertisedTotal && enriched.length < advertisedTotal ? 'current-visible-page-plus-safe-enrichment' : 'current-page-plus-safe-enrichment'),
      incomplete: false
    };
  }

  function mergeAuctionNinjaLots(target, lots) {
    lots.forEach(lot => {
      const key = lot.url || lot.id || lot.lot || lot.title;
      if (key && lot.title) target.set(String(key), lot);
    });
    return target;
  }

  function getAuctionNinjaBaseUrl(root = document, loc = (typeof location !== 'undefined' ? location : null)) {
    const rootUrl = typeof root?.URL === 'string' && root.URL && root.URL !== 'about:blank' ? root.URL : '';
    return rootUrl || loc?.href || (typeof location !== 'undefined' ? location.href : 'https://www.auctionninja.com/');
  }

  function getAuctionNinjaPageNumber(url) {
    try {
      const parsed = typeof url === 'string' ? new URL(url, 'https://www.auctionninja.com/') : url;
      const value = parsed.searchParams.get('Page')
        || parsed.searchParams.get('page')
        || parsed.searchParams.get('p')
        || parsed.searchParams.get('pagenum');
      const page = Number(value);
      return Number.isFinite(page) && page > 0 ? page : 1;
    } catch {
      return 1;
    }
  }

  function auctionNinjaCatalogPageUrl(base, page) {
    const url = new URL(base, 'https://www.auctionninja.com/');
    if (Number(page) <= 1) {
      url.searchParams.delete('Page');
      url.searchParams.delete('page');
      url.searchParams.delete('p');
      url.searchParams.delete('pagenum');
    } else {
      url.searchParams.set('Page', String(page));
    }
    url.hash = 'items';
    return url.href;
  }

  function getAuctionNinjaCatalogPaginationInfo(range, base) {
    const requestedPage = getAuctionNinjaPageNumber(base);
    if (!range) {
      return { currentPage: requestedPage || 1, pageSize: 40, totalPages: requestedPage || 1 };
    }

    let pageSize = Math.max(1, range.pageSize || 40);
    if (requestedPage > 1 && range.start > 1) {
      const inferred = Math.round((range.start - 1) / (requestedPage - 1));
      if (Number.isFinite(inferred) && inferred > 0) pageSize = inferred;
    }
    const currentPageFromRange = Math.floor(Math.max(0, range.start - 1) / pageSize) + 1;
    const currentPage = Math.max(1, requestedPage || currentPageFromRange, currentPageFromRange);
    const totalPages = range.total ? Math.ceil(range.total / pageSize) : currentPage;
    return { currentPage, pageSize, totalPages };
  }

  function findAuctionNinjaCatalogPageUrls(root = document, loc = (typeof location !== 'undefined' ? location : null)) {
    const base = getAuctionNinjaBaseUrl(root, loc);
    const range = parseAuctionNinjaCatalogRange(textOf(root?.body || root?.documentElement || root));
    const { currentPage, totalPages } = getAuctionNinjaCatalogPaginationInfo(range, base);
    const anchors = Array.from(root?.querySelectorAll?.('.auction-paging a[href], .paging-deta a[href], a[href*="Page="], a[href*="page="]') || []);
    const pages = new Map();

    anchors.forEach(anchor => {
      const label = controlLabel(anchor);
      const href = controlHref(anchor);
      if (!href || /product|checkout|invoice|payment|account|login|logout|watch|follow|bid now/i.test(`${href} ${label}`)) return;
      let url;
      try {
        url = new URL(href, base);
      } catch {
        return;
      }
      if (!isAuctionNinjaHost(url.hostname)) return;
      const route = resolveAuctionNinjaPage(url);
      if (!route.supported || route.kind !== 'sale-catalog') return;
      const page = getAuctionNinjaPageNumber(url);
      if (page === currentPage) return;
      pages.set(page, url.href);
    });

    if (range?.total) {
      try {
        const route = resolveAuctionNinjaPage(new URL(base));
        if (route.supported && route.kind === 'sale-catalog') {
          for (let page = 1; page <= totalPages; page += 1) {
            if (page === currentPage || pages.has(page)) continue;
            pages.set(page, auctionNinjaCatalogPageUrl(base, page));
          }
        }
      } catch {
        // URL-less test doubles and unsupported pages simply skip the fallback.
      }
    }

    const out = Array.from(pages.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, href]) => href);
    debug('auctionninja catalog page urls', { currentPage, range, urls: out.slice(0, 12) });
    return out;
  }

  function findAuctionNinjaAuctionSearchPageUrls(root = document, loc = (typeof location !== 'undefined' ? location : null)) {
    const base = getAuctionNinjaBaseUrl(root, loc);
    const anchors = Array.from(root?.querySelectorAll?.('a[href], a[onclick], button[onclick]') || []);
    const pages = new Map();
    anchors.forEach(anchor => {
      const label = controlLabel(anchor);
      const href = controlHref(anchor);
      const onclick = anchor?.getAttribute?.('onclick') || anchor?.getAttribute?.('onClick') || '';
      const joined = `${href} ${label} ${onclick}`;
      if (/bid|checkout|invoice|payment|account|login|logout|watch|follow|seller login|bidder login/i.test(joined)) return;
      let target = '';
      const paginationTarget = String(onclick || '').match(/pagination\s*\(\s*['"]([^'"]+)['"]/i)?.[1];
      if (paginationTarget) target = paginationTarget;
      else if (href && !/^javascript:/i.test(href)) target = href;
      if (!target || !/(?:marketplace_ajax|Page=|page=|pagenum=|\/auctions|\b\/[a-z]{2}\/)/i.test(target)) return;
      let url;
      try {
        url = new URL(target, base);
      } catch {
        return;
      }
      if (!isAuctionNinjaHost(url.hostname)) return;
      const page = getAuctionNinjaPageNumber(url);
      if (page <= 1 && !/Page=1|page=1|pagenum=1/i.test(url.search)) return;
      pages.set(page, url.href);
    });
    const out = Array.from(pages.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, href]) => href);
    debug('auctionninja auction-search page urls', { urls: out.slice(0, 12) });
    return out;
  }

  function parseAuctionNinjaHtmlDocument(html) {
    if (typeof DOMParser === 'undefined') return null;
    try {
      return new DOMParser().parseFromString(String(html || ''), 'text/html');
    } catch (error) {
      debug('auctionninja html parse failed', { error: String(error) });
      return null;
    }
  }

  function findAuctionNinjaNextPageControl(root = document) {
    const range = parseAuctionNinjaCatalogRange(textOf(root?.body || root?.documentElement || root));
    if (range?.complete) return null;
    const currentPage = range ? Math.ceil(range.end / Math.max(1, range.pageSize)) : 1;
    const targetPage = currentPage + 1;
    const controls = Array.from(root?.querySelectorAll?.('a, button, [role="button"], li') || []);
    const scored = controls.map(control => {
      const label = controlLabel(control);
      const href = controlHref(control);
      const className = control?.getAttribute?.('class') || '';
      let score = 0;
      if (new RegExp(`^${targetPage}$`).test(label)) score += 100;
      if (/next|›|»|→|/.test(label)) score += 80;
      if (href && /(?:page|pagenum|p)=\d+/i.test(href)) score += 20;
      if (/disabled|active/i.test(className) || control?.disabled) score -= 100;
      if (/bid|checkout|invoice|payment|account|login|logout|watch|follow|search|sort|per page/i.test(label)) score -= 80;
      return { control, label, href, score };
    }).filter(item => item.score > 0 && isVisible(item.control))
      .sort((a, b) => b.score - a.score);
    debug('auctionninja next page candidates', scored.map(item => ({ score: item.score, label: item.label, href: item.href })).slice(0, 8));
    return scored[0]?.control || null;
  }

  async function scrapeAuctionNinjaCatalogLots(onProgress = () => {}, shouldStop = () => false, root = document) {
    const lotsByKey = new Map();
    let steps = 0;
    let stopReason = '';
    let lastRange = parseAuctionNinjaCatalogRange(textOf(root?.body || root?.documentElement || root));
    const context = extractAuctionNinjaSaleContext(root);

    mergeAuctionNinjaLots(lotsByKey, extractAuctionNinjaCatalogLots(root));
    debug('auctionninja catalog scrape start', { count: lotsByKey.size, range: lastRange, context });

    const queuedPageUrls = [];
    const seenPageUrls = new Set();
    const enqueuePageUrls = (urls) => {
      urls.forEach(url => {
        if (!url || seenPageUrls.has(url)) return;
        seenPageUrls.add(url);
        queuedPageUrls.push(url);
      });
    };
    enqueuePageUrls(findAuctionNinjaCatalogPageUrls(root));

    if (queuedPageUrls.length && typeof fetch === 'function' && typeof DOMParser !== 'undefined') {
      while (queuedPageUrls.length && !shouldStop()) {
        const expectedTotal = lastRange?.total || 0;
        if (expectedTotal && lotsByKey.size >= expectedTotal) {
          stopReason = 'expected-total-reached';
          break;
        }
        if (steps >= 20) {
          stopReason = 'max-fetch-steps';
          break;
        }

        const url = queuedPageUrls.shift();
        const before = lotsByKey.size;
        steps += 1;
        onProgress(`Fetching AuctionNinja catalog page ${steps}... ${before}/${expectedTotal || '?'} lot(s)`);
        debug('auctionninja catalog page fetch start', { step: steps, url, before, expectedTotal });

        try {
          const response = await fetch(url, { credentials: 'include' });
          if (!response?.ok) {
            stopReason = `fetch-failed-${response?.status || 'unknown'}`;
            debug('auctionninja catalog page fetch failed', { step: steps, url, status: response?.status });
            break;
          }
          if (shouldStop()) break;
          const html = await response.text();
          const pageDoc = parseAuctionNinjaHtmlDocument(html);
          if (!pageDoc) {
            stopReason = 'fetch-parse-failed';
            break;
          }
          mergeAuctionNinjaLots(lotsByKey, extractAuctionNinjaCatalogLots(pageDoc, new URL(url)));
          lastRange = parseAuctionNinjaCatalogRange(textOf(pageDoc.body || pageDoc.documentElement || pageDoc)) || lastRange;
          enqueuePageUrls(findAuctionNinjaCatalogPageUrls(pageDoc, new URL(url)));
          debug('auctionninja catalog page fetch finished', { step: steps, url, before, after: lotsByKey.size, range: lastRange, queued: queuedPageUrls.length });
        } catch (error) {
          stopReason = 'fetch-threw';
          debug('auctionninja catalog page fetch threw', { step: steps, url, error: String(error) });
          break;
        }
      }

      const expectedTotal = lastRange?.total || 0;
      if (!stopReason) {
        stopReason = shouldStop()
          ? 'stopped-by-user'
          : (expectedTotal && lotsByKey.size >= expectedTotal ? 'expected-total-reached' : 'catalog-page-fetch-exhausted');
      }
    }

    while (!shouldStop()) {
      if (stopReason) break;
      const expectedTotal = lastRange?.total || 0;
      if (!expectedTotal || lotsByKey.size >= expectedTotal || lastRange?.complete) {
        stopReason = expectedTotal ? 'expected-total-reached' : 'no-expected-total';
        break;
      }
      if (steps >= 12) {
        stopReason = 'max-steps';
        break;
      }

      const next = findAuctionNinjaNextPageControl(root);
      if (!next) {
        stopReason = 'no-next-page-control';
        break;
      }

      const before = lotsByKey.size;
      const beforeRange = lastRange ? { ...lastRange } : null;
      steps += 1;
      onProgress(`Loading AuctionNinja catalog... ${before}/${expectedTotal} lot(s)`);
      debug('auctionninja next page click', { step: steps, before, beforeRange, label: controlLabel(next), href: controlHref(next) });
      next.click?.();

      let changed = false;
      for (let i = 0; i < 20; i += 1) {
        if (shouldStop()) break;
        await wait(250);
        mergeAuctionNinjaLots(lotsByKey, extractAuctionNinjaCatalogLots(root));
        lastRange = parseAuctionNinjaCatalogRange(textOf(root?.body || root?.documentElement || root)) || lastRange;
        if (lotsByKey.size > before || JSON.stringify(lastRange) !== JSON.stringify(beforeRange)) {
          changed = true;
          break;
        }
      }
      debug('auctionninja catalog step', { step: steps, before, after: lotsByKey.size, range: lastRange, changed });
      if (!changed || lotsByKey.size <= before) {
        stopReason = 'stuck-after-next-page';
        break;
      }
    }

    if (shouldStop()) stopReason = 'stopped-by-user';
    const lots = Array.from(lotsByKey.values()).sort((a, b) => String(a.lot || a.title).localeCompare(String(b.lot || b.title), undefined, {
      numeric: true,
      sensitivity: 'base'
    }));
    const expectedTotal = lastRange?.total || lots.length;
    debug('auctionninja catalog scrape finished', { lots: lots.length, expectedTotal, steps, stopReason });
    return {
      source: 'auctionninja-dom',
      items: lots,
      lots,
      expectedTotal,
      context,
      stopped: shouldStop(),
      stopReason,
      incomplete: expectedTotal ? lots.length < expectedTotal : false,
      pageSteps: steps
    };
  }

  function mergeAuctionNinjaSales(target, sales) {
    sales.forEach(sale => {
      const key = canonicalAuctionNinjaSaleUrl(sale.url) || sale.id || sale.title;
      if (key && sale.title) target.set(String(key), sale);
    });
    return target;
  }

  async function scrapeAuctionNinjaAuctionSearchSales(onProgress = () => {}, shouldStop = () => false, root = document) {
    const salesByKey = new Map();
    let steps = 0;
    let stopReason = '';
    const context = extractAuctionNinjaAuctionSearchContext(root);
    mergeAuctionNinjaSales(salesByKey, extractAuctionNinjaAuctionSearchSales(root));
    debug('auctionninja auction-search scrape start', { count: salesByKey.size, context });

    const queuedPageUrls = [];
    const seenPageUrls = new Set();
    const enqueuePageUrls = (urls) => {
      urls.forEach(url => {
        if (!url || seenPageUrls.has(url)) return;
        seenPageUrls.add(url);
        queuedPageUrls.push(url);
      });
    };
    enqueuePageUrls(findAuctionNinjaAuctionSearchPageUrls(root));

    if (queuedPageUrls.length && typeof fetch === 'function' && typeof DOMParser !== 'undefined') {
      while (queuedPageUrls.length && !shouldStop()) {
        if (steps >= 20) {
          stopReason = 'max-fetch-steps';
          break;
        }
        const expectedTotal = context.totalSales || 0;
        if (expectedTotal && salesByKey.size >= expectedTotal) {
          stopReason = 'expected-total-reached';
          break;
        }
        const url = queuedPageUrls.shift();
        const before = salesByKey.size;
        steps += 1;
        onProgress(`Fetching AuctionNinja auction page ${steps}... ${before}/${expectedTotal || '?'} sale(s)`);
        debug('auctionninja auction-search page fetch start', { step: steps, url, before, expectedTotal });
        try {
          const response = await fetch(url, { credentials: 'include' });
          if (!response?.ok) {
            stopReason = `fetch-failed-${response?.status || 'unknown'}`;
            debug('auctionninja auction-search page fetch failed', { step: steps, url, status: response?.status });
            break;
          }
          if (shouldStop()) break;
          const html = await response.text();
          const pageDoc = parseAuctionNinjaHtmlDocument(html);
          if (!pageDoc) {
            stopReason = 'fetch-parse-failed';
            break;
          }
          const pageUrl = new URL(url);
          mergeAuctionNinjaSales(salesByKey, extractAuctionNinjaAuctionSearchSales(pageDoc, pageUrl));
          enqueuePageUrls(findAuctionNinjaAuctionSearchPageUrls(pageDoc, pageUrl));
          debug('auctionninja auction-search page fetch finished', { step: steps, url, before, after: salesByKey.size, queued: queuedPageUrls.length });
        } catch (error) {
          stopReason = 'fetch-threw';
          debug('auctionninja auction-search page fetch threw', { step: steps, url, error: String(error) });
          break;
        }
      }
    }

    if (!stopReason) {
      stopReason = shouldStop()
        ? 'stopped-by-user'
        : (context.totalSales && salesByKey.size >= context.totalSales ? 'expected-total-reached' : 'visible-or-fetch-complete');
    }
    if (shouldStop()) stopReason = 'stopped-by-user';
    let sales = Array.from(salesByKey.values());
    const expectedTotal = context.totalSales || sales.length;
    const capped = trimRowsToExpectedTotal(sales, expectedTotal);
    if (capped.trimmed) {
      debug('auctionninja auction-search trimmed to expected total', {
        originalCount: capped.originalCount,
        expectedTotal,
        currentUrl: context.url || ''
      });
      sales = capped.rows;
      stopReason = 'trimmed-to-expected-total';
    }
    sales = sales.sort((a, b) => String(a.closingText || a.title).localeCompare(String(b.closingText || b.title), undefined, {
      numeric: true,
      sensitivity: 'base'
    }));
    debug('auctionninja auction-search scrape finished', { sales: sales.length, expectedTotal, steps, stopReason });
    return {
      source: 'auctionninja-auction-search-dom',
      context,
      items: sales,
      sales,
      expectedTotal,
      stopped: shouldStop(),
      stopReason,
      incomplete: context.totalSales ? sales.length < context.totalSales : false,
      pageSteps: steps
    };
  }

  function extractAuctionNinjaAccountContext(kind = 'followed-items', root = document, loc = (typeof location !== 'undefined' ? location : null)) {
    const raw = textOf(root?.body || root?.documentElement || root);
    const labels = {
      'followed-items': 'AuctionNinja Followed Items',
      'items-won': 'AuctionNinja Items Won',
      'bid-history': 'AuctionNinja Bid History'
    };
    const title = String(root?.title || '')
      .replace(/\s*\|\s*AuctionNinja.*$/i, '')
      .trim()
      || raw.match(/\b(Items\s+(?:I am following|Won)|Followed\s+Items)\b/i)?.[1]
      || labels[kind]
      || 'AuctionNinja Account Export';
    return {
      source: 'AuctionNinja',
      pageKind: kind,
      title,
      url: loc?.href || (typeof location !== 'undefined' ? location.href : ''),
      generatedAt: new Date().toISOString()
    };
  }

  async function scrapeAuctionNinjaAccountItems(kind = 'followed-items', onProgress = () => {}, shouldStop = () => false, root = document) {
    const normalizedKind = kind === 'items-won' || kind === 'bid-history' ? kind : 'followed-items';
    const context = extractAuctionNinjaAccountContext(normalizedKind, root);
    if (shouldStop()) {
      return {
        source: 'auctionninja-account-dom',
        context,
        items: [],
        expectedTotal: 0,
        stopped: true,
        stopReason: 'stopped-by-user'
      };
    }

    onProgress(`Reading AuctionNinja ${normalizedKind === 'items-won' ? 'won items' : (normalizedKind === 'bid-history' ? 'bid history' : 'followed items')}...`);
    const items = normalizedKind === 'items-won'
      ? extractAuctionNinjaWonItems(root)
      : (normalizedKind === 'bid-history' ? extractAuctionNinjaBidHistoryItems(root) : extractAuctionNinjaFollowedItems(root));
    const stopReason = items.length ? 'visible-dom-complete' : 'no-account-items-found';
    debug('auctionninja account scrape finished', {
      kind: normalizedKind,
      count: items.length,
      stopReason,
      title: context.title || ''
    });
    return {
      source: 'auctionninja-account-dom',
      context,
      items,
      expectedTotal: items.length,
      stopped: shouldStop(),
      stopReason,
      incomplete: false
    };
  }

  function resolveHiBidPage(loc = location) {
    const host = String(loc.hostname || '').toLowerCase();
    const search = String(loc.search || '');
    const parts = pathSegments(loc);

    if (!isHiBidHost(host)) {
      return { supported: false, kind: 'unsupported', host, reason: 'unsupported host' };
    }

    const accountIndex = parts[0] === 'account' ? 0 : (parts[1] === 'account' ? 1 : -1);
    const statePrefix = accountIndex === 1 ? parts[0] : '';

    if (accountIndex >= 0 && parts[accountIndex + 1] === 'watchlist') {
      return /status=OUTBID/i.test(search)
        ? { supported: true, kind: 'watchlist-outbid', host, statePrefix, reason: 'outbid watchlist route' }
        : { supported: true, kind: 'watchlist', host, statePrefix, reason: 'watchlist route' };
    }

    if (accountIndex >= 0 && parts[accountIndex + 1] === 'currentbids') {
      const status = String(
        loc.searchParams?.get?.('status')
        || search.match(/[?&]status=([^&]+)/i)?.[1]
        || ''
      ).trim().toUpperCase();
      if (status === 'WINNING') {
        return { supported: true, kind: 'currentbids-winning', host, statePrefix, status, reason: 'winning current bids route' };
      }
      if (status === 'OUTBID') {
        return { supported: true, kind: 'currentbids-outbid', host, statePrefix, status, reason: 'outbid current bids route' };
      }
      return { supported: false, kind: 'currentbids', host, statePrefix, status, reason: 'current bids status is not WINNING or OUTBID' };
    }

    if (parts[0] === 'livecatalog') {
      return { supported: true, kind: 'live', host, auctionId: parts[1] || '', reason: 'livecatalog route' };
    }

    if (parts[0] === 'catalog') {
      return { supported: true, kind: 'catalog', host, auctionId: parts[1] || '', reason: 'catalog route' };
    }

    if (parts[0] === 'lots' || parts[0] === 'lot') {
      return {
        supported: true,
        kind: parts[0] === 'lot' ? 'lot' : 'catalog',
        host,
        auctionId: parts[1] || '',
        reason: `${parts[0]} route`
      };
    }

    if (parts[1] === 'lots' || parts[1] === 'lot') {
      return {
        supported: true,
        kind: parts[1] === 'lot' ? 'lot' : 'catalog',
        host,
        statePrefix: parts[0] || '',
        auctionId: parts[2] || '',
        reason: `state-prefixed ${parts[1]} route`
      };
    }

    return { supported: false, kind: 'unsupported', host, reason: 'unsupported HiBid path' };
  }

  function isWatchlistOutbidPage(loc = location) {
    return resolveHiBidPage(loc).kind === 'watchlist-outbid';
  }

  function isLiveCatalogPage(loc = location) {
    return resolveHiBidPage(loc).kind === 'live';
  }

  function isFlipTrackerListingPage(loc = location) {
    const host = String(loc.hostname || '').toLowerCase();
    const pathname = String(loc.pathname || '');
    if (host === 'www.ebay.com') {
      return /^\/sh\/lst\b/i.test(pathname) || /^\/mys\//i.test(pathname);
    }
    if (host === 'www.facebook.com' || host === 'facebook.com') {
      return /^\/marketplace\/(?:you|profile)\b/i.test(pathname);
    }
    return false;
  }

  function resolveFlipTrackerPage(loc = location) {
    const host = String(loc.hostname || '').toLowerCase();
    const pathname = String(loc.pathname || '');
    if (host === 'www.ebay.com' && (/^\/sh\/lst\b/i.test(pathname) || /^\/mys\//i.test(pathname))) {
      return { supported: true, kind: 'fliptracker-ebay', source: 'ebay', host, reason: 'eBay active listing export route' };
    }
    if ((host === 'www.facebook.com' || host === 'facebook.com') && /^\/marketplace\/(?:you|profile)\b/i.test(pathname)) {
      return { supported: true, kind: 'fliptracker-facebook', source: 'facebook', host, reason: 'Facebook Marketplace listing export route' };
    }
    return { supported: false, kind: 'unsupported', source: 'unknown', host, reason: 'unsupported FlipTracker listing route' };
  }

  function shouldInitOnLocation(loc = location) {
    const host = String(loc.hostname || '').toLowerCase();
    const pathname = String(loc.pathname || '');

    if (host === 'bid.ajwillnerauctions.com') {
      return /^\/ui\/auctions\//i.test(pathname);
    }

    if (isFlipTrackerListingPage(loc)) return true;

    if (isAuctionNinjaHost(host)) return resolveAuctionNinjaPage(loc).supported;

    if (isAarAuctionsHost(host)) return resolveAarAuctionsPage(loc).supported;

    if (isGovDealsHost(host)) return resolveGovDealsPage(loc).supported;

    if (isHiBidHost(host)) return resolveHiBidPage(loc).supported;
    return false;
  }

  function resolveAssistantMode(loc = location) {
    const host = String(loc.hostname || '').toLowerCase();
    if (host === 'bid.ajwillnerauctions.com' && /^\/ui\/auctions\//i.test(loc.pathname || '')) {
      return {
        supported: true,
        mode: 'catalog',
        source: 'ajwillner',
        reason: 'AJ Willner auction route',
        route: { supported: true, kind: 'catalog', source: 'ajwillner', host, auctionId: getAjWillnerAuctionId(loc), reason: 'AJ Willner auction route' }
      };
    }

    if (isFlipTrackerListingPage(loc)) {
      const route = resolveFlipTrackerPage(loc);
      return { supported: true, mode: 'fliptracker', source: route.source, reason: route.reason, route };
    }

    if (isAuctionNinjaHost(host)) {
      const route = resolveAuctionNinjaPage(loc);
      return route.supported
        ? { supported: true, mode: 'auctionninja', source: 'auctionninja', reason: route.reason, route }
        : { supported: false, mode: 'unsupported', source: 'auctionninja', reason: route.reason, route };
    }

    if (isAarAuctionsHost(host)) {
      const route = resolveAarAuctionsPage(loc);
      return route.supported
        ? { supported: true, mode: 'aar', source: 'aar', reason: route.reason, route }
        : { supported: false, mode: 'unsupported', source: 'aar', reason: route.reason, route };
    }

    if (isGovDealsHost(host)) {
      const route = resolveGovDealsPage(loc);
      return route.supported
        ? { supported: true, mode: 'govdeals', source: 'govdeals', reason: route.reason, route }
        : { supported: false, mode: 'unsupported', source: 'govdeals', reason: route.reason, route };
    }

    if (isHiBidHost(host)) {
      const route = resolveHiBidPage(loc);
      if (!route.supported) return { supported: false, mode: 'unsupported', source: 'hibid', reason: route.reason, route };
      if (route.kind === 'live') return { supported: true, mode: 'live', source: 'hibid', reason: route.reason, route };
      return { supported: true, mode: 'catalog', source: 'hibid', reason: route.reason, route };
    }

    return { supported: false, mode: 'unsupported', source: 'unknown', reason: 'unsupported host', route: null };
  }

  function getLoadTarget(options = {}, loc = location) {
    const onOutbidWatchlist = /\/account\/watchlist/i.test(loc.pathname || '') && /status=OUTBID/i.test(loc.search || '');
    if (options.requireOutbid && !onOutbidWatchlist) return OUTBID_WATCHLIST_URL;
    return null;
  }

  function scanPlan(plan, options = {}, cachedLots = []) {
    const lots = uniqueLots(getLotTiles().map(extractLot));
    if (!lots.length) lots.push(...extractTextLots());
    const byLot = new Map(cachedLots.concat(lots).filter(lot => lot?.lot).map(lot => [String(lot.lot), lot]));
    const rows = [];
    const plannedLots = new Set(Object.keys(plan).map(String));

    Object.entries(plan).forEach(([lotNumber, entry]) => {
      const lot = byLot.get(String(lotNumber));
      if (!lot) {
        rows.push({ lot: lotNumber, title: entry.title || '', max: entry.max, status: 'not found', eligible: false });
        return;
      }

      const decision = evaluateLot(lot, entry, options);
      rows.push({ ...lot, max: entry.max, expectedTitle: entry.title, ...decision });
    });

    if (options.includeUnplanned) {
      byLot.forEach((lot, lotNumber) => {
        if (plannedLots.has(String(lotNumber))) return;
        rows.push({ ...lot, max: '', status: 'loaded from OUTBID - add max', eligible: false });
      });
    }

    rows.sort((a, b) => {
      if (a.eligible !== b.eligible) return a.eligible ? -1 : 1;
      return Number(a.lot || 0) - Number(b.lot || 0);
    });
    return rows;
  }

  async function findLotOnPage(lotNumber, status, shouldStop = () => false) {
    const wanted = String(lotNumber);
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    await wait(350);

    let lastScrollY = -1;
    let stuck = 0;
    for (let i = 0; i < 350; i += 1) {
      if (shouldStop()) return null;
      const lot = uniqueLots(getLotTiles().map(extractLot)).find(item => String(item.lot) === wanted);
      if (lot?.tile) return lot;

      const scrollY = Math.round(window.scrollY || document.documentElement.scrollTop || 0);
      const maxScrollY = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
      if (scrollY >= Math.max(0, maxScrollY - 2) && scrollY === lastScrollY) stuck += 1;
      else stuck = 0;
      if (stuck >= 3) break;
      lastScrollY = scrollY;
      status(`Searching visible list for Lot ${wanted}...`);
      window.scrollBy({ top: Math.max(650, Math.floor(window.innerHeight * 0.85)), left: 0, behavior: 'instant' });
      await wait(180);
    }

    return null;
  }

  function extractTextLots(root = document) {
    const text = textOf(root.body || root.documentElement || root);
    const chunks = text.split(/(?=\bLot\s*#?\s*:?\s*\d+[A-Za-z-]*\b\s*(?:\||[-:]|\s+[A-Z0-9]))/i);

    return chunks.map(chunk => {
      const firstLine = chunk.match(/\bLot\s*#?\s*:?\s*(\d+[A-Za-z-]*)\s*(?:\||[-:])?\s*([\s\S]*?)(?=\s+(?:Unwatch|Watch|Notes|READ DESCRIPTION|Current Bid|High Bid|Price Realized|Bidding Closed|Sold For|Lot Won|Starting Bid|Opening Bid|\d+\s+Bids?\b|Bid\s+[\d,.]+\s*USD)|$)/i);
      if (!firstLine) return null;

      const highBid = chunk.match(/(?:High Bid|Current Bid|Price Realized|Lot Won|Sold For):?\s*\$?\s*([\d,.]+\s*(?:USD)?(?:\s*\/\s*(?:Lot|ea))?)/i)?.[1] || '';
      const nextBid = chunk.match(/\bBid\s+([\d,.]+\s*USD)\b/i)?.[1] || '';
      const bidCount = chunk.match(/\b\d+\s+Bids?\b/i)?.[0] || '';
      const status = extractUserBidStatus(chunk) || (/\bWon\b/i.test(chunk) ? 'Won' : '');

      return {
        tile: null,
        bidButton: null,
        id: firstLine[1],
        lot: firstLine[1],
        title: firstLine[2].replace(/\s+/g, ' ').trim(),
        url: '',
        highBid: highBid ? `High Bid: ${highBid}` : '',
        highBidAmount: moneyFromText(highBid),
        bidCount,
        bidCountNumber: numberFromText(bidCount),
        timeLeft: '',
        nextBid,
        nextBidAmount: moneyFromText(nextBid),
        description: chunk.match(/(?:Description|Features and Notes|Auctioneer'?s Note)\s*:?\s*([\s\S]*?)(?=\s+(?:High Bid|Current Bid|Price Realized|Bidding Closed|Sold For|Lot Won|Starting Bid|Opening Bid|\d+\s+Bids?\b|$))/i)?.[1]?.trim() || '',
        rawText: chunk,
        userBidStatus: status,
        isWinning: status === 'Winning',
        isOutbid: status === 'Outbid',
        statusClass: 'text-fallback'
      };
    }).filter(Boolean);
  }

  function cleanLiveTitle(value) {
    return String(value || '')
      .replace(/\s*(?:Current Bid|High Bid|Asking Bid|Next Bid|Min(?:imum)? Bid|Bid\s+[\d,.]+\s*USD|Bidding Closed|Opening Bid|Price Realized).*$/i, '')
      .replace(/\s+\d+\s+Bids?\s*$/i, '')
      .trim();
  }

  function extractLiveAuctionState(root = document) {
    const source = root.body || root.documentElement || root;
    const text = textOf(source);
    const lotMatch = text.match(/\bLot\s+(\d+[A-Za-z-]*)\s*(?:\||-|:)?\s*([\s\S]*?)(?=\s+(?:Current Bid|High Bid|Asking Bid|Next Bid|Min(?:imum)? Bid|Bid\s+[\d,.]+\s*USD|Bidding Closed|Opening Bid|Price Realized)|$)/i);
    const currentBid = text.match(/(?:Current Bid|High Bid|Price Realized):?\s*([\d,.]+\s*USD)/i)?.[1] || '';
    const bidCount = text.match(/\b\d+\s+Bids?\b/i)?.[0] || '';
    const explicitNext = text.match(/(?:Next Bid|Asking Bid|Min(?:imum)? Bid):?\s*([\d,.]+\s*USD)/i)?.[1] || '';
    const bidButton = findLiveBidButton(root);
    const buttonLabelText = controlLabel(bidButton);
    const buttonNext = buttonLabelText.match(/\bBid\s+([\d,.]+\s*USD)\b/i)?.[1] || '';
    const nextBid = explicitNext || buttonNext;
    const state = {
      root,
      lot: lotMatch?.[1] || '',
      title: cleanLiveTitle(lotMatch?.[2] || ''),
      highBid: currentBid ? `High Bid: ${currentBid}` : '',
      currentBid: currentBid ? `Current Bid: ${currentBid}` : '',
      currentBidAmount: moneyFromText(currentBid),
      nextBid: nextBid ? `Bid ${nextBid}` : '',
      nextBidAmount: moneyFromText(nextBid),
      bidCount,
      bidCountNumber: numberFromText(bidCount),
      bidButton,
      isLive: true
    };

    debug('live state extracted', {
      lot: state.lot,
      title: state.title,
      currentBidAmount: state.currentBidAmount,
      nextBidAmount: state.nextBidAmount,
      bidCount: state.bidCount,
      hasBidButton: Boolean(state.bidButton),
      bidButtonLabel: buttonLabelText
    });

    return state;
  }

  function extractLivePageLots(root = document) {
    const text = textOf(root.body || root.documentElement || root);
    const chunks = text.split(/(?=Lot\s+\d+[A-Za-z-]*\s*\|)/i);
    return chunks.map(chunk => {
      const firstLine = chunk.match(/Lot\s+(\d+[A-Za-z-]*)\s*\|\s*([\s\S]*?)(?=\s+(?:Watch|Unwatch|High Bid:|Current Bid:|Price Realized:|Bidding Closed|Bid\s+[\d,.]+\s*USD)|$)/i);
      if (!firstLine) return null;
      const highBid = chunk.match(/(?:High Bid|Current Bid|Price Realized):\s*([\d,.]+\s*USD)/i)?.[1] || '';
      const nextBid = chunk.match(/\bBid\s+([\d,.]+\s*USD)\b/i)?.[1] || '';
      const bidCount = chunk.match(/\b\d+\s+Bids?\b/i)?.[0] || '';
      const timeLeft = chunk.match(/\b\d+\s*(?:d|h|m|s)\b/i)?.[0] || '';
      const valueHint = chunk.match(/(?:High Bid|Current Bid):\s*[\d,.]+\s*USD\s+([\d,.]+\s*USD)/i)?.[1] || '';
      const userBidStatus = extractUserBidStatus(chunk);
      const lot = firstLine[1];
      return {
        source: 'hibid',
        pageKind: 'live',
        id: lot,
        lot,
        title: firstLine[2].replace(/\s+/g, ' ').trim(),
        highBid: highBid ? `High Bid: ${highBid}` : '',
        highBidAmount: moneyFromText(highBid),
        estimatedValue: moneyFromText(valueHint),
        bidCount,
        bidCountNumber: numberFromText(bidCount),
        timeLeft,
        nextBid: nextBid ? `Bid ${nextBid}` : '',
        nextBidAmount: moneyFromText(nextBid),
        userBidStatus,
        status: /bidding closed/i.test(chunk) ? 'Bidding Closed' : (/incoming bid/i.test(chunk) ? 'Incoming Bid' : ''),
        rawText: chunk.replace(/\s+/g, ' ').trim().slice(0, 1200)
      };
    }).filter(Boolean);
  }

  function liveAuctionContext(root = document) {
    const text = textOf(root.body || root.documentElement || root);
    return {
      source: 'hibid',
      pageKind: 'live',
      title: text.match(/\bThe Luxe Edit\b/i)?.[0] || document.title || '',
      url: location.href,
      totalLots: numberFromText(text.match(/Total Lots:\s*([\d,]+)/i)?.[1] || ''),
      openLots: numberFromText(text.match(/Open Lots:\s*([\d,]+)/i)?.[1] || '')
    };
  }

  function catalogAuctionContext(root = document) {
    const loc = typeof location !== 'undefined' ? location : null;
    const isAjWillner = loc && isAjWillnerHost(loc.hostname);
    const route = loc
      ? (isAjWillner ? resolveAssistantMode(loc).route : resolveHiBidPage(loc))
      : null;
    return {
      title: (typeof document !== 'undefined' ? document.title : '') || textOf(root.querySelector?.('h1')) || '',
      url: loc ? loc.href : '',
      route,
      source: isAjWillner ? 'ajwillner' : 'hibid',
      totalLots: isAjWillner ? getAjWillnerExpectedTotal(root, findAjWillnerScrollContainer(root)) : getExpectedLotTotal(root),
      openLots: null
    };
  }

  function mergeLiveLots(target, lots) {
    lots.forEach(lot => {
      if (!lot?.lot) return;
      target.set(String(lot.lot), lot);
    });
  }

  function scrollLiveLots(root = document) {
    const doc = root?.nodeType === 9 ? root : document;
    const win = doc?.defaultView || (typeof window !== 'undefined' ? window : null);
    const scroller = root?.documentElement || doc?.documentElement;
    const body = root?.body || doc?.body;
    if (win?.scrollBy) {
      win.scrollBy({ top: Math.max(700, Math.floor((win.innerHeight || 900) * 0.85)), left: 0, behavior: 'instant' });
      return true;
    }
    if (scroller) {
      scroller.scrollTop = (scroller.scrollTop || 0) + 700;
      return true;
    }
    if (body) {
      body.scrollTop = (body.scrollTop || 0) + 700;
      return true;
    }
    return false;
  }

  async function expandLivePageLots(onProgress = () => {}, shouldStop = () => false, root = document, options = {}) {
    const maxSteps = options.maxSteps ?? 80;
    const waitMs = options.waitMs ?? 350;
    const lotsById = new Map();
    const context = liveAuctionContext(root);
    const expectedOpenLots = context.openLots || 0;
    let lastCount = -1;
    let stuckSteps = 0;
    let loadMoreClicks = 0;
    let scrolls = 0;

    for (let step = 0; step < maxSteps; step += 1) {
      mergeLiveLots(lotsById, extractLivePageLots(root));
      const countText = expectedOpenLots ? `${lotsById.size}/${expectedOpenLots}` : String(lotsById.size);
      onProgress(`Loading live lots... ${countText}`);
      debug('live expansion step', { step, lots: lotsById.size, expectedOpenLots, loadMoreClicks, scrolls });

      if (shouldStop()) {
        debug('live expansion stopped by user', { lots: lotsById.size });
        break;
      }
      if (expectedOpenLots && lotsById.size >= expectedOpenLots) break;

      const loadMoreButton = findLiveLoadMoreButton(root);
      if (loadMoreButton) {
        const label = controlLabel(loadMoreButton);
        loadMoreButton.scrollIntoView?.({ block: 'center', inline: 'nearest' });
        loadMoreButton.click();
        loadMoreClicks += 1;
        debug('live load-more clicked', { label, loadMoreClicks });
        await wait(waitMs);
        continue;
      }

      const didScroll = scrollLiveLots(root);
      if (didScroll) scrolls += 1;
      await wait(waitMs);
      mergeLiveLots(lotsById, extractLivePageLots(root));

      if (lotsById.size === lastCount) {
        stuckSteps += 1;
      } else {
        stuckSteps = 0;
        lastCount = lotsById.size;
      }

      if (stuckSteps >= 4) {
        debug('live expansion stopped after no new lots', { lots: lotsById.size, expectedOpenLots, loadMoreClicks, scrolls });
        break;
      }
    }

    mergeLiveLots(lotsById, extractLivePageLots(root));
    const lots = Array.from(lotsById.values()).sort((a, b) => String(a.lot).localeCompare(String(b.lot), undefined, {
      numeric: true,
      sensitivity: 'base'
    }));
    const incomplete = Boolean(expectedOpenLots && lots.length < expectedOpenLots);
    return {
      source: 'hibid-live-dom',
      context,
      lots,
      items: lots,
      expectedTotal: expectedOpenLots || null,
      expectedOpenLots,
      incomplete,
      stopReason: incomplete ? 'below-expected-open-lots' : 'complete',
      loadMoreClicks,
      scrolls
    };
  }

  function buildLlmAuctionBrief(lots, context = liveAuctionContext()) {
    const fullLots = lots.map(lot => ({
      source: lot.source || '',
      id: lot.id ?? '',
      lot: lot.lot,
      title: lot.title,
      url: lot.url || '',
      image: lot.image || '',
      description: lot.description || '',
      highBid: lot.highBid || '',
      highBidAmount: lot.highBidAmount ?? null,
      currentPrice: lot.currentPrice ?? null,
      currentBid: lot.currentBid ?? null,
      nextBid: lot.nextBid || '',
      nextBidAmount: lot.nextBidAmount ?? null,
      bidCount: lot.bidCount || '',
      bidCountNumber: lot.bidCountNumber ?? null,
      timeLeft: lot.timeLeft || '',
      valueHint: lot.estimatedValue ?? null,
      status: lot.status || lot.userBidStatus || '',
      userBidStatus: lot.userBidStatus || '',
      isWinning: Boolean(lot.isWinning),
      isOutbid: Boolean(lot.isOutbid),
      watched: Boolean(lot.watched),
      pictureCount: lot.pictureCount ?? null,
      auctionTitle: lot.auctionTitle || '',
      buyerPremium: lot.buyerPremium || '',
      rawText: lot.rawText || ''
    }));
    return [
      AUCTION_RESALE_COORDINATOR_PROMPT,
      '',
      'Parsed auction context:',
      JSON.stringify(context, null, 2),
      '',
      `Lots scraped: ${fullLots.length}`,
      '',
      'Full lot data JSON:',
      JSON.stringify(fullLots, null, 2)
    ].join('\n');
  }

  function buildAuctionNinjaLlmBrief(lots, context = extractAuctionNinjaSaleContext()) {
    const saleTerms = [
      'AuctionNinja sale terms:',
      `Title: ${context.title || ''}`,
      `Seller: ${context.seller || ''}`,
      `Location: ${context.location || ''}`,
      `Buyer premium: ${context.buyerPremium || ''}`,
      `Pickup window: ${context.pickupWindow || ''}`,
      `Shipping: ${context.shipping || ''}`,
      `Special instructions: ${context.specialInstructions || ''}`,
      '',
      'AuctionNinja safety boundary: this export is for resale research and planning only. Do not click bid, submit, checkout, invoice, payment, or account controls from this brief.',
      'For this site, sold/completed comps first, profit second, hunches last. Apply buyer premium, sales tax, pickup friction, and sedan/logistics risk before recommending max bids.'
    ].join('\n');

    return [
      AUCTION_RESALE_COORDINATOR_PROMPT,
      '',
      saleTerms,
      '',
      'Parsed auction context:',
      JSON.stringify(context, null, 2),
      '',
      `Lots scraped: ${lots.length}`,
      '',
      'Full lot data JSON:',
      JSON.stringify(lots, null, 2)
    ].join('\n');
  }

  function buildAuctionNinjaAccountLlmBrief(items, context = {}, kind = 'followed-items') {
    const pageKind = kind === 'items-won' || kind === 'bid-history' ? kind : 'followed-items';
    const task = pageKind === 'items-won'
      ? [
        'AuctionNinja account task: post-win inventory and resale planning.',
        'Prioritize listing priority, expected resale range, pickup/shipping logistics, profitability after buyer premium and tax, and reconciliation against what was actually won.'
      ]
      : (pageKind === 'bid-history'
        ? [
          'AuctionNinja account task: bid history review for resale decision feedback.',
          'Find missed opportunities, overbid risks, recurring sellers/categories worth watching, and whether past max bids matched sold comps and profit thresholds.'
        ]
      : [
        'AuctionNinja account task: active opportunity review for watched/followed items.',
        'Review current bid versus profit threshold, pickup/logistics risk, sedan-fit risk, and sold comps first before calling anything a buy.'
      ]);
    const boundary = [
      'AuctionNinja account safety boundary:',
      'Do not bid from this brief. Do not click bid, checkout, invoice, payment, settings, or account-changing controls.',
      'Use this export only for resale analysis, planning, listing prep, and manual decision support.'
    ].join('\n');

    return [
      AUCTION_RESALE_COORDINATOR_PROMPT,
      '',
      ...task,
      '',
      boundary,
      '',
      'AuctionNinja account context:',
      JSON.stringify(context, null, 2),
      '',
      `Items exported: ${items.length}`,
      '',
      'AuctionNinja account item JSON:',
      JSON.stringify({ context, items }, null, 2)
    ].join('\n');
  }

  function buildAuctionNinjaFollowedItemsLlmBrief(items, context = extractAuctionNinjaAccountContext('followed-items')) {
    return buildAuctionNinjaAccountLlmBrief(items, { ...context, pageKind: 'followed-items' }, 'followed-items');
  }

  function buildAuctionNinjaWonItemsLlmBrief(items, context = extractAuctionNinjaAccountContext('items-won')) {
    return buildAuctionNinjaAccountLlmBrief(items, { ...context, pageKind: 'items-won' }, 'items-won');
  }

  function buildAuctionNinjaBidHistoryLlmBrief(items, context = extractAuctionNinjaAccountContext('bid-history')) {
    return buildAuctionNinjaAccountLlmBrief(items, { ...context, pageKind: 'bid-history' }, 'bid-history');
  }

  function buildAuctionNinjaAuctionSearchLlmBrief(sales, context = extractAuctionNinjaAuctionSearchContext()) {
    const searchTerms = [
      'AuctionNinja auction-search task: whole-auction triage.',
      'Rank sales by resale potential before drilling into lots. Favor auctions likely to contain portable, underpriced, searchable goods with enough item count and pickup/shipping terms to justify attention.',
      'Use sold/completed comps first, profit second, hunches last. Consider buyer premium uncertainty, travel time, local pickup limits, shipping availability, sedan/logistics risk, and time left before recommending which auction pages to open next.',
      '',
      'AuctionNinja auction-search safety boundary: this export is for resale research and planning only. Do not click bid, submit, checkout, invoice, payment, settings, or account-changing controls from this brief.'
    ].join('\n');

    return [
      AUCTION_RESALE_COORDINATOR_PROMPT,
      '',
      searchTerms,
      '',
      'AuctionNinja auction-search context:',
      JSON.stringify(context, null, 2),
      '',
      `Sales exported: ${sales.length}`,
      '',
      'AuctionNinja auction-search sale JSON:',
      JSON.stringify({ context, sales }, null, 2)
    ].join('\n');
  }

  function buildAuctionNinjaCategoryLlmBrief(items, context = extractAuctionNinjaCategoryContext()) {
    const categoryTerms = [
      'AuctionNinja category-search task: item-level resale triage.',
      `Category: ${context.category || context.categorySlug || ''}`,
      `Location filter: ${context.zip ? `ZIP ${context.zip}` : 'not provided'}${context.miles ? ` within ${context.miles} miles` : ''}.`,
      'Read each item title, image, current price, seller/location, shipping signal, and time left before ranking it.',
      'Use sold/completed comps first, profit second, hunches last. Treat category pages as discovery data and open the product detail page when description, condition, model, or photos are needed.',
      '',
      'AuctionNinja category-search safety boundary: this export is for resale research only. Do not click bid, submit, follow, checkout, invoice, payment, settings, or account-changing controls from this brief.'
    ].join('\n');

    return [
      AUCTION_RESALE_COORDINATOR_PROMPT,
      '',
      categoryTerms,
      '',
      'AuctionNinja category-search context:',
      JSON.stringify(context, null, 2),
      '',
      `Items exported: ${items.length}`,
      '',
      'AuctionNinja category item JSON:',
      JSON.stringify({ context, items }, null, 2)
    ].join('\n');
  }

  function buildAarDistanceResearchBlock(settings = getAarResearchSettings()) {
    const origin = String(settings?.originLabel || defaultAarResearchSettings().originLabel).trim();
    const radius = Number(settings?.radiusMiles) || defaultAarResearchSettings().radiusMiles;
    return [
      'AAR Auctions distance research requirement:',
      `Origin: ${origin}`,
      `Radius: ${radius} miles`,
      'Distance Agent: assign one research lane/subagent to verify every auction location and every recommended lead against this origin/radius using live map/search results, not assumptions.',
      'Do not recommend an AAR auction or lot as a buy unless its pickup/location is proven within the configured radius, shipping is explicitly available, or it is marked needs_distance_verification.',
      'For the spreadsheet, add and fill these columns: distance_miles, distance_proof_url, distance_status, assigned_agent.',
      'Valid distance_status values: in_range, out_of_range, shipping_available, needs_distance_verification.'
    ].join('\n');
  }

  function buildAarAuctionListLlmBrief(sales, context = {}, settings = getAarResearchSettings()) {
    const ctx = { ...context, researchSettings: settings };
    return [
      AUCTION_RESALE_COORDINATOR_PROMPT,
      '',
      'AAR Auctions task: auction-calendar triage before drilling into catalogs.',
      'Rank auctions by likely resale opportunity, enough lot volume, pickup practicality, shipping availability, and time remaining.',
      'Use sold/completed comps first, profit second, hunches last.',
      '',
      buildAarDistanceResearchBlock(settings),
      '',
      'AAR auction-calendar context:',
      JSON.stringify(ctx, null, 2),
      '',
      `Auctions exported: ${sales.length}`,
      '',
      'AAR auction-calendar JSON:',
      JSON.stringify({ context: ctx, sales }, null, 2)
    ].join('\n');
  }

  function buildAarCatalogLlmBrief(lots, context = {}, settings = getAarResearchSettings()) {
    const ctx = { ...context, researchSettings: settings };
    const saleTerms = [
      'AAR Auctions sale terms:',
      `Title: ${context.title || ''}`,
      `Auction ID: ${context.auctionId || ''}`,
      `Buyer premium: ${context.buyerPremium || ''}`,
      `Pickup: ${context.pickupText || ''}`,
      `Payment: ${context.paymentText || ''}`,
      `Location: ${context.location || ''}`,
      `Directions/map proof seed: ${context.directionsUrl || context.mapSearchUrl || ''}`,
      '',
      'AAR safety boundary: this export is for resale research and planning only. Do not click bid, register, payment, invoice, login, or account controls from this brief.'
    ].join('\n');
    return [
      AUCTION_RESALE_COORDINATOR_PROMPT,
      '',
      saleTerms,
      '',
      buildAarDistanceResearchBlock(settings),
      '',
      'Parsed AAR auction context:',
      JSON.stringify(ctx, null, 2),
      '',
      `Lots scraped: ${lots.length}`,
      '',
      'Full AAR lot data JSON:',
      JSON.stringify({ context: ctx, lots }, null, 2)
    ].join('\n');
  }

  function buildGovDealsDistanceResearchBlock(settings = getAarResearchSettings(), context = {}) {
    const origin = String(settings?.originLabel || defaultAarResearchSettings().originLabel).trim();
    const radius = Number(settings?.radiusMiles) || defaultAarResearchSettings().radiusMiles;
    const urlZip = context?.zipcode ? `GovDeals URL zipcode filter: ${context.zipcode}` : '';
    const urlMiles = context?.miles ? `GovDeals URL radius filter: ${context.miles} miles` : '';
    return [
      'GovDeals distance research requirement:',
      `Shared origin: ${origin}`,
      `Shared radius: ${radius} miles`,
      urlZip,
      urlMiles,
      'Distance Agent: verify every recommended GovDeals asset location against the shared origin and any URL zipcode/miles filter using live map/search proof, not assumptions.',
      'Do not recommend a GovDeals listing as a buy unless pickup is proven in range, shipping is explicitly available, or distance_status is marked needs_distance_verification.',
      'For spreadsheet output, add and fill: distance_miles, distance_proof_url, distance_status, assigned_agent.',
      'Valid distance_status values: in_range, out_of_range, shipping_available, needs_distance_verification.'
    ].filter(Boolean).join('\n');
  }

  function buildGovDealsLlmBrief(listings, context = {}, settings = getAarResearchSettings()) {
    const ctx = { ...context, researchSettings: settings };
    const taskLabel = context.pageKind === 'govdeals-seller'
      ? 'GovDeals seller task: triage one seller/storefront for resale opportunities before opening individual assets.'
      : (context.pageKind === 'govdeals-asset'
        ? 'GovDeals asset task: analyze this asset for resale value, logistics risk, and max-buy guidance.'
        : 'GovDeals new-listings task: triage nearby/new GovDeals listings for resale opportunities.');
    return [
      AUCTION_RESALE_COORDINATOR_PROMPT,
      '',
      taskLabel,
      'Use sold/completed comps first, profit second, hunches last. Apply buyer premium, taxes, payment/pickup rules, seller terms, shipping availability, travel time, and sedan/logistics risk before recommending a buy.',
      '',
      'GovDeals safety boundary: this export is for resale research and planning only. Do not click bid, offer, cart, checkout, payment, registration, login, invoice, or account-changing controls from this brief.',
      '',
      buildGovDealsDistanceResearchBlock(settings, context),
      '',
      'GovDeals context:',
      JSON.stringify(ctx, null, 2),
      '',
      `GovDeals listings exported: ${listings.length}`,
      '',
      'GovDeals listing JSON:',
      JSON.stringify({ context: ctx, listings }, null, 2)
    ].join('\n');
  }

  function installAssistantCatalogScraperButton(status = () => {}) {
    const buttonId = 'hibid-scraper-copy-button';
    const fallbackId = 'hibid-scraper-json';
    const state = { running: false, stopRequested: false };

    function setButton(text, color = '#111') {
      const button = document.getElementById(buttonId);
      if (!button) return;
      button.textContent = text;
      button.style.backgroundColor = color;
    }

    function showFallback(payload) {
      let box = document.getElementById(fallbackId);
      if (!box) {
        box = document.createElement('textarea');
        box.id = fallbackId;
        box.style.cssText =
          'position:fixed;left:16px;bottom:64px;z-index:2147483647;width:520px;height:300px;background:#111;color:#fff;border:1px solid #fff5;border-radius:12px;padding:10px;font:12px monospace;box-shadow:0 8px 30px #0008';
        document.body.appendChild(box);
      }
      box.value = payload;
      box.focus();
      box.select();
    }

    function collectCatalogLots(itemsMap) {
      getLotTiles().forEach(tile => {
        const lot = extractLot(tile);
        const key = lot.url || lot.id || lot.lot;
        if (key && lot.title) itemsMap.set(String(key), lot);
      });
      return itemsMap.size;
    }

    async function copyAllLots() {
      if (state.running) {
        state.stopRequested = true;
        setButton('Stopping...', '#9c1b1b');
        status('Catalog scraper stop requested.');
        return;
      }

      state.running = true;
      state.stopRequested = false;
      setButton('Starting...', '#d32f2f');

      try {
        let lots = [];
        let stopped = false;
        let expectedTotal = 0;

        if (isLiveCatalogPage()) {
          const expanded = await expandLivePageLots(message => {
            setButton(message, '#d32f2f');
            status(message);
          }, () => state.stopRequested);
          lots = expanded.lots || [];
          stopped = expanded.stopped;
          expectedTotal = expanded.expectedOpenLots;
        } else {
          const itemsMap = new Map();
          await loadLots(message => {
            setButton(message, '#d32f2f');
            status(message);
          }, () => state.stopRequested, () => collectCatalogLots(itemsMap));
          collectCatalogLots(itemsMap);
          lots = Array.from(itemsMap.values());
          stopped = state.stopRequested;
          expectedTotal = numberFromText(textOf(document.querySelector('.lot-list-header')).match(/Total Lots:\s*([\d,]+)/i)?.[1] || '');
        }

        if (!lots.length) {
          setButton('Failed. Try again.', '#111');
          status('Catalog scraper found no lots.');
          return;
        }

        const payload = JSON.stringify(lots, null, 2);
        const copied = await writeClipboard(payload).catch(() => false);
        if (!copied) showFallback(payload);
        const countText = expectedTotal ? `${lots.length}/${expectedTotal}` : String(lots.length);
        setButton(stopped
          ? (copied ? `Stopped. Copied ${countText}.` : `Stopped at ${countText}. Select text box.`)
          : (copied ? `Success! Copied ${countText}.` : `Scraped ${countText}. Select text box.`), '#2e7d32');
        status(copied ? `Catalog scraper copied ${countText} lot(s).` : `Catalog scraper scraped ${countText}; select fallback text box.`);
      } finally {
        state.running = false;
        state.stopRequested = false;
        setTimeout(() => setButton('Copy All HiBid Lots', '#111'), 5000);
      }
    }

    function ensureButton() {
      if (!shouldInitOnLocation() || isFlipTrackerListingPage() || !document.body) return;
      if (document.getElementById(buttonId)) return;
      const button = document.createElement('button');
      button.id = buttonId;
      button.type = 'button';
      button.textContent = 'Copy All HiBid Lots';
      button.style.cssText =
        'position:fixed;left:16px;bottom:16px;z-index:2147483647;padding:12px 16px;border-radius:999px;border:1px solid #fff3;background:#111;color:white;font:600 13px system-ui;box-shadow:0 8px 30px #0008;cursor:pointer;transition:background-color 0.3s;';
      button.addEventListener('click', copyAllLots);
      document.body.appendChild(button);
    }

    ensureButton();
    setTimeout(ensureButton, 1000);
    setTimeout(ensureButton, 3000);
    setInterval(ensureButton, 5000);
  }

  async function writeClipboard(payload) {
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(payload, 'text');
      return true;
    }
    if (globalThis.GM?.setClipboard) {
      await globalThis.GM.setClipboard(payload, 'text');
      return true;
    }
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(payload);
      return true;
    }
    return false;
  }

  function safeTimestamp(value = new Date()) {
    const date = value instanceof Date ? value : new Date(value);
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  }

  function downloadTextFile(filename, contents, type = 'text/html;charset=utf-8') {
    const blob = new Blob([contents], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    window.setTimeout(() => {
      URL.revokeObjectURL(url);
      link.remove();
    }, 1000);
  }

  function scanCurrentFlipTrackerListings() {
    return parseFlipTrackerActiveListingsHtml(document.documentElement?.outerHTML || '', {
      url: location.href
    });
  }

  function lotSummary(rows) {
    return rows
      .map(row => row.lot)
      .filter(Boolean)
      .slice(0, 12)
      .join(', ');
  }

  function findDialog() {
    return document.querySelector('ngb-modal-window, .modal.show, .modal-dialog, [role="dialog"], [aria-modal="true"], app-bid-confirmation, app-confirm-bid');
  }

  function buttonLabel(btn) {
    return [
      textOf(btn),
      btn?.getAttribute?.('aria-label') || '',
      btn?.getAttribute?.('title') || '',
      btn?.getAttribute?.('id') || btn?.id || '',
      btn?.getAttribute?.('name') || btn?.name || '',
      btn?.getAttribute?.('value') || btn?.value || ''
    ].join(' ').replace(/\s+/g, ' ').trim();
  }

  function findConfirmButton(dialog) {
    const candidates = Array.from(dialog.querySelectorAll('button, [role="button"], input[type="button"], input[type="submit"], a.btn'))
      .filter(btn => !btn.disabled && !btn.getAttribute?.('aria-disabled'))
      .filter(isVisible)
      .map(btn => {
        const text = buttonLabel(btn).toLowerCase();
        let score = 0;
        if (/cancel|close|reject|no\b|deny|dismiss|hide/i.test(text)) {
          score = -100;
        } else if (/bid-confirm-confirm-bid|click\s+to\s+confirm\s+bid|confirm\s+(?:your\s+)?(?:max\s+)?bid/i.test(text)) {
          score = 12;
        } else if (/confirm/i.test(text)) {
          score = 8;
        } else if (/place\s+bid|place\s+max\s+bid/i.test(text)) {
          score = 7;
        } else if (/submit/i.test(text)) {
          score = 6;
        } else if (/yes/i.test(text)) {
          score = 5;
        } else if (/ok/i.test(text)) {
          score = 4;
        } else if (/bid/i.test(text)) {
          score = 3;
        }
        return { btn, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);

    return candidates[0]?.btn || null;
  }

  function isBidConfirmText(value) {
    return /confirm\s+(?:your\s+)?(?:max\s+)?bid|bid\s+confirmation|click\s+to\s+confirm\s+bid|maximum\s+(?:amount|bid)|new\s+max\s+bid|submit\s+(?:your\s+)?bid/i.test(value || '');
  }

  function isStrongConfirmButton(btn) {
    return /bid-confirm-confirm-bid|click\s+to\s+confirm\s+bid|confirm\s+(?:your\s+)?(?:max\s+)?bid/i.test(buttonLabel(btn));
  }

  function isBidHistorySurface(surface) {
    return /bid\s+history|bid\s+history\s+for|\b\d+\s+bids?\b/i.test(textOf(surface));
  }

  function findConfirmSurface(root = document) {
    const modalRoots = Array.from(root.querySelectorAll?.('ngb-modal-window, .modal.show, .modal-dialog, [role="dialog"], [aria-modal="true"], app-bid-confirmation, app-confirm-bid, #modal-body, .modal-body') || []);
    const blockingHistoryDialog = modalRoots.find(surface => isVisible(surface) && isBidHistorySurface(surface));
    if (blockingHistoryDialog) {
      debug('confirm-surface blocked by bid history dialog', {
        text: textOf(blockingHistoryDialog).slice(0, 220)
      });
      return null;
    }

    const roots = modalRoots.slice();
    const pageRoot = root.body || root.documentElement;
    if (pageRoot) roots.push(pageRoot);

    const uniqueRoots = Array.from(new Set(roots));
    debug('confirm-surface scan', { candidateRoots: uniqueRoots.length });

    for (const surface of uniqueRoots) {
      const visible = isVisible(surface);
      if (!visible) {
        debug('confirm-surface skipped invisible root', {
          tag: surface?.tagName || '',
          id: surface?.id || '',
          className: String(surface?.className || '').slice(0, 120),
          text: textOf(surface).slice(0, 160)
        });
        continue;
      }
      const button = findConfirmButton(surface);
      const surfaceText = textOf(surface);
      const textMatch = isBidConfirmText(surfaceText);
      const strongButton = Boolean(button && isStrongConfirmButton(button));
      const isPageRoot = surface === pageRoot;
      debug('confirm-surface inspected visible root', {
        tag: surface?.tagName || '',
        id: surface?.id || '',
        className: String(surface?.className || '').slice(0, 120),
        isPageRoot,
        textMatch,
        hasButton: Boolean(button),
        strongButton,
        buttonLabel: button ? buttonLabel(button) : '',
        text: surfaceText.slice(0, 220)
      });
      if (!button) continue;
      if (isBidHistorySurface(surface)) continue;
      if (isPageRoot && !strongButton && !/confirm\s+(?:your\s+)?(?:max\s+)?bid/i.test(surfaceText)) continue;
      if (textMatch || strongButton) {
        debug('confirm-surface matched', {
          buttonLabel: buttonLabel(button),
          surfaceText: surfaceText.slice(0, 220)
        });
        return { surface, button };
      }
    }

    debug('confirm-surface no match');
    return null;
  }

  async function prepareBid(row, status) {
    debug('bid action blocked: scraper-first mode', { lot: row?.lot });
    status?.('Bidding actions are removed in scraper-first mode.');
    return false;
  }

  async function prepareLiveBid(row, status) {
    debug('live bid action blocked: scraper-first mode', { lot: row?.lot });
    status?.('Live bidding actions are removed in scraper-first mode.');
    return false;
  }

  function defaultPlanText() {
    return JSON.stringify({}, null, 2);
  }

  function storageSafeSegment(value) {
    return String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9.-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'page';
  }

  function getAjWillnerAuctionId(loc = location) {
    const match = String(loc.pathname || '').match(/\/ui\/auctions\/([^/?#]+)/i);
    return match?.[1] || '';
  }

  function getPlanStorageKey(loc = location) {
    const host = storageSafeSegment(loc.hostname || 'page');
    if (host === 'bid.ajwillnerauctions.com') {
      const auctionId = getAjWillnerAuctionId(loc);
      return `${PLAN_KEY_PREFIX}:${host}:${auctionId ? `auction:${storageSafeSegment(auctionId)}` : 'catalog'}`;
    }

    if (isFlipTrackerListingPage(loc)) return `${PLAN_KEY_PREFIX}:${host}:fliptracker`;

    if (isAuctionNinjaHost(loc.hostname || '')) {
      const route = resolveAuctionNinjaPage(loc);
      if (route.saleId) return `${PLAN_KEY_PREFIX}:${host}:auctionninja:sale:${storageSafeSegment(route.saleId)}`;
      if (route.productId) return `${PLAN_KEY_PREFIX}:${host}:auctionninja:item:${storageSafeSegment(route.productId)}`;
      return `${PLAN_KEY_PREFIX}:${host}:auctionninja:${storageSafeSegment(route.kind || 'page')}`;
    }

    const route = resolveHiBidPage(loc);
    if (route.auctionId) return `${PLAN_KEY_PREFIX}:${host}:auction:${storageSafeSegment(route.auctionId)}`;
    if (route.kind === 'watchlist-outbid') return `${PLAN_KEY_PREFIX}:${host}:watchlist-outbid`;
    return `${PLAN_KEY_PREFIX}:${host}:${storageSafeSegment(route.kind || 'page')}`;
  }

  function getStoredPlanText(loc = (typeof location !== 'undefined' ? location : null)) {
    try {
      const key = loc ? getPlanStorageKey(loc) : `${PLAN_KEY_PREFIX}:global`;
      const stored = GM_getValue(key, null);
      if (typeof stored === 'string') return stored;

      const migrated = Boolean(GM_getValue(LEGACY_PLAN_MIGRATED_KEY, false));
      const legacy = migrated ? null : GM_getValue(LEGACY_PLAN_KEY, null);
      if (typeof legacy === 'string') {
        GM_setValue(key, legacy);
        GM_setValue(LEGACY_PLAN_MIGRATED_KEY, true);
        return legacy;
      }
      return defaultPlanText();
    } catch {
      return defaultPlanText();
    }
  }

  function savePlanText(value, loc = (typeof location !== 'undefined' ? location : null)) {
    try {
      const key = loc ? getPlanStorageKey(loc) : `${PLAN_KEY_PREFIX}:global`;
      GM_setValue(key, value);
    } catch {
      // Tampermonkey storage may be unavailable in tests.
    }
  }

  function addLotToPlanText(raw, lot) {
    let existingPlan;
    try {
      existingPlan = JSON.parse(raw || '{}');
    } catch {
      existingPlan = {};
    }
    if (!existingPlan || Array.isArray(existingPlan) || typeof existingPlan !== 'object') existingPlan = {};
    if (!lot?.lot) return JSON.stringify(existingPlan, null, 2);

    const lotKey = String(lot.lot);
    const existing = existingPlan[lotKey];
    const existingMax = typeof existing === 'number' ? existing : existing?.max;
    const max = Number(existingMax);
    existingPlan[lotKey] = {
      max: Number.isFinite(max) && max > 0 ? max : null,
      title: lot.title || existing?.title || ''
    };

    const sorted = {};
    Object.keys(existingPlan).sort((a, b) => String(a).localeCompare(String(b), undefined, {
      numeric: true,
      sensitivity: 'base'
    })).forEach(key => {
      sorted[key] = existingPlan[key];
    });
    return JSON.stringify(sorted, null, 2);
  }

  function planTextFromLoadedLots(raw, lots) {
    let existingPlan;
    try {
      existingPlan = JSON.parse(raw || '{}');
    } catch {
      existingPlan = {};
    }

    if (!existingPlan || Array.isArray(existingPlan) || typeof existingPlan !== 'object') existingPlan = {};

    const nextPlan = {};
    lots.forEach(lot => {
      if (!lot?.lot) return;
      const lotKey = String(lot.lot);
      const existing = existingPlan[lotKey];
      const existingMax = typeof existing === 'number' ? existing : existing?.max;
      const max = Number(existingMax);
      nextPlan[lotKey] = {
        max: Number.isFinite(max) && max > 0 ? max : null,
        title: lot.title || ''
      };
    });

    const sorted = {};
    Object.keys(nextPlan).sort((a, b) => Number(a) - Number(b)).forEach(key => {
      sorted[key] = nextPlan[key];
    });
    return JSON.stringify(sorted, null, 2);
  }

  function getStoredAutoRefresh() {
    try {
      return Boolean(GM_getValue(AUTO_REFRESH_KEY, false));
    } catch {
      return false;
    }
  }

  function saveAutoRefresh(value) {
    try {
      GM_setValue(AUTO_REFRESH_KEY, Boolean(value));
    } catch {
      // Tampermonkey storage may be unavailable in tests.
    }
  }

  function getStoredMinimized() {
    try {
      return Boolean(GM_getValue(MINIMIZED_KEY, true));
    } catch {
      return true;
    }
  }

  function saveMinimized(value) {
    try {
      GM_setValue(MINIMIZED_KEY, Boolean(value));
    } catch {
      // Tampermonkey storage may be unavailable in tests.
    }
  }

  function getPlan(status) {
    const raw = document.getElementById('hibid-bid-plan-json')?.value || '{}';
    try {
      const plan = parseBidPlan(raw);
      savePlanText(raw);
      return plan;
    } catch (err) {
      status(`Bad JSON: ${err.message}`);
      return {};
    }
  }

  function hibaIcon(name) {
    const icons = {
      chevron: '<path d="m6 9 6 6 6-6"></path>',
      close: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
      copy: '<rect width="14" height="14" x="8" y="8" rx="2"></rect><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"></path>',
      download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><path d="M7 10l5 5 5-5"></path><path d="M12 15V3"></path>',
      file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><path d="M14 2v6h6"></path>',
      list: '<path d="M8 6h13"></path><path d="M8 12h13"></path><path d="M8 18h13"></path><path d="M3 6h.01"></path><path d="M3 12h.01"></path><path d="M3 18h.01"></path>',
      radio: '<circle cx="12" cy="12" r="2"></circle><path d="M16.24 7.76a6 6 0 0 1 0 8.49"></path><path d="M7.76 16.24a6 6 0 0 1 0-8.49"></path><path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path><path d="M4.93 19.07a10 10 0 0 1 0-14.14"></path>',
      scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2"></path><path d="M17 3h2a2 2 0 0 1 2 2v2"></path><path d="M21 17v2a2 2 0 0 1-2 2h-2"></path><path d="M7 21H5a2 2 0 0 1-2-2v-2"></path><path d="M7 12h10"></path>',
      shield: '<path d="M20 13c0 5-3.5 7.5-7.7 8.8a1 1 0 0 1-.6 0C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.2-2.6a1.2 1.2 0 0 1 1.6 0C14.5 3.8 17 5 19 5a1 1 0 0 1 1 1z"></path>',
      stop: '<rect width="14" height="14" x="5" y="5" rx="2"></rect>',
      zap: '<path d="M4 14a1 1 0 0 1-.8-1.6l9-10A1 1 0 0 1 14 3v7h6a1 1 0 0 1 .8 1.6l-9 10A1 1 0 0 1 10 21v-7z"></path>'
    };
    return `<svg class="hiba-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icons[name] || icons.shield}</svg>`;
  }

  function helpAttrs(text) {
    if (!text) return '';
    const safe = escapeHtml(text);
    return ` title="${safe}" aria-label="${safe}" data-help="${safe}"`;
  }

  function actionButton(id, icon, label, tone = 'primary', extra = '', help = '') {
    return `<button id="${id}" type="button" class="hiba-btn ${tone}"${helpAttrs(help || label)} ${extra}>${hibaIcon(icon)}<span>${label}</span></button>`;
  }

  function modeLabelFor(mode) {
    if (mode === 'fliptracker') return 'FlipTracker';
    if (mode === 'live') return 'Live';
    if (mode === 'auctionninja') return 'AuctionNinja';
    if (mode === 'aar') return 'AAR Auctions';
    if (mode === 'govdeals') return 'GovDeals';
    if (mode === 'unsupported') return 'Unsupported';
    return 'Catalog';
  }

  function isAjWillnerRoute(route = {}) {
    return route?.source === 'ajwillner' || route?.host === 'bid.ajwillnerauctions.com';
  }

  const SITE_SHORTCUTS = Object.freeze([
    Object.freeze({
      id: 'hibid',
      label: 'HiBid',
      site: 'hibid',
      modeHint: 'catalog',
      url: 'https://hibid.com/lots',
      help: 'Open HiBid lots search in this tab.'
    }),
    Object.freeze({
      id: 'ajwillner',
      label: 'AJ Willner',
      site: 'ajwillner',
      modeHint: 'catalog',
      url: 'https://bid.ajwillnerauctions.com/ui/auctions/164037?category=All&subCategory=Active',
      help: 'Open the AJ Willner active auction catalog in this tab.'
    }),
    Object.freeze({
      id: 'auctionninja',
      label: 'AuctionNinja',
      site: 'auctionninja',
      modeHint: 'auction-search',
      url: 'https://www.auctionninja.com/nj/carteret/07008?miles=50&an=',
      help: 'Open AuctionNinja nearby auctions near Carteret, NJ in this tab.'
    }),
    Object.freeze({
      id: 'aar',
      label: 'AAR Auctions',
      site: 'aar',
      modeHint: 'auction-list',
      url: 'https://aarauctions.com/auctions/',
      help: 'Open the AAR Auctions calendar in this tab.'
    }),
    Object.freeze({
      id: 'govdeals',
      label: 'GovDeals',
      site: 'govdeals',
      modeHint: 'new-listings',
      url: 'https://www.govdeals.com/en/search/filters?zipcode=07008&miles=50&showMap=0&source=location-search',
      help: 'Open GovDeals listings near 07008 within 50 miles in this tab.'
    })
  ]);

  function shortcutIdForHost(hostname = '') {
    const host = String(hostname || '').toLowerCase();
    if (host === 'bid.ajwillnerauctions.com') return 'ajwillner';
    if (isGovDealsHost(host)) return 'govdeals';
    if (isAarAuctionsHost(host)) return 'aar';
    if (isAuctionNinjaHost(host)) return 'auctionninja';
    if (isHiBidHost(host)) return 'hibid';
    return '';
  }

  function getCurrentSiteShortcutId(currentLocationOrMode = null, route = {}) {
    if (route?.source === 'ajwillner' || route?.host === 'bid.ajwillnerauctions.com') return 'ajwillner';
    const routeHost = shortcutIdForHost(route?.host || '');
    if (routeHost) return routeHost;

    const input = currentLocationOrMode || (typeof location !== 'undefined' ? location : null);
    if (!input) return '';

    if (typeof input === 'string') {
      const value = input.trim().toLowerCase();
      if (SITE_SHORTCUTS.some(item => item.id === value || item.site === value)) return value === 'auctionninja' ? 'auctionninja' : value;
      if (value === 'catalog' || value === 'live' || value === 'hibid-live') return 'hibid';
      if (value === 'auction-search' || value === 'followed-items' || value === 'items-won' || value === 'bid-history') return 'auctionninja';
      if (value === 'aar-auction-list' || value === 'aar-auction-catalog') return 'aar';
      if (value === 'govdeals-seller' || value === 'govdeals-new-listings' || value === 'govdeals-asset') return 'govdeals';
      if (/^https?:\/\//i.test(value)) {
        try {
          return shortcutIdForHost(new URL(input).hostname);
        } catch {
          return '';
        }
      }
      return '';
    }

    if (input.mode) return getCurrentSiteShortcutId(input.mode, input.route || route);
    if (input.source === 'ajwillner') return 'ajwillner';
    const host = input.hostname || input.host || '';
    if (host) return shortcutIdForHost(host);
    if (input.href) {
      try {
        return shortcutIdForHost(new URL(input.href).hostname);
      } catch {
        return '';
      }
    }
    return '';
  }

  function getSiteShortcuts(currentLocationOrMode = null, route = {}) {
    const currentId = getCurrentSiteShortcutId(currentLocationOrMode, route);
    return SITE_SHORTCUTS.map(item => ({
      id: item.id,
      label: item.label,
      site: item.site,
      modeHint: item.modeHint,
      url: item.url,
      help: item.help,
      current: item.id === currentId
    }));
  }

  function renderModeTabs(mode, route = {}, busy = false) {
    const isAjWillner = mode === 'catalog' && isAjWillnerRoute(route);
    const meta = {
      catalog: isAjWillner
        ? { label: 'AJ Willner', icon: 'list', help: 'AJ Willner scraper mode copies virtual auction listings as JSON or an LLM brief.' }
        : { label: 'HiBid', icon: 'list', help: 'HiBid scraper mode copies catalog or watchlist lots as JSON or an LLM brief.' },
      live: { label: 'HiBid Live', icon: 'radio', help: 'HiBid live scraper mode expands visible live lots and copies JSON or an LLM brief.' },
      fliptracker: { label: 'FlipTracker', icon: 'file', help: 'FlipTracker mode exports visible eBay or Facebook selling listings for import/review.' },
      auctionninja: { label: 'AuctionNinja', icon: 'list', help: 'AuctionNinja mode copies sale catalogs as JSON or a terms-aware LLM brief without touching bid controls.' },
      aar: { label: 'AAR Auctions', icon: 'list', help: 'AAR Auctions mode copies auction calendars or catalogs as JSON or distance-aware LLM briefs.' },
      govdeals: { label: 'GovDeals', icon: 'list', help: 'GovDeals mode copies seller pages, nearby listings, or asset details as JSON or distance-aware LLM briefs.' },
      unsupported: { label: 'Unsupported', icon: 'shield', help: 'This page is not supported by FlipperAddon.' }
    };
    const active = meta[mode] || meta.catalog;
    const shortcuts = getSiteShortcuts(mode, route);
    const shortcutDisabled = busy ? ' disabled aria-disabled="true"' : '';
    const shortcutRows = shortcuts.map(item => `
        <button type="button" class="hiba-shortcut${item.current ? ' active' : ''}" data-site-shortcut-url="${escapeHtml(item.url)}" data-site-shortcut-id="${escapeHtml(item.id)}"${item.current ? ' aria-current="page"' : ''}${helpAttrs(item.help)}${shortcutDisabled}>
          <span>${escapeHtmlText(item.label)}</span>
          <small>${escapeHtmlText(item.modeHint)}</small>
        </button>
    `).join('');
    return `
      <div class="hiba-tabs hiba-site-switcher" aria-label="FlipperAddon site switcher">
        <button id="flipperaddon-site-switcher-toggle" type="button" class="hiba-tab hiba-switcher-toggle active" aria-expanded="false" aria-controls="flipperaddon-site-switcher-menu"${helpAttrs(active.help)}>
          ${hibaIcon(active.icon)}<span>${active.label}</span>${hibaIcon('chevron')}
        </button>
        <div id="flipperaddon-site-switcher-menu" class="hiba-site-menu" role="menu" aria-label="Auction site shortcuts" hidden>
          ${shortcutRows}
        </div>
      </div>
    `;
  }

  function renderDebugActions(debugEnabled) {
    if (!debugEnabled) return '';
    return `
      <div class="hiba-actions hiba-debug-actions">
        ${actionButton('hibid-debug-copy', 'copy', 'Copy Debug', 'secondary', '', 'Copy the in-memory FlipperAddon debug log for troubleshooting.')}
        ${actionButton('hibid-debug-clear', 'stop', 'Clear Debug', 'danger', '', 'Clear saved FlipperAddon debug log entries.')}
      </div>
    `;
  }

  function renderAarResearchSettings() {
    const settings = getAarResearchSettings();
    return `
      <details class="hiba-details" id="aar-research-settings">
        <summary>Research Settings</summary>
        <label class="hiba-field">
          <span>Origin</span>
          <input id="aar-origin-label" class="hiba-input" type="text" value="${escapeHtml(settings.originLabel)}" title="Origin used in AAR LLM briefs for the distance verification agent." aria-label="AAR distance origin">
        </label>
        <label class="hiba-field">
          <span>Radius miles</span>
          <input id="aar-radius-miles" class="hiba-input" type="number" min="1" step="1" value="${escapeHtml(String(settings.radiusMiles))}" title="Maximum driving/search radius used in AAR LLM briefs." aria-label="AAR radius miles">
        </label>
      </details>
    `;
  }

  function renderAarSection(debugEnabled, route = {}) {
    const isCatalog = route?.kind === 'aar-auction-catalog';
    return `
      <section id="aar-auctions-mode" class="hiba-section" data-module="aar" data-page-kind="${escapeHtml(route?.kind || 'aar-auction-list')}">
        <div class="hiba-section-head">
          <div>
            <div class="hiba-kicker">AAR Auctions</div>
            <strong>${isCatalog ? 'Catalog Export' : 'Auction Calendar Export'}</strong>
          </div>
          <span class="hiba-chip neutral">${isCatalog ? 'catalog' : 'calendar'}</span>
        </div>
        <div class="hiba-actions">
          ${isCatalog
            ? actionButton('aar-catalog-copy-llm', 'file', 'Copy Catalog LLM', 'primary', '', 'Copy AAR sale terms, distance research instructions, and lot JSON for a desktop LLM.')
            : actionButton('aar-auctions-copy-llm', 'file', 'Copy Auctions LLM', 'primary', '', 'Copy AAR auction cards with distance research instructions for a desktop LLM.')}
          ${isCatalog
            ? actionButton('aar-catalog-copy-json', 'copy', 'Copy JSON', 'secondary', '', 'Copy the current AAR catalog as normalized JSON.')
            : actionButton('aar-auctions-copy-json', 'copy', 'Copy JSON', 'secondary', '', 'Copy AAR auction calendar cards as normalized JSON.')}
          ${actionButton('hibid-scraper-stop', 'stop', 'Stop', 'danger', '', 'Stop current AAR scrape/export work.')}
        </div>
        ${renderAarResearchSettings()}
        ${renderDebugActions(debugEnabled)}
      </section>
    `;
  }

  function renderGovDealsSection(debugEnabled, route = {}) {
    const kind = route?.kind || 'govdeals-new-listings';
    const isSeller = kind === 'govdeals-seller';
    const isAsset = kind === 'govdeals-asset';
    const title = isAsset ? 'Asset Export' : (isSeller ? 'Seller Export' : 'Listings Export');
    const chip = isAsset ? 'asset' : (isSeller ? 'seller' : 'listings');
    const llmId = isAsset ? 'govdeals-asset-copy-llm' : (isSeller ? 'govdeals-seller-copy-llm' : 'govdeals-listings-copy-llm');
    const jsonId = isAsset ? 'govdeals-asset-copy-json' : (isSeller ? 'govdeals-seller-copy-json' : 'govdeals-listings-copy-json');
    const llmLabel = isAsset ? 'Copy Asset LLM' : (isSeller ? 'Copy Seller LLM' : 'Copy Listings LLM');
    return `
      <section id="govdeals-mode" class="hiba-section" data-module="govdeals" data-page-kind="${escapeHtml(kind)}">
        <div class="hiba-section-head">
          <div>
            <div class="hiba-kicker">GovDeals</div>
            <strong>${title}</strong>
          </div>
          <span class="hiba-chip neutral">${chip}</span>
        </div>
        <div class="hiba-actions">
          ${actionButton(llmId, 'file', llmLabel, 'primary', '', 'Copy GovDeals listings with resale prompt, distance verification instructions, and normalized JSON for a desktop LLM.')}
          ${actionButton(jsonId, 'copy', 'Copy JSON', 'secondary', '', 'Copy GovDeals listings as normalized JSON.')}
          ${actionButton('hibid-scraper-stop', 'stop', 'Stop', 'danger', '', 'Stop current GovDeals scrape/export work.')}
        </div>
        ${renderDebugActions(debugEnabled)}
      </section>
    `;
  }

  function renderCatalogSection(debugEnabled, route = {}) {
    const isAjWillner = isAjWillnerRoute(route);
    const isWinningBids = route?.kind === 'currentbids-winning';
    const isOutbidBids = route?.kind === 'currentbids-outbid';
    const isWatchlist = route?.kind === 'watchlist' || route?.kind === 'watchlist-outbid';
    const isAccountBids = isWinningBids || isOutbidBids || isWatchlist;
    const kicker = isAjWillner ? 'AJ Willner' : (isAccountBids ? 'HiBid account' : 'HiBid catalog');
    const title = isAjWillner
      ? 'AJ Willner Catalog Export'
      : (isWinningBids ? 'Winning Bids Export' : (isOutbidBids ? 'Outbid Bids Export' : (isWatchlist ? 'Watchlist Export' : 'Catalog Export')));
    const chip = isAjWillner ? 'api-first' : (isWinningBids ? 'winning' : (isOutbidBids ? 'outbid' : (isWatchlist ? 'watchlist' : 'scraper')));
    const llmHelp = isAjWillner
      ? 'Copy the resale-analysis prompt plus scraped AJ Willner listing JSON for a desktop LLM.'
      : (isAccountBids
        ? 'Copy the resale-analysis prompt plus visible HiBid account bid lots for a desktop LLM.'
        : 'Copy the full resale-analysis prompt plus scraped lot JSON for a desktop LLM.');
    const jsonHelp = isAjWillner
      ? 'Copy scraped AJ Willner auction listings as JSON for manual use.'
      : (isAccountBids
        ? 'Copy visible HiBid account bid lots as JSON for manual use.'
        : 'Copy scraped HiBid lots as JSON for manual use.');
    return `
      <section id="hibid-bid-controls" class="hiba-section" data-module="catalog">
        <div class="hiba-section-head">
          <div>
            <div class="hiba-kicker">${kicker}</div>
            <strong>${title}</strong>
          </div>
          <span class="hiba-chip neutral">${chip}</span>
        </div>
        <div class="hiba-actions">
          ${actionButton('hibid-catalog-copy-llm', 'file', 'Copy LLM Brief', 'primary', '', llmHelp)}
          ${actionButton('hibid-catalog-copy-json', 'copy', 'Copy JSON', 'secondary', '', jsonHelp)}
          ${actionButton('hibid-scraper-stop', 'stop', 'Stop', 'danger', '', 'Stop current scrape/export work.')}
        </div>
        ${renderDebugActions(debugEnabled)}
      </section>
    `;
  }

  function renderLiveSection(debugEnabled) {
    return `
      <section id="hibid-live-mode" class="hiba-section" data-module="live">
        <div class="hiba-section-head">
          <div>
            <div class="hiba-kicker">HiBid live</div>
            <strong>Live Export</strong>
          </div>
          <span class="hiba-chip neutral">scraper</span>
        </div>
        <div class="hiba-actions">
          ${actionButton('hibid-live-copy-llm', 'file', 'Copy LLM Brief', 'primary', '', 'Expand visible live lots and copy the resale-analysis prompt plus lot JSON.')}
          ${actionButton('hibid-live-copy-json', 'copy', 'Copy JSON', 'secondary', '', 'Expand visible live lots and copy their JSON.')}
          ${actionButton('hibid-scraper-stop', 'stop', 'Stop', 'danger', '', 'Stop current scrape/export work.')}
        </div>
        ${renderDebugActions(debugEnabled)}
      </section>
    `;
  }

  function renderAuctionNinjaSection(debugEnabled, route = {}) {
    if (route?.kind === 'category-search') {
      return `
        <section id="auctionninja-category-mode" class="hiba-section" data-module="auctionninja" data-page-kind="category-search">
          <div class="hiba-section-head">
            <div>
              <div class="hiba-kicker">AuctionNinja</div>
              <strong>Category Item Export</strong>
            </div>
            <span class="hiba-chip neutral">items</span>
          </div>
          <div class="hiba-actions">
            ${actionButton('auctionninja-category-copy-llm', 'file', 'Copy Category LLM', 'primary', '', 'Copy category item cards with location filters and resale triage context.')}
            ${actionButton('auctionninja-category-copy-json', 'copy', 'Copy JSON', 'secondary', '', 'Copy AuctionNinja category item cards as normalized JSON.')}
            ${actionButton('hibid-scraper-stop', 'stop', 'Stop', 'danger', '', 'Stop safe category-page loading or export work.')}
          </div>
          ${renderDebugActions(debugEnabled)}
        </section>
      `;
    }

    if (route?.kind === 'auction-search') {
      return `
        <section id="auctionninja-auctions-mode" class="hiba-section" data-module="auctionninja" data-page-kind="auction-search">
          <div class="hiba-section-head">
            <div>
              <div class="hiba-kicker">AuctionNinja</div>
              <strong>Auction Search Export</strong>
            </div>
            <span class="hiba-chip neutral">sales</span>
          </div>
          <div class="hiba-actions">
            ${actionButton('auctionninja-auctions-copy-llm', 'file', 'Copy Auctions LLM', 'primary', '', 'Copy nearby/search auction rows with whole-sale resale triage context.')}
            ${actionButton('auctionninja-auctions-copy-json', 'copy', 'Copy JSON', 'secondary', '', 'Copy visible/search auction rows as normalized JSON.')}
            ${actionButton('hibid-scraper-stop', 'stop', 'Stop', 'danger', '', 'Stop current auction-search export work.')}
          </div>
          ${renderDebugActions(debugEnabled)}
        </section>
      `;
    }

    if (route?.kind === 'followed-items' || route?.kind === 'items-won' || route?.kind === 'bid-history') {
      const isWon = route.kind === 'items-won';
      const isBidHistory = route.kind === 'bid-history';
      return `
        <section id="auctionninja-account-mode" class="hiba-section" data-module="auctionninja" data-page-kind="${escapeHtml(route.kind)}">
          <div class="hiba-section-head">
            <div>
              <div class="hiba-kicker">AuctionNinja</div>
              <strong>${isWon ? 'Items Won Export' : (isBidHistory ? 'Bid History Export' : 'Followed Items Export')}</strong>
            </div>
            <span class="hiba-chip neutral">${isWon ? 'inventory' : (isBidHistory ? 'history' : 'watchlist')}</span>
          </div>
          <div class="hiba-actions">
            ${actionButton('auctionninja-account-copy-llm', 'file', isWon ? 'Copy Won Items LLM' : (isBidHistory ? 'Copy Bid History LLM' : 'Copy Watchlist LLM'), 'primary', '', isWon ? 'Copy won items with resale planning context.' : (isBidHistory ? 'Copy bid history with resale decision-review context.' : 'Copy followed items with resale triage context.'))}
            ${actionButton('auctionninja-account-copy-json', 'copy', 'Copy JSON', 'secondary', '', 'Copy visible account items as normalized JSON.')}
            ${actionButton('hibid-scraper-stop', 'stop', 'Stop', 'danger', '', 'Stop current export work.')}
          </div>
          ${renderDebugActions(debugEnabled)}
        </section>
      `;
    }

    return `
      <section id="auctionninja-catalog-mode" class="hiba-section" data-module="auctionninja">
        <div class="hiba-section-head">
          <div>
            <div class="hiba-kicker">AuctionNinja</div>
            <strong>Sale Catalog Research</strong>
          </div>
          <span class="hiba-chip neutral">research only</span>
        </div>
        <div class="hiba-actions">
          ${actionButton('auctionninja-catalog-copy-llm', 'file', 'Copy LLM Brief', 'primary', '', 'Copy the resale-analysis prompt plus AuctionNinja sale terms and lot JSON.')}
          ${actionButton('auctionninja-catalog-copy-json', 'copy', 'Copy JSON', 'secondary', '', 'Copy the current AuctionNinja sale catalog as normalized JSON.')}
          ${actionButton('hibid-scraper-stop', 'stop', 'Stop', 'danger', '', 'Stop guarded catalog loading or copy/export work.')}
        </div>
        ${renderDebugActions(debugEnabled)}
      </section>
    `;
  }

  function renderFlipTrackerSection(debugEnabled) {
    return `
      <section id="fliptracker-listing-export-mode" class="hiba-section" data-module="fliptracker">
        <div class="hiba-section-head">
          <div>
            <div class="hiba-kicker">Marketplace listings</div>
            <strong>FlipTracker Active Listing Export</strong>
          </div>
          <span class="hiba-chip neutral">HTML</span>
        </div>
        <div class="hiba-actions">
          ${actionButton('fliptracker-listing-scan', 'scan', 'Scan Listings', 'primary', '', 'Read the currently visible eBay or Facebook active selling listings.')}
          ${actionButton('fliptracker-listing-copy', 'copy', 'Copy HTML', 'secondary', '', 'Copy the FlipTracker import HTML to the clipboard.')}
          ${actionButton('fliptracker-listing-download', 'download', 'Download', 'success', '', 'Download the FlipTracker import HTML file.')}
        </div>
        ${renderDebugActions(debugEnabled)}
        <div id="fliptracker-listing-status" class="hiba-meta">Waiting to scan.</div>
      </section>
    `;
  }

  function renderActiveSection(mode, debugEnabled, route = {}) {
    if (mode === 'live') return renderLiveSection(debugEnabled);
    if (mode === 'fliptracker') return renderFlipTrackerSection(debugEnabled);
    if (mode === 'auctionninja') return renderAuctionNinjaSection(debugEnabled, route);
    if (mode === 'aar') return renderAarSection(debugEnabled, route);
    if (mode === 'govdeals') return renderGovDealsSection(debugEnabled, route);
    return renderCatalogSection(debugEnabled, route);
  }

  function shouldRebuildPanelForMode(existingMode, nextMode, allowed = true, panelExists = false) {
    if (!existingMode) return Boolean(panelExists);
    if (!allowed || nextMode === 'unsupported') return true;
    return existingMode !== nextMode;
  }

  function shouldTeardownPanelForRebuild(reason = '') {
    return /^(mode-change|unsupported|debug-toggle)\b/i.test(String(reason || ''));
  }

  function buildPanelHtml(options = {}) {
    const mode = options.mode || (typeof location !== 'undefined' ? resolveAssistantMode(location).mode : 'catalog') || 'catalog';
    const debugEnabled = options.debugEnabled ?? getStoredDebugEnabled();
    const route = options.route || (typeof location !== 'undefined' ? resolveAssistantMode(location).route : {});
    const busy = Boolean(options.busy);
    return `
      <div class="hiba-drawer" role="dialog" aria-label="${APP_NAME}" data-flipperaddon-mode="${escapeHtml(mode)}">
        <div class="hiba-shellbar">
          <button id="hibid-bid-minimize" type="button" class="hiba-launcher" title="Show assistant" aria-label="Show assistant">
            <span class="hiba-orb"></span>
            <span class="hiba-title">${APP_NAME}</span>
            ${hibaIcon('chevron')}
          </button>
          <button id="hibid-bid-close" type="button" class="hiba-icon-btn" title="Close assistant" aria-label="Close assistant">${hibaIcon('close')}</button>
        </div>
        <div id="hibid-bid-body" class="hiba-body">
          <div class="hiba-head">
            <div>
              <div class="hiba-kicker">by ALOS</div>
              <strong>${APP_SHORT_NAME} v${SCRIPT_VERSION}</strong>
            </div>
            <span class="hiba-chip neutral" id="hiba-session-chip">idle</span>
          </div>
          ${renderModeTabs(mode, route, busy)}
          ${renderActiveSection(mode, debugEnabled, route)}
          <div id="flipperaddon-toast" class="hiba-toast" role="status" aria-live="polite"></div>
        </div>
      </div>
      <style>
        #${PANEL_ID} { position:fixed; right:14px; bottom:14px; z-index:999999; display:flex; flex-direction:column; width:min(356px, calc(100vw - 24px)); max-height:calc(100vh - 28px); color:#f8fafc; font:13px/1.35 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; letter-spacing:0; color-scheme:dark; }
        #${PANEL_ID}, #${PANEL_ID} * { box-sizing:border-box; }
        #${PANEL_ID}.hiba-minimized { width:min(228px, calc(100vw - 24px)); }
        #${PANEL_ID}.hiba-minimized #hibid-bid-close { display:none; }
        #${PANEL_ID} .hiba-drawer { display:flex; flex-direction:column; max-height:inherit; overflow:hidden; border:1px solid rgba(148,163,184,.24); border-radius:13px; background:#0b1020; box-shadow:0 16px 45px rgba(0,0,0,.36), 0 2px 10px rgba(15,23,42,.4); }
        #${PANEL_ID} .hiba-shellbar { display:flex; align-items:stretch; gap:6px; padding:7px; border-bottom:1px solid rgba(148,163,184,.14); background:rgba(15,23,42,.92); }
        #${PANEL_ID}.hiba-minimized .hiba-shellbar { border-bottom:0; }
        #${PANEL_ID} .hiba-launcher { flex:1; min-width:0; display:flex; align-items:center; gap:8px; color:#f8fafc; background:transparent; border:0; border-radius:9px; padding:6px 7px; cursor:pointer; text-align:left; }
        #${PANEL_ID} .hiba-launcher:hover { background:rgba(148,163,184,.12); }
        #${PANEL_ID} .hiba-title { min-width:0; font-weight:800; font-size:13px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        #${PANEL_ID}.hiba-minimized .hiba-title { overflow:visible; text-overflow:clip; }
        #${PANEL_ID} .hiba-kicker { color:#94a3b8; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.06em; }
        #${PANEL_ID} .hiba-orb { width:9px; height:9px; border-radius:999px; background:#22c55e; box-shadow:0 0 0 3px rgba(34,197,94,.14); flex:0 0 auto; }
        #${PANEL_ID} .hiba-mode-pill, #${PANEL_ID} .hiba-chip { display:inline-flex; align-items:center; min-height:22px; border:1px solid rgba(148,163,184,.24); border-radius:999px; padding:2px 8px; color:#cbd5e1; background:rgba(15,23,42,.78); font-size:11px; font-weight:800; white-space:nowrap; }
        #${PANEL_ID} .hiba-chip.eligible, #${PANEL_ID} .hiba-chip.success { color:#bbf7d0; background:rgba(22,101,52,.32); border-color:rgba(74,222,128,.34); }
        #${PANEL_ID} .hiba-chip.skip, #${PANEL_ID} .hiba-chip.danger { color:#fecaca; background:rgba(127,29,29,.34); border-color:rgba(248,113,113,.34); }
        #${PANEL_ID} .hiba-body { flex:1 1 auto; min-height:0; overflow:auto; padding:10px; }
        #${PANEL_ID} .hiba-head, #${PANEL_ID} .hiba-section-head { display:flex; align-items:center; justify-content:space-between; gap:10px; }
        #${PANEL_ID} .hiba-head { margin-bottom:10px; }
        #${PANEL_ID} .hiba-head strong, #${PANEL_ID} .hiba-section-head strong { font-size:14px; }
        #${PANEL_ID} .hiba-tabs { display:grid; grid-template-columns:1fr; gap:6px; margin:8px 0; padding:3px; border:1px solid rgba(148,163,184,.18); border-radius:11px; background:rgba(2,6,23,.62); }
        #${PANEL_ID} .hiba-tab { display:flex; align-items:center; justify-content:center; gap:6px; min-width:0; color:#94a3b8; background:transparent; border:0; border-radius:8px; padding:7px 5px; font-weight:800; cursor:pointer; }
        #${PANEL_ID} .hiba-tab.active { color:#fff; background:#1d4ed8; box-shadow:0 8px 22px rgba(37,99,235,.24); }
        #${PANEL_ID} .hiba-switcher-toggle { width:100%; justify-content:space-between; padding:7px 9px; }
        #${PANEL_ID} .hiba-switcher-toggle span { min-width:0; flex:1; text-align:center; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        #${PANEL_ID} .hiba-site-menu[hidden] { display:none !important; }
        #${PANEL_ID} .hiba-site-menu { display:grid; gap:4px; padding:2px; }
        #${PANEL_ID} .hiba-shortcut { display:grid; grid-template-columns:minmax(0,1fr) auto; align-items:center; gap:8px; width:100%; border:1px solid rgba(148,163,184,.16); border-radius:8px; padding:7px 8px; color:#dbeafe; background:rgba(15,23,42,.82); font-weight:850; text-align:left; cursor:pointer; }
        #${PANEL_ID} .hiba-shortcut:hover { border-color:rgba(96,165,250,.42); background:rgba(30,41,59,.92); }
        #${PANEL_ID} .hiba-shortcut.active { color:#ecfeff; background:rgba(14,116,144,.36); border-color:rgba(103,232,249,.36); }
        #${PANEL_ID} .hiba-shortcut[disabled] { opacity:.52; cursor:not-allowed; }
        #${PANEL_ID} .hiba-shortcut small { min-width:0; color:#93c5fd; font-size:10px; font-weight:800; text-transform:uppercase; letter-spacing:.04em; white-space:nowrap; }
        #${PANEL_ID} .hiba-section { border:1px solid rgba(148,163,184,.16); border-radius:12px; padding:10px; margin-top:9px; background:rgba(15,23,42,.52); }
        #${PANEL_ID} .hiba-section[style*="display:none"] { margin:0; padding:0; border:0; }
        #${PANEL_ID} .hiba-details { margin-top:9px; border:1px solid rgba(148,163,184,.16); border-radius:10px; background:rgba(2,6,23,.38); padding:8px 9px; }
        #${PANEL_ID} .hiba-details summary { cursor:pointer; font-weight:900; color:#e0f2fe; }
        #${PANEL_ID} .hiba-field { display:grid; gap:4px; margin-top:8px; color:#cbd5e1; font-size:12px; font-weight:800; }
        #${PANEL_ID} .hiba-input { width:100%; min-height:32px; color:#f8fafc; background:#020617; border:1px solid rgba(148,163,184,.26); border-radius:9px; padding:6px 8px; font:12px/1.25 ui-sans-serif, system-ui, sans-serif; }
        #${PANEL_ID} .hiba-actions { display:flex; align-items:center; gap:7px; flex-wrap:wrap; margin-top:9px; }
        #${PANEL_ID} .hiba-actions.compact { margin-top:0; justify-content:flex-end; }
        #${PANEL_ID} .hiba-btn, #${PANEL_ID} .hiba-prepare, #${PANEL_ID} .hiba-icon-btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; border:1px solid rgba(147,197,253,.28); border-radius:9px; padding:7px 9px; color:#eff6ff; background:#1d4ed8; font-weight:800; cursor:pointer; min-height:34px; }
        #${PANEL_ID} .hiba-btn.secondary { background:#1f2937; border-color:rgba(148,163,184,.25); color:#e5e7eb; }
        #${PANEL_ID} .hiba-btn.success, #${PANEL_ID} .hiba-prepare { background:#15803d; border-color:rgba(74,222,128,.28); }
        #${PANEL_ID} .hiba-btn.danger { background:#991b1b; border-color:rgba(248,113,113,.28); }
        #${PANEL_ID} .hiba-btn[disabled], #${PANEL_ID} .hiba-prepare[disabled] { background:#27272a; color:#71717a; border-color:rgba(113,113,122,.28); cursor:not-allowed; }
        #${PANEL_ID} .hiba-icon-btn { flex:0 0 auto; width:34px; padding:0; background:rgba(30,41,59,.88); border-color:rgba(148,163,184,.24); }
        #${PANEL_ID} .hiba-icon { width:15px; height:15px; flex:0 0 auto; }
        #${PANEL_ID} .hiba-plan { width:100%; height:128px; margin-top:9px; resize:vertical; color:#f8fafc; background:#020617; border:1px solid rgba(148,163,184,.26); border-radius:10px; padding:9px; font:12px/1.45 ui-monospace, SFMono-Regular, Consolas, monospace; }
        #${PANEL_ID} .hiba-toggle-grid { display:grid; grid-template-columns:1fr; gap:6px; margin-top:8px; }
        #${PANEL_ID} .hiba-switch { display:flex; align-items:center; justify-content:space-between; gap:8px; color:#cbd5e1; background:rgba(2,6,23,.45); border:1px solid rgba(148,163,184,.15); border-radius:9px; padding:7px 9px; font-weight:700; }
        #${PANEL_ID} .hiba-switch input { width:16px; height:16px; accent-color:#2563eb; }
        #${PANEL_ID} .hiba-toast { position:absolute; left:10px; right:10px; bottom:10px; z-index:2; pointer-events:none; opacity:0; transform:translateY(8px); transition:opacity .16s ease, transform .16s ease; border-radius:10px; padding:8px 10px; background:rgba(15,23,42,.96); border:1px solid rgba(96,165,250,.35); color:#eff6ff; font-weight:850; box-shadow:0 12px 28px rgba(0,0,0,.34); }
        #${PANEL_ID} .hiba-toast.show { opacity:1; transform:translateY(0); }
        #${PANEL_ID} .hiba-toast.danger { border-color:rgba(248,113,113,.4); color:#fee2e2; }
        #${PANEL_ID} .hiba-meta { color:#94a3b8; font-size:12px; margin-top:6px; }
        #${PANEL_ID} .hiba-row { border:1px solid rgba(148,163,184,.16); border-radius:11px; padding:9px; margin-top:8px; display:grid; grid-template-columns:minmax(0,1fr) auto; gap:8px; align-items:center; background:rgba(2,6,23,.42); }
        #${PANEL_ID} .hiba-row strong { color:#f8fafc; }
        #${PANEL_ID} .hiba-row-actions { display:grid; grid-template-columns:76px 86px 104px; gap:6px; align-items:center; }
        #${PANEL_ID} .hiba-max-inline { width:100%; min-height:34px; color:#f8fafc; background:#020617; border:1px solid rgba(148,163,184,.28); border-radius:9px; padding:6px 7px; font:12px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace; }
        #${PANEL_ID} .hiba-add-plan { min-height:34px; border:1px solid rgba(147,197,253,.28); border-radius:9px; color:#eff6ff; background:#1f2937; font-weight:800; cursor:pointer; }
        #${PANEL_ID} .hiba-status { display:inline-flex; align-items:center; width:max-content; margin-top:5px; border-radius:999px; padding:2px 8px; font-size:11px; font-weight:900; }
        #${PANEL_ID} .hiba-status.eligible { color:#bbf7d0; background:rgba(22,101,52,.38); }
        #${PANEL_ID} .hiba-status.skip { color:#fecaca; background:rgba(127,29,29,.34); }
        #${PANEL_ID} .hiba-live-card { border-radius:10px; padding:9px; background:rgba(2,6,23,.5); border:1px solid rgba(148,163,184,.16); }
        @media (max-width:520px) { #${PANEL_ID} { right:8px; bottom:8px; width:min(356px, calc(100vw - 16px)); } #${PANEL_ID}.hiba-minimized { width:min(228px, calc(100vw - 16px)); } #${PANEL_ID} .hiba-row { grid-template-columns:1fr; } #${PANEL_ID} .hiba-row-actions { grid-template-columns:1fr; } }
      </style>
    `;
  }

  function setPanelMinimized(panel, minimized) {
    const body = panel.querySelector('#hibid-bid-body');
    const button = panel.querySelector('#hibid-bid-minimize');
    if (body) body.style.display = minimized ? 'none' : '';
    panel.classList.toggle('hiba-minimized', Boolean(minimized));
    if (button) {
      button.setAttribute('title', minimized ? 'Show assistant' : 'Minimize assistant');
      button.setAttribute('aria-label', minimized ? 'Show assistant' : 'Minimize assistant');
      const chevron = button.querySelector('.hiba-icon');
      if (chevron) chevron.style.transform = minimized ? 'rotate(180deg)' : '';
    }
  }

  function setActiveModeTab(panel, mode) {
    panel.querySelectorAll('[data-mode-tab]').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.modeTab === mode);
    });
  }

  function createPanel(mode = resolveAssistantMode().mode, debugEnabled = getStoredDebugEnabled(), route = resolveAssistantMode().route) {
    removeLegacyScraperArtifacts('createPanel');
    const old = document.getElementById(PANEL_ID);
    if (old) old.remove();

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.dataset.flipperaddonMode = mode;
    panel.dataset.flipperaddonVersion = SCRIPT_VERSION;
    panel.innerHTML = buildPanelHtml({ mode, debugEnabled, route });

    document.body.appendChild(panel);
    setPanelMinimized(panel, true);
    return panel;
  }

  function getScanOptions() {
    return {
      requireOutbid: Boolean(document.getElementById('hibid-bid-outbid-only')?.checked)
    };
  }

  function init() {
    const assistantMode = resolveAssistantMode();
    const activeMode = assistantMode.mode === 'unsupported' ? 'catalog' : assistantMode.mode;
    const activeRoute = assistantMode.route || {};
    const panel = createPanel(activeMode, getStoredDebugEnabled(), activeRoute);
    const toastEl = panel.querySelector('#flipperaddon-toast');
    const liveMode = activeMode === 'live';
    const listingExportMode = activeMode === 'fliptracker';
    const auctionNinjaMode = activeMode === 'auctionninja';
    const aarMode = activeMode === 'aar';
    const govDealsMode = activeMode === 'govdeals';
    const auctionNinjaKind = auctionNinjaMode ? (activeRoute?.kind || '') : '';
    const auctionNinjaAccountMode = auctionNinjaKind === 'followed-items' || auctionNinjaKind === 'items-won' || auctionNinjaKind === 'bid-history';
    const auctionNinjaAuctionSearchMode = auctionNinjaKind === 'auction-search';
    const auctionNinjaCategoryMode = auctionNinjaKind === 'category-search';
    const aarKind = aarMode ? (activeRoute?.kind || '') : '';
    const govDealsKind = govDealsMode ? (activeRoute?.kind || '') : '';
    const currentActiveRoute = () => resolveAssistantMode().route || activeRoute || {};
    const bidControlsEl = panel.querySelector('#hibid-bid-controls');
    const listingExportModeEl = panel.querySelector('#fliptracker-listing-export-mode');
    const listingExportStatusEl = panel.querySelector('#fliptracker-listing-status');
    const listingExportScanButton = panel.querySelector('#fliptracker-listing-scan');
    const listingExportCopyButton = panel.querySelector('#fliptracker-listing-copy');
    const listingExportDownloadButton = panel.querySelector('#fliptracker-listing-download');
    const liveCopyJsonButton = panel.querySelector('#hibid-live-copy-json');
    const liveCopyLlmButton = panel.querySelector('#hibid-live-copy-llm');
    const catalogCopyJsonButton = panel.querySelector('#hibid-catalog-copy-json');
    const catalogCopyLlmButton = panel.querySelector('#hibid-catalog-copy-llm');
    const auctionNinjaModeEl = panel.querySelector('[data-module="auctionninja"]');
    const auctionNinjaCategoryCopyJsonButton = panel.querySelector('#auctionninja-category-copy-json');
    const auctionNinjaCategoryCopyLlmButton = panel.querySelector('#auctionninja-category-copy-llm');
    const auctionNinjaCopyJsonButton = panel.querySelector('#auctionninja-catalog-copy-json');
    const auctionNinjaCopyLlmButton = panel.querySelector('#auctionninja-catalog-copy-llm');
    const auctionNinjaAccountCopyJsonButton = panel.querySelector('#auctionninja-account-copy-json');
    const auctionNinjaAccountCopyLlmButton = panel.querySelector('#auctionninja-account-copy-llm');
    const auctionNinjaAuctionsCopyJsonButton = panel.querySelector('#auctionninja-auctions-copy-json');
    const auctionNinjaAuctionsCopyLlmButton = panel.querySelector('#auctionninja-auctions-copy-llm');
    const aarModeEl = panel.querySelector('[data-module="aar"]');
    const aarAuctionsCopyJsonButton = panel.querySelector('#aar-auctions-copy-json');
    const aarAuctionsCopyLlmButton = panel.querySelector('#aar-auctions-copy-llm');
    const aarCatalogCopyJsonButton = panel.querySelector('#aar-catalog-copy-json');
    const aarCatalogCopyLlmButton = panel.querySelector('#aar-catalog-copy-llm');
    const aarOriginInput = panel.querySelector('#aar-origin-label');
    const aarRadiusInput = panel.querySelector('#aar-radius-miles');
    const govDealsModeEl = panel.querySelector('[data-module="govdeals"]');
    const govDealsSellerCopyJsonButton = panel.querySelector('#govdeals-seller-copy-json');
    const govDealsSellerCopyLlmButton = panel.querySelector('#govdeals-seller-copy-llm');
    const govDealsListingsCopyJsonButton = panel.querySelector('#govdeals-listings-copy-json');
    const govDealsListingsCopyLlmButton = panel.querySelector('#govdeals-listings-copy-llm');
    const govDealsAssetCopyJsonButton = panel.querySelector('#govdeals-asset-copy-json');
    const govDealsAssetCopyLlmButton = panel.querySelector('#govdeals-asset-copy-llm');
    const scraperStopButton = panel.querySelector('#hibid-scraper-stop');
    const debugCopyButton = panel.querySelector('#hibid-debug-copy');
    const debugClearButton = panel.querySelector('#hibid-debug-clear');
    const siteSwitcherToggle = panel.querySelector('#flipperaddon-site-switcher-toggle');
    const siteSwitcherMenu = panel.querySelector('#flipperaddon-site-switcher-menu');
    const state = { stop: false, rows: [], busy: false, listingRows: [], toastTimer: null };
    const setSiteSwitcherOpen = (open) => {
      if (!siteSwitcherMenu || !siteSwitcherToggle) return;
      const nextOpen = Boolean(open) && !state.busy;
      siteSwitcherMenu.hidden = !nextOpen;
      siteSwitcherToggle.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
      debug('site switcher toggled', { open: nextOpen });
    };
    setActiveModeTab(panel, activeMode);
    const setScrapingBusy = (busy) => {
      state.busy = Boolean(busy);
      if (scraperStopButton) scraperStopButton.style.display = busy ? '' : 'none';
      panel.querySelectorAll('[data-site-shortcut-url]').forEach(shortcut => {
        shortcut.disabled = state.busy;
        shortcut.setAttribute('aria-disabled', state.busy ? 'true' : 'false');
      });
      if (state.busy) setSiteSwitcherOpen(false);
    };
    setScrapingBusy(false);

    const status = (message) => {
      const chip = panel.querySelector('#hiba-session-chip');
      const lower = String(message || '').toLowerCase();
      const tone = lower.includes('stop') || lower.includes('bad json') || lower.includes('failed') || lower.includes('not found')
        ? 'danger'
        : (lower.includes('eligible') || lower.includes('copied') || lower.includes('download') || lower.includes('finished') ? 'success' : 'neutral');
      if (chip) {
        chip.className = `hiba-chip ${tone}`;
        chip.textContent = lower.includes('stop') ? 'paused' : (tone === 'success' ? 'ready' : (state.busy ? 'busy' : 'idle'));
      }
      if (toastEl) {
        clearTimeout(state.toastTimer);
        toastEl.textContent = String(message || '').replace(/\s+/g, ' ').slice(0, 92);
        toastEl.className = `hiba-toast show ${tone === 'danger' ? 'danger' : ''}`.trim();
        state.toastTimer = setTimeout(() => {
          toastEl.classList.remove('show');
        }, tone === 'danger' ? 3600 : 2200);
      }
      debug('status', message);
    };
    debug('unified drawer mounted', routeDebug());

    const render = (rows) => {
      state.rows = rows;
      debug('rows evaluated without preview render', { count: rows.length });
    };

    const renderListingExport = (rows) => {
      state.listingRows = rows;
      if (listingExportStatusEl) listingExportStatusEl.textContent = rows.length
        ? `Found ${rows.length} active listing card(s). Download the export, then scan/import it in FlipTracker.`
        : 'No active listing cards found. Scroll/load more listings, then scan again.';
    };

    const renderAuctionNinjaLots = (rows, context = {}) => {
      state.rows = rows;
      debug('auctionninja rows captured without preview render', {
        count: rows.length,
        title: context.title || document.title || '',
        buyerPremium: context.buyerPremium || ''
      });
    };

    const renderAarRows = (rows, context = {}) => {
      state.rows = rows;
      debug('aar rows captured without preview render', {
        count: rows.length,
        title: context.title || document.title || '',
        pageKind: context.pageKind || aarKind || ''
      });
    };

    const renderGovDealsRows = (rows, context = {}) => {
      state.rows = rows;
      debug('govdeals rows captured without preview render', {
        count: rows.length,
        title: context.title || document.title || '',
        pageKind: context.pageKind || govDealsKind || ''
      });
    };

    const currentListingExportHtml = () => buildFlipTrackerListingsExportHtml(state.listingRows, {
      pageUrl: location.href,
      generatedAt: new Date().toISOString()
    });

    const scanListingsForExport = () => {
      const rows = scanCurrentFlipTrackerListings();
      renderListingExport(rows);
      return rows;
    };

    panel.querySelectorAll('[data-mode-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        const mode = tab.dataset.modeTab;
        const target = mode === 'fliptracker'
          ? listingExportModeEl
          : (mode === 'auctionninja'
            ? auctionNinjaModeEl
            : (mode === 'aar' ? aarModeEl : (mode === 'govdeals' ? govDealsModeEl : bidControlsEl)));
        setActiveModeTab(panel, mode);
        if (target && target.style.display !== 'none') target.scrollIntoView({ block: 'nearest' });
      });
    });

    siteSwitcherToggle?.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (state.busy) return;
      setSiteSwitcherOpen(siteSwitcherMenu?.hidden !== false);
    });
    panel.querySelectorAll('[data-site-shortcut-url]').forEach(shortcut => {
      shortcut.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (state.busy || shortcut.disabled) return;
        const url = shortcut.dataset.siteShortcutUrl || '';
        if (!url) return;
        debug('site shortcut navigating', {
          id: shortcut.dataset.siteShortcutId || '',
          url
        });
        setSiteSwitcherOpen(false);
        window.location.assign(url);
      });
    });
    const closeSiteSwitcherOnOutsideClick = (event) => {
      if (!siteSwitcherMenu || siteSwitcherMenu.hidden) return;
      if (!panel.contains(event.target)) setSiteSwitcherOpen(false);
    };
    const closeSiteSwitcherOnEscape = (event) => {
      if (event.key === 'Escape') setSiteSwitcherOpen(false);
    };
    document.addEventListener('click', closeSiteSwitcherOnOutsideClick, true);
    document.addEventListener('keydown', closeSiteSwitcherOnEscape);
    panel.addEventListener('flipperaddon-panel-teardown', () => {
      document.removeEventListener('click', closeSiteSwitcherOnOutsideClick, true);
      document.removeEventListener('keydown', closeSiteSwitcherOnEscape);
    }, { once: true });

    panel.querySelector('#hibid-bid-minimize').addEventListener('click', () => {
      const body = panel.querySelector('#hibid-bid-body');
      const minimized = body.style.display !== 'none';
      setSiteSwitcherOpen(false);
      setPanelMinimized(panel, minimized);
      saveMinimized(minimized);
      debug('panel minimize toggled', { minimized });
    });
    panel.querySelector('#hibid-bid-close').addEventListener('click', () => {
      panel.dispatchEvent(new CustomEvent('flipperaddon-panel-teardown', { detail: { reason: 'close' } }));
      document.dispatchEvent(new CustomEvent('hibid-bid-assistant-close'));
      panel.remove();
    });
    scraperStopButton?.addEventListener('click', () => {
      state.stop = true;
      status('Stopped.');
      debug('scraper stop requested');
    });

    if (listingExportMode) {
      status('Ready to export active listings for FlipTracker.');
      window.setTimeout(scanListingsForExport, 500);
    }

    if (auctionNinjaMode) {
      if (auctionNinjaAccountMode) {
        const context = extractAuctionNinjaAccountContext(auctionNinjaKind);
        const visibleItems = auctionNinjaKind === 'items-won'
          ? extractAuctionNinjaWonItems()
          : (auctionNinjaKind === 'bid-history' ? extractAuctionNinjaBidHistoryItems() : extractAuctionNinjaFollowedItems());
        renderAuctionNinjaLots(visibleItems, context);
        status(`AuctionNinja ${auctionNinjaKind === 'items-won' ? 'won items' : (auctionNinjaKind === 'bid-history' ? 'bid history' : 'followed items')} ready.`);
        debug('auctionninja account mode ready', { route: activeRoute, visibleItems: visibleItems.length, context });
      } else if (auctionNinjaCategoryMode) {
        const context = extractAuctionNinjaCategoryContext();
        const visibleItems = extractAuctionNinjaCategoryItems();
        renderAuctionNinjaLots(visibleItems, context);
        status(`AuctionNinja category ready. Visible ${visibleItems.length}${context.totalItems ? `/${context.totalItems}` : ''} item(s).`);
        debug('auctionninja category mode ready', { route: activeRoute, visibleItems: visibleItems.length, context });
      } else if (auctionNinjaAuctionSearchMode) {
        const context = extractAuctionNinjaAuctionSearchContext();
        const visibleSales = extractAuctionNinjaAuctionSearchSales();
        renderAuctionNinjaLots(visibleSales, context);
        status(`AuctionNinja auction search ready. Visible ${visibleSales.length}${context.totalSales ? `/${context.totalSales}` : ''} sale(s).`);
        debug('auctionninja auction-search mode ready', { route: activeRoute, visibleSales: visibleSales.length, context });
      } else {
        const context = extractAuctionNinjaSaleContext();
        const range = parseAuctionNinjaCatalogRange(textOf(document.body || document.documentElement));
        const visibleLots = extractAuctionNinjaCatalogLots();
        renderAuctionNinjaLots(visibleLots, context);
        status(range
          ? `AuctionNinja catalog ready. Visible ${visibleLots.length}/${range.total} lot(s).`
          : `AuctionNinja ${activeRoute?.kind || 'page'} ready.`);
        debug('auctionninja mode ready', { route: activeRoute, range, visibleLots: visibleLots.length, context });
      }
    }

    const saveAarSettingsFromUi = () => {
      if (!aarMode) return getAarResearchSettings();
      const settings = saveAarResearchSettings({
        originLabel: aarOriginInput?.value || defaultAarResearchSettings().originLabel,
        radiusMiles: aarRadiusInput?.value || defaultAarResearchSettings().radiusMiles
      });
      debug('aar research settings saved', settings);
      return settings;
    };
    aarOriginInput?.addEventListener('change', saveAarSettingsFromUi);
    aarRadiusInput?.addEventListener('change', saveAarSettingsFromUi);

    if (aarMode) {
      const settings = getAarResearchSettings();
      if (aarKind === 'aar-auction-catalog') {
        const context = extractAarCatalogContext(document, location, settings);
        const visibleLots = extractAarCatalogLots(document, location);
        renderAarRows(visibleLots, context);
        status(`AAR catalog ready. Visible ${visibleLots.length}${context.expectedTotal ? `/${context.expectedTotal}` : ''} lot(s).`);
        debug('aar catalog mode ready', { route: activeRoute, visibleLots: visibleLots.length, context, settings });
      } else {
        const visibleSales = extractAarAuctionCards(document, location, settings);
        renderAarRows(visibleSales, { source: 'AAR Auctions', pageKind: 'aar-auction-list', researchSettings: settings });
        status(`AAR auction calendar ready. Visible ${visibleSales.length} auction(s).`);
        debug('aar auction-list mode ready', { route: activeRoute, visibleSales: visibleSales.length, settings });
      }
    }

    if (govDealsMode) {
      const refreshGovDealsReadyState = (reason = 'initial') => {
        if (!document.contains(panel) || state.busy) return;
        const context = govDealsKind === 'govdeals-seller'
          ? extractGovDealsSellerContext()
          : (govDealsKind === 'govdeals-asset'
            ? { source: 'GovDeals', pageKind: 'govdeals-asset', title: document.title.replace(/\s*\|\s*GovDeals.*$/i, '').trim() || 'GovDeals Asset', url: location.href, generatedAt: new Date().toISOString() }
            : extractGovDealsSearchContext());
        const visibleRows = govDealsKind === 'govdeals-asset'
          ? [extractGovDealsAssetDetail()].filter(item => item.title)
          : extractGovDealsListings(document, location, govDealsKind || 'govdeals-new-listings');
        renderGovDealsRows(visibleRows, context);
        status(`GovDeals ${govDealsKind === 'govdeals-seller' ? 'seller' : (govDealsKind === 'govdeals-asset' ? 'asset' : 'listings')} ready. Visible ${visibleRows.length} item(s).`);
        debug('govdeals mode ready', { route: activeRoute, visibleRows: visibleRows.length, context, reason });
      };
      refreshGovDealsReadyState('initial');
      [2500, 7000].forEach(delay => {
        const timer = window.setTimeout(() => refreshGovDealsReadyState(`hydration-${delay}`), delay);
        panel.addEventListener('flipperaddon-panel-teardown', () => window.clearTimeout(timer), { once: true });
      });
    }

    listingExportScanButton?.addEventListener('click', () => {
      const rows = scanListingsForExport();
      status(`Scanned ${rows.length} active listing card(s).`);
    });
    const validateListingRowsForCurrentRoute = (rows) => {
      const validation = validateScraperExportAgainstRoute({
        source: 'fliptracker-dom',
        context: { source: rows[0]?.source || '', pageKind: 'fliptracker', url: location.href },
        listings: rows
      }, 'fliptracker', currentActiveRoute());
      if (!validation.ok) {
        debug('fliptracker export blocked by route guard', {
          reason: validation.reason,
          route: currentActiveRoute(),
          rowSources: uniqueNonEmpty(rows.map(row => row.source)),
          count: rows.length
        });
        status('Blocked stale FlipTracker export; current page does not match scanned rows.');
        return false;
      }
      return true;
    };

    listingExportCopyButton?.addEventListener('click', async () => {
      scanListingsForExport();
      if (!state.listingRows.length) {
        status('Nothing to copy yet. Scroll/load listings and scan again.');
        return;
      }
      if (!validateListingRowsForCurrentRoute(state.listingRows)) return;
      const copied = await writeClipboard(currentListingExportHtml()).catch(() => false);
      status(copied ? `Copied FlipTracker export HTML for ${state.listingRows.length} listing(s).` : 'Clipboard write failed. Use Download Export HTML instead.');
    });
    listingExportDownloadButton?.addEventListener('click', () => {
      scanListingsForExport();
      if (!state.listingRows.length) {
        status('Nothing to download yet. Scroll/load listings and scan again.');
        return;
      }
      if (!validateListingRowsForCurrentRoute(state.listingRows)) return;
      const source = state.listingRows[0]?.source === 'eBay' ? 'ebay' : 'facebook';
      const filename = `FlipTracker-listings-${source}-${safeTimestamp()}.html`;
      downloadTextFile(filename, currentListingExportHtml());
      status(`Downloaded ${filename}. Put it in ImportInbox, then use FlipTracker import.`);
    });

    const scrapeAuctionNinjaForUi = async (mode) => {
      if (state.busy) return null;
      setScrapingBusy(true);
      state.stop = false;
      [
        auctionNinjaCategoryCopyJsonButton,
        auctionNinjaCategoryCopyLlmButton,
        auctionNinjaCopyJsonButton,
        auctionNinjaCopyLlmButton,
        auctionNinjaAccountCopyJsonButton,
        auctionNinjaAccountCopyLlmButton,
        auctionNinjaAuctionsCopyJsonButton,
        auctionNinjaAuctionsCopyLlmButton
      ].forEach(button => {
        if (button) button.disabled = true;
      });
      try {
        const accountLabel = auctionNinjaKind === 'items-won' ? 'won items' : (auctionNinjaKind === 'bid-history' ? 'bid history' : 'followed items');
        status(auctionNinjaAccountMode
          ? (mode === 'llm' ? `Reading AuctionNinja ${accountLabel} for LLM brief...` : `Reading AuctionNinja ${accountLabel}...`)
          : (auctionNinjaAuctionSearchMode
            ? (mode === 'llm' ? 'Scraping AuctionNinja auctions for LLM brief...' : 'Scraping AuctionNinja auctions...')
            : (mode === 'llm' ? 'Scraping AuctionNinja catalog for LLM brief...' : 'Scraping AuctionNinja catalog...')));
        const result = auctionNinjaAccountMode
          ? await scrapeAuctionNinjaAccountItems(auctionNinjaKind, status, () => state.stop)
          : (auctionNinjaAuctionSearchMode
            ? await scrapeAuctionNinjaAuctionSearchSales(status, () => state.stop)
            : (auctionNinjaCategoryMode
              ? await scrapeAuctionNinjaCategoryItems(status, () => state.stop)
              : await scrapeAuctionNinjaCatalogLots(status, () => state.stop)));
        const validation = validateScraperExportAgainstRoute(result, 'auctionninja', activeRoute);
        if (!validation.ok) {
          debug('auctionninja export blocked by route guard', {
            reason: validation.reason,
            route: activeRoute,
            context: result?.context || null,
            source: result?.source || 'unknown'
          });
          status('Blocked stale AuctionNinja export; current page does not match scraped rows.');
          return null;
        }
        const rows = result.items || result.lots || [];
        renderAuctionNinjaLots(rows, result.context);
        debug('auctionninja scrape summary', {
          source: result.source || 'unknown',
          kind: auctionNinjaKind || 'sale-catalog',
          count: rows.length,
          expectedTotal: result.expectedTotal,
          stopReason: result.stopReason || '-'
        });
        if (!rows.length && !auctionNinjaAccountMode) {
          status(`No AuctionNinja ${auctionNinjaAuctionSearchMode ? 'sales' : (auctionNinjaCategoryMode ? 'category items' : 'lots')} found. Enable debug and copy logs if this page has cards.`);
          return result;
        }
        debug('auctionninja ui scrape finished', {
          mode,
          count: rows.length,
          expectedTotal: result.expectedTotal,
          stopReason: result.stopReason,
          incomplete: result.incomplete
        });
        return result;
      } finally {
        setScrapingBusy(false);
        [
        auctionNinjaCategoryCopyJsonButton,
        auctionNinjaCategoryCopyLlmButton,
        auctionNinjaCopyJsonButton,
        auctionNinjaCopyLlmButton,
        auctionNinjaAccountCopyJsonButton,
        auctionNinjaAccountCopyLlmButton,
        auctionNinjaAuctionsCopyJsonButton,
        auctionNinjaAuctionsCopyLlmButton
        ].forEach(button => {
          if (button) button.disabled = false;
        });
      }
    };

    auctionNinjaCopyJsonButton?.addEventListener('click', async () => {
      const result = await scrapeAuctionNinjaForUi('json');
      const lots = result?.items || result?.lots || [];
      if (!lots.length) return;
      const payload = JSON.stringify({ context: result.context, lots }, null, 2);
      const copied = await writeClipboard(payload).catch(() => false);
      status(copied
        ? `Copied AuctionNinja JSON for ${lots.length}${result.expectedTotal ? `/${result.expectedTotal}` : ''} lot(s).`
        : 'AuctionNinja JSON scrape finished, but clipboard failed.');
    });

    auctionNinjaCategoryCopyJsonButton?.addEventListener('click', async () => {
      const result = await scrapeAuctionNinjaForUi('json');
      if (!result) return;
      const items = result.items || [];
      const payload = JSON.stringify({ context: result.context, items }, null, 2);
      const copied = await writeClipboard(payload).catch(() => false);
      status(copied
        ? `Copied AuctionNinja category JSON for ${items.length} item(s).`
        : 'AuctionNinja category JSON built, but clipboard failed.');
    });

    auctionNinjaCategoryCopyLlmButton?.addEventListener('click', async () => {
      const result = await scrapeAuctionNinjaForUi('llm');
      if (!result) return;
      const items = result.items || [];
      const payload = buildAuctionNinjaCategoryLlmBrief(items, result.context);
      const copied = await writeClipboard(payload).catch(() => false);
      status(copied
        ? `Copied AuctionNinja category LLM brief for ${items.length} item(s).`
        : 'AuctionNinja category LLM brief built, but clipboard failed.');
    });

    auctionNinjaCopyLlmButton?.addEventListener('click', async () => {
      const result = await scrapeAuctionNinjaForUi('llm');
      const lots = result?.items || result?.lots || [];
      if (!lots.length) return;
      const payload = buildAuctionNinjaLlmBrief(lots, result.context);
      const copied = await writeClipboard(payload).catch(() => false);
      status(copied
        ? `Copied AuctionNinja LLM brief for ${lots.length}${result.expectedTotal ? `/${result.expectedTotal}` : ''} lot(s).`
        : 'AuctionNinja LLM brief built, but clipboard failed.');
    });

    auctionNinjaAccountCopyJsonButton?.addEventListener('click', async () => {
      const result = await scrapeAuctionNinjaForUi('json');
      if (!result) return;
      const items = result.items || [];
      const payload = JSON.stringify({ context: result.context, items }, null, 2);
      const copied = await writeClipboard(payload).catch(() => false);
      const label = auctionNinjaKind === 'items-won' ? 'won items' : (auctionNinjaKind === 'bid-history' ? 'bid history' : 'followed items');
      status(copied
        ? `Copied AuctionNinja ${label} JSON for ${items.length} item(s).`
        : `AuctionNinja ${label} JSON built, but clipboard failed.`);
    });

    auctionNinjaAccountCopyLlmButton?.addEventListener('click', async () => {
      const result = await scrapeAuctionNinjaForUi('llm');
      if (!result) return;
      const items = result.items || [];
      const payload = auctionNinjaKind === 'items-won'
        ? buildAuctionNinjaWonItemsLlmBrief(items, result.context)
        : (auctionNinjaKind === 'bid-history' ? buildAuctionNinjaBidHistoryLlmBrief(items, result.context) : buildAuctionNinjaFollowedItemsLlmBrief(items, result.context));
      const copied = await writeClipboard(payload).catch(() => false);
      const label = auctionNinjaKind === 'items-won' ? 'won items' : (auctionNinjaKind === 'bid-history' ? 'bid history' : 'followed items');
      status(copied
        ? `Copied AuctionNinja ${label} LLM brief for ${items.length} item(s).`
        : `AuctionNinja ${label} LLM brief built, but clipboard failed.`);
    });

    auctionNinjaAuctionsCopyJsonButton?.addEventListener('click', async () => {
      const result = await scrapeAuctionNinjaForUi('json');
      if (!result) return;
      const sales = result.items || result.sales || [];
      const payload = JSON.stringify({ context: result.context, sales }, null, 2);
      const copied = await writeClipboard(payload).catch(() => false);
      status(copied
        ? `Copied AuctionNinja auctions JSON for ${sales.length}${result.expectedTotal ? `/${result.expectedTotal}` : ''} sale(s).`
        : 'AuctionNinja auctions JSON built, but clipboard failed.');
    });

    auctionNinjaAuctionsCopyLlmButton?.addEventListener('click', async () => {
      const result = await scrapeAuctionNinjaForUi('llm');
      if (!result) return;
      const sales = result.items || result.sales || [];
      const payload = buildAuctionNinjaAuctionSearchLlmBrief(sales, result.context);
      const copied = await writeClipboard(payload).catch(() => false);
      status(copied
        ? `Copied AuctionNinja auctions LLM brief for ${sales.length}${result.expectedTotal ? `/${result.expectedTotal}` : ''} sale(s).`
        : 'AuctionNinja auctions LLM brief built, but clipboard failed.');
    });

    const scrapeAarForUi = async (mode) => {
      if (state.busy) return null;
      setScrapingBusy(true);
      state.stop = false;
      [
        aarAuctionsCopyJsonButton,
        aarAuctionsCopyLlmButton,
        aarCatalogCopyJsonButton,
        aarCatalogCopyLlmButton
      ].forEach(button => {
        if (button) button.disabled = true;
      });
      try {
        const settings = saveAarSettingsFromUi();
        const isCatalog = aarKind === 'aar-auction-catalog';
        status(isCatalog
          ? (mode === 'llm' ? 'Scraping AAR catalog for LLM brief...' : 'Scraping AAR catalog...')
          : (mode === 'llm' ? 'Scraping AAR auction calendar for LLM brief...' : 'Scraping AAR auction calendar...'));
        const result = isCatalog
          ? await scrapeAarCatalogLots(status, () => state.stop)
          : await scrapeAarAuctionCards(status, () => state.stop);
        result.context = { ...(result.context || {}), researchSettings: settings };
        const validation = validateScraperExportAgainstRoute(result, 'aar', activeRoute);
        if (!validation.ok) {
          debug('aar export blocked by route guard', {
            reason: validation.reason,
            route: activeRoute,
            context: result?.context || null,
            source: result?.source || 'unknown'
          });
          status('Blocked stale AAR export; current page does not match scraped rows.');
          return null;
        }
        const rows = result.lots || result.sales || result.items || [];
        renderAarRows(rows, result.context);
        debug('aar ui scrape summary', {
          mode,
          kind: aarKind,
          count: rows.length,
          expectedTotal: result.expectedTotal,
          stopReason: result.stopReason || '-'
        });
        if (!rows.length) {
          status(`No AAR ${isCatalog ? 'lots' : 'auctions'} found. Enable debug and copy logs if this page has rows.`);
        }
        return result;
      } finally {
        setScrapingBusy(false);
        [
          aarAuctionsCopyJsonButton,
          aarAuctionsCopyLlmButton,
          aarCatalogCopyJsonButton,
          aarCatalogCopyLlmButton
        ].forEach(button => {
          if (button) button.disabled = false;
        });
      }
    };

    aarAuctionsCopyJsonButton?.addEventListener('click', async () => {
      const result = await scrapeAarForUi('json');
      if (!result) return;
      const sales = result.sales || result.items || [];
      if (!sales.length) return;
      const payload = JSON.stringify({ context: result.context, sales }, null, 2);
      const copied = await writeClipboard(payload).catch(() => false);
      status(copied ? `Copied AAR auctions JSON for ${sales.length} auction(s).` : 'AAR auctions JSON built, but clipboard failed.');
    });

    aarAuctionsCopyLlmButton?.addEventListener('click', async () => {
      const result = await scrapeAarForUi('llm');
      if (!result) return;
      const sales = result.sales || result.items || [];
      if (!sales.length) return;
      const payload = buildAarAuctionListLlmBrief(sales, result.context, getAarResearchSettings());
      const copied = await writeClipboard(payload).catch(() => false);
      status(copied ? `Copied AAR auctions LLM brief for ${sales.length} auction(s).` : 'AAR auctions LLM brief built, but clipboard failed.');
    });

    aarCatalogCopyJsonButton?.addEventListener('click', async () => {
      const result = await scrapeAarForUi('json');
      if (!result) return;
      const lots = result.lots || result.items || [];
      if (!lots.length) return;
      const payload = JSON.stringify({ context: result.context, lots }, null, 2);
      const copied = await writeClipboard(payload).catch(() => false);
      const countText = result.expectedTotal ? `${lots.length}/${result.expectedTotal}` : String(lots.length);
      status(copied ? `Copied AAR catalog JSON for ${countText} lot(s).` : 'AAR catalog JSON built, but clipboard failed.');
    });

    aarCatalogCopyLlmButton?.addEventListener('click', async () => {
      const result = await scrapeAarForUi('llm');
      if (!result) return;
      const lots = result.lots || result.items || [];
      if (!lots.length) return;
      const payload = buildAarCatalogLlmBrief(lots, result.context, getAarResearchSettings());
      const copied = await writeClipboard(payload).catch(() => false);
      const countText = result.expectedTotal ? `${lots.length}/${result.expectedTotal}` : String(lots.length);
      status(copied ? `Copied AAR catalog LLM brief for ${countText} lot(s).` : 'AAR catalog LLM brief built, but clipboard failed.');
    });

    const govDealsButtons = [
      govDealsSellerCopyJsonButton,
      govDealsSellerCopyLlmButton,
      govDealsListingsCopyJsonButton,
      govDealsListingsCopyLlmButton,
      govDealsAssetCopyJsonButton,
      govDealsAssetCopyLlmButton
    ];

    const scrapeGovDealsForUi = async (mode) => {
      if (state.busy) return null;
      setScrapingBusy(true);
      state.stop = false;
      govDealsButtons.forEach(button => {
        if (button) button.disabled = true;
      });
      try {
        const label = govDealsKind === 'govdeals-seller' ? 'seller page' : (govDealsKind === 'govdeals-asset' ? 'asset page' : 'listings page');
        status(mode === 'llm' ? `Scraping GovDeals ${label} for LLM brief...` : `Scraping GovDeals ${label}...`);
        const result = await scrapeGovDealsListings(status, () => state.stop);
        result.context = { ...(result.context || {}), researchSettings: getAarResearchSettings() };
        const validation = validateScraperExportAgainstRoute(result, 'govdeals', activeRoute);
        if (!validation.ok) {
          debug('govdeals export blocked by route guard', {
            reason: validation.reason,
            route: activeRoute,
            context: result?.context || null,
            source: result?.source || 'unknown'
          });
          status('Blocked stale GovDeals export; current page does not match scraped rows.');
          return null;
        }
        const rows = result.listings || result.items || [];
        renderGovDealsRows(rows, result.context);
        debug('govdeals ui scrape summary', {
          mode,
          kind: govDealsKind,
          count: rows.length,
          expectedTotal: result.expectedTotal,
          stopReason: result.stopReason || '-'
        });
        if (!rows.length) {
          status('No GovDeals listings found. Enable debug and copy logs if this page has visible assets.');
        }
        return result;
      } finally {
        setScrapingBusy(false);
        govDealsButtons.forEach(button => {
          if (button) button.disabled = false;
        });
      }
    };

    const copyGovDeals = async (mode) => {
      const result = await scrapeGovDealsForUi(mode);
      if (!result) return;
      const listings = result.listings || result.items || [];
      if (!listings.length) return;
      const payload = mode === 'llm'
        ? buildGovDealsLlmBrief(listings, result.context, getAarResearchSettings())
        : JSON.stringify({ context: result.context, listings }, null, 2);
      const copied = await writeClipboard(payload).catch(() => false);
      const countText = result.expectedTotal ? `${listings.length}/${result.expectedTotal}` : String(listings.length);
      status(copied
        ? (mode === 'llm' ? `Copied GovDeals LLM brief for ${countText} listing(s).` : `Copied GovDeals JSON for ${countText} listing(s).`)
        : `GovDeals ${mode === 'llm' ? 'LLM brief' : 'JSON'} built, but clipboard failed.`);
    };

    govDealsSellerCopyJsonButton?.addEventListener('click', () => copyGovDeals('json'));
    govDealsSellerCopyLlmButton?.addEventListener('click', () => copyGovDeals('llm'));
    govDealsListingsCopyJsonButton?.addEventListener('click', () => copyGovDeals('json'));
    govDealsListingsCopyLlmButton?.addEventListener('click', () => copyGovDeals('llm'));
    govDealsAssetCopyJsonButton?.addEventListener('click', () => copyGovDeals('json'));
    govDealsAssetCopyLlmButton?.addEventListener('click', () => copyGovDeals('llm'));

    const copyCatalogLots = async (mode) => {
      if (state.busy) return;
      setScrapingBusy(true);
      if (catalogCopyJsonButton) catalogCopyJsonButton.disabled = true;
      if (catalogCopyLlmButton) catalogCopyLlmButton.disabled = true;
      state.stop = false;
      try {
        status(mode === 'llm' ? 'Scraping catalog for LLM brief...' : 'Scraping catalog for JSON...');
        const result = await scrapeCatalogLots(status, () => state.stop);
        if (!result) {
          status('No catalog lots found. Copy debug log and check route/data source.');
          return;
        }
        const lots = result.items || result.lots || [];
        const visibleState = result.visibleState || extractHibidVisiblePageState(document, typeof location !== 'undefined' ? location : null);
        const activeCatalogRoute = currentActiveRoute();
        const validation = validateCatalogExportAgainstVisibleState(result, visibleState, activeCatalogRoute);
        if (!validation.ok) {
          debug('catalog export blocked by visible-state guard', {
            reason: validation.reason,
            source: result.source || 'unknown',
            count: lots.length,
            expectedTotal: result.expectedTotal,
            visibleState,
            route: activeCatalogRoute
          });
          status(`Blocked stale HiBid export: ${describeExportGuardFailure(validation.reason, { count: lots.length, expectedTotal: result.expectedTotal })}`);
          return;
        }
        const routeValidation = validateScraperExportAgainstRoute(result, 'catalog', activeCatalogRoute);
        if (!routeValidation.ok) {
          debug('catalog export blocked by route guard', {
            reason: routeValidation.reason,
            route: activeCatalogRoute,
            source: result.source || 'unknown',
            rowSources: uniqueNonEmpty(lots.map(row => row.source)),
            count: lots.length,
            expectedTotal: result.expectedTotal
          });
          status(`Blocked stale catalog export: ${describeExportGuardFailure(routeValidation.reason, { count: lots.length, expectedTotal: result.expectedTotal })}`);
          return;
        }
        if (!lots.length) {
          if (visibleState?.noMatches) {
            if (mode === 'json') {
              const copiedEmpty = await writeClipboard('[]').catch(() => false);
              debug('catalog empty filtered JSON copied', {
                copied: copiedEmpty,
                source: result.source || 'visible-page-state',
                visibleState
              });
              status(copiedEmpty ? 'Copied JSON for 0 lot(s). Current filters have no matches.' : 'No lots match current filters, and clipboard failed.');
              return;
            }
            debug('catalog empty filtered LLM copy skipped', {
              source: result.source || 'visible-page-state',
              visibleState
            });
            status('No lots match current filters.');
            return;
          }
          status('No catalog lots found. Copy debug log and check route/data source.');
          return;
        }
        const payload = mode === 'llm'
          ? buildLlmAuctionBrief(lots, catalogAuctionContext())
          : JSON.stringify(lots, null, 2);
        const copied = await writeClipboard(payload).catch(() => false);
        const countText = result.expectedTotal ? `${lots.length}/${result.expectedTotal}` : String(lots.length);
        let downloaded = false;
        if (!copied) {
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          const sourceSlug = isAjWillnerRoute(activeCatalogRoute) ? 'ajwillner' : 'catalog';
          const ext = mode === 'llm' ? 'txt' : 'json';
          const mime = mode === 'llm' ? 'text/plain;charset=utf-8' : 'application/json;charset=utf-8';
          try {
            downloadTextFile(`flipperaddon-${sourceSlug}-${stamp}.${ext}`, payload, mime);
            downloaded = true;
          } catch (error) {
            debug('catalog download fallback failed', { error: String(error?.message || error) });
          }
        }
        debug('catalog scrape summary', {
          source: result.source || 'unknown',
          count: lots.length,
          expectedTotal: result.expectedTotal
        });
        status(copied
          ? (mode === 'llm' ? `Copied LLM brief for ${countText} lot(s).` : `Copied JSON for ${countText} lot(s).`)
          : (downloaded ? `Scraped ${countText} lot(s); clipboard failed, downloaded ${mode === 'llm' ? 'brief' : 'JSON'}.` : `Scraped ${countText} lot(s), but clipboard failed. Copy debug log.`));
        debug('catalog lots copied', {
          mode,
          count: lots.length,
          expectedTotal: result.expectedTotal,
          source: result.source,
          copied,
          downloaded,
          stopped: result.stopped
        });
      } finally {
        setScrapingBusy(false);
        if (catalogCopyJsonButton) catalogCopyJsonButton.disabled = false;
        if (catalogCopyLlmButton) catalogCopyLlmButton.disabled = false;
      }
    };

    catalogCopyJsonButton?.addEventListener('click', () => copyCatalogLots('json'));
    catalogCopyLlmButton?.addEventListener('click', () => copyCatalogLots('llm'));
    debugCopyButton?.addEventListener('click', async () => {
      const copied = await copyDebugLog();
      status(copied ? `Copied ${getDebugLog().length} debug log entries.` : 'Debug log empty or clipboard failed.');
    });
    debugClearButton?.addEventListener('click', () => {
      clearDebugLog();
      status('Debug log cleared.');
      debug('debug log cleared from drawer');
    });

    if (liveMode) {
      saveAutoRefresh(false);
      status('Ready to copy live lots.');
    }
    const copyLiveLots = async (mode) => {
      if (state.busy) return;
      setScrapingBusy(true);
      if (liveCopyJsonButton) liveCopyJsonButton.disabled = true;
      if (liveCopyLlmButton) liveCopyLlmButton.disabled = true;
      state.stop = false;
      try {
        status('Loading all open live lots before copy...');
        const expanded = await expandLivePageLots(status, () => state.stop);
        const validation = validateScraperExportAgainstRoute(expanded, 'live', currentActiveRoute());
        if (!validation.ok) {
          debug('live export blocked by route guard', {
            reason: validation.reason,
            route: currentActiveRoute(),
            source: expanded.source || 'unknown',
            count: expanded.lots?.length || 0,
            expectedOpenLots: expanded.expectedOpenLots || null
          });
          status('Blocked stale live export; current page does not match copied lots.');
          return;
        }
        const lots = expanded.lots;
        if (!lots.length) {
          status('No live lots found to copy yet.');
          return;
        }
        const context = liveAuctionContext();
        const payload = mode === 'llm' ? buildLlmAuctionBrief(lots, context) : JSON.stringify(lots, null, 2);
        const copied = await writeClipboard(payload).catch(() => false);
        const countText = expanded.expectedOpenLots ? `${lots.length}/${expanded.expectedOpenLots}` : String(lots.length);
        if (copied) {
          status(mode === 'llm'
            ? `Copied LLM brief for ${countText} live lot(s). Open More clicks: ${expanded.loadMoreClicks}.`
            : `Copied JSON for ${countText} live lot(s). Open More clicks: ${expanded.loadMoreClicks}.`);
        } else {
          status('Clipboard write failed. Check browser permissions.');
        }
        debug('live lots copied', {
          mode,
          lots: lots.length,
          expectedOpenLots: expanded.expectedOpenLots,
          loadMoreClicks: expanded.loadMoreClicks,
          scrolls: expanded.scrolls,
          copied
        });
      } finally {
        setScrapingBusy(false);
        if (liveCopyJsonButton) liveCopyJsonButton.disabled = false;
        if (liveCopyLlmButton) liveCopyLlmButton.disabled = false;
      }
    };
    liveCopyJsonButton?.addEventListener('click', () => copyLiveLots('json'));
    liveCopyLlmButton?.addEventListener('click', () => copyLiveLots('llm'));
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function escapeHtmlText(value) {
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  if (!globalThis.__HIBID_BID_ASSISTANT_TEST__) {
    debug('boot', { version: SCRIPT_VERSION, ...routeDebug() });

    let panelClosed = false;
    let lastMountedHref = location.href;

    const teardownPanel = (reason = 'remount') => {
      const existing = document.getElementById(PANEL_ID);
      if (!existing) return false;
      existing.dispatchEvent(new CustomEvent('flipperaddon-panel-teardown', { detail: { reason } }));
      if (shouldTeardownPanelForRebuild(reason)) {
        document.dispatchEvent(new CustomEvent('flipperaddon-panel-teardown', { detail: { reason } }));
      }
      existing.remove();
      debug('panel removed for remount', { reason });
      return true;
    };

    const ensureMounted = (reason = 'unspecified') => {
      const modeInfo = resolveAssistantMode();
      const allowed = shouldInitOnLocation();
      debug('ensureMounted', { reason, allowed, mode: modeInfo.mode, ...routeDebug() });
      if (!document.body) return false;
      const existingPanel = document.getElementById(PANEL_ID);
      const existingMode = existingPanel?.dataset?.flipperaddonMode || existingPanel?.querySelector?.('.hiba-drawer')?.dataset?.flipperaddonMode || '';
      if (!allowed) {
        teardownPanel(`unsupported:${reason}`);
        return false;
      }
      if (shouldRebuildPanelForMode(existingMode, modeInfo.mode, allowed, Boolean(existingPanel))) {
        teardownPanel(`mode-change:${existingMode || 'none'}:${modeInfo.mode}:${reason}`);
      }
      if (location.href !== lastMountedHref) {
        panelClosed = false;
        lastMountedHref = location.href;
        debug('panel close state reset after URL change', { reason, href: lastMountedHref });
      }
      if (/^menu\b/i.test(reason)) panelClosed = false;
      if (panelClosed) {
        removeLegacyScraperArtifacts(reason);
        debug('ensureMounted skipped: panel closed for current page', { reason });
        return false;
      }
      removeLegacyScraperArtifacts(reason);
      if (document.getElementById(PANEL_ID)) return true;
      init();
      return true;
    };

    const mountWhenReady = (reason) => {
      if (document.body) ensureMounted(reason);
      else document.addEventListener('DOMContentLoaded', () => ensureMounted(`${reason}:domcontentloaded`), { once: true });
    };

    const registerMenuCommands = () => {
      if (typeof GM_registerMenuCommand !== 'function') {
        debug('menu commands unavailable');
        return;
      }
      GM_registerMenuCommand(MENU_COMMANDS[0], () => ensureMounted('menu remount'));
      GM_registerMenuCommand(MENU_COMMANDS[1], async () => {
        const enabled = !getStoredDebugEnabled();
        saveDebugEnabled(enabled);
        const panel = document.getElementById(PANEL_ID);
        if (panel) {
          teardownPanel('debug-toggle');
          init();
        } else {
          ensureMounted('menu toggle debug');
        }
        try {
          console.info(DEBUG_PREFIX, `Debug mode ${enabled ? 'enabled' : 'disabled'}`);
        } catch {
          // Console logging is best-effort.
        }
      });
      GM_registerMenuCommand(MENU_COMMANDS[2], async () => {
        ensureMounted('menu copy debug');
        const copied = await copyDebugLog();
        debug('menu copy debug result', { copied, entries: getDebugLog().length });
      });
      GM_registerMenuCommand(MENU_COMMANDS[3], () => {
        clearDebugLog();
        debug('debug log cleared from menu');
      });
      GM_registerMenuCommand(MENU_COMMANDS[4], () => {
        ensureMounted('menu copy lots');
        document.getElementById('hibid-catalog-copy-json')?.click();
      });
      debug('menu commands registered', MENU_COMMANDS);
    };

    mountWhenReady('boot');
    registerMenuCommands();
    document.addEventListener('hibid-bid-assistant-close', () => {
      panelClosed = true;
      debug('panel closed for current page');
    });
    setTimeout(() => ensureMounted('timeout 1s'), 1000);
    setTimeout(() => ensureMounted('timeout 3s'), 3000);
    if ('onurlchange' in window) {
      window.addEventListener('urlchange', () => ensureMounted('urlchange'));
    }
    window.addEventListener('load', () => ensureMounted('window load'));
    window.addEventListener('popstate', () => ensureMounted('popstate'));
    window.addEventListener('hashchange', () => ensureMounted('hashchange'));
    if (document.documentElement) {
      new MutationObserver(() => ensureMounted('mutation')).observe(document.documentElement, {
        childList: true,
        subtree: true
      });
    }
  }
})();
