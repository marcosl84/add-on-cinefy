const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1200 },
    locale: 'pt-BR',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();
  const requests = [];
  const responses = [];

  page.on('request', (req) => {
    const url = req.url();
    if (/(api|auth|login|session|channel|subscription|me|live|video|creator)/i.test(url)) {
      requests.push({
        method: req.method(),
        url,
        headers: req.headers()
      });
    }
  });

  page.on('response', async (res) => {
    const url = res.url();
    if (/(api|auth|login|session|channel|subscription|me|live|video|creator)/i.test(url)) {
      try {
        const body = await res.text();
        responses.push({
          status: res.status(),
          url,
          headers: res.headers(),
          body: body.slice(0, 2500)
        });
      } catch {
        responses.push({
          status: res.status(),
          url,
          headers: res.headers(),
          body: '[body unreadable]'
        });
      }
    }
  });

  try {
    console.log('Abrindo Cinefy...');
    await page.goto('https://cinefy.gg/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(20000);

    const title = await page.title();
    const url = page.url();

    console.log('URL final:', url);
    console.log('TITLE:', title);

    const out = {
      title,
      url,
      requests,
      responses
    };

    fs.writeFileSync('cinefy-capture.json', JSON.stringify(out, null, 2));
    console.log('Arquivo salvo em:', 'cinefy-capture.json');
  } catch (err) {
    console.error('Erro ao capturar:', err);
  } finally {
    await browser.close();
  }
})();
