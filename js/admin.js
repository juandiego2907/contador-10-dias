// Admin mode (#admin). The password is only ever sent in a POST body to the backend;
// the browser keeps a short-lived signed session in sessionStorage, never the password.
export function initAdmin({ api, viewerLink, onReady, onCancel, go, simulateEnd }) {
  const $ = (id) => document.getElementById(id);
  const dialog = $("admin-login"), form = $("admin-login-form"), pass = $("admin-pass"), loginErr = $("admin-login-err");
  const panel = $("admin"), tab = $("admin-tab"), body = $("admin-body"), list = $("admin-list"), err = $("admin-err");

  if (api.isAdmin()) open();
  else if (!api.secure) { api.login(); open(); }       // no backend: local preview only, nothing to protect
  else { dialog.showModal(); pass.focus(); }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    loginErr.textContent = "";
    try {
      await api.login(pass.value);
      pass.value = "";
      dialog.close();
      open();
    } catch (x) {
      loginErr.textContent = x.code === "too_many_attempts" ? "Too many attempts. Wait 15 minutes."
        : x.code === "network" ? "Can't reach the backend." : "Wrong password.";
    }
  });
  $("admin-login-cancel").addEventListener("click", () => { dialog.close(); onCancel(); });
  dialog.addEventListener("cancel", () => onCancel());

  function open() {
    panel.hidden = false;
    const m = $("admin-mode");
    m.textContent = api.secure ? "Backend connected · viewer links are enforced by the server."
      : "Local only · no backend configured. Playback limits live in each browser and are NOT secure.";
    m.classList.toggle("is-warn", !api.secure);
    onReady();
    refresh();
  }

  tab.addEventListener("click", () => {
    const show = body.hidden;
    body.hidden = !show;
    tab.setAttribute("aria-expanded", String(show));
  });
  panel.querySelectorAll("[data-go]").forEach((b) => b.addEventListener("click", () => go(b.dataset.go)));
  $("admin-sim").addEventListener("click", simulateEnd);
  $("admin-refresh").addEventListener("click", refresh);
  $("admin-logout").addEventListener("click", () => { api.logout(); location.replace(location.pathname); });

  $("admin-create").addEventListener("submit", async (e) => {
    e.preventDefault();
    await guard(async () => { await api.create($("admin-label").value.trim()); $("admin-label").value = ""; });
  });

  async function guard(fn) {
    err.textContent = "";
    try { await fn(); await refresh(); }
    catch (x) {
      if (x.code === "unauthorized") { panel.hidden = true; dialog.showModal(); return; }
      err.textContent = x.code === "network" ? "Can't reach the backend." : `Error: ${x.code}`;
    }
  }

  async function refresh() {
    let data;
    try { data = await api.tokens(); }
    catch (x) {
      if (x.code === "unauthorized") { panel.hidden = true; dialog.showModal(); }
      else err.textContent = "Can't load viewer links.";
      return;
    }
    list.replaceChildren(...data.tokens.map(row));
    if (!data.tokens.length) {
      const li = document.createElement("li");
      li.className = "t-meta";
      li.textContent = "No viewer links yet.";
      list.append(li);
    }
  }

  function row(t) {
    const li = document.createElement("li");
    const head = document.createElement("div");
    const label = document.createElement("span");
    label.className = "t-label";
    label.textContent = t.label || "Untitled";
    const state = document.createElement("span");
    state.className = `t-state t-state--${t.state}`;
    state.textContent = { ready: "unused", started: "started", consumed: "watched", locked: "waiting" }[t.state] || t.state;
    head.append(label, state);

    const meta = document.createElement("div");
    meta.className = "t-meta";
    meta.textContent = `${t.plays || 0} play${t.plays === 1 ? "" : "s"}` +
      (t.completedAt ? ` · finished ${new Date(t.completedAt).toLocaleString()}` : "");

    const actions = document.createElement("div");
    actions.className = "admin-row";
    actions.append(
      button("Copy link", async (b) => {
        const link = viewerLink(t.token);
        try { await navigator.clipboard.writeText(link); b.textContent = "Copied"; }
        catch { prompt("Viewer link:", link); }
      }),
      button("Reset", () => guard(() => api.reset(t.token))),
      button("Delete", () => { if (confirm(`Delete the link for "${t.label || "Untitled"}"? It will stop working.`)) guard(() => api.remove(t.token)); }),
    );
    li.append(head, meta, actions);
    return li;
  }

  function button(text, fn) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "a-btn a-btn--ghost"; b.textContent = text;
    b.addEventListener("click", () => fn(b));
    return b;
  }
}
