# 2026-11-22 — `fix/tool-id`

## Shipped
- Renamed `arena` tool ID from `save_replay` to kebab-case `save-replay` (`v0.1.1`) in `picode-extension.json`, `process.mjs` and docs so COGNIX[WS]'s `capabilityID` validator accepts the manifest.
- Added `save-replay` execution test in `test/service.test.mjs`.

## Gates
- `npm run check && npm test`: PASS (15/15 tests).

failure-review: api PASS (test/service.test.mjs)
