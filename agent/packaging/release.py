#!/usr/bin/env python3
"""Collect the six matching build candidates and their corresponding sources.

This assembles files only. Prereleases enable APT testing; a successful compilation does not claim
that real device validation has occurred.
"""
import argparse
import hashlib
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
# GitHub requires each release asset to be strictly smaller than 2 GiB.
ASSET_SIZE_LIMIT = 2 * 1024 ** 3
SOURCE_PART_SIZE = 1024 ** 3


def validate_termux_update(value, version=None, abi=None):
    """Validate immutable APK expectations, without inventing package provenance."""
    if not isinstance(value, dict) or value.get('schema') != 1:
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
    bootstrap = value.get('bootstrapSha256')
    if not isinstance(bootstrap, str) or not re.fullmatch('[0-9a-f]{64}', bootstrap):
        raise ValueError('Android companion update bootstrap checksum is missing')
    packages = value.get('packages')
    if not isinstance(packages, list) or len(packages) != 2:
        raise ValueError('Android companion update must name both owned packages')
    names = set()
    for item in packages:
        if not isinstance(item, dict):
            raise ValueError('Invalid Android companion package expectation')
        name = item.get('name')
        expected_version = {'bashkitten': product_version, 'bashkitten-os': product_version + '-1'}.get(name)
        if not expected_version or name in names or item.get('version') != expected_version or item.get('architecture') != architecture:
            raise ValueError('Android companion package identity/version mismatch')
        names.add(name)
        source = item.get('sourceCommit', '')
        if not isinstance(source, str) or not re.fullmatch('[0-9a-f]{40}', source):
            raise ValueError('Android companion package source revision is missing')
        if name == 'bashkitten' and source != revision:
            raise ValueError('Android companion backend source revision mismatch')
        digest = item.get('sha256')
        if (name == 'bashkitten-os' or digest is not None) and (not isinstance(digest, str) or not re.fullmatch('[0-9a-f]{64}', digest)):
            raise ValueError('Android companion package checksum is missing or invalid')
        if name == 'bashkitten-os' and (not isinstance(item.get('installedManifestSha256'), str)
                or not re.fullmatch('[0-9a-f]{64}', item['installedManifestSha256'])):
            raise ValueError('Android companion installed OS manifest checksum is missing')
    return value


def termux_os_identity(file):
    """Read producer identity and installed-file manifest from the actual .deb."""
    members = {}
    for mode, name in [('--fsys-tarfile', 'data/data/com.termux/files/usr/share/bashkitten-os/build.json'),
                       ('--ctrl-tarfile', 'md5sums')]:
        with subprocess.Popen(['dpkg-deb', mode, str(file)], stdout=subprocess.PIPE) as process:
            with tarfile.open(fileobj=process.stdout, mode='r|') as archive:
                for item in archive:
                    if item.name.removeprefix('./') == name and item.isfile():
                        if name in members:
                            raise ValueError('Duplicate Termux OS identity file')
                        members[name] = archive.extractfile(item).read()
            if process.wait() != 0 or name not in members or not members[name]:
                raise ValueError('Termux OS package is missing its producer stamp or installed-file manifest')
    stamp = json.loads(members['data/data/com.termux/files/usr/share/bashkitten-os/build.json'])
    if (stamp.get('schemaVersion') != 1 or stamp.get('target') != 'termux'
            or stamp.get('architecture') not in ('aarch64', 'x86_64')
            or not re.fullmatch('[0-9a-f]{40}', stamp.get('sourceCommit', ''))
            or not isinstance(stamp.get('version'), str) or not stamp['version']):
        raise ValueError('Termux OS package has invalid producer identity')
    return {**stamp, 'installedManifestSha256': hashlib.sha256(members['md5sums']).hexdigest()}


def sha(file):
    with file.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def asset_record(file, tag):
    return {'asset': file.name, 'sha256': sha(file), 'size': file.stat().st_size,
            'url': f'https://github.com/openresearchtools/bashkitten/releases/download/{tag}/{file.name}'}


def copy_asset(file, output, tag):
    if file.stat().st_size >= ASSET_SIZE_LIMIT:
        raise ValueError('Release asset exceeds the GitHub limit; only source archives may be split: ' + file.name)
    destination = output / file.name
    if destination.exists():
        if sha(destination) != sha(file):
            raise ValueError('Conflicting release asset: ' + file.name)
    else:
        shutil.copy2(file, destination)
    return asset_record(destination, tag)


def source_archive(file, output, tag):
    """Retain exact source bytes, splitting only archives too large for GitHub."""
    size = file.stat().st_size
    if size < ASSET_SIZE_LIMIT:
        asset = copy_asset(file, output, tag)
        return {'archive': file.name, 'sha256': asset['sha256'], 'size': size, 'parts': [asset]}
    digest, parts = hashlib.sha256(), []
    with file.open('rb') as source:
        for index, offset in enumerate(range(0, size, SOURCE_PART_SIZE), 1):
            part = output / f'{file.name}.part{index:04d}'
            remaining = min(SOURCE_PART_SIZE, size - offset)
            with part.open('xb') as target:
                while remaining:
                    block = source.read(min(8 * 1024 ** 2, remaining))
                    if not block:
                        raise ValueError('Source archive changed during collection: ' + file.name)
                    target.write(block)
                    digest.update(block)
                    remaining -= len(block)
            parts.append(asset_record(part, tag))
        if source.read(1):
            raise ValueError('Source archive changed during collection: ' + file.name)
    original = {'archive': file.name, 'sha256': digest.hexdigest(), 'size': size, 'parts': parts}
    (output / (file.name + '.parts.sha256')).write_text(''.join(
        part['sha256'] + '  ' + part['asset'] + '\n' for part in parts))
    (output / (file.name + '.sha256')).write_text(original['sha256'] + '  ' + file.name + '\n')
    return original


def source_instructions(archives, output, tag):
    split = [archive for archive in archives if len(archive['parts']) > 1]
    if not split:
        return
    text = ('# Corresponding source archives\n\n'
            'Large source archives are attached as ordered binary parts to fit GitHub\'s per-asset limit. '
            'No source, license or notice was removed, and the archive bytes were not recompressed. '
            '`release.json` records each original archive name, byte count, SHA-256 and ordered parts '
            'under `sourceArchives`; `sources` lists the actual downloadable assets.\n\n'
            'Run the commands below in a new directory with GitHub CLI and coreutils installed. '
            'Each block downloads one archive and its checksum files, verifies its parts, concatenates '
            'them in the recorded order, and verifies the original archive before extraction. '
            'Stop if any command fails. Allow space for both the downloaded parts and the reconstructed '
            'archive. Individual parts are not independently extractable.\n\n'
            'For a complete release download, `sha256sum --check SHA256SUMS` verifies all attached '
            'files, including these instructions, the manifest and checksum files.\n')
    for archive in split:
        name = archive['archive']
        parts = ' '.join(shlex.quote(part['asset']) for part in archive['parts'])
        text += (f'\n## {name}\n\nOriginal: {archive["size"]} bytes, SHA-256 `{archive["sha256"]}`.\n\n'
                 f'```sh\ngh release download {shlex.quote(tag)} --repo openresearchtools/BashKitten '
                 f'--pattern {shlex.quote(name + ".*")} &&\n'
                 f'sha256sum --check {shlex.quote(name + ".parts.sha256")} &&\n'
                 f'cat {parts} > {shlex.quote(name)} &&\n'
                 f'sha256sum --check {shlex.quote(name + ".sha256")}\n```\n')
    (output / 'SOURCE-ARCHIVES.md').write_text(text)


def package(file):
    fields = dict(line.split(': ', 1) for line in subprocess.check_output(
        ['dpkg-deb', '-f', str(file), 'Package', 'Version', 'Architecture'], text=True).splitlines())
    process = subprocess.Popen(['dpkg-deb', '--fsys-tarfile', str(file)], stdout=subprocess.PIPE)
    stamp = None
    with tarfile.open(fileobj=process.stdout, mode='r|') as archive:
        for item in archive:
            if item.name.endswith('/lib/bashkitten/build-platform.json'):
                stamp = json.load(archive.extractfile(item))
    if process.wait() != 0 or not stamp:
        raise ValueError('Package has no valid build provenance: ' + str(file))
    return fields, stamp


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('candidates', type=Path)
    parser.add_argument('output', type=Path)
    parser.add_argument('--tag')
    parser.add_argument('--candidate-only', action='store_true')
    parser.add_argument('--run', type=int, help='Successful complete-candidate workflow run')
    args = parser.parse_args()
    version = (ROOT / 'browser/bashkitten/config/version.txt').read_text().strip()
    engine = (ROOT / 'browser/browser/config/version_display.txt').read_text().strip()
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
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
            ['gh', 'api', f'repos/openresearchtools/bashkitten/actions/runs/{args.run}']))
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
        if manifest.get('package_id') != 'com.bashkitten' or not manifest.get('publisher_signed'):
            raise ValueError('APK must be the signed BashKitten product')
        if manifest.get('apks', {}).get(apk.name) != sha(apk):
            raise ValueError('APK hash mismatch')
        with zipfile.ZipFile(apk) as archive:
            if any(archive.namelist().count(name) != 1 for name in (TERMUX_UPDATE_ASSET, TERMUX_BOOTSTRAP_ASSET)):
                raise ValueError('APK must contain one immutable companion update manifest and bootstrap')
            pairing = validate_termux_update(json.loads(archive.read(TERMUX_UPDATE_ASSET)), version, abi)
            if hashlib.sha256(archive.read(TERMUX_BOOTSTRAP_ASSET)).hexdigest() != pairing['bootstrapSha256']:
                raise ValueError('APK companion update bootstrap checksum mismatch')
        if pairing['sourceCommit'] != manifest['source']:
            raise ValueError('APK companion update manifest has a different producing source')
        pairings.append(pairing)
        signature = subprocess.check_output([str(signers[-1]), 'verify', '--print-certs', str(apk)], text=True)
        if 'certificate SHA-256 digest: ' + CERT not in signature:
            raise ValueError('APK did not use the existing Droid signing certificate')
        app = {**copy(apk), 'packageId': 'com.bashkitten', 'versionName': version,
               'versionCode': manifest['version_code'], 'abi': abi,
               'certificateSha256': CERT, 'sourceCommit': manifest['source'],
               'buildRepository': manifest.get('build_repository', 'openresearchtools/bashkitten'),
               'buildRun': manifest.get('build_run') or args.run or os.environ.get('GITHUB_RUN_ID')}
        apps.append(app)
    packages = []
    auxiliary = []
    os_identities = {}
    auxiliary_keys = set()
    architectures = set()
    for file in sorted(args.candidates.rglob('*.deb')):
        name = subprocess.check_output(['dpkg-deb', '-f', str(file), 'Package'], text=True).strip()
        if name != 'bashkitten':
            fields = dict(line.split(': ', 1) for line in subprocess.check_output(
                ['dpkg-deb', '-f', str(file), 'Package', 'Version', 'Architecture'], text=True).splitlines())
            architecture = fields['Architecture']
            if name not in {'bashkitten-os', 'bashkitten-machines-guest'} or architecture not in {'amd64', 'arm64', 'aarch64', 'x86_64'}:
                raise ValueError('Unexpected auxiliary package: ' + file.name)
            expected = version + '-1' if architecture in {'aarch64', 'x86_64'} else version
            if fields['Version'] != expected:
                raise ValueError('Auxiliary package version mismatch: ' + file.name)
            if name == 'bashkitten-os' and architecture in {'aarch64', 'x86_64'}:
                identity = termux_os_identity(file)
                if identity['architecture'] != architecture or identity['version'] != fields['Version']:
                    raise ValueError('Termux OS installed identity differs from its package')
                os_identities[architecture] = identity
            metadata = json.loads(Path(str(file) + '.json').read_text())
            if metadata.get('sourceCommit', metadata.get('revision')) != revision:
                raise ValueError('Auxiliary source revision mismatch: ' + file.name)
            digest = metadata.get('sha256') or Path(str(file) + '.sha256').read_text().split()[0]
            if digest != sha(file) or (name, architecture) in auxiliary_keys:
                raise ValueError('Auxiliary checksum/identity mismatch: ' + file.name)
            auxiliary_keys.add((name, architecture))
            auxiliary.append({**fields, **copy(file), 'build': metadata})
            continue
        fields, stamp = package(file)
        architecture = fields['Architecture']
        if fields['Package'] != 'bashkitten' or fields['Version'] != package_version:
            raise ValueError('Unexpected package name/version: ' + file.name)
        if architecture in architectures or architecture not in {'amd64', 'arm64', 'aarch64', 'x86_64'}:
            raise ValueError('Duplicate or unexpected package architecture')
        if stamp.get('revision') != revision or stamp.get('architecture') != architecture:
            raise ValueError('Package build provenance mismatch')
        node = stamp.get('components', {}).get('node', {}).get('metadata', {})
        if node.get('architecture') != architecture or not node.get('node_version') or not node.get('npm_version'):
            raise ValueError('Package is missing its private Node/npm component')
        if architecture in {'aarch64', 'x86_64'}:
            if stamp.get('components', {}).get('display', {}).get('developmentOnly'):
                raise ValueError('Local development APK pairing cannot be published')
            display = stamp.get('components', {}).get('display', {}).get('metadata', {})
            if display.get('signerSha256') != CERT or display.get('package') != 'com.bashkitten' or display.get('sourceCommit') != revision:
                raise ValueError('Termux Display is not paired with these APKs')
        elif not all(name in stamp.get('components', {}) for name in ['machines', 'display']):
            raise ValueError('Desktop package is missing native environment components')
        architectures.add(architecture)
        packages.append({**fields, **copy(file), 'build': stamp})
    if architectures != {'amd64', 'arm64', 'aarch64', 'x86_64'}:
        raise ValueError('All four complete native packages are required')
    required_auxiliary = {('bashkitten-os', arch) for arch in architectures} | {('bashkitten-machines-guest', arch) for arch in ['amd64', 'arm64']}
    if auxiliary_keys != required_auxiliary:
        raise ValueError('All architecture-matched desktop customization and guest packages are required')
    for pairing in pairings:
        for expected in pairing['packages']:
            matches = [item for item in packages + auxiliary if item['Package'] == expected['name']
                       and item['Architecture'] == expected['architecture']]
            if len(matches) != 1:
                raise ValueError('APK companion package is absent from this release')
            actual = matches[0]
            source = actual['build'].get('sourceCommit', actual['build'].get('revision'))
            identity = os_identities.get(expected['architecture']) if expected['name'] == 'bashkitten-os' else None
            if identity:
                source = identity['sourceCommit']
            if (actual['Version'] != expected['version'] or source != expected['sourceCommit']
                    or ('sha256' in expected and actual['sha256'] != expected['sha256'])
                    or (identity and identity['installedManifestSha256'] != expected['installedManifestSha256'])):
                raise ValueError('APK companion pairing differs from the published package: '
                                 + expected['name'] + '/' + expected['architecture']
                                 + '; reassemble APK resources from the matching inputs')
    archives = {}
    for file in sorted(args.candidates.rglob('*')):
        if file.is_file() and re.search(r'(?:source|sources|provenance)[^.]*\.(?:tar(?:\.(?:gz|xz|zst))?|zip|jar)$', file.name):
            if file.name in archives:
                if archives[file.name]['sha256'] != sha(file):
                    raise ValueError('Conflicting release source: ' + file.name)
            else:
                archives[file.name] = source_archive(file, args.output, tag)
    names = list(archives)
    for token in ('bashkitten-source-', 'dependency-source-', 'auth', 'search', 'node-source-', 'blocker', 'android-library-source'):
        if not any(token in name for name in names):
            raise ValueError('Missing corresponding source bundle: ' + token)
    source_instructions(archives.values(), args.output, tag)
    sources = [part for archive in archives.values() for part in archive['parts']]
    # Share the README's warning instead of allowing release notes to imply
    # that a candidate build has passed retail-device acceptance.
    readme = (ROOT / 'README.md').read_text()
    banner = next(line for line in readme.splitlines() if '](docs/testing-releases.svg)' in line)
    banner = banner.replace('(docs/testing-releases.svg)',
                            '(https://raw.githubusercontent.com/openresearchtools/BashKitten/main/docs/testing-releases.svg)')
    notes = (banner + '\n\n> [!WARNING]\n> **Testing release only. Not ready for production. Coming soon.**\n\n'
             f'BashKitten {version} · Firefox ESR {engine}.\n\n'
             '- **Android:** install the ARM64 or x86_64 APK matching your device, open Agent and follow the Termux setup command.\n'
             '- **Linux:** install the AMD64 or ARM64 `.deb`, which includes the browser and Agent server.\n'
             '- **Updating Android:** update both the APK and the BashKitten package in Termux. Provider logins and chat history are retained.\n\n'
             'Local Agent opens without an account login. Publishing from Linux and connecting to remotes still require Tor authorization and account two-factor authentication.\n\n'
             'Checksums and corresponding source archives are attached.\n')
    if (args.output / 'SOURCE-ARCHIVES.md').exists():
        notes += ('Large source archives use lossless numbered parts. Download `SOURCE-ARCHIVES.md` '
                  'for verification and reconstruction commands; `release.json` records original archive hashes and part order.\n')
    (args.output / 'release-notes.md').write_text(notes)
    result = {'schema': 2, 'tag': tag, 'version': version, 'firefoxVersion': engine, 'testingRelease': True, 'packageVersion': package_version,
              'sourceCommit': revision, 'buildRun': args.run or os.environ.get('GITHUB_RUN_ID'),
              'apps': apps, 'packages': packages + auxiliary, 'sources': sources,
              'sourceArchives': list(archives.values())}
    (args.output / 'release.json').write_text(json.dumps(result, indent=2) + '\n')
    (args.output / 'SHA256SUMS').write_text(''.join(
        sha(file) + '  ' + file.name + '\n' for file in sorted(args.output.iterdir()) if file.name != 'SHA256SUMS'))
    if any(file.stat().st_size >= ASSET_SIZE_LIMIT for file in args.output.iterdir()):
        raise ValueError('Release contains an asset exceeding the GitHub size limit')
    print('Assembled two Android APKs, four complete native packages and matching sources; not published.')


if __name__ == '__main__':
    main()
