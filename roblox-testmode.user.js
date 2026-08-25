
// ==UserScript==
// @name         Roblox TEST MODE — faux solde + achats simulés
// @namespace    perso-test
// @version      0.4
// @downloadURL  https://raw.githubusercontent.com/guildenapp/roblox-testmode.user.js/main/roblox-testmode.user.js
// @updateURL    https://raw.githubusercontent.com/guildenapp/roblox-testmode.user.js/main/roblox-testmode.user.js
// @description  Bac à sable local : affiche un solde fictif, simule les achats catalogue et ajoute un panneau de réglage dans les paramètres Roblox. Rien n'est envoyé à Roblox.
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
  const BAR_H = 34;

  function injectStyle() {
    if (document.getElementById('rbx-testmode-style')) return;
    const s = document.createElement('style');
    s.id = 'rbx-testmode-style';
    s.textContent = `
      #${BANNER_ID} {
        position: fixed; top: 0; left: 0; right: 0; height: ${BAR_H}px;
        z-index: 2147483647;
        background: repeating-linear-gradient(45deg, #b3261e 0 12px, #8c1d16 12px 24px);
        color: #fff; font: 700 13px/${BAR_H}px system-ui, sans-serif;
        letter-spacing: .12em; text-align: center; text-transform: uppercase;
        pointer-events: none; user-select: none;
      }
      html { padding-top: ${BAR_H}px !important; }
      .rbx-fake-value {
        color: #b3261e !important;
        text-decoration: underline wavy #b3261e 1px !important;
      }

      /* ----- Panneau de réglage ----- */
      #${PANEL_ID} {
        border: 2px dashed #b3261e; border-radius: 10px;
        background: #fff; color: #1b1b1b;
        font: 400 14px/1.45 system-ui, -apple-system, sans-serif;
        padding: 16px 18px; margin: 0 0 20px; box-sizing: border-box;
      }
      #${PANEL_ID}.rbx-panel-floating {
        position: fixed; top: ${BAR_H + 12}px; right: 12px; width: 340px;
        max-height: calc(100vh - ${BAR_H + 24}px); overflow: auto;
        z-index: 2147483646; box-shadow: 0 8px 30px rgba(0,0,0,.28);
      }
      #${PANEL_ID} * { box-sizing: border-box; font-family: inherit; }
      #${PANEL_ID} .rbx-p-head {
        display: flex; align-items: center; gap: 8px;
        font-weight: 700; text-transform: uppercase; letter-spacing: .08em;
        font-size: 12px; color: #b3261e; margin-bottom: 12px;
      }
      #${PANEL_ID} .rbx-p-head .rbx-p-close {
        margin-left: auto; cursor: pointer; border: 0; background: none;
        font-size: 18px; line-height: 1; color: #666; padding: 0 4px;
      }
      #${PANEL_ID} label.rbx-p-label {
        display: block; font-weight: 600; font-size: 13px; margin: 0 0 6px;
      }
      #${PANEL_ID} .rbx-p-row { display: flex; gap: 8px; align-items: center; }
      #${PANEL_ID} input[type="number"] {
        flex: 1; min-width: 0; padding: 8px 10px; font-size: 15px;
        border: 1px solid #c9c9c9; border-radius: 6px; background: #fff; color: #1b1b1b;
      }
      #${PANEL_ID} button.rbx-p-btn {
        padding: 8px 12px; border-radius: 6px; border: 1px solid #b3261e;
        background: #b3261e; color: #fff; font-size: 13px; font-weight: 600;
        cursor: pointer; white-space: nowrap;
      }
      #${PANEL_ID} button.rbx-p-btn.rbx-p-ghost {
        background: #fff; color: #b3261e;
      }
      #${PANEL_ID} button.rbx-p-btn:hover { filter: brightness(.94); }
      #${PANEL_ID} .rbx-p-quick { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
      #${PANEL_ID} .rbx-p-quick button { font-size: 12px; padding: 5px 9px; }
      #${PANEL_ID} .rbx-p-current {
        font-size: 13px; color: #444; margin: 10px 0 0;
      }
      #${PANEL_ID} .rbx-p-current b { color: #b3261e; font-size: 16px; }
      #${PANEL_ID} .rbx-p-sep { border: 0; border-top: 1px solid #e6e6e6; margin: 14px 0; }
      #${PANEL_ID} .rbx-p-toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; }
      #${PANEL_ID} .rbx-p-hist { margin: 8px 0 0; padding: 0; list-style: none;
        max-height: 150px; overflow: auto; font-size: 12px; color: #444; }
      #${PANEL_ID} .rbx-p-hist li {
        display: flex; justify-content: space-between; gap: 10px;
        padding: 4px 0; border-bottom: 1px solid #f0f0f0;
      }
      #${PANEL_ID} .rbx-p-hist li span:first-child {
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      }
      #${PANEL_ID} .rbx-p-empty { font-size: 12px; color: #888; font-style: italic; margin-top: 8px; }
      #${PANEL_ID} .rbx-p-note { font-size: 11px; color: #888; margin-top: 12px; }
      @media (prefers-color-scheme: dark) {
        #${PANEL_ID} { background: #1e1e1e; color: #ededed; }
        #${PANEL_ID} input[type="number"] { background: #2a2a2a; color: #ededed; border-color: #444; }
        #${PANEL_ID} button.rbx-p-btn.rbx-p-ghost { background: #2a2a2a; }
        #${PANEL_ID} .rbx-p-current, #${PANEL_ID} .rbx-p-hist { color: #bdbdbd; }
        #${PANEL_ID} .rbx-p-sep { border-top-color: #3a3a3a; }
        #${PANEL_ID} .rbx-p-hist li { border-bottom-color: #2f2f2f; }
      }
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

  function buildPanel() {
    const el = document.createElement('div');
    el.id = PANEL_ID;
    el.innerHTML = `
      <div class="rbx-p-head">
        <span>Test mode — solde fictif</span>
        <button class="rbx-p-close" type="button" title="Fermer">&times;</button>
      </div>
      <label class="rbx-p-label" for="rbx-p-input">Solde Robux simulé</label>
      <div class="rbx-p-row">
        <input id="rbx-p-input" type="number" min="0" step="1" />
        <button class="rbx-p-btn" data-act="apply" type="button">Appliquer</button>
      </div>
      <div class="rbx-p-quick">
        <button class="rbx-p-btn rbx-p-ghost" data-add="1000" type="button">+1 000</button>
        <button class="rbx-p-btn rbx-p-ghost" data-add="10000" type="button">+10 000</button>
        <button class="rbx-p-btn rbx-p-ghost" data-add="100000" type="button">+100 000</button>
        <button class="rbx-p-btn rbx-p-ghost" data-add="1000000" type="button">+1 000 000</button>
        <button class="rbx-p-btn rbx-p-ghost" data-act="zero" type="button">Mettre à 0</button>
      </div>
      <p class="rbx-p-current">Solde actuel : <b data-role="current">0</b> Robux</p>
      <hr class="rbx-p-sep" />
      <label class="rbx-p-toggle">
        <input type="checkbox" data-act="enabled" />
        <span>Mode test actif (faux solde + achats simulés)</span>
      </label>
      <hr class="rbx-p-sep" />
      <label class="rbx-p-label">Achats simulés (<span data-role="count">0</span>)</label>
      <ul class="rbx-p-hist" data-role="hist"></ul>
      <p class="rbx-p-empty" data-role="empty">Aucun achat simulé pour l'instant.</p>
      <div class="rbx-p-quick">
        <button class="rbx-p-btn rbx-p-ghost" data-act="clear-hist" type="button">Vider l'historique</button>
        <button class="rbx-p-btn rbx-p-ghost" data-act="reset" type="button">Tout réinitialiser</button>
      </div>
      <p class="rbx-p-note">Local uniquement : rien n'est envoyé à Roblox, aucun Robux réel n'est débité ni crédité.</p>
    `;

    el.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;

      if (btn.classList.contains('rbx-p-close')) {
        panelForced = false;
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
    if (!panelForced && !isSettingsPage()) {
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
      setTimeout(mountPanel, 0);
      return r;
    };
  }
  window.addEventListener('popstate', () => setTimeout(mountPanel, 0));
  window.addEventListener('hashchange', () => setTimeout(mountPanel, 0));

  // ---------- 5. BOUCLE D'ENTRETIEN ----------
  const tick = () => {
    injectBanner();
    paintBalance();
    mountPanel();
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
    panel() { panelForced = true; mountPanel(); }
  };
})();
