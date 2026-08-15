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
const CINEFY_VALIDATE_URL = process.env.CINEFY_VALIDATE_URL || `${CINEFY_API_BASE}/v2/auth/@me?platform=web&platformLang=pt-BR&platformTimeZone=America%2FSao_Paulo&screenWidth=1440&screenHeight=1200`;
const CINEFY_CHANNELS_URL = process.env.CINEFY_CHANNELS_URL || `${CINEFY_API_BASE}/v1/feed/creators?perPage=11`;
const CINEFY_AUTH_TOKEN = normalizeAuthToken(process.env.CINEFY_TOKEN || process.env.CINEFY_SESSION_TOKEN || process.env.CINEFY_AUTH_TOKEN || "");
const CINEFY_API_KEY = process.env.CINEFY_API_KEY || "";
const CINEFY_AUTH_TOKEN_SECRET = process.env.CINEFY_AUTH_TOKEN_SECRET || "change-me";
const CINEFY_AUTH_HEADER = process.env.CINEFY_AUTH_HEADER || "Authorization";
const CINEFY_SESSION_HEADER = process.env.CINEFY_SESSION_HEADER || "Cookie";
const CACHE_DURATION = Number(process.env.CACHE_DURATION || 30) * 1000;

app.set("trust proxy", 1);
app.use(cors());
app.use(express.json());

const builder = new addonBuilder(manifest);

function sanitizeText(value, fallback = "") {
  return String(value || fallback).replace(/\s+/g, " ").trim() || fallback;
}

function normalizeAuthToken(rawToken) {
  const value = String(rawToken || "").trim();
  if (!value) return "";
  return value.replace(/^Bearer\s+/i, "").replace(/^['"]|['"]$/g, "").trim();
}

function extractAuthTokenFromRequest(req) {
  const authHeader = String(req.headers?.authorization || "").trim();
  if (authHeader) return normalizeAuthToken(authHeader);

  const customHeader = String(req.headers?.[CINEFY_AUTH_HEADER.toLowerCase()] || "").trim();
  if (customHeader) return normalizeAuthToken(customHeader);

  const queryToken = String(req.query?.token || req.query?.auth || req.query?.session || "").trim();
  if (queryToken) return normalizeAuthToken(queryToken);

  const rawCookie = String(req.headers?.cookie || "").trim();
  if (rawCookie) {
    const match = rawCookie.match(/(?:^|;\s*)CinefySession=([^;]+)/i) || rawCookie.match(/(?:^|;\s*)session=([^;]+)/i);
    if (match?.[1]) return normalizeAuthToken(decodeURIComponent(match[1]));
  }

  return "";
}

function buildAuthHeaders(token, cookieHeader = "") {
  const auth = normalizeAuthToken(token);
  const headers = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
  };

  if (auth) {
    headers[CINEFY_AUTH_HEADER] = auth.startsWith("Bearer ") ? auth : `Bearer ${auth}`;
    headers["X-Auth-Token"] = auth;
    headers["X-Cinefy-Token"] = auth;
    headers[CINEFY_SESSION_HEADER] = `token=${auth}`;
  }

  if (cookieHeader) {
    headers[CINEFY_SESSION_HEADER] = cookieHeader;
  }

  if (CINEFY_API_KEY) {
    headers["X-API-Key"] = CINEFY_API_KEY;
  }

  return headers;
}

async function validateSession(token) {
  const authToken = normalizeAuthToken(token || CINEFY_AUTH_TOKEN);
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
  const authToken = normalizeAuthToken(token || CINEFY_AUTH_TOKEN);

  try {
    const response = await axios.get(CINEFY_CHANNELS_URL, {
      headers: buildAuthHeaders(authToken),
      timeout: 20000
    });

    const payload = response.data?.data || response.data?.channels || response.data || [];
    const raw = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [];
    const list = Array.isArray(raw) ? raw : [];

    if (list.length > 0) {
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
    }
  } catch (error) {
    console.warn("Cinefy channels fetch failed:", error.response?.status || error.message);
  }

  return [];
}

function normalizeVideoMeta(video, source = "public") {
  const id = String(video?.id || "").trim();
  if (!id) return null;

  const title = sanitizeText(video.title || video.name || "Cinefy video", "Cinefy video");
  const thumbnail = video.thumbnail || video.poster || video.avatar || "";
  const year = video.publishedAt ? new Date(video.publishedAt).getFullYear() : undefined;
  const author = video.author ? sanitizeText(video.author.displayName || video.author.username || video.author.slug || "", "Cinefy") : "Cinefy";
  const description = sanitizeText(
    video.description || (source === "personal" ? `Conteúdo recente do usuário autenticado em Cinefy` : `Conteúdo público do Cinefy`),
    source === "personal" ? "Conteúdo recente do usuário autenticado em Cinefy" : "Conteúdo público do Cinefy"
  );

  return {
    id: `cinefy_video_${id}`,
    type: "movie",
    name: title,
    poster: thumbnail ? `https://cdn.cinefy.gg/videos/${id}/thumbnail/${thumbnail}?height=500` : "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=800&q=80",
    background: thumbnail ? `https://cdn.cinefy.gg/videos/${id}/thumbnail/${thumbnail}?height=800` : "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=1200&q=80",
    description,
    year,
    genre: "live",
    director: author,
    source,
    raw: video
  };
}

async function fetchPublicVideoContent() {
  const urls = [
    "https://api.cinefy.gg/v1/videos?type=live&perPage=35&sortedField=viewers&sortedOrder=desc",
    "https://api.cinefy.gg/v1/videos/relevant?perPage=12&origin=for-you&index=0"
  ];

  const items = [];
  for (const url of urls) {
    try {
      const response = await axios.get(url, {
        timeout: 20000,
        headers: {
          Accept: "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
        }
      });

      const payload = response.data?.data || [];
      if (Array.isArray(payload)) {
        for (const item of payload) {
          const meta = normalizeVideoMeta(item, "public");
          if (meta) {
            const exists = items.some((entry) => entry.id === meta.id);
            if (!exists) items.push(meta);
          }
        }
      }
    } catch (error) {
      console.warn("Cinefy public catalog fetch failed:", url, error.response?.status || error.message);
    }
  }

  return items;
}

async function fetchPersonalVideoContent(token) {
  const authToken = normalizeAuthToken(token || CINEFY_AUTH_TOKEN);
  if (!authToken) return [];

  const validation = await validateSession(authToken);
  if (!validation.valid) return [];

  try {
    const response = await axios.get("https://api.cinefy.gg/v1/user/watch-times", {
      headers: buildAuthHeaders(authToken),
      timeout: 20000
    });

    const payload = response.data || [];
    if (!Array.isArray(payload)) return [];

    return payload
      .map((entry) => normalizeVideoMeta(entry.video, "personal"))
      .filter(Boolean)
      .slice(0, 24);
  } catch (error) {
    console.warn("Cinefy personal catalog fetch failed:", error.response?.status || error.message);
    return [];
  }
}

builder.defineCatalogHandler(async ({ type, id, extra }) => {
  const token = extra?.token || extra?.auth || extra?.session || "";
  const [publicItems, personalItems] = await Promise.all([
    fetchPublicVideoContent(),
    fetchPersonalVideoContent(token)
  ]);

  const mainList = [...publicItems, ...personalItems];
  const liveItems = publicItems.filter((item) => item.raw?.liveStream || item.genre === "live");
  const movieItems = publicItems.filter((item) => !(item.raw?.liveStream || item.genre === "live"));
  const otherItems = [...liveItems, ...movieItems].slice(0, 60);

  let selected = mainList;

  if (type === "series") {
    selected = publicItems.slice(0, 30);
  } else if (type === "movie") {
    if (id === "cinefy_main") selected = mainList;
    else if (id === "cinefy_movies") selected = movieItems.length ? movieItems : publicItems;
    else if (id === "cinefy_live") selected = liveItems.length ? liveItems : publicItems;
    else if (id === "cinefy_others") selected = otherItems;
    else selected = mainList;
  }

  if (type !== "movie" && type !== "series" && type !== "channel") return { metas: [] };

  if (type === "channel") {
    const hasValidSession = await validateSession(token);
    if (!hasValidSession.valid) return { metas: [] };

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
  }

  const catalogType = type === "series" ? "series" : "movie";
  const metas = selected.slice(0, 120).map((meta) => ({
    id: meta.id,
    type: catalogType,
    name: meta.name,
    poster: meta.poster,
    background: meta.background,
    description: meta.description,
    genres: [meta.genre],
    languages: ["pt-BR"]
  }));

  return { metas };


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
  const allItems = await fetchPublicVideoContent();
  const item = allItems.find((entry) => entry.id === String(id || ""));

  if (type === "movie" || type === "series") {
    if (!item) return { meta: null };

    return {
      meta: {
        id: item.id,
        type: type === "series" ? "series" : "movie",
        name: item.name,
        poster: item.poster,
        background: item.background,
        description: item.description,
        genres: [item.genre],
        languages: ["pt-BR"]
      }
    };
  }

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
  if (type === "movie" || type === "series") {
    const allItems = await fetchPublicVideoContent();
    const item = allItems.find((entry) => entry.id === String(id || ""));
    if (!item) return { streams: [] };

    const watchUrl = item.raw?.liveStream ? `https://cinefy.gg/watch/${item.raw.id}` : `https://cinefy.gg/watch/${item.raw?.id || item.id.replace(/^cinefy_video_/, "")}`;

    return {
      streams: [
        {
          name: item.name,
          description: item.description,
          url: watchUrl
        }
      ]
    };
  }

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
    catalogs: [
      { type: "movie", id: "cinefy_main", name: "Cinefy", extra: [{ name: "token", options: [] }] },
      { type: "movie", id: "cinefy_movies", name: "Cinefy - Filmes", extra: [{ name: "token", options: [] }] },
      { type: "series", id: "cinefy_series", name: "Cinefy - Séries", extra: [{ name: "token", options: [] }] },
      { type: "movie", id: "cinefy_live", name: "Cinefy - Live", extra: [{ name: "token", options: [] }] },
      { type: "movie", id: "cinefy_others", name: "Cinefy - Outros", extra: [{ name: "token", options: [] }] },
      { type: "channel", id: "cinefy_channels", name: "Cinefy - Canais", extra: [{ name: "token", options: [] }] }
    ],
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "channel"],
    idPrefixes: ["cinefy_", "cinefy_video_", "cinefy_series_"]
  };

  return res.json(subManifest);
});

app.get("/:token/catalog/movie/cinefy_live.json", async (req, res) => {
  const token = decodeURIComponent(req.params.token || "");
  const validation = await validateSession(token);

  if (!validation.valid) {
    return res.status(401).json({ metas: [] });
  }

  const publicItems = await fetchPublicVideoContent();
  const metas = publicItems.filter((item) => item.raw?.liveStream || item.genre === "live").slice(0, 120);

  return res.json({
    metas: metas.map((meta) => ({
      id: meta.id,
      type: "movie",
      name: meta.name,
      poster: meta.poster,
      background: meta.background,
      description: meta.description,
      genres: [meta.genre],
      languages: ["pt-BR"]
    }))
  });
});

app.get("/:token/catalog/movie/cinefy_all.json", async (req, res) => {
  const token = decodeURIComponent(req.params.token || "");
  const validation = await validateSession(token);

  if (!validation.valid) {
    return res.status(401).json({ metas: [] });
  }

  const [publicItems, personalItems] = await Promise.all([
    fetchPublicVideoContent(),
    fetchPersonalVideoContent(token)
  ]);

  const metas = [...publicItems, ...personalItems].slice(0, 120);

  return res.json({
    metas: metas.map((meta) => ({
      id: meta.id,
      type: "movie",
      name: meta.name,
      poster: meta.poster,
      background: meta.background,
      description: meta.description,
      genres: [meta.genre],
      languages: ["pt-BR"]
    }))
  });
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

app.get("/:token/meta/movie/:id.json", async (req, res) => {
  const token = decodeURIComponent(req.params.token || "");
  const validation = await validateSession(token);

  if (!validation.valid) {
    return res.status(401).json({ meta: null });
  }

  const allItems = await fetchPublicVideoContent();
  const item = allItems.find((entry) => entry.id === String(req.params.id || ""));
  if (!item) return res.json({ meta: null });

  return res.json({
    meta: {
      id: item.id,
      type: "movie",
      name: item.name,
      poster: item.poster,
      background: item.background,
      description: item.description,
      genres: [item.genre],
      languages: ["pt-BR"]
    }
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

app.get("/:token/stream/movie/:id.json", async (req, res) => {
  const token = decodeURIComponent(req.params.token || "");
  const validation = await validateSession(token);

  if (!validation.valid) {
    return res.status(401).json({ streams: [] });
  }

  const allItems = await fetchPublicVideoContent();
  const item = allItems.find((entry) => entry.id === String(req.params.id || ""));
  if (!item) return res.json({ streams: [] });

  const watchUrl = item.raw?.liveStream ? `https://cinefy.gg/watch/${item.raw.id}` : `https://cinefy.gg/watch/${item.raw?.id || item.id.replace(/^cinefy_video_/, "")}`;

  return res.json({
    streams: [{
      name: item.name,
      description: item.description,
      url: watchUrl
    }]
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
