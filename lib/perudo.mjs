// Deterministic Liar's Dice (Perudo) engine: 2 to 6 seats, wild 1s, SHA-256 commit-reveal.
import { makeSeed, deriveRoundSeed, commitSeed, createSeededRng } from "./ratings.mjs";

export function createPerudoState(seats, opts = {}) {
  if (!Array.isArray(seats) || seats.length < 2 || seats.length > 6) {
    throw new Error("Liar's Dice requires 2 to 6 seats.");
  }
  const startingDice = Math.min(6, Math.max(2, Number(opts.startingDice || 4)));
  const masterSeed = opts.seed || makeSeed();
  const state = {
    game: "perudo",
    masterSeed,
    round: 0,
    startingDice,
    diceCounts: seats.map(() => startingDice),
    cups: seats.map(() => []),
    roundSeed: "",
    seedCommit: "",
    revealedSeed: null,
    currentBid: null, // { seatIdx, qty, face }
    turnIdx: 0,
    phase: "bidding", // "bidding" | "finished"
    strikes: seats.map(() => 0),
    lastShowdown: null,
    winnerIdx: null
  };
  startNextRound(state, 0);
  return state;
}

function aliveIndices(state) {
  const out = [];
  for (let i = 0; i < state.diceCounts.length; i++) {
    if (state.diceCounts[i] > 0) out.push(i);
  }
  return out;
}

function nextAliveFrom(state, startIdx) {
  const n = state.diceCounts.length;
  for (let step = 0; step < n; step++) {
    const idx = (startIdx + step) % n;
    if (state.diceCounts[idx] > 0) return idx;
  }
  return 0;
}

export function totalDiceInPlay(state) {
  return state.diceCounts.reduce((acc, c) => acc + c, 0);
}

function startNextRound(state, starterIdx) {
  const alive = aliveIndices(state);
  if (alive.length <= 1) {
    state.phase = "finished";
    state.winnerIdx = alive[0] ?? 0;
    state.revealedSeed = state.roundSeed;
    return;
  }
  state.round += 1;
  state.roundSeed = deriveRoundSeed(state.masterSeed, state.round);
  state.seedCommit = commitSeed(state.roundSeed);
  state.revealedSeed = null;
  const rng = createSeededRng(state.roundSeed);
  state.cups = state.diceCounts.map((count) => {
    const cup = [];
    for (let i = 0; i < count; i++) cup.push(rng.int(6) + 1);
    return cup;
  });
  state.currentBid = null;
  state.turnIdx = nextAliveFrom(state, starterIdx);
  state.phase = "bidding";
}

// Effective rank of a bid so ones (aces) obey standard Perudo hierarchy:
// bidding on face 1 requires >= ceil(prevQty / 2); raising from face 1 to 2..6 requires >= prevQty * 2 + 1.
export function isLegalBid(prevBid, qty, face, maxDice) {
  if (!Number.isInteger(qty) || !Number.isInteger(face) || face < 1 || face > 6) return false;
  if (qty < 1 || qty > maxDice) return false;
  if (!prevBid) {
    return face !== 1 || qty >= 1;
  }
  if (prevBid.face !== 1 && face !== 1) {
    return qty > prevBid.qty || (qty === prevBid.qty && face > prevBid.face);
  }
  if (prevBid.face !== 1 && face === 1) {
    return qty >= Math.ceil(prevBid.qty / 2);
  }
  if (prevBid.face === 1 && face === 1) {
    return qty > prevBid.qty;
  }
  // prevBid.face === 1 && face !== 1
  return qty >= prevBid.qty * 2 + 1;
}

export function legalPerudoActions(state) {
  if (state.phase === "finished") return [];
  const max = totalDiceInPlay(state);
  const out = [];
  if (state.currentBid) out.push("dudo");
  // Offer concise representative legal bids plus pattern hint
  let added = 0;
  for (let qty = 1; qty <= max && added < 12; qty++) {
    for (let face = 2; face <= 6 && added < 12; face++) {
      if (isLegalBid(state.currentBid, qty, face, max)) {
        out.push(`bid ${qty}x${face}`);
        added++;
      }
    }
    if (isLegalBid(state.currentBid, qty, 1, max) && added < 14) {
      out.push(`bid ${qty}x1`);
      added++;
    }
  }
  return out;
}

export function parsePerudoAction(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "dudo" || s === "duvido" || s === "liar" || s === "challenge") {
    return { type: "dudo" };
  }
  const m = /^(?:bid\s+)?(\d+)\s*[x×*\s-]\s*([1-6])$/.exec(s);
  if (!m) return null;
  return { type: "bid", qty: Number(m[1]), face: Number(m[2]) };
}

export function countMatchingDice(cups, face) {
  let count = 0;
  for (const cup of cups) {
    for (const d of cup) {
      if (d === face || (face !== 1 && d === 1)) count++;
    }
  }
  return count;
}

export function applyPerudoAction(state, seatIdx, rawAction) {
  if (state.phase === "finished") {
    return { ok: false, error: "This Liar's Dice match has already finished." };
  }
  if (seatIdx !== state.turnIdx) {
    return { ok: false, error: "It is not your seat's turn." };
  }
  const parsed = parsePerudoAction(rawAction);
  const maxDice = totalDiceInPlay(state);
  if (!parsed) {
    return recordStrike(state, seatIdx, `Unrecognized action "${rawAction}". Use "bid <qty>x<face>" (e.g. "bid 4x5") or "dudo".`);
  }
  if (parsed.type === "dudo") {
    if (!state.currentBid) {
      return recordStrike(state, seatIdx, "Cannot call dudo on the opening turn of a round — place an opening bid first.");
    }
    const bid = state.currentBid;
    const actual = countMatchingDice(state.cups, bid.face);
    const bidderWon = actual >= bid.qty;
    const loserIdx = bidderWon ? seatIdx : bid.seatIdx;
    const revealedCups = state.cups.map((c) => c.slice());
    const revealedSeed = state.roundSeed;
    const revealedCommit = state.seedCommit;
    state.diceCounts[loserIdx] = Math.max(0, state.diceCounts[loserIdx] - 1);

    state.lastShowdown = {
      round: state.round,
      challengerIdx: seatIdx,
      bidderIdx: bid.seatIdx,
      bid: { qty: bid.qty, face: bid.face },
      actual,
      loserIdx,
      cups: revealedCups,
      roundSeed: revealedSeed,
      seedCommit: revealedCommit
    };
    startNextRound(state, loserIdx);
    return {
      ok: true,
      milestone: state.phase === "finished" ? "finished" : "dudo",
      summary: `Dudo! Bid was ${bid.qty}×[${bid.face}], table held ${actual} — seat ${loserIdx + 1} loses a die.`
    };
  }

  if (!isLegalBid(state.currentBid, parsed.qty, parsed.face, maxDice)) {
    return recordStrike(state, seatIdx, `Illegal bid ${parsed.qty}x${parsed.face} after ${state.currentBid ? `${state.currentBid.qty}x${state.currentBid.face}` : "opening"} (total dice: ${maxDice}).`);
  }
  state.currentBid = { seatIdx, qty: parsed.qty, face: parsed.face };
  state.turnIdx = nextAliveFrom(state, (seatIdx + 1) % state.diceCounts.length);
  return {
    ok: true,
    milestone: null,
    summary: `Bid ${parsed.qty}×[${parsed.face}]`
  };
}

function recordStrike(state, seatIdx, message) {
  state.strikes[seatIdx] = (state.strikes[seatIdx] || 0) + 1;
  const strike = state.strikes[seatIdx];
  if (strike >= 3) {
    // Strike 3/3 penalizes 1 die and advances round so no infinite loop occurs
    state.strikes[seatIdx] = 0;
    state.diceCounts[seatIdx] = Math.max(0, state.diceCounts[seatIdx] - 1);
    startNextRound(state, (seatIdx + 1) % state.diceCounts.length);
    return {
      ok: false,
      forfeitedRound: true,
      strike: 3,
      error: `${message} Strike 3/3 reached: your seat lost 1 die and a new round started.`
    };
  }
  return {
    ok: false,
    strike,
    legal_actions: legalPerudoActions(state),
    error: `${message} (Illegal attempt ${strike}/3 — legal examples: ${legalPerudoActions(state).slice(0, 6).join(", ")}).`
  };
}

export function choosePerudoBotAction(state, seatIdx) {
  const myCup = state.cups[seatIdx] || [];
  const total = totalDiceInPlay(state);
  const otherDice = total - myCup.length;

  if (state.currentBid) {
    const { qty, face } = state.currentBid;
    const myMatches = myCup.filter((d) => d === face || (face !== 1 && d === 1)).length;
    const pSingle = face === 1 ? 1 / 6 : 2 / 6;
    const expected = myMatches + otherDice * pSingle;
    if (qty > expected + 1.15 || qty >= total) {
      return { action: "dudo", talk: "That count is way over the line. Dudo!", thought: `Holding ${myMatches} matches; expected total is ${expected.toFixed(1)} against bid ${qty}.` };
    }
  }

  // Pick best face in own cup
  let bestFace = 4;
  let bestCount = -1;
  for (let f = 2; f <= 6; f++) {
    const c = myCup.filter((d) => d === f || d === 1).length;
    if (c > bestCount) { bestCount = c; bestFace = f; }
  }
  const legal = legalPerudoActions(state).filter((a) => a !== "dudo");
  const preferred = legal.find((a) => a.endsWith("x" + bestFace)) || legal[0] || "dudo";
  return {
    action: preferred,
    talk: preferred === "dudo" ? "Dudo!" : `Raising the table to ${preferred.replace("bid ", "")}.`,
    thought: `Cup holds ${bestCount} dice backing face ${bestFace} out of ${total} total dice.`
  };
}
