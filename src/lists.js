// Lists in the message input, like Slack / Claude:
//   Shift+Enter on a list item  -> next item ("1." -> "2.", "- [x]" -> "- [ ]")
//   Shift+Enter on an empty item -> leave the list (marker removed)
//   Tab / Shift+Tab on an item   -> indent / outdent (nested numbered lists restart at 1)
// Plain Enter still sends. While the @-mention popup is open, keys stay with Bitrix.
(() => {
  'use strict';
  if (window.__B48_LISTS) return;
  window.__B48_LISTS = true;

  const on = () => document.documentElement.dataset.b48Send !== '0';
  const ITEM = /^([ \t]*)([-*+•]|(\d{1,3})([.)]))([ \t]+)(\[[ xX]\][ \t]+)?/;
  const INDENT = '  ';

  const isInput = (el) => el && el.nodeName === 'TEXTAREA' && el.classList.contains('bx-im-textarea__element');
  const mentionOpen = () => [...document.querySelectorAll('.bx-im-mention-popup__scope')]
    .some((p) => p.getBoundingClientRect().width > 0 && getComputedStyle(p).display !== 'none');

  // Current line of the caret
  function lineAt(ta) {
    const v = ta.value;
    const pos = ta.selectionStart;
    const start = v.lastIndexOf('\n', pos - 1) + 1;
    let end = v.indexOf('\n', pos);
    if (end < 0) end = v.length;
    return { start, end, text: v.slice(start, end), pos };
  }

  // Edits go through execCommand so undo works and Vue sees an `input` event
  function replace(ta, from, to, text) {
    ta.setSelectionRange(from, to);
    if (!document.execCommand('insertText', false, text)) {
      ta.setRangeText(text, from, to, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }

  function nextMarker(m) {
    const [, indent, bullet, num, sep, space, check] = m;
    const marker = num ? `${+num + 1}${sep}` : bullet;
    return indent + marker + space + (check ? '[ ] ' : '');
  }

  // Number to use for an ordered item at `indent`, looking at the items above it
  function numberFor(lines, idx, indent) {
    for (let i = idx - 1; i >= 0; i--) {
      const m = lines[i].match(ITEM);
      if (!m) break;
      if (m[1].length < indent.length) break;
      if (m[1].length === indent.length) return m[3] ? +m[3] + 1 : 1;
    }
    return 1;
  }

  function onShiftEnter(ta, e) {
    const line = lineAt(ta);
    const m = line.text.match(ITEM);
    if (!m) return false;
    e.preventDefault();
    e.stopImmediatePropagation();
    const markerEnd = line.start + m[0].length;
    if (line.text.slice(m[0].length).trim() === '' && line.pos >= markerEnd) {
      // Empty item: leave the list. Chrome puts the caret back on the previous line after an
      // empty insert, so place it on the now-empty line explicitly.
      replace(ta, line.start, line.end, '');
      ta.setSelectionRange(line.start, line.start);
      return true;
    }
    // Split at the caret: the rest of the line moves to the new item
    replace(ta, line.pos, ta.selectionEnd, '\n' + nextMarker(m));
    return true;
  }

  function onTab(ta, e) {
    const line = lineAt(ta);
    const m = line.text.match(ITEM);
    if (!m || ta.selectionStart !== ta.selectionEnd && ta.value.slice(ta.selectionStart, ta.selectionEnd).includes('\n')) return false;
    e.preventDefault();
    e.stopImmediatePropagation();
    const [, indent, bullet, num, sep] = m;
    const caret = line.pos - line.start;
    let newIndent;
    if (e.shiftKey) {
      if (!indent) return true;
      newIndent = indent.replace(/^(  |\t| )/, '');
    } else {
      newIndent = indent + INDENT;
    }
    let marker = bullet;
    if (num) {
      const lines = ta.value.split('\n');
      const idx = ta.value.slice(0, line.start).split('\n').length - 1;
      marker = `${e.shiftKey ? numberFor(lines, idx, newIndent) : 1}${sep}`;
    }
    const oldHead = indent + (num ? num + sep : bullet);
    const newHead = newIndent + marker;
    replace(ta, line.start, line.start + oldHead.length, newHead);
    const pos = line.start + Math.max(newHead.length, caret + (newHead.length - oldHead.length));
    ta.setSelectionRange(pos, pos);
    return true;
  }

  document.addEventListener('keydown', (e) => {
    const ta = e.target;
    if (!on() || !isInput(ta) || e.isComposing || e.ctrlKey || e.metaKey || e.altKey) return;
    if (mentionOpen()) return;
    if (e.key === 'Enter' && e.shiftKey) onShiftEnter(ta, e);
    else if (e.key === 'Tab') onTab(ta, e);
  }, true);
})();
