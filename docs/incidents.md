# Antigravity Daddy 故障记录（Incidents）

> 用途：记录真实发生过的故障、根因、修复与验证，防止同一问题复发。新条目置顶。

---

## 2026-11-17 21:09 · 「启动不了」复发（守护在跑、官方客户端进程已 0）+ daemon 自愈修复

### 现象 / 证据
- `health` = `ready, cdp:true`（连 64797），但 `Antigravity.exe` 进程数 **0**、可见窗口 **0**。
- `boot.log` 21:09 连续 `already-running, focused client`：exe 见「守护还在」就只聚焦、不启客户端 → 表现为「点了不给启动官方客户端」。

### 根因
守护缺生命週期自愈：官方客户端被关掉后，守护仍常驻并报 ready，`exe.IsDaemonAlive()` 命中 → 只 focus、不再 `StartDaemon`。

### 修复（v0.3.4，纯 JS，免编译；`src/daemon.js` · startWatch）
- 官方进程**彻底没了**且连续 3 个巡检周期(≈36s) → 守护**自退**（下次双击走全新启动）。
- 官方进程**还在**但 attach/注入连续失败 3 次（半死僵尸）→ **杀僵尸 + 重启官方客户端**（仅本会话曾成功连接过才动手，避免冷启动误杀）。
- 新增 `agyProcCount()`（tasklist 计数）、`healRestartClient()`。

### 验证（实测）
`--no-start` 起守护、0 客户端：`boot cost 90452ms` → `client watch started` → 36s 后 `[watch] 官方客户端已关闭，守护进程退出（下次双击将全新启动）` → 进程 `rc=0`。

### 说明
exe 仍为 v0.3.3（未重编译）；但两条自愈都在 `daemon.js`，每次启动从磁盘加载，**无需重编译即生效**。

---

## 2026-11-15 20:04 · 双击「启动不了」（官方窗口被关、进程残留成僵尸）

### 现象
双击桌面 `Antigravity Daddy` 无任何窗口出现，看起来「启动不了」。

### 证据（真实枚举）
- `/api/health` 返回 `ok:true, cdp:true, ls.attached:true, stage:"ready"` → 守护自认为一切正常。
- `tasklist`：`Antigravity.exe` 有 **2 个进程**（PID 14684 / 3028）在跑。
- 按 PID 用 `EnumWindows` 枚举：**这 2 个进程拥有 0 个顶层窗口**（连隐藏窗口都没有）。
- `boot.log` 20:02 连续 9 行 `already-running, focused client` → 每次双击启动器都走 `IsDaemonAlive()` 分支，只尝试聚焦窗口、找不到就静默退出。

### 根因
官方客户端**窗口已被关闭/销毁，但主进程没退出**（Electron 残留 + 后台 LS 常驻）。守护靠残留渲染页维持 CDP 连接，所以 `health` 仍 `ready`。
启动器旧逻辑：`if (IsDaemonAlive()) { FocusClient(); return; }` —— 只要守护活着就只「聚焦」，**从不重建窗口**。窗口不存在 → 聚焦空 → 用户感知「启动不了」。
> 非破坏性验证：再 `spawn Antigravity.exe` 也不会出窗口（单实例把请求转给无窗口的僵尸，不重建）。必须结束僵尸进程再全新拉起。

### 修复
| 版本 | 改动 | 位置 |
| --- | --- | --- |
| v0.3.4 | ① `FocusClient()` 改为返回 `bool`；② `Main` 里守护在跑但**无可见窗口**时，走 `RestartAll()`（停旧守护 → `taskkill /IM Antigravity.exe /F` 杀僵尸 → `--force-client` 全新拉起客户端+守护）；③ 单实例 `Mutex` 提到最前，覆盖自愈流程 | `build/AGYDaddyLauncher.cs` |
| v0.3.4 | `launcher.js` 新增 `--force-client`：忽略 `DevToolsActivePort` 缓存，强制 `startClient()` + 起 daemon | `src/launcher.js` |

### 验证与限制
- 恢复实测：清僵尸后，现有 exe 全新启动，**第 45 秒出现可见窗口** `Antigravity (46,30,1494,818)`，health 转 `ok`。
- **本会话未能重编译 exe**：`csc.exe` 被安全策略禁止（等同 Add-Type），且 PowerShell 工具不可用。JS 侧改动（`daemon.js`/`launcher.js`）已即时生效（health 已显示 0.3.4）；`AGYDaddyLauncher.cs` 的自愈逻辑需下次用 `build\build-exe.ps1` 重编译后才生效。

### 复发时的手动急救（在重编译前）
1. 任务管理器 → 结束**所有** `Antigravity.exe` 进程。
2. 双击 `Antigravity Daddy` 即可（守护若还在也会自动重连，或全新拉起）。

---

## 2026-11-14 18:30 · 「守护进程启动超时」弹窗（实际已成功启动）

### 现象
双击 `Antigravity Daddy.exe` 后弹出对话框：

> Antigravity Daddy · 守护进程启动超时
> 已等待 25 秒仍未就绪。请在 %LOCALAPPDATA%\AGY-Daddy\logs 查看 boot.log / daemon.log

但**稍后软件最终还是正常打开了**（官方客户端 + 注入面板都出来了）。用户要求记录，防止真出 bug。

### 证据（真实日志）
`boot.log`：
```
2026-11-14 18:30:02 start node=...\bin\node.exe   ← 同一秒出现两次
2026-11-14 18:30:14 start node=...\bin\node.exe   ← 又两次
2026-11-14 18:30:33 api timeout                    ← 启动器 25s 超时
2026-11-14 18:30:33 ready, api up                  ← 同一秒 daemon 实际就绪
```
`daemon.log`：
```
[10:30:33] quota loop started        ← 循环反复出现（多实例）
[10:30:33] daemon listening http://127.0.0.1:8787
...
[10:31:08] CDP attached 10848 ...
[10:31:08] ready, LS null vnull
[10:31:08] boot cost 35795 ms        ← 冷启动实测 35.8 s
```

### 根因（两个叠加）
1. **超时阈值太短**：旧版启动器 `ApiWaitMs = 25000`（25 s），而官方客户端冷启动 + CDP 发现 + 注入实测 **35.8 s**（`boot cost 35795 ms`）。25 s 必误报"启动超时"，即使 daemon 随后就绪。
2. **重复实例**：旧版启动器无单实例闸，冷启动窗口期内双击两次 = 起两个 `node launcher.js` → 抢 8787 端口 → 第二套 `quota/auto` 循环重复跑。且 `daemon.js` 的 `srv.listen` **没有 `error` 处理**，第二个守护在 `EADDRINUSE` 时未捕获崩溃，但**崩溃前循环已经同步启动**（循环写在 `startServer()` 之后、`listen` 异步回调之前），于是日志出现成对的 `quota loop started`。

### 修复
| 版本 | 改动 | 位置 |
| --- | --- | --- |
| v0.3.2 | ① `ApiWaitMs` 25 s → **90 s**（覆盖冷启动 35.8 s）；② 启动器加单实例 `Mutex("Local\AgyDaddyLauncher")`，冷启动窗口期内二次双击只等待/聚焦，不再起第二个 daemon；③ `ready, api up (耗时ms)` 日志带耗时 | `build/AGYDaddyLauncher.cs` |
| v0.3.3 | ① `daemon.js` 加 `srv.on('error')`：`EADDRINUSE` 时打印 `port ... already in use: another daemon is running — this instance exits` 并 `process.exit(0)`；② 把 `startAutoLoop()/startQuotaLoop()` 挪进 `listen` 成功回调，**抢不到端口就一套循环都不跑** | `src/daemon.js` `startServer()` / `main()` |

> v0.3.2 是启动器侧单实例；v0.3.3 是守护侧二次兜底（覆盖 watchdog/手动/第二个入口等边缘情况）。两者叠加后不可能再出现重复循环。

### 验证（v0.3.3 实测）
```
p1 exited=False pid=45740              ← 实例1 正常存活
quota-loop delta after p1 = 1          ← 只有一套循环
p2 exited=True  pid=45792              ← 实例2 触发 EADDRINUSE，立即退出
quota-loop total delta = 1             ← 实例2 未新增循环
already-in-use 日志条数 = 1            ← 优雅退出日志已写入
health = {"ok":true,"version":"0.3.3","stage":"waiting"}
```

### 结论
- 该弹窗**不是** daemon 真的起不来，是旧二进制（25 s 阈值 + 无互斥）的误报。
- 当前 exe（v0.3.3，2026-11-14 19:08 重建）已含全部修复。
- 若**再次**出现弹窗：先看 `boot.log` 是否有 `ready, api up` 紧跟 `api timeout`（说明只是慢，非失败）；再看 `daemon.log` 的 `boot cost` 是否 > 90 s（极端机器/杀软拖慢）；最后查是否有多个 `node.exe`（`Where CommandLine -match 'agy-daddy'`）。
