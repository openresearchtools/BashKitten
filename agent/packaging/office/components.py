#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Versioned Office, Files and References components using their native owners."""
import argparse
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(Path(__file__).parent))


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


native = module('office_component_git', ROOT / 'agent/packaging/native-component.py')
IDS = ('office-engine', 'office-server', 'office-ui', 'office-integration',
       'files-server', 'files-ui', 'files-media', 'files-office-addon',
       'files-integration', 'references')
TARGETS = ('linux-amd64', 'linux-arm64', 'termux-aarch64', 'termux-x86_64')


def digest(value):
    return hashlib.sha256(value).hexdigest()


def document(revision, path):
    return json.loads(native.content(revision, path))


def engine_options(revision):
    path = 'agent/packaging/office/engine-options.json'
    if native.entry(revision, path):
        return document(revision, path)
    # Original producer pins predate the separate phase file. This frozen
    # list is checked against the original archive's actual engineOptions.
    text = native.content(revision, 'agent/packaging/office/build.py')
    match = re.search(r'ENGINE_OPTIONS = (\[[\s\S]*?\])\n', text)
    if not match:
        raise ValueError('Original engine options are absent')
    return json.loads(match[1].replace("'", '"'))


def entries(revision, path):
    if native.local(revision):
        return {line.split('\t', 1)[1]: line.split()[2]
                for line in native.git('ls-tree', revision + ':' + path).splitlines()}
    return {name: row['sha'] for name, row in native.tree(native.entry(revision, path)).items()}


def patch_inputs(revision, group, termux):
    """Hash complete effective patch sections; a mixed patch keeps separate owners."""
    directories = ['office/patches', 'files/patches/collabora']
    if termux:
        directories.append('office/patches/termux')
    result = {}
    for directory in directories:
        tree = native.entry(revision, directory)
        if tree is None:
            continue
        for name in entries(revision, directory):
            if not name.endswith('.patch'):
                continue
            path = directory + '/' + name
            text = native.content(revision, path)
            sections = re.split(r'(?=^--- [ab]/)', text, flags=re.M)
            selected = []
            for section in sections:
                match = re.search(r'^\+\+\+ [ab]/([^\t\n]+)', section, re.M)
                if not match:
                    continue
                owner = ('engine' if match[1].startswith('engine/') else
                         'ui' if match[1].startswith('browser/') else 'server')
                if owner == group:
                    selected.append(section)
            if selected:
                result[path] = digest(''.join(selected).encode())
    return result


def inputs(component, target, revision):
    if component not in IDS or target not in TARGETS:
        raise ValueError('Unsupported application component or native target')
    termux = target.startswith('termux-')
    paths = []
    selected = {'schema': 1, 'component': component, 'target': target}
    if component.startswith('office-') and component != 'office-integration':
        group = component.removeprefix('office-')
        base = 'office/upstream/online/source'
        pin = document(revision, 'office/upstream/online/source.json')
        selected['version'] = pin['version']
        selected['patches'] = patch_inputs(revision, group, termux)
        if group == 'engine':
            paths += [base + '/engine']
            dependencies = document(revision, 'office/upstream/dependencies/sources.json')
            selected['dependencies'] = [{key: row[key] for key in ('name', 'url', 'sha256')}
                                        for row in dependencies['components']]
            selected['engineOptions'] = engine_options(revision)
        elif group == 'server':
            selected['source'] = {name: sha for name, sha in entries(revision, base).items()
                                  if name not in ('engine', 'browser', '.git')}
            selected['engineOptions'] = engine_options(revision)
        else:
            paths += [base + '/browser', base + '/scripts', 'office/branding/online',
                      'office/upstream/supplements']
            # The native generators derive UNO commands/localizations from these trees.
            paths += [base + '/engine/officecfg', base + '/engine/translations',
                      base + '/engine/distro-configs', base + '/engine/include/vcl']
            selected['optionalTranslations'] = native.entry(revision, base + '/engine/translations')
            paths.remove(base + '/engine/translations')
            selected['npmRefresh'] = [row for row in document(revision,
                'office/upstream/dependencies/refresh.json')['components'] if row.get('ecosystem') == 'npm']
        selected['brand'] = {'product': 'Office', 'vendor': 'Taskarian',
                             'url': 'https://github.com/openresearchtools/Taskarian'}
        recipes = ['agent/packaging/office/source_graph.py', 'agent/packaging/office/branding.py']
        phase = 'agent/packaging/office/' + {'engine': 'engine.py', 'server': 'server.py', 'ui': 'web.py'}[group]
        recipes.append(phase if native.entry(revision, phase) else 'agent/packaging/office/build.py')
        if group == 'engine':
            recipes.append('agent/packaging/office/engine-options.json')
        if group == 'ui':
            recipes.append('agent/packaging/office/web-prepare-runner.sh')
        if termux:
            paths += ['office/patches/termux/donor.json', 'office/upstream/dependencies/native-termux']
            recipes.append('agent/packaging/office/termux.py')
        selected['recipes'] = {path: native.entry(revision, path) for path in recipes}
    elif component == 'office-integration':
        paths += ['office/extension', 'office/src', 'office/cli', 'office/index.mjs',
                  'office/package.json', 'office/package-lock.json', 'office/package-extension.mjs',
                  'office/vendor/npm', 'references/web/shared-citation-dialog.js',
                  'references/web/common.js', 'references/web/virtual-list.js',
                  'references/web/references.css', 'references/web/theme.css',
                  'references/THIRD_PARTY_NOTICES.md', 'references/vendor/classic-dialog/source/COPYING']
    elif component.startswith('files-'):
        base = 'files/vendor/quantum/source'
        if component == 'files-server':
            paths += [base + '/backend', 'files/adapters', 'files/runtime-go.json', 'files/go_runtime.py']
        elif component == 'files-ui':
            paths += [base + '/frontend']
        elif component == 'files-office-addon':
            paths += ['files/addon']
        elif component == 'files-integration':
            tree = entries(revision, 'files')
            paths += ['files/' + name for name in tree if name.endswith('.mjs') or name == 'web']
        else:
            paths += ['files/patches/go-ffmpeg']
        if component not in ('files-integration', 'files-office-addon'):
            graph = document(revision, 'files/vendor/dependencies/sources.json')
            selected['dependencies'] = [row for row in graph['components']
                if component != 'files-media' and row['ecosystem'] == ('npm' if component == 'files-ui' else 'go')]
            selected['nativeDependencies'] = [row for row in document(revision,
                'files/vendor/dependencies/native-sources.json')['components']
                if (row['name'] in ('mupdf', 'nasm') if component == 'files-server' else
                    row['name'] in ('ffmpeg', 'dav1d', 'nasm', 'mupdf', 'quantum-ffmpeg-recipe')
                    if component == 'files-media' else row['name'] in ('esbuild', 'rollup'))]
            tree = entries(revision, 'files/patches/quantum')
            selected['patches'] = {}
            for name in tree:
                if not name.endswith('.patch'):
                    continue
                raw = native.content(revision, 'files/patches/quantum/' + name)
                chunks = [s for s in re.split(r'(?=^--- [ab]/)', raw, flags=re.M)
                          if re.search(r'^\+\+\+ b/' + ('frontend/' if component == 'files-ui' else 'backend/'), s, re.M)]
                if chunks:
                    selected['patches'][name] = digest(''.join(chunks).encode())
    else:
        paths += ['references']
    if component.startswith('files-') and component != 'files-integration':
        selected['recipes'] = {'files/build.py': native.entry(revision, 'files/build.py'),
                               'files/termux.py': native.entry(revision, 'files/termux.py') if termux else None}
    if component not in ('files-integration', 'office-integration', 'references', 'office-ui', 'files-ui'):
        paths += ['agent/packaging/office/prepare-runner.sh']
        selected['abi'] = 'Ubuntu24.04' if not termux else 'Bionic-NDK30'
        if termux:
            paths += ['agent/packaging/termux/native_toolchain.py', 'agent/packaging/node/lock.json',
                      'agent/vendor/node/libcxx']
        if component.startswith('files-'):
            paths += ['auth/dependencies/go-toolchain', 'auth/build/go-notices.py']
    selected['trees'] = {name: native.entry(revision, name) for name in sorted(set(paths))}
    if any(value is None for value in selected['trees'].values()):
        raise ValueError('A component source owner is absent')
    return selected


def version(component, revision):
    if component.startswith('office-') and component != 'office-integration':
        return document(revision, 'office/upstream/online/source.json')['version']
    if component in ('office-integration', 'references'):
        return document(revision, ('office' if component == 'office-integration' else 'references') + '/package.json')['version']
    if component == 'files-media':
        return next(row['version'] for row in document(revision,
            'files/vendor/dependencies/native-sources.json')['components'] if row['name'] == 'ffmpeg')
    if component in ('files-integration', 'files-office-addon'):
        return '1'  # Taskarian's integration API, not an invented upstream version.
    return document(revision, 'files/vendor/quantum/SOURCE.json')['release'].removeprefix('v')


def store():
    return module('application_component_store', ROOT / 'agent/packaging/component-store.py')


def cache_contract(target, revision):
    flags = engine_options(revision)
    contract = {'schema': 1, 'family': 'office', 'target': target,
                'compiler': 'Ubuntu-24.04-system-GCC', 'compilerCheck': 'content', 'engineOptions': flags}
    if target.startswith('termux-'):
        lock = document(revision, 'agent/packaging/node/lock.json')
        contract['compiler'] = lock['termux']['dependency_sources']['libc++']['sha256']
    return contract


def cache_objects(directory):
    value = hashlib.sha256()
    for path in sorted(directory.rglob('*')):
        if path.is_file() and re.fullmatch(r'[a-f0-9]+[MR]', path.name):
            stat = path.stat()
            value.update((str(path.relative_to(directory)) + ':' + str(stat.st_size) + ':' + str(stat.st_mtime_ns)).encode())
    return value.hexdigest()


def restore_cache(args):
    backup = module('office_compiler_backup', ROOT / 'agent/packaging/compiler-cache.py')
    cache = Path(os.environ.get('CCACHE_DIR', args.work.parent / 'office-ccache')).resolve()
    cache.mkdir(parents=True, exist_ok=True)
    os.environ['CCACHE_DIR'] = str(cache)
    os.environ['CCACHE_COMPILERCHECK'] = 'content'
    # Leave most available disk for the native source/build tree, with no fixed
    # one-gigabyte compiler-cache ceiling.
    available = shutil.disk_usage(args.work).free
    capacity = max(64, available // (6 * 1024 ** 2))
    run(['ccache', '--max-size', str(capacity) + 'MiB'])
    contract = cache_contract(args.target, args.source)
    empty = hashlib.sha256().hexdigest()
    if not os.environ.get('TASKARIAN_OFFICE_ACTIONS_CACHE_MATCHED') and cache_objects(cache) == empty:
        hit = backup.restore('ccache', args.target, contract, cache)
        if not hit:
            backup.restore('ccache', args.target, contract, cache,
                           repository='openresearchtools/office-builds')
    return backup, cache, contract, cache_objects(cache)


def run(command, **options):
    print('+', ' '.join(map(str, command)), flush=True)
    subprocess.run(list(map(str, command)), check=True, **options)


def write_json(path, value):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(value, indent=2) + '\n')


def pack(root, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    with destination.open('wb') as stream:
        with gzip.GzipFile(filename='', mode='wb', fileobj=stream, mtime=0) as compressed:
            with tarfile.open(fileobj=compressed, mode='w') as archive:
                for path in sorted(root.iterdir()):
                    archive.add(path, arcname=path.name, filter=canonical_member)


def canonical_member(member):
    member.uid = member.gid = member.mtime = 0
    member.uname = member.gname = ''
    return member


def unpack(archive, destination):
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive) as source:
        source.extractall(destination, filter='data')


def inventory(root):
    result = {}
    for path in sorted(root.rglob('*')):
        name = str(path.relative_to(root))
        if path.is_symlink():
            target = os.readlink(path)
            if not (path.parent / target).resolve().is_relative_to(root.resolve()):
                raise ValueError('Component symlink leaves its runtime: ' + name)
            result[name] = {'symlink': target}
        elif path.is_file():
            with path.open('rb') as stream:
                result[name] = {'sha256': hashlib.file_digest(stream, 'sha256').hexdigest(),
                                'mode': path.stat().st_mode & 0o777}
    return result


def validate_native(root, component, target):
    if component not in ('office-engine', 'office-server', 'files-server', 'files-media', 'files-office-addon'):
        return
    architecture = target.split('-', 1)[1]
    expected = 62 if architecture in ('amd64', 'x86_64') else 183
    found = 0
    for path in root.rglob('*'):
        if not path.is_file() or path.is_symlink():
            continue
        with path.open('rb') as stream:
            header = stream.read(20)
        if header[:4] != b'\x7fELF':
            continue
        found += 1
        if header[:6] != b'\x7fELF\x02\x01' or int.from_bytes(header[18:20], 'little') != expected:
            raise ValueError('Native component ELF architecture differs: ' + str(path.relative_to(root)))
    if not found:
        raise ValueError('Native component contains no ELF output: ' + component)


def restored(component, args, *, required=True):
    result = store().restore(component, args.target, inputs(component, args.target, args.source),
        args.directory / component, roles={'runtime', 'metadata'}, requested_source=args.source)
    if result is None and required:
        raise ValueError('Build dependency must be published first: ' + component)
    return result


def runtime_file(result):
    matches = [row for row in result['manifest']['assets'] if row['role'] == 'runtime']
    if len(matches) != 1:
        raise ValueError('A component must have one runtime payload')
    return Path(result['directory']) / matches[0]['name']


def reference(result):
    return {key: result[key] for key in ('repository', 'manifestName', 'manifestSha256')}


def prepare_office(args, *, engine_dependencies=True):
    import build as owner
    import source_graph
    import branding
    platform, architecture = args.target.split('-', 1)
    work = args.work.resolve(); work.mkdir(parents=True, exist_ok=True)
    # Full native source preparation remains the existing zero-fuzz owner.
    if platform == 'termux' and engine_dependencies:
        import termux
        args.architecture = architecture
        source = termux.prepare(work, args.cache, architecture)
        env, toolchain = termux.build_environment(args)
    else:
        source_graph.verify_source()
        if engine_dependencies:
            source_graph.prepare_cache(args.cache)
        source = work / 'source'
        if not source.exists():
            run(['cp', '-a', '--reflink=auto', source_graph.SOURCE, source])
        pin = json.loads((source_graph.UPSTREAM / 'online/source.json').read_text())
        (source / 'dist_git_hash').write_text(pin['commit'][:10] + '\n')
        owner.patch_source(source)
        source_graph.prepare_browser_dependencies(source)
        env = {**os.environ, 'CC': 'ccache gcc', 'CXX': 'ccache g++',
               'SOURCE_REVISION': pin['commit'], 'npm_config_audit': 'false',
               'npm_config_fund': 'false', 'GIT_CEILING_DIRECTORIES': str(work)}
        toolchain = None
    return source, env, toolchain


def prepare_ndk(args):
    if args.ndk is not None:
        return
    source_cache = module('office_ndk_source', ROOT / 'agent/packaging/source_cache.py')
    pin = document(args.source, 'agent/packaging/node/lock.json')['termux']['dependency_sources']['libc++']
    original = source_cache.fetch(pin, args.cache)
    destination = args.work.parent / ('office-ndk-' + pin['sha256'][:16])
    marker = destination / 'archive-sha256'
    if not marker.is_file():
        if destination.exists() and any(destination.iterdir()):
            raise ValueError('Unowned existing NDK build directory')
        destination.mkdir(parents=True, exist_ok=True)
        run(['unzip', '-q', original, '-d', destination])
        marker.write_text(pin['sha256'] + '\n')
    elif marker.read_text().strip() != pin['sha256']:
        raise ValueError('Prepared native NDK checksum differs')
    args.ndk = destination / 'android-ndk-r30'
    args.ndk_archive = original


def build_office(component, args, payload):
    import build as owner
    import source_graph
    import runtime_metadata
    import branding
    platform, architecture = args.target.split('-', 1)
    source, env, toolchain = prepare_office(args, engine_dependencies=component != 'office-ui')
    dependencies = []
    if component == 'office-engine':
        from engine import compile_engine
        compile_engine(source, args, env)
        run(['make', 'Package_instsetoo_native_setup', 'LIBO_TEST_INSTALL=TRUE',
             'CustomTarget_instsetoo_native/sbom'], cwd=source / 'engine', env=env)
        runtime_metadata.remove_windows_python_launchers(source / 'engine/instdir', platform)
        shutil.copytree(source / 'engine/instdir', payload / 'engine', symlinks=True)
        if platform == 'termux':
            triple = architecture + '-linux-android'
            libcxx = args.ndk / 'toolchains/llvm/prebuilt/linux-x86_64/sysroot/usr/lib' / triple / 'libc++_shared.so'
            shutil.copy2(libcxx, payload / 'engine/program/libc++_shared.so')
        licenses = [{'name': 'Collabora Office engine', 'version': version(component, args.source),
                     'license': 'MPL-2.0, LGPL-3.0-or-later and component-specific terms',
                     'text': '\n\n'.join((payload / 'engine' / name).read_text(errors='replace')
                                         for name in ('LICENSE', 'NOTICE'))}]
        licenses.extend(runtime_metadata.python_notices(payload))
        write_json(payload / 'licenses.json', licenses)
    else:
        engine = restored('office-engine', args)
        dependencies.append(reference(engine))
        with tempfile.TemporaryDirectory(dir=args.work) as temporary:
            unpack(runtime_file(engine), Path(temporary))
            shutil.copytree(Path(temporary) / 'engine', source / 'engine/instdir',
                            dirs_exist_ok=True, symlinks=True)
        if component == 'office-server':
            # Native module targets build only the server's external prerequisites,
            # not LibreOffice's full core. Its runtime remains the original release.
            if platform == 'termux':
                import termux
                termux.configure_engine(source, args, env)
            else:
                owner.configure_engine(source, args.cache, args.jobs, env)
            run(['make', '-j' + str(args.jobs), 'external/poco', 'external/libpng',
                 'external/zstd', 'external/openssl'], cwd=source / 'engine', env=env)
            if platform == 'termux':
                termux.build_online(source, args, env, web=False)
            else:
                owner.build_online(source, args.jobs, env, web=False)
            stage = args.work / 'server-stage'; stage.mkdir(exist_ok=True)
            make = ['make', 'SUBDIRS=.', 'DESTDIR=' + str(stage), 'install']
            if platform == 'termux':
                make += termux.online_make_inputs(termux.build_libcap(args, env), termux.build_libiconv(args, env))
            run(make, cwd=source, env=env)
            prefix = termux.RUNTIME if platform == 'termux' else owner.PREFIX
            installed = stage / prefix.lstrip('/')
            for path in installed.iterdir():
                shutil.copytree(path, payload / path.name, symlinks=True) if path.is_dir() else shutil.copy2(path, payload / path.name)
            if platform == 'termux':
                libraries = payload / 'engine/program'; libraries.mkdir(parents=True, exist_ok=True)
                for root in [termux.build_libcap(args, env) / 'libcap', termux.build_libiconv(args, env) / 'lib/.libs']:
                    for library in root.glob('*.so*'):
                        shutil.copy2(library, libraries / library.name, follow_symlinks=False)
        else:
            from web import build_ui
            build_ui(source, args, env, payload)
        # Preserve complete native notices. No donor license substitution.
        legal = payload / 'legal'; legal.mkdir(exist_ok=True)
        for name in ('COPYING', 'THIRDPARTYLICENSES', 'NOTICE'):
            if (source / name).is_file():
                shutil.copy2(source / name, legal / name)
        if component == 'office-ui':
            # Existing notice owner uses the real engine license and Python inventory.
            shutil.copytree(source / 'engine/instdir', payload / 'engine', symlinks=True)
            runtime_metadata.notices(source, payload)
            shutil.rmtree(payload / 'engine')
        else:
            write_json(payload / 'licenses.json', [{'name': 'Collabora Online native server',
                'version': version(component, args.source), 'license': 'MPL-2.0 and component-specific terms',
                'text': '\n\n'.join(path.read_text(errors='replace') for path in sorted(legal.iterdir()))}])
    if component != 'office-ui':
        depends = runtime_metadata.linux_dependencies(payload, args.work) if platform == 'linux' else termux.SYSTEM_PACKAGES
        write_json(payload / 'native-metadata.json', {'depends': depends})
    return dependencies


def build_integration(component, args, payload):
    applications = module('application_leaf_owner', ROOT / 'agent/packaging/applications.py')
    target, architecture = args.target.split('-', 1)
    if component == 'references':
        applications.references(payload, args.work / 'npm-cache', target, architecture,
                                source_cache=args.cache)
    elif component == 'files-integration':
        applications.copy_patterns(ROOT / 'files', payload, ['*.mjs', 'web/**/*'])
    else:
        source = ROOT / 'office'
        package = json.loads((source / 'package.json').read_text())
        applications.copy_patterns(source, payload, ['package.json', 'package-lock.json',
            *[name + '/**/*' if (source / name).is_dir() else name for name in package['files']]])
        applications.install_npm(source, payload, args.work / 'npm-cache', target, architecture,
                                  source_cache=args.cache)
        applications.office_extension(payload / 'runtime')
    write_json(payload / 'component-license.json', {'name': component,
        'license': (ROOT / 'LICENSE').read_text(), 'version': version(component, args.source)})
    return []


def source_assets(component, args, output, assets):
    """Keep tracked build owners and original downloads, never generated substitutes."""
    source_cache = module('application_source_cache', ROOT / 'agent/packaging/source_cache.py')
    paths = ['LICENSE', 'agent/packaging', '.github/builders/native.yml', '.github/builders/office.yml']
    if args.target.startswith('termux-'):
        paths += ['agent/packaging/termux/native_toolchain.py', 'agent/packaging/node/lock.json',
                  'agent/vendor/node/libcxx']
    pins = []
    if component.startswith('office-') and component != 'office-integration':
        paths += ['office/patches', 'office/branding', 'office/upstream/dependencies',
                  'office/upstream/online/source.json', 'files/patches/collabora']
        if component == 'office-engine':
            paths.append('office/upstream/online/source')
            manifest = document(args.source, 'office/upstream/online/source.json')
            pins.append(manifest['archive'])
            pins += document(args.source, 'office/upstream/dependencies/sources.json')['components']
        else:
            paths += ['office/upstream/online/source/' + name for name in entries(args.source,
                'office/upstream/online/source') if name != 'engine']
        if component == 'office-ui':
            pins += [row for row in document(args.source, 'office/upstream/dependencies/refresh.json')['components']
                     if row.get('ecosystem') == 'npm']
        if args.target.startswith('termux-'):
            pins += document(args.source, 'office/upstream/dependencies/native-termux/sources.json')['components']
    elif component.startswith('files-'):
        paths += ['files', 'auth/build/go-notices.py', 'auth/dependencies/go-toolchain',
                  'agent/packaging/termux/native_toolchain.py', 'agent/packaging/node/lock.json']
        spec = inputs(component, args.target, args.source)
        rows = spec.get('dependencies', []) + spec.get('nativeDependencies', [])
        for row in rows:
            pins.append({**row['archive'], 'url': row['url']})
            if row.get('ecosystem') == 'go':
                for field, suffix in [('info', '.info'), ('goMod', '.mod')]:
                    if field in row:
                        pins.append({**row[field], 'url': row['url'].removesuffix('.zip') + suffix})
        if component in ('files-server', 'files-office-addon'):
            pins.append(document(args.source, 'auth/dependencies/go-toolchain/sources.json'))
    else:
        base = 'office' if component == 'office-integration' else 'references' if component == 'references' else 'files'
        paths += [base]
        if component == 'office-integration':
            paths += ['references/web', 'references/THIRD_PARTY_NOTICES.md', 'references/vendor/classic-dialog']
        npm = base + '/vendor/npm/sources.json'
        if native.entry(args.source, npm):
            pins += document(args.source, npm)['components']
        if component == 'references':
            for name in ('zotero', 'translate', 'utilities', 'translators', 'schema', 'styles',
                         'locales', 'translation-server', 'wicked-good-xpath'):
                row = document(args.source, 'references/vendor/' + name + '/source.json')
                pins.append({**row, 'url': row['archiveURL']})
    # Native dependency license metadata stays tracked; downloaded blobs are
    # retained from their exact URL/SHA in the external source cache.
    tracked = output / (component + '-build-source.tar.gz')
    existing = [name for name in dict.fromkeys(paths) if native.entry(args.source, name)]
    run(['git', 'archive', '--format=tar.gz', '--output=' + str(tracked), args.source, '--', *existing], cwd=ROOT)
    assets[tracked.name] = 'source'
    seen = set()
    for pin in pins:
        url = pin.get('url') or pin.get('archiveURL')
        if not url or (url, pin['sha256']) in seen:
            continue
        seen.add((url, pin['sha256']))
        original = source_cache.fetch({'url': url, 'sha256': pin['sha256'],
            **({'size': pin['size']} if 'size' in pin else {})}, args.cache)
        name = 'source-' + pin['sha256'] + '.archive'
        shutil.copyfile(original, output / name)
        assets[name] = 'source'
    legal = output / (component + '-licenses.tar.gz')
    payload = args.work / 'payload'
    with tarfile.open(legal, 'w:gz') as archive:
        for path in sorted(payload.rglob('*')):
            if path.is_file() and (path.suffix == '.json' and 'licen' in path.name.lower()
                or any(word in path.name.lower() for word in ('license', 'copying', 'notice', 'copyright'))):
                archive.add(path, arcname=str(path.relative_to(payload)), filter=canonical_member)
    assets[legal.name] = 'legal'


def build(args):
    component = args.component
    if component is None or args.work is None or args.cache is None:
        raise ValueError('A component build requires --component, --work and --cache')
    args.directory = args.directory.resolve(); args.work = args.work.resolve(); args.cache = args.cache.resolve()
    if args.target.startswith('linux-') and {'x86_64': 'amd64', 'aarch64': 'arm64'}.get(platform.machine()) != args.target.split('-', 1)[1]:
        raise ValueError('Linux components require their actual native architecture runner')
    for path in (args.directory, args.work, args.cache):
        if path.is_relative_to(ROOT):
            raise ValueError('Build outputs and caches must remain outside the repository')
        path.mkdir(parents=True, exist_ok=True)
    if not args.force and restored(component, args, required=False):
        return
    if native.git('status', '--porcelain', '--untracked-files=no').strip():
        raise ValueError('Publish components only from committed build inputs')
    payload = args.work / 'payload'
    if payload.exists():
        shutil.rmtree(payload)
    payload.mkdir()
    if args.target.startswith('termux-') and component in (
            'office-engine', 'office-server', 'files-server', 'files-media', 'files-office-addon'):
        prepare_ndk(args)
    if component in ('office-engine', 'office-server', 'office-ui'):
        cache_state = restore_cache(args) if component != 'office-ui' else None
        try:
            dependencies = build_office(component, args, payload)
        finally:
            if cache_state:
                backup, directory, contract, before = cache_state
                run(['ccache', '--show-stats'])
                if cache_objects(directory) != before:
                    try:
                        backup.save('ccache', args.target, contract, directory)
                    except backup.store.StoreUnavailable as error:
                        # Preserve the native output and primary Actions cache;
                        # a backup transport error must not discard compiled work.
                        print('Compiler release backup needs retry: ' + str(error), flush=True)
                        write_json(args.directory / 'compiler-backup-error.json', {'error': str(error)})
    elif component in ('files-server', 'files-ui', 'files-media', 'files-office-addon'):
        target, architecture = args.target.split('-', 1)
        raw = args.work / 'native-files.tar.gz'
        command = [sys.executable, ROOT / 'files/build.py', '--component', component.removeprefix('files-'),
                   '--work-dir', args.work / 'native', '--output', raw, '--target', target,
                   '--architecture', architecture, '--jobs', str(args.jobs), '--source-cache', args.cache]
        if target == 'termux' and component != 'files-ui':
            command += ['--ndk', args.ndk, '--ndk-archive', args.ndk_archive]
        run(command); unpack(raw, payload); dependencies = []
    else:
        dependencies = build_integration(component, args, payload)
    validate_native(payload, component, args.target)
    write_json(payload / 'component-payload.json', {'schema': 1, 'component': component,
        'target': args.target, 'version': version(component, args.source), 'sourceCommit': args.source,
        'files': inventory(payload)})
    output = args.directory / component; output.mkdir(parents=True, exist_ok=True)
    runtime = output / (component + '-' + args.target + '.tar.gz'); pack(payload, runtime)
    assets = {runtime.name: 'runtime'}
    source_assets(component, args, output, assets)
    result = store().publish(component, args.target, version(component, args.source),
        inputs(component, args.target, args.source), output, assets=assets,
        source_commit=args.source, dependencies=dependencies, validation_only=args.force)
    write_json(output / 'published.json', result)


def verify_payload(payload, component, target):
    metadata = json.loads((payload / 'component-payload.json').read_text())
    if metadata['schema'] != 1 or metadata['component'] != component or metadata['target'] != target:
        raise ValueError('Component runtime target differs')
    actual = inventory(payload); actual.pop('component-payload.json', None)
    if actual != metadata['files']:
        raise ValueError('Component runtime file inventory differs: ' + component)
    return metadata


def seed_office(args):
    """Explicit, one-time migration of verified original native outputs."""
    if args.seed_directory is None or args.producer_source is None or args.producer_run is None:
        raise ValueError('Office seeding requires its exact original source/run/archive directory')
    historical = module('office_original_archive', ROOT / 'agent/packaging/remote-office.py')
    checksum, original, manifest_checksum = historical.verify_artifact(
        args.seed_directory, args.target, args.producer_source)
    run_record = native.api(f'repos/openresearchtools/office-builds/actions/runs/{args.producer_run}')
    title = re.fullmatch(r'Office ([a-f0-9]{40}) / ([A-Za-z0-9_.-]+)', run_record['display_title'])
    if not title or title[1] != args.producer_source:
        raise ValueError('Original Office run differs from its archived source')
    historical.verify_run(run_record, args.producer_source, title[2])
    historical.verify_workflow(run_record['head_sha'], args.producer_source)
    producer = historical.producer_job(run_record, 'office', args.target)
    producer.update({'repository': 'openresearchtools/office-builds', 'runId': args.producer_run,
                     'workflowCommit': run_record['head_sha'], 'sourceCommit': args.producer_source,
                     'archiveSha256': checksum, 'manifestSha256': manifest_checksum})
    def function(revision, path, name):
        text = native.content(revision, 'agent/packaging/office/' + path)
        match = re.search(r'^def ' + name + r'\([^\n]*\):\n[\s\S]*?(?=^def |\Z)', text, re.M)
        if not match:
            raise ValueError('Original native phase definition is absent: ' + path + ':' + name)
        return match[0].strip()
    # This one-time source migration moved the native configure functions;
    # require their complete original text, apart from the new function name.
    for old_path, new_name in [('build.py', 'configure_linux'), ('termux.py', 'configure_termux')]:
        previous = function(args.producer_source, old_path, 'configure_engine')
        current = function(args.source, 'engine.py', new_name)
        if previous.replace('def configure_engine(', 'def ' + new_name + '(', 1) != current:
            raise ValueError('Original native engine configure recipe changed')
    if args.target.startswith('termux-'):
        for name in ('build_libcap', 'build_libiconv', 'online_make_inputs',
                     'materialize_native_inputs', 'build_environment'):
            if function(args.producer_source, 'termux.py', name) != function(args.source, 'termux.py', name):
                raise ValueError('Original Termux compiler/library recipe changed: ' + name)
    old_path, new_name = ('termux.py', 'build_termux') if args.target.startswith('termux-') else ('build.py', 'build_linux')
    pattern = r"run\(\['\./configure',[\s\S]*?cwd=source, env=(?:env|native)\)"
    previous = re.search(pattern, function(args.producer_source, old_path, 'build_online'))
    current = re.search(pattern, function(args.source, 'server.py', new_name))
    if previous is None or current is None or previous[0] != current[0]:
        raise ValueError('Original native server configure options changed')
    args.directory = args.directory.resolve(); args.directory.mkdir(parents=True, exist_ok=True)
    args.work = args.work.resolve(); args.work.mkdir(parents=True, exist_ok=True)
    args.cache = args.cache.resolve(); args.cache.mkdir(parents=True, exist_ok=True)
    archive = args.seed_directory / ('office-' + args.target + '.tar.xz')
    with tempfile.TemporaryDirectory(prefix='office-original-', dir=args.work) as temporary:
        unpack(archive, Path(temporary))
        native_root = Path(temporary) / 'runtime'
        for component in ('office-engine', 'office-server', 'office-ui'):
            if restored(component, args, required=False):
                continue
            produced, requested = inputs(component, args.target, args.producer_source), inputs(component, args.target, args.source)
            # Compare the actual compiled source trees, complete effective patch
            # sections, native options and ABI. The new split/archive function
            # did not execute in the original producer and is never attributed to it.
            for value in (produced, requested):
                value.pop('recipes', None)
            if produced != requested:
                raise ValueError('Original Office native inputs changed: ' + component)
            if original.get('engineOptions', [])[:len(engine_options(args.source))] != engine_options(args.source):
                raise ValueError('Original engine native options changed')
            payload = args.work / 'payload'
            if payload.exists():
                shutil.rmtree(payload)
            payload.mkdir()
            selected = ('engine',) if component == 'office-engine' else ('bin', 'lib', 'etc', 'share') if component == 'office-server' else ('share',)
            for name in selected:
                source = native_root / name
                if not source.exists():
                    continue
                shutil.copytree(source, payload / name, symlinks=True) if source.is_dir() else shutil.copy2(source, payload / name)
            if component == 'office-server':
                shutil.rmtree(payload / 'share/coolwsd/browser', ignore_errors=True)
                # Extension output belongs to the freshly built integration component.
                shutil.rmtree(payload / 'share/taskarian', ignore_errors=True)
            elif component == 'office-ui':
                for child in list((payload / 'share').iterdir()):
                    if child.name != 'coolwsd':
                        shutil.rmtree(child) if child.is_dir() else child.unlink()
                for child in list((payload / 'share/coolwsd').iterdir()):
                    if child.name != 'browser':
                        shutil.rmtree(child) if child.is_dir() else child.unlink()
            shutil.copytree(native_root / 'legal', payload / 'legal', symlinks=True)
            shutil.copy2(native_root / 'licenses.json', payload / 'licenses.json')
            write_json(payload / 'native-metadata.json', {'depends': original['depends']})
            proof = {'producerSource': args.producer_source, 'requestedSource': args.source,
                     'compiledInputs': produced, 'originalArchiveSha256': checksum,
                     'scope': 'Native source/effective patches/options/ABI unchanged; split packaging only'}
            write_json(payload / 'input-equivalence.json', proof)
            validate_native(payload, component, args.target)
            write_json(payload / 'component-payload.json', {'schema': 1, 'component': component,
                'target': args.target, 'version': version(component, args.producer_source),
                'sourceCommit': args.producer_source, 'files': inventory(payload)})
            output = args.directory / component; output.mkdir(parents=True, exist_ok=True)
            runtime = output / (component + '-' + args.target + '.tar.gz'); pack(payload, runtime)
            assets = {runtime.name: 'runtime'}
            requested_source = args.source
            args.source = args.producer_source
            try:
                source_assets(component, args, output, assets)
            finally:
                args.source = requested_source
            publisher_source = output / 'seed-publisher-source.tar.gz'
            run(['git', 'archive', '--format=tar.gz', '--output=' + str(publisher_source), args.source,
                 '--', 'agent/packaging', '.github/builders/office-seed.yml'], cwd=ROOT)
            assets[publisher_source.name] = 'source'
            dependencies = [] if component == 'office-engine' else [reference(restored('office-engine', args))]
            result = store().publish(component, args.target, version(component, args.producer_source),
                inputs(component, args.target, args.source), output, assets=assets,
                source_commit=args.producer_source, producer={**producer, 'inputEquivalence': proof},
                dependencies=dependencies)
            write_json(output / 'published.json', result)


FAMILIES = {'office': ('office-engine', 'office-server', 'office-ui'),
            'files': ('files-server', 'files-ui', 'files-media', 'files-office-addon')}


def copy_ready(result, destination):
    for item in result['manifest']['assets']:
        if item['role'] not in ('runtime', 'metadata'):
            continue
        source = Path(result['directory']) / item['name']
        target = destination / item['name']
        if source.resolve() == target.resolve():
            continue
        target.unlink(missing_ok=True)
        try:
            os.link(source, target)
        except OSError:
            shutil.copyfile(source, target)


def aggregate_inputs(family, target, revision):
    found = {}
    for component in FAMILIES[family]:
        result = store().lookup(component, target, inputs(component, target, revision))
        if result is None:
            return None
        found[component] = result
    return {'schema': 1, 'component': family + '-runtime', 'target': target,
            'leaves': {name: reference(found[name]) for name in FAMILIES[family]}}


def aggregate(args, family):
    leaves = FAMILIES[family]
    target, architecture = args.target.split('-', 1)
    wanted = aggregate_inputs(family, args.target, args.source)
    if wanted is None:
        raise ValueError('Publish all native aggregate dependencies first: ' + family)
    found = {name: store().lookup(name, args.target, inputs(name, args.target, args.source)) for name in leaves}
    ready = store().restore(family + '-runtime', args.target, wanted,
        args.directory / (family + '-runtime'), roles={'runtime', 'metadata'}, requested_source=args.source)
    archive = args.directory / (family + '-' + args.target + ('.tar.xz' if family == 'office' else '.tar.gz'))
    if ready is not None:
        copy_ready(ready, args.directory)
        return str(archive)
    components, roots = {}, {}
    with tempfile.TemporaryDirectory(prefix=family + '-aggregate-', dir=args.directory) as temporary:
        temporary = Path(temporary)
        for component in leaves:
            result = store().fetch(found[component], args.directory / component, roles={'runtime', 'metadata'})
            root = temporary / component; unpack(runtime_file(result), root)
            metadata = verify_payload(root, component, args.target)
            components[component] = {**reference(result), 'manifest': result['manifest'], 'payload': metadata}
            roots[component] = root
        combined = temporary / ('combined-' + family); combined.mkdir()
        licenses, depends = [], set()
        for component in leaves:
            root = roots[component]
            # Shared full notices may have the same path in multiple leaves;
            # retain every original record in the merged legal inventory.
            if (root / 'licenses.json').is_file():
                licenses += json.loads((root / 'licenses.json').read_text())
            for filename in ('manifest.json', 'native-metadata.json', 'input-equivalence.json'):
                if (root / filename).is_file():
                    depends.update(json.loads((root / filename).read_text()).get('depends', []))
            for path in root.iterdir():
                if path.name in ('component-payload.json', 'manifest.json', 'licenses.json', 'native-metadata.json', 'input-equivalence.json'):
                    continue
                destination = combined / path.name
                if path.is_dir():
                    shutil.copytree(path, destination, dirs_exist_ok=True, symlinks=True)
                else:
                    if destination.exists() and destination.read_bytes() != path.read_bytes():
                        raise ValueError('Overlapping application component output: ' + str(path))
                    shutil.copy2(path, destination)
        write_json(combined / 'licenses.json', list({digest(json.dumps(row, sort_keys=True).encode()): row
            for row in licenses}.values()))
        manifest = {'schema': 2, 'target': target, 'architecture': architecture,
                    'assemblySource': args.source, 'components': {name: components[name] for name in leaves},
                    'depends': sorted(depends), 'files': inventory(combined)}
        if family == 'office':
            import build as office_owner
            import branding
            import termux as termux_owner
            pin = document(args.source, 'office/upstream/online/source.json')
            patches = termux_owner.patch_inputs() if target == 'termux' else [ROOT / name for name in office_owner.PATCHES]
            manifest.update({'apiVersion': 1, 'revision': pin['commit'], 'upstream': pin,
                'component': 'collabora-online', 'compiledPrefix': termux_owner.RUNTIME if target == 'termux' else office_owner.PREFIX,
                'paths': {'coolwsd': 'bin/coolwsd', 'engine': 'engine', 'web': 'share/coolwsd',
                          'config': 'etc/coolwsd/coolwsd.xml', 'systemplateSetup': 'bin/coolwsd-systemplate-setup'},
                'patches': [path.stem.split('-', 1)[1] for path in patches]})
            branding.verify_runtime(combined)
        write_json(combined / 'manifest.json', manifest)
        archive = args.directory / (family + '-' + args.target + ('.tar.xz' if family == 'office' else '.tar.gz'))
        if family == 'office':
            with tarfile.open(archive, 'w:xz', preset=3) as stream:
                stream.add(combined, arcname='runtime', filter=canonical_member)
            write_json(archive.with_name(archive.name + '.json'), {key: value for key, value in manifest.items() if key != 'files'})
        else:
            pack(combined, archive)

        source = args.directory / (family + '-sources.json')
        write_json(source, {'schema': 1, 'dependencies': [reference(found[name]) for name in leaves]})
        legal = args.directory / (family + '-licenses.tar.gz')
        with tarfile.open(legal, 'w:gz') as bundle:
            for path in sorted(combined.rglob('*')):
                if path.is_file() and ('legal' in path.relative_to(combined).parts or
                    any(word in path.name.lower() for word in ('license', 'notice', 'copying', 'copyright'))):
                    bundle.add(path, arcname=str(path.relative_to(combined)), filter=canonical_member)
        assets = {archive.name: 'runtime', source.name: 'source', legal.name: 'legal'}
        if family == 'office':
            assets[archive.name + '.json'] = 'metadata'
        store().publish(family + '-runtime', args.target,
            version('office-engine' if family == 'office' else 'files-server', args.source),
            wanted, args.directory, assets=assets, source_commit=args.source,
            dependencies=[reference(found[name]) for name in leaves])
        return str(archive)


def assemble(args):
    """Restore completed aggregate archives; repack only a changed native leaf set."""
    args.directory = args.directory.resolve(); args.directory.mkdir(parents=True, exist_ok=True)
    output = {family + '_archive': aggregate(args, family) for family in FAMILIES}
    for component in ('references', 'office-integration', 'files-integration'):
        original = restored(component, args)
        archive = args.directory / (component + '-' + args.target + '.tar.gz')
        copy_ready(original, args.directory)
        write_json(archive.with_name(archive.name + '.component.json'),
                   {**reference(original), 'manifest': original['manifest']})
        output[component.replace('-', '_') + '_archive'] = str(archive)
    with (args.directory / 'SHA256SUMS').open('w') as stream:
        for path in sorted(args.directory.iterdir()):
            if path.is_file() and path.name not in ('SHA256SUMS', 'assembly-inputs.json'):
                with path.open('rb') as source:
                    stream.write(hashlib.file_digest(source, 'sha256').hexdigest() + '  ' + path.name + '\n')
    write_json(args.directory / 'assembly-inputs.json', output)
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['plan', 'build', 'assemble', 'cache-contract', 'seed-office', 'aggregate'])
    parser.add_argument('--target', choices=TARGETS, required=True)
    parser.add_argument('--source', default=native.git('rev-parse', 'HEAD').strip())
    parser.add_argument('--component', choices=IDS)
    parser.add_argument('--directory', type=Path)
    parser.add_argument('--work', type=Path)
    parser.add_argument('--cache', type=Path)
    parser.add_argument('--ndk', type=Path)
    parser.add_argument('--ndk-archive', type=Path)
    parser.add_argument('--jobs', type=int, default=2)
    parser.add_argument('--force', action='store_true')
    parser.add_argument('--family', choices=['office', 'files'])
    parser.add_argument('--seed-directory', type=Path)
    parser.add_argument('--producer-source')
    parser.add_argument('--producer-run', type=int)
    args = parser.parse_args()
    if args.command == 'cache-contract':
        print(json.dumps(cache_contract(args.target, args.source)))
        return
    if args.directory is None:
        parser.error('--directory is required')
    if args.command == 'aggregate':
        if not args.family:
            parser.error('aggregate requires --family')
        args.directory = args.directory.resolve(); args.directory.mkdir(parents=True, exist_ok=True)
        print(json.dumps({'archive': aggregate(args, args.family)}))
        return
    if args.command == 'plan':
        result = []
        for component in ([args.component] if args.component else IDS):
            value = inputs(component, args.target, args.source)
            restored = None if args.force else store().restore(component, args.target, value,
                args.directory / component, roles={'runtime', 'metadata'}, requested_source=args.source)
            result.append({'component': component, 'version': version(component, args.source),
                           'inputs': value, 'hit': restored is not None})
        print(json.dumps(result))
    else:
        globals()[args.command.replace('-', '_')](args)


if __name__ == '__main__':
    main()
