import { parseAmazonCandidates } from '../intelligence/us-deal-intelligence.js';
import { isAmazonChallengeHtml } from '../intelligence/retail-policy.js';

const token = new URL(location.href).searchParams.get('flippahToken') || '';

if (window.top === window && /^[a-z0-9-]{8,100}$/i.test(token)) {
  const startedAt = Date.now();
  let sent = false;

  const finish = (status: 'ok' | 'no_results' | 'blocked' | 'parse_error', message: string): void => {
    if (sent) return;
    const html = document.documentElement?.outerHTML || '';
    const candidates = status === 'ok' ? parseAmazonCandidates(html).slice(0, 30) : [];
    sent = true;
    void chrome.runtime.sendMessage({
      type: 'flippah:amazon.browser.result',
      token,
      status: candidates.length ? 'ok' : status === 'ok' ? 'parse_error' : status,
      candidates,
      message: candidates.length ? `Parsed ${candidates.length} Amazon.com candidate(s)` : message,
    });
  };

  const inspect = (): void => {
    if (sent) return;
    const html = document.documentElement?.outerHTML || '';
    if (isAmazonChallengeHtml(html)) {
      finish('blocked', 'Amazon.com returned a challenge page');
      return;
    }
    if (parseAmazonCandidates(html).length) {
      finish('ok', 'Amazon.com results loaded');
      return;
    }
    const text = document.body?.innerText || '';
    if (/(?:did not match any products|no results for|try checking your spelling)/i.test(text)) {
      finish('no_results', 'Amazon.com returned no product results');
      return;
    }
    if (Date.now() - startedAt >= 12_000) {
      finish('parse_error', 'Amazon.com loaded without readable product results');
      return;
    }
    window.setTimeout(inspect, 350);
  };

  inspect();
}
