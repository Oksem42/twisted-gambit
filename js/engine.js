(function () {
// Twisted Gambit — rules engine.
// Pure game logic, no DOM. Full standard chess rules (check, checkmate, stalemate, castling
// restrictions, en passant, promotion choice, threefold repetition, 50-move rule, insufficient
// material) plus the secret twists. The engine always judges with the pieces' TRUE identities,
// acting like a tournament arbiter who can see everything.

const W = 'w';
const B = 'b';
const other = (c) => (c === W ? B : W);
const FILES = 'abcdefgh';
const sq = (f, r) => r * 8 + f;
const fileOf = (s) => s % 8;
const rankOf = (s) => (s / 8) | 0;
const sqName = (s) => FILES[fileOf(s)] + (rankOf(s) + 1);
const onBoard = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;
const fwd = (c) => (c === W ? 1 : -1);
const homeRank = (c) => (c === W ? 0 : 7);
const pawnRank = (c) => (c === W ? 1 : 6);
const lastRank = (c) => (c === W ? 7 : 0);

const PIECE_NAME = { K: 'King', Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight', P: 'Pawn' };
const PIECE_VALUE = { K: 0, Q: 9, R: 5, B: 3, N: 3, P: 1 };
const PROMOTIONS = ['Q', 'R', 'B', 'N'];

const count = (s, c, type) => s.captured[c].filter((x) => x.owner !== c && (!type || x.type === type)).length;
const pieces = (s, c) => s.board.map((p, i) => [p, i]).filter(([p]) => p && p.owner === c);

const OBJECTIVES = [
  { id: 'bishops', text: 'Capture both enemy bishops', goal: 2, progress: (s, c) => count(s, c, 'B') },
  { id: 'knights', text: 'Capture both enemy knights', goal: 2, progress: (s, c) => count(s, c, 'N') },
  { id: 'rooks', text: 'Capture both enemy rooks', goal: 2, progress: (s, c) => count(s, c, 'R') },
  { id: 'queenPawn', text: 'Capture the enemy queen with a pawn', goal: 1,
    progress: (s, c) => s.captured[c].filter((x) => x.owner !== c && x.type === 'Q' && x.by === 'P').length },
  { id: 'promote', text: 'Promote a pawn', goal: 1, progress: (s, c) => s.stats[c].promotions },
  { id: 'knightRaid', text: "Land a knight on the enemy's back rank", goal: 1,
    progress: (s, c) => pieces(s, c).filter(([p, i]) => p.type === 'N' && rankOf(i) === lastRank(c)).length },
  { id: 'kingMarch', text: 'Walk your king into the enemy half of the board', goal: 1,
    progress: (s, c) => pieces(s, c).filter(([p, i]) => p.type === 'K' && (c === W ? rankOf(i) >= 4 : rankOf(i) <= 3)).length },
  { id: 'center', text: 'Occupy d4, e4, d5 and e5 at the same time', goal: 4,
    progress: (s, c) => [27, 28, 35, 36].filter((i) => s.board[i] && s.board[i].owner === c).length },
  { id: 'pawnHunter', text: 'Capture 6 enemy pawns', goal: 6, progress: (s, c) => count(s, c, 'P') },
  { id: 'butcher', text: 'Capture 8 enemy pieces of any kind', goal: 8, progress: (s, c) => count(s, c) },
];
const objectiveById = (id) => OBJECTIVES.find((o) => o.id === id);

// ---------------------------------------------------------------- setup

function newGame(twists = {}, rng = Math.random) {
  const t = { hiddenQueen: false, traitor: false, objective: false, swap: false, ...twists };
  const s = {
    board: Array(64).fill(null), turn: W, twists: t, ep: null, nextId: 1,
    captured: { w: [], b: [] }, stats: { w: { promotions: 0 }, b: { promotions: 0 } },
    history: [], traitor: { w: null, b: null }, swapUsed: { w: false, b: false },
    objectives: { w: null, b: null }, hiddenQueen: { w: null, b: null },
    result: null, lastMove: null, ply: 0, halfmove: 0, positions: {}, check: null,
  };
  const back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
  for (const c of [W, B]) {
    for (let f = 0; f < 8; f++) {
      place(s, sq(f, homeRank(c)), c, back[f]);
      place(s, sq(f, pawnRank(c)), c, 'P');
    }
  }
  if (t.objective) {
    const ids = shuffle(OBJECTIVES.map((o) => o.id), rng);
    s.objectives = { w: ids[0], b: ids[1] };
  }
  return s;
}

function place(s, i, owner, type) {
  s.board[i] = { id: s.nextId++, owner, type, shown: type, moved: false };
}

function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Secret Queen: on top of the normal queen, the chosen pawn secretly becomes a second queen (still shown as a pawn). */
function setHiddenQueen(s, c, i) {
  const p = s.board[i];
  if (!s.twists.hiddenQueen || !p || p.owner !== c || p.shown !== 'P') return false;
  const prev = findById(s, s.hiddenQueen[c]);
  if (prev) prev.piece.type = 'P';
  p.type = 'Q';
  s.hiddenQueen[c] = p.id;
  return true;
}

/** Traitor: mark one enemy piece (not the king) that you may control for one move later. */
function setTraitor(s, c, i) {
  const p = s.board[i];
  if (!s.twists.traitor || !p || p.owner === c || p.type === 'K') return false;
  s.traitor[c] = { id: p.id, used: false };
  return true;
}

function findById(s, id) {
  if (id == null) return null;
  const i = s.board.findIndex((p) => p && p.id === id);
  return i < 0 ? null : { piece: s.board[i], sq: i };
}

// ---------------------------------------------------------------- attacks & check

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

/** Squares of pieces owned by `by` that attack `target` (true identities). */
function attackers(board, target, by) {
  const out = [];
  const f0 = fileOf(target), r0 = rankOf(target);
  const at = (f, r) => (onBoard(f, r) ? board[sq(f, r)] : null);
  const hit = (f, r, types) => { const p = at(f, r); if (p && p.owner === by && types.includes(p.type)) out.push(sq(f, r)); };
  for (const df of [-1, 1]) hit(f0 + df, r0 - fwd(by), ['P']);
  for (const [df, dr] of KNIGHT) hit(f0 + df, r0 + dr, ['N']);
  for (const [df, dr] of KING) hit(f0 + df, r0 + dr, ['K']);
  const ray = (dirs, types) => {
    for (const [df, dr] of dirs) {
      let f = f0 + df, r = r0 + dr;
      while (onBoard(f, r)) {
        const p = board[sq(f, r)];
        if (p) { if (p.owner === by && types.includes(p.type)) out.push(sq(f, r)); break; }
        f += df; r += dr;
      }
    }
  };
  ray(ROOK, ['R', 'Q']);
  ray(BISHOP, ['B', 'Q']);
  return out;
}
const isAttacked = (board, target, by) => attackers(board, target, by).length > 0;
const kingSq = (board, c) => board.findIndex((p) => p && p.owner === c && p.type === 'K');
function inCheck(board, c) {
  const k = kingSq(board, c);
  return k >= 0 && isAttacked(board, k, other(c));
}

// ---------------------------------------------------------------- move generation

/**
 * Pseudo-legal moves for a piece of `type` on `from`.
 * ctrl = side controlling the move (decides friend/foe), dir = side whose "forward" pawns use.
 * castlePiece: pass the king to allow castling.
 */
function gen(board, from, type, ctrl, dir, ep = null, castlePiece = null) {
  const out = [];
  const f0 = fileOf(from), r0 = rankOf(from);
  const at = (f, r) => board[sq(f, r)];
  const add = (f, r, extra) => out.push({ from, to: sq(f, r), ...extra });
  const step = (dirs) => {
    for (const [df, dr] of dirs) {
      const f = f0 + df, r = r0 + dr;
      if (!onBoard(f, r)) continue;
      const t = at(f, r);
      if (!t) add(f, r);
      else if (t.owner !== ctrl) add(f, r, { capture: true });
    }
  };
  const slide = (dirs) => {
    for (const [df, dr] of dirs) {
      let f = f0 + df, r = r0 + dr;
      while (onBoard(f, r)) {
        const t = at(f, r);
        if (!t) add(f, r);
        else { if (t.owner !== ctrl) add(f, r, { capture: true }); break; }
        f += df; r += dr;
      }
    }
  };
  switch (type) {
    case 'N': step(KNIGHT); break;
    case 'R': slide(ROOK); break;
    case 'B': slide(BISHOP); break;
    case 'Q': slide(ROOK); slide(BISHOP); break;
    case 'K': {
      step(KING);
      const k = castlePiece;
      const h = homeRank(ctrl);
      const foe = other(ctrl);
      // Castling: king and rook unmoved, squares between empty, king not in check,
      // and the king does not pass through or land on an attacked square.
      if (k && !k.moved && k.owner === ctrl && from === sq(4, h) && !isAttacked(board, from, foe)) {
        const rookOk = (f) => { const r = at(f, h); return r && r.type === 'R' && r.owner === ctrl && !r.moved; };
        const safe = (f) => !isAttacked(board, sq(f, h), foe);
        if (rookOk(7) && !at(5, h) && !at(6, h) && safe(5) && safe(6)) add(6, h, { castle: 'K' });
        if (rookOk(0) && !at(1, h) && !at(2, h) && !at(3, h) && safe(3) && safe(2)) add(2, h, { castle: 'Q' });
      }
      break;
    }
    case 'P': {
      const d = fwd(dir), r1 = r0 + d;
      if (!onBoard(f0, r1)) break;
      if (!at(f0, r1)) {
        add(f0, r1);
        if (r0 === pawnRank(dir) && onBoard(f0, r0 + 2 * d) && !at(f0, r0 + 2 * d)) add(f0, r0 + 2 * d, { double: true });
      }
      for (const df of [-1, 1]) {
        const f = f0 + df;
        if (!onBoard(f, r1)) continue;
        const t = at(f, r1);
        if (t && t.owner !== ctrl) add(f, r1, { capture: true });
        else if (!t && ep === sq(f, r1)) add(f, r1, { capture: true, ep: true });
      }
      break;
    }
  }
  return out;
}

/** Board after a move, for legality testing only (identity of pieces unchanged). */
function simulate(board, m) {
  const b = board.slice();
  const p = b[m.from];
  if (m.ep) b[m.to - 8 * fwd(p.owner)] = null;
  b[m.to] = p;
  b[m.from] = null;
  if (m.castle) {
    const h = rankOf(m.from);
    const [rf, rt] = m.castle === 'K' ? [7, 5] : [0, 3];
    b[sq(rt, h)] = b[sq(rf, h)];
    b[sq(rf, h)] = null;
  }
  return b;
}

/** Legal moves for the side to move from `from`. opts.traitor = move the marked enemy piece. */
function legalMoves(s, from, opts = {}) {
  if (s.result) return [];
  const p = s.board[from];
  if (!p) return [];
  const me = s.turn;
  let moves;
  if (opts.traitor) {
    const tr = s.traitor[me];
    if (!tr || tr.used || tr.id !== p.id) return [];
    moves = gen(s.board, from, p.type, me, p.owner).map((m) => ({ ...m, traitor: true }));
  } else {
    if (p.owner !== me) return [];
    moves = gen(s.board, from, p.type, me, me, s.ep, p);
  }
  return moves.filter((m) => {
    const t = s.board[m.to];
    if (t && t.type === 'K') return false; // kings are never captured
    return !inCheck(simulate(s.board, m), me); // never leave your own king in check
  }).map((m) => (p.type === 'P' && rankOf(m.to) === lastRank(p.owner) ? { ...m, promo: true } : m));
}

function canSwap(s, c) {
  if (!s.twists.swap || s.swapUsed[c] || s.result) return false;
  if (inCheck(s.board, c)) return false; // a swap doesn't move anything, so it can't answer check
  return s.board.filter((p) => p && p.owner === c && p.type !== 'K').length >= 2;
}

function hasAnyMove(s, c) {
  const saved = s.turn;
  s.turn = c;
  let any = s.board.some((p, i) => p && p.owner === c && legalMoves(s, i).length > 0);
  const tr = s.traitor[c];
  if (!any && s.twists.traitor && tr && !tr.used) {
    const f = findById(s, tr.id);
    any = !!f && legalMoves(s, f.sq, { traitor: true }).length > 0;
  }
  if (!any) any = canSwap(s, c);
  s.turn = saved;
  return any;
}

// ---------------------------------------------------------------- draws

function castlingRights(s) {
  let out = '';
  for (const c of [W, B]) {
    const h = homeRank(c);
    const k = s.board[sq(4, h)];
    if (!k || k.type !== 'K' || k.owner !== c || k.moved) continue;
    for (const [f, tag] of [[7, 'K'], [0, 'Q']]) {
      const r = s.board[sq(f, h)];
      if (r && r.type === 'R' && r.owner === c && !r.moved) out += c + tag;
    }
  }
  return out;
}

/** Position identity for repetition: pieces (true + shown), side to move, castling and real en passant rights. */
function positionKey(s) {
  const pcs = s.board.map((p) => (p ? p.owner + p.type + (p.shown || '?') : '.')).join('');
  let ep = '-';
  if (s.ep != null && s.board.some((p, i) => p && p.owner === s.turn && legalMoves(s, i).some((m) => m.ep))) ep = s.ep;
  return `${pcs}|${s.turn}|${castlingRights(s)}|${ep}`;
}

function insufficientMaterial(board) {
  const rest = board.map((p, i) => [p, i]).filter(([p]) => p && p.type !== 'K');
  if (rest.length === 0) return true; // K vs K
  if (rest.length === 1 && (rest[0][0].type === 'B' || rest[0][0].type === 'N')) return true; // K+minor vs K
  if (rest.every(([p]) => p.type === 'B')) {
    // Only bishops left, all on the same square colour: checkmate is impossible.
    const colours = new Set(rest.map(([, i]) => (fileOf(i) + rankOf(i)) % 2));
    return colours.size === 1;
  }
  return false;
}

// ---------------------------------------------------------------- making moves

function applyMove(s, m, ctrl, promo) {
  const b = s.board;
  const p = b[m.from];
  const shownBefore = p.shown;
  const wasPawn = p.type === 'P';
  // A disguised piece is revealed the moment it moves in a way its disguise couldn't.
  let revealed = false;
  if (p.shown && p.shown !== p.type) {
    const ok = gen(b, m.from, p.shown, ctrl, p.owner).some((x) => x.to === m.to);
    if (!ok) { p.shown = p.type; revealed = true; }
  }
  const capSq = m.ep ? m.to - 8 * fwd(p.owner) : m.to;
  const victim = b[capSq];
  if (victim) {
    s.captured[ctrl].push({ type: victim.type, by: p.type, owner: victim.owner });
    b[capSq] = null;
  }
  b[m.to] = p;
  b[m.from] = null;
  p.moved = true;
  if (m.castle) {
    const h = rankOf(m.from);
    const [rf, rt] = m.castle === 'K' ? [7, 5] : [0, 3];
    b[sq(rt, h)] = b[sq(rf, h)];
    b[sq(rf, h)] = null;
    b[sq(rt, h)].moved = true;
  }
  s.ep = null;
  if (!m.traitor && p.shown === 'P' && fileOf(m.from) === fileOf(m.to) && Math.abs(rankOf(m.to) - rankOf(m.from)) === 2) {
    s.ep = (m.from + m.to) / 2;
  }
  s.halfmove = wasPawn || victim ? 0 : s.halfmove + 1;
  let promoted = false;
  if (rankOf(m.to) === lastRank(p.owner)) {
    if (p.type === 'P') { p.type = PROMOTIONS.includes(promo) ? promo : 'Q'; promoted = true; s.stats[p.owner].promotions++; }
    if (p.shown === 'P') { if (!promoted) revealed = true; p.shown = p.type; }
  }
  // Short algebraic-style notation based on what the opponent can see.
  let text;
  const seen = revealed ? p.type : shownBefore;
  if (m.castle) text = m.castle === 'K' ? 'O-O' : 'O-O-O';
  else if (seen === 'P' || (promoted && shownBefore === 'P')) text = `${victim ? FILES[fileOf(m.from)] + 'x' : ''}${sqName(m.to)}`;
  else text = `${seen}${victim ? 'x' : ''}${sqName(m.to)}`;
  if (promoted && p.shown === p.type) text += '=' + p.type;
  if (revealed) text += ' (revealed)';
  if (m.traitor) text = '🗡 ' + text;
  s.lastMove = { from: m.from, to: m.to };
  return { text };
}

function end(s, winner, reason) {
  if (!s.result) s.result = { winner, reason };
}

/** After a move or swap: reveal disguised checkers, then look for every way the game can end. */
function afterTurn(s, mover, entry) {
  const opp = s.turn;
  const k = kingSq(s.board, opp);
  const checkers = k >= 0 ? attackers(s.board, k, mover) : [];
  let revealedByCheck = false;
  for (const i of checkers) {
    const p = s.board[i];
    if (p.shown && p.shown !== p.type) { p.shown = p.type; revealedByCheck = true; }
  }
  s.check = checkers.length ? opp : null;

  for (const c of [mover, opp]) {
    const o = objectiveById(s.objectives[c]);
    if (o && o.progress(s, c) >= o.goal) end(s, c, `completed the secret objective: “${o.text}”`);
  }
  if (!s.result && !hasAnyMove(s, opp)) {
    if (s.check) end(s, mover, 'won by checkmate');
    else end(s, null, 'stalemate');
  }
  if (!s.result && insufficientMaterial(s.board)) end(s, null, 'insufficient material');
  if (!s.result) {
    const key = positionKey(s);
    s.positions[key] = (s.positions[key] || 0) + 1;
    if (s.positions[key] >= 3) end(s, null, 'threefold repetition');
  }
  if (!s.result && s.halfmove >= 100) end(s, null, 'the 50-move rule');

  if (entry) {
    if (revealedByCheck) entry.note = 'disguised piece revealed by giving check';
    if (s.result && s.result.reason === 'won by checkmate') entry.text += '#';
    else if (s.check) entry.text += '+';
  }
}

function recordStart(s) {
  if (s.ply === 0) { const key = positionKey(s); s.positions[key] = (s.positions[key] || 0) + 1; }
}

function makeMove(s, move) {
  const me = s.turn;
  const legal = legalMoves(s, move.from, { traitor: !!move.traitor }).find((m) => m.to === move.to);
  if (!legal) throw new Error('Illegal move');
  recordStart(s);
  const { text } = applyMove(s, legal, me, move.promo);
  if (legal.traitor) s.traitor[me].used = true;
  const entry = { color: me, text };
  s.history.push(entry);
  s.turn = other(me);
  s.ply++;
  afterTurn(s, me, entry);
}

/** Secret Swap: exchange the true identities of two of your pieces. Their looks stay the same. */
function doSwap(s, a, b) {
  const me = s.turn;
  const pa = s.board[a], pb = s.board[b];
  if (!canSwap(s, me)) throw new Error('Swap not available');
  if (a === b || !pa || !pb || pa.owner !== me || pb.owner !== me || pa.type === 'K' || pb.type === 'K') throw new Error('Invalid swap');
  recordStart(s);
  [pa.type, pb.type] = [pb.type, pa.type];
  pa.moved = pb.moved = true;
  for (const [p, i] of [[pa, a], [pb, b]]) {
    if (p.type === 'P' && rankOf(i) === lastRank(me)) { p.type = 'Q'; s.stats[me].promotions++; }
  }
  s.swapUsed[me] = true;
  s.ep = null;
  s.halfmove++;
  s.lastMove = null;
  const entry = { color: me, text: '⇄ secret swap' };
  s.history.push(entry);
  s.turn = other(me);
  s.ply++;
  afterTurn(s, me, entry);
}

function resign(s, c) { end(s, other(c), 'won by resignation'); }
function agreeDraw(s) { end(s, null, 'agreement'); }

globalThis.TGEngine = {
  W, B, other, FILES, sq, fileOf, rankOf, sqName, PIECE_NAME, PIECE_VALUE, PROMOTIONS, OBJECTIVES, objectiveById,
  newGame, setHiddenQueen, setTraitor, findById, legalMoves, hasAnyMove, canSwap, inCheck, kingSq, makeMove, doSwap,
  resign, agreeDraw, positionKey, insufficientMaterial,
};
})();
