// Twisted Gambit — rules engine.
// Pure game logic, no DOM. The win condition is capturing the king (no check / checkmate),
// which keeps hidden-information twists simple and fair.

export const W = 'w';
export const B = 'b';
export const other = (c) => (c === W ? B : W);
export const FILES = 'abcdefgh';
export const sq = (f, r) => r * 8 + f;
export const fileOf = (s) => s % 8;
export const rankOf = (s) => (s / 8) | 0;
export const sqName = (s) => FILES[fileOf(s)] + (rankOf(s) + 1);
const onBoard = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;
const fwd = (c) => (c === W ? 1 : -1);
const homeRank = (c) => (c === W ? 0 : 7);
const pawnRank = (c) => (c === W ? 1 : 6);
const lastRank = (c) => (c === W ? 7 : 0);

export const PIECE_NAME = { K: 'King', Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight', P: 'Pawn' };
export const PIECE_VALUE = { K: 0, Q: 9, R: 5, B: 3, N: 3, P: 1 };

// Bluff Moves hides every piece, so it can't be combined with twists that depend on visible identities.
export const BLUFF_EXCLUDES = ['hiddenQueen', 'traitor', 'swap'];

const count = (s, c, type) => s.captured[c].filter((x) => x.owner !== c && (!type || x.type === type)).length;
const pieces = (s, c) => s.board.map((p, i) => [p, i]).filter(([p]) => p && p.owner === c);

export const OBJECTIVES = [
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
export const objectiveById = (id) => OBJECTIVES.find((o) => o.id === id);

// ---------------------------------------------------------------- setup

export function newGame(twists = {}, rng = Math.random) {
  const t = { hiddenQueen: false, traitor: false, objective: false, bluff: false, swap: false, ...twists };
  if (t.bluff) for (const k of BLUFF_EXCLUDES) t[k] = false;
  const s = {
    board: Array(64).fill(null), turn: W, twists: t, ep: null, nextId: 1,
    captured: { w: [], b: [] }, stats: { w: { promotions: 0 }, b: { promotions: 0 } },
    history: [], traitor: { w: null, b: null }, swapUsed: { w: false, b: false },
    objectives: { w: null, b: null }, hiddenQueen: { w: null, b: null },
    pending: null, result: null, lastMove: null, ply: 0,
  };
  const back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
  for (const c of [W, B]) {
    for (let f = 0; f < 8; f++) {
      place(s, sq(f, homeRank(c)), c, back[f]);
      place(s, sq(f, pawnRank(c)), c, 'P');
    }
    if (t.hiddenQueen) s.board[sq(3, homeRank(c))] = null; // the queen hides among the pawns instead
    if (t.bluff) shuffleArmy(s, c, rng);
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

/** Bluff Moves: shuffle a side's 16 pieces across its two home ranks and hide them all. */
export function shuffleArmy(s, c, rng = Math.random) {
  const squares = [];
  for (let f = 0; f < 8; f++) squares.push(sq(f, homeRank(c)), sq(f, pawnRank(c)));
  const ps = shuffle(squares.map((i) => s.board[i]).filter(Boolean), rng);
  squares.forEach((i, k) => {
    s.board[i] = ps[k] || null;
    if (s.board[i]) s.board[i].shown = null;
  });
}

/** Hidden Queen: the chosen pawn secretly becomes the queen (still shown as a pawn). */
export function setHiddenQueen(s, c, i) {
  const p = s.board[i];
  if (!s.twists.hiddenQueen || !p || p.owner !== c || p.shown !== 'P') return false;
  const prev = findById(s, s.hiddenQueen[c]);
  if (prev) prev.piece.type = 'P';
  p.type = 'Q';
  s.hiddenQueen[c] = p.id;
  return true;
}

/** Traitor: mark one enemy piece (not the king) that you may control for one move later. */
export function setTraitor(s, c, i) {
  const p = s.board[i];
  if (!s.twists.traitor || !p || p.owner === c || p.type === 'K') return false;
  s.traitor[c] = { id: p.id, used: false };
  return true;
}

export function findById(s, id) {
  if (id == null) return null;
  const i = s.board.findIndex((p) => p && p.id === id);
  return i < 0 ? null : { piece: s.board[i], sq: i };
}

// ---------------------------------------------------------------- move generation

const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

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
      if (k && !k.moved && k.owner === ctrl && from === sq(4, h)) {
        const rookOk = (f) => { const r = at(f, h); return r && r.type === 'R' && r.owner === ctrl && !r.moved; };
        if (rookOk(7) && !at(5, h) && !at(6, h)) add(6, h, { castle: 'K' });
        if (rookOk(0) && !at(1, h) && !at(2, h) && !at(3, h)) add(2, h, { castle: 'Q' });
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

/** Moves available to the side to move from `from`. opts.traitor = move the marked enemy piece. */
export function legalMoves(s, from, opts = {}) {
  if (s.result || s.pending) return [];
  const p = s.board[from];
  if (!p) return [];
  const me = s.turn;
  if (opts.traitor) {
    const tr = s.traitor[me];
    if (!tr || tr.used || tr.id !== p.id) return [];
    return gen(s.board, from, p.type, me, p.owner, s.ep).map((m) => ({ ...m, traitor: true }));
  }
  if (p.owner !== me) return [];
  if (s.twists.bluff) {
    // Any piece may *claim* any move a queen or knight could make (covers every piece's geometry).
    return [...gen(s.board, from, 'Q', me, me), ...gen(s.board, from, 'N', me, me)];
  }
  return gen(s.board, from, p.type, me, me, s.ep, p);
}

export function hasAnyMove(s, c) {
  const saved = s.turn;
  s.turn = c;
  const pend = s.pending; s.pending = null;
  const any = s.board.some((p, i) => p && p.owner === c && legalMoves(s, i).length > 0);
  s.turn = saved; s.pending = pend;
  return any;
}

// ---------------------------------------------------------------- making moves

function applyMove(s, m, ctrl) {
  const b = s.board;
  const p = b[m.from];
  const shownBefore = p.shown;
  // A disguised piece is revealed the moment it moves in a way its disguise couldn't.
  let revealed = false;
  if (!s.twists.bluff && p.shown && p.shown !== p.type) {
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
  if (!s.twists.bluff && p.shown === 'P' && fileOf(m.from) === fileOf(m.to) && Math.abs(rankOf(m.to) - rankOf(m.from)) === 2) {
    s.ep = (m.from + m.to) / 2;
  }
  let promoted = false;
  if (rankOf(m.to) === lastRank(p.owner)) {
    if (p.type === 'P') { p.type = 'Q'; promoted = true; s.stats[p.owner].promotions++; }
    if (p.shown === 'P') { if (p.type !== 'Q') revealed = true; p.shown = p.type; }
  }
  // Short algebraic-style notation based on what the opponent can see.
  let text;
  if (m.castle) text = m.castle === 'K' ? 'O-O' : 'O-O-O';
  else if (!shownBefore) text = `?${sqName(m.from)}${victim ? 'x' : '–'}${sqName(m.to)}`;
  else if (shownBefore === 'P') text = `${victim ? FILES[fileOf(m.from)] + 'x' : ''}${sqName(m.to)}`;
  else text = `${shownBefore}${victim ? 'x' : ''}${sqName(m.to)}`;
  if (promoted && p.shown === 'Q') text += '=Q';
  if (revealed && !promoted) text += ` (${p.type}!)`;
  if (m.traitor) text = '🗡 ' + text;
  s.lastMove = { from: m.from, to: m.to };
  return { text, victim };
}

function end(s, winner, reason) {
  if (!s.result) s.result = { winner, reason };
}

function checkWin(s, mover) {
  for (const c of [other(mover), mover]) {
    if (!s.board.some((p) => p && p.owner === c && p.type === 'K')) return end(s, other(c), 'captured the king');
  }
  for (const c of [mover, other(mover)]) {
    const o = objectiveById(s.objectives[c]);
    if (o && o.progress(s, c) >= o.goal) return end(s, c, `completed the secret objective: “${o.text}”`);
  }
}

function checkStuck(s) {
  if (!s.result && !hasAnyMove(s, s.turn)) end(s, other(s.turn), 'left the opponent with no moves');
}

export function makeMove(s, move) {
  const me = s.turn;
  const legal = legalMoves(s, move.from, { traitor: !!move.traitor }).find((m) => m.to === move.to);
  if (!legal) throw new Error('Illegal move');
  const p = s.board[legal.from];

  if (s.twists.bluff) {
    const { history, pending, ...rest } = s;
    const snapshot = structuredClone(rest);
    const honest = gen(s.board, legal.from, p.type, me, me).some((x) => x.to === legal.to);
    const { text } = applyMove(s, legal, me);
    s.history.push({ color: me, text });
    s.pending = { by: me, honest, pieceId: p.id, move: legal, snapshot };
    s.turn = other(me);
    s.ply++;
    return;
  }

  const { text } = applyMove(s, legal, me);
  if (legal.traitor) s.traitor[me].used = true;
  s.history.push({ color: me, text });
  s.turn = other(me);
  s.ply++;
  checkWin(s, me);
  checkStuck(s);
}

/** Secret Swap: exchange the true identities of two of your pieces. Their looks stay the same. */
export function doSwap(s, a, b) {
  const me = s.turn;
  const pa = s.board[a], pb = s.board[b];
  if (!s.twists.swap || s.swapUsed[me] || s.pending || s.result) throw new Error('Swap not available');
  if (a === b || !pa || !pb || pa.owner !== me || pb.owner !== me || pa.type === 'K' || pb.type === 'K') throw new Error('Invalid swap');
  [pa.type, pb.type] = [pb.type, pa.type];
  pa.moved = pb.moved = true;
  for (const [p, i] of [[pa, a], [pb, b]]) {
    if (p.type === 'P' && rankOf(i) === lastRank(me)) { p.type = 'Q'; s.stats[me].promotions++; }
  }
  s.swapUsed[me] = true;
  s.ep = null;
  s.lastMove = null;
  s.history.push({ color: me, text: '⇄ secret swap' });
  s.turn = other(me);
  s.ply++;
  checkWin(s, me);
  checkStuck(s);
}

/**
 * Bluff Moves: the player to move answers the opponent's last move.
 * Returns { outcome: 'accepted' | 'caught' | 'honest', type?, lost? }.
 */
export function resolveChallenge(s, challenge, rng = Math.random) {
  const pend = s.pending;
  if (!pend) throw new Error('Nothing to challenge');
  const challenger = s.turn, bluffer = pend.by;
  const entry = s.history[s.history.length - 1];
  s.pending = null;

  if (!challenge) {
    checkWin(s, bluffer);
    checkStuck(s);
    return { outcome: 'accepted' };
  }

  if (!pend.honest) {
    // Bluff caught: undo the move and the bluffing piece is removed from the game.
    const history = s.history;
    Object.assign(s, structuredClone(pend.snapshot));
    s.history = history;
    s.pending = null;
    const piece = s.board[pend.move.from];
    s.board[pend.move.from] = null;
    s.captured[challenger].push({ type: piece.type, by: 'challenge', owner: bluffer });
    entry.note = `bluff caught — ${PIECE_NAME[piece.type]} removed`;
    entry.caught = true;
    s.turn = challenger;
    s.ply++;
    s.lastMove = null;
    checkWin(s, challenger);
    checkStuck(s);
    return { outcome: 'caught', type: piece.type };
  }

  // Honest move: the piece is revealed and the challenger loses a random piece.
  const found = findById(s, pend.pieceId);
  if (found) found.piece.shown = found.piece.type;
  const mine = s.board.map((p, i) => [p, i]).filter(([p]) => p && p.owner === challenger && p.type !== 'K');
  let lost = null;
  if (mine.length) {
    const [p, i] = mine[Math.floor(rng() * mine.length)];
    s.board[i] = null;
    lost = p.type;
    s.captured[bluffer].push({ type: p.type, by: 'challenge', owner: challenger });
  }
  entry.note = `honest ${found ? PIECE_NAME[found.piece.type] : 'move'}! challenger lost a ${lost ? PIECE_NAME[lost] : 'nothing'}`;
  checkWin(s, bluffer);
  checkStuck(s);
  return { outcome: 'honest', type: found && found.piece.type, lost };
}

export function resign(s, c) { end(s, other(c), 'wins by resignation'); }
export function agreeDraw(s) { end(s, null, 'draw by agreement'); }
