// Clipboard HTML -> Markdown, so pasting formatted text (Claude, Cursor, VS Code, browsers,
// Google Docs) keeps its formatting. The Markdown is then sent as BBCode by md.js.
(function (root) {
  'use strict';

  const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV', 'FIGURE',
    'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'PRE', 'BLOCKQUOTE', 'TABLE', 'HR', 'DL', 'DT', 'DD', 'DETAILS', 'SUMMARY']);
  const SKIP = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'HEAD', 'TITLE', 'NOSCRIPT', 'TEMPLATE', 'BUTTON', 'SVG', 'svg']);

  const styleOf = (el) => (el.getAttribute && el.getAttribute('style')) || '';
  const isMonoStyle = (s) => /font-family:[^;]*(mono|menlo|consolas|courier|sf ?mono|jetbrains|fira code)/i.test(s);
  const isPreStyle = (s) => /white-space:\s*(pre|pre-wrap|break-spaces)/i.test(s);
  const isBoldStyle = (s) => /font-weight:\s*(bold|[6-9]00)/i.test(s);
  const isItalicStyle = (s) => /font-style:\s*italic/i.test(s);
  const isStrikeStyle = (s) => /text-decoration[^;]*line-through/i.test(s);

  // Wrap with a marker, keeping surrounding spaces outside: "** bold **" is not bold in Markdown.
  function wrap(s, mark) {
    const m = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!m[2]) return s;
    return m[1] + mark + m[2] + mark + m[3];
  }

  function textOfPre(el) {
    // VS Code / Cursor put each line in its own <div>; <br> also means a newline.
    let out = '';
    const walk = (n) => {
      if (n.nodeType === 3) { out += n.nodeValue; return; }
      if (n.nodeType !== 1 || SKIP.has(n.nodeName)) return;
      if (n.nodeName === 'BR') { out += '\n'; return; }
      const isLine = n.nodeName === 'DIV' || n.nodeName === 'P';
      if (isLine && out && !out.endsWith('\n')) out += '\n';
      n.childNodes.forEach(walk);
      if (isLine && !out.endsWith('\n')) out += '\n';
    };
    el.childNodes.forEach(walk);
    return out.replace(/ /g, ' ').replace(/\n+$/, '');
  }

  function langOf(el) {
    const code = el.querySelector ? el.querySelector('code') || el : el;
    const cls = (code.className || '') + ' ' + (el.className || '');
    const m = cls.match(/(?:language|lang)-([\w+#-]+)/);
    return m ? m[1] : '';
  }

  function fence(body, lang) {
    const ticks = /```/.test(body) ? '~~~' : '```';
    return `\n\n${ticks}${lang || ''}\n${body}\n${ticks}\n\n`;
  }

  function inline(n) {
    if (n.nodeType === 3) return n.nodeValue.replace(/[\s ]+/g, ' ');
    if (n.nodeType !== 1 || SKIP.has(n.nodeName)) return '';
    const kids = () => [...n.childNodes].map(inline).join('');
    const st = styleOf(n);
    switch (n.nodeName) {
      case 'BR': return '\n';
      case 'B': case 'STRONG':
        // Google Docs wraps the whole document in <b style="font-weight:normal">
        return /font-weight:\s*(normal|[1-4]00)/i.test(st) ? kids() : wrap(kids(), '**');
      case 'I': case 'EM': return wrap(kids(), '*');
      case 'S': case 'DEL': case 'STRIKE': return wrap(kids(), '~~');
      case 'CODE': case 'KBD': case 'SAMP': case 'TT': {
        const t = n.textContent.replace(/\n/g, ' ');
        return t.includes('`') ? '`` ' + t + ' ``' : '`' + t + '`';
      }
      case 'A': {
        const raw = (n.getAttribute('href') || '').trim();
        const t = kids().trim();
        // Only web and mail links; anything else (javascript:, data:, file:) keeps just the text.
        if (!/^(https?:|mailto:)/i.test(raw)) return t;
        const href = raw.replace(/[\s()<>"'\[\]]/g, (c) => encodeURIComponent(c));
        return !t || t === href ? href : `[${t}](${href})`;
      }
      case 'IMG': return n.getAttribute('alt') || '';
      case 'INPUT': return n.type === 'checkbox' ? (n.checked ? '[x] ' : '[ ] ') : '';
      default: {
        let s = kids();
        if (isMonoStyle(st) && !s.includes('\n') && s.trim()) return '`' + s.trim() + '`';
        if (isBoldStyle(st)) s = wrap(s, '**');
        if (isItalicStyle(st)) s = wrap(s, '*');
        if (isStrikeStyle(st)) s = wrap(s, '~~');
        return s;
      }
    }
  }

  function list(el, depth) {
    const ordered = el.nodeName === 'OL';
    let i = +(el.getAttribute('start') || 1);
    const lines = [];
    for (const li of el.children) {
      if (li.nodeName !== 'LI') continue;
      const nested = [];
      const own = [];
      for (const c of li.childNodes) {
        if (c.nodeName === 'UL' || c.nodeName === 'OL') nested.push(list(c, depth + 1));
        else own.push(c.nodeType === 1 && BLOCK.has(c.nodeName) ? blocks(c).trim() : inline(c));
      }
      const text = own.join(' ').replace(/\s*\n\s*/g, ' ').replace(/ {2,}/g, ' ').trim();
      const marker = ordered ? `${i++}.` : '-';
      lines.push('  '.repeat(depth) + marker + ' ' + text);
      nested.forEach((n) => lines.push(n));
    }
    return lines.join('\n');
  }

  function table(el) {
    const rows = [...el.querySelectorAll('tr')].map((tr) =>
      [...tr.children].filter((c) => c.nodeName === 'TD' || c.nodeName === 'TH')
        .map((c) => inline(c).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|').trim()));
    if (!rows.length) return '';
    const cols = Math.max(...rows.map((r) => r.length));
    const norm = rows.map((r) => { while (r.length < cols) r.push(''); return '| ' + r.join(' | ') + ' |'; });
    norm.splice(1, 0, '|' + ' --- |'.repeat(cols));
    return '\n\n' + norm.join('\n') + '\n\n';
  }

  function blocks(n) {
    if (n.nodeType === 3) return inline(n);
    if (n.nodeType !== 1 || SKIP.has(n.nodeName)) return '';
    const st = styleOf(n);
    const kids = () => [...n.childNodes].map(blocks).join('');
    switch (n.nodeName) {
      case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6':
        return `\n\n${'#'.repeat(+n.nodeName[1])} ${inline(n).trim()}\n\n`;
      case 'P': return `\n\n${kids().trim()}\n\n`;
      case 'PRE': return fence(textOfPre(n), langOf(n));
      case 'UL': case 'OL': return `\n\n${list(n, 0)}\n\n`;
      case 'BLOCKQUOTE': {
        const body = kids().trim().replace(/\n{3,}/g, '\n\n');
        return '\n\n' + body.split('\n').map((l) => '> ' + l).join('\n') + '\n\n';
      }
      case 'TABLE': return table(n);
      case 'HR': return '\n\n---\n\n';
      case 'LI': return `\n- ${inline(n).trim()}\n`;
      case 'DIV': case 'SECTION': case 'ARTICLE': case 'MAIN': case 'FIGURE': {
        // Code editors: a monospace block that keeps whitespace is a code block.
        const multiline = n.textContent.includes('\n') || n.querySelector('br, div');
        if ((isPreStyle(st) && isMonoStyle(st)) || ((isPreStyle(st) || isMonoStyle(st)) && multiline)) {
          return fence(textOfPre(n), '');
        }
        const hasBlock = [...n.children].some((c) => BLOCK.has(c.nodeName));
        return hasBlock ? kids() : `\n${kids().trim()}\n`;
      }
      default:
        if (BLOCK.has(n.nodeName)) return `\n${kids()}\n`;
        // Inline wrapper around blocks (Google Docs: <b><p>…</p><ul>…</ul></b>)
        if (n.querySelector && n.querySelector([...BLOCK].join(','))) return kids();
        return inline(n);
    }
  }

  function htmlToMd(html) {
    if (!html || typeof DOMParser === 'undefined') return null;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const md = blocks(doc.body)
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return md || null;
  }

  // Did the HTML carry formatting that plain text would lose?
  function hasFormatting(md, plain) {
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
    return norm(md) !== norm(plain);
  }

  root.__B48_PASTE = { htmlToMd, hasFormatting };
})(window);
