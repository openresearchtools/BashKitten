#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Direct-release transport for final app assemblies; never builds a component."""
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('component_store', Path(__file__).with_name('component-store.py'))
store = importlib.util.module_from_spec(spec)
spec.loader.exec_module(store)


def inputs(target):
    return {'source': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
            'productVersion': (ROOT / 'browser/taskarian/config/version.txt').read_text().strip(), 'target': target}


def publish(target, directory, *, component='application', dependencies=(), validation_only=False):
    wanted = inputs(target)
    assets = {}
    for path in sorted(directory.iterdir()):
        if path.is_file() and not path.is_symlink():
            name = path.name
            if component == 'application' and path.suffix == '.deb':
                package = subprocess.check_output(['dpkg-deb', '-f', str(path), 'Package'], text=True).strip()
                if package != 'taskarian':
                    raise ValueError('Application outputs must contain only the parent Taskarian installer: ' + name)
            role = ('source' if any(token in name for token in ('-source', '-provenance')) and any(extension in name for extension in ('.tar', '.jar'))
                    else 'legal' if name.lower().endswith(('notices.txt', 'licenses.json'))
                    else 'runtime')
            assets[name] = role
    if not assets:
        raise ValueError('Application assembly has no files')
    return store.publish(component, target, wanted['productVersion'], wanted, directory,
                         assets=assets, source_commit=wanted['source'], dependencies=dependencies,
                         validation_only=validation_only)


def restore(target, directory, *, component='application'):
    return store.restore(component, target, inputs(target), directory, roles=('runtime', 'metadata', 'legal'))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('publish', 'restore', 'identity'))
    parser.add_argument('target')
    parser.add_argument('--directory', type=Path)
    parser.add_argument('--component', default='application')
    parser.add_argument('--dependencies', type=Path)
    parser.add_argument('--validation-only', action='store_true')
    args = parser.parse_args()
    if args.action == 'identity':
        result = store.identity(args.component, args.target, inputs(args.target))
    elif args.action == 'publish':
        dependencies = json.loads(args.dependencies.read_text()) if args.dependencies else []
        result = publish(args.target, args.directory, component=args.component, dependencies=dependencies,
                         validation_only=args.validation_only)
    else:
        result = restore(args.target, args.directory, component=args.component)
        if not result:
            parser.exit(1, 'Application output is not published for this source yet\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
