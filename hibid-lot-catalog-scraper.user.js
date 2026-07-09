// ==UserScript==
// @name         HiBid Lot Catalog Scraper
// @namespace    http://tampermonkey.net/
// @version      1.4.8
// @description  Switches HiBid catalog pages to Single Page, expands live catalogs, scrolls lazy-loaded lots, and copies enriched lot/bid data to JSON.
// @updateURL    https://raw.githubusercontent.com/AshbyCollado/hibid-userscripts/main/hibid-lot-catalog-scraper.user.js
// @downloadURL  https://raw.githubusercontent.com/AshbyCollado/hibid-userscripts/main/hibid-lot-catalog-scraper.user.js
// @match        https://hibid.com/lots*
// @match        https://hibid.com/lots/*
// @match        https://hibid.com/catalog*
// @match        https://hibid.com/catalog/*
// @match        https://hibid.com/livecatalog*
// @match        https://hibid.com/livecatalog/*
// @match        https://*.hibid.com/lots*
// @match        https://*.hibid.com/lots/*
// @match        https://*.hibid.com/catalog*
// @match        https://*.hibid.com/catalog/*
// @match        https://*.hibid.com/livecatalog*
// @match        https://*.hibid.com/livecatalog/*
// @include      https://hibid.com/*
// @include      https://*.hibid.com/*
// @run-at       document-idle
// @inject-into  content
// @noframes
// @grant        GM_setClipboard
// @grant        GM.setClipboard
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  'use strict';

  const BUTTON_ID = 'hibid-lot-catalog-scraper-copy-button';
  const FALLBACK_ID = 'hibid-lot-catalog-scraper-json';
  const DEBUG_PREFIX = '[HiBid Lot Catalog Scraper]';
  const RESUME_KEY = 'hibidLotCatalogScraperResume';
  const MENU_COMMANDS = ['Mount HiBid scraper button', 'Copy all HiBid lots now'];
  const MAX_STEPS = 1200;

  let scrapeState = {
    running: false,
    stopRequested: false
  };

  const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

  function debug(message, data) {
    try {
      if (data === undefined) console.debug(DEBUG_PREFIX, message);
      else console.debug(DEBUG_PREFIX, message, data);
    } catch (_) {
      // Debug logging must never break scraping.
    }
  }

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

  function getAuctionKey(loc = (typeof location !== 'undefined' ? location : { pathname: '' })) {
    return String(loc.pathname || '').match(/^\/(?:catalog|livecatalog)\/(\d+)/i)?.[1] || '';
  }

  function getLotTiles(root = document) {
    return Array.from(root.querySelectorAll?.('app-lot-tile[id^="lot-"]') || []);
  }

  function hasLiveTextLots(root = document) {
    const text = textOf(root.body || root.documentElement || root);
    return /Lot\s+\d+[A-Za-z-]*\s*\|/i.test(text);
  }

  function detectPageMode(root = document, loc = location) {
    if (!shouldInitOnLocation(loc)) return 'unsupported';
    const pathname = String(loc.pathname || '');
    const tileCount = getLotTiles(root).length;
    if (/^\/livecatalog\b/i.test(pathname)) return hasLiveTextLots(root) || tileCount ? 'live-catalog-grid' : 'live-catalog-loading';
    if (/^\/catalog\b/i.test(pathname)) return tileCount ? 'catalog-grid' : (hasLiveTextLots(root) ? 'live-catalog-grid' : 'auction-detail');
    if (/^\/lots?\b/i.test(pathname)) return tileCount ? 'catalog-grid' : 'catalog-loading';
    return 'unsupported';
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

  function absoluteUrl(href) {
    if (!href) return '';
    return new URL(href, location.origin).href;
  }

  function findCatalogEntryControl(root = document, loc = (typeof location !== 'undefined' ? location : { pathname: '' })) {
    const currentAuction = getAuctionKey(loc);
    const candidates = Array.from(root.querySelectorAll?.('a[href], button, [role="button"], input[type="button"], input[type="submit"]') || [])
      .filter(button => !button.disabled && !button.getAttribute?.('aria-disabled'))
      .filter(isVisible)
      .map(button => {
        const label = controlLabel(button);
        const href = controlHref(button);
        let score = 0;

        if (/shop\s+by\s+category|search|watch\s+list|\bbids?\b|find\s+auctions|sell|help|share|print|map/i.test(label)) {
          score = -100;
        } else if (/^view\s+catalog$/i.test(textOf(button))) {
          score = 120;
        } else if (/\b(?:view|open|enter)\s+catalog\b/i.test(label)) {
          score = 110;
        } else if (/\bcatalog\b/i.test(label) && href && (!currentAuction || href.includes(currentAuction))) {
          score = 80;
        } else if (href && /\/(?:catalog|livecatalog)\/\d+/i.test(href) && (!currentAuction || href.includes(currentAuction))) {
          score = 70;
        }

        return { button, score, label, href };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);

    debug('catalog entry candidates', candidates.map(item => ({ score: item.score, label: item.label, href: item.href })));
    return candidates[0]?.button || null;
  }

  function getExpectedTotal() {
    const headerText = textOf(document.querySelector('.lot-list-header'));
    const totalMatch = headerText.match(/Total Lots:\s*([\d,]+)/i);
    if (totalMatch) return Number(totalMatch[1].replace(/,/g, ''));

    const bodyText = textOf(document.body);
    const showingMatch = bodyText.match(/\bShowing\s+[\d,]+\s+to\s+[\d,]+\s+of\s+([\d,]+)\s+lots\b/i);
    if (showingMatch) return Number(showingMatch[1].replace(/,/g, ''));

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
      if (getLotTiles().length) return true;
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
    const descriptionText = textOf(tile.querySelector('.lot-description, .description, [class*="description"], [class*="lot-notes"]'));
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
      description: descriptionText,
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
      title: root?.title || (typeof document !== 'undefined' ? document.title : ''),
      url: typeof location !== 'undefined' ? location.href : '',
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
    let stuckReason = '';

    debug('live expansion started', { context, expectedOpenLots, maxSteps, waitMs });

    for (let step = 0; step < maxSteps; step += 1) {
      mergeLots(lotsById, extractLivePageLots(root));
      const countText = expectedOpenLots ? `${lotsById.size}/${expectedOpenLots}` : String(lotsById.size);
      onProgress(`Loading live lots... ${countText}`);
      debug('live expansion step', { step, count: lotsById.size, expectedOpenLots, loadMoreClicks, scrolls, stuckSteps });

      if (shouldStop()) {
        stuckReason = 'stopped-by-user';
        break;
      }
      if (expectedOpenLots && lotsById.size >= expectedOpenLots) {
        stuckReason = 'expected-open-lots-reached';
        break;
      }

      const loadMoreButton = findLiveLoadMoreButton(root);
      if (loadMoreButton) {
        debug('clicking Open More', { label: controlLabel(loadMoreButton), count: lotsById.size });
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

      if (stuckSteps >= 5) {
        stuckReason = 'stuck-no-new-lots';
        break;
      }
    }

    mergeLots(lotsById, extractLivePageLots(root));
    if (!stuckReason) stuckReason = 'max-steps-reached';
    const lots = Array.from(lotsById.values()).sort((a, b) => String(a.lot).localeCompare(String(b.lot), undefined, {
      numeric: true,
      sensitivity: 'base'
    }));
    debug('live expansion finished', { count: lots.length, expectedOpenLots, loadMoreClicks, scrolls, stuckReason });
    return { items: lots, expectedTotal: expectedOpenLots, expectedOpenLots, loadMoreClicks, scrolls, stuckReason, stopped: !!shouldStop() };
  }

  function scrapeVisibleLots(itemsMap) {
    getLotTiles().forEach(tile => {
      const lot = extractLot(tile);
      const key = lot.url || lot.id;
      if (key && lot.title) itemsMap.set(key, lot);
    });
    mergeLots(itemsMap, extractLivePageLots(document));
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

  function findNextPageButton(root = document) {
    const walker = root.createTreeWalker?.(root.body || root.documentElement, NodeFilter.SHOW_TEXT);
    while (walker) {
      const node = walker.nextNode();
      if (!node) break;
      if (!/^next$/i.test((node.textContent || '').trim())) continue;
      const control = node.parentElement?.closest?.('a[href], button, [role="button"]');
      if (control && !control.disabled && !control.getAttribute?.('aria-disabled') && isVisible(control)) {
        debug('next page text-node control', { label: controlLabel(control), href: controlHref(control) });
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
        else if (/^next$/i.test(textOf(button))) score = 120;
        else if (/\bnext\b/i.test(label) && /page|pagination|pager/i.test(button.closest?.('[class]')?.getAttribute?.('class') || '')) score = 100;
        else if (/\bpage=\d+/i.test(href) && /\bnext\b/i.test(label)) score = 80;
        return { button, score, label, href };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);

    debug('next page candidates', candidates.map(item => ({ score: item.score, label: item.label, href: item.href })));
    return candidates[0]?.button || null;
  }

  function pageLooksBusy() {
    const text = textOf(document.body);
    return /\bLoading(?:\.\.\.)?\b/i.test(text)
      || Boolean(document.querySelector('.fa-spinner, .spinner, .loading, [class*="loading"], [aria-busy="true"]'));
  }

  async function scrapeAllLots(onProgress, shouldStop) {
    const mode = detectPageMode();
    debug('scrape mode selected', { mode, url: location.href });

    if (mode === 'live-catalog-grid') {
      return expandLivePageLots(onProgress, shouldStop);
    }

    await waitForLots();
    await enableSinglePage(message => onProgress?.(message));
    await waitForLots();

    const itemsMap = new Map();
    let expectedTotal = getExpectedTotal();
    let lastCount = -1;
    let stuckChecks = 0;
    let bottomWaits = 0;
    let sameCountSteps = 0;

    scrollToTop();
    await wait(500);

    for (let step = 0; step < MAX_STEPS; step += 1) {
      scrapeVisibleLots(itemsMap);
      expectedTotal = expectedTotal || getExpectedTotal();
      if (expectedTotal && expectedTotal < itemsMap.size) expectedTotal = null;
      onProgress?.(progressText(itemsMap.size, expectedTotal, shouldStop?.()));

      if (itemsMap.size === lastCount) sameCountSteps += 1;
      else sameCountSteps = 0;
      lastCount = itemsMap.size;

      if (shouldStop?.()) break;

      if (expectedTotal && itemsMap.size >= expectedTotal) break;

      if (expectedTotal && itemsMap.size < expectedTotal && sameCountSteps >= 8) {
        const nextPage = findNextPageButton();
        if (nextPage) {
          debug('catalog clicking next page after stalled count', { count: itemsMap.size, expectedTotal, label: controlLabel(nextPage), href: controlHref(nextPage) });
          nextPage.scrollIntoView?.({ block: 'center', inline: 'nearest' });
          nextPage.click();
          sameCountSteps = 0;
          stuckChecks = 0;
          bottomWaits = 0;
          await wait(1600);
          scrollToTop();
          await wait(650);
          continue;
        }
      }

      const maxScrollTop = document.documentElement.scrollHeight - window.innerHeight;
      const currentTop = window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;

      if (currentTop >= maxScrollTop - 4) {
        const waitingForMore = expectedTotal && itemsMap.size < expectedTotal;
        if (waitingForMore && pageLooksBusy()) {
          bottomWaits += 1;
          stuckChecks = 0;
          debug('catalog bottom while busy', { count: itemsMap.size, expectedTotal, bottomWaits });
          await wait(650);
          window.scrollTo({ top: document.documentElement.scrollHeight, left: 0, behavior: 'instant' });
          continue;
        }

        if (sameCountSteps > 0) stuckChecks += 1;
        else stuckChecks = 0;
        if (waitingForMore && stuckChecks >= 5) {
          const nextPage = findNextPageButton();
          if (nextPage) {
            debug('catalog clicking next page', { count: itemsMap.size, expectedTotal, label: controlLabel(nextPage), href: controlHref(nextPage) });
            nextPage.scrollIntoView?.({ block: 'center', inline: 'nearest' });
            nextPage.click();
            stuckChecks = 0;
            bottomWaits = 0;
            await wait(1400);
            scrollToTop();
            await wait(600);
            continue;
          }
        }
        if (waitingForMore && stuckChecks < 30) {
          debug('catalog bottom waiting for lazy lots', { count: itemsMap.size, expectedTotal, stuckChecks });
          await wait(500);
          window.scrollTo({ top: Math.max(0, document.documentElement.scrollHeight - window.innerHeight - 20), left: 0, behavior: 'instant' });
          continue;
        }
        if (stuckChecks >= 5) break;
      } else {
        stuckChecks = 0;
        bottomWaits = 0;
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

  function setButtonStatus(text, color = '#111') {
    const button = document.getElementById(BUTTON_ID);
    if (!button) return;
    button.textContent = text;
    button.style.backgroundColor = color;
  }

  function currentResumeValue() {
    try {
      return sessionStorage.getItem(RESUME_KEY) || '';
    } catch (_) {
      return '';
    }
  }

  function setResumeValue(value) {
    try {
      if (value) sessionStorage.setItem(RESUME_KEY, value);
      else sessionStorage.removeItem(RESUME_KEY);
    } catch (_) {
      // Session storage may be blocked; scraping should still work manually.
    }
  }

  function shouldAutoResume() {
    const value = currentResumeValue();
    const auctionKey = getAuctionKey();
    return Boolean(value && auctionKey && value === auctionKey);
  }

  function maybeEnterCatalogGrid(onProgress = () => {}) {
    const mode = detectPageMode();
    debug('detail recovery check', { mode, url: location.href, auctionKey: getAuctionKey() });
    if (mode !== 'auction-detail') return false;

    const control = findCatalogEntryControl();
    if (!control) {
      debug('auction detail recovery failed: no View Catalog control found');
      onProgress('No lot grid or View Catalog button found.');
      return false;
    }

    const auctionKey = getAuctionKey();
    if (auctionKey) setResumeValue(auctionKey);
    const href = controlHref(control);
    debug('auction detail recovery navigating', { label: controlLabel(control), href, auctionKey });
    onProgress('Opening catalog grid...');
    if (href) {
      location.href = absoluteUrl(href);
    } else {
      control.click();
    }
    return true;
  }

  if (globalThis.__HIBID_LOT_CATALOG_SCRAPER_TEST__) {
    globalThis.HiBidLotCatalogScraperCore = {
      BUTTON_ID,
      FALLBACK_ID,
      DEBUG_PREFIX,
      MENU_COMMANDS,
      shouldInitOnLocation,
      isLiveCatalogPage,
      detectPageMode,
      findCatalogEntryControl,
      findLiveLoadMoreButton,
      findNextPageButton,
      extractLot,
      extractLivePageLots,
      expandLivePageLots,
      liveAuctionContext,
      moneyFromText,
      numberFromText,
      maybeEnterCatalogGrid
    };
    return;
  }

  debug('boot', { url: location.href, readyState: document.readyState });

  if (!shouldInitOnLocation()) {
    debug('init blocked', { url: location.href, reason: 'unsupported host/path' });
    return;
  }

  debug('init allowed', { url: location.href, mode: detectPageMode() });

  async function copyData() {
    const button = document.getElementById(BUTTON_ID);
    if (!button) {
      debug('copy requested but button is not mounted');
      return;
    }

    if (scrapeState.running) {
      scrapeState.stopRequested = true;
      setButtonStatus('Stopping...', '#9c1b1b');
      debug('stop requested');
      return;
    }

    scrapeState.running = true;
    scrapeState.stopRequested = false;
    setButtonStatus('Starting...', '#d32f2f');
    debug('copy started', { url: location.href, mode: detectPageMode() });

    if (maybeEnterCatalogGrid(message => setButtonStatus(message, '#d32f2f'))) {
      scrapeState.running = false;
      scrapeState.stopRequested = false;
      return;
    }

    const result = await scrapeAllLots(message => {
      setButtonStatus(message, '#d32f2f');
    }, () => scrapeState.stopRequested);
    const data = result.items;

    if (data.length === 0) {
      setButtonStatus('Failed. Check console.', '#111');
      debug('copy failed: no lots', { mode: detectPageMode(), result });
      scrapeState.running = false;
      return;
    }

    const payload = JSON.stringify(data, null, 2);
    const copied = await writeClipboard(payload).catch(() => false);
    if (!copied) showFallback(payload);

    setButtonStatus(result.stopped
      ? (copied ? `Stopped. Copied ${data.length} lots.` : `Stopped at ${data.length}. Select text box.`)
      : (copied ? `Success! Copied ${data.length} lots.` : `Scraped ${data.length}. Select text box.`), '#2e7d32');
    debug('copy finished', {
      count: data.length,
      copied,
      expectedTotal: result.expectedTotal,
      expectedOpenLots: result.expectedOpenLots,
      loadMoreClicks: result.loadMoreClicks,
      scrolls: result.scrolls,
      stuckReason: result.stuckReason
    });
    scrapeState.running = false;
    scrapeState.stopRequested = false;

    setTimeout(() => {
      setButtonStatus('Copy All HiBid Lots', '#111');
    }, 5000);
  }

  function ensureButton() {
    if (!shouldInitOnLocation() || !document.body) {
      debug('button mount skipped', { hasBody: !!document.body, allowed: shouldInitOnLocation() });
      return;
    }
    if (document.getElementById(BUTTON_ID)) return;

    const button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.textContent = scrapeState.running ? 'Scraping...' : 'Copy All HiBid Lots';
    button.style.cssText =
      'position:fixed;left:16px;bottom:16px;z-index:2147483647;padding:12px 16px;border-radius:999px;border:1px solid #fff3;background:#111;color:white;font:600 13px system-ui;box-shadow:0 8px 30px #0008;cursor:pointer;transition:background-color 0.3s;';
    button.addEventListener('click', copyData);
    document.body.appendChild(button);
    debug('button mounted', { id: BUTTON_ID, mode: detectPageMode() });
  }

  function maybeAutoResume() {
    if (!shouldAutoResume()) return;
    const mode = detectPageMode();
    debug('auto-resume check', { mode, resume: currentResumeValue(), auctionKey: getAuctionKey() });
    if (mode === 'auction-detail' || mode === 'catalog-loading' || mode === 'live-catalog-loading') return;
    setResumeValue('');
    setTimeout(() => {
      debug('auto-resume starting copy');
      copyData();
    }, 800);
  }

  function registerMenuCommands() {
    if (typeof GM_registerMenuCommand !== 'function') {
      debug('menu commands unavailable');
      return;
    }
    GM_registerMenuCommand(MENU_COMMANDS[0], () => {
      debug('menu command: mount button');
      ensureButton();
      setButtonStatus('Copy All HiBid Lots', '#111');
    });
    GM_registerMenuCommand(MENU_COMMANDS[1], () => {
      debug('menu command: copy all lots');
      ensureButton();
      copyData();
    });
    debug('menu commands registered', MENU_COMMANDS);
  }

  ensureButton();
  registerMenuCommands();
  maybeAutoResume();
  setTimeout(ensureButton, 1000);
  setTimeout(ensureButton, 3000);
  setInterval(ensureButton, 5000);
  new MutationObserver(() => {
    const hadButton = !!document.getElementById(BUTTON_ID);
    ensureButton();
    if (!hadButton && document.getElementById(BUTTON_ID)) debug('button remounted after DOM mutation');
    maybeAutoResume();
  }).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
})();
