const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1200 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
  });

  const requests = [];
  const responses = [];

  page.on('request', (req) => {
    const url = req.url();
    if (/(api|login|session|channel|subscription|me|live|auth)/i.test(url)) {
      requests.push({
        method: req.method(),
        url,
        headers: req.headers()
      });
    }
  });

  page.on('response', async (res) => {
    const url = res.url();
    if (/(api|login|session|channel|subscription|me|live|auth)/i.test(url)) {
      try {
        const text = await res.text();
        responses.push({
          status: res.status(),
          url,
          body: text.slice(0, 2000)
        });
      } catch {
        responses.push({
          status: res.status(),
          url,
          body: '[body unreadable]'
        });
      }
    }
  });

  await page.goto('https://cinefy.gg', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(20000);

  console.log('URL:', page.url());
  console.log('TITLE:', await page.title());
  console.log('REQUISIÇÕES:', JSON.stringify(requests.slice(0, 50), null, 2));
  console.log('RESPOSTAS:', JSON.stringify(responses.slice(0, 30), null, 2));

  await browser.close();
})();