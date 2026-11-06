#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Build reusable Pi/npm, Photon and Agent resources using their existing owners."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
COMPONENTS = ('npm-runtime', 'photon', 'agent-resources')


def module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), HERE / (name + '.py'))
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


store = module('component-store')
package = module('build')
sources = module('npm-sources')
source_cache = module('source_cache')


def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT, text=True).strip()


def objects(paths):
    result = {}
    for path in paths:
        line = git('ls-tree', 'HEAD', '--', path)
        if not line:
            raise ValueError('Missing component source: ' + path)
        result[path] = line.split()[2]
    return result


def inputs(component, target):
    if component not in COMPONENTS or target not in ('linux-amd64', 'linux-arm64', 'termux-aarch64', 'termux-x86_64'):
        raise ValueError('Unsupported Agent component/target')
    paths = ['agent/packaging/app-runtime.py', 'agent/packaging/source_cache.py']
    value = {'component': component, 'target': target}
    if component == 'npm-runtime':
        # npm's installed dependency tree does not depend on the root product
        # label. Keep the actual locked packages unchanged across app releases.
        lock = json.loads((ROOT / 'agent/package-lock.json').read_text())
        lock.pop('version', None)
        lock['packages'][''].pop('version', None)
        value['lock'] = lock
        tool = json.loads((HERE / 'node/lock.json').read_text())['linux']
        value['installer'] = {key: tool[key] for key in ('node_version', 'npm_version')}
        paths += ['agent/vendor/npm/sources.json', 'agent/vendor/pi/source.json',
                  'agent/packaging/npm-sources.py']
    elif component == 'photon':
        paths += ['agent/packaging/photon', 'agent/machines/rust-toolchain',
                  'agent/packaging/machines/build.py']
        lock = json.loads((ROOT / 'agent/package-lock.json').read_text())
        photon = json.loads((HERE / 'photon/lock.json').read_text())
        value['originalNpmPackage'] = lock['packages'][photon['package']['location']]
    else:
        paths += ['agent/src/server', 'agent/src/web', 'agent/src/phone', 'agent/reference',
                  'agent/licenses', 'agent/pi', 'agent/systematic-reviewer', 'agent/search/src',
                  'agent/search/third_party', 'agent/search/runtime-lock.json', 'agent/search/pyproject.toml',
                  'agent/search/taskarian-search', 'agent/search/LICENSE', 'agent/search/README.md',
                  'agent/search/THIRD_PARTY_NOTICES.md', 'agent/package.json', 'agent/package-lock.json',
                  'agent/LICENSE', 'agent/PI_UPSTREAM.md', 'agent/THIRD_PARTY_NOTICES.md',
                  'agent/packaging/pi-skills.py', 'agent/packaging/build.py', 'os/skills/desktop-use']
    value['sources'] = objects(paths)
    return value


def version(component):
    if component == 'photon':
        return json.loads((HERE / 'photon/lock.json').read_text())['package']['version']
    data = json.loads((ROOT / 'agent/package.json').read_text())
    return data['dependencies']['@earendil-works/pi-coding-agent'] if component == 'npm-runtime' else data['version']


def archive_tree(root, destination, selected=None):
    with tarfile.open(destination, 'w:gz', compresslevel=1) as archive:
        for path in selected or sorted(root.iterdir()):
            archive.add(path, arcname=str(path.relative_to(root)))


def original_source(destination, paths, originals=()):
    # The shared serializer includes donor files marked export-ignore too.
    # Original downloads stay outside Git and retain their exact bytes.
    helper_paths = ['LICENSE', 'agent/packaging/build.py', 'agent/packaging/component-store.py',
                    'agent/packaging/source_archive.py', 'agent/packaging/source_cache.py',
                    'agent/packaging/npm-sources.py', 'agent/packaging/node/lock.json',
                    'agent/licenses/source-archives.json']
    with tempfile.TemporaryDirectory() as temporary:
        selected = Path(temporary) / 'source.tar.gz'
        module('source_archive').archive_revision(ROOT, 'HEAD', selected, prefix='',
                                                 paths=sorted(set(paths + helper_paths)))
        with tarfile.open(selected) as original, tarfile.open(destination, 'w:gz', compresslevel=1) as output:
            for member in original:
                output.addfile(member, original.extractfile(member) if member.isfile() else None)
            seen = set()
            for path in originals:
                name = 'originals/' + path.name
                if name in seen:
                    continue
                seen.add(name)
                output.add(path, arcname=name)


def checksums(directory):
    paths = sorted(path for path in directory.iterdir() if path.is_file() and path.name != 'SHA256SUMS')
    (directory / 'SHA256SUMS').write_text(''.join(store.sha(path) + '  ' + path.name + '\n' for path in paths))


def extract_runtime(result, destination):
    directory = Path(result['directory'])
    for item in result['manifest']['assets']:
        if item['role'] == 'runtime':
            package.extract(directory / item['name'], destination)


def run(component, target, work, output, force=False):
    wanted = inputs(component, target)
    if not force:
        hit = store.restore(component, target, wanted, output, roles=('runtime', 'legal', 'metadata'))
        if hit:
            checksums(output)
            print('Reused ' + component + '/' + target, flush=True)
            return hit
    if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('GITHUB_REPOSITORY') != store.repository(target):
        raise ValueError('Component builds run only in the matching architecture builder')
    work.mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)
    runtime = work / component / 'runtime'
    shutil.rmtree(runtime, ignore_errors=True)
    runtime.mkdir(parents=True)
    platform, architecture = target.split('-', 1)
    originals, dependencies = [], []
    legal = output / f'{component}-{target}-NOTICES.txt'
    if component == 'npm-runtime':
        for name in ('package.json', 'package-lock.json'):
            shutil.copy2(ROOT / 'agent' / name, runtime / name)
        originals = sources.locked_archives()
        npm_cache = work / 'npm-cache'
        subprocess.run(['npm', 'cache', 'add', '--cache', str(npm_cache), '--ignore-scripts',
                        '--no-audit', '--no-fund', *map(str, originals)], check=True)
        subprocess.run(['npm', 'ci', '--prefix', str(runtime), '--cache', str(npm_cache), '--offline',
                        '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund',
                        '--os=' + ('android' if platform == 'termux' else 'linux'),
                        '--cpu=' + ('x64' if architecture in ('amd64', 'x86_64') else 'arm64')], check=True)
        pi = json.loads((ROOT / 'agent/vendor/pi/source.json').read_text())
        originals.append(source_cache.fetch(pi))
        texts = package.license_files(runtime / 'node_modules')
        if not texts:
            raise ValueError('Installed npm runtime has no full license texts')
        legal.write_text('\n\n'.join(str(path.relative_to(runtime)) + '\n\n' + path.read_text(errors='replace') for path in texts))
        selected = [runtime / 'node_modules']
    elif component == 'photon':
        incoming = work / 'npm-input'
        dependency = store.restore('npm-runtime', target, inputs('npm-runtime', target), incoming, roles=('runtime',))
        if not dependency:
            raise ValueError('Build npm-runtime before Photon')
        dependencies.append({key: dependency[key] for key in ('repository', 'manifestName', 'manifestSha256')})
        extract_runtime(dependency, runtime)
        lock = json.loads((HERE / 'photon/lock.json').read_text())
        rust = json.loads((ROOT / lock['rustToolchain']).read_text())
        subprocess.run(['rustup', 'toolchain', 'install', rust['version'], '--profile', 'minimal',
                        '--component', 'rust-docs', '--target', 'wasm32-unknown-unknown'], check=True)
        owner = module('photon/build')
        owner.build(runtime, work / 'photon-cache')
        selected = [runtime / lock['package']['location']]
        shutil.copy2(selected[0] / 'TASKARIAN-NOTICES.txt', legal)
        originals = [source_cache.fetch(pin) for pin in [lock['source'], lock['generator']['archive'], *lock['crates'], rust]]
    else:
        package.install_agent_sources(runtime, platform)
        selected = None
        legal.write_text((ROOT / 'agent/LICENSE').read_text() + '\n\n' + (ROOT / 'agent/THIRD_PARTY_NOTICES.md').read_text())
    taskarian_license = (ROOT / 'LICENSE').read_text()
    notices = legal.read_text()
    if taskarian_license not in notices:
        legal.write_text('Taskarian\n\n' + taskarian_license + '\n\n' + notices)
    payload = output / f'{component}-{target}.tar.gz'
    archive_tree(runtime, payload, selected)
    source = output / f'{component}-source-{target}.tar.gz'
    original_source(source, sorted(set(wanted['sources']) | {'agent/package.json', 'agent/package-lock.json'}), originals)
    result = store.publish(component, target, version(component), wanted, output,
                           assets={payload.name: 'runtime', source.name: 'source', legal.name: 'legal'},
                           source_commit=git('rev-parse', 'HEAD'), dependencies=dependencies,
                           validation_only=force)
    checksums(output)
    return result


def restore(target, directory):
    result = {}
    for component in COMPONENTS:
        folder = directory / component
        hit = store.restore(component, target, inputs(component, target), folder, roles=('runtime', 'legal', 'metadata'))
        if not hit:
            raise ValueError('Required component has not been built: ' + component + '/' + target)
        checksums(folder)
        result[component] = str(folder / f'{component}-{target}.tar.gz')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('plan', 'run', 'restore'))
    parser.add_argument('component_or_target')
    parser.add_argument('target', nargs='?')
    parser.add_argument('--work', type=Path)
    parser.add_argument('--output', '--directory', dest='directory', type=Path)
    parser.add_argument('--force-rebuild', action='store_true')
    args = parser.parse_args()
    if args.action == 'plan':
        target = args.component_or_target
        print(json.dumps([{'component': name, 'target': target, 'inputs': inputs(name, target),
                           'version': version(name), 'available': store.lookup(name, target, inputs(name, target)) is not None}
                          for name in COMPONENTS]))
    elif args.action == 'run':
        run(args.component_or_target, args.target, args.work, args.directory, args.force_rebuild)
    else:
        print(json.dumps(restore(args.component_or_target, args.directory)))


if __name__ == '__main__':
    main()
