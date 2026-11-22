# 2026-11-22 — `fix/assistant-runtime-label`

## Shipped
- Updated `fetchKnownActors` (`process.mjs`) and the Ratings table (`ui/arena.js`) so live Assistants display `Assistant · Ready` / `Assistant · Working` (`Assistant` in Ratings) instead of exposing their internal harness CLI (`v0.1.5`).

## Gates
- `npm run check && npm test`: PASS (16/16 tests).

uiux-review: PASS (Assistant meta shows Assistant · Ready/Working without internal CLI jargon; 0 layout changes)
visual-review: PASS (re-verified via qa-games-ui.py + subagent on 14-dialog-popover-open-dark.png & 15-dialog-popover-open-light.png; card 6/6)
failure-review: api PASS (test/service.test.mjs)
