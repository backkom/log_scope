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
    ($_.Extension -in @(".msi", ".exe"))
  } |
  Sort-Object FullName |
  ForEach-Object { $_.FullName }
