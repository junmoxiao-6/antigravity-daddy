// Antigravity Daddy 一次性启动器 v0.3.13
// 形态严格对齐 WorkDaddy：无常驻窗口、无常驻托盘、跑完立即退出。
// 自己的任务全部落到后台隐藏 node.exe（daemon）+ 官方 Antigravity 窗口内的注入层。
//   Antigravity Daddy.exe            双击 → 拉起官方客户端 + 后台 daemon → 退出
//   Antigravity Daddy.exe --console  打开可选独立 Web 控制台（Edge --app）
//   Antigravity Daddy.exe --stop     停止后台 daemon
// v0.3.2：① API 等待 25s→90s（冷启动实测 boot 35.8s，25s 必误报“启动超时”）；
//         ② 加单实例 Mutex（冷启动窗口期双击不再拉起第二个 daemon）；③ ready 日志带耗时。
// v0.3.3：守护侧加端口占用即退（EADDRINUSE 优雅退出、循环仅在 bind 成功后启动），
//         与启动器 Mutex 双保险，杜绝重复实例刷双套 quota/auto 循环。
// v0.3.4：自愈——守护在跑但官方窗口已关（进程残留成僵尸，health 仍 ready）时，
//         双击不再“只聚焦空窗口”静默失败，而是杀掉残留客户端 + 停旧守护 + --force-client 全新拉起。
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

namespace AgyDaddy
{
    static class Program
    {
        internal static readonly string Brand = "Antigravity Daddy";
        internal static readonly string Port = Environment.GetEnvironmentVariable("AGYD_PORT") ?? "8787";
        internal static readonly string Api = "http://127.0.0.1:" + Port;
        internal static string Root;
        // 冷启动实测：客户端 CDP 发现 + 注入最长 35.8 s（boot.log 2026-11-14），25 s 会误报超时
        internal const int ApiWaitMs = 90000;
        private static Mutex _single;

        [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr h);
        [DllImport("user32.dll")] private static extern bool ShowWindow(IntPtr h, int cmd);
        [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr h);

        internal static string DataDir()
        {
            return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "AGY-Daddy");
        }

        [STAThread]
        static void Main(string[] args)
        {
            Root = AppDomain.CurrentDomain.BaseDirectory;
            if (!File.Exists(Path.Combine(Root, "src", "launcher.js")))
            {
                var up = Path.GetFullPath(Path.Combine(Root, ".."));
                if (File.Exists(Path.Combine(up, "src", "launcher.js"))) Root = up;
            }
            Application.EnableVisualStyles();

            bool wantConsole = Has(args, "--console");
            bool wantStop = Has(args, "--stop");
            bool noStart = Has(args, "--no-start");
            if (wantStop) { StopDaemon(); return; }
            if (wantConsole) { OpenConsole(); return; }

            // 单实例闸：整个启动/自愈流程只允许一个实例推进
            bool createdNew;
            _single = new Mutex(true, @"Local\AgyDaddyLauncher", out createdNew);
            if (!createdNew)
            {
                if (WaitForApi(20000)) { FocusClient(); BootLog("already-booting, focused client"); }
                else BootLog("already-booting, api still down");
                return;
            }

            // 已在跑：先尝试聚焦官方窗口；若无可见窗口（客户端进程残留、窗口已被关 = 僵尸）→ 自愈重启
            if (IsDaemonAlive())
            {
                if (FocusClient()) { BootLog("already-running, focused client"); return; }
                BootLog("heal: daemon alive but no visible client window -> restart client+daemon");
                if (!RestartAll()) { BootLog("heal: restart failed"); return; }
                var hok = WaitForApi(ApiWaitMs);
                FocusClient();
                BootLog(hok ? "heal: restarted, api up" : "heal: restarted, api timeout");
                return;
            }

            BootLog("start node=" + (FindNode() ?? "NULL"));
            if (!StartDaemon(noStart)) return;

            // 等本地 API 就绪（daemon 不等客户端 CDP，通常 1–3 s；冷启动最长 35.8 s，故给 90 s）
            var t0 = DateTime.Now;
            var ok = WaitForApi(ApiWaitMs);
            var cost = (int)(DateTime.Now - t0).TotalMilliseconds;
            if (ok) { FocusClient(); BootLog("ready, api up (" + cost + "ms)"); }
            else { BootLog("api timeout"); Fail("守护进程启动超时", "已等待 " + (ApiWaitMs / 1000) + " 秒仍未就绪。\n请在 " + DataDir() + "\\logs 查看 boot.log / daemon.log"); }
        }

        private static bool Has(string[] a, string f)
        {
            foreach (var x in a) if (string.Equals(x, f, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        private static void BootLog(string line)
        {
            try
            {
                var f = Path.Combine(DataDir(), "logs", "boot.log");
                Directory.CreateDirectory(Path.GetDirectoryName(f));
                File.AppendAllText(f, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + line + "\r\n");
            }
            catch { }
        }

        private static void Fail(string title, string msg)
        {
            // 只有失败时才弹窗（WorkDaddy 同样策略），弹完立即退出，不留托盘
            try { MessageBox.Show(msg, Brand + " · " + title, MessageBoxButtons.OK, MessageBoxIcon.Warning); }
            catch { }
        }

        // ---------------- 本地 API ----------------
        internal static string HttpGet(string path)
        {
            var req = (HttpWebRequest)WebRequest.Create(Api + path);
            req.Method = "GET"; req.Timeout = 2000; req.ReadWriteTimeout = 2000;
            req.Proxy = null; // 127.0.0.1 不能被系统代理截走
            using (var resp = (HttpWebResponse)req.GetResponse())
            using (var sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                return sr.ReadToEnd();
        }

        internal static string HttpPost(string path, string body)
        {
            var req = (HttpWebRequest)WebRequest.Create(Api + path);
            req.Method = "POST"; req.ContentType = "application/json"; req.Timeout = 3000; req.Proxy = null;
            var bytes = Encoding.UTF8.GetBytes(body ?? "{}");
            req.ContentLength = bytes.Length;
            using (var s = req.GetRequestStream()) s.Write(bytes, 0, bytes.Length);
            using (var resp = (HttpWebResponse)req.GetResponse())
            using (var sr = new StreamReader(resp.GetResponseStream(), Encoding.UTF8))
                return sr.ReadToEnd();
        }

        private static bool IsDaemonAlive()
        {
            try { return HttpGet("/api/health").Contains("\"ok\":true"); }
            catch { return false; }
        }

        private static bool WaitForApi(int ms)
        {
            var end = DateTime.Now.AddMilliseconds(ms);
            while (DateTime.Now < end)
            {
                if (IsDaemonAlive()) return true;
                Thread.Sleep(300);
            }
            return false;
        }

        private static void StopDaemon()
        {
            try { HttpPost("/api/shutdown", "{}"); BootLog("stop requested"); }
            catch { BootLog("stop: daemon not running"); }
        }

        // ---------------- 启动后台守护 ----------------
        private static bool StartDaemon(bool noStart)
        {
            var node = FindNode();
            if (node == null)
            {
                BootLog("START FAIL: node not found");
                Fail("未找到 Node 运行时", "把 Node 20+ 的 node.exe 放到程序目录下 bin\\node.exe，或安装 Node.js。");
                return false;
            }
            try
            {
                var psi = new ProcessStartInfo(node,
                    "\"" + Path.Combine(Root, "src", "launcher.js") + "\"" + (noStart ? " --no-start" : ""))
                {
                    WorkingDirectory = Root,
                    UseShellExecute = true,   // ShellExecute 启动 = 独立进程树，父进程退出不影响 daemon
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                };
                Process.Start(psi);
                return true;
            }
            catch (Exception ex)
            {
                BootLog("START FAIL: " + ex.GetType().Name + " " + ex.Message);
                Fail("启动失败", ex.Message);
                return false;
            }
        }

        // 把官方客户端窗口提到前台；找到并成功聚焦可见窗口返回 true，否则 false
        private static bool FocusClient()
        {
            try
            {
                foreach (var p in Process.GetProcessesByName("Antigravity"))
                {
                    var h = p.MainWindowHandle;
                    if (h != IntPtr.Zero && IsWindowVisible(h))
                    {
                        ShowWindow(h, 9);          // SW_RESTORE：最小化也能恢复
                        SetForegroundWindow(h);
                        return true;
                    }
                }
            }
            catch { }
            return false;
        }

        // 自愈：停止当前 daemon → 杀掉无窗口的官方客户端残留 → 全新拉起（客户端 + daemon）
        private static bool RestartAll()
        {
            try { HttpPost("/api/shutdown", "{}"); } catch { }
            try
            {
                var psi = new ProcessStartInfo("taskkill", "/IM Antigravity.exe /F")
                { UseShellExecute = false, CreateNoWindow = true };
                using (var pr = Process.Start(psi)) { pr.WaitForExit(5000); }
            }
            catch { }
            Thread.Sleep(2000);
            BootLog("heal: killed windowless client, fresh start");
            return StartDaemonForce();
        }

        // --force-client：忽略 DevToolsActivePort 缓存，强制拉起官方客户端并起守护
        private static bool StartDaemonForce()
        {
            var node = FindNode();
            if (node == null)
            {
                BootLog("START FAIL: node not found");
                Fail("未找到 Node 运行时", "把 Node 20+ 的 node.exe 放到程序目录下 bin\\node.exe，或安装 Node.js。");
                return false;
            }
            try
            {
                var psi = new ProcessStartInfo(node,
                    "\"" + Path.Combine(Root, "src", "launcher.js") + "\" --force-client")
                {
                    WorkingDirectory = Root,
                    UseShellExecute = true,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                };
                Process.Start(psi);
                return true;
            }
            catch (Exception ex)
            {
                BootLog("START FAIL: " + ex.GetType().Name + " " + ex.Message);
                return false;
            }
        }

        // ---------------- 可选：独立 Web 控制台 ----------------
        private static void OpenConsole()
        {
            if (!IsDaemonAlive())
            {
                Fail("守护进程未运行", "请先双击一次 " + Brand + " 启动，再打开控制台。");
                return;
            }
            var edge = FindEdge();
            if (edge == null)
            {
                Fail("未找到 Microsoft Edge", "独立控制台需要 Edge（WebView2 内核）。官方客户端内的注入面板不受影响。");
                return;
            }
            try
            {
                var profile = Path.Combine(DataDir(), "edge-profile");
                Directory.CreateDirectory(profile);
                var psi = new ProcessStartInfo(edge,
                    "--app=\"" + Api + "/console\" --window-size=1240,860 " +
                    "--user-data-dir=\"" + profile + "\" --no-first-run --no-default-browser-check");
                psi.UseShellExecute = true;
                Process.Start(psi);
            }
            catch (Exception ex) { Fail("打开控制台失败", ex.Message); }
        }

        internal static string FindEdge()
        {
            var candidates = new[] {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), @"Microsoft\Edge\Application\msedge.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Microsoft\Edge\Application\msedge.exe"),
            };
            foreach (var c in candidates) if (File.Exists(c)) return c;
            try
            {
                using (var k = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"))
                {
                    var v = k == null ? null : k.GetValue("") as string;
                    if (!string.IsNullOrEmpty(v) && File.Exists(v)) return v;
                }
            }
            catch { }
            return null;
        }

        internal static string FindNode()
        {
            var bundled = Path.Combine(Root, "bin", "node.exe");
            if (File.Exists(bundled)) return bundled;
            foreach (var p in new[] {
                @"C:\Program Files\nodejs\node.exe",
                @"C:\Program Files (x86)\nodejs\node.exe",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Programs\nodejs\node.exe")
            }) if (File.Exists(p)) return p;
            try
            {
                var pathVar = Environment.GetEnvironmentVariable("PATH") ?? "";
                foreach (var dir in pathVar.Split(';'))
                {
                    if (string.IsNullOrWhiteSpace(dir)) continue;
                    try { var p = Path.Combine(dir.Trim().Trim('"'), "node.exe"); if (File.Exists(p)) return p; } catch { }
                }
            }
            catch { }
            try
            {
                var home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                var bases = new[] {
                    Path.Combine(home, @".workbuddy\binaries\node\versions"),
                    Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "nvm")
                };
                string best = null; DateTime bestTime = DateTime.MinValue;
                foreach (var b in bases)
                {
                    if (!Directory.Exists(b)) continue;
                    foreach (var d in Directory.GetDirectories(b))
                    {
                        var p = Path.Combine(d, "node.exe");
                        if (!File.Exists(p)) continue;
                        var t = File.GetLastWriteTimeUtc(p);
                        if (t > bestTime) { bestTime = t; best = p; }
                    }
                }
                if (best != null) return best;
            }
            catch { }
            return null;
        }
    }
}
