(function () {
// Gerasimos Gambit — rules engine.
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

const PIECE_NAME = { K: 'King', Q: 'Queen', R: 'Rook', B: 'Bishop', N: 'Knight', P: 'Pawn', S: 'Snake' };
const PIECE_VALUE = { K: 0, Q: 9, R: 5, B: 3, N: 3, P: 1, S: 12 };
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
  const t = { hiddenQueen: false, traitor: false, objective: false, swap: false, mines: false, prophecy: false, shifter: false, gambler: false, powers: false, ...twists };
  const s = {
    board: Array(64).fill(null), turn: W, twists: t, ep: null, nextId: 1,
    captured: { w: [], b: [] }, stats: { w: { promotions: 0 }, b: { promotions: 0 } },
    history: [], traitor: { w: null, b: null }, swapUsed: { w: false, b: false },
    objectives: { w: null, b: null }, hiddenQueen: { w: null, b: null },
    result: null, lastMove: null, ply: 0, halfmove: 0, positions: {}, check: null,
    mines: { w: [], b: [] }, lastExplosion: null, shifter: { w: null, b: null },
    prophecy: { w: null, b: null }, bonusPending: null, bonusNow: null, turns: { w: 0, b: 0 },
    coins: { w: 0, b: 0 }, lastSpin: null,
    powers: { w: [], b: [] }, seed: 1, walls: [], portals: { w: null, b: null }, bananas: { w: [], b: [] },
    snaps: [], minigame: null, freePush: null,
  };
  const back = ['R', 'N', 'B', 'Q', 'K', 'B', 'N', 'R'];
  for (const c of [W, B]) {
    for (let f = 0; f < 8; f++) {
      place(s, sq(f, homeRank(c)), c, back[f]);
      place(s, sq(f, pawnRank(c)), c, 'P');
    }
  }
  if (t.powers) {
    s.seed = Math.floor(rng() * 4294967296) | 0;
    for (const c of [W, B]) for (let k = 0; k < 3; k++) s.powers[c].push({ id: drawPower(s, c), wait: 0 });
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

// Landmine: each player plants MINES squares in the opponent's half. Mines placed by `c` hit pieces of other(c).
const MINES = 2;
const inEnemyHalf = (c, i) => (c === W ? rankOf(i) >= 4 : rankOf(i) <= 3);
function toggleMine(s, c, i) {
  if (!s.twists.mines || !inEnemyHalf(c, i)) return false;
  const list = s.mines[c];
  const k = list.indexOf(i);
  if (k >= 0) list.splice(k, 1);
  else if (list.length < MINES) list.push(i);
  else return false;
  return true;
}
function setMines(s, c, list) {
  if (!s.twists.mines || !Array.isArray(list)) return false;
  const uniq = [...new Set(list)].filter((i) => Number.isInteger(i) && i >= 0 && i < 64 && inEnemyHalf(c, i));
  if (uniq.length !== MINES) return false;
  s.mines[c] = uniq;
  return true;
}

/** Shapeshifter: the chosen piece turns into whatever it captures, keeping its current look. */
function setShifter(s, c, i) {
  const p = s.board[i];
  if (!s.twists.shifter || !p || p.owner !== c || p.type === 'K') return false;
  s.shifter[c] = p.id;
  return true;
}

/** A piece landed on `at`: set off an enemy mine there (kings are immune). */
function tripMine(s, at, piece) {
  const owner = other(piece.owner);
  const list = s.mines[owner];
  const k = list.indexOf(at);
  if (k < 0 || piece.type === 'K') return '';
  list.splice(k, 1);
  s.lastExplosion = at;
  const after = s.board.slice();
  after[at] = null;
  if (inCheck(after, piece.owner)) return 'fizzled'; // blowing it up would expose its own king: the mine is a dud
  s.board[at] = null;
  s.captured[owner].push({ type: piece.type, by: 'mine', owner: piece.owner });
  return 'exploded';
}

/** Prophecy recharges: usable when unused, or PROPHECY_RECHARGE turns after the last one was made. */
const PROPHECY_RECHARGE = 5;
function prophecyReady(s, c) {
  if (!s.twists.prophecy) return false;
  const pr = s.prophecy[c];
  return !pr || (pr.state !== 'active' && s.turns[c] + 1 >= pr.readyOnTurn);
}
/** Turns until the prophecy can be used again (0 = ready now). */
function prophecyWait(s, c) {
  const pr = s.prophecy[c];
  if (!pr || pr.state === 'active') return 0;
  return Math.max(0, pr.readyOnTurn - (s.turns[c] + 1));
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
  for (const [df, dr] of KNIGHT) hit(f0 + df, r0 + dr, ['N', 'S']);
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
  ray(ROOK, ['R', 'Q', 'S']);
  ray(BISHOP, ['B', 'Q', 'S']);
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
      else if (t.owner !== ctrl && t.type !== 'X') add(f, r, { capture: true });
    }
  };
  const slide = (dirs) => {
    for (const [df, dr] of dirs) {
      let f = f0 + df, r = r0 + dr;
      while (onBoard(f, r)) {
        const t = at(f, r);
        if (!t) add(f, r);
        else { if (t.owner !== ctrl && t.type !== 'X') add(f, r, { capture: true }); break; }
        f += df; r += dr;
      }
    }
  };
  switch (type) {
    case 'N': step(KNIGHT); break;
    case 'R': slide(ROOK); break;
    case 'B': slide(BISHOP); break;
    case 'Q': slide(ROOK); slide(BISHOP); break;
    case 'S': slide(ROOK); slide(BISHOP); step(KNIGHT); break; // the Snake: every king, queen and knight move
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
        if (t && t.owner !== ctrl && t.type !== 'X') add(f, r1, { capture: true });
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
  if (s.result || s.minigame) return [];
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
  if (!any && s.twists.powers) any = [0, 1, 2].some((k) => powerOptions(s, c, k).length > 0);
  if (!any && s.twists.gambler) any = Object.keys(PRICES).some((t) => s.coins[c] >= PRICES[t] && legalDrops(s, c, t).length > 0);
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
  return `${pcs}|${s.turn}|${castlingRights(s)}|${ep}|${s.mines.w}/${s.mines.b}|${s.bonusPending || ''}${s.bonusNow || ''}`;
}

function insufficientMaterial(board) {
  const rest = board.map((p, i) => [p, i]).filter(([p]) => p && p.type !== 'K' && p.type !== 'X');
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
  if (victim && s.shifter[p.owner] === p.id && victim.type !== 'K') {
    p.type = victim.type; // shapeshift: becomes what it captured, look unchanged
    if (p.type === 'P' && rankOf(m.to) === lastRank(p.owner)) p.type = 'Q';
  }
  s.lastExplosion = null;
  let boom = '';
  const landings = [[m.to, p]];
  if (m.castle) { const rs = sq(m.castle === 'K' ? 5 : 3, rankOf(m.from)); landings.push([rs, b[rs]]); }
  for (const [at, piece] of landings) { const r = tripMine(s, at, piece); if (r) boom = r; }
  if (boom === 'exploded') s.halfmove = 0;
  // Short algebraic-style notation based on what the opponent can see.
  let text;
  const seen = revealed ? p.type : shownBefore;
  if (m.castle) text = m.castle === 'K' ? 'O-O' : 'O-O-O';
  else if (seen === 'P' || (promoted && shownBefore === 'P')) text = `${victim ? FILES[fileOf(m.from)] + 'x' : ''}${sqName(m.to)}`;
  else text = `${seen}${victim ? 'x' : ''}${sqName(m.to)}`;
  if (promoted && p.shown === p.type) text += '=' + p.type;
  if (revealed) text += ' (revealed)';
  if (boom === 'exploded') text += ' [boom]';
  if (boom === 'fizzled') text += ' (mine fizzled)';
  if (m.traitor) text = '[traitor] ' + text;
  s.lastMove = { from: m.from, to: m.to };
  return { text, boom };
}

function end(s, winner, reason) {
  if (!s.result) s.result = { winner, reason };
}

/** After a move or swap: reveal disguised checkers, then look for every way the game can end. */
const addNote = (entry, text) => { if (entry) entry.note = entry.note ? `${entry.note} · ${text}` : text; };

function afterTurn(s, entry) {
  const opp = s.turn;
  const mover = other(opp);
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
  if (!s.result && !s.twists.gambler && insufficientMaterial(s.board)) end(s, null, 'insufficient material');
  if (!s.result) {
    const key = positionKey(s);
    s.positions[key] = (s.positions[key] || 0) + 1;
    if (s.positions[key] >= 3) end(s, null, 'threefold repetition');
  }
  if (!s.result && s.halfmove >= 100) end(s, null, 'the 50-move rule');

  if (entry) {
    if (revealedByCheck) addNote(entry, 'disguised piece revealed by giving check');
    if (s.result && s.result.reason === 'won by checkmate') entry.text += '#';
    else if (s.check) entry.text += '+';
  }
}

function recordStart(s) {
  if (s.ply === 0) { const key = positionKey(s); s.positions[key] = (s.positions[key] || 0) + 1; }
}

function makeMove(s, move) {
  const me = s.turn, foe = other(me);
  const legal = legalMoves(s, move.from, { traitor: !!move.traitor }).find((m) => m.to === move.to);
  if (!legal) throw new Error('Illegal move');
  recordStart(s);
  pushSnap(s);
  if (s.freePush === me) s.freePush = null; // use it or lose it
  let spin = null;
  if (s.twists.gambler) {
    spin = legal.capture ? spinFor(s, legal, move.roll) : null;
    s.lastSpin = spin;
    if (spin && !spin.won) return loseSpin(s, legal, spin);
    s.coins[me] += 1 + (spin ? PIECE_VALUE[spin.defender] : 0);
  }
  const takeBonus = s.bonusPending === me; // first half of a prophecy double move
  const isBonus = s.bonusNow === me; // second half
  if (takeBonus) s.bonusPending = null;
  s.bonusNow = null;

  // Resolve the opponent's prophecy about this very move.
  const pr = s.prophecy[foe];
  let prophecyNote = '';
  if (pr && pr.state === 'active') {
    const hit = pr.from === legal.from && pr.to === legal.to;
    pr.state = hit ? 'hit' : 'miss';
    if (hit) s.bonusPending = foe;
    prophecyNote = hit ? `[prophecy] ${foe === W ? 'White' : 'Black'} predicted this move: bonus move next turn` : '[prophecy] a prophecy missed';
  }

  const { text } = applyMove(s, legal, me, move.promo);
  if (legal.traitor) s.traitor[me].used = true;
  const entry = { color: me, text };
  if (s.twists.powers) for (const n of landEffects(s, legal, me)) addNote(entry, n);
  if (spin && spin.odds < 1) addNote(entry, `[wheel] won the spin at ${pct(spin.odds)}`);
  if (isBonus) addNote(entry, '[prophecy] bonus move');
  if (prophecyNote) addNote(entry, prophecyNote);
  s.history.push(entry);

  // Keep the turn for the bonus move, unless this move gave check (or there's nothing left to play).
  let keep = takeBonus && !inCheck(s.board, foe);
  if (keep && !hasAnyMove(s, me)) keep = false;
  if (takeBonus && !keep) addNote(entry, '[prophecy] bonus move forfeited');
  s.turn = keep ? me : foe;
  if (keep) s.bonusNow = me;
  else { s.turns[me]++; if (s.twists.powers) tickPowers(s, me); } // a whole turn is over (a bonus double move counts as one turn)
  s.ply++;
  if (s.twists.powers) expireEffects(s);
  afterTurn(s, entry);

  // Make a prophecy about the opponent's reply (once per game).
  const guess = move.prophecy;
  // (s.turns[me] already counts this turn, so "+1" undoes that for the readiness check)
  if (guess && s.twists.prophecy && s.turn === foe && !s.result
      && (!s.prophecy[me] || (s.prophecy[me].state !== 'active' && s.turns[me] >= s.prophecy[me].readyOnTurn))
      && legalMoves(s, guess.from).some((m) => m.to === guess.to)) {
    s.prophecy[me] = { from: guess.from, to: guess.to, state: 'active', readyOnTurn: s.turns[me] + PROPHECY_RECHARGE };
  }
}

// ---------------------------------------------------------------- Gambler's Gambit
const PRICES = { P: 3, N: 8, B: 8, R: 12, Q: 20 };
const LOST_SPIN_COINS = 2;
const pct = (p) => `${Number((p * 100).toFixed(1))}%`;

/** The attacker's chance to win a capture. The king is the only piece that always wins. */
function spinOdds(attacker, defender) {
  if (attacker === 'K') return 1;
  const a = PIECE_VALUE[attacker], d = PIECE_VALUE[defender];
  return a / (a + d);
}
function spinFor(s, m, roll) {
  const attacker = s.board[m.from];
  const capSq = m.ep ? m.to - 8 * fwd(attacker.owner) : m.to;
  const defender = s.board[capSq];
  const odds = spinOdds(attacker.type, defender.type);
  const r = Number.isFinite(roll) && roll >= 0 && roll < 1 ? roll : Math.random();
  return { color: attacker.owner, attacker: attacker.type, defender: defender.type, from: m.from, to: m.to, capSq, odds, roll: r, won: r < odds };
}
/** What a capture's spin will do, without playing it. Null if the move isn't a legal capture. */
function previewSpin(s, move) {
  const legal = legalMoves(s, move.from, { traitor: !!move.traitor }).find((m) => m.to === move.to);
  return legal && legal.capture ? spinFor(s, legal, move.roll) : null;
}
/** The attacker loses: it's removed and the defender stays. If that exposes the king, the attacker's side moves again. */
function loseSpin(s, m, spin) {
  const me = s.turn, foe = other(me);
  s.board[m.from] = null;
  s.captured[foe].push({ type: spin.attacker, by: spin.defender, owner: me });
  s.coins[foe] += PIECE_VALUE[spin.attacker];
  s.coins[me] += LOST_SPIN_COINS;
  s.ep = null;
  s.halfmove = 0;
  s.lastExplosion = null;
  s.lastMove = { from: m.from, to: m.to };
  const label = spin.attacker === 'P' ? FILES[fileOf(m.from)] : spin.attacker;
  const text = `${label}x${sqName(m.to)} (lost)`;
  const entry = { color: me, text };
  addNote(entry, `[wheel] lost the spin at ${pct(spin.odds)}`);
  s.history.push(entry);
  const exposed = inCheck(s.board, me);
  if (exposed) addNote(entry, 'king exposed: moves again');
  s.turn = exposed ? me : foe;
  s.turns[me]++;
  s.ply++;
  afterTurn(s, entry);
  if (exposed) entry.text = text; // the check is on the player who just moved, so no + or # on their move
}
/** Empty squares in your half where a bought piece may go. It can block a check, but can't give one. */
function legalDrops(s, c, type) {
  if (!s.twists.gambler || s.result || !PRICES[type]) return [];
  const out = [];
  for (let i = 0; i < 64; i++) {
    const r = rankOf(i);
    if (s.board[i] || (c === W ? r > 3 : r < 4)) continue;
    if (type === 'P' && r === homeRank(c)) continue;
    const b = s.board.slice();
    b[i] = { id: -1, owner: c, type, shown: type, moved: true };
    if (!inCheck(b, c) && !inCheck(b, other(c))) out.push(i);
  }
  return out;
}
function buyPiece(s, type, at) {
  const me = s.turn;
  if (!s.twists.gambler || s.coins[me] < (PRICES[type] ?? Infinity)) throw new Error('Not enough coins');
  if (!legalDrops(s, me, type).includes(at)) throw new Error('Illegal placement');
  recordStart(s);
  s.coins[me] -= PRICES[type];
  s.board[at] = { id: s.nextId++, owner: me, type, shown: type, moved: true };
  s.lastSpin = null;
  s.lastExplosion = null;
  s.ep = null;
  s.halfmove++;
  s.lastMove = { from: at, to: at };
  const entry = { color: me, text: `${type}@${sqName(at)}`, note: `[coin] bought for ${PRICES[type]}` };
  s.history.push(entry);
  s.turn = other(me);
  s.turns[me]++;
  s.ply++;
  afterTurn(s, entry);
}

// ---------------------------------------------------------------- Power Chess
const POWER_RECHARGE = 3;
const POWERS = {
  snake: { name: 'Snake', game: true, desc: 'Both players play Snake at the same time. Whoever survives longest gets a Snake piece, which moves like a king, a queen and a knight combined.' },
  tug: { name: 'Tug of War', game: true, desc: 'Tap as fast as you can for 5 seconds. The winner gets a free push: move one enemy piece one square.' },
  asteroids: { name: 'Asteroid Dodge', game: true, desc: 'Dodge falling rocks. Whoever survives longest gets a double move on their next turn.' },
  rewind: { name: 'Time Rewind', desc: "Undo your last move and your opponent's reply. It's your turn again." },
  banana: { name: 'Banana Peel', desc: 'Hide a peel on an empty square. An enemy piece (not the king) that stops on it keeps sliding until something blocks it.' },
  portals: { name: 'Portals', desc: 'Place two linked portals for 5 turns. A piece (not a king) that stops on one comes out of the other.' },
  quake: { name: 'Earthquake', desc: 'Shake a row: its pieces slide one square left or right. Kings and walls stay put.' },
  piston: { name: 'Piston', desc: 'Shove any piece (not a king) one square. Pieces lined up behind it get shoved too.' },
  magnet: { name: 'Magnet', desc: 'Pick a square. Enemy pieces in its row and column are pulled one square toward it.' },
  tornado: { name: 'Tornado', desc: 'Spin a 3×3 area a quarter turn clockwise. It can’t include a king or wall.' },
  bowling: { name: 'Bowling Ball', desc: 'Roll a ball up a column from your side. Each piece it hits is knocked one square aside, until it reaches a king or wall.' },
  blower: { name: 'Leaf Blower', desc: 'Blow every enemy pawn in a row one square back.' },
  wall: { name: 'Brick Wall', desc: 'Build two walls on empty squares for 3 turns. Nothing can pass through, land on or capture them.' },
};
const POWER_IDS = Object.keys(POWERS);
const PRIZE_TEXT = { snake: 'a Snake piece', tug: 'a free push', asteroids: 'a double move' };

/** Seeded random numbers kept in the game, so both online players draw the same powers. */
function rand(s) {
  let t = (s.seed = (s.seed + 0x6D2B79F5) | 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function drawPower(s, c) {
  const held = s.powers[c].map((x) => x.id);
  const pool = POWER_IDS.filter((id) => !held.includes(id));
  return pool[Math.floor(rand(s) * pool.length)];
}
/** One of `c`'s turns ended: recharging slots count down and come back as a new random power. */
function tickPowers(s, c) {
  for (const pw of s.powers[c]) {
    if (!pw.wait) continue;
    pw.wait--;
    if (!pw.wait) pw.id = drawPower(s, c);
  }
}
function expireEffects(s) {
  const justMoved = other(s.turn);
  s.walls = s.walls.filter((w) => {
    if (s.ply < w.until) return true;
    if (!s.board[w.sq] || s.board[w.sq].id !== w.id) return false;
    const b = s.board.slice();
    b[w.sq] = null;
    if (inCheck(b, justMoved)) return true; // a wall still shielding the king of whoever just moved holds until it's safe
    s.board[w.sq] = null;
    return false;
  });
  for (const c of [W, B]) if (s.portals[c] && s.ply >= s.portals[c].until) s.portals[c] = null;
}

const SNAP_KEYS = ['board', 'turn', 'ep', 'captured', 'lastMove', 'halfmove', 'check', 'walls', 'portals', 'bananas', 'bonusPending', 'bonusNow', 'stats', 'freePush', 'ply'];
const copy = (v) => JSON.parse(JSON.stringify(v));
/** Remember the position before each action, for Time Rewind. */
function pushSnap(s) {
  if (!s.twists.powers) return;
  const snap = copy(Object.fromEntries(SNAP_KEYS.map((k) => [k, s[k]])));
  snap.histLen = s.history.length;
  s.snaps.push(snap);
  if (s.snaps.length > 2) s.snaps.shift();
}

/** Rewinding must leave you something to play, even with this power then recharging. */
function rewindLeavesMove(s, c, slot) {
  const t = { ...s, ...copy(s.snaps[0]), powers: copy(s.powers), snaps: [], minigame: null, result: null };
  t.powers[c][slot].wait = 1;
  return hasAnyMove(t, c);
}
const movable = (p) => !!p && p.type !== 'K' && p.type !== 'X';
const shiftPc = (b, from, to) => { b[to] = b[from]; b[from] = null; };
const sign = (n) => (n > 0 ? 1 : n < 0 ? -1 : 0);

// Each board power returns the new board, or null if it would do nothing.
function fxPiston(b0, c, { from, to }) {
  const df = fileOf(to) - fileOf(from), dr = rankOf(to) - rankOf(from);
  if (Math.max(Math.abs(df), Math.abs(dr)) !== 1 || !movable(b0[from])) return null;
  const chain = [];
  let f = fileOf(from), r = rankOf(from);
  while (onBoard(f, r) && b0[sq(f, r)]) {
    if (!movable(b0[sq(f, r)])) return null;
    chain.push(sq(f, r));
    f += df; r += dr;
  }
  if (!onBoard(f, r)) return null;
  const b = b0.slice();
  for (let i = chain.length - 1; i >= 0; i--) shiftPc(b, chain[i], chain[i] + df + 8 * dr);
  return b;
}
function fxMagnet(b0, c, { at }) {
  const b = b0.slice();
  let moved = false;
  for (const [df, dr] of ROOK) {
    let f = fileOf(at) + df, r = rankOf(at) + dr;
    while (onBoard(f, r)) {
      const i = sq(f, r), p = b[i], j = sq(f - df, r - dr);
      if (p && p.owner === other(c) && movable(p) && !b[j]) { shiftPc(b, i, j); moved = true; }
      f += df; r += dr;
    }
  }
  return moved ? b : null;
}
const RING = [[-1, 1], [0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0]]; // clockwise, as White sees it
function fxTornado(b0, c, { at }) {
  const f0 = fileOf(at), r0 = rankOf(at);
  if (f0 < 1 || f0 > 6 || r0 < 1 || r0 > 6) return null;
  const ring = RING.map(([df, dr]) => sq(f0 + df, r0 + dr));
  if ([at, ...ring].some((i) => b0[i] && !movable(b0[i])) || !ring.some((i) => b0[i])) return null;
  const b = b0.slice();
  ring.forEach((i, k) => { b[ring[(k + 2) % 8]] = b0[i]; });
  return b;
}
function fxBowling(b0, c, { file }) {
  const b = b0.slice(), side = file < 4 ? -1 : 1;
  let moved = false;
  for (let k = 0; k < 8; k++) {
    const r = c === W ? k : 7 - k, i = sq(file, r), p = b[i];
    if (!p) continue;
    if (!movable(p)) break; // the ball stops at a king or a wall
    for (const d of [side, -side]) {
      const f = file + d;
      if (f >= 0 && f < 8 && !b[sq(f, r)]) { shiftPc(b, i, sq(f, r)); moved = true; break; }
    }
  }
  return moved ? b : null;
}
function fxBlower(b0, c, { rank }) {
  const e = other(c), b = b0.slice(), r2 = rank - fwd(e);
  let moved = false;
  if (r2 < 0 || r2 > 7 || r2 === homeRank(e)) return null;
  for (let f = 0; f < 8; f++) {
    const p = b[sq(f, rank)];
    if (p && p.owner === e && p.type === 'P' && !b[sq(f, r2)]) { shiftPc(b, sq(f, rank), sq(f, r2)); moved = true; }
  }
  return moved ? b : null;
}
function fxQuake(b0, c, { rank, dir }) {
  const b = b0.slice();
  let moved = false;
  for (const f of dir > 0 ? [6, 5, 4, 3, 2, 1, 0] : [1, 2, 3, 4, 5, 6, 7]) {
    const i = sq(f, rank), j = sq(f + dir, rank);
    if (movable(b[i]) && !b[j]) { shiftPc(b, i, j); moved = true; }
  }
  return moved ? b : null;
}
const BOARD_FX = { piston: fxPiston, magnet: fxMagnet, tornado: fxTornado, bowling: fxBowling, blower: fxBlower, quake: fxQuake };
const range8 = (fn) => Array.from({ length: 8 }, (_, k) => fn(k));

/**
 * Every way `c` can use the power in `slot` right now: [{ args, clicks }].
 * `clicks[i]` lists the squares that count as the i-th click (a whole row for Leaf Blower, either end of a pair, …).
 * No power may leave your own king in check.
 */
function powerOptions(s, c, slot) {
  const pw = s.powers[c] && s.powers[c][slot];
  if (!s.twists.powers || !pw || pw.wait || s.result || s.minigame || s.turn !== c) return [];
  const b = s.board, out = [], id = pw.id, checked = inCheck(b, c);
  const empties = [];
  for (let i = 0; i < 64; i++) {
    const onTrap = s.bananas.w.includes(i) || s.bananas.b.includes(i) || [W, B].some((x) => s.portals[x] && (s.portals[x].a === i || s.portals[x].b === i));
    if (!b[i] && !onTrap) empties.push(i);
  }
  const pairs = (fn) => { for (let x = 0; x < empties.length; x++) for (let y = x + 1; y < empties.length; y++) fn(empties[x], empties[y]); };
  const add = (args, clicks, nb) => { if (nb && !inCheck(promoted(nb), c)) out.push({ args, clicks }); };
  switch (id) {
    case 'snake': case 'tug': case 'asteroids':
      if (!checked) out.push({ args: {}, clicks: [] });
      break;
    case 'rewind':
      if (s.snaps.length === 2 && s.snaps[0].turn === c && rewindLeavesMove(s, c, slot)) out.push({ args: {}, clicks: [] });
      break;
    case 'banana':
      if (!checked) for (const i of empties) out.push({ args: { at: i }, clicks: [[i]] });
      break;
    case 'portals':
      if (!checked) pairs((x, y) => out.push({ args: { a: x, b: y }, clicks: [[x, y], [x, y]] }));
      break;
    case 'wall':
      pairs((x, y) => {
        const nb = b.slice();
        nb[x] = nb[y] = { id: -1, owner: 'x', type: 'X', shown: 'X', moved: true };
        add({ a: x, b: y }, [[x, y], [x, y]], nb);
      });
      break;
    case 'piston':
      for (let i = 0; i < 64; i++) {
        if (!movable(b[i])) continue;
        for (const [df, dr] of KING) {
          const f = fileOf(i) + df, r = rankOf(i) + dr;
          if (onBoard(f, r)) add({ from: i, to: sq(f, r) }, [[i], [sq(f, r)]], fxPiston(b, c, { from: i, to: sq(f, r) }));
        }
      }
      break;
    case 'magnet': case 'tornado':
      for (let i = 0; i < 64; i++) add({ at: i }, [[i]], BOARD_FX[id](b, c, { at: i }));
      break;
    case 'bowling':
      for (let f = 0; f < 8; f++) add({ file: f }, [range8((r) => sq(f, r))], fxBowling(b, c, { file: f }));
      break;
    case 'blower':
      for (let r = 0; r < 8; r++) add({ rank: r }, [range8((f) => sq(f, r))], fxBlower(b, c, { rank: r }));
      break;
    case 'quake':
      for (let r = 0; r < 8; r++) for (const dir of [-1, 1]) {
        add({ rank: r, dir }, [range8((f) => sq(f, r)).filter((i) => (dir < 0 ? fileOf(i) < 4 : fileOf(i) >= 4))], fxQuake(b, c, { rank: r, dir }));
      }
      break;
  }
  return out;
}

/** The board with any pawn that a power left on its last rank shown as the queen it becomes. */
function promoted(b) {
  return b.map((p, i) => (p && p.type === 'P' && rankOf(i) === lastRank(p.owner) ? { ...p, type: 'Q', shown: 'Q' } : p));
}
const canon = (o) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
/** Put a power's new board in place: moved pieces lose castling rights, pawns that reach the end promote. */
function placeBoard(s, nb) {
  for (let i = 0; i < 64; i++) if (nb[i] && nb[i] !== s.board[i]) nb[i].moved = true;
  s.board = nb;
  for (let i = 0; i < 64; i++) {
    const p = nb[i];
    if (p && p.type === 'P' && rankOf(i) === lastRank(p.owner)) { p.type = p.shown = 'Q'; s.stats[p.owner].promotions++; }
  }
}
function endPowerTurn(s, me, entry) {
  s.turn = other(me);
  s.turns[me]++;
  tickPowers(s, me);
  s.ply++;
  expireEffects(s);
  afterTurn(s, entry);
}
/** Use the power in `slot`. Minigames start here and finish with finishMinigame(). */
function usePower(s, slot, args = {}) {
  const me = s.turn;
  if (args.a != null && args.b != null && args.a > args.b) args = { ...args, a: args.b, b: args.a };
  const key = canon(args);
  if (!powerOptions(s, me, slot).some((o) => canon(o.args) === key)) throw new Error('Power not available');
  recordStart(s);
  const pw = s.powers[me][slot], id = pw.id;
  if (id === 'rewind') {
    const snap = copy(s.snaps[0]);
    for (const k of SNAP_KEYS) s[k] = snap[k];
    s.history.length = snap.histLen;
    s.history.push({ color: me, text: '[rewind] Time Rewind', note: 'the last two moves were undone' });
    s.snaps = [];
    s.lastSpin = null; s.lastExplosion = null; s.minigame = null;
    pw.wait = POWER_RECHARGE; // it isn't a turn, so it starts counting from your next one
    return;
  }
  pushSnap(s);
  if (s.bonusPending === me) s.bonusPending = null;
  if (s.bonusNow === me) s.bonusNow = null;
  if (s.freePush === me) s.freePush = null;
  pw.wait = POWER_RECHARGE + 1; // ticks down once as this turn ends
  if (POWERS[id].game) { s.minigame = { id, by: me, seed: Math.floor(rand(s) * 4294967296) | 0 }; return; }
  const entry = { color: me, text: `[${id}] ${POWERS[id].name}` };
  if (BOARD_FX[id]) placeBoard(s, BOARD_FX[id](s.board, me, args));
  if (id === 'wall') {
    for (const i of [args.a, args.b]) {
      const w = { id: s.nextId++, owner: 'x', type: 'X', shown: 'X', moved: true };
      s.board[i] = w;
      s.walls.push({ id: w.id, sq: i, until: s.ply + 6 });
    }
    entry.note = `on ${sqName(args.a)} and ${sqName(args.b)}`;
  }
  if (id === 'banana') { s.bananas[me].push(args.at); entry.note = 'hidden somewhere'; }
  if (id === 'portals') { s.portals[me] = { a: args.a, b: args.b, until: s.ply + 10 }; entry.note = `${sqName(args.a)} ↔ ${sqName(args.b)}`; }
  if (id === 'piston') entry.note = `${sqName(args.from)} → ${sqName(args.to)}`;
  if (id === 'magnet' || id === 'tornado') entry.note = `on ${sqName(args.at)}`;
  if (id === 'bowling') entry.note = `${FILES[args.file]}-file`;
  if (id === 'blower' || id === 'quake') entry.note = `rank ${args.rank + 1}${id === 'quake' ? (args.dir < 0 ? ', left' : ', right') : ''}`;
  s.history.push(entry);
  s.lastMove = null; s.lastSpin = null; s.lastExplosion = null; s.ep = null;
  s.halfmove++;
  endPowerTurn(s, me, entry);
}

/** Both players' minigame scores are in: award the prize and end the turn of whoever started it. */
function finishMinigame(s, scores) {
  const mg = s.minigame;
  if (!mg) throw new Error('No minigame');
  const me = mg.by;
  s.minigame = null;
  const sw = Number(scores.w) || 0, sb = Number(scores.b) || 0;
  const winner = sw === sb ? null : sw > sb ? W : B;
  const entry = { color: me, text: `[${mg.id}] ${POWERS[mg.id].name}` };
  let note = winner ? `${winner === W ? 'White' : 'Black'} won ${PRIZE_TEXT[mg.id]}` : 'a tie: no prize';
  if (winner && mg.id === 'snake') {
    const spot = [0, 1, 2, 3].flatMap((d) => [3, 4, 2, 5, 1, 6, 0, 7].map((f) => sq(f, homeRank(winner) + d * fwd(winner)))) // nearest empty square to home
      .find((i) => { if (s.board[i]) return false; const b = s.board.slice(); b[i] = { owner: winner, type: 'S' }; return !inCheck(b, other(winner)); });
    if (spot != null) { s.board[spot] = { id: s.nextId++, owner: winner, type: 'S', shown: 'S', moved: true }; note += ` on ${sqName(spot)}`; }
    else note += ', but there was no room for it';
  }
  if (winner && mg.id === 'asteroids') s.bonusPending = winner;
  if (winner && mg.id === 'tug') s.freePush = winner;
  entry.note = note;
  s.history.push(entry);
  s.lastMove = null; s.lastSpin = null; s.lastExplosion = null; s.ep = null;
  s.halfmove++;
  endPowerTurn(s, me, entry);
  return winner;
}

/** Tug of War prize: on your turn, before moving, push one enemy piece (not the king) one square into an empty square. */
function freePushOptions(s, c) {
  if (s.freePush !== c || s.turn !== c || s.result || s.minigame) return [];
  const out = [];
  for (let i = 0; i < 64; i++) {
    const p = s.board[i];
    if (!movable(p) || p.owner !== other(c)) continue;
    for (const [df, dr] of KING) {
      const f = fileOf(i) + df, r = rankOf(i) + dr;
      if (!onBoard(f, r) || s.board[sq(f, r)]) continue;
      const nb = s.board.slice();
      shiftPc(nb, i, sq(f, r));
      const pb = promoted(nb);
      if (!inCheck(pb, c) && !inCheck(pb, other(c))) out.push({ args: { from: i, to: sq(f, r) }, clicks: [[i], [sq(f, r)]] });
    }
  }
  return out;
}
function freePush(s, from, to) {
  const me = s.turn;
  if (!freePushOptions(s, me).some((o) => o.args.from === from && o.args.to === to)) throw new Error('Push not available');
  const nb = s.board.slice();
  shiftPc(nb, from, to);
  placeBoard(s, nb);
  s.freePush = null;
  s.ep = null;
  s.lastMove = { from, to };
  s.history.push({ color: me, text: '[tug] Free push', note: `${sqName(from)} → ${sqName(to)}` });
  if (!hasAnyMove(s, me)) end(s, null, 'stalemate'); // the push left you nothing to play
}

/** After a move lands: enemy banana peels make it slide, portals warp it. Kings are never affected. */
function landEffects(s, m, me) {
  const notes = [];
  let at = m.to;
  const p = s.board[at];
  if (!p || p.type === 'K') return notes;
  const safeTo = (to) => { const b = s.board.slice(); b[to] = p; b[at] = null; return !inCheck(b, me); };
  const peels = s.bananas[other(me)], k = peels.indexOf(at);
  if (k >= 0) {
    peels.splice(k, 1);
    let df = fileOf(m.to) - fileOf(m.from), dr = rankOf(m.to) - rankOf(m.from);
    if (df && dr && Math.abs(df) !== Math.abs(dr)) { if (Math.abs(df) > Math.abs(dr)) dr = 0; else df = 0; } // a knight slides along its long leg
    df = sign(df); dr = sign(dr);
    for (;;) {
      const f = fileOf(at) + df, r = rankOf(at) + dr;
      if (!onBoard(f, r) || s.board[sq(f, r)] || !safeTo(sq(f, r))) break;
      shiftPc(s.board, at, sq(f, r));
      at = sq(f, r);
    }
    notes.push(at === m.to ? '[banana] slipped on a peel but was blocked' : `[banana] slipped to ${sqName(at)}`);
  }
  for (const c of [W, B]) {
    const pr = s.portals[c];
    if (!pr || (pr.a !== at && pr.b !== at)) continue;
    const dest = pr.a === at ? pr.b : pr.a;
    if (!s.board[dest] && safeTo(dest)) { shiftPc(s.board, at, dest); at = dest; notes.push(`[portals] warped to ${sqName(at)}`); }
    break;
  }
  if (at !== m.to) {
    s.ep = null;
    s.lastMove = { from: m.from, to: at };
    if (p.type === 'P' && rankOf(at) === lastRank(p.owner)) { p.type = p.shown = 'Q'; s.stats[p.owner].promotions++; }
  }
  return notes;
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
  s.turns[me]++;
  s.ep = null;
  s.halfmove++;
  s.lastMove = null;
  const entry = { color: me, text: '[swap] secret swap' };
  s.history.push(entry);
  s.turn = other(me);
  s.ply++;
  afterTurn(s, entry);
}

/** Squares a piece could ever reach from `from`, ignoring other pieces: what a premove may aim at. */
function premoveTargets(type, from, color) {
  const out = [], f0 = fileOf(from), r0 = rankOf(from);
  const add = (f, r) => { if (onBoard(f, r)) out.push(sq(f, r)); };
  const rays = (dirs) => { for (const [df, dr] of dirs) for (let k = 1; k < 8; k++) add(f0 + df * k, r0 + dr * k); };
  if (type === 'N' || type === 'S') for (const [df, dr] of KNIGHT) add(f0 + df, r0 + dr);
  if (type === 'K') for (const [df, dr] of KING) add(f0 + df, r0 + dr);
  if (type === 'R' || type === 'Q' || type === 'S') rays(ROOK);
  if (type === 'B' || type === 'Q' || type === 'S') rays(BISHOP);
  if (type === 'P') {
    const d = fwd(color);
    add(f0, r0 + d); add(f0 - 1, r0 + d); add(f0 + 1, r0 + d);
    if (r0 === pawnRank(color)) add(f0, r0 + 2 * d);
  }
  return out;
}

function resign(s, c) { end(s, other(c), 'won by resignation'); }

/** Whether `c` still has enough material to ever checkmate (bare king, or king + one minor piece, can't). */
function canCheckmate(board, c) {
  const rest = board.filter((p) => p && p.owner === c && p.type !== 'K');
  if (rest.length === 0) return false;
  if (rest.length === 1 && (rest[0].type === 'B' || rest[0].type === 'N')) return false;
  return true;
}
/** `c` ran out of time: they lose, unless the opponent couldn't checkmate anyway (then it's a draw). */
function timeout(s, c) {
  if (s.twists.gambler || canCheckmate(s.board, other(c))) end(s, other(c), 'won on time'); // the shop can always buy more material
  else end(s, null, 'timeout vs insufficient material');
}
function agreeDraw(s) { end(s, null, 'agreement'); }

globalThis.TGEngine = {
  W, B, other, FILES, sq, fileOf, rankOf, sqName, PIECE_NAME, PIECE_VALUE, PROMOTIONS, OBJECTIVES, objectiveById,
  newGame, prophecyReady, prophecyWait, PROPHECY_RECHARGE, setHiddenQueen, setTraitor, toggleMine, setMines, setShifter, MINES, findById, legalMoves, hasAnyMove, canSwap, inCheck, kingSq, makeMove, doSwap,
  POWERS, POWER_RECHARGE, powerOptions, usePower, finishMinigame, freePushOptions, freePush,
  PRICES, spinOdds, previewSpin, legalDrops, buyPiece, premoveTargets, resign, agreeDraw, timeout, canCheckmate, positionKey, insufficientMaterial,
};
})();
