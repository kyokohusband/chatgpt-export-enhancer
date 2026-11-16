# 会话导出增强器插件

Chrome 扩展的可直接加载目录是 [`extension/`](extension/)。修改内容脚本、面板或设置页后，重新加载扩展即可。日常开发无需打包 ZIP。

## 源码与生成文件

- `extension/content/`、`extension/panel/`、`extension/popup/`、`extension/options/` 和 `extension/background.js` 是直接维护的扩展代码。
- `desktop/widget-runtime.js` 是交互组件的运行时源码。`desktop/app/converter.py`、`desktop/app/dslsyntax.py` 是 Python 转换源码。
- `extension/assets/runtime.js`、`extension/assets/converter.css`、`extension/assets/toc.js` 和 `extension/py/` 是从桌面版生成的，不要手改。
- `vendor_src/katex-0.19.1.tgz` 是固定版本的 KaTeX 源包。`extension/assets/katex.js`、`katex.css` 和许可文件由它生成；CSS 中包含离线字体。

改动运行时、转换器或公式资源后，在项目根目录运行：

```powershell
python plugin/build_extension_assets.py
```

此命令会生成桌面端内嵌运行时，并同步插件的 Python、JS 和公式资源。

## 验证

在 `plugin/tests/` 运行 `npm test`。测试依赖 `playwright-core` 和本机 Chromium；浏览器路径可通过 `CHROME_PATH` 指定。`widget-codeblock-regression.js` 与 `element-plus-regression.js` 使用用户导出样本，单独运行时需传入对应 HTML 文件路径。
