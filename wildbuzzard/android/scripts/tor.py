#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
import hashlib
import io
from pathlib import Path
import sys
import urllib.request
import zipfile

URL = "https://raw.githubusercontent.com/guardianproject/gpmaven/master/info/guardianproject/tor-android/0.4.9.12/tor-android-0.4.9.12.aar"
SHA256 = "c2697d7f0e24507b63a14cadb5f832163ad302f8a03651aa03172e008df1c6ef"

def main():
    data = urllib.request.urlopen(URL, timeout=120).read()
    if hashlib.sha256(data).hexdigest() != SHA256:
        raise SystemExit("Tor archive checksum mismatch")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        binary = archive.read("jni/arm64-v8a/libtor.so")
    if binary[:4] != b"\x7fELF" or int.from_bytes(binary[18:20], "little") != 183:
        raise SystemExit("Expected an AArch64 ELF")
    target = Path(sys.argv[1]) / "arm64-v8a/libtor.so"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(binary)

if __name__ == "__main__":
    main()
