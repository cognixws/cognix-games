// Deterministic Chess & Chess960 engine: full legal move generator, SAN & UCI parser,
// FEN/PGN serializer, clocks, 3-strike illegal move referee, and tactical sparring bot.
import { makeSeed, commitSeed, createSeededRng } from "./ratings.mjs";

const FILES = "abcdefgh";
const PIECE_VALUES = { p: 100, n: 320, b: 330, r: 500, q: 900, k: 20000 };

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export function generateChess960Backrank(seed) {
  const rng = createSeededRng(seed);
  const rank = Array(8).fill(null);
  // Dark-square bishop (0,2,4,6 -> a1,c1,e1,g1; in 0-indexed files a=0 is dark on rank 1)
  rank[rng.int(4) * 2] = "B";
  // Light-square bishop (1,3,5,7)
  rank[rng.int(4) * 2 + 1] = "B";
  const empty = () => rank.map((v, i) => (v === null ? i : -1)).filter((i) => i >= 0);
  // Queen
  let slots = empty();
  rank[slots[rng.int(slots.length)]] = "Q";
  // Two knights
  slots = empty();
  rank[slots[rng.int(slots.length)]] = "N";
  slots = empty();
  rank[slots[rng.int(slots.length)]] = "N";
  // Remaining 3 squares: R - K - R so King always starts between the Rooks
  slots = empty();
  rank[slots[0]] = "R";
  rank[slots[1]] = "K";
  rank[slots[2]] = "R";
  return rank.join("");
}

export function createChessState(seats, opts = {}) {
  if (!Array.isArray(seats) || seats.length !== 2) {
    throw new Error("Chess requires exactly 2 player seats (White and Black).");
  }
  const variant = opts.variant === "chess960" ? "chess960" : "chess";
  const seed = opts.seed || makeSeed();
  let initialFen = opts.fen || START_FEN;
  if (variant === "chess960" && !opts.fen) {
    const wRank = generateChess960Backrank(seed);
    const bRank = wRank.toLowerCase();
    // Standard castling works when K is on e1/e8 and R on a/h; otherwise "-"
    const canStd = wRank[4] === "K" && wRank[0] === "R" && wRank[7] === "R";
    initialFen = `${bRank}/pppppppp/8/8/8/8/PPPPPPPP/${wRank} w ${canStd ? "KQkq" : "-"} - 0 1`;
  }

  const parsed = parseFen(initialFen);
  const baseMs = Number(opts.clockMs || 3 * 60 * 1000);
  const incMs = Number(opts.incMs ?? 2000);
  const maxMoves = Number(opts.maxMoves || 80);

  return {
    game: variant,
    seed,
    seedCommit: commitSeed(seed),
    initialFen,
    fen: initialFen,
    board: parsed.board,
    turn: parsed.turn, // "w" | "b"
    castling: parsed.castling,
    ep: parsed.ep,
    halfmove: parsed.halfmove,
    fullmove: parsed.fullmove,
    clocksMs: [baseMs, baseMs],
    incMs,
    maxMoves,
    moves: [], // [{ ply, turn, san, uci, fen, lastFrom, lastTo }]
    positionCounts: { [positionKey(parsed)]: 1 },
    strikes: [0, 0],
    lastIllegal: null,
    phase: "playing", // "playing" | "finished"
    result: null,     // "1-0" | "0-1" | "1/2-1/2"
    reason: "",
    winnerIdx: null   // 0 | 1 | null (draw)
  };
}

export function sqName(col, row) {
  return FILES[col] + String(8 - row);
}

export function parseSq(s) {
  if (typeof s !== "string" || s.length !== 2) return null;
  const col = FILES.indexOf(s[0].toLowerCase());
  const rank = Number(s[1]);
  if (col < 0 || rank < 1 || rank > 8) return null;
  return { col, row: 8 - rank };
}

export function parseFen(fen) {
  const parts = String(fen).trim().split(/\s+/);
  const rows = parts[0].split("/");
  if (rows.length !== 8) throw new Error("Invalid FEN board.");
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (let r = 0; r < 8; r++) {
    let c = 0;
    for (const ch of rows[r]) {
      if (ch >= "1" && ch <= "8") {
        c += Number(ch);
      } else {
        board[r][c++] = ch;
      }
    }
  }
  return {
    board,
    turn: parts[1] === "b" ? "b" : "w",
    castling: parts[2] || "-",
    ep: parts[3] && parts[3] !== "-" ? parts[3] : null,
    halfmove: Number(parts[4] || 0),
    fullmove: Number(parts[5] || 1)
  };
}

export function serializeFen(pos) {
  const rows = [];
  for (let r = 0; r < 8; r++) {
    let line = "";
    let empty = 0;
    for (let c = 0; c < 8; c++) {
      const p = pos.board[r][c];
      if (!p) empty++;
      else {
        if (empty) { line += String(empty); empty = 0; }
        line += p;
      }
    }
    if (empty) line += String(empty);
    rows.push(line);
  }
  return `${rows.join("/")} ${pos.turn} ${pos.castling || "-"} ${pos.ep || "-"} ${pos.halfmove} ${pos.fullmove}`;
}

function positionKey(pos) {
  const f = serializeFen(pos).split(" ");
  return `${f[0]} ${f[1]} ${f[2]} ${f[3]}`;
}

function colorOf(p) {
  if (!p) return null;
  return p === p.toUpperCase() ? "w" : "b";
}

function cloneBoard(board) {
  return board.map((r) => r.slice());
}

function findKing(board, side) {
  const target = side === "w" ? "K" : "k";
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] === target) return { col: c, row: r };
    }
  }
  return null;
}

export function isSquareAttacked(board, col, row, bySide) {
  // Pawn attacks
  const pawnRow = bySide === "w" ? row + 1 : row - 1;
  const pawnChar = bySide === "w" ? "P" : "p";
  if (pawnRow >= 0 && pawnRow < 8) {
    if (col > 0 && board[pawnRow][col - 1] === pawnChar) return true;
    if (col < 7 && board[pawnRow][col + 1] === pawnChar) return true;
  }
  // Knight attacks
  const knightChar = bySide === "w" ? "N" : "n";
  const kJumps = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
  for (const [dr, dc] of kJumps) {
    const nr = row + dr, nc = col + dc;
    if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr][nc] === knightChar) return true;
  }
  // King attacks
  const kingChar = bySide === "w" ? "K" : "k";
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nr = row + dr, nc = col + dc;
      if (nr >= 0 && nr < 8 && nc >= 0 && nc < 8 && board[nr][nc] === kingChar) return true;
    }
  }
  // Orthogonal rays (R/Q)
  const rookChar = bySide === "w" ? "R" : "r";
  const queenChar = bySide === "w" ? "Q" : "q";
  for (const [dr, dc] of [[-1,0],[1,0],[0,-1],[0,1]]) {
    let nr = row + dr, nc = col + dc;
    while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
      const p = board[nr][nc];
      if (p) {
        if (p === rookChar || p === queenChar) return true;
        break;
      }
      nr += dr; nc += dc;
    }
  }
  // Diagonal rays (B/Q)
  const bishopChar = bySide === "w" ? "B" : "b";
  for (const [dr, dc] of [[-1,-1],[-1,1],[1,-1],[1,1]]) {
    let nr = row + dr, nc = col + dc;
    while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
      const p = board[nr][nc];
      if (p) {
        if (p === bishopChar || p === queenChar) return true;
        break;
      }
      nr += dr; nc += dc;
    }
  }
  return false;
}

export function inCheck(board, side) {
  const k = findKing(board, side);
  if (!k) return false;
  return isSquareAttacked(board, k.col, k.row, side === "w" ? "b" : "w");
}

function generatePseudoMoves(pos) {
  const moves = [];
  const { board, turn, castling, ep } = pos;
  const enemy = turn === "w" ? "b" : "w";
  const epSq = ep ? parseSq(ep) : null;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p || colorOf(p) !== turn) continue;
      const t = p.toLowerCase();

      if (t === "p") {
        const dir = turn === "w" ? -1 : 1;
        const startRow = turn === "w" ? 6 : 1;
        const promoRow = turn === "w" ? 0 : 7;
        const nr = r + dir;
        if (nr >= 0 && nr < 8 && !board[nr][c]) {
          if (nr === promoRow) {
            for (const pr of ["q", "r", "b", "n"]) moves.push({ fc: c, fr: r, tc: c, tr: nr, promo: pr });
          } else {
            moves.push({ fc: c, fr: r, tc: c, tr: nr });
            if (r === startRow && !board[r + dir * 2][c]) {
              moves.push({ fc: c, fr: r, tc: c, tr: r + dir * 2, doublePush: true });
            }
          }
        }
        for (const dc of [-1, 1]) {
          const nc = c + dc;
          if (nc < 0 || nc >= 8 || nr < 0 || nr >= 8) continue;
          const target = board[nr][nc];
          if (target && colorOf(target) === enemy) {
            if (nr === promoRow) {
              for (const pr of ["q", "r", "b", "n"]) moves.push({ fc: c, fr: r, tc: nc, tr: nr, promo: pr, capture: true });
            } else {
              moves.push({ fc: c, fr: r, tc: nc, tr: nr, capture: true });
            }
          } else if (epSq && epSq.col === nc && epSq.row === nr) {
            moves.push({ fc: c, fr: r, tc: nc, tr: nr, epCapture: true, capture: true });
          }
        }
      } else if (t === "n") {
        for (const [dr, dc] of [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]]) {
          const nr = r + dr, nc = c + dc;
          if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) continue;
          const target = board[nr][nc];
          if (!target || colorOf(target) === enemy) {
            moves.push({ fc: c, fr: r, tc: nc, tr: nr, capture: Boolean(target) });
          }
        }
      } else if (t === "b" || t === "r" || t === "q") {
        const dirs = [];
        if (t !== "b") dirs.push([-1,0],[1,0],[0,-1],[0,1]);
        if (t !== "r") dirs.push([-1,-1],[-1,1],[1,-1],[1,1]);
        for (const [dr, dc] of dirs) {
          let nr = r + dr, nc = c + dc;
          while (nr >= 0 && nr < 8 && nc >= 0 && nc < 8) {
            const target = board[nr][nc];
            if (!target) {
              moves.push({ fc: c, fr: r, tc: nc, tr: nr });
            } else {
              if (colorOf(target) === enemy) moves.push({ fc: c, fr: r, tc: nc, tr: nr, capture: true });
              break;
            }
            nr += dr; nc += dc;
          }
        }
      } else if (t === "k") {
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            if (!dr && !dc) continue;
            const nr = r + dr, nc = c + dc;
            if (nr < 0 || nr >= 8 || nc < 0 || nc >= 8) continue;
            const target = board[nr][nc];
            if (!target || colorOf(target) === enemy) {
              moves.push({ fc: c, fr: r, tc: nc, tr: nr, capture: Boolean(target) });
            }
          }
        }
        // Castling
        const homeRow = turn === "w" ? 7 : 0;
        if (r === homeRow && c === 4 && !isSquareAttacked(board, 4, homeRow, enemy)) {
          const kSide = turn === "w" ? "K" : "k";
          const qSide = turn === "w" ? "Q" : "q";
          if (castling.includes(kSide) && !board[homeRow][5] && !board[homeRow][6]) {
            if (!isSquareAttacked(board, 5, homeRow, enemy) && !isSquareAttacked(board, 6, homeRow, enemy)) {
              moves.push({ fc: 4, fr: homeRow, tc: 6, tr: homeRow, castle: "K" });
            }
          }
          if (castling.includes(qSide) && !board[homeRow][1] && !board[homeRow][2] && !board[homeRow][3]) {
            if (!isSquareAttacked(board, 3, homeRow, enemy) && !isSquareAttacked(board, 2, homeRow, enemy)) {
              moves.push({ fc: 4, fr: homeRow, tc: 2, tr: homeRow, castle: "Q" });
            }
          }
        }
      }
    }
  }
  return moves;
}

function stepMove(pos, m) {
  const b = cloneBoard(pos.board);
  const moving = b[m.fr][m.fc];
  b[m.fr][m.fc] = null;
  if (m.epCapture) {
    const capRow = pos.turn === "w" ? m.tr + 1 : m.tr - 1;
    b[capRow][m.tc] = null;
  }
  if (m.castle === "K") {
    b[m.fr][5] = b[m.fr][7];
    b[m.fr][7] = null;
  } else if (m.castle === "Q") {
    b[m.fr][3] = b[m.fr][0];
    b[m.fr][0] = null;
  }
  b[m.tr][m.tc] = m.promo ? (pos.turn === "w" ? m.promo.toUpperCase() : m.promo.toLowerCase()) : moving;

  let cast = pos.castling === "-" ? "" : pos.castling;
  if (moving === "K") cast = cast.replace(/[KQ]/g, "");
  if (moving === "k") cast = cast.replace(/[kq]/g, "");
  if ((m.fr === 7 && m.fc === 0) || (m.tr === 7 && m.tc === 0)) cast = cast.replace("Q", "");
  if ((m.fr === 7 && m.fc === 7) || (m.tr === 7 && m.tc === 7)) cast = cast.replace("K", "");
  if ((m.fr === 0 && m.fc === 0) || (m.tr === 0 && m.tc === 0)) cast = cast.replace("q", "");
  if ((m.fr === 0 && m.fc === 7) || (m.tr === 0 && m.tc === 7)) cast = cast.replace("k", "");

  const nextEp = m.doublePush ? sqName(m.fc, (m.fr + m.tr) / 2) : null;
  const resetHalf = moving.toLowerCase() === "p" || m.capture;
  return {
    board: b,
    turn: pos.turn === "w" ? "b" : "w",
    castling: cast || "-",
    ep: nextEp,
    halfmove: resetHalf ? 0 : pos.halfmove + 1,
    fullmove: pos.turn === "b" ? pos.fullmove + 1 : pos.fullmove
  };
}

export function generateLegalMoves(pos) {
  const pseudo = generatePseudoMoves(pos);
  const legal = [];
  for (const m of pseudo) {
    const next = stepMove(pos, m);
    if (!inCheck(next.board, pos.turn)) {
      const uci = sqName(m.fc, m.fr) + sqName(m.tc, m.tr) + (m.promo || "");
      legal.push({ ...m, uci, next });
    }
  }
  // Attach SAN labels with disambiguation
  for (const m of legal) {
    m.san = buildSan(pos, m, legal);
  }
  return legal;
}

function buildSan(pos, m, allLegal) {
  let s = "";
  if (m.castle === "K") s = "O-O";
  else if (m.castle === "Q") s = "O-O-O";
  else {
    const piece = pos.board[m.fr][m.fc];
    const t = piece.toUpperCase();
    if (t === "P") {
      if (m.capture) s = FILES[m.fc] + "x" + sqName(m.tc, m.tr);
      else s = sqName(m.tc, m.tr);
      if (m.promo) s += "=" + m.promo.toUpperCase();
    } else {
      const peers = allLegal.filter((o) =>
        o !== m &&
        pos.board[o.fr][o.fc] === piece &&
        o.tc === m.tc &&
        o.tr === m.tr
      );
      let dis = "";
      if (peers.length > 0) {
        const sameFile = peers.some((o) => o.fc === m.fc);
        const sameRank = peers.some((o) => o.fr === m.fr);
        if (!sameFile) dis = FILES[m.fc];
        else if (!sameRank) dis = String(8 - m.fr);
        else dis = sqName(m.fc, m.fr);
      }
      s = t + dis + (m.capture ? "x" : "") + sqName(m.tc, m.tr);
    }
  }
  if (inCheck(m.next.board, m.next.turn)) {
    const replies = generatePseudoMoves(m.next).some((rm) => !inCheck(stepMove(m.next, rm).board, m.next.turn));
    s += replies ? "+" : "#";
  }
  return s;
}

function normalizeSan(raw) {
  return String(raw || "")
    .trim()
    .replace(/0-0-0/g, "O-O-O")
    .replace(/0-0/g, "O-O")
    .replace(/[+#!?]+$/g, "");
}

function explainCastleRefusal(state, castleSide) {
  const homeRow = state.turn === "w" ? 7 : 0;
  const enemy = state.turn === "w" ? "b" : "w";
  if (inCheck(state.board, state.turn)) {
    return { reason: "Cannot castle while your King is in check.", attackedSquare: sqName(4, homeRow) };
  }
  const passCols = castleSide === "K" ? [5, 6] : [3, 2];
  for (const col of passCols) {
    if (state.board[homeRow][col]) {
      return { reason: `Square ${sqName(col, homeRow)} is occupied.`, attackedSquare: sqName(col, homeRow) };
    }
    if (isSquareAttacked(state.board, col, homeRow, enemy)) {
      return { reason: `Square ${sqName(col, homeRow)} is under enemy attack — King cannot pass through check.`, attackedSquare: sqName(col, homeRow) };
    }
  }
  return { reason: "Castling rights are no longer available.", attackedSquare: sqName(4, homeRow) };
}

function insufficientMaterial(board) {
  const minor = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      const t = p.toLowerCase();
      if (t === "p" || t === "r" || t === "q") return false;
      if (t === "n" || t === "b") minor.push(p);
    }
  }
  return minor.length <= 1;
}

export function legalChessActions(state) {
  if (state.phase === "finished") return [];
  return generateLegalMoves(state).map((m) => m.san);
}

export function applyChessAction(state, seatIdx, rawAction, elapsedMs = 0) {
  if (state.phase === "finished") {
    return { ok: false, error: "This Chess match has already finished." };
  }
  const expectedIdx = state.turn === "w" ? 0 : 1;
  if (seatIdx !== expectedIdx) {
    return { ok: false, error: "It is not your turn on the board." };
  }

  const legal = generateLegalMoves(state);
  const trimmed = String(rawAction || "").trim();
  const norm = normalizeSan(trimmed);
  const lower = trimmed.toLowerCase();

  const chosen = legal.find((m) =>
    m.uci === lower ||
    normalizeSan(m.san) === norm ||
    normalizeSan(m.san).toLowerCase() === norm.toLowerCase()
  );

  if (!chosen) {
    let detail = `Move "${trimmed}" is illegal in position ${state.fen}.`;
    let attackedSquare = null;
    if (norm === "O-O" || norm === "O-O-O") {
      const info = explainCastleRefusal(state, norm === "O-O" ? "K" : "Q");
      detail = `${detail} ${info.reason}`;
      attackedSquare = info.attackedSquare;
    }
    state.strikes[seatIdx] = (state.strikes[seatIdx] || 0) + 1;
    const strike = state.strikes[seatIdx];
    state.lastIllegal = { seatIdx, action: trimmed, strike, reason: detail, attackedSquare };

    if (strike >= 3) {
      state.phase = "finished";
      state.winnerIdx = 1 - seatIdx;
      state.result = seatIdx === 0 ? "0-1" : "1-0";
      state.reason = `Technical forfeit after 3 illegal move attempts (last: ${trimmed}).`;
      return { ok: false, forfeitedMatch: true, strike: 3, error: state.reason };
    }
    return {
      ok: false,
      strike,
      attackedSquare,
      legal_actions: legal.map((m) => m.san),
      error: `${detail} (Illegal strike ${strike}/3 — choose from legal_actions).`
    };
  }

  // Update clock
  if (elapsedMs > 0) {
    state.clocksMs[seatIdx] = Math.max(1000, state.clocksMs[seatIdx] - elapsedMs + state.incMs);
  }
  state.lastIllegal = null;

  const next = chosen.next;
  state.board = next.board;
  state.turn = next.turn;
  state.castling = next.castling;
  state.ep = next.ep;
  state.halfmove = next.halfmove;
  state.fullmove = next.fullmove;
  state.fen = serializeFen(state);

  const moveEntry = {
    ply: state.moves.length + 1,
    turn: seatIdx === 0 ? "w" : "b",
    san: chosen.san,
    uci: chosen.uci,
    from: sqName(chosen.fc, chosen.fr),
    to: sqName(chosen.tc, chosen.tr),
    fen: state.fen
  };
  state.moves.push(moveEntry);

  const pk = positionKey(state);
  state.positionCounts[pk] = (state.positionCounts[pk] || 0) + 1;

  const oppLegal = generateLegalMoves(state);
  let milestone = chosen.san.includes("+") ? "check" : null;
  if (chosen.capture && Math.abs(evaluateMaterial(state.board)) >= 500) {
    milestone = milestone || "major_capture";
  }

  if (oppLegal.length === 0) {
    state.phase = "finished";
    if (inCheck(state.board, state.turn)) {
      state.winnerIdx = seatIdx;
      state.result = seatIdx === 0 ? "1-0" : "0-1";
      state.reason = `Checkmate by ${chosen.san}.`;
    } else {
      state.winnerIdx = null;
      state.result = "1/2-1/2";
      state.reason = "Draw by stalemate.";
    }
    milestone = "finished";
  } else if (state.positionCounts[pk] >= 3) {
    state.phase = "finished";
    state.winnerIdx = null;
    state.result = "1/2-1/2";
    state.reason = "Draw by threefold repetition.";
    milestone = "finished";
  } else if (state.halfmove >= 100) {
    state.phase = "finished";
    state.winnerIdx = null;
    state.result = "1/2-1/2";
    state.reason = "Draw by 50-move rule.";
    milestone = "finished";
  } else if (insufficientMaterial(state.board)) {
    state.phase = "finished";
    state.winnerIdx = null;
    state.result = "1/2-1/2";
    state.reason = "Draw by insufficient material.";
    milestone = "finished";
  } else if (state.moves.length >= state.maxMoves * 2) {
    // Cap reached: adjudicate by material or declare draw
    state.phase = "finished";
    const diff = evaluateMaterial(state.board);
    if (Math.abs(diff) >= 300) {
      state.winnerIdx = diff > 0 ? 0 : 1;
      state.result = diff > 0 ? "1-0" : "0-1";
      state.reason = `Move cap (${state.maxMoves}) reached — adjudicated on clear material lead.`;
    } else {
      state.winnerIdx = null;
      state.result = "1/2-1/2";
      state.reason = `Draw on move cap (${state.maxMoves} moves).`;
    }
    milestone = "finished";
  }

  return {
    ok: true,
    move: moveEntry,
    milestone,
    summary: `${moveEntry.ply % 2 === 1 ? Math.ceil(moveEntry.ply / 2) + ". " : Math.ceil(moveEntry.ply / 2) + "... "}${chosen.san}`
  };
}

export function evaluateMaterial(board) {
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p) continue;
      const val = PIECE_VALUES[p.toLowerCase()] || 0;
      const centerBonus = (r >= 2 && r <= 5 && c >= 2 && c <= 5) ? 14 : 0;
      score += colorOf(p) === "w" ? (val + centerBonus) : -(val + centerBonus);
    }
  }
  return score;
}

export function chooseChessBotAction(state) {
  const legal = generateLegalMoves(state);
  if (!legal.length) return null;
  const sign = state.turn === "w" ? 1 : -1;
  let best = legal[0];
  let bestScore = -Infinity;

  for (const m of legal) {
    if (m.san.endsWith("#")) return { action: m.san, talk: "Checkmate!", thought: `Forced mate on the board with ${m.san}.` };
    let sc = sign * evaluateMaterial(m.next.board);
    if (m.san.includes("+")) sc += 35;
    if (m.castle) sc += 45;
    // Light 1-ply blunder guard: subtract worst hanging recapture
    const replies = generateLegalMoves(m.next);
    let worstReply = Infinity;
    for (const r of replies) {
      const after = sign * evaluateMaterial(r.next.board);
      if (after < worstReply) worstReply = after;
    }
    if (replies.length > 0) sc = worstReply;
    if (sc > bestScore) { bestScore = sc; best = m; }
  }
  return {
    action: best.san,
    talk: best.san.includes("+") ? "Check." : (best.capture ? "Clean exchange in the center." : "Developing pieces."),
    thought: `2-ply tactical evaluation (${(bestScore / 100).toFixed(1)} pawns) selects ${best.san}.`
  };
}
