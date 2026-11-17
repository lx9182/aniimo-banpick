(function () {
  const A = (window.ABP = window.ABP || {});

  const P = {
    LOBBY: 'lobby',
    BRING: 'bring',
    BAN: 'ban',
    DONE: 'done',
  };

  const SEATS = ['p1', 'p2'];
  const other = (s) => (s === 'p1' ? 'p2' : 'p1');

  function int(v, min, max, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  /** Picks minus bans must leave at least MIN_KEEP Aniimo to play. */
  const MIN_KEEP = 6;

  function clampCfg(raw) {
    const d = A.DEFAULT_CFG;
    const c = raw || {};
    const bring = int(c.bring, MIN_KEEP, 12, d.bring);
    return {
      bring: bring,
      banEach: int(c.banEach, 0, Math.min(6, bring - MIN_KEEP), d.banEach),
    };
  }

  function newRoom(code, now) {
    return {
      v: 2,
      code: code,
      phase: P.LOBBY,
      host: 'p1',
      cfg: Object.assign({}, A.DEFAULT_CFG),
      seq: 0,
      seats: { p1: null, p2: null },
      bring: { p1: [], p2: [] },
      bansBy: { p1: [], p2: [] },
      confirmed: { p1: false, p2: false },
      createdAt: now,
      updatedAt: now,
      expiresAt: now + A.ROOM_TTL_MS,
    };
  }

  /** Patch missing / legacy fields so the UI never crashes. */
  function hydrate(room) {
    if (!room) return room;
    room.cfg = clampCfg(room.cfg);
    room.seats = room.seats || { p1: null, p2: null };
    room.seats.p1 = room.seats.p1 || null;
    room.seats.p2 = room.seats.p2 || null;
    room.bring = room.bring || { p1: [], p2: [] };
    room.bansBy = room.bansBy || { p1: [], p2: [] };
    room.confirmed = room.confirmed || { p1: false, p2: false };
    for (const s of SEATS) {
      if (!Array.isArray(room.bring[s])) room.bring[s] = [];
      if (!Array.isArray(room.bansBy[s])) room.bansBy[s] = [];
      room.confirmed[s] = !!room.confirmed[s];
    }
    room.phase = room.phase || P.LOBBY;
    room.seq = Number(room.seq) || 0;
    room.host = room.host === 'p2' ? 'p2' : 'p1';
    room.v = Number(room.v) || 1;
    return room;
  }

  function seatOf(room, token) {
    if (!room || !token) return null;
    const seats = room.seats || {};
    for (const s of SEATS) {
      const seat = seats[s];
      if (seat && seat.token === token) return s;
    }
    return null;
  }

  function freeSeat(room) {
    return SEATS.find((s) => !room.seats[s]) || null;
  }

  /** How many Aniimo each player must pick (shrinks if the pool is smaller). */
  function need(room, ctx) {
    const poolLen = ctx && ctx.pool ? ctx.pool.length : 0;
    return Math.min(room.cfg.bring, poolLen);
  }

  /** What is left of `seat`'s picks after the opponent's bans. */
  function remaining(room, seat) {
    const banned = room.bansBy[other(seat)] || [];
    return (room.bring[seat] || []).filter((id) => banned.indexOf(id) === -1);
  }

  /** Picks of the opponent that `seat` may still ban. */
  function banTargets(room, seat) {
    const foe = other(seat);
    const mine = room.bansBy[seat] || [];
    return (room.bring[foe] || []).filter((id) => mine.indexOf(id) === -1);
  }

  function bansLeft(room, seat) {
    return Math.max(0, room.cfg.banEach - (room.bansBy[seat] || []).length);
  }

  function clearMatch(room) {
    room.bring = { p1: [], p2: [] };
    room.bansBy = { p1: [], p2: [] };
    room.confirmed = { p1: false, p2: false };
  }

  /**
   * Apply one action to the room.
   * @returns the mutated room, or null when the action is not allowed.
   */
  function apply(room, act, ctx) {
    if (!room || !act) return null;
    ctx = ctx || {};
    const now = Number(ctx.now) || Date.now();
    room = hydrate(room);

    switch (act.type) {
      /* ---------------- lobby ---------------- */
      case 'join': {
        if (!act.token) return null;
        let seat = seatOf(room, act.token);
        if (!seat) {
          seat = freeSeat(room);
          if (!seat) return null; // room is full
          if (room.phase !== P.LOBBY) return null; // match already running
        }
        const prev = room.seats[seat] || {};
        const name = String(act.name || prev.name || seat.toUpperCase()).slice(0, 20).trim() || seat.toUpperCase();
        if (prev.token === act.token && prev.name === name) return null; // nothing changed
        room.seats[seat] = { name: name, token: act.token, ready: !!prev.ready };
        if (!room.seats[other(seat)] && room.host !== seat) room.host = seat;
        break;
      }

      case 'rename': {
        const seat = seatOf(room, act.token);
        if (!seat) return null;
        const name = String(act.name || '').slice(0, 20).trim();
        if (!name || name === room.seats[seat].name) return null;
        room.seats[seat].name = name;
        break;
      }

      case 'ready': {
        const seat = seatOf(room, act.token);
        if (!seat || room.phase !== P.LOBBY) return null;
        const on = !!act.on;
        if (room.seats[seat].ready === on) return null;
        room.seats[seat].ready = on;
        break;
      }

      case 'config': {
        const seat = seatOf(room, act.token);
        if (seat !== room.host || room.phase !== P.LOBBY) return null;
        const next = clampCfg(Object.assign({}, room.cfg, act.cfg));
        if (JSON.stringify(next) === JSON.stringify(room.cfg)) return null;
        room.cfg = next;
        break;
      }

      case 'start': {
        const seat = seatOf(room, act.token);
        if (seat !== room.host || room.phase !== P.LOBBY) return null;
        if (!room.seats.p1 || !room.seats.p2) return null;
        if (!room.seats.p1.ready || !room.seats.p2.ready) return null;
        if (!ctx.pool || ctx.pool.length < 2) return null;
        clearMatch(room);
        room.phase = P.BRING;
        break;
      }

      /* ---------------- pick 8 ---------------- */
      case 'setBring': {
        const seat = seatOf(room, act.token);
        if (!seat || room.phase !== P.BRING || room.confirmed[seat]) return null;
        const max = need(room, ctx);
        if (!ctx.pool || ctx.pool.indexOf(act.id) === -1) return null;
        const cur = room.bring[seat];
        const i = cur.indexOf(act.id);
        if (act.on) {
          if (i >= 0) return null; // already picked
          if (cur.length >= max) return null;
          cur.push(act.id);
        } else {
          if (i === -1) return null; // already unpicked
          cur.splice(i, 1);
        }
        break;
      }

      case 'confirmBring': {
        const seat = seatOf(room, act.token);
        if (!seat || room.phase !== P.BRING || room.confirmed[seat]) return null;
        if (room.bring[seat].length !== need(room, ctx)) return null;
        room.confirmed[seat] = true;
        if (room.confirmed.p1 && room.confirmed.p2) {
          room.confirmed = { p1: false, p2: false };
          room.phase = room.cfg.banEach > 0 ? P.BAN : P.DONE;
        }
        break;
      }

      /* ---------------- ban (both sides at once, no turn order) ---------------- */
      case 'setBan': {
        const seat = seatOf(room, act.token);
        if (!seat || room.phase !== P.BAN || room.confirmed[seat]) return null;
        const mine = room.bansBy[seat];
        const i = mine.indexOf(act.id);
        if (act.on) {
          if (i >= 0) return null; // already banned
          if (mine.length >= room.cfg.banEach) return null;
          if (banTargets(room, seat).indexOf(act.id) === -1) return null;
          mine.push(act.id);
        } else {
          if (i === -1) return null; // not banned
          mine.splice(i, 1);
        }
        break;
      }

      case 'confirmBan': {
        const seat = seatOf(room, act.token);
        if (!seat || room.phase !== P.BAN || room.confirmed[seat]) return null;
        room.confirmed[seat] = true;
        if (room.confirmed.p1 && room.confirmed.p2) {
          room.confirmed = { p1: false, p2: false };
          room.phase = P.DONE;
        }
        break;
      }

      /* ---------------- undo a confirm (only while the other side is still deciding) ---------------- */
      case 'cancelConfirm': {
        const seat = seatOf(room, act.token);
        if (!seat) return null;
        if (room.phase !== P.BRING && room.phase !== P.BAN) return null;
        if (!room.confirmed[seat] || room.confirmed[other(seat)]) return null;
        room.confirmed[seat] = false;
        break;
      }

      case 'reset': {
        const seat = seatOf(room, act.token);
        if (seat !== room.host) return null;
        room.phase = P.LOBBY;
        clearMatch(room);
        for (const s of SEATS) if (room.seats[s]) room.seats[s].ready = false;
        break;
      }

      default:
        return null;
    }

    room.seq = (room.seq || 0) + 1;
    room.updatedAt = now;
    room.expiresAt = Math.max(Number(room.expiresAt) || 0, now + A.ROOM_TTL_MS);
    return room;
  }

  A.Draft = {
    P: P,
    SEATS: SEATS,
    MIN_KEEP: MIN_KEEP,
    other: other,
    clampCfg: clampCfg,
    newRoom: newRoom,
    hydrate: hydrate,
    seatOf: seatOf,
    freeSeat: freeSeat,
    need: need,
    remaining: remaining,
    banTargets: banTargets,
    bansLeft: bansLeft,
    apply: apply,
  };
})();
