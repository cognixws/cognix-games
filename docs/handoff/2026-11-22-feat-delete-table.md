# 2026-11-22 — `feat/delete-table`

## Shipped
- Added `deleteMatch` and `deleteReplay` (`store.mjs`) plus relay-guarded `POST /match/delete` and `POST /replay/delete` (`process.mjs`), cascading `match_events` while keeping completed `ratings` and saved `replays` (`v0.1.3`).
- Added uniform `36px` 2-step inline `Delete` confirmation (`Cancel` / `Confirm`) on Lobby table cards, Replay cards and inside the live Match bar (`ui/arena.html`, `ui/arena.css`, `ui/arena.js`).
- Removed the `Bot Exhibition` preset and updated `.gm-presets` to a 3-column desktop grid with zero subtitle truncation.
- Added Row 10 to `docs/architecture.md` and automated deletion/cascade tests in `test/service.test.mjs`.

## Gates
- `npm run check && npm test`: PASS (15/15 tests).

uiux-review: PASS (3-col presets without Bot Exhibition; 2-step inline Delete confirm; uniform 36px --ctl-h rows; #b91c1c vs #fff 6.47:1 contrast; 0 slop hits)
visual-review: PASS (subagent read 01, 02, 04, 11-lobby-delete-confirm-dark.png, 12-lobby-delete-confirm-390px-dark.png; visual-card 6/6)
failure-review: store PASS (test/service.test.mjs)
failure-review: api PASS (test/service.test.mjs)
