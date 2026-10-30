#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Assemble locked private Python payloads and their corresponding source."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import runpy
import shutil
import subprocess
import tarfile
import tomllib
import sys
import zipfile

ROOT = Path(__file__).resolve().parents[1]
SHARED_CACHE = ROOT.parent / 'packaging/source_cache.py'
if not SHARED_CACHE.is_file():
    SHARED_CACHE = Path(__file__).resolve().with_name('source_cache.py')
sys.path.insert(0, str(SHARED_CACHE.parent))
from source_cache import fetch as fetch_source

LOCK = ROOT / "runtime-lock.json"
LICENSE = re.compile(r"^(licen[cs]es?|copying|copyright|notices?|authors|ofl)(?:[._-].*)?$", re.I)
LICENSE_REFERENCE = re.compile(rb"(?:\.{1,2}/)+\S+")


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def fetch(record: dict, cache: Path) -> Path:
    path = cache / record["filename"]
    inventory = ROOT / 'vendor/sources/sources.json'
    local = path if path.is_file() else ROOT / 'archives' / record['filename']
    if inventory.exists():
        retained = json.loads(inventory.read_text())
        if digest(LOCK) != retained['lockSha256']:
            raise RuntimeError('Retained search sources do not match runtime lock')
        pin = next((item for item in retained['components'] if item['filename'] == record['filename']), None)
        if pin:
            if pin['sha256'] != record['sha256']:
                raise RuntimeError('Retained search source mismatch: ' + record['filename'])
            if (inventory.parent / pin['file']).is_file():
                local = inventory.parent / pin['file']
    source = fetch_source(record, local=local)
    if path.is_file():
        if digest(path) != record['sha256']:
            raise RuntimeError('Prepared search source mismatch: ' + record['filename'])
    else:
        shutil.copy2(source, path)
    return path


def notices(path: Path) -> list[tuple[str, bytes]]:
    found = []
    if path.suffix == ".txt":
        return [(path.name, path.read_bytes())]
    if zipfile.is_zipfile(path):
        with zipfile.ZipFile(path) as archive:
            for entry in archive.infolist():
                if not entry.is_dir() and LICENSE.match(PurePosixPath(entry.filename).name):
                    found.append((entry.filename, archive.read(entry)))
    else:
        with tarfile.open(path) as archive:
            for entry in archive:
                if entry.isfile() and LICENSE.match(PurePosixPath(entry.name).name):
                    found.append((entry.name, archive.extractfile(entry).read()))
    return found


def full_notice_present(contents: list[bytes]) -> bool:
    # Attribution/reference files stay in the payload, but cannot by themselves
    # satisfy full-text delivery (notably siphasher's dual-license COPYING).
    for content in contents:
        text = content.decode('utf-8', errors='replace').strip()
        if not text or LICENSE_REFERENCE.fullmatch(content.strip()):
            continue
        if re.fullmatch(r'https?://\S+', text) or re.match(r'^(404[: ]|Not Found\b)', text, re.I):
            continue
        if len(text) < 1000 and re.search(r'licensed under', text, re.I) and not re.search(
                r'permission is hereby|redistribution and use|provided [\"“]as.is', text, re.I):
            continue
        return True
    return False


def unpack_wheel(path: Path, site: Path, metadata_only: bool = False) -> None:
    with zipfile.ZipFile(path) as archive:
        for entry in archive.infolist():
            relative = PurePosixPath(entry.filename)
            if relative.is_absolute() or ".." in relative.parts:
                raise RuntimeError(f"unsafe wheel entry: {relative}")
            if entry.is_dir() or any(p in {"tests", "test", "__pycache__"} for p in relative.parts):
                continue
            if metadata_only and not relative.parts[0].endswith(".dist-info"):
                continue
            # These runtime wheels do not need wheel .data installation schemes.
            if relative.parts[0].endswith(".data"):
                raise RuntimeError(f"unsupported wheel data entry: {relative}")
            output = site / relative
            output.parent.mkdir(parents=True, exist_ok=True)
            output.write_bytes(archive.read(entry))
            output.chmod(0o644)


def archive(directory: Path, output: Path) -> None:
    subprocess.run(["tar", "--sort=name", "--owner=0", "--group=0", "--numeric-owner",
                    "--zstd", "-cf", str(output), "-C", str(directory), "."], check=True)


def build(target: str, output: Path, termux_native: Path | None) -> None:
    lock = json.loads(LOCK.read_text())
    output.mkdir(parents=True, exist_ok=True)
    cache = output / "downloads"
    cache.mkdir(exist_ok=True)
    stage = output / f"stage-{target}"
    stage.mkdir(exist_ok=False)
    runtime = stage / "search/runtime"
    site = runtime / "site-packages"
    site.mkdir(parents=True)
    source = output / f"source-{target}"
    source.mkdir(exist_ok=False)
    source_archives = source / "archives"
    source_archives.mkdir()
    shutil.copy(LOCK, source / LOCK.name)
    shutil.copytree(ROOT / "build", source / "build")
    shutil.copy2(SHARED_CACHE, source / "build/source_cache.py")
    inventory = ROOT / "vendor/sources/sources.json"
    if inventory.is_file():
        (source / "vendor/sources").mkdir(parents=True)
        shutil.copy2(inventory, source / "vendor/sources/sources.json")
    for name in ("src", "third_party"):
        shutil.copytree(ROOT / name, source / name, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    for name in ("LICENSE", "THIRD_PARTY_NOTICES.md", "README.md", "pyproject.toml", "bashkitten-search"):
        shutil.copy(ROOT / name, source / name)
    for path in ROOT.glob("requirements-*.txt"):
        shutil.copy(path, source / path.name)
    termux = target in {"termux-aarch64", "termux-x86_64"}
    if termux:
        if not termux_native:
            raise RuntimeError("Termux requires the native recipe artifact")
        library = termux_native / "primp.abi3.so"
        if not library.is_file():
            raise RuntimeError(f"native primp library missing: {library}")
        shutil.copy(library, site / library.name)
        recipes = ROOT.parent / "packaging/termux/search"
        if not recipes.is_dir():
            recipes = ROOT / "termux-recipes"
        shutil.copytree(recipes, source / "termux-recipes")
    entries, texts = [], []

    def add_licenses(name: str, version: str, paths: list[Path], scope: str = "bundled") -> None:
        unique = {}
        for path in paths:
            for filename, content in notices(path):
                # Some crates package a relative LICENSE reference as plain text.
                # Keep that pristine source, but require a full pinned supplement.
                if LICENSE_REFERENCE.fullmatch(content.strip()):
                    continue
                unique.setdefault(hashlib.sha256(content).hexdigest(), (filename, content))
        if not full_notice_present([content for _, content in unique.values()]):
            raise RuntimeError(f"missing full license texts for {name} {version}")
        files = []
        for checksum, (filename, content) in sorted(unique.items()):
            relative = f"licenses/{name}/{checksum[:12]}-{PurePosixPath(filename).name}"
            destination = runtime / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(content)
            files.append(relative)
            texts.append(f"\n{'=' * 72}\n{name} {version} · {filename}\n{'=' * 72}\n".encode() + content)
        entries.append({"name": name, "version": version, "scope": scope, "licenseFiles": files})

    distributions = []
    for package in lock["packages"]:
        name, version = package["name"], package["version"]
        if termux and name in {"lxml", "pymupdf"}:
            continue  # Native bindings are dependencies, not bundled Linux libraries.
        src = fetch(package["source"], cache)
        shutil.copy(src, source_archives / src.name)
        if name == "lxml":
            wheels = []
            for python, record in package["pythonWheels"][target].items():
                wheel = fetch(record, cache)
                unpack_wheel(wheel, runtime / f"python{python}/site-packages")
                wheels.append(wheel)
        else:
            wheel = fetch(package["wheels"].get(target, package["wheels"]["linux-amd64"]), cache)
            unpack_wheel(wheel, site, metadata_only=termux and name == "primp")
            wheels = [wheel]
        add_licenses(name, version, [src, *wheels])
        distributions.append({"name": name, "version": version, "scope": "bundled", "source": package["source"]})

    # Keep every locked Rust dependency's source/license, including native C
    # bundled by those crates. Cargo validates the same archive checksums.
    primp = next(p for p in lock["packages"] if p["name"] == "primp")
    with tarfile.open(cache / primp["source"]["filename"]) as source_tar:
        member = next(m for m in source_tar if m.name.endswith("/Cargo.lock"))
        cargo = tomllib.loads(source_tar.extractfile(member).read().decode())
    crates = []
    for crate in cargo["package"]:
        if "source" not in crate:
            continue
        if not crate["source"].startswith("registry+") or not crate.get("checksum"):
            raise RuntimeError(f"unrecorded Cargo source: {crate['name']}")
        name, version = crate["name"], crate["version"]
        crates.append({"name": name, "version": version, "filename": f"{name}-{version}.crate",
                       "url": f"https://static.crates.io/crates/{name}/{name}-{version}.crate",
                       "sha256": crate["checksum"]})
    with ThreadPoolExecutor(max_workers=8) as pool:
        files = list(pool.map(lambda item: fetch(item, cache), crates))
    for crate, path in zip(crates, files):
        shutil.copy(path, source_archives / path.name)
        license_paths = [path]
        for record in lock.get("cargoLicenseSources", {}).get(f"{crate['name']}@{crate['version']}", []):
            license_path = fetch(record, cache)
            shutil.copy(license_path, source_archives / license_path.name)
            license_paths.append(license_path)
        add_licenses(f"rust-{crate['name']}", crate["version"], license_paths, "primp-build-source")
    (source / "cargo-sources.json").write_text(json.dumps(crates, indent=2) + "\n")
    if not termux:
        for extra in lock["extraSources"]:
            src = fetch(extra, cache)
            shutil.copy(src, source_archives / src.name)
            add_licenses(extra["name"], extra["version"], [src])
    # Cargo excludes its precompiled standard library. Use the existing native
    # Rust notice owner with the compiler recorded in the actual selected ELF,
    # including when a Linux wheel was built by a different upstream compiler.
    native = site / ("primp.abi3.so" if termux else "primp/primp.abi3.so")
    comment = subprocess.check_output(["readelf", "-p", ".comment", str(native)], text=True)
    compilers = set(re.findall(r"rustc version (\d+\.\d+\.\d+) \(([a-f0-9]{9,40}) ", comment))
    if len(compilers) != 1:
        raise RuntimeError("Native primp lacks one recorded Rust compiler identity")
    version, commit = compilers.pop()
    if version != lock["rustRuntimeVersions"][target]:
        raise RuntimeError("Native primp compiler differs from its retained Rust runtime source")
    compiler = {"release": version, "commit-hash": commit}
    retained = ROOT / "vendor/rust-toolchains" / version
    pin = json.loads((retained / "sources.json").read_text())
    helper = ROOT.parent / "packaging/machines/build.py"
    if not helper.is_file():
        helper = ROOT / "agent/packaging/machines/build.py"
    shared = runpy.run_path(str(helper))
    rust = shared["rust_toolchain_notices"](runtime / "licenses/rust-toolchain", retained, compiler)
    relative = "licenses/rust-toolchain/LICENSE-Rust.txt"
    entries.append({"name": rust["name"], "version": rust["version"], "scope": "bundled",
                    "license": rust["license"], "source": rust["source"],
                    "licenseFiles": [relative]})
    texts.append(f"\n{'=' * 72}\n{rust['name']} {version} · {relative}\n{'=' * 72}\n".encode()
                 + (runtime / relative).read_bytes())
    original = fetch_source(pin, local=retained / pin["file"])
    shutil.copy2(original, source_archives / pin["file"])
    shutil.copytree(retained, source / "vendor/rust-toolchains" / version)
    # Keep this independently rebuildable source artifact using the same native
    # helper and its existing import, without a second legal collector.
    for origin, relative in [(helper, "agent/packaging/machines/build.py"),
                             (helper.parents[3] / "auth/build/go-notices.py", "auth/build/go-notices.py"),
                             (SHARED_CACHE, "agent/packaging/source_cache.py")]:
        destination = source / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(origin, destination)
    dependencies = (["python3 (>= 3.12)", "python3 (<< 3.15)", "libc6 (>= 2.28)", "libstdc++6", "git"]
                    if not termux else ["python (>= 3.14)", "python (<< 3.15)", "openssl", "python-lxml (>= 6.1.3)",
                                        "python-pymupdf (>= 1.28.0-1)", "python-mupdf", "mupdf (>= 1.28.2-1)", "git"])
    if termux:
        distributions.extend([{"name": "lxml", "version": "6.1.3", "scope": "system", "package": "python-lxml"},
                              {"name": "pymupdf", "version": "1.28.0", "scope": "system", "package": "python-pymupdf"}])
    recorded = ROOT / "manifest.json"
    if recorded.is_file():
        # Published source bundles are deliberately independent of a Git clone.
        source_commit = json.loads(recorded.read_text())["sourceCommit"]
    else:
        source_commit = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()
    manifest = {"format": 1, "target": target, "platform": target, "python": lock["python"][target],
                "pythonVersions": lock["pythonVersions"][target],
                "version": "1.0.0", "ddgs": "9.16.1", "depends": dependencies, "aptDependencies": dependencies,
                "packages": [{"name": item["name"], "version": item["version"]} for item in distributions],
                "dependencies": {item["name"]: item["version"] for item in distributions},
                "distributions": distributions, "lockSha256": digest(LOCK), "licenses": "licenses.json",
                "rustRuntime": {"version": version, "commit": pin["commit"], "observedCompiler": compiler,
                                "source": {key: pin[key] for key in ("url", "sha256", "file", "size")}},
                "sourceCommit": source_commit}
    (runtime / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (runtime / "licenses.json").write_text(json.dumps({"format": 1, "components": entries}, indent=2) + "\n")
    (runtime / "LICENSES.txt").write_bytes(b"\n".join(texts))
    for name in ("LICENSE", "THIRD_PARTY_NOTICES.md"):
        shutil.copy(ROOT / name, runtime / name)
    shutil.copytree(ROOT / "third_party", runtime / "third_party")
    shutil.copy(runtime / "manifest.json", source / "manifest.json")
    archive(stage, output / f"search-runtime-{target}.tar.zst")
    archive(source, output / f"search-source-{target}.tar.zst")
    artifacts = sorted(output.glob(f"search-*-{target}.tar.zst"))
    (output / "SHA256SUMS").write_text("".join(f"{digest(path)}  {path.name}\n" for path in artifacts))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", choices=["linux-amd64", "linux-arm64", "termux-aarch64", "termux-x86_64"])
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--termux-native", type=Path)
    args = parser.parse_args()
    build(args.target, args.output.resolve(), args.termux_native)
