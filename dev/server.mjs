// Local dev server: serves the site and runs backend/worker.js on Node with an
// emulated KV (dev/.data/kv.json) and R2 bucket (dev/private-media/).
// Usage:  node dev/server.mjs [port]
// Env:    ADMIN_PASSWORD (default "dev-admin"), UNLOCK_AT (ms, default = config value)
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import worker from "../backend/worker.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.argv[2] || 8787);
const DATA = path.join(ROOT, "dev", ".data");
const PRIVATE_MEDIA = path.join(ROOT, "dev", "private-media");
fs.mkdirSync(DATA, { recursive: true });

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".jpg": "image/jpeg",
  ".png": "image/png", ".webp": "image/webp", ".mp4": "video/mp4", ".webm": "video/webm",
  ".mp3": "audio/mpeg", ".wav": "audio/wav", ".m4a": "audio/mp4", ".ico": "image/x-icon" };

// ---- KV emulation -----------------------------------------------------------
const kvFile = path.join(DATA, "kv.json");
const kvData = fs.existsSync(kvFile) ? JSON.parse(fs.readFileSync(kvFile, "utf8")) : {};
const saveKv = () => fs.writeFileSync(kvFile, JSON.stringify(kvData, null, 2));
const KV = {
  async get(k) { const e = kvData[k]; if (!e) return null; if (e.exp && e.exp < Date.now()) { delete kvData[k]; return null; } return e.v; },
  async put(k, v, o = {}) { kvData[k] = { v, exp: o.expirationTtl ? Date.now() + o.expirationTtl * 1000 : 0 }; saveKv(); },
  async delete(k) { delete kvData[k]; saveKv(); },
  async list({ prefix = "" } = {}) { return { keys: Object.keys(kvData).filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }; },
};

// ---- R2 emulation (only if dev/private-media exists) ------------------------
const R2 = {
  async get(key, { range } = {}) {
    const file = path.join(PRIVATE_MEDIA, path.basename(key));
    if (!fs.existsSync(file)) return null;
    const size = fs.statSync(file).size;
    const r = parseRange(range?.get?.("range"), size);
    const start = r ? r.offset : 0, end = r ? r.offset + r.length - 1 : size - 1;
    return {
      size, range: r || undefined,
      body: Readable.toWeb(fs.createReadStream(file, { start, end })),
      writeHttpMetadata(h) { h.set("content-type", TYPES[path.extname(file)] || "application/octet-stream"); },
    };
  },
};

const env = {
  TOKENS: KV,
  MEDIA: fs.existsSync(PRIVATE_MEDIA) ? R2 : undefined,
  ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || "dev-admin",
  SIGNING_SECRET: process.env.SIGNING_SECRET || "dev-only-signing-secret",
  UNLOCK_AT: process.env.UNLOCK_AT || "1793419511000",
  ALLOWED_ORIGINS: `http://localhost:${PORT}`,
  MIN_WATCH_SECONDS: process.env.MIN_WATCH_SECONDS || "0",
  MEDIA_KEYS: process.env.MEDIA_KEYS || "{}",
};

function parseRange(h, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec(h || "");
  if (!m) return null;
  let a = m[1] === "" ? size - Number(m[2]) : Number(m[1]);
  let b = m[1] === "" || m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (isNaN(a) || a < 0 || a > b) return null;
  return { offset: a, length: b - a + 1 };
}

// ---- HTTP -------------------------------------------------------------------
http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (url.pathname.startsWith("/api/")) return await toWorker(req, res, url);
    // Dev-only: lets tools/make-placeholders.html save generated files into assets/media.
    if (req.method === "PUT" && url.pathname.startsWith("/__save/")) {
      const name = path.basename(decodeURIComponent(url.pathname.slice(8)));
      const chunks = []; for await (const c of req) chunks.push(c);
      fs.writeFileSync(path.join(ROOT, "assets", "media", name), Buffer.concat(chunks));
      res.writeHead(201).end("saved " + name); return;
    }
    serveStatic(req, res, url);
  } catch (e) {
    console.error(e); res.writeHead(500).end("error");
  }
}).listen(PORT, () => {
  console.log(`ONE LAST TIME dev → http://localhost:${PORT}`);
  console.log(`  admin: http://localhost:${PORT}/#admin   (password from ADMIN_PASSWORD, default "dev-admin")`);
  console.log(`  unlock at: ${new Date(Number(env.UNLOCK_AT)).toString()}`);
  console.log(`  private media: ${env.MEDIA ? PRIVATE_MEDIA : "off (using public assets/media paths)"}`);
});

async function toWorker(req, res, url) {
  const chunks = []; for await (const c of req) chunks.push(c);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) headers.set(k, Array.isArray(v) ? v.join(",") : v);
  const request = new Request(url, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
  const response = await worker.fetch(request, env);
  res.writeHead(response.status, Object.fromEntries(response.headers));
  if (response.body) Readable.fromWeb(response.body).pipe(res); else res.end();
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.join(ROOT, rel);
  const rp = "/" + path.relative(ROOT, file).replace(/\\/g, "/");
  const blocked = /^\/(backend|\.git|dev\/\.data|dev\/private-media)(\/|$)/.test(rp);
  if (!file.startsWith(ROOT) || blocked || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end("Not found"); return;
  }
  const size = fs.statSync(file).size;
  const type = TYPES[path.extname(file)] || "application/octet-stream";
  const r = parseRange(req.headers.range, size);
  if (r) {
    res.writeHead(206, { "content-type": type, "accept-ranges": "bytes", "content-length": r.length,
      "content-range": `bytes ${r.offset}-${r.offset + r.length - 1}/${size}`, "cache-control": "no-cache" });
    fs.createReadStream(file, { start: r.offset, end: r.offset + r.length - 1 }).pipe(res);
  } else {
    res.writeHead(200, { "content-type": type, "accept-ranges": "bytes", "content-length": size, "cache-control": "no-cache" });
    fs.createReadStream(file).pipe(res);
  }
}
