const puppeteer = require('puppeteer');
const path = require('path');

(async () => {
  const extPath = process.cwd();
  const browser = await puppeteer.launch({
    headless: false,
    args: [
      '--disable-extensions-except=' + extPath,
      '--load-extension=' + extPath
    ]
  });

  const page = await browser.newPage();
  
  await page.setRequestInterception(true);
  const interceptor = request => {
    if (request.url().includes('/lot/')) {
      request.respond({
        status: 200,
        contentType: 'text/html',
        body: `
          <!DOCTYPE html>
          <html>
          <head><title>Dummy Lot</title></head>
          <body>
            <div class="page-header"><h1>Test Lot</h1></div>
            <div class="lot-bid-container">
              <span class="lot-high-bid">$10.00</span>
              <a class="auctioneer-link" href="https://hibid.com/company/9999/dummy">Auctioneer</a>
            </div>
          </body>
          </html>
        `
      });
    } else {
      request.continue();
    }
  };
  page.on('request', interceptor);

  const testUrl = 'https://hibid.com/lot/300000001/test1';
  console.log('Navigating to lot', testUrl);
  await page.goto(testUrl, { waitUntil: 'domcontentloaded' });
  
  try {
    await page.waitForSelector('#lotlens-root', { timeout: 5000 });
    
    // Set Max Bid to 100
    await page.evaluate(() => {
      const root = document.getElementById('lotlens-root');
      if (root && root.shadowRoot) {
        const input = root.shadowRoot.querySelector('#lotlens-budget');
        if (input) {
          input.value = '100.00';
          input.dispatchEvent(new Event('input'));
          input.dispatchEvent(new Event('change'));
        }
      }
    });
    console.log('Entered 100.00');
    await new Promise(r => setTimeout(r, 500));
    
    // Read the output
    const outputText = await page.evaluate(() => {
      const root = document.getElementById('lotlens-root');
      return root.shadowRoot.querySelector('.lotlens-max-bid').textContent;
    });
    console.log('Output text:', outputText);

    // Save and reload
    await page.evaluate(() => {
      const root = document.getElementById('lotlens-root');
      root.shadowRoot.querySelector('.lotlens-watch-button').click();
    });
    console.log('Saved item. Reloading...');
    await new Promise(r => setTimeout(r, 500));

    await page.goto(testUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#lotlens-root', { timeout: 5000 });
    await new Promise(r => setTimeout(r, 1000));

    const loadedValue = await page.evaluate(() => {
      const root = document.getElementById('lotlens-root');
      return root.shadowRoot.querySelector('#lotlens-budget').value;
    });
    console.log('Loaded input value after refresh:', loadedValue);
    
    const loadedOutput = await page.evaluate(() => {
      const root = document.getElementById('lotlens-root');
      return root.shadowRoot.querySelector('.lotlens-max-bid').textContent;
    });
    console.log('Loaded output text after refresh:', loadedOutput);

  } catch(e) {
    console.error('Error during test:', e);
  }

  await browser.close();
})();
