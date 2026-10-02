/* Field Notes writing page (private). No libraries, no inline script (the page's CSP forbids it).
   Everything the owner typed is rendered with textContent / DOM nodes. The ONLY place HTML is built from text is the
   preview, and that goes through the safe renderer (assets/fn-render.js), which escapes everything first.

   Saving rules (the server enforces the same ones):
   - A DRAFT autosaves a few seconds after typing stops (never while an IME is composing).
   - A PUBLISHED post is never changed by autosave. Edits to it are backed up on this device and go live only on "Update".
   - Every save carries the post's version; if it changed elsewhere the server says 409 and nothing is overwritten.
   - Unsent text is also kept in this browser (localStorage) and offered back after a crash or an offline spell. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var T = window.FnText, R = window.FnRender;
  var API = '/api/forms?admin=';
  var AUTOSAVE_MS = 3000;

  var state = { posts: [], categories: [], view: 'posts', loaded: false };
  var ed = null; // the post being edited (see newEditor)

  // ---------- tiny helpers ----------
  function el(tag, className, text) {
    var n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function setHidden(node, hidden) { node.hidden = !!hidden; }
  function say(node, text, isError) { node.textContent = text || ''; node.hidden = !text; if (isError !== undefined) node.classList.toggle('is-error', !!isError); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function clock(d) { return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function niceDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + clock(d);
  }
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lsDel(k) { try { window.localStorage.removeItem(k); } catch (e) { /* ignore */ } }

  async function api(route, options) {
    var o = options || {};
    var url = API + route;
    if (o.query) Object.keys(o.query).forEach(function (k) { url += '&' + encodeURIComponent(k) + '=' + encodeURIComponent(o.query[k]); });
    var init = { method: o.method || 'GET', credentials: 'same-origin', cache: 'no-store', headers: {} };
    if (o.body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(o.body); }
    var res = await fetch(url, init); // a network failure throws; callers treat that as "offline"
    var body = null;
    try { body = await res.json(); } catch (e) { /* not JSON */ }
    return { status: res.status, ok: res.ok, body: body || {} };
  }

  // ---------- Thai fonts: load only the one that is needed ----------
  var loadedFonts = {};
  function ensureFont(key) {
    var href = T.fontCssHref(key);
    if (!href || loadedFonts[key]) return;
    loadedFonts[key] = true;
    var link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = href;
    document.head.appendChild(link);
  }
  function fontClass(key) { return T.isThaiFontKey(key) ? 'fn-font-' + key : 'fn-font-' + T.DEFAULT_THAI_FONT; }
  function applyFontClasses(node, lang, key) {
    T.THAI_FONTS.forEach(function (f) { node.classList.remove('fn-font-' + f.key); });
    if (lang === 'th') { ensureFont(key); node.classList.add(fontClass(key)); }
  }

  // ---------- views ----------
  function showView(name) {
    state.view = name;
    setHidden($('view-posts'), name !== 'posts');
    setHidden($('view-categories'), name !== 'categories');
    setHidden($('view-editor'), name !== 'editor');
    var onList = name !== 'editor';
    $('tab-posts').setAttribute('aria-current', name === 'posts' ? 'page' : 'false');
    $('tab-categories').setAttribute('aria-current', name === 'categories' ? 'page' : 'false');
    document.querySelector('.fn-tabs').hidden = !onList;
    document.querySelector('.fn-top .fn-h1').hidden = !onList;
    window.scrollTo(0, 0);
  }

  function showSignedOut() {
    setHidden($('fn-app'), true);
    setHidden($('fn-signin'), false);
    $('fn-status').hidden = true;
  }
  function showMigration(message) {
    setHidden($('fn-app'), true);
    $('fn-status').hidden = true;
    say($('fn-notice'), message || 'Field Notes needs a one-time database setup. Run supabase/migrations/0006_fieldnotes.sql in the Supabase SQL editor, then reload this page.');
  }

  // Handles the answers every call can get. Returns true when the caller should stop.
  function commonProblem(r) {
    if (r.status === 401) { showSignedOut(); return true; }
    if (r.status === 503 && r.body && r.body.code === 'MIGRATION_REQUIRED') { showMigration(r.body.error); return true; }
    return false;
  }

  // ---------- loading the lists ----------
  async function loadLists() {
    var r;
    try { r = await api('notes'); } catch (e) { $('fn-status').hidden = false; $('fn-status').textContent = 'Could not reach the server. Check your connection and reload.'; $('fn-status').classList.add('is-error'); return false; }
    if (commonProblem(r)) return false;
    if (!r.ok) { $('fn-status').hidden = false; $('fn-status').textContent = (r.body && r.body.error) || 'Could not load.'; $('fn-status').classList.add('is-error'); return false; }
    state.posts = r.body.posts || [];
    state.categories = r.body.categories || [];
    state.loaded = true;
    $('fn-status').hidden = true;
    setHidden($('fn-signin'), true);
    setHidden($('fn-app'), false);
    return true;
  }
  var catName = function (id) { var c = state.categories.filter(function (x) { return x.id === id; })[0]; return c ? c.name : null; };

  // ---------- posts list ----------
  function postRow(p) {
    var btn = el('button', 'fn-item' + (p.status === 'published' ? ' is-published' : ''));
    btn.type = 'button';
    btn.appendChild(el('span', 'fn-item-title', p.title));
    var meta = el('span', 'fn-item-meta');
    meta.appendChild(document.createTextNode((p.status === 'published' ? 'Published ' + niceDate(p.publishedAt) + ' · ' : '') + 'Edited ' + niceDate(p.updatedAt) + ' · ' + (p.lang === 'th' ? 'Thai' : 'English')));
    btn.appendChild(meta);
    var names = (p.categoryIds || []).map(catName).filter(Boolean);
    if (names.length) { var cm = el('span', 'fn-item-meta'); names.forEach(function (n) { cm.appendChild(el('span', 'fn-pill', n)); }); btn.appendChild(cm); }
    var backup = readBackup(p.id);
    if (backup) btn.appendChild(el('span', 'fn-item-meta', 'Unsaved text from ' + niceDate(backup.at) + ' is kept on this device.'));
    btn.addEventListener('click', function () { openPost(p.id); });
    return btn;
  }
  function renderPosts() {
    var drafts = state.posts.filter(function (p) { return p.status !== 'published'; });
    var pub = state.posts.filter(function (p) { return p.status === 'published'; });
    [['list-drafts', drafts, 'count-drafts', 'No drafts. Press "New post" to start writing.'], ['list-published', pub, 'count-published', 'Nothing published yet.']].forEach(function (s) {
      var box = $(s[0]); clear(box);
      $(s[2]).textContent = s[1].length ? '(' + s[1].length + ')' : '';
      if (!s[1].length) box.appendChild(el('p', 'empty', s[3]));
      s[1].forEach(function (p) { box.appendChild(postRow(p)); });
    });
    var nb = readBackup('new'), banner = $('backup-new'); clear(banner);
    if (nb && (nb.title || nb.body)) {
      banner.hidden = false;
      banner.appendChild(el('p', 'fn-banner-text', 'An unsent new post from ' + niceDate(nb.at) + ' is kept on this device' + (nb.title ? ': "' + nb.title + '"' : '') + '.'));
      var row = el('div', 'fn-buttons');
      var open = el('button', 'admin-btn is-outline', 'Open it'); open.type = 'button'; open.addEventListener('click', function () { location.hash = '#new'; });
      var drop = el('button', 'admin-btn is-outline', 'Discard it'); drop.type = 'button'; drop.addEventListener('click', function () { lsDel(backupKey('new')); renderPosts(); });
      row.appendChild(open); row.appendChild(drop); banner.appendChild(row);
    } else banner.hidden = true;
  }

  // ---------- categories view ----------
  function renderCategories() {
    var box = $('cat-list'); clear(box);
    if (!state.categories.length) box.appendChild(el('p', 'empty', 'No categories yet. Type a name above, or create one while writing a post.'));
    state.categories.forEach(function (c) { box.appendChild(categoryRow(c)); });
  }
  function categoryRow(c) {
    var row = el('div', 'fn-cat');
    row.appendChild(el('span', 'fn-cat-name', c.name));
    row.appendChild(el('span', 'fn-cat-count', c.count + (c.count === 1 ? ' post' : ' posts')));
    var rename = el('button', 'admin-btn is-outline', 'Rename'); rename.type = 'button';
    var del = el('button', 'admin-btn is-outline fn-danger', 'Delete'); del.type = 'button';
    row.appendChild(rename); row.appendChild(del);
    rename.addEventListener('click', function () {
      clear(row);
      var input = el('input', 'bk-input'); input.type = 'text'; input.value = c.name; input.maxLength = 60; input.setAttribute('aria-label', 'New name for ' + c.name);
      var ok = el('button', 'admin-btn', 'Save'); ok.type = 'button';
      var no = el('button', 'admin-btn is-outline', 'Cancel'); no.type = 'button';
      row.appendChild(input); row.appendChild(ok); row.appendChild(no);
      input.focus(); input.select();
      var go = async function () {
        var r = await safeApi('note-categories', { method: 'POST', body: { id: c.id, name: input.value } }, $('cat-error'));
        if (r && r.ok) { say($('cat-error'), ''); await refreshCategories(); renderCategories(); renderPosts(); }
      };
      ok.addEventListener('click', go);
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); go(); } else if (e.key === 'Escape') renderCategories(); });
      no.addEventListener('click', renderCategories);
    });
    del.addEventListener('click', function () {
      clear(row);
      row.appendChild(el('span', 'fn-cat-name', 'Delete "' + c.name + '"? It is removed from ' + c.count + (c.count === 1 ? ' post' : ' posts') + '. The posts themselves stay.'));
      var yes = el('button', 'admin-btn fn-danger-solid', 'Yes, delete'); yes.type = 'button';
      var no = el('button', 'admin-btn is-outline', 'Keep it'); no.type = 'button';
      row.appendChild(yes); row.appendChild(no);
      yes.addEventListener('click', async function () {
        var r = await safeApi('note-categories', { method: 'DELETE', query: { id: c.id, confirm: 'yes' } }, $('cat-error'));
        if (r && r.ok) { say($('cat-error'), ''); await loadLists(); renderCategories(); renderPosts(); }
      });
      no.addEventListener('click', renderCategories);
    });
    return row;
  }
  // Like api(), but shows problems in `where` and returns null when it already handled them.
  async function safeApi(route, options, where) {
    var r;
    try { r = await api(route, options); } catch (e) { say(where, 'Could not reach the server. Check your connection.', true); return null; }
    if (commonProblem(r)) return null;
    if (!r.ok) { say(where, (r.body && r.body.error) || 'Something went wrong.', true); return null; }
    return r;
  }
  async function refreshCategories() {
    var r = await api('note-categories').catch(function () { return null; });
    if (r && r.ok) state.categories = r.body.categories || [];
  }

  // ---------- the editor model ----------
  function newEditor() {
    return {
      id: null, version: null, status: 'draft', publishedAt: null,
      title: '', summary: '', body: '', slug: '', lang: 'en', thaiFont: T.DEFAULT_THAI_FONT, categoryIds: [],
      autoSlug: true, langTouched: false,
      savedFp: '', saving: false, again: false, conflict: false, composing: 0,
      timers: { autosave: null, backup: null, preview: null, retry: null },
      seed: Math.random().toString(36).slice(2, 8).padEnd(6, '0'),
    };
  }
  // A change-detector. The slug only counts once the owner has chosen it: an automatic slug is decided by the server.
  function fingerprint(e, slugOverride) {
    return JSON.stringify([e.title, e.summary, e.body, e.autoSlug ? '' : (slugOverride !== undefined ? slugOverride : e.slug), e.lang, e.thaiFont, e.categoryIds.slice().sort()]);
  }
  var isDirty = function () { return !!ed && fingerprint(ed) !== ed.savedFp; };
  var isPublished = function () { return !!ed && ed.status === 'published'; };

  function backupKey(id) { return 'fn_backup_' + (id || 'new'); }
  function readBackup(id) {
    var raw = lsGet(backupKey(id));
    if (!raw) return null;
    try { var b = JSON.parse(raw); return b && typeof b === 'object' ? b : null; } catch (e) { return null; }
  }
  function writeBackup() {
    if (!ed) return;
    if (!isDirty() && ed.id) { lsDel(backupKey(ed.id)); return; }
    if (!ed.title && !ed.body && !ed.summary) { lsDel(backupKey(ed.id)); return; }
    lsSet(backupKey(ed.id), JSON.stringify({ title: ed.title, summary: ed.summary, body: ed.body, slug: ed.slug, autoSlug: ed.autoSlug, lang: ed.lang, thaiFont: ed.thaiFont, categoryIds: ed.categoryIds, at: new Date().toISOString() }));
  }

  // The slug a title would make (shown live; the server makes the final, unique one).
  function suggestSlug() {
    var ascii = T.asciiSlug(ed.title);
    if (ascii) return ascii;
    if (!ed.title.trim()) return '';
    if (T.DATE_ID_SLUG.test(ed.slug)) return ed.slug;
    return T.chiangMaiDate(new Date()) + '-' + ed.seed;
  }

  // ---------- status line / banners / buttons ----------
  function setState(text, kind) {
    var s = $('ed-state');
    s.textContent = text || '';
    s.classList.toggle('is-error', kind === 'error');
    s.classList.toggle('is-ok', kind === 'ok');
  }
  function describeState() {
    if (!ed || ed.conflict) return;
    if (ed.saving) return setState('Saving…');
    if (!ed.title.trim() && (ed.body || ed.summary)) return setState('Add a title to start saving. Your text is kept on this device.');
    if (isPublished()) return setState(isDirty() ? 'Unsaved changes. The published version has not changed. Press Update to publish them.' : 'Up to date.', isDirty() ? '' : 'ok');
    if (!ed.id && !isDirty()) return setState('');
    if (isDirty()) return setState(navigator.onLine === false ? 'Offline. Kept on this device.' : 'Not saved yet…');
    return setState('Saved ' + clock(new Date()), 'ok');
  }
  function updateButtons() {
    var pub = isPublished();
    $('btn-save').textContent = pub ? 'Update' : 'Save draft';
    $('btn-save').disabled = ed.saving || ed.conflict;
    setHidden($('btn-publish'), pub);
    $('btn-publish').disabled = ed.saving || ed.conflict;
    setHidden($('btn-unpublish'), !pub);
    $('btn-unpublish').disabled = ed.saving || ed.conflict;
    setHidden($('btn-delete'), !ed.id);
    var badge = $('ed-badge');
    badge.textContent = pub ? 'Published' : 'Draft';
    badge.classList.toggle('is-published', pub);
  }
  function banner(kind, message, buttons) {
    var b = $('ed-banner'); clear(b);
    b.classList.toggle('is-warn', kind === 'warn');
    if (!message) { b.hidden = true; return; }
    b.hidden = false;
    b.appendChild(el('p', 'fn-banner-text', message));
    var row = el('div', 'fn-buttons');
    (buttons || []).forEach(function (x) {
      var btn = el('button', 'admin-btn is-outline', x.label); btn.type = 'button'; btn.addEventListener('click', x.run); row.appendChild(btn);
    });
    if (buttons && buttons.length) b.appendChild(row);
  }

  // ---------- writing the model into the form and back ----------
  function fillForm() {
    $('f-title').value = ed.title; $('f-summary').value = ed.summary; $('f-body').value = ed.body;
    $('f-slug').value = ed.slug; $('f-lang').value = ed.lang; $('f-font').value = ed.thaiFont;
    refreshLangUi(); renderChips(); renderPreviewNow(); updateCounts(); updateButtons(); describeState();
  }
  function refreshLangUi() {
    var th = ed.lang === 'th';
    $('view-editor').dataset.lang = ed.lang;
    ['f-title', 'f-summary', 'f-body'].forEach(function (id) { $(id).lang = ed.lang; });
    applyFontClasses($('view-editor'), ed.lang, ed.thaiFont);
    setHidden($('font-wrap'), !th);
    var hint = $('lang-hint');
    if (!ed.langTouched) {
      var suggested = T.suggestLang(ed.title + ' ' + ed.summary + ' ' + ed.body);
      hint.textContent = suggested === 'th' ? 'Looks like Thai. Set automatically.' : 'Set automatically from what you write.';
    } else hint.textContent = 'Set by you.';
  }
  function updateCounts() {
    var n = T.codepointLength(ed.body);
    var c = $('body-count');
    c.textContent = n.toLocaleString('en-US') + ' / ' + T.LIMITS.body.toLocaleString('en-US') + ' characters';
    c.parentNode.classList.toggle('is-over', n > T.LIMITS.body);
    $('cat-limit').textContent = '(' + ed.categoryIds.length + ' of ' + T.LIMITS.categoriesPerPost + ')';
  }

  // Live preview: the owner's text through the safe renderer inside the article style the public pages will reuse.
  function renderPreviewNow() {
    var art = $('preview'); clear(art);
    art.lang = ed.lang;
    applyFontClasses(art, ed.lang, ed.thaiFont);
    art.appendChild(el('h1', 'fn-title', ed.title || 'Untitled'));
    if (ed.summary) art.appendChild(el('p', 'fn-summary', ed.summary));
    art.appendChild(el('hr', 'fn-rule'));
    var body = el('div', 'fn-body');
    body.innerHTML = R.render(ed.body); // safe: every character is escaped by the renderer; only its small allow-list of tags is produced
    art.appendChild(body);
  }
  function schedulePreview() {
    if (ed.timers.preview) clearTimeout(ed.timers.preview);
    ed.timers.preview = setTimeout(renderPreviewNow, 120);
  }

  // ---------- reacting to typing ----------
  function onEdit() {
    if (!ed) return;
    if (ed.conflict) { schedulePreview(); scheduleBackup(); return; }
    updateCounts(); schedulePreview(); scheduleBackup(); scheduleAutosave();
    describeState();
  }
  // Things worked out from the text (slug, language) wait until an IME is not mid-word.
  function updateDerived() {
    if (!ed || ed.composing) return;
    if (!ed.langTouched) {
      var l = T.suggestLang(ed.title + ' ' + ed.summary + ' ' + ed.body);
      if (l !== ed.lang) { ed.lang = l; $('f-lang').value = l; }
    }
    if (ed.autoSlug && !ed.publishedAt && ed.status === 'draft') { ed.slug = suggestSlug(); $('f-slug').value = ed.slug; }
    refreshLangUi();
  }
  function scheduleBackup() {
    if (ed.timers.backup) clearTimeout(ed.timers.backup);
    ed.timers.backup = setTimeout(writeBackup, 400);
  }
  function scheduleAutosave() {
    if (ed.timers.autosave) clearTimeout(ed.timers.autosave);
    if (isPublished() || ed.conflict) return; // a published post only changes when the owner presses Update
    ed.timers.autosave = setTimeout(function tick() {
      if (!ed) return;
      if (ed.composing) { ed.timers.autosave = setTimeout(tick, 1000); return; } // never in the middle of IME composition
      if (isDirty() && ed.title.trim()) doSave('autosave');
    }, AUTOSAVE_MS);
  }

  // ---------- saving ----------
  function payload(mode) {
    var p = { mode: mode, title: ed.title, summary: ed.summary, body: ed.body, lang: ed.lang, thaiFont: ed.thaiFont, categoryIds: ed.categoryIds };
    if (ed.id) { p.id = ed.id; p.version = ed.version; }
    if (ed.autoSlug && !ed.publishedAt && ed.status === 'draft') p.autoSlug = true; else if (ed.slug) p.slug = ed.slug;
    return p;
  }
  // mode: 'autosave' | 'save'. Resolves true when the server has the text.
  async function doSave(mode) {
    if (!ed || ed.conflict) return false;
    if (!ed.title.trim()) { setState('Add a title first.', 'error'); return false; }
    if (ed.saving) { ed.again = true; return false; }
    if (mode === 'autosave' && isPublished()) return false;
    ed.saving = true; updateButtons(); describeState();
    var sentAuto = ed.autoSlug, sentSlug = ed.slug;
    var r;
    var payloadSent = payload(mode);
    try { r = await api('note-save', { method: 'POST', body: payloadSent }); }
    catch (e) { return failSave('offline'); }
    ed.saving = false;
    if (r.status === 401) { setState('Signed out. Sign in at /admin. Your text is kept on this device.', 'error'); updateButtons(); return false; }
    if (r.status === 503 && r.body.code === 'MIGRATION_REQUIRED') { setState(r.body.error, 'error'); updateButtons(); return false; }
    if (r.status === 409 && (r.body.code === 'STALE_VERSION' || r.body.code === 'PUBLISHED_NO_AUTOSAVE')) { enterConflict(r.body); return false; }
    if (r.status === 409 && r.body.code === 'SLUG_TAKEN') { say($('slug-error'), r.body.error, true); setState('Not saved: that slug is taken.', 'error'); updateButtons(); return false; }
    if (!r.ok) { setState('Not saved: ' + (r.body.error || 'something went wrong') + '.', 'error'); updateButtons(); return false; }
    say($('slug-error'), '');
    var post = r.body.post;
    ed.id = post.id; ed.version = post.version; ed.status = post.status; ed.publishedAt = post.publishedAt;
    // what the server now holds, as the change-detector sees it (typing during the save leaves the page "dirty" again)
    var sent = { title: payloadSent.title, summary: payloadSent.summary, body: payloadSent.body, lang: payloadSent.lang, thaiFont: payloadSent.thaiFont, categoryIds: payloadSent.categoryIds, autoSlug: sentAuto };
    ed.savedFp = fingerprint(sent, post.slug);
    if (sentAuto || ed.slug === sentSlug) { ed.slug = post.slug; $('f-slug').value = post.slug; }
    if (location.hash === '#new') history.replaceState(null, '', '#' + ed.id);
    lsDel(backupKey('new'));
    if (!isDirty()) lsDel(backupKey(ed.id)); else writeBackup();
    upsertListPost(post);
    updateButtons(); describeState();
    if (ed.again || (isDirty() && !isPublished())) { ed.again = false; scheduleAutosave(); }
    return true;
  }
  function failSave(kind) {
    ed.saving = false; updateButtons();
    setState(kind === 'offline' ? 'Offline. Kept on this device. Will retry.' : 'Not saved.', 'error');
    writeBackup();
    if (ed.timers.retry) clearTimeout(ed.timers.retry);
    ed.timers.retry = setTimeout(function () { if (ed && isDirty() && !isPublished() && ed.title.trim()) doSave('autosave'); }, 10000);
    return false;
  }
  function upsertListPost(post) {
    var i = state.posts.findIndex(function (p) { return p.id === post.id; });
    if (i >= 0) state.posts[i] = post; else state.posts.unshift(post);
    state.posts.sort(function (a, b) { return (a.updatedAt < b.updatedAt) ? 1 : -1; });
  }

  function enterConflict(info) {
    ed.conflict = true; ed.saving = false;
    if (ed.timers.autosave) clearTimeout(ed.timers.autosave);
    writeBackup();
    updateButtons();
    setState('Not saved: this post changed somewhere else.', 'error');
    var published = info && info.code === 'PUBLISHED_NO_AUTOSAVE';
    banner('warn', published
      ? 'This post was published in another tab or window. Nothing was overwritten, and your text is kept on this device.'
      : 'This post was changed in another tab or window. Nothing was overwritten, and your text is kept on this device.', [
      { label: 'Load the latest version', run: async function () { writeBackup(); await openPost(ed.id, true); } },
    ]);
  }

  async function publishNow(wantPublish) {
    if (!ed) return;
    setHidden($('delete-confirm'), true);
    if (wantPublish) {
      if (!ed.title.trim()) { setState('Add a title first.', 'error'); return; }
      if (!ed.body.trim()) { setState('Write something before publishing.', 'error'); return; }
      if (isDirty() || !ed.id) { var ok = await doSave('save'); if (!ok) return; }
    }
    ed.saving = true; updateButtons(); setState('Saving…');
    var r;
    try { r = await api('note-publish', { method: 'POST', body: { id: ed.id, version: ed.version, publish: wantPublish } }); }
    catch (e) { return failSave('offline'); }
    ed.saving = false;
    if (r.status === 409 && r.body.code === 'STALE_VERSION') { enterConflict(r.body); return; }
    if (commonProblem(r)) return;
    if (!r.ok) { say($('ed-error'), r.body.error || 'Could not do that.', true); updateButtons(); describeState(); return; }
    say($('ed-error'), '');
    var post = r.body.post;
    var wasClean = !isDirty();
    ed.version = post.version; ed.status = post.status; ed.publishedAt = post.publishedAt;
    ed.autoSlug = false; ed.slug = post.slug; $('f-slug').value = post.slug; // once published, the slug only changes when the owner types one
    if (wasClean) ed.savedFp = fingerprint(ed);
    upsertListPost(post);
    updateButtons();
    setState(wantPublish ? 'Published. Public pages arrive in the next update, so nothing is visible on the website yet.' : 'Unpublished. It is a draft again.', 'ok');
    if (!wantPublish) { if (isDirty()) scheduleAutosave(); }
  }

  async function deleteNow() {
    if (!ed || !ed.id) return;
    var r = await safeApi('note', { method: 'DELETE', query: { id: ed.id, confirm: 'yes' } }, $('ed-error'));
    if (!r) return;
    lsDel(backupKey(ed.id));
    state.posts = state.posts.filter(function (p) { return p.id !== ed.id; });
    leaveEditor(true);
  }

  // ---------- opening / leaving ----------
  function resetTimers() { if (!ed) return; Object.keys(ed.timers).forEach(function (k) { if (ed.timers[k]) clearTimeout(ed.timers[k]); }); }

  async function openPost(id, silent) {
    var r;
    try { r = await api('note', { query: { id: id } }); } catch (e) { say($('fn-status'), 'Could not reach the server.', true); return; }
    if (commonProblem(r)) return;
    if (!r.ok) { alert(r.body.error || 'Could not open that post.'); location.hash = ''; return; }
    var p = r.body.post;
    resetTimers();
    ed = newEditor();
    ed.id = p.id; ed.version = p.version; ed.status = p.status; ed.publishedAt = p.publishedAt;
    ed.title = p.title; ed.summary = p.summary || ''; ed.body = p.body || ''; ed.slug = p.slug; ed.lang = p.lang; ed.thaiFont = p.thaiFont || T.DEFAULT_THAI_FONT;
    ed.categoryIds = (p.categoryIds || []).slice();
    ed.langTouched = true;
    ed.autoSlug = p.status === 'draft' && !p.publishedAt && (p.slug === T.asciiSlug(p.title) || (!T.asciiSlug(p.title) && T.DATE_ID_SLUG.test(p.slug)));
    ed.savedFp = fingerprint(ed);
    startEditor(silent);
    if (location.hash !== '#' + p.id) history.replaceState(null, '', '#' + p.id);
  }
  function openNew() {
    resetTimers();
    ed = newEditor();
    ed.savedFp = fingerprint(ed);
    startEditor(false);
    var b = readBackup('new');
    if (b && (b.title || b.body)) offerRestore(b);
  }
  function startEditor(silent) {
    showView('editor');
    setHidden($('delete-confirm'), true); say($('ed-error'), ''); say($('slug-error'), '');
    banner(null, '');
    fillForm();
    setState('');
    if (ed.id && !silent) { var b = readBackup(ed.id); if (b && differsFromServer(b)) offerRestore(b); }
    if (ed.id && silent) { var b2 = readBackup(ed.id); if (b2) offerRestore(b2); }
    if (!ed.title) $('f-title').focus();
  }
  function differsFromServer(b) {
    var snap = { title: b.title || '', summary: b.summary || '', body: b.body || '', lang: b.lang === 'th' ? 'th' : 'en', thaiFont: b.thaiFont || T.DEFAULT_THAI_FONT, categoryIds: b.categoryIds || [], autoSlug: ed.autoSlug && b.autoSlug !== false };
    return fingerprint(snap, b.slug || '') !== ed.savedFp;
  }
  function offerRestore(b) {
    banner('info', 'Unsaved text from ' + niceDate(b.at) + ' was kept on this device.', [
      { label: 'Restore it', run: function () {
        ed.title = b.title || ''; ed.summary = b.summary || ''; ed.body = b.body || ''; ed.slug = b.slug || ed.slug; ed.lang = b.lang === 'th' ? 'th' : 'en'; ed.thaiFont = T.isThaiFontKey(b.thaiFont) ? b.thaiFont : ed.thaiFont;
        ed.categoryIds = (b.categoryIds || []).filter(function (id) { return !!catName(id); }).slice(0, T.LIMITS.categoriesPerPost);
        ed.autoSlug = b.autoSlug !== false && ed.autoSlug; ed.langTouched = true; ed.conflict = false;
        fillForm(); banner(null, ''); onEdit();
      } },
      { label: 'Discard it', run: function () { lsDel(backupKey(ed.id)); banner(null, ''); } },
    ]);
  }

  async function leaveEditor(skipSave) {
    if (ed && !skipSave && isDirty()) {
      if (isPublished()) { writeBackup(); if (!window.confirm('You have unsaved changes to a published post. They are kept on this device, but are not live. Leave anyway?')) return false; }
      else if (ed.title.trim() && !ed.conflict) await doSave('autosave');
      else writeBackup();
    }
    resetTimers(); ed = null;
    history.replaceState(null, '', location.pathname + location.search);
    await loadLists(); // fresh list (drafts / published / counts)
    renderPosts(); renderCategories();
    showView('posts');
    return true;
  }

  // ---------- toolbar and shortcuts ----------
  function applyToBody(edit) {
    var ta = $('f-body');
    ta.focus();
    ta.setSelectionRange(edit.from, edit.to);
    var expected = T.applyEdit(ta.value, edit);
    var done = false;
    try { done = document.execCommand('insertText', false, edit.insert); } catch (e) { done = false; } // keeps the browser's own undo history
    if (!done || ta.value !== expected) { // a browser that refused: set the text directly
      ta.value = expected;
      ed.body = expected; updateDerived(); onEdit();
    }
    ta.setSelectionRange(edit.selStart, edit.selEnd);
  }
  function runCommand(cmd) {
    if (!ed || ed.composing) return;
    var ta = $('f-body'), s = ta.selectionStart, e = ta.selectionEnd, text = ta.value;
    var edit;
    if (cmd === 'bold') edit = T.wrapEdit(text, s, e, '**', '**', 'bold text');
    else if (cmd === 'italic') edit = T.wrapEdit(text, s, e, '*', '*', 'italic text');
    else if (cmd === 'h2' || cmd === 'h3' || cmd === 'quote' || cmd === 'ul' || cmd === 'ol') edit = T.lineEdit(text, s, e, cmd);
    else if (cmd === 'link') edit = T.linkEdit(text, s, e);
    else if (cmd === 'hr') edit = T.dividerEdit(text, e);
    if (edit) applyToBody(edit);
  }

  // ---------- categories on a post ----------
  function renderChips() {
    var box = $('chips'); clear(box);
    ed.categoryIds.forEach(function (id) {
      var name = catName(id); if (!name) return;
      var chip = el('span', 'fn-chip'); chip.appendChild(el('span', null, name));
      var x = el('button', null, '×'); x.type = 'button'; x.setAttribute('aria-label', 'Remove category ' + name);
      x.addEventListener('click', function () { ed.categoryIds = ed.categoryIds.filter(function (c) { return c !== id; }); renderChips(); updateCounts(); onEdit(); });
      chip.appendChild(x); box.appendChild(chip);
    });
    updateCounts();
  }
  var suggest = { items: [], index: -1 };
  function renderSuggest() {
    var list = $('cat-suggest'), q = T.categoryKey($('f-cat').value);
    clear(list); suggest.items = [];
    if (document.activeElement === $('f-cat')) {
      suggest.items = state.categories.filter(function (c) { return ed.categoryIds.indexOf(c.id) < 0 && (!q || T.categoryKey(c.name).indexOf(q) >= 0); }).slice(0, 8);
    }
    suggest.items.forEach(function (c, i) {
      var li = el('li', null, c.name); li.setAttribute('role', 'option'); li.setAttribute('aria-selected', i === suggest.index ? 'true' : 'false');
      li.addEventListener('mousedown', function (ev) { ev.preventDefault(); addCategoryById(c.id); });
      list.appendChild(li);
    });
    list.hidden = !suggest.items.length;
    $('f-cat').setAttribute('aria-expanded', suggest.items.length ? 'true' : 'false');
  }
  function addCategoryById(id) {
    if (ed.categoryIds.indexOf(id) >= 0) return;
    if (ed.categoryIds.length >= T.LIMITS.categoriesPerPost) { say($('cat-msg'), 'A post can have at most ' + T.LIMITS.categoriesPerPost + ' categories.', true); return; }
    ed.categoryIds.push(id); $('f-cat').value = ''; suggest.index = -1; say($('cat-msg'), '');
    renderChips(); renderSuggest(); onEdit();
  }
  async function addCategoryFromInput() {
    var input = $('f-cat'), raw = input.value;
    var clean = T.cleanCategoryName(raw);
    if (!clean.ok) { if (raw.trim()) say($('cat-msg'), clean.error, true); return; }
    var existing = state.categories.filter(function (c) { return T.categoryKey(c.name) === T.categoryKey(clean.name); })[0];
    if (existing) return addCategoryById(existing.id);
    if (ed.categoryIds.length >= T.LIMITS.categoriesPerPost) { say($('cat-msg'), 'A post can have at most ' + T.LIMITS.categoriesPerPost + ' categories.', true); return; }
    var r = await safeApi('note-categories', { method: 'POST', body: { name: clean.name } }, $('cat-msg'));
    if (!r) return;
    var c = r.body.category;
    if (!catName(c.id)) state.categories.push({ id: c.id, name: c.name, slug: c.slug, count: 0 });
    state.categories.sort(function (a, b) { return a.name.localeCompare(b.name); });
    addCategoryById(c.id);
    say($('cat-msg'), r.body.existed ? '' : 'Created "' + c.name + '".', false);
  }

  // ---------- wiring ----------
  function track(input, field, after) {
    input.addEventListener('compositionstart', function () { if (ed) ed.composing++; });
    input.addEventListener('compositionend', function () { if (ed) { ed.composing = Math.max(0, ed.composing - 1); updateDerived(); onEdit(); } });
    input.addEventListener('input', function () {
      if (!ed) return;
      ed[field] = input.value;
      if (after) after();
      updateDerived(); onEdit();
    });
  }

  function init() {
    // font choices
    T.THAI_FONTS.forEach(function (f) { var o = el('option', null, f.label); o.value = f.key; $('f-font').appendChild(o); });

    track($('f-title'), 'title'); track($('f-summary'), 'summary'); track($('f-body'), 'body');
    $('f-slug').addEventListener('input', function () {
      if (!ed) return;
      ed.slug = $('f-slug').value; ed.autoSlug = false;
      var n = T.normalizeSlug(ed.slug);
      say($('slug-error'), ed.slug.trim() && !n.ok ? n.error : '', true);
      onEdit();
    });
    $('f-slug').addEventListener('blur', function () {
      if (!ed || ed.autoSlug) return;
      var n = T.normalizeSlug($('f-slug').value);
      if (n.ok) { ed.slug = n.slug; $('f-slug').value = n.slug; onEdit(); }
      else if (!$('f-slug').value.trim()) { ed.autoSlug = true; updateDerived(); onEdit(); }
    });
    $('f-lang').addEventListener('change', function () { ed.lang = $('f-lang').value; ed.langTouched = true; refreshLangUi(); renderPreviewNow(); onEdit(); });
    $('f-font').addEventListener('change', function () { ed.thaiFont = $('f-font').value; refreshLangUi(); renderPreviewNow(); onEdit(); });

    // toolbar: mousedown keeps the focus (and selection) in the text box
    document.querySelectorAll('.fn-toolbar button').forEach(function (b) {
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b.addEventListener('click', function () { runCommand(b.dataset.cmd); });
    });
    $('f-body').addEventListener('keydown', function (e) {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.isComposing) return;
      var k = e.key.toLowerCase();
      if (k === 'b') { e.preventDefault(); runCommand('bold'); }
      else if (k === 'i') { e.preventDefault(); runCommand('italic'); }
      else if (k === 'k') { e.preventDefault(); runCommand('link'); }
    });
    document.addEventListener('keydown', function (e) {
      if (!ed || state.view !== 'editor' || !(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 's') return;
      e.preventDefault(); if (!ed.composing) doSave('save');
    });

    // categories on a post
    var cat = $('f-cat');
    cat.addEventListener('focus', renderSuggest);
    cat.addEventListener('blur', function () { setTimeout(function () { $('cat-suggest').hidden = true; }, 120); });
    cat.addEventListener('compositionstart', function () { if (ed) ed.composing++; });
    cat.addEventListener('compositionend', function () { if (ed) ed.composing = Math.max(0, ed.composing - 1); renderSuggest(); });
    cat.addEventListener('input', function () { suggest.index = -1; renderSuggest(); say($('cat-msg'), ''); });
    cat.addEventListener('keydown', function (e) {
      if (e.isComposing || e.keyCode === 229) return; // Return while choosing a Thai word must not create a category
      if (e.key === 'ArrowDown' && suggest.items.length) { e.preventDefault(); suggest.index = (suggest.index + 1) % suggest.items.length; renderSuggest(); }
      else if (e.key === 'ArrowUp' && suggest.items.length) { e.preventDefault(); suggest.index = (suggest.index - 1 + suggest.items.length) % suggest.items.length; renderSuggest(); }
      else if (e.key === 'Escape') { $('cat-suggest').hidden = true; }
      else if (e.key === 'Enter') {
        e.preventDefault();
        if (suggest.index >= 0 && suggest.items[suggest.index]) addCategoryById(suggest.items[suggest.index].id);
        else addCategoryFromInput();
      } else if (e.key === 'Backspace' && !cat.value && ed.categoryIds.length) { /* leave chips alone: remove with the x */ }
    });

    // buttons
    $('btn-save').addEventListener('click', function () { doSave('save'); });
    $('btn-publish').addEventListener('click', function () { publishNow(true); });
    $('btn-unpublish').addEventListener('click', function () { publishNow(false); });
    $('btn-delete').addEventListener('click', function () { setHidden($('delete-confirm'), false); $('btn-delete-no').focus(); });
    $('btn-delete-no').addEventListener('click', function () { setHidden($('delete-confirm'), true); });
    $('btn-delete-yes').addEventListener('click', deleteNow);
    $('ed-back').addEventListener('click', function () { leaveEditor(false); });
    $('pane-edit').addEventListener('click', function () { setPane('edit'); });
    $('pane-preview').addEventListener('click', function () { renderPreviewNow(); setPane('preview'); });

    $('tab-posts').addEventListener('click', function () { renderPosts(); showView('posts'); });
    $('tab-categories').addEventListener('click', async function () { await refreshCategories(); renderCategories(); say($('cat-error'), ''); showView('categories'); });
    $('new-post').addEventListener('click', function () { location.hash = '#new'; });
    $('cat-add-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var clean = T.cleanCategoryName($('cat-add-input').value);
      if (!clean.ok) { say($('cat-error'), clean.error, true); return; }
      var r = await safeApi('note-categories', { method: 'POST', body: { name: clean.name } }, $('cat-error'));
      if (r) { $('cat-add-input').value = ''; say($('cat-error'), ''); await refreshCategories(); renderCategories(); }
    });

    window.addEventListener('beforeunload', function (e) {
      if (ed && isDirty()) { writeBackup(); e.preventDefault(); e.returnValue = ''; }
    });
    window.addEventListener('online', function () { if (ed && isDirty() && !isPublished() && ed.title.trim() && !ed.conflict) doSave('autosave'); else describeState(); });
    window.addEventListener('offline', function () { if (ed) describeState(); });
    window.addEventListener('hashchange', route);
    document.addEventListener('visibilitychange', function () { if (document.hidden && ed) writeBackup(); });
  }
  function setPane(which) {
    $('ed-grid').dataset.pane = which;
    $('pane-edit').setAttribute('aria-selected', which === 'edit' ? 'true' : 'false');
    $('pane-preview').setAttribute('aria-selected', which === 'preview' ? 'true' : 'false');
    window.scrollTo(0, 0);
  }

  // #new -> new post, #<id> -> that post, nothing -> the list
  async function route() {
    if (!state.loaded) return;
    var h = location.hash.replace(/^#/, '');
    if (ed && state.view === 'editor' && ((h === 'new' && !ed.id) || (ed.id && h === ed.id))) return; // already there
    if (ed && state.view === 'editor') { if (isDirty() && ed.title.trim() && !isPublished() && !ed.conflict) doSave('autosave'); else if (isDirty()) writeBackup(); resetTimers(); ed = null; }
    if (h === 'new') return openNew();
    if (/^[0-9a-f-]{36}$/i.test(h)) return openPost(h.toLowerCase());
    await loadLists(); renderPosts(); renderCategories(); showView('posts');
  }

  document.addEventListener('DOMContentLoaded', async function () {
    init();
    if (await loadLists()) { renderPosts(); renderCategories(); showView('posts'); await route(); }
  });
  // the page's own test hooks (read-only)
  window.__fn = { state: function () { return state; }, ed: function () { return ed; } };
})();
