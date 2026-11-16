import os
import unittest
from unittest import mock

import main


class TestBrowserChoice(unittest.TestCase):
    def test_chrome_opens_file_with_spaces_and_chinese(self):
        path = os.path.abspath('\u6d4b\u8bd5 file.html')
        with mock.patch.object(main, 'find_chrome', return_value='chrome.exe'), \
                mock.patch.object(main.subprocess, 'Popen') as launch, \
                mock.patch.object(main.webbrowser, 'open') as default:
            self.assertTrue(main.open_result_in_browser(path))
        launch.assert_called_once_with(['chrome.exe', main.Path(path).resolve().as_uri()])
        default.assert_not_called()

    def test_fallback_when_chrome_fails(self):
        with mock.patch.object(main, 'find_chrome', return_value='chrome.exe'), \
                mock.patch.object(main.subprocess, 'Popen', side_effect=OSError), \
                mock.patch.object(main.webbrowser, 'open', return_value=True) as default:
            self.assertTrue(main.open_result_in_browser('example.html'))
        default.assert_called_once()


if __name__ == '__main__':
    unittest.main()
