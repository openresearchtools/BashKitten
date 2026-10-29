#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Build the pinned native Collabora server and engine with upstream build owners.

Work stays outside the source checkout. An existing build tree and compiler
cache are reused; source imports are never patched in place.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import tarfile
import tempfile

import source_graph
import runtime_metadata
import branding

ROOT = Path(__file__).resolve().parents[3]
PREFIX = '/usr/lib/bashkitten/office/runtime'
PATCHES = [
    'files/patches/collabora/0001-native-locked-light-theme.patch',
    'office/patches/0001-native-extensions-small-screen-dialog.patch',
    'office/patches/0002-native-proof-key-path.patch',
    'office/patches/0004-native-document-property-undo.patch',
    'office/patches/0005-native-field-command-undo.patch',
    'office/patches/0006-source-archive-build-id.patch',
    'office/patches/0007-native-ooxml-user-attributes.patch',
    'office/patches/0008-native-bounded-config-cache-keys.patch',
    'office/patches/0009-native-uno-undo-view.patch',
    'office/patches/0010-native-uno-shape-undo.patch',
    'office/patches/0011-native-online-openssl-headers.patch',
    'office/patches/0016-native-text-edit-state.patch',
    'office/patches/0018-native-attribute-undo-text.patch',
    'office/patches/0019-native-product-branding.patch',
    'office/patches/0020-native-branding-installer-identity.patch',
    'office/patches/0021-native-user-preset-extensions.patch',
    'office/patches/0022-native-python-platform-launchers.patch',
    'office/patches/0023-native-extension-dialog-commands.patch',
    'office/patches/0024-native-extension-short-dialog-frame.patch',
    'office/patches/0025-native-extension-overflow-group-id.patch',
]
ENGINE_OPTIONS = ['--with-distro=CPLinux-LOKit', '--disable-epm',
                  '--without-package-format', '--disable-symbols',
                  '--without-export-validation']


def run(command, cwd=None, env=None):
    print('+', ' '.join(map(str, command)), flush=True)
    subprocess.run(list(map(str, command)), cwd=cwd, env=env, check=True)


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n')


def patch_source(source):
    # A later named patch can deliberately change an earlier patch's context;
    # reverse-applicability no longer tells us whether that earlier patch was
    # applied. Reconstruct the ordered native patch inputs, accepting only
    # pristine or known intermediate bytes in the reusable build tree.
    paths = set()
    for name in PATCHES:
        for relative in re.findall(r'^(?:---|\+\+\+) [ab]/([^\t\n]+)', (ROOT / name).read_text(), re.M):
            if Path(relative).is_absolute() or '..' in Path(relative).parts:
                raise ValueError('Named Office patch leaves its source tree')
            paths.add(relative)

    def signature(path):
        if path.is_symlink():
            raise ValueError('Named Office patch input must be an ordinary file: ' + str(path))
        return source_graph.digest(path) if path.is_file() else None

    with tempfile.TemporaryDirectory(prefix='.office-patches-', dir=source.parent) as directory:
        expected = Path(directory)
        for relative in sorted(paths):
            pristine = source_graph.SOURCE / relative
            if pristine.is_file():
                destination = expected / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(pristine, destination)
        allowed = {relative: {signature(expected / relative)} for relative in paths}
        for name in PATCHES:
            run(['patch', '--batch', '--fuzz=0', '--forward', '-p1', '-i', ROOT / name], cwd=expected)
            for relative in sorted(paths):
                allowed[relative].add(signature(expected / relative))
        actual = {relative: signature(source / relative) for relative in sorted(paths)}
        for relative in sorted(paths):
            if actual[relative] not in allowed[relative]:
                raise ValueError('Prepared Office source has an unknown edit: ' + relative)
        for relative in sorted(paths):
            destination = source / relative
            if actual[relative] != signature(expected / relative):
                if not (expected / relative).is_file():
                    destination.unlink()
                else:
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(expected / relative, destination)


def prepare(work, cache):
    source_graph.verify_source()
    source_graph.prepare_cache(cache)
    source = work / 'source'
    pin = json.loads((source_graph.UPSTREAM / 'online/source.json').read_text())
    stamp = work / 'upstream-tree.json'
    if stamp.exists() and json.loads(stamp.read_text())['tree'] != pin['tree']:
        raise ValueError('Existing build tree belongs to another upstream pin; select its own work directory')
    if not source.exists():
        run(['cp', '-a', '--reflink=auto', source_graph.SOURCE, source])
    elif not stamp.exists():
        # Adopting the already running local build is permitted only when its
        # exact source pin was recorded by the existing build environment.
        raise ValueError('Existing build tree lacks upstream-tree.json; verify its pin before adoption')
    write_json(stamp, {'tree': pin['tree'], 'commit': pin['commit']})
    # Upstream's archive build entry point for the native version/hash reply.
    (source / 'dist_git_hash').write_text(pin['commit'][:10] + '\n')
    patch_source(source)
    return source


def configure_engine(source, cache, jobs, env):
    run(['sh', './autogen.sh', *ENGINE_OPTIONS, *branding.engine_options(), '--with-parallelism=' + str(jobs),
         '--with-external-tar=' + str(cache)], cwd=source / 'engine', env=env)
    selected = source_graph.engine_inputs(source / 'engine/config_host.mk')
    retained = {row['name']: row['sha256'] for row in source_graph.verify_dependencies()['components']}
    if any(retained.get(row['name']) != row['sha256'] for row in selected):
        raise ValueError('Configured native dependency graph contains an unmaterialized source')
    branding.verify_engine(source)


def build_online(source, jobs, env):
    run(['./autogen.sh'], cwd=source, env=env)
    run(['./configure', '--prefix=' + PREFIX, '--sysconfdir=' + PREFIX + '/etc',
         '--localstatedir=' + PREFIX + '/var', '--disable-tests',
         *branding.online_options(),
         '--with-lo-builddir=' + str(source / 'engine'),
         '--with-lokit-path=' + str(source / 'engine/include'),
         '--with-lo-path=' + PREFIX + '/engine'], cwd=source, env=env)
    branding.verify_online(source)
    run(['make', '-j' + str(jobs)], cwd=source, env=env)
    run(['make', 'sbom-check'], cwd=source, env=env)


def inventory(root):
    records = {}
    for path in sorted(root.rglob('*')):
        relative = str(path.relative_to(root))
        if path.is_symlink():
            target = os.readlink(path)
            if Path(target).is_absolute() or not path.resolve().is_relative_to(root.resolve()):
                raise ValueError('Runtime symlink leaves its component: ' + relative)
            records[relative] = {'symlink': target}
        elif path.is_file():
            records[relative] = {'sha256': source_graph.digest(path), 'mode': oct(path.stat().st_mode & 0o777)}
    return records


def prepare_stage(source, work, stage_dir=None):
    stage = stage_dir.resolve() if stage_dir else work / 'stage'
    source = source.resolve()
    if (stage.is_relative_to(ROOT) or ROOT.is_relative_to(stage)
            or stage.is_relative_to(source) or source.is_relative_to(stage)):
        raise ValueError('Package stage must be outside the source checkout and prepared source')
    marker = stage / '.bashkitten-office-stage.json'
    owner = {'schema': 1, 'owner': 'bashkitten-office-build',
             'work': str(work.resolve()), 'source': str(source)}
    if stage.exists() and not stage.is_dir():
        raise ValueError('Package stage is not a directory')
    if stage_dir and stage.exists() and any(stage.iterdir()):
        try:
            recorded = json.loads(marker.read_text())
        except (OSError, ValueError) as error:
            raise ValueError('Refusing to replace a nonempty, unowned package stage') from error
        if recorded != owner:
            raise ValueError('Package stage belongs to a different native build')
    if stage.exists():
        shutil.rmtree(stage)
    stage.mkdir(parents=True)
    write_json(marker, owner)
    return stage


def package(source, work, output, architecture, env, stage_dir=None):
    branding.verify_engine(source)
    branding.verify_online(source)
    # Package-only iterations can pick up a named native installer-template
    # correction after configure. Regenerate it with its saved native settings.
    run(['./config.status', 'instsetoo_native/util/openoffice.lst'], cwd=source / 'engine', env=env)
    run(['make', 'Package_instsetoo_native_setup'], cwd=source / 'engine', env=env)
    runtime_metadata.remove_windows_python_launchers(source / 'engine/instdir', 'linux')
    run(['make', 'LIBO_TEST_INSTALL=TRUE', 'CustomTarget_instsetoo_native/sbom'], cwd=source / 'engine', env=env)
    stage = prepare_stage(source, work, stage_dir)
    run(['make', 'DESTDIR=' + str(stage), 'install'], cwd=source, env=env)
    runtime = stage / PREFIX.removeprefix('/')
    shutil.copytree(source / 'engine/instdir', runtime / 'engine', symlinks=True)
    if 'buildid=' + env['SOURCE_REVISION'] not in (runtime / 'engine/program/versionrc').read_text():
        raise ValueError('Native engine build id differs from its verified source revision')
    required = ['bin/coolwsd', 'bin/coolforkit-ns', 'bin/coolforkit-caps', 'bin/coolmount',
                'bin/coolwsd-systemplate-setup', 'etc/coolwsd/coolwsd.xml',
                'engine/program/libmergedlo.so', 'share/coolwsd/browser/dist/cool.html',
                'share/coolwsd/collabora-online-sbom.spdx.json']
    for relative in required:
        if not (runtime / relative).is_file():
            raise ValueError('Missing native runtime output: ' + relative)
    if not list((runtime / 'engine/sbom').glob('*.json')):
        raise ValueError('Native engine SBOM generation produced no installed output')
    legal = runtime / 'legal'
    legal.mkdir()
    for name in ['COPYING', 'LICENSE', 'THIRDPARTYLICENSES', 'NOTICE']:
        if (source / name).is_file():
            shutil.copy2(source / name, legal / name)
    shutil.copy2(source / 'engine/readlicense_oo/license/license.xml', legal / 'engine-license.xml')
    runtime_metadata.notices(source, runtime)
    branding.verify_runtime(runtime)
    depends = runtime_metadata.linux_dependencies(runtime, work)
    pin = json.loads((source_graph.UPSTREAM / 'online/source.json').read_text())
    manifest = {
        'schema': 1, 'apiVersion': 1, 'revision': pin['commit'],
        'component': 'collabora-online', 'target': 'linux', 'architecture': architecture,
        'sourceCommit': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
        'development': bool(subprocess.check_output(['git', 'status', '--porcelain', '--',
            'agent/packaging/office', 'agent/packaging/source_cache.py', 'office/upstream', 'office/patches', 'office/branding',
            'files/patches/collabora', 'agent/packaging/termux/native_toolchain.py',
            'agent/packaging/node/lock.json', 'agent/vendor/node/libcxx'], cwd=ROOT, text=True).strip()),
        'upstream': pin, 'compiledPrefix': PREFIX,
        'paths': {'coolwsd': 'bin/coolwsd', 'forkitNamespace': 'bin/coolforkit-ns',
                  'forkitCapabilities': 'bin/coolforkit-caps', 'mount': 'bin/coolmount',
                  'systemplateSetup': 'bin/coolwsd-systemplate-setup', 'engine': 'engine',
                  'web': 'share/coolwsd', 'config': 'etc/coolwsd/coolwsd.xml'},
        'configuration': {'proofKey': 'proof_key.path', 'systemplate': 'sys_template_path',
                          'jails': 'child_root_path', 'engine': '--lo-template-path',
                          'browserRoot': 'file_server_root_path'},
        'engineOptions': [*ENGINE_OPTIONS, *branding.engine_options()],
        'branding': branding.metadata(),
        'depends': depends,
        'dependencyManifestSha256': source_graph.digest(source_graph.DEPENDENCIES / 'sources.json'),
        'patches': [Path(name).stem.split('-', 1)[1] for name in PATCHES],
        'patchInputs': [{'file': name, 'sha256': source_graph.digest(ROOT / name)} for name in PATCHES],
        'toolchain': {name: subprocess.check_output([name, '--version'], text=True).splitlines()[0]
                      for name in ['gcc', 'g++', 'make', 'node', 'npm']},
        'files': inventory(runtime),
    }
    write_json(runtime / 'manifest.json', manifest)
    output.mkdir(parents=True, exist_ok=True)
    name = f'office-linux-{architecture}.tar.xz'
    with tarfile.open(output / name, 'w:xz', preset=3) as archive:
        archive.add(runtime, arcname='runtime')
    write_json(output / (name + '.json'), {key: value for key, value in manifest.items() if key != 'files'})
    checksums = []
    for artifact in [output / name, output / (name + '.json')]:
        checksums.append(source_graph.digest(artifact) + '  ' + artifact.name)
    (output / 'SHA256SUMS').write_text('\n'.join(checksums) + '\n')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work', required=True, type=Path)
    parser.add_argument('--cache', required=True, type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--stage-dir', type=Path, help='External package stage; defaults to WORK/stage')
    parser.add_argument('--jobs', type=int, default=min(os.cpu_count() or 1, 8))
    parser.add_argument('--phase', choices=['prepare', 'engine', 'online', 'package', 'all'], default='all')
    args = parser.parse_args()
    work, cache = args.work.resolve(), args.cache.resolve()
    if work.is_relative_to(ROOT) or cache.is_relative_to(ROOT):
        parser.error('Build work and cache must be outside the source checkout')
    architecture = {'x86_64': 'amd64', 'aarch64': 'arm64'}.get(platform.machine())
    if architecture is None or platform.system() != 'Linux':
        parser.error('Run on the native Linux target; Termux uses its separate Bionic recipe')
    work.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, 'CC': 'ccache gcc', 'CXX': 'ccache g++', 'GOTELEMETRY': 'off', 'DO_NOT_TRACK': '1',
           'npm_config_audit': 'false', 'npm_config_fund': 'false', 'npm_config_update_notifier': 'false',
           'GIT_CEILING_DIRECTORIES': str(work),
           'SOURCE_REVISION': json.loads((source_graph.UPSTREAM / 'online/source.json').read_text())['commit']}
    source = prepare(work, cache)
    if args.phase in ['engine', 'all']:
        configure_engine(source, cache, args.jobs, env)
        run(['make', '-j' + str(args.jobs), 'build'], cwd=source / 'engine', env=env)
    if args.phase in ['online', 'all']:
        build_online(source, args.jobs, env)
    if args.phase in ['package', 'all']:
        if not args.output:
            parser.error('--output is required for packaging')
        package(source, work, args.output.resolve(), architecture, env, args.stage_dir)


if __name__ == '__main__':
    main()
