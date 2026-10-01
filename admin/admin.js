/* Admin page. No libraries, no inline script (the page's CSP forbids it). All customer data is rendered with
   textContent / DOM nodes, never innerHTML, so nothing a customer typed can run as markup or script. */
(function () {
  const $ = (id) => document.getElementById(id);
  const API = '/api/forms?admin=';

  const state = { data: null, timer: null, tick: null };

  // ---------- tiny DOM helpers ----------
  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  const safeHttps = (u) => typeof u === 'string' && /^https:\/\/[^\s]+$/.test(u);

  function setStatus(text, isError) {
    const s = $('status');
    s.textContent = text || '';
    s.hidden = !text;
    s.classList.toggle('is-error', !!isError);
  }

  async function api(route, options) {
    const res = await fetch(API + route, Object.assign({ credentials: 'same-origin', cache: 'no-store' }, options));
    let body = null;
    try { body = await res.json(); } catch (e) { /* not JSON */ }
    return { status: res.status, ok: res.ok, body };
  }

  // ---------- views ----------
  function showLogin(message) {
    stopTimers();
    state.data = null;
    ['next', 'upcoming', 'past', 'cancelled', 'bk-grid', 'bk-day', 'bk-review', 'bk-list'].forEach((id) => clear($(id))); // drop any rendered data
    bk.data = null; bk.selected = null; bk.pending = null;
    $('blocks-ui').hidden = true; $('bk-day').hidden = true; $('bk-review').hidden = true; $('blocks-notice').hidden = true;
    $('dashboard').hidden = true;
    $('logout').hidden = true;
    $('login').hidden = false;
    setStatus('');
    const err = $('login-error');
    err.hidden = !message;
    err.textContent = message || '';
    $('password').focus();
  }

  function showDashboard() {
    $('login').hidden = true;
    $('dashboard').hidden = false;
    $('logout').hidden = false;
    setStatus('');
  }

  // ---------- rendering ----------
  function row(dl, label, value, opts) {
    if (value === null || value === undefined || value === '') return;
    dl.appendChild(el('dt', null, label));
    const dd = el('dd');
    if (opts && opts.href) {
      const a = el('a', null, value);
      a.href = opts.href;
      if (opts.external) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
      dd.appendChild(a);
    } else {
      dd.textContent = value;
      if (opts && opts.className) dd.className = opts.className;
    }
    dl.appendChild(dd);
  }

  function sessionCard(s, kind) {
    const card = el('article', 's-card' + (kind === 'cancelled' ? ' is-cancelled' : '') + (kind === 'next' ? ' is-next' : ''));

    const head = el('div', 's-head');
    const cm = s.chiangMai;
    head.appendChild(el('div', 's-when', cm ? `${cm.day} · ${cm.clock}` : 'Time unknown'));
    head.appendChild(el('div', 's-ref', s.reference));
    card.appendChild(head);

    const local = el('p', 's-local');
    local.appendChild(document.createTextNode('Chiang Mai time (GMT+7)'));
    card.appendChild(local);
    if (s.customerLocal) {
      const cl = el('p', 's-local', `Customer: ${s.customerLocal.day} · ${s.customerLocal.clock} `);
      cl.appendChild(el('span', 'tz', `(${s.customerLocal.label} · ${s.customerLocal.timeZone})`));
      card.appendChild(cl);
    } else {
      card.appendChild(el('p', 's-local', 'Customer timezone: not recorded'));
    }

    if (kind === 'next') {
      const cd = el('p', 's-countdown');
      cd.dataset.start = s.startsAt;
      cd.dataset.end = s.endsAt;
      card.appendChild(cd);
    }

    const dl = el('dl', 's-grid');
    row(dl, 'name', `${s.firstName || ''} ${s.lastName || ''}`.trim());
    row(dl, 'email', s.email, { href: 'mailto:' + s.email });
    row(dl, 'phone', s.phone);
    row(dl, 'notes', s.notes, { className: 's-notes' });
    if (safeHttps(s.callLink)) row(dl, 'call link', s.callLink, { href: s.callLink, external: true });
    else row(dl, 'call link', s.callLink);
    row(dl, 'paid', s.amount && s.amount.display);
    if (kind === 'cancelled' && s.refund) {
      row(dl, 'refund', s.refund.refunded ? (s.refund.display || 'refunded') : 'no refund');
    }
    row(dl, 'booked', formatStamp(s.createdAt));
    if (kind === 'cancelled') row(dl, 'cancelled', formatStamp(s.updatedAt));
    card.appendChild(dl);

    if (s.calendarSyncFailed) card.appendChild(el('span', 's-flag', 'calendar sync failed'));
    return card;
  }

  function formatStamp(iso) {
    const d = new Date(iso);
    if (isNaN(d)) return null;
    return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  }

  function renderList(container, items, kind, emptyText, groupByDate) {
    clear(container);
    if (!items.length) { container.appendChild(el('p', 'empty', emptyText)); return; }
    let lastDate = null;
    items.forEach((s) => {
      if (groupByDate && s.chiangMai && s.chiangMai.date !== lastDate) {
        lastDate = s.chiangMai.date;
        container.appendChild(el('div', 'date-head', s.chiangMai.day));
      }
      container.appendChild(sessionCard(s, kind));
    });
  }

  function render(data) {
    state.data = data;
    const { upcoming, past, cancelled } = data;
    $('up-count').textContent = `(${upcoming.length})`;
    $('past-count').textContent = `(${past.length})`;
    $('cancelled-count').textContent = `(${cancelled.length})`;

    const next = $('next');
    clear(next);
    if (upcoming.length) next.appendChild(sessionCard(upcoming[0], 'next'));
    else next.appendChild(el('p', 'empty', 'Nothing booked yet.'));

    renderList($('upcoming'), upcoming, 'upcoming', 'No upcoming sessions.', true);
    renderList($('past'), past, 'past', 'No past sessions.', false);
    renderList($('cancelled'), cancelled, 'cancelled', 'No cancelled bookings.', false);
    $('updated').textContent = 'Updated ' + new Date().toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' }) + '.';
    showDashboard();
    startTimers();
    updateCountdown();
    loadBlocks();
  }

  // ---------- countdown ----------
  function countdownText(startMs, endMs, now) {
    if (now >= endMs) return 'Finished';
    if (now >= startMs) return `In progress now - ends in ${Math.max(1, Math.ceil((endMs - now) / 60000))}m`;
    let s = Math.floor((startMs - now) / 1000);
    const d = Math.floor(s / 86400); s -= d * 86400;
    const h = Math.floor(s / 3600); s -= h * 3600;
    const m = Math.floor(s / 60); s -= m * 60;
    if (d > 0) return `Starts in ${d}d ${h}h ${m}m`;
    if (h > 0) return `Starts in ${h}h ${m}m`;
    return `Starts in ${m}m ${String(s).padStart(2, '0')}s`;
  }
  function updateCountdown() {
    const n = document.querySelector('.s-countdown');
    if (!n) return;
    n.textContent = countdownText(Date.parse(n.dataset.start), Date.parse(n.dataset.end), Date.now());
  }
  function startTimers() {
    stopTimers();
    state.tick = setInterval(updateCountdown, 1000);
    state.timer = setInterval(load, 5 * 60 * 1000); // refresh the data every 5 minutes
  }
  function stopTimers() {
    if (state.tick) clearInterval(state.tick);
    if (state.timer) clearInterval(state.timer);
    state.tick = state.timer = null;
  }

  // =====================================================================
  // Blocked times (the only part of this page that writes). All text via textContent; dates are Chiang Mai dates.
  // =====================================================================
  const bk = { data: null, y: 0, m: 0, selected: null, pending: null, busy: false };
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const pad2 = (n) => String(n).padStart(2, '0');
  const isoOf = (y, m, d) => `${y}-${pad2(m + 1)}-${pad2(d)}`;
  const longDay = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  const shortDay = (iso) => new Date(iso + 'T00:00:00Z').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
  function slotLabel(hhmm) { const [h, m] = hhmm.split(':').map(Number); return `${((h + 11) % 12) + 1}:${pad2(m)} ${h >= 12 ? 'PM' : 'AM'}`; }

  async function send(route, method, body) {
    return api(route, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  }

  // Shared handling for the failure cases every blocks call can hit. Returns true if it handled the response.
  function handleBlockFailure(r, errorNode) {
    if (r.status === 401) { showLogin(); return true; }
    if (r.body && r.body.code === 'MIGRATION_REQUIRED') { showBlocksNotice(r.body.error, true); return true; }
    if (!r.ok) {
      const msg = (r.body && r.body.error) || 'Something went wrong. Nothing was changed.';
      if (errorNode) { errorNode.textContent = msg; errorNode.hidden = false; } else showBlocksNotice(msg, true);
      return true;
    }
    return false;
  }

  function showBlocksNotice(text, hideUi) {
    const n = $('blocks-notice');
    n.textContent = text || '';
    n.hidden = !text;
    if (hideUi) $('blocks-ui').hidden = true;
  }

  async function loadBlocks() {
    try {
      const r = await api('blocks');
      if (handleBlockFailure(r)) return;
      const first = !bk.data;
      bk.data = r.body;
      if (first) { bk.y = +r.body.today.slice(0, 4); bk.m = +r.body.today.slice(5, 7) - 1; buildRangeForm(); }
      showBlocksNotice('');
      $('blocks-ui').hidden = false;
      renderBlocks();
    } catch (e) {
      showBlocksNotice('Network problem loading blocked times.', true);
    }
  }

  const blocksOn = (date) => (bk.data ? bk.data.blocks.filter((b) => b.date === date) : []);
  const sessionsOn = (date) => (state.data ? state.data.upcoming.filter((s) => s.chiangMai && s.chiangMai.date === date) : []);

  function renderBlocks() {
    renderBlockCalendar();
    renderBlockList();
    if (bk.selected) renderDayPanel(); else $('bk-day').hidden = true;
  }

  function renderBlockCalendar() {
    const { today, maxDate } = bk.data;
    $('bk-month').textContent = `${MONTHS[bk.m]} ${bk.y}`;
    const dow = $('bk-dow');
    if (!dow.firstChild) WEEKDAYS.forEach((d) => dow.appendChild(el('div', null, d)));
    const grid = $('bk-grid');
    clear(grid);
    const first = new Date(Date.UTC(bk.y, bk.m, 1)).getUTCDay();
    const days = new Date(Date.UTC(bk.y, bk.m + 1, 0)).getUTCDate();
    for (let i = 0; i < first; i++) grid.appendChild(el('div', 'cal-cell empty'));
    for (let d = 1; d <= days; d++) {
      const iso = isoOf(bk.y, bk.m, d);
      const cell = el('button', 'cal-cell bk-cell', String(d));
      cell.type = 'button';
      const blocks = blocksOn(iso);
      const whole = blocks.some((b) => !b.startTime);
      const cls = [];
      if (iso < today) cls.push('past');
      else if (iso > maxDate) cls.push('closed');
      if (iso === today) cls.push('today');
      if (whole) cls.push('bk-blocked'); else if (blocks.length) cls.push('bk-partial');
      if (sessionsOn(iso).length) cls.push('bk-session');
      if (bk.selected === iso) cls.push('selected');
      cell.className = 'cal-cell bk-cell ' + cls.join(' ');
      const label = longDay(iso) + (whole ? ', blocked' : blocks.length ? ', some slots blocked' : '');
      cell.setAttribute('aria-label', label);
      if (iso < today || iso > maxDate) cell.disabled = true;
      else cell.addEventListener('click', () => { bk.selected = iso; hideReview(); renderBlocks(); });
      grid.appendChild(cell);
    }
    const nowYM = +today.slice(0, 4) * 12 + (+today.slice(5, 7) - 1);
    const maxYM = +maxDate.slice(0, 4) * 12 + (+maxDate.slice(5, 7) - 1);
    $('bk-prev').disabled = bk.y * 12 + bk.m <= nowYM;
    $('bk-next').disabled = bk.y * 12 + bk.m >= maxYM;
  }

  // ----- the day panel: tap a day, then block the whole day / chosen slots, or unblock -----
  function renderDayPanel() {
    const panel = $('bk-day');
    clear(panel);
    panel.hidden = false;
    const date = bk.selected;
    const blocks = blocksOn(date);
    const wholeBlock = blocks.find((b) => !b.startTime);
    const sessions = sessionsOn(date);

    panel.appendChild(el('h3', 'admin-h3', longDay(date)));
    if (wholeBlock) {
      const row = el('div', 'bk-line is-blocked');
      row.appendChild(el('span', null, 'Whole day blocked' + (wholeBlock.reason ? ` — ${wholeBlock.reason}` : '')));
      const b = el('button', 'admin-link', 'Unblock whole day'); b.type = 'button';
      b.addEventListener('click', () => removeBlocks([wholeBlock.id], `Unblock ${longDay(date)}?`));
      row.appendChild(b);
      panel.appendChild(row);
    }

    const list = el('div', 'bk-slotlist');
    const checks = [];
    bk.data.slotTimes.forEach((t) => {
      const blocked = blocks.find((b) => b.startTime === t);
      const booked = sessions.filter((s) => s.chiangMai.time === t);
      const row = el('label', 'bk-slot' + (blocked || wholeBlock ? ' is-blocked' : ''));
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.value = t;
      cb.disabled = !!(blocked || wholeBlock);
      checks.push(cb);
      row.appendChild(cb);
      row.appendChild(el('span', 'bk-slot-time', slotLabel(t)));
      let note = 'open';
      if (wholeBlock) note = 'blocked (whole day)';
      else if (blocked) note = 'blocked' + (blocked.reason ? ` — ${blocked.reason}` : '');
      row.appendChild(el('span', 'bk-slot-note', note));
      booked.forEach((s) => row.appendChild(el('span', 's-flag is-ok', `booked: ${s.firstName || ''} ${s.lastName || ''} (${s.reference})`.replace(/\s+/g, ' '))));
      if (blocked && !wholeBlock) {
        const u = el('button', 'admin-link', 'Unblock'); u.type = 'button';
        u.addEventListener('click', (e) => { e.preventDefault(); removeBlocks([blocked.id], `Unblock ${slotLabel(t)} on ${longDay(date)}?`); });
        row.appendChild(u);
      }
      list.appendChild(row);
    });
    panel.appendChild(list);

    const reasonLabel = el('label', 'admin-label', 'Reason (private, optional)'); reasonLabel.setAttribute('for', 'bk-day-reason');
    const reason = el('input', 'bk-input'); reason.id = 'bk-day-reason'; reason.type = 'text'; reason.maxLength = 200; reason.autocomplete = 'off';
    panel.appendChild(reasonLabel); panel.appendChild(reason);

    const err = el('p', 'admin-error'); err.hidden = true; err.setAttribute('role', 'alert');
    const actions = el('div', 'bk-actions');
    const wholeBtn = el('button', 'admin-btn', 'Block whole day'); wholeBtn.type = 'button'; wholeBtn.disabled = !!wholeBlock;
    wholeBtn.addEventListener('click', () => beginReview({ date, wholeDay: true, reason: reason.value }, err));
    const slotsBtn = el('button', 'admin-btn is-outline', 'Block selected slots'); slotsBtn.type = 'button';
    slotsBtn.addEventListener('click', () => {
      const chosen = checks.filter((c) => c.checked).map((c) => c.value);
      if (!chosen.length) { err.textContent = 'Tick at least one open slot first.'; err.hidden = false; return; }
      beginReview({ date, slots: chosen, reason: reason.value }, err);
    });
    slotsBtn.disabled = !!wholeBlock || checks.every((c) => c.disabled);
    actions.appendChild(wholeBtn); actions.appendChild(slotsBtn);
    panel.appendChild(actions); panel.appendChild(err);
  }

  // ----- review step: shows exactly what will happen, and which EXISTING bookings/holds are affected -----
  function hideReview() { bk.pending = null; const r = $('bk-review'); r.hidden = true; clear(r); }

  async function beginReview(request, errorNode) {
    if (bk.busy) return;
    if (errorNode) errorNode.hidden = true;
    const body = Object.assign({}, request);
    if (typeof body.reason === 'string' && !body.reason.trim()) delete body.reason;
    bk.busy = true;
    try {
      const r = await send('block-preview', 'POST', body);
      if (handleBlockFailure(r, errorNode)) return;
      bk.pending = body;
      renderReview(body, r.body);
    } catch (e) {
      if (errorNode) { errorNode.textContent = 'Network problem. Nothing was changed.'; errorNode.hidden = false; }
    } finally { bk.busy = false; }
  }

  function describeRequest(b) {
    const when = b.date ? longDay(b.date) : (b.from === b.to ? longDay(b.from) : `${shortDay(b.from)} to ${shortDay(b.to)}`);
    const what = b.wholeDay ? 'the whole day' : b.slots.map(slotLabel).join(', ');
    const days = b.weekdays && b.weekdays.length < 7 ? ` (only ${b.weekdays.map((d) => WEEKDAYS[d]).join(', ')})` : '';
    return `${when}${days}: ${what}`;
  }

  function renderReview(body, preview) {
    const box = $('bk-review');
    clear(box);
    box.hidden = false;
    box.appendChild(el('h3', 'admin-h3', 'Review before blocking'));
    box.appendChild(el('p', 'bk-summary', describeRequest(body)));
    if (body.reason) box.appendChild(el('p', 'bk-reason', `Reason: ${body.reason}`));
    const s = preview.summary;
    box.appendChild(el('p', 'admin-note', `${s.rowsToAdd} new block${s.rowsToAdd === 1 ? '' : 's'}` + (s.alreadyBlocked ? `, ${s.alreadyBlocked} already blocked` : '') + (s.coveredByWholeDay ? `, ${s.coveredByWholeDay} already covered by a whole-day block` : '') + '.'));

    const { bookings, holds } = preview.affected;
    let ack = null;
    if (bookings.length || holds.length) {
      const warn = el('div', 'bk-warning');
      warn.appendChild(el('p', 'bk-warning-title', 'Existing bookings are affected'));
      if (bookings.length) {
        warn.appendChild(el('p', 'admin-note', `${bookings.length} confirmed session${bookings.length === 1 ? '' : 's'} fall${bookings.length === 1 ? 's' : ''} in this block. They stay booked: nothing is cancelled or refunded, so contact them yourself if the time no longer works.`));
        const ul = el('ul', 'bk-affected');
        bookings.forEach((b) => ul.appendChild(el('li', null, `${shortDay(b.date)} ${slotLabel(b.time)} · ${b.name || 'no name'} · ${b.email} · ${b.reference}`)));
        warn.appendChild(ul);
      }
      if (holds.length) warn.appendChild(el('p', 'admin-note', `${holds.length} slot${holds.length === 1 ? ' is' : 's are'} being held by a customer who is checking out right now. They will not be able to pay for ${holds.length === 1 ? 'it' : 'them'} once this is blocked.`));
      const lab = el('label', 'bk-check bk-ack');
      ack = document.createElement('input'); ack.type = 'checkbox';
      lab.appendChild(ack);
      lab.appendChild(document.createTextNode(' I understand. Existing bookings are not cancelled.'));
      warn.appendChild(lab);
      box.appendChild(warn);
    }

    const err = el('p', 'admin-error'); err.hidden = true; err.setAttribute('role', 'alert');
    const actions = el('div', 'bk-actions');
    const ok = el('button', 'admin-btn', s.rowsToAdd ? 'Confirm block' : 'Nothing new to block'); ok.type = 'button'; ok.disabled = !s.rowsToAdd || !!ack;
    if (ack) ack.addEventListener('change', () => { ok.disabled = !ack.checked || !s.rowsToAdd; });
    ok.addEventListener('click', () => confirmAdd(ok, err, ack && ack.checked));
    const cancel = el('button', 'admin-btn is-outline', 'Cancel'); cancel.type = 'button';
    cancel.addEventListener('click', hideReview);
    actions.appendChild(ok); actions.appendChild(cancel);
    box.appendChild(actions); box.appendChild(err);
    box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  async function confirmAdd(button, errorNode, acknowledged) {
    if (bk.busy || !bk.pending) return;
    bk.busy = true; button.disabled = true; errorNode.hidden = true;
    try {
      const body = Object.assign({}, bk.pending, acknowledged ? { acknowledgeAffected: true } : {});
      const r = await send('blocks', 'POST', body);
      if (handleBlockFailure(r, errorNode)) { button.disabled = false; return; }
      hideReview();
      await loadBlocks();
    } catch (e) {
      errorNode.textContent = 'Network problem. Check "Current blocks" before trying again.'; errorNode.hidden = false; button.disabled = false;
    } finally { bk.busy = false; }
  }

  async function removeBlocks(ids, question) {
    if (bk.busy || !ids.length) return;
    if (!window.confirm(question)) return;
    bk.busy = true;
    try {
      for (const id of ids) {
        const r = await send('blocks&id=' + encodeURIComponent(id), 'DELETE');
        if (handleBlockFailure(r)) break;
      }
    } catch (e) {
      showBlocksNotice('Network problem. Check "Current blocks" to see what changed.');
    } finally { bk.busy = false; }
    await loadBlocks();
  }

  // ----- the list of current blocks: consecutive days with the same slot and reason are shown as one run -----
  function runsOf(blocks) {
    const groups = new Map();
    blocks.forEach((b) => { const k = `${b.startTime || 'whole'}|${b.reason || ''}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(b); });
    const runs = [];
    groups.forEach((list) => {
      list.sort((a, b) => (a.date < b.date ? -1 : 1));
      let cur = null;
      list.forEach((b) => {
        const next = cur && new Date(new Date(cur.to + 'T00:00:00Z').getTime() + 86400000).toISOString().slice(0, 10) === b.date;
        if (next) { cur.to = b.date; cur.items.push(b); }
        else { cur = { from: b.date, to: b.date, startTime: b.startTime, reason: b.reason, items: [b] }; runs.push(cur); }
      });
    });
    return runs.sort((a, b) => (a.from + (a.startTime || '')) < (b.from + (b.startTime || '')) ? -1 : 1);
  }

  function renderBlockList() {
    const box = $('bk-list');
    clear(box);
    const blocks = bk.data.blocks;
    $('bk-count').textContent = `(${blocks.length})`;
    if (!blocks.length) { box.appendChild(el('p', 'empty', 'Nothing is blocked.')); return; }
    runsOf(blocks).forEach((run) => {
      const row = el('div', 'bk-run');
      const info = el('div', 'bk-run-info');
      const when = run.from === run.to ? longDay(run.from) : `${shortDay(run.from)} – ${shortDay(run.to)} (${run.items.length} days)`;
      info.appendChild(el('div', 'bk-run-when', when));
      info.appendChild(el('div', 'bk-run-what', (run.startTime ? slotLabel(run.startTime) : 'Whole day') + (run.reason ? ` · ${run.reason}` : '')));
      row.appendChild(info);
      const rm = el('button', 'admin-link', run.items.length > 1 ? `Remove all ${run.items.length}` : 'Remove'); rm.type = 'button';
      rm.addEventListener('click', () => removeBlocks(run.items.map((b) => b.id), `Remove this block${run.items.length > 1 ? ` (${run.items.length} days)` : ''}?`));
      row.appendChild(rm);
      box.appendChild(row);
    });
  }

  // ----- range form (trips), optionally limited to some weekdays -----
  function buildRangeForm() {
    const slots = $('bk-range-slots'), days = $('bk-range-weekdays');
    if (slots.firstChild) return;
    bk.data.slotTimes.forEach((t) => {
      const lab = el('label', 'bk-check'); const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = t;
      lab.appendChild(cb); lab.appendChild(document.createTextNode(' ' + slotLabel(t))); slots.appendChild(lab);
    });
    WEEKDAYS.forEach((d, i) => {
      const lab = el('label', 'bk-check'); const cb = document.createElement('input'); cb.type = 'checkbox'; cb.value = String(i); cb.checked = true;
      lab.appendChild(cb); lab.appendChild(document.createTextNode(' ' + d)); days.appendChild(lab);
    });
    $('bk-from').min = $('bk-to').min = bk.data.today;
    $('bk-from').max = $('bk-to').max = bk.data.maxDate;
    document.querySelectorAll('input[name="bk-mode"]').forEach((r) => r.addEventListener('change', () => {
      $('bk-range-slots').hidden = document.querySelector('input[name="bk-mode"]:checked').value !== 'slots';
    }));
    $('bk-range-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const err = $('bk-range-error');
      err.hidden = true;
      const from = $('bk-from').value, to = $('bk-to').value;
      if (!from || !to) { err.textContent = 'Choose a start and end date.'; err.hidden = false; return; }
      const body = { from, to, reason: $('bk-range-reason').value };
      if (document.querySelector('input[name="bk-mode"]:checked').value === 'whole') body.wholeDay = true;
      else {
        body.slots = [...slots.querySelectorAll('input:checked')].map((c) => c.value);
        if (!body.slots.length) { err.textContent = 'Tick at least one slot.'; err.hidden = false; return; }
      }
      const wd = [...days.querySelectorAll('input:checked')].map((c) => Number(c.value));
      if (!wd.length) { err.textContent = 'Tick at least one weekday.'; err.hidden = false; return; }
      if (wd.length < 7) body.weekdays = wd;
      bk.selected = null; $('bk-day').hidden = true;
      beginReview(body, err);
    });
  }

  $('bk-prev').addEventListener('click', () => { bk.m--; if (bk.m < 0) { bk.m = 11; bk.y--; } if (bk.data) renderBlockCalendar(); });
  $('bk-next').addEventListener('click', () => { bk.m++; if (bk.m > 11) { bk.m = 0; bk.y++; } if (bk.data) renderBlockCalendar(); });

  // ---------- data ----------
  async function load() {
    try {
      const r = await api('bookings');
      if (r.status === 401) { showLogin(); return; }
      if (r.status === 503) { $('login').hidden = true; $('dashboard').hidden = true; setStatus('Admin is not configured on the server yet.', true); return; }
      if (!r.ok || !r.body) { setStatus('Could not load bookings. Try again in a moment.', true); return; }
      render(r.body);
    } catch (e) {
      setStatus('Network problem. Try again in a moment.', true);
    }
  }

  $('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('login-btn');
    const pw = $('password');
    btn.disabled = true;
    $('login-error').hidden = true;
    try {
      const r = await api('login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw.value }) });
      pw.value = '';
      if (r.ok) { setStatus('Loading…'); await load(); }
      else if (r.status === 429) showLogin('Too many attempts. Please wait a while and try again.');
      else if (r.status === 503) showLogin('Admin is not configured on the server yet.');
      else showLogin('Incorrect password.');
    } catch (err) {
      showLogin('Network problem. Try again.');
    } finally {
      btn.disabled = false;
    }
  });

  $('logout').addEventListener('click', async () => {
    try { await api('logout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch (e) { /* ignore */ }
    showLogin();
  });

  load();
})();
