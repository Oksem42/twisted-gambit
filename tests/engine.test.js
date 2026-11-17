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
const throws = (fn) => { try { fn(); } catch { return true; } return false; };
const seq = (vals) => { let i = 0; return () => vals[i++ % vals.length]; };
const countMoves = (s) => s.board.reduce((n, p, i) => n + (p && p.owner === s.turn ? E.legalMoves(s, i).length : 0), 0);
const targets = (s, from) => E.legalMoves(s, S(from)).map((m) => E.sqName(m.to)).sort().join(',');

/** Empty board with the given pieces, e.g. { e1: 'wK', e8: 'bK', a1: 'wR' }. Pieces count as moved unless `fresh`. */
function position(map, turn = 'w', twists = {}, fresh = false) {
  const s = E.newGame(twists);
  s.board.fill(null);
  for (const [k, v] of Object.entries(map)) {
    s.board[S(k)] = { id: s.nextId++, owner: v[0], type: v[1], shown: v[1], moved: !fresh };
  }
  s.turn = turn;
  return s;
}

// ------------------------------------------------ standard rules
test('opening position has 20 legal moves', () => eq(countMoves(E.newGame()), 20));

test("fool's mate is checkmate", () => {
  const s = E.newGame();
  mv(s, 'f2', 'f3'); mv(s, 'e7', 'e5'); mv(s, 'g2', 'g4'); mv(s, 'd8', 'h4');
  eq(s.result.winner, 'b'); eq(s.result.reason, 'won by checkmate');
  eq(s.history[3].text, 'Qh4#');
});

test('kings are never captured; you must answer check', () => {
  const s = position({ e1: 'wK', e8: 'bK', e2: 'bQ', a2: 'wP' }, 'w');
  eq(targets(s, 'a2'), '', 'pawn move ignores the check, so it is illegal');
  eq(targets(s, 'e1'), 'e2', 'the queen covers every escape, so the king must capture it');
});

test('cannot move into check', () => {
  const s = position({ e1: 'wK', e8: 'bK', d8: 'bR' }, 'w');
  ok(!targets(s, 'e1').includes('d1') && !targets(s, 'e1').includes('d2'));
});

test('kings may not stand next to each other', () => {
  const s = position({ e4: 'wK', e6: 'bK' }, 'w');
  ok(!targets(s, 'e4').split(',').some((t) => t.endsWith('5')));
});

test('pinned piece cannot leave the pin line', () => {
  const s = position({ e1: 'wK', e2: 'wB', e8: 'bR', h8: 'bK' }, 'w');
  eq(targets(s, 'e2'), '');
  const s2 = position({ e1: 'wK', e2: 'wR', e8: 'bR', h8: 'bK' }, 'w');
  eq(targets(s2, 'e2'), 'e3,e4,e5,e6,e7,e8', 'rook may slide along the pin');
});

test('check is announced with +', () => {
  const s = E.newGame();
  mv(s, 'e2', 'e4'); mv(s, 'f7', 'f6'); mv(s, 'd1', 'h5');
  eq(s.history[2].text, 'Qh5+'); eq(s.check, 'b');
});

test('stalemate is a draw', () => {
  const s = position({ a8: 'bK', c7: 'wQ', h1: 'wK' }, 'w');
  mv(s, 'c7', 'b6');
  eq(s.result.winner, null); eq(s.result.reason, 'stalemate');
});

test('castling both sides when legal', () => {
  const s = position({ e1: 'wK', a1: 'wR', h1: 'wR', e8: 'bK' }, 'w', {}, true);
  ok(targets(s, 'e1').includes('g1') && targets(s, 'e1').includes('c1'));
  mv(s, 'e1', 'c1');
  eq(s.board[S('d1')].type, 'R'); eq(s.history[0].text, 'O-O-O');
});

test('no castling out of, through, or into check', () => {
  const inCheck = position({ e1: 'wK', h1: 'wR', e8: 'bK', e5: 'bR' }, 'w', {}, true);
  ok(!targets(inCheck, 'e1').includes('g1'), 'out of check');
  const through = position({ e1: 'wK', h1: 'wR', e8: 'bK', f5: 'bR' }, 'w', {}, true);
  ok(!targets(through, 'e1').includes('g1'), 'through f1');
  const into = position({ e1: 'wK', h1: 'wR', e8: 'bK', g5: 'bR' }, 'w', {}, true);
  ok(!targets(into, 'e1').includes('g1'), 'into g1');
});

test('queenside castling allowed when only b1 is attacked', () => {
  const s = position({ e1: 'wK', a1: 'wR', e8: 'bK', b5: 'bR' }, 'w', {}, true);
  ok(targets(s, 'e1').includes('c1'));
});

test('no castling after the king or rook has moved', () => {
  const s = position({ e1: 'wK', h1: 'wR', e8: 'bK', a8: 'bR' }, 'w', {}, true);
  mv(s, 'h1', 'h2'); mv(s, 'a8', 'a7'); mv(s, 'h2', 'h1'); mv(s, 'a7', 'a8');
  ok(!targets(s, 'e1').includes('g1'));
});

test('en passant only on the very next move', () => {
  const s = E.newGame();
  mv(s, 'e2', 'e4'); mv(s, 'a7', 'a6'); mv(s, 'e4', 'e5'); mv(s, 'd7', 'd5');
  ok(targets(s, 'e5').includes('d6'), 'available immediately');
  const s2 = E.newGame();
  mv(s2, 'e2', 'e4'); mv(s2, 'a7', 'a6'); mv(s2, 'e4', 'e5'); mv(s2, 'd7', 'd5');
  mv(s2, 'h2', 'h3'); mv(s2, 'a6', 'a5');
  ok(!targets(s2, 'e5').includes('d6'), 'gone one move later');
  mv(s, 'e5', 'd6');
  eq(s.board[S('d5')], null); eq(s.history[4].text, 'exd6');
});

test('en passant that exposes the king is illegal', () => {
  const s = position({ a5: 'wK', e5: 'wP', h5: 'bR', a8: 'bK', d7: 'bP' }, 'b');
  mv(s, 'd7', 'd5');
  ok(!targets(s, 'e5').includes('d6'), 'both pawns leave rank 5, exposing the king to the rook');
});

test('promotion lets you choose the piece', () => {
  const s = position({ e1: 'wK', h8: 'bK', a7: 'wP' }, 'w');
  ok(E.legalMoves(s, S('a7'))[0].promo);
  mv(s, 'a7', 'a8', { promo: 'N' });
  eq(s.board[S('a8')].type, 'N'); eq(s.history[0].text, 'a8=N');
});

test('threefold repetition draws', () => {
  const s = E.newGame();
  for (let i = 0; i < 2; i++) { mv(s, 'g1', 'f3'); mv(s, 'g8', 'f6'); mv(s, 'f3', 'g1'); mv(s, 'f6', 'g8'); }
  eq(s.result && s.result.reason, 'threefold repetition');
});

test('50-move rule draws', () => {
  const s = position({ a1: 'wK', a8: 'bK', h1: 'wR', h8: 'bR' }, 'w');
  s.halfmove = 99;
  mv(s, 'h1', 'h2');
  eq(s.result && s.result.reason, 'the 50-move rule');
});

test('insufficient material draws', () => {
  ok(E.insufficientMaterial(position({ a1: 'wK', a8: 'bK' }).board), 'K v K');
  ok(E.insufficientMaterial(position({ a1: 'wK', a8: 'bK', c3: 'wN' }).board), 'K+N v K');
  ok(E.insufficientMaterial(position({ a1: 'wK', a8: 'bK', c1: 'wB', f8: 'bB' }).board), 'same-colour bishops');
  ok(!E.insufficientMaterial(position({ a1: 'wK', a8: 'bK', c1: 'wB', c8: 'bB' }).board), 'opposite bishops can mate');
  ok(!E.insufficientMaterial(position({ a1: 'wK', a8: 'bK', a2: 'wP' }).board), 'pawn can promote');
  const s2 = position({ a1: 'wK', h8: 'bK', d4: 'wN', e6: 'bR' }, 'w');
  mv(s2, 'd4', 'e6');
  eq(s2.result && s2.result.reason, 'insufficient material');
});

// ------------------------------------------------ game modes
test('secret queen: normal queen stays, disguised queen moves like a pawn, then reveals', () => {
  const s = E.newGame({ hiddenQueen: true });
  eq(s.board[S('d1')].type, 'Q', 'normal queen stays on d1');
  ok(E.setHiddenQueen(s, 'w', S('e2')));
  const q = s.board[S('e2')];
  eq(q.type, 'Q'); eq(q.shown, 'P');
  mv(s, 'e2', 'e4');
  eq(q.shown, 'P', 'pawn-like double step keeps disguise');
  mv(s, 'a7', 'a6');
  mv(s, 'e4', 'h7');
  eq(q.shown, 'Q');
  eq(s.history[2].text, 'Qxh7 (revealed)');
});

test('secret queen is revealed when it gives check', () => {
  const s = E.newGame({ hiddenQueen: true });
  E.setHiddenQueen(s, 'w', S('d2'));
  mv(s, 'd2', 'd4'); mv(s, 'a7', 'a6');
  mv(s, 'd4', 'd5'); mv(s, 'a6', 'a5');
  mv(s, 'd5', 'd6'); mv(s, 'h7', 'h6');
  eq(s.board[S('d6')].shown, 'P', 'still disguised: no check yet');
  mv(s, 'd6', 'e7'); // a pawn-like capture that lands next to the king
  eq(s.board[S('e7')].shown, 'Q', 'revealed by check');
  eq(s.check, 'b');
  eq(s.history[6].text, 'dxe7+');
  eq(s.history[6].note, 'disguised piece revealed by giving check');
});

test('traitor moves an enemy piece once, never captures a king', () => {
  const s = E.newGame({ traitor: true });
  ok(E.setTraitor(s, 'w', S('g8')));
  ok(!E.setTraitor(s, 'b', S('e1')), 'king cannot be traitor');
  mv(s, 'g8', 'f6', { traitor: true });
  eq(s.board[S('f6')].owner, 'b', 'piece still belongs to black');
  ok(s.traitor.w.used);
  const s2 = position({ e1: 'wK', e8: 'bK', d7: 'bQ' }, 'w', { traitor: true });
  E.setTraitor(s2, 'w', S('d7'));
  ok(!E.legalMoves(s2, S('d7'), { traitor: true }).some((m) => m.to === S('e8')), 'cannot capture its own king');
});

test('traitor move may not leave your own king in check', () => {
  const s = position({ e1: 'wK', e8: 'bK', e4: 'bN', e7: 'bR' }, 'w', { traitor: true });
  E.setTraitor(s, 'w', S('e4'));
  eq(E.legalMoves(s, S('e4'), { traitor: true }).length, 0, 'moving the knight opens the rook on e7');
});

test('hidden objective win', () => {
  const s = E.newGame({ objective: true }, seq([0]));
  s.objectives.w = 'promote';
  s.board[S('a7')] = null; s.board[S('a8')] = null; s.board[S('b8')] = null;
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
  ok(throws(() => E.doSwap(s, S('e1'), S('d8'))));
});

test('swapped piece reveals on inconsistent move', () => {
  const s = E.newGame({ swap: true });
  E.doSwap(s, S('d2'), S('g1'));
  mv(s, 'a7', 'a6');
  mv(s, 'd2', 'c4');
  eq(s.board[S('c4')].shown, 'N');
});

test('swap is not allowed while in check', () => {
  const s = position({ e1: 'wK', e8: 'bK', e5: 'bR', a1: 'wR', b1: 'wN' }, 'w', { swap: true });
  ok(!E.canSwap(s, 'w'));
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
