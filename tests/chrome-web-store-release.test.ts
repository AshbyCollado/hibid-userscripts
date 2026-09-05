import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertStoreCanAcceptVersion,
  chromeWebStoreUrls,
  compareChromeVersions,
  fetchStoreStatus,
  gcloudInvocation,
  submitStorePackage,
  uploadStorePackage,
  waitForStoreUpload,
} from '../scripts/chrome-web-store-release.mjs';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('Windows gcloud launcher passes arguments as data', () => {
  const args = ['auth', 'print-access-token', '--impersonate-service-account=release@example.iam.gserviceaccount.com'];
  const invocation = gcloudInvocation(args, 'win32', { LOCALAPPDATA: 'C:\\Users\\Example Name\\AppData\\Local' });
  assert.equal(invocation.command, 'powershell.exe');
  assert.deepEqual(JSON.parse(invocation.env.FLIPPAH_GCLOUD_ARGS), args);
  assert.ok(!invocation.args.join(' ').includes('release@example'));
  assert.equal(gcloudInvocation(args, 'linux', {}).command, 'gcloud');
});

test('Store requests have timeouts and malformed success responses fail closed', async () => {
  let signal: AbortSignal | null | undefined;
  await assert.rejects(fetchStoreStatus(async (_url, init) => {
    signal = init?.signal;
    return new Response('<html>Service unavailable</html>', { status: 200 });
  }, chromeWebStoreUrls('publisher', 'item'), 'test-token'), /invalid JSON/);
  assert.ok(signal instanceof AbortSignal);
});

test('builds Chrome Web Store v2 URLs for the existing item', () => {
  const urls = chromeWebStoreUrls('publisher-1', 'item-1');
  assert.equal(urls.status, 'https://chromewebstore.googleapis.com/v2/publishers/publisher-1/items/item-1:fetchStatus');
  assert.equal(urls.upload, 'https://chromewebstore.googleapis.com/upload/v2/publishers/publisher-1/items/item-1:upload');
  assert.equal(urls.publish, 'https://chromewebstore.googleapis.com/v2/publishers/publisher-1/items/item-1:publish');
});

test('compares Store versions numerically and rejects malformed versions', () => {
  assert.equal(compareChromeVersions('0.5.46', '0.5.45'), 1);
  assert.equal(compareChromeVersions('1.0', '1.0.0.0'), 0);
  assert.throws(() => compareChromeVersions('0.5.beta', '0.5.45'), /invalid chrome extension version/i);
});

test('release gate refuses active reviews and version regressions', () => {
  assert.throws(() => assertStoreCanAcceptVersion({
    submittedItemRevisionStatus: { state: 'PENDING_REVIEW', distributionChannels: [{ crxVersion: '0.5.45' }] },
  }, '0.5.46'), /active pending review/i);

  assert.throws(() => assertStoreCanAcceptVersion({
    publishedItemRevisionStatus: { state: 'PUBLISHED', distributionChannels: [{ crxVersion: '0.5.45' }] },
  }, '0.5.45'), /must be greater/i);

  assert.doesNotThrow(() => assertStoreCanAcceptVersion({
    publishedItemRevisionStatus: { state: 'PUBLISHED', distributionChannels: [{ crxVersion: '0.5.45' }] },
  }, '0.5.46'));
});

test('uploads the ZIP and waits for asynchronous validation', async () => {
  const urls = chromeWebStoreUrls('publisher-1', 'item-1');
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let statusChecks = 0;
  const fetchImpl = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), init });
    if (String(url) === urls.upload) return jsonResponse({ uploadState: 'IN_PROGRESS' });
    statusChecks += 1;
    return jsonResponse({ lastAsyncUploadState: statusChecks === 1 ? 'IN_PROGRESS' : 'SUCCEEDED' });
  };

  const upload = await uploadStorePackage(fetchImpl, urls, 'test-token', Buffer.from('zip'));
  const completed = await waitForStoreUpload(fetchImpl, urls, 'test-token', upload, {
    intervalMs: 1,
    timeoutMs: 1_000,
    sleep: async () => undefined,
  });
  assert.equal(completed.lastAsyncUploadState, 'SUCCEEDED');
  assert.equal(calls[0]?.init?.method, 'POST');
  assert.equal(new Headers(calls[0]?.init?.headers).get('content-type'), 'application/zip');
  assert.equal(statusChecks, 2);
});

test('submits with automatic publication and review warnings blocked', async () => {
  const urls = chromeWebStoreUrls('publisher-1', 'item-1');
  let request: RequestInit | undefined;
  const result = await submitStorePackage(async (_url, init) => {
    request = init;
    return jsonResponse({ state: 'PENDING_REVIEW' });
  }, urls, 'test-token');

  assert.equal(result.state, 'PENDING_REVIEW');
  assert.deepEqual(JSON.parse(String(request?.body)), {
    publishType: 'DEFAULT_PUBLISH',
    skipReview: false,
    blockOnWarnings: true,
  });
});
