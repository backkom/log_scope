param(
  [string]$Bundles = $(if ($env:LOGSCOPE_WINDOWS_BUNDLES) { $env:LOGSCOPE_WINDOWS_BUNDLES } else { "nsis,msi" }),
  [string]$Target = $(if ($env:LOGSCOPE_WINDOWS_TARGET) { $env:LOGSCOPE_WINDOWS_TARGET } else { "" })
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
Set-Location $RootDir

$IsWindowsPlatform = [System.Environment]::OSVersion.Platform -eq "Win32NT"
if (-not $IsWindowsPlatform) {
  throw "Windows packaging must run on Windows. Current platform cannot produce Windows installers."
}

foreach ($CommandName in @("yarn", "cargo", "rustc")) {
  if (-not (Get-Command $CommandName -ErrorAction SilentlyContinue)) {
    throw "Missing required command: $CommandName"
  }
}

foreach ($IconPath in @("src-tauri/icons/icon.ico", "src-tauri/icons/128x128.png", "src-tauri/icons/32x32.png")) {
  if (-not (Test-Path $IconPath)) {
    throw "Missing icon asset: $IconPath. Regenerate icons with: yarn tauri icon src-tauri/icons/icon.png --output src-tauri/icons"
  }
}

# Updater artifacts are signed with a minisign key. Tauri's bundler reads the key
# content from TAURI_SIGNING_PRIVATE_KEY; local builds fall back to ~/.tauri/logscope.key.
if (-not $env:TAURI_SIGNING_PRIVATE_KEY) {
  $KeyPath = $env:TAURI_SIGNING_PRIVATE_KEY_PATH
  if (-not $KeyPath) {
    $KeyPath = Join-Path $env:USERPROFILE ".tauri\logscope.key"
  }

  if (Test-Path $KeyPath) {
    $env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content -Path $KeyPath -Raw).Trim()
    $KeyPasswordPath = "$KeyPath.password"
    if (-not $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -and (Test-Path $KeyPasswordPath)) {
      $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = (Get-Content -Path $KeyPasswordPath -Raw).Trim()
    }
    Write-Host "Updater signing key: $KeyPath"
  } else {
    throw "Missing updater signing key. Set TAURI_SIGNING_PRIVATE_KEY (key file content) or TAURI_SIGNING_PRIVATE_KEY_PATH, or put the key at $KeyPath."
  }
}

$BuildArgs = @("tauri", "build", "--ci", "--bundles", $Bundles)
if ($Target -ne "") {
  $BuildArgs += @("--target", $Target)
}

Write-Host "Building LogScope for Windows"
Write-Host "Bundles: $Bundles"
if ($Target -ne "") {
  Write-Host "Target: $Target"
}

& yarn @BuildArgs
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Host ""
Write-Host "Generated bundle artifacts:"
Get-ChildItem -Path "src-tauri/target" -Recurse -File |
  Where-Object {
    $_.FullName -match "\\release\\bundle\\" -and
    ($_.Extension -in @(".msi", ".exe", ".sig"))
  } |
  Sort-Object FullName |
  ForEach-Object { $_.FullName }
