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
    return app, office


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['plan', 'build'])
    parser.add_argument('target'); parser.add_argument('--components', default='["all"]')
    parser.add_argument('--plan', type=Path, required=True); parser.add_argument('--work', type=Path)
    parser.add_argument('--output', type=Path); parser.add_argument('--force-rebuild', action='store_true')
    args = parser.parse_args()
    if os.environ.get('GITHUB_REPOSITORY') != store.repository(args.target):
        raise ValueError('Use the existing matching architecture repository')
    app, office = providers()
    if args.action == 'plan':
        selected = json.loads(args.components)
        if selected == 'all' or 'all' in selected:
            selected = [*owner.components(args.target), *app.COMPONENTS, *office.IDS]
        aliases = {'auth': [*owner.AUTH, *(['runtime-guard'] if args.target.startswith('linux-') else []), 'auth'],
                   'machines': [*('machines-' + name for name in owner.MACHINES), 'machines'] if args.target.startswith('linux-') else [],
                   'environments': [*('machines-' + name for name in owner.MACHINES), 'machines', 'display', 'guest'] if args.target.startswith('linux-') else ['os', 'loader']}
        selected = list(dict.fromkeys(value for item in selected for value in aliases.get(item, [item])))
        if args.target.startswith('termux-'):
            selected = [item for item in selected if item != 'runtime-guard' and not item.startswith('machines') and item not in ('display', 'guest')]
        closure = {'auth': list(owner.AUTH), 'machines': ['machines-' + name for name in owner.MACHINES],
                   'machines-fuse-overlayfs': ['machines-libfuse'], 'photon': ['npm-runtime'],
                   'office-server': ['office-engine'], 'office-ui': ['office-engine']}
        pending = list(selected)
        while pending:
            for dependency in closure.get(pending.pop(), []):
                if dependency not in selected:
                    selected.append(dependency); pending.append(dependency)
        known = set(owner.components(args.target)) | set(app.COMPONENTS) | set(office.IDS)
        if any(item not in known for item in selected):
            raise ValueError('Unknown component selection')
        # Native dependencies finish before packaging or their dependent owner.
        order = [*owner.components(args.target), *app.COMPONENTS, *office.IDS]
        selected = [item for item in order if item in selected]
        plan = []
        for component in selected:
            if component in app.COMPONENTS:
                value = app.inputs(component, args.target)
            elif component in office.IDS:
                value = office.inputs(component, args.target, owner.head())
            else:
                value = owner.inputs(component, args.target)
            available = None if args.force_rebuild else store.lookup(component, args.target, value)
            if available is None:
                plan.append({'component': component, 'inputs': value})
        args.plan.write_text(json.dumps(plan, indent=2) + '\n')
        if os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'], 'a') as output:
                output.write('build=' + str(bool(plan)).lower() + '\n')
                ids = {item['component'] for item in plan}
                output.write('needs_go=' + str(bool(ids & (owner.tools.AUTH_GO | owner.tools.MACHINE_GO | {'files-server', 'files-office-addon'}))).lower() + '\n')
                output.write('needs_node=' + str(bool(ids & {'auth-authelia', 'npm-runtime', 'office-ui', 'files-ui', 'references', 'office-integration', 'files-integration'})).lower() + '\n')
                output.write('needs_pnpm=' + str('auth-authelia' in ids).lower() + '\n')
                output.write('go=' + json.loads(owner.native.content(owner.head(), 'auth/dependencies/go-toolchain/sources.json'))['version'] + '\n')
        print('Changed or missing components:', ', '.join(item['component'] for item in plan) or 'none')
        return
    failed = []
    office_tools_ready = False
    for item in json.loads(args.plan.read_text()):
        component = item['component']
        work = args.work / component; output = args.output / component
        command = [sys.executable]
        if component in app.COMPONENTS:
            command += [str(HERE / 'app-runtime.py'), 'run', component, args.target,
                        '--work', str(work), '--output', str(output)]
            if args.force_rebuild:
                command.append('--force-rebuild')
        elif component in office.IDS:
            if component in ('office-engine', 'office-server', 'office-ui', 'files-server', 'files-media', 'files-office-addon') and not office_tools_ready:
                subprocess.run(['bash', str(HERE / 'office/prepare-runner.sh')], cwd=ROOT, check=True)
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
