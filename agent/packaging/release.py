#!/usr/bin/env python3
"""Verify six matching applications and link their permanent corresponding sources.

This assembles files only. Prereleases enable APT testing; a successful compilation does not claim
that real device validation has occurred.
"""
import argparse
import errno
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import tarfile
import zipfile

ROOT = Path(__file__).resolve().parents[2]
CERT = '2f6a2ceae1a80e98b3a12156d37e7dc5541ce0968dd48285bc71bb555713df38'
TERMUX_UPDATE_ASSET = 'assets/termux-update.json'
TERMUX_BOOTSTRAP_ASSET = 'assets/updates-bootstrap.mjs'
TERMUX_PREPARER_ASSET = 'assets/updates-prepare.py'
TERMUX_OS_FILES = {'build': 'data/data/com.termux/files/usr/share/taskarian-os/build.json',
                   'installed': 'data/data/com.termux/files/usr/share/taskarian-os/installed-files.md5sums'}
# GitHub requires each release asset to be strictly smaller than 2 GiB.
ASSET_SIZE_LIMIT = 2 * 1024 ** 3


def validate_termux_update(value, version=None, abi=None):
    """Read old two-package APKs and the current single-parent package contract."""
    if not isinstance(value, dict) or value.get('schema') not in (1, 2):
        raise ValueError('Missing Android companion update manifest')
    architecture = value.get('architecture')
    expected_abi = {'aarch64': 'arm64-v8a', 'x86_64': 'x86_64'}.get(architecture)
    if not expected_abi or value.get('apkAbi') != expected_abi or (abi and abi != expected_abi):
        raise ValueError('Android companion update architecture mismatch')
    product_version = value.get('productVersion', '')
    if (not isinstance(product_version, str) or not re.fullmatch(r'\d+\.\d+(?:\.\d+)?', product_version)
            or (version and product_version != version)):
        raise ValueError('Android companion update version mismatch')
    revision = value.get('sourceCommit', '')
    if not isinstance(revision, str) or not re.fullmatch('[0-9a-f]{40}', revision):
        raise ValueError('Android companion update source revision is missing')
    def matches(pattern, text):
        return isinstance(text, str) and re.fullmatch(pattern, text)
    if not matches('[0-9a-f]{64}', value.get('bootstrapSha256')):
        raise ValueError('Android companion update bootstrap checksum is missing')
    packages = value.get('packages')
    if value['schema'] == 2 and not isinstance(value.get('components'), dict):
        raise ValueError('Android embedded component identities are missing')
    names = ('taskarian', 'taskarian-os') if value['schema'] == 1 else ('taskarian',)
    if not isinstance(packages, list) or len(packages) != len(names):
        raise ValueError('Android companion update must name the exact parent package')
    seen = set()
    for item in packages:
        if not isinstance(item, dict) or item.get('name') not in names or item['name'] in seen:
            raise ValueError('Invalid Android companion package expectation')
        name = item['name']; seen.add(name)
        if (item.get('architecture') != architecture or
                not matches(r'[0-9][0-9A-Za-z.+:~_-]*', item.get('version')) or
                not matches('[0-9a-f]{40}', item.get('sourceCommit')) or
                name == 'taskarian' and (item['version'] != product_version or item['sourceCommit'] != revision)):
            raise ValueError('Android companion package identity/version mismatch')
        if item.get('sha256') is not None and not matches('[0-9a-f]{64}', item['sha256']):
            raise ValueError('Android companion package checksum is invalid')
    os_component = (next(item for item in packages if item['name'] == 'taskarian-os')
                    if value['schema'] == 1 else (value.get('components') or {}).get('os'))
    if (not isinstance(os_component, dict) or os_component.get('architecture') != architecture or
            not matches(r'[0-9][0-9A-Za-z.+:~_-]*', os_component.get('version')) or
            not matches('[0-9a-f]{40}', os_component.get('sourceCommit')) or
            not matches('[0-9a-f]{64}', os_component.get('installedManifestSha256')) or
            value['schema'] == 1 and not matches('[0-9a-f]{64}', os_component.get('sha256'))):
        raise ValueError('Android embedded OS identity is missing or invalid')
    return value


def termux_os_identity(file, *, members=None):
    """Read the OS identity from a parent package or a legacy OS component."""
    names = TERMUX_OS_FILES
    if members is not None:
        if not all(members.get(key) for key in names):
            raise ValueError('Taskarian package is missing its embedded OS identity')
    elif Path(file).is_dir():
        members = {key: (Path(file) / name).read_bytes() for key, name in names.items() if (Path(file) / name).is_file()}
    else:
        members = {}
        with subprocess.Popen(['dpkg-deb', '--fsys-tarfile', str(file)], stdout=subprocess.PIPE) as process:
            with tarfile.open(fileobj=process.stdout, mode='r|') as archive:
                for item in archive:
                    for key, name in names.items():
                        if item.name.removeprefix('./') == name and item.isfile():
                            if key in members: raise ValueError('Duplicate embedded OS identity file')
                            members[key] = archive.extractfile(item).read()
            if process.wait() != 0 or not members.get('build'):
                raise ValueError('Termux package is missing its embedded OS producer stamp')
    embedded = 'installed' in members
    if not embedded:
        with subprocess.Popen(['dpkg-deb', '--ctrl-tarfile', str(file)], stdout=subprocess.PIPE) as process:
            with tarfile.open(fileobj=process.stdout, mode='r|') as archive:
                for item in archive:
                    if item.name.removeprefix('./') == 'md5sums' and item.isfile():
                        members['installed'] = archive.extractfile(item).read()
            if process.wait() != 0 or not members.get('installed'):
                raise ValueError('Termux OS component is missing its installed-file manifest')
    stamp = json.loads(members['build'])
    if (stamp.get('schemaVersion') != 1 or stamp.get('target') != 'termux'
            or stamp.get('architecture') not in ('aarch64', 'x86_64')
            or not re.fullmatch('[0-9a-f]{40}', stamp.get('sourceCommit', ''))
            or not isinstance(stamp.get('version'), str) or not stamp['version']):
        raise ValueError('Termux OS component has invalid producer identity')
    return {**stamp, 'embedded': embedded, 'installedManifestSha256': hashlib.sha256(members['installed']).hexdigest()}


def sha(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def asset_record(file, tag):
    return {'asset': file.name, 'sha256': sha(file), 'size': file.stat().st_size,
            'url': f'https://github.com/openresearchtools/Taskarian/releases/download/{tag}/{file.name}'}


def copy_asset(file, output, tag):
    if file.stat().st_size >= ASSET_SIZE_LIMIT:
        raise ValueError('Shipped installer exceeds the GitHub per-asset limit: ' + file.name)
    destination = output / file.name
    if destination.exists():
        if sha(destination) != sha(file):
            raise ValueError('Conflicting release asset: ' + file.name)
    else:
        # Candidate inputs are read-only during collection. Reuse their bytes
        # within this staging filesystem instead of doubling runner disk usage.
        try:
            os.link(file, destination)
        except OSError as error:
            if error.errno != errno.EXDEV:
                raise
            shutil.copy2(file, destination)
    return asset_record(destination, tag)


def source_guide(index, version):
    """Render complete source downloads without fetching any source payload."""
    revision = index['sourceCommit']
    roots = [item for item in index['components'] if item['component'] == 'corresponding-source']
    current = next(item for item in roots if item['sourceCommit'] == revision)
    baselines = [item for item in roots if item['sourceCommit'] != revision]
    selected = [*roots, *[item for item in index['components']
                         if item['component'] == 'application' and item['sourceCommit'] == revision]]
    archives = {}
    for component in selected:
        for asset in component['assets']:
            if asset['role'] != 'source':
                continue
            key = (asset['name'], asset['sha256'], asset['size'])
            if any(Path(asset['name']).name != asset['name'] or not part.get('url') for part in asset['parts']):
                raise ValueError('Source guide requires safe filenames and permanent download URLs')
            archives[key] = asset
    current_name = 'taskarian-source-' + revision[:12] + '.tar.gz'
    baseline_name = ('taskarian-source-' + baselines[0]['sourceCommit'][:12] + '.tar.gz') if baselines else None
    def order(asset):
        return (0 if asset['name'] == (baseline_name or current_name) else
                1 if asset['name'] == current_name else 2, asset['name'])
    ordered = sorted(archives.values(), key=order)
    lines = [f'# Taskarian {version} source downloads', '', f'Application source revision: `{revision}`.', '']
    if baselines:
        lines += ['## Complete baseline and repository update', '',
                  'The current repository archive is a Git binary patch bundle. It is **not a standalone full source snapshot**. '
                  'Download the complete baseline snapshot and the current patch bundle listed first below; together they reconstruct every tracked file for this release.', '',
                  'The baseline also retains its original dependency bundles. Updated external dependencies come from the exact component versions in the component table below.', '']
    else:
        lines += ['## Complete repository snapshot', '',
                  f'`{current_name}` is the complete Taskarian repository snapshot for this release, including every tracked file, '
                  'pristine vendored donor sources, licenses, patches and build recipes. It is not a patch bundle. '
                  'The other downloads retain the matching original external dependencies and Android native sources.', '']
    lines += [f'## Source downloads ({len(ordered)})', '',
              'Archive names and complete SHA-256 values are preserved. GitHub transport filenames may end in `.part`: '
              'save a single-part download under the original archive name shown here. For multiple parts, use the reconstruction commands below.', '',
              '| Original source archive | Download | Bytes | Complete archive SHA-256 |',
              '|---|---|---:|---|']
    for asset in ordered:
        links = ' · '.join(f'[Part {number}]({part["url"]})' for number, part in enumerate(asset['parts'], 1))
        if len(asset['parts']) == 1:
            links = f'[{asset["name"]}]({asset["parts"][0]["url"]})'
        lines.append(f'| `{asset["name"]}` | {links} | {asset["size"]:,} | `{asset["sha256"]}` |')
    lines += ['', '## Verify and reconstruct', '',
              'For a single-part download, its part is the complete original archive. Rename it as shown above and verify before extraction:', '',
              '```sh', 'sha256sum --check <<\'SHA256\'', '<complete SHA-256>  <original archive filename>', 'SHA256', '```', '',
              'For split downloads, the commands below fetch each part, verify every part, concatenate in its recorded order, '
              'and verify the complete archive. Individual parts cannot be extracted separately. Stop if a checksum fails.', '']
    for asset in ordered:
        if len(asset['parts']) == 1:
            continue
        lines += [f'### {asset["name"]}', '', '```sh']
        filenames, sums = [], []
        for number, part in enumerate(asset['parts'], 1):
            filename = asset['name'] + f'.part{number:04d}'
            filenames.append(filename)
            sums.append(part['sha256'] + '  ' + filename)
            lines.append('curl --fail --location --retry 3 ' + shlex.quote(part['url']) + ' --output ' + shlex.quote(filename))
        lines += ["sha256sum --check <<'SHA256'", *sums, 'SHA256',
                  'cat -- ' + ' '.join(map(shlex.quote, filenames)) + ' > ' + shlex.quote(asset['name']),
                  "sha256sum --check <<'SHA256'", asset['sha256'] + '  ' + asset['name'], 'SHA256', '```', '']
    if baselines:
        lines += ['## Apply the repository update', '',
                  'After verifying and reconstructing both archives, extract the complete baseline and the patch bundle separately. '
                  'Apply the patch from the baseline repository directory:', '', '```sh', 'mkdir -p baseline patch',
                  'tar -xf ' + shlex.quote(baseline_name) + ' -C baseline',
                  'tar -xf ' + shlex.quote(current_name) + ' -C patch', 'cd baseline/taskarian',
                  'git apply --binary ../../patch/taskarian-source/taskarian.patch', '```', '',
                  'The patch bundle also contains `source.json`, the full Taskarian license and a README with the exact baseline, '
                  'target revision and Git-tree verification metadata. Source archives for updated external components remain available below.', '']
    labels = {'gecko': 'Gecko engine', 'office-engine': 'LibreOffice core', 'office-server': 'Collabora server / document workers',
              'office-ui': 'Collabora Office web UI', 'references': 'References', 'auth-tor': 'Tor', 'auth-caddy': 'Caddy',
              'auth-authelia': 'Authelia', 'auth-valkey': 'Valkey', 'auth-chisel': 'Chisel',
              'auth-cloudflared': 'Cloudflare Tunnel', 'node': 'Node + npm',
              'npm-runtime': 'Pi and locked npm runtime', 'photon': 'Photon WASM', 'browser-resources': 'Taskarian browser UI / Android resources',
              'agent-resources': 'Taskarian agent backend and UI', 'files-server': 'Files Quantum backend', 'files-ui': 'Files Quantum web UI',
              'application': 'Taskarian app assembly', 'corresponding-source': 'Complete corresponding source'}
    platforms = {'linux-amd64': 'Linux AMD64', 'linux-arm64': 'Linux ARM64', 'android': 'Android ARM64',
                 'android-x86_64': 'Android x86_64', 'termux-aarch64': 'Termux aarch64', 'termux-x86_64': 'Termux x86_64'}
    groups = {}
    for component in index['components']:
        groups.setdefault((component['component'], component['version']), []).append(component)
    lines += ['## Individual component sources', '',
              'These links open the exact versioned component releases used by this application. They retain the component files, '
              'full license notices and matching source inventory. A component manifest also identifies its exact dependency releases. '
              f'The [machine-readable source and checksum index](https://github.com/openresearchtools/Taskarian/releases/download/v{version}/component-sources.json) records every archive and ordered part.', '',
              '<details>', f'<summary>Versioned component releases ({len(groups)} component/version groups)</summary>', '',
              '| Component | Version | Platform source releases |', '|---|---|---|']
    for (name, official_version), components in sorted(groups.items(), key=lambda pair: (labels.get(pair[0][0], pair[0][0]).casefold(), pair[0][1])):
        links = []
        for component in sorted(components, key=lambda item: (item['target'], item['inputSha256'])):
            url = component['manifest']['url'].rsplit('/', 1)[0].replace('/releases/download/', '/releases/tag/')
            label = platforms.get(component['target'], component['target'])
            if sum(item['target'] == component['target'] for item in components) > 1:
                label += ' build ' + component['inputSha256'][:8]
            links.append(f'[{label}]({url})')
        lines.append('| ' + labels.get(name, name.replace('-', ' ').title()) + ' | `' + official_version.replace('|', '\\|') + '` | ' + ' · '.join(links) + ' |')
    lines += ['', '</details>', '', 'Full Taskarian and applicable upstream license texts are also included in the shipped installers and runtime component archives.', '']
    return '\n'.join(lines)


def package(file, *, require_embedded=False):
    fields = dict(line.split(': ', 1) for line in subprocess.check_output(
        ['dpkg-deb', '-f', str(file), 'Package', 'Version', 'Architecture'], text=True).splitlines())
    termux = fields['Architecture'] in {'aarch64', 'x86_64'}
    prefix = Path('data/data/com.termux/files/usr' if termux else 'usr')
    # These are the existing application entrypoints in apps/locations.mjs.
    # Inspect archive modes: the builder can traverse its own 0700 staging
    # directories, which become inaccessible to ordinary users after root install.
    required = {str(prefix / 'lib/taskarian' / name): (False, 0o444) for name in (
        'files/provider.mjs', 'files/office-provider.mjs', 'references/index.mjs',
        'office/src/service.mjs', 'office/src/prepare.mjs')}
    if termux:
        required[str(prefix / 'bin/taskarian-x11')] = (False, 0o555)
    for name in tuple(required):
        parent = Path(name).parent
        while parent.is_relative_to(prefix):
            required[str(parent)] = (True, 0o111)
            parent = parent.parent
    modes = {}
    process = subprocess.Popen(['dpkg-deb', '--fsys-tarfile', str(file)], stdout=subprocess.PIPE)
    stamp, os_members = None, {}
    with tarfile.open(fileobj=process.stdout, mode='r|') as archive:
        for item in archive:
            name = item.name.removeprefix('./').rstrip('/')
            if name in required:
                modes[name] = item if name not in modes else None
            if item.name.endswith('/lib/taskarian/build-platform.json'):
                stamp = json.load(archive.extractfile(item))
            if termux and require_embedded:
                for key, expected in TERMUX_OS_FILES.items():
                    if name == expected and item.isfile():
                        if key in os_members:
                            raise ValueError('Duplicate embedded OS identity: ' + name)
                        os_members[key] = archive.extractfile(item).read()
    if process.wait() != 0 or not stamp:
        raise ValueError('Package has no valid build provenance: ' + str(file))
    for name, (directory, mask) in required.items():
        item = modes.get(name)
        if item is None or not (item.isdir() if directory else item.isfile()):
            raise ValueError('Package runtime path is missing, duplicated or has the wrong type: ' + name)
        if item.mode & mask != mask:
            raise ValueError(f'Package runtime path has inaccessible permissions: {name} ({item.mode & 0o777:04o})')
    if termux and require_embedded:
        identity = termux_os_identity(file, members=os_members)
        component = stamp.get('components', {}).get('os', {})
        if (not component.get('embedded') or
                any(identity[key] != component.get(key) for key in
                    ('version', 'architecture', 'sourceCommit', 'installedManifestSha256'))):
            raise ValueError('Parent package OS payload differs from its build identity')
    return fields, stamp


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('candidates', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--tag')
    parser.add_argument('--candidate-only', action='store_true')
    parser.add_argument('--verify-existing-source', help='Integrity-only verification of already built installers; never publish')
    parser.add_argument('--run', type=int, help='Successful complete-candidate workflow run')
    args = parser.parse_args()
    revision = args.verify_existing_source or subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
    if not re.fullmatch('[0-9a-f]{40}', revision) or args.verify_existing_source and not args.candidate_only:
        raise ValueError('Existing-source verification requires a full revision and --candidate-only')
    version = subprocess.check_output(['git', 'show', revision + ':browser/taskarian/config/version.txt'], cwd=ROOT, text=True).strip()
    engine = subprocess.check_output(['git', 'show', revision + ':browser/browser/config/version_display.txt'], cwd=ROOT, text=True).strip()
    if not re.fullmatch(r'\d+\.\d+(?:\.\d+)?', version):
        raise ValueError('Invalid Firefox-aligned product version')
    package_version = version
    expected_tag = 'v' + version
    tag = args.tag or expected_tag
    if tag != expected_tag:
        raise ValueError('Release tag must match the committed product version')
    if not args.candidate_only:
        if not args.run:
            parser.error('--run is required outside the candidate build')
        build = json.loads(subprocess.check_output(
            ['gh', 'api', f'repos/openresearchtools/Taskarian/actions/runs/{args.run}']))
        if build['conclusion'] != 'success' or build['head_sha'] != revision:
            raise ValueError('Use a successful complete candidate from this exact revision')
    args.output.mkdir(parents=True, exist_ok=True)
    if any(args.output.iterdir()):
        raise ValueError('Use an empty release directory')

    def copy(file):
        return copy_asset(file, args.output, tag)

    apks = sorted(args.candidates.rglob('*.apk'))
    if len(apks) != 2:
        raise ValueError('Exactly one ARM64 and one x86_64 production APK are required')
    sdk = Path(os.environ.get('ANDROID_HOME', '/usr/local/lib/android/sdk'))
    signers = sorted(sdk.glob('build-tools/*/apksigner'))
    if not signers:
        raise ValueError('Android apksigner is required to verify the final APKs')
    apps, abis, pairings = [], set(), []
    for apk in apks:
        manifest = json.loads((apk.parent / 'build-manifest.json').read_text())
        abi = manifest.get('architecture')
        if abi not in {'arm64-v8a', 'x86_64'} or abi in abis:
            raise ValueError('Duplicate or unexpected Android ABI')
        abis.add(abi)
        target = 'android-x86_64' if abi == 'x86_64' else 'android'
        if manifest.get('product_version') != version or manifest.get('firefox_version') != engine:
            raise ValueError('APK product, engine or source revision mismatch')
        if manifest.get('source') != revision:
            inputs = subprocess.check_output(
                ['python3', str(ROOT / 'agent/packaging/browser-component.py'), 'fingerprint', target], text=True).strip()
            if not re.fullmatch('[0-9a-f]{40}', manifest.get('source', '')) or manifest.get('browser_input_sha256') != inputs:
                raise ValueError('Cached APK inputs do not match this source')
        if manifest.get('package_id') != 'com.taskarian' or not manifest.get('publisher_signed'):
            raise ValueError('APK must be the signed Taskarian product')
        if manifest.get('apks', {}).get(apk.name) != sha(apk):
            raise ValueError('APK hash mismatch')
        with zipfile.ZipFile(apk) as archive:
            if any(archive.namelist().count(name) != 1 for name in (TERMUX_UPDATE_ASSET, TERMUX_BOOTSTRAP_ASSET, TERMUX_PREPARER_ASSET)):
                raise ValueError('APK must contain one immutable companion update manifest and bootstrap')
            pairing = validate_termux_update(json.loads(archive.read(TERMUX_UPDATE_ASSET)), version, abi)
            if not args.verify_existing_source and pairing['schema'] != 2:
                raise ValueError('New APKs must use the single-parent Termux package contract')
            if pairing.get('integrationIteration'):
                raise ValueError('A browser integration iteration APK is not a complete release candidate')
            if hashlib.sha256(archive.read(TERMUX_BOOTSTRAP_ASSET)).hexdigest() != pairing['bootstrapSha256']:
                raise ValueError('APK companion update bootstrap checksum mismatch')
            if archive.read(TERMUX_PREPARER_ASSET) != subprocess.check_output(['git', 'show', revision + ':agent/src/server/platform/termux/updates-prepare.py'], cwd=ROOT):
                raise ValueError('APK bundled-runtime preparation does not match this source')
            # Published source identities can be checked against the actual APK
            # without fetching any original source archive.
            spec = importlib.util.spec_from_file_location('android_source_identity', ROOT / 'agent/packaging/android_native_sources.py')
            native_sources = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(native_sources)
            read_source = lambda name: subprocess.check_output(['git', 'show', revision + ':' + name], cwd=ROOT)
            pins = json.loads(read_source('browser/taskarian/android/sources/sources.json'))
            components = native_sources.verify_correspondence(read_source,
                source_manifest=[{'component': item['component']} for item in pins['entries']], apk=archive)
            if manifest.get('native_source_components') != components:
                raise ValueError('APK library source provenance differs from its actual native libraries')
            spec = importlib.util.spec_from_file_location('android_remote_identity', ROOT / 'agent/packaging/android-components.py')
            android_components = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(android_components)
            remote = manifest['remote_client']
            remote_target = 'termux-x86_64' if abi == 'x86_64' else 'termux-aarch64'
            android_components.module('browser-component').ensure_source(remote['source'])
            if (remote.get('architecture') != abi or
                    hashlib.sha256(archive.read('lib/' + abi + '/libgojni.so')).hexdigest() != remote.get('library_sha256') or
                    android_components.binary_inputs('android-remote', remote_target, remote['source']) !=
                    android_components.binary_inputs('android-remote', remote_target, revision)):
                raise ValueError('APK remote client differs from its original compiled inputs/library')
        if pairing['sourceCommit'] != manifest['source']:
            raise ValueError('APK companion update manifest has a different producing source')
        pairings.append(pairing)
        signature = subprocess.check_output([str(signers[-1]), 'verify', '--print-certs', str(apk)], text=True)
        if 'certificate SHA-256 digest: ' + CERT not in signature:
            raise ValueError('APK did not use the existing Droid signing certificate')
        app = {**copy(apk), 'packageId': 'com.taskarian', 'versionName': version,
               'versionCode': manifest['version_code'], 'abi': abi,
               'certificateSha256': CERT, 'sourceCommit': manifest['source'],
               'buildRepository': manifest.get('build_repository', 'openresearchtools/Taskarian'),
               'buildRun': manifest.get('build_run') or args.run or os.environ.get('GITHUB_RUN_ID')}
        apps.append(app)
    packages = []
    auxiliary = []
    os_identities = {}
    auxiliary_keys = set()
    architectures = set()
    native_spec = importlib.util.spec_from_file_location('release_native_components', ROOT / 'agent/packaging/native-component.py')
    native = importlib.util.module_from_spec(native_spec)
    native_spec.loader.exec_module(native)
    for file in sorted(args.candidates.rglob('*.deb')):
        name = subprocess.check_output(['dpkg-deb', '-f', str(file), 'Package'], text=True).strip()
        if name != 'taskarian':
            if not args.verify_existing_source:
                raise ValueError('Only parent Taskarian packages may be shipped: ' + file.name)
            fields = dict(line.split(': ', 1) for line in subprocess.check_output(
                ['dpkg-deb', '-f', str(file), 'Package', 'Version', 'Architecture'], text=True).splitlines())
            architecture = fields['Architecture']
            if name not in {'taskarian-os', 'taskarian-machines-guest'} or architecture not in {'amd64', 'arm64', 'aarch64', 'x86_64'}:
                raise ValueError('Unexpected auxiliary package: ' + file.name)
            if not re.fullmatch(r'\d+\.\d+(?:\.\d+)?(?:-\d+)?', fields['Version']):
                raise ValueError('Auxiliary package version mismatch: ' + file.name)
            if name == 'taskarian-os' and architecture in {'aarch64', 'x86_64'}:
                identity = termux_os_identity(file)
                if identity['architecture'] != architecture or identity['version'] != fields['Version']:
                    raise ValueError('Termux OS installed identity differs from its package')
                os_identities[architecture] = identity
            metadata = json.loads(Path(str(file) + '.json').read_text())
            producer = metadata.get('sourceCommit', metadata.get('revision'))
            if producer != revision:
                component = 'os' if architecture in {'aarch64', 'x86_64'} else 'guest'
                target = ('termux-' if component == 'os' else 'linux-') + architecture
                native.verify_equivalence(file.parent, component, target, revision, producer)
            digest = metadata.get('sha256') or Path(str(file) + '.sha256').read_text().split()[0]
            if digest != sha(file) or (name, architecture) in auxiliary_keys:
                raise ValueError('Auxiliary checksum/identity mismatch: ' + file.name)
            auxiliary_keys.add((name, architecture))
            auxiliary.append({**fields, **copy(file), 'build': metadata})
            continue
        fields, stamp = package(file, require_embedded=not args.verify_existing_source or
                                any(item['schema'] == 2 for item in pairings))
        architecture = fields['Architecture']
        if fields['Package'] != 'taskarian' or fields['Version'] != package_version:
            raise ValueError('Unexpected package name/version: ' + file.name)
        if architecture in architectures or architecture not in {'amd64', 'arm64', 'aarch64', 'x86_64'}:
            raise ValueError('Duplicate or unexpected package architecture')
        if stamp.get('integrationIteration'):
            raise ValueError('A browser integration iteration is not a complete release candidate')
        if stamp.get('revision') != revision or stamp.get('architecture') != architecture:
            raise ValueError('Package build provenance mismatch')
        node = stamp.get('components', {}).get('node', {}).get('metadata', {})
        if node.get('architecture') != architecture or not node.get('node_version') or not node.get('npm_version'):
            raise ValueError('Package is missing its private Node/npm component')
        if architecture in {'aarch64', 'x86_64'}:
            if stamp.get('components', {}).get('os', {}).get('embedded'):
                os_identities[architecture] = stamp['components']['os']
            if stamp.get('components', {}).get('display', {}).get('developmentOnly'):
                raise ValueError('Local development APK pairing cannot be published')
            display = stamp.get('components', {}).get('display', {}).get('metadata', {})
            if display.get('signerSha256') != CERT or display.get('package') != 'com.taskarian':
                raise ValueError('Termux Display is not paired with these APKs')
            if display.get('sourceCommit') != revision:
                equivalence = stamp['components']['display'].get('inputEquivalence', {})
                target = 'termux-' + architecture
                if (equivalence.get('requestedSource') != revision or
                        equivalence.get('producerSource') != display.get('sourceCommit') or
                        equivalence.get('inputs') != native.inputs('loader', target, revision)):
                    raise ValueError('Termux Display source does not match the required package/signer/protocol')
        elif not all(name in stamp.get('components', {}) for name in ['machines', 'display']):
            raise ValueError('Desktop package is missing native environment components')
        architectures.add(architecture)
        packages.append({**fields, **copy(file), 'build': stamp})
    if architectures != {'amd64', 'arm64', 'aarch64', 'x86_64'}:
        raise ValueError('All four complete native packages are required')
    legacy_packages = any(item['schema'] == 1 for item in pairings)
    required_auxiliary = ({('taskarian-os', arch) for arch in architectures} |
                          {('taskarian-machines-guest', arch) for arch in ['amd64', 'arm64']}) if legacy_packages else set()
    if auxiliary_keys != required_auxiliary:
        raise ValueError('Release package inventory does not match its APK packaging contract')
    for pairing in pairings:
        for expected in pairing['packages']:
            matches = [item for item in packages + auxiliary if item['Package'] == expected['name']
                       and item['Architecture'] == expected['architecture']]
            if len(matches) != 1:
                raise ValueError('APK companion package is absent from this release')
            actual = matches[0]
            source = actual['build'].get('sourceCommit', actual['build'].get('revision'))
            identity = os_identities.get(expected['architecture']) if expected['name'] == 'taskarian-os' else None
            if identity:
                source = identity['sourceCommit']
            if (actual['Version'] != expected['version'] or source != expected['sourceCommit']
                    or ('sha256' in expected and actual['sha256'] != expected['sha256'])
                    or (identity and identity['installedManifestSha256'] != expected['installedManifestSha256'])):
                raise ValueError('APK companion pairing differs from the published package: '
                                 + expected['name'] + '/' + expected['architecture']
                                 + '; reassemble APK resources from the matching inputs')
        if pairing['schema'] == 2:
            expected = pairing['components']['os']
            actual = os_identities.get(pairing['architecture'], {})
            if not actual.get('embedded') or any(actual.get(key) != expected[key] for key in
                    ('version', 'architecture', 'sourceCommit', 'installedManifestSha256')):
                raise ValueError('APK OS pairing differs from its embedded parent package component')
    source_file = args.candidates / 'component-sources.json'
    source_index = json.loads(source_file.read_text())
    if source_index.get('schema') != 1 or source_index.get('sourceCommit') != revision:
        raise ValueError('Missing exact permanent component source/license index')
    components = source_index.get('components', [])
    if not any(item.get('component') == 'corresponding-source' and item.get('sourceCommit') == revision for item in components):
        raise ValueError('Repository corresponding sources are missing from the component index')
    archives = [{'archive': asset['name'], **asset} for item in components
                for asset in item['assets'] if asset['role'] == 'source']
    if not archives or not all(asset.get('parts') and re.fullmatch('[0-9a-f]{64}', asset.get('sha256', '')) for asset in archives):
        raise ValueError('Permanent source archives require checksums and downloadable parts')
    sources = [part for archive in archives for part in archive['parts']]
    source_manifest = copy(source_file)
    guide = source_guide(source_index, version)
    (args.output / 'SOURCES.md').write_text(guide)
    source_guide_asset = asset_record(args.output / 'SOURCES.md', tag)
    # Share the README's warning instead of allowing release notes to imply
    # that a candidate build has passed retail-device acceptance.
    readme = (ROOT / 'README.md').read_text()
    banner = next(line for line in readme.splitlines() if '](docs/testing-releases.svg)' in line)
    banner = banner.replace('(docs/testing-releases.svg)',
                            '(https://raw.githubusercontent.com/openresearchtools/Taskarian/main/docs/testing-releases.svg)')
    notes = (banner + '\n\n> [!WARNING]\n> **Testing release only. Not ready for production. Coming soon.**\n\n'
             f'Taskarian {version} · Firefox ESR {engine}.\n\n'
             '- **Android:** install the ARM64 or x86_64 APK matching your device, open Agent and follow the Termux setup command.\n'
             '- **Linux:** install the AMD64 or ARM64 `.deb`, which includes the browser and Agent server.\n'
             '- **Updating Android:** update both the APK and the Taskarian package in Termux. Provider logins and chat history are retained.\n\n'
             'Local Agent opens without an account login. Share Local offers independent Tor, Cloudflare Quick Tunnel, Tailcat instant and embedded Tailscale connections, using the same encrypted QR and Authelia two-factor flow.\n\n'
             'Remote file sharing starts off for each backend and connection. Tailscale sign-in opens in Taskarian on host and client; approved nodes are saved for later starts, including retries of unfinished Taskarian setup. After Cloudflare Off/On, update the encrypted connection image and import it again.\n\n'
             f'Checksums are attached. [Download the source guide](https://github.com/openresearchtools/Taskarian/releases/download/{tag}/SOURCES.md) for complete source archives, component releases and verification steps.\n')
    (args.output / 'release-notes.md').write_text(notes)
    # Full build inputs remain in each installer and its pinned component manifest.
    # Keep the main release index small instead of copying every dependency lock.
    published_packages = [{**item, 'build': {key: value for key, value in item['build'].items()
                          if key in ('schema', 'schemaVersion', 'platform', 'architecture', 'revision',
                                     'sourceCommit', 'version', 'productVersion')}} for item in packages + auxiliary]
    result = {'schema': 2, 'tag': tag, 'version': version, 'firefoxVersion': engine, 'testingRelease': True, 'packageVersion': package_version,
              'sourceCommit': revision, 'buildRun': args.run or os.environ.get('GITHUB_RUN_ID'),
              'apps': apps, 'packages': published_packages, 'sources': sources,
              'sourceManifest': source_manifest, 'sourceGuide': source_guide_asset, 'sourceArchives': archives}
    (args.output / 'release.json').write_text(json.dumps(result, indent=2) + '\n')
    (args.output / 'SHA256SUMS').write_text(''.join(
        sha(file) + '  ' + file.name + '\n' for file in sorted(args.output.iterdir()) if file.name != 'SHA256SUMS'))
    if any(file.stat().st_size >= ASSET_SIZE_LIMIT for file in args.output.iterdir()):
        raise ValueError('Release contains an asset exceeding the GitHub size limit')
    print('Verified two Android APKs, four native packages and permanent source/license links; no source payload downloaded.')


if __name__ == '__main__':
    main()
