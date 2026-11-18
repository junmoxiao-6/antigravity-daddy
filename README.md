# Antigravity Daddy

**在 Antigravity 客户端内部加一层增强面板：多账号、配额看板、输入区快捷短语。**
不修改官方任何文件，也不额外常驻一个自己的界面进程 —— 所有 UI 都注入在官方窗口里。

> An in-place enhancement layer for the Antigravity desktop client (Windows):
> multi-account switch, quota dashboard and composer quick-phrases, injected via CDP
> without touching the official binary.

[![Platform](https://img.shields.io/badge/platform-Windows%2010%2F11%20x64-0078D4)](#系统要求)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-339933)](#系统要求)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

---

## 一、它是什么

一个**增强层**，不是独立客户端。

| 环节 | 行为 |
|---|---|
| 双击 `Antigravity Daddy.exe` | 拉起官方 Antigravity → 后台起一个隐藏的 `node.exe` 守护 → **自己立刻退出** |
| 界面 | 用 CDP 注入官方窗口：右下角 **∞ 悬浮球** + 毛玻璃面板；输入框底栏两个圆形图标钮 |
| 进程 | 任务管理器里只有官方的 `Antigravity` 进程组 + 1 个隐藏的 Node 进程，**没有自己的窗口进程、没有托盘** |

这个形态是刻意对齐成熟同类工具的做法：界面归官方窗口，增强逻辑在后台。

## 二、它不是什么

- **不是官方产品**，与 Google / Antigravity 官方无任何关联，未获其背书。
- **不修改、不替换、不重打包**官方二进制，也不拦截它的流量。
- **不做代理转发**：面板里的「中转站」是占位页，`enabled=false` 时零流量。
- 不采集任何遥测，不上传账号。

## 三、功能

| 模块 | 状态 | 说明 |
|---|---|---|
| 启动器接管 | ✅ | 自动定位官方 exe（含装在非系统盘的情况）；已在运行则复用不重启 |
| CDP 注入（Shadow DOM 隔离） | ✅ | 悬浮球 + 10 页签面板；官方页面导航/重载后 1.2 s 自动重挂 |
| 账号库 | ✅ | 加密存储；「纳入当前账号」把当前登录态收进号池；支持粘贴凭据 JSON 入库 |
| 凭据切换 | ⚠️ | 写入链路完整（备份 → 写 → 回读校验 → 失败回滚），**单账号环境无法验证真实换号效果**，请自行在双账号下确认 |
| 实时配额 | ✅ | 周 / 5 小时窗口 + 每模型周配额；上游读不到时显示显式横幅，**不把「读不到」显示成 0%** |
| 自动切换 | ⚠️ | 阈值 + 巡检 + 冷却已实现；真实切号效果同上待验证 |
| 输入区工具条 | ✅ | 底栏两个 28 px 圆钮（暂存提示词 / 快捷短语），悬停展开文字、悬停弹浮层 |
| 会话草稿（暂存提示词） | ✅ | 按会话隔离；点击回填、可删除 |
| 主题接管 | ✅ | 覆盖官方 CSS 变量，清空即还原 |
| 运行日志页 | ✅ | 级别 / 关键词 / 行数过滤，一键打开日志目录 |
| 独立 Web 控制台 | ✅ | 同源 8 页签，`--console` 才打开，默认不弹窗 |
| 中断 / 429 自动续接 | ⚠️ | 开关 + 检测 + 重试已实现，需真实中断场景验证 |
| 权限弹窗免打扰 | ⚠️ | 白名单式点按，默认关闭 |
| 中转站（本地网关） | 🚧 占位 | 只备好契约探测与字段清单，不代发请求 |
| Token 用量看板 | 🚧 未做 | — |

✅ 已实机验证 ｜ ⚠️ 代码就绪、需特定条件验证 ｜ 🚧 占位或未实现

## 四、工作原理

```
Antigravity Daddy.exe        .NET Framework 一次性启动器
        │  (拉起后立即退出)
        ├──> Antigravity.exe                         官方客户端（原样启动）
        └──> node.exe src/launcher.js  隐藏窗口
                 └── daemon.js  ── 本地 HTTP API 127.0.0.1:8787
                        ├── CDP 连到官方渲染进程 → Runtime.evaluate 注入 UI
                        ├── 读官方页面里的 __APP_CONFIG__ 拿 LS 端口与 CSRF
                        └── 通过 LS Connect-RPC 读配额 / 模型 / 会话
```

- **账号凭据**：官方存放在 Windows 凭据管理器（Generic，目标名 `gemini:antigravity`）。App、CLI、IDE 共用这一条，所以切一次即多端同步。
- **本地号池**：`%LOCALAPPDATA%\AGY-Daddy\vault.enc`，AES-256-GCM。
- **为什么用 Python**：Node 没有 Win32 凭据 API 的绑定，用一份 `ctypes` 小脚本直调 `advapi32` 的 `CredReadW / CredWriteW`，零编译、可审计。

## 五、系统要求

| 项 | 要求 |
|---|---|
| 系统 | Windows 10 / 11 x64 |
| 官方客户端 | 已安装 Antigravity（2.2x ~ 2.3x 实测） |
| Node.js | ≥ 20（用 Release 便携包则已内置，无需另装） |
| Python | 3.8+，**仅账号功能需要**（读写 Windows 凭据）；没有 Python 时其余功能正常，账号页会提示 |
| .NET Framework | 4.x（仅「自己编译 exe」时需要；系统自带） |

## 六、快速开始

### 方式 A：Release 便携包（推荐）

1. 到 [Releases](https://github.com/junmoxiao-6/antigravity-daddy/releases) 下载 `AntigravityDaddy-*-win-x64.zip`
2. 解压到任意目录（不要放在受保护目录）
3. 双击 `Antigravity Daddy.exe`
4. 等官方窗口出现（冷启动约 30–60 秒），右下角出现 **∞** 悬浮球即成功

### 方式 B：源码运行

```cmd
git clone https://github.com/junmoxiao-6/antigravity-daddy.git
cd antigravity-daddy
start.cmd
```

或用 npm：

```cmd
npm start
```

`start.cmd` 会先清掉可能被 IDE/Agent 终端注入的 `ELECTRON_RUN_AS_NODE` / `NODE_OPTIONS`，再去调 launcher。这两个变量会让官方客户端以纯 Node 模式启动并立即退出，是常见坑。

### 方式 C：自己编 exe

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File build\build-exe.ps1
```

用系统自带的 .NET Framework `csc.exe` 编译，不需要装 SDK、不需要联网。

## 七、命令行

```cmd
Antigravity Daddy.exe               :: 默认：拉起官方客户端 + 后台守护 + 注入，然后退出
Antigravity Daddy.exe --no-start    :: 只起后台守护，不拉起客户端
Antigravity Daddy.exe --console     :: 用 Edge --app 打开独立 Web 控制台
Antigravity Daddy.exe --stop        :: 停止后台守护（保留官方客户端）
```

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `AGYD_PORT` | `8787` | 本地 API 端口 |
| `AGYD_PYTHON` | 自动探测 | 指定 Python 解释器路径 |

## 八、首次使用

1. 打开客户端 → 右下角 **∞** → **账号 → 纳入当前账号**（当前登录态加密入库）
2. **总览 → 刷新配额**，确认能读到周/5h 桶
3. **增强** 里按需开启自动切换 / 自动续接
4. 输入框底栏：**书签**＝暂存提示词（点击暂存、悬停看列表），**闪电**＝快捷短语

## 九、构建便携包

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File build\make-portable.ps1
```

产物在 `dist\`。脚本会优先取项目内 `bin\node.exe`，其次系统 Node 安装目录，都没有则报错（便携包需要内置 Node）。

## 十、目录结构

```
agy-daddy/
├─ start.cmd                 清环境变量 + 调 launcher
├─ src/
│  ├─ launcher.js            定位 exe → 拉起客户端 → 起守护进程
│  ├─ daemon.js              本地 API(8787) + CDP 注入 + 导航后自动重挂 + 自愈巡检
│  ├─ cdp.js                 CDP 客户端（含身份校验，防误注入到别的应用）
│  ├─ rpc.js                 LS Connect-RPC 客户端（origin/CSRF 从页面自取）
│  ├─ accounts.js            凭据读写 / 号池 / 切号 + 邮箱校验
│  ├─ cred.py                Win32 凭据助手（ctypes，退避重试 + 回读校验 + 回滚）
│  ├─ quota.js               配额归一化（weekly / 5h / 每模型）
│  ├─ store.js               AES-256-GCM 保险箱 / 草稿 / 配置
│  ├─ console/index.html     独立 Web 控制台（单文件，零外部依赖）
│  └─ inject/ui.js           注入层（悬浮球 + 面板 + 输入区工具条）
├─ build/                    csc 编译脚本、Inno Setup 脚本、打包脚本
├─ assets/icon.ico           应用图标
└─ docs/                     故障记录、功能映射、中转站对接契约
```

## 十一、数据与隐私

**全部数据只在本机。**

| 内容 | 位置 | 保护 |
|---|---|---|
| 号池 | `%LOCALAPPDATA%\AGY-Daddy\vault.enc` | AES-256-GCM |
| 密钥 | 同目录 `vault.key`（仅当前用户可读） | 文件权限 |
| 配置 / 草稿 | 同目录 `config.json` / `drafts.json` | 明文（不含账号） |
| 日志 | 同目录 `logs\` | 明文 |
| 当前登录态 | Windows 凭据管理器 `gemini:antigravity` | Windows 用户隔离 |

**联网范围**：只与本机的官方客户端（CDP / LS RPC）通信；没有任何上传接口、没有遥测。

**威胁模型要说清**：`vault.key` 与 `vault.enc` 放在同一目录，能读该目录的同用户进程可以解密。它的作用是「避免明文落盘 / 防随手拷贝」，**不是**防本机同用户恶意程序。需要更强保护请开启 BitLocker，或给保险箱加口令（`store.js` 已支持 scrypt 口令派生）。

**清除数据**：删除 `%LOCALAPPDATA%\AGY-Daddy` 整个目录即可（凭据管理器里那条属于官方客户端，卸载官方客户端时才会清）。

## 十二、常见问题

**双击没反应 / 不拉起客户端**
官方客户端有时会「窗口已关但进程没退干净」，留下无窗口的残留进程。打开任务管理器，结束**所有** `Antigravity.exe`，再双击一次即可。

**第一次启动很慢**
官方客户端冷启动本身要 30–60 秒，期间后台守护已就绪、悬浮球可能稍后才出现，属正常。

**面板不出现 / 工具条不见了**
按 F5 刷新一次客户端页面，注入会自动重挂。

**面板显示「客户端未登录 / 上游数据不可用」**
官方停在登录页时读不到配额与账号，这是真实状态，不是 0%。登录完成后约 12 秒内自动恢复。

**端口 8787 被占用**
`set AGYD_PORT=8790` 后再启动。

## 十三、参考与致谢

本项目在设计与功能取舍上参考了以下两个开源项目，特此致谢：

| 项目 | 借鉴点 |
|---|---|
| [lbjlaq/Antigravity-Manager](https://github.com/lbjlaq/Antigravity-Manager) | 账号看板与「最佳账号」推荐的产品形态、配额可视化组织方式、多协议中转站的功能边界划分 |
| [Draculabo/AntigravityManager](https://github.com/Draculabo/AntigravityManager) | 账号批量导入导出的交互设计、按周 / 5h 拆分的配额视图、客户端切换与本地网关的思路 |

两个项目的实现与授权各自独立，本项目不包含它们的代码；如你更需要完整的多账号管理套件，建议直接使用它们。

## 十四、免责声明

- 本项目为个人自用工具的公开版本，按 MIT 许可「按现状」提供，不承诺可用性与适用性。
- 使用第三方增强工具可能违反上游服务的服务条款，**风险由使用者自行承担**。
- 请只使用你自己拥有或已获授权使用的账号；不要用它做账号共享、批量注册或任何绕过配额限制的行为。
- 与 Antigravity / Google 官方无任何关联，请勿向官方渠道报告本项目的 issue。

## 十五、License

[MIT](LICENSE) © 2026 junmoxiao-6
