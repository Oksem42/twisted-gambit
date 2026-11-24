(function () {
// Jules: a searching chess engine for Gerasimos Gambit.
// Alpha-beta negamax with iterative deepening, quiescence search, a transposition table, killer and
// history move ordering, null-move pruning and late-move reductions, plus knowledge of every game mode.
// Jules plays fair: it only uses what its own side can see (its own secrets, the opponent's visible pieces).
const E = globalThis.TGEngine;

const MATE = 100000, WIN = 90000, INF = 1000000;
const TYPE = { P: 1, N: 2, B: 3, R: 4, Q: 5, K: 6, S: 5, X: 7 }; // the Snake moves like a queen; X = a wall
const LETTER = ['', 'P', 'N', 'B', 'R', 'Q', 'K'];
const VAL = [0, 100, 320, 330, 500, 900, 20000, 0];
const PHASE = [0, 0, 1, 1, 2, 4, 0, 0];

// Piece-square tables from White's point of view, a8..h8 first.
const PST = [null,
  [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0],
  [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50],
  [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20],
  [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0],
  [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20],
];
const KMG = [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
  -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20];
const KEG = [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50];
const tbl = (s, c) => (c > 0 ? (7 - (s >> 3)) * 8 + (s & 7) : (s >> 3) * 8 + (s & 7));

// ---------------------------------------------------------------- geometry
const KN = [], KG = [], RAYS = [];
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
for (let s = 0; s < 64; s++) {
  const f = s & 7, r = s >> 3;
  KN[s] = []; KG[s] = [];
  for (const [df, dr] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]) {
    const ff = f + df, rr = r + dr;
    if (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) KN[s].push(rr * 8 + ff);
  }
  for (const [df, dr] of DIRS) {
    const ff = f + df, rr = r + dr;
    if (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) KG[s].push(rr * 8 + ff);
  }
  RAYS[s] = DIRS.map(([df, dr]) => {
    const out = [];
    let ff = f + df, rr = r + dr;
    while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) { out.push(rr * 8 + ff); ff += df; rr += dr; }
    return out;
  });
}

function attacked(b, sq, by) {
  const f = sq & 7;
  if (by > 0) {
    if (f > 0 && sq >= 9 && b[sq - 9] === 1) return true;
    if (f < 7 && sq >= 7 && b[sq - 7] === 1) return true;
  } else {
    if (f > 0 && sq + 7 < 64 && b[sq + 7] === -1) return true;
    if (f < 7 && sq + 9 < 64 && b[sq + 9] === -1) return true;
  }
  const n = 2 * by, k = 6 * by, bi = 3 * by, ro = 4 * by, q = 5 * by;
  for (const t of KN[sq]) if (b[t] === n) return true;
  for (const t of KG[sq]) if (b[t] === k) return true;
  const rays = RAYS[sq];
  for (let d = 0; d < 8; d++) {
    const a = d < 4 ? ro : bi;
    for (const t of rays[d]) {
      const v = b[t];
      if (v) { if (v === a || v === q) return true; break; }
    }
  }
  return false;
}

// ---------------------------------------------------------------- moves: from | to<<6 | promo<<12 | flag<<15
// flag: 1 en passant, 2 castle, 4 double pawn step
const enc = (from, to, promo = 0, flag = 0) => from | (to << 6) | (promo << 12) | (flag << 15);
const mFrom = (m) => m & 63, mTo = (m) => (m >> 6) & 63, mPromo = (m) => (m >> 12) & 7, mFlag = (m) => (m >> 15) & 7;

function gen(S, out, capsOnly) {
  const b = S.b, us = S.side;
  for (let s = 0; s < 64; s++) {
    const v = b[s];
    if (!v || (v > 0) !== (us > 0)) continue;
    const t = v > 0 ? v : -v;
    if (t === 7) continue; // walls never move
    if (t === 1) {
      const dir = us > 0 ? 8 : -8, r = s >> 3, f = s & 7, pre = us > 0 ? 6 : 1, start = us > 0 ? 1 : 6;
      const to = s + dir;
      if (to >= 0 && to < 64 && !b[to]) {
        if (r === pre) { out.push(enc(s, to, 5), enc(s, to, 2), enc(s, to, 4), enc(s, to, 3)); }
        else if (!capsOnly) {
          out.push(enc(s, to));
          if (r === start && !b[to + dir]) out.push(enc(s, to + dir, 0, 4));
        }
      }
      for (const df of [-1, 1]) {
        if (f + df < 0 || f + df > 7) continue;
        const c = to + df;
        if (c < 0 || c > 63) continue;
        const w = b[c];
        if (w && (w > 0) !== (us > 0)) {
          if (r === pre) out.push(enc(s, c, 5), enc(s, c, 2), enc(s, c, 4), enc(s, c, 3));
          else out.push(enc(s, c));
        } else if (!w && c === S.ep) out.push(enc(s, c, 0, 1));
      }
    } else if (t === 2 || t === 6) {
      for (const to of (t === 2 ? KN[s] : KG[s])) {
        const w = b[to];
        if (!w ? !capsOnly : (w > 0) !== (us > 0)) out.push(enc(s, to));
      }
      if (t === 6 && !capsOnly) {
        const them = -us;
        if (us > 0 && s === 4) {
          if ((S.castle & 1) && !b[5] && !b[6] && b[7] === 4 && !attacked(b, 4, them) && !attacked(b, 5, them) && !attacked(b, 6, them)) out.push(enc(4, 6, 0, 2));
          if ((S.castle & 2) && !b[1] && !b[2] && !b[3] && b[0] === 4 && !attacked(b, 4, them) && !attacked(b, 3, them) && !attacked(b, 2, them)) out.push(enc(4, 2, 0, 2));
        } else if (us < 0 && s === 60) {
          if ((S.castle & 4) && !b[61] && !b[62] && b[63] === -4 && !attacked(b, 60, them) && !attacked(b, 61, them) && !attacked(b, 62, them)) out.push(enc(60, 62, 0, 2));
          if ((S.castle & 8) && !b[57] && !b[58] && !b[59] && b[56] === -4 && !attacked(b, 60, them) && !attacked(b, 59, them) && !attacked(b, 58, them)) out.push(enc(60, 58, 0, 2));
        }
      }
    } else {
      const d0 = t === 3 ? 4 : 0, d1 = t === 4 ? 4 : 8;
      for (let d = d0; d < d1; d++) {
        for (const to of RAYS[s][d]) {
          const w = b[to];
          if (!w) { if (!capsOnly) out.push(enc(s, to)); }
          else { if ((w > 0) !== (us > 0)) out.push(enc(s, to)); break; }
        }
      }
    }
  }
}

function make(S, m) {
  const b = S.b, from = mFrom(m), to = mTo(m), promo = mPromo(m), flag = mFlag(m);
  const u = { ch: [], castle: S.castle, ep: S.ep, side: S.side, shift: S.shift, kW: S.kW, kB: S.kB, cap: 0, botCap: 0, boom: 0, mine: -1, promos: S.promos, qp: S.qp };
  const set = (sq, v) => { u.ch.push(sq, b[sq]); b[sq] = v; };
  const v = b[from], us = v > 0 ? 1 : -1, t = v * us;
  let capSq = to, cap = b[to];
  if (flag & 1) { capSq = to - 8 * us; cap = b[capSq]; set(capSq, 0); }
  set(from, 0);
  set(to, promo ? promo * us : v);
  if (flag & 2) {
    if (to === 6) { set(7, 0); set(5, 4); } else if (to === 2) { set(0, 0); set(3, 4); }
    else if (to === 62) { set(63, 0); set(61, -4); } else { set(56, 0); set(59, -4); }
  }
  if (t === 6) { if (us > 0) S.kW = to; else S.kB = to; S.castle &= us > 0 ? ~3 : ~12; }
  if (from === 0 || to === 0) S.castle &= ~2;
  if (from === 7 || to === 7) S.castle &= ~1;
  if (from === 56 || to === 56) S.castle &= ~8;
  if (from === 63 || to === 63) S.castle &= ~4;
  S.ep = (flag & 4) ? from + 8 * us : -1;
  const capT = cap ? (cap > 0 ? cap : -cap) : 0;
  u.cap = capT;
  if (us === S.bot) {
    if (capT) { S.caps[capT]++; u.botCap = capT; if (capT === 5 && t === 1) S.qp++; }
    if (promo) S.promos++;
    if (from === S.shift) {
      S.shift = to;
      if (capT) { let nt = capT; if (nt === 1 && (to >> 3) === (us > 0 ? 7 : 0)) nt = 5; set(to, nt * us); }
    }
  } else {
    if (capT && capSq === S.shift) S.shift = -1;
    if (S.mines[to] && t !== 6) { // stepped on one of Jules's mines
      u.mine = to; S.mines[to] = 0;
      u.boom = promo || t; S.caps[u.boom]++;
      set(to, 0);
    }
  }
  S.side = -us;
  return u;
}

function unmake(S, u) {
  const b = S.b, ch = u.ch;
  for (let i = ch.length - 2; i >= 0; i -= 2) b[ch[i]] = ch[i + 1];
  S.castle = u.castle; S.ep = u.ep; S.side = u.side; S.shift = u.shift; S.kW = u.kW; S.kB = u.kB;
  if (u.botCap) S.caps[u.botCap]--;
  if (u.boom) S.caps[u.boom]--;
  if (u.mine >= 0) S.mines[u.mine] = 1;
  S.promos = u.promos; S.qp = u.qp;
}

const kingSq = (S, c) => (c > 0 ? S.kW : S.kB);
const inCheck = (S, c) => attacked(S.b, kingSq(S, c), -c);
/** make + legality: returns the undo record, or null if the move leaves the mover's king in check. */
function play(S, m) {
  const u = make(S, m);
  if (inCheck(S, -S.side)) { unmake(S, u); return null; }
  return u;
}

// ---------------------------------------------------------------- hashing / transposition table
const Z1 = new Int32Array(13 * 64 + 16 + 64 + 64 + 2), Z2 = new Int32Array(Z1.length);
for (let i = 0; i < Z1.length; i++) { Z1[i] = (Math.random() * 0x100000000) | 0; Z2[i] = (Math.random() * 0x100000000) | 0; }
function hash(S) {
  let h1 = 0, h2 = 0;
  const b = S.b;
  for (let s = 0; s < 64; s++) {
    const v = b[s];
    if (v) { const i = (v + 6) * 64 + s; h1 ^= Z1[i]; h2 ^= Z2[i]; }
    if (S.mines[s]) { h1 ^= Z1[832 + 16 + s]; h2 ^= Z2[832 + 16 + s]; }
  }
  h1 ^= Z1[832 + S.castle]; h2 ^= Z2[832 + S.castle];
  if (S.ep >= 0) { h1 ^= Z1[832 + 80 + S.ep]; h2 ^= Z2[832 + 80 + S.ep]; }
  if (S.side < 0) { h1 ^= Z1[Z1.length - 1]; h2 ^= Z2[Z2.length - 1]; }
  return [h1, h2];
}
const TT_BITS = 20, TT_MASK = (1 << TT_BITS) - 1;
const ttKey = new Int32Array(1 << TT_BITS), ttMove = new Int32Array(1 << TT_BITS), ttScore = new Int32Array(1 << TT_BITS);
const ttDepth = new Int8Array(1 << TT_BITS), ttFlag = new Int8Array(1 << TT_BITS); // flag 0 empty, 1 exact, 2 lower, 3 upper

// ---------------------------------------------------------------- game modes
const inEnemyHalf = (c, s) => (c > 0 ? (s >> 3) >= 4 : (s >> 3) <= 3);
const OBJ = {
  bishops: [2, (S) => S.caps[3]], knights: [2, (S) => S.caps[2]], rooks: [2, (S) => S.caps[4]],
  queenPawn: [1, (S) => S.qp], promote: [1, (S) => S.promos],
  knightRaid: [1, (S) => { const last = S.bot > 0 ? 7 : 0; for (let f = 0; f < 8; f++) if (S.b[last * 8 + f] === 2 * S.bot) return 1; return 0; }],
  kingMarch: [1, (S) => (inEnemyHalf(S.bot, kingSq(S, S.bot)) ? 1 : 0)],
  center: [4, (S) => [27, 28, 35, 36].filter((s) => S.b[s] && (S.b[s] > 0) === (S.bot > 0)).length],
  pawnHunter: [6, (S) => S.caps[1]],
  butcher: [8, (S) => S.caps[1] + S.caps[2] + S.caps[3] + S.caps[4] + S.caps[5]],
};

// ---------------------------------------------------------------- evaluation (side to move's point of view)
function evaluate(S) {
  const b = S.b;
  let mat = 0, pos = 0, eg = 0, phase = 0, wb = 0, bb = 0;
  for (let s = 0; s < 64; s++) {
    const v = b[s];
    if (!v) continue;
    const c = v > 0 ? 1 : -1, t = v * c;
    if (t >= 6) continue;
    mat += c * VAL[t];
    pos += c * PST[t][tbl(s, c)];
    phase += PHASE[t];
    if (t === 1) { const adv = c > 0 ? (s >> 3) - 1 : 6 - (s >> 3); eg += c * adv * adv * 5; }
    if (t === 3) { if (c > 0) wb++; else bb++; }
  }
  if (phase > 24) phase = 24;
  const wk = S.kW, bk = S.kB;
  const kmg = KMG[tbl(wk, 1)] - KMG[tbl(bk, -1)];
  const keg = KEG[tbl(wk, 1)] - KEG[tbl(bk, -1)];
  let score = mat + pos + ((kmg * phase + keg * (24 - phase)) / 24) | 0;
  score += ((eg * (24 - phase)) / 24) | 0;
  if (wb >= 2) score += 30;
  if (bb >= 2) score -= 30;
  if (phase <= 10 && Math.abs(mat) >= 300) { // mop-up: drive the losing king to the edge, bring ours close
    const loser = mat > 0 ? bk : wk, winner = mat > 0 ? wk : bk, sgn = mat > 0 ? 1 : -1;
    const lf = loser & 7, lr = loser >> 3;
    const centerDist = Math.max(3 - lf, lf - 4) + Math.max(3 - lr, lr - 4);
    const kd = Math.max(Math.abs(lf - (winner & 7)), Math.abs(lr - (winner >> 3)));
    score += sgn * (centerDist * 12 + (7 - kd) * 6);
  }
  if (S.obj) score += S.bot * Math.min(1, S.obj[1](S) / S.obj[0]) * 160;
  return score * S.side;
}

// ---------------------------------------------------------------- search
const STOP = { stop: true };
let deadline = 0, nodes = 0;
const killers = [];
const hist = new Int32Array(64 * 64);

function objectiveScore(S, ply) {
  if (!S.obj || S.obj[1](S) < S.obj[0]) return null;
  return S.side === S.bot ? WIN - ply : -(WIN - ply);
}

function orderMoves(S, moves, ttm, ply) {
  const b = S.b, k = killers[ply] || [];
  const score = new Map();
  for (const m of moves) {
    let sc;
    if (m === ttm) sc = 1e9;
    else {
      const cap = b[mTo(m)], promo = mPromo(m);
      if (cap || (mFlag(m) & 1)) sc = 1e8 + (cap ? VAL[Math.abs(cap)] : 100) * 10 - VAL[Math.abs(b[mFrom(m)])] / 10;
      else if (promo) sc = 9e7 + VAL[promo];
      else if (m === k[0]) sc = 8e7;
      else if (m === k[1]) sc = 7e7;
      else sc = hist[(m & 4095)];
    }
    score.set(m, sc);
  }
  moves.sort((a, c) => score.get(c) - score.get(a));
}

function qsearch(S, alpha, beta, ply) {
  if ((++nodes & 2047) === 0 && Date.now() > deadline) throw STOP;
  const o = objectiveScore(S, ply);
  if (o !== null) return o;
  const stand = evaluate(S);
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  if (ply > 40) return stand;
  const moves = [];
  gen(S, moves, true);
  orderMoves(S, moves, 0, ply);
  for (const m of moves) {
    const cap = S.b[mTo(m)];
    if (cap && !mPromo(m) && stand + VAL[Math.abs(cap)] + 200 < alpha) continue; // delta pruning
    const u = play(S, m);
    if (!u) continue;
    const sc = -qsearch(S, -beta, -alpha, ply + 1);
    unmake(S, u);
    if (sc >= beta) return sc;
    if (sc > alpha) alpha = sc;
  }
  return alpha;
}

function hasPieces(S, c) {
  for (let s = 0; s < 64; s++) { const v = S.b[s] * c; if (v > 1 && v < 6) return true; }
  return false;
}

function search(S, depth, alpha, beta, ply, allowNull) {
  if ((++nodes & 2047) === 0 && Date.now() > deadline) throw STOP;
  const o = objectiveScore(S, ply);
  if (o !== null) return o;
  const check = inCheck(S, S.side);
  if (check) depth++;
  if (depth <= 0) return qsearch(S, alpha, beta, ply);

  const [h1, h2] = hash(S);
  const ti = h1 & TT_MASK;
  let ttm = 0;
  if (ttFlag[ti] && ttKey[ti] === h2) {
    ttm = ttMove[ti];
    if (ttDepth[ti] >= depth && ply > 0) {
      let sc = ttScore[ti];
      if (sc > MATE - 1000) sc -= ply; else if (sc < -MATE + 1000) sc += ply;
      const fl = ttFlag[ti];
      if (fl === 1 || (fl === 2 && sc >= beta) || (fl === 3 && sc <= alpha)) return sc;
    }
  }

  if (allowNull && !check && depth >= 3 && hasPieces(S, S.side) && evaluate(S) >= beta) {
    const ep = S.ep; S.ep = -1; S.side = -S.side;
    let sc;
    try { sc = -search(S, depth - 3, -beta, -beta + 1, ply + 1, false); } finally { S.side = -S.side; S.ep = ep; }
    if (sc >= beta) return sc;
  }

  const moves = [];
  gen(S, moves, false);
  orderMoves(S, moves, ttm, ply);
  const a0 = alpha;
  let best = -INF, bestMove = 0, legal = 0;
  for (const m of moves) {
    const u = play(S, m);
    if (!u) continue;
    legal++;
    const quiet = !mPromo(m) && !(mFlag(m) & 1) && !u.cap;
    let sc;
    if (legal > 4 && depth >= 3 && quiet && !check && !inCheck(S, S.side)) {
      sc = -search(S, depth - 2, -alpha - 1, -alpha, ply + 1, true); // reduced
      if (sc > alpha) sc = -search(S, depth - 1, -beta, -alpha, ply + 1, true);
    } else {
      sc = -search(S, depth - 1, -beta, -alpha, ply + 1, true);
    }
    unmake(S, u);
    if (sc > best) { best = sc; bestMove = m; }
    if (sc > alpha) alpha = sc;
    if (alpha >= beta) {
      if (quiet) {
        const k = killers[ply] || (killers[ply] = [0, 0]);
        if (k[0] !== m) { k[1] = k[0]; k[0] = m; }
        hist[m & 4095] += depth * depth;
      }
      break;
    }
  }
  if (!legal) return check ? -(MATE - ply) : 0;

  let store = best;
  if (store > MATE - 1000) store += ply; else if (store < -MATE + 1000) store -= ply;
  ttKey[ti] = h2; ttMove[ti] = bestMove; ttScore[ti] = store; ttDepth[ti] = Math.min(depth, 127);
  ttFlag[ti] = best <= a0 ? 3 : best >= beta ? 2 : 1;
  return best;
}

/** Iterative deepening over the given root moves. Returns { move, score, depth } (move may be null). */
function rootSearch(S, rootMoves, ms) {
  deadline = Date.now() + ms;
  nodes = 0;
  killers.length = 0;
  hist.fill(0);
  let order = rootMoves.slice(), best = order[0] || null, bestScore = -INF, depthDone = 0;
  for (let depth = 1; depth <= 30; depth++) {
    const scores = new Map();
    let alpha = -INF, iterBest = null, iterScore = -INF;
    try {
      for (const m of order) {
        const u = play(S, m);
        if (!u) continue;
        let sc;
        try {
          if (iterBest === null) sc = -search(S, depth - 1, -INF, INF, 1, true);
          else {
            sc = -search(S, depth - 1, -alpha - 1, -alpha, 1, true);
            if (sc > alpha) sc = -search(S, depth - 1, -INF, -alpha, 1, true);
          }
        } finally { unmake(S, u); }
        scores.set(m, sc);
        if (sc > iterScore) { iterScore = sc; iterBest = m; }
        if (sc > alpha) alpha = sc;
      }
    } catch (e) {
      if (e !== STOP) throw e;
      if (iterBest !== null && iterBest === order[0]) { best = iterBest; } // first move done: keep the previous best's refreshed result
      else if (iterBest !== null && iterScore > bestScore) { best = iterBest; bestScore = iterScore; }
      break;
    }
    if (iterBest === null) break;
    best = iterBest; bestScore = iterScore; depthDone = depth;
    order.sort((a, c) => (scores.has(c) ? scores.get(c) : -INF) - (scores.has(a) ? scores.get(a) : -INF));
    if (Math.abs(bestScore) > MATE - 500 || Math.abs(bestScore) > WIN - 500) break; // forced result found
    if (Date.now() > deadline - ms * 0.45) break; // the next depth wouldn't finish
  }
  return { move: best, score: bestScore, depth: depthDone };
}

// ---------------------------------------------------------------- Gambler's Gambit: expectimax over the spins
const SPIN_VAL = [0, 1, 3, 3, 5, 9, 0];
const COIN_CP = 30; // what one coin is worth to Jules, in centipawns
const spinP = (a, d) => (a === 6 ? 1 : SPIN_VAL[a] / (SPIN_VAL[a] + SPIN_VAL[d]));

/** The attacker loses its spin: it disappears, and its side moves again if that exposed the king. */
function makeLose(S, m, us) {
  const from = mFrom(m);
  const u = { ch: [from, S.b[from]], castle: S.castle, ep: S.ep, side: S.side, shift: S.shift, kW: S.kW, kB: S.kB, cap: 0, botCap: 0, boom: 0, mine: -1, promos: S.promos, qp: S.qp };
  S.b[from] = 0;
  if (from === 0) S.castle &= ~2;
  if (from === 7) S.castle &= ~1;
  if (from === 56) S.castle &= ~8;
  if (from === 63) S.castle &= ~4;
  S.ep = -1;
  S.side = inCheck(S, us) ? us : -us;
  return u;
}

/** Leaf score: the position plus half of the best capture gamble available. */
function gambleLeaf(S) {
  const stand = evaluate(S), caps = [];
  gen(S, caps, true);
  let bestEv = 0;
  for (const m of caps) {
    const a = Math.abs(S.b[mFrom(m)]), d = Math.abs(S.b[mTo(m)]);
    if (!d || d === 6) continue;
    const p = spinP(a, d), ev = p * VAL[d] - (a === 6 ? 0 : (1 - p) * VAL[a]);
    if (ev > bestEv) bestEv = ev;
  }
  return stand + bestEv / 2;
}

/** The value of move `m` for the side to move, or null if it's illegal. Captures average both spin outcomes. */
function gambleMove(S, m, depth, alpha, beta, ply) {
  const us = S.side, from = mFrom(m), to = mTo(m);
  const capSq = (mFlag(m) & 1) ? to - 8 * us : to;
  const a = Math.abs(S.b[from]), d = Math.abs(S.b[capSq]);
  if (d === 6) return null; // kings are never captured
  const u = play(S, m);
  if (!u) return null;
  if (!d || a === 6) {
    const sc = -gambleSearch(S, depth - 1, -beta, -alpha, ply + 1);
    unmake(S, u);
    return sc + COIN_CP * (1 + SPIN_VAL[d]);
  }
  const win = -gambleSearch(S, depth - 1, -INF, INF, ply + 1);
  unmake(S, u);
  const ul = makeLose(S, m, us);
  const sign = S.side === us ? 1 : -1;
  const lose = sign * gambleSearch(S, depth - 1, -INF, INF, ply + 1);
  unmake(S, ul);
  const p = spinP(a, d);
  return p * (win + COIN_CP * (1 + SPIN_VAL[d])) + (1 - p) * (lose + COIN_CP * 2);
}

function gambleSearch(S, depth, alpha, beta, ply) {
  if ((++nodes & 1023) === 0 && Date.now() > deadline) throw STOP;
  const check = inCheck(S, S.side);
  if (ply > 24) return evaluate(S);
  if (depth <= 0) { if (!check) return gambleLeaf(S); depth = 1; }
  const moves = [];
  gen(S, moves, false);
  orderMoves(S, moves, 0, ply);
  let best = -INF, legal = 0;
  for (const m of moves) {
    const sc = gambleMove(S, m, depth, alpha, beta, ply);
    if (sc === null) continue;
    legal++;
    if (sc > best) best = sc;
    if (sc > alpha) alpha = sc;
    if (alpha >= beta) break;
  }
  return legal ? best : (check ? -(MATE - ply) : 0);
}

function gambleChoose(G, ms) {
  const botColor = G.turn, us = colorOf(botColor), keys = legalKeys(G), all = [];
  gen(fromGame(G, botColor), all, false);
  const moves = all.filter((m) => keys.has(m & 4095) && (!mPromo(m) || mPromo(m) === 5 || mPromo(m) === 2));
  const buys = [];
  for (const piece of Object.keys(E.PRICES)) {
    if (G.coins[botColor] < E.PRICES[piece]) continue;
    const t = TYPE[piece];
    const spots = E.legalDrops(G, botColor, piece).sort((a, b) => PST[t][tbl(b, us)] - PST[t][tbl(a, us)]).slice(0, 6);
    for (const sq of spots) buys.push({ piece, sq, t });
  }
  if (!moves.length && !buys.length) return null;
  deadline = Date.now() + ms;
  nodes = 0;
  killers.length = 0;
  hist.fill(0);
  let best = moves.length ? { type: 'move', move: toGameMove(moves[0]) } : { type: 'buy', piece: buys[0].piece, sq: buys[0].sq };
  try {
    for (let depth = 1; depth <= 12; depth++) {
      const started = Date.now();
      const S = fromGame(G, botColor);
      let alpha = -INF, top = null;
      for (const m of moves) {
        const sc = gambleMove(S, m, depth, alpha, INF, 0);
        if (sc !== null && sc > alpha) { alpha = sc; top = { type: 'move', move: toGameMove(m) }; }
      }
      for (const b of buys) {
        S.b[b.sq] = b.t * us;
        const ep = S.ep;
        S.ep = -1; S.side = -us;
        const sc = -gambleSearch(S, depth - 1, -INF, INF, 1) - COIN_CP * (E.PRICES[b.piece] + 1);
        S.b[b.sq] = 0; S.side = us; S.ep = ep;
        if (sc > alpha) { alpha = sc; top = { type: 'buy', piece: b.piece, sq: b.sq }; }
      }
      if (top) best = top;
      if (Math.abs(alpha) > MATE - 500) break;
      if (Date.now() + (Date.now() - started) * 3 > deadline) break; // the next depth wouldn't finish
    }
  } catch (e) { if (e !== STOP) throw e; }
  return best;
}

// ---------------------------------------------------------------- bridge to the game
const colorOf = (c) => (c === E.W ? 1 : -1);

/** The position as `botColor` sees it: its own pieces as they really are, the opponent's as they look. */
function fromGame(G, botColor) {
  const bot = colorOf(botColor);
  const S = {
    b: new Int8Array(64), side: colorOf(G.turn), castle: 0, ep: G.ep == null ? -1 : G.ep, kW: -1, kB: -1, bot,
    mines: new Uint8Array(64), shift: -1, caps: new Int16Array(7), qp: 0, promos: G.stats[botColor].promotions, obj: null,
  };
  G.board.forEach((p, i) => {
    if (!p) return;
    const t = TYPE[p.owner === botColor ? p.type : (p.shown || p.type)];
    S.b[i] = (t === 7 ? bot : colorOf(p.owner)) * t; // walls count as Jules's own, so it never tries to take one
    if (t === 6) { if (p.owner === E.W) S.kW = i; else S.kB = i; }
  });
  const unmoved = (i, owner, type) => { const p = G.board[i]; return p && p.owner === owner && (p.owner === botColor ? p.type : p.shown) === type && !p.moved; };
  if (unmoved(4, E.W, 'K')) { if (unmoved(7, E.W, 'R')) S.castle |= 1; if (unmoved(0, E.W, 'R')) S.castle |= 2; }
  if (unmoved(60, E.B, 'K')) { if (unmoved(63, E.B, 'R')) S.castle |= 4; if (unmoved(56, E.B, 'R')) S.castle |= 8; }
  if (G.twists.mines) for (const i of G.mines[botColor]) S.mines[i] = 1;
  if (G.twists.shifter) { const f = E.findById(G, G.shifter[botColor]); if (f) S.shift = f.sq; }
  for (const x of G.captured[botColor]) if (x.owner !== botColor) {
    S.caps[TYPE[x.type]]++;
    if (x.type === 'Q' && x.by === 'P') S.qp++;
  }
  if (G.twists.objective && G.objectives[botColor]) S.obj = OBJ[G.objectives[botColor]];
  return S;
}

/** Normal moves the real rules allow for the side to move, keyed by from/to/promotion. */
function legalKeys(G) {
  const keys = new Set();
  G.board.forEach((p, i) => {
    if (p && p.owner === G.turn) for (const m of E.legalMoves(G, i)) keys.add(m.from | (m.to << 6));
  });
  return keys;
}
function toGameMove(m) {
  const mv = { from: mFrom(m), to: mTo(m) };
  if (mPromo(m)) mv.promo = LETTER[mPromo(m)];
  return mv;
}

/** Score an action applied with the real rules, searched `depth` plies further (bot's point of view). */
function scoreAction(G, botColor, apply, depth) {
  const g = structuredClone(G);
  try { apply(g); } catch { return -INF; }
  if (g.result) return g.result.winner === botColor ? WIN : g.result.winner ? -WIN : 0;
  const S = fromGame(g, botColor);
  const sc = search(S, Math.max(0, depth), -INF, INF, 1, true);
  return S.side === S.bot ? sc : -sc;
}

function chooseAction(G, opts = {}) {
  const botColor = G.turn, ms = Math.max(150, opts.ms || 1500);
  if (G.twists.gambler) return gambleChoose(G, ms);
  const S = fromGame(G, botColor);
  const keys = legalKeys(G);
  const all = [];
  gen(S, all, false);
  const rootMoves = all.filter((m) => keys.has(m & 4095) && (!mPromo(m) || mPromo(m) === 5 || mPromo(m) === 2));
  const t0 = Date.now();
  const hasSpecial = (G.twists.traitor && G.traitor[botColor] && !G.traitor[botColor].used) || E.canSwap(G, botColor);
  let res = rootMoves.length ? rootSearch(S, rootMoves, ms * (hasSpecial ? 0.55 : 0.8)) : { move: null, score: -INF, depth: 0 };
  let action = res.move !== null ? { type: 'move', move: toGameMove(res.move) } : null;

  // Special moves (the traitor, identity swaps) are scored at the same shallow depth as the best
  // normal move, so the comparison is fair, and only win out when clearly better.
  if (hasSpecial) {
    deadline = t0 + ms;
    const depth = Math.min(3, Math.max(1, res.depth - 2));
    try {
      let bestScore = action ? scoreAction(G, botColor, (g) => E.makeMove(g, action.move), depth) : -INF;
      const tr = G.traitor[botColor];
      if (G.twists.traitor && tr && !tr.used) {
        const f = E.findById(G, tr.id);
        if (f) for (const m of E.legalMoves(G, f.sq, { traitor: true })) {
          const mv = { from: m.from, to: m.to, traitor: true };
          if (m.promo) mv.promo = 'Q';
          const sc = scoreAction(G, botColor, (g) => E.makeMove(g, mv), depth);
          if (sc > bestScore + 40) { bestScore = sc; action = { type: 'move', move: mv }; }
        }
      }
      if (E.canSwap(G, botColor)) {
        const mine = G.board.map((p, i) => [p, i]).filter(([p]) => p && p.owner === botColor && p.type !== 'K');
        for (let i = 0; i < mine.length; i++) for (let j = i + 1; j < mine.length; j++) {
          if (Math.abs(VAL[TYPE[mine[i][0].type]] - VAL[TYPE[mine[j][0].type]]) < 200) continue;
          const a = mine[i][1], c = mine[j][1];
          const sc = scoreAction(G, botColor, (g) => E.doSwap(g, a, c), depth);
          if (sc > bestScore + 80) { bestScore = sc; action = { type: 'swap', a, b: c }; }
        }
      }
    } catch (e) { if (e !== STOP) throw e; }
  }

  if (G.twists.powers) { const pw = choosePower(G, botColor, action, ms); if (pw) action = pw; }
  if (!action) return null;

  // Prophecy: predict the reply Jules's own analysis expects.
  if (action.type === 'move' && E.prophecyReady(G, botColor) && G.bonusPending !== botColor && G.bonusNow !== botColor) {
    try {
      const g = structuredClone(G);
      E.makeMove(g, action.move);
      if (!g.result && g.turn !== botColor) {
        const S2 = fromGame(g, botColor);
        const keys2 = legalKeys(g);
        const replies = [];
        gen(S2, replies, false);
        const rm = replies.filter((m) => keys2.has(m & 4095) && (!mPromo(m) || mPromo(m) === 5));
        const r = rootSearch(S2, rm, Math.min(400, ms * 0.25));
        if (r.move !== null) action.move.prophecy = { from: mFrom(r.move), to: mTo(r.move) };
      }
    } catch { /* no prophecy this time */ }
  }
  return action;
}

// ---------------------------------------------------------------- Power Chess
const PRIZE_CP = { snake: 700, asteroids: 220, tug: 110 }; // what winning each minigame is worth to Jules
/** Compare the chosen move with every power Jules holds, each searched with the real rules. */
function choosePower(G, botColor, action, ms) {
  deadline = Date.now() + Math.max(250, ms * 0.5);
  let best = null, bestScore = -INF;
  try {
    if (action) bestScore = scoreAction(G, botColor, (g) => (action.type === 'swap' ? E.doSwap(g, action.a, action.b) : E.makeMove(g, action.move)), 1);
    const pass = scoreAction(G, botColor, (g) => { g.turn = E.other(botColor); }, 1);
    for (let k = 0; k < 3; k++) {
      const opts = E.powerOptions(G, botColor, k);
      if (!opts.length) continue;
      const id = G.powers[botColor][k].id;
      if (E.POWERS[id].game) { // Jules wins most minigames, so it values the prize highly
        const sc = pass + PRIZE_CP[id] * 0.75 - 40;
        if (sc > bestScore) { bestScore = sc; best = { type: 'power', slot: k, args: {} }; }
        continue;
      }
      const sample = opts.length > 40 ? opts.slice().sort(() => Math.random() - 0.5).slice(0, 40) : opts;
      const trap = id === 'banana' || id === 'portals' || id === 'wall' ? 15 : 0;
      for (const o of sample) {
        const sc = scoreAction(G, botColor, (g) => E.usePower(g, k, o.args), 1) + trap;
        if (sc > bestScore + 25) { bestScore = sc; best = { type: 'power', slot: k, args: o.args }; }
      }
    }
  } catch (e) { if (e !== STOP) throw e; }
  return best;
}
/** Tug of War prize: the best enemy piece to push before moving. */
function pickPush(G) {
  const c = G.turn, opts = E.freePushOptions(G, c);
  deadline = Date.now() + 700;
  let best = opts[0] && opts[0].args, bs = -INF;
  try {
    for (const o of opts.slice(0, 60)) {
      const sc = scoreAction(G, c, (g) => E.freePush(g, o.args.from, o.args.to), 1);
      if (sc > bs) { bs = sc; best = o.args; }
    }
  } catch (e) { if (e !== STOP) throw e; }
  return best;
}

/** Secret setup, chosen on purpose. */
function setup(s, c) {
  const home = c === E.W ? 1 : 6, enemyMinor = c === E.W ? 5 : 2; // pawn rank; the rank enemy knights develop to
  if (s.twists.hiddenQueen) E.setHiddenQueen(s, c, E.sq(2, home)); // the c-pawn: rarely traded early
  if (s.twists.traitor) {
    const enemy = s.board.map((p, i) => [p, i]).filter(([p]) => p && p.owner !== c && p.type !== 'K');
    enemy.sort((a, b) => VAL[TYPE[b[0].type]] - VAL[TYPE[a[0].type]]);
    E.setTraitor(s, c, enemy[0][1]); // the enemy queen
  }
  if (s.twists.shifter) E.setShifter(s, c, E.sq(4, home)); // a centre pawn: every capture upgrades it
  if (s.twists.mines) E.setMines(s, c, [E.sq(2, enemyMinor), E.sq(5, enemyMinor)]); // c3 and f3 (or c6/f6)
}

/** Jules accepts a draw only when it's worse off. */
function acceptsDraw(G) {
  const botColor = G.turn === E.W ? E.B : E.W; // the offer comes on the human's turn
  const S = fromGame(G, botColor);
  const e = evaluate(S) * (S.side === S.bot ? 1 : -1);
  return e < -150;
}

globalThis.TGJules = { NAME: 'Jules', setup, chooseAction, acceptsDraw, pickPush, _internal: { fromGame, gen, play, unmake, evaluate, legalKeys, rootSearch } };
})();
