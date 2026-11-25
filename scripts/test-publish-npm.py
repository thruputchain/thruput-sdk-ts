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
    if args[0] == 'ls-remote' and case.startswith('promote') and case != 'promote-unreleased':
        print('abc\trefs/tags/npm-v1.0.0')
elif tool == 'npm':
    if args[0] == 'pack':
        package = args[1] if args[1].startswith('./') else '.'
        name = json.loads(pathlib.Path(package, 'package.json').read_text())['name'].split('/')[-1]
        print(json.dumps([{'filename': name + '.tgz', 'integrity': 'sha512-same'}]))
    if 'publish' in args and case == 'publish-failure': sys.exit(1)
elif tool == 'curl':
    pathlib.Path(args[args.index('--output') + 1]).write_text(json.dumps({'dist': {'integrity': 'sha512-other' if case == 'different' else 'sha512-same'}}))
    if case.startswith('promote'):
        print({'promote-unpublished': '404', 'promote-registry-failure': '500'}.get(case, '200'), end='')
        sys.exit(0)
    print('500' if case == 'registry-failure' else '200' if case in ['same', 'different'] else '404', end='')
'''


class PublicationTests(unittest.TestCase):
    def test_release_decisions(self):
        for case in ['default', 'dry', 'real', 'same', 'different', 'registry-failure',
                     'publish-failure', 'tag-conflict', 'missing-token', 'invalid-mode']:
            with self.subTest(case=case):
                result, recorded = self.run_script(
                    'publish-npm.sh', case,
                    DRY_RUN=None if case == 'default' else 'true' if case == 'dry'
                    else 'invalid' if case == 'invalid-mode' else 'false',
                    **({'NODE_AUTH_TOKEN': None} if case == 'missing-token' else {}))
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
                    self.assertEqual(call[call.index('--tag') + 1], 'latest')
                if case in ['default', 'dry', 'real']:
                    self.assertEqual([Path(call[call.index('publish') + 1]).name for call in publishes],
                                     [f'package-{i}.tgz' for i in range(len(PACKAGES))])
                if tags and publishes:
                    self.assertGreater(recorded.index(tags[0]), recorded.index(publishes[-1]))

    def run_script(self, script, case, **overrides):
        """Run a release script in a scratch package and return its result and tool calls.

        Each override sets an environment variable; a value of None unsets it.
        """
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            bin_dir = root / 'bin'
            bin_dir.mkdir()
            for tool in ['git', 'npm', 'curl']:
                path = bin_dir / tool
                path.write_text(FAKE)
                path.chmod(0o755)
            (root / 'package.json').write_text(json.dumps({
                'name': '@thruputchain/package-0', 'version': '1.0.0',
                'publishConfig': {'registry': 'https://registry.npmjs.org', 'access': 'public'},
            }))
            calls = root / 'calls'
            env = dict(os.environ, PATH=str(bin_dir) + ':' + os.environ['PATH'],
                       CALLS=str(calls), CASE=case, NODE_AUTH_TOKEN='test-token')
            for key, value in overrides.items():
                if value is None: env.pop(key, None)
                else: env[key] = value
            result = subprocess.run(['bash', str(ROOT / 'scripts' / script)],
                                    cwd=root, env=env, capture_output=True, text=True)
            recorded = [json.loads(line) for line in calls.read_text().splitlines()] if calls.exists() else []
            return result, recorded

    def test_publish_dist_tag(self):
        result, recorded = self.run_script('publish-npm.sh', 'real', DRY_RUN='false', DIST_TAG='next')
        self.assertEqual(result.returncode, 0, result.stderr)
        publishes = [call for call in recorded if call[0] == 'npm' and 'publish' in call]
        self.assertEqual([call[call.index('--tag') + 1] for call in publishes], ['next'])
        # A tag npm could read as a version or an option is refused before any call.
        for tag in ['', '1.0.0', '--otp', 'Next', 'a b', 'x', 'v1', 'v2-rc']:
            with self.subTest(tag=tag):
                result, recorded = self.run_script('publish-npm.sh', 'real', DRY_RUN='false', DIST_TAG=tag)
                self.assertEqual(result.returncode == 0, tag == '', result.stderr)
                publishes = [call for call in recorded if call[0] == 'npm' and 'publish' in call]
                # An empty value means unset, so it publishes as latest.
                self.assertEqual([call[call.index('--tag') + 1] for call in publishes],
                                 ['latest'] if tag == '' else [])

    def test_promotion_decisions(self):
        cases = {
            # case: (overrides, succeeds, moves the tag)
            'promote-default': ({'DRY_RUN': None}, True, False),
            'promote-dry': ({'DRY_RUN': 'true'}, True, False),
            'promote-real': ({'DRY_RUN': 'false'}, True, True),
            'promote-next': ({'DRY_RUN': 'false', 'DIST_TAG': 'next'}, True, True),
            'promote-vnext': ({'DRY_RUN': 'false', 'DIST_TAG': 'vnext'}, True, True),
            'promote-unreleased': ({'DRY_RUN': 'false'}, False, False),
            'promote-unpublished': ({'DRY_RUN': 'false'}, False, False),
            'promote-registry-failure': ({'DRY_RUN': 'false'}, False, False),
            'promote-missing-token': ({'DRY_RUN': 'false', 'NODE_AUTH_TOKEN': None}, False, False),
            'promote-missing-version': ({'DRY_RUN': 'false', 'VERSION': None}, False, False),
            'promote-range': ({'DRY_RUN': 'false', 'VERSION': '^1.0.0'}, False, False),
            'promote-bad-tag': ({'DRY_RUN': 'false', 'DIST_TAG': '1.0.0'}, False, False),
            # A dry run refuses what the real run could not set.
            'promote-range-tag': ({'DRY_RUN': 'true', 'DIST_TAG': 'v1'}, False, False),
            'promote-any-tag': ({'DRY_RUN': 'true', 'DIST_TAG': 'x'}, False, False),
            'promote-invalid-mode': ({'DRY_RUN': 'maybe'}, False, False),
        }
        for case, (overrides, succeeds, moves) in cases.items():
            with self.subTest(case=case):
                result, recorded = self.run_script('promote-npm.sh', case, **{'VERSION': '1.0.0', **overrides})
                self.assertEqual(result.returncode == 0, succeeds, result.stderr)
                adds = [call for call in recorded if call[0] == 'npm' and 'add' in call]
                self.assertEqual(bool(adds), moves)
                self.assertFalse([call for call in recorded if call[0] == 'npm' and 'publish' in call])
                self.assertFalse([call for call in recorded if call[:2] in (['git', 'tag'], ['git', 'push'])])
                for call in adds:
                    self.assertIn('--registry=https://registry.npmjs.org', call)
                    self.assertEqual(call[call.index('add') + 1:],
                                     ['@thruputchain/package-0@1.0.0', overrides.get('DIST_TAG', 'latest')])


if __name__ == '__main__':
    unittest.main()
