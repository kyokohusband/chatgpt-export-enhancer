# -*- coding: utf-8 -*-
"""把桌面版转换所需的运行时资源同步到浏览器插件里。

改过 widget-runtime.js / converter.py 或 KaTeX 资源后跑一次：
    python build_extension_assets.py

产物：
    extension/assets/    给内置 JS 引擎用
        runtime.js    widget-runtime.js + lucide 图标（与 runtime_embed.py 同一份拼装逻辑）
        hljs.js       代码高亮
        hljs.css      高亮主题
        katex.js/css   离线公式排版（字体内嵌在 CSS 中）
        mermaid.js    只有页面里出现 mermaid 图时才会被加载进插件
        converter.css converter.py 里的 _EXTRA_CSS（组件/代码块/目录样式）
        toc.js        converter.py 里的 _TOC_JS（右侧目录）

    extension/py/        给 Python 引擎用（Pyodide 里直接跑原版源码）
        converter.py      原样拷贝
        dslsyntax.py      原样拷贝
        runtime_embed.py  自动从桌面运行时生成并同步
"""
from __future__ import annotations

import os
import shutil
import sys

HERE = os.path.dirname(os.path.abspath(__file__))          # plugin/
ROOT = os.path.dirname(HERE)                               # 导出增强器/
DESKTOP = os.path.join(ROOT, "desktop")                    # 桌面端模块
APP = os.path.join(DESKTOP, "app")
JS = os.path.join(DESKTOP, "widget-runtime.js")
OUT = os.path.join(HERE, "extension", "assets")
PYOUT = os.path.join(HERE, "extension", "py")

sys.path.insert(0, APP)

# Python 引擎直接跑这些文件的原文，所以必须原样拷贝、不做任何改写
PY_SOURCES = ("converter.py", "dslsyntax.py", "runtime_embed.py")


def write(name: str, text) -> None:
    path = os.path.join(OUT, name)
    raw = text.encode("utf-8") if isinstance(text, str) else text
    with open(path, "wb") as f:
        f.write(raw)
    print("wrote %-14s %8d bytes" % (name, len(raw)))


def main() -> None:
    # 一条命令更新所有派生文件，避免桌面运行时与扩展内嵌副本脱节。
    sys.path.insert(0, DESKTOP)
    import build_runtime_embed  # noqa: E402
    build_runtime_embed.main()
    import build_math_assets  # noqa: E402
    build_math_assets.main()

    os.makedirs(OUT, exist_ok=True)

    with open(JS, "rb") as f:
        runtime = f.read()
    with open(os.path.join(APP, "lucide-icons.json"), "rb") as f:
        icons = f.read()
    write("runtime.js", b"var WB_LUCIDE_ICONS=" + icons + b";\n" + runtime)

    for src, dst in (("hljs.min.js", "hljs.js"), ("hljs-github.min.css", "hljs.css"), ("mermaid.min.js", "mermaid.js")):
        with open(os.path.join(APP, src), encoding="utf-8") as f:
            write(dst, f.read())

    import converter  # noqa: E402  （app 已在 sys.path）

    # 保持原始字符串（含首尾换行），这样注入结果与桌面端 _build_inject 逐字符一致
    write("converter.css", converter._EXTRA_CSS)
    write("toc.js", converter._TOC_JS)
    print("总大小 %.1f MB" % (sum(os.path.getsize(os.path.join(OUT, n)) for n in os.listdir(OUT)) / 1048576))

    # ---- Python 引擎：原样拷贝源码，Pyodide 里直接跑 ----
    os.makedirs(PYOUT, exist_ok=True)
    for name in PY_SOURCES:
        src = os.path.join(APP, name)
        dst = os.path.join(PYOUT, name)
        # 内容没变就不碰时间戳，避免白改
        if os.path.exists(dst) and open(src, "rb").read() == open(dst, "rb").read():
            print("skip  %-14s (未变化)" % name)
            continue
        shutil.copyfile(src, dst)
        print("wrote %-14s %8d bytes  (py/)" % (name, os.path.getsize(dst)))


if __name__ == "__main__":
    main()
