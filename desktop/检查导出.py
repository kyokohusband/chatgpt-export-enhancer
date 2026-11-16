# -*- coding: utf-8 -*-
"""检查一份导出 HTML 的内容完整度。

用法：
    python 检查导出.py "D:\\下载\\会话导出\\xxx.html"

重点看两项：
  · 代码块数量 —— 和对话里实际的代码块数对不对得上
  · 孤儿语言标签 —— 出现 <p>Python</p> 这种独立段落，说明那块代码没抓到
"""
from __future__ import annotations

import re
import sys

LANG_WORDS = (
    "Python Bash Shell JavaScript TypeScript JS TS JSON YAML SQL HTML CSS Java C C++ C# Go Rust "
    "Ruby PHP Swift Kotlin Scala R MATLAB Lua Perl Dart PowerShell Dockerfile Makefile Nginx "
    "纯文本 文本 代码"
).split()
LANG_RE = "|".join(re.escape(w) for w in sorted(LANG_WORDS, key=len, reverse=True))


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

    body = html.split("<body", 1)[1] if "<body" in html else html

    def count(pattern: str) -> int:
        return len(re.findall(pattern, body, re.I))

    turns = count(r'<article class="turn\b')
    pres = count(r"<pre\b")
    langs = re.findall(r'data-language="([^"]*)"', body)
    orphans = count(r"<p>\s*(?:%s)\s*</p>" % LANG_RE)

    print("文件：%s" % path)
    print("大小：%.1f KB" % (len(html) / 1024))
    print("已内嵌运行时：%s" % ("是" if "wb-widget-data" in html else "否（静态 HTML）"))
    print()
    print("问答轮次        %4d" % turns)
    print("代码块 <pre>    %4d" % pres)
    print("表格 <table>    %4d" % count(r"<table\b"))
    print("图片 <img>      %4d" % count(r"<img\b"))
    print("标题 h1-h6      %4d" % count(r"<h[1-6]\b"))
    print("列表 ul/ol      %4d" % count(r"<ul\b|<ol\b"))
    print("引用 blockquote %4d" % count(r"<blockquote\b"))
    print()

    if langs:
        from collections import Counter

        dist = Counter(langs)
        print("代码块语言分布：")
        for name, n in dist.most_common():
            print("  %-12s %3d" % (name, n))
    print()

    problems = []
    if orphans:
        problems.append(
            "发现 %d 处「孤立的语言标签」（如 <p>Python</p>）——"
            "对应位置的代码块没有抓到。原因通常是页面懒渲染，导出前没滚到那段。" % orphans
        )
    if langs and langs.count("text") > len(langs) * 0.5:
        problems.append(
            "超过一半的代码块语言是 text（%d/%d），高亮不会生效。" % (langs.count("text"), len(langs))
        )
    if pres == 0 and orphans > 0:
        problems.append("一个代码块都没抓到，但存在语言标签——基本可以确定是懒渲染没触发。")

    if problems:
        print("⚠ 可能不完整：")
        for p in problems:
            print("  · " + p)
        print()
        print("处理办法：在对话页用鼠标滚轮从头滚到底，再导出一次；")
        print("新版插件（1.2.0+）导出时会自动逐屏滚动补齐，重新导出通常就没这个问题了。")
        return 1

    print("✓ 没有发现内容缺失的迹象")
    return 0


if __name__ == "__main__":
    sys.exit(main())
