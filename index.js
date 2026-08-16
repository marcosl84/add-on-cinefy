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

function normalizeCreatorEntry(input, fallback = "Cinefy") {
  if (!input || typeof input !== "object") return null;

  const creator = input.creator || input.user || input;
  const id = String(creator?.id || input?.id || "").trim();
  const username = sanitizeText(creator?.username || creator?.slug || creator?.displayName || input?.slug || input?.username || "", fallback);
  const displayName = sanitizeText(creator?.displayName || creator?.name || creator?.username || username || fallback, fallback);

  return {
    id: id || `cinefy_${String(username || Math.random()).replace(/\s+/g, "").toLowerCase()}`,
    slug: String(creator?.slug || input?.slug || username || "").trim(),
    name: displayName,
    username,
    avatar: creator?.avatar || creator?.image || creator?.logo || input?.avatar || "",
    banner: creator?.banner || creator?.background || input?.banner || "",
    description: sanitizeText(creator?.description || input?.description || "", "Canal Cinefy")
  };
}

function resolveImageUrl(value, size = "w500") {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^https?:\/\//i.test(text)) return text;
  if (/^\/\//.test(text)) return `https:${text}`;
  if (/[A-Za-z0-9_\-]+\.(png|jpe?g|webp|gif|avif)(\?.*)?$/i.test(text)) return `https://image.tmdb.org/t/p/${size}/${text}`;
  return text;
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
  const seen = new Set();
  const channels = [];

  try {
    const validation = await validateSession(authToken);
    const subscriptions = Array.isArray(validation?.user?.subsMetadata?.subscriptions)
      ? validation.user.subsMetadata.subscriptions
      : [];

    for (const entry of subscriptions) {
      const creator = normalizeCreatorEntry(entry, "Cinefy");
      if (!creator) continue;
      const key = String(creator.id || creator.slug || creator.name || "").toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      channels.push({
        id: `cinefy_${String(creator.id || creator.slug || creator.name || Math.random()).trim()}`,
        slug: String(creator.slug || creator.username || creator.name || "").trim(),
        name: sanitizeText(creator.name || creator.username || "Cinefy Channel", "Cinefy Channel"),
        avatar: resolveImageUrl(creator.avatar || "", "w500"),
        banner: resolveImageUrl(creator.banner || "", "original"),
        description: sanitizeText(creator.description || "Canal Cinefy", "Canal Cinefy"),
        live: false,
        isSubscribed: true,
        source: creator
      });
    }
  } catch (error) {
    console.warn("Cinefy subscription metadata fetch failed:", error.response?.status || error.message);
  }

  try {
    const response = await axios.get(CINEFY_CHANNELS_URL, {
      headers: buildAuthHeaders(authToken),
      timeout: 20000
    });

    const payload = response.data?.data || response.data?.channels || response.data || [];
    const raw = Array.isArray(payload) ? payload : Array.isArray(payload?.items) ? payload.items : [];
    const list = Array.isArray(raw) ? raw : [];

    for (const channel of list) {
      const normalized = normalizeCreatorEntry(channel, "Cinefy");
      if (!normalized) continue;
      const key = String(normalized.id || normalized.slug || normalized.name || "").toLowerCase();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      channels.push({
        id: `cinefy_${String(normalized.id || normalized.slug || normalized.name || Math.random()).trim()}`,
        slug: String(normalized.slug || normalized.username || normalized.name || "").trim(),
        name: sanitizeText(normalized.name || normalized.username || "Cinefy Channel", "Cinefy Channel"),
        avatar: resolveImageUrl(normalized.avatar || "", "w500"),
        banner: resolveImageUrl(normalized.banner || "", "original"),
        description: sanitizeText(normalized.description || "Canal Cinefy", "Canal Cinefy"),
        live: !!channel.is_live,
        isSubscribed: true,
        streamUrl: channel.stream_url || channel.url || "",
        source: channel
      });
    }
  } catch (error) {
    console.warn("Cinefy channels fetch failed:", error.response?.status || error.message);
  }

  return channels;
}

function resolveCreatorName(author, fallback = "Cinefy") {
  if (!author || typeof author !== "object") return fallback;
  return sanitizeText(author.displayName || author.username || author.slug || author.name || author.title || fallback, fallback);
}

function extractPlaybackUrl(video) {
  const stream = video?.stream || video?.media?.stream || video?.playback || {};
  const candidates = [
    stream?.playbackUrl,
    stream?.playback_url,
    stream?.url,
    stream?.hls,
    stream?.m3u8,
    stream?.source,
    stream?.sourceUrl,
    video?.playbackUrl,
    video?.playback_url,
    video?.sourceUrl,
    video?.url
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const value = candidate.trim();
      if (value && /^https?:\/\//i.test(value)) return value;
    }
  }

  return "";
}

function normalizeVideoMeta(video, source = "public") {
  const id = String(video?.id || "").trim();
  if (!id) return null;

  const media = video?.media || {};
  const author = video?.author || video?.creator || video?.channel || {};
  const creatorName = resolveCreatorName(author, "Cinefy");
  const title = sanitizeText(video.title || media.title || video.name || "Cinefy video", "Cinefy video");
  const rawPoster = media.poster || video.thumbnail || video.poster || author?.avatar || video.avatar || "";
  const rawBackground = media.backdrop || author?.banner || video.background || rawPoster || "";
  const poster = resolveImageUrl(rawPoster, "w500") || "https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?auto=format&fit=crop&w=800&q=80";
  const background = resolveImageUrl(rawBackground, "original") || poster;
  const year = video.publishedAt ? new Date(video.publishedAt).getFullYear() : media.releaseYear || undefined;
  const description = sanitizeText(
    video.description || media.overview || title || (source === "personal" ? `Conteúdo recente do usuário autenticado em Cinefy` : `Conteúdo público do Cinefy`),
    source === "personal" ? "Conteúdo recente do usuário autenticado em Cinefy" : "Conteúdo público do Cinefy"
  );
  const isLive = !!(video?.liveStream || video?.type === "live" || String(video?.tags || "").toLowerCase().includes("live"));
  const contentType = media?.type || video?.type || (isLive ? "live" : "movie");
  const genreList = Array.isArray(media?.genres) && media.genres.length ? media.genres : [video?.genre || (isLive ? "live" : "general")];

  return {
    id: `cinefy_video_${id}`,
    type: isLive ? "live" : contentType,
    name: creatorName || title,
    poster,
    background,
    description: title && title !== creatorName ? `${title} • ${creatorName}` : description,
    year,
    genre: String(genreList[0] || (isLive ? "live" : "general")).trim() || (isLive ? "live" : "general"),
    director: creatorName,
    source,
    playbackUrl: extractPlaybackUrl(video),
    raw: video
  };
}

async function fetchVideoDetailById(videoId, token = CINEFY_AUTH_TOKEN) {
  const id = String(videoId || "").trim();
  if (!id) return null;

  const authToken = normalizeAuthToken(token);
  const headers = buildAuthHeaders(authToken || "");

  try {
    const response = await axios.get(`${CINEFY_API_BASE}/v1/video/${encodeURIComponent(id)}`, {
      headers,
      timeout: 20000
    });

    const payload = response.data || null;
    if (!payload || typeof payload !== "object") return null;

    return payload;
  } catch (error) {
    console.warn("Cinefy video detail fetch failed:", id, error.response?.status || error.message);
    return null;
  }
}

async function fetchPublicVideoContent() {
  const urls = [
    "https://api.cinefy.gg/v1/videos?type=live&perPage=35&sortedField=viewers&sortedOrder=desc",
    "https://api.cinefy.gg/v1/videos?perPage=35",
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

  if (type !== "movie" && type !== "series" && type !== "live" && type !== "other") return { metas: [] };

  const [publicItems, personalItems] = await Promise.all([
    fetchPublicVideoContent(),
    fetchPersonalVideoContent(token)
  ]);

  const mainList = [...publicItems, ...personalItems];
  const liveItems = publicItems.filter((item) => item.raw?.liveStream || item.genre === "live");
  const movieItems = publicItems.filter((item) => !(item.raw?.liveStream || item.genre === "live"));
  const others = [...mainList].slice(0, 60);

  let selected = mainList;

  if (id === "cinefy_main" || type === "other") selected = mainList;
  else if (id === "cinefy_movies") selected = movieItems.length ? movieItems : publicItems;
  else if (id === "cinefy_live" || type === "live") selected = liveItems.length ? liveItems : publicItems;
  else if (id === "cinefy_others") selected = others;
  else if (id === "cinefy_series") selected = publicItems.slice(0, 30);
  else selected = mainList;

  const catalogType = type === "series" ? "series" : type === "live" ? "live" : type === "other" ? "other" : "movie";
  return {
    metas: selected.slice(0, 120).map((meta) => ({
      id: meta.id,
      type: catalogType,
      name: meta.name,
      poster: meta.poster,
      background: meta.background,
      description: meta.description,
      genres: [meta.genre],
      languages: ["pt-BR"]
    }))
  };
});

builder.defineMetaHandler(async ({ type, id }) => {
  const allItems = await fetchPublicVideoContent();
  const item = allItems.find((entry) => entry.id === String(id || ""));

  if (type === "movie" || type === "series" || type === "live") {
    if (!item) return { meta: null };

    return {
      meta: {
        id: item.id,
        type: type === "series" ? "series" : type === "live" ? "live" : "movie",
        name: item.name,
        poster: item.poster,
        background: item.background,
        description: item.description,
        genres: [item.genre],
        languages: ["pt-BR"]
      }
    };
  }

  if (type === "channel") {
    const channelId = String(id || "").replace(/^cinefy_/, "");
    if (!channelId) return { meta: null };

    const channels = await fetchSubscribedChannels();
    const channel = channels.find((entry) => entry.id === `cinefy_${channelId}` || entry.slug === channelId || entry.name === channelId);

    if (!channel) {
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
    }

    return {
      meta: {
        id: channel.id,
        type: "channel",
        name: channel.name,
        poster: channel.avatar || channel.poster,
        background: channel.banner || channel.background || channel.poster,
        description: channel.description || "Canal Cinefy"
      }
    };
  }

  return { meta: null };
});

builder.defineStreamHandler(async ({ type, id }) => {
  if (type === "movie" || type === "series" || type === "live") {
    const allItems = await fetchPublicVideoContent();
    const match = allItems.find((entry) => entry.id === String(id || "") || entry.raw?.id === String(id || "") || `cinefy_video_${entry.raw?.id}` === String(id || ""));
    const watchId = String(id || "").replace(/^cinefy_video_/, "") || match?.raw?.id || "";
    const detail = watchId ? await fetchVideoDetailById(watchId) : null;
    const item = match || (detail ? normalizeVideoMeta(detail, "public") : null);
    if (!item) return { streams: [] };

    const playbackUrl = (detail && extractPlaybackUrl(detail)) || item.playbackUrl || extractPlaybackUrl(item.raw) || `https://cinefy.gg/watch/${watchId}`;

    return {
      streams: [
        {
          name: item.name,
          description: item.description,
          url: playbackUrl
        }
      ]
    };
  }

  if (type === "channel") {
    const channelId = String(id || "").replace(/^cinefy_/, "");
    if (!channelId) return { streams: [] };

    return {
      streams: [
        {
          name: "Cinefy Channel",
          description: "Acesso via assinatura Cinefy",
          url: `https://cinefy.gg/${channelId}`
        }
      ]
    };
  }

  return { streams: [] };
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
    version: manifest.version,
    name: "Cinefy",
    catalogs: [
      { type: "other", id: "cinefy_main", name: "Cinefy", extra: [{ name: "token", options: [] }] },
      { type: "movie", id: "cinefy_movies", name: "Cinefy - Filmes", extra: [{ name: "token", options: [] }] },
      { type: "series", id: "cinefy_series", name: "Cinefy - Séries", extra: [{ name: "token", options: [] }] },
      { type: "live", id: "cinefy_live", name: "Cinefy - Live", extra: [{ name: "token", options: [] }] },
      { type: "other", id: "cinefy_others", name: "Cinefy - Outros", extra: [{ name: "token", options: [] }] },
      { type: "channel", id: "cinefy_channels", name: "Cinefy - Canais", extra: [{ name: "token", options: [] }] }
    ],
    resources: ["catalog", "meta", "stream"],
    types: ["movie", "series", "channel", "live", "other"],
    idPrefixes: ["cinefy_", "cinefy_video_", "cinefy_series_"]
  };

  return res.json(subManifest);
});

app.get("/:token/catalog/other/cinefy_main.json", async (req, res) => {
  const token = decodeURIComponent(req.params.token || "");
  const validation = await validateSession(token);

  if (!validation.valid) return res.status(401).json({ metas: [] });

  const [publicItems, personalItems] = await Promise.all([
    fetchPublicVideoContent(),
    fetchPersonalVideoContent(token)
  ]);

  const metas = [...publicItems, ...personalItems].slice(0, 120);
  return res.json({ metas: metas.map((meta) => ({ id: meta.id, type: "other", name: meta.name, poster: meta.poster, background: meta.background, description: meta.description, genres: [meta.genre], languages: ["pt-BR"] })) });
});

app.get("/:token/catalog/movie/cinefy_movies.json", async (req, res) => {
  const token = decodeURIComponent(req.params.token || "");
  const validation = await validateSession(token);

  if (!validation.valid) return res.status(401).json({ metas: [] });

  const publicItems = await fetchPublicVideoContent();
  const metas = publicItems.filter((item) => !(item.raw?.liveStream || item.genre === "live")).slice(0, 120);

  return res.json({ metas: metas.map((meta) => ({ id: meta.id, type: "movie", name: meta.name, poster: meta.poster, background: meta.background, description: meta.description, genres: [meta.genre], languages: ["pt-BR"] })) });
});

app.get("/:token/catalog/live/cinefy_live.json", async (req, res) => {
  const token = decodeURIComponent(req.params.token || "");
  const validation = await validateSession(token);

  if (!validation.valid) return res.status(401).json({ metas: [] });

  const publicItems = await fetchPublicVideoContent();
  const metas = publicItems.filter((item) => item.raw?.liveStream || item.genre === "live").slice(0, 120);

  return res.json({ metas: metas.map((meta) => ({ id: meta.id, type: "live", name: meta.name, poster: meta.poster, background: meta.background, description: meta.description, genres: [meta.genre], languages: ["pt-BR"] })) });
});

app.get("/:token/catalog/other/cinefy_others.json", async (req, res) => {
  const token = decodeURIComponent(req.params.token || "");
  const validation = await validateSession(token);

  if (!validation.valid) return res.status(401).json({ metas: [] });

  const [publicItems, personalItems] = await Promise.all([
    fetchPublicVideoContent(),
    fetchPersonalVideoContent(token)
  ]);

  const metas = [...publicItems, ...personalItems].slice(0, 60);
  return res.json({ metas: metas.map((meta) => ({ id: meta.id, type: "other", name: meta.name, poster: meta.poster, background: meta.background, description: meta.description, genres: [meta.genre], languages: ["pt-BR"] })) });
});

app.get("/:token/catalog/series/cinefy_series.json", async (req, res) => {
  const token = decodeURIComponent(req.params.token || "");
  const validation = await validateSession(token);

  if (!validation.valid) return res.status(401).json({ metas: [] });

  const publicItems = await fetchPublicVideoContent();
  const metas = publicItems.slice(0, 30);

  return res.json({ metas: metas.map((meta) => ({ id: meta.id, type: "series", name: meta.name, poster: meta.poster, background: meta.background, description: meta.description, genres: [meta.genre], languages: ["pt-BR"] })) });
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

  if (!validation.valid) return res.status(401).json({ meta: null });

  const allItems = await fetchPublicVideoContent();
  const item = allItems.find((entry) => entry.id === String(req.params.id || ""));
  if (!item) return res.json({ meta: null });

  return res.json({ meta: { id: item.id, type: "movie", name: item.name, poster: item.poster, background: item.background, description: item.description, genres: [item.genre], languages: ["pt-BR"] } });
});

app.get("/:token/meta/series/:id.json", async (req, res) => {
  const token = decodeURIComponent(req.params.token || "");
  const validation = await validateSession(token);

  if (!validation.valid) return res.status(401).json({ meta: null });

  const allItems = await fetchPublicVideoContent();
  const item = allItems.find((entry) => entry.id === String(req.params.id || ""));
  if (!item) return res.json({ meta: null });

  return res.json({ meta: { id: item.id, type: "series", name: item.name, poster: item.poster, background: item.background, description: item.description, genres: [item.genre], languages: ["pt-BR"] } });
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

  if (!validation.valid) return res.status(401).json({ streams: [] });

  const allItems = await fetchPublicVideoContent();
  const item = allItems.find((entry) => entry.id === String(req.params.id || ""));
  const watchId = String(req.params.id || "").replace(/^cinefy_video_/, "") || item?.raw?.id || "";
  const detail = watchId ? await fetchVideoDetailById(watchId, token) : null;
  const resolved = item || (detail ? normalizeVideoMeta(detail, "public") : null);
  if (!resolved) return res.json({ streams: [] });

  const watchUrl = (detail && extractPlaybackUrl(detail)) || resolved.playbackUrl || extractPlaybackUrl(resolved.raw) || `https://cinefy.gg/watch/${watchId}`;

  return res.json({ streams: [{ name: resolved.name, description: resolved.description, url: watchUrl }] });
});

app.get("/:token/stream/series/:id.json", async (req, res) => {
  const token = decodeURIComponent(req.params.token || "");
  const validation = await validateSession(token);

  if (!validation.valid) return res.status(401).json({ streams: [] });

  const allItems = await fetchPublicVideoContent();
  const item = allItems.find((entry) => entry.id === String(req.params.id || ""));
  const watchId = String(req.params.id || "").replace(/^cinefy_video_/, "") || item?.raw?.id || "";
  const detail = watchId ? await fetchVideoDetailById(watchId, token) : null;
  const resolved = item || (detail ? normalizeVideoMeta(detail, "public") : null);
  if (!resolved) return res.json({ streams: [] });

  const watchUrl = (detail && extractPlaybackUrl(detail)) || resolved.playbackUrl || extractPlaybackUrl(resolved.raw) || `https://cinefy.gg/watch/${watchId}`;

  return res.json({ streams: [{ name: resolved.name, description: resolved.description, url: watchUrl }] });
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
