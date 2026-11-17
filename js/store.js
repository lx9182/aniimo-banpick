(function () {
  const A = window.ABP;
  let db = null;
  let offset = 0;

  const FB_SDK = 'https://www.gstatic.com/firebasejs/10.14.1/';

  function configured() {
    const c = window.FIREBASE_CONFIG;
    return !!(c && c.apiKey && c.databaseURL && String(c.apiKey).indexOf('PASTE') === -1);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = resolve;
      s.onerror = () => reject(new Error('Could not load ' + src));
      document.head.appendChild(s);
    });
  }

  /* --------------------------- local --------------------------- */

  const LK = (code) => A.LOCAL_KEY_PREFIX + code;

  function lread(code) {
    try {
      const raw = localStorage.getItem(LK(code));
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function lwrite(code, room) {
    try {
      localStorage.setItem(LK(code), JSON.stringify(room));
    } catch (e) {
      /* quota exceeded / private mode */
    }
  }

  const localSubs = {};

  function lsubscribe(code, cb) {
    let last = '\u0000';
    const fire = () => {
      const room = window.ABP.Draft ? window.ABP.Draft.hydrate(lread(code)) : lread(code);
      const sig = JSON.stringify(room);
      if (sig === last) return;
      last = sig;
      cb(room);
    };
    const set = (localSubs[code] = localSubs[code] || new Set());
    set.add(fire);
    const onStorage = (e) => {
      if (!e.key || e.key === LK(code)) fire();
    };
    window.addEventListener('storage', onStorage);
    const iv = setInterval(fire, 250);
    fire();
    return () => {
      window.removeEventListener('storage', onStorage);
      clearInterval(iv);
      const s = localSubs[code];
      if (s) {
        s.delete(fire);
        if (!s.size) delete localSubs[code];
      }
    };
  }

  /** Same tab: the `storage` event does not fire -> notify subscribers ourselves. */
  function notify(code) {
    const s = localSubs[code];
    if (s) s.forEach((fn) => fn());
  }

  function lmutate(code, fn) {
    const cur = lread(code);
    let next = null;
    try {
      next = fn(cur);
    } catch (e) {
      return Promise.resolve(false);
    }
    if (!next) return Promise.resolve(false);
    lwrite(code, next);
    notify(code);
    return Promise.resolve(true);
  }

  function lcreate(code, room) {
    if (lread(code)) return Promise.resolve(false);
    lwrite(code, room);
    notify(code);
    return Promise.resolve(true);
  }

  function lremove(code) {
    try { localStorage.removeItem(LK(code)); } catch (e) { /* ignore */ }
    notify(code);
    return Promise.resolve(true);
  }

  /* -------------------------- firebase ------------------------- */

  const path = (code) => 'rooms/' + code;

  /* Firebase drops null/empty fields entirely (seats.p2=null, bring.p1=[]
     simply disappear). Always hydrate before handing data to the UI / reducer. */
  function fhydrate(room) {
    return window.ABP.Draft ? window.ABP.Draft.hydrate(room) : room;
  }

  function fsubscribe(code, cb, onErr) {
    const ref = db.ref(path(code));
    const handler = (snap) => cb(fhydrate(snap.val()));
    const errHandler = (e) => { if (onErr) onErr(e); };
    ref.on('value', handler, errHandler);
    return () => ref.off('value', handler);
  }

  function fremove(code) {
    return db.ref(path(code)).remove().then(() => true, () => false);
  }

  /**
   * A transaction needs the local cache to be warm. When the client has never
   * received a snapshot, the handler runs once with `null` and the transaction
   * is aborted before it reaches the server. Detect that and retry once the
   * cache is warm.
   */
  function fmutate(code, fn) {
    const ref = db.ref(path(code));

    function attempt(tries) {
      let sawNull = false;
      return ref
        .transaction((cur) => {
          if (!cur) {
            sawNull = true; // cold cache, or the room is gone
            return;
          }
          let next = null;
          try {
            next = fn(cur);
          } catch (e) {
            return;
          }
          return next || undefined; // null/undefined => abort
        })
        .then((res) => {
          if (res.committed) return true;
          if (!sawNull || tries <= 0) return false;
          return new Promise((r) => setTimeout(r, 150)).then(() => attempt(tries - 1));
        });
    }

    return attempt(2);
  }

  function fcreate(code, room) {
    return db
      .ref(path(code))
      .transaction((cur) => (cur ? undefined : room))
      .then((res) => !!res.committed);
  }

  /* --------------------------- public -------------------------- */

  A.Store = {
    mode: 'local',

    async init() {
      if (!configured()) {
        A.Store.mode = 'local';
        return 'local';
      }
      await loadScript(FB_SDK + 'firebase-app-compat.js');
      await loadScript(FB_SDK + 'firebase-database-compat.js');
      if (!window.firebase.apps.length) window.firebase.initializeApp(window.FIREBASE_CONFIG);
      db = window.firebase.database();
      db.ref('.info/serverTimeOffset').on('value', (snap) => {
        offset = Number(snap.val()) || 0;
      });
      A.Store.mode = 'firebase';
      return 'firebase';
    },

    /** "True" clock — compensates for skew between the two machines. */
    now() {
      return Date.now() + (A.Store.mode === 'firebase' ? offset : 0);
    },

    subscribe(code, cb, onErr) {
      return A.Store.mode === 'firebase' ? fsubscribe(code, cb, onErr) : lsubscribe(code, cb);
    },

    mutate(code, fn) {
      return A.Store.mode === 'firebase' ? fmutate(code, fn) : lmutate(code, fn);
    },

    create(code, room) {
      return A.Store.mode === 'firebase' ? fcreate(code, room) : lcreate(code, room);
    },

    remove(code) {
      return A.Store.mode === 'firebase' ? fremove(code) : lremove(code);
    },
  };
})();
