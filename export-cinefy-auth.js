const fs = require('fs');
const axios = require('axios');

const capturePath = 'cinefy-login-capture.json';

function loadCapture() {
  if (!fs.existsSync(capturePath)) {
    throw new Error(`Arquivo de captura não encontrado: ${capturePath}`);
  }

  const raw = JSON.parse(fs.readFileSync(capturePath, 'utf8'));
  const token = raw.cookies?.find((cookie) => cookie.name === 'token')?.value;

  if (!token) {
    throw new Error('Cookie "token" não encontrado em cinefy-login-capture.json');
  }

  return { raw, token };
}

async function probe(url, token) {
  const response = await axios({
    url,
    method: 'GET',
    validateStatus: () => true,
    timeout: 20000,
    headers: {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      Cookie: `token=${token}`,
      Authorization: `Bearer ${token}`
    }
  });

  return {
    url,
    status: response.status,
    data: response.data
  };
}

(async () => {
  try {
    const { token } = loadCapture();

    const urls = [
      'https://api.cinefy.gg/v2/auth/@me?platform=web&platformLang=pt-BR&platformTimeZone=America%2FSao_Paulo&screenWidth=1440&screenHeight=1200',
      'https://api.cinefy.gg/v1/user/watch-times',
      'https://api.cinefy.gg/v2/users/@me/notifications',
      'https://api.cinefy.gg/v2/users/@me/notifications/count',
      'https://api.cinefy.gg/v1/feed/creators?perPage=11'
    ];

    for (const url of urls) {
      const result = await probe(url, token);
      const preview = typeof result.data === 'string'
        ? result.data.slice(0, 300)
        : JSON.stringify(result.data).slice(0, 300);

      console.log(`\n=== ${result.status} ${url} ===`);
      console.log(preview);
    }
  } catch (err) {
    console.error('Erro ao exportar autenticação Cinefy:', err.message);
    process.exitCode = 1;
  }
})();
