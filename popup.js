const DEFAULTS = { theme: true, render: true, send: true, quiet: false };
chrome.storage.sync.get(DEFAULTS, (s) => {
  for (const key of Object.keys(DEFAULTS)) {
    const box = document.getElementById(key);
    box.checked = s[key];
    box.addEventListener('change', () => chrome.storage.sync.set({ [key]: box.checked }));
  }
});
