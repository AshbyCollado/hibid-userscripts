import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

test('Windows gcloud launcher invokes the installed SDK without PowerShell', () => {
  const args = ['auth', 'print-access-token', '--impersonate-service-account=release@example.iam.gserviceaccount.com'];
  const invocation = gcloudInvocation(args, 'win32', { ComSpec: 'C:\\Windows\\System32\\cmd.exe' });
  assert.equal(invocation.command, 'C:\\Windows\\System32\\cmd.exe');
  assert.deepEqual(invocation.args, ['/d', '/s', '/c', `"gcloud.cmd ${args.join(' ')}"`]);
  assert.throws(() => gcloudInvocation(['version & echo unsafe'], 'win32', {}), /unsupported characters/);
  assert.equal(gcloudInvocation(args, 'linux', {}).command, 'gcloud');
});

test('Windows gcloud launcher executes an SDK path with spaces even when it is absent from PATH', { skip: process.platform !== 'win32' }, () => {
  const temp = mkdtempSync(path.join(tmpdir(), 'flippah-cws-sdk-'));
  const sdk = path.join(temp, 'Google', 'Cloud SDK', 'google-cloud-sdk', 'bin', 'gcloud.cmd');
  mkdirSync(path.dirname(sdk), { recursive: true });
  writeFileSync(sdk, '@echo off\r\necho SDK-LAUNCH-OK\r\n');
  try {
    const env = { ...process.env, LOCALAPPDATA: temp, PATH: '' };
    const invocation = gcloudInvocation(['version'], 'win32', env);
    const output = execFileSync(invocation.command, invocation.args, { env: invocation.env, encoding: 'utf8', windowsHide: true,
      windowsVerbatimArguments: invocation.windowsVerbatimArguments });
    assert.match(output, /SDK-LAUNCH-OK/);
  } finally {
    if (!path.resolve(temp).startsWith(`${path.resolve(tmpdir())}${path.sep}`)) throw new Error('Unsafe temporary cleanup path');
    rmSync(temp, { recursive: true, force: true });
  }
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
