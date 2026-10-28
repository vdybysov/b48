// Dark theme for Bitrix's .md file preview (Disk viewer). The preview is a sandboxed iframe built
// from `srcdoc` with its own inline CSS, so neither the page styles nor the extension reach inside.
// The srcdoc attribute is readable from the page, though: append dark styles to it as soon as the
// iframe appears, before it paints.
(() => {
  'use strict';
  if (window.__B48_MDPREVIEW) return;
  window.__B48_MDPREVIEW = true;

  const MARK = 'b48-md-dark';
  const DARK_CSS = `
    html, body { background: #1e1f22 !important; color: #e3e4e6 !important; color-scheme: dark; }
    a { color: #5aa0ff !important; }
    h1, h2, h3, h4, h5, h6 { color: #f0f1f2 !important; border-color: #3a3b3f !important; }
    hr { border-color: #3a3b3f !important; background: #3a3b3f !important; }
    pre { background: #17181b !important; border: 1px solid #2e2f33 !important; color: #d7dae0 !important; }
    code { color: #e8912d !important; background: rgba(127, 127, 127, .16) !important; }
    pre code { color: inherit !important; background: none !important; }
    th, td { border-color: #3a3b3f !important; }
    th { background: rgba(127, 127, 127, .12) !important; }
    tr:nth-child(even) td { background: rgba(127, 127, 127, .05) !important; }
    blockquote { border-left-color: #3a3b3f !important; color: #a1a2a7 !important; }
    .disk-markdown-diagram svg { filter: invert(.88) hue-rotate(180deg); }
    .disk-markdown-diagram--error { background: #3a2222 !important; border-color: #6b3a3c !important; color: #f0c4c4 !important; }
  `;
  const dark = () => document.documentElement.dataset.b48Theme !== '0';

  function patch(frame) {
    if (!dark()) return;
    const doc = frame.getAttribute('srcdoc');
    if (!doc || doc.includes(MARK)) return;
    const style = `<style id="${MARK}">${DARK_CSS}</style>`;
    frame.setAttribute('srcdoc', /<\/head>/i.test(doc) ? doc.replace(/<\/head>/i, style + '</head>') : style + doc);
  }

  const SEL = 'iframe.disk-viewer-markdown-frame';
  const scan = (root) => {
    if (root.matches && root.matches(SEL)) patch(root);
    root.querySelectorAll && root.querySelectorAll(SEL).forEach(patch);
  };
  const start = () => {
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'attributes') { if (m.target.matches(SEL)) patch(m.target); continue; }
        for (const n of m.addedNodes) if (n.nodeType === 1) scan(n);
      }
    }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['srcdoc'] });
    scan(document.body);
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
})();
