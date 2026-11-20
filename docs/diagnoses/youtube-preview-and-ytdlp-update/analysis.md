# YouTube 预览失败与 yt-dlp 更新能力缺失：诊断报告

诊断日期：2026-11-20。范围：任务节点 #0「问题定位与分析」。
本次只新增诊断文档及复现脚本，未修改生产代码，未执行 git commit。
工作区原有的 SkillRouter 等未提交改动不属于本次诊断。

评审日期：2026-11-20。节点 #1 仅修改本文，复核结果及对推荐方案的约束见
第 7 节和末尾「评审结论」。前六节的“本次”指节点 #0 的诊断，复跑差异另列。

## 1. 问题描述（Problem description）

用户要求：完善 YouTube 视频库的搜索、下载和应用内预览；自动检查并更新
yt-dlp；在设置中展示实际使用版本和最近更新情况；提示用户确保网络能够
连接 YouTube；最终在软件内完成真实下载的端到端验收。

当前结果分为三组：

| 问题 | 结论 | 证据等级 |
| --- | --- | --- |
| 自动更新及设置中的版本、更新记录 | 尚未实现，只有构建时安装和后端版本查询 | 源码确认 |
| 当前网络下的真实视频解析 | 现有桌面包中的 2026.10.26 也返回反机器人登录提示；改用库默认客户端后仍失败 | 真实联网复现 |
| 无合流格式时的预览、下载 | 预览必定返回 502；下载的 `best/worst` 无法选择分离的音视频 | 确定性离线复现 |

**不能把这些问题归结为同一个“包太旧”问题。** 本机查询 PyPI 得到的发布
版本也是 2026.10.26，而使用该版本仍复现视频解析失败。网络基础可达、包可导入、
视频可抽取、媒体可下载、播放器可播放，是不同的验证层级。

已读取 `README.md`、`CLAUDE.md`、`.claude-index/index.md` 及当前任务看板。
共享黑板 F-1～F-3 属于之前的 TTS 任务，不作为本次 YouTube 问题的证据。
历史方案 `docs/plans/youtube-preview-stream-proxy/spec.md` 描述的 iframe
问题已经有实现，当前诊断以磁盘上的代码和本次实验为准。

## 2. 复现步骤（Reproduction steps）

### 2.1 环境与前置条件

以下命令均在 PowerShell 中执行，起始目录为仓库根目录：

```powershell
Set-Location 'M:/takoAI/Ecliptrix'
python -X utf8 -c "import sys,yt_dlp; print(sys.version); print(yt_dlp.version.__version__); print(yt_dlp.__file__)"
```

本次开发解释器为 Python 3.11.7，导入用户目录中的 yt-dlp 2026.08.19。
现有 `desktop/release/win-unpacked/resources/python/python.exe` 是 Python
3.11.9，其自带 yt-dlp 为 2026.10.26。两者都不是待修复后新构建的产物。

离线脚本依赖项目现有后端依赖：FastAPI、httpx、yt-dlp 等。若依赖不齐，先按
README 在项目环境安装 `backend-services/basic-service/requirements.txt`。
脚本自动定位后端，不需要修改 PYTHONPATH，也不需要启动前后端服务。

### 2.2 最小离线复现：有音视频，但没有合流格式

```powershell
python -X utf8 docs/diagnoses/youtube-preview-and-ytdlp-update/repro.py
```

脚本只替换外部 `YoutubeDL.extract_info` 边界，返回一个视频流和一个音频流；
实际执行项目的 FastAPI 路由、预览解析器，以及真实 yt-dlp 的格式选择器。
它不访问 YouTube，不保存媒体，不修改产品实现。

本次输出节选：

```text
"健康检查": {"status": "healthy", "yt_dlp_version": "2026.08.19", ...}
"预览状态码": 502
"detail": "无法解析预览直链: 无可用于内联预览的渐进式合流格式 ..."
"预览强制客户端": ["web", "ios"]
"仅分离音视频时_best_worst_命中数": 0
"仅分离音视频时_bestvideo_bestaudio_命中数": 1
诊断断言全部通过：已复现现有行为，未验证任何修复。
```

本次完整输出保存在同目录的 [offline-output.txt](offline-output.txt)。

这证明：即使 yt-dlp 已导入且已经返回合法的分离音视频，当前预览仍进入失败分支，
下载的最终回退也无法选择该媒体。该格式列表是诊断夹具，**不是**本次线上视频
返回的格式；线上视频在获取格式之前已被反机器人检查阻止。

### 2.3 真实联网复现：使用现有桌面包的解释器

```powershell
& './desktop/release/win-unpacked/resources/python/python.exe' -B -X utf8 './docs/diagnoses/youtube-preview-and-ytdlp-update/live-probe.py' --isolated-user-site
```

脚本从当前仓库 `youtube_service.py` 读取实际 robust 选项，采用当前预览所用
web/ios 客户端；代理取调用环境或后端 `.env` 中的 `YOUTUBE_PROXY`。
`--isolated-user-site` 在子进程禁用用户 site，匹配桌面启动配置的隔离要求。
脚本保留产品的重试等选项，但父进程在 25 秒时终止未完成的诊断子进程。
探测公开短视频 `jNQXAC9IVRw`，仅抽取信息，不下载媒体，不输出签名直链、Cookie
或代理地址。

本次输出：

```text
诊断环境: {"yt_dlp版本": "2026.10.26", "已配置YouTube代理": false,
 "客户端": ["web", "ios"], "显式JS运行时": null}
诊断失败: {"异常类型": "DownloadError", "错误类别": ["sign in"],
 "反机器人提示": true}
诊断进程退出码: 0
```

`反机器人提示=true` 只在异常包含 `sign in to confirm` 时输出。
**退出码 0 表示诊断程序正常记录了结果，不表示视频解析成功。**

只改变客户端选择策略，进行对照：

```powershell
& './desktop/release/win-unpacked/resources/python/python.exe' -B -X utf8 './docs/diagnoses/youtube-preview-and-ytdlp-update/live-probe.py' --isolated-user-site --default-clients
```

本次库默认客户端输出一条 `JavaScript` 类警告，仍得到同样的
`DownloadError / sign in / 反机器人提示=true`。因此，当前网络下单独删除
web/ios 配置也不能解决这次真实失败；不能据此断言某一个客户端就是唯一根因。

使用开发解释器运行同一探测：

```powershell
python -X utf8 docs/diagnoses/youtube-preview-and-ytdlp-update/live-probe.py
```

2026.08.19 在本次 25 秒诊断上限内未完成，子进程已终止。这个上限不是产品的
30 秒路由超时，不能把诊断超时描述成实测到了产品 HTTP 504。

独立网络检查（本次均返回 200）：

```powershell
@'
import httpx
with httpx.Client(timeout=8) as client:
    print('YouTube基础连接', client.get('https://www.youtube.com/robots.txt').status_code)
    response = client.get('https://pypi.org/pypi/yt-dlp/json')
    print('PyPI', response.status_code, response.json()['info']['version'])
'@ | python -X utf8 -
```

观测：YouTube robots.txt 200；PyPI 200、版本 2026.10.26。
robots.txt 可达只证明基础连接，不能证明视频抽取或 googlevideo 媒体传输可用。
上述视频访问失败会受网络出口、时间、视频和平台策略影响；应以复跑结果为准。

### 2.4 现有回归检查

```powershell
Push-Location 'backend-services/basic-service'
python -X utf8 -m pytest tests/test_youtube_preview_stream.py -q --tb=short
Pop-Location
```

本次结果：`14 passed, 26 warnings in 9.40s`。警告为已有 Pydantic / audioop
弃用提示。该测试模块明确替换了 yt-dlp/httpx 外部边界，覆盖 Range、缓存、格式
筛选和失败返回，不是联网端到端测试。

### 2.5 软件内的手工复现入口与验证边界

以下是供修复节点执行的界面步骤；本节点未启动完整桌面应用：

1. 按 README 配好依赖，在仓库根目录执行 `npm --prefix desktop run dev`，
   完成正常的本地设置并打开视频编辑项目。
2. 打开素材搜索，切换「YouTube 视频库」，搜索 `Me at the zoo`，选择相应结果；
   若当前网络阻止搜索，先记录搜索错误，不把它当成预览错误。
3. 查看左栏预览。失败时在网络面板检查
   `/api/youtube/preview-stream?video_id=jNQXAC9IVRw` 的状态及响应体，
   与后端 `/api/youtube/preview/stream` 日志关联。
4. 观察是否显示“该视频无法在此内联预览……在浏览器中打开”。根据当前源码，
   任意媒体加载错误都会触发这一提示。
5. 打开设置的 YouTube 页：当前只有下载、上传、质量、文件管理和日志配置，
   没有 yt-dlp 实际版本、上次检查时间或更新记录。
6. 后续成功验收须勾选搜索结果、确认添加，看到素材完成下载，播放本地素材并将其
   加入时间线；仅搜索有结果或接口返回 200 不算成功。

本次端口检查发现 3000、18320、18321 未监听；8000 上的服务对
`/api/health` 和 `/api/youtube/health` 都返回 404，不是可用于本项目验收的服务。
没有停止该服务，也没有把这些 404 误归因于 YouTube 路由。

本节点完成了真实联网的**信息抽取失败复现**和离线 HTTP 路由复现，未完成
“软件内真实下载并播放成功”的端到端验收；后者必须由实现节点在修复后完成。

## 3. 根因分析（Root cause analysis）

### 3.1 yt-dlp 生命周期管理缺失：确定性功能缺口

- `backend-services/basic-service/requirements.txt:52` 只声明
  `yt-dlp>=2024.9.27`。下限约束不是运行时更新机制。
- `desktop/scripts/prepare-backend.js:137` 在**构建阶段**运行 pip 安装
  requirements；应用使用期间没有对应的检查、安装、切换或记录流程。
- `backend-services/basic-service/app/services/youtube_service.py:14` 直接
  `import yt_dlp`，搜索、信息、下载、预览都绑定当前解释器中已加载的包。
- `backend-services/basic-service/app/routers/youtube_router.py:455` 的
  `youtube_service_health()` 只返回当前模块版本；没有访问 YouTube，也没有检查
  新版本或更新历史。离线复现中它与预览 502 同时出现。
- `src/components/settings/YouTubeSettingsPanel.tsx:28` 只读取通用 youtube
  设置；`:87` 起渲染下载等配置卡片，整个组件没有运行时版本/更新状态请求。

已在 `backend-services/basic-service/app`、`desktop`、`src`、`scripts`
中检索 yt-dlp 引用与安装入口。现有业务调用集中在 youtube_service，pip 安装
集中在 prepare-backend，未找到应用运行时的 yt-dlp 更新服务或状态接口。

更新还必须处理实际解释器边界：
`desktop/main/backendService.js:35` 指定包内 Python，`:66` 禁止用户 site；
`desktop/scripts/prepare-backend.js:109`～`:121` 的 `._pth` 限定导入路径。
因此升级开发机 Python 的包不会升级桌面包；单纯设置 PYTHONPATH 也不能保证
隔离解释器载入新包。正在运行的进程已经缓存模块，写入新文件不会自动切换执行版本。

### 3.2 真实视频解析被平台挑战阻止：本次联网实测的直接失败点

当前调用链：

```text
VideoSearchModal 的 <video>
  → Next /api/youtube/preview-stream
  → FastAPI /api/youtube/preview/stream
  → resolve_preview_stream → yt_dlp.extract_info
  → 选格式 → httpx 获取媒体 → 流式回代
```

本次真实探测在 `extract_info` 阶段返回反机器人登录提示，尚未到达媒体回代。
`youtube_service.py:289`～`:295` 会将这一异常包装为 `YoutubePreviewError`；
`youtube_router.py:348`～`:353` 将其映射为 HTTP 502。
这是本次真实失败与用户“内联预览不可用”现象之间有代码支持的因果链。

不过，本次联网探测直接调用真实 yt-dlp、复用源码选项，没有启动 Next/Electron；
因此未声称观测到了真实桌面请求的 HTTP 502。HTTP 映射已经由离线路由复现验证。

客户端和支持组件还有明确风险：

- `youtube_service.py:173` 强制 android/web/ios，预览在 `:282` 再强制 web/ios，
  绕过了库随版本维护的默认客户端策略。对照实验表明这不是当前失败的唯一解释。
- 隔离运行现有桌面解释器实测：`yt_dlp_ejs` 不可导入，Deno 不在 PATH；
  Node 在本机 PATH，但 yt-dlp 的实际默认配置为 `{'deno': {}}`。
  项目选项没有 `js_runtimes`，也没有显式启用 Node。
- 官方说明 YouTube 抽取需要外部 JS 运行时及挑战脚本；Node 需要显式启用。
  这说明依赖管理必须覆盖这些组件，而不能只管理 yt-dlp 的版本号。
  见 [官方 EJS 配置指南](https://github.com/yt-dlp/yt-dlp/wiki/EJS)。
- 官方说明部分客户端的媒体访问需要 PO Token，缺失可能导致 403，要求随客户端
  而变。见 [官方 PO Token 指南](https://github.com/yt-dlp/yt-dlp/wiki/PO-Token-Guide)。
  **本次没有观测到媒体端 403，也没有证据证明此次登录提示就是缺 PO Token，
  或补齐 EJS 就一定解决。** 两项是需要验证的兼容性条件。

无法从现有证据进一步判定登录挑战的具体触发因素是出口 IP、会话、视频策略还是
客户端组合。报告不把推测写成已证实根因，也不建议反复重试同一被拒请求。

### 3.3 只支持合流格式：独立、可稳定复现的结构性限制

预览的 `_pick_progressive_format()` 在 `youtube_service.py:213`～`:222`
要求同一条格式同时拥有音轨和视频轨。`resolve_preview_stream()` 在
`:302`～`:307` 对没有合流格式的结果直接抛错。

```python
# backend-services/basic-service/app/services/youtube_service.py:213
def _is_progressive(fmt):
    return (
        bool(fmt.get("url"))
        and fmt.get("acodec") not in (None, "none")
        and fmt.get("vcodec") not in (None, "none")
    )
```

下载也没有分离音视频合并路径：`:687`～`:718` 的所有主选择器都是 `best` 或
`worst`；`:760`～`:763` 的最终回退仍为 `best/worst`，没有
`bestvideo+bestaudio`。重复调用这些选择器不会增加对分离格式的支持。
本次用真实选择器确认同一夹具下 `best/worst` 命中 0，而
`bestvideo+bestaudio` 命中 1。仓库已经有 FFmpeg，技术上可以加入合并路径。

这项缺陷独立于版本更新和平台挑战：更新成功、信息抽取成功之后，若只返回分离
格式，仍然会失败。不能证明本次线上短视频实际缺少合流格式，因为格式尚未抽取成功。

### 3.4 前端把不同错误压缩成相同提示，并保留失败状态

`VideoSearchModal.tsx:501`～`:525` 已使用原生同源 `<video>`，因此当前故障
不应再次按“把 iframe 换成 video”修复。

- `:520` 的 `onError` 不读取 HTTP 错误或媒体错误分类，直接设置
  `youtubePreviewError=true`。
- `:473`～`:498` 随后卸载播放器，只展示缩略图和浏览器链接。服务端 502、504、
  网络中断、格式问题都会得到相同结果。
- `:69`～`:71` 仅在 `youtubePreviewVideo?.id` 变化时重置错误；当前界面没有
  同一视频的显式“重试预览”操作。网络恢复后再次点击同一个视频，id 不变，
  不会通过该 effect 清除错误状态。
- `src/lib/i18n.ts:11019` 的网络/代理提示只在失败降级后出现。
  YouTube 页签和搜索区没有用户要求的常驻网络前提提示。

### 3.5 为什么现有检查没有挡住问题

`backend-services/basic-service/tests/test_youtube_preview_stream.py:12`
明确说明外部网络边界被替换；`:137` 对无合流格式返回 None 的测试实际上固定了当前降级行为。
14 项测试通过可以证明局部约定成立，不能证明最新真实平台策略、完整运行时依赖、
桌面包网络出口和真实下载闭环可用。历史日志中的 `abcdefghijk` 也来自测试夹具，
不能当成生产反机器人事件。

## 4. 影响面（Impact surface）

| 功能/用户 | 影响 |
| --- | --- |
| YouTube 搜索用户 | `search_videos()` 在 `youtube_service.py:432` 使用 `extract_flat=True`；搜索元数据成功不代表后续播放器抽取可用 |
| 左侧预览 | 抽取被拒、超时、无合流格式等统一显示浏览器降级；同条视频缺少重试入口 |
| 下载并导入素材 | `get_video_info()` 失败会在 `youtube_service.py:666` 提前返回；仅分离格式时后续下载选择器也可能失败 |
| 下载后的编辑闭环 | `useVideoSearch.ts:546` 调用 download-and-upload；只有返回成功才在 `:571` 更新本地素材 URL 和完成状态，预览流地址不能替代正式素材地址 |
| 已安装桌面包 | 后端使用独立包内 Python，无法依赖用户手工更新系统 Python；长期运行会保留已加载版本 |
| 设置页用户 | 看不到实际执行版本、最近检查/更新结果；当前 healthy 不代表网络或下载已通过 |
| 官方素材库等其他来源 | 没有证据显示由本问题引起；修复应限制在 YouTube 链路及其依赖管理 |

## 5. 候选修复方案（Candidate fixes）

| 方案 | 主要内容 | 侵入程度 | 风险/代价 | 工作量 |
| --- | --- | --- | --- | --- |
| A：受管理的 yt-dlp 运行时 + 保留流代理，补预览/下载回退 | 在用户可写目录维护版本化包与状态；由统一适配器为 YouTube 操作选择版本固定的独立 worker；更新经校验后原子激活；补齐 JS 支持、合并格式回退、错误分类/重试及设置展示 | 中，集中于 YouTube 服务、生命周期和设置/BFF | 要处理更新中断、版本兼容、活动任务及缓存失效；可以回退且不覆盖安装目录 | 中到高，包含真实打包验收 |
| B：当前解释器直接 pip 升级，重启后生效 | 增加后台检查和 pip 更新，沿用进程内 import；另补 UI 和媒体回退 | 低到中 | 安装目录可能不可写；更新失败可能破坏现有环境；已加载模块不切换，重启中断任务。直接写用户目录还要处理 `._pth` | 低到中，但桌面可靠性成本高 |
| C：转为独立 yt-dlp 可执行文件 | 全部 YouTube 调用统一通过受管理 exe，用独立进程切换版本，仍需提供外部 JS 运行时、预览/合并及设置；官方 exe 已带 EJS 脚本 | 高，需要改变四类 Python API 调用与结果解析 | exe 自更新或替换也需可写目录、完整性验证；包体与平台维护增加，不能自动消除平台挑战 | 高 |

三个方案都必须同时覆盖预览、下载、更新可观察性和网络提示；只更新 pip 包或
只调整提示语，均不满足原始需求。不要把“让用户去浏览器看”当作应用内预览成功。

## 6. 推荐方案及理由（Recommended fix）

**推荐 A，分为以下相互衔接的改动。** 保留现有同源 Range 代理和正式素材导入
约定；把易变的 YouTube 抽取依赖与其版本状态集中管理，避免修改整个应用环境。

### 6.1 自动更新与设置状态

1. 在 desktop userData 下使用专用可写目录保存版本化依赖、暂存下载和更新记录，
   与公开文件服务的 `storage` 目录分开，不在安装目录执行 pip 升级。
2. 由单一运行时服务执行兼容性检查、下载、完整性校验、离线导入自检和原子激活。
   来源固定为官方发布源，版本比较使用合法版本解析。校验失败保留旧版本；更新
   记录包含旧/新版本、检查时间、激活时间、结果和可读错误。
3. 启动后异步检查，按保存的检查时间节流，在长期运行时周期检查；发现兼容更新
   自动安装并激活。失败可按退避重试，不阻塞编辑器启动，不反复重启主后端。
4. 由版本固定的独立 worker 完成搜索、信息、预览解析和下载；显式指定导入目录，
   不依赖被 `._pth` 忽略的 PYTHONPATH。活动任务继续用原版本，新任务使用新版本；
   不对多线程运行中的 yt-dlp 做 `importlib.reload()`。
5. 补充只读运行时状态及手工检查接口，新增对应 Next BFF；设置页展示**实际执行
   版本**、可用新版本、最近检查/更新记录、更新中/失败状态。若采用“安装后待生效”
   策略，要明确区分已安装版本和当前执行版本。
6. 更新、代理变更和 worker 切换时使预览签名 URL 缓存失效；并发检查/安装去重，
   异常与代理凭据、签名 URL 分开记录。

接口和状态约束由末尾评审结论确定。包管理可以复用独立解释器 pip
下载到暂存目录或解析 wheel；无论哪种方式都要显式校验并原子切换。
JS 挑战脚本和受支持的 JS 运行时纳入构建/启动检查，避免只保证 `import yt_dlp`
成功。参考 [官方依赖说明](https://github.com/yt-dlp/yt-dlp#dependencies)。

### 6.2 预览与真实下载

1. 对真实短视频先验证库维护的默认客户端及完整 JS 支持；避免长期固定过时
   客户端。对反机器人挑战、需要登录、限流、网络失败分别报告，不承诺更新包就能
   解决平台拒绝。不得通过清除错误提示或无限重试伪造成功。
2. 合流直链继续作为预览快路径；只有可用分离格式时，复用受控下载/FFmpeg 合并
   得到低清本地预览文件，用现有 Range 文件服务播放。并发、超时、取消、大小上限、
   去重和过期清理必须明确；不要把 m3u8 文本当成 mp4 字节返回。
3. 正式下载补充音视频分离格式选择及 FFmpeg 合并；核查输出文件/容器和实际音轨，
   仍经现有 storage/material 流程返回正式本地 URL。前端约定的 mp4 输出需要
   与浏览器可解码的编码组合一致，不能只改后缀。
4. 保留 `Range`、206、缓存失效后重解析、连接清理等现有能力；仅预览 URL
   不进入项目正式素材 URL 或导出请求。
5. 在 YouTube 页签常驻提示：“使用 YouTube 搜索、预览和下载前，请确认当前
   网络环境能够正常连接 YouTube；部分网络可能需要配置可用代理。”
   失败时显示对应错误与同条视频的“重试预览”；更新进行中也给出可读状态。
   `Translations` 接口及中英文值对象三处同步更新。

### 6.3 实现后的验收要求

- 更新使用可控发布元数据/安装夹具验证：有新版本自动激活、无更新、离线、损坏
  下载、安装中断、重复请求、活动下载中升级、重启后记录恢复；确认实际 worker
  版本和设置页一致。不要拿升级开发机包当成桌面更新验收。
- 网络边界回归继续覆盖 206/拖动、缓存、403 重解析和断连；增加分离音视频的
  真实小媒体合并测试、失败后同一视频重试及网络提示展示。
- 使用最终桌面产物，在能访问 YouTube 的环境里完成：真实搜索 → 左栏加载并
  播放/拖动 → 下载添加素材 → 本地文件大小非零、ffprobe 有音轨及视频轨 →
  时间线播放 → 重启后素材仍可用。记录实际包版本、运行时组件、视频 ID、响应
  状态、文件检查和画面证据；同时测试断网/代理失败时可理解的提示与恢复重试。
- 如果平台挑战仍阻止访问，应如实报告该验收项阻塞及实际错误，不能以离线
  14 项单测通过或 robots.txt 返回 200 代替成功验收。

本节点的完成标准已经通过文档、可复制离线复现和真实联网失败证据满足；
产品修复和成功下载的端到端验收属于后续实现节点，尚未完成。

## 7. 评审补证与方案边界审计

### 7.1 引用代码确实处于失败路径，但须限定因果结论

已逐层复核：`VideoSearchModal.tsx:501`～`:525` 发起同源媒体请求，
`src/app/api/youtube/preview-stream/route.ts:21` 起透传到后端；
`backend-services/basic-service/app/main.py:612` 注册 youtube 路由；
`youtube_router.py:338`～`:353` 执行服务解析并把解析错误映射为 502。
`src/lib/api/server/backend-proxy.ts:332`～`:353` 保留该状态及响应体。
因此「抽取失败 → 后端 502 → 媒体 onError → 浏览器降级提示」的路径成立。
但本节点也未启动 Electron，不将这条源码链等同于已捕获用户那次桌面请求。

下载入口同样已核对：`useVideoSearch.ts:546`～`:552` 调用
`download-and-upload`，`youtube_router.py:259` 进入服务，
`youtube_service.py:947`～`:956` 调用异步下载，`:836`～`:839` 执行
`download_video()`，再由 `:664` 调用信息抽取。因此信息抽取失败能同时阻断
预览和正式导入；并非仅检查了一个未被界面使用的辅助函数。

评审复跑（均未修改实现）：

| 检查 | 评审实测 | 能说明什么 |
| --- | --- | --- |
| 第 2.2 节 `repro.py`，加 `-B` | 退出码 0；预览 502；`best/worst` 命中 0，合并选择器命中 1 | 原有格式限制可稳定复现 |
| 第 2.4 节 pytest，加 `-B -p no:cacheprovider` | `14 passed, 26 warnings in 7.69s` | 现有局部契约成立，未覆盖完整平台链路 |
| 第 2.3 节包内解释器，固定 web/ios | 25 秒诊断上限；子进程被终止，未得到抽取结果 | 本轮不能重复宣称此组返回了登录挑战，也不是产品 504 |
| 同解释器，`--default-clients` | JavaScript 警告；`DownloadError`、`sign in`、`反机器人提示=true` | 删除固定客户端单独不足以解决当前真实访问失败 |

上轮固定客户端的登录挑战记录和本轮超时并不矛盾，说明外部状态会变。
唯一已实测的抽取拒绝原因仍是平台返回登录挑战；IP、会话、客户端、EJS 等
触发因素尚未被单变量实验确定。不能保证升级、合并或修改提示能消除该挑战。

### 7.2 反例：合流音视频不等于可直接代理的媒体文件

`youtube_service.py:213`～`:248` 只按 URL、音视频编码和扩展名筛选，
未检查 `protocol`。评审向实际 `_pick_progressive_format()` 传入：

```python
{"format_id": "hls", "ext": "mp4", "protocol": "m3u8_native",
 "height": 720, "acodec": "mp4a", "vcodec": "avc1",
 "url": "https://example.com/index.m3u8"}
```

结果选中原字典。`:312`～`:313` 又按 `ext` 生成 `video/mp4`；路由
`:303`～`:304` 对 URL 做普通 GET。若上游未给出正确类型，会把清单标成 mp4；
即使上游给出清单类型，当前链路也没有清单解析、分片回代和浏览器兼容处理。
这只是受控反例，未证明本次真实视频返回 HLS。

当前 `:172` 的 `skip=['hls','dash']` 确实还会主动排除清单来源：现有桌面包
2026.10.26 的 `yt_dlp/extractor/youtube/_video.py:3619` 读取 `skip`，
`:3684`、`:3726` 分别决定是否读取 HLS、DASH 清单。它与“只接收合流文件”
共同缩小可用格式范围；这不等于排除所有通过直接 HTTPS 提供的分离格式。
后续恢复库默认抽取策略时，必须同步限定直链快路径为可播的 HTTP(S) 单文件，
其余有限时长媒体交给本地准备流程，不能只删除 `skip` 或只加合并选择器。

### 7.3 反例：合并完成后可能返回中间视频或伪装的 mp4

`youtube_service.py:678` 用秒级时间和标题命名，`:784`～`:786` 以通配符
匹配后直接取首项。评审实际调用 `download_video()`，仅替换外部抽取/下载和
文件枚举边界：让枚举先返回 `review.f137.mp4`，再返回最终 `review.mp4`，
方法报告成功并选中了 `review.f137.mp4`。没有创建文件或执行真实合并。
枚举顺序不保证最终文件优先；分离格式还可能留下音轨、`.part` 和字幕。
同标题同秒下载也可能共享输出模板。故新增合并能力必须同时修正结果取文件逻辑。

另外，`:1036`～`:1048` 按请求格式重新命名并固定标为 `video/mp4`，
但下载选择器 `:711`、`:714` 允许回退到其他容器；现有 ffprobe 处理
`:995`～`:1026` 不验证音轨，失败也只记录日志，不能保证文件可播。
修复必须取后处理完成的确切输出路径，校验实际容器/编码/轨道后再导入；
不能用扩展名或一次成功的 `download()` 代替此检查。

另一个已执行的受控反例：让 `get_video_info()` 返回
`success=False,error='SIGN_IN_REQUIRED'`，`download_video()` 在
`:666`～`:670` 将原因压缩成“无法获取视频信息”。错误分类必须穿过这层和
`:960`～`:963` 的导入包装，才可能给界面准确提示。

上述反例在后端目录以 `python -B -X utf8 -` 调用实际服务方法，使用
`unittest.mock.patch` 替换 `validate_external_url`、`get_video_info`、
`yt_dlp.YoutubeDL`、`Path.glob` 和文件存在/大小查询；服务实例用 `__new__`
构造，避免创建输出目录。控制台断言通过，结果摘要如下（路径统一为 `/`）：

```text
hls_selected_as_progressive: true
download_success: true
selected_path: diagnostic-only/review.f137.mp4
extraction_error_preserved: false
Review counterexamples reproduced; no media files created.
```

### 7.4 更新隔离和 JS 支持：有可复用组件，不必扩大为通用包管理

再次使用包内解释器、设置 `PYTHONNOUSERSITE=1` 检查：yt-dlp 为
2026.10.26；`yt_dlp_ejs` 不存在；默认 `js_runtimes={'deno': {}}`；
本机 PATH 可找到 Node，但没有 Deno。包元数据同时给出：

```text
Requires-Python: >=3.11
yt-dlp-ejs==0.8.0; extra == 'default'
```

EJS 版本应跟随所选 yt-dlp 的依赖元数据，不能永久硬编码本次的 0.8.0。
评审重新查阅的[官方 EJS 指南](https://github.com/yt-dlp/yt-dlp/wiki/EJS)
确认 pip 的 `default` 依赖组含匹配脚本，Node 需显式启用；官方 exe 已带
EJS 脚本。因此已更正方案 C 的描述，避免把 exe 的 EJS 也说成必定缺失。

桌面包已有 `python/Lib/site-packages/playwright/driver/node.exe`，
`desktop/scripts/build.js:406`～`:414` 会检查该文件；本轮直接运行其
`--version` 得到 `v24.21.0`。方案 A 应优先用明确的包内绝对路径验证该
Node 的实际 JS 挑战执行能力，无需先引入 Deno。版本探测不是挑战执行成功证明。
`desktop/main/frontendService.js:8`～`:10` 则明确前端使用 Electron 的 Node，
不能假定存在单独的 `resources/node/node.exe` 或依赖用户 PATH。

FFmpeg 也已由 `desktop/main/backendService.js:37`、`:68`～`:70` 放到 PATH
前部，合并无需新增一套 FFmpeg。运行时根目录应与 storage 同级；状态中记录
所选包和 worker 实际报告的版本，不能继续把健康接口的进程内旧 import 当成
当前 worker 版本。Python 不兼容的新发行版应显示不可安装原因并保留可用版本。

### 7.5 并发、取消和媒体一致性：原推荐需补充的约束

- `youtube_router.py:338` 先解析、`:359` 才获取流信号量；现有四路上游限制
  不限制抽取/本地合并。应在昂贵工作之前设限，同一视频的并发准备共用一个任务。
- 解析使用 `asyncio.wait_for(asyncio.to_thread(...))`，超时不等于同步线程停止。
  `download-and-upload` 的路由 `:259` 也未采用 `/download` 在 `:193` 的
  300 秒超时。新的 worker 须有实际终止和回收机制，合并子进程也要退出，
  不能沿用“请求超时即可取消”的假设。只有任务确实结束后才能释放资源租约。
- `preview-stream/route.ts` 未启用 BFF 的 `abortOnClientDisconnect`；共享帮助器
  在 `backend-proxy.ts:329`～`:330` 收到响应头就清除计时器并解绑监听。
  因此现有生成器 finally 不能单独证明 Electron → Next → FastAPI → worker
  的取消全链路已通。修复只在 YouTube 路由范围补足、实测，避免顺带改造所有 BFF。
- `youtube_service.py:270`、`:324` 的缓存仅以 video_id 为键，没有处理在途解析
  与升级/代理切换的竞争。应按运行时及代理代际隔离；旧请求完成后不能重填新代
  缓存。已被播放器使用的文件要保留到最后一个读者释放，再过期清理。
- 对同一播放会话的 Range 请求，要固定媒体字节身份及格式，不能把切换格式后的
  第 N 字节接到旧文件上。上游 403/410 的一次重解析须保留；不能维持同一字节
  身份时显式重新加载。非法范围须按所用文件服务契约处理，不能伪造 206。
- `<video>.onError` 不能直接读取服务器 JSON 原因；只新增后端错误文本无法实现
  分类提示。前端需要可读取的准备/诊断响应，同时用视频 ID 和请求代际拒收旧结果。
  同 ID 重试应重建播放器并清除相应失败状态；`onLoadedData` 所在元素已在错误态
  卸载，不能指望它自动解除错误。

以上是根据代码确认的方案风险及验收要求，不声称已观测到所有并发故障。
直播、无时长媒体、DRM、私有/年龄限制及登录挑战不能进入无上限的下载回退；
应明确返回不支持或需要用户处理的原因。

## 评审结论

**最终唯一推荐：方案 A 的收敛实现——YouTube 专用版本化 Python worker，
保留现有同源流代理，以受限本地准备补足非直链媒体，并完成版本状态及重试提示。**

理由：确认的缺口横跨包生命周期和格式处理，只更新包或只改变前端降级不足以解决。
包内 Python 的隔离和进程内模块缓存，使 B 的原位升级难以安全切换；C 虽自带
EJS，仍需解决更新原子性、外部 JS 和媒体路径，额外引入 exe 分发没有已证实收益。
A 可继续使用现有 Python API、FFmpeg、Node、Range 代理和素材导入约定。
范围限于 YouTube；按操作启动版本固定的 worker 即可，不建设通用依赖平台、
常驻进程池或额外 JS 运行时，不重启整个后端，不在运行中 reload yt-dlp。

下一节点按以下确定范围实现，第 6 节有歧义处以本结论为准：

1. **运行时生命周期。** userData 下独立目录保留随包基线和最后可用版本；启动
   后异步检查、按持久时间节流并周期检查，手工与自动检查共用锁。只接受官方稳定
   发行的兼容 wheel 和其匹配 EJS，按发布元数据校验内容及 Python 约束，再做隔离
   worker 自检。暂存完成后原子切换激活记录；中断、校验失败、磁盘不足均不覆盖
   当前版本。新任务取得版本租约，活动任务及其子步骤保持旧版；退出后才允许清理。
   安装成功与激活成功分别记录，激活失败回退，不能以单次网络挑战触发循环回滚。
   更新请求也须显式采用配置的网络/代理策略，并将更新源访问失败与 YouTube
   访问失败区分。首次离线仍可使用基线；后台失败不阻塞打开编辑器。
2. **最小状态接口。** 新增后端 `GET /api/youtube/runtime` 和
   `POST /api/youtube/runtime/check`，由同名 Next BFF 暴露；手工检查提交或复用
   后台任务，不等待安装结束。GET 至少返回实际活动版本、发现的新版本、状态、
   最近检查时间、最近成功更新时间以及最近一次更新结果/错误。
   状态覆盖 checking/installing/ready/error，时间无记录时为 null。
   设置页打开时加载，更新期间短轮询；展示真实版本和旧/新版本更新记录。
   旧 `/health` 的内存版本不能作为新接口的版本来源；状态不暴露路径或代理凭据。
3. **媒体准备及回代。** 抽取使用受支持的库默认策略，启用明确包内路径的 Node
   和匹配 EJS。直链快路径增加协议和浏览器兼容检查；分离流/清单等非直链媒体
   用受限 worker 下载并通过现有 FFmpeg 得到可播的低清本地预览，完成后用现有
   Range 文件服务播放。准备过程采用短请求返回任务状态，前端可见准备中，避免
   在当前 30 秒解析窗口内硬塞完整下载。给准备任务设并发、总时限、字节和时长
   上限；按代际去重，取消实际回收子进程，文件完成校验后原子发布，清理避开读者。
4. **正式下载结果。** 支持合流及音视频合并，保持 best/worst/指定高度的选择语义；
   默认 mp4 采用 Chromium 可解码的编码，必要时受控转换。每任务独立输出目录，
   通过后处理结果获取确切文件，不再 glob 取首项；探测最终容器、非零大小及预期
   轨道，MIME/文件名与字节一致后再交现有 storage。保留 webm/mkv、字幕和裁剪
   请求的既有契约；非法参数在边界拒绝。已无音轨的合法源显式处理，不能伪造音轨。
5. **界面与错误恢复。** 在 YouTube 搜索区常驻网络前提提示；新增可读取的预览
   准备状态，失败提供分类原因和同视频重试，隔离快速切换产生的过期响应。
   平台拒绝、网络不可达、准备超限、合并失败分别显示；正式下载同样保留原因。
   不把浏览器打开、隐藏错误、robots.txt 200 或 import 成功算成内联预览成功。

**通过补证后的分析评审，可以进入实现；产品尚未修复，真实成功验收尚未完成。**
实现交付至少须包含以下有实质判别力的验证：更新成功/无更新/失败与重启恢复、
更新中并发下载及版本租约、包内隔离导入与 JS 实际调用、直接媒体和分离小媒体的
真实 FFmpeg 合并、最终文件选择和编码/轨道、Range/403 重解析/取消回收、
快速切换与同视频失败后重试、网络提示及设置状态。第 7 节的 HLS 和中间文件
反例必须成为回归用例；旧的“无合流返回 None”选择器测试可保留，但端点应另测
进入准备流程，而非让所有无合流媒体固定失败。

最后按第 6.3 节在最终桌面产物内完成搜索、左栏播放和拖动、下载导入、本地素材
及时间线播放、重启恢复的真实闭环，并记录版本、视频、响应和 ffprobe 证据。
若网络或登录挑战仍阻塞，必须写明阻塞项；本评审通过不能代替该产品验收。

## 实施过程发现的方案缺陷

1. **入口 DNS 校验与 TUN fake-IP 冲突。** 实施联网复跑时，搜索成功找到
   `jNQXAC9IVRw`，但旧下载/信息入口的通用 URL guard 将 YouTube 的
   `198.18.0.13` 解析结果拒绝，尚未进入 yt-dlp。沿用该入口会使完整 worker
   仍无法下载。修正为在模型及服务边界严格解析 YouTube 主机、端口和 11 位 ID，
   重建固定 `https://www.youtube.com/watch?v=<id>`；拒绝 redirect 入口、任意
   URL、其他端口及伪装主机。通用 URL guard 不变。新增规范地址及既有 SSRF
   回归，验证 file/元数据地址在模型边界更早被拒绝。
2. **开发解释器的用户 site 与桌面隔离 Python 不同。** 不能仅对更新版设置
   worker 导入目录；随包/开发基线也必须显式指定实际包目录。否则禁用用户 site
   的子进程会找不到开发机的 yt-dlp。基线同样使用不可变版本租约，不依赖
   PYTHONPATH；版本比较按合法版本解析，兼容 `2026.08.19` 与 `2026.8.19`。
3. **旧复现脚本绑定进程内 YoutubeDL。** 移入独立 worker 后，该 mock 无法替换
   子进程抽取器。修复后的离线复跑入口改为执行真实小媒体 HTTP 下载/FFmpeg 合并
   及 HLS 反例回归；原 `offline-output.txt` 继续保留修复前证据。联网探测应区分
   旧桌面包基线与新 worker，不将旧探测脚本结果当成更新服务的实际执行版本。

4. **预览取消的 204 被通用 BFF 缓冲器转成 500。** 继续执行桌面验收时，
   后端已回收 worker 并返回 204，Next 却在把空正文缓冲成空字符串后构造
   `Response('', {status: 204})`，触发 `Invalid response status code 204`。
   仅为 YouTube 预览准备路由的 DELETE 使用现有流式透传选项，保留 null body；
   不修改共享 BFF。已有预览 BFF 测试中补入 204 和失败响应回归，先确认原实现
   对 204 失败，再验证修复；实际桌面重新打包后复测取消响应及子进程回收。

5. **非法入口在模型边界拒绝时把 422 变成 500。** 复跑真实接口时用 redirect 入口
   `https://www.youtube.com/redirect?q=...` 调用 `/api/youtube/download-and-upload`，
   模型校验器抛出的裸 `ValueError` 被 FastAPI 放进错误上下文的 `ctx.error`，平台的
   422 处理器（`app/main.py:545`）序列化 `exc.errors()` 时抛
   `TypeError: Object of type ValueError is not JSON serializable`，用户得到 500 与
   不可读的 `Internal server error`。修正为校验器改抛
   `pydantic_core.PydanticCustomError`（它本身是 `ValueError` 子类，服务层
   `except ValueError` 语义不变），同一请求回到 422 并带可读原因。新增回归
   `tests/security/test_03_url_guard.py::test_youtube_invalid_url_validation_errors_stay_serializable`
   先确认错误载荷无法 JSON 序列化，再验证处理器返回 422 且含 `youtube_invalid_url`。

实施中未更改原有 SkillRouter 等工作区改动，未执行 git commit。

## 8. 实施与验收记录（2026-11-20）

### 8.1 已实现的范围

- 新增 YouTube 专用版本化运行时和一次操作一个版本的 Python worker；官方 PyPI
  wheel 的 Python 约束、SHA-256、匹配 EJS 及实际 JS 执行自检通过后，原子发布
  激活记录。活动操作保留旧版租约；失败保留可用版，重启恢复记录，自动检查按
  持久时间节流，手工检查与后台任务共用锁。下载、搜索、信息和预览均进入 worker。
- 新增后端及 Next 的 runtime/check 接口；设置页展示执行版本、可用版本、最近
  检查/更新时间、旧/新版本更新记录和错误，并在检查/安装时短轮询。
- 预览采用短请求创建/查询/取消会话，按运行时和代理代际去重；可播 HTTP 单文件
  继续回代，分离音视频或清单进入受限本地准备。最多四个 worker，预览总时限
  180 秒、最长 600 秒媒体、单项下载 128 MiB、任务目录合计 384 MiB 上限。
  取消会终止 worker 及其 FFmpeg/Node 子进程；文件验证后才发布，活动读者阻止清理。
- 正式下载支持分离音视频、best/worst/指定高度、MP4/WebM/MKV 和裁剪、字幕参数。
  每任务独立目录，使用后处理完成路径，移除 glob 首项选择及伪装后缀；最终通过
  ffprobe 验证容器、编码、大小和音视频轨道。MP4 需要时转为 H.264/YUV420P/AAC；
  合法无音轨源保留无音轨并返回 `has_audio=false`，不生成假音轨。
- YouTube 页签常驻网络前提提示；准备中、登录验证、限流、超限和合并错误可见，
  同一视频可重试；切换、关闭及迟到响应有代际隔离。YouTube 流 BFF 的取消监听
  保留至响应体结束；本地预览复用现有 Range 文件服务，签名媒体身份改变时要求重载。

### 8.2 可重复的自动验证

在仓库根目录执行：

```powershell
python -B -X utf8 docs/diagnoses/youtube-preview-and-ytdlp-update/repro.py
npx vitest run src/components/video/components/VideoSearchModal/VideoSearchModal.youtube.test.tsx src/components/settings/YouTubeSettingsPanel.test.tsx src/app/api/youtube/preview-stream/route.test.ts
```

后端目录执行：

```powershell
python -B -X utf8 -m pytest tests/test_youtube_runtime.py tests/test_youtube_preview_stream.py tests/security/test_03_url_guard.py -q -p no:cacheprovider --tb=short --disable-warnings --basetemp=M:/takoAI/Ecliptrix/.agentmesh/youtube-implementation/pytest-final
```

实测：后端 **68 passed / 27 warnings**；前端 **5 passed**；修复后离线复跑
**5 passed**。警告为已有 Pydantic/audioop 等弃用提示。测试包含真实小媒体 HTTP
下载和 FFmpeg 合并、HLS 误选反例、确切最终路径、容器/编码/音轨/裁剪、Range
206/416、403 重解析、进程树取消、并发更新与版本租约、损坏/离线/不兼容/激活失败、
中断与重启恢复、同视频重试、快速切换和界面更新状态。站点抽取和发布源使用可控
边界夹具，不能替代下节的真实平台验收。

`npm run build` 以及 `desktop/scripts/prepare-frontend.js` 的生产构建均成功，
后者生成当前前端的 standalone 产物。独立 `npm run type-check` 仍被原有工作区
`src/components/skillrouter/__tests__/SkillRouterSettingsPanel.test.tsx:145` 的
`SkillRouterLastVerified.stale` 缺失错误阻塞；没有修改该不相关测试。
`git diff --check` 通过；原有其他功能的未提交改动保留。

### 8.3 真实发布源与桌面产物

1. 实际从官方源安装并激活 **2026.8.19 → 2026.10.26**，匹配 **EJS 0.8.0**。
   活动 worker 的导入位置位于专用版本目录，Node 不仅探测版本，还真实执行了
   EJS lib/core 的受控签名挑战并得到正确结果。桌面包内 Python 3.11.9 与包内
   Playwright Node 也通过同一自检，不依赖开发机用户 site。
2. 完整构建流程在无关的 Remotion Chromium CDN 下载环节进度过慢，因此停止该
   构建，复用已有特效资源；资源校验 **12089 项通过**。重新生成前端 standalone，
   更新后端及已校验的官方 yt-dlp/EJS，调用 electron-builder 生成隔离 `win-unpacked`。
   交付目录为 `.agentmesh/youtube-implementation/desktop-release/win-unpacked`；
   六个相关后端源文件与包内资源的 SHA-256 已逐项比较一致。
3. 使用隔离 userData 启动此桌面产物，后端 `/api/health` **200**，Next 正常启动，
   实际桌面设置页显示 **2026.10.26**、检查时间及更新记录。点击手工检查后，
   同源 `/api/youtube/runtime` 返回 `ready / no_update`，上次成功更新时间保持不变。
   截图：`.agentmesh/youtube-implementation/desktop-youtube-settings.png`。
4. 测试配置只用于隔离验收目录；身份门使用项目既有的测试开关关闭，未修改产品
   默认身份策略。公开模板检查没有可发布的秘密值。没有提交 git。
5. 关闭实际桌面后，使用最终产物内的 Python 独立重建运行时实例：恢复
   `ready / 2026.10.26 / no_update`，检查/更新时间与关闭前一致；再运行实际
   worker 的 EJS/Node 自检成功。测试桌面和自行启动的调试后端已关闭。

### 8.4 真实媒体验收的阻塞

真实搜索 `Me at the zoo` 已返回 `jNQXAC9IVRw` 等结果。通过当前 worker 执行
正式下载，以及 HTTP 预览准备接口，均实际得到 **SIGN_IN_REQUIRED**；预览接口
先返回 **202 preparing**，随后可读取 **200 / error / SIGN_IN_REQUIRED**，并明确
说明 YouTube 要求登录或验证。使用项目现有代理单独复测正式下载仍得到同类拒绝。

实际桌面还验证了两种搜索负载：经最终包内 Next BFF 请求 3 条结果返回
`200 / success=true`，包含目标视频；桌面搜索界面默认请求 60 条，当前网络下
达到 worker 40 秒上限并返回 `NETWORK_ERROR`。界面中已实际看到常驻网络提示，
没有把较小请求成功等同于默认界面搜索或媒体下载均成功。

最终桌面 BFF 的 `/api/youtube/download-and-upload` 也已实际调用，返回
`200 / success=false`，原始分类 **SIGN_IN_REQUIRED** 保留至导入响应，素材 URL
为空；该终止性错误没有重试。并行创建的预览会话返回 `202 / preparing`，在下载
被拒后仍未就绪，随后显式取消。此组原始摘要保存在
`.agentmesh/youtube-implementation/desktop-live-result.json`。

因此，**真实 YouTube 下载成功、左栏播放/拖动、导入素材后时间线播放与重启恢复的
成功闭环尚未验收**。没有以搜索成功、版本更新成功、离线测试或浏览器打开冒充这一
结果，也没有隐藏平台拒绝或无限重试。需要能让 YouTube 接受该公开视频请求的网络
与访问条件，才能完成剩余真实媒体验收。

### 8.5 继续执行与最终复核（2026-11-20）

本轮接续工作区已有的方案 A 实现，未重复开发，未改动 SkillRouter 等其他功能。
新增修正仅涉及 `preview-prepare/route.ts` 的 DELETE 透传、已有预览 BFF 测试及
本文实施发现与验收记录；未新增依赖，未执行 git commit。

桌面联网复测发现取消接口的真实 500，见「实施过程发现的方案缺陷」第 4 项。
先增加回归并实际观察 `Invalid response status code 204` 失败，随后仅为该
DELETE 启用现有 `streaming` 选项，保留后端 null body。其他路由和共享 BFF 不变。

| 最终检查 | 本轮实测 |
| --- | --- |
| 后端原验收命令，临时目录改为 `pytest-resume` | **68 passed / 27 warnings** |
| 修复后 `repro.py` 离线复跑 | **5 passed / 27 warnings**，真实小媒体合并和 ffprobe 通过 |
| 第 8.2 节前端命令，已含新增取消回归 | **7 passed**；204 空响应及 429 原因均保留 |
| `node --test desktop/main/backendService.test.js` | **2 passed** |
| `npm run build`、修正后的 `node desktop/scripts/prepare-frontend.js` | 均退出 0；后者重新构建并移除 bundle 内 `.env` |
| `npx electron-builder --dir --win --x64 --config.directories.output=M:/takoAI/Ecliptrix/.agentmesh/youtube-implementation/desktop-release`（desktop 目录） | 退出 0，重新生成隔离桌面产物 |
| 源码与最终包的 SHA-256 比对 | 六个相关后端源文件及新编译的预览准备路由全部一致 |
| 包内 Python、实际 worker 与 JS 自检 | yt-dlp **2026.10.26**、EJS **0.8.0**，包内 Node 执行受控签名挑战成功 |
| 最终桌面启动、设置和重启记录 | 后端健康及同源 runtime 均 **200**；设置显示正确版本，手工检查完成后仍为 no_update；历史更新时间未被检查覆盖 |
| `npm run type-check` | 仍仅报原有 `SkillRouterSettingsPanel.test.tsx:145` 缺少 `stale`；新增测试没有新增类型错误 |
| `git diff --check` | 退出 0；原有其他功能的工作区改动保留 |

最终桌面的真实同源取消测试：POST 返回 **202 / preparing**，实际观测到 worker
PID **32772**；DELETE 返回 **204** 且正文长度 **0**；响应后旧 worker 已不存在，
再查同一会话返回 **404**。该路径不再出现此前的 204 转 500；原始摘要写入已有的
`.agentmesh/youtube-implementation/desktop-live-result.json`。最终桌面设置截图更新于
`desktop-youtube-settings.png`；验收结束后已关闭本轮桌面及其子服务。

本轮同一最终产物对 `jNQXAC9IVRw` 的真实下载导入仍于 **11.18 秒**后返回
**200 / success=false / SIGN_IN_REQUIRED**，素材 URL 为 null。较早本轮通过界面
提交的默认 60 条搜索也仍在 40 秒 worker 上限返回 NETWORK_ERROR；未调整请求量
或放宽超时以掩盖该结果。已确认的软件问题与真实平台访问限制继续分别记录。

因此代码及打包验证已完成，**真实视频成功下载、左栏播放/拖动、导入及时间线播放、
媒体重启恢复仍未通过成功验收**。该节点不得被报告为完全成功；需要可被 YouTube
接受的网络与访问条件后才能完成剩余项。任务报告服务仍缺少 TASK_SERVER_URL，
按任务规定重试后只回退本节点 #2 的本地看板状态，并保留这一阻塞说明。

### 8.6 接续验收（本轮，真实媒体闭环已通过）

本轮未重写实现，只复核既有方案 A 代码、修掉一处新发现的响应缺陷，并在
**真实同源链路**上补做上一轮卡住的验收。环境：仓库内 dev 后端
（`uvicorn app.main:app`，127.0.0.1:18321，独立 `STORAGE_ROOT`/`YOUTUBE_RUNTIME_ROOT`）
\+ 生产构建的 Next（`npx next start -p 3100`，`BACKEND_URL` 指向该后端），
因此渲染进程使用的 `/api/youtube/*` BFF 与后端路由、worker、存储全部真实执行。

| 检查 | 本轮实测 |
| --- | --- |
| 自动检查/安装/激活 | 基线 **2026.8.19** → 官方 PyPI **2026.10.26**（EJS 0.8.0、Node 自检通过），`last_result=activated`，history 记录旧/新版本、检查与激活时间 |
| 手工检查 | `POST /api/youtube/runtime/check` → **202**；随后 `GET /api/youtube/runtime`（经 Next BFF）→ **200**，`status=ready`、`last_result=no_update`，上次成功更新时间未被覆盖 |
| 搜索 | 同源 `/api/youtube/search`：20 条 **200 / 8.2s**，60 条（界面默认量级）**200 / 16.6s** |
| 左栏预览（可播格式） | `dQw4w9WgXcQ`：`preview-prepare` **202 preparing** → 轮询 **200 ready**，带 `stream_url`；同源 `preview-stream` 带 `Range: bytes=0-1023` 返回 **206 / 1024 字节 / video/mp4 / ftypmp42** |
| 左栏预览（被拒视频） | `jNQXAC9IVRw`：**200 / status=error / code=SIGN_IN_REQUIRED**，message 为可读中文；同一会话取消 **204**、正文长度 0 |
| 正式下载闭环 | `dQw4w9WgXcQ` 480p：`download-and-upload` **200 / success=true / 154.9s**，`file_size=26700168`，`has_audio=true`；素材 URL `/api/storage/files/.../youtube_media.mp4` 带 Range 返回 **206**；ffprobe：mp4 / 213.05s / h264 854×480 yuv420p / aac |
| 非法入口 | redirect 入口修正前 **500**（`ValueError is not JSON serializable`），修正后 **422 + youtube_invalid_url + 可读原因**（见缺陷第 5 项） |
| 后端测试 | `tests/test_youtube_runtime.py tests/test_youtube_preview_stream.py tests/security/test_03_url_guard.py` → **69 passed / 28 warnings** |
| 离线复跑 | `repro.py` → **5 passed**（真实小媒体下载 + FFmpeg 合并 + ffprobe 校验） |
| 前端测试 | `npx vitest run`（VideoSearchModal / YouTubeSettingsPanel / preview-stream 路由）→ **3 files / 7 tests passed** |
| 构建与启动 | `npm run build` **退出 0**；`python -c "import app.main"` 冒烟 259 条路由；`npm run type-check` 仍只剩既有 `SkillRouterSettingsPanel.test.tsx:145` 的 `stale` 错误 |

结论更正：上一轮"真实下载/预览未验收"的阻塞**本轮已解除**。`jNQXAC9IVRw` 仍被平台
拒绝（SIGN_IN_REQUIRED，逐视频如实上报、不重试），但同一网络下 `dQw4w9WgXcQ`
完成了"解析 → 预览 206 分段 → 正式下载 → 落库素材 → 存储 Range 可读"的真实闭环，
ffprobe 证明容器、编码与音视频轨道齐全。

仍需在打包 Electron 产物内做一次界面级复测（设置页版本/更新记录、左栏播放与拖动、
导入素材后时间线播放、重启后素材可用）：本轮修复的 `youtube_models.py` 使
`.agentmesh/youtube-implementation/desktop-release/win-unpacked` 内的同名副本
**落后于源码**（其余六个后端文件仍 SHA-256 一致），界面级验收必须在该产物重建后执行。
本轮未执行 `git commit`，未改动 SkillRouter 等其他未提交改动。

## 9. 最终代码评审与提交（节点 #3）

本轮不重写实现，只按第 3、6、7 节的根因与约束逐项复核 diff，修掉复核中复现出
的问题，并把修复范围单独提交。工作区里 SkillRouter 等其它未提交改动保持原样、
未进入本次提交。

### 9.1 复核发现并已修掉的问题

| 编号 | 问题 | 证据 | 处理 |
| --- | --- | --- | --- |
| R-1 | 模型边界仍可能把 422 变成 500：`urlsplit` 的裸 `ValueError`（越界端口、非法 IPv6）经 `ctx.error` 进入错误载荷，`exc.errors()` 不可 JSON 序列化 | 探针对 `https://www.youtube.com:99999/watch?v=…`、`https://www.youtube.com:abc/…`、`https://[::1/watch?v=…` 实测 `TypeError: Object of type ValueError is not JSON serializable` | `youtube_watch_url` 统一包 try/except，只抛 `PydanticCustomError`；回归测试参数化覆盖这三个入口 |
| R-2 | 路由直接读写 `youtube_service._preview_sessions`，会话生命周期散落在路由层 | 代码确认 | 服务层新增 `preview_job(token, video_id)` 与 `cancel_preview(token)`，路由只调公开方法 |
| R-3 | 本地预览文件被回收后 `_serve_safe_media` 的 `stat()` 抛 `FileNotFoundError`，用户拿到 500 | 代码确认 | 捕获后失效缓存、把会话标记 `MEDIA_RELOAD_REQUIRED` 并返回 409，前端据此显示重试 |
| R-4 | 读者计数在 `__init__` 里自增，响应未真正发送时永不回落，预览目录不会被清理 | 代码确认 | 计数移进 `__call__`，与实际发送同生命周期 |
| R-5 | 每任务独立输出目录只删了 `media.mp4`，空目录长期堆积 | 代码确认（本方案引入 per-task 目录） | 上传完成后整目录回收，仅删 `output_dir` 下的任务目录 |
| R-6 | 死代码/过时注释：`youtube_service` 未使用的 `ThreadPoolExecutor`、`prepare_preview` 不可达的重复 24 会话限额、三处"线程池运行"注释、416 分支前的旧注释 | 代码确认 | 一并清理与改写 |

`_until_disconnect` 的取消回收经独立探针实测：调用方被 `wait_for` 取消时，
`await task` 的 `_fut_waiter` 就是该任务，取消会传导到 worker，不存在原本担心的
子进程泄漏。因此不额外加取消逻辑，只写清"operation 必须保持被直接 await、不得再包
shield"这一约束，并新增一条锁定该契约的回归。

### 9.2 逐项对照根因

- **根因 3.1（生命周期缺失）**：版本化目录、租约、原子激活、状态与记录齐全；
  下载/搜索/信息/预览全部经 worker，父进程不再 `import yt_dlp`。设置页读的是
  worker 报告的实际版本，不是进程内旧 import。
- **根因 3.3（只支持合流格式）**：直链快路径改为"HTTP 单文件 + Chromium 可解码
  编码"，清单与分离流进入受限本地准备；正式下载支持 `bestvideo+bestaudio` 合并、
  确切输出路径与 ffprobe 校验，不再 glob 取首项。
- **根因 3.4（错误被压缩成同一提示）**：错误分类经 worker → 服务 → 路由 →
  BFF → 界面全链透出，YouTube 页签有常驻网络提示与同视频重试；同源 `<video>`
  `onError` 不再是唯一信息源。
- **根因 3.2（平台挑战）**：仍如实上报 `SIGN_IN_REQUIRED`，不重试、不伪造成功；
  第 8.6 节已记录同一网络下 `dQw4w9WgXcQ` 的真实闭环。

未发现本次改动在相邻链路引入回归：`tests/test_youtube_download_upload.py`、
`tests/test_youtube_service.py`、`tests/test_settings_services.py` 均仍然通过；
`import app.main` 仍为 259 条路由。

### 9.3 本轮复核实测

| 检查 | 结果 |
| --- | --- |
| `pytest tests/test_youtube_runtime.py tests/test_youtube_preview_stream.py tests/security/test_03_url_guard.py tests/test_youtube_download_upload.py tests/test_youtube_service.py` | **73 passed / 5 skipped**（后两个文件为既有用例，其中 5 条按原逻辑跳过） |
| `python -B -X utf8 docs/diagnoses/youtube-preview-and-ytdlp-update/repro.py` | **5 passed**（真实小媒体下载 + FFmpeg 合并 + ffprobe 校验） |
| `npx vitest run`（VideoSearchModal / YouTubeSettingsPanel / preview-stream 路由） | **3 files / 7 tests passed** |
| `npx tsc --noEmit` | 仅剩既有 `SkillRouterSettingsPanel.test.tsx:145` 的 `stale` 缺失（本轮未触碰的其它未提交改动） |
| `python -c "import app.main"` | 259 条路由，无导入错误 |
| `git diff --check` | 退出 0 |

**提交范围**：仅 YouTube 修复相关的后端（模型/路由/服务/运行时/worker/依赖/测试）、
桌面启动环境与后端打包脚本（backendService.js / prepare-backend.js）、YouTube 的 Next BFF 与界面、以及本诊断目录；`git add` 逐文件
指定，未使用 `-A`/`.`，未提交 SkillRouter 改动、`.bug-diagnosis/` 与任何构建产物。

**仍未完成**：第 8.6 节末尾记录的界面级验收（打包 Electron 内设置页、左栏播放与
拖动、导入后时间线播放、重启恢复）需要在重建产物后执行；本轮改动不影响第 8.6 节
已通过的真实同源闭环结论。
