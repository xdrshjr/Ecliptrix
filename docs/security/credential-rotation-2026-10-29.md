# 构建产物内置凭据事件与轮换清单（2026-10-29）

> 范围：v1.0.0 首个公开 GitHub Release 的打包链路
> （`prepare-env.js` → `electron-builder.yml` → `app.asar` → 首次启动
> `%APPDATA%\Ecliptrix\.env`）。
> 结论：**20 个真实凭据被打进了安装包内的 `app.asar`**，属于密钥形状的值；
> 发布在打 tag 前被叫停，这些 key 没有被公开分发，但必须全部轮换。
> 姊妹文档：`docs/security/secret-rotation-2026-10-27.md`（同类事件的上一混）。
> 本文只写轮换怎么排、怎么做、怎么收尾，不重复历史重写的收尾工作。

## 0. 适用范围与撰写约束

**本文覆盖**：2026-10-29 这次「构建期把开发机 `.env` 烤进发布产物」的
20 把凭据的轮换、验证与防复发。

**本文不覆盖**：

- 2026-10-27 的公开历史泄露（`git filter-repo` 重写、GitHub GC 请求、
  fork 清理）——见姊妹文档 §4；
- 已废弃凭据（Kimi / Anthropic 兼容网关 / Supabase / SSH / root 密码）——
  见姊妹文档 §2 P2、P3；
- 打包链路本身的代码修复——由并行修复负责，本文只描述它落地后门禁的行为。

**撰写约束（请读者知悉）**：本文在撰写时**没有读取任何 `.env` 文件内容**，
也没有打印、引用、掩码或部分透露任何密钥值。全部判断只来自四处：

1. 各级 `env.template` / `env.template.desktop` 里的**占位符**与注释；
2. `CLAUDE.md` 的 "External API Integrations" 表与 Multi-LLM 表；
3. `desktop/cache/release-prep/readiness.md` 记录的**键名、类型与长度**；
4. 代码里的**变量名**（`app/config.py`、`desktop/scripts/prepare-env.js` 等）。

因此本文对每把 key 的「属于哪个供应商」只到**模板默认值**这一级精度：
真正生效的供应商由 `.env` 里同组的 `*_API_URL` 决定，需运维现场看，
且看的时候不要把值贴到任何文档、issue 或聊天里。

## 1. 事件摘要

### 1.1 事实

| 项目 | 事实 |
|---|---|
| 何时发现 | 2026-10-29，v1.0.0 发布前的 release readiness 审计（`desktop/cache/release-prep/readiness.md`，裁定 `NO-GO`） |
| 怎么发现 | 把新构建的 `desktop/release/win-unpacked/resources/app.asar` 用 `@electron/asar` 在内存里解出 `scripts/env.template.desktop`，逐行统计非占位键值对 |
| 实测 | 该条目含 **62 个非占位键值对**，其中 **20 个是密钥形状**（本次清单），其余为 `*_URL` / `*_MODEL` / `*_API_TYPE` / `LOG_LEVEL` / `ENV` 等非机密项与历史遗留的 `ADMIN_*` |
| 承载路径 | `desktop/scripts/prepare-env.js:118-129` 把开发机根 `.env` 与 `backend-services/basic-service/.env` 合并写入 `desktop/build/env.template.desktop`；`desktop/electron-builder.yml:33-36` 把该文件打进 asar 的 `scripts/env.template.desktop`；`desktop/main/config.js:33-36` 首次启动时 `copyFileSync` 到 `%APPDATA%\Ecliptrix\.env` |
| 为什么是结构性的 | 它不依赖某一次手滑：两台 `.env` 只要在打包机上存在，任何一次 `npm run build` 都复现；`build.js:372` 每次都无条件调用 `prepareEnv()` |
| 处置 | 发布叫停（`v1.0.0` tag 未创建、无 release 资产），改为先修打包链路、先轮换凭据再重新出包 |

### 1.2 关键的范围界定（本事件的定级依据）

**这批 key 没有被公开分发。** 发布在打 tag 之前就被拦下，
没有 release 资产、没有 `latest.yml`、也没有公开链接指向这个安装器。
所以风险面不是「全世界都能读到」，而是下面三者：

1. **打包机本身**：`.env`、`desktop/build/env.template.desktop`、
   `desktop/release/**/app.asar` 三处并存同一批明文，任何能登录这台机器
   （远程桌面、共享目录、备份代理、同步盘）的人或进程都能取到；
2. **离开过这台机器的构建产物**：`desktop/cache/` 下的旧构件、
   `release/` 目录副本、发给别人试装的安装包、上传到网盘/聊天工具的那一份；
3. **同族 key 的第二次曝光**：这 20 个变量名里有 14 个与 2026-10-27
   泄露的是同一批 key 家族（LLM / ARK / 火山 / OSS / Pexels / Unsplash /
   Tavily / Freesound / RunningHub）。如果 10-27 之后只清了仓库没换 key，
   那么这些值**在公开历史里已经可读**，本次只是让它们又落了一份到磁盘上。

### 1.3 已知 / 假定（不要混用）

**已知（有证据）**：

- 打包链路的三段落在代码里成立，行号见上表；
- 新构建的 asar 里确实有这 20 个键名，且值为非占位符；
- 仓库当前没有 `v1.0.0` tag，也没有对应 release 资产；
- 受跟踪文件里没有密钥形状字面量（`python scripts/scan-secrets.py` 退出 0）。

**假定（无法从仓库证明，需人工确认）**：

- 假定这批构建产物**没有**通过任何渠道离开打包机
  （网盘、IM、邮件、U 盘、CI artifact、共享目录）；
- 假定打包机在 2026-10-29 04:49（asar 时间戳）之后没有被非本人登录；
- 假定这些 key 在暴露窗口内没有产生异常调用——这一条必须靠控制台账单
  和访问日志去证实，不能靠「看起来没出事」。
- 上面任一条被推翻，本次定级不变（仍全部轮换），只是要从「预防性轮换」
  改成「已发生滥用的处置」，并按需追加证据留存。

**为什么没有发布也要轮换**：范围界定的不确定项全在假定里，
而轮换是唯一能把假定变成无关的动作用；且 10-27 的先例说明这批 key 家族
一旦落到可读位置，被扫走只是时间问题。

### 1.4 与 10-27 的关键差异

10-27 的泄露载体是**受跟踪的文件**（`.env`、`logs/`、`docs/` 里的调试脚本），
所以「扫仓库」这道门禁是对症的。
本次的载体是**构建产物**——它既不在 git 里，也不在扫描器的可见范围内，
所以旧的扫描门禁在本次事件里**全程是绿的**。这是本文 §5 的核心。

## 2. 风险分级与轮换优先级

### 2.1 排序依据（为什么不是「20 个一起换」）

三把尺子，按顺序判：

1. **权限面**：这把 key 能不能读、改、删别人的数据？能删数据的排最前。
2. **计费攻击性**：拿到它的人在单位时间内能烧掉多少钱？单价高、无并发
   上限、可脚本批量调用的排前面。
3. **凭据性质**：长期有效的账号级凭据（AK/SK、App Secret）比可以一键
   禁停的 API Key 贵——前者泄露后不存在「过期」兜底。
4. **滥用可见度**：免费额度类（素材搜索）被刷的后果基本是当天搜不出结果，
   不涉及数据与金钱，排最后。

P0 是「必须今天做」，P1 是「今天之内做完」，P2 是「本周内做完」。
没有 P3：本次清单里每一把都值得换，只是先后不同。

### 2.2 P0 — 权限面最大 / 账号级凭据

| 服务 | 环境变量 | 为什么在这一级 |
|---|---|---|
| 阿里云 OSS（RAM AccessKey） | `OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET` | 云存储的 AK/SK 是**账号级长期凭据**，没有过期时间；权限通常覆盖整个 bucket 的读、写、删。能读走用户素材、能删除或覆盖对象、能靠外网流出流量和请求次数直接产生费用。泄露后用「改名」「换 bucket 路径」都挡不住，只有禁用 AK 有效。 |
| 火山引擎语音（TTS / ASR） | `VOLCANO_TTS_API_KEY`、`VOLCANO_TTS_ACCESS_TOKEN`、`VOLCANO_TTS_SECRET_KEY`、`VOLCANO_ASR_ACCESS_TOKEN`、`VOLCANO_ASR_SECRET_KEY` | 三条理由叠加：① 按字符/时长计费，脚本可无限刷；② `SECRET_KEY` 是 App 级秘钥，换掉前一直可用；③ voice-clone 链路消费同一批 secret，泄露等于音色可被冒用。另有一个放大器：`app/config.py:915` 在 `VOLCANO_ASR_SECRET_KEY` 缺省时**回落到 `VOLCANO_TTS_SECRET_KEY`**，所以 TTS 那一把泄露会同时打穿 ASR 与声音克隆。 |

### 2.3 P1 — 可直接烧钱 / 可直接消费额度

| 服务 | 环境变量 | 为什么在这一级 |
|---|---|---|
| 火山方舟 ARK | `ARK_API_KEY` | 视频生成（Seedance）与图片生成（Seedream）单价最高的一类调用，一次任务的花费远高于一次对话；泄露后通常表现为「一天之内额度被打空」。 |
| LLM 族（聊天，按组） | `LLM_API_KEY`、`FAST_LLM_API_KEY`、`VIDEO_CUT_LLM_API_KEY`、`VL_LLM_API_KEY`、`AGENT_LLM_API_01_KEY`、`AGENT_LLM_API_02_KEY`、`AI_VIDEO_MATCH_LLM_API_KEY` | 全部是 OpenAI 兼容的 `/chat/completions`，直接按 token 计费；公开泄露的 key 被爬虫收集后通常在数小时内被打满，而且调用来自任意 IP、不需要这把 key 的任何其他信息。`VL_LLM`（`qwen-vl-plus`）与 `AI_VIDEO_MATCH`（`qwen-max-latest`）单价更高，优先于纯文本组。 |
| Tavily | `TAVILY_API_KEYS` | 付费搜索，按 credit 计，能一次打空当月配额；不涉及数据面，但恢复配额要等账单周期或付费。 |
| RunningHub | `RUNNING_HUB_API_KEY` | **待确认，按 P1 处理**。模板注释只写「FLUX 图片生成」，属于按次/按量付费的生成类服务，具备直接烧钱特征；但仓库里已经找不到消费代码（见 §2.5），用不用得起来无法从仓库判定。 |

> 补充判断（来自 readiness 审计记录的长度，不是值）：`LLM_API_KEY`、
> `FAST_LLM_API_KEY`、`VIDEO_CUT_LLM_API_KEY`、`AGENT_LLM_API_01_KEY`、
> `AGENT_LLM_API_02_KEY` 五把长度相同，**很可能是同一把 key 复用在 5 组配置**。
> 如果是，一次轮换覆盖 5 个变量，但要记得把 5 处都换成新值——
> 漏一处会让旧 key 继续生效。

### 2.4 P2 — 免费配额类，影响可见但爆炸半径小

| 服务 | 环境变量 | 为什么在这一级 |
|---|---|---|
| Pexels | `PEXELS_API_KEY` | 免费额度，被刷的直接后果是素材搜索 429、当天做不了片子；不能付费、不能触达用户数据。 |
| Unsplash | `UNSPLASH_ACCESS_KEYS` | 同上；泄漏的公益 API key 还可能被用来刷 demo 额度。 |
| Freesound | `FREESOUND_API_KEY` | 同上，音频检索。 |

这三把仍要换——它们会让对应功能在关键时刻不可用，且与应用 ID 绑定，
不换等于长期替别人承担配额——只是不必占用 P0/P1 的时间窗。

### 2.5 两处必须承认的不确定

**`OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET`：供应商确定，消费方待确认。**
这两把 key **不在**当前两份 `env.template` 里（根模板只有 `AWS_*` 占位符，
后端模板没有 OSS 段），所以它们是在模板之外的键：
`prepare-env.js:80-89` 会把模板里没有的键**追加**为「额外默认凭证」段，
这解释了它们为什么仍进了 asar。同时后端代码里搜不到 OSS SDK 调用
（`oss2` / `aliyun` 均无命中），`CLAUDE.md` 的 Storage 段也明确写了
本地文件系统已取代 Supabase、没有云对象存储步骤。所以：**当前运行时是否
还在用这个 AK，仓库无法证明**。结论不变——按 P0 轮换，因为它能删数据。

**`RUNNING_HUB_API_KEY`：供应商明确，用途与在用状态待确认。**
模板注释与 `CLAUDE.md` 都写 RunningHub 是「FLUX 图片生成」，
根模板还有 `NEXT_PUBLIC_AI_MATERIAL_SERVICE=local|runninghub` 这个开关，
但后端与前端都搜不到 `RUNNING_HUB` 的消费代码。可能已被本地生成取代、
可能只在某个未合并分支里用。按要求**标「待确认，按 P1 处理」**：
先确认是否在用，再决定是吊销还是仅重签。

## 3. 逐个服务的轮换步骤

通用规则，对所有 10 组都适用：

- **吊销 ≠ 重签**。多数控制台允许「新建一把、旧的留着」，
  那不算完成——旧值仍然有效。要**显式删除/停用旧凭据**，
  并在停用后回控制台确认状态是「已禁用/已删除」。
- **先吊销，后写入**。顺序反过来会出现一段「新值还没落盘、旧值已失效」
  的窗口，期间功能全红，容易被误判成配置错误。
- **停用是否即时**：API Key 类基本都是下一次请求就生效（无缓存）；
  云厂商主账号 AK 与 App Secret 类通常也是即时，但**计费与日志的滞后**
  可以到小时级，判断「停用生效」要看请求是否被判 4xx/鉴权失败，
  不要看账单。
- **留证据**：每步在事件记录里留控制台截图/操作时间，但截图里
  不要带新 key 的任何字符。

### 3.1 阿里云 RAM AccessKey（`OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET`）

1. 入口：<https://ram.console.aliyun.com/manage/ak>（RAM → 身份管理 →
   用户 → AccessKey；主账号 AK 在「AccessKey 管理」页，需主账号 + MFA）。
2. **先禁用再删除**：禁用到验证通过（约 1 个业务日）后再删除，
   避免「其实有别处在用」的局面无法回滚。禁用**即时**生效。
3. 新建 AK 时**优先建 RAM 子用户 AK**，只授予该 bucket 的
   `oss:GetObject` / `oss:PutObject` / `oss:ListObjects` 等最小集合，
   而不是继续用主账号 AK；桌面端单用户场景下这把 key 应视为可吊销。
4. 附带动作用于轮换后立刻做（不是可选）：
   - **OSS 访问日志 / 操作审计**：查 bucket 的访问日志与
     ActionTrail，筛出非本人 IP、非本人时段的对象读写与删除记录；
   - **费用中心**：按 `OSS` 产品筛近 7 天账单，重点看外网流出流量与
     请求次数是否直线上升；
   - **对象清单**：抽查 bucket 顶层是否有非本人写入的对象
     （勒索类滥用会留下加密后的对象名）。
5. 若发现异常访问：按事件处理升级（保留日志、评估是否已删除/外泄数据），
   而不是仅换 key 了事。

### 3.2 阿里云百炼 DashScope（LLM 族，模板默认值）

模板默认 `LLM_API_URL` / `FAST_*` / `VIDEO_CUT_*` / `VL_*` /
`AGENT_LLM_API_0X_URL` / `AI_VIDEO_MATCH_LLM_API_URL` 全部指向
`https://dashscope.aliyuncs.com/compatible-mode/v1`。

1. **先确认实际供应商**：打开 `.env`（只看 `*_API_URL` 那一行，不要复制 key），
   确认每个分组指向的 host。若某组已被改成别家（智谱 `open.bigmodel.cn`、
   Moonshot、自建网关等），该组改到对应平台轮换，见 §3.3。
2. 入口：<https://bailian.console.aliyun.com/> → API-KEY 管理。
   删除旧 key（**删除而不是只新建**），复制新 key 时只写进 `.env`。
3. 停用即时生效；旧 key 删除后调用立刻 401。
4. 附带动作：百炼控制台的用量/账单页确认近 7 天无异常 token 曲线；
   若同一把 key 复用了 5 组配置（见 §2.3 注），改完 5 处再重启。

### 3.3 非百炼的 OpenAI 兼容供应商（仅当 §3.2 第 1 步发现时）

- 智谱 GLM：<https://bigmodel.cn/usercenter/apikeys>，删除旧 key。
  （模板 `AGENT_LLM_API_0X_TYPE=anthropic` 的示例注释指向
  `https://open.bigmodel.cn/api/anthropic`，说明历史上有 agent 组用智谱。）
- Moonshot / Anthropic 兼容网关 / 其他自建网关：到各自控制台的
  「API Key」页吊销；自建网关则改网关侧的密钥表并重启网关。

### 3.4 火山引擎方舟 ARK（`ARK_API_KEY`）

1. 入口：<https://console.volcengine.com/ark> → API Key 管理
   （或「在线推理 → API Key」）。删除旧 key、新建，绑定到同一 endpoint。
2. 停用即时生效，下一次推理即失败。
3. 附带动作：方舟侧用量记录/账单看近 7 天视频（Seedance）与
   图片（Seedream）生成任务数；异常量大说明已被利用。
4. 注意：`CLAUDE.md` 记载 ARK SDK 无 cancel 方法，远端任务会跑完才结束——
   轮换前已经提交的生成任务仍会继续消耗，不要把这部分计费误判成新泄露。

### 3.5 火山引擎语音 TTS / ASR（5 个变量）

1. 入口：<https://console.volcengine.com/speech/app>（语音技术 → 应用管理）。
2. 处理顺序建议 TTS 先、ASR 后，因为 ASR 会在缺省时回落复用 TTS 凭据：
   - `VOLCANO_TTS_API_KEY`：新版控制台「API Key 管理」里的一把 key
     （V3 `/api/v3/tts/unidirectional` 用它鉴权）。删除旧的，新建。
   - `VOLCANO_TTS_ACCESS_TOKEN` / `VOLCANO_TTS_SECRET_KEY`：
     旧版控制台的 App 的 Access Token 与 Secret Key，在应用详情页
     「重置/更新」。**Secret Key 重置后旧值立刻失效**，且无法查看只能重置。
   - `VOLCANO_ASR_ACCESS_TOKEN` / `VOLCANO_ASR_SECRET_KEY`：如果这两个
     变量在 `.env` 里是留空的（模板注释说留空会回落到 `VOLCANO_TTS_*`），
     那么轮换 TTS 的 token/secret 就已经覆盖了 ASR 链路，**但要在
     `.env` 注释里记一句**，避免下次误以为 ASR 是独立凭据；
     如果两者都有独立值，必须分别重置。
3. 停用即时生效。
4. 附带动作：语音控制台的用量/账单看近 7 天字符数与识别时长；
   **检查音色列表**里是否多出非本人创建的音色（voice-clone 被冒用的痕迹）。
5. 顺序注意：先重置 secret/token 再改 `.env`，否则中间会有一次
   「TTS 全红」的误报。

### 3.6 Tavily（`TAVILY_API_KEYS`）

1. 入口：<https://app.tavily.com/home> → API Keys。删除旧 key、新建。
   模板里该变量支持逗号分隔多把，**每一把都要删**。
2. 停用即时；旧 key 删除后搜索请求返回 401。
3. 附带动作：同一页看当月 credit 用量，若已接近上限，
   说明可能被刷，按需重置计费周期前的配额策略。

### 3.7 RunningHub（`RUNNING_HUB_API_KEY`）— 待确认

1. **先确认在用状态**：全局搜 `RUNNING_HUB` 与
   `NEXT_PUBLIC_AI_MATERIAL_SERVICE=runninghub`，看是否有运行时分支会读它。
   找不到消费方，就按「已废弃」处理：只吊销、不重签。
2. 入口：<https://www.runninghub.cn/> → 用户中心 → API（具体页名以站点
   为准）。删除旧 key。
3. 停用即时生效。
4. 附带动作：看该账号的任务记录/余额，异常任务数说明已被使用。
5. 若确认在用：新建 key，写进后端 `.env`，并做一次 FLUX 生成验证。

### 3.8 Pexels / Unsplash / Freesound（素材检索三件套）

| 服务 | 环境变量 | 入口 | 注意 |
|---|---|---|---|
| Pexels | `PEXELS_API_KEY` | <https://www.pexels.com/api/> | 模板支持逗号分隔多 key，**逐个**删除（审计记录的长度显示可能是多把拼接，不要只换第一把） |
| Unsplash | `UNSPLASH_ACCESS_KEYS` | <https://unsplash.com/oauth/applications> | 删除旧的 Application 或轮换其 Access Key；`ACCESS_KEYS` 也是复数形式 |
| Freesound | `FREESOUND_API_KEY` | <https://freesound.org/apiv2/apply/> | 在账号的 API credential 页重置 |

三者都是即时生效、删除旧值即失效。附带动作：各自控制台看当月
请求数/配额消耗，确认没有被刷到 429。
Unsplash 的 Demo 额度被刷还可能触发应用封禁，值得优先处理。

### 3.9 桌面端残留副本（不是供应商，但同属轮换动作）

首次启动时 `main/config.js` 把模板复制到 `%APPDATA%\Ecliptrix\.env`，
**升级不覆盖**。所以旧值会一直躺在这台机器的
`%APPDATA%\Ecliptrix\.env` 里，并且应用内的「设置 → 模型与凭据」
把 key 写进 SQLite（`%APPDATA%\Ecliptrix\data\ecliptrix.db` 的
`model_settings` 表）。两处都要更新，否则旧 key 仍在被读。
另外 `desktop/build/env.template.desktop`、
`desktop/release/**/app.asar`、`desktop/cache/` 里的旧构件要删除，
别留着当「备份」。

## 4. 轮换后的落地步骤

### 4.1 新值写到哪里

| 位置 | 用途 | 是否入库 |
|---|---|---|
| 仓库根 `.env` | 前端 Next.js 侧（`LLM_*`、`AI_VIDEO_MATCH_*`、`BACKEND_URL`） | 否，`.gitignore` 已屏蔽 |
| `backend-services/basic-service/.env` | 后端 FastAPI 侧（ARK / 火山 / Pexels / Tavily / Freesound 等无 UI 的 key 只在这里） | 否 |
| `%APPDATA%\Ecliptrix\.env` | 已安装应用的运行时副本 | 否（本机应用数据） |
| SQLite `model_settings`（设置 → 模型与凭据） | 应用内的模型配置，优先级高于 `.env` | 否（本机数据库） |
| 各级 `env.template` / `.env.example` | **只放占位符**，永不写真实值 | 是，提交 |

写完立刻做两条自查（都在仓库根执行）：

```cmd
git status --porcelain
```

预期：`.env` 不出现（被忽略）。若出现，说明它被误加入跟踪，停下来修。

```cmd
npm run scan:secrets
```

预期：`[scan] OK: no credential-shaped literal found`。
注意这条命令的**能力边界**见 §5.3——它通过不代表产物干净。

### 4.2 功能验证（按依赖顺序）

先起服务再验。后端（`backend-services/basic-service/`，venv 已激活）：

```cmd
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

| 验证项 | 命令 | 通过标准 |
|---|---|---|
| 后端健康 | `curl http://127.0.0.1:8000/api/health` | `status: healthy` |
| 能力状态（密钥是否被认到） | `curl http://127.0.0.1:8000/api/config/capability-status` | 核心能力 `chat` / `fast` / `video_cut` / `vision` 均为 `ready`；`research` / `web_search` 视是否配置 |
| TTS 配置 | `curl http://127.0.0.1:8000/api/tts/health` | `status: healthy` |
| TTS 实际合成 | 应用里对一段脚本做一次语音生成 | 产出音频、无 401/403 |
| 视频搜索 | `curl http://127.0.0.1:8000/api/video/search/health` | `healthy`（配置了 Pexels 才有意义） |
| 图片搜索 | `curl http://127.0.0.1:8000/api/image/health` | `healthy`（Unsplash） |
| ASR 字幕 | 应用里对一段短音频转录 | 出字幕、无鉴权错误 |
| 一次对话调用 | 前端 `npm run dev`（:3000）后在聊天里发一句 | 正常返回（`src/app/api/chat/route.ts` 直连 `LLM_API_URL`，走的是新 key） |
| ARK 生成 | 应用里发起一次最小的 AI 图片生成 | 任务能提交并回收结果 |
| Tavily / 研究 | 应用里查一次网络资料 | 有结果、无 401 |

**OSS 依赖流程：本轮没有。** 仓储已是本地文件系统
（`CLAUDE.md` Storage 段：`STORAGE_ROOT` 下本地目录，无云对象存储步骤），
后端代码里也没有 OSS SDK 调用。所以 OSS 的「验证」等于
**确认全仓 0 处运行时引用**，而不是跑通某条业务流；若将来重新引入
云存储，那一步必须补进本文档。

### 4.3 公开版必须在不含 `.env` 的前提下打包

这是本次事件的核心纪律：

- 打包链路已改成**默认安全**：不设任何变量时 `prepare-env.js` 走
  `mode=public-safe`，把密钥类值替换成占位符，非敏感默认值（URL、
  模型名）保留。因此公开构件的正确做法是「什么都不设，直接构建」，
  构建日志第一行必须是 `[prepare-env] mode=public-safe (placeholders only)`。
- **绝对不要**为公开构件设 `ECLIPTRIX_BUNDLE_SECRETS`（`1` / `true` /
  `yes` / `on`）。它只用于维护者的私用安装包，一旦设置，
  `prepare-env.js` 会打印 `WARNING: bundling the build machine's REAL
  credentials`，那条警告出现即视为发布阻断信号（§5.1）。
- 仍建议在打包时把两个源 `.env` 移出仓库目录：这不是流程要求，
  而是让「万一有别的步骤读 `.env`」也拿不到东西；移出后
  `prepare-env.js` 会走「未找到源 `.env`」的最简路径。
- 打包后必须核对产物本身，而不是只核对 `build/`。
  门禁就位后在 `desktop/` 下跑一次，退出码必须为 0：

  ```cmd
  node scripts/verify-no-bundled-secrets.js
  ```

  未接入构建前，手工等价做法是解出
  `release/win-unpacked/resources/app.asar` 的
  `scripts/env.template.desktop`，确认密钥形状值数为 **0**（§5.2）。
  无论哪种做法，输出都要附到发布证据里。
- 发布证据里要记下：产物 sha256、`research-build-manifest.json` 的
  `source_head`、asar 检查结果。三者缺一不发布。

## 5. 防复发

### 5.1 Gate A — 打包前断言（`prepare-env.js` / `build.js`）

**默认行为变了**：`prepare-env.js` 现在有两个模式，由环境变量
`ECLIPTRIX_BUNDLE_SECRETS` 决定，**默认是安全的那一个**：

| 模式 | 触发条件 | `build/env.template.desktop` 的内容 |
|---|---|---|
| `public-safe`（默认） | `ECLIPTRIX_BUNDLE_SECRETS` 未设置或不是真值 | 密钥类变量的值一律替换成占位符（`your_*_here`，优先沿用模板里已写的那个），URL / 模型名 / 区域与音色 id 等非敏感默认值保留 |
| `private-bundle`（需显式开启） | `ECLIPTRIX_BUNDLE_SECRETS=1`（也接受 `true` / `yes` / `on`） | 与旧行为一致：把开发机 `.env` 的真实值烤进模板 |

即：**忘记设置就不会泄露**——这是与本事件根因方向相反的设计，
也正是我们要的不对称。

**断言本身**：`prepare-env.js` 在 `public-safe` 模式下写完文件后，
立刻用共享判定器 `findSecretShapedPairs()` 复扫自己刚生成的内容，
命中即抛错（`public-safe template still carries secret-shaped values`），
进程非零退出；`build.js` 在 `prepareEnv()` 之后、调用 `electron-builder`
之前再做一次同样的断言，除非 `isBundleSecretsOptedIn()` 为真。
两道都在 `electron-builder` 之前，所以**安装器根本不会生成**。

**日志长什么样**（运维据此判断本次构建是哪种模式）：

```text
[prepare-env] mode=public-safe (placeholders only)
[prepare-env] N default key(s) from 2 source .env file(s) → build/…
[prepare-env] redacted 20 secret-shaped key(s) to placeholders: LLM_API_KEY, ...
```

`private-bundle` 模式下第二行会变成一条 `WARNING: bundling the build
machine's REAL credentials ... Never publish this package.`。看到这条警告
就不许发布——它出现的原因只有一个：有人显式设了那个变量。
脱敏列表只打印**键名**，不打印值，所以日志可以留档。

**为什么在这一层**：泄露发生在「构建期把开发机 `.env` 写进产物」这一步，
此处是唯一能在源头拦住的点——产物还没生成，没有清理成本，
也不会出现「已经传上去了才发现」。

**何时可以放开（回退条件）**：断言只对
`ECLIPTRIX_BUNDLE_SECRETS` 未开启的情形强制。**构建私用安装包**
——明确不发布、不上传、不共享给第二个人——时才允许显式设该变量绕过；
公开构件的路径上不得设置它，控制台上也不许把它写进 CI 的默认环境。
如果哪天产品决定「安装包必须内置开发方的默认额度」（2026-05 那次
零配置决策复活），前提条件同时变成：那批内置额度必须是
**可公开的、有额度上限的、独立的低权限凭据**，
而不是主账号 AK / App Secret 这一类账号级凭据。

### 5.2 Gate B — 打包后 asar 扫描（`desktop/scripts/verify-no-bundled-secrets.js`）

**做什么**：在打包完成后打开**真实产物**（默认
`desktop/release/win-unpacked/resources/app.asar`，也可显式传路径），
列出其中所有 env/config 形状的条目——`scripts/env.template.desktop`
以及任何 `.env`、`env.template*`、`*.env` 条目——逐个交给共享判定器
`desktop/scripts/lib/secret-shape.js` 的 `findSecretShapedPairs()`；
命中密钥形状即失败。

用法（在 `desktop/` 下）：

```cmd
node scripts/verify-no-bundled-secrets.js
node scripts/verify-no-bundled-secrets.js <path-to-app.asar> --json
```

**退出码**：`0` 干净、可以发布；`1` 发现密钥形状值 —— **不要发布**；
`2` 无法检查（参数错误、asar 不存在、条目读不出、判定器模块缺失）——
同样按门禁失败处理，因为「脏」和「不知道」不能合并成同一个信号。

**判定规则**（`lib/secret-shape.js`，任一命中即算密钥）：非空、不匹配
占位符形状（`your_*_here`、`x+`、`<...>`、`change_me`、
`test/example/dummy/fake/sample/placeholder/none/null`、全 `0`、
`EXAMPLE`）、不是纯 URL、且满足其一：`scheme://user:pass@host` 形态、
命中供应商值形状（`sk-` / `tvly-` / `LTAI` / `AKIA` / `ghp_` /
`AIza` / JWT / PEM 头）、或「键名含
`KEY|SECRET|TOKEN|PASSWORD|PASSWD|ACCESS|CREDENTIAL` 且值长度 ≥ 16」。
`_URL` / `_MODEL` / `_TYPE` / `_LEVEL` / `_PATH` 这类后缀的键名被显式
排除，所以 `*_API_URL`、`*_MODEL`、`RESOURCE_ID` 不会误报——
这一点很重要，误报会诱发「把门禁关掉」。

**报告只输出键名与值的长度，永不输出值**，所以失败日志可以直接贴进
工单或发布证据。

**为什么还要第二道**：Gate A 只看一个输入文件，Gate B 看**最终产物**
——它能覆盖 `electron-builder.yml` 的 `files` 映射变化、
`extraResources` 误收、以及「Gate A 之后又有别的步骤把东西塞进 asar」
这类情况。两道门禁检查的不是同一个对象，不能互相替代。

**何时可以放开（回退条件）**：**没有放宽条件**。唯一可以移除它的情形是
asar 里不再包含任何 env 模板（那时删除该脚本与它的测试，并在发布清单里
写明由哪条检查替代）。这条门禁的失败必须按「阻止发布」处理，
不允许手动跳过；退出码 `2` 同样阻断。

### 5.3 核心教训（一句话）

**`scripts/scan-secrets.py` 只扫 `git ls-files` 列出的受跟踪文件，
所以它永远无法发现构建产物里的泄露——10-27 加的这道门禁在本次事件里
全程是绿的。**

这不是扫描器写错了，而是它的作用域定义决定的：
`build/`、`release/`、`app.asar` 都不在 `git ls-files` 里，
扫描器连文件都看不到。由此得到一条判断规则：
**任何「只在源码树内生效」的检查，都不能用来证明「发布物是干净的」；
发布物的干净只能用发布物自己来证明。**
下次再有人问「扫描器绿了为什么还要查 asar」，答案就是这句话。

### 5.4 门禁清单

| 措施 | 位置 | 覆盖范围 |
|---|---|---|
| 打包前断言（新增） | `desktop/scripts/prepare-env.js` / `build.js` | `build/env.template.desktop` 的输入内容 |
| 打包后 asar 扫描（新增） | `desktop/scripts/verify-no-bundled-secrets.js`（判定器 `desktop/scripts/lib/secret-shape.js`） | 最终产物 `app.asar` 内所有 env/config 条目 |
| 密钥形状扫描（10-27 起） | `python scripts/scan-secrets.py`（`npm run scan:secrets`） | **仅**受跟踪文件 |
| 全历史扫描（10-27 起） | `python scripts/scan-secrets.py --history` | git 对象库 |
| pytest 门禁（10-27 起） | `backend-services/basic-service/tests/security/test_05_secrets.py` | 受跟踪文件 |
| `.gitignore` 屏蔽 | 根 `.gitignore`（`.env*`）、`desktop/.gitignore`（`build/`） | 阻止误提交 |

补充建议（不是本次事件的必要条件）：发布流程里加一条人工勾选——
「本次构件的 asar 检查输出已附在 release 证据里」。
自动化门禁挡的是「忘了跑」，人工勾选挡的是「跑了但没人看」。

## 6. 待办清单

按优先级从上到下做，每条一行、一个动作。

**P0 — 今天**

- [ ] 阿里云 RAM 控制台：禁用 `OSS_ACCESS_KEY_ID` 对应的 AK（验证通过后再删除）。
- [ ] 阿里云 RAM 控制台：签发新的**子用户** AK，只授予该 bucket 的最小权限。
- [ ] 阿里云 OSS 控制台：查 bucket 访问日志与 ActionTrail，找非本人读写/删除记录。
- [ ] 阿里云费用中心：核对近 7 天 OSS 外网流量与请求数，异常即升级为事件。
- [ ] 火山语音控制台（speech/app）：删除旧 `VOLCANO_TTS_API_KEY` 并新建。
- [ ] 火山语音控制台：重置 TTS App 的 Access Token 与 Secret Key。
- [ ] 火山语音控制台：`VOLCANO_ASR_*` 有独立值则分别重置，留空则补注释。
- [ ] 火山语音控制台：查音色列表有无非本人音色，核对字符数/时长账单。

**P1 — 今天之内**

- [ ] 火山方舟控制台（`console.volcengine.com/ark`）：删除旧 `ARK_API_KEY` 并新建。
- [ ] 火山引擎费用中心：核对近 7 天 Seedance / Seedream 任务量与计费。
- [ ] 百炼控制台（bailian.console.aliyun.com）：删 7 组旧 key，先确认是否同一把。
- [ ] 逐个确认 7 组 `*_API_URL` 的 host；任何非百炼的组到对应供应商控制台另行吊销。
- [ ] 百炼控制台（或对应供应商）：核对近 7 天 token 用量曲线有无异常尖峰。
- [ ] Tavily（`app.tavily.com/home`）：删除旧 `TAVILY_API_KEYS`（逗号分隔的每一把）。
- [ ] RunningHub（runninghub.cn 用户中心→API）：先确认在用，再定吊销或重签。
- [ ] RunningHub：**待确认，按 P1 处理**，未确认前不得跳过。

**P2 — 本周之内**

- [ ] Pexels（`pexels.com/api`）：删除旧 `PEXELS_API_KEY`（可能多把）。
- [ ] Unsplash（unsplash.com/oauth/applications）：重置应用 Access Key。
- [ ] Freesound（`freesound.org/apiv2/apply`）：重置 `FREESOUND_API_KEY`。
- [ ] 三家素材服务：各自确认当月配额未被刷到 429 / 未被封禁。

**收尾（轮换全做完之后）**

- [ ] 把新值写入仓库根 `.env` 与 `backend-services/basic-service/.env`（不入库）。
- [ ] 更新 `%APPDATA%\Ecliptrix\.env` 与「设置 → 模型与凭据」（SQLite `model_settings`）。
- [ ] 跑 `git status --porcelain` 与 `npm run scan:secrets`，两者都干净。
- [ ] 按 §4.2 验证：`/api/health`、`capability-status`、`tts/health`、对话、TTS、ARK。
- [ ] 删旧构件：`build/env.template.desktop`、`release/**`、`cache/` 里旧 asar。
- [ ] 不设 `ECLIPTRIX_BUNDLE_SECRETS` 重新打包，日志须是 mode=public-safe。
- [ ] 在 `desktop/` 跑 `verify-no-bundled-secrets.js`，退出码必须为 0（未接线前手工）。
- [ ] release 负责人把 asar 检查结果与 sha256 记入 readiness.md（本文不改）。
- [ ] 复核 §1.3 的三条假定（产物是否离开过打包机、有无非本人登录），把结论写进事件记录。
- [ ] 24 小时后再看一遍各控制台用量，确认没有仍在走旧 key 的流量。

## 7. 未确认事项（落地前必须补齐）

1. **`build.js` 侧断言的落地状态**：`prepare-env.js` 的模式开关与
   `public-safe` 自查已落地（见 §5.1）；`build.js` 目前只完成了 import
   （`isBundleSecretsOptedIn` / `findSecretShapedPairs` /
   `formatSecretFindings`），`prepareEnv()` 之后的那次断言尚未写进
   `main()` 的构建序列。落地前，**以构建日志第一行判断模式**，
   并在打包后手工跑 §5.2 的门禁。
2. **Gate B 的接入位置**：`verify-no-bundled-secrets.js` 与判定器
   `lib/secret-shape.js` 已在工作树中（含测试），判定规则见 §5.2：
   `*_URL` / `*_MODEL` / `*_API_TYPE` / `LOG_LEVEL` / `ENV` /
   `RESOURCE_ID` 属允许项、`your_*_here` 属占位符，因此不会误报。
   仍待补齐的是**接线**：确认它被 `build.js`（或发布流程）以
   「退出码非 0 即阻断」的方式调用，而不是只放在那里等人手动跑。
   在接线完成之前，§4.3 与 §6 的手工执行是必须的。
3. **`OSS_ACCESS_KEY_*` 的真实消费方**（§2.5）：若确认已无引用，
   轮换后应当在两份 `env.template` 里都不要重新引入这两个键名，
   避免下一次打包又把它们带回来。
4. **`RUNNING_HUB_API_KEY` 的在用状态**（§2.5）：确认放在哪儿用、
   用什么计费模式，再决定它是 P1 还是可以降级为「只吊销」。
5. **是否存在模板之外的其它键**：`prepare-env.js:80-89` 会把 `.env` 里
   模板没写到的键追加为「额外默认凭证」。本次 asar 里 62 个非占位键
   中有 42 个不在本文清单（URL/模型/类型等非机密项，另有历史遗留
   `ADMIN_*`）。这 42 项已逐个判为非机密，但**机制上**它意味着
   「模板清单 ≠ 实际打包内容」——这条不对称应当在修复里被堵掉
   （Gate A 断言的是产物内容，而不是模板内容）。

---

## 8. 发布结果（2026-10-29 收尾，发布后补记）

本节只补一件事：**真正发布出去的是哪一份字节，它干净不干净。** 上面各节
写于修复落地之前、发布之前，判断与清单不需要改；这里给读者一个可以用来
对照线上附件的锚点。

### 8.1 实际发布的产物

- 安装包：`Ecliptrix-Setup-1.0.0.exe`，**248,742,032 B**
- sha256：`537633e51bb81a5665ae90f3e442952f1a770247e7f2087d9807a2de3234e203`
- GitHub Release：`v1.0.0`，tag 指向 `496c4d59`；API 里该附件的
  `size` / `digest` 与上面两行逐字一致。

### 8.2 这一份是干净的（发布件自己证明）

在 `desktop/` 下对**成品** asar 跑 §5.2 的 Gate B：

```text
[verify-no-bundled-secrets] asar: …\release\win-unpacked\resources\app.asar
[verify-no-bundled-secrets] scanned 1 entry/entries: scripts/env.template.desktop
[verify-no-bundled-secrets] OK: no secret-shaped value in 1 scanned entry/entries
```

退出码 0（干净）。上面三行是今日复测的逐字输出，只把绝对路径缩成 `…`。

同一台机器上的构建日志（`desktop/cache/build-logs/public-build-2.log`）
三个标记齐备：`mode=public-safe`、`redacted 21 secret-shaped key(s)`、
`[assert] env.template.desktop: 0 secret-shaped values`。所以
**线上那一份不是 §1 里泄漏的那一份**：体积只差几百字节，别用大小认，
认 sha256。

### 8.3 不要混淆的三份字节

| 字节 | 状态 |
|---|---|
| 248,742,450 B / `a4b39a40…` | 带 21 个密钥形状值的旧构建，**禁止分发** |
| 248,742,693 B / `bdb0b07e…` | 同一天的中间构建，同样**禁止分发** |
| 248,742,032 B / `537633e5…` | **已发布**（本文 8.1） |

### 8.4 §7 里已过期的两条

§7 第 1、2 条写的是「`build.js` 的断言未写进 `main()`」「Gate B 的接线待
补齐」。**两条都已落地**（提交 `dca783aa`）：Gate A 已在 `build.js` 的
`prepareEnv()` 之后、`electron-builder` 之前自动执行（`build.js:291` 实测）；
Gate B 仍是**发布时手工执行**，但 `publish-plan.md` 把它定为硬门禁——exit 1
（脏）与 exit 2（检查不了）都必须停。所以 §6「收尾」那一步从「可选项」变成
「发布阻断项」。产物侧的证据就是 8.2 那个 exit 0。

### 8.5 仍未确认

- **轮换本身没做**：§6 的 P0/P1/P2 清单一条都没勾。发布不等于凭据安全——
  那 20 把 key 仍在打包机上、仍需要换。
- 本文 §1.3 的三条假定（产物没离开打包机、打包机无他人登录、无异常调用）
  **依然没有任何一条被证实或推翻**。
- `scan-secrets.py` 在 head 上复测为绿（2428 个受跟踪文件，exit 0），但那道
  门禁扫的仍然只是受跟踪文件，对产物没有证明力（§5.3）。
