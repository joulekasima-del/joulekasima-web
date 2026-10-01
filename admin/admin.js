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
    ['next', 'upcoming', 'past', 'cancelled'].forEach((id) => clear($(id))); // drop any rendered data
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
    $('updated').textContent = 'Updated ' + new Date().toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit' }) + '. Read-only.';
    showDashboard();
    startTimers();
    updateCountdown();
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
