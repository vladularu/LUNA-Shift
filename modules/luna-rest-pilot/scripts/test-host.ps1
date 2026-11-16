param(
  [Parameter(Mandatory=$true)][string]$RustSysroot,
  [Parameter(Mandatory=$true)][string]$CargoHome,
  [Parameter(Mandatory=$true)][string]$BuildDirectory,
  [Parameter(Mandatory=$true)][string]$FrozenFixtures,
  [string]$SharedFixtures
)
$ErrorActionPreference = 'Stop'
$taskModule = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$taskBin = Join-Path (Resolve-Path -LiteralPath $RustSysroot).Path 'bin'
$taskVswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$taskLinker = @(& $taskVswhere -products '*' -find 'VC\Tools\MSVC\**\bin\Hostx64\x64\link.exe') | Select-Object -Last 1
if (-not $taskLinker) { throw 'MSVC x64 linker is required' }
$taskMsvc = (Get-Item -LiteralPath $taskLinker).Directory.Parent.Parent.Parent.FullName
$taskSdk = Get-ChildItem -LiteralPath (Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\Lib') -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'um\x64\kernel32.lib') } | Sort-Object { [version]$_.Name } | Select-Object -Last 1
if (-not $taskSdk) { throw 'Windows SDK is required' }
$taskSaved = @{}
foreach ($taskName in @('CARGO_HOME','RUSTC','CARGO_TARGET_DIR','CARGO_ENCODED_RUSTFLAGS','PATH','LIB')) { $taskSaved[$taskName] = [Environment]::GetEnvironmentVariable($taskName, 'Process') }
try {
  $env:CARGO_HOME = [System.IO.Path]::GetFullPath($CargoHome)
  $env:RUSTC = Join-Path $taskBin 'rustc.exe'
  $env:CARGO_TARGET_DIR = [System.IO.Path]::GetFullPath($BuildDirectory)
  $env:CARGO_ENCODED_RUSTFLAGS = '--sysroot' + [char]31 + [System.IO.Path]::GetFullPath($RustSysroot)
  $env:PATH = (Split-Path -Parent $taskLinker) + ';' + $taskBin + ';' + $env:PATH
  $env:LIB = (Join-Path $taskMsvc 'lib\x64') + ';' + (Join-Path $taskSdk.FullName 'ucrt\x64') + ';' + (Join-Path $taskSdk.FullName 'um\x64')
  & (Join-Path $taskBin 'rustfmt.exe') --check --edition 2024 (Join-Path $taskModule 'rust/src/lib.rs') (Join-Path $taskModule 'rust/src/ffi.rs')
  if ($LASTEXITCODE -ne 0) { throw 'Rust formatting failed' }
  & (Join-Path $taskBin 'cargo.exe') test --offline --locked --manifest-path (Join-Path $taskModule 'rust/Cargo.toml')
  if ($LASTEXITCODE -ne 0) { throw 'Rust tests failed' }
  & (Join-Path $taskBin 'cargo.exe') build --offline --release --locked --lib --manifest-path (Join-Path $taskModule 'rust/Cargo.toml')
  if ($LASTEXITCODE -ne 0) { throw 'Rust build failed' }
  & python (Join-Path $PSScriptRoot 'test-ffi.py') (Join-Path $env:CARGO_TARGET_DIR 'release/luna_rest_pilot.dll') $FrozenFixtures
  if ($LASTEXITCODE -ne 0) { throw 'FFI comparisons failed' }
  if ($SharedFixtures) {
    & python (Join-Path $PSScriptRoot 'test-year-ffi.py') (Join-Path $env:CARGO_TARGET_DIR 'release/luna_rest_pilot.dll') $SharedFixtures
    if ($LASTEXITCODE -ne 0) { throw 'Shared year FFI comparisons failed' }
  }
} finally {
  foreach ($taskName in $taskSaved.Keys) { [Environment]::SetEnvironmentVariable($taskName, $taskSaved[$taskName], 'Process') }
}
