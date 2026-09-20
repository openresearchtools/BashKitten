#!/usr/bin/env python3
# SPDX-License-Identifier: AGPL-3.0-or-later
"""Reject Java Android Log output references in a publisher APK's DEX files."""
import json
import struct
import sys
import zipfile

OUTPUT_METHODS = {"v", "d", "i", "w", "e", "wtf", "println", "wtfQuiet", "wtfStack"}


def output_references(path):
    found = []
    with zipfile.ZipFile(path) as archive:
        for name in archive.namelist():
            if not name.endswith(".dex"):
                continue
            data = archive.read(name)
            if not data.startswith(b"dex\n"):
                raise ValueError("Expected standard DEX: " + name)
            def u32(offset):
                return struct.unpack_from("<I", data, offset)[0]
            strings = []
            for index in range(u32(56)):
                offset = u32(u32(60) + 4 * index)
                while data[offset] & 128:
                    offset += 1
                offset += 1
                strings.append(data[offset:data.index(0, offset)].decode("utf-8", errors="replace"))
            types = [strings[u32(u32(68) + 4 * index)] for index in range(u32(64))]
            for index in range(u32(88)):
                owner, _, method = struct.unpack_from("<HHI", data, u32(92) + 8 * index)
                if types[owner] == "Landroid/util/Log;" and strings[method] in OUTPUT_METHODS:
                    found.append({"dex": name, "method": strings[method]})
    return found


if __name__ == "__main__":
    references = output_references(sys.argv[1])
    if references:
        raise SystemExit("Android Log output methods remain: " + json.dumps(references))
    print("No Java Android Log output method references in APK")
