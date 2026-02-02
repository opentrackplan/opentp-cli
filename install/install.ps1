#!/usr/bin/env pwsh

$ErrorActionPreference = "Stop"

# Settings (edit these)
$OPENTP_VERSION = "0.7.0"
$DefaultDownloadBase = "https://github.com/opentrackplan/opentp-cli/releases/download"
$DownloadBase = if ($env:OPENTP_DOWNLOAD_BASE) { $env:OPENTP_DOWNLOAD_BASE } else { $DefaultDownloadBase }

if (-not [System.Environment]::Is64BitOperatingSystem) {
  Write-Output "Install Failed:"
  Write-Output "OpenTrackPlan CLI for Windows is currently only available for x86 64-bit Windows.`n"
  exit 1
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

$opentpRoot = Join-Path $Home ".opentp"
$installDir = Join-Path $opentpRoot "bin"
$installPath = Join-Path $installDir "opentp.exe"
$url = "${DownloadBase}/v${OPENTP_VERSION}/opentp.exe"

$null = New-Item -ItemType Directory -Force $installDir

$tempDir = if ($env:TEMP) { $env:TEMP } else { $opentpRoot }
$tmp = Join-Path $tempDir ("opentp.{0}.{1}.tmp" -f $OPENTP_VERSION, ([Guid]::NewGuid().ToString("N")))

try {
  Write-Output "Downloading ${url}"
  Download-File -Url $url -OutFile $tmp

  if (!(Test-Path $tmp)) {
    Write-Output "Install Failed - download did not create the expected file."
    exit 1
  }

  Move-Item $tmp $installPath -Force
} finally {
  Remove-Item -Force $tmp -ErrorAction SilentlyContinue
}

Write-Output "`nopentp ${OPENTP_VERSION} was installed successfully!"
Write-Output "The binary is located at ${installPath}`n"

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
