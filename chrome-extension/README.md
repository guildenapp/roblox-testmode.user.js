# Roblox TEST MODE — Chrome extension

Injects the test-mode script into roblox.com. It tries two paths, in order.

**1. Remote, self-updating.** The service worker downloads the script from
GitHub and registers it through `chrome.userScripts`, the only API that accepts
remote code in the page's own context and is exempt from the site's Content
Security Policy. It checks on every service-worker start, hourly, and when you
click the toolbar icon. A response that does not look like the script never
replaces the cached one.

**2. Bundled, static.** If user scripts are not allowed for this extension,
`payload.js` — the copy shipped in this folder — is registered instead through
`chrome.scripting`, also in the MAIN world. It works with no extra setting, but
it does not update. The extension switches back to path 1 by itself as soon as
that becomes possible, and never runs both at once.

The badge on the toolbar icon says which path is live: green `v1.9` for the
updating copy, orange `BND` for the bundled one, red `ERR` if nothing could be
injected.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and select this folder.
4. Open roblox.com. The panel is at the top of **Settings** and **Inventory**.

For automatic updates, also open this extension's **Details** and turn on
**Allow User Scripts**. Without it the extension still works, on the bundled
copy.

## If nothing happens

On `chrome://extensions`, click **service worker** under this extension to open
its console. It prints exactly which path it took and why. The same message is
kept in storage:

```js
chrome.storage.local.get('statut').then(console.log)
```

On roblox.com, the page console gives you `rbxTest.state`, `rbxTest.panel()`,
`rbxTest.setBalance(n)`, `rbxTest.spoof('username')`. If `rbxTest` is undefined,
nothing was injected.

## Keeping payload.js current

`payload.js` is a copy of `../roblox-testmode.user.js`. It only matters when the
bundled path is in use. To refresh it:

```sh
cp ../roblox-testmode.user.js payload.js
```
