#!/usr/bin/env python3
"""Build the private native Linux container engine from committed release sources.

The crun configure flow follows BuzzardOS packaging/build-crun.sh at
6c1b89f25c196ae7ab4a8f20e166b27e4ee94cc0 (AGPL-3.0-or-later).
All compilation happens outside the source checkout; no network resolution of
Go modules or Rust crates is permitted.
"""
# SPDX-License-Identifier: AGPL-3.0-only
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[3]
VENDOR = ROOT / 'agent/machines/vendor'
COMPONENTS = ('podman', 'crun', 'conmon', 'netavark', 'aardvark-dns',
              'passt', 'libfuse', 'fuse-overlayfs', 'catatonit')
BINARIES = ('podman', 'rootlessport', 'crun', 'conmon', 'netavark',
            'aardvark-dns', 'pasta', 'passt', 'pesto', 'fusermount3', 'fuse-overlayfs', 'catatonit')
PREFIX = '/usr/lib/bashkitten/machines'


def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def run(command, cwd=None, env=None, log=None):
    subprocess.run([str(x) for x in command], cwd=cwd, env=env, check=True,
                   stdout=log, stderr=subprocess.STDOUT if log else None)


def output(command, cwd=None):
    return subprocess.check_output(command, cwd=cwd, text=True).strip()


def verify_source(directory):
    record = json.loads((directory / 'source.json').read_text())
    require(re.fullmatch('[a-f0-9]{40}', record['commit']), 'Missing release commit')
    inventory = directory / 'SHA256SUMS'
    require(sha(inventory) == record['source_inventory_sha256'], 'Source inventory changed: ' + record['name'])
    for line in inventory.read_text().splitlines():
        expected, relative = line.split('  ', 1)
        path = directory / relative
        require(not Path(relative).is_absolute() and '..' not in Path(relative).parts,
                'Invalid source inventory path')
        actual = (hashlib.sha256(path.readlink().as_posix().encode()).hexdigest()
                  if path.is_symlink() else sha(path))
        require(actual == expected, 'Source checksum mismatch: ' + str(path))
    require(record['license_paths'], 'Missing source notices: ' + record['name'])
    for name in record['license_paths']:
        require((directory / name).is_file(), 'Missing license: ' + name)
    return record


def copy_executable(source, destination):
    require(source.is_file(), 'Missing built executable: ' + str(source))
    shutil.copy2(source.resolve(), destination)
    destination.chmod(0o755)


def license_records(record, source, rust_vendor=None):
    records = []
    for relative in record['license_paths']:
        path = VENDOR / record['name'] / relative
        records.append({'name': record['name'] + ' / ' + relative,
                        'version': record['version'], 'source': record['repository'],
                        'commit': record['commit'], 'license': 'See included license text',
                        'text': path.read_text(encoding='utf-8'), 'distribution': 'bundled'})
    if rust_vendor:
        # Resolve normal/build dependencies for this native target. Android,
        # Windows and upstream test-only crates are source inputs, not shipped
        # code in these Linux executables.
        import tomllib
        host = output(['rustc', '-vV']).split('host: ', 1)[1].splitlines()[0]
        tree = output(['cargo', 'tree', '--locked', '--offline', '--target', host,
                       '--edges', 'normal,build', '--prefix', 'none', '--format', '{p}'], source)
        selected = {tuple(line.split()[:2]) for line in tree.splitlines() if len(line.split()) >= 2}
        for manifest in sorted(rust_vendor.glob('*/Cargo.toml')):
            pkg = tomllib.loads(manifest.read_text())['package']
            if (pkg['name'], 'v' + pkg['version']) not in selected:
                continue
            files = [p for p in manifest.parent.rglob('*') if p.is_file() and
                     re.match(r'^(licen[cs]e|copying|notice|copyright)([.\-_]|$)', p.name, re.I)]
            extra = pkg.get('license-file')
            if extra and (manifest.parent / extra).is_file():
                files.append(manifest.parent / extra)
            if not files:
                supplements = ROOT / 'agent/machines/license-supplements'
                entries = json.loads((supplements / 'sources.json').read_text())['components']
                entry = next((x for x in entries if x['name'] == pkg['name'] and x['version'] == pkg['version']), None)
                require(entry, 'Missing pinned crate license supplement: ' + pkg['name'])
                for item in entry['files']:
                    path = supplements / item['path']
                    require(sha(path) == item['sha256'], 'Crate notice checksum mismatch: ' + pkg['name'])
                    files.append(path)
            require(files, 'Missing vendored crate license: ' + pkg['name'])
            records.append({'name': pkg['name'], 'version': pkg['version'],
                            'source': pkg.get('repository'), 'license': pkg.get('license', 'See included license text'),
                            'text': '\n\n'.join(p.read_text(encoding='utf-8') for p in sorted(set(files))),
                            'distribution': 'bundled'})
    return records


def build(args):
    architecture = {'x86_64': 'amd64', 'aarch64': 'arm64'}.get(platform.machine())
    require(platform.system() == 'Linux' and architecture == args.architecture,
            'Use the native Linux runner for the selected architecture')
    binaries = BINARIES + (('passt.avx2', 'pasta.avx2') if architecture == 'amd64' else ())
    for tool in ('go', 'cargo', 'rustc', 'make', 'cc', 'pkg-config', 'autoreconf',
                 'dpkg-shlibdeps', 'dpkg-buildflags', 'readelf', 'tar', 'gzip', 'meson', 'ninja', 'patch'):
        require(shutil.which(tool), 'Missing build dependency: ' + tool)
    work = args.work.resolve(); destination = args.output.resolve()
    require(not work.is_relative_to(ROOT) and not destination.is_relative_to(ROOT),
            'Build work/output must be outside the product checkout')
    work.mkdir(parents=True, exist_ok=True); destination.mkdir(parents=True, exist_ok=True)
    records = {name: verify_source(VENDOR / name) for name in COMPONENTS}
    toolchain = {name: output([name, '--version']).splitlines()[0] for name in ('cc', 'cargo', 'rustc')}
    toolchain['go'] = output(['go', 'version'])
    require(re.search(r'go1\.(2[6-9]|[3-9]\d)\.', toolchain['go']), 'Podman requires Go >=1.26')
    patch_root = ROOT / 'agent/machines/patches'
    patches = {str(path.relative_to(patch_root)): sha(path)
               for path in sorted(patch_root.glob('*/*.patch'))}
    key = hashlib.sha256(json.dumps({'sources': records, 'toolchain': toolchain, 'patches': patches,
        'architecture': architecture, 'licenseSupplements': sha(ROOT / 'agent/machines/license-supplements/sources.json'), 'recipe': sha(Path(__file__))}, sort_keys=True).encode()).hexdigest()
    cache = work / key; cache.mkdir(exist_ok=True)
    runtime = cache / 'machines'; (runtime / 'bin').mkdir(parents=True, exist_ok=True)
    epoch = output(['git', 'log', '-1', '--format=%ct'], ROOT)
    env = {**os.environ, 'GOTOOLCHAIN': 'local', 'GOPROXY': 'off', 'GOSUMDB': 'off',
           'GOTELEMETRY': 'off', 'GOFLAGS': '-mod=vendor -trimpath', 'CGO_ENABLED': '1',
           'CARGO_NET_OFFLINE': 'true', 'CARGO_INCREMENTAL': '0', 'SOURCE_DATE_EPOCH': epoch,
           'PI_TELEMETRY': '0', 'DO_NOT_TRACK': '1', 'OTEL_SDK_DISABLED': 'true',
           'OMP_WAIT_POLICY': 'ACTIVE', 'GOMP_SPINCOUNT': 'INFINITE'}
    env.setdefault('GOCACHE', str(work / 'go-cache'))
    env.setdefault('CARGO_TARGET_DIR', str(work / 'cargo-target' / architecture))
    jobs = str(args.jobs)
    licenses = []
    for name, record in records.items():
        source = cache / name
        if not source.exists():
            shutil.copytree(VENDOR / name / 'source', source, symlinks=True)
            try:
                for patch in sorted((patch_root / name).glob('*.patch')):
                    run(['patch', '--batch', '--forward', '-p1', '-i', patch], source)
            except Exception:
                shutil.rmtree(source)
                raise
        vendor = None
        if 'vendor' in record:
            archive = VENDOR / name / record['vendor']['file']
            require(sha(archive) == record['vendor']['sha256'], 'Vendor archive mismatch')
            if not (source / 'vendor').exists():
                with tarfile.open(archive) as archive_contents:
                    archive_contents.extractall(source, filter='data')
            vendor = source / 'vendor'
            (source / '.cargo').mkdir(exist_ok=True)
            (source / '.cargo/config.toml').write_text('[source.crates-io]\nreplace-with = "vendored-sources"\n'
                                                      '[source.vendored-sources]\ndirectory = "vendor"\n')
        licenses.extend(license_records(record, source, vendor))
        if (source / '.bashkitten-built').exists():
            print('Cached', name, record['version'], flush=True)
            continue
        print('Building', name, record['version'], flush=True)
        with (cache / (name + '.log')).open('w') as log:
            command = lambda argv: run(argv, source, env, log)
            if name == 'podman':
                ldflags = (f'-X go.podman.io/podman/v6/libpod/define.gitCommit={record["commit"]} '
                           f'-X go.podman.io/podman/v6/libpod/define.buildInfo={epoch} '
                           f'-X go.podman.io/podman/v6/libpod/config._installPrefix={PREFIX} '
                           f'-X go.podman.io/common/pkg/config.additionalHelperBinariesDir={PREFIX}/bin')
                tags = 'apparmor seccomp systemd containers_image_openpgp exclude_graphdriver_btrfs grpcnotrace'
                for binary in ('podman', 'rootlessport'):
                    command(['go', 'build', '-p', jobs, '-ldflags', ldflags, '-tags', tags,
                             '-o', runtime / 'bin' / binary, './cmd/' + binary])
                configs = runtime / 'config'; configs.mkdir(exist_ok=True)
                shutil.copy2(source / 'vendor/go.podman.io/common/pkg/seccomp/seccomp.json', configs / 'seccomp.json')
            elif name == 'crun':
                (source / '.tarball-version').write_text(record['version'] + '\n')
                (source / '.tarball-git-version.h').write_text('#define GIT_VERSION "' + record['commit'] + '"\n')
                command(['autoreconf', '-fi'])
                command(['./configure', '--prefix=' + PREFIX, '--disable-shared', '--disable-libcrun',
                         '--enable-embedded-blake3', '--enable-caps', '--enable-seccomp', '--enable-systemd', '--enable-bpf'])
                command(['make', '-j' + jobs]); copy_executable(source / 'crun', runtime / 'bin/crun')
            elif name == 'conmon':
                command(['make', '-j' + jobs, 'bin', 'bin/conmon', 'GIT_COMMIT=' + record['commit']])
                copy_executable(source / 'bin/conmon', runtime / 'bin/conmon')
            elif name in ('netavark', 'aardvark-dns'):
                command(['cargo', 'build', '--release', '--frozen', '--offline', '--jobs', jobs, '--bin', name])
                copy_executable(Path(env['CARGO_TARGET_DIR']) / 'release' / name, runtime / 'bin' / name)
            elif name == 'passt':
                passt_binaries = ('passt', 'pasta', 'pesto') + (('passt.avx2', 'pasta.avx2') if architecture == 'amd64' else ())
                command(['make', '-j' + jobs, *passt_binaries, 'VERSION=' + record['version']])
                for binary in passt_binaries:
                    copy_executable(source / binary, runtime / 'bin' / binary)
            elif name == 'libfuse':
                command(['meson', 'setup', 'build', '--prefix=' + PREFIX, '--libdir=lib',
                         '--buildtype=release', '-Dexamples=false', '-Dtests=false',
                         '-Duseroot=false', '-Dinitscriptdir=', '-Denable-io-uring=false'])
                command(['meson', 'compile', '-C', 'build', '-j', jobs])
                copy_executable(source / 'build/util/fusermount3', runtime / 'bin/fusermount3')
                libraries = runtime / 'lib'; libraries.mkdir(exist_ok=True)
                for library in (source / 'build/lib').glob('libfuse3.so*'):
                    if not library.is_file(): continue
                    target = libraries / library.name
                    if target.exists() or target.is_symlink(): target.unlink()
                    if library.is_symlink(): target.symlink_to(library.readlink())
                    else: shutil.copy2(library, target)
                config = runtime / 'etc'; config.mkdir(exist_ok=True)
                shutil.copy2(source / 'util/fuse.conf', config / 'fuse.conf')
            elif name == 'fuse-overlayfs':
                fuse = cache / 'libfuse'
                command(['autoreconf', '-fi'])
                fuse_env = {**env, 'FUSE_CFLAGS': f'-I{fuse}/include -I{fuse}/build',
                            'FUSE_LIBS': f'-L{fuse}/build/lib -lfuse3 -lpthread'}
                run(['./configure', '--prefix=' + PREFIX], source, fuse_env, log)
                run(['make', '-j' + jobs, "LDFLAGS=-Wl,-rpath,'$$ORIGIN/../lib'"], source, fuse_env, log)
                copy_executable(source / name, runtime / 'bin' / name)
            else:
                command(['autoreconf', '-fi'])
                command(['./configure', '--prefix=' + PREFIX])
                command(['make', '-j' + jobs])
                copy_executable(source / name, runtime / 'bin' / name)
        (source / '.bashkitten-built').touch()
    for binary in binaries:
        require(os.access(runtime / 'bin' / binary, os.X_OK), 'Missing runtime executable: ' + binary)
    dependency_work = cache / 'dependencies'; (dependency_work / 'debian').mkdir(parents=True, exist_ok=True)
    (dependency_work / 'debian/control').write_text('Source: bashkitten\nSection: utils\nPriority: optional\n'
        'Maintainer: Open Research Tools <openresearchtools@gmail.com>\n\nPackage: bashkitten\n'
        'Architecture: any\nDescription: private container engine\n')
    (dependency_work / 'debian/shlibs.local').write_text('libfuse3 4 bashkitten-private-fuse\n')
    dependency_text = output(['dpkg-shlibdeps', '-O', '-l' + str(runtime / 'lib'), *('-e' + str(runtime / 'bin' / b) for b in binaries),
                              '-e' + str(runtime / 'lib/libfuse3.so.4')], dependency_work)
    depends = [item for item in dependency_text.removeprefix('shlibs:Depends=').split(', ')
               if item != 'bashkitten-private-fuse'] + ['uidmap', 'iptables', 'systemd', 'dbus-user-session', 'pipewire-bin', 'gstreamer1.0-tools', 'gstreamer1.0-pipewire', 'gstreamer1.0-pulseaudio', 'gstreamer1.0-plugins-base', 'gstreamer1.0-plugins-good', 'gstreamer1.0-plugins-bad']
    licenses.append({'name': 'BashKitten machine runtime adaptation notices',
                     'license': 'See individual component licenses',
                     'text': (ROOT / 'agent/machines/NOTICE').read_text()})
    (runtime / 'licenses.json').write_text(json.dumps(licenses, indent=2) + '\n')
    provenance = runtime / 'sources'; provenance.mkdir(exist_ok=True)
    for name in COMPONENTS:
        shutil.copy2(VENDOR / name / 'source.json', provenance / (name + '.json'))
    shutil.copytree(patch_root, provenance / 'patches', dirs_exist_ok=True)
    shutil.copy2(ROOT / 'agent/machines/NOTICE', provenance / 'BASHKITTEN-NOTICE')
    manifest = {'schema': 1, 'platform': 'linux', 'architecture': architecture,
                'buildKey': key, 'sourceCommit': output(['git', 'rev-parse', 'HEAD'], ROOT),
                'toolchain': toolchain, 'components': list(records.values()), 'patches': patches, 'depends': depends,
                'executables': {b: sha(runtime / 'bin' / b) for b in binaries},
                'libraries': {p.name: sha(p) for p in sorted((runtime / 'lib').iterdir())},
                'recipeSha256': sha(Path(__file__)), 'sourceDateEpoch': int(epoch)}
    (runtime / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    archive = destination / f'machines-runtime-linux-{architecture}.tar.gz'
    with archive.open('wb') as stream:
        pack = subprocess.Popen(['tar', '--sort=name', '--mtime=@' + epoch, '--owner=0', '--group=0',
                                 '--numeric-owner', '-C', str(cache), '-cf', '-', 'machines'], stdout=subprocess.PIPE)
        gzip = subprocess.run(['gzip', '-n', '-9'], stdin=pack.stdout, stdout=stream)
        pack.stdout.close()
        require(gzip.returncode == 0 and pack.wait() == 0, 'Runtime archive failed')
    (destination / 'SHA256SUMS').write_text(sha(archive) + '  ' + archive.name + '\n')
    print(archive)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--architecture', choices=['amd64', 'arm64'], required=True)
    parser.add_argument('--work', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--jobs', type=int, default=min(8, os.cpu_count() or 1))
    args = parser.parse_args()
    try:
        require(args.jobs > 0, 'jobs must be positive')
        build(args)
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        parser.exit(1, 'Machine runtime build failed: ' + str(error) + '\n')
