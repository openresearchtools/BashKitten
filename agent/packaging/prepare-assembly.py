#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Restore published modules and assemble packages without native compilation."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import time

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent


def module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), HERE / (name + '.py'))
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def wait_for_components(target, minutes):
    store, native, app, office = (module(name) for name in
                                  ('component-store', 'native-components', 'app-runtime', 'office/components'))
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    native_ids = ['auth', 'search', 'node'] + (['machines', 'display', 'guest'] if target.startswith('linux-') else ['os', 'loader'])
    deadline = time.monotonic() + minutes * 60
    while True:
        missing = []
        for component in native_ids + list(app.COMPONENTS) + list(office.IDS):
            wanted = (app.inputs(component, target) if component in app.COMPONENTS else
                      office.inputs(component, target, source) if component in office.IDS else
                      native.component_inputs(component, target))
            if not store.lookup(component, target, wanted):
                missing.append(component)
        for family in ('office', 'files'):
            component = family + '-runtime'
            wanted = office.aggregate_inputs(family, target, source)
            if wanted is None or not store.lookup(component, target, wanted):
                missing.append(component)
        if not missing:
            return
        if time.monotonic() >= deadline:
            raise ValueError('Required components have not finished: ' + ', '.join(missing))
        print('Waiting for published components: ' + ', '.join(missing), flush=True)
        time.sleep(30)


def prepare(target, directory, wait_minutes=180):
    directory.mkdir(parents=True, exist_ok=True)
    wait_for_components(target, wait_minutes)
    native = module('native-components')
    values = native.assembly(target, directory / 'native')
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    office_dir = directory / 'applications'
    subprocess.run(['python3', str(HERE / 'office/components.py'), 'assemble', '--target', target,
                    '--source', source, '--directory', str(office_dir)], cwd=ROOT, check=True)
    values.update(json.loads((office_dir / 'assembly-inputs.json').read_text()))
    runtime = module('app-runtime').restore(target, directory / 'agent')
    values.update({name.replace('-', '_') + '_archive': path for name, path in runtime.items()})
    (directory / 'assembly-inputs.json').write_text(json.dumps(values, indent=2) + '\n')
    return values


def arguments(values):
    return [value for name, path in sorted(values.items()) if path is not None
            for value in ('--' + name.replace('_', '-'), str(path))]


def build(target, inputs_dir, output, browser_dir=None):
    store = module('component-store')
    if os.environ.get('GITHUB_ACTIONS') != 'true' or os.environ.get('GITHUB_REPOSITORY') != store.repository(target):
        raise ValueError('Application assembly runs only in its architecture builder')
    values = prepare(target, inputs_dir)
    platform, architecture = target.split('-', 1)
    command = ['python3', str(HERE / 'build.py'), platform, '--architecture', architecture]
    if platform == 'linux':
        if browser_dir is None:
            raise ValueError('Linux assembly requires a verified browser resource package')
        values['browser_dir'] = str(browser_dir)
        guest = Path(values['guest_packages'])
        backend_values = {name: path for name, path in values.items()
                          if name not in ('guest_packages', 'machines_archive', 'display_archive')}
        subprocess.run([*command, '--backend-only', '--output', str(guest), *arguments(backend_values)], check=True)
    subprocess.run([*command, '--output', str(output), *arguments(values)], check=True)
    # OS/guest components stay inside the parent package or its private guest
    # image. Only the matching Taskarian installer is a final application asset.
    return values


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('restore', 'build'))
    parser.add_argument('target')
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--browser-dir', type=Path)
    args = parser.parse_args()
    if args.action == 'restore':
        result = prepare(args.target, args.directory)
    else:
        result = build(args.target, args.directory, args.output, args.browser_dir)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
