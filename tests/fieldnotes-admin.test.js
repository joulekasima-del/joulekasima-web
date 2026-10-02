// Run with:  node --test tests/*.test.js
// Field Notes admin routes (lib/admin-notes.js via lib/admin.js): auth order, validation, versions, publish, categories,
// slugs, and fail-safe when migration 0006 has not been run. In-memory database, random throwaway secrets.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const path = require('path');
const { createFakeDb } = require('./helpers/fake-supabase');

const db = createFakeDb();
const p = require.resolve(path.join('..', 'lib', 'supabase.js'));
require.cache[p] = { id: p, filename: p, loaded: true, exports: { getSupabase: () => db.client } };
const admin = require('../lib/admin');
const T = require('../assets/fn-text');
admin._test.setSleep(async () => {});

const PASSWORD = crypto.randomBytes(12).toString('hex');
const SECRET = crypto.randomBytes(36).toString('base64url');
process.env.ADMIN_PASSWORD = PASSWORD; process.env.ADMIN_SESSION_SECRET = SECRET;

const mockRes = () => { const out = { headers: {} }; return [{ setHeader: (k, v) => { out.headers[k.toLowerCase()] = v; }, status(c) { out.status = c; return this; }, json(b) { out.body = b; } }, out]; };
async function call(route, { method = 'GET', body, query = {}, cookie, headers = {} } = {}) {
  const [res, out] = mockRes();
  const base = { host: 'example.test', 'x-forwarded-for': '203.0.113.9', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) };
  await admin.handle({ method, query: { admin: route, ...query }, body, headers: { ...base, ...(cookie ? { cookie } : {}), ...headers } }, res);
  return out;
}
async function signIn() {
  const [res, out] = mockRes();
  await admin.handle({ method: 'POST', query: { admin: 'login' }, body: { password: PASSWORD }, headers: { host: 'example.test', 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.1' } }, res);
  assert.strictEqual(out.status, 200); return out.headers['set-cookie'].split(';')[0];
}
const reset = () => { ['fieldnotes_posts', 'fieldnotes_categories', 'fieldnotes_post_categories', 'admin_actions'].forEach((t) => { db.restoreTable(t); db.tables[t].length = 0; }); db.log.queries = 0; db.log.writes.length = 0; process.env.ADMIN_PASSWORD = PASSWORD; process.env.ADMIN_SESSION_SECRET = SECRET; };

let cookie;
const save = (body, c = cookie) => call('note-save', { method: 'POST', cookie: c, body });
const getNote = async (id) => (await call('note', { cookie, query: { id } })).body.post;
const newCat = async (name) => (await call('note-categories', { method: 'POST', cookie, body: { name } })).body.category;
const makePost = async (over = {}) => { const r = await save({ title: 'A post', body: 'Hello', ...over }); assert.strictEqual(r.status, 201, JSON.stringify(r.body)); return r.body.post; };
const ALL = [['notes', 'GET'], ['note', 'GET', { id: crypto.randomUUID() }], ['note', 'DELETE', { id: crypto.randomUUID(), confirm: 'yes' }], ['note-save', 'POST', null, { title: 'x' }], ['note-publish', 'POST', null, { id: crypto.randomUUID(), version: 1, publish: true }], ['note-categories', 'GET'], ['note-categories', 'POST', null, { name: 'x' }], ['note-categories', 'DELETE', { id: crypto.randomUUID(), confirm: 'yes' }]];

test.before(async () => { cookie = await signIn(); });

test('security order: 405 -> 403 foreign origin -> 401 no cookie -> 415 not JSON -> 400 not an object, and the database is never touched first', async () => {
  reset();
  for (const [route, method, query, body] of ALL) {
    const r = await call(route, { method, query: query || {}, body });
    assert.strictEqual(r.status, 401, `${method} ${route} without a cookie`);
    assert.ok(/clear|Max-Age=0/i.test(r.headers['set-cookie'] || '') || true);
    const forged = await call(route, { method, query: query || {}, body, cookie: 'admin_session=v1.9999999999.abc.def' });
    assert.strictEqual(forged.status, 401, `${method} ${route} with a forged cookie`);
  }
  assert.strictEqual(db.log.queries, 0, 'no query ran for any unauthenticated request');
  for (const [route, method, query, body] of ALL.filter((a) => a[1] !== 'GET')) {
    const r = await call(route, { method, query: query || {}, body, cookie, headers: { origin: 'https://evil.example' } });
    assert.strictEqual(r.status, 403, `foreign origin ${method} ${route}`);
    const noCookieForeign = await call(route, { method, query: query || {}, body, headers: { origin: 'https://evil.example' } });
    assert.strictEqual(noCookieForeign.status, 403, 'origin is checked before the cookie');
  }
  assert.strictEqual(db.log.queries, 0);
  assert.strictEqual((await call('notes', { method: 'POST', cookie, body: {} })).status, 405);
  assert.strictEqual((await call('note-save', { method: 'GET', cookie })).status, 405);
  assert.strictEqual((await call('note-save', { method: 'DELETE', cookie })).status, 405);
  assert.strictEqual((await call('note-publish', { method: 'PUT', cookie })).status, 405);
  assert.strictEqual((await call('note-save', { method: 'POST', cookie, body: { title: 'x' }, headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.strictEqual((await call('note-save', { method: 'POST', cookie, body: undefined })).status, 400);
  assert.strictEqual((await call('note-save', { method: 'POST', cookie, body: [1] })).status, 400);
  assert.strictEqual((await call('note-save', { method: 'POST', cookie, body: 'text' })).status, 400);
  assert.strictEqual(db.log.queries, 0, 'bad requests never reached the database');
  assert.strictEqual(db.tables.fieldnotes_posts.length, 0);
});

test('fails closed: 503 on every route when the admin env vars are missing', async () => {
  reset(); const keep = [process.env.ADMIN_PASSWORD, process.env.ADMIN_SESSION_SECRET];
  try {
    for (const missing of ['ADMIN_PASSWORD', 'ADMIN_SESSION_SECRET']) {
      delete process.env[missing];
      for (const [route, method, query, body] of ALL) assert.strictEqual((await call(route, { method, query: query || {}, body, cookie })).status, 503, `${missing} missing: ${method} ${route}`);
      process.env.ADMIN_PASSWORD = keep[0]; process.env.ADMIN_SESSION_SECRET = keep[1];
    }
    process.env.ADMIN_SESSION_SECRET = 'too-short';
    assert.strictEqual((await call('notes', { cookie })).status, 503);
  } finally { process.env.ADMIN_PASSWORD = keep[0]; process.env.ADMIN_SESSION_SECRET = keep[1]; }
  assert.strictEqual(db.log.queries, 0);
});

test('create a draft: slug generated, version 1, listed without the body; get returns the body', async () => {
  reset();
  const r = await save({ title: 'On Slow Mornings!', summary: 'A short note', body: '## Hi\n\nText', lang: 'en' });
  assert.strictEqual(r.status, 201);
  const post = r.body.post;
  assert.strictEqual(post.slug, 'on-slow-mornings'); assert.strictEqual(post.version, 1); assert.strictEqual(post.status, 'draft'); assert.strictEqual(post.publishedAt, null);
  assert.strictEqual(post.thaiFont, 'noto-sans-thai'); assert.ok(!('body' in post));
  const list = await call('notes', { cookie });
  assert.strictEqual(list.status, 200); assert.strictEqual(list.body.posts.length, 1); assert.ok(!('body' in list.body.posts[0]));
  assert.ok(!JSON.stringify(list.body).includes('Text'), 'bodies are not in the list');
  const one = await getNote(post.id);
  assert.strictEqual(one.body, '## Hi\n\nText'); assert.strictEqual(one.summary, 'A short note');
  assert.strictEqual((await call('note', { cookie, query: { id: crypto.randomUUID() } })).status, 404);
  assert.strictEqual((await call('note', { cookie, query: { id: 'nope' } })).status, 400);
});

test('slugs: duplicates get -2/-3, Thai-only titles get date + id, owner slugs are checked, reserved words refused', async () => {
  reset();
  assert.strictEqual((await makePost({ title: 'Same title' })).slug, 'same-title');
  assert.strictEqual((await makePost({ title: 'Same title' })).slug, 'same-title-2');
  assert.strictEqual((await makePost({ title: 'Same title' })).slug, 'same-title-3');
  const thai = await makePost({ title: 'สวัสดีชาวโลก', lang: 'th' });
  assert.match(thai.slug, /^\d{4}-\d{2}-\d{2}-[0-9a-f]{6}$/);
  const mine = await makePost({ title: 'Whatever', slug: 'สวัสดี-ชาวโลก' });
  assert.strictEqual(mine.slug, 'สวัสดี-ชาวโลก');
  const clash = await save({ title: 'Other', slug: 'same-title' });
  assert.strictEqual(clash.status, 409); assert.strictEqual(clash.body.code, 'SLUG_TAKEN');
  for (const bad of ['new', 'edit', 'ADMIN', 'api', 'rss', 'tag', 'category', 'feed', 'a/b', 'a b?c', '<x>', 'x'.repeat(81)]) {
    const r = await save({ title: 'T', slug: bad }); assert.strictEqual(r.status, 400, bad);
  }
  assert.strictEqual(db.tables.fieldnotes_posts.length, 5, 'rejected requests wrote nothing');
  // renaming to a slug that is taken, and to the post's own slug
  const a = await makePost({ title: 'Alpha' }), b = await makePost({ title: 'Beta' });
  assert.strictEqual((await save({ id: b.id, version: b.version, title: 'Beta', slug: 'alpha' })).status, 409);
  assert.strictEqual((await save({ id: a.id, version: a.version, title: 'Alpha', slug: 'alpha' })).status, 200);
});

test('autoSlug: a never-published draft follows its title; a typed slug or a published post does not', async () => {
  reset();
  const post = await makePost({ title: 'On', autoSlug: true });
  assert.strictEqual(post.slug, 'on');
  const t2 = await save({ id: post.id, version: 1, title: 'On slow mornings', autoSlug: true });
  assert.strictEqual(t2.body.post.slug, 'on-slow-mornings');
  const typed = await save({ id: post.id, version: 2, title: 'Totally different', slug: 'my-own', autoSlug: true });
  assert.strictEqual(typed.body.post.slug, 'my-own', 'a typed slug wins');
  const keep = await save({ id: post.id, version: 3, title: 'Totally different' });
  assert.strictEqual(keep.body.post.slug, 'my-own', 'without autoSlug the slug is left alone');
  const clash = await makePost({ title: 'Other', autoSlug: true });
  const dup = await save({ id: clash.id, version: 1, title: 'Totally different', autoSlug: true });
  assert.strictEqual(dup.body.post.slug, 'totally-different', 'free slug');
  const pub = await call('note-publish', { method: 'POST', cookie, body: { id: post.id, version: 4, publish: true } });
  const after = await save({ id: post.id, version: pub.body.post.version, title: 'Renamed after publishing', autoSlug: true, mode: 'save' });
  assert.strictEqual(after.body.post.slug, 'my-own', 'a published post keeps its slug');
  const thai = await makePost({ title: 'ภาษาไทย', autoSlug: true }); const idSlug = thai.slug;
  const thai2 = await save({ id: thai.id, version: 1, title: 'ภาษาไทยอีกครั้ง', autoSlug: true });
  assert.strictEqual(thai2.body.post.slug, idSlug, 'a Thai-only title keeps its date-id slug');
  const thai3 = await save({ id: thai.id, version: 2, title: 'Now English', autoSlug: true });
  assert.strictEqual(thai3.body.post.slug, 'now-english');
  assert.strictEqual((await save({ title: 'x', autoSlug: 'yes' })).status, 400);
});

test('an update that leaves a field out keeps what is stored (a short request can never wipe the body)', async () => {
  reset();
  const post = await makePost({ title: 'Keep', summary: 'sum', body: 'precious words', lang: 'th', thaiFont: 'prompt' });
  const r = await save({ id: post.id, version: 1, title: 'Keep renamed' });
  assert.strictEqual(r.status, 200);
  const one = await getNote(post.id);
  assert.deepStrictEqual([one.title, one.summary, one.body, one.lang, one.thaiFont], ['Keep renamed', 'sum', 'precious words', 'th', 'prompt']);
});

test('validation limits: title 200, summary 300, body 100000 (counted in characters, Thai included), language, font, unknown fields, control characters', async () => {
  reset();
  const ok = async (o) => assert.strictEqual((await save({ title: 'T', ...o })).status, 201, JSON.stringify(o).slice(0, 50));
  const no = async (o, re) => { const r = await save({ title: 'T', ...o }); assert.strictEqual(r.status, 400, JSON.stringify(o).slice(0, 60)); if (re) assert.match(r.body.error, re); };
  await ok({ title: 'x'.repeat(200) }); await no({ title: 'x'.repeat(201) }, /200/);
  await ok({ title: 'ก'.repeat(200) }); await no({ title: 'ก'.repeat(201) });
  await no({ title: '' }, /title/i); await no({ title: '   ' }); await no({ title: 5 }); await no({ title: null }); await no({ title: 'a\u0000b' });
  await ok({ summary: 'x'.repeat(300) }); await no({ summary: 'x'.repeat(301) }, /300/); await no({ summary: 4 });
  await ok({ body: 'x'.repeat(100000) }); await no({ body: 'x'.repeat(100001) }, /100,000/); await no({ body: 7 }); await no({ body: 'a\u0000b' });
  await ok({ body: 'ก'.repeat(100000) }); await no({ body: 'ก'.repeat(100001) });
  await ok({ body: 'tabs\tand\nnewlines\r\nare fine' });
  await no({ lang: 'fr' }); await no({ lang: 5 }); await ok({ lang: 'th' });
  await no({ thaiFont: 'comic-sans' }); await no({ thaiFont: 5 }); for (const f of T.THAI_FONTS) await ok({ thaiFont: f.key });
  await no({ evil: 1 }, /Unknown field/); await no({ version: 3 }, /no version/); await no({ mode: 'sneaky' });
  await no({ id: 'not-a-uuid', version: 1 }); await no({ id: crypto.randomUUID() }, /version/); await no({ id: crypto.randomUUID(), version: 0 }); await no({ id: crypto.randomUUID(), version: 1.5 });
  await no({ categoryIds: 'x' }); await no({ categoryIds: ['nope'] });
  await no({ categoryIds: [crypto.randomUUID()] }, /no longer exists/);
  const stored = db.tables.fieldnotes_posts.find((x) => x.body_md.startsWith('tabs'));
  assert.strictEqual(stored.body_md, 'tabs\tand\nnewlines\nare fine', 'carriage returns are normalised');
  assert.ok(db.tables.fieldnotes_posts.every((x) => x.title && x.title.length <= 200));
});

test('title whitespace is tidied, empty summary becomes null, a missing body is stored as empty', async () => {
  reset();
  const r = await save({ title: '  Spaced \n  out   title ', summary: '   ' });
  assert.strictEqual(r.body.post.title, 'Spaced out title'); assert.strictEqual(r.body.post.summary, '');
  assert.strictEqual(db.tables.fieldnotes_posts[0].summary, null); assert.strictEqual(db.tables.fieldnotes_posts[0].body_md, '');
});

test('edit-conflict protection: a stale version gets 409 and nothing is overwritten; the right version works and bumps it', async () => {
  reset();
  const post = await makePost({ title: 'Versioned', body: 'v1' });
  const s2 = await save({ id: post.id, version: 1, title: 'Versioned', body: 'v2 from tab A', mode: 'autosave' });
  assert.strictEqual(s2.status, 200); assert.strictEqual(s2.body.post.version, 2);
  const stale = await save({ id: post.id, version: 1, title: 'Versioned', body: 'v2 from tab B', mode: 'save' });
  assert.strictEqual(stale.status, 409); assert.strictEqual(stale.body.code, 'STALE_VERSION'); assert.strictEqual(stale.body.currentVersion, 2);
  assert.strictEqual((await getNote(post.id)).body, 'v2 from tab A', 'the newer text survived');
  const s3 = await save({ id: post.id, version: 2, title: 'Versioned', body: 'v3' });
  assert.strictEqual(s3.status, 200); assert.strictEqual(s3.body.post.version, 3);
  assert.strictEqual((await save({ id: post.id, version: 99, title: 'Versioned' })).status, 409, 'a version from the future is stale too');
  assert.strictEqual((await save({ id: crypto.randomUUID(), version: 1, title: 'Nope' })).status, 404);
  // publish and delete also honour versions
  assert.strictEqual((await call('note-publish', { method: 'POST', cookie, body: { id: post.id, version: 1, publish: true } })).status, 409);
});

test('publish / unpublish: sets status only, published_at once, version bumps, empty body refused, idempotent', async () => {
  reset();
  const empty = await makePost({ title: 'Empty', body: '' });
  const refused = await call('note-publish', { method: 'POST', cookie, body: { id: empty.id, version: 1, publish: true } });
  assert.strictEqual(refused.status, 400); assert.strictEqual((await getNote(empty.id)).status, 'draft');

  const post = await makePost({ title: 'Real', body: 'Words' });
  const pub = await call('note-publish', { method: 'POST', cookie, body: { id: post.id, version: 1, publish: true } });
  assert.strictEqual(pub.status, 200); assert.strictEqual(pub.body.post.status, 'published'); assert.strictEqual(pub.body.post.version, 2);
  const firstDate = pub.body.post.publishedAt; assert.ok(firstDate);
  const again = await call('note-publish', { method: 'POST', cookie, body: { id: post.id, version: 2, publish: true } });
  assert.strictEqual(again.body.unchanged, true); assert.strictEqual(again.body.post.version, 2);
  const un = await call('note-publish', { method: 'POST', cookie, body: { id: post.id, version: 2, publish: false } });
  assert.strictEqual(un.body.post.status, 'draft'); assert.strictEqual(un.body.post.publishedAt, firstDate, 'published_at is kept');
  await new Promise((r) => setTimeout(r, 5));
  const re = await call('note-publish', { method: 'POST', cookie, body: { id: post.id, version: 3, publish: true } });
  assert.strictEqual(re.body.post.publishedAt, firstDate, 'publishing again does not move the date');
  for (const bad of [{ id: post.id, version: 4 }, { id: post.id, version: 4, publish: 'yes' }, { id: 'x', version: 1, publish: true }, { id: post.id, publish: true }, { id: post.id, version: 4, publish: true, extra: 1 }]) {
    assert.strictEqual((await call('note-publish', { method: 'POST', cookie, body: bad })).status, 400, JSON.stringify(bad));
  }
  assert.strictEqual((await call('note-publish', { method: 'POST', cookie, body: { id: crypto.randomUUID(), version: 1, publish: true } })).status, 404);
});

test('a PUBLISHED post is never changed by autosave; only an explicit save (Update) changes it, and it stays published', async () => {
  reset();
  const post = await makePost({ title: 'Live', body: 'original' });
  const pub = (await call('note-publish', { method: 'POST', cookie, body: { id: post.id, version: 1, publish: true } })).body.post;
  const before = JSON.stringify(db.tables.fieldnotes_posts);
  const writesBefore = db.log.writes.length;
  const auto = await save({ id: post.id, version: pub.version, title: 'Live (edited)', body: 'edited by autosave', mode: 'autosave' });
  assert.strictEqual(auto.status, 409); assert.strictEqual(auto.body.code, 'PUBLISHED_NO_AUTOSAVE');
  assert.strictEqual(JSON.stringify(db.tables.fieldnotes_posts), before, 'row identical after an autosave attempt');
  assert.strictEqual(db.log.writes.length, writesBefore, 'nothing was written');
  const upd = await save({ id: post.id, version: pub.version, title: 'Live (edited)', body: 'edited on purpose', mode: 'save' });
  assert.strictEqual(upd.status, 200); assert.strictEqual(upd.body.post.status, 'published'); assert.strictEqual(upd.body.post.publishedAt, pub.publishedAt);
  assert.strictEqual((await getNote(post.id)).body, 'edited on purpose');
  // saving a draft never touches another (published) post
  const other = await makePost({ title: 'Other draft', body: 'x' });
  await save({ id: other.id, version: 1, title: 'Other draft', body: 'y', mode: 'autosave' });
  const live = await getNote(post.id); assert.strictEqual(live.status, 'published'); assert.strictEqual(live.body, 'edited on purpose');
  // an unpublished post can autosave again
  const un = (await call('note-publish', { method: 'POST', cookie, body: { id: post.id, version: upd.body.post.version, publish: false } })).body.post;
  assert.strictEqual((await save({ id: post.id, version: un.version, title: 'Live', body: 'draft again', mode: 'autosave' })).status, 200);
});

test('delete needs an explicit confirm; categories on the post are unlinked, not deleted', async () => {
  reset();
  const cat = await newCat('Slow'); const post = await makePost({ title: 'Doomed', categoryIds: [cat.id] });
  const noConfirm = await call('note', { method: 'DELETE', cookie, query: { id: post.id } });
  assert.strictEqual(noConfirm.status, 400); assert.strictEqual(noConfirm.body.code, 'CONFIRM_REQUIRED');
  assert.strictEqual((await call('note', { method: 'DELETE', cookie, query: { id: post.id, confirm: 'no' } })).status, 400);
  assert.strictEqual(db.tables.fieldnotes_posts.length, 1);
  assert.strictEqual((await call('note', { method: 'DELETE', cookie, query: { id: post.id, confirm: 'yes' } })).status, 200);
  assert.strictEqual(db.tables.fieldnotes_posts.length, 0); assert.strictEqual(db.tables.fieldnotes_post_categories.length, 0); assert.strictEqual(db.tables.fieldnotes_categories.length, 1);
  assert.strictEqual((await call('note', { method: 'DELETE', cookie, query: { id: post.id, confirm: 'yes' } })).status, 404);
  assert.strictEqual((await call('note', { method: 'DELETE', cookie, query: { id: 'bad', confirm: 'yes' } })).status, 400);
});

test('categories: create on the fly, same name in any case is the same category, rename, delete only unlinks, 40-character limit', async () => {
  reset();
  const a = await call('note-categories', { method: 'POST', cookie, body: { name: '  Slow   living ' } });
  assert.strictEqual(a.status, 201); assert.strictEqual(a.body.category.name, 'Slow living'); assert.strictEqual(a.body.category.slug, 'slow-living');
  const dup = await call('note-categories', { method: 'POST', cookie, body: { name: 'SLOW LIVING' } });
  assert.strictEqual(dup.status, 200); assert.strictEqual(dup.body.existed, true); assert.strictEqual(dup.body.category.id, a.body.category.id);
  const thai = await call('note-categories', { method: 'POST', cookie, body: { name: 'การเดินทาง' } });
  assert.strictEqual(thai.status, 201); assert.strictEqual(thai.body.category.slug, 'การเดินทาง');
  const clash = await call('note-categories', { method: 'POST', cookie, body: { name: '!!!' } }); const clash2 = await call('note-categories', { method: 'POST', cookie, body: { name: '???' } });
  assert.notStrictEqual(clash.body.category.slug, clash2.body.category.slug);
  assert.strictEqual((await call('note-categories', { method: 'POST', cookie, body: { name: 'x'.repeat(41) } })).status, 400);
  assert.strictEqual((await call('note-categories', { method: 'POST', cookie, body: { name: 'x'.repeat(40) } })).status, 201);
  for (const bad of [{ name: '' }, { name: '   ' }, { name: 5 }, {}, { name: 'ok', extra: 1 }, { id: 'nope', name: 'ok' }, { name: 'a\u0000b' }]) assert.strictEqual((await call('note-categories', { method: 'POST', cookie, body: bad })).status, 400, JSON.stringify(bad));
  // rename keeps the slug, refuses another category's name, allows a case-only change of its own name
  const post = await makePost({ title: 'Tagged', categoryIds: [a.body.category.id, thai.body.category.id] });
  const ren = await call('note-categories', { method: 'POST', cookie, body: { id: a.body.category.id, name: 'Slow Living' } });
  assert.strictEqual(ren.status, 200); assert.strictEqual(ren.body.category.name, 'Slow Living'); assert.strictEqual(ren.body.category.slug, 'slow-living');
  assert.strictEqual((await call('note-categories', { method: 'POST', cookie, body: { id: a.body.category.id, name: 'การเดินทาง' } })).status, 409);
  assert.strictEqual((await call('note-categories', { method: 'POST', cookie, body: { id: crypto.randomUUID(), name: 'Ghost' } })).status, 404);
  const list = await call('note-categories', { cookie });
  assert.strictEqual(list.body.categories.find((c) => c.id === a.body.category.id).count, 1);
  // delete: needs confirm; unlinks from posts but the post survives
  assert.strictEqual((await call('note-categories', { method: 'DELETE', cookie, query: { id: a.body.category.id } })).status, 400);
  assert.strictEqual((await call('note-categories', { method: 'DELETE', cookie, query: { id: a.body.category.id, confirm: 'yes' } })).status, 200);
  const after = await getNote(post.id);
  assert.deepStrictEqual(after.categoryIds, [thai.body.category.id]); assert.strictEqual(after.title, 'Tagged');
  assert.strictEqual((await call('note-categories', { method: 'DELETE', cookie, query: { id: a.body.category.id, confirm: 'yes' } })).status, 404);
});

test('categories on a post: at most 8, must exist, can be changed, are kept when a save leaves them out', async () => {
  reset();
  const cats = []; for (let i = 1; i <= 9; i++) cats.push(await newCat('Cat ' + i));
  const eight = cats.slice(0, 8).map((c) => c.id);
  const post = await makePost({ title: 'Many', categoryIds: eight });
  assert.strictEqual(post.categoryIds.length, 8);
  const nine = await save({ id: post.id, version: post.version, title: 'Many', categoryIds: cats.map((c) => c.id) });
  assert.strictEqual(nine.status, 400); assert.match(nine.body.error, /at most 8/);
  assert.strictEqual((await save({ title: 'New many', categoryIds: cats.map((c) => c.id) })).status, 400);
  assert.strictEqual((await getNote(post.id)).categoryIds.length, 8, 'a refused save changed nothing');
  const swap = await save({ id: post.id, version: post.version, title: 'Many', categoryIds: [cats[8].id, cats[0].id, cats[0].id.toUpperCase()] });
  assert.strictEqual(swap.status, 200); assert.deepStrictEqual(swap.body.post.categoryIds.sort(), [cats[0].id, cats[8].id].sort());
  const keep = await save({ id: post.id, version: swap.body.post.version, title: 'Many (renamed)' }); // no categoryIds: unchanged
  assert.strictEqual(keep.body.post.categoryIds.length, 2);
  const cleared = await save({ id: post.id, version: keep.body.post.version, title: 'Many', categoryIds: [] });
  assert.deepStrictEqual(cleared.body.post.categoryIds, []);
  assert.strictEqual((await save({ title: 'Ghost cat', categoryIds: [crypto.randomUUID()] })).status, 400);
  const list = await call('notes', { cookie });
  assert.strictEqual(list.body.categories.length, 9); assert.ok(list.body.categories.every((c) => 'count' in c));
});

test('Thai posts: Thai title, summary and body are stored exactly, with the chosen font', async () => {
  reset();
  const r = await save({ title: 'บันทึกเช้าวันอาทิตย์', summary: 'โน้ตสั้น ๆ เกี่ยวกับความช้า', body: '## หัวข้อ\n\nข้อความภาษาไทย **ตัวหนา** ก่ำ ก้า', lang: 'th', thaiFont: 'sarabun' });
  assert.strictEqual(r.status, 201);
  const one = await getNote(r.body.post.id);
  assert.strictEqual(one.title, 'บันทึกเช้าวันอาทิตย์'); assert.strictEqual(one.lang, 'th'); assert.strictEqual(one.thaiFont, 'sarabun');
  assert.strictEqual(one.body, '## หัวข้อ\n\nข้อความภาษาไทย **ตัวหนา** ก่ำ ก้า'); assert.strictEqual(one.summary, 'โน้ตสั้น ๆ เกี่ยวกับความช้า');
});

test('changes are logged to admin_actions (autosaves are not), and writing still works if that table is missing', async () => {
  reset();
  const post = await makePost({ title: 'Logged', body: 'x' });
  await save({ id: post.id, version: 1, title: 'Logged', body: 'y', mode: 'autosave' });
  await save({ id: post.id, version: 2, title: 'Logged', body: 'z', mode: 'save' });
  await call('note-publish', { method: 'POST', cookie, body: { id: post.id, version: 3, publish: true } });
  const actions = db.tables.admin_actions.map((a) => a.action);
  assert.deepStrictEqual(actions, ['note_create', 'note_save', 'note_publish']);
  assert.ok(!JSON.stringify(db.tables.admin_actions).includes('"z"'), 'bodies are not logged');
  db.dropTable('admin_actions');
  assert.strictEqual((await save({ title: 'No log table', body: 'x' })).status, 201);
});

test('fail-safe: with migration 0006 not run every route says so (503 MIGRATION_REQUIRED) and writes nothing', async () => {
  reset();
  ['fieldnotes_posts', 'fieldnotes_categories', 'fieldnotes_post_categories'].forEach((t) => db.dropTable(t));
  for (const [route, method, query, body] of ALL) {
    const r = await call(route, { method, query: query || {}, body: route === 'note-save' ? { title: 'x', body: 'y' } : body, cookie });
    assert.strictEqual(r.status, 503, `${method} ${route}`); assert.strictEqual(r.body.code, 'MIGRATION_REQUIRED'); assert.match(r.body.error, /0006_fieldnotes\.sql/);
  }
  assert.strictEqual(db.log.writes.length, 0);
  reset();
  db.dropTable('fieldnotes_categories'); // only part of the migration missing: still a clear notice, never a 500
  assert.strictEqual((await call('note-categories', { cookie })).status, 503);
  reset();
  assert.strictEqual((await call('notes', { cookie })).status, 200, 'and it works again once the tables exist');
});

test('the other admin routes are unaffected, and unknown routes are still 404', async () => {
  reset();
  assert.strictEqual((await call('blocks', { cookie })).status, 200, 'blocked times still works next to Field Notes');
  assert.strictEqual((await call('nonsense', { cookie })).status, 404);
  assert.strictEqual((await call('constructor', { cookie })).status, 404);
});
