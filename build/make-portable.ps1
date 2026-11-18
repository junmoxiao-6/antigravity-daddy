# 打绿色便携包：dist\Antigravity Daddy-<version>-win-x64.zip
# 纯离线：node.exe 取项目内 bin\（不存在时再退回系统安装目录 / PATH）
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$ver = (Get-Content package.json -Raw | ConvertFrom-Json).version
$stage = Join-Path $root "dist\stage"
$zip = Join-Path $root "dist\Antigravity Daddy-$ver-win-x64.zip"

if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null

Copy-Item src, assets, docs, build, package.json, start.cmd, README.md -Destination $stage -Recurse
if (Test-Path 'Antigravity Daddy.exe') { Copy-Item 'Antigravity Daddy.exe' $stage }
# 一次性启动器需要 Edge 之外的零依赖；把 build 脚本一起带上便于重建快捷方式
if (Test-Path 'build\make-shortcuts.py') { Copy-Item 'build\make-shortcuts.py' (Join-Path $stage 'build') -Force }

# 内置 Node：优先项目内 bin\node.exe，其次本机常见安装位，最后 PATH
$nodeCandidates = @(
  (Join-Path $root 'bin\node.exe'),
  'C:\Program Files\nodejs\node.exe',
  (Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe')
)
$node = $nodeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $node) {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { $node = $cmd.Source }
}
if ($node -and (Test-Path $node)) {
  New-Item -ItemType Directory -Path (Join-Path $stage 'bin') -Force | Out-Null
  Copy-Item $node (Join-Path $stage 'bin\node.exe')
  Write-Host "bundled node: $node"
} else {
  Write-Host "WARN: no node.exe found; target machine needs Node >= 20"
}

# 自检：包里必须有 exe + node + 注入层，否则宁可报错也不产残包
$must = @('Antigravity Daddy.exe', 'bin\node.exe', 'src\daemon.js', 'src\launcher.js',
          'src\inject\ui.js', 'src\console\index.html', 'assets\icon.ico',
          'build\make-shortcuts.py')
foreach ($m in $must) {
  if (-not (Test-Path (Join-Path $stage $m))) { throw "pack incomplete, missing $m" }
}

if (Test-Path $zip) { Remove-Item $zip -Force }
Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zip -CompressionLevel Optimal
Write-Host "OK: $zip"
