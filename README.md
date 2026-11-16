# 会话导出增强器

把 ChatGPT 对话导出为**可离线交互的 HTML**，也支持 Markdown / JSON / 纯文本。核心思路是走 ChatGPT 官方接口拿原始 Markdown（代码块不会因页面懒渲染而丢失），再用内置的 Python 引擎转换成与桌面端一致的交互式页面。

项目由三部分组成：

| 部分 | 位置 | 说明 |
| --- | --- | --- |
| Chrome 扩展 | `plugin/extension/` | MV3，版本 `1.3.20`，直接加载该目录即可 |
| 桌面端 | `desktop/` | Python 转换器与启动脚本 |
| 油猴脚本 | 根目录 `*.user.js` | 图片开大图、GPT Master 输入框修复 |

## 功能

- 整段会话或勾选消息导出，格式支持 HTML / Markdown / JSON / 纯文本
- 代码块、公式（KaTeX 离线字体）、Mermaid 图、widget 卡片在离线页里保留交互
- 支持从 ChatGPT 后端接口返回的 DSL 组件（Entity / Link / AsyncImage 等叶子标签）
- 交互式面板：Alt+Shift+E 打开 / 收起

## 安装与使用

### Chrome 扩展

1. 打开 `chrome://extensions`，开启「开发者模式」。
2. 点「加载已解压的扩展程序」，选择 `plugin/extension/` 目录。
3. 在 chatgpt.com 页面按 `Alt+Shift+E` 打开导出面板。

### 桌面端

```bat
desktop\启动导出增强器.bat
```

首次运行需要 Python 环境及依赖。`desktop/app/settings.json` 里的 `watch_dir` 是监听目录占位符：

```json
"watch_dir": "<YOUR_WATCH_DIR>"
```

使用前改成你自己的目录；不需要监听可以保持 `watch_enabled: false`。

## 开发与构建

源码与生成文件的关系见 [`plugin/README.md`](plugin/README.md)。修改运行时、转换器或公式资源后，在项目根目录运行：

```powershell
python plugin/build_extension_assets.py
```

该命令会生成桌面端内嵌运行时，并同步插件的 Python、JS 和公式资源。

### 测试

```powershell
cd plugin/tests
npm test
```

测试依赖 `playwright-core` 与本机 Chromium，浏览器路径可通过 `CHROME_PATH` 指定。部分用例依赖用户导出的 HTML 样本，单独运行时需传入对应文件路径。

## 油猴脚本

| 文件 | 用途 |
| --- | --- |
| `ChatGPT-image-open.user.js` | 点击 ChatGPT 图片在新标签页打开原图（含缩略图地址升级与真实性校验） |
| `GPT-Master-composer-fix.user.js` | 修复 GPT Master 样式冲突导致的输入框隐藏 |

## 说明

- `plugin/extension/vendor/pyodide/` 是扩展内置 Python 引擎所需的固定版本依赖，`assets/katex.js` 与 `mermaid.js` 是离线渲染资源，均为构建产物但运行时必需，因此随源码一起提供。
- `plugin/tests/fixtures/` 中的对话与 token 均为 mock 数据，不含真实账号信息。
- 本机 Python 虚拟环境、pip 缓存、导出成品和个人笔记未包含在仓库中。
- 本项目采用 MIT 许可证，详见 [LICENSE](LICENSE)。内置的 KaTeX、Mermaid、highlight.js、Lucide、Pyodide 等第三方资源许可见各自目录下的 LICENSE 文件。
