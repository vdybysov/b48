// Isolated world: mirrors extension settings onto <html data-b48-*> for the page script and CSS.
(() => {
  const DEFAULTS = { theme: true, render: true, send: true, quiet: false };
  const root = document.documentElement;
  const apply = (s) => {
    root.dataset.b48Theme = s.theme ? '1' : '0';
    root.dataset.b48Render = s.render ? '1' : '0';
    root.dataset.b48Send = s.send ? '1' : '0';
    root.dataset.b48Quiet = s.quiet ? '1' : '0';
  };
  // Where the page script can fetch the extension's own icons from
  root.dataset.b48Base = chrome.runtime.getURL('');
  apply(DEFAULTS);
  chrome.storage.sync.get(DEFAULTS, apply);
  chrome.storage.onChanged.addListener(() => chrome.storage.sync.get(DEFAULTS, apply));
})();

// Dev helper: window.postMessage({ type: 'b48:dev-reload' }) reloads the extension from disk.
window.addEventListener('message', (e) => {
  if (e.source === window && e.data && e.data.type === 'b48:dev-reload') {
    chrome.runtime.sendMessage({ type: 'b48:dev-reload' });
  }
});
