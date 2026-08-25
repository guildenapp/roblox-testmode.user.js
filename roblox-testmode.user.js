
// ==UserScript==
// @name         Roblox TEST MODE — faux solde + achats simulés
// @namespace    perso-test
// @version      0.5
// @downloadURL  https://raw.githubusercontent.com/guildenapp/roblox-testmode.user.js/main/roblox-testmode.user.js
// @updateURL    https://raw.githubusercontent.com/guildenapp/roblox-testmode.user.js/main/roblox-testmode.user.js
// @description  Bac à sable local : affiche un solde fictif, simule les achats catalogue et ajoute un panneau de réglage aux couleurs de Roblox dans les paramètres. Rien n'est envoyé à Roblox.
// @match        https://*.roblox.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // Le chargeur peut exécuter ce code alors qu'il est déjà installé en direct :
  // sans ce garde, fetch et XHR seraient interceptés deux fois.
  if (window.__rbxTestModeLoaded) return;
  window.__rbxTestModeLoaded = true;

  // ---------- CONFIG ----------
  const FAKE_BALANCE = 2000000;   // solde par défaut au premier lancement
  const STORAGE_KEY = 'rbx_testmode_state';
  // ----------------------------

  const DEFAULTS = { balance: FAKE_BALANCE, owned: [], enabled: true };

  const state = load();

  function load() {
    try {
      return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(STORAGE_KEY)) || {});
    } catch {
      return Object.assign({}, DEFAULTS);
    }
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* quota */ }
  }

  const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');

  // ---------- 1. BANDEAU TEST MODE ----------
  // Volontairement impossible à masquer sans éditer ce fichier.
  const BANNER_ID = 'rbx-testmode-banner';
  const PANEL_ID = 'rbx-testmode-panel';

  // Hexagone évidé : la même forme que l'icône Robux du site.
  const ROBUX_ICON =
    '<svg class="rbx-tm-icon" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path fill="currentColor" fill-rule="evenodd" d="M12 1.5 21.09 6.75v10.5L12 22.5 2.91 17.25V6.75L12 1.5Z' +
    'M12 7 7.67 9.5v5L12 17l4.33-2.5v-5L12 7Z"/></svg>';

  // Roblox marque son thème sur <body> ; on s'y aligne au lieu de suivre l'OS,
  // sinon le panneau s'affiche en sombre sur un site resté en clair.
  function currentTheme() {
    const cls = document.body ? document.body.className : '';
    if (/\bdark-theme\b/.test(cls)) return 'dark';
    if (/\blight-theme\b/.test(cls)) return 'light';
    return (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }

  function syncTheme() {
    if (!panelEl || !panelEl.isConnected) return;
    const t = currentTheme();
    // On n'écrit que si ça change : sinon le MutationObserver se rappellerait lui-même.
    if (panelEl.dataset.rbxTheme !== t) panelEl.dataset.rbxTheme = t;
  }
  const BAR_H = 34;

  function injectStyle() {
    if (document.getElementById('rbx-testmode-style')) return;
    const s = document.createElement('style');
    s.id = 'rbx-testmode-style';
    s.textContent = `
      /* ----- Bandeau permanent, en bas de l'écran ----- */
      #${BANNER_ID} {
        position: fixed; bottom: 0; left: 0; right: 0; height: ${BAR_H}px;
        z-index: 2147483647;
        background: repeating-linear-gradient(45deg, #b3261e 0 12px, #8c1d16 12px 24px);
        color: #fff; font: 700 13px/${BAR_H}px system-ui, sans-serif;
        letter-spacing: .12em; text-align: center; text-transform: uppercase;
        pointer-events: none; user-select: none;
      }
      html { padding-bottom: ${BAR_H}px !important; }

      /* ----- Panneau : jetons repris du design system Roblox ----- */
      #${PANEL_ID} {
        --rbx-card: #ffffff;
        --rbx-text: #1b1d1f;
        --rbx-muted: #6b6d6f;
        --rbx-border: #e3e5e6;
        --rbx-divider: #ececed;
        --rbx-subtle: #f2f4f5;
        --rbx-blue: #335fff;
        --rbx-blue-dark: #2b51d9;
        --rbx-red: #b3261e;

        background: var(--rbx-card);
        border: 1px solid var(--rbx-border);
        border-radius: 12px;
        padding: 20px 24px;
        margin: 0 0 24px;
        color: var(--rbx-text);
        /* On hérite de la police de Roblox (Builder Sans) : rien à déclarer. */
        font-size: 15px; line-height: 1.4;
        box-sizing: border-box;
      }
      #${PANEL_ID}[data-rbx-theme="dark"] {
        --rbx-card: #2f3133;
        --rbx-text: #ffffff;
        --rbx-muted: #bdbebe;
        --rbx-border: #393b3d;
        --rbx-divider: #393b3d;
        --rbx-subtle: #393b3d;
      }
      #${PANEL_ID}.rbx-panel-floating {
        position: fixed; top: 12px; right: 12px; width: 360px;
        max-height: calc(100vh - ${BAR_H + 24}px); overflow: auto;
        z-index: 2147483646; box-shadow: 0 8px 30px rgba(0,0,0,.24);
      }
      #${PANEL_ID} * { box-sizing: border-box; font-family: inherit; }

      #${PANEL_ID} .rbx-tm-head { display: flex; align-items: center; gap: 10px; }
      #${PANEL_ID} .rbx-tm-head h2 {
        margin: 0; padding: 0; border: 0;
        font-size: 20px; font-weight: 700; color: inherit;
      }
      #${PANEL_ID} .rbx-tm-badge {
        background: var(--rbx-red); color: #fff;
        font-size: 10px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase;
        padding: 4px 8px; border-radius: 6px;
      }
      #${PANEL_ID} .rbx-tm-close {
        margin-left: auto; background: none; border: 0; cursor: pointer;
        color: var(--rbx-muted); font-size: 22px; line-height: 1; padding: 0 4px;
      }
      #${PANEL_ID} .rbx-tm-sub { color: var(--rbx-muted); font-size: 13px; margin: 4px 0 8px; }

      #${PANEL_ID} .rbx-tm-row {
        display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
        padding: 16px 0; border-top: 1px solid var(--rbx-divider);
      }
      #${PANEL_ID} .rbx-tm-row.rbx-tm-block { display: block; }
      #${PANEL_ID} .rbx-tm-rowhead { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
      #${PANEL_ID} .rbx-tm-label { font-weight: 600; }
      #${PANEL_ID} .rbx-tm-right { margin-left: auto; display: flex; align-items: center; gap: 8px; }
      #${PANEL_ID} .rbx-tm-grow { flex: 1 1 240px; display: flex; gap: 10px; }
      #${PANEL_ID} .rbx-tm-amount { font-weight: 700; font-size: 18px; gap: 6px; }
      #${PANEL_ID} .rbx-tm-icon { width: 16px; height: 16px; flex: none; }
      #${PANEL_ID} .rbx-tm-chips { flex-wrap: wrap; }

      #${PANEL_ID} .rbx-tm-input {
        flex: 1; min-width: 0; font-size: 16px;
        padding: 10px 14px; border-radius: 8px;
        border: 1px solid var(--rbx-border);
        background: var(--rbx-card); color: var(--rbx-text);
      }
      #${PANEL_ID} .rbx-tm-input:focus {
        outline: 2px solid var(--rbx-blue); outline-offset: -1px; border-color: transparent;
      }

      #${PANEL_ID} .rbx-tm-btn {
        font-size: 14px; font-weight: 600; cursor: pointer; white-space: nowrap;
        padding: 10px 18px; border-radius: 8px; border: 0;
        background: var(--rbx-subtle); color: var(--rbx-text);
      }
      #${PANEL_ID} .rbx-tm-btn:hover { filter: brightness(.96); }
      #${PANEL_ID} .rbx-tm-btn.rbx-tm-primary { background: var(--rbx-blue); color: #fff; }
      #${PANEL_ID} .rbx-tm-btn.rbx-tm-primary:hover { background: var(--rbx-blue-dark); filter: none; }
      #${PANEL_ID} .rbx-tm-chips .rbx-tm-btn { padding: 8px 14px; font-size: 13px; }

      /* Interrupteur repris de celui des paramètres Roblox. */
      #${PANEL_ID} .rbx-tm-switch { position: relative; width: 48px; height: 28px; flex: none; }
      #${PANEL_ID} .rbx-tm-switch input {
        position: absolute; inset: 0; width: 100%; height: 100%;
        margin: 0; opacity: 0; cursor: pointer; z-index: 1;
      }
      #${PANEL_ID} .rbx-tm-switch i {
        position: absolute; inset: 0; border-radius: 999px;
        background: var(--rbx-subtle); border: 1px solid var(--rbx-border);
        transition: background .15s, border-color .15s;
      }
      #${PANEL_ID} .rbx-tm-switch i::after {
        content: ''; position: absolute; top: 3px; left: 3px;
        width: 20px; height: 20px; border-radius: 50%;
        background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.3);
        transition: transform .15s;
      }
      #${PANEL_ID} .rbx-tm-switch input:checked + i {
        background: var(--rbx-blue); border-color: var(--rbx-blue);
      }
      #${PANEL_ID} .rbx-tm-switch input:checked + i::after { transform: translateX(20px); }

      #${PANEL_ID} .rbx-tm-hist {
        list-style: none; margin: 8px 0 0; padding: 0;
        max-height: 180px; overflow: auto;
      }
      #${PANEL_ID} .rbx-tm-hist li {
        display: flex; justify-content: space-between; gap: 12px;
        padding: 10px 0; border-top: 1px solid var(--rbx-divider);
        font-size: 14px; color: var(--rbx-muted);
      }
      #${PANEL_ID} .rbx-tm-hist li span:first-child {
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      #${PANEL_ID} .rbx-tm-empty { color: var(--rbx-muted); font-size: 14px; margin: 12px 0 0; }
      #${PANEL_ID} .rbx-tm-note { color: var(--rbx-muted); font-size: 12px; margin: 16px 0 0; }
    `;
    (document.head || document.documentElement).appendChild(s);
  }

  function injectBanner() {
    if (document.getElementById(BANNER_ID)) return;
    if (!document.body) return;
    const d = document.createElement('div');
    d.id = BANNER_ID;
    d.textContent = 'TEST MODE — données simulées, aucun achat réel';
    document.body.appendChild(d);
  }

  injectStyle();

  // ---------- 2. FAUX SOLDE (DOM) ----------
  // React re-rend le header en permanence : on réécrit à chaque mutation.
  // Sélecteurs directs (anciennes et nouvelles versions du header).
  const BALANCE_SELECTORS = [
    '#nav-robux-amount',
    '#nav-robux-balance',
    '#navbar-robux-amount',
    '.text-robux-tab',
    '.text-robux',
    '[data-testid="navigation-robux-amount"]',
    '[data-testid="nav-robux-amount"]'
  ];

  // Conteneurs « robux » : à l'intérieur, un nombre isolé est forcément le solde.
  // Le nom de la classe qui porte la valeur change au fil des refontes, donc on
  // vise le conteneur (stable) plutôt que la valeur.
  const ROBUX_CONTAINERS = [
    '#navbar-robux', '#navigation-robux', '#nav-robux',
    '[id*="robux" i]', '[class*="robux" i]', '[data-testid*="robux" i]'
  ].join(', ');

  // On ne sort jamais du header : ailleurs, un nombre isolé serait un prix.
  const HEADER_ANCESTORS = 'header, nav, #header, .rbx-header, [data-testid*="header" i], [class*="navbar" i]';

  const NUMERIC_RE = /^[\d.,\s\u00a0\u202f]+$/;

  function setText(el, txt) {
    if (el.dataset.rbxFake === txt) return;
    el.textContent = txt;
    el.dataset.rbxFake = txt;
    el.classList.add('rbx-fake-value');
    el.title = 'Solde simulé — mode test';
  }

  // Remplace un élément-feuille dont le texte n'est qu'un nombre.
  function paintLeaf(el, txt) {
    if (el.children.length) return;                    // conteneur, pas la valeur
    if (el.closest('#' + PANEL_ID)) return;            // pas notre propre panneau
    const t = (el.textContent || '').trim();
    if (!t || !NUMERIC_RE.test(t)) return;             // « Robux », icône, etc.
    setText(el, txt);
  }

  function paintBalance() {
    if (!state.enabled || !document.body) return;
    const txt = fmt(state.balance);

    for (const sel of BALANCE_SELECTORS) {
      document.querySelectorAll(sel).forEach(el => setText(el, txt));
    }

    document.querySelectorAll(ROBUX_CONTAINERS).forEach(box => {
      if (!box.closest(HEADER_ANCESTORS)) return;
      paintLeaf(box, txt);                             // le conteneur est lui-même la valeur
      box.querySelectorAll('*').forEach(el => paintLeaf(el, txt));
    });
  }

  // ---------- 3. INTERCEPTION RÉSEAU ----------
  // Roblox utilise axios (XHR) autant que fetch : les deux sont couverts.
  const PURCHASE_PATTERNS = [
    /\/v1\/purchases\/products\//,
    /marketplace-sales\/v\d+\/item/,
    /economy\.roblox\.com\/v1\/purchases/,
    /apis\.roblox\.com\/marketplace-sales\//,
    /\/v1\/gamepass\/\d+\/purchase/
  ];

  // Endpoints qui renvoient le vrai solde : on réécrit la réponse pour que
  // React affiche lui-même le faux solde (c'est ça qui corrige le « 0 »).
  const CURRENCY_PATTERNS = [
    /economy\.roblox\.com\/v1\/user\/currency/,
    /economy\.roblox\.com\/v1\/users\/\d+\/currency/,
    /apis\.roblox\.com\/[^?]*\/currency\b/,
    /\/v1\/users\/\d+\/currency\/?(\?|$)/
  ];

  const isPurchase = (url) => state.enabled && PURCHASE_PATTERNS.some(re => re.test(url));
  const isCurrency = (url) => state.enabled && CURRENCY_PATTERNS.some(re => re.test(url));

  function extractPrice(body) {
    try {
      const b = typeof body === 'string' ? JSON.parse(body) : (body || {});
      return Number(b.expectedPrice || b.price || 0) || 0;
    } catch {
      return 0;
    }
  }

  function applyPurchase(url, price) {
    state.balance = Math.max(0, state.balance - price);
    state.owned.push({ url, price, at: new Date().toISOString() });
    save();
    paintBalance();
    renderPanel();
    console.log('[TEST MODE] achat simulé', { url, price, solde: state.balance });
  }

  const purchaseResponseBody = () => JSON.stringify({
    purchased: true,
    reason: 'Success',
    showDivId: 'TestMode',
    testMode: true          // marqueur laissé volontairement dans la réponse
  });

  function rewriteCurrency(text) {
    try {
      const data = JSON.parse(text);
      if (data && typeof data === 'object') {
        data.robux = state.balance;
        return JSON.stringify(data);
      }
    } catch { /* réponse non-JSON */ }
    return text;
  }

  // --- fetch ---
  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';

    if (isPurchase(url)) {
      applyPurchase(url, extractPrice(init && init.body));
      return new Response(purchaseResponseBody(), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }

    const res = await origFetch.apply(this, arguments);

    if (isCurrency(url)) {
      try {
        const text = await res.clone().text();
        return new Response(rewriteCurrency(text), {
          status: res.status, statusText: res.statusText, headers: res.headers
        });
      } catch { /* on laisse passer la vraie réponse */ }
    }

    return res;
  };

  // --- XMLHttpRequest (axios) ---
  const XHR = window.XMLHttpRequest;
  const origOpen = XHR.prototype.open;
  const origSend = XHR.prototype.send;

  XHR.prototype.open = function (method, url) {
    this.__rbxUrl = String(url || '');

    // Écouteur posé dès open() : il s'exécute donc avant ceux d'axios,
    // qui n'assigne ses handlers qu'entre open() et send().
    if (isCurrency(this.__rbxUrl)) {
      this.addEventListener('readystatechange', () => {
        if (this.readyState !== 4 || this.status !== 200) return;
        try {
          const patched = rewriteCurrency(this.responseText);
          Object.defineProperty(this, 'responseText', { configurable: true, get: () => patched });
          Object.defineProperty(this, 'response', {
            configurable: true,
            get: () => (this.responseType === 'json' ? JSON.parse(patched) : patched)
          });
        } catch { /* responseType binaire : on ne touche à rien */ }
      });
    }

    return origOpen.apply(this, arguments);
  };

  XHR.prototype.send = function (body) {
    const url = this.__rbxUrl || '';

    if (isPurchase(url)) {
      // On ne laisse PAS partir la requête : on fabrique la réponse.
      applyPurchase(url, extractPrice(body));
      fakeXhrResponse(this, purchaseResponseBody());
      return;
    }

    return origSend.apply(this, arguments);
  };

  function fakeXhrResponse(xhr, payload) {
    const def = (k, v) => Object.defineProperty(xhr, k, { configurable: true, get: () => v });
    def('readyState', 4);
    def('status', 200);
    def('statusText', 'OK');
    def('responseURL', xhr.__rbxUrl || '');
    def('responseText', payload);
    def('response', xhr.responseType === 'json' ? JSON.parse(payload) : payload);
    xhr.getAllResponseHeaders = () => 'content-type: application/json\r\n';
    xhr.getResponseHeader = (h) =>
      String(h).toLowerCase() === 'content-type' ? 'application/json' : null;

    setTimeout(() => {
      // On couvre les deux styles : handlers de propriété et addEventListener.
      for (const type of ['readystatechange', 'load', 'loadend']) {
        const handler = xhr['on' + type];
        if (typeof handler === 'function') handler.call(xhr, new Event(type));
        xhr.dispatchEvent(new Event(type));
      }
    }, 0);
  }

  // ---------- 4. PANNEAU DANS LES PARAMÈTRES ----------
  // Roblox préfixe ses URL par la locale : /fr/my/account, /en-us/settings…
  const SETTINGS_RE = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:my\/account|settings)/i;
  const isSettingsPage = () =>
    SETTINGS_RE.test(location.pathname) || /#!?\/(settings|info|account)/i.test(location.hash);

  // Emplacements où insérer le panneau, du plus précis au plus générique.
  const MOUNTS = [
    '#settings-container', '.settings-container',
    '#account-settings-container', '.account-settings',
    '#my-settings-container', '.settings-content',
    '#content .container-main', '#container-main', '#content'
  ];

  let panelEl = null;
  let panelForced = false;   // ouvert manuellement hors page paramètres
  let panelClosed = false;   // fermé à la croix : à respecter jusqu'à la prochaine navigation

  function buildPanel() {
    const el = document.createElement('div');
    el.id = PANEL_ID;
    el.innerHTML = `
      <div class="rbx-tm-head">
        <h2>Robux</h2>
        <span class="rbx-tm-badge">Mode test</span>
        <button class="rbx-tm-close" type="button" title="Fermer">&times;</button>
      </div>
      <p class="rbx-tm-sub">Solde simulé, visible uniquement dans ce navigateur.</p>

      <div class="rbx-tm-row">
        <span class="rbx-tm-label">Solde actuel</span>
        <span class="rbx-tm-right rbx-tm-amount">${ROBUX_ICON}<span data-role="current">0</span></span>
      </div>

      <div class="rbx-tm-row">
        <span class="rbx-tm-label">Modifier</span>
        <span class="rbx-tm-grow">
          <input class="rbx-tm-input" id="rbx-p-input" type="number" min="0" step="1" inputmode="numeric" />
          <button class="rbx-tm-btn rbx-tm-primary" data-act="apply" type="button">Appliquer</button>
        </span>
      </div>

      <div class="rbx-tm-row">
        <span class="rbx-tm-label">Ajouter</span>
        <span class="rbx-tm-right rbx-tm-chips">
          <button class="rbx-tm-btn" data-add="1000" type="button">+1 000</button>
          <button class="rbx-tm-btn" data-add="10000" type="button">+10 000</button>
          <button class="rbx-tm-btn" data-add="100000" type="button">+100 000</button>
          <button class="rbx-tm-btn" data-add="1000000" type="button">+1 000 000</button>
          <button class="rbx-tm-btn" data-act="zero" type="button">Mettre à 0</button>
        </span>
      </div>

      <div class="rbx-tm-row">
        <span class="rbx-tm-label">Mode test actif</span>
        <span class="rbx-tm-right">
          <label class="rbx-tm-switch"><input type="checkbox" data-act="enabled" /><i></i></label>
        </span>
      </div>

      <div class="rbx-tm-row rbx-tm-block">
        <div class="rbx-tm-rowhead">
          <span class="rbx-tm-label">Achats simulés (<span data-role="count">0</span>)</span>
          <span class="rbx-tm-right rbx-tm-chips">
            <button class="rbx-tm-btn" data-act="clear-hist" type="button">Vider</button>
            <button class="rbx-tm-btn" data-act="reset" type="button">Réinitialiser</button>
          </span>
        </div>
        <ul class="rbx-tm-hist" data-role="hist"></ul>
        <p class="rbx-tm-empty" data-role="empty">Aucun achat simulé pour l'instant.</p>
      </div>

      <p class="rbx-tm-note">Local uniquement : rien n'est envoyé à Roblox, aucun Robux réel n'est débité ni crédité.</p>
    `;

    el.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;

      if (btn.classList.contains('rbx-tm-close')) {
        panelForced = false;
        panelClosed = true;   // sans ça, la boucle d'entretien le remonterait aussitôt
        el.remove();
        return;
      }
      if (btn.dataset.add) {
        state.balance = Math.max(0, state.balance + Number(btn.dataset.add));
      } else if (btn.dataset.act === 'apply') {
        const v = Number(el.querySelector('#rbx-p-input').value);
        state.balance = Number.isFinite(v) ? Math.max(0, Math.floor(v)) : state.balance;
      } else if (btn.dataset.act === 'zero') {
        state.balance = 0;
      } else if (btn.dataset.act === 'clear-hist') {
        state.owned = [];
      } else if (btn.dataset.act === 'reset') {
        Object.assign(state, DEFAULTS, { owned: [] });
      } else {
        return;
      }

      save();
      paintBalance();
      renderPanel();
    });

    el.addEventListener('change', (e) => {
      if (e.target.dataset.act !== 'enabled') return;
      state.enabled = e.target.checked;
      save();
      if (state.enabled) paintBalance();
      else location.reload();   // revenir aux vraies valeurs demande un rechargement
    });

    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.id === 'rbx-p-input') {
        e.preventDefault();
        el.querySelector('[data-act="apply"]').click();
      }
    });

    return el;
  }

  function renderPanel() {
    if (!panelEl || !panelEl.isConnected) return;
    syncTheme();

    const input = panelEl.querySelector('#rbx-p-input');
    if (document.activeElement !== input) input.value = state.balance;

    panelEl.querySelector('[data-role="current"]').textContent = fmt(state.balance);
    panelEl.querySelector('[data-act="enabled"]').checked = !!state.enabled;
    panelEl.querySelector('[data-role="count"]').textContent = state.owned.length;

    const hist = panelEl.querySelector('[data-role="hist"]');
    const empty = panelEl.querySelector('[data-role="empty"]');
    hist.textContent = '';
    const recent = state.owned.slice(-20).reverse();
    empty.style.display = recent.length ? 'none' : '';
    for (const item of recent) {
      const li = document.createElement('li');
      const when = document.createElement('span');
      const price = document.createElement('span');
      let date = item.at;
      try { date = new Date(item.at).toLocaleString('fr-FR'); } catch { /* date brute */ }
      when.textContent = date;
      price.textContent = '−' + fmt(item.price) + ' R$';
      li.append(when, price);
      hist.appendChild(li);
    }
  }

  function mountPanel() {
    if (!document.body) return;

    const voulu = panelForced || (isSettingsPage() && !panelClosed);
    if (!voulu) {
      if (panelEl && panelEl.isConnected) panelEl.remove();
      return;
    }
    if (panelEl && panelEl.isConnected) return;

    if (!panelEl) panelEl = buildPanel();

    let host = null;
    if (!panelForced) {
      for (const sel of MOUNTS) {
        host = document.querySelector(sel);
        if (host) break;
      }
    }

    if (host) {
      panelEl.classList.remove('rbx-panel-floating');
      host.insertBefore(panelEl, host.firstChild);
    } else {
      // Page paramètres pas encore rendue (ou ouverture manuelle) : panneau flottant.
      panelEl.classList.add('rbx-panel-floating');
      document.body.appendChild(panelEl);
    }

    renderPanel();
  }

  // Navigation SPA : on ré-évalue la présence du panneau à chaque changement d'URL.
  for (const m of ['pushState', 'replaceState']) {
    const orig = history[m];
    history[m] = function () {
      const r = orig.apply(this, arguments);
      setTimeout(renavigate, 0);
      return r;
    };
  }
  window.addEventListener('popstate', () => setTimeout(renavigate, 0));
  window.addEventListener('hashchange', () => setTimeout(renavigate, 0));

  function renavigate() {
    panelClosed = false;
    mountPanel();
  }

  // ---------- 5. BOUCLE D'ENTRETIEN ----------
  const tick = () => {
    injectBanner();
    paintBalance();
    mountPanel();
    syncTheme();
  };

  const obs = new MutationObserver(tick);

  function start() {
    tick();
    obs.observe(document.body, { childList: true, subtree: true });
    // Filet de sécurité : certains re-rendus React ne déclenchent pas d'observation utile.
    setInterval(tick, 1500);
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);

  // Console : rbxTest.panel() ouvre le panneau depuis n'importe quelle page
  window.rbxTest = {
    state,
    reset() { localStorage.removeItem(STORAGE_KEY); location.reload(); },
    setBalance(n) { state.balance = Math.max(0, Number(n) || 0); save(); paintBalance(); renderPanel(); },
    panel() { panelForced = true; panelClosed = false; mountPanel(); }
  };
})();
