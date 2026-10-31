// Chapter III. The song never starts by itself: only the Play button starts it.
import { fmt } from "./util.js";

export function createSong({ title, artist }) {
  const $ = (id) => document.getElementById(id);
  const audio = $("audio"), player = $("player"), toggle = $("a-toggle");
  const seek = $("a-seek"), fill = $("a-fill"), cur = $("a-cur"), dur = $("a-dur");
  const status = $("song-status"), cover = $("cover"), img = $("cover-img");

  $("song-title").textContent = title;
  if (artist) { $("song-artist").textContent = artist; $("song-artist").hidden = false; }
  img.alt = `Cover art for ${title}`;

  let src = null;

  toggle.addEventListener("click", async () => {
    if (!src) return;
    if (!audio.paused) { audio.pause(); return; }
    status.textContent = "";
    try { await audio.play(); }
    catch { status.textContent = "The song couldn't start. Try once more."; }
  });

  audio.addEventListener("play", () => { player.classList.add("is-playing"); toggle.setAttribute("aria-label", "Pause the song"); });
  audio.addEventListener("pause", () => { player.classList.remove("is-playing"); toggle.setAttribute("aria-label", "Play the song"); });
  audio.addEventListener("loadedmetadata", () => { dur.textContent = fmt(audio.duration); });
  audio.addEventListener("timeupdate", () => {
    const d = audio.duration || 0;
    fill.style.width = d ? `${(audio.currentTime / d) * 100}%` : "0";
    if (document.activeElement !== seek) seek.value = d ? Math.round((audio.currentTime / d) * 1000) : 0;
    cur.textContent = fmt(audio.currentTime);
    seek.setAttribute("aria-valuetext", `${fmt(audio.currentTime)} of ${fmt(d)}`);
  });
  audio.addEventListener("ended", () => { audio.currentTime = 0; });
  audio.addEventListener("error", () => { if (src) status.textContent = "The song couldn't be loaded."; });
  seek.addEventListener("input", () => { if (audio.duration) audio.currentTime = (seek.value / 1000) * audio.duration; });

  img.addEventListener("load", () => cover.classList.add("has-img"));
  img.addEventListener("error", () => cover.classList.remove("has-img"));   // falls back to the placeholder

  // Lyrics: plain text, verses separated by a blank line. Hidden until asked for.
  const lyricsBtn = $("lyrics-toggle"), lyricsBox = $("lyrics");
  lyricsBtn.addEventListener("click", () => {
    const open = lyricsBox.hidden;
    lyricsBox.hidden = !open;
    lyricsBtn.setAttribute("aria-expanded", String(open));
    lyricsBtn.textContent = open ? "Hide lyrics" : "Lyrics";
    if (open) requestAnimationFrame(() => lyricsBox.classList.add("is-open"));
    else lyricsBox.classList.remove("is-open");
  });

  function showLyrics(text) {
    const verses = text.replace(/\r/g, "").trim().split(/\n\s*\n/);
    lyricsBox.replaceChildren(...verses.map((v) => {
      const p = document.createElement("p");
      const lines = v.split("\n").map((l) => l.trim());
      if (/^(ready\?|baby)$/i.test(lines[0])) p.className = "chorus";
      lines.forEach((l, i) => { if (i) p.append(document.createElement("br")); p.append(l); });
      return p;
    }));
    lyricsBtn.hidden = false;
  }

  return {
    async loadLyrics(url) {
      if (!url) return;
      try {
        const res = await fetch(url);
        if (res.ok) showLyrics(await res.text());
      } catch { /* no lyrics: the button simply stays hidden */ }
    },
    load(audioUrl, coverUrl) {
      if (audioUrl && audioUrl !== src) { src = audioUrl; audio.src = audioUrl; status.textContent = ""; }
      if (coverUrl) img.src = coverUrl;
    },
    unavailable(text) { src = null; status.textContent = text; },
    pause() { if (!audio.paused) audio.pause(); },
  };
}
