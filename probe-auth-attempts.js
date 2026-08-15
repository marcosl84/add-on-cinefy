const axios = require('axios');

const attempts = [
  { name: 'POST /api/auth/login', url: 'https://api.cinefy.gg/api/auth/login', method: 'post' },
  { name: 'POST /api/v1/auth/login', url: 'https://api.cinefy.gg/api/v1/auth/login', method: 'post' },
  { name: 'POST /auth/login', url: 'https://api.cinefy.gg/auth/login', method: 'post' },
  { name: 'POST /v1/auth/login', url: 'https://api.cinefy.gg/v1/auth/login', method: 'post' },
  { name: 'POST /api/v1/login', url: 'https://api.cinefy.gg/api/v1/login', method: 'post' },
  { name: 'POST /v1/login', url: 'https://api.cinefy.gg/v1/login', method: 'post' },
  { name: 'POST /api/session', url: 'https://api.cinefy.gg/api/session', method: 'post' },
  { name: 'POST /api/v1/session', url: 'https://api.cinefy.gg/api/v1/session', method: 'post' },
  { name: 'POST /v1/session', url: 'https://api.cinefy.gg/v1/session', method: 'post' },
  { name: 'POST /api/auth/signin', url: 'https://api.cinefy.gg/api/auth/signin', method: 'post' },
  { name: 'POST /api/v1/auth/signin', url: 'https://api.cinefy.gg/api/v1/auth/signin', method: 'post' },
  { name: 'POST /auth/signin', url: 'https://api.cinefy.gg/auth/signin', method: 'post' },
  { name: 'POST /v1/auth/signin', url: 'https://api.cinefy.gg/v1/auth/signin', method: 'post' },
  { name: 'POST /api/auth', url: 'https://api.cinefy.gg/api/auth', method: 'post' },
  { name: 'POST /api/v1/auth', url: 'https://api.cinefy.gg/api/v1/auth', method: 'post' },
  { name: 'POST /auth', url: 'https://api.cinefy.gg/auth', method: 'post' },
  { name: 'POST /v1/auth', url: 'https://api.cinefy.gg/v1/auth', method: 'post' }
];

const payloads = [
  { email: 'teste@teste.com', password: 'teste123' },
  { username: 'teste@teste.com', password: 'teste123' },
  { email: 'teste@teste.com', pass: 'teste123' },
  { user: 'teste@teste.com', password: 'teste123' },
  { login: 'teste@teste.com', password: 'teste123' }
];

(async () => {
  for (const attempt of attempts) {
    for (const payload of payloads) {
      try {
        const res = await axios({
          method: attempt.method,
          url: attempt.url,
          timeout: 15000,
          validateStatus: () => true,
          headers: {
            Accept: 'application/json, text/plain, */*',
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
          },
          data: JSON.stringify(payload)
        });

        const text = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
        const sample = text.slice(0, 220);

        if (res.status !== 404 && res.status !== 405 && res.status !== 501) {
          console.log('\n=== HIT ===');
          console.log(attempt.name);
          console.log('status:', res.status);
          console.log('payload:', JSON.stringify(payload));
          console.log('body:', sample);
          console.log('headers:', JSON.stringify(res.headers, null, 2));
          return;
        }
      } catch (err) {
        // ignore, keep probing
      }
    }
  }

  console.log('No auth endpoints responded with a real non-404/405/501 state using the common login patterns.');
})();
