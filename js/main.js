(function () {
  const A = window.ABP;
  const D = A.Draft;
  const ui = A.ui;

  let unsub = null;
  let joinSentFor = null;

  /* ------------------------- storage ------------------------- */

  /* LOCAL mode uses sessionStorage so two tabs are two different players.
     Firebase mode uses localStorage so F5 / reopening keeps your seat. */
  function bag() {
    return A.Store.mode === 'local' ? window.sessionStorage : window.localStorage;
  }

  function read(key) {
    try { return bag().getItem(key) || ''; } catch (e) { return ''; }
  }

  function write(key, val) {
    try { bag().setItem(key, val); } catch (e) { /* ignore */ }
  }

  function randToken() {
    const bytes = new Uint8Array(16);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(bytes);
    else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function tokenOf(code) {
    const key = 'abp:token:' + code;
    let t = read(key);
    if (!t) {
      t = randToken();
      write(key, t);
    }
    return t;
  }

  function genCode() {
    const ab = A.CODE_ALPHABET;
    let out = '';
    const buf = new Uint32Array(A.CODE_LEN);
    if (window.crypto && window.crypto.getRandomValues) window.crypto.getRandomValues(buf);
    else for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(Math.random() * 1e9);
    for (let i = 0; i < A.CODE_LEN; i++) out += ab[buf[i] % ab.length];
    return out;
  }

  /* --------------------------- route -------------------------- */

  function parseCode() {
    const m = location.hash.match(/^#r=([A-Za-z0-9]+)/i);
    return m ? m[1].toUpperCase() : null;
  }

  function route() {
    if (unsub) { unsub(); unsub = null; }
    const code = parseCode();

    ui.sel = null;
    ui.nameErr = '';
    ui.expired = false;
    joinSentFor = null;

    if (!code) {
      ui.code = null;
      ui.room = null;
      ui.seat = null;
      ui.pendingCode = null;
      ui.view = 'landing';
      A.UI.paint();
      return;
    }

    if (!ui.name) {
      ui.pendingCode = code;
      ui.room = null;
      ui.code = code;
      ui.view = 'landing';
      A.UI.paint();
      focusName();
      return;
    }

    ui.pendingCode = null;
    ui.code = code;
    ui.room = null;
    ui.seat = null;
    ui.view = 'loading';
    A.UI.paint();

    unsub = A.Store.subscribe(code, onRoom, onRoomError);
  }

  function onRoom(room) {
    const code = ui.code;
    if (!code) return;

    if (room && (room.v !== 2 || (room.expiresAt && room.expiresAt <= A.Store.now()))) {
      return roomGone(code, true);
    }

    ui.room = room ? D.hydrate(room) : null;
    ui.seat = ui.room ? D.seatOf(ui.room, tokenOf(code)) : null;
    ui.view = ui.room ? 'room' : 'missing';
    if (ui.room && !ui.seat) tryJoin(code);
    A.UI.paint();
  }

  /** Rules deny reads once a room expires; wipe the leftovers and say so. */
  function onRoomError() {
    if (!ui.code) return;
    roomGone(ui.code, true);
  }

  function roomGone(code, expired) {
    if (unsub) { unsub(); unsub = null; }
    ui.room = null;
    ui.seat = null;
    ui.expired = !!expired;
    ui.view = 'missing';
    A.UI.paint();
    if (expired) A.Store.remove(code).catch(() => false);
  }

  function tryJoin(code) {
    if (joinSentFor === code) return;
    if (!ui.name) return;
    joinSentFor = code;
    A.send({ type: 'join', name: ui.name, token: tokenOf(code) });
  }

  /* -------------------------- actions ------------------------- */

  /** No name yet: show the error right at the input and focus it. */
  function focusName(mark) {
    const el = document.getElementById('name');
    if (!el) return;
    if (mark) el.classList.add('invalid');
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    try { el.scrollIntoView({ block: 'center' }); } catch (e) { /* ignore */ }
  }

  function needName() {
    ui.nameErr = 'Enter your name first';
    A.UI.paint();
    focusName(true);
  }

  A.send = function (action) {
    const code = ui.code;
    if (!code) return Promise.resolve(false);
    const payload = Object.assign({}, action, { token: tokenOf(code) });
    return A.Store.mutate(code, (room) =>
      D.apply(room, payload, { now: A.Store.now(), pool: ui.pool, rng: Math.random })
    ).catch(() => false);
  };

  A.createRoom = async function () {
    if (!ui.name || !ui.name.trim()) { needName(); return; }
    const code = genCode();
    const room = D.newRoom(code, A.Store.now());
    const ok = await A.Store.create(code, room).catch(() => false);
    if (!ok) { A.UI.toast('Could not create the room, try again'); return; }
    joinSentFor = null;
    const target = '#r=' + code;
    if (location.hash === target) route();
    else location.hash = target;
  };

  A.joinFromInput = function () {
    const input = document.getElementById('code');
    const raw = (input ? input.value : '').trim();
    if (!ui.name || !ui.name.trim()) { needName(); return; }
    if (!raw) { A.UI.toast('Enter a room code'); return; }

    let code = '';
    const fromLink = raw.match(/#r=([A-Za-z0-9]+)/i);
    if (fromLink) code = fromLink[1];
    else code = raw.replace(/[^A-Za-z0-9]/g, '');
    code = code.toUpperCase();
    if (!code) { A.UI.toast('Invalid room code'); return; }

    ui.pendingCode = null;
    const target = '#r=' + code;
    if (location.hash === target) route();
    else location.hash = target;
  };

  A.copyCode = function () {
    if (!ui.code) return;
    A.UI.copyText(ui.code);
  };

  A.prefs = {
    get: read,
    set: function (k, v) { write(k, v); },
  };

  /* --------------------------- boot -------------------------- */

  async function boot() {
    try {
      await A.Store.init();
    } catch (e) {
      A.Store.mode = 'local';
      ui.err = 'Could not load the Firebase SDK (' + e.message + '). Using LOCAL mode.';
    }

    ui.name = read('abp:name');

    try {
      const res = await fetch(A.MANIFEST_URL + '?v=' + Date.now());
      if (!res.ok) throw new Error('HTTP ' + res.status);
      A.UI.setManifest(await res.json());
    } catch (e) {
      ui.err = 'Could not read ' + A.MANIFEST_URL + ' (' + e.message + ').';
    }

    A.UI.bind();
    route();
    window.addEventListener('hashchange', route);
  }

  boot();
})();
