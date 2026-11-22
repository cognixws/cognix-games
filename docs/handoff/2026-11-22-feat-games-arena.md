# 2026-11-22 — `feat/games-arena`

## Shipped
- Created `cognix-games` (`id: "games"`, `v0.1.0`, `apiVersion: 12`) with Chess, Chess960, No-Limit Hold'em and Liar's Dice (`lib/*.mjs`) plus Bradley-Terry ratings and HMAC-SHA256 commit-reveal fairness.
- Implemented single-writer SQLite coordinator (`store.mjs`, `process.mjs`) and `picode-tools/1` executor (`execute.mjs`) with server-side Fog of War, surgical turn wake-ups, shot-clock auto-pause and `/__picode/artifact/validate` replay verification.
- Built `ui/arena.html` and `ui/replay.html` using `--pc-*` host chrome tokens alongside emerald/sapphire/burgundy baize, 4-color porcelain 3D cards, Staunton SVG chessboards and vector pip dice.
- Documented the 9-row Decision Table in `docs/architecture.md` with 15 passing tests in `test/engines.test.mjs` and `test/service.test.mjs`.

## Gates
- `npm run check && npm test`: PASS (15/15 tests).

uiux-review: PASS (empty state: title + 1 sentence + New match; uniform 36px --ctl-h rows; --pc-* tokens; targeted reduced-motion; 0 slop/x.com hits)
visual-review: PASS (subagent read 9 shots 01-09 across 1280px & 390px x light/dark + dialog + replay; all contrasts >= 4.8:1; 0 overflow/clips)
failure-review: engines PASS (test/engines.test.mjs)
failure-review: store PASS (test/service.test.mjs)
failure-review: api PASS (test/service.test.mjs)
