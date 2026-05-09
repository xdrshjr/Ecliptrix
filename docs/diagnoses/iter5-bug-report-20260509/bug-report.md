# 网页 Bug 探索报告 — Iter5

**生成时间**: 2026-05-09
**测试环境**:
- Dev 服务器: `http://192.168.1.123:3010`
- 浏览器: Microsoft Edge (msedge, headed mode, persistent profile)
- 登录账号: admin (admin@local.dev / 超级管理员)
- 测试方法: web-superuse 技能 + playwright-cli 0.1.4 (auto a11y snapshot + console + network)
- 工作目录: `G:\projects\takoAI\Ecliptrix`

**探索范围（前 4 轮已覆盖区域之外）**: TTS / 音频生成回放、AI 图像生成（Seedream）、暗色模式切换、用户菜单 / 个人信息 / 退出登录、深链路由 / 错误边界、素材库参考图选择器。

**总览**: 共发现 **6 个有效 Bug**（1 Critical / 2 High / 2 Medium / 1 Low）。其中 Bug #1（音频幽灵素材）影响所有有 TTS 历史的项目，跨会话重启后必现，最严重。Bug #5（404 页未本地化）为产品级 polish 缺陷。

---

## Bug #1：TTS 生成的音频素材跨浏览器会话出现"幽灵素材" — `MEDIA_ERR_SRC_NOT_SUPPORTED`

| 字段 | 值 |
|---|---|
| 严重程度 | **Critical / P0** |
| 优先级 | 必须立即修复 |
| 模块 | 视频编辑 → 项目素材库 → 音频段 |
| 复现稳定性 | 100%（跨浏览器重启时必现） |

### 详细描述
"转换语音"会调用后端 `/api/tts/convert-sentences`，前端 `LocalAudioManager` 把音频文件存入 IndexedDB 并以 `URL.createObjectURL(blob)` 创建一个 `blob:` URL，然后把这个 `blob:` URL 持久化到项目状态（`PUT /api/video-projects/{id}` payload 中）。问题是：`blob:` URL 仅在创建它的那个 Document 生命周期内有效——浏览器关闭/标签关闭/会话恢复后，旧的 blob URL 全部失效，但项目状态仍记录着它。再次打开项目时，前端把死掉的 `blob:` URL 直接丢进 `<audio src>`，UI 上看似存在一条 "段落1 - Opening Introduction - 语音 / MP3 / 12.82s"，**点"预览素材"无声**、**点"下载素材"无文件**、**拖到时间轴显示音频已添加但无法播放**，预览区"播放"按钮保持 disabled、导出按钮保持 disabled。

### 复现步骤
1. 登录 admin → 视频编辑 → 打开任一项目（示例：BugTest，URL `?tab=video&task=task-1778324821584-...`）
2. 在某段（示例：段落 1 Opening Introduction）点击"转换语音"，等待生成成功（控制台 `[LocalAudioManager] 音频文件存储成功`）
3. **关闭浏览器**（不仅是标签——必须关闭整个浏览器实例使 blob 从 ObjectURL 表中清除）
4. 重新打开浏览器、登录、进入同一项目
5. 在素材库 → 音频 tab 看到那条音频素材，点击"预览素材"

### 预期 vs 实际
| | 期望 |
|---|---|
| 预期 | 重新打开项目时若 blob 已失效，应自动从后端 `/api/audio/generated/{filename}.mp3` 重新拉取并重建 blob；或在 UI 上以"⚠️ 需要重新生成"占位状态提示，且禁止把死素材加入时间轴。 |
| 实际 | 1) `<audio>` 元素 `src` 仍是死 blob URL，`audio.error.code === 4` (MEDIA_ERR_SRC_NOT_SUPPORTED)。2) 控制台报错 `Failed to load resource: net::ERR_FILE_NOT_FOUND @ blob:http://...`。3) `LocalAudioManager 从存储加载缓存元数据 {fileCount: 1}`——IndexedDB 里只有 1 个文件（segment-2，本会话刚生成的），但素材列表展示 2 条。4) 网络面板里 `[GET] blob:http://192.168.1.123:3010/97e3e549-... => [FAILED] net::ERR_FILE_NOT_FOUND` 出现 ≥2 次（每次 React 重 mount 都会重试）。 |

### 证据
- 控制台：`audio-preview.yaml` 后采集，`[ERROR] Failed to load resource: net::ERR_FILE_NOT_FOUND @ blob:http://192.168.1.123:3010/97e3e549-96b7-4cfd-ad2e-4c7fe5fc10c0`
- DOM eval 输出：
  ```
  [{"src":"blob:http://192.168.1.123:3010/97e3e549-96b7-4cfd-ad2e-4c7fe5fc10c0","error":4}]
  ```
- 网络日志：`.web-debugger/logs/ai-image-network.log` 有两次 `[FAILED] net::ERR_FILE_NOT_FOUND` 命中同一 blob URL
- 后端音频 `GET /api/audio/generated/segment-2_concatenated_1778328422_84f10b2d.mp3 => [200] OK` 表明后端文件其实仍存在，前端只是不知道去后端拿它

### 修复方向（供 Subtask #1 参考）
- 项目状态保存的不应是 `blob:` URL，而应是稳定的服务端路径（`/api/audio/generated/{name}.mp3` 或 `cached_materials/<source>/<id>.mp3`）；blob URL 只能作为运行时缓存，且每次进入项目时按服务端路径重新建立。
- 进入项目时若 IndexedDB 里没有对应文件，应回退到从服务端 fetch 并重建 blob，而不是默默把死 URL 喂给 `<audio>`。
- 入口可能在 `src/lib/api/tts.ts` / `src/components/video/...AudioManager` / `LocalAudioManager` 模块及 `useCoverRender`-类的封装。

---

## Bug #2：AI 图像生成 — "图片尺寸"按钮的相同长宽比在两组分辨率下使用易混淆的标签

| 字段 | 值 |
|---|---|
| 严重程度 | **High / P1** |
| 优先级 | 中等 |
| 模块 | 视频编辑 → AI 创建 → AI 图像 → 基础生成 → 图片尺寸 |
| 复现稳定性 | 100% |

### 详细描述
"图片尺寸"区有 6 个按钮：`1K 方形 / 2K 方形 / 16:9 横屏 / 9:16 竖屏 / 16:9 宽屏 / 9:16 竖屏宽`。从源码 `src/components/video/components/AiImageModal/BasicGenerationTab.tsx:19-24` 看，这些标签对应的真实分辨率为：

| 文案 | i18n key | 真实分辨率 |
|---|---|---|
| 1K 方形 | size1kSquare | 1024×1024 |
| 2K 方形 | size2kSquare | 2048×2048 |
| **16:9 横屏** | size169Landscape | **1280×720** |
| **16:9 宽屏** | size169Wide | **1024×576** |
| **9:16 竖屏** | size916Portrait | 720×1280 |
| **9:16 竖屏宽** | size916Wide | 576×1024 |

也就是说"16:9 横屏"和"16:9 宽屏"长宽比完全一样、只是分辨率不同，"竖屏"和"竖屏宽"同理。中文里"横屏"≈"宽屏"——用户没有任何线索能区分两者。`size169Wide` 实际是更低的 1024×576 缩水版（即"低分辨率 16:9"），而 `size169Landscape` 才是 1280×720。

### 复现步骤
1. 视频编辑 → 进入任一项目 → 素材库右上 "AI 创建" → "AI 图像"
2. 观察"图片尺寸"按钮组

### 预期 vs 实际
| | |
|---|---|
| 预期 | 标签必须在外观上即可区分两个 16:9（以及两个 9:16）选项，例如 `16:9 (1280×720)` / `16:9 (1024×576)`，或者使用主流术语：`16:9 720p` / `16:9 标清宽`；至少 tooltip 要带上像素尺寸。 |
| 实际 | 普通用户必须靠点击试错或读源码才知道两个 16:9 的差别，会随机选到不想要的分辨率，且生成会消耗 ARK 配额。 |

### 证据
- 源码：`src/components/video/components/AiImageModal/BasicGenerationTab.tsx:19-24`
- i18n：`src/lib/i18n.ts:7929-7932`
- a11y 快照：`.web-debugger/snapshots/ai-image.yaml:280-291`

---

## Bug #3：AI 图像参考图选择器 — 列表大量重复条目 + 每个按钮 aria-label 文件名重复 2 次

| 字段 | 值 |
|---|---|
| 严重程度 | **High / P1** |
| 优先级 | 中等（影响 a11y 与数据一致性） |
| 模块 | 视频编辑 → AI 创建 → AI 图像 → 选择参考图关联 → 素材库 |
| 复现稳定性 | 100% |

### 详细描述
打开"AI 图像 → 选择参考图关联 → 素材库"分页 1（共 22 项），观察到：

1. **同一个文件被列出多次**（明显的重复未去重）：
   - `mv-01.jpg` 在第 1 页就出现 5 次（refs e1048, e1051, e1063, e1069, e1072）
   - `528ED0407130AA2A841B1AFB50D73661.jpg` 在第 1 页出现 ≥9 次（refs e1054, e1057, e1075, e1078, e1081, e1090, e1093, e1099, ...）
   - `43E39F99062C7167B71795B65436FBB7.jpg` 出现 ≥3 次
2. **每个按钮的可访问名 (`aria-label` / accessible name) 把文件名拼了两次**：例如 `button "mv-01.jpg mv-01.jpg"`、`button "528ED0407130AA2A841B1AFB50D73661.jpg 528ED0407130AA2A841B1AFB50D73661.jpg"`。屏幕阅读器会读"图片 mv-01-jpg mv-01-jpg 按钮"，多余且嘈杂。

去重应该按服务端 `material_id` 或文件 hash 去重；现在看起来是按数据库行 id 列表，每次上传的同名文件都算独立行（基础设施未做内容去重）。

### 复现步骤
1. 视频编辑 → 选 1 个老项目（示例：BugTest，9 个项目下任一）→ AI 创建 → AI 图像
2. 滚到下方"选择参考图关联"区域

### 预期 vs 实际
| | |
|---|---|
| 预期 | 1) 同一文件（基于内容 hash 或上传文件名 + 大小）只展示一次；或者明确以"上传时间 + 项目"作为副标题区分。2) 按钮 accessible name 不重复，例如 `<button aria-label="参考图：mv-01.jpg"><img alt="" />…</button>`。 |
| 实际 | 1) 同名素材成倍出现，22 项里至少 12 项是同一份 528ED0407... 的副本，用户难以挑选。2) Accessible name 重复使屏幕阅读器朗读冗余。 |

### 证据
- a11y 快照：`.web-debugger/snapshots/ai-image.yaml:315-378`
- 后端调用：`[GET] /api/storage/user-materials?user_id=...&page=1&page_size=20&material_type=image => [200] OK`（请求/响应正常，但响应包含重复 row）

---

## Bug #4：声音选择下拉无搜索 / 无试听 / 不响应 Escape 键

| 字段 | 值 |
|---|---|
| 严重程度 | **Medium / P2** |
| 优先级 | 中等（118 个语音，UX 痛点显著） |
| 模块 | 视频编辑 → 项目 → 文本脚本面板 → 声音选择按钮（"少年梓辛/Brayan"） |
| 复现稳定性 | 100% |

### 详细描述
点击文本脚本面板下方的声音选择按钮（默认显示"少年梓辛/Brayan (男声) (通用场景)"）会弹出全量声音列表。从快照统计该列表至少有 118 个 `(男声)`/`(女声)` 选项（仅"通用场景"分组就 17 个），但该弹窗：

1. **没有搜索框**——只能滚屏挨个找
2. **没有 filter / 标签筛选**——男声/女声/场景都不能筛
3. **没有试听按钮**——选项只有名称 + 描述（"清澈的男性声音，适合年轻化内容"），用户必须先选中、点"转换语音"消耗后端配额生成段落，才能听到音色
4. **按 Escape 键不会关闭弹窗**（已验证：press Escape 后再次 snapshot，"邻家女孩"仍存在 3 次匹配）

### 复现步骤
1. 视频编辑 → 任一项目 → 文本脚本面板下方点击声音选择按钮
2. 列表展开后按 `Escape`
3. 列表保持展开，必须点击外部其它元素才能关闭——而点击 logo 等会触发误导航

### 预期 vs 实际
| | |
|---|---|
| 预期 | 顶部应有搜索框和性别 / 场景过滤；每个 voice 行应有试听按钮（调用一段固定示例文本的 TTS 缓存）；按 Escape 应关闭弹窗。 |
| 实际 | 用户面对 118 项列表只能盲选 + 反复"转换语音"试听，且关闭方式不直观。 |

### 证据
- a11y 快照：`.web-debugger/snapshots/voice-picker.yaml`，`grep -c "(男声)\|(女声)" → 118`
- 行为验证：`.web-debugger/snapshots/post-escape.yaml`，`grep -c "邻家女孩" → 3`（弹窗未关闭）

---

## Bug #5：404 页面未本地化、无 Header、无返回入口；`/admin` 等内部入口直接 404

| 字段 | 值 |
|---|---|
| 严重程度 | **Medium / P2** |
| 优先级 | 产品 polish |
| 模块 | Next.js 默认 404 / 全站路由 |
| 复现稳定性 | 100% |

### 详细描述
直接访问任意未注册路径（例如 `/this-route-does-not-exist`、`/admin`、`/profile`）都会落到 Next.js **默认** 404 页：仅一个 `<h1>404</h1>` + `<h2>This page could not be found.</h2>`，没有：
- 应用 header / logo / 暗色模式切换 / 语言切换（即与 `<RootLayout>` 完全脱钩）
- 中文本地化（`LocaleContext` 选 `zh` 时仍是英文）
- 返回首页 / 返回上一页 链接
- 任何品牌元素

`/admin` 也命中此 404——后台管理面板只有"在 Header 里点击⚙️按钮打开一个面内弹窗"这一条入口，无法分享 URL、不能用 URL 直接打开（与现代多页应用习惯不符）。

### 复现步骤
1. 浏览器访问 `http://192.168.1.123:3010/this-route-does-not-exist` 或 `/admin`
2. 观察整个页面

### 预期 vs 实际
| | |
|---|---|
| 预期 | Next.js App Router 中创建 `src/app/not-found.tsx` 复用 `<RootLayout>` 与 `LocaleContext`，渲染中文 / 英文版的 404 文案 + 返回首页按钮 + Header；`/admin` 应该是一个真正的 protected route 而不是只有面内弹窗。 |
| 实际 | 默认 Next.js 404 + 无导航；新用户看到这个页面会以为应用挂了。 |

### 证据
- a11y 快照：`.web-debugger/snapshots/404.yaml`、`.web-debugger/snapshots/admin-deep.yaml` 内容相同
- 控制台：`[ERROR] Failed to load resource: the server responded with a status of 404 (Not Found) @ http://192.168.1.123:3010/this-route-does-not-exist:0`
- 截图：`.web-debugger/screenshots/404-page.png`

---

## Bug #6：用户资料对话框 — 当表单 pristine 时 "保存更改" 按钮整体从 DOM 移除，缺少明显的"无修改"状态提示

| 字段 | 值 |
|---|---|
| 严重程度 | **Low / P3** |
| 优先级 | 低（DUX 改善） |
| 模块 | Header 右侧 用户菜单 → 个人信息 |
| 复现稳定性 | 100% |

### 详细描述
"个人信息"对话框在表单未被修改时，**完全不渲染**"保存更改"按钮（DOM 中没有该节点），只有右上角"关闭"。一旦在用户名 / 邮箱 / 姓名 / 头像 URL 任一字段输入变化，"保存更改"按钮才插入 DOM。

潜在问题：
- 用户进入 dialog 时无法预知有保存功能，可能怀疑是只读视图、关闭后再重新打开
- 没有"已保存"/"无变更"的可见状态——常见做法是常驻一个 disabled 的 Save 按钮
- 缺少键盘可达的快捷键（Ctrl+S 等）

```
playwright eval (pristine):  '[]'                    （DOM 中无"保存更改"按钮）
playwright eval (dirty):     '[{"t":"保存更改",…}]'  （typing 后才插入）
```

### 复现步骤
1. Header 头像 A → "个人信息"
2. 在打开的对话框观察右下/底部——无 Save 按钮
3. 修改姓名字段，再观察——"保存更改"按钮出现

### 预期 vs 实际
| | |
|---|---|
| 预期 | "保存更改"按钮始终渲染，未修改时为 disabled，并提示文案"无修改"。 |
| 实际 | 按钮节点完全消失，新用户难以发现。 |

### 证据
- a11y 快照：`.web-debugger/snapshots/profile.yaml`（pristine）vs `.web-debugger/snapshots/profile-edited.yaml`（dirty）
- DOM eval：`document.querySelectorAll('button').filter(/保存更改/) → []` (pristine)，`[{...display:'inline-flex',...}]` (dirty)

---

## 附录：探索时未深入但已观察到的潜在问题（不计入主清单）

- 浏览器关闭→重启→恢复登录后访问 `/?tab=video&task=task-old-id` 类已失效 task URL，URL 会被静默重写为 `/`，没有 toast 提示"项目不存在"。可能与 Bug #1 的根因相同（前端在 task 不可恢复时直接吞掉 task 段而非提示）。
- 进入"AI 创建"菜单时 URL 中的 `task=` 段会被替换为新生成的 task id（`task-1778328360045-video-dm2s1kul0`），但 UI 上看到的项目内容并未实际改变——疑似无意的副作用。

---

## 附录 B：测试覆盖矩阵

| 模块 | 已覆盖 | Bug 命中 |
|---|---|---|
| TTS 转换 + 音频素材回放 | ✓ | #1 #4 |
| AI 图像生成（基础 / 参考图） | ✓ | #2 #3 |
| 暗色模式切换 | ✓（功能正常） | – |
| 用户菜单 / Profile / Logout | ✓ | #6 |
| 404 / 深链 / 错误边界 | ✓ | #5 |
| 视频导出 / 时间轴 | 部分（受 Bug #1 阻断） | – |
| 头脑风暴 | 已知（iter4 重复，跳过） | – |

---

## 总结

- 6 个 Bug 中 **#1（音频幽灵素材）影响最大且为跨会话必现**——任何使用过 TTS 的项目重启浏览器后都会留下不可播放的素材，等同于数据"看起来在但实际不在"，会严重影响信任感。
- **#2（重复尺寸标签）和 #3（重复参考图）** 是 AI 图像生成核心路径上的可见缺陷，影响每位生成图像的用户。
- **#4（声音选择 UX）** 和 **#5（404 polish）** 是产品成熟度问题。
- **#6（保存按钮渲染）** 为 DUX 细节。

下一步（Subtask #1）应优先围绕 #1 的根因（前端项目状态序列化 blob URL → 应序列化稳定服务端路径）以及 #2/#3 的 i18n + 后端去重展开方案。
