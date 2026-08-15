const { chromium } = require('playwright');
const fs = require('fs');

async function captureLoginFlow({ email, password, outputFile = 'cinefy-login-capture.json' }) {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1200 },
    locale: 'pt-BR',
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
  });

  const page = await context.newPage();
  const requests = [];
  const responses = [];
  const cookies = [];

  page.on('request', (req) => {
    const url = req.url();
    if (/(api|auth|login|session|me|channel|subscription|video|creator|live)/i.test(url)) {
      requests.push({
        method: req.method(),
        url,
        headers: req.headers()
      });
    }
  });

  page.on('response', async (res) => {
    const url = res.url();
    if (/(api|auth|login|session|me|channel|subscription|video|creator|live)/i.test(url)) {
      let body = '[body unreadable]';
      try {
        body = await res.text();
      } catch {
        // ignore unreadable body
      }

      responses.push({
        status: res.status(),
        url,
        headers: res.headers(),
        body: body.slice(0, 2000)
      });
    }
  });

  try {
    console.log('Acessando Cinefy...');
    await page.goto('https://cinefy.gg/', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(5000);

    const loginSelectors = [
      'a:has-text("Entrar")',
      'a:has-text("Login")',
      'button:has-text("Entrar")',
      'button:has-text("Login")',
      '[data-testid="login-button"]',
      '[href*="login"]',
      '[href*="signin"]'
    ];

    let clickedLogin = false;
    for (const selector of loginSelectors) {
      try {
        const btn = page.locator(selector).first();
        if (await btn.count()) {
          await btn.click({ timeout: 10000 });
          clickedLogin = true;
          console.log('Clicou no botão de login:', selector);
          break;
        }
      } catch {
        // continue searching
      }
    }

    if (!clickedLogin) {
      console.log('Nenhum botão de login visível foi encontrado. O login pode ser via modal ou rotear direto a uma página de auth.');
    }

    await page.waitForTimeout(10000);

    const emailFieldSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[name="username"]',
      'input[placeholder*="email" i]',
      'input[autocomplete="email"]'
    ];

    const passwordFieldSelectors = [
      'input[type="password"]',
      'input[name="password"]',
      'input[placeholder*="senha" i]',
      'input[autocomplete="current-password"]'
    ];

    let emailInput = null;
    for (const selector of emailFieldSelectors) {
      const el = page.locator(selector).first();
      if (await el.count()) {
        emailInput = el;
        break;
      }
    }

    let passwordInput = null;
    for (const selector of passwordFieldSelectors) {
      const el = page.locator(selector).first();
      if (await el.count()) {
        passwordInput = el;
        break;
      }
    }

    if (emailInput && passwordInput && email && password) {
      await emailInput.fill(email);
      await passwordInput.fill(password);
      await page.keyboard.press('Tab');
      await page.waitForTimeout(1500);

      const submitSelectors = [
        'button:has-text("Entrar")',
        'button:has-text("Login")',
        'button[type="submit"]',
        'input[type="submit"]'
      ];

      for (const selector of submitSelectors) {
        try {
          const btn = page.locator(selector).first();
          if (await btn.count()) {
            await btn.click({ timeout: 10000 });
            console.log('Clique no submit com seletor:', selector);
            break;
          }
        } catch {
          // ignore
        }
      }
    }

    console.log('Aguardando autenticação por 30s...');
    await page.waitForTimeout(30000);

    const allCookies = await context.cookies();
    cookies.push(...allCookies);

    const final = {
      url: page.url(),
      title: await page.title(),
      cookies,
      requests,
      responses
    };

    fs.writeFileSync(outputFile, JSON.stringify(final, null, 2));
    console.log('Arquivo salvo em:', outputFile);
    console.log('Cookies:', JSON.stringify(allCookies, null, 2));
  } catch (err) {
    console.error('Erro no fluxo de login:', err);
    throw err;
  } finally {
    await browser.close();
  }
}

(async () => {
  const email = process.env.CINEFY_EMAIL || '';
  const password = process.env.CINEFY_PASSWORD || '';

  if (!email || !password) {
    console.log('Use as variáveis de ambiente CINEFY_EMAIL e CINEFY_PASSWORD.');
    console.log('Exemplo:');
    console.log('  $env:CINEFY_EMAIL="seu@email.com"');
    console.log('  $env:CINEFY_PASSWORD="sua-senha"');
    console.log('  node login-capture.js');
    return;
  }

  await captureLoginFlow({ email, password });
})();
