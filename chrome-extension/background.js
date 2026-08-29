// Le code n'est pas embarqué dans l'extension : il est téléchargé depuis
// GitHub et enregistré via chrome.userScripts. C'est la seule API qui accepte
// du code distant dans le contexte de la page, et elle échappe à la CSP du
// site — ce qui rend la mise à jour automatique possible sans republier
// l'extension. En contrepartie, elle exige que les scripts utilisateur soient
// autorisés pour cette extension (voir le README).

const SOURCE = 'https://raw.githubusercontent.com/guildenapp/roblox-testmode.user.js/main/roblox-testmode.user.js';
const SCRIPT_ID = 'roblox-testmode';
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

async function telecharger() {
  const r = await fetch(SOURCE + '?t=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const code = await r.text();
  if (!sembleValide(code)) throw new Error('unexpected response, cache kept');
  return code;
}

async function enregistrer(code) {
  if (!chrome.userScripts) {
    console.error(
      '[TEST MODE] chrome.userScripts unavailable. Open chrome://extensions, ' +
      'open this extension\'s details and turn on "Allow User Scripts" ' +
      '(on older Chrome versions, turn on Developer mode instead).');
    return false;
  }

  const definition = {
    id: SCRIPT_ID,
    matches: MATCHES,
    js: [{ code }],
    runAt: 'document_start',
    world: 'MAIN',        // indispensable : on remplace fetch et XHR de la page
    allFrames: false
  };

  const deja = await chrome.userScripts.getScripts({ ids: [SCRIPT_ID] });
  if (deja.length) await chrome.userScripts.update([definition]);
  else await chrome.userScripts.register([definition]);
  return true;
}

async function synchroniser() {
  // On remet d'abord en place la dernière version connue : une page ouverte
  // pendant une panne réseau doit continuer de fonctionner.
  const { code: cache } = await chrome.storage.local.get('code');
  if (cache) await enregistrer(cache);

  try {
    const code = await telecharger();
    if (code === cache) {
      await chrome.storage.local.set({ verifieLe: Date.now() });
      return;
    }
    await chrome.storage.local.set({ code, verifieLe: Date.now() });
    if (await enregistrer(code)) {
      console.log('[TEST MODE] updated to version ' + version(code));
    }
  } catch (e) {
    console.warn('[TEST MODE] update check failed:', e.message,
                 cache ? '— keeping version ' + version(cache) : '— nothing cached yet');
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('maj', { periodInMinutes: INTERVALLE_MINUTES });
  synchroniser();
});

chrome.runtime.onStartup.addListener(synchroniser);
chrome.alarms.onAlarm.addListener(a => { if (a.name === 'maj') synchroniser(); });

// Clic sur l'icône : vérification immédiate, sans attendre l'heure suivante.
chrome.action.onClicked.addListener(async () => {
  await synchroniser();
  const { code } = await chrome.storage.local.get('code');
  chrome.action.setBadgeText({ text: code ? version(code).slice(0, 4) : '!' });
  chrome.action.setBadgeBackgroundColor({ color: '#335fff' });
});
