// SQLite persistence for cognix-games (data/data.db).
// Uses PRAGMA journal_mode = DELETE (never WAL) so COGNIX[WS] backup restores never meet stale sidecars.
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { computeRatingDeltas, verifyCommit } from "./lib/ratings.mjs";

let DatabaseSync = null;
export let sqliteMissing = "";
try {
  ({ DatabaseSync } = await import("node:sqlite"));
} catch {
  sqliteMissing = `Games Arena requires Node.js 22.13+ for SQLite storage; running ${process.version}.`;
}

const MIGRATIONS_DIR = fileURLToPath(new URL("./storage/migrations/", import.meta.url));
const conns = new Map();

export const dbPath = (dataDir) => join(dataDir, "data.db");

export function openDb(dataDir) {
  if (sqliteMissing) throw new Error(sqliteMissing);
  const p = dbPath(dataDir);
  let db = conns.get(p);
  if (db) return db;
  mkdirSync(dirname(p), { recursive: true });
  db = new DatabaseSync(p);
  db.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = DELETE; PRAGMA foreign_keys = ON;");
  applyMigrations(db);
  conns.set(p, db);
  return db;
}

export function closeAll() {
  for (const db of conns.values()) {
    try { db.close(); } catch { /* closed */ }
  }
  conns.clear();
}

function tx(db, fn) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const out = fn();
    db.exec("COMMIT");
    return out;
  } catch (err) {
    try { db.exec("ROLLBACK"); } catch { /* ignore */ }
    throw err;
  }
}

function applyMigrations(db) {
  db.exec("CREATE TABLE IF NOT EXISTS _picode_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)");
  const cur = db.prepare("SELECT COALESCE(MAX(version), 0) AS v FROM _picode_migrations").get().v;
  const files = readdirSync(MIGRATIONS_DIR)
    .map((f) => [Number(/^(\d+)_[\w-]+\.sql$/.exec(f)?.[1]), f])
    .filter(([v]) => v > cur)
    .sort((a, b) => a[0] - b[0]);
  for (const [v, f] of files) {
    tx(db, () => {
      db.exec(readFileSync(join(MIGRATIONS_DIR, f), "utf8"));
      db.prepare("INSERT INTO _picode_migrations (version, name, applied_at) VALUES (?, ?, ?)").run(v, f, new Date().toISOString());
    });
  }
}

// Decision table Row 8: restored or restarted active matches come back paused so
// stale turn deadlines never fire surprise messages to agents after a restore.
export function recoverMatchesOnBoot(dataDir, nowIso = new Date().toISOString()) {
  const db = openDb(dataDir);
  return tx(db, () => {
    const active = db.prepare("SELECT id, config_json FROM matches WHERE status = 'active'").all();
    let pausedCount = 0;
    for (const row of active) {
      const cfg = JSON.parse(row.config_json || "{}");
      cfg.pauseReason = "Paused after daemon restart or snapshot restore. Press Resume to continue.";
      cfg.turnDeadlineAt = null;
      db.prepare("UPDATE matches SET status = 'paused', config_json = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify(cfg), nowIso, row.id);
      pausedCount++;
    }
    return pausedCount;
  });
}

function hydrateMatch(row) {
  if (!row) return null;
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    game: row.game,
    title: row.title,
    status: row.status,
    config: JSON.parse(row.config_json),
    seats: JSON.parse(row.seats_json),
    narrator: row.narrator_json ? JSON.parse(row.narrator_json) : null,
    state: JSON.parse(row.state_json),
    winner: row.winner_json ? JSON.parse(row.winner_json) : null,
    seq: row.seq,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function insertMatch(dataDir, match) {
  const db = openDb(dataDir);
  return tx(db, () => {
    db.prepare(`
      INSERT INTO matches (id, workspace_id, game, title, status, config_json, seats_json, narrator_json, state_json, winner_json, seq, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      match.id,
      match.workspaceId,
      match.game,
      match.title,
      match.status,
      JSON.stringify(match.config),
      JSON.stringify(match.seats),
      match.narrator ? JSON.stringify(match.narrator) : null,
      JSON.stringify(match.state),
      match.winner ? JSON.stringify(match.winner) : null,
      match.seq || 0,
      match.createdAt,
      match.updatedAt
    );
    return getMatch(dataDir, match.id);
  });
}

export function getMatch(dataDir, id) {
  const db = openDb(dataDir);
  return hydrateMatch(db.prepare("SELECT * FROM matches WHERE id = ?").get(id));
}

export function listMatches(dataDir, workspaceId = "", status = "all") {
  const db = openDb(dataDir);
  const clauses = [];
  const params = [];
  if (workspaceId) { clauses.push("workspace_id = ?"); params.push(workspaceId); }
  if (status && status !== "all") { clauses.push("status = ?"); params.push(status); }
  const where = clauses.length ? "WHERE " + clauses.join(" AND ") : "";
  return db.prepare(`SELECT * FROM matches ${where} ORDER BY updated_at DESC LIMIT 100`).all(...params).map(hydrateMatch);
}

export function deleteMatch(dataDir, id) {
  const db = openDb(dataDir);
  return tx(db, () => {
    const existing = hydrateMatch(db.prepare("SELECT * FROM matches WHERE id = ?").get(id));
    if (!existing) return null;
    db.prepare("DELETE FROM matches WHERE id = ?").run(id);
    return existing;
  });
}

export function updateMatchWithEvent(dataDir, match, event = null, revealAllPrior = false) {
  const db = openDb(dataDir);
  return tx(db, () => {
    const nextSeq = (match.seq || 0) + (event ? 1 : 0);
    db.prepare(`
      UPDATE matches
         SET status = ?, config_json = ?, seats_json = ?, narrator_json = ?, state_json = ?, winner_json = ?, seq = ?, updated_at = ?
       WHERE id = ?
    `).run(
      match.status,
      JSON.stringify(match.config),
      JSON.stringify(match.seats),
      match.narrator ? JSON.stringify(match.narrator) : null,
      JSON.stringify(match.state),
      match.winner ? JSON.stringify(match.winner) : null,
      nextSeq,
      match.updatedAt,
      match.id
    );
    if (revealAllPrior) {
      db.prepare("UPDATE match_events SET revealed = 1 WHERE match_id = ?").run(match.id);
    }
    if (event) {
      db.prepare(`
        INSERT INTO match_events (match_id, seq, at, actor_id, kind, public_json, sealed_json, revealed)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        match.id,
        nextSeq,
        event.at || match.updatedAt,
        event.actorId || "system",
        event.kind,
        JSON.stringify(event.public || {}),
        event.sealed ? JSON.stringify(event.sealed) : null,
        event.revealed ? 1 : 0
      );
    }
    match.seq = nextSeq;
    return match;
  });
}

export function listMatchEvents(dataDir, matchId, { includeUnrevealed = false, callerActorId = "", limit = 80 } = {}) {
  const db = openDb(dataDir);
  const rows = db.prepare("SELECT * FROM match_events WHERE match_id = ? ORDER BY seq DESC LIMIT ?").all(matchId, limit).reverse();
  return rows.map((r) => {
    const pub = JSON.parse(r.public_json || "{}");
    const canReadSealed = Boolean(r.revealed) || includeUnrevealed || (callerActorId && r.actor_id === callerActorId);
    const sealed = canReadSealed && r.sealed_json ? JSON.parse(r.sealed_json) : null;
    return {
      seq: r.seq,
      at: r.at,
      actorId: r.actor_id,
      kind: r.kind,
      revealed: Boolean(r.revealed),
      public: pub,
      sealed
    };
  });
}

export function recordCompletedRatings(dataDir, match, placements, behaviorByActor = {}) {
  const db = openDb(dataDir);
  return tx(db, () => {
    const curMap = new Map();
    for (const s of match.seats) {
      const row = db.prepare("SELECT rating FROM ratings WHERE workspace_id = ? AND actor_id = ?").get(match.workspaceId, s.actorId);
      curMap.set(s.actorId, row ? row.rating : 1500);
    }
    const deltas = computeRatingDeltas(curMap, placements);
    const minRank = Math.min(...placements.map((p) => p.rank));
    const winnersCount = placements.filter((p) => p.rank === minRank).length;

    for (const s of match.seats) {
      const pl = placements.find((p) => p.actorId === s.actorId);
      if (!pl) continue;
      const existing = db.prepare("SELECT * FROM ratings WHERE workspace_id = ? AND actor_id = ?").get(match.workspaceId, s.actorId);
      const prevStats = existing ? JSON.parse(existing.stats_json || "{}") : { matches: 0, strikes: 0, bluffs: 0, actions: 0 };
      const add = behaviorByActor[s.actorId] || {};
      const nextStats = {
        matches: (prevStats.matches || 0) + 1,
        strikes: (prevStats.strikes || 0) + (add.strikes || 0),
        bluffs: (prevStats.bluffs || 0) + (add.bluffs || 0),
        actions: (prevStats.actions || 0) + (add.actions || 0)
      };
      const isDraw = winnersCount > 1 && pl.rank === minRank;
      const isWin = winnersCount === 1 && pl.rank === minRank;
      const newRating = Math.round(((existing ? existing.rating : 1500) + (deltas.get(s.actorId) || 0)) * 10) / 10;

      db.prepare(`
        INSERT INTO ratings (workspace_id, actor_id, actor_name, actor_kind, cli, rating, wins, draws, losses, stats_json, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id, actor_id) DO UPDATE SET
          actor_name = excluded.actor_name,
          actor_kind = excluded.actor_kind,
          cli = excluded.cli,
          rating = excluded.rating,
          wins = ratings.wins + excluded.wins,
          draws = ratings.draws + excluded.draws,
          losses = ratings.losses + excluded.losses,
          stats_json = excluded.stats_json,
          updated_at = excluded.updated_at
      `).run(
        match.workspaceId,
        s.actorId,
        s.name,
        s.kind,
        s.cli || "",
        newRating,
        isWin ? 1 : 0,
        isDraw ? 1 : 0,
        !isWin && !isDraw ? 1 : 0,
        JSON.stringify(nextStats),
        match.updatedAt
      );
    }
  });
}

export function listRatings(dataDir, workspaceId = "") {
  const db = openDb(dataDir);
  const rows = workspaceId
    ? db.prepare("SELECT * FROM ratings WHERE workspace_id = ? ORDER BY rating DESC, wins DESC").all(workspaceId)
    : db.prepare("SELECT * FROM ratings ORDER BY rating DESC, wins DESC LIMIT 50").all();
  return rows.map((r) => ({
    workspaceId: r.workspace_id,
    actorId: r.actor_id,
    name: r.actor_name,
    kind: r.actor_kind,
    cli: r.cli,
    rating: r.rating,
    wins: r.wins,
    draws: r.draws,
    losses: r.losses,
    stats: JSON.parse(r.stats_json || "{}"),
    updatedAt: r.updated_at
  }));
}

export function saveReplayRecord(dataDir, match) {
  const db = openDb(dataDir);
  const events = listMatchEvents(dataDir, match.id, { includeUnrevealed: match.status === "finished", limit: 500 });
  const seedCommit = match.state.seedCommit || "";
  const revealedSeed = match.status === "finished"
    ? (match.state.revealedSeed || match.state.seed || match.state.handSeed || match.state.roundSeed || "")
    : (match.state.lastShowdown?.handSeed || match.state.lastShowdown?.roundSeed || "");
  const replayCommit = match.status === "finished" && match.state.seed
    ? match.state.seedCommit
    : (match.state.lastShowdown?.seedCommit || seedCommit);

  const payload = {
    schema: "cognix-games/replay@1",
    id: "rpl-" + match.id,
    matchId: match.id,
    workspaceId: match.workspaceId,
    game: match.game,
    title: match.title,
    status: match.status,
    seats: match.seats,
    narrator: match.narrator,
    winner: match.winner,
    verification: {
      seedCommit: replayCommit,
      revealedSeed,
      verified: revealedSeed ? verifyCommit(revealedSeed, replayCommit) : false
    },
    finalState: match.status === "finished" ? match.state : (match.state.lastShowdown || null),
    events,
    savedAt: new Date().toISOString()
  };

  tx(db, () => {
    db.prepare(`
      INSERT INTO replays (id, match_id, workspace_id, game, title, summary, seed_commit, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        summary = excluded.summary,
        seed_commit = excluded.seed_commit,
        payload_json = excluded.payload_json,
        created_at = excluded.created_at
    `).run(
      payload.id,
      match.id,
      match.workspaceId,
      match.game,
      match.title,
      match.winner?.summary || `${match.game.toUpperCase()} · ${events.length} events`,
      replayCommit,
      JSON.stringify(payload),
      payload.savedAt
    );
  });

  return payload;
}

export function listReplays(dataDir, workspaceId = "") {
  const db = openDb(dataDir);
  const rows = workspaceId
    ? db.prepare("SELECT id, match_id, workspace_id, game, title, summary, seed_commit, created_at FROM replays WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 50").all(workspaceId)
    : db.prepare("SELECT id, match_id, workspace_id, game, title, summary, seed_commit, created_at FROM replays ORDER BY created_at DESC LIMIT 50").all();
  return rows.map((r) => ({
    id: r.id,
    matchId: r.match_id,
    workspaceId: r.workspace_id,
    game: r.game,
    title: r.title,
    summary: r.summary,
    seedCommit: r.seed_commit,
    createdAt: r.created_at
  }));
}

export function getReplay(dataDir, id) {
  const db = openDb(dataDir);
  const row = db.prepare("SELECT payload_json FROM replays WHERE id = ? OR match_id = ?").get(id, id);
  return row ? JSON.parse(row.payload_json) : null;
}

export function deleteReplay(dataDir, id) {
  const db = openDb(dataDir);
  return tx(db, () => {
    const info = db.prepare("DELETE FROM replays WHERE id = ? OR match_id = ?").run(id, id);
    return Number(info?.changes || 0) > 0;
  });
}

export function validateReplayPayload(rawText) {
  let data;
  try {
    data = typeof rawText === "string" ? JSON.parse(rawText) : rawText;
  } catch (err) {
    return { ok: false, error: `Replay file is not valid JSON: ${err.message}` };
  }
  if (!data || data.schema !== "cognix-games/replay@1") {
    return { ok: false, error: "Replay file must declare schema \"cognix-games/replay@1\"." };
  }
  if (!data.matchId || !data.game || !Array.isArray(data.seats) || data.seats.length < 2) {
    return { ok: false, error: "Replay file is missing matchId, game or seats." };
  }
  if (data.verification?.revealedSeed && data.verification?.seedCommit) {
    if (!verifyCommit(data.verification.revealedSeed, data.verification.seedCommit)) {
      return { ok: false, error: "Replay SHA-256 seed verification failed: revealedSeed does not match seedCommit." };
    }
  }
  return { ok: true };
}
