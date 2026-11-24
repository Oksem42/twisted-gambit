(function () {
const E = globalThis.TGEngine;
const { pieceSVG, tokenSVG } = globalThis.TGPieces;
const I = globalThis.TGIcons;
const Bot = globalThis.TGBot;
const Jules = globalThis.TGJules;
const Mini = globalThis.TGMini;
const BOTS = {
  v1: { engine: Bot, name: Bot.NAME, tag: 'A friendly sparring partner', icon: I.robot },
  jules: { engine: Jules, name: Jules.NAME, tag: 'Best chess player of all time', icon: I.crown },
};
const { W, B, other, PIECE_NAME } = E;
const COLOR = { w: 'White', b: 'Black' };

// Each twist is its own game mode.
const MODES = [
  { key: 'hiddenQueen', name: 'Secret Queen', icon: I.queen,
    desc: 'You keep your normal queen and get a second, secret queen disguised as one of your pawns. It stays a "pawn" as long as it moves like one, and is revealed the moment it makes a queen move.' },
  { key: 'traitor', name: 'Traitor', icon: I.traitor,
    desc: 'Secretly mark one enemy piece. Once per game, take control of it for a single move, even to capture its own teammates.' },
  { key: 'objective', name: 'Hidden Objective', icon: I.objective,
    desc: 'Each player draws a secret goal. Complete it, or checkmate the king, to win.' },
  { key: 'swap', name: 'Secret Swap', icon: I.swap,
    desc: 'Once per game, swap the identities of two of your pieces. To your opponent they keep their old look.' },
  { key: 'mines', name: 'Landmine', icon: I.mine,
    desc: "Each player secretly plants 2 mines in the opponent's half. Any enemy piece except the king that lands on one is blown up." },
  { key: 'prophecy', name: 'Prophecy', icon: I.prophecy,
    desc: "After your move, secretly predict your opponent's reply. If they play exactly that, you get a double move. Recharges 5 turns after each use." },
  { key: 'shifter', name: 'Shapeshifter', icon: I.shifter,
    desc: 'Secretly pick one of your pieces. Each time it captures, it becomes the piece it captured, but keeps its old look.' },
  { key: 'gambler', name: "Gambler's Gambit", icon: I.wheel,
    desc: 'Every capture spins a wheel, and better pieces get bigger slices. Whoever it lands on takes the other. Only the king always wins. Earn coins and buy new pieces in the shop.' },
  { key: 'powers', name: '"Regular chess"', icon: I.bolt,
    desc: 'Hold 3 random powers: minigame duels, pistons, magnets, portals, banana peels and more. A used power recharges for 3 turns and comes back as a new random one.' },
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
  premoves: [], preSel: false,
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
    const tones = { move: [[330, 140, 0]], capture: [[240, 80, 0], [180, 70, 0.05]], end: [[523, 523, 0], [659, 659, 0.12], [784, 784, 0.24]], reveal: [[440, 880, 0]], boom: [[160, 40, 0], [110, 30, 0.05], [70, 25, 0.1]], check: [[660, 660, 0], [880, 880, 0.08]], spin: [[520, 700, 0], [620, 820, 0.09], [720, 940, 0.18]] }[kind];
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

// ---------------------------------------------------------------- clocks: 10 minutes each, counting down
// ui.clock[c] holds the time each player has USED; the display shows what's left.
const TIME_CONTROL = 10 * 60 * 1000;
const LOW_TIME = 20 * 1000;
function tick() {
  const c = ui.clock;
  if (!c.running) return;
  const now = performance.now();
  c[c.running] = Math.min(TIME_CONTROL, c[c.running] + (now - c.since));
  c.since = now;
}
function startClock(color) { tick(); ui.clock.running = color; ui.clock.since = performance.now(); }
function stopClock() { tick(); ui.clock.running = null; }
const timeLeft = (c) => Math.max(0, TIME_CONTROL - ui.clock[c]);
function fmtLeft(c) {
  const ms = timeLeft(c);
  if (ms < LOW_TIME) return `0:${String(Math.floor(ms / 1000)).padStart(2, '0')}.${Math.floor((ms % 1000) / 100)}`; // tenths, like chess.com
  const sec = Math.ceil(ms / 1000);
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
function updateClocks() {
  document.querySelectorAll('.clock[data-c]').forEach((el) => {
    const c = el.dataset.c;
    el.querySelector('.ct').textContent = fmtLeft(c);
    el.classList.toggle('active', ui.clock.running === c);
    el.classList.toggle('low', timeLeft(c) < LOW_TIME && ui.phase !== 'menu');
  });
}
function checkFlag() {
  const c = ui.clock.running;
  if (!c || ui.phase !== 'play' || G.result || timeLeft(c) > 0) return;
  // Online, each browser only calls time on its own clock; the other side hears about it.
  if (ui.online && c !== ui.viewer) return;
  E.timeout(G, c);
  sendAct({ kind: 'timeout', color: c });
  gameOver();
}
setInterval(() => { tick(); updateClocks(); checkFlag(); }, 100);

// ---------------------------------------------------------------- online
// Games connect through Supabase Realtime (js/relay.js), like Charmed Hold'em, so they work on any network.
// If Supabase can't be reached, they fall back to PeerJS, which connects the two browsers directly.
const NET_PREFIX = 'twisted-gambit-v1-';
const Relay = globalThis.TGRelay;
const relayOn = () => !!(Relay && Relay.available());
const netAvailable = () => relayOn() || typeof window.Peer === 'function';
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
  if (n.mm) n.mm.cancel();
  try { if (n.conn) n.conn.close(); } catch { /* ignore */ }
  try { if (n.peer) n.peer.destroy(); } catch { /* ignore */ }
}
function netHost(mode, code = makeCode()) {
  if (!relayOn()) return peerHost(mode, code);
  netTeardown();
  const n = ui.net = { role: 'host', code, myColor: W, status: 'connecting', mode, oppName: null, error: '', via: 'relay' };
  Relay.host(code).then((h) => {
    if (ui.net !== n) return h.destroy();
    n.peer = h;
    n.status = 'waiting';
    h.on('connection', (conn) => acceptConn(n, conn));
    refresh();
  }).catch((e) => {
    if (ui.net !== n) return;
    if (e.message === 'taken') return netHost(mode); // code already in use: pick another
    peerHost(mode, code);
  });
}
function peerHost(mode, code = makeCode()) {
  netTeardown();
  const n = ui.net = { role: 'host', code, myColor: W, status: 'connecting', mode, oppName: null, error: '', via: 'peer' };
  if (typeof window.Peer !== 'function') { n.status = 'error'; n.error = 'Could not reach the game server. Check your internet connection.'; return refresh(); }
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
// ---- Random matchmaking through the relay: wait in the mode's lobby and pair with the next searcher.
function quickSearch(mode) {
  if (!relayOn()) return quickWait(mode);
  netTeardown();
  const n = ui.net = { role: 'guest', quick: true, code: '', myColor: B, status: 'searching', mode, oppName: null, error: '', via: 'relay' };
  n.mm = Relay.matchmake(mode, ({ role, code }) => {
    if (ui.net !== n) return;
    n.mm = null;
    if (role === 'host') quickRelayHost(mode, code); else quickRelayJoin(mode, code);
  }, () => { if (ui.net === n) quickWait(mode); });
}
function quickRelayHost(mode, code) {
  netTeardown();
  const n = ui.net = { role: 'host', quick: true, code, myColor: W, status: 'searching', mode, oppName: null, error: '', via: 'relay' };
  const retry = () => { if (ui.net === n && !ui.online) quickSearch(mode); };
  n.timer = setTimeout(retry, 15000); // the partner never showed up: back to the lobby
  n.onEarlyClose = retry;
  Relay.host(code).then((h) => {
    if (ui.net !== n) return h.destroy();
    n.peer = h;
    h.on('connection', (conn) => { clearTimeout(n.timer); acceptConn(n, conn); });
  }).catch(retry);
}
function quickRelayJoin(mode, code) {
  netTeardown();
  const n = ui.net = { role: 'guest', quick: true, code, myColor: B, status: 'searching', mode, oppName: null, error: '', via: 'relay' };
  const retry = () => { if (ui.net === n && !ui.online) quickSearch(mode); };
  n.onEarlyClose = retry;
  Relay.join(code).then((conn) => {
    if (ui.net !== n) return conn.close();
    n.peer = { destroy: () => conn.close() };
    bindConn(n, conn);
  }).catch(retry);
}

function netJoin(code) {
  code = code.trim().toUpperCase();
  if (!relayOn()) return peerJoin(code);
  netTeardown();
  const n = ui.net = { role: 'guest', code, myColor: B, status: 'connecting', oppName: null, error: '', via: 'relay' };
  Relay.join(code).then((conn) => {
    if (ui.net !== n) return conn.close();
    n.peer = { destroy: () => conn.close() };
    bindConn(n, conn);
  }).catch((e) => {
    if (ui.net !== n) return;
    if (e.message === 'full') { n.status = 'error'; n.error = 'That game already has two players.'; return refresh(); }
    peerJoin(code); // the host may be on a direct connection instead
  });
}
function peerJoin(code) {
  netTeardown();
  const n = ui.net = { role: 'guest', code: code.trim().toUpperCase(), myColor: B, status: 'connecting', oppName: null, error: '', via: 'peer' };
  if (typeof window.Peer !== 'function') { n.status = 'error'; n.error = 'Could not reach the game server. Check your internet connection.'; return refresh(); }
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
  if (err.type === 'unavailable-id' && n.role === 'host') return peerHost(n.mode);
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
  ui.bot = null;
  ui.lobbyOpen = false;
  closeModal();
  cancelSpin();
  overlay.classList.add('hidden');
  ui.gameMode = mode;
  ui.names = names;
  ui.viewer = ui.net.myColor;
  ui.clock = { w: 0, b: 0, running: null, since: 0 };
  ui.ready = { w: false, b: false };
  Object.assign(ui, { selected: null, moves: [], tool: null, swapFirst: null, fresh: null, flash: '', flipped: false, showResult: false, drawOffered: false, premoves: [], preSel: false });
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
  if (ui.spinning) { ui.netQueue.push(a); return; } // wait until the wheel on screen has finished
  if (ui.predict && a.kind !== 'drawOffer') { G = ui.predict.realG; ui.predict = null; ui.tool = null; } // drop an unfinished prophecy
  try {
    switch (a.kind) {
      case 'setHQ': E.setHiddenQueen(G, a.color, a.sq); break;
      case 'setTraitor': E.setTraitor(G, a.color, a.sq); break;
      case 'setMines': E.setMines(G, a.color, a.squares); break;
      case 'setShifter': E.setShifter(G, a.color, a.sq); break;
      case 'ready': ui.ready[a.color] = true; return checkReady();
      case 'move': {
        if (a.t != null) ui.clock[G.turn] = Math.min(TIME_CONTROL, a.t);
        const go = () => {
          const before = capturesNow();
          try { E.makeMove(G, a.move); } catch (e) { ui.flash = `Sync problem: ${e.message}`; return render(); }
          sound(G.lastExplosion != null ? 'boom' : G.check ? 'check' : capturesNow() > before ? 'capture' : 'move');
          ui.fresh = null;
          ui.anim = slidesFor(a.move);
          afterAction();
        };
        const spin = G.twists.gambler ? E.previewSpin(G, a.move) : null;
        return spin && spin.odds < 1 ? showSpin(spin, go) : go();
      }
      case 'power':
        if (a.t != null) ui.clock[G.turn] = Math.min(TIME_CONTROL, a.t);
        E.usePower(G, a.slot, a.args); return afterPower();
      case 'freePush': E.freePush(G, a.from, a.to); ui.anim = [{ from: a.from, to: a.to }]; sound('move'); break;
      case 'mgScore':
        if (ui.mg) { ui.mg.scores[a.color] = a.score; ui.mg.handle.remote(a.color, a.score, true); finishMinigameUI(); }
        return;
      case 'mgProg': if (ui.mg) ui.mg.handle.remote(a.color, a.score, false); return;
      case 'buy':
        if (a.t != null) ui.clock[G.turn] = Math.min(TIME_CONTROL, a.t);
        E.buyPiece(G, a.piece, a.sq); sound('reveal'); ui.fresh = a.sq; return afterAction();
      case 'swap':
        if (a.t != null) ui.clock[G.turn] = Math.min(TIME_CONTROL, a.t);
        E.doSwap(G, a.a, a.b); sound('reveal'); return afterAction();
      case 'resign': E.resign(G, a.color); return gameOver();
      case 'timeout': if (!G.result) { ui.clock[a.color] = TIME_CONTROL; E.timeout(G, a.color); } return gameOver();
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
  if (p.type === 'X') return `<div class="wall-tile" title="Brick wall">${I.pw_wall}</div>`;
  const omni = isOmni();
  const seeTrue = omni || p.owner === ui.viewer;
  const t = seeTrue ? p.type : p.shown;
  let badges = '';
  if (seeTrue && p.shown && p.shown !== p.type) {
    badges += `<span class="badge mask" title="Your opponent sees a ${PIECE_NAME[p.shown]}">${pieceSVG(p.shown, 'w')}</span>`;
  }
  for (const c of omni ? [W, B] : [ui.viewer]) {
    const tr = G.traitor[c];
    if (tr && tr.id === p.id && !tr.used) badges += `<span class="badge dagger" title="${COLOR[c]}'s traitor">${I.traitor}</span>`;
    if (G.shifter && G.shifter[c] === p.id) badges += `<span class="badge lizard" title="${COLOR[c]}'s shapeshifter">${I.shifter}</span>`;
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
  } else if (step === 'mines') {
    for (let i = 0; i < 64; i++) if (c === W ? E.rankOf(i) >= 4 : E.rankOf(i) <= 3) pickable.add(i);
    G.mines[c].forEach((i) => picked.add(i));
  } else if (step === 'shifter') {
    each((p, i) => { if (p.owner === c && p.type !== 'K') pickable.add(i); });
    const f = E.findById(G, G.shifter[c]); if (f) picked.add(f.sq);
  } else if ((ui.tool === 'power' || ui.tool === 'freepush') && ui.power) {
    const k = ui.power.picks.length;
    for (const o of powerMatches()) if (o.clicks[k]) o.clicks[k].forEach((i) => pickable.add(i));
    ui.power.picks.forEach((i) => picked.add(i));
  } else if (ui.tool === 'buy') {
    E.legalDrops(G, c, ui.buyType).forEach((i) => pickable.add(i));
  } else if (ui.predict) {
    const g = ui.predict.guess;
    if (g) { picked.add(g.from); picked.add(g.to); }
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
  const shown = ui.premoves.length ? preBoard() : G.board; // queued premoves are drawn as if played
  const preSquares = new Set(ui.premoves.flatMap((q) => [q.from, q.to]));
  let html = '';
  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const r = flip ? row : 7 - row, f = flip ? 7 - col : col, i = E.sq(f, r);
      const cls = ['sq', (f + r) % 2 === 1 ? 'light' : 'dark'];
      const lm = G.lastMove;
      if ((lm && ui.phase !== 'menu' && (lm.from === i || lm.to === i)) || ui.selected === i) cls.push('hl');
      if (picked.has(i)) cls.push('pick');
      if (pickable.has(i)) cls.push('pickable');
      if (preSquares.has(i)) cls.push('pre');
      const p = shown[i], real = G.board[i];
      let inner = '';
      if (col === 0) inner += `<span class="coord rank">${r + 1}</span>`;
      if (row === 7) inner += `<span class="coord file">${E.FILES[f]}</span>`;
      if (real && real.type === 'K' && G.check === real.owner && ui.phase !== 'menu') cls.push('incheck');
      if (p) inner += pieceHTML(p, ui.fresh === i ? 'fresh' : '');
      const m = targets.get(i);
      if (m) inner += p || m.ep ? '<span class="ring"></span>' : '<span class="dot"></span>';
      if (ui.phase !== 'menu' && (isOmni() ? [W, B] : [ui.viewer]).some((c) => G.mines[c].includes(i))) inner += `<span class="mine" title="Mine">${I.mine}</span>`;
      if (G.twists.powers && ui.phase !== 'menu') {
        for (const c of [W, B]) { const pr = G.portals[c]; if (pr && (pr.a === i || pr.b === i)) inner += `<span class="portal ${c}" title="${COLOR[c]}'s portal"></span>`; }
        if ((isOmni() ? [W, B] : [ui.viewer]).some((c) => G.bananas[c].includes(i))) inner += `<span class="banana" title="Banana peel">${I.pw_banana}</span>`;
      }
      if (ui.phase !== 'menu' && G.lastExplosion === i) inner += `<span class="boom">${I.boom}</span>`;
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
    return `<span class="chip ${id == null || (f && f.piece.shown === 'P') ? '' : 'spent'}" title="Secret queen">${I.queen} secret queen</span>`;
  }
  if (t.traitor) {
    const tr = G.traitor[c];
    const spent = tr && (tr.used || !E.findById(G, tr.id));
    return `<span class="chip ${spent ? 'spent' : ''}" title="Traitor">${I.traitor} traitor</span>`;
  }
  if (t.swap) return `<span class="chip ${G.swapUsed[c] ? 'spent' : ''}" title="Secret swap">${I.swap} swap</span>`;
  if (t.objective) return `<span class="chip" title="Secret objective">${I.objective} objective</span>`;
  if (t.mines) return `<span class="chip ${G.mines[c].length ? '' : 'spent'}" title="Hidden mines left">${I.mine} ×${G.mines[c].length}</span>`;
  if (t.prophecy) {
    const wait = E.prophecyWait(G, c);
    return wait
      ? `<span class="chip spent-soft" title="Prophecy recharging">${I.prophecy} in ${wait}</span>`
      : `<span class="chip" title="Prophecy">${I.prophecy} prophecy</span>`;
  }
  if (t.shifter) {
    const id = G.shifter[c];
    return `<span class="chip ${id != null && !E.findById(G, id) ? 'spent' : ''}" title="Shapeshifter">${I.shifter} shapeshifter</span>`;
  }
  if (t.powers) return `<span class="chip" title="Powers ready to use">${I.bolt} ${G.powers[c].filter((p) => !p.wait).length}/3 ready</span>`;
  if (t.gambler) return `<span class="chip coin-chip" title="Coins">${I.coin} ${G.coins[c]}</span>`;
  return '';
}

function capturedHTML(c) {
  const caps = G.captured[c].filter((x) => x.owner !== c);
  const groups = ['P', 'N', 'B', 'R', 'Q', 'S', 'K'].map((t) => caps.filter((x) => x.type === t)).filter((g) => g.length);
  const adv = material(c) - material(other(c));
  return groups.map((g) => `<span class="grp">${g.map((x) => pieceSVG(x.type, x.owner)).join('')}</span>`).join('')
    + (adv > 0 ? `<span class="adv">+${adv}</span>` : '');
}

const avatar = (c, cls = '') => `<div class="avatar ${c} ${cls}">${pieceSVG('P', c)}</div>`;

function renderBar(el, c) {
  const you = (ui.online || ui.bot) && c === ui.viewer ? ' · you' : '';
  el.innerHTML = `
    ${avatar(c)}
    <div class="who">
      <div class="name"><span class="nm">${nm(c)}</span><span class="tag">(${COLOR[c]}${you})</span><span class="chips">${publicChips(c)}</span></div>
      <div class="caps">${capturedHTML(c)}</div>
    </div>
    <div class="clock" data-c="${c}"><span class="ci">${I.clock}</span><span class="ct">${fmtLeft(c)}</span></div>`;
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

// Sliding move animation (chess.com style): after the board re-renders, each moved piece
// is drawn back at its old square and glides to the new one.
const reduceMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
function slidesFor(move) {
  if (G.lastSpin && !G.lastSpin.won) return []; // the attacker lost its spin, so nothing travels
  if (G.lastMove && G.lastMove.from === move.from && G.lastMove.to !== move.to) return [{ from: move.from, to: G.lastMove.to }]; // slipped or warped
  const out = [{ from: move.from, to: move.to }];
  const p = G.board[move.to];
  if (p && p.type === 'K' && Math.abs(E.fileOf(move.to) - E.fileOf(move.from)) === 2) { // castling: the rook moves too
    const r = E.rankOf(move.from), kingside = E.fileOf(move.to) === 6;
    out.push({ from: E.sq(kingside ? 7 : 0, r), to: E.sq(kingside ? 5 : 3, r) });
  }
  return out;
}
function runSlides() {
  const list = ui.anim;
  ui.anim = null;
  if (!list || reduceMotion()) return;
  for (const { from, to } of list) {
    const fromEl = boardEl.querySelector(`[data-sq="${from}"]`);
    const toEl = boardEl.querySelector(`[data-sq="${to}"]`);
    const pc = toEl && toEl.querySelector('.pc');
    if (!fromEl || !pc || !pc.animate) continue; // e.g. the piece was blown up by a mine
    const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
    pc.classList.remove('fresh');
    pc.style.zIndex = '20';
    const anim = pc.animate(
      [{ transform: `translate(${a.left - b.left}px, ${a.top - b.top}px)` }, { transform: 'translate(0, 0)' }],
      { duration: 170, easing: 'cubic-bezier(.25,.75,.4,1)' },
    );
    anim.onfinish = anim.oncancel = () => { pc.style.zIndex = ''; };
  }
}

function render() {
  const bottom = ui.flipped ? other(ui.viewer) : ui.viewer;
  renderBoard();
  runSlides();
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
    items.push(`<li><span class="ic">${I.objective}</span><div><b>${o.text}</b>
      <div class="progress"><i style="width:${(prog / o.goal) * 100}%"></i></div></div></li>`);
  }
  if (t.hiddenQueen) items.push(`<li><span class="ic">${I.queen}</span><div>Secret queen: <b>${queenDesc(c)}</b></div></li>`);
  if (t.traitor) items.push(`<li><span class="ic">${I.traitor}</span><div>Traitor: <b>${traitorDesc(c)}</b></div></li>`);
  if (t.swap) items.push(`<li><span class="ic">${I.swap}</span><div>Secret swap: <b>${G.swapUsed[c] ? 'used' : 'ready'}</b></div></li>`);
  if (t.mines) {
    const left = G.mines[c].map(E.sqName);
    items.push(`<li><span class="ic">${I.mine}</span><div>Your mines: <b>${left.length ? left.join(', ') : ui.phase === 'secret' ? 'none yet' : 'all used up'}</b></div></li>`);
  }
  if (t.prophecy) {
    const pr = G.prophecy[c];
    const wait = E.prophecyWait(G, c);
    const again = wait ? ` Ready again in ${wait} turn${wait === 1 ? '' : 's'}.` : ' Ready to use again.';
    const txt = !pr ? 'ready: use it on your turn'
      : pr.state === 'active' ? `waiting: you predicted ${E.sqName(pr.from)} → ${E.sqName(pr.to)}`
      : (pr.state === 'hit' ? 'last one came true!' : 'last one missed.') + again;
    items.push(`<li><span class="ic">${I.prophecy}</span><div>Prophecy: <b>${txt}</b></div></li>`);
  }
  if (t.powers && G.bananas[c].length) {
    items.push(`<li><span class="ic">${I.pw_banana}</span><div>Your hidden banana peels: <b>${G.bananas[c].map(E.sqName).join(', ')}</b></div></li>`);
  }
  if (t.shifter) {
    const id = G.shifter[c], f = E.findById(G, id);
    const txt = id == null ? 'not chosen yet' : !f ? 'captured'
      : `${PIECE_NAME[f.piece.type]} on ${E.sqName(f.sq)}${f.piece.shown !== f.piece.type ? `, disguised as a ${PIECE_NAME[f.piece.shown]}` : ''}`;
    items.push(`<li><span class="ic">${I.shifter}</span><div>Shapeshifter: <b>${txt}</b></div></li>`);
  }
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
    return `<div class="card alert">${head}<h3>${I.queen} Pick your secret queen</h3>
      <p>Click one of your pawns. It secretly becomes a second queen. It keeps looking like a pawn while it moves like one, and is revealed the moment it makes a queen move.</p>
      <button class="btn primary big" data-act="confirm" ${G.hiddenQueen[c] == null ? 'disabled' : ''}>Confirm</button></div>`;
  }
  if (step === 'traitor') {
    return `<div class="card alert">${head}<h3>${I.traitor} Choose your traitor</h3>
      <p>Click one enemy piece (not the king). Once per game, on your turn, you can move it as if it were yours.</p>
      <button class="btn primary big" data-act="confirm" ${G.traitor[c] == null ? 'disabled' : ''}>Confirm</button></div>`;
  }
  if (step === 'mines') {
    const n = G.mines[c].length;
    return `<div class="card alert">${head}<h3>${I.mine} Plant your mines</h3>
      <p>Click ${E.MINES} squares in your opponent's half of the board (click again to move one). Any enemy piece except the king that lands on a mine is blown up. Your opponent can't see them.</p>
      <button class="btn primary big" data-act="confirm" ${n === E.MINES ? '' : 'disabled'}>${n === E.MINES ? 'Confirm' : `Pick ${E.MINES - n} more`}</button></div>`;
  }
  if (step === 'shifter') {
    return `<div class="card alert">${head}<h3>${I.shifter} Choose your shapeshifter</h3>
      <p>Click one of your pieces (not the king). Each time it captures, it secretly becomes the piece it captured, while keeping its current look.</p>
      <button class="btn primary big" data-act="confirm" ${G.shifter[c] == null ? 'disabled' : ''}>Confirm</button></div>`;
  }
  if (step === 'objective') {
    const o = E.objectiveById(G.objectives[c]);
    return `<div class="card alert">${head}<h3>${I.objective} Your secret objective</h3>
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

function shopCard() {
  if (!G.twists.gambler) return '';
  const c = ui.viewer, myTurn = canAct();
  const items = Object.entries(E.PRICES).map(([t, price]) => {
    const can = myTurn && G.coins[c] >= price && E.legalDrops(G, c, t).length > 0;
    return `<button class="shop-item ${ui.tool === 'buy' && ui.buyType === t ? 'on' : ''}" data-act="buy" data-piece="${t}" ${can ? '' : 'disabled'} title="Buy a ${PIECE_NAME[t]}">
      ${pieceSVG(t, c)}<span class="shop-name">${PIECE_NAME[t]}</span><span class="shop-price">${I.coin}${price}</span></button>`;
  }).join('');
  return `<div class="card shop"><div class="shop-head"><h3>${I.shop} Shop</h3><span class="shop-bal">${I.coin} ${G.coins[c]}</span></div>
    <div class="shop-grid">${items}</div>
    <p class="shop-help">Buying uses your turn. Place it on an empty square in your half. It can block a check, but can't give one.</p></div>`;
}

const POWER_HINT = {
  piston: ['Click a piece to shove (not a king).', 'Click the square to shove it toward.'],
  magnet: ['Click the square to put the magnet on.'],
  tornado: ['Click the centre of the 3×3 area to spin.'],
  bowling: ['Click any square in the column to bowl up.'],
  blower: ['Click any square in the row to blow.'],
  quake: ['Click the left half of a row to shake it left, or the right half to shake it right.'],
  wall: ['Click an empty square for the first wall.', 'Click a second empty square.'],
  portals: ['Click an empty square for the first portal.', 'Click a second empty square for the other end.'],
  banana: ['Click an empty square to hide the peel.'],
  freepush: ['Click an enemy piece to push.', 'Click the empty square to push it to.'],
};
const PRIZE_NAME = { snake: 'the Snake piece', tug: 'a free push', asteroids: 'a double move' };

function powersCard() {
  if (!G.twists.powers || ui.phase !== 'play') return '';
  const c = ui.viewer, act = canAct();
  const slots = G.powers[c].map((pw, k) => {
    const P = E.POWERS[pw.id], ready = !pw.wait;
    const usable = act && ready && E.powerOptions(G, c, k).length > 0;
    const on = ui.tool === 'power' && ui.power && ui.power.slot === k;
    return `<button class="power-slot ${on ? 'on' : ''} ${ready ? '' : 'charging'}" data-act="power" data-slot="${k}" ${usable ? '' : 'disabled'} title="${esc(ready ? P.desc : 'Recharging: a new random power arrives when it’s done.')}">
      <span class="ps-ic">${ready ? I['pw_' + pw.id] : I.clock}</span><span class="ps-name">${ready ? P.name : 'Recharging'}</span>
      <span class="ps-state">${ready ? (P.game ? 'Minigame' : 'Ready') : `${Math.min(pw.wait, E.POWER_RECHARGE)} turn${Math.min(pw.wait, E.POWER_RECHARGE) === 1 ? '' : 's'}`}</span></button>`;
  }).join('');
  const push = act && E.freePushOptions(G, c).length && ui.tool !== 'freepush' ? `<button class="btn primary" data-act="freepush">${I.pw_tug} Use your free push</button>` : '';
  return `<div class="card powers"><h3>${I.bolt} Powers</h3><div class="power-grid">${slots}</div>${push}
    <p class="shop-help">Using a power takes your turn. A used power recharges for ${E.POWER_RECHARGE} turns, then comes back as a new random one. Hover a power to read what it does.</p></div>`;
}
function powerMatches() {
  const { opts, picks } = ui.power;
  return opts.filter((o) => picks.every((p, k) => o.clicks[k] && o.clicks[k].includes(p)));
}
function powerClick(i) {
  const pw = ui.power;
  if (pw.picks.includes(i)) { pw.picks = pw.picks.filter((x) => x !== i); return render(); }
  const k = pw.picks.length;
  if (!powerMatches().some((o) => o.clicks[k] && o.clicks[k].includes(i))) return;
  pw.picks.push(i);
  const done = powerMatches().find((o) => o.clicks.length === pw.picks.length);
  if (done) return ui.tool === 'freepush' ? doFreePush(done.args) : doPower(pw.slot, done.args);
  render();
}
function doPower(slot, args) {
  tick();
  const t = Math.round(ui.clock[ui.viewer]);
  try { E.usePower(G, slot, args); } catch (e) { ui.flash = e.message; ui.tool = null; ui.power = null; return render(); }
  sendAct({ kind: 'power', slot, args, t });
  afterPower();
}
function afterPower() {
  sound('reveal');
  ui.tool = null; ui.power = null; ui.fresh = null; ui.anim = null; ui.flash = '';
  if (G.minigame) return startMinigameUI();
  afterAction();
}
function doFreePush(args) {
  try { E.freePush(G, args.from, args.to); } catch (e) { ui.flash = e.message; ui.tool = null; return render(); }
  sendAct({ kind: 'freePush', from: args.from, to: args.to });
  sound('move');
  ui.tool = null; ui.power = null; ui.selected = null; ui.moves = [];
  ui.anim = [{ from: args.from, to: args.to }];
  render();
}

// Minigames: both players play at once. Online, each browser runs its own player and sends the score.
function startMinigameUI() {
  const mg = G.minigame;
  if (!mg || ui.mg) return;
  stopClock();
  ui.selected = null; ui.moves = []; ui.tool = null; ui.power = null;
  const players = [W, B].map((c) => ({
    color: c, name: esc(ui.names[c] || COLOR[c]), bot: ui.bot && ui.bot.id,
    type: ui.bot && ui.bot.color === c ? 'bot' : ui.online && c !== ui.viewer ? 'remote' : 'local',
  }));
  const state = ui.mg = { scores: {}, game: G };
  render();
  state.handle = Mini.start($('mg'), {
    kind: mg.id, seed: mg.seed, players,
    title: `${E.POWERS[mg.id].name}: ${nm(mg.by)} started it. Winner gets ${PRIZE_NAME[mg.id]}!`,
    onDone: (c, score) => {
      if (ui.mg !== state) return;
      state.scores[c] = score;
      if (players.find((p) => p.color === c).type === 'local') sendAct({ kind: 'mgScore', color: c, score });
      finishMinigameUI();
    },
    onProgress: ui.online ? (c, score) => sendAct({ kind: 'mgProg', color: c, score }) : null,
  });
}
function finishMinigameUI() {
  const state = ui.mg;
  if (!state || state.scores.w == null || state.scores.b == null || state.closing) return;
  state.closing = true;
  const s = state.scores, winner = s.w === s.b ? null : s.w > s.b ? W : B;
  state.handle.result(winner ? `${nm(winner)} wins ${PRIZE_NAME[G.minigame ? G.minigame.id : 'snake']}!` : "It's a tie: no prize.");
  sound(winner ? 'end' : 'move');
  setTimeout(() => {
    if (ui.mg !== state) return;
    state.handle.stop();
    ui.mg = null;
    if (G !== state.game || !G.minigame) return render();
    try { E.finishMinigame(G, s); } catch (e) { ui.flash = e.message; }
    ui.anim = null;
    afterAction();
  }, 1800);
}
function cancelMini() {
  if (ui.mg) { if (ui.mg.handle) ui.mg.handle.stop(); ui.mg = null; }
}

function predictCard() {
  const g = ui.predict.guess;
  return `<div class="card alert"><h3>${I.prophecy} Predict their reply</h3>
    <p>Your move is shown on the board. Click one of your opponent's pieces, then the square you think it will move to. If they play exactly that, you get a double move on your next turn.</p>
    ${g ? `<p>Your prophecy: <b>${E.sqName(g.from)} → ${E.sqName(g.to)}</b></p>` : ''}
    <div class="btn-row"><button class="btn primary" data-act="predict-ok" ${g ? '' : 'disabled'}>Lock in prophecy</button>
    <button class="btn" data-act="predict-cancel">Cancel</button></div></div>`;
}

function playCard() {
  if (ui.predict) return predictCard();
  if (ui.mg) return `<div class="card"><h3><span class="spinner"></span>Minigame!</h3><p>The clocks are paused until it ends.</p></div>`;
  if (ui.spinning) return `<div class="card"><h3><span class="spinner"></span>Spinning the wheel…</h3><p>The clock is paused until it lands.</p></div>`;
  const c = G.turn;
  if (G.turn !== ui.viewer) {
    const msg = ui.bot ? `${nm(c)} is thinking…` : ui.online ? `Waiting for ${nm(c)} to move…` : `Pass the device to ${nm(c)}.`;
    return `<div class="card"><h3>${ui.online || ui.bot ? '<span class="spinner"></span>' : ''}${msg}</h3>
      ${ui.online || ui.bot ? (ui.premoves.length
        ? `<p>${ui.premoves.length} premove${ui.premoves.length === 1 ? '' : 's'} queued.</p><button class="btn small" data-act="premove-clear">Cancel premoves</button>`
        : '<p>Move a piece now to premove it. Right-click to cancel.</p>') : ''}
      ${ui.flash ? `<div class="flash">${ui.flash}</div>` : ''}</div>`;
  }
  let hint = G.check === c ? '<b class="check-txt">Check!</b> You must get your king out of check.' : 'Click or drag a piece to move. Checkmate the king to win.';
  if (G.bonusNow === c) hint = `${I.prophecy} <b>Bonus move!</b> Your prophecy came true. Make your second move.`;
  else if (G.bonusPending === c) hint = `${I.prophecy} <b>Your prophecy came true!</b> You get two moves this turn, unless your first move gives check.${G.check === c ? ' <b class="check-txt">You are in check.</b>' : ''}`;
  if (G.twists.gambler && G.lastSpin && !G.lastSpin.won && G.lastSpin.color === c && G.check === c) {
    hint = `${I.wheel} <b class="check-txt">You lost the spin and your king is exposed.</b> Move again to get out of check.`;
  }
  let actions = '';
  if ((ui.tool === 'power' || ui.tool === 'freepush') && ui.power) {
    const id = ui.tool === 'freepush' ? 'freepush' : G.powers[c][ui.power.slot].id;
    const steps = POWER_HINT[id], step = steps[Math.min(ui.power.picks.length, steps.length - 1)];
    hint = id === 'freepush' ? `${I.pw_tug} <b>Free push.</b> ${step}` : `${I['pw_' + id]} <b>${E.POWERS[id].name}:</b> ${E.POWERS[id].desc}<br>${step}`;
    actions = '<button class="btn" data-act="cancel">Cancel</button>';
  } else if (ui.tool === 'buy') {
    hint = `${I.shop} Click a highlighted square to place your ${PIECE_NAME[ui.buyType]}.`;
    actions = '<button class="btn" data-act="cancel">Cancel</button>';
  } else if (ui.tool === 'prophecy') {
    hint = `${I.prophecy} Make your move as normal. Then you'll predict your opponent's reply.`;
    actions = '<button class="btn" data-act="cancel">Cancel</button>';
  } else if (ui.tool === 'traitor') {
    hint = 'Your traitor is the highlighted enemy piece. Make one move with it.';
    actions = '<button class="btn" data-act="cancel">Cancel</button>';
  } else if (ui.tool === 'swap') {
    hint = ui.swapFirst == null ? 'Click the first of your pieces to swap (not the king).' : 'Now click the second piece.';
    actions = '<button class="btn" data-act="cancel">Cancel</button>';
  } else {
    const btns = [];
    if (traitorReady(c)) btns.push(`<button class="btn" data-act="traitor">${I.traitor} Use Traitor</button>`);
    if (E.canSwap(G, c)) btns.push(`<button class="btn" data-act="swap">${I.swap} Secret Swap</button>`);
    if (E.prophecyReady(G, c) && G.bonusPending !== c && G.bonusNow !== c) btns.push(`<button class="btn" data-act="prophecy">${I.prophecy} Use Prophecy</button>`);
    if (btns.length) actions = `<div class="btn-row">${btns.join('')}</div>`;
  }
  return `<div class="card"><h3><span class="dotlive"></span>${ui.online || ui.bot ? 'Your move' : `${nm(c)} to move`}</h3><p>${hint}</p>${actions}
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
  return `<div class="card"><h3>${r.winner ? `${I.trophy} ${nm(r.winner)} won` : '½ Draw'}</h3><p>${resultText()}</p>
    <div class="btn-row"><button class="btn primary" data-act="rematch">Rematch</button><button class="btn" data-act="new">New Game</button></div>
    ${ui.flash ? `<div class="flash">${ui.flash}</div>` : ''}
    ${reveal}</div>`;
}

function connectionCard() {
  if (!ui.online || !ui.net || ui.net.status === 'connected') return '';
  return `<div class="card alert"><h3>${I.warn} Connection lost</h3><p>${nm(other(ui.viewer))} disconnected. You can start a new game.</p>
    <button class="btn" data-act="new">New Game</button></div>`;
}

function moveText(e) {
  return iconize(esc(e.text).replace(/^(\[traitor\] )?([KQRBN])/, (_, tr, l) => `${tr || ''}${pieceSVG(l, 'w').replace('class="piece-svg"', 'class="piece-svg fig"')}`));
}
/** The engine writes [traitor], [boom] etc. in the move history; show them as icons. */
const iconize = (text) => text.replace(/\[(traitor|boom|swap|prophecy|wheel|coin|snake|tug|asteroids|rewind|banana|portals|quake|piston|magnet|tornado|bowling|blower|wall)\]/g, (_, k) => I[k] || I['pw_' + k]);

function movesHTML() {
  const h = G.history;
  if (!h.length) return '<div class="moves"><div class="moves-title">Moves</div><div class="empty">No moves yet.</div></div>';
  const cell = (e, idx) => (e
    ? `<span class="m ${idx === h.length - 1 ? 'last' : ''} ${e.caught ? 'caught' : ''}"><span class="t">${moveText(e)}</span>${e.note ? `<span class="note">${iconize(esc(e.note))}</span>` : ''}</span>`
    : '<span></span>');
  const pairs = [];
  h.forEach((e, i) => {
    let row = pairs[pairs.length - 1];
    if (!row || e.color === W || row.b) { row = { w: null, b: null }; pairs.push(row); }
    row[e.color] = i;
  });
  const rows = pairs.map((r, n) => `<div class="move-row"><span class="n">${n + 1}.</span>${r.w == null ? '<span class="m">…</span>' : cell(h[r.w], r.w)}${r.b == null ? '<span></span>' : cell(h[r.b], r.b)}</div>`).join('');
  return `<div class="moves"><div class="moves-title">Moves</div>${rows}</div>`;
}

function renderPanel() {
  const mode = modeInfo(ui.gameMode);
  let chips = `<span class="chip">${mode.icon} ${mode.name}</span>`;
  if (ui.online && ui.net) {
    const ok = ui.net.status === 'connected';
    chips += `<span class="chip ${ok ? 'live' : 'down'}">${ok ? '● Online' : '● Disconnected'} · ${ui.net.quick ? 'random opponent' : 'code ' + esc(ui.net.code)}</span>`;
  } else if (ui.bot && ui.phase !== 'menu') {
    chips += `<span class="chip">${BOTS[ui.bot.id].icon} vs ${esc(ui.names[ui.bot.color])}</span>`;
  } else if (ui.phase !== 'menu') {
    chips += '<span class="chip">Pass &amp; play</span>';
  }
  let body = '';
  if (ui.phase === 'menu') {
    body = `<div class="card"><h3>Chess, with secrets</h3><p>Pick a game mode, then play a friend on this device or online.</p>
      <button class="btn primary big" data-act="new">Play</button></div>`;
  } else if (ui.phase === 'secret') {
    const items = secretItems(ui.viewer);
    body = connectionCard() + setupCard() + (items ? `<div class="card"><h3>${I.lock} Your secrets</h3><ul class="secret-list">${items}</ul></div>` : '');
  } else if (ui.phase === 'play') {
    const showSecrets = ui.online || ui.bot || G.turn === ui.viewer;
    const items = showSecrets ? secretItems(ui.viewer) : '';
    body = connectionCard() + drawOfferCard() + playCard() + powersCard() + shopCard() + (items ? `<div class="card"><h3>${I.lock} Your secrets</h3><ul class="secret-list">${items}</ul></div>` : '');
  } else {
    body = connectionCard() + overCard();
  }
  if (ui.phase !== 'menu') body += movesHTML();
  const playing = ui.phase === 'play' && !G.result && (ui.online ? ui.net && ui.net.status === 'connected' : G.turn === ui.viewer);
  panel.innerHTML = `
    <div class="tabs">
      <button class="tab active" data-act="noop"><span class="ti">${pieceSVG('P', 'w')}</span>Play</button>
      <button class="tab" data-act="new"><span class="ti">${I.plus}</span>New Game</button>
      <button class="tab" data-act="rules"><span class="ti">${I.book}</span>Rules</button>
    </div>
    <div class="twist-row">${ui.phase === 'menu' ? '<span class="chip">Choose a mode in New Game</span>' : chips}</div>
    <div class="panel-body" id="panel-body">${body}</div>
    <div class="panel-foot">
      <button class="icon-btn" data-act="resign" ${playing ? '' : 'disabled'} title="Resign"><span class="ib">${I.flag}</span>Resign</button>
      <button class="icon-btn" data-act="draw" ${playing ? '' : 'disabled'} title="Offer a draw"><span class="ib">½</span>Draw</button>
      <button class="icon-btn" data-act="flip" title="Flip board"><span class="ib">${I.flip}</span>Flip</button>
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

const setupSteps = () => ['hiddenQueen', 'traitor', 'objective', 'mines', 'shifter'].filter((k) => G.twists[k]);

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
    if (ui.bot) { startClock(G.turn); render(); return botTurn(); }
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
  cancelSpin();
  ui.bot = null;
  ui.gameMode = mode;
  store.set('mode', mode);
  G = E.newGame({ [mode]: true });
  ui.names = { ...ui.localNames };
  ui.clock = { w: 0, b: 0, running: null, since: 0 };
  Object.assign(ui, { selected: null, moves: [], tool: null, swapFirst: null, fresh: null, flash: '', flipped: false, showResult: false, drawOffered: false, premoves: [], preSel: false });
  const steps = setupSteps();
  ui.setupQueue = steps.length ? [W, B].map((c) => ({ color: c, steps: [...steps], started: false })) : [];
  closeModal();
  runSetup();
}

// ---------------------------------------------------------------- bot games
function startBotGame(mode, id = 'v1') {
  netTeardown();
  cancelSpin();
  ui.gameMode = mode;
  store.set('mode', mode);
  G = E.newGame({ [mode]: true });
  if (!BOTS[id]) id = 'v1';
  ui.bot = { color: B, id };
  ui.viewer = W;
  ui.names = { w: ui.myName || ui.localNames.w || 'You', b: BOTS[id].name };
  ui.clock = { w: 0, b: 0, running: null, since: 0 };
  Object.assign(ui, { selected: null, moves: [], tool: null, swapFirst: null, fresh: null, flash: '', flipped: false, showResult: false, drawOffered: false, premoves: [], preSel: false });
  BOTS[id].engine.setup(G, ui.bot.color);
  const steps = setupSteps();
  ui.setupQueue = steps.length ? [{ color: W, steps: [...steps], started: true }] : [];
  closeModal();
  overlay.classList.add('hidden');
  runSetup();
}

let botTimer = null;
// Jules searches in a background worker so you can premove while it thinks.
let julesWorker = null, julesBroken = false, julesAsk = 0;
function julesThink(game, ms) {
  return new Promise((resolve) => {
    const onMain = () => { let a = null; try { a = Jules.chooseAction(game, { ms }); } catch { /* fall through */ } resolve(a); };
    if (julesBroken) return setTimeout(onMain, 30);
    try { julesWorker = julesWorker || new Worker('js/jules-worker.js'); } catch { julesBroken = true; return setTimeout(onMain, 30); }
    const id = ++julesAsk, w = julesWorker;
    let done = false;
    const finish = (fn) => { if (done) return; done = true; clearTimeout(guard); w.removeEventListener('message', onMsg); w.removeEventListener('error', onErr); fn(); };
    const onMsg = (e) => { if (e.data.id === id) finish(() => resolve(e.data.action)); };
    const onErr = () => finish(() => { julesBroken = true; julesWorker = null; onMain(); }); // e.g. opened straight from a file
    const guard = setTimeout(onErr, ms + 4000);
    w.addEventListener('message', onMsg);
    w.addEventListener('error', onErr);
    w.postMessage({ id, game: structuredClone(game), ms });
  });
}

function botPlay(game, action) {
  if (G !== game || !ui.bot || ui.phase !== 'play' || G.result || G.turn !== ui.bot.color) return;
  action = action || Bot.chooseAction(G);
  if (!action) return;
  if (action.type === 'power') {
    try { E.usePower(G, action.slot, action.args); } catch { return; }
    return afterPower();
  }
  const move = action.type === 'move' && G.twists.gambler ? { ...action.move, roll: Math.random() } : action.move;
  const go = () => {
    const before = capturesNow();
    try {
      if (action.type === 'swap') { E.doSwap(G, action.a, action.b); sound('reveal'); ui.anim = null; }
      else if (action.type === 'buy') { E.buyPiece(G, action.piece, action.sq); sound('reveal'); ui.anim = null; }
      else {
        E.makeMove(G, move);
        sound(G.lastExplosion != null ? 'boom' : G.check ? 'check' : capturesNow() > before ? 'capture' : 'move');
        ui.anim = slidesFor(move);
      }
    } catch { return; }
    ui.fresh = action.type === 'buy' ? action.sq : null;
    afterAction();
  };
  const spin = action.type === 'move' && G.twists.gambler ? E.previewSpin(G, move) : null;
  return spin && spin.odds < 1 ? showSpin(spin, go) : go();
}

function botTurn() {
  clearTimeout(botTimer);
  if (!ui.bot || ui.phase !== 'play' || G.result || G.turn !== ui.bot.color) return;
  const game = G;
  if (G.twists.powers && E.freePushOptions(G, ui.bot.color).length) { // the Tug of War prize comes first
    const opts = E.freePushOptions(G, ui.bot.color);
    const o = ui.bot.id === 'jules' ? Jules.pickPush(G) : opts[Math.floor(Math.random() * opts.length)].args;
    try { E.freePush(G, o.from, o.to); ui.anim = [{ from: o.from, to: o.to }]; sound('move'); render(); } catch { /* skip the push */ }
  }
  if (ui.bot.id === 'jules') {
    botTimer = setTimeout(() => {
      if (G !== game || !ui.bot || G.turn !== ui.bot.color) return;
      const thinkMs = Math.max(300, Math.min(2500, timeLeft(ui.bot.color) / 25));
      julesThink(G, thinkMs).then((action) => botPlay(game, action));
    }, 80);
  } else {
    botTimer = setTimeout(() => botPlay(game, Bot.chooseAction(game)), 450 + Math.random() * 800);
  }
}

function rematch() {
  if (ui.bot) return startBotGame(ui.gameMode, ui.bot.id);
  if (!ui.online) return startLocalGame(ui.gameMode);
  if (!ui.net || ui.net.status !== 'connected') { ui.flash = 'Your opponent is no longer connected.'; return render(); }
  if (ui.net.role === 'host') return startOnlineGame(ui.gameMode);
  sendAct({ kind: 'rematch' });
  ui.flash = 'Rematch requested…';
  render();
}

function afterAction() {
  // A piece picked up during the opponent's turn stays picked up when your turn starts.
  const held = ui.preSel && !ui.premoves.length && G.turn === ui.viewer && !G.result ? ui.selected : null;
  ui.selected = null; ui.moves = []; ui.tool = null; ui.swapFirst = null; ui.preSel = false;
  if (G.result) return gameOver();
  if (held != null && G.board[held] && G.board[held].owner === ui.viewer) { ui.selected = held; ui.moves = E.legalMoves(G, held); }
  if (ui.bot) { startClock(G.turn); render(); runPremove(); return botTurn(); }
  if (ui.online || G.turn === ui.viewer) { startClock(G.turn); render(); return runPremove(); } // online, or a bonus move
  stopClock();
  render();
  setTimeout(() => handoff(G.turn), ui.privacy ? 650 : 250);
}

function gameOver() {
  stopClock();
  ui.phase = 'over';
  ui.showResult = true;
  ui.drawOffered = false;
  cancelMini();
  clearTimeout(preTimer);
  ui.premoves = []; ui.preSel = false;
  ui.selected = null; ui.moves = []; ui.tool = null;
  overlay.classList.add('hidden');
  sound('end');
  render();
}

function capturesNow() { return G.captured.w.length + G.captured.b.length; }

function doMove(m, dropped = false) {
  if (m.promo === true) { ui.promo = m; return render(); } // ask which piece first (the drop is undone, so animate after)
  ui.promo = null;
  if (ui.tool === 'prophecy' && !m.prophecy) {
    // Show the board after this move and let the player predict the reply before anything is sent.
    const preview = structuredClone(G);
    try { E.makeMove(preview, m); } catch (e) { ui.flash = e.message; return render(); }
    if (!preview.result && preview.turn !== G.turn) {
      ui.predict = { realG: G, move: m, guess: null };
      G = preview;
      ui.selected = null; ui.moves = []; ui.fresh = null;
      ui.anim = dropped ? null : slidesFor(m);
      return render();
    }
    ui.tool = null;
  }
  if (G.twists.gambler && m.roll == null) m = { ...m, roll: Math.random() };
  tick();
  const act = { kind: 'move', t: Math.round(ui.clock[ui.viewer]), move: { from: m.from, to: m.to, traitor: !!m.traitor, promo: typeof m.promo === 'string' ? m.promo : undefined, prophecy: m.prophecy || undefined, roll: m.roll } };
  const spin = G.twists.gambler ? E.previewSpin(G, m) : null;
  if (spin && spin.odds < 1) { // both players watch the same wheel before the result is applied
    sendAct(act);
    return showSpin(spin, () => commitMove(m, false, null));
  }
  commitMove(m, dropped, act);
}

function commitMove(m, dropped, act) {
  const before = capturesNow();
  const revealedBefore = G.board.filter((p) => p && p.shown === p.type).length;
  try { E.makeMove(G, m); } catch (e) { ui.flash = e.message; return render(); }
  if (act) sendAct(act);
  const revealed = G.board.filter((p) => p && p.shown === p.type).length > revealedBefore;
  sound(G.lastExplosion != null ? 'boom' : G.check ? 'check' : revealed ? 'reveal' : capturesNow() > before ? 'capture' : 'move');
  ui.fresh = dropped ? m.to : null;
  ui.anim = dropped ? null : slidesFor(m);
  ui.flash = '';
  afterAction();
}

// ---------------------------------------------------------------- Gambler's Gambit: wheel and shop
const SPIN_MS = 1500, SPIN_HOLD = 600;
let spinTimer = null;
const spinPct = (p) => `${Number((p * 100).toFixed(1))}%`;

function cancelSpin() {
  cancelMini();
  clearTimeout(spinTimer);
  ui.spinning = false;
  ui.netQueue = [];
  const el = $('spin');
  el.classList.add('hidden');
  el.innerHTML = '';
}

/** Spin the wheel, then run `done`. The roll was decided already, so both players see the same landing spot. */
function showSpin(spin, done) {
  const game = G, el = $('spin');
  const atk = spin.color, def = other(atk), deg = spin.odds * 360;
  const fill = { w: '#ebecd0', b: '#4b4847' };
  const label = (type, color, mid) => {
    const rad = (mid - 90) * Math.PI / 180;
    return `<span class="wheel-pc" style="left:${50 + 31 * Math.cos(rad)}%;top:${50 + 31 * Math.sin(rad)}%">${pieceSVG(type, color)}</span>`;
  };
  stopClock();
  ui.spinning = true;
  ui.selected = null; ui.moves = []; ui.tool = null;
  render();
  el.innerHTML = `<div class="spin-card" role="status">
    <div class="spin-title">${PIECE_NAME[spin.attacker]} attacks ${PIECE_NAME[spin.defender]}</div>
    <div class="wheel-wrap"><span class="wheel-pointer"></span>
      <div class="wheel" style="background:conic-gradient(${fill[atk]} 0 ${deg}deg, ${fill[def]} ${deg}deg 360deg)">
        ${label(spin.attacker, atk, deg / 2)}${label(spin.defender, def, deg + (360 - deg) / 2)}
      </div><span class="wheel-hub"></span></div>
    <div class="spin-odds"><span>${pieceSVG(spin.attacker, atk)}<b>${spinPct(spin.odds)}</b></span><i>vs</i><span><b>${spinPct(1 - spin.odds)}</b>${pieceSVG(spin.defender, def)}</span></div>
    <div class="spin-result">Spinning…</div></div>`;
  el.classList.remove('hidden');
  sound('spin');
  const wheel = el.querySelector('.wheel');
  const end = 360 * 5 - spin.roll * 360;
  const quick = reduceMotion();
  if (wheel.animate) wheel.animate([{ transform: 'rotate(0deg)' }, { transform: `rotate(${end}deg)` }], { duration: quick ? 1 : SPIN_MS, easing: 'cubic-bezier(.12,.72,.16,1)', fill: 'forwards' });
  else wheel.style.transform = `rotate(${end}deg)`;
  spinTimer = setTimeout(() => {
    if (G !== game) return;
    const winner = spin.won ? spin.attacker : spin.defender, winColor = spin.won ? atk : def;
    const res = el.querySelector('.spin-result');
    res.textContent = `${COLOR[winColor]}'s ${PIECE_NAME[winner]} wins!`;
    res.classList.add('done');
    spinTimer = setTimeout(() => {
      if (G !== game) return;
      ui.spinning = false;
      el.classList.add('hidden');
      el.innerHTML = '';
      if (!G.result) done();
      const queued = ui.netQueue.splice(0);
      queued.forEach(applyRemote);
    }, SPIN_HOLD);
  }, quick ? 150 : SPIN_MS);
}

function doBuy(type, at) {
  tick();
  try { E.buyPiece(G, type, at); } catch (e) { ui.flash = e.message; return render(); }
  sendAct({ kind: 'buy', piece: type, sq: at, t: Math.round(ui.clock[ui.viewer]) });
  sound('reveal');
  ui.fresh = at;
  ui.flash = '';
  afterAction();
}

function canAct() {
  return !ui.spinning && !ui.mg && ui.phase === 'play' && !G.result && G.turn === ui.viewer && !ui.premoves.length && overlay.classList.contains('hidden');
}

// ---------------------------------------------------------------- premoves (online and bot games)
let preTimer = null;
const canPremove = () => !ui.spinning && !ui.mg && (ui.online || !!ui.bot) && ui.phase === 'play' && !G.result && G.turn !== ui.viewer
  && !ui.predict && overlay.classList.contains('hidden');

/** The board as it will look once the queued premoves are played. */
function preBoard() {
  const b = G.board.slice();
  for (const q of ui.premoves) {
    const p = b[q.from];
    if (!p) break;
    const moved = { ...p, moved: true };
    if (moved.type === 'P' && E.rankOf(q.to) === (moved.owner === W ? 7 : 0)) { moved.type = 'Q'; moved.shown = 'Q'; } // auto-queen
    b[q.from] = null;
    b[q.to] = moved;
    if (q.castle) { b[q.castle[1]] = { ...b[q.castle[0]], moved: true }; b[q.castle[0]] = null; }
  }
  return b;
}
function preTargets(i) {
  const b = preBoard(), p = b[i];
  const out = E.premoveTargets(p.type, i, p.owner).map((to) => ({ from: i, to }));
  const home = p.owner === W ? 0 : 7;
  if (p.type === 'K' && !p.moved && i === E.sq(4, home)) {
    for (const [kf, rf, rt] of [[6, 7, 5], [2, 0, 3]]) {
      const rook = b[E.sq(rf, home)];
      if (rook && rook.owner === p.owner && rook.type === 'R' && !rook.moved) {
        out.push({ from: i, to: E.sq(kf, home), castle: [E.sq(rf, home), E.sq(rt, home)] });
      }
    }
  }
  return out;
}
function queuePremove(t) {
  const p = preBoard()[t.from];
  if (!p) return;
  ui.premoves.push({ from: t.from, to: t.to, id: p.id, castle: t.castle });
  ui.selected = null; ui.moves = []; ui.preSel = false;
  sound('move');
  render();
}
function clearPremoves(flash) {
  clearTimeout(preTimer);
  ui.premoves = [];
  ui.selected = null; ui.moves = []; ui.preSel = false;
  if (flash) ui.flash = flash;
  render();
}
/** On your turn, play the next queued premove if it's legal now; otherwise drop the whole queue, like chess.com. */
function runPremove() {
  clearTimeout(preTimer);
  if (!ui.premoves.length || G.turn !== ui.viewer || ui.phase !== 'play') return;
  const game = G;
  preTimer = setTimeout(() => {
    if (G !== game || !ui.premoves.length || G.turn !== ui.viewer || ui.phase !== 'play') return;
    const q = ui.premoves[0], p = G.board[q.from];
    const legal = p && p.id === q.id ? E.legalMoves(G, q.from).find((m) => m.to === q.to) : null;
    if (!legal) return clearPremoves('Premove wasn\'t legal, so it was cancelled.');
    ui.premoves.shift();
    doMove({ ...legal, promo: legal.promo ? 'Q' : undefined }, true); // already drawn in place
  }, 110);
}
function onPremoveDown(i, e) {
  const b = preBoard(), p = b[i];
  const mine = p && p.owner === ui.viewer;
  const t = ui.selected != null && ui.selected !== i ? ui.moves.find((x) => x.to === i) : null;
  if (t && !mine) return queuePremove(t);
  if (!mine) return clearPremoves(); // clicking elsewhere cancels, like chess.com
  ui.selected = i; ui.preSel = true;
  ui.moves = preTargets(i);
  ui.fresh = null;
  render();
  const src = boardEl.querySelector(`[data-sq="${i}"] .pc`);
  if (src) drag = { from: i, x: e.clientX, y: e.clientY, moved: false, src, pre: true, targets: ui.moves.slice() };
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
  tick();
  sendAct({ kind: 'swap', a, b: i, t: Math.round(ui.clock[ui.viewer]) });
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

boardEl.addEventListener('contextmenu', (e) => { if (ui.phase === 'play') e.preventDefault(); });
boardEl.addEventListener('pointerdown', (e) => {
  const el = e.target.closest('.sq');
  if (!el) return;
  e.preventDefault();
  if (e.button > 0) { // right-click cancels premoves
    if (e.button === 2 && (ui.premoves.length || ui.preSel)) clearPremoves();
    return;
  }
  const i = +el.dataset.sq;
  if (ui.promo) { ui.promo = null; return render(); }
  if (ui.predict) {
    const t = ui.moves.find((x) => x.to === i);
    if (t) { ui.predict.guess = { from: t.from, to: t.to }; ui.selected = null; ui.moves = []; return render(); }
    const p = G.board[i];
    if (p && p.owner === G.turn) { ui.selected = i; ui.moves = E.legalMoves(G, i); } else { ui.selected = null; ui.moves = []; }
    return render();
  }
  if (ui.phase === 'secret') {
    const step = currentStep();
    if (step === 'hiddenQueen') E.setHiddenQueen(G, ui.viewer, i);
    if (step === 'traitor') E.setTraitor(G, ui.viewer, i);
    if (step === 'mines') E.toggleMine(G, ui.viewer, i);
    if (step === 'shifter') E.setShifter(G, ui.viewer, i);
    return render();
  }
  if (canPremove()) return onPremoveDown(i, e);
  if (!canAct()) return;
  if (ui.tool === 'swap') return onSwapClick(i);
  if (ui.tool === 'power' || ui.tool === 'freepush') return powerClick(i);
  if (ui.tool === 'buy') {
    if (E.legalDrops(G, ui.viewer, ui.buyType).includes(i)) doBuy(ui.buyType, i);
    return;
  }
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
  if (d.pre) {
    const t = el && d.targets.find((x) => x.to === +el.dataset.sq);
    if (!t) { ui.selected = null; ui.moves = []; ui.preSel = false; return render(); }
    if (canAct()) { // the opponent moved mid-drag: this is a normal move now
      const legal = E.legalMoves(G, t.from).find((x) => x.to === t.to);
      if (legal) return doMove(legal, legal.promo !== true);
      return render();
    }
    return queuePremove(t);
  }
  const m = el && ui.moves.find((x) => x.to === +el.dataset.sq);
  if (m) doMove(m, m.promo !== true); // dragged pieces are already in place: no slide
  else render();
});

// ---------------------------------------------------------------- panel actions
panel.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (!btn || btn.disabled) return;
  const act = btn.dataset.act;
  const c = ui.viewer;
  if ((ui.spinning || ui.mg) && !['new', 'rules', 'flip'].includes(act)) return;
  switch (act) {
    case 'power': {
      if (!canAct()) return;
      const k = +btn.dataset.slot, opts = E.powerOptions(G, c, k);
      if (!opts.length) return;
      if (!opts[0].clicks.length) return doPower(k, opts[0].args); // minigames and Time Rewind start at once
      ui.tool = 'power'; ui.power = { slot: k, picks: [], opts }; ui.selected = null; ui.moves = [];
      return render();
    }
    case 'freepush':
      if (!canAct()) return;
      ui.tool = 'freepush'; ui.power = { slot: null, picks: [], opts: E.freePushOptions(G, c) }; ui.selected = null; ui.moves = [];
      return render();
    case 'buy':
      if (!canAct()) return;
      ui.tool = 'buy'; ui.buyType = btn.dataset.piece; ui.selected = null; ui.moves = [];
      return render();
    case 'new': return openNewGame();
    case 'rules': return openRules();
    case 'flip': ui.flipped = !ui.flipped; return render();
    case 'rematch': return rematch();
    case 'confirm': {
      const step = currentStep();
      if (step === 'hiddenQueen') sendAct({ kind: 'setHQ', color: c, sq: E.findById(G, G.hiddenQueen[c]).sq });
      if (step === 'traitor') sendAct({ kind: 'setTraitor', color: c, sq: E.findById(G, G.traitor[c].id).sq });
      if (step === 'mines') sendAct({ kind: 'setMines', color: c, squares: [...G.mines[c]] });
      if (step === 'shifter') sendAct({ kind: 'setShifter', color: c, sq: E.findById(G, G.shifter[c]).sq });
      ui.setupQueue[0].steps.shift();
      if (ui.online) {
        if (!ui.setupQueue[0].steps.length) return markReady();
        return render();
      }
      return runSetup(); // also finishes a bot game's setup
    }
    case 'premove-clear': return clearPremoves();
    case 'cancel': ui.tool = null; ui.swapFirst = null; ui.selected = null; ui.moves = []; return render();
    case 'prophecy': ui.tool = 'prophecy'; ui.selected = null; ui.moves = []; return render();
    case 'predict-ok': {
      const { realG, move, guess } = ui.predict;
      G = realG; ui.predict = null; ui.tool = null;
      return doMove({ ...move, prophecy: guess }, true); // the preview already showed this move
    }
    case 'predict-cancel':
      G = ui.predict.realG; ui.predict = null; ui.tool = null; ui.fresh = null; ui.selected = null; ui.moves = [];
      return render();
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
      if (ui.bot) {
        ui.flash = 'Draw offered…';
        render();
        setTimeout(() => {
          if (!ui.bot || G.result) return;
          if (BOTS[ui.bot.id].engine.acceptsDraw(G)) { E.agreeDraw(G); return gameOver(); }
          ui.flash = `${ui.names[ui.bot.color]} declined the draw.`;
          render();
        }, 700 + Math.random() * 600);
        return;
      }
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
          <button class="btn primary big" id="play-online">${I.globe} Play Online</button>
          <button class="btn big secondary" id="play-bot">${I.robot} Play Bot</button>
          <button class="btn big secondary" id="play-local">${I.people} Pass &amp; Play</button>
        </div>
        <div class="bot-pick hidden" id="bot-pick">
          <div class="section-label">Choose your opponent</div>
          ${Object.entries(BOTS).map(([id, b]) => `
            <button class="bot-card" data-bot="${id}">
              <span class="bot-av">${b.icon}</span>
              <span><span class="bot-name">${esc(b.name)}</span><span class="bot-tag">${esc(b.tag)}</span></span>
              <span class="bot-go">Play</span>
            </button>`).join('')}
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
    $('play-bot').addEventListener('click', () => { $('bot-pick').classList.toggle('hidden'); $('bot-pick').scrollIntoView({ block: 'nearest' }); });
    modal.querySelectorAll('[data-bot]').forEach((b) => b.addEventListener('click', () => { saveForm(); startBotGame(mode, b.dataset.bot); }));
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
      <div class="card quick-card"><div><h3>${I.bolt} Play a random opponent</h3><p>Get matched with anyone else looking for a <b>${mode.icon} ${mode.name}</b> game.</p></div>
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
    <div class="modal-head"><h2>${I.globe} Play Online</h2><button class="btn ghost small" data-close>✕</button></div>
    <div class="modal-body">${body}</div></div>`;
  const saveName = () => {
    const el = $('my-name');
    if (el) { ui.myName = el.value.trim().slice(0, 16); store.set('myName', ui.myName); }
  };
  modal.querySelectorAll('[data-lobby]').forEach((b) => b.addEventListener('click', () => {
    const a = b.dataset.lobby;
    if (a === 'create') { saveName(); netHost(ui.gameMode); renderLobby(); }
    if (a === 'quick') { saveName(); quickSearch(ui.gameMode); renderLobby(); }
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
    <div class="modal-head"><h2>${I.book} Rules</h2><button class="btn ghost small" data-close>✕</button></div>
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
        <li><b>Landmine:</b> mines can go on any square in the opponent's half. A mine is used up when it goes off. If blowing up a piece would leave its own king in check, the mine fizzles instead and the piece survives.</li>
        <li><b>Prophecy:</b> press <b>Use Prophecy</b>, make your move, then pick the reply you expect. If it comes true, your next turn is a double move, but the bonus is lost if your first move gives check. After using it, it recharges for 5 of your turns.</li>
        <li><b>Shapeshifter:</b> it keeps its look after changing. It's revealed when it makes a move its look couldn't, or when it gives check.</li>
        <li><b>Gambler's Gambit:</b> your chance to win a capture is your piece's value divided by both pieces' values (pawn 1, knight 3, bishop 3, rook 5, queen 9). If you win, you capture normally. If you lose, your attacker is removed and the defender stays. Only a king always wins. If losing a spin leaves your king in check, you move again right away, and if you can't escape it's checkmate.</li>
        <li><b>"Regular chess":</b> you always hold 3 powers (hover one to read it). Using a power takes your turn, except Time Rewind, which undoes your last move and your opponent's reply so you can move again. A used power recharges for 3 of your turns, then comes back as a new random power. No power can leave your own king in check, and kings are never pushed, pulled, spun, slipped or warped.</li>
        <li><b>Minigames:</b> Snake, Asteroid Dodge and Tug of War pop up for both players at once, and the clocks pause. Snake's prize is a Snake piece that moves like a king, a queen and a knight combined. Asteroid Dodge's prize is two moves in a row next turn. Tug of War's prize is a free push: on your turn, push one enemy piece one square before you move. In pass &amp; play, White uses W A S D (or A to tap) and Black uses the arrow keys (or L to tap).</li>
        <li><b>Coins and shop:</b> earn 1 coin per move, plus the defeated piece's value when you win a spin, and 2 coins when your attacker loses one. Pawn 3, knight 8, bishop 8, rook 12, queen 20. Buying uses your turn. Bought pieces go on an empty square in your half (pawns not on your back rank), can block a check, and can't give check when placed.</li>
        <li><b>Secret Swap:</b> takes your turn and can't be used while you're in check. The move list shows that a swap happened, but not which pieces. A swapped piece is revealed when it makes a move its disguise couldn't.</li>
        <li><b>Clock:</b> each player has 10 minutes for the whole game, counting down on their turn. Run out and you lose, unless your opponent only has a king (or a king and one bishop or knight), which is a draw.</li>
        <li><b>Premoves:</b> in online and bot games, move during your opponent's turn to queue one or more moves, shown in red. Each plays instantly on your turn if it's legal; if one isn't, the whole queue is cancelled. Pawns auto-promote to a queen. Right-click, or click an empty square, to cancel.</li>
        <li><b>Pass &amp; play:</b> a privacy screen hides the board between turns so the next player can take the device.</li>
        <li><b>Online:</b> create a game and send the invite link (or 5-letter code), or press <b>Find Opponent</b> to be matched with a random player in the same mode.</li>
      </ul>
    </div></div>`;
  modal.classList.remove('hidden');
}

// ---------------------------------------------------------------- sidebar
$('logo-mark').innerHTML = pieceSVG('N', 'w').replace(/#ffffff/g, '#81b64c').replace(/#302e2c/g, '#1e2a14');
$('nav-ic-play').innerHTML = pieceSVG('P', 'w');
$('nav-ic-new').innerHTML = I.plus;
$('nav-ic-online').innerHTML = I.globe;
$('nav-ic-rules').innerHTML = I.book;
document.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => {
  const n = b.dataset.nav;
  if (n === 'new') openNewGame();
  if (n === 'online') openLobby();
  if (n === 'rules') openRules();
}));
function renderSound() {
  $('sound-ic').innerHTML = ui.sound ? I.soundOn : I.soundOff;
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
