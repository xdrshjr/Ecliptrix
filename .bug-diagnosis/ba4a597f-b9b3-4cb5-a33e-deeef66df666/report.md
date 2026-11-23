# Bug Diagnosis Session

**Session UUID:** ba4a597f-b9b3-4cb5-a33e-deeef66df666
**Date:** 2026-11-19 20:30
**Mode:** Fully automatic
**Status:** Fixed

## Problem Description

`desktop/build.ps1` 打包失败,在 install 阶段就崩:

```
=== 依赖安装 ===
  已存在,跳过 npm install:M:\takoAI\Ecliptrix\node_modules
  未检测到 M:\takoAI\Ecliptrix\desktop\node_modules\electron-builder,开始 npm install ...
  > npm install
    (cwd: M:\takoAI\Ecliptrix\desktop)

[FAILED][install] 在此对象上找不到属性"Statement"。请确认该属性存在。
```

注意报错发生在 `> npm install` 打印之后、npm 自身任何输出之前 —— npm **根本没有真正跑起来**。

## Evidence Collected

- 宿主:`Windows PowerShell 5.1.26100.9818`(Desktop edition),在 `pwsh`/PowerShell 里执行 `.\build.ps1`。
- `Get-Command npm -All` → `npm.ps1`(ExternalScript)、`npm.cmd`、`npm`(Application)。
  PowerShell 把**外部脚本 `.ps1` 排在 `.cmd`/`.exe` 之前**,所以 `& npm` 走的是 `D:\Program Files\nodejs\npm.ps1`。
- `D:\Program Files\nodejs\npm.ps1` 第 30 行:
  ```powershell
  if ($MyInvocation.Statement) { ... } else { ...GetProperty('ScriptPosition'...) }
  ```
  该 shim 只在 `-Command` 触发时才安全;它读 `$MyInvocation.Statement` 这个在 5.1 InvocationInfo 上**不存在**的属性。
- `desktop/build.ps1` 第 51 行开了 `Set-StrictMode -Version 2.0`,第 142 行 `Invoke-Native 'npm' @('install')` → `& $Exe @Argv`。
  StrictMode 2.0 下访问不存在的属性会直接抛 `PropertyNotFoundException`,异常消息就是
  「在此对象上找不到属性"Statement"」。
- 复现实验 `desktop/cache/repro-npm-strictmode.ps1`:
  | 组合 | 结果 |
  |---|---|
  | StrictMode 2.0 + `& npm`(ps1 shim) | 抛 `找不到属性 Statement` |
  | StrictMode 2.0 + `& npm.cmd` | 正常输出 `10.9.3`,exit 0 |
  | StrictMode Off + `& npm`(ps1 shim) | 正常输出 `10.9.3`,exit 0 |
- `desktop/node_modules` 目录**完全不存在** → 该分支此前从未成功执行过。

## Root Cause Analysis

**Primary Hypothesis:**
`desktop/build.ps1:124` 的 `& $Exe @Argv` 用裸名 `npm` 调用,被解析成 `npm.ps1` shim;
shim 读取 `$MyInvocation.Statement`,与本脚本的 `Set-StrictMode -Version 2.0`(第 51 行)冲突,
属性访问抛异常 → `Invoke-Native` 视为 install 失败 → catch 按 `$script:phase = 'install'` 映射退出码 3。

**Why this causes the problem:**
失败点是**参数解析/属性访问**而非 npm 逻辑,所以现象正是「打印了命令行、npm 一行没输出、立刻失败」。
与「electron-builder 未安装 / hoisting」无关:失败发生在 npm 进程存在之前,`desktop/node_modules`
至今仍不存在即是佐证(不是装失败,而是没装)。

**Alternative Possibilities:**
1. ~~workspace hoisting 导致 `desktop/node_modules/electron-builder` 探测为假~~ —— 探测确实是假,
   但那是「未安装」的**原因效果**,不是本次报错;报错在前一步抛异常。
2. npm 版本/registry 问题 —— 被反证:同一台机器 StrictMode Off 下 `npm --version` 正常。
3. PowerShell 7 下无此问题(`$MyInvocation.Statement` 在 7 上存在),所以缺陷只在 5.1 暴露。

## Fix Plan

`Invoke-Native` 不再依赖名称解析优先级:新增 `Resolve-NativeExe`,对传入的命令名优先取
`.cmd` 再 `.exe`,取不到才退回原名(`node` 无 `.cmd` 时行为不变)。`Assert-CommandAvailable`
也报告实际将被执行的路径,避免再打印误导性的 `npm.ps1 — ok`。

保留 `Set-StrictMode -Version 2.0` —— 正是它把这条隐蔽的 shim 冲突提前暴露出来,不应为绕过而关掉。

## Verification Plan

1. `Parser::ParseFile` 解析 `desktop/build.ps1` 零错误,且 BOM 仍在。
2. 复现脚本的等价断言:StrictMode 2.0 下用**本脚本的解析函数**拿到 `npm.cmd` 并执行 `npm --version`。
3. 实跑 `desktop` 下 `npm install`(StrictMode 2.0 包裹),确认生成 `desktop/node_modules/electron-builder`。
4. 重新执行 `.\build.ps1`,确认越过 install 阶段(退出码不再是 3)。

## Verification

1. **BOM + 语法**:`[System.IO.File]::ReadAllBytes` 首三字节 `EF BB BF` 仍在;
   `Parser::ParseFile` 解析错误 0 条。
2. **解析函数的定向验证**(StrictMode 2.0 下,把脚本里的函数原样抠出来跑):
   `Resolve-NativeExe 'npm'` → `D:\Program Files\nodejs\npm.cmd`;
   `Resolve-NativeExe 'node'` → `D:\Program Files\nodejs\node.exe`;
   `Invoke-Native 'npm' @('--version')` 输出 `10.9.3`、`Invoke-Native 'node' @('--version')`
   输出 `v22.18.0`,均不再抛 `Statement`。
3. **install 阶段实跑**:`build.ps1 -Dir -SkipFrontend -SkipBackend -SkipSmokeTest`
   → install 打印 `added 404 packages in 21s`,随即进入 `=== 打包(scripts/build.js) ===`。
   (该次运行随后在 payload 断言处失败,原因是我传的 `-SkipFrontend` 复用了从未完整
   生成的旧 `build/frontend` —— 与本次缺陷无关,已用下面的完整运行排除。)
4. **完整打包(用户原始命令)**:`build.ps1 -NoPause` → 退出码 **0**,
   install 段「已存在,跳过」(electron-builder 已装上),payload 断言 `all payloads present`,
   electron-builder 打包,冒烟测试 `[smoke-test] PASS`(`no residual processes`),
   总耗时 23.9 分钟。产物:`desktop/release/Ecliptrix-Setup-1.0.1.exe`(480.5 MB),
   生成时间 2026/11/19 20:57。

日志:`desktop/cache/verify-full.log`、`desktop/cache/build-logs/build-2026*.log`
(临时复现/验证脚本 `desktop/cache/repro-npm-strictmode.ps1`、`verify-build-ps1.ps1`
验证后已删除;cache/ 不进版本库)。

## Notes

- 环境里有与本缺陷无关的未提交改动(skillrouter 相关),本次不动、不提交。
- 该缺陷只影响 Windows PowerShell 5.1;`pwsh` 7+ 与 CI(Linux)不受影响,所以自动化测试没抓到。
