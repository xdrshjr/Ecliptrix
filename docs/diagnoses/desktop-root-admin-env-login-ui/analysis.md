# Desktop root admin env and login UI diagnosis

## Problem description

Packaged desktop first-run login rejects the credentials the user expects from the
backend `.env`: `admin` / `admin`. The UI also shows an outer desktop title bar
with minimize/maximize/close controls and a full-window background/brand shell,
while the requested behavior is a simpler internal login panel with a close
button in the panel's top-right corner.

This diagnosis covers two related but independent failures:

1. The packaged desktop root credential source does not match the backend
   `.env` values the user is typing.
2. The unauthenticated desktop screen is implemented as a full-window login gate
   that owns `DesktopTitleBar`, not as a standalone inner login panel.

This subtask is analysis-only. No fix code was written.

## Reproduction steps

### Minimal source-level reproduction for the credential mismatch

Run from the repository root:

```powershell
node -e "const {parseEnvFile}=require('./desktop/main/envCheck'); const desktop=parseEnvFile('desktop/build/env.template.desktop'); const backend=parseEnvFile('backend-services/basic-service/.env'); console.log(JSON.stringify({backendAdmin:{username:backend.ADMIN_USERNAME,password:backend.ADMIN_PASSWORD},desktopRoot:{username:desktop.ROOT_USERNAME,password:desktop.ROOT_PASSWORD},adminAdminWouldPassRootPassword: desktop.ROOT_PASSWORD==='admin'}, null, 2));"
```

Observed output:

```json
{
  "backendAdmin": {
    "username": "admin",
    "password": "admin"
  },
  "desktopRoot": {
    "username": "admin",
    "password": "adminjr"
  },
  "adminAdminWouldPassRootPassword": false
}
```

This reproduces the core failure without launching Electron: the packaged
desktop first-run template uses root password `adminjr`, while the backend
`.env` admin password is `admin`. The backend root login path compares root
login attempts against `ROOT_PASSWORD`, not `ADMIN_PASSWORD`, so `admin/admin`
is rejected when `ROOT_PASSWORD=adminjr`.

### End-to-end desktop reproduction

1. Build or run the desktop app using the current desktop build template.
2. On a clean first run, let Electron copy the packaged
   `scripts/env.template.desktop` into `%APPDATA%/Ecliptrix/.env`.
3. Wait for the backend and frontend services to start.
4. On the login screen, enter username `admin` and password `admin`.
5. Observe the login failure message equivalent to "用户名或密码错误".
6. Enter username `admin` and password `adminjr`.
7. Expected from the current code: login succeeds because this is the packaged
   root password.

### UI reproduction

1. Open the desktop app while unauthenticated.
2. Observe the login screen.
3. The rendered tree includes a full-window fixed gate, `DesktopTitleBar`, a
   background ambience layer, and a two-column login/brand dialog.
4. The top window controls come from `DesktopTitleBar`, so minimize, maximize,
   and close are visible outside the login panel.

## Root cause analysis

### Root cause 1: desktop root credentials are sourced from `ROOT_*`, not backend `ADMIN_*`

The desktop first-run `.env` is copied from the packaged template into the
userData directory on first launch. Evidence:

- `desktop/main/index.js:91` resolves `scripts/env.template.desktop`.
- `desktop/main/config.js:33` sets `envPath` to userData `.env`.
- `desktop/main/config.js:34` and `desktop/main/config.js:36` copy the packaged
  template only if the userData `.env` does not already exist.
- `desktop/electron-builder.yml:25` to `desktop/electron-builder.yml:35` package
  `build/env.template.desktop` into `scripts/env.template.desktop` inside asar.

The current packaged template root credentials are not `admin/admin`:

- `desktop/build/env.template.desktop:64` has `ROOT_USERNAME=admin`.
- `desktop/build/env.template.desktop:65` has `ROOT_PASSWORD=adminjr`.
- The source template also states the factory default is `admin / adminjr` and
  sets `ROOT_PASSWORD=adminjr` at `desktop/scripts/env.template.desktop:52` to
  `desktop/scripts/env.template.desktop:53`.

The build script intentionally excludes the backend `.env` admin credentials:

- `desktop/scripts/prepare-env.js:30` to `desktop/scripts/prepare-env.js:36`
  says desktop admin login is governed by `ROOT_USERNAME` / `ROOT_PASSWORD`, and
  that `ADMIN_USERNAME` / `ADMIN_PASSWORD` are excluded.
- `desktop/scripts/prepare-env.js:38` defines `LOCAL_ADMIN_KEYS` as
  `['ADMIN_USERNAME', 'ADMIN_PASSWORD']`.
- `desktop/scripts/prepare-env.js:39` adds those keys to `EXCLUDED_KEYS`.

The backend then gives `ROOT_*` priority over `ADMIN_*`:

- `backend-services/basic-service/app/config.py:968` reads `ADMIN_USERNAME`.
- `backend-services/basic-service/app/config.py:969` reads `ADMIN_PASSWORD`.
- `backend-services/basic-service/app/config.py:970` sets `root_username` from
  `ROOT_USERNAME` first, falling back to `ADMIN_USERNAME`.
- `backend-services/basic-service/app/config.py:971` sets `root_password` from
  `ROOT_PASSWORD` first, falling back to `ADMIN_PASSWORD`.

The database startup syncs the root user from `settings.auth.root_password`:

- `backend-services/basic-service/app/database.py:123` reads
  `settings.auth.root_username`.
- `backend-services/basic-service/app/database.py:124` reads
  `settings.auth.root_password`.
- `backend-services/basic-service/app/database.py:139` to
  `backend-services/basic-service/app/database.py:142` hashes that root
  password.
- Existing root users are overwritten at
  `backend-services/basic-service/app/database.py:144` to
  `backend-services/basic-service/app/database.py:154`; new or promoted users
  are also assigned the same hash at
  `backend-services/basic-service/app/database.py:161` to
  `backend-services/basic-service/app/database.py:182`.

Finally, root login does not verify against the stored hash. It compares the
typed password directly to `settings.auth.root_password`:

- `backend-services/basic-service/app/services/auth_service.py:172` to
  `backend-services/basic-service/app/services/auth_service.py:179` use
  `hmac.compare_digest(login_data.password, settings.auth.root_password)` for
  root users.
- `backend-services/basic-service/app/services/auth_service.py:183` to
  `backend-services/basic-service/app/services/auth_service.py:197` return
  `INVALID_CREDENTIALS` when that comparison fails.

Therefore, `admin/admin` fails in the packaged desktop when `ROOT_PASSWORD` is
`adminjr`, even if the backend service `.env` contains `ADMIN_PASSWORD=admin`.

### Root cause 2: the login UI is intentionally a full-window gate with `DesktopTitleBar`

The current unauthenticated desktop login UI is implemented as a full-window,
non-closable gate:

- `src/components/auth/LoginScreen.tsx:24` to
  `src/components/auth/LoginScreen.tsx:35` document it as a full-window,
  non-closable login gate that owns the single `DesktopTitleBar`.
- `src/components/auth/LoginScreen.tsx:70` to
  `src/components/auth/LoginScreen.tsx:73` explicitly include title-bar window
  controls in the focus trap.
- `src/components/auth/LoginScreen.tsx:98` to
  `src/components/auth/LoginScreen.tsx:103` render a fixed full-screen container
  and `DesktopTitleBar`.
- `src/components/auth/LoginScreen.tsx:105` to
  `src/components/auth/LoginScreen.tsx:115` render the full-window background
  ambience.
- `src/components/auth/LoginScreen.tsx:126` to
  `src/components/auth/LoginScreen.tsx:135` render a large dialog with a brand
  hero column.

The window controls the user sees are not part of the login form itself. They
come from `DesktopTitleBar`:

- `src/components/desktop/DesktopTitleBar.tsx:79` to
  `src/components/desktop/DesktopTitleBar.tsx:82` render the title bar shell.
- `src/components/desktop/DesktopTitleBar.tsx:124` to
  `src/components/desktop/DesktopTitleBar.tsx:134` render minimize.
- `src/components/desktop/DesktopTitleBar.tsx:136` to
  `src/components/desktop/DesktopTitleBar.tsx:158` render maximize/restore.
- `src/components/desktop/DesktopTitleBar.tsx:160` to
  `src/components/desktop/DesktopTitleBar.tsx:166` render close.

This explains the UI symptom directly: the current code is built to show an
outer window title bar and full-window login gate, while the requested design
requires removing that outer login chrome and putting a close action inside the
login panel.

## Impact surface

| Area | Impact |
|---|---|
| Packaged desktop first run | A clean userData `.env` is initialized from the packaged desktop template, so users who follow backend `.env` `ADMIN_PASSWORD=admin` will be rejected. |
| Existing desktop installs | Existing userData `.env` files are not overwritten by `initUserData`, so installs already carrying `ROOT_PASSWORD=adminjr` keep failing for `admin/admin` until migrated or edited. |
| Backend/web server mode | Less likely affected when only `ADMIN_*` exists, because `config.py` falls back to `ADMIN_PASSWORD`. If `ROOT_PASSWORD` is set, root login uses it. |
| Login UI | All unauthenticated desktop users see the full-window gate and title-bar controls, not the requested panel-only login surface. |
| Auth security | Root login remains protected; the failure is a configuration/source-of-truth mismatch, not a bypass. |

## Candidate fixes

| Fix | Description | Invasiveness | Risk | Effort |
|---|---|---:|---:|---:|
| A. Align desktop root defaults to `admin/admin` and migrate stale userData `.env` | Change desktop source/generated template `ROOT_PASSWORD` to `admin`; update build generation comments; extend `backfillUserEnv`/migration logic so existing first-run `.env` files with old factory `adminjr` are rewritten to the new default unless user-customized. | Low-medium | Medium: migration must avoid overwriting intentional user changes. | Low |
| B. Make `ADMIN_*` the desktop root source of truth | Stop excluding `ADMIN_USERNAME`/`ADMIN_PASSWORD` in `prepare-env.js`, or map backend `ADMIN_*` into desktop `ROOT_*` during template generation. Keep backend `ROOT_*` priority. | Medium | Medium-high: may leak build-machine admin defaults into installers unless carefully controlled; conflicts with existing comments saying `ADMIN_*` is local-only. | Medium |
| C. Keep `adminjr` but update user-facing docs/UI hints | Treat current `admin/adminjr` as intended and change README/task assumptions. | Low | High: contradicts the user requirement and backend `.env` expectation; does not fix the reported failure. | Low |
| D. Simplify desktop login UI panel | Refactor `LoginScreen` so unauthenticated desktop does not render `DesktopTitleBar` or background/brand shell; render only the internal login panel and add a top-right close button wired to `window.ecliptrixDesktop.windowControls.close()`. | Medium | Medium: must preserve focus management, desktop-only behavior, and avoid duplicate close controls. | Medium |

## Recommended fix

Use fix A for authentication and fix D for UI.

For authentication, the least surprising source of truth is the root account
credentials in the desktop `.env`, but they must match the advertised/default
credentials the user sees and the backend `.env` currently uses. Set desktop
`ROOT_PASSWORD=admin`, regenerate/package the desktop template, and add a
targeted migration for stale factory values so existing first-run installs do
not remain stuck on `adminjr`. This preserves the existing backend architecture:
`ROOT_*` stays authoritative for the root account, and `database.py` continues
to sync that root account on startup.

For UI, change `LoginScreen` from a full-window gate with `DesktopTitleBar` into
the requested panel-only surface. The close button should be inside the login
panel's top-right corner and call the existing desktop close IPC. Remove the
login-screen `DesktopTitleBar` usage so minimize/maximize are not shown on the
login surface.

Do not choose fix B unless product explicitly wants installers to inherit
developer/build-machine `ADMIN_*` values. The current comments already identify
that as an intentional exclusion. Do not choose fix C because it leaves the user
reported `admin/admin` failure unresolved.

## Reviewer evidence update

The original report correctly identified two user-visible symptoms, but part of
the authentication evidence is stale for the current desktop implementation. The
currently available source tree does not contain the cited legacy files
`desktop/main/index.js`, `desktop/build/env.template.desktop`,
`desktop/scripts/env.template.desktop`, `backend-services/basic-service/app/*`,
or `src/components/auth/LoginScreen.tsx`. The current packaged desktop path uses
the `desktop/src/main/*` TypeScript main process, a separate
`desktop/auth-portal` renderer, and a release layout with `resources/app.asar`,
`resources/auth-portal`, and `resources/server`.

Current authentication evidence:

- `desktop/scripts/build.ts:81` to `desktop/scripts/build.ts:101` parses the
  repository root `.env`.
- `desktop/scripts/build.ts:104` to `desktop/scripts/build.ts:160` bakes root
  credentials into `desktop/src/main/baked-root-credentials.ts` before
  `electron-tsc`. The documented priority at `desktop/scripts/build.ts:109` to
  `desktop/scripts/build.ts:110` and the implementation at
  `desktop/scripts/build.ts:123` to `desktop/scripts/build.ts:128` are
  `DESKTOP_ROOT_USERNAME/PASSWORD` first, then `AUTH_ROOT_USERNAME/PASSWORD`.
- `desktop/scripts/build.ts:395` to `desktop/scripts/build.ts:404` executes
  that bake step as part of the desktop build before the Electron main process
  is compiled.
- `desktop/src/main/baked-root-credentials.ts:1` to
  `desktop/src/main/baked-root-credentials.ts:19` confirms the source file is
  only a placeholder and the packaged `dist/main/baked-root-credentials.js` is
  expected to carry the build-time values.
- `desktop/src/main/auth-root.ts:22` to `desktop/src/main/auth-root.ts:35`
  repeats the runtime priority: baked credentials, then `DESKTOP_ROOT_*`, then
  `AUTH_ROOT_*`.
- `desktop/src/main/auth-client.ts:153` to
  `desktop/src/main/auth-client.ts:164` shows the login path tries
  `loginAsRoot()` before cloud login.
- `desktop/src/main/auth-root.ts:175` to `desktop/src/main/auth-root.ts:196`
  shows the root branch returns `invalid_credentials` when the submitted
  username matches the configured root username but the password does not match
  the configured root password.
- `desktop/src/main/auth-ipc.ts:120` to `desktop/src/main/auth-ipc.ts:125` and
  `desktop/src/preload/index.ts:131` to `desktop/src/preload/index.ts:133` show
  the auth portal submits the form to this same main-process login path.
- A scoped check of the current repository root `.env` found
  `AUTH_ROOT_USERNAME` present and equal to `admin`, `AUTH_ROOT_PASSWORD`
  present but not equal to `admin`, and no `ADMIN_*`, `ROOT_*`, or
  `DESKTOP_ROOT_*` keys. That directly explains why a user typing
  `admin/admin` is rejected in the current code path without relying on the old
  `ROOT_PASSWORD=adminjr` template theory.

Current UI evidence:

- `desktop/src/main/window-manager.ts:332` to
  `desktop/src/main/window-manager.ts:360` creates a dedicated auth window with
  `frame: false`, `transparent`, fixed size `880x580`, and `maximizable: false`.
  This means the old finding about `DesktopTitleBar` minimize/maximize/close
  controls is not the current implementation.
- `desktop/src/main/window-manager.ts:372` to
  `desktop/src/main/window-manager.ts:386` registers only
  `window:auth:minimize` and `window:auth:close` for the auth window.
- `desktop/src/preload/index.ts:187` to `desktop/src/preload/index.ts:189`
  exposes those auth-window controls to the auth portal.
- `desktop/auth-portal/src/App.tsx:79` to
  `desktop/auth-portal/src/App.tsx:105` renders `auth-shell`, `SplitLayout`,
  `BrandPanel`, and `AuthCard`.
- `desktop/auth-portal/src/components/SplitLayout.tsx:15` to
  `desktop/auth-portal/src/components/SplitLayout.tsx:23` renders a two-column
  brand/content layout.
- `desktop/auth-portal/src/App.tsx:117` to
  `desktop/auth-portal/src/App.tsx:149` renders both minimize and close buttons
  in a top-right `WindowControls` component outside the login form.
- The release artifact under
  `desktop/release/win-unpacked/resources/auth-portal/assets/*.css` contains
  `.auth-shell`, `.split-layout`, `.split-layout__brand`, and
  `.window-controls`, so the published UI symptom is present in the packaged
  auth portal as well.

Candidate fix audit:

- The old fix A, "align desktop root defaults to `ROOT_PASSWORD=admin` and
  migrate stale userData `.env`", is not the minimum current fix because the
  current build does not use the old `env.template.desktop` or userData `.env`
  root-sync path. Applying it would miss the executed code.
- The old fix B, "make `ADMIN_*` the desktop root source of truth", is also not
  the minimum current fix. The current supported aliases are `DESKTOP_ROOT_*`
  and `AUTH_ROOT_*`; introducing `ADMIN_*` would add another credential source
  and broaden the auth surface.
- The old fix D is directionally correct about simplifying the login UI, but the
  target is now `desktop/auth-portal/src/App.tsx`, `SplitLayout` usage, and
  `desktop/auth-portal/src/styles.css`; there is no current `LoginScreen`
  / `DesktopTitleBar` to refactor.

## 璇勫缁撹

Final recommended fix: update the current desktop authentication source of
truth, not the legacy template path. Set the packaged root credentials to the
requested default by ensuring the build reads `DESKTOP_ROOT_USERNAME=admin` and
`DESKTOP_ROOT_PASSWORD=admin` or, if keeping the repository-root alias, that
`AUTH_ROOT_USERNAME=admin` and `AUTH_ROOT_PASSWORD=admin` are present before
running `desktop/scripts/build.ts`. Then rebuild so
`dist/main/baked-root-credentials.js` in `app.asar` contains the intended
`admin/admin` root credentials. Add a focused regression test around
`bakeRootCredentialsForBuild()` / `loginAsRoot()` proving `admin/admin` is
accepted when the configured root env says so, and proving a mismatched password
returns `invalid_credentials`.

For the UI half, change the current auth portal rather than the old
`LoginScreen`: render the login view as a single internal panel, remove the
`SplitLayout` / `BrandPanel` outer shell for the login surface, and replace the
current top-right `WindowControls` pair with only a close button inside the
panel's top-right corner wired to `window.aragonAuth.windowClose()`. Keep the
existing auth-window IPC channel `window:auth:close`; do not add maximize
behavior, and do not reuse the main-window `window:*` controls.

This is the minimum fix because it follows the code that is actually executed:
`auth-portal` form -> `auth:login` IPC -> `AuthClient.login()` ->
`loginAsRoot()` -> baked/desktop/auth root credentials. It avoids adding
unsupported `ADMIN_*` behavior, avoids a no-op migration of obsolete
`env.template.desktop` files, and keeps the UI change scoped to the renderer
surface that is currently packaged.

## 实施过程中发现的方案缺陷 (Issues Found During Implementation)

During implementation in `M:/takoAI/Ecliptrix`, the later "current-code"
recommendation proved mismatched to the actual workspace: `desktop/src/main/*`
and `desktop/auth-portal/*` do not exist here, while the executable desktop
paths are the legacy `desktop/main/*`, `desktop/scripts/env.template.desktop`,
and `src/components/auth/LoginScreen.tsx` described by the earlier root-cause
sections.

The corrected implementation therefore applied the original recommended fix A
and D to the code that is present and executed in this workspace: align the
desktop `ROOT_PASSWORD` factory default to `admin`, migrate stale
`ROOT_PASSWORD=adminjr` userData files through `backfillUserEnv()`, and simplify
`LoginScreen` into a panel-only login surface with an internal close button.
