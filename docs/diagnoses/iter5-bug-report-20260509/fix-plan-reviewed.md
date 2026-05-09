# Bug 修复方案（已审查 / 修订版）— Iter5 / Step 3

**配套文档**: `bug-report.md`、`fix-plan.md`（同目录，原始方案）
**审查时间**: 2026-05-09
**审查者**: Iter5 Step 3（代码探索 → 检查修复方案 → 修正）
**工作目录**: `G:\projects\takoAI\Ecliptrix`
**目标**: 在原 `fix-plan.md` 基础上，对每一条修复策略进行技术正确性 / 副作用 / 完整性 / 编码规范四项审查；纠正发现的问题并补齐遗漏，使方案可直接交付下一步（Step 4）执行。

---

## 0. 审查结论一览

| Bug | 原方案诊断 | 审查后定级 | 关键修订 |
|---|---|---|---|
| #1 | TTS 幽灵音频 | **保留 Critical / P0**；新增 1 个根因（metadata 键不一致） | **必须** 同步修复 `server_file_name` ↔ `fileName` 键名错配（原方案遗漏，否则 A2 改动会让"同会话即可播放"也回退到一次 HTTP 拉取） |
| #2 | 16:9 标签混淆 | High / P1，方案接受 | 增加宽度回归注意；移除"原文案 + tooltip"备选（信息冗余） |
| #3 | 参考图重复 + a11y | High / P1，方案接受 | **更正 #3 前端单元测试的断言**（mock 返回 4 同名时不应断言只渲染 1 个 button — 后端去重策略下前端不再去重）；明确兜底（3c）作为"过渡 PR" 而非长期方案 |
| #4 | 声音选择 UX | Medium / P2，方案接受 | 4a/4b 强制做、4c 拆出后续 PR；补 `aria-controls` 与 `useId` 用法 |
| #5 | 默认 404 | Medium / P2，方案接受 | `not-found.tsx` 必须 `'use client'` 才能用 `useLocale`；补 i18n 默认兜底 |
| #6 | Profile Save 消失 | Low / P3，方案接受 | Ctrl+S 快捷键标记为 **可选** 不入本 PR；只做"常驻 disabled + noChanges 提示" |

**审查通过**：所有 6 条策略在修订后可执行，无相互冲突，可在单一 PR 完成或按"PR-1 = #1 + #6 + #2、PR-2 = #3 + #5、PR-3 = #4"分批；推荐单 PR 一次性合入以缩短窗口。

---

## 1. Bug #1（TTS 幽灵音频）— 修订要点

### 1.1 关键遗漏：metadata 键名错配（必须新增）

**审查发现**：原方案的 A1 优先级链 `本地缓存 → serverUrl → originalUrl → material.url`，依赖 `material.metadata?.fileName` 作为本地缓存的 key。但在 `src/components/video/ScriptPanel.tsx:1426`：

```ts
metadata: {
  ...
  server_file_name: fileName,        // ← 写入的是 server_file_name
  ...
}
```

而 `src/components/video/components/MaterialsPanel/MaterialsPanel.tsx:1090` 读取的是：

```ts
if (material.metadata?.fileName) { ... }   // ← 读取的是 fileName
```

→ 两端 **完全不匹配**，本地缓存查询分支现在就是死代码；TTS 段落的回放 URL 一直是 `material.url`（同会话是有效 blob，重启后是死 blob）。原方案 A2 把 `material.url` 改成 `serverUrl`，即便上线也只会让"重启回退"工作，但 **同会话同样需要走一次 HTTP 拉取**，因为本地缓存仍然进不去。

**必须的修订**（在原 A2 改动同时执行）：

修改 `ScriptPanel.tsx:1420-1435` 同时写入 `fileName`，保留 `server_file_name` 兼容历史项目：

```ts
metadata: {
  voice_type: selectedVoiceId,
  text_length: segment.sentences.reduce((sum, s) => sum + s.text.length, 0),
  segment_id: segment.id,
  segment_number: segmentNumber,
  task_id: taskId,
  fileName,                           // ← 新增：与 LocalAudioManager / MaterialsPanel 对齐
  server_file_name: fileName,         // 保留：兼容历史 workflow_data
  actual_duration: response.total_duration,
  duration_method: 'concatenated_sentences',
  originalUrl: response.concatenated_audio_url,
  ...
}
```

**对 `selectAudioPlaybackUrl` 工具函数同步修订**——读取兼容键：

```ts
// src/lib/utils/audioUrl.ts
import type { MaterialItem } from '@/types';
import localAudioManager from './localAudioManager';

const isBlobUrl = (u?: string | null): u is string =>
  typeof u === 'string' && u.startsWith('blob:');

export function selectAudioPlaybackUrl(material: MaterialItem): string | null {
  // 1) 运行时本地缓存（同会话零延迟）
  if (typeof window !== 'undefined') {
    const fileName =
      material.metadata?.fileName ??
      material.metadata?.server_file_name ??
      null;
    if (fileName) {
      const local = localAudioManager.getAudioFileUrl(fileName);
      if (local) return local;
    }
  }
  // 2) 服务端稳定路径
  if (material.serverUrl) return material.serverUrl;
  if (material.metadata?.originalUrl) return material.metadata.originalUrl as string;
  // 3) 仅当 url 不是 blob 时，作为最后兜底
  if (!isBlobUrl(material.url)) return material.url ?? null;
  return null;
}
```

> **类型注意**：`MaterialItem.metadata` 在 `src/types/index.ts` 通常被声明为 `Record<string, any>`；若为更严格的接口，需要在 type 中加入 `fileName?: string` 字段。Step 4 实施时先 `Read` 该文件确认。

### 1.2 A1（MaterialsPanel.tsx 修订）

将原方案的内联条件链替换为对 `selectAudioPlaybackUrl` 的调用，统一并避免重复实现：

```ts
// 替换 MaterialsPanel.tsx:1086-1107
const resolvedUrl = selectAudioPlaybackUrl(material);
if (!resolvedUrl) {
  showError(t.materialsPanel.audioBrokenBlob);
  return;
}
const audioUrl = resolvedUrl;
const isLocalFile = audioUrl.startsWith('blob:');
```

`audio.onerror` 内部的二次回退（1138-1161）也应改为：当首次失败且 `isLocalFile === true` 时，**先剔除 fileName** 再调 `selectAudioPlaybackUrl(materialWithoutFileName)`，这样自动跳到 serverUrl 分支。原方案的递归调用思路保留即可。

### 1.3 A2（ScriptPanel.tsx 修订）

确认原方案：把 `url: localUrl` → `url: response.concatenated_audio_url`。✅ 接受。

> 安全网：在 1.2 修订后，同会话回放仍能命中 `localAudioManager`，**不会**因为去掉了 `localUrl` 而失去零延迟。

### 1.4 A3（localAudioManager loadCacheFromStorage）

原方案"删除 localStorage 元数据持久化"是对的：blob 无法跨会话恢复，写入元数据徒增误导。**修订**：除 `loadCacheFromStorage` 改 no-op 外，`saveCacheToStorage`、`removeAudioFile` 与 `clearAllAudioFiles` 的 `saveCacheToStorage()` 调用全部保留（已是 no-op，无需删调用点，避免大面积 diff），并在文件首部加一行注释：

```ts
// NOTE: blob URLs cannot survive a Document reload, so localStorage metadata
// was removed in iter5 to avoid the "ghost material" UX (see fix-plan-reviewed.md §1).
```

### 1.5 必须同步更新的 `material.url` 调用点（补全原方案 §169-170）

下列文件读取 `material.url` 或时间轴音频 src，**审查清单中 audio 类型的消费点必须改为 `selectAudioPlaybackUrl`**；其余非 audio 类型保持原状：

| 文件 | 处理 |
|---|---|
| `src/components/video/components/MaterialsPanel/MaterialsPanel.tsx` | 1086-1107（A1）、1138-1161（onerror） — **改** |
| `src/components/video/timeline/TimelinePanel.tsx` | grep `audio` / `src=` 后筛 audio 段，**改** |
| `src/components/video/timeline/infrastructure/RemoteMaterialPrefetchAdapter.ts` | 仅做预取，URL 直传 — **如涉 audio，改** |
| `src/components/video/hooks/useVideoExport.ts` | 导出请求体（视频合成）—音频段必须传 serverUrl，不能传 blob；如读 `material.url`，**改** |
| `src/lib/api/videoComposition.ts` | 同上 |
| `src/components/video/components/MediaPreviewModal/MediaPreviewModal.tsx` | audio 预览 — **改** |
| `src/components/video/components/AudioSearchModal/AudioSearchModal.tsx` | 搜索结果通常是远程 audio，无 blob 风险；**审视** |
| `src/components/video/VideoEditingInterface.tsx` | 容器层，传递 material 引用，**审视** |

> Step 4 实施时建议运行 `Grep "material\.url" src/components/video --output_mode files_with_matches`，对照本表逐一确认；非 audio 路径无需改动，避免不必要回归。

### 1.6 数据迁移（保留原方案 C，明确选项 2）

被动迁移即可：本次 PR 上线后，所有新 TTS 段落的 `material.url` 都是 server URL；历史项目下次 PUT 自动覆盖。**不要**强制写回，避免大量 PUT 风暴。前端读时若遇 `url.startsWith('blob:')`，运行时通过 `selectAudioPlaybackUrl` 静默回退到 `serverUrl ?? originalUrl`，用户无感知。

### 1.7 风险（修订）

- **新增风险**：若 `MaterialItem.metadata` 类型严格，`fileName` 未在接口中声明会导致 TS 编译报错——Step 4 必须先 `Read` `src/types/index.ts` 验证类型，必要时同步加字段。
- **降级风险**：本修订让 TTS 段落即使在本会话也走"localCache 命中"分支，性能比原代码 **更好**（原本就走 blob URL，无 HTTP；修订后命中本地缓存，仍无 HTTP）。
- **回归点**：录音/字幕等其他通过 metadata.fileName 取值的路径（grep 命中 `useMaterialManagement.ts` 多处）不受影响——这些路径本就写入 `fileName: file.name`，与新增的 TTS 路径键名一致。

### 1.8 测试（修订）

| 层级 | 用例 | 期望 |
|---|---|---|
| Vitest | `selectAudioPlaybackUrl` × 5 case | (a) 本地命中 → blob; (b) 本地未命中 + serverUrl → serverUrl; (c) 仅 originalUrl → originalUrl; (d) 仅 dead blob url → null; (e) 仅 http url → http url |
| Vitest | `selectAudioPlaybackUrl` 兼容键 | metadata 仅有 `server_file_name`（无 `fileName`）也能命中 localAudioManager mock |
| Vitest | `localAudioManager.loadCacheFromStorage` no-op | 调用后 `audioCache.size === 0`，不抛错 |
| Playwright e2e | 跨会话回放 | reload → 点预览 → `<audio>.src` 不以 `blob:` 开头 |
| 手工 | 同会话回放零延迟 | TTS 生成完点预览，无 network request 到 `/api/audio/generated/...`（已命中 localAudioManager） |

---

## 2. Bug #2（尺寸标签）— 修订要点

原方案接受；只做以下两处**简化**：

1. 删除"加 `title={preset.value}`"备选——`<button>` 标签里已经显式包含像素，再 tooltip 重复属于信息冗余。
2. zh / en 文案统一用全角 `×`（不是 `x`），与项目里其它"宽×高"格式（如 `BasicGenerationTab` 既存按钮、`ImageSearchModal` 等）保持一致：

```ts
// zh (i18n.ts:7929-7932)
size169Landscape: '16:9 (1280×720)',
size916Portrait: '9:16 (720×1280)',
size169Wide: '16:9 (1024×576)',
size916Wide: '9:16 (576×1024)',
// 注意：size1kSquare/size2kSquare 也建议改成
size1kSquare: '1:1 (1024×1024)',
size2kSquare: '1:1 (2048×2048)',

// en (i18n.ts:5201-5206) 同结构
size1kSquare: '1:1 (1024×1024)',
size2kSquare: '1:1 (2048×2048)',
size169Landscape: '16:9 (1280×720)',
size916Portrait: '9:16 (720×1280)',
size169Wide: '16:9 (1024×576)',
size916Wide: '9:16 (576×1024)',
```

> **类型 schema (`i18n.ts:2468-2482`)**：keys 不变（仍是 `size1kSquare` 等），values 改写。无需动 TS interface。

**宽度风险确认**：`grid-cols-3 gap-2` + `py-2.5 px-2` + `text-xs font-medium`，按钮内 `<svg>` (16px) + `gap-1.5` + `<span>`。新文案 `16:9 (1280×720)` 共 13 字符。Edge 浏览器渲染下宽度宽裕；Safari 中文字体下若略紧，由 1.111 行原代码 `<span>` 加 `truncate min-w-0` 兜底（**修订**：建议本次顺手把 `<span>` 改成 `<span className="truncate min-w-0">`，零风险）。

**测试**：手工 + 视觉回归截图（zh / en、1280px / 1440px 视口各 1 张）。无需新单元测试。

---

## 3. Bug #3（参考图重复 + a11y）— 修订要点

### 3a 前端 a11y（保留原方案，**修订** i18n 命名空间）

`MaterialLibraryGrid.tsx:113-138` —— 把 `aria-label` 与 `<img alt>` 解耦：

```tsx
<button
  key={m.id}
  onClick={() => !disabled && !selected && onSelect(m)}
  disabled={disabled || selected}
  aria-label={(mp.materialLibraryReferenceLabel ?? '参考图：{name}').replace('{name}', m.name)}
  title={m.name}
  className={...}
>
  <img src={m.thumbnail_url || m.url} alt="" className="..." />
  {selected && (
    <span aria-hidden="true" className="...">✓</span>
  )}
  <span aria-hidden="true" className="...">{m.name}</span>
</button>
```

**新增 i18n key**：

```ts
// zh
materialsPanel: { ..., materialLibraryReferenceLabel: '参考图：{name}' }
// en
materialsPanel: { ..., materialLibraryReferenceLabel: 'Reference image: {name}' }
```

i18n.ts 的 `materialsPanel` 类型 schema 同步加 `materialLibraryReferenceLabel: string;`。

### 3b 后端去重（保留原方案，补加默认值与日志）

`backend-services/basic-service/app/services/storage_service.py:502-571`：

```python
async def list_user_materials(
    self,
    user_id: str,
    material_type: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    dedupe: bool = True,
) -> Dict[str, Any]:
    ...
    # 新顺序：先 sort（newest first），再 dedupe，再分页
    all_files.sort(key=lambda x: x.get("created_at", ""), reverse=True)

    if dedupe:
        seen: set[tuple[str, int]] = set()
        unique: List[Dict[str, Any]] = []
        for f in all_files:
            key = (f.get("name", ""), int(f.get("size", 0)))
            if key in seen:
                continue
            seen.add(key)
            unique.append(f)
        deduped_count = len(all_files) - len(unique)
        if deduped_count > 0:
            logger.info("User materials deduped", {
                "user_id": user_id,
                "removed": deduped_count,
                "kept": len(unique),
            })
        all_files = unique

    total = len(all_files)
    ...
```

`storage_router.py:308-313` 添加查询参数（默认 `True`，保持现网行为变化最小：去重打开）：

```python
async def get_user_materials(
    user_id: str,
    page: int = 1,
    page_size: int = 20,
    material_type: Optional[str] = None,
    dedupe: bool = True,           # ← 新增
):
    ...
    result = await storage_service.list_user_materials(
        user_id=user_id, material_type=material_type,
        page=page, page_size=page_size, dedupe=dedupe,
    )
```

> **副作用核查**：去重 key = `(name, size)`，size 来自文件 stat（已在 `_create_file_info` 计算）；同名同字节文件几乎一定是同内容（碰撞概率极低）。如果用户故意上传两个同名同 size 但内容不同的文件——边缘 case，极少；可在 release note 提一句。

### 3c 兜底前端去重（**修订为不做**）

原方案 §3c 提议在前端再做一次 `Map(name+size)` 去重作为兜底。**审查后建议删除**：

- 后端 dedupe 默认开启 → 前端不会再收到重复行；前端兜底是死代码。
- 若万一后端版本未升级（开发环境），前端看到 22 项重复也仅是 UX 退化，不会破坏功能；接受这一过渡风险。
- 前后端都做去重，会让"用户故意上传同名不同内容的素材"在前端被吞掉，无法绕过。

### 3 测试（**修订**）

| 层级 | 用例 | 期望 |
|---|---|---|
| Pytest | `tests/test_storage_service.py::test_list_user_materials_dedupes` | 在 `image/2026/05/01/user_x/task_a/foo.jpg` 与 `image/2026/05/02/user_x/task_b/foo.jpg`（同 size）下调用 → `len(materials) == 1`，且为 `2026/05/02` 的那条 |
| Pytest | `test_list_user_materials_dedupe_false` | 同 fixture，`dedupe=False` → `len(materials) == 2` |
| Vitest | `MaterialLibraryGrid` accessible name 不重复 | mock 4 个**不同 id 但同 name** 的素材 → 渲染 4 个 button（**不假设前端去重**），但每个 button 的 accessibleName === `参考图：{name}`（不再有 "name name" 重复） |
| 手工 | 上传同图 5 次 → 进入参考图 → 仅 1 项 | ✓ |

> **原方案错误**：原 §3 测试把"renders 4 同名 → getAllByRole('button').length === 1"作为前端单元断言，但前端**不去重**（后端策略），mock 数据里塞 4 条会渲染 4 个 button。修正为只校验 a11y 命名。

### 3 风险（保留 + 补充）

- 已述：(name, size) 误判极低概率。
- 新增：`int(f.get("size", 0))` 在 `_create_file_info` 抛异常时 size 缺失 → 走 `0`，多个失败行会被错误并到 (name, 0)。审视 `_create_file_info` 是否始终设置 `size`。

---

## 4. Bug #4（声音选择 UX）— 修订要点

### 4a Escape & a11y（保留原方案，补 `aria-controls`）

`VoiceSelector.tsx:14-242`：

```tsx
const listboxId = React.useId();
...
useEffect(() => {
  if (!isOpen) return;
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsOpen(false); };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}, [isOpen]);

// trigger button
<button
  ...
  aria-haspopup="listbox"
  aria-expanded={isOpen}
  aria-controls={listboxId}
>...</button>

// dropdown
<div id={listboxId} role="listbox" ...>
  {sortedCategories.map(category => (
    <div key={category} role="group" aria-label={getCategoryDisplayName(category)}>
      ...
      {voicesByCategory[category].map(voice => (
        <button
          role="option"
          aria-selected={selectedVoiceId === voice.id}
          ...
        >...</button>
      ))}
    </div>
  ))}
</div>
```

> 注：原代码用 `<button>` 渲染选项，外层 listbox 内嵌 `role="option"` 在 `<button>` 上是合规的（ARIA 1.2 允许）。

### 4b 搜索 + 性别过滤（保留原方案）

接受 `searchTerm` + `genderFilter` 思路。**修订**：把过滤后的 `voicesByCategory` 计算合并进既有的 `voicesByCategory` reduce，避免重复遍历：

```ts
const filteredVoices = useMemo(() => {
  const kw = searchTerm.trim().toLowerCase();
  return voiceList.filter(v => {
    const matchKw = !kw
      || v.name.toLowerCase().includes(kw)
      || (v.description ?? '').toLowerCase().includes(kw)
      || (v.category ?? '').toLowerCase().includes(kw);
    const matchGender = genderFilter === 'all' || v.gender === genderFilter;
    return matchKw && matchGender;
  });
}, [voiceList, searchTerm, genderFilter]);

const voicesByCategory = useMemo(() =>
  filteredVoices.reduce((acc, voice) => {
    const c = voice.category || '其他';
    (acc[c] ??= []).push(voice);
    return acc;
  }, {} as Record<string, VoiceType[]>),
[filteredVoices]);
```

新增 i18n key（`scriptPanel.voiceSelector` 命名空间下）：
- `searchPlaceholder` = "搜索声音..." / "Search voices..."
- `genderAll` / `genderMale` / `genderFemale` = "全部" / "男声" / "女声" / "All" / "Male" / "Female"
- `noVoicesMatched` = "无匹配声音" / "No voices matched"

类型 schema（`i18n.ts` 中 `scriptPanel.voiceSelector` 接口）需同步加这 4 个键。

### 4c 试听（**保留原方案"独立 PR" 的判定**）

不在本 PR 范围。原因：
- 消耗 ARK / Volcano TTS 配额，需 PM 确认；
- 涉及缓存策略（key=`preview-${voiceId}`，TTL 24h CDN）— 后端协同改动较大；
- 4a + 4b 已对 UX 有 80% 改善。

### 4 测试（保留原方案，补一条）

| 层级 | 用例 |
|---|---|
| Vitest | Esc 键关闭：mount → setIsOpen(true) → fireEvent keydown Escape → expect isOpen === false |
| Vitest | 搜索过滤：mock 5 voice → input "梓辛" → 列表只剩匹配项 |
| Vitest | 性别过滤：选 "男声" → 列表全为 gender === 'male' |
| axe-core | 无 ARIA violation |
| 手工 | 长列表（118 项）滚动 + 搜索响应 < 100ms |

### 4 风险

- `useId()` 仅 React 18+；项目 React 19 ✓ 兼容。
- 全屏 `<div className="fixed inset-0 z-40">` 仍保留（点击空白关闭）。Escape 与之并存无冲突。

---

## 5. Bug #5（404 页）— 修订要点

### 5a not-found.tsx（保留原方案，**修订** Provider 上下文与 Header 决策）

新建 `src/app/not-found.tsx`：

```tsx
'use client';

import Link from 'next/link';
import { useLocale } from '@/contexts/LocaleContext';

export default function NotFound() {
  const { t } = useLocale();
  const nf = t.notFound ?? {
    title: 'Page not found',
    description: "The page you're looking for doesn't exist or has been moved.",
    goHome: 'Back to home',
    goBack: 'Go back',
  };
  return (
    <main className="min-h-full flex flex-col items-center justify-center px-6 py-24 text-center">
      <h1 className="text-5xl font-bold text-foreground">404</h1>
      <p className="mt-3 text-base text-muted-foreground">{nf.title}</p>
      <p className="mt-2 text-sm text-muted-foreground max-w-md">{nf.description}</p>
      <div className="mt-6 flex gap-3">
        <Link
          href="/"
          className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90"
        >
          {nf.goHome}
        </Link>
        <button
          type="button"
          onClick={() => { if (typeof window !== 'undefined') window.history.back(); }}
          className="px-4 py-2 rounded-md border border-border text-sm hover:bg-accent"
        >
          {nf.goBack}
        </button>
      </div>
    </main>
  );
}
```

> **关键修订点**：
> 1. `'use client'` 必须保留 — `useLocale` 是 client hook。
> 2. 必须给 `t.notFound` 兜底（默认英文对象），否则 i18n key 还没添加时本地 dev 直接崩页。
> 3. 不在 `not-found.tsx` 内部引入 `<AppHeader />`（原方案 5b）—— 现有 Header 渲染只在已登录的视频编辑等界面里，且依赖 `useAuth()`；放进 404 会引发新副作用（重定向、布局错位）。RootLayout 已包裹 LocaleProvider，404 页能正确本地化已经达到目标。**5b 标记为不做**。

### 5b（删除）

不再渲染 Header；原因见上。

### 5c `/admin` 路由（**保留原方案"单独工单"判定**）

`/admin` 直链命中 404 是产品决策问题（admin 入口现仅在 Header 弹窗），不应在 bug 修复 PR 中新增页面。**5c 标记为不做**，开 follow-up issue。

### 5 i18n 新增

zh：
```ts
notFound: {
  title: '页面未找到',
  description: '您访问的页面不存在或已被移除。',
  goHome: '返回首页',
  goBack: '返回上一页',
}
```
en：
```ts
notFound: {
  title: 'Page not found',
  description: "The page you're looking for doesn't exist or has been moved.",
  goHome: 'Back to home',
  goBack: 'Go back',
}
```

`i18n.ts` 类型 schema 在 `Translations` 接口（约 2474 附近）顶层加：
```ts
notFound: {
  title: string;
  description: string;
  goHome: string;
  goBack: string;
};
```

### 5 测试

- Playwright: 访问 `/this-route-does-not-exist` → 断言 `<h1>404`，`role=link[name=返回首页]` 可见，切换 `localStorage` 中 locale 后文案改变。
- 视觉回归：zh / en 各一截图。

### 5 风险

- 极低。Next 15 标准用法。
- 注意：`useAuth()` 不要在 `not-found.tsx` 调用——AuthProvider 在 RootLayout 提供，能用，但不必要；保持组件最小依赖。

---

## 6. Bug #6（Profile Save）— 修订要点

### 6 主修复（保留原方案）

`UserInfoPanel.tsx:200-217` —— 去掉 `{hasChanges && ...}` 条件，常驻 + disabled：

```tsx
<div className="mt-8 flex items-center space-x-4 pt-6 border-t border-border">
  <button
    onClick={handleSave}
    disabled={!hasChanges || isLoading}
    className="px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-md hover:bg-primary/90 focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
  >
    {isLoading ? t.profile.saving : t.profile.save}
  </button>
  <button
    onClick={handleReset}
    disabled={!hasChanges || isLoading}
    className="px-4 py-2 border border-border text-foreground text-sm font-medium rounded-md hover:bg-accent focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
  >
    {t.profile.cancel}
  </button>
  {!hasChanges && (
    <span className="text-xs text-muted-foreground">{t.profile.noChanges}</span>
  )}
</div>
```

### 6 i18n 新增

```ts
// zh
profile: { ..., noChanges: '无变更' }
// en
profile: { ..., noChanges: 'No changes' }
```

`Translations.profile` 接口加 `noChanges: string;`。

### 6 Ctrl+S 快捷键（**修订为不做**）

原方案 §6 给了 Ctrl+S 实现示例。**审查决定不在本 PR 加**：
- 与浏览器原生 Ctrl+S（保存网页）冲突；
- 增加全局 keydown 监听有耦合风险（若多个对话框都监听）；
- 单选"常驻 disabled + noChanges"已解决用户感知问题，覆盖 Bug 报告 100% 抱怨点。

### 6 测试

- Vitest：mount `<UserInfoPanel />`（mock `useAuth` 返回稳定 user），断言：
  - 初始：Save 按钮在 DOM 中，`disabled === true`；旁有"无变更"文案
  - 修改 fullName 输入 → `disabled === false`，"无变更"文案消失
- 手工 QA：dark / light 主题各看一次，按钮状态切换正常。

### 6 风险

- 极低。

---

## 7. 最终回归矩阵（覆盖修订后所有点）

| 测试类型 | 用例数 | 说明 |
|---|---|---|
| Vitest 单元 | ~12 | `selectAudioPlaybackUrl` (5 case + 1 兼容键) / `localAudioManager` no-op / `MaterialLibraryGrid` a11y / `VoiceSelector` Esc + 搜索 + 性别 / `UserInfoPanel` disabled |
| Pytest 后端 | 2 | `test_list_user_materials_dedupes` / `test_..._dedupe_false` |
| Playwright e2e | 3 | 跨会话 TTS 回放 (Bug#1) / 404 页本地化 (Bug#5) / Voice picker Escape (Bug#4) |
| 手工 QA | 5 | 尺寸标签可读性 (Bug#2) / Profile pristine 按钮可见 (Bug#6) / 重复上传去重 (Bug#3) / 搜索 + 性别过滤 (Bug#4) / 跨语言截图 (Bug#5) |

---

## 8. 修订后的发布计划

**单 PR 一次性合入**（推荐）：所有 6 个 Bug + 测试 + i18n 同步上线，commit message 用 `[fix]` 前缀，例如：

```
[fix] iter5: TTS ghost audio + dedupe materials + a11y + 404 page

- Bug #1 (Critical): persist server URL for TTS audio; align metadata
  fileName key; introduce selectAudioPlaybackUrl util; drop misleading
  localStorage cache metadata.
- Bug #2: clarify image size labels with explicit pixel dimensions.
- Bug #3: backend (name,size) dedupe in list_user_materials; fix
  duplicate accessible name in MaterialLibraryGrid.
- Bug #4: voice selector escape key, search box, gender filter, ARIA.
- Bug #5: localized not-found page with home/back navigation.
- Bug #6: persistent Save/Cancel buttons with disabled state.
```

**或拆 2 PR**（若评审带宽紧）：

- **PR-1 (urgent)**: #1 + #2 + #6 + 对应 i18n key（仅前端 + 一处 metadata）
- **PR-2**: #3（前端 + 后端 + 测试） + #4 + #5

不再推荐原 fix-plan 的 3 PR 划分——#3 a11y 和 #5 404 都是纯前端一两个文件，没必要单独成 PR。

---

## 9. 与 iter4 / 既有代码兼容性核对（修订）

- iter4 step 4 修复的模块（workflow save/run gate、materials empty hint、timeline coming-soon、log hygiene）与本轮 6 个 Bug 文件零交集。
- 本轮 Bug #1 改 `material.url` 语义后，需要回归测试 **视频导出**（`useVideoExport.ts` / `videoComposition.ts`）的 audio 段——若导出 payload 仍读 `material.url`，本次改动让旧项目 (blob URL) 改回 server URL，**修复了一个隐藏 bug**（之前导出可能因 blob URL 失败，被静默错误吞掉）。Step 4 实施时务必跑一次"含 TTS 段落的项目导出"手工 case 验证。
- `LocalAudioManager` 移除 localStorage 持久化后，旧 localStorage key `ecliptrix_local_audio_cache` 会被首次启动时显式删除，零迁移负担。

---

## 10. 行动清单（Step 4 直接照做）

1. `src/types/index.ts` — 验证 / 添加 `MaterialMetadata.fileName?: string`（如类型严格）。
2. `src/lib/utils/audioUrl.ts` — **新建** `selectAudioPlaybackUrl`（§1.1）。
3. `src/lib/utils/localAudioManager.ts` — `loadCacheFromStorage` 改 no-op 并显式 `removeItem`（§1.4）。
4. `src/components/video/ScriptPanel.tsx:1405-1436` — `url: serverUrl`、metadata 加 `fileName`（§1.1, §1.3）。
5. `src/components/video/components/MaterialsPanel/MaterialsPanel.tsx:1086-1170` — 用 `selectAudioPlaybackUrl`（§1.2）。
6. 全仓 `Grep "material\.url"` 后按 §1.5 表格审视 audio 段消费点。
7. `src/lib/i18n.ts` — 修改尺寸文案 + 新增 `materialLibraryReferenceLabel` / `voiceSelector.{searchPlaceholder,genderAll,...}` / `notFound.{...}` / `profile.noChanges` / `materialsPanel.audioBrokenBlob` keys，同步 zh + en + Translations interface。
8. `src/components/video/components/AiImageModal/MaterialLibraryGrid.tsx:113-141` — a11y（§3a）。
9. `backend-services/basic-service/app/services/storage_service.py:502-571` — dedupe（§3b）。
10. `backend-services/basic-service/app/routers/storage_router.py:308-313` — `dedupe` query param（§3b）。
11. `src/components/video/components/VoiceSelector.tsx` — Escape + 搜索 + 性别 + ARIA（§4a, §4b）。
12. `src/app/not-found.tsx` — **新建**（§5a）。
13. `src/components/UserProfile/UserInfoPanel.tsx:199-218` — 常驻按钮 + noChanges（§6）。
14. 测试：新增 Vitest（前端）+ Pytest（后端）+ Playwright（e2e）。

— 文档结束 —
