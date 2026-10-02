/*
  Field Notes: shared text rules. Used by the private writing page (browser) and the admin API (Node), so the
  limits, slug rules, Thai font list and the "never split a Thai character" editing helpers exist in ONE place.
  No DOM, no dependencies - like assets/timezone.js.
*/
(function (root) {
  const LIMITS = { title: 200, summary: 300, body: 100000, slug: 80, category: 40, categoriesPerPost: 8, categoriesTotal: 200 };

  // Words that can never be a post slug (they will be real pages in the public section).
  const RESERVED_SLUGS = ['new', 'edit', 'admin', 'api', 'rss', 'tag', 'category', 'feed'];

  // Free Thai fonts (SIL Open Font License, served by Google Fonts). `latin` is the site font that comes FIRST in the
  // stack, so English words keep the site look and only Thai characters use the Thai font.
  const THAI_FONTS = [
    { key: 'noto-sans-thai', label: 'Noto Sans Thai', family: 'Noto Sans Thai', latin: 'Inter', google: 'Noto+Sans+Thai:wght@400;600', note: 'Clean and modern. Pairs with Inter.' },
    { key: 'noto-serif-thai', label: 'Noto Serif Thai', family: 'Noto Serif Thai', latin: 'Fraunces', google: 'Noto+Serif+Thai:wght@400;600', note: 'Book-like. Pairs with Fraunces.' },
    { key: 'sarabun', label: 'Sarabun', family: 'Sarabun', latin: 'Inter', google: 'Sarabun:ital,wght@0,400;0,600;1,400', note: 'Friendly and compact; common in Thai documents.' },
    { key: 'prompt', label: 'Prompt', family: 'Prompt', latin: 'Inter', google: 'Prompt:wght@400;600', note: 'Rounded and geometric; a bolder look.' },
  ];
  const DEFAULT_THAI_FONT = 'noto-sans-thai';
  const fontByKey = (key) => THAI_FONTS.find((f) => f.key === key) || null;
  const isThaiFontKey = (key) => !!fontByKey(key);
  const fontCssHref = (key) => { const f = fontByKey(key); return f ? `https://fonts.googleapis.com/css2?family=${f.google}&display=swap` : null; };

  // ---------- characters ----------
  const BAD_CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/; // everything except tab, newline, carriage return
  const BAD_CONTROL_ANY = /[\u0000-\u001F\u007F]/; // single-line fields: no control characters at all
  function codepointLength(s) { let n = 0; for (const ch of String(s)) n += ch ? 1 : 0; return n; } // counts like Postgres char_length

  // ---------- slugs ----------
  const THAI_SLUG_CHARS = '\\u0E01-\\u0E3A\\u0E40-\\u0E4E\\u0E50-\\u0E59'; // Thai letters, vowels, tone marks, digits
  const SLUG_RE = new RegExp(`^[a-z0-9${THAI_SLUG_CHARS}]+(?:-[a-z0-9${THAI_SLUG_CHARS}]+)*$`);
  const THAI_RUNS = new RegExp(`[^a-z0-9${THAI_SLUG_CHARS}]+`, 'g');

  const defaultRand = () => Math.random().toString(36).slice(2, 8).padEnd(6, '0');
  // Chiang Mai calendar date (UTC+7) of an instant, as YYYY-MM-DD.
  const chiangMaiDate = (now) => new Date((now || new Date()).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);

  // The English-letters-and-digits part of a title as a slug ("" when there is none, or it would be a reserved word).
  function asciiSlug(title) {
    const ascii = String(title == null ? '' : title).slice(0, 1000).normalize('NFKD').replace(/[\u0300-\u036F]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, LIMITS.slug).replace(/-+$/, '');
    return RESERVED_SLUGS.includes(ascii) ? '' : ascii;
  }
  const DATE_ID_SLUG = /^\d{4}-\d{2}-\d{2}-[0-9a-f]{6}$/;

  // Title -> slug. Keeps English letters, digits and hyphens only. A Thai-only (or otherwise empty) result becomes
  // "<date>-<short random id>". The owner can edit the slug afterwards, and may use Thai characters there.
  function slugify(title, opts) {
    const o = opts || {};
    return asciiSlug(title) || `${chiangMaiDate(o.now)}-${(o.rand || defaultRand)()}`;
  }

  // Category name -> slug. Keeps Thai letters too (so a Thai category still gets a readable web address).
  function categorySlug(name, opts) {
    const o = opts || {};
    const s = String(name == null ? '' : name).slice(0, 200).normalize('NFC').toLowerCase().replace(THAI_RUNS, '-').replace(/^-+|-+$/g, '').slice(0, LIMITS.slug).replace(/-+$/, '');
    return s || `c-${(o.rand || defaultRand)()}`;
  }

  // Whatever the owner typed in the slug box -> a clean slug, or an error message.
  function normalizeSlug(input) {
    if (typeof input !== 'string') return { ok: false, error: 'The slug must be text.' };
    const s = input.slice(0, 500).normalize('NFC').trim().toLowerCase().replace(/[\s_]+/g, '-').replace(/-{2,}/g, '-').replace(/^-+|-+$/g, '');
    if (!s) return { ok: false, error: 'The slug is empty.' };
    if (codepointLength(s) > LIMITS.slug) return { ok: false, error: `The slug can be at most ${LIMITS.slug} characters.` };
    if (!SLUG_RE.test(s)) return { ok: false, error: 'The slug can only use English letters, numbers, Thai letters and single hyphens.' };
    if (RESERVED_SLUGS.includes(s)) return { ok: false, error: `"${s}" is reserved. Pick another slug.` };
    return { ok: true, slug: s };
  }

  // Same name with different capitals / spacing counts as the same category.
  const categoryKey = (name) => String(name).normalize('NFC').trim().replace(/\s+/g, ' ').toLowerCase();
  function cleanCategoryName(input) {
    if (typeof input !== 'string') return { ok: false, error: 'The category name must be text.' };
    if (BAD_CONTROL_ANY.test(input.replace(/[\t\n\r]/g, ' '))) return { ok: false, error: 'The category name has characters that are not allowed.' };
    const name = input.slice(0, 500).normalize('NFC').replace(/\s+/g, ' ').trim();
    if (!name) return { ok: false, error: 'Type a category name.' };
    if (codepointLength(name) > LIMITS.category) return { ok: false, error: `A category name can be at most ${LIMITS.category} characters.` };
    return { ok: true, name };
  }

  // ---------- language ----------
  // Share of letters that are Thai (0..1) in the first few thousand characters.
  function thaiShare(text) {
    let thai = 0, letters = 0;
    for (const ch of String(text == null ? '' : text).slice(0, 5000)) {
      const c = ch.codePointAt(0);
      if (c >= 0x0E01 && c <= 0x0E5B) { if (c <= 0x0E3A || (c >= 0x0E40 && c <= 0x0E4E)) { thai++; letters++; } } else if (/\p{L}/u.test(ch)) letters++;
    }
    return letters ? thai / letters : 0;
  }
  const suggestLang = (text) => (thaiShare(text) >= 0.3 ? 'th' : 'en');

  // ---------- editing helpers (pure: they return an edit, the page applies it to the textarea) ----------
  // A Thai "character" is a base letter plus any vowel/tone marks after it. Wrapping text in ** must never land
  // between them, so selection edges are moved to the edge of the cluster.
  const isLow = (c) => c >= 0xDC00 && c <= 0xDFFF;
  const EXTEND = /[\u0300-\u036F\u0E31\u0E33-\u0E3A\u0E47-\u0E4E\u200C\u200D\uFE00-\uFE0F]/;
  const extendsPrev = (text, i) => EXTEND.test(text[i]) || isLow(text.charCodeAt(i));
  function snapStart(text, i) { while (i > 0 && i < text.length && extendsPrev(text, i)) i--; return i; }
  function snapEnd(text, i) { while (i > 0 && i < text.length && extendsPrev(text, i)) i++; return i; }
  function applyEdit(text, e) { return text.slice(0, e.from) + e.insert + text.slice(e.to); }

  // **bold** / *italic*: wrap the selection, or take the markers off if it is already wrapped.
  function wrapEdit(text, start, end, before, after, placeholder) {
    let s = snapStart(text, Math.min(start, end)), e = snapEnd(text, Math.max(start, end));
    while (s < e && /\s/.test(text[s])) s++; // markers must hug the words
    while (e > s && /\s/.test(text[e - 1])) e--;
    const bl = before.length, al = after.length;
    if (s === e) {
      const ins = before + placeholder + after;
      return { from: s, to: e, insert: ins, selStart: s + bl, selEnd: s + bl + placeholder.length };
    }
    const sel = text.slice(s, e);
    const single = before === '*' && after === '*';
    const wrappedOutside = text.slice(s - bl, s) === before && text.slice(e, e + al) === after && !(single && (text[s - 2] === '*' || text[e + 1] === '*'));
    if (wrappedOutside) return { from: s - bl, to: e + al, insert: sel, selStart: s - bl, selEnd: s - bl + sel.length };
    const wrappedInside = sel.length > bl + al && sel.startsWith(before) && sel.endsWith(after) && !(single && (sel[1] === '*' || sel[sel.length - 2] === '*'));
    if (wrappedInside) { const inner = sel.slice(bl, sel.length - al); return { from: s, to: e, insert: inner, selStart: s, selEnd: s + inner.length }; }
    return { from: s, to: e, insert: before + sel + after, selStart: s + bl, selEnd: s + bl + sel.length };
  }

  // Block formatting acts on whole lines: 'h2' | 'h3' | 'quote' | 'ul' | 'ol'. Pressing it again removes it.
  const PREFIX = { h2: '## ', h3: '### ', quote: '> ', ul: '- ' };
  const HEADING_RE = /^#{1,6} /;
  const OL_RE = /^\d{1,9}\. /;
  function lineEdit(text, start, end, kind) {
    const a = Math.min(start, end);
    let b = Math.max(start, end);
    if (b > a && text[b - 1] === '\n') b--;
    const from = text.lastIndexOf('\n', a - 1) + 1;
    let to = text.indexOf('\n', b); if (to === -1) to = text.length;
    const lines = text.slice(from, to).split('\n');
    const has = (l) => (kind === 'ol' ? OL_RE.test(l) : l.startsWith(PREFIX[kind]));
    const strip = (l) => l.replace(HEADING_RE, '').replace(/^> /, '').replace(/^- /, '').replace(OL_RE, '');
    const filled = lines.filter((l) => l.trim());
    const allHave = filled.length > 0 && filled.every(has);
    let n = 0;
    const out = lines.map((l) => {
      if (!l.trim()) return l;
      if (allHave) return strip(l);
      n++;
      return (kind === 'ol' ? `${n}. ` : PREFIX[kind]) + strip(l);
    });
    const insert = out.join('\n');
    return { from, to, insert, selStart: from, selEnd: from + insert.length };
  }

  // [text](https://) around the selection, with the web address selected ready to paste over.
  function linkEdit(text, start, end) {
    let s = snapStart(text, Math.min(start, end)), e = snapEnd(text, Math.max(start, end));
    const label = s === e ? 'link text' : text.slice(s, e);
    const url = 'https://';
    const ins = `[${label}](${url})`;
    const urlStart = s + label.length + 3;
    return { from: s, to: e, insert: ins, selStart: urlStart, selEnd: urlStart + url.length };
  }

  function dividerEdit(text, pos) {
    const lineEnd = (() => { const i = text.indexOf('\n', pos); return i === -1 ? text.length : i; })();
    const before = text.slice(0, lineEnd).length === 0 || text.slice(0, lineEnd).endsWith('\n\n') ? '' : (text.slice(0, lineEnd).endsWith('\n') ? '\n' : '\n\n');
    const ins = `${before}---\n\n`;
    return { from: lineEnd, to: lineEnd, insert: ins, selStart: lineEnd + ins.length, selEnd: lineEnd + ins.length };
  }

  const api = {
    LIMITS, RESERVED_SLUGS, THAI_FONTS, DEFAULT_THAI_FONT, fontByKey, isThaiFontKey, fontCssHref,
    BAD_CONTROL, BAD_CONTROL_ANY, codepointLength,
    asciiSlug, DATE_ID_SLUG, slugify, categorySlug, normalizeSlug, categoryKey, cleanCategoryName, chiangMaiDate,
    thaiShare, suggestLang,
    snapStart, snapEnd, applyEdit, wrapEdit, lineEdit, linkEdit, dividerEdit,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FnText = api;
})(typeof window !== 'undefined' ? window : this);
