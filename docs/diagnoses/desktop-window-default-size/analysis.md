# Desktop Window Default Size Diagnosis

## Problem description

The desktop Electron app should choose its initial main-window size from the
current display:

- If the available display resolution is at least `1366x768`, the app should
  open at `1366x768`.
- If the available display resolution is smaller than `1366x768`, the app
  should open fullscreen so the interface remains usable.
- Users should still be able to resize, maximize, restore, and minimize the
  window after startup.

Current behavior does not implement this rule. First-run configuration creates a
`1440x900` main-window bounds object, and main-window construction falls back to
`1440x900` with `minWidth: 1024` and `minHeight: 640`.

## Reproduction steps

### Minimal repro without launching the GUI

Run from the repository root:

```powershell
node -e "const fs=require('fs'); const path=require('path'); const root=path.resolve('.agentmesh/repro-window-bounds'); fs.mkdirSync(root,{recursive:true}); const dir=fs.mkdtempSync(path.join(root,'case-')); const {initUserData}=require('./desktop/main/config'); initUserData({userDataPath:dir,appVersion:'repro',envTemplatePath:path.resolve('desktop/scripts/env.template.desktop')}); const config=JSON.parse(fs.readFileSync(path.join(dir,'desktop-config.json'),'utf8')); console.log(JSON.stringify({userDataPath:dir,windowBounds:config.windowBounds},null,2));"
```

Observed output:

```json
{
  "userDataPath": "M:\\takoAI\\Ecliptrix\\.agentmesh\\repro-window-bounds\\case-MQUWud",
  "windowBounds": {
    "width": 1440,
    "height": 900
  }
}
```

Expected output for a display larger than `1366x768`:

```json
{
  "windowBounds": {
    "width": 1366,
    "height": 768
  }
}
```

On the current machine, the primary display is larger than the requested default
size:

```text
Primary bounds:      1755x1097
Primary workingArea: 1755x1049
```

Therefore the app should default to `1366x768`, not `1440x900`.

### Manual packaged-app repro

1. Use a Windows display whose available work area is larger than `1366x768`.
2. Start the desktop app with a fresh user data directory, or delete/rename
   `%APPDATA%\Ecliptrix\desktop-config.json`.
3. Open `desktop-config.json` after first startup.
4. Observe `windowBounds.width` and `windowBounds.height`.
5. Actual: `1440x900`.
6. Expected: `1366x768`.

### Small-display repro

1. Use a Windows display or VM resolution smaller than `1366x768`.
2. Start the desktop app with a fresh user data directory.
3. Observe the main window after startup.
4. Actual: the app still attempts persisted/default bounds and has no fullscreen
   branch.
5. Expected: the main window should open fullscreen by default.

## Root cause analysis

The root cause is that initial window sizing is configuration-driven and
hard-coded. The code never asks Electron for the current display size, so it
cannot apply the requested `1366x768` versus fullscreen rule.

Evidence:

- `desktop/main/config.js:13` defines first-run config through `defaultConfig`.
- `desktop/main/config.js:18` sets `windowBounds: { width: 1440, height: 900 }`.
- `desktop/main/window.js:34` creates the main `BrowserWindow`.
- `desktop/main/window.js:35` uses `(bounds && bounds.width) || 1440`.
- `desktop/main/window.js:36` uses `(bounds && bounds.height) || 900`.
- `desktop/main/window.js:39` sets `minWidth: 1024`.
- `desktop/main/window.js:40` sets `minHeight: 640`.
- `desktop/main/index.js:247` wraps main-window creation.
- `desktop/main/index.js:250` passes `state.config.windowBounds` directly to
  `windows.createMainWindow`.

No code under `desktop/main` references `screen`, `getPrimaryDisplay`,
`workArea`, `workAreaSize`, or any equivalent display query. The only relevant
matches are the hard-coded bounds above and regular maximize/minimize IPC in
`desktop/main/windowControls.js`.

This means:

1. On first run, `initUserData` persists `1440x900` before the window is
   created.
2. `index.js` passes that persisted value into `createMainWindow`.
3. `window.js` constructs `BrowserWindow` using the persisted value.
4. Because the persisted value exists, the fallback `1440x900` literals in
   `window.js` are not normally reached, but they encode the same incorrect
   default.
5. There is no branch for displays smaller than `1366x768`, so fullscreen
   startup cannot happen.

Reviewer audit additions:

- The cited code is on the failing path. `desktop/main/index.js:89-96` calls
  `initUserData` after `app.whenReady()`, `desktop/main/index.js:122-124`
  creates the dev main window from the same initialized state, and
  `desktop/main/index.js:150-153` creates the packaged main window after
  services start. Both branches then route through `desktop/main/index.js:247-257`
  and pass `state.config.windowBounds` into `windows.createMainWindow`.
- `desktop/main/config.js:40-49` always starts from `defaultConfig`, merges any
  existing JSON over it, updates `lastRunVersion`, and writes the config back.
  Because `desktop/main/config.js:18` seeds `windowBounds`, a fresh first-run
  config already looks like a saved bounds object before the user has resized
  anything.
- This is the important counter-example for candidate fixes: in the current
  config shape, "valid saved bounds" cannot mean "user-resized bounds". A helper
  that blindly preserves any valid `bounds` object would preserve the synthetic
  first-run `1440x900` value and leave the bug unfixed.
- A fix that only changes the fallback literals in `desktop/main/window.js:35-36`
  is also insufficient, because normal startup does not reach those fallbacks
  while `desktop-config.json` contains `windowBounds`.
- `desktop/main/window.js:67-70` persists bounds only on close and only when the
  window is not maximized or minimized. Any fullscreen startup branch should
  avoid treating the policy-generated fullscreen size as a permanent user
  preference that suppresses the small-display fullscreen rule on later starts.

## Impact surface

- First-time desktop users with a normal desktop/laptop display larger than
  `1366x768` get a `1440x900` startup window instead of the requested compact
  default.
- Users on smaller displays, low-resolution VMs, or constrained remote desktop
  sessions may get a window that does not fit the available work area.
- Existing users may continue to see persisted old bounds because
  `desktop-config.json` is loaded and merged over defaults.
- Maximize/minimize controls are not broken; `desktop/main/windowControls.js`
  still supports minimize, maximize/restore, close, and maximize-state queries.

## Candidate fixes

| Option | Summary | Invasiveness | Risk | Effort |
| --- | --- | --- | --- | --- |
| A | Compute startup bounds in `desktop/main/window.js` using Electron `screen.getPrimaryDisplay().workAreaSize`; use `1366x768` when work area is large enough, otherwise create the window fullscreen. | Low | Low to medium: must avoid overriding valid user-resized persisted bounds unless the product wants every launch to normalize. | Low |
| B | Move sizing policy into `desktop/main/config.js`, changing `defaultConfig` to `1366x768`, then let `window.js` handle only the small-display fullscreen fallback. | Medium | Medium: `config.js` cannot safely use Electron `screen` unless called after `app.whenReady`, and it currently runs during startup initialization. | Medium |
| C | Add an explicit `resolveInitialWindowState` helper in `desktop/main/window.js` and unit-test it with injected display sizes and bounds. | Medium | Low: isolates policy and makes future display rules testable. | Medium |

## Recommended fix

Use option C.

Implement a small pure helper in `desktop/main/window.js`, for example
`resolveInitialWindowState({ savedBounds, workAreaSize })`, with these rules:

1. If there are valid saved user bounds, preserve them when they fit the current
   work area.
2. If there are no saved bounds and `workAreaSize.width >= 1366` and
   `workAreaSize.height >= 768`, return `width: 1366`, `height: 768`, and
   `fullscreen: false`.
3. If the work area is smaller than `1366x768`, return fullscreen startup state.
4. Keep `resizable: true` behavior unchanged so users can resize after startup.
5. Set `minWidth` / `minHeight` consistently with the new policy, likely
   `1366` / `768` only if the product truly wants a minimum resize floor;
   otherwise keep a smaller minimum so users can manually shrink the window.

This is preferable because the display-dependent decision belongs near
`BrowserWindow` creation, after Electron is ready and `screen` is available. It
also gives the follow-up implementation task a narrow testable target without
reworking service startup, config loading, or renderer window controls.

## 璇勫缁撹

The evidence chain is valid: the reported `1440x900` startup size is produced by
the first-run `defaultConfig` value in `desktop/main/config.js`, then carried
through `desktop/main/index.js` into `desktop/main/window.js`. The absence of any
`screen` / `getPrimaryDisplay` / `workAreaSize` query explains both observed
symptoms: large displays cannot choose the requested `1366x768` default, and
small displays cannot choose fullscreen startup.

Final recommended fix: implement one display-aware startup sizing policy at main
window creation time, and remove the synthetic `1440x900` first-run bounds from
configuration so default bounds are not confused with user-saved bounds.

Concretely, the next node should:

1. Add a small `resolveInitialWindowState` helper in `desktop/main/window.js`
   that receives `savedBounds` plus `screen.getPrimaryDisplay().workAreaSize`.
2. Treat absent/invalid/synthetic default bounds as no saved user bounds.
3. When there is no real saved user bounds and the work area is at least
   `1366x768`, create the window at `1366x768` with `fullscreen: false`.
4. When the work area is smaller than `1366x768`, create the window fullscreen
   by default.
5. Preserve real saved user bounds only when they fit the current work area.
6. Keep `resizable: true` and do not raise `minWidth` / `minHeight` to
   `1366x768`, because that would conflict with the requirement that users can
   shrink the window and would be hostile on small displays.

This supersedes a pure `window.js` fallback-literal change and also tightens
option C: the helper is the right place for the Electron display query, but it
must be paired with changing the default config representation, for example
`windowBounds: null` or equivalent legacy-default handling. Otherwise the
existing first-run `1440x900` object will be preserved as if it were a genuine
user preference.
