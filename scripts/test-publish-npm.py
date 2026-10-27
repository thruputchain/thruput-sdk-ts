"""Exercise publication decisions without registry access or Git writes."""

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parent.parent
PACKAGES = ["."]
FAKE = r'''#!/usr/bin/env python3
import json, os, pathlib, sys
tool, args = pathlib.Path(sys.argv[0]).name, sys.argv[1:]
case = os.environ['CASE']
with open(os.environ['CALLS'], 'a') as f:
    f.write(json.dumps([tool, *args]) + '\n')
if tool == 'git':
    if args[0] == 'rev-parse': print('abc')
    if args[0] == 'ls-remote' and case == 'tag-conflict': print('def\trefs/tags/npm-v1.0.0')
elif tool == 'npm':
    if args[0] == 'pack':
        package = args[1] if args[1].startswith('./') else '.'
        name = json.loads(pathlib.Path(package, 'package.json').read_text())['name'].split('/')[-1]
        print(json.dumps([{'filename': name + '.tgz', 'integrity': 'sha512-same'}]))
    if 'publish' in args and case == 'publish-failure': sys.exit(1)
elif tool == 'curl':
    pathlib.Path(args[args.index('--output') + 1]).write_text(json.dumps({'dist': {'integrity': 'sha512-other' if case == 'different' else 'sha512-same'}}))
    print('500' if case == 'registry-failure' else '200' if case in ['same', 'different'] else '404', end='')
'''


class PublicationTests(unittest.TestCase):
    def test_release_decisions(self):
        for case in ['default', 'dry', 'real', 'same', 'different', 'registry-failure',
                     'publish-failure', 'tag-conflict', 'missing-token', 'invalid-mode']:
            with self.subTest(case=case), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                bin_dir = root / 'bin'
                bin_dir.mkdir()
                for tool in ['git', 'npm', 'curl']:
                    path = bin_dir / tool
                    path.write_text(FAKE)
                    path.chmod(0o755)
                for index, package in enumerate(PACKAGES):
                    path = root / package
                    path.mkdir(parents=True, exist_ok=True)
                    (path / 'package.json').write_text(json.dumps({
                        'name': f'@thruputchain/package-{index}', 'version': '1.0.0',
                        'publishConfig': {'registry': 'https://registry.npmjs.org', 'access': 'public'},
                    }))
                calls = root / 'calls'
                env = dict(os.environ, PATH=str(bin_dir) + ':' + os.environ['PATH'],
                           CALLS=str(calls), CASE=case, NODE_AUTH_TOKEN='test-token',
                           DRY_RUN='true' if case == 'dry' else 'invalid' if case == 'invalid-mode' else 'false')
                if case == 'default': env.pop('DRY_RUN')
                if case == 'missing-token': env.pop('NODE_AUTH_TOKEN')
                result = subprocess.run(['bash', str(ROOT / 'scripts/publish-npm.sh')],
                                        cwd=root, env=env, capture_output=True, text=True)
                recorded = [json.loads(line) for line in calls.read_text().splitlines()] if calls.exists() else []
                publishes = [call for call in recorded if call[0] == 'npm' and 'publish' in call]
                tags = [call for call in recorded if call[:2] == ['git', 'tag']]
                pushes = [call for call in recorded if call[:2] == ['git', 'push']]
                self.assertEqual(result.returncode == 0, case in ['default', 'dry', 'real', 'same'], result.stderr)
                self.assertEqual(len(publishes), len(PACKAGES) if case in ['default', 'dry', 'real'] else 1 if case == 'publish-failure' else 0)
                self.assertEqual(bool(tags), case in ['real', 'same'])
                self.assertEqual(bool(pushes), bool(tags))
                for call in publishes:
                    self.assertEqual('--dry-run' in call, case in ['default', 'dry'])
                    self.assertIn('--registry=https://registry.npmjs.org', call)
                    self.assertIn('--@thruputchain:registry=https://registry.npmjs.org', call)
                    self.assertEqual(call[call.index('--access') + 1], 'public')
                if case in ['default', 'dry', 'real']:
                    self.assertEqual([Path(call[call.index('publish') + 1]).name for call in publishes],
                                     [f'package-{i}.tgz' for i in range(len(PACKAGES))])
                if tags and publishes:
                    self.assertGreater(recorded.index(tags[0]), recorded.index(publishes[-1]))


if __name__ == '__main__':
    unittest.main()
