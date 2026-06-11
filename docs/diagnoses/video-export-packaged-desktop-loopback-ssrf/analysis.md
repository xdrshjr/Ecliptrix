# 打包桌面端视频导出仍失败：loopback `127.0.0.1` 同源绝对引用命中后端 SSRF 守卫

> Bug slug: `video-export-packaged-desktop-loopback-ssrf`
> 诊断节点：Subtask #0（问题定位与分析）
> 日期：2026-06-11
> 本节点不写修复代码、不提交 git，仅产出含证据的根因分析与候选方案。
> 上一轮（round-1）诊断：`docs/diagnoses/video-export-localhost-ssrf-block/analysis.md`，修复提交 `59a4ab6`。

---

## 0. 本轮背景（与 round-1 的关系）

- round-1 现象：本地素材导出时立即报 `Composition request rejected: host 'localhost' is on the SSRF block-list`。
- round-1 修复（`59a4ab6`）：让 `selectPlaybackUrl(purpose:'export')` 的导出分支**不再调用 `toAbsolutePlaybackUrl` 绝对化**，使请求体携带相对 `/api/storage/files/...`，后端 `_guard_request_urls` 因非 `http(s)://` 而跳过外网校验。
- 本轮（round-2）用户反馈：**「开发者模式启动，导出正常了，但打包为桌面端以后，导出视频仍然失败」**。

**先行结论**：round-1 修复**是必要的但不充分**。它只消除了「`selectPlaybackUrl` 自己做的绝对化」，并未保证「导出请求体里不含 loopback 绝对 URL」。开发态（origin = `http://localhost:3000`）用「刚上传的相对 URL 素材」导出恰好绕开了残留缺陷；**打包桌面端 origin 变成 `http://127.0.0.1:PORT`，且只要任一素材字段已经是绝对同源 URL（剪辑导出回写 / 持久化项目等会产生），导出分支就会原样把 `http://127.0.0.1:PORT/api/storage/files/...` 发给后端**，命中后端**另一条**拒绝路径 `_is_unsafe_ip`（loopback IP），报 `host '127.0.0.1' resolves to disallowed address 127.0.0.1`——这正是 round-1 分析 §4 预言过、但修复未真正闭合的那条路径。

---

## 1. 问题描述（Problem description）

用户在视频编辑器下方剪辑面板把视频素材 + 音频拖到轨道后，点击「导出视频」：

- **开发者模式（`npm run dev` 或 desktop `--dev`，前端跑在 `http://localhost:3000`）**：round-1 修复后导出已正常。
- **打包桌面端（Electron 加载 `http://127.0.0.1:PORT`，默认 18320）**：导出仍然失败。

失败发生在后端「请求时 URL 守卫」阶段，合成线程尚未启动即被拒绝。与 round-1 同属一类 SSRF 守卫拒绝，但**拒绝原因不同**：dev 命中 `localhost` 黑名单，打包端命中 `127.0.0.1` 的私网/loopback IP 判定。

---

## 2. 复现步骤（Reproduction steps）

### 2.1 环境差异（这是本 bug 的关键变量）

| | 开发者模式 | 打包桌面端 |
|---|---|---|
| 前端 origin（`window.location.origin`） | `http://localhost:3000` | `http://127.0.0.1:18320` |
| 窗口加载入口 | `desktop/main/index.js:18-19,326`（`DEV_FRONTEND_URL='http://localhost:3000'`） | `desktop/main/index.js:153,368`（`createMainWindow('http://127.0.0.1:${state.frontendPort}')`） |
| 前端来源 | 实时源码（Next dev，永远含最新修复） | 预构建 standalone bundle（`desktop/build/frontend` → 打进 `extraResources/frontend`） |
| 后端 | `127.0.0.1:8000` | `127.0.0.1:18321`（`desktop/main/config.js` 默认 18321） |

证据：
- `desktop/scripts/dev.js:37-39`：`// main/index.js dev mode hard-codes http://localhost:3000` + `FRONTEND_PORT = 3000`。
- `desktop/main/config.js:9-10`：`DEFAULT_FRONTEND_PORT = 18320`。
- `desktop/main/frontendService.js:27,30`：`HOSTNAME: '127.0.0.1'`、`healthUrl: http://127.0.0.1:${frontendPort}/`。

### 2.2 UI 复现（打包桌面端）

1. 安装并启动打包后的桌面端（Electron 窗口标题栏地址即 `http://127.0.0.1:18320`）。
2. 上传本地视频素材、音频素材。
3. **触发任一会把素材引用绝对化的常规操作**（最常见两类，命中其一即可，见 §3.4）：
   - 对该视频用「剪辑素材 / 切片」功能导出 clip（剪辑导出会把**绝对的预览 URL** 回写进素材 `metadata.localResolvedUrl`，见 §3.4-a）；或
   - 打开一个**之前保存过的项目**（持久化里素材字段被原样保存，若其中已是绝对 URL 则原样恢复，见 §3.4-b）。
4. 把素材加入视频/音频轨道，点击「导出视频」。
5. **预期**：合成并下载 mp4；**实际**：立即失败。后端日志出现
   `Composition request rejected by url_guard: host '127.0.0.1' resolves to disallowed address 127.0.0.1`。

### 2.3 最小复现（不依赖 UI，直接打后端，稳定复现「127.0.0.1 被拒」）

模拟打包端绝对化后发出的请求体（host 为 `127.0.0.1`）：

```bash
curl -X POST http://127.0.0.1:18321/api/video/compose \
  -H "Content-Type: application/json" \
  -d '{
    "task_id": "repro",
    "video_items": [{
      "id": "v1", "name": "local.mp4",
      "url": "http://127.0.0.1:18320/api/storage/files/video/2026/06/local.mp4",
      "start_time": 0, "duration": 5, "clip_start": 0, "clip_end": 5
    }],
    "audio_items": [], "subtitle_items": [], "image_items": [],
    "total_duration": 5, "output_fps": 30, "output_format": "mp4"
  }'
```

返回 `success=false, message="Composition request rejected: host '127.0.0.1' resolves to disallowed address 127.0.0.1"`。
把 `url` 改成相对 `/api/storage/files/video/2026/06/local.mp4` 则不会被拦——这正是根因的反向验证（守卫只校验 `http(s)://` 开头的 URL）。

> dev 下用 `http://localhost:3000/...` 做同样请求，则报 round-1 的 `host 'localhost' is on the SSRF block-list`——**同一缺陷，两条不同的后端拒绝路径**。

---

## 3. 根因分析（Root cause analysis，含证据）

### 3.1 后端守卫对两种 loopback 形态是**两条独立的拒绝路径**

合成入口先跑 `_guard_request_urls`，对任何 `http(s)://` URL 调 `validate_external_url`：

`backend-services/basic-service/app/services/video_composition_service.py:1565-1568`
```python
if lower.startswith("http://") or lower.startswith("https://"):
    validate_external_url(url)      # ← 对 loopback 同源 URL 也照样校验
    continue
```

`validate_external_url` 内部**先**查主机黑名单，**后**做 IP 私网/loopback 判定，两者各自独立：

`backend-services/basic-service/app/security/url_guard.py:60-73`（`_BLOCKED_HOSTS`）
```python
_BLOCKED_HOSTS = frozenset({ "localhost", "localhost.localdomain", "ip6-localhost", ... })
```
`backend-services/basic-service/app/security/url_guard.py:213-224`
```python
normalized_host = host.rstrip(".")
if normalized_host in _BLOCKED_HOSTS:                       # ← 路径①：localhost 命中这里
    raise URLGuardError(f"host '{normalized_host}' is on the SSRF block-list")

if not _allow_private_override():
    for ip_str in _resolve_addresses(normalized_host, parsed.port):
        if _is_unsafe_ip(ip_str):                          # ← 路径②：127.0.0.1 命中这里
            raise URLGuardError(
                f"host '{normalized_host}' resolves to disallowed address {ip_str}"
            )
```

- `127.0.0.1` **不在** `_BLOCKED_HOSTS`，但它是字面 IP，`_resolve_addresses` 直接返回 `["127.0.0.1"]`（`url_guard.py:120-123`），`_is_unsafe_ip("127.0.0.1")` 因 `ip.is_loopback` 为真而返回 True（`url_guard.py:142-162`），于是抛 `host '127.0.0.1' resolves to disallowed address 127.0.0.1`。

**结论**：`localhost` 与 `127.0.0.1` 都会被拒，但走的是**不同分支、不同报错**。round-1 的全部论证与验证只围绕路径①（`localhost` 黑名单），**从未真正验证过路径②（`127.0.0.1`）**——而打包桌面端的 origin 恰恰是 `127.0.0.1`。

### 3.2 round-1 修复**已进 bundle**，所以这不是「打包没带上修复」这么简单

为排除「打包用了旧 bundle」的可能，逐项核对：

- 源码侧修复在位：`src/components/video/lib/selectPlaybackUrl.ts:193-217`，导出分支直接 `return directLocal`，不再 `toAbsolutePlaybackUrl`。
- **构建产物侧也在位**：反编译打包 bundle 的同一函数（minified `U`）：

`desktop/build/frontend/.next/static/chunks/app/page-*.js`（构建于 06-11 11:25，**晚于** `59a4ab6` 提交时间 10:43）
```js
function U(e){ ...
  let d = [e.metadata?.localResolvedUrl, e.localResolvedUrl, e.cacheUrl, e.url, e.serverUrl].find(V) ?? void 0;
  if("export"===l){
    if(d) return d;                              // ← 导出分支：原样返回 d，未经 A()=toAbsolutePlaybackUrl
    let t=[e.localResolvedUrl,e.cacheUrl,e.url,e.serverUrl].find(e=>z(e));
    return t || [e.serverUrl,e.url].find(...) || ""
  }
  if(d) return A(d) ?? d;                        // ← 预览分支：仍 A() 绝对化
  ...
}
```
（`V` = `_isDirectUploadStorageReference`，`z` = `isLocalMediaReference`，`A` = `toAbsolutePlaybackUrl`，`R` = `_pathname`。）

即**打包 bundle 已含 round-1 修复**：导出分支不再自行绝对化。所以失败不是「修复没打进去」，而是**修复本身没堵住绝对引用从素材字段“原样穿透”到请求体**（§3.3）。

> 备注（可能的次要触发）：若用户实际安装/运行的是 **早于 11:25 的旧安装包**（旧 bundle 仍含绝对化逻辑），那也会失败，但报错同为路径②（`127.0.0.1 resolves to disallowed`）。无论旧包还是新包，§3.3 的「请求体含 loopback 绝对 URL → 路径② 被拒」这一根因都成立；只是绝对 URL 的来源不同（旧包来自 `selectPlaybackUrl` 自身绝对化，新包来自素材字段已是绝对值）。修复应对**两者都生效**，故应面向「请求体不变量」而非某一处。

### 3.3 真正缺陷：导出分支**原样回传素材字段**，而判定函数对绝对 loopback URL 也成立

导出分支取的 `d`（directLocal）是「素材若干字段里**第一个**命中 `_isDirectUploadStorageReference` 的原值」：

`src/components/video/lib/selectPlaybackUrl.ts:162-171`
```ts
function _directLocalStorageCandidate(m: PlaybackInput): string | undefined {
  const candidates = [
    m.metadata?.localResolvedUrl,   // ← 第一顺位
    m.localResolvedUrl, m.cacheUrl, m.url, m.serverUrl,
  ];
  return candidates.find(_isDirectUploadStorageReference) ?? undefined;  // ← 返回“原值”，可能是绝对 URL
}
```

而 `_isDirectUploadStorageReference` / `isLocalMediaReference` 在比对前缀前**先用 `_pathname` 剥掉 host**，因此**绝对 loopback URL 同样判定为 true**：

`src/components/video/lib/selectPlaybackUrl.ts:146-160`
```ts
function _pathname(u): string {            // http(s)://host/path → /path
  if (!/^https?:\/\//i.test(u)) return u;
  try { return new URL(u).pathname; } catch { return u; }
}
function _isDirectUploadStorageReference(u): boolean {
  const path = _pathname(u);               // ← 先剥 host
  if (!path || path.startsWith(CACHED_MATERIALS_PATH)) return false;
  return DIRECT_UPLOAD_PREFIXES.some(prefix => path.startsWith(prefix));  // ← 绝对/相对都命中
}
```
`isLocalMediaReference`（`:125-139`）更是显式对 `http://localhost|127.0.0.1|::1/...` 返回 true。

**因此**：当某素材字段已是绝对 `http://127.0.0.1:18320/api/storage/files/video/...` 时，`find` 返回的就是这条**绝对 URL**，导出分支 `if(d) return d` 原样回传 → 进入合成请求 `video_items[].url`（`useVideoExport.ts:278,313-339`）→ 后端路径② 拒绝。round-1「保持相对」的承诺**只对“字段本身是相对值”的素材成立**；对“字段本身已是绝对值”的素材完全失效。

### 3.4 绝对同源引用从哪来？（编辑器日常就会产生，且与 origin 绑定）

**(a) 剪辑/切片导出会把“绝对预览 URL”回写进素材 `metadata.localResolvedUrl`。** 这是最直接的来源：

`src/components/video/components/VideoCutModal/VideoCutModal.tsx:72-88`
```ts
const resolvedPlayback = useMemo(() => resolveSequencePlaybackUrl(...), [...]);
const videoSource = resolvedPlayback?.url || material?.url || '';     // ← 绝对 URL
```
`resolveSequencePlaybackUrl` 内部用 `toAbsolutePlaybackUrl` 产出**绝对** URL（`src/components/video/lib/resolveSequencePlaybackUrl.ts:138,152`）。随后：

`src/components/video/components/VideoCutModal/VideoCutModal.tsx:301-308`
```ts
onExportClips(clips, {
  ...material,
  metadata: { ...material.metadata, localResolvedUrl: videoSource },  // ← 绝对 URL 写回素材
});
```
同样的回写也在 `src/components/video/VideoEditingInterface.tsx:1327`（`localResolvedUrl: cutClip.video_url`）。
此后该素材导出时，`_directLocalStorageCandidate` 的**第一顺位**就是这条绝对 `metadata.localResolvedUrl` → 原样发出。打包端即 `http://127.0.0.1:18320/...`。

**(b) 持久化项目原样保存素材字段，绝对值跨会话存活。** 自动保存的归一化函数**不做相对化**，只剥内联 `data:` 缩略图与瞬时标志位：

`src/lib/api/videoProjects.ts:245-285`（`normaliseProjectDataForSave`）——`out.materials` 仅经 `stripInlineThumbnails`，`url/serverUrl/cacheUrl/metadata.localResolvedUrl` **原样落库**。
因此一旦某素材字段被 (a) 或历史构建写成绝对 URL，保存→重载后仍是绝对，导出继续踩坑。

> 为什么「dev 正常、打包失败」？round-1 的修复验证用的是「刚上传、字段全为相对」的素材（`createLocalMaterialFromUpload` 把 `url/serverUrl/cacheUrl/localResolvedUrl` 全设为相对 `/api/storage/files/...`，`src/components/video/lib/localMaterial.ts:130-140`），此时 §3.3 的缺陷不触发，于是 dev「看起来好了」。一旦走 (a)/(b) 产生绝对字段，**dev 同样会失败（报 localhost），只是用户在 dev 没走到那一步**；而打包端因 origin 是 `127.0.0.1`、且用户的真实工程通常带剪辑/持久化素材，更容易稳定踩中——表现为「dev 正常、打包失败」。

### 3.5 后端「前门」与「逐片解析器」依旧自相矛盾（与 round-1 §3.2 同源）

后端逐片解析早已把 loopback 同源 URL 视为本地引用并剥掉 host：

`backend-services/basic-service/app/services/local_media_resolver.py:43,91-95`
```python
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}
if scheme in {"http", "https"}:
    host = (parsed.hostname or "").lower()
    if host in LOCAL_HOSTS:
        return unquote(parsed.path), False    # ← 视为本地路径，剥 host/port
    return raw, True
```

即：**只要请求能越过 `_guard_request_urls`，后续解析完全能把 `http://127.0.0.1:18320/api/storage/files/...` 正确还原为本地文件**。前门（`_guard_request_urls`）比后门（`_normalize_reference`）更严——前者把 loopback 同源本地引用一刀切当外网 SSRF 拒掉，后者却接受。这是 round-1 已指出、本轮在 `127.0.0.1` 维度再次成立的同一矛盾。

---

## 4. 影响面（Impact surface）

- **受影响功能**：**打包桌面端**下的视频导出（合成）。
- **受影响素材**：任何在导出时其 `metadata.localResolvedUrl / localResolvedUrl / cacheUrl / url / serverUrl` 中**已是绝对同源 URL** 的素材，典型来源：
  - 经「剪辑素材 / 切片」导出回写过 `localResolvedUrl` 的视频（§3.4-a）；
  - 来自**已保存项目**（持久化原样保留绝对字段，§3.4-b）；
  - 任何历史构建/旧安装包遗留的绝对引用。
- **触发范围**：打包端 origin 恒为 `127.0.0.1`，命中路径②；**只要请求体里出现一条 loopback 绝对 URL，整次导出即被拒**（守卫遍历 `video_items → audio_items → image_items`，遇首条非法 URL 即抛出，`video_composition_service.py:1560-1576`）。
- **dev 不受影响的边界**：仅当用户在 dev 全程使用「刚上传的相对字段素材」导出；一旦在 dev 也走剪辑/重载，同样会复现（报 `localhost`）。
- **不受影响**：纯远程素材（公网 CDN URL，能正常通过 SSRF 校验）；预览/波形链路（`purpose:'preview'`，不经此请求守卫）。

---

## 5. 候选修复方案（Candidate fixes，对比）

> 本节只做方案设计，不落代码。修复落地见 Subtask #2。
> 关键判断：真正要守的**不变量**是「**导出请求体里不得出现 loopback 绝对 URL**」。round-1 只做到「`selectPlaybackUrl` 不主动绝对化」，没守住这个不变量。

| 方案 | 改动点 | 思路 | 侵入性 | 风险 | 工作量 | 是否真正闭合不变量 |
|---|---|---|---|---|---|---|
| **A. 前端：导出引用强制相对化（剥 loopback/同源 origin）** | `src/components/video/lib/selectPlaybackUrl.ts` 导出分支两处返回值（`directLocal` 与 `isLocalMediaReference` 支）外包一层 `stripLocalOrigin()`：对 `http(s)://{localhost,127.0.0.1,::1}/<本地前缀>` 及同源绝对 URL 返回其 `pathname(+query)`；同步更新单测 | 不论素材字段是相对还是已绝对，导出一律落到相对 `/api/storage/files/...`，后端 `_guard_request_urls` 因非 `http(s)://` 跳过，逐片解析正常落地 | 小（1 文件 + 单测） | 低：导出请求体 URL 是后端消费的数据，相对正是后端期望（round-1 §7.3 已证相对可解析） | 小 | ✅ 同时闭合 localhost 与 127.0.0.1，且对“字段已绝对”的素材也生效 |
| **B. 后端：`_guard_request_urls` 放行 loopback 同源本地引用**（= round-1 Plan B） | `backend-services/basic-service/app/services/video_composition_service.py:1560-1576` | 校验前判断：`http(s)://` 且 host ∈ {localhost,127.0.0.1,::1} 且 path 命中本地媒体前缀 → 跳过 `validate_external_url`，交由 `_convert_url_to_local_path`/`resolve_media_reference`（其已剥 origin、仍走 `validate_local_path_for_ffmpeg` 容器化） | 中（触及 SSRF 安全代码，仅新增窄豁免） | 低-中：须严格限定「loopback host + 已知本地前缀」、不发网络请求；与 `_normalize_reference:91-95` 既有信任判定一致，不降低安全姿态 | 小-中 | ✅ 同时闭合两者，并消除前门/解析器自相矛盾（§3.5） |
| **C. 前端：剪辑导出不再回写绝对 `localResolvedUrl`** | `VideoCutModal.tsx:306`、`VideoEditingInterface.tsx:1327` 改为写**相对**引用 | 从「源头」之一切断绝对值注入 | 小 | 中：只堵住剪辑这一条来源，持久化遗留/旧包/其他来源仍可注入绝对值 | 小 | ❌ 只治一处来源，不闭合不变量 |
| **D. 仅重新打包/重装桌面端** | 构建发布流程 | 确保安装包含最新 bundle | 极小 | —— | 极小 | ❌ 仅当用户跑的是旧包才有用；对「新包 + 绝对字段素材」的路径② 仍失败 |
| **E. 配置 `URL_GUARD_ALLOW_PRIVATE=1`** | 桌面 `.env` | 打开私网 IP 旁路 | 极小 | 中 | 极小 | ⚠️ 对 `127.0.0.1` **能**放行（路径② 受 `_allow_private_override()` 控制，`url_guard.py:219`），但对 `localhost`（路径①黑名单，`:214` 无条件先于旁路）**无效**；且等于在桌面端整体关闭私网 SSRF 防护，过宽。不推荐单独采用 |

---

## 6. 推荐方案（Recommended fix）

**推荐：方案 A（前端导出强制相对化）为主修复 + 方案 B（后端 loopback 同源豁免）作纵深防御；C 可作为可选清理；D 视用户实际安装包补做；E 排除。**

理由：

1. **A 直接守住正确的不变量，且最小、最安全。** 本 bug 的本质是「导出请求体里出现了 loopback 绝对 URL」，而非「某一处绝对化没去掉」。A 在**唯一构造导出 URL 的事实源**（`selectPlaybackUrl` 导出分支）把任何 loopback/同源绝对引用统一相对化，使「不论素材字段是相对还是已被 (a)/(b) 写成绝对，导出都不含 origin」。这同时覆盖 `localhost` 与 `127.0.0.1`，也覆盖「旧包自身绝对化」与「新包字段已绝对」两种来源——是对 round-1 Plan A 的**正确补全**（round-1 做了「不主动绝对化」，A 再加「主动去 origin」）。后端用自身文件系统根解析相对路径，round-1 §7.3 已证 `/api/storage/files/...` 经 `_resolve_route_path` 正常落地并仍走容器化校验。

2. **B 让后端前门与其逐片解析器自洽（§3.5），是合理的纵深防御。** 即便将来任何调用方再次发出 loopback 同源绝对 URL，也不会在前门被一刀切拒掉。豁免范围严格限定「loopback host + 已知本地前缀 + 不发网络请求 + 仍走 `validate_local_path_for_ffmpeg`」，与 `_normalize_reference:91-95` 既有信任一致，不降低安全姿态。A+B 形成「前端不发绝对 + 后端即便收到也安全」的双保险。

3. **C 仅作可选清理。** 把剪辑导出回写的 `localResolvedUrl` 改成相对，能从一处源头减少绝对值注入，但**不闭合不变量**（持久化遗留、旧安装包、其它来源仍可注入），故不作为单独修复，只作 A 的补充收敛。

4. **D 按需补做。** 若确认用户跑的是 11:25 之前的旧安装包，需重打包/重装；但这对「新包 + 绝对字段素材」的路径② 无效，**不能替代 A**。

5. **E 排除。** `URL_GUARD_ALLOW_PRIVATE=1` 对 `localhost`（路径①）无效、对 `127.0.0.1`（路径②）虽能放行但等于在桌面端整体关闭私网 SSRF 防护，过宽且误导，不单独采用。

> 给下游修复节点（Subtask #2）的最小落地建议：
> - [ ] 实施 **A**：在 `selectPlaybackUrl.ts` 导出分支两处返回值（`:202-203` directLocal 支、`:206-211` isLocalMediaReference 支）外包 `stripLocalOrigin()`，对 loopback/同源绝对本地引用返回 `pathname(+query)`；更新 `__tests__/selectPlaybackUrl.test.ts` 相关断言；新增「字段为绝对 `http://127.0.0.1:PORT/api/storage/files/...` → 导出返回相对」的回归用例（**必须先写这条能复现的失败用例**）。
> - [ ] 叠加 **B**：在 `video_composition_service.py:1560-1576` 的 URL 遍历里，对 `http(s)://{localhost,127.0.0.1,::1}/<本地前缀>` 跳过 `validate_external_url`，交逐片解析。
> - [ ] 验证：`npm run type-check` 通过；上述 vitest 绿；按 §2.3 直打后端确认 `127.0.0.1` 绝对 URL 不再被拒；**重打包桌面端**后按 §2.2 手动导出一次（含剪辑/重载素材）确认成功。
> - [ ] C 可选；D 视安装包实际版本；E 不采用。

---

## 附：关键证据索引（file:line）

- 打包/开发 origin 差异：`desktop/main/index.js:18-19,153,326,368`、`desktop/scripts/dev.js:37-39`、`desktop/main/config.js:9-10`、`desktop/main/frontendService.js:27,30`
- 后端两条拒绝路径：`backend-services/basic-service/app/security/url_guard.py:60-73`（黑名单）、`:142-162`（`_is_unsafe_ip` loopback）、`:213-224`（先黑名单后 IP 判定）、`:90-107`（`_allow_private_override`）
- 守卫入口对 `http(s)` 一律外网校验：`backend-services/basic-service/app/services/video_composition_service.py:1560-1576`、`:723-733`
- round-1 修复已进 bundle（导出分支不绝对化）：源码 `src/components/video/lib/selectPlaybackUrl.ts:193-217`；构建产物 `desktop/build/frontend/.next/static/chunks/app/page-*.js`（minified `U`，`"export"===l` 分支 `if(d)return d`）
- 导出分支原样回传素材字段、判定函数对绝对 loopback URL 也成立：`src/components/video/lib/selectPlaybackUrl.ts:146-160,162-171,125-139`、`useVideoExport.ts:278,313-339`
- 绝对引用来源（剪辑导出回写）：`src/components/video/components/VideoCutModal/VideoCutModal.tsx:72-88,301-308`、`src/components/video/lib/resolveSequencePlaybackUrl.ts:138,152`、`src/components/video/VideoEditingInterface.tsx:1327`
- 持久化原样保存素材字段：`src/lib/api/videoProjects.ts:245-285`
- 刚上传素材字段为相对（dev 恰好不触发）：`src/components/video/lib/localMaterial.ts:91-93,130-140`
- 后端逐片解析早已剥 loopback origin（前门/解析器矛盾）：`backend-services/basic-service/app/services/local_media_resolver.py:43,91-95`
- 同事件 dev 后端日志（路径①，localhost）：`desktop/logs/backend.log:6309,6322-6324`（`2026-06-11 10:12:55`，taskId `export_task-1780980464716-video-iw60lvx6k_…`，与 round-1 报告 `task-1780980464716-video-iw60lvx6k` 逐字匹配）

---

## 7. 一句话根因（TL;DR）

打包桌面端把前端跑在 `http://127.0.0.1:PORT`（`index.js:153/368`），而 round-1 的「保持相对」修复**只阻止 `selectPlaybackUrl` 自己绝对化、却原样回传素材字段**；编辑器在剪辑导出回写（`VideoCutModal.tsx:306`）、持久化项目等场景会把**绝对同源 URL** 存进素材字段，于是导出请求体出现 `http://127.0.0.1:PORT/api/storage/files/...`，命中后端 `validate_external_url` 的 **`_is_unsafe_ip` loopback 分支**（`url_guard.py:219-224`，与 dev 的 `localhost` 黑名单分支不同），报 `host '127.0.0.1' resolves to disallowed address 127.0.0.1`。修复应守住「导出请求体不含 loopback 绝对 URL」这一不变量：前端导出引用强制相对化（A）+ 后端 loopback 同源豁免（B）。

---

## 评审结论（Review Verdict）

> 评审节点：Subtask #1（分析报告评审与修复）。本节由资深评审逐条核验 §3 根因证据与 §5/§6 候选方案后写入，**新增了原报告缺失的两条关键证据**（音频路径未被 Plan A 覆盖、Plan B 端到端安全性证明），并据此**收敛唯一推荐修复**。本节点不写修复代码、不提交 git。

### A. 根因证据复核：成立（逐条已对照源码核验）

| 报告断言 | 核验结果 | 实测 file:line |
|---|---|---|
| 后端两条独立拒绝路径，`127.0.0.1` 走 `_is_unsafe_ip` loopback（路径②），`localhost` 走黑名单（路径①） | ✅ 属实。`_BLOCKED_HOSTS` 含 `localhost` 不含 `127.0.0.1`；字面 IP 在 `_resolve_addresses` 短路返回自身；`_is_unsafe_ip` 因 `ip.is_loopback` 为真 | `url_guard.py:60-73`、`:120-123`、`:142-162`、`:213-224` |
| 路径②受 `_allow_private_override()` 控制、路径①无条件先于旁路 | ✅ 属实。黑名单判定（`:214`）在 `if not _allow_private_override()`（`:219`）之前，无条件执行 | `url_guard.py:214,219` |
| 守卫入口对任何 `http(s)://` URL 一律 `validate_external_url`，遍历 video/audio/image 三个数组 | ✅ 属实 | `video_composition_service.py:1560-1568` |
| 导出分支 `if (directLocal) return directLocal` 原样回传素材字段（可能是绝对 URL） | ✅ 属实。导出分支共两处返回原值：`directLocal` 支与 `isLocalMediaReference` 支 | `selectPlaybackUrl.ts:202-204`、`:206-211` |
| `_isDirectUploadStorageReference` / `isLocalMediaReference` 对绝对 loopback URL 也判 true（`_pathname` 先剥 host；`isLocalMediaReference` 显式认 `localhost/127.0.0.1/::1`） | ✅ 属实 | `selectPlaybackUrl.ts:146-160,162-171,125-139` |
| 剪辑导出把**绝对**预览 URL 回写进 `metadata.localResolvedUrl` | ✅ 属实。`videoSource = resolvedPlayback?.url`（经 `toAbsolutePlaybackUrl` 绝对化），写回 `metadata.localResolvedUrl` | `VideoCutModal.tsx:72-88,301-308`、`resolveSequencePlaybackUrl.ts:138,152`；第二来源 `VideoEditingInterface.tsx:1327`（`localResolvedUrl: cutClip.video_url`） |
| 刚上传素材字段全为相对（dev 恰好不触发） | ✅ 属实。`url/serverUrl/cacheUrl/metadata.localResolvedUrl/originalUrl` 全 = 经 `isDirectUploadStoragePath` 校验过的相对 `localUrl` | `localMaterial.ts:99-144` |
| 持久化原样保存素材字段、不相对化 | ✅ 属实。`normaliseProjectDataForSave` 仅 `stripInlineThumbnails`，URL 字段原样落库 | `videoProjects.ts:245-285` |
| 后端逐片解析早已剥 loopback host（前门/解析器矛盾，§3.5） | ✅ 属实 | `local_media_resolver.py:43,91-95` |
| 打包 origin = `http://127.0.0.1:PORT` | ✅ 属实 | `desktop/main/index.js:153` |
| round-1（`59a4ab6`）「必要但不充分」 | ✅ 属实。**佐证**：`59a4ab6` 提交信息**自称**「fixes both the localhost and 127.0.0.1 loopback origins」，但其改动只删了 `selectPlaybackUrl` 自身的绝对化（12 行），并未处理「素材字段本就是绝对值」的穿透——正是本轮失败的原因 | `git show 59a4ab6` |

**结论**：§3 的根因链（绝对 loopback URL 经素材字段穿透 → 导出请求体 → 后端路径② 拒绝）证据充分、可复现，无反例。§2.3 的最小复现与「相对则放行」的反向验证逻辑成立（守卫只校验 `http(s)://` 开头串，`video_composition_service.py:1566`）。

### B. 评审补充证据①：Plan A（仅改 `selectPlaybackUrl.ts`）**未覆盖 `audio_items`**（原报告遗漏）

后端守卫 `_guard_request_urls` 遍历 **video + audio + image 三个数组**（`video_composition_service.py:1560`），因此「请求体不含 loopback 绝对 URL」这一不变量必须对**三者同时成立**。但前端导出请求体的三类 url 由**不同构造器**产生：

- **video_items**：`selectPlaybackUrl(material, { purpose:'export' })` —— `useVideoExport.ts:278`；
- **image_items**（图片在视频轨/图片轨）：`selectPlaybackUrl(material, { purpose:'export' })` —— `useVideoExport.ts:230`；
- **audio_items**：`selectAudioPlaybackUrl(material)` —— `useVideoExport.ts:354`，**根本不经过 `selectPlaybackUrl`**。

`selectAudioPlaybackUrl`（`src/lib/utils/audioUrl.ts:19-38`）按 `LocalAudioManager blob → serverUrl → metadata.originalUrl → url(非 blob)` 取值，**全程不调 `toAbsolutePlaybackUrl`**。因此：

- **当下不会复现**：常规上传音频的 `serverUrl/originalUrl/url` 均为相对（`localMaterial.ts:131,141`），`useVideoExport.ts:355` 又会拒掉 blob 回退到相对 `serverUrl`，故 audio 现状是「凑巧相对」而非「被设计守住」。
- **但 §5 Plan A 把修复包在 `selectPlaybackUrl` 导出分支里时，对 audio_items 完全无效**：一旦将来出现绝对 loopback 的音频 `serverUrl/originalUrl`（持久化遗留、未来新增音频剪辑/回写、或任何把同源绝对值写进音频字段的流程），audio_items 会再次触发路径②，而 Plan A 不会拦下。

**推论**：§6 把 Plan A 列为「主修复」、Plan B 列为「可选纵深防御」的定级**偏低估了 B**。若坚持 Plan A 为前端唯一闭合层，**必须把相对化扩展到音频 url**（最简做法：在 `useVideoExport.ts` 这个三数组唯一汇聚点，对 `videoUrl / audioUrl / imageUrl` 统一套一层 `stripLocalOrigin()`，而非只改 `selectPlaybackUrl`）。

### C. 评审补充证据②：Plan B 的 loopback 同源豁免**端到端安全**（原报告未给完整证明链）

Plan B 的安全性关键在于：前门跳过 `validate_external_url` 后，loopback 同源 URL 是否仍受**容器化**约束、traversal 能否被拦。逐环核验如下：

1. 前门本就**把本地引用「延后」给逐片解析**（相对 `/api/storage/files/...` 早已走这条路），docstring 明示：`video_composition_service.py:1554-1556`。
2. 三类 item 均调 `_convert_url_to_local_path`：video `:1731`、audio `:1839,1967`、image `:2310,2459`。
3. `_convert_url_to_local_path` → `resolve_media_reference(url, allow_remote=False)`：`video_composition_service.py:1613`。
4. `_normalize_reference` 对 `http(s)://{localhost,127.0.0.1,::1}/...` 返回 `(parsed.path, is_remote=False)`，**剥掉 host/port**：`local_media_resolver.py:91-95`。
5. path 以 `/` 开头 → `_resolve_route_path` → **`validate_local_path_for_ffmpeg(candidate, [candidate_root])`** 解析符号链接并断言 `is_relative_to(candidate_root)`：`local_media_resolver.py:108-115`、`url_guard.py:282-317`。

因此 Plan B 只要把豁免**严格限定为「host ∈ {localhost,127.0.0.1,::1} 且 pathname 命中已知本地前缀」**，则：

- `http://127.0.0.1/api/storage/files/../../etc/passwd` → 第 4 步剥 host 后 path 仍带 `../../`，第 5 步 `validate_local_path_for_ffmpeg` 容器化校验**拒绝越界**；
- `http://127.0.0.1/admin`（非本地前缀）→ **不命中豁免**，仍走 `validate_external_url` → 路径② 拒绝；
- 非 loopback 私网 IP（如 `http://10.0.0.5/...`）→ **不命中豁免**，私网 SSRF 防护**不受影响**。

**结论**：Plan B **不降低安全姿态**，且让前门与「早已信任 loopback 本地引用」的解析器（§3.5）自洽。原报告对 B「低-中风险」的定性**偏保守**——在「严格限定 host+前缀、不发网络请求、仍走 `validate_local_path_for_ffmpeg`」三条约束下，B 的实际新增攻击面为零。

### D. 候选方案边界复核

- **C（剪辑回写改相对）**：✅ 同意「只治一处来源、不闭合不变量」。仅作可选清理。
- **D（重打包/重装）**：✅ 同意「仅对旧包有用，对『新包 + 绝对字段素材』的路径② 无效」。§3.2 已用 bundle 时间戳论证新包仍失败；**该证据非本修复的承重点**，无需为它阻塞修复。
- **E（`URL_GUARD_ALLOW_PRIVATE=1`）**：✅ 同意排除。核验属实：该旁路在 `url_guard.py:219` 仅作用于路径②，对路径① 黑名单（`:214`，无条件先行）**无效**；且等于整体关闭桌面端私网 SSRF 防护，过宽。

### E. 最终推荐修复（Final Recommended Fix）

**推荐：实施 Plan B（后端 loopback 同源豁免）作为不变量的权威闭合层（必做、非可选）+ Plan A（前端导出引用强制相对化）作为前端最小卫生与降爆破面（建议做，且须扩展到音频 url）。二者互补，建议在 Subtask #2 一次性提交。**

定级相对原报告的修正：**把 B 从「可选纵深防御」上调为「承重层」**；A 仍保留，但**必须补齐 audio 路径**才能独立成立。

理由（单一推荐的取舍逻辑）：

1. **B 是唯一在单一收口处同时守住 video/audio/image 三数组的不变量闭合层。** 不变量「请求体不含被误判为 SSRF 的 loopback 绝对本地引用」必须对三数组同时成立；而前端有 ≥2 个互不相干的 url 构造器（`selectPlaybackUrl` 管 video/image，`selectAudioPlaybackUrl` 管 audio，见 §B），靠前端逐个守需要永久保持同步，Plan A 当前就漏了 audio。B 落在三数组唯一必经的后端前门 `_guard_request_urls`，一处豁免覆盖全部当前与未来调用方——**是更小、更完整的改动**。
2. **B 已证端到端安全且消除前门/解析器自相矛盾（§C、§3.5）。** 严格限定「loopback host + 已知本地前缀」后，traversal 与非本地路径仍被拦，私网 SSRF 防护不变；并使前门与早已剥 loopback host 的逐片解析器一致。
3. **A 仍建议同提交，但定位为前端卫生而非唯一闭合层。** A 在源头（导出请求构造）就不发 loopback 绝对 URL，能修掉**当下可复现的主因（视频经 `VideoCutModal.tsx:306` 回写）**、保持请求体干净/所见即所得、并降低对后端豁免的依赖；落地时应在 `useVideoExport.ts` 的三数组汇聚点对 `videoUrl/audioUrl/imageUrl` 统一 `stripLocalOrigin()`（覆盖 audio），而非仅包在 `selectPlaybackUrl` 导出分支内。
4. **C 可选清理；D 视用户实际安装包；E 排除。**（同 §D。）

> 给 Subtask #2 的最小落地清单（按本评审收敛）：
> - [ ] **B（必做）**：在 `video_composition_service.py:1560-1576` 的 url 遍历里，对 `http(s)://` 且 `host ∈ {localhost,127.0.0.1,::1}` 且 `pathname` 命中本地媒体前缀（与 `local_media_resolver.ROUTE_PREFIXES` / `selectPlaybackUrl.LOCAL_MEDIA_PATH_PREFIXES` 对齐）的 url **跳过 `validate_external_url`、`continue`**，交逐片解析（其已剥 host + `validate_local_path_for_ffmpeg` 容器化）。其余 `http(s)://` 维持原校验。**先写一条能复现的失败用例**：构造 `audio_items[0].url = http://127.0.0.1:PORT/api/storage/files/audio/...` 的请求，断言豁免前被拒、豁免后放行且 traversal 仍拒。
> - [ ] **A（建议、须含 audio）**：在 `useVideoExport.ts` 对 `videoUrl/audioUrl/imageUrl` 统一套 `stripLocalOrigin()`（对 `http(s)://{localhost,127.0.0.1,::1}/<本地前缀>` 及同源绝对 URL 返回 `pathname(+query)`，其余原样）；同步更新 `selectPlaybackUrl.test.ts` 并新增「字段为绝对 `http://127.0.0.1:PORT/api/storage/files/...` → 导出返回相对」「audio serverUrl 为绝对 loopback → 导出返回相对」回归用例。
> - [ ] 验证：`npm run type-check` 通过；相关 vitest 绿；后端针对 `127.0.0.1` 绝对 url（video **与 audio** 各一）确认放行、traversal 用例确认仍拒；**重打包桌面端**后按 §2.2 手动导出一次（含剪辑/重载素材）确认成功。
> - [ ] C 可选；D 视安装包；E 不采用。

**Definition of Done 对照**：根因证据链已逐条对照源码核验并补齐 audio 缺口与 B 安全性证明（§A–§C），证据闭合；本节已给出**单一承重推荐 = Plan B（必做）+ Plan A（含 audio，建议同提交）**，并附明确理由与可执行清单。
