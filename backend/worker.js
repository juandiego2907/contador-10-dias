// ONE LAST TIME — backend (Cloudflare Worker).
//
// Holds the one-time viewer tokens and serves the private media.
// Bindings (see wrangler.toml):
//   TOKENS          KV namespace   token records
//   MEDIA           R2 bucket      vlog / song / cover files (optional; without it the
//                                  frontend falls back to the public paths in config.js)
// Secrets / vars:
//   ADMIN_PASSWORD  secret         admin login
//   SIGNING_SECRET  secret         signs admin sessions and media links
//   UNLOCK_AT       var            countdown end in ms (same value as CONFIG.UNLOCK_AT)
//   ALLOWED_ORIGINS var            comma-separated origins allowed to call the API
//   MIN_WATCH_SECONDS var          minimum seconds between "start" and "complete"
//   MEDIA_KEYS      var            JSON map kind -> R2 key, e.g. {"vlog":"vlog.mp4"}

const ADMIN_TTL = 12 * 3600;      // seconds an admin session lasts
const MEDIA_TTL = 4 * 3600;       // seconds a signed media link lasts
const KINDS = ["vlog", "song", "cover", "lyrics"];
const DEFAULT_KEYS = { vlog: "vlog.mp4", song: "song.mp3", cover: "cover.jpg", lyrics: "lyrics.txt" };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cors = corsHeaders(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });

    try {
      const path = url.pathname.replace(/^\/api/, "");
      if (request.method === "GET" && path.startsWith("/media/")) return await serveMedia(request, env, url, cors);
      if (request.method !== "POST") return json({ error: "not_found" }, 404, cors);

      const body = await request.json().catch(() => ({}));
      const route = ROUTES[path];
      if (!route) return json({ error: "not_found" }, 404, cors);
      if (route.admin && !(await isAdmin(request, env))) return json({ error: "unauthorized" }, 401, cors);
      const [data, status = 200] = await route.run(body, env, request, url);
      return json(data, status, cors);
    } catch (err) {
      console.error(err);
      return json({ error: "server_error" }, 500, cors);
    }
  },
};

const ROUTES = {
  // ---- viewer -------------------------------------------------------------
  "/viewer/state": { run: async (b, env) => {
    const rec = await getToken(env, b.token);
    if (!rec) return [{ state: "invalid" }];
    return [{ state: viewerState(rec, env), unlockAt: unlockAt(env) }];
  }},

  "/viewer/media": { run: async (b, env, req, url) => {
    const rec = await getToken(env, b.token);
    if (!rec) return [{ error: "invalid" }, 403];
    const state = viewerState(rec, env);
    const kind = String(b.kind);
    if (!KINDS.includes(kind)) return [{ error: "bad_kind" }, 400];
    // The vlog is only reachable while it is unlocked and not yet consumed.
    // The song and cover open once the vlog has been watched.
    if (kind === "vlog" && state !== "ready" && state !== "started") return [{ error: state }, 403];
    if (kind !== "vlog" && state !== "consumed") return [{ error: state }, 403];
    return [{ url: await signedMediaUrl(env, url, kind) }];
  }},

  "/viewer/start": { run: async (b, env) => {
    const rec = await getToken(env, b.token);
    if (!rec) return [{ error: "invalid" }, 403];
    const state = viewerState(rec, env);
    if (state === "locked" || state === "consumed") return [{ error: state }, 403];
    rec.startedAt = Date.now();
    rec.plays = (rec.plays || 0) + 1;
    await putToken(env, b.token, rec);
    return [{ state: "started" }];
  }},

  "/viewer/complete": { run: async (b, env) => {
    const rec = await getToken(env, b.token);
    if (!rec) return [{ error: "invalid" }, 403];
    if (rec.completedAt) return [{ state: "consumed" }];            // idempotent
    if (!rec.startedAt) return [{ error: "not_started" }, 409];
    const min = Number(env.MIN_WATCH_SECONDS || 0) * 1000;
    if (Date.now() - rec.startedAt < min) return [{ error: "too_soon" }, 409];
    rec.completedAt = Date.now();
    await putToken(env, b.token, rec);
    return [{ state: "consumed" }];
  }},

  // ---- admin --------------------------------------------------------------
  "/admin/login": { run: async (b, env, req) => {
    const ip = req.headers.get("cf-connecting-ip") || "local";
    const rlKey = "rl:" + ip;
    const tries = Number(await env.TOKENS.get(rlKey)) || 0;
    if (tries >= 10) return [{ error: "too_many_attempts" }, 429];
    if (!env.ADMIN_PASSWORD || !(await safeEqual(env, String(b.password || ""), env.ADMIN_PASSWORD))) {
      await env.TOKENS.put(rlKey, String(tries + 1), { expirationTtl: 900 });
      return [{ error: "wrong_password" }, 401];
    }
    const exp = now() + ADMIN_TTL;
    return [{ session: `${exp}.${await sign(env, "admin." + exp)}`, exp }];
  }},

  "/admin/tokens": { admin: true, run: async (b, env) => {
    const list = await env.TOKENS.list({ prefix: "tok:" });
    const tokens = [];
    for (const k of list.keys) {
      const rec = JSON.parse((await env.TOKENS.get(k.name)) || "null");
      if (rec) tokens.push({ token: k.name.slice(4), ...rec, state: viewerState(rec, env) });
    }
    tokens.sort((a, b) => b.createdAt - a.createdAt);
    return [{ tokens, unlockAt: unlockAt(env) }];
  }},

  "/admin/create": { admin: true, run: async (b, env) => {
    const token = randomToken();
    const rec = { label: String(b.label || "").slice(0, 60), createdAt: Date.now(), plays: 0 };
    await putToken(env, token, rec);
    return [{ token, ...rec, state: viewerState(rec, env) }];
  }},

  "/admin/reset": { admin: true, run: async (b, env) => {
    const rec = await getToken(env, b.token);
    if (!rec) return [{ error: "invalid" }, 404];
    delete rec.startedAt; delete rec.completedAt; rec.plays = 0;
    await putToken(env, b.token, rec);
    return [{ ok: true }];
  }},

  "/admin/delete": { admin: true, run: async (b, env) => {
    await env.TOKENS.delete("tok:" + b.token);
    return [{ ok: true }];
  }},

  "/admin/media": { admin: true, run: async (b, env, req, url) => {
    const kind = String(b.kind);
    if (!KINDS.includes(kind)) return [{ error: "bad_kind" }, 400];
    return [{ url: await signedMediaUrl(env, url, kind) }];
  }},
};

// ---- token records ----------------------------------------------------------
function validToken(t) { return typeof t === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(t); }
async function getToken(env, t) {
  if (!validToken(t)) return null;
  return JSON.parse((await env.TOKENS.get("tok:" + t)) || "null");
}
function putToken(env, t, rec) { return env.TOKENS.put("tok:" + t, JSON.stringify(rec)); }
function unlockAt(env) { return Number(env.UNLOCK_AT || 0); }
function viewerState(rec, env) {
  if (rec.completedAt) return "consumed";
  if (Date.now() < unlockAt(env)) return "locked";
  return rec.startedAt ? "started" : "ready";
}
function randomToken() {
  const b = crypto.getRandomValues(new Uint8Array(18));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---- media ------------------------------------------------------------------
async function signedMediaUrl(env, url, kind) {
  if (!env.MEDIA) return null;                     // no bucket: frontend uses public paths
  const exp = now() + MEDIA_TTL;
  const sig = await sign(env, `media.${kind}.${exp}`);
  return `${url.origin}/api/media/${kind}?exp=${exp}&sig=${sig}`;
}

async function serveMedia(request, env, url, cors) {
  const kind = url.pathname.split("/").pop();
  const exp = Number(url.searchParams.get("exp"));
  const sig = url.searchParams.get("sig") || "";
  if (!env.MEDIA || !KINDS.includes(kind) || !(exp > now())) return new Response("Gone", { status: 410 });
  if (!(await safeEqual(env, sig, await sign(env, `media.${kind}.${exp}`)))) return new Response("Forbidden", { status: 403 });

  const keys = { ...DEFAULT_KEYS, ...JSON.parse(env.MEDIA_KEYS || "{}") };
  const obj = await env.MEDIA.get(keys[kind], { range: request.headers });
  if (!obj) return new Response("Not found", { status: 404 });

  const headers = new Headers(cors);   // lyrics are read with fetch(), which needs CORS
  obj.writeHttpMetadata(headers);
  headers.set("accept-ranges", "bytes");
  headers.set("cache-control", "private, max-age=3600");
  let status = 200;
  if (obj.range && request.headers.has("range")) {
    const offset = obj.range.offset ?? obj.size - obj.range.suffix;
    const length = obj.range.length ?? obj.size - offset;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set("content-length", String(length));
    status = 206;
  } else {
    headers.set("content-length", String(obj.size));
  }
  return new Response(obj.body, { status, headers });
}

// ---- auth helpers -----------------------------------------------------------
async function isAdmin(request, env) {
  const m = /^Bearer (\d+)\.([\w-]+)$/.exec(request.headers.get("authorization") || "");
  if (!m || Number(m[1]) < now()) return false;
  return safeEqual(env, m[2], await sign(env, "admin." + m[1]));
}

async function hmacKey(env) {
  if (!env.SIGNING_SECRET) throw new Error("SIGNING_SECRET is not set");
  return crypto.subtle.importKey("raw", new TextEncoder().encode(env.SIGNING_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
}
async function sign(env, msg) {
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(env), new TextEncoder().encode(msg));
  return btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
// Compares two strings in constant time by comparing their HMACs.
async function safeEqual(env, a, b) {
  const [x, y] = await Promise.all([sign(env, "cmp." + a), sign(env, "cmp." + b)]);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.min(x.length, y.length); i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

function now() { return Math.floor(Date.now() / 1000); }

function corsHeaders(request, env) {
  const origin = request.headers.get("origin") || "";
  const allowed = String(env.ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  const h = { "access-control-allow-methods": "GET, POST, OPTIONS",
              "access-control-allow-headers": "content-type, authorization",
              "access-control-max-age": "86400", vary: "origin" };
  if (allowed.includes(origin)) h["access-control-allow-origin"] = origin;
  return h;
}

function json(data, status, extra) {
  return new Response(JSON.stringify(data), {
    status, headers: { "content-type": "application/json", "cache-control": "no-store", ...extra },
  });
}
