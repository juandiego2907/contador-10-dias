// Writes a quiet placeholder pad (assets/media/song.wav). Replace with the real song.
import fs from "node:fs";
const rate = 22050, secs = 40, n = rate * secs;
const chords = [[220, 277.18, 329.63], [196, 246.94, 293.66], [174.61, 220, 261.63], [196, 246.94, 329.63]];
const buf = Buffer.alloc(44 + n * 2);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) {
  const t = i / rate, c = chords[Math.floor(t / 5) % 4], ph = (t % 5) / 5;
  const env = Math.min(1, t / 3, (secs - t) / 4) * (0.6 + 0.4 * Math.sin(Math.PI * ph));
  let v = 0; for (const f of c) v += Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t);
  buf.writeInt16LE(Math.round(v / 4 * env * 9000), 44 + i * 2);
}
fs.writeFileSync(new URL("../assets/media/song.wav", import.meta.url), buf);
console.log("song.wav written");
