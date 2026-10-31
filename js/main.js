// ONE LAST TIME — chapter flow and access modes.
//
//   #t=<token>  viewer   one-time vlog, enforced by the backend
//   #admin      admin    password login (sent in the request body), unlimited previews
//   (nothing)   public   countdown only; the film itself needs a viewer link
import { CONFIG } from "./config.js";
import { createApi, setLocalUnlock, store } from "./api.js";
import { startCountdown } from "./countdown.js";
import { createVlog } from "./vlog.js";
import { createSong } from "./song.js";
import { initAdmin } from "./admin.js";
import { reducedMotion, wait } from "./util.js";

const api = createApi(CONFIG.API_BASE);
setLocalUnlock(CONFIG.UNLOCK_AT);

const $ = (id) => document.getElementById(id);
const chapters = { intro: $("intro"), vlog: $("vlog"), song: $("song") };
const introStatus = $("intro-status");

// ---- who is watching --------------------------------------------------------
const hash = new URLSearchParams(location.hash.slice(1));
const wantsAdmin = location.hash === "#admin";
let token = hash.get("t") || (!wantsAdmin && store.get("olt.token")) || null;
if (hash.get("t")) store.set("olt.token", token);
// Without a backend there is nothing to validate against, so the original link
// (no token) keeps working with a browser-only record.
if (!token && !api.secure && !wantsAdmin) token = "public-viewer-local-0001";

let mode = wantsAdmin ? "admin" : token ? "viewer" : "public";

// ---- chapter mechanics ------------------------------------------------------
// A chapter is "in" when it fills at least a third of the screen. Measured against the
// viewport, not the chapter, so a tall chapter (the song with its lyrics open) still counts.
const seen = new IntersectionObserver((entries) => {
  for (const e of entries) {
    const inView = e.isIntersecting &&
      e.intersectionRect.height >= Math.min(e.boundingClientRect.height, innerHeight) * 0.35;
    e.target.classList.toggle("is-in", inView);
    if (!inView && e.target === chapters.vlog) vlog.pause();    // leaving the film pauses it
    if (!inView && e.target === chapters.song) song.pause();
  }
}, { threshold: [0, 0.05, 0.1, 0.2, 0.35, 0.5, 0.75, 1] });
Object.values(chapters).forEach((c) => seen.observe(c));

function unlock(name) {
  chapters[name].hidden = false;
  document.documentElement.classList.remove("is-locked");
  if (name === "vlog" || name === "song") $("intro-next").hidden = false;
}

// Fade to black, cut, fade in — the cinematic version of scrolling.
async function cutTo(name) {
  unlock(name);
  const curtain = $("curtain");
  const dur = reducedMotion() ? 300 : 1400;
  curtain.classList.add("is-down");
  await wait(dur);
  chapters[name].scrollIntoView({ behavior: "instant", block: "start" });
  await wait(250);
  curtain.classList.remove("is-down");
  const focusable = chapters[name].querySelector("button:not([hidden]), [tabindex]");
  focusable?.focus({ preventScroll: true });
}

$("intro-next").addEventListener("click", () => {
  const next = !chapters.vlog.hidden ? "vlog" : "song";
  chapters[next].scrollIntoView({ behavior: reducedMotion() ? "instant" : "smooth" });
});
$("to-song").addEventListener("click", () => cutTo("song"));

// ---- players ----------------------------------------------------------------
const vlog = createVlog({
  admin: mode === "admin",
  async onBeforePlay() {
    if (mode !== "viewer") return;                       // admin previews never touch a token
    try {
      await api.start(token);
    } catch (e) {
      if (e.code === "consumed") showCompleted();
      throw e;
    }
  },
  onEnded: finishVlog,
});
vlog.setPoster(CONFIG.media.vlogPoster);
const song = createSong(CONFIG.song);

async function mediaUrl(kind) {
  try {
    const url = mode === "admin" ? await api.adminMedia(kind) : await api.media(token, kind);
    return url || CONFIG.media[kind];
  } catch (e) {
    if (e.code === "consumed") return "consumed";
    if (e.status === 403 || e.status === 401) return null;
    return CONFIG.media[kind];         // network blip on a backend without a bucket: public path still works
  }
}

async function loadVlog() {
  const url = await mediaUrl("vlog");
  if (url === "consumed") return showCompleted();
  if (!url) return vlog.unavailable("The film isn't available right now.");
  vlog.load(url);
}

async function loadSong() {
  const [a, c, l] = await Promise.all([mediaUrl("song"), mediaUrl("cover"), mediaUrl("lyrics")]);
  if (!a || a === "consumed") song.unavailable("The song isn't available right now.");
  else song.load(a, c && c !== "consumed" ? c : CONFIG.media.cover);
  if (l && l !== "consumed") song.loadLyrics(l);
}

function showCompleted() {
  $("screen").hidden = true;
  $("vlog-done").hidden = false; $("vlog-note").hidden = true;
  vlog.pause();
  unlock("song");
  loadSong();
}

async function finishVlog() {
  if (mode === "viewer") {
    // Remember the token as used. Retries quietly; the song opens either way.
    for (let i = 0; i < 4; i++) {
      try { await api.complete(token); break; } catch (e) { if (e.status && e.status < 500) break; await wait(1500 * (i + 1)); }
    }
    $("screen").hidden = true;
    $("vlog-done").hidden = false; $("vlog-note").hidden = true;
  }
  await loadSong();
  await wait(reducedMotion() ? 200 : 1200);
  cutTo("song");
}

// ---- viewer state -----------------------------------------------------------
async function viewerState() {
  for (let i = 0; ; i++) {
    try { return (await api.state(token)).state; }
    catch {
      introStatus.textContent = "The film is taking a moment…";
      await wait(Math.min(15000, 2000 * (i + 1)));
    }
  }
}

async function onCountdownEnd(firstLoad) {
  if (mode === "public") {
    introStatus.textContent = "This film was made for someone in particular.";
    return;
  }
  if (mode === "admin") return;
  let state = await viewerState();
  // The server's clock decides. If it is a few seconds behind, wait for it.
  while (state === "locked") { await wait(5000); state = await viewerState(); }
  introStatus.textContent = "";
  if (state === "invalid") {
    introStatus.textContent = "This link doesn't open anything.";
    return;
  }
  if (state === "consumed") {
    if (firstLoad) await wait(reducedMotion() ? 300 : 2200);   // let the intro breathe before the cut
    unlock("vlog"); showCompleted(); return cutTo("vlog");
  }
  const loading = loadVlog();
  if (firstLoad) await playLeader();
  await loading;
  cutTo("vlog");
}

// 5, 4, 3, 2, 1 — a film leader in place of the finished countdown.
async function playLeader() {
  const c = $("c"), leader = $("leader"), n = $("leader-n");
  await wait(1200);
  c.classList.add("is-leaving");
  await wait(700);
  c.hidden = true;
  leader.hidden = false;
  for (let i = 5; i >= 1; i--) {
    n.textContent = i;
    leader.classList.remove("tick");
    void leader.offsetWidth;                 // restart the per-second animation
    leader.classList.add("tick");
    await wait(1000);
  }
  leader.classList.add("is-out");
}

// ---- start --------------------------------------------------------------------
document.documentElement.classList.add("is-locked");
requestAnimationFrame(() => chapters.intro.classList.add("is-in"));

const loadedAfterEnd = Date.now() >= CONFIG.UNLOCK_AT;
startCountdown(CONFIG.UNLOCK_AT, () => onCountdownEnd(loadedAfterEnd));

// A broken link should say so now, not when the countdown ends.
if (mode === "viewer" && !loadedAfterEnd) {
  api.state(token).then((r) => { if (r.state === "invalid") introStatus.textContent = "This link doesn't open anything."; }, () => {});
}

if (mode === "admin") {
  initAdmin({
    api,
    viewerLink: (t) => `${location.origin}${location.pathname}#t=${t}`,
    onCancel() { mode = "public"; history.replaceState(null, "", location.pathname); if (Date.now() >= CONFIG.UNLOCK_AT) onCountdownEnd(false); },
    async onReady() {
      unlock("vlog"); unlock("song");
      $("screen").hidden = false; $("vlog-done").hidden = true; $("vlog-note").hidden = false;
      await Promise.all([loadVlog(), loadSong()]);
    },
    go: (name) => chapters[name].scrollIntoView({ behavior: reducedMotion() ? "instant" : "smooth" }),
    async simulateEnd() {
      chapters.intro.scrollIntoView({ behavior: "instant" });
      $("c").hidden = false; $("c").classList.remove("is-leaving");
      $("leader").hidden = true; $("leader").classList.remove("is-out");
      await playLeader();
      vlog.reset();
      cutTo("vlog");
    },
  });
}
