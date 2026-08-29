// Deux chemins d'injection, du meilleur au plus sûr :
//
//   1. chrome.userScripts — accepte du code distant dans le contexte de la
//      page et échappe à la CSP du site. C'est ce qui permet la mise à jour
//      automatique. Exige que les scripts utilisateur soient autorisés pour
//      cette extension.
//   2. payload.js, la copie livrée avec l'extension, enregistrée en monde MAIN
//      via chrome.scripting. Ne se met pas à jour, mais fonctionne sans aucun
//      réglage supplémentaire.
//
// Le second sert de repli : l'extension marche dès l'installation, et bascule
// toute seule sur le premier dès que c'est possible.

const SOURCE = 'https://raw.githubusercontent.com/guildenapp/roblox-testmode.user.js/main/roblox-testmode.user.js';
const ID_DISTANT = 'roblox-testmode';
const ID_LIVRE = 'roblox-testmode-bundled';
const MATCHES = ['https://*.roblox.com/*'];
const INTERVALLE_MINUTES = 60;

function version(code) {
  const m = /@version\s+([\d.]+)/.exec(code || '');
  return m ? m[1] : '?';
}

// Une page d'erreur GitHub ne doit jamais remplacer une version qui marche.
function sembleValide(code) {
  return typeof code === 'string' &&
         code.length > 500 &&
         code.includes('==UserScript==') &&
         code.includes('rbx_testmode_state');
}

async function statut(texte, couleur, message) {
  try {
    await chrome.action.setBadgeText({ text: texte });
    await chrome.action.setBadgeBackgroundColor({ color: couleur });
  } catch { /* pas d'icône disponible */ }
  await chrome.storage.local.set({ statut: message, statutLe: Date.now() });
  console.log('[TEST MODE] ' + message);
}

async function telecharger() {
  const r = await fetch(SOURCE + '?t=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const code = await r.text();
  if (!sembleValide(code)) throw new Error('unexpected response from GitHub');
  return code;
}

// --- Chemin 1 : code distant, mis à jour ---
async function injecterDistant(code) {
  if (!chrome.userScripts) return false;
  const definition = {
    id: ID_DISTANT,
    matches: MATCHES,
    js: [{ code }],
    runAt: 'document_start',
    world: 'MAIN',        // indispensable : on remplace fetch et XHR de la page
    allFrames: false
  };
  try {
    const deja = await chrome.userScripts.getScripts({ ids: [ID_DISTANT] });
    if (deja.length) await chrome.userScripts.update([definition]);
    else await chrome.userScripts.register([definition]);
    return true;
  } catch (e) {
    console.warn('[TEST MODE] userScripts refused the script:', e.message);
    return false;
  }
}

// --- Chemin 2 : copie livrée, sans mise à jour ---
async function injecterLivre() {
  try {
    const deja = await chrome.scripting.getRegisteredContentScripts({ ids: [ID_LIVRE] });
    if (deja.length) return true;
    await chrome.scripting.registerContentScripts([{
      id: ID_LIVRE,
      matches: MATCHES,
      js: ['payload.js'],
      runAt: 'document_start',
      world: 'MAIN',
      allFrames: false
    }]);
    return true;
  } catch (e) {
    console.error('[TEST MODE] bundled fallback failed:', e.message);
    return false;
  }
}

async function retirer(quoi) {
  try {
    if (quoi === ID_LIVRE) await chrome.scripting.unregisterContentScripts({ ids: [ID_LIVRE] });
    else if (chrome.userScripts) await chrome.userScripts.unregister({ ids: [ID_DISTANT] });
  } catch { /* n'était pas enregistré */ }
}

async function synchroniser() {
  // La dernière version connue est remise en place d'abord : une coupure
  // réseau ne doit pas laisser les pages sans script.
  const { code: cache } = await chrome.storage.local.get('code');
  let vivant = cache ? await injecterDistant(cache) : false;

  let code = null;
  try {
    code = await telecharger();
  } catch (e) {
    console.warn('[TEST MODE] update check failed:', e.message);
  }

  if (code && code !== cache) {
    await chrome.storage.local.set({ code });
    vivant = await injecterDistant(code) || vivant;
  } else if (code && !vivant) {
    vivant = await injecterDistant(code);
  }
  await chrome.storage.local.set({ verifieLe: Date.now() });

  if (vivant) {
    await retirer(ID_LIVRE);   // sinon deux copies se disputeraient la page
    const v = version(code || cache);
    await statut('v' + v, '#1f7a3d', 'running the updating copy, version ' + v);
    return;
  }

  // Pas de scripts utilisateur : on retombe sur la copie livrée.
  const secours = await injecterLivre();
  if (secours) {
    await statut('BND', '#b36b00',
      'user scripts are not allowed for this extension, so the bundled copy is ' +
      'running instead. It works, but it will not update. Open chrome://extensions, ' +
      'open this extension\'s details and turn on "Allow User Scripts".');
  } else {
    await statut('ERR', '#b3261e',
      'nothing could be injected. Check that Developer mode is on in chrome://extensions.');
  }
}

// Au démarrage du service worker, quel qu'en soit le déclencheur. C'est ce qui
// manquait : installer l'extension avant d'autoriser les scripts utilisateur
// laissait attendre jusqu'à l'alarme suivante, une heure plus tard.
synchroniser();

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('maj', { periodInMinutes: INTERVALLE_MINUTES });
  synchroniser();
});

chrome.runtime.onStartup.addListener(synchroniser);
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'maj') synchroniser(); });
chrome.action.onClicked.addListener(synchroniser);
