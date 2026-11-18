#!/usr/bin/env python3
"""AGY-Daddy Windows 凭据助手 (gemini:antigravity)

为什么需要它：Node 无内置 Win32 凭据 API，Antigravity 2.x 的 OAuth 凭据
又只存在于 Windows Credential Manager（Generic, TargetName=gemini:antigravity,
UserName=antigravity, 内容为 618 字节的明文 UTF-8 JSON），不在
~/.gemini/oauth_creds.json。用 ctypes 直接调 advapi32，零依赖、零编译。

子命令:
  read                     读取并输出原始 JSON 到 stdout
  write <file>             原子写入（先备份 -> 写 -> 回读校验，5 次指数退避）
  backup <dir>             备份当前凭据到 dir/gemini_antigravity_<ts>.json
  probe                    输出凭据元信息（旗标/持久化/大小/邮箱）

退出码: 0 成功, 2 无凭据, 3 写入校验失败, 4 其它错误
"""
import ctypes
import ctypes.wintypes as w
import json
import os
import sys
import time

CRED_TYPE_GENERIC = 1
CRED_PERSIST_LOCAL_MACHINE = 2
TARGET = "gemini:antigravity"
USERNAME = "antigravity"

advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)


class FILETIME(ctypes.Structure):
    _fields_ = [("dwLowDateTime", w.DWORD), ("dwHighDateTime", w.DWORD)]


class CREDENTIAL(ctypes.Structure):
    _fields_ = [
        ("Flags", w.DWORD),
        ("Type", w.DWORD),
        ("TargetName", w.LPWSTR),
        ("Comment", w.LPWSTR),
        ("LastWritten", FILETIME),
        ("CredentialBlobSize", w.DWORD),
        ("CredentialBlob", ctypes.POINTER(ctypes.c_byte)),
        ("Persist", w.DWORD),
        ("AttributeCount", w.DWORD),
        ("Attributes", ctypes.c_void_p),
        ("TargetAlias", w.LPWSTR),
        ("UserName", w.LPWSTR),
    ]


advapi32.CredReadW.argtypes = [w.LPCWSTR, w.DWORD, w.DWORD, ctypes.POINTER(ctypes.POINTER(CREDENTIAL))]
advapi32.CredReadW.restype = w.BOOL
advapi32.CredWriteW.argtypes = [ctypes.POINTER(CREDENTIAL), w.DWORD]
advapi32.CredWriteW.restype = w.BOOL
advapi32.CredDeleteW.argtypes = [w.LPCWSTR, w.DWORD, w.DWORD]
advapi32.CredDeleteW.restype = w.BOOL
advapi32.CredFree.argtypes = [ctypes.c_void_p]


def read_cred():
    p = ctypes.POINTER(CREDENTIAL)()
    if not advapi32.CredReadW(TARGET, CRED_TYPE_GENERIC, 0, ctypes.byref(p)):
        err = ctypes.get_last_error()
        return None, err
    try:
        c = p.contents
        blob = ctypes.string_at(c.CredentialBlob, c.CredentialBlobSize)
        return blob, 0
    finally:
        advapi32.CredFree(p)


def write_cred(blob: bytes, persist=CRED_PERSIST_LOCAL_MACHINE):
    buf = (ctypes.c_byte * len(blob)).from_buffer_copy(blob)
    cred = CREDENTIAL()
    cred.Flags = 0
    cred.Type = CRED_TYPE_GENERIC
    cred.TargetName = TARGET
    cred.Comment = None
    cred.CredentialBlobSize = len(blob)
    cred.CredentialBlob = ctypes.cast(buf, ctypes.POINTER(ctypes.c_byte))
    cred.Persist = persist
    cred.AttributeCount = 0
    cred.Attributes = None
    cred.TargetAlias = None
    cred.UserName = USERNAME
    ok = advapi32.CredWriteW(ctypes.byref(cred), 0)
    return bool(ok), ctypes.get_last_error()


def cmd_read():
    blob, err = read_cred()
    if blob is None:
        sys.stderr.write("no credential, winerror=%s\n" % err)
        return 2
    sys.stdout.buffer.write(blob)
    return 0


def cmd_probe():
    blob, err = read_cred()
    if blob is None:
        sys.stderr.write("no credential, winerror=%s\n" % err)
        return 2
    p = ctypes.POINTER(CREDENTIAL)()
    advapi32.CredReadW(TARGET, CRED_TYPE_GENERIC, 0, ctypes.byref(p))
    c = p.contents
    info = {
        "target": TARGET, "username": c.UserName, "flags": c.Flags, "type": c.Type,
        "persist": c.Persist, "attributes": c.AttributeCount, "bytes": c.CredentialBlobSize,
    }
    advapi32.CredFree(p)
    try:
        j = json.loads(blob.decode("utf-8"))
        info["email"] = j.get("id_token_email")
        info["auth_method"] = j.get("auth_method")
        info["expiry"] = (j.get("token") or {}).get("expiry")
        info["has_refresh"] = bool((j.get("token") or {}).get("refresh_token"))
        info["keys"] = sorted(j.keys())
    except Exception as e:
        info["parse_error"] = str(e)
        info["head"] = blob[:40].decode("utf-8", "replace")
    print(json.dumps(info, ensure_ascii=False, indent=1))
    return 0


def cmd_write(src):
    with open(src, "rb") as f:
        blob = f.read()
    if not blob:
        sys.stderr.write("empty payload\n")
        return 4
    # 校验是合法 JSON（防止写坏号）
    try:
        json.loads(blob.decode("utf-8"))
    except Exception as e:
        sys.stderr.write("payload is not valid utf-8 json: %s\n" % e)
        return 4

    old, _ = read_cred()
    delays = [0.1, 0.2, 0.4, 0.8, 1.6]
    last_err = 0
    for i, d in enumerate(delays):
        ok, err = write_cred(blob)
        if ok:
            break
        last_err = err
        time.sleep(d)
    else:
        sys.stderr.write("CredWrite failed after retries, winerror=%s\n" % last_err)
        return 3

    back, _ = read_cred()
    if back != blob:
        sys.stderr.write("read-back mismatch (len %s vs %s)\n" % (len(blob), len(back or b"")))
        if old is not None:
            write_cred(old)
            sys.stderr.write("rolled back to previous credential\n")
        return 3
    print(json.dumps({"ok": True, "bytes": len(blob), "rolled_back": False}))
    return 0


def cmd_backup(outdir):
    blob, err = read_cred()
    if blob is None:
        sys.stderr.write("no credential, winerror=%s\n" % err)
        return 2
    os.makedirs(outdir, exist_ok=True)
    ts = time.strftime("%Y%m%d-%H%M%S")
    fp = os.path.join(outdir, "gemini_antigravity_%s.json" % ts)
    tmp = fp + ".tmp"
    with open(tmp, "wb") as f:
        f.write(blob)
        f.flush()
        os.fsync(f.fileno())
    os.replace(tmp, fp)
    print(fp)
    return 0


def main(argv):
    if len(argv) < 2:
        print(__doc__)
        return 4
    cmd = argv[1]
    if cmd == "read":
        return cmd_read()
    if cmd == "probe":
        return cmd_probe()
    if cmd == "write" and len(argv) >= 3:
        return cmd_write(argv[2])
    if cmd == "backup":
        return cmd_backup(argv[2] if len(argv) >= 3 else ".")
    print(__doc__)
    return 4


if __name__ == "__main__":
    sys.exit(main(sys.argv))
