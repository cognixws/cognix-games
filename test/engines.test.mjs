import test from "node:test";
import assert from "node:assert/strict";

import { commitSeed, verifyCommit, createSeededRng, computeRatingDeltas } from "../lib/ratings.mjs";
import { createChessState, legalChessActions, applyChessAction, generateChess960Backrank } from "../lib/chess.mjs";
import { createHoldemState, legalHoldemActions, applyHoldemAction, evaluate7Cards } from "../lib/holdem.mjs";
import { createPerudoState, legalPerudoActions, applyPerudoAction, isLegalBid } from "../lib/perudo.mjs";

const TWO_SEATS = [
  { seatIdx: 0, actorId: "a1", name: "White", kind: "agent" },
  { seatIdx: 1, actorId: "a2", name: "Black", kind: "agent" }
];

test("Chess: scholar's mate finishes match with 1-0 and checkmate reason", () => {
  const st = createChessState(TWO_SEATS, { seed: "seed-scholar" });
  assert.equal(legalChessActions(st).length, 20);

  for (const [seat, san] of [[0, "e4"], [1, "e5"], [0, "Bc4"], [1, "Nc6"], [0, "Qh5"], [1, "Nf6"], [0, "Qxf7#"]]) {
    const res = applyChessAction(st, seat, san, 250);
    assert.equal(res.ok, true, `expected ${san} to be legal`);
  }
  assert.equal(st.phase, "finished");
  assert.equal(st.result, "1-0");
  assert.equal(st.winnerIdx, 0);
  assert.match(st.reason, /Checkmate/);
});

test("Chess: castling through an attacked transit square (f1/f8) is refused with attackedSquare", () => {
  // Black bishop on a3 attacks f8; Black tries O-O on e8..h8
  const fen = "r3k2r/pppp1ppp/8/8/8/B7/PPPPPPPP/R3K2R b KQkq - 0 1";
  const st = createChessState(TWO_SEATS, { fen });
  assert.equal(legalChessActions(st).includes("O-O"), false);

  const foul = applyChessAction(st, 1, "O-O", 100);
  assert.equal(foul.ok, false);
  assert.equal(foul.strike, 1);
  assert.equal(foul.attackedSquare, "f8");
  assert.equal(st.fen, fen);
});

test("Chess960: generated backrank places opposite-color bishops and king between rooks", () => {
  for (let i = 0; i < 25; i++) {
    const rank = generateChess960Backrank(`c960-${i}`);
    assert.equal(rank.length, 8);
    const b1 = rank.indexOf("B");
    const b2 = rank.lastIndexOf("B");
    assert.notEqual(b1 % 2, b2 % 2, "bishops must sit on opposite colors");
    const r1 = rank.indexOf("R");
    const k = rank.indexOf("K");
    const r2 = rank.lastIndexOf("R");
    assert.ok(r1 < k && k < r2, `king must be between rooks in ${rank}`);
  }
});

test("Hold'em: 7-card evaluator ranks Straight Flush > Quads > Full House > Wheel Straight", () => {
  const sf = evaluate7Cards(["9♠", "8♠", "7♠", "6♠", "5♠", "A♥", "K♦"]);
  const quads = evaluate7Cards(["A♠", "A♥", "A♦", "A♣", "K♠", "2♥", "3♦"]);
  const boat = evaluate7Cards(["K♠", "K♥", "K♦", "Q♠", "Q♥", "2♣", "3♦"]);
  const wheel = evaluate7Cards(["A♠", "2♥", "3♦", "4♣", "5♠", "9♥", "J♦"]);

  assert.equal(sf.name, "Straight Flush");
  assert.equal(quads.name, "Four of a Kind");
  assert.equal(boat.name, "Full House");
  assert.equal(wheel.name, "Straight");
  assert.ok(sf.score > quads.score && quads.score > boat.score && boat.score > wheel.score);
});

test("Hold'em: deterministic shuffle commit-reveal and all-in showdown conservation of chips", () => {
  const seats = [
    { seatIdx: 0, actorId: "p1", name: "Alice", kind: "agent" },
    { seatIdx: 1, actorId: "p2", name: "Bob", kind: "agent" },
    { seatIdx: 2, actorId: "p3", name: "Carol", kind: "agent" }
  ];
  const st = createHoldemState(seats, { seed: "holdem-fixed-seed", startingStack: 1000, maxHands: 3 });
  const totalBefore = st.stacks.reduce((a, b) => a + b, 0) + st.pot;
  assert.equal(totalBefore, 3000);
  assert.equal(verifyCommit(st.handSeed, st.seedCommit), true);

  // All 3 go all-in preflop to force full runout + showdown settlement
  assert.equal(applyHoldemAction(st, st.turnIdx, "allin").ok, true);
  assert.equal(applyHoldemAction(st, st.turnIdx, "allin").ok, true);
  assert.equal(applyHoldemAction(st, st.turnIdx, "allin").ok, true);

  const totalAfter = st.stacks.reduce((a, b) => a + b, 0) + st.pot;
  assert.equal(totalAfter, 3000, "chips must be strictly conserved across side-pot settlement");
  assert.ok(st.lastShowdown);
  assert.equal(verifyCommit(st.lastShowdown.handSeed, st.lastShowdown.seedCommit), true);
});

test("Perudo: ace hierarchy and dudo showdown remove exactly one die", () => {
  assert.equal(isLegalBid({ qty: 4, face: 5 }, 2, 1, 10), true, "half-up to wild ones is legal");
  assert.equal(isLegalBid({ qty: 4, face: 5 }, 1, 1, 10), false);
  assert.equal(isLegalBid({ qty: 2, face: 1 }, 5, 3, 10), true, "2*qty + 1 out of ones is legal");
  assert.equal(isLegalBid({ qty: 2, face: 1 }, 4, 6, 10), false);

  const st = createPerudoState(TWO_SEATS, { seed: "perudo-seed", startingDice: 3 });
  const totalBefore = st.diceCounts[0] + st.diceCounts[1];
  assert.ok(legalPerudoActions(st).length > 0);
  assert.equal(applyPerudoAction(st, 0, "bid 6x6").ok, true);
  const chal = applyPerudoAction(st, 1, "dudo");
  assert.equal(chal.ok, true);
  assert.equal(st.diceCounts[0] + st.diceCounts[1], totalBefore - 1);
  assert.ok(st.lastShowdown);
});

test("Bradley-Terry ratings: zero-sum deltas reward higher placement", () => {
  const cur = new Map([["a", 1500], ["b", 1500], ["c", 1500]]);
  const deltas = computeRatingDeltas(cur, [
    { actorId: "a", rank: 1 },
    { actorId: "b", rank: 2 },
    { actorId: "c", rank: 3 }
  ]);
  assert.ok(deltas.get("a") > 0);
  assert.equal(deltas.get("b"), 0);
  assert.ok(deltas.get("c") < 0);
  const rng1 = createSeededRng("same-seed").shuffle([1, 2, 3, 4, 5]);
  const rng2 = createSeededRng("same-seed").shuffle([1, 2, 3, 4, 5]);
  assert.deepEqual(rng1, rng2);
  assert.equal(verifyCommit("secret", commitSeed("secret")), true);
});
