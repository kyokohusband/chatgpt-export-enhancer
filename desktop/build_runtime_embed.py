# -*- coding: utf-8 -*-
"""把 widget-runtime.js 重新打包进 app/runtime_embed.py。

改完 widget-runtime.js 后必须跑一次，否则页面里用的还是旧运行时：
    python build_runtime_embed.py
"""
import base64
import os
import textwrap

HERE = os.path.dirname(os.path.abspath(__file__))
JS = os.path.join(HERE, "widget-runtime.js")
ICONS = os.path.join(HERE, "app", "lucide-icons.json")
OUT = os.path.join(HERE, "app", "runtime_embed.py")

HEAD = (
    "# -*- coding: utf-8 -*-\n"
    '"""Generated inline copy of widget-runtime.js. Do not edit by hand."""\n'
    "import base64\n\n"
)


def main() -> None:
    with open(JS, "rb") as f:
        raw = f.read()
    with open(ICONS, "rb") as f:
        icons = f.read()
    raw = b"var WB_LUCIDE_ICONS=" + icons + b";\n" + raw
    b64 = base64.b64encode(raw).decode("ascii")
    lines = textwrap.wrap(b64, 100)
    body = "RUNTIME_B64 = (\n" + "\n".join("    '%s'" % ln for ln in lines) + "\n)\n"
    tail = (
        "\n\ndef runtime_source() -> str:\n"
        '    return base64.b64decode(RUNTIME_B64).decode("utf-8")\n'
    )
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        f.write(HEAD + body + tail)
    print("runtime_embed.py 已更新：%d 字节 JS -> %d 字符 base64" % (len(raw), len(b64)))


if __name__ == "__main__":
    main()
