// Deterministic No-Limit Texas Hold'em engine: 2 to 8 seats, side pots,
// 7-card evaluator, SHA-256 commit-reveal per hand, and 3-strike referee.
import { makeSeed, deriveRoundSeed, commitSeed, createSeededRng } from "./ratings.mjs";

const RANKS = "23456789TJQKA";
const SUITS = ["♠", "♥", "♦", "♣"];

export function buildDeck() {
  const deck = [];
  for (const r of RANKS) {
    for (const s of SUITS) deck.push(r + s);
  }
  return deck;
}

export function createHoldemState(seats, opts = {}) {
  if (!Array.isArray(seats) || seats.length < 2 || seats.length > 8) {
    throw new Error("No-Limit Hold'em requires 2 to 8 seats.");
  }
  const startingStack = Math.max(200, Number(opts.startingStack || 2000));
  const smallBlind = Math.max(5, Number(opts.smallBlind || 10));
  const bigBlind = Math.max(smallBlind * 2, Number(opts.bigBlind || 20));
  const maxHands = Math.max(1, Number(opts.maxHands || 25));
  const masterSeed = opts.seed || makeSeed();

  const state = {
    game: "holdem",
    masterSeed,
    hand: 0,
    maxHands,
    smallBlind,
    bigBlind,
    dealerIdx: 0,
    stacks: seats.map(() => startingStack),
    holeCards: seats.map(() => []),
    folded: seats.map(() => false),
    allIn: seats.map(() => false),
    streetBet: seats.map(() => 0),
    handCommitted: seats.map(() => 0),
    actedThisStreet: seats.map(() => false),
    strikes: seats.map(() => 0),
    board: [],
    deckRemainder: [],
    handSeed: "",
    seedCommit: "",
    revealedSeed: null,
    pot: 0,
    currentBet: 0,
    minRaiseTo: bigBlind * 2,
    street: "preflop", // "preflop" | "flop" | "turn" | "river" | "showdown"
    turnIdx: 0,
    phase: "playing",  // "playing" | "finished"
    lastShowdown: null,
    winnerIdx: null
  };

  startNextHand(state, true);
  return state;
}

function fundedSeats(state) {
  const out = [];
  for (let i = 0; i < state.stacks.length; i++) {
    if (state.stacks[i] > 0) out.push(i);
  }
  return out;
}

function nextSeatWithChips(state, fromIdx) {
  const n = state.stacks.length;
  for (let step = 1; step <= n; step++) {
    const idx = (fromIdx + step) % n;
    if (state.stacks[idx] > 0) return idx;
  }
  return 0;
}

function postChip(state, idx, amount) {
  const actual = Math.min(state.stacks[idx], amount);
  state.stacks[idx] -= actual;
  state.streetBet[idx] += actual;
  state.handCommitted[idx] += actual;
  state.pot += actual;
  if (state.stacks[idx] === 0) state.allIn[idx] = true;
  return actual;
}

export function startNextHand(state, isFirst = false) {
  const alive = fundedSeats(state);
  if (alive.length <= 1 || state.hand >= state.maxHands) {
    finishMatchByStacks(state);
    return;
  }

  state.hand += 1;
  state.dealerIdx = isFirst ? alive[0] : nextSeatWithChips(state, state.dealerIdx);
  state.handSeed = deriveRoundSeed(state.masterSeed, state.hand);
  state.seedCommit = commitSeed(state.handSeed);
  state.revealedSeed = null;

  const rng = createSeededRng(state.handSeed);
  const deck = rng.shuffle(buildDeck());
  let ptr = 0;

  const n = state.stacks.length;
  state.board = [];
  state.pot = 0;
  state.holeCards = Array.from({ length: n }, (_, i) =>
    state.stacks[i] > 0 ? [deck[ptr++], deck[ptr++]] : []
  );
  state.deckRemainder = deck.slice(ptr);
  state.folded = state.stacks.map((st) => st <= 0);
  state.allIn = state.stacks.map(() => false);
  state.streetBet = state.stacks.map(() => 0);
  state.handCommitted = state.stacks.map(() => 0);
  state.actedThisStreet = state.stacks.map(() => false);
  state.street = "preflop";

  const headsUp = alive.length === 2;
  const sbIdx = headsUp ? state.dealerIdx : nextSeatWithChips(state, state.dealerIdx);
  const bbIdx = nextSeatWithChips(state, sbIdx);

  postChip(state, sbIdx, state.smallBlind);
  postChip(state, bbIdx, state.bigBlind);
  state.currentBet = Math.max(state.streetBet[sbIdx], state.streetBet[bbIdx]);
  state.minRaiseTo = state.currentBet + state.bigBlind;
  state.turnIdx = nextActionableFrom(state, (bbIdx + 1) % n);

  // Edge case: everyone all-in on blinds
  if (state.turnIdx === -1) {
    runOutBoardAndSettle(state);
  }
}

function finishMatchByStacks(state) {
  state.phase = "finished";
  state.pot = 0;
  state.currentBet = 0;
  state.streetBet = state.stacks.map(() => 0);
  state.turnIdx = -1;
  state.revealedSeed = state.handSeed || state.masterSeed;
  let maxStack = -1;
  let leaders = [];
  for (let i = 0; i < state.stacks.length; i++) {
    if (state.stacks[i] > maxStack) {
      maxStack = state.stacks[i];
      leaders = [i];
    } else if (state.stacks[i] === maxStack) {
      leaders.push(i);
    }
  }
  state.winnerIdx = leaders.length === 1 ? leaders[0] : null;
}

function activeInHand(state) {
  const out = [];
  for (let i = 0; i < state.stacks.length; i++) {
    if (!state.folded[i] && state.holeCards[i].length === 2) out.push(i);
  }
  return out;
}

function actionableSeats(state) {
  const out = [];
  for (let i = 0; i < state.stacks.length; i++) {
    if (!state.folded[i] && !state.allIn[i] && state.holeCards[i].length === 2) out.push(i);
  }
  return out;
}

function nextActionableFrom(state, startIdx) {
  const n = state.stacks.length;
  for (let step = 0; step < n; step++) {
    const idx = (startIdx + step) % n;
    if (!state.folded[idx] && !state.allIn[idx] && state.holeCards[idx].length === 2) {
      return idx;
    }
  }
  return -1;
}

function isStreetComplete(state) {
  const contenders = activeInHand(state);
  if (contenders.length <= 1) return true;
  for (let i = 0; i < state.stacks.length; i++) {
    if (state.folded[i] || state.allIn[i] || state.holeCards[i].length !== 2) continue;
    if (!state.actedThisStreet[i] || state.streetBet[i] !== state.currentBet) return false;
  }
  return true;
}

export function legalHoldemActions(state) {
  if (state.phase === "finished" || state.turnIdx < 0) return [];
  const idx = state.turnIdx;
  const toCall = Math.max(0, state.currentBet - state.streetBet[idx]);
  const stack = state.stacks[idx];
  const actions = ["fold"];
  if (toCall === 0) {
    actions.push("check");
    if (stack > 0) {
      const minBet = Math.min(stack, state.bigBlind);
      const halfPot = Math.min(stack, Math.max(minBet, Math.round(state.pot * 0.5)));
      const fullPot = Math.min(stack, Math.max(minBet, state.pot));
      actions.push(`bet ${minBet}`);
      if (halfPot > minBet && halfPot < stack) actions.push(`bet ${halfPot}`);
      if (fullPot > halfPot && fullPot < stack) actions.push(`bet ${fullPot}`);
      actions.push("allin");
    }
  } else {
    actions.push("call");
    const maxTotal = state.streetBet[idx] + stack;
    if (maxTotal > state.currentBet) {
      const minR = Math.min(maxTotal, Math.max(state.minRaiseTo, state.currentBet + state.bigBlind));
      if (minR < maxTotal) actions.push(`raise ${minR}`);
      actions.push("allin");
    }
  }
  return actions;
}

export function applyHoldemAction(state, seatIdx, rawAction) {
  if (state.phase === "finished") {
    return { ok: false, error: "This Hold'em match has already finished." };
  }
  if (seatIdx !== state.turnIdx) {
    return { ok: false, error: "It is not your seat's turn to act." };
  }

  const s = String(rawAction || "").trim().toLowerCase();
  const toCall = Math.max(0, state.currentBet - state.streetBet[seatIdx]);
  const stack = state.stacks[seatIdx];
  let milestone = null;
  let summary = "";

  if (s === "fold") {
    state.folded[seatIdx] = true;
    state.actedThisStreet[seatIdx] = true;
    summary = "Fold";
  } else if (s === "check") {
    if (toCall > 0) {
      return recordHoldemStrike(state, seatIdx, `Cannot check facing a bet (${toCall} to call).`);
    }
    state.actedThisStreet[seatIdx] = true;
    summary = "Check";
  } else if (s === "call") {
    if (toCall === 0) {
      state.actedThisStreet[seatIdx] = true;
      summary = "Check";
    } else {
      const paid = postChip(state, seatIdx, toCall);
      state.actedThisStreet[seatIdx] = true;
      if (state.allIn[seatIdx]) milestone = "allin";
      summary = `Call $${paid}`;
    }
  } else if (s === "allin" || s === "all-in" || s === "shove") {
    if (stack <= 0) return recordHoldemStrike(state, seatIdx, "No chips remaining to shove.");
    const prevBet = state.currentBet;
    postChip(state, seatIdx, stack);
    const total = state.streetBet[seatIdx];
    if (total > prevBet) {
      const raiseSize = total - prevBet;
      state.currentBet = total;
      state.minRaiseTo = total + Math.max(state.bigBlind, raiseSize);
      for (let i = 0; i < state.actedThisStreet.length; i++) {
        if (i !== seatIdx) state.actedThisStreet[i] = false;
      }
    }
    state.actedThisStreet[seatIdx] = true;
    milestone = "allin";
    summary = `All-in ($${total})`;
  } else {
    const m = /^(?:bet|raise(?:\s+to)?)\s+\$?(\d+)$/.exec(s);
    if (!m) {
      return recordHoldemStrike(state, seatIdx, `Unrecognized Hold'em action "${rawAction}".`);
    }
    const targetTotal = Number(m[1]);
    const maxTotal = state.streetBet[seatIdx] + stack;
    const minRequired = state.currentBet === 0
      ? Math.min(maxTotal, state.bigBlind)
      : Math.min(maxTotal, state.minRaiseTo);
    if (targetTotal < minRequired || targetTotal > maxTotal) {
      return recordHoldemStrike(state, seatIdx, `Bet/raise total must be between ${minRequired} and ${maxTotal} (your max total).`);
    }
    const delta = targetTotal - state.streetBet[seatIdx];
    const raiseSize = targetTotal - state.currentBet;
    postChip(state, seatIdx, delta);
    state.currentBet = targetTotal;
    state.minRaiseTo = targetTotal + Math.max(state.bigBlind, raiseSize);
    for (let i = 0; i < state.actedThisStreet.length; i++) {
      if (i !== seatIdx) state.actedThisStreet[i] = false;
    }
    state.actedThisStreet[seatIdx] = true;
    if (state.allIn[seatIdx]) milestone = "allin";
    summary = toCall === 0 ? `Bet $${targetTotal}` : `Raise to $${targetTotal}`;
  }

  advanceHoldem(state);
  if (state.lastShowdown && state.lastShowdown.hand === state.hand && summary !== "Fold") {
    milestone = milestone || "showdown";
  }
  if (state.phase === "finished") milestone = "finished";

  return { ok: true, milestone, summary };
}

function recordHoldemStrike(state, seatIdx, msg) {
  state.strikes[seatIdx] = (state.strikes[seatIdx] || 0) + 1;
  const strike = state.strikes[seatIdx];
  if (strike >= 3) {
    state.strikes[seatIdx] = 0;
    const toCall = Math.max(0, state.currentBet - state.streetBet[seatIdx]);
    if (toCall === 0) {
      state.actedThisStreet[seatIdx] = true;
    } else {
      state.folded[seatIdx] = true;
      state.actedThisStreet[seatIdx] = true;
    }
    advanceHoldem(state);
    return { ok: false, forfeitedRound: true, strike: 3, error: `${msg} Strike 3/3 reached: automatic ${toCall === 0 ? "check" : "fold"} applied.` };
  }
  return {
    ok: false,
    strike,
    legal_actions: legalHoldemActions(state),
    error: `${msg} (Illegal attempt ${strike}/3 — legal_actions: ${legalHoldemActions(state).join(", ")}).`
  };
}

function advanceHoldem(state) {
  const contenders = activeInHand(state);
  if (contenders.length === 1) {
    // Uncontested pot
    const winner = contenders[0];
    const wonPot = state.pot;
    state.pot = 0;
    state.stacks[winner] += wonPot;
    state.lastShowdown = {
      hand: state.hand,
      uncontested: true,
      winners: [{ seatIdx: winner, amount: wonPot, handName: "Uncontested pot" }],
      board: state.board.slice(),
      holeCards: state.holeCards.map((c) => c.slice()),
      handSeed: state.handSeed,
      seedCommit: state.seedCommit
    };
    startNextHand(state, false);
    return;
  }

  if (!isStreetComplete(state)) {
    state.turnIdx = nextActionableFrom(state, (state.turnIdx + 1) % state.stacks.length);
    if (state.turnIdx !== -1) return;
  }

  // If <= 1 player can still make decisions, run out remaining streets to showdown
  if (actionableSeats(state).length <= 1) {
    runOutBoardAndSettle(state);
    return;
  }

  // Advance street
  if (state.street === "preflop") {
    state.board.push(state.deckRemainder.shift(), state.deckRemainder.shift(), state.deckRemainder.shift());
    state.street = "flop";
  } else if (state.street === "flop") {
    state.board.push(state.deckRemainder.shift());
    state.street = "turn";
  } else if (state.street === "turn") {
    state.board.push(state.deckRemainder.shift());
    state.street = "river";
  } else {
    settleShowdown(state);
    return;
  }

  state.currentBet = 0;
  state.minRaiseTo = state.bigBlind;
  state.streetBet = state.stacks.map(() => 0);
  state.actedThisStreet = state.stacks.map(() => false);
  state.turnIdx = nextActionableFrom(state, (state.dealerIdx + 1) % state.stacks.length);
  if (state.turnIdx === -1) runOutBoardAndSettle(state);
}

function runOutBoardAndSettle(state) {
  while (state.board.length < 5 && state.deckRemainder.length > 0) {
    state.board.push(state.deckRemainder.shift());
  }
  settleShowdown(state);
}

function settleShowdown(state) {
  const levels = Array.from(new Set(state.handCommitted.filter((v) => v > 0))).sort((a, b) => a - b);
  const payouts = state.stacks.map(() => 0);
  const evals = state.holeCards.map((hc, i) =>
    !state.folded[i] && hc.length === 2 ? evaluate7Cards(hc.concat(state.board)) : null
  );

  let prevLevel = 0;
  for (const lvl of levels) {
    let slicePot = 0;
    const eligible = [];
    for (let i = 0; i < state.stacks.length; i++) {
      const contrib = Math.max(0, Math.min(state.handCommitted[i], lvl) - prevLevel);
      slicePot += contrib;
      if (!state.folded[i] && state.handCommitted[i] >= lvl && evals[i]) {
        eligible.push(i);
      }
    }
    prevLevel = lvl;
    if (slicePot <= 0 || eligible.length === 0) continue;

    let bestScore = -1;
    let sliceWinners = [];
    for (const idx of eligible) {
      const sc = evals[idx].score;
      if (sc > bestScore) { bestScore = sc; sliceWinners = [idx]; }
      else if (sc === bestScore) sliceWinners.push(idx);
    }
    const share = Math.floor(slicePot / sliceWinners.length);
    let rem = slicePot - share * sliceWinners.length;
    for (const w of sliceWinners) {
      payouts[w] += share + (rem > 0 ? 1 : 0);
      if (rem > 0) rem--;
    }
  }

  const winners = [];
  state.pot = 0;
  for (let i = 0; i < payouts.length; i++) {
    if (payouts[i] > 0) {
      state.stacks[i] += payouts[i];
      winners.push({ seatIdx: i, amount: payouts[i], handName: evals[i]?.name || "Showdown" });
    }
  }

  state.lastShowdown = {
    hand: state.hand,
    uncontested: false,
    winners,
    board: state.board.slice(),
    holeCards: state.holeCards.map((c) => c.slice()),
    handSeed: state.handSeed,
    seedCommit: state.seedCommit
  };

  startNextHand(state, false);
}

// Exact 7-card evaluator returning { score, name }
export function evaluate7Cards(cards) {
  let best = { score: -1, name: "High Card" };
  const n = cards.length;
  for (let a = 0; a < n - 4; a++) {
    for (let b = a + 1; b < n - 3; b++) {
      for (let c = b + 1; c < n - 2; c++) {
        for (let d = c + 1; d < n - 1; d++) {
          for (let e = d + 1; e < n; e++) {
            const ev = eval5([cards[a], cards[b], cards[c], cards[d], cards[e]]);
            if (ev.score > best.score) best = ev;
          }
        }
      }
    }
  }
  return best;
}

const CAT_NAMES = [
  "High Card", "One Pair", "Two Pair", "Three of a Kind",
  "Straight", "Flush", "Full House", "Four of a Kind", "Straight Flush"
];

function eval5(five) {
  const ranks = five.map((c) => RANKS.indexOf(c[0]) + 2).sort((a, b) => b - a);
  const flush = five.every((c) => c.slice(-1) === five[0].slice(-1));

  let straightHigh = 0;
  const uniq = Array.from(new Set(ranks));
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0];
    else if (uniq[0] === 14 && uniq[1] === 5 && uniq[4] === 2) straightHigh = 5; // A-2-3-4-5 wheel
  }

  const counts = new Map();
  for (const r of ranks) counts.set(r, (counts.get(r) || 0) + 1);
  const groups = Array.from(counts.entries()).sort((a, b) => (b[1] - a[1]) || (b[0] - a[0]));

  let cat = 0;
  let tie = ranks;
  if (flush && straightHigh) {
    cat = 8;
    tie = [straightHigh];
  } else if (groups[0][1] === 4) {
    cat = 7;
    tie = [groups[0][0], groups[1][0]];
  } else if (groups[0][1] === 3 && groups[1][1] === 2) {
    cat = 6;
    tie = [groups[0][0], groups[1][0]];
  } else if (flush) {
    cat = 5;
  } else if (straightHigh) {
    cat = 4;
    tie = [straightHigh];
  } else if (groups[0][1] === 3) {
    cat = 3;
    tie = [groups[0][0], groups[1][0], groups[2][0]];
  } else if (groups[0][1] === 2 && groups[1][1] === 2) {
    cat = 2;
    tie = [groups[0][0], groups[1][0], groups[2][0]];
  } else if (groups[0][1] === 2) {
    cat = 1;
    tie = [groups[0][0], groups[1][0], groups[2][0], groups[3][0]];
  }

  let score = cat;
  for (let i = 0; i < 5; i++) {
    score = score * 16 + (tie[i] || 0);
  }
  return { score, name: CAT_NAMES[cat] };
}

export function chooseHoldemBotAction(state, seatIdx) {
  const hole = state.holeCards[seatIdx] || [];
  const toCall = Math.max(0, state.currentBet - state.streetBet[seatIdx]);
  const legal = legalHoldemActions(state);
  const r1 = RANKS.indexOf(hole[0]?.[0]) + 2;
  const r2 = RANKS.indexOf(hole[1]?.[0]) + 2;
  const pair = r1 === r2;
  const high = Math.max(r1, r2);
  const suited = hole[0]?.slice(-1) === hole[1]?.slice(-1);

  let strength = (high + Math.min(r1, r2)) / 28 + (pair ? 0.32 : 0) + (suited ? 0.06 : 0);
  if (state.board.length >= 3 && hole.length === 2) {
    const ev = evaluate7Cards(hole.concat(state.board));
    const cat = Math.floor(ev.score / Math.pow(16, 5));
    strength = Math.min(1, 0.25 + cat * 0.16);
  }

  if (toCall === 0) {
    const betOpt = legal.find((a) => a.startsWith("bet "));
    if (strength > 0.56 && betOpt) {
      return { action: betOpt, talk: "Betting for value.", thought: `Estimated strength ${(strength * 100).toFixed(0)}% holding ${hole.join(" ")}.` };
    }
    return { action: "check", talk: "Check.", thought: `Pot control holding ${hole.join(" ")}.` };
  }

  const potOdds = toCall / Math.max(1, state.pot + toCall);
  if (strength >= potOdds + 0.12) {
    const raiseOpt = legal.find((a) => a.startsWith("raise "));
    if (strength > 0.74 && raiseOpt) {
      return { action: raiseOpt, talk: "Let's build this pot.", thought: `Strong equity (${(strength * 100).toFixed(0)}%) well above pot odds.` };
    }
    return { action: "call", talk: "Call.", thought: `Estimated equity covers pot odds of ${(potOdds * 100).toFixed(0)}%.` };
  }
  return { action: "fold", talk: "Folding this spot.", thought: `Strength ${(strength * 100).toFixed(0)}% below price to call (${toCall}).` };
}
