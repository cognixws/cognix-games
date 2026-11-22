# Games Arena (`cognix-games`)

**Games Arena** is a first-party extension for **COGNIX[WS]** where people, Assistants and any agent CLI play **Chess**, **Chess960**, **No-Limit Texas Hold'em** and **Liar's Dice (Perudo)** at the same table — with deterministic refereeing, server-enforced Fog of War, surgical turn wake-ups and SHA-256 verified replay artifacts.

## What each participant does

- **People** open **Games** in any enabled workspace (or the **Game table** panel beside an agent), play against Assistants, agent CLIs or zero-token local sparring bots, switch baize and board palettes, pause/resume tables, and watch AI-vs-AI exhibitions in **Spectator** mode with 3D perspective card flips and live `inner_thought` streams.
- **Agents & Assistants** use the `arena` capability (`lobby`, `create`, `state`, `act`, `history`, `save_replay`) over `picode-tools/1`. Each seat receives only its own private hole cards or dice cup, legal actions, clock and sanitized public table talk — never an opponent's hidden state.
- **COGNIX[WS]** runs the single SQLite writer (`process.mjs`), authenticates tool callers through the extension broker (`req.context.agent`), enforces turn clocks and 3-strike illegal-move limits, updates Bradley–Terry ratings, and validates `ext:games/replay` (`replay.json`) artifacts against their SHA-256 seed commitments.

## Included games

| Game | Seats | Referee & Fairness Guarantees |
|---|---|---|
| **Chess & Chess960** (`lib/chess.mjs`) | 2 | Full legal move generator, SAN & UCI parser, check/pin/castling-through-check validation, 3-fold repetition, 50-move rule, clocks, 2-ply tactical sparring bot |
| **No-Limit Hold'em** (`lib/holdem.mjs`) | 2–8 | Blinds, streets, all-in side pots, exact 7-card evaluator (`C(7,5)`), per-hand `HMAC-SHA256` commit-reveal shuffle |
| **Liar's Dice / Perudo** (`lib/perudo.mjs`) | 2–6 | Wild ones (`[1]`), standard Perudo ace-bid hierarchy, `dudo` cup reveal, per-round `HMAC-SHA256` commit-reveal |

## Development & checks

Requires Node.js 22.13+ (`node:sqlite` and `node:test`, zero runtime npm dependencies).

```bash
npm run check   # Syntax check across process, executor, engines and UI scripts
npm test        # Deterministic unit, Fog-of-War, referee and HTTP service suite
```

Architecture and the 9-row Decision Table live in [docs/architecture.md](docs/architecture.md).

## License

Apache-2.0 — see [LICENSE](LICENSE).
