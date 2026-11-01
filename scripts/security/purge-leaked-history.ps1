#Requires -Version 5.1
<#
.SYNOPSIS
    Prepares (and, only with -Execute, performs) a local git history rewrite
    that removes the leaked-credential files from EVERY commit of Ecliptrix.

.DESCRIPTION
    Dry run by default. Every planned command is printed and nothing is
    rewritten until -Execute is passed.

    Why this exists: commit c6e04277 ("purge leaked credentials from the
    public repo") only changed the CONTENTS of two files on main. The old
    blobs were never rewritten, so raw.githubusercontent.com still serves
    the real keys at those historical commit shas. Content edits cannot
    remove history; only a history rewrite can.

    The script never pushes. Re-adding the remote and force-pushing are
    printed as a manual checklist the operator walks through by hand.

.PARAMETER Execute
    Actually create the mirror backup and run git filter-repo.
    Without this switch the script is a pure dry run.

.PARAMETER KeepFiles
    Keep the two (now redacted) files in main instead of deleting them from
    every commit. Uses git filter-repo --replace-text with a replacements
    file generated at run time straight from this repo's own history. The
    file is deleted in a finally block and the secret values are never
    printed, only the count of literals replaced.

.PARAMETER AllowForeignRemote
    Permit -Execute on a clone whose origin is not -RemoteUrl. Only for the
    throwaway lab rehearsal; a real run must see the GitHub remote.

.PARAMETER RepoPath
    Repository to operate on. Defaults to the repo that contains this
    script (scripts\security\..\..).

.PARAMETER RemoteUrl
    Expected origin URL. Printed in the manual push checklist.

.PARAMETER BackupRoot
    Directory that receives the pre-purge mirror clone. Defaults to %TEMP%.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File `
        scripts\security\purge-leaked-history.ps1
    Dry run: prints the full plan, changes nothing.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File `
        scripts\security\purge-leaked-history.ps1 -Execute
    Creates the mirror backup, then rewrites all refs locally.

.OUTPUTS
    Exit codes:
      0  success, or a dry run that found no blocker
      1  runtime error (backup failed, filter-repo failed)
      2  prerequisite missing (git absent, not a git repo, no filter-repo)
      3  refused for safety (dirty work tree, unexpected remote)

.NOTES
    Windows PowerShell 5.1 only, pure ASCII on purpose: PS 5.1 decodes a
    BOM-less script as ANSI, so a single non-ASCII byte would corrupt the
    parse. Keep this file ASCII if you edit it.
#>
[CmdletBinding()]
param(
    [switch]$Execute,
    [switch]$KeepFiles,
    [switch]$AllowForeignRemote,
    [string]$RepoPath = '',
    [string]$RemoteUrl = 'https://github.com/xdrshjr/Ecliptrix.git',
    [string]$BackupRoot = $env:TEMP
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Paths that carry a real credential somewhere in history. Whole-file removal
# is used because a key can hide in a trailing comment or an unused branch of
# the same file; --replace-text only removes the literals it is told about and
# a missed variant leaves the key readable.
#
# Entries 1-2 are the documented pair. Entries 3-4 were found with
#   git log --all --pretty=format: --name-only -S <literal> | sort -u
# and they matter: with only entries 1-2 removed, the Kimi key stayed readable
# in 3 commits and the GLM key in 2. Re-run that query per credential before
# trusting this list.
$script:LeakedFiles = @(
    'docs/coding-plan/kimi/test_kimi_k2.5.py'
    'docs/coding-plan/glm/test_glm_coding_plan.py'
    'example-package/kimi-coding/test_kimi_k2.5.py'
    'backend-services/basic-service/.env'
)

$script:ExitOk = 0
$script:ExitError = 1
$script:ExitPrereq = 2
$script:ExitRefused = 3
$script:LastGitExit = 0

function Write-Section {
    param([string]$Title)
    Write-Host ''
    Write-Host (('== {0} ' -f $Title).PadRight(78, '=')) -ForegroundColor White
}

function Write-Item {
    param([string]$Text)
    Write-Host ('  {0}' -f $Text)
}

function Write-PlanCommand {
    param([int]$Index, [string]$Title, [string]$Command)
    Write-Host ''
    Write-Host ('  [{0}] {1}' -f $Index, $Title) -ForegroundColor White
    Write-Host ('      $ {0}' -f $Command) -ForegroundColor Cyan
}

function Write-WarnLine {
    param([string]$Text)
    Write-Host ('  WARN : {0}' -f $Text) -ForegroundColor Yellow
}

function Write-Blocker {
    param([string]$Text)
    Write-Host ('  BLOCK: {0}' -f $Text) -ForegroundColor Red
}

function Write-Note {
    param([string]$Text)
    Write-Host ('  note : {0}' -f $Text) -ForegroundColor DarkGray
}

function Invoke-Native {
    # Native stderr is just text, but $ErrorActionPreference = 'Stop' turns a
    # merged stderr line into a terminating error. Relax it only around the
    # call: the exit code is the contract, not the stream.
    param([string]$FilePath, [string[]]$Arguments)
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $FilePath @Arguments 2>&1
        $code = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previous
    }
    return [pscustomobject]@{
        ExitCode = $code
        Output   = (($output | Out-String).Trim())
    }
}

function Invoke-Git {
    # Single entry point for git so every call records its exit code and no
    # native command can slip through without one.
    param([string]$Repo, [string[]]$GitArgs)
    $result = Invoke-Native -FilePath 'git' `
        -Arguments (@('-C', $Repo) + $GitArgs)
    $script:LastGitExit = $result.ExitCode
    return $result.Output
}

function New-MirrorBackup {
    # --mirror copies every ref (branches, tags, notes, stash-less extras),
    # which is what makes the backup a full recovery source. A plain clone
    # would lose tags that are not on a branch and any ref outside refs/heads.
    param([string]$Repo, [string]$BackupPath)
    if (Test-Path -LiteralPath $BackupPath) {
        Write-Blocker ('backup path already exists: {0}' -f $BackupPath)
        return 1
    }
    $result = Invoke-Native -FilePath 'git' -Arguments @(
        'clone', '--mirror', '--quiet', $Repo, $BackupPath)
    if ($result.ExitCode -ne 0) {
        Write-Item 'backup clone output:'
        Write-Host $result.Output
    }
    return $result.ExitCode
}

function Get-CandidateLiterals {
    # Extracts secret-looking literals from the patch history of ONE file.
    # Callers only ever report Count; the values stay inside this function's
    # caller and are written straight to the temporary replacements file.
    param([string]$Repo, [string]$Path)
    $patterns = @(
        'sk-[A-Za-z0-9_\-]{16,}'
        '[0-9a-f]{32}\.[A-Za-z0-9]{16}'
        '(?<=["''])[A-Za-z0-9_\-]{32,}(?=["''])'
    )
    $patch = Invoke-Git -Repo $Repo -GitArgs @(
        'log', '--all', '--patch', '--no-color', '--', $Path)
    $found = New-Object System.Collections.Generic.HashSet[string]
    foreach ($pattern in $patterns) {
        foreach ($match in [regex]::Matches($patch, $pattern)) {
            [void]$found.Add($match.Value)
        }
    }
    # Unary comma: keeps the HashSet intact instead of letting the pipeline
    # unroll it into a loose array (or a bare string when only one hit).
    return , $found
}

function New-ReplacementsFile {
    # Writes git filter-repo --replace-text input. Format: literal==>text,
    # no regex: prefix, so the values are matched literally and cannot
    # accidentally act as a pattern. Returns the number of literals written.
    param([string]$Repo, [string[]]$FilePaths, [string]$TargetPath)
    $literals = New-Object System.Collections.Generic.HashSet[string]
    foreach ($path in $FilePaths) {
        $found = Get-CandidateLiterals -Repo $Repo -Path $path
        foreach ($item in $found) {
            [void]$literals.Add($item)
        }
    }
    $lines = New-Object System.Collections.Generic.List[string]
    foreach ($item in $literals) {
        $lines.Add(('{0}==>***REMOVED***' -f $item))
    }
    Set-Content -LiteralPath $TargetPath -Value $lines.ToArray() `
        -Encoding ASCII
    return $literals.Count
}

function Show-ManualChecklist {
    param([string]$Url)
    Write-Section 'MANUAL CHECKLIST - nothing below is executed by this script'
    Write-Item ('[ ] 1. git remote add origin {0}' -f $Url)
    Write-Note 'filter-repo drops remotes so a stale ref can never be pushed'
    Write-Item '[ ] 2. git push --force origin --all'
    Write-Item '[ ] 3. git push --force origin --tags'
    Write-Item '[ ] 4. Open GitHub Support (Settings -> Support) and ask to'
    Write-Item '        "remove cached sensitive data" for this repo.'
    Write-Note 'cached views keep raw.githubusercontent.com serving old blobs'
    Write-Item '[ ] 5. Tell every collaborator to re-clone. Existing clones,'
    Write-Item '        forks and PR refs still contain the pre-purge objects.'
    Write-Item '[ ] 6. Rotate every credential exposed in history.'
    Write-Note 'rotation is step 0, not step 6 - see the runbook'
}

# ---------------------------------------------------------------------------
# 0. Banner and mode
# ---------------------------------------------------------------------------
Write-Host ''
Write-Host 'Ecliptrix leaked-history purge (git filter-repo)' -ForegroundColor White
Write-Section 'MODE'
if ($Execute) {
    Write-Item 'EXECUTE - the rewrite WILL run after the checks below pass'
} else {
    Write-Item 'DRY RUN - every command is printed, nothing is executed'
    Write-Note 'add -Execute to run for real'
}
if ($KeepFiles) {
    Write-Item 'strategy: -KeepFiles -> --replace-text (files survive)'
} else {
    Write-Item 'strategy: default -> --invert-paths (files removed everywhere)'
}
foreach ($file in $script:LeakedFiles) {
    Write-Item ('target  : {0}' -f $file)
}

# ---------------------------------------------------------------------------
# 1. Prerequisites
# ---------------------------------------------------------------------------
Write-Section '1. PREREQUISITES'
$blockers = New-Object System.Collections.Generic.List[string]
$prereqMissing = $false

$gitCommand = Get-Command git -ErrorAction SilentlyContinue
if ($null -eq $gitCommand) {
    Write-Blocker 'git is not on PATH. Install Git for Windows, then retry.'
    exit $script:ExitPrereq
}
Write-Item ('git        : {0}' -f $gitCommand.Source)

if ([string]::IsNullOrWhiteSpace($RepoPath)) {
    $RepoPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
}
if (-not (Test-Path -LiteralPath $RepoPath)) {
    Write-Blocker ('repository path does not exist: {0}' -f $RepoPath)
    exit $script:ExitPrereq
}

$repoTop = Invoke-Git -Repo $RepoPath -GitArgs @('rev-parse', '--show-toplevel')
if ($script:LastGitExit -ne 0) {
    Write-Blocker ('not a git repository: {0}' -f $RepoPath)
    exit $script:ExitPrereq
}
$RepoPath = (Resolve-Path -LiteralPath $repoTop).Path
Write-Item ('repository : {0}' -f $RepoPath)

$headSha = Invoke-Git -Repo $RepoPath -GitArgs @('rev-parse', 'HEAD')
$branch = Invoke-Git -Repo $RepoPath -GitArgs @(
    'rev-parse', '--abbrev-ref', 'HEAD')
$commitCount = Invoke-Git -Repo $RepoPath -GitArgs @(
    'rev-list', '--all', '--count')
Write-Item ('HEAD       : {0} ({1})' -f $headSha, $branch)
Write-Item ('commits    : {0} across all refs' -f $commitCount)

$remoteUrl = Invoke-Git -Repo $RepoPath -GitArgs @(
    'remote', 'get-url', 'origin')
if ($script:LastGitExit -ne 0 -or [string]::IsNullOrWhiteSpace($remoteUrl)) {
    $remoteUrl = '<no origin remote>'
}
Write-Item ('origin     : {0}' -f $remoteUrl)

$remoteMatches = $remoteUrl.Trim().ToLowerInvariant().TrimEnd('/') -eq `
    $RemoteUrl.Trim().ToLowerInvariant().TrimEnd('/')
if (-not $remoteMatches) {
    $message = 'origin is not {0} (lab clone?)' -f $RemoteUrl
    Write-WarnLine $message
    if ($Execute -and -not $AllowForeignRemote) {
        $blockers.Add($message + ' - pass -AllowForeignRemote to override')
        $refused = $true
    }
}

$filterRepoVersion = Invoke-Git -Repo $RepoPath -GitArgs @(
    'filter-repo', '--version')
if ($script:LastGitExit -ne 0) {
    $filterRepoVersion = 'not installed'
    Write-Blocker 'git filter-repo is not available to git.'
    Write-Item 'Install it, then re-run this script:'
    Write-Item '    pip install git-filter-repo'
    Write-Note 'verify with: git filter-repo --version'
    $blockers.Add('git filter-repo missing (pip install git-filter-repo)')
    $prereqMissing = $true
} else {
    Write-Item ('filter-repo: {0}' -f $filterRepoVersion)
}

$dirty = Invoke-Git -Repo $RepoPath -GitArgs @('status', '--porcelain')
if ($dirty.Length -gt 0) {
    $dirtyLines = @($dirty -split "`n")
    Write-Blocker ('work tree is not clean ({0} entries)' -f $dirtyLines.Count)
    foreach ($line in ($dirtyLines | Select-Object -First 5)) {
        Write-Item ('    {0}' -f $line.Trim())
    }
    Write-Item 'Commit or stash these, then re-run. filter-repo refuses to run'
    Write-Item 'on a dirty tree and a rewrite would mix in unreviewed edits.'
    $blockers.Add('dirty work tree - commit or stash before purging')
    $refused = $true
} else {
    Write-Item 'tree       : clean'
}

Write-Section '1b. TARGET PRESENCE (what the rewrite will actually touch)'
$trackedAtHead = 0
foreach ($file in $script:LeakedFiles) {
    $hits = Invoke-Git -Repo $RepoPath -GitArgs @(
        'log', '--all', '--oneline', '--', $file)
    $hitCount = 0
    if ($hits.Length -gt 0) {
        $hitCount = @($hits -split "`n").Count
    }
    $inHead = Invoke-Git -Repo $RepoPath -GitArgs @('ls-files', '--', $file)
    $state = 'history only (main already clean)'
    if ($inHead.Length -gt 0) {
        $state = 'STILL IN MAIN - this file disappears from main'
        $trackedAtHead = $trackedAtHead + 1
    }
    Write-Item ('{0} commit(s) | {1}' -f $hitCount, $file)
    Write-Item ('                {0}' -f $state)
}
Write-Note ('{0} of {1} target paths still exist in main' -f `
    $trackedAtHead, $script:LeakedFiles.Count)

# ---------------------------------------------------------------------------
# 2. Plan
# ---------------------------------------------------------------------------
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupPath = Join-Path $BackupRoot ('ecliptrix-pre-purge-{0}.git' -f $stamp)
$backupCommand = 'git clone --mirror "{0}" "{1}"' -f $RepoPath, $backupPath

$pathArgs = ''
foreach ($file in $script:LeakedFiles) {
    $pathArgs = $pathArgs + ' --path ' + $file
}

$replacementsPath = Join-Path $BackupRoot (
    'ecliptrix-replacements-{0}.txt' -f $stamp)
$filterArgs = @()
if ($KeepFiles) {
    # --replace-text keeps the files but rewrites the matched literals. It
    # leaves any key variant the generated list did not catch readable, which
    # is why whole-file removal is the default.
    $filterCommand = 'git filter-repo --replace-text "{0}" --force' -f `
        $replacementsPath
    $filterArgs = @('filter-repo', '--replace-text', $replacementsPath,
        '--force')
} else {
    # --invert-paths + --path deletes the two paths from every commit. Chosen
    # over --replace-text because it cannot miss a variant: there is no
    # pattern to be wrong about. Consequence: both files are gone from main
    # too, because main is rewritten as well.
    $filterCommand = 'git filter-repo --invert-paths' + $pathArgs + ' --force'
    $filterArgs = @('filter-repo', '--invert-paths')
    foreach ($file in $script:LeakedFiles) {
        $filterArgs += @('--path', $file)
    }
    $filterArgs += '--force'
}

Write-Section '2. BACKUP PLAN'
Write-PlanCommand 1 'Mirror clone of every ref, before anything is rewritten' `
    $backupCommand
Write-Item ('backup path: {0}' -f $backupPath)
Write-Note 'a --mirror clone carries all refs, so it can restore the repo'

Write-Section '3. HISTORY REWRITE PLAN'
if ($KeepFiles) {
    Write-PlanCommand 2 'Generate replacements file from this repo history' `
        ('(in-script: git log --patch -- <each leaked file> -> ' + `
        $replacementsPath + ')')
    Write-PlanCommand 3 'Rewrite all history, replacing the literals' `
        $filterCommand
} else {
    Write-PlanCommand 2 'Delete these paths from every commit of every ref' `
        $filterCommand
}
Write-Note 'runs locally only; remotes are dropped by filter-repo'

if ($KeepFiles) {
    Write-Section '4. LITERAL DETECTION (counts only, values never printed)'
    $previewTotal = 0
    foreach ($file in $script:LeakedFiles) {
        $preview = Get-CandidateLiterals -Repo $RepoPath -Path $file
        $previewTotal = $previewTotal + $preview.Count
        Write-Item ('{0}: {1} literal(s)' -f $file, $preview.Count)
    }
    if ($previewTotal -eq 0) {
        Write-WarnLine 'no literals detected - --replace-text would do nothing'
        Write-WarnLine 'prefer the default whole-file removal in that case'
    }
}

# ---------------------------------------------------------------------------
# 3. Verdict - nothing destructive can have run before this point
# ---------------------------------------------------------------------------
if ($blockers.Count -gt 0) {
    Write-Section 'VERDICT: BLOCKED - no rewrite was or will be performed'
    foreach ($blocker in $blockers) {
        Write-Blocker $blocker
    }
    if ($prereqMissing) {
        Write-Item 'exit 2 (prerequisite missing)'
        exit $script:ExitPrereq
    }
    Write-Item 'exit 3 (refused for safety)'
    exit $script:ExitRefused
}

if (-not $Execute) {
    Write-Section 'VERDICT: DRY RUN COMPLETE - nothing was changed'
    Write-Item 'all checks passed; back up and rewrite with:'
    Write-Item ('    powershell -NoProfile -ExecutionPolicy Bypass -File ' + `
        'scripts\security\purge-leaked-history.ps1 -Execute')
    Write-Note 'the mirror backup is created before the rewrite runs'
    Write-Item 'exit 0'
    exit $script:ExitOk
}

# ---------------------------------------------------------------------------
# 4. Execute: backup first, then rewrite
# ---------------------------------------------------------------------------
Write-Section '5. EXECUTING STEP 1 - MIRROR BACKUP'
Write-Item ('running: {0}' -f $backupCommand)
$backupCode = New-MirrorBackup -Repo $RepoPath -BackupPath $backupPath
if ($backupCode -ne 0) {
    Write-Blocker 'mirror backup failed - refusing to touch history'
    Write-Item ('backup path (partial?): {0}' -f $backupPath)
    exit $script:ExitError
}
Write-Host ''
Write-Host '  BACKUP CREATED - keep this path until the purge is verified:' `
    -ForegroundColor Green
Write-Host ('  {0}' -f $backupPath) -ForegroundColor Green

Write-Section '6. EXECUTING STEP 2 - HISTORY REWRITE'
if ($KeepFiles) {
    Write-Item ('generating replacements file at {0}' -f $replacementsPath)
    $literalCount = 0
    try {
        $literalCount = New-ReplacementsFile -Repo $RepoPath `
            -FilePaths $script:LeakedFiles -TargetPath $replacementsPath
        Write-Item ('wrote {0} literal(s); values are not printed' -f `
            $literalCount)
        Write-Item ('running: {0}' -f $filterCommand)
        $result = Invoke-Git -Repo $RepoPath -GitArgs @(
            'filter-repo', '--replace-text', $replacementsPath, '--force')
        $filterCode = $script:LastGitExit
        Write-Host $result
    }
    finally {
        # The replacements file holds the raw secrets; it must not outlive
        # this script, not even on failure or Ctrl+C.
        if (Test-Path -LiteralPath $replacementsPath) {
            Remove-Item -LiteralPath $replacementsPath -Force
            Write-Item 'deleted the temporary replacements file'
        }
    }
} else {
    Write-Item ('running: {0}' -f $filterCommand)
    $filterOutput = Invoke-Git -Repo $RepoPath -GitArgs $filterArgs
    $filterCode = $script:LastGitExit
    Write-Host $filterOutput
}

if ($filterCode -ne 0) {
    Write-Blocker 'git filter-repo failed - restore from the mirror backup'
    Write-Item ('restore: git clone --mirror "{0}" "<new-clone>"' -f $backupPath)
    exit $script:ExitError
}

Write-Section '7. RESULT'
$newHead = Invoke-Git -Repo $RepoPath -GitArgs @('rev-parse', 'HEAD')
$newCount = Invoke-Git -Repo $RepoPath -GitArgs @('rev-list', '--all', '--count')
Write-Item ('HEAD before: {0}' -f $headSha)
Write-Item ('HEAD after : {0}' -f $newHead)
Write-Item ('commits    : {0} -> {1} (history is new even if the tip sha' -f `
    $commitCount, $newCount)
Write-Item '             is unchanged: main keeps the same tree when the'
Write-Item '             literals only lived on side refs)'
$residual = 0
foreach ($file in $script:LeakedFiles) {
    $hits = Invoke-Git -Repo $RepoPath -GitArgs @(
        'log', '--all', '--oneline', '--', $file)
    $hitCount = 0
    if ($hits.Length -gt 0) {
        $hitCount = @($hits -split "`n").Count
    }
    $residual = $residual + $hitCount
    if ($KeepFiles) {
        Write-Item ('{0}: kept on purpose, {1} commit(s) still touch it' -f `
            $file, $hitCount)
    } else {
        Write-Item ('{0}: {1} commit(s) still reference it' -f $file, $hitCount)
    }
}
if ($KeepFiles) {
    Write-WarnLine 'the script cannot verify the literals it redacted - it never'
    Write-WarnLine 'holds them. Verify by hand with the runbook command:'
    Write-WarnLine 'git log --all -S <the real key> --oneline   # 0 lines'
} elseif ($residual -ne 0) {
    Write-Blocker 'history still references a target path - purge incomplete'
    Show-ManualChecklist -Url $RemoteUrl
    exit $script:ExitError
}
Write-Note 'this repo now has no remotes; push by hand after review'

Show-ManualChecklist -Url $RemoteUrl
Write-Section 'DONE - local rewrite only, nothing was pushed'
Write-Item 'exit 0'
exit $script:ExitOk
