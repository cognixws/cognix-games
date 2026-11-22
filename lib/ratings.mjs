// Cryptographic commit-reveal RNG and multiplayer Bradley-Terry / Elo ratings.
import { createHash, createHmac, randomBytes } from "node:crypto";

export function makeSeed() {
  return randomBytes(32).toString("hex");
}

export function deriveRoundSeed(masterSeed, roundNumber) {
  return createHmac("sha256", String(masterSeed)).update("round:" + String(roundNumber)).digest("hex");
}

export function commitSeed(seed) {
  return createHash("sha256").update(String(seed)).digest("hex");
}

export function verifyCommit(seed, commit) {
  if (!seed || !commit) return false;
  return commitSeed(seed) === String(commit);
}

// Deterministic stream of [0, max) integers derived from a committed hex seed
// with rejection sampling so modulo bias never skews shuffles or dice.
export function createSeededRng(seed) {
  let counter = 0;
  let buf = Buffer.alloc(0);
  let offset = 0;

  function refill() {
    buf = createHmac("sha256", String(seed)).update(String(counter++)).digest();
    offset = 0;
  }

  function nextUint32() {
    if (offset + 4 > buf.length) refill();
    const v = buf.readUInt32BE(offset);
    offset += 4;
    return v;
  }

  return {
    int(max) {
      if (max <= 1) return 0;
      const limit = Math.floor(0x100000000 / max) * max;
      let v = nextUint32();
      while (v >= limit) v = nextUint32();
      return v % max;
    },
    shuffle(items) {
      const a = items.slice();
      for (let i = a.length - 1; i > 0; i--) {
        const j = this.int(i + 1);
        const tmp = a[i];
        a[i] = a[j];
        a[j] = tmp;
      }
      return a;
    }
  };
}

// Pairwise Bradley-Terry / Elo update across N ranked finishers.
// placements: [{ actorId, rank }] where lower rank is better (1 = winner; equal rank = draw).
export function computeRatingDeltas(currentRatings, placements, kBase = 28) {
  const n = placements.length;
  if (n < 2) return new Map();
  const scale = kBase / Math.max(1, n - 1);
  const deltas = new Map();
  for (const p of placements) deltas.set(p.actorId, 0);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = placements[i];
      const b = placements[j];
      if (a.actorId === b.actorId) continue;
      const ra = currentRatings.get(a.actorId) ?? 1500;
      const rb = currentRatings.get(b.actorId) ?? 1500;
      const ea = 1 / (1 + Math.pow(10, (rb - ra) / 400));
      const eb = 1 - ea;
      const sa = a.rank < b.rank ? 1 : (a.rank > b.rank ? 0 : 0.5);
      const sb = 1 - sa;
      deltas.set(a.actorId, deltas.get(a.actorId) + scale * (sa - ea));
      deltas.set(b.actorId, deltas.get(b.actorId) + scale * (sb - eb));
    }
  }
  for (const [k, v] of deltas.entries()) {
    deltas.set(k, Math.round(v * 10) / 10);
  }
  return deltas;
}
