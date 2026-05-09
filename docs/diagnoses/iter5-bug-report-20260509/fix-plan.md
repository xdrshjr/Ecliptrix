# Bug 修复方案 — Iter5 / Step 2

**配套 Bug 报告**: `bug-report.md`（同目录）
**生成时间**: 2026-05-09
**作者**: Iter5 Step 2（代码探索与修复方案）
**工作目录**: `G:\projects\takoAI\Ecliptrix`

本文档对 Iter5 Step 1 报告的 6 个 Bug 进行代码定位、根因分析与修复方案设计。每个 Bug 都给出具体的文件:行号、修改建议、风险与回归测试建议。

---

## 优先级与依赖关系总览

| Bug | 模块 | 严重程度 | 主要修改文件 | 依赖 |
|---|---|---|---|---|
| #1 | TTS 幽灵音频 | **Critical / P0** | `localAudioManager.ts`、`MaterialsPanel.tsx`、`ScriptPanel.tsx` | 无 |
| #2 | 16:9 尺寸标签混淆 | High / P1 | `i18n.ts`（仅文案） | 无 |
| #3 | 参考图重复 + 双 a11y 文案 | High / P1 | `MaterialLibraryGrid.tsx`、`storage_service.py` | 无 |
| #4 | 声音选择 UX | Medium / P2 | `VoiceSelector.tsx` | 无 |
| #5 | 默认 404 页 | Medium / P2 | `src/app/not-found.tsx`（新增）、`i18n.ts` | 无 |
| #6 | Profile Save 按钮消失 | Low / P3 | `UserInfoPanel.tsx` | 无 |

修复顺序建议：**Bug #1 → Bug #6 → Bug #2 → Bug #3 → Bug #5 → Bug #4**。Bug #1 是数据可信度问题（最先修），#6/#2 是单点小改动（顺手解决），#3/#5/#4 是稍大的功能/UI 工作。

所有修复彼此独立，可在同一 PR 中并行实施，不存在跨 Bug 共享状态。

---

## Bug #1 — TTS 幽灵音频素材（Critical / P0）

### 代码定位

| 角色 | 文件:行 | 关键符号 |
|---|---|---|
| Audio 缓存（仅内存 + localStorage 元数据） | `src/lib/utils/localAudioManager.ts:14-308` | `LocalAudioManager`、`storeAudioFile`、`getAudioFileUrl`、`MAX_CACHE_AGE = 24h` |
| 生成 TTS → 写入 blob URL → 注入 MaterialItem | `src/components/video/ScriptPanel.tsx:1352-1438` | `convertSentencesToSpeech` → `localAudioManager.storeAudioFile(...)` → `audioMaterial.url = localUrl` |
| 素材列表预览/播放 | `src/components/video/components/MaterialsPanel/MaterialsPanel.tsx:1086-1170` | `handleAudioPlayPause`，回退到 `material.metadata.originalUrl` 的逻辑 |
| 项目持久化 schema | `src/types/index.ts:471-515` | `VideoEditingTaskContent.materials?: MaterialItem[]` |

### 根因

1. `LocalAudioManager` 只是 **当前页面 `Map` + localStorage 元数据**——`URL.createObjectURL` 产出的 `blob:` URL 仅在当前 Document 生命周期有效，浏览器关闭即失效，但 **localStorage 里只存元数据（fileName、createdAt、size），blob 本身没有持久化**。
2. `ScriptPanel.tsx:1412` 把 `localUrl`（=blob URL）直接写进 `audioMaterial.url`；后续这个 MaterialItem 被序列化并 `PUT /api/video-projects/{id}` 持久化到后端 `workflow_data` JSON 里。
3. `MaterialsPanel.tsx:1086-1107` 回放逻辑确实尝试 `getAudioFileUrl(fileName)` 命中本地缓存；命中失败时回退到 `material.url`（仍是死 blob URL），**而非 `material.serverUrl` 或 `material.metadata.originalUrl`**。错误处理 1138-1161 只在 `metadata.fileName` 存在时才走二次回退路径，且依赖前一次 `audio.onerror` 触发——一切串联在浏览器异步事件上。
4. 报告里"`LocalAudioManager 从存储加载缓存元数据 {fileCount: 1}`"说明 localStorage 元数据确实被 `loadCacheFromStorage` 读取，但 **代码并没有真的把元数据回填到 `audioCache`**（`localAudioManager.ts:201-205`：仅 `console.log`，没有重建任何条目）。结果是元数据完全是装饰品。

### 修复策略

**核心思路**：项目状态序列化的应是 **稳定的服务端路径** `material.serverUrl`（已写入但未被使用），blob URL 仅作运行时缓存；进入项目时如果 IndexedDB / Map 没命中且存在 `serverUrl`，就用 `serverUrl` 直接喂给 `<audio>`，并在后台 fetch 重建 blob 缓存（可选优化）。

#### A. 立即修复（最小变更，覆盖 100% 复现路径）

**A1. `MaterialsPanel.tsx:1086-1107`** — 修改回放 URL 选择逻辑：

```ts
// 原：
let audioUrl = material.url;
let isLocalFile = false;
if (material.metadata?.fileName) {
  const localUrl = localAudioManager.getAudioFileUrl(material.metadata.fileName);
  if (localUrl) { audioUrl = localUrl; isLocalFile = true; }
}

// 改：优先级 = 本地缓存 → serverUrl → originalUrl → material.url
const stableServerUrl =
  material.serverUrl ||
  material.metadata?.originalUrl ||
  null;

let audioUrl: string;
let isLocalFile = false;
if (material.metadata?.fileName) {
  const localUrl = localAudioManager.getAudioFileUrl(material.metadata.fileName);
  if (localUrl) {
    audioUrl = localUrl;
    isLocalFile = true;
  } else if (stableServerUrl) {
    audioUrl = stableServerUrl; // 跨会话回退到服务端
  } else {
    audioUrl = material.url;
  }
} else if (stableServerUrl) {
  audioUrl = stableServerUrl;
} else {
  audioUrl = material.url;
}

// 健壮性：若 audioUrl 仍以 blob: 开头但本地没有缓存命中，直接告警并改用 serverUrl
if (audioUrl.startsWith('blob:') && !isLocalFile) {
  if (stableServerUrl) audioUrl = stableServerUrl;
  else { showError(t.materialsPanel.audioBrokenBlob); return; }
}
```

类似的 URL 选取必须用在以下位置（grep `material.url` / `audio.src`）：
- 时间轴音轨渲染：`src/components/video/timeline/AudioTrack*.tsx`（如有）
- 视频导出请求体：`src/lib/api/videoComposition.ts`、合成预览 player

新增工具 `src/lib/utils/audioUrl.ts`（如不存在）：
```ts
export function selectAudioPlaybackUrl(material: MaterialItem): string | null {
  if (typeof window !== 'undefined' && material.metadata?.fileName) {
    const local = localAudioManager.getAudioFileUrl(material.metadata.fileName);
    if (local) return local;
  }
  return material.serverUrl
    || material.metadata?.originalUrl
    || (material.url?.startsWith('blob:') ? null : material.url);
}
```
统一所有调用点。

**A2. `ScriptPanel.tsx:1412`** — 序列化用 serverUrl，运行时仍用 localUrl：

```ts
// 原：
const audioMaterial: MaterialItem = {
  ...
  url: localUrl,
  serverUrl: response.concatenated_audio_url,
  ...
};

// 改：把"运行时 blob URL"放到一个不参与持久化的字段，或者直接持久化 serverUrl
const audioMaterial: MaterialItem = {
  ...
  url: response.concatenated_audio_url, // 持久化路径
  serverUrl: response.concatenated_audio_url,
  // 运行时 blob 仅作内存缓存（已在 LocalAudioManager 中通过 fileName 检索）
  ...
};
```
这样保存到后端的 `materials[].url` 是 `/api/audio/generated/segment-2_concat...mp3`，跨会话仍然可解析。

**A3. `localAudioManager.ts:197-210`** — 修复 `loadCacheFromStorage` 当前是哑函数；最少要在 `getAudioFileUrl` 找不到时尝试 `fetch(serverUrl)` 重建（这一步可放 A 阶段，也可推到 B 阶段）。简化方案：直接删除 localStorage 的元数据持久化（移除"缓存里看似有 1 个文件实则没有"的误导）。

```ts
private loadCacheFromStorage(): void {
  // Metadata persistence was misleading: blobs cannot be restored
  // from localStorage, so we drop the metadata on boot and rebuild
  // by re-fetching from serverUrl on demand.
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(this.STORAGE_KEY);
  }
}
private saveCacheToStorage(): void { /* no-op */ }
```

#### B. 增强（可后续 PR）

- 在 `localAudioManager.getAudioFileUrl` 未命中且调用方传入 `fallbackServerUrl` 时，后台 `fetch` 拉回并重新 `URL.createObjectURL`，以恢复"本地播放零延迟"体验。
- 把缓存从 `Map<string,Blob>` 升级到真正的 IndexedDB（`localforage`），24h TTL 跨会话保留。

#### C. 数据迁移

历史项目里 `materials[].url` 字段已是 `blob:http://...`。两种处理：
1. **客户端读时迁移**：`useEffect` 加载项目后扫描 materials，把 `url.startsWith('blob:')` 的项 patch 为 `serverUrl ?? metadata.originalUrl`，并立即触发一次 PUT 把项目写回。
2. **被动**：仅运行时回退播放（A1 即覆盖），下次正常保存自动写入新字段。建议先做 A1+A2 + 被动迁移；不强制写回，避免大规模写放大。

### 测试建议

- **单元**: 为 `selectAudioPlaybackUrl` 写 Vitest，覆盖 blob/server/originalUrl/dead-blob 4 种组合。
- **集成**: Playwright 脚本——生成 TTS → reload 整个页面（不是 SPA 路由切换） → 进同一项目 → 点击预览/拖到时间轴 → 校验 `<audio>.src` 不以 `blob:` 开头且 `audio.error == null`。
- **回归**: 时间轴当前会话播放（blob URL 命中本地）必须保持原延迟。

### 风险

- 把 `material.url` 直接置为服务端路径会让某些时间轴预览失去"立即可播"的零延迟（要走一次 HTTP），可通过 A1 中的优先用本地缓存来抵消。
- `material.url` 同时被前端/后端多处读取：`videoComposition`（合成请求 payload）原本就期望服务端 URL，因此此改动会**修复一个现存隐藏问题**而非引入。需要 grep `material.url` 在 export/合成路径并确认。

---

## Bug #2 — AI 图像尺寸标签混淆（High / P1）

### 代码定位

| 文件:行 | 内容 |
|---|---|
| `src/components/video/components/AiImageModal/BasicGenerationTab.tsx:9-25` | `SIZE_PRESETS`、`SIZE_LABEL_KEYS` |
| `src/lib/i18n.ts:5203-5206`（en） | `size169Landscape: '16:9 Landscape'`、`size169Wide: '16:9 Wide'`、`size916Wide: '9:16 Wide'` |
| `src/lib/i18n.ts:7929-7932`（zh） | `size169Landscape: '16:9 横屏'`、`size169Wide: '16:9 宽屏'`、`size916Wide: '9:16 竖屏宽'` |
| `src/lib/i18n.ts:2474-2477` | TypeScript 类型声明（如改 key 需同步） |

### 根因

两个完全相同的 16:9（1280×720 vs 1024×576）和两个 9:16（720×1280 vs 576×1024）按钮使用接近同义的中文标签（"横屏"/"宽屏"、"竖屏"/"竖屏宽"），用户从文案上无法区分实际像素。1024×576/576×1024 是 **更低分辨率（576p）** 的 16:9 / 9:16 变体。

### 修复策略

**最小代价、最大语义化**：把像素规格直接放到按钮可见标签里。

修改 `i18n.ts` 文案（不动 schema、不动调用代码）：

```ts
// zh (7929-7932):
size169Landscape: '16:9 (1280×720)',
size916Portrait: '9:16 (720×1280)',
size169Wide: '16:9 (1024×576)',
size916Wide: '9:16 (576×1024)',
size1kSquare: '1:1 (1024×1024)',
size2kSquare: '1:1 (2048×2048)',

// en (5203-5206):
size169Landscape: '16:9 (1280×720)',
size916Portrait: '9:16 (720×1280)',
size169Wide: '16:9 (1024×576)',
size916Wide: '9:16 (576×1024)',
size1kSquare: '1:1 (1024×1024)',
size2kSquare: '1:1 (2048×2048)',
```

可选增强：在 `BasicGenerationTab.tsx` 的按钮上加 `title={preset.value}`，鼠标悬浮也显示原始字符串。

### 测试建议

- 视觉回归：截图对比按钮组前后；确保按钮宽度仍可容纳新文案（grid-cols-3 + py-2.5 px-2）。如果担心溢出，可在 `BasicGenerationTab.tsx:111` 把 `<span>` 包成 `<span className="truncate">`。
- 单元：`i18n.ts` 类型检查通过即可，无需新测试。

### 风险

字符串变长可能在 zh 下导致按钮换行或被截断。已上"truncate"为兜底；如果 UX 设计师要求保留汉字标签，可改为 `16:9 (HD)` / `16:9 (SD)` 之类品牌化术语并在 tooltip 给精确像素。

---

## Bug #3 — 参考图选择器：重复条目 + aria-label 重复（High / P1）

### 代码定位

| 文件:行 | 内容 |
|---|---|
| `src/components/video/components/AiImageModal/MaterialLibraryGrid.tsx:111-141` | 渲染按钮：`<img alt={m.name}> + <span>{m.name}</span> + title={m.name}` 同时出现 |
| `backend-services/basic-service/app/services/storage_service.py:502-571` | `list_user_materials` 直接 `os.walk` 文件系统，路径是 `{folder}/YYYY/MM/DD/user_{id}/{task_id}/{file}`；同名文件在不同 `task_id` 或不同日期目录下会产生重复行 |

### 根因

- **a11y 重复**：按钮的 *accessible name* 由内部内容计算（img alt + span 文本），结果 = `"mv-01.jpg mv-01.jpg"`。`title` 也是同名，更冗余。
- **数据重复**：用户多次上传同名图片 → 不同任务/日期路径下都生成独立文件 → `list_user_materials` 把 22 项里的同名文件都列出。后端没有按内容 hash 去重的概念。

### 修复策略

#### 3a. 前端 a11y 修复（必做、低风险）

`MaterialLibraryGrid.tsx:124-138`：

```tsx
<button
  ...
  aria-label={mp.materialLibraryReferenceLabel?.replace('{name}', m.name) || `参考图：${m.name}`}
  title={m.name}
>
  <img
    src={m.thumbnail_url || m.url}
    alt=""           // 装饰性图片，由 aria-label 兜底
    className="w-full aspect-square object-cover"
  />
  ...
  <span aria-hidden="true" className="...">{m.name}</span>
</button>
```

新增 i18n key（zh `参考图：{name}` / en `Reference image: {name}`）。

#### 3b. 后端去重（推荐做）

`storage_service.py:502-571`，在 `list_user_materials` 末段（排序前）加一层基于 `(name, size)` 的去重，保留最新；并新增可选 `dedupe=true` query 参数从前端控制：

```python
# storage_service.py
async def list_user_materials(
    self,
    user_id: str,
    material_type: Optional[str] = None,
    page: int = 1,
    page_size: int = 20,
    dedupe: bool = True,
) -> Dict[str, Any]:
    ...
    # Sort newest first first so dedupe keeps the freshest copy
    all_files.sort(key=lambda x: x.get("created_at", ""), reverse=True)

    if dedupe:
        seen: set[tuple[str, int]] = set()
        unique: list[dict] = []
        for f in all_files:
            key = (f["name"], f["size"])
            if key in seen:
                continue
            seen.add(key)
            unique.append(f)
        all_files = unique

    total = len(all_files)
    ...
```

`storage_router.py:304-330` 加上 `dedupe: bool = Query(True)` 参数透传。

> 说明：使用 `(name, size)` 作为弱内容指纹；在没有内容 hash 列的前提下足够稳健。如果将来支持上传时落库 sha256，可升级到精确去重。

#### 3c. 兜底（可选）

前端 `MaterialLibraryGrid.tsx:39-49` 在收到 list 后用 `Array.from(new Map(materials.map(m=>[m.name+'@'+m.size, m])).values())` 二次去重，使后端旧版本（未升级 dedupe）也立刻收益。

### 测试建议

- **后端单元**: 在 `tests/test_storage_service.py` 增加 fixture：在 `image/2026/05/01/user_x/task_a/foo.jpg` 与 `image/2026/05/02/user_x/task_b/foo.jpg` 同名同 size 时调用 `list_user_materials`，断言只返回 1 条且为最新。
- **前端单元**: Vitest 渲染 4 个同名 fixture，断言 `getAllByRole('button')` 数量 = 1 且 `accessibleName` 不重复。
- **手工**: 重复上传同 1 张图 5 次，进入"AI 创建 → AI 图像 → 选择参考图"，仅看到 1 项。

### 风险

- 跨任务的"虽然同名但语义不同"的素材（用户可能故意分两次上传不同版本但叫 `cover.jpg`）会被视为重复；用 size 作为辅助键能缓解 80% 误杀，剩余可在 v2 用 sha256 解决。该问题概率低、不阻塞用户，但应在 release note 提一句"按文件名+大小去重"。

---

## Bug #4 — 声音选择 UX（Medium / P2）

### 代码定位

`src/components/video/components/VoiceSelector.tsx:150-242` —— 当前下拉菜单：

- 没有搜索 / 过滤
- 没有试听
- Escape 不响应（`onClickOutside` 通过 1 个全屏 `<div>` 实现）
- 焦点管理弱（无 `role="listbox"`、无 `aria-expanded`）

### 修复策略

#### 4a. Escape & 键盘可达（强制做）

```tsx
useEffect(() => {
  if (!isOpen) return;
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { setIsOpen(false); }
  };
  document.addEventListener('keydown', onKey);
  return () => document.removeEventListener('keydown', onKey);
}, [isOpen]);
```

并把 `<button>` 上加 `aria-haspopup="listbox" aria-expanded={isOpen}`，下拉根加 `role="listbox"`，每条 voice 加 `role="option" aria-selected={selected}`。

#### 4b. 顶部搜索框 + 性别过滤（强烈建议）

在 `relative` 容器顶部插入一个 sticky 搜索条，控制 `searchTerm` + `genderFilter`：

```tsx
const [searchTerm, setSearchTerm] = useState('');
const [genderFilter, setGenderFilter] = useState<'all' | 'male' | 'female'>('all');

const filteredVoiceTypes = useMemo(() => {
  const kw = searchTerm.trim().toLowerCase();
  return Object.fromEntries(
    Object.entries(voiceTypes).filter(([, v]) => {
      const matchKw = !kw
        || v.name.toLowerCase().includes(kw)
        || (v.description ?? '').toLowerCase().includes(kw)
        || (v.category ?? '').toLowerCase().includes(kw);
      const matchGender = genderFilter === 'all' || v.gender === genderFilter;
      return matchKw && matchGender;
    })
  );
}, [voiceTypes, searchTerm, genderFilter]);
```
然后在 `voicesByCategory` 计算里换用 `filteredVoiceTypes`。

#### 4c. 试听按钮（可选，影响后端配额）

每条 voice 行右侧加一个 ⏵ 按钮，点击调用 `convertSentencesToSpeech` 用一个固定示例文案（`t.scriptPanel.voiceSelector.previewSampleText` = `"你好，这是声音示例。"` / `"Hello, this is a voice preview."`），并把结果缓存到本地（`localAudioManager` 复用 + key=`preview-${voiceId}`），下次点击直接复用。**注意配额成本**——必须前端缓存且后端可加 24h CDN 缓存。

风险高、影响后端，可放到独立 PR。

### 测试建议

- **行为测试**: Playwright `press Escape` → 下拉关闭。
- **可达性**: axe-core 扫描 voice picker 不报 missing aria。
- **过滤**: 输入"少年" → 只剩"少年梓辛/Brayan"等条目。

### 风险

- 试听功能在生产环境消耗 ARK / Volcano TTS 配额，需确认 finance 与 PM 同意；如果短期内放不出，仅做 4a + 4b 也是巨大改善。

---

## Bug #5 — 默认 404 页（Medium / P2）

### 代码定位

- 当前没有 `src/app/not-found.tsx` 文件（已用 `Glob` 验证）
- `src/app/layout.tsx:17-46` —— RootLayout 仅渲染 `{children}` 套 Providers，未提供 Header
- Header 组件位置：`src/components/Header.tsx`（应已存在；如不存在用 `Header.tsx` 名字搜索定位）

### 根因

未注册 `not-found.tsx` 时 Next.js 退回内置英文 404 模板，且内置模板不会被 `RootLayout` 包裹（实际上会被包裹，但因为 Layout 自身只放 Providers + children，没有视觉外壳，看起来像"裸"页面）。`/admin` 也命中默认 404。

### 修复策略

#### 5a. 新增 `src/app/not-found.tsx`

```tsx
'use client';

import Link from 'next/link';
import { useLocale } from '@/contexts/LocaleContext';

export default function NotFound() {
  const { t } = useLocale();
  return (
    <main className="min-h-full flex flex-col items-center justify-center px-6 py-24 text-center">
      <h1 className="text-5xl font-bold text-foreground">404</h1>
      <p className="mt-3 text-base text-muted-foreground">
        {t.notFound.title /* "页面未找到" / "Page not found" */}
      </p>
      <p className="mt-2 text-sm text-muted-foreground max-w-md">
        {t.notFound.description}
      </p>
      <div className="mt-6 flex gap-3">
        <Link
          href="/"
          className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90"
        >
          {t.notFound.goHome /* "返回首页" / "Back to home" */}
        </Link>
        <button
          onClick={() => history.back()}
          className="px-4 py-2 rounded-md border border-border text-sm hover:bg-accent"
        >
          {t.notFound.goBack}
        </button>
      </div>
    </main>
  );
}
```

新增 i18n key `notFound: { title, description, goHome, goBack }`，zh 与 en 各一份；并在 `i18n.ts:2474` 附近的 type interface 同步加字段。

#### 5b. （可选）确保 Header 在 404 页可见

如果 `RootLayout` 没有渲染全局 Header（确认 `layout.tsx` 只有 Providers + children），把 Header 渲染移进 Root 也会让 Login 页显示 Header——通常不是想要的。建议只在 `not-found.tsx` 内部局部 import Header 组件并渲染：

```tsx
import { AppHeader } from '@/components/Header'; // 实际路径以仓库为准
...
<AppHeader />
<main ...>...</main>
```

#### 5c. `/admin` URL 直链可用（可选）

当前后台只有 Header⚙️弹窗。如果产品决定 `/admin` 也作为合法入口，新增 `src/app/admin/page.tsx`（受 `useAuth().user.role === 'admin'` 守卫，否则 redirect 到首页）。

> Step 5c 与 Bug 报告"产品 polish"的 expectation 相符但工作量更大；建议先做 5a/5b，5c 单独提工单。

### 测试建议

- Playwright: 访问 `/this-route-does-not-exist` → 断言 `<h1>404`、可见 "返回首页" 按钮、当前 locale 切到 zh 时显示中文。
- 视觉回归：zh / en 两套截图归档。

### 风险

低。`not-found.tsx` 是 Next 15 标准用法，几乎零回归。

---

## Bug #6 — Profile 对话框 Save 按钮消失（Low / P3）

### 代码定位

`src/components/UserProfile/UserInfoPanel.tsx:200-217`：

```tsx
{hasChanges && (
  <div className="mt-8 flex items-center space-x-4 pt-6 border-t border-border">
    <button onClick={handleSave} disabled={isLoading} ...>{...}</button>
    <button onClick={handleReset} disabled={isLoading} ...>{...}</button>
  </div>
)}
```

### 根因

按钮容器整体由 `hasChanges` 条件渲染——pristine 状态时 DOM 中完全没有 Save / Cancel，用户难以预期。

### 修复策略

把条件渲染改为常驻 + 禁用态：

```tsx
<div className="mt-8 flex items-center space-x-4 pt-6 border-t border-border">
  <button
    onClick={handleSave}
    disabled={!hasChanges || isLoading}
    className="..."
  >
    {isLoading ? t.profile.saving : t.profile.save}
  </button>
  <button
    onClick={handleReset}
    disabled={!hasChanges || isLoading}
    className="..."
  >
    {t.profile.cancel}
  </button>
  {!hasChanges && (
    <span className="text-xs text-muted-foreground">{t.profile.noChanges}</span>
  )}
</div>
```

新增 i18n key `profile.noChanges` = `"无变更"` / `"No changes"`。

可选：加 `Ctrl+S` 快捷键：

```ts
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      if (hasChanges && !isLoading) handleSave();
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}, [hasChanges, isLoading]);
```

### 测试建议

- Vitest：渲染 `<UserInfoPanel>`（mock `useAuth` 返回稳定 user），断言 Save 按钮一直在 DOM 中且 `disabled === true`；输入后 `disabled === false`。
- 现有 `__tests__/...` 目录下添加 fixture。

### 风险

极低。按钮始终渲染对布局无害；`!hasChanges` disabled 不会触发 onClick。

---

## 通用回归矩阵

| 测试类型 | 覆盖 |
|---|---|
| Vitest 单元 | `selectAudioPlaybackUrl` (Bug#1)、`localAudioManager.loadCacheFromStorage` 行为 (Bug#1)、`UserInfoPanel` 按钮 disabled (Bug#6)、`MaterialLibraryGrid` a11y (Bug#3)、VoiceSelector escape/filter (Bug#4) |
| Pytest（后端） | `test_storage_service.list_user_materials_dedupes` (Bug#3) |
| Playwright e2e | 跨会话音频回放 (Bug#1)、404 页本地化 (Bug#5)、Voice picker Escape (Bug#4) |
| 手动 QA | AI 图像尺寸标签可读性 (Bug#2)、Profile pristine 时按钮可见 (Bug#6) |

---

## 修复后的发布计划建议

1. **PR-1（紧急）**: Bug#1 + Bug#6 + Bug#2（i18n only）。低风险、用户可见缺陷立即消除。
2. **PR-2**: Bug#3 a11y + 后端去重 + Bug#5（含 i18n 新 keys）。需要后端 + 前端同时上线。
3. **PR-3**: Bug#4（escape/search/filter）。试听如果决定做，单独 PR-4。

每个 PR 的 commit 信息建议遵循仓库现有 `[fix] /[modify]` 前缀格式（参见 `recent commits`）。

---

## 附录：与上一轮（iter4）变更的兼容性核对

- iter4 step 4 修复了 workflow save/run gate、materials empty hint、timeline coming-soon、log hygiene。本轮所有修改均在不同模块，无冲突。
- 本次 Bug#1 修改 `MaterialItem.url` 的语义（运行时 blob → 持久化 server URL），所有读取 `material.url` 的位置已枚举并需在 PR-1 中一并审查（建议代码评审用 `Grep "material\.url"` 全仓覆盖）。

— 文档结束 —
