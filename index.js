require("dotenv").config();

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const { addonBuilder, getRouter } = require("stremio-addon-sdk");
const manifest = require("./manifest.json");

const app = express();
const PORT = Number(process.env.PORT || 7000);
const HOST = process.env.HOST || "0.0.0.0";
const CINEFY_API_BASE = process.env.CINEFY_API_BASE || "https://api.cinefy.gg";
const CINEFY_VALIDATE_URL = process.env.CINEFY_VALIDATE_URL || `${CINEFY_API_BASE}/api/v1/me`;
const CINEFY_CHANNELS_URL = process.env.CINEFY_CHANNELS_URL || `${CINEFY_API_BASE}/api/v1/subscriptions/channels`;
const CINEFY_API_KEY = process.env.CINEFY_API_KEY || "";
const CINEFY_AUTH_TOKEN_SECRET = process.env.CINEFY_AUTH_TOKEN_SECRET || "change-me";
const CACHE_DURATION = Number(process.env.CACHE_DURATION || 30) * 1000;

app.set("trust proxy", 1);
app.use(cors());
app.use(express.json());

const builder = new addonBuilder(manifest);

function sanitizeText(value, fallback = "") {
  return String(value || fallback).replace(/\s+/g, " ").trim() || fallback;
}

function buildAuthHeaders(token) {
  const auth = String(token || "").trim();
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (compatible; Stremio-Cinefy-Addon/1.0)"
  };

  if (auth) {
    headers.Authorization = auth.startsWith("Bearer ") ? auth : `Bearer ${auth}`;
  }

  if (CINEFY_API_KEY) {
    headers["X-API-Key"] = CINEFY_API_KEY;
  }

  return headers;
}

async function validateSession(token) {
  const authToken = String(token || "").trim();
  if (!authToken) return { valid: false, reason: "missing token" };

  try {
    const response = await axios.get(CINEFY_VALIDATE_URL, {
      headers: buildAuthHeaders(authToken),
      timeout: 15000
    });

    const user = response.data?.user || response.data?.data || response.data || {};
    if (!user || Object.keys(user).length === 0) {
      return { valid: false, reason: "invalid session" };
    }

    return {
      valid: true,
      user,
      data: response.data
    };
  } catch (error) {
    return {
      valid: false,
      reason: error.response?.status || error.message || "unauthorized"
    };
  }
}

async function fetchSubscribedChannels(token) {
  const authToken = String(token || "").trim();
  if (!authToken) return [];

  try {
    const response = await axios.get(CINEFY_CHANNELS_URL, {
      headers: buildAuthHeaders(authToken),
      timeout: 20000
    });

    const raw = response.data?.data || response.data?.channels || response.data || [];
    const list = Array.isArray(raw) ? raw : [];

    return list.map((channel) => ({
      id: `cinefy_${String(channel.id || channel.slug || channel.name || Math.random()).trim()}`,
      slug: String(channel.slug || channel.name || channel.id || "").trim(),
      name: sanitizeText(channel.name || channel.title || channel.slug || "Cinefy Channel", "Cinefy Channel"),
      avatar: channel.avatar || channel.image || channel.logo || "",
      banner: channel.banner || channel.background || "",
      description: sanitizeText(channel.description || channel.bio || channel.title || "", "Canal Cinefy"),
      live: !!channel.is_live,
      isSubscribed: true,
      streamUrl: channel.stream_url || channel.url || "",
      source: channel
    }));
  } catch (error) {
    console.warn("Cinefy channels fetch failed:", error.response?.status || error.message);
    return [];
  }
}

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  if (type !== "channel") return { metas: [] };

  const token = extra?.token || extra?.auth || extra?.session || "";
  const hasValidSession = await validateSession(token);
  if (!hasValidSession.valid) {
    return { metas: [] };
  }

  const channels = await fetchSubscribedChannels(token);
  return {
    metas: channels.map((channel) => ({
      id: channel.id,
      type: "channel",
      name: channel.name,
      poster: channel.avatar || "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=800&q=80",
      background: channel.banner || "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1200&q=80",
      logo: channel.avatar || "",
      description: channel.description || "Canal Cinefy"
    }))
  };
});

builder.defineMetaHandler(async ({ type, id }) => {
  if (type !== "channel") return { meta: null };

  const channelId = String(id || "").replace(/^cinefy_/, "");
  if (!channelId) return { meta: null };

  return {
    meta: {
      id: `cinefy_${channelId}`,
      type: "channel",
      name: "Cinefy Channel",
      poster: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=800&q=80",
      background: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1200&q=80",
      description: "Canal Cinefy"
    }
  };
});

builder.defineStreamHandler(async ({ type, id }) => {
  if (type !== "channel") return { streams: [] };

  return {
    streams: [
      {
        name: "Cinefy Stream",
        description: "Acesso via assinatura Cinefy",
        url: "https://example.com/placeholder-stream"
      }
    ]
  };
});

const addonRouter = getRouter(builder.getInterface());
app.use("/", addonRouter);

app.get("/health", (req, res) => {
  res.json({ status: "ok", addon: "Cinefy", version: manifest.version });
});

app.get("/configure", (req, res) => {
  const base = `${req.protocol}://${req.get("host")}`;
  res.type("html").send(`<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Cinefy - Configuração</title>
    <style>
      body { font-family: Arial, sans-serif; max-width: 760px; margin: 40px auto; padding: 20px; background: #0d0d0d; color: #f3f3f3; }
      h1 { color: #7dd3fc; }
      .box { background: #161616; border: 1px solid #2a2a2a; border-radius: 12px; padding: 18px; margin: 18px 0; }
      input, button { width: 100%; box-sizing: border-box; padding: 12px; border-radius: 8px; border: 1px solid #394b5a; margin-top: 8px; }
      input { background: #0d0d0d; color: #fff; }
      button { background: #7dd3fc; color: #09131b; font-weight: bold; border: none; cursor: pointer; }
      code { background: #111; padding: 8px 10px; border-radius: 6px; display: block; word-break: break-all; }
      .success { color: #86efac; }
    </style>
  </head>
  <body>
    <h1>Cinefy - Configuração</h1>
    <div class="box">
      <p>Insira o token ou sessão válida do Cinefy para acessar os canais disponíveis na assinatura.</p>
      <input id="token" type="text" placeholder="Cole o token da sua assinatura" />
      <button onclick="generate()">Gerar URL do addon</button>
    </div>
    <div class="box" id="result" style="display:none;">
      <p>Use a URL abaixo no Stremio:</p>
      <code id="addon-url"></code>
      <p class="success">Aba no Stremio: <strong>Cinefy</strong></p>
    </div>
    <script>
      const base = '${base}';
      function generate() {
        const token = document.getElementById('token').value.trim();
        if (!token) return alert('Informe o token da assinatura.');
        const url = base + '/' + encodeURIComponent(token) + '/manifest.json';
        document.getElementById('addon-url').textContent = url;
        document.getElementById('result').style.display = 'block';
      }
    </script>
  </body>
</html>`);
});

app.get("/:token/manifest.json", async (req, res) => {
  const token = decodeURIComponent(req.params.token || "");
  const validation = await validateSession(token);

  if (!validation.valid) {
    return res.status(401).json({ error: "invalid or expired Cinefy session" });
  }

  const subManifest = {
    ...manifest,
    id: `${manifest.id}.token`,
    name: "Cinefy",
    catalogs: [{ type: "channel", id: "cinefy_channels", name: "Cinefy - Canais", extra: [{ name: "token", options: [] }] }],
    resources: ["catalog", "meta", "stream"]
  };

  return res.json(subManifest);
});

app.get("/:token/catalog/channel/cinefy_channels.json", async (req, res) => {
  const token = decodeURIComponent(req.params.token || "");
  const validation = await validateSession(token);

  if (!validation.valid) {
    return res.status(401).json({ metas: [] });
  }

  const channels = await fetchSubscribedChannels(token);
  return res.json({
    metas: channels.map((channel) => ({
      id: channel.id,
      type: "channel",
      name: channel.name,
      poster: channel.avatar || "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=800&q=80",
      background: channel.banner || "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1200&q=80",
      logo: channel.avatar || "",
      description: channel.description || "Canal Cinefy"
    }))
  });
});

app.get("/:token/meta/channel/:id.json", async (req, res) => {
  const token = decodeURIComponent(req.params.token || "");
  const validation = await validateSession(token);

  if (!validation.valid) {
    return res.status(401).json({ meta: null });
  }

  const id = req.params.id;
  res.json({
    meta: {
      id: `cinefy_${id}`,
      type: "channel",
      name: "Cinefy Channel",
      poster: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=800&q=80",
      background: "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1200&q=80",
      description: "Canal Cinefy"
    }
  });
});

app.get("/:token/stream/channel/:id.json", async (req, res) => {
  const token = decodeURIComponent(req.params.token || "");
  const validation = await validateSession(token);

  if (!validation.valid) {
    return res.status(401).json({ streams: [] });
  }

  res.json({
    streams: [{
      name: "Cinefy Stream",
      description: "Acesso via assinatura",
      url: "https://example.com/placeholder-stream"
    }]
  });
});

app.get("/", (req, res) => {
  res.type("html").send(`
    <html>
      <head><meta charset="utf-8"><title>Cinefy Add-on</title></head>
      <body style="font-family:Arial,sans-serif;max-width:760px;margin:40px auto;padding:20px;color:#111;">
        <h1>Cinefy Add-on</h1>
        <p>Serviço pronto para assinatura.</p>
        <p>Manifest: <code>/manifest.json</code></p>
        <p>Health: <code>/health</code></p>
        <p>Configuração: <code>/configure</code></p>
      </body>
    </html>
  `);
});

app.use((err, req, res, next) => {
  console.error("Unhandled addon error:", err);
  if (res.headersSent) return next(err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

const server = app.listen(PORT, HOST, () => {
  console.log(`Cinefy add-on listening on ${HOST}:${PORT}`);
  console.log(`Manifest: http://${HOST}:${PORT}/manifest.json`);
});

process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));

module.exports = app;
