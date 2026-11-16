# -*- coding: utf-8 -*-
"""打包会话导出增强器：完整版 + 精简版（去 vendor/pyodide）。
用法：python pack.py <版本号>   例如 python pack.py 1.3.8
"""
import os
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
EXT = os.path.join(HERE, 'extension')
EXCLUDE_LITE = {
    'vendor/pyodide/pyodide-lock.json',
    'vendor/pyodide/pyodide.asm.js',
    'vendor/pyodide/pyodide.asm.wasm',
    'vendor/pyodide/pyodide.js',
    'vendor/pyodide/python_stdlib.zip',
}


def pack(out: str, exclude: set) -> None:
    files = []
    for root, _dirs, fs in os.walk(EXT):
        for f in fs:
            p = os.path.relpath(os.path.join(root, f), EXT).replace(os.sep, '/')
            if p not in exclude:
                files.append(p)
    files.sort()
    with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for p in files:
            z.write(os.path.join(EXT, p), p)
    print(out, len(files), '个文件, %.1f MB' % (os.path.getsize(out) / 1048576))


def main() -> None:
    ver = sys.argv[1] if len(sys.argv) > 1 else '1.3.8'
    full = os.path.join(HERE, '会话导出增强器-%s.zip' % ver)
    lite = os.path.join(HERE, '会话导出增强器-%s-精简版.zip' % ver)
    pack(full, set())
    pack(lite, EXCLUDE_LITE)
    for name in (full, lite):
        with zipfile.ZipFile(name) as zf:
            ok = zf.testzip() is None
            manifest = zf.read('manifest.json').decode('utf-8')
        print(name, '| 完整性:', 'OK' if ok else 'BAD',
              '| 版本正确:', ('"version": "%s"' % ver) in manifest)


if __name__ == '__main__':
    main()
