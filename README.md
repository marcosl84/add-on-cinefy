# Cinefy Add-on

Add-on Stremio para canais do Cinefy baseado em assinatura.

## Requisitos

- Node.js >= 18
- Conta com assinatura ativa no Cinefy
- Token de sessão ou token de API válido

## Configuração

Copie o arquivo `.env.example` para `.env` e ajuste os valores:

```bash
cp .env.example .env
```

## Rodar localmente

```bash
npm install
npm run dev
```

Acesse:

- `http://localhost:7000/health`
- `http://localhost:7000/configure`

## Deploy no Render

1. Conecte o repositório no Render
2. Use Node como runtime
3. Build Command:
   ```bash
   npm install
   ```
4. Start Command:
   ```bash
   npm start
   ```
5. Configure variáveis de ambiente:
   - `PORT=7000`
   - `HOST=0.0.0.0`
   - `NODE_ENV=production`
   - `CINEFY_API_BASE=https://api.cinefy.gg`
   - `CINEFY_VALIDATE_URL=https://api.cinefy.gg/api/v1/me`
   - `CINEFY_CHANNELS_URL=https://api.cinefy.gg/api/v1/subscriptions/channels`
   - `CINEFY_API_KEY=`
   - `CINEFY_AUTH_TOKEN_SECRET=change-me`

## Instalação no Stremio

Use a URL do manifest do Render:

```text
https://SEU-APP.onrender.com/manifest.json
```

ou via configuração gerada em:

```text
https://SEU-APP.onrender.com/configure
```

## Observação

Para produção real, substitua os placeholders de streams por endpoints válidos do Cinefy e autentique os usuários com a sessão real da assinatura antes de devolver canais e streams.
