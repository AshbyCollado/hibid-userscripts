// ==UserScript==
// @name         HiBid Lot Catalog Scraper
// @namespace    http://tampermonkey.net/
// @version      1.3.1
// @description  Switches HiBid catalog pages to Single Page, expands live catalogs, scrolls lazy-loaded lots, and copies enriched lot/bid data to JSON.
// @updateURL    https://raw.githubusercontent.com/AshbyCollado/hibid-userscripts/main/hibid-lot-catalog-scraper.user.js
// @downloadURL  https://raw.githubusercontent.com/AshbyCollado/hibid-userscripts/main/hibid-lot-catalog-scraper.user.js
// @match        https://hibid.com/lots*
// @match        https://hibid.com/lots/*
// @match        https://hibid.com/catalog/*
// @match        https://hibid.com/livecatalog/*
// @match        https://*.hibid.com/lots*
// @match        https://*.hibid.com/lots/*
// @match        https://*.hibid.com/catalog/*
// @match        https://*.hibid.com/livecatalog/*
// @grant        GM_setClipboard
// @grant        GM.setClipboard
// ==/UserScript==

(function () {
  'use strict';

  const BUTTON_ID = 'hibid-scraper-copy-button';
  const FALLBACK_ID = 'hibid-scraper-json';
  const MAX_STEPS = 1200;

  let scrapeState = {
    running: false,
    stopRequested: false
  };

  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  function textOf(el) {
    return (el?.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function shouldInitOnLocation(loc = location) {
    const host = String(loc.hostname || '').toLowerCase();
    const pathname = String(loc.pathname || '');
    if (host !== 'hibid.com' && !host.endsWith('.hibid.com')) return false;
    return /^\/(?:lots?|catalog|livecatalog)\b/i.test(pathname);
  }

  function isLiveCatalogPage(loc = location) {
    return /^\/livecatalog\b/i.test(String(loc.pathname || ''));
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

  function absoluteUrl(href) {
    if (!href) return '';
    return new URL(href, location.origin).href;
  }

  function getExpectedTotal() {
    const headerText = textOf(document.querySelector('.lot-list-header'));
    const totalMatch = headerText.match(/Total Lots:\s*([\d,]+)/i);
    if (totalMatch) return Number(totalMatch[1].replace(/,/g, ''));

    const bodyText = textOf(document.body);
    const ofMatch = bodyText.match(/\b(?:of|total)\s+([\d,]+)\s+lots\b/i);
    if (ofMatch) return Number(ofMatch[1].replace(/,/g, ''));

    return null;
  }

  function isSinglePageOn() {
    const headerText = textOf(document.querySelector('.lot-list-header'));
    const icon = document.querySelector('.single-page-button i');
    return /Total Lots:\s*\d/i.test(headerText) || icon?.classList.contains('fa-toggle-on');
  }

  async function enableSinglePage(onProgress) {
    const button = document.querySelector('.single-page-button');
    if (!button || isSinglePageOn()) return;

    onProgress?.('Turning on Single Page...');
    button.click();

    for (let i = 0; i < 60; i += 1) {
      await wait(250);
      if (isSinglePageOn()) return;
    }
  }

  async function waitForLots() {
    for (let i = 0; i < 80; i += 1) {
      if (document.querySelector('app-lot-tile[id^="lot-"]')) return true;
      await wait(250);
    }
    return false;
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
    const bidButtonText = textOf(tile.querySelector('.lot-bid-button'));
    const bidStatusEl = tile.querySelector(
      '.bid-status.winning, .bid-status.outbid, .bid-status.losing, .bid-status, .lot-tile-bid-status'
    );
    const bidStatusRoot = tile.querySelector('.lot-tile-bid-status .bid-status');
    const winningEl = tile.querySelector('.bid-status.winning, [class*="bid-status-winning"], [class*="lot-status-winning"]');
    const outbidEl = tile.querySelector('.bid-status.outbid, .bid-status.losing, [class*="bid-status-outbid"], [class*="lot-status-outbid"], [class*="losing"]');
    const watchEl = tile.querySelector('app-watch-unwatch, .watch-container, .unwatch-container');
    const statusClass = [
      tile.getAttribute('class') || '',
      tile.querySelector('[class*="bid-status-border"]')?.getAttribute('class') || '',
      tile.querySelector('[class*="live-catalog-high-bid-status"]')?.getAttribute('class') || '',
      tile.querySelector('[class*="lot-status-"]')?.getAttribute('class') || '',
      bidStatusRoot?.getAttribute('class') || '',
      bidStatusEl?.getAttribute('class') || ''
    ].join(' ').trim();
    const bidStatusText = textOf(bidStatusEl);
    const bidStatusData = bidStatusRoot?.getAttribute('data-status') || '';
    const imageEl = tile.querySelector('img.lot-thumbnail, img');
    const href = titleLink?.getAttribute('href') || '';
    const rawText = textOf(tile);
    const allStatusText = `${textOf(winningEl)} ${textOf(outbidEl)} ${bidStatusText} ${bidStatusData} ${statusClass} ${rawText}`;
    const userBidStatus = extractUserBidStatus(allStatusText);
    const highBidAmount = moneyFromText(highBidText);
    const nextBidAmount = moneyFromText(nextBidText || bidButtonText);

    return {
      id: tile.id.replace(/^lot-/, ''),
      lot: lotNumber,
      title: textOf(titleEl) || titleLink?.getAttribute('aria-label') || '',
      highBid: highBidText,
      highBidAmount,
      currentPrice: highBidAmount,
      currentBid: highBidAmount,
      bidCount: bidCountText,
      bidCountNumber: numberFromText(bidCountText),
      timeLeft: timeLeftText,
      nextBid: nextBidText,
      nextBidAmount,
      bidButton: bidButtonText,
      userBidStatus,
      isWinning: userBidStatus === 'Winning',
      isOutbid: userBidStatus === 'Outbid',
      bidStatus: bidStatusText,
      bidStatusData,
      bidStatusClass: statusClass,
      watched: /unwatch|watching/i.test(`${textOf(watchEl)} ${watchEl?.getAttribute('class') || ''}`),
      image: imageEl?.currentSrc || imageEl?.src || '',
      url: absoluteUrl(href),
      rawText
    };
  }

  function moneyFromText(value) {
    const match = (value || '').match(/([\d,]+(?:\.\d{2})?)\s*USD/i);
    return match ? Number(match[1].replace(/,/g, '')) : null;
  }

  function numberFromText(value) {
    const match = (value || '').match(/([\d,]+)/);
    return match ? Number(match[1].replace(/,/g, '')) : null;
  }

  function extractUserBidStatus(value) {
    if (/outbid|losing|not winning/i.test(value)) return 'Outbid';
    if (/winning|high bidder|you'?re winning|you are winning/i.test(value)) return 'Winning';
    if (/you'?ve bid|you have bid|your bid/i.test(value)) return 'Bid Placed';
    return '';
  }

  function liveAuctionContext(root = document) {
    const text = textOf(root.body || root.documentElement || root);
    return {
      title: document?.title || '',
      url: location?.href || '',
      totalLots: numberFromText(text.match(/Total Lots:\s*([\d,]+)/i)?.[1] || ''),
      openLots: numberFromText(text.match(/Open Lots:\s*([\d,]+)/i)?.[1] || '')
    };
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

  function mergeLots(target, lots) {
    lots.forEach(lot => {
      const key = lot?.url || lot?.id || lot?.lot;
      if (key && lot.title) target.set(String(key), lot);
    });
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

        return { button, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);

    return candidates[0]?.button || null;
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
    const maxSteps = options.maxSteps ?? 140;
    const waitMs = options.waitMs ?? 350;
    const lotsById = new Map();
    const context = liveAuctionContext(root);
    const expectedOpenLots = context.openLots || 0;
    let lastCount = -1;
    let stuckSteps = 0;
    let loadMoreClicks = 0;
    let scrolls = 0;

    for (let step = 0; step < maxSteps; step += 1) {
      mergeLots(lotsById, extractLivePageLots(root));
      const countText = expectedOpenLots ? `${lotsById.size}/${expectedOpenLots}` : String(lotsById.size);
      onProgress(`Loading live lots... ${countText}`);

      if (shouldStop()) break;
      if (expectedOpenLots && lotsById.size >= expectedOpenLots) break;

      const loadMoreButton = findLiveLoadMoreButton(root);
      if (loadMoreButton) {
        loadMoreButton.scrollIntoView?.({ block: 'center', inline: 'nearest' });
        loadMoreButton.click();
        loadMoreClicks += 1;
        await wait(waitMs);
        continue;
      }

      const didScroll = scrollLiveLots(root);
      if (didScroll) scrolls += 1;
      await wait(waitMs);
      mergeLots(lotsById, extractLivePageLots(root));

      if (lotsById.size === lastCount) {
        stuckSteps += 1;
      } else {
        stuckSteps = 0;
        lastCount = lotsById.size;
      }

      if (stuckSteps >= 5) break;
    }

    mergeLots(lotsById, extractLivePageLots(root));
    const lots = Array.from(lotsById.values()).sort((a, b) => String(a.lot).localeCompare(String(b.lot), undefined, {
      numeric: true,
      sensitivity: 'base'
    }));
    return { items: lots, expectedTotal: expectedOpenLots, loadMoreClicks, scrolls, stopped: !!shouldStop() };
  }

  function scrapeVisibleLots(itemsMap) {
    document.querySelectorAll('app-lot-tile[id^="lot-"]').forEach(tile => {
      const lot = extractLot(tile);
      const key = lot.url || lot.id;
      if (key && lot.title) itemsMap.set(key, lot);
    });
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }

  function progressText(count, total, stopped) {
    if (stopped) return `Stopping... ${count} lots`;
    if (total && total >= count) return `Scraping ${count}/${total}...`;
    return `Scraping ${count} lots...`;
  }

  async function scrapeAllLots(onProgress, shouldStop) {
    if (isLiveCatalogPage()) {
      return expandLivePageLots(onProgress, shouldStop);
    }

    await waitForLots();
    await enableSinglePage(message => onProgress?.(message));
    await waitForLots();

    const itemsMap = new Map();
    let expectedTotal = getExpectedTotal();
    let lastCount = -1;
    let stuckChecks = 0;

    scrollToTop();
    await wait(500);

    for (let step = 0; step < MAX_STEPS; step += 1) {
      scrapeVisibleLots(itemsMap);
      expectedTotal = expectedTotal || getExpectedTotal();
      if (expectedTotal && expectedTotal < itemsMap.size) expectedTotal = null;
      onProgress?.(progressText(itemsMap.size, expectedTotal, shouldStop?.()));

      if (shouldStop?.()) break;

      if (expectedTotal && itemsMap.size >= expectedTotal) break;

      const maxScrollTop = document.documentElement.scrollHeight - window.innerHeight;
      const currentTop = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;

      if (currentTop >= maxScrollTop - 4) {
        if (itemsMap.size === lastCount) stuckChecks += 1;
        lastCount = itemsMap.size;
        if (stuckChecks >= 5) break;
      } else {
        stuckChecks = 0;
      }

      window.scrollBy({ top: Math.max(650, Math.floor(window.innerHeight * 0.9)), left: 0, behavior: 'instant' });
      await wait(220);
    }

    scrapeVisibleLots(itemsMap);
    onProgress?.(progressText(itemsMap.size, expectedTotal, shouldStop?.()));
    return {
      items: Array.from(itemsMap.values()),
      stopped: !!shouldStop?.(),
      expectedTotal
    };
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

  function showFallback(payload) {
    let box = document.getElementById(FALLBACK_ID);
    if (!box) {
      box = document.createElement('textarea');
      box.id = FALLBACK_ID;
      box.style.cssText =
        'position:fixed;right:16px;bottom:64px;z-index:999999;width:520px;height:300px;background:#111;color:#fff;border:1px solid #fff5;border-radius:12px;padding:10px;font:12px monospace;box-shadow:0 8px 30px #0008';
      document.body.appendChild(box);
    }
    box.value = payload;
    box.focus();
    box.select();
  }

  if (globalThis.__HIBID_LOT_CATALOG_SCRAPER_TEST__) {
    globalThis.HiBidLotCatalogScraperCore = {
      shouldInitOnLocation,
      isLiveCatalogPage,
      findLiveLoadMoreButton,
      extractLivePageLots,
      expandLivePageLots,
      liveAuctionContext,
      moneyFromText,
      numberFromText
    };
    return;
  }

  if (!shouldInitOnLocation()) return;

  async function copyData() {
    if (scrapeState.running) {
      scrapeState.stopRequested = true;
      button.textContent = 'Stopping...';
      button.style.backgroundColor = '#9c1b1b';
      return;
    }

    scrapeState.running = true;
    scrapeState.stopRequested = false;
    button.textContent = 'Starting...';
    button.style.backgroundColor = '#d32f2f';

    const result = await scrapeAllLots(message => {
      button.textContent = message;
    }, () => scrapeState.stopRequested);
    const data = result.items;

    if (data.length === 0) {
      button.textContent = 'Failed. Try again.';
      button.style.backgroundColor = '#111';
      scrapeState.running = false;
      return;
    }

    const payload = JSON.stringify(data, null, 2);
    const copied = await writeClipboard(payload).catch(() => false);
    if (!copied) showFallback(payload);

    button.textContent = result.stopped
      ? (copied ? `Stopped. Copied ${data.length} lots.` : `Stopped at ${data.length}. Select text box.`)
      : (copied ? `Success! Copied ${data.length} lots.` : `Scraped ${data.length}. Select text box.`);
    button.style.backgroundColor = '#2e7d32';
    scrapeState.running = false;
    scrapeState.stopRequested = false;

    setTimeout(() => {
      button.textContent = 'Copy All HiBid Lots';
      button.style.backgroundColor = '#111';
    }, 5000);
  }

  const oldButton = document.getElementById(BUTTON_ID);
  if (oldButton) oldButton.remove();

  const button = document.createElement('button');
  button.id = BUTTON_ID;
  button.type = 'button';
  button.textContent = 'Copy All HiBid Lots';
  button.style.cssText =
    'position:fixed;left:16px;bottom:16px;z-index:2147483647;padding:12px 16px;border-radius:999px;border:1px solid #fff3;background:#111;color:white;font:600 13px system-ui;box-shadow:0 8px 30px #0008;cursor:pointer;transition:background-color 0.3s;';
  button.addEventListener('click', copyData);

  document.body.appendChild(button);
})();
