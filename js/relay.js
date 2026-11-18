(function () {
// Online play through Supabase Realtime (the same setup as Charmed Hold'em): it works on any network,
// including ones that block direct browser-to-browser connections.
// The two players agree on a key (ECDH) and encrypt everything with AES-GCM, so nobody else who joins
// the channel can read the game. The publishable key below is meant to be public.
const ONLINE = { url: 'https://lttcxcrzlpaonsgznabt.supabase.co', key: 'sb_publishable_OQ7ayejFEj7FD0QqdOaC6Q_FFt8MspZ' };
const PREFIX = 'gerasimos-gambit-v1-';
const SB_SRC = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
const GRACE_MS = 10000; // a dropped connection gets this long to come back

let sbPromise = null;
function load() {
  if (!sbPromise) {
    sbPromise = new Promise((ok, fail) => {
      if (!window.crypto || !crypto.subtle) return fail(new Error('no-crypto'));
      const done = () => {
        try { ok(window.supabase.createClient(ONLINE.url, ONLINE.key, { auth: { persistSession: false } })); } catch (e) { fail(e); }
      };
      if (window.supabase) return done();
      const s = document.createElement('script');
      s.src = SB_SRC;
      s.onload = done;
      s.onerror = () => fail(new Error('load'));
      document.head.appendChild(s);
    }).catch((e) => { sbPromise = null; throw e; });
  }
  return sbPromise;
}

function emitter(o) {
  const h = {};
  o.on = (ev, fn) => { (h[ev] = h[ev] || []).push(fn); return o; };
  o.emit = (ev, x) => (h[ev] || []).forEach((fn) => { try { fn(x); } catch (e) { console.error(e); } });
  return o;
}

// ---- crypto
function b64(buf) {
  const a = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000));
  return btoa(s);
}
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function keypair() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
  return { kp, pub: b64(await crypto.subtle.exportKey('raw', kp.publicKey)) };
}
async function derive(kp, pub) {
  const theirs = await crypto.subtle.importKey('raw', unb64(pub), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  return crypto.subtle.deriveKey({ name: 'ECDH', public: theirs }, kp.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function seal(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj)));
  return { iv: b64(iv), ct: b64(ct) };
}
async function unseal(key, box) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

// ---- channels
async function openChannel(name, setup) {
  const client = await load();
  const cid = Math.random().toString(36).slice(2, 12);
  const ch = client.channel(PREFIX + name, { config: { broadcast: { self: false }, presence: { key: cid, enabled: true } } });
  const link = {
    ch, cid,
    send: (payload) => ch.send({ type: 'broadcast', event: 'm', payload: Object.assign({ from: cid }, payload) }),
    destroy: () => { try { ch.untrack(); } catch { /* gone */ } try { client.removeChannel(ch); } catch { /* gone */ } },
  };
  setup(link);
  await new Promise((ok, fail) => {
    let first = true;
    const t = setTimeout(() => { first = false; fail(new Error('timeout')); }, 10000);
    ch.subscribe((status) => {
      if (!first) return;
      if (status === 'SUBSCRIBED') { first = false; clearTimeout(t); ok(); }
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') { first = false; clearTimeout(t); fail(new Error(status)); }
    });
  }).catch((e) => { link.destroy(); throw e; });
  return link;
}

const others = (link) => Object.entries(link.ch.presenceState() || {}).filter(([k]) => k !== link.cid);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** A two-player connection with the same shape the game uses for PeerJS: open, send, on('open'|'data'|'close'), close. */
function makeConn(link, partner, key) {
  const conn = emitter({ open: true, partner });
  let sq = Promise.resolve(), rq = Promise.resolve(), gone = null;
  conn.send = (obj) => {
    if (!conn.open) return;
    sq = sq.then(() => seal(key, obj)).then((box) => link.send({ to: partner, box })).catch(() => { /* dropped */ });
  };
  conn.recv = (box) => {
    rq = rq.then(() => unseal(key, box)).then((d) => { if (conn.open) conn.emit('data', d); }).catch(() => { /* not for us */ });
  };
  conn.left = () => { clearTimeout(gone); gone = setTimeout(() => conn.close(), GRACE_MS); };
  conn.back = () => clearTimeout(gone);
  conn.close = () => {
    if (!conn.open) return;
    conn.open = false;
    clearTimeout(gone);
    conn.emit('close');
    link.destroy();
  };
  return conn;
}

/** Host a game under `code`. Emits 'connection' with a conn when a guest arrives. */
async function host(code) {
  const { kp, pub } = await keypair();
  const h = emitter({});
  let conn = null;
  const link = await openChannel(code, (l) => {
    l.ch.on('broadcast', { event: 'm' }, async ({ payload: p }) => {
      if (!p || p.to !== l.cid) return;
      if (p.hello) {
        if (conn && conn.open) { l.send({ to: p.from, busy: true }); return; }
        try {
          conn = makeConn(l, p.from, await derive(kp, p.pub));
          l.send({ to: p.from, welcome: true, pub });
          h.emit('connection', conn);
          setTimeout(() => conn.emit('open'));
        } catch { /* bad key */ }
      } else if (p.box && conn && p.from === conn.partner) conn.recv(p.box);
    });
    l.ch.on('presence', { event: 'leave' }, ({ key }) => { if (conn && key === conn.partner) conn.left(); });
    l.ch.on('presence', { event: 'join' }, ({ key }) => { if (conn && key === conn.partner) conn.back(); });
  });
  await wait(700); // let presence arrive, so a code already in use is noticed
  if (others(link).some(([, metas]) => (metas || []).some((m) => m && m.role === 'host'))) { link.destroy(); throw new Error('taken'); }
  await link.ch.track({ role: 'host' });
  h.destroy = () => { if (conn) conn.close(); link.destroy(); };
  return h;
}

/** Join the game hosted under `code`. Resolves with an open conn; rejects with 'not-found', 'full' or 'unreachable'. */
async function join(code) {
  const { kp, pub } = await keypair();
  let settle;
  const result = new Promise((ok, fail) => { settle = { ok, fail }; });
  let conn = null, done = false, link = null;
  const fail = (why) => { if (done) return; done = true; if (link) link.destroy(); settle.fail(new Error(why)); };
  try {
    link = await openChannel(code, (l) => {
      l.ch.on('broadcast', { event: 'm' }, async ({ payload: p }) => {
        if (!p || p.to !== l.cid) return;
        if (p.busy) return fail('full');
        if (p.welcome && !conn) {
          try { conn = makeConn(l, p.from, await derive(kp, p.pub)); } catch { return fail('unreachable'); }
          done = true;
          settle.ok(conn);
          setTimeout(() => conn.emit('open'));
        } else if (p.box && conn && p.from === conn.partner) conn.recv(p.box);
      });
      l.ch.on('presence', { event: 'leave' }, ({ key }) => { if (conn && key === conn.partner) conn.left(); });
      l.ch.on('presence', { event: 'join' }, ({ key }) => { if (conn && key === conn.partner) conn.back(); });
    });
  } catch { fail('unreachable'); return result; }
  await link.ch.track({ role: 'guest' });
  const t0 = Date.now();
  while (!done) {
    const hostEntry = others(link).find(([, metas]) => (metas || []).some((m) => m && m.role === 'host'));
    if (hostEntry) {
      link.send({ to: hostEntry[0], hello: true, pub });
      setTimeout(() => fail('not-found'), 6000);
      break;
    }
    if (Date.now() - t0 > 5000) { fail('not-found'); break; }
    await wait(250);
  }
  return result;
}

/**
 * Random matchmaking: everyone searching a mode waits in that mode's lobby. Searchers pair up in the
 * order they arrived; the earlier one of each pair hosts. Calls onPair({ role: 'host'|'guest', code }).
 */
function matchmake(mode, onPair, onError) {
  let link = null, stopped = false;
  const since = Date.now() + Math.random();
  const decide = () => {
    if (stopped || !link) return;
    const list = Object.entries(link.ch.presenceState() || {})
      .map(([key, metas]) => ({ key, since: (metas && metas[0] && metas[0].since) || 0 }))
      .sort((a, b) => a.since - b.since || (a.key < b.key ? -1 : 1));
    const i = list.findIndex((e) => e.key === link.cid);
    if (i < 0) return;
    let pair = null;
    if (i % 2 === 0 && list[i + 1]) pair = { role: 'host', code: 'Q' + link.cid };
    if (i % 2 === 1) pair = { role: 'guest', code: 'Q' + list[i - 1].key };
    if (!pair) return;
    stopped = true;
    link.destroy();
    onPair(pair);
  };
  openChannel('lobby-' + mode, (l) => { l.ch.on('presence', { event: 'sync' }, () => setTimeout(decide, 300)); })
    .then(async (l) => {
      link = l;
      if (stopped) return l.destroy();
      await l.ch.track({ since });
    })
    .catch((e) => { if (!stopped) onError(e); });
  return { cancel: () => { stopped = true; if (link) link.destroy(); } };
}

globalThis.TGRelay = { available: () => !!(ONLINE.url && ONLINE.key && !ONLINE.key.startsWith('__')), load, host, join, matchmake };
})();
