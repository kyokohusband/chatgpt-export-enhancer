# -*- coding: utf-8 -*-
"""读取导出 HTML 里内嵌的抓取诊断，判断代码块为什么没导出来。

用法：
    python 诊断.py "D:\\下载\\会话导出\\xxx.html"

诊断注释是插件 1.2.2+ 在导出时自动写进 HTML 末尾的 <!--CEX-DIAG:{...}-->。
"""
from __future__ import annotations

import json
import re
import sys


def main() -> int:
    if len(sys.argv) < 2:
        print(__doc__)
        return 2

    path = sys.argv[1]
    try:
        html = open(path, encoding="utf-8", errors="replace").read()
    except OSError as e:
        print("读不到文件：%s" % e)
        return 1

    m = re.search(r"<!--CEX-DIAG:(.*?)-->", html, re.S)
    if not m:
        print("这份文件里没有诊断信息。")
        print("原因：插件版本低于 1.2.2，或导出时走了「静态 HTML」模式。")
        return 1

    try:
        d = json.loads(m.group(1).replace("\\u002d", "--"))
    except json.JSONDecodeError as e:
        print("诊断数据解析失败：%s" % e)
        return 1

    print("插件版本      %s" % d.get("v"))
    print("站点 / 地址   %s  %s" % (d.get("site"), d.get("url")))
    print("消息条数      %d" % d.get("messages", 0))
    print("已滚动过      %s" % ("是" if d.get("scrolled") else "否"))
    print()

    sc = d.get("scroll")
    if sc:
        print("滚动前后 DOM 里的代码块数量：")
        print("  滚动前 pre   %d" % sc["before"]["pre"])
        print("  滚动后 pre   %d" % sc["after"]["pre"])
        print("  表格         %d → %d" % (sc["before"]["table"], sc["after"]["table"]))
        print()

    t = d.get("totals") or {}
    print("抓取时刻，消息内容里的元素计数：")
    print("  <pre>        %d" % t.get("pre", 0))
    print("  code         %d" % t.get("code", 0))
    print("  cm-editor    %d" % t.get("cm", 0))
    print("  代码块外壳   %d" % t.get("codeShell", 0))
    print("  复制按钮     %d" % t.get("copyBtn", 0))
    print()

    per = d.get("per") or []
    if per:
        print("逐条消息：")
        print("  %-10s %7s %5s %5s %5s" % ("角色", "字符", "pre", "外壳", "复制钮"))
        for i, x in enumerate(per, 1):
            print(
                "  %-10s %7d %5d %5d %5d"
                % (x.get("role"), x.get("chars", 0), x.get("pre", 0), x.get("codeShell", 0), x.get("copyBtn", 0))
            )
        print()

    sample = d.get("sampleShell")
    if sample:
        print("抽到一个「有外壳但没有 pre」的代码块：")
        print("  class = %s" % sample.get("cls"))
        print("  html  = %s" % (sample.get("html") or "")[:600])
        print()

    # ---------------- 结论 ----------------
    print("=" * 60)
    before = sc["before"]["pre"] if sc else None
    after = sc["after"]["pre"] if sc else None
    exported = len(re.findall(r'<pre data-language="', html))
    print("导出产物里的代码块：%d 个" % exported)
    print()

    if before is not None and after is not None and after <= before and before <= 1:
        print("判断：页面里本来就只有极少 pre —— 代码块内容没有渲染进 DOM。")
        print("      滚动也触发不了，说明这些代码块需要别的方式才能挂载（或需要先点开）。")
    elif after is not None and after > max(exported, 0) + 2:
        print("判断：页面里有 %d 个 pre，但只导出了 %d 个 —— 序列化阶段漏抓。" % (after, exported))
        print("      把这份文件和上面的 sampleShell 发出来，可以定位到具体选择器。")
    elif exported < (t.get("copyBtn", 0) or 0):
        print("判断：复制按钮有 %d 个，但只导出 %d 个代码块 —— 大部分代码块没有 pre。" % (t.get("copyBtn", 0), exported))
    else:
        print("判断：未发现明显缺失。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
