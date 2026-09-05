import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const CHROME_WEB_STORE_SCOPE = 'https://www.googleapis.com/auth/chromewebstore';
export const DEFAULT_EXTENSION_ID = 'kfpfojddcfgglgbanijddljiaplifhga';

function versionParts(value) {
  const parts = String(value || '').trim().split('.');
  if (!parts.length || parts.length > 4 || parts.some((part) => !/^\d+$/.test(part))) return null;
  const values = parts.map(Number);
  return values.every((part) => part >= 0 && part <= 65_535) ? values : null;
}

export function compareChromeVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  if (!a || !b) throw new Error(`Invalid Chrome extension version: ${!a ? left : right}`);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference) return Math.sign(difference);
  }
  return 0;
}

export function chromeWebStoreUrls(publisherId, extensionId) {
  const publisher = encodeURIComponent(String(publisherId || '').trim());
  const item = encodeURIComponent(String(extensionId || '').trim());
  if (!publisher || !item) throw new Error('Chrome Web Store publisher ID and extension ID are required');
  const name = `publishers/${publisher}/items/${item}`;
  return {
    status: `https://chromewebstore.googleapis.com/v2/${name}:fetchStatus`,
    upload: `https://chromewebstore.googleapis.com/upload/v2/${name}:upload`,
    publish: `https://chromewebstore.googleapis.com/v2/${name}:publish`,
  };
}

function revisionVersions(revision) {
  return Array.isArray(revision?.distributionChannels)
    ? revision.distributionChannels.map((channel) => String(channel?.crxVersion || '')).filter(Boolean)
    : [];
}

export function assertStoreCanAcceptVersion(status, nextVersion) {
  if (status?.takenDown) throw new Error('Chrome Web Store item is taken down; resolve the dashboard issue before releasing');
  if (status?.warned) throw new Error('Chrome Web Store item has a policy warning; resolve it before releasing');
  const submittedState = String(status?.submittedItemRevisionStatus?.state || '');
  if (submittedState === 'PENDING_REVIEW' || submittedState === 'STAGED') {
    throw new Error(`Chrome Web Store already has an active ${submittedState.toLowerCase().replaceAll('_', ' ')} submission`);
  }
  const existingVersions = [
    ...revisionVersions(status?.publishedItemRevisionStatus),
    ...revisionVersions(status?.submittedItemRevisionStatus),
  ];
  for (const existing of existingVersions) {
    if (compareChromeVersions(nextVersion, existing) <= 0) {
      throw new Error(`Version ${nextVersion} must be greater than Chrome Web Store version ${existing}`);
    }
  }
}

async function responseJson(response, operation) {
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { throw new Error(`${operation} returned invalid JSON`); }
  if (!response.ok) {
    const message = String(body?.error?.message || body?.message || `${operation} failed with HTTP ${response.status}`).slice(0, 500);
    throw new Error(message);
  }
  return body;
}

function apiHeaders(accessToken, json = false) {
  return {
    authorization: `Bearer ${accessToken}`,
    ...(json ? { 'content-type': 'application/json' } : {}),
  };
}

export async function fetchStoreStatus(fetchImpl, urls, accessToken) {
  return responseJson(await fetchImpl(urls.status, {
    method: 'GET',
    headers: apiHeaders(accessToken),
    signal: AbortSignal.timeout(30_000),
  }), 'Chrome Web Store status request');
}

export async function uploadStorePackage(fetchImpl, urls, accessToken, archive) {
  return responseJson(await fetchImpl(urls.upload, {
    method: 'POST',
    headers: { ...apiHeaders(accessToken), 'content-type': 'application/zip' },
    body: archive,
    signal: AbortSignal.timeout(120_000),
  }), 'Chrome Web Store package upload');
}

function uploadState(value) {
  return String(value?.uploadState || value?.lastAsyncUploadState || '').replace(/^UPLOAD_/, '');
}

export async function waitForStoreUpload(fetchImpl, urls, accessToken, initial, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || 120_000;
  const intervalMs = Number(options.intervalMs) || 2_000;
  const sleep = options.sleep || ((delay) => new Promise((resolve) => setTimeout(resolve, delay)));
  let state = uploadState(initial);
  if (state === 'SUCCEEDED') return initial;
  if (state === 'FAILED') throw new Error('Chrome Web Store rejected the uploaded package');
  const deadline = Date.now() + timeoutMs;
  while (state === 'IN_PROGRESS' || !state) {
    if (Date.now() >= deadline) throw new Error('Chrome Web Store package validation timed out');
    await sleep(intervalMs);
    const status = await fetchStoreStatus(fetchImpl, urls, accessToken);
    state = uploadState(status);
    if (state === 'SUCCEEDED') return status;
    if (state === 'FAILED') throw new Error('Chrome Web Store rejected the uploaded package');
  }
  throw new Error(`Unexpected Chrome Web Store upload state: ${state}`);
}

export async function submitStorePackage(fetchImpl, urls, accessToken) {
  const result = await responseJson(await fetchImpl(urls.publish, {
    method: 'POST',
    headers: apiHeaders(accessToken, true),
    signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({
      publishType: 'DEFAULT_PUBLISH',
      skipReview: false,
      blockOnWarnings: true,
    }),
  }), 'Chrome Web Store review submission');
  const warnings = Array.isArray(result?.warningInfo?.warnings) ? result.warningInfo.warnings : [];
  if (warnings.length) throw new Error(`Chrome Web Store returned ${warnings.length} release warning${warnings.length === 1 ? '' : 's'}`);
  return result;
}

function configPath(environment = process.env) {
  const base = environment.LOCALAPPDATA || path.join(os.homedir(), '.config');
  return path.join(base, 'Flippah', 'chrome-web-store.json');
}

async function loadLocalConfig(environment = process.env) {
  let file = {};
  try { file = JSON.parse(await readFile(configPath(environment), 'utf8')); } catch { /* configuration is optional for prepare-only runs */ }
  return {
    publisherId: String(environment.CWS_PUBLISHER_ID || file.publisherId || '').trim(),
    extensionId: String(environment.CWS_EXTENSION_ID || file.extensionId || DEFAULT_EXTENSION_ID).trim(),
    serviceAccountEmail: String(environment.CWS_SERVICE_ACCOUNT_EMAIL || file.serviceAccountEmail || '').trim(),
  };
}

export function gcloudInvocation(args, platform = process.platform, environment = process.env) {
  if (platform !== 'win32') return { command: 'gcloud', args, env: environment };
  return {
    command: 'powershell.exe',
    args: ['-NoProfile', '-NonInteractive', '-Command',
      '$ErrorActionPreference = "Stop"; $a = @(ConvertFrom-Json $env:FLIPPAH_GCLOUD_ARGS); $exe = Join-Path $env:LOCALAPPDATA "Google\\Cloud SDK\\google-cloud-sdk\\bin\\gcloud.cmd"; if (!(Test-Path -LiteralPath $exe)) { $exe = (Get-Command gcloud.cmd -ErrorAction Stop).Source }; & $exe @a; exit $LASTEXITCODE'],
    env: { ...environment, FLIPPAH_GCLOUD_ARGS: JSON.stringify(args) },
  };
}

async function gcloudAccessToken(serviceAccountEmail) {
  if (!serviceAccountEmail) throw new Error(`Set serviceAccountEmail in ${configPath()} before publishing`);
  const invocation = gcloudInvocation([
    'auth', 'print-access-token',
    `--impersonate-service-account=${serviceAccountEmail}`,
    `--scopes=${CHROME_WEB_STORE_SCOPE}`,
  ]);
  let stdout;
  try {
    ({ stdout } = await execFileAsync(invocation.command, invocation.args, {
      env: invocation.env, windowsHide: true, timeout: 60_000, maxBuffer: 1024 * 1024,
    }));
  } catch { throw new Error('Google authentication failed. Check gcloud login and service-account impersonation access.'); }
  const token = stdout.trim();
  if (!token) throw new Error('gcloud did not return a Chrome Web Store access token');
  return token;
}

async function accessToken(config, environment = process.env) {
  const provided = String(environment.CWS_ACCESS_TOKEN || '').trim();
  return provided || gcloudAccessToken(config.serviceAccountEmail);
}

async function run(command, args) {
  if (command === 'npm') {
    const npmCli = String(process.env.npm_execpath || '').trim();
    if (!npmCli) throw new Error('Run this publisher through npm run release:chrome');
    await execFileAsync(process.execPath, [npmCli, ...args], {
      cwd: process.cwd(),
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    });
    return;
  }
  await execFileAsync(command, args, { cwd: process.cwd(), windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
}

async function assertCleanWorktree() {
  const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: process.cwd(), windowsHide: true });
  if (stdout.trim()) throw new Error('Commit or stash the working tree before preparing a Chrome Web Store release');
}

function parseArguments(argv) {
  const unknown = argv.find((arg) => arg.startsWith('--') && !['--publish', '--status'].includes(arg));
  if (unknown) throw new Error(`Unknown release option: ${unknown}`);
  const publish = argv.includes('--publish');
  const statusOnly = argv.includes('--status');
  if (publish && statusOnly) throw new Error('Use --status or --publish, not both');
  const requestedVersion = argv.find((arg) => !arg.startsWith('--')) || '';
  return { publish, statusOnly, requestedVersion };
}

async function writeReceipt(version, archivePath, archive, payload) {
  const receiptPath = path.join(path.dirname(archivePath), `flippah-by-alos-${version}-release-receipt.json`);
  await mkdir(path.dirname(receiptPath), { recursive: true });
  const receipt = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    version,
    extensionId: DEFAULT_EXTENSION_ID,
    archive: path.basename(archivePath),
    sha256: createHash('sha256').update(archive).digest('hex').toUpperCase(),
    ...payload,
  };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  return { receiptPath, receipt };
}

export async function main(argv = process.argv.slice(2)) {
  const { publish, statusOnly, requestedVersion } = parseArguments(argv);
  if (statusOnly) {
    const config = await loadLocalConfig();
    const urls = chromeWebStoreUrls(config.publisherId, config.extensionId);
    const status = await fetchStoreStatus(fetch, urls, await accessToken(config));
    console.log(JSON.stringify({
      extensionId: config.extensionId,
      published: status.publishedItemRevisionStatus,
      submitted: status.submittedItemRevisionStatus,
      uploadState: status.lastAsyncUploadState,
    }, null, 2));
    return status;
  }
  const root = process.cwd();
  const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const version = String(packageJson.version || '');
  if (!versionParts(version)) throw new Error(`package.json contains an invalid Chrome version: ${version}`);
  if (requestedVersion && requestedVersion !== version) {
    throw new Error(`Requested version ${requestedVersion} does not match package.json version ${version}`);
  }
  await assertCleanWorktree();

  console.log(`Testing Flippah v${version}...`);
  await run('npm', ['test']);
  console.log(`Building the Chrome Web Store package...`);
  await run('npm', ['run', 'package:store']);

  const archivePath = path.join(root, 'artifacts', 'chrome-web-store', `flippah-by-alos-${version}-chrome-web-store.zip`);
  await access(archivePath);
  const archive = await readFile(archivePath);
  const prepared = await writeReceipt(version, archivePath, archive, { mode: publish ? 'publish-requested' : 'prepare-only' });
  console.log(`Prepared ${archivePath}`);
  console.log(`SHA256 ${prepared.receipt.sha256}`);
  if (!publish) {
    console.log('No upload was requested. Run npm run release:chrome -- --publish after configuring Store access.');
    return prepared.receipt;
  }

  const config = await loadLocalConfig();
  if (!config.publisherId) throw new Error(`Set publisherId in ${configPath()} before publishing`);
  const token = await accessToken(config);
  const urls = chromeWebStoreUrls(config.publisherId, config.extensionId);
  const before = await fetchStoreStatus(fetch, urls, token);
  assertStoreCanAcceptVersion(before, version);
  console.log('Uploading package to the Chrome Web Store...');
  const upload = await uploadStorePackage(fetch, urls, token, archive);
  await waitForStoreUpload(fetch, urls, token, upload);
  console.log('Submitting package for review with automatic publication...');
  const submission = await submitStorePackage(fetch, urls, token);
  const after = await fetchStoreStatus(fetch, urls, token);
  const completed = await writeReceipt(version, archivePath, archive, {
    mode: 'submitted-for-review',
    extensionId: config.extensionId,
    uploadState: uploadState(upload) || uploadState(after),
    submissionState: String(after?.submittedItemRevisionStatus?.state || submission?.state || ''),
  });
  console.log(`Chrome Web Store submission state: ${completed.receipt.submissionState || 'submitted'}`);
  console.log(`Receipt: ${completed.receiptPath}`);
  return completed.receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Chrome Web Store release failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
