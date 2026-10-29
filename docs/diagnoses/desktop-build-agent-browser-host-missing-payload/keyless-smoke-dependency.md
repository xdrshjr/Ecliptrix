# 诊断:冒烟门禁的隐藏依赖是「模型密钥」吗?

- **触发**:public-safe 构建只发占位符,启动时没有任何可用的
  LLM / TTS / ARK / search 键。该构建上门禁 2/2 失败:
  `final-gate-31`(`timed out: cover autosaved to project`)
  与 `final-gate-32`(`研究浏览器退出后残留进程`)。
  两次都不是密钥类检查,所以怀疑「某条检查悄悄依赖 provider」。
- **本文件回答**:哪些检查族真需要 provider;`cover autosaved
  to project` 卡在哪一步;早先的绿灯是否因为带了真凭据。
- **结论一句话**:没有任何一条检查族需要可用密钥。早先的绿灯
  (`final-gate-25` / `-28`)本身就是零密钥跑出来的,因为门禁
  自己强制断言「无键」(§4)。第 31 次超时是产品侧封面 apply
  先失败,而门禁只轮询后端工程记录、从不读应用自己的错误面板,
  于是把一次具名失败伪装成 90 s 超时——与向导、与密钥都无关。
- 我没有启动打包应用,也没有跑门禁(并行 agent 在跑,会污染
  端口与进程基线)。结论全部来自读代码 + 读那几次运行自己的
  产物与日志。

---

## 1. 逐族判定

| 检查族 | 判定 |
|---|---|
| cover 渲染 + autosave | keyless-irrelevant |
| cover readiness 采样 | keyless-irrelevant |
| research-browser CDP 冒烟 | keyless-irrelevant |
| `browser.available` 能力位 | keyless-irrelevant |
| llm-status unconfigured | keyless-required |
| project list | keyless-irrelevant |
| sqlite | keyless-irrelevant |
| main window | keyless-irrelevant |
| font templates(五模板) | keyless-irrelevant |
| MP4 正文/音频导出 | keyless-irrelevant |

### 1.1 逐族依据

- **cover 渲染 + autosave**:门禁只点 `.cover-apply` 再轮询后端
  工程记录,窗口 90 s。
  `desktop/scripts/smoke-test.js:1076-1084`
  应用侧全本地:草稿 flush → 结构校验 → 本地 canvas 渲染 →
  publish。
  `src/components/video/cover/useCoverController.ts:438-454`
  `src/components/video/cover/renderCover.ts:100-137`
  代理是哑管道,不转发任何凭据。
  `src/lib/api/server/backend-proxy.ts:1-45`
- **cover readiness 采样**:等 `img.decode()` 与
  `document.fonts.ready`,用 `ResizeObserver` 量尺寸。
  `src/components/video/cover/useCoverReadiness.ts:75-99,114-117`
  门禁侧读 `.cover-readiness` 的 `data-status`。
  `desktop/scripts/smoke-test.js:753-758,813-828`
- **research-browser CDP 冒烟**:用包内 Python 连宿主 CDP,
  页面 / JS / PNG 全是合成体,且「被跳过即失败」。
  `desktop/scripts/smoke-test.js:159-202,242-244`
  `backend-services/basic-service/app/services/web_research/smoke.py:63-95,206`
- **`browser.available`**:该字段来自 CDP 宿主探测;门禁只断言
  这一段,带键的 `search` 段没被断言。
  `…/basic-service/app/routers/research_browser_router.py:29,46-48`
  `desktop/scripts/smoke-test.js:1485-1494`
- **llm-status unconfigured**:要求 `configured:false`,占位符
  也算不可用——这条断言的就是「没有键」。
  `desktop/scripts/smoke-test.js:1508-1519`
  `backend-services/basic-service/app/routers/config_router.py:53-73`
- **project list / sqlite**:只要 HTTP 200 与 db 文件存在。
  `desktop/scripts/smoke-test.js:1521-1535`
- **main window**:读 `main.log` 的一行文本。
  `desktop/scripts/smoke-test.js:1553-1568`
- **font templates**:断言真实 DOM 文本 rects;`fonts.status`
  只记录不比较,字体是本地族(Segoe UI / Georgia / Consolas)。
  `desktop/scripts/smoke-test.js:854-880`(记录处 `:867`)
  运行产物 `blocked: []` 证明没有外发请求。
- **MP4 正文/音频导出**:UI 提交 → 轮询 `/status`,再用包内
  ffprobe/ffmpeg 逐帧与音轨 onset 比对,降级即失败。
  `desktop/scripts/smoke-test.js:1228-1249,1251-1288`(降级 `:1245`)
  后端合成链是 ffmpeg,无模型调用。
  `.claude-index/index.md:262`

零密钥在封面流程里唯一改变产品行为的地方,是「AI 图」页的生成
按钮变灰;门禁正是把它当契约断言,并要求生成请求数为 0——这是
「优雅降级被断言」,不是依赖。
`desktop/scripts/smoke-test.js:1197-1201,1295`

---

## 2. `cover autosaved to project` 超时

### 2.1 门禁做了什么

1. 用包内 ffmpeg 现造素材建工程。
   `smoke-test.js:328-357,1035-1037`
2. `reopen()` → 打开工程 → `openStudio()` → 改标题。
   `smoke-test.js:1067-1074`
3. 点 `.cover-apply`,然后每 300 ms 打一次
   `GET /api/video-projects/{id}`,要求 `coverSchemaVersion`
   为 2 且时间线上恰有 1 个 `metadata.role === 'video-cover'`。
   `smoke-test.js:1076-1084`(读点在 `:1077`)
4. 注意 `click()` 是 `e.focus(); e.click()`,即 DOM 点击,
   不走真实指针输入。
   `smoke-test.js:1040-1042`

### 2.2 应用在 apply 时做了什么(全本地)

`act('apply')` → `prepare()`:① flush 草稿(发
`PUT …/video-cover-v2/{id}`);② `assertCoverStructure`;
③ 本地渲染(`render()`);④ `publish`(multipart 打同源 Next
路由)。四步全过才 `applyRevision` → 纯 store 变更 →
`onApplied()` 写入 `coverSchemaVersion: 2`,此时工程 autosave
的 800 ms 去抖才被触发。
`src/components/video/cover/useCoverController.ts:438-490`
`src/components/video/cover/renderCover.ts:100-137`
`src/lib/api/videoCoverV2.ts:57-64`
`src/components/video/timeline/store/actions/applyCover.ts:15-37`
`src/components/video/VideoEditingInterface.tsx:1956-1959,1964`
`src/components/video/projects/hooks/useProjectAutosave.ts:237-287`

这条链上没有 LLM、没有外部服务、没有一把键。`generationPosts`
只在 AI 页才计数,本次为 0。
`desktop/scripts/smoke-test.js:1018`(计数点)
`smoke-test.js:1295`(为 0 的断言)

### 2.3 第 31 次实际发生了什么

```
37  waiting: click .cover-apply
38  waiting: cover autosaved to project
...
46  waiting: cover autosaved to project
49  FAIL: Error: timed out: cover autosaved to project
```
`desktop/cache/build-logs/final-gate-31.log:37-46,49`

对比第 25 次(PASS):这一等在一个 10 s 日志间隔内就结束了,
第 39 行已经在跑第二次 apply。
`desktop/cache/build-logs/final-gate-25.log:34,37-39,153`

超时只是下游。决定性证据在该次运行自己的产物里:

- DOM 里有 `Cover operation failed. Your draft has been
  preserved.` 与 `Retry`,同时有 `Draft saved`、`Preview check
  passed`、`No cover`。这正是 `CoverErrorPanel` 的 alert 区,
  文案表见 `i18n.ts:4481-4498`。
  `…/ecliptrix-smoke-XOGsV2/artifacts/failure.json`
  `src/components/video/cover/CoverErrorPanel.tsx:33-40`
  ⇒ apply 抛错了,草稿在、成品没有。
- 同一文件里 `errors: []`、`blocked: []`、`generationPosts: 0`。
  `blocked` 为空说明整条流程一个外发请求都没试图发过。
- 后端中间件日志里与封面相关的只有两条:`GET` 草稿(10:40:03)
  与 `PUT` 草稿(10:40:05),**没有任何 `POST …/revisions`**;
  `backend.log` 也无 error/exception。
  `…/ecliptrix-smoke-XOGsV2/logs/app.log:149,162`
  ⇒ 失败发生在 publish 之前(或 publish 未出站)。

### 2.4 不是向导遮罩,也不是未配置状态

1. 向导在本次已被正常关掉,且与第 25 次逐字相同:
   `{"present":true,"dismissed":false,"clicked":"Maybe later"}`。
   `final-gate-31.log:34` = `final-gate-25.log:34`
   守卫在 `reopen()` 里就跑完了。
   `desktop/scripts/smoke-test.js:448-460,1043,1052`
2. 即使向导还在,也吃不到这次点击:门禁用的是 DOM `click()`,
   不经命中测试。会被 `z-[100]` 遮罩吞掉的只有
   `pressWithPointer` 那类真实指针派发,它只用在预览对话框
   用例里。
   `smoke-test.js:476-549`(命中检测 `:484-497`),用处 `:635`
3. 工程 autosave 没有「模态打开就暂停」的闸门:只看 `content`
   变化(800 ms 去抖 + 5xx 重试),不看设置页、不看
   `document.hidden`。所以遮罩不可能推迟它的 PUT。
   `useProjectAutosave.ts:237-287`
4. 无键只影响 AI 页的生成按钮,与 HTML 页 apply 无关。
   `smoke-test.js:1197-1201`

另外:草稿 `PUT` 在 10:40:05 是成功的,走的正是同一个 Next
代理、同一个路由族,所以「同源通道坏了」这个解释也站不住。

### 2.5 剩余候选(按可能性)

错误码既没进 DOM 也没进 `failure.json`,只能按文案集合反推。
已排除专有文案的那几个:文本溢出、字体未就绪、背景不可读、
画幅不一致、时间线冲突、版本冲突、服务端草稿缺失、素材缺失。
`i18n.ts:4480-4499`

剩下两类:

1. `COVER_RENDER_FAILED`:两次 `toBlob` 都失败 / 空 PNG /
   位图尺寸不符 / 等待超时,或 `render()` 返回 null。
   `renderCover.ts:137`
   `useCoverController.ts:444-446`
2. `COVER_PROJECT_CHANGED`:会话已不是当前工程。
   `useCoverController.ts:455-462`

两者都在客户端,都与密钥无关。具体是哪一个,本次产物无法
区分(见 §6)。

---

## 3. 第 32 次:既有残留判定,同样与密钥无关

研究浏览器报告 `success:true` 之后,立刻失败于
`研究浏览器退出后残留进程(已清理):14260`——那是
`researchBrowserSmoke` 的 finally 里的基线差集,窗口已是放宽过的
25 s。
`final-gate-32.log:27,30`
`desktop/scripts/smoke-test.js:32-38,248-255`

这与本目录 README 第 5 条「把仍在运行的进程判成残留」同族,
只是方向相反:检查自己 spawn 的 Python 还没退干净。

---

## 4. 早先的绿灯,不是靠内置凭据

第 25 / 28 次 PASS 本身就是零密钥跑出来的。证据在同一批日志里:

1. 门禁给本次运行写的 `.env` 是空文件,注释写明 no keys of any
   kind。
   `desktop/scripts/smoke-test.js:1421-1424,1438`
2. 启动器起进程前刮掉 14 个继承凭据变量,第 25 与第 31 次的
   清单完全相同。
   `final-gate-25.log:2`;`final-gate-31.log:2`
3. 后端只从 cwd 读 `.env`,而 cwd 是 userData;即使安装包里带着
   `.env` 也读不到。
   `backend-services/basic-service/app/config.py:9-12,606`
4. 门禁把「无键」写成断言:`llm-status` 必须
   `configured:false`;三次运行都是
   `llm-status reports unconfigured ok`。
   `desktop/scripts/smoke-test.js:1508-1519`
   `final-gate-25.log:28`;`final-gate-28.log:28`
   `final-gate-31.log:28`
5. 零生成请求:`generationPosts !== 0` 即失败。
   `desktop/scripts/smoke-test.js:1295`
6. 素材本地现造,研究浏览器用注入的离线 transport,整跑
   `blocked: []`。
   `smoke-test.js:328-357`;`smoke.py:63,206`

⇒ 通过的那些检查里没有一条做过真实的 chat / TTS / 封面图生成
调用。发布件在「零密钥」形态下是可测的,`final-gate-25:153`
的 `PASS` 就是存在性证明。

---

## 5. 建议(两类分开,均未实施)

> 并行 agent 正在反复跑门禁,本文件不改任何代码。

### 5.1 (a) 真需要 provider 的检查:本次一条也没有

- 不需要新增 skip。唯一与密钥有关的断言是「没有可用
  provider」,必须保持现状,不能为了绿灯改成条件断言。
  `desktop/scripts/smoke-test.js:1508-1519,1197-1201`
- 若将来要证明「配了键也能用」,它必须是独立的、有名字的一次
  运行(例如 `--with-credentials`),并记录 `skipped` 与原因;
  绝不允许在零密钥模式下被静默算过。
- 现成陷阱:`research.available` 在开启研究模型时依赖模型解析。
  门禁今天只断言 `browser.available`,不要顺手把前者加进断言,
  否则那条检查会真的需要密钥。
  `research_browser_router.py:30-37`
  `smoke-test.js:1491`

### 5.2 (b) 本次超时的真问题:可观测性,不是焦点竞态

向导 / 焦点这一族已经修好了,第 31 次的日志第 34 行证明守卫
生效。不要引入新机制,也不要给这条用例再加一层重试。
`smoke-test.js:389-460`

该改的是三个最小点:

1. 在 `until('cover autosaved to project', …)` 的 poll 里先读
   `.cover-error[role="alert"]` 的文本;一旦出现就用它 `fail`
   (例如 `cover apply failed: …`),而不是再等 90 s。这是纯
   诊断,不新增重试语义。
   `smoke-test.js:1078-1084`
   `src/components/video/cover/CoverErrorPanel.tsx:33-40`
2. `failure.json` 现在只写 `error / errors / blocked /
   generationPosts / body`。请把手头已有的 `coverWrites`、
   `revisionPosts`、`nativeDownloads` 一起写进去——本次正是缺
   这一个字段,才无法区分「渲染失败」与「publish 失败」。
   `smoke-test.js:1300-1303`;计数点 `:984-986`
3. 可选(产品侧另立改动):`CoverErrorPanel` 把 `issue.code`
   暴露成 `data-code`,让门禁与事后诊断不必靠文案反推。
   `CoverErrorPanel.tsx:33-40`

第 32 次的残留 PID 同理:继续用现有的
`waitForNoLeakedProcesses` 与 25 s 窗口,不要为了让它变绿而
扩大豁免范围。
`smoke-test.js:32-38,248-255`

---

## 6. 未验证

- 没拿到第 31 次的具体封面错误码:`CoverErrorPanel` 不渲染
  code,`failure.json` 只存 body 文本。所以
  「`COVER_RENDER_FAILED` 而非 `COVER_PROJECT_CHANGED`」是按
  文案集合与请求时序推断,**未实测**。
  `src/components/video/cover/CoverErrorPanel.tsx:33-40`
- 没排除「Next 路由收到 multipart 后失败,因此在后端中间件
  日志里不留痕」。依据只是同族 `PUT` 草稿在同一秒成功,且
  `logs/frontend.log` 无 error——但该文件只有 217 B,证据力弱。
- 没查清 08:43(第 28 次 PASS)与 10:39(第 31 次 FAIL)之间
  打包件改了什么:中间确实重建过
  (`build-20261029-100526.log`、`-103002.log`),但我没有比对
  两次 `release/win-unpacked` 的差异。这决定本次失败是回归
  还是偶发。
- 没核对用户提到的更早「6/6 然后 3/3」那些通过记录(不在本
  目录),也没验证那几轮打包件里带没带真键。§4 只用
  `final-gate-25/28` 这两次日志可查的 PASS,已足以否证
  「绿灯必须靠凭据」。
- 没跑门禁、没启动打包应用(并行 agent 在跑)。
- font templates 一族的 `document.fonts.status` 门禁只记录不
  比较,所以「字体全部 loaded」这层没有断言,本轮也没验证它在
  打包态是否总是 `loaded`。
  `smoke-test.js:867`

---

## 7. 证据索引

| 主题 | 位置 |
|---|---|
| autosave 轮询与 90 s 窗口 | `smoke-test.js:1076-1084` |
| DOM 点击(不经命中测试) | `smoke-test.js:1040-1042` |
| 真实指针派发 + 命中检测 | `smoke-test.js:476-549` |
| 向导守卫(已存在) | `smoke-test.js:370-460,1052` |
| 零密钥契约与空 `.env` | `smoke-test.js:1421-1424,1438` |
| 零生成断言 | `smoke-test.js:1197-1201,1295` |
| apply 链路 | `useCoverController.ts:438-490` |
| 本地渲染 | `renderCover.ts:100-137` |
| 时间线变更(纯) | `applyCover.ts:15-37` |
| `coverSchemaVersion: 2` | `VideoEditingInterface.tsx:1956-1964` |
| 工程 autosave 只看 content | `useProjectAutosave.ts:237-287` |
| 代理不转发凭据 | `backend-proxy.ts:1-45,139-153` |
| 后端只读 cwd 的 `.env` | `config.py:9-12,606` |
| `llm-status` 判定 | `config_router.py:53-73` |
| browser 可用性 | `research_browser_router.py:29,46-48` |
| 离线 CDP 冒烟 | `smoke.py:63-95,131-133,206` |
| 错误文案表 | `i18n.ts:4472,4480-4499` |
| 第 31 次超时 | `final-gate-31.log:37-46,49` |
| 第 31 次失败现场 | `…/ecliptrix-smoke-XOGsV2/artifacts/failure.json` |
| 第 31 次后端请求序列 | `…/ecliptrix-smoke-XOGsV2/logs/app.log:149,162` |
| 第 25 次通过 | `final-gate-25.log:34,37-39,153` |
| 第 28 次通过 | `final-gate-28.log:34,38-39` |
| 第 32 次残留 PID | `final-gate-32.log:27,30` |
| 刮除凭据清单 | `final-gate-25.log:2`;`-31.log:2` |

写于 2026-10-29。本文件只做诊断,**没有改动任何代码**。
