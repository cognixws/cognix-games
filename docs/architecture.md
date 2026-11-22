# Architecture & Decision Table — `cognix-games`

## Overview

`cognix-games` runs a single Node.js background process (`process.mjs`) paired with a thin `picode-tools/1` executor (`execute.mjs`) and two sandboxed UI pages (`ui/arena.html`, `ui/replay.html`).

- **Person**: opens **Games** in a workspace tab or the **Game table** panel beside an agent, starts matches from presets or the `<dialog>` builder, plays turns directly or watches AI exhibitions in **Spectator** mode, and inspects verified `ext:games/replay` artifacts.
- **Agent / Assistant**: calls `arena` tools (`lobby`, `create`, `state`, `act`, `history`, `save_replay`). `execute.mjs` forwards the broker-authenticated `req.context.agent` identity over loopback (`127.0.0.1`) to `process.mjs` using an ephemeral 0600 key in `<dataDir>/process.json`.
- **System (`COGNIX[WS]` + `process.mjs`)**: enforces rules deterministically, strips hidden information per caller, sends surgical turn wake-ups (`POST /api/ext/v1/messages`) only to the active automated seat, publishes `ext.games.match` events for live UI refresh, enforces shot-clock fuse limits, and validates `replay.json` SHA-256 commitments via `/__picode/artifact/validate`.

## Persistence & Backup Compatibility

`store.mjs` uses `node:sqlite` (`DatabaseSync`) on `<dataDir>/data.db` with `PRAGMA journal_mode = DELETE; PRAGMA foreign_keys = ON;`. Avoiding WAL ensures zero `-wal`/`-shm` sidecars during COGNIX[WS] backup snapshots and restores. On startup, `recoverMatchesOnBoot` transitions any `active` table to `paused` and clears `turnDeadlineAt` so restored snapshots never fire unexpected wake-up messages.

## Decision Table

Every interacting condition across Fog of War, Spectator permissions, illegal moves, shot-clock timeouts, prompt-injection sanitation, boot recovery and replay verification is tested in `test/service.test.mjs`:

| # | Interacting Conditions | Outcome | Automated Test |
|---|---|---|---|
| 1 | Agent calls `arena.state` during an active Hold'em or Perudo round | Receives own hole cards / dice cup and own `innerThought`; opponent cards (`["?","?"]`), opponent dice (`0`), `masterSeed` and unrevealed opponent `innerThought` are stripped | `row 1: agent state enforces server-side Fog of War` |
| 2 | Page requests `GET /match?spectator=1` while a `human` seat holds live cards or dice | `spectatorAllowed` is `false`, `spectatorActive` stays `false`, opponent cards/dice remain masked | `row 2: spectator mode is refused while human holds live hand` |
| 3 | Page requests `GET /match?spectator=1` on an AI-only table or after match finishes | `spectatorAllowed` is `true`, `spectatorActive` is `true`, all hole cards, dice and `innerThought` notes are revealed | `row 3: spectator mode reveals cards and thoughts in AI-only or finished match` |
| 4 | Seat submits an illegal move on strike 1 or 2 (e.g. castling through an attacked square) | Referee rejects with `400`, increments strike (`1/3`, `2/3`), preserves board state and returns `legal_actions` + `attackedSquare` | `row 4: strikes 1 and 2 reject illegal move without mutating board` |
| 5 | Seat submits a 3rd illegal move in the same match / hand | Referee forfeits the hand (Hold'em/Perudo) or match (Chess), settling winner and ratings | `row 5: strike 3 triggers technical forfeit` |
| 6 | Automated seat exceeds `turnDeadlineAt` once vs twice consecutively | 1st timeout applies safe fallback (`check`/`fold`/`dudo`/clock-forfeit); 2nd consecutive timeout transitions match to `paused` and sends one `inbox:write` FYI | `row 6: shot-clock applies fallback on 1st timeout and pauses on 2nd` |
| 7 | Seat submits `table_talk` containing control characters, newlines or overlong prompt text | `sanitizeTalk` strips control chars, collapses whitespace, caps at 240 chars, and wraps agent `state` output with non-instruction framing | `row 7: sanitizeTalk strips control chars and frames opponent banter` |
| 8 | Daemon restarts or snapshot restores while a match is `active` | `recoverMatchesOnBoot` marks match `paused`, clears `turnDeadlineAt`, and keeps SQLite `journal_mode = delete` with zero `-wal`/`-shm` files | `row 8: boot recovery pauses active matches and keeps DELETE journal mode` |
| 9 | Publishing `ext:games/replay` (`/__picode/artifact/validate`) with valid vs tampered seed | Matching `SHA-256(revealedSeed) === seedCommit` returns `{ok: true}`; tampered seed or invalid schema returns `{ok: false, error}` | `row 9: replay validator verifies SHA-256 seed commitment and rejects tampering` |
