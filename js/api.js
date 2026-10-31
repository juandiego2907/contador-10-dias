// Talks to the backend (backend/worker.js). Without a backend it falls back to a
// browser-only adapter that is clearly NOT a real one-time lock.

export class ApiError extends Error {
  constructor(code, status) { super(code); this.code = code; this.status = status; }
}

const ADMIN_KEY = "olt.admin";

export function createApi(base) {
  return base ? remoteApi(base.replace(/\/$/, "")) : localApi();
}

function remoteApi(base) {
  async function call(path, body = {}, auth = false) {
    const headers = { "content-type": "application/json" };
    if (auth) {
      const s = adminSession();
      if (!s) throw new ApiError("unauthorized", 401);
      headers.authorization = "Bearer " + s.session;
    }
    let res;
    try {
      res = await fetch(base + path, { method: "POST", headers, body: JSON.stringify(body) });
    } catch {
      throw new ApiError("network", 0);
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && auth) store.remove(ADMIN_KEY);
      throw new ApiError(data.error || "server_error", res.status);
    }
    return data;
  }

  return {
    secure: true,
    state: (token) => call("/viewer/state", { token }),
    media: async (token, kind) => (await call("/viewer/media", { token, kind })).url,
    start: (token) => call("/viewer/start", { token }),
    complete: (token) => call("/viewer/complete", { token }),

    isAdmin: () => !!adminSession(),
    async login(password) {
      const data = await call("/admin/login", { password });
      store.set(ADMIN_KEY, JSON.stringify(data));
      return true;
    },
    logout: () => store.remove(ADMIN_KEY),
    tokens: () => call("/admin/tokens", {}, true),
    create: (label) => call("/admin/create", { label }, true),
    reset: (token) => call("/admin/reset", { token }, true),
    remove: (token) => call("/admin/delete", { token }, true),
    adminMedia: async (kind) => (await call("/admin/media", { kind }, true)).url,
  };
}

// Browser-only fallback. Each browser keeps its own record, so clearing site data
// or switching device restarts the experience. Only for previews without a backend.
function localApi() {
  const KEY = "olt.local.tokens";
  const all = () => { try { return JSON.parse(store.get(KEY) || "{}"); } catch { return {}; } };
  const save = (o) => store.set(KEY, JSON.stringify(o));
  const rec = (t) => all()[t] || { label: "", createdAt: Date.now(), plays: 0 };
  const put = (t, r) => { const o = all(); o[t] = r; save(o); };
  const stateOf = (r) => r.completedAt ? "consumed" : Date.now() < localApi.unlockAt ? "locked"
    : r.startedAt ? "started" : "ready";
  const valid = (t) => typeof t === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(t);

  console.warn("[one last time] No backend configured (CONFIG.API_BASE is empty). " +
    "One-time playback is only remembered in this browser and is not enforced.");

  return {
    secure: false,
    async state(t) { return valid(t) ? { state: stateOf(rec(t)) } : { state: "invalid" }; },
    async media() { return null; },
    async start(t) { const r = rec(t); r.startedAt = Date.now(); r.plays++; put(t, r); return { state: "started" }; },
    async complete(t) { const r = rec(t); r.completedAt ||= Date.now(); put(t, r); return { state: "consumed" }; },

    isAdmin: () => store.get(ADMIN_KEY) === "local",
    async login() { store.set(ADMIN_KEY, "local"); return true; },
    logout: () => store.remove(ADMIN_KEY),
    async tokens() {
      const o = all();
      return { tokens: Object.entries(o).map(([token, r]) => ({ token, ...r, state: stateOf(r) }))
        .sort((a, b) => b.createdAt - a.createdAt) };
    },
    async create(label) {
      const b = crypto.getRandomValues(new Uint8Array(18));
      const token = btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      put(token, { label, createdAt: Date.now(), plays: 0 });
      return { token };
    },
    async reset(t) { put(t, { ...rec(t), startedAt: undefined, completedAt: undefined, plays: 0 }); return { ok: true }; },
    async remove(t) { const o = all(); delete o[t]; save(o); return { ok: true }; },
    async adminMedia() { return null; },
  };
}
localApi.unlockAt = 0;
export function setLocalUnlock(ms) { localApi.unlockAt = ms; }

function adminSession() {
  try {
    const s = JSON.parse(store.get(ADMIN_KEY) || "null");
    return s && s.exp * 1000 > Date.now() ? s : null;
  } catch { return null; }
}

// Storage that never throws (private windows, blocked storage).
// The admin session lives in sessionStorage: it ends when the tab closes.
export const store = {
  get(k) { try { return (k === ADMIN_KEY ? sessionStorage : localStorage).getItem(k); } catch { return null; } },
  set(k, v) { try { (k === ADMIN_KEY ? sessionStorage : localStorage).setItem(k, v); } catch {} },
  remove(k) { try { (k === ADMIN_KEY ? sessionStorage : localStorage).removeItem(k); } catch {} },
};
