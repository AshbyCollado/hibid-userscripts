const { JSDOM } = require('jsdom');
const path = require('path');
const url = require('url');

(async () => {
  const dom = new JSDOM('<!DOCTYPE html><p>Hello world</p>');
  global.window = dom.window;
  global.document = dom.window.document;
  global.location = dom.window.location;
  global.MutationObserver = dom.window.MutationObserver;
  global.chrome = { runtime: { getURL: () => '' } };

  const targetUrl = url.pathToFileURL(path.resolve('assets/index.ts-BuCXDImd.js')).href;
  
  console.log('Loading module:', targetUrl);
  try {
    await import(targetUrl);
    console.log('Module loaded without throwing top-level errors.');
  } catch (err) {
    console.error('ERROR LOADING MODULE:');
    console.error(err);
  }
  process.exit(0);
})();
