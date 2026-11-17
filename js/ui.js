(function () {
  const A = window.ABP;
  const D = A.Draft;
  const P = D.P;
  /** Minimum Aniimo each side keeps after bans (picks - bans >= this). */
  const MIN_KEEP = D.MIN_KEEP || 6;

  const PHASE_LABEL = {
    lobby: 'Lobby',
    bring: 'Pick 8',
    ban: 'Ban',
    done: 'Done',
  };

  const EL_ORDER = A.ELEMENT_ORDER;

  A.ui = {
    view: 'loading',
    room: null,
    seat: null,
    code: null,
    pool: [],
    byId: {},
    manifest: null,
    name: '',
    nameErr: '',
    err: '',
    expired: false,
    elFilter: [],
    q: '',
    stage: 0,
    cfgOpen: false,
    busy: false,
  };

  /* ------------------------- helpers ------------------------- */

  const esc = (s) =>
    String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));

  function hue(id) {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
    return h;
  }

  function initials(name) {
    const s = String(name || '?').replace(/[^A-Za-z0-9 ]/g, '');
    return (s.slice(0, 2) || '?').toUpperCase();
  }

  function itemOf(id) {
    return A.ui.byId[id] || null;
  }

  function imgOf(it) {
    if (!it) return '';
    return A.IMG_BASE + (it.img || it.id + '.webp');
  }

  function nameOfId(id) {
    const it = itemOf(id);
    return it ? it.name : id;
  }

  function nameOf(room, seat) {
    const s = room.seats && room.seats[seat];
    return (s && s.name) || 'Player ' + (seat === 'p1' ? '1' : '2');
  }

  /** Canonical element id for a raw type (handles old manifest vocabularies). */
  function elementId(raw) {
    if (!raw) return null;
    let t = String(raw).toLowerCase().trim();
    if (A.ELEMENT_ALIASES[t]) t = A.ELEMENT_ALIASES[t];
    return A.ELEMENTS[t] ? t : null;
  }

  function typesOf(it) {
    const out = [];
    for (const raw of (it && it.types) || []) {
      const id = elementId(raw);
      if (id && out.indexOf(id) === -1) out.push(id);
    }
    return out;
  }

  /** Round element badge: the official icon only (no letter). */
  function elementBadge(id, extra) {
    const el = A.ELEMENTS[id];
    if (!el) return '';
    return `<span class="el ${extra || ''}" style="--el:${el.color}" title="${esc(el.label)}">
      <img src="${esc(A.ICON_BASE + id + '.webp')}" alt="" loading="lazy" onerror="this.remove()">
    </span>`;
  }

  function noLabel(it, idx) {
    const raw = (it && it.no) || idx + 1;
    return 'NO.' + String(raw).padStart(3, '0');
  }

  /**
   * One thumbnail component for every Aniimo image: pool, picks, results and
   * the extra-forms preview. Art and element badges always travel together.
   */
  function thumbHtml(it, extra) {
    it = it || {};
    const els = typesOf(it);
    return `<span class="thumb" style="--h:${hue(it.id || it.name || '')}">
        <span class="ph">${esc(initials(it.name))}</span>
        <img src="${esc(imgOf(it))}" alt="" loading="lazy"
             onload="this.closest('.thumb').classList.add('loaded')"
             onerror="this.style.display='none'">
        <span class="badges">${els.map((e) => elementBadge(e)).join('')}</span>${extra || ''}
      </span>`;
  }

  /** A form entry as a thumbnail-sized item (it may carry its own attributes). */
  function formItem(it, f) {
    return {
      id: it.id,
      name: it.name,
      img: f.img,
      types: f.types && f.types.length ? f.types : it.types,
    };
  }

  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('on'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove('on');
      setTimeout(() => { el.hidden = true; }, 220);
    }, 2000);
  }

  function copyText(text) {
    const done = () => toast('Copied');
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done).catch(() => fallback());
    } else fallback();

    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed'); }
      ta.remove();
    }
  }

  /* ------------- extra forms (reference only, hover/tap) ------------- */

  let tipEl = null;
  let tipCard = null;
  let tipPinned = false;

  function formsOf(it) {
    return it && Array.isArray(it.forms) ? it.forms.filter((f) => f && f.img) : [];
  }

  function formLabel(id) {
    return String(id || '')
      .split(/[-_]/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  function formsTipHtml(it) {
    const els = typesOf(it);
    const stage = Number(it.stage) || 0;
    const forms = formsOf(it);
    /* Thumbnails stay the same size as the pool; at most 3 per row. */
    const cols = Math.min(forms.length, 3) || 1;
    return `<div class="ftip-head">
        <b>${esc(it.name)}</b>
        ${stage ? `<span class="ftip-stage">Stage ${stage}</span>` : ''}
        <span class="ftip-badges">${els.map((e) => elementBadge(e)).join('')}</span>
      </div>
      <div class="ftip-note">Other forms · reference only</div>
      <div class="ftip-forms" style="--cols:${cols}">${forms.map((f) => `<figure class="ftip-form">
        ${thumbHtml(formItem(it, f))}
        <figcaption>${esc(formLabel(f.id))}</figcaption>
      </figure>`).join('')}</div>`;
  }

  function placeTip(card, el) {
    const pad = 10;
    const r = card.getBoundingClientRect();
    const w = el.offsetWidth || 250;
    const h = el.offsetHeight || 140;
    const left = Math.max(pad, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - pad));
    let top = r.bottom + 10;
    if (top + h > window.innerHeight - pad) top = r.top - h - 10;
    top = Math.max(pad, Math.min(top, window.innerHeight - h - pad));
    el.style.left = Math.round(left) + 'px';
    el.style.top = Math.round(top) + 'px';
    el.classList.add('on');
  }

  /** Anything that can host a forms popover: pool cards and filled picks. */
  function tipHost(target) {
    return target && target.closest ? target.closest('.card, .slot[data-id]') : null;
  }

  function showFormsTip(card, pin) {
    const it = itemOf(card && card.dataset.id);
    if (!it || !formsOf(it).length) return;
    if (tipCard === card && tipEl) {
      if (pin) tipPinned = true;
      return;
    }
    hideFormsTip(true);
    const el = document.createElement('div');
    el.className = 'ftip';
    el.setAttribute('role', 'tooltip');
    el.innerHTML = formsTipHtml(it);
    document.body.appendChild(el);
    markLoaded(el);
    tipEl = el;
    tipCard = card;
    tipPinned = !!pin;
    placeTip(card, el);
  }

  function hideFormsTip(force) {
    if (tipPinned && !force) return;
    if (tipEl) tipEl.remove();
    tipEl = null;
    tipCard = null;
    tipPinned = false;
  }

  /* -------------------------- views -------------------------- */

  function topbar(r) {
    const open = !!A.ui.cfgOpen;
    return `<div class="topbar">
      <div class="brand">ANIIMO <b>BAN/PICK</b></div>
      <button class="code-pill" data-act="copy" title="Copy room code">
        #${esc(r.code)} <span class="hint">copy code</span>
      </button>
      <div class="spacer"></div>
      <span class="phase ${r.phase}">${esc(PHASE_LABEL[r.phase] || r.phase)}</span>
      <button class="icon-btn ${open ? 'on' : ''}" data-act="cfgOpen" title="Match settings"
              aria-label="Match settings" aria-expanded="${open ? 'true' : 'false'}">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3.5 7.5h8M17.5 7.5h3M3.5 16.5h3M12.5 16.5h8"></path>
          <circle cx="14.5" cy="7.5" r="2.6"></circle>
          <circle cx="9.5" cy="16.5" r="2.6"></circle>
        </svg>
      </button>
      <button class="btn ghost sm" data-act="home">Leave</button>
    </div>`;
  }

  function landing() {
    const ui = A.ui;
    const local = A.Store.mode === 'local'
      ? `<div class="note">Running in <b>LOCAL</b> mode — only two tabs on this machine. Add your Firebase config to play across devices.</div>`
      : '';
    const err = ui.err ? `<div class="note err">${esc(ui.err)}</div>` : '';
    const invite = ui.pendingCode
      ? `<div class="note">You were invited to room <b>#${esc(ui.pendingCode)}</b>. Enter a name, then join.</div>`
      : '';

    return `<div class="wrap">
      <div class="topbar">
        <div class="brand">ANIIMO <b>BAN/PICK</b></div>
        <div class="spacer"></div>
        <span class="ver">v${esc(A.VERSION)}</span>
      </div>
      <main class="hero">
        <div class="kicker">DRAFT TOOL</div>
        <h1>Build your team<br><span>before the match</span></h1>
        <p>Pick 8 · ban 2 from your opponent · play 6. No account, just a name and a room code.</p>
        ${invite}
        <div class="card-box">
          <div class="field">
            <label for="name">Your name</label>
            <input id="name" name="name" maxlength="20" placeholder="e.g. Minh" autocomplete="nickname"
                   class="${ui.nameErr ? 'invalid' : ''}" value="${esc(ui.name)}">
            ${ui.nameErr ? `<div class="field-err" id="nameErr">${esc(ui.nameErr)}</div>` : ''}
          </div>
          <button class="btn primary wide" data-act="create">Create room</button>
          <div class="or"><span>or join with a code</span></div>
          <div class="field">
            <label for="code">Room code</label>
            <input id="code" name="code" maxlength="60" placeholder="ABC234PQ" autocomplete="off" spellcheck="false" value="${esc(ui.pendingCode || '')}">
          </div>
          <button class="btn wide" data-act="join">Join room</button>
        </div>
        ${local}${err}
      </main>
    </div>`;
  }

  function missing() {
    const code = esc(A.ui.code || '');
    return `<div class="wrap">
      <div class="topbar">
        <div class="brand">ANIIMO <b>BAN/PICK</b></div>
        <div class="spacer"></div>
        <span class="ver">v${esc(A.VERSION)}</span>
      </div>
      <main class="hero">
        <div class="kicker">${A.ui.expired ? 'EXPIRED' : 'NOT FOUND'}</div>
        <h1>${A.ui.expired ? 'This room has expired' : 'Room not found'}</h1>
        <p>${A.ui.expired
          ? 'Rooms live for 24 hours after their last activity. Ask the host to create a new one.'
          : `Code <b>${code}</b> does not exist yet, or was removed.`}</p>
        <div class="card-box">
          <button class="btn primary wide" data-act="home">Back to start</button>
        </div>
      </main>
    </div>`;
  }

  /* --------------------------- lobby -------------------------- */

  function seatCard(seat, r) {
    const ui = A.ui;
    const me = ui.seat === seat;
    const s = r.seats[seat];
    const ready = !!(s && s.ready);
    return `<div class="seat ${seat} ${me ? 'me' : ''}">
      <div class="seat-head">
        <h2>Player ${seat === 'p1' ? 1 : 2}</h2>
        ${me ? '<span class="you">YOU</span>' : ''}
        <span class="who">${s ? esc(s.name) : 'waiting…'}</span>
      </div>
      <div class="seat-state ${ready ? 'ok' : ''}">${s ? (ready ? '✓ Ready' : 'Not ready yet') : 'Empty seat'}</div>
    </div>`;
  }

  /** Compact settings sheet behind the topbar icon. Read-only for guests. */
  function cfgSheet(r) {
    const host = A.ui.seat === r.host;
    const locked = r.phase !== P.LOBBY;
    const editable = host && !locked;
    const c = r.cfg;
    return `<div class="sheet-wrap">
      <div class="sheet-back" data-act="cfgClose"></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="Match settings">
        <div class="sheet-head">
          <h3>Match settings</h3>
          <button class="icon-btn sm" data-act="cfgClose" aria-label="Close settings">×</button>
        </div>
        <div class="sheet-body">
          <label class="num">
            <span>Aniimo per player</span>
            <input type="number" inputmode="numeric" data-cfg="bring" min="${MIN_KEEP}" max="12"
                   value="${c.bring}" ${editable ? '' : 'disabled'}>
          </label>
          <label class="num">
            <span>Bans per player</span>
            <input type="number" inputmode="numeric" data-cfg="banEach" min="0" max="6"
                   value="${c.banEach}" ${editable ? '' : 'disabled'}>
          </label>
          <p class="sheet-hint">Picks minus bans must stay at least <b>${MIN_KEEP}</b>, so each side
            always keeps ${MIN_KEEP} Aniimo to play. Changing one value adjusts the other.</p>
          ${!host ? '<p class="sheet-note">Only the host can change these.</p>' : ''}
          ${locked ? '<p class="sheet-note">Settings are locked once the draft has started.</p>' : ''}
          <div class="sheet-foot"><button class="btn primary wide" data-act="cfgClose">Done</button></div>
        </div>
      </div>
    </div>`;
  }

  function lobby(r) {
    return `<div class="board seats-board">${seatCard('p1', r)}${seatCard('p2', r)}</div>
      <section class="stage">
        <div class="box-head">
          <h3>Aniimo Pool</h3>
          <span class="left" id="poolMeta">${poolMeta(r)}</span>
        </div>
        ${filtersBar()}
        <div class="pool">${poolList({ dim: true })}</div>
      </section>`;
  }

  /* --------------------------- draft -------------------------- */

  function slotHtml(seat, r, id) {
    const me = A.ui.seat === seat;
    const hidden = r.phase === P.BRING && !me;
    const foe = D.other(seat);
    const banned = (r.bansBy[foe] || []).indexOf(id) !== -1;
    const selectable = r.phase === P.BAN && !!A.ui.seat && A.ui.seat === foe &&
      !r.confirmed[A.ui.seat] && (banned || D.bansLeft(r, A.ui.seat) > 0);
    const it = itemOf(id) || { id: id, name: nameOfId(id), types: [] };
    const extra = formsOf(it).length;
    /* Same "+N forms" tag as the pool, so picks can be inspected without
       scrolling back to the pool (hover works too, this is the tap target). */
    const pill = extra
      ? `<span class="forms-pill" data-act="forms">+${extra} form${extra === 1 ? '' : 's'}</span>`
      : '';

    const cls = ['slot', banned ? 'banned' : '', hidden ? 'hidden-slot' : '',
      selectable ? 'clickable' : ''].filter(Boolean).join(' ');
    const inner = hidden
      ? '<span class="ph">?</span>'
      : `${thumbHtml(it, pill)}
         <span class="slot-name">${esc(nameOfId(id))}</span>`;

    if (selectable) {
      return `<button class="${cls}" data-act="setBan" data-id="${esc(id)}" data-on="${banned ? '0' : '1'}">${inner}</button>`;
    }
    return `<div class="${cls}"${hidden ? '' : ` data-id="${esc(id)}"`}>${inner}</div>`;
  }

  function panel(seat, r) {
    const ui = A.ui;
    const me = ui.seat === seat;
    const s = r.seats[seat];
    const bring = r.bring[seat] || [];
    const order = ui.seat === 'p2' ? (seat === 'p2' ? 1 : 2) : (seat === 'p1' ? 1 : 2);

    let slots = '';
    for (let i = 0; i < r.cfg.bring; i++) {
      slots += bring[i]
        ? slotHtml(seat, r, bring[i], i)
        : '<div class="slot empty"></div>';
    }

    let foot = '';
    if (r.phase === P.BRING) {
      foot = me
        ? (r.confirmed[seat] ? 'Locked in · waiting for the opponent' : `Picked ${bring.length}/${r.cfg.bring}`)
        : (ui.seat ? 'Picking… picks stay hidden until both confirm' : 'Picking…');
    } else if (r.phase === P.BAN) {
      const bans = (r.bansBy[D.other(seat)] || []).length;
      foot = `${D.remaining(r, seat).length} left${bans ? ` · ${bans} banned` : ''}` +
        (r.confirmed[seat] ? ' · locked in' : '');
    } else if (r.phase === P.DONE) {
      foot = `${D.remaining(r, seat).length} Aniimo remaining`;
    }

    const active = (r.phase === P.BRING && me) ||
      (r.phase === P.BAN && ui.seat && D.other(ui.seat) === seat);

    return `<div class="panel ${seat} ${me ? 'me' : ''} ${active ? 'active' : ''}" style="order:${order}">
      <div class="panel-head">
        <h2>Player ${seat === 'p1' ? 1 : 2}</h2>
        ${me ? '<span class="you">YOU</span>' : ''}
        <span class="who">${s ? esc(s.name) : '—'}</span>
        <span class="count">${bring.length}/${r.cfg.bring}</span>
      </div>
      ${r.phase === P.BAN && ui.seat === D.other(seat)
        ? '<div class="ban-hint">Click a card to ban it</div>' : ''}
      <div class="slots">${slots}</div>
      <div class="panel-foot">${foot}</div>
    </div>`;
  }

  function visiblePool() {
    const ui = A.ui;
    const f = ui.elFilter;
    const q = String(ui.q || '').trim().toLowerCase();
    const stage = ui.stage;
    if (!f.length && !q && !stage) return ui.pool;

    return ui.pool.filter((id) => {
      const it = itemOf(id);
      if (stage && Number(it && it.stage) !== stage) return false;
      if (q && String(it ? it.name : id).toLowerCase().indexOf(q) === -1) return false;
      if (!f.length) return true;
      return typesOf(it).some((e) => f.indexOf(e) !== -1);
    });
  }

  /** Pool counter line, shared by the lobby and the draft. */
  function poolMeta(r) {
    const ui = A.ui;
    const seat = ui.seat;
    let meta;
    if (!seat) meta = 'Spectating';
    else if (r.phase === P.BRING) {
      const max = D.need(r, { pool: ui.pool });
      meta = `<b>${Math.max(0, max - (r.bring[seat] || []).length)}</b> left to pick`;
    } else meta = `<b>${ui.pool.length}</b> in pool`;

    const shown = visiblePool().length;
    if (shown !== ui.pool.length) meta += ` · <b>${shown}</b> shown`;
    return meta;
  }

  function stageChips() {
    const ui = A.ui;
    const seen = [];
    for (const id of ui.pool) {
      const s = Number(itemOf(id) && itemOf(id).stage) || 0;
      if (s && seen.indexOf(s) === -1) seen.push(s);
    }
    seen.sort((a, b) => a - b);
    return seen.map((s) => `<button class="fchip num ${ui.stage === s ? 'on' : ''}"
      data-act="filterStage" data-stage="${s}" title="Stage ${s}">${s}</button>`).join('');
  }

  function filtersBar() {
    const ui = A.ui;
    const f = ui.elFilter;
    const chips = EL_ORDER.map((id) => {
      const on = f.indexOf(id) !== -1;
      return `<button class="fchip ${on ? 'on' : ''}" data-act="filterEl" data-el="${id}">
        ${elementBadge(id)} ${esc(A.ELEMENTS[id].label)}
      </button>`;
    }).join('');

    return `<div class="filters">
      <div class="search-row">
        <div class="search">
          <svg class="s-ico" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="10.5" cy="10.5" r="6.5"></circle>
            <path d="M20 20l-4.6-4.6"></path>
          </svg>
          <input id="q" type="search" autocomplete="off" spellcheck="false" aria-label="Search Aniimo by name"
                 placeholder="Search Aniimo by name" value="${esc(ui.q)}">
          <button class="s-clear" data-act="clearQ" aria-label="Clear search" ${ui.q ? '' : 'disabled'}>×</button>
        </div>
      </div>
      <div class="filter-row">
        <span class="filter-label">Elements:</span>
        <button class="fchip ${f.length ? '' : 'on'}" data-act="filterEl" data-el="">All</button>
        ${chips}
      </div>
      <div class="filter-row">
        <span class="filter-label">Stage:</span>
        <button class="fchip num ${ui.stage ? '' : 'on'}" data-act="filterStage" data-stage="">All</button>
        ${stageChips()}
      </div>
    </div>`;
  }

  function poolCard(id, o) {
    o = o || {};
    const it = itemOf(id) || { id: id, name: id, types: [] };
    const idx = A.ui.pool.indexOf(id);
    const clickable = !!o.action;
    const cls = ['card', o.picked ? 'picked' : '', o.dim ? 'dim' : ''].filter(Boolean).join(' ');
    const extra = formsOf(it).length;
    const pill = extra
      ? `<span class="forms-pill" data-act="forms">+${extra} form${extra === 1 ? '' : 's'}</span>`
      : '';

    /* Non-interactive cards are plain divs: a disabled <button> would swallow
       the pointer events used by the "other forms" popover. */
    const tag = clickable ? 'button' : 'div';
    const act = clickable ? ` data-act="${o.action}" data-on="${o.picked ? '0' : '1'}"` : '';

    return `<${tag} class="${cls}" data-id="${esc(id)}"${act}>
      <span class="no">${esc(noLabel(it, idx))}</span>
      ${thumbHtml(it, pill)}
      <span class="nm">${esc(it.name)}</span>
    </${tag}>`;
  }

  function poolList(o) {
    o = o || {};
    const picked = o.picked || [];
    const ids = visiblePool();
    if (!ids.length) return '<div class="empty-note">No Aniimo match these filters.</div>';
    return ids.map((id) => poolCard(id, {
      action: o.action,
      dim: o.dim,
      picked: picked.indexOf(id) !== -1,
    })).join('');
  }

  function poolSection(r) {
    const ui = A.ui;
    const seat = ui.seat;
    const mine = seat ? r.bring[seat] : [];
    const canPick = !!seat && r.phase === P.BRING && !r.confirmed[seat];

    return `<section class="stage">
      <div class="box-head">
        <h3>Aniimo Pool</h3>
        <span class="left" id="poolMeta">${poolMeta(r)}</span>
      </div>
      ${filtersBar()}
      <div class="pool">${poolList({
        picked: mine,
        action: canPick ? 'pickBring' : '',
        dim: !canPick,
      })}</div>
    </section>`;
  }

  /** Re-render just the pool (keeps the search box focused while typing). */
  function renderPool() {
    const r = A.ui.room;
    const box = document.querySelector('.pool');
    hideFormsTip(true);
    if (!r || !box) return;
    const seat = A.ui.seat;
    const canPick = !!seat && r.phase === P.BRING && !r.confirmed[seat];
    box.innerHTML = poolList({
      picked: seat ? (r.bring[seat] || []) : [],
      action: canPick ? 'pickBring' : '',
      dim: !canPick,
    });
    markLoaded(box);
    const meta = document.getElementById('poolMeta');
    if (meta) meta.innerHTML = poolMeta(r);
  }

  /* ------------------------ action bar ------------------------ */

  function actions(r) {
    const ui = A.ui;
    const seat = ui.seat;
    const isHost = seat === r.host;
    let status = '';
    let btns = '';

    if (r.phase === P.LOBBY) {
      const both = !!(r.seats.p1 && r.seats.p2);
      const ready = both && r.seats.p1.ready && r.seats.p2.ready;
      const mine = seat ? r.seats[seat] : null;
      const iAmReady = !!(mine && mine.ready);
      if (!both) status = 'Share the room code — waiting for the second player.';
      else if (ready) status = 'Both players are ready.';
      else {
        const who = !r.seats.p1.ready ? r.seats.p1.name : r.seats.p2.name;
        status = `Waiting for <b>${esc(who)}</b> to get ready.`;
      }
      if (mine) {
        btns += `<button class="btn lg ${iAmReady ? 'ghost' : 'primary'}" data-act="ready"
          data-on="${iAmReady ? '0' : '1'}">${iAmReady ? 'Cancel ready' : "I'm ready"}</button>`;
      }
      if (isHost) {
        btns += `<button class="btn lg primary" data-act="start" ${ready ? '' : 'disabled'}>Start draft</button>`;
      }
    } else if (r.phase === P.BRING) {
      const max = D.need(r, { pool: ui.pool });
      const mine = seat ? r.bring[seat] : [];
      if (!seat) status = 'You are spectating this room.';
      else if (r.confirmed[seat]) status = 'Picks locked. Waiting for the opponent…';
      else status = `Pick <b>${max}</b> Aniimo — <b>${max - mine.length}</b> left.`;
      if (seat) {
        if (r.confirmed[seat]) {
          btns = `<button class="btn ghost" data-act="cancelConfirm">Undo</button>`;
        } else {
          btns = `<button class="btn primary lg" data-act="confirmBring" ${mine.length === max ? '' : 'disabled'}>
            Confirm picks (${mine.length}/${max})</button>`;
        }
      }
    } else if (r.phase === P.BAN) {
      const left = seat ? D.bansLeft(r, seat) : 0;
      if (!seat) status = 'You are spectating this room.';
      else if (r.confirmed[seat]) status = 'Bans locked. Waiting for the opponent…';
      else status = left
        ? `Ban up to <b>${r.cfg.banEach}</b> of the opponent's picks — <b>${left}</b> left.`
        : 'No bans left — confirm to finish.';
      if (seat) {
        if (r.confirmed[seat]) {
          btns = `<button class="btn ghost" data-act="cancelConfirm">Undo</button>`;
        } else {
          btns = `<button class="btn primary lg" data-act="confirmBan">Confirm bans (${(r.bansBy[seat] || []).length}/${r.cfg.banEach})</button>`;
        }
      }
    } else if (r.phase === P.DONE) {
      status = 'Draft complete — 6 Aniimo remain for each side.';
      btns = `<button class="btn" data-act="copyResult">Copy result</button>`;
      if (isHost) btns += `<button class="btn primary" data-act="reset">New match</button>`;
    }

    return `<div class="actions"><div class="status">${status}</div>${btns}</div>`;
  }

  /* -------------------------- result ------------------------- */

  function resultSide(seat, r) {
    const all = r.bring[seat] || [];
    const banned = r.bansBy[D.other(seat)] || [];
    const keep = D.remaining(r, seat);
    return `<div class="res-side ${seat}">
      <div class="res-head">
        <h3>Player ${seat === 'p1' ? 1 : 2} · ${esc(nameOf(r, seat))}</h3>
        <span>${keep.length} remaining</span>
      </div>
      <div class="res-list">${all.map((id) => {
        const it = itemOf(id) || { id: id, name: id, types: [] };
        const b = banned.indexOf(id) !== -1;
        return `<div class="res-item ${b ? 'banned' : ''}" title="${b ? 'Banned' : 'Available'}">
          ${thumbHtml(it)}
          <span>${esc(it.name)}</span>
        </div>`;
      }).join('')}</div>
      <div class="res-keep">${keep.map(nameOfId).map(esc).join(' · ')}</div>
    </div>`;
  }

  function resultSection(r) {
    return `<section class="card-box result">
      <div class="box-head">
        <h3>Final line-up</h3>
        <span class="left">Struck-out cards were banned</span>
      </div>
      ${resultSide('p1', r)}${resultSide('p2', r)}
    </section>`;
  }

  function roomView() {
    const r = A.ui.room;
    return `<div class="wrap">
      ${topbar(r)}
      ${r.phase === P.LOBBY
        ? lobby(r)
        : `<div class="board">${panel('p1', r)}${panel('p2', r)}</div>`}
      ${r.phase === P.BRING ? poolSection(r) : ''}
      ${r.phase === P.DONE ? resultSection(r) : ''}
      ${actions(r)}
      ${A.ui.cfgOpen ? cfgSheet(r) : ''}
    </div>`;
  }

  /* -------------------------- paint -------------------------- */

  function paint() {
    const ui = A.ui;
    hideFormsTip(true);
    const html =
      ui.view === 'landing' ? landing() :
      ui.view === 'missing' ? missing() :
      ui.view === 'room' ? roomView() :
      '<div class="wrap"><p class="loading">Loading…</p></div>';

    const app = document.getElementById('app');
    if (app) {
      app.innerHTML = html;
      markLoaded(app);
    }
  }

  /** Cached images may be complete before the onload attribute fires. */
  function markLoaded(root) {
    root.querySelectorAll('.thumb img').forEach((img) => {
      if (img.complete && img.naturalWidth) {
        const th = img.closest('.thumb');
        if (th) th.classList.add('loaded');
      }
    });
  }

  /* -------------------------- events ------------------------- */

  function onClick(e) {
    const el = e.target.closest('[data-act]');
    if (!el) return;
    const act = el.dataset.act;
    const ui = A.ui;

    switch (act) {
      case 'create': A.createRoom(); break;
      case 'join': A.joinFromInput(); break;
      case 'home': location.hash = ''; break;
      case 'copy': A.copyCode(); break;
      case 'ready': A.send({ type: 'ready', on: el.dataset.on === '1' }); break;
      case 'start': A.send({ type: 'start' }); break;
      case 'cfgOpen':
        ui.cfgOpen = true;
        paint();
        break;
      case 'cfgClose':
        ui.cfgOpen = false;
        paint();
        break;
      case 'pickBring': A.send({ type: 'setBring', id: el.dataset.id, on: el.dataset.on === '1' }); break;
      case 'setBan': A.send({ type: 'setBan', id: el.dataset.id, on: el.dataset.on === '1' }); break;
      case 'confirmBring': A.send({ type: 'confirmBring' }); break;
      case 'confirmBan': A.send({ type: 'confirmBan' }); break;
      case 'cancelConfirm': A.send({ type: 'cancelConfirm' }); break;
      case 'filterEl': {
        const id = el.dataset.el;
        if (!id) ui.elFilter = [];
        else {
          const i = ui.elFilter.indexOf(id);
          if (i >= 0) ui.elFilter.splice(i, 1);
          else ui.elFilter.push(id);
        }
        paint();
        break;
      }
      case 'filterStage': {
        const s = Number(el.dataset.stage) || 0;
        ui.stage = ui.stage === s ? 0 : s;
        paint();
        break;
      }
      case 'clearQ': {
        ui.q = '';
        const input = document.getElementById('q');
        if (input) { input.value = ''; input.focus(); }
        el.disabled = true;
        renderPool();
        break;
      }
      case 'forms': {
        const card = el.closest('.card, .slot[data-id]');
        if (!card) break;
        /* hover shows it; the tag pins it, a second tap closes it */
        if (tipCard === card && tipPinned) hideFormsTip(true);
        else showFormsTip(card, true);
        break;
      }
      case 'copyResult':
        if (ui.room) copyText(A.UI.summaryText(ui.room));
        break;
      case 'reset':
        if (confirm('Clear this match and go back to the lobby?')) {
          A.send({ type: 'reset' });
        }
        break;
    }
  }

  function bind() {
    document.addEventListener('click', onClick);

    /* extra forms: hover shows the popover, the "+N forms" pill pins it */
    const canHover = window.matchMedia ? window.matchMedia('(hover: hover)').matches : true;

    document.addEventListener('pointerover', (e) => {
      if (!canHover || e.pointerType === 'touch') return;
      const host = tipHost(e.target);
      if (!host || host.contains(e.relatedTarget)) return;
      showFormsTip(host, false);
    });

    document.addEventListener('pointerout', (e) => {
      const host = tipHost(e.target);
      if (!host || host.contains(e.relatedTarget)) return;
      hideFormsTip(false);
    });

    document.addEventListener('click', (e) => {
      if (e.target.closest && e.target.closest('.forms-pill')) return;
      hideFormsTip(true);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      hideFormsTip(true);
      if (A.ui.cfgOpen) {
        A.ui.cfgOpen = false;
        paint();
      }
    });

    window.addEventListener('scroll', () => hideFormsTip(true), { passive: true, capture: true });
    window.addEventListener('resize', () => hideFormsTip(true));

    document.addEventListener('input', (e) => {
      if (e.target.id === 'q') {
        A.ui.q = e.target.value;
        const clear = document.querySelector('.s-clear');
        if (clear) clear.disabled = !A.ui.q;
        renderPool();
        return;
      }
      if (e.target.id === 'name') {
        A.ui.name = e.target.value;
        if (A.prefs) A.prefs.set('abp:name', A.ui.name);
        else try { localStorage.setItem('abp:name', A.ui.name); } catch (err) { /* ignore */ }
        if (A.ui.nameErr && e.target.value.trim()) {
          A.ui.nameErr = '';
          e.target.classList.remove('invalid');
          const box = document.getElementById('nameErr');
          if (box) box.remove();
        }
      }
    });

    /* Match settings: keep "picks - bans >= 6" by adjusting the other value. */
    document.addEventListener('change', (e) => {
      const t = e.target;
      const r = A.ui.room;
      if (!t || !t.dataset || !t.dataset.cfg || !r) return;

      const next = { bring: r.cfg.bring, banEach: r.cfg.banEach };
      const v = Math.round(Number(t.value));
      if (!Number.isFinite(v)) {
        t.value = next[t.dataset.cfg];
        return;
      }
      if (t.dataset.cfg === 'bring') {
        next.bring = Math.min(12, Math.max(MIN_KEEP, v));
        next.banEach = Math.min(next.banEach, next.bring - MIN_KEEP);
      } else {
        next.banEach = Math.min(6, Math.max(0, v));
        next.bring = Math.max(next.bring, next.banEach + MIN_KEEP);
      }

      const bringEl = document.querySelector('[data-cfg="bring"]');
      const banEl = document.querySelector('[data-cfg="banEach"]');
      if (bringEl) bringEl.value = next.bring;
      if (banEl) banEl.value = next.banEach;

      A.send({ type: 'config', cfg: next });
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || !e.target) return;
      if (e.target.id === 'code') A.joinFromInput();
      if (e.target.id === 'name') {
        if (A.ui.pendingCode) A.joinFromInput();
        else A.createRoom();
      }
    });
  }

  A.UI = {
    paint: paint,
    bind: bind,
    toast: toast,
    copyText: copyText,
    setManifest: function (data) {
      A.ui.manifest = data;
      A.ui.byId = {};
      const items = Array.isArray(data) ? data : (data && data.items) || [];
      for (const it of items) A.ui.byId[it.id] = it;
      A.ui.pool = items.map((it) => it.id);
    },
    summaryText: function (r) {
      const line = (seat) => {
        const keep = D.remaining(r, seat).map(nameOfId);
        const bans = (r.bansBy[D.other(seat)] || []).map(nameOfId);
        return `Player ${seat === 'p1' ? 1 : 2} (${nameOf(r, seat)}): ${keep.join(', ')}` +
          (bans.length ? ` | banned: ${bans.join(', ')}` : '');
      };
      return `ANIIMO BAN/PICK #${r.code}\n${line('p1')}\n${line('p2')}`;
    },
  };
})();
