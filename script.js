document.getElementById('year').textContent = new Date().getFullYear();

/* ---------- Mobile nav ---------- */
const navToggle = document.getElementById('navToggle');
const primaryNav = document.getElementById('primaryNav');

navToggle.addEventListener('click', () => {
  const isOpen = primaryNav.classList.toggle('open');
  navToggle.setAttribute('aria-expanded', String(isOpen));
});

primaryNav.querySelectorAll('a').forEach(link => {
  link.addEventListener('click', () => {
    primaryNav.classList.remove('open');
    navToggle.setAttribute('aria-expanded', 'false');
  });
});

/* ---------- Contact form ---------- */
const form = document.getElementById('contactForm');
const formNote = document.getElementById('formNote');
const formButton = form.querySelector('button[type="submit"]');
const formButtonLabel = formButton.textContent;

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = form.name.value.trim();
  const email = form.email.value.trim();
  const message = form.message.value.trim();
  const website = form.website.value.trim();

  formNote.hidden = true;
  formNote.classList.remove('success', 'error');
  formButton.disabled = true;
  formButton.textContent = 'Sending…';

  try {
    const res = await fetch('/api/forms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ formType: 'contact', name, email, message, website }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Something went wrong.');

    formNote.textContent = "Thanks — your message is on its way to me. I read every one and will reply soon.";
    formNote.classList.add('success');
    formNote.hidden = false;
    form.reset();
  } catch (err) {
    formNote.innerHTML = 'Something went wrong sending that. Please try again, or email me at <a href="mailto:hello@joulekasima.com">hello@joulekasima.com</a>.';
    formNote.classList.add('error');
    formNote.hidden = false;
    // Deliberately not calling form.reset() here — keep what they typed.
  } finally {
    formButton.disabled = false;
    formButton.textContent = formButtonLabel;
  }
});

/* ---------- Thai Talk Breaks launch notify ---------- */
const notifyForm = document.getElementById('thaiTalkNotifyForm');
if (notifyForm) {
  const notifyNote = document.getElementById('thaiTalkNotifyNote');
  const notifyButton = notifyForm.querySelector('button[type="submit"]');
  const notifyButtonLabel = notifyButton.textContent;

  notifyForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = notifyForm.email.value.trim();

    notifyNote.hidden = true;
    notifyNote.classList.remove('success', 'error');
    notifyButton.disabled = true;
    notifyButton.textContent = 'Sending…';

    try {
      const res = await fetch('/api/forms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ formType: 'thai-talk-notify', email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong.');

      notifyNote.textContent = "You're on the list — we'll email you the day it launches.";
      notifyNote.classList.add('success');
      notifyNote.hidden = false;
      notifyForm.reset();
    } catch (err) {
      notifyNote.textContent = err.message || 'Could not save that — try again in a moment.';
      notifyNote.classList.add('error');
      notifyNote.hidden = false;
    } finally {
      notifyButton.disabled = false;
      notifyButton.textContent = notifyButtonLabel;
    }
  });
}
