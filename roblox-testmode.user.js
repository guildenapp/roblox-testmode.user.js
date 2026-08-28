
// ==UserScript==
// @name         Roblox TEST MODE — faux solde + achats simulés
// @namespace    perso-test
// @version      1.8
// @downloadURL  https://raw.githubusercontent.com/guildenapp/roblox-testmode.user.js/main/roblox-testmode.user.js
// @updateURL    https://raw.githubusercontent.com/guildenapp/roblox-testmode.user.js/main/roblox-testmode.user.js
// @description  Bac à sable local : faux solde, achats simulés conservés dans l'inventaire, identité empruntée à un profil public. Rien n'est envoyé à Roblox.
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
  const RELOAD_DELAY = 2200;      // laisse la confirmation d'achat de Roblox s'afficher
  // ----------------------------

  const DEFAULTS = {
    balance: FAKE_BALANCE,
    owned: [],
    enabled: true,
    reloadAfterPurchase: true,
    wearing: [],    // articles simulés actuellement portés
    ledger: [],     // registre des mouvements : sa somme vaut le solde
    netLog: [],     // dernières requêtes POST vers Roblox, pour diagnostic
    me: null,       // vrai compte connecté : { id, name, displayName }
    spoof: null     // identité empruntée : { id, name, displayName, hasVerifiedBadge, ... }
  };

  const state = load();

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
      const s = Object.assign({}, DEFAULTS, raw);
      if (!Array.isArray(s.owned)) s.owned = [];
      if (!Array.isArray(s.wearing)) s.wearing = [];
      if (!Array.isArray(s.ledger)) s.ledger = [];
      return s;
    } catch {
      return Object.assign({}, DEFAULTS, { owned: [] });
    }
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* quota */ }
  }

  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Références capturées avant nos propres correctifs, pour nos requêtes à nous.
  const origFetch = window.fetch && window.fetch.bind(window);

  // ---------- IDENTIFIANTS VISUELS ----------
  const PANEL_ID = 'rbx-testmode-panel';

  // Hexagone évidé : la même forme que l'icône Robux du site.
  const ROBUX_ICON =
    '<svg class="rbx-tm-icon" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path fill="currentColor" fill-rule="evenodd" d="M12 1.5 21.09 6.75v10.5L12 22.5 2.91 17.25V6.75L12 1.5Z' +
    'M12 7 7.67 9.5v5L12 17l4.33-2.5v-5L12 7Z"/></svg>';

  const CHECK_ICON =
    '<svg class="rbx-tm-check" viewBox="0 0 24 24" aria-hidden="true">' +
    '<circle cx="12" cy="12" r="10" fill="#00b06f"/>' +
    '<path fill="#fff" d="m10.6 16.2-4-4 1.4-1.4 2.6 2.6 5.4-5.4 1.4 1.4z"/></svg>';

  const VERIFIED_ICON =
    '<svg class="rbx-tm-verified" viewBox="0 0 24 24" aria-label="Verified account">' +
    '<circle cx="12" cy="12" r="10" fill="#0066ff"/>' +
    '<path fill="#fff" d="m10.6 16.2-4-4 1.4-1.4 2.6 2.6 5.4-5.4 1.4 1.4z"/></svg>';

  // ---------- 1. STYLES ----------
  function injectStyle() {
    if (document.getElementById('rbx-testmode-style')) return;
    const s = document.createElement('style');
    s.id = 'rbx-testmode-style';
    s.textContent = `
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

        display: block; background: none; border: 0; padding: 0;
        margin: 0 0 24px; color: var(--rbx-text);
        /* On hérite de la police de Roblox (Builder Sans) : rien à déclarer. */
        font-size: 15px; line-height: 1.4; box-sizing: border-box;
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
        position: fixed; top: 12px; right: 12px; width: 380px;
        max-height: calc(100vh - 24px); overflow: auto;
        z-index: 2147483646;
      }
      #${PANEL_ID}.rbx-panel-floating .rbx-tm-card { box-shadow: 0 8px 30px rgba(0,0,0,.24); }
      #${PANEL_ID} * { box-sizing: border-box; font-family: inherit; }

      #${PANEL_ID} .rbx-tm-card {
        background: var(--rbx-card); border: 1px solid var(--rbx-border);
        border-radius: 12px; padding: 20px 24px; margin: 0 0 16px;
      }
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
      #${PANEL_ID} .rbx-tm-badge.rbx-tm-count { background: var(--rbx-subtle); color: var(--rbx-muted); }
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
      #${PANEL_ID} .rbx-tm-row.rbx-tm-bare { border-top: 0; padding-top: 0; }
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
      #${PANEL_ID} .rbx-tm-btn:disabled { opacity: .5; cursor: default; }
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

      /* Fiche d'identité */
      #${PANEL_ID} .rbx-tm-ident { display: flex; align-items: center; gap: 16px; }
      #${PANEL_ID} .rbx-tm-ident img {
        width: 72px; height: 72px; border-radius: 50%; flex: none;
        background: var(--rbx-subtle); object-fit: cover;
      }
      #${PANEL_ID} .rbx-tm-ident-name {
        display: flex; align-items: center; gap: 6px;
        font-size: 18px; font-weight: 700;
      }
      #${PANEL_ID} .rbx-tm-verified { width: 18px; height: 18px; flex: none; }
      #${PANEL_ID} .rbx-tm-ident-user { color: var(--rbx-muted); font-size: 14px; }
      #${PANEL_ID} .rbx-tm-ident-stats {
        display: flex; gap: 16px; margin-top: 6px;
        color: var(--rbx-muted); font-size: 13px;
      }
      #${PANEL_ID} .rbx-tm-ident-stats b { color: var(--rbx-text); }
      #${PANEL_ID} .rbx-tm-error { color: var(--rbx-red); font-size: 14px; }

      /* Grille d'articles simulés */
      #${PANEL_ID} .rbx-tm-grid {
        display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
        gap: 12px; margin-top: 12px;
      }
      #${PANEL_ID} .rbx-tm-item {
        border: 1px solid var(--rbx-border); border-radius: 8px; overflow: hidden;
        background: var(--rbx-card);
      }
      #${PANEL_ID} .rbx-tm-item img {
        width: 100%; aspect-ratio: 1; object-fit: cover; display: block;
        background: var(--rbx-subtle);
      }
      #${PANEL_ID} .rbx-tm-item .rbx-tm-item-body { padding: 8px 10px; }
      #${PANEL_ID} .rbx-tm-item .rbx-tm-item-name {
        font-size: 13px; font-weight: 600; line-height: 1.3;
        display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
      }
      #${PANEL_ID} .rbx-tm-item .rbx-tm-wear {
        width: 100%; margin-top: 6px; padding: 6px 8px; font-size: 12px;
        font-weight: 600; border: 0; border-radius: 6px; cursor: pointer;
        background: var(--rbx-subtle); color: var(--rbx-text);
      }
      #${PANEL_ID} .rbx-tm-item .rbx-tm-wear.rbx-tm-on { background: var(--rbx-blue); color: #fff; }
      #${PANEL_ID} .rbx-tm-item .rbx-tm-item-price {
        display: flex; align-items: center; gap: 4px;
        font-size: 13px; font-weight: 700; margin-top: 4px;
      }

      #${PANEL_ID} .rbx-tm-hist {
        list-style: none; margin: 8px 0 0; padding: 0;
        max-height: 180px; overflow: auto;
      }
      #${PANEL_ID} .rbx-tm-hist li {
        display: flex; justify-content: space-between; gap: 12px;
        padding: 10px 0; border-top: 1px solid var(--rbx-divider);
        font-size: 14px; color: var(--rbx-muted);
      }
      #${PANEL_ID} .rbx-tm-log { list-style: none; margin: 8px 0 0; padding: 0; }
      #${PANEL_ID} .rbx-tm-log li {
        display: flex; align-items: baseline; gap: 8px;
        padding: 8px 0; border-top: 1px solid var(--rbx-divider);
        font-size: 12px; word-break: break-all;
      }
      #${PANEL_ID} .rbx-tm-log .rbx-tm-tag {
        flex: none; font-weight: 700; font-size: 10px; text-transform: uppercase;
        letter-spacing: .06em; padding: 3px 6px; border-radius: 5px;
        background: var(--rbx-subtle); color: var(--rbx-muted);
      }
      #${PANEL_ID} .rbx-tm-log .rbx-tm-tag.rbx-tm-yes { background: #1f7a3d; color: #fff; }
      #${PANEL_ID} .rbx-tm-log .rbx-tm-tag.rbx-tm-no { background: var(--rbx-red); color: #fff; }
      #${PANEL_ID} .rbx-tm-empty { color: var(--rbx-muted); font-size: 14px; margin: 12px 0 0; }
      #${PANEL_ID} .rbx-tm-note { color: var(--rbx-muted); font-size: 12px; margin: 16px 0 0; }

      /* Cartes injectées dans la vraie grille d'inventaire */
      .rbx-tm-inv-card {
        border: 1px solid #e3e5e6; border-radius: 8px; overflow: hidden;
        background: #fff; width: 150px; margin: 0 8px 16px 0; display: inline-block;
        vertical-align: top; text-align: left;
      }
      body.dark-theme .rbx-tm-inv-card { background: #2f3133; border-color: #393b3d; color: #fff; }
      .rbx-tm-inv-card img { width: 100%; aspect-ratio: 1; object-fit: cover; display: block; background: #f2f4f5; }
      .rbx-tm-inv-card .rbx-tm-inv-body { padding: 8px 10px; }
      .rbx-tm-inv-card .rbx-tm-inv-name { font-size: 13px; font-weight: 600; line-height: 1.3; }
      .rbx-tm-inv-card .rbx-tm-inv-price {
        display: flex; align-items: center; gap: 4px;
        font-size: 13px; font-weight: 700; margin-top: 4px;
      }
      /* La règle de taille du panneau ne porte pas jusqu'ici. */
      .rbx-tm-inv-card .rbx-tm-icon { width: 14px; height: 14px; flex: none; }
      /* État « possédé » reproduit sur la page d'un article. */
      #rbx-tm-owned { margin: 12px 0 20px; }
      #rbx-tm-owned .rbx-tm-owned-row {
        display: flex; align-items: center; gap: 16px; flex-wrap: wrap;
      }
      #rbx-tm-owned .rbx-tm-owned-text { flex: 1 1 220px; font-size: 16px; }
      .rbx-tm-owned-btn {
        display: inline-block; border: 0; cursor: pointer;
        background: #f2f4f5; color: #1b1d1f;
        padding: 10px 22px; border-radius: 8px;
        font: inherit; font-size: 15px; font-weight: 600; text-decoration: none;
      }
      body.dark-theme .rbx-tm-owned-btn { background: #393b3d; color: #fff; }
      .rbx-tm-owned-badge {
        display: inline-flex; align-items: center; gap: 6px;
        margin-left: 12px; font-weight: 600; font-size: 16px;
      }
      .rbx-tm-check { width: 20px; height: 20px; flex: none; }

      /* Badge de certification injecté dans la page, hors panneau. */
      .rbx-tm-verified {
        width: .85em; height: .85em; display: inline-block; vertical-align: -.08em;
      }
    `;
    (document.head || document.documentElement).appendChild(s);
  }

  injectStyle();

  // Roblox marque son thème sur <body> ; on s'y aligne au lieu de suivre l'OS,
  // sinon le panneau s'affiche en sombre sur un site resté en clair.
  function currentTheme() {
    const cls = document.body ? document.body.className : '';
    if (/\bdark-theme\b/.test(cls)) return 'dark';
    if (/\blight-theme\b/.test(cls)) return 'light';
    return (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  }

  // ---------- 2. FAUX SOLDE (DOM) ----------
  // Identifiants réservés au solde de la barre de navigation. « text-robux »
  // n'en fait surtout pas partie : Roblox s'en sert pour le prix des articles,
  // y compris dans la fenêtre d'achat.
  const BALANCE_SELECTORS = [
    '#nav-robux-amount', '#nav-robux-balance', '#navbar-robux-amount',
    '.text-robux-tab',
    '[data-testid="navigation-robux-amount"]', '[data-testid="nav-robux-amount"]'
  ];

  const ROBUX_CONTAINERS = [
    '#navbar-robux', '#navigation-robux', '#nav-robux',
    '[id*="robux" i]', '[class*="robux" i]', '[data-testid*="robux" i]'
  ].join(', ');

  const HEADER_ANCESTORS = 'header, nav, #header, .rbx-header, [data-testid*="header" i], [class*="navbar" i]';

  // Un élément qui s'appelle « balance » est un solde où qu'il soit — c'est le
  // cas de celui affiché en haut de la fenêtre d'achat. Un élément qui porte
  // seulement « robux », lui, n'est un solde que dans l'en-tête.
  const BALANCE_NAMED = [
    '[id*="balance" i]', '[class*="balance" i]', '[data-testid*="balance" i]'
  ].join(', ');

  // Le menu déroulant du solde. « role=dialog » en est volontairement exclu :
  // la fenêtre d'achat en est une, et son montant central est un prix.
  const MENU_ANCESTORS = [
    '[role="menu"]', '.popover', '.dropdown-menu',
    '[class*="popover" i]', '[class*="dropdown" i]'
  ].join(', ');
  // Un nombre, éventuellement déjà abrégé (« 111M+ »), pour pouvoir le réécrire.
  const NUMERIC_RE = /^[\d.,\s  ]+(?:[KMB]\+?)?$/i;

  // Roblox abrège le solde dans la barre de navigation — et seulement là :
  // la fenêtre d'achat, elle, affiche le montant complet.
  function abbreviate(n) {
    n = Number(n) || 0;
    if (n >= 1e9) return Math.floor(n / 1e9) + 'B+';
    if (n >= 1e6) return Math.floor(n / 1e6) + 'M+';
    return fmt(n);
  }

  function setText(el, txt) {
    if (el.dataset.rbxFake === txt) return;   // déjà à jour, y compris au bon format
    el.textContent = txt;
    el.dataset.rbxFake = txt;
    el.classList.add('rbx-fake-value');
    el.title = 'Simulated balance — test mode';
  }

  function paintLeaf(el, txt) {
    if (el.children.length) return;
    if (el.closest('#' + PANEL_ID)) return;
    const t = (el.textContent || '').trim();
    if (!t || !NUMERIC_RE.test(t)) return;
    setText(el, txt);
  }

  function paintBalance() {
    if (!state.enabled || !document.body) return;
    // Abrégé dans la barre de navigation, complet partout ailleurs : c'est ce
    // que fait Roblox lui-même.
    const court = abbreviate(state.balance);
    const complet = fmt(state.balance);

    for (const sel of BALANCE_SELECTORS) {
      document.querySelectorAll(sel).forEach(el => setText(el, court));
    }

    // Hors de l'en-tête, un montant en Robux est un prix, jamais le solde :
    // on ne sort donc jamais de la barre de navigation.
    document.querySelectorAll(ROBUX_CONTAINERS).forEach(box => {
      if (!box.closest(HEADER_ANCESTORS)) return;
      paintLeaf(box, court);
      box.querySelectorAll('*').forEach(el => paintLeaf(el, court));
    });

    document.querySelectorAll(BALANCE_NAMED).forEach(box => {
      const txt = box.closest(HEADER_ANCESTORS) ? court : complet;
      paintLeaf(box, txt);
      box.querySelectorAll('*').forEach(el => paintLeaf(el, txt));
    });

    // Le menu qui s'ouvre sous le solde affiche le montant entier, pas l'abrégé.
    // La mention « Robux » dans le menu sert de garde-fou : sans elle, on ne
    // touche à rien.
    document.querySelectorAll(MENU_ANCESTORS).forEach(menu => {
      if (menu.closest('#' + PANEL_ID)) return;
      if (!/robux/i.test(menu.textContent || '')) return;
      menu.querySelectorAll('*').forEach(el => paintLeaf(el, complet));
    });
  }

  // ---------- 3. COMPTE RÉEL ET IDENTITÉ EMPRUNTÉE ----------
  // On garde le vrai identifiant numérique : le site s'en sert pour ses propres
  // appels (inventaire, amis…). Seuls le nom, le pseudo et l'avatar changent.
  async function ensureMe() {
    if (state.me && state.me.id) return state.me;
    if (!origFetch) return null;
    try {
      const r = await origFetch('https://users.roblox.com/v1/users/authenticated', { credentials: 'include' });
      if (!r.ok) return null;
      const d = await r.json();
      state.me = { id: d.id, name: d.name, displayName: d.displayName };
      save();
      return state.me;
    } catch {
      return null;
    }
  }

  // Recherche le profil public réel d'un pseudo, tel que Roblox l'expose.
  async function lookupUser(username) {
    if (!origFetch) throw new Error('network unavailable');

    const r = await origFetch('https://users.roblox.com/v1/usernames/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: false })
    });
    if (!r.ok) throw new Error('lookup failed (HTTP ' + r.status + ')');
    const found = (await r.json()).data || [];
    if (!found.length) throw new Error('no account named \u201c' + username + '\u201d');

    const id = found[0].id;
    const [detail, headshot, avatar, friends, followers, followings] = await Promise.all([
      getJson('https://users.roblox.com/v1/users/' + id),
      getJson('https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=' + id + '&size=150x150&format=Png&isCircular=false'),
      getJson('https://thumbnails.roblox.com/v1/users/avatar?userIds=' + id + '&size=420x420&format=Png&isCircular=false'),
      getJson('https://friends.roblox.com/v1/users/' + id + '/friends/count'),
      getJson('https://friends.roblox.com/v1/users/' + id + '/followers/count'),
      getJson('https://friends.roblox.com/v1/users/' + id + '/followings/count')
    ]);

    const pick = (t) => (t && t.data && t.data[0] && t.data[0].imageUrl) || '';

    return {
      id,
      name: (detail && detail.name) || found[0].name,
      displayName: (detail && detail.displayName) || found[0].displayName || found[0].name,
      description: (detail && detail.description) || '',
      created: (detail && detail.created) || '',
      hasVerifiedBadge: !!((detail && detail.hasVerifiedBadge) || found[0].hasVerifiedBadge),
      headshotUrl: pick(headshot),
      avatarUrl: pick(avatar),
      friendCount: (friends && friends.count) || 0,
      followerCount: (followers && followers.count) || 0,
      followingCount: (followings && followings.count) || 0
    };
  }

  async function getJson(url) {
    try {
      const r = await origFetch(url, { credentials: 'omit' });
      return r.ok ? await r.json() : null;
    } catch {
      return null;
    }
  }

  const spoofOn = () => state.enabled && state.spoof && state.spoof.active;

  // Réécrire la réponse ne donnerait que le nom et l'avatar. En réécrivant
  // l'URL, c'est Roblox lui-même qui renvoie les vrais amis, abonnés, badges,
  // groupes et favoris du profil emprunté. Liste blanche stricte : tout ce qui
  // touche à mon compte réel (paramètres, panier, achats) doit rester intact.
  const PROFILE_ENDPOINTS = new RegExp([
    'friends\\.roblox\\.com/v\\d+/users/',
    'badges\\.roblox\\.com/v\\d+/users/',
    'accountinformation\\.roblox\\.com/v\\d+/users/',
    'groups\\.roblox\\.com/v\\d+/users/',
    'avatar\\.roblox\\.com/v\\d+/users/',
    'games\\.roblox\\.com/v\\d+/users/',
    'premiumfeatures\\.roblox\\.com/v\\d+/users/',
    'inventory\\.roblox\\.com/v\\d+/users/\\d+/(?:assets/collectibles|categories|favorites)',
    'users\\.roblox\\.com/v\\d+/users/\\d+(?:$|[/?])'
  ].join('|'));

  function spoofUrl(url) {
    if (!spoofOn() || !state.me || !state.spoof.id) return url;
    const moi = String(state.me.id);
    const lui = String(state.spoof.id);
    if (moi === lui || !url.includes(moi)) return url;

    // Les vignettes portent l'identifiant en query, parfois au milieu d'une liste.
    if (/thumbnails\.roblox\.com\/v\d+\/users\//.test(url) && url.includes('userIds=')) {
      return url.replace(/(\buserIds=)([\d%2C,]+)/i, (m, cle, liste) =>
        cle + liste.split(/,|%2C/i).map(x => (x === moi ? lui : x)).join(','));
    }

    // Ces compteurs changent d'hôte au fil des refontes : on accepte donc
    // aussi la reconnaissance par le chemin, quel que soit l'hôte Roblox.
    const parChemin = new RegExp(
      '/v\\d+/users/' + moi + '/(?:friends|followers|followings|badges|groups|favorites)');
    if (!PROFILE_ENDPOINTS.test(url) && !parChemin.test(url)) return url;
    return url.replace(new RegExp('(/users/)' + moi + '(?=$|[/?])'), '$1' + lui);
  }

  // Remplacement dans le texte de la page. Idempotent : une fois le vrai nom
  // remplacé, il n'y a plus rien à trouver, donc aucune boucle avec l'observateur.
  const IDENT_SKIP = /^(SCRIPT|STYLE|TEXTAREA|INPUT|NOSCRIPT)$/;

  const echapperRegex = (t) => String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Un remplacement brut abîme tout ce qui contient le pseudo par hasard : avec
  // un compte nommé « M », le solde « 1M+ » devenait « 1Azen+ ». On exige donc
  // un bord de mot, au sens des caractères autorisés dans un pseudo Roblox.
  function remplaceNom(texte, reel, faux) {
    const re = new RegExp('(^|[^A-Za-z0-9_])' + echapperRegex(reel) + '(?![A-Za-z0-9_])', 'g');
    return texte.replace(re, (m, avant) => avant + faux);
  }

  function paintIdentity() {
    if (!spoofOn() || !state.me || !document.body) return;
    const sp = state.spoof;

    const pairs = [];
    if (state.me.displayName && state.me.displayName !== sp.displayName) {
      pairs.push([state.me.displayName, sp.displayName]);
    }
    if (state.me.name && state.me.name !== sp.name) {
      pairs.push([state.me.name, sp.name]);
    }
    if (!pairs.length) return;

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const todo = [];
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent || IDENT_SKIP.test(parent.tagName)) continue;
      if (parent.closest('#' + PANEL_ID)) continue;
      // Ne jamais repasser sur un nombre qu'on vient d'écrire nous-mêmes.
      if (parent.dataset.rbxFake !== undefined || parent.dataset.rbxCount !== undefined) continue;
      const txt = node.nodeValue;
      if (!txt || !pairs.some(([real]) => txt.includes(real))) continue;
      todo.push(node);
    }
    for (const n of todo) {
      let v = n.nodeValue;
      for (const [real, faux] of pairs) v = remplaceNom(v, real, faux);
      n.nodeValue = v;
    }

    swapAvatars(sp);
    injectVerified(sp);
    paintCounts(sp);
  }

  // Roblox affiche lui-même le badge quand l'API le signale ; ceci couvre les
  // en-têtes rendus côté serveur, qui ne passent pas par cette API.
  const NAME_HEADINGS = [
    'h1', 'h2', '.profile-display-name', '.profile-name', '.profile-header-title',
    '[class*="display-name" i]', '[class*="displayname" i]',
    '[data-testid*="display-name" i]', '[data-testid*="displayname" i]'
  ].join(', ');

  const normalise = (t) => String(t || '').replace(/\s+/g, ' ').trim();

  // offsetParent vaut null pour tout élément en « position: fixed » — donc
  // pour les fenêtres modales, justement celles qu'on cherche.
  const estVisible = (el) => !!(el && el.getClientRects().length);

  function injectVerified(sp) {
    if (!sp.hasVerifiedBadge) return;
    document.querySelectorAll(NAME_HEADINGS).forEach(el => {
      if (el.dataset.rbxVerified || el.closest('#' + PANEL_ID)) return;
      if (el.querySelector('.rbx-tm-verified')) return;
      if (normalise(el.textContent) !== normalise(sp.displayName)) return;
      el.dataset.rbxVerified = '1';
      el.insertAdjacentHTML('beforeend', ' ' + VERIFIED_ICON);
    });
  }

  // Sur la page de profil, les compteurs sont rendus côté serveur : il n'y a
  // aucune requête à détourner, il faut donc les réécrire dans la page.
  const PROFILE_PAGE_RE = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?users\/\d+\/profile/i;
  const isProfilePage = () => PROFILE_PAGE_RE.test(location.pathname);

  const COUNT_LABELS = [
    { re: /^(amis|friends)$/i, cle: 'friendCount' },
    { re: /^(abonn[ée]s?|followers?)$/i, cle: 'followerCount' },
    { re: /^(abonnements?|following)$/i, cle: 'followingCount' }
  ];

  const COUNT_VALUE_RE = /^[\d.,\s\u00a0\u202f]+[KMB]?$/i;
  const COUNT_COMBINED_RE = /^([\d.,\s\u00a0\u202f]+[KMB]?) (.+)$/i;

  // Roblox abrège les compteurs avec une décimale : « 191.9K ».
  function abbrevCount(n) {
    n = Number(n) || 0;
    const court = (v, unite) => (Math.round(v * 10) / 10) + unite;
    if (n >= 1e9) return court(n / 1e9, 'B');
    if (n >= 1e6) return court(n / 1e6, 'M');
    if (n >= 1e3) return court(n / 1e3, 'K');
    return String(n);
  }

  function setCount(el, txt) {
    if (el.dataset.rbxCount === txt) return;
    el.textContent = txt;
    el.dataset.rbxCount = txt;
    el.title = 'Borrowed profile counter — test mode';
  }

  function paintCounts(sp) {
    if (!isProfilePage()) return;

    document.querySelectorAll('span, div, p, li, a, h2, h3, b, strong').forEach(el => {
      if (el.children.length || el.closest('#' + PANEL_ID)) return;
      const texte = normalise(el.textContent);
      if (!texte) return;

      // Cas 1 : nombre et étiquette dans le même élément (« 12 Amis »).
      const ensemble = texte.match(COUNT_COMBINED_RE);
      if (ensemble) {
        const lab = COUNT_LABELS.find(l => l.re.test(ensemble[2]));
        if (lab) setCount(el, abbrevCount(sp[lab.cle]) + ' ' + ensemble[2]);
        return;
      }

      // Cas 2 : étiquette et nombre dans deux éléments voisins.
      const lab = COUNT_LABELS.find(l => l.re.test(texte));
      if (!lab) return;
      const cible = nombreVoisin(el);
      if (cible) setCount(cible, abbrevCount(sp[lab.cle]));
    });
  }

  // Le nombre précède généralement son étiquette : on regarde le frère d'avant
  // en premier, puis autour, sans jamais quitter le voisinage immédiat.
  function nombreVoisin(labelEl) {
    const zones = [
      labelEl.previousElementSibling,
      labelEl.nextElementSibling,
      labelEl.parentElement,
      labelEl.parentElement && labelEl.parentElement.parentElement
    ];
    const estNombre = (e) =>
      e && e !== labelEl && !e.children.length && COUNT_VALUE_RE.test(normalise(e.textContent));

    for (const zone of zones) {
      if (!zone) continue;
      if (estNombre(zone)) return zone;
      const dedans = Array.prototype.find.call(zone.querySelectorAll('*'), estNombre);
      if (dedans) return dedans;
    }
    return null;
  }

  // Les images rendues côté serveur ne passent pas par l'API vignettes. Mais
  // « [class*=avatar] img » attrapait aussi les vignettes des amis, qui se
  // retrouvaient tous avec la tête du profil emprunté : on se limite donc à
  // l'en-tête et aux conteneurs qui désignent explicitement mon avatar.
  const AVATAR_SCOPES = 'header, nav, #header, [class*="navbar" i], [data-testid*="header" i]';

  const MY_AVATAR_SELECTORS = [
    '#navbar-avatar img', '[data-testid*="user-avatar" i] img',
    '.profile-avatar img', '.profile-header-thumbnail img',
    '[class*="profile-header" i] img'
  ].join(', ');

  function swapAvatars(sp) {
    const url = sp.headshotUrl || sp.avatarUrl;
    if (!url) return;

    const cibles = new Set();
    document.querySelectorAll(AVATAR_SCOPES).forEach(zone =>
      zone.querySelectorAll('img').forEach(img => cibles.add(img)));
    document.querySelectorAll(MY_AVATAR_SELECTORS).forEach(img => cibles.add(img));

    for (const img of cibles) {
      if (img.closest('#' + PANEL_ID)) continue;
      if (img.dataset.rbxAvatar === url) continue;
      // On ne touche qu'aux vignettes Roblox, jamais aux visuels de jeux.
      if (!/rbxcdn\.com/.test(img.src || '')) continue;
      img.dataset.rbxAvatar = url;
      img.src = url;
      img.srcset = '';
    }
  }

  // ---------- 4. CACHE DES ARTICLES ----------
  // Rempli au fil de la navigation : c'est ce qui permet, au moment de l'achat,
  // de connaître le nom, le prix et la vignette réels de l'article.
  const itemCache = new Map();
  const CACHE_MAX = 400;

  function cachePut(key, patch) {
    if (!key) return;
    const cur = itemCache.get(key) || {};
    itemCache.set(key, Object.assign(cur, patch));
    if (itemCache.size > CACHE_MAX) itemCache.delete(itemCache.keys().next().value);
  }

  function captureCatalogDetails(data) {
    const rows = (data && data.data) || [];
    for (const it of rows) {
      const meta = {
        assetId: it.id,
        itemType: it.itemType,
        assetType: it.assetType,
        productId: it.productId,
        collectibleItemId: it.collectibleItemId,
        name: it.name,
        price: it.price != null ? it.price : it.lowestPrice,
        creatorName: it.creatorName
      };
      cachePut('a' + it.id, meta);
      if (it.productId != null) cachePut('p' + it.productId, meta);
      if (it.collectibleItemId) cachePut('c' + it.collectibleItemId, meta);
    }
  }

  function captureThumbnails(data) {
    const rows = (data && data.data) || [];
    for (const t of rows) {
      if (t.targetId && t.imageUrl) cachePut('a' + t.targetId, { thumb: t.imageUrl });
    }
  }

  // ---------- 5. INTERCEPTION RÉSEAU ----------
  // Un motif trop précis rate les endpoints d'achat que Roblox renomme, et la
  // requête part alors pour de vrai. Le tri repose donc sur la méthode — un
  // achat est toujours un POST — plutôt que sur une liste d'URL exactes.
  // L'URL doit se *terminer* par l'acte d'achat. Un simple « contient
  // purchase » attrapait aussi la requête émise à l'ouverture de la fenêtre,
  // d'où un achat déclenché avant même le clic sur le bouton bleu.
  const PURCHASE_URL_RE =
    /\/(?:purchase|purchase-item|buy)\/?(?:\?|$)|\/purchases\/products\/\d+\/?(?:\?|$)/i;

  // À défaut, une URL qui parle d'achat dont le corps porte un prix.
  const PURCHASE_BODY_RE = /(expectedPrice|collectibleItemId|expectedCurrency|expectedSellerId)/i;

  // Ces chemins-là contiennent « purchase » sans être des achats.
  const NOT_PURCHASE_RE = /(details|resellers|resale|history|eligib|can-purchase|purchasable)/i;

  const CURRENCY_PATTERNS = [
    /economy\.roblox\.com\/v1\/user\/currency/,
    /economy\.roblox\.com\/v1\/users\/\d+\/currency/,
    /apis\.roblox\.com\/[^?]*\/currency\b/,
    /\/v1\/users\/\d+\/currency\/?(\?|$)/
  ];

  // La méthode compte autant que l'URL : un GET ne peut pas être un achat, et
  // c'est ce qui protège l'affichage du marketplace.
  function isPurchase(url, method, body) {
    if (!state.enabled) return false;
    if (String(method).toUpperCase() !== 'POST') return false;
    if (NOT_PURCHASE_RE.test(url)) return false;
    if (PURCHASE_URL_RE.test(url)) return true;
    return /purchase/i.test(url) && PURCHASE_BODY_RE.test(String(body || ''));
  }

  // Sans console sur iPad, ce journal est le seul moyen de voir quelle requête
  // Roblox envoie vraiment au moment d'un achat. Il est conservé d'un
  // chargement à l'autre, puisque la page se recharge juste après.
  function logRequest(url, method, traite) {
    if (String(method).toUpperCase() !== 'POST') return;
    if (!/roblox\.com/.test(url)) return;
    state.netLog = (state.netLog || []).slice(-14);
    state.netLog.push({ u: String(url).slice(0, 220), traite: !!traite, at: new Date().toISOString() });
    save();
    renderPanel();
  }
  const isCurrency = (url) => state.enabled && CURRENCY_PATTERNS.some(re => re.test(url));

  // Filtre d'entrée bon marché, appliqué avant toute lecture de corps.
  function mightTransform(url) {
    if (!state.enabled) return false;
    if (!/roblox\.com/.test(url)) return false;
    return INTERESTING.test(url) || IS_OWNED_RE.test(url);
  }

  // Toute réponse JSON qui nous intéresse passe ici, quel que soit le transport.
  const INTERESTING =
    /(economy|users|thumbnails|inventory|catalog|friends|apis|accountsettings|auth|twostepverification|badges|groups|avatar|games|premiumfeatures)\.roblox\.com/;

  function transform(url, text) {
    if (!state.enabled || typeof text !== 'string' || !text) return text;
    // Roblox émet beaucoup de requêtes : on écarte tout de suite ce qui ne nous
    // concerne pas, plutôt que de tenter un JSON.parse à chaque réponse.
    if (url.includes('roblox.com') && !INTERESTING.test(url)) return text;

    // « is-owned » répond un booléen nu : sa réponse commence par « f » ou
    // « t », et le préfiltre JSON la rejetait, ce qui rendait cette branche
    // inatteignable.
    const estOwned = IS_OWNED_RE.test(url);
    const c = text.charCodeAt(0);
    if (c !== 123 && c !== 91 && !estOwned) return text;   // ni « { » ni « [ » : pas du JSON

    if (estOwned) {
      const id = url.match(IS_OWNED_RE)[1];
      if (ownsAsset(id)) return 'true';
      return text;
    }

    let data;
    try { data = JSON.parse(text); } catch { return text; }
    if (data === null || typeof data !== 'object') return text;

    let touched = false;

    // -- caches passifs --
    if (/catalog\.roblox\.com\/v1\/catalog\/items\/details/.test(url)) captureCatalogDetails(data);

    // -- articles acquis en mode test : signalés possédés dans leurs détails --
    if (/(catalog|marketplace-items|marketplace-sales)[^?]*\/(details|items)/i.test(url) &&
        Array.isArray(data.data)) {
      for (const row of data.data) {
        if (row && row.id != null && ownsAsset(row.id) && row.owned !== true) {
          row.owned = true;
          touched = true;
        }
      }
    }
    if (/thumbnails\.roblox\.com\/v1\/assets\b/.test(url)) captureThumbnails(data);

    // -- vérification en deux étapes / code PIN --
    if (neutraliseSecurite(url, data)) touched = true;

    // -- solde --
    if (isCurrency(url) && 'robux' in data) {
      data.robux = state.balance;
      touched = true;
    }

    // -- identité --
    if (spoofOn()) touched = spoofResponse(url, data) || touched;

    // -- inventaire --
    if (injectInventory(url, data)) touched = true;

    // -- tenue portée --
    if (injectWearing(url, data)) touched = true;

    // -- transactions --
    if (injectTransactions(url, data)) touched = true;
    if (injectTotals(url, data)) touched = true;

    return touched ? JSON.stringify(data) : text;
  }

  // Deux protections différentes, à traiter en sens opposés — c'est le piège :
  //
  //   • le code PIN, s'il est armé, fait apparaître une demande de saisie ;
  //     on le déclare donc inactif et déverrouillé ;
  //   • la vérification en deux étapes, elle, doit être CONFIGURÉE pour que
  //     Roblox autorise l'achat d'un objet limité. La déclarer inactive
  //     provoque « Vérification en 2 étapes requise » et bloque tout. On la
  //     déclare donc configurée et satisfaite.
  //
  // Le réglage réel du compte n'est pas modifié : seule la réponse lue par la
  // page l'est, et en mode test aucune requête ne part vers Roblox de toute façon.
  const SECURITY_RE =
    /(two-?step-?verification|twostepverification|\/account\/pin|\/challenge\/v\d|user-settings)/i;

  const VRAI_SI = /^(is)?(two-?step|2sv|twostepverification|twoStepVerification)/i;
  const FAUX_SI = /pin/i;

  function neutraliseSecurite(url, data) {
    if (!SECURITY_RE.test(url)) return false;
    let touched = false;

    // Code PIN : inactif, et déverrouillé pour l'heure qui vient.
    if (/\/account\/pin/i.test(url)) {
      data.isEnabled = false;
      data.unlockedUntil = Math.floor(Date.now() / 1000) + 3600;
      return true;
    }

    // Vérification en deux étapes : configurée et active.
    if (/two-?step-?verification/i.test(url)) {
      if ('methods' in data || Array.isArray(data.methods)) {
        data.methods = [{ mediaType: 'Authenticator', enabled: true, updated: new Date().toISOString() }];
      }
      if ('primaryMediaType' in data) data.primaryMediaType = 'Authenticator';
      for (const cle of ['isEnabled', 'enabled', 'twoStepVerificationEnabled', 'isTwoStepVerificationEnabled']) {
        if (cle in data) data[cle] = true;
      }
      return true;
    }

    // Un défi présenté au milieu d'une action : on le déclare franchi.
    if (/\/challenge\/v\d/i.test(url)) {
      for (const cle of ['challengeRequired', 'required', 'isRequired']) {
        if (cle in data && data[cle] !== false) { data[cle] = false; touched = true; }
      }
      return touched;
    }

    // Réglages du compte : un même objet peut porter les deux protections.
    for (const cle of Object.keys(data)) {
      if (typeof data[cle] !== 'boolean') continue;
      if (VRAI_SI.test(cle) && data[cle] !== true) { data[cle] = true; touched = true; }
      else if (FAUX_SI.test(cle) && /enabled|required/i.test(cle) && data[cle] !== false) {
        data[cle] = false; touched = true;
      }
    }
    return touched;
  }

  // Certaines pages transportent l'état de la protection dans une balise meta
  // rendue côté serveur, hors de toute requête interceptable.
  function paintSecurityMeta() {
    if (!state.enabled || !document.head) return;
    document.head.querySelectorAll('meta[name*="two-step" i], meta[name*="twostep" i]')
      .forEach(m => {
        if (m.content === 'true') return;
        m.content = 'true';
      });
  }

  function spoofResponse(url, data) {
    const sp = state.spoof;
    const me = state.me;
    let touched = false;

    // Compte connecté et fiche utilisateur : on ne change que l'apparence.
    if (/users\.roblox\.com\/v1\/users\/authenticated/.test(url) ||
        (me && new RegExp('users\\.roblox\\.com/v1/users/' + me.id + '\\b').test(url))) {
      if (!me && data.id) {                      // première réponse : on note le vrai compte
        state.me = { id: data.id, name: data.name, displayName: data.displayName };
        save();
      }
      data.name = sp.name;
      data.displayName = sp.displayName;
      if ('hasVerifiedBadge' in data || sp.hasVerifiedBadge) data.hasVerifiedBadge = sp.hasVerifiedBadge;
      if ('description' in data) data.description = sp.description || data.description;
      touched = true;
    }

    // Vignettes d'avatar : on substitue l'image du profil emprunté.
    if (me && /thumbnails\.roblox\.com\/v1\/users\/(avatar|avatar-headshot|avatar-bust)/.test(url)) {
      const img = /headshot|bust/.test(url) ? (sp.headshotUrl || sp.avatarUrl) : (sp.avatarUrl || sp.headshotUrl);
      for (const row of (data.data || [])) {
        if (String(row.targetId) === String(me.id) && img) {
          row.imageUrl = img;
          row.state = 'Completed';
          touched = true;
        }
      }
    }

    // Listes de noms (barre de navigation, recherche d'amis…).
    if (me && Array.isArray(data.data)) {
      for (const row of data.data) {
        if (row && String(row.id) === String(me.id)) {
          row.name = sp.name;
          row.displayName = sp.displayName;
          row.hasVerifiedBadge = sp.hasVerifiedBadge;
          touched = true;
        }
      }
    }

    return touched;
  }

  const ownsAsset = (assetId) =>
    state.owned.some(it => String(it.assetId) === String(assetId));

  // Tous hôtes et toutes versions : c'est le chemin qui identifie l'endpoint.
  const IS_OWNED_RE = /\/users\/\d+\/items\/[\w-]+\/([\w-]+)\/is-owned/i;

  function injectInventory(url, data) {
    const m = url.match(/inventory\.roblox\.com\/v\d\/users\/(\d+)\/inventory(?:\/(\d+))?/);
    if (!m || !Array.isArray(data.data)) return false;
    if (state.me && String(state.me.id) !== m[1]) return false;   // pas mon inventaire

    const wanted = m[2] ? Number(m[2]) : null;
    const mine = state.owned.filter(it =>
      it.assetId && (wanted == null || Number(it.assetType) === wanted));
    if (!mine.length) return false;

    // On recopie la forme d'une entrée réelle : plus sûr que de la deviner.
    const tmpl = data.data[0] || null;
    const already = new Set(data.data.map(e => String(e.assetId)));

    const built = mine
      .filter(it => !already.has(String(it.assetId)))
      .map(it => {
        const e = tmpl ? JSON.parse(JSON.stringify(tmpl)) : {};
        e.assetId = Number(it.assetId) || it.assetId;
        e.name = it.name;
        if (e.assetType && typeof e.assetType === 'object') e.assetType.id = it.assetType;
        else e.assetType = it.assetType;
        e.created = e.updated = it.at;
        return e;
      });

    if (!built.length) return false;
    data.data = built.concat(data.data);
    return true;
  }

  // -- achats --
  function extractBody(body) {
    try { return typeof body === 'string' ? JSON.parse(body) : (body || {}); }
    catch { return {}; }
  }

  function resolveItem(url, body, fallbackPrice) {
    const b = extractBody(body);
    const keys = [];

    const p = url.match(/\/v1\/purchases\/products\/(\d+)/);
    if (p) keys.push('p' + p[1]);
    const c = url.match(/marketplace-sales\/v\d+\/item\/([\w-]+)/);
    if (c) keys.push('c' + c[1]);
    if (b.collectibleItemId) keys.push('c' + b.collectibleItemId);
    if (b.assetId) keys.push('a' + b.assetId);

    // Repli : l'article de la page courante.
    const onPage = location.pathname.match(/\/(?:catalog|bundles|library)\/(\d+)/);
    if (onPage) keys.push('a' + onPage[1]);

    let meta = null;
    for (const k of keys) {
      const hit = itemCache.get(k);
      if (hit && hit.assetId) { meta = hit; break; }
    }
    // Les vignettes arrivent par un appel distinct, rangé sous la clé de l'article.
    if (meta && !meta.thumb) {
      const parAsset = itemCache.get('a' + meta.assetId);
      if (parAsset && parAsset.thumb) meta = Object.assign({}, meta, { thumb: parAsset.thumb });
    }

    const price = Number(
      b.expectedPrice != null ? b.expectedPrice
      : b.price != null ? b.price
      : (meta && meta.price) != null ? meta.price
      : fallbackPrice
    ) || 0;

    return {
      assetId: meta ? meta.assetId : (onPage ? Number(onPage[1]) : null),
      assetType: meta ? meta.assetType : null,
      itemType: meta ? meta.itemType : 'Asset',
      productId: (meta && meta.productId) || (p ? Number(p[1]) : null),
      collectibleItemId: (meta && meta.collectibleItemId) || (c ? c[1] : null),
      name: (meta && meta.name) || pageItemName() || 'Simulated item',
      creatorName: (meta && meta.creatorName) || '',
      thumb: (meta && meta.thumb) || '',
      price,
      url,
      at: new Date().toISOString()
    };
  }

  function pageItemName() {
    const h = document.querySelector('#item-container h1, .item-name-container h1, h1');
    return h ? h.textContent.trim() : '';
  }

  function applyPurchase(url, body, fallbackPrice) {
    const item = resolveItem(url, body, fallbackPrice);
    recordPurchase(item);
    if (state.reloadAfterPurchase) scheduleReload(url);
    return item;
  }

  function recordPurchase(item) {
    ecrire({
      kind: 'Purchase',
      name: item.name,
      amount: -item.price,
      assetId: item.assetId,
      agentName: item.creatorName || 'Roblox',
      detailType: item.itemType || 'Asset'
    });
    state.balance = Math.max(0, state.balance - item.price);
    if (!item.assetId || !ownsAsset(item.assetId)) state.owned.push(item);
    save();
    paintBalance();
    renderPanel();
    console.log('[TEST MODE] simulated purchase', item);
    return item;
  }

  const isWorn = (assetId) => state.wearing.some(id => String(id) === String(assetId));

  function toggleWear(assetId, porter) {
    const id = String(assetId);
    state.wearing = state.wearing.filter(x => String(x) !== id);
    if (porter) state.wearing.push(id);
    save();
    renderPanel();
  }

  // Si un jour un endpoint est pris à tort pour un achat, ce garde-fou évite
  // que le site devienne inutilisable : au pire un rechargement est perdu.
  function scheduleReload(url) {
    // Le garde-fou ne vise que la répétition d'un même appel — deux achats
    // différents coup sur coup doivent tous les deux recharger.
    try {
      const cle = 'rbx_last_reload';
      const [urlPrec, tPrec] = String(sessionStorage.getItem(cle) || '|0').split('|');
      if (urlPrec === url && Date.now() - Number(tPrec) < 8000) {
        console.warn('[TEST MODE] reload skipped: same request less than 8 s ago');
        return;
      }
      sessionStorage.setItem(cle, url + '|' + Date.now());
    } catch { /* stockage de session indisponible */ }

    // On laisse la confirmation de Roblox s'afficher avant de recharger.
    setTimeout(() => location.reload(), RELOAD_DELAY);
  }

  // Deux formats de réponse coexistent selon l'endpoint d'achat. Un champ en
  // trop est sans effet ; un champ manquant fait lever une exception au script
  // de Roblox, qui laisse alors sa fenêtre modale ouverte et la page bloquée.
  // On renvoie donc la réunion des deux formats.
  // Roblox ignore l'existence de nos articles : lui demander de les porter
  // renverrait une erreur. On répond nous-mêmes pour ceux-là, et on laisse
  // passer les vrais, pour que l'avatar réel continue de fonctionner.
  const WEAR_RE = /avatar\.roblox\.com\/v\d+\/avatar\/assets\/(\d+)\/(wear|remove)\b/i;
  const SET_WEARING_RE = /avatar\.roblox\.com\/v\d+\/avatar\/set-wearing-assets\b/i;

  function handleWear(url, method) {
    if (!state.enabled || String(method).toUpperCase() !== 'POST') return null;
    const m = url.match(WEAR_RE);
    if (!m || !ownsAsset(m[1])) return null;      // article réel : on ne s'en mêle pas
    toggleWear(m[1], m[2].toLowerCase() === 'wear');
    return JSON.stringify({ success: true, invalidAssetIds: [], testMode: true });
  }

  // « set-wearing-assets » envoie la tenue complète. On en retire nos articles
  // avant de laisser partir la requête, sinon Roblox rejetterait l'ensemble.
  function splitWearing(url, method, body) {
    if (!state.enabled || String(method).toUpperCase() !== 'POST') return null;
    if (!SET_WEARING_RE.test(url)) return null;

    let data;
    try { data = JSON.parse(body); } catch { return null; }
    if (!data || !Array.isArray(data.assetIds)) return null;

    const miens = data.assetIds.filter(id => ownsAsset(id)).map(String);
    const vrais = data.assetIds.filter(id => !ownsAsset(id));
    if (!miens.length) return null;

    state.wearing = miens;
    save();
    renderPanel();

    return JSON.stringify(Object.assign({}, data, { assetIds: vrais }));
  }

  // Les articles simulés portés sont ajoutés à la tenue que renvoie Roblox.
  function injectWearing(url, data) {
    if (!/avatar\.roblox\.com\/v\d+\/(?:users\/\d+\/)?avatar\b/.test(url)) return false;
    if (!Array.isArray(data.assets)) return false;

    const portes = state.owned.filter(it => it.assetId && isWorn(it.assetId));
    if (!portes.length) return false;

    const modele = data.assets[0] || null;
    const deja = new Set(data.assets.map(a => String(a.id)));
    let touched = false;

    for (const it of portes) {
      if (deja.has(String(it.assetId))) continue;
      const e = modele ? JSON.parse(JSON.stringify(modele)) : {};
      e.id = Number(it.assetId) || it.assetId;
      e.name = it.name;
      if (e.assetType && typeof e.assetType === 'object') e.assetType.id = it.assetType;
      else e.assetType = { id: it.assetType, name: '' };
      data.assets.push(e);
      touched = true;
    }
    return touched;
  }

  const purchaseResponseBody = (item) => JSON.stringify({
    purchased: true,
    reason: 'Success',
    purchaseResult: 'Success',
    statusCode: 200,
    title: '',
    errorMsg: '',
    errorMessage: null,
    showDivId: 'ItemPurchased',
    shortfallPrice: 0,
    balanceAfterSale: state.balance,
    expectedPrice: item.price,
    price: item.price,
    currency: 1,
    productId: item.productId || 0,
    assetId: item.assetId || 0,
    assetName: item.name,
    assetType: item.assetType || 0,
    assetTypeDisplayName: '',
    assetIsWearable: true,
    collectibleItemId: item.collectibleItemId || null,
    sellerName: item.creatorName || 'Roblox',
    transactionVerb: 'bought',
    isMultiPrivateSale: false,
    quantity: 1,
    transactionId: 'testmode-' + item.at,
    testMode: true          // marqueur laissé volontairement dans la réponse
  });

  // --- fetch ---
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = String((init && init.method) || (input && input.method) || 'GET');

    const tenue = handleWear(url, method);
    if (tenue) {
      return new Response(tenue, { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    const corpsFiltre = splitWearing(url, method, init && init.body);
    if (corpsFiltre) init = Object.assign({}, init, { body: corpsFiltre });

    const achat = isPurchase(url, method, init && init.body);
    logRequest(url, method, achat);

    if (achat) {
      const item = applyPurchase(url, init && init.body, 0);
      return new Response(purchaseResponseBody(item), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }

    const cible = spoofUrl(url);
    const args = cible === url
      ? arguments
      : [typeof input === 'string' ? cible : new Request(cible, input), init];

    const res = await origFetch.apply(this, args);

    // Lire le corps de *chaque* réponse coûte cher — c'est ce qui ralentissait
    // le marketplace. On ne clone que ce qu'on est susceptible de réécrire.
    if (!mightTransform(cible)) return res;

    try {
      const text = await res.clone().text();
      const patched = transform(cible, text);
      if (patched !== text) {
        return new Response(patched, {
          status: res.status, statusText: res.statusText, headers: res.headers
        });
      }
    } catch { /* corps binaire ou déjà consommé : on laisse passer */ }

    return res;
  };

  // --- XMLHttpRequest (axios) ---
  const XHR = window.XMLHttpRequest;
  const origOpen = XHR.prototype.open;
  const origSend = XHR.prototype.send;

  XHR.prototype.open = function (method, url) {
    this.__rbxMethod = String(method || 'GET');
    this.__rbxUrl = spoofUrl(String(url || ''));

    // Écouteur posé dès open() : il s'exécute donc avant ceux d'axios,
    // qui n'assigne ses handlers qu'entre open() et send().
    this.addEventListener('readystatechange', () => {
      if (this.readyState !== 4 || this.status !== 200) return;
      if (!mightTransform(this.__rbxUrl)) return;
      if (this.responseType && this.responseType !== 'text' && this.responseType !== 'json') return;
      try {
        const raw = this.responseText;
        const patched = transform(this.__rbxUrl, raw);
        if (patched === raw) return;
        Object.defineProperty(this, 'responseText', { configurable: true, get: () => patched });
        Object.defineProperty(this, 'response', {
          configurable: true,
          get: () => (this.responseType === 'json' ? JSON.parse(patched) : patched)
        });
      } catch { /* réponse illisible : on ne touche à rien */ }
    });

    const reste = Array.prototype.slice.call(arguments, 2);
    return origOpen.call(this, method, this.__rbxUrl, ...reste);
  };

  XHR.prototype.send = function (body) {
    const url = this.__rbxUrl || '';

    const tenue = handleWear(url, this.__rbxMethod);
    if (tenue) {
      fakeXhrResponse(this, tenue);
      return;
    }

    const corpsFiltre = splitWearing(url, this.__rbxMethod, body);
    if (corpsFiltre) body = corpsFiltre;

    const achat = isPurchase(url, this.__rbxMethod, body);
    logRequest(url, this.__rbxMethod, achat);

    if (achat) {
      // On ne laisse PAS partir la requête : on fabrique la réponse.
      const item = applyPurchase(url, body, 0);
      fakeXhrResponse(this, purchaseResponseBody(item));
      return;
    }

    // .apply(arguments) enverrait le corps d'origine : en mode strict,
    // « arguments » n'est plus lié aux paramètres nommés.
    return origSend.call(this, body);
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
      // dispatchEvent déclenche déjà les gestionnaires posés en propriété
      // (onload, onreadystatechange) : les appeler en plus ferait traiter
      // l'achat deux fois, ce qui laissait la fenêtre modale bloquée.
      for (const type of ['readystatechange', 'load', 'loadend']) {
        xhr.dispatchEvent(new Event(type));
      }
    }, 0);
  }

  // ---------- 6. INVENTAIRE (DOM) ----------
  // L'injection dans la réponse d'API suffit quand la page consomme cette API.
  // Ces cartes sont le filet de sécurité : elles s'ajoutent à la vraie grille.
  const INVENTORY_RE = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:users\/\d+\/inventory|my\/inventory)/i;
  const isInventoryPage = () => INVENTORY_RE.test(location.pathname);

  const GRID_SELECTORS = [
    '.item-cards-stackable', '.item-cards', '.hlist.item-cards',
    '[data-testid="inventory-item-list"]', '.inventory-container .item-cards'
  ].join(', ');

  function paintInventory() {
    if (!state.enabled || !isInventoryPage() || !state.owned.length) return;
    const grid = document.querySelector(GRID_SELECTORS);
    if (!grid) return;

    for (const it of state.owned) {
      const key = String(it.assetId || it.at);
      if (grid.querySelector('[data-rbx-item="' + CSS.escape(key) + '"]')) continue;

      const card = document.createElement('div');
      card.className = 'rbx-tm-inv-card';
      card.dataset.rbxItem = key;
      card.title = 'Simulated item — test mode';
      card.innerHTML =
        (it.thumb ? '<img src="' + esc(it.thumb) + '" alt="" />' : '<img alt="" />') +
        '<div class="rbx-tm-inv-body">' +
          '<div class="rbx-tm-inv-name">' + esc(it.name) + '</div>' +
          '<div class="rbx-tm-inv-price">' + ROBUX_ICON + ' ' + fmt(it.price) + '</div>' +
        '</div>';
      grid.insertBefore(card, grid.firstChild);
    }
  }

  // ---------- 5 bis. REGISTRE DES TRANSACTIONS ----------
  // Le solde n'est pas un nombre posé à côté d'un historique décoratif : il est
  // la somme du registre. Tout mouvement y est inscrit, donc la page des
  // transactions et le solde ne peuvent pas se contredire.

  // Générateur reproductible : deux appels avec la même graine donnent le même
  // historique, ce qui évite qu'il change à chaque rechargement.
  function alea(graine) {
    let a = graine >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Articles connus du catalogue, avec des prix de l'ordre des vrais.
  const ARTICLES_FICTIFS = [
    ['Valkyrie Helm', 259997], ['Sparkle Time Fedora', 78000], ['Red Iron Horns', 165],
    ['Clockwork\'s Headphones', 189000], ['Frozen Horns of the Frigid Planes', 899],
    ['Bluesteel Egg of Genesis', 47500], ['Rainbow Shaggy', 1200],
    ['Black Iron Command Helm', 32000], ['Beautiful Hair for Beautiful People', 250],
    ['Dominus Empyreus', 1000000], ['Shaggy', 750], ['Cardboard Cutout', 45],
    ['Robloxian 2.0 Package', 350], ['Korblox Deathspeaker', 17000],
    ['Headless Head', 31000], ['Purple Banded Top Hat', 5500],
    ['Perfectly Legitimate Business Hat', 2400], ['Telamon\'s Chicken Suit', 1500],
    ['Silverthorn Antlers', 25000], ['White Sparkle Time Fedora', 100000],
    ['Midnight Blue Sparkle Time Fedora', 46000], ['Ghosdeeri', 12500]
  ];

  const PALIERS_ROBUX = [400, 800, 1700, 4500, 10000, 22500];

  let idRegistre = Date.now();
  const prochainId = () => ++idRegistre;

  function ecrire(entree) {
    state.ledger.push(Object.assign({ id: prochainId(), created: new Date().toISOString() }, entree));
    if (state.ledger.length > 400) state.ledger = state.ledger.slice(-400);
  }

  // Historique de départ : des dépenses crédibles, et les crédits qui vont avec,
  // de sorte que la somme du registre retombe exactement sur le solde affiché.
  function genererHistorique(solde) {
    const r = alea(Math.floor(solde) ^ 0x5f3759df);
    const maintenant = Date.now();
    const AN = 365 * 24 * 3600 * 1000;
    const entrees = [];

    const quand = (fraction) =>
      new Date(maintenant - Math.floor(fraction * AN)).toISOString();

    // --- Dépenses : entre la moitié et 90 % du solde ---
    const cibleDepense = Math.round(solde * (0.5 + r() * 0.4));
    let depense = 0;
    let garde = 0;
    const vus = {};   // acheter deux fois le même objet de collection ferait faux
    while (depense < cibleDepense && garde++ < 300) {
      const [nom, prix] = ARTICLES_FICTIFS[Math.floor(r() * ARTICLES_FICTIFS.length)];
      if (vus[nom]) continue;
      if (depense + prix > cibleDepense * 1.02) continue;
      vus[nom] = true;
      depense += prix;
      entrees.push({
        id: prochainId(), created: quand(r()), kind: 'Purchase',
        name: nom, amount: -prix, agentName: 'Roblox', detailType: 'Asset'
      });
    }

    // --- Crédits : abonnement mensuel, achats de Robux, puis un versement de
    // groupe pour le reliquat, ce qui est le cas d'un gros solde. ---
    const cibleCredit = depense + solde;
    let credit = 0;

    for (let mois = 1; mois <= 12 && credit < cibleCredit; mois++) {
      credit += 2200;
      entrees.push({
        id: prochainId(), created: quand(mois / 12), kind: 'PremiumStipend',
        name: 'Premium Stipend', amount: 2200, agentName: 'Roblox', detailType: 'Currency'
      });
    }

    for (let i = 0; i < 12 && credit < cibleCredit; i++) {
      const palier = PALIERS_ROBUX[Math.floor(r() * PALIERS_ROBUX.length)];
      if (credit + palier > cibleCredit) break;
      credit += palier;
      entrees.push({
        id: prochainId(), created: quand(r()), kind: 'CurrencyPurchase',
        name: palier.toLocaleString('en-US') + ' Robux', amount: palier,
        agentName: 'Roblox', detailType: 'Currency'
      });
    }

    // Le reliquat part en versements de groupe étalés sur l'année : un seul
    // virement de plusieurs millions ne ressemblerait à rien.
    let reste = cibleCredit - credit;
    const parts = 4 + Math.floor(r() * 5);
    for (let i = 0; i < parts && reste > 0; i++) {
      const dernier = i === parts - 1;
      const part = dernier ? reste
        : Math.min(reste, Math.round((reste / (parts - i)) * (0.6 + r() * 0.8)));
      if (part <= 0) continue;
      reste -= part;
      entrees.push({
        id: prochainId(), created: quand((i + 0.5) / parts), kind: 'GroupPayout',
        name: 'Group Payout', amount: part, agentName: 'Roblox', detailType: 'Currency'
      });
    }
    if (reste > 0) {
      entrees.push({
        id: prochainId(), created: quand(0.99), kind: 'GroupPayout',
        name: 'Group Payout', amount: reste, agentName: 'Roblox', detailType: 'Currency'
      });
    }

    entrees.sort((a, b) => new Date(b.created) - new Date(a.created));
    return entrees;
  }

  function ensureLedger() {
    if (state.ledger.length) return;
    state.ledger = genererHistorique(state.balance);
    save();
  }

  // Le solde reste la référence : tout écart est inscrit plutôt que masqué.
  function ajusterRegistre(avant, apres, motif) {
    const ecart = apres - avant;
    if (!ecart) return;
    ecrire({
      kind: ecart > 0 ? 'CurrencyPurchase' : 'Purchase',
      name: motif, amount: ecart, agentName: 'Roblox', detailType: 'Currency'
    });
  }

  const TRANSACTIONS_RE = /economy\.roblox\.com\/v\d+\/users\/\d+\/transactions\b/i;
  const TOTALS_RE = /economy\.roblox\.com\/v\d+\/users\/\d+\/transaction-totals\b/i;

  const TYPE_PAR_ONGLET = {
    purchase: ['Purchase'],
    sale: ['Sale'],
    currencypurchase: ['CurrencyPurchase'],
    premiumstipend: ['PremiumStipend'],
    grouppayout: ['GroupPayout']
  };

  function entreeApi(e) {
    return {
      id: e.id,
      created: e.created,
      isPending: false,
      agent: { id: 1, type: 'User', name: e.agentName || 'Roblox' },
      details: { id: e.assetId || 0, name: e.name, type: e.detailType || 'Asset' },
      currency: { amount: e.amount, type: 'Robux' }
    };
  }

  function injectTransactions(url, data) {
    if (!TRANSACTIONS_RE.test(url) || !Array.isArray(data.data)) return false;
    ensureLedger();

    const params = new URLSearchParams((url.split('?')[1] || ''));
    const onglet = String(params.get('transactionType') || 'Purchase').toLowerCase();
    const voulus = TYPE_PAR_ONGLET[onglet];

    let lignes = state.ledger.slice().sort((a, b) => new Date(b.created) - new Date(a.created));
    if (voulus) lignes = lignes.filter(e => voulus.indexOf(e.kind) !== -1);

    const limite = Math.min(Number(params.get('limit')) || 10, 100);
    const depart = Number(params.get('cursor')) || 0;
    const page = lignes.slice(depart, depart + limite);

    data.data = page.map(entreeApi);
    data.previousPageCursor = depart > 0 ? String(Math.max(0, depart - limite)) : null;
    data.nextPageCursor = depart + limite < lignes.length ? String(depart + limite) : null;
    return true;
  }

  function injectTotals(url, data) {
    if (!TOTALS_RE.test(url)) return false;
    ensureLedger();

    const somme = (kinds, signe) => state.ledger
      .filter(e => kinds.indexOf(e.kind) !== -1 && (signe > 0 ? e.amount > 0 : e.amount < 0))
      .reduce((t, e) => t + e.amount, 0);

    const depenses = somme(['Purchase'], -1);
    const achatsRobux = somme(['CurrencyPurchase'], 1);
    const abonnement = somme(['PremiumStipend'], 1);
    const versements = somme(['GroupPayout'], 1);

    // On écrase les champs connus sans toucher aux autres : la forme exacte de
    // cette réponse varie, et un champ inventé vaut mieux qu'un champ perdu.
    Object.assign(data, {
      salesTotal: 0,
      purchasesTotal: depenses,
      currencyPurchasesTotal: achatsRobux,
      premiumStipendsTotal: abonnement,
      groupPayoutsTotal: versements,
      incomingRobuxTotal: achatsRobux + abonnement + versements,
      outgoingRobuxTotal: depenses
    });
    return true;
  }

  // ---------- 6 bis. ÉTAT « POSSÉDÉ » SUR LA PAGE D'UN ARTICLE ----------
  // L'API suffit quand la page l'interroge ; ceci couvre le cas où le bouton
  // est rendu côté serveur, et c'est ce que l'on voit juste après l'achat,
  // puisque la page se recharge.
  const ITEM_PAGE_RE = /\/(?:catalog|bundles|library)\/(\d+)/;

  // On ne se fie pas à une classe : le libellé du bouton est plus stable.
  const ACTION_TEXT_RE = /^(buy|get|add to cart|acheter|obtenir|ajouter au panier)\b/i;
  const CREATOR_RE = /^(by|par)\s+.{1,40}$/i;

  function paintOwned() {
    if (!state.enabled || !document.body) return;
    const surLaPage = location.pathname.match(ITEM_PAGE_RE);
    if (!surLaPage || !ownsAsset(surLaPage[1])) return;

    ownedBadge();
    ownedArea();
  }

  // « ✔ Item Owned » à côté de la ligne du créateur, comme sur le vrai site.
  function ownedBadge() {
    if (document.querySelector('.rbx-tm-owned-badge')) return;

    const candidats = [];
    for (const el of document.querySelectorAll('span, div, p, a, h2')) {
      if (el.closest('#' + PANEL_ID)) continue;
      const texte = normalise(el.textContent);
      if (texte.length > 60 || !CREATOR_RE.test(texte)) continue;
      if (!estVisible(el)) continue;                     // masqué : le badge y serait invisible
      // On veut la ligne elle-même, pas un conteneur qui l'englobe.
      if (Array.prototype.some.call(el.querySelectorAll('span, div, p, a, h2'),
            e => CREATOR_RE.test(normalise(e.textContent)))) continue;
      candidats.push(el);
    }
    if (!candidats.length) return;

    // Une ligne « By … » peut exister ailleurs dans la page ; celle de
    // l'article est la première qui suit son titre.
    const titre = document.querySelector('h1');
    const choisi = (titre && candidats.find(el =>
      titre.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)) || candidats[0];

    choisi.insertAdjacentHTML('beforeend',
      '<span class="rbx-tm-owned-badge">' + CHECK_ICON + '<span>Item Owned</span></span>');
  }

  // La zone d'achat cède la place à « This item is available in your inventory. »
  function ownedArea() {
    if (document.getElementById('rbx-tm-owned')) return;

    const boutons = Array.prototype.filter.call(
      document.querySelectorAll('button, a[role="button"], [data-testid*="purchase" i]'),
      el => !el.closest('#' + PANEL_ID) && ACTION_TEXT_RE.test(normalise(el.textContent)));
    if (!boutons.length) return;

    for (const b of boutons) b.style.display = 'none';

    const inventaire = state.me
      ? 'https://www.roblox.com/users/' + state.me.id + '/inventory'
      : 'https://www.roblox.com/my/inventory';

    const bloc = document.createElement('div');
    bloc.id = 'rbx-tm-owned';
    bloc.innerHTML =
      '<div class="rbx-tm-owned-row">' +
        '<span class="rbx-tm-owned-text">This item is available in your inventory.</span>' +
        '<a class="rbx-tm-owned-btn" href="' + inventaire + '">Inventory</a>' +
      '</div>';

    const ancre = boutons[0];
    ancre.parentElement.insertBefore(bloc, ancre);
  }

  // ---------- 6 ter. FENÊTRE DE VÉRIFICATION EN DEUX ÉTAPES ----------
  // Les deux réponses possibles bloquent : « non configurée » fait afficher
  // « configure-la d'abord », « configurée » fait réclamer un code. Comme
  // aucune requête ne part vers Roblox, ce code ne validerait rien de toute
  // façon. On conclut donc l'achat nous-mêmes et on referme la fenêtre.
  //
  // Restreint aux pages d'article : ailleurs, cette fenêtre protège de vraies
  // opérations sur le compte et doit être laissée intacte.
  const TWOSTEP_RE =
    /(2-step verification|two-step verification|vérification en 2 étapes|6-digit code|code à 6 chiffres)/i;

  const MODAL_SELECTORS = '[role="dialog"], .modal-content, .modal-dialog, [class*="modal" i]';

  function bypassTwoStep() {
    if (!state.enabled) return;
    const surLaPage = location.pathname.match(ITEM_PAGE_RE);
    if (!surLaPage) return;

    let modale = null;
    for (const el of document.querySelectorAll(MODAL_SELECTORS)) {
      if (el.dataset.rbxTwoStep || el.closest('#' + PANEL_ID) || !estVisible(el)) continue;
      if (!TWOSTEP_RE.test(normalise(el.textContent))) continue;
      modale = el;
      break;
    }
    if (!modale) return;
    modale.dataset.rbxTwoStep = '1';

    console.log('[TEST MODE] 2-step prompt bypassed, completing the simulated purchase');

    // L'article de la page suffit : le prix vient du cache rempli en naviguant.
    const item = resolveItem(location.pathname, null, 0);
    if (!ownsAsset(item.assetId)) recordPurchase(item);

    fermerModale(modale);
    if (state.reloadAfterPurchase) scheduleReload('twostep:' + surLaPage[1]);
  }

  function fermerModale(modale) {
    // On ne clique aucun bouton : « Verify » partirait vers Roblox. On retire
    // la fenêtre et le voile qui bloque les clics.
    const voile = modale.closest('[class*="overlay" i], [class*="backdrop" i]') || modale;
    voile.remove();
    document.querySelectorAll('[class*="backdrop" i], [class*="overlay" i]').forEach(el => {
      if (estVisible(el) && !el.querySelector('#' + PANEL_ID)) el.remove();
    });
    document.body.style.overflow = '';
  }

  // ---------- 7. PANNEAU ----------
  // Roblox préfixe ses URL par la locale : /fr/my/account, /en-us/settings…
  const SETTINGS_RE = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:my\/account|settings)/i;
  const isSettingsPage = () =>
    SETTINGS_RE.test(location.pathname) || /#!?\/(settings|info|account)/i.test(location.hash);

  const wantsPanel = () => isSettingsPage() || isInventoryPage();

  const MOUNTS = [
    '#settings-container', '.settings-container',
    '#account-settings-container', '.account-settings',
    '#my-settings-container', '.settings-content',
    '.inventory-container', '#inventory-container',
    '#content .container-main', '#container-main', '#content'
  ];

  let panelEl = null;
  let panelForced = false;   // ouvert manuellement hors des pages concernées
  let panelClosed = false;   // fermé à la croix : à respecter jusqu'à la prochaine navigation
  let lookupState = { busy: false, error: '', found: null };

  function syncTheme() {
    if (!panelEl || !panelEl.isConnected) return;
    const t = currentTheme();
    // On n'écrit que si ça change : sinon le MutationObserver se rappellerait lui-même.
    if (panelEl.dataset.rbxTheme !== t) panelEl.dataset.rbxTheme = t;
  }

  function buildPanel() {
    const el = document.createElement('div');
    el.id = PANEL_ID;
    el.innerHTML = `
      <div class="rbx-tm-card">
        <div class="rbx-tm-head">
          <h2>Robux</h2>
          <span class="rbx-tm-badge">Test mode</span>
          <button class="rbx-tm-close" type="button" title="Close">&times;</button>
        </div>
        <p class="rbx-tm-sub">Simulated balance, visible only in this browser.</p>

        <div class="rbx-tm-row">
          <span class="rbx-tm-label">Current balance</span>
          <span class="rbx-tm-right rbx-tm-amount">${ROBUX_ICON}<span data-role="current">0</span></span>
        </div>
        <div class="rbx-tm-row">
          <span class="rbx-tm-label">Set balance</span>
          <span class="rbx-tm-grow">
            <input class="rbx-tm-input" id="rbx-p-input" type="number" min="0" step="1" inputmode="numeric" />
            <button class="rbx-tm-btn rbx-tm-primary" data-act="apply" type="button">Apply</button>
          </span>
        </div>
        <div class="rbx-tm-row">
          <span class="rbx-tm-label">Add</span>
          <span class="rbx-tm-right rbx-tm-chips">
            <button class="rbx-tm-btn" data-add="1000" type="button">+1,000</button>
            <button class="rbx-tm-btn" data-add="10000" type="button">+10,000</button>
            <button class="rbx-tm-btn" data-add="100000" type="button">+100,000</button>
            <button class="rbx-tm-btn" data-add="1000000" type="button">+1,000,000</button>
            <button class="rbx-tm-btn" data-act="zero" type="button">Set to 0</button>
          </span>
        </div>
        <div class="rbx-tm-row">
          <span class="rbx-tm-label">Test mode active</span>
          <span class="rbx-tm-right">
            <label class="rbx-tm-switch"><input type="checkbox" data-act="enabled" /><i></i></label>
          </span>
        </div>
      </div>

      <div class="rbx-tm-card">
        <div class="rbx-tm-head">
          <h2>Identity</h2>
          <span class="rbx-tm-badge">Test mode</span>
        </div>
        <p class="rbx-tm-sub">Borrow a real public profile: display name, username, avatar and verified badge.</p>

        <div class="rbx-tm-row">
          <span class="rbx-tm-label">Username</span>
          <span class="rbx-tm-grow">
            <input class="rbx-tm-input" id="rbx-p-user" type="text" autocapitalize="off"
                   autocorrect="off" spellcheck="false" placeholder="e.g. Azen" />
            <button class="rbx-tm-btn rbx-tm-primary" data-act="lookup" type="button">Search</button>
          </span>
        </div>
        <div class="rbx-tm-row rbx-tm-block" data-role="ident"></div>
        <div class="rbx-tm-row">
          <span class="rbx-tm-label">Use this identity</span>
          <span class="rbx-tm-right">
            <label class="rbx-tm-switch"><input type="checkbox" data-act="spoof" /><i></i></label>
          </span>
        </div>
        <div class="rbx-tm-row">
          <span class="rbx-tm-label">My real account</span>
          <span class="rbx-tm-right" data-role="real">—</span>
        </div>
      </div>

      <div class="rbx-tm-card">
        <div class="rbx-tm-head">
          <h2>Simulated inventory</h2>
          <span class="rbx-tm-badge rbx-tm-count" data-role="count">0</span>
        </div>
        <p class="rbx-tm-sub">Items bought in test mode, kept and added to your inventory.</p>

        <div class="rbx-tm-row rbx-tm-block rbx-tm-bare">
          <div class="rbx-tm-grid" data-role="inv"></div>
          <p class="rbx-tm-empty" data-role="inv-empty">No items yet.</p>
        </div>
        <div class="rbx-tm-row">
          <span class="rbx-tm-label">Reload the page after a purchase</span>
          <span class="rbx-tm-right">
            <label class="rbx-tm-switch"><input type="checkbox" data-act="reload" /><i></i></label>
          </span>
        </div>
        <div class="rbx-tm-row">
          <span class="rbx-tm-label">History</span>
          <span class="rbx-tm-right rbx-tm-chips">
            <button class="rbx-tm-btn" data-act="clear-inv" type="button">Clear inventory</button>
            <button class="rbx-tm-btn" data-act="reset" type="button">Reset everything</button>
          </span>
        </div>
        <p class="rbx-tm-note">Local only: nothing is sent to Roblox, no real Robux is spent or credited, and no item is actually acquired.</p>
      </div>

      <div class="rbx-tm-card">
        <div class="rbx-tm-head">
          <h2>Transactions</h2>
          <span class="rbx-tm-badge rbx-tm-count" data-role="ledger-count">0</span>
        </div>
        <p class="rbx-tm-sub">A ledger whose entries add up to the balance above, so the transactions page and the balance can never disagree.</p>

        <div class="rbx-tm-row">
          <span class="rbx-tm-label">Robux earned</span>
          <span class="rbx-tm-right rbx-tm-amount">${ROBUX_ICON}<span data-role="earned">0</span></span>
        </div>
        <div class="rbx-tm-row">
          <span class="rbx-tm-label">Robux spent</span>
          <span class="rbx-tm-right rbx-tm-amount">${ROBUX_ICON}<span data-role="spent">0</span></span>
        </div>
        <div class="rbx-tm-row">
          <span class="rbx-tm-label">Ledger balance</span>
          <span class="rbx-tm-right rbx-tm-amount">${ROBUX_ICON}<span data-role="ledger-net">0</span></span>
        </div>
        <div class="rbx-tm-row">
          <span class="rbx-tm-label">History</span>
          <span class="rbx-tm-right rbx-tm-chips">
            <button class="rbx-tm-btn" data-act="regen-ledger" type="button">Regenerate</button>
          </span>
        </div>
      </div>

      <div class="rbx-tm-card">
        <div class="rbx-tm-head">
          <h2>Network log</h2>
          <span class="rbx-tm-badge rbx-tm-count" data-role="log-count">0</span>
        </div>
        <p class="rbx-tm-sub">The most recent POST requests sent to Roblox. If a purchase gets stuck, this shows whether its request was recognised or let through.</p>

        <div class="rbx-tm-row rbx-tm-block rbx-tm-bare">
          <ul class="rbx-tm-log" data-role="log"></ul>
          <p class="rbx-tm-empty" data-role="log-empty">No requests recorded.</p>
        </div>
        <div class="rbx-tm-row">
          <span class="rbx-tm-label">Log</span>
          <span class="rbx-tm-right rbx-tm-chips">
            <button class="rbx-tm-btn" data-act="clear-log" type="button">Clear</button>
          </span>
        </div>
      </div>
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
      if (btn.dataset.act === 'lookup') { doLookup(); return; }
      if (btn.dataset.wear) {
        toggleWear(btn.dataset.wear, !isWorn(btn.dataset.wear));
        return;
      }

      const soldeAvant = state.balance;

      if (btn.dataset.add) {
        state.balance = Math.max(0, state.balance + Number(btn.dataset.add));
        ajusterRegistre(soldeAvant, state.balance, 'Robux Purchase');
      } else if (btn.dataset.act === 'apply') {
        const v = Number(el.querySelector('#rbx-p-input').value);
        state.balance = Number.isFinite(v) ? Math.max(0, Math.floor(v)) : state.balance;
        ajusterRegistre(soldeAvant, state.balance, 'Balance Adjustment');
      } else if (btn.dataset.act === 'zero') {
        state.balance = 0;
        ajusterRegistre(soldeAvant, state.balance, 'Balance Adjustment');
      } else if (btn.dataset.act === 'regen-ledger') {
        state.ledger = [];
        ensureLedger();
      } else if (btn.dataset.act === 'clear-inv') {
        state.owned = [];
      } else if (btn.dataset.act === 'clear-log') {
        state.netLog = [];
      } else if (btn.dataset.act === 'reset') {
        Object.assign(state, DEFAULTS, { owned: [], wearing: [], ledger: [], me: state.me });
        lookupState = { busy: false, error: '', found: null };
      } else {
        return;
      }

      save();
      paintBalance();
      renderPanel();
    });

    el.addEventListener('change', (e) => {
      const act = e.target.dataset.act;
      if (act === 'enabled') {
        state.enabled = e.target.checked;
        save();
        if (state.enabled) paintBalance();
        else location.reload();   // revenir aux vraies valeurs demande un rechargement
      } else if (act === 'reload') {
        state.reloadAfterPurchase = e.target.checked;
        save();
      } else if (act === 'spoof') {
        const on = e.target.checked;
        if (on && !lookupState.found && !state.spoof) {
          e.target.checked = false;
          lookupState.error = 'Search for a username first.';
          renderPanel();
          return;
        }
        state.spoof = Object.assign({}, state.spoof || lookupState.found, { active: on });
        if (on && lookupState.found) state.spoof = Object.assign({}, lookupState.found, { active: true });
        save();
        location.reload();   // le site a déjà rendu l'ancien profil
      }
    });

    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (e.target.id === 'rbx-p-input') {
        e.preventDefault();
        el.querySelector('[data-act="apply"]').click();
      } else if (e.target.id === 'rbx-p-user') {
        e.preventDefault();
        doLookup();
      }
    });

    return el;
  }

  async function doLookup() {
    if (!panelEl || lookupState.busy) return;
    const input = panelEl.querySelector('#rbx-p-user');
    const username = (input.value || '').trim();
    if (!username) return;

    lookupState = { busy: true, error: '', found: null };
    renderPanel();

    try {
      lookupState.found = await lookupUser(username);
      lookupState.error = '';
    } catch (err) {
      lookupState.found = null;
      lookupState.error = err.message || 'lookup failed';
    }
    lookupState.busy = false;
    renderPanel();
  }

  function identHtml() {
    if (lookupState.busy) return '<p class="rbx-tm-empty">Searching…</p>';
    if (lookupState.error) return '<p class="rbx-tm-error">' + esc(lookupState.error) + '</p>';

    const u = lookupState.found || (state.spoof && state.spoof.active ? state.spoof : null);
    if (!u) return '<p class="rbx-tm-empty">No profile loaded.</p>';

    return '<div class="rbx-tm-ident">' +
      '<img src="' + esc(u.headshotUrl || u.avatarUrl) + '" alt="" />' +
      '<div>' +
        '<div class="rbx-tm-ident-name">' + esc(u.displayName) +
          (u.hasVerifiedBadge ? VERIFIED_ICON : '') + '</div>' +
        '<div class="rbx-tm-ident-user">@' + esc(u.name) + ' · #' + esc(u.id) + '</div>' +
        '<div class="rbx-tm-ident-stats">' +
          '<span><b>' + fmt(u.followerCount) + '</b> followers</span>' +
          '<span><b>' + fmt(u.friendCount) + '</b> friends</span>' +
        '</div>' +
      '</div></div>';
  }

  function invHtml() {
    return state.owned.slice().reverse().map(it =>
      '<div class="rbx-tm-item">' +
        (it.thumb ? '<img src="' + esc(it.thumb) + '" alt="" />' : '<img alt="" />') +
        '<div class="rbx-tm-item-body">' +
          '<div class="rbx-tm-item-name">' + esc(it.name || 'Simulated item') + '</div>' +
          '<div class="rbx-tm-item-price">' + ROBUX_ICON + fmt(it.price) + '</div>' +
          '<button type="button" class="rbx-tm-wear' + (isWorn(it.assetId) ? ' rbx-tm-on' : '') +
            '" data-wear="' + esc(it.assetId) + '">' +
            (isWorn(it.assetId) ? 'Worn' : 'Wear') + '</button>' +
        '</div>' +
      '</div>'
    ).join('');
  }

  function renderPanel() {
    if (!panelEl || !panelEl.isConnected) return;
    syncTheme();

    const q = (sel) => panelEl.querySelector(sel);

    const input = q('#rbx-p-input');
    if (document.activeElement !== input) input.value = state.balance;

    q('[data-role="current"]').textContent = fmt(state.balance);
    q('[data-act="enabled"]').checked = !!state.enabled;
    q('[data-act="reload"]').checked = !!state.reloadAfterPurchase;
    q('[data-act="spoof"]').checked = spoofOn();

    q('[data-role="ident"]').innerHTML = identHtml();
    q('[data-role="real"]').textContent = state.me
      ? state.me.displayName + ' (@' + state.me.name + ')'
      : 'not identified';

    const registre = state.ledger || [];
    const totalSi = (test) => registre.filter(test).reduce((t, e) => t + e.amount, 0);
    const gagne = totalSi(e => e.amount > 0);
    const depense = totalSi(e => e.amount < 0);
    q('[data-role="ledger-count"]').textContent = registre.length;
    q('[data-role="earned"]').textContent = fmt(gagne);
    q('[data-role="spent"]').textContent = fmt(depense);
    q('[data-role="ledger-net"]').textContent = fmt(gagne + depense);

    const journal = state.netLog || [];
    q('[data-role="log-count"]').textContent = journal.length;
    q('[data-role="log-empty"]').style.display = journal.length ? 'none' : '';
    q('[data-role="log"]').innerHTML = journal.slice().reverse().map(e =>
      '<li><span class="rbx-tm-tag ' + (e.traite ? 'rbx-tm-yes">simulated buy' : 'rbx-tm-no">let through') +
      '</span><span>' + esc(e.u.replace(/^https:\/\//, '')) + '</span></li>'
    ).join('');

    q('[data-role="count"]').textContent = state.owned.length;
    q('[data-role="inv"]').innerHTML = invHtml();
    q('[data-role="inv-empty"]').style.display = state.owned.length ? 'none' : '';
  }

  function mountPanel() {
    if (!document.body) return;

    const voulu = panelForced || (wantsPanel() && !panelClosed);
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
      // Page pas encore rendue (ou ouverture manuelle) : panneau flottant.
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

  // ---------- 8. BOUCLE D'ENTRETIEN ----------
  const tick = () => {
    paintSecurityMeta();
    paintBalance();
    paintIdentity();
    paintInventory();
    paintOwned();
    bypassTwoStep();
    mountPanel();
    syncTheme();
  };

  // React remanie le DOM en continu : réagir à chaque mutation faisait tourner
  // toute la boucle des dizaines de fois par seconde sur une page chargée,
  // comme le marketplace. On regroupe les mutations sur un court délai.
  let enAttente = 0;
  const obs = new MutationObserver(() => {
    if (enAttente) return;
    enAttente = setTimeout(() => { enAttente = 0; tick(); }, 250);
  });

  function start() {
    ensureLedger();
    ensureMe().then(() => { renderPanel(); paintIdentity(); });
    tick();
    obs.observe(document.body, { childList: true, subtree: true });
    // Filet de sécurité : certains re-rendus React ne déclenchent pas d'observation utile.
    setInterval(tick, 1500);
  }

  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);

  // ---------- 9. API CONSOLE ----------
  window.rbxTest = {
    state,
    reset() { localStorage.removeItem(STORAGE_KEY); location.reload(); },
    setBalance(n) { state.balance = Math.max(0, Number(n) || 0); save(); paintBalance(); renderPanel(); },
    panel() { panelForced = true; panelClosed = false; mountPanel(); },
    lookup: lookupUser,
    async spoof(username) {
      state.spoof = Object.assign(await lookupUser(username), { active: true });
      save();
      location.reload();
    },
    unspoof() {
      if (state.spoof) state.spoof.active = false;
      save();
      location.reload();
    }
  };
})();
