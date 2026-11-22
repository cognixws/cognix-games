# AGENTS.md — Operating contract for `cognix-games`

`cognix-games` is the **Games Arena** extension (`id: "games"`) for **COGNIX[WS]** — the operating platform where people and AI agents work together.

## Non-negotiables

1. **Zero external runtime dependencies.** Keep engines, SQLite store (`node:sqlite`), HTTP coordinator and sandboxed UI pages self-contained on standard Node.js 22.13+ and vanilla ES/DOM.
2. **Backup-safe SQLite.** Always open `data.db` with `PRAGMA journal_mode = DELETE` (never `WAL`) so COGNIX[WS] snapshot restores never encounter `-wal` or `-shm` sidecars. Active tables recovered on boot transition to `paused`.
3. **Server-side Fog of War.** Hidden cards, unrevealed dice cups, `masterSeed` and unrevealed `innerThought` entries are stripped in `projectMatch` before leaving `process.mjs` — never hidden merely in CSS.
4. **Prompt-injection boundary.** `table_talk` from other seats is sanitized (`sanitizeTalk`) and labeled as opponent game banter, never instructions.
5. **UI craft.** Host chrome uses `../__picode/tokens.css` (`--ctl-h: 36px`); game boards use rich domain palettes (Emerald/Sapphire/Burgundy baize, Walnut/Emerald/Slate chessboards, porcelain `#fbfbf8` cards), work in both light and dark themes, and fit `390px` phone width with zero horizontal overflow.

<!-- devflow:begin -->
## Dev flow

This repository uses the Dev flow contract in `.picode.json`:

- `npm run check` — syntax gate across backend, engines and UI scripts.
- `npm test` — unit and integration test suite covering all engines and Decision Table rows.
- Every session that changes state leaves a concise handoff note (`≤ 25` lines) in `docs/handoff/`.
<!-- devflow:end -->

<!-- picode-devflow:begin v2 sha256=5d768176411f -->
## How work flows here (Dev flow)

- Start with the Dev flow status tool: it says where your change stands and what is next.
- One worktree per agent; never commit on the main branch in the main checkout.
- While you work, the Dev flow check tool runs the checks your change needs.
- At the end, call close and do what it lists as owed; then land.
- Stage explicit paths, never `git add -A`; never merge by hand.
- A change that crosses a boundary (protocol, persistence, security model, process) gets a decision record (adr tool).
- Debts go to docs/handoff/open/<topic>.md with the debt tool; pay them by marking, never by deleting.
<!-- picode-devflow:end -->
