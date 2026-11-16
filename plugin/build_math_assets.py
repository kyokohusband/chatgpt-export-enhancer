"""Build self-contained KaTeX assets from the pinned official npm archive."""
import base64
from pathlib import Path
import re
import tarfile

ROOT = Path(__file__).resolve().parent
ARCHIVE = ROOT / "vendor_src" / "katex-0.19.1.tgz"
OUT = ROOT / "extension" / "assets"


def main() -> None:
    with tarfile.open(ARCHIVE) as package:
        def read(name: str) -> bytes:
            member = package.extractfile("package/" + name)
            if member is None:
                raise FileNotFoundError(name)
            return member.read()

        js = read("dist/katex.min.js")
        license_text = read("LICENSE")
        css = read("dist/katex.min.css").decode("utf-8")

        def font(match: re.Match[str]) -> str:
            raw = read("dist/fonts/" + match.group(1))
            encoded = base64.b64encode(raw).decode("ascii")
            return f'url(data:font/woff2;base64,{encoded}) format("woff2")'

        css, count = re.subn(
            r'url\(fonts/([A-Za-z0-9_-]+\.woff2)\) format\("woff2"\)(?:,url\(fonts/[^)]*\) format\("woff"\),url\(fonts/[^)]*\) format\("truetype"\))?',
            font,
            css,
        )
        if count < 20 or "url(fonts/" in css:
            raise ValueError("KaTeX font URLs were not fully embedded")

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "katex.js").write_bytes(js)
    (OUT / "katex.LICENSE").write_bytes(license_text)
    (OUT / "katex.css").write_text(css, encoding="utf-8")
    print("KaTeX assets ready:", count, "embedded WOFF2 fonts")


if __name__ == "__main__":
    main()
