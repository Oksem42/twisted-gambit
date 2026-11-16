import * as E from './engine.js';

const { W, B, other, PIECE_NAME } = E;
const GLYPH = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞', P: '♟︎' };
const COLOR = { w: 'White', b: 'Black' };

export const TWISTS = [
  { key: 'hiddenQueen', name: 'Hidden Queen', icon: '♛',
    desc: 'Your queen starts disguised as one of your pawns. It is revealed the first time it moves like a queen.' },
  { key: 'traitor', name: 'Traitor', icon: '🗡',
    desc: 'Secretly mark one enemy piece. Once per game, take control of it for a single move.' },
  { key: 'objective', name: 'Hidden Objective', icon: '🎯',
    desc: 'Each player draws a secret goal. Complete it, or capture the king, to win.' },
  { key: 'bluff', name: 'Bluff Moves', icon: '🃏',
    desc: 'Every piece is hidden and may move like a queen or knight. Get caught bluffing and you lose the piece. Call wrong and you lose one of yours.' },
  { key: 'swap', name: 'Secret Swap', icon: '⇄',
    desc: 'Once per game, swap the identities of two of your pieces. To your opponent they keep their old look.' },
];

const $ = (id) => document.getElementById(id);
const boardEl = $('board'), panel = $('panel'), overlay = $('overlay'), modal = $('modal'), ghost = $('drag-ghost');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let G = E.newGame({});
const ui = {
  phase: 'menu', // menu | secret | play | over
  viewer: W, selected: null, moves: [], mode: null, swapFirst: null, fresh: null, flash: '',
  setupQueue: [], names: { w: 'White', b: 'Black' }, privacy: true,
  twists: { hiddenQueen: true, traitor: true, objective: true, bluff: false, swap: true },
  clock: { w: 0, b: 0, running: null, since: 0 },
};
const nm = (c) => esc(ui.names[c] || COLOR[c]);
const isOmni = () => ui.phase === 'menu' || ui.phase === 'over';

// ---------------------------------------------------------------- clocks (time used per player)
function tick() {
  const c = ui.clock;
  if (!c.running) return;
  const now = performance.now();
  c[c.running] += now - c.since;
  c.since = now;
}
function startClock(color) { tick(); ui.clock.running = color; ui.clock.since = performance.now(); }
function stopClock() { tick(); ui.clock.running = null; }
const fmt = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function updateClocks() {
  document.querySelectorAll('.clock[data-c]').forEach((el) => {
    el.textContent = fmt(ui.clock[el.dataset.c]);
    el.classList.toggle('active', ui.clock.running === el.dataset.c);
  });
}
setInterval(() => { tick(); updateClocks(); }, 250);

// ---------------------------------------------------------------- rendering
function pieceHTML(p, extra = '') {
  const omni = isOmni();
  const seeTrue = omni || p.owner === ui.viewer;
  const t = seeTrue ? p.type : p.shown;
  let badges = '';
  if (seeTrue && p.shown && p.shown !== p.type) {
    badges += `<span class="badge mask" title="Your opponent sees a ${PIECE_NAME[p.shown]}">${GLYPH[p.shown]}</span>`;
  }
  for (const c of omni ? [W, B] : [ui.viewer]) {
    const tr = G.traitor[c];
    if (tr && tr.id === p.id && !tr.used) badges += `<span class="badge dagger" title="${COLOR[c]}'s traitor">🗡</span>`;
  }
  if (!t) return `<div class="pc token ${p.owner} ${extra}"><span class="g">?</span>${badges}</div>`;
  return `<div class="pc ${p.owner} ${extra}"><span class="g">${GLYPH[t]}</span>${badges}</div>`;
}

function currentStep() { return ui.phase === 'secret' && ui.setupQueue[0] ? ui.setupQueue[0].steps[0] : null; }

function pickSets() {
  const pickable = new Set(), picked = new Set();
  const c = ui.viewer, step = currentStep();
  const each = (fn) => G.board.forEach((p, i) => p && fn(p, i));
  if (step === 'hiddenQueen') {
    each((p, i) => { if (p.owner === c && p.shown === 'P') pickable.add(i); });
    const f = E.findById(G, G.hiddenQueen[c]); if (f) picked.add(f.sq);
  } else if (step === 'traitor') {
    each((p, i) => { if (p.owner !== c && p.type !== 'K') pickable.add(i); });
    const f = G.traitor[c] && E.findById(G, G.traitor[c].id); if (f) picked.add(f.sq);
  } else if (ui.mode === 'swap') {
    each((p, i) => { if (p.owner === c && p.type !== 'K') pickable.add(i); });
    if (ui.swapFirst != null) picked.add(ui.swapFirst);
  } else if (ui.mode === 'traitor' && ui.selected != null) {
    picked.add(ui.selected);
  }
  return { pickable, picked };
}

function renderBoard() {
  const flip = ui.viewer === B;
  const targets = new Map(ui.moves.map((m) => [m.to, m]));
  const { pickable, picked } = pickSets();
  let html = '';
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const r = flip ? row : 7 - row, f = flip ? 7 - col : col, i = E.sq(f, r);
      const cls = ['sq', (f + r) % 2 === 1 ? 'light' : 'dark'];
      const lm = G.lastMove;
      if ((lm && ui.phase !== 'menu' && (lm.from === i || lm.to === i)) || ui.selected === i) cls.push('hl');
      if (picked.has(i)) cls.push('pick');
      if (pickable.has(i)) cls.push('pickable');
      const p = G.board[i];
      let inner = '';
      if (col === 0) inner += `<span class="coord rank">${r + 1}</span>`;
      if (row === 7) inner += `<span class="coord file">${E.FILES[f]}</span>`;
      if (p) inner += pieceHTML(p, ui.fresh === i ? 'fresh' : '');
      const m = targets.get(i);
      if (m) inner += p || m.ep ? '<span class="ring"></span>' : '<span class="dot"></span>';
      html += `<div class="${cls.join(' ')}" data-sq="${i}">${inner}</div>`;
    }
  }
  boardEl.innerHTML = html;
}

function material(c) {
  return G.captured[c].filter((x) => x.owner !== c).reduce((a, x) => a + E.PIECE_VALUE[x.type], 0);
}

function publicChips(c) {
  if (ui.phase === 'menu') return '';
  const chips = [];
  const t = G.twists;
  if (t.hiddenQueen) {
    const id = G.hiddenQueen[c];
    const f = E.findById(G, id);
    chips.push(`<span class="chip ${id == null || (f && f.piece.shown === 'P') ? '' : 'spent'}" title="Hidden queen">♛ hidden</span>`);
  }
  if (t.traitor) {
    const tr = G.traitor[c];
    const spent = tr && (tr.used || !E.findById(G, tr.id));
    chips.push(`<span class="chip ${spent ? 'spent' : ''}" title="Traitor">🗡 traitor</span>`);
  }
  if (t.swap) chips.push(`<span class="chip ${G.swapUsed[c] ? 'spent' : ''}" title="Secret swap">⇄ swap</span>`);
  if (t.objective) chips.push('<span class="chip" title="Secret objective">🎯 objective</span>');
  return chips.join('');
}

function renderBar(el, c) {
  const caps = G.captured[c].filter((x) => x.owner !== c).sort((a, b) => E.PIECE_VALUE[b.type] - E.PIECE_VALUE[a.type]);
  const glyphs = caps.map((x) => GLYPH[x.type]).join('');
  const adv = material(c) - material(other(c));
  el.innerHTML = `
    <div class="avatar ${c}">${GLYPH.K}</div>
    <div class="who">
      <div class="name"><span class="nm">${nm(c)}</span> ${publicChips(c)}</div>
      <div class="caps">${glyphs}${adv > 0 ? `<span class="adv">+${adv}</span>` : ''}</div>
    </div>
    <div class="clock" data-c="${c}">${fmt(ui.clock[c])}</div>`;
}

function render() {
  renderBoard();
  renderBar($('bar-bottom'), ui.viewer);
  renderBar($('bar-top'), other(ui.viewer));
  renderPanel();
  updateClocks();
}

// ---------------------------------------------------------------- panel
function traitorDesc(c) {
  const tr = G.traitor[c];
  if (!tr) return 'not chosen yet';
  if (tr.used) return 'already used';
  const f = E.findById(G, tr.id);
  if (!f) return 'captured before it could act';
  const t = isOmni() ? f.piece.type : f.piece.shown || f.piece.type;
  return `${COLOR[f.piece.owner]}'s ${PIECE_NAME[t]} on ${E.sqName(f.sq)}`;
}

function queenDesc(c) {
  const id = G.hiddenQueen[c];
  if (id == null) return 'not chosen yet';
  const f = E.findById(G, id);
  if (!f) return 'captured';
  return f.piece.shown === 'P' ? `disguised as the pawn on ${E.sqName(f.sq)}` : `revealed on ${E.sqName(f.sq)}`;
}

function secretItems(c) {
  const t = G.twists, items = [];
  if (t.objective) {
    const o = E.objectiveById(G.objectives[c]);
    const prog = Math.min(o.progress(G, c), o.goal);
    items.push(`<li><span class="ic">🎯</span><div><b>${o.text}</b>
      <div class="progress"><i style="width:${(prog / o.goal) * 100}%"></i></div></div></li>`);
  }
  if (t.hiddenQueen) items.push(`<li><span class="ic">♛</span><div>Hidden queen: <b>${queenDesc(c)}</b></div></li>`);
  if (t.traitor) items.push(`<li><span class="ic">🗡</span><div>Traitor: <b>${traitorDesc(c)}</b></div></li>`);
  if (t.swap) items.push(`<li><span class="ic">⇄</span><div>Secret swap: <b>${G.swapUsed[c] ? 'used' : 'ready'}</b></div></li>`);
  if (t.bluff && ui.phase !== 'over') items.push(`<li><span class="ic">🃏</span><div>Your army is <b>hidden</b>. A piece is revealed when it's captured or a challenge against it fails.</div></li>`);
  return items.join('');
}

function setupCard() {
  const c = ui.viewer, step = currentStep();
  const head = `<div class="flash" style="margin:0 0 6px;color:var(--muted)">${nm(c)} · secret setup</div>`;
  if (step === 'hiddenQueen') {
    return `<div class="card alert">${head}<h3>♛ Hide your queen</h3>
      <p>Click one of your pawns. It secretly becomes your queen. Your opponent sees a pawn until it makes a move only a queen could.</p>
      <button class="btn primary big" data-act="confirm" ${G.hiddenQueen[c] == null ? 'disabled' : ''}>Confirm</button></div>`;
  }
  if (step === 'traitor') {
    return `<div class="card alert">${head}<h3>🗡 Choose your traitor</h3>
      <p>Click one enemy piece (not the king). Once per game, on your turn, you can move it as if it were yours.</p>
      <button class="btn primary big" data-act="confirm" ${G.traitor[c] == null ? 'disabled' : ''}>Confirm</button></div>`;
  }
  if (step === 'objective') {
    const o = E.objectiveById(G.objectives[c]);
    return `<div class="card alert">${head}<h3>🎯 Your secret objective</h3>
      <div class="objective-card">${o.text}</div>
      <p>Complete it, or capture the enemy king, to win. Your opponent has a different objective you can't see.</p>
      <button class="btn primary big" data-act="confirm">Got it</button></div>`;
  }
  if (step === 'bluff') {
    return `<div class="card alert">${head}<h3>🃏 Your hidden army</h3>
      <p>Your 16 pieces have been shuffled across your first two ranks. Your opponent only sees <b>?</b> tokens, and only you know which is which.</p>
      <div class="btn-row"><button class="btn" data-act="reshuffle">Reshuffle</button>
      <button class="btn primary" data-act="confirm">Ready</button></div></div>`;
  }
  return '';
}

function playCard() {
  const c = G.turn;
  if (G.turn !== ui.viewer) {
    return `<div class="card status"><h3>Waiting…</h3><p>Pass the device to ${nm(c)}.</p></div>`;
  }
  if (G.pending) {
    const m = G.pending.move;
    const cap = G.lastMove && G.history.length && G.history[G.history.length - 1].text.includes('x');
    return `<div class="card alert"><h3>🃏 Call the bluff?</h3>
      <p>${nm(G.pending.by)} moved a hidden piece <b>${E.sqName(m.from)} → ${E.sqName(m.to)}</b>${cap ? ' and captured' : ''}.
      If that piece couldn't legally make the move, it's removed and the move is undone.
      If it could, you lose a random piece of your own.</p>
      <div class="btn-row"><button class="btn danger" data-act="challenge">Challenge!</button>
      <button class="btn primary" data-act="accept">Accept</button></div></div>`;
  }
  let hint = G.twists.bluff
    ? 'Click or drag a piece. Any piece may move like a queen or a knight, but if you get caught bluffing, you lose it.'
    : 'Click or drag a piece to move. Capture the king to win.';
  let actions = '';
  if (ui.mode === 'traitor') {
    hint = 'Your traitor is the highlighted enemy piece. Make one move with it.';
    actions = '<button class="btn" data-act="cancel">Cancel</button>';
  } else if (ui.mode === 'swap') {
    hint = ui.swapFirst == null ? 'Click the first of your pieces to swap (not the king).' : 'Now click the second piece.';
    actions = '<button class="btn" data-act="cancel">Cancel</button>';
  } else {
    const btns = [];
    if (traitorReady(c)) btns.push('<button class="btn" data-act="traitor">🗡 Use Traitor</button>');
    if (G.twists.swap && !G.swapUsed[c]) btns.push('<button class="btn" data-act="swap">⇄ Secret Swap</button>');
    if (btns.length) actions = `<div class="btn-row">${btns.join('')}</div>`;
  }
  return `<div class="card status"><h3><span class="dotlive"></span>${nm(c)} to move</h3><p>${hint}</p>${actions}
    ${ui.flash ? `<div class="flash">${ui.flash}</div>` : ''}</div>`;
}

function overCard() {
  const r = G.result;
  const title = r.winner ? `🏆 ${nm(r.winner)} wins` : '½ Draw';
  const reveal = [W, B].map((c) => {
    const items = secretItems(c);
    return items ? `<div class="section-label">${nm(c)}'s secrets</div><ul class="secret-list">${items}</ul>` : '';
  }).join('');
  return `<div class="card win"><h3>${title}</h3><p>${r.winner ? `${nm(r.winner)} ${r.reason}.` : 'The players agreed to a draw.'}</p>
    <div class="btn-row"><button class="btn primary" data-act="rematch">Rematch</button><button class="btn" data-act="new">New Game</button></div>
    ${reveal}</div>`;
}

function movesHTML() {
  const h = G.history;
  if (!h.length) return '<div class="moves"><div class="moves-title">Moves</div><div class="empty">No moves yet.</div></div>';
  const cell = (e, idx) => (e
    ? `<span class="m ${idx === h.length - 1 ? 'last' : ''} ${e.caught ? 'caught' : ''}"><span class="t">${e.text}</span>${e.note ? `<span class="note">${e.note}</span>` : ''}</span>`
    : '<span></span>');
  let rows = '';
  for (let i = 0; i < h.length; i += 2) rows += `<div class="move-row"><span class="n">${i / 2 + 1}.</span>${cell(h[i], i)}${cell(h[i + 1], i + 1)}</div>`;
  return `<div class="moves"><div class="moves-title">Moves</div>${rows}</div>`;
}

function renderPanel() {
  const chips = TWISTS.filter((t) => G.twists[t.key]).map((t) => `<span class="chip">${t.icon} ${t.name}</span>`).join('')
    || '<span class="chip">Classic rules</span>';
  let body = '';
  if (ui.phase === 'menu') {
    body = `<div class="card"><h3>Chess, with secrets</h3><p>Pick your twists, pass the device back and forth, and try to out-bluff your opponent.</p>
      <button class="btn primary big" data-act="new">New Game</button></div>`;
  } else if (ui.phase === 'secret') {
    body = setupCard() + (secretItems(ui.viewer) ? `<div class="card"><h3>Your secrets</h3><ul class="secret-list">${secretItems(ui.viewer)}</ul></div>` : '');
  } else if (ui.phase === 'play') {
    const items = G.turn === ui.viewer ? secretItems(ui.viewer) : '';
    body = playCard() + (items ? `<div class="card"><h3>🔒 Your secrets</h3><ul class="secret-list">${items}</ul></div>` : '');
  } else {
    body = overCard();
  }
  if (ui.phase !== 'menu') body += movesHTML();
  const playing = ui.phase === 'play' && G.turn === ui.viewer && !G.pending;
  panel.innerHTML = `
    <div class="panel-head">♟︎ Pass &amp; Play <span class="sub">${ui.phase === 'menu' ? '' : `Move ${Math.floor(G.ply / 2) + 1}`}</span></div>
    <div class="twist-row">${ui.phase === 'menu' ? '<span class="chip">Choose twists in New Game</span>' : chips}</div>
    <div class="panel-body" id="panel-body">${body}</div>
    <div class="panel-foot">
      <button class="btn" data-act="resign" ${playing ? '' : 'disabled'}>🏳 Resign</button>
      <button class="btn" data-act="draw" ${playing ? '' : 'disabled'}>½ Draw</button>
      <button class="btn" data-act="rules">📖 Rules</button>
    </div>`;
  const pb = $('panel-body');
  const mv = pb.querySelector('.moves');
  if (mv && ui.phase === 'play') pb.scrollTop = pb.scrollHeight;
}

// ---------------------------------------------------------------- flow
function traitorReady(c) {
  const tr = G.traitor[c];
  return G.twists.traitor && tr && !tr.used && !!E.findById(G, tr.id);
}

function handoff(color, purpose = 'turn') {
  ui.selected = null; ui.moves = []; ui.mode = null; ui.swapFirst = null;
  stopClock();
  const go = () => {
    ui.viewer = color;
    overlay.classList.add('hidden');
    if (ui.phase === 'play') startClock(color);
    render();
  };
  if (!ui.privacy) return go();
  let msg = 'Your move. Make sure your opponent isn\'t looking.';
  if (purpose === 'setup') msg = 'Time for your secret setup. Make sure your opponent isn\'t looking.';
  else if (G.pending) msg = `${nm(G.pending.by)} just moved a hidden piece. Decide whether to call the bluff.`;
  else if (ui.phase === 'play' && G.ply === 0) msg = 'Setup is done. The game begins. White moves first.';
  overlay.innerHTML = `<div class="pass-card">
      <div class="big-piece pc ${color}"><span class="g">${GLYPH.K}</span></div>
      <h2>Pass to ${nm(color)}</h2><p>${msg}</p>
      <button class="btn primary big" id="pass-go">I'm ${nm(color)}. Show my board.</button></div>`;
  overlay.classList.remove('hidden');
  $('pass-go').onclick = go;
}

function runSetup() {
  while (ui.setupQueue.length && !ui.setupQueue[0].steps.length) ui.setupQueue.shift();
  if (!ui.setupQueue.length) {
    ui.phase = 'play';
    render();
    return handoff(G.turn);
  }
  const cur = ui.setupQueue[0];
  ui.phase = 'secret';
  if (!cur.started) { cur.started = true; return handoff(cur.color, 'setup'); }
  render();
}

function startGame(twists) {
  ui.twists = { ...twists };
  G = E.newGame(twists);
  ui.clock = { w: 0, b: 0, running: null, since: 0 };
  Object.assign(ui, { selected: null, moves: [], mode: null, swapFirst: null, fresh: null, flash: '' });
  const steps = ['hiddenQueen', 'traitor', 'objective', 'bluff'].filter((k) => G.twists[k]);
  ui.setupQueue = steps.length ? [W, B].map((c) => ({ color: c, steps: [...steps], started: false })) : [];
  closeModal();
  runSetup();
}

function afterAction() {
  ui.selected = null; ui.moves = []; ui.mode = null; ui.swapFirst = null;
  if (G.result) return gameOver();
  stopClock();
  render();
  setTimeout(() => handoff(G.turn), ui.privacy ? 650 : 200);
}

function gameOver() {
  stopClock();
  ui.phase = 'over';
  ui.selected = null; ui.moves = []; ui.mode = null;
  overlay.classList.add('hidden');
  render();
}

function doMove(m) {
  try { E.makeMove(G, m); } catch (e) { ui.flash = e.message; return render(); }
  ui.fresh = m.to;
  ui.flash = '';
  afterAction();
}

function canAct() {
  return ui.phase === 'play' && !G.result && !G.pending && G.turn === ui.viewer && overlay.classList.contains('hidden');
}

function onSwapClick(i) {
  const p = G.board[i];
  if (!p || p.owner !== G.turn || p.type === 'K') return;
  if (ui.swapFirst == null || ui.swapFirst === i) {
    ui.swapFirst = ui.swapFirst === i ? null : i;
    return render();
  }
  E.doSwap(G, ui.swapFirst, i);
  ui.fresh = null;
  ui.flash = '';
  afterAction();
}

// ---------------------------------------------------------------- board input (click + drag)
let drag = null;
boardEl.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.sq');
  if (!el) return;
  const i = +el.dataset.sq;
  if (ui.phase === 'secret') {
    const step = currentStep();
    if (step === 'hiddenQueen') E.setHiddenQueen(G, ui.viewer, i);
    if (step === 'traitor') E.setTraitor(G, ui.viewer, i);
    return render();
  }
  if (!canAct()) return;
  if (ui.mode === 'swap') return onSwapClick(i);
  if (ui.selected != null) {
    const m = ui.moves.find((x) => x.to === i);
    if (m) return doMove(m);
  }
  const p = G.board[i];
  const tr = G.traitor[G.turn];
  const selectable = ui.mode === 'traitor' ? p && tr && p.id === tr.id : p && p.owner === G.turn;
  if (!selectable) {
    if (ui.mode !== 'traitor') { ui.selected = null; ui.moves = []; }
    return render();
  }
  ui.selected = i;
  ui.moves = E.legalMoves(G, i, { traitor: ui.mode === 'traitor' });
  ui.fresh = null;
  render();
  const src = boardEl.querySelector(`[data-sq="${i}"] .pc`);
  if (src) drag = { from: i, x: e.clientX, y: e.clientY, moved: false, src };
});

window.addEventListener('pointermove', (e) => {
  if (!drag) return;
  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return;
    drag.moved = true;
    ghost.className = drag.src.className + ' drag-ghost';
    ghost.innerHTML = drag.src.innerHTML;
    drag.src.classList.add('dragging');
  }
  ghost.style.left = e.clientX + 'px';
  ghost.style.top = e.clientY + 'px';
});

window.addEventListener('pointerup', (e) => {
  if (!drag) return;
  const d = drag;
  drag = null;
  ghost.className = 'pc drag-ghost hidden';
  if (!d.moved) return;
  const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.sq');
  const m = el && ui.moves.find((x) => x.to === +el.dataset.sq);
  if (m) doMove(m);
  else render();
});

// ---------------------------------------------------------------- panel actions
panel.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn || btn.disabled) return;
  const act = btn.dataset.act;
  const c = ui.viewer;
  switch (act) {
    case 'new': return openNewGame();
    case 'rules': return openRules();
    case 'rematch': return startGame(ui.twists);
    case 'confirm': ui.setupQueue[0].steps.shift(); return runSetup();
    case 'reshuffle': E.shuffleArmy(G, c); return render();
    case 'cancel': ui.mode = null; ui.swapFirst = null; ui.selected = null; ui.moves = []; return render();
    case 'swap': ui.mode = 'swap'; ui.selected = null; ui.moves = []; return render();
    case 'traitor': {
      const f = E.findById(G, G.traitor[c].id);
      ui.mode = 'traitor';
      ui.selected = f.sq;
      ui.moves = E.legalMoves(G, f.sq, { traitor: true });
      if (!ui.moves.length) { ui.mode = null; ui.selected = null; ui.flash = 'Your traitor has no legal moves right now.'; }
      return render();
    }
    case 'challenge':
    case 'accept': {
      const res = E.resolveChallenge(G, act === 'challenge');
      if (res.outcome === 'caught') ui.flash = `Bluff caught! It was really a ${PIECE_NAME[res.type]}, and it's been removed. Your move.`;
      else if (res.outcome === 'honest') ui.flash = `It was an honest ${PIECE_NAME[res.type]}. You lost ${res.lost ? 'a ' + PIECE_NAME[res.lost] : 'nothing'}. Your move.`;
      else ui.flash = '';
      if (G.result) return gameOver();
      return render();
    }
    case 'resign':
      if (confirm(`${ui.names[c]}, resign this game?`)) { E.resign(G, c); gameOver(); }
      return;
    case 'draw':
      if (confirm(`Does ${ui.names[other(c)]} agree to a draw?`)) { E.agreeDraw(G); gameOver(); }
      return;
  }
});

// ---------------------------------------------------------------- modals
function closeModal() { modal.classList.add('hidden'); modal.innerHTML = ''; }
modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('[data-close]')) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

function openNewGame() {
  const t = { ...ui.twists };
  const draw = () => {
    modal.innerHTML = `<div class="modal" role="dialog" aria-label="New game">
      <div class="modal-head"><h2>New Game</h2><button class="btn ghost small" data-close>✕</button></div>
      <div class="modal-body">
        <div class="section-label">Pick your twists</div>
        <div class="twist-grid">${TWISTS.map((tw) => `
          <button class="twist-opt ${t[tw.key] ? 'on' : ''} ${t.bluff && E.BLUFF_EXCLUDES.includes(tw.key) ? 'off' : ''}" data-twist="${tw.key}">
            <span class="ti">${tw.icon}</span>
            <span><div class="tt">${tw.name}</div><div class="td">${tw.desc}</div></span>
            <span class="check">${t[tw.key] ? '✓' : ''}</span>
          </button>`).join('')}</div>
        <p style="font-size:12px;color:var(--muted);margin:8px 0 0">Bluff Moves hides every piece, so it can't be combined with Hidden Queen, Traitor or Secret Swap.</p>
        <div class="section-label">Players</div>
        <div class="names">
          <input id="name-w" maxlength="16" value="${esc(ui.names.w)}" placeholder="White" aria-label="White player name">
          <input id="name-b" maxlength="16" value="${esc(ui.names.b)}" placeholder="Black" aria-label="Black player name">
        </div>
        <label class="toggle-line"><input type="checkbox" id="privacy" ${ui.privacy ? 'checked' : ''}> Privacy screen between turns (pass &amp; play)</label>
        <button class="btn primary big" id="start-game">Play</button>
      </div></div>`;
    modal.querySelectorAll('[data-twist]').forEach((b) => b.addEventListener('click', () => {
      saveForm();
      const k = b.dataset.twist;
      t[k] = !t[k];
      if (k === 'bluff' && t.bluff) E.BLUFF_EXCLUDES.forEach((x) => { t[x] = false; });
      if (E.BLUFF_EXCLUDES.includes(k) && t[k]) t.bluff = false;
      draw();
    }));
    $('start-game').addEventListener('click', () => { saveForm(); startGame(t); });
  };
  const saveForm = () => {
    ui.names.w = $('name-w').value.trim() || 'White';
    ui.names.b = $('name-b').value.trim() || 'Black';
    ui.privacy = $('privacy').checked;
  };
  draw();
  modal.classList.remove('hidden');
}

function openRules() {
  modal.innerHTML = `<div class="modal" role="dialog" aria-label="Rules">
    <div class="modal-head"><h2>📖 Rules</h2><button class="btn ghost small" data-close>✕</button></div>
    <div class="modal-body">
      <h4>Base game</h4>
      <p>Normal chess moves, castling, en passant and promotion (to queen). There is no check or checkmate:
      <b>you win by capturing the enemy king</b>. Leaving your king en prise is a gamble you're allowed to take.
      Some twists add other ways to win.</p>
      ${TWISTS.map((t) => `<h4>${t.icon} ${t.name}</h4><p>${t.desc}</p>`).join('')}
      <h4>Details</h4>
      <ul>
        <li><b>Hidden Queen:</b> the queen's starting square is left empty. A disguised queen can move like a pawn without being revealed.</li>
        <li><b>Traitor:</b> using it takes your whole turn. If the traitor is captured first, the power is lost.</li>
        <li><b>Bluff Moves:</b> after every move, the opponent must accept or challenge before moving.
          Kings are hidden too, so a "king capture" only counts once the move is accepted or survives a challenge.</li>
        <li><b>Secret Swap:</b> takes your turn. The log shows that a swap happened, but not which pieces. A swapped piece is revealed when it makes a move its disguise couldn't.</li>
        <li><b>Pass &amp; play:</b> between turns a privacy screen hides the board so the next player can take the device.</li>
      </ul>
    </div></div>`;
  modal.classList.remove('hidden');
}

$('btn-new').addEventListener('click', openNewGame);
$('btn-rules').addEventListener('click', openRules);

// Expose for debugging / automated checks.
window.__tg = { E, get G() { return G; }, ui };

render();
openNewGame();
