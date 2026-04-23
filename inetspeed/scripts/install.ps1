$ErrorActionPreference = "Stop"

$Repo = if ($env:REPO) { $env:REPO } else { "nxtrace/iNetSpeed-CLI" }
$Binary = $null
$DefaultBinary = "speedtest.exe"
$ReleaseBinary = "speedtest.exe"
$ReleaseBase = if ($env:RELEASE_BASE) { $env:RELEASE_BASE } else { "https://github.com/$Repo/releases/latest/download" }

function Write-Step {
  param([string]$Message)
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Get-Architecture {
  switch ($env:PROCESSOR_ARCHITECTURE) {
    "AMD64" { return "amd64" }
    default { throw "Unsupported architecture: $env:PROCESSOR_ARCHITECTURE" }
  }
}

function Normalize-BinaryName {
  param([string]$Value)

  $Normalized = $Value.Trim().ToLowerInvariant()
  switch ($Normalized) {
    "speedtest" { return "speedtest.exe" }
    "speedtest.exe" { return "speedtest.exe" }
    "inetspeed" { return "inetspeed.exe" }
    "inetspeed.exe" { return "inetspeed.exe" }
    default { throw "BINARY must be speedtest or inetspeed." }
  }
}

function Test-NonInteractive {
  if ($env:CI -eq "true" -or $env:GITHUB_ACTIONS -eq "true") {
    return $true
  }
  return [Environment]::CommandLine -match '(^| )-NonInteractive([ =]|$)'
}

function Resolve-BinaryName {
  if ($null -ne $env:BINARY) {
    return Normalize-BinaryName $env:BINARY
  }
  if (Test-NonInteractive) {
    return $DefaultBinary
  }

  while ($true) {
    try {
      $Choice = Read-Host "Install command name [1] speedtest [2] inetspeed (Enter=1)"
    } catch {
      return $DefaultBinary
    }
    switch ($Choice.Trim().ToLowerInvariant()) {
      "" { return "speedtest.exe" }
      "1" { return "speedtest.exe" }
      "speedtest" { return "speedtest.exe" }
      "speedtest.exe" { return "speedtest.exe" }
      "2" { return "inetspeed.exe" }
      "inetspeed" { return "inetspeed.exe" }
      "inetspeed.exe" { return "inetspeed.exe" }
      default { Write-Warning "Please enter 1, 2, speedtest, or inetspeed." }
    }
  }
}

function Test-IsAdministrator {
  $CurrentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $Principal = New-Object Security.Principal.WindowsPrincipal($CurrentIdentity)
  return $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Add-ToPath {
  param(
    [string]$Dir,
    [ValidateSet("User", "Machine")]
    [string]$Scope
  )

  $Current = [Environment]::GetEnvironmentVariable("Path", $Scope)
  $Parts = @()
  if ($Current) {
    $Parts = $Current -split ';' | Where-Object { $_ }
  }
  if ($Parts -contains $Dir) {
    return $false
  }

  $NewValue = if ([string]::IsNullOrWhiteSpace($Current)) { $Dir } else { "$Current;$Dir" }
  [Environment]::SetEnvironmentVariable("Path", $NewValue, $Scope)
  if (-not (($env:Path -split ';') -contains $Dir)) {
    $env:Path = if ([string]::IsNullOrWhiteSpace($env:Path)) { $Dir } else { "$env:Path;$Dir" }
  }
  return $true
}

$Arch = Get-Architecture
$IsAdmin = Test-IsAdministrator
$Binary = Resolve-BinaryName
$BinaryBase = [IO.Path]::GetFileNameWithoutExtension($Binary)
$ReleaseBinaryBase = [IO.Path]::GetFileNameWithoutExtension($ReleaseBinary)
$Asset = "$ReleaseBinaryBase-windows-$Arch.zip"
$TempDir = Join-Path ([IO.Path]::GetTempPath()) ($ReleaseBinaryBase + "-" + [guid]::NewGuid().ToString("N"))
$ArchivePath = Join-Path $TempDir $Asset
$ChecksumPath = Join-Path $TempDir "checksums-sha256.txt"
$InstallDir = if ($env:INSTALL_DIR) {
  $env:INSTALL_DIR
} elseif ($IsAdmin) {
  Join-Path $env:ProgramFiles $BinaryBase
} else {
  Join-Path $env:LOCALAPPDATA "Programs\$BinaryBase"
}
$Target = Join-Path $InstallDir $Binary

New-Item -ItemType Directory -Path $TempDir | Out-Null
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

try {
  Write-Step "Command name: $BinaryBase"
  Write-Step "Downloading $Asset"
  Invoke-WebRequest -Uri "$ReleaseBase/$Asset" -OutFile $ArchivePath

  Write-Step "Downloading checksums-sha256.txt"
  Invoke-WebRequest -Uri "$ReleaseBase/checksums-sha256.txt" -OutFile $ChecksumPath

  Write-Step "Verifying checksum"
  $Expected = (Get-Content $ChecksumPath | Where-Object { $_ -match "\s+$Asset$" } | Select-Object -First 1).Split()[0]
  if (-not $Expected) {
    throw "Checksum for $Asset not found."
  }
  $Actual = (Get-FileHash -Path $ArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($Actual -ne $Expected.ToLowerInvariant()) {
    throw "Checksum mismatch for $Asset."
  }

  Write-Step "Extracting archive"
  Expand-Archive -Path $ArchivePath -DestinationPath $TempDir -Force
  Copy-Item -Path (Join-Path $TempDir $ReleaseBinary) -Destination $Target -Force

  Write-Step "Installed to $Target"
  $PathScope = if ($IsAdmin) { "Machine" } else { "User" }
  if (Add-ToPath -Dir $InstallDir -Scope $PathScope) {
    $ScopeLabel = if ($PathScope -eq "Machine") { "machine" } else { "user" }
    Write-Warning "Added $InstallDir to the $ScopeLabel PATH. Open a new shell to use it."
  }
  $RunHint = if (($env:Path -split ';') -contains $InstallDir) { $BinaryBase } else { $Target }
  Write-Step "Run with: $RunHint"

  & $Target --version
} finally {
  Remove-Item -Recurse -Force $TempDir
}
