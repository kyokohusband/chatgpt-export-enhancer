# -*- coding: utf-8 -*-
"""重构前后对比：同一批样本，输出是否等价。

用法：
    python baseline.py save   # 保存当前输出指纹
    python baseline.py check  # 对比
"""
import hashlib
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "app"))

import converter  # noqa: E402

SAMPLES = [
    r"D:\下载\制定有效计划-2026-10-26.html",
    r"D:\下载\快速阅读小说方法-2026-10-25.html",
]
BASE = os.path.join(HERE, ".baseline.json")


def snapshot() -> dict:
    out = {}
    for path in SAMPLES:
        if not os.path.exists(path):
            out[os.path.basename(path)] = {"missing": True}
            continue
        res = converter.prepare_file(path, allow_empty=True)
        doc = res.extra.get("doc", "")
        pages = converter.split_html(doc)
        out[os.path.basename(path)] = {
            "ok": res.ok,
            "widgets": res.widgets,
            "unresolved": res.audit.unresolved if res.audit else None,
            "doc_len": len(doc),
            "doc_md5": hashlib.md5(doc.encode("utf-8")).hexdigest(),
            "pages": len(pages),
            "page_lens": [len(p) for _, p in pages],
            "payload_md5": hashlib.md5(
                json.dumps(re.findall(r'wb-widget" data-w="(\d+)"', doc)).encode()
            ).hexdigest(),
        }
    return out


def main() -> None:
    mode = sys.argv[1] if len(sys.argv) > 1 else "check"
    snap = snapshot()
    if mode == "save":
        with open(BASE, "w", encoding="utf-8") as f:
            json.dump(snap, f, ensure_ascii=False, indent=1)
        print("已保存基线")
        for k, v in snap.items():
            print(" ", k, {kk: v[kk] for kk in ("widgets", "unresolved", "doc_len", "pages") if kk in v})
        return

    if not os.path.exists(BASE):
        print("没有基线，先跑 python baseline.py save")
        raise SystemExit(1)
    with open(BASE, encoding="utf-8") as f:
        old = json.load(f)
    bad = 0
    for k, v in snap.items():
        o = old.get(k, {})
        diff = {kk: (o.get(kk), v.get(kk)) for kk in v if o.get(kk) != v.get(kk)}
        if diff:
            bad += 1
            print("✗", k, diff)
        else:
            print("✓", k, "widgets=%s unresolved=%s" % (v.get("widgets"), v.get("unresolved")))
    raise SystemExit(1 if bad else 0)


if __name__ == "__main__":
    main()
