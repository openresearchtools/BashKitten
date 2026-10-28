#!/usr/bin/env python3
"""Reuse verified browser artifacts without consuming the compiler-cache quota."""
import argparse
import base64
from functools import cache
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile

from release import validate_termux_update, TERMUX_UPDATE_ASSET, TERMUX_BOOTSTRAP_ASSET, TERMUX_PREPARER_ASSET

ROOT = Path(__file__).resolve().parents[2]
VERIFIER = 'agent/packaging/browser-component.py'
EQUIVALENCE = 'browser-input-equivalence.json'
ANDROID_ONLY_MODULE = 'browser/mobile/shared/modules/geckoview/BashKittenAndroid.sys.mjs'


def fingerprint(target, legacy_verifier=None, legacy_android_module=None):
    # Cache policy is not compiler input. Preserve the old calculation only to
    # prove equivalence of already-published artifacts; no producer is relabelled.
    paths = ['browser', 'references/connector', 'references/vendor/translators',
             'agent/packaging/references-component.py',
             'agent/packaging/source_cache.py'] + ([VERIFIER] if legacy_verifier else [])
    if target.startswith('android'):
        paths += ['.github/builders/android.yml', 'auth', 'agent/native/remote', 'agent/native/phone-control',
                  'agent/packaging/android-notices.py', 'agent/packaging/build.py',
                  'agent/packaging/applications.py', 'references/runtime-payload.json',
                  'references/package.json', 'references/package-lock.json', 'references/legal',
                  'references/THIRD_PARTY_NOTICES.md', 'references/vendor/*/source.json',
                  'references/vendor/npm/sources.json', 'office/vendor/npm/sources.json',
                  ':(glob)references/vendor/**/COPYING*', ':(glob)references/vendor/**/LICENSE*',
                  ':(glob)references/vendor/**/README*',
                  'office/package.json', 'office/package-lock.json',
                  'agent/systematic-reviewer/package.json', 'agent/systematic-reviewer/LICENSE', 'agent/systematic-reviewer/NOTICE',
                  'agent/packaging/release_version.py', 'agent/packaging/release.py',
                  'agent/packaging/licenses.mjs', 'agent/packaging/node', 'agent/packaging/termux/search',
                  'agent/src/server/licenses.mjs',
                  'agent/package.json', 'agent/package-lock.json', 'agent/LICENSE',
                  'agent/PI_UPSTREAM.md', 'agent/THIRD_PARTY_NOTICES.md',
                  'agent/licenses', 'agent/pi/package.json', 'agent/pi/LICENSE',
                  'agent/pi/NOTICE', 'agent/search',
                  'agent/pi/vendor/pillama/package.json', 'agent/pi/vendor/pillama/LICENSE',
                  'agent/pi/vendor/pillama/NOTICE', 'agent/pi/vendor/pillama.upstream.json',
                  'agent/pi/vendor/pi-codex-usage/LICENSE', 'agent/pi/vendor/pi-codex-usage.upstream.json',
                  'os/NOTICE', 'os/licenses', 'os/upstream/sources.json', 'os/packaging',
                  ':(glob)os/upstream/**/COPYING*', ':(glob)os/upstream/**/LICENSE*',
                  ':(glob)os/upstream/**/NOTICE*', ':(glob)os/upstream/**/THIRD_PARTY*',
                  'agent/packaging/termux/os.py', '.github/workflows/machines-native.yml',
                  'agent/src/server/access/NOTICE', 'agent/src/server/access/TORKITTEN-LICENSE',
                  'agent/src/server/models/third_party', 'agent/src/server/updates/platform-packages.mjs',
                  'agent/src/server/platform/termux/updates-bootstrap.mjs',
                  'agent/src/server/platform/termux/updates-prepare.py',
                  'agent/packaging/termux/install.sh',
                  '.github/workflows/auth-native.yml', '.github/workflows/search-native.yml']
    else:
        paths += ['.github/builders/linux.yml', 'agent/packaging/linux/prepare-runner.sh',
                  ':(exclude)browser/mobile/android', ':(exclude)browser/bashkitten/android']
    listing = subprocess.check_output(['git', 'ls-files', '--stage', '-z', '--', *paths], cwd=ROOT)
    if legacy_android_module and target.startswith('android'):
        raise ValueError('Android APK resources cannot use Linux input equivalence')
    for path, blob in ((VERIFIER, legacy_verifier), (ANDROID_ONLY_MODULE, legacy_android_module)):
        if not blob:
            continue
        if not re.fullmatch('[0-9a-f]{40}', blob):
            raise ValueError('Invalid legacy source identity')
        entries = listing.split(b'\0')
        matching = [i for i, entry in enumerate(entries) if entry.endswith(b'\t' + path.encode())]
        if len(matching) != 1:
            raise ValueError('Missing tracked legacy input')
        entries[matching[0]] = f'100644 {blob} 0\t{path}'.encode()
        listing = b'\0'.join(entries)
    return hashlib.sha256(target.encode() + b'\0' + listing).hexdigest()


def artifact_name(target, digest):
    return f'bashkitten-browser-{target}-{digest}'


def api(endpoint):
    return json.loads(subprocess.check_output(['gh', 'api', endpoint], text=True))


def matching_input(directory, target, recorded, digest, producer, legacy_android_module=None):
    if recorded == digest:
        return
    receipt = json.loads((Path(directory) / EQUIVALENCE).read_text())
    manifest = Path(directory) / ('build-manifest.json' if target.startswith('android') else 'browser-artifact-manifest.txt')
    if (receipt.get('schema') != 1 or receipt.get('target') != target or
            receipt.get('producerSource') != producer or
            receipt.get('producerFingerprint') != recorded or
            receipt.get('compileFingerprint') != digest or
            receipt.get('producerManifestSha256') != hashlib.sha256(manifest.read_bytes()).hexdigest() or
            fingerprint(target, receipt.get('legacyVerifierBlob'),
                        receipt.get('legacyAndroidModuleBlob', legacy_android_module)) != recorded):
        raise ValueError('Browser source equivalence does not match this source')


def verify_android_resources(apk):
    # EXTRA_JS_MODULES is copied into the current omnijar, never into Gecko ELF
    # libraries. Native reuse must not accidentally preserve the donor's module.
    with zipfile.ZipFile(apk) as archive:
        with zipfile.ZipFile(io.BytesIO(archive.read('assets/omni.ja'))) as omni:
            if omni.read('modules/BashKittenAndroid.sys.mjs') != (ROOT / ANDROID_ONLY_MODULE).read_bytes():
                raise ValueError('Android omnijar module does not match the current source')


def verify_checksums(directory):
    directory = Path(directory)
    checked = set()
    for line in (directory / 'SHA256SUMS').read_text().splitlines():
        expected, name = line.split('  ', 1)
        if Path(name).name != name or not re.fullmatch('[0-9a-f]{64}', expected):
            raise ValueError('Invalid component checksum entry')
        with (directory / name).open('rb') as stream:
            if hashlib.file_digest(stream, 'sha256').hexdigest() != expected:
                raise ValueError('Component checksum mismatch: ' + name)
        checked.add(name)
    payload = {item.name for item in directory.iterdir() if item.is_file() and item.name != 'SHA256SUMS'}
    if not checked or checked != payload:
        raise ValueError('Component checksums must cover the complete artifact')


def verify(directory, target, digest, legacy_android_module=None):
    directory = Path(directory)
    verify_checksums(directory)
    if target.startswith('android'):
        manifest = json.loads((directory / 'build-manifest.json').read_text())
        if manifest.get('architecture') != ('x86_64' if target == 'android-x86_64' else 'arm64-v8a'):
            raise ValueError('Android component inputs do not match this source')
        if not re.fullmatch('[0-9a-f]{40}', manifest.get('source', '')):
            raise ValueError('Android component has no producing source revision')
        apks = list(directory.glob('*.apk'))
        if len(apks) != 1 or manifest.get('apks', {}).get(apks[0].name) is None:
            raise ValueError('Expected one recorded production APK')
        verify_android_resources(apks[0])
        with zipfile.ZipFile(apks[0]) as archive:
            pairing = validate_termux_update(json.loads(archive.read(TERMUX_UPDATE_ASSET)),
                                             abi=manifest['architecture'])
            if hashlib.sha256(archive.read(TERMUX_BOOTSTRAP_ASSET)).hexdigest() != pairing['bootstrapSha256']:
                raise ValueError('APK update bootstrap does not match its paired manifest')
            if archive.read(TERMUX_PREPARER_ASSET) != (ROOT / 'agent/src/server/platform/termux/updates-prepare.py').read_bytes():
                raise ValueError('APK bundled-runtime preparation does not match this source')
        expected_source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
        if pairing['sourceCommit'] != expected_source or pairing['sourceCommit'] != manifest['source']:
            raise ValueError('APK resources must be reassembled for this revision’s Termux packages')
        matching_input(directory, target, manifest.get('browser_input_sha256'), digest, manifest['source'])
        if manifest.get('native_gecko'):
            spec = importlib.util.spec_from_file_location('android_native_component', ROOT / 'agent/packaging/android-native-component.py')
            native_component = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(native_component)
            native_component.verify_native(apks[0], manifest['native_gecko'], target)
    else:
        manifest = dict(line.split('=', 1) for line in (directory / 'browser-artifact-manifest.txt').read_text().splitlines())
        if manifest.get('architecture') != target.removeprefix('linux-') or not re.fullmatch('[0-9a-f]{40}', manifest.get('bashkitten_commit', '')):
            raise ValueError('Linux component inputs do not match this source')
        matching_input(directory, target, manifest.get('browser_input_sha256'), digest,
                       manifest['bashkitten_commit'], legacy_android_module)


def verify_package(directory, target, source, digest):
    directory = Path(directory)
    packages = list(directory.glob('*.deb'))
    if len(packages) != 1:
        raise ValueError('Expected one complete Linux package')
    package = packages[0]
    manifest = json.loads(package.with_name(package.name + '.json').read_text())
    if manifest.get('revision') != source or manifest.get('architecture') != target.removeprefix('linux-'):
        raise ValueError('Package source or architecture mismatch')
    if manifest.get('components', {}).get('browser', {}).get('browser_input_sha256') != digest:
        raise ValueError('Package browser inputs do not match this source')
    with package.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != manifest.get('sha256'):
            raise ValueError('Package checksum mismatch')


@cache
def android_workflow_steps(repository, revision):
    if not re.fullmatch('[0-9a-f]{40}', revision):
        raise ValueError('Invalid builder workflow revision')
    path = '.github/workflows/build.yml'
    entry = api(f'repos/{repository}/contents/{path}?ref={revision}')
    source = base64.b64decode(entry['content']).decode()
    jobs = source.partition('\njobs:\n')[2]
    # The Android recipe has one job and ordinary top-level steps. Numbered
    # Actions results start with setup-job (1), then these steps (2 onwards).
    # Resolve commands from the immutable recipe: API display names can be
    # secret-redacted, including the word Android, and are not identities.
    if re.findall(r'^  ([\w-]+):$', jobs, re.M) != ['apk']:
        return None
    steps = re.split(r'^    - ', jobs.partition('    steps:\n')[2], flags=re.M)[1:]
    if not steps:
        return None
    return steps, {'revision': revision, 'path': path, 'blob': entry['sha']}


def completed_android_producer(repository, run, jobs):
    recipe = android_workflow_steps(repository, run['head_sha'])
    if recipe is None or len(jobs) != 1:
        return None
    steps, workflow = recipe

    def command_number(command):
        matches = [index + 2 for index, step in enumerate(steps)
                   if re.search(r'^      run: ' + re.escape(command) + r'$', step, re.M)]
        return matches[0] if len(matches) == 1 else None

    build_numbers = [command_number(command) for command in (
        'set -o pipefail; ./mach build 2>&1 | tee ../artifacts/gecko-build.log',
        'set -o pipefail; ./mach gradle :fenix:assembleRelease --profile 2>&1 | tee ../artifacts/apk-build.log',
        'python3 browser/bashkitten/android/scripts/collect-artifacts.py candidate')]
    verify_number = command_number('python3 agent/packaging/browser-component.py verify "$BROWSER_TARGET" --directory candidate')
    restore_number = command_number('python3 agent/packaging/browser-component.py restore "$BROWSER_TARGET" --directory candidate')
    if not verify_number or not all(build_numbers) or max(build_numbers) >= verify_number:
        return None
    upload_index = verify_number - 1  # zero-based recipe step immediately after verification
    if upload_index >= len(steps):
        return None
    upload_recipe = steps[upload_index]
    if (not re.match(r'uses: actions/upload-artifact@[0-9a-f]{40}\n', upload_recipe) or
            not re.search(r'^        path: candidate/$', upload_recipe, re.M) or
            not re.search(r'^        name: \$\{\{ steps\.component\.outputs\.artifact \}\}$', upload_recipe, re.M)):
        return None
    job = jobs[0]
    results = {step['number']: step for step in job.get('steps', [])}
    builds = [results.get(number, {}) for number in build_numbers]
    verification = results.get(verify_number, {})
    upload = results.get(verify_number + 1, {})
    if verification.get('conclusion') != 'success' or upload.get('conclusion') != 'success':
        return None
    evidence = {'job': job['id'], 'workflow': workflow, 'verify': verification, 'upload': upload}
    if all(step.get('conclusion') == 'success' for step in builds):
        return {**evidence, 'build': builds}
    restored = results.get(restore_number, {})
    if (run['conclusion'] == 'success' and restored.get('conclusion') == 'success' and
            all(step.get('conclusion') == 'skipped' for step in builds)):
        return {**evidence, 'restored': restored}
    return None


def completed_producer(repository, run, target):
    if (run['status'] != 'completed' or run['conclusion'] not in ('success', 'failure') or
            run['event'] != 'workflow_dispatch' or run['head_branch'] != 'main' or
            run['path'] != '.github/workflows/build.yml'):
        return None
    jobs = api(f'repos/{repository}/actions/runs/{run["id"]}/jobs?per_page=100')['jobs']
    if target.startswith('android'):
        return completed_android_producer(repository, run, jobs)
    verify_name = 'Verify the browser archive and source inputs'
    build_names = ['Build the complete browser archive']
    for job in jobs:
        steps = job.get('steps', [])
        verification = next((s for s in steps if s['name'] == verify_name and s['conclusion'] == 'success'), None)
        if not verification:
            continue
        upload = next((s for s in steps if s['number'] == verification['number'] + 1 and
                       'actions/upload-artifact@' in s['name'] and s['conclusion'] == 'success'), None)
        builds = [next((s for s in steps if s['name'] == name), {}) for name in build_names]
        if not upload:
            continue
        if all(s.get('conclusion') == 'success' for s in builds):
            return {'job': job['id'], 'build': builds, 'verify': verification, 'upload': upload}
        # A successful workflow may itself have restored a verified producer.
        # A failed workflow is reusable only after an actual successful build.
        restored = next((s for s in steps if s['name'].startswith('Restore a matching completed ') and
                         s['conclusion'] == 'success'), None)
        if run['conclusion'] == 'success' and restored and all(s.get('conclusion') == 'skipped' for s in builds):
            return {'job': job['id'], 'restored': restored, 'verify': verification, 'upload': upload}
    return None


def source_blob(source, path):
    if not re.fullmatch('[0-9a-f]{40}', source):
        raise ValueError('Invalid producer source revision')
    local = subprocess.run(['git', 'rev-parse', '--verify', source + ':' + path], cwd=ROOT,
                           text=True, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    if local.returncode == 0:
        return local.stdout.strip()
    return api(f'repos/openresearchtools/bashkitten/contents/{path}?ref={source}')['sha']


def restore(directory, target, digest):
    repository = os.environ['GITHUB_REPOSITORY']
    expected = 'openresearchtools/bashkitten-build-' + target.removeprefix('linux-')
    if repository != expected:
        raise ValueError('Component restoration must run in the matching build repository')
    name = artifact_name(target, digest)
    page = 1
    while True:
        artifacts = api(f'repos/{repository}/actions/artifacts?per_page=100&page={page}')['artifacts']
        for artifact in artifacts:
            if artifact['expired'] or not artifact['name'].startswith(f'bashkitten-browser-{target}-'):
                continue
            run = api(f'repos/{repository}/actions/runs/{artifact["workflow_run"]["id"]}')
            if target.startswith('android'):
                # The APK carries exact companion package expectations. A
                # different assembly revision needs new APK resources, even
                # when unchanged Gecko objects remain in the compiler cache.
                source = re.match(r'^BashKitten ([0-9a-f]{40}) / ', run.get('display_title', ''))
                current = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
                if not source or source[1] != current:
                    continue
            evidence = completed_producer(repository, run, target)
            if not evidence:
                continue
            legacy = None
            legacy_module = None
            expected = digest
            if artifact['name'] != name:
                source = re.match(r'^BashKitten ([0-9a-f]{40}) / ', run.get('display_title', ''))
                if not source:
                    continue
                verifier = source_blob(source[1], VERIFIER)
                candidates = [(verifier, None)]
                if not target.startswith('android'):
                    # This exact module is traversed only by mobile Android/iOS
                    # builds. Prove all remaining Linux inputs still match;
                    # retain the original source/blob in the equivalence receipt.
                    module = source_blob(source[1], ANDROID_ONLY_MODULE)
                    candidates += [(None, module), (verifier, module)]
                for legacy, legacy_module in candidates:
                    expected = fingerprint(target, legacy, legacy_module)
                    if artifact['name'] == artifact_name(target, expected):
                        break
                else:
                    continue
            subprocess.run(['gh', 'run', 'download', str(run['id']), '--repo', repository,
                            '--name', artifact['name'], '--dir', str(directory)], check=True)
            verify(directory, target, expected, legacy_module)
            if expected != digest:
                manifest_file = Path(directory) / ('build-manifest.json' if target.startswith('android') else 'browser-artifact-manifest.txt')
                manifest = json.loads(manifest_file.read_text()) if target.startswith('android') else dict(line.split('=', 1) for line in manifest_file.read_text().splitlines())
                producer = manifest['source' if target.startswith('android') else 'bashkitten_commit']
                receipt_file = Path(directory) / EQUIVALENCE
                if receipt_file.exists():
                    # verify() already checked the previous receipt and complete
                    # artifact. Preserve the original producer through reuse.
                    receipt = json.loads(receipt_file.read_text())
                    receipt['compileFingerprint'] = digest
                else:
                    if legacy and source_blob(producer, VERIFIER) != legacy:
                        raise ValueError('Producer verifier differs from the proven legacy input')
                    receipt = {'schema': 1, 'target': target, 'producerSource': producer,
                               'producerFingerprint': expected, 'compileFingerprint': digest,
                               'legacyVerifierBlob': legacy, 'repository': repository, 'run': run['id'],
                               'artifact': artifact['id'], 'producerSteps': evidence,
                               'producerManifestSha256': hashlib.sha256(manifest_file.read_bytes()).hexdigest()}
                if legacy_module:
                    receipt['legacyAndroidModuleBlob'] = source_blob(producer, ANDROID_ONLY_MODULE)
                receipt_file.write_text(json.dumps(receipt, indent=2) + '\n')
                checksums = Path(directory) / 'SHA256SUMS'
                lines = [line for line in checksums.read_text().splitlines()
                         if not line.endswith('  ' + EQUIVALENCE)]
                lines.append(hashlib.sha256(receipt_file.read_bytes()).hexdigest() + '  ' + EQUIVALENCE)
                checksums.write_text('\n'.join(lines) + '\n')
                verify(directory, target, digest)
            print(f'Reused verified {target} browser from {run["html_url"]}', flush=True)
            return True
        if len(artifacts) < 100:
            return False
        page += 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['fingerprint', 'restore', 'verify'])
    parser.add_argument('target', choices=['linux-arm64', 'linux-amd64', 'android', 'android-x86_64'])
    parser.add_argument('--directory', type=Path)
    args = parser.parse_args()
    digest = fingerprint(args.target)
    name = artifact_name(args.target, digest)
    if args.action == 'fingerprint':
        print(digest)
        return
    if args.directory is None:
        parser.error('--directory is required')
    if args.action == 'verify':
        verify(args.directory, args.target, digest)
        return
    args.directory.mkdir(parents=True, exist_ok=True)
    if any(args.directory.iterdir()):
        raise ValueError('Restore destination must be empty')
    hit = restore(args.directory, args.target, digest)
    with Path(os.environ['GITHUB_OUTPUT']).open('a') as output:
        output.write(f'hit={str(hit).lower()}\ndigest={digest}\nartifact={name}\n')
    print('Matching completed browser artifact found' if hit else 'Compiling changed browser inputs')


if __name__ == '__main__':
    main()
