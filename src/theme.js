// Isolated world. Two passes that keep the dark theme working without hand-patching every widget:
// 1. Bitrix ships a full dark token set under `.--ui-context-content-dark` but the messenger never
//    turns it on. Copy those tokens and apply them everywhere.
// 2. Many rules hardcode light colors. Scan the portal's CSS and emit
//    dark twins: light backgrounds get darker, dark text gets lighter, light borders get subtle.
//
// No white flashes: Bitrix lazy-loads CSS per widget, so everything generated is cached in
// localStorage and injected at document_start. A widget seen once already has its dark twins in
// place before its own CSS arrives. New stylesheets are processed the moment they load.
(() => {
  const ATTR = 'data-b48-theme';
  const PFX = `html[${ATTR}="1"]`;
  const CACHE_KEY = 'b48:theme-cache:v4';
  const CACHE_MAX = 8000;

  const style = (id) => {
    let st = document.getElementById(id);
    if (!st) {
      st = document.createElement('style');
      st.id = id;
      (document.head || document.documentElement).appendChild(st);
    }
    return st;
  };
  const ownNode = (n) => n && /^b48-/.test(n.id || '');

  const walkRules = (rules, fn) => {
    for (const r of rules) {
      if (r.cssRules && !r.selectorText) { try { walkRules(r.cssRules, fn); } catch (e) { /* skip */ } continue; }
      fn(r);
    }
  };
  const eachSheetRule = (sheet, fn) => {
    if (!sheet || ownNode(sheet.ownerNode)) return;
    try { walkRules(sheet.cssRules, fn); } catch (e) { /* cross-origin or not loaded yet */ }
  };

  // ---------- color helpers ----------
  const parse = (v) => {
    v = v.trim();
    let m;
    if ((m = v.match(/^#([0-9a-f]{3,8})$/i))) {
      let h = m[1];
      if (h.length <= 4) h = [...h].map((c) => c + c).join('');
      const n = parseInt(h.slice(0, 6), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255, h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1];
    }
    if ((m = v.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i))) {
      const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4];
      return [+m[1], +m[2], +m[3], a];
    }
    if ((m = v.match(/^hsla?\(\s*([\d.]+)(?:deg)?[,\s]+([\d.]+)%[,\s]+([\d.]+)%(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i))) {
      const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4];
      const [h, sat, l] = [+m[1] / 360, +m[2] / 100, +m[3] / 100];
      const f = (n) => { const k = (n + h * 12) % 12, q = sat * Math.min(l, 1 - l); return Math.round(255 * (l - q * Math.max(-1, Math.min(k - 3, 9 - k, 1)))); };
      return [f(0), f(8), f(4), a];
    }
    if (/^white$/i.test(v)) return [255, 255, 255, 1];
    if (/^black$/i.test(v)) return [0, 0, 0, 1];
    return null;
  };
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const toHsl = ([r, g, b]) => {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (mx + mn) / 2;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      h = (mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4) / 6;
    }
    return [h, s, l];
  };
  const fromHsl = (h, s, l, a) => {
    const f = (n) => {
      const k = (n + h * 12) % 12, q = s * Math.min(l, 1 - l);
      return Math.round(255 * (l - q * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return a < 1 ? `rgba(${f(0)}, ${f(8)}, ${f(4)}, ${+a.toFixed(3)})` : `rgb(${f(0)}, ${f(8)}, ${f(4)})`;
  };
  const darkBg = (c) => { const [h, s, l] = toHsl(c); return fromHsl(h, s * 0.45, 0.115 + (1 - l) * 0.5, c[3]); };
  const lightFg = (c) => { const [h, s, l] = toHsl(c); return fromHsl(h, s * 0.5, 0.9 - l * 0.45, c[3]); };

  // ---------- twins ----------
  const WHITE_REF = /^var\(--ui-color-(palette-)?white-base\)$/;
  const WHITE_ANY = /^var\(--(im|ui)-color-(palette-)?white-base\)$/;
  const WHITE_RGBA = /^rgba\(\s*var\(--(?:im|ui)-color-(?:palette-)?white-base-rgb\)\s*,\s*([\d.]+)\s*\)$/;
  const FALLBACK = /^var\((--[\w-]+)\s*,\s*(.+)\)$/;
  // Split a selector list on top-level commas only (":not(.a, .b)" stays intact).
  const splitSelectors = (sel) => {
    const out = [];
    let depth = 0, cur = '';
    for (const ch of sel) {
      if (ch === '(' || ch === '[') depth++;
      else if (ch === ')' || ch === ']') depth--;
      if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out.map((x) => x.trim()).filter(Boolean);
  };
  // ":root …" / "html …" become "html[data-b48-theme="1"] …" (design tokens live on :root)
  const prefixOne = (s) => {
    if (/^:root\b/.test(s)) return PFX + s.slice(5);
    if (/^html\b/i.test(s)) return PFX + s.slice(4);
    return `${PFX} ${s}`;
  };
  const prefix = (sel) => splitSelectors(sel).map(prefixOne).join(', ');

  // Light colors inside gradients (fade-outs over "Развернуть", card backgrounds) -> dark.
  const COLOR_TOKEN = /var\(--[\w-]+\)|#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)|\bwhite\b/gi;
  const WHITE_VAR = /^var\(--[\w-]*white[\w-]*\)$/i;
  function darkenGradient(v) {
    let changed = false;
    const out = v.replace(COLOR_TOKEN, (tok) => {
      // "white-fixed" tokens stay white in Bitrix's dark theme too; here a fade must match our dark bg
      if (WHITE_VAR.test(tok)) { changed = true; return '#1e1f22'; }
      if (tok.startsWith('var(')) return tok;
      const c = parse(tok);
      if (!c || lum(c) <= 190) return tok;
      changed = true;
      return c[3] === 0 ? 'rgba(30, 31, 34, 0)' : darkBg(c);
    });
    return changed ? out : null;
  }

  function twinDecls(r) {
    const decl = [];
    for (const p of r.style) {
      const v = r.style.getPropertyValue(p).trim();
      const imp = r.style.getPropertyPriority(p) ? ' !important' : '';
      const isBgVar = p.startsWith('--') && /background|bg/i.test(p);
      const isFgVar = p.startsWith('--') && !isBgVar && /(^|[_-])(color|text)([_-]|$)/i.test(p) && !/border|shadow|icon|fill/i.test(p);
      const isBg = isBgVar || p === 'background-color';

      if (isBg && WHITE_REF.test(v)) { decl.push(`${p}: #1e1f22${imp}`); continue; }

      // Gradients in background / background-image
      if ((p === 'background-image' || p === 'background' || isBgVar) && /gradient\(/i.test(v)) {
        const g = darkenGradient(v);
        if (g) decl.push(`${p === 'background' ? 'background-image' : p}: ${g}${imp}`);
        continue;
      }
      // "background: #fff" shorthand with a plain color
      if (p === 'background') {
        const c = parse(v);
        if (c && c[3] > 0.25 && lum(c) > 190) decl.push(`background-color: ${darkBg(c)}${imp}`);
        continue;
      }

      // Shorthand borders: "1px solid #edeef0" -> keep width/style, soften a light color.
      if (/^border(-(top|right|bottom|left))?$/.test(p)) {
        const m = v.match(/(#[0-9a-f]{3,8}\b|rgba?\([^)]*\))/i);
        const c = m && parse(m[1]);
        if (c && c[3] > 0.25 && lum(c) > 190) decl.push(`${p}-color: rgba(255, 255, 255, .09)${imp}`);
        continue;
      }

      // White text (on colored or overlay plates) must stay white even though the palette
      // "white" is now dark: var(--…white-base) and rgba(var(--…white-base-rgb), a).
      if (isFgVar || p === 'color') {
        if (WHITE_ANY.test(v)) { decl.push(`${p}: #f0f1f2${imp}`); continue; }
        const wa = v.match(WHITE_RGBA);
        if (wa) { decl.push(`${p}: rgba(240, 241, 242, ${wa[1]})${imp}`); continue; }
      }

      // A var() fallback usually means the referenced var is defined elsewhere, so write the color directly.
      const fb = v.match(FALLBACK);
      const c = parse(fb ? fb[2] : v);
      if (!c || c[3] <= 0.25) continue;

      if (isBg && lum(c) > 190) decl.push(`${p}: ${darkBg(c)}${imp}`);
      else if ((isFgVar || p === 'color') && lum(c) < 120) decl.push(`${p}: ${lightFg(c)}${imp}`);
      else if (/^border(-(top|right|bottom|left))?-color$/.test(p) && lum(c) > 190) decl.push(`${p}: rgba(255, 255, 255, .09)${imp}`);
    }
    return decl;
  }

  // ---------- state + cache ----------
  const twins = new Map(); // rule key -> css text ('' when the rule needs no twin)
  let tokens = null;
  const autoStyle = () => style('b48-auto');

  function loadCache() {
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
      if (!c) return;
      if (c.tokens) tokens = c.tokens;
      for (const [k, v] of c.twins || []) twins.set(k, v);
    } catch (e) { /* storage blocked or corrupt */ }
  }
  let saveTimer = 0;
  function saveCache() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        let entries = [...twins.entries()].filter(([, v]) => v);
        if (entries.length > CACHE_MAX) entries = entries.slice(-CACHE_MAX);
        localStorage.setItem(CACHE_KEY, JSON.stringify({ tokens, twins: entries }));
      } catch (e) { /* quota or blocked */ }
    }, 1500);
  }

  function renderTokens() {
    if (!tokens) return;
    const scope = [PFX, `${PFX} body`, `${PFX} .--ui-context-content-light`, `${PFX} .--ui-context-edge-light`].join(',\n');
    style('b48-dark-tokens').textContent = `${scope} {\n${tokens}\n}`;
  }
  function renderAllTwins() {
    autoStyle().textContent = [...twins.values()].filter(Boolean).join('\n');
  }
  function addTwin(css) {
    const sheet = autoStyle().sheet;
    try { sheet.insertRule(css, sheet.cssRules.length); } catch (e) { autoStyle().appendChild(document.createTextNode('\n' + css)); }
  }

  // Process one stylesheet: grab tokens, add twins for rules not seen before.
  function processSheet(sheet) {
    let added = 0;
    eachSheetRule(sheet, (r) => {
      const sel = r.selectorText;
      if (!sel || !r.style) return;
      if (sel === '.--ui-context-content-dark' && r.style.length > 100) {
        if (tokens !== r.style.cssText) { tokens = r.style.cssText; renderTokens(); added++; }
        return;
      }
      // Whole portal, not just the messenger (tasks, grids, side panels, popups)
      if (/b48-|--ui-context-content-dark|--ui-context-edge-dark/.test(sel)) return;
      const key = sel + '{' + r.style.cssText;
      if (twins.has(key)) return;
      const decl = twinDecls(r);
      const css = decl.length ? `${prefix(sel)} { ${decl.join('; ')} }` : '';
      twins.set(key, css);
      if (css) { addTwin(css); added++; }
    });
    if (added) saveCache();
  }
  const processAll = () => { for (const sh of document.styleSheets) processSheet(sh); };

  function watchNode(n) {
    if (ownNode(n)) return;
    if (n.nodeName === 'STYLE') { processSheet(n.sheet); return; }
    if (n.nodeName === 'LINK' && /stylesheet/i.test(n.rel)) {
      if (n.sheet) { try { if (n.sheet.cssRules.length) processSheet(n.sheet); } catch (e) { /* not ready */ } }
      n.addEventListener('load', () => processSheet(n.sheet), { once: true });
    }
  }

  // ---------- start ----------
  loadCache();
  renderTokens();
  renderAllTwins();

  // Bitrix adds stylesheets to <head>. Watch only that (the body churns constantly under Vue).
  const onMutations = (muts) => {
    for (const m of muts) for (const n of m.addedNodes) {
      if (n.nodeName === 'LINK' || n.nodeName === 'STYLE') watchNode(n);
    }
  };
  const headObs = new MutationObserver(onMutations);
  const watchHead = () => {
    headObs.observe(document.head, { childList: true });
    document.head.querySelectorAll('link[rel~="stylesheet"], style').forEach(watchNode);
  };
  if (document.head) watchHead();
  else {
    // document_start: <head> may not exist yet
    const rootObs = new MutationObserver(() => {
      if (document.head) { rootObs.disconnect(); watchHead(); }
    });
    rootObs.observe(document.documentElement, { childList: true });
  }

  document.addEventListener('DOMContentLoaded', processAll, { once: true });
  window.addEventListener('load', processAll, { once: true });
})();
