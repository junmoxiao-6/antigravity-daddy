# 构建 Antigravity Daddy.exe（离线可编译，无需联网、无需装 SDK）
# 用 Windows 自带的 .NET Framework 编译器编 WinForms 主窗口客户端。
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$framework = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319"
if (-not (Test-Path $framework)) { $framework = "$env:WINDIR\Microsoft.NET\Framework\v4.0.30319" }
$compiler = Join-Path $framework 'csc.exe'
if (-not (Test-Path $compiler)) { throw "未找到 .NET Framework 4.x 编译器" }

$icon = Join-Path $root 'assets\icon.ico'
if (-not (Test-Path $icon)) { throw "缺少图标 $icon" }

$out = Join-Path $root 'Antigravity Daddy.exe'
$source = Join-Path $root 'build\AGYDaddyLauncher.cs'
$asm = Join-Path $root 'build\AssemblyInfo.cs'

# 先结束正在运行的实例，避免 exe 被占用导致编译失败
Get-Process -Name 'Antigravity Daddy' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 400

$args = @(
  '/nologo', '/target:winexe', '/optimize+', '/platform:anycpu',
  "/win32icon:$icon",
  '/r:System.Windows.Forms.dll', '/r:System.Drawing.dll',
  '/r:System.Web.Extensions.dll', '/r:System.Core.dll',
  "/out:$out",
  $source, $asm
)
& $compiler $args 2>&1

if (-not (Test-Path $out)) { throw "编译失败" }
$item = Get-Item $out
if ($item.LastWriteTime -lt (Get-Date).AddMinutes(-2)) { throw "编译未产出新文件（可能被占用）" }
Get-Item $out | Select-Object Name, Length, LastWriteTime | Format-List
$v = (Get-Item $out).VersionInfo
"ProductName=$($v.ProductName) Version=$($v.ProductVersion) Description=$($v.FileDescription)"
Write-Host "OK: $out"
