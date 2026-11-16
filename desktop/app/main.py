# -*- coding: utf-8 -*-
"""导出增强器 —— 把 GPT Master / ChatGPT 导出的 HTML 转成可交互离线页。

带界面：拖放单文件 / 自动监视文件夹。
依赖：Python 3.9+，tkinter（标准库）。拖放功能需要可选依赖 tkinterdnd2。
"""
from __future__ import annotations

import os
import json
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import webbrowser
from pathlib import Path

import tkinter as tk
from tkinter import filedialog, messagebox, ttk

from converter import (
    already_converted,
    audit_html,
    convert_file,
    looks_like_export,
    prepare_file,
    split_html,
    write_split_pages,
)

try:  # 可选：拖放支持
    from tkinterdnd2 import DND_FILES, TkinterDnD

    HAS_DND = True
except Exception:  # pragma: no cover
    HAS_DND = False

# ---------------------------------------------------------------- 配色
BG = "#f3f6fb"
CARD = "#ffffff"
BORDER = "#e0e7f0"
TEXT = "#17243a"
MUTED = "#687990"
ACCENT = "#2563eb"
ACCENT_HOVER = "#1d4ed8"
OK = "#15803d"
WARN = "#b45309"
FONT = ("Microsoft YaHei UI", 10)
FONT_SM = ("Microsoft YaHei UI", 9)
FONT_TITLE = ("Microsoft YaHei UI", 15, "bold")
FONT_H2 = ("Microsoft YaHei UI", 10, "bold")
SETTINGS_PATH = Path(__file__).resolve().parent / "settings.json"


def load_settings(path: Path) -> dict:
    try:
        with path.open(encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def save_settings(path: Path, values: dict) -> None:
    temp_path = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=str(path.parent),
                                         prefix=".settings-", suffix=".tmp", delete=False) as f:
            temp_path = f.name
            json.dump(values, f, ensure_ascii=False, indent=2)
        os.replace(temp_path, path)
        temp_path = None
    finally:
        if temp_path is not None:
            try:
                os.unlink(temp_path)
            except OSError:
                pass


def find_chrome() -> str | None:
    """查找用户安装或系统安装的 Google Chrome。"""
    try:
        import winreg
        key_path = r"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe"
        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            try:
                with winreg.OpenKey(hive, key_path) as key:
                    path, _ = winreg.QueryValueEx(key, None)
                if os.path.isfile(path):
                    return path
            except OSError:
                continue
    except ImportError:
        pass
    for env in ("LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)"):
        base = os.environ.get(env)
        if base:
            path = os.path.join(base, "Google", "Chrome", "Application", "chrome.exe")
            if os.path.isfile(path):
                return path
    return shutil.which("chrome.exe")


def open_result_in_browser(path: str) -> bool:
    """优先用 Chrome 打开本地页面，找不到或启动失败时使用系统默认程序。"""
    uri = Path(path).resolve().as_uri()
    chrome = find_chrome()
    if chrome:
        try:
            subprocess.Popen([chrome, uri])
            return True
        except OSError:
            pass
    return webbrowser.open(uri)


def default_downloads_dir() -> str:
    """优先用 Chrome 实际配置的下载目录，其次系统「下载」文件夹。"""
    prefs = os.path.join(
        os.environ.get("LOCALAPPDATA", ""),
        "Google", "Chrome", "User Data", "Default", "Preferences",
    )
    try:
        with open(prefs, "r", encoding="utf-8") as f:
            data = json.load(f)
        d = data.get("download", {}).get("default_directory")
        if d and os.path.isdir(d):
            return d
    except Exception:
        pass

    try:
        import winreg

        key = winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders",
        )
        val, _ = winreg.QueryValueEx(key, "{374DE290-123F-4565-9164-39C4925E467B}")
        path = os.path.expandvars(val)
        if os.path.isdir(path):
            return path
    except Exception:
        pass

    guess = os.path.join(os.path.expanduser("~"), "Downloads")
    if os.path.isdir(guess):
        return guess
    return os.path.expanduser("~")



class App:
    def __init__(self, root: tk.Tk):
        self.root = root
        self.root.title("导出增强器")
        self.root.geometry("760x670")
        self.root.minsize(680, 630)
        self.root.configure(bg=BG)

        self.file: str | None = None
        self._seen: dict[str, float] = {}
        self._watching = False
        self._watch_thread: threading.Thread | None = None
        self._running = False
        self._suppress_auto_open_once = False
        self.last_output_dir: str | None = None

        settings = load_settings(SETTINGS_PATH)
        def saved_bool(name, default):
            value = settings.get(name, default)
            return value if isinstance(value, bool) else default
        saved_dir = settings.get("watch_dir")
        self.auto_open = tk.BooleanVar(value=saved_bool("auto_open", True))
        self.split_enabled = tk.BooleanVar(value=saved_bool("split_enabled", False))
        self.overwrite_enabled = tk.BooleanVar(value=saved_bool("overwrite_enabled", True))
        self.watch_enabled = tk.BooleanVar(value=saved_bool("watch_enabled", False))
        self.watch_dir = tk.StringVar(value=saved_dir if isinstance(saved_dir, str) and saved_dir else default_downloads_dir())

        self._build_styles()
        self._build_ui()
        self._install_dnd()

        if len(sys.argv) > 1:
            path = next((p for p in sys.argv[1:] if os.path.isfile(p)), None)
            if path:
                self._suppress_auto_open_once = True  # 拖到图标上时不抢浏览器焦点
                self.set_file(path)
                self.root.after(300, self.start_convert)

        for var in (self.auto_open, self.split_enabled, self.overwrite_enabled,
                    self.watch_enabled, self.watch_dir):
            var.trace_add("write", self._save_preferences)
        if self.watch_enabled.get():
            self._restore_watch()

    def _save_preferences(self, *_args):
        try:
            save_settings(SETTINGS_PATH, {
                "auto_open": self.auto_open.get(),
                "split_enabled": self.split_enabled.get(),
                "overwrite_enabled": self.overwrite_enabled.get(),
                "watch_enabled": self.watch_enabled.get(),
                "watch_dir": self.watch_dir.get(),
            })
        except OSError as e:
            self.log("设置保存失败：%s" % e)

    def _restore_watch(self):
        folder = self.watch_dir.get().strip()
        if not os.path.isdir(folder):
            self.watch_enabled.set(False)
            self.log("未恢复监视：文件夹不存在：%s" % folder)
            return
        try:
            with os.scandir(folder) as entries:
                for entry in entries:
                    if entry.name.lower().endswith((".html", ".htm")):
                        try:
                            self._seen[entry.path] = entry.stat().st_mtime
                        except OSError:
                            continue
        except OSError as e:
            self.watch_enabled.set(False)
            self.log("未恢复监视：%s" % e)
            return
        self.toggle_watch()

    # ------------------------------------------------------------ 样式
    def _build_styles(self):
        st = ttk.Style(self.root)
        try:
            st.theme_use("clam")
        except tk.TclError:
            pass
        st.configure(
            "Files.Treeview",
            background=CARD,
            fieldbackground=CARD,
            foreground=TEXT,
            rowheight=28,
            borderwidth=0,
            font=FONT_SM,
        )
        st.configure(
            "Files.Treeview.Heading",
            background="#fafbfc",
            foreground=MUTED,
            font=FONT_SM,
            relief="flat",
            borderwidth=0,
        )
        st.map("Files.Treeview", background=[("selected", "#e8f0fe")],
               foreground=[("selected", TEXT)])
        st.map("Files.Treeview.Heading", background=[("active", "#fafbfc")])
        st.configure(
            "Vertical.TScrollbar", background="#dfe3e8", troughcolor="#fafbfc",
            bordercolor="#fafbfc", arrowcolor=MUTED, borderwidth=0, arrowsize=10,
        )
        st.map("Vertical.TScrollbar", background=[("active", "#c9d0d8")])

    # ------------------------------------------------------------ 布局
    def _build_ui(self):
        outer = tk.Frame(self.root, bg=BG, padx=22, pady=18)
        outer.pack(fill="both", expand=True)

        head = tk.Frame(outer, bg=BG)
        head.pack(fill="x", pady=(0, 14))
        tk.Label(head, text="HTML  ·  离线处理", bg=BG, fg=ACCENT,
                 font=("Microsoft YaHei UI", 9, "bold")).pack(anchor="w")
        title_row = tk.Frame(head, bg=BG)
        title_row.pack(fill="x", pady=(4, 0))
        tk.Label(title_row, text="导出增强器", bg=BG, fg=TEXT,
                 font=FONT_TITLE).pack(side="left")
        tk.Label(title_row, text="本地处理", bg="#e6eefc", fg=ACCENT,
                 font=FONT_SM, padx=8, pady=3).pack(side="right")
        tk.Label(head, text="把导出的 HTML 变成可交互、可离线查看的页面",
                 bg=BG, fg=MUTED, font=FONT_SM).pack(anchor="w", pady=(4, 0))

        # 选择文件与当前状态合并在一张卡片中。
        self.drop = tk.Frame(outer, bg=CARD, highlightbackground=BORDER, highlightthickness=1)
        self.drop.pack(fill="x")
        file_top = tk.Frame(self.drop, bg=CARD, padx=16, pady=14)
        file_top.pack(fill="x")
        self._btn(file_top, "选择文件", self.pick_file, ghost=True).pack(side="right")
        self._btn(file_top, "清空", self.clear_files, ghost=True).pack(side="right", padx=(0, 6))
        self._btn(file_top, "打开输出目录", self.open_output_dir, ghost=True).pack(side="right", padx=(0, 6))
        tk.Label(file_top, text="添加 HTML 文件",
                 bg=CARD, fg=TEXT, font=FONT_H2).pack(anchor="w")
        tk.Label(file_top, text="选择或拖入一个文件" if HAS_DND else "选择一个文件开始转换",
                 bg=CARD, fg=MUTED, font=FONT_SM).pack(anchor="w", pady=(3, 0))

        file_body = tk.Frame(self.drop, bg=CARD, padx=16)
        file_body.pack(fill="x", pady=(0, 12))
        self.tree = ttk.Treeview(file_body, columns=("file", "status"), show="headings",
                                 style="Files.Treeview", height=1, selectmode="browse")
        self.tree.heading("file", text="当前文件", anchor="w")
        self.tree.heading("status", text="状态", anchor="w")
        self.tree.column("file", width=430, minwidth=220, anchor="w")
        self.tree.column("status", width=170, minwidth=120, anchor="w")
        self.tree.pack(fill="x")
        self.tree.tag_configure("ok", foreground=OK)
        self.tree.tag_configure("err", foreground="#b91c1c")
        self.tree.tag_configure("warn", foreground=WARN)
        self.tree.tag_configure("wait", foreground=MUTED)
        self._placeholder = self.tree.insert("", "end", values=("尚未选择文件", ""), tags=("wait",))

        settings_card = tk.Frame(outer, bg=CARD, highlightbackground=BORDER, highlightthickness=1,
                                 padx=16, pady=12)
        settings_card.pack(fill="x", pady=(10, 0))
        action_head = tk.Frame(settings_card, bg=CARD)
        action_head.pack(fill="x")
        tk.Label(action_head, text="转换设置", bg=CARD, fg=TEXT, font=FONT_H2).pack(side="left")
        self.convert_btn = self._btn(action_head, "开始转换", self.start_convert, primary=True)
        self.convert_btn.pack(side="right")
        settings_row = tk.Frame(settings_card, bg=CARD)
        settings_row.pack(fill="x", pady=(8, 2))
        for label, var in (("转换后打开", self.auto_open), ("按对话拆分", self.split_enabled),
                           ("覆盖原文件", self.overwrite_enabled)):
            tk.Checkbutton(settings_row, text=label, variable=var, bg=CARD, fg=TEXT,
                           font=FONT_SM, activebackground=CARD, selectcolor=CARD,
                           highlightthickness=0, bd=0).pack(side="left", padx=(0, 18))
        tk.Label(settings_card, text="拆分时可选段落并另存；其余结果默认保存在原文件旁。",
                 bg=CARD, fg=MUTED, font=FONT_SM).pack(anchor="w", pady=(3, 0))

        watch = tk.Frame(outer, bg=CARD, highlightbackground=BORDER, highlightthickness=1,
                         padx=16, pady=11)
        watch.pack(fill="x", pady=(10, 0))
        watch_head = tk.Frame(watch, bg=CARD)
        watch_head.pack(fill="x", pady=(0, 7))
        tk.Checkbutton(watch_head, text="自动监视文件夹", variable=self.watch_enabled,
                       command=self.toggle_watch, bg=CARD, fg=TEXT, font=FONT_H2,
                       activebackground=CARD, selectcolor=CARD, highlightthickness=0, bd=0).pack(side="left")
        tk.Label(watch_head, text="新导出的文件会自动转换", bg=CARD, fg=MUTED,
                 font=FONT_SM).pack(side="left", padx=(10, 0))
        watch_row = tk.Frame(watch, bg=CARD)
        watch_row.pack(fill="x")
        self._btn(watch_row, "选择目录", self.pick_watch_dir, ghost=True).pack(side="right", padx=(8, 0))
        self.watch_entry = tk.Entry(watch_row, textvariable=self.watch_dir, bg="#f8fafc",
                                    fg=TEXT, font=FONT_SM, relief="flat",
                                    highlightbackground=BORDER, highlightthickness=1)
        self.watch_entry.pack(side="left", fill="x", expand=True, ipady=5)

        logcard = tk.Frame(outer, bg=CARD, highlightbackground=BORDER, highlightthickness=1)
        logcard.pack(fill="both", expand=True, pady=(10, 0))
        log_head = tk.Frame(logcard, bg=CARD, padx=16, pady=5)
        log_head.pack(fill="x")
        tk.Label(log_head, text="运行记录", bg=CARD, fg=TEXT, font=FONT_H2).pack(side="left")
        self.log_text = tk.Text(logcard, height=3, bg="#f8fafc", fg=TEXT,
                                font=("Consolas", 9), relief="flat", padx=10, pady=6,
                                wrap="word", state="disabled")
        self.log_text.pack(fill="both", expand=True, padx=12, pady=(0, 10))

    def _btn(self, parent, text, cmd, primary=False, ghost=False):
        if primary:
            bg, fg, active = ACCENT, "#ffffff", ACCENT_HOVER
        elif ghost:
            bg, fg, active = "#fbfcfd", TEXT, "#eef2f7"
        else:
            bg, fg, active = CARD, TEXT, "#f2f4f7"
        b = tk.Button(
            parent, text=text, command=cmd, bg=bg, fg=fg,
            activebackground=active, activeforeground=fg,
            font=FONT_SM, relief="flat", bd=0, padx=14, pady=6,
            cursor="hand2", highlightthickness=1,
            highlightbackground=BORDER if not primary else ACCENT,
        )
        return b

    # ------------------------------------------------------------ 拖放
    def _install_dnd(self):
        if not HAS_DND:
            return
        try:
            self.drop.drop_target_register(DND_FILES)
            self.drop.dnd_bind("<<Drop>>", self._on_drop)
        except Exception:
            pass

    def _on_drop(self, event):
        paths = self.root.tk.splitlist(event.data)
        valid = [p for p in paths if os.path.isfile(p) and p.lower().endswith((".html", ".htm"))]
        if len(valid) != 1:
            messagebox.showinfo("提示", "每次请拖入一个 HTML 文件")
        else:
            self.set_file(valid[0])

    # ------------------------------------------------------------ 文件
    def pick_file(self):
        path = filedialog.askopenfilename(
            title="选择导出的 HTML 文件", filetypes=[("HTML 文件", "*.html *.htm")]
        )
        if path:
            self.set_file(path)

    def _drop_placeholder(self):
        if getattr(self, "_placeholder", None) and self.tree.exists(self._placeholder):
            self.tree.delete(self._placeholder)
            self._placeholder = None

    def set_file(self, path):
        if self._running:
            return
        path = os.path.abspath(path)
        if not os.path.isfile(path) or not path.lower().endswith((".html", ".htm")):
            messagebox.showinfo("提示", "请选择一个 HTML 文件")
            return
        self.clear_files()
        self._drop_placeholder()
        self.file = path
        self.tree.insert("", "end", iid=path,
                         values=(os.path.basename(path), "等待转换"), tags=("wait",))
        self.log("已选择：%s" % path)

    def clear_files(self):
        if self._running:
            return
        self.file = None
        for iid in self.tree.get_children():
            self.tree.delete(iid)
        self._placeholder = self.tree.insert(
            "", "end",
            values=("还没有添加文件 —— 拖进来，或用右上角「选择文件」", ""),
            tags=("wait",),
        )

    def _set_status(self, path, text, tag):
        if self.tree.exists(path):
            name = os.path.basename(path)
            self.tree.item(path, values=(name, text), tags=(tag,))

    # ------------------------------------------------------------ 转换
    def start_convert(self):
        if self._running:
            return
        if not self.file:
            messagebox.showinfo("提示", "先选择要转换的 HTML 文件")
            return
        self._running = True
        self.convert_btn.config(state="disabled", text="转换中…")
        path = self.file
        auto_open = self.auto_open.get() and not self._suppress_auto_open_once
        self._suppress_auto_open_once = False
        if self.split_enabled.get():
            threading.Thread(target=self._prepare_split_worker,
                             args=(path, auto_open), daemon=True).start()
        else:
            threading.Thread(target=self._convert_worker,
                             args=(path, auto_open, self.overwrite_enabled.get()), daemon=True).start()

    @staticmethod
    def _audit_label(res):
        audit = res.audit
        if not audit:
            return "未验收"
        if audit.issues:
            return "需检查：" + "；".join(audit.issues)
        return "验收通过 · %d 组件 / %d 代码块" % (audit.widgets, audit.codeblocks)

    def _convert_worker(self, path, auto_open, overwrite):
        self.root.after(0, self._set_status, path, "转换中…", "wait")
        res = convert_file(path, dst=path if overwrite else None)
        self.root.after(0, self._finish_convert, path, res, auto_open)

    def _prepare_split_worker(self, path, auto_open):
        self.root.after(0, self._set_status, path, "分析段落中…", "wait")
        res = prepare_file(path)
        if res.ok and not res.skipped:
            pages = split_html(res.extra["doc"])
            if pages:
                audits = [audit_html(page) for _, page in pages]
                self.root.after(0, self._show_split_selector, path, pages, audits, auto_open)
                return
            res.message = "没找到对话轮次，无法拆分"
            res.ok = False
        self.root.after(0, self._finish_convert, path, res, False)

    def _show_split_selector(self, path, pages, audits, auto_open):
        self._set_status(path, "待选择 · %d 段" % len(pages), "wait")
        dialog = tk.Toplevel(self.root)
        dialog.title("选择要保存的对话段落")
        dialog.geometry("760x520")
        dialog.minsize(620, 380)
        dialog.configure(bg=BG)
        dialog.transient(self.root)
        dialog.grab_set()

        top = tk.Frame(dialog, bg=BG, padx=18, pady=16)
        top.pack(fill="x")
        tk.Label(top, text="选择要保存的段落", bg=BG, fg=TEXT,
                 font=FONT_TITLE).pack(anchor="w")
        tk.Label(top, text="默认全选；单击条目可切换。文件直接保存到选定目录。",
                 bg=BG, fg=MUTED, font=FONT_SM).pack(anchor="w", pady=(5, 0))
        list_frame = tk.Frame(dialog, bg=BG, padx=18)
        list_frame.pack(fill="both", expand=True)
        listbox = tk.Listbox(list_frame, selectmode=tk.MULTIPLE, exportselection=False,
                             bg=CARD, fg=TEXT, selectbackground="#dbeafe",
                             selectforeground=TEXT, font=FONT_SM, activestyle="none")
        scrollbar = ttk.Scrollbar(list_frame, orient="vertical", command=listbox.yview)
        listbox.configure(yscrollcommand=scrollbar.set)
        listbox.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")
        for index, (title, _) in enumerate(pages):
            audit = audits[index]
            flag = ("  ⚠ %d 处源码" % audit.unresolved if audit.unresolved else
                    "  ⚠ 需检查" if audit.issues else "")
            listbox.insert("end", "%02d. %s%s" % (index + 1, title, flag))
        listbox.selection_set(0, "end")

        bottom = tk.Frame(dialog, bg=BG, padx=18, pady=12)
        bottom.pack(fill="x")
        count_label = tk.Label(bottom, bg=BG, fg=MUTED, font=FONT_SM)
        count_label.pack(anchor="w")
        def update_count(_event=None):
            count_label.config(text="已选 %d / %d 段" % (len(listbox.curselection()), len(pages)))
        listbox.bind("<<ListboxSelect>>", update_count)
        update_count()

        destination = {"root": os.path.dirname(path)}
        dest_label = tk.Label(bottom, text="保存到：" + destination["root"],
                              bg=BG, fg=MUTED, font=FONT_SM, anchor="w")
        dest_label.pack(fill="x", pady=(8, 10))
        buttons = tk.Frame(bottom, bg=BG)
        buttons.pack(fill="x")
        self._btn(buttons, "全选", lambda: (listbox.selection_set(0, "end"), update_count()),
                  ghost=True).pack(side="left")
        self._btn(buttons, "全不选", lambda: (listbox.selection_clear(0, "end"), update_count()),
                  ghost=True).pack(side="left", padx=(6, 0))
        def choose_dir():
            chosen = filedialog.askdirectory(parent=dialog, title="选择拆分文件保存位置")
            if chosen:
                destination["root"] = chosen
                dest_label.config(text="保存到：" + chosen)
        self._btn(buttons, "更改保存位置", choose_dir, ghost=True).pack(side="left", padx=(12, 0))

        def cancel():
            dialog.grab_release()
            dialog.destroy()
            self._running = False
            self.convert_btn.config(state="normal", text="开始转换")
            self.log("已取消拆分保存")

        def save():
            selected = listbox.curselection()
            if not selected:
                messagebox.showinfo("提示", "请至少选择一段", parent=dialog)
                return
            dialog.grab_release()
            dialog.destroy()
            threading.Thread(target=self._write_selected_worker,
                             args=(path, pages, list(selected), destination["root"], auto_open),
                             daemon=True).start()

        self._btn(buttons, "取消", cancel, ghost=True).pack(side="right")
        self._btn(buttons, "保存选中段落", save, primary=True).pack(side="right", padx=(0, 8))
        dialog.protocol("WM_DELETE_WINDOW", cancel)

    def _write_selected_worker(self, path, pages, indices, outdir, auto_open):
        res = write_split_pages(path, pages, indices, outdir)
        self.root.after(0, self._finish_convert, path, res, auto_open)

    def _finish_convert(self, path, res, auto_open):
        self._running = False
        self.convert_btn.config(state="normal", text="开始转换")
        if res.ok and not res.skipped:
            warning = bool(res.audit and res.audit.issues)
            self._set_status(path, "需检查导出结果" if warning else "成功 · " + res.message,
                             "warn" if warning else "ok")
            target = res.outputs[0] if res.outputs else res.output
            self.log("%s %s → %s（%s）" % ("!" if warning else "✓", res.message,
                                           res.output, self._audit_label(res)))
            self.last_output_dir = os.path.dirname(target)
        elif res.skipped:
            self._set_status(path, "已转换过，跳过", "wait")
            self.log("· 文件已是可交互版，跳过")
            return
        else:
            self._set_status(path, "失败：" + res.message, "err")
            self.log("✗ " + res.message)
            return
        if auto_open:
            try:
                open_result_in_browser(target)
            except Exception:
                pass

    def open_output_dir(self):
        if not self.file and not self.last_output_dir:
            return
        d = self.last_output_dir or os.path.dirname(self.file)
        try:
            os.startfile(d)  # type: ignore[attr-defined]
        except Exception:
            webbrowser.open("file:///" + d.replace("\\", "/"))

    # ------------------------------------------------------------ 自动监视
    def pick_watch_dir(self):
        d = filedialog.askdirectory(title="选择要监视的文件夹", initialdir=self.watch_dir.get())
        if d:
            self.watch_dir.set(d)

    def toggle_watch(self):
        if self.watch_enabled.get():
            d = self.watch_dir.get().strip()
            if not os.path.isdir(d):
                messagebox.showwarning("提示", "文件夹不存在：%s" % d)
                self.watch_enabled.set(False)
                return
            self._watching = True
            self.watch_entry.config(state="disabled")
            self.log("开始监视：%s（新导出的文件会自动转换）" % d)
            self._watch_thread = threading.Thread(target=self._watch_loop, daemon=True)
            self._watch_thread.start()
        else:
            self._watching = False
            self.watch_entry.config(state="normal")
            self.log("已停止监视")

    def _watch_loop(self):
        while self._watching:
            try:
                self._scan_once()
            except Exception:
                self.root.after(0, self.log, "监视出错：" + traceback.format_exc(limit=1))
            for _ in range(20):  # 约 2 秒
                if not self._watching:
                    return
                time.sleep(0.1)

    def _scan_once(self):
        folder = self.watch_dir.get().strip()
        if not os.path.isdir(folder):
            return
        now = time.time()
        for name in os.listdir(folder):
            if not name.lower().endswith((".html", ".htm")):
                continue
            if name.endswith("-可交互.html"):
                continue
            path = os.path.join(folder, name)
            try:
                mtime = os.path.getmtime(path)
            except OSError:
                continue
            if now - mtime < 2:  # 可能还在写入
                continue
            if self._seen.get(path) == mtime:
                continue

            try:
                with open(path, "r", encoding="utf-8", errors="replace") as f:
                    head = f.read()
            except OSError:
                continue

            if already_converted(head) or not looks_like_export(head):
                self._seen[path] = mtime
                continue

            self._seen[path] = mtime
            self.root.after(0, self.log, "发现新导出：%s，正在转换…" % name)
            split = self.split_enabled.get()
            res = convert_file(path, dst=path if self.overwrite_enabled.get() and not split else None,
                               split=split)
            if res.ok and not res.skipped:
                warning = bool(res.audit and res.audit.issues)
                if res.parts:
                    self.root.after(0, self.log, "%s 已拆成 %d 个文件，保存于 %s（%s）" % (
                        "!" if warning else "✓", res.parts, res.output,
                        self._audit_label(res)))
                else:
                    self.root.after(0, self.log, "%s 已生成 %s（%s）" % (
                        "!" if warning else "✓", os.path.basename(res.output),
                        self._audit_label(res)))
                if self.auto_open.get():
                    target = res.outputs[0] if res.outputs else res.output
                    self.root.after(0, open_result_in_browser, target)
            else:
                self.root.after(0, self.log, "✗ %s：%s" % (name, res.message))

    # ------------------------------------------------------------ 日志
    def log(self, msg: str):
        stamp = time.strftime("%H:%M:%S")
        self.log_text.config(state="normal")
        self.log_text.insert("end", "[%s] %s\n" % (stamp, msg))
        self.log_text.see("end")
        self.log_text.config(state="disabled")


def main():
    if HAS_DND:
        root = TkinterDnD.Tk()
    else:
        root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
