(function () {
// Plain script: works in a browser (after js/engine.js) and in Node (node tests/engine.test.js).
const E = globalThis.TGEngine || (require('../js/engine.js'), globalThis.TGEngine);

const results = [];
function test(name, fn) {
  try { fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, err: e.message }); }
}
function eq(a, b, msg = '') { if (a !== b) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); }
function ok(v, msg = 'expected truthy') { if (!v) throw new Error(msg); }
const S = (name) => E.FILES.indexOf(name[0]) + (Number(name[1]) - 1) * 8;
const mv = (s, from, to, extra = {}) => E.makeMove(s, { from: S(from), to: S(to), ...extra });
const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
const countMoves = (s) => s.board.reduce((n, p, i) => n + (p && p.owner === s.turn ? E.legalMoves(s, i).length : 0), 0);

test('standard opening position has 20 moves', () => {
  eq(countMoves(E.newGame()), 20);
});

test('capturing the king wins', () => {
  const s = E.newGame();
  mv(s, 'e2', 'e4'); mv(s, 'f7', 'f6'); mv(s, 'd1', 'h5'); mv(s, 'a7', 'a6'); mv(s, 'h5', 'e8');
  eq(s.result.winner, 'w');
});

test('castling kingside moves the rook', () => {
  const s = E.newGame();
  mv(s, 'e2', 'e4'); mv(s, 'a7', 'a6'); mv(s, 'g1', 'f3'); mv(s, 'a6', 'a5'); mv(s, 'f1', 'c4'); mv(s, 'a5', 'a4');
  mv(s, 'e1', 'g1');
  eq(s.board[S('f1')].type, 'R');
  eq(s.board[S('g1')].type, 'K');
});

test('en passant', () => {
  const s = E.newGame();
  mv(s, 'e2', 'e4'); mv(s, 'a7', 'a6'); mv(s, 'e4', 'e5'); mv(s, 'd7', 'd5');
  mv(s, 'e5', 'd6');
  eq(s.board[S('d5')], null);
  eq(s.captured.w[0].type, 'P');
});

test('hidden queen moves like a pawn while disguised, then reveals', () => {
  const s = E.newGame({ hiddenQueen: true });
  eq(s.board[S('d1')], null);
  ok(E.setHiddenQueen(s, 'w', S('e2')));
  const q = s.board[S('e2')];
  eq(q.type, 'Q'); eq(q.shown, 'P');
  mv(s, 'e2', 'e4');
  eq(q.shown, 'P', 'pawn-like double step keeps disguise');
  mv(s, 'a7', 'a6');
  mv(s, 'e4', 'h7'); // diagonal capture far away: only a queen could
  eq(q.shown, 'Q');
  ok(s.history[2].text.includes('(Q!)'));
});

test('traitor moves an enemy piece once', () => {
  const s = E.newGame({ traitor: true });
  ok(E.setTraitor(s, 'w', S('g8')));
  ok(!E.setTraitor(s, 'b', S('e1')), 'king cannot be traitor');
  mv(s, 'g8', 'f6', { traitor: true });
  eq(s.board[S('f6')].owner, 'b', 'piece still belongs to black');
  ok(s.traitor.w.used);
  eq(s.turn, 'b');
});

test('traitor can capture its own side', () => {
  const s = E.newGame({ traitor: true });
  E.setTraitor(s, 'w', S('d8'));
  mv(s, 'e2', 'e4'); mv(s, 'e7', 'e5');
  mv(s, 'd8', 'h4', { traitor: true }); // black queen out
  mv(s, 'a7', 'a6');
  ok(s.traitor.w.used);
  let threw = false;
  try { mv(s, 'h4', 'f2', { traitor: true }); } catch { threw = true; }
  ok(threw, 'traitor is single-use');
});

test('hidden objective win', () => {
  const s = E.newGame({ objective: true }, seq([0]));
  s.objectives.w = 'promote';
  s.board[S('a7')] = null; s.board[S('a8')] = null;
  s.board[S('a7')] = { id: 999, owner: 'w', type: 'P', shown: 'P', moved: true };
  mv(s, 'a7', 'a8');
  eq(s.result.winner, 'w');
  ok(s.result.reason.includes('objective'));
});

test('objectives are drawn distinct', () => {
  const s = E.newGame({ objective: true });
  ok(s.objectives.w && s.objectives.b && s.objectives.w !== s.objectives.b);
});

test('secret swap exchanges identities but not looks', () => {
  const s = E.newGame({ swap: true });
  E.doSwap(s, S('b1'), S('c1'));
  const a = s.board[S('b1')], b = s.board[S('c1')];
  eq(a.type, 'B'); eq(a.shown, 'N');
  eq(b.type, 'N'); eq(b.shown, 'B');
  ok(s.swapUsed.w);
  eq(s.history[0].text, '⇄ secret swap');
  let threw = false;
  try { E.doSwap(s, S('e1'), S('d8')); } catch { threw = true; }
  ok(threw);
});

test('swapped piece reveals on inconsistent move', () => {
  const s = E.newGame({ swap: true });
  E.doSwap(s, S('d2'), S('g1')); // d2 "pawn" is really a knight
  mv(s, 'a7', 'a6');
  mv(s, 'd2', 'c4'); // knight jump — impossible for a pawn
  eq(s.board[S('c4')].shown, 'N');
});

test('bluff: everything hidden, queen+knight geometry allowed', () => {
  const s = E.newGame({ bluff: true, hiddenQueen: true }, seq([0.3, 0.7, 0.1]));
  eq(s.twists.hiddenQueen, false, 'bluff excludes hidden queen');
  ok(s.board.every((p) => !p || p.shown === null));
  // a piece on rank 2 with an empty square ahead can claim forward moves
  ok(countMoves(s) > 0);
});

function bluffGameWithKnightOn(sqName) {
  const s = E.newGame({ bluff: true }, seq([0.5]));
  // Put a known white knight on the given square for a deterministic check.
  s.board[S(sqName)] = { id: 500, owner: 'w', type: 'N', shown: null, moved: false };
  return s;
}

test('bluff caught: move undone and piece removed', () => {
  const s = bluffGameWithKnightOn('d2');
  s.board[S('d3')] = null; s.board[S('d4')] = null;
  mv(s, 'd2', 'd4'); // knight claiming a straight move = bluff
  ok(s.pending && !s.pending.honest);
  const r = E.resolveChallenge(s, true);
  eq(r.outcome, 'caught');
  eq(s.board[S('d4')], null);
  eq(s.board[S('d2')], null, 'bluffing piece removed');
  eq(s.turn, 'b');
  ok(s.history[0].caught);
});

test('bluff honest: challenger loses a random piece', () => {
  const s = bluffGameWithKnightOn('d2');
  s.board[S('c4')] = null;
  mv(s, 'd2', 'c4'); // honest knight move
  const before = s.board.filter((p) => p && p.owner === 'b').length;
  const r = E.resolveChallenge(s, true, () => 0);
  eq(r.outcome, 'honest');
  eq(s.board.filter((p) => p && p.owner === 'b').length, before - 1);
  eq(s.board[S('c4')].shown, 'N', 'honest piece revealed');
});

test('bluff king capture only counts after acceptance', () => {
  const s = E.newGame({ bluff: true }, seq([0.5]));
  s.board.fill(null);
  s.board[S('a1')] = { id: 1, owner: 'w', type: 'R', shown: null, moved: true };
  s.board[S('h1')] = { id: 2, owner: 'w', type: 'K', shown: null, moved: true };
  s.board[S('a8')] = { id: 3, owner: 'b', type: 'K', shown: null, moved: true };
  s.board[S('h8')] = { id: 4, owner: 'b', type: 'P', shown: null, moved: true };
  mv(s, 'a1', 'a8');
  eq(s.result, null, 'not over until black answers');
  E.resolveChallenge(s, false);
  eq(s.result.winner, 'w');
});


globalThis.TGTestResults = results;

// Node runner
if (typeof window === 'undefined') {
  for (const r of results) console.log(`${r.ok ? '✓' : '✗'} ${r.name}${r.ok ? '' : ' — ' + r.err}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  process.exitCode = failed ? 1 : 0;
}
})();
