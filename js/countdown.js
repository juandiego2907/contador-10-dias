// The original countdown, unchanged in behaviour: a fixed end time, so it keeps
// running whether or not anyone has the page open.
export function startCountdown(FIN, onZero) {
  var p = function (x) { return String(x).padStart(2, "0"); };
  var fired = false;
  function tick() {
    var r = Math.max(0, Math.floor((FIN - Date.now()) / 1000));
    document.getElementById("d").textContent = p(Math.floor(r / 86400));
    document.getElementById("h").textContent = p(Math.floor(r % 86400 / 3600));
    document.getElementById("m").textContent = p(Math.floor(r % 3600 / 60));
    document.getElementById("s").textContent = p(r % 60);
    if (r === 0 && !fired) {
      fired = true;
      document.getElementById("c").classList.add("is-zero");
      onZero();
    }
  }
  tick(); setInterval(tick, 1000);
}
