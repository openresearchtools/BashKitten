#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""One-time, explicit adoption of completed outputs after input-scope corrections."""
import argparse
import ast
import hashlib
import importlib.util
import json
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('scope_native_owner', HERE / 'native-components.py')
owner = importlib.util.module_from_spec(spec); spec.loader.exec_module(owner)
BASE = '8af828de43aaa6cd27b39252fcb993503472c9ed'
NDK_BASE = '9f4e973091cb3698af1ca9a590eb4b2f535d1746'
RECIPE = 'agent/packaging/native-components.py'
PRIMP_RECIPE = 'agent/packaging/termux/search/build.py'
RUNS = {'termux-aarch64': '42138395179', 'termux-x86_64': '42140105478'}
FUNCTIONS = {
    'search-primp': ('build_primp', 'build_primp_component', 'run', 'pack'),
    'os': ('os_native_stage', 'build_os_package', 'run', 'extract', 'restore_component'),
    'runtime-guard': ('run_component', 'run', 'pack'),
}
OFFICE = ('office-engine', 'files-server', 'files-media', 'files-office-addon')
PRIMP_HEADER = '''#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Native Primp recipe using the pinned upstream Termux build framework."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[4]


'''


def function(text, name):
    node = next(item for item in ast.parse(text).body
                if isinstance(item, ast.FunctionDef) and item.name == name)
    return ast.get_source_segment(text, node)


def proof(component, target, source):
    if component not in FUNCTIONS or target not in RUNS:
        raise ValueError('This one-time adoption covers only the known Termux source-scope correction')
    previous = json.loads(json.dumps(owner.inputs(component, target, BASE)))
    current = owner.inputs(component, target, source)
    current_recipe = PRIMP_RECIPE if component == 'search-primp' else RECIPE
    if component == 'search-primp':
        # Reconstruct the exact old stored map after the straight native-owner
        # extraction; normal lookup uses only the new recipe's Git blob ID.
        previous['files'].pop(PRIMP_RECIPE)
        previous['files'][RECIPE] = owner.native.entry(BASE, RECIPE)
    old, new = json.loads(json.dumps(previous)), json.loads(json.dumps(current))
    if not old['files'].pop(RECIPE, None) or not new['files'].pop(current_recipe, None) or old != new:
        raise ValueError('Native inputs changed beyond the unrelated adapter file: ' + component)
    texts = [owner.native.content(BASE, RECIPE), owner.native.content(source, current_recipe)]
    if component == 'search-primp':
        extracted = PRIMP_HEADER + '\n\n\n'.join(function(texts[0], name)
            for name in ('run', 'pack', 'build_primp', 'build_primp_component'))
        if texts[1] != extracted:
            raise ValueError('Primp owner differs from the exact straight extraction')
    elif texts[0].split('\ndef head():', 1)[0] != texts[1].split('\ndef head():', 1)[0]:
        raise ValueError('Native build imports or repository paths changed')
    functions = {}
    for name in FUNCTIONS[component]:
        before, after = [function(text, name) for text in texts]
        if before != after:
            raise ValueError('Actual native production function changed: ' + name)
        functions[name] = hashlib.sha256(before.encode()).hexdigest()
    return previous, current, functions


def seed(component, target, source, directory):
    previous, wanted, functions = proof(component, target, source)
    existing = owner.store.lookup(component, target, wanted)
    if existing:
        return {'component': component, 'state': 'already-published', **owner.reference(existing)}
    original = owner.store.lookup(component, target, previous)
    if original is None:
        return {'component': component, 'state': 'no-completed-previous-output'}
    manifest = original['manifest']
    producer = manifest['producer']
    if (manifest['sourceCommit'] != BASE or producer.get('repository') != owner.store.repository(target)
            or str(producer.get('run')) != RUNS[target]):
        raise ValueError('The completed native output is not its known original producer')
    if not {'runtime', 'source', 'legal'} <= {asset['role'] for asset in manifest['assets']}:
        raise ValueError('Original output lacks complete runtime, source or license assets')
    output = directory / component
    if owner.store.fetch(original, output) is None:
        raise owner.store.StoreUnavailable('Original native component disappeared; retry adoption')
    owner.validate_outputs(component, target, output)
    # The original files are never repacked or relabelled. Only an outside-archive
    # proof and the source of this one-time publisher accompany their new identity.
    receipt = output / 'adapter-input-equivalence.json'
    receipt.write_text(json.dumps({'schema': 1, 'previous': owner.reference(original),
        'producerSource': BASE, 'requestedSource': source, 'previousInputs': previous,
        'inputs': wanted, 'productionFunctionsSha256': functions,
        'scope': 'Only unrelated native adapter bytes changed; actual production functions are identical'},
        indent=2) + '\n')
    from source_archive import archive_revision
    publisher_source = output / 'adapter-adoption-source.tar.gz'
    archive_revision(owner.ROOT, source, publisher_source, paths=[
        'LICENSE', 'agent/packaging/native-scope.py', '.github/builders/native.yml',
        RECIPE, PRIMP_RECIPE, 'agent/packaging/native-component.py'])
    assets = {asset['name']: asset['role'] for asset in manifest['assets']}
    assets.update({receipt.name: 'metadata', publisher_source.name: 'source'})
    result = owner.store.publish(component, target, manifest['version'], wanted, output,
        assets=assets, source_commit=manifest['sourceCommit'], producer=producer,
        dependencies=[*manifest.get('dependencies', []), owner.reference(original)])
    return {'component': component, 'state': 'adopted', **owner.reference(result)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('target', choices=tuple(RUNS))
    parser.add_argument('--components', default='["all"]')
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--work', type=Path, required=True)
    args = parser.parse_args()
    if (os.environ.get('GITHUB_ACTIONS') != 'true'
            or os.environ.get('GITHUB_REPOSITORY') != owner.store.repository(args.target)):
        raise ValueError('Run explicit adoption in the matching architecture worker')
    source = owner.head()
    for revision in (BASE, NDK_BASE):
        if not owner.native.local(revision):
            owner.native.git('fetch', '--no-tags', '--filter=blob:none', '--depth=1', 'origin', revision)
            owner.native.local.cache_clear()
    selected = json.loads(args.components)
    if selected == 'all' or 'all' in selected:
        selected = [*FUNCTIONS, *OFFICE]
    if any(component not in (*FUNCTIONS, *OFFICE) for component in selected):
        raise ValueError('Unknown explicit native input-scope adoption')
    args.output = args.output.resolve(); args.work = args.work.resolve()
    if args.output.is_relative_to(owner.ROOT) or args.work.is_relative_to(owner.ROOT):
        raise ValueError('Adoption output and work remain outside the source checkout')
    args.output.mkdir(parents=True, exist_ok=True); args.work.mkdir(parents=True, exist_ok=True)
    results = []
    for component in (*FUNCTIONS, *OFFICE):
        if component not in selected:
            continue
        if component in FUNCTIONS:
            results.append(seed(component, args.target, source, args.output))
        else:
            owner.run(['python3', HERE / 'office/components.py', 'seed-ndk',
                '--target', args.target, '--source', source, '--previous-source', NDK_BASE,
                '--component', component, '--directory', args.output / 'ndk', '--work', args.work])
    (args.output / 'source-scope-adoption.json').write_text(json.dumps(results, indent=2) + '\n')
    print(json.dumps(results))


if __name__ == '__main__':
    main()
