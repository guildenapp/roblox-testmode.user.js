// ==UserScript==
// @name         Roblox TEST MODE — faux solde + achats simulés
// @namespace    perso-test
// @version      0.1
// @description  Bac à sable local : affiche un solde fictif et simule les achats catalogue. Rien n'est envoyé à Roblox.
// @match        https://*.roblox.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // ---------- CONFIG ----------
  const FAKE_BALANCE = 2000000;   // ton faux solde
  const STORAGE_KEY = 'rbx_testmode_state';
  // ----------------------------

  const state = load();

  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) ||
             { balance: FAKE_BALANCE, owned: [] };
    } catch {
      return { balance: FAKE_BALANCE, owned: [] };
    }
  }
  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  // ---------- 1. BANDEAU TEST MODE ----------
  // Volontairement impossible à masquer sans éditer ce fichier.
  const BANNER_ID = 'rbx-testmode-banner';
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

  // ---------- 2. FAUX SOLDE ----------
  // React re-rend le header en permanence : on réécrit à chaque mutation.
  const BALANCE_SELECTORS = [
    '#nav-robux-amount',
    '#nav-robux-balance',
    '.text-robux-tab',
    '[data-testid="navigation-robux-amount"]'
  ];

  function paintBalance() {
    const txt = state.balance.toLocaleString('fr-FR');
    for (const sel of BALANCE_SELECTORS) {
      document.querySelectorAll(sel).forEach(el => {
        if (el.dataset.rbxFake === txt) return;
        el.textContent = txt;
        el.dataset.rbxFake = txt;
        el.classList.add('rbx-fake-value');
      });
    }
  }

  const obs = new MutationObserver(() => {
    injectBanner();
    paintBalance();
  });

  document.addEventListener('DOMContentLoaded', () => {
    injectBanner();
    paintBalance();
    obs.observe(document.body, { childList: true, subtree: true });
  });

  // ---------- 3. INTERCEPTION DES ACHATS ----------
  // On ne laisse PAS partir la requête : on renvoie une réponse fabriquée.
  const PURCHASE_PATTERNS = [
    /\/v1\/purchases\/products\//,
    /marketplace-sales\/v\d+\/item/,
    /economy\.roblox\.com\/v1\/purchases/
  ];

  const isPurchase = (url) => PURCHASE_PATTERNS.some(re => re.test(url));

  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url) || '';

    if (isPurchase(url)) {
      let price = 0;
      try {
        const body = init && init.body ? JSON.parse(init.body) : {};
        price = Number(body.expectedPrice || body.price || 0);
      } catch { /* body non-JSON */ }

      state.balance = Math.max(0, state.balance - price);
      state.owned.push({ url, price, at: new Date().toISOString() });
      save();
      paintBalance();

      console.log('[TEST MODE] achat simulé', { url, price, solde: state.balance });

      return new Response(JSON.stringify({
        purchased: true,
        reason: 'Success',
        showDivId: 'TestMode',
        testMode: true          // marqueur laissé volontairement dans la réponse
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    return origFetch.apply(this, arguments);
  };

  // Console : rbxTest.reset() pour repartir de zéro
  window.rbxTest = {
    state,
    reset() { localStorage.removeItem(STORAGE_KEY); location.reload(); },
    setBalance(n) { state.balance = n; save(); paintBalance(); }
  };
})();
