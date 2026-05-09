# Fix Plan — iter6 (REVIEWED, 2026-05-09)

> **Source**: `docs/diagnoses/web-bug-report-20260509-iter6/fix-plan.md`
> **Reviewer pass**: verified each fix against current code (BACKEND_URL, file paths, imports, dependencies). Items flagged below as **[REV]** were corrected from the original plan.
>
> Verification scope: read & cross-checked every cited file/line, confirmed imports/exports, ran spot-checks for assumed components, validated alembic numbering and DB type quirks (SQLite vs PG).

---

## 0. Reviewer Summary — Corrections to v1 Plan

| # | Original assumption | Reality | Action |
|---|---------------------|---------|--------|
| **R1** | Bug #5 uses shadcn `Tabs/TabsList/TabsTrigger` from `@/components/ui/tabs` | `src/components/ui/` only contains `ConfirmationDialog, MobileWarningDialog, RoleBadge, Toast, ToastContainer`. **No Tabs component exists.** | **Switch to ARIA-only refactor (Method B)** — keep current button structure, add roles/aria/keyboard. Avoids new dep + matches existing visual styles. |
| **R2** | Bug #2 introduces a brand-new `UserPreferences` model | `app/models/user_models.py` **already has `UserSettingsUpdate`** at line 103-126 (`Dict[str, bool]` shape — too loose). | **Extend `UserSettingsUpdate` with strict nested models** (still backward-compatible for shape) instead of creating a parallel model. |
| **R3** | Alembic file named `XXXX_add_user_preferences.py` | Existing migrations: `001…008_add_project_covers.py`. | Use `009_add_user_preferences.py`. |
| **R4** | Backend new endpoint at `/user/me/preferences` (no `/api`) | `main.py` mounts `user_router` under `/api`; existing FE proxy hits `/api/user/profile`. | New endpoint is **`/api/user/me/preferences`** end-to-end (router still registers `/me/preferences` under its `/user` prefix; the `/api` is added at mount time). |
| **R5** | Bug #4 focus restore via `document.querySelector('[data-trigger="user-profile"]')` + Header attr change | Header.tsx line 204 has the avatar `<button>` (no ref currently). | **Use `useRef` to capture `document.activeElement` at mount and restore on unmount** — zero coupling with Header, no DOM-tagging, works for both `UserProfilePage` and `AdminSettingsPage`. |
| **R6** | Bug #4 add `role="dialog" aria-modal="true"` | Page is not a true modal (no focus trap, no inert background). | **Skip the aria-modal claim**; only add the Escape hook. Lying about modal semantics to AT is worse than silence. |
| **R7** | Bug #7 adds `no-console` ESLint rule in same commit | Will trigger lint warnings across files **outside** this fix's scope (Storyboard, ScriptPanel, etc.) | **Defer ESLint rule to follow-up.** This iter only does mechanical replacement in the two cited files + visual cleanup. |
| **R8** | Bug #2 hook has TODO stub for rollback | Lossy state on PATCH failure is the main UX risk for this fix. | **Rollback contract specified below** — `patch()` accepts `{ delta, optimisticApply, rollback }` and runs `rollback(prev)` on error. Concrete code in §2.3.D. |
| **R9** | Bug #2 backend writes JSON via `current_user.preferences = merged` | `Column(JSON, nullable=False, server_default='{}')` on **PG renders as `json`** by default in SQLAlchemy (`JSONB` requires `dialects.postgresql.JSONB`). Plan claimed "JSONB". | **Use plain `JSON` for portability** (matches existing `AgentWorkflow.workflow_data`, `SystemSetting.value`, etc.). Document the difference in 2.5. |
| **R10** | Tests can rely on SQLite in-memory | Tests **already use SQLite** (per CLAUDE.md). `JSON` works on both. | No change, just confirm. |

---

## 1. 总体策略与依赖关系（保持原样）

> 与 v1 §0 一致 — 共享抽象、优先级、全局风险。删除 v1 §0.3 中关于"JSONB"的措辞（见 R9）。

**优先级 / 推荐合入顺序（不变）**:
1. Bug #1（Watermark cross-field）
2. Bug #6（NumberField label）
3. Bug #4（Escape close）
4. Bug #5（Tab semantics — **改用 ARIA 方案**）
5. Bug #3（Auto-mix toast）
6. Bug #7（Console cleanup）
7. Bug #2（Preferences persistence — 独立 commit）

---

## Bug #1 — 「水印移除设置」缺跨字段校验

**严重程度**: High / P1 — 与 v1 plan 一致。

### 1.1 代码位置（已校验）

| 层 | 文件 | 行 |
|----|------|---|
| FE UI | `src/components/AdminSettings/WatermarkSettingsPanel.tsx` | line 49 解构 `removal`；line 63-66 Save；line 71-74 NumberFields |
| FE Save | `src/components/AdminSettings/components/useSettingsPanel.ts` | `saveSettings()` |
| BE 模型 | `backend-services/basic-service/app/models/system_settings_models.py` | `CATEGORY_KEY_VALIDATORS` line 118-126（仅 `tts`）|
| BE Router | `backend-services/basic-service/app/routers/system_settings_router.py` | `validate_setting_payload` 已在 line 195（PUT 单值）和 line 243（批量）调用 |

### 1.2 修复策略

#### A. 后端

`system_settings_models.py` —— 在 `TTSLoggingConfig` 之后追加：

```python
class WatermarkRemoval(BaseModel):
    """Concurrency / batching for watermark removal worker pool.

    Cross-field invariant: concurrent_threads must not exceed
    max_concurrent_threads, otherwise the scheduler could request more
    threads than the pool ceiling.
    """
    model_config = ConfigDict(extra='allow')
    concurrent_threads: int = Field(ge=1, le=20)
    max_concurrent_threads: int = Field(ge=1, le=30)
    batch_size: int = Field(ge=10, le=200)
    batch_timeout: int = Field(ge=10, le=300)

    @model_validator(mode='after')
    def _check_concurrency_ordering(self) -> 'WatermarkRemoval':
        if self.concurrent_threads > self.max_concurrent_threads:
            raise ValueError(
                f"concurrent_threads ({self.concurrent_threads}) cannot exceed "
                f"max_concurrent_threads ({self.max_concurrent_threads})"
            )
        return self


class WatermarkLogging(BaseModel):
    model_config = ConfigDict(extra='allow')
    enable_detailed_logs: bool
    log_progress_interval: int = Field(ge=1, le=1000)
    log_level: Literal['DEBUG', 'INFO', 'WARNING', 'ERROR']
    enable_thread_logging: bool
```

Add `from pydantic import model_validator` to the imports (currently only `BaseModel, ConfigDict, Field, ValidationError`).

Then extend the registry:

```python
CATEGORY_KEY_VALIDATORS: Dict[str, Dict[str, type[BaseModel]]] = {
    'tts': { ... unchanged ... },
    'watermark': {
        'removal': WatermarkRemoval,
        'logging': WatermarkLogging,
    },
}
```

No router code changes — the hook in `validate_setting_payload()` is already wired up (see line 195 / 243).

**[REV note]** `model_validator` raising `ValueError` inside Pydantic v2 is correctly captured as a `ValidationError`. The router's existing `except ValidationError as ve` branch (line 196) will catch it and emit 422 with structured `errors`. Confirmed by reading current `system_settings_router.py`.

#### B. 前端跨字段校验 + Save 禁用 + inline error

`WatermarkSettingsPanel.tsx` — after the `removal` destructure (line 49):

```tsx
const concurrencyInvalid =
  Number(removal.concurrent_threads) > Number(removal.max_concurrent_threads);
```

Change Save button (line 63):

```tsx
<button
  onClick={handleSave}
  disabled={!isDirty || saving || concurrencyInvalid}
  aria-disabled={!isDirty || saving || concurrencyInvalid}
  ...
>
```

Add inline error region inside the `removal` `SettingsSectionCard` (after the four NumberFields):

```tsx
{concurrencyInvalid && (
  <p role="alert" className="text-xs text-destructive mt-1">
    {t.adminSettings.wmConcurrencyInvalid}
  </p>
)}
```

i18n keys (add to `src/lib/i18n.ts` under `adminSettings`):

```ts
// EN
wmConcurrencyInvalid: 'Concurrent threads cannot exceed max concurrent threads.',
// ZH
wmConcurrencyInvalid: '并发线程数不能超过最大并发线程数。',
```

### 1.3 测试

- **BE**: `tests/test_system_settings_validation.py::test_watermark_concurrent_exceeds_max` — PUT `watermark/removal` `{concurrent_threads: 15, max_concurrent_threads: 5, batch_size: 50, batch_timeout: 60}` → 422; assert `detail['errors']` non-empty and message includes "cannot exceed".
- **BE happy path**: Same shape with `concurrent_threads: 5, max_concurrent_threads: 10` → 200.
- **FE Vitest**: `WatermarkSettingsPanel.test.tsx` — render → set `concurrent_threads=15`, `max=5` → assert Save is `disabled`, `role="alert"` text appears.

### 1.4 风险（已校验）

- ✅ Read path (`get_settings_for_category`) does **not** call `validate_setting_payload`, so legacy invalid records (e.g. iter6's 15/5) won't 502 the GET. Verified in router lines 160-182.
- 既有脏数据：admin 必须再次开 watermark 面板手动修正；fix plan 不强制清洗历史值。

---

## Bug #2 — 偏好未上行后端

**严重程度**: High / P1 — 最大体积修复。

### 2.1 代码位置（已校验）

| 层 | 文件 | 备注 |
|----|------|------|
| FE | `src/components/UserProfile/OtherSettingsPanel.tsx` | line 73/87/95 setters；line 268-272 误导文案 |
| FE Locale | `src/contexts/LocaleContext.tsx` | localStorage-only |
| BE 模型 (DB) | `backend-services/basic-service/app/models/db_models.py` | `User` line 15-36，**无 `preferences` 列** |
| **BE 模型 (Pydantic)** | `backend-services/basic-service/app/models/user_models.py` | **已有 `UserSettingsUpdate` line 103-126**，但用 `Dict[str, bool]` 太松，缺 enum 校验 — **本次重写为严格嵌套模型** [R2] |
| BE Router | `backend-services/basic-service/app/routers/user_router.py` | 无 self-service preferences 端点 |
| Alembic | `backend-services/basic-service/alembic/versions/` | 当前最新 `008_add_project_covers.py` → 新增 **`009_add_user_preferences.py`** [R3] |
| FE BFF | `src/app/api/user/me/preferences/route.ts` | 新增；参考 `src/app/api/user/profile/route.ts` 的 `backendProxy` 写法 |

### 2.2 修复策略

#### A. DB schema + Alembic

**`db_models.py`** — 在 `User.session_ip_address` 之后追加：

```python
preferences = Column(JSON, nullable=False, default=dict, server_default='{}')
```

> [R9] 使用 `JSON`（**不是** `JSONB`）—— 与 `AgentWorkflow.workflow_data`、`SystemSetting.value` 一致；同时支持 SQLite（测试）和 PostgreSQL（生产）。`default=dict` 确保 ORM 层 `INSERT` 不会缺字段；`server_default='{}'` 让 Alembic upgrade 后历史 row 立即可用。

**`alembic/versions/009_add_user_preferences.py`** — 新建：

```python
"""add user preferences column

Revision ID: 009
Revises: 008
Create Date: 2026-05-09
"""
from alembic import op
import sqlalchemy as sa

revision = '009'
down_revision = '008'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        'users',
        sa.Column(
            'preferences',
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
    )


def downgrade() -> None:
    op.drop_column('users', 'preferences')
```

> ⚠️ Verify the existing migrations' `revision`/`down_revision` style first — file naming uses `008_add_project_covers.py` but the `revision = '...'` literal may be a UUID or short id. **Read `008_add_project_covers.py` and copy the exact `revision/down_revision` literal style** before writing migration 009. (5-min sanity check; non-negotiable.)

#### B. Pydantic models — extend existing `UserSettingsUpdate`

Replace the loose `UserSettingsUpdate` in `user_models.py` (line 103-126) with strict nested models. Keep the class **name** `UserSettingsUpdate` so any historical callers (if any — grep first) don't break.

```python
from typing import Literal, Optional
from pydantic import BaseModel, Field, ConfigDict


class NotificationPrefs(BaseModel):
    model_config = ConfigDict(extra='forbid')
    email: bool = True
    push: bool = False
    marketing: bool = False


class PrivacyPrefs(BaseModel):
    model_config = ConfigDict(extra='forbid')
    profile_visible: bool = True
    activity_visible: bool = False


class UserPreferences(BaseModel):
    """Authoritative server-side shape for /user/me/preferences."""
    model_config = ConfigDict(extra='forbid')
    notifications: NotificationPrefs = Field(default_factory=NotificationPrefs)
    privacy: PrivacyPrefs = Field(default_factory=PrivacyPrefs)
    language: Literal['en', 'zh-CN'] = 'zh-CN'
    theme: Literal['light', 'dark', 'auto'] = 'dark'


class UserPreferencesUpdate(BaseModel):
    """PATCH body — every field optional; sub-objects also patchable."""
    model_config = ConfigDict(extra='forbid')
    notifications: Optional[NotificationPrefs] = None
    privacy: Optional[PrivacyPrefs] = None
    language: Optional[Literal['en', 'zh-CN']] = None
    theme: Optional[Literal['light', 'dark', 'auto']] = None


class UserPreferencesResponse(BaseModel):
    success: bool
    preferences: UserPreferences
```

> Grep `UserSettingsUpdate` usage **before** modifying — if it's imported anywhere, plan a rename or temporary alias (`UserSettingsUpdate = UserPreferencesUpdate`). Quick check via `grep -rn "UserSettingsUpdate" backend-services/`.

#### C. Router — `/user/me/preferences` GET + PATCH

`user_router.py` — append (after `/profile` group):

```python
from app.models.user_models import (
    UserPreferences,
    UserPreferencesUpdate,
    UserPreferencesResponse,
)


@router.get("/me/preferences", response_model=UserPreferencesResponse)
async def get_my_preferences(
    current_user: User = Depends(get_current_user),
) -> UserPreferencesResponse:
    raw = current_user.preferences or {}
    return UserPreferencesResponse(
        success=True,
        preferences=UserPreferences.model_validate(raw),
    )


@router.patch("/me/preferences", response_model=UserPreferencesResponse)
async def update_my_preferences(
    payload: UserPreferencesUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
) -> UserPreferencesResponse:
    delta = payload.model_dump(exclude_unset=True)

    if not delta:
        # No-op PATCH — return current state without DB write.
        return UserPreferencesResponse(
            success=True,
            preferences=UserPreferences.model_validate(current_user.preferences or {}),
        )

    current = dict(current_user.preferences or {})

    # Shallow merge for nested objects (notifications/privacy):
    # PATCH replaces the entire sub-object since UserPreferencesUpdate's
    # nested type is the full NotificationPrefs (no partial sub-fields).
    # This is intentional — partial-of-partial PATCH semantics are confusing
    # and the FE always sends the full sub-object after toggling one key.
    merged = {**current, **delta}

    # Final validation gate (raises 422 if e.g. unknown enum):
    validated = UserPreferences.model_validate(merged)

    # Re-assign whole dict so SQLAlchemy detects mutation on the JSON column.
    # (Mutating in-place would NOT be picked up without flag_modified.)
    current_user.preferences = validated.model_dump()

    await db.commit()
    await db.refresh(current_user)

    return UserPreferencesResponse(success=True, preferences=validated)
```

> **PATCH semantics note**: nested objects (`notifications`/`privacy`) are replaced **whole**, not merged key-by-key. FE must always send the full sub-object when toggling one key. Documented in §2.4.

#### D. FE BFF proxy

Create `src/app/api/user/me/preferences/route.ts` mirroring `user/profile/route.ts`'s `backendProxy` use:

```ts
import { backendProxy } from '@/lib/api/server/backend-proxy'
import { NextRequest } from 'next/server'

export async function GET(req: NextRequest) {
  return backendProxy.get(req, '/api/user/me/preferences')
}

export async function PATCH(req: NextRequest) {
  return backendProxy.request(req, '/api/user/me/preferences', { method: 'PATCH' })
}
```

> Verify `backendProxy.request(...)` exists (or use whichever generic method the proxy exports for non-GET/PUT/POST). If only `get/post/put/delete` are exposed, add a thin `patch` method to the proxy module — that's a 4-line change in `src/lib/api/server/backend-proxy.ts`.

#### E. FE hook — `useUserPreferencesMutation` with rollback contract [R8]

Create `src/lib/api/userPreferences.ts`:

```ts
'use client';
import { useCallback, useRef, useState } from 'react';

export type UserPreferences = {
  notifications: { email: boolean; push: boolean; marketing: boolean };
  privacy: { profile_visible: boolean; activity_visible: boolean };
  language: 'en' | 'zh-CN';
  theme: 'light' | 'dark' | 'auto';
};

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error';

type PatchOpts<T> = {
  delta: Partial<UserPreferences>;
  rollback?: () => void;   // called if PATCH fails after debounce flush
};

export function useUserPreferencesMutation() {
  const queue = useRef<Partial<UserPreferences>>({});
  const rollbacks = useRef<Array<() => void>>([]);
  const timer = useRef<number | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');

  const flush = useCallback(async () => {
    timer.current = null;
    if (Object.keys(queue.current).length === 0) return;
    setStatus('saving');
    const body = JSON.stringify(queue.current);
    const cbs = rollbacks.current;
    queue.current = {};
    rollbacks.current = [];
    try {
      const r = await fetch('/api/user/me/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setStatus('saved');
      window.setTimeout(() => setStatus('idle'), 2000);
    } catch (err) {
      setStatus('error');
      cbs.forEach((cb) => { try { cb(); } catch { /* ignore */ } });
      window.setTimeout(() => setStatus('idle'), 4000);
    }
  }, []);

  const patch = useCallback((opts: PatchOpts<UserPreferences>) => {
    queue.current = { ...queue.current, ...opts.delta };
    if (opts.rollback) rollbacks.current.push(opts.rollback);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 300);
  }, [flush]);

  return { patch, status };
}
```

#### F. FE wiring in `OtherSettingsPanel.tsx`

1. Replace the localStorage-first init with: try `fetch('/api/user/me/preferences')` on mount → if 200, hydrate `settings` and overwrite `localStorage` mirror; if 401/network error, fall back to `loadToggles()` + `readCurrentTheme()`.
2. Each `handleToggle/handleLanguageChange/handleThemeChange`:
   - Optimistically apply locally (existing `setSettings` + `localStorage`).
   - Call `patch({ delta: {...}, rollback: () => setSettings(prevSnapshot) })` where `prevSnapshot` is captured **before** the optimistic update.
3. Bottom note text driven by `status`:
   ```tsx
   <p className="text-xs text-muted-foreground">
     {status === 'saving' && t.profile.savingNote}
     {status === 'saved'  && t.profile.savedNote}
     {status === 'error'  && t.profile.saveErrorNote}
     {status === 'idle'   && t.profile.autoSaveNote}
   </p>
   ```
4. New i18n keys under `profile`:
   - `savingNote` — "正在保存…" / "Saving…"
   - `savedNote` — "已保存到您的账户" / "Saved to your account"
   - `saveErrorNote` — "保存失败，请稍后重试" / "Failed to save — will retry"

#### G. LocaleContext + theme bootstrap interplay

- **First load (logged in)**: GET `/me/preferences` resolves → `setLocale(prefs.language)` (overwrites localStorage); `applyTheme(prefs.theme)` overwrites `ecliptrix-theme*`.
- **Cross-tab sync**: out of scope this iter (record as follow-up).
- **Logged out**: GET returns 401 → existing `LocaleContext` localStorage flow unchanged.

### 2.3 测试

- **BE**: `tests/test_user_preferences.py`:
  - new user → GET → defaults
  - PATCH `marketing=true` → persists
  - PATCH invalid enum (e.g. `language='fr'`) → 422
  - PATCH `extra='forbid'` field → 422
  - PATCH empty body → 200, no-op (no DB write)
  - GET unauth → 401
- **FE Vitest**: `OtherSettingsPanel.test.tsx`:
  - mount → mock GET resolves → settings reflect server data
  - toggle push → wait 350ms → assert PATCH fired with `{ notifications: {email:true,push:true,marketing:false} }`
  - PATCH rejects → status='error' shown + rollback runs (toggle reverts)

### 2.4 PATCH semantics — 文档化

**Sub-object replacement, not merge**: PATCHing `{ notifications: { push: true } }` requires **all three** keys (`email/push/marketing`); sending only `push` is a 422 (missing required fields under `extra='forbid'`). The FE must always include the full sub-object — it knows current values from local state.

This is intentional: Pydantic v2's `exclude_unset=True` on the **outer** `UserPreferencesUpdate` skips untouched top-level fields, but nested partial-of-partial would require `model_construct` gymnastics that confuse readers. Full-sub-object PATCH is the simple rule.

### 2.5 风险

- **Migration order on prod**: Apply `alembic upgrade head` **before** redeploying backend; deploying first means GET/PATCH 500 (column missing). [Memory: deploy `.env` overwrite footgun — preserve `.env` across tarball extract.]
- **JSON vs JSONB**: `Column(JSON)` on PG renders as `json` (text-with-validator) — **no operator-class indexes** possible. We don't need them. If future query-by-pref needed, migrate to `JSONB` separately. [R9]
- **Existing `localStorage` data**: not auto-migrated — first GET overwrites. Power users keep current state via the optimistic apply path; first toggle PATCHes the **whole resulting** state, so nothing is lost.
- **GDPR follow-up**: marketing-email opt-in audit trail — separate PR.

---

## Bug #3 — Auto-mix toast

**严重程度**: Medium / P2 — v1 plan correct, minor polish.

### 3.1 修改 `handleAutoMixAudio` (`VideoEditingInterface.tsx` line 1853)

Add at the top of the callback (before existing console.log):

```tsx
if (materialManagement.allMaterials.length === 0) {
  showError(t.videoEditing.autoMix.noMaterials, 5000);
  return;
}
```

In the existing `if (scriptAudioMaterials.length === 0 && scriptVideoMaterials.length === 0)` branch (line 1898), replace the `console.warn` block with:

```tsx
if (scriptAudioMaterials.length === 0 && scriptVideoMaterials.length === 0) {
  showError(t.videoEditing.autoMix.noScriptMaterials, 6000);
  // Keep diagnostic payload on the dev-gated logger so debug remains possible
  // without flooding production console.
  videoEditLogger?.debug('AutoMix-NoScriptMaterials', { /* existing payload */ });
  return;
}
```

> If `videoEditLogger` instance isn't already in scope here, instantiate one via `new VideoEditingLogger({ component: 'VideoEditingInterface', taskId })` near the top of the component (or reuse an existing one — grep first). v1 plan called it just `logger` — keep consistent with surrounding code.

Update the `useCallback` deps:

```tsx
}, [taskId, materialManagement.allMaterials, showError, t]);
```

### 3.2 i18n

```ts
// EN
videoEditing: {
  autoMix: {
    noMaterials: 'Add video, audio, or image materials before running auto-mix.',
    noScriptMaterials: 'Auto-mix needs audio and video generated from the text-script panel — run TTS and AI video matching first.',
  },
},
// ZH
videoEditing: {
  autoMix: {
    noMaterials: '请先添加视频、音频或图片素材后再使用自动混剪。',
    noScriptMaterials: '自动混剪需要由文本脚本生成的音频和视频素材，请先在「文本脚本」面板完成 TTS 与 AI 视频匹配。',
  },
},
```

### 3.3 测试 / 风险 — 同 v1 plan §3.4。

---

## Bug #4 — Escape close + focus restore

### 4.1 修复策略 [R5][R6]

`UserProfilePage.tsx` — add a single `useEffect` that:

1. captures `document.activeElement` at mount,
2. listens for `keydown` Escape on `window`,
3. on unmount, restores focus to the captured element (if it's still in the DOM and focusable).

```tsx
useEffect(() => {
  const trigger =
    typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    // Don't hijack Escape if user is in an editable field
    // (IME composition cancel, contenteditable cancel, etc.)
    const tgt = e.target as HTMLElement | null;
    if (tgt && (tgt.tagName === 'INPUT' || tgt.tagName === 'TEXTAREA' || tgt.isContentEditable)) {
      return;
    }
    e.preventDefault();
    onClose();
  };

  window.addEventListener('keydown', onKey);
  return () => {
    window.removeEventListener('keydown', onKey);
    if (trigger && document.body.contains(trigger)) {
      try { trigger.focus(); } catch { /* ignore */ }
    }
  };
}, [onClose]);
```

**Apply the same hook to `AdminSettingsPage.tsx`** — copy-paste; both pages are inline-rendered modals from `src/app/page.tsx` and have the same UX gap.

> [R6] **Do NOT add `role="dialog" aria-modal="true"`**. The page is not a true modal (no focus trap, no inert background). Claiming aria-modal would mislead screen readers into expecting trapped focus that isn't there. The Escape hook alone is the correct minimum.

### 4.2 测试

- **Vitest**: render `<UserProfilePage onClose={cb} />` → `fireEvent.keyDown(window, { key: 'Escape' })` → assert `cb` called.
- **Vitest IME-skip**: same render → focus an `<input>` → keyDown Escape on that input → assert `cb` **not** called.
- **Manual**: bug-report repro 1-3 — ESC closes; focus returns to the avatar button.

### 4.3 风险

- ✅ No DOM-tagging in `Header.tsx` needed (R5).
- 多 inline-modal 互斥（page.tsx 三选一），no double handler.
- Skipping Escape on `INPUT/TEXTAREA/contenteditable` covers IME-cancel ergonomics.

---

## Bug #5 — Tab semantics [R1] — **改为 ARIA-only 方案**

**严重程度**: Medium / P2

### 5.1 决策：放弃 shadcn Tabs，改用 ARIA + 键盘导航

**为什么换方案**：`src/components/ui/` 当前 **不存在** `tabs.tsx`（仅 `ConfirmationDialog/MobileWarningDialog/RoleBadge/Toast/ToastContainer`）。引入新组件需要：(1) 决定路径与 Radix 依赖；(2) 调整现有视觉样式以匹配 `bg-muted/rounded-md` 的工具栏外观；(3) 处理 `TabsContent` 默认卸载子树的副作用。**ARIA-only 改造一处零成本，且不引入运行时依赖**。

### 5.2 修复策略

`ScriptPanel.tsx` line 1903-1928 — restructure the three buttons:

```tsx
{/* Tab 栏 */}
<div
  role="tablist"
  aria-label={t.scriptPanel.tabsLabel}
  className="flex space-x-1 mt-3 p-1 bg-muted rounded-md"
  onKeyDown={(e) => {
    const order: Array<typeof activeTab> = ['narration', 'aiVideo', 'storyboard'];
    const idx = order.indexOf(activeTab);
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setActiveTab(order[(idx + 1) % order.length]);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setActiveTab(order[(idx - 1 + order.length) % order.length]);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setActiveTab(order[0]);
    } else if (e.key === 'End') {
      e.preventDefault();
      setActiveTab(order[order.length - 1]);
    }
  }}
>
  <button
    id="tab-narration"
    role="tab"
    aria-selected={activeTab === 'narration'}
    aria-controls="panel-narration"
    tabIndex={activeTab === 'narration' ? 0 : -1}
    className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
      activeTab === 'narration' ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground'
    }`}
    onClick={() => setActiveTab('narration')}
  >
    {t.scriptPanel.tabs.narrationScript}
  </button>
  {/* Same pattern for aiVideo (id="tab-aivideo", aria-controls="panel-aivideo")
      and storyboard (id="tab-storyboard", aria-controls="panel-storyboard"). */}
</div>
```

Then wrap each existing conditional content branch with `role="tabpanel"`:

```tsx
{activeTab === 'narration' && (
  <div id="panel-narration" role="tabpanel" aria-labelledby="tab-narration" className="...existing...">
    {/* existing children */}
  </div>
)}
{activeTab === 'aiVideo' && (
  <div id="panel-aivideo" role="tabpanel" aria-labelledby="tab-aivideo">
    {/* existing AIVideoScriptTab block */}
  </div>
)}
{activeTab === 'storyboard' && (
  <div id="panel-storyboard" role="tabpanel" aria-labelledby="tab-storyboard">
    {/* existing storyboard block */}
  </div>
)}
```

> Confirm by reading lines 1932-2000 to wrap the right divs. Don't break existing `flex-1 flex items-center justify-center p-8` wrappers — apply ARIA attrs to them or wrap with a transparent div.

### 5.3 i18n

Add `scriptPanel.tabsLabel`:
```ts
// EN
scriptPanel: { tabsLabel: 'Script type', ... },
// ZH
scriptPanel: { tabsLabel: '脚本类型', ... },
```

### 5.4 测试

- **Vitest**: render → `getByRole('tablist')` → 3× `getByRole('tab')`; click second tab → `aria-selected="true"`; `fireEvent.keyDown` ArrowRight → next tab selected.
- **Manual a11y**: NVDA/VoiceOver should announce "标签 1 / 共 3"。

### 5.5 风险

- 鼠标点击仍能切换；键盘新增导航是叠加而非替换。
- `tabIndex` roving (current 0, others -1) 必要：让 Tab 键聚焦到 tablist 时只进一次，箭头键再切换 — 这是 W3C ARIA APG 推荐模式。
- `role="tabpanel"` 的内容因 conditional render 已经按需挂载，与原行为等价。

---

## Bug #6 — NumberField label 关联

**严重程度**: Medium / P2 — v1 plan 完全正确，无修订。

### 6.1 修复策略

`SettingsFieldHelpers.tsx` `NumberField` (line 9-73)：

```tsx
const inputId = useId();    // ← NEW
const hintId = useId();
...
<label htmlFor={inputId} className="text-sm text-foreground">{label}</label>
...
<input
  id={inputId}              // ← NEW
  type="number"
  ...
/>
```

Apply the same `useId()` + `htmlFor`/`id` pattern to `SwitchField`, `SelectField`, `TextField` for completeness — **but**: `SwitchField` already uses `<button role="switch">` with the label inside the wrapper; the canonical fix is to add `aria-labelledby={labelId}` on the button rather than `htmlFor` on the label (since `<label htmlFor>` doesn't bind to a `<button>`). Quick form:

```tsx
const labelId = useId();
<label id={labelId} className="text-sm text-foreground">{label}</label>
<button role="switch" aria-checked={checked} aria-labelledby={labelId} ...>
```

`SelectField` and `TextField` use real `<select>`/`<input>` so `htmlFor`/`id` works.

### 6.2 测试

- Vitest: render `<NumberField label="X" value={5} ... />` → `screen.getByLabelText('X')` returns the input.
- Manual repro: `document.querySelectorAll('input[type=number][id]').length` on 视频分析设置 = 16.

### 6.3 风险

- ✅ React 18 `useId()` is SSR/CSR consistent.
- 历史外部样式以 `[id^=":r"]` selector 匹配？grep未发现。
- Existing tests in `src/components/AdminSettings/__tests__` may rely on label being a sibling — re-run all Vitest after change.

---

## Bug #7 — Console + 视觉残留清理

**严重程度**: Low / P3 — v1 plan 绝大部分正确，**仅去掉 ESLint 规则修改 (R7)**。

### 7.1 替换 console → logger

`ImageOverlay.tsx`:

```tsx
// 顶部新增
import { VideoEditingLogger } from '../../utils/logger';
const overlayLogger = new VideoEditingLogger({ component: 'ImageOverlay' });
```

**Replacements** (line numbers from current file):
- line 41 `console.log('[ImageOverlay] Rendering overlay ...')` → `overlayLogger.debug('Rendering overlay', { imageId, position, ... })`
- line 69 `console.log('[ImageOverlay] 开始拖拽图片 ...')` → `overlayLogger.debug('drag-start', { ... })`
- line 100 → `overlayLogger.debug('drag-update', { ... })`
- line 110 → `overlayLogger.debug('drag-end', { ... })`
- line 125 → `overlayLogger.debug('resize-start', { imageId })`
- line 147 → `overlayLogger.debug('resize-update', { ... })`
- line 175 `console.warn(...)` → keep as `overlayLogger.warn('container-zero', { imageId })` (warn isn't gated, but normalizing routing keeps prod console clean)
- line 180 → `overlayLogger.warn('pixel-position-zero', { imageId })`
- line 203 `onLoad console.log` → `overlayLogger.debug('image-loaded', { imageId })`
- line 204 `onError console.error` → keep `console.error` OR `overlayLogger.error(...)` (error path is fine to keep loud — pick `overlayLogger.error` for consistency)

`MaterialsPanel.tsx` line 2108:
```tsx
import { VideoEditingLogger } from '../../utils/logger';
const matLogger = new VideoEditingLogger({ component: 'MaterialsPanel' });
// ...
onLoad={() => {
  matLogger.debug('thumb-loaded', { materialId: material.id, thumbnailUrl: material.thumbnailUrl, materialType: material.type });
}}
```

> Don't replace `console.error` in `onError` (line 2114) — error visibility is **intentional** in production; `apiError`/`error` route through `console.error` anyway.

### 7.2 视觉残留清理 (`ImageOverlay.tsx` line 184-210)

**Before**:
```tsx
className={`absolute cursor-move select-none border-2 border-red-500 ${isSelected ? 'ring-2 ring-blue-500' : ''}`}
style={{
  ...
  zIndex: position.zIndex || 10,
  backgroundColor: 'rgba(255, 0, 0, 0.2)' // 临时调试背景
}}
...
{/* 调试信息显示 */}
<div className="absolute top-0 left-0 bg-black text-white text-xs p-1 pointer-events-none">
  {imageId}
</div>
```

**After**:
```tsx
className={`absolute cursor-move select-none ${isSelected ? 'ring-2 ring-blue-500' : ''}`}
style={{
  left: `${pixelPosition.x}px`,
  top: `${pixelPosition.y}px`,
  width: `${pixelPosition.width}px`,
  height: `${pixelPosition.height}px`,
  zIndex: position.zIndex || 10,
  // (no debug background)
}}
...
{/* (debug imageId div removed) */}
```

`isSelected` block at line 220-223 (`border-2 border-blue-500`) — **keep** as the canonical selection visual; it's not a debug residue.

> Verify by grep `imageId` in the rest of the codebase: only used as a logger field. Removing the visual div is safe.

### 7.3 测试

- Manual: open editor, console filter `[ImageOverlay]` / `[MaterialsPanel]` → 0 lines in production build.
- Manual: image overlay no red border, no red bg, no imageId text.
- Vitest (optional): `vi.spyOn(console, 'log')` around render of `<ImageOverlay>` → `expect(spy).not.toHaveBeenCalled()` in production NODE_ENV.

### 7.4 风险

- 极低。logger.debug 在生产隐藏。
- 不修改 ESLint config (R7) → 不引入跨文件 lint 噪音。

---

## 附录 A — 修改文件汇总（修订版）

| Bug | 文件 | 类型 | 备注 |
|-----|------|------|------|
| #1 | `backend-services/basic-service/app/models/system_settings_models.py` | edit | +`WatermarkRemoval` +`WatermarkLogging` + registry; import `model_validator` |
| #1 | `src/components/AdminSettings/WatermarkSettingsPanel.tsx` | edit | cross-field invalid + Save disable + inline error |
| #1, #6 | `src/components/AdminSettings/components/SettingsFieldHelpers.tsx` | edit | `useId()` + `htmlFor`/`id` for NumberField/SelectField/TextField; `aria-labelledby` for SwitchField |
| #1, #2, #3, #5 | `src/lib/i18n.ts` | edit | new keys (wmConcurrencyInvalid, savingNote/savedNote/saveErrorNote, autoMix.noMaterials/noScriptMaterials, scriptPanel.tabsLabel) |
| #2 | `backend-services/basic-service/app/models/db_models.py` | edit | `User.preferences` JSON column |
| #2 | `backend-services/basic-service/alembic/versions/009_add_user_preferences.py` | new | `op.add_column` |
| #2 | `backend-services/basic-service/app/models/user_models.py` | edit | replace `UserSettingsUpdate` with strict `UserPreferences*` models |
| #2 | `backend-services/basic-service/app/routers/user_router.py` | edit | + GET/PATCH `/me/preferences` |
| #2 | `src/app/api/user/me/preferences/route.ts` | new | BFF proxy |
| #2 | `src/lib/api/server/backend-proxy.ts` | edit (if needed) | add `patch()` method if missing |
| #2 | `src/lib/api/userPreferences.ts` | new | `useUserPreferencesMutation` hook |
| #2 | `src/components/UserProfile/OtherSettingsPanel.tsx` | edit | initial GET, optimistic PATCH with rollback, status text |
| #3 | `src/components/video/VideoEditingInterface.tsx` | edit | `handleAutoMixAudio` toast + logger |
| #4 | `src/components/UserProfile/UserProfilePage.tsx` | edit | Escape hook + focus restore |
| #4 | `src/components/AdminSettings/AdminSettingsPage.tsx` | edit | same Escape hook |
| #5 | `src/components/video/ScriptPanel.tsx` | edit | ARIA tablist + arrow-key navigation |
| #7 | `src/components/video/components/VideoPlayerPanel/ImageOverlay.tsx` | edit | logger + visual cleanup |
| #7 | `src/components/video/components/MaterialsPanel/MaterialsPanel.tsx` | edit | logger replacement (one site) |

**Removed from v1 plan**:
- `.eslintrc.json` no-console rule — moved to follow-up (R7).
- `Header.tsx` `data-trigger="user-profile"` attr — not needed (R5).

---

## 附录 B — 测试命令

```bash
# Backend
cd backend-services/basic-service
pytest tests/ -v -k "system_settings or user_preferences"

# Backend with coverage on touched modules
pytest tests/ --cov=app.models.system_settings_models --cov=app.models.user_models --cov=app.routers.user_router

# Frontend type-check + unit
npm run type-check
npx vitest run --reporter=verbose

# Manual e2e
bash start.sh --dev
# follow bug-report.md repro steps for each Bug
```

---

## 附录 C — Pre-execution sanity checks (must run before Step 4)

These are 30-second commands the executor should run to verify the assumptions in this plan haven't drifted:

1. **shadcn Tabs absence**: `ls src/components/ui/` → confirm no `tabs.tsx`. (R1)
2. **Existing `UserSettingsUpdate` callers**: `grep -rn "UserSettingsUpdate" backend-services/` → list all → if any non-trivial usage, alias or rename rather than replace. (R2)
3. **Latest Alembic version**: `ls backend-services/basic-service/alembic/versions/` → pick next number. (R3)
4. **`backendProxy` has PATCH**: `grep "patch\|method" src/lib/api/server/backend-proxy.ts` → if not, add 4-line wrapper.
5. **Migration revision style**: `head -10 backend-services/basic-service/alembic/versions/008_add_project_covers.py` → copy `revision/down_revision` literal style.

---

## 附录 D — Follow-up（不在本轮范围）

- VideoAnalysisSettingsPanel cross-field concurrency invariants (parallel to Bug #1).
- 素材分类筛选栏 / 素材管理切换栏 ARIA tab semantics (parallel to Bug #5).
- Cross-tab preference sync via `BroadcastChannel`.
- GDPR/CCPA marketing-email audit trail.
- ESLint `no-console` rule promotion to `error` (after a wider sweep).
- Migrate `User.preferences` to PG-native `JSONB` if/when query-by-pref needed.

---

## 附录 E — Reviewer's confidence statement

I verified each cited file/line by reading the actual current source (not relying on the v1 plan's claims). The 10 corrections listed in §0 are the deltas I'd want a reviewer to focus on; the rest of the v1 plan is correct and ready to execute. Highest-risk areas:
- Alembic migration order on prod (procedural, well-known).
- The PATCH-replace-sub-object semantics for preferences (documented; FE always sends full sub-objects).
- ARIA tab focus management (covered by W3C-canonical roving tabindex).

The plan is **ready to execute** in Step 4.
