# -*- coding: utf-8 -*-
"""生成扩展图标（纯标准库，无 Pillow 依赖）。

图形：圆角蓝底 + 向下箭头 + 托盘，4x 超采样做抗锯齿。
"""
from __future__ import annotations

import os
import struct
import zlib

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "extension", "icons")
SS = 4  # 超采样倍数

TOP = (59, 130, 246)
BOTTOM = (29, 78, 216)


def inside_bg(x: float, y: float, r: float = 0.225) -> bool:
    dx = max(r - x, 0.0, x - (1 - r))
    dy = max(r - y, 0.0, y - (1 - r))
    if dx > 0 and dy > 0:
        return dx * dx + dy * dy <= r * r
    return 0 <= x <= 1 and 0 <= y <= 1


def inside_glyph(x: float, y: float) -> bool:
    # 竖杆
    if 0.458 <= x <= 0.542 and 0.205 <= y <= 0.505:
        return True
    # 箭头
    if 0.445 <= y <= 0.635:
        t = (0.635 - y) / 0.155
        if abs(x - 0.5) <= 0.168 * min(t, 1.0):
            return True
    # 托盘两侧
    if 0.585 <= y <= 0.735 and (abs(x - 0.272) <= 0.034 or abs(x - 0.728) <= 0.034):
        return True
    # 托盘底
    if 0.700 <= y <= 0.769 and 0.238 <= x <= 0.762:
        return True
    return False


def blend(base, top, ratio):
    return tuple(int(round(a + (b - a) * ratio)) for a, b in zip(base, top))


def render(size: int) -> bytes:
    pixels = bytearray()
    inv = 1.0 / (size * SS)
    for py in range(size):
        pixels.append(0)  # filter type 0
        for px in range(size):
            cover_bg = 0
            cover_fg = 0
            for sy in range(SS):
                for sx in range(SS):
                    x = (px * SS + sx + 0.5) * inv
                    y = (py * SS + sy + 0.5) * inv
                    if inside_bg(x, y):
                        cover_bg += 1
                        if inside_glyph(x, y):
                            cover_fg += 1
            total = SS * SS
            a_bg = cover_bg / total
            if a_bg == 0:
                pixels.extend((0, 0, 0, 0))
                continue
            # 渐变按像素中心取色
            cx = (px + 0.5) / size
            cy = (py + 0.5) / size
            t = min(max((cx + cy) / 2.0, 0.0), 1.0)
            base = blend(TOP, BOTTOM, t)
            fg_ratio = (cover_fg / total) / a_bg if a_bg else 0
            r = int(round(base[0] + (255 - base[0]) * fg_ratio))
            g = int(round(base[1] + (255 - base[1]) * fg_ratio))
            b = int(round(base[2] + (255 - base[2]) * fg_ratio))
            pixels.extend((r, g, b, int(round(a_bg * 255))))
    return bytes(pixels)


def write_png(path: str, size: int, raw: bytes) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return (
            struct.pack(">I", len(data))
            + tag
            + data
            + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
        )

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    with open(path, "wb") as f:
        f.write(png)


def main() -> None:
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (16, 32, 48, 128):
        write_png(os.path.join(OUT_DIR, "icon%d.png" % size), size, render(size))
        print("wrote icon%d.png" % size)


if __name__ == "__main__":
    main()
