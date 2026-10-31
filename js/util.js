export function fmt(s) {
  if (!isFinite(s)) return "–:––";
  s = Math.floor(s);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
