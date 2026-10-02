// Run with:  node --test tests/*.test.js
// Field Notes renderer (assets/fn-render.js) and text helpers (assets/fn-text.js): escaping, hostile input, Thai, slugs, editing helpers.
const test = require('node:test');
const assert = require('node:assert');
const R = require('../assets/fn-render');
const T = require('../assets/fn-text');

const r = (s) => R.render(s);
// every tag/attribute in the output must be on the allow-list
function assertOnlySafeHtml(html) {
  for (const m of html.matchAll(/<\/?([a-zA-Z0-9]+)([^>]*)>/g)) {
    assert.ok(R.ALLOWED_TAGS.includes(m[1].toLowerCase()), `tag not allowed: <${m[1]}>  in ${html.slice(0, 200)}`);
    const attrs = m[2].replace(/\s+(href="[^"]*"|target="_blank"|rel="noopener noreferrer")/g, '').trim();
    assert.strictEqual(attrs, '', `unexpected attributes: ${m[2]}`);
  }
  assert.ok(!/<[^>]*\son\w+=/i.test(html.replace(/&lt;[^]*?&gt;/g, '')), 'no event handler attributes');
}

test('basic syntax: paragraphs, headings, emphasis, quotes, lists, divider, line breaks', () => {
  assert.strictEqual(r('Hello **bold** and *it* and ***both***'), '<p>Hello <strong>bold</strong> and <em>it</em> and <strong><em>both</em></strong></p>');
  assert.strictEqual(r('## Head\n### Sub'), '<h2>Head</h2>\n<h3>Sub</h3>');
  assert.strictEqual(r('> one\n> two\n>\n> three'), '<blockquote><p>one<br>two</p><p>three</p></blockquote>');
  assert.strictEqual(r('- a\n- b\n\n1. x\n2. y'), '<ul><li>a</li><li>b</li></ul>\n<ol><li>x</li><li>y</li></ol>');
  assert.strictEqual(r('one\n\n---\n\ntwo'), '<p>one</p>\n<hr>\n<p>two</p>');
  assert.strictEqual(r('line1\nline2'), '<p>line1<br>line2</p>', 'a single new line is a line break');
  assert.strictEqual(r(''), ''); assert.strictEqual(r(null), ''); assert.strictEqual(r(undefined), '');
  assert.strictEqual(r('\\*not italic\\*'), '<p>*not italic*</p>');
  assert.strictEqual(r('# not a heading here'), '<p># not a heading here</p>');
});

test('ALL HTML is escaped: script tags, event handlers, entities, attribute breakouts', () => {
  const payloads = [
    '<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<svg/onload=alert(1)>', '<a href="javascript:alert(1)">x</a>',
    '"><script>alert(1)</script>', "' onmouseover='alert(1)", '<iframe src="https://evil.example"></iframe>', '&lt;script&gt;', '<style>*{display:none}</style>',
    '<!-- comment --><b>x</b>', '</p><script>alert(1)</script>', '<math><mi xlink:href="javascript:alert(1)">',
    '## <img src=x onerror=alert(1)>', '> <script>alert(1)</script>', '- <script>alert(1)</script>', '1. <img onerror=alert(1)>',
    '**<script>alert(1)</script>**', '[<script>alert(1)</script>](https://a.com)', '[x](https://a.com/"onmouseover="alert(1))',
  ];
  for (const p of payloads) {
    const html = r(p);
    assert.ok(!/<script|<img|<svg|<iframe|<style|<math|<!--/i.test(html), `raw tag survived: ${p} -> ${html}`);
    assertOnlySafeHtml(html);
  }
  assert.strictEqual(r('<b>x</b> & "q" \'s\''), '<p>&lt;b&gt;x&lt;/b&gt; &amp; &quot;q&quot; &#39;s&#39;</p>');
  assert.strictEqual(r('&lt;'), '<p>&amp;lt;</p>', 'an existing entity is shown as typed, never decoded');
});

test('links: only http, https and mailto; everything else stays inert plain text', () => {
  assert.strictEqual(r('[ok](https://a.com/x)'), '<p><a href="https://a.com/x" target="_blank" rel="noopener noreferrer">ok</a></p>');
  assert.strictEqual(r('[ok](http://a.com)'), '<p><a href="http://a.com" target="_blank" rel="noopener noreferrer">ok</a></p>');
  assert.strictEqual(r('[mail](mailto:me@example.com)'), '<p><a href="mailto:me@example.com">mail</a></p>');
  assert.strictEqual(r('[w](https://a.com/p_(x))'), '<p><a href="https://a.com/p_(x)" target="_blank" rel="noopener noreferrer">w</a></p>');
  assert.strictEqual(r('[q](https://a.com/?a=1&b=2)'), '<p><a href="https://a.com/?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">q</a></p>');
  const evil = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', 'file:///etc/passwd', '//evil.example', '/relative', 'ftp://a.com',
    'java\tscript:alert(1)', 'java\nscript:alert(1)', ' javascript:alert(1)', 'javascript&colon;alert(1)', 'https://a.com/a b', 'https:/\\evil.example', 'https://', 'mailto:', '\u0001javascript:alert(1)', 'https://a.com/ x'];
  for (const u of evil) {
    const html = r(`[click](${u})`);
    assert.ok(!/<a\b/.test(html), `link should not render: ${JSON.stringify(u)} -> ${html}`);
    assert.ok(!/href=/.test(html));
    assertOnlySafeHtml(html);
  }
  assert.strictEqual(r('[bad](javascript:alert(1))'), '<p>[bad](javascript:alert(1))</p>', 'shown as plain text exactly as typed');
  assert.strictEqual(r('![img](https://a.com/x.png)'), '<p>!<a href="https://a.com/x.png" target="_blank" rel="noopener noreferrer">img</a></p>', 'no images: only a plain link');
  assert.ok(!/<img/.test(r('![x](https://a.com/x.png)')));
});

test('unbalanced and nested markers never break the output', () => {
  const cases = ['**a', 'a**', '*a', '**a *b** c*', '***a**', '****', '*', '**', '***', '* a *', '** a **', 'a * b * c', '[a](', '[a]', '[](https://a.com)', '[a](https://a.com', '[[a]](https://a.com)', '**[a](https://a.com)**', '*[a](https://a.com)*', '\\', '>', '- ', '1. ', '##', '## ', '---x', '-- -'];
  for (const c of cases) assertOnlySafeHtml(r(c));
  assert.strictEqual(r('**a'), '<p>**a</p>'); assert.strictEqual(r('a**b'), '<p>a**b</p>'); assert.strictEqual(r('****'), '<p>****</p>');
  assert.strictEqual(r('**a *b** c*'), '<p><strong>a *b</strong> c*</p>');
  assert.strictEqual(r('**bold [link](https://a.com) bold**'), '<p><strong>bold <a href="https://a.com" target="_blank" rel="noopener noreferrer">link</a> bold</strong></p>');
  // balanced tags in every output
  for (const c of ['**a *b** c*', '*a **b* c**', '***a** b*', '**a**b**c**', '*a*b*c*']) {
    const html = r(c);
    for (const tag of ['strong', 'em']) assert.strictEqual((html.match(new RegExp(`<${tag}>`, 'g')) || []).length, (html.match(new RegExp(`</${tag}>`, 'g')) || []).length, c + ' -> ' + html);
  }
});

test('very long and hostile input finishes quickly and stays safe', () => {
  const hostile = [
    '**a '.repeat(40000), '*a**b*'.repeat(50000), '[a](x'.repeat(50000), '[['.repeat(100000), '('.repeat(200000), '*'.repeat(200000), '\\'.repeat(200000),
    ('[a](https://' + 'x'.repeat(1900) + ' ').repeat(100), '> '.repeat(50000), '- '.repeat(50000), '## '.repeat(50000), ' '.repeat(100000) + 'x', 'a'.repeat(1000000),
    '[' + 'a'.repeat(100000) + '](https://a.com)', '![' .repeat(50000), '**a *b '.repeat(30000),
  ];
  const t0 = Date.now();
  for (const h of hostile) { const html = r(h); assert.strictEqual(typeof html, 'string'); }
  assert.ok(Date.now() - t0 < 5000, `took ${Date.now() - t0} ms`);
  assert.ok(r('a'.repeat(1000000)).length <= R.MAX_INPUT + 20, 'input beyond the cap is cut');
  assertOnlySafeHtml(r('**a *b '.repeat(2000)));
});

test('Thai text renders untouched, including emphasis with no spaces around it', () => {
  assert.strictEqual(r('สวัสดีชาวโลก'), '<p>สวัสดีชาวโลก</p>');
  assert.strictEqual(r('ไทย**ตัวหนา**ไทย และ ไทย*เอียง*ไทย'), '<p>ไทย<strong>ตัวหนา</strong>ไทย และ ไทย<em>เอียง</em>ไทย</p>');
  assert.strictEqual(r('## หัวข้อ\n\n> คำพูด\n\n- หนึ่ง\n- สอง'), '<h2>หัวข้อ</h2>\n<blockquote><p>คำพูด</p></blockquote>\n<ul><li>หนึ่ง</li><li>สอง</li></ul>');
  assert.strictEqual(r('[ลิงก์](https://a.com/ไทย)'.replace('/ไทย', '/x')), '<p><a href="https://a.com/x" target="_blank" rel="noopener noreferrer">ลิงก์</a></p>');
  assert.strictEqual(r('ก่ำ ก้า กิ ก็'), '<p>ก่ำ ก้า กิ ก็</p>', 'tone and vowel marks are kept');
  assert.strictEqual(r('English and ไทย mixed **both ภาษา**'), '<p>English and ไทย mixed <strong>both ภาษา</strong></p>');
});

// ---------------- slugs ----------------
const fixed = { now: new Date('2026-10-02T03:00:00Z'), rand: () => 'abc123' };
test('slugify: English, accents, punctuation, Thai-only, mixed, empty, reserved, long', () => {
  assert.strictEqual(T.slugify('Hello, World!'), 'hello-world');
  assert.strictEqual(T.slugify('  Ça va très bien?  '), 'ca-va-tres-bien');
  assert.strictEqual(T.slugify('On slow mornings — a note'), 'on-slow-mornings-a-note');
  assert.strictEqual(T.slugify('Already-hyphenated--title'), 'already-hyphenated-title');
  assert.strictEqual(T.slugify('2026 plans'), '2026-plans');
  assert.strictEqual(T.slugify('สวัสดีชาวโลก', fixed), '2026-10-02-abc123');
  assert.strictEqual(T.slugify('!!!', fixed), '2026-10-02-abc123');
  assert.strictEqual(T.slugify('', fixed), '2026-10-02-abc123');
  assert.strictEqual(T.slugify('Chiang Mai เชียงใหม่', fixed), 'chiang-mai', 'mixed: the English part is kept');
  assert.strictEqual(T.slugify('New', fixed), '2026-10-02-abc123', 'a reserved result falls back');
  assert.strictEqual(T.slugify('Admin', fixed), '2026-10-02-abc123');
  const long = T.slugify('word '.repeat(100));
  assert.ok(long.length <= T.LIMITS.slug && !long.endsWith('-'));
  assert.strictEqual(T.slugify('2026-10-02', { now: new Date('2026-12-31T20:00:00Z'), rand: () => 'x' }), '2026-10-02');
  assert.strictEqual(T.slugify('ไทย', { now: new Date('2026-12-31T20:00:00Z'), rand: () => 'x' }), '2027-01-01-x', 'the date is the Chiang Mai date');
});

test('normalizeSlug: owner-edited slugs (Thai allowed), safe characters, length and reserved words', () => {
  assert.deepStrictEqual(T.normalizeSlug('  My Post_Title  '), { ok: true, slug: 'my-post-title' });
  assert.deepStrictEqual(T.normalizeSlug('สวัสดี ชาวโลก'), { ok: true, slug: 'สวัสดี-ชาวโลก' });
  assert.deepStrictEqual(T.normalizeSlug('ก่ำกิ๊ก-2'), { ok: true, slug: 'ก่ำกิ๊ก-2' });
  for (const bad of ['', '   ', '-', 'a/b', 'a?b', 'a#b', 'a.b', 'a%20b', '<script>', 'a&b', 'ａｂｃ!', '../x', 'a\u0000b', 'emoji😀', 'ไทย๏', 'x'.repeat(81)]) assert.strictEqual(T.normalizeSlug(bad).ok, false, JSON.stringify(bad));
  for (const w of T.RESERVED_SLUGS) { assert.strictEqual(T.normalizeSlug(w).ok, false, w); assert.strictEqual(T.normalizeSlug(w.toUpperCase()).ok, false, w + ' upper'); }
  assert.strictEqual(T.normalizeSlug(123).ok, false);
  assert.deepStrictEqual(T.RESERVED_SLUGS.slice().sort(), ['admin', 'api', 'category', 'edit', 'feed', 'new', 'rss', 'tag']);
  assert.deepStrictEqual(T.normalizeSlug('a'.repeat(80)), { ok: true, slug: 'a'.repeat(80) });
});

test('language suggestion and category helpers', () => {
  assert.strictEqual(T.suggestLang('Just English here'), 'en');
  assert.strictEqual(T.suggestLang('สวัสดีครับ วันนี้อากาศดี'), 'th');
  assert.strictEqual(T.suggestLang('A title with a little ไทย'), 'en');
  assert.strictEqual(T.suggestLang(''), 'en');
  assert.deepStrictEqual(T.cleanCategoryName('  Slow   living '), { ok: true, name: 'Slow living' });
  assert.strictEqual(T.cleanCategoryName('x'.repeat(41)).ok, false); assert.strictEqual(T.cleanCategoryName('x'.repeat(40)).ok, true);
  assert.strictEqual(T.cleanCategoryName('   ').ok, false); assert.strictEqual(T.cleanCategoryName('a\u0000b').ok, false);
  assert.strictEqual(T.cleanCategoryName('ก'.repeat(40)).ok, true, 'Thai counted in characters, not bytes');
  assert.strictEqual(T.categoryKey('Slow'), T.categoryKey(' slow '));
  assert.strictEqual(T.categorySlug('Slow Living!'), 'slow-living');
  assert.strictEqual(T.categorySlug('การเดินทาง'), 'การเดินทาง');
  assert.ok(/^c-/.test(T.categorySlug('!!!')));
});

// ---------------- toolbar edits never split a Thai character ----------------
test('wrap/line/link edits: results, toggling, and Thai character clusters stay whole', () => {
  const ap = (text, e) => T.applyEdit(text, e);
  assert.strictEqual(ap('hello world', T.wrapEdit('hello world', 6, 11, '**', '**', 'bold')), 'hello **world**');
  assert.strictEqual(ap('hello **world**', T.wrapEdit('hello **world**', 8, 13, '**', '**', 'bold')), 'hello world', 'toggle off');
  assert.strictEqual(ap('hello', T.wrapEdit('hello', 5, 5, '*', '*', 'italic')), 'hello*italic*', 'empty selection inserts a placeholder');
  assert.strictEqual(ap('a  word  b', T.wrapEdit('a  word  b', 1, 9, '**', '**', 'x')), 'a  **word**  b', 'markers hug the words');
  assert.strictEqual(ap('**bold**', T.wrapEdit('**bold**', 2, 6, '*', '*', 'i')), '***bold***', 'italic inside bold wraps rather than unwrapping');
  // Thai: "ก่ำ" is ก + mai ek + sara am; selecting from inside the cluster must not cut it
  const th = 'สวัสดี ก่ำ ครับ';
  const i = th.indexOf('่');
  const edit = T.wrapEdit(th, i, i + 1, '**', '**', 'x'); // selection is only the tone mark
  const out = ap(th, edit);
  assert.ok(out.includes('**ก่ำ**') || out.includes('**ก่**ำ') === false, out);
  assert.ok(!/ก\*\*่/.test(out) && !/่\*\*ำ/.test(out), 'no marker between a letter and its tone mark: ' + out);
  for (let a = 0; a <= th.length; a++) for (let b = a; b <= th.length; b++) {
    const o = ap(th, T.wrapEdit(th, a, b, '**', '**', 'x'));
    assert.ok(!/[ก-ฮ]\*\*[ัิ-ฺ็-๎]/.test(o), `split cluster for ${a}-${b}: ${o}`);
    assert.ok(!/\*\*[ัิ-ฺ็-๎]/.test(o), `marker before a mark for ${a}-${b}: ${o}`);
  }
  assert.strictEqual(T.snapStart('ก่ำ', 1), 0); assert.strictEqual(T.snapEnd('ก่ำ', 1), 3);
  const emoji = 'a😀b'; assert.strictEqual(T.snapStart(emoji, 2), 1); assert.strictEqual(T.snapEnd(emoji, 2), 3);
  // block formatting
  assert.strictEqual(ap('title', T.lineEdit('title', 0, 0, 'h2')), '## title');
  assert.strictEqual(ap('## title', T.lineEdit('## title', 0, 0, 'h2')), 'title', 'again removes it');
  assert.strictEqual(ap('## title', T.lineEdit('## title', 0, 0, 'h3')), '### title', 'switching heading level');
  assert.strictEqual(ap('a\nb\n\nc', T.lineEdit('a\nb\n\nc', 0, 3, 'ul')), '- a\n- b\n\nc');
  assert.strictEqual(ap('a\nb', T.lineEdit('a\nb', 0, 3, 'ol')), '1. a\n2. b');
  assert.strictEqual(ap('- a\n- b', T.lineEdit('- a\n- b', 0, 7, 'ul')), 'a\nb');
  assert.strictEqual(ap('x\nบรรทัด', T.lineEdit('x\nบรรทัด', 3, 3, 'quote')), 'x\n> บรรทัด');
  assert.strictEqual(ap('see this', T.linkEdit('see this', 4, 8)), 'see [this](https://)');
  const le = T.linkEdit('see this', 4, 8); assert.strictEqual(ap('see this', le).slice(le.selStart, le.selEnd), 'https://');
  assert.strictEqual(ap('para', T.dividerEdit('para', 4)), 'para\n\n---\n\n');
});
