/*
  Admin "Field Notes" routes (the owner's blog writing tools). Called from lib/admin.js AFTER it has checked the HTTP
  method, the same-origin rule (writes), the signed session cookie and "JSON only" (POST). Each handler returns
  { status, body } so it can be tested without HTTP. They live in the existing admin dispatcher (api/forms.js ->
  lib/admin.js), so no new Vercel function is added.

  Routes (reached as /api/forms?admin=<route>):
    notes            GET     list posts (no bodies) + categories with counts
    note             GET     ?id=...            one post, with its body
                     DELETE  ?id=...&confirm=yes
    note-save        POST    create (no id) or save an existing post: { id?, version?, mode, title, summary, body, slug, lang, thaiFont, categoryIds }
    note-publish     POST    { id, version, publish: true|false }
    note-categories  GET     list
                     POST    { name } create (or return the existing one)  |  { id, name } rename
                     DELETE  ?id=...&confirm=yes   (only unlinks it from posts)

  Rules that matter:
  - Validation is strict and happens before the database is touched; unknown fields are refused.
  - A save needs the post's current `version`; a stale one gets a 409 and nothing is written (edit-conflict protection).
  - mode 'autosave' can NEVER change a published post (409 PUBLISHED_NO_AUTOSAVE). Changing a published post needs mode 'save'.
  - Publishing only sets status (and published_at, once). Nothing here is public yet.
  - If the tables don't exist yet, every route answers 503 + code MIGRATION_REQUIRED and touches nothing.
  - Changes are logged to admin_actions when that table exists (autosaves are not logged).
*/
const crypto = require('crypto');
const T = require('../assets/fn-text');
const { isMissingTable } = require('./blocks');

const MIGRATION_MESSAGE = 'Field Notes needs a one-time database setup. Run supabase/migrations/0006_fieldnotes.sql in the Supabase SQL editor, then reload this page.';
const migrationRequired = () => ({ status: 503, body: { error: MIGRATION_MESSAGE, code: 'MIGRATION_REQUIRED' } });
const bad = (error, extra) => ({ status: 400, body: { error, ...(extra || {}) } });
const conflict = (error, code, extra) => ({ status: 409, body: { error, code, ...(extra || {}) } });

const METHODS = {
  notes: ['GET'],
  note: ['GET', 'DELETE'],
  'note-save': ['POST'],
  'note-publish': ['POST'],
  'note-categories': ['GET', 'POST', 'DELETE'],
};
const isNotesRoute = (route) => Object.prototype.hasOwnProperty.call(METHODS, route);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POST_COLUMNS = 'id, slug, title, summary, body_md, lang, thai_font, status, published_at, created_at, updated_at, version';

// ---------- shapes (whitelist: only these fields ever leave the server) ----------
function shapePost(p, categoryIds, withBody) {
  return {
    id: p.id, slug: p.slug, title: p.title, summary: p.summary || '', lang: p.lang, thaiFont: p.thai_font || T.DEFAULT_THAI_FONT,
    status: p.status, publishedAt: p.published_at || null, createdAt: p.created_at, updatedAt: p.updated_at, version: p.version,
    categoryIds: categoryIds || [],
    ...(withBody ? { body: p.body_md || '' } : {}),
  };
}
const shapeCategory = (c, count) => ({ id: c.id, name: c.name, slug: c.slug, ...(count !== undefined ? { count } : {}) });

// ---------- tiny helpers ----------
function unknownKey(body, allowed) { return Object.keys(body).find((k) => !allowed.includes(k)); }
const isInt = (n) => Number.isInteger(n) && n >= 1 && n <= 2147483000;
const randId = () => crypto.randomBytes(4).toString('hex').slice(0, 6);

async function logAction(ctx, action, payload) {
  try {
    const { error } = await ctx.supabase.from('admin_actions').insert({ action, payload });
    if (error && !isMissingTable(error)) console.error('admin_actions log failed:', error.code || '', error.message);
    return !error;
  } catch (e) { return false; }
}

async function categoryIdsOf(ctx, postId) {
  const { data, error } = await ctx.supabase.from('fieldnotes_post_categories').select('category_id').eq('post_id', postId);
  if (error) throw error;
  return (data || []).map((r) => r.category_id);
}
async function slugTaken(ctx, slug, exceptId) {
  const { data, error } = await ctx.supabase.from('fieldnotes_posts').select('id').eq('slug', slug).limit(1);
  if (error) throw error;
  return (data || []).some((r) => r.id !== exceptId);
}
async function getPostRow(ctx, id) {
  const { data, error } = await ctx.supabase.from('fieldnotes_posts').select(POST_COLUMNS).eq('id', id).maybeSingle();
  if (error) throw error;
  return data || null;
}

// Free slug: the wanted one, or wanted-2, wanted-3 ... (only used for slugs WE generated, never for ones the owner typed).
async function freeSlug(ctx, wanted, exceptId) {
  const base = wanted.slice(0, T.LIMITS.slug - 4).replace(/-+$/, '');
  for (let n = 1; n <= 30; n++) {
    const cand = n === 1 ? wanted : `${base}-${n}`;
    if (!(await slugTaken(ctx, cand, exceptId))) return cand;
  }
  return `${base}-${randId()}`;
}

// ---------- validation of a save request ----------
const SAVE_KEYS = ['id', 'version', 'mode', 'title', 'summary', 'body', 'slug', 'autoSlug', 'lang', 'thaiFont', 'categoryIds'];
function validateSave(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: bad('Send a JSON object.') };
  const extra = unknownKey(body, SAVE_KEYS);
  if (extra) return { error: bad(`Unknown field "${extra}".`) };

  const creating = body.id === undefined || body.id === null;
  let id = null, version = null;
  if (!creating) {
    if (typeof body.id !== 'string' || !UUID.test(body.id)) return { error: bad('That post id is not valid.') };
    if (!isInt(body.version)) return { error: bad('A saved post needs its version number.') };
    id = body.id.toLowerCase(); version = body.version;
  } else if (body.version !== undefined && body.version !== null) return { error: bad('A new post has no version yet.') };

  const mode = body.mode === undefined ? 'save' : body.mode;
  if (mode !== 'save' && mode !== 'autosave') return { error: bad('"mode" must be "save" or "autosave".') };

  if (typeof body.title !== 'string') return { error: bad('The title must be text.') };
  if (T.BAD_CONTROL_ANY.test(body.title.replace(/[\t\n\r]/g, ' '))) return { error: bad('The title has characters that are not allowed.') };
  const title = body.title.normalize('NFC').replace(/\s+/g, ' ').trim();
  if (!title) return { error: bad('Add a title first.') };
  if (T.codepointLength(title) > T.LIMITS.title) return { error: bad(`The title can be at most ${T.LIMITS.title} characters.`) };

  let summary; // undefined = not sent (an update then keeps what is stored)
  if (body.summary !== undefined && body.summary !== null) {
    if (typeof body.summary !== 'string') return { error: bad('The summary must be text.') };
    if (T.BAD_CONTROL_ANY.test(body.summary.replace(/[\t\n\r]/g, ' '))) return { error: bad('The summary has characters that are not allowed.') };
    summary = body.summary.normalize('NFC').replace(/\s+/g, ' ').trim();
    if (T.codepointLength(summary) > T.LIMITS.summary) return { error: bad(`The summary can be at most ${T.LIMITS.summary} characters.`) };
  }

  let text;
  if (body.body !== undefined && body.body !== null) {
    if (typeof body.body !== 'string') return { error: bad('The body must be text.') };
    if (body.body.length > T.LIMITS.body * 2) return { error: bad(`The post can be at most ${T.LIMITS.body.toLocaleString('en-US')} characters.`) };
    if (T.BAD_CONTROL.test(body.body)) return { error: bad('The body has characters that are not allowed.') };
    text = body.body.normalize('NFC').replace(/\r\n?/g, '\n');
    if (T.codepointLength(text) > T.LIMITS.body) return { error: bad(`The post can be at most ${T.LIMITS.body.toLocaleString('en-US')} characters.`) };
  }

  const lang = body.lang;
  if (lang !== undefined && lang !== 'en' && lang !== 'th') return { error: bad('The language must be "en" or "th".') };
  let thaiFont;
  if (body.thaiFont !== undefined && body.thaiFont !== null) {
    if (!T.isThaiFontKey(body.thaiFont)) return { error: bad('That Thai font is not one of the choices.') };
    thaiFont = body.thaiFont;
  }

  let slug = null; // null = not given (create: generate; update: keep)
  if (body.slug !== undefined && body.slug !== null && String(body.slug).trim() !== '') {
    const s = T.normalizeSlug(body.slug);
    if (!s.ok) return { error: bad(s.error) };
    slug = s.slug;
  }

  if (body.autoSlug !== undefined && typeof body.autoSlug !== 'boolean') return { error: bad('"autoSlug" must be true or false.') };
  const autoSlug = body.autoSlug === true && slug === null; // "let the title decide" only when no slug was typed

  let categoryIds;
  if (body.categoryIds !== undefined) {
    if (!Array.isArray(body.categoryIds)) return { error: bad('"categoryIds" must be a list.') };
    if (body.categoryIds.length > T.LIMITS.categoriesPerPost) return { error: bad(`A post can have at most ${T.LIMITS.categoriesPerPost} categories.`) };
    if (!body.categoryIds.every((c) => typeof c === 'string' && UUID.test(c))) return { error: bad('A category id is not valid.') };
    categoryIds = [...new Set(body.categoryIds.map((c) => c.toLowerCase()))];
  }
  return { value: { creating, id, version, mode, title, summary, text, lang, thaiFont, slug, autoSlug, categoryIds } };
}

async function checkCategoriesExist(ctx, ids) {
  if (!ids || !ids.length) return true;
  const { data, error } = await ctx.supabase.from('fieldnotes_categories').select('id').in('id', ids);
  if (error) throw error;
  return (data || []).length === ids.length;
}

// Make the post's links equal `ids`: remove the ones no longer wanted, add the new ones.
async function syncCategories(ctx, postId, ids) {
  const current = await categoryIdsOf(ctx, postId);
  const remove = current.filter((c) => !ids.includes(c));
  const add = ids.filter((c) => !current.includes(c));
  if (remove.length) {
    const { error } = await ctx.supabase.from('fieldnotes_post_categories').delete().eq('post_id', postId).in('category_id', remove);
    if (error) throw error;
  }
  if (add.length) {
    const { error } = await ctx.supabase.from('fieldnotes_post_categories').insert(add.map((c) => ({ post_id: postId, category_id: c })));
    if (error) throw error;
  }
}

// ---------- GET notes ----------
async function list(ctx) {
  const posts = await ctx.supabase.from('fieldnotes_posts').select(POST_COLUMNS).order('updated_at', { ascending: false }).limit(1000);
  if (posts.error) throw posts.error;
  const cats = await ctx.supabase.from('fieldnotes_categories').select('id, name, slug').order('name', { ascending: true }).limit(500);
  if (cats.error) throw cats.error;
  const links = await ctx.supabase.from('fieldnotes_post_categories').select('post_id, category_id').limit(20000);
  if (links.error) throw links.error;
  const byPost = new Map(), counts = new Map();
  for (const l of links.data || []) {
    if (!byPost.has(l.post_id)) byPost.set(l.post_id, []);
    byPost.get(l.post_id).push(l.category_id);
    counts.set(l.category_id, (counts.get(l.category_id) || 0) + 1);
  }
  return { status: 200, body: {
    posts: (posts.data || []).map((p) => shapePost(p, byPost.get(p.id) || [], false)),
    categories: (cats.data || []).map((c) => shapeCategory(c, counts.get(c.id) || 0)),
    limits: T.LIMITS,
  } };
}

// ---------- GET note ----------
async function getOne(ctx, query) {
  const id = query && query.id;
  if (typeof id !== 'string' || !UUID.test(id)) return bad('That post id is not valid.');
  const row = await getPostRow(ctx, id.toLowerCase());
  if (!row) return { status: 404, body: { error: 'No such post.' } };
  return { status: 200, body: { post: shapePost(row, await categoryIdsOf(ctx, row.id), true) } };
}

// ---------- POST note-save ----------
async function save(ctx, body) {
  const v = validateSave(body);
  if (v.error) return v.error;
  const x = v.value;
  if (!(await checkCategoriesExist(ctx, x.categoryIds))) return bad('One of those categories no longer exists. Reload the page.');
  const nowISO = ctx.now.toISOString();

  if (x.creating) {
    let slug = x.slug;
    if (slug) { if (await slugTaken(ctx, slug)) return conflict('That slug is already used by another post.', 'SLUG_TAKEN'); }
    else slug = await freeSlug(ctx, T.slugify(x.title, { now: ctx.now, rand: randId }));
    let row = null;
    for (let attempt = 0; attempt < 3 && !row; attempt++) {
      const ins = await ctx.supabase.from('fieldnotes_posts').insert({
        slug, title: x.title, summary: x.summary || null, body_md: x.text || '', lang: x.lang || 'en', thai_font: x.thaiFont || T.DEFAULT_THAI_FONT, status: 'draft', version: 1, created_at: nowISO, updated_at: nowISO,
      }).select(POST_COLUMNS).maybeSingle();
      if (!ins.error) { row = ins.data; break; }
      if (ins.error.code !== '23505') throw ins.error;
      if (x.slug) return conflict('That slug is already used by another post.', 'SLUG_TAKEN');
      slug = await freeSlug(ctx, T.slugify(x.title, { now: ctx.now, rand: randId })); // lost a race: pick again
    }
    if (!row) return conflict('Could not find a free slug. Try again.', 'SLUG_TAKEN');
    const ids = x.categoryIds || [];
    if (ids.length) await syncCategories(ctx, row.id, ids);
    await logAction(ctx, 'note_create', { id: row.id, slug: row.slug, title: row.title });
    return { status: 201, body: { post: shapePost(row, ids, false) } };
  }

  const existing = await getPostRow(ctx, x.id);
  if (!existing) return { status: 404, body: { error: 'No such post.' } };
  // A published post is only ever changed on purpose ("Update"), never by the automatic saving.
  if (existing.status === 'published' && x.mode === 'autosave') {
    return conflict('This post is published. Your changes are kept on this device until you press Update.', 'PUBLISHED_NO_AUTOSAVE');
  }
  const stale = () => conflict('This post was changed somewhere else (another tab or window). Nothing was overwritten.', 'STALE_VERSION', { currentVersion: existing.version });
  if (existing.version !== x.version) return stale();

  let slug = existing.slug;
  if (x.autoSlug && existing.status === 'draft' && !existing.published_at) {
    // A draft that was never published may follow its title. Once published, a slug only changes when the owner types one.
    const ascii = T.asciiSlug(x.title);
    if (ascii) slug = await freeSlug(ctx, ascii, existing.id);
    else if (!T.DATE_ID_SLUG.test(existing.slug)) slug = await freeSlug(ctx, T.slugify(x.title, { now: ctx.now, rand: randId }), existing.id);
  } else if (x.slug && x.slug !== existing.slug) {
    if (await slugTaken(ctx, x.slug, existing.id)) return conflict('That slug is already used by another post.', 'SLUG_TAKEN');
    slug = x.slug;
  }
  const upd = await ctx.supabase.from('fieldnotes_posts')
    .update({
      slug, title: x.title, version: existing.version + 1, updated_at: nowISO,
      ...(x.summary !== undefined ? { summary: x.summary || null } : {}),
      ...(x.text !== undefined ? { body_md: x.text } : {}),
      ...(x.lang !== undefined ? { lang: x.lang } : {}),
      ...(x.thaiFont !== undefined ? { thai_font: x.thaiFont } : {}),
    })
    .eq('id', existing.id).eq('version', x.version) // the real guard: only if nobody changed it since
    .select(POST_COLUMNS).maybeSingle();
  if (upd.error) {
    if (upd.error.code === '23505') return conflict('That slug is already used by another post.', 'SLUG_TAKEN');
    throw upd.error;
  }
  if (!upd.data) return stale();
  const ids = x.categoryIds !== undefined ? x.categoryIds : await categoryIdsOf(ctx, existing.id);
  if (x.categoryIds !== undefined) await syncCategories(ctx, existing.id, ids);
  if (x.mode === 'save') await logAction(ctx, 'note_save', { id: existing.id, slug, title: x.title, status: existing.status, version: upd.data.version });
  return { status: 200, body: { post: shapePost(upd.data, ids, false) } };
}

// ---------- POST note-publish ----------
const PUBLISH_KEYS = ['id', 'version', 'publish'];
async function publish(ctx, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('Send a JSON object.');
  const extra = unknownKey(body, PUBLISH_KEYS);
  if (extra) return bad(`Unknown field "${extra}".`);
  if (typeof body.id !== 'string' || !UUID.test(body.id)) return bad('That post id is not valid.');
  if (!isInt(body.version)) return bad('A post needs its version number.');
  if (typeof body.publish !== 'boolean') return bad('"publish" must be true or false.');

  const existing = await getPostRow(ctx, body.id.toLowerCase());
  if (!existing) return { status: 404, body: { error: 'No such post.' } };
  if (existing.version !== body.version) return conflict('This post was changed somewhere else (another tab or window). Nothing was overwritten.', 'STALE_VERSION', { currentVersion: existing.version });

  const wantStatus = body.publish ? 'published' : 'draft';
  if (existing.status === wantStatus) return { status: 200, body: { post: shapePost(existing, await categoryIdsOf(ctx, existing.id), false), unchanged: true } };
  if (body.publish && !String(existing.body_md || '').trim()) return bad('Write something before publishing.');

  const nowISO = ctx.now.toISOString();
  const upd = await ctx.supabase.from('fieldnotes_posts')
    .update({ status: wantStatus, published_at: existing.published_at || (body.publish ? nowISO : null), version: existing.version + 1, updated_at: nowISO })
    .eq('id', existing.id).eq('version', body.version)
    .select(POST_COLUMNS).maybeSingle();
  if (upd.error) throw upd.error;
  if (!upd.data) return conflict('This post was changed somewhere else (another tab or window). Nothing was overwritten.', 'STALE_VERSION');
  await logAction(ctx, body.publish ? 'note_publish' : 'note_unpublish', { id: existing.id, slug: existing.slug, title: existing.title });
  return { status: 200, body: { post: shapePost(upd.data, await categoryIdsOf(ctx, existing.id), false) } };
}

// ---------- DELETE note ----------
const confirmed = (q) => !!q && (q.confirm === 'yes' || q.confirm === 'true');
async function removePost(ctx, query) {
  const id = query && query.id;
  if (typeof id !== 'string' || !UUID.test(id)) return bad('That post id is not valid.');
  if (!confirmed(query)) return bad('Deleting needs an explicit confirmation.', { code: 'CONFIRM_REQUIRED' });
  const existing = await getPostRow(ctx, id.toLowerCase());
  if (!existing) return { status: 404, body: { error: 'No such post.' } };
  const del = await ctx.supabase.from('fieldnotes_posts').delete().eq('id', existing.id);
  if (del.error) throw del.error;
  await logAction(ctx, 'note_delete', { id: existing.id, slug: existing.slug, title: existing.title, status: existing.status });
  return { status: 200, body: { deleted: true } };
}

// ---------- categories ----------
async function allCategories(ctx) {
  const { data, error } = await ctx.supabase.from('fieldnotes_categories').select('id, name, slug').order('name', { ascending: true }).limit(500);
  if (error) throw error;
  return data || [];
}

async function listCategories(ctx) {
  const cats = await allCategories(ctx);
  const links = await ctx.supabase.from('fieldnotes_post_categories').select('category_id').limit(20000);
  if (links.error) throw links.error;
  const counts = new Map();
  for (const l of links.data || []) counts.set(l.category_id, (counts.get(l.category_id) || 0) + 1);
  return { status: 200, body: { categories: cats.map((c) => shapeCategory(c, counts.get(c.id) || 0)) } };
}

const CATEGORY_KEYS = ['id', 'name'];
async function saveCategory(ctx, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return bad('Send a JSON object.');
  const extra = unknownKey(body, CATEGORY_KEYS);
  if (extra) return bad(`Unknown field "${extra}".`);
  const n = T.cleanCategoryName(body.name);
  if (!n.ok) return bad(n.error);
  const key = T.categoryKey(n.name);
  const cats = await allCategories(ctx);
  const same = cats.find((c) => T.categoryKey(c.name) === key);

  if (body.id === undefined || body.id === null) { // create (or hand back the one that already exists)
    if (same) return { status: 200, body: { category: shapeCategory(same), existed: true } };
    if (cats.length >= T.LIMITS.categoriesTotal) return bad(`You can have at most ${T.LIMITS.categoriesTotal} categories.`);
    const taken = new Set(cats.map((c) => c.slug));
    let slug = T.categorySlug(n.name, { rand: randId });
    for (let i = 2; taken.has(slug); i++) slug = `${T.categorySlug(n.name, { rand: randId }).slice(0, T.LIMITS.slug - 4)}-${i}`;
    const ins = await ctx.supabase.from('fieldnotes_categories').insert({ name: n.name, slug }).select('id, name, slug').maybeSingle();
    if (ins.error) {
      if (ins.error.code === '23505') { // made twice at once: return the winner
        const again = (await allCategories(ctx)).find((c) => T.categoryKey(c.name) === key);
        if (again) return { status: 200, body: { category: shapeCategory(again), existed: true } };
        return conflict('That category already exists.', 'CATEGORY_EXISTS');
      }
      throw ins.error;
    }
    await logAction(ctx, 'category_create', { id: ins.data.id, name: ins.data.name });
    return { status: 201, body: { category: shapeCategory(ins.data), existed: false } };
  }

  if (typeof body.id !== 'string' || !UUID.test(body.id)) return bad('That category id is not valid.');
  const id = body.id.toLowerCase();
  const current = cats.find((c) => c.id === id);
  if (!current) return { status: 404, body: { error: 'No such category.' } };
  if (same && same.id !== id) return conflict('Another category already has that name.', 'CATEGORY_EXISTS');
  // The slug (its web address) stays as it was, so links made from it later don't break when the name is fixed.
  const upd = await ctx.supabase.from('fieldnotes_categories').update({ name: n.name }).eq('id', id).select('id, name, slug').maybeSingle();
  if (upd.error) { if (upd.error.code === '23505') return conflict('Another category already has that name.', 'CATEGORY_EXISTS'); throw upd.error; }
  await logAction(ctx, 'category_rename', { id, from: current.name, to: n.name });
  return { status: 200, body: { category: shapeCategory(upd.data) } };
}

async function removeCategory(ctx, query) {
  const id = query && query.id;
  if (typeof id !== 'string' || !UUID.test(id)) return bad('That category id is not valid.');
  if (!confirmed(query)) return bad('Deleting needs an explicit confirmation.', { code: 'CONFIRM_REQUIRED' });
  const { data, error } = await ctx.supabase.from('fieldnotes_categories').select('id, name').eq('id', id.toLowerCase()).maybeSingle();
  if (error) throw error;
  if (!data) return { status: 404, body: { error: 'No such category.' } };
  const del = await ctx.supabase.from('fieldnotes_categories').delete().eq('id', data.id); // posts keep existing; only the link goes
  if (del.error) throw del.error;
  await logAction(ctx, 'category_delete', { id: data.id, name: data.name });
  return { status: 200, body: { deleted: true } };
}

// ctx: { supabase, now: Date }. req: { method, body, query }. Returns { status, body }.
async function handle(ctx, route, req) {
  try {
    if (route === 'notes') return await list(ctx);
    if (route === 'note') return req.method === 'DELETE' ? await removePost(ctx, req.query) : await getOne(ctx, req.query);
    if (route === 'note-save') return await save(ctx, req.body);
    if (route === 'note-publish') return await publish(ctx, req.body);
    if (route === 'note-categories') {
      if (req.method === 'GET') return await listCategories(ctx);
      if (req.method === 'POST') return await saveCategory(ctx, req.body);
      return await removeCategory(ctx, req.query);
    }
    return { status: 404, body: { error: 'Not found' } };
  } catch (err) {
    if (isMissingTable(err)) return migrationRequired(); // migration 0006 not run yet: touch nothing, say so
    throw err;
  }
}

module.exports = { handle, METHODS, isNotesRoute, MIGRATION_MESSAGE, validateSave };
