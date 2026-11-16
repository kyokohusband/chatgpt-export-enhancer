# Conversation Export Enhancer

> Language: [English](README.en.md) · [中文](README.md)

Export ChatGPT conversations to **interactive HTML that works offline**. Markdown / JSON / plain text are also supported. The core idea is to fetch the original Markdown through ChatGPT's official endpoint (so code blocks are not lost to lazy rendering), then convert it with the built-in Python engine into the same interactive page as the desktop version.

The project has three parts:

| Part | Location | Notes |
| --- | --- | --- |
| Chrome extension | `plugin/extension/` | MV3, version `1.3.20`; load this directory directly |
| Desktop app | `desktop/` | Python converter and launcher |
| Userscripts | root `*.user.js` | Open ChatGPT images full-size; fix the GPT Master composer |

## Features

- Export the whole conversation or selected messages, as HTML / Markdown / JSON / plain text
- Code blocks, math (offline KaTeX fonts), Mermaid diagrams, and widget cards stay interactive in the offline page
- Handles DSL components returned by ChatGPT's backend (leaf tags such as Entity / Link / AsyncImage)
- Interactive panel: `Alt+Shift+E` to open / close

## Install and use

### Chrome extension

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select the `plugin/extension/` directory.
3. On chatgpt.com, press `Alt+Shift+E` to open the export panel.

### Desktop app

```bat
desktop\启动导出增强器.bat
```

Python and its dependencies are required on first run. `watch_dir` in `desktop/app/settings.json` is a placeholder for the directory to watch:

```json
"watch_dir": "<YOUR_WATCH_DIR>"
```

Replace it with your own directory before use, or leave `watch_enabled: false` if you do not need watching.

## Development and build

See [`plugin/README.md`](plugin/README.md) for how source files relate to generated ones. After changing the runtime, converter, or math assets, run this from the project root:

```powershell
python plugin/build_extension_assets.py
```

This regenerates the desktop embedded runtime and syncs the plugin's Python, JS, and math assets.

### Tests

```powershell
cd plugin/tests
npm test
```

Tests require `playwright-core` and a local Chromium; the browser path can be set with `CHROME_PATH`. Some cases rely on user-exported HTML samples and need the sample file path passed in when run individually.

## Userscripts

| File | Purpose |
| --- | --- |
| `ChatGPT-image-open.user.js` | Open ChatGPT images in a new tab at full size (with thumbnail URL upgrade and verification) |
| `GPT-Master-composer-fix.user.js` | Fix the composer hidden by GPT Master style conflicts |

## Notes

- `plugin/extension/vendor/pyodide/` holds the pinned dependencies for the embedded Python engine. `assets/katex.js` and `mermaid.js` are offline rendering assets. All are generated files but required at runtime, so they ship with the source.
- Conversations and tokens in `plugin/tests/fixtures/` are mock data and contain no real account information.
- The local Python virtual environment, pip cache, exported files, and personal notes are not included in this repository.
- MIT licensed. See [LICENSE](LICENSE). Bundled third-party resources (KaTeX, Mermaid, highlight.js, Lucide, Pyodide) keep their own licenses in their respective directories.
