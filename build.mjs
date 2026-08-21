import { build } from 'esbuild';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const reference = path.join(root, 'reference-build', 'flippah-v0.1.0');
const targets = ['chrome', 'waterfox'];
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const version = String(packageJson.version);

await rm(path.join(root, 'dist'), { recursive: true, force: true });

const referenceManifest = JSON.parse(await readFile(path.join(reference, 'manifest.json'), 'utf8'));
const referenceResources = referenceManifest.web_accessible_resources?.[0]?.resources || [];

const commonManifest = {
  manifest_version: 3,
  name: 'Flippah by ALOS',
  short_name: 'Flippah',
  version,
  description: 'Auction research, true-cost analysis, watchlists, and verified HiBid exports for smarter flips.',
  author: 'ALOS',
  homepage_url: 'https://github.com/AshbyCollado/hibid-userscripts',
  permissions: ['storage', 'alarms', 'notifications', 'tabs', 'activeTab', 'downloads', 'clipboardWrite'],
  host_permissions: ['https://hibid.com/*', 'https://*.hibid.com/*', 'https://hibid-api.io/*'],
  action: {
    default_icon: { 16: 'icons/icon-16.png', 32: 'icons/icon-32.png' },
    default_popup: 'popup/index.html',
    default_title: 'Open Flippah by ALOS'
  },
  icons: {
    16: 'icons/icon-16.png',
    32: 'icons/icon-32.png',
    48: 'icons/icon-48.png',
    128: 'icons/icon-128.png'
  },
  options_page: 'options/index.html',
  content_scripts: [{
    matches: ['https://hibid.com/*', 'https://*.hibid.com/*'],
    css: ['assets/index-uNBN1arP.css'],
    js: ['content.js', 'legacy-content.js'],
    run_at: 'document_idle'
  }],
  web_accessible_resources: [{
    matches: ['https://hibid.com/*', 'https://*.hibid.com/*'],
    resources: referenceResources,
    use_dynamic_url: false
  }]
};

for (const target of targets) {
  const outdir = path.join(root, 'dist', target);
  await mkdir(path.join(outdir, 'popup'), { recursive: true });
  await mkdir(path.join(outdir, 'options'), { recursive: true });
  await cp(path.join(reference, 'assets'), path.join(outdir, 'assets'), { recursive: true });
  await cp(path.join(root, 'assets', 'icons'), path.join(outdir, 'icons'), {
    recursive: true,
    filter: (entry) => path.basename(entry) !== 'flippah-source.png'
  });
  await cp(path.join(root, 'src', 'popup', 'index.html'), path.join(outdir, 'popup', 'index.html'));
  await cp(path.join(root, 'src', 'popup', 'popup.css'), path.join(outdir, 'popup', 'popup.css'));
  await cp(path.join(root, 'src', 'options', 'index.html'), path.join(outdir, 'options', 'index.html'));
  await cp(path.join(root, 'src', 'options', 'options.css'), path.join(outdir, 'options', 'options.css'));

  await build({
    entryPoints: {
      background: path.join(root, 'src', 'background', 'index.ts'),
      content: path.join(root, 'src', 'content', 'index.ts'),
      'popup/popup': path.join(root, 'src', 'popup', 'index.ts'),
      'options/options': path.join(root, 'src', 'options', 'index.ts')
    },
    outdir,
    bundle: true,
    format: target === 'waterfox' ? 'iife' : 'esm',
    platform: 'browser',
    target: 'firefox128',
    sourcemap: false,
    minify: false,
    legalComments: 'none',
    logLevel: 'warning'
  });

  await build({
    entryPoints: [path.join(root, 'src', 'legacy', 'content-entry.ts')],
    outfile: path.join(outdir, 'legacy-content.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'firefox128',
    minify: false,
    legalComments: 'none',
    logLevel: 'warning',
    plugins: [{
      name: 'flippah-settings-compat',
      setup(buildApi) {
        buildApi.onResolve({ filter: /taxRates-B3rE_xel\.js$/ }, () => ({
          path: path.join(root, 'src', 'legacy', 'tax-rates-compat.ts')
        }));
      }
    }]
  });

  await build({
    entryPoints: [path.join(root, 'src', 'legacy', 'tax-rates-compat.ts')],
    outfile: path.join(outdir, 'assets', 'taxRates-B3rE_xel.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'firefox128',
    minify: true,
    legalComments: 'none',
    logLevel: 'warning'
  });

  const manifest = structuredClone(commonManifest);
  if (target === 'chrome') {
    manifest.key = referenceManifest.key;
    manifest.background = { service_worker: 'background.js', type: 'module' };
  } else {
    manifest.background = { scripts: ['background.js'] };
    manifest.browser_specific_settings = {
      gecko: {
        id: 'flippah@alos.dev',
        strict_min_version: '140.0',
        data_collection_permissions: {
          required: ['none']
        }
      },
      gecko_android: {
        strict_min_version: '142.0'
      }
    };
  }
  await writeFile(path.join(outdir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

console.log(`Built Flippah v${version} for Chrome and Waterfox.`);
