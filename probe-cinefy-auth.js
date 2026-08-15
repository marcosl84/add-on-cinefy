const axios = require('axios');

const urls = [
  'https://api.cinefy.gg/v1/login',
  'https://api.cinefy.gg/v1/auth/login',
  'https://api.cinefy.gg/api/v1/login',
  'https://api.cinefy.gg/api/v1/auth/login',
  'https://api.cinefy.gg/v1/session',
  'https://api.cinefy.gg/v1/auth/session',
  'https://api.cinefy.gg/v1/me',
  'https://api.cinefy.gg/api/v1/me',
  'https://api.cinefy.gg/v1/subscriptions',
  'https://api.cinefy.gg/v1/user/subscriptions',
  'https://api.cinefy.gg/v1/channels',
  'https://api.cinefy.gg/v1/user/channels',
  'https://api.cinefy.gg/v1/creators/me',
  'https://api.cinefy.gg/v1/user'
];

(async () => {
  for (const url of urls) {
    try {
      const res = await axios({
        method: 'get',
        url,
        validateStatus: () => true,
        timeout: 15000,
        headers: {
          'User-Agent': 'Mozilla/5.0',
          Accept: 'application/json, text/plain, */*'
        }
      });

      console.log('\nURL:', url);
      console.log('Status:', res.status);
      console.log('Content-Type:', res.headers['content-type']);

      const sample = typeof res.data === 'string'
        ? res.data.slice(0, 220)
        : JSON.stringify(res.data).slice(0, 220);

      console.log('Body:', sample);
    } catch (err) {
      console.log('\nURL:', url);
      console.log('ERROR:', err.message);
    }
  }
})();
