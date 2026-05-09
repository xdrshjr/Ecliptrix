# Fix Plan — iter6 (2026-05-09)

> **Source bug report**: `docs/diagnoses/web-bug-report-20260509-iter6/bug-report.md`
> **Scope**: 7 bugs (2× P1, 4× P2, 1× P3)
> **Goal**: per-bug root cause + concrete code-level fix strategy + risks + tests; ordered by priority; flag inter-bug dependencies and shared abstractions.

---

## 0. 总体策略与依赖关系

### 0.1 共享抽象 / 跨 Bug 复用点

| 抽象 | 涉及 Bug | 说明 |
|------|----------|------|
| 后端 `system_settings_models.CATEGORY_KEY_VALIDATORS` 注册表 | #1（与 iter2 #3 同模式） | 已有的 Pydantic 校验框架。本次扩展 `watermark/removal` 子键，复用 `validate_setting_payload()` 钩子（已挂载在 `system_settings_router.py` PUT 单值/批量两条路径）。 |
| 前端 `SettingsFieldHelpers.NumberField` | #1, #6 | 现有 `useId()` 已生成 `hintId`，但 label 与 input 缺少 `htmlFor` ↔ `id` 关联。一次组件级修补可覆盖全部 16 个匿名 spinbutton（Bug #6）并顺势支持 Bug #1 的 inline error 文案。 |
| 前端 `VideoEditingLogger`（`src/components/video/utils/logger.ts`） | #7 | iter4 已引入按 `NODE_ENV` gating 的 logger。本次任务仅是把 `ImageOverlay` / `MaterialsPanel` 残留 `console.log` 切换到该 logger（与 iter4 修复保持一致）。 |
| Radix UI `Dialog` 或自实现 Escape/focus-trap hook | #4 | `UserProfilePage` 当前是 inline panel（`src/app/page.tsx` line 117 直接渲染，非 modal），所以"加 Radix Dialog"在此场景下侵入性较高；fix 优先采用最小化 hook（`useEscapeToClose`） + 焦点回退而不是整体重写。 |
| 用户偏好持久化层 | #2 | 新增 `User.preferences JSONB` 列 + `PATCH /user/me/preferences` + 前端 `useUserPreferencesMutation`。是本轮工作量最大的修复。 |
| shadcn `Tabs/TabsList/TabsTrigger` | #5 | 项目已使用 shadcn/ui，无需新依赖；`ScriptPanel.tsx` 直接替换裸 `<button>` 即可。 |

### 0.2 优先级 / 推荐合入顺序

| 顺序 | Bug | 理由 |
|-----|-----|-----|
| 1 | #1 (Watermark cross-field) | 最小变更、立即修补数据完整性漏洞、与 iter2 同根因可一并补充注册表 |
| 2 | #6 (NumberField label) | `NumberField` 单组件改造；为 #1 的 inline error 铺路 |
| 3 | #4 (Escape close) | 体积小、纯前端、a11y 收益明显 |
| 4 | #5 (Tab semantics) | 体积中、纯前端 a11y |
| 5 | #3 (Auto-remix empty toast) | 体积小，需要确认 `handleAutoMixAudio` 现有筛选语义不被破坏 |
| 6 | #7 (Console noise) | 可与 #4/#5 同次提交，机械替换 |
| 7 | #2 (Preferences persistence) | 唯一一个跨 schema 改动（DB 列 + Alembic + router），独立 commit 利于回滚 |

### 0.3 全局风险

- **数据库迁移**（Bug #2）：本仓库使用 Alembic，但 `database.py` 启动时也会 auto-create 表 —— 新增 JSONB 列必须 **同时** 提供 Alembic migration（生产路径）和 ORM 默认值（开发路径），否则 `INSERT` 会失败。
- **生产环境调试残留**（Bug #7）：本轮发现 `ImageOverlay` 不仅有日志噪音，连**红色边框/红色半透明背景/imageId 调试字符**都还在生产渲染。修复时需要一并清理这些视觉残留。
- **i18n**（Bug #1/#3）：所有用户可见文案（toast、inline error、tooltip）必须挂在 `src/lib/i18n.ts` 的现有 key 树（`adminSettings.*`, `videoEditing.*`），禁止硬编码。
- **测试基线**：`pytest tests/` 与 `npm run type-check` 必须保持绿色；新增测试至少覆盖：(a) Bug #1 后端 422、(b) Bug #2 `PATCH /user/me/preferences` 200 + Pydantic 校验、(c) Bug #4 keydown('Escape') 触发 onClose。

---

## Bug #1 — 「水印移除设置」缺跨字段校验（concurrent_threads > max_concurrent_threads）

**严重程度**: High / P1
**与 iter2 Bug #3 同模式**：已有 `CATEGORY_KEY_VALIDATORS` 注册表，仅需新增 `watermark.removal` 项。

### 1.1 代码位置

| 层 | 文件 | 行 / 符号 |
|----|------|----------|
| 前端 UI | `src/components/AdminSettings/WatermarkSettingsPanel.tsx` | line 49 解构 `removal`；line 71-74 渲染 4 个 NumberField；line 63-66 Save 按钮 `disabled={!isDirty || saving}` |
| 前端 Save hook | `src/components/AdminSettings/components/useSettingsPanel.ts` | `saveSettings()` 调用后端 |
| 前端 Field 组件 | `src/components/AdminSettings/components/SettingsFieldHelpers.tsx` | `NumberField` 组件，line 9-73；当前 `invalid` 仅检查 min/max，无跨字段 |
| 后端模型 | `backend-services/basic-service/app/models/system_settings_models.py` | `CATEGORY_KEY_VALIDATORS` line 118-126；缺 `watermark` 项 |
| 后端路由 | `backend-services/basic-service/app/routers/system_settings_router.py` | `validate_setting_payload()` 已在 line 195/243 调用，新增 validator 即可生效 |

### 1.2 根因

1. **前端**：`WatermarkSettingsPanel` 的 Save 按钮只校验 `isDirty`，对单字段使用 `NumberField` 的 min/max clamp，对**字段间逻辑约束**（`concurrent_threads ≤ max_concurrent_threads`）完全没有断言。
2. **后端**：`CATEGORY_KEY_VALIDATORS` 只挂了 `tts.*` 子树（iter2 修复 Bug #3 时引入），**`watermark` 整个分类未注册任何 Pydantic 模型** —— 所以 `validate_setting_payload('watermark', 'removal', {...})` 直接 fall-through 通过。

### 1.3 修复策略

#### A. 后端：新增 `WatermarkRemoval` 模型并挂入注册表

文件 `backend-services/basic-service/app/models/system_settings_models.py`：

```python
from pydantic import model_validator

class WatermarkRemoval(BaseModel):
    """Concurrency / batching for watermark removal worker pool.

    Cross-field invariant: concurrent_threads must not exceed max_concurrent_threads,
    otherwise the scheduler could request more threads than the pool ceiling.
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


# Registry: append watermark mapping
CATEGORY_KEY_VALIDATORS: Dict[str, Dict[str, type[BaseModel]]] = {
    'tts': { ... unchanged ... },
    'watermark': {
        'removal': WatermarkRemoval,
        'logging': WatermarkLogging,
    },
}
```

后端无需改 router 代码（`validate_setting_payload` 钩子在 PUT 单值/批量两个路径已统一调用）。

#### B. 前端：组件级跨字段校验 + Save 禁用 + inline error

文件 `src/components/AdminSettings/WatermarkSettingsPanel.tsx`：

```tsx
const removal = getObj('removal', { ... });
const concurrencyInvalid =
  (removal.concurrent_threads as number) >
  (removal.max_concurrent_threads as number);

// 顶部 toolbar 按钮
<button
  onClick={handleSave}
  disabled={!isDirty || saving || concurrencyInvalid}
  aria-disabled={concurrencyInvalid}
  ...
/>

// SettingsSectionCard 下方新增 inline error region
{concurrencyInvalid && (
  <p role="alert" className="text-xs text-destructive">
    {t.adminSettings.wmConcurrencyInvalid}
    {/* "并发线程数不能超过最大并发线程数" / "Concurrent threads cannot exceed max concurrent threads" */}
  </p>
)}
```

i18n 在 `src/lib/i18n.ts` 的 `adminSettings` 命名空间新增 key `wmConcurrencyInvalid`（中英双语）。

#### C. 同模式排查

`VideoAnalysisSettingsPanel.tsx` 中可能存在的并发字段对（队列 max_concurrent vs VLM 并发）按相同方式补 validator —— **本 fix-plan 不强制本轮完成，仅记录为 follow-up**，避免修复范围爆炸。

### 1.4 测试建议

- **后端单元**: 新增 `tests/test_system_settings_validation.py::test_watermark_concurrent_exceeds_max` —— PUT `concurrent_threads=15, max=5` → 422，且 detail.errors 中包含 `concurrent_threads cannot exceed max_concurrent_threads`。
- **前端 Vitest**: `WatermarkSettingsPanel.test.tsx` —— render → 修改 NumberField → assert Save 按钮 `disabled` 且出现 `role="alert"` 错误文案。
- **手动回归**: 复现 bug-report 步骤 1-6，期望 Save 灰、不发请求；将 max 调到 ≥15 后 Save 重新可用。

### 1.5 风险

- 既有数据库中可能已经有违反约束的记录（iter6 即写入了一条 15/5）。Alembic 不需要回填，但**第一次启动加载 watermark 设置时的 Pydantic 反序列化不要走 `WatermarkRemoval`**（`get` 路径不调用 `validate_setting_payload`）—— 已确认 router 仅在 PUT 时调用，所以读取脏数据不会 502。
- 前端的 `isDirty` 在 `concurrencyInvalid` 修复后可能让用户陷入"无法保存也无法 reset"的尴尬 —— `ResetDefaultsButton` 已经在工具栏，符合预期，无需额外按钮。

---

## Bug #2 — 「其他设置」偏好未上行后端

**严重程度**: High / P1
**最大体积修复**：DB 列 + Alembic + router + 前端 hook + 文案绑定

### 2.1 代码位置

| 层 | 文件 | 关键行 |
|----|------|-------|
| 前端 | `src/components/UserProfile/OtherSettingsPanel.tsx` | line 73 `handleToggle`、line 87 `handleLanguageChange`、line 95 `handleThemeChange`、line 268-272 自动保存文案 |
| 前端 contexts | `src/contexts/LocaleContext.tsx`、theme bootstrap inline script in `src/app/layout.tsx` | 当前仅本地 |
| 后端模型 | `backend-services/basic-service/app/models/db_models.py` | `User` 类 line 15-36，**无 preferences 列** |
| 后端路由 | `backend-services/basic-service/app/routers/user_router.py` | 现有 `PUT /user/profile/{id}` 仅写入 admin 维度的字段；**无 self-service preferences 端点** |
| Alembic | `backend-services/basic-service/alembic/versions/` | 需新增迁移 |

### 2.2 根因

`OtherSettingsPanel` 全部 setter 仅写 `localStorage`（line 81 `STORAGE_KEY_TOGGLES`、`applyTheme()` 写 `STORAGE_KEY_THEME_PREF`、`setLocale()` 也只是 `LocaleContext` 内置 localStorage 持久化），**从未发起任何 fetch**。底部 i18n key `t.profile.autoSaveNote` 文案"更改会自动保存"语义错误：实际是"本设备保存"。

### 2.3 修复策略

#### A. 后端 schema 扩展

1. `User` 模型新增列：
   ```python
   preferences = Column(JSON, nullable=False, server_default='{}')
   ```
2. Alembic 新增 migration（命名约定 `XXXX_add_user_preferences.py`）：
   ```python
   def upgrade():
       op.add_column('users', sa.Column('preferences', sa.JSON(), nullable=False, server_default=sa.text("'{}'")))
   def downgrade():
       op.drop_column('users', 'preferences')
   ```
3. 新增 Pydantic 模型 `app/models/user_models.py`：
   ```python
   class UserPreferences(BaseModel):
       notifications: NotificationPrefs = Field(default_factory=NotificationPrefs)
       privacy: PrivacyPrefs = Field(default_factory=PrivacyPrefs)
       language: Literal['en', 'zh-CN'] = 'zh-CN'
       theme: Literal['light', 'dark', 'auto'] = 'dark'

   class NotificationPrefs(BaseModel):
       email: bool = True
       push: bool = False
       marketing: bool = False

   class PrivacyPrefs(BaseModel):
       profile_visible: bool = True
       activity_visible: bool = False
   ```

#### B. 后端 router 新端点

文件 `app/routers/user_router.py`：

```python
@router.get("/me/preferences", response_model=UserPreferencesResponse)
async def get_my_preferences(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    return UserPreferencesResponse(
        success=True,
        preferences=UserPreferences.model_validate(current_user.preferences or {}),
    )

@router.patch("/me/preferences", response_model=UserPreferencesResponse)
async def update_my_preferences(
    payload: UserPreferencesUpdate,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db_session),
):
    merged = {**(current_user.preferences or {}), **payload.model_dump(exclude_unset=True)}
    UserPreferences.model_validate(merged)  # raises 422 on invalid
    current_user.preferences = merged
    await db.commit()
    return UserPreferencesResponse(success=True, preferences=UserPreferences.model_validate(merged))
```

注意：使用 PATCH + `exclude_unset=True` 支持局部更新（前端某次只切了 push notification 不应擦掉其他字段）。

#### C. 前端 BFF 代理

新增 `src/app/api/user/me/preferences/route.ts`，遵循"Backend proxy"模式（CLAUDE.md），转发到 `${BACKEND_URL}/user/me/preferences`，使用现有 `Authorization: Bearer <session>` 透传。

#### D. 前端 hook

新增 `src/lib/api/userPreferences.ts`（debounce 300ms 的 mutation）：

```ts
export function useUserPreferencesMutation() {
  const queue = useRef<Partial<UserPreferences>>({});
  const timer = useRef<number | null>(null);
  const [status, setStatus] = useState<'idle'|'saving'|'saved'|'error'>('idle');

  const flush = useCallback(async () => {
    timer.current = null;
    if (Object.keys(queue.current).length === 0) return;
    setStatus('saving');
    const body = JSON.stringify(queue.current);
    queue.current = {};
    try {
      const r = await fetch('/api/user/me/preferences', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body });
      if (!r.ok) throw new Error(String(r.status));
      setStatus('saved');
      window.setTimeout(() => setStatus('idle'), 2000);
    } catch {
      setStatus('error');
      // TODO: rollback caller-managed local state via callback
    }
  }, []);

  const patch = useCallback((delta: Partial<UserPreferences>) => {
    queue.current = { ...queue.current, ...delta };
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 300);
  }, [flush]);

  return { patch, status };
}
```

#### E. 前端组件接线

`OtherSettingsPanel.tsx`：

- 初始化 settings 时改成 `useEffect → fetch GET /api/user/me/preferences`，把 server 数据作为 SoT；本地 localStorage 仅作为离线快照（首次渲染回退）。
- `handleToggle/handleLanguageChange/handleThemeChange` 中调用 `patch({ ... })`，仍保留 localStorage 写入用于即时镜像（避免 PATCH 失败时整个 UI 闪回）。
- 底部文案改为受 `status` 驱动：
  ```tsx
  <p>{status === 'saving' ? t.profile.savingNote
        : status === 'saved' ? t.profile.savedNote
        : status === 'error' ? t.profile.saveErrorNote
        : t.profile.autoSaveNote}</p>
  ```
- 错误时显示 toast 并把 toggle 状态回滚（`patch` 接受 `onError` 回调）。

#### F. 与 LocaleContext / 主题脚本的衔接

- `LocaleContext.setLocale` 现有 localStorage 持久化保留；但**首次加载时**应优先读取来自后端的 preferences.language（如果 user 已登录）覆盖 localStorage。
- 主题 inline 脚本（layout.tsx）读 `ecliptrix-theme` —— 不变；登录后 PATCH 主题成功时**额外**写入 `ecliptrix-theme-pref` 与 `ecliptrix-theme`，保证刷新无闪烁。

### 2.4 测试建议

- **后端**：`tests/test_user_preferences.py`：(1) 新用户 GET 返回默认 prefs；(2) PATCH `marketing=true` 持久化；(3) PATCH 非法 enum → 422；(4) 未认证 → 401。
- **前端 Vitest**：`OtherSettingsPanel.test.tsx`：(1) toggle 点击后 mock fetch 收到 PATCH；(2) PATCH 失败时显示错误文案；(3) saved 文案在 2s 后回到 idle。
- **手动**：复现 bug-report 步骤 1-6，期望 Network 看到 `PATCH /api/user/me/preferences`；切换浏览器后偏好仍正确加载。

### 2.5 风险

- **数据库迁移在生产环境**（Singapore-01 / 47.245.126.128）需要先 `alembic upgrade head` 再热部署 backend；CLAUDE.md 已说明这是 PostgreSQL 13+。tarball 部署 footgun（memory）：注意 `.env` 不会被 migration 影响，但**先升级 backend 后**前端调用 PATCH 才不会 404。
- **现有 `localStorage` toggle 数据迁移**：用户已有的本地状态不会自动上行。可选轻量策略——首次 GET 拉到默认 preferences 后，若本地有 `ecliptrix-other-settings` 则一次性 PATCH 上去再清掉本地。**建议本轮先不做迁移**，告诉用户"重置为默认"。
- **GDPR / CCPA**：marketing emails 字段需要审计 trail。本期作为 follow-up 记录，不阻塞修复合并。

---

## Bug #3 — 「自动混剪」无视频素材时按钮静默无反馈

**严重程度**: Medium / P2

### 3.1 代码位置

`src/components/video/VideoEditingInterface.tsx`：
- `handleAutoMixAudio` line 1853-1977
- 关键 silent-return：line 1898-1917（`scriptAudioMaterials.length === 0 && scriptVideoMaterials.length === 0` → `console.warn` 后 `return`）
- 对照组：`handleAIMixedEditing` line 1980-1991（已 `showError(...)` ）

### 3.2 根因

判定条件过严（要求素材带 `metadata.segment_id` 与 `segment_number` 才算"脚本素材"），但**只把"无脚本素材"作为日志，没有任何 user-facing 反馈**。用户看到的现象（"完全无反应"）来自 `return;` 后没有 toast。同时 footer 上的"AI 混剪"已经能弹出对话框 → UX 不一致。

### 3.3 修复策略

仅前端，零后端：

```tsx
const handleAutoMixAudio = useCallback(() => {
  // 1) 先检查是否完全无素材
  if (materialManagement.allMaterials.length === 0) {
    showError(t.videoEditing.autoMix.noMaterials, 5000);
    return;
  }
  // 2) ... 现有 scriptAudioMaterials / scriptVideoMaterials 筛选保持不变 ...

  if (scriptAudioMaterials.length === 0 && scriptVideoMaterials.length === 0) {
    // 3) 把 console.warn 改成 user-facing toast，并保留诊断 log（用 logger.debug）
    showError(t.videoEditing.autoMix.noScriptMaterials, 6000);
    logger.debug('AutoMix-NoScriptMaterials', { ... troubleshooting payload ... });
    return;
  }
  // ... 其余不变 ...
}, [taskId, materialManagement.allMaterials, showError, t]);
```

i18n 新增 key `videoEditing.autoMix.noMaterials` / `noScriptMaterials`，分别文案：
- 无素材："请先添加视频/音频/图片素材"/"Add video/audio/image materials first"
- 无脚本素材："自动混剪需要由文本脚本生成的音频和视频素材，请先在文本脚本面板完成 TTS 与 AI 视频匹配"/"Auto-mix requires audio + video generated from the text-script panel — run TTS and AI video matching first"

### 3.4 测试 / 风险

- 单测：mock `materialManagement.allMaterials = []` → click → assert `showError` called。
- 风险：新增的 toast 不要在 timeline 已经成功添加素材后**再次**触发。当前 `return;` 在筛选后立刻发生，新增 toast 同位置即可，不会越界。

---

## Bug #4 — 「用户资料」对话框 Escape 无效

**严重程度**: Medium / P2

### 4.1 代码位置

- `src/app/page.tsx` line 115-123：`UserProfilePage` 直接 inline 渲染，**不是** Radix `<Dialog>`。
- `src/components/UserProfile/UserProfilePage.tsx`：root `<div className="h-full w-full bg-background flex overflow-hidden">`，无 keydown 监听。
- `src/components/UserProfile/UserProfileSidebar.tsx`：仅暴露 X 按钮触发 `onClose`。

### 4.2 根因

UserProfilePage 不是真正的 modal —— 在主布局中替换 `Container` 区块。所以"无 Escape"是**本就不存在键盘退出能力**。

### 4.3 修复策略

最小侵入：在 `UserProfilePage` 内挂 `useEffect` 监听 keydown，触发 `onClose`，并把焦点还给打开它的元素（`Header` 内的头像按钮）：

```tsx
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [onClose]);
```

**焦点回退**：`Header.tsx` 头像触发按钮加 `data-trigger="user-profile"`；`UserProfilePage` 的 `useEffect` cleanup 中 `document.querySelector('[data-trigger="user-profile"]')?.focus()`。

`AdminSettingsPage`（同样是 inline-rendered）应一并加同样的 hook（防止下次再被报告）。

**关于 focus-trap**：因为页面是占位模式而非真正 modal，焦点循环没有标准期望。但可加 `aria-modal` 作为意图声明：
```tsx
<div role="dialog" aria-modal="true" aria-label={t.profile.title}>
```

### 4.4 测试

- Vitest：`fireEvent.keyDown(window, { key: 'Escape' })` → assert `onClose` called。
- Manual：复现 bug-report 步骤 1-3，期望对话框关闭。

### 4.5 风险

- 多个 inline-modal 同时打开时（理论上不应发生，因为 page-level 已经互斥）—— 只会有一个 `onClose` 触发；无冲突。
- 注意不要监听到 input/textarea 内的 Escape（用户可能想取消 IME 编辑）。可加 `if (e.target instanceof HTMLElement && ['INPUT','TEXTAREA'].includes(e.target.tagName) && e.target.dataset.escapeHandled !== 'true') return;`，但对当前 page 内主要是 sidebar + form 切换，**简单方案先无此防护**，回归测试后视体验决定。

---

## Bug #5 — 脚本类型分段标签缺 tab 语义

**严重程度**: Medium / P2

### 5.1 代码位置

`src/components/video/ScriptPanel.tsx` line 1903-1928：`activeTab` 在 line 125 定义为 `'narration' | 'aiVideo' | 'storyboard'`；3 个裸 `<button>` 切换。

### 5.2 根因

实现是裸 button + className 切换，没有 ARIA 语义；屏幕阅读器无法报告"当前 tab"，方向键无效。

### 5.3 修复策略

**方案 A（推荐）**：使用 shadcn `Tabs` 组件（已在仓库）。

```tsx
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';

<Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as typeof activeTab)}>
  <TabsList className="mt-3">
    <TabsTrigger value="narration">{t.scriptPanel.tabs.narrationScript}</TabsTrigger>
    <TabsTrigger value="aiVideo">{t.scriptPanel.tabs.aiVideoScript}</TabsTrigger>
    <TabsTrigger value="storyboard">{t.scriptPanel.actions.aiStoryboard}</TabsTrigger>
  </TabsList>
  {/* 把 line 1932 起的 conditional content 改成三个 TabsContent，保持同样的 children */}
</Tabs>
```

**方案 B（较保守，不变结构）**：仅在裸 button 上加 ARIA：
```tsx
<div role="tablist" aria-label={t.scriptPanel.tabsLabel} className="...">
  <button role="tab" aria-selected={activeTab === 'narration'} aria-controls="panel-narration" id="tab-narration"
    tabIndex={activeTab === 'narration' ? 0 : -1}
    onKeyDown={(e) => { if (e.key === 'ArrowRight') ...; }}
    onClick={() => setActiveTab('narration')}>...</button>
  ...
</div>
<div id="panel-narration" role="tabpanel" aria-labelledby="tab-narration" hidden={activeTab !== 'narration'}>...</div>
```

**推荐方案 A**：变更面积更小，且自动获得键盘导航与 focus 管理。已有 shadcn `Tabs` 在 `src/components/ui/`（验证：项目使用 shadcn new-york 风格）。

**同模式排查（follow-up）**：bug-report 提到「素材分类筛选区」「素材管理 / 视频处理切换」也有同问题。本轮只改 `ScriptPanel`，其他在跟进任务记录。

### 5.4 测试

- Vitest with `@testing-library/react`：
  - 渲染 → 找到 `getByRole('tablist')`；
  - 找到 3 个 `getByRole('tab')`；
  - `tab.click()` 后 assert `aria-selected="true"`；
  - `fireEvent.keyDown(tab, { key: 'ArrowRight' })` → 下一个 tab 获得焦点。
- Manual：用 NVDA / VoiceOver 切换 tab，期待报"标签 1 / 共 3"。

### 5.5 风险

- shadcn `TabsContent` 默认会在切换时卸载 children → 若 `narration / aiVideo / storyboard` 内部依赖 useEffect 持久状态（如分镜生成进度），**改造时需要校验或加 `forceMount`**。检查现有内容：当前条件渲染（`activeTab === 'storyboard' ? <StoryboardScriptTab /> : ...`）也是按需渲染，所以语义等价。

---

## Bug #6 — 「视频分析设置」16 个 number input 缺 label 关联

**严重程度**: Medium / P2

### 6.1 代码位置

`src/components/AdminSettings/components/SettingsFieldHelpers.tsx` `NumberField` 组件（line 9-73）：
- line 17 已经 `useId()` 但仅用于 `hintId`。
- line 48 `<label>` 与 line 53-69 `<input>` 之间无 `htmlFor` ↔ `id` 关联。

### 6.2 根因

组件实现遗漏 `htmlFor`/`id`。所有面板（`VideoAnalysisSettingsPanel`、`WatermarkSettingsPanel`、TTS 等）都用这个组件，**一处修复全局生效**（覆盖 bug-report 中 16 个 + 其他面板若干）。

### 6.3 修复策略

```tsx
export const NumberField: React.FC<{ ... }> = ({ label, value, onChange, min, max, step = 1 }) => {
  const inputId = useId();    // ← 新增
  const hintId = useId();
  ...
  return (
    <div className="flex items-center justify-between gap-2">
      <label htmlFor={inputId} className="text-sm text-foreground">{label}</label>
      <div className="flex items-center gap-2">
        {hint && <span id={hintId} className="text-xs text-amber-500">{hint}</span>}
        <input
          id={inputId}                                {/* ← 新增 */}
          type="number"
          ...
        />
      </div>
    </div>
  );
};
```

`SwitchField` / `SelectField` / `TextField` 同步处理，作为防御性改进（虽然未列在 bug-report 中）。

### 6.4 测试

- 单测 SettingsFieldHelpers：渲染 → `getByLabelText(label)` 应能找到 input（这是 RTL 推荐的语义查询）。
- 手动验证：bug-report 复现脚本 `document.querySelectorAll('input[type=number][id]').length` 应等于 16 而非 0。

### 6.5 风险

- 历史外部样式可能用 `[id^=":r"]` selector？项目 grep 无；安全。
- 小心 SSR/CSR mismatch：React 18 `useId()` 跨端一致，OK。

---

## Bug #7 — `ImageOverlay` / `MaterialsPanel` console 噪音 + 残留调试视觉

**严重程度**: Low / P3（机械替换）

### 7.1 代码位置

| 文件 | 关键行 |
|------|-------|
| `src/components/video/components/VideoPlayerPanel/ImageOverlay.tsx` | 7 处 `console.log` (line 41, 69, 100, 110, 125, 147, 203)；1 处 `console.warn` (175, 180)；**红色边框 / 红色半透明背景 / imageId 调试字符叠加** (line 187-194, 207-210) |
| `src/components/video/components/MaterialsPanel/MaterialsPanel.tsx` | line 2108 缩略图加载成功 console.log |
| 既有 logger | `src/components/video/utils/logger.ts` `VideoEditingLogger` |

### 7.2 根因

iter4 修复 #7 时遗漏了 `ImageOverlay` 和 `MaterialsPanel` 这两个组件；同时 `ImageOverlay` 的开发期临时调试视觉也未清理（`border-2 border-red-500`、`backgroundColor: 'rgba(255,0,0,0.2)'`、`<div ...>{imageId}</div>` 在生产渲染）。

### 7.3 修复策略

#### A. 替换 console 为 logger.debug

```tsx
// 顶部
import { VideoEditingLogger } from '../../utils/logger';
const logger = new VideoEditingLogger({ component: 'ImageOverlay' });

// 全部 console.log(`[ImageOverlay] xxx`, payload) 替换为
logger.debug('xxx', payload);
// console.warn 保留（warn 不被 gate）
// console.error 保留
```

`MaterialsPanel`：同样替换 line 2108。

#### B. 清理调试视觉

`ImageOverlay.tsx` line 184-194：
```tsx
// 删除 border-2 border-red-500
className={`absolute cursor-move select-none ${isSelected ? 'ring-2 ring-blue-500' : ''}`}
// 删除 backgroundColor: 'rgba(255, 0, 0, 0.2)'
style={{
  left: `${pixelPosition.x}px`,
  top: `${pixelPosition.y}px`,
  width: `${pixelPosition.width}px`,
  height: `${pixelPosition.height}px`,
  zIndex: position.zIndex || 10,
}}
```

line 207-210（imageId 调试覆盖）：直接删除。

line 220-223（重复的选中蓝框）：保留作为选中态视觉。

#### C. 防御：ESLint

`.eslintrc.json` 增加：
```json
"no-console": ["warn", { "allow": ["warn", "error"] }]
```
（仅 warn，不阻断生产构建；让 reviewer 能看到回归）。

### 7.4 测试

- Manual：编辑视图打开含图片素材的项目；打开 DevTools Console；预期 `[ImageOverlay]` 行数 0。
- Manual：图片渲染区域无红色边框/红色背景/imageId 文字。
- 单测（可选）：`vi.spyOn(console, 'log')` → render → expect not called。

### 7.5 风险

- 极低。logger.debug 完全隐藏在生产，开发期保留诊断能力。
- 删除 imageId 调试覆盖后**确认**无业务依赖（grep `imageId`：仅传递到 logger）。

---

## 附录 A — 修改文件汇总

| Bug | 文件 | 类型 |
|-----|------|------|
| #1 | `backend-services/basic-service/app/models/system_settings_models.py` | 编辑 |
| #1 | `src/components/AdminSettings/WatermarkSettingsPanel.tsx` | 编辑 |
| #1, #6 | `src/components/AdminSettings/components/SettingsFieldHelpers.tsx` | 编辑 |
| #1, #2, #3 | `src/lib/i18n.ts` | 编辑（新增 i18n key） |
| #2 | `backend-services/basic-service/app/models/db_models.py` | 编辑（+preferences 列） |
| #2 | `backend-services/basic-service/alembic/versions/XXXX_add_user_preferences.py` | 新增 |
| #2 | `backend-services/basic-service/app/models/user_models.py` | 编辑（UserPreferences） |
| #2 | `backend-services/basic-service/app/routers/user_router.py` | 编辑（+/me/preferences） |
| #2 | `src/app/api/user/me/preferences/route.ts` | 新增（BFF proxy） |
| #2 | `src/lib/api/userPreferences.ts` | 新增（hook） |
| #2 | `src/components/UserProfile/OtherSettingsPanel.tsx` | 编辑 |
| #3 | `src/components/video/VideoEditingInterface.tsx` | 编辑（handleAutoMixAudio） |
| #4 | `src/components/UserProfile/UserProfilePage.tsx` | 编辑（Escape hook） |
| #4 | `src/components/AdminSettings/AdminSettingsPage.tsx` | 编辑（同上 hook） |
| #4 | `src/components/Header.tsx` | 编辑（data-trigger） |
| #5 | `src/components/video/ScriptPanel.tsx` | 编辑（替换为 shadcn Tabs） |
| #7 | `src/components/video/components/VideoPlayerPanel/ImageOverlay.tsx` | 编辑（logger + 视觉清理） |
| #7 | `src/components/video/components/MaterialsPanel/MaterialsPanel.tsx` | 编辑（logger） |
| #7 | `.eslintrc.json` 或 `eslint.config.*` | 编辑（no-console） |

## 附录 B — 测试命令

```bash
# 后端
cd backend-services/basic-service && pytest tests/ -v -k "system_settings or user_preferences"
# 前端类型 + 单元
npm run type-check
npx vitest run --reporter=verbose
# 手动 e2e（dev server）
bash start.sh --dev
# 然后按 bug-report 各 Bug 的复现步骤逐项验证
```

## 附录 C — Follow-up（不在本轮范围）

- VideoAnalysisSettingsPanel 内同模式跨字段并发约束（队列 max vs VLM 并发）。
- 素材分类筛选栏 / 素材管理切换栏的 ARIA tab 语义（同 Bug #5 类型）。
- 用户偏好的 GDPR 审计 trail 表（与 Bug #2 关联，独立 PR）。
- 全局 `no-console` 升级为 `error`（在所有现存噪音清理后）。
