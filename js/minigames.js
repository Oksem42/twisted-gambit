(function () {
// Power Chess minigames: Snake, Asteroid Dodge and Tug of War.
// Every player gets the same seeded level. Snake: the last snake standing wins, or if both last the whole
// 30 seconds, the most apples. Asteroid Dodge scores how long you last. (Snake used to break ties
// by length); Tug of War scores taps in 5 seconds. Pass & play splits the screen with separate keys.
const KINDS = {
  snake: { title: 'Snake', help: 'Crash into a wall or yourself and you lose: the last snake standing wins. If both last the full 30 seconds, the most apples wins.', tickMs: 120, cap: 250 },
  asteroids: { title: 'Asteroid Dodge', help: 'Steer left and right to dodge the falling rocks. Whoever survives longest wins.', tickMs: 50, cap: 600 },
  tug: { title: 'Tug of War', help: 'Tap as fast as you can! Most taps in 5 seconds wins.', tickMs: 50, cap: 100 },
};
// [left, right, up, down] per player when two people share the keyboard; one player can use either set.
const KEYS = {
  w: { left: ['a', 'A'], right: ['d', 'D'], up: ['w', 'W'], down: ['s', 'S'], tap: ['a', 'A'] },
  b: { left: ['ArrowLeft'], right: ['ArrowRight'], up: ['ArrowUp'], down: ['ArrowDown'], tap: ['l', 'L'] },
};
const SOLO_TAP = [' ', 'Enter', 'a', 'A', 'l', 'L'];
const BOT_RANGE = { // [min, max] of a bot's result
  snake: { v1: [45, 230], jules: [160, 250] },
  asteroids: { v1: [140, 520], jules: [360, 600] },
  tug: { v1: [20, 36], jules: [33, 47] },
};

function rng(seed) {
  let s = seed | 0;
  return () => {
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- games (pure simulations)
const SN = 16;
function newSnake(seed) {
  const g = { r: rng(seed), body: [[5, 8], [4, 8], [3, 8]], dir: [1, 0], next: [1, 0], apple: null, ticks: 0, alive: true };
  placeApple(g);
  return g;
}
function placeApple(g) {
  for (let k = 0; k < 400; k++) {
    const a = [Math.floor(g.r() * SN), Math.floor(g.r() * SN)];
    if (!g.body.some(([x, y]) => x === a[0] && y === a[1])) { g.apple = a; return; }
  }
}
function stepSnake(g) {
  g.dir = g.next;
  const [hx, hy] = g.body[0], h = [hx + g.dir[0], hy + g.dir[1]];
  const eats = g.apple && h[0] === g.apple[0] && h[1] === g.apple[1];
  const body = eats ? g.body : g.body.slice(0, -1);
  if (h[0] < 0 || h[1] < 0 || h[0] >= SN || h[1] >= SN || body.some(([x, y]) => x === h[0] && y === h[1])) { g.alive = false; return; }
  g.body = [h, ...body];
  if (eats) placeApple(g);
  g.ticks++;
}
function steerSnake(g, d) {
  const v = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] }[d];
  if (v && !(v[0] === -g.dir[0] && v[1] === -g.dir[1])) g.next = v;
}
// Crashed: the tick you crashed on (later is better). Lasted the whole time: SURVIVED + apples, which beats any crash.
const SURVIVED = 100000;
const apples = (g) => g.body.length - 3;
const snakeScore = (g) => (g.alive && g.ticks >= KINDS.snake.cap ? SURVIVED + apples(g) : g.ticks);

const AW = 300, AH = 300;
function newRocks(seed) { return { r: rng(seed), x: AW / 2, rocks: [], ticks: 0, alive: true, left: false, right: false }; }
function stepRocks(g) {
  const t = g.ticks / KINDS.asteroids.cap;
  g.x = Math.max(12, Math.min(AW - 12, g.x + ((g.right ? 1 : 0) - (g.left ? 1 : 0)) * 5.5));
  const spawn = g.r(), rx = g.r(), rad = g.r(), sp = g.r(); // always four draws, so every player sees the same rocks
  if (spawn < 0.07 + t * 0.2) g.rocks.push({ x: rx * AW, y: -14, rad: 7 + rad * 9, v: 2.4 + t * 4.2 + sp * 1.6 });
  for (const k of g.rocks) k.y += k.v;
  g.rocks = g.rocks.filter((k) => k.y < AH + 20);
  const sy = AH - 22;
  if (g.rocks.some((k) => Math.abs(k.x - g.x) < k.rad + 9 && Math.abs(k.y - sy) < k.rad + 8)) { g.alive = false; return; }
  g.ticks++;
}

// ---------------------------------------------------------------- drawing
function drawSnake(ctx, g, color) {
  const W = ctx.canvas.width, c = W / SN;
  ctx.fillStyle = '#1f1e1b'; ctx.fillRect(0, 0, W, W);
  ctx.fillStyle = '#2a2926';
  for (let x = 0; x < SN; x++) for (let y = 0; y < SN; y++) if ((x + y) % 2) ctx.fillRect(x * c, y * c, c, c);
  if (g.apple) { ctx.fillStyle = '#e04a3a'; ctx.beginPath(); ctx.arc((g.apple[0] + 0.5) * c, (g.apple[1] + 0.5) * c, c * 0.38, 0, 7); ctx.fill(); }
  g.body.forEach(([x, y], i) => {
    ctx.fillStyle = i === 0 ? '#a3d160' : color === 'w' ? '#81b64c' : '#5d8a36';
    ctx.fillRect(x * c + 1, y * c + 1, c - 2, c - 2);
  });
  if (!g.alive) shade(ctx, 'Crashed!');
}
function drawRocks(ctx, g) {
  const W = ctx.canvas.width, k = W / AW;
  ctx.fillStyle = '#16151a'; ctx.fillRect(0, 0, W, W);
  ctx.fillStyle = '#ffffff22';
  for (let i = 0; i < 30; i++) ctx.fillRect(((i * 97) % AW) * k, ((i * 53 + g.ticks * (1 + (i % 3))) % AH) * k, 2, 2);
  ctx.fillStyle = '#8a8580';
  for (const r of g.rocks) { ctx.beginPath(); ctx.arc(r.x * k, r.y * k, r.rad * k, 0, 7); ctx.fill(); }
  const sy = (AH - 22) * k;
  ctx.fillStyle = '#a3d160';
  ctx.beginPath(); ctx.moveTo(g.x * k, sy - 10 * k); ctx.lineTo(g.x * k - 10 * k, sy + 9 * k); ctx.lineTo(g.x * k + 10 * k, sy + 9 * k); ctx.closePath(); ctx.fill();
  if (!g.alive) shade(ctx, 'Hit!');
}
function drawTug(ctx, wTaps, bTaps, names) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.fillStyle = '#1f1e1b'; ctx.fillRect(0, 0, W, H);
  const off = Math.max(-1, Math.min(1, (bTaps - wTaps) / 20)); // positive pulls toward Black (right)
  const mid = W / 2 + off * W * 0.32;
  ctx.fillStyle = '#ffffff33'; ctx.fillRect(W / 2 - 1, 10, 2, H - 20);
  ctx.strokeStyle = '#c9a46a'; ctx.lineWidth = 6;
  ctx.beginPath(); ctx.moveTo(20, H / 2); ctx.lineTo(W - 20, H / 2); ctx.stroke();
  ctx.fillStyle = '#e04a3a'; ctx.fillRect(mid - 4, H / 2 - 14, 8, 28);
  ctx.font = `800 ${Math.round(W / 16)}px system-ui, sans-serif`; ctx.textAlign = 'left'; ctx.fillStyle = '#fff';
  ctx.fillText(`${names.w}: ${wTaps}`, 14, 30);
  ctx.textAlign = 'right'; ctx.fillText(`${names.b}: ${bTaps}`, W - 14, 30);
}
function shade(ctx, text) {
  const W = ctx.canvas.width;
  ctx.fillStyle = '#000a'; ctx.fillRect(0, 0, W, ctx.canvas.height);
  ctx.fillStyle = '#fff'; ctx.font = `800 ${Math.round(W / 10)}px system-ui, sans-serif`; ctx.textAlign = 'center';
  ctx.fillText(text, W / 2, ctx.canvas.height / 2);
}

// ---------------------------------------------------------------- the match
/**
 * start(el, { kind, seed, players: [{ color, name, type: 'local'|'remote'|'bot', bot }], onDone(color, score), onProgress(color, score) })
 * Returns { remote(color, score, done), result(text), stop() }.
 */
function start(el, opts) {
  const K = KINDS[opts.kind];
  const players = opts.players;
  const locals = players.filter((p) => p.type === 'local');
  const two = locals.length === 2;
  const st = {}; // per color: { game, score, done, final, view }
  let running = false, stopped = false, t0 = 0, raf = 0, last = 0, acc = 0, progTimer = 0;
  const tug = { w: 0, b: 0 };
  const fmt = (c) => {
    const s = st[c];
    if (opts.kind === 'tug') return `${s.score} taps`;
    if (opts.kind === 'snake') {
      if (s.game) return `${apples(s.game)} apple${apples(s.game) === 1 ? '' : 's'}${s.done ? (s.game.alive ? ' · made it!' : ' · crashed') : ''}`;
      return s.done ? (s.score >= SURVIVED ? `Made it · ${s.score - SURVIVED} apples` : 'Crashed') : 'Alive';
    }
    return `${(s.score * K.tickMs / 1000).toFixed(1)}s`;
  };

  for (const p of players) {
    const s = st[p.color] = { score: 0, done: false, final: null, p };
    if (p.type === 'local') s.game = opts.kind === 'snake' ? newSnake(opts.seed) : opts.kind === 'asteroids' ? newRocks(opts.seed) : null;
    if (p.type === 'bot') {
      const [a, b] = BOT_RANGE[opts.kind][p.bot === 'jules' ? 'jules' : 'v1'];
      const v = Math.round(a + Math.random() * (b - a));
      s.final = v;
      if (opts.kind === 'snake') { // bots either crash at some point, or make it to the end with some apples
        const j = p.bot === 'jules', crash = Math.random() < (j ? 0.25 : 0.55);
        s.final = crash ? v : SURVIVED + Math.round(j ? 7 + Math.random() * 8 : 3 + Math.random() * 7);
      }
    }
  }

  const keysHelp = (c) => {
    if (opts.kind === 'tug') return two ? (c === 'w' ? 'A key' : 'L key') : 'Space, or tap the button';
    if (two) return c === 'w' ? (opts.kind === 'snake' ? 'W A S D' : 'A / D') : (opts.kind === 'snake' ? 'Arrow keys' : '← / →');
    return opts.kind === 'snake' ? 'Arrow keys or WASD, or swipe' : '← / → or A / D, or hold either side';
  };
  const arena = (p) => {
    if (p.type !== 'local') return `<div class="mg-opp" data-c="${p.color}"><div class="mg-name">${p.name}</div><div class="mg-oscore">Ready</div></div>`;
    const tapBtn = opts.kind === 'tug' ? `<button type="button" class="btn primary big mg-tap" data-tap="${p.color}">PULL!</button>` : '';
    return `<div class="mg-arena" data-c="${p.color}"><div class="mg-name">${p.name} <span>· ${keysHelp(p.color)}</span></div>
      ${opts.kind === 'tug' ? '' : `<canvas width="300" height="300" data-cv="${p.color}"></canvas>`}${tapBtn}
      <div class="mg-score" data-sc="${p.color}"></div></div>`;
  };
  el.innerHTML = `<div class="mg-card ${two ? 'two' : ''}">
      <div class="mg-title">${opts.title || K.title}</div><div class="mg-help">${K.help}</div>
      ${opts.kind === 'tug' ? '<canvas class="mg-rope" width="600" height="120"></canvas>' : ''}
      <div class="mg-arenas">${players.map(arena).join('')}</div>
      <div class="mg-status">Get ready…</div>
      <button type="button" class="btn small mg-leave">Leave minigame</button></div>`;
  el.classList.remove('hidden');
  const status = el.querySelector('.mg-status');
  const cv = (c) => el.querySelector(`[data-cv="${c}"]`);

  const draw = () => {
    for (const p of locals) {
      const s = st[p.color];
      if (opts.kind === 'snake') drawSnake(cv(p.color).getContext('2d'), s.game, p.color);
      if (opts.kind === 'asteroids') drawRocks(cv(p.color).getContext('2d'), s.game);
      const sc = el.querySelector(`[data-sc="${p.color}"]`);
      if (sc) sc.textContent = fmt(p.color) + (s.done && opts.kind !== 'snake' ? ' · done' : '');
    }
    if (opts.kind === 'tug') {
      const live = (c) => (st[c].p.type === 'local' ? tug[c] : st[c].score);
      drawTug(el.querySelector('.mg-rope').getContext('2d'), live('w'), live('b'), { w: st.w.p.name, b: st.b.p.name });
    }
    for (const p of players) {
      if (p.type === 'local') continue;
      const s = st[p.color], box = el.querySelector(`.mg-opp[data-c="${p.color}"] .mg-oscore`);
      if (!box) continue;
      if (opts.kind === 'tug') box.textContent = `${s.score} taps${s.done ? ' · done' : ''}`;
      else if (opts.kind === 'snake') box.textContent = fmt(p.color);
      else box.textContent = s.done ? `Hit at ${fmt(p.color)}` : `Alive · ${fmt(p.color)}`;
    }
  };
  draw();

  const finishLocal = (c) => {
    const s = st[c];
    if (s.done) return;
    s.done = true;
    s.score = opts.kind === 'tug' ? tug[c] : s.score;
    opts.onDone(c, s.score);
    maybeEnd();
  };
  const maybeEnd = () => {
    if (!locals.every((p) => st[p.color].done)) return;
    running = false;
    for (const p of players) {
      if (p.type !== 'bot' || st[p.color].done) continue;
      st[p.color].done = true;
      st[p.color].score = st[p.color].final;
      opts.onDone(p.color, st[p.color].final);
    }
    status.textContent = players.every((p) => st[p.color].done) ? 'Finished!' : 'Waiting for your opponent to finish…';
    draw();
  };
  /** Stop early once a local player has already beaten every finished opponent. */
  const knownFinal = (p) => (p.type === 'bot' ? st[p.color].final : st[p.color].done ? st[p.color].score : null);
  const alreadyWon = (c) => players.every((p) => p.color === c || (knownFinal(p) != null && knownFinal(p) < st[c].score));

  const loop = () => {
    if (stopped) return;
    raf = requestAnimationFrame(loop);
    if (!running) return;
    const now = performance.now();
    acc += Math.max(0, Math.min(250, now - last));
    last = now;
    const elapsed = Math.max(0, now - t0);
    while (acc >= K.tickMs) {
      acc -= K.tickMs;
      for (const p of locals) {
        const s = st[p.color];
        if (s.done) continue;
        if (opts.kind === 'snake') { stepSnake(s.game); s.score = snakeScore(s.game); if (!s.game.alive || s.game.ticks >= K.cap) finishLocal(p.color); }
        if (opts.kind === 'asteroids') { stepRocks(s.game); s.score = s.game.ticks; if (!s.game.alive || s.game.ticks >= K.cap) finishLocal(p.color); }
        if (!s.done && opts.kind !== 'tug' && alreadyWon(p.color)) finishLocal(p.color);
      }
    }
    if (opts.kind === 'tug') {
      for (const p of locals) st[p.color].score = tug[p.color];
      if (elapsed >= 5000) for (const p of locals) finishLocal(p.color);
    }
    for (const p of players) { // bots play along in real time
      if (p.type !== 'bot' || st[p.color].done) continue;
      const s = st[p.color];
      if (opts.kind === 'tug') s.score = Math.min(s.final, Math.floor(s.final * Math.min(1, elapsed / 5000)));
      else {
        const ticks = Math.floor(elapsed / K.tickMs), finalTicks = opts.kind === 'snake' && s.final >= SURVIVED ? K.cap : s.final;
        s.score = Math.min(ticks, finalTicks);
        if (ticks >= finalTicks) { s.done = true; s.score = s.final; opts.onDone(p.color, s.final); } // the bot is out: report it now
      }
    }
    if (running) status.textContent = opts.kind === 'tug' ? `${Math.max(0, (5 - elapsed / 1000)).toFixed(1)}s`
      : opts.kind === 'snake' ? `${Math.max(0, Math.ceil((K.cap * K.tickMs - elapsed) / 1000))}s left` : 'Go!';
    draw();
  };

  // ---- input
  const onKey = (e, down) => {
    if (!running) return;
    const k = e.key;
    let used = false;
    for (const p of locals) {
      const c = p.color, s = st[c], map = two ? [KEYS[c]] : [KEYS.w, KEYS.b];
      if (s.done) continue;
      const is = (name) => map.some((m) => m[name].includes(k));
      if (opts.kind === 'tug') {
        if (down && !e.repeat && (two ? is('tap') : SOLO_TAP.includes(k))) { tug[c]++; used = true; }
        continue;
      }
      for (const d of ['left', 'right', 'up', 'down']) {
        if (!is(d)) continue;
        used = true;
        if (opts.kind === 'snake' && down) steerSnake(s.game, d);
        if (opts.kind === 'asteroids' && (d === 'left' || d === 'right')) s.game[d] = down;
      }
    }
    if (used || [' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k)) e.preventDefault();
  };
  const kd = (e) => onKey(e, true), ku = (e) => onKey(e, false);
  window.addEventListener('keydown', kd, true);
  window.addEventListener('keyup', ku, true);
  el.querySelector('.mg-leave').addEventListener('click', () => { if (opts.onLeave) opts.onLeave(); });
  el.querySelectorAll('[data-tap]').forEach((b) => b.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const c = b.dataset.tap;
    if (running && !st[c].done) tug[c]++;
  }));
  for (const p of locals) { // touch: swipe to steer the snake, hold a side to fly
    const c = cv(p.color);
    if (!c) continue;
    let sx = 0, sy = 0;
    c.addEventListener('pointerdown', (e) => {
      e.preventDefault(); sx = e.clientX; sy = e.clientY;
      const g = st[p.color].game;
      if (opts.kind === 'asteroids' && g) { const r = c.getBoundingClientRect(); const left = e.clientX < r.left + r.width / 2; g.left = left; g.right = !left; }
    });
    c.addEventListener('pointerup', (e) => {
      const g = st[p.color].game;
      if (!g) return;
      if (opts.kind === 'asteroids') { g.left = g.right = false; return; }
      const dx = e.clientX - sx, dy = e.clientY - sy;
      if (Math.max(Math.abs(dx), Math.abs(dy)) > 12) steerSnake(g, Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    });
  }

  // ---- countdown, then go; online players report progress
  let n = 3;
  status.textContent = `${n}…`;
  const cd = setInterval(() => {
    if (stopped) return clearInterval(cd);
    n--;
    if (n > 0) { status.textContent = `${n}…`; return; }
    clearInterval(cd);
    running = true;
    t0 = last = performance.now();
    status.textContent = 'Go!';
  }, 800);
  raf = requestAnimationFrame(loop);
  if (opts.onProgress) progTimer = setInterval(() => { if (running) for (const p of locals) if (!st[p.color].done) opts.onProgress(p.color, opts.kind === 'tug' ? tug[p.color] : st[p.color].score); }, 400);

  return {
    remote(color, score, done) {
      const s = st[color];
      if (!s || s.done) return;
      s.score = score;
      if (done) s.done = true;
      draw();
    },
    result(text) { running = false; status.innerHTML = `<b>${text}</b>`; },
    stop() {
      stopped = true; running = false;
      cancelAnimationFrame(raf); clearInterval(cd); clearInterval(progTimer);
      window.removeEventListener('keydown', kd, true);
      window.removeEventListener('keyup', ku, true);
      el.classList.add('hidden');
      el.innerHTML = '';
    },
  };
}

globalThis.TGMini = { start, KINDS };
})();
