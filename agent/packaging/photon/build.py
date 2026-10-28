#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Replace Photon's opaque npm WASM with its pinned native source build.

Cargo and wasm-bindgen own compilation and Node glue generation. This recipe
only stages their checksum-pinned original sources, verifies the public API and
retains the corresponding source identities and complete native notices.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import platform
import re
import runpy
import shutil
import subprocess
import sys
import tarfile
import tempfile
import time
import tomllib

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / 'agent/packaging'))
from source_cache import default_cache, fetch

GENERATED = ('photon_rs.js', 'photon_rs.d.ts', 'photon_rs_bg.wasm', 'photon_rs_bg.wasm.d.ts')
LEGAL = re.compile(r'^(licen[cs]e|copying|notice|copyright)([.\-_]|$)', re.I)


def sha(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def run(argv, *, cwd=None, env=None):
    subprocess.run([str(x) for x in argv], check=True, cwd=cwd, env=env)


def extract(archive, destination):
    destination.mkdir(parents=True, exist_ok=True)
    with tarfile.open(archive) as contents:
        contents.extractall(destination, filter='data')
    roots = list(destination.iterdir())
    require(len(roots) == 1 and roots[0].is_dir(), 'Unexpected native source archive root')
    return roots[0]


def vendor_crates(pins, destination):
    destination.mkdir(parents=True, exist_ok=True)
    for pin, archive in pins:
        with tempfile.TemporaryDirectory(dir=destination.parent, prefix='crate-') as temporary:
            crate = extract(archive, Path(temporary))
            pkg = tomllib.loads((crate / 'Cargo.toml').read_text())['package']
            identity = pkg['name'] + '-' + pkg['version']
            require(pin['url'].endswith('/' + identity + '.crate'), 'Crate identity differs from its archive')
            checksums = {p.relative_to(crate).as_posix(): sha(p)
                         for p in sorted(crate.rglob('*')) if p.is_file()}
            (crate / '.cargo-checksum.json').write_text(json.dumps({
                'files': checksums, 'package': pin['sha256']}, sort_keys=True) + '\n')
            shutil.move(crate, destination / identity)


def selected_notices(source, vendor, env):
    tree = subprocess.check_output(['cargo', 'tree', '--frozen', '--offline',
        '--target', 'wasm32-unknown-unknown', '--edges', 'normal,build',
        '--prefix', 'none', '--format', '{p}'], cwd=source, env=env, text=True)
    selected = {tuple(line.split()[:2]) for line in tree.splitlines()}
    records = []
    for manifest in [source / 'crate/Cargo.toml', *sorted(vendor.glob('*/Cargo.toml'))]:
        pkg = tomllib.loads(manifest.read_text())['package']
        identity = (pkg['name'], 'v' + pkg['version'])
        if identity not in selected:
            continue
        files = {p for p in manifest.parent.rglob('*') if p.is_file() and LEGAL.match(p.name)}
        if pkg.get('license-file'):
            files.add(manifest.parent / pkg['license-file'])
        if pkg['name'] == 'photon-rs':
            files.add(source / 'LICENSE.md')
        require(files, 'Missing full selected crate notices: ' + repr(identity))
        records.append({'name': pkg['name'], 'version': pkg['version'],
            'license': pkg.get('license', 'See included license text'),
            'source': pkg.get('repository'), 'text': '\n\n'.join(
                str(p.relative_to(manifest.parent) if p.is_relative_to(manifest.parent) else p.name)
                + '\n\n' + p.read_text(encoding='utf-8') for p in sorted(files))})
    require({(r['name'], 'v' + r['version']) for r in records} == selected,
            'Selected Photon Cargo closure lacks full native notices')
    # text.rs embeds this upstream font in the native WASM. Its full Apache
    # text and original copyright use a filename outside the crate notice glob.
    font = source / 'crate/fonts/Roboto-Regular.ttf'
    records.append({'name': 'Roboto Regular font embedded by Photon',
        'version': 'sha256:' + sha(font), 'license': 'Apache-2.0',
        'source': 'https://github.com/silvia-odwyer/photon/blob/685f5b155b36c5611c08ca678bb78ddbab3edbac/crate/fonts/Roboto-Regular.ttf',
        'text': (source / 'crate/fonts/Apache License.txt').read_text(encoding='utf-8')})
    return records


def verify_api(original, generated):
    # Exercise the same native image operations used by Pi, without downloading
    # fixtures or introducing a second image implementation.
    script = r'''
const assert = require('node:assert/strict');
const original = require(process.argv[1]), built = require(process.argv[2]);
const names = module => Object.keys(module).filter(key => !key.startsWith('__')).sort();
assert.deepEqual(names(built), names(original), 'Photon public module exports changed');
for (const name of names(original)) {
  const previous = original[name]?.prototype, current = built[name]?.prototype;
  if (previous) for (const key of Object.getOwnPropertyNames(previous))
    if (!key.startsWith('__')) assert(key in current, `Missing ${name}.${key}`);
}
const pixels = new Uint8Array([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]);
const exercise = module => {
  const image = new module.PhotonImage(pixels, 2, 2);
  const png = image.get_bytes(), jpeg = image.get_bytes_jpeg(80);
  const resized = module.resize(image, 1, 1, module.SamplingFilter.Lanczos3);
  const decoded = module.PhotonImage.new_from_byteslice(png);
  const result = { png: Array.from(png), jpeg: Array.from(jpeg),
    resized: Array.from(resized.get_raw_pixels()), width: resized.get_width(),
    height: resized.get_height(), decoded: Array.from(decoded.get_raw_pixels()) };
  decoded.free(); resized.free(); image.free();
  return result;
};
assert.deepEqual(exercise(built), exercise(original), 'Photon image encode/decode/resize changed');
console.log(JSON.stringify({publicExports: names(built), pngJpegDecodeResizeEqual: true}));
'''
    return json.loads(subprocess.check_output(['node', '-e', script,
        str(original), str(generated / 'photon_rs.js')], text=True))


def build(application, work=None):
    lock = json.loads((HERE / 'lock.json').read_text())
    require(lock['schema'] == 1, 'Unknown Photon source lock schema')
    require(sha(HERE / 'Cargo.lock') == lock['cargoLockSha256'], 'Photon Cargo.lock changed')
    source_pins = json.loads((ROOT / 'agent/licenses/source-archives.json').read_text())
    selected_pins = [lock['source'], lock['generator']['archive'], *lock['crates']]
    indexed = {(p['file'], p['url'], p['sha256']) for p in source_pins}
    require(all((p['file'], p['url'], p['sha256']) in indexed for p in selected_pins),
            'Photon original sources are absent from the corresponding-source inventory')
    package = application / lock['package']['location']
    metadata = json.loads((package / 'package.json').read_text())
    require(all(metadata[k] == lock['package'][k] for k in ('name', 'version')),
            'Installed Photon package differs from the source build lock')
    rust = json.loads((ROOT / lock['rustToolchain']).read_text())
    env = {**os.environ, 'RUSTUP_TOOLCHAIN': rust['version'], 'CARGO_NET_OFFLINE': 'true',
           'CARGO_INCREMENTAL': '0', 'SOURCE_DATE_EPOCH': '0'}
    compiler = subprocess.check_output(['rustc', '-vV'], text=True, env=env)
    require('release: ' + rust['version'] + '\n' in compiler and
            'commit-hash: ' + rust['commit'] + '\n' in compiler,
            'Photon requires the existing pinned Rust standard-library toolchain')
    identity = {'lock': sha(HERE / 'lock.json'), 'cargoLock': lock['cargoLockSha256'],
                'recipe': sha(Path(__file__)), 'rustSource': sha(ROOT / lock['rustToolchain']),
                'rustNoticeOwner': sha(ROOT / 'agent/packaging/machines/build.py'),
                'host': platform.machine(), 'compiler': compiler}
    key = hashlib.sha256(json.dumps(identity, sort_keys=True).encode()).hexdigest()
    work = Path(work or os.environ.get('BASHKITTEN_PHOTON_BUILD_CACHE',
                str(default_cache().parent / 'bashkitten-photon'))).resolve()
    require(not work.is_relative_to(ROOT), 'Photon build/cache must remain outside the checkout')
    work.mkdir(parents=True, exist_ok=True)
    cache = work / key
    generated = cache / 'generated'
    receipt_path = generated / 'BASHKITTEN-SOURCE.json'
    if receipt_path.is_file():
        receipt = json.loads(receipt_path.read_text())
        require(receipt['buildKey'] == key and all(sha(generated / name) == digest
                for name, digest in receipt['files'].items()), 'Cached Photon output checksum differs')
    else:
        # A failed compilation never becomes a reusable result.
        shutil.rmtree(cache, ignore_errors=True)
        cache.mkdir()
        started = time.monotonic()
        originals = [(pin, fetch(pin)) for pin in selected_pins]
        source = extract(originals[0][1], cache / 'upstream')
        tool = extract(originals[1][1], cache / 'generator')
        require(sha(tool / 'Cargo.lock') == lock['generator']['cargoLockSha256'],
                'Native wasm-bindgen generator lock differs')
        shutil.copy2(HERE / 'Cargo.lock', source / 'Cargo.lock')
        vendor = cache / 'vendor'
        vendor_crates(originals[2:], vendor)
        # Cargo's directory-source protocol verifies both each original package
        # checksum and every staged source file. Native locks select the graph.
        config = '[source.crates-io]\nreplace-with = "bashkitten-pinned"\n' \
                 + '[source.bashkitten-pinned]\ndirectory = ' + json.dumps(str(vendor)) + '\n'
        for folder in (source, tool):
            (folder / '.cargo').mkdir(exist_ok=True)
            (folder / '.cargo/config.toml').write_text(config)
        env['CARGO_TARGET_DIR'] = str(cache / 'target')
        env['RUSTFLAGS'] = '--remap-path-prefix=' + str(cache) + '=/bashkitten-photon'
        jobs = str(min(4, os.cpu_count() or 1))
        run(['cargo', 'build', '--frozen', '--offline', '--release', '--jobs', jobs,
             '--bin', 'wasm-bindgen'], cwd=tool, env=env)
        run(['cargo', 'build', '--frozen', '--offline', '--release', '--jobs', jobs,
             '--target', 'wasm32-unknown-unknown', '-p', 'photon-rs'], cwd=source, env=env)
        run([cache / 'target/release/wasm-bindgen', '--target', 'nodejs', '--out-dir', generated,
             '--out-name', 'photon_rs', cache / 'target/wasm32-unknown-unknown/release/photon_rs.wasm'], env=env)
        proof = verify_api(package, generated)
        notices = selected_notices(source, vendor, env)
        previous_toolchain = os.environ.get('RUSTUP_TOOLCHAIN')
        try:
            os.environ['RUSTUP_TOOLCHAIN'] = rust['version']
            owner = runpy.run_path(str(ROOT / 'agent/packaging/machines/build.py'))
            notices.append(owner['rust_toolchain_notices'](generated / 'rust-notices'))
        finally:
            if previous_toolchain is None:
                os.environ.pop('RUSTUP_TOOLCHAIN', None)
            else:
                os.environ['RUSTUP_TOOLCHAIN'] = previous_toolchain
        text = 'BashKitten source-built Photon native dependencies\n\n' + '\n\n'.join(
            r['name'] + ' ' + r['version'] + '\nSource: ' + str(r.get('source', ''))
            + '\nLicense: ' + r['license'] + '\n\n' + r['text'] for r in notices)
        (generated / 'BASHKITTEN-NOTICES.txt').write_text(text)
        receipt = {'schema': 1, 'buildKey': key, 'package': lock['package'],
            'modification': 'The npm prebuilt WASM and generated glue are replaced by a native Cargo/wasm-bindgen build of this exact source with the attached BashKitten Cargo.lock. This is not a reproduction of the historical npm binary.',
            'source': lock['source'], 'crateVersion': '0.3.3', 'toolchain': identity,
            'generator': lock['generator'], 'proof': proof,
            'selectedNativePackages': [{k: v for k, v in r.items() if k != 'text'} for r in notices],
            'seconds': round(time.monotonic() - started, 3),
            'files': {p.relative_to(generated).as_posix(): sha(p)
                      for p in sorted(generated.rglob('*')) if p.is_file()}}
        receipt_path.write_text(json.dumps(receipt, indent=2) + '\n')
    # Verify against the actual just-installed npm package even on cache hits.
    verify_api(package, generated)
    for name in GENERATED:
        shutil.copy2(generated / name, package / name)
    (package / 'photon_rs_bg.js').unlink(missing_ok=True)
    shutil.copy2(receipt_path, package / receipt_path.name)
    shutil.copy2(generated / 'BASHKITTEN-NOTICES.txt', package / 'BASHKITTEN-NOTICES.txt')
    shutil.copytree(generated / 'rust-notices', package / 'rust-notices', dirs_exist_ok=True)
    shutil.copy2(HERE / 'Cargo.lock', package / 'BASHKITTEN-Cargo.lock')
    shutil.copy2(HERE / 'lock.json', package / 'BASHKITTEN-source-lock.json')
    print('Installed source-built Photon:', receipt['files']['photon_rs_bg.wasm'],
          'native packages:', len(receipt['selectedNativePackages']), flush=True)
    return receipt


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('application', type=Path)
    parser.add_argument('--work', type=Path)
    args = parser.parse_args()
    build(args.application.resolve(), args.work)
