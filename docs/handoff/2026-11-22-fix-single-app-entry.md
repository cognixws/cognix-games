# 2026-11-22 — `fix/single-app-entry`

## Shipped
- Unified the Replay viewer (`#gm-view-replay`) directly into `ui/arena.html` and `ui/arena.js` (`v0.1.2`), supporting both `ext:games/replay` artifacts (`context.source === "artifact"`, `picode.use("artifact").read("replay.json")`) and in-app replay browsing.
- Reduced `ui.pages` in `picode-extension.json` to the single `"arena"` page (`contributes.artifactKinds[0].page = "arena"`) and removed `ui/replay.html` + `ui/replay.js` so **Apps** shows a single **Games Arena** tile.
- Removed `.gm-side-panel` height cap under `@media (max-width: 980px)` so `390px` stacked timelines flow without a nested scrollbar.

## Gates
- `npm run check && npm test`: PASS (15/15 tests).

uiux-review: PASS (unified Replay + Lobby/Ratings: 36px --ctl-h rows, host --pc-* tokens, primary empty state, 0 AI-slop tells; prose-card 6/6)
visual-review: PASS (subagent read regenerated 08-replay-verified-dark.png, 10-replay-artifact-390px-dark.png, 01/02/09; visual-card 6/6)
