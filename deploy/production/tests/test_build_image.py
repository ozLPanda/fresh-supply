"""Build failures must preserve caches and never fall back to another builder."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'build-image.sh'


class BuildImageTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.log = self.root / 'calls.jsonl'
        docker = self.root / 'docker'
        docker.write_text('''#!/usr/bin/env python3
import json, os, sys
with open(os.environ['CALL_LOG'], 'a') as output:
    output.write(json.dumps(sys.argv[1:]) + '\\n')
if sys.argv[1:3] == ['buildx', 'version']:
    sys.exit(int(os.environ.get('VERSION_STATUS', '0')))
if sys.argv[1:3] == ['buildx', 'inspect']:
    print('Name: test\\nDriver: ' + os.environ.get('DRIVER', 'docker-container'))
    sys.exit(int(os.environ.get('INSPECT_STATUS', '0')))
if sys.argv[1:3] == ['buildx', 'build']:
    sys.exit(int(os.environ.get('BUILD_STATUS', '0')))
sys.exit(99)
''')
        docker.chmod(0o755)

    def run_build(self, **settings):
        result = subprocess.run(
            ['bash', str(SCRIPT), 'test:tag', 'backend/Dockerfile.prod', 'backend'],
            env={**os.environ, 'PATH': str(self.root) + os.pathsep + os.environ['PATH'],
                 'CALL_LOG': str(self.log), **settings}, capture_output=True, text=True)
        self.calls = [json.loads(line) for line in self.log.read_text().splitlines()]
        return result

    def test_single_build_loads_into_daemon_and_uses_named_builder(self):
        result = self.run_build(OVOSHI_HELP_BUILDER='isolated-builder')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(self.calls[-1], ['buildx', 'build', '--builder', 'isolated-builder',
            '--platform', 'linux/amd64', '--load', '--progress', 'plain', '--tag', 'test:tag',
            '--file', 'backend/Dockerfile.prod', 'backend'])
        self.assertEqual(len(self.calls), 3)

    def test_build_failure_is_returned_without_retry_or_prune(self):
        result = self.run_build(BUILD_STATUS='42')
        self.assertEqual(result.returncode, 42)
        self.assertEqual(len(self.calls), 3)
        self.assertEqual(self.calls[-1][:2], ['buildx', 'build'])

    def test_missing_plugin_stops_before_build(self):
        self.assertNotEqual(self.run_build(VERSION_STATUS='1').returncode, 0)
        self.assertEqual(len(self.calls), 1)

    def test_wrong_driver_stops_before_build(self):
        self.assertNotEqual(self.run_build(DRIVER='docker').returncode, 0)
        self.assertEqual(len(self.calls), 2)

    def test_missing_builder_stops_before_build(self):
        self.assertNotEqual(self.run_build(INSPECT_STATUS='1').returncode, 0)
        self.assertEqual(len(self.calls), 2)


if __name__ == '__main__':
    unittest.main()
