// ==UserScript==
// @name         Roblox TEST MODE — faux solde + achats simulés
// @namespace    perso-test
// @version      0.4
// @description  Bac à sable local : affiche un solde fictif et simule les achats catalogue. Aucune requête d'achat n'atteint les serveurs Roblox.
// @author       guildenapp
// @downloadURL  https://raw.githubusercontent.com/guildenapp/roblox-testmode.user.js/main/roblox-testmode.user.js
// @updateURL    https://raw.githubusercontent.com/guildenapp/roblox-testmode.user.js/main/roblox-testmode.user.js
// @match        https://*.roblox.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

/* =============================================================================
 *  ROBLOX TEST MODE — bac à sable 100 % local
 * -----------------------------------------------------------------------------
 *  Ce script ne fabrique RIEN côté serveur. Il repeint des nombres dans le DOM
 *  et court-circuite les appels d'achat AVANT qu'ils ne partent sur le réseau.
 *  Deux marqueurs sont volontairement non désactivables :
 *    1. le bandeau « TEST MODE » (bas d'écran, z-index max, réinjecté)
 *    2. la classe .rbx-fake-value sur tout montant fictif affiché
 *  Les retirer demande d'éditer ce fichier — c'est intentionnel.
 * ========================================================================== */

(function () {
  'use strict';

  /* ===========================================================================
   * 0. CONSTANTES ET PETITS UTILITAIRES
   * ======================================================================== */

  const TAG          = '[TEST MODE]';
  const STORAGE_KEY  = 'rbx_testmode_state';
  const ROOT_ID      = 'rbx-testmode-root';       // conteneur bandeau + panneau
  const BANNER_ID    = 'rbx-testmode-banner';
  const PANEL_ID     = 'rbx-testmode-panel';
  const STYLE_ID     = 'rbx-testmode-style';
  const BAR_H        = 34;                        // hauteur du bandeau en px
  const BANNER_TEXT  = 'TEST MODE — données simulées, aucun achat réel';
  const DEFAULT_BALANCE = 2000000;
  const Z            = 2147483647;                // z-index maximal autorisé

  // Logs : toujours préfixés, jamais bruyants au point de noyer la console.
  const log  = (...a) => { try { console.log(TAG, ...a); } catch (_) {} };
  const warn = (...a) => { try { console.warn(TAG, ...a); } catch (_) {} };

  // Enveloppe anti-casse : une exception ici ne doit jamais remonter dans la page.
  function safe(label, fn, fallback) {
    try {
      return fn();
    } catch (e) {
      warn('erreur non fatale dans « ' + label + ' » :', e && e.message ? e.message : e);
      return fallback;
    }
  }

  // Formatage francophone : le séparateur insécable rend le faux solde
  // visuellement distinct du format Roblox (virgules), en plus de la classe CSS.
  const fmt = (n) => safe('fmt', () => Number(n || 0).toLocaleString('fr-FR'), String(n));

  /* Un sélecteur invalide fait échouer TOUT le querySelectorAll qui le contient.
   * On valide donc chaque sélecteur une fois au démarrage et on ne garde que
   * ceux que ce navigateur comprend (ex. `use[*|href]` selon les moteurs). */
  function validSelectors(list) {
    const ok = [];
    for (const sel of list) {
      try { document.createDocumentFragment().querySelector(sel); ok.push(sel); }
      catch (_) { warn('sélecteur ignoré (non supporté ici) :', sel); }
    }
    return ok.join(',');
  }

  /* ===========================================================================
   * 1. ÉTAT PERSISTANT (localStorage)
   * ------------------------------------------------------------------------
   *  Forme : { balance, owned: [ {key, assetId, productId, price, name, at} ],
   *            intercept: bool, version }
   *  On tolère l'ancien format (owned = liste d'URLs) via normalize().
   * ======================================================================== */

  function blankState() {
    return { balance: DEFAULT_BALANCE, owned: [], intercept: true, version: 4 };
  }

  // Migration douce depuis les versions 0.1 → 0.3.
  function normalize(s) {
    const out = blankState();
    if (typeof s.balance === 'number' && isFinite(s.balance)) out.balance = s.balance;
    if (typeof s.intercept === 'boolean') out.intercept = s.intercept;
    if (Array.isArray(s.owned)) {
      out.owned = s.owned.map((it) => {
        if (typeof it === 'string') return { key: it, url: it, price: 0, at: null };
        return {
          key:       it.key || it.assetId || it.productId || it.url || '',
          assetId:   it.assetId   || null,
          productId: it.productId || null,
          price:     Number(it.price || 0),
          name:      it.name || null,
          url:       it.url  || null,
          at:        it.at   || null
        };
      }).filter((it) => it.key);
    }
    return out;
  }

  function loadState() {
    return safe('loadState', () => {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return blankState();
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return blankState();
      return normalize(parsed);
    }, blankState());
  }

  const state = loadState();

  function saveState() {
    safe('saveState', () => localStorage.setItem(STORAGE_KEY, JSON.stringify(state)));
  }

  // Index rapide des identifiants possédés (assetId, productId, clés diverses).
  function ownedIds() {
    const set = new Set();
    for (const it of state.owned) {
      if (it.assetId)   set.add(String(it.assetId));
      if (it.productId) set.add(String(it.productId));
      if (it.key)       set.add(String(it.key));
    }
    return set;
  }

  /* ===========================================================================
   * 2. STYLES + BANDEAU INAMOVIBLE
   * ------------------------------------------------------------------------
   *  Le bandeau et le panneau vivent dans un conteneur unique (#rbx-testmode-root)
   *  que l'on RÉ-ATTACHE au lieu de le recréer : le panneau garde ainsi son état
   *  (ouvert/fermé, champ de saisie) même si React nettoie <body>.
   * ======================================================================== */

  let rootEl   = null;
  let bannerEl = null;
  // Déclarés ici (et non au §7) : enforceBanner() peut construire le panneau
  // avant que le §7 ne soit évalué — un `let` plus bas provoquerait une
  // ReferenceError de zone morte temporelle.
  let panelEl = null;
  let readoutEl = null, ownedCountEl = null, ownedListEl = null;
  let balanceInput = null, interceptBox = null;

  function injectStyle() {
    safe('injectStyle', () => {
      if (document.getElementById(STYLE_ID)) return;
      const s = document.createElement('style');
      s.id = STYLE_ID;
      s.textContent = `
        /* --- réserve d'espace pour ne pas masquer le pied de page Roblox --- */
        html { padding-bottom: ${BAR_H}px !important; }

        /* --- conteneur : neutralise l'héritage CSS de la page --- */
        #${ROOT_ID} {
          all: initial;
          position: fixed !important;
          left: 0 !important; right: 0 !important; bottom: 0 !important;
          z-index: ${Z} !important;
          font-family: system-ui, -apple-system, "Segoe UI", sans-serif !important;
        }

        /* --- bandeau permanent --- */
        #${BANNER_ID} {
          position: relative !important;
          display: flex !important; align-items: center !important;
          justify-content: center !important; gap: 12px !important;
          height: ${BAR_H}px !important; box-sizing: border-box !important;
          background: repeating-linear-gradient(45deg, #b3261e 0 12px, #8c1d16 12px 24px) !important;
          color: #fff !important;
          font: 700 13px/${BAR_H}px system-ui, -apple-system, sans-serif !important;
          letter-spacing: .12em !important; text-transform: uppercase !important;
          text-align: center !important;
          opacity: 1 !important; visibility: visible !important;
          transform: none !important; filter: none !important;
          user-select: none !important; pointer-events: auto !important;
        }
        #${BANNER_ID} .rbx-tm-label { pointer-events: none !important; }
        #${BANNER_ID} .rbx-tm-toggle {
          position: absolute !important; right: 8px !important; top: 5px !important;
          height: 24px !important; padding: 0 10px !important;
          border: 1px solid rgba(255,255,255,.55) !important; border-radius: 4px !important;
          background: rgba(0,0,0,.25) !important; color: #fff !important;
          font: 700 11px/22px system-ui, sans-serif !important; letter-spacing: .08em !important;
          cursor: pointer !important;
        }
        #${BANNER_ID} .rbx-tm-toggle:hover { background: rgba(0,0,0,.45) !important; }

        /* --- marqueur universel des montants fictifs --- */
        .rbx-fake-value {
          color: #b3261e !important;
          text-decoration: underline wavy #b3261e 1px !important;
          text-underline-offset: 2px !important;
        }

        /* --- panneau de contrôle, ancré au-dessus du bandeau --- */
        #${PANEL_ID} {
          position: absolute !important; right: 8px !important; bottom: ${BAR_H}px !important;
          width: 300px !important; box-sizing: border-box !important;
          padding: 12px !important; margin-bottom: 6px !important;
          background: #1c1b1f !important; color: #e6e1e5 !important;
          border: 1px solid #b3261e !important; border-radius: 8px 8px 0 0 !important;
          box-shadow: 0 -4px 18px rgba(0,0,0,.45) !important;
          font: 400 12px/1.5 system-ui, -apple-system, sans-serif !important;
          text-transform: none !important; letter-spacing: normal !important;
          max-height: 60vh !important; overflow-y: auto !important;
        }
        #${PANEL_ID}[hidden] { display: none !important; }
        #${PANEL_ID} h4 {
          margin: 0 0 8px !important; font: 700 12px/1.4 system-ui, sans-serif !important;
          text-transform: uppercase !important; letter-spacing: .1em !important;
          color: #f2b8b5 !important;
        }
        #${PANEL_ID} .rbx-tm-row {
          display: flex !important; align-items: center !important; gap: 6px !important;
          margin: 6px 0 !important; flex-wrap: wrap !important;
        }
        #${PANEL_ID} label { flex: 0 0 auto !important; color: #cac4d0 !important; }
        #${PANEL_ID} input[type="number"] {
          flex: 1 1 auto !important; min-width: 0 !important;
          padding: 4px 6px !important; box-sizing: border-box !important;
          background: #2b2930 !important; color: #e6e1e5 !important;
          border: 1px solid #49454f !important; border-radius: 4px !important;
          font: 400 12px system-ui, sans-serif !important;
        }
        #${PANEL_ID} button {
          padding: 5px 9px !important; cursor: pointer !important;
          background: #322f35 !important; color: #e6e1e5 !important;
          border: 1px solid #49454f !important; border-radius: 4px !important;
          font: 600 11px system-ui, sans-serif !important;
        }
        #${PANEL_ID} button:hover { background: #45424a !important; border-color: #b3261e !important; }
        #${PANEL_ID} .rbx-tm-readout {
          display: block !important; margin: 2px 0 8px !important;
          font: 700 16px system-ui, sans-serif !important;
        }
        #${PANEL_ID} .rbx-tm-hint {
          display: block !important; margin-top: 8px !important;
          color: #938f99 !important; font-size: 11px !important; line-height: 1.4 !important;
        }
        #${PANEL_ID} ul {
          margin: 4px 0 0 !important; padding-left: 16px !important;
          max-height: 120px !important; overflow-y: auto !important;
          list-style: disc !important;
        }
        #${PANEL_ID} li { margin: 2px 0 !important; }

        /* --- pastille « possédé » sur les vignettes catalogue --- */
        .rbx-tm-owned-badge {
          display: inline-block !important; margin: 2px 4px !important;
          padding: 1px 6px !important; border-radius: 3px !important;
          background: #b3261e !important; color: #fff !important;
          font: 700 10px/16px system-ui, sans-serif !important;
          letter-spacing: .06em !important; vertical-align: middle !important;
          text-decoration: none !important;
        }
      `;
      (document.head || document.documentElement).appendChild(s);
    });
  }

  // Construit (une seule fois) le conteneur bandeau + panneau.
  function buildRoot() {
    if (rootEl) return rootEl;

    rootEl = document.createElement('div');
    rootEl.id = ROOT_ID;

    bannerEl = document.createElement('div');
    bannerEl.id = BANNER_ID;

    const label = document.createElement('span');
    label.className = 'rbx-tm-label';
    label.textContent = BANNER_TEXT;
    bannerEl.appendChild(label);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'rbx-tm-toggle';
    toggle.textContent = '⚙ Panneau';
    toggle.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const p = document.getElementById(PANEL_ID);
      if (p) { p.hidden = !p.hidden; if (!p.hidden) refreshPanel(); }
    });
    bannerEl.appendChild(toggle);

    rootEl.appendChild(bannerEl);
    rootEl.appendChild(buildPanel());
    return rootEl;
  }

  // Réinjection + ré-affirmation du contenu et des styles critiques.
  // Appelée à chaque passe de scan : c'est ce qui rend le bandeau inamovible.
  function enforceBanner() {
    safe('enforceBanner', () => {
      if (!document.body) return;
      injectStyle();                                            // <style> supprimé ? on le remet
      const root = buildRoot();
      if (root.parentNode !== document.body) document.body.appendChild(root);  // détaché ? rattaché

      // Si le bandeau a été retiré/vidé par la page, on restaure.
      if (bannerEl.parentNode !== root) root.insertBefore(bannerEl, root.firstChild);
      const label = bannerEl.querySelector('.rbx-tm-label');
      if (label && label.textContent !== BANNER_TEXT) label.textContent = BANNER_TEXT;

      // Note : on ne teste l'opacité que si elle est réellement résolue —
      // une valeur vide (moteur sans cascade complète) ne vaut pas « masqué ».
      const cs = window.getComputedStyle(bannerEl);
      const op = parseFloat(cs.opacity);
      if (cs.display === 'none' || cs.visibility === 'hidden' || (isFinite(op) && op < 0.9)) {
        bannerEl.style.setProperty('display', 'flex', 'important');
        bannerEl.style.setProperty('visibility', 'visible', 'important');
        bannerEl.style.setProperty('opacity', '1', 'important');
        warn('bandeau masqué par la page — restauré');
      }
    });
  }

  /* ===========================================================================
   * 3. DÉTECTION RÉSILIENTE DU SOLDE
   * ------------------------------------------------------------------------
   *  Problème : #nav-robux-amount n'existe plus de façon fiable, et les classes
   *  React sont hachées. On ne cherche donc plus « le nœud du solde » par ID,
   *  on cherche « un nombre collé à une icône Robux, dans un contexte de solde ».
   *
   *  Étape A — ancres : tout élément qui *parle* de Robux (classe, id, testid,
   *            aria-label, alt, title, href /upgrades/robux, <use href="#robux">).
   *  Étape B — filtre de contexte : l'ancre doit être dans la barre de navigation
   *            OU porter un identifiant de type « balance / currency ». Sans ce
   *            filtre on repeindrait AUSSI les prix des vignettes catalogue, qui
   *            ont eux aussi une icône Robux à côté — le piège classique.
   *  Étape C — remontée bornée (4 ancêtres max) puis TreeWalker sur les nœuds
   *            texte : on garde le premier qui ressemble à un montant.
   *  Étape D — on écrit dans le nœud TEXTE, pas dans element.textContent, pour
   *            ne pas détruire les frères (icône SVG dans le même conteneur).
   * ======================================================================== */

  // Étape A — « quelque chose parle de Robux ici ».
  const ROBUX_ANCHORS = validSelectors([
    '[class*="robux" i]',
    '[id*="robux" i]',
    '[data-testid*="robux" i]',
    '[aria-label*="robux" i]',
    '[title*="robux" i]',
    'img[alt*="robux" i]',
    'use[href*="robux" i]',
    'a[href*="/upgrades/robux" i]',
    'a[href$="/robux" i]'
  ]);

  // Étape B — contexte « barre de nav ».
  const NAV_CONTEXT = validSelectors([
    'nav', 'header', '[role="banner"]', '[role="navigation"]',
    '#header', '#navigation', '#navbar', '.navbar', '.rbx-navbar',
    '[class*="navbar" i]', '[class*="nav-header" i]', '[id*="navbar" i]'
  ]);

  // Étape B bis — contexte « zone de solde », valable hors barre de nav
  // (page /upgrades/robux, tiroir de compte mobile, écran d'achat).
  const BALANCE_CONTEXT = validSelectors([
    '[id*="nav-robux" i]', '[class*="nav-robux" i]',
    '[id*="balance" i]', '[class*="balance" i]', '[data-testid*="balance" i]',
    'a[href*="/upgrades/robux" i]', 'a[href$="/robux" i]',
    '[class*="currency" i]', '[id*="currency" i]'
  ]);

  // Sélecteurs historiques : gratuits à tester, on les garde en filet.
  const LEGACY_BALANCE = validSelectors([
    '#nav-robux-amount',
    '#nav-robux-balance',
    '.text-robux-tab',
    '.rbx-text-navbar-right',
    '[data-testid="navigation-robux-amount"]'
  ]);

  const MAX_CLIMB = 4;   // nombre d'ancêtres explorés au-dessus de l'ancre

  // Un texte « ressemble à un montant » : chiffres, séparateurs (espace fine
  // insécable U+202F, insécable U+00A0, point, virgule) et suffixe K/M/B.
  // Volontairement permissif — c'est le filtre de contexte qui protège.
  function looksLikeAmount(str) {
    const t = String(str || '').trim();
    if (!t || t.length > 18) return false;
    if (!/\d/.test(t)) return false;
    return /^(?:R\$)?[\s  ]*\d[\d\s.,  ]*[KkMmBb]?\+?$/.test(t);
  }

  function inBalanceContext(el) {
    return safe('inBalanceContext', () => {
      if (!el || !el.closest) return false;
      if (el.closest('#' + ROOT_ID)) return false;             // jamais notre propre UI
      if (BALANCE_CONTEXT && el.closest(BALANCE_CONTEXT)) return true;
      if (NAV_CONTEXT && el.closest(NAV_CONTEXT)) return true;
      return false;
    }, false);
  }

  // Étape C/D — collecte les nœuds texte candidats sous une racine donnée.
  function collectAmountTextNodes(root, out) {
    safe('collectAmountTextNodes', () => {
      if (!root || root.nodeType !== 1) return;
      if (root.closest && root.closest('#' + ROOT_ID)) return;
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
          const p = node.parentElement;
          if (!p) return NodeFilter.FILTER_REJECT;
          if (p.closest('#' + ROOT_ID)) return NodeFilter.FILTER_REJECT;
          const tag = p.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TITLE') return NodeFilter.FILTER_REJECT;
          // Déjà repeint par nous : on l'accepte quand même, pour pouvoir le
          // RE-peindre si React a réécrit la vraie valeur par-dessus.
          if (p.dataset && p.dataset.rbxFakeBalance === '1') return NodeFilter.FILTER_ACCEPT;
          return looksLikeAmount(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
      });
      let n;
      while ((n = walker.nextNode())) {
        out.add(n);
        if (out.size > 40) break;   // garde-fou : on ne balaie jamais toute la page
      }
    });
  }

  function findBalanceTextNodes() {
    const found = new Set();

    if (LEGACY_BALANCE) {
      safe('findBalance/legacy', () => {
        document.querySelectorAll(LEGACY_BALANCE).forEach((el) => collectAmountTextNodes(el, found));
      });
    }

    if (ROBUX_ANCHORS) {
      safe('findBalance/anchors', () => {
        const anchors = document.querySelectorAll(ROBUX_ANCHORS);
        for (const anchor of anchors) {
          // <use> SVG : ce n'est pas un élément HTML utilisable, on part du parent.
          const start = (anchor.tagName && String(anchor.tagName).toLowerCase() === 'use')
            ? (anchor.parentElement || anchor)
            : anchor;
          if (!inBalanceContext(start)) continue;     // ← filtre anti « prix catalogue »

          // Remontée bornée : plus on monte, plus le risque d'attraper un nombre
          // sans rapport augmente — d'où MAX_CLIMB et l'arrêt au premier succès.
          // On collecte dans un ensemble LOCAL : si l'on testait la taille de
          // l'ensemble partagé, un noeud déjà connu (trouvé par un autre
          // sélecteur) passerait pour une absence et ferait remonter la boucle
          // jusqu'à <body> — donc repeindre les prix du catalogue.
          let node = start;
          for (let i = 0; i <= MAX_CLIMB && node; i++) {
            // Garde-fou dur : ne jamais prendre <body>/<html> pour racine, ce
            // serait balayer la page entière. Un solde vit toujours dans un
            // conteneur local (lien, item de nav, puce).
            if (node === document.body || node === document.documentElement) break;
            const local = new Set();
            collectAmountTextNodes(node, local);
            if (local.size) {                          // trouvé au plus près : stop
              local.forEach((n) => found.add(n));
              break;
            }
            node = node.parentElement;
          }
        }
      });
    }

    return found;
  }

  // Disjoncteur : si la page nous réécrit en boucle, on cesse de lutter en rAF.
  let writeWindowStart = 0;
  let writeCount = 0;
  let backoffUntil = 0;

  function paintBalance() {
    if (Date.now() < backoffUntil) return;

    safe('paintBalance', () => {
      const txt = fmt(state.balance);
      const nodes = findBalanceTextNodes();
      let written = 0;

      for (const node of nodes) {
        if (node.nodeValue === txt) continue;        // déjà à jour → aucune écriture
        node.nodeValue = txt;
        written++;
        const p = node.parentElement;
        if (!p) continue;
        p.classList.add('rbx-fake-value');           // marqueur obligatoire
        if (p.dataset) p.dataset.rbxFakeBalance = '1';
        // Certains conteneurs annoncent le solde aux lecteurs d'écran :
        // le marqueur doit exister aussi pour eux, pas seulement en couleur.
        if (p.hasAttribute('aria-label') && /\d/.test(p.getAttribute('aria-label'))) {
          p.setAttribute('aria-label', 'Solde fictif (test) : ' + txt);
        }
      }

      if (written) {
        const now = Date.now();
        if (now - writeWindowStart > 1000) { writeWindowStart = now; writeCount = 0; }
        writeCount += written;
        if (writeCount > 300) {
          backoffUntil = now + 5000;
          warn('trop de réécritures en 1 s (conflit avec un re-rendu React) — pause 5 s');
        }
      }
    });
  }

  /* ===========================================================================
   * 4. MARQUAGE DES ITEMS POSSÉDÉS (pages catalogue)
   * ------------------------------------------------------------------------
   *  Le mock réseau (§6) suffit quand la page interroge l'API ownership, mais
   *  beaucoup de vignettes sont rendues côté serveur : on ajoute donc une
   *  pastille DOM sur tout lien /catalog/{id} correspondant à un item possédé.
   *  C'est ce qui fait « survivre » l'achat simulé au rechargement de page.
   * ======================================================================== */

  function ownedBadge() {
    const badge = document.createElement('span');
    badge.className = 'rbx-tm-owned-badge rbx-fake-value';
    badge.textContent = 'POSSÉDÉ (TEST)';
    return badge;
  }

  function markOwnedItems() {
    safe('markOwnedItems', () => {
      const ids = ownedIds();
      if (!ids.size) return;

      document.querySelectorAll('a[href*="/catalog/"], a[href*="/bundles/"]').forEach((a) => {
        if (a.closest('#' + ROOT_ID)) return;
        if (a.dataset && a.dataset.rbxOwnedMark === '1') return;
        const m = /\/(?:catalog|bundles)\/(\d+)/.exec(a.getAttribute('href') || '');
        if (!m || !ids.has(m[1])) return;
        a.appendChild(ownedBadge());
        if (a.dataset) a.dataset.rbxOwnedMark = '1';
      });

      // Page de détail d'un item : /catalog/{id}/{slug}
      const pm = /\/(?:catalog|bundles)\/(\d+)/.exec(location.pathname);
      if (pm && ids.has(pm[1])) {
        const h = document.querySelector('h1');
        if (h && !(h.dataset && h.dataset.rbxOwnedMark === '1')) {
          h.appendChild(ownedBadge());
          if (h.dataset) h.dataset.rbxOwnedMark = '1';
        }
      }
    });
  }

  /* ===========================================================================
   * 5. BOUCLE DE SCAN — MutationObserver + navigation SPA + filet horaire
   * ------------------------------------------------------------------------
   *  Trois déclencheurs, un seul point d'entrée (scheduleScan), throttlé en rAF
   *  pour ne jamais faire plus d'une passe par frame.
   * ======================================================================== */

  let scanPending = false;

  function scheduleScan() {
    if (scanPending) return;
    scanPending = true;
    const run = () => { scanPending = false; runScan(); };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 16);
  }

  function runScan() {
    enforceBanner();
    paintBalance();
    markOwnedItems();
    refreshPanelReadouts();
  }

  function startObserver() {
    safe('startObserver', () => {
      const target = document.body || document.documentElement;
      if (!target) return;
      const obs = new MutationObserver(scheduleScan);
      obs.observe(target, {
        childList: true, subtree: true,
        characterData: true,                  // React réécrit souvent le texte seul
        attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-label']
      });
      log('observateur DOM actif');
    });
  }

  /* --- Navigation SPA : pushState / replaceState / popstate / hashchange ---
   * Roblox change de page sans recharger : sans ce patch, le solde repeint
   * disparaît dès la première navigation interne et ne revient jamais. */
  function hookHistory() {
    safe('hookHistory', () => {
      const fire = () => {
        log('navigation SPA détectée →', location.pathname);
        // Nouvelle page = nouveaux nœuds : plusieurs passes espacées, car le
        // rendu React arrive APRÈS l'événement d'historique.
        scheduleScan();
        setTimeout(scheduleScan, 120);
        setTimeout(scheduleScan, 500);
        setTimeout(scheduleScan, 1200);
      };
      ['pushState', 'replaceState'].forEach((k) => {
        const orig = history[k];
        if (typeof orig !== 'function') return;
        history[k] = function () {
          const r = orig.apply(this, arguments);
          safe('history.' + k, fire);
          return r;
        };
      });
      window.addEventListener('popstate', fire);
      window.addEventListener('hashchange', fire);
    });
  }

  function boot() {
    injectStyle();
    enforceBanner();
    startObserver();
    scheduleScan();
    log('démarré — solde fictif :', fmt(state.balance), '| achats simulés :', state.owned.length);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
    // Filet : si <body> apparaît avant DOMContentLoaded, on injecte déjà le
    // bandeau pour qu'il ne manque jamais, même une fraction de seconde.
    const early = new MutationObserver(() => {
      if (document.body) { early.disconnect(); injectStyle(); enforceBanner(); }
    });
    safe('earlyObserver', () => early.observe(document.documentElement, { childList: true }));
  } else {
    boot();
  }

  hookHistory();
  // Filet horaire basse fréquence : rattrape les rendus que l'observateur rate
  // (onglet réactivé, conteneur recréé hors mutation observée…). Coût négligeable.
  setInterval(scheduleScan, 2000);

  /* ===========================================================================
   * 6. INTERCEPTION RÉSEAU — fetch ET XMLHttpRequest
   * ------------------------------------------------------------------------
   *  Roblox utilise les deux : fetch dans le code récent, XHR dans le legacy
   *  Angular/jQuery encore présent sur plusieurs écrans catalogue.
   *
   *  RÈGLE DURE : une requête d'achat ne part JAMAIS sur le réseau.
   *  - interception ACTIVE     → achat court-circuité + réponse mockée + débit
   *  - interception DÉSACTIVÉE → achat BLOQUÉ (erreur réseau simulée), sans débit.
   *    Le bouton du panneau désactive la *simulation*, pas la protection : laisser
   *    filer un vrai achat contredirait la raison d'être du bac à sable.
   * ======================================================================== */

  // --- Achats catalogue / collectibles / gamepass -------------------------
  const PURCHASE_PATTERNS = [
    /economy\.roblox\.com\/v\d+\/purchases\/products\/\d+/i,   // achat classique (productId)
    /\/v\d+\/purchases\/products\//i,                          // variante sans hôte explicite
    /marketplace-sales\/v\d+\/item\/[^/]+\/purchase-item/i,    // collectibles / limited UGC
    /marketplace-sales\/v\d+\/.*purchase/i,                    // autres routes marketplace-sales
    /economy\.roblox\.com\/v\d+\/user\/robux\/spend/i,
    /\/v\d+\/game-passes\/\d+\/purchase/i,
    /apis\.roblox\.com\/game-passes\/v\d+\/game-passes\/\d+\/purchase/i
  ];

  // --- Solde : entièrement mocké (aucun aller-retour réseau nécessaire) ---
  const CURRENCY_PATTERNS = [
    /economy\.roblox\.com\/v\d+\/users\/\d+\/currency/i,
    /economy\.roblox\.com\/v\d+\/user\/currency/i,
    /\/v\d+\/users\/\d+\/currency(?:\?|$)/i
  ];

  // --- Possession : mocké en « true » UNIQUEMENT pour nos items fictifs ---
  const IS_OWNED_RE = /inventory\.roblox\.com\/v\d+\/users\/\d+\/items\/[^/]+\/(\d+)\/is-owned/i;

  // --- Détails d'items : réponse réelle réécrite (owned = true) ------------
  const DETAILS_PATTERNS = [
    /catalog\.roblox\.com\/v\d+\/catalog\/items\/details/i,
    /apis\.roblox\.com\/marketplace-items\/v\d+\/items\/details/i
  ];

  const matchAny = (list, url) => list.some((re) => safe('regex', () => re.test(url), false));

  // Extrait tout ce qui peut identifier l'item acheté (URL + corps + page courante).
  function describePurchase(url, body) {
    const fallback = { url, price: 0, assetId: null, productId: null, name: null };
    return safe('describePurchase', () => {
      const info = { url, price: 0, assetId: null, productId: null, name: null };

      let m = /\/purchases\/products\/(\d+)/i.exec(url);
      if (m) info.productId = m[1];
      m = /marketplace-sales\/v\d+\/item\/([^/?#]+)\/purchase-item/i.exec(url);
      if (m) info.productId = info.productId || decodeURIComponent(m[1]);
      m = /game-passes\/(\d+)\/purchase/i.exec(url);
      if (m) info.productId = info.productId || m[1];

      // Corps JSON (fetch : string/FormData ; XHR : string dans la quasi-totalité des cas).
      let parsed = null;
      if (typeof body === 'string' && body.trim().charAt(0) === '{') {
        parsed = safe('parseBody', () => JSON.parse(body), null);
      } else if (body && typeof FormData !== 'undefined' && body instanceof FormData) {
        parsed = {};
        body.forEach((v, k) => { parsed[k] = v; });
      }
      if (parsed) {
        const p = parsed.expectedPrice != null ? parsed.expectedPrice
                : parsed.price != null ? parsed.price
                : parsed.expectedCurrency != null ? parsed.expectedCurrency : 0;
        info.price     = Number(p) || 0;
        info.assetId   = parsed.assetId || parsed.expectedAssetId || parsed.collectibleItemId || null;
        info.productId = info.productId || parsed.productId || parsed.collectibleProductId || null;
      }

      // Repli : on est très probablement sur la page de l'item concerné.
      const pm = /\/(?:catalog|bundles)\/(\d+)/.exec(location.pathname);
      if (pm) {
        info.assetId = info.assetId || pm[1];
        const h1 = document.querySelector('h1');
        if (h1) info.name = h1.textContent.trim().slice(0, 80);
      }
      // Dernier repli pour le prix : le montant affiché près du bouton d'achat.
      if (!info.price) {
        const priceEl = document.querySelector('[class*="text-robux" i], [class*="price" i]');
        if (priceEl) {
          const digits = (priceEl.textContent || '').replace(/[^\d]/g, '');
          if (digits && digits.length <= 9) info.price = Number(digits);
        }
      }
      return info;
    }, fallback);
  }

  // Applique l'achat simulé : débit + persistance + repeinture.
  function applyFakePurchase(info) {
    return safe('applyFakePurchase', () => {
      const price = Math.max(0, Number(info.price) || 0);
      state.balance = Math.max(0, state.balance - price);
      const key = String(info.assetId || info.productId || info.url);
      state.owned.push({
        key,
        assetId:   info.assetId   ? String(info.assetId)   : null,
        productId: info.productId ? String(info.productId) : null,
        price,
        name: info.name || null,
        url:  info.url,
        at:   new Date().toISOString()
      });
      saveState();
      scheduleScan();
      log('achat SIMULÉ (aucune requête envoyée) :',
          { item: key, prix: price, nouveauSolde: state.balance });
      return { key, price };
    }, { key: 'inconnu', price: 0 });
  }

  // Corps de réponse d'achat : superset des formes attendues par les différents
  // écrans Roblox (dialogue classique + flux marketplace-sales).
  function purchasePayload(info, applied) {
    return {
      purchased: true,
      reason: 'Success',
      purchaseResult: 'Success',
      statusCode: 200,
      title: 'Achat simulé',
      errorMsg: '',
      errorMessage: null,
      showDivId: 'TestMode',
      productId: info.productId || null,
      assetId:   info.assetId   || null,
      price:     applied.price,
      currency:  { amount: state.balance, type: 'Robux' },
      testMode: true,            // marqueur explicite, laissé volontairement
      __testMode: true,
      __note: "Réponse fabriquée localement — aucune requête n'a atteint Roblox."
    };
  }

  /**
   * Décide du sort d'une requête.
   * @returns null → laisser passer ; sinon { action, status, payload }
   *   'mock'    → réponse fabriquée, réseau non sollicité
   *   'block'   → requête refusée (achat, interception désactivée)
   *   'rewrite' → passer par le réseau puis réécrire (fetch uniquement)
   */
  function decide(url, method, body) {
    return safe('decide', () => {
      if (!url) return null;

      // 1) Achats — jamais de passage réseau, quel que soit le réglage.
      if (matchAny(PURCHASE_PATTERNS, url)) {
        if (!state.intercept) {
          warn('interception désactivée : achat BLOQUÉ (jamais relayé à Roblox) —', url);
          return { action: 'block' };
        }
        const info = describePurchase(url, body);
        const applied = applyFakePurchase(info);
        return { action: 'mock', status: 200, payload: purchasePayload(info, applied) };
      }

      if (!state.intercept) return null;   // le reste est purement cosmétique

      // 2) Solde — mock complet, cohérent avec ce qui est peint dans le DOM.
      if (matchAny(CURRENCY_PATTERNS, url)) {
        return { action: 'mock', status: 200, payload: { robux: state.balance, testMode: true } };
      }

      // 3) Possession — on ne ment QUE pour nos items fictifs ; sinon la vraie
      //    réponse passe, ce qui limite la casse sur le reste du site.
      const om = IS_OWNED_RE.exec(url);
      if (om && ownedIds().has(om[1])) {
        return { action: 'mock', status: 200, payload: true };
      }

      // 4) Détails d'items — réécriture de la réponse réelle (fetch seulement).
      if (matchAny(DETAILS_PATTERNS, url)) {
        return { action: 'rewrite' };
      }

      return null;
    }, null);
  }

  // Réécrit owned=true dans une réponse de détails d'items.
  function rewriteDetails(data) {
    return safe('rewriteDetails', () => {
      const ids = ownedIds();
      if (!ids.size || !data) return data;
      const list = Array.isArray(data) ? data : (Array.isArray(data.data) ? data.data : null);
      if (!list) return data;
      for (const it of list) {
        if (!it || typeof it !== 'object') continue;
        const id = String(it.id || it.itemTargetId || it.collectibleItemId || '');
        if (id && ids.has(id)) { it.owned = true; it.testMode = true; }
      }
      return data;
    }, data);
  }

  const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };

  /* --- 6a. fetch ---------------------------------------------------------- */
  const origFetch = window.fetch;
  if (typeof origFetch === 'function') {
    window.fetch = function (input, init) {
      let url = '', method = 'GET', body = null;
      safe('fetch/parse', () => {
        if (typeof input === 'string')                                    url = input;
        else if (typeof URL !== 'undefined' && input instanceof URL)      url = input.href;
        else if (input && input.url)                                      url = input.url;
        method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
        body   = (init && init.body) || null;
      });

      const d = decide(url, method, body);

      if (d && d.action === 'block') {
        return Promise.reject(new TypeError(TAG + " requête d'achat bloquée (bac à sable local)"));
      }
      if (d && d.action === 'mock') {
        return Promise.resolve(new Response(JSON.stringify(d.payload), {
          status: d.status || 200, statusText: 'OK', headers: JSON_HEADERS
        }));
      }
      if (d && d.action === 'rewrite') {
        return origFetch.apply(this, arguments).then((res) =>
          res.clone().json()
            .then((data) => new Response(JSON.stringify(rewriteDetails(data)), {
              status: res.status, statusText: res.statusText, headers: JSON_HEADERS
            }))
            .catch(() => res)          // pas du JSON ? on rend la réponse d'origine
        );
      }

      return origFetch.apply(this, arguments);
    };
    log('fetch intercepté');
  } else {
    warn('window.fetch introuvable — interception fetch inactive');
  }

  /* --- 6b. XMLHttpRequest -------------------------------------------------
   *  On ne peut pas écrire dans xhr.status / responseText : ce sont des
   *  accesseurs du prototype. On les MASQUE avec des propriétés propres sur
   *  l'instance (une own property l'emporte sur un getter hérité), puis on
   *  rejoue la séquence d'événements attendue par les appelants.
   * ---------------------------------------------------------------------- */
  const XHR = window.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const origOpen  = XHR.prototype.open;
    const origSend  = XHR.prototype.send;
    const origAbort = XHR.prototype.abort;

    XHR.prototype.open = function (method, url) {
      safe('xhr/open', () => {
        this.__rbxTm = {
          method: String(method || 'GET').toUpperCase(),
          url: String(url || ''),
          aborted: false
        };
      });
      return origOpen.apply(this, arguments);
    };

    XHR.prototype.abort = function () {
      safe('xhr/abort', () => { if (this.__rbxTm) this.__rbxTm.aborted = true; });
      return origAbort.apply(this, arguments);
    };

    XHR.prototype.send = function (body) {
      const meta = this.__rbxTm;
      const d = meta ? decide(meta.url, meta.method, body) : null;

      // 'rewrite' n'est pas supporté en XHR (pas de clone de réponse possible) :
      // on laisse passer, la pastille DOM (§4) prend le relais côté affichage.
      if (!d || d.action === 'rewrite') return origSend.apply(this, arguments);

      const xhr = this;
      const blocked = d.action === 'block';
      const text = blocked ? '' : JSON.stringify(d.payload);

      // Aucun appel à origSend : la requête ne quitte jamais le navigateur.
      setTimeout(() => {
        safe('xhr/deliver', () => {
          if (meta && meta.aborted) return;

          const own = (k, v) => Object.defineProperty(xhr, k, { configurable: true, get: () => v });
          const fn  = (k, v) => Object.defineProperty(xhr, k, { configurable: true, writable: true, value: v });

          own('readyState', 4);
          own('status',      blocked ? 0 : (d.status || 200));
          own('statusText',  blocked ? '' : 'OK');
          own('responseURL', meta ? meta.url : '');
          own('responseText', text);
          own('response', xhr.responseType === 'json' ? d.payload : text);
          fn('getAllResponseHeaders', () =>
            blocked ? '' : 'content-type: application/json; charset=utf-8\r\n');
          fn('getResponseHeader', (h) =>
            (!blocked && String(h).toLowerCase() === 'content-type')
              ? 'application/json; charset=utf-8' : null);

          const fire = (type) => safe('xhr/event:' + type, () => {
            const ev = (typeof ProgressEvent === 'function') ? new ProgressEvent(type) : new Event(type);
            xhr.dispatchEvent(ev);   // déclenche aussi les handlers onload / onerror
          });

          fire('readystatechange');
          fire(blocked ? 'error' : 'load');
          fire('loadend');
        });
      }, 0);
    };
    log('XMLHttpRequest intercepté');
  } else {
    warn('XMLHttpRequest introuvable — interception XHR inactive');
  }

  /* ===========================================================================
   * 7. PANNEAU DE CONTRÔLE (replié par défaut, ancré au bandeau)
   * ======================================================================== */

  function buildPanel() {
    if (panelEl) return panelEl;

    panelEl = document.createElement('div');
    panelEl.id = PANEL_ID;
    panelEl.hidden = true;   // replié par défaut

    const h = document.createElement('h4');
    h.textContent = 'Panneau TEST MODE';
    panelEl.appendChild(h);

    // --- Solde fictif courant (marqué comme toute valeur simulée) ---
    readoutEl = document.createElement('span');
    readoutEl.className = 'rbx-tm-readout rbx-fake-value';
    panelEl.appendChild(readoutEl);

    // --- Réglage du solde ---
    const rowBal = document.createElement('div');
    rowBal.className = 'rbx-tm-row';
    const lbl = document.createElement('label');
    lbl.textContent = 'Solde';
    balanceInput = document.createElement('input');
    balanceInput.type = 'number';
    balanceInput.min = '0';
    balanceInput.step = '1';
    const applyBtn = document.createElement('button');
    applyBtn.type = 'button';
    applyBtn.textContent = 'Appliquer';
    applyBtn.addEventListener('click', () => {
      const v = Math.floor(Number(balanceInput.value));
      if (!isFinite(v)) return;
      state.balance = Math.max(0, v);
      saveState();
      refreshPanel();
      scheduleScan();
      log('solde fictif réglé sur', fmt(state.balance));
    });
    balanceInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') applyBtn.click(); });
    rowBal.append(lbl, balanceInput, applyBtn);
    panelEl.appendChild(rowBal);

    // --- Interception on/off ---
    const rowInt = document.createElement('div');
    rowInt.className = 'rbx-tm-row';
    interceptBox = document.createElement('input');
    interceptBox.type = 'checkbox';
    interceptBox.id = 'rbx-tm-intercept';
    interceptBox.addEventListener('change', () => {
      state.intercept = !!interceptBox.checked;
      saveState();
      log('interception ' + (state.intercept ? 'ACTIVÉE' : 'DÉSACTIVÉE (achats bloqués)'));
      refreshPanel();
    });
    const intLbl = document.createElement('label');
    intLbl.setAttribute('for', 'rbx-tm-intercept');
    intLbl.textContent = 'Interception active';
    rowInt.append(interceptBox, intLbl);
    panelEl.appendChild(rowInt);

    // --- Actions ---
    const rowAct = document.createElement('div');
    rowAct.className = 'rbx-tm-row';

    const clearBtn = document.createElement('button');
    clearBtn.type = 'button';
    clearBtn.textContent = "Vider l'historique";
    clearBtn.addEventListener('click', () => {
      state.owned = [];
      saveState();
      document.querySelectorAll('.rbx-tm-owned-badge').forEach((b) => b.remove());
      document.querySelectorAll('[data-rbx-owned-mark]').forEach((e) => {
        safe('clearMark', () => { delete e.dataset.rbxOwnedMark; });
      });
      refreshPanel();
      log("historique d'achats vidé");
    });

    const exportBtn = document.createElement('button');
    exportBtn.type = 'button';
    exportBtn.textContent = 'Exporter JSON';
    exportBtn.addEventListener('click', exportJson);

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.textContent = 'Réinitialiser';
    resetBtn.addEventListener('click', () => {
      safe('reset', () => localStorage.removeItem(STORAGE_KEY));
      Object.assign(state, blankState());
      saveState();
      refreshPanel();
      scheduleScan();
      log('état réinitialisé');
    });

    rowAct.append(clearBtn, exportBtn, resetBtn);
    panelEl.appendChild(rowAct);

    // --- Historique ---
    ownedCountEl = document.createElement('div');
    ownedCountEl.className = 'rbx-tm-row';
    panelEl.appendChild(ownedCountEl);

    ownedListEl = document.createElement('ul');
    panelEl.appendChild(ownedListEl);

    const hint = document.createElement('span');
    hint.className = 'rbx-tm-hint';
    hint.textContent = "Interception désactivée = les achats sont bloqués, pas relayés. "
                     + "Dans les deux cas, rien ne part vers Roblox. Console : rbxTest.";
    panelEl.appendChild(hint);

    return panelEl;
  }

  // Rafraîchissement complet (à l'ouverture / après action).
  function refreshPanel() {
    safe('refreshPanel', () => {
      if (!panelEl) return;
      if (balanceInput && document.activeElement !== balanceInput) {
        balanceInput.value = String(state.balance);
      }
      if (interceptBox) interceptBox.checked = !!state.intercept;
      refreshPanelReadouts();

      if (ownedListEl) {
        ownedListEl.textContent = '';
        state.owned.slice(-8).reverse().forEach((it) => {
          const li = document.createElement('li');
          li.className = 'rbx-fake-value';
          const name = it.name || it.assetId || it.productId || it.key;
          li.textContent = String(name).slice(0, 40) + ' — ' + fmt(it.price) + ' R$ (fictif)';
          ownedListEl.appendChild(li);
        });
      }
    });
  }

  // Rafraîchissement léger appelé à chaque passe de scan.
  function refreshPanelReadouts() {
    safe('refreshPanelReadouts', () => {
      if (readoutEl)    readoutEl.textContent = fmt(state.balance) + ' R$ (fictif)';
      if (ownedCountEl) ownedCountEl.textContent = 'Achats simulés : ' + state.owned.length;
    });
  }

  function exportJson() {
    safe('exportJson', () => {
      const dump = JSON.stringify({
        exportedAt: new Date().toISOString(),
        testMode: true,
        note: 'Données 100 % fictives, générées localement.',
        state
      }, null, 2);

      const blob = new Blob([dump], { type: 'application/json' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = 'roblox-testmode-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      log('état exporté', dump);   // repli si le téléchargement est bloqué
    });
  }

  /* ===========================================================================
   * 8. API CONSOLE
   * ======================================================================== */

  window.rbxTest = {
    get state() { return state; },
    setBalance(n) {
      state.balance = Math.max(0, Number(n) || 0);
      saveState(); refreshPanel(); scheduleScan();
      return state.balance;
    },
    clearOwned()    { state.owned = []; saveState(); refreshPanel(); return true; },
    setIntercept(b) { state.intercept = !!b; saveState(); refreshPanel(); return state.intercept; },
    export()        { exportJson(); },
    rescan()        { scheduleScan(); },
    reset()         { safe('reset', () => localStorage.removeItem(STORAGE_KEY)); location.reload(); }
  };

  log('prêt — bandeau et marqueurs .rbx-fake-value non désactivables par design.');
})();
