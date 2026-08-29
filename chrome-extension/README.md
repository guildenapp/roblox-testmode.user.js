# Roblox TEST MODE — Chrome extension

Loads the test-mode script into roblox.com and keeps it up to date on its own.

The script is **not** bundled here. The service worker downloads it from GitHub
and registers it through `chrome.userScripts`, the only API that accepts remote
code in the page's own context and is exempt from the site's Content Security
Policy. That is what makes automatic updates possible without repacking the
extension. It checks hourly, on browser start, and whenever you click the
toolbar icon. If the download fails, the last working version stays registered.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Open this extension's **Details** and turn on **Allow User Scripts**.
   On Chrome versions that don't show that switch, Developer mode alone is enough.
5. Open roblox.com. The panel appears at the top of **Settings** and **Inventory**.

Step 4 matters: without it `chrome.userScripts` is unavailable, nothing is
injected, and the service worker console says so.

## Check it is working

On `chrome://extensions`, click **service worker** under this extension to open
its console. It logs the version it registered. Clicking the toolbar icon forces
a check and shows the version on the badge.

On roblox.com, the browser console gives you `rbxTest.state`, `rbxTest.panel()`,
`rbxTest.setBalance(n)`, `rbxTest.spoof('username')`.

## Do not also install the userscript

If Tampermonkey already runs the same script, you would get two copies. The
script guards against double interception, but keep just one.
