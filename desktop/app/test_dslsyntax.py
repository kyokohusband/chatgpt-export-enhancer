# -*- coding: utf-8 -*-
"""dslsyntax / converter 的回归用例。

跑法（在项目根目录）：
    python -m unittest discover -s app -p "test_*.py" -v
    python -m unittest app.test_dslsyntax -v     # 若 app 是包
最省事：python app/test_dslsyntax.py

每个用例都对应一个真实踩过的坑，别删。
"""
import os
import sys
import tempfile
import unittest
from unittest import mock

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import dslsyntax as S  # noqa: E402
import converter  # noqa: E402


class TestTagBalance(unittest.TestCase):
    def test_arrow_function_in_attribute_is_not_a_tag_end(self):
        """属性里的 `v=>...` 曾让自闭合标签被当成开标签，组件永远算不平。"""
        src = '<checkbox checked={done[i]} onChange={v=>setDone(a=>a.map((x,j)=>i===j?v:x))}/>'
        self.assertEqual(S.count(src), (0, 0, 1))
        self.assertEqual(S.balance(src), 0)

    def test_arrow_function_inside_open_tag(self):
        src = ('<button onClick={()=>GenUI.copy(`a${g}b`)}>'
               '文字</button>')
        self.assertEqual(S.balance(src), 0)

    def test_nested_boxes_balance(self):
        src = '<box gap={3}><row><box size="40px"><icon name="target"/></box><box flex="1">hi</box></row></box>'
        self.assertEqual(S.balance(src), 0)

    def test_unclosed_box_reports_positive(self):
        self.assertEqual(S.balance('<box><row><text>hi</text>'), 2)

    def test_plain_html_tags_are_ignored(self):
        src = '<p><strong>加粗</strong><ul><li>a</li></ul></p>'
        self.assertEqual(S.count(src), (0, 0, 0))

    def test_void_tag_kept_open_is_not_counted_as_stack(self):
        self.assertIn('</box>', S.closing_tail('<box><input value={x}>'))


class TestClosingTail(unittest.TestCase):
    def test_fills_missing_close_tags_in_reverse(self):
        tail = S.closing_tail('<box><grid><grid-item>')
        self.assertEqual(tail, '</grid-item></grid></box>')

    def test_fills_missing_directives(self):
        self.assertEqual(S.closing_tail('{#if a}{#each b as x}'), '{/each}{/if}')

    def test_nothing_to_close(self):
        self.assertEqual(S.closing_tail('<box><text>ok</text></box>'), '')

    def test_mismatched_close_pops_nearest(self):
        # </row> 只应弹掉最近的 row，box 仍留在栈里
        self.assertEqual(S.closing_tail('<box><row></row>'), '</box>')


class TestDirectives(unittest.TestCase):
    def test_else_if_does_not_change_nesting(self):
        src = '{#if a}x{:else if b}y{:else}z{/if}'
        self.assertEqual(S.directive_balance(src), 0)

    def test_is_balanced_requires_both(self):
        self.assertTrue(S.is_balanced('{#each xs as x}<text>{x}</text>{/each}'))
        self.assertFalse(S.is_balanced('{#if a}<box>'))


class TestStartAndEscaped(unittest.TestCase):
    def test_start_matches_component_heads(self):
        for src in ('<box gap={3}>', '  <grid columns={2}>', '{@body const [a,b]=DIL.useState(0)}',
                    '{#each xs as x}'):
            self.assertTrue(S.start_re().match(src), src)

    def test_start_ignores_prose_and_closers(self):
        for src in ('这是一段正文', '</box>', '<strong>粗体</strong>'):
            self.assertFalse(S.start_re().match(src), src)

    def test_escaped_re_matches_both_directions(self):
        for src in ('&lt;box gap={3}&gt;', '&lt;/box&gt;', '&lt; grid-item&gt;'):
            self.assertTrue(S.escaped_re().search(src), src)

    def test_escaped_re_ignores_html(self):
        self.assertFalse(S.escaped_re().search('<strong>粗</strong>'))


class TestBraceSpans(unittest.TestCase):
    def test_nested_braces(self):
        src = 'a{ f({x:1}) }b'
        spans = list(S.brace_spans(src))
        self.assertEqual(len(spans), 1)
        self.assertEqual(src[spans[0][0]:spans[0][1]], '{ f({x:1}) }')

    def test_skips_braces_inside_strings(self):
        src = '{ "}" }'
        spans = list(S.brace_spans(src))
        self.assertEqual(src[spans[0][0]:spans[0][1]], '{ "}" }')


def _mini_export(body: str) -> str:
    return (
        '<!doctype html><html><head><meta charset="utf-8"/>'
        '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"/>'
        '</head><body><div class="wrap">'
        '<div class="banner">Save as PDF</div>'
        '<h1 class="doc-title">测试</h1>'
        '<article class="turn user"><div class="role">User</div>'
        '<div class="body" dir="auto"><p>测试提问</p></div></article>'
        '<article class="turn assistant"><div class="role">Assistant</div>'
        '<div class="body" dir="auto">' + body + '</div></article>'
        '<div class="footer">Exported from ChatGPT</div>'
        '</div></body></html>'
    )


class TestConverterEndToEnd(unittest.TestCase):
    def test_existing_page_gets_updated_multilevel_toc(self):
        old_toc = '<script>\n(function(){\n  function clean(t){ return t; }\n})();\n</script>'
        doc = _mini_export('<h3>标题</h3><h4>章节</h4><h5>小节</h5><h6>细节</h6>')
        doc = doc.replace('</body>', '<script id="wb-widget-data" type="application/json">[]</script><script>\nold_runtime();\n</script>' + old_toc + '</body>')
        result = converter.convert_html(doc)
        self.assertTrue(result.ok)
        self.assertFalse(result.skipped)
        self.assertIn('id="wb-toc-script"', result.extra['doc'])
        self.assertIn("querySelectorAll('h1, h2, h3, h4, h5, h6')", result.extra['doc'])
        self.assertTrue(converter.convert_html(result.extra['doc']).skipped)

    def test_list_inline_title_example_does_not_become_live_html(self):
        body = ('<ul><li><code>&lt;title&gt;</code>：网页标题</li>'
                '<li><code>&lt;body&gt;</code>：网页正文</li></ul><p>后续内容</p>')
        result = converter.convert_html(_mini_export(body), allow_empty=True)
        self.assertTrue(result.ok)
        self.assertIn('<li><code>&lt;title&gt;</code>', result.extra['doc'])
        self.assertIn('<li><code>&lt;body&gt;</code>', result.extra['doc'])
        self.assertIn('<p>后续内容</p>', result.extra['doc'])

    def test_list_spill_preserves_escaped_inline_examples(self):
        source = '<ul><li><code>&lt;title&gt;</code> &lt;text&gt;说明&lt;/text&gt;</li></ul>'
        repaired = converter._repair_list_spill(source)
        self.assertIn('<code>&lt;title&gt;</code>', repaired)
        self.assertIn('&lt;text&gt;', repaired)

    def test_existing_page_repairs_raw_title_inside_inline_code(self):
        body = '<p><code><title></code>：网页标题</p><p>后续内容</p>'
        doc = _mini_export(body).replace('</body>', '<script id="wb-widget-data" type="application/json">[]</script></body>')
        result = converter.convert_html(doc)
        self.assertTrue(result.ok)
        self.assertFalse(result.skipped)
        self.assertIn('<code>&lt;title&gt;</code>', result.extra['doc'])
        self.assertIn('<p>后续内容</p>', result.extra['doc'])

    def test_offline_icon_library_is_included_in_runtime(self):
        runtime = converter.runtime_source()
        self.assertIn('var WB_LUCIDE_ICONS=', runtime)
        for name in ('bell', 'layout-dashboard', 'settings', 'user', 'users', 'cable', 'file-text'):
            self.assertIn('"' + name + '":', runtime)
        self.assertIn("case 'spacer':", runtime)

    def test_existing_page_runtime_is_updated_without_losing_payload(self):
        doc = _mini_export('<div class="wb-widget" data-w="0"></div>')
        old = '<script id="wb-widget-data" type="application/json">["&lt;box&gt;"]</script>\n<script>\nold_runtime();\n</script>'
        doc = doc.replace('</body>', old + '</body>')
        result = converter.convert_html(doc)
        self.assertTrue(result.ok)
        self.assertFalse(result.skipped)
        self.assertIn('["&lt;box&gt;"]', result.extra['doc'])
        self.assertIn('function extractBodies', result.extra['doc'])
        self.assertNotIn('old_runtime();', result.extra['doc'])
        self.assertTrue(converter.convert_html(result.extra['doc']).skipped)

    def test_flat_vue_code_indentation_is_restored(self):
        code = ('<template>\n<el-card>\n<el-empty\nv-if="empty"\n/>\n'
                '<div>{{ name }}</div>\n</el-card>\n</template>\n'
                '<script setup>\nconst rows = ref([\n{ id: 1 },\n])\n'
                'function refresh() {\nreturn rows.value\n}\n</script>')
        restored = converter._indent_flat_vue(code)
        self.assertIn('  <el-card>\n    <el-empty\n      v-if="empty"\n    />', restored)
        self.assertIn('const rows = ref([\n  { id: 1 },\n])', restored)
        self.assertIn('function refresh() {\n  return rows.value\n}', restored)
        self.assertEqual([x.strip() for x in restored.splitlines()], code.splitlines())
        existing = code.replace('<el-card>', '  <el-card>')
        self.assertEqual(converter._indent_flat_vue(existing), existing)
        unsafe = code.replace('const rows =', 'const text = `a\nb`\nconst rows =')
        self.assertEqual(converter._indent_flat_vue(unsafe), unsafe)

    def test_conversion_preserves_restored_vue_code(self):
        body = ('<pre data-language="vue"><code>&lt;template&gt;\n&lt;div&gt;Hi&lt;/div&gt;\n'
                '&lt;/template&gt;\n&lt;script setup&gt;\nconst x = 1\n&lt;/script&gt;</code></pre>')
        result = converter.convert_html(_mini_export(body))
        self.assertTrue(result.ok, result.message)
        self.assertIn('\n  &lt;div&gt;Hi&lt;/div&gt;\n', result.extra['doc'])

    def test_converted_document_can_repair_flat_code(self):
        body = ('<pre data-language="vue"><code>&lt;template&gt;\n&lt;div&gt;Hi&lt;/div&gt;\n'
                '&lt;/template&gt;\n&lt;script setup&gt;\nconst x = 1\n&lt;/script&gt;</code></pre>')
        doc = _mini_export(body).replace('</body>', '<script id="wb-widget-data" type="application/json">[]</script></body>')
        result = converter.convert_html(doc)
        self.assertTrue(result.ok)
        self.assertFalse(result.skipped)
        self.assertIn('\n  &lt;div&gt;Hi&lt;/div&gt;\n', result.extra['doc'])
        self.assertTrue(converter.convert_html(result.extra['doc']).skipped)

    def test_code_only_document_gets_copy_control(self):
        res = converter.convert_html(_mini_export('<pre><code>hello &amp; world</code></pre>'))
        self.assertTrue(res.ok, res.message)
        self.assertIn('wb-copy-code', res.extra['doc'])
        self.assertIn('hello &amp; world', res.extra['doc'])

    def test_overwrite_and_failed_replace_preserve_original(self):
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, 'export.html')
            original = _mini_export('<p>&lt;Link url="https://example.com" title="example"/&gt;</p>')
            with open(path, 'w', encoding='utf-8') as f:
                f.write(original)
            with mock.patch.object(converter.os, 'replace', side_effect=OSError('failed')):
                self.assertFalse(converter.convert_file(path, dst=path).ok)
            with open(path, encoding='utf-8') as f:
                self.assertEqual(f.read(), original)
            self.assertEqual(os.listdir(directory), ['export.html'])
            result = converter.convert_file(path, dst=path)
            self.assertTrue(result.ok, result.message)
            self.assertEqual(result.output, path)
            with open(path, encoding='utf-8') as f:
                self.assertIn('<a href="https://example.com">example</a>', f.read())

    def test_mermaid_codeblock_includes_offline_renderer(self):
        body = '<pre data-language="mermaid"><code>flowchart TD\n A--&gt;B</code></pre>'
        res = converter.convert_html(_mini_export(body))
        self.assertTrue(res.ok, res.message)
        self.assertIn('mermaid.initialize', res.extra['doc'])
        self.assertIn('flowchart TD', res.extra['doc'])
        self.assertGreater(len(res.extra['doc']), 1000000)

    def test_mermaid_class_and_non_mermaid_output(self):
        body = '<pre><code class="language-mermaid">graph LR\n A--&gt;B</code></pre>'
        self.assertIn('mermaid.initialize', converter.convert_html(_mini_export(body)).extra['doc'])
        plain = converter.convert_html(_mini_export('<p>正文</p>'), allow_empty=True).extra['doc']
        self.assertNotIn('mermaid.initialize', plain)

    def test_escaped_links_are_converted_without_widgets(self):
        body = ('<p>官方资料可以从 &lt;Link url="https://element-plus.org/zh-CN/component/overview.html" '
                'title="Element Plus 组件总览"/&gt; 和 '
                '&lt;Link title=&quot;快速开始&quot; url=&quot;https://element-plus.org/zh-CN/guide/quickstart.html&quot; /&gt; 查阅。</p>')
        res = converter.convert_html(_mini_export(body))
        self.assertTrue(res.ok, res.message)
        self.assertIn('<a href="https://element-plus.org/zh-CN/component/overview.html">Element Plus 组件总览</a>', res.extra['doc'])
        self.assertIn('<a href="https://element-plus.org/zh-CN/guide/quickstart.html">快速开始</a>', res.extra['doc'])

    def test_links_preserve_entities_and_leave_code_and_unsafe_urls(self):
        body = ('<p>&lt;Link url="https://example.com/?a=1&amp;b=2" title="A &amp; B"/&gt; '
                '&lt;Link url="javascript:alert(1)" title="bad"/&gt;</p>'
                '<pre><code>&lt;Link url="https://example.com" title="example"/&gt;</code></pre>')
        doc = converter.convert_html(_mini_export(body)).extra['doc']
        self.assertIn('<a href="https://example.com/?a=1&amp;b=2">A &amp; B</a>', doc)
        self.assertIn('&lt;Link url="javascript:alert(1)"', doc)
        self.assertIn('<code>&lt;Link url="https://example.com"', doc)

    def test_banner_and_footer_removed(self):
        doc = converter.convert_html(_mini_export('<p>正文</p>'), allow_empty=True).extra["doc"]
        self.assertNotIn('class="banner"', doc)
        self.assertNotIn('Exported from ChatGPT', doc)

    def test_component_split_by_paragraphs_is_merged(self):
        body = (
            '<p>&lt;box gap={2}&gt;'
            '&lt;row&gt;<strong>标题</strong>&lt;/row&gt;</p>'
            '<p>第一段说明'
            '&lt;/box&gt;</p>'
        )
        res = converter.convert_html(_mini_export(body))
        self.assertTrue(res.ok, res.message)
        self.assertEqual(res.widgets, 1)
        self.assertEqual(res.audit.unresolved, 0)

    def test_real_html_inside_component_is_not_a_cut_point(self):
        """<ul> 夹在组件中间曾把组件腰斩，只剩 {:else if} 露在正文里。"""
        body = (
            '<p>&lt;box gap={2}&gt;'
            '{#if stage===0}'
            '&lt;strong&gt;核心情节&lt;/strong&gt;</p>'
            '<ul><li>要点一</li><li>要点二</li></ul>'
            '<p><strong>小结：</strong> 收个尾'
            '{:else if stage===1}'
            '第二段'
            '{/if}'
            '&lt;/box&gt;</p>'
        )
        res = converter.convert_html(_mini_export(body))
        self.assertTrue(res.ok, res.message)
        self.assertEqual(res.widgets, 1)
        self.assertEqual(res.audit.unresolved, 0)

    def test_markdown_list_that_swallowed_component_tail(self):
        """组件闭合标签被塞进 <li> 后，要能捞回段落并补齐闭合。"""
        body = (
            '<p>&lt;box gap={2}&gt;'
            '&lt;box&gt;<strong>左</strong></p>'
            '<ul><li>甲</li><li>乙 说明 &lt;text size="xs"&gt;备注&lt;/text&gt; '
            '&lt;/box&gt; &lt;grid-item&gt;尾巴被吃掉&lt;/li><li>丙</li></ul>'
            '<p>&lt;/box&gt;</p>'
        )
        res = converter.convert_html(_mini_export(body))
        self.assertTrue(res.ok, res.message)
        self.assertEqual(res.audit.unresolved, 0)

    def test_template_literal_split_into_code_tags(self):
        """模板字符串被拆成 <code>A</code>B<code>C</code>，要拼回嵌套模板。"""
        body = (
            '<p>&lt;box&gt;'
            '&lt;button onClick={()=&gt;GenUI.copy(<code>目标：${goal}\\n${[main].map((v,i)=&gt;</code>'
            '${done[i]?"☑":"☐"} ${v}<code>).join("\\n")}</code>)}&gt;复制&lt;/button&gt;'
            '&lt;/box&gt;</p>'
        )
        res = converter.convert_html(_mini_export(body))
        self.assertTrue(res.ok, res.message)
        imports = res.extra["doc"]
        self.assertIn("`目标：${goal}", imports)          # 反引号已还原
        self.assertNotIn("<code>目标", imports)

    def test_each_expression_multiplication_not_markdown_emphasis(self):
        body = ('<p>&lt;box&gt;{#each users.slice((page-1)<em>2,page</em>2) as u}'
                '{u.name}{/each}&lt;/box&gt;</p>')
        result = converter.convert_html(_mini_export(body))
        self.assertTrue(result.ok, result.message)
        self.assertIn('users.slice((page-1)*2,page*2)', result.extra['doc'])

    def test_inline_code_in_prose_is_untouched(self):
        body = '<p>例如 <code>@Autowired</code> 的用法。</p>'
        doc = converter.convert_html(_mini_export(body), allow_empty=True).extra["doc"]
        self.assertIn("<code>@Autowired</code>", doc)

    def test_plain_text_file_returns_no_widget_but_still_converts(self):
        res = converter.convert_html(_mini_export('<p>只有文字</p>'), allow_empty=True)
        self.assertTrue(res.ok)
        self.assertEqual(res.widgets, 0)

    def test_split_keeps_widget_payload_consistent(self):
        body = ('<p>&lt;box&gt;<strong>一</strong>&lt;/box&gt;</p>'
                '<p>&lt;box&gt;<strong>二</strong>&lt;/box&gt;</p>')
        res = converter.convert_html(_mini_export(body))
        pages = converter.split_html(res.extra["doc"])
        self.assertEqual(len(pages), 1)
        _, page = pages[0]
        audit = converter.audit_html(page)
        self.assertEqual(audit.unresolved, 0)
        self.assertEqual(page.count('class="wb-widget"'), res.widgets)


if __name__ == "__main__":
    unittest.main(verbosity=2)
