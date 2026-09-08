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

/* ---------- Language switching ----------
   Text content lives in content.js (SITE_CONTENT).
   This just looks up each element's data-i18n path (e.g. "hero.headline")
   and swaps in the matching language string. */

function getByPath(obj, path) {
  return path.split('.').reduce((acc, key) => {
    if (acc == null) return undefined;
    return acc[key];
  }, obj);
}

const langButtons = document.querySelectorAll('.lang-btn');

function setLanguage(lang) {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const path = el.getAttribute('data-i18n');
    const entry = getByPath(SITE_CONTENT, path);
    if (entry && entry[lang]) {
      el.innerHTML = entry[lang];
    }
  });

  document.documentElement.lang = lang;
  document.body.classList.toggle('lang-th', lang === 'th');

  langButtons.forEach(btn => {
    btn.classList.toggle('is-active', btn.getAttribute('data-lang') === lang);
  });

  try { localStorage.setItem('joulekasima-lang', lang); } catch (e) { /* ignore */ }
}

langButtons.forEach(btn => {
  btn.addEventListener('click', () => setLanguage(btn.getAttribute('data-lang')));
});

let savedLang = 'en';
try { savedLang = localStorage.getItem('joulekasima-lang') || 'en'; } catch (e) { /* ignore */ }
setLanguage(savedLang);
