(function () {
const E = globalThis.TGEngine;
const { pieceSVG, tokenSVG } = globalThis.TGPieces;
const { W, B, other, PIECE_NAME } = E;
const COLOR = { w: 'White', b: 'Black' };

// Each twist is its own game mode.
const MODES = [
  { key: 'hiddenQueen', name: 'Secret Queen', icon: '♛',
    desc: 'You keep your normal queen and get a second, secret queen disguised as one of your pawns. It stays a "pawn" as long as it moves like one, and is revealed the moment it makes a queen move.' },
  { key: 'traitor', name: 'Traitor', icon: '🗡',
    desc: 'Secretly mark one enemy piece. Once per game, take control of it for a single move, even to capture its own teammates.' },
  { key: 'objective', name: 'Hidden Objective', icon: '🎯',
    desc: 'Each player draws a secret goal. Complete it, or checkmate the king, to win.' },
  { key: 'swap', name: 'Secret Swap', icon: '⇄',
    desc: 'Once per game, swap the identities of two of your pieces. To your opponent they keep their old look.' },
];
const modeInfo = (k) => MODES.find((m) => m.key === k) || MODES[0];

const $ = (id) => document.getElementById(id);
const boardEl = $('board'), panel = $('panel'), overlay = $('overlay'), modal = $('modal'), ghost = $('drag-ghost');
const boardModal = $('board-modal');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem('tg.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tg.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

let G = E.newGame({});
const ui = {
  phase: 'menu', // menu | secret | play | over
  viewer: W, flipped: false, selected: null, moves: [], tool: null, swapFirst: null, fresh: null, flash: '',
  setupQueue: [], gameMode: store.get('mode', 'hiddenQueen'),
  localNames: store.get('names', { w: 'White', b: 'Black' }), myName: store.get('myName', ''),
  names: { w: 'White', b: 'Black' }, privacy: store.get('privacy', true),
  sound: store.get('sound', true), showResult: false,
  clock: { w: 0, b: 0, running: null, since: 0 },
  // online
  online: false, net: null, ready: { w: false, b: false }, drawOffered: false, lobbyOpen: false,
};
if (!MODES.some((m) => m.key === ui.gameMode)) ui.gameMode = 'hiddenQueen';
const nm = (c) => esc(ui.names[c] || COLOR[c]);
const isOmni = () => ui.phase === 'menu' || ui.phase === 'over';
const me = () => ui.viewer;

// ---------------------------------------------------------------- sound (tiny synthesized clicks)
let actx = null;
function sound(kind) {
  if (!ui.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const tones = { move: [[330, 140, 0]], capture: [[240, 80, 0], [180, 70, 0.05]], end: [[523, 523, 0], [659, 659, 0.12], [784, 784, 0.24]], reveal: [[440, 880, 0]], check: [[660, 660, 0], [880, 880, 0.08]] }[kind];
    for (const [f0, f1, delay] of tones) {
      const t = actx.currentTime + delay;
      const o = actx.createOscillator(), g = actx.createGain();
      o.type = kind === 'end' ? 'sine' : 'triangle';
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f1, t + 0.09);
      g.gain.setValueAtTime(kind === 'end' ? 0.18 : 0.4, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + (kind === 'end' ? 0.3 : 0.12));
      o.connect(g).connect(actx.destination);
      o.start(t); o.stop(t + 0.32);
    }
  } catch { /* audio unavailable */ }
}

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
    el.querySelector('.ct').textContent = fmt(ui.clock[el.dataset.c]);
    el.classList.toggle('active', ui.clock.running === el.dataset.c);
  });
}
setInterval(() => { tick(); updateClocks(); }, 250);

// ---------------------------------------------------------------- online (PeerJS: direct browser-to-browser)
const NET_PREFIX = 'twisted-gambit-v1-';
const netAvailable = () => typeof window.Peer === 'function';
function makeCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 5; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}
function netTeardown() {
  const n = ui.net;
  ui.net = null;
  ui.online = false;
  if (!n) return;
  clearTimeout(n.timer);
  try { if (n.conn) n.conn.close(); } catch { /* ignore */ }
  try { if (n.peer) n.peer.destroy(); } catch { /* ignore */ }
}
function netHost(mode) {
  netTeardown();
  const n = ui.net = { role: 'host', code: makeCode(), myColor: W, status: 'connecting', mode, oppName: null, error: '' };
  const peer = n.peer = new window.Peer(NET_PREFIX + n.code);
  peer.on('open', () => { if (ui.net === n) { n.status = 'waiting'; refresh(); } });
  peer.on('connection', (conn) => acceptConn(n, conn));
  peer.on('error', (err) => netError(n, err));
}
function acceptConn(n, conn) {
  if (ui.net !== n || ui.online || (n.conn && n.conn.open)) {
    conn.on('open', () => { conn.send({ t: 'busy' }); setTimeout(() => conn.close(), 300); });
    return;
  }
  bindConn(n, conn);
}

// ---- Random matchmaking, no server of our own: each mode has numbered "waiting spots" (well-known
// peer IDs). Claim the first free spot and wait there, or connect to whoever is already waiting.
const QUICK_SLOTS = 12;
const slotId = (mode, slot) => `${NET_PREFIX}q-${mode}-${slot}`;
function quickWait(mode, slot = 0) {
  netTeardown();
  const n = ui.net = { role: 'host', quick: true, code: `Q${slot + 1}`, myColor: W, status: 'searching', mode, slot, oppName: null, error: '' };
  if (slot >= QUICK_SLOTS) {
    n.status = 'error';
    n.error = 'Matchmaking is full right now. Try again in a minute, or invite a friend with a link.';
    return refresh();
  }
  n.onEarlyClose = () => { n.conn = null; n.status = 'waiting'; refresh(); }; // opponent left before starting: keep waiting
  const peer = n.peer = new window.Peer(slotId(mode, slot));
  peer.on('open', () => { if (ui.net === n) { n.status = 'waiting'; refresh(); } });
  peer.on('connection', (conn) => acceptConn(n, conn));
  peer.on('error', (err) => {
    if (ui.net !== n) return;
    if (err.type === 'unavailable-id') return quickJoin(mode, slot); // someone is waiting in this spot
    netError(n, err);
  });
}
function quickJoin(mode, slot) {
  netTeardown();
  const n = ui.net = { role: 'guest', quick: true, code: `Q${slot + 1}`, myColor: B, status: 'searching', mode, slot, oppName: null, error: '' };
  const next = () => { if (ui.net === n && !ui.online) quickWait(mode, slot + 1); };
  n.onEarlyClose = next;
  n.timer = setTimeout(next, 8000); // the spot's owner didn't answer in time
  const peer = n.peer = new window.Peer();
  peer.on('open', () => {
    if (ui.net !== n) return;
    bindConn(n, peer.connect(slotId(mode, slot), { reliable: true, serialization: 'json' }));
  });
  peer.on('error', (err) => {
    if (ui.net !== n) return;
    if (err.type === 'peer-unavailable') return quickWait(mode, slot); // they just left: take the spot
    netError(n, err);
  });
}
function netJoin(code) {
  netTeardown();
  const n = ui.net = { role: 'guest', code: code.trim().toUpperCase(), myColor: B, status: 'connecting', oppName: null, error: '' };
  const peer = n.peer = new window.Peer();
  peer.on('open', () => {
    if (ui.net !== n) return;
    bindConn(n, peer.connect(NET_PREFIX + n.code, { reliable: true, serialization: 'json' }));
  });
  peer.on('error', (err) => netError(n, err));
}
function bindConn(n, conn) {
  n.conn = conn;
  conn.on('open', () => {
    if (ui.net !== n) return;
    n.status = 'connected';
    send({ t: 'hello', name: ui.myName || (n.role === 'host' ? 'Host' : 'Guest') });
    refresh();
  });
  conn.on('data', (data) => { if (ui.net === n) onNet(typeof data === 'string' ? JSON.parse(data) : data); });
  conn.on('close', () => {
    if (ui.net !== n) return;
    if (n.onEarlyClose && !ui.online) return n.onEarlyClose();
    n.status = 'closed'; stopClock(); refresh();
  });
}
function netError(n, err) {
  if (ui.net !== n) return;
  if (err.type === 'unavailable-id' && n.role === 'host') return netHost(n.mode);
  n.status = 'error';
  n.error = {
    'peer-unavailable': 'No game found with that code. Check the code and make sure your friend is still waiting.',
    network: 'Could not reach the matchmaking server. Check your internet connection.',
    'server-error': 'The matchmaking server had a problem. Try again in a moment.',
    'browser-incompatible': 'This browser does not support online play.',
  }[err.type] || `Connection problem (${err.type || err.message}).`;
  refresh();
}
function send(msg) {
  const c = ui.net && ui.net.conn;
  if (c && c.open) c.send(msg);
}
const sendAct = (a) => { if (ui.online) send({ t: 'act', a }); };

function onNet(m) {
  const n = ui.net;
  if (m.t === 'busy') { if (n.onEarlyClose && !ui.online) n.onEarlyClose(); return; }
  if (m.t === 'hello') {
    n.oppName = String(m.name || 'Opponent').slice(0, 16);
    if (n.role === 'host') startOnlineGame(n.mode);
    return refresh();
  }
  if (m.t === 'start' && n.role === 'guest') return beginOnline(m.mode, m.G, m.names);
  if (m.t === 'act') applyRemote(m.a);
}

function startOnlineGame(mode) {
  const n = ui.net;
  const g = E.newGame({ [mode]: true });
  const names = { w: ui.myName || 'Host', b: n.oppName || 'Guest' };
  send({ t: 'start', mode, G: g, names });
  beginOnline(mode, g, names);
}

function beginOnline(mode, g, names) {
  if (ui.net) { clearTimeout(ui.net.timer); ui.net.onEarlyClose = null; }
  G = g;
  ui.online = true;
  ui.lobbyOpen = false;
  closeModal();
  overlay.classList.add('hidden');
  ui.gameMode = mode;
  ui.names = names;
  ui.viewer = ui.net.myColor;
  ui.clock = { w: 0, b: 0, running: null, since: 0 };
  ui.ready = { w: false, b: false };
  Object.assign(ui, { selected: null, moves: [], tool: null, swapFirst: null, fresh: null, flash: '', flipped: false, showResult: false, drawOffered: false });
  const steps = setupSteps();
  ui.setupQueue = steps.length ? [{ color: ui.viewer, steps, started: true }] : [];
  ui.phase = 'secret';
  if (!steps.length) markReady();
  render();
}

function markReady() {
  ui.setupQueue = [];
  ui.ready[me()] = true;
  sendAct({ kind: 'ready', color: me() });
  checkReady();
}
function checkReady() {
  if (ui.phase === 'secret' && ui.ready.w && ui.ready.b) {
    ui.phase = 'play';
    startClock(G.turn);
  }
  render();
}

function applyRemote(a) {
  try {
    switch (a.kind) {
      case 'setHQ': E.setHiddenQueen(G, a.color, a.sq); break;
      case 'setTraitor': E.setTraitor(G, a.color, a.sq); break;
      case 'ready': ui.ready[a.color] = true; return checkReady();
      case 'move': {
        const before = capturesNow();
        E.makeMove(G, a.move);
        sound(G.check ? 'check' : capturesNow() > before ? 'capture' : 'move');
        ui.fresh = a.move.to;
        return afterAction();
      }
      case 'swap': E.doSwap(G, a.a, a.b); sound('reveal'); return afterAction();
      case 'resign': E.resign(G, a.color); return gameOver();
      case 'drawOffer': ui.drawOffered = true; sound('reveal'); break;
      case 'drawReply':
        if (a.accept) { E.agreeDraw(G); return gameOver(); }
        ui.flash = 'Your draw offer was declined.';
        break;
      case 'rematch':
        if (ui.net && ui.net.role === 'host') return startOnlineGame(ui.gameMode);
        break;
    }
  } catch (e) {
    ui.flash = `Sync problem: ${e.message}`;
  }
  render();
}

// ---------------------------------------------------------------- rendering
function pieceHTML(p, extra = '') {
  const omni = isOmni();
  const seeTrue = omni || p.owner === ui.viewer;
  const t = seeTrue ? p.type : p.shown;
  let badges = '';
  if (seeTrue && p.shown && p.shown !== p.type) {
    badges += `<span class="badge mask" title="Your opponent sees a ${PIECE_NAME[p.shown]}">${pieceSVG(p.shown, 'w')}</span>`;
  }
  for (const c of omni ? [W, B] : [ui.viewer]) {
    const tr = G.traitor[c];
    if (tr && tr.id === p.id && !tr.used) badges += `<span class="badge dagger" title="${COLOR[c]}'s traitor">🗡</span>`;
  }
  return `<div class="pc ${p.owner} ${extra}">${t ? pieceSVG(t, p.owner) : tokenSVG(p.owner)}${badges}</div>`;
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
  } else if (ui.tool === 'swap') {
    each((p, i) => { if (p.owner === c && p.type !== 'K') pickable.add(i); });
    if (ui.swapFirst != null) picked.add(ui.swapFirst);
  } else if (ui.tool === 'traitor' && ui.selected != null) {
    picked.add(ui.selected);
  }
  return { pickable, picked };
}

function renderBoard() {
  const flip = (ui.viewer === B) !== ui.flipped;
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
      if (p && p.type === 'K' && G.check === p.owner && ui.phase !== 'menu') cls.push('incheck');
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
  const t = G.twists;
  if (t.hiddenQueen) {
    const id = G.hiddenQueen[c];
    const f = E.findById(G, id);
    return `<span class="chip ${id == null || (f && f.piece.shown === 'P') ? '' : 'spent'}" title="Secret queen">♛ secret queen</span>`;
  }
  if (t.traitor) {
    const tr = G.traitor[c];
    const spent = tr && (tr.used || !E.findById(G, tr.id));
    return `<span class="chip ${spent ? 'spent' : ''}" title="Traitor">🗡 traitor</span>`;
  }
  if (t.swap) return `<span class="chip ${G.swapUsed[c] ? 'spent' : ''}" title="Secret swap">⇄ swap</span>`;
  if (t.objective) return '<span class="chip" title="Secret objective">🎯 objective</span>';
  return '';
}

function capturedHTML(c) {
  const caps = G.captured[c].filter((x) => x.owner !== c);
  const groups = ['P', 'N', 'B', 'R', 'Q', 'K'].map((t) => caps.filter((x) => x.type === t)).filter((g) => g.length);
  const adv = material(c) - material(other(c));
  return groups.map((g) => `<span class="grp">${g.map((x) => pieceSVG(x.type, x.owner)).join('')}</span>`).join('')
    + (adv > 0 ? `<span class="adv">+${adv}</span>` : '');
}

const avatar = (c, cls = '') => `<div class="avatar ${c} ${cls}">${pieceSVG('P', c)}</div>`;

function renderBar(el, c) {
  const you = ui.online && c === ui.viewer ? ' · you' : '';
  el.innerHTML = `
    ${avatar(c)}
    <div class="who">
      <div class="name"><span class="nm">${nm(c)}</span><span class="tag">(${COLOR[c]}${you})</span><span class="chips">${publicChips(c)}</span></div>
      <div class="caps">${capturedHTML(c)}</div>
    </div>
    <div class="clock" data-c="${c}"><span class="ci">⏱</span><span class="ct">${fmt(ui.clock[c])}</span></div>`;
}

function renderPromo() {
  const el = $('promo');
  if (!ui.promo) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  const m = ui.promo;
  const color = G.board[m.from].owner;
  const flip = (ui.viewer === B) !== ui.flipped;
  const col = flip ? 7 - E.fileOf(m.to) : E.fileOf(m.to);
  const row = flip ? E.rankOf(m.to) : 7 - E.rankOf(m.to);
  el.style.left = `${col * 12.5}%`;
  el.style.top = row === 0 ? '0' : 'auto';
  el.style.bottom = row === 0 ? 'auto' : '0';
  el.classList.toggle('up', row !== 0);
  el.innerHTML = E.PROMOTIONS.map((t) => `<button data-promo="${t}" title="${PIECE_NAME[t]}">${pieceSVG(t, color)}</button>`).join('')
    + '<button data-promo="x" class="x" title="Cancel">✕</button>';
  el.classList.remove('hidden');
}

function render() {
  const bottom = ui.flipped ? other(ui.viewer) : ui.viewer;
  renderBoard();
  renderBar($('bar-bottom'), bottom);
  renderBar($('bar-top'), other(bottom));
  renderPanel();
  renderBoardModal();
  renderPromo();
  updateClocks();
}
function refresh() { if (ui.lobbyOpen) renderLobby(); else render(); }

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
  if (t.hiddenQueen) items.push(`<li><span class="ic">♛</span><div>Secret queen: <b>${queenDesc(c)}</b></div></li>`);
  if (t.traitor) items.push(`<li><span class="ic">🗡</span><div>Traitor: <b>${traitorDesc(c)}</b></div></li>`);
  if (t.swap) items.push(`<li><span class="ic">⇄</span><div>Secret swap: <b>${G.swapUsed[c] ? 'used' : 'ready'}</b></div></li>`);
  return items.join('');
}

function setupCard() {
  const c = ui.viewer, step = currentStep();
  if (!step) {
    return `<div class="card"><h3><span class="spinner"></span>Waiting for ${nm(other(c))}</h3>
      <p>Your setup is locked in. The game starts as soon as your opponent finishes their secret setup.</p></div>`;
  }
  const head = `<div class="eyebrow">${nm(c)} · secret setup</div>`;
  if (step === 'hiddenQueen') {
    return `<div class="card alert">${head}<h3>♛ Pick your secret queen</h3>
      <p>Click one of your pawns. It secretly becomes a second queen. It keeps looking like a pawn while it moves like one, and is revealed the moment it makes a queen move.</p>
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
  return '';
}

function drawOfferCard() {
  if (!ui.drawOffered || ui.phase !== 'play') return '';
  return `<div class="card alert"><h3>½ Draw offered</h3><p>${nm(other(ui.viewer))} offers a draw.</p>
    <div class="btn-row"><button class="btn primary" data-act="draw-accept">Accept</button><button class="btn" data-act="draw-decline">Decline</button></div></div>`;
}

function playCard() {
  const c = G.turn;
  if (G.turn !== ui.viewer) {
    const msg = ui.online ? `Waiting for ${nm(c)} to move…` : `Pass the device to ${nm(c)}.`;
    return `<div class="card"><h3>${ui.online ? '<span class="spinner"></span>' : ''}${msg}</h3>
      ${ui.flash ? `<div class="flash">${ui.flash}</div>` : ''}</div>`;
  }
  let hint = G.check === c ? '<b class="check-txt">Check!</b> You must get your king out of check.' : 'Click or drag a piece to move. Checkmate the king to win.';
  let actions = '';
  if (ui.tool === 'traitor') {
    hint = 'Your traitor is the highlighted enemy piece. Make one move with it.';
    actions = '<button class="btn" data-act="cancel">Cancel</button>';
  } else if (ui.tool === 'swap') {
    hint = ui.swapFirst == null ? 'Click the first of your pieces to swap (not the king).' : 'Now click the second piece.';
    actions = '<button class="btn" data-act="cancel">Cancel</button>';
  } else {
    const btns = [];
    if (traitorReady(c)) btns.push('<button class="btn" data-act="traitor">🗡 Use Traitor</button>');
    if (E.canSwap(G, c)) btns.push('<button class="btn" data-act="swap">⇄ Secret Swap</button>');
    if (btns.length) actions = `<div class="btn-row">${btns.join('')}</div>`;
  }
  return `<div class="card"><h3><span class="dotlive"></span>${ui.online ? 'Your move' : `${nm(c)} to move`}</h3><p>${hint}</p>${actions}
    ${ui.flash ? `<div class="flash">${ui.flash}</div>` : ''}</div>`;
}

function resultText() {
  const r = G.result;
  return r.winner ? `${nm(r.winner)} ${r.reason}.` : `Draw by ${r.reason}.`;
}

function overCard() {
  const r = G.result;
  const reveal = [W, B].map((c) => {
    const items = secretItems(c);
    return items ? `<div class="section-label">${nm(c)}'s secrets</div><ul class="secret-list">${items}</ul>` : '';
  }).join('');
  return `<div class="card"><h3>${r.winner ? `🏆 ${nm(r.winner)} won` : '½ Draw'}</h3><p>${resultText()}</p>
    <div class="btn-row"><button class="btn primary" data-act="rematch">Rematch</button><button class="btn" data-act="new">New Game</button></div>
    ${ui.flash ? `<div class="flash">${ui.flash}</div>` : ''}
    ${reveal}</div>`;
}

function connectionCard() {
  if (!ui.online || !ui.net || ui.net.status === 'connected') return '';
  return `<div class="card alert"><h3>⚠ Connection lost</h3><p>${nm(other(ui.viewer))} disconnected. You can start a new game.</p>
    <button class="btn" data-act="new">New Game</button></div>`;
}

function moveText(e) {
  return esc(e.text).replace(/^(🗡 )?([KQRBN])/, (_, tr, l) => `${tr || ''}${pieceSVG(l, 'w').replace('class="piece-svg"', 'class="piece-svg fig"')}`);
}

function movesHTML() {
  const h = G.history;
  if (!h.length) return '<div class="moves"><div class="moves-title">Moves</div><div class="empty">No moves yet.</div></div>';
  const cell = (e, idx) => (e
    ? `<span class="m ${idx === h.length - 1 ? 'last' : ''} ${e.caught ? 'caught' : ''}"><span class="t">${moveText(e)}</span>${e.note ? `<span class="note">${e.note}</span>` : ''}</span>`
    : '<span></span>');
  let rows = '';
  for (let i = 0; i < h.length; i += 2) rows += `<div class="move-row"><span class="n">${i / 2 + 1}.</span>${cell(h[i], i)}${cell(h[i + 1], i + 1)}</div>`;
  return `<div class="moves"><div class="moves-title">Moves</div>${rows}</div>`;
}

function renderPanel() {
  const mode = modeInfo(ui.gameMode);
  let chips = `<span class="chip">${mode.icon} ${mode.name}</span>`;
  if (ui.online && ui.net) {
    const ok = ui.net.status === 'connected';
    chips += `<span class="chip ${ok ? 'live' : 'down'}">${ok ? '● Online' : '● Disconnected'} · code ${esc(ui.net.code)}</span>`;
  } else if (ui.phase !== 'menu') {
    chips += '<span class="chip">Pass &amp; play</span>';
  }
  let body = '';
  if (ui.phase === 'menu') {
    body = `<div class="card"><h3>Chess, with secrets</h3><p>Pick a game mode, then play a friend on this device or online.</p>
      <button class="btn primary big" data-act="new">Play</button></div>`;
  } else if (ui.phase === 'secret') {
    const items = secretItems(ui.viewer);
    body = connectionCard() + setupCard() + (items ? `<div class="card"><h3>🔒 Your secrets</h3><ul class="secret-list">${items}</ul></div>` : '');
  } else if (ui.phase === 'play') {
    const showSecrets = ui.online || G.turn === ui.viewer;
    const items = showSecrets ? secretItems(ui.viewer) : '';
    body = connectionCard() + drawOfferCard() + playCard() + (items ? `<div class="card"><h3>🔒 Your secrets</h3><ul class="secret-list">${items}</ul></div>` : '');
  } else {
    body = connectionCard() + overCard();
  }
  if (ui.phase !== 'menu') body += movesHTML();
  const playing = ui.phase === 'play' && !G.result && (ui.online ? ui.net && ui.net.status === 'connected' : G.turn === ui.viewer);
  panel.innerHTML = `
    <div class="tabs">
      <button class="tab active" data-act="noop"><span class="ti">${pieceSVG('P', 'w')}</span>Play</button>
      <button class="tab" data-act="new"><span class="ti">＋</span>New Game</button>
      <button class="tab" data-act="rules"><span class="ti">📖</span>Rules</button>
    </div>
    <div class="twist-row">${ui.phase === 'menu' ? '<span class="chip">Choose a mode in New Game</span>' : chips}</div>
    <div class="panel-body" id="panel-body">${body}</div>
    <div class="panel-foot">
      <button class="icon-btn" data-act="resign" ${playing ? '' : 'disabled'} title="Resign"><span class="ib">⚑</span>Resign</button>
      <button class="icon-btn" data-act="draw" ${playing ? '' : 'disabled'} title="Offer a draw"><span class="ib">½</span>Draw</button>
      <button class="icon-btn" data-act="flip" title="Flip board"><span class="ib">⇅</span>Flip</button>
    </div>`;
  const pb = $('panel-body');
  if (ui.phase === 'play') pb.scrollTop = pb.scrollHeight;
}

function renderBoardModal() {
  if (ui.phase !== 'over' || !ui.showResult) { boardModal.classList.add('hidden'); return; }
  const r = G.result;
  let title = r.winner ? `${nm(r.winner)} Won` : 'Draw';
  if (ui.online && r.winner) title = r.winner === ui.viewer ? 'You Won!' : `${nm(r.winner)} Won`;
  boardModal.innerHTML = `<div class="go-card" role="dialog" aria-label="Game over">
      <div class="go-head ${r.winner && (!ui.online || r.winner === ui.viewer) ? '' : 'draw'}">
        <button class="btn ghost small x" data-bm="close" aria-label="Close">✕</button>
        <h2>${title}</h2><p>${r.winner ? esc(r.reason.replace(/^won /, '')) : 'by ' + esc(r.reason)}</p>
      </div>
      <div class="go-players">
        <div class="go-player ${r.winner === W ? 'won' : ''}">${avatar(W)}<span>${nm(W)}</span></div>
        <span class="go-vs">vs</span>
        <div class="go-player ${r.winner === B ? 'won' : ''}">${avatar(B)}<span>${nm(B)}</span></div>
      </div>
      <div class="go-actions">
        <button class="btn primary big" data-bm="rematch">Rematch</button>
        <button class="btn" data-bm="new">New Game</button>
      </div></div>`;
  boardModal.classList.remove('hidden');
}

$('promo').addEventListener('click', (e) => {
  const b = e.target.closest('[data-promo]');
  if (!b || !ui.promo) return;
  const m = ui.promo;
  ui.promo = null;
  if (b.dataset.promo === 'x') return render();
  doMove({ ...m, promo: b.dataset.promo });
});

boardModal.addEventListener('click', (e) => {
  const b = e.target.closest('[data-bm]');
  if (!b && e.target !== boardModal) return;
  const a = b ? b.dataset.bm : 'close';
  ui.showResult = false;
  if (a === 'rematch') return rematch();
  if (a === 'new') { render(); return openNewGame(); }
  render();
});

// ---------------------------------------------------------------- flow
function traitorReady(c) {
  const tr = G.traitor[c];
  return G.twists.traitor && tr && !tr.used && !!E.findById(G, tr.id);
}

const setupSteps = () => ['hiddenQueen', 'traitor', 'objective'].filter((k) => G.twists[k]);

function handoff(color, purpose = 'turn') {
  ui.selected = null; ui.moves = []; ui.tool = null; ui.swapFirst = null;
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
  else if (ui.phase === 'play' && G.ply === 0) msg = 'Setup is done. The game begins. White moves first.';
  else if (G.check === color) msg = 'You\'re in check! Make sure your opponent isn\'t looking.';
  overlay.innerHTML = `<div class="pass-card">
      <div class="big-piece">${pieceSVG('K', color)}</div>
      <h2>Pass to ${nm(color)}</h2><p>${msg}</p>
      <button class="btn primary big" id="pass-go">I'm ${nm(color)}</button></div>`;
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

function startLocalGame(mode) {
  netTeardown();
  ui.gameMode = mode;
  store.set('mode', mode);
  G = E.newGame({ [mode]: true });
  ui.names = { ...ui.localNames };
  ui.clock = { w: 0, b: 0, running: null, since: 0 };
  Object.assign(ui, { selected: null, moves: [], tool: null, swapFirst: null, fresh: null, flash: '', flipped: false, showResult: false, drawOffered: false });
  const steps = setupSteps();
  ui.setupQueue = steps.length ? [W, B].map((c) => ({ color: c, steps: [...steps], started: false })) : [];
  closeModal();
  runSetup();
}

function rematch() {
  if (!ui.online) return startLocalGame(ui.gameMode);
  if (!ui.net || ui.net.status !== 'connected') { ui.flash = 'Your opponent is no longer connected.'; return render(); }
  if (ui.net.role === 'host') return startOnlineGame(ui.gameMode);
  sendAct({ kind: 'rematch' });
  ui.flash = 'Rematch requested…';
  render();
}

function afterAction() {
  ui.selected = null; ui.moves = []; ui.tool = null; ui.swapFirst = null;
  if (G.result) return gameOver();
  if (ui.online) { startClock(G.turn); return render(); }
  stopClock();
  render();
  setTimeout(() => handoff(G.turn), ui.privacy ? 650 : 250);
}

function gameOver() {
  stopClock();
  ui.phase = 'over';
  ui.showResult = true;
  ui.drawOffered = false;
  ui.selected = null; ui.moves = []; ui.tool = null;
  overlay.classList.add('hidden');
  sound('end');
  render();
}

function capturesNow() { return G.captured.w.length + G.captured.b.length; }

function doMove(m) {
  if (m.promo === true) { ui.promo = m; return render(); } // ask which piece first
  ui.promo = null;
  const before = capturesNow();
  const revealedBefore = G.board.filter((p) => p && p.shown === p.type).length;
  try { E.makeMove(G, m); } catch (e) { ui.flash = e.message; return render(); }
  sendAct({ kind: 'move', move: { from: m.from, to: m.to, traitor: !!m.traitor, promo: typeof m.promo === 'string' ? m.promo : undefined } });
  const revealed = G.board.filter((p) => p && p.shown === p.type).length > revealedBefore;
  sound(G.check ? 'check' : revealed ? 'reveal' : capturesNow() > before ? 'capture' : 'move');
  ui.fresh = m.to;
  ui.flash = '';
  afterAction();
}

function canAct() {
  return ui.phase === 'play' && !G.result && G.turn === ui.viewer && overlay.classList.contains('hidden');
}

function onSwapClick(i) {
  const p = G.board[i];
  if (!p || p.owner !== G.turn || p.type === 'K') return;
  if (ui.swapFirst == null || ui.swapFirst === i) {
    ui.swapFirst = ui.swapFirst === i ? null : i;
    return render();
  }
  const a = ui.swapFirst;
  E.doSwap(G, a, i);
  sendAct({ kind: 'swap', a, b: i });
  sound('reveal');
  ui.fresh = null;
  ui.flash = '';
  afterAction();
}

// ---------------------------------------------------------------- board input (click + drag)
let drag = null;
let hoverEl = null;
const setHover = (el) => {
  if (hoverEl === el) return;
  if (hoverEl) hoverEl.classList.remove('hover');
  hoverEl = el;
  if (hoverEl) hoverEl.classList.add('hover');
};

boardEl.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.sq');
  if (!el) return;
  e.preventDefault();
  const i = +el.dataset.sq;
  if (ui.promo) { ui.promo = null; return render(); }
  if (ui.phase === 'secret') {
    const step = currentStep();
    if (step === 'hiddenQueen') E.setHiddenQueen(G, ui.viewer, i);
    if (step === 'traitor') E.setTraitor(G, ui.viewer, i);
    return render();
  }
  if (!canAct()) return;
  if (ui.tool === 'swap') return onSwapClick(i);
  if (ui.selected != null) {
    const m = ui.moves.find((x) => x.to === i);
    if (m) return doMove(m);
  }
  const p = G.board[i];
  const tr = G.traitor[G.turn];
  const selectable = ui.tool === 'traitor' ? p && tr && p.id === tr.id : p && p.owner === G.turn;
  if (!selectable) {
    if (ui.tool !== 'traitor') { ui.selected = null; ui.moves = []; }
    return render();
  }
  ui.selected = i;
  ui.moves = E.legalMoves(G, i, { traitor: ui.tool === 'traitor' });
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
    ghost.className = drag.src.className.replace('fresh', '') + ' drag-ghost';
    ghost.innerHTML = drag.src.innerHTML;
    drag.src.classList.add('dragging');
  }
  ghost.style.left = e.clientX + 'px';
  ghost.style.top = e.clientY + 'px';
  setHover(document.elementFromPoint(e.clientX, e.clientY)?.closest('.sq') || null);
});

window.addEventListener('pointerup', (e) => {
  if (!drag) return;
  const d = drag;
  drag = null;
  setHover(null);
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
    case 'flip': ui.flipped = !ui.flipped; return render();
    case 'rematch': return rematch();
    case 'confirm': {
      const step = currentStep();
      if (step === 'hiddenQueen') sendAct({ kind: 'setHQ', color: c, sq: E.findById(G, G.hiddenQueen[c]).sq });
      if (step === 'traitor') sendAct({ kind: 'setTraitor', color: c, sq: E.findById(G, G.traitor[c].id).sq });
      ui.setupQueue[0].steps.shift();
      if (ui.online) {
        if (!ui.setupQueue[0].steps.length) return markReady();
        return render();
      }
      return runSetup();
    }
    case 'cancel': ui.tool = null; ui.swapFirst = null; ui.selected = null; ui.moves = []; return render();
    case 'swap': ui.tool = 'swap'; ui.selected = null; ui.moves = []; return render();
    case 'traitor': {
      const f = E.findById(G, G.traitor[c].id);
      ui.tool = 'traitor';
      ui.selected = f.sq;
      ui.moves = E.legalMoves(G, f.sq, { traitor: true });
      if (!ui.moves.length) { ui.tool = null; ui.selected = null; ui.flash = 'Your traitor has no legal moves right now.'; }
      return render();
    }
    case 'resign':
      if (confirm(`${ui.names[c]}, resign this game?`)) { E.resign(G, c); sendAct({ kind: 'resign', color: c }); gameOver(); }
      return;
    case 'draw':
      if (ui.online) { sendAct({ kind: 'drawOffer' }); ui.flash = 'Draw offered. Waiting for an answer…'; return render(); }
      if (confirm(`Does ${ui.names[other(c)]} agree to a draw?`)) { E.agreeDraw(G); gameOver(); }
      return;
    case 'draw-accept': sendAct({ kind: 'drawReply', accept: true }); E.agreeDraw(G); return gameOver();
    case 'draw-decline': ui.drawOffered = false; sendAct({ kind: 'drawReply', accept: false }); return render();
  }
});

// ---------------------------------------------------------------- modals
function closeModal() { modal.classList.add('hidden'); modal.innerHTML = ''; ui.lobbyOpen = false; }
function cancelLobby() {
  if (ui.net && !ui.online) netTeardown();
  closeModal();
}
modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('[data-close]')) cancelLobby(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.classList.contains('hidden')) cancelLobby(); });

function openNewGame() {
  let mode = ui.gameMode;
  ui.lobbyOpen = false;
  const draw = () => {
    modal.innerHTML = `<div class="modal" role="dialog" aria-label="New game">
      <div class="modal-head"><h2>${pieceSVG('N', 'w')} New Game</h2><button class="btn ghost small" data-close>✕</button></div>
      <div class="modal-body">
        <div class="section-label">Game mode</div>
        <div class="twist-grid" role="radiogroup">${MODES.map((m) => `
          <button class="twist-opt ${m.key === mode ? 'on' : ''}" data-mode="${m.key}" role="radio" aria-checked="${m.key === mode}">
            <span class="ti">${m.icon}</span>
            <span><div class="tt">${m.name}</div><div class="td">${m.desc}</div></span>
            <span class="check radio">${m.key === mode ? '●' : ''}</span>
          </button>`).join('')}</div>
        <div class="play-choices">
          <button class="btn primary big" id="play-online">🌐 Play Online</button>
          <button class="btn big secondary" id="play-local">👥 Pass &amp; Play</button>
        </div>
        <details class="local-opts">
          <summary>Pass &amp; play settings</summary>
          <div class="names">
            <input id="name-w" maxlength="16" value="${esc(ui.localNames.w)}" placeholder="White" aria-label="White player name">
            <input id="name-b" maxlength="16" value="${esc(ui.localNames.b)}" placeholder="Black" aria-label="Black player name">
          </div>
          <label class="toggle-line"><input type="checkbox" id="privacy" ${ui.privacy ? 'checked' : ''}> Privacy screen between turns</label>
        </details>
      </div></div>`;
    modal.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => { saveForm(); mode = b.dataset.mode; draw(); }));
    $('play-local').addEventListener('click', () => { saveForm(); startLocalGame(mode); });
    $('play-online').addEventListener('click', () => { saveForm(); ui.gameMode = mode; store.set('mode', mode); openLobby(); });
  };
  const saveForm = () => {
    ui.localNames.w = $('name-w').value.trim() || 'White';
    ui.localNames.b = $('name-b').value.trim() || 'Black';
    ui.privacy = $('privacy').checked;
    store.set('names', ui.localNames);
    store.set('privacy', ui.privacy);
  };
  draw();
  modal.classList.remove('hidden');
}

function openLobby() {
  if (ui.online) netTeardown();
  ui.lobbyOpen = true;
  renderLobby();
  modal.classList.remove('hidden');
}

// Invite links always point at the public site, so they work for friends even if you opened the game from a file.
const PUBLIC_URL = 'https://oksem42.github.io/twisted-gambit/';
function inviteLink(code) {
  const here = location.protocol.startsWith('http') && !/^(localhost|127\.)/.test(location.hostname)
    ? location.origin + location.pathname : PUBLIC_URL;
  return `${here}?join=${code}`;
}

function renderLobby() {
  const n = ui.net;
  const mode = modeInfo(ui.gameMode);
  let body;
  if (!netAvailable()) {
    body = `<div class="card alert"><h3>Online play unavailable</h3><p>The online play library couldn't load. Check your internet connection and reload the page.</p></div>`;
  } else if (n && n.quick && ['searching', 'waiting', 'connected'].includes(n.status)) {
    body = `<div class="code-box">
        <div class="eyebrow">Random opponent · ${mode.icon} ${mode.name}</div>
        <p class="lobby-wait" style="justify-content:center;margin:14px 0 4px"><span class="spinner"></span>${n.status === 'connected' ? 'Opponent found! Starting…' : 'Looking for an opponent…'}</p>
      </div>
      <p class="lobby-help">You'll be matched with the next player who searches for <b>${mode.name}</b>. If nobody else is online it can take a while. You can also cancel and invite a friend with a link.</p>
      <button class="btn" data-lobby="cancel">Cancel</button>`;
  } else if (n && n.role === 'host' && (n.status === 'connecting' || n.status === 'waiting' || n.status === 'connected')) {
    body = `<div class="code-box">
        <div class="eyebrow">Your game code</div>
        <div class="code" id="game-code">${n.status === 'connecting' ? '·····' : esc(n.code)}</div>
        <div class="invite ${n.status === 'connecting' ? 'hidden' : ''}">
          <input id="invite-link" readonly value="${esc(inviteLink(n.code))}" aria-label="Invite link">
          <button class="btn primary small" data-lobby="copy-link">Copy invite link</button>
        </div>
        ${navigator.share ? `<button class="btn small" data-lobby="share" ${n.status === 'connecting' ? 'disabled' : ''}>Share…</button>` : ''}
      </div>
      <p class="lobby-wait"><span class="spinner"></span>${n.status === 'connecting' ? 'Creating game…' : n.status === 'connected' ? 'Friend connected! Starting…' : 'Waiting for your friend to join…'}</p>
      <p class="lobby-help">Send the invite link to your friend. Clicking it joins your game straight away. (Or they can open Gerasimos Gambit, click <b>Play Online</b> and type the code.) You'll play White in <b>${mode.icon} ${mode.name}</b>.</p>
      <button class="btn" data-lobby="cancel">Cancel</button>`;
  } else if (n && n.role === 'guest' && n.status !== 'error' && n.status !== 'closed') {
    body = `<p class="lobby-wait"><span class="spinner"></span>Connecting to game <b>${esc(n.code)}</b>…</p>
      <button class="btn" data-lobby="cancel">Cancel</button>`;
  } else {
    body = `
      <div class="section-label">Your name</div>
      <div class="names one"><input id="my-name" maxlength="16" value="${esc(ui.myName)}" placeholder="Your name" aria-label="Your name"></div>
      <div class="card quick-card"><div><h3>⚡ Play a random opponent</h3><p>Get matched with anyone else looking for a <b>${mode.icon} ${mode.name}</b> game.</p></div>
        <button class="btn primary" data-lobby="quick">Find Opponent</button></div>
      <div class="online-grid">
        <div class="card"><h3>Create a game</h3><p>Get a code to send to a friend. Mode: <b>${mode.icon} ${mode.name}</b>.</p>
          <button class="btn primary" data-lobby="create">Create Game</button></div>
        <div class="card"><h3>Join a game</h3><p>Enter the code your friend sent you.</p>
          <div class="join-row"><input id="join-code" maxlength="5" placeholder="CODE" autocomplete="off" spellcheck="false" aria-label="Game code">
          <button class="btn primary" data-lobby="join">Join</button></div></div>
      </div>
      ${n && n.error ? `<div class="flash err">${esc(n.error)}</div>` : ''}
      ${n && n.status === 'closed' ? '<div class="flash err">The connection closed.</div>' : ''}
      <p class="lobby-help">Online games connect your browser directly to your friend's. Both of you need an internet connection.</p>`;
  }
  modal.innerHTML = `<div class="modal" role="dialog" aria-label="Play online">
    <div class="modal-head"><h2>🌐 Play Online</h2><button class="btn ghost small" data-close>✕</button></div>
    <div class="modal-body">${body}</div></div>`;
  const saveName = () => {
    const el = $('my-name');
    if (el) { ui.myName = el.value.trim().slice(0, 16); store.set('myName', ui.myName); }
  };
  modal.querySelectorAll('[data-lobby]').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.lobby;
    if (a === 'create') { saveName(); netHost(ui.gameMode); renderLobby(); }
    if (a === 'quick') { saveName(); quickWait(ui.gameMode); renderLobby(); }
    if (a === 'join') {
      saveName();
      const code = ($('join-code').value || '').trim().toUpperCase();
      if (code.length !== 5) { ui.net = { status: 'error', error: 'Codes are 5 characters long.' }; return renderLobby(); }
      netJoin(code); renderLobby();
    }
    if (a === 'cancel') { netTeardown(); renderLobby(); }
    if (a === 'copy-link') {
      const input = $('invite-link');
      input.select();
      Promise.resolve().then(() => navigator.clipboard.writeText(input.value))
        .then(() => { b.textContent = 'Copied!'; })
        .catch(() => { document.execCommand('copy'); b.textContent = 'Copied!'; });
    }
    if (a === 'share') {
      navigator.share({ title: 'Gerasimos Gambit', text: 'Play chess with secrets against me!', url: inviteLink(ui.net.code) }).catch(() => {});
    }
  }));
  const jc = $('join-code');
  if (jc) {
    jc.addEventListener('input', () => { jc.value = jc.value.toUpperCase().replace(/[^A-Z0-9]/g, ''); });
    jc.addEventListener('keydown', (e) => { if (e.key === 'Enter') modal.querySelector('[data-lobby="join"]').click(); });
  }
}

function openRules() {
  ui.lobbyOpen = false;
  modal.innerHTML = `<div class="modal" role="dialog" aria-label="Rules">
    <div class="modal-head"><h2>📖 Rules</h2><button class="btn ghost small" data-close>✕</button></div>
    <div class="modal-body">
      <h4>Base game</h4>
      <p>Full standard chess rules, the same as chess.com: <b>checkmate wins</b>. You can never make a move that
      leaves your own king in check, so pinned pieces stay put and kings can't stand next to each other.
      Each game mode adds one secret twist.</p>
      <ul>
        <li><b>Castling:</b> the king and rook haven't moved, the squares between are empty, and the king isn't in check, doesn't pass through an attacked square, and doesn't land on one.</li>
        <li><b>En passant:</b> a pawn that just moved two squares can be captured as if it moved one, but only on the very next move.</li>
        <li><b>Promotion:</b> a pawn reaching the last rank becomes a queen, rook, bishop or knight (your choice).</li>
        <li><b>Draws:</b> stalemate, threefold repetition, the 50-move rule (50 moves each with no capture or pawn move), insufficient material, or agreement. These are declared automatically.</li>
        <li><b>Hidden pieces and check:</b> the game judges with every piece's true identity. A disguised piece that gives check is revealed immediately.</li>
      </ul>
      ${MODES.map((m) => `<h4>${m.icon} ${m.name}</h4><p>${m.desc}</p>`).join('')}
      <h4>Details</h4>
      <ul>
        <li><b>Secret Queen:</b> a disguised queen can make pawn moves (including the two-square first move) without being revealed. If it reaches the last rank it's revealed.</li>
        <li><b>Traitor:</b> using it takes your whole turn. The traitor can't capture a king, and the move can't leave your own king in check. If the traitor is captured first, the power is lost.</li>
        <li><b>Secret Swap:</b> takes your turn and can't be used while you're in check. The move list shows that a swap happened, but not which pieces. A swapped piece is revealed when it makes a move its disguise couldn't.</li>
        <li><b>Pass &amp; play:</b> a privacy screen hides the board between turns so the next player can take the device.</li>
        <li><b>Online:</b> create a game and send the invite link (or 5-letter code), or press <b>Find Opponent</b> to be matched with a random player in the same mode.</li>
      </ul>
    </div></div>`;
  modal.classList.remove('hidden');
}

// ---------------------------------------------------------------- sidebar
$('logo-mark').innerHTML = pieceSVG('N', 'w').replace(/#ffffff/g, '#81b64c').replace(/#302e2c/g, '#1e2a14');
$('nav-ic-play').innerHTML = pieceSVG('P', 'w');
document.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => {
  const n = b.dataset.nav;
  if (n === 'new') openNewGame();
  if (n === 'online') openLobby();
  if (n === 'rules') openRules();
}));
function renderSound() {
  $('sound-ic').textContent = ui.sound ? '🔊' : '🔇';
  $('sound-label').textContent = ui.sound ? 'Sound on' : 'Sound off';
}
$('sound-toggle').addEventListener('click', () => { ui.sound = !ui.sound; store.set('sound', ui.sound); renderSound(); if (ui.sound) sound('move'); });
renderSound();
window.addEventListener('beforeunload', () => { try { if (ui.net && ui.net.peer) ui.net.peer.destroy(); } catch { /* ignore */ } });

// Expose for debugging / automated checks.
window.__tg = { E, get G() { return G; }, ui };

render();
// Opening an invite link (?join=CODE) jumps straight into that game.
const joinCode = (new URLSearchParams(location.search).get('join') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
if (joinCode.length === 5 && netAvailable()) {
  history.replaceState(null, '', location.pathname);
  ui.lobbyOpen = true;
  modal.classList.remove('hidden');
  netJoin(joinCode);
  renderLobby();
} else {
  openNewGame();
}
})();
