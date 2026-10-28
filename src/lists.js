// Lists in the message input, like Slack / Claude:
//   "1. " / "- " at the start of a line -> list item with an indent
//   Shift+Enter on an item        -> next item ("1." -> "2.", "a." -> "b.", "- [x]" -> "- [ ]")
//   Shift+Enter on an empty item  -> leave the list
//   Tab / Shift+Tab               -> nest / un-nest; numbering per level: 1. -> a. -> i. -> 1. …
//   Backspace right after a marker -> drop the marker, keep the text
// Plain Enter still sends. While the @-mention popup is open, keys stay with Bitrix.
// Indents use em spaces (U+2003): visible in the input, and md.js reads them as nesting.
(() => {
  'use strict';
  if (window.__B48_LISTS) return;
  window.__B48_LISTS = true;

  const EM = ' ';
  const BASE = EM;          // top-level items get one em space of indent
  const STEP = EM + EM;     // each nesting level adds two (md.js: 2 units = 1 level)
  const on = () => document.documentElement.dataset.b48Send !== '0';
  // indent, marker (bullet | number | letter | roman), separator, space, optional checkbox
  const ITEM = /^([ \t ]*)(?:([-*+•])|(\d{1,3}|[a-z]|[ivxlcdm]{1,6})([.)]))([ \t]+)(\[[ xX]\][ \t]+)?/;

  const isInput = (el) => el && el.nodeName === 'TEXTAREA' && el.classList.contains('bx-im-textarea__element');
  const mentionOpen = () => [...document.querySelectorAll('.bx-im-mention-popup__scope')]
    .some((p) => p.getBoundingClientRect().width > 0 && getComputedStyle(p).display !== 'none');

  // ---------- numbering styles: 1 / a / i by nesting level ----------
  const units = (indent) => [...indent].reduce((n, ch) => n + (ch === '\t' ? 2 : 1), 0);
  // Em-space indents carry one extra unit of base indent; plain-space indents (from paste) do not
  const levelOf = (indent) => (units(indent) - (indent.startsWith(EM) ? 1 : 0)) >> 1;
  const styleOf = (level) => ['num', 'alpha', 'roman'][level % 3];
  const ROMAN = [[1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'], [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'], [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  const toRoman = (n) => ROMAN.reduce((s, [v, r]) => { while (n >= v) { s += r; n -= v; } return s; }, '');
  const fromRoman = (s) => { let n = 0, i = 0; for (const [v, r] of ROMAN) while (s.startsWith(r, i)) { n += v; i += r.length; } return i === s.length ? n : 0; };
  const format = (n, style) => (style === 'alpha' ? String.fromCharCode(96 + ((n - 1) % 26) + 1) : style === 'roman' ? toRoman(n) : String(n));
  // Value of a marker in the given style ("c" -> 3, "iv" -> 4); a single "i"/"v"/"x" in a letter level is a letter
  const valueOf = (marker, style) => {
    if (/^\d+$/.test(marker)) return +marker;
    if (style === 'roman') return fromRoman(marker) || 1;
    return marker.length === 1 ? marker.charCodeAt(0) - 96 : fromRoman(marker) || 1;
  };

  function lineAt(ta) {
    const v = ta.value;
    const pos = ta.selectionStart;
    const start = v.lastIndexOf('\n', pos - 1) + 1;
    let end = v.indexOf('\n', pos);
    if (end < 0) end = v.length;
    return { start, end, text: v.slice(start, end), pos };
  }
  const lineIndex = (ta, start) => ta.value.slice(0, start).split('\n').length - 1;

  // Edits go through execCommand so undo works and Vue sees an `input` event
  function replace(ta, from, to, text) {
    ta.setSelectionRange(from, to);
    if (!document.execCommand('insertText', false, text)) {
      ta.setRangeText(text, from, to, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  // Next ordered value at `indent`, continuing the closest sibling above (stops at a shallower item)
  function nextValue(lines, idx, indent) {
    const lvl = levelOf(indent);
    for (let i = idx - 1; i >= 0; i--) {
      const m = lines[i].match(ITEM);
      if (!m) break;
      const l = levelOf(m[1]);
      if (l < lvl) break;
      if (l === lvl) return m[3] ? valueOf(m[3], styleOf(lvl)) + 1 : 1;
    }
    return 1;
  }

  function markerFor(m, indent, value) {
    if (!m[3]) return m[2];
    return format(value, styleOf(levelOf(indent))) + m[4];
  }

  // ---------- keys ----------
  function onShiftEnter(ta, e) {
    const line = lineAt(ta);
    const m = line.text.match(ITEM);
    if (!m) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const markerEnd = line.start + m[0].length;
    if (line.text.slice(m[0].length).trim() === '' && line.pos >= markerEnd) {
      // Empty item: leave the list. Chrome puts the caret back on the previous line after an
      // empty insert, so place it on the now-empty line explicitly.
      replace(ta, line.start, line.end, '');
      ta.setSelectionRange(line.start, line.start);
      return;
    }
    const indent = m[1];
    const value = m[3] ? valueOf(m[3], styleOf(levelOf(indent))) + 1 : 0;
    const head = indent + markerFor(m, indent, value) + m[5] + (m[6] ? '[ ] ' : '');
    // Split at the caret: the rest of the line moves to the new item
    replace(ta, line.pos, ta.selectionEnd, '\n' + head);
  }

  function onTab(ta, e) {
    const line = lineAt(ta);
    const m = line.text.match(ITEM);
    if (!m) return;
    if (ta.value.slice(ta.selectionStart, ta.selectionEnd).includes('\n')) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const indent = m[1];
    let newIndent;
    if (e.shiftKey) {
      if (levelOf(indent) === 0) return;
      newIndent = indent.endsWith(STEP) ? indent.slice(0, -STEP.length) : indent.replace(/(  |\t)$/, '');
    } else {
      newIndent = indent || BASE;
      newIndent += STEP;
    }
    const lines = ta.value.split('\n');
    const value = m[3] ? nextValue(lines, lineIndex(ta, line.start), newIndent) : 0;
    const oldHead = indent + (m[3] ? m[3] + m[4] : m[2]);
    const newHead = newIndent + markerFor(m, newIndent, value);
    const caret = line.pos - line.start;
    replace(ta, line.start, line.start + oldHead.length, newHead);
    const pos = line.start + Math.max(newHead.length + m[5].length, caret + (newHead.length - oldHead.length));
    ta.setSelectionRange(pos, pos);
  }

  // "1." / "a." / "-" typed at the very start of a line, then space -> indented list item
  function onSpace(ta, e) {
    if (ta.selectionStart !== ta.selectionEnd) return;
    const line = lineAt(ta);
    const before = ta.value.slice(line.start, line.pos);
    if (!/^(\d{1,3}[.)]|[-*•])$/.test(before)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    replace(ta, line.start, line.pos, BASE + before + ' ');
  }

  // Backspace right after "1. " (or "- ", "- [ ] ") removes the list formatting of that line
  function onBackspace(ta, e) {
    if (ta.selectionStart !== ta.selectionEnd) return;
    const line = lineAt(ta);
    const m = line.text.match(ITEM);
    if (!m || line.pos !== line.start + m[0].length) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    replace(ta, line.start, line.pos, '');
    ta.setSelectionRange(line.start, line.start);
  }

  document.addEventListener('keydown', (e) => {
    const ta = e.target;
    if (!on() || !isInput(ta) || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (mentionOpen()) return;
    if (e.key === 'Enter' && e.shiftKey) onShiftEnter(ta, e);
    else if (e.key === 'Tab') onTab(ta, e);
    else if (e.key === ' ' && !e.shiftKey) onSpace(ta, e);
    else if (e.key === 'Backspace' && !e.shiftKey) onBackspace(ta, e);
  }, true);
})();
