#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-only
"""Render the existing BashKitten vector icon for Gecko's native icon sizes."""
from pathlib import Path
import shutil
import subprocess

root = Path(__file__).resolve().parents[1] / "browser/branding"
source = root / "assets/bashkitten.svg"
renderer = shutil.which("magick") or shutil.which("convert")
if not renderer:
    raise SystemExit("ImageMagick is required to render browser branding")


def render(path, size, canvas=None):
    command = [renderer, "-background", "none", str(source), "-resize", f"{size}x{size}"]
    if canvas:
        command += ["-gravity", "center", "-extent", canvas]
    subprocess.run([*command, str(root / path)], check=True)


for size in (16, 22, 24, 32, 48, 64, 128, 256):
    render(f"default{size}.png", size)
for name, size in (("about-logo.png", 192), ("about-logo@2x.png", 384),
                   ("about-logo-private.png", 192), ("about-logo-private@2x.png", 384)):
    render(f"content/{name}", size)
render("content/about.png", 192, "300x236")
render("assets/bashkitten-logo-master.png", 1254)
render("document.ico", 64)
(root / "content/about-logo.svg").write_bytes(source.read_bytes())
