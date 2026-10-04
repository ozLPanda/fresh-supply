"""Exercise switch failure paths without Nginx, systemd, or production paths."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


SWITCHER = Path(__file__).resolve().parents[1] / "ovoshi-help-switch-upstream"


class SwitchUpstreamTest(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.state = self.root / "active-slot"
        self.upstream = self.root / "upstreams.conf"
        self.state.write_text("blue\n")
        self.previous = "upstream ovoshi_help_backend { server 127.0.0.1:18092; }\n"
        self.upstream.write_text(self.previous)
        self.script = self.root / "switch-upstream"
        self.script.write_text(
            SWITCHER.read_text()
            .replace("/var/lib/ovoshi-help/active-slot", str(self.state))
            .replace("/etc/nginx/conf.d/ovoshi-help-upstreams.conf", str(self.upstream))
        )
        self.bin = self.root / "bin"
        self.bin.mkdir()
        mock = r'''#!/usr/bin/env python3
import json, os, pathlib, sys
root = pathlib.Path(os.environ["SWITCH_TEST_ROOT"])
command = pathlib.Path(sys.argv[0]).name
events = root / "events.jsonl"
previous = [json.loads(line) for line in events.read_text().splitlines()] if events.exists() else []
state = root / "active-slot"
upstream = root / "upstreams.conf"
with events.open("a") as output:
    output.write(json.dumps({"command": command, "slot": state.read_text() if state.exists() else None,
                             "upstream": upstream.read_text() if upstream.exists() else None}) + "\n")
if command == "nginx":
    sys.exit(1 if os.environ.get("FAIL_VALIDATION") == "1" else 0)
if command == "systemctl":
    calls = sum(event["command"] == "systemctl" for event in previous)
    fail = os.environ.get("FAIL_RELOAD", "")
    sys.exit(1 if fail == "all" or fail == "first" and calls == 0 else 0)
if command == "mv":
    if os.environ.get("FAIL_STATE_WRITE") == "1":
        sys.exit(1)
    os.execv("/bin/mv", ["/bin/mv", *sys.argv[1:]])
'''
        for command in ("nginx", "systemctl", "mv"):
            executable = self.bin / command
            executable.write_text(mock)
            executable.chmod(0o755)

    def run_switch(self, **settings):
        env = {
            **os.environ,
            "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
            "SWITCH_TEST_ROOT": str(self.root),
            **settings,
        }
        return subprocess.run(
            ["bash", str(self.script), "green"], env=env, capture_output=True, text=True
        )

    def events(self):
        return [json.loads(line) for line in (self.root / "events.jsonl").read_text().splitlines()]

    def test_success_publishes_state_only_after_reload(self):
        result = self.run_switch()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.state.read_text(), "green\n")
        self.assertIn("127.0.0.1:18094", self.upstream.read_text())
        self.assertIn("127.0.0.1:18095", self.upstream.read_text())
        self.assertEqual([event["command"] for event in self.events()], ["nginx", "systemctl", "mv"])
        self.assertTrue(all(event["slot"] == "blue\n" for event in self.events()))

    def test_validation_failure_restores_without_reload(self):
        result = self.run_switch(FAIL_VALIDATION="1")
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertEqual(self.state.read_text(), "blue\n")
        self.assertEqual(self.upstream.read_text(), self.previous)
        self.assertEqual([event["command"] for event in self.events()], ["nginx"])

    def test_validation_failure_removes_new_config_if_none_existed(self):
        self.upstream.unlink()
        result = self.run_switch(FAIL_VALIDATION="1")
        self.assertEqual(result.returncode, 1, result.stderr)
        self.assertFalse(self.upstream.exists())
        self.assertEqual(self.state.read_text(), "blue\n")

    def test_reload_failure_restores_and_signals_both_slots_must_survive(self):
        result = self.run_switch(FAIL_RELOAD="first")
        self.assertEqual(result.returncode, 75, result.stderr)
        self.assertEqual(self.state.read_text(), "blue\n")
        self.assertEqual(self.upstream.read_text(), self.previous)
        reloads = [event for event in self.events() if event["command"] == "systemctl"]
        self.assertEqual(len(reloads), 2)
        self.assertIn("127.0.0.1:18094", reloads[0]["upstream"])
        self.assertEqual(reloads[1]["upstream"], self.previous)
        self.assertTrue(all(event["slot"] == "blue\n" for event in self.events()))

    def test_failed_rollback_still_preserves_slot_state_and_signals_uncertainty(self):
        result = self.run_switch(FAIL_RELOAD="all")
        self.assertEqual(result.returncode, 75, result.stderr)
        self.assertEqual(self.state.read_text(), "blue\n")
        self.assertEqual(self.upstream.read_text(), self.previous)
        self.assertIn("rollback could not be confirmed", result.stderr)

    def test_state_write_failure_signals_uncertainty_after_successful_reload(self):
        result = self.run_switch(FAIL_STATE_WRITE="1")
        self.assertEqual(result.returncode, 75, result.stderr)
        self.assertEqual(self.state.read_text(), "blue\n")
        self.assertIn("127.0.0.1:18094", self.upstream.read_text())


if __name__ == "__main__":
    unittest.main()
