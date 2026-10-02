#!/usr/bin/env pwsh

# OpenTrackPlan installer (Windows).
#
# Installs the latest GitHub release of opentp.exe into ~\.opentp\bin.
#
# Environment variables (all optional):
#   OPENTP_VERSION        Pin a release, e.g. 0.7.4 (a leading "v" is accepted). Default: latest.
#   OPENTP_DOWNLOAD_BASE  Base URL that holds the release assets, i.e. the ".../releases/download"
#                         URL of a GitHub-compatible mirror.
#                         Default: https://github.com/opentrackplan/opentp-cli/releases/download
#                           pinned: <base>/v<OPENTP_VERSION>/opentp.exe
#                           latest: the tag is read once from the redirect of
#                                   <base without the trailing /download>/latest/download/opentp.exe
#                                   (with curl.exe), then the install continues as if that version
#                                   were pinned
#                         "latest" needs a base that ends with /releases/download (GitHub and
#                         GitHub Enterprise layout); with any other base, set OPENTP_VERSION.
#
# opentp.exe is checked against the SHA256SUMS file of the same release. Only releases up to 0.7.4,
# which predate SHA256SUMS, are installed without it (with a warning); for any later release a
# missing SHA256SUMS, a missing entry or a checksum mismatch aborts the install.
#
# Examples:
#   irm opentp.dev/install.ps1 | iex
#   $env:OPENTP_VERSION = "0.7.4"; irm opentp.dev/install.ps1 | iex

$ErrorActionPreference = "Stop"

# Uses throw instead of exit: under `irm ... | iex`, exit would close the user's PowerShell window.
function Fail {
  param([String]$Message)
  throw "Install Failed: $Message"
}

$DefaultDownloadBase = "https://github.com/opentrackplan/opentp-cli/releases/download"
$DownloadBase = if ($env:OPENTP_DOWNLOAD_BASE) { $env:OPENTP_DOWNLOAD_BASE } else { $DefaultDownloadBase }
$DownloadBase = $DownloadBase.TrimEnd('/')
$Version = if ($env:OPENTP_VERSION) { $env:OPENTP_VERSION.Trim() -replace '^v', '' } else { "" }
if ($Version -eq "latest") { $Version = "" }

if (-not [System.Environment]::Is64BitOperatingSystem) {
  Fail "OpenTrackPlan CLI for Windows is currently only available for x86 64-bit Windows."
}

# These environment functions are based on Bun's Windows installer.
# They are used instead of SetEnvironmentVariable to avoid unwanted variable expansions.
function Publish-Env {
  if (-not ("Win32.NativeMethods" -as [Type])) {
    Add-Type -Namespace Win32 -Name NativeMethods -MemberDefinition @"
[DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
public static extern IntPtr SendMessageTimeout(
    IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam,
    uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
"@
  }

  $HWND_BROADCAST = [IntPtr]0xffff
  $WM_SETTINGCHANGE = 0x1a
  $result = [UIntPtr]::Zero
  [Win32.NativeMethods]::SendMessageTimeout(
    $HWND_BROADCAST,
    $WM_SETTINGCHANGE,
    [UIntPtr]::Zero,
    "Environment",
    2,
    5000,
    [ref]$result
  ) | Out-Null
}

function Get-Env {
  param([String]$Key)

  $rootKey = Get-Item -Path 'HKCU:'
  $envKey = $rootKey.OpenSubKey('Environment')
  $envKey.GetValue($Key, $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
}

function Write-Env {
  param([String]$Key, [String]$Value)

  $rootKey = Get-Item -Path 'HKCU:'
  $envKey = $rootKey.OpenSubKey('Environment', $true)

  if ($null -eq $Value) {
    $envKey.DeleteValue($Key)
  } else {
    $registryValueKind = if ($Value.Contains('%')) {
      [Microsoft.Win32.RegistryValueKind]::ExpandString
    } elseif ($envKey.GetValue($Key)) {
      $envKey.GetValueKind($Key)
    } else {
      [Microsoft.Win32.RegistryValueKind]::String
    }
    $envKey.SetValue($Key, $Value, $registryValueKind)
  }

  Publish-Env
}

function Download-File {
  param([String]$Url, [String]$OutFile)

  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($null -ne $curl) {
    & $curl.Source "-#SfLo" "$OutFile" "$Url"
    if (($LASTEXITCODE -eq 0) -and (Test-Path $OutFile)) {
      return
    }
    Write-Warning "The command 'curl.exe $Url -o $OutFile' exited with code ${LASTEXITCODE}. Trying Invoke-RestMethod..."
  }

  Invoke-RestMethod -Uri $Url -OutFile $OutFile
}

# Downloads a file that may not exist and returns the HTTP status code instead of failing on 4xx,
# so a missing SHA256SUMS (releases before it was introduced) can be told apart from other errors.
function Get-OptionalFile {
  param([String]$Url, [String]$OutFile)

  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($null -ne $curl) {
    $status = & $curl.Source "-sSL" "-o" "$OutFile" "-w" "%{http_code}" "$Url"
    if ($LASTEXITCODE -eq 0) {
      return [int]$status
    }
    Write-Warning "The command 'curl.exe $Url -o $OutFile' exited with code ${LASTEXITCODE}. Trying Invoke-WebRequest..."
  }

  try {
    Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing
    return 200
  } catch {
    $response = $_.Exception.Response
    if ($null -ne $response) {
      return [int]$response.StatusCode
    }
    throw
  }
}

# Releases up to v0.7.4 were published without SHA256SUMS.
function Test-PredatesChecksums {
  param([String]$Version)
  $core = [Version](($Version -split '[-+]', 2)[0])
  return $core -le [Version]"0.7.4"
}

# Returns the lowercase SHA-256 listed for $Name in a SHA256SUMS file ("<hash>  <name>" or
# "<hash> *<name>" lines), or $null when there is no entry.
function Get-ExpectedHash {
  param([String]$SumsFile, [String]$Name)

  foreach ($line in Get-Content -LiteralPath $SumsFile) {
    $parts = $line.Trim() -split '\s+', 2
    if ($parts.Count -eq 2 -and $parts[1].TrimStart('*') -eq $Name) {
      return $parts[0].ToLowerInvariant()
    }
  }
  return $null
}

$VersionPattern = '^\d+\.\d+\.\d+([-+][0-9A-Za-z.+-]+)?$'
if ($Version) {
  if ($Version -notmatch $VersionPattern) {
    Fail "invalid OPENTP_VERSION '$($env:OPENTP_VERSION)' (expected e.g. 0.7.4)."
  }
  $ReleaseLabel = $Version
} elseif ($DownloadBase -match '/releases/download$') {
  # Resolve the tag once and download opentp.exe and SHA256SUMS from that release. Two separate
  # .../latest/download/ requests could reach two different releases if one is published in between.
  $latestUrl = ($DownloadBase -replace '/download$', '') + "/latest/download/opentp.exe"
  $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
  if ($null -eq $curl) {
    Fail "curl.exe is needed to resolve the latest release. Set OPENTP_VERSION to pin a release."
  }
  # Without -L: the first redirect names the release (.../releases/download/<tag>/opentp.exe)
  $latest = & $curl.Source "-sS" "-o" "NUL" "-w" "%{http_code} %{redirect_url}" "$latestUrl"
  if ($LASTEXITCODE -ne 0) {
    Fail "could not resolve the latest release from $latestUrl (curl.exe exited with code ${LASTEXITCODE})."
  }
  $latestStatus, $latestRedirect = "$latest".Trim() -split ' ', 2
  if (-not ($latestRedirect -match '/v([^/]+)/opentp\.exe$') -or ($Matches[1] -notmatch $VersionPattern)) {
    Fail "could not resolve the latest release from $latestUrl (HTTP $latestStatus $latestRedirect). Set OPENTP_VERSION to pin a release."
  }
  $Version = ($latestRedirect -replace '^.*/v([^/]+)/opentp\.exe$', '$1')
  $ReleaseLabel = "$Version (latest release)"
} else {
  Fail "cannot resolve the latest release from OPENTP_DOWNLOAD_BASE=$DownloadBase (it does not end with /releases/download). Set OPENTP_VERSION to pin a release."
}
$ReleaseUrl = "${DownloadBase}/v${Version}"

$opentpRoot = Join-Path $Home ".opentp"
$installDir = Join-Path $opentpRoot "bin"
$installPath = Join-Path $installDir "opentp.exe"
$url = "${ReleaseUrl}/opentp.exe"
$sumsUrl = "${ReleaseUrl}/SHA256SUMS"

$null = New-Item -ItemType Directory -Force $installDir

$tempDir = if ($env:TEMP) { $env:TEMP } else { $opentpRoot }
$tmpId = [Guid]::NewGuid().ToString("N")
$tmp = Join-Path $tempDir ("opentp.{0}.tmp" -f $tmpId)
$sumsTmp = Join-Path $tempDir ("opentp-sums.{0}.tmp" -f $tmpId)

try {
  Write-Output "Downloading ${url}"
  Download-File -Url $url -OutFile $tmp

  if (!(Test-Path $tmp)) {
    Fail "the download of $url did not create the expected file."
  }

  $sumsStatus = Get-OptionalFile -Url $sumsUrl -OutFile $sumsTmp
  if ($sumsStatus -eq 200) {
    $expected = Get-ExpectedHash -SumsFile $sumsTmp -Name "opentp.exe"
    if (-not $expected) {
      Fail "SHA256SUMS has no entry for opentp.exe ($sumsUrl)."
    }
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $tmp).Hash.ToLowerInvariant()
    if ($actual -ne $expected) {
      Fail "checksum mismatch for opentp.exe: expected $expected, got $actual. Nothing was installed."
    }
    Write-Output "Verified SHA-256 checksum of opentp.exe"
  } elseif (@(403, 404, 410) -contains $sumsStatus) {
    if (Test-PredatesChecksums $Version) {
      Write-Warning "Release $Version predates SHA256SUMS; skipping checksum verification."
    } else {
      Fail "$sumsUrl is missing (HTTP $sumsStatus), although every release after 0.7.4 publishes it. The release may still be uploading its assets, or the mirror is incomplete. Nothing was installed."
    }
  } else {
    Fail "could not download $sumsUrl (HTTP $sumsStatus)."
  }

  Move-Item $tmp $installPath -Force
} finally {
  Remove-Item -Force $tmp -ErrorAction SilentlyContinue
  Remove-Item -Force $sumsTmp -ErrorAction SilentlyContinue
}

Write-Output "`nopentp ${ReleaseLabel} was installed successfully!"
Write-Output "The binary is located at ${installPath}"
try {
  $installedVersion = & $installPath --version 2>$null | Select-Object -First 1
  if ($installedVersion) {
    Write-Output "  ${installedVersion}"
  }
} catch {
  # ignore: the binary is installed; `opentp version` will show any problem
}
Write-Output ""

$hasExistingOther = $false
try {
  $existing = Get-Command opentp -ErrorAction Stop
  if ($existing.Source -ne $installPath) {
    Write-Warning "Note: Another opentp.exe is already in PATH at $($existing.Source)`nTyping 'opentp' will not use what was just installed.`n"
    Write-Output "To verify the installed version, run: `"$installPath version`"`n"
    $hasExistingOther = $true
  }
} catch {
  # ignore
}

if (-not $hasExistingOther) {
  $userPath = Get-Env -Key "Path"
  $parts = if ($userPath) { $userPath -split ';' } else { @() }
  $parts = $parts | Where-Object { $_ -and $_.Trim().Length -gt 0 }

  if ($parts -notcontains $installDir) {
    $parts += $installDir
    Write-Env -Key 'Path' -Value ($parts -join ';')
    $env:PATH = "${env:PATH};${installDir}"
  }

  Write-Output "To get started, restart your terminal/editor, then run `"opentp version`"`n"
}
