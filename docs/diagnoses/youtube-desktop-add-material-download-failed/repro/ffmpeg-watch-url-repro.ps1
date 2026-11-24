# Repro: the generic material-cache pipeline cannot fetch a YouTube watch URL.
#
# This runs the exact ffmpeg invocation used by the backend
# `MaterialDownloadService._download_to_path()`
# (backend-services/basic-service/app/services/material_download_service.py:855-886):
#
#     ffmpeg -y -i <url> -c copy <target>
#
# A YouTube watch URL returns HTML, and ffmpeg has no YouTube extractor, so it
# always fails with "Invalid data found when processing input". The script prints
# the LAST 300 CHARACTERS of stderr - exactly the slice that `_do_download()`
# stores in cached_materials.error_message
# (material_download_service.py:822).
#
# Usage (repo root, PowerShell 5.1+; keep this file ASCII-only because PS 5.1
# reads scripts with the ANSI code page):
#     powershell -ExecutionPolicy Bypass -File docs/diagnoses/youtube-desktop-add-material-download-failed/repro/ffmpeg-watch-url-repro.ps1

param(
    [string]$VideoUrl = 'https://www.youtube.com/watch?v=Rsh8TmczwrM'
)

$ErrorActionPreference = 'Continue'
$outFile = Join-Path $env:TEMP ('diag-ffmpeg-' + [guid]::NewGuid().ToString('N') + '.mp4')
$stderrFile = Join-Path $env:TEMP ('diag-ffmpeg-stderr-' + [guid]::NewGuid().ToString('N') + '.txt')

Write-Host "== target URL: $VideoUrl"
Write-Host '== running: ffmpeg -y -i <url> -c copy <tempfile>'

$proc = Start-Process -FilePath 'ffmpeg' `
    -ArgumentList @('-y', '-i', $VideoUrl, '-c', 'copy', $outFile) `
    -NoNewWindow -Wait -PassThru `
    -RedirectStandardError $stderrFile -RedirectStandardOutput ($stderrFile + '.out')

$stderr = Get-Content -LiteralPath $stderrFile -Raw -ErrorAction SilentlyContinue

Write-Host ''
Write-Host "== ffmpeg exit code: $($proc.ExitCode)  (non-zero => _download_to_path records a failure)"
Write-Host "== output file created: $(Test-Path -LiteralPath $outFile)"

if ($stderr) {
    $tail = $stderr.Substring([Math]::Max(0, $stderr.Length - 300))
    Write-Host ''
    Write-Host '== last 300 chars of stderr (= cached_materials.error_message) =========='
    Write-Host $tail
    Write-Host '========================================================================'
}

Remove-Item -LiteralPath $outFile, $stderrFile, ($stderrFile + '.out') -Force -ErrorAction SilentlyContinue

if ($proc.ExitCode -eq 0) {
    Write-Host ''
    Write-Host 'RESULT: ffmpeg accepted the URL as media - this URL is a direct media address, out of scope.'
    exit 0
}

Write-Host ''
Write-Host 'RESULT: ffmpeg cannot treat a YouTube watch page as media input.'
Write-Host '        When this command is triggered by POST /api/material/ingest, the'
Write-Host "        cached_materials row is permanently written as status='failed' and"
Write-Host '        the material card shows the stderr above as a cache error.'
exit 1
