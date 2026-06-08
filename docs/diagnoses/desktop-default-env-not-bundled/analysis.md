# 桌面端打包未内置默认 `.env` 凭证 — 问题定位与分析

> 子任务 #0（问题定位与分析）产出物。本节点**不写修复代码、不执行 `git commit`**。
> 关联：`docs/plans/desktop-electron-packaging/spec.md`、`desktop/README.md`。

- **Bug slug**：`desktop-default-env-not-bundled`
- **分类**：桌面端打包 / 配置注入（需求与现有「零配置」设计冲突）
- **影响版本**：当前 `feat/api-authz-rate-limiting` 分支上的 `desktop/` 打包链路

---

## 一、问题描述（Problem description）

用户诉求（见 `task-board.md` Original Task）：

> 项目的 `.env` 以及 `backend-services/basic-service/.env` 的配置，打包桌面端的时候要一同打包进去，作为**默认配置**。除非用户后续在设置中修改、再更新对应的桌面端配置，否则就使用这些默认配置，包括各种第三方服务器，使用这些默认的凭证信息。

期望行为：桌面安装包**开箱即用** — 内置开发方提供的真实第三方凭证（LLM、ByteDance ARK、火山 TTS/ASR、Pexels、Unsplash、Tavily、Freesound、RunningHub、OSS 等），用户不填任何 key 即可使用全部 AI / 素材功能；仅当用户在应用内或 `.env` 中改了某项，才以用户值覆盖默认值。

实际行为：当前打包链路**刻意排除**真实 `.env`，安装后所有第三方凭证为空。桌面端 `README.md:96` 甚至把这一点作为卖点宣传：「打包产物双击即开——**不需要预先配置任何 API key**」。这与用户诉求完全相反 —— 安装后 AI / 素材类功能因缺少凭证而不可用，必须用户自行逐项配置。

本质上这不是「代码崩溃」型 bug，而是**现有「零配置 / 自带 key（BYO-key）」设计与「内置默认凭证」需求之间的方向性冲突**。下文按 bug 定位流程给出证据链与候选修复方案。

---

## 二、复现步骤（Reproduction steps）

> 任意一台**未配置过** Ecliptrix 的 Windows 机器即可复现；无需真机安装，读构建脚本与首启逻辑即可确认。

### 路径 A：实跑安装包（端到端复现）

1. 在已放置真实 `.env` 与 `backend-services/basic-service/.env` 的打包机上执行：
   ```powershell
   cd desktop
   .\build.ps1 -Dir          # 仅产出 release/win-unpacked/，迭代最快
   ```
2. 安装 / 解包后启动 `release/win-unpacked/Ecliptrix.exe`。
3. 打开用户数据目录 `%APPDATA%\Ecliptrix\.env`，观察其内容。
   - **预期（用户诉求）**：内含真实 `LLM_API_KEY`、`ARK_API_KEY`、`VOLCANO_TTS_API_KEY`、`PEXELS_API_KEY` 等。
   - **实际**：只有占位符（`LLM_API_KEY=your_llm_api_key_here` 等），无任何真实凭证。
4. 用 `admin` / `change_me_on_first_run` 登录，调用任一 AI / 素材功能（如对话、视频搜索、TTS）。
   - **实际**：因凭证缺失而失败或降级；`llm-status` 返回「未配置」。

### 路径 B：静态验证（无需打包，秒级复现根因）

```bash
# 1) 真实凭证确实存在于源 .env，但 COPY_ENTRIES 不含 .env
grep -n "COPY_ENTRIES" desktop/scripts/prepare-backend.js          # 行 17：无 '.env'
# 2) 构建脚本写入的是「空哨兵」.env
grep -n "Intentionally empty" desktop/scripts/prepare-backend.js   # 行 69
# 3) 首启播种用的模板只有占位符
grep -n "your_.*_here" desktop/scripts/env.template.desktop        # 多行命中
# 4) 启动器主动剥离占位符
grep -n "PLACEHOLDER_PATTERN" desktop/main/envCheck.js             # 行 11 / 57
```

四条命中即证明：**真实凭证从未进入打包产物**，首启播种的是占位符模板，且占位符还会被启动器二次剥离。

---

## 三、根因分析（Root cause analysis，含证据）

桌面端配置有「构建期组装」与「运行期注入」两条链路。真实默认凭证在**构建期就被排除**、在**运行期播种为占位符**，共四处机制叠加导致诉求落空。

### 机制 1 — 构建期不拷贝真实后端 `.env`

`desktop/scripts/prepare-backend.js:15-17`：

```js
// Only what the runtime needs — venv/, tests/, alembic/ (desktop relies on
// create_all, spec §2.4), static/, logs/ and .env stay out by omission.
const COPY_ENTRIES = ['app', 'config', 'run.py', 'requirements.txt', 'env.template']
```

`COPY_ENTRIES` 明确**不含 `.env`**，注释直言「`.env` stay out by omission（按省略排除）」。因此源文件 `backend-services/basic-service/.env`（含真实 `ARK_API_KEY=0fe6efc8-...`、`VOLCANO_TTS_API_KEY=27a0b03b-...`、`PEXELS_API_KEY=kwHTQ...` 等，见该文件 64-95 行）从不进入 `build/backend/`。

### 机制 2 — 构建期主动写入「空哨兵」`.env`

`desktop/scripts/prepare-backend.js:64-73`：

```js
// Sentinel: config.py's load_dotenv() walks UP from app/ until it finds a
// .env — without this stub it can swallow a stray up-tree .env ...
fs.writeFileSync(
  path.join(destDir, '.env'),
  '# Intentionally empty. Desktop backend config is injected by Electron\n' +
    '# from %APPDATA%/ecliptrix-desktop/.env — do not put keys here.\n'
)
```

后端 `app/config.py:12` 启动即 `load_dotenv()`（会自下而上寻找 `.env`）。该哨兵的存在使后端在自身工作目录读到的是**一个空 `.env`**，从源头封死了「后端直接从打包内 `.env` 读默认凭证」这条路。设计上后端配置被规定为「only 由 Electron 从 `userData/.env` 注入」。

### 机制 3 — 首启播种模板只含占位符

打包入 asar 的首启模板 `desktop/scripts/env.template.desktop` 全部是占位符，例如：

- `env.template.desktop:23` `LLM_API_KEY=your_llm_api_key_here`
- `env.template.desktop:65` `PEXELS_API_KEY=your_pexels_api_key_here`
- `env.template.desktop:69` `ARK_API_KEY=your_ark_api_key_here`
- `env.template.desktop:78` `VOLCANO_TTS_API_KEY=your_volcano_tts_api_key_here`

首启时 `desktop/main/config.js:33-37` 把该模板原样复制为 `userData/.env`：

```js
const envPath = path.join(userDataPath, '.env')
if (!fs.existsSync(envPath)) {
  fs.copyFileSync(envTemplatePath, envPath)   // 模板 → %APPDATA%\Ecliptrix\.env
}
```

即用户数据目录里的 `.env` **首启即只有占位符**，没有任何真实默认凭证。

### 机制 4 — 运行期剥离占位符（即便填了占位符也注入不进去）

`desktop/main/envCheck.js:11` 与 `:49-61`：

```js
const PLACEHOLDER_PATTERN = /^your_.*_here$/i
...
for (const [key, value] of Object.entries(raw)) {
  if (PLACEHOLDER_PATTERN.test(String(value).trim())) continue   // 占位符整条丢弃
  env[key] = value
}
```

`loadUserEnv()` 把所有 `your_*_here` 占位条目剔除，避免「假凭证」注入子进程。叠加机制 3，结果是首启后 `userEnv` **几乎不含任何第三方 key**。

> 注：本机制对**真实值无害** —— 真实 key（如 `102d0671...`、`0fe6efc8-...`）不匹配 `^your_.*_here$`，会原样通过。也就是说**运行期注入管线本身已支持真实凭证，缺的只是「播种数据是占位符」**。这一点对修复方案的选择很关键（见第六节）。
>
> **评审补强（子任务 #1 实测）**：上述「注入管线对真实值无害」此前仅有「占位符正则不匹配真实值」这一间接论据，证据偏薄。已补齐端到端硬证据：
> 1. 后端确实从**进程环境变量**读取这些 key，而非只从 `.env` 文件：`app/config.py:768` `pexels_api_key_str = os.getenv("PEXELS_API_KEY", "")`、`:1023` `llm_api_key=os.getenv("LLM_API_KEY", "")`、`:1044` `volcano_tts_api_key=os.getenv("VOLCANO_TTS_API_KEY", "")`、`:1078` `ark_api_key=os.getenv("ARK_API_KEY", "")`。注入到 `spawn env` 的 `userEnv` 即落入子进程 `os.environ`，`os.getenv` 直接取得。
> 2. 机制 2 的空哨兵**不会清掉**已注入的真实值：`backendService.js:18-22` 注释明确「python-dotenv never overwrites variables that already exist in the process environment」（即 `load_dotenv()` 默认 `override=False`），且哨兵内容为空、本就无值可写。故 `config.py:12` 的 `load_dotenv()` 读到空哨兵后，`os.environ` 中由 `userEnv` 注入的真实 key 安然存活。
>
> 因此完整链路 **真实模板 → `userData/.env` → `loadUserEnv`（真实值不被剥离）→ `userEnv` → spawn env → 子进程 `os.environ` → `config.py` `os.getenv`** 端到端闭合，只需把「播种数据」从占位符换成真实值即可，注入/剥离/哨兵三处逻辑均无需改动。

### 证据闭环 — 注入链路如何把「空」一路传到两个子进程

1. `desktop/main/index.js:83` 解析模板路径 → `:84-88` `initUserData()` 播种占位符 `.env`。
2. `desktop/main/index.js:111` `loadUserEnv(envPath)` 解析并剥离占位符 → `userEnv` ≈ 空（第三方 key 维度）。
3. 后端注入 `desktop/main/backendService.js:30-51`：
   ```js
   const env = { ...process.env, ...userEnv, DATABASE_URL, STORAGE_ROOT, HOST, PORT, CORS_ALLOWED_ORIGINS, ... }
   ```
   `userEnv` 无第三方 key ⇒ 后端拿不到 `ARK_API_KEY` / `VOLCANO_TTS_*` / `PEXELS_API_KEY` 等。
4. 后端自身 `app/config.py:12` `load_dotenv()` 读到的是机制 2 的空哨兵 ⇒ 也补不上。
5. 前端注入 `desktop/main/frontendService.js:21-29` 同样 `{ ...process.env, ...userEnv, ... }` ⇒ chat 直连路由拿不到 `LLM_API_KEY` / `FAST_LLM_*`。

**根因结论**：桌面打包链路按「零配置 / BYO-key」设计（spec §2.4、`README.md:96` 与 `README.md:128-133` 显式表述），通过 ① 不拷贝真实 `.env`、② 写空哨兵、③ 播种占位符模板、④ 运行期剥离占位符 四道机制，系统性地把真实默认凭证挡在包外。用户诉求恰好要求相反的「内置默认凭证、开箱即用」。这是**设计取向冲突**，而非单点缺陷；修复需改变「首启播种数据」与「构建期凭证来源」，而非修补某一行逻辑。

---

## 四、影响面（Impact surface）

**受影响用户**：所有安装桌面版且未自行配置凭证的用户（典型新用户 / 演示场景）。

**受影响功能**（凭证缺失 ⇒ 不可用或降级）：

| 凭证（来源 `.env`） | 受影响功能 | 现状 |
|---|---|---|
| `LLM_*` / `FAST_LLM_*` / `VIDEO_CUT_LLM_*` / `VL_LLM_*` / `AGENT_LLM_API_0x_*` | 对话、工作流、意图识别、AI 混剪、视频帧视觉理解 | 无 key；可在「设置→模型设置」补（落 DB） |
| `ARK_API_KEY` | AI 视频生成（Seedance）/ AI 图片生成（Seedream） | 无 key；**应用内无设置入口**，只能改 `.env` |
| `VOLCANO_TTS_*` / `VOLCANO_ASR_*` | 语音合成（100+ 音色）、字幕转录、声音克隆 | 无 key；**应用内无设置入口** |
| `PEXELS_API_KEY` | 视频素材搜索 | 无 key；**应用内无设置入口** |
| `UNSPLASH_ACCESS_KEYS` | 图片搜索 | 同上 |
| `TAVILY_API_KEYS` | Web 搜索 | 同上 |
| `FREESOUND_API_KEY` | 音频素材 | 同上 |
| `RUNNING_HUB_API_KEY` | FLUX 图片生成 | 同上 |
| `OSS_*` | 阿里云 OSS 二级 / CDN 存储 | 无配置；OSS 关闭，回落本地存储 |

**关键放大点**：上表「无设置入口」的第三方 key（ARK / 火山 TTS-ASR / Pexels / Unsplash / Tavily / Freesound / RunningHub）在应用内**没有任何配置 UI**，用户唯一的配置通道就是手改 `%APPDATA%\Ecliptrix\.env`。因此「不内置默认值」对这些功能等于「桌面端默认完全不可用」，远比 LLM（还能在模型设置里补）严重。

**对需求点 ②（用户改后以用户值为准）的现状评估** —— 修复时需保持，不可破坏：

- **应用内模型设置**写入 SQLite（`userData/data/ecliptrix.db`，`model_providers` / 模型设置表），优先级高于 `.env` 环境变量回退（`README.md:104-106`：「`.env` 中的 LLM 键仅作环境变量回退，优先级低于应用内设置」）。⇒ LLM 类的「用户覆盖默认」已具备。
- **`.env` 手改**：`config.js:34` 的 `if (!fs.existsSync(envPath))` 保证模板**只在首启播种一次**，用户后续对 `userData/.env` 的修改不会被覆盖。⇒ 第三方 key 的「用户覆盖默认」靠「编辑 `userData/.env`」实现，机制已在位。

> 结论：需求点 ②「用户改后以用户值为准」的运行期机制**已经存在**（DB 覆盖 env、env 仅首启播种一次）。本 bug 的修复重点是**让首启播种的默认值从占位符变为真实凭证**，并保证升级不回退用户值。

---

## 五、候选修复方案（Candidate fixes，对比）

> 三个方案的共同目标：让**首启播种的 `userData/.env`（或后端可读的 `.env`）携带真实默认凭证**，同时保持「用户改后以用户值为准」与「不把密钥提交进 git」。

| 方案 | 做法 | 侵入性 | 风险 | 工作量 |
|---|---|---|---|---|
| **方案 1（推荐）构建期由真实 `.env` 生成首启模板** | 新增构建步骤（在 `prepare-backend.js` 或新建 `prepare-env.js`）：读取根 `.env` + `backend-services/basic-service/.env`，**剔除由主进程强制注入的键**（`DATABASE_URL`/`STORAGE_ROOT`/`HOST`/`PORT`/`CORS_ALLOWED_ORIGINS`，见 `env.template.desktop:9-14`）后合并，写入打包用的 `env.template.desktop`（asar 内）。运行期注入管线（`backendService.js`/`frontendService.js` 透传 `userEnv`）、空后端哨兵、占位符剥离**全部不动**。首启 `config.js` 把真实默认复制到 `userData/.env`；用户改 `.env` 或用应用内设置即覆盖。 | 低–中：新增 1 个构建步骤；模板由生成产物提供 | 密钥随安装包发布、可被解包提取（与「内置默认凭证」诉求本质共生）；须确保**构建期读取的是 gitignore 的真实 `.env`，生成的含密钥模板不得提交进库**（`env.template.desktop` 目前被 git 跟踪，需改为构建产物或加入忽略 + 还原占位符版） | 小 |
| **方案 2 手工把真实凭证写进 `env.template.desktop`** | 直接把占位符模板里的 `your_*_here` 替换成真实值并提交。 | 低：改一个文件 | **高且不可接受**：`desktop/scripts/env.template.desktop` 受 git 跟踪（不在任何 `.gitignore` 内），真实密钥将进入版本历史并随仓库扩散；且与源 `.env` 双份维护、易漂移 | 小 |
| **方案 3 把真实 `.env` 拷进 `build/backend/.env` + 给前端单独 `.env`（替换空哨兵）** | 改 `prepare-backend.js`：拷贝真实后端 `.env` 到 `build/backend/.env`（去掉空哨兵写入），并为前端提供根 `.env`。后端经 `config.py` 的 `load_dotenv()` 直接读，前端读自身 `.env`。 | 中：改构建拷贝逻辑 + 调整哨兵契约 | 配置「单一事实来源」被打散为两处（后端读包内 `.env`，前端读 `userData/.env`）；**破坏需求点 ②**：仅存在于包内只读 `.env`、未进入 `userData` 模板的 key，用户无法覆盖（`resources/` 只读，且 `process.env` 注入会盖过 `load_dotenv`）；密钥同样随包发布 | 小–中 |

---

## 六、推荐方案（Recommended fix）

**采用方案 1：构建期从真实 `.env` 生成首启模板，复用既有注入管线。**

**理由**：

1. **复用已验证的运行期管线，改动面最小、风险最低**。第三节已证明：注入链路（`backendService.js:30-51` / `frontendService.js:21-29` 透传 `userEnv`）与占位符剥离（`envCheck.js`）对**真实值天然无害**——缺的只是「播种数据是占位符」。方案 1 只替换「播种数据来源」，不碰任何注入/剥离逻辑。
2. **天然满足需求点 ②（用户改后以用户值为准）**：
   - 应用内模型设置 → 落 DB，优先级高于 env（`README.md:104-106`）；
   - 用户手改 `userData/.env` → `config.js:34` 的 `if (!fs.existsSync(envPath))` 保证不被覆盖；
   - 主进程强制注入键（DB/Storage/Host/Port/CORS）在方案 1 中被显式剔除，避免内置默认污染本地化运行参数。
3. **避免把密钥提交进 git**：模板由「构建期读取 gitignore 的真实 `.env`」生成，而非把密钥写死进受跟踪文件（方案 2 的致命缺陷）。这要求落地时把生成的含密钥模板作为**构建产物**处理（生成到 build 产物 / asar，不回写并提交 `scripts/env.template.desktop` 的真实版本；占位符版仍保留在库中用于无密钥构建）。
4. **保持单一事实来源**：所有默认凭证经 `userData/.env` → `userEnv` 注入两个子进程，配置来源唯一、可被用户覆盖；不像方案 3 把来源拆成包内 `.env` + `userData/.env` 两处、并丢掉部分 key 的可覆盖性。

**实施时必须交接给下游（子任务 #2）的约束与注意点**：

- **密钥不入库**：`desktop/scripts/env.template.desktop` 当前被 git 跟踪。落地时严禁把含真实密钥的版本 `git add`；建议：构建步骤生成到独立产物路径并由 `electron-builder.yml files:` 指向，或生成后构建、构建后还原占位符版；务必核对 `.gitignore` 与暂存清单。
- **剔除主进程注入键**：生成模板时过滤 `DATABASE_URL`/`STORAGE_ROOT`/`HOST`/`PORT`/`CORS_ALLOWED_ORIGINS`/`BACKEND_URL`，避免内置默认覆盖桌面端本地化的固定值（这些键运行期由 `backendService.js` / `frontendService.js` 强制注入，模板里写了也不生效，但留着易误导）。
- **合并去重两份 `.env`**：根 `.env` 主要供前端（chat 直连 `LLM_*`、`AI_VIDEO_MATCH_LLM_*`、`YOUTUBE_PROXY`），后端 `.env` 供 FastAPI（其余第三方 key）。两者都有 `LLM_API_KEY` 但**取值不同**（根用 dashscope/qwen，后端用 bigmodel/glm），合并时需明确优先级（建议以后端 `.env` 为主、前端专属键补充），避免键冲突导致行为不一致。
- **安全告知**：内置真实凭证 ⇒ 任何安装用户都可解包提取这些 key（asar 与 extraResources 均非加密）。这是「内置默认凭证」诉求的内在代价，建议在 `README.md`「首次启动与配置」中据实说明，并评估为这批默认 key 设置用量限额 / 可轮换。
- **占位符剥离不需改**：真实值不匹配 `^your_.*_here$`，`envCheck.js` 无需改动。

**附带观察（非本 bug，但建议顺手记录）**：`env.template.desktop:4-6` 写「复制到 `%APPDATA%\Ecliptrix\.env`」，而 `prepare-backend.js:70` 注释写 `%APPDATA%/ecliptrix-desktop/.env`；以 `electron-builder.yml` 的 `productName: Ecliptrix` 为准，实际目录为 `%APPDATA%\Ecliptrix`，后者注释为历史漂移，建议在修复时一并订正。

---

## 七、评审结论（Review Verdict）

> 子任务 #1（分析报告评审与修复）产出。已对根因证据与候选方案逐条复核，下文给出审计结论、敲定的合并优先级、不入库密钥的具体落地路径、回归风险清单，并在末尾给出**单一推荐修复**。

### 7.1 根因证据审计 — 通过（evidence airtight）

逐条复核机制 1–4 的 `path:line`，全部与源码一致，且对此前最薄的一环补齐了硬证据：

| 机制 | 报告引用 | 复核结果 |
|---|---|---|
| ① 不拷贝真实后端 `.env` | `prepare-backend.js:15-17` | ✅ `COPY_ENTRIES` 实测为 `['app','config','run.py','requirements.txt','env.template']`，无 `.env`；注释「`.env` stay out by omission」一致 |
| ② 写空哨兵 | `prepare-backend.js:68-72` | ✅ 一致（报告写 64-73，实测哨兵写入在 68-72，区间正确） |
| ③ 播种模板仅占位符 | `env.template.desktop:23/65/69/78` | ✅ 四行逐一命中（LLM / Pexels / ARK / 火山 TTS） |
| ④ 运行期剥离占位符 | `envCheck.js:11 / 49-61` | ✅ `PLACEHOLDER_PATTERN=/^your_.*_here$/i`、`loadUserEnv` 对所有 key 剥离占位符，一致 |
| 注入链路 | `config.js:33-37`、`index.js:83/111`、`backendService.js:30-51`、`frontendService.js:21-29` | ✅ 全部一致 |

**对「注入管线对真实值天然无害」这一关键论断的补强（原报告证据偏薄，本节点已补全）**：
- 后端从**进程环境变量**取 key，而非只从文件：`config.py:768/1023/1044/1078` 均为 `os.getenv("…")`（PEXELS / LLM / VOLCANO_TTS / ARK）。
- 空哨兵不会清掉注入值：`backendService.js:18-22` 注释证实 python-dotenv 默认 `override=False`（不覆盖进程已存在的变量），且哨兵为空。
- 故端到端链路闭合（见第三节补强段）。**结论：根因为「设计取向冲突」而非单点缺陷，证据链闭合，无反例**——已主动寻找反例（后端是否绕开 `os.environ` 直读 `.env`、哨兵是否 `override=True` 清值），均不成立。

### 7.2 候选修复审计 — 维持「方案 1」，排除方案 2 / 3

- **方案 2（手填真实值进模板）——确认排除**：`git ls-files` 实测 `desktop/scripts/env.template.desktop` **确为受跟踪文件**，手填真实密钥即把凭证写入版本历史，不可接受。
- **方案 3（拷真实 `.env` 进 `build/backend/.env`）——确认排除**：破坏需求点 ②。`resources/backend/` 为只读，且 `backendService.js:30-51` 用 `{ ...process.env, ...userEnv, <硬覆盖> }` 注入、叠加 python-dotenv 非覆盖语义，**包内只读 `.env` 的值无法被用户在 `userData/.env` 覆盖**（注入值恒胜）；同时把配置事实来源拆成两处。
- **方案 1（构建期由真实 `.env` 生成首启模板，复用注入管线）——最小破坏面**：只替换「播种数据来源」，注入 / 剥离 / 空哨兵三处逻辑零改动；7.1 已证明真实值在现有管线中端到端可达。**采纳为推荐方案。**

### 7.3 敲定：两份 `.env` 的合并优先级（原报告留待评审的开放项）

实测两文件键集（根 23 键 / 后端 55 键），**交集仅 6 键，且取值全部不同**：

| 交集键 | 处置 | 依据 |
|---|---|---|
| `DATABASE_URL` | **剔除** | 主进程硬注入（`backendService.js:33` 固定 SQLite） |
| `LLM_API_KEY` / `LLM_API_URL` / `LLM_MODEL` | **以后端 `.env` 为准** | 见下「关键判断」 |
| `LOG_LEVEL` | 任取（仅大小写差异 `info`/`INFO`） | 无语义差 |
| `YOUTUBE_PROXY` | 取根 `.env`（后端为空） | 根值非空、供前端/下载链路 |

**关键判断（本评审的核心结论）**：用户诉求里「最需要内置、且应用内无配置入口」的第三方 key —— `ARK_API_KEY`、`VOLCANO_TTS_*`、`PEXELS_API_KEY`、`UNSPLASH_ACCESS_KEYS`、`TAVILY_API_KEYS`、`FREESOUND_API_KEY`、`RUNNING_HUB_API_KEY` —— 实测**全部仅存在于后端 `.env`，与根 `.env` 零冲突**。唯一的真实冲突是 `LLM_*` 三键（根用 dashscope/qwen，后端用其自有 GLM 端点）。而 `LLM_*` 恰恰是**冲突影响最小**的一组：① 应用内「设置→模型设置」落 DB、优先级高于 env（`README.md:104-106`），② 用户亦可改 `userData/.env`。因此合并规则定为「**第三方 key 全量取后端 `.env`（无冲突）；`LLM_*` 取后端 `.env` 作为前后端统一默认（用户可在应用内覆盖）；根 `.env` 独有的前端键（`AI_VIDEO_MATCH_LLM_*`、`YOUTUBE_PROXY`、`NEXT_PUBLIC_*` 等）补充进来**」，并显式剔除主进程硬注入键 `DATABASE_URL`/`STORAGE_ROOT`/`HOST`/`PORT`/`CORS_ALLOWED_ORIGINS`/`BACKEND_URL`。

### 7.4 敲定：不入库密钥的具体落地路径（原报告留待评审的开放项）

`electron-builder.yml:24` 的 `files:` **直接打包 `scripts/env.template.desktop`**（git 跟踪文件）进 asar，故必须避免「把真实密钥写进该跟踪文件」。两条落地路径：

- **推荐（A）生成到 gitignored 产物再重映射打包**：构建期把合并后的真实模板写到 `desktop/build/env.template.desktop`（`build/` 已被 `.gitignore:71` 忽略），并把 `electron-builder.yml` 的 `files:` 那一项改为 `{ from: build/env.template.desktop, to: scripts/env.template.desktop }`。`index.js:83`（`path.join(app.getAppPath(),'scripts','env.template.desktop')`）无需改动。**真实密钥永不进入受跟踪文件，无误提交风险。**
- 备选（B）生成-打包-还原：构建脚本临时把真实值写入 `scripts/env.template.desktop`，打包后还原占位符版。**不推荐**：构建中途崩溃会把真实密钥留在受跟踪文件，易被误 `git add`。

仓库内的占位符版 `scripts/env.template.desktop` 必须保留，作为**无密钥构建（CI / 外部贡献者）的回退**。

### 7.5 交接子任务 #2 的回归风险清单（must-check）

1. **无源 `.env` 时回退**：构建机若无真实 `.env`（CI / 外部构建），生成步骤须回退到占位符模板而非报错。
2. **`NEXT_PUBLIC_*` 为构建期常量**：Next.js 在 `npm run build` 时已内联，运行期经 `userEnv` 注入对已构建前端**可能不生效**；勿把它当作可热改的运行期默认（非凭证，影响小，但需知悉）。
3. **冒烟测试不可依赖模板**：`smoke-test.js` 预写「仅 ROOT 账号、零 LLM」的 `.env` 并断言 `llm-status 返回未配置`（`README.md:116-118`）；因 `config.js:34` 仅在 `.env` 不存在时才复制模板，预写 `.env` 后模板不参与，断言不受影响——但 #2 若改测试为依赖模板播种，该断言会翻转，须保持现状。
4. **`ROOT_USERNAME`/`ROOT_PASSWORD` 播种**：`index.js:100-103` 的 `auth:bootstrap-credentials` 读 `userEnv.ROOT_*`；若后端 `.env` 的 ROOT 凭证 ≠ `admin/change_me_on_first_run`，桌面端静默登录将改用真实值（符合诉求，但需与登录引导/文档一致）。
5. **剔除硬注入键**：见 7.3，模板写了也不生效（注入值恒胜），留着易误导。
6. **安全代价告知**：内置真实凭证 ⇒ 任何用户均可解包 asar/extraResources 提取（非加密）。建议在 `README.md`「首次启动与配置」据实说明，并为这批默认 key 评估用量限额 / 可轮换。
7. **顺手订正**：`prepare-backend.js:70` 注释 `%APPDATA%/ecliptrix-desktop/.env` 与实际 `%APPDATA%\Ecliptrix\.env`（`productName: Ecliptrix`）漂移，建议一并修正（非本 bug 必需）。

### 7.6 最终推荐修复（single recommended fix）

> **采用方案 1：新增构建期步骤，从真实 `.env`（根）+ `backend-services/basic-service/.env`（后端）合并生成首启模板，写入 gitignored 的 `desktop/build/env.template.desktop`，并由 `electron-builder.yml` 的 `files:` 以 `{from: build/env.template.desktop, to: scripts/env.template.desktop}` 打包进 asar；合并规则按 7.3（第三方 key 全量取后端 `.env`、`LLM_*` 取后端 `.env`、补充根 `.env` 前端独有键、剔除 6 个主进程硬注入键）；运行期注入 / 占位符剥离 / 空哨兵三处逻辑一律不动。**

**理由（为何是这个、而非别的）**：
1. **最小破坏面**：7.1 已证明现有注入管线对真实值端到端无害，方案 1 只换「播种数据来源」，零触碰注入 / 剥离 / 哨兵逻辑；方案 2、3 分别因「密钥入库」「破坏用户覆盖语义」被排除。
2. **天然满足需求点 ②**：DB 覆盖 env（`README.md:104-106`）+ `config.js:34` 模板仅首启播种一次，用户改后不被回退；硬注入键被显式剔除，内置默认不污染本地化运行参数。
3. **冲突可控**：最关键的无 UI 第三方 key 零冲突；唯一冲突的 `LLM_*` 可被应用内设置覆盖，影响最小。
4. **密钥不入库**：经 gitignored 的 `build/` 产物 + `files:` 重映射，真实密钥永不进入受跟踪文件（路径 A），从机制上杜绝方案 2 的致命缺陷。

**Definition of Done 自检**：根因证据链闭合（7.1）✅；评审结论给出单一推荐修复且理由显式（7.6）✅；证据不足处已补全代码引用（`config.py` `os.getenv` 行号、`backendService.js:18-22` dotenv 语义、`git ls-files` 跟踪事实、`electron-builder.yml:24` 打包来源、两份 `.env` 键交集实测）✅。

---

## 附录：关键证据索引（path:line）

- `desktop/scripts/prepare-backend.js:15-17` — `COPY_ENTRIES` 不含 `.env`（按省略排除真实后端 `.env`）
- `desktop/scripts/prepare-backend.js:64-73` — 写入「空哨兵」`build/backend/.env`
- `desktop/scripts/env.template.desktop:23,65,69,78` — 首启模板仅占位符（LLM / Pexels / ARK / 火山 TTS）
- `desktop/main/config.js:33-37` — 首启把模板复制为 `userData/.env`（仅当不存在）
- `desktop/main/envCheck.js:11,49-61` — 运行期剥离 `^your_.*_here$` 占位符
- `desktop/main/backendService.js:30-51` — 后端注入 `{ ...process.env, ...userEnv, <硬覆盖> }`
- `desktop/main/backendService.js:18-22` — 注释证实 python-dotenv 默认 `override=False`（注入值恒胜，空哨兵不清值）【评审补充】
- `desktop/main/frontendService.js:21-29` — 前端注入 `{ ...process.env, ...userEnv, ... }`
- `desktop/main/index.js:100-103` — `auth:bootstrap-credentials` 读 `userEnv.ROOT_USERNAME/ROOT_PASSWORD`【评审补充】
- `backend-services/basic-service/app/config.py:12` — 后端 `load_dotenv()`（读到空哨兵；源文件路径，打包后位于 `resources/backend/app/config.py`）
- `backend-services/basic-service/app/config.py:768,1023,1044,1078` — 经 `os.getenv("PEXELS_API_KEY"/"LLM_API_KEY"/"VOLCANO_TTS_API_KEY"/"ARK_API_KEY")` 读取——证明注入管线对真实值有效【评审补充】
- `desktop/electron-builder.yml:24` — `files:` 直接打包 `scripts/env.template.desktop` 进 asar（密钥不入库的落地约束来源）【评审补充】
- `desktop/electron-builder.yml:29-37` — 重型运行时经 `extraResources` 进包（python/backend/frontend/ffmpeg）【评审补充】
- `backend-services/basic-service/.env:1-105` — 真实后端默认凭证（ARK / 火山 / Pexels / Unsplash / Tavily / Freesound / RunningHub / OSS / LLM 等）
- `.env:1-52` — 真实前端默认凭证（`LLM_*`、`AI_VIDEO_MATCH_LLM_*`、`YOUTUBE_PROXY` 等）
- `desktop/README.md:96,104-106,128-133` — 现有「零配置 / BYO-key」设计的显式表述
- `.gitignore:36-42` — 全树封禁 `.env`，仅放行 `**/env.template` 与 `**/.env.example`（真实 `.env` 不入库）。注意 `env.template.desktop` 不匹配 `!**/env.template`（精确名），故仍受跟踪——经 `git ls-files` 实测确认【评审补充】
- `.gitignore:71` — `desktop/build/` 已被忽略，是「生成真实模板而不入库」的落地承载目录（推荐路径 A）【评审补充】
- `backend-services/basic-service/app/config.py` ∩ 两份 `.env` 键交集实测 — 交集仅 6 键（`DATABASE_URL`/`LLM_API_KEY`/`LLM_API_URL`/`LLM_MODEL`/`LOG_LEVEL`/`YOUTUBE_PROXY`）且取值全不同；关键无 UI 第三方 key（ARK/火山/Pexels/Unsplash/Tavily/Freesound/RunningHub）全部仅存于后端 `.env`、零冲突【评审补充，支撑 7.3】

---

## 实施过程发现的方案缺陷（Issues Found During Implementation）

> 子任务 #2（代码修复与开发）产出。落地方案 1 时发现 7.4 推荐路径 A 的**打包映射写法在 asar 链路下不生效**，以及 7.3 合并规则**漏掉了 `ADMIN_*`/`ROOT_*` 播种交互**。两处均已查源码定位、修正并验证，记录如下。

### 缺陷 1（致命）：`files:` 用「单文件 `from`」映射进 asar 会静默打包 0 文件

**7.4 路径 A 原文**建议把 `electron-builder.yml` 的 `files:` 写成
`{ from: build/env.template.desktop, to: scripts/env.template.desktop }`（`from` 指向**单个文件**）。**实测（读 electron-builder 25.1.8 源码）该写法对 asar 内文件无效**：

- asar 打包走 `app-builder-lib/out/util/appFileCopier.js` 的 `computeFileSets()` → `builder_util.walk(matcher.from, ...)`（`appFileCopier.js:116`）。
- `walk()`（`builder-util/out/fs.js`）对 `from` 执行 `readdir(from)`，**把 `from` 当目录**；`from` 是文件时 `readdir` 抛 `ENOTDIR`，被 `orIfFileNotExist()`（`builder-util/out/promise.js:48`，**同时吞掉 `ENOENT` 与 `ENOTDIR`**）兜底成 `[]`。
- 结果该 matcher 的 `files: []`，`copyAppFiles()` **一个文件都不拷**。asar 内 `scripts/env.template.desktop` 缺失 → 首启 `config.js:36` `copyFileSync(envTemplatePath, …)` 抛 `ENOENT` → **应用启动即崩**。

> 注：7.4 写「`index.js:83` 无需改动」前提是模板确被打进 asar 的 `scripts/`。单文件 `from` 不满足该前提。`copyFiles()`（`fileMatcher.js:267-274`，有 `fromStat.isFile()` 分支）只服务 `extraResources`/`extraFiles`，**不经手 asar `files:`**——这正是路径 A 误判的根源（把 extraResources 的能力套到了 asar `files:` 上）。

**修正**：改用「目录 `from` + `filter`」标准写法——
```yaml
- from: build
  to: scripts
  filter:
    - env.template.desktop
```
`createFilter()`（`util/filter.js`）下，`env.template.desktop`（无 `/`、无通配）仅匹配 `build/` 顶层同名文件，`backend/frontend/python/ffmpeg` 子目录因 minimatch 不命中被剪枝不递归；`getDestinationPath()` 以 `relative(build, build/env.template.desktop)` 映射到 `scripts/env.template.desktop`。`build/env.template.desktop` 生成路径与 `index.js:83` 解析路径均不变。

### 缺陷 2（中）：7.3 合并规则漏掉 `ADMIN_*`/`ROOT_*` 播种交互，需追加排除 `ADMIN_USERNAME`/`ADMIN_PASSWORD`

7.3 仅排除 6 个主进程硬注入键，未覆盖管理员账号播种。实测：

- 后端 `config.py:926-929`：`root_username = os.getenv("ROOT_USERNAME","") or admin_username`（`admin_username` 来自 `ADMIN_USERNAME`），密码同理；**`ROOT_*` 优先于 `ADMIN_*`**。
- 桌面端首启模板（占位符版）固定 `ROOT_USERNAME=admin` / `ROOT_PASSWORD=change_me_on_first_run`（非占位、不被 `envCheck` 剥离），且 `index.js:100-103` 静默登录只读 `ROOT_*`。
- 打包机**后端 `.env` 只有 `ADMIN_USERNAME`/`ADMIN_PASSWORD`、没有 `ROOT_*`**（实测键集）。

因此：模板的 `ROOT_*` 始终在位 → 后端 `or` 取 `ROOT_*` 播种、静默登录也用 `ROOT_*` → 二者恒一致，登录不回归。但若把后端 `.env` 的 `ADMIN_*` 一并打进模板，仅是**把开发机的 admin 口令无意义地泄漏进每个安装包**（功能上被 `ROOT_*` 压住、零收益）。用户诉求是内置**第三方服务**默认凭证，本地 admin 账号不在其列。

**修正**：合并时除 6 个硬注入键外，追加排除 `ADMIN_USERNAME`/`ADMIN_PASSWORD`（见 `scripts/prepare-env.js` 的 `LOCAL_ADMIN_KEYS`）。后端启动校验 `config.py:1128`「`root_password` 必须非空」由模板 `ROOT_PASSWORD=change_me_on_first_run` 满足，排除 `ADMIN_*` 不影响启动。

### 落地与验证

- 新增 `desktop/scripts/prepare-env.js`：读根 `.env` + 后端 `.env`，按 7.3 合并（后端为主、空值不覆盖根的非空、剔除硬注入键 + `ADMIN_*`），以「占位符模板为结构、就地换值 + 末尾追加额外键」生成到 gitignored 的 `build/env.template.desktop`；无源 `.env` 时原样复用占位符模板（零配置回退）。复用 `main/envCheck.js` 的 `parseEnvFile` 保证与运行期解析一致。
- `scripts/build.js`：`prepareFfmpeg` 后无条件调用 `prepareEnv()`（独立于 `--skip-*`），并把 `env.template.desktop` 加入 `BUILD_ASSERTIONS`。
- `electron-builder.yml`：`files:` 改为目录 `from: build` + `filter: [env.template.desktop]`（见缺陷 1 修正）。
- 运行期注入 / 占位符剥离 / 空哨兵三处逻辑**一律未改**，与 7.6 一致。
- 实测 `node scripts/prepare-env.js`：生成 69 键（65 合并 + 4 模板独有），8 个排除键全部 ABSENT，三方凭证全 REAL，`ROOT_USERNAME=admin`/`ROOT_PASSWORD=change_me_on_first_run` 保留，`YOUTUBE_PROXY` 取根非空值；`git check-ignore` 确认产物不入库。asar 映射经源码链路（`computeFileSets`→`walk`→`getDestinationPath`）+ 实打 `--dir` 包验证（见复现验证）。
