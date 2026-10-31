# ONE LAST TIME

A three-chapter film on one page: **I · the countdown**, **II · the vlog** (watched once per viewer link), **III · the song**.
Static site (GitHub Pages) plus a small Cloudflare Worker that enforces the one-time viewing on the server.

## Your files

| What | Where it goes | Config |
|---|---|---|
| Vlog | private bucket (recommended) or `assets/media/` | `media.vlog` in `js/config.js` |
| Song demo | private bucket or `assets/media/` | `media.song` |
| Cover | private bucket or `assets/media/` | `media.cover` |
| Song title / artist | — | `song.title`, `song.artist` |

The originals live in `fotos, videos y musica/`. `assets/media/vlog.mp4` (720p, ~2 Mbps) and `song.mp3` (192k) were
made from them with FFmpeg. All three are in `.gitignore`, so they never reach GitHub.

**The GitHub repo and GitHub Pages are public.** Anything in `assets/media/` can be downloaded by anyone who
finds the URL, no matter what the page does. For a personal vlog, upload it to the R2 bucket instead
(see below). The page then streams it through short-lived signed links that only a valid, unused viewer link can get.

Prefer `.mp4` (H.264 + AAC) for the vlog: it plays everywhere, including iPhone. `.mp3` or `.m4a` for the song,
`.jpg` square for the cover (1200×1200 is plenty).

## Access modes

- **Viewer:** `https://juandiego2907.github.io/contador-10-dias/#t=<token>`. The vlog plays once. Forward seeking is blocked,
  and only the natural end of the video marks the link as used. Leaving half-way doesn't. Reopening a used link shows
  a "Some moments only happen once" screen and the song.
- **Admin:** `…/contador-10-dias/#admin`. Asks for the password (sent in a POST body, never in the URL).
  Create viewer links, copy them, reset or delete them, preview every chapter, scrub freely and replay as often
  as you like. Previews never touch a viewer link.
- **No token:** the countdown only. When it ends, "This film was made for someone in particular."

## Backend: Cloudflare Worker (free tier)

```bash
npm i -g wrangler          # or prefix every command with npx
cd backend
wrangler login
wrangler kv namespace create TOKENS        # paste the id into wrangler.toml
wrangler r2 bucket create one-last-time-media
wrangler secret put ADMIN_PASSWORD         # your admin password
wrangler secret put SIGNING_SECRET         # any long random string
wrangler r2 object put one-last-time-media/vlog.mp4  --file ../assets/media/vlog.mp4  --content-type video/mp4  --remote
wrangler r2 object put one-last-time-media/song.mp3  --file ../assets/media/song.mp3  --content-type audio/mpeg --remote
wrangler r2 object put one-last-time-media/cover.svg --file ../assets/media/cover.svg --content-type image/svg+xml --remote
wrangler deploy
```

Then set `API_BASE` in `js/config.js` to the deployed URL plus `/api`
(e.g. `https://one-last-time.<you>.workers.dev/api`) and push.
In `wrangler.toml` also set `MIN_WATCH_SECONDS` to about half the vlog's length, so the server rejects a
"finished" call that comes too soon after "started" (2× speed still passes).

Without a backend (`API_BASE` empty), the site still works, but the one-time rule lives only in each browser's
localStorage. That's **not** secure: another browser or a cleared cache starts over. The admin panel says so.

## Local development

```bash
node dev/server.mjs
```

Serves the site at http://localhost:8787 and runs the **same** `backend/worker.js` with an emulated KV
(`dev/.data/`) and, if the folder `dev/private-media/` exists, an emulated R2 bucket (set `MEDIA_KEYS` to match
the file names). Admin password: `dev-admin`, or `ADMIN_PASSWORD=… node dev/server.mjs`.

- `npm run check`: syntax-checks every JS file.
- `dev/test.html?unlock=<ms>#t=<token>`: loads the page with its clock shifted so the countdown ends when a
  dev server started with `UNLOCK_AT=<ms>` unlocks. Used to test the countdown → vlog cut without waiting.
- `dev/make-vlog.html` and `dev/make-song.mjs`: regenerate the placeholders.

## Files

```
index.html          the three chapters + admin panel markup
css/style.css       look, grain, vignette, transitions, reduced-motion
js/config.js        ← everything you change: unlock time, API_BASE, media paths, song title
js/countdown.js     the original countdown, same logic
js/main.js          chapter flow and access modes
js/vlog.js          video player (1×/2×, no forward seeking for viewers)
js/song.js          audio player
js/admin.js         admin login and panel
js/api.js           backend client + browser-only fallback
backend/worker.js   Cloudflare Worker: tokens, admin auth, signed media
backend/wrangler.toml
dev/                local server, test harness, placeholder generators
```

## Honest limits

- The worker uses KV, which is eventually consistent (up to about 60 s across regions). Opening the same link in two
  places within that minute could slip one extra viewing through. Durable Objects would close that gap.
- A signed media link stays valid for 4 hours once issued. Someone technical could save the stream during that window.
  No web page can stop screen recording.
- Countdown end: `1793419511000` = **Oct 31 2026, 00:05:11 (Venezuela)**, the same as before. `CONFIG.UNLOCK_AT`
  and `UNLOCK_AT` in `wrangler.toml` must stay equal.
