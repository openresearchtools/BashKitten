#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Reuse unchanged Gecko libraries through Mozilla's Android artifact build."""
import argparse
import base64
from functools import cache
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[2]
WORKFLOW = '.github/builders/android.yml'
# These application files do not generate Gecko JNI wrappers. In particular,
# GeckoView Java, build definitions, native sources and version pins stay inputs.
APPLICATION_PATHS = (
    'browser/mobile/android/bashkitten/src/main/java/',
    'browser/mobile/android/bashkitten/src/main/assets/',
    'browser/mobile/android/bashkitten/src/main/res/',
    'browser/mobile/android/fenix/app/src/main/java/',
    'browser/mobile/android/fenix/app/src/main/assets/',
    'browser/mobile/android/fenix/app/src/main/res/',
)
COLLECTOR = 'browser/bashkitten/android/scripts/collect-artifacts.py'
spec = importlib.util.spec_from_file_location('browser_component', ROOT / 'agent/packaging/browser-component.py')
component = importlib.util.module_from_spec(spec)
spec.loader.exec_module(component)


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def native_recipe(workflow):
    """Compare the actual compiler environment and commands, not cache policy."""
    runner = re.search(r'^    runs-on: (.+)$', workflow, re.M)
    environment = re.search(r'^    env:\n((?:      .+\n)+)', workflow, re.M)
    if not runner or not environment:
        raise ValueError('Android native recipe is missing its runner or environment')
    recipe = {'runner': runner[1], 'environment': [line for line in environment[1].splitlines()
              if not re.match(r'      (?:#|ANDROID_KEY|MOZ_SOURCE_CHANGESET:)', line)]}
    for name in ('Select the Android architecture', 'Prepare hosted runner', 'Install the compatible Rust toolchain',
                 'Bootstrap the pinned Mozilla Android toolchain', 'Generate the product artwork',
                 'Build Gecko for the selected architecture'):
        block = re.search(r'^    - name: ' + re.escape(name) + r'\n((?:      .*\n|\n)+)', workflow, re.M)
        if not block:
            raise ValueError('Android native recipe is missing ' + name)
        # Conditions and timing do not change the compilation. Preserve commands,
        # including multiline shell, the working directory and step environment.
        recipe[name] = [line for line in block[1].splitlines()
                        if not re.match(r'      (?:if|timeout-minutes):', line)]
    for action in ('mozilla-actions/sccache-action', 'actions/setup-java'):
        block = re.search(r'^    - uses: ' + re.escape(action) + r'@(.+\n)((?:      .*\n|\n)*)', workflow, re.M)
        if not block:
            raise ValueError('Android native recipe is missing ' + action)
        recipe[action] = block[1] + '\n'.join(line for line in block[2].splitlines()
                                             if not re.match(r'      if:', line))
    return recipe


@cache
def historical_native_recipe(revision):
    # Read the small immutable recipe before considering a product-tree fetch.
    # Older trees can contain source archives removed from current history.
    record = component.api(f'repos/openresearchtools/bashkitten/contents/{WORKFLOW}?ref={revision}')
    return native_recipe(base64.b64decode(record['content']).decode())


@cache
def native_inputs(revision, target, legacy_android_module=False):
    if not re.fullmatch('[0-9a-f]{40}', revision):
        raise ValueError('Invalid native source revision')
    if subprocess.run(['git', 'cat-file', '-e', revision + '^{commit}'], cwd=ROOT,
                      stderr=subprocess.DEVNULL).returncode:
        # Checkout is shallow in CI. Fetch only this immutable product commit,
        # sharing the current tree's blobs; never fetch Mozilla ancestry or tags.
        subprocess.run(['git', 'fetch', '--no-tags', '--depth=1', 'origin', revision], cwd=ROOT, check=True)
    entries = []
    for entry in git('ls-tree', '-r', '-z', revision, '--', 'browser').split(b'\0'):
        if not entry:
            continue
        path = entry.split(b'\t', 1)[1].decode()
        # This exact EXTRA_JS_MODULES input is repackaged into omni.ja. Keep its
        # moz.build and all other shared files in the native input comparison.
        if path == component.ANDROID_ONLY_MODULE and not legacy_android_module:
            continue
        if path == COLLECTOR or path.startswith(APPLICATION_PATHS) or '/__pycache__/' in path:
            continue
        entries.append(entry)
    recipe = native_recipe(git('show', revision + ':' + WORKFLOW).decode())
    return hashlib.sha256(target.encode() + b'\0' + b'\0'.join(entries) + b'\0' +
                          json.dumps(recipe, sort_keys=True).encode()).hexdigest()


def gecko_libraries(apk, abi):
    # Use the existing Gecko package manifest, not all JNI libraries in Fenix.
    # Go, Tor, Display and Maven native dependencies remain freshly assembled by
    # their existing Gradle/build owners and never enter the reuse archive.
    manifest = (ROOT / 'browser/mobile/android/installer/package-manifest.in').read_text()
    names = {'lib' + name + '.so' for name in re.findall(r'@DLL_PREFIX@([\w-]+)@DLL_SUFFIX@', manifest)}
    names.add('libplugin-container.so')
    # This mozconfig uses the pinned Maven app-services library, not the optional
    # --enable-appservices-in-tree Gecko build mentioned in package-manifest.in.
    names.discard('libmegazord.so')
    libraries = {}
    with zipfile.ZipFile(apk) as archive:
        for name in archive.namelist():
            if name.startswith(f'lib/{abi}/') and Path(name).name in names:
                with archive.open(name) as stream:
                    libraries[name] = hashlib.file_digest(stream, 'sha256').hexdigest()
    if f'lib/{abi}/libxul.so' not in libraries or f'lib/{abi}/libmozglue.so' not in libraries:
        raise ValueError('Android artifact is missing its Gecko libraries')
    return libraries


def verify_native(apk, record, target):
    abi = 'x86_64' if target == 'android-x86_64' else 'arm64-v8a'
    current = git('rev-parse', 'HEAD').decode().strip()
    producer_inputs = native_inputs(record.get('source', ''), target)
    # Preserve old receipts, including their original digest. Validate that
    # digest under its actual producer's old/new calculation before comparing
    # current native inputs with the producer under the narrow resource rule.
    recorded_inputs = {producer_inputs, native_inputs(record.get('source', ''), target, True)}
    if (record.get('schema') != 1 or record.get('architecture') != abi or
            record.get('input_sha256') not in recorded_inputs or
            producer_inputs != native_inputs(current, target) or
            record.get('libraries') != gecko_libraries(apk, abi)):
        raise ValueError('Gecko native producer, inputs or library bytes do not match')
    producer = record.get('producer')
    if producer:
        if (producer.get('source') != record['source'] or
                producer.get('repository') != 'openresearchtools/bashkitten-build-' + target or
                not all(re.fullmatch('[0-9]+', str(producer.get(key, ''))) for key in ('run', 'artifact')) or
                not all(re.fullmatch('[0-9a-f]{64}', producer.get(key, ''))
                        for key in ('manifest_sha256', 'apk_sha256'))):
            raise ValueError('Invalid original Gecko producer evidence')
    elif record['source'] != current:
        raise ValueError('Reused Gecko libraries require their original producer evidence')


def record_build(apk, target):
    abi = 'x86_64' if target == 'android-x86_64' else 'arm64-v8a'
    current = git('rev-parse', 'HEAD').decode().strip()
    component.verify_android_resources(apk)
    receipt = os.environ.get('BASHKITTEN_ANDROID_NATIVE_RECEIPT')
    if receipt:
        record = json.loads(Path(receipt).read_text())
        verify_native(apk, record, target)
        return record
    return {'schema': 1, 'architecture': abi, 'source': current,
            'input_sha256': native_inputs(current, target), 'libraries': gecko_libraries(apk, abi)}


def artifact_mozconfig():
    # Artifact mode disables toolchain.configure, so its compiler-only options
    # are unavailable. Keep every assembly option and the native input file
    # unchanged; shell no-ops preserve conditional branches such as SCCACHE_PATH.
    source = (ROOT / 'browser/bashkitten/android/mozconfig').read_text()
    source = re.sub(r'^([ \t]*)ac_add_options --(?:(?:enable|disable)-(?:optimize|debug-symbols)|'
                    r'(?:with|without)-ccache)(?:=.*)?$',
                    r'\1: # Native compilation option; retained in the producer configuration.',
                    source, flags=re.M)
    # Full native builds produce these host generators. Artifact builds obtain
    # them from the same source-hashed Mozilla toolchain definitions instead.
    return (source + '\nac_add_options --enable-artifact-builds\n'
            'ac_add_options --enable-bootstrap=embedded-uniffi-bindgen,nimbus-fml\n')


def restore(directory, target):
    repository = os.environ['GITHUB_REPOSITORY']
    if repository != 'openresearchtools/bashkitten-build-' + target:
        raise ValueError('Native restoration must use its matching Android builder')
    current = git('rev-parse', 'HEAD').decode().strip()
    digest = native_inputs(current, target)
    current_recipe = native_recipe(git('show', current + ':' + WORKFLOW).decode())
    abi = 'x86_64' if target == 'android-x86_64' else 'arm64-v8a'
    page = 1
    while True:
        artifacts = component.api(f'repos/{repository}/actions/artifacts?per_page=100&page={page}')['artifacts']
        for artifact in artifacts:
            if artifact['expired'] or not artifact['name'].startswith(f'bashkitten-browser-{target}-'):
                continue
            run = component.api(f'repos/{repository}/actions/runs/{artifact["workflow_run"]["id"]}')
            source = re.match(r'^BashKitten ([0-9a-f]{40}) / ', run.get('display_title', ''))
            if not source:
                continue
            evidence = component.completed_producer(repository, run, target)
            if not evidence:
                continue
            try:
                if historical_native_recipe(source[1]) != current_recipe:
                    continue
            except subprocess.CalledProcessError as error:
                try:
                    response = json.loads(error.output)
                except (TypeError, ValueError):
                    raise error
                if not isinstance(response, dict) or response.get('status') != '404':
                    raise
                print(f'Skipping native Gecko cache producer whose source is unavailable: {source[1]}', flush=True)
                continue
            except ValueError:
                # An older unsupported native recipe cannot prove a match.
                continue
            try:
                producer_inputs = native_inputs(source[1], target)
            except ValueError:
                # A historical, different native recipe is a cache miss.
                continue
            if producer_inputs != digest:
                continue
            producer = directory / 'producer'
            subprocess.run(['gh', 'run', 'download', str(run['id']), '--repo', repository,
                            '--name', artifact['name'], '--dir', str(producer)], check=True)
            component.verify_checksums(producer)
            manifest_path = producer / 'build-manifest.json'
            manifest = json.loads(manifest_path.read_text())
            apks = list(producer.glob('*.apk'))
            if (manifest.get('source') != source[1] or manifest.get('architecture') != abi or
                    len(apks) != 1 or manifest.get('apks', {}).get(apks[0].name) != sha(apks[0])):
                raise ValueError('Native producer APK source, architecture or checksum mismatch')
            apk = apks[0]
            proof = {'source': source[1], 'repository': repository, 'run': run['id'],
                     'artifact': artifact['id'], 'manifest_sha256': sha(manifest_path),
                     'apk': apk.name, 'apk_sha256': sha(apk), 'steps': evidence}
            record = manifest.get('native_gecko') or {
                'schema': 1, 'architecture': abi, 'source': source[1], 'input_sha256': digest,
                'libraries': gecko_libraries(apk, abi)}
            # Keep the first actual native producer through subsequent reuse.
            record.setdefault('producer', proof)
            record['restored_from'] = proof
            verify_native(apk, record, target)
            receipt = directory / 'native-gecko.json'
            receipt.write_text(json.dumps(record, indent=2) + '\n')
            payload = directory / 'gecko-libraries.apk'
            with zipfile.ZipFile(apk) as source_apk, zipfile.ZipFile(payload, 'w') as output:
                for name in sorted(record['libraries']):
                    output.writestr(name, source_apk.read(name))
            # Mozilla's normal mach build installs this local archive and rebuilds
            # resources/Java. The normal mozconfig remains an immutable input.
            mozconfig = directory / 'mozconfig'
            mozconfig.write_text(artifact_mozconfig())
            with Path(os.environ['GITHUB_ENV']).open('a') as environment:
                environment.write(f'MOZCONFIG={mozconfig.resolve()}\nMOZ_ARTIFACT_FILE={payload.resolve()}\n'
                                  f'BASHKITTEN_ANDROID_NATIVE_RECEIPT={receipt.resolve()}\n')
            print(f'Reusing Gecko native producer {record["source"]} from {run["html_url"]}; '
                  'assembling current application resources and Java.', flush=True)
            return True
        if len(artifacts) < 100:
            return False
        page += 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('target', choices=['android', 'android-x86_64'])
    parser.add_argument('--directory', type=Path, required=True)
    args = parser.parse_args()
    args.directory.mkdir(parents=True, exist_ok=True)
    if any(args.directory.iterdir()):
        raise ValueError('Native restore directory must be empty')
    hit = restore(args.directory.resolve(), args.target)
    with Path(os.environ['GITHUB_OUTPUT']).open('a') as output:
        output.write(f'hit={str(hit).lower()}\n')
    if not hit:
        print('No matching completed native Gecko artifact; using the normal compiler cache.')


if __name__ == '__main__':
    main()
