# Fix Plan — Web Bug Report Iter2 (2026-05-09)

> Companion to `bug-report.md`. For each of the 7 bugs we locate the offending
> code, explain the root cause, sketch the fix (with concrete diffs / pseudocode),
> call out the risks and tests, and rank in implementation order.
>
> All paths are relative to repo root `G:\projects\takoAI\Ecliptrix\`.

## TL;DR — Implementation Order

| Order | Bug | Severity | Reason for ordering |
|-------|-----|----------|---------------------|
| 1 | #1 — wrong-credentials → "Session expired" + "Network error" | P0 | Touches `http-client.ts` (every other fix lives downstream of it). Best landed first so other auth-adjacent fixes inherit the new behavior. |
| 2 | #6 — login hint reveals `admin / *` | P2 | One-line removal in `LoginModal.tsx`. Pair with Bug #1 PR — both touch auth UX. |
| 3 | #7 — password input not in a `<form>` | P3 | Already mostly correct in `LoginModal.tsx` (form exists). Verify and remove any stragglers; bundle with #1/#6. |
| 4 | #3 — TTS settings accept out-of-range values | P1 | Independent of auth. Backend pydantic validation + frontend clamp. |
| 5 | #2 — workflow log shows `{ "error": {} }` | P1 | Localized to `WorkflowExecutor.ts` + `WorkflowLogPanel.tsx`. |
| 6 | #4 — verbose `[LOG]` chatter | P2 | Mostly hygiene. The useEffect dependency bug it surfaces is the riskiest part. |
| 7 | #5 — project card nested-button (ARIA) | P2 | One small structural change in `ProjectCard.tsx`. |

---

## Bug #1 — Wrong-credentials login mis-reported as "Session expired" + "Network error" (P0)

### Code locations

- `src/lib/api/http-client.ts:411-415` — `handleSessionExpired()` fires on **any** 401, including login/register.
- `src/lib/api/http-client.ts:135-161` — `handleSessionExpired()` clears localStorage, dispatches `ecliptrix:session-expired`, and redirects to `/login?reason=session-expired`.
- `src/contexts/AuthContext.tsx:284-287` — `login()` catches the resulting `SessionExpiredError`, logs it, and returns `{ success: false, error: 'Network error' }`.
- `src/components/LoginModal.tsx:74-83` — falls back to the generic `'Network error'` paragraph when `result.error` is unfriendly.

### Root cause

The HTTP wrapper assumes "401 ⇒ a previously valid session is now invalid".
That assumption is wrong for `requireAuth: false` calls (the auth client uses
`{ requireAuth: false }` for `/api/auth/login`, `/register`, and
`/validate-session`). For those calls, 401 means **"the credentials you just
sent are wrong"**, not "your session expired" — the user has no session yet.

The wrapper unconditionally clears localStorage, dispatches the global
"session-expired" event, and force-redirects to `/login?reason=session-expired`,
producing the yellow banner. Then, separately, `AuthContext.login()` catches
the thrown `SessionExpiredError` and turns it into the generic
`'Network error'` paragraph. The user sees two contradictory messages for the
same 401.

### Fix strategy

**Single source of truth — the `requireAuth: false` path must NEVER trigger
session-expiration semantics.** When the caller explicitly opted out of auth,
a 401 is a regular HTTP error and should surface as `ApiError(401, ...)` with
the backend's actual message (e.g. "用户名或密码错误").

1. **`src/lib/api/http-client.ts`** — split the 401 branch on `requireAuth`:

   ```ts
   // request() — replace lines 411-415
   if (status === 401) {
     if (requireAuth) {
       handleSessionExpired();
       throw new SessionExpiredError();
     }
     // Public endpoint: 401 means "credentials rejected" or
     // "this resource needs auth that wasn't provided" — surface as a normal
     // ApiError so the caller can display the backend's message inline.
     const parsed = await parseErrorBody(response);
     throw new ApiError(
       401,
       parsed.errorCode ?? 'UNAUTHORIZED',
       parsed.message ?? 'Unauthorized',
       parsed.details ?? (parsed.rawBodyTruncated
         ? { rawBodyTruncated: parsed.rawBodyTruncated }
         : undefined),
     );
   }
   ```

   Apply the same change to `streamRequest()` (lines 589-592).

2. **`src/lib/api/auth.ts`** — `login()` already calls `http.post` with
   `requireAuth: false`, so after step 1 it will now throw `ApiError(401)`
   instead of `SessionExpiredError`. Catch `ApiError` and convert to the
   `LoginFailure` shape:

   ```ts
   import { http, ApiError } from '@/lib/api/http-client';

   export async function login(credentials: LoginCredentials): Promise<LoginResult> {
     try {
       const raw = await http.post<RawLoginEnvelope>(
         '/api/auth/login',
         credentials,
         { requireAuth: false },
       );
       if (raw && raw.success && raw.user) {
         return { success: true, user: normalizeUser(raw.user),
                  sessionToken: raw.session_token ?? raw.sessionToken ?? null,
                  message: raw.message };
       }
       return { success: false, error: raw?.error ?? raw?.message ?? 'Login failed' };
     } catch (err) {
       if (err instanceof ApiError && err.status === 401) {
         return { success: false, error: err.message || 'Invalid username or password' };
       }
       throw err;  // preserve TimeoutError / network errors for the AuthContext layer
     }
   }
   ```

3. **`src/contexts/AuthContext.tsx`** — drop the "Network error" string in the
   catch block (line 286) — replace with a localized fallback that only fires
   for genuinely networky failures (TimeoutError, ApiError(0, NETWORK_ERROR)):

   ```ts
   } catch (error) {
     console.error('[AuthContext] Login error:', error);
     const message = error instanceof TimeoutError
       ? t.auth.networkTimeout ?? 'Request timed out'
       : t.auth.networkError ?? 'Network error';
     return { success: false, error: message };
   }
   ```
   (Add `networkTimeout` / `networkError` keys to `src/lib/i18n.ts` under `auth`.)

### Test plan

- Vitest unit: extend `src/lib/api/__tests__/http-client.test.ts` with
  - `request()` with `requireAuth: false` + 401 → throws `ApiError(401)`, does NOT call `handleSessionExpired`, does NOT clear localStorage, does NOT redirect.
  - `request()` with `requireAuth: true` + 401 → existing behavior preserved (throws `SessionExpiredError`, clears storage, redirects when not on /login).
- Manual: dev server, log out, attempt `admin / WRONG` — expect inline error "用户名或密码错误" / "Invalid username or password" only, no banner, no redirect, console clean.
- Manual: while logged in, force-expire the session row in DB and click any authenticated action → expect the existing "session expired" banner (regression check).

### Risks

- Other code paths may already depend on `http.post('/something', {...}, { requireAuth: false })` and expect a 401 to redirect (unlikely — by definition `requireAuth: false` means the caller knows there's no session). Grep `requireAuth: false` confirms only `auth.login`, `auth.register`, `auth.validateSession` use it today, all of which want the new behavior.

---

## Bug #6 — Login hint exposes `Test credentials: admin / *` (P2)

### Code location

- `src/components/LoginModal.tsx:199-203`
  ```tsx
  <div className="mt-6 text-center">
    <p className="text-xs text-muted-foreground">
      Test credentials: admin / *
    </p>
  </div>
  ```

### Root cause

A development-time hint shipped to all environments. Always visible.

### Fix strategy

Gate behind a build-time flag, default off:

```tsx
{process.env.NEXT_PUBLIC_SHOW_DEV_HINTS === 'true' && (
  <div className="mt-6 text-center">
    <p className="text-xs text-muted-foreground">
      Dev mode — see team docs for credentials.
    </p>
  </div>
)}
```

Even when on, do **not** print the username. Update `env.template` to declare
`NEXT_PUBLIC_SHOW_DEV_HINTS=false` and document it.

### Test plan

- Default build: hint absent.
- With `NEXT_PUBLIC_SHOW_DEV_HINTS=true`: shows generic dev string, no username.

### Risks

- None. Pure UX removal.

---

## Bug #7 — Password input is not wrapped in a `<form>` (P3)

### Code location

- `src/components/LoginModal.tsx:132-197` — already wrapped in `<form onSubmit={handleSubmit}>`. The Chromium warning likely stems from the modal mounting state where the inputs render before the form (or from the `/login` page's Suspense fallback briefly rendering them outside the form).

### Root cause

The warning is genuine — Chromium walks the live DOM and emits the
`Password field is not contained in a form` log when it sees a password
input that, at any point, is not a descendant of a `<form>`. With the
current code, the only way this could fire is during a fast pre-paint render
or via a different login surface we missed.

### Fix strategy

1. Confirm with DevTools live-tree inspection that the `<form>` exists at runtime in both surfaces:
   - Login modal (top-right button).
   - `/login` page (`src/app/login/page.tsx` — just renders `LoginModal`).
2. Audit `src/components/AdminSettings/UserManagement.tsx` (the second hit on `type="password"`) — it's an admin user-create form. If the password input there is outside a `<form>`, wrap it.
3. Add `noValidate` to the form so HTML5 validation tooltips don't override our React-managed errors.

If the warning persists after step 1-2, set `aria-hidden="true"` on inputs that
are mounted but not yet visible (e.g., before `isOpen`), or simply gate the
`<input type="password">` behind `isOpen`. Currently `LoginModal` already
returns `null` when `!isOpen` (line 97), so this branch shouldn't trigger.

### Test plan

- Manual: open `/login` and the modal in Edge, watch DevTools console — no `[DOM] Password field` warnings.
- Manual: try 1Password / browser autofill — verify it offers credentials.

### Risks

- Adding `noValidate` removes the native "Please fill out this field" tooltip; we already do that ourselves via `setError(t.auth.requiredFields)` (LoginModal:62), so this is fine.

---

## Bug #3 — TTS Settings accept out-of-range values (P1)

### Code locations

- Frontend input (no clamp / validate-on-save): `src/components/AdminSettings/TTSSettingsPanel.tsx:110` (`max_segments_per_batch` 10–200), and the other range fields on lines 95-98, 103-105, 111-112, 118.
- The shared component: `src/components/AdminSettings/components/SettingsFieldHelpers.tsx:3-23` — `NumberField` only forwards `min`/`max` to the `<input type="number">` HTML attribute. HTML number-input `min`/`max` are advisory only — users can still type out-of-range and React `onChange` accepts whatever `Number(e.target.value)` parses.
- Save path: `useSettingsPanel.ts:38-46` calls `PUT /api/system-settings/{category}` with no client-side validation.
- Backend: `app/routers/system_settings_router.py:211-232` — `batch_update_settings` accepts `BatchUpdateSettingsRequest` whose `settings` is `Dict[str, Any]` (see `app/models/system_settings_models.py`). No bounds check.
- Service: `app/services/system_settings_service.py:294-303` — writes to DB unchanged, then syncs to `settings.batch_tts.limits.max_segments_per_batch` via `_apply_setting_to_config` (line 530-533).

### Root cause

Two-layer validation gap:
1. **Frontend**: `NumberField` doesn't clamp on blur and doesn't disable Save when out of range. `onChange` writes whatever the user typed.
2. **Backend**: the `system-settings` PUT endpoint accepts an untyped dict; no per-category schema validation.

### Fix strategy

#### Frontend (defense layer 1)

1. Extend `NumberField` (`SettingsFieldHelpers.tsx`) to:
   - Track an internal "raw text" buffer separate from the committed numeric value.
   - On blur (and on save), clamp the value to `[min, max]`. If the user typed
     something invalid (NaN), snap back to the previous value.
   - Show a transient hint (`"已自动调整为最大值 200"` / `"Auto-clamped to 200"`) for 3s after a clamp.
   - Expose an `invalid` boolean for the parent, so the save button can disable.

   Sketch:
   ```tsx
   export const NumberField: React.FC<{...}> = ({ label, value, onChange, min, max, step = 1 }) => {
     const [raw, setRaw] = useState(String(value));
     const [hint, setHint] = useState<string | null>(null);
     useEffect(() => { setRaw(String(value)); }, [value]);

     const commit = (s: string) => {
       const n = Number(s);
       if (!Number.isFinite(n)) { setRaw(String(value)); return; }
       const clamped = clamp(n, min, max);
       if (clamped !== n) {
         setHint(`Auto-clamped to ${clamped}`);
         setTimeout(() => setHint(null), 3000);
       }
       setRaw(String(clamped));
       if (clamped !== value) onChange(clamped);
     };

     return (
       <div>
         <label>{label}</label>
         <input
           type="number"
           value={raw}
           onChange={(e) => setRaw(e.target.value)}
           onBlur={(e) => commit(e.target.value)}
           onKeyDown={(e) => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); }}
           min={min} max={max} step={step}
           aria-invalid={Number(raw) < (min ?? -Infinity) || Number(raw) > (max ?? Infinity)}
         />
         {hint && <span className="text-xs text-amber-500 ml-2">{hint}</span>}
       </div>
     );
   };
   ```

2. In `TTSSettingsPanel.tsx`, before `saveSettings()`, run a client-side
   validate pass that walks the `limits`/`concurrency`/`retry`/`logging`
   sections against the same `min`/`max` we already pass to `NumberField`,
   and refuse to save if any field is out of range (toast: "Some values are out of range").

#### Backend (defense layer 2 — authoritative)

Add per-category pydantic schemas. Since each category's structure is
heterogeneous, declare `TTSCategorySettings`, `UploadCategorySettings`, etc.,
in `app/models/system_settings_models.py` with `Field(..., ge=..., le=...)`
constraints. Plug them into `batch_update_settings`:

```python
# app/models/system_settings_models.py
from pydantic import BaseModel, Field, conint
from typing import Optional

class TTSConcurrency(BaseModel):
    concurrent_threads: conint(ge=1, le=10)
    max_concurrent_threads: conint(ge=1, le=20)
    request_timeout: conint(ge=5, le=120)
    batch_timeout: conint(ge=60, le=600)

class TTSRetry(BaseModel):
    max_attempts: conint(ge=0, le=10)
    delay_seconds: conint(ge=1, le=30)
    backoff_factor: conint(ge=1, le=5)

class TTSLimits(BaseModel):
    max_segments_per_batch: conint(ge=10, le=200)
    max_text_length_per_segment: conint(ge=1000, le=10_000)
    max_total_text_length: conint(ge=10_000, le=500_000)

class TTSLogging(BaseModel):
    enable_detailed_logs: bool
    log_progress_interval: conint(ge=1, le=100)
    log_level: str  # validated against {DEBUG, INFO, WARNING, ERROR}

# Map category -> {key -> validator}
CATEGORY_KEY_VALIDATORS: dict[str, dict[str, type[BaseModel]]] = {
    "tts": {
        "concurrency": TTSConcurrency,
        "retry": TTSRetry,
        "limits": TTSLimits,
        "logging": TTSLogging,
        # voices: list[VoiceItem] — separate validator
    },
    # ... upload, watermark, video_analysis, youtube
}
```

In `system_settings_router.batch_update_settings`:

```python
@router.put("/{category}")
async def batch_update_settings(category: str, request: BatchUpdateSettingsRequest, ...):
    _validate_category(category)
    validators = CATEGORY_KEY_VALIDATORS.get(category, {})
    for key, value in request.settings.items():
        validator = validators.get(key)
        if validator is None:
            continue  # untyped keys (e.g. voices) skipped here, validated separately
        try:
            validator.model_validate(value)
        except ValidationError as ve:
            raise HTTPException(status_code=422, detail={
                "category": category, "key": key, "errors": ve.errors(),
            })
    # ... existing update flow
```

Same change applies to single-key PUT (`update_setting`). For the `voices`
key (an array), define `class VoiceItem(BaseModel)` with the schema already
implied by `VoiceListEditor`.

### Test plan

- Backend pytest: extend `tests/test_batch_tts.py` (or a new `tests/test_system_settings_validation.py`):
  - PUT `/api/system-settings/tts` with `{"limits": {"max_segments_per_batch": 99999}}` → 422 with `errors[0].loc == ["max_segments_per_batch"]`.
  - PUT with valid values → 200 and DB row updated.
  - Iterate every category to make sure no false positives.
- Frontend Vitest: `NumberField` clamping behavior (out-of-range commits clamp + show hint; NaN snaps back to current value).
- Manual: type `99999` in `每批最大段数`, blur, see field snap to `200` and hint show; click save → 200 OK.

### Risks

- A user could have an old saved value from before validation that now violates the new bounds. Add a startup migration / one-shot clamp pass in `ensure_defaults_seeded` so existing rows are validated and clamped.
- `voices` is a freeform list — validating it strictly may reject configurations from older versions. Use `extra='allow'` on the `VoiceItem` model to be lenient.

---

## Bug #2 — Workflow log shows `{ "error": {} }` (P1)

### Code locations

- `src/components/workflow/WorkflowExecutor.ts:147` — `this.addLog('error', undefined, ..., { error })` — `error` is the raw `Error` object.
- `src/components/workflow/WorkflowExecutor.ts:433-436` — same pattern at node-level (`error.message` is already extracted, but a `stack` would be nicer).
- `src/components/workflow/WorkflowLogPanel.tsx:81-131` — `formatDetails()` calls `JSON.stringify(details, null, 2)` directly; `Error` properties are non-enumerable, so they serialize to `{}`.

### Root cause

`JSON.stringify(new Error('oops'))` returns `"{}"` because `name`, `message`,
and `stack` are non-enumerable own/inherited properties. `WorkflowExecutor`
stores the raw Error in `details.error`; the renderer stringifies it; it
becomes `{ "error": {} }` on screen.

### Fix strategy

**Two-layer fix** — be defensive at both ends:

1. **`WorkflowExecutor.ts`** — never put a raw `Error` into `details`. Replace line 147:
   ```ts
   this.addLog('error', undefined, `Workflow execution failed: ${error.message}`, {
     error: error.message,
     errorType: error.name,
     stack: error.stack,
   });
   ```
   This matches the pattern already used at line 433-437 for node failures.

2. **`WorkflowLogPanel.tsx`** — make `formatDetails()` Error-aware as a safety
   net (so future logger calls that put an Error don't regress):
   ```ts
   const safeStringify = (val: unknown) =>
     JSON.stringify(val, (_k, v) => {
       if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
       return v;
     }, 2);
   // ...
   const detailsStr = safeStringify(details);
   ```

3. **i18n**: ensure the rendered "details" line shows the error message
   prominently. Optionally tweak `formatDetails` to show `error` + `stack`
   in their own labelled blocks (similar to the existing `input` / `output`
   special cases).

### Test plan

- Vitest: `WorkflowLogPanel.formatDetails({ error: new Error('boom') })` produces JSON containing `"message": "boom"` (not `"{}"`).
- Vitest: `WorkflowExecutor.execute()` with no Start node → log entry's `details.error` is the string `"No Start node found in workflow"`, not an Error object.
- Manual: open empty workflow, click Run, expand log details — see the actual error text and stack.

### Risks

- Some existing logs in `addLog` calls put `{ error: error.message }` (already a string) — the `safeStringify` Error-handling branch is a no-op for those, so no regression.

---

## Bug #4 — Verbose `[LOG]` chatter in production (P2)

### Code locations

- `src/components/chat/ChatInterface.tsx:40-49` — `console.log('[ChatInterface] Initializing/Restoring state', ...)` runs on every render.
- `src/components/chat/ChatInterface.tsx:78` — useEffect deps include `taskId` but the body reads `chatContent.uiState?.*`. The deps array is too narrow: state churn on `setIsLoading`, `setIsChatTypeModalOpen` re-runs the effect, which calls `onUpdateContent` — which (depending on the parent) triggers a re-render of `ChatInterface`. The re-render re-runs the top-level `console.log` at line 40. **This is the why-it-runs-per-chunk symptom in the bug report.**
- `src/components/chat/ChatInterface.tsx:536` — `console.log('[Chat] Streaming update - accumulated content length: ...')` per SSE chunk.
- `src/components/chat/MessageBubble.tsx:59-65` — `console.log('[MessageBubble] 流式消息更新', ...)` per render (only while streaming, but during streaming this fires every chunk).
- Workflow tab: `[WorkflowInterface] Rendering interface`, `[WorkflowSidebar] Rendering sidebar`, `[WorkflowCanvas] Rendering canvas` — same pattern.

### Root cause

Two distinct issues:
1. **Logging hygiene**: a previous diagnosis pass left in `console.log` lines that should have been removed or guarded.
2. **Effect dependency bug** in `ChatInterface` line 78. The effect should only persist UI state when it actually changes; today the deps `[isLoading, isChatTypeModalOpen, taskId]` cause it to fire on every state change, and `hasAutoInitialized.current` is read but not in the deps (intentional — it's a ref). The "hasStateChanged" guard inside the effect prevents the actual `onUpdateContent` from being called every time, BUT only after the comparison runs. The render-time console.log on line 40 still fires every render cycle that streaming triggers.

### Fix strategy

1. **Introduce a `debug-log` helper** at `src/lib/utils/debugLog.ts`:
   ```ts
   const ENABLED = process.env.NODE_ENV !== 'production'
     && (typeof window === 'undefined' || (window as any).__ECLIPTRIX_DEBUG__ !== false);
   export const dlog = (...args: unknown[]) => { if (ENABLED) console.log(...args); };
   export const dwarn = (...args: unknown[]) => { if (ENABLED) console.warn(...args); };
   ```

2. **Migrate noisy call sites** to `dlog`:
   - `ChatInterface.tsx:40` — convert to `dlog`. Also consider moving it inside a `useEffect(() => { dlog(...); }, [taskId])` so it only fires on mount + taskId change, not every render.
   - `ChatInterface.tsx:69-75` — already inside a guard, change to `dlog`.
   - `ChatInterface.tsx:536` — most painful, per-chunk. Replace with a throttled `dlog` (every 25 chunks) or remove entirely.
   - `MessageBubble.tsx:59-65` — `dlog`.
   - Workflow renderers (`WorkflowInterface`, `WorkflowSidebar`, `WorkflowCanvas`) — same.
   - `WorkflowExecutor.ts` is mostly fine (one-shot per node), but the per-step `console.log` at lines 62, 72, 127, 222, 264, 301, 397, etc. should also be `dlog`. They aren't critical (one or two per execution), but consistent.

3. **Standardize on English log strings** — replace `'流式消息更新'` with `'Streaming message update'`. Mixed language hurts grep-ability.

4. **Fix the useEffect deps in `ChatInterface.tsx:78`**:
   ```ts
   useEffect(() => {
     // ... build updatedContent ...
     if (hasStateChanged) onUpdateContent(updatedContent);
   }, [isLoading, isChatTypeModalOpen, chatContent, onUpdateContent, taskId]);
   ```
   The missing deps are `chatContent` (read inside) and `onUpdateContent`. If
   adding `chatContent` causes infinite loops (it will, because `onUpdateContent`
   sets it), wrap the comparison in a ref-based shallow-equal check or use
   `useMemo`/`useReducer` for `chatContent.uiState`. The clean fix is to keep
   only the UI state inside React state and not echo it into `chatContent`
   on every change.

### Test plan

- Manual: production build, send "hi" in chat — console has `[Chat] Streaming complete` (or 1-2 throttled lines), no per-chunk noise. No "Initializing/Restoring state" loop during streaming.
- Manual: workflow tab — clicking around does not produce the per-render render logs.
- Vitest: a smoke test that imports `dlog` with `NODE_ENV='production'` and asserts `console.log` is not called.
- Performance: in DevTools Performance, capture a 5s streaming session before/after — render duration should drop measurably.

### Risks

- Removing logs makes future diagnosis harder. Mitigated by keeping `dlog` (toggleable via `window.__ECLIPTRIX_DEBUG__ = true` in DevTools).
- The useEffect deps fix could expose pre-existing infinite-loop bugs if the parent's `onUpdateContent` returns a new content reference each call. Test thoroughly with the `hasStateChanged` guard in place.

---

## Bug #5 — Project card has nested-button (ARIA / a11y) (P2)

### Code location

- `src/components/video/projects/ProjectCard.tsx:58-72` — the outer wrapper is `<div role="button" tabIndex={0}>`.
- `src/components/video/projects/ProjectCard.tsx:97-111` — inside it, an inner `<button type="button" aria-label="Project actions">` (the kebab menu).
- `src/components/video/projects/ProjectCard.tsx:126-145` — when the menu opens, two more `<button>` elements (Rename, Delete) are nested inside the outer wrapper.

### Root cause

Even though the source uses `<div role="button">` (not a literal `<button>`),
the **ARIA spec forbids interactive descendants inside an element with
`role="button"`**. Browsers expose this as the "button containing buttons"
accessibility tree we see in the bug report. Screen readers concatenate
descendant labels into the outer button's accessible name and get confused.

### Fix strategy

Move the actions out of the clickable region. Two acceptable shapes:

**Option A — clickable area as a div with no `role`, anchor for the title.**
The whole card stays clickable via JS, but it isn't announced as a button.
The visible title becomes a real `<a>` (or `<button>`) for keyboard users.

```tsx
<div className="..." onClick={onOpen}>
  <div className="aspect-video ..." style={cover}>{/* cover */}</div>
  <div className="px-3 py-2.5 space-y-1">
    <div className="flex items-start gap-2">
      <a
        href="#"  // or use Next router
        className="flex-1 text-sm font-medium text-foreground truncate"
        onClick={(e) => { e.preventDefault(); onOpen(); }}
      >
        {project.name || t.videoProjects.untitled}
      </a>
      {/* actions menu — sibling of the title, not a descendant */}
      <div className="relative">
        <button ... aria-label="Project actions">...</button>
      </div>
    </div>
    {/* ... */}
  </div>
</div>
```

**Option B — keep the wrapper as `role="button"`, but stop the descendants
from being interactive descendants by rendering the menu via portal.**
React Portal mounts the menu outside the wrapper in the DOM tree, so the
ARIA tree no longer has nested interactive elements.

**Recommended: Option A.** Cleaner ARIA, no portal complexity.

Implementation detail: keep the `onClick` on the outer div for "click anywhere"
ergonomics, but add `e.target instanceof HTMLButtonElement` short-circuit (or
rely on the inner buttons' `e.stopPropagation()`, which they already have).
Drop `tabIndex={0}` and `role="button"` from the outer; let the title `<a>` /
`<button>` be the keyboard-focusable target.

### Test plan

- DevTools accessibility tree: outer card no longer announces as a button, title is its own focusable element.
- Keyboard: Tab lands on the title first, then the kebab. Enter on title opens project. Enter on kebab opens menu.
- Click: Clicking the cover or empty space of the card opens the project. Clicking the kebab opens the menu without also firing the open-project handler (already guarded by `e.stopPropagation()` at line 100).
- Vitest: render the card, fire `click` on the kebab → `onOpen` not called.

### Risks

- Existing CSS may depend on the outer being a `<div>` (it is) so styling won't break. Hover styles that use `:focus-within` need to keep working.
- Some test selectors may look for `[role="button"]` on the card. Search before changing.

---

## Cross-cutting concerns

### Single PR or multiple?

Group bugs by surface to keep PRs reviewable:
- **PR-A: Auth UX** — Bugs #1, #6, #7. Touches `http-client.ts`, `auth.ts`, `AuthContext.tsx`, `LoginModal.tsx`, `i18n.ts`.
- **PR-B: Settings validation** — Bug #3. Touches `system_settings_router.py`, `system_settings_models.py`, `SettingsFieldHelpers.tsx`, `TTSSettingsPanel.tsx`.
- **PR-C: Workflow log + a11y polish** — Bugs #2 and #5. Independent files.
- **PR-D: Logging hygiene** — Bug #4. New `debugLog.ts` helper + sweep.

### Common test additions

- Add a `tests/integration/auth-flow.test.tsx` that spins up MSW with the backend's 401 response and asserts no banner on a wrong-credentials login.
- Add a `tests/test_system_settings_validation.py` to lock in the bounds check.

### Dependencies

- Bug #1 must land before #6/#7 are tested end-to-end (they're trivial and pair-naturally with #1's PR).
- Bug #4's effect-deps fix is independent of the log gating; if the deps fix is risky we can ship the log gating alone first.
- Bug #2 backend change is none — pure frontend.

---

## Files we expect to touch (summary)

| Bug | File |
|-----|------|
| #1 | `src/lib/api/http-client.ts`, `src/lib/api/auth.ts`, `src/contexts/AuthContext.tsx`, `src/lib/i18n.ts` |
| #2 | `src/components/workflow/WorkflowExecutor.ts`, `src/components/workflow/WorkflowLogPanel.tsx` |
| #3 | `backend-services/basic-service/app/routers/system_settings_router.py`, `backend-services/basic-service/app/models/system_settings_models.py`, `src/components/AdminSettings/components/SettingsFieldHelpers.tsx`, `src/components/AdminSettings/TTSSettingsPanel.tsx` (+ peer panels) |
| #4 | new `src/lib/utils/debugLog.ts`, `src/components/chat/ChatInterface.tsx`, `src/components/chat/MessageBubble.tsx`, `src/components/workflow/Workflow{Interface,Sidebar,Canvas}.tsx`, `src/components/workflow/WorkflowExecutor.ts` |
| #5 | `src/components/video/projects/ProjectCard.tsx` |
| #6 | `src/components/LoginModal.tsx`, `env.template` |
| #7 | `src/components/LoginModal.tsx` (audit), `src/components/AdminSettings/UserManagement.tsx` (audit) |

## Open questions for the review step

1. (Bug #1) Should `streamRequest()` mirror `request()`'s split exactly, or is there a streaming endpoint that legitimately wants the redirect-on-401 even with `requireAuth: false`? (Grep says no — `auth.*` are the only `requireAuth: false` callers and none of them stream.)
2. (Bug #3) Where do we want the clamp-on-load to live for legacy DB rows that violate the new bounds — at startup in `ensure_defaults_seeded`, or lazily on first GET? Startup is more deterministic.
3. (Bug #4) Do we want to keep `console.log` at all in `WorkflowExecutor` (for AI agent visibility into automated runs)? Probably yes for SSE-stream logs that reach the browser console intentionally.
