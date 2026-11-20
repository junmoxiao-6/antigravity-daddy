; Antigravity Daddy 安装包脚本（Inno Setup 6，可选）
; 用法：安装 Inno Setup 后右键本文件 → Compile
; 说明：安装包只是把便携包放进 Program Files 并建快捷方式；不需要管理员权限时可改为 {localappdata}

#define AppName "Antigravity Daddy"
#define AppVer "0.3.9"
#define AppExe "Antigravity Daddy.exe"

[Setup]
AppId={{8C4D1A2E-7B31-4F0E-9A55-3A9F2C6D1B07}
AppName={#AppName}
AppVersion={#AppVer}
AppPublisher=Antigravity Daddy
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
OutputDir=..\dist
OutputBaseFilename=Antigravity Daddy-{#AppVer}-setup
SetupIconFile=..\assets\icon.ico
UninstallDisplayIcon={app}\{#AppExe}
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; Flags: unchecked

[Files]
Source: "..\dist\stage\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{group}\卸载 {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "立即运行 {#AppName}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
; 只停我们自己的 daemon。绝不用 taskkill /IM node.exe —— 会误杀 WorkBuddy 等其它 node 进程。
Filename: "{app}\{#AppExe}"; Parameters: "--stop"; Flags: runhidden waituntilterminated
