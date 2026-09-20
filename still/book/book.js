(function () {
  const $ = (id) => document.getElementById(id);

  const QTY_MIN = 1;
  const QTY_MAX = 10;
  const PRICE_PER_SESSION = 750;

  let stripe = null;
  let elements = null;
  const stripeReady = fetch('/api/still/config')
    .then((r) => r.json())
    .then((cfg) => {
      if (cfg.stripe_publishable_key) stripe = Stripe(cfg.stripe_publishable_key);
    })
    .catch(() => {});

  const state = {
    quantity: 1,
    pickedSessions: [], // { availability_id, date, start_time, locked_until }
    holdToken: (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2)),
    monthCache: {}, // 'YYYY-M' -> { slots: [{id,date,start_time,available}], windowEnd }
    selectedDate: null,
    holdInterval: null,
    holdDeadline: null,
    paymentIntentId: null,
    fname: '', lname: '', email: '',
  };

  // ---------- Quantity selector ----------
  function renderQty() {
    $('qty-value').textContent = state.quantity;
    const total = state.quantity * PRICE_PER_SESSION;
    $('qty-total-thb').textContent = '฿' + total.toLocaleString('en-US');
    $('qty-breakdown').textContent = state.quantity + ' session' + (state.quantity > 1 ? 's' : '') + ' × ฿750';
    $('qty-minus').disabled = state.quantity <= QTY_MIN;
    $('qty-plus').disabled = state.quantity >= QTY_MAX;
    $('qty-note').textContent = state.quantity > 1
      ? `฿750 per session, flat — no discount for booking more, just less to arrange later. You'll pick a day and time for each of the ${state.quantity} sessions right here, before you pay — every one lands on the calendar with its own Meet link, nothing to come back and redeem.`
      : `฿750 per session, flat. Want more than one? Use the + above — you'll pick a time for each one before paying.`;
  }

  async function releaseHold(availabilityId) {
    await fetch('/api/still/release-hold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ availability_id: availabilityId, hold_token: state.holdToken }),
    }).catch(() => {});
  }

  $('qty-minus').addEventListener('click', async () => {
    if (state.quantity <= QTY_MIN) return;
    state.quantity--;
    if (state.pickedSessions.length > state.quantity) {
      const dropped = state.pickedSessions.splice(state.quantity);
      for (const s of dropped) {
        await releaseHold(s.availability_id);
        markSlotAvailable(s.date, s.availability_id);
      }
    }
    renderQty();
    renderPickedList();
    renderPickerPanel();
    updateContinueBtn();
  });
  $('qty-plus').addEventListener('click', () => {
    if (state.quantity >= QTY_MAX) return;
    state.quantity++;
    renderQty();
    renderPickerPanel();
    updateContinueBtn();
  });
  renderQty();

  // ---------- Calendar ----------
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON_FULL = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  function todayNormalized() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const TODAY = todayNormalized();
  let viewYear = TODAY.getFullYear();
  let viewMonth = TODAY.getMonth();

  const dowRow = $('cal-dow-row');
  DOW.forEach((d) => {
    const el = document.createElement('div');
    el.textContent = d;
    dowRow.appendChild(el);
  });

  function isoDate(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  async function fetchMonth(y, m) {
    const key = `${y}-${m + 1}`;
    if (state.monthCache[key]) return state.monthCache[key];
    const r = await fetch(`/api/still/availability?year=${y}&month=${m + 1}`);
    const data = await r.json();
    state.monthCache[key] = data;
    return data;
  }

  function markSlotAvailable(dateStr, availabilityId) {
    Object.values(state.monthCache).forEach((month) => {
      const slot = (month.slots || []).find((s) => s.id === availabilityId);
      if (slot) slot.available = true;
    });
  }
  function markSlotUnavailable(availabilityId) {
    Object.values(state.monthCache).forEach((month) => {
      const slot = (month.slots || []).find((s) => s.id === availabilityId);
      if (slot) slot.available = false;
    });
  }

  async function renderCalendar() {
    $('cal-month-label').textContent = MON_FULL[viewMonth] + ' ' + viewYear;
    const grid = $('cal-grid');
    grid.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:20px 0; color:var(--ink-faint); font-family:var(--font-mono); font-size:12px;">loading…</div>';

    const { slots, windowEnd } = await fetchMonth(viewYear, viewMonth);
    const byDate = {};
    (slots || []).forEach((s) => {
      (byDate[s.date] = byDate[s.date] || []).push(s);
    });

    grid.innerHTML = '';
    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    const startOffset = firstOfMonth.getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();

    for (let i = 0; i < startOffset; i++) {
      const empty = document.createElement('div');
      empty.className = 'cal-cell empty';
      grid.appendChild(empty);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const dateStr = isoDate(viewYear, viewMonth, day);
      const cellDate = new Date(viewYear, viewMonth, day);
      const cell = document.createElement('div');
      cell.className = 'cal-cell';
      cell.textContent = day;

      if (cellDate.getTime() === TODAY.getTime()) cell.classList.add('today');

      if (cellDate < TODAY) {
        cell.classList.add('past');
      } else if (windowEnd && dateStr > windowEnd) {
        cell.classList.add('closed');
      } else {
        const daySlots = byDate[dateStr] || [];
        const hasOpen = daySlots.some((s) => s.available);
        if (hasOpen) {
          cell.classList.add('available');
          if (state.selectedDate === dateStr) cell.classList.add('selected');
          cell.addEventListener('click', () => selectDay(dateStr, daySlots, cell));
        } else {
          cell.classList.add('full');
        }
      }
      grid.appendChild(cell);
    }

    const atCurrentMonth = viewYear === TODAY.getFullYear() && viewMonth === TODAY.getMonth();
    $('cal-prev').disabled = atCurrentMonth;
  }

  $('cal-prev').addEventListener('click', () => {
    viewMonth--;
    if (viewMonth < 0) { viewMonth = 11; viewYear--; }
    renderCalendar();
  });
  $('cal-next').addEventListener('click', () => {
    viewMonth++;
    if (viewMonth > 11) { viewMonth = 0; viewYear++; }
    renderCalendar();
  });

  function selectDay(dateStr, daySlots, cellEl) {
    document.querySelectorAll('.cal-cell.selected').forEach((c) => c.classList.remove('selected'));
    cellEl.classList.add('selected');
    state.selectedDate = dateStr;
    renderTimeGrid(daySlots);
  }

  function renderTimeGrid(daySlots) {
    const grid = $('time-grid');
    grid.innerHTML = '';
    const sorted = [...daySlots].sort((a, b) => a.start_time.localeCompare(b.start_time));
    sorted.forEach((slot) => {
      const chip = document.createElement('div');
      const label = fmtTime(slot.start_time);
      chip.className = 'time-chip' + (!slot.available ? ' taken' : '');
      chip.textContent = slot.available ? label : label + ' · taken';
      if (slot.available) {
        chip.addEventListener('click', () => commitPick(slot, chip));
      }
      grid.appendChild(chip);
    });
  }

  function fmtTime(t) {
    const [h, m] = t.split(':').map(Number);
    const d = new Date();
    d.setHours(h, m, 0, 0);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  function fmtDate(dateStr) {
    const d = new Date(`${dateStr}T00:00:00`);
    return d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  }

  // ---------- Committing a pick: locks the slot server-side immediately ----------
  async function commitPick(slot, chipEl) {
    $('slot-error').hidden = true;
    chipEl.style.opacity = '0.5';
    try {
      const r = await fetch('/api/still/hold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ availability_id: slot.id, hold_token: state.holdToken }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || 'That slot was just taken. Please pick another.');

      markSlotUnavailable(slot.id);
      state.pickedSessions.push({
        availability_id: slot.id,
        date: slot.date,
        start_time: slot.start_time,
        locked_until: data.locked_until,
      });

      renderPickedList();
      renderPickerPanel();
      updateContinueBtn();
    } catch (err) {
      $('slot-error').hidden = false;
      $('slot-error').textContent = err.message;
      renderCalendar();
    }
  }

  // ---------- Picked-sessions list & repeating picker panel ----------
  function renderPickedList() {
    const list = $('picked-list');
    list.innerHTML = '';
    state.pickedSessions.forEach((s, i) => {
      const row = document.createElement('div');
      row.className = 'picked-row';
      row.innerHTML = `<span><span class="p-label">session ${i + 1}</span> — ${fmtDate(s.date)} · ${fmtTime(s.start_time)}</span>` +
        `<button class="p-redo" type="button" data-idx="${i}">redo</button>`;
      list.appendChild(row);
    });
    list.querySelectorAll('.p-redo').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const idx = parseInt(btn.dataset.idx, 10);
        const removed = state.pickedSessions.splice(idx, 1)[0];
        await releaseHold(removed.availability_id);
        markSlotAvailable(removed.date, removed.availability_id);
        renderPickedList();
        renderPickerPanel();
        updateContinueBtn();
      });
    });
  }

  function renderPickerPanel() {
    const panel = $('picker-panel');
    const sub = $('picker-heading-sub');
    const note = $('all-picked-note');
    const remaining = state.quantity - state.pickedSessions.length;

    state.selectedDate = null;
    document.querySelectorAll('.cal-cell.selected').forEach((c) => c.classList.remove('selected'));
    $('time-grid').innerHTML = '';

    if (remaining > 0) {
      panel.hidden = false;
      sub.textContent = `— session ${state.pickedSessions.length + 1} of ${state.quantity}`;
      note.hidden = true;
    } else {
      panel.hidden = true;
      sub.textContent = '';
      note.hidden = state.pickedSessions.length === 0;
      note.textContent = `✓ All ${state.quantity} session${state.quantity > 1 ? 's' : ''} scheduled — review above, or continue.`;
    }
    renderCalendar();
  }
  renderPickerPanel();

  // ---------- Step 1 validation ----------
  ['fname', 'lname', 'email'].forEach((id) => $(id).addEventListener('input', updateContinueBtn));

  function updateContinueBtn() {
    const ok = $('fname').value.trim() && $('lname').value.trim() &&
      /\S+@\S+\.\S+/.test($('email').value.trim()) &&
      state.pickedSessions.length === state.quantity;
    $('to-payment').disabled = !ok;
  }

  // ---------- Step navigation ----------
  function goStep(n) {
    document.querySelectorAll('.panel-step').forEach((p) => p.classList.remove('visible'));
    $('step-' + n).classList.add('visible');
    [1, 2, 3].forEach((i) => {
      const pill = $('pill-' + i);
      pill.classList.remove('active', 'done');
      if (i < n) pill.classList.add('done');
      if (i === n) pill.classList.add('active');
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // ---------- Move to payment ----------
  $('to-payment').addEventListener('click', async () => {
    state.fname = $('fname').value.trim();
    state.lname = $('lname').value.trim();
    state.email = $('email').value.trim();

    const btn = $('to-payment');
    btn.disabled = true;

    try {
      const whenList = $('summary-when-list');
      whenList.innerHTML = '';
      state.pickedSessions.forEach((s, i) => {
        const row = document.createElement('div');
        row.className = 'summary-row';
        row.innerHTML = `<span class="label">session ${i + 1}</span><span class="value">${fmtDate(s.date)} · ${fmtTime(s.start_time)} (Chiang Mai)</span>`;
        whenList.appendChild(row);
      });
      $('summary-name').textContent = `${state.fname} ${state.lname}`;

      const totalThb = state.quantity * PRICE_PER_SESSION;
      const usd = Math.round(totalThb / 32.6);
      const eur = Math.round(usd * 0.92);
      $('summary-plan').textContent = state.quantity === 1 ? 'Single session' : `${state.quantity} sessions, all scheduled now`;
      $('price-thb').textContent = '฿' + totalThb.toLocaleString('en-US');
      $('price-usd').textContent = `≈ $${usd} USD / €${eur} EUR — charged in THB`;
      $('price-tag').textContent = state.quantity === 1 ? '1 session' : `${state.quantity} sessions`;

      await setupPaymentIntent();

      // Countdown to the earliest of all the slot holds — they were all
      // requested within moments of each other, so this is effectively the
      // 15-minute window for the whole purchase.
      const earliest = state.pickedSessions.reduce((min, s) => {
        const t = new Date(s.locked_until).getTime();
        return t < min ? t : min;
      }, Infinity);
      startHold(earliest);

      goStep(2);
    } finally {
      btn.disabled = false;
    }
  });

  async function setupPaymentIntent() {
    await stripeReady;
    if (!stripe) {
      $('payment-error').hidden = false;
      $('payment-error').textContent = 'Payments are not configured yet on this site.';
      return;
    }
    const r = await fetch('/api/still/create-payment-intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        availability_ids: state.pickedSessions.map((s) => s.availability_id),
        hold_token: state.holdToken,
        first_name: state.fname,
        last_name: state.lname,
        email: state.email,
        phone: $('phone').value.trim(),
        notes: $('notes').value.trim(),
        newsletter_opt_in: $('newsletter').checked,
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      $('payment-error').hidden = false;
      $('payment-error').textContent = data.error || 'Could not start payment.';
      return;
    }
    state.paymentIntentId = data.payment_intent_id;
    elements = stripe.elements({ clientSecret: data.client_secret });
    const paymentElement = elements.create('payment');
    paymentElement.mount('#payment-element');
  }

  // ---------- Slot hold countdown ----------
  function startHold(deadlineMs) {
    clearInterval(state.holdInterval);
    state.holdDeadline = deadlineMs;
    $('hold-badge').classList.remove('expired');
    $('to-confirm').disabled = false;
    updateHoldDisplay();
    state.holdInterval = setInterval(updateHoldDisplay, 1000);
  }

  async function updateHoldDisplay() {
    const secondsLeft = Math.max(0, Math.round((state.holdDeadline - Date.now()) / 1000));
    if (secondsLeft <= 0) {
      clearInterval(state.holdInterval);
      $('hold-badge').classList.add('expired');
      $('hold-text').textContent = 'Holds expired — your slots have been released';
      $('to-confirm').disabled = true;
      return;
    }
    const m = Math.floor(secondsLeft / 60);
    const s = secondsLeft % 60;
    $('hold-text').textContent = `Slots held — ${m}:${String(s).padStart(2, '0')} remaining`;
  }

  $('back-to-details').addEventListener('click', () => {
    clearInterval(state.holdInterval);
    goStep(1);
  });

  // ---------- Card field formatting not needed — Stripe Elements handles it ----------

  // ---------- Confirm ----------
  $('to-confirm').addEventListener('click', async () => {
    const btn = $('to-confirm');
    const label = $('to-confirm-label');
    if (btn.disabled) return;
    btn.disabled = true;
    const originalLabel = label.textContent;
    label.textContent = 'Processing…';
    $('payment-error').hidden = true;

    try {
      if (!stripe || !elements) throw new Error('Payment is not ready yet.');
      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        redirect: 'if_required',
        confirmParams: { return_url: window.location.href },
      });
      if (error) throw new Error(error.message);

      // Card payments resolve to 'succeeded' immediately, so we can finalize
      // and show the full confirmation right away. Async local payment
      // methods (PromptPay and similar) resolve to 'processing' here — the
      // participant has already paid, but Stripe settles it a moment later
      // and our webhook (webhook-stripe.js) finalizes the booking then.
      // Calling /finalize before that would just 409 (it requires
      // 'succeeded'), so show a lighter "you're set, hang tight" screen
      // instead of treating this as an error.
      if (paymentIntent.status === 'processing') {
        clearInterval(state.holdInterval);
        showPendingConfirmation({
          name: `${state.fname} ${state.lname}`,
          email: state.email,
          totalPaidThb: state.pickedSessions.length * PRICE_PER_SESSION,
        });
        return;
      }
      if (paymentIntent.status !== 'succeeded') {
        throw new Error('Payment did not complete. Please try again.');
      }

      const r = await fetch('/api/still/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_intent_id: state.paymentIntentId }),
      });
      const data = await r.json();
      if (!r.ok) {
        throw new Error(data.error || `Payment succeeded but confirmation failed — contact hello@joulekasima.com with payment reference ${state.paymentIntentId}.`);
      }

      clearInterval(state.holdInterval);
      showConfirmation({
        name: `${data.first_name} ${data.last_name}`,
        email: data.email,
        totalPaidThb: data.total_paid_thb,
        sessions: data.sessions,
      });
    } catch (err) {
      $('payment-error').hidden = false;
      $('payment-error').textContent = err.message;
    } finally {
      btn.disabled = false;
      label.textContent = originalLabel;
    }
  });

  function showConfirmation({ name, email, totalPaidThb, sessions }) {
    $('confirm-badge').innerHTML = '&#10003; Booking confirmed';
    $('confirm-name').textContent = name;
    $('confirm-paid').textContent = '฿' + Number(totalPaidThb || 0).toLocaleString('en-US');
    $('confirm-sub').textContent = sessions.length > 1
      ? `A confirmation just went to ${email} — all ${sessions.length} sessions are booked.`
      : `A confirmation just went to ${email}.`;

    const listEl = $('confirm-sessions-list');
    listEl.innerHTML = '';
    sessions.forEach((s, i) => {
      const manageUrl = `/cancel?ref=${encodeURIComponent(s.reference)}&token=${encodeURIComponent(s.cancel_token)}`;
      const card = document.createElement('div');
      card.className = 'session-card';
      card.innerHTML =
        `<div class="sc-head"><span class="sc-label">session ${i + 1} of ${sessions.length}</span><span class="sc-ref">${s.reference}</span></div>` +
        `<div class="sc-when">${fmtDate(s.date)} · ${fmtTime(s.start_time)} (Chiang Mai)</div>` +
        `<div class="sc-link-k">&gt; call link (auto-generated via Google Calendar)</div>` +
        `<div class="sc-link"><a href="${s.call_link}" target="_blank" rel="noopener">${s.call_link}</a></div>` +
        `<div class="sc-manage"><a href="${manageUrl}">manage this session</a></div>`;
      listEl.appendChild(card);
    });

    goStep(3);
  }

  // Shown when payment has been accepted but is still settling (async
  // methods like PromptPay). No session details yet — the webhook finalizes
  // the booking moments later and the real confirmation email (with call
  // links) follows automatically. This screen is not tied to a hold
  // interval reset because the hold no longer matters: Stripe has the
  // payment, and finalizeSession() marks the slot booked once the webhook
  // fires, independent of whether the local 15-minute hold already lapsed.
  function showPendingConfirmation(opts) {
    const o = opts || {};
    $('confirm-badge').textContent = 'Payment received';
    $('confirm-name').textContent = o.name || '';
    $('confirm-paid').textContent = o.totalPaidThb != null
      ? '฿' + Number(o.totalPaidThb).toLocaleString('en-US')
      : '';
    $('confirm-sub').textContent = o.email
      ? `Got it — your payment is finishing processing. Your booking confirmation and calendar link will land in ${o.email} within a few minutes.`
      : `Got it — your payment is finishing processing. Your booking confirmation and calendar link will land in your inbox within a few minutes.`;
    $('confirm-sessions-list').innerHTML = '';
    goStep(3);
  }

  // Shown when the participant is sent back from an off-page redirect but
  // we couldn't confirm the booking automatically (payment failed/canceled,
  // or the confirm call itself errored). Reuses the step-3 layout since it
  // already has the "book another" reset button.
  function showRedirectError(message) {
    $('confirm-badge').textContent = 'Could not confirm automatically';
    $('confirm-name').textContent = '';
    $('confirm-paid').textContent = '';
    $('confirm-sub').textContent = message;
    $('confirm-sessions-list').innerHTML = '';
    goStep(3);
  }

  // ---------- Handle return from an off-page redirect ----------
  // stripe.confirmPayment() is called with redirect: 'if_required', which
  // avoids navigating away for most payment methods. Some async/local
  // methods (PromptPay can behave this way depending on the customer's
  // banking app) may still send the browser through a hosted step and back
  // to return_url instead of resolving in-page. On that return trip Stripe
  // appends payment_intent / payment_intent_client_secret / redirect_status
  // to the URL — without handling that here, the page just reloads to a
  // blank step 1 even though the payment went through (all in-memory
  // state, including who's paying, is lost on a full reload).
  // /api/still/finalize needs only the payment_intent id and now returns
  // the participant's name/email/amount itself, so this doesn't depend on
  // any of the state that didn't survive the reload.
  async function handleRedirectReturn() {
    const params = new URLSearchParams(window.location.search);
    const paymentIntentId = params.get('payment_intent');
    const redirectStatus = params.get('redirect_status');
    if (!paymentIntentId || !redirectStatus) return;

    // Drop these from the URL right away so a refresh doesn't replay this.
    window.history.replaceState({}, document.title, window.location.origin + window.location.pathname);

    if (redirectStatus === 'failed' || redirectStatus === 'canceled') {
      showRedirectError('Payment was not completed, so nothing was booked or charged. Please start a new booking.');
      return;
    }

    try {
      const r = await fetch('/api/still/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_intent_id: paymentIntentId }),
      });
      const data = await r.json();

      if (r.ok) {
        showConfirmation({
          name: `${data.first_name} ${data.last_name}`,
          email: data.email,
          totalPaidThb: data.total_paid_thb,
          sessions: data.sessions,
        });
        return;
      }

      if (r.status === 409) {
        // Payment hasn't settled to 'succeeded' yet — expected for some
        // async methods, not an error. The webhook will finalize it and
        // the confirmation email follows shortly; nothing more to do here.
        showPendingConfirmation({});
        return;
      }

      throw new Error(data.error || 'Could not confirm your booking.');
    } catch (err) {
      showRedirectError(
        `We couldn't confirm your booking automatically. If you completed the payment, please contact ` +
        `hello@joulekasima.com with payment reference ${paymentIntentId} — do not pay again.`
      );
    }
  }
  handleRedirectReturn();

  // ---------- Restart ----------
  $('book-another').addEventListener('click', () => {
    document.querySelectorAll('.time-chip').forEach((c) => c.classList.remove('selected'));
    ['fname', 'lname', 'email', 'phone', 'notes'].forEach((id) => { $(id).value = ''; });
    $('newsletter').checked = false;
    state.quantity = 1;
    state.pickedSessions = [];
    state.holdToken = (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2));
    state.paymentIntentId = null;
    state.monthCache = {};
    viewYear = TODAY.getFullYear();
    viewMonth = TODAY.getMonth();
    renderQty();
    renderPickedList();
    renderPickerPanel();
    $('time-grid').innerHTML = '';
    updateContinueBtn();
    goStep(1);
  });
})();
