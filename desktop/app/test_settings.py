import json
import tempfile
import tkinter as tk
import unittest
from pathlib import Path
from unittest import mock

import main


class TestSettings(unittest.TestCase):
    def test_preferences_survive_restart_and_existing_files_are_not_rescanned(self):
        with tempfile.TemporaryDirectory() as directory:
            settings_path = Path(directory) / 'settings.json'
            existing = Path(directory) / 'existing.html'
            existing.write_text('existing', encoding='utf-8')
            with mock.patch.object(main, 'SETTINGS_PATH', settings_path), \
                    mock.patch.object(main.App, 'toggle_watch') as toggle, \
                    mock.patch.object(main.sys, 'argv', ['main.py']):
                root = tk.Tk()
                root.withdraw()
                app = main.App(root)
                app.auto_open.set(False)
                app.split_enabled.set(True)
                app.overwrite_enabled.set(False)
                app.watch_dir.set(directory)
                app.watch_enabled.set(True)
                root.destroy()

                root = tk.Tk()
                root.withdraw()
                restored = main.App(root)
                self.assertFalse(restored.auto_open.get())
                self.assertTrue(restored.split_enabled.get())
                self.assertFalse(restored.overwrite_enabled.get())
                self.assertTrue(restored.watch_enabled.get())
                self.assertEqual(restored.watch_dir.get(), directory)
                self.assertIn(str(existing), restored._seen)
                toggle.assert_called_once()
                root.destroy()

    def test_invalid_settings_fall_back_to_defaults(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'settings.json'
            path.write_text('{invalid', encoding='utf-8')
            self.assertEqual(main.load_settings(path), {})
            main.save_settings(path, {'watch_dir': '\u4e0b\u8f7d', 'auto_open': True})
            self.assertEqual(json.loads(path.read_text(encoding='utf-8'))['watch_dir'], '\u4e0b\u8f7d')


if __name__ == '__main__':
    unittest.main()
