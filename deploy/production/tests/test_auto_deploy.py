"""The runner must execute a snapshot from the target commit, not checkout HEAD."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

RUNNER = Path(__file__).resolve().parents[1] / 'ovoshi-help-auto-deploy'
TARGET = 'a' * 40
OLD = 'b' * 40


class AutoDeployTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        self.state = self.root / 'state'
        self.state.mkdir()
        (self.state / 'deployed-revision').write_text(OLD + '\n')
        self.bin = self.root / 'bin'
        self.bin.mkdir()
        self.runner = self.root / 'runner'
        self.runner.write_text(RUNNER.read_text()
            .replace('/opt/ovoshi-help-repo', str(self.repo))
            .replace('/var/lib/ovoshi-help', str(self.state))
            .replace('/run/ovoshi-help-auto-deploy.lock', str(self.root / 'lock')))
        mock = r'''#!/usr/bin/env python3
import os, pathlib, sys
command = pathlib.Path(sys.argv[0]).name
if command == 'flock':
    sys.exit(0)
if command == 'runuser':
    args = sys.argv[sys.argv.index('--') + 1:]
    os.execvp(args[0], args)
if command == 'git':
    args = sys.argv[3:]
    if args[0] == 'fetch': sys.exit(0)
    if args == ['rev-parse', 'HEAD']: print('b' * 40)
    elif args == ['rev-parse', 'origin/main']: print('a' * 40)
    elif args == ['show', 'a' * 40 + ':deploy/production/deploy.sh']:
        print('printf "%s\\n" "$0" "$1" >"$SNAPSHOT_MARKER"')
        print(os.environ.get('DEPLOY_TEST_SCRIPT', ''))
        print('exit ' + os.environ.get('DEPLOY_EXIT', '0'))
    else: sys.exit(99)
'''
        for name in ['flock', 'runuser', 'git']:
            command = self.bin / name
            command.write_text(mock)
            command.chmod(0o755)
        # Executing the old checked-out script is a regression, even if it exists.
        old_script = self.repo / 'deploy/production/deploy.sh'
        old_script.parent.mkdir(parents=True)
        old_script.write_text('#!/bin/sh\nexit 99\n')
        old_script.chmod(0o755)
        self.marker = self.root / 'executed'

    def deploy_env(self, code='0', script=''):
        return {**os.environ,
            'PATH': str(self.bin) + os.pathsep + os.environ['PATH'],
            'SNAPSHOT_MARKER': str(self.marker), 'DEPLOY_EXIT': code,
            'DEPLOY_TEST_SCRIPT': script}

    def run_deploy(self, code='0', script=''):
        return subprocess.run(['bash', str(self.runner)], env=self.deploy_env(code, script),
            capture_output=True, text=True)

    def test_executes_target_snapshot_and_removes_temporary_script(self):
        result = self.run_deploy()
        self.assertEqual(result.returncode, 0, result.stderr)
        script, target = self.marker.read_text().splitlines()
        self.assertEqual(target, TARGET)
        self.assertFalse(Path(script).exists())
        self.assertEqual((self.state / 'deployed-revision').read_text().strip(), TARGET)
        status = json.loads((self.state / 'deploy-status/status.json').read_text())
        self.assertEqual(status['state'], 'succeeded')
        self.assertRegex(status['attemptId'], r'^\d{8}T\d{6}Z-\d+$')
        self.assertEqual(status['stage'], 'Развёртывание завершено')
        history = [json.loads(line) for line in (self.state / 'deploy-status/history.jsonl').read_text().splitlines()]
        self.assertEqual(history[-1]['attemptId'], status['attemptId'])
        log = self.state / 'deploy-status/logs' / f"{status['attemptId']}.log"
        self.assertIn(f'Deployment of {TARGET} succeeded.', log.read_text())
        self.assertEqual(log.stat().st_mode & 0o777, 0o640)
        self.assertEqual(log.parent.stat().st_mode & 0o777, 0o750)
        if os.geteuid() == 0:
            self.assertEqual(log.stat().st_gid, 10001)
            self.assertEqual(log.parent.stat().st_mode & 0o2000, 0o2000)

    def test_failure_preserves_deployed_revision_and_cleans_snapshot(self):
        result = self.run_deploy('42')
        self.assertEqual(result.returncode, 1, result.stderr)
        script, target = self.marker.read_text().splitlines()
        self.assertFalse(Path(script).exists())
        self.assertEqual((self.state / 'deployed-revision').read_text().strip(), OLD)
        self.assertEqual((self.state / 'failed-revision').read_text().strip(), TARGET)
        status = json.loads((self.state / 'deploy-status/status.json').read_text())
        self.assertEqual(status['state'], 'failed')
        log = self.state / 'deploy-status/logs' / f"{status['attemptId']}.log"
        self.assertIn('Automatic retries are paused', log.read_text())

    def test_streams_output_and_updates_stage_before_completion(self):
        script = (
            "printf '::ovoshi-help-stage::backend_build\\nBuilding backend\\n'; "
            "printf 'compiler warning\\n' >&2; sleep 2"
        )
        process = subprocess.Popen(['bash', str(self.runner)], env=self.deploy_env(script=script),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        try:
            import time
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                status_file = self.state / 'deploy-status/status.json'
                if status_file.exists():
                    status = json.loads(status_file.read_text())
                    if status['stage'] == 'Сборка backend':
                        break
                time.sleep(0.05)
            else:
                self.fail('Build stage was not visible while deployment ran')
            self.assertEqual(status['state'], 'running')
            log = self.state / 'deploy-status/logs' / f"{status['attemptId']}.log"
            self.assertIn('Building backend', log.read_text())
            self.assertIn('compiler warning', log.read_text())
            self.assertIsNone(process.poll())
            stdout, stderr = process.communicate(timeout=5)
            self.assertEqual(process.returncode, 0, stderr)
            self.assertIn('compiler warning', stdout)
        finally:
            if process.poll() is None:
                process.kill()
                process.communicate()

    def test_truncates_large_log_and_prunes_old_attempts(self):
        log_dir = self.state / 'deploy-status/logs'
        log_dir.mkdir(parents=True)
        old_logs = [log_dir / f'20200101T000000Z-{i}.log' for i in range(100)]
        for log in old_logs:
            log.write_text('old')
        script = "python3 -c 'import sys; [sys.stdout.write(\"x\" * 64000 + \"\\n\") for _ in range(150)]; print(\"last line\")'"
        result = subprocess.run(['bash', str(self.runner)], env=self.deploy_env(script=script),
            stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        status = json.loads((self.state / 'deploy-status/status.json').read_text())
        log = log_dir / f"{status['attemptId']}.log"
        self.assertLessEqual(log.stat().st_size, 8 * 1024 * 1024)
        self.assertIn('last line', log.read_text())
        self.assertEqual(len(list(log_dir.glob('*.log'))), 100)
        self.assertFalse(old_logs[0].exists())


if __name__ == '__main__':
    unittest.main()
