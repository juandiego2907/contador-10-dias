// ONE LAST TIME — everything you are expected to change lives here.
const isLocal = ["localhost", "127.0.0.1"].includes(location.hostname);

export const CONFIG = {
  // Countdown end (ms since epoch). Fixed when the page was first published:
  // 10 days from upload. Do not change it unless you mean to restart the countdown.
  // The backend has the same value as UNLOCK_AT (backend/wrangler.toml).
  UNLOCK_AT: 1793419511000,

  // Backend URL (the Cloudflare Worker), e.g. "https://one-last-time.<you>.workers.dev/api".
  // Empty = no backend: one-time playback is only remembered in this browser (NOT secure).
  // On localhost the dev server (node dev/server.mjs) answers at /api.
  API_BASE: isLocal ? "/api" : "https://one-last-time.juandiego2907.workers.dev/api",

  // Public fallback media paths. Used when the backend has no private bucket.
  // Anything in this folder is public on GitHub Pages — see README before
  // putting a personal video here.
  media: {
    vlog: "assets/media/vlog.mp4",
    vlogPoster: "",                       // optional still frame, e.g. "assets/media/vlog-poster.jpg"
    song: "assets/media/song.mp3",
    cover: "assets/media/cover.jpg",
  },

  song: {
    title: "(Ready?)",
    artist: "",                           // optional line under the title
  },
};
