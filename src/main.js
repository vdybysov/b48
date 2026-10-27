// Runs in the page (MAIN world): patches the Bitrix24 messenger v2 parser and sending.
// Flags come from bridge.js via <html data-b48-*>; '0' means off.
(() => {
  'use strict';
  if (window.__B48_PATCHED) return;
  window.__B48_PATCHED = true;

  const MD = window.__B48_MD;
  const on = (k) => document.documentElement.dataset[k] !== '0';
  const log = (...a) => console.debug('[b48]', ...a);
  const isTop = window.top === window;

  // Poll for Bitrix objects; give up after a minute (frames without the messenger never get them)
  function waitFor(get, cb, tries = 240) {
    const v = get();
    if (v) return cb(v);
    if (tries > 0) setTimeout(() => waitFor(get, cb, tries - 1), 250);
  }

  function wrap(obj, name, make) {
    const orig = obj && obj[name];
    if (typeof orig !== 'function' || orig.__b48) return;
    const fn = make(orig);
    fn.__b48 = true;
    obj[name] = fn;
  }

  // ---- rendering ----
  waitFor(() => window.BX?.Messenger?.v2?.Lib?.Parser, (P) => {
    const decodeText = P.decodeText.bind(P);

    wrap(P, 'decodeMessage', (orig) => function (message) {
      if (!on('b48Render') || !message || typeof message.text !== 'string') return orig.apply(this, arguments);
      try {
        return MD.render(message.text, (text) => orig.call(this, { ...message, text }), decodeText);
      } catch (e) {
        console.warn('[b48] render failed, falling back', e);
        return orig.apply(this, arguments);
      }
    });

    for (const name of ['purifyRecent', 'purifyMessage', 'purifyNotification']) {
      wrap(P, name, (orig) => function () {
        const out = orig.apply(this, arguments);
        return on('b48Render') ? MD.stripMd(out) : out;
      });
    }

    wrap(P, 'prepareEdit', (orig) => function () {
      const out = orig.apply(this, arguments);
      return on('b48Send') && typeof out === 'string' ? MD.bbToMd(out) : out;
    });

    log('parser patched');
  });

  // ---- sending ----
  const convertParams = (e) => (on('b48Send') && e && typeof e.text === 'string' ? { ...e, text: MD.toBB(e.text) } : e);

  waitFor(() => window.BX?.Messenger?.v2?.Service?.SendingService?.prototype, (proto) => {
    for (const name of ['sendMessage', 'sendMessageWithFiles']) {
      wrap(proto, name, (orig) => function (e, ...rest) { return orig.call(this, convertParams(e), ...rest); });
    }
    log('sending patched');
  });

  // ---- quiet reading: no read receipts until you mark the chat read yourself ----
  // Bitrix reads messages automatically when they scroll into view (readMessage) and when you
  // leave a chat (readChatQueuedMessages). With quiet reading on, both are skipped. The manual
  // "Прочитать" in the chat menu and the ✓ button in the chat header still work (readDialog).
  const quiet = () => document.documentElement.dataset.b48Quiet === '1';
  const READ_METHODS = new Set(['im.v2.Chat.Message.read']);

  waitFor(() => window.BX?.Messenger?.v2?.Service?.ChatService?.prototype, (proto) => {
    for (const name of ['readMessage', 'readChatQueuedMessages']) {
      wrap(proto, name, (orig) => function () {
        if (quiet()) return Promise.resolve();
        return orig.apply(this, arguments);
      });
    }
    log('read receipts patched');
  });

  // Jumping to a message (search, reply) sends a read inside a REST batch. Filter it there too.
  waitFor(() => window.BX?.rest?.callBatch && window.BX.rest, (rest) => {
    const fakeResult = () => ({ data: () => ({}), error: () => null, answer: { result: {} }, time: () => ({}) });
    wrap(rest, 'callMethod', (orig) => function (method) {
      if (quiet() && READ_METHODS.has(method)) { log('read receipt held', method); return Promise.resolve(fakeResult()); }
      return orig.apply(this, arguments);
    });
    wrap(rest, 'callBatch', (orig) => function (calls, ...rest2) {
      if (quiet() && calls && typeof calls === 'object' && !Array.isArray(calls)) {
        const kept = {};
        let dropped = 0;
        for (const [k, v] of Object.entries(calls)) {
          const method = Array.isArray(v) ? v[0] : k;
          if (READ_METHODS.has(method)) dropped++; else kept[k] = v;
        }
        if (dropped) {
          log('read receipt held in batch', dropped);
          if (!Object.keys(kept).length) return Promise.resolve({});
          return orig.call(this, kept, ...rest2);
        }
      }
      return orig.call(this, calls, ...rest2);
    });
  });

  // ✓ button in the chat header: marks the open chat read (sends the receipt).
  function currentDialogId() {
    try { return BX.Messenger.v2.Application.Core.getStore().getters['application/getLayout'].entityId || null; } catch (e) { return null; }
  }
  function addReadButton() {
    const actions = document.querySelector('.bx-im-chat-header__actions');
    const existing = document.querySelector('.b48-read-btn');
    if (!quiet()) { if (existing) existing.remove(); return; }
    if (!actions || (existing && actions.contains(existing))) return;
    // Same look as Bitrix's own header buttons, with its own icon set
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'bx-im-chat-header-action --shape-circle bx-im-chat-header__icon --ds-icon b48-read-btn';
    btn.title = 'Отметить чат прочитанным (B48: тихое чтение)';
    const icon = document.createElement('div');
    icon.className = 'ui-icon-set --o-double-check';
    icon.style.setProperty('--ui-icon-set__icon-size', '24px');
    btn.appendChild(icon);
    btn.addEventListener('click', () => {
      const dialogId = currentDialogId();
      if (!dialogId) return;
      new BX.Messenger.v2.Service.ChatService().readDialog(dialogId);
      btn.classList.add('--done');
      icon.className = 'ui-icon-set --s-double-check';
      setTimeout(() => { btn.classList.remove('--done'); icon.className = 'ui-icon-set --o-double-check'; }, 1200);
    });
    actions.prepend(btn);
  }
  waitFor(() => document.body, () => {
    let pending = false;
    new MutationObserver(() => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; addReadButton(); });
    }).observe(document.body, { childList: true, subtree: true });
    new MutationObserver(addReadButton).observe(document.documentElement, { attributes: true, attributeFilter: ['data-b48-quiet'] });
  });

  // ---- left portal menu: collapsed by default ----
  // Collapse once per page load if it is expanded; expanding it by hand still works until reload.
  if (isTop) waitFor(() => window.BX?.Intranet?.LeftMenu?.isCollapsed && window.BX.Intranet.LeftMenu, (menu) => {
    if (document.documentElement.dataset.b48Theme === '0') return;
    try { if (!menu.isCollapsed()) menu.toggle(); } catch (e) { console.warn('[b48] menu collapse failed', e); }
  });

  // ---- installed-app window (Chrome "Install page as app") ----
  // Dark window title bar, a manifest that opens straight into the messenger, and an unread
  // badge on the Dock / taskbar icon like Slack. In a normal tab these are harmless no-ops.
  // Top window only: side panels and other frames are not the app.
  // Chrome fires beforeinstallprompt once the page is installable; kept for an "Install" action later.
  if (isTop) window.addEventListener('beforeinstallprompt', (e) => { window.__B48_INSTALL = e; log('installable'); });

  function setupAppWindow() {
    const head = document.head;
    const dark = document.documentElement.dataset.b48Theme !== '0';
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) { meta = document.createElement('meta'); meta.name = 'theme-color'; head.appendChild(meta); }
    meta.content = dark ? '#141517' : '#ffffff';

    buildManifest();
  }

  // Our manifest (blob URL, same origin as the page). Icon: the Bitrix24 desktop app icon shipped
  // with the extension (embedded as data URLs); the site's favicon if that is unavailable.
  let manifestLink = null;
  let manifestKey = '';
  const toDataUrl = async (url) => {
    const blob = await (await fetch(url)).blob();
    return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
  };
  async function buildManifest() {
    const ds = document.documentElement.dataset;
    const dark = ds.b48Theme !== '0';
    const useOwn = !!ds.b48Base;
    const key = (dark ? 'd' : 'l') + (useOwn ? 'o' : 'b');
    if (key === manifestKey) return;
    const existing = document.querySelector('link[rel="manifest"]');
    if (existing && existing !== manifestLink) return; // the portal has its own manifest: leave it
    manifestKey = key;

    let icons;
    if (useOwn) {
      try {
        icons = [
          // dark variant goes with the dark theme
          { src: await toDataUrl(ds.b48Base + `icons/icon-${dark ? 'dark-' : ''}192.png`), sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: await toDataUrl(ds.b48Base + `icons/icon-${dark ? 'dark-' : ''}512.png`), sizes: '512x512', type: 'image/png', purpose: 'any' },
        ];
      } catch (e) { console.warn('[b48] own icon unavailable', e); }
    }
    if (!icons) {
      const abs = (sel, fallback) => document.querySelector(sel)?.href || location.origin + fallback;
      icons = [
        { src: abs('link[rel="apple-touch-icon"]', '/bitrix/templates/bitrix24/src/images/favicons/apple-touch-icon.png'), sizes: '180x180', type: 'image/png', purpose: 'any' },
        { src: abs('link[rel~="icon"][href$=".svg"]', '/bitrix/templates/bitrix24/src/images/favicons/favicon.svg'), sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      ];
    }
    const manifest = {
      name: 'Битрикс24',
      short_name: 'Битрикс24',
      start_url: location.origin + '/online/',
      scope: location.origin + '/',
      display: 'standalone',
      background_color: dark ? '#141517' : '#ffffff',
      theme_color: dark ? '#141517' : '#ffffff',
      icons,
    };
    const url = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: 'application/manifest+json' }));
    if (!manifestLink) {
      manifestLink = document.createElement('link');
      manifestLink.rel = 'manifest';
      document.head.appendChild(manifestLink);
    } else if (manifestLink.href.startsWith('blob:')) {
      URL.revokeObjectURL(manifestLink.href);
    }
    manifestLink.href = url;
  }
  if (isTop) waitFor(() => document.head, setupAppWindow);
  if (isTop) new MutationObserver(() => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = document.documentElement.dataset.b48Theme !== '0' ? '#141517' : '#ffffff';
    if (document.head) buildManifest();
  }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-b48-theme', 'data-b48-base'] });

  // Unread badge: unmuted chats, same rule as Bitrix's own counters (comment threads excluded)
  if (isTop && typeof navigator.setAppBadge === 'function') {
    waitFor(() => window.BX?.Messenger?.v2?.Application?.Core?.getStore?.(), (st) => {
      let last = -1, timer = 0;
      const update = () => {
        let total = 0;
        for (const c of Object.values(st.state.counters?.collection || {})) {
          if (!c || c.isMuted || c.parentChatId) continue;
          total += (c.counter || 0) || (c.isMarkedAsUnread ? 1 : 0);
        }
        if (total === last) return;
        last = total;
        (total ? navigator.setAppBadge(total) : navigator.clearAppBadge()).catch(() => { /* not an installed app */ });
      };
      st.subscribe((m) => {
        if (!/^(counters|chats|recent)\//.test(m.type)) return;
        clearTimeout(timer);
        timer = setTimeout(update, 400);
      });
      update();
      log('app badge ready');
    });
  }

  // ---- pasting formatted text ----
  // Clipboard HTML (Claude, Cursor, VS Code, browsers, Docs) becomes Markdown in the input,
  // which then goes out as BBCode like anything typed.
  document.addEventListener('paste', (e) => {
    const ta = e.target;
    if (!on('b48Send') || !ta || ta.nodeName !== 'TEXTAREA' || !ta.closest('.bx-im-messenger__scope, [class*="bx-im-textarea"]')) return;
    const dt = e.clipboardData;
    if (!dt || [...dt.items].some((it) => it.kind === 'file')) return; // files and images: leave to Bitrix
    const html = dt.getData('text/html');
    if (!html) return;
    const plain = dt.getData('text/plain');
    let md;
    try { md = window.__B48_PASTE.htmlToMd(html); } catch (err) { console.warn('[b48] paste convert failed', err); return; }
    if (!md || !window.__B48_PASTE.hasFormatting(md, plain)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    ta.focus();
    // insertText keeps the native undo stack and fires `input`, so Vue's model stays in sync.
    if (!document.execCommand('insertText', false, md)) {
      const { selectionStart: a, selectionEnd: b, value } = ta;
      ta.value = value.slice(0, a) + md + value.slice(b);
      ta.selectionStart = ta.selectionEnd = a + md.length;
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }, true);

  waitFor(() => window.BX?.Messenger?.v2?.Service?.MessageService?.prototype, (proto) => {
    wrap(proto, 'editMessageText', (orig) => function (id, text, ...rest) {
      const t = on('b48Send') && typeof text === 'string' ? MD.toBB(text) : text;
      return orig.call(this, id, t, ...rest);
    });
    log('editing patched');
  });
})();
