#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""One architecture worker; component owners retain their own native build systems."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


owner = load('native_worker_components', HERE / 'native-components.py')
store = owner.store


def providers():
    app = load('worker_app_components', HERE / 'app-runtime.py') if (HERE / 'app-runtime.py').is_file() else SimpleNamespace(COMPONENTS=())
    office = load('worker_office_components', HERE / 'office/components.py') if (HERE / 'office/components.py').is_file() else SimpleNamespace(IDS=())
    android = load('worker_android_components', HERE / 'android-components.py') if (HERE / 'android-components.py').is_file() else SimpleNamespace(IDS=())
    return app, office, android


def materialize(plan):
    paths = {'agent/packaging', 'LICENSE', 'agent/package.json', 'agent/package-lock.json',
             'auth/upstreams.lock.json', 'auth/dependencies/go-toolchain/sources.json',
             'agent/machines/rust-toolchain/sources.json', 'browser/taskarian/config/version.txt'}
    for item in plan:
        component, value = item['component'], item.get('inputs') or {}
        paths.update(name for key in ('files', 'sources', 'trees') for name, oid in value.get(key, {}).items() if oid)
        if component.startswith('auth-'):
            paths.add('auth/build')
            if component in owner.tools.AUTH_GO:
                retained = json.loads(owner.native.content(owner.head(), 'auth/dependencies/go/sources.json'))
                paths.update(retained['locks']); paths.add('auth/dependencies/go')
        elif component.startswith('machines'):
            paths.add('auth/build/go-notices.py')
        elif component in ('node', 'search', 'search-primp'):
            paths.update(('auth/build', 'auth/dependencies/termux'))
            if component == 'search-primp':paths.add('agent/search')
        elif component == 'os' or component.startswith('os-'):
            paths.add('os')
        elif component == 'display':
            paths.add('browser/taskarian/display')
        elif component == 'loader':
            paths.update(('browser/mobile/android/taskarian/display/loader',
                          'browser/mobile/android/taskarian/display/src/main/java/com/taskarian/display/DisplayProtocol.java',
                          'browser/taskarian/vendor/termux-x11/source.json',
                          'browser/taskarian/vendor/termux-x11/source/LICENSE'))
        elif component in ('office-runtime', 'files-runtime'):
            paths.update(('office/branding', 'office/patches', 'files/patches/collabora',
                          'office/upstream/online/source.json', 'files/vendor/quantum/SOURCE.json',
                          'browser/taskarian/browser/branding'))
        elif component in ('office-engine', 'office-server', 'office-ui'):
            paths.update(('office', 'files/patches/collabora', 'auth/build', 'auth/dependencies/go-toolchain',
                          'agent/machines/rust-toolchain', 'browser/taskarian/browser/branding'))
        elif component.startswith('files-'):
            paths.update(('files', 'auth/build', 'auth/dependencies/go-toolchain'))
        elif component in ('references', 'office-integration'):
            paths.update(('references', 'office/package.json', 'office/package-lock.json', 'office/vendor/npm'))
        elif component.startswith('android-'):
            paths.update(('browser/mobile/android/taskarian', 'browser/taskarian/vendor/termux-x11',
                          'browser/mobile/android/android-components', 'browser/mobile/android/gradle',
                          'browser/taskarian/android', 'agent/native/remote', 'auth/build', 'auth/dependencies'))
        elif component in owner.APP:
            paths.update(('agent', 'os/skills/desktop-use'))
    # Git objects identify directories recursively; selected source units do not
    # require unrelated Mozilla, LibreOffice or other component source trees.
    selected = [path for path in sorted(paths) if owner.native.entry(owner.head(), path)]
    subprocess.run(['git', 'sparse-checkout', 'set', '--no-cone', '--stdin'], cwd=ROOT,
                   input='\n'.join('/' + path + ('/' if owner.native.git('cat-file', '-t', owner.native.entry(owner.head(), path)) == 'tree' else '') for path in selected) + '\n',
                   text=True, check=True, env={**os.environ, 'GIT_LFS_SKIP_SMUDGE': '1'})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['plan', 'materialize', 'build'])
    parser.add_argument('target'); parser.add_argument('--components', default='["all"]')
    parser.add_argument('--plan', type=Path, required=True); parser.add_argument('--work', type=Path)
    parser.add_argument('--output', type=Path); parser.add_argument('--force-rebuild', action='store_true')
    args = parser.parse_args()
    if os.environ.get('GITHUB_REPOSITORY') != store.repository(args.target):
        raise ValueError('Use the existing matching architecture repository')
    if args.action == 'materialize':
        materialize(json.loads(args.plan.read_text()))
        return
    app, office, android = providers()
    android_ids = tuple(getattr(android, 'IDS', ('android-remote', 'android-tor', 'android-x11'))) if args.target.startswith('termux-') else ()
    if args.action == 'plan':
        selected = json.loads(args.components)
        if selected == 'all' or 'all' in selected:
            selected = [*owner.components(args.target), *android_ids, *app.COMPONENTS, *office.IDS]
        aliases = {'auth': ['runtime-guard', *owner.AUTH, 'auth'],
                   'machines': [*('machines-' + name for name in owner.MACHINES), 'machines'] if args.target.startswith('linux-') else [],
                   'environments': [*('machines-' + name for name in owner.MACHINES), 'machines', 'display', 'os-windowing', 'os-panel', 'os', 'guest-sudo', 'guest-fusermount', 'guest'] if args.target.startswith('linux-') else ['os-dbusmenu', 'os-windowing', 'os-panel', 'os', 'loader']}
        selected = list(dict.fromkeys(value for item in selected for value in aliases.get(item, [item])))
        if args.target.startswith('termux-'):
            selected = [item for item in selected if not item.startswith('machines') and item not in ('display', 'guest')]
        closure = {'auth': ['runtime-guard', *owner.AUTH], 'machines': ['machines-' + name for name in owner.MACHINES],
                   'machines-fuse-overlayfs': ['machines-libfuse'], 'photon': ['npm-runtime'],
                   'search': ['search-primp'] if args.target.startswith('termux-') else [],
                   'guest': ['guest-sudo', 'guest-fusermount', 'os'],
                   'os-panel': ['os-windowing', *(['os-dbusmenu'] if args.target.startswith('termux-') else [])],
                   'os': ['os-windowing', 'os-panel', *(['os-dbusmenu'] if args.target.startswith('termux-') else [])],
                   'office-server': ['office-engine'], 'office-ui': ['office-engine']}
        pending = list(selected)
        while pending:
            for dependency in closure.get(pending.pop(), []):
                if dependency not in selected:
                    selected.append(dependency); pending.append(dependency)
        aggregate_ids = {family + '-runtime' for family in getattr(office, 'FAMILIES', {})}
        for family, leaves in getattr(office, 'FAMILIES', {}).items():
            if family + '-runtime' in selected:
                selected += [item for item in leaves if item not in selected]
        families = [family for family, leaves in getattr(office, 'FAMILIES', {}).items()
                    if family + '-runtime' in selected or any(item in selected for item in leaves)]
        known = set(owner.components(args.target)) | set(app.COMPONENTS) | set(office.IDS) | set(android_ids) | aggregate_ids
        if any(item not in known for item in selected):
            raise ValueError('Unknown component selection')
        # Native dependencies finish before packaging or their dependent owner.
        order = list(dict.fromkeys([*owner.components(args.target), *android_ids, *app.COMPONENTS, *office.IDS]))
        selected = [item for item in order if item in selected]
        plan = []
        for component in selected:
            if component in app.COMPONENTS:
                value = app.inputs(component, args.target)
            elif component in android_ids:
                value = android.inputs(component, args.target, owner.head())
            elif component in office.IDS:
                value = office.inputs(component, args.target, owner.head())
            else:
                value = owner.inputs(component, args.target)
            available = None if args.force_rebuild else store.lookup(component, args.target, value)
            if available is None:
                plan.append({'component': component, 'inputs': value})
        for family in families:
            value = office.aggregate_inputs(family, args.target, owner.head())
            if value is None or args.force_rebuild or store.lookup(family + '-runtime', args.target, value) is None:
                plan.append({'component': family + '-runtime', 'inputs': value})
        args.plan.write_text(json.dumps(plan, indent=2) + '\n')
        if os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
                output.write('build=' + str(bool(plan)).lower() + '\n')
                ids = {item['component'] for item in plan}
                needs_rust = bool(ids & (owner.tools.MACHINE_RUST | {'photon'}))
                output.write('needs_rust=' + str(needs_rust).lower() + '\n')
                output.write('rust=' + json.loads(owner.native.content(owner.head(), 'agent/machines/rust-toolchain/sources.json'))['version'] + '\n')
                output.write('needs_go=' + str(bool(ids & (owner.tools.AUTH_GO | owner.tools.MACHINE_GO | {'files-server', 'files-office-addon', 'android-remote'}))).lower() + '\n')
                output.write('needs_node=' + str(bool(ids & {'auth-authelia', 'npm-runtime', 'office-ui', 'files-ui', 'references', 'office-integration', 'files-integration'})).lower() + '\n')
                build_tools = json.loads(owner.native.content(owner.head(), 'auth/upstreams.lock.json'))['build']
                node_pin = json.loads(owner.native.content(owner.head(), 'agent/packaging/node/lock.json'))['linux']['node_version']
                output.write('node=' + (build_tools['node'] if 'auth-authelia' in ids else node_pin) + '\n')
                output.write('pnpm=' + build_tools['pnpm'] + '\n')
                output.write('needs_pnpm=' + str('auth-authelia' in ids).lower() + '\n')
                needs_cache = bool(ids & {'office-engine', 'office-server'})
                output.write('needs_office_cache=' + str(needs_cache).lower() + '\n')
                if needs_cache:
                    key = __import__('hashlib').sha256(store.canonical(office.cache_contract(args.target, owner.head()))).hexdigest()
                    output.write('office_cache_key=office-objects-' + args.target + '-' + key + '\n')
                output.write('go=' + json.loads(owner.native.content(owner.head(), 'auth/dependencies/go-toolchain/sources.json'))['version'] + '\n')
        print('Changed or missing components:', ', '.join(item['component'] for item in plan) or 'none')
        return
    failed = []
    office_tools_ready = False
    office_web_tools_ready = False
    for item in json.loads(args.plan.read_text()):
        component = item['component']
        work = args.work / component; output = args.output / component
        command = [sys.executable]
        if component in app.COMPONENTS:
            command += [str(HERE / 'app-runtime.py'), 'run', component, args.target,
                        '--work', str(work), '--output', str(output)]
            if args.force_rebuild:
                command.append('--force-rebuild')
        elif component in ('office-runtime', 'files-runtime'):
            command += [str(HERE / 'office/components.py'), 'aggregate', '--family', component.removesuffix('-runtime'),
                        '--target', args.target, '--source', owner.head(), '--directory', str(output)]
        elif component in android_ids:
            command += [str(HERE / 'android-components.py'), 'run', component, args.target,
                        '--work', str(work), '--output', str(output)]
            if args.force_rebuild:
                command.append('--force-rebuild')
        elif component in office.IDS:
            if component == 'office-ui' and not office_tools_ready and not office_web_tools_ready:
                preparation = subprocess.run(['bash', str(HERE / 'office/web-prepare-runner.sh')], cwd=ROOT)
                if preparation.returncode:
                    failed.append(component)
                    print('::error::Office web prerequisite setup failed: ' + component, flush=True)
                    continue
                office_web_tools_ready = True
            if component in ('office-engine', 'office-server', 'files-server', 'files-media', 'files-office-addon') and not office_tools_ready:
                preparation = subprocess.run(['bash', str(HERE / 'office/prepare-runner.sh')], cwd=ROOT)
                if preparation.returncode:
                    failed.append(component)
                    print('::error::Native prerequisite setup failed: ' + component, flush=True)
                    continue
                office_tools_ready = True
            command += [str(HERE / 'office/components.py'), 'build', '--component', component,
                        '--target', args.target, '--source', owner.head(), '--directory', str(output),
                        '--work', str(work), '--cache', str(args.work / 'sources')]
            if args.force_rebuild:
                command.append('--force')
        else:
            command += [str(HERE / 'native-components.py'), 'run', component, args.target,
                        '--work', str(work), '--output', str(output)]
            if args.force_rebuild:
                command.append('--force-rebuild')
        print('::group::' + component, flush=True)
        result = subprocess.run(command, cwd=ROOT)
        print('::endgroup::', flush=True)
        if result.returncode:
            failed.append(component)
            print('::error::Component failed: ' + component, flush=True)
    if failed:
        raise SystemExit('Failed components (finished siblings remain published): ' + ', '.join(failed))


if __name__ == '__main__':
    main()
