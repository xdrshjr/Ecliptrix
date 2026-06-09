# 桌面端「转换语音」后素材管理无音频素材 — 问题定位与分析

- **Bug slug**: `desktop-tts-audio-material-missing`
- **报告日期**: 2026-06-08
- **所属轮次**: 第 2 轮（前置：第 1 轮 `17e05cb` 已把真实默认凭证打包进桌面首启模板）
- **分析人**: Subtask #0（问题定位与分析）

---

## 一、问题描述（Problem description）

打包后的桌面端（Electron + Next.js standalone + FastAPI 子进程），在视频编辑器脚本面板点击「转换语音」按钮后，UI **看起来转换成功了**（进度条到 100%、片段被标记完成），但「**素材管理**」（编辑器内 MaterialsPanel）里**不会出现任何音频素材**。

经定位，这是一个**配置（凭证）问题**而非素材面板渲染问题：桌面端运行时实际使用的 `VOLCANO_TTS_API_KEY` 是**占位符** `your_volcano_tts_api_key`，火山引擎 TTS 接口对每个句子都返回 `HTTP 401 / code 45000010 "Invalid X-Api-Key"`，导致 TTS 全部失败、后端不生成拼接音频、前端因此**从不调用 `onAddMaterial`**，素材自然不出现。而 UI 之所以「貌似成功」，是因为进度/完成态在下载步骤**之前**就被置位，且失败文案里含有「转换完成 / 成功 0/3」字样，误导用户。

---

## 二、复现步骤（Reproduction steps）

### A. 终端复现（直接验证根因，最快）

> 目标：证明桌面端运行时使用的是占位符 Volcano 凭证，并触发了 401。

1. 查看用户数据目录下的桌面端 `.env`（Windows）：
   ```powershell
   Get-Content "$env:APPDATA\ecliptrix-desktop\.env" | Select-String "VOLCANO_TTS|LLM_API_KEY|ARK_API_KEY"
   ```
   实测输出（本机）：
   ```
   LLM_API_KEY = your_llm_api_key_here
   ARK_API_KEY = your_ark_api_key_here
   VOLCANO_TTS_API_KEY = your_volcano_tts_api_key
   VOLCANO_TTS_ACCESS_TOKEN = your_volcano_tts_access_token
   VOLCANO_TTS_SECRET_KEY = your_volcano_tts_secret_key
   ```
   注意：`LLM_*` / `ARK_*` 以 `_here` 结尾，`VOLCANO_*` 以 `_key` / `_token` 结尾——这一差异是关键（见根因 §3.3）。

2. 查看桌面后端运行日志（打包目录内）：
   ```
   M:/takoAI/Ecliptrix/desktop/release/win-unpacked/resources/backend/logs/app.log
   ```
   可见 `TTSService 初始化: api_key=your_v..._key`（占位符被注入）以及大量 `status=401 ... "Invalid X-Api-Key"`。

### B. 端到端复现（在桌面端 UI 内）

1. 任意一台**曾安装过旧版本**桌面端（其 `%APPDATA%\ecliptrix-desktop\.env` 已存在且含占位符）的机器上，安装/运行当前打包版本。
2. 进入视频编辑器，准备一个含解说文案/句子的脚本片段。
3. 点击片段上的「转换语音」按钮。
4. 观察：进度条到 100%、片段出现「已完成」态，随后弹出一条**含「转换完成 / 成功 0/N」字样的错误提示**；切到「素材管理」面板，**无新增音频素材**。

### C. 在干净环境**不会**复现（佐证根因边界）

- 全新安装（`%APPDATA%\ecliptrix-desktop\.env` 不存在）时，首启会从打包模板复制**真实凭证**（见证据 §3.4：`app.asar` 内模板 `VOLCANO_TTS_API_KEY=27a0b0...6216`），TTS 正常、素材正常出现。
- 因此本 bug **只影响“旧装升级 / 已存在占位符 .env”的用户**。

---

## 三、根因分析（Root cause analysis）

### 3.1 直接根因：占位符 Volcano 凭证导致 TTS 接口 401

桌面后端运行日志（`desktop/release/win-unpacked/resources/backend/logs/app.log`）中，真实桌面会话（userData = `AppData\Roaming\ecliptrix-desktop`）启动时：

```
line 119: app.services.tts_service - INFO - __init__:339 - TTSService 初始化: api_key=your_v..._key, resource_id=seed-tts-2.0
...
line 273: app.services.tts_service - ERROR - synthesize_speech:126 - TTS API HTTP错误: status=401,
          resource_id=seed-tts-2.0, response={"header":{...,"code":45000010,"message":"Invalid X-Api-Key"}}
line 322: app.services.sentence_tts_service - ERROR - _convert_single_sentence:210 - 句子 sentence-1-1 所有重试尝试均失败
line 323: app.services.sentence_tts_service - INFO  - convert_sentence_batch:515 - 句子转换结束
```

`api_key=your_v..._key` 来自 `tts_service.py` 的脱敏打印（取前 6 + 后 4）：

```python
# backend-services/basic-service/app/services/tts_service.py:335-342
key_preview = (
    f"{self.api_key[:6]}...{self.api_key[-4:]}"
    if len(self.api_key) > 10 else "(empty or short)"
)
```

`your_volcano_tts_api_key`[:6] = `your_v`，[-4:] = `_key` ⇒ `your_v..._key`，与日志完全吻合。**运行时的 Volcano API Key 就是占位符字符串**，火山引擎据此返回 401。

### 3.2 失败如何传导为「貌似成功 + 无素材」

后端：所有句子失败 ⇒ `successful_sentences == 0` ⇒ 跳过拼接 ⇒ `concatenated_audio_url = None` ⇒ 响应 `success=False`：

```python
# backend-services/basic-service/app/services/sentence_tts_service.py:553, 613-614
if successful_sentences > 0:        # 0 个成功 → 不进入拼接
    ...
return SentenceBatchTTSResponse(
    success=failed_sentences == 0 and concatenated_audio_url is not None,  # → False
    message=f"句子级语音转换完成，成功 {successful_sentences}/{len(request.sentences)} 个句子",  # "...成功 0/3 个句子"
    ...
)
```

前端 `handleConvertToSpeech`（`src/components/video/ScriptPanel.tsx:1257`）：

```ts
// ScriptPanel.tsx:1312 / 1343  —— 在“下载/加素材”之前就把进度置 100 并标记完成（“貌似成功”的来源）
setTtsProgress(prev => ({ ...prev, [segment.id]: 100 }));
setCompletedSegments(prev => new Set([...Array.from(prev), segment.id]));

// ScriptPanel.tsx:1314  —— 成功分支的门槛，success=false 时不进入
if (response.success && response.concatenated_audio_url && onAddMaterial) {
   ... await fetch(cleanAudioUrl) ...        // 1352：仅成功分支才会执行，本场景根本到不了
   ... onAddMaterial(audioMaterial) ...       // 1442：素材入面板的唯一入口，从未被调用
} else {
   // ScriptPanel.tsx:1504-1513
   const errorMsg = response.message || t.scriptPanel.errors.speechConversionFailed; // "...成功 0/3 个句子"
   throw new Error(errorMsg);
}
// ScriptPanel.tsx:1516-1525  catch → showError(...替换 {error} 为上面的 message)
```

结论：素材入口 `onAddMaterial`（1442）从未被调用，「素材管理」自然无音频；而 1312/1343 先行置位的「100% + 完成态」，加上错误文案里携带的「转换完成 / 成功 0/N」，共同造成「貌似成功了」的错觉。

> 旁证（排除“素材面板把音频过滤掉了”的假设）：对 `onAddMaterial → useMaterialManagement.addOrReplaceMaterial → MaterialsPanel` 全链路做过走查，MaterialsPanel 仅按 `selectedMaterialType`（默认 `all`）过滤、且对音频**不要求**有效 URL/缩略图，不存在隐藏新增音频素材的逻辑。所以问题在「素材没被加进来」，不在「加进来没显示」。

### 3.3 深层根因之一：占位符为何会被当成真凭证注入后端

桌面主进程在把 `userData/.env` 注入子进程前，会用 `loadUserEnv` 把“占位符值”剥离，避免假凭证导致调用期 401：

```js
// desktop/main/envCheck.js:11
const PLACEHOLDER_PATTERN = /^your_.*_here$/i      // 只匹配以 _here 结尾的占位符
// desktop/main/envCheck.js:49-61
for (const [key, value] of Object.entries(raw)) {
  if (PLACEHOLDER_PATTERN.test(String(value).trim())) continue  // 命中才剥离
  env[key] = value
}
```

该正则**只能匹配 `your_*_here`**。本机 `userData/.env` 里：

| 键 | 值 | 是否命中 `^your_.*_here$` | 结果 |
|---|---|---|---|
| `LLM_API_KEY` | `your_llm_api_key_here` | ✅ 命中 | 被剥离 → “未配置” → LLM 走优雅降级/应用内引导 |
| `ARK_API_KEY` | `your_ark_api_key_here` | ✅ 命中 | 被剥离 |
| `VOLCANO_TTS_API_KEY` | `your_volcano_tts_api_key` | ❌ 未命中（以 `_key` 结尾） | **未剥离 → 作为“真凭证”注入后端 → 401** |
| `VOLCANO_TTS_ACCESS_TOKEN` | `your_volcano_tts_access_token` | ❌ 未命中 | 未剥离 |
| `VOLCANO_TTS_SECRET_KEY` | `your_volcano_tts_secret_key` | ❌ 未命中 | 未剥离 |

这恰好解释了**为什么偏偏是 TTS（火山）失败**：LLM/ARK 占位符以 `_here` 结尾被正确剥离，走「未配置」的优雅路径；而 Volcano 占位符以 `_key`/`_token`/`_secret_key` 结尾，**漏过安全网**，被当成真凭证注入，触发 401。安全网的注释本身就声明了它要防的正是这种情况（`envCheck.js:53-56`：“a placeholder PEXELS_API_KEY would otherwise be injected... turn ‘not configured → graceful degradation’ into ‘401 at call time’”），但正则覆盖面不足，未能覆盖 `your_*_key` 形态。

### 3.4 深层根因之二：旧 `.env` 永不被真实凭证刷新（第 1 轮修复对升级用户失效）

首启只在 `userData/.env` **不存在**时才从打包模板复制：

```js
// desktop/main/config.js:34-37
const envPath = path.join(userDataPath, '.env')
if (!fs.existsSync(envPath)) {           // 仅“不存在”才写
  fs.copyFileSync(envTemplatePath, envPath)
}
```

而打包模板（`prepare-env.js` 把仓库 `backend-services/basic-service/.env` 的真实凭证合并进 `env.template.desktop`）确实带了真实 key——已从打包产物 `resources/app.asar` 内核实：

```
app.asar 内 scripts/env.template.desktop:  VOLCANO_TTS_API_KEY=27a0b0...6216  （与仓库后端 .env 一致）
banner 含“!!! 自动生成（含真实密钥）!!!”标记 ⇒ 第 1 轮打包确实注入了真实默认凭证
```

但用户机器上的 `%APPDATA%\ecliptrix-desktop\.env` **早已存在**（来自第 1 轮之前的旧版本，模板占位符还是 `your_volcano_tts_api_key` 这种不带 `_here` 的旧写法）。由于 `initUserData` 是“存在即跳过”，新打包模板里的真实凭证**永远不会覆盖/合并进**这份旧 `.env`，第 1 轮的修复对这类升级用户完全失效。

> 佐证占位符确实是“旧版本残留”：当前仓库内模板 `desktop/scripts/env.template.desktop` 的占位符是 `your_volcano_tts_api_key_here`（带 `_here`），而 userData 里是 `your_volcano_tts_api_key`（不带 `_here`）——两者写法不同，说明 userData 的 `.env` 是更早版本写入并沿用至今。

### 3.5 因果链小结

1. 用户曾装旧版本 → `%APPDATA%\ecliptrix-desktop\.env` 内含旧占位符（`your_volcano_tts_api_key` 等，不带 `_here`）。
2. 升级后，`initUserData`「存在即跳过」⇒ 真实凭证模板**不刷新**这份旧 `.env`（`config.js:34-37`）。
3. `loadUserEnv` 的占位符正则 `^your_.*_here$` **漏掉** `your_*_key`/`_token` ⇒ Volcano 占位符被当真凭证**注入后端**（`envCheck.js:11`）。
4. 后端用占位符调用火山 TTS ⇒ **401 Invalid X-Api-Key**（`app.log:273`；`tts_service.synthesize_speech:126`）。
5. 句子全失败 ⇒ 不拼接 ⇒ `concatenated_audio_url=None` ⇒ `success=False`（`sentence_tts_service.py:553,613`）。
6. 前端不进入成功分支 ⇒ **`onAddMaterial` 不被调用** ⇒ 素材管理无音频（`ScriptPanel.tsx:1314,1442`）。
7. 进度/完成态在下载前已置位 + 失败文案含「转换完成/成功 0/N」⇒ 用户感知「貌似成功了」（`ScriptPanel.tsx:1312,1343,1504-1525`）。

---

## 四、影响面（Impact surface）

- **受影响用户**：所有“**曾安装过第 1 轮（`17e05cb`）之前的桌面端、其 `%APPDATA%\ecliptrix-desktop\.env` 已存在且含占位符**”的升级用户。全新安装用户不受影响。
- **受影响功能**：
  - **「转换语音」/句子级 TTS 完全不可用**（核心症状）。
  - 任何使用 **Volcano 系列凭证**且占位符形如 `your_*_key`/`your_*_token`/`your_*_secret_key` 的功能：如字幕/ASR（`VOLCANO_ASR_*` 若为同类占位符）也可能被注入假凭证而 401。
  - `LLM_*` / `ARK_*` 因占位符以 `_here` 结尾被正确剥离，**不受**本 bug 影响（走「未配置」优雅降级 + 应用内设置引导）。
- **隐蔽性高**：UI 呈现「貌似成功」，用户难以自查；错误文案「成功 0/N」反而加重误解。

---

## 五、候选修复方案对比（Candidate fixes）

> 约束：本节只做方案设计，不写实现代码。所有改动均落在**桌面主进程**（`desktop/main/*`），不触碰后端与前端业务代码。

| 方案 | 做法 | 是否恢复“默认可用” | 侵入性 | 风险 | 工作量 |
|---|---|---|---|---|---|
| **F1 收紧占位符正则（最小安全补丁）** | 把 `envCheck.js` 的 `PLACEHOLDER_PATTERN` 从 `/^your_.*_here$/i` 放宽为可匹配 `your_*`（如 `/^your_[a-z0-9_]*$/i`），使 `your_volcano_tts_api_key` 等被正确剥离 | **否**：只把“静默 401”变成“TTS 未配置”的优雅提示，但**拿不回**真实默认凭证（旧 .env 仍无真值） | 极低（1 处常量） | 极低；需确认不会误伤“用户故意以 your_ 开头的真实值”（概率极低） | 极小 |
| **F2 启动时按模板回填占位符/缺失键（自愈，推荐）** | 启动时把 `userData/.env` 与打包模板对账：对每个模板键，若 userData 中**缺失或为占位符**，用模板真实值回填；**已是真实值的用户键保持不动**，回写磁盘。占位符判定复用 F1 放宽后的谓词 | **是**：升级用户也能拿到第 1 轮打包的真实默认凭证（契合第 1 轮“默认凭证开箱即用，用户改动优先”的意图），同时根除 401 | 中（新增一个对账/回填步骤，约在 `initUserData` 之后） | 中；须保证“只替换占位符、不覆盖用户真实值”，并处理“用户故意清空某键”的边界（可只回填缺失/占位符，不回填空串）；需做幂等 | 中 |
| **F3 模板版本号 + 强制重写/合并** | 在 `desktop-config.json` 记录模板版本；当打包模板版本更新时，对 `userData/.env` 做整文件合并或重写 | 是 | 较高（引入版本管理与迁移逻辑） | 较高；整文件重写若不做合并会**清掉用户自定义**；版本基线难定 | 较大 |

补充说明：

- F1 是 F2 的子集与前置——F2 的占位符判定应直接复用 F1 放宽后的谓词，使“剥离”与“回填”用同一套判定，避免再次出现“两套规则漂移”。
- F2/F3 都要遵守第 1 轮既定原则：**用户在 .env 或应用内设置中的真实修改优先级最高，升级不得覆盖**（`prepare-env.js`/`config.js` 注释均已声明）。因此回填必须以“仅缺失或占位符才填”为前提。

---

## 六、推荐方案（Recommended fix）

**推荐 F2（启动时按打包模板回填占位符/缺失键的自愈逻辑），并同时落地 F1（放宽占位符谓词并被 F2 复用）。**

理由：

1. **真正满足用户预期**。用户本轮的诉求本质是“打包的默认凭证应当开箱即用”。F1 单独只能把“静默失败”改善为“优雅提示未配置”，但升级用户**仍拿不到**真实默认凭证、TTS 仍不可用；只有 F2 能把第 1 轮已打进安装包的真实凭证**实际交付**给这批升级用户。
2. **直接根除两条根因**：F2 解决 §3.4（旧 .env 永不刷新），放宽后的谓词解决 §3.3（占位符漏过安全网被当真凭证注入）。两者合并后，无论“漏注入”还是“没刷新”都被覆盖。
3. **爆炸半径小、可控**：改动只在桌面主进程（`envCheck.js` 常量 + `config.js`/`index.js` 启动期一处对账回填），不动后端、不动前端、不动业务逻辑；天然幂等（回填后下次启动占位符已消失，不再触发）。
4. **尊重用户自定义**：以“仅缺失或占位符才回填、已是真实值不动”为铁律，符合第 1 轮“用户修改优先、升级不覆盖”的既定契约。

> 兜底/可观测性建议（实现时一并考虑，非强制）：回填发生时在桌面日志打一条 `main` 级记录（例如“detected N placeholder keys, backfilled from bundled template”），便于后续支持与回归验证；并可在应用内「设置 → 模型设置」继续保留手动修改入口作为最终兜底。

---

## 七、关键证据索引（File / line references）

- 运行时 401 与占位符注入：`desktop/release/win-unpacked/resources/backend/logs/app.log:119`（`api_key=your_v..._key`）、`:273`（`status=401 ... "Invalid X-Api-Key"`）、`:322-327`（重试均失败、转换结束）
- 用户数据 .env（占位符值）：`%APPDATA%/ecliptrix-desktop/.env` → `VOLCANO_TTS_API_KEY=your_volcano_tts_api_key` 等
- 打包模板（真实凭证已注入）：`resources/app.asar` 内 `scripts/env.template.desktop` → `VOLCANO_TTS_API_KEY=27a0b0...6216`（banner 含“含真实密钥”）
- 脱敏打印逻辑：`backend-services/basic-service/app/services/tts_service.py:335-342`
- TTS 401 记录点：`backend-services/basic-service/app/services/tts_service.py:126`（`synthesize_speech`）
- 成功判定：`backend-services/basic-service/app/services/sentence_tts_service.py:553`、`:613-614`
- 前端处理与素材入口：`src/components/video/ScriptPanel.tsx:1257`（`handleConvertToSpeech`）、`:1312/:1343`（先行置完成态）、`:1314`（成功分支门槛）、`:1442`（`onAddMaterial`）、`:1504-1525`（else→throw→showError）
- 占位符剥离安全网（覆盖面不足）：`desktop/main/envCheck.js:11`（`PLACEHOLDER_PATTERN`）、`:49-61`（`loadUserEnv`）
- 首启“存在即跳过”：`desktop/main/config.js:34-37`（`initUserData`）
- 打包模板凭证合并：`desktop/scripts/prepare-env.js:54-64`（`mergeEnv`）、`:127-149`（`prepareEnv`）

---

## 八、给下游（Subtask #1/#2）的提示

- 修复落点**优先桌面主进程**（`desktop/main/envCheck.js` + `desktop/main/config.js` 或 `index.js` 启动期），无需改后端 TTS 代码。
- 验证复现：修复后，在“已有占位符 .env”的环境启动桌面端，确认 `userData/.env` 中 `VOLCANO_TTS_*` 已被回填为真实值、后端日志不再出现 `Invalid X-Api-Key`、点击「转换语音」后「素材管理」出现音频素材。
- 注意不要把真实密钥写入任何被 git 跟踪的文件；`userData/.env` 在用户机器本地，不入库。

---

## 评审结论（Review Verdict）

> 评审人：Subtask #1（分析报告评审与修复）。本节为独立复核，对上文每条根因链路逐项回放并实测，补强了原报告未闭合的关键证据（尤其是「为什么 F1 单独不够」），更正一处事实性偏差，最后给出唯一推荐修复。

### A. 复核范围与方法

逐文件实测了上文引用的代码与日志（均在本工作目录内）：
`desktop/main/{envCheck.js, config.js, index.js, backendService.js}`、`desktop/scripts/{prepare-env.js, env.template.desktop}`、`backend-services/basic-service/app/config.py`、`.../app/services/{tts_service.py, sentence_tts_service.py}`、`src/components/video/ScriptPanel.tsx`、运行日志 `desktop/release/win-unpacked/resources/backend/logs/app.log`、打包产物 `resources/backend/.env` 与 `resources/app.asar`。

### B. 根因证据复核（逐链路）

| 因果链路 | 原报告引用 | 复核结论 |
|---|---|---|
| 占位符未被剥离 | `envCheck.js:11`（`/^your_.*_here$/i`）、`:49-61` | ✅ 属实。`your_volcano_tts_api_key` 不含 `_here`，正则不命中，`loadUserEnv` 在 `:57` 不 `continue` → 该键保留进 `env` |
| 占位符注入后端 | （原报告未给注入点） | ✅ 属实，**已补强**：`index.js:111→116` 把 `loadUserEnv` 结果存入 `state.userEnv`，`:185-186` 透传给 `createBackendDescriptor`；`backendService.js:30-38` 以 `env = { ...process.env, ...userEnv, <硬覆盖> }` 组装子进程环境，硬覆盖仅含 `DATABASE_URL/STORAGE_ROOT/HOST/PORT/CORS_ALLOWED_ORIGINS/DEBUG`，**`VOLCANO_TTS_*` 不在其中** → 占位符原样进后端进程环境 |
| 后端采信占位符 | （原报告未给） | ✅ 属实，**已补强**：`config.py:12` `load_dotenv()` 默认**不覆盖**已存在的环境变量；`:1044` `volcano_tts_api_key=os.getenv("VOLCANO_TTS_API_KEY", "")`。注入的占位符已在进程环境中 → `os.getenv` 直接返回占位符，后端 `.env` 无机会兜底 |
| TTS 401 | `app.log:273`、`tts_service.py:126` | ✅ 属实（行号微偏）。实测：占位符注入会话 `app.log:120`（`api_key=your_v..._key`），随后大量 401 在 `:274/:278/:282/:295…`（`code=45000010, "Invalid X-Api-Key"`） |
| 0 成功→success=False | `sentence_tts_service.py:553,613-614` | ✅ 属实。`:553` `if successful_sentences > 0` 跳过拼接；`:613` `success=failed_sentences == 0 and concatenated_audio_url is not None` → False；`:614` message 为「…成功 0/N 个句子」 |
| 前端不加素材 | `ScriptPanel.tsx:1314,1442` | ✅ 属实。`:1314` 成功门槛 `if (response.success && response.concatenated_audio_url && onAddMaterial)` 不进入；唯一素材入口 `onAddMaterial`（`:1442`）从未被调用；走 `:1504-1513` else→throw→`:1525` `showError` |
| 升级用户旧 .env 永不刷新 | `config.js:34-37` | ✅ 属实。`initUserData` 仅在 `!fs.existsSync(envPath)` 时复制模板（`:34-37`）；`index.js:84` 在 `main()` 启动期调用，升级用户文件已存在 → 真实模板不刷新 |

**结论：根因链路全部成立，且证据充分。** 直接根因（占位符 Volcano 凭证→401→0 成功→不加素材）已由「代码 + 运行日志」双向闭合。

### C. 补强证据（本次评审新增，闭合「F1 为何不足」的关键缺口）

原报告断言「F1 单独拿不回真实凭证、TTS 仍不可用」，但未给出硬证据。复核发现以下三点共同把该断言钉死：

1. **打包后端 `.env` 是「故意留空」的，凭证只能靠注入**
   `resources/backend/.env:1-2` 原文：
   > `# Intentionally empty. Desktop backend config is injected by Electron`
   > `# from %APPDATA%/ecliptrix-desktop/.env — do not put keys here.`
   配合 `config.py:1044` 的 `os.getenv("VOLCANO_TTS_API_KEY", "")` 与 `:437-438` 的 `Field(default="")`：**桌面后端的 Volcano 凭证唯一来源就是 Electron 注入的 `userData/.env`**，后端自身既无 `.env` 兜底、Field 默认也是空串。

2. **日志已经实拍到「空 key」会话长什么样——正是 F1 单独的结局**
   同一份 `app.log` 含多次后端启动：`:13/:36/:39`（`22:05:01–06`）为 `TTSService 初始化: api_key=(empty or short)`（key 为空），`:120/:141/:144`（`22:05:36–38`）为 `api_key=your_v..._key`（占位符被注入）；用户真正触发转换的会话（401 在 `22:06:23+`，紧接 `:144`）用的是占位符 key。**若仅实施 F1（剥离占位符），注入值会从「占位符字符串」变为「缺省」，后端 `os.getenv(...,"")` 得到空串，TTS 退回 `:13/:36/:39` 那种 `(empty or short)` 状态 → 空 X-Api-Key 同样无法鉴权 → 仍然失败、素材仍不出现。** 故 F1 必要但不充分。

3. **打包模板确实带真实 Volcano 凭证——F2 有真实回填源**
   对 `resources/app.asar` 二进制 grep 实测命中 `VOLCANO_TTS_API_KEY=27a0b0...6216`（此处脱敏，真实密钥仅存在于打包产物与用户本地，不入库），且含 `prepare-env.js:103-112` 的「!!! …含真实密钥 !!!」banner，与第 1 轮 `17e05cb` 一致。`prepare-env.js:127-149`（`prepareEnv`）+ `:54-64`（`mergeEnv`）确认真实后端 `.env` 在打包期被并入模板。**F2 的「按模板回填」有可用的真实值来源，技术可行。**

> 旁证（影响面）：`app.log:123` 的 `audio_transcription_service … appid=yo****id` 表明 `VOLCANO_TTS_APPID`（`your_volcano_tts_appid`）同属「不带 `_here`」占位符、亦被注入 → 字幕/ASR 链路同样受累，与 §四 影响面一致。F1 放宽谓词 + F2 回填可一并覆盖。

### D. 一处事实更正（不影响主结论，但需更正以保证证据链精确）

原报告 §一、§二.B step4、§3.2 称失败路径下「**片段被标记完成 / 出现「已完成」态**」，并把 `ScriptPanel.tsx:1343`（`setCompletedSegments`）与 `:1312` 并列为「先行置位的完成态」。**实测：`:1343` 位于 `:1314` 成功分支（`if (response.success && …)`）内部，本场景 `success=False` 时不会执行**，片段不会被标记「已完成」。

因此「貌似成功」的真实来源应更正为两点：(1) `:1312` `setTtsProgress(... 100)` 在 `:1314` 守卫**之外**无条件把进度条置 100%（叠加 `:1287-1292` 的模拟进度先冲到 85%）；(2) `:1505` 取 `response.message`（含「转换完成…成功 0/N」字样）经 `:1525` `showError` 以**错误提示**形式弹出，文案误导。此更正**不改变**根因与修复结论——素材缺失仍只因 `onAddMaterial`（`:1442`）从未被调用。

### E. 候选修复复核与边界条件

- **F1（放宽占位符谓词）**：把 `^your_.*_here$` 放宽为可匹配 `your_*`（如 `^your_[a-z0-9_]*$/i`）。复核安全性：现有被剥离集合是新集合的真子集（`your_*_here` 仍被剥离），仅新增剥离「`your_*` 不带 `_here`」；唯一风险是用户**真实值**恰好形如 `your_xxx`——对高熵 API key/token 概率可忽略，且 ROOT_PASSWORD 默认是 `change_me_on_first_run` 而非 `your_*`。**判定：安全，可纳入。但 F1 单独不恢复功能（见 §C）。**
- **F2（启动期按模板回填占位符/缺失键）**：唯一能把第 1 轮已打进安装包的真实凭证**实际交付**给升级用户的方案。**推荐，但实现须满足 §F 的边界清单。**
- **F3（模板版本号 + 强制重写/合并）**：整文件重写有清掉用户自定义的回归风险，版本基线难定，明显重于本 bug 所需。**判定：过度工程，不采纳。**

### F. 最终推荐修复（单一方案）

**推荐唯一方案：在桌面主进程启动期实现「基于打包模板的自愈式回填」（F2），并以放宽后的占位符谓词（F1）作为其判定基础——二者是同一处改动的两个部分，不可拆分为「仅交付 F1」。**

落地形态（给 Subtask #2 的实现约束，全部限定在 `desktop/main/*`，不动后端/前端）：

1. **统一占位符谓词**：在 `envCheck.js` 将 `PLACEHOLDER_PATTERN` 放宽到可匹配 `your_*`（含不带 `_here` 者），剥离（`loadUserEnv`）与回填（F2）**复用同一谓词**，杜绝「两套规则漂移」。
2. **回填时机**：在 `initUserData`（`config.js`）之后、`loadUserEnv`（`index.js:111`）之前，插入一步「对账回填」——读取 `userData/.env` 与打包模板，按模板键逐项处理后**写回磁盘**；随后 `loadUserEnv` 再读已被治愈的文件，注入后端的就是真实值。任何残留占位符仍由放宽后的 `loadUserEnv` 兜底剥离 → 优雅降级。
3. **回填判定（铁律，仅在以下情形回填）**：模板键在 `userData` 中**缺失**，或其值**命中占位符谓词**——才用模板值回填。
4. **不得覆盖的情形**：`userData` 中已是**真实值**（不命中谓词）→ 不动；值为**空串**（视为用户主动清空/禁用）→ 不回填。**遵守第 1 轮契约：用户修改优先、升级不覆盖。**
5. **回填源自校验**：当**模板侧该键本身也是占位符**（零配置构建产物，见 `prepare-env.js:114-118` banner 「未找到源 .env」）时，**跳过回填**，绝不把占位符写回 `userData`。
6. **最小破坏面写法**：对 `userData/.env` 做**逐行就地替换**（保留注释/分组/键序），不要整文件重生成；**幂等**——仅在确有变更时写盘（回填后下次启动占位符已消失，不再触发）。
7. **安全**：真实密钥只写入用户机本地 `userData/.env`，**不得**写入任何 git 跟踪文件。

**理由小结**：(1) 只有 F2 能满足本轮用户预期「默认凭证开箱即用」——F1 单独只会把「静默 401」变成「空 key 仍失败」（§C 已用代码+日志钉死）；(2) F1 放宽谓词 + F2 回填**同时根除两条根因**（§3.3 占位符漏过安全网、§3.4 旧 .env 永不刷新）；(3) 改动仅落桌面主进程、天然幂等、爆炸半径小；(4) 「仅缺失/占位符才填、真实值与空串不动」严守第 1 轮「用户优先、升级不覆盖」契约。

### G. 验收口径（Definition of Done 对齐）

在「已存在占位符 `.env`」的环境启动修复后版本，应同时满足：`userData/.env` 中 `VOLCANO_TTS_API_KEY` 等被回填为真实值（非 `your_*`）；后端日志 `TTSService 初始化` 显示真实 key 前缀（非 `your_v..._key`、非 `(empty or short)`）且不再出现 `Invalid X-Api-Key`；点击「转换语音」后「素材管理」出现音频素材；用户在 `.env`/应用内设置写过的**真实值**不被改动。

---

## 实施过程发现的方案缺陷（Issues Found During Implementation）

> 记录人：Subtask #2（代码修复与开发）。落地 F2 时发现 §F 第 3 条铁律里「**缺失** 即回填」这一半与现有冒烟测试契约冲突，按任务约定记录并采用修正后的实现。

### 缺陷：「缺失键 → 追加」会回归 Round 3 的零配置冒烟门禁

§F 第 3 条把回填触发条件写为「模板键在 userData 中**缺失**，或其值命中占位符谓词」。若把「缺失」实现为**向 `userData/.env` 追加模板键**，会与 `desktop/scripts/smoke-test.js` 的既定契约冲突：

- 冒烟测试故意只写入一份 `ROOT_USERNAME`/`ROOT_PASSWORD` 的 `.env`（`smoke-test.js:108-115`），用以验证 Round 3「零 LLM 配置也能完整启动」，并在 `:171` 断言 `GET /api/config/llm-status` 返回 `configured=false`。
- 实测本仓库打包机 `.env` 与 `backend-services/basic-service/.env` 均带**真实** `LLM_API_KEY`，故打包模板 `env.template.desktop` 内 `LLM_API_KEY` 为真实值。
- 若按「缺失即追加」实现，启动期会把模板里的真实 `LLM_API_KEY` 追加进冒烟用的 `ROOT_only` `.env` → 后端读到真实 LLM key → `llm-status` 变为 `configured=true` → 冒烟在 `:171` **失败**。

### 修正实现：仅就地替换「已存在的占位符行」，不追加缺失键

`backfillUserEnv`（`desktop/main/envCheck.js`）只重写 userData/.env 中**已存在**且值命中占位符谓词的行，**不追加**任何缺失键。理由：

1. **足以修复本 Bug**：受影响的升级用户其 `.env` 是从旧模板复制而来，`VOLCANO_TTS_*` 等问题键都**已作为占位符行存在**（见 §二.A、§3.3 实测），就地替换即可全部治愈，无需追加。
2. **消除冒烟回归**：`ROOT_only` 的 `.env` 不含任何占位符行 → 无回填 → 维持 `configured=false`，冒烟契约不破。
3. **更贴合「用户优先、升级不覆盖」**：用户主动删掉某键（键缺失）应视为显式选择，不应被升级悄悄补回——这比「缺失即追加」更保守、更安全。

代价：未来若打包模板**新增**一个旧 `.env` 中根本没有的键，升级用户不会自动获得该键。此为前向兼容的边角，不影响本 Bug，且与上面第 3 点的契约取向一致；如确有需要，可在后续轮次以独立、可控的方式单独处理。
