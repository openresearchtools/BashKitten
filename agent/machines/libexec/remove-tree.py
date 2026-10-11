#!/usr/bin/python3
# SPDX-License-Identifier: AGPL-3.0-only
"""Remove only an unmounted, registered rootfs inside Podman's user namespace."""
import os
import re
import shutil
import sys
from pathlib import Path

root = Path(sys.argv[1])
owner = Path(sys.argv[2])
if not root.is_absolute() or root.name != 'rootfs' or root.parent != owner:
    raise SystemExit('Invalid registered rootfs path')
if owner.is_symlink() or owner.resolve() != owner or root.is_symlink():
    raise SystemExit('Refusing a redirected machine directory')
if not root.exists():
    raise SystemExit(0)
def unescape(value):
    return re.sub(r'\\([0-7]{3})', lambda m: chr(int(m[1], 8)), value)
for line in Path('/proc/self/mountinfo').read_text().splitlines():
    target = Path(unescape(line.split()[4]))
    if target == root or root in target.parents:
        raise SystemExit('Unmount the owned rootfs before deleting it: ' + str(target))
# shutil uses fd-relative open/unlink on this platform; symlinks are never followed.
if not shutil.rmtree.avoids_symlink_attacks:
    raise SystemExit('This Python cannot safely remove a mapped rootfs')
shutil.rmtree(root)
