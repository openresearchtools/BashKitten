#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Durable browser components through the existing architecture releases."""
import argparse
from functools import cache
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import time
import zipfile

ROOT = Path(__file__).resolve().parents[2]
LEGACY_CACHE_MOZILLA_VERSION = '153.6.0esr'


@cache
def module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), ROOT / 'agent/packaging' / (name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


def source():
    return subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()


def text(revision, path):
    return module('browser-component').network_command(['git', 'show', revision + ':' + path]).strip()


def version(revision, native=False):
    path = 'browser/browser/config/version_display.txt' if native else 'browser/taskarian/config/version.txt'
    return text(revision, path)


def inputs(kind, target, revision=None, companion=None):
    revision = revision or source()
    browser = module('browser-component')
    if kind == 'gecko':
        digest = (module('android-native-component').native_inputs(revision, target)
                  if target.startswith('android') else browser.linux_engine_inputs(revision, target))
        return {'schema': 'taskarian-gecko-2', 'target': target, 'nativeSha256': digest,
                'engineVersion': version(revision, True)}
    # The resource package contains the engine too: retain its actual scoped
    # identity, all application resources, and the native packaging recipe.
    paths = [path for path in browser.input_paths(target) if not path.startswith(':')]
    listing = browser.network_command(['git', 'ls-tree', '-r', '-z', revision, '--', *paths], binary=True)
    entries = []
    for entry in listing.split(b'\0'):
        if not entry:
            continue
        path = entry.split(b'\t', 1)[1].decode()
        if path in browser.FIXTURE_METADATA:
            continue
        if target.startswith('linux') and path.startswith(('browser/mobile/android/', 'browser/taskarian/android/')):
            continue
        entries.append(entry)
    return {'schema': 'taskarian-browser-resources-1', 'target': target,
            'resourceSha256': hashlib.sha256(b'\0'.join(entries)).hexdigest(),
            'productVersion': version(revision), 'gecko': inputs('gecko', target, revision),
            'companion': companion}


def native_key(target, revision=None):
    return module('component-store').identity('gecko', target, inputs('gecko', target, revision))['inputSha256']


def reference(result):
    return {key: result[key] for key in ('repository', 'manifestName', 'manifestSha256')}


def cache_contract(target):
    revision = source()
    rust = json.loads(text(revision, 'agent/machines/rust-toolchain/sources.json'))
    contract = {'schema': 1, 'engine': 'sccache', 'target': target, 'sccacheVersion': '0.17.0',
                'rust': {'version': rust['version'], 'commit': rust['commit']}}
    if target.startswith('android'):
        contract['mozconfig'] = hashlib.sha256(text(revision, 'browser/taskarian/android/mozconfig').encode()).hexdigest()
    else:
        contract['flags'] = ['--enable-application=browser', '--enable-optimize', '--disable-debug',
                             '--disable-crashreporter', '--disable-tests', '--disable-debug-symbols']
    return contract


def legacy_cache_contract(target):
    # The 54e2dd6 engine-only jobs keyed their first disk/backups on 153.6.0esr.
    # Retain that exact historical alias; native sccache validates each object.
    return {**cache_contract(target), 'mozillaVersion': LEGACY_CACHE_MOZILLA_VERSION}


def restore_cache(directory, target):
    helper = module('compiler-cache')
    for contract in (cache_contract(target), legacy_cache_contract(target)):
        if helper.restore('sccache', target, contract, directory):
            return True
    return False


def remember(result, directory, kind):
    file = Path(directory).parent / (kind + '-release-reference.json')
    file.write_text(json.dumps(reference(result), indent=2) + '\n')
    if os.environ.get('GITHUB_ENV'):
        with Path(os.environ['GITHUB_ENV']).open('a') as output:
            output.write('TASKARIAN_' + kind.upper().replace('-', '_') + '_RELEASE_REFERENCE=' + str(file.resolve()) + '\n')
    return file


def engine_record(result, directory, target):
    browser = module('browser-component')
    directory = Path(directory)
    browser.verify_checksums(directory)
    if target.startswith('android'):
        native = module('android-native-component')
        record = json.loads((directory / 'native-gecko.json').read_text())
        payload = directory / 'gecko-libraries.apk'
        if record['source'] != result['manifest']['sourceCommit']:
            raise ValueError('Android engine native source differs from its release')
        record.setdefault('producer', {
            'kind': 'component-release', 'source': record['source'],
            'repository': result['repository'], 'run': result['manifest']['producer']['run'],
            'release': reference(result),
            'manifest_sha256': hashlib.sha256((directory / 'native-gecko.json').read_bytes()).hexdigest(),
            'apk_sha256': hashlib.sha256(payload.read_bytes()).hexdigest()})
        native.verify_libraries(payload, record, target)
        native.install_native(directory.parent, payload, record)
        return
    manifest = dict(line.split('=', 1) for line in (directory / 'browser-artifact-manifest.txt').read_text().splitlines())
    archive, = directory.glob('taskarian*.tar.*')
    origin = result['manifest']['sourceCommit']
    if manifest['taskarian_commit'] != origin or inputs('gecko', target, origin) != inputs('gecko', target):
        raise ValueError('Stored Gecko producer compiler inputs differ')
    record = {'schema': 1, 'target': target, 'source': origin, 'resourceSource': source(),
              'inputSha256': browser.linux_engine_inputs(origin, target),
              'nativeFiles': browser.native_elf_inventory(archive), 'producer': result['manifest']['producer'],
              'componentRelease': reference(result)}
    producer = record['producer']
    if (producer.get('source') != origin or producer.get('runSource') != origin or
            not producer.get('steps', {}).get('build') or
            producer.get('steps', {}).get('verify', {}).get('conclusion') != 'success' or
            producer.get('steps', {}).get('upload', {}).get('conclusion') != 'success'):
        raise ValueError('Stored Linux engine lacks its original native checkpoint')
    xpts = list(directory.glob('*.xpt_artifacts.zip'))
    if len(xpts) > 1:
        raise ValueError('Duplicate Gecko interface metadata')
    receipt = directory.parent / browser.NATIVE_ENGINE_RECEIPT
    receipt.write_text(json.dumps(record, indent=2) + '\n')
    with Path(os.environ['GITHUB_ENV']).open('a') as output:
        output.write(f'MOZ_ARTIFACT_FILE={archive.resolve()}\nTASKARIAN_LINUX_NATIVE_RECEIPT={receipt.resolve()}\n')
        if xpts:
            output.write(f'TASKARIAN_LINUX_XPT_ARTIFACT={xpts[0].resolve()}\n')


def restore_engine(directory, target):
    directory = Path(directory)
    result = module('component-store').restore('gecko', target, inputs('gecko', target), directory / 'producer',
                    roles=('runtime', 'metadata', 'build-support'), requested_source=source())
    if result is None:
        shutil.rmtree(directory / 'producer', ignore_errors=True)
        return False
    try:
        engine_record(result, directory / 'producer', target)
    except (ValueError, KeyError, TypeError, OSError, tarfile.TarError, zipfile.BadZipFile) as error:
        shutil.rmtree(directory / 'producer', ignore_errors=True)
        print('Unusable optional Gecko release:', error, flush=True)
        return False
    remember(result, directory, 'gecko')
    print('Reused durable Gecko component:', result['url'], flush=True)
    return True


def restore_resources(directory, target):
    if target.startswith('android'):
        return False  # Final APK lookup occurs after its exact companion is known.
    store, browser = module('component-store'), module('browser-component')
    result = store.restore('browser-resources', target, inputs('browser-resources', target), directory,
                           roles=('runtime', 'metadata', 'build-support'), requested_source=source())
    if result is None:
        for file in Path(directory).iterdir():
            shutil.rmtree(file) if file.is_dir() else file.unlink()
        return False
    try:
        browser.verify(directory, target, browser.fingerprint(target))
    except (OSError, ValueError, KeyError, TypeError, tarfile.TarError, zipfile.BadZipFile) as error:
        for file in Path(directory).iterdir():
            shutil.rmtree(file) if file.is_dir() else file.unlink()
        print('Unusable optional browser resource release:', error, flush=True)
        return False
    remember(result, directory, 'browser-resources')
    return True


def engine_available(target):
    return module('component-store').lookup('gecko', target, inputs('gecko', target)) is not None


def android_companion(directory, target):
    """Use full notices and package identities from the actual published backend."""
    directory = Path(directory)
    architecture = 'x86_64' if target == 'android-x86_64' else 'aarch64'
    termux = 'termux-' + architecture
    application, store = module('application'), module('component-store')
    deadline = time.monotonic() + 300 * 60
    while store.lookup('application', termux, application.inputs(termux)) is None:
        if time.monotonic() >= deadline:
            raise ValueError('Timed out waiting for the exact paired Termux application')
        print('Waiting for the exact paired Termux application manifest', flush=True)
        time.sleep(30)
    result = store.restore('application', termux, application.inputs(termux), directory,
                           roles=('runtime', 'metadata', 'legal'))
    if result is None:
        raise ValueError('The exact paired Termux application is not published yet')
    backend = [file for file in directory.glob('*.deb') if file.name.startswith('taskarian_')]
    operating_system = [file for file in directory.glob('*.deb') if file.name.startswith('taskarian-os_')]
    if len(backend) != 1 or len(operating_system) != 1:
        raise ValueError('Expected the actual paired backend and OS packages')
    release = module('release')
    os_identity = release.termux_os_identity(operating_system[0])
    with tempfile.TemporaryDirectory(prefix='android-companion-') as temporary:
        subprocess.run(['dpkg-deb', '-x', str(backend[0]), temporary], check=True)
        app = Path(temporary) / 'data/data/com.termux/files/usr/lib/taskarian'
        licenses = app / 'licenses.json'
        records = json.loads(licenses.read_text())
        if not isinstance(records, list) or not records:
            raise ValueError('Paired backend lacks its complete actual license inventory')
        destination = Path(os.environ['TASKARIAN_COMPANION_LICENSES'])
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(licenses, destination)
    pairing = release.validate_termux_update({
        'schema': 1, 'productVersion': version(source()), 'sourceCommit': source(),
        'integrationIteration': False,
        'bootstrapSha256': hashlib.sha256((ROOT / 'agent/src/server/platform/termux/updates-bootstrap.mjs').read_bytes()).hexdigest(),
        'architecture': architecture, 'apkAbi': 'x86_64' if architecture == 'x86_64' else 'arm64-v8a',
        'packages': [
            {'name': 'taskarian', 'version': version(source()), 'architecture': architecture,
             'sourceCommit': source(), 'sha256': store.sha(backend[0])},
            {'name': 'taskarian-os', 'version': os_identity['version'], 'architecture': architecture,
             'sourceCommit': os_identity['sourceCommit'], 'sha256': store.sha(operating_system[0]),
             'installedManifestSha256': os_identity['installedManifestSha256']}]})
    (destination.parent / 'termux-update.json').write_text(json.dumps(pairing, indent=2) + '\n')
    remember(result, directory, 'termux-application')


def dependencies(directories):
    found = {}

    def visit(value):
        if isinstance(value, dict):
            if all(key in value for key in ('repository', 'manifestName', 'manifestSha256')):
                found[(value['repository'], value['manifestName'])] = reference(value)
            for child in value.values():
                visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)

    for directory in directories:
        for file in Path(directory).rglob('*.json'):
            try:
                visit(json.loads(file.read_text()))
            except (ValueError, UnicodeError):
                continue
    for name in ('GECKO', 'BROWSER_RESOURCES', 'TERMUX_APPLICATION'):
        if os.environ.get('TASKARIAN_' + name + '_RELEASE_REFERENCE'):
            visit(json.loads(Path(os.environ['TASKARIAN_' + name + '_RELEASE_REFERENCE']).read_text()))
    return list(found.values())


def source_legal(directory, revision, target):
    """Retain complete corresponding source and full native notice inputs."""
    browser = module('browser-component')
    browser.ensure_source(revision)
    name = 'browser-source-' + revision + '.tar.gz'
    paths = ['browser', 'references/connector', 'references/vendor/translators', 'references/legal',
             'references/web/theme.css', 'agent/packaging', 'agent/machines/rust-toolchain',
             'agent/search/third_party/unsloth-studio', 'LICENSE', 'AGENTS.md']
    module('source_archive').archive_revision(ROOT, revision, directory / name, paths=paths)
    legal = 'browser-licenses-' + revision + '.tar.gz'
    paths = ['LICENSE', 'browser/LICENSE', 'browser/COPYING', 'browser/taskarian/packaging',
             'browser/taskarian/android/notices', 'browser/toolkit/content/license.html',
             'browser/taskarian/SOURCE-NOTICE', 'agent/machines/rust-toolchain',
             'agent/search/third_party/unsloth-studio']
    module('source_archive').archive_revision(ROOT, revision, directory / legal, paths=paths)
    pin = json.loads(text(revision, 'agent/machines/rust-toolchain/sources.json'))
    rust = module('source_cache').fetch(pin)
    shutil.copy2(rust, directory / pin['file'])
    return {name: 'source', legal: 'legal', pin['file']: 'source'}


def checkpoint_proof(directory, target):
    browser = module('browser-component')
    repository, run_id = os.environ['GITHUB_REPOSITORY'], int(os.environ['GITHUB_RUN_ID'])
    run = browser.api(f'repos/{repository}/actions/runs/{run_id}')
    if target.startswith('android'):
        evidence = module('android-native-component').early_producer(repository, run)
    else:
        evidence = browser.completed_producer(repository, run, target)
    if not evidence:
        raise ValueError('Native build/verify/upload checkpoint has not completed')
    manifest = directory / ('native-gecko.json' if target.startswith('android') else 'browser-artifact-manifest.txt')
    archive = directory / 'gecko-libraries.apk' if target.startswith('android') else next(directory.glob('taskarian*.tar.*'))
    return {'repository': repository, 'run': run_id, 'source': source(), 'runSource': source(),
            'archive': archive.name, 'archiveSha256': hashlib.sha256(archive.read_bytes()).hexdigest(),
            'manifestSha256': hashlib.sha256(manifest.read_bytes()).hexdigest(), 'steps': evidence}


def packaged_legal(directory, staging, target):
    captured = list(Path(directory).glob('gecko-built-license-*.html'))
    if captured:
        for page in captured:
            destination = staging / page.name
            if not destination.exists() or not page.samefile(destination):
                shutil.copy2(page, destination)
        return {page.name: 'legal' for page in captured}
    archives = []
    if target.startswith('linux'):
        package, = Path(directory).glob('taskarian*.tar.*')
        with tarfile.open(package) as source_archive:
            for member in source_archive:
                if member.name in ('taskarian/omni.ja', 'taskarian/browser/omni.ja'):
                    archives.append((member.name, source_archive.extractfile(member).read()))
    else:
        apks = list(Path(directory).glob('taskarian_*.apk'))
        if apks:
            with zipfile.ZipFile(apks[0]) as app:
                archives.append(('omni.ja', app.read('assets/omni.ja')))
        else:
            obj = Path(os.environ['TASKARIAN_ANDROID_OBJDIR'])
            for omni in (obj / 'dist/geckoview').rglob('omni.ja'):
                archives.append((omni.name, omni.read_bytes()))
    result = {}
    for index, (_, contents) in enumerate(archives):
        with zipfile.ZipFile(io.BytesIO(contents)) as archive:
            for name in archive.namelist():
                if name.endswith('/license.html'):
                    output = f'browser-full-license-{index}-{len(result)}.html'
                    (staging / output).write_bytes(archive.read(name))
                    result[output] = 'legal'
    if not result:
        raise ValueError('Native browser package lacks its complete built license page')
    return result


def publish(kind, directory, target):
    store = module('component-store')
    directory = Path(directory)
    revision = source()
    identity = inputs(kind, target)
    if kind != 'gecko' and target.startswith('android'):
        app, = directory.glob('taskarian_*.apk')
        release = module('release')
        with zipfile.ZipFile(app) as package:
            pairing = release.validate_termux_update(json.loads(package.read(release.TERMUX_UPDATE_ASSET)))
        identity = inputs(kind, target, companion=pairing)
    found = store.lookup(kind, target, identity)
    if found:
        remember(found, directory, kind)
        return found
    producer = None
    if kind == 'gecko':
        receipt = os.environ.get('TASKARIAN_LINUX_NATIVE_RECEIPT') if target.startswith('linux') else None
        if receipt:
            origin = json.loads(Path(receipt).read_text())
            directory = Path(receipt).parent / 'producer'
            revision, producer = origin['source'], origin['producer']
        elif target.startswith('android') and os.environ.get('TASKARIAN_ANDROID_NATIVE_RECEIPT'):
            origin = json.loads(Path(os.environ['TASKARIAN_ANDROID_NATIVE_RECEIPT']).read_text())
            revision, producer = origin['source'], origin.get('producer')
            if producer is None:
                raise ValueError('Borrowed Android engine lacks its original producer')
        else:
            producer = checkpoint_proof(directory, target)
        if inputs(kind, target, revision) != identity:
            raise ValueError('Native source does not match the requested compiler inputs')
    with tempfile.TemporaryDirectory(prefix='browser-release-') as temporary:
        staging = Path(temporary)
        assets = {}
        for file in directory.iterdir():
            if file.is_file():
                try:
                    os.link(file, staging / file.name)
                except OSError:
                    shutil.copy2(file, staging / file.name)
                assets[file.name] = 'runtime'
        assets.update(source_legal(staging, revision, target))
        assets.update(packaged_legal(directory, staging, target))
        dependencies = []
        ref = os.environ.get('TASKARIAN_GECKO_RELEASE_REFERENCE')
        if kind != 'gecko' and ref:
            dependencies.append(json.loads(Path(ref).read_text()))
        result = store.publish(kind, target, version(revision, kind == 'gecko'), identity, staging,
                               assets=assets, source_commit=revision, producer=producer, dependencies=dependencies)
    remember(result, directory, kind)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['inputs', 'native-key', 'require-engine', 'cache-contract', 'restore-cache', 'restore-engine', 'seed-engine', 'publish-engine',
                                         'publish-resources', 'android-companion', 'dependencies'])
    parser.add_argument('target')
    parser.add_argument('--directory', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--producer-source')
    parser.add_argument('--producer-run', type=int)
    parser.add_argument('--producer-artifact', type=int)
    args = parser.parse_args()
    if args.action == 'inputs':
        print(json.dumps(inputs('gecko', args.target), indent=2)); return
    if args.action == 'native-key':
        print(native_key(args.target)); return
    if args.action == 'require-engine':
        if not engine_available(args.target):
            raise ValueError('Required Gecko component is not published; complete its engine_only producer first')
        print('Required canonical Gecko component is published'); return
    if args.action == 'cache-contract':
        value = cache_contract(args.target)
        args.output.write_text(json.dumps(value, indent=2) + '\n')
        if os.environ.get('GITHUB_OUTPUT'):
            legacy = hashlib.sha256(module('component-store').canonical(legacy_cache_contract(args.target))).hexdigest()
            with Path(os.environ['GITHUB_OUTPUT']).open('a') as output:
                output.write('legacy_digest=' + legacy + '\n')
        print(hashlib.sha256(module('component-store').canonical(value)).hexdigest()); return
    if args.action == 'restore-cache':
        print(json.dumps({'hit': restore_cache(args.directory, args.target)})); return
    if args.action == 'seed-engine':
        if not all((args.directory, args.producer_source, args.producer_run, args.producer_artifact)):
            parser.error('seed-engine requires --directory and an exact --producer-source/run/artifact')
        module('android-native-component').seed_checkpoint(args.directory, args.target, args.producer_source,
                                                          args.producer_run, args.producer_artifact)
        publish('gecko', args.directory, args.target); return
    if args.action == 'android-companion':
        android_companion(args.directory, args.target); return
    if args.action == 'dependencies':
        args.output.write_text(json.dumps(dependencies([args.directory]), indent=2) + '\n'); return
    if args.action == 'restore-engine':
        hit = restore_engine(args.directory, args.target)
        print(json.dumps({'hit': hit})); return
    publish('gecko' if args.action == 'publish-engine' else 'browser-resources', args.directory, args.target)


if __name__ == '__main__':
    main()
