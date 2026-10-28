// File type badge on Bitrix's generic file icon. Bitrix has typed icons for xls/doc/pdf/…, but
// .md, .txt, .yaml, .log and others get a blank page. Read the extension from the file name next to
// the icon and expose it as data-b48-ext; theme.css draws the badge.
(() => {
  'use strict';
  if (window.__B48_FILES) return;
  window.__B48_FILES = true;

  const NAME = '.bx-im-base-file-item__title-base, [class*="file"][class*="title"], [class*="file"][class*="name"]';
  const EXT = /\.([a-z0-9]{1,5})\s*$/i;

  function extFor(icon) {
    let el = icon.parentElement;
    for (let i = 0; i < 4 && el; i++, el = el.parentElement) {
      // The item container often carries the full name in title (the visible text may be truncated)
      const own = (el.getAttribute('title') || '').match(EXT);
      if (own) return own[1].toLowerCase();
      for (const n of el.querySelectorAll(NAME)) {
        if (n.contains(icon)) continue;
        const m = (n.getAttribute('title') || n.textContent || '').match(EXT);
        if (m) return m[1].toLowerCase();
      }
    }
    return '';
  }

  function mark() {
    for (const icon of document.querySelectorAll('.ui-icon-file-empty:not([data-b48-ext])')) {
      const ext = extFor(icon);
      icon.dataset.b48Ext = ext; // '' = looked, nothing found (no badge, no rescan)
    }
  }

  let pending = false;
  const start = () => {
    new MutationObserver(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; mark(); });
    }).observe(document.body, { childList: true, subtree: true });
    mark();
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
