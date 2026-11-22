// Game Replay Viewer — Reads ext:games/replay artifact (replay.json) or ?id= from process.
(async () => {
  "use strict";

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const doors = window.picode || { use: async () => null };
  const themeDoor = await doors.use("theme");
  const artDoor = await doors.use("artifact");
  const procDoor = await doors.use("process");

  if (themeDoor?.current?.()) document.documentElement.setAttribute("data-theme", themeDoor.current());
  themeDoor?.onChange?.((t) => { if (t) document.documentElement.setAttribute("data-theme", t); });

  let replay = null;
  let idx = 0;
  let timer = null;

  function stopPlay() {
    if (timer) {
      clearInterval(timer);
      timer = null;
      document.getElementById("rp-play").textContent = "Play";
    }
  }

  async function loadReplay() {
    // 1. Artifact viewer mode (ext:games/replay)
    if (artDoor?.read) {
      document.getElementById("rp-back-link").hidden = true;
      const file = await artDoor.read("replay.json");
      const raw = file?.text || (file?.base64 ? atob(file.base64) : "");
      return JSON.parse(raw);
    }
    // 2. Process query mode (?id=rpl-...)
    const params = new URLSearchParams(window.location.search);
    const id = params.get("id");
    if (id && procDoor?.request) {
      const res = await procDoor.request(`/replay?id=${encodeURIComponent(id)}`, { method: "GET" });
      const data = JSON.parse(res.body || "{}");
      if (res.status >= 400) throw new Error(data.error || "Replay not found.");
      return data.replay;
    }
    throw new Error("No replay artifact or ?id= parameter provided.");
  }

  function render() {
    if (!replay) return;
    const evs = replay.events || [];
    idx = Math.max(0, Math.min(idx, Math.max(0, evs.length - 1)));
    const cur = evs[idx];

    document.getElementById("rp-title").textContent = replay.title || "Game Replay";
    document.getElementById("rp-sub").textContent = `${String(replay.game || "").toUpperCase()} · ${replay.seats?.map((s) => s.name).join(" × ") || ""}`;

    const badge = document.getElementById("rp-verify-badge");
    if (replay.verification?.verified) {
      badge.textContent = "SHA-256 Seed Verified";
    } else {
      badge.textContent = "Unverified Seed";
      badge.style.color = "var(--gm-danger)";
    }

    document.getElementById("rp-step-label").textContent = `Event ${evs.length ? idx + 1 : 0} / ${evs.length}`;
    document.getElementById("rp-first").disabled = idx <= 0;
    document.getElementById("rp-prev").disabled = idx <= 0;
    document.getElementById("rp-next").disabled = idx >= evs.length - 1;
    document.getElementById("rp-last").disabled = idx >= evs.length - 1;
    document.getElementById("rp-winner-tag").textContent = replay.winner?.summary || "";
    document.getElementById("rp-commit-text").textContent = `Commit: ${(replay.verification?.seedCommit || "").slice(0, 24)}…`;

    if (cur) {
      const who = cur.public?.seatName || cur.public?.speaker || cur.actorId;
      document.getElementById("rp-spot-who").textContent = `#${cur.seq} · ${who}`;
      document.getElementById("rp-spot-kind").textContent = cur.kind;
      document.getElementById("rp-spot-summary").textContent = cur.public?.summary || cur.public?.text || cur.public?.error || cur.public?.action || "";

      let extra = "";
      if (cur.public?.talk) extra += `<p class="gm-feed-talk">Public table talk: "${esc(cur.public.talk)}"</p>`;
      if (cur.sealed?.innerThought) extra += `<p class="gm-feed-thought">Revealed inner thought: "${esc(cur.sealed.innerThought)}"</p>`;
      document.getElementById("rp-spot-extra").innerHTML = extra;
    }

    const listEl = document.getElementById("rp-list");
    listEl.innerHTML = evs.map((e, i) => {
      const who = e.public?.seatName || e.public?.speaker || e.actorId;
      const body = e.public?.summary || e.public?.text || e.public?.action || "";
      const activeStyle = i === idx ? 'style="background:var(--gm-surface-2);padding:6px 8px;border-radius:6px"' : "";
      return `
        <div class="gm-feed-item" data-step="${i}" ${activeStyle}>
          <div class="gm-feed-top"><span><strong>${esc(who)}</strong></span><span>#${e.seq}</span></div>
          <div>${esc(body)}</div>
          ${e.sealed?.innerThought ? `<div class="gm-feed-thought">${esc(e.sealed.innerThought)}</div>` : ""}
        </div>`;
    }).join("");
    const activeRow = listEl.querySelector(`[data-step="${idx}"]`);
    activeRow?.scrollIntoView?.({ block: "nearest" });
  }

  document.getElementById("rp-first").addEventListener("click", () => { stopPlay(); idx = 0; render(); });
  document.getElementById("rp-prev").addEventListener("click", () => { stopPlay(); idx = Math.max(0, idx - 1); render(); });
  document.getElementById("rp-next").addEventListener("click", () => { stopPlay(); idx += 1; render(); });
  document.getElementById("rp-last").addEventListener("click", () => { stopPlay(); idx = 999999; render(); });
  document.getElementById("rp-play").addEventListener("click", () => {
    if (timer) {
      stopPlay();
      return;
    }
    document.getElementById("rp-play").textContent = "Pause";
    timer = setInterval(() => {
      if (!replay || idx >= (replay.events?.length || 1) - 1) {
        stopPlay();
        return;
      }
      idx += 1;
      render();
    }, 950);
  });

  document.getElementById("rp-list").addEventListener("click", (e) => {
    const row = e.target.closest("[data-step]");
    if (row) {
      stopPlay();
      idx = Number(row.dataset.step);
      render();
    }
  });

  try {
    replay = await loadReplay();
    document.getElementById("rp-main").hidden = false;
    render();
  } catch (err) {
    const el = document.getElementById("rp-err");
    el.hidden = false;
    document.getElementById("rp-err-text").textContent = err.message || "Could not load replay.";
  }
})();
