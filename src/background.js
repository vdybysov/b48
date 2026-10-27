// Dev helper: reload the unpacked extension from disk when the portal page asks for it
// (window.postMessage({ type: 'b48:dev-reload' }) on a Bitrix24 page, relayed by bridge.js).
// Store installs have an update_url in the manifest; there this does nothing.
const isUnpacked = !('update_url' in chrome.runtime.getManifest());
chrome.runtime.onMessage.addListener((msg) => {
  if (isUnpacked && msg && msg.type === 'b48:dev-reload') chrome.runtime.reload();
});
