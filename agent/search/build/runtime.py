#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Assemble locked private Python payloads and their corresponding source."""
from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tarfile
import tomllib
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
LOCK = ROOT / "runtime-lock.json"
LICENSE = re.compile(r"^(licen[cs]es?|copying|copyright|notices?|authors|ofl)(?:[._-].*)?$", re.I)


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def fetch(record: dict, cache: Path) -> Path:
    path = cache / record["filename"]
    if path.exists() and digest(path) == record["sha256"]:
        return path
    partial = path.with_suffix(path.suffix + ".part")
    request = urllib.request.Request(record["url"], headers={"User-Agent": "BashKitten-build/1"})
    with urllib.request.urlopen(request, timeout=180) as source, partial.open("wb") as out:
        shutil.copyfileobj(source, out)
    if digest(partial) != record["sha256"]:
        raise RuntimeError(f"source hash mismatch: {record['filename']}")
    partial.replace(path)
    return path


def notices(path: Path) -> list[tuple[str, bytes]]:
    found = []
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
    for name in ("src", "third_party"):
        shutil.copytree(ROOT / name, source / name, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    for name in ("LICENSE", "THIRD_PARTY_NOTICES.md", "pyproject.toml", "bashkitten-search"):
        shutil.copy(ROOT / name, source / name)
    termux = target == "termux-aarch64"
    if termux:
        if not termux_native:
            raise RuntimeError("Termux requires the native recipe artifact")
        library = termux_native / "primp.abi3.so"
        if not library.is_file():
            raise RuntimeError(f"native primp library missing: {library}")
        shutil.copy(library, site / library.name)
        shutil.copytree(ROOT.parent / "packaging/termux/search", source / "termux-recipes")
    entries, texts = [], []

    def add_licenses(name: str, version: str, paths: list[Path], scope: str = "bundled") -> None:
        unique = {}
        for path in paths:
            for filename, content in notices(path):
                unique.setdefault(hashlib.sha256(content).hexdigest(), (filename, content))
        if not unique:
            raise RuntimeError(f"missing license texts for {name} {version}")
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
        add_licenses(f"rust-{crate['name']}", crate["version"], [path], "primp-build-source")
    (source / "cargo-sources.json").write_text(json.dumps(crates, indent=2) + "\n")
    if not termux:
        for extra in lock["extraSources"]:
            src = fetch(extra, cache)
            shutil.copy(src, source_archives / src.name)
            add_licenses(extra["name"], extra["version"], [src])
    dependencies = (["python3 (>= 3.12)", "python3 (<< 3.15)", "libc6 (>= 2.28)", "libstdc++6", "git"]
                    if not termux else ["python (>= 3.14)", "python (<< 3.15)", "openssl", "python-lxml (>= 6.1.3)",
                                        "python-pymupdf (>= 1.28.0-1)", "python-mupdf", "mupdf (>= 1.28.2-1)", "git"])
    if termux:
        distributions.extend([{"name": "lxml", "version": "6.1.3", "scope": "system", "package": "python-lxml"},
                              {"name": "pymupdf", "version": "1.28.0", "scope": "system", "package": "python-pymupdf"}])
    manifest = {"format": 1, "target": target, "platform": target, "python": lock["python"][target],
                "pythonVersions": lock["pythonVersions"][target],
                "version": "1.0.0", "ddgs": "9.16.0", "depends": dependencies, "aptDependencies": dependencies,
                "packages": [{"name": item["name"], "version": item["version"]} for item in distributions],
                "dependencies": {item["name"]: item["version"] for item in distributions},
                "distributions": distributions, "lockSha256": digest(LOCK), "licenses": "licenses.json",
                "sourceCommit": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()}
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
    parser.add_argument("target", choices=["linux-amd64", "linux-arm64", "termux-aarch64"])
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--termux-native", type=Path)
    args = parser.parse_args()
    build(args.target, args.output.resolve(), args.termux_native)
