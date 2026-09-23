#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Size the supplied transparent PNG for browser, desktop and Android icons."""
import base64
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

root = Path(__file__).resolve().parents[1] / "browser/branding"
gecko = root.parents[2]
source = root / "assets/bashkitten-logo-glasses-original.png"
renderer = shutil.which("magick") or shutil.which("convert")
if not renderer:
    raise SystemExit("ImageMagick is required to render browser branding")


def render(path, size, canvas=None):
    path = root / path
    path.parent.mkdir(parents=True, exist_ok=True)
    command = [renderer, str(source), "-background", "none", "-alpha", "on",
               "-filter", "Lanczos", "-resize", f"{size}x{size}"]
    if canvas:
        command += ["-gravity", "center", "-extent", canvas]
    subprocess.run([*command, "-strip", str(path)], check=True)


for size in (16, 22, 24, 32, 48, 64, 128, 256, 512):
    render(f"default{size}.png", size)
for name, size in (("about-logo.png", 192), ("about-logo@2x.png", 384),
                   ("about-logo-private.png", 192), ("about-logo-private@2x.png", 384)):
    render(f"content/{name}", size)
render("content/about.png", 192, "300x236")
render("document.ico", 64)
# Existing Gecko chrome expects an SVG. Embed the sized PNG without tracing or
# repainting it; the untouched supplied image remains the preferred source.
encoded = base64.b64encode((root / "content/about-logo@2x.png").read_bytes()).decode()
svg = ('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
       'width="384" height="384" viewBox="0 0 384 384">'
       f'<image width="384" height="384" xlink:href="data:image/png;base64,{encoded}"/></svg>\n')
(root / "content/about-logo.svg").write_text(svg)

android = gecko / "mobile/android/fenix/app/src/main/res"
render(android / "drawable-nodpi/bashkitten_logo.png", 512)
# A 108dp adaptive layer is masked by the launcher. A centered 60dp image keeps
# this artwork inside its central 66dp safe circle, with transparent padding.
render(android / "drawable-nodpi/bashkitten_launcher_foreground.png", 240, "432x432")
for name, size in (("about", 192), ("favicon32", 32), ("favicon64", 64)):
    render(gecko / f"mobile/android/branding/bashkitten/content/{name}.png", size)
for relative in ("toolkit/components/satchel/megalist/content/icons/cpm-fox-illustration.svg",
                 "toolkit/themes/shared/illustrations/error-malformed-url.svg"):
    (gecko / relative).write_text(svg)
subprocess.run([renderer, str(root / "default256.png"), "-strip", "-define",
                "webp:lossless=true", str(gecko / "toolkit/components/ml/content/mozilla-logo.webp")], check=True)
render(gecko.parent / "agent/src/web/logo.png", 256)
render(gecko.parent / "agent/src/web/favicon.ico", 32)

# Keep the APK's existing artwork inventory in sync with these branded assets.
inventory_path = gecko / "bashkitten/android/ui-artwork.json"
inventory = json.loads(inventory_path.read_text())
for entry in inventory["engine_resources"].values():
    if entry["action"] in ("original brand-svg artwork", "original brand-webp artwork"):
        entry["sha256"] = hashlib.sha256((gecko / entry["source"]).read_bytes()).hexdigest()
inventory_path.write_text(json.dumps(inventory, indent=2) + "\n")
