# Fix Plan — Web Bug Report Iter2 (REVIEWED)

> Reviewed-and-corrected companion to `fix-plan.md`. This document is the
> source-of-truth for the implementation step. Each bug carries a
> **Review notes** block listing concrete corrections to the original plan,
> followed by the *final* code-level recipe ready to ship.
>
> All paths are relative to repo root `G:\projects\takoAI\Ecliptrix\`.
> Code-line references re-verified against current HEAD on 2026-05-09.

## Verification snapshot

| Bug | Original loc | Verified? | Notes |
|-----|--------------|-----------|-------|
| #1 | `http-client.ts:411-415` | ✅ | Mirror in `streamRequest()` at `:589-592` confirmed. |
| #2 | `WorkflowExecutor.ts:147`, `WorkflowLogPanel.tsx:81-131` | ✅ | `formatDetails()` short-circuits on `details.input` / `details.output` before the generic stringify; the safe-stringify fix must apply to all three paths. |
| #3 | `SettingsFieldHelpers.tsx:3-23`, `system_settings_router.py:211-232` | ✅ | `BatchUpdateSettingsRequest.settings: Dict[str, Any]` confirmed. Service's `update_setting` mutates DB unconditionally. |
| #4 | `ChatInterface.tsx:40-49`, `:78`, `:536`, `MessageBubble.tsx:59-65` | ✅ | See review note about effect-deps below. |
| #5 | `ProjectCard.tsx:58-72`, `:97-111`, `:126-145` | ✅ | Inner buttons already `e.stopPropagation()`. |
| #6 | `LoginModal.tsx:199-203` | ✅ | One-line removal/gate. |
| #7 | `LoginModal.tsx:132-197` (form OK) and `UserManagement.tsx:219, :225, :505` (NO form) | ✅ | UserManagement is the actual offender — three password inputs, none wrapped in `<form>`. |

## Implementation order (unchanged)

1. **PR-A — Auth UX** (Bugs #1, #6, #7).
2. **PR-B — Settings validation** (Bug #3).
3. **PR-C — Workflow log + a11y** (Bugs #2, #5).
4. **PR-D — Logging hygiene** (Bug #4).

---

## Bug #1 — Wrong-credentials login mis-reported as "Session expired" (P0)

### Review notes (corrections to the original plan)

- ✅ Splitting on `requireAuth` in `request()`/`streamRequest()` is correct.
- ⚠️ Original plan's `auth.ts` snippet is acceptable but creates two error
  shapes (LoginResult vs thrown error) for the caller. **Refinement:**
  unify in `auth.ts` — every reasonable HTTP failure becomes a
  `LoginFailure`; only programming errors propagate. Keeps `AuthContext`
  catch path as defensive backstop (it already exists; we just stop relying
  on it for the inline 401 message).
- ⚠️ `sessionExpiryHandled` once-flag in `http-client.ts:116` is **not**
  touched by the new public-endpoint branch (we never call
  `handleSessionExpired()`), so no flag-reset gymnastics are needed.
- ⚠️ i18n keys `auth.networkError` / `auth.networkTimeout` **do not exist**
  today (`t.auth` has only `loginFailed`, `requiredFields`, etc.). We must
  add them to `src/lib/i18n.ts` in the `auth` interface (line ~50-60),
  the EN block (~2730), and the ZH block (~5425). Use existing
  `aiVideoGenerator.errors.networkErrorMsg` wording as a guide.

### Final fix recipe

#### 1. `src/lib/api/http-client.ts`

Replace the `if (status === 401)` branch (lines 411-415) **inside `request()`**:

```ts
if (status === 401) {
  if (requireAuth) {
    handleSessionExpired();
    throw new SessionExpiredError();
  }
  // Public endpoint (requireAuth: false) — caller handles credentials
  // rejection inline. Do NOT clear localStorage / redirect / dispatch.
  const parsed = await parseErrorBody(response);
  throw new ApiError(
    401,
    parsed.errorCode ?? 'UNAUTHORIZED',
    parsed.message ?? 'Unauthorized',
    parsed.details ??
      (parsed.rawBodyTruncated
        ? { rawBodyTruncated: parsed.rawBodyTruncated }
        : undefined),
  );
}
```

Apply the **identical** replacement inside `streamRequest()` at lines
589-592. (Confirmed: no current `requireAuth: false` caller streams, but
the symmetry prevents future regressions.)

#### 2. `src/lib/api/auth.ts`

Update `login()` (lines 133-154):

```ts
import { http, ApiError, TimeoutError } from '@/lib/api/http-client';
// ...

export async function login(credentials: LoginCredentials): Promise<LoginResult> {
  try {
    const raw = await http.post<RawLoginEnvelope>(
      '/api/auth/login',
      credentials,
      { requireAuth: false },
    );

    if (raw && raw.success && raw.user) {
      return {
        success: true,
        user: normalizeUser(raw.user),
        sessionToken: raw.session_token ?? raw.sessionToken ?? null,
        message: raw.message,
      };
    }

    return {
      success: false,
      error: raw?.error ?? raw?.message ?? 'Login failed',
      message: raw?.message,
    };
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      return {
        success: false,
        error: err.message || 'Invalid username or password',
      };
    }
    throw err; // TimeoutError / ApiError(0, NETWORK_ERROR) bubble up.
  }
}
```

Apply the same `try/catch` shape to `register()` (so 409/422 from the
backend become `RegisterResult.error` instead of throwing).

#### 3. `src/contexts/AuthContext.tsx`

Replace the `catch` block at lines 284-287:

```ts
} catch (error) {
  console.error('[AuthContext] Login error:', error);
  const isTimeout =
    error instanceof Error && error.name === 'TimeoutError';
  const message = isTimeout
    ? (t.auth.networkTimeout ?? 'Request timed out')
    : (t.auth.networkError ?? 'Network error');
  return { success: false, error: message };
}
```

(Avoid an `instanceof TimeoutError` import to keep AuthContext's coupling
to http-client zero — duck-type via `error.name` instead.)

#### 4. `src/lib/i18n.ts`

Add to the `auth` interface (around line 50-60):

```ts
auth: {
  // ... existing keys ...
  networkError: string;
  networkTimeout: string;
};
```

EN block (~line 2730) — add:

```ts
networkError: 'Network error — please try again',
networkTimeout: 'Request timed out — please try again',
```

ZH block (~line 5425) — add:

```ts
networkError: '网络异常，请稍后重试',
networkTimeout: '请求超时，请稍后重试',
```

### Test plan

1. **Vitest** — extend `src/lib/api/__tests__/http-client.test.ts`:
   - `requireAuth: false` + 401 → throws `ApiError(401)`, no
     `localStorage.removeItem`, no `location.href` mutation, no
     `ecliptrix:session-expired` event.
   - `requireAuth: true` + 401 → existing `SessionExpiredError` path.
   - Same matrix for `streamRequest()`.
2. **Vitest** — extend `src/lib/api/__tests__/auth.test.ts`:
   - Mock `http.post` to throw `ApiError(401, 'INVALID_CREDENTIALS', 'bad creds')`
     → `login()` resolves to `{ success: false, error: 'bad creds' }`.
   - Mock `http.post` to throw `ApiError(0, 'NETWORK_ERROR')` → `login()` rethrows.
3. **Manual** — log out, attempt `admin / WRONG`. Expected:
   - Inline error in red box: backend message (e.g. "用户名或密码错误").
   - No yellow banner. No redirect. Console: only one
     `[AuthContext] Login failed: …` line.

### Risks

- ❄️ Cold path: any future code that relies on `requireAuth: false` + 401
  triggering session expiry. Already audited; only `auth.{login,register,
  validateSession}` use `requireAuth: false` today.

---

## Bug #6 — `Test credentials: admin / *` exposed (P2)

### Review notes

- ✅ Plan is fine as-is. Add `NEXT_PUBLIC_SHOW_DEV_HINTS=false` to
  `env.template` (frontend env template — verify exact path:
  `env.template` at repo root).

### Final fix recipe

`src/components/LoginModal.tsx:199-203` — replace with:

```tsx
{process.env.NEXT_PUBLIC_SHOW_DEV_HINTS === 'true' && (
  <div className="mt-6 text-center">
    <p className="text-xs text-muted-foreground">
      Dev mode active — see internal docs for test credentials.
    </p>
  </div>
)}
```

`env.template` (repo root) — append:

```
# Optional: show dev-only hints on the login modal. Default off.
NEXT_PUBLIC_SHOW_DEV_HINTS=false
```

### Risks

None.

---

## Bug #7 — Password input not in a `<form>` (P3)

### Review notes

- ⚠️ Original plan said *"already mostly correct"* — that holds for
  `LoginModal.tsx` (it has `<form>` at line 132). **However**, the actual
  Chromium warning source is `src/components/AdminSettings/UserManagement.tsx`,
  which has **three** `<input type="password">` (lines 219, 225, 505) and
  **no `<form>` ancestor** at all (`grep -n '<form' UserManagement.tsx`
  returns zero matches). This must be wrapped.
- ⚠️ Adding `noValidate` is good but **also** add `autoComplete="new-password"`
  to the create/edit-user forms (admin creating someone else — never the
  current user's password) so 1Password / browsers don't offer to autofill
  the wrong account.

### Final fix recipe

#### `src/components/LoginModal.tsx`

Add `noValidate` to the existing form (line 132):

```tsx
<form onSubmit={handleSubmit} noValidate className="space-y-6">
```

#### `src/components/AdminSettings/UserManagement.tsx`

Wrap `CreateUserDialog`'s body (lines 209-248) and the action row
(lines 249-252) in a single `<form>`:

```tsx
<form
  noValidate
  onSubmit={(e) => { e.preventDefault(); handleSubmit(); }}
  className="contents"  // preserves existing flex layout
>
  <div className="px-6 py-4 space-y-4">
    {/* existing inputs ... */}
    <input type="password"
      autoComplete="new-password"
      ... />
    <input type="password"
      autoComplete="new-password"
      ... />
    {/* ... */}
  </div>
  <div className="sticky bottom-0 ...">
    <button type="button" onClick={onClose} ...>Cancel</button>
    <button type="submit" ...>Create</button>
  </div>
</form>
```

(Note: `className="contents"` keeps the form transparent to flex/grid;
acceptable as long as nothing depends on the form being a block. If layout
breaks, replace with the existing wrapper div and put `onSubmit` /
`noValidate` on it instead — then update Create button's onClick to call
`handleSubmit` directly. Either shape removes the warning.)

Apply the same wrap to `EditUserDialog`'s password fields around line 505.

### Test plan

- DevTools console on `/login`, on the "Create user" admin dialog, on
  "Edit user > Reset password" — no `[DOM] Password field is not contained
  in a form` warnings.
- Tab order in Create-User dialog: username → password → confirm → email
  → fullName → role → Cancel → Create. Enter inside any input submits
  (intentional).
- Browser autofill behaviour: password manager prompts to *save* but does
  NOT offer to autofill an existing credential (because of
  `autoComplete="new-password"`).

### Risks

- ⚠️ `className="contents"` on `<form>` has no Firefox/Edge issues for
  this use case. If a CI snapshot test compares DOM hierarchy, it will
  need an update.

---

## Bug #3 — System Settings accept out-of-range values (P1)

### Review notes

- ✅ Two-layer (frontend clamp + backend pydantic) is correct.
- ⚠️ Use `Field(ge=…, le=…)` instead of `conint(ge=…, le=…)` for forward
  compatibility (Pydantic v2 deprecated `conint` argument-style; both work
  but `Field` is more idiomatic now).
- ⚠️ For `extra='allow'` in V2: use `model_config = ConfigDict(extra='allow')`,
  not `class Config:`.
- ⚠️ `update_setting()` (single-key PUT) takes
  `(category, key, value)` where `value` for `tts` settings is typically
  an entire nested dict (e.g. `key='concurrency'`, `value={...}`). The
  validator must therefore receive `value` and validate its **shape** as
  the matching `BaseModel`. Plan was right at the surface; making this
  explicit avoids an off-by-one when wiring it up.
- ⚠️ Skip the "startup migration" item from the original plan. Existing
  values were generated by the same UI we're now clamping; if any are out
  of range, fixing on-write is sufficient and avoids surprising users on
  first boot. (Capture this as an "Open question" if real bad data shows
  up in QA.)
- ⚠️ Frontend `NumberField` snippet — `setRaw(String(clamped))` after
  commit is right, but also call `setRaw(String(value))` in the `useEffect`
  that watches `value` (already in the snippet). Keep an `aria-describedby`
  pointing to the hint span so screen readers announce the clamp.

### Final fix recipe

#### Backend `app/models/system_settings_models.py`

Append (do not break existing imports):

```python
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, ValidationError


# ── Per-category nested validators ──

class TTSConcurrency(BaseModel):
    model_config = ConfigDict(extra='allow')
    concurrent_threads: int = Field(ge=1, le=10)
    max_concurrent_threads: int = Field(ge=1, le=20)
    request_timeout: int = Field(ge=5, le=120)
    batch_timeout: int = Field(ge=60, le=600)


class TTSRetry(BaseModel):
    model_config = ConfigDict(extra='allow')
    max_attempts: int = Field(ge=0, le=10)
    delay_seconds: int = Field(ge=1, le=30)
    backoff_factor: int = Field(ge=1, le=5)


class TTSLimits(BaseModel):
    model_config = ConfigDict(extra='allow')
    max_segments_per_batch: int = Field(ge=10, le=200)
    max_text_length_per_segment: int = Field(ge=1000, le=10_000)
    max_total_text_length: int = Field(ge=10_000, le=500_000)


class TTSLoggingConfig(BaseModel):
    model_config = ConfigDict(extra='allow')
    enable_detailed_logs: bool
    log_progress_interval: int = Field(ge=1, le=100)
    log_level: Literal['DEBUG', 'INFO', 'WARNING', 'ERROR']


# Map: category -> (key -> validator). Add upload/watermark/etc here as
# they get explicit bounds; absent keys fall through unvalidated (with a
# WARNING log so we notice).
CATEGORY_KEY_VALIDATORS: dict[str, dict[str, type[BaseModel]]] = {
    'tts': {
        'concurrency': TTSConcurrency,
        'retry': TTSRetry,
        'limits': TTSLimits,
        'logging': TTSLoggingConfig,
        # 'voices' is a freeform list; validated by VoiceListEditor on the FE.
    },
}


def validate_setting_payload(
    category: str, key: str, value: Any,
) -> None:
    """Raise ValidationError if a known key is out of bounds. No-op for unknown keys."""
    cat = CATEGORY_KEY_VALIDATORS.get(category)
    if not cat:
        return
    model = cat.get(key)
    if model is None:
        return
    if not isinstance(value, dict):
        raise ValueError(
            f"Setting {category}.{key} expects an object, got {type(value).__name__}",
        )
    model.model_validate(value)
```

#### Backend `app/routers/system_settings_router.py`

Inject validation into both PUT paths.

`update_setting` (single-key, around line 175-208 — locate the function
that calls `system_settings_service.update_setting`):

```python
from pydantic import ValidationError
from app.models.system_settings_models import validate_setting_payload

# ... inside the PUT /{category}/{key} handler, before calling the service:
try:
    validate_setting_payload(category, key, request.value)
except (ValidationError, ValueError) as ve:
    raise HTTPException(
        status_code=422,
        detail={
            'category': category,
            'key': key,
            'errors': ve.errors() if isinstance(ve, ValidationError) else [{'msg': str(ve)}],
        },
    )
```

`batch_update_settings` (lines 211-232) — validate every key before
mutating:

```python
@router.put("/{category}")
async def batch_update_settings(
    category: str,
    request: BatchUpdateSettingsRequest,
    admin_user: User = Depends(require_admin),
):
    _validate_category(category)
    try:
        for key, value in request.settings.items():
            validate_setting_payload(category, key, value)
    except (ValidationError, ValueError) as ve:
        raise HTTPException(
            status_code=422,
            detail={
                'category': category,
                'errors': ve.errors() if isinstance(ve, ValidationError) else [{'msg': str(ve)}],
            },
        )
    # ... rest unchanged
```

#### Frontend `src/components/AdminSettings/components/SettingsFieldHelpers.tsx`

Replace `NumberField` with the clamping version:

```tsx
import React, { useEffect, useId, useState } from 'react';

const clamp = (n: number, min?: number, max?: number) => {
  if (min !== undefined && n < min) return min;
  if (max !== undefined && n > max) return max;
  return n;
};

export const NumberField: React.FC<{
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
}> = ({ label, value, onChange, min, max, step = 1 }) => {
  const hintId = useId();
  const [raw, setRaw] = useState(String(value));
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => { setRaw(String(value)); }, [value]);

  const commit = (s: string) => {
    const n = Number(s);
    if (!Number.isFinite(n)) {
      setRaw(String(value));
      return;
    }
    const clamped = clamp(n, min, max);
    if (clamped !== n) {
      setHint(`Auto-adjusted to ${clamped}`);
      window.setTimeout(() => setHint(null), 3000);
    }
    setRaw(String(clamped));
    if (clamped !== value) onChange(clamped);
  };

  const numeric = Number(raw);
  const invalid = !Number.isFinite(numeric)
    || (min !== undefined && numeric < min)
    || (max !== undefined && numeric > max);

  return (
    <div className="flex items-center justify-between gap-2">
      <label className="text-sm text-foreground">{label}</label>
      <div className="flex items-center gap-2">
        {hint && (
          <span id={hintId} className="text-xs text-amber-500">{hint}</span>
        )}
        <input
          type="number"
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commit((e.target as HTMLInputElement).value);
            }
          }}
          min={min}
          max={max}
          step={step}
          aria-invalid={invalid || undefined}
          aria-describedby={hint ? hintId : undefined}
          className="w-28 px-3 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>
    </div>
  );
};
```

(No change needed to `TTSSettingsPanel.tsx` — clamping happens inside
`NumberField`.)

### Test plan

- **pytest** new `backend-services/basic-service/tests/test_system_settings_validation.py`:
  - PUT `/api/system-settings/tts/limits` value
    `{"max_segments_per_batch": 99999, "max_text_length_per_segment": 5000, "max_total_text_length": 100000}`
    → 422 with errors loc containing `max_segments_per_batch`.
  - PUT same with `max_segments_per_batch: 50` → 200, DB updated.
  - PUT batch `/api/system-settings/tts` with one invalid key → 422 and DB unchanged.
  - PUT batch all-valid → 200.
- **Vitest** new `src/components/AdminSettings/components/__tests__/SettingsFieldHelpers.test.tsx`:
  - Type `99999` → blur → onChange called once with `200`, hint shows.
  - Type `abc` → blur → onChange not called, raw resets to current value.
  - Press Enter inside the input commits.
- **Manual**: type out-of-range, blur, see snap. Click Save → 200 OK.

### Risks

- ⚠️ The `extra='allow'` on each model means we don't reject unknown
  sub-keys (e.g. someone adds `concurrency.weird_field`). That's
  intentional — the alternative breaks backward compat when YAML
  templates introduce new fields ahead of the validator. We log nothing
  about extras, so this is silently permissive; OK because the next save
  cycle still validates the *declared* fields.
- ⚠️ Frontend `useId()` requires React 18+ — confirmed (project on React 19).

---

## Bug #2 — Workflow log shows `{ "error": {} }` (P1)

### Review notes

- ✅ Two-layer fix is correct.
- ⚠️ `formatDetails()` (`WorkflowLogPanel.tsx:81-131`) has **early returns**
  for `details.input` and `details.output` before reaching the generic
  `JSON.stringify`. Fixing only the generic branch leaves `{error: new
  Error(...)}` shaped logs broken. The safer change: introduce a
  `safeStringify` helper and use it in **all three** stringify call sites
  (lines 87, 98, 110). Or — since `details.input/output` are always
  serializable user data (never Error), only the generic branch needs the
  patch, but the helper is cheap and makes future regressions impossible.
- ⚠️ While we're here: also fix the per-node failure log at
  `WorkflowExecutor.ts:433-437` — it already extracts `error.message` but
  could include `error.cause` if present. Low priority; skip.

### Final fix recipe

#### `src/components/workflow/WorkflowExecutor.ts`

Replace line 147:

```ts
this.addLog('error', undefined, `Workflow execution failed: ${error.message}`, {
  error: error.message,
  errorType: error.name,
  stack: error.stack,
});
```

(Pattern matches the node-level log at lines 433-437.)

#### `src/components/workflow/WorkflowLogPanel.tsx`

At the top of the file (after imports), add:

```ts
const safeStringify = (val: unknown): string =>
  JSON.stringify(
    val,
    (_k, v) => {
      if (v instanceof Error) {
        return { name: v.name, message: v.message, stack: v.stack };
      }
      return v;
    },
    2,
  );
```

Replace the three `JSON.stringify(..., null, 2)` call sites in
`formatDetails` (lines 87, 98, 110) with `safeStringify(...)`.

### Test plan

- **Vitest** new `src/components/workflow/__tests__/WorkflowLogPanel.test.tsx`:
  - `formatDetails({ error: new Error('boom') })` rendered → text contains
    `"message": "boom"` and not `{}`.
  - `formatDetails({ input: { foo: 1 } })` unchanged behavior.
- **Vitest** existing `WorkflowExecutor` tests (or new):
  - Trigger "no Start node" → captured log entry's `details.error` is the
    string `"No Start node found in workflow"`.
- **Manual**: empty workflow → Run → expand log entry → see actual error
  text, not `{}`.

### Risks

None — the `safeStringify` Error-branch is a no-op for non-Error inputs.

---

## Bug #4 — Verbose `[LOG]` chatter & ChatInterface re-renders (P2)

### Review notes

- ⚠️ **Important correction to original plan's effect-deps fix.** The
  original suggested adding `chatContent` and `onUpdateContent` to the
  deps array at line 78. **Don't do that.** `onUpdateContent` updates
  `chatContent` from the parent, which produces a new `chatContent` prop
  reference, re-runs the effect, calls `onUpdateContent` again — even
  with the `hasStateChanged` guard, this risks re-render storms when the
  parent's reducer mutates other unrelated fields too. The current deps
  `[isLoading, isChatTypeModalOpen, taskId]` are *intentionally* narrow,
  and the `hasStateChanged` guard inside the effect already prevents the
  infinite-loop class of bug. The actual log spam comes from the
  **render-time** `console.log` at line 40 — fix that, leave the deps
  alone.
- ⚠️ The effect at line 78 *does* still close over `chatContent.uiState`
  for the `hasStateChanged` comparison via the dep array (where it isn't
  listed). That stale closure is harmless here because `chatContent` is
  re-read on every render (the effect closes over the latest props each
  re-run when one of the listed deps changes — and any state change in
  this component will change one of `[isLoading, isChatTypeModalOpen,
  taskId]` if that's what triggered re-render; otherwise we don't need
  to fire). For unrelated parent re-renders that change `chatContent`,
  the effect indeed won't fire — which is correct because there's
  nothing to persist. **Verdict: leave deps as-is; suppress the
  exhaustive-deps warning with a one-line comment if needed.**
- ⚠️ Throttling the per-chunk streaming log (line 536) was suggested at
  "every 25 chunks" — pick "every 50 chunks **or** at end" to keep the
  noise floor flat for long replies; or just remove it (the chunk
  contents are already visible in the UI).
- ⚠️ `dlog` helper: the original gate `process.env.NODE_ENV !==
  'production'` is fine, but we should also support a **runtime override**
  (`window.__ECLIPTRIX_DEBUG__ = true`) so we can flip it on prod for
  field debugging without a redeploy.

### Final fix recipe

#### New `src/lib/utils/debugLog.ts`

```ts
/**
 * Tiny dev-only logger. Stripped at build time when NODE_ENV=production
 * unless the user opts in at runtime via `window.__ECLIPTRIX_DEBUG__ = true`.
 */
declare global {
  interface Window {
    __ECLIPTRIX_DEBUG__?: boolean;
  }
}

const isProd = process.env.NODE_ENV === 'production';

const enabled = (): boolean => {
  if (!isProd) return true;
  if (typeof window === 'undefined') return false;
  return window.__ECLIPTRIX_DEBUG__ === true;
};

export const dlog = (...args: unknown[]): void => {
  if (enabled()) console.log(...args);
};

export const dwarn = (...args: unknown[]): void => {
  if (enabled()) console.warn(...args);
};
```

#### `src/components/chat/ChatInterface.tsx`

1. Import `dlog`. Convert all `console.log('[ChatInterface]…')` /
   `console.log('[Chat]…')` calls to `dlog`.
2. Move the render-time log at line 40 into a useEffect:

```tsx
useEffect(() => {
  dlog('[ChatInterface] Mount/restore state', {
    taskId,
    conversationsCount: chatContent.conversations.length,
    activeConversationId: chatContent.activeConversationId,
    hasAutoInitialized: hasAutoInitialized.current,
    timestamp: new Date().toISOString(),
  });
}, [taskId]); // intentionally fires only on mount + taskId change
```

3. **Do not change** the deps array of the persist-state effect at line 78.
   Add an `// eslint-disable-next-line react-hooks/exhaustive-deps` and a
   one-sentence comment explaining the `hasStateChanged` guard.
4. Throttle the streaming log (line 536):

```tsx
// inside the stream-chunk handler:
chunkCounter.current = (chunkCounter.current ?? 0) + 1;
if (chunkCounter.current % 50 === 0) {
  dlog('[Chat] streaming progress', {
    chunks: chunkCounter.current,
    totalLength: accumulatedContent.length,
  });
}
```

(Add `const chunkCounter = useRef(0);` near other refs; reset to 0 when a
new conversation/message starts.)

#### `src/components/chat/MessageBubble.tsx`

Convert `console.log('[MessageBubble] 流式消息更新', …)` (lines 59-65) to
`dlog('[MessageBubble] streaming message update', …)`. Remove or move
into a guarded mount-only block.

#### Workflow renderers

Sweep `[WorkflowInterface]`, `[WorkflowSidebar]`, `[WorkflowCanvas]`,
`[WorkflowExecutor]` `console.log` → `dlog`. The
`[WorkflowExecutor] Aborting workflow execution` log inside `abort()` is
useful — keep as `console.log` (one-shot per abort) **or** convert; either
is fine. Be consistent.

### Test plan

- **Vitest** new `src/lib/utils/__tests__/debugLog.test.ts`:
  - `process.env.NODE_ENV='production'` + no window override → `dlog`
    does NOT call `console.log`.
  - Override to `true` → does call.
  - `NODE_ENV='development'` → always calls.
- **Manual** prod build: send "hi" in chat — at most 1-2 throttled
  `[Chat] streaming progress` lines plus a `complete` line. No
  per-chunk noise. No `[ChatInterface] Initializing/Restoring state`
  spam.
- **Manual** Workflow tab: navigate around — no per-render "Rendering" logs.

### Risks

- ⚠️ Removing the render-time log may hide a state-restoration bug we
  hadn't noticed. Mitigated by `__ECLIPTRIX_DEBUG__` runtime toggle.
- ⚠️ The `eslint-disable` on the persist-state effect is intentional
  technical debt; document it in the comment so future refactors don't
  remove it without thinking.

---

## Bug #5 — Project card nested-button (ARIA / a11y) (P2)

### Review notes

- ✅ Option A (drop `role="button"` on outer; promote title to a real
  focusable element) is the right call.
- ⚠️ Original plan suggested `<a href="#">` for the title. Use a
  `<button type="button">` instead — clicking opens the project via JS,
  there's no URL involved. Anchors with `href="#"` add scroll-to-top
  edge cases and confuse middle-click ("open in new tab" silently
  no-ops).
- ⚠️ Keep "click anywhere on card" ergonomics by retaining the outer
  `onClick`. Inner buttons already `e.stopPropagation()`. Drop the
  `tabIndex={0}` and `onKeyDown` from the outer — the title button
  inherits keyboard semantics naturally.
- ⚠️ Tests: there are no current selectors that look for
  `[role="button"]` on `ProjectCard` (`grep` confirms). Safe to remove.

### Final fix recipe

`src/components/video/projects/ProjectCard.tsx` — replace the outer wrapper
(lines 58-72) and the title node (lines 91-93):

```tsx
<div
  onClick={onOpen}
  className={`group relative bg-card border border-border rounded-md hover:shadow-lg hover:border-primary/40 transition-all cursor-pointer ${
    menuOpen ? 'z-30' : ''
  }`}
>
  {/* Cover unchanged */}
  <div className="aspect-video bg-cover bg-center relative rounded-t-[5px] overflow-hidden" style={cover}>
    {/* unchanged */}
  </div>

  <div className="px-3 py-2.5 space-y-1">
    <div className="flex items-start gap-2">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
        className="flex-1 text-left text-sm font-medium text-foreground truncate
                   bg-transparent hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
      >
        {project.name || t.videoProjects.untitled}
      </button>

      {/* Actions kebab — sibling of the title button */}
      <div className="relative">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMenuOpen((v) => !v);
          }}
          className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-accent opacity-0 group-hover:opacity-100 transition-opacity"
          aria-label={t.videoProjects.projectActions ?? 'Project actions'}
        >
          {/* svg unchanged */}
        </button>
        {/* menu portal/dropdown unchanged */}
      </div>
    </div>
    {/* description and timestamp unchanged */}
  </div>
</div>
```

Notes:
- Outer `<div>` has no `role`, no `tabIndex`, no `onKeyDown` — it is a
  "decorative click target" only.
- The card is keyboard-accessible via the title button (Tab) and the
  kebab button (Tab again).
- Outer `onClick={onOpen}` is preserved for "click anywhere" ergonomics.
- `aria-label` on kebab uses an i18n key; if `t.videoProjects.projectActions`
  doesn't exist yet, add it to the locale (EN: "Project actions",
  ZH: "项目操作").

### Test plan

- **Vitest** add to `ProjectCard.test.tsx` (create if absent):
  - Render → title button is focusable; outer div has no `role` and no `tabIndex`.
  - Fire `click` on the kebab → `onOpen` not called.
  - Fire `keyDown(Enter)` on the title button → `onOpen` called once.
- **Manual** Axe / Lighthouse a11y: the "interactive descendant of role=button"
  warning gone.
- **Manual** Tab order: title → kebab. Visible focus rings on both.

### Risks

- ⚠️ Some i18n locales may not have `projectActions`; double-check before
  shipping or fall back to a literal string.
- ⚠️ Visual change: the title is now styled like a button on hover
  (underline). Keep it minimal — `hover:underline` only, no color shift,
  to match existing card aesthetic.

---

## Cross-cutting concerns

### Implementation order (final)

Land in this order to keep PRs reviewable and minimize merge conflicts:

| PR | Bugs | Files | LoC est. |
|----|------|-------|---------:|
| A — auth UX | #1, #6, #7 | `http-client.ts`, `auth.ts`, `AuthContext.tsx`, `i18n.ts`, `LoginModal.tsx`, `UserManagement.tsx`, `env.template` | ~300 |
| B — settings validation | #3 | `system_settings_models.py`, `system_settings_router.py`, `SettingsFieldHelpers.tsx`, new tests | ~250 |
| C — workflow log + a11y | #2, #5 | `WorkflowExecutor.ts`, `WorkflowLogPanel.tsx`, `ProjectCard.tsx`, new tests | ~120 |
| D — logging hygiene | #4 | new `debugLog.ts`, `ChatInterface.tsx`, `MessageBubble.tsx`, `Workflow{Interface,Sidebar,Canvas}.tsx`, `WorkflowExecutor.ts`, new tests | ~200 |

### Test coverage

New / extended files:

- `src/lib/api/__tests__/http-client.test.ts` (extend) — Bug #1.
- `src/lib/api/__tests__/auth.test.ts` (extend) — Bug #1.
- `src/lib/utils/__tests__/debugLog.test.ts` (new) — Bug #4.
- `src/components/AdminSettings/components/__tests__/SettingsFieldHelpers.test.tsx` (new) — Bug #3.
- `src/components/workflow/__tests__/WorkflowLogPanel.test.tsx` (new) — Bug #2.
- `src/components/video/projects/__tests__/ProjectCard.test.tsx` (new) — Bug #5.
- `backend-services/basic-service/tests/test_system_settings_validation.py` (new) — Bug #3.

### Manual verification checklist

Run after each PR merges to dev (`192.168.1.123:3010`):

- [ ] Wrong-credentials login on `/login` shows inline backend message only,
      no banner, no redirect, console clean.
- [ ] Login modal does NOT show "Test credentials" hint.
- [ ] DevTools console on `/login`, Create-User dialog, Edit-User
      Reset-Password dialog: no "Password field is not contained in a
      form" warnings.
- [ ] TTS settings: typing 99999 in `每批最大段数` then blurring snaps to
      200 with hint; Save returns 200.
- [ ] TTS settings: bypassing the UI (`curl PUT` with 99999) returns 422.
- [ ] Workflow tab: empty workflow → Run → log entry expand shows actual
      error message, not `{}`.
- [ ] Project card: Tab focuses title, then kebab. Enter on title opens
      project; click on kebab does NOT open project.
- [ ] Chat tab: send a streaming message in prod build — console has at
      most 2-3 lines, not per-chunk spam.

### Open questions (deferred)

1. **Bug #3** — should we add a startup migration to clamp pre-existing
   out-of-range DB rows? **Decision:** No, ship validation-on-write and
   revisit only if QA finds offending rows.
2. **Bug #4** — keep `WorkflowExecutor` step-level `console.log`s for AI
   agents that read browser logs? **Decision:** Convert to `dlog` for
   consistency. Agent runs can flip `__ECLIPTRIX_DEBUG__` from devtools
   if they need verbose output.
3. **Bug #1** — `register()` should also be unified (catch ApiError(409)
   for "username taken"). **Decision:** Yes; bundled in PR-A.

---

## Summary — what changed vs original plan

| Bug | Change |
|-----|--------|
| #1 | Added i18n key plumbing (`auth.networkError`/`auth.networkTimeout`); duck-type `TimeoutError` in AuthContext to avoid import coupling; also unify `register()`. |
| #2 | Apply `safeStringify` to all three `formatDetails` stringify sites, not only the generic branch. |
| #3 | Use `Field(ge=…, le=…)` over `conint`; `ConfigDict(extra='allow')` for V2; drop startup migration; add `aria-describedby` to NumberField. |
| #4 | **Don't** add `chatContent` to the line-78 effect deps (would cause re-render storms). Move the line-40 log into a `[taskId]` effect instead. Add `__ECLIPTRIX_DEBUG__` runtime toggle. |
| #5 | Use `<button type="button">` for the title (not `<a href="#">`); drop outer `tabIndex`/`onKeyDown` (title button covers keyboard a11y). |
| #6 | No change — plan was correct. Add `NEXT_PUBLIC_SHOW_DEV_HINTS=false` to `env.template`. |
| #7 | **Promoted from "audit"**: explicitly wrap `UserManagement.tsx` Create/Edit-User dialogs in `<form noValidate>` with `autoComplete="new-password"` on password inputs. This is the actual source of the warning. |
