# SPDX-License-Identifier: AGPL-3.0-only
"""Stage the fixed host and independently versioned, verified capture bundle."""
import hashlib
import json
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[3]
HOST = ROOT / "references/connector/host"
DIST = ROOT / "references/connector/dist"


def capture_files():
    hashes = json.loads((DIST / "runtime-sha256.json").read_text(encoding="utf-8"))
    capture = DIST / "references"
    files = {path.relative_to(capture).as_posix(): path for path in capture.rglob("*") if path.is_file()}
    if files.keys() != hashes.keys():
        raise ValueError("References capture inventory changed; rebuild the component")
    for name, path in files.items():
        if path.is_symlink() or hashlib.sha256(path.read_bytes()).hexdigest() != hashes[name]:
            raise ValueError("References capture checksum mismatch: " + name)
    manifest = json.loads(files["manifest.json"].read_text(encoding="utf-8"))
    if manifest.get("browser_specific_settings", {}).get("gecko", {}).get("id") != "references@bashkitten.org":
        raise ValueError("Invalid References capture identity")
    if manifest.get("experiment_apis") or any(p.startswith("nativeMessaging") for p in manifest.get("permissions", [])):
        raise ValueError("Capture must use the fixed References host")
    return files


def content(name, platform):
    value = (HOST / name).read_text(encoding="utf-8")
    if name == "manifest.json" and platform == "desktop":
        manifest = json.loads(value)
        manifest["permissions"] = []
        manifest["experiment_apis"] = {"bashkittenReferences": {
            "schema": "schema.json",
            "parent": {"scopes": ["addon_parent"], "script": "api.js",
                       "paths": [["bashkittenReferences"]]}}}
        value = json.dumps(manifest, indent=2) + "\n"
    return value


def main(output, name):
    files = capture_files()
    output.write(content(name, "desktop"))
    return {str(HOST / name), str(DIST / "runtime-sha256.json"), *(str(path) for path in files.values())}


if __name__ == "__main__":
    files = capture_files()
    assets = Path(sys.argv[1])
    target = assets / "references-host"
    target.mkdir(parents=True, exist_ok=True)
    for name in ("manifest.json", "background.js"):
        (target / name).write_text(content(name, "android"), encoding="utf-8")
    capture = assets / "references"
    if capture.exists():
        shutil.rmtree(capture)
    for name, source in files.items():
        destination = capture / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)
    # Keep final APK verification independent of generated component files in
    # the collector's checkout. This is the component's existing full inventory.
    shutil.copyfile(DIST / "runtime-sha256.json", assets / "references-runtime-sha256.json")
