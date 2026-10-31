// Chapter II player. Minimal custom controls, 1×/2× speed.
// Viewer mode cannot skip ahead, so "ended" always means the film was watched to the end.
import { fmt } from "./util.js";

export function createVlog({ admin, onBeforePlay, onEnded }) {
  const $ = (id) => document.getElementById(id);
  const screen = $("screen"), video = $("video"), big = $("big-play"), msg = $("screen-msg");
  const toggle = $("v-toggle"), seek = $("v-seek"), fill = $("v-fill"), time = $("v-time"), full = $("v-full");
  const rates = [...document.querySelectorAll(".speed button")];

  let src = null, maxSeen = 0, started = false, idleTimer = 0, rate = 1, endedFired = false;

  seek.disabled = !admin;                       // viewers see progress but cannot scrub
  seek.setAttribute("aria-label", admin ? "Seek" : "Progress");

  function say(text, retry) {
    msg.hidden = !text;
    msg.textContent = text || "";
    if (retry) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "link-btn"; b.textContent = "Try again";
      b.onclick = retry;
      msg.append(b);
    }
  }

  async function play() {
    if (!src) return;
    screen.classList.add("is-busy");
    say("");
    try {
      if (!started) {
        await onBeforePlay?.();
        started = true;
        endedFired = false;
        screen.classList.add("is-started");
      }
      video.playbackRate = rate;
      await video.play();
    } catch (e) {
      if (e?.name === "NotAllowedError") say("Press play to begin.");
      else if (e?.code === "consumed") return;          // main.js shows the completed screen
      else say("The film couldn't start.", play);
    } finally {
      screen.classList.remove("is-busy");
    }
  }

  function togglePlay() { video.paused ? play() : video.pause(); }

  big.addEventListener("click", play);
  toggle.addEventListener("click", togglePlay);
  video.addEventListener("click", () => started && togglePlay());

  video.addEventListener("play", () => { screen.classList.add("is-playing"); toggle.setAttribute("aria-label", "Pause"); wake(); });
  video.addEventListener("pause", () => { screen.classList.remove("is-playing", "is-idle"); toggle.setAttribute("aria-label", "Play"); });
  video.addEventListener("waiting", () => screen.classList.add("is-busy"));
  video.addEventListener("playing", () => screen.classList.remove("is-busy"));
  // Some WebM files (e.g. from MediaRecorder) report an unknown duration until the
  // browser has scanned to the end. Force that scan once, invisibly.
  let probing = false;
  video.addEventListener("loadedmetadata", () => {
    if (video.duration === Infinity) { probing = true; video.currentTime = 1e9; }
    time.textContent = `0:00 / ${fmt(video.duration)}`;
  });
  video.addEventListener("durationchange", () => {
    if (probing && isFinite(video.duration)) { probing = false; video.currentTime = 0; }
    time.textContent = `${fmt(video.currentTime)} / ${fmt(video.duration)}`;
  });

  video.addEventListener("timeupdate", () => {
    if (probing) return;
    const t = video.currentTime, d = isFinite(video.duration) ? video.duration : 0;
    if (!video.seeking && t > maxSeen && t - maxSeen < 2) maxSeen = t;   // only real playback moves this forward
    fill.style.width = d ? `${(t / d) * 100}%` : "0";
    if (document.activeElement !== seek) seek.value = d ? Math.round((t / d) * 1000) : 0;
    time.textContent = `${fmt(t)} / ${fmt(d)}`;
  });

  // Viewer: jumping forward (keyboard, native fullscreen controls…) is undone.
  video.addEventListener("seeking", () => {
    if (!admin && !probing && video.currentTime > maxSeen + 0.75) video.currentTime = maxSeen;
  });
  seek.addEventListener("input", () => {
    if (admin && video.duration) video.currentTime = (seek.value / 1000) * video.duration;
  });

  video.addEventListener("ended", () => {
    if (endedFired) return;
    if (probing) return;
    const d = isFinite(video.duration) ? video.duration : video.currentTime;
    if (!admin && maxSeen < d - 1.5) return;                       // not a natural end
    endedFired = true;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    onEnded?.();
  });

  video.addEventListener("error", () => {
    if (!src) return;
    screen.classList.remove("is-started", "is-busy");
    started = false;
    say("The film couldn't be loaded.", () => { load(src); });
  });

  rates.forEach((b) => b.addEventListener("click", () => {
    rate = Number(b.dataset.rate);
    video.playbackRate = rate;
    rates.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  }));

  full.addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (screen.requestFullscreen) screen.requestFullscreen().catch(() => {});
    else if (video.webkitEnterFullscreen) video.webkitEnterFullscreen();     // iPhone
  });

  // Keyboard: space / k toggles, while focus is inside the player.
  screen.addEventListener("keydown", (e) => {
    if ((e.key === " " || e.key === "k") && e.target.tagName !== "BUTTON" && started) { e.preventDefault(); togglePlay(); }
  });

  // Controls fade away while the film plays and nobody moves.
  function wake() {
    screen.classList.remove("is-idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => { if (!video.paused && !screen.contains(document.activeElement)) screen.classList.add("is-idle"); }, 2600);
  }
  ["pointermove", "pointerdown", "focusin", "keydown"].forEach((ev) => screen.addEventListener(ev, wake));

  function load(url) {
    src = url;
    maxSeen = 0; started = false; endedFired = false; probing = false;
    screen.classList.remove("is-started", "is-playing", "is-idle");
    say("");
    video.src = url;
    video.load();
  }

  return {
    load,
    setPoster(url) { if (url) video.poster = url; },
    pause() { if (!video.paused) video.pause(); },
    unavailable(text) { src = null; video.removeAttribute("src"); big.hidden = true; say(text); },
    reset() { big.hidden = false; if (src) load(src); },
  };
}
