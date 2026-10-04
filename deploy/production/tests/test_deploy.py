"""Run real deployment control flow against isolated command doubles (Bash 4+)."""

import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


PRODUCTION = Path(__file__).resolve().parents[1]
TARGET = "b" * 40
CURRENT_TAG = TARGET[:12]


class DeployTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.bash = os.environ.get("DEPLOY_TEST_BASH", shutil.which("bash"))
        major = subprocess.check_output(
            [cls.bash, "-c", "printf '%s' \"${BASH_VERSINFO[0]}\""], text=True
        )
        if int(major) < 4:
            raise unittest.SkipTest("deploy.sh requires Bash 4+; run in Linux or set DEPLOY_TEST_BASH")

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.repo = self.root / "repo"
        scripts = self.repo / "deploy" / "production"
        scripts.mkdir(parents=True)
        self.script = scripts / "deploy.sh"
        self.bin = self.root / "bin"
        self.bin.mkdir()
        self.switcher = self.bin / "switch-upstream"
        self.script.write_text(
            (PRODUCTION / "deploy.sh").read_text()
            .replace("/opt/ovoshi-help-repo", str(self.repo))
            .replace("/usr/local/sbin/ovoshi-help-switch-upstream", str(self.switcher))
        )
        shutil.copy2(PRODUCTION / "build-image.sh", scripts / "build-image.sh")
        (scripts / "build-image.sh").chmod(0o755)
        (self.root / "active-slot").write_text("blue")
        mock = r'''#!/usr/bin/env python3
import json, os, pathlib, subprocess, sys
root = pathlib.Path(os.environ["DEPLOY_TEST_ROOT"])
command, args = pathlib.Path(sys.argv[0]).name, sys.argv[1:]
with (root / "events.jsonl").open("a") as output:
    output.write(json.dumps({"command": command, "args": args}) + "\n")
if command == "sudo":
    sys.exit(subprocess.run(args).returncode)
if command == "sleep":
    sys.exit(0)
if command == "switch-upstream":
    state = root / "active-slot"
    if args == ["status"]:
        print(state.read_text())
    elif os.environ.get("FAIL_SWITCH") == "75":
        sys.exit(75)
    else:
        state.write_text(args[0])
    sys.exit(0)
if command == "git":
    if args[:1] == ["rev-parse"]:
        print("a" * 40)
    elif args[:1] == ["diff"]:
        print(os.environ.get("CHANGED_FILES", "backend/src/main/java/Changed.java\nfrontend/src/Changed.tsx"))
    elif args[0] not in ("fetch", "cat-file", "merge-base", "checkout"):
        sys.exit(90)
    sys.exit(0)
if command == "docker":
    if args[:2] == ["buildx", "version"]:
        print("buildx test")
    elif args[:2] == ["buildx", "inspect"]:
        print("Driver: docker-container")
    elif args[:2] == ["buildx", "build"]:
        sys.exit(1 if os.environ.get("FAIL_BUILD") == "1" else 0)
    elif args[0] == "compose":
        slot = args[args.index("-p") + 1].removeprefix("ovoshi-help-") if "-p" in args else "base"
        if "ps" in args:
            print(slot + "-" + args[-1])
        elif not any(action in args for action in ("config", "up", "rm", "stop", "logs")):
            sys.exit(90)
    elif args[0] == "inspect":
        if args[args.index("--format") + 1] == "{{.Config.Image}}":
            print("ovoshi-help-rollout-" + args[-1].split("-")[-1] + ":previous")
        else:
            print("exited" if os.environ.get("FAIL_HEALTH") == "1" else "healthy")
    elif args[0] == "ps":
        # After the old slot is removed, only new images remain container-referenced.
        for service in ("backend", "frontend"):
            print("ovoshi-help-rollout-" + service + ":" + "b" * 12)
    elif args[:2] == ["image", "ls"]:
        repository = args[2]
        dated = "CreatedAt" in args[-1]
        for tag, date in (("b" * 12, "2026-09-29"), ("previous", "2026-09-28"), ("obsolete", "2025-01-01")):
            print(repository + ":" + tag + ("|" + date if dated else ""))
    elif args[:2] != ["image", "rm"]:
        sys.exit(90)
    sys.exit(0)
sys.exit(90)
'''
        for command in ("docker", "git", "sudo", "sleep", "switch-upstream"):
            executable = self.bin / command
            executable.write_text(mock)
            executable.chmod(0o755)

    def run_deploy(self, **settings):
        return subprocess.run(
            [self.bash, str(self.script), TARGET],
            env={
                **os.environ,
                "PATH": str(self.bin) + os.pathsep + os.environ["PATH"],
                "DEPLOY_TEST_ROOT": str(self.root),
                "XDG_STATE_HOME": str(self.root / "state"),
                "FORCE_APPLICATION_REBUILD": "false",
                "DRAIN_SECONDS": "0",
                "HEALTH_WAIT_ATTEMPTS": "1",
                "HEALTH_WAIT_INTERVAL_SECONDS": "0",
                **settings,
            },
            capture_output=True,
            text=True,
            timeout=30,
        )

    def events(self):
        return [json.loads(line) for line in (self.root / "events.jsonl").read_text().splitlines()]

    def compose_actions(self, action):
        return [
            event for event in self.events()
            if event["command"] == "docker" and event["args"][0] == "compose" and action in event["args"]
        ]

    def switches(self):
        return [event for event in self.events() if event["command"] == "switch-upstream" and event["args"] != ["status"]]

    def test_build_tooling_only_does_not_build_or_restart_application(self):
        result = self.run_deploy(CHANGED_FILES="deploy/production/deploy.sh\ndeploy/production/build-image.sh\ndeploy/production/ovoshi-help-switch-upstream")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.compose_actions("up"), [])
        self.assertEqual(self.compose_actions("rm"), [])
        self.assertEqual(self.compose_actions("stop"), [])
        self.assertEqual(self.switches(), [])
        self.assertFalse(any(event["args"][:1] == ["buildx"] for event in self.events()))
        self.assertEqual((self.root / "active-slot").read_text(), "blue")

    def test_failed_build_never_starts_switches_or_prunes(self):
        result = self.run_deploy(FAIL_BUILD="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.compose_actions("up"), [])
        self.assertEqual(self.compose_actions("rm"), [])
        self.assertEqual(self.compose_actions("stop"), [])
        self.assertEqual(self.switches(), [])
        builds = [event for event in self.events() if event["args"][:2] == ["buildx", "build"]]
        self.assertEqual(len(builds), 1, result.stderr)
        self.assertFalse(any("prune" in event["args"] or "--no-cache" in event["args"] for event in self.events()))
        self.assertFalse(any(event["args"][:2] == ["image", "rm"] for event in self.events()))
        self.assertEqual((self.root / "active-slot").read_text(), "blue")

    def test_success_retains_previous_images_after_removing_previous_slot(self):
        result = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.root / "active-slot").read_text(), "green")
        self.assertEqual(len(self.compose_actions("up")), 1)
        self.assertIn("ovoshi-help-green", self.compose_actions("up")[0]["args"])
        self.assertEqual(len(self.compose_actions("stop")), 1)
        self.assertIn("ovoshi-help-blue", self.compose_actions("stop")[0]["args"])
        removed_images = [event["args"][-1] for event in self.events() if event["args"][:2] == ["image", "rm"]]
        self.assertCountEqual(removed_images, ["ovoshi-help-rollout-backend:obsolete", "ovoshi-help-rollout-frontend:obsolete"])
        history = (self.root / "state/ovoshi-help/rollout-image-history.env").read_text()
        for service in ("backend", "frontend"):
            self.assertIn("PREVIOUS_" + service.upper() + "_IMAGE=ovoshi-help-rollout-" + service + ":previous", history)
            self.assertIn("CURRENT_" + service.upper() + "_IMAGE=ovoshi-help-rollout-" + service + ":" + CURRENT_TAG, history)

    def test_uncertain_switch_preserves_both_slots(self):
        result = self.run_deploy(FAIL_SWITCH="75")
        self.assertEqual(result.returncode, 75, result.stderr)
        self.assertEqual(len(self.switches()), 1)
        self.assertEqual(self.compose_actions("stop"), [])
        # Only stale candidate cleanup before startup is allowed, never cleanup after cutover.
        removals = self.compose_actions("rm")
        self.assertEqual(len(removals), 1)
        self.assertIn("ovoshi-help-green", removals[0]["args"])
        events = self.events()
        self.assertLess(events.index(removals[0]), events.index(self.compose_actions("up")[0]))
        self.assertFalse(any(event["args"][:2] == ["image", "rm"] for event in events))
        self.assertEqual((self.root / "active-slot").read_text(), "blue")
        guard = self.root / "state/ovoshi-help/cutover-needs-reconciliation"
        self.assertTrue(guard.exists())
        before_retry = self.events()
        retry = self.run_deploy()
        self.assertEqual(retry.returncode, 75)
        self.assertEqual(self.events(), before_retry, "No command may run until cutover is reconciled")

    def test_failed_candidate_health_removes_only_candidate(self):
        result = self.run_deploy(FAIL_HEALTH="1")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.switches(), [])
        self.assertEqual(self.compose_actions("stop"), [])
        removals = self.compose_actions("rm")
        self.assertEqual(len(removals), 2, result.stderr)
        self.assertTrue(all("ovoshi-help-green" in event["args"] for event in removals))
        events = self.events()
        startup_index = events.index(self.compose_actions("up")[0])
        removal_indices = [index for index, event in enumerate(events) if event in removals]
        self.assertLess(removal_indices[0], startup_index)
        self.assertGreater(removal_indices[-1], startup_index)
        self.assertEqual((self.root / "active-slot").read_text(), "blue")


if __name__ == "__main__":
    unittest.main()
