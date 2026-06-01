param(
    [Parameter(Mandatory)]
    [string]$Config,

    [string]$RunName,

    [string]$Baseline,

    [string]$OutputRoot = "runs",

    [switch]$SkipVerify,

    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$ProjectRoot = if ($PSScriptRoot) {
    $PSScriptRoot | Split-Path
} else {
    $PWD.Path
}
Set-Location -LiteralPath $ProjectRoot

function Get-SafeRunName {
    param([string]$Name)
    $Name -replace '[^\w\-_]', '-' -replace '--+', '-'
}

function Get-TimestampDir {
    param([string]$RunName)
    $ts = Get-Date -Format "yyyyMMdd-HHmmss"
    "${ts}-${RunName}"
}

function Resolve-ProjectPath {
    param([string]$Path, [string]$ProjectRoot)
    if ([System.IO.Path]::IsPathRooted($Path)) {
        return $Path
    }
    if ($Path.StartsWith('.\') -or $Path.StartsWith('./')) {
        return Join-Path $ProjectRoot $Path.Substring(2)
    }
    return Join-Path $ProjectRoot $Path
}

function Find-LatestReport {
    param([string]$ReportsDir, [datetime]$After)
    $pattern = Join-Path $ReportsDir "fingerprint-report-*.html"
    Get-ChildItem $pattern -File -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -gt $After } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
}

function Find-LatestDiffReport {
    param([string]$Dir, [datetime]$After)
    $pattern = Join-Path $Dir "diff-report-*.html"
    Get-ChildItem $pattern -File -ErrorAction SilentlyContinue |
        Where-Object { $_.LastWriteTime -gt $After } |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1
}

function Format-ShortError {
    param([string]$Message, [int]$MaxLength = 500)
    if ([string]::IsNullOrWhiteSpace($Message)) {
        return "(no error message)"
    }

    $clean = $Message -replace '\s+', ' '
    if ($clean.Length -le $MaxLength) {
        return $clean
    }

    return "$($clean.Substring(0, $MaxLength))...(truncated)"
}

function Copy-RedactedConfigSnapshot {
    param(
        [Parameter(Mandatory)]
        [string]$SourcePath,

        [Parameter(Mandatory)]
        [string]$TargetPath
    )

    $sensitiveKeyNames = @(
        'apiKey', 'api_key', 'authorization', 'bearer', 'token',
        'secret', 'password', 'passwd', 'cookie', 'proxy_password',
        'client_secret', 'access_key', 'private_key', 'user_proxy_config'
    )

    $rawText = Get-Content -LiteralPath $SourcePath -Raw -Encoding UTF8
    $configObject = $rawText | ConvertFrom-Json -ErrorAction Stop

    $redacted = ConvertTo-RedactedConfigValue -Value $configObject -SensitiveKeyNames $sensitiveKeyNames

    $null = New-Item -ItemType Directory -Path (Split-Path -Parent $TargetPath) -Force
    $redactedJson = $redacted | ConvertTo-Json -Depth 32
    Set-Content -LiteralPath $TargetPath -Value $redactedJson -Encoding UTF8
}

function ConvertTo-RedactedConfigValue {
    param(
        [Parameter(Mandatory)]
        $Value,

        [Parameter(Mandatory)]
        [string[]]$SensitiveKeyNames
    )

    if ($null -eq $Value) {
        return $null
    }

    if ($Value -is [System.Management.Automation.PSCustomObject]) {
        $ordered = [ordered]@{}
        foreach ($prop in $Value.PSObject.Properties) {
            if ($SensitiveKeyNames -contains $prop.Name) {
                $ordered[$prop.Name] = '[REDACTED]'
            } else {
                $ordered[$prop.Name] = ConvertTo-RedactedConfigValue -Value $prop.Value -SensitiveKeyNames $SensitiveKeyNames
            }
        }
        return [pscustomobject]$ordered
    }

    if ($Value -is [System.Collections.IEnumerable] -and -not ($Value -is [string])) {
        $list = @()
        foreach ($item in $Value) {
            $list += ,(ConvertTo-RedactedConfigValue -Value $item -SensitiveKeyNames $SensitiveKeyNames)
        }
        return ,$list
    }

    return $Value
}

function Get-ReportSummary {
    param([string]$JsonPath, [string]$WorkingDir)

    $nodeScript = @'
const fs = require("fs");

const jsonPath = process.argv[2];
const report = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const results = Array.isArray(report.results) ? report.results : [];
const statusCounts = new Map();
const browserScanIssueProfiles = [];
const settingsIssueProfiles = [];
const stabilityChanged = [];

for (const result of results) {
  const profileId = result && result.profileId ? String(result.profileId) : "(unknown)";
  const status = result && result.status ? String(result.status) : "unknown";
  statusCounts.set(status, (statusCounts.get(status) || 0) + 1);

  const browserScanStatus =
    result && result.browserScan && result.browserScan.status
      ? String(result.browserScan.status)
      : "";
  if (browserScanStatus && browserScanStatus !== "ok") {
    browserScanIssueProfiles.push({ profileId, status: browserScanStatus });
  }

  const settingsStatus =
    result && result.settings && result.settings.fetchStatus
      ? String(result.settings.fetchStatus)
      : "";
  if (settingsStatus && settingsStatus !== "ok") {
    settingsIssueProfiles.push({ profileId, status: settingsStatus });
  }

  const fields =
    result &&
    result.stability &&
    result.stability.fields &&
    typeof result.stability.fields === "object"
      ? result.stability.fields
      : {};

  for (const [field, fieldData] of Object.entries(fields)) {
    if (fieldData && fieldData.status === "changed") {
      stabilityChanged.push({
        profileId,
        field,
        samples: Array.isArray(fieldData.samples) ? fieldData.samples.length : 0,
      });
    }
  }
}

const statusOrder = ["ok", "partial", "failed"];
const statusCountsList = Array.from(statusCounts.entries())
  .map(([status, count]) => ({ status, count }))
  .sort((a, b) => {
    const ai = statusOrder.indexOf(a.status);
    const bi = statusOrder.indexOf(b.status);
    if (ai !== -1 || bi !== -1) {
      return (ai === -1 ? Number.MAX_SAFE_INTEGER : ai) - (bi === -1 ? Number.MAX_SAFE_INTEGER : bi);
    }
    return a.status.localeCompare(b.status);
  });

const profileIds = Array.isArray(report.profileIds) ? report.profileIds : [];
const summary = {
  generatedAt: report.generatedAt || null,
  profileCount: profileIds.length || results.length,
  statusCounts: statusCountsList,
  browserScanIssueProfiles,
  settingsIssueProfiles,
  stabilityChanged,
};

process.stdout.write(JSON.stringify(summary));
'@

    if ([string]::IsNullOrWhiteSpace($WorkingDir)) {
        $WorkingDir = Split-Path $JsonPath -Parent
    }

    if (-not (Test-Path $WorkingDir)) {
        $null = New-Item -ItemType Directory -Path $WorkingDir -Force
    }

    $extractorPath = Join-Path $WorkingDir "report-summary-extract-$([System.Guid]::NewGuid().ToString('N')).cjs"
    try {
        $nodeScript | Set-Content -LiteralPath $extractorPath -Encoding UTF8
        $summaryText = & node $extractorPath $JsonPath 2>&1
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) {
            throw "node report summary extraction failed with exit code ${exitCode}: $(Format-ShortError ($summaryText -join "`n"))"
        }

        return ($summaryText -join "`n") | ConvertFrom-Json -ErrorAction Stop
    } finally {
        if (Test-Path $extractorPath) {
            Remove-Item -LiteralPath $extractorPath -Force -ErrorAction SilentlyContinue
        }
    }
}

$ConfigPath = Resolve-ProjectPath $Config $ProjectRoot
$BaselinePath = if ($Baseline) { Resolve-ProjectPath $Baseline $ProjectRoot } else { $null }
$OutputRootPath = if ([System.IO.Path]::IsPathRooted($OutputRoot)) {
    $OutputRoot
} else {
    Join-Path $ProjectRoot $OutputRoot
}

if (-not (Test-Path $ConfigPath)) {
    Write-Error "Config file not found: $ConfigPath"
    exit 1
}

if ($BaselinePath -and (-not $DryRun) -and (-not (Test-Path $BaselinePath))) {
    Write-Error "Baseline file not found: $BaselinePath"
    exit 1
}

if ([string]::IsNullOrWhiteSpace($RunName)) {
    $RunName = Get-SafeRunName ([System.IO.Path]::GetFileNameWithoutExtension($Config))
} else {
    $RunName = Get-SafeRunName $RunName
}

if ([string]::IsNullOrWhiteSpace($RunName)) {
    $RunName = "run"
}

$RunDirName = Get-TimestampDir $RunName
$RunDir = Join-Path $OutputRootPath $RunDirName

if ((Test-Path $RunDir) -and (-not $DryRun)) {
    Write-Error "Run directory already exists: $RunDir"
    exit 1
}

Write-Host "=================================================="
Write-Host "run-scenario.ps1"
Write-Host "=================================================="
Write-Host "Config    : $ConfigPath"
Write-Host "RunName   : $RunName"
Write-Host "Baseline  : $(if ($BaselinePath) { $BaselinePath } else { '(none)' })"
Write-Host "OutputRoot: $OutputRootPath"
Write-Host "DryRun    : $DryRun"
Write-Host "SkipVerify: $SkipVerify"
Write-Host "RunDir    : $RunDir"
Write-Host ""

if ($DryRun) {
    Write-Host "[DryRun] Would create directory: $RunDir"
    Write-Host "[DryRun] Would write redacted config snapshot to: $RunDir\input\config.json"
    if (-not $SkipVerify) {
        Write-Host "[DryRun] Would run: npm.cmd run typecheck"
        Write-Host "[DryRun] Would run: npm.cmd test"
    } else {
        Write-Host "[DryRun] Skipping typecheck and test (-SkipVerify)"
    }
    Write-Host "[DryRun] Would run: npm.cmd run start -- --config `"$ConfigPath`""
    if ($BaselinePath) {
        Write-Host "[DryRun] Would run: npm.cmd run compare-reports -- `"$BaselinePath`" `"<current-json>`""
    }
    Write-Host ""
    Write-Host "[DryRun] Run directory: $RunDir"
    exit 0
}

$null = New-Item -ItemType Directory -Path $RunDir -Force
$null = New-Item -ItemType Directory -Path (Join-Path $RunDir "input") -Force
$null = New-Item -ItemType Directory -Path (Join-Path $RunDir "reports") -Force
$null = New-Item -ItemType Directory -Path (Join-Path $RunDir "diff-reports") -Force
$null = New-Item -ItemType Directory -Path (Join-Path $RunDir "logs") -Force

Copy-RedactedConfigSnapshot -SourcePath $ConfigPath -TargetPath (Join-Path $RunDir "input\config.json")

$StartTime = Get-Date
$LogFile = Join-Path $RunDir "logs\run.log"

if (-not $SkipVerify) {
    Write-Host "[Verify] Running typecheck..."
    $typecheckCmd = "npm.cmd run typecheck"
    $typecheckProc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c $typecheckCmd" -Wait -PassThru -NoNewWindow
    if ($typecheckProc.ExitCode -ne 0) {
        Write-Error "[Verify] typecheck failed with exit code $($typecheckProc.ExitCode)"
        exit $typecheckProc.ExitCode
    }

    Write-Host "[Verify] Running tests..."
    $testCmd = "npm.cmd test"
    $testProc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c $testCmd" -Wait -PassThru -NoNewWindow
    if ($testProc.ExitCode -ne 0) {
        Write-Error "[Verify] tests failed with exit code $($testProc.ExitCode)"
        exit $testProc.ExitCode
    }
}

Write-Host "[Start] Running fingerprint compare..."
$previousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
try {
    $startCmd = "npm.cmd run start -- --config `"$ConfigPath`" 2>&1"
    & cmd.exe /d /s /c $startCmd | Tee-Object -FilePath $LogFile -Append
    $startExitCode = $LASTEXITCODE
} finally {
    $ErrorActionPreference = $previousErrorActionPreference
}

if ($startExitCode -ne 0) {
    Write-Warning "[Start] npm run start exited with code $startExitCode"
}

$LatestHtml = $null
$LatestJson = $null

$ReportsDir = Join-Path $ProjectRoot "reports"

Write-Host "[Find] Searching for reports generated after $StartTime in $ReportsDir"
$FoundHtml = Find-LatestReport -ReportsDir $ReportsDir -After $StartTime
if ($FoundHtml) {
    $LatestHtml = $FoundHtml.FullName
    $LatestJson = $LatestHtml -replace '\.html$', '.json'
    if (-not (Test-Path $LatestJson)) {
        Write-Error "HTML report found but JSON counterpart not found: $LatestJson"
        exit 1
    }
    Write-Host "[Find] Found HTML: $LatestHtml"
    Write-Host "[Find] Found JSON: $LatestJson"
} else {
    Write-Error "No fingerprint-report-*.html found after start time in $ReportsDir. Check reports directory and npm run start output."
    exit 1
}

$CopiedHtml = Join-Path $RunDir "reports\$($FoundHtml.Name)"
$CopiedJson = Join-Path $RunDir "reports\$($LatestJson | Split-Path -Leaf)"
Copy-Item $LatestHtml $CopiedHtml -Force
Copy-Item $LatestJson $CopiedJson -Force

Write-Host "[Compare] Baseline: $(if ($BaselinePath) { $BaselinePath } else { '(none)' })"

$DiffCopiedHtml = $null
$DiffCopiedJson = $null
$CompareFailed = $false

if ($BaselinePath) {
    Write-Host "[Compare] Running compare-reports..."

    $CompareRetryCount = 0
    $CompareMaxRetries = 3
    $CompareSuccess = $false
    $CompareStartTime = Get-Date

    while ($CompareRetryCount -lt $CompareMaxRetries -and -not $CompareSuccess) {
        if ($CompareRetryCount -gt 0) {
            Write-Host "[Compare] Retry $($CompareRetryCount + 1)/$CompareMaxRetries after 3s..."
            Start-Sleep -Seconds 3
        }

        $compareCmd = "npm.cmd run compare-reports -- `"$BaselinePath`" `"$LatestJson`""
        $compareProc = Start-Process -FilePath "cmd.exe" -ArgumentList "/c $compareCmd" -Wait -PassThru -NoNewWindow

        if ($compareProc.ExitCode -eq 0) {
            $CompareSuccess = $true
        } else {
            $CompareRetryCount++
            if ($CompareRetryCount -ge $CompareMaxRetries) {
                Write-Warning "[Compare] compare-reports failed after $CompareMaxRetries attempts with exit code $($compareProc.ExitCode)"
            }
        }
    }

    if ($CompareSuccess) {
        Write-Host "[Compare] compare-reports succeeded"
    } else {
        $CompareFailed = $true
        Write-Warning "[Compare] compare-reports failed, continuing without diff report"
    }

    $DiffDir = Join-Path $ProjectRoot "diff-reports"
    $FoundDiffHtml = $null
    if (-not $CompareFailed) {
        $FoundDiffHtml = Find-LatestDiffReport -Dir $DiffDir -After $CompareStartTime
    }
    if ($FoundDiffHtml) {
        $DiffRunDir = Join-Path $RunDir "diff-reports"
        Copy-Item $FoundDiffHtml.FullName (Join-Path $DiffRunDir $FoundDiffHtml.Name) -Force
        $DiffCopiedHtml = Join-Path $DiffRunDir $FoundDiffHtml.Name
        $DiffCopiedJson = $FoundDiffHtml.FullName -replace '\.html$', '.json'
        if (Test-Path $DiffCopiedJson) {
            Copy-Item $DiffCopiedJson (Join-Path $DiffRunDir (Split-Path $DiffCopiedJson -Leaf)) -Force
        }
        Write-Host "[Compare] Diff HTML: $DiffCopiedHtml"
    } else {
        if (-not $CompareFailed) {
            Write-Warning "[Compare] No diff-report found in $DiffDir after compare"
        }
    }
}

Write-Host "[Summary] Generating summary.md..."

$reportGeneratedAt = $null
$reportSummary = $null
$reportSummaryError = $null
try {
    if (Test-Path $LatestJson) {
        $reportSummary = Get-ReportSummary -JsonPath $LatestJson -WorkingDir (Join-Path $RunDir "logs")
        if ($reportSummary -and $reportSummary.generatedAt) {
            $reportGeneratedAt = $reportSummary.generatedAt
        }
    }
} catch {
    $reportSummaryError = Format-ShortError $_.Exception.Message
}

$summaryLines = @()

$summaryLines += ""
$summaryLines += "# Run Summary: $RunName"
$summaryLines += ""
$summaryLines += "**Run Directory**: ``$RunDir``"
$summaryLines += ""
$summaryLines += "## Run Info"
$summaryLines += ""
$summaryLines += "- **Config**: ``$ConfigPath``"
$summaryLines += "- **Run Name**: ``$RunName``"
$summaryLines += "- **Generated At**: $(if ($reportGeneratedAt) { $reportGeneratedAt } else { '(unknown)' })"
$summaryLines += ""

if ($BaselinePath) {
    $summaryLines += "- **Baseline**: ``$BaselinePath``"
    $summaryLines += ""
}

if ($CompareFailed) {
    $summaryLines += "- **Compare Status**: failed (diff report not available)"
    $summaryLines += ""
}

$summaryLines += "## Reports"
$summaryLines += ""
$summaryLines += "- **Main HTML**: ``$CopiedHtml``"
$summaryLines += "- **Main JSON**: ``$CopiedJson``"
$summaryLines += ""

if ($BaselinePath -and $DiffCopiedHtml) {
    $DiffJsonPath = Join-Path (Split-Path $DiffCopiedHtml -Parent) (Split-Path $DiffCopiedJson -Leaf)
    $summaryLines += "- **Diff HTML**: ``$DiffCopiedHtml``"
    $summaryLines += "- **Diff JSON**: ``$DiffJsonPath``"
    $summaryLines += ""
} elseif ($BaselinePath) {
    $summaryLines += "- **Diff HTML**: _(compare-reports failed, not available)_"
    $summaryLines += "- **Diff JSON**: _(compare-reports failed, not available)_"
    $summaryLines += ""
}

if ($reportSummary) {
    $summaryLines += "## Profile Results"
    $summaryLines += ""
    $summaryLines += "- **Total Profiles**: $($reportSummary.profileCount)"
    $summaryLines += ""
    $summaryLines += "### Status Summary"
    $summaryLines += ""

    foreach ($item in @($reportSummary.statusCounts)) {
        if ($item.count -gt 0) {
            $summaryLines += "- **$($item.status)**: $($item.count)"
        }
    }
    $summaryLines += ""

    if (@($reportSummary.browserScanIssueProfiles).Count -gt 0) {
        $summaryLines += "### BrowserScan Non-OK Profiles"
        $summaryLines += ""
        foreach ($item in @($reportSummary.browserScanIssueProfiles)) {
            $summaryLines += "- ``$($item.profileId)`` ($($item.status))"
        }
        $summaryLines += ""
    }

    if (@($reportSummary.settingsIssueProfiles).Count -gt 0) {
        $summaryLines += "### Settings Fetch Non-OK Profiles"
        $summaryLines += ""
        foreach ($item in @($reportSummary.settingsIssueProfiles)) {
            $summaryLines += "- ``$($item.profileId)`` ($($item.status))"
        }
        $summaryLines += ""
    }

    if (@($reportSummary.stabilityChanged).Count -gt 0) {
        $summaryLines += "### Stability Changed Fields"
        $summaryLines += ""
        $count = 0
        foreach ($item in @($reportSummary.stabilityChanged)) {
            $summaryLines += "- ``$($item.profileId)`` / ``$($item.field)`` ($($item.samples) samples)"
            $count++
            if ($count -ge 20) {
                $summaryLines += "- _... $(@($reportSummary.stabilityChanged).Count - 20) more entries_"
                break
            }
        }
        $summaryLines += ""
    }
} elseif ($reportSummaryError) {
    $summaryLines += ""
    $summaryLines += "> [Summary] Failed to parse JSON report: $reportSummaryError"
    $summaryLines += ""
}

$summaryMd = $summaryLines -join "`n"
$summaryMdPath = Join-Path $RunDir "summary.md"
$summaryMd | Out-File -FilePath $summaryMdPath -Encoding UTF8
Write-Host "[Summary] Written: $summaryMdPath"

Write-Host "=================================================="
Write-Host "Run directory  : $RunDir"
Write-Host "Main HTML      : $CopiedHtml"
Write-Host "Main JSON      : $CopiedJson"
if ($BaselinePath) {
    if ($DiffCopiedHtml) {
        $DiffJsonPath = Join-Path (Split-Path $DiffCopiedHtml -Parent) (Split-Path $DiffCopiedJson -Leaf)
        Write-Host "Diff HTML      : $DiffCopiedHtml"
        Write-Host "Diff JSON      : $DiffJsonPath"
    } else {
        Write-Host "Diff HTML      : (not available)"
        Write-Host "Diff JSON      : (not available)"
    }
}
Write-Host "Summary        : $summaryMdPath"
Write-Host "=================================================="

if ($startExitCode -ne 0) {
    Write-Warning "[Exit] npm run start failed with exit code $startExitCode"
    exit $startExitCode
}

exit 0
