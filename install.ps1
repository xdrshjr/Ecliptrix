# ============================================
# Ecliptrix - Windows Installation Script (PowerShell)
# Ecliptrix Windows 安装脚本
# ============================================
# Usage: .\install.ps1 [-SkipDb] [-SkipFrontend] [-SkipBackend] [-CnMirror]
#
# Note: You may need to run:
#   Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
# before running this script for the first time.
# ============================================

param(
    [switch]$SkipDb,
    [switch]$SkipFrontend,
    [switch]$SkipBackend,
    [switch]$CnMirror,
    [switch]$Help
)

$ErrorActionPreference = "Continue"

# ============ Configuration ============
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $ScriptDir "backend-services\basic-service"
$LogDir = Join-Path $ScriptDir "logs"
$InstallLog = Join-Path $LogDir "install.log"
$VenvDir = Join-Path $BackendDir "venv"

# Database defaults
$DbName = "ecliptrix"
$DbUser = "ecliptrix"
$DbPass = "ecliptrix"
$DbHost = "localhost"
$DbPort = "5432"

# Docker defaults
$DockerContainerName = "ecliptrix-postgres"
$DockerImage = "postgres:13"
$DockerImageCN = "docker.m.daocloud.io/library/postgres:13"

# Database method (detected in Step 1): docker | psql | none
$DbMethod = "none"

# ============ Help ============
if ($Help) {
    Get-Content $MyInvocation.MyCommand.Path | Select-Object -First 14 | Select-Object -Skip 1
    exit 0
}

# ============ Logging Functions ============
New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

function Write-Log {
    param([string]$Level, [ConsoleColor]$Color, [string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$Level] $timestamp - $Message"
    Write-Host $line -ForegroundColor $Color
    Add-Content -Path $InstallLog -Value $line -ErrorAction SilentlyContinue
}

function Write-Info    { param([string]$Msg) Write-Log "INFO"  Blue    $Msg }
function Write-OK      { param([string]$Msg) Write-Log "OK"    Green   $Msg }
function Write-Warn    { param([string]$Msg) Write-Log "WARN"  Yellow  $Msg }
function Write-Err     { param([string]$Msg) Write-Log "ERROR" Red     $Msg }
function Write-Step    { param([string]$Msg) Write-Log "STEP"  Magenta $Msg }
function Write-Header  { param([string]$Msg) Write-Host "`n$Msg" -ForegroundColor Cyan; Add-Content -Path $InstallLog -Value $Msg -ErrorAction SilentlyContinue }

# ============ Helper Functions ============

function Test-CommandExists {
    param([string]$Command)
    return $null -ne (Get-Command $Command -ErrorAction SilentlyContinue)
}

function Test-VersionGte {
    param([string]$Current, [string]$Required)
    $cur = [version]($Current -replace '^v' -replace '[^0-9.]', '')
    $req = [version]($Required -replace '^v' -replace '[^0-9.]', '')
    return $cur -ge $req
}

# Detect Python command (python first on Windows, then python3)
function Find-Python {
    if (Test-CommandExists "python") {
        $ver = & python --version 2>&1
        if ($ver -match "Python\s+(\d+\.\d+)") { return "python" }
    }
    if (Test-CommandExists "python3") { return "python3" }
    return $null
}

# ============ Main Script ============

Write-Header "============================================"
Write-Header "   Ecliptrix Installation Script (Windows)"
Write-Header "   Ecliptrix Windows 安装脚本"
Write-Header "============================================"
Write-Host ""

Write-Info "Operating System: Windows"
Write-Info "Working Directory / 工作目录: $ScriptDir"
Write-Info "Install Log / 安装日志: $InstallLog"
Write-Host ""

# ============ Step 1: Check Prerequisites ============
Write-Header "[1/7] Checking Prerequisites / 检查系统依赖"

$PrereqOK = $true

# --- Node.js ---
Write-Step "Checking Node.js..."
if (Test-CommandExists "node") {
    $nodeVer = & node --version 2>&1
    if (Test-VersionGte $nodeVer "18.0.0") {
        Write-OK "Node.js $nodeVer"
    } else {
        Write-Err "Node.js $nodeVer is too old. Required: `>= 18.0.0"
        $PrereqOK = $false
    }
} else {
    Write-Err "Node.js not found / 未找到 Node.js"
    Write-Err "Install from: https://nodejs.org/ (LTS recommended)"
    $PrereqOK = $false
}

# --- npm ---
Write-Step "Checking npm..."
if (Test-CommandExists "npm") {
    $npmVer = & npm --version 2>&1
    Write-OK "npm $npmVer"
} else {
    Write-Err "npm not found / 未找到 npm"
    $PrereqOK = $false
}

# --- Python ---
Write-Step "Checking Python..."
$PythonCmd = Find-Python
if ($PythonCmd) {
    $pyVer = & $PythonCmd --version 2>&1
    $pyVerNum = ($pyVer -replace 'Python\s+', '').Trim()
    if (Test-VersionGte $pyVerNum "3.10.0") {
        Write-OK "Python $pyVerNum ($PythonCmd)"
    } else {
        Write-Err "Python $pyVerNum is too old. Required: `>= 3.10.0"
        $PrereqOK = $false
    }
} else {
    Write-Err "Python not found / 未找到 Python"
    Write-Err "Install from: https://www.python.org/downloads/"
    $PrereqOK = $false
}

# --- FFmpeg ---
Write-Step "Checking FFmpeg..."
if (Test-CommandExists "ffmpeg") {
    $ffmpegOut = & ffmpeg -version 2>&1 | Select-Object -First 1
    Write-OK "FFmpeg found: $ffmpegOut"
} else {
    Write-Warn "FFmpeg not found / 未找到 FFmpeg"
    Write-Warn "Video processing features will not work without FFmpeg"
    Write-Warn "Install: choco install ffmpeg  OR  https://ffmpeg.org/download.html"
}

# --- PostgreSQL / Docker ---
Write-Step "Checking PostgreSQL setup method..."
if (-not $SkipDb) {
    if (Test-CommandExists "docker") {
        # Verify Docker daemon is running
        $dockerInfoResult = docker info 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-OK "Docker available (preferred for PostgreSQL) / Docker 可用"
            $DbMethod = "docker"
        } else {
            Write-Warn "Docker found but daemon is not running / Docker 已安装但未启动"
            Write-Warn "Start Docker Desktop and try again / 请启动 Docker Desktop 后重试"
        }
    }

    if ($DbMethod -eq "none" -and (Test-CommandExists "psql")) {
        $pgVer = & psql --version 2>&1
        Write-OK "PostgreSQL client: $pgVer (will use psql for DB setup)"
        $DbMethod = "psql"
    }

    if ($DbMethod -eq "none") {
        Write-Warn "Neither Docker nor psql found / 未找到 Docker 或 psql"
        Write-Warn "Database auto-setup will be skipped / 将跳过数据库自动配置"
        Write-Warn "Install Docker Desktop (recommended): https://docs.docker.com/desktop/install/windows/"
        Write-Warn "Or install PostgreSQL: https://www.postgresql.org/download/windows/"
        $SkipDb = $true
    }
} else {
    Write-Info "Database setup skipped by flag / 已通过参数跳过数据库配置"
}

if (-not $PrereqOK) {
    Write-Err "============================================"
    Write-Err "Missing required prerequisites. Please install them first."
    Write-Err "缺少必要依赖，请先安装上述缺失的工具。"
    Write-Err "============================================"
    exit 1
}

Write-Host ""
Write-OK "All prerequisites OK / 所有依赖检查通过"

# ============ Step 2: Frontend Installation ============
if (-not $SkipFrontend) {
    Write-Header "[2/7] Installing Frontend Dependencies / 安装前端依赖"

    Push-Location $ScriptDir

    $npmArgs = @()
    if ($CnMirror) {
        Write-Info "Using Chinese npm mirror / 使用国内 npm 镜像"
        $npmArgs = @("--registry", "https://registry.npmmirror.com")
    }

    Write-Step "Running npm install..."
    & npm install $npmArgs 2>&1 | Tee-Object -Append -FilePath $InstallLog
    if ($LASTEXITCODE -eq 0) {
        Write-OK "Frontend dependencies installed / 前端依赖安装完成"
    } else {
        Write-Err "npm install failed / npm install 失败"
        Pop-Location
        exit 1
    }

    Pop-Location
} else {
    Write-Info "[2/7] Skipping frontend installation (-SkipFrontend)"
}

# ============ Step 3: Backend Python Virtual Environment ============
if (-not $SkipBackend) {
    Write-Header "[3/7] Setting Up Backend Python Environment / 配置后端 Python 环境"

    Push-Location $BackendDir

    # Create virtual environment if it doesn't exist
    if (-not (Test-Path $VenvDir)) {
        Write-Step "Creating Python virtual environment / 创建 Python 虚拟环境..."
        & $PythonCmd -m venv venv
        Write-OK "Virtual environment created at $VenvDir"
    } else {
        Write-Info "Virtual environment already exists / 虚拟环境已存在"
    }

    # Activate virtual environment
    Write-Step "Activating virtual environment / 激活虚拟环境..."
    $activateScript = Join-Path $VenvDir "Scripts\Activate.ps1"
    if (Test-Path $activateScript) {
        . $activateScript
    } else {
        Write-Err "Cannot find venv activation script: $activateScript"
        Pop-Location
        exit 1
    }
    Write-OK "Virtual environment activated"

    $pipArgs = @()
    if ($CnMirror) {
        $pipArgs = @("-i", "https://pypi.tuna.tsinghua.edu.cn/simple")
    }

    # Upgrade pip
    Write-Step "Upgrading pip..."
    & pip install --upgrade pip $pipArgs 2>&1 | Tee-Object -Append -FilePath $InstallLog

    # Install Python dependencies
    Write-Step "Installing Python dependencies / 安装 Python 依赖..."
    & pip install -r requirements.txt $pipArgs 2>&1 | Tee-Object -Append -FilePath $InstallLog
    if ($LASTEXITCODE -eq 0) {
        Write-OK "Python dependencies installed / Python 依赖安装完成"
    } else {
        Write-Err "pip install failed / pip install 失败"
        deactivate 2>$null
        Pop-Location
        exit 1
    }

    # Install Playwright browsers (optional)
    Write-Step "Installing Playwright browsers (this may take a while) / 安装 Playwright 浏览器..."
    & $PythonCmd -m playwright install chromium 2>&1 | Tee-Object -Append -FilePath $InstallLog
    if ($LASTEXITCODE -ne 0) {
        Write-Warn "Playwright install skipped (optional) / Playwright 安装跳过（可选功能）"
    }

    # Deactivate venv
    if (Get-Command deactivate -ErrorAction SilentlyContinue) { deactivate }

    Pop-Location
} else {
    Write-Info "[3/7] Skipping backend installation (-SkipBackend)"
}

# ============ Step 4: Environment Configuration ============
Write-Header "[4/7] Setting Up Environment Files / 配置环境变量文件"

# Frontend .env.local
$FrontendEnv = Join-Path $ScriptDir ".env.local"
$FrontendEnvTemplate = Join-Path $ScriptDir "env.template"
if (-not (Test-Path $FrontendEnv)) {
    if (Test-Path $FrontendEnvTemplate) {
        Write-Step "Creating frontend .env.local from template / 从模板创建前端 .env.local"
        Copy-Item $FrontendEnvTemplate $FrontendEnv
        Write-OK "Created $FrontendEnv"
        Write-Warn "Please edit .env.local and fill in your API keys / 请编辑 .env.local 填入你的 API 密钥"
    } else {
        Write-Warn "No env.template found, skipping frontend env setup"
    }
} else {
    Write-Info "Frontend .env.local already exists / 前端 .env.local 已存在"
}

# Backend .env
$BackendEnv = Join-Path $BackendDir ".env"
$BackendEnvTemplate = Join-Path $BackendDir "env.template"
if (-not (Test-Path $BackendEnv)) {
    if (Test-Path $BackendEnvTemplate) {
        Write-Step "Creating backend .env from template / 从模板创建后端 .env"
        Copy-Item $BackendEnvTemplate $BackendEnv
        Write-OK "Created $BackendEnv"
        Write-Warn "Please edit backend .env and fill in your API keys / 请编辑后端 .env 并填入你的 API 密钥"
    } else {
        Write-Warn "No backend env.template found"
    }
} else {
    Write-Info "Backend .env already exists / 后端 .env 已存在"
}

# ============ Step 5: Database Setup ============
if (-not $SkipDb) {
    Write-Header "[5/7] Setting Up PostgreSQL Database / 配置 PostgreSQL 数据库"

    if ($DbMethod -eq "docker") {
        # ---- Docker-based PostgreSQL setup ----
        Write-Step "Setting up PostgreSQL via Docker..."

        # Select image (use Chinese mirror if requested)
        $dockerImg = $DockerImage
        if ($CnMirror) {
            $dockerImg = $DockerImageCN
            Write-Info "Using Chinese Docker mirror / 使用国内 Docker 镜像: $dockerImg"
        }

        # Check if container already exists
        $containerState = docker inspect --format "{{.State.Status}}" $DockerContainerName 2>$null
        if ($LASTEXITCODE -ne 0) { $containerState = "not_found" }

        if ($containerState -eq "running") {
            Write-OK "Container '$DockerContainerName' is already running / 容器已在运行"
        } elseif ($containerState -eq "exited" -or $containerState -eq "created") {
            Write-Step "Starting existing container '$DockerContainerName'..."
            docker start $DockerContainerName 2>&1 | Out-File -Append $InstallLog
            if ($LASTEXITCODE -eq 0) {
                Write-OK "Container started / 容器已启动"
            } else {
                Write-Err "Failed to start container / 容器启动失败"
                Write-Warn "Check: docker logs $DockerContainerName"
                $SkipDb = $true
            }
        } else {
            Write-Step "Creating PostgreSQL container / 创建 PostgreSQL 容器..."
            $dockerRunResult = docker run -d `
                --name $DockerContainerName `
                -e "POSTGRES_USER=$DbUser" `
                -e "POSTGRES_PASSWORD=$DbPass" `
                -e "POSTGRES_DB=$DbName" `
                -p "${DbPort}:5432" `
                --restart unless-stopped `
                $dockerImg 2>&1
            if ($LASTEXITCODE -eq 0) {
                Write-OK "Container '$DockerContainerName' created / 容器创建成功"
            } else {
                Write-Err "Failed to create Docker container / Docker 容器创建失败"
                Write-Warn "Error: $dockerRunResult"
                $SkipDb = $true
            }
        }

        # Wait for PostgreSQL to be ready
        if (-not $SkipDb) {
            Write-Step "Waiting for PostgreSQL to be ready / 等待 PostgreSQL 就绪..."
            $ready = $false
            for ($i = 1; $i -le 30; $i++) {
                docker exec $DockerContainerName pg_isready -U $DbUser 2>$null | Out-Null
                if ($LASTEXITCODE -eq 0) {
                    $ready = $true
                    break
                }
                Start-Sleep -Seconds 1
            }

            if ($ready) {
                Write-OK "PostgreSQL is ready / PostgreSQL 已就绪"

                # Enable UUID extension
                Write-Step "Enabling uuid-ossp extension..."
                docker exec $DockerContainerName psql -U $DbUser -d $DbName -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";' 2>&1 | Out-File -Append $InstallLog
                Write-OK "Database setup complete via Docker / Docker 数据库配置完成"
            } else {
                Write-Err "PostgreSQL did not become ready within 30s / PostgreSQL 在 30 秒内未就绪"
                Write-Warn "Check container logs: docker logs $DockerContainerName"
            }
        }

    } elseif ($DbMethod -eq "psql") {
        # ---- Native psql-based PostgreSQL setup ----
        Write-Step "Setting up PostgreSQL via psql..."

        Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
        $psqlTest = psql -w -h $DbHost -p $DbPort -U postgres -c "SELECT 1" 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-OK "PostgreSQL server is running / PostgreSQL 服务器运行中"

            $dbExists = psql -w -h $DbHost -p $DbPort -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='$DbName'" 2>$null
            $dbExists = $dbExists.Trim()

            if ($dbExists -eq "1") {
                Write-Info "Database '$DbName' already exists / 数据库已存在"
            } else {
                Write-Step "Creating database and user / 创建数据库和用户..."

                psql -w -h $DbHost -p $DbPort -U postgres -c "CREATE USER $DbUser WITH PASSWORD '$DbPass';" 2>$null

                psql -w -h $DbHost -p $DbPort -U postgres -c "CREATE DATABASE $DbName OWNER $DbUser;" 2>$null
                if ($LASTEXITCODE -eq 0) {
                    Write-OK "Database '$DbName' created / 数据库创建成功"

                    psql -w -h $DbHost -p $DbPort -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE $DbName TO $DbUser;" 2>$null

                    $env:PGPASSWORD = $DbPass
                    psql -w -h $DbHost -p $DbPort -U $DbUser -d $DbName -c 'CREATE EXTENSION IF NOT EXISTS "uuid-ossp";' 2>$null
                    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue

                    Write-OK "Database privileges granted / 数据库权限已配置"
                } else {
                    Write-Err "Failed to create database / 数据库创建失败"
                    Write-Warn "You may need to create it manually / 你可能需要手动创建数据库"
                }
            }
        } else {
            Write-Warn "Cannot connect to PostgreSQL server / 无法连接到 PostgreSQL 服务器"
            Write-Warn "Make sure PostgreSQL is running / 请确保 PostgreSQL 正在运行"
        }
    }
} else {
    Write-Info "[5/7] Skipping database setup (-SkipDb)"
}

# ============ Step 6: Run Database Migrations ============
if (-not $SkipDb -and -not $SkipBackend) {
    Write-Header "[6/7] Running Database Migrations / 执行数据库迁移"

    Push-Location $BackendDir

    # Activate venv
    $activateScript = Join-Path $VenvDir "Scripts\Activate.ps1"
    if (Test-Path $activateScript) {
        . $activateScript
    }

    Write-Step "Running Alembic migrations / 运行 Alembic 迁移..."
    & alembic upgrade head 2>&1 | Tee-Object -Append -FilePath $InstallLog
    if ($LASTEXITCODE -eq 0) {
        Write-OK "Database migrations complete / 数据库迁移完成"
    } else {
        Write-Warn "Alembic migration failed (database may not be accessible yet)"
        Write-Warn "迁移失败（数据库可能尚未就绪）"
        Write-Warn "Run manually later / 稍后手动运行:"
        Write-Warn "  cd $BackendDir; .\venv\Scripts\Activate.ps1; alembic upgrade head"
    }

    if (Get-Command deactivate -ErrorAction SilentlyContinue) { deactivate }

    Pop-Location
} else {
    Write-Info "[6/7] Skipping database migrations"
}

# ============ Step 7: Create Required Directories ============
Write-Header "[7/7] Creating Required Directories / 创建必要目录"

$dirs = @(
    "$BackendDir\static\uploads\video",
    "$BackendDir\static\uploads\audio",
    "$BackendDir\static\uploads\images",
    "$BackendDir\static\uploads\files",
    "$BackendDir\static\video\composed",
    "$BackendDir\static\video\thumbnails",
    "$BackendDir\static\audio\generated",
    "$BackendDir\static\audio\subtitles",
    "$BackendDir\static\timeline_exports",
    "$BackendDir\temp",
    "$BackendDir\logs",
    "$LogDir"
)

foreach ($dir in $dirs) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
}
Write-OK "All directories created / 所有目录已创建"

# ============ Installation Summary ============
Write-Header "============================================"
Write-Header "   Installation Complete!"
Write-Header "   安装完成！"
Write-Header "============================================"
Write-Host ""

Write-Host "Project Structure / 项目结构:" -ForegroundColor White
Write-Host "  Frontend / 前端: $ScriptDir"
Write-Host "  Backend  / 后端: $BackendDir"
Write-Host "  Python venv:     $VenvDir"
Write-Host ""

Write-Host "Configuration Files / 配置文件:" -ForegroundColor White
if (Test-Path $FrontendEnv) {
    Write-Host "  Frontend .env: $FrontendEnv" -ForegroundColor Green
} else {
    Write-Host "  Frontend .env: Not created (copy env.template to .env.local)" -ForegroundColor Red
}
if (Test-Path $BackendEnv) {
    Write-Host "  Backend  .env: $BackendEnv" -ForegroundColor Green
} else {
    Write-Host "  Backend  .env: Not created (copy env.template to .env)" -ForegroundColor Red
}
Write-Host ""

Write-Host "Next Steps / 下一步:" -ForegroundColor White
Write-Host ""
Write-Host "  1. Edit environment files with your API keys / 编辑环境变量文件，填入你的 API 密钥:" -ForegroundColor Yellow
Write-Host "     - $FrontendEnv"
Write-Host "     - $BackendEnv"
Write-Host ""

if ($DbMethod -eq "docker" -and -not $SkipDb) {
    Write-Host "  2. Database managed by Docker / 数据库由 Docker 管理:" -ForegroundColor Yellow
    Write-Host "     Start:   docker start $DockerContainerName"
    Write-Host "     Stop:    docker stop $DockerContainerName"
    Write-Host "     Logs:    docker logs $DockerContainerName"
    Write-Host ""
} elseif ($SkipDb) {
    Write-Host "  2. Set up PostgreSQL database / 配置 PostgreSQL 数据库:" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "     Option A: Docker (recommended) / 使用 Docker（推荐）:"
    Write-Host "     docker run -d --name $DockerContainerName ``"
    Write-Host "       -e POSTGRES_USER=$DbUser -e POSTGRES_PASSWORD=$DbPass -e POSTGRES_DB=$DbName ``"
    Write-Host "       -p ${DbPort}:5432 --restart unless-stopped $DockerImage"
    Write-Host ""
    Write-Host "     Option B: Native psql / 使用原生 psql:"
    Write-Host "     psql -U postgres"
    Write-Host "     CREATE USER $DbUser WITH PASSWORD '$DbPass';"
    Write-Host "     CREATE DATABASE $DbName OWNER $DbUser;"
    Write-Host "     GRANT ALL PRIVILEGES ON DATABASE $DbName TO $DbUser;"
    Write-Host ""
    Write-Host "  3. Run database migrations / 运行数据库迁移:" -ForegroundColor Yellow
    Write-Host "     cd $BackendDir"
    Write-Host "     .\venv\Scripts\Activate.ps1"
    Write-Host "     alembic upgrade head"
    Write-Host ""
}

Write-Host "  Start Services / 启动服务:" -ForegroundColor Yellow
Write-Host ""
Write-Host "     # Terminal 1: Start Backend / 启动后端"
Write-Host "     cd $BackendDir"
Write-Host "     .\venv\Scripts\Activate.ps1"
Write-Host "     uvicorn app.main:app --reload --host 0.0.0.0 --port 8000"
Write-Host ""
Write-Host "     # Terminal 2: Start Frontend / 启动前端"
Write-Host "     cd $ScriptDir"
Write-Host "     npm run dev"
Write-Host ""
Write-Host "     # Or use the start script (requires Git Bash) / 或使用启动脚本（需要 Git Bash）:"
Write-Host "     bash start.sh"
Write-Host ""

Write-Host "  Access / 访问:" -ForegroundColor Yellow
Write-Host "     Frontend: http://localhost:3000"
Write-Host "     Backend:  http://localhost:8000"
Write-Host "     API Docs: http://localhost:8000/docs"
Write-Host ""

Write-Host "  Default Login / 默认登录:" -ForegroundColor Yellow
Write-Host "     Username: admin"
Write-Host "     Password: admin"
Write-Host ""

Write-Host "Installation log saved to: $InstallLog" -ForegroundColor Green
Write-Host ""
