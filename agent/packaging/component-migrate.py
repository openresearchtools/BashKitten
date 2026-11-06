#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""One-time native-builder transport migration; compilation is never performed.

Original source, runtime and provenance bytes are retained. Normal builds use the
small direct version indexes in component-store.py, without this inventory step.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import tempfile

HERE = Path(__file__).resolve().parent


def module(name):
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), HERE / (name + '.py'))
    value = importlib.util.module_from_spec(spec); spec.loader.exec_module(value)
    return value


store = module('component-store')


def inventory():
    """Freeze newest existing group roots, then retain every exact dependency."""
    releases, roots, metadata = {}, {}, {}
    for repo in sorted(store.REPOSITORIES):
        release = store.gh('api', f'repos/{repo}/releases/tags/{store.TAG}')
        if release is None:
            raise ValueError('Migration source release is missing: ' + repo)
        assets = store.release_assets(repo, release['id'])
        releases[repo] = {item['name']: item for item in assets}
        for item in assets:
            match = store.MANIFEST.fullmatch(item['name'])
            if match:
                group = (repo, *match.groups())
                if group not in roots or item['created_at'] > roots[group]['created_at']:
                    roots[group] = item
    pending = [(group[0], item['name']) for group, item in roots.items()]
    while pending:
        repo, name = pending.pop()
        if (repo, name) in metadata:
            continue
        raw = store.read_url(f'https://github.com/{repo}/releases/download/{store.TAG}/{name}')
        if raw is None:
            raise ValueError('Required original component is missing: ' + name)
        record = json.loads(raw); ident = store.validate(record)
        if ident['repository'] != repo or ident['manifest'] != name:
            raise ValueError('Original component identity differs')
        item = releases[repo][name]
        if item.get('digest') != 'sha256:' + hashlib.sha256(raw).hexdigest():
            raise ValueError('Original component manifest checksum differs')
        metadata[repo, name] = (raw, record)
        for asset in record['assets']:
            for part in asset['parts']:
                original = releases[repo].get(part['asset'])
                if not original or original['size'] != part['size'] or original.get('digest') != 'sha256:' + part['sha256']:
                    raise ValueError('Original component part inventory differs: ' + part['asset'])
        for dependency in record.get('dependencies', []):
            pending.append((dependency['repository'], dependency['manifestName']))
    for _, record in metadata.values():
        for dependency in record.get('dependencies', []):
            raw, _ = metadata[dependency['repository'], dependency['manifestName']]
            if hashlib.sha256(raw).hexdigest() != dependency['manifestSha256']:
                raise ValueError('Original dependency pin checksum differs')
    return releases, roots, metadata


def migrate_one(repo, name, raw, manifest, work):
    tag = store.release_tag(manifest['component'], manifest['target'], manifest['version'], manifest['inputSha256'])
    release = store.ensure_release(repo, tag, f'{manifest["component"]} {manifest["version"]} / {manifest["target"]}')
    uploaded = {item['name']: item for item in store.release_assets(repo, release['id'])}
    with tempfile.TemporaryDirectory(prefix='component-', dir=work) as temporary:
        temporary = Path(temporary)
        existing = store.lookup(manifest['component'], manifest['target'], manifest['inputs'])
        if existing and existing['manifestSha256'] != hashlib.sha256(raw).hexdigest():
            raise ValueError('Migration canonical manifest differs')
        for asset in manifest['assets']:
            runtime = not existing and store.runtime_owner().effective_role(asset) != 'source' and manifest['component'] not in ('application', 'corresponding-source')
            destination = temporary / asset['name']
            output = destination.open('wb') if runtime else None
            try:
                # Source parts transfer exactly once, unopened/uncombined. For
                # runtime bytes the same download also feeds the licensed bundle.
                for part in asset['parts']:
                    previous = uploaded.get(part['asset'])
                    if previous and (previous['size'] != part['size'] or previous.get('digest') != 'sha256:' + part['sha256']):
                        raise ValueError('Permanent component part differs')
                    if previous and not runtime:
                        continue
                    file = temporary / part['asset']
                    store.download(f'https://github.com/{repo}/releases/download/{store.TAG}/{part["asset"]}', file, part['size'], part['sha256'])
                    if not previous:
                        store.upload_file(repo, tag, file, uploaded)
                    if output:
                        with file.open('rb') as source:
                            import shutil
                            shutil.copyfileobj(source, output, 8 * 1024 ** 2)
                    file.unlink()
            finally:
                if output:
                    output.close()
            if runtime and (destination.stat().st_size != asset['size'] or store.sha(destination) != asset['sha256']):
                raise ValueError('Original runtime reconstruction differs')
        if existing:
            return existing
        runtime_sha = store.publish_runtime(manifest, temporary, tag, uploaded, temporary)
        file = temporary / name; file.write_bytes(raw)
        store.upload_file(repo, tag, file, uploaded)
        store.publish_index(manifest, hashlib.sha256(raw).hexdigest(), runtime_sha, tag)
        print('Permanently published ' + repo + '/' + tag, flush=True)
        return {'repository': repo, 'manifestName': name, 'manifestSha256': hashlib.sha256(raw).hexdigest(), 'tag': tag}


def verify_native_checkpoints(metadata, repo, work):
    browser_release = module('browser-release')
    browser = module('browser-component')
    verified = []
    for (owner, name), (_, manifest) in sorted(metadata.items()):
        if owner != repo or manifest['component'] != 'gecko':
            continue
        target = manifest['target']
        directory = work / ('native-' + target) / 'producer'
        ref = store.lookup('gecko', target, manifest['inputs'])
        result = store.fetch(ref, directory, roles=('runtime', 'metadata', 'build-support', 'legal'))
        browser_release.engine_record(result, directory, target)
        verified.append({'component': 'gecko', 'target': target, 'manifestName': name,
                         'nativeOwnerVerification': 'passed', 'compiled': False})
    for (owner, name), (_, manifest) in sorted(metadata.items()):
        if owner != repo or manifest['component'] != 'browser-resources' or not manifest['target'].startswith('linux-'):
            continue
        target = manifest['target']
        directory = work / ('resources-' + target)
        ref = store.lookup('browser-resources', target, manifest['inputs'])
        result = store.fetch(ref, directory, roles=('runtime', 'metadata', 'build-support', 'legal'))
        browser_release.checkpoint_inventory(result, directory)
        browser.verify(directory, target, browser.fingerprint(target))
        verified.append({'component': 'browser-resources', 'target': target, 'manifestName': name,
                         'nativeOwnerVerification': 'passed', 'compiled': False})
    return verified


def verify(metadata, repo, work, *, native=False):
    verified = []
    restore = []
    for (owner, name), (raw, manifest) in sorted(metadata.items()):
        if owner != repo:
            continue
        result = store.lookup(manifest['component'], manifest['target'], manifest['inputs'])
        if not result or result['manifestSha256'] != hashlib.sha256(raw).hexdigest():
            raise ValueError('Permanent version lookup failed: ' + name)
        for dependency in manifest.get('dependencies', []):
            # Another architecture migration may still be copying its bytes.
            # Verify cross-owner dependencies in the final verification run.
            if dependency['repository'] == repo and store.manifest_url(dependency) is None:
                raise ValueError('Permanent dependency lookup failed')
        if manifest['component'] not in ('application', 'corresponding-source'):
            descriptor_raw = store.read_url(result['url'][:-5] + '.runtime.json')
            if descriptor_raw is None:
                raise ValueError('Runtime/license descriptor is missing')
            record = store.read_revision(repo, manifest['component'], manifest['target'], manifest['inputSha256'])
            if hashlib.sha256(descriptor_raw).hexdigest() != record.get('runtimeSha256'):
                raise ValueError('Runtime descriptor checksum differs from permanent lookup')
            descriptor = json.loads(descriptor_raw)
            store.runtime_owner().validate(descriptor)
            expected = [{key: asset[key] for key in ('name', 'role', 'size', 'sha256')}
                        for asset in manifest['assets'] if store.runtime_owner().effective_role(asset) != 'source']
            if descriptor['assets'] != expected:
                raise ValueError('Runtime descriptor includes sources or misses payloads/licenses')
            restore.append((descriptor['archive']['size'], result))
        verified.append({'manifestName': name, 'manifestSha256': result['manifestSha256'], 'tag': result['tag']})
    # Exercise the real public runtime restore, checksum verification and full
    # license extraction. This operational path has no compiler/build command.
    if restore:
        preferred = [item for item in restore if item[1]['manifest']['component'] in ('photon', 'runtime-guard')]
        _, representative = min(preferred or restore, key=lambda item: item[0])
        source_urls = {part['asset'] for _, manifest in metadata.values() for asset in manifest['assets']
                       if store.runtime_owner().effective_role(asset) == 'source' for part in asset['parts']}
        original_download = store.download
        downloads = []
        def runtime_download(url, *args):
            if url.rsplit('/', 1)[-1] in source_urls:
                raise ValueError('Runtime restore attempted to download corresponding sources')
            downloads.append(url)
            return original_download(url, *args)
        store.download = runtime_download
        native_verified = []
        try:
            result = store.fetch(representative, work / 'restored-runtime', roles=('runtime', 'legal', 'metadata', 'build-support'))
            if not (Path(result['directory']) / 'licenses/Taskarian/LICENSE').is_file():
                raise ValueError('Standalone component runtime lacks the Taskarian license')
            if native:
                native_verified = verify_native_checkpoints(metadata, repo, work)
        finally:
            store.download = original_download
    return {'repository': repo, 'compilation': 'unavailable in this workflow', 'canonicalManifests': verified,
            'runtimeRestore': representative['manifestName'] if restore else None, 'runtimeDownloads': downloads if restore else [],
            'nativeCheckpointRestores': native_verified if restore else []}


def repack_components(repo, work):
    """Adopt only a source-directory packaging change; never compile Go/JNI."""
    layout, native, android = (module(name) for name in ('runtime-layout', 'native-components', 'android-components'))
    import subprocess
    source = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=HERE.parents[1], text=True).strip()
    targets = [target for target in ('linux-amd64', 'linux-arm64', 'termux-aarch64', 'termux-x86_64')
               if store.repository(target) == repo]
    results = []
    for target in targets:
        selected = ['auth-authelia', 'auth-caddy', 'auth-chisel', 'auth-remote']
        if target.startswith('termux-'):
            selected.append('android-remote')
        selected.append('auth')  # Its dependency map now selects the clean leaves.
        for component in selected:
            wanted = android.inputs(component, target, source) if component == 'android-remote' else native.inputs(component, target, source)
            previous_inputs = layout.without_layout(wanted)
            if previous_inputs == wanted:
                raise ValueError('Runtime packaging input marker is missing: ' + component)
            original = store.lookup(component, target, previous_inputs)
            if original is None:
                raise ValueError('Exact native inputs changed beyond source staging; cannot adopt: ' + component)
            manifest = original['manifest']
            if manifest['inputs'] != previous_inputs:
                raise ValueError('Native input equivalence failed')
            ref = {key: original[key] for key in ('repository', 'manifestName', 'manifestSha256')}
            with tempfile.TemporaryDirectory(prefix='runtime-repack-', dir=work) as temporary:
                temporary = Path(temporary)
                existing = store.lookup(component, target, wanted)
                if existing is None:
                    store.fetch(original, temporary, roles=('runtime', 'legal', 'metadata', 'build-support'))
                    assets = {item['name']: item['role'] for item in manifest['assets']
                              if store.runtime_owner().effective_role(item) != 'source'}
                    proof = {'schema': 1, 'component': component, 'target': target,
                             'previous': ref, 'producerSource': manifest['sourceCommit'], 'packagingSource': source,
                             'previousInputs': previous_inputs, 'inputs': wanted,
                             'scope': 'Only source staging layout changed; original native CPU inputs are identical',
                             'nativeCompilation': False, 'sourceArchiveDownloaded': False}
                    file = temporary / 'runtime-input-equivalence.json'
                    file.write_bytes(store.canonical(proof) + b'\n'); assets[file.name] = 'metadata'
                    dependencies = [*manifest.get('dependencies', []), ref]
                    if component == 'auth':
                        for leaf in ('auth-authelia', 'auth-caddy', 'auth-chisel', 'auth-remote'):
                            dependency = store.lookup(leaf, target, native.inputs(leaf, target, source))
                            if dependency is None:
                                raise ValueError('Runtime leaf packaging must finish first')
                            dependencies.append({key: dependency[key] for key in ('repository', 'manifestName', 'manifestSha256')})
                    from source_archive import archive_revision
                    recipe = temporary / 'runtime-adoption-source.tar.gz'
                    archive_revision(HERE.parents[1], source, recipe, paths=['LICENSE', layout.RECIPE,
                        'agent/packaging/component-migrate.py', 'agent/packaging/native-component.py',
                        'agent/packaging/android-components.py', 'agent/packaging/component-store.py'])
                    assets[recipe.name] = 'source'
                    existing = store.publish(component, target, manifest['version'], wanted, temporary,
                        assets=assets, source_commit=manifest['sourceCommit'], producer=manifest['producer'],
                        dependencies=dependencies)
                else:
                    store.fetch(existing, temporary, roles=('runtime', 'legal', 'metadata', 'build-support'))
                # Exercise the owning ABI/ELF checks on the actual repacked bytes.
                if component == 'android-remote':
                    import tarfile
                    with tarfile.open(temporary / 'android-remote.tar.gz') as archive:
                        archive.extractall(temporary, filter='data')
                    android.verify_payload(component, target, temporary)
                else:
                    # The native owner checks its original runtime artifact
                    # inventory before separate legal/source assets are added.
                    with tempfile.TemporaryDirectory(prefix='runtime-abi-', dir=work) as check:
                        check = Path(check)
                        for item in existing['manifest']['assets']:
                            if item['role'] == 'runtime' or item['name'] == 'SHA256SUMS':
                                import shutil
                                shutil.copy2(temporary / item['name'], check / item['name'])
                        native.validate_outputs(component, target, check)
                results.append({'component': component, 'target': target, 'state': 'packaged-without-compilation',
                    **{key: existing[key] for key in ('repository', 'manifestName', 'manifestSha256', 'tag')}})
                print('Source-free runtime adopted: ' + component + '/' + target, flush=True)
    return {'repository': repo, 'nativeCompilation': False, 'sourceArchivesDownloaded': False,
            'runtimePackaging': results}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('migrate', 'repack', 'verify'))
    parser.add_argument('--directory', type=Path, required=True)
    parser.add_argument('--receipt', type=Path, required=True)
    args = parser.parse_args()
    repo = os.environ.get('GITHUB_REPOSITORY')
    if os.environ.get('GITHUB_ACTIONS') != 'true' or repo not in store.REPOSITORIES:
        raise ValueError('Use one of the four architecture builders')
    args.directory.mkdir(parents=True, exist_ok=True)
    if args.action == 'repack':
        result = repack_components(repo, args.directory)
        args.receipt.parent.mkdir(parents=True, exist_ok=True)
        args.receipt.write_text(json.dumps(result, indent=2) + '\n')
        print(json.dumps(result, indent=2))
        return
    releases, roots, metadata = inventory()
    if args.action == 'migrate':
        for (owner, name), (raw, manifest) in sorted(metadata.items()):
            if owner == repo:
                migrate_one(owner, name, raw, manifest, args.directory)
        cache = module('compiler-cache')
        for name in sorted(releases[repo]):
            if not name.startswith('compiler-cache-') or not name.endswith('.json'):
                continue
            raw = store.read_url(f'https://github.com/{repo}/releases/download/{store.TAG}/{name}')
            record = json.loads(raw)
            if not cache.migrate(record['engine'], record['target'], record['contract'], args.directory / 'cache'):
                raise ValueError('Exact compiler cache migration failed: ' + name)
    result = verify(metadata, repo, args.directory, native=args.action == 'verify')
    if args.action == 'verify':
        result['crossRepositoryDependencies'] = []
        for (owner, name), (_, manifest) in metadata.items():
            if owner == repo:
                for dependency in manifest.get('dependencies', []):
                    url = store.manifest_url(dependency)
                    if url is None:
                        raise ValueError('Permanent dependency lookup failed')
                    raw = store.read_url(url)
                    if raw is None or hashlib.sha256(raw).hexdigest() != dependency['manifestSha256']:
                        raise ValueError('Permanent dependency manifest checksum differs')
                    result['crossRepositoryDependencies'].append({**dependency, 'url': url})
    args.receipt.parent.mkdir(parents=True, exist_ok=True)
    args.receipt.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
