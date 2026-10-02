/*
  Field Notes renderer: the owner's simple text -> safe HTML. Shared by the writing page's live preview and (later)
  the public pages. Works in the browser and in Node; no DOM, no dependencies.

  Syntax: paragraphs, ## heading, ### subheading, **bold**, *italic*, > quote, - list, 1. numbered list,
          [text](url), --- divider. A single new line is a line break; a blank line starts a new paragraph.
          A backslash makes the next symbol plain text (\*  \[  \#).

  Safety rules (all covered by tests/fn-render.test.js):
  - Every piece of text is HTML-escaped. Raw HTML in the input can never reach the output as markup.
  - Only these tags are ever produced: p h2 h3 strong em blockquote ul ol li a hr br.
  - Links: only http, https and mailto, with no spaces or control characters in the address. Anything else (javascript:,
    data:, relative, ...) is shown as plain text, exactly as typed. External links get target="_blank" rel="noopener noreferrer".
  - No images, no style or class attributes, no ids.
  - Linear-time scanning (no backtracking regexes on user text). Bold/italic pairing uses one pass with a stack, and
    link scanning is capped (300 characters of link text, 2000 of address), so hostile input can't freeze the browser.
*/
(function (root) {
  const MAX_INPUT = 300000; // anything beyond this is cut (the page limits posts to 100,000 characters long before this)
  const MAX_LINK_TEXT = 300;
  const MAX_URL = 2000;
  const ESCAPABLE = '\\*[]()#>-_`';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // http(s)/mailto only; no whitespace or control characters anywhere (browsers ignore tabs/newlines inside a URL,
  // which is how "java<tab>script:" tricks work).
  const URL_BAD = /[\x00-\x20\x7F-\x9F\u00A0\u1680\u2000-\u200F\u2028-\u202F\u205F-\u2064\u3000\uFEFF\\<>"'`]/;
  function safeUrl(u) {
    if (typeof u !== 'string' || !u || u.length > MAX_URL || URL_BAD.test(u)) return null;
    if (/^https?:\/\/[^/?#]+/i.test(u)) return u;
    if (/^mailto:[^?#]+/i.test(u)) return u;
    return null;
  }

  const isSpace = (c) => c === undefined || c === ' ' || c === '\n' || c === '\t' || c === '\x20' || c.charCodeAt(0) === 0xA0 || c.charCodeAt(0) === 0x3000;

  // [text](url) starting at src[i] === '['. Returns { html, next } or null. Bounded work per call.
  function parseLink(src, i) {
    const n = src.length;
    let k = i + 1;
    const limit = Math.min(n, i + 2 + MAX_LINK_TEXT);
    while (k < limit && src[k] !== ']' && src[k] !== '[') k++;
    if (k >= limit || src[k] !== ']' || src[k + 1] !== '(' || k === i + 1) return null;
    const label = src.slice(i + 1, k);
    let j = k + 2, depth = 0;
    const urlLimit = Math.min(n, k + 2 + MAX_URL);
    while (j < urlLimit) {
      const c = src[j];
      if (c === '(') depth++;
      else if (c === ')') { if (depth === 0) break; depth--; }
      else if (c === ' ' || c === '\n' || c === '\t') return null;
      j++;
    }
    if (j >= urlLimit || src[j] !== ')') return null;
    const url = src.slice(k + 2, j);
    const safe = safeUrl(url);
    if (!safe) return null; // not allowed: the caller shows the whole thing as plain text
    const external = /^https?:/i.test(safe);
    const html = `<a href="${esc(safe)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${inline(label, true)}</a>`;
    return { html, next: j + 1 };
  }

  // Inline text -> HTML. One left-to-right pass builds tokens; ** and * are then paired with a stack.
  function inline(src, noLinks) {
    const n = src.length;
    const toks = []; // { k:'t', v } | { k:'h', v } | { k:'d', type:'b'|'i', open:bool, matched:bool }
    let buf = '';
    const flush = () => { if (buf) { toks.push({ k: 't', v: buf }); buf = ''; } };
    const stack = []; // openers waiting for a closer
    const top = { b: -1, i: -1 }; // index in stack of the newest open ** / *
    const pop = () => { const e = stack.pop(); top[e.type] = e.prev; return e; };

    function marker(type, canOpen, canClose) {
      if (canClose && top[type] !== -1) {
        // close the newest matching opener; anything opened after it (the other type) can no longer match
        while (stack.length - 1 > top[type]) pop();
        const opener = pop();
        if (opener.idx === toks.length - 1) { opener.tok.matched = false; flushDelimiter(type, false); return; } // nothing between them: show as text
        opener.tok.matched = true;
        toks.push({ k: 'd', type, open: false, matched: true });
        return;
      }
      if (canOpen) {
        flush();
        const tok = { k: 'd', type, open: true, matched: false };
        toks.push(tok);
        stack.push({ type, idx: toks.length - 1, tok, prev: top[type] });
        top[type] = stack.length - 1;
        return;
      }
      flushDelimiter(type, false);
    }
    function flushDelimiter(type, _) { buf += type === 'b' ? '**' : '*'; }

    let i = 0;
    while (i < n) {
      const c = src[i];
      if (c === '\\' && i + 1 < n && ESCAPABLE.includes(src[i + 1])) { buf += src[i + 1]; i += 2; continue; }
      if (c === '*') {
        let j = i; while (j < n && src[j] === '*') j++;
        const run = j - i;
        const canOpen = !isSpace(src[j]);
        const canClose = i > 0 && !isSpace(src[i - 1]);
        flush();
        // opening run: bold first, then italic inside; closing run: italic first, then bold
        let bolds = Math.floor(run / 2), single = run % 2;
        if (canClose && !canOpen) { if (single) marker('i', false, true); for (let b = 0; b < bolds; b++) marker('b', false, true); }
        else if (canOpen && !canClose) { for (let b = 0; b < bolds; b++) marker('b', true, false); if (single) marker('i', true, false); }
        else { // between letters (common in Thai, which has no spaces): close if something is open, otherwise open
          if (single) marker('i', true, true);
          for (let b = 0; b < bolds; b++) marker('b', true, true);
        }
        i = j; continue;
      }
      if (c === '[' && !noLinks) {
        const link = parseLink(src, i);
        if (link) { flush(); toks.push({ k: 'h', v: link.html }); i = link.next; continue; }
      }
      buf += c; i++;
    }
    flush();

    let out = '';
    for (const t of toks) {
      if (t.k === 't') out += esc(t.v);
      else if (t.k === 'h') out += t.v;
      else if (t.matched) out += (t.open ? '<' : '</') + (t.type === 'b' ? 'strong' : 'em') + '>';
      else out += t.type === 'b' ? '**' : '*';
    }
    return out;
  }

  const lineBreaks = (html) => html.replace(/\n/g, '<br>');
  const para = (text) => `<p>${lineBreaks(inline(text))}</p>`;

  const isHr = (l) => { const t = l.trim(); if (t.length < 3) return false; for (let i = 0; i < t.length; i++) if (t[i] !== '-') return false; return true; };
  function heading(l) { // returns { tag, text } or null
    const level = l.startsWith('### ') ? 3 : l.startsWith('## ') ? 2 : 0;
    if (!level) return null;
    const text = l.slice(level + 1).trim();
    return text ? { tag: 'h' + level, text } : null;
  }
  const isQuote = (l) => l.charCodeAt(0) === 62; // '>'
  const isUl = (l) => l.startsWith('- ');
  function olItem(l) { // "12. text" -> text
    let i = 0; while (i < l.length && i < 9 && l.charCodeAt(i) >= 48 && l.charCodeAt(i) <= 57) i++;
    return i > 0 && l[i] === '.' && l[i + 1] === ' ' ? l.slice(i + 2) : null;
  }
  const startsBlock = (l) => isHr(l) || !!heading(l) || isQuote(l) || isUl(l) || olItem(l) !== null;

  function render(input) {
    let text = String(input == null ? '' : input);
    if (text.length > MAX_INPUT) text = text.slice(0, MAX_INPUT);
    const lines = text.replace(/\r\n?/g, '\n').split('\n').map((l) => l.trimEnd());
    const out = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) { i++; continue; }
      if (isHr(line)) { out.push('<hr>'); i++; continue; }
      const h = heading(line);
      if (h) { out.push(`<${h.tag}>${inline(h.text)}</${h.tag}>`); i++; continue; }
      if (isQuote(line)) {
        const paras = []; let cur = [];
        while (i < lines.length && isQuote(lines[i])) {
          const body = lines[i].slice(1).replace(/^ /, '');
          if (!body.trim()) { if (cur.length) { paras.push(cur.join('\n')); cur = []; } } else cur.push(body);
          i++;
        }
        if (cur.length) paras.push(cur.join('\n'));
        out.push(`<blockquote>${paras.map(para).join('')}</blockquote>`);
        continue;
      }
      if (isUl(line)) {
        const items = [];
        while (i < lines.length && isUl(lines[i])) { const t = lines[i].slice(2).trim(); if (t) items.push(`<li>${inline(t)}</li>`); i++; }
        out.push(`<ul>${items.join('')}</ul>`);
        continue;
      }
      if (olItem(line) !== null) {
        const items = [];
        while (i < lines.length && olItem(lines[i]) !== null) { const t = olItem(lines[i]).trim(); if (t) items.push(`<li>${inline(t)}</li>`); i++; }
        out.push(`<ol>${items.join('')}</ol>`);
        continue;
      }
      const buf = [];
      while (i < lines.length && lines[i].trim() && !(buf.length && startsBlock(lines[i]))) { buf.push(lines[i]); i++; }
      out.push(para(buf.join('\n')));
    }
    return out.join('\n');
  }

  const api = { render, esc, safeUrl, MAX_INPUT, ALLOWED_TAGS: ['p', 'h2', 'h3', 'strong', 'em', 'blockquote', 'ul', 'ol', 'li', 'a', 'hr', 'br'] };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FnRender = api;
})(typeof window !== 'undefined' ? window : this);
