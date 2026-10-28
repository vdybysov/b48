// Dark theme for Bitrix's .md file preview (Disk viewer). The preview is a sandboxed iframe built
// from `srcdoc` with its own inline CSS, so neither the page styles nor the extension reach inside.
// We add dark styles to the srcdoc string at the moment Bitrix assigns it (property or attribute),
// so the frame loads once, already dark. Rewriting srcdoc after insertion races the first load and
// Chrome can leave the frame blank.
(() => {
  'use strict';
  if (window.__B48_MDPREVIEW) return;
  window.__B48_MDPREVIEW = true;

  const MARK = 'b48-md-dark';
  const DARK_CSS = [
    'html, body { background: #1e1f22 !important; color: #e3e4e6 !important; }',
    'a { color: #5aa0ff !important; }',
    'h1, h2, h3, h4, h5, h6 { color: #f0f1f2 !important; border-color: #3a3b3f !important; }',
    'hr { border-color: #3a3b3f !important; background: #3a3b3f !important; }',
    'pre { background: #17181b !important; border: 1px solid #2e2f33 !important; color: #d7dae0 !important; }',
    'code { color: #e8912d !important; background: rgba(127, 127, 127, .16) !important; }',
    'pre code { color: inherit !important; background: none !important; }',
    'th, td { border-color: #3a3b3f !important; }',
    'th { background: rgba(127, 127, 127, .12) !important; }',
    'tr:nth-child(even) td { background: rgba(127, 127, 127, .05) !important; }',
    'blockquote { border-left-color: #3a3b3f !important; color: #a1a2a7 !important; }',
    '.disk-markdown-diagram svg { filter: invert(.88) hue-rotate(180deg); }',
    '.disk-markdown-diagram--error { background: #3a2222 !important; border-color: #6b3a3c !important; color: #f0c4c4 !important; }',
  ].join('\n');

  const dark = () => document.documentElement.dataset.b48Theme !== '0';
  // Bitrix's markdown document has this class in its inline CSS; nothing else on the portal does
  const isMarkdownDoc = (html) => typeof html === 'string' && html.includes('disk-markdown-diagram');

  function darken(html) {
    if (!dark() || !isMarkdownDoc(html) || html.includes(MARK)) return html;
    const style = `<style id="${MARK}">${DARK_CSS}</style>`;
    return /<\/head>/i.test(html) ? html.replace(/<\/head>/i, style + '</head>') : style + html;
  }

  // iframe.srcdoc = html
  const desc = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'srcdoc');
  if (desc && desc.set) {
    Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', {
      ...desc,
      set(v) { desc.set.call(this, darken(v)); },
    });
  }
  // iframe.setAttribute('srcdoc', html)
  const setAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    if (this instanceof HTMLIFrameElement && String(name).toLowerCase() === 'srcdoc') value = darken(value);
    return setAttr.call(this, name, value);
  };

  // Frames that got their srcdoc before this script ran: patch once their first load is done
  const SEL = 'iframe.disk-viewer-markdown-frame';
  const late = (f) => {
    const doc = f.getAttribute('srcdoc');
    if (!dark() || !isMarkdownDoc(doc) || doc.includes(MARK)) return;
    f.addEventListener('load', () => setAttr.call(f, 'srcdoc', darken(f.getAttribute('srcdoc'))), { once: true });
  };
  const start = () => {
    document.querySelectorAll(SEL).forEach(late);
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
