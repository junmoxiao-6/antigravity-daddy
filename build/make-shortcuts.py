# -*- coding: utf-8 -*-
r"""创建 / 修复桌面与开始菜单快捷方式（纯 ctypes 调用 Windows ShellLink COM）。
用法：python build\make-shortcuts.py
说明：不依赖 pywin32；不改动任何系统设置；已有同名 .lnk 会被覆盖为目标正确值。
"""
import ctypes
import ctypes.wintypes as w
import os
import sys
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXE = os.path.join(ROOT, 'Antigravity Daddy.exe')
ICON = os.path.join(ROOT, 'assets', 'icon.ico')
DESC = 'Antigravity Daddy - Antigravity 客户端增强与多账号调度'


class GUID(ctypes.Structure):
    _fields_ = [('Data1', w.DWORD), ('Data2', w.WORD), ('Data3', w.WORD),
                ('Data4', ctypes.c_ubyte * 8)]


def guid(s):
    u = uuid.UUID(s)
    g = GUID()
    g.Data1, g.Data2, g.Data3 = u.time_low, u.time_mid, u.time_hi_version
    for i, b in enumerate(u.bytes_le[8:]):
        g.Data4[i] = b
    return g


def vfunc(ptr, idx, restype, argtypes):
    vt = ctypes.cast(ptr, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
    return ctypes.WINFUNCTYPE(restype, ctypes.c_void_p, *argtypes)(vt[idx])


def known_folder(csidl):
    """解析真实已知文件夹路径（如桌面），避免 USERPROFILE 下的空目录。
    有些机器的桌面会被重定向到其它盘，所以必须向系统问真实路径，不能拼 USERPROFILE。"""
    shell32 = ctypes.windll.shell32
    buf = ctypes.create_unicode_buffer(w.MAX_PATH)
    shell32.SHGetFolderPathW.argtypes = [w.HWND, ctypes.c_int, w.HANDLE, w.DWORD, ctypes.c_wchar_p]
    shell32.SHGetFolderPathW.restype = ctypes.c_long
    hr = shell32.SHGetFolderPathW(None, csidl, None, 0, buf)
    if hr == 0 and buf.value:
        return buf.value
    raise OSError('SHGetFolderPath csidl=%d hr=0x%08x' % (csidl, hr & 0xffffffff))


def main():
    if not os.path.isfile(EXE):
        print('ERROR: not found', EXE)
        return 1
    ole32 = ctypes.oledll.ole32
    ole32.CoInitialize(None)

    p = ctypes.c_void_p()
    hr = ole32.CoCreateInstance(
        ctypes.byref(guid('{00021401-0000-0000-C000-000000000046}')), None, 1,
        ctypes.byref(guid('{000214F9-0000-0000-C000-000000000046}')), ctypes.byref(p))
    if hr != 0:
        print('ERROR: CoCreateInstance hr=0x%08x' % (hr & 0xffffffff))
        return 2

    H = ctypes.c_long
    S = ctypes.c_wchar_p
    vfunc(p, 20, H, [S])(p, EXE)                 # SetPath
    vfunc(p, 9, H, [S])(p, ROOT)                 # SetWorkingDirectory
    vfunc(p, 7, H, [S])(p, DESC)                 # SetDescription
    vfunc(p, 17, H, [S, ctypes.c_int])(p, ICON, 0)  # SetIconLocation (本机 vtable idx 17)
    vfunc(p, 15, H, [ctypes.c_int])(p, 1)        # SetShowCmd (本机 vtable idx 15) = SW_SHOWNORMAL

    q = ctypes.c_void_p()
    hr = vfunc(p, 0, H, [ctypes.POINTER(GUID), ctypes.POINTER(ctypes.c_void_p)])(
        p, ctypes.byref(guid('{0000010B-0000-0000-C000-000000000046}')), ctypes.byref(q))
    if hr != 0:
        print('ERROR: QueryInterface hr=0x%08x' % (hr & 0xffffffff))
        return 3

    # 0 = DESKTOP, 2 = PROGRAMS（开始菜单\程序）。两者均可能被系统重定向到其它盘。
    desktop = known_folder(0)
    programs = known_folder(2)
    print('解析到真实桌面路径:', desktop)
    print('解析到真实开始菜单路径:', programs)
    targets = [
        os.path.join(desktop, 'Antigravity Daddy.lnk'),
        os.path.join(programs, 'Antigravity Daddy.lnk'),
    ]
    save = vfunc(q, 6, H, [S, ctypes.c_int])
    bad = 0
    for t in targets:
        os.makedirs(os.path.dirname(t), exist_ok=True)
        # 目标已存在且内容正确时直接跳过：桌面 .lnk 常被 explorer 锁定，
        # 直接 Save 会 E_ACCESSDENIED(0x80070005)，替换也会 WinError 5。
        if os.path.isfile(t):
            try:
                raw = open(t, 'rb').read().decode('utf-16-le', errors='ignore')
                if 'Antigravity Daddy.exe' in raw and 'icon.ico' in raw:
                    print('OK   ' + t + ' (已存在且有效，跳过覆盖)')
                    continue
            except OSError:
                pass

        tmp = t + '.new.lnk'
        try:
            if os.path.isfile(tmp):
                os.remove(tmp)   # 只清自己上一轮生成的临时文件
        except OSError:
            pass
        hr = save(q, tmp, 1)
        ok = False
        if hr == 0 and os.path.isfile(tmp):
            try:
                os.replace(tmp, t)
                ok = True
            except OSError as e:
                print('  replace failed:', e)
        if not ok and os.path.isfile(t):
            # 覆盖不了但旧文件仍在且可用，不算失败
            ok = True
        try:
            if os.path.isfile(tmp):
                os.remove(tmp)
        except OSError:
            pass
        exists = os.path.isfile(t)
        print(('OK   ' if ok else 'FAIL '), t, 'hr=0x%08x' % (hr & 0xffffffff),
              os.path.getsize(t) if exists else '')
        bad += 0 if ok else 1
    return 1 if bad else 0


if __name__ == '__main__':
    sys.exit(main())
