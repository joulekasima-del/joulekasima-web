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

/* ---------- Contact form (demo) ---------- */
const form = document.getElementById('contactForm');
const formNote = document.getElementById('formNote');

form.addEventListener('submit', (e) => {
  e.preventDefault();
  formNote.hidden = false;
  form.reset();
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
      const res = await fetch('/api/thai-talk-notify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
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
