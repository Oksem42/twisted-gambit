(function () {
// Bot v1: a computer opponent for Gerasimos Gambit.
const E = globalThis.TGEngine;

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

/** Secret setup for the bot's side in whatever mode is being played. */
function setup(s, c, rng = Math.random) {
  const own = () => s.board.map((p, i) => [p, i]).filter(([p]) => p && p.owner === c);
  const enemy = () => s.board.map((p, i) => [p, i]).filter(([p]) => p && p.owner !== c);
  if (s.twists.hiddenQueen) E.setHiddenQueen(s, c, pick(own().filter(([p]) => p.type === 'P'), rng)[1]);
  if (s.twists.traitor) E.setTraitor(s, c, pick(enemy().filter(([p]) => p.type !== 'K'), rng)[1]);
  if (s.twists.shifter) E.setShifter(s, c, pick(own().filter(([p]) => p.type !== 'K'), rng)[1]);
  if (s.twists.mines) {
    const half = [];
    for (let i = 0; i < 64; i++) if (c === E.W ? E.rankOf(i) >= 4 : E.rankOf(i) <= 3) half.push(i);
    const chosen = new Set();
    while (chosen.size < E.MINES) chosen.add(pick(half, rng));
    E.setMines(s, c, [...chosen]);
  }
}

/** The bot's next action: { type: 'move', move } or { type: 'swap', a, b }. */
function chooseAction(s, rng = Math.random) {
  const me = s.turn;
  const options = [];
  s.board.forEach((p, i) => {
    if (p && p.owner === me) for (const m of E.legalMoves(s, i)) options.push({ type: 'move', move: m });
  });
  const tr = s.traitor[me];
  if (s.twists.traitor && tr && !tr.used) {
    const f = E.findById(s, tr.id);
    if (f) for (const m of E.legalMoves(s, f.sq, { traitor: true })) options.push({ type: 'move', move: m });
  }
  if (E.canSwap(s, me)) {
    const mine = s.board.map((p, i) => [p, i]).filter(([p]) => p && p.owner === me && p.type !== 'K');
    const a = pick(mine, rng);
    const rest = mine.filter(([p]) => p.type !== a[0].type);
    if (rest.length) options.push({ type: 'swap', a: a[1], b: pick(rest, rng)[1] });
  }
  if (!options.length) return null;
  const choice = pick(options, rng);
  if (choice.type !== 'move') return choice;

  const move = { from: choice.move.from, to: choice.move.to, traitor: !!choice.move.traitor };
  if (choice.move.promo) move.promo = pick(E.PROMOTIONS, rng);
  // Prophecy: foresee the reply after this move.
  if (E.prophecyReady(s, me) && s.bonusPending !== me && s.bonusNow !== me && rng() < 0.5) {
    const after = structuredClone(s);
    try {
      E.makeMove(after, move);
      if (!after.result && after.turn !== me) {
        const replies = [];
        after.board.forEach((p, i) => { if (p && p.owner === after.turn) for (const m of E.legalMoves(after, i)) replies.push(m); });
        if (replies.length) { const r = pick(replies, rng); move.prophecy = { from: r.from, to: r.to }; }
      }
    } catch { /* keep the move without a prophecy */ }
  }
  return { type: 'move', move };
}

/** Whether the bot agrees to a draw offer. */
const acceptsDraw = (s, rng = Math.random) => rng() < 0.5;

globalThis.TGBot = { NAME: 'Bot v1', setup, chooseAction, acceptsDraw };
})();
