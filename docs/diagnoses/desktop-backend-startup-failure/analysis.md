# 诊断报告:打包后桌面端卡在「正在启动后端服务」

- **Bug 标识**: `desktop-backend-startup-failure`
- **诊断日期**: 2026-06-07
- **涉及版本**: `desktop/` 全部三轮提交(a52bc01 → b10a184 → d1bdcf3)产出的安装包;复现环境为 2026-06-07 13:08 构建的 `Ecliptrix-Setup-1.0.0.exe` / `release/win-unpacked`

---

## 1. 问题描述

打包后的桌面端(Electron)启动时,启动画面停在「正在启动后端服务…」,
约 2 分钟后弹出「后端服务 (backend) 启动失败」错误窗口。

用户运行日志(`%APPDATA%\ecliptrix-desktop\logs\main.log`)关键行:

```
[2026-06-07T17:10:42.005Z] [backend] starting: ...\resources\python\python.exe run.py
[2026-06-07T17:10:45.026Z] [backend] exited (code=1, signal=null)
[2026-06-07T17:12:18.539Z] [main] startup failed: Error: backend exited before becoming healthy — see logs
```

后端日志(`%APPDATA%\ecliptrix-desktop\logs\backend.log`)只有一条 traceback:

```
Traceback (most recent call last):
  File "...\resources\backend\run.py", line 8, in <module>
    from app.config import settings
ModuleNotFoundError: No module named 'app'
```

### 关于「端口」的澄清

用户怀疑是常用端口被占用。**经查与端口无关**:

- 桌面端默认端口本来就是非常用端口 **18320(前端)/ 18321(后端)**
  (`desktop/main/config.js:9-10`),且 `desktop/main/ports.js:21` 有占用时
  自动 +2 探测的兜底;
- 实际运行配置 `%APPDATA%\ecliptrix-desktop\desktop-config.json` 确认本次
  使用的就是 18320/18321;
- 后端进程在 spawn 后 **3.0 秒**内以 code=1 退出,报的是 Python 导入错误,
  不是端口绑定错误(端口冲突的表现是 `[Errno 10048]` bind 失败)。

---

## 2. 复现步骤

### 2.1 完整复现(用户路径)

1. `cd desktop`,运行 `.\build.ps1`(或 `npm run build:dir`)完成打包;
2. 运行 `desktop\release\win-unpacked\Ecliptrix.exe`;
3. 现象:启动画面停在「正在启动后端服务…」,120 秒(`backendService.js:58`
   的 `healthTimeoutMs`)后弹错误窗;
4. 查看 `%APPDATA%\ecliptrix-desktop\logs\backend.log` 可见上述
   `ModuleNotFoundError`。

### 2.2 最小复现(命令行,数秒内必现)

```powershell
cd M:\takoAI\Ecliptrix\desktop\release\win-unpacked\resources\backend
..\python\python.exe run.py
# → ModuleNotFoundError: No module named 'app'   (退出码 1)
```

### 2.3 隔离模式取证命令

```powershell
..\python\python.exe -c "import sys; print(sys.flags.isolated, sys.flags.ignore_environment); print('\n'.join(sys.path))"
```

实测输出(2026-06-07,本机):

```
isolated: 1
ignore_env: 1
M:\...\resources\python\python311.zip
M:\...\resources\python
M:\...\resources\python\Lib\site-packages
（注意:没有 resources\backend）
```

---

## 3. 根因分析

本次「启动失败」由**两个相互独立的 bug 串联**造成:Bug 1 当前直接致命;
修掉 Bug 1 后 Bug 2 会立刻接管,继续让后端以 code=1 退出(已实测验证)。

### Bug 1(主因):嵌入式 Python 的 `._pth` 隔离模式吞掉了 `sys.path`

打包脚本 `desktop/scripts/prepare-backend.js:84-87` 重写了嵌入式 CPython 的
`python311._pth`:

```js
fs.writeFileSync(
  path.join(pythonDir, pthName),
  [pthName.replace('._pth', '.zip'), '.', 'Lib/site-packages', 'import site', ''].join('\n')
)
```

最终随包发布的 `resources/python/python311._pth` 内容为:

```
python311.zip
.
Lib/site-packages
import site
```

CPython 在 Windows 上的规则:**只要 `python.exe` 旁存在 `._pth` 文件,解释器
即进入隔离模式**(实测 `sys.flags.isolated == 1`、`sys.flags.ignore_environment == 1`),
后果有三:

1. `sys.path` **只包含** `._pth` 中列出的条目(相对路径相对于 `._pth` 所在
   目录,即 `resources/python/`),**不再自动添加脚本所在目录**——因此
   `python.exe run.py` 运行时,`resources/backend/` 不在 `sys.path` 上,
   `run.py:8` 的 `from app.config import settings` 必然抛
   `ModuleNotFoundError: No module named 'app'`;
2. `PYTHONPATH` 被忽略——实测:设置
   `PYTHONPATH=...\resources\backend` 后启动,`sys.path` 中依然没有 backend
   目录(本机验证输出 `backend on sys.path: False`)。**所以「在
   backendService.js 里加 PYTHONPATH」这条看似最顺手的修法不可行**;
3. `PYTHONUTF8` / `PYTHONIOENCODING` 同样被忽略(见 §3.4 次生问题)。

`desktop/main/backendService.js:52-54` 的 spawn 描述符就是直接
`python.exe run.py`,没有任何 `sys.path` 补偿,于是后端 3 秒内退出。

> 历史说明:该 `._pth` 写法自第 1 轮提交(a52bc01)起就没变过——
> **打包后的后端其实从任何一个 build 起就从未成功启动过**。第 1、2 轮没有
> 暴露是因为旧版有「必填配置缺失就退出」的启动门(main.log 14:17/14:21 两次
> 运行均为 `user declined required env configuration — quitting`,根本没走到
> spawn backend);第 3 轮去掉了启动门,这个潜伏 bug 才第一次被触发。

### Bug 2(被 Bug 1 掩盖):`ai_video_generate_service` 在 import 期硬性要求 VIDEO_CUT_LLM 配置

验证 Bug 1 时,我用 `sys.path` 注入方式绕过它启动打包后端(沙箱 DB/存储、
临时端口 18999),后端走完了全部服务初始化日志,**随后在 import 链上抛出第
二个致命错误**:

```
File "...\resources\backend\app\routers\__init__.py", line 16: from . import ai_video_generate_router
File "...\resources\backend\app\routers\ai_video_generate_router.py", line 9: from app.services.ai_video_generate_service import ai_video_generate_service
File "...\resources\backend\app\services\ai_video_generate_service.py", line 447, in <module>
    ai_video_generate_service = AIVideoGenerateService()
File "...\app\services\ai_video_generate_service.py", line 30, in __init__
    raise ValueError("Video Cut LLM API key and URL must be configured")
ValueError: Video Cut LLM API key and URL must be configured
```

代码证据(`backend-services/basic-service/app/services/ai_video_generate_service.py:21-30,447`):

```python
def __init__(self):
    self.api_key = ***REMOVED***
    ...
    if not self.api_key or not self.api_url:
        raise ValueError("Video Cut LLM API key and URL must be configured")
...
ai_video_generate_service = AIVideoGenerateService()   # ← 模块级单例,import 期执行
```

而用户的 `%APPDATA%\ecliptrix-desktop\.env` 中(已脱敏检查):

```
LLM_API_KEY=your_llm_api_key_here          ← 占位值
VIDEO_CUT_LLM_API_KEY=your_video_cut_llm_api_key_here   ← 占位值
```

`desktop/main/envCheck.js:57` 会把所有 `your_*_here` 占位值剔除后再注入子进
程(这个设计是对的),于是后端看到的 `VIDEO_CUT_LLM_API_KEY` 为空 →
import 期 `ValueError` → 退出码 1。**也就是说第 3 轮「未配置也能启动」的目标
只在 Electron 层和 `LLM_API_KEY` 这一个键上达成了,后端里还有一处针对
`VIDEO_CUT_LLM_*` 的 import 期硬门没拆。**

对照组:同样依赖 VIDEO_CUT 配置的 `ai_mixed_editing_service` 就是正确写法——
`app/routers/ai_mixed_editing_router.py:71` 在**请求处理时**才
`AIMixedEditingService()`,未配置时只有该功能报错,不影响进程启动。
全仓只有 `ai_video_generate_service.py:447` 这一处模块级实例化带硬校验
(已 grep 全部 services 确认)。

**评审补强(以下四条由评审节点逐一复核并补充引用):**

1. **失败路径必然执行**——该 import 链上没有任何条件分支或 try 包裹:
   `run.py:23-24`(`uvicorn.run("app.main:app", ...)`)→ `app/main.py:21`
   (`from app.routers import api_router`,触发包级 `__init__`)→
   `app/routers/__init__.py:16` → `ai_video_generate_router.py:9` →
   `ai_video_generate_service.py:447`。此外 `app/main.py:510-512` 还显式
   import 并注册该 router。诊断日志中的 traceback 帧序与此静态链逐帧一致。
2. **唯一性复核**——全仓 21 处模块级 `xxx = XxxService()` 单例与
   `raise ValueError(...configured)` 交叉比对:`chat_service.py:26`、
   `ai_mixed_editing_service.py:34`、`video_understanding_script_service.py:36`
   同样在 `__init__` 抛错,但三者均只在 router 请求处理时实例化
   (`chat_router.py:57`、`video_understanding_script_router.py:65`、
   `ai_mixed_editing_router.py:71`);`voice_clone_service.py:170,222` 与
   `ark_video_service.py:564` 的抛错在方法体内(请求时)。**import 期会炸的
   确实只有 `ai_video_generate_service.py:447` 一处**,原文结论成立。
3. **单例消费面极小**——全仓只有 `ai_video_generate_router.py:133` 一处调用
   `ai_video_generate_service`,惰性化重构的影响面就是 2 个文件、1 个调用点。
4. **为什么同为占位值的 `LLM_API_KEY` 没有先炸**(报告原文未解释,评审补上,
   否则「无第三个隐藏致命点」的论证有缺口):`app/config.py:1023-1024` 用
   `os.getenv("LLM_API_KEY", "")` 给 `Field(...)` 喂空串,
   `from app.config import settings` 不抛错;`app/main.py:72-75` 对空值只
   `logger.warning`。即 `LLM_API_KEY` 这条轴第 3 轮已在后端打通,佐证后端
   只剩 VIDEO_CUT 这一道 import 期硬门。

### 3.3 端到端验证(根因链闭环)

对打包产物同时施加两项绕过:① `sys.path` 注入 backend 目录;
② 提供非空的 `VIDEO_CUT_LLM_API_KEY/URL`(dummy 值)——后端成功启动:

```
GET http://127.0.0.1:18999/api/health
HTTP 200: {"success":true,"message":"Service is healthy","status":"healthy","uptime":"0:00:14",...}
```

且依赖完整随包发布:`requirements.txt` 的 **59 个直接依赖逐项命中、0 缺失**
(`pip list --path .../Lib/site-packages` 共列出 159 个包,差额为传递依赖;
评审注:原文「159 个依赖包逐项比对」表述易误读,已订正口径——比对基准是
59 项直接依赖)——排除「依赖没装进去」的可能。
由此确认:修复这两点后打包后端即可正常启动,无第三个隐藏致命点。
(从 spawn 到 health OK 实测约 60–70 秒,首次运行含 .pyc 编译,现有 120 秒
超时配置够用但不富余,见 §3.4 第 3 条。)

### 3.4 次生问题(非本次致命,但建议一并处理)

1. **`PYTHONUTF8=1` / `PYTHONIOENCODING` 实际无效**:
   `backendService.js:40-41` 设置的这两个变量因 `ignore_env=1` 被解释器忽略。
   中文 Windows 下子进程 stdout 编码会回落到 GBK,后端日志里的中文已出现乱码
   (实测后端启动日志中 `YouTube 服务初始化` 等中文全部乱码)。命令行参数不受
   隔离模式影响,改用 spawn args `['-X', 'utf8', 'run.py']` 即可恢复。
   (注:`PYTHONNOUSERSITE=1` 例外地仍有效,因为 `site.py` 是在运行期直接读
   `os.environ`,实测 Electron 拉起的子进程确实没加载用户 site-packages。
   评审复测佐证:发布版解释器 `sys.flags` 实测为 `isolated=1 / ignore_env=1 /
   no_user_site=0`——`no_user_site` 标志位**并未**被 `._pth` 置起,用户 site
   的抑制确实只靠这个环境变量,因此 `backendService.js:44` 的
   `PYTHONNOUSERSITE: '1'` 必须保留,不能在修复时顺手清理。)
2. **冒烟测试默认不跑**:`scripts/smoke-test.js` 恰好覆盖本场景(零 LLM 配置
   下要求 backend+frontend 双 health 200,`smoke-test.js:101-141`),两个 bug
   都能被它当场拦下;但 `build.ps1` 只有显式传 `-SmokeTest` 才执行
   (`build.ps1:45,260`),本次打包没有跑,坏包直接出厂。
   评审注:`smoke-test.js:12` 自带 **90 秒**启动死线(`STARTUP_TIMEOUT_MS`),
   低于 `backendService.js:58` 的 120 秒;实测冷启动 60–70 秒,若按建议把冒烟
   测试设为默认,**必须同步把该死线提到 ≥120 秒**(与 `healthTimeoutMs` 对齐),
   否则慢盘机器上冒烟测试会先于应用自身超时而误报构建失败。
3. **健康超时余量**:首次启动(冷 .pyc + 杀软扫描)实测 60–70 秒,距 120 秒
   上限不算宽裕,低速磁盘机器有超时风险,可考虑提到 180 秒。

---

## 4. 影响面

| 维度 | 影响 |
|---|---|
| 用户 | **所有**安装打包桌面端的用户,启动必失败(100% 复现,与机器环境无关) |
| 功能 | 桌面端整体不可用(后端起不来 → 前端也不会启动 → 主窗口不出现) |
| 历史版本 | 三轮所有 build 均带此缺陷;1、2 轮被「配置缺失即退出」的门挡住未暴露 |
| Web 部署版 | **不受影响**(服务器用 venv 的标准 python,无 `._pth` 隔离模式) |
| 端口 | 无关。默认 18320/18321 已是非常用端口,且有自动避让逻辑 |

---

## 5. 候选修复方案

### Bug 1(sys.path)

| 方案 | 做法 | 侵入性 | 风险 | 工作量 |
|---|---|---|---|---|
| **A. `._pth` 增加 `../backend` 行**(改 `prepare-backend.js:86` 的数组,补一项 `'../backend'`) | 构建期一次性解决;`._pth` 相对路径以其所在目录为基准,build 树(`build/python` ↔ `build/backend`)与发布树(`resources/python` ↔ `resources/backend`)目录关系相同,两处均成立 | 极低(1 行) | 极低;`sys.path` 注入方式已实测可行 | ~10 分钟 + 重新打包 |
| B. Electron 改用 bootstrap 启动(`python.exe -c "import sys; sys.path.insert(0, <backend>); import runpy; runpy.run_path('run.py', ...)"`) | 运行时解决,不需改构建脚本 | 中(改 spawn 描述符,命令行变复杂) | 中;`run.py` 以 `runpy` 方式执行,`__main__` 语义有细微差异 | ~30 分钟 |
| C. 设 `PYTHONPATH` 环境变量 | — | — | **不可行**:隔离模式 `ignore_env=1`,已实测被忽略(评审复测再次确认:注入 `PYTHONPATH` 后 `backend on sys.path: False`) | — |
| D. 删除 `._pth` 退出隔离模式(评审补充的备选,予以否决) | — | — | **不可行**:嵌入式发行版依赖 `._pth` 定位 `python311.zip` 标准库;删掉后解释器转而依赖宿主机注册表 / `PYTHONHOME`,在末端用户机器上行为不可控,且会重新引入用户 site-packages 污染(正是 `prepare-backend.js:19-25` 极力规避的) | — |

评审补充——方案 A 的两个边界确认:

1. **追加位置在 `Lib/site-packages` 之后**,依赖包优先于后端目录解析,
   `backend/app`、`backend/config` 不会遮蔽第三方包;
2. **`../backend` 在构建树与发布树均成立**:`prepare-backend.js:121-122` 先
   `copyBackendSources()` 再 `preparePython()`,写 `._pth` 时 `build/backend`
   已存在,构建期 pip / 断言子进程不受影响;发布树的兄弟目录关系由
   `electron-builder.yml:29-35`(`build/python → python`、
   `build/backend → backend`)保证。

### Bug 2(VIDEO_CUT import 期硬门)

| 方案 | 做法 | 侵入性 | 风险 | 工作量 |
|---|---|---|---|---|
| **a. 单例惰性化**:删掉 `ai_video_generate_service.py:447` 的模块级实例化,router 在请求处理时实例化(完全照抄 `ai_mixed_editing_router.py:71` 的现有模式) | 后端 2 个文件小改 | 低 | 低;有同仓现成范式;未配置时该功能在调用时报 4xx/5xx,与第 3 轮「引导用户去设置页」的设计一致 | ~30 分钟 |
| b. `__init__` 不抛错,改为首次调用方法时校验 | 1 个文件 | 低 | 低,但校验点分散,不如 a 干净 | ~30 分钟 |
| c. 桌面端注入 dummy VIDEO_CUT key | 0 后端改动 | 低 | **高**:把「未配置」伪装成「已配置」,设置页状态检测(`/api/config/llm-status` 类逻辑)会被骗,违背第 3 轮设计意图,不推荐 | — |

---

## 6. 推荐修复

**方案 A + 方案 a,外加三个一行级加固**:

1. `desktop/scripts/prepare-backend.js:86`:`._pth` 数组追加 `'../backend'`
   ——根除 Bug 1,构建期生效、运行时零开销,且不改变任何运行时拓扑;
2. `app/services/ai_video_generate_service.py`:去掉模块级单例的 import 期
   抛错,按 `ai_mixed_editing_router.py:71` 的惰性模式重构——根除 Bug 2,
   并使「零配置可启动、用到才报错」在后端全面成立(这正是第 3 轮需求的本意);
3. `desktop/main/backendService.js:53`:spawn args 改为 `['-X', 'utf8', 'run.py']`
   ——修复被隔离模式忽略的 UTF-8 设定,消除中文日志乱码;
4. `desktop/scripts/prepare-backend.js:110-114` 的构建期断言追加 `import app`
   (在 backend 目录下执行)——让「后端代码能否被打包 runtime 导入」在构建期
   就被验证,防止回归;
5. `desktop/build.ps1`:默认执行冒烟测试(将 `-SmokeTest` 反转为
   `-SkipSmokeTest`)——本次两个 bug 任意一个都会被 `smoke-test.js` 当场拦截,
   不该是可选项。

理由:A+a 都是最小侵入且各自有实测/同仓范式背书;验证链(§3.3)已证明这两处
修完后打包后端可达 health 200,无残留致命点。端口方面无需改动——现有
18320/18321 + 自动避让已满足「使用非常用端口」的要求。

---

## 附:证据清单

| # | 证据 | 位置 |
|---|---|---|
| 1 | 用户侧失败日志(backend 3 秒退出 code=1) | `%APPDATA%\ecliptrix-desktop\logs\main.log`(摘录见 §1) |
| 2 | `ModuleNotFoundError: No module named 'app'` | `%APPDATA%\ecliptrix-desktop\logs\backend.log` |
| 3 | 发布包 `._pth` 内容(无 backend 条目) | `release/win-unpacked/resources/python/python311._pth` |
| 4 | 隔离模式实测 `isolated=1 / ignore_env=1`,`sys.path` 无 backend | §2.3 命令输出 |
| 5 | `PYTHONPATH` 被忽略实测 | §3 Bug 1 第 2 条 |
| 6 | `._pth` 生成代码 | `desktop/scripts/prepare-backend.js:84-87` |
| 7 | Bug 2 traceback(sys.path 修复后触发) | §3 Bug 2(诊断运行日志 `.agentmesh/_diag_tmp/backend_diag.log`) |
| 8 | import 期硬门代码 | `app/services/ai_video_generate_service.py:29-30,447` |
| 9 | 用户 `.env` 占位值状态(脱敏) | §3 Bug 2 |
| 10 | 双绕过后 health 200 | §3.3 |
| 11 | 依赖完整性比对(直接依赖 59/59 命中) | §3.3 |
| 12 | 冒烟测试为可选开关 | `desktop/build.ps1:45,260` |
| 13 | 启动 import 链无条件执行(评审补充) | `run.py:23-24` → `app/main.py:21,510-512` → `app/routers/__init__.py:16` → `ai_video_generate_router.py:9` → `ai_video_generate_service.py:447` |
| 14 | `LLM_API_KEY` 空值不拦启动:空串入 `Field(...)`、仅 warning(评审补充) | `app/config.py:373,1023-1024`、`app/main.py:72-75` |
| 15 | import 期硬门唯一性交叉比对:其余 3 个带校验的服务均为请求时实例化(评审补充) | `chat_router.py:57`、`video_understanding_script_router.py:65`、`ai_mixed_editing_router.py:71` |
| 16 | 单例唯一消费点(评审补充) | `app/routers/ai_video_generate_router.py:133` |
| 17 | 构建→发布目录映射,`../backend` 两树均成立(评审补充) | `desktop/electron-builder.yml:29-35`、`desktop/scripts/prepare-backend.js:121-122` |
| 18 | 发布版解释器标志位 `isolated=1/ignore_env=1/no_user_site=0` 评审日复测 | §3.4 注 |
| 19 | 冒烟测试自带 90s 启动死线(低于应用 120s) | `desktop/scripts/smoke-test.js:12` |

---

## 评审结论(Review Verdict)

- **评审日期**: 2026-06-07
- **评审方式**: 对报告引用的全部代码行号、日志文件、`._pth` 实物内容逐条
  与仓库 / 发布包 / 用户日志比对,并对关键断言做了独立复测
  (隔离模式 flags、`PYTHONPATH` 忽略、发布包 `._pth` dump、
  `requirements.txt` 计数、import 链静态追踪、单例唯一性 grep 交叉比对)。

### 1. 根因证据链评定:成立,且已补强至闭环

- **Bug 1**:发布包 `python311._pth` 实物内容(评审日重新 dump)与
  `prepare-backend.js:84-87` 生成逻辑逐字一致,无 backend 条目;解释器标志位
  复测 `isolated=1 / ignore_env=1`;`PYTHONPATH` 注入复测仍
  `backend on sys.path: False`。用户侧 `backend.log` 的
  `ModuleNotFoundError: No module named 'app'`(run.py:8)与上述机制完全自洽。
  **引用的代码全部位于失败路径上,且无反例。**
- **Bug 2**:诊断日志 traceback 帧序与静态 import 链
  (`run.py:23` → `app/main.py:21` → `routers/__init__.py:16` →
  `router:9` → `service:447`)逐帧一致,链上无条件分支——零 VIDEO_CUT 配置
  下 import 必炸。评审补充了原文缺失的一环:同为占位值的 `LLM_API_KEY`
  为什么不先炸(`config.py:1023-1024` 空串 + `main.py:72-75` 仅 warning),
  消除了「是否还有第三道门」的疑点;并以 21 处模块级单例 × 4 处
  `__init__` 硬校验的交叉比对确认 `ai_video_generate_service.py:447`
  是全仓唯一 import 期硬门。
- **备选解释均被证据排除**:端口占用(默认 18320/18321 非常用 + `ports.js:21`
  步进 2 自动避让 + 实际配置文件确认 + 退出形态是 import 错不是 bind 错)、
  依赖缺失(59 项直接依赖 0 缺失)。用户「不要使用常用端口」的诉求现状已满足,
  **无需为此改动任何代码**。
- **双绕过 → health 200 的端到端验证**(§3.3)证明两个根因修复后无残留
  致命点,证据链闭环。

### 2. 候选修复评定

- 方案 C(`PYTHONPATH`)、新增方案 D(删 `._pth`)否决正确/成立——前者被
  隔离模式忽略(两次独立实测),后者会让标准库定位依赖宿主机环境并重新引入
  用户 site 污染,比病症更糟。
- 方案 B(bootstrap 启动)可行但劣于 A:spawn 命令行复杂化、`runpy` 的
  `__main__` 语义差异是真实风险,且把构建期缺陷推迟到运行时弥补,层次不对。
- 方案 b(`__init__` 不抛、调用时校验)劣于 a:校验点分散,且偏离同仓
  既有范式(3 个对照 router 全部采用请求时实例化)。
- 方案 c(注入 dummy key)否决正确:会欺骗 `/api/config/llm-status`
  (`smoke-test.js:154-165` 明确断言零配置时 `configured=false`),直接
  违背第 3 轮设计。

### 3. 最终推荐修复

**采纳报告 §6 的「方案 A + 方案 a」为本 bug 的最小且充分修复(必做):**

1. **方案 A**——`prepare-backend.js:86` 的 `._pth` 数组追加 `'../backend'`
   (置于 `Lib/site-packages` 之后)。一行改动根除 Bug 1;两树目录关系、
   遮蔽顺序、构建期副作用三个边界已逐一确认(见 §5 评审补充)。
2. **方案 a**——删除 `ai_video_generate_service.py:447` 的模块级实例化,
   `ai_video_generate_router.py` 在请求处理时按 `ai_mixed_editing_router.py:71`
   的现成模式惰性实例化。影响面实测为 2 个文件、1 个调用点;行为变化是
   「进程起不来」→「未配置时该接口请求时返回 5xx」,与对照组一致,也与
   第 3 轮「零配置可启动、用到才引导去设置」的设计意图一致。

**三个加固项(§6 第 3–5 条)一并采纳,但附两个评审条件:**

3. spawn args 改 `['-X', 'utf8', 'run.py']`(修复被 `ignore_env` 吞掉的
   UTF-8 设定;注意 `PYTHONNOUSERSITE` 必须保留,见 §3.4 注的 flags 复测)。
4. 构建期断言**维持 `import app` 粒度、不要升级为 `import app.main`**:
   `app/__init__.py` 仅含 `__version__`、零副作用,足以断言 sys.path 修复
   (Bug 1 类回归);而 `import app.main` 会触发全部服务的模块级初始化,在
   `build/backend` 内产生 logs/static 等副作用目录并随包出厂。Bug 2 类回归
   由第 5 条的冒烟测试负责拦截,分工更干净。
5. `build.ps1` 冒烟测试改为默认执行(`-SmokeTest` 反转为 `-SkipSmokeTest`),
   **且必须同步把 `smoke-test.js:12` 的 90s 启动死线提到 ≥120s**(与
   `backendService.js:58` 对齐)——否则实测 60–70s 的冷启动在慢盘机器上会让
   默认冒烟先于应用自身超时而误报。

§3.4 第 3 条(`healthTimeoutMs` 120s→180s)定级为**可选**,不阻塞本轮;
若做,与第 5 条的冒烟死线一并调整以保持「冒烟死线 ≥ 应用死线」不变式。

### 4. 回归风险评估

- 方案 A 只影响打包产物的 `sys.path` 尾部,Web 部署版(venv 标准 python,
  无 `._pth`)零影响;
- 方案 a 使该 workflow 节点在未配置时从「拖死整个进程」退化为「单接口 5xx」,
  无其他消费方(唯一调用点 `router:133`),回归面可控;
- 冒烟测试默认化是纯增益的出厂门禁,失败即拦截坏包,不改变产物本身。

**结论:证据链闭环,推荐修复明确——「方案 A + 方案 a」为必做核心,
加固 3/4/5 随同落地(含第 5 条的 90s→≥120s 死线条件)。可进入修复节点。**

---

## 实施过程发现的方案缺陷

- **发现日期**: 2026-06-07(修复节点实施期间)
- **涉及推荐项**: §6 第 5 条 / 评审结论第 5 条(冒烟测试默认执行)

### 缺陷:`smoke-test.js` 原样继承 `ELECTRON_RUN_AS_NODE`,在 agent / Electron 派生终端中必然误报

把冒烟测试设为默认后首次全量验证(`build.ps1 -Dir -SkipFrontend`,
2026-06-07 13:45)即触发:打包成功(2.3 分钟,两条构建期断言含新增的
`import app` 全部通过),但冒烟阶段报
`FAIL: Ecliptrix.exe exited during startup`,exe 秒退、userData 里连
logs 目录都没建出来。手动以 stderr 捕获复跑,真实报错为:

```
Ecliptrix.exe: bad option: --user-data-dir=C:\Users\...\eclx-dbg-...
```

这是 **Node 的参数解析器**输出——本次构建/冒烟由 agent 工具链发起,环境里带
`ELECTRON_RUN_AS_NODE=1`(实测确认),该变量使任何 Electron 可执行文件退化为
纯 Node 进程,于是 `--user-data-dir` 被当作非法 Node 选项直接拒绝。
`smoke-test.js` spawn Ecliptrix.exe 时原样继承 `process.env`,没有剔除此变量。

**影响判定**:与两个根因修复本身无关(机制级验证已先行通过),也不影响最终
用户——用户机器不会有此变量;但它让「冒烟测试默认化」这条加固在 agent 工具链
/ 由 Electron 程序派生的终端中**必然误报构建失败**(退出码 5),违背该加固
「出厂门禁」的本意。冒烟测试此前从未默认运行过,所以这个潜伏问题一直没暴露。

**修正**(已随本轮落地,`smoke-test.js:119-127`):spawn 前复制
`process.env` 并删除 `ELECTRON_RUN_AS_NODE` 再传入子进程。修正后同环境复跑,
exe 正常拉起、双服务 health 200、登录成功(后端 spawn→healthy 实测 31 秒,
`-X utf8` 参数在 main.log 的 spawn 行可见)——该缺陷消除。

### 缺陷 2:`config.py` 的 `load_dotenv()` 向上搜索,包内后端会吞掉构建机仓库根的 `.env`

上述复跑通过启动与登录后,冒烟在第 2.5 步零配置断言上失败:
`/api/config/llm-status` 返回 `{"configured":true,"source":"environment"}`,
而冒烟的 userData/.env 故意不含任何 LLM key,Electron 层也在 main.log 里
确认 `config incomplete (LLM_API_KEY, LLM_API_URL) — starting anyway`。

排查确认:会话环境无任何 `LLM_*` 变量;真正来源是
`app/config.py:12` 的裸 `load_dotenv()`——python-dotenv 的 `find_dotenv`
会从 `config.py` 所在目录**逐级向上**搜索 `.env`,打包后端位于
`desktop/release/win-unpacked/resources/backend/` 时一路搜到
**仓库根 `M:/takoAI/Ecliptrix/.env`**(含真实 key)并加载。诊断与评审
都未发现这条通路,因为此前打包后端从未成功启动过。

**影响判定**:构建机上(win-unpacked 在仓库树内)默认冒烟的零配置断言
**必然误报**;同时这也是真实的末端用户边缘——把 win-unpacked 解压到任何
上游目录存在 `.env` 的位置,包内后端都会静默吸入那份配置,破坏
「桌面端配置只来自 userData/.env(经 Electron 注入)」的设计契约。

**修正**(已随本轮落地,`prepare-backend.js` `copyBackendSources()`):
随包在 `resources/backend/.env` 写入一个**空哨兵文件**(仅注释),让
`find_dotenv` 在包内即停;python-dotenv 不覆盖已存在的进程环境变量,
故对 Electron 注入的配置零影响。Web 部署版不受影响(其 `.env` 本就位于
`basic-service/` 自身目录,向上搜索第一站即命中)。

### 附带小修:构建期 `import app` 断言加 `-B`

按评审条件 4 落地 `import app` 断言后,实测它会在 `build/backend/app/`
留下 `__pycache__/__init__.pyc` 并随包出厂——正是该条件想避免的
「构建期副作用入包」(虽然只有一个文件)。断言命令已加 `-B` 禁写字节码。
