// Games Arena UI — Connects to COGNIX[WS] doors (theme, context, process, events)
// and updates Hold'em 3D cards, Staunton SVG chess pieces and Perudo cups in place.
(async () => {
  "use strict";

  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  const doors = window.picode || { use: async () => null };
  const themeDoor = await doors.use("theme");
  const ctxDoor = await doors.use("context");
  const procDoor = await doors.use("process");
  const eventsDoor = await doors.use("events");
  const artDoor = await doors.use("artifact");

  if (themeDoor?.current?.()) {
    document.documentElement.setAttribute("data-theme", themeDoor.current());
  }
  themeDoor?.onChange?.((t) => {
    if (t) document.documentElement.setAttribute("data-theme", t);
  });

  const S = {
    workspaceId: "",
    artifactMode: Boolean(artDoor?.read || ctxDoor?.current?.()?.source === "artifact"),
    view: "lobby", // "lobby" | "match" | "replay"
    lobbyTab: "tables", // "tables" | "ratings" | "replays"
    matchId: null,
    replay: null,
    replayIdx: 0,
    replayTimer: null,
    spectator: false,
    fourColor: true,
    feltTheme: "emerald",
    boardTheme: "walnut",
    lobby: { matches: [], ratings: [], replays: [], settings: {} },
    actors: [],
    match: null,
    selectedSq: null, // [r, c] in Chess
    promotion: "q",
    seatDraft: ["owner", "bot:alpha", "bot:bravo", "bot:charlie"],
    lastFoulSeq: 0,
    confirmDeleteId: null,
    confirmDeleteMatchBar: false
  };

  function syncContext(ctx) {
    if (ctx?.source === "artifact") S.artifactMode = true;
    const ws = ctx?.workspace?.id || ctx?.workspaceId || "";
    if (ws && ws !== S.workspaceId) {
      S.workspaceId = ws;
    }
  }
  syncContext(ctxDoor?.current?.());
  ctxDoor?.onChange?.((c) => {
    syncContext(c);
    void refresh();
  });

  async function api(path, body) {
    if (!procDoor) throw new Error("Games Arena process door is unavailable.");
    const res = await procDoor.request(path, body === undefined
      ? { method: "GET" }
      : { method: "POST", body: JSON.stringify(body), contentType: "application/json" });
    let data = {};
    try { data = JSON.parse(res.body || "{}"); } catch { data = { error: res.body || "Invalid response" }; }
    if (res.status >= 400) {
      const err = new Error(data.error || `Games service returned ${res.status}`);
      err.legalActions = data.legal_actions;
      throw err;
    }
    return data;
  }

  function showError(msg) {
    const bar = document.getElementById("gm-error-bar");
    const txt = document.getElementById("gm-error-text");
    if (!msg) {
      bar.hidden = true;
      txt.textContent = "";
      return;
    }
    txt.textContent = msg;
    bar.hidden = false;
  }

  // Staunton vector chess glyphs (clean crisp SVG paths)
  const PIECE_SVG = {
    P: '<path d="M22.5 9c-2.2 0-4 1.8-4 4 0 .9.3 1.7.8 2.4-2 1.1-3.3 3.2-3.3 5.6h13c0-2.4-1.3-4.5-3.3-5.6.5-.7.8-1.5.8-2.4 0-2.2-1.8-4-4-4zm-9.5 15c-1 2-1.5 4.5-1.5 7h22c0-2.5-.5-5-1.5-7H13zm-3 9v3h25v-3H10z"/>',
    R: '<path d="M11 9v5h3v-2h3v2h5v-2h3v2h3V9H11zm2 7 1.5 14h12L28 16H13zm-2 16v4h23v-4H11z"/>',
    N: '<path d="M25 9c-5 1-10 5-11 11-1 4 2 6 5 5 2-.5 3.5-2 4-3-.2 3-3 6-8 9v5h20c0-11-2-21-10-27z"/>',
    B: '<path d="M22.5 7.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM18 14c-3 3.5-3.5 9-.5 14h10c3-5 2.5-10.5-.5-14h-9zm-5 16v3h19v-3H13zm-2 5v3h23v-3H11z"/>',
    Q: '<path d="M9 11l3.5 15h20L36 11l-6.5 7-4-8-3 8-3-8-4 8L9 11zm4 18v3h19v-3H13zm-2 5v3h23v-3H11z"/>',
    K: '<path d="M21 6v3h-3v2.5h3V15c-5 1-8.5 5.5-7 12h17c1.5-6.5-2-11-7-12v-3.5h3V9h-3V6h-3zm-8 23v3h19v-3H13zm-2 5v3h23v-3H11z"/>'
  };

  function renderChessPieceSvg(ch) {
    const isWhite = ch === ch.toUpperCase();
    const g = PIECE_SVG[ch.toUpperCase()] || PIECE_SVG.P;
    const fill = isWhite ? "#fcfbf7" : "#1c2026";
    const stroke = isWhite ? "#1c2026" : "#e2e8f0";
    return `<svg viewBox="0 0 45 45" aria-hidden="true"><g fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round">${g}</g></svg>`;
  }

  // Vector 3x3 pip dice SVG; [1] is wild gold star/bullseye
  const PIP_MAP = {
    1: [[22, 22, true]],
    2: [[12, 12], [32, 32]],
    3: [[12, 12], [22, 22], [32, 32]],
    4: [[12, 12], [32, 12], [12, 32], [32, 32]],
    5: [[12, 12], [32, 12], [22, 22], [12, 32], [32, 32]],
    6: [[12, 11], [32, 11], [12, 22], [32, 22], [12, 33], [32, 33]]
  };

  function renderDieHtml(val, idx) {
    if (!val || val < 1 || val > 6) {
      return `<span class="gm-die is-hidden" style="animation-delay:${idx * 35}ms" aria-label="Hidden die">?</span>`;
    }
    const pips = PIP_MAP[val].map(([x, y, wild]) => wild
      ? `<circle cx="${x}" cy="${y}" r="6.5" fill="#d97706"/><circle cx="${x}" cy="${y}" r="2.6" fill="#fef3c7"/>`
      : `<circle cx="${x}" cy="${y}" r="4.1" fill="#141923"/>`
    ).join("");
    return `<span class="gm-die" style="animation-delay:${idx * 35}ms" aria-label="Die ${val}${val === 1 ? " wild" : ""}"><svg viewBox="0 0 44 44" aria-hidden="true">${pips}</svg></span>`;
  }

  const SUIT_CODE = { "♠": "s", "♥": "h", "♦": "d", "♣": "c", s: "s", h: "h", d: "d", c: "c" };
  const SUIT_GLYPH = { s: "♠", h: "♥", d: "♦", c: "♣" };

  function ensureCardSlot(container, index, cardStr, small = false) {
    let slot = container.children[index];
    if (!slot) {
      slot = document.createElement("div");
      slot.className = `gm-pcard-slot${small ? " is-sm" : ""}`;
      slot.innerHTML = `<div class="gm-pcard-inner"><div class="gm-pcard-back"></div><div class="gm-pcard-face"><span class="gm-pcard-rank"></span><span class="gm-pcard-suit"></span></div></div>`;
      container.appendChild(slot);
    }
    if (!cardStr) {
      slot.className = `gm-pcard-slot${small ? " is-sm" : ""} is-empty`;
      slot.querySelector(".gm-pcard-inner").hidden = true;
      return;
    }
    slot.querySelector(".gm-pcard-inner").hidden = false;
    if (cardStr === "?") {
      slot.className = `gm-pcard-slot${small ? " is-sm" : ""}`;
    } else {
      const rawSuit = cardStr.slice(-1);
      const suit = SUIT_CODE[rawSuit] || SUIT_CODE[rawSuit.toLowerCase()] || "s";
      const rank = cardStr.slice(0, -1).replace("T", "10");
      const face = slot.querySelector(".gm-pcard-face");
      face.dataset.suit = suit;
      face.querySelector(".gm-pcard-rank").textContent = rank;
      face.querySelector(".gm-pcard-suit").textContent = SUIT_GLYPH[suit] || rawSuit;
      // Trigger smooth 3D flip on next frame if newly revealed
      requestAnimationFrame(() => slot.classList.add("is-faceup"));
    }
  }

  /* ── Lobby Rendering ─────────────────────────────────────── */
  function renderLobby() {
    stopReplayTimer();
    document.getElementById("gm-view-lobby").hidden = false;
    document.getElementById("gm-view-match").hidden = true;
    document.getElementById("gm-view-replay").hidden = true;
    document.getElementById("gm-back-btn").hidden = true;
    document.getElementById("gm-lobby-tabs").hidden = false;
    document.getElementById("gm-open-new").hidden = false;
    document.getElementById("gm-artifact-badge").hidden = true;
    document.getElementById("gm-page-title").textContent = "Games Arena";
    document.getElementById("gm-page-sub").textContent = "People, Assistants and agent CLIs at the same table";

    for (const tab of ["tables", "ratings", "replays"]) {
      document.getElementById(`gm-panel-${tab}`).hidden = S.lobbyTab !== tab;
    }
    for (const btn of document.querySelectorAll("[data-lobby-tab]")) {
      btn.setAttribute("aria-selected", String(btn.dataset.lobbyTab === S.lobbyTab));
    }

    // 1. Tables list (with required primary empty state: title + 1 sentence + 1 action)
    const listEl = document.getElementById("gm-tables-list");
    const matches = S.lobby.matches || [];
    if (!matches.length) {
      listEl.innerHTML = `
        <div class="gm-empty-primary">
          <h2>No active tables yet</h2>
          <p>Seat yourself, an Assistant or any agent CLI at a Chess, Hold'em or Liar's Dice table.</p>
          <button type="button" class="gm-btn gm-btn-primary" data-open-new="1">New match</button>
        </div>`;
    } else {
      listEl.innerHTML = matches.map((m) => {
        const turnName = m.turnSeatIdx >= 0 ? m.seats[m.turnSeatIdx]?.name : null;
        const gameLabel = { holdem: "No-Limit Hold'em", chess: "Chess", chess960: "Chess960", perudo: "Liar's Dice" }[m.game] || m.game;
        const statusCls = m.status === "active" ? "is-active" : "";
        return `
          <article class="gm-card">
            <div class="gm-card-top">
              <div>
                <h3 class="gm-card-title">${esc(m.title)}</h3>
                <p class="gm-card-sub">${esc(gameLabel)}${turnName ? ` · Turn: ${esc(turnName)}` : (m.winner?.summary ? ` · ${esc(m.winner.summary)}` : "")}</p>
              </div>
              <span class="gm-badge ${statusCls}">${esc(m.status)}</span>
            </div>
            <div class="gm-seat-chips">
              ${m.seats.map((s) => `<span class="gm-seat-tag">${esc(s.name)}</span>`).join("")}
            </div>
            <div class="gm-card-foot">
              ${S.confirmDeleteId === m.id ? `
                <span class="gm-meta-text">Delete table?</span>
                <div class="gm-card-actions">
                  <button type="button" class="gm-btn" data-cancel-delete="1">Cancel</button>
                  <button type="button" class="gm-btn gm-btn-danger" data-confirm-delete="${esc(m.id)}">Confirm</button>
                </div>` : `
                <span class="gm-meta-text">Moves: ${m.seq}</span>
                <div class="gm-card-actions">
                  <button type="button" class="gm-btn gm-btn-ghost" data-ask-delete="${esc(m.id)}">Delete</button>
                  <button type="button" class="gm-btn gm-btn-primary" data-open-match="${esc(m.id)}">${m.status === "finished" ? "Review table" : "Open table"}</button>
                </div>`}
            </div>
          </article>`;
      }).join("");
    }

    // 2. Ratings table (secondary empty state: 1 line + 1 action)
    const ratWrap = document.getElementById("gm-ratings-wrap");
    const ratings = S.lobby.ratings || [];
    if (!ratings.length) {
      ratWrap.innerHTML = `
        <div class="gm-empty-secondary">
          <span>Bradley-Terry ratings appear as soon as the first match finishes.</span>
          <button type="button" class="gm-btn" data-open-new="1">Start a match</button>
        </div>`;
    } else {
      ratWrap.innerHTML = `
        <table class="gm-data-table">
          <thead>
            <tr><th>#</th><th>Player</th><th>Runtime</th><th>Rating</th><th>W / L / D</th><th>Fouls</th></tr>
          </thead>
          <tbody>
            ${ratings.map((r, i) => `
              <tr>
                <td>${i + 1}</td>
                <td><strong>${esc(r.name)}</strong> <span class="gm-meta-text">(${esc(r.kind)})</span></td>
                <td>${esc(r.cli || "person")}</td>
                <td><strong>${Math.round(r.rating)}</strong> <span class="gm-meta-text">(${r.stats?.matches || 0}g)</span></td>
                <td>${r.wins} / ${r.losses} / ${r.draws}</td>
                <td>${r.stats?.strikes || 0}</td>
              </tr>`).join("")}
          </tbody>
        </table>`;
    }

    // 3. Replays list
    const repWrap = document.getElementById("gm-replays-wrap");
    const replays = S.lobby.replays || [];
    if (!replays.length) {
      repWrap.innerHTML = `
        <div class="gm-empty-secondary">
          <span>Verified SHA-256 replays are stored automatically when matches complete.</span>
          <button type="button" class="gm-btn" data-open-new="1">Start a match</button>
        </div>`;
    } else {
      repWrap.innerHTML = `<div class="gm-table-grid">${replays.map((rp) => `
        <article class="gm-card">
          <div class="gm-card-top">
            <div>
              <h3 class="gm-card-title">${esc(rp.title)}</h3>
              <p class="gm-card-sub">${esc(rp.game)} · ${esc(rp.summary)}</p>
            </div>
            <span class="gm-seed-badge">SHA-256</span>
          </div>
          <div class="gm-card-foot">
            ${S.confirmDeleteId === rp.id ? `
              <span class="gm-meta-text">Delete replay?</span>
              <div class="gm-card-actions">
                <button type="button" class="gm-btn" data-cancel-delete="1">Cancel</button>
                <button type="button" class="gm-btn gm-btn-danger" data-confirm-del-replay="${esc(rp.id)}">Confirm</button>
              </div>` : `
              <span class="gm-meta-text">${esc(rp.id)}</span>
              <div class="gm-card-actions">
                <button type="button" class="gm-btn gm-btn-ghost" data-ask-delete="${esc(rp.id)}">Delete</button>
                <button type="button" class="gm-btn" data-open-replay="${esc(rp.id)}">Open replay</button>
              </div>`}
          </div>
        </article>`).join("")}</div>`;
    }
  }

  function stopReplayTimer() {
    if (S.replayTimer) {
      clearInterval(S.replayTimer);
      S.replayTimer = null;
      const playBtn = document.getElementById("rp-play");
      if (playBtn) playBtn.textContent = "Play";
    }
  }

  function renderReplay() {
    const rpl = S.replay;
    if (!rpl) return;

    document.getElementById("gm-view-lobby").hidden = true;
    document.getElementById("gm-view-match").hidden = true;
    document.getElementById("gm-view-replay").hidden = false;
    document.getElementById("gm-back-btn").hidden = S.artifactMode;
    document.getElementById("gm-lobby-tabs").hidden = true;
    document.getElementById("gm-open-new").hidden = S.artifactMode;

    const evs = rpl.events || [];
    S.replayIdx = Math.max(0, Math.min(S.replayIdx, Math.max(0, evs.length - 1)));
    const cur = evs[S.replayIdx];

    document.getElementById("gm-page-title").textContent = rpl.title || "Game Replay";
    document.getElementById("gm-page-sub").textContent = `${String(rpl.game || "").toUpperCase()} · ${rpl.seats?.map((s) => s.name).join(" × ") || ""}`;

    const verified = Boolean(rpl.verification?.verified);
    for (const id of ["rp-verify-badge", "gm-artifact-badge"]) {
      const b = document.getElementById(id);
      b.textContent = verified ? "SHA-256 Seed Verified" : "Unverified Seed";
      b.style.color = verified ? "var(--gm-ok)" : "var(--gm-danger)";
    }
    document.getElementById("gm-artifact-badge").hidden = !S.artifactMode;
    document.getElementById("rp-verify-badge").hidden = S.artifactMode;

    document.getElementById("rp-step-label").textContent = `Event ${evs.length ? S.replayIdx + 1 : 0} / ${evs.length}`;
    document.getElementById("rp-first").disabled = S.replayIdx <= 0;
    document.getElementById("rp-prev").disabled = S.replayIdx <= 0;
    document.getElementById("rp-next").disabled = S.replayIdx >= evs.length - 1;
    document.getElementById("rp-last").disabled = S.replayIdx >= evs.length - 1;
    document.getElementById("rp-winner-tag").textContent = rpl.winner?.summary || "";
    document.getElementById("rp-commit-text").textContent = `Commit: ${(rpl.verification?.seedCommit || "").slice(0, 24)}…`;

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
      const activeStyle = i === S.replayIdx ? 'style="background:var(--gm-surface-2);padding:6px 8px;border-radius:6px"' : "";
      return `
        <div class="gm-feed-item" data-rp-step="${i}" ${activeStyle}>
          <div class="gm-feed-top"><span><strong>${esc(who)}</strong></span><span>#${e.seq}</span></div>
          <div>${esc(body)}</div>
          ${e.sealed?.innerThought ? `<div class="gm-feed-thought">${esc(e.sealed.innerThought)}</div>` : ""}
        </div>`;
    }).join("");
    const activeRow = listEl.querySelector(`[data-rp-step="${S.replayIdx}"]`);
    activeRow?.scrollIntoView?.({ block: "nearest" });
  }

  /* ── Live Match Rendering (Persistent DOM for 60fps Motion) ── */
  const SEAT_POSITIONS = {
    2: ["bottom", "top"],
    3: ["bottom", "left-top", "right-top"],
    4: ["bottom", "left-top", "top", "right-top"],
    5: ["bottom", "left-bot", "left-top", "right-top", "right-bot"],
    6: ["bottom", "left-bot", "left-top", "top", "right-top", "right-bot"]
  };

  function shotClockRingSvg(match, isTurn) {
    if (!isTurn || !match.config?.turnDeadlineAt) return "";
    const total = (match.config.shotClockSec || 45) * 1000;
    const rem = Math.max(0, Date.parse(match.config.turnDeadlineAt) - Date.now());
    const pct = Math.max(0, Math.min(1, rem / total));
    const C = 56.5;
    const offset = (C * (1 - pct)).toFixed(1);
    return `<svg class="gm-ring" viewBox="0 0 24 24" aria-label="Turn clock"><circle class="gm-ring-track" cx="12" cy="12" r="9"/><circle class="gm-ring-bar" cx="12" cy="12" r="9" stroke-dasharray="${C}" stroke-dashoffset="${offset}"/></svg>`;
  }

  function renderMatch() {
    const m = S.match;
    if (!m) return;
    stopReplayTimer();

    document.getElementById("gm-view-lobby").hidden = true;
    document.getElementById("gm-view-match").hidden = false;
    document.getElementById("gm-view-replay").hidden = true;
    document.getElementById("gm-back-btn").hidden = false;
    document.getElementById("gm-lobby-tabs").hidden = true;
    document.getElementById("gm-open-new").hidden = false;
    document.getElementById("gm-artifact-badge").hidden = true;
    document.getElementById("gm-page-title").textContent = m.title;
    document.getElementById("gm-page-sub").textContent = `${m.game.toUpperCase()} · Match ${m.id}`;

    const badge = document.getElementById("gm-match-status-badge");
    badge.textContent = m.status;
    badge.className = `gm-badge${m.status === "active" ? " is-active" : ""}`;

    const turnSeat = m.turnSeatIdx >= 0 ? m.seats[m.turnSeatIdx] : null;
    document.getElementById("gm-match-turn-label").textContent = m.status === "finished"
      ? (m.winner?.summary || "Match finished")
      : (turnSeat ? `Turn: ${turnSeat.name}${turnSeat.kind === "human" ? " (Your move)" : ""}` : "");

    // Surface selector options
    const surfSel = document.getElementById("gm-surface-select");
    if (m.game === "holdem") {
      if (surfSel.dataset.mode !== "holdem") {
        surfSel.dataset.mode = "holdem";
        surfSel.innerHTML = `<option value="emerald">Emerald Baize</option><option value="sapphire">Sapphire Baize</option><option value="burgundy">Burgundy Baize</option>`;
      }
      surfSel.value = S.feltTheme;
      surfSel.hidden = false;
    } else if (m.game === "chess" || m.game === "chess960") {
      if (surfSel.dataset.mode !== "chess") {
        surfSel.dataset.mode = "chess";
        surfSel.innerHTML = `<option value="walnut">Walnut Board</option><option value="emerald">Tournament Green</option><option value="slate">Broadcast Slate</option>`;
      }
      surfSel.value = S.boardTheme;
      surfSel.hidden = false;
    } else {
      surfSel.hidden = true;
    }

    // 4-color deck button
    const fcBtn = document.getElementById("gm-fourcolor-btn");
    fcBtn.hidden = m.game !== "holdem";
    fcBtn.setAttribute("aria-pressed", String(S.fourColor));

    // Spectator / Fog-of-War button (Blocked state clearly explained when human is in live hand)
    const specBtn = document.getElementById("gm-spectator-btn");
    const specLbl = document.getElementById("gm-spectator-label");
    if (!m.spectatorAllowed) {
      specBtn.setAttribute("aria-disabled", "true");
      specBtn.setAttribute("aria-pressed", "false");
      specBtn.title = "Spectator mode is locked while you hold live cards or dice.";
      specLbl.textContent = "Fog of War locked";
    } else {
      specBtn.removeAttribute("aria-disabled");
      specBtn.setAttribute("aria-pressed", String(m.spectatorActive));
      specBtn.title = "Toggle 3D card reveal and sealed inner thoughts";
      specLbl.textContent = m.spectatorActive ? "Spectator: Open" : "Fog of War";
    }

    // Pause / Resume & Replay buttons
    const pauseBtn = document.getElementById("gm-pause-btn");
    pauseBtn.hidden = m.status === "finished";
    pauseBtn.textContent = m.status === "paused" ? "Resume" : "Pause";

    const pauseBanner = document.getElementById("gm-pause-banner");
    pauseBanner.hidden = m.status !== "paused";
    document.getElementById("gm-pause-reason").textContent = m.config?.pauseReason || "Match is paused.";

    document.getElementById("gm-save-replay-btn").hidden = m.status !== "finished";
    document.getElementById("gm-delete-match-btn").hidden = S.confirmDeleteMatchBar;
    document.getElementById("gm-delete-match-confirm").hidden = !S.confirmDeleteMatchBar;

    // Stage visibility
    document.getElementById("gm-stage-holdem").hidden = m.game !== "holdem";
    document.getElementById("gm-stage-chess").hidden = !(m.game === "chess" || m.game === "chess960");
    document.getElementById("gm-stage-perudo").hidden = m.game !== "perudo";

    if (m.game === "holdem") renderHoldemStage(m);
    else if (m.game === "chess" || m.game === "chess960") renderChessStage(m);
    else renderPerudoStage(m);

    renderActionDock(m);
    renderSideFeed(m);
  }

  function latestSeatTalk(events, actorId) {
    for (let i = events.length - 1; i >= 0; i--) {
      const e = events[i];
      if (e.actorId === actorId && (e.public?.talk || e.sealed?.innerThought)) return e;
    }
    return null;
  }

  function renderHoldemStage(m) {
    const stage = document.getElementById("gm-stage-holdem");
    stage.dataset.felt = S.feltTheme;
    stage.dataset.deck = S.fourColor ? "4color" : "2color";

    document.getElementById("gm-holdem-pot").textContent = `$${m.state.pot}`;
    document.getElementById("gm-holdem-street").textContent = `HAND #${m.state.hand}/${m.state.maxHands} · ${String(m.state.street).toUpperCase()}`;
    document.getElementById("gm-holdem-commit").textContent = `SHA-256 commit: ${(m.state.seedCommit || "").slice(0, 16)}…`;

    const boardEl = document.getElementById("gm-holdem-board");
    for (let i = 0; i < 5; i++) {
      ensureCardSlot(boardEl, i, m.state.board[i] || null, false);
    }

    const seatsEl = document.getElementById("gm-holdem-seats");
    const posList = SEAT_POSITIONS[Math.min(6, Math.max(2, m.seats.length))] || SEAT_POSITIONS[6];

    while (seatsEl.children.length > m.seats.length) seatsEl.lastElementChild.remove();

    m.seats.forEach((seat, idx) => {
      let node = seatsEl.children[idx];
      if (!node) {
        node = document.createElement("div");
        node.className = "gm-seat";
        node.innerHTML = `
          <div class="gm-seat-head">
            <div class="gm-seat-id"></div>
            <div class="gm-seat-clock"></div>
          </div>
          <div class="gm-seat-mid">
            <div class="gm-seat-stack">
              <span class="gm-stack-val"></span>
              <span class="gm-bet-val"></span>
            </div>
            <div class="gm-hole-pair"></div>
          </div>
          <div class="gm-seat-line" hidden></div>
          <div class="gm-seat-thought" hidden></div>`;
        seatsEl.appendChild(node);
      }
      node.dataset.pos = posList[idx] || "top";
      const isTurn = m.turnSeatIdx === idx && m.status === "active";
      node.className = `gm-seat${isTurn ? " is-turn" : ""}${m.state.folded[idx] ? " is-folded" : ""}`;

      const isDealer = m.state.dealerIdx === idx;
      node.querySelector(".gm-seat-id").innerHTML = `${isDealer ? '<span class="gm-dealer-btn" title="Dealer">D</span>' : ""}<span class="gm-seat-name">${esc(seat.name)}</span>`;
      node.querySelector(".gm-seat-clock").innerHTML = shotClockRingSvg(m, isTurn);
      node.querySelector(".gm-stack-val").textContent = `$${m.state.stacks[idx]}`;
      const bet = m.state.streetBet[idx] || 0;
      node.querySelector(".gm-bet-val").textContent = m.state.folded[idx] ? "Folded" : (m.state.allIn[idx] ? `All-in $${bet}` : (bet > 0 ? `Bet $${bet}` : "Ready"));

      const pair = node.querySelector(".gm-hole-pair");
      const cards = m.state.holeCards[idx] || [];
      ensureCardSlot(pair, 0, cards[0] || null, true);
      ensureCardSlot(pair, 1, cards[1] || null, true);

      const recent = latestSeatTalk(m.events || [], seat.actorId);
      const talkEl = node.querySelector(".gm-seat-line");
      if (recent?.public?.talk) {
        talkEl.hidden = false;
        talkEl.textContent = `"${recent.public.talk}"`;
      } else {
        talkEl.hidden = true;
      }

      const thEl = node.querySelector(".gm-seat-thought");
      if (recent?.sealed?.innerThought) {
        thEl.hidden = false;
        thEl.textContent = `Thought: ${recent.sealed.innerThought}`;
      } else {
        thEl.hidden = true;
      }
    });
  }

  function formatClockMs(ms) {
    const sec = Math.max(0, Math.ceil((ms || 0) / 1000));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }

  function renderChessStage(m) {
    const stage = document.getElementById("gm-stage-chess");
    stage.dataset.board = S.boardTheme;

    // Eval bar
    const cp = m.state.materialEval || 0;
    const pct = Math.max(8, Math.min(92, 50 + (cp / 12)));
    document.getElementById("gm-chess-eval-fill").style.height = `${pct}%`;
    document.getElementById("gm-chess-eval-text").textContent = (cp >= 0 ? "+" : "") + (cp / 100).toFixed(1);

    // Top (Black, seat 1) and Bottom (White, seat 0) strips
    const wSeat = m.seats[0];
    const bSeat = m.seats[1];
    const topEl = document.getElementById("gm-chess-top-player");
    const botEl = document.getElementById("gm-chess-bottom-player");
    topEl.className = `gm-player-strip${m.turnSeatIdx === 1 ? " is-turn" : ""}`;
    botEl.className = `gm-player-strip${m.turnSeatIdx === 0 ? " is-turn" : ""}`;
    topEl.innerHTML = `<span><strong>${esc(bSeat?.name || "Black")}</strong> <span class="gm-meta-text">(Black)</span></span><span class="gm-clock-pill">${formatClockMs(m.state.clocksMs?.[1])}</span>`;
    botEl.innerHTML = `<span><strong>${esc(wSeat?.name || "White")}</strong> <span class="gm-meta-text">(White)</span></span><span class="gm-clock-pill">${formatClockMs(m.state.clocksMs?.[0])}</span>`;

    // Foul shake detection
    const lastEv = (m.events || [])[m.events.length - 1];
    const frame = document.getElementById("gm-chess-frame");
    let foulSq = null;
    if (lastEv?.kind === "foul") {
      foulSq = lastEv.public?.attackedSquare || null;
      if (lastEv.seq > S.lastFoulSeq) {
        S.lastFoulSeq = lastEv.seq;
        frame.classList.remove("is-foul");
        void frame.offsetWidth;
        frame.classList.add("is-foul");
      }
    }

    // Build 64 squares once, then update classes
    const sqWrap = document.getElementById("gm-chess-squares");
    if (!sqWrap.children.length) {
      const files = "abcdefgh";
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          const sq = document.createElement("div");
          sq.dataset.r = String(r);
          sq.dataset.c = String(c);
          sq.dataset.alg = files[c] + (8 - r);
          let inner = "";
          if (c === 0) inner += `<span class="gm-coord-rank">${8 - r}</span>`;
          if (r === 7) inner += `<span class="gm-coord-file">${files[c]}</span>`;
          sq.innerHTML = inner;
          sqWrap.appendChild(sq);
        }
      }
    }

    const lastMv = m.state.moves?.[m.state.moves.length - 1];
    const fromAlg = lastMv?.from || "";
    const toAlg = lastMv?.to || "";
    const selAlg = S.selectedSq ? ("abcdefgh"[S.selectedSq[1]] + (8 - S.selectedSq[0])) : "";

    // Legal destination squares from selected square (match legalActions via SAN/piece or let server validate)
    const board = m.state.board;
    for (const sq of sqWrap.children) {
      const r = Number(sq.dataset.r);
      const c = Number(sq.dataset.c);
      const alg = sq.dataset.alg;
      let cls = `gm-sq ${(r + c) % 2 === 0 ? "is-light" : "is-dark"}`;
      if (alg === fromAlg || alg === toAlg) cls += " is-last";
      if (alg === selAlg) cls += " is-selected";
      if (foulSq && alg === foulSq) cls += " is-foul-sq";
      if (S.selectedSq && canHumanMoveSquare(m, S.selectedSq[0], S.selectedSq[1], r, c)) {
        cls += board[r][c] ? " is-capture" : " is-target";
      }
      sq.className = cls;
    }

    // Persistent SVG piece DOM reconciliation (matched by piece type + nearest previous square so moves glide!)
    const piecesLayer = document.getElementById("gm-chess-pieces");
    const existing = Array.from(piecesLayer.children);
    const used = new Set();
    const nextWanted = [];
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const ch = board[r][c];
        if (ch) nextWanted.push({ ch, r, c });
      }
    }

    // First pass: exact stationary matches
    const assigned = new Array(nextWanted.length).fill(null);
    nextWanted.forEach((w, idx) => {
      const exact = existing.find((el) => !used.has(el) && el.dataset.ch === w.ch && Number(el.dataset.r) === w.r && Number(el.dataset.c) === w.c);
      if (exact) {
        used.add(exact);
        assigned[idx] = exact;
      }
    });

    // Second pass: moved piece of same type (glides smoothly via CSS transform!)
    nextWanted.forEach((w, idx) => {
      if (assigned[idx]) return;
      const moved = existing.find((el) => !used.has(el) && el.dataset.ch === w.ch);
      if (moved) {
        used.add(moved);
        moved.dataset.r = String(w.r);
        moved.dataset.c = String(w.c);
        moved.style.setProperty("--row", String(w.r));
        moved.style.setProperty("--col", String(w.c));
        assigned[idx] = moved;
      } else {
        const created = document.createElement("div");
        created.className = "gm-piece";
        created.dataset.ch = w.ch;
        created.dataset.r = String(w.r);
        created.dataset.c = String(w.c);
        created.style.setProperty("--row", String(w.r));
        created.style.setProperty("--col", String(w.c));
        created.innerHTML = renderChessPieceSvg(w.ch);
        piecesLayer.appendChild(created);
        assigned[idx] = created;
      }
    });

    // Remove captured pieces
    for (const el of existing) {
      if (!used.has(el)) el.remove();
    }
  }

  // Client helper to highlight candidate squares when human clicks a piece
  function canHumanMoveSquare(m, fr, fc, tr, tc) {
    if (fr === tr && fc === tc) return false;
    const ch = m.state.board[fr]?.[fc];
    if (!ch) return false;
    const target = m.state.board[tr]?.[tc];
    if (target && (target === target.toUpperCase()) === (ch === ch.toUpperCase())) return false;
    const files = "abcdefgh";
    const toAlg = files[tc] + (8 - tr);
    const p = ch.toUpperCase();
    // Match against server-supplied legalActions SAN list
    return (m.legalActions || []).some((san) => {
      if (san === "O-O" && p === "K" && tr === fr && tc === 6) return true;
      if (san === "O-O-O" && p === "K" && tr === fr && tc === 2) return true;
      const clean = san.replace(/[+#]/g, "");
      if (p === "P") {
        if (!clean.includes("=") && clean === toAlg) return fc === tc;
        if (clean.startsWith(files[fc] + "x" + toAlg)) return true;
        if (clean.startsWith(toAlg + "=")) return fc === tc;
        return false;
      }
      return clean.startsWith(p) && clean.includes(toAlg);
    });
  }

  function renderPerudoStage(m) {
    const banner = document.getElementById("gm-perudo-banner");
    const cb = m.state.currentBid;
    const sd = m.state.lastShowdown;
    banner.innerHTML = `
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <span class="gm-dice-pill is-info">Round #${m.state.round}</span>
        <span class="gm-dice-pill is-wild">Ones [1] are Wild</span>
        <span class="gm-dice-pill is-bid">${cb ? `Current bid: ${cb.qty} × [${cb.face}]` : "Opening bid"}</span>
      </div>
      ${sd ? `<span class="gm-dice-pill">Last Dudo: bid ${sd.bid.qty}×[${sd.bid.face}], found ${sd.actual}</span>` : ""}`;

    const seatsEl = document.getElementById("gm-perudo-seats");
    seatsEl.innerHTML = m.seats.map((seat, idx) => {
      const isTurn = m.turnSeatIdx === idx && m.status === "active";
      const cup = m.state.cups[idx] || [];
      const recent = latestSeatTalk(m.events || [], seat.actorId);
      return `
        <div class="gm-dice-seat${isTurn ? " is-turn" : ""}">
          <div class="gm-seat-head">
            <strong>${esc(seat.name)}</strong>
            <span class="gm-dice-pill">${m.state.diceCounts[idx]} dice</span>
          </div>
          <div class="gm-cup-row">
            ${cup.length ? cup.map((d, di) => renderDieHtml(d, di)).join("") : '<span class="gm-meta-text">Eliminated</span>'}
          </div>
          ${recent?.public?.talk ? `<div class="gm-seat-line">"${esc(recent.public.talk)}"</div>` : ""}
          ${recent?.sealed?.innerThought ? `<div class="gm-seat-thought">Thought: ${esc(recent.sealed.innerThought)}</div>` : ""}
        </div>`;
    }).join("");
  }

  function renderActionDock(m) {
    const dock = document.getElementById("gm-action-form");
    const ctrls = document.getElementById("gm-action-controls");
    const talkRow = document.getElementById("gm-talk-row");

    const isHumanTurn = m.status === "active" && m.turnSeatIdx >= 0 && m.seats[m.turnSeatIdx]?.kind === "human";
    if (!isHumanTurn) {
      talkRow.hidden = true;
      if (m.status === "finished") {
        ctrls.innerHTML = `<span class="gm-meta-text">${esc(m.winner?.summary || "Match complete.")}</span>`;
      } else if (m.status === "paused") {
        ctrls.innerHTML = `<span class="gm-meta-text">Match is paused. Resume above to continue play.</span>`;
      } else {
        const who = m.turnSeatIdx >= 0 ? m.seats[m.turnSeatIdx]?.name : "Player";
        ctrls.innerHTML = `<span class="gm-meta-text">Waiting for <strong>${esc(who)}</strong> to act…</span>`;
      }
      return;
    }

    talkRow.hidden = false;
    const legal = m.legalActions || [];

    if (m.game === "holdem") {
      ctrls.innerHTML = legal.map((act) => {
        const cls = act === "fold" ? "gm-btn" : (act === "allin" ? "gm-btn gm-btn-danger" : "gm-btn gm-btn-primary");
        const label = act === "allin" ? "All-in" : act.charAt(0).toUpperCase() + act.slice(1);
        return `<button type="button" class="${cls}" data-submit-act="${esc(act)}">${esc(label)}</button>`;
      }).join("");
    } else if (m.game === "chess" || m.game === "chess960") {
      const preferred = ["O-O", "O-O-O", "e4", "d4", "Nf3", "c4", "Nc3", "Bc4", "Bb5", "e5", "c5", "Nf6"];
      const quickList = [
        ...preferred.filter((p) => legal.includes(p)),
        ...legal.filter((p) => !preferred.includes(p))
      ].slice(0, 8);
      const quick = quickList.map((san) =>
        `<button type="button" class="gm-btn" data-submit-act="${esc(san)}">${esc(san)}</button>`
      ).join("");
      ctrls.innerHTML = `
        <span class="gm-meta-text">Click a piece on the board or choose SAN:</span>
        <select class="gm-select" id="gm-chess-san-select" aria-label="Legal chess move">
          ${legal.map((san) => `<option value="${esc(san)}">${esc(san)}</option>`).join("")}
        </select>
        <button type="button" class="gm-btn gm-btn-primary" id="gm-chess-play-san">Play move</button>
        ${quick}`;
    } else if (m.game === "perudo") {
      const bids = legal.filter((a) => a.startsWith("bid "));
      const hasDudo = legal.includes("dudo");
      ctrls.innerHTML = `
        <select class="gm-select" id="gm-perudo-bid-select" aria-label="Choose bid">
          ${bids.map((b) => `<option value="${esc(b)}">${esc(b.replace("bid ", "Bid ").replace("x", " × face "))}</option>`).join("")}
        </select>
        <button type="button" class="gm-btn gm-btn-primary" id="gm-perudo-play-bid" ${bids.length ? "" : "disabled"}>Place bid</button>
        ${hasDudo ? `<button type="button" class="gm-btn gm-btn-danger" data-submit-act="dudo">Call Dudo!</button>` : ""}`;
    }
  }

  function renderSideFeed(m) {
    const pgnBox = document.getElementById("gm-pgn-box");
    const moves = m.state.moves || [];
    if ((m.game === "chess" || m.game === "chess960") && moves.length) {
      pgnBox.hidden = false;
      const rows = [];
      for (let i = 0; i < moves.length; i += 2) {
        rows.push(`<span class="gm-pgn-num">${Math.floor(i / 2) + 1}.</span><span>${esc(moves[i]?.san || "")}</span><span>${esc(moves[i + 1]?.san || "")}</span>`);
      }
      pgnBox.innerHTML = rows.join("");
    } else {
      pgnBox.hidden = true;
    }

    const feedEl = document.getElementById("gm-feed-list");
    const evs = [...(m.events || [])].reverse();
    if (!evs.length) {
      feedEl.innerHTML = `<span class="gm-meta-text">Moves, commentary and showdown reveals appear here.</span>`;
      return;
    }
    feedEl.innerHTML = evs.map((e) => {
      const who = e.public?.seatName || e.public?.speaker || e.actorId;
      const body = e.public?.summary || e.public?.text || e.public?.error || e.public?.action || "";
      const cls = e.kind === "foul" ? "gm-feed-foul" : "";
      return `
        <div class="gm-feed-item">
          <div class="gm-feed-top"><span><strong>${esc(who)}</strong></span><span>#${e.seq}</span></div>
          <div class="${cls}">${esc(body)}</div>
          ${e.public?.talk ? `<div class="gm-feed-talk">"${esc(e.public.talk)}"</div>` : ""}
          ${e.sealed?.innerThought ? `<div class="gm-feed-thought">Inner thought: ${esc(e.sealed.innerThought)}</div>` : ""}
        </div>`;
    }).join("");
  }

  /* ── Actions & Polling ───────────────────────────────────── */
  async function refresh() {
    try {
      if (S.artifactMode) {
        if (!S.replay && artDoor?.read) {
          const file = await artDoor.read("replay.json");
          const raw = file?.text || (file?.base64 ? atob(file.base64) : "");
          S.replay = JSON.parse(raw);
          S.replayIdx = 0;
          S.view = "replay";
        }
        showError("");
        renderReplay();
        return;
      }
      if (S.view === "replay" && S.replay) {
        showError("");
        renderReplay();
        return;
      }
      const q = S.workspaceId ? `?workspace=${encodeURIComponent(S.workspaceId)}` : "";
      if (S.view === "match" && S.matchId) {
        const res = await api(`/match?id=${encodeURIComponent(S.matchId)}&spectator=${S.spectator ? "1" : "0"}`);
        S.match = res.match;
        showError("");
        renderMatch();
      } else {
        const res = await api(`/lobby${q}`);
        S.lobby = res;
        showError("");
        renderLobby();
      }
    } catch (err) {
      showError(err.message);
    }
  }

  async function openReplayById(id) {
    try {
      const res = await api(`/replay?id=${encodeURIComponent(id)}`);
      S.replay = res.replay;
      S.replayIdx = 0;
      S.view = "replay";
      showError("");
      renderReplay();
    } catch (err) {
      showError(err.message);
    }
  }

  async function openMatch(id) {
    S.matchId = id;
    S.view = "match";
    S.selectedSq = null;
    S.confirmDeleteId = null;
    S.confirmDeleteMatchBar = false;
    await refresh();
  }

  async function removeMatchById(id) {
    try {
      await api("/match/delete", { matchId: id });
      S.confirmDeleteId = null;
      S.confirmDeleteMatchBar = false;
      if (S.matchId === id) {
        S.matchId = null;
        S.match = null;
        S.view = "lobby";
      }
      await refresh();
    } catch (err) {
      showError(err.message);
    }
  }

  async function removeReplayById(id) {
    try {
      await api("/replay/delete", { replayId: id });
      S.confirmDeleteId = null;
      await refresh();
    } catch (err) {
      showError(err.message);
    }
  }

  async function sendHumanAction(actionStr) {
    if (!S.matchId) return;
    const talkInput = document.getElementById("gm-talk-input");
    const errEl = document.getElementById("gm-action-err");
    errEl.textContent = "";
    try {
      const res = await api("/match/act", {
        matchId: S.matchId,
        action: actionStr,
        table_talk: talkInput.value.trim(),
        spectator: S.spectator
      });
      talkInput.value = "";
      S.selectedSq = null;
      S.match = res.match;
      renderMatch();
    } catch (err) {
      errEl.textContent = err.message;
    }
  }

  async function startPreset(kind) {
    try {
      let payload;
      if (kind === "holdem") {
        payload = { workspaceId: S.workspaceId || "default", game: "holdem", title: "Hold'em 4-Max", seats: ["owner", "bot:alpha", "bot:bravo", "bot:charlie"], narrator: "bot:alpha" };
      } else if (kind === "chess") {
        payload = { workspaceId: S.workspaceId || "default", game: "chess", title: "Chess · You vs Sparring Bot", seats: ["owner", "bot:alpha"] };
      } else {
        payload = { workspaceId: S.workspaceId || "default", game: "perudo", title: "Liar's Dice Trio", seats: ["owner", "bot:alpha", "bot:bravo"] };
      }
      const res = await api("/match", payload);
      S.match = res.match;
      S.matchId = res.match.id;
      S.view = "match";
      renderMatch();
    } catch (err) {
      showError(err.message);
    }
  }

  /* ── New Match Dialog ────────────────────────────────────── */
  const dlg = document.getElementById("gm-new-dialog");

  async function openNewDialog() {
    try {
      const q = S.workspaceId ? `?workspace=${encodeURIComponent(S.workspaceId)}` : "";
      const res = await api(`/actors${q}`);
      S.actors = res.actors || [];
      if (res.settings?.shot_clock_sec) {
        document.getElementById("gm-f-clock").value = String(res.settings.shot_clock_sec);
      }
    } catch {
      S.actors = [
        { id: "owner", name: "You (Person)", kind: "human" },
        { id: "bot:alpha", name: "Sparring Bot Alpha", kind: "bot" },
        { id: "bot:bravo", name: "Sparring Bot Bravo", kind: "bot" }
      ];
    }
    syncDialogSeats();
    document.getElementById("gm-dlg-err").textContent = "";
    dlg.showModal();
  }

  function syncDialogSeats() {
    const game = document.getElementById("gm-f-game").value;
    const isChess = game === "chess" || game === "chess960";
    if (isChess) S.seatDraft = S.seatDraft.slice(0, 2);
    while (S.seatDraft.length < 2) S.seatDraft.push("bot:alpha");

    document.getElementById("gm-seat-count-btns").hidden = isChess;

    const optsHtml = (selected) => S.actors.map((a) =>
      `<option value="${esc(a.id)}" ${a.id === selected ? "selected" : ""}>${esc(a.name)} (${esc(a.kind)})</option>`
    ).join("");

    document.getElementById("gm-seat-pickers").innerHTML = S.seatDraft.map((val, idx) => `
      <label class="gm-field">
        <span>${isChess ? (idx === 0 ? "White (Seat 1)" : "Black (Seat 2)") : `Seat ${idx + 1}`}</span>
        <select class="gm-select" data-seat-idx="${idx}">${optsHtml(val)}</select>
      </label>`).join("");

    const narSel = document.getElementById("gm-f-narrator");
    narSel.innerHTML = `<option value="">None</option>` + S.actors.filter((a) => a.kind !== "human").map((a) =>
      `<option value="${esc(a.id)}">${esc(a.name)}</option>`
    ).join("");
  }

  /* ── Event Listeners ─────────────────────────────────────── */
  document.getElementById("gm-open-new").addEventListener("click", openNewDialog);
  document.getElementById("gm-dlg-close").addEventListener("click", () => dlg.close());
  document.getElementById("gm-dlg-cancel").addEventListener("click", () => dlg.close());
  document.getElementById("gm-f-game").addEventListener("change", syncDialogSeats);

  document.getElementById("gm-add-seat").addEventListener("click", () => {
    if (S.seatDraft.length < 6) {
      S.seatDraft.push(`bot:${S.seatDraft.length + 1}`);
      syncDialogSeats();
    }
  });
  document.getElementById("gm-rem-seat").addEventListener("click", () => {
    if (S.seatDraft.length > 2) {
      S.seatDraft.pop();
      syncDialogSeats();
    }
  });

  document.getElementById("gm-seat-pickers").addEventListener("change", (e) => {
    const idx = Number(e.target.dataset.seatIdx);
    if (!Number.isNaN(idx)) S.seatDraft[idx] = e.target.value;
  });

  document.getElementById("gm-new-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = document.getElementById("gm-dlg-err");
    errEl.textContent = "";
    const clock = Number(document.getElementById("gm-f-clock").value || 45);
    if (clock < 10 || clock > 600) {
      errEl.textContent = "Turn clock must be between 10 and 600 seconds.";
      return;
    }
    try {
      const game = document.getElementById("gm-f-game").value;
      const title = document.getElementById("gm-f-title").value.trim();
      const narrator = document.getElementById("gm-f-narrator").value;
      const allBots = S.seatDraft.every((id) => id !== "owner");
      if (allBots) S.spectator = true;
      const res = await api("/match", {
        workspaceId: S.workspaceId || "default",
        game,
        title,
        seats: S.seatDraft,
        narrator: narrator || undefined,
        shotClockSec: clock,
        spectator: S.spectator
      });
      dlg.close();
      S.match = res.match;
      S.matchId = res.match.id;
      S.view = "match";
      renderMatch();
    } catch (err) {
      errEl.textContent = err.message;
    }
  });

  document.getElementById("gm-back-btn").addEventListener("click", () => {
    stopReplayTimer();
    S.view = "lobby";
    S.matchId = null;
    S.replay = null;
    void refresh();
  });

  document.getElementById("gm-error-retry").addEventListener("click", () => void refresh());

  document.getElementById("gm-surface-select").addEventListener("change", (e) => {
    if (S.match?.game === "holdem") S.feltTheme = e.target.value;
    else S.boardTheme = e.target.value;
    renderMatch();
  });

  document.getElementById("gm-fourcolor-btn").addEventListener("click", () => {
    S.fourColor = !S.fourColor;
    renderMatch();
  });

  document.getElementById("gm-spectator-btn").addEventListener("click", () => {
    if (!S.match?.spectatorAllowed) return;
    S.spectator = !S.spectator;
    void refresh();
  });

  document.getElementById("gm-pause-btn").addEventListener("click", () => {
    const act = S.match?.status === "paused" ? "__resume" : "__pause";
    void sendHumanAction(act);
  });

  document.getElementById("gm-resume-btn").addEventListener("click", () => void sendHumanAction("__resume"));

  document.getElementById("gm-delete-match-btn").addEventListener("click", () => {
    S.confirmDeleteMatchBar = true;
    renderMatch();
  });
  document.getElementById("gm-delete-match-cancel").addEventListener("click", () => {
    S.confirmDeleteMatchBar = false;
    renderMatch();
  });
  document.getElementById("gm-delete-match-yes").addEventListener("click", () => {
    if (S.matchId) void removeMatchById(S.matchId);
  });

  document.getElementById("gm-save-replay-btn").addEventListener("click", async () => {
    if (!S.matchId) return;
    try {
      const res = await api("/match/replay", { matchId: S.matchId });
      S.replay = res.replay;
      S.replayIdx = 0;
      S.view = "replay";
      renderReplay();
    } catch (err) {
      showError(err.message);
    }
  });

  document.getElementById("rp-first").addEventListener("click", () => { stopReplayTimer(); S.replayIdx = 0; renderReplay(); });
  document.getElementById("rp-prev").addEventListener("click", () => { stopReplayTimer(); S.replayIdx = Math.max(0, S.replayIdx - 1); renderReplay(); });
  document.getElementById("rp-next").addEventListener("click", () => { stopReplayTimer(); S.replayIdx += 1; renderReplay(); });
  document.getElementById("rp-last").addEventListener("click", () => { stopReplayTimer(); S.replayIdx = 999999; renderReplay(); });
  document.getElementById("rp-play").addEventListener("click", () => {
    if (S.replayTimer) {
      stopReplayTimer();
      return;
    }
    document.getElementById("rp-play").textContent = "Pause";
    S.replayTimer = setInterval(() => {
      if (!S.replay || S.replayIdx >= (S.replay.events?.length || 1) - 1) {
        stopReplayTimer();
        return;
      }
      S.replayIdx += 1;
      renderReplay();
    }, 950);
  });

  // Delegated clicks
  document.addEventListener("click", (e) => {
    const rpStep = e.target.closest("[data-rp-step]");
    if (rpStep) {
      stopReplayTimer();
      S.replayIdx = Number(rpStep.dataset.rpStep);
      renderReplay();
      return;
    }
    const openRpl = e.target.closest("[data-open-replay]");
    if (openRpl) {
      void openReplayById(openRpl.dataset.openReplay);
      return;
    }
    const askDel = e.target.closest("[data-ask-delete]");
    if (askDel) {
      S.confirmDeleteId = askDel.dataset.askDelete;
      renderLobby();
      return;
    }
    if (e.target.closest("[data-cancel-delete]")) {
      S.confirmDeleteId = null;
      renderLobby();
      return;
    }
    const confDel = e.target.closest("[data-confirm-delete]");
    if (confDel) {
      void removeMatchById(confDel.dataset.confirmDelete);
      return;
    }
    const confDelRpl = e.target.closest("[data-confirm-del-replay]");
    if (confDelRpl) {
      void removeReplayById(confDelRpl.dataset.confirmDelReplay);
      return;
    }
    const tabBtn = e.target.closest("[data-lobby-tab]");
    if (tabBtn) {
      S.lobbyTab = tabBtn.dataset.lobbyTab;
      renderLobby();
      return;
    }
    if (e.target.closest("[data-open-new]")) {
      void openNewDialog();
      return;
    }
    const openBtn = e.target.closest("[data-open-match]");
    if (openBtn) {
      void openMatch(openBtn.dataset.openMatch);
      return;
    }
    const presetBtn = e.target.closest("[data-preset]");
    if (presetBtn) {
      void startPreset(presetBtn.dataset.preset);
      return;
    }
    const actBtn = e.target.closest("[data-submit-act]");
    if (actBtn) {
      void sendHumanAction(actBtn.dataset.submitAct);
      return;
    }
    if (e.target.closest("#gm-chess-play-san")) {
      const sel = document.getElementById("gm-chess-san-select");
      if (sel?.value) void sendHumanAction(sel.value);
      return;
    }
    if (e.target.closest("#gm-perudo-play-bid")) {
      const sel = document.getElementById("gm-perudo-bid-select");
      if (sel?.value) void sendHumanAction(sel.value);
      return;
    }
    const sq = e.target.closest(".gm-sq");
    if (sq && S.match && (S.match.game === "chess" || S.match.game === "chess960")) {
      const isHumanTurn = S.match.status === "active" && S.match.turnSeatIdx >= 0 && S.match.seats[S.match.turnSeatIdx]?.kind === "human";
      if (!isHumanTurn) return;
      const r = Number(sq.dataset.r);
      const c = Number(sq.dataset.c);
      const ch = S.match.state.board[r]?.[c];
      const wantWhite = S.match.state.turn === "w";
      const isOwn = ch && (ch === ch.toUpperCase()) === wantWhite;

      if (S.selectedSq && (S.selectedSq[0] !== r || S.selectedSq[1] !== c) && !isOwn) {
        const files = "abcdefgh";
        const fromAlg = files[S.selectedSq[1]] + (8 - S.selectedSq[0]);
        const toAlg = files[c] + (8 - r);
        const movingPiece = S.match.state.board[S.selectedSq[0]]?.[S.selectedSq[1]];
        const isPromo = movingPiece?.toUpperCase() === "P" && (r === 0 || r === 7);
        void sendHumanAction(fromAlg + toAlg + (isPromo ? "q" : ""));
      } else if (isOwn) {
        S.selectedSq = [r, c];
        renderChessStage(S.match);
      } else {
        S.selectedSq = null;
        renderChessStage(S.match);
      }
    }
  });

  // Live reactive updates from COGNIX[WS] events door + light fallback poll
  eventsDoor?.onChange?.(() => void refresh());
  setInterval(() => {
    if (!document.hidden) void refresh();
  }, 3500);

  await refresh();
})();
