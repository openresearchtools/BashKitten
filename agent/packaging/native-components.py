#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Architecture-worker adapter for the existing native component build owners."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import shlex
import subprocess
import sys
import tarfile
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(Path(__file__).parent))


def module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), Path(__file__).with_name(name + '.py'))
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


store = module('component-store')
native = module('native-component')
tools = module('native-tools')
MACHINES = ('podman', 'crun', 'conmon', 'netavark', 'aardvark-dns', 'passt', 'libfuse', 'fuse-overlayfs', 'catatonit')
AUTH = tuple('auth-' + name for name in native.AUTH)
OFFICE = ('office-engine', 'office-server', 'office-ui', 'office-integration', 'files-server', 'files-ui',
          'files-media', 'files-office-addon', 'files-integration', 'references')
APP = ('npm-runtime', 'photon', 'agent-resources')


def head():
    return native.git('rev-parse', 'HEAD')


def run(command, **kwargs):
    subprocess.run([str(value) for value in command], check=True, cwd=kwargs.pop('cwd', ROOT), **kwargs)


def inputs(component, target, revision=None):
    revision = revision or head()
    if component.startswith('android-'):
        return module('android-components').inputs(component, target, revision)
    if component == 'node':
        return {'schema': 1, 'component': component, 'target': target,
                'files': {name: native.entry(revision, name) for name in
                          ('agent/packaging/node', 'agent/vendor/node', 'agent/packaging/source_cache.py')},
                'recipe': native.native_toolchain(component, target, revision)}
    return native.inputs(component, target, revision)


component_inputs = inputs

def version(component, target, revision=None):
    revision = revision or head()
    if component.startswith('android-'):
        return module('android-components').version(component, target, revision)
    if component.startswith('auth-') and component != 'auth-remote':
        return json.loads(native.content(revision, 'auth/upstreams.lock.json'))[component[5:]]['version']
    if component == 'guest-fusermount':
        return json.loads(native.content(revision, 'agent/machines/vendor/libfuse/source.json'))['version']
    if component.startswith('os-'):
        names = {'dbusmenu': 'libdbusmenu', 'windowing': 'libxfce4windowing', 'panel': 'xfce4-panel'}
        return next(item['version'] for item in json.loads(native.content(revision, 'os/upstream/sources.json')) if item['name'] == names[component[3:]])
    if component.startswith('machines-'):
        return json.loads(native.content(revision, 'agent/machines/vendor/' + component[9:] + '/source.json'))['version']
    if component == 'node':
        return json.loads(native.content(revision, 'agent/packaging/node/lock.json'))[target.split('-')[0]]['node_version']
    if component in ('search', 'search-primp'):
        return next(item['version'] for item in json.loads(native.content(revision, 'agent/search/runtime-lock.json'))['packages'] if item['name'] == ('primp' if component == 'search-primp' else 'ddgs'))
    return native.content(revision, 'browser/taskarian/config/version.txt').strip()


def components(target):
    values = ['runtime-guard', *AUTH, 'auth', 'node', *(['search-primp'] if target.startswith('termux-') else []), 'search']
    if target.startswith('linux-'):
        values += [*('machines-' + name for name in MACHINES), 'machines', 'display', 'os-windowing', 'os-panel', 'os', 'guest-sudo', 'guest-fusermount', 'guest']
    else:
        values += ['os-dbusmenu', 'os-windowing', 'os-panel', 'os', 'loader', 'android-remote', 'android-tor', 'android-x11']
    return values


def reference(result):
    return {name: result[name] for name in ('repository', 'manifestName', 'manifestSha256')}


def restore_component(component, target, directory, roles=None):
    if component.startswith('android-'):
        return module('android-components').restore(component, target, directory)
    result = store.restore(component, target, inputs(component, target), directory,
                           roles=roles, requested_source=head())
    if result is None:
        return None
    # Keep provenance outside original archives and never relabel their producer.
    files = {item['name']: item['sha256'] for item in result['manifest']['assets']
             if (Path(directory) / item['name']).is_file()}
    receipt = {'schema': 1, 'component': component, 'target': target,
               'producerSource': result['manifest']['sourceCommit'], 'requestedSource': head(),
               'inputs': inputs(component, target), 'files': files, 'store': result}
    name = native.receipt_name(component, target)
    (Path(directory) / name).write_text(json.dumps(receipt, indent=2) + '\n')
    return result


def extract(archive, destination):
    Path(destination).mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive) as source:
        source.extractall(destination, filter='data')


def pack(directory, archive, root=None):
    with tarfile.open(archive, 'w:gz', compresslevel=1) as output:
        if root:
            output.add(directory, arcname=root)
        else:
            for file in sorted(Path(directory).iterdir()):
                output.add(file, arcname=file.name)


def archive_files(directory):
    return sorted(path for path in Path(directory).glob('*.tar.*')
                  if path.name.endswith(('.tar.gz', '.tar.xz', '.tar.zst', '.tar.bz2')))


def source_bundle(component, target, output):
    """Selected tracked source plus exact downloaded native dependency originals."""
    from source_archive import archive_revision
    from source_cache import fetch
    values = inputs(component, target)
    paths = [path for path, identity in values.get('files', {}).items() if identity]
    if component in ('auth', 'machines'):
        paths = ['auth/build/assemble.py'] if component == 'auth' else ['agent/packaging/machines/build.py']
    if component == 'runtime-guard' and target.startswith('termux-'):
        paths += ['agent/packaging/node/lock.json', 'agent/vendor/node/libcxx']
    if component.startswith('machines-'):
        paths += ['agent/packaging/machines/build.py', 'auth/build/go-notices.py']
    paths += ['LICENSE', 'agent/packaging/build.py', 'agent/packaging/component-store.py', 'agent/packaging/native-component.py',
              'agent/packaging/native-components.py', 'agent/packaging/native-tools.py',
              'agent/packaging/source_archive.py', 'agent/packaging/source_cache.py']
    original = Path(output) / f'{component}-tracked-source.tar.gz'
    archive_revision(ROOT, head(), original, paths=paths)
    pins = []
    if component.startswith('auth-'):
        name = component[5:]
        lock = json.loads((ROOT / 'auth/upstreams.lock.json').read_text())
        if name in lock and lock[name].get('archive'):
            pins.append({**lock[name], 'url': lock[name]['archive']})
        selected = values.get('records', {}).get('goPins', {})
        for item in selected.get('modules', []):
            pins += list(item['files'].values())
        pins += selected.get('moduleMetadata', [])
        if name in ('authelia', 'caddy', 'chisel', 'remote'):
            pins.append(json.loads((ROOT / 'auth/dependencies/go-toolchain/sources.json').read_text()))
        if name == 'authelia':
            pins += json.loads((ROOT / 'auth/dependencies/frontend/sources.json').read_text())['components']
        if target.startswith('termux-'):
            selected_commit = json.loads((ROOT / 'auth/build/termux-toolchain.json').read_text())['commit']
            pins += [item for item in json.loads((ROOT / 'auth/dependencies/termux/sources.json').read_text())['components'] if item['sourceCommit'] == selected_commit]
    if component.startswith('machines-'):
        name = component[9:]
        record = json.loads((ROOT / f'agent/machines/vendor/{name}/source.json').read_text())
        if record.get('vendor'):
            pins.append(record['vendor'])
        if name in ('netavark', 'aardvark-dns'):
            pins.append(json.loads((ROOT / 'agent/machines/rust-toolchain/sources.json').read_text()))
        if name == 'podman':
            pins.append(json.loads((ROOT / 'auth/dependencies/go-toolchain/sources.json').read_text()))
    if component in ('display', 'guest-sudo'):
        pins.append(json.loads((ROOT / 'agent/machines/rust-toolchain/sources.json').read_text()))
    archive = Path(output) / (f'auth-{target}-source.tar.gz' if component == 'auth' else f'{component}-source-{target}.tar.gz')
    with tarfile.open(archive, 'w:gz', compresslevel=1) as destination:
        destination.add(original, arcname=original.name)
        seen = set()
        for pin in pins:
            if pin['sha256'] in seen:
                continue
            seen.add(pin['sha256'])
            local = None
            if pin.get('file', '').startswith('proxy/'):
                # Go caches may normalize .mod/.info JSON; their exact retained
                # bytes are already pinned in Git. Only original zip inputs
                # need downloading when not present in the source cache.
                local = ROOT / 'auth/dependencies/go' / pin['file']
                if not pin.get('url'):
                    pin = {**pin, 'url': 'https://proxy.golang.org/' + pin['file'][6:]}
            file = fetch(pin, local=local)
            destination.add(file, arcname='originals/' + file.name)
    original.unlink()
    return archive


def legal_bundle(component, output):
    destination = Path(output) / f'{component}-legal.tar.gz'
    with tarfile.open(destination, 'w:gz', compresslevel=1) as legal:
        legal.add(ROOT / 'LICENSE', arcname='Taskarian-LICENSE')
        if component.startswith('os-'):
            for path in (ROOT / 'os/licenses').glob('*'):
                if path.is_file():legal.add(path, arcname='OS/' + path.name)
            names = {'dbusmenu': 'libdbusmenu', 'windowing': 'libxfce4windowing', 'panel': 'xfce4-panel'}
            for path in (ROOT / 'os/upstream' / names[component[3:]]).rglob('*'):
                if path.is_file() and path.name.upper().startswith(('COPYING', 'LICENSE', 'NOTICE')):
                    legal.add(path, arcname='upstream/' + str(path.relative_to(ROOT / 'os/upstream')))
        for archive in archive_files(output):
            if archive == destination or 'source' in archive.name:
                continue
            decoder = subprocess.Popen(['zstd', '-dc', str(archive)], stdout=subprocess.PIPE) if archive.name.endswith('.zst') else None
            with tarfile.open(name=None if decoder else archive, fileobj=decoder.stdout if decoder else None,
                              mode='r|' if decoder else 'r:*') as payload:
                for member in payload:
                    if member.isfile() and any(token in member.name.lower() for token in ('licens', 'copying', 'notice', 'copyright')):
                        data = payload.extractfile(member)
                        legal.addfile(member, data)
            if decoder and decoder.wait():
                raise ValueError('Native license archive decompression failed')
    return destination


def publish(component, target, output, dependencies=(), validation_only=False):
    output = Path(output)
    existing_sources = [path for path in output.glob('*source*.tar.*') if path.is_file()]
    if not existing_sources:
        source_bundle(component, target, output)
    legal = legal_bundle(component, output)
    assets = {}
    for file in output.iterdir():
        if (not file.is_file() or file.name == '.checksums.lock' or
                file.name.startswith('native-input-equivalence-')):
            continue
        assets[file.name] = ('legal' if file == legal else 'source' if 'source' in file.name else
                             'build-support' if 'build-support' in file.name else
                             'metadata' if file.suffix in ('.json', '.txt', '.sha256') or file.name in ('SHA256SUMS', '.checksums.lock') else 'runtime')
    return store.publish(component, target, version(component, target), inputs(component, target), output,
                         assets=assets, source_commit=head(), dependencies=[reference(value) for value in dependencies], validation_only=validation_only)


def build_primp(target, work):
    architecture = target.split('-')[1]
    framework = Path(work) / 'termux-packages'
    lock = json.loads((ROOT / 'agent/search/runtime-lock.json').read_text())['termuxPackages']
    run(['python3', 'auth/build/retained-sources.py', 'termux', '--commit', lock['commit'], '--output', framework])
    shutil.copytree(ROOT / 'agent/packaging/termux/search/python-primp', framework / 'packages/python-primp')
    env = {**os.environ, 'TERMUX_BUILDER_IMAGE_NAME': lock['builderImage'],
           'TERMUX_DOCKER_RUN_EXTRA_ARGS': '--volume ' + str(ROOT) + ':/taskarian:ro',
           'TERMUX_DOCKER_EXEC_EXTRA_ARGS': '--env TASKARIAN_SOURCE_ROOT=/taskarian'}
    run(['scripts/run-docker.sh', './build-package.sh', '-I', '-a', architecture, 'python-primp'], cwd=framework, env=env)
    stage = Path(work) / 'native'
    debs = list((framework / 'output').glob('python-primp_*_' + architecture + '.deb'))
    if len(debs) != 1:
        raise ValueError('Expected one native primp package')
    run(['dpkg-deb', '-x', debs[0], stage])
    return stage / 'data/data/com.termux/files/usr/lib/taskarian/search/runtime/site-packages'


def build_primp_component(target, work, output):
    native_path = build_primp(target, work)
    verified = Path(work) / 'verified-runtime'
    run(['python3', 'agent/search/build/runtime.py', target, '--output', verified, '--termux-native', native_path])
    payload = Path(work) / 'payload'; payload.mkdir()
    shutil.copy2(native_path / 'primp.abi3.so', payload / 'primp.abi3.so')
    # Reuse the actual runtime owner's complete source/legal collector.
    with subprocess.Popen(['zstd', '-dc', str(verified / f'search-runtime-{target}.tar.zst')], stdout=subprocess.PIPE) as decoder:
        with tarfile.open(fileobj=decoder.stdout, mode='r|') as source:
            for member in source:
                if member.isfile() and ('licens' in member.name.lower() or 'notice' in member.name.lower()):
                    target_file = payload / member.name
                    target_file.parent.mkdir(parents=True, exist_ok=True)
                    target_file.write_bytes(source.extractfile(member).read())
        if decoder.wait():raise ValueError('Native primp license collection failed')
    pack(payload, Path(output) / f'search-primp-{target}.tar.gz', 'primp')
    shutil.copy2(verified / f'search-source-{target}.tar.zst', Path(output) / f'search-primp-source-{target}.tar.zst')


def build_search(target, work, output):
    if target.startswith('linux-'):
        run(['python3', 'agent/search/build/runtime.py', target, '--output', output])
        return []
    incoming = Path(work) / 'primp'
    dependency = restore_component('search-primp', target, incoming, roles={'runtime', 'metadata'})
    if dependency is None:raise ValueError('Publish native primp first')
    for item in dependency['manifest']['assets']:
        if item['role'] == 'runtime':extract(incoming / item['name'], incoming)
    run(['python3', 'agent/search/build/runtime.py', target, '--output', output, '--termux-native', incoming / 'primp'])
    return [dependency]


def run_component(component, target, work, output, force=False):
    work, output = Path(work).resolve(), Path(output).resolve()
    if work.is_relative_to(ROOT) or output.is_relative_to(ROOT):
        raise ValueError('Native work/output must remain outside the source checkout')
    work.mkdir(parents=True, exist_ok=True); output.mkdir(parents=True, exist_ok=True)
    if component.startswith('android-'):
        return module('android-components').run(component, target, work, output, force)
    if not force:
        existing = restore_component(component, target, output)
        if existing:
            return existing
    if os.environ.get('GITHUB_ACTIONS') != 'true':
        raise ValueError('Native builds run only in architecture GitHub Actions workers')
    if native.git('status', '--porcelain', '--untracked-files=no'):
        raise ValueError('Build components from their committed source inputs')
    for path in output.iterdir():
        shutil.rmtree(path) if path.is_dir() else path.unlink()
    contract = tools.contract(component, target, lambda name: (ROOT / name).read_text())
    tools.setup(contract)
    dependencies = []
    architecture = target.split('-')[1]
    if component.startswith('auth-'):
        payload = work / 'payload'
        run(['auth/build/' + component[5:] + '.sh', target, payload])
        pack(payload, output / 'component.tar.gz')
    elif component == 'node':
        run(['python3', 'agent/packaging/node/build.py', '--platform', target.split('-')[0], '--architecture', architecture, '--output', output])
        archives = {file.name: store.sha(file) for file in output.glob('node-*.tar.gz')}
        provenance = output / f'node-provenance-{target}.json'
        provenance.write_text(json.dumps({'schema': 2, 'target': target, 'producerSource': head(),
            'inputs': inputs(component, target), 'archives': archives,
            'producer': {'repository': os.environ['GITHUB_REPOSITORY'], 'run': os.environ['GITHUB_RUN_ID']}}, indent=2) + '\n')
        with (output / 'SHA256SUMS').open('a') as sums:
            sums.write(store.sha(provenance) + '  ' + provenance.name + '\n')
    elif component == 'search-primp':
        build_primp_component(target, work, output)
    elif component == 'search':
        dependencies = build_search(target, work, output)
    elif component.startswith('machines-'):
        name = component[9:]; arguments = []
        if name == 'fuse-overlayfs':
            dependency = work / 'libfuse'
            value = restore_component('machines-libfuse', target, dependency)
            if value is None:
                raise ValueError('libfuse component must finish before fuse-overlayfs')
            dependencies.append(value)
            for file in dependency.glob('*.tar.gz'):
                if 'source' not in file.name and 'legal' not in file.name:
                    extract(file, dependency)
            arguments += ['--dependency-dir', dependency]
        run(['python3', 'agent/packaging/machines/build.py', '--architecture', architecture, '--component', name,
             '--work', work / 'native', '--output', output, '--jobs', '2', *arguments])
    elif component == 'display':
        run(['python3', 'browser/taskarian/display/build.py', '--work-dir', work / 'native', '--output', output])
    elif component == 'runtime-guard':
        payload = work / 'guard'; (payload / 'bin').mkdir(parents=True)
        arguments = ['cc']; env = None
        if target.startswith('termux-'):
            from types import SimpleNamespace
            sdk = Path(os.environ['ANDROID_HOME'])
            run([sdk / 'cmdline-tools/latest/bin/sdkmanager', 'ndk;30.0.16248370'])
            spec = importlib.util.spec_from_file_location('guard_ndk', ROOT / 'agent/packaging/termux/native_toolchain.py')
            cross = importlib.util.module_from_spec(spec); spec.loader.exec_module(cross)
            env, provenance = cross.build_environment(SimpleNamespace(ndk=sdk / 'ndk/30.0.16248370',
                ndk_archive=None, architecture=architecture, work=work / 'toolchain'))
            arguments = shlex.split(env['CC']) + shlex.split(env['CPPFLAGS']) + shlex.split(env['CFLAGS'])
        arguments += ['-std=c11', '-Wall', '-Wextra', '-Werror', '-O2',
                      str(ROOT / 'agent/src/server/access/runtime-guard.c')]
        if env:
            arguments += shlex.split(env['LDFLAGS']) + ['-Wl,-z,max-page-size=16384']
        arguments += ['-o', str(payload / 'bin/runtime-guard')]
        run(arguments, env=env)
        legal = payload / 'share/licenses/runtime-guard'; legal.mkdir(parents=True)
        shutil.copy2(ROOT / 'LICENSE', legal / 'LICENSE')
        metadata = payload / 'share/metadata'; metadata.mkdir(parents=True)
        if target.startswith('linux-'):
            control = work / 'debian'; control.mkdir()
            (control / 'control').write_text('Source: taskarian\nSection: utils\nPriority: optional\nMaintainer: Taskarian\n\nPackage: taskarian-runtime-guard\nArchitecture: any\nDescription: native process lifecycle helper\n')
            text = subprocess.check_output(['dpkg-shlibdeps', '-O', '-e' + str(payload / 'bin/runtime-guard')], cwd=work, text=True)
            (metadata / 'runtime-guard.dependencies').write_text(text.removeprefix('shlibs:Depends='))
        else:
            (metadata / 'runtime-guard.dependencies').write_text('\n')
            (metadata / 'runtime-guard-toolchain.json').write_text(json.dumps(provenance, indent=2) + '\n')
        pack(payload, output / 'runtime-guard.tar.gz')
    elif component.startswith('os-'):
        dependencies = build_os_unit(component, target, work, output)
    elif component == 'os':
        dependencies = build_os_package(target, work, output)
    elif component in ('auth', 'machines'):
        dependencies = aggregate(component, target, work, output)
    elif component in ('guest-sudo', 'guest-fusermount'):
        build_guest_unit(component, target, work, output)
    elif component == 'guest':
        dependencies = build_guest(target, work, output)
    elif component == 'loader':
        sdk = Path(os.environ['ANDROID_HOME'])
        run([sdk / 'cmdline-tools/latest/bin/sdkmanager', 'platforms;android-37.0', 'build-tools;37.0.0'])
        jar = Path(os.environ['ANDROID_HOME']) / 'platforms/android-37.0/android.jar'
        from release import CERT
        run(['python3', 'browser/mobile/android/taskarian/display/loader/build.py', '--jdk', os.environ['JAVA_HOME_17_X64'],
             '--android-jar', jar, '--d8', Path(os.environ['ANDROID_HOME']) / 'build-tools/37.0.0/d8',
             '--package', 'com.taskarian', '--signer', CERT, '--output', output])
    else:
        raise ValueError('Unsupported native component: ' + component)
    validate_outputs(component, target, output)
    return publish(component, target, output, dependencies, validation_only=force)


def validate_outputs(component, target, output):
    if component == 'node':
        module('node-component').verify(output, target)
    if component.startswith('auth-') or component in ('display', 'search'):
        native.verify_payload(output, component, target)
    if component in ('guest', 'os'):
        native.verify_payload(output, component, target)
        return
    if component == 'loader':
        return  # Paired native loader owner checks javac/D8 output and protocol.
    owner = module('build')
    with tempfile.TemporaryDirectory(prefix='native-abi-') as temporary:
        temporary = Path(temporary)
        for archive in archive_files(output):
            if any(word in archive.name for word in ('source', 'legal', 'build-support')):
                continue
            if archive.name.endswith('.zst'):
                with subprocess.Popen(['zstd', '-dc', str(archive)], stdout=subprocess.PIPE) as decoder:
                    with tarfile.open(fileobj=decoder.stdout, mode='r|') as payload:
                        payload.extractall(temporary, filter='data')
                    if decoder.wait():
                        raise ValueError('Native archive decompression failed')
            else:
                extract(archive, temporary)
        owner.elf_payload(temporary, target.split('-')[1], target.startswith('termux-'))


def aggregate(component, target, work, output):
    dependencies = []
    payload = Path(work) / 'payload'; payload.mkdir(parents=True, exist_ok=True)
    leaves = (*AUTH, 'runtime-guard') if component == 'auth' else tuple('machines-' + name for name in MACHINES)
    for leaf in leaves:
        incoming = Path(work) / leaf
        result = restore_component(leaf, target, incoming, roles={'runtime', 'metadata'})
        if result is None:
            raise ValueError('Required native component has not finished: ' + leaf)
        dependencies.append(result)
        for asset in result['manifest']['assets']:
            if asset['role'] == 'runtime':
                extract(incoming / asset['name'], payload)
    if component == 'auth':
        # Existing owner makes runtime metadata/licenses; corresponding-source
        # dependency releases are pinned beside the aggregate, not rebuilt.
        run(['python3', 'auth/build/assemble.py', ROOT, payload, target, output, work, '--runtime-only'])
    else:
        root = payload / 'machines'; manifests = []
        licenses = []
        for result in dependencies:
            archive = next(asset['name'] for asset in result['manifest']['assets'] if asset['role'] == 'runtime')
            with tarfile.open(Path(work) / result['manifest']['component'] / archive) as source:
                manifests.append(json.load(source.extractfile('machines/manifest.json')))
                licenses += json.load(source.extractfile('machines/licenses.json'))
        combined = {**manifests[0], 'sourceCommit': head(), 'components': [], 'executables': {}, 'libraries': {}, 'depends': []}
        for manifest in manifests:
            combined['components'] += manifest['components']; combined['executables'].update(manifest['executables'])
            combined['libraries'].update(manifest['libraries']); combined['depends'] += manifest['depends']
        combined['depends'] = sorted(set(combined['depends']))
        (root / 'manifest.json').write_text(json.dumps(combined, indent=2) + '\n')
        (root / 'licenses.json').write_text(json.dumps(licenses, indent=2) + '\n')
        name = f'machines-runtime-{target}.tar.gz'; pack(root, Path(output) / name, 'machines')
        (Path(output) / 'SHA256SUMS').write_text(store.sha(Path(output) / name) + '  ' + name + '\n')
    return dependencies


def os_native_stage(target, work):
    units = ['os-windowing', 'os-panel'] if target.startswith('linux-') else ['os-dbusmenu', 'os-windowing', 'os-panel']
    stage = Path(work) / 'native-stage'; stage.mkdir(parents=True, exist_ok=True)
    dependencies = []
    for unit in units:
        incoming = Path(work) / unit
        result = restore_component(unit, target, incoming, roles={'runtime', 'metadata'})
        if result is None:
            raise ValueError('Publish native OS source unit first: ' + unit)
        dependencies.append(result)
        for item in result['manifest']['assets']:
            if item['role'] == 'runtime':
                extract(incoming / item['name'], stage)
    return stage, dependencies


def os_debian_command(target, work, output, command):
    architecture = target.split('-')[1]
    image = json.loads((ROOT / 'agent/machines/image-base.json').read_text())['image']
    packages = ('ca-certificates build-essential git python3 meson ninja-build gettext pkg-config libgtk-3-dev '
                'libwnck-3-dev libxfce4ui-2-dev libxfce4util-dev libxfconf-0-dev libx11-dev libxrandr-dev '
                'libdbusmenu-gtk3-dev libnotify-dev libexo-2-dev libgarcon-1-dev libgarcon-gtk3-1-dev '
                'xfce4-dev-tools wayland-protocols libwayland-dev libxkbcommon-dev libegl-dev libepoxy-dev '
                'gobject-introspection libgirepository1.0-dev libdisplay-info-dev')
    env = {**os.environ, 'ARCH': architecture, 'SOURCE_COMMIT': head(),
           'VERSION': (ROOT / 'browser/taskarian/config/version.txt').read_text().strip()}
    run(['docker', 'run', '--rm', '--network=bridge', '-v', str(ROOT) + ':/source:ro',
         '-v', str(work) + ':/cache', '-v', str(output) + ':/output', '-e', 'ARCH', '-e', 'SOURCE_COMMIT', '-e', 'VERSION',
         image, 'sh', '-ec', 'export DEBIAN_FRONTEND=noninteractive; apt-get update; '
         'apt-get install -y --no-install-recommends ' + packages + '; ' + command], env=env)


def build_os_unit(component, target, work, output):
    unit = component[3:]; dependencies = []; native_stage = None
    if unit == 'panel':
        native_stage = work / 'native-stage'; native_stage.mkdir()
        for name in (['os-windowing'] if target.startswith('linux-') else ['os-dbusmenu', 'os-windowing']):
            incoming = work / name
            result = restore_component(name, target, incoming, roles={'runtime', 'metadata'})
            if result is None:
                raise ValueError('Publish OS native prerequisite first: ' + name)
            dependencies.append(result)
            for item in result['manifest']['assets']:
                if item['role'] == 'runtime': extract(incoming / item['name'], native_stage)
    architecture = target.split('-')[1]
    if target.startswith('termux-'):
        arguments = ['--native-input', native_stage] if native_stage else []
        run(['python3', 'agent/packaging/termux/os.py', '--architecture', architecture, '--unit', unit,
             '--work', work / 'native', '--output', output, *arguments])
    else:
        extra = ' --prebuilt-native /cache/native-stage' if native_stage else ''
        os_debian_command(target, work, output,
            'python3 /source/os/packaging/native.py --unit ' + unit + ' --target linux --architecture "$ARCH" '
            '--version "$VERSION" --source-commit "$SOURCE_COMMIT" --output /output '
            '--build-dir /cache/native --jobs 2 --stage-only' + extra)
        pack(work / 'native/stage', output / f'{component}-{target}.tar.gz')
    return dependencies


def build_os_package(target, work, output):
    stage, dependencies = os_native_stage(target, work)
    architecture = target.split('-')[1]
    if target.startswith('termux-'):
        run(['python3', 'agent/packaging/termux/os.py', '--architecture', architecture,
             '--native-input', stage, '--work', work / 'native', '--output', output])
    else:
        os_debian_command(target, work, output,
            'python3 /source/os/packaging/build.py --target linux --architecture "$ARCH" --version "$VERSION" '
            '--source-commit "$SOURCE_COMMIT" --output /output --build-dir /cache/package --jobs 2 '
            '--prebuilt-native /cache/native-stage')
    return dependencies


def build_guest_unit(component, target, work, output):
    architecture = target.split('-')[1]
    image = json.loads((ROOT / 'agent/machines/image-base.json').read_text())['image']
    env = {**os.environ, 'RUSTUP_HOME': '/rustup'}
    command = ('export DEBIAN_FRONTEND=noninteractive PATH=/rust-bin:$PATH; apt-get update; '
        'apt-get install -y --no-install-recommends ca-certificates build-essential python3 meson ninja-build pkg-config; '
        'python3 /source/agent/machines/build-guest-native.py --component ' + component.removeprefix('guest-') +
        ' --work /cache/native --output /cache/stage')
    run(['docker', 'run', '--rm', '-v', str(ROOT) + ':/source:ro', '-v', str(work) + ':/cache',
         '-v', str(Path.home() / '.rustup') + ':/rustup:ro', '-v', str(Path.home() / '.cargo/bin') + ':/rust-bin:ro',
         '-e', 'RUSTUP_HOME=/rustup', '-e', 'RUSTUP_TOOLCHAIN=' + os.environ.get('RUSTUP_TOOLCHAIN', '1.96.0'),
         image, 'sh', '-ec', command])
    pack(work / 'stage', output / f'{component}-{target}.tar.gz')


def build_guest(target, work, output):
    dependencies = []
    stage = work / 'native-stage'; stage.mkdir()
    for component in ('guest-sudo', 'guest-fusermount'):
        incoming = work / component
        result = restore_component(component, target, incoming, roles={'runtime', 'metadata'})
        if result is None:
            raise ValueError('Publish guest native helper first: ' + component)
        dependencies.append(result)
        for item in result['manifest']['assets']:
            if item['role'] == 'runtime':extract(incoming / item['name'], stage)
    os_result = restore_component('os', target, output, roles={'runtime', 'metadata'})
    if os_result is None:
        raise ValueError('Publish Taskarian OS guest package first')
    dependencies.append(os_result)
    architecture = target.split('-')[1]
    os_debian_command(target, work, output,
        'python3 /source/agent/machines/build-guest.py --architecture "$ARCH" --version "$VERSION" '
        '--revision "$SOURCE_COMMIT" --output /output --work /cache/package --prebuilt-native /cache/native-stage')
    return dependencies


def assembly(target, directory):
    directory = Path(directory).resolve(); result = {}
    required = ['auth', 'search', 'node'] + (['machines', 'display', 'guest'] if target.startswith('linux-') else ['os', 'loader'])
    for component in required:
        destination = directory / component
        record = restore_component(component, target, destination, roles={'runtime', 'metadata'})
        if record is None:
            raise ValueError('Required durable component is missing: ' + component + '/' + target)
        if component in ('auth', 'search', 'node'):
            pattern = {'auth': f'auth-{target}.tar.gz', 'search': f'search-runtime-{target}.tar.zst', 'node': f'node-runtime-{target}.tar.gz'}[component]
            result[component + '_archive'] = str(destination / pattern)
        elif component in ('machines', 'display'):
            result[component + '_archive'] = str(destination / f'{component}-runtime-{target}.tar.gz')
        elif component == 'guest':
            result['guest_packages'] = str(destination)
        elif component == 'os':
            packages = list(destination.glob('*.deb'))
            if len(packages) != 1:
                raise ValueError('Expected one Taskarian OS package')
            result['os_package'] = str(packages[0])
        else:
            result['termux_display_dir'] = str(destination)
    (directory / 'assembly-inputs.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['plan', 'run', 'assemble'])
    parser.add_argument('component_or_target'); parser.add_argument('target', nargs='?')
    parser.add_argument('--components', default='["all"]'); parser.add_argument('--work', type=Path)
    parser.add_argument('--output', type=Path); parser.add_argument('--directory', type=Path)
    parser.add_argument('--force-rebuild', action='store_true')
    args = parser.parse_args()
    if args.action == 'assemble':
        print(json.dumps(assembly(args.component_or_target, args.directory))); return
    if args.action == 'run':
        result = run_component(args.component_or_target, args.target, args.work, args.output, args.force_rebuild)
        print(json.dumps(result)); return
    target = args.component_or_target
    requested = json.loads(args.components)
    selected = components(target) if 'all' in requested else requested
    plan = []
    for component in selected:
        selected_inputs = inputs(component, target)
        available = None if args.force_rebuild else store.lookup(component, target, selected_inputs)
        plan.append({'component': component, 'target': target, 'inputs': selected_inputs,
                     'version': version(component, target), 'available': bool(available)})
    print(json.dumps(plan))


if __name__ == '__main__':
    main()
