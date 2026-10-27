// "Save for later", like Slack: bookmark messages and come back to them from one list.
// Stored only in this browser (localStorage of the portal). No reminders.
// Ways to save: "Отложить на потом" in the message menu, the bookmark button on hover,
// or the L key while hovering a message. The list opens from "Потом" in the messenger's left panel.
(() => {
  'use strict';
  if (window.__B48_LATER) return;

  const KEY = 'b48:later:v1';
  const log = (...a) => console.debug('[b48]', ...a);
  const core = () => window.BX?.Messenger?.v2?.Application?.Core;
  const store = () => core()?.getStore();

  // ---------- storage ----------
  let items = [];
  const load = () => {
    try { items = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch (e) { items = []; }
    if (!Array.isArray(items)) items = [];
  };
  const save = () => {
    try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) { /* quota */ }
    refresh();
  };
  const has = (id) => items.some((it) => it.id === +id);

  function snapshot(messageId) {
    const st = store();
    const m = st && st.getters['messages/getById'](+messageId);
    if (!m) return null;
    const chat = st.getters['chats/getByChatId'](m.chatId) || {};
    const user = st.getters['users/get'](m.authorId) || {};
    let text = '';
    try { text = BX.Messenger.v2.Lib.Parser.purifyMessage(m); } catch (e) { text = m.text || ''; }
    text = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 300);
    return {
      id: +m.id,
      chatId: m.chatId,
      dialogId: chat.dialogId || '',
      // The chat with yourself is named after you; Bitrix shows it as "Заметки"
      chatName: String(chat.dialogId) === String(core()?.getUserId?.()) ? 'Заметки' : (chat.name || ''),
      authorName: user.name || '',
      text,
      date: m.date ? new Date(m.date).toISOString() : null,
      savedAt: new Date().toISOString(),
    };
  }

  function add(messageId) {
    if (has(messageId)) return true;
    const snap = snapshot(messageId);
    if (!snap) return false;
    items.unshift(snap);
    save();
    toast('Отложено на потом');
    return true;
  }
  function remove(messageId) {
    items = items.filter((it) => it.id !== +messageId);
    save();
  }
  function toggle(messageId) {
    if (has(messageId)) { remove(messageId); toast('Убрано из «Потом»'); } else add(messageId);
  }

  function open(it) {
    closePanel();
    try { BX.Messenger.Public.openChat(it.dialogId, it.id); } catch (e) { console.warn('[b48] open failed', e); }
  }

  // ---------- small DOM helpers (text only, never innerHTML with message data) ----------
  const el = (tag, cls, text) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  };
  // Bitrix's own icon set (ui-icon-set), so everything matches the native UI
  const icon = (name, size) => {
    const i = el('div', 'ui-icon-set ' + name);
    if (size) i.style.setProperty('--ui-icon-set__icon-size', size + 'px');
    return i;
  };
  const fmt = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    return sameDay
      ? d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
      : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  };

  let toastTimer = 0;
  function toast(text) {
    let t = document.querySelector('.b48-toast');
    if (!t) { t = el('div', 'b48-toast'); document.body.appendChild(t); }
    t.textContent = text;
    t.classList.add('--show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('--show'), 1600);
  }

  // ---------- panel ----------
  let panel = null;
  function closePanel() {
    if (panel) { panel.remove(); panel = null; }
    document.querySelector('.b48-later-nav')?.classList.remove('--b48-active');
  }
  function renderPanel() {
    if (!panel) return;
    const list = panel.querySelector('.b48-later-list');
    list.textContent = '';
    panel.querySelector('.b48-later-title').textContent = items.length ? `Потом · ${items.length}` : 'Потом';
    if (!items.length) {
      list.appendChild(el('div', 'b48-later-empty', 'Здесь пусто. Отложите сообщение через меню сообщения, кнопку-закладку при наведении или клавишу L.'));
      return;
    }
    for (const it of items) {
      const row = el('div', 'b48-later-item');
      const head = el('div', 'b48-later-head');
      head.appendChild(el('span', 'b48-later-chat', it.chatName || it.dialogId));
      head.appendChild(el('span', 'b48-later-date', fmt(it.date)));
      row.appendChild(head);
      if (it.authorName) row.appendChild(el('div', 'b48-later-author', it.authorName));
      row.appendChild(el('div', 'b48-later-text', it.text || '(без текста)'));
      const done = el('button', 'b48-later-done');
      done.appendChild(icon('--o-circle-check', 22));
      done.type = 'button';
      done.title = 'Готово — убрать из списка';
      done.addEventListener('click', (e) => { e.stopPropagation(); remove(it.id); });
      row.appendChild(done);
      row.addEventListener('click', () => open(it));
      list.appendChild(row);
    }
  }
  function togglePanel(anchor) {
    if (panel) { closePanel(); return; }
    panel = el('div', 'b48-later-panel');
    const header = el('div', 'b48-later-header');
    header.appendChild(el('div', 'b48-later-title', 'Потом'));
    const x = el('button', 'b48-later-close');
    x.appendChild(icon('--cross-m', 20));
    x.type = 'button';
    x.addEventListener('click', closePanel);
    header.appendChild(x);
    panel.appendChild(header);
    panel.appendChild(el('div', 'b48-later-list'));
    document.body.appendChild(panel);
    anchor?.classList.add('--b48-active');
    const r = anchor ? anchor.getBoundingClientRect() : { right: 80, bottom: innerHeight - 20 };
    panel.style.left = Math.round(r.right + 8) + 'px';
    panel.style.top = Math.max(12, Math.min(Math.round(r.top), innerHeight - 420)) + 'px';
    renderPanel();
  }
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePanel(); });
  document.addEventListener('mousedown', (e) => {
    if (panel && !panel.contains(e.target) && !e.target.closest('.b48-later-nav')) closePanel();
  });

  // ---------- extra folders right after "Все": Личные, Чаты, Потом ----------
  // Built from Bitrix's own folder-item classes so they look like native folders.
  // "Личные" / "Чаты" filter the "Все" list: personal dialogs have numeric ids, group chats "chatNNN".
  const FOLDERS = [
    { key: 'people', title: 'Личные', icon: '--s-person', label: 'Личные сообщения' },
    { key: 'chats', title: 'Чаты', icon: '--s-chats', label: 'Групповые чаты' },
  ];
  let folder = '';
  try { folder = sessionStorage.getItem('b48:folder') || ''; } catch (e) { /* blocked */ }
  let switching = false;

  function folderButton(cls, iconName, title, aria) {
    const btn = el('button', 'bx-im-messenger-folder-panel__item --focus-visible b48-folder ' + cls);
    btn.type = 'button';
    btn.title = aria;
    btn.setAttribute('aria-label', aria);
    btn.appendChild(icon(iconName + ' bx-im-messenger-folder-panel-item__glyph'));
    const counter = el('div', 'bx-im-messenger-folder-panel-item__counter');
    const c = el('div', 'ui-counter ui-counter__scope --air ui-counter-md ui-counter-primary --style-filled --one-digit');
    const inner = el('div', 'ui-counter-inner');
    inner.appendChild(el('span', 'ui-counter__value', ''));
    c.appendChild(inner);
    counter.appendChild(c);
    counter.style.display = 'none';
    btn.appendChild(counter);
    btn.appendChild(el('div', 'bx-im-messenger-folder-panel-item__title --ellipsis', title));
    return btn;
  }
  // muted = true draws the counter gray, like Bitrix does for muted chats
  function setCount(btn, n, muted = false) {
    if (!btn) return;
    const box = btn.querySelector('.bx-im-messenger-folder-panel-item__counter');
    box.style.display = n ? '' : 'none';
    btn.querySelector('.ui-counter__value').textContent = n > 99 ? '99+' : String(n);
    const c = btn.querySelector('.ui-counter');
    c.classList.toggle('--one-digit', n < 10);
    c.classList.toggle('b48-muted-count', muted);
  }

  function ensureNav() {
    const list = document.querySelector('.bx-im-messenger-folder-panel__items');
    if (!list) return;
    const all = list.querySelector('.bx-im-messenger-folder-panel__item[data-folder-code="all"]')
      || list.querySelector('.bx-im-messenger-folder-panel__item:not(.b48-folder)');
    if (!all) return;
    const want = [];
    for (const f of FOLDERS) {
      let btn = list.querySelector(`.b48-folder[data-b48-folder="${f.key}"]`);
      if (!btn) {
        btn = folderButton('b48-filter-nav', f.icon, f.title, f.label);
        btn.dataset.b48Folder = f.key;
        btn.addEventListener('click', () => setFolder(folder === f.key ? '' : f.key));
      }
      want.push(btn);
    }
    let later = list.querySelector('.b48-later-nav');
    if (!later) {
      later = folderButton('b48-later-nav', '--s-bookmark', 'Потом', 'Потом, отложенные сообщения');
      later.querySelector('.ui-counter').classList.add('b48-later-count');
      later.addEventListener('click', () => togglePanel(later));
    }
    want.push(later);
    // Keep the order: Все, Личные, Чаты, Потом
    let prev = all;
    for (const btn of want) {
      if (prev.nextElementSibling !== btn) prev.after(btn);
      prev = btn;
    }
    refreshNav();
    refreshFolderCounts();
    applyFolder();
    watchSelection(list);
  }
  function refreshNav() { setCount(document.querySelector('.b48-later-nav'), items.length); }

  // ---------- folder filter ----------
  function setFolder(key) {
    folder = key;
    try { sessionStorage.setItem('b48:folder', key); } catch (e) { /* blocked */ }
    if (key) {
      const all = document.querySelector('.bx-im-messenger-folder-panel__item[data-folder-code="all"]');
      if (all && !all.classList.contains('--selected')) { switching = true; all.click(); switching = false; }
      document.querySelector('.bx-im-list-base__scroll-container, .bx-im-list-container-folder-all__elements')?.scrollTo?.(0, 0);
    }
    applyFolder();
  }
  function applyFolder() {
    const root = document.documentElement;
    if (folder) root.dataset.b48Folder = folder; else delete root.dataset.b48Folder;
    document.querySelectorAll('.b48-filter-nav').forEach((b) => b.classList.toggle('--b48-selected', b.dataset.b48Folder === folder));
    captureFolderColors();
    const list = document.querySelector('.bx-im-messenger-folder-panel__items');
    if (list) fixSelection(list);
  }
  // Any native folder click leaves our filter
  document.addEventListener('click', (e) => {
    const it = e.target.closest && e.target.closest('.bx-im-messenger-folder-panel__item');
    if (it && !it.classList.contains('b48-folder') && !switching && folder) setFolder('');
  }, true);

  // Our "selected" look copies the native one; "Все" is shown unselected while a filter is on.
  let colorsCaptured = false;
  function captureFolderColors() {
    if (colorsCaptured) return;
    const sel = document.querySelector('.bx-im-messenger-folder-panel__selection');
    const selected = document.querySelector('.bx-im-messenger-folder-panel__item.--selected:not(.b48-folder)');
    const plain = document.querySelector('.bx-im-messenger-folder-panel__item:not(.--selected):not(.b48-folder)');
    if (!sel || !selected || !plain) return;
    const r = document.documentElement.style;
    const g = (e) => e.querySelector('.bx-im-messenger-folder-panel-item__glyph');
    const t = (e) => e.querySelector('.bx-im-messenger-folder-panel-item__title');
    r.setProperty('--b48-sel-bg', getComputedStyle(sel).backgroundColor);
    r.setProperty('--b48-sel-radius', getComputedStyle(sel).borderRadius);
    r.setProperty('--b48-sel-icon', getComputedStyle(g(selected)).getPropertyValue('--ui-icon-set__icon-color'));
    r.setProperty('--b48-sel-title', getComputedStyle(t(selected)).color);
    r.setProperty('--b48-unsel-icon', getComputedStyle(g(plain)).getPropertyValue('--ui-icon-set__icon-color'));
    r.setProperty('--b48-unsel-title', getComputedStyle(t(plain)).color);
    colorsCaptured = true;
  }

  // Unread counts per folder (muted chats excluded, like native counters)
  function refreshFolderCounts() {
    const st = store();
    if (!st) return;
    // Unmuted unread -> blue counter; only muted unread -> gray counter
    const sum = { people: [0, 0], chats: [0, 0] };
    for (const c of Object.values(st.state.counters?.collection || {})) {
      if (!c || c.parentChatId) continue; // comment threads are counted on their parent
      const n = (c.counter || 0) || (c.isMarkedAsUnread ? 1 : 0);
      if (!n) continue;
      const chat = st.getters['chats/getByChatId'](c.chatId);
      const id = chat && String(chat.dialogId || '');
      if (!id) continue;
      sum[/^\d+$/.test(id) ? 'people' : 'chats'][c.isMuted ? 1 : 0] += n;
    }
    for (const key of ['people', 'chats']) {
      const [loud, quiet] = sum[key];
      const btn = document.querySelector(`.b48-folder[data-b48-folder="${key}"]`);
      if (loud) setCount(btn, loud); else setCount(btn, quiet, true);
    }
  }
  let countTimer = 0;
  const watchCounters = () => {
    const st = store();
    if (!st || watchCounters.done) return;
    watchCounters.done = true;
    st.subscribe((m) => {
      if (!/^(counters|chats|recent)\//.test(m.type)) return;
      clearTimeout(countTimer);
      countTimer = setTimeout(refreshFolderCounts, 300);
    });
  };

  // Bitrix draws the selected-folder highlight at slot * row height. Our items take rows after
  // "Все", so shift the highlight down for every folder below them; hide it while our filter is on.
  let selObs = null;
  function fixSelection(list) {
    const sel = list.querySelector('.bx-im-messenger-folder-panel__selection');
    const ours = [...list.querySelectorAll('.b48-folder')];
    if (!sel || !ours.length) return;
    const slot = parseInt(sel.style.getPropertyValue('--im-folder-panel__slot'), 10) || 0;
    const last = ours[ours.length - 1];
    const next = last.nextElementSibling;
    const step = next ? (next.offsetTop - ours[0].offsetTop) / ours.length : ours[0].offsetHeight;
    sel.style.translate = slot >= 1 ? `0 ${Math.round(step * ours.length)}px` : '';
    sel.style.opacity = folder ? '0' : '';
  }
  function watchSelection(list) {
    const sel = list.querySelector('.bx-im-messenger-folder-panel__selection');
    if (!sel || (selObs && selObs.__target === sel)) { if (sel) fixSelection(list); return; }
    if (selObs) selObs.disconnect();
    selObs = new MutationObserver(() => fixSelection(list));
    selObs.__target = sel;
    selObs.observe(sel, { attributes: true, attributeFilter: ['style'] });
    fixSelection(list);
  }

  // ---------- mark saved messages + hover button ----------
  const saved = () => new Set(items.map((it) => it.id));
  function markSaved() {
    const ids = saved();
    document.querySelectorAll('.bx-im-message-base__wrap[data-id]').forEach((w) => {
      w.classList.toggle('b48-saved', ids.has(+w.dataset.id));
    });
  }

  let hovered = null;
  const hoverBtn = el('button', 'b48-later-hover');
  const hoverIcon = icon('--o-bookmark', 18);
  hoverBtn.appendChild(hoverIcon);
  hoverBtn.type = 'button';
  hoverBtn.addEventListener('mousedown', (e) => e.preventDefault());
  hoverBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (hovered) { toggle(hovered.dataset.id); placeHover(hovered); }
  });
  function placeHover(w) {
    if (!w || !w.isConnected) { hoverBtn.style.display = 'none'; return; }
    const body = w.querySelector('.bx-im-message-base__body') || w;
    const r = body.getBoundingClientRect();
    if (!document.body.contains(hoverBtn)) document.body.appendChild(hoverBtn);
    hoverBtn.style.display = 'flex';
    hoverBtn.style.top = Math.round(r.top - 10) + 'px';
    // Left of Bitrix's own "⋯" menu button, which sits on the bubble's top-right corner
    hoverBtn.style.left = Math.round(r.right - 52) + 'px';
    const on = has(w.dataset.id);
    hoverBtn.classList.toggle('--on', on);
    hoverIcon.className = 'ui-icon-set ' + (on ? '--s-bookmark' : '--o-bookmark');
    hoverBtn.title = on ? 'Убрать из «Потом» (L)' : 'Отложить на потом (L)';
  }
  document.addEventListener('mouseover', (e) => {
    if (hoverBtn.contains(e.target)) return; // the icon inside the button counts as the button
    const w = e.target.closest && e.target.closest('.bx-im-message-base__wrap[data-id]');
    if (w && +w.dataset.id > 0) { hovered = w; placeHover(w); }
    else if (!e.target.closest || !e.target.closest('.bx-im-message-list__container, .bx-im-dialog-chat__scroll-container')) {
      hovered = null; hoverBtn.style.display = 'none';
    }
  }, true);
  document.addEventListener('scroll', () => { if (hovered) placeHover(hovered); }, true);

  // L (or Д on the Russian layout) while hovering a message
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    if (e.code !== 'KeyL') return;
    const a = document.activeElement;
    if (a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.nodeName))) return;
    if (!hovered || !hovered.isConnected) return;
    e.preventDefault();
    toggle(hovered.dataset.id);
    placeHover(hovered);
  });

  // ---------- message context menu ----------
  function patchMenu() {
    const MM = window.BX?.Messenger?.v2?.Lib?.MessageMenu;
    if (!MM || MM.prototype.getAdditionalItems.__b48) return !!MM;
    const orig = MM.prototype.getAdditionalItems;
    MM.prototype.getAdditionalItems = function () {
      const base = orig.apply(this, arguments) || [];
      const ctx = this.context;
      if (!ctx || !(+ctx.id > 0)) return base;
      const on = has(ctx.id);
      return [...base, {
        title: on ? 'Убрать из «Потом»' : 'Отложить на потом',
        onClick: () => { toggle(ctx.id); try { this.close(); } catch (e) { /* already closed */ } },
      }];
    };
    MM.prototype.getAdditionalItems.__b48 = true;
    log('message menu patched');
    return true;
  }

  // ---------- wiring ----------
  function refresh() { refreshNav(); markSaved(); renderPanel(); }
  load();
  window.addEventListener('storage', (e) => { if (e.key === KEY) { load(); refresh(); } });
  let pending = false;
  const tick = () => { pending = false; ensureNav(); markSaved(); watchCounters(); };
  const start = () => {
    new MutationObserver(() => { if (!pending) { pending = true; requestAnimationFrame(tick); } })
      .observe(document.body, { childList: true, subtree: true });
    tick();
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start, { once: true });
  const menuTimer = setInterval(() => { if (patchMenu()) clearInterval(menuTimer); }, 500);

  window.__B48_LATER = { list: () => items.slice(), add, remove, toggle };
})();
