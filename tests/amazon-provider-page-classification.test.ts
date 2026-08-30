import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyAmazonNoMatch,
  classifyAmazonProviderPage,
  isAmazonChallengeHtml,
  isAmazonNoResultsHtml,
} from '../src/intelligence/retail-policy.js';

test('genuine Amazon robot checks and automated-access pages are blocked with distinct reasons', () => {
  const challenge = classifyAmazonProviderPage(`
    <html><head><title>Robot Check</title></head>
    <body><form action="/errors/validateCaptcha">Enter the characters you see below</form></body></html>
  `, 0);
  assert.equal(challenge.status, 'blocked');
  assert.equal(challenge.reason, 'challenge');

  const automatedAccess = classifyAmazonProviderPage(`
    <html><body>To discuss automated access to Amazon data please contact
    api-services-support@amazon.com.</body></html>
  `, 0);
  assert.equal(automatedAccess.status, 'blocked');
  assert.equal(automatedAccess.reason, 'automated_access');
});

test('incidental captcha text does not turn an ordinary Amazon result page into a challenge', () => {
  const ordinary = `
    <html><head><title>Captcha puzzle books</title></head><body>
      <script>window.telemetry = { captcha: 'supported' };</script>
      <div data-asin="B000000001"><h2>A field guide to captcha accessibility</h2></div>
    </body></html>
  `;
  assert.equal(isAmazonChallengeHtml(ordinary), false);
  assert.deepEqual(classifyAmazonProviderPage(ordinary, 1), {
    status: 'ok',
    reason: 'parsed_candidates',
    message: 'Parsed 1 Amazon.com candidate(s)',
  });
});

test('explicit no-results pages are conclusive while unrecognized HTML is a parse error', () => {
  const noResults = '<main><h2>No results for "B0NOTREAL"</h2><p>Try checking your spelling or use more general terms.</p></main>';
  assert.equal(isAmazonNoResultsHtml(noResults), true);
  assert.equal(classifyAmazonProviderPage(noResults, 0).status, 'no_results');
  assert.equal(classifyAmazonProviderPage(noResults, 0).reason, 'explicit_no_results');

  const changedMarkup = '<html><head><title>Amazon.com</title></head><body><main>Search is temporarily unavailable.</main></body></html>';
  assert.equal(isAmazonNoResultsHtml(changedMarkup), false);
  assert.equal(classifyAmazonProviderPage(changedMarkup, 0).status, 'parse_error');
  assert.equal(classifyAmazonProviderPage(changedMarkup, 0).reason, 'unrecognized_page');
});

test('parsed candidates take precedence over incidental no-results copy', () => {
  const resultPage = '<div data-asin="B000000001"><h2>Exact product</h2></div><footer>No results for another department</footer>';
  const classification = classifyAmazonProviderPage(resultPage, 1);
  assert.equal(classification.status, 'ok');
  assert.equal(classification.reason, 'parsed_candidates');
});

test('an exact candidate without a purchase price remains no-match with a specific reason', () => {
  const missingPrice = classifyAmazonNoMatch([{
    accepted: true,
    score: 8,
    price: null,
    sponsored: false,
    used: false,
  }]);
  assert.deepEqual(missingPrice, {
    status: 'no_match',
    reason: 'exact_candidate_missing_purchase_price',
  });

  for (const candidate of [
    { accepted: true, score: 8, price: 49.99, sponsored: false, used: false },
    { accepted: true, score: 2, price: null, sponsored: false, used: false },
    { accepted: true, score: 8, price: null, sponsored: true, used: false },
    { accepted: true, score: 8, price: null, sponsored: false, used: true },
  ]) {
    assert.equal(classifyAmazonNoMatch([candidate]).reason, 'no_exact_candidate');
  }
});
