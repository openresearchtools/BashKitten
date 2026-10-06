#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
import hashlib
import io
from pathlib import Path
import sys
import urllib.request
import zipfile

URL = "https://raw.githubusercontent.com/guardianproject/gpmaven/master/info/guardianproject/tor-android/0.4.9.13.2/tor-android-0.4.9.13.2.aar"
SHA256 = "40be745450a8ecfaac8558950bf046f596d7ef6e88107f69334a8c4b6e7d14be"

def main():
    abi = sys.argv[2]
    machine = {'arm64-v8a': 183, 'x86_64': 62}[abi]
    data = urllib.request.urlopen(URL, timeout=120).read()
    if hashlib.sha256(data).hexdigest() != SHA256:
        raise SystemExit("Tor archive checksum mismatch")
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        binary = archive.read(f"jni/{abi}/libtor.so")
    if binary[:6] != b"\x7fELF\x02\x01" or int.from_bytes(binary[18:20], "little") != machine:
        raise SystemExit(f"Expected a {abi} ELF")
    target = Path(sys.argv[1]) / f"{abi}/libtor.so"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(binary)

if __name__ == "__main__":
    main()
