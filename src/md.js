// Markdown <-> Bitrix24 BBCode.
// toBB(md)      — what we send: native BBCode that looks fine in official clients.
// render(...)   — what we show: md (and our own BB fallbacks) as rich HTML.
// bbToMd(bb)    — what goes into the editor when editing a message.
(function (root) {
  'use strict';

  const HTML_MARK = '⁣'; // survives the native Bitrix parser untouched
  const HOLD_MARK = '⁤'; // restored before the native parser runs
  const EMSP = ' ';
  const HR_TEXT = '──────────';
  const NBSP = '\u00a0';
  // Native [CODE] collapses runs of spaces (white-space-collapse: preserve-breaks).
  // Non-breaking spaces survive, so indentation and table alignment stay intact.
  const keepSpaces = (s) => s.replace(/^ +| {2,}/gm, (m) => NBSP.repeat(m.length));
  const codeBB = (body) => `[CODE]${keepSpaces(body)}[/CODE]`;

  const esc = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ---------- placeholders ----------
  function makeCtx(mode, decodeInline) {
    const holds = [];
    const htmls = [];
    const ctx = {
      mode,
      hold(raw) { holds.push(raw); return HOLD_MARK + 'H' + (holds.length - 1) + HOLD_MARK; },
      html(h, block) { htmls.push({ h, block: !!block }); return HTML_MARK + (htmls.length - 1) + HTML_MARK; },
      restoreHold(s) {
        const re = new RegExp(HOLD_MARK + 'H(\\d+)' + HOLD_MARK, 'g');
        for (let i = 0; i < 6 && s.includes(HOLD_MARK); i++) s = s.replace(re, (_, n) => holds[+n]);
        return s;
      },
      finish(s) {
        const re = new RegExp('(<br\\s*/?>\\s*)?' + HTML_MARK + '(\\d+)' + HTML_MARK + '(\\s*<br\\s*/?>)?', 'g');
        for (let i = 0; i < 6 && s.includes(HTML_MARK); i++) {
          s = s.replace(re, (m, pre, n, post) => {
            const t = htmls[+n];
            if (!t) return m;
            return t.block ? t.h : (pre || '') + t.h + (post || '');
          });
        }
        return s;
      },
      // Inline md -> final HTML (used for table cells, list items in render mode).
      inlineHtml(s) { return ctx.finish(decodeInline(ctx.restoreHold(inlineToBB(s, ctx)))); },
    };
    return ctx;
  }

  // ---------- width for aligned monospace tables ----------
  const WIDE = /\p{Extended_Pictographic}|[ᄀ-ᅟ⺀-꓏가-힣豈-﫿＀-｠￠-￦]/u;
  const ZERO = /\p{M}|‍|️/u;
  function width(s) { let w = 0; for (const ch of s) w += WIDE.test(ch) ? 2 : ZERO.test(ch) ? 0 : 1; return w; }

  // ---------- tables ----------
  function splitRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
    const cells = [];
    let cur = '';
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
      if (s[i] === '|') { cells.push(cur.trim()); cur = ''; continue; }
      cur += s[i];
    }
    cells.push(cur.trim());
    return cells;
  }
  function isSep(line) {
    const t = line.trim();
    if (!t.includes('-') || !t.includes('|') || !/^[\s|:\-]+$/.test(t)) return false;
    return splitRow(t).every((c) => /^:?-+:?$/.test(c));
  }
  function tableAt(lines, i) {
    if (i + 1 >= lines.length || !lines[i].includes('|') || !isSep(lines[i + 1])) return null;
    const header = splitRow(lines[i]);
    const sep = splitRow(lines[i + 1]);
    if (header.length !== sep.length) return null;
    const align = sep.map((c) => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : ''));
    const rows = [];
    let j = i + 2;
    while (j < lines.length && lines[j].includes('|') && lines[j].trim()) {
      const r = splitRow(lines[j]);
      while (r.length < header.length) r.push('');
      rows.push(r.slice(0, header.length));
      j++;
    }
    return { header, align, rows, end: j };
  }
  function isTableBlock(body) {
    const lines = body.trim().split('\n');
    const t = tableAt(lines, 0);
    return t && t.end === lines.length ? t : null;
  }
  function pad(s, w, a) {
    const gap = Math.max(0, w - width(s));
    if (a === 'right') return ' '.repeat(gap) + s;
    if (a === 'center') return ' '.repeat(gap >> 1) + s + ' '.repeat(gap - (gap >> 1));
    return s + ' '.repeat(gap);
  }
  function tableText(t) {
    const escCell = (c) => c.replace(/\|/g, '\\|');
    const all = [t.header, ...t.rows].map((r) => r.map(escCell));
    const w = t.header.map((_, c) => Math.max(3, ...all.map((r) => width(r[c] || ''))));
    const line = (r) => '| ' + r.map((c, k) => pad(c || '', w[k], t.align[k])).join(' | ') + ' |';
    const sep = '|' + w.map((n, k) => {
      const a = t.align[k];
      if (a === 'center') return ':' + '-'.repeat(n) + ':';
      if (a === 'right') return '-'.repeat(n + 1) + ':';
      if (a === 'left') return ':' + '-'.repeat(n + 1);
      return '-'.repeat(n + 2);
    }).join('|') + '|';
    return [line(all[0]), sep, ...all.slice(1).map(line)].join('\n');
  }
  function tableHtml(t, ctx) {
    const st = (k) => (t.align[k] ? ` style="text-align:${t.align[k]}"` : '');
    const head = t.header.map((c, k) => `<th${st(k)}>${ctx.inlineHtml(c)}</th>`).join('');
    const body = t.rows.map((r) => '<tr>' + r.map((c, k) => `<td${st(k)}>${ctx.inlineHtml(c)}</td>`).join('') + '</tr>').join('');
    return `<div class="b48-table-wrap"><table class="b48-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`;
  }

  // ---------- inline ----------
  const W = '\\p{L}\\p{N}';
  const RE = {
    escape: /\\([*_~`#|\\[\]>-])/g,
    code3: /```([^`\n]+?)```/g,
    code: /`([^`\n]+)`/g,
    bbBlock: /\[(url|user|chat|icon|disk|send|put|call|pch|context|code|quote)\b[^\]\n]*\][\s\S]*?\[\/\1\]/gi,
    bbTag: /\[\/?[a-z*]+(?:=[^\]\n]*)?\]/gi,
    img: /!\[([^\]\n]*)\]\(((?:https?:\/\/|mailto:)[^\s()<>"'\[\]]+)\)/g,
    link: /\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s()<>"'\[\]]+)\)/g,
    url: /\bhttps?:\/\/[^\s<>\[\]]+/g,
    bold: /\*\*(?=\S)([^\n]+?)(?<=\S)\*\*/g,
    boldU: new RegExp(`(^|[^${W}_])__(?=\\S)([^\\n]+?)(?<=\\S)__(?![${W}_])`, 'gu'),
    strike: /~~(?=\S)([^\n]+?)(?<=\S)~~/g,
    ital: new RegExp(`(^|[^${W}*\\\\])\\*(?=[^\\s*])([^\\n*]+?)(?<=[^\\s*])\\*(?![${W}*])`, 'gu'),
    italU: new RegExp(`(^|[^${W}_\\\\])_(?=[^\\s_])([^\\n_]+?)(?<=[^\\s_])_(?![${W}_])`, 'gu'),
  };

  function inlineCode(code, ctx) {
    return ctx.mode === 'render'
      ? ctx.html(`<code class="b48-code">${esc(code)}</code>`)
      : ctx.hold('`' + code + '`');
  }

  function inlineToBB(s, ctx) {
    s = s.replace(RE.escape, (_, ch) => ctx.hold(ctx.mode === 'render' ? ch : '\\' + ch));
    s = s.replace(RE.code3, (_, c) => inlineCode(c, ctx));
    s = s.replace(RE.code, (_, c) => inlineCode(c, ctx));
    s = s.replace(RE.bbBlock, (m) => ctx.hold(m));
    s = s.replace(RE.img, (_, alt, u) => ctx.hold(`[URL=${u}]${alt || u}[/URL]`));
    s = s.replace(RE.link, (_, text, u) => ctx.hold(`[URL=${u}]`) + text + ctx.hold('[/URL]'));
    s = s.replace(RE.bbTag, (m) => ctx.hold(m));
    s = s.replace(RE.url, (m) => ctx.hold(m));
    s = s.replace(RE.bold, '[B]$1[/B]');
    s = s.replace(RE.boldU, '$1[B]$2[/B]');
    s = s.replace(RE.strike, '[S]$1[/S]');
    s = s.replace(RE.ital, '$1[I]$2[/I]');
    s = s.replace(RE.italU, '$1[I]$2[/I]');
    return s;
  }

  // ---------- blocks ----------
  const LINE = {
    heading: /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/,
    hr: /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/,
    quote: /^\s{0,3}>(?!>)\s?(.*)$/,
    item: /^([ \t ]*)([-*+•☐☑]|\d{1,3}[.)])\s+(?:\[([ xX])\]\s+)?(.*)$/,
  };
  const FENCE = /^[ \t]*(```|~~~)[^\n`]*\n([\s\S]*?)\n[ \t]*\1[ \t]*$/gm;
  const BBCODE = /\[code\]([\s\S]*?)\[\/code\]/gi;

  function level(indent) {
    let n = 0;
    for (const ch of indent) n += ch === '\t' ? 2 : 1;
    return Math.min(4, n >> 1);
  }

  function convert(text, ctx) {
    text = String(text).replace(/\r\n?/g, '\n');

    text = text.replace(FENCE, (_, f, body) => (ctx.mode === 'render'
      ? ctx.html(`<pre class="b48-pre"><code>${esc(body)}</code></pre>`, true)
      : ctx.hold(codeBB(body))));

    text = text.replace(BBCODE, (m, body) => {
      if (ctx.mode !== 'render') return ctx.hold(m);
      const t = isTableBlock(body.replace(/<br\s*\/?>/gi, '\n'));
      return t ? ctx.html(tableHtml(t, ctx), true) : ctx.hold(m);
    });

    const lines = text.split('\n');
    const out = [];
    const inl = (s) => inlineToBB(s, ctx);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      const t = tableAt(lines, i);
      if (t) {
        out.push(ctx.mode === 'render' ? ctx.html(tableHtml(t, ctx), true) : ctx.hold(codeBB(tableText(t))));
        i = t.end - 1;
        continue;
      }

      let m;
      if ((m = line.match(LINE.heading))) {
        const n = m[1].length;
        if (ctx.mode === 'render') {
          out.push(ctx.html(`<div class="b48-h b48-h${n}">`, true) + inl(m[2]) + ctx.html('</div>', true));
        } else {
          const size = n === 1 ? 20 : n === 2 ? 17 : 0;
          out.push(size ? `[SIZE=${size}][B]${inl(m[2])}[/B][/SIZE]` : `[B]${inl(m[2])}[/B]`);
        }
        continue;
      }
      if (LINE.hr.test(line)) {
        out.push(ctx.mode === 'render' ? ctx.html('<hr class="b48-hr">', true) : HR_TEXT);
        continue;
      }
      if ((m = line.match(LINE.quote))) {
        out.push('>>' + inl(m[1]));
        continue;
      }
      if (LINE.item.test(line)) {
        const items = [];
        while (i < lines.length && (m = lines[i].match(LINE.item))) {
          items.push({ lvl: level(m[1]), mark: m[2], check: m[3], body: m[4] });
          i++;
        }
        i--;
        out.push(listOut(items, ctx));
        continue;
      }
      out.push(inl(line));
    }
    return out.join('\n');
  }

  function listOut(items, ctx) {
    const mark = (it) => {
      if (it.check !== undefined) return it.check === ' ' ? '☐' : '☑';
      if (it.mark === '☐' || it.mark === '☑') return it.mark;
      return /\d/.test(it.mark) ? it.mark.replace(')', '.') : '•';
    };
    if (ctx.mode === 'render') {
      const lis = items.map((it) => `<div class="b48-li" style="--b48-lvl:${it.lvl}"><span class="b48-mark">${esc(mark(it))}</span><span class="b48-li-body">${ctx.inlineHtml(it.body)}</span></div>`);
      return ctx.html(`<div class="b48-list">${lis.join('')}</div>`, true);
    }
    return items.map((it) => EMSP.repeat(it.lvl * 2) + mark(it) + ' ' + inlineToBB(it.body, ctx)).join('\n');
  }

  // ---------- public API ----------
  const MD_HINT = /\*\*|__|~~|`|\[code\]|^\s{0,3}#{1,6}\s|^[ \t ]*([-*+•☐☑]|\d{1,3}[.)])\s|^\s{0,3}>(?!>)|\|.*\||(^|[^\p{L}\p{N}])[*_][^\s*_]|\[[^\]\n]+\]\(https?:/imu;

  // Our placeholders use these invisible chars; never let them come from message text.
  const MARKS = /[\u2063\u2064]/g;

  function toBB(text) {
    if (!text || !MD_HINT.test(text)) return text;
    text = text.replace(MARKS, '');
    const ctx = makeCtx('send');
    return ctx.restoreHold(convert(text, ctx));
  }

  function render(text, decodeFull, decodeInline) {
    if (!text || !MD_HINT.test(text)) return decodeFull(text);
    text = text.replace(MARKS, '');
    const ctx = makeCtx('render', decodeInline);
    const bb = ctx.restoreHold(convert(text, ctx));
    return ctx.finish(decodeFull(bb));
  }

  function bbToMd(s) {
    if (!s) return s;
    return String(s)
      .replace(/\[code\]([\s\S]*?)\[\/code\]/gi, (_, raw) => {
        const b = raw.replace(/\u00a0/g, ' ');
        return isTableBlock(b) ? b.trim() : '```\n' + b + '\n```';
      })
      .replace(/\[size=(\d+)\]\[b\]([^\n]*?)\[\/b\]\[\/size\]/gi, (_, n, x) => (+n >= 19 ? '# ' : '## ') + x)
      .replace(/\[b\]([^\n]*?)\[\/b\]/gi, '**$1**')
      .replace(/\[i\]([^\n]*?)\[\/i\]/gi, '*$1*')
      .replace(/\[s\]([^\n]*?)\[\/s\]/gi, '~~$1~~')
      .replace(/\[url=([^\]\n]+)\]([^\n]*?)\[\/url\]/gi, (_, u, t) => (t === u ? u : `[${t}](${u})`))
      .replace(/\[url\]([^\n]*?)\[\/url\]/gi, '$1')
      .replace(/^>>/gm, '> ')
      .replace(/^( *)([•☐☑])\s/gm, (_, ind, m) => '  '.repeat(ind.length / 2) + (m === '•' ? '- ' : m === '☐' ? '- [ ] ' : '- [x] '))
      .replace(new RegExp('^' + HR_TEXT + '$', 'gm'), '---');
  }

  function stripMd(s) {
    if (typeof s !== 'string') return s;
    const out = s.replace(/\*\*|__|~~|`/g, '').replace(/^\s{0,3}#{1,6}\s+/gm, '');
    // Previews come back unescaped; removing markers must not glue "<" to a tag name.
    const tags = (x) => (x.match(/<[a-z!\/?]/gi) || []).length;
    return tags(out) > tags(s) ? s : out;
  }

  const api = { toBB, render, bbToMd, stripMd, isTableBlock, tableText };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.__B48_MD = api;
})(typeof window !== 'undefined' ? window : globalThis);
