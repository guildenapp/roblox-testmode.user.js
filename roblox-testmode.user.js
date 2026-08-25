
// ==UserScript==
// @name         Roblox TEST MODE — faux solde + achats simulés
// @namespace    perso-test
// @version      0.7
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
    me: null,       // vrai compte connecté : { id, name, displayName }
    spoof: null     // identité empruntée : { id, name, displayName, hasVerifiedBadge, ... }
  };

  const state = load();

  function load() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
      const s = Object.assign({}, DEFAULTS, raw);
      if (!Array.isArray(s.owned)) s.owned = [];
      return s;
    } catch {
      return Object.assign({}, DEFAULTS, { owned: [] });
    }
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* quota */ }
  }

  const fmt = (n) => Number(n || 0).toLocaleString('fr-FR');
  const esc = (s) => String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Références capturées avant nos propres correctifs, pour nos requêtes à nous.
  const origFetch = window.fetch && window.fetch.bind(window);

  // ---------- IDENTIFIANTS VISUELS ----------
  const BANNER_ID = 'rbx-testmode-banner';
  const PANEL_ID = 'rbx-testmode-panel';
  const BAR_H = 34;

  // Hexagone évidé : la même forme que l'icône Robux du site.
  const ROBUX_ICON =
    '<svg class="rbx-tm-icon" viewBox="0 0 24 24" aria-hidden="true">' +
    '<path fill="currentColor" fill-rule="evenodd" d="M12 1.5 21.09 6.75v10.5L12 22.5 2.91 17.25V6.75L12 1.5Z' +
    'M12 7 7.67 9.5v5L12 17l4.33-2.5v-5L12 7Z"/></svg>';

  const VERIFIED_ICON =
    '<svg class="rbx-tm-verified" viewBox="0 0 24 24" aria-label="Compte vérifié">' +
    '<circle cx="12" cy="12" r="10" fill="#0066ff"/>' +
    '<path fill="#fff" d="m10.6 16.2-4-4 1.4-1.4 2.6 2.6 5.4-5.4 1.4 1.4z"/></svg>';

  // ---------- 1. STYLES ----------
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
        max-height: calc(100vh - ${BAR_H + 24}px); overflow: auto;
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
      /* Badge de certification injecté dans la page, hors panneau. */
      .rbx-tm-verified {
        width: .85em; height: .85em; display: inline-block; vertical-align: -.08em;
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
    if (el.dataset.rbxFake === txt) return;
    el.textContent = txt;
    el.dataset.rbxFake = txt;
    el.classList.add('rbx-fake-value');
    el.title = 'Solde simulé — mode test';
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
    if (!origFetch) throw new Error('réseau indisponible');

    const r = await origFetch('https://users.roblox.com/v1/usernames/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ usernames: [username], excludeBannedUsers: false })
    });
    if (!r.ok) throw new Error('recherche impossible (HTTP ' + r.status + ')');
    const found = (await r.json()).data || [];
    if (!found.length) throw new Error('aucun compte nommé « ' + username + ' »');

    const id = found[0].id;
    const [detail, headshot, avatar, friends, followers] = await Promise.all([
      getJson('https://users.roblox.com/v1/users/' + id),
      getJson('https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=' + id + '&size=150x150&format=Png&isCircular=false'),
      getJson('https://thumbnails.roblox.com/v1/users/avatar?userIds=' + id + '&size=420x420&format=Png&isCircular=false'),
      getJson('https://friends.roblox.com/v1/users/' + id + '/friends/count'),
      getJson('https://friends.roblox.com/v1/users/' + id + '/followers/count')
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
      followerCount: (followers && followers.count) || 0
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

    if (!PROFILE_ENDPOINTS.test(url)) return url;
    return url.replace(new RegExp('(/users/)' + moi + '(?=$|[/?])'), '$1' + lui);
  }

  // Remplacement dans le texte de la page. Idempotent : une fois le vrai nom
  // remplacé, il n'y a plus rien à trouver, donc aucune boucle avec l'observateur.
  const IDENT_SKIP = /^(SCRIPT|STYLE|TEXTAREA|INPUT|NOSCRIPT)$/;

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
      const txt = node.nodeValue;
      if (!txt || !pairs.some(([real]) => txt.includes(real))) continue;
      todo.push(node);
    }
    for (const n of todo) {
      let v = n.nodeValue;
      for (const [real, faux] of pairs) v = v.split(real).join(faux);
      n.nodeValue = v;
    }

    swapAvatars(sp);
    injectVerified(sp);
  }

  // Roblox affiche lui-même le badge quand l'API le signale ; ceci couvre les
  // en-têtes rendus côté serveur, qui ne passent pas par cette API.
  const NAME_HEADINGS = [
    'h1', '.profile-display-name', '.profile-name',
    '[class*="display-name" i]', '[data-testid*="display-name" i]'
  ].join(', ');

  function injectVerified(sp) {
    if (!sp.hasVerifiedBadge) return;
    document.querySelectorAll(NAME_HEADINGS).forEach(el => {
      if (el.dataset.rbxVerified || el.closest('#' + PANEL_ID)) return;
      if ((el.textContent || '').trim() !== sp.displayName) return;
      el.dataset.rbxVerified = '1';
      el.insertAdjacentHTML('beforeend', ' ' + VERIFIED_ICON);
    });
  }

  // Les images rendues côté serveur ne passent pas par l'API vignettes :
  // on les remplace dans les conteneurs d'avatar connus.
  const AVATAR_SELECTORS = [
    '.avatar-card-image img', '.profile-avatar img', '.avatar .avatar-card-image img',
    '[class*="avatar" i] img', '[data-testid*="avatar" i] img'
  ].join(', ');

  function swapAvatars(sp) {
    const url = sp.headshotUrl || sp.avatarUrl;
    if (!url) return;
    document.querySelectorAll(AVATAR_SELECTORS).forEach(img => {
      if (img.closest('#' + PANEL_ID)) return;
      if (img.dataset.rbxAvatar === url) return;
      // On ne touche qu'aux vignettes Roblox, jamais aux visuels de jeux.
      if (!/rbxcdn\.com/.test(img.src || '')) return;
      img.dataset.rbxAvatar = url;
      img.src = url;
      img.srcset = '';
    });
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
  // Ces motifs doivent viser l'acte d'achat, et lui seul : le marketplace
  // interroge « marketplace-sales/…/item » rien que pour afficher un article.
  const PURCHASE_PATTERNS = [
    /economy\.roblox\.com\/v\d+\/purchases\/products\/\d+/,
    /marketplace-sales\/v\d+\/item\/[\w-]+\/purchase-item/,
    /\/v1\/gamepass\/\d+\/purchase\b/
  ];

  const CURRENCY_PATTERNS = [
    /economy\.roblox\.com\/v1\/user\/currency/,
    /economy\.roblox\.com\/v1\/users\/\d+\/currency/,
    /apis\.roblox\.com\/[^?]*\/currency\b/,
    /\/v1\/users\/\d+\/currency\/?(\?|$)/
  ];

  // La méthode compte autant que l'URL : un GET ne peut pas être un achat.
  const isPurchase = (url, method) =>
    state.enabled && String(method).toUpperCase() === 'POST' &&
    PURCHASE_PATTERNS.some(re => re.test(url));
  const isCurrency = (url) => state.enabled && CURRENCY_PATTERNS.some(re => re.test(url));

  // Toute réponse JSON qui nous intéresse passe ici, quel que soit le transport.
  const INTERESTING = /(economy|users|thumbnails|inventory|catalog|friends|apis|accountsettings)\.roblox\.com/;

  function transform(url, text) {
    if (!state.enabled || typeof text !== 'string' || !text) return text;
    // Roblox émet beaucoup de requêtes : on écarte tout de suite ce qui ne nous
    // concerne pas, plutôt que de tenter un JSON.parse à chaque réponse.
    if (url.includes('roblox.com') && !INTERESTING.test(url)) return text;
    const c = text.charCodeAt(0);
    if (c !== 123 && c !== 91) return text;   // ni « { » ni « [ » : pas du JSON

    let data;
    try { data = JSON.parse(text); } catch { return text; }
    if (data === null || typeof data !== 'object') {
      // is-owned renvoie un booléen nu.
      if (/inventory\.roblox\.com\/v1\/users\/\d+\/items\/\w+\/(\d+)\/is-owned/.test(url)) {
        const id = url.match(/items\/\w+\/(\d+)\/is-owned/)[1];
        if (ownsAsset(id)) return 'true';
      }
      return text;
    }

    let touched = false;

    // -- caches passifs --
    if (/catalog\.roblox\.com\/v1\/catalog\/items\/details/.test(url)) captureCatalogDetails(data);
    if (/thumbnails\.roblox\.com\/v1\/assets\b/.test(url)) captureThumbnails(data);

    // -- solde --
    if (isCurrency(url) && 'robux' in data) {
      data.robux = state.balance;
      touched = true;
    }

    // -- identité --
    if (spoofOn()) touched = spoofResponse(url, data) || touched;

    // -- inventaire --
    if (injectInventory(url, data)) touched = true;

    return touched ? JSON.stringify(data) : text;
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
      name: (meta && meta.name) || pageItemName() || 'Article simulé',
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

    state.balance = Math.max(0, state.balance - item.price);
    if (!item.assetId || !ownsAsset(item.assetId)) state.owned.push(item);
    save();
    paintBalance();
    renderPanel();

    console.log('[TEST MODE] achat simulé', item);

    if (state.reloadAfterPurchase) scheduleReload();
  }

  // Si un jour un endpoint est pris à tort pour un achat, ce garde-fou évite
  // que le site devienne inutilisable : au pire un rechargement est perdu.
  function scheduleReload() {
    try {
      const last = Number(sessionStorage.getItem('rbx_last_reload') || 0);
      if (Date.now() - last < 8000) {
        console.warn('[TEST MODE] rechargement ignoré : le précédent date de moins de 8 s');
        return;
      }
      sessionStorage.setItem('rbx_last_reload', String(Date.now()));
    } catch { /* stockage de session indisponible */ }

    // On laisse la confirmation de Roblox s'afficher avant de recharger.
    setTimeout(() => location.reload(), RELOAD_DELAY);
  }

  const purchaseResponseBody = () => JSON.stringify({
    purchased: true,
    reason: 'Success',
    showDivId: 'TestMode',
    testMode: true          // marqueur laissé volontairement dans la réponse
  });

  // --- fetch ---
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';
    const method = String((init && init.method) || (input && input.method) || 'GET');

    if (isPurchase(url, method)) {
      applyPurchase(url, init && init.body, 0);
      return new Response(purchaseResponseBody(), {
        status: 200, headers: { 'Content-Type': 'application/json' }
      });
    }

    const cible = spoofUrl(url);
    const args = cible === url
      ? arguments
      : [typeof input === 'string' ? cible : new Request(cible, input), init];

    const res = await origFetch.apply(this, args);

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

    if (isPurchase(url, this.__rbxMethod)) {
      // On ne laisse PAS partir la requête : on fabrique la réponse.
      applyPurchase(url, body, 0);
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
      for (const type of ['readystatechange', 'load', 'loadend']) {
        const handler = xhr['on' + type];
        if (typeof handler === 'function') handler.call(xhr, new Event(type));
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
      card.title = 'Article simulé — mode test';
      card.innerHTML =
        (it.thumb ? '<img src="' + esc(it.thumb) + '" alt="" />' : '<img alt="" />') +
        '<div class="rbx-tm-inv-body">' +
          '<div class="rbx-tm-inv-name">' + esc(it.name) + '</div>' +
          '<div class="rbx-tm-inv-price">' + ROBUX_ICON + ' ' + fmt(it.price) + '</div>' +
        '</div>';
      grid.insertBefore(card, grid.firstChild);
    }
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
      </div>

      <div class="rbx-tm-card">
        <div class="rbx-tm-head">
          <h2>Identité</h2>
          <span class="rbx-tm-badge">Mode test</span>
        </div>
        <p class="rbx-tm-sub">Emprunte l'apparence d'un profil public réel : nom, pseudo, avatar et certification.</p>

        <div class="rbx-tm-row">
          <span class="rbx-tm-label">Pseudo à chercher</span>
          <span class="rbx-tm-grow">
            <input class="rbx-tm-input" id="rbx-p-user" type="text" autocapitalize="off"
                   autocorrect="off" spellcheck="false" placeholder="ex. Azen" />
            <button class="rbx-tm-btn rbx-tm-primary" data-act="lookup" type="button">Rechercher</button>
          </span>
        </div>
        <div class="rbx-tm-row rbx-tm-block" data-role="ident"></div>
        <div class="rbx-tm-row">
          <span class="rbx-tm-label">Utiliser cette identité</span>
          <span class="rbx-tm-right">
            <label class="rbx-tm-switch"><input type="checkbox" data-act="spoof" /><i></i></label>
          </span>
        </div>
        <div class="rbx-tm-row">
          <span class="rbx-tm-label">Mon vrai compte</span>
          <span class="rbx-tm-right" data-role="real">—</span>
        </div>
      </div>

      <div class="rbx-tm-card">
        <div class="rbx-tm-head">
          <h2>Inventaire simulé</h2>
          <span class="rbx-tm-badge rbx-tm-count" data-role="count">0</span>
        </div>
        <p class="rbx-tm-sub">Les articles achetés en mode test, conservés et ajoutés à ton inventaire.</p>

        <div class="rbx-tm-row rbx-tm-block rbx-tm-bare">
          <div class="rbx-tm-grid" data-role="inv"></div>
          <p class="rbx-tm-empty" data-role="inv-empty">Aucun article pour l'instant.</p>
        </div>
        <div class="rbx-tm-row">
          <span class="rbx-tm-label">Recharger la page après un achat</span>
          <span class="rbx-tm-right">
            <label class="rbx-tm-switch"><input type="checkbox" data-act="reload" /><i></i></label>
          </span>
        </div>
        <div class="rbx-tm-row">
          <span class="rbx-tm-label">Historique</span>
          <span class="rbx-tm-right rbx-tm-chips">
            <button class="rbx-tm-btn" data-act="clear-inv" type="button">Vider l'inventaire</button>
            <button class="rbx-tm-btn" data-act="reset" type="button">Tout réinitialiser</button>
          </span>
        </div>
        <p class="rbx-tm-note">Local uniquement : rien n'est envoyé à Roblox, aucun Robux réel n'est débité ni crédité, aucun article n'est réellement acquis.</p>
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

      if (btn.dataset.add) {
        state.balance = Math.max(0, state.balance + Number(btn.dataset.add));
      } else if (btn.dataset.act === 'apply') {
        const v = Number(el.querySelector('#rbx-p-input').value);
        state.balance = Number.isFinite(v) ? Math.max(0, Math.floor(v)) : state.balance;
      } else if (btn.dataset.act === 'zero') {
        state.balance = 0;
      } else if (btn.dataset.act === 'clear-inv') {
        state.owned = [];
      } else if (btn.dataset.act === 'reset') {
        Object.assign(state, DEFAULTS, { owned: [], me: state.me });
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
          lookupState.error = 'Cherche d\'abord un pseudo.';
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
      lookupState.error = err.message || 'recherche impossible';
    }
    lookupState.busy = false;
    renderPanel();
  }

  function identHtml() {
    if (lookupState.busy) return '<p class="rbx-tm-empty">Recherche en cours…</p>';
    if (lookupState.error) return '<p class="rbx-tm-error">' + esc(lookupState.error) + '</p>';

    const u = lookupState.found || (state.spoof && state.spoof.active ? state.spoof : null);
    if (!u) return '<p class="rbx-tm-empty">Aucun profil chargé.</p>';

    return '<div class="rbx-tm-ident">' +
      '<img src="' + esc(u.headshotUrl || u.avatarUrl) + '" alt="" />' +
      '<div>' +
        '<div class="rbx-tm-ident-name">' + esc(u.displayName) +
          (u.hasVerifiedBadge ? VERIFIED_ICON : '') + '</div>' +
        '<div class="rbx-tm-ident-user">@' + esc(u.name) + ' · #' + esc(u.id) + '</div>' +
        '<div class="rbx-tm-ident-stats">' +
          '<span><b>' + fmt(u.followerCount) + '</b> abonnés</span>' +
          '<span><b>' + fmt(u.friendCount) + '</b> amis</span>' +
        '</div>' +
      '</div></div>';
  }

  function invHtml() {
    return state.owned.slice().reverse().map(it =>
      '<div class="rbx-tm-item">' +
        (it.thumb ? '<img src="' + esc(it.thumb) + '" alt="" />' : '<img alt="" />') +
        '<div class="rbx-tm-item-body">' +
          '<div class="rbx-tm-item-name">' + esc(it.name || 'Article simulé') + '</div>' +
          '<div class="rbx-tm-item-price">' + ROBUX_ICON + fmt(it.price) + '</div>' +
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
      : 'non identifié';

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
    injectBanner();
    paintBalance();
    paintIdentity();
    paintInventory();
    mountPanel();
    syncTheme();
  };

  const obs = new MutationObserver(tick);

  function start() {
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
