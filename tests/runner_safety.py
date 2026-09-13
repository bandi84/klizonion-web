import tempfile
import unittest
import json
from pathlib import Path

from packages.agent.runner import execute_action


class RunnerSafetyTests(unittest.TestCase):
    def test_path_containment_and_unsupported_tools(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(ValueError):
                execute_action({"operation": "file.read", "payload": {"path": "../outside.txt"}}, root)
            preview = execute_action({"operation": "preview.status", "payload": {}}, root)
            self.assertFalse(preview["ok"])
            self.assertEqual(preview["status"], "unavailable")

    def test_allowlisted_command_returns_structured_result(self):
        with tempfile.TemporaryDirectory() as directory:
            result = execute_action({"operation": "git.status", "payload": {}}, Path(directory))
            self.assertIn("ok", result)
            self.assertIn("status", result)
            self.assertIn("durationMs", result)
            self.assertIn("output", result)

    def test_allowlisted_build_returns_real_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "package.json").write_text(json.dumps({"scripts": {"build": "node -e \"console.log('built')\""}}), encoding="utf-8")
            result = execute_action({"operation": "build.run", "payload": {}}, root)
            self.assertIn(result["status"], {"passed", "unavailable"})
            self.assertIn("durationMs", result)
            if result["status"] == "passed":
                self.assertIn("built", result["output"])


if __name__ == "__main__":
    unittest.main()
