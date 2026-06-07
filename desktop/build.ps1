<#
.SYNOPSIS
    Ecliptrix 桌面端一键打包脚本(Windows PowerShell 5.1 / PowerShell 7+)。

.DESCRIPTION
    自包含的打包入口:环境检查 → 根项目与 desktop/ 依赖安装(缺失时)→
    调用既有 scripts/build.js 打包 →(可选)冒烟测试。脚本只做编排与兜底,
    所有 prepare / 断言 / 产物输出仍由 scripts/build.js 单点负责。

    脚本以 $PSScriptRoot 自我定位,与调用方当前目录无关;可在资源管理器
    右键「使用 PowerShell 运行」,或在任意终端中执行。

    退出码契约:0 成功;2 环境检查失败(node/npm 缺失或 node < 18.18);
    3 npm install 失败;4 build.js 非零退出(含 -Clean 路径);
    5 smoke-test.js 非零退出。

    PS 编排层日志写入 cache/build-logs/build-<时间戳>.log。注意:
    PowerShell 5.1 下 node/npm 子进程直写控制台的输出不会进入该日志;
    需要全量构建日志时,在 powershell.exe 进程边界重定向(见最后一个示例)。

.EXAMPLE
    .\build.ps1
    完整打包,产出 release/Ecliptrix-Setup-<ver>.exe 与 release/win-unpacked/。

.EXAMPLE
    .\build.ps1 -Dir -SkipFrontend -SkipBackend
    复用上次前后端工件,仅重打 win-unpacked(迭代最快)。

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File desktop/build.ps1 -Dir
    执行策略受限(默认 Restricted)的机器上的标准调用方式。

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File desktop\build.ps1 -NoPause > full.log 2>&1
    从 cmd / CI 收集含 node/npm 子进程输出的全量构建日志。
#>
[CmdletBinding()]
param(
    [switch]$Dir,           # 跳过 NSIS,仅产出 win-unpacked(透传 --dir)
    [switch]$SkipFrontend,  # 复用上次 build/frontend 工件(透传 --skip-frontend)
    [switch]$SkipBackend,   # 复用 build/backend + python 工件(透传 --skip-backend)
    [switch]$CnMirror,      # npm registry + Electron 镜像,并透传 --cn-mirror
    [switch]$Clean,         # 只清理 build/ 与 release/ 后退出(透传 --clean)
    [switch]$SkipInstall,   # 跳过两处 npm install 探测(复用现有 node_modules)
    [switch]$SmokeTest,     # 打包成功后追加 node scripts/smoke-test.js
    [switch]$NoPause        # 结束时不暂停(CI / 终端用户)
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'

# --- 常量 --------------------------------------------------------------------

# 须与 scripts/preflight.js 的 MIN_NODE 保持同步(build.js 仍会权威复检)。
$MIN_NODE = @(18, 18)
$NPM_CN_REGISTRY = 'https://registry.npmmirror.com'
# 取值与 scripts/preflight.js 的 applyMirrorEnv 一致(生效时机不同:
# 这里覆盖 npm install / electron postinstall 阶段,preflight.js 覆盖 build 阶段)。
$ELECTRON_MIRROR_CN = 'https://npmmirror.com/mirrors/electron/'
$ELECTRON_BUILDER_MIRROR_CN = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
$DESKTOP_ROOT = $PSScriptRoot
$REPO_ROOT = Split-Path $PSScriptRoot -Parent

# 退出码契约(spec §4.2):catch 块按 $script:phase 查表赋值,
# 禁止对异常消息做字符串匹配(评审 R3)。
$EXIT_BY_PHASE = @{
    preflight = 2
    install   = 3
    build     = 4
    smoke     = 5
}

# --- 函数 --------------------------------------------------------------------

function Write-Section {
    param([string]$Title)
    Write-Host ''
    Write-Host "=== $Title ===" -ForegroundColor Cyan
}

function Assert-CommandAvailable {
    param([string]$Name, [string]$Hint)
    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($null -eq $command) {
        throw "未在 PATH 中找到命令「$Name」。$Hint"
    }
    Write-Host "  ${Name}: $($command.Source) — ok"
}

function Assert-NodeVersion {
    $raw = (& node --version)
    if ($LASTEXITCODE -ne 0) {
        throw "执行「node --version」失败(退出码 $LASTEXITCODE)"
    }
    $version = "$raw".Trim().TrimStart('v')
    $parts = $version.Split('.')
    $major = [int]$parts[0]
    $minor = 0
    if ($parts.Length -ge 2) { $minor = [int]$parts[1] }
    $minMajor = [int]$MIN_NODE[0]
    $minMinor = [int]$MIN_NODE[1]
    $isTooOld = (
        ($major -lt $minMajor) -or
        (($major -eq $minMajor) -and ($minor -lt $minMinor))
    )
    if ($isTooOld) {
        throw ("Node 版本过低:需要 $minMajor.$minMinor+(Next.js 15 下限)," +
            "实测 $version。请升级:https://nodejs.org/")
    }
    Write-Host "  node 版本: $version — ok(下限 $minMajor.$minMinor)"
}

function Invoke-Native {
    # 不重定向 stderr:PS 5.1 下 2>&1 会把 native stderr(如 npm 进度行)
    # 包装成 ErrorRecord 触发 NativeCommandError 误报;成败仅看 $LASTEXITCODE。
    param([string]$Exe, [string[]]$Argv, [string]$Cwd)
    $commandLine = "$Exe $($Argv -join ' ')"
    Write-Host "  > $commandLine"
    Write-Host "    (cwd: $Cwd)"
    Push-Location $Cwd
    try {
        & $Exe @Argv
    }
    finally {
        Pop-Location
    }
    if ($LASTEXITCODE -ne 0) {
        throw "命令失败(原始退出码 $LASTEXITCODE):$commandLine(cwd: $Cwd)"
    }
}

function Install-NodeModulesIfMissing {
    param([string]$Dir, [string]$Probe, [string[]]$ExtraArgs = @())
    $probePath = Join-Path $Dir $Probe
    if (Test-Path $probePath) {
        Write-Host "  已存在,跳过 npm install:$probePath"
        return
    }
    Write-Host "  未检测到 $probePath,开始 npm install ..."
    Invoke-Native 'npm' (@('install') + $ExtraArgs) $Dir
}

function Test-LaunchedFromExplorer {
    # 两次 CIM 查询:本进程 → 父进程名。任何异常一律返回 $false
    # (探测失败宁可不暂停,且可用 -NoPause 显式关闭)。
    try {
        $self = Get-CimInstance Win32_Process -Filter "ProcessId = $PID" `
            -ErrorAction Stop
        if ($null -eq $self) { return $false }
        $parent = Get-CimInstance Win32_Process `
            -Filter "ProcessId = $($self.ParentProcessId)" -ErrorAction Stop
        if ($null -eq $parent) { return $false }
        return ($parent.Name -ieq 'explorer.exe')
    }
    catch {
        return $false
    }
}

# --- 主流程 ------------------------------------------------------------------

$script:phase = 'preflight'
$exitCode = 0
$startedAt = Get-Date
$transcriptStarted = $false
$transcriptPath = ''

# UTF-8 输出编码:让 node/npm 的 UTF-8 日志在默认 GBK 控制台正确显示。
# 非控制台宿主(ISE 等)下取/赋 [Console]::OutputEncoding 会抛异常 — 失败
# 不阻断;先保存原编码,结束时恢复,避免污染调用方终端会话(评审 R5)。
$originalOutputEncoding = $OutputEncoding
$originalConsoleEncoding = $null
try {
    $originalConsoleEncoding = [Console]::OutputEncoding
    $OutputEncoding = [Text.Encoding]::UTF8
    [Console]::OutputEncoding = [Text.Encoding]::UTF8
}
catch {
    Write-Host '[warn] 当前宿主不支持调整控制台编码,中文输出可能乱码(不影响打包)'
}

try {
    # 1. transcript:仅记录 PS 编排层输出(评审 R1),失败不阻断(评审 R4)。
    try {
        $logDir = Join-Path (Join-Path $DESKTOP_ROOT 'cache') 'build-logs'
        New-Item -ItemType Directory -Force -Path $logDir | Out-Null
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
        $transcriptPath = Join-Path $logDir "build-$stamp.log"
        Start-Transcript -Path $transcriptPath | Out-Null
        $transcriptStarted = $true
        Write-Host "PS 编排层日志:$transcriptPath"
        Write-Host '(node/npm 子进程输出不在其中;全量日志收集方法见 desktop/README.md)'
    }
    catch {
        Write-Host "[warn] Start-Transcript 不可用,本次无编排层日志:$($_.Exception.Message)"
    }

    # 2. PS 层 preflight。置于 -Clean 之前:-Clean 路径下 node 缺失同样得到
    #    中文提示与退出码 2(评审 R2)。
    $script:phase = 'preflight'
    Write-Section '环境检查(preflight)'
    Assert-CommandAvailable 'node' '请安装 Node.js 18.18+:https://nodejs.org/'
    Assert-CommandAvailable 'npm' 'npm 应随 Node.js 一并安装;请检查 Node.js 安装是否完整'
    Assert-NodeVersion

    $buildJs = Join-Path (Join-Path $DESKTOP_ROOT 'scripts') 'build.js'

    if ($Clean) {
        # 3. -Clean:只清理后退出(互斥于其余打包参数,优先生效;
        #    build.js 非零时由 catch 统一映射为退出码 4)。
        $script:phase = 'build'
        Write-Section '清理(scripts/build.js --clean)'
        Invoke-Native 'node' @($buildJs, '--clean') $DESKTOP_ROOT
        Write-Host '  清理完成(cache/ 保留)'
    }
    else {
        # 4. 镜像 env 必须在任何 npm install 之前生效 — electron 二进制在
        #    postinstall 阶段下载,preflight.js 的 applyMirrorEnv 覆盖不到这里。
        #    与其取值一致,同样「已存在则不覆盖」(spec §4.3)。
        if ($CnMirror) {
            Write-Section '国内镜像(-CnMirror)'
            if (-not $env:ELECTRON_MIRROR) {
                $env:ELECTRON_MIRROR = $ELECTRON_MIRROR_CN
            }
            if (-not $env:ELECTRON_BUILDER_BINARIES_MIRROR) {
                $env:ELECTRON_BUILDER_BINARIES_MIRROR = $ELECTRON_BUILDER_MIRROR_CN
            }
            Write-Host "  ELECTRON_MIRROR = $env:ELECTRON_MIRROR"
            Write-Host "  ELECTRON_BUILDER_BINARIES_MIRROR = $env:ELECTRON_BUILDER_BINARIES_MIRROR"
            Write-Host "  npm registry = $NPM_CN_REGISTRY"
        }

        # 5. 依赖安装(可被 -SkipInstall 跳过)。
        $script:phase = 'install'
        Write-Section '依赖安装'
        if ($SkipInstall) {
            Write-Host '  -SkipInstall:跳过 npm install 探测,复用现有 node_modules'
        }
        else {
            $npmExtraArgs = @()
            if ($CnMirror) { $npmExtraArgs = @("--registry=$NPM_CN_REGISTRY") }
            # 根项目:node_modules 目录存在即视为装过 — prepare-frontend 内部
            # 会再跑 npm run build,坏依赖在那里报错(spec §2.2 要点 2)。
            Install-NodeModulesIfMissing $REPO_ROOT 'node_modules' $npmExtraArgs
            # desktop/:electron-builder 是 build.js 经 npx 调用的硬依赖。
            Install-NodeModulesIfMissing $DESKTOP_ROOT 'node_modules/electron-builder' $npmExtraArgs
        }

        # 6. 调用既有 build.js(参数白名单透传,spec §4.1)。
        $script:phase = 'build'
        Write-Section '打包(scripts/build.js)'
        $buildArgv = @($buildJs)
        if ($Dir) { $buildArgv += '--dir' }
        if ($SkipFrontend) { $buildArgv += '--skip-frontend' }
        if ($SkipBackend) { $buildArgv += '--skip-backend' }
        if ($CnMirror) { $buildArgv += '--cn-mirror' }
        Invoke-Native 'node' $buildArgv $DESKTOP_ROOT

        # 7. 可选冒烟测试。
        if ($SmokeTest) {
            $script:phase = 'smoke'
            Write-Section '冒烟测试(scripts/smoke-test.js)'
            $smokeJs = Join-Path (Join-Path $DESKTOP_ROOT 'scripts') 'smoke-test.js'
            Invoke-Native 'node' @($smokeJs) $DESKTOP_ROOT
        }

        # 8. 摘要(产物明细 build.js 已打印)。
        Write-Section '完成'
        $elapsedMinutes = ((Get-Date) - $startedAt).TotalMinutes
        Write-Host ('  总耗时:{0:N1} 分钟' -f $elapsedMinutes)
        Write-Host "  产物目录:$(Join-Path $DESKTOP_ROOT 'release')"
    }
}
catch {
    $exitCode = 1
    if ($EXIT_BY_PHASE.ContainsKey($script:phase)) {
        $exitCode = $EXIT_BY_PHASE[$script:phase]
    }
    Write-Host ''
    Write-Host "[FAILED][$($script:phase)] $($_.Exception.Message)" -ForegroundColor Red
    if ($transcriptStarted) {
        Write-Host "PS 编排层日志:$transcriptPath" -ForegroundColor Red
    }
}
finally {
    # 9a. 仅在转录确已启动时停止,避免二次异常污染退出码(评审 R4)。
    if ($transcriptStarted) {
        try { Stop-Transcript | Out-Null }
        catch { Write-Host '[warn] Stop-Transcript 失败(忽略)' }
    }
    # 9b. 恢复控制台原编码(评审 R5)。
    try {
        if ($null -ne $originalConsoleEncoding) {
            [Console]::OutputEncoding = $originalConsoleEncoding
        }
        $OutputEncoding = $originalOutputEncoding
    }
    catch {
        Write-Host '[warn] 恢复控制台编码失败(忽略)'
    }
}

# 9c. 双击启动且未 -NoPause 时暂停,防止窗口一闪而过看不到结果。
if ((-not $NoPause) -and (Test-LaunchedFromExplorer)) {
    Read-Host '按 Enter 退出' | Out-Null
}
exit $exitCode
