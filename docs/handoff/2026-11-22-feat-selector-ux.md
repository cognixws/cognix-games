# 2026-11-22 — `feat/selector-ux`

## Shipped
- Renamed built-in local bots to `Rule Bot Alpha` .. `Rule Bot Foxtrot` with explicit `Built-in · No LLM` runtime metadata (`process.mjs`, `ui/arena.html`, `ui/arena.js`, `README.md`, `v0.1.4`).
- Updated `fetchKnownActors` (`process.mjs`) to omit stopped agents and soft-deleted assistants (`running: false`), enrich live Assistants and running Workspace Agents with formatted CLI/model and workspace names, and disambiguate duplicate names (Row 11 in `docs/architecture.md` and `test/service.test.mjs`).
- Replaced all raw `<select>` controls in `ui/arena.html` and `ui/arena.js` with a searchable grouped Participant & Commentator popover (cmdk / Linear assignee-picker adaptation, keyboard-accessible and viewport-clamped), flat hairline Seat Rows with 1-click `Seat live AIs` and seat swapping, segmented `36px` Game / Turn clock / Surface selectors, and tactile Perudo face + quantity controls.

## Gates
- `npm run check && npm test`: PASS (16/16 tests).

uiux-review: PASS (cmdk/Linear grouped participant picker; stopped agents hidden; uniform 36px --ctl-h rows; 0 native selects; 0 slop hits)
visual-review: PASS (subagent read 8 shots: 03/13/14/15/16/17 dialog + popover in dark/light + empty + 390px sheet, 04 holdem dark, 07 perudo light; card 6/6)
prose-review: PASS (popover no-results + New match dialog + table states; card 6/6)
failure-review: api PASS (test/service.test.mjs)
