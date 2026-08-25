// ==UserScript==
// @name         Roblox TEST MODE — chargeur (mise à jour auto)
// @namespace    perso-test
// @version      1.0
// @description  Fichier local minimal : télécharge et exécute la dernière version du script depuis GitHub. À installer une seule fois, puis à ne plus jamais toucher.
// @match        https://*.roblox.com/*
// @run-at       document-start
// @inject-into  page
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @connect      raw.githubusercontent.com
// ==/UserScript==

(function () {
  'use strict';

  // ---------- CONFIG ----------
  const SRC = 'https://raw.githubusercontent.com/guildenapp/roblox-testmode.user.js/main/roblox-testmode.user.js';
  const CACHE_KEY = 'rbx_testmode_code';
  const STAMP_KEY = 'rbx_testmode_code_at';
  const MAX_AGE = 6 * 60 * 60 * 1000;   // on ne vérifie GitHub qu'une fois toutes les 6 h
  // ----------------------------

  // Capturé avant que le code téléchargé ne remplace fetch par sa version simulée.
  const netFetch = window.fetch && window.fetch.bind(window);

  const log = (...a) => console.log('[TEST MODE / chargeur]', ...a);

  function run(code, origine) {
    try {
      // eval indirect : soumis à la CSP de la page (voir README si ça échoue).
      new Function(code)();
      log('code exécuté depuis', origine);
      return true;
    } catch (e) {
      console.error('[TEST MODE / chargeur] exécution impossible :', e);
      return false;
    }
  }

  function readCache() {
    try { return localStorage.getItem(CACHE_KEY); } catch { return null; }
  }
  function writeCache(code) {
    try {
      localStorage.setItem(CACHE_KEY, code);
      localStorage.setItem(STAMP_KEY, String(Date.now()));
    } catch { /* quota ou stockage bloqué */ }
  }
  function cacheAge() {
    try { return Date.now() - Number(localStorage.getItem(STAMP_KEY) || 0); } catch { return Infinity; }
  }

  function download(url) {
    const busted = url + (url.includes('?') ? '&' : '?') + 't=' + Date.now();

    // GM.xmlHttpRequest passe outre la CSP de la page ; fetch, non.
    const gmx = (typeof GM !== 'undefined' && GM && GM.xmlHttpRequest) ||
                (typeof GM_xmlhttpRequest === 'function' && GM_xmlhttpRequest);

    if (gmx) {
      return new Promise((resolve, reject) => {
        gmx({
          method: 'GET',
          url: busted,
          onload: (r) => (r.status >= 200 && r.status < 300
            ? resolve(r.responseText)
            : reject(new Error('HTTP ' + r.status))),
          onerror: () => reject(new Error('erreur réseau')),
          ontimeout: () => reject(new Error('délai dépassé'))
        });
      });
    }

    if (!netFetch) return Promise.reject(new Error('aucun moyen de télécharger'));
    return netFetch(busted, { cache: 'no-store' })
      .then(r => (r.ok ? r.text() : Promise.reject(new Error('HTTP ' + r.status))));
  }

  // Une réponse d'erreur GitHub (« 404: Not Found ») ne doit jamais écraser le cache.
  function looksValid(code) {
    return typeof code === 'string' &&
           code.length > 500 &&
           code.includes('==UserScript==') &&
           code.includes('rbx_testmode_state');
  }

  // ---------- 1. Exécution immédiate depuis le cache ----------
  // Indispensable : attendre le réseau à document-start laisserait passer les
  // premiers appels réseau de la page, donc le vrai solde.
  const cached = readCache();
  const ranFromCache = cached ? run(cached, 'le cache local') : false;

  // ---------- 2. Rafraîchissement en arrière-plan ----------
  if (ranFromCache && cacheAge() < MAX_AGE) return;   // vérification récente : rien à faire

  download(SRC).then(code => {
    if (!looksValid(code)) throw new Error('réponse inattendue, cache conservé');

    if (code === cached) {
      writeCache(code);                 // même code : on ne remet à jour que l'horodatage
      return;
    }

    writeCache(code);
    if (ranFromCache) log('nouvelle version en cache, active au prochain rechargement');
    else run(code, 'GitHub');           // tout premier lancement : on exécute sans attendre
  }).catch(e => log('mise à jour impossible :', e.message, '— on garde la version en cache'));
})();
